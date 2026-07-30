import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  DataSource,
  QueryFailedError,
  Repository,
} from 'typeorm';

import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
import { ParsedResultStore } from '../processing/parsing/parsed-result.store';
import { VectorStoreService } from '../vector-store/vector-store.service';
import {
  DocumentDetailResponseDto,
  DocumentFileExtension,
  DocumentResponseDto,
} from './dto/document-response.dto';
import { DocumentChunk } from './entities/document-chunk.entity';
import { Document } from './entities/document.entity';
import { DocumentStorageService } from './storage/document-storage.service';
import { computeFileSha256 } from './utils/file-hash.util';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private readonly chunkRepository: Repository<DocumentChunk>,
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
    private readonly dataSource: DataSource,
    private readonly storageService: DocumentStorageService,
    private readonly parsedResultStore: ParsedResultStore,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  async upload(
    knowledgeBaseId: number,
    file: Express.Multer.File,
  ): Promise<DocumentResponseDto> {
    const fileExtension = this.getFileExtension(file);
    let fileHash = '';
    let storagePath: string;

    try {
      await this.assertKnowledgeBaseExists(knowledgeBaseId);

      if (fileExtension === 'pdf') {
        await this.assertPdfHeader(file.path);
      }

      fileHash = await computeFileSha256(file.path);
      const existingDocument = await this.documentRepository.findOne({
        where: { kbId: knowledgeBaseId, fileHash },
      });

      if (existingDocument !== null) {
        this.logger.log(
          `检测到重复文件：knowledgeBaseId=${knowledgeBaseId}，documentId=${existingDocument.id}`,
        );
        throw this.createDuplicateFileException(existingDocument);
      }

      storagePath = await this.storageService.moveTemporaryFile(
        file.path,
        knowledgeBaseId,
      );
    } catch (error: unknown) {
      await this.storageService.cleanupTemporaryFile(file.path);
      throw error;
    }

    let generatedDocumentId: number | undefined;
    let savedDocument: Document;

    try {
      const persistDocument = (): Promise<Document> =>
        this.dataSource.transaction(async (manager) => {
          const document = manager.create(Document, {
            kbId: knowledgeBaseId,
            fileName: file.originalname,
            fileExt: fileExtension,
            fileSize: file.size,
            fileHash,
            storagePath,
            status: 'pending',
            errorMessage: null,
            chunkCount: 0,
          });
          const saved = await manager.save(Document, document);
          generatedDocumentId = saved.id;

          await manager.increment(
            KnowledgeBase,
            { id: knowledgeBaseId },
            'documentCount',
            1,
          );

          return saved;
        });

      try {
        savedDocument = await persistDocument();
      } catch (error: unknown) {
        if (!this.isDeadlockError(error)) {
          throw error;
        }

        // 同一唯一键并发插入并更新同一计数行时 MySQL 可能先报死锁；整段事务只重试一次。
        this.logger.warn(
          `文档事务发生死锁，重试一次：knowledgeBaseId=${knowledgeBaseId}`,
        );
        savedDocument = await persistDocument();
      }
    } catch (error: unknown) {
      // 文件系统没有事务；数据库回滚后补偿删除本次已就位的 UUID 文件。
      await this.storageService.deleteByStoragePath(storagePath);

      if (this.isDuplicateEntryError(error)) {
        const existingDocument = await this.documentRepository.findOne({
          where: { kbId: knowledgeBaseId, fileHash },
        });

        if (existingDocument !== null) {
          this.logger.log(
            `并发重复文件：knowledgeBaseId=${knowledgeBaseId}，documentId=${existingDocument.id}`,
          );
          throw this.createDuplicateFileException(existingDocument);
        }

        throw new ConflictException('同一知识库已存在相同文件');
      }

      this.logger.error(
        `文档事务失败：documentId=${generatedDocumentId ?? '未生成'}，${this.getErrorMessage(error)}`,
      );
      throw error;
    }

    this.logger.log(
      `文档上传成功：documentId=${savedDocument.id}，knowledgeBaseId=${knowledgeBaseId}，fileSize=${file.size}`,
    );

    return DocumentResponseDto.fromEntity(savedDocument);
  }

  async findAll(
    knowledgeBaseId: number,
  ): Promise<DocumentResponseDto[]> {
    await this.assertKnowledgeBaseExists(knowledgeBaseId);

    // T04 MVP 暂不分页，id 用于相同创建时间下的稳定倒序。
    const documents = await this.documentRepository.find({
      where: { kbId: knowledgeBaseId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return documents.map(DocumentResponseDto.fromEntity);
  }

  async findOne(id: number): Promise<DocumentDetailResponseDto> {
    const document = await this.findDocumentEntity(id);
    const chunks = await this.chunkRepository.find({
      where: { documentId: id },
      order: { chunkIndex: 'ASC' },
      take: 20,
    });

    return DocumentDetailResponseDto.fromEntity(document, chunks);
  }

  async remove(id: number): Promise<void> {
    const document = await this.findDocumentEntity(id);

    try {
      await this.vectorStoreService.deleteByDocumentId(id);
    } catch (error: unknown) {
      this.logger.warn(
        `文档向量清理失败（不阻止删除）：documentId=${id}，${this.getErrorMessage(error)}`,
      );
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const deleteResult = await manager.delete(Document, { id });

        if (deleteResult.affected === 0) {
          throw new NotFoundException('文档不存在');
        }

        // affected 已能处理并发删除；GREATEST 只用于防御已有计数漂移。
        await manager
          .createQueryBuilder()
          .update(KnowledgeBase)
          .set({
            documentCount: () =>
              'GREATEST(document_count - 1, 0)',
          })
          .where('id = :knowledgeBaseId', {
            knowledgeBaseId: document.kbId,
          })
          .execute();
      });
    } catch (error: unknown) {
      if (!(error instanceof NotFoundException)) {
        this.logger.error(
          `文档删除事务失败：documentId=${id}，${this.getErrorMessage(error)}`,
        );
      }

      throw error;
    }

    await this.storageService.deleteByStoragePath(
      document.storagePath,
    );
    await this.parsedResultStore.remove(id);
  }

  private async assertKnowledgeBaseExists(
    knowledgeBaseId: number,
  ): Promise<void> {
    const knowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { id: knowledgeBaseId },
    });

    if (knowledgeBase === null) {
      throw new NotFoundException('知识库不存在');
    }
  }

  private async findDocumentEntity(id: number): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { id },
    });

    if (document === null) {
      throw new NotFoundException('文档不存在');
    }

    return document;
  }

  private async assertPdfHeader(filePath: string): Promise<void> {
    const fileHandle = await open(filePath, 'r');
    const header = Buffer.alloc(5);
    let bytesRead = 0;

    try {
      const result = await fileHandle.read(header, 0, header.length, 0);
      bytesRead = result.bytesRead;
    } finally {
      await fileHandle.close();
    }

    if (bytesRead !== header.length || header.toString('ascii') !== '%PDF-') {
      throw new UnsupportedMediaTypeException(
        '文件内容与扩展名不符',
      );
    }
  }

  private getFileExtension(
    file: Express.Multer.File,
  ): DocumentFileExtension {
    return extname(file.originalname)
      .slice(1)
      .toLowerCase() as DocumentFileExtension;
  }

  private createDuplicateFileException(
    document: Document,
  ): ConflictException {
    return new ConflictException({
      message: '同一知识库已存在相同文件',
      details: {
        id: document.id,
        fileName: document.fileName,
        status: document.status,
      },
    });
  }

  private isDuplicateEntryError(error: unknown): boolean {
    // 应用层预检存在并发窗口，uk_kb_hash 是最终一致性兜底。
    return this.hasDatabaseErrorCode(error, 'ER_DUP_ENTRY');
  }

  private isDeadlockError(error: unknown): boolean {
    return this.hasDatabaseErrorCode(error, 'ER_LOCK_DEADLOCK');
  }

  private hasDatabaseErrorCode(
    error: unknown,
    code: string,
  ): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === code
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
