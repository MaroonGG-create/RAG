import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DocumentChunk } from '../document/entities/document-chunk.entity';
import { Document } from '../document/entities/document.entity';
import { EmbeddingClient } from './embedding-client';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, DocumentChunk])],
  providers: [EmbeddingClient, EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
