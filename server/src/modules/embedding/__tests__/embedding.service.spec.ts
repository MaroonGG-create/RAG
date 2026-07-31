import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { DocumentChunk } from '../../document/entities/document-chunk.entity';
import { Document } from '../../document/entities/document.entity';
import { EmbeddingClient } from '../embedding-client';
import { EmbeddingService } from '../embedding.service';
import { EmbeddingFailure } from '../embedding.types';

type ConfigValue = number | boolean;
type DocumentRepositoryMock = jest.Mocked<
  Pick<Repository<Document>, 'findOne' | 'update'>
>;
type ChunkRepositoryMock = jest.Mocked<Pick<Repository<DocumentChunk>, 'find'>>;
type EmbeddingClientMock = jest.Mocked<Pick<EmbeddingClient, 'embed'>>;

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
    fileName: 'doc.txt',
    fileExt: 'txt',
    fileSize: 100,
    fileHash: 'hash',
    storagePath: '10/doc.txt',
    status: 'chunking',
    errorMessage: null,
    chunkCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as Document['knowledgeBase'],
    chunks: [],
    ...overrides,
  };
}

function createChunk(index: number): DocumentChunk {
  return {
    id: index + 1,
    documentId: 1,
    kbId: 10,
    chunkIndex: index,
    content: `chunk-${index}`,
    charCount: 7,
    pageNo: null,
    qdrantPointId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    document: undefined as unknown as Document,
  };
}

function createService(options: {
  document?: Document | null;
  chunks?: DocumentChunk[];
  batchSize?: number;
  dimension?: number;
  vectors?: number[][];
  embedError?: Error;
} = {}): {
  service: EmbeddingService;
  documentRepository: DocumentRepositoryMock;
  chunkRepository: ChunkRepositoryMock;
  embeddingClient: EmbeddingClientMock;
} {
  const documentRepository: DocumentRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(
      Object.prototype.hasOwnProperty.call(options, 'document')
        ? options.document
        : createDocument(),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const chunkRepository: ChunkRepositoryMock = {
    find: jest.fn().mockResolvedValue(
      options.chunks ?? [createChunk(0), createChunk(1)],
    ),
  };
  const embeddingClient: EmbeddingClientMock = {
    embed: options.embedError
      ? jest.fn().mockRejectedValue(options.embedError)
      : jest.fn().mockResolvedValue(
          options.vectors ?? [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
          ],
        ),
  };
  const configService = new TestConfigService({
    'embedding.batchSize': options.batchSize ?? 20,
    'embedding.dimension': options.dimension ?? 4,
    'embedding.mock': true,
  });

  return {
    service: new EmbeddingService(
      documentRepository as unknown as Repository<Document>,
      chunkRepository as unknown as Repository<DocumentChunk>,
      embeddingClient as unknown as EmbeddingClient,
      configService as unknown as ConfigService,
    ),
    documentRepository,
    chunkRepository,
    embeddingClient,
  };
}

describe('EmbeddingService', () => {
  it('embeds a query and returns the single vector', async () => {
    const { service, embeddingClient } = createService({
      vectors: [[1, 2, 3, 4]],
    });

    await expect(service.embedQuery('hello')).resolves.toEqual([1, 2, 3, 4]);
    expect(embeddingClient.embed).toHaveBeenCalledWith(['hello']);
  });

  it('rejects query embedding count mismatch', async () => {
    const { service } = createService({ vectors: [] });

    await expect(service.embedQuery('hello')).rejects.toThrow(
      'Query Embedding 返回数量不一致',
    );
  });

  it('rejects query embedding dimension mismatch', async () => {
    const { service } = createService({ vectors: [[1, 2, 3]] });

    await expect(service.embedQuery('hello')).rejects.toThrow(
      'Embedding 维度不一致',
    );
  });

  it('deduplicates concurrent document embedding execution', async () => {
    let resolveEmbed: (value: number[][]) => void = () => undefined;
    const pendingEmbed = new Promise<number[][]>((resolve) => {
      resolveEmbed = resolve;
    });
    const { service, embeddingClient } = createService({
      vectors: [[1, 0, 0, 0], [0, 1, 0, 0]],
    });
    embeddingClient.embed.mockReturnValue(pendingEmbed);

    const first = service.embedDocument(1);
    const second = service.embedDocument(1);
    resolveEmbed([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when document does not exist', async () => {
    const { service } = createService({ document: null });

    await expect(service.embedDocument(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects already completed documents', async () => {
    const { service } = createService({
      document: createDocument({ status: 'completed' }),
    });

    await expect(service.embedDocument(1)).rejects.toThrow(
      new EmbeddingFailure('文档已完成向量化，禁止重复嵌入'),
    );
  });

  it('rejects documents without chunks and marks failed', async () => {
    const { service, documentRepository } = createService({ chunks: [] });

    await expect(service.embedDocument(1)).rejects.toThrow('文档尚未切片');
    expect(documentRepository.update).toHaveBeenLastCalledWith(1, {
      status: 'failed',
      errorMessage: expect.stringContaining('文档尚未切片'),
    });
  });

  it('embeds chunks in configured batches', async () => {
    const chunks = Array.from({ length: 45 }, (_, index) => createChunk(index));
    const vectors = chunks.map(() => [1, 0, 0, 0]);
    const { service, embeddingClient } = createService({
      chunks,
      batchSize: 20,
      vectors,
    });
    embeddingClient.embed.mockImplementation(async (texts: string[]) =>
      texts.map(() => [1, 0, 0, 0]),
    );

    const result = await service.embedDocument(1);

    expect(result.totalChunks).toBe(45);
    expect(result.batchCount).toBe(3);
    expect(embeddingClient.embed).toHaveBeenCalledTimes(3);
  });

  it('rejects document embedding count mismatch', async () => {
    const { service } = createService({ vectors: [[1, 0, 0, 0]] });

    await expect(service.embedDocument(1)).rejects.toThrow(
      'Embedding 返回数量不一致',
    );
  });

  it('rejects non-finite vector values', async () => {
    const { service } = createService({
      vectors: [
        [Number.NaN, 0, 0, 0],
        [0, 1, 0, 0],
      ],
    });

    await expect(service.embedDocument(1)).rejects.toThrow(
      'Embedding 向量包含非有限数值',
    );
  });

  it('marks the document failed when embedding client fails', async () => {
    const { service, documentRepository } = createService({
      embedError: new Error('network down'),
    });

    await expect(service.embedDocument(1)).rejects.toThrow('network down');
    expect(documentRepository.update).toHaveBeenLastCalledWith(1, {
      status: 'failed',
      errorMessage: 'network down',
    });
  });
});
