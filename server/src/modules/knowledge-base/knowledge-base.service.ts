import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { Document } from '../document/entities/document.entity';
import { DocumentStorageService } from '../document/storage/document-storage.service';
import { ParsedResultStore } from '../processing/parsing/parsed-result.store';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { KnowledgeBaseResponseDto } from './dto/knowledge-base-response.dto';
import { KnowledgeBase } from './entities/knowledge-base.entity';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly vectorStoreService: VectorStoreService,
    private readonly storageService: DocumentStorageService,
    private readonly parsedResultStore: ParsedResultStore,
  ) {}

  async create(
    dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseResponseDto> {
    const name = dto.name;
    const description = dto.description?.trim() || null;

    // utf8mb4_unicode_ci 不区分大小写，预检与 uk_name 的同名判定保持一致。
    const existingKnowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { name },
    });

    if (existingKnowledgeBase !== null) {
      throw new ConflictException('知识库名称已存在');
    }

    try {
      const savedKnowledgeBase = await this.knowledgeBaseRepository.save(
        this.knowledgeBaseRepository.create({ name, description }),
      );

      return KnowledgeBaseResponseDto.fromEntity(savedKnowledgeBase);
    } catch (error: unknown) {
      if (this.isDuplicateEntryError(error)) {
        throw new ConflictException('知识库名称已存在');
      }

      throw error;
    }
  }

  async findAll(): Promise<KnowledgeBaseResponseDto[]> {
    // T03 MVP 暂不分页，使用 id 作为同一创建时间下的稳定排序依据。
    const knowledgeBases = await this.knowledgeBaseRepository.find({
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return knowledgeBases.map(KnowledgeBaseResponseDto.fromEntity);
  }

  async findOne(id: number): Promise<KnowledgeBaseResponseDto> {
    const knowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { id },
    });

    if (knowledgeBase === null) {
      throw new NotFoundException('知识库不存在');
    }

    return KnowledgeBaseResponseDto.fromEntity(knowledgeBase);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    try {
      await this.vectorStoreService.deleteByKnowledgeBaseId(id);
    } catch (error: unknown) {
      this.logger.warn(
        `知识库向量清理失败（不阻止删除）：knowledgeBaseId=${id}，${this.getErrorMessage(error)}`,
      );
    }

    await this.cleanupKnowledgeBaseFiles(id);

    await this.knowledgeBaseRepository.delete(id);
  }

  private async cleanupKnowledgeBaseFiles(
    knowledgeBaseId: number,
  ): Promise<void> {
    const documents = await this.documentRepository.find({
      where: { kbId: knowledgeBaseId },
      select: ['id', 'storagePath'],
    });

    for (const document of documents) {
      try {
        await this.storageService.deleteByStoragePath(
          document.storagePath,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `知识库文件清理失败（不阻止删除）：knowledgeBaseId=${knowledgeBaseId}，documentId=${document.id}，${this.getErrorMessage(error)}`,
        );
      }

      try {
        await this.parsedResultStore.remove(document.id);
      } catch (error: unknown) {
        this.logger.warn(
          `知识库解析缓存清理失败（不阻止删除）：knowledgeBaseId=${knowledgeBaseId}，documentId=${document.id}，${this.getErrorMessage(error)}`,
        );
      }
    }

    try {
      await this.storageService.deleteKnowledgeBaseDirectory(
        knowledgeBaseId,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `知识库目录清理失败（不阻止删除）：knowledgeBaseId=${knowledgeBaseId}，${this.getErrorMessage(error)}`,
      );
    }
  }

  private isDuplicateEntryError(error: unknown): boolean {
    // 预检存在并发窗口，数据库唯一约束是最终兜底。
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
