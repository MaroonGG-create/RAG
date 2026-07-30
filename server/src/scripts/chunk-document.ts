import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { ChunkingService } from '../modules/processing/chunking/chunking.service';

async function bootstrap(): Promise<void> {
  let app: INestApplicationContext | undefined;

  try {
    const documentId = parseDocumentId(process.argv[2]);
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const chunkingService = app.get(ChunkingService);
    const result = await chunkingService.chunkDocument(documentId);

    console.log(
      JSON.stringify({
        documentId: result.documentId,
        chunkCount: result.chunkCount,
        totalChars: result.totalChars,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '文档切片失败';
    console.error(`切片失败：${message}`);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

function parseDocumentId(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
    throw new Error('documentId 必须是正整数');
  }

  const documentId = Number(raw);

  if (!Number.isSafeInteger(documentId)) {
    throw new Error('documentId 超出安全整数范围');
  }

  return documentId;
}

void bootstrap();
