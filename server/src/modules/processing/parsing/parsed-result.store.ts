import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { ParsedDocument } from './parsed-document.types';

@Injectable()
export class ParsedResultStore {
  private readonly logger = new Logger(ParsedResultStore.name);
  private readonly parsedDir: string;

  constructor(configService: ConfigService) {
    this.parsedDir = join(
      configService.getOrThrow<string>('upload.dir'),
      '.parsed',
    );
  }

  async read(documentId: number): Promise<ParsedDocument | null> {
    try {
      const raw = await readFile(this.getPath(documentId), 'utf8');
      return JSON.parse(raw) as ParsedDocument;
    } catch (error: unknown) {
      if (this.hasErrorCode(error, 'ENOENT')) {
        return null;
      }

      this.logger.warn(
        `解析暂存读取失败：documentId=${documentId}，${this.getErrorMessage(error)}`,
      );
      return null;
    }
  }

  async write(document: ParsedDocument): Promise<void> {
    await mkdir(this.parsedDir, { recursive: true });

    const finalPath = this.getPath(document.documentId);
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;
    const payload = `${JSON.stringify(document, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, payload, 'utf8');
      await rename(temporaryPath, finalPath);
    } catch (error: unknown) {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (!this.hasErrorCode(cleanupError, 'ENOENT')) {
          this.logger.warn(
            `解析暂存临时文件清理失败：documentId=${document.documentId}，${this.getErrorMessage(cleanupError)}`,
          );
        }
      });

      throw error;
    }
  }

  async remove(documentId: number): Promise<void> {
    try {
      await unlink(this.getPath(documentId));
    } catch (error: unknown) {
      if (this.hasErrorCode(error, 'ENOENT')) {
        return;
      }

      this.logger.warn(
        `解析暂存删除失败：documentId=${documentId}，${this.getErrorMessage(error)}`,
      );
    }
  }

  private getPath(documentId: number): string {
    return join(this.parsedDir, `${documentId}.json`);
  }

  private hasErrorCode(error: unknown, code: string): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      error.code === code
    );
  }

  private getErrorMessage(error: unknown): string {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }

    return error instanceof Error ? error.name : '未知错误';
  }
}
