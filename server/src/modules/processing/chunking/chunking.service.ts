import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';

import { DocumentChunk } from '../../document/entities/document-chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../../document/entities/document.entity';
import {
  ParsedDocument,
  ParsedPage,
} from '../parsing/parsed-document.types';
import { ParsedResultStore } from '../parsing/parsed-result.store';
import { ChunkFailure, ChunkResult, PreparedChunk } from './chunk.types';
import { cleanText } from './text-cleaner';
import { splitText } from './text-splitter';

const CHUNK_INSERT_BATCH_SIZE = 500;

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);
  private readonly inFlight = new Map<number, Promise<ChunkResult>>();
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly parsedDir: string;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private readonly chunkRepository: Repository<DocumentChunk>,
    private readonly dataSource: DataSource,
    private readonly parsedResultStore: ParsedResultStore,
    configService: ConfigService,
  ) {
    this.chunkSize = configService.getOrThrow<number>('chunk.size');
    this.chunkOverlap =
      configService.getOrThrow<number>('chunk.overlap');
    this.parsedDir = join(
      configService.getOrThrow<string>('upload.dir'),
      '.parsed',
    );
  }

  async chunkDocument(documentId: number): Promise<ChunkResult> {
    const existingTask = this.inFlight.get(documentId);

    if (existingTask !== undefined) {
      return existingTask;
    }

    const task = this.executeChunkDocument(documentId).finally(() => {
      this.inFlight.delete(documentId);
    });
    this.inFlight.set(documentId, task);

    return task;
  }

  private async executeChunkDocument(
    documentId: number,
  ): Promise<ChunkResult> {
    const startedAt = Date.now();
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });

    if (document === null) {
      throw new NotFoundException('文档不存在');
    }

    this.assertCanChunk(document.status);

    if (document.status === 'chunking' && document.chunkCount > 0) {
      const totalChars = await this.getExistingTotalChars(documentId);
      this.logger.log(
        `切片幂等短路：documentId=${documentId}，chunkCount=${document.chunkCount}`,
      );
      return {
        documentId,
        chunkCount: document.chunkCount,
        totalChars,
      };
    }

    try {
      await this.documentRepository.update(documentId, {
        status: 'chunking',
        errorMessage: null,
      });

      const parsedDocument = await this.readParsedDocument(document);
      const chunks = this.createChunks(parsedDocument);

      if (chunks.length === 0) {
        throw new ChunkFailure('清洗后无可切片内容');
      }

      await this.saveChunks(document, chunks);

      const totalChars = chunks.reduce(
        (sum, chunk) => sum + chunk.charCount,
        0,
      );

      this.logger.log(
        `文档切片成功：documentId=${documentId}，chunkCount=${chunks.length}，totalChars=${totalChars}，耗时=${Date.now() - startedAt}ms`,
      );

      return {
        documentId,
        chunkCount: chunks.length,
        totalChars,
      };
    } catch (error: unknown) {
      const message = this.getFailureMessage(error);
      await this.cleanupFailedChunks(documentId);
      await this.markDocumentFailed(documentId, message);
      this.logger.error(
        `文档切片失败：documentId=${documentId}，${message}`,
      );
      throw new ChunkFailure(message);
    }
  }

  private assertCanChunk(status: DocumentStatus): void {
    if (status === 'embedding' || status === 'completed') {
      throw new ChunkFailure('文档已进入后续处理阶段，禁止重复切片');
    }
  }

  private async readParsedDocument(
    document: Document,
  ): Promise<ParsedDocument> {
    const parsedDocument = await this.parsedResultStore.read(
      document.id,
    );

    if (parsedDocument === null) {
      const parsedFileExists = await this.parsedFileExists(document.id);
      throw new ChunkFailure(
        parsedFileExists
          ? '解析结果损坏，请重新解析'
          : '文档尚未解析或解析结果已丢失，请先执行 pnpm --filter server parse:document <id>',
      );
    }

    if (!this.isParsedDocument(parsedDocument)) {
      throw new ChunkFailure('解析结果损坏，请重新解析');
    }

    if (parsedDocument.documentId !== document.id) {
      throw new ChunkFailure('解析结果损坏，请重新解析');
    }

    if (parsedDocument.fileHash !== document.fileHash) {
      throw new ChunkFailure('解析结果与文档不匹配，请重新解析');
    }

    return parsedDocument;
  }

  private createChunks(parsedDocument: ParsedDocument): PreparedChunk[] {
    const chunks: PreparedChunk[] = [];

    for (const page of parsedDocument.pages) {
      const cleanedText = cleanText(page.text);

      if (cleanedText.length === 0) {
        continue;
      }

      // PDF 不跨页切分，保证每个 chunk 只有一个明确 pageNo。
      const pageChunks = splitText(
        cleanedText,
        this.chunkSize,
        this.chunkOverlap,
      );

      for (const content of pageChunks) {
        if (content.length === 0) {
          continue;
        }

        chunks.push({
          chunkIndex: chunks.length,
          content,
          charCount: content.length,
          pageNo: page.pageNo,
          qdrantPointId: randomUUID(),
        });
      }
    }

    return chunks;
  }

  private async saveChunks(
    document: Document,
    chunks: PreparedChunk[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(DocumentChunk, { documentId: document.id });

      for (
        let start = 0;
        start < chunks.length;
        start += CHUNK_INSERT_BATCH_SIZE
      ) {
        const batch = chunks
          .slice(start, start + CHUNK_INSERT_BATCH_SIZE)
          .map((chunk) =>
            manager.create(DocumentChunk, {
              documentId: document.id,
              kbId: document.kbId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              charCount: chunk.charCount,
              pageNo: chunk.pageNo,
              qdrantPointId: chunk.qdrantPointId,
            }),
          );

        await manager.save(DocumentChunk, batch);
      }

      await manager.update(Document, document.id, {
        status: 'chunking',
        errorMessage: null,
        chunkCount: chunks.length,
      });
    });
  }

  private async getExistingTotalChars(
    documentId: number,
  ): Promise<number> {
    const chunks = await this.chunkRepository.find({
      select: ['charCount'],
      where: { documentId },
    });

    return chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  }

  private async cleanupFailedChunks(documentId: number): Promise<void> {
    try {
      await this.chunkRepository.delete({ documentId });
    } catch (error: unknown) {
      this.logger.warn(
        `切片失败清理残留失败：documentId=${documentId}，${this.getFailureMessage(error)}`,
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
        chunkCount: 0,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `切片失败状态落库失败：documentId=${documentId}，${this.getFailureMessage(error)}`,
      );
    }
  }

  private async parsedFileExists(documentId: number): Promise<boolean> {
    try {
      await access(join(this.parsedDir, `${documentId}.json`));
      return true;
    } catch {
      return false;
    }
  }

  private isParsedDocument(value: unknown): value is ParsedDocument {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ParsedDocument>;

    return (
      typeof candidate.documentId === 'number' &&
      typeof candidate.fileHash === 'string' &&
      Array.isArray(candidate.pages) &&
      candidate.pages.every((page) => this.isParsedPage(page))
    );
  }

  private isParsedPage(value: unknown): value is ParsedPage {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ParsedPage>;

    return (
      typeof candidate.text === 'string' &&
      (candidate.pageNo === null ||
        typeof candidate.pageNo === 'number')
    );
  }

  private getFailureMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : '未知错误';
    return message.slice(0, 300);
  }
}
