import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';

import { Document } from '../../document/entities/document.entity';
import { DocumentStorageService } from '../../document/storage/document-storage.service';
import { ParsedResultStore } from '../../processing/parsing/parsed-result.store';
import { VectorStoreService } from '../../vector-store/vector-store.service';
import { KnowledgeBase } from '../entities/knowledge-base.entity';
import { KnowledgeBaseService } from '../knowledge-base.service';

interface KnowledgeBaseRepositoryMock {
  findOne: jest.MockedFunction<
    (options: unknown) => Promise<KnowledgeBase | null>
  >;
  create: jest.MockedFunction<
    (entity: Partial<KnowledgeBase>) => KnowledgeBase
  >;
  save: jest.MockedFunction<
    (entity: KnowledgeBase) => Promise<KnowledgeBase>
  >;
  find: jest.MockedFunction<(options: unknown) => Promise<KnowledgeBase[]>>;
  delete: jest.MockedFunction<(id: number) => Promise<{ affected: number }>>;
}
type DocumentRepositoryMock = jest.Mocked<Pick<Repository<Document>, 'find'>>;
type StorageServiceMock = jest.Mocked<
  Pick<
    DocumentStorageService,
    'deleteByStoragePath' | 'deleteKnowledgeBaseDirectory'
  >
>;
type ParsedResultStoreMock = jest.Mocked<Pick<ParsedResultStore, 'remove'>>;
type VectorStoreServiceMock = jest.Mocked<
  Pick<VectorStoreService, 'deleteByKnowledgeBaseId'>
>;

function createKnowledgeBase(
  overrides: Partial<KnowledgeBase> = {},
): KnowledgeBase {
  return {
    id: 10,
    name: 'kb',
    description: null,
    documentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    documents: [],
    conversations: [],
    ...overrides,
  };
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
    status: 'completed',
    errorMessage: null,
    chunkCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: createKnowledgeBase(),
    chunks: [],
    ...overrides,
  };
}

function duplicateEntryError(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate'), {
    code: 'ER_DUP_ENTRY',
  });
  return new QueryFailedError('INSERT', [], driverError);
}

function createService(options: {
  existing?: KnowledgeBase | null;
  saveError?: Error;
  documents?: Document[];
  storageError?: Error;
} = {}): {
  service: KnowledgeBaseService;
  knowledgeBaseRepository: KnowledgeBaseRepositoryMock;
  documentRepository: DocumentRepositoryMock;
  vectorStoreService: VectorStoreServiceMock;
  storageService: StorageServiceMock;
  parsedResultStore: ParsedResultStoreMock;
} {
  const knowledgeBaseRepository: KnowledgeBaseRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(
      options.existing === undefined
        ? null
        : options.existing,
    ),
    create: jest.fn((entity: Partial<KnowledgeBase>) => entity as KnowledgeBase),
    save: options.saveError
      ? jest.fn().mockRejectedValue(options.saveError)
      : jest.fn(async (entity: KnowledgeBase) => ({
          ...createKnowledgeBase(entity),
          id: 10,
        })),
    find: jest.fn().mockResolvedValue([createKnowledgeBase()]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const documentRepository: DocumentRepositoryMock = {
    find: jest.fn().mockResolvedValue(
      options.documents ?? [
        createDocument({ id: 1, storagePath: '10/a.txt' }),
        createDocument({ id: 2, storagePath: '10/b.txt' }),
      ],
    ),
  };
  const vectorStoreService: VectorStoreServiceMock = {
    deleteByKnowledgeBaseId: jest.fn().mockResolvedValue(undefined),
  };
  const storageService: StorageServiceMock = {
    deleteByStoragePath: options.storageError
      ? jest.fn().mockRejectedValue(options.storageError)
      : jest.fn().mockResolvedValue(undefined),
    deleteKnowledgeBaseDirectory: jest.fn().mockResolvedValue(undefined),
  };
  const parsedResultStore: ParsedResultStoreMock = {
    remove: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new KnowledgeBaseService(
      knowledgeBaseRepository as unknown as Repository<KnowledgeBase>,
      documentRepository as unknown as Repository<Document>,
      vectorStoreService as unknown as VectorStoreService,
      storageService as unknown as DocumentStorageService,
      parsedResultStore as unknown as ParsedResultStore,
    ),
    knowledgeBaseRepository,
    documentRepository,
    vectorStoreService,
    storageService,
    parsedResultStore,
  };
}

describe('KnowledgeBaseService', () => {
  it('rejects duplicate names during precheck', async () => {
    const { service } = createService({
      existing: createKnowledgeBase({ name: 'kb' }),
    });

    await expect(service.create({ name: 'kb' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('converts duplicate database errors to ConflictException', async () => {
    const { service } = createService({ saveError: duplicateEntryError() });

    await expect(service.create({ name: 'kb' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFoundException when reading a missing knowledge base', async () => {
    const { service } = createService({ existing: null });

    await expect(service.findOne(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cleans vectors, files, parsed cache, directory and database when removing', async () => {
    const existing = createKnowledgeBase({ id: 10 });
    const {
      service,
      vectorStoreService,
      storageService,
      parsedResultStore,
      knowledgeBaseRepository,
    } = createService({ existing });

    await service.remove(10);

    expect(vectorStoreService.deleteByKnowledgeBaseId).toHaveBeenCalledWith(10);
    expect(storageService.deleteByStoragePath).toHaveBeenNthCalledWith(1, '10/a.txt');
    expect(storageService.deleteByStoragePath).toHaveBeenNthCalledWith(2, '10/b.txt');
    expect(parsedResultStore.remove).toHaveBeenNthCalledWith(1, 1);
    expect(parsedResultStore.remove).toHaveBeenNthCalledWith(2, 2);
    expect(storageService.deleteKnowledgeBaseDirectory).toHaveBeenCalledWith(10);
    expect(knowledgeBaseRepository.delete).toHaveBeenCalledWith(10);
  });

  it('does not block database deletion when file cleanup fails', async () => {
    const { service, knowledgeBaseRepository } = createService({
      existing: createKnowledgeBase({ id: 10 }),
      storageError: new Error('file locked'),
    });

    await expect(service.remove(10)).resolves.toBeUndefined();
    expect(knowledgeBaseRepository.delete).toHaveBeenCalledWith(10);
  });
});
