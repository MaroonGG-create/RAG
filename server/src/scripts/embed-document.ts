import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { EmbeddingService } from '../modules/embedding/embedding.service';

async function bootstrap(): Promise<void> {
  let app: INestApplicationContext | undefined;

  try {
    const documentId = parseDocumentId(process.argv[2]);
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const embeddingService = app.get(EmbeddingService);
    const result = await embeddingService.embedDocument(documentId);

    console.log(
      JSON.stringify({
        documentId: result.documentId,
        chunkCount: result.totalChunks,
        vectorDimension: result.vectorDimension,
        batchCount: result.batchCount,
      }),
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : '文档向量化失败';
    console.error(`向量化失败：${message}`);
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
