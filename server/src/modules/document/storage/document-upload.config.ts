import { Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModuleOptions } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { diskStorage } from 'multer';
import type { StorageEngine } from 'multer';

import { ParsePositiveIntPipe } from '../../../common/pipes/parse-positive-int.pipe';

export const DOCUMENT_UPLOAD_MIME_RULES: Readonly<
  Record<string, readonly string[]>
> = {
  '.pdf': ['application/pdf'],
  // Windows 浏览器常把 Markdown/TXT 上报为空或 octet-stream，文本内容留待 T05 校验。
  '.md': [
    'text/markdown',
    'text/plain',
    'application/octet-stream',
    '',
  ],
  '.txt': ['text/plain', 'application/octet-stream', ''],
};

const uploadLogger = new Logger('DocumentUploadStorage');

export function createDocumentUploadOptions(
  configService: ConfigService,
): MulterModuleOptions {
  const uploadDir = configService.getOrThrow<string>('upload.dir');
  const maxFileSizeMb = configService.getOrThrow<number>(
    'upload.maxFileSizeMb',
  );
  const temporaryDir = join(uploadDir, '.tmp');
  const temporaryFilePaths = new WeakMap<Express.Multer.File, string>();
  const storage = diskStorage({
    destination: (_request, _file, callback) => {
      void mkdir(temporaryDir, { recursive: true })
        .then(() => callback(null, temporaryDir))
        .catch(() =>
          callback(new Error('创建上传临时目录失败'), temporaryDir),
        );
    },
    filename: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase();
      const storedFileName = `${randomUUID()}${extension}`;
      temporaryFilePaths.set(file, join(temporaryDir, storedFileName));
      callback(null, storedFileName);
    },
  });

  return {
    storage: withWriteErrorCleanup(storage, temporaryFilePaths),
    limits: {
      fileSize: maxFileSizeMb * 1024 * 1024,
    },
    fileFilter: (request, file, callback) => {
      try {
        // Interceptor 先于参数 Pipe 执行，因此必须在落盘前复用同一规则，防止非法 kbId 遗留 tmp。
        new ParsePositiveIntPipe().transform(request.params.kbId);
      } catch (error: unknown) {
        callback(toError(error, 'id 必须是正整数'), false);
        return;
      }

      const extension = extname(file.originalname).toLowerCase();
      const allowedMimeTypes = DOCUMENT_UPLOAD_MIME_RULES[extension];

      if (
        allowedMimeTypes === undefined ||
        !allowedMimeTypes.includes(file.mimetype)
      ) {
        callback(
          new UnsupportedMediaTypeException('不支持的文件类型'),
          false,
        );
        return;
      }

      callback(null, true);
    },
  };
}

function withWriteErrorCleanup(
  storage: StorageEngine,
  temporaryFilePaths: WeakMap<Express.Multer.File, string>,
): StorageEngine {
  return {
    _handleFile: (request, file, callback) => {
      storage._handleFile(request, file, (error, info) => {
        const temporaryFilePath = temporaryFilePaths.get(file);
        temporaryFilePaths.delete(file);

        if (error === undefined || error === null) {
          callback(undefined, info);
          return;
        }

        if (temporaryFilePath === undefined) {
          callback(new Error('上传临时文件写入失败'));
          return;
        }

        // diskStorage 写入中途失败时不会主动删除半文件，这里在错误返回前补偿清理。
        void unlink(temporaryFilePath)
          .catch((cleanupError: unknown) => {
            if (!hasErrorCode(cleanupError, 'ENOENT')) {
              uploadLogger.warn(
                `临时文件写入失败后清理失败：.tmp/${basename(temporaryFilePath)}，${getErrorSummary(cleanupError)}`,
              );
            }
          })
          .finally(() => callback(new Error('上传临时文件写入失败')));
      });
    },
    _removeFile: (request, file, callback) => {
      storage._removeFile(request, file, callback);
    },
  };
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === code
  );
}

function getErrorSummary(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return error instanceof Error ? error.name : '未知错误';
}
