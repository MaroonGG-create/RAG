import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
import { Conversation } from './entities/conversation.entity';

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {}

  async validateKnowledgeBaseExists(
    knowledgeBaseId: number,
  ): Promise<void> {
    const knowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { id: knowledgeBaseId },
      select: ['id'],
    });

    if (knowledgeBase === null) {
      throw new NotFoundException('知识库不存在');
    }
  }

  async createConversation(
    knowledgeBaseId: number,
    title: string,
  ): Promise<Conversation> {
    await this.validateKnowledgeBaseExists(knowledgeBaseId);

    return this.conversationRepository.save(
      this.conversationRepository.create({
        kbId: knowledgeBaseId,
        title: title.slice(0, 200),
      }),
    );
  }

  async findConversationById(
    id: number,
  ): Promise<Conversation | null> {
    return this.conversationRepository.findOne({ where: { id } });
  }

  async findConversationOrThrow(id: number): Promise<Conversation> {
    const conversation = await this.findConversationById(id);

    if (conversation === null) {
      throw new NotFoundException('会话不存在');
    }

    return conversation;
  }

  async findConversationInKnowledgeBaseOrThrow(
    id: number,
    knowledgeBaseId: number,
  ): Promise<Conversation> {
    const conversation = await this.findConversationOrThrow(id);

    if (conversation.kbId !== knowledgeBaseId) {
      throw new NotFoundException('会话不存在');
    }

    return conversation;
  }

  async findConversationsByKnowledgeBaseId(
    knowledgeBaseId: number,
  ): Promise<Conversation[]> {
    return this.conversationRepository.find({
      where: { kbId: knowledgeBaseId },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  async remove(id: number): Promise<void> {
    await this.findConversationOrThrow(id);
    await this.conversationRepository.delete(id);
  }
}
