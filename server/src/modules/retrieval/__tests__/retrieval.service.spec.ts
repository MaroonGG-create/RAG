import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { Document } from '../../document/entities/document.entity';
import { EmbeddingService } from '../../embedding/embedding.service';
import { KnowledgeBase } from '../../knowledge-base/entities/knowledge-base.entity';
import { QdrantScoredPoint } from '../../vector-store/vector-store.types';
import { VectorStoreService } from '../../vector-store/vector-store.service';
import { RetrievalService } from '../retrieval.service';

type ConfigValue = number;
type KnowledgeBaseRepositoryMock = jest.Mocked<
  Pick<Repository<KnowledgeBase>, 'findOne'>
>;
type DocumentRepositoryMock = jest.Mocked<Pick<Repository<Document>, 'find'>>;
type EmbeddingServiceMock = jest.Mocked<Pick<EmbeddingService, 'embedQuery'>>;
type VectorStoreServiceMock = jest.Mocked<Pick<VectorStoreService, 'search'>>;

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

function createDocument(id: number): Document {
  return {
    id,
    kbId: 1,
    fileName: `doc-${id}.txt`,
    fileExt: 'txt',
    fileSize: 100,
    fileHash: `hash-${id}`,
    storagePath: `1/doc-${id}.txt`,
    status: 'completed',
    errorMessage: null,
    chunkCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as KnowledgeBase,
    chunks: [],
  };
}

function createPoint(
  documentId: number,
  score: number,
  overrides: Partial<QdrantScoredPoint['payload']> = {},
): QdrantScoredPoint {
  return {
    id: `point-${documentId}-${score}`,
    score,
    payload: {
      chunkId: documentId * 10,
      knowledgeBaseId: 1,
      documentId,
      documentName: `doc-${documentId}.txt`,
      chunkIndex: 0,
      pageNo: null,
      content: `content-${documentId}`,
      ...overrides,
    },
  };
}

function createService(options: {
  knowledgeBaseExists?: boolean;
  completedDocuments?: Document[];
  rawResults?: QdrantScoredPoint[];
  topK?: number;
  scoreThreshold?: number;
} = {}): {
  service: RetrievalService;
  knowledgeBaseRepository: KnowledgeBaseRepositoryMock;
  documentRepository: DocumentRepositoryMock;
  embeddingService: EmbeddingServiceMock;
  vectorStoreService: VectorStoreServiceMock;
} {
  const knowledgeBaseRepository: KnowledgeBaseRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(
      options.knowledgeBaseExists === false ? null : ({ id: 1 } as KnowledgeBase),
    ),
  };
  const documentRepository: DocumentRepositoryMock = {
    find: jest.fn().mockResolvedValue(
      options.completedDocuments ?? [createDocument(1)],
    ),
  };
  const embeddingService: EmbeddingServiceMock = {
    embedQuery: jest.fn().mockResolvedValue([1, 0, 0, 0]),
  };
  const vectorStoreService: VectorStoreServiceMock = {
    search: jest.fn().mockResolvedValue(options.rawResults ?? []),
  };
  const configService = new TestConfigService({
    'retrieval.topK': options.topK ?? 5,
    'retrieval.scoreThreshold': options.scoreThreshold ?? 0.5,
  });

  return {
    service: new RetrievalService(
      knowledgeBaseRepository as unknown as Repository<KnowledgeBase>,
      documentRepository as unknown as Repository<Document>,
      embeddingService as unknown as EmbeddingService,
      vectorStoreService as unknown as VectorStoreService,
      configService as unknown as ConfigService,
    ),
    knowledgeBaseRepository,
    documentRepository,
    embeddingService,
    vectorStoreService,
  };
}

describe('RetrievalService', () => {
  it('rejects empty query', async () => {
    const { service } = createService();

    await expect(service.search(1, '  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when knowledge base does not exist', async () => {
    const { service } = createService({ knowledgeBaseExists: false });

    await expect(service.search(1, 'query')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns empty result when there are no completed documents', async () => {
    const { service, embeddingService, vectorStoreService } = createService({
      completedDocuments: [],
    });

    const result = await service.search(1, 'query');

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(embeddingService.embedQuery).not.toHaveBeenCalled();
    expect(vectorStoreService.search).not.toHaveBeenCalled();
  });

  it('returns empty result when vector search has no hits', async () => {
    const { service } = createService({ rawResults: [] });

    const result = await service.search(1, 'query');

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('maps and sorts valid hits by score descending', async () => {
    const { service } = createService({
      completedDocuments: [createDocument(1), createDocument(2)],
      rawResults: [createPoint(1, 0.6), createPoint(2, 0.9)],
    });

    const result = await service.search(1, 'query');

    expect(result.results.map((item) => item.score)).toEqual([0.9, 0.6]);
    expect(result.results[0]).toMatchObject({
      chunkId: 20,
      documentId: 2,
      documentName: 'doc-2.txt',
      content: 'content-2',
    });
  });

  it('filters hits whose document is not completed', async () => {
    const { service } = createService({
      completedDocuments: [createDocument(1)],
      rawResults: [createPoint(1, 0.9), createPoint(99, 0.95)],
    });

    const result = await service.search(1, 'query');

    expect(result.results).toHaveLength(1);
    expect(result.results[0].documentId).toBe(1);
  });

  it('skips hits with invalid payload fields', async () => {
    const { service } = createService({
      completedDocuments: [createDocument(1)],
      rawResults: [
        createPoint(1, 0.9),
        createPoint(1, 0.8, {
          chunkId: 'invalid' as unknown as number,
        }),
      ],
    });

    const result = await service.search(1, 'query');

    expect(result.results).toHaveLength(1);
    expect(result.results[0].score).toBe(0.9);
  });

  it('passes request topK override to vector store', async () => {
    const { service, vectorStoreService } = createService();

    await service.search(1, 'query', 3);

    expect(vectorStoreService.search).toHaveBeenCalledWith(
      [1, 0, 0, 0],
      1,
      3,
      0.5,
    );
  });

  it('passes request scoreThreshold override to vector store', async () => {
    const { service, vectorStoreService } = createService();

    await service.search(1, 'query', undefined, 0.8);

    expect(vectorStoreService.search).toHaveBeenCalledWith(
      [1, 0, 0, 0],
      1,
      5,
      0.8,
    );
  });

  it('uses configured defaults when overrides are omitted', async () => {
    const { service, vectorStoreService } = createService({
      topK: 7,
      scoreThreshold: 0.4,
    });

    await service.search(1, 'query');

    expect(vectorStoreService.search).toHaveBeenCalledWith(
      [1, 0, 0, 0],
      1,
      7,
      0.4,
    );
  });
});
