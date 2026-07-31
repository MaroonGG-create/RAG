import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Document } from '../document/entities/document.entity';
import { DocumentStorageService } from '../document/storage/document-storage.service';
import { ProcessingModule } from '../processing/processing.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase, Document]),
    ProcessingModule,
    VectorStoreModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, DocumentStorageService],
})
export class KnowledgeBaseModule {}
