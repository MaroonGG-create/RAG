import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { Document } from './entities/document.entity';
import { KnowledgeBaseDocumentsController } from './knowledge-base-documents.controller';
import { DocumentStorageService } from './storage/document-storage.service';
import { createDocumentUploadOptions } from './storage/document-upload.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, KnowledgeBase]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createDocumentUploadOptions,
    }),
  ],
  controllers: [
    KnowledgeBaseDocumentsController,
    DocumentController,
  ],
  providers: [DocumentService, DocumentStorageService],
})
export class DocumentModule {}
