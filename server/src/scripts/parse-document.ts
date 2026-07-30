import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { ParsingService } from '../modules/processing/parsing/parsing.service';

async function bootstrap(): Promise<void> {
  let app: INestApplicationContext | undefined;

  try {
    const documentId = parseDocumentId(process.argv[2]);
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const parsingService = app.get(ParsingService);
    const parsedDocument = await parsingService.parseDocument(documentId);

    console.log(
      JSON.stringify({
        documentId: parsedDocument.documentId,
        parser: parsedDocument.parser,
        pageCount: parsedDocument.pages.length,
        totalChars: parsedDocument.totalChars,
        parsedAt: parsedDocument.parsedAt,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '文档解析失败';
    console.error(`解析失败：${message}`);
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
