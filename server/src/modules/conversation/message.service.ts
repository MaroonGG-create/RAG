import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';

import { Conversation } from './entities/conversation.entity';
import { MessageReference } from './entities/message-reference.entity';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity';

export interface SaveMessageInput {
  conversationId: number;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  errorMessage: string | null;
}

export interface SaveMessageReferenceInput {
  chunkId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
  pageNo: number | null;
  content: string;
  score: number;
}

@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(MessageReference)
    private readonly referenceRepository: Repository<MessageReference>,
    private readonly dataSource: DataSource,
  ) {}

  async saveUserMessage(
    conversationId: number,
    content: string,
  ): Promise<Message> {
    return this.saveMessage({
      conversationId,
      role: 'user',
      content,
      status: 'completed',
      errorMessage: null,
    });
  }

  async saveMessage(input: SaveMessageInput): Promise<Message> {
    return this.dataSource.transaction(async (manager) => {
      const message = await manager.getRepository(Message).save(
        manager.getRepository(Message).create({
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          status: input.status,
          errorMessage: input.errorMessage,
        }),
      );

      await manager.getRepository(Conversation).update(input.conversationId, {
        updatedAt: new Date(),
      });

      return message;
    });
  }

  async saveAssistantMessageWithReferences(
    conversationId: number,
    content: string,
    references: SaveMessageReferenceInput[],
  ): Promise<Message> {
    return this.dataSource.transaction(async (manager) => {
      const message = await manager.getRepository(Message).save(
        manager.getRepository(Message).create({
          conversationId,
          role: 'assistant',
          content,
          status: 'completed',
          errorMessage: null,
        }),
      );

      if (references.length > 0) {
        const referenceEntities = references.map((reference) =>
          manager.getRepository(MessageReference).create({
            messageId: message.id,
            documentId: reference.documentId,
            chunkId: reference.chunkId,
            documentName: reference.documentName,
            chunkIndex: reference.chunkIndex,
            pageNo: reference.pageNo,
            score: reference.score,
            contentSnapshot: reference.content,
          }),
        );

        await manager
          .getRepository(MessageReference)
          .save(referenceEntities);
      }

      await manager.getRepository(Conversation).update(conversationId, {
        updatedAt: new Date(),
      });

      return message;
    });
  }

  async saveAssistantFailedMessage(
    conversationId: number,
    content: string,
    errorMessage: string,
  ): Promise<Message> {
    return this.saveMessage({
      conversationId,
      role: 'assistant',
      content,
      status: 'failed',
      errorMessage,
    });
  }

  async findMessagesByConversationId(
    conversationId: number,
  ): Promise<Message[]> {
    const messages = await this.messageRepository.find({
      where: { conversationId },
      relations: { references: true },
      order: { id: 'ASC' },
    });

    messages.forEach((message) => {
      message.references = (message.references ?? []).sort(
        (left, right) => left.id - right.id,
      );
    });

    return messages;
  }

  async findRecentCompletedMessages(
    conversationId: number,
    limit: number,
    beforeMessageId: number,
  ): Promise<Message[]> {
    if (limit <= 0) {
      return [];
    }

    const messages = await this.messageRepository.find({
      where: {
        conversationId,
        status: 'completed',
        id: LessThan(beforeMessageId),
      },
      order: { id: 'DESC' },
      take: limit,
    });

    return messages.reverse();
  }
}
