import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Document } from '../document/entities/document.entity';
import { EmbeddingModule } from '../embedding/embedding.module';
import { QdrantClientWrapper } from './qdrant-client-wrapper';
import { VectorStoreService } from './vector-store.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document]), EmbeddingModule],
  providers: [QdrantClientWrapper, VectorStoreService],
  exports: [VectorStoreService],
})
export class VectorStoreModule {}
