import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { Document } from '../../document/entities/document.entity';
import { EmbeddedChunk, EmbeddingResult } from '../../embedding/embedding.types';
import { EmbeddingService } from '../../embedding/embedding.service';
import { QdrantClientWrapper } from '../qdrant-client-wrapper';
import { VectorStoreFailure } from '../vector-store.types';
import { VectorStoreService } from '../vector-store.service';

type ConfigValue = string | number;
type DocumentRepositoryMock = jest.Mocked<
  Pick<Repository<Document>, 'findOne' | 'update'>
>;
type EmbeddingServiceMock = jest.Mocked<
  Pick<EmbeddingService, 'embedDocument'>
>;
type QdrantClientMock = jest.Mocked<
  Pick<
    QdrantClientWrapper,
    | 'deleteByFilter'
    | 'search'
    | 'upsertPoints'
    | 'countPoints'
    | 'isMockEnabled'
    | 'collectionExists'
    | 'createCollection'
    | 'getCollection'
    | 'createFieldIndex'
  >
>;

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

function createDocument(
  overrides: Partial<Document> = {},
): Document {
  return {
    id: 1,
    kbId: 10,
    fileName: 'manual.pdf',
    fileExt: 'pdf',
    fileSize: 100,
    fileHash: 'hash',
    storagePath: '10/manual.pdf',
    status: 'embedding',
    errorMessage: null,
    chunkCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as Document['knowledgeBase'],
    chunks: [],
    ...overrides,
  };
}

function createEmbeddedChunk(
  overrides: Partial<EmbeddedChunk> = {},
): EmbeddedChunk {
  return {
    chunkId: 11,
    chunkIndex: 0,
    qdrantPointId: '00000000-0000-4000-8000-000000000011',
    content: 'chunk content',
    charCount: 13,
    pageNo: 2,
    kbId: 10,
    documentId: 1,
    vector: [1, 0, 0, 0],
    ...overrides,
  };
}

function createEmbeddingResult(
  chunks: EmbeddedChunk[],
): EmbeddingResult {
  return {
    documentId: 1,
    chunks,
    totalChunks: chunks.length,
    vectorDimension: 4,
    batchCount: 1,
  };
}

function createService(options: {
  document?: Document | null;
  chunks?: EmbeddedChunk[];
  vectorCount?: number;
} = {}): {
  service: VectorStoreService;
  documentRepository: DocumentRepositoryMock;
  embeddingService: EmbeddingServiceMock;
  qdrantClient: QdrantClientMock;
} {
  const chunks = options.chunks ?? [createEmbeddedChunk()];
  const documentRepository: DocumentRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(options.document ?? createDocument()),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const embeddingService: EmbeddingServiceMock = {
    embedDocument: jest.fn().mockResolvedValue(createEmbeddingResult(chunks)),
  };
  const qdrantClient: QdrantClientMock = {
    deleteByFilter: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
    upsertPoints: jest.fn().mockResolvedValue(undefined),
    countPoints: jest.fn().mockResolvedValue(options.vectorCount ?? chunks.length),
    isMockEnabled: jest.fn().mockReturnValue(true),
    collectionExists: jest.fn().mockResolvedValue(true),
    createCollection: jest.fn().mockResolvedValue(undefined),
    getCollection: jest.fn().mockResolvedValue({ size: 4, distance: 'Cosine' }),
    createFieldIndex: jest.fn().mockResolvedValue(undefined),
  };
  const configService = new TestConfigService({
    'qdrant.collection': 'rag_chunks',
    'embedding.dimension': 4,
    'qdrant.upsertBatchSize': 100,
  });

  return {
    service: new VectorStoreService(
      documentRepository as unknown as Repository<Document>,
      embeddingService as unknown as EmbeddingService,
      qdrantClient as unknown as QdrantClientWrapper,
      configService as unknown as ConfigService,
    ),
    documentRepository,
    embeddingService,
    qdrantClient,
  };
}

describe('VectorStoreService', () => {
  it('passes knowledgeBaseId filter to search', async () => {
    const { service, qdrantClient } = createService();

    await service.search([1, 0, 0, 0], 10, 3, 0.8);

    expect(qdrantClient.search).toHaveBeenCalledWith(
      [1, 0, 0, 0],
      { must: [{ key: 'knowledgeBaseId', match: { value: 10 } }] },
      3,
      0.8,
    );
  });

  it('deletes vectors by documentId filter', async () => {
    const { service, qdrantClient } = createService();

    await service.deleteByDocumentId(7);

    expect(qdrantClient.deleteByFilter).toHaveBeenCalledWith({
      must: [{ key: 'documentId', match: { value: 7 } }],
    });
  });

  it('deletes vectors by knowledgeBaseId filter', async () => {
    const { service, qdrantClient } = createService();

    await service.deleteByKnowledgeBaseId(8);

    expect(qdrantClient.deleteByFilter).toHaveBeenCalledWith({
      must: [{ key: 'knowledgeBaseId', match: { value: 8 } }],
    });
  });

  it('upserts vectors with document chunk qdrantPointId and full payload', async () => {
    const { service, qdrantClient, documentRepository } = createService();

    await expect(service.storeDocument(1)).resolves.toMatchObject({
      documentId: 1,
      chunkCount: 1,
      vectorCount: 1,
      collectionName: 'rag_chunks',
    });
    expect(qdrantClient.upsertPoints).toHaveBeenCalledWith([
      {
        id: '00000000-0000-4000-8000-000000000011',
        vector: [1, 0, 0, 0],
        payload: {
          chunkId: 11,
          knowledgeBaseId: 10,
          documentId: 1,
          documentName: 'manual.pdf',
          chunkIndex: 0,
          pageNo: 2,
          content: 'chunk content',
        },
      },
    ]);
    expect(documentRepository.update).toHaveBeenLastCalledWith(1, {
      status: 'completed',
      errorMessage: null,
    });
  });

  it('cleans vectors and marks failed when written count mismatches', async () => {
    const { service, qdrantClient, documentRepository } = createService({
      vectorCount: 0,
    });

    await expect(service.storeDocument(1)).rejects.toThrow(
      new VectorStoreFailure('Qdrant 写入数量不一致：expected=1，actual=0'),
    );
    expect(qdrantClient.deleteByFilter).toHaveBeenCalledTimes(2);
    expect(documentRepository.update).toHaveBeenLastCalledWith(1, {
      status: 'failed',
      errorMessage: expect.stringContaining('Qdrant 写入数量不一致'),
    });
  });

  it('rejects mismatched embedding dimensions before upsert', async () => {
    const { service, qdrantClient } = createService({
      chunks: [createEmbeddedChunk({ vector: [1, 0] })],
    });

    await expect(service.storeDocument(1)).rejects.toThrow(
      'Embedding 向量维度不一致',
    );
    expect(qdrantClient.upsertPoints).not.toHaveBeenCalled();
  });
});
