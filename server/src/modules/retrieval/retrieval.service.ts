import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Document } from '../document/entities/document.entity';
import {
  EmbeddingFailure,
} from '../embedding/embedding.types';
import { EmbeddingService } from '../embedding/embedding.service';
import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { QdrantPayload } from '../vector-store/vector-store.types';
import {
  RetrievalResponseData,
  RetrievalResult,
} from './retrieval.types';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly defaultTopK: number;
  private readonly defaultScoreThreshold: number;

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
    configService: ConfigService,
  ) {
    this.defaultTopK = configService.getOrThrow<number>(
      'retrieval.topK',
    );
    this.defaultScoreThreshold = configService.getOrThrow<number>(
      'retrieval.scoreThreshold',
    );
  }

  async search(
    knowledgeBaseId: number,
    query: string,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<RetrievalResponseData> {
    const startedAt = Date.now();
    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      throw new BadRequestException('query 不能为空');
    }

    const knowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { id: knowledgeBaseId },
      select: ['id'],
    });

    if (knowledgeBase === null) {
      throw new NotFoundException('知识库不存在');
    }

    const validDocumentIds =
      await this.findCompletedDocumentIds(knowledgeBaseId);

    if (validDocumentIds.size === 0) {
      const took = Date.now() - startedAt;
      this.logger.log(
        `知识库无已完成文档：kbId=${knowledgeBaseId}，提前返回空结果`,
      );
      return { results: [], total: 0, took };
    }

    const embeddingStartedAt = Date.now();
    let queryVector: number[];

    try {
      queryVector =
        await this.embeddingService.embedQuery(normalizedQuery);
    } catch (error: unknown) {
      this.logger.error(
        `检索失败-向量生成：kbId=${knowledgeBaseId}，${this.getFailureMessage(error)}`,
      );
      throw error;
    }

    const embeddingTook = Date.now() - embeddingStartedAt;
    const resolvedTopK = topK ?? this.defaultTopK;
    const resolvedScoreThreshold =
      scoreThreshold ?? this.defaultScoreThreshold;
    const searchStartedAt = Date.now();

    let rawResults: Awaited<
      ReturnType<VectorStoreService['search']>
    >;

    try {
      rawResults = await this.vectorStoreService.search(
        queryVector,
        knowledgeBaseId,
        resolvedTopK,
        resolvedScoreThreshold,
      );
    } catch (error: unknown) {
      this.logger.error(
        `检索失败-Qdrant搜索：kbId=${knowledgeBaseId}，${this.getFailureMessage(error)}`,
      );
      throw error;
    }

    const searchTook = Date.now() - searchStartedAt;
    const { results, invalidDocumentCount } = this.mapResults(
      rawResults,
      validDocumentIds,
    );
    const sortedResults = results.sort((a, b) => b.score - a.score);
    const took = Date.now() - startedAt;

    if (invalidDocumentCount > 0) {
      this.logger.warn(
        `检索结果过滤无效文档：kbId=${knowledgeBaseId}，过滤掉 ${invalidDocumentCount} 条`,
      );
    }

    if (sortedResults.length === 0) {
      this.logger.log(
        `检索无命中：kbId=${knowledgeBaseId}，query="${this.truncateQuery(normalizedQuery)}"，took=${took}ms`,
      );
    } else {
      this.logger.log(
        `检索完成：kbId=${knowledgeBaseId}，query="${this.truncateQuery(normalizedQuery)}"，resultCount=${sortedResults.length}，embeddingTook=${embeddingTook}ms，searchTook=${searchTook}ms，took=${took}ms`,
      );
    }

    return {
      results: sortedResults,
      total: sortedResults.length,
      took,
    };
  }

  private async findCompletedDocumentIds(
    knowledgeBaseId: number,
  ): Promise<Set<number>> {
    const documents = await this.documentRepository.find({
      where: { kbId: knowledgeBaseId, status: 'completed' },
      select: ['id'],
    });

    return new Set(documents.map((document) => document.id));
  }

  private mapResults(
    rawResults: Awaited<ReturnType<VectorStoreService['search']>>,
    validDocumentIds: Set<number>,
  ): {
    results: RetrievalResult[];
    invalidDocumentCount: number;
  } {
    const results: RetrievalResult[] = [];
    let invalidDocumentCount = 0;

    rawResults.forEach((point) => {
      const invalidField = this.getInvalidPayloadField(point.payload);

      if (invalidField !== null) {
        this.logger.warn(
          `检索结果 payload 校验失败，已跳过：pointId=${point.id}，缺失字段=${invalidField}`,
        );
        return;
      }

      if (!validDocumentIds.has(point.payload.documentId)) {
        invalidDocumentCount += 1;
        return;
      }

      results.push({
        chunkId: point.payload.chunkId,
        documentId: point.payload.documentId,
        documentName: point.payload.documentName,
        chunkIndex: point.payload.chunkIndex,
        pageNo: point.payload.pageNo,
        content: point.payload.content,
        score: point.score,
      });
    });

    return { results, invalidDocumentCount };
  }

  private getInvalidPayloadField(
    payload: QdrantPayload,
  ): string | null {
    if (typeof payload.chunkId !== 'number') {
      return 'chunkId';
    }
    if (typeof payload.knowledgeBaseId !== 'number') {
      return 'knowledgeBaseId';
    }
    if (typeof payload.documentId !== 'number') {
      return 'documentId';
    }
    if (typeof payload.documentName !== 'string') {
      return 'documentName';
    }
    if (typeof payload.chunkIndex !== 'number') {
      return 'chunkIndex';
    }
    if (
      payload.pageNo !== null &&
      typeof payload.pageNo !== 'number'
    ) {
      return 'pageNo';
    }
    if (typeof payload.content !== 'string') {
      return 'content';
    }

    return null;
  }

  private truncateQuery(query: string): string {
    return query.length > 50 ? `${query.slice(0, 50)}...` : query;
  }

  private getFailureMessage(error: unknown): string {
    if (error instanceof EmbeddingFailure) {
      return error.message;
    }

    return error instanceof Error ? error.message : '未知错误';
  }
}
