import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DocumentChunk } from '../document/entities/document-chunk.entity';
import { Document } from '../document/entities/document.entity';
import { ChunkingService } from './chunking/chunking.service';
import { ParsedResultStore } from './parsing/parsed-result.store';
import { ParsingService } from './parsing/parsing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, DocumentChunk])],
  providers: [ParsingService, ParsedResultStore, ChunkingService],
  exports: [ParsingService, ParsedResultStore, ChunkingService],
})
export class ProcessingModule {}
