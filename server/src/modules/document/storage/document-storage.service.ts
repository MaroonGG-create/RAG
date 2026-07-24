import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  copyFile,
  mkdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly uploadDir: string;

  constructor(configService: ConfigService) {
    this.uploadDir = configService.getOrThrow<string>('upload.dir');
  }

  async moveTemporaryFile(
    temporaryFilePath: string,
    knowledgeBaseId: number,
  ): Promise<string> {
    const storedFileName = basename(temporaryFilePath);
    const storagePath = `${knowledgeBaseId}/${storedFileName}`;
    const knowledgeBaseDir = join(
      this.uploadDir,
      String(knowledgeBaseId),
    );
    const finalFilePath = join(this.uploadDir, storagePath);

    await mkdir(knowledgeBaseDir, { recursive: true });

    try {
      await rename(temporaryFilePath, finalFilePath);
    } catch (error: unknown) {
      if (!this.hasErrorCode(error, 'EXDEV')) {
        throw error;
      }

      // 跨设备时 rename 不可用，复制完成后再删除源文件以模拟移动。
      try {
        await copyFile(temporaryFilePath, finalFilePath);
        await unlink(temporaryFilePath);
      } catch (fallbackError: unknown) {
        await this.deleteFileQuietly(finalFilePath, storagePath);
        throw fallbackError;
      }
    }

    return storagePath;
  }

  async cleanupTemporaryFile(temporaryFilePath: string): Promise<void> {
    try {
      await unlink(temporaryFilePath);
    } catch (error: unknown) {
      if (this.hasErrorCode(error, 'ENOENT')) {
        return;
      }

      this.logger.warn(
        `临时文件清理失败：.tmp/${basename(temporaryFilePath)}，${this.getErrorMessage(error)}`,
      );
    }
  }

  async deleteByStoragePath(storagePath: string): Promise<void> {
    const absolutePath = join(this.uploadDir, storagePath);

    try {
      await unlink(absolutePath);
    } catch (error: unknown) {
      this.logger.warn(
        `存储文件删除失败：${storagePath}，${this.getErrorMessage(error)}`,
      );
    }
  }

  private async deleteFileQuietly(
    absolutePath: string,
    storagePath: string,
  ): Promise<void> {
    try {
      await unlink(absolutePath);
    } catch (error: unknown) {
      if (this.hasErrorCode(error, 'ENOENT')) {
        return;
      }

      this.logger.warn(
        `补偿文件清理失败：${storagePath}，${this.getErrorMessage(error)}`,
      );
    }
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
