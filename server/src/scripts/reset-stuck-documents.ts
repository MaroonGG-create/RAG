import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In, Repository } from 'typeorm';

import { AppModule } from '../app.module';
import {
  Document,
  DocumentStatus,
} from '../modules/document/entities/document.entity';

const STUCK_STATUSES: DocumentStatus[] = [
  'parsing',
  'chunking',
  'embedding',
];

type ResetMode = 'knowledgeBase' | 'document';

interface ResetDocumentSummary {
  id: number;
  kbId: number;
  fileName: string;
  previousStatus: DocumentStatus;
}

async function bootstrap(): Promise<void> {
  let app: INestApplicationContext | undefined;

  try {
    const mode = resolveMode(process.env.npm_lifecycle_event);
    const targetId = parsePositiveInt(process.argv[2], mode);
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const dataSource = app.get(DataSource);
    const documentRepository = dataSource.getRepository(Document);
    const documents = await findStuckDocuments(
      documentRepository,
      mode,
      targetId,
    );
    const summaries = documents.map(toSummary);

    if (documents.length > 0) {
      await documentRepository.update(
        { id: In(documents.map((document) => document.id)) },
        { status: 'pending', errorMessage: null },
      );
    }

    console.log(
      JSON.stringify({
        mode,
        targetId,
        resetCount: summaries.length,
        documents: summaries,
      }),
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : '重置卡住文档失败';
    console.error(`重置卡住文档失败：${message}`);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

function resolveMode(lifecycleEvent: string | undefined): ResetMode {
  return lifecycleEvent === 'reset:documents'
    ? 'knowledgeBase'
    : 'document';
}

function parsePositiveInt(
  raw: string | undefined,
  mode: ResetMode,
): number {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      mode === 'knowledgeBase'
        ? 'knowledgeBaseId 必须是正整数'
        : 'documentId 必须是正整数',
    );
  }

  const id = Number(raw);

  if (!Number.isSafeInteger(id)) {
    throw new Error('id 超出安全整数范围');
  }

  return id;
}

async function findStuckDocuments(
  documentRepository: Repository<Document>,
  mode: ResetMode,
  targetId: number,
): Promise<Document[]> {
  const baseWhere = {
    status: In(STUCK_STATUSES),
  };

  return documentRepository.find({
    where:
      mode === 'knowledgeBase'
        ? { ...baseWhere, kbId: targetId }
        : { ...baseWhere, id: targetId },
    select: ['id', 'kbId', 'fileName', 'status'],
    order: { id: 'ASC' },
  });
}

function toSummary(document: Document): ResetDocumentSummary {
  return {
    id: document.id,
    kbId: document.kbId,
    fileName: document.fileName,
    previousStatus: document.status,
  };
}

void bootstrap();
