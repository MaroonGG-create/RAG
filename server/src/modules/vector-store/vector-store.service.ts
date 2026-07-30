import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Document } from '../document/entities/document.entity';
import { EmbeddedChunk } from '../embedding/embedding.types';
import { EmbeddingService } from '../embedding/embedding.service';
import { QdrantClientWrapper } from './qdrant-client-wrapper';
import {
  QdrantFilter,
  QdrantPoint,
  StoreResult,
  VectorStoreFailure,
} from './vector-store.types';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly inFlight = new Map<number, Promise<StoreResult>>();
  private readonly collection: string;
  private readonly embeddingDimension: number;
  private readonly upsertBatchSize: number;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantClient: QdrantClientWrapper,
    configService: ConfigService,
  ) {
    this.collection = configService.getOrThrow<string>(
      'qdrant.collection',
    );
    this.embeddingDimension = configService.getOrThrow<number>(
      'embedding.dimension',
    );
    this.upsertBatchSize = configService.getOrThrow<number>(
      'qdrant.upsertBatchSize',
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ensureCollection();
  }

  async storeDocument(documentId: number): Promise<StoreResult> {
    const existingTask = this.inFlight.get(documentId);

    if (existingTask !== undefined) {
      return existingTask;
    }

    const task = this.executeStoreDocument(documentId).finally(() => {
      this.inFlight.delete(documentId);
    });
    this.inFlight.set(documentId, task);

    return task;
  }

  async deleteByDocumentId(documentId: number): Promise<void> {
    await this.qdrantClient.deleteByFilter(
      this.createDocumentFilter(documentId),
    );
  }

  async deleteByKnowledgeBaseId(
    knowledgeBaseId: number,
  ): Promise<void> {
    await this.qdrantClient.deleteByFilter(
      this.createKnowledgeBaseFilter(knowledgeBaseId),
    );
  }

  private async ensureCollection(): Promise<void> {
    if (this.qdrantClient.isMockEnabled()) {
      this.logger.log('[MOCK] Qdrant Collection 自举跳过');
      return;
    }

    const exists = await this.qdrantClient.collectionExists();

    if (!exists) {
      await this.qdrantClient.createCollection(
        this.embeddingDimension,
        'Cosine',
      );
      await this.ensurePayloadIndexes();
      this.logger.log(
        `Qdrant Collection 已创建：collection=${this.collection}，dimension=${this.embeddingDimension}，distance=Cosine`,
      );
      return;
    }

    const vectorConfig = await this.qdrantClient.getCollection();

    if (vectorConfig.size !== this.embeddingDimension) {
      throw new VectorStoreFailure(
        `Qdrant Collection 维度不匹配：expected=${this.embeddingDimension}, actual=${vectorConfig.size}。请删除 Collection 重建或修改 EMBEDDING_DIMENSION 配置。`,
      );
    }

    if (vectorConfig.distance !== 'Cosine') {
      throw new VectorStoreFailure(
        `Qdrant Collection 距离算法不匹配：expected=Cosine, actual=${vectorConfig.distance}。`,
      );
    }

    await this.ensurePayloadIndexes();
    this.logger.log(
      `Qdrant Collection 已存在且配置匹配：collection=${this.collection}，dimension=${this.embeddingDimension}，distance=Cosine`,
    );
  }

  private async ensurePayloadIndexes(): Promise<void> {
    await this.qdrantClient.createFieldIndex(
      'knowledgeBaseId',
      'integer',
    );
    await this.qdrantClient.createFieldIndex('documentId', 'integer');
  }

  private async executeStoreDocument(
    documentId: number,
  ): Promise<StoreResult> {
    const startedAt = Date.now();
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });

    if (document === null) {
      throw new NotFoundException('文档不存在');
    }

    this.assertCanStore(document.status);

    try {
      await this.deleteByDocumentId(documentId);

      const embeddingResult =
        await this.embeddingService.embedDocument(documentId);
      const chunks = embeddingResult.chunks;

      if (chunks.length === 0) {
        throw new VectorStoreFailure('文档向量结果为空');
      }

      this.assertEmbeddingResult(documentId, chunks);

      const points = chunks.map((chunk) =>
        this.createPoint(chunk, document.fileName),
      );

      for (
        let start = 0;
        start < points.length;
        start += this.upsertBatchSize
      ) {
        await this.qdrantClient.upsertPoints(
          points.slice(start, start + this.upsertBatchSize),
        );
      }

      const vectorCount = await this.qdrantClient.countPoints(
        this.createDocumentFilter(documentId),
      );

      if (vectorCount !== points.length) {
        throw new VectorStoreFailure(
          `Qdrant 写入数量不一致：expected=${points.length}，actual=${vectorCount}`,
        );
      }

      await this.documentRepository.update(documentId, {
        status: 'completed',
        errorMessage: null,
      });

      this.logger.log(
        `文档向量写入完成：documentId=${documentId}，chunkCount=${chunks.length}，vectorCount=${vectorCount}，collection=${this.collection}，耗时=${Date.now() - startedAt}ms`,
      );

      return {
        documentId,
        chunkCount: chunks.length,
        vectorCount,
        collectionName: this.collection,
      };
    } catch (error: unknown) {
      const message = this.getFailureMessage(error);
      await this.cleanupFailedVectors(documentId);
      await this.markDocumentFailed(documentId, message);
      this.logger.error(
        `文档向量写入失败：documentId=${documentId}，${message}`,
      );
      throw new VectorStoreFailure(message);
    }
  }

  private assertCanStore(status: Document['status']): void {
    if (status === 'completed') {
      throw new VectorStoreFailure(
        '文档已完成向量写入，禁止重复存储',
      );
    }
  }

  private assertEmbeddingResult(
    documentId: number,
    chunks: EmbeddedChunk[],
  ): void {
    chunks.forEach((chunk, index) => {
      if (chunk.documentId !== documentId) {
        throw new VectorStoreFailure(
          `Embedding 结果文档不匹配：expected=${documentId}，actual=${chunk.documentId}`,
        );
      }

      if (chunk.chunkIndex !== index) {
        throw new VectorStoreFailure(
          `Embedding 结果 chunkIndex 不连续：index=${index}，actual=${chunk.chunkIndex}`,
        );
      }

      if (chunk.vector.length !== this.embeddingDimension) {
        throw new VectorStoreFailure(
          `Embedding 向量维度不一致：chunkIndex=${chunk.chunkIndex}，expected=${this.embeddingDimension}，actual=${chunk.vector.length}`,
        );
      }
    });
  }

  private createPoint(
    chunk: EmbeddedChunk,
    documentName: string,
  ): QdrantPoint {
    return {
      id: chunk.qdrantPointId,
      vector: chunk.vector,
      payload: {
        chunkId: chunk.chunkId,
        knowledgeBaseId: chunk.kbId,
        documentId: chunk.documentId,
        documentName,
        chunkIndex: chunk.chunkIndex,
        pageNo: chunk.pageNo,
        content: chunk.content,
      },
    };
  }

  private createDocumentFilter(documentId: number): QdrantFilter {
    return {
      must: [{ key: 'documentId', match: { value: documentId } }],
    };
  }

  private createKnowledgeBaseFilter(
    knowledgeBaseId: number,
  ): QdrantFilter {
    return {
      must: [
        { key: 'knowledgeBaseId', match: { value: knowledgeBaseId } },
      ],
    };
  }

  private async cleanupFailedVectors(
    documentId: number,
  ): Promise<void> {
    try {
      await this.deleteByDocumentId(documentId);
    } catch (error: unknown) {
      this.logger.warn(
        `向量写入失败补偿清理失败：documentId=${documentId}，${this.getFailureMessage(error)}`,
      );
    }
  }

  private async markDocumentFailed(
    documentId: number,
    message: string,
  ): Promise<void> {
    try {
      await this.documentRepository.update(documentId, {
        status: 'failed',
        errorMessage: message,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `向量写入失败状态落库失败：documentId=${documentId}，${this.getFailureMessage(error)}`,
      );
    }
  }

  private getFailureMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : '未知错误';
    return message.slice(0, 300);
  }
}
