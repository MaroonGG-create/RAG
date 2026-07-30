import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Document } from '../document/entities/document.entity';
import { EmbeddingModule } from '../embedding/embedding.module';
import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase, Document]),
    EmbeddingModule,
    VectorStoreModule,
  ],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
