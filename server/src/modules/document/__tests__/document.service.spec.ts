import {
  ConflictException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DataSource,
  QueryFailedError,
  Repository,
} from 'typeorm';

import { KnowledgeBase } from '../../knowledge-base/entities/knowledge-base.entity';
import { ParsedResultStore } from '../../processing/parsing/parsed-result.store';
import { VectorStoreService } from '../../vector-store/vector-store.service';
import { DocumentChunk } from '../entities/document-chunk.entity';
import { Document } from '../entities/document.entity';
import { DocumentStorageService } from '../storage/document-storage.service';
import { DocumentService } from '../document.service';

type DocumentRepositoryMock = jest.Mocked<
  Pick<Repository<Document>, 'findOne'>
>;
type ChunkRepositoryMock = jest.Mocked<Pick<Repository<DocumentChunk>, 'find'>>;
type KnowledgeBaseRepositoryMock = jest.Mocked<
  Pick<Repository<KnowledgeBase>, 'findOne'>
>;
type StorageServiceMock = jest.Mocked<
  Pick<
    DocumentStorageService,
    'cleanupTemporaryFile' | 'moveTemporaryFile' | 'deleteByStoragePath'
  >
>;
type ParsedResultStoreMock = jest.Mocked<Pick<ParsedResultStore, 'remove'>>;
type VectorStoreServiceMock = jest.Mocked<
  Pick<VectorStoreService, 'deleteByDocumentId'>
>;
interface QueryBuilderMock {
  update: jest.MockedFunction<() => QueryBuilderMock>;
  set: jest.MockedFunction<(patch: unknown) => QueryBuilderMock>;
  where: jest.MockedFunction<
    (condition: string, parameters: Record<string, number>) => QueryBuilderMock
  >;
  execute: jest.MockedFunction<() => Promise<{ affected: number }>>;
}

interface TransactionManagerMock {
  create: jest.MockedFunction<
    (_target: typeof Document, entity: Partial<Document>) => Partial<Document>
  >;
  save: jest.MockedFunction<
    (_target: typeof Document, entity: Partial<Document>) => Promise<Document>
  >;
  increment: jest.MockedFunction<
    (
      target: typeof KnowledgeBase,
      criteria: { id: number },
      property: 'documentCount',
      value: number,
    ) => Promise<{ affected: number }>
  >;
  delete: jest.MockedFunction<
    (target: typeof Document, criteria: { id: number }) => Promise<{ affected: number }>
  >;
  createQueryBuilder: jest.MockedFunction<() => QueryBuilderMock>;
}

interface DataSourceMock {
  transaction: jest.MockedFunction<
    (callback: (value: TransactionManagerMock) => Promise<unknown>) => Promise<unknown>
  >;
}

interface UploadFileInput {
  path: string;
  originalname: string;
  size?: number;
}

function createDocument(
  overrides: Partial<Document> = {},
): Document {
  return {
    id: 1,
    kbId: 10,
    fileName: 'doc.txt',
    fileExt: 'txt',
    fileSize: 5,
    fileHash: 'hash',
    storagePath: '10/doc.txt',
    status: 'pending',
    errorMessage: null,
    chunkCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as KnowledgeBase,
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
    qdrantPointId: `point-${index}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    document: undefined as unknown as Document,
  };
}

function createQueryFailedError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error(code), { code });
  return new QueryFailedError('INSERT', [], driverError);
}

function createUploadFile(input: UploadFileInput): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: input.originalname,
    encoding: '7bit',
    mimetype: 'text/plain',
    size: input.size ?? 5,
    destination: '',
    filename: '',
    path: input.path,
    buffer: Buffer.alloc(0),
    stream: undefined as unknown as Express.Multer.File['stream'],
  };
}

function createQueryBuilder(): QueryBuilderMock {
  const builder: QueryBuilderMock = {
    update: jest.fn(() => builder),
    set: jest.fn((_patch: unknown) => builder),
    where: jest.fn(
      (_condition: string, _parameters: Record<string, number>) => builder,
    ),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return builder;
}

function createService(options: {
  knowledgeBase?: KnowledgeBase | null;
  existingDocument?: Document | null;
  document?: Document | null;
  chunks?: DocumentChunk[];
  transactionError?: Error;
} = {}): {
  service: DocumentService;
  documentRepository: DocumentRepositoryMock;
  chunkRepository: ChunkRepositoryMock;
  storageService: StorageServiceMock;
  parsedResultStore: ParsedResultStoreMock;
  vectorStoreService: VectorStoreServiceMock;
  dataSource: DataSourceMock;
} {
  const document = options.document ?? createDocument();
  const documentRepository: DocumentRepositoryMock = {
    findOne: jest
      .fn()
      .mockResolvedValueOnce(options.existingDocument ?? null)
      .mockResolvedValue(document),
  };
  const chunkRepository: ChunkRepositoryMock = {
    find: jest.fn().mockResolvedValue(options.chunks ?? [createChunk(0)]),
  };
  const knowledgeBaseRepository: KnowledgeBaseRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(
      options.knowledgeBase === undefined
        ? ({ id: 10 } as KnowledgeBase)
        : options.knowledgeBase,
    ),
  };
  const storageService: StorageServiceMock = {
    cleanupTemporaryFile: jest.fn().mockResolvedValue(undefined),
    moveTemporaryFile: jest.fn().mockResolvedValue('10/uploaded.txt'),
    deleteByStoragePath: jest.fn().mockResolvedValue(undefined),
  };
  const parsedResultStore: ParsedResultStoreMock = {
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const vectorStoreService: VectorStoreServiceMock = {
    deleteByDocumentId: jest.fn().mockResolvedValue(undefined),
  };
  const queryBuilder = createQueryBuilder();
  const manager: TransactionManagerMock = {
    create: jest.fn((_target: typeof Document, entity: Partial<Document>) => entity),
    save: jest.fn(async (_target: typeof Document, entity: Partial<Document>) => ({
      ...createDocument(entity),
      id: 99,
    })),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => {
      if (options.transactionError !== undefined) {
        throw options.transactionError;
      }

      return callback(manager);
    }),
  } satisfies DataSourceMock;

  return {
    service: new DocumentService(
      documentRepository as unknown as Repository<Document>,
      chunkRepository as unknown as Repository<DocumentChunk>,
      knowledgeBaseRepository as unknown as Repository<KnowledgeBase>,
      dataSource as unknown as DataSource,
      storageService as unknown as DocumentStorageService,
      parsedResultStore as unknown as ParsedResultStore,
      vectorStoreService as unknown as VectorStoreService,
    ),
    documentRepository,
    chunkRepository,
    storageService,
    parsedResultStore,
    vectorStoreService,
    dataSource,
  };
}

describe('DocumentService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rag-document-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects files with .pdf extension but invalid PDF header', async () => {
    const filePath = join(tempDir, 'bad.pdf');
    await writeFile(filePath, 'not pdf');
    const { service, storageService } = createService();

    await expect(
      service.upload(10, createUploadFile({ path: filePath, originalname: 'bad.pdf' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storageService.cleanupTemporaryFile).toHaveBeenCalledWith(filePath);
  });

  it('rejects duplicate uploads found by hash precheck', async () => {
    const filePath = join(tempDir, 'doc.txt');
    await writeFile(filePath, 'hello');
    const existingDocument = createDocument({
      id: 5,
      fileName: 'doc.txt',
      status: 'completed',
    });
    const { service, storageService } = createService({ existingDocument });

    await expect(
      service.upload(10, createUploadFile({ path: filePath, originalname: 'doc.txt' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storageService.cleanupTemporaryFile).toHaveBeenCalledWith(filePath);
    expect(storageService.moveTemporaryFile).not.toHaveBeenCalled();
  });

  it('retries upload transaction once after a deadlock', async () => {
    const filePath = join(tempDir, 'doc.txt');
    await writeFile(filePath, 'hello');
    const { service, dataSource } = createService();
    dataSource.transaction
      .mockRejectedValueOnce(createQueryFailedError('ER_LOCK_DEADLOCK'))
      .mockImplementationOnce(async (callback) =>
        callback({
          create: jest.fn((_target: typeof Document, entity: Partial<Document>) => entity),
          save: jest.fn(async (_target: typeof Document, entity: Partial<Document>) => ({
            ...createDocument(entity),
            id: 99,
          })),
          increment: jest.fn().mockResolvedValue({ affected: 1 }),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          createQueryBuilder: jest.fn(() => createQueryBuilder()),
        }),
      );

    await expect(
      service.upload(10, createUploadFile({ path: filePath, originalname: 'doc.txt' })),
    ).resolves.toMatchObject({ id: 99, fileName: 'doc.txt' });
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
  });

  it('cleans vectors, database row, file and parsed cache when removing a document', async () => {
    const { service, vectorStoreService, storageService, parsedResultStore } =
      createService({ existingDocument: createDocument({ id: 5 }) });

    await service.remove(5);

    expect(vectorStoreService.deleteByDocumentId).toHaveBeenCalledWith(5);
    expect(storageService.deleteByStoragePath).toHaveBeenCalledWith('10/doc.txt');
    expect(parsedResultStore.remove).toHaveBeenCalledWith(5);
  });

  it('returns document detail with chunk preview', async () => {
    const chunks = [createChunk(0), createChunk(1)];
    const { service, chunkRepository } = createService({
      existingDocument: createDocument({ id: 1 }),
      chunks,
    });

    const detail = await service.findOne(1);

    expect(chunkRepository.find).toHaveBeenCalledWith({
      where: { documentId: 1 },
      order: { chunkIndex: 'ASC' },
      take: 20,
    });
    expect(detail.chunks).toHaveLength(2);
  });
});
