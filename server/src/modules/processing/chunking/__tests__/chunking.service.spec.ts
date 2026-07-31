import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';

import { DocumentChunk } from '../../../document/entities/document-chunk.entity';
import { Document } from '../../../document/entities/document.entity';
import { ParsedDocument } from '../../parsing/parsed-document.types';
import { ParsedResultStore } from '../../parsing/parsed-result.store';
import { ChunkingService } from '../chunking.service';

type ConfigValue = string | number;
type DocumentRepositoryMock = jest.Mocked<
  Pick<Repository<Document>, 'findOne' | 'update'>
>;
type ChunkRepositoryMock = jest.Mocked<
  Pick<Repository<DocumentChunk>, 'find' | 'delete'>
>;
type ParsedResultStoreMock = jest.Mocked<Pick<ParsedResultStore, 'read'>>;

interface TransactionManagerMock {
  delete: jest.MockedFunction<
    (target: typeof DocumentChunk, criteria: { documentId: number }) => Promise<{ affected: number }>
  >;
  create: jest.MockedFunction<
    (target: typeof DocumentChunk, entity: Partial<DocumentChunk>) => DocumentChunk
  >;
  save: jest.MockedFunction<
    (target: typeof DocumentChunk, entities: DocumentChunk[]) => Promise<DocumentChunk[]>
  >;
  update: jest.MockedFunction<
    (
      target: typeof Document,
      id: number,
      patch: Partial<Document>,
    ) => Promise<{ affected: number }>
  >;
}

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

function createDocument(): Document {
  return {
    id: 1,
    kbId: 10,
    fileName: 'manual.pdf',
    fileExt: 'pdf',
    fileSize: 100,
    fileHash: 'hash',
    storagePath: '10/manual.pdf',
    status: 'pending',
    errorMessage: null,
    chunkCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as Document['knowledgeBase'],
    chunks: [],
  };
}

function createParsedDocument(): ParsedDocument {
  return {
    documentId: 1,
    fileExt: 'pdf',
    parser: 'pdfjs',
    parserVersion: 'test',
    fileHash: 'hash',
    parsedAt: '2026-07-31T00:00:00.000Z',
    totalChars: 0,
    pages: [
      { pageNo: 1, text: '第一页内容。'.repeat(20) },
      { pageNo: 2, text: '第二页内容。'.repeat(5) },
    ],
  };
}

function createService(parsedDocument: ParsedDocument | null): {
  service: ChunkingService;
  savedChunks: DocumentChunk[];
  documentRepository: DocumentRepositoryMock;
  chunkRepository: ChunkRepositoryMock;
} {
  const savedChunks: DocumentChunk[] = [];
  const documentRepository: DocumentRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(createDocument()),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const chunkRepository: ChunkRepositoryMock = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager: TransactionManagerMock = {
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn(
      (_target: typeof DocumentChunk, entity: Partial<DocumentChunk>) =>
        entity as DocumentChunk,
    ),
    save: jest.fn(async (_target: typeof DocumentChunk, entities: DocumentChunk[]) => {
      savedChunks.push(...entities);
      return entities;
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    transaction: jest.fn(
      async (callback: (value: TransactionManagerMock) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  const parsedResultStore: ParsedResultStoreMock = {
    read: jest.fn().mockResolvedValue(parsedDocument),
  };
  const configService = new TestConfigService({
    'chunk.size': 80,
    'chunk.overlap': 20,
    'upload.dir': 'uploads',
  });

  return {
    service: new ChunkingService(
      documentRepository as unknown as Repository<Document>,
      chunkRepository as unknown as Repository<DocumentChunk>,
      dataSource as unknown as DataSource,
      parsedResultStore as unknown as ParsedResultStore,
      configService as unknown as ConfigService,
    ),
    savedChunks,
    documentRepository,
    chunkRepository,
  };
}

describe('ChunkingService', () => {
  it('creates continuous chunks and keeps PDF page numbers', async () => {
    const { service, savedChunks } = createService(createParsedDocument());

    const result = await service.chunkDocument(1);

    expect(result.chunkCount).toBe(savedChunks.length);
    expect(savedChunks.length).toBeGreaterThan(1);
    expect(savedChunks.map((chunk) => chunk.chunkIndex)).toEqual(
      savedChunks.map((_, index) => index),
    );
    expect(new Set(savedChunks.map((chunk) => chunk.pageNo))).toEqual(
      new Set([1, 2]),
    );
    expect(savedChunks.every((chunk) => chunk.charCount === chunk.content.length)).toBe(
      true,
    );
    expect(
      savedChunks.every((chunk) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          chunk.qdrantPointId,
        ),
      ),
    ).toBe(true);
  });

  it('cleans half-finished chunks and marks document failed on invalid parsed result', async () => {
    const { service, documentRepository, chunkRepository } = createService(null);

    await expect(service.chunkDocument(1)).rejects.toThrow('文档尚未解析');
    expect(chunkRepository.delete).toHaveBeenCalledWith({ documentId: 1 });
    expect(documentRepository.update).toHaveBeenLastCalledWith(1, {
      status: 'failed',
      errorMessage: expect.stringContaining('文档尚未解析'),
      chunkCount: 0,
    });
  });
});
