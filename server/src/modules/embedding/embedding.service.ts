import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentChunk } from '../document/entities/document-chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../document/entities/document.entity';
import { EmbeddingClient } from './embedding-client';
import {
  EmbeddedChunk,
  EmbeddingFailure,
  EmbeddingResult,
} from './embedding.types';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly inFlight = new Map<number, Promise<EmbeddingResult>>();
  private readonly batchSize: number;
  private readonly dimension: number;
  private readonly mock: boolean;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private readonly chunkRepository: Repository<DocumentChunk>,
    private readonly embeddingClient: EmbeddingClient,
    configService: ConfigService,
  ) {
    this.batchSize = configService.getOrThrow<number>(
      'embedding.batchSize',
    );
    this.dimension = configService.getOrThrow<number>(
      'embedding.dimension',
    );
    this.mock = configService.getOrThrow<boolean>('embedding.mock');
  }

  async embedDocument(documentId: number): Promise<EmbeddingResult> {
    const existingTask = this.inFlight.get(documentId);

    if (existingTask !== undefined) {
      return existingTask;
    }

    const task = this.executeEmbedDocument(documentId).finally(() => {
      this.inFlight.delete(documentId);
    });
    this.inFlight.set(documentId, task);

    return task;
  }

  private async executeEmbedDocument(
    documentId: number,
  ): Promise<EmbeddingResult> {
    const startedAt = Date.now();
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });

    if (document === null) {
      throw new NotFoundException('文档不存在');
    }

    this.assertCanEmbed(document.status);

    try {
      await this.documentRepository.update(documentId, {
        status: 'embedding',
        errorMessage: null,
      });

      const chunks = await this.chunkRepository.find({
        where: { documentId },
        order: { chunkIndex: 'ASC' },
      });

      if (chunks.length === 0) {
        throw new EmbeddingFailure(
          '文档尚未切片或切片为空，请先执行 pnpm --filter server chunk:document <id>',
        );
      }

      const embeddedChunks: EmbeddedChunk[] = [];
      const batches = this.createBatches(chunks);

      for (const batch of batches) {
        const vectors = await this.embeddingClient.embed(
          batch.map((chunk) => chunk.content),
        );
        this.assertVectorBatch(vectors, batch.length);

        batch.forEach((chunk, index) => {
          embeddedChunks.push({
            chunkId: chunk.id,
            chunkIndex: chunk.chunkIndex,
            qdrantPointId: chunk.qdrantPointId,
            content: chunk.content,
            charCount: chunk.charCount,
            pageNo: chunk.pageNo,
            kbId: chunk.kbId,
            documentId: chunk.documentId,
            vector: vectors[index],
          });
        });
      }

      this.logger.log(
        `${this.mock ? '[MOCK] ' : ''}文档向量化完成：documentId=${documentId}，chunkCount=${embeddedChunks.length}，batchCount=${batches.length}，dimension=${this.dimension}，耗时=${Date.now() - startedAt}ms`,
      );

      return {
        documentId,
        chunks: embeddedChunks,
        totalChunks: embeddedChunks.length,
        vectorDimension: this.dimension,
        batchCount: batches.length,
      };
    } catch (error: unknown) {
      const message = this.getFailureMessage(error);
      await this.markDocumentFailed(documentId, message);
      this.logger.error(
        `文档向量化失败：documentId=${documentId}，${message}`,
      );
      throw new EmbeddingFailure(message);
    }
  }

  private assertCanEmbed(status: DocumentStatus): void {
    if (status === 'completed') {
      throw new EmbeddingFailure('文档已完成向量化，禁止重复嵌入');
    }
  }

  private createBatches(chunks: DocumentChunk[]): DocumentChunk[][] {
    const batches: DocumentChunk[][] = [];

    for (let start = 0; start < chunks.length; start += this.batchSize) {
      batches.push(chunks.slice(start, start + this.batchSize));
    }

    return batches;
  }

  private assertVectorBatch(
    vectors: number[][],
    expectedCount: number,
  ): void {
    if (vectors.length !== expectedCount) {
      throw new EmbeddingFailure(
        `Embedding 返回数量不一致：expected=${expectedCount}，actual=${vectors.length}`,
      );
    }

    vectors.forEach((vector, index) => {
      if (vector.length !== this.dimension) {
        throw new EmbeddingFailure(
          `Embedding 维度不一致：index=${index}，expected=${this.dimension}，actual=${vector.length}`,
        );
      }

      if (!vector.every((value) => Number.isFinite(value))) {
        throw new EmbeddingFailure(
          `Embedding 向量包含非有限数值：index=${index}`,
        );
      }
    });
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
        `向量化失败状态落库失败：documentId=${documentId}，${this.getFailureMessage(error)}`,
      );
    }
  }

  private getFailureMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : '未知错误';
    return message.slice(0, 300);
  }
}
