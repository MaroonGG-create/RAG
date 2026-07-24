import { Conversation } from '../modules/conversation/entities/conversation.entity';
import { MessageReference } from '../modules/conversation/entities/message-reference.entity';
import { Message } from '../modules/conversation/entities/message.entity';
import { DocumentChunk } from '../modules/document/entities/document-chunk.entity';
import { Document } from '../modules/document/entities/document.entity';
import { KnowledgeBase } from '../modules/knowledge-base/entities/knowledge-base.entity';

export const AppEntities = [
  KnowledgeBase,
  Document,
  DocumentChunk,
  Conversation,
  Message,
  MessageReference,
];
