import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import {
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { Repository } from 'typeorm';

import { Document } from '../../document/entities/document.entity';
import { decodePlainText } from './plain-text.parser';
import {
  ParsedDocument,
  ParsedPage,
  ParseFailure,
} from './parsed-document.types';
import {
  parsePdfPages,
  PDF_PARSER_VERSION,
} from './pdf.parser';
import { ParsedResultStore } from './parsed-result.store';

@Injectable()
export class ParsingService {
  private readonly logger = new Logger(ParsingService.name);
  private readonly uploadDir: string;
  private readonly inFlight = new Map<number, Promise<ParsedDocument>>();

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    configService: ConfigService,
    private readonly parsedResultStore: ParsedResultStore,
  ) {
    this.uploadDir = configService.getOrThrow<string>('upload.dir');
  }

  parseDocument(documentId: number): Promise<ParsedDocument> {
    const running = this.inFlight.get(documentId);

    if (running !== undefined) {
      return running;
    }

    const task = this.parseDocumentInternal(documentId).finally(() => {
      this.inFlight.delete(documentId);
    });
    this.inFlight.set(documentId, task);

    return task;
  }

  private async parseDocumentInternal(
    documentId: number,
  ): Promise<ParsedDocument> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });

    if (document === null) {
      throw new NotFoundException('文档不存在');
    }

    if (this.isLaterPipelineStatus(document.status)) {
      // T05 成功态仍回到 pending；后续流水线状态由 T06+ 管理，误调用时必须拒绝覆盖。
      throw new ParseFailure('文档已进入后续处理阶段，禁止重复解析');
    }

    const stored = await this.parsedResultStore.read(document.id);

    if (stored !== null && stored.fileHash === document.fileHash) {
      return stored;
    }

    try {
      await this.documentRepository.update(document.id, {
        status: 'parsing',
        errorMessage: null,
      });

      const absolutePath = this.resolveStoragePath(document.storagePath);
      const pages = await this.parseByExtension(document, absolutePath);
      const totalChars = pages.reduce(
        (sum, page) => sum + page.text.length,
        0,
      );

      if (document.fileExt === 'pdf' && totalChars === 0) {
        throw new ParseFailure(
          '未能提取到文本内容，可能是扫描件，当前版本不支持 OCR',
        );
      }

      const parsedDocument: ParsedDocument = {
        documentId: document.id,
        fileExt: this.getSupportedFileExt(document.fileExt),
        parser: document.fileExt === 'pdf' ? 'pdfjs' : 'plaintext',
        parserVersion:
          document.fileExt === 'pdf' ? PDF_PARSER_VERSION : 'builtin',
        fileHash: document.fileHash,
        parsedAt: new Date().toISOString(),
        pages,
        totalChars,
      };

      await this.parsedResultStore.write(parsedDocument);
      // T05 不进入 chunking/completed；pending 在 T05 后表示“已解析，待 T06 切片”。
      await this.documentRepository.update(document.id, {
        status: 'pending',
        errorMessage: null,
      });

      this.logger.log(
        `文档解析成功：documentId=${document.id}，fileExt=${document.fileExt}，totalChars=${totalChars}`,
      );

      return parsedDocument;
    } catch (error: unknown) {
      const errorMessage = this.summarizeError(
        error,
        document.storagePath,
      );

      await this.documentRepository.update(document.id, {
        status: 'failed',
        errorMessage,
      });

      this.logger.warn(
        `文档解析失败：documentId=${document.id}，${errorMessage}`,
      );

      throw new ParseFailure(errorMessage);
    }
  }

  private async parseByExtension(
    document: Document,
    absolutePath: string,
  ): Promise<ParsedPage[]> {
    try {
      if (document.fileExt === 'pdf') {
        return parsePdfPages(absolutePath);
      }

      if (document.fileExt === 'md' || document.fileExt === 'txt') {
        const text = decodePlainText(await readFile(absolutePath));
        return [{ pageNo: null, text }];
      }

      throw new ParseFailure('不支持的文件类型');
    } catch (error: unknown) {
      if (this.hasErrorCode(error, 'ENOENT')) {
        throw new ParseFailure(
          `文件不存在或已被移动：${document.storagePath}`,
        );
      }

      throw error;
    }
  }

  private resolveStoragePath(storagePath: string): string {
    if (isAbsolute(storagePath)) {
      throw new ParseFailure(`文件路径越界：${storagePath}`);
    }

    const absolutePath = resolve(this.uploadDir, storagePath);
    const relativePath = relative(this.uploadDir, absolutePath);

    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      throw new ParseFailure(`文件路径越界：${storagePath}`);
    }

    return absolutePath;
  }

  private getSupportedFileExt(fileExt: string): ParsedDocument['fileExt'] {
    if (fileExt === 'pdf' || fileExt === 'md' || fileExt === 'txt') {
      return fileExt;
    }

    throw new ParseFailure('不支持的文件类型');
  }

  private isLaterPipelineStatus(status: string): boolean {
    return (
      status === 'chunking' ||
      status === 'embedding' ||
      status === 'completed'
    );
  }

  private summarizeError(error: unknown, storagePath: string): string {
    const message =
      error instanceof Error ? error.message : '文档解析失败';
    const withoutAbsoluteUploadDir = message.replaceAll(
      this.uploadDir,
      storagePath,
    );

    return withoutAbsoluteUploadDir.slice(0, 300);
  }

  private hasErrorCode(error: unknown, code: string): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      error.code === code
    );
  }
}
