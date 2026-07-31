import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';

import configuration from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { TypeOrmConfigService } from './database/typeorm.config';
import { ChatModule } from './modules/chat/chat.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { DocumentModule } from './modules/document/document.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { HealthModule } from './modules/health/health.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { LlmModule } from './modules/llm/llm.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { RagModule } from './modules/rag/rag.module';
import { RetrievalModule } from './modules/retrieval/retrieval.module';
import { VectorStoreModule } from './modules/vector-store/vector-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../.env'),
      load: [configuration],
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useClass: TypeOrmConfigService,
    }),
    DatabaseModule,
    HealthModule,
    KnowledgeBaseModule,
    DocumentModule,
    ProcessingModule,
    EmbeddingModule,
    VectorStoreModule,
    RetrievalModule,
    LlmModule,
    RagModule,
    ConversationModule,
    ChatModule,
  ],
})
export class AppModule {}
