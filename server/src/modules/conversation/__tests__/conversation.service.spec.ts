import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { KnowledgeBase } from '../../knowledge-base/entities/knowledge-base.entity';
import { Conversation } from '../entities/conversation.entity';
import { ConversationService } from '../conversation.service';

interface ConversationRepositoryMock {
  create: jest.MockedFunction<(entity: Partial<Conversation>) => Conversation>;
  save: jest.MockedFunction<(entity: Conversation) => Promise<Conversation>>;
  findOne: jest.MockedFunction<(options: unknown) => Promise<Conversation | null>>;
  find: jest.MockedFunction<(options: unknown) => Promise<Conversation[]>>;
  delete: jest.MockedFunction<(id: number) => Promise<{ affected: number }>>;
}
type KnowledgeBaseRepositoryMock = jest.Mocked<
  Pick<Repository<KnowledgeBase>, 'findOne'>
>;

function createConversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: 1,
    kbId: 10,
    title: 'title',
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as KnowledgeBase,
    messages: [],
    ...overrides,
  };
}

function createService(options: {
  knowledgeBase?: KnowledgeBase | null;
  conversation?: Conversation | null;
} = {}): {
  service: ConversationService;
  conversationRepository: ConversationRepositoryMock;
  knowledgeBaseRepository: KnowledgeBaseRepositoryMock;
} {
  const conversationRepository: ConversationRepositoryMock = {
    create: jest.fn((entity: Partial<Conversation>) => entity as Conversation),
    save: jest.fn(async (entity: Conversation) => ({
      ...entity,
      id: entity.id ?? 1,
    })),
    findOne: jest.fn().mockResolvedValue(
      options.conversation === undefined
        ? createConversation()
        : options.conversation,
    ),
    find: jest.fn().mockResolvedValue([createConversation()]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const knowledgeBaseRepository: KnowledgeBaseRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(
      options.knowledgeBase === undefined
        ? ({ id: 10 } as KnowledgeBase)
        : options.knowledgeBase,
    ),
  };

  return {
    service: new ConversationService(
      conversationRepository as unknown as Repository<Conversation>,
      knowledgeBaseRepository as unknown as Repository<KnowledgeBase>,
    ),
    conversationRepository,
    knowledgeBaseRepository,
  };
}

describe('ConversationService', () => {
  it('truncates title when creating a conversation', async () => {
    const { service, conversationRepository } = createService();
    const title = '长'.repeat(240);

    await service.createConversation(10, title);

    expect(conversationRepository.create).toHaveBeenCalledWith({
      kbId: 10,
      title: '长'.repeat(200),
    });
  });

  it('throws when knowledge base does not exist', async () => {
    const { service } = createService({ knowledgeBase: null });

    await expect(service.createConversation(10, 'title')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when conversation does not exist', async () => {
    const { service } = createService({ conversation: null });

    await expect(service.findConversationOrThrow(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('finds conversations by knowledgeBaseId ordered by updatedAt and id', async () => {
    const { service, conversationRepository } = createService();

    await service.findConversationsByKnowledgeBaseId(10);

    expect(conversationRepository.find).toHaveBeenCalledWith({
      where: { kbId: 10 },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  });

  it('checks existence before removing', async () => {
    const { service, conversationRepository } = createService();

    await service.remove(1);

    expect(conversationRepository.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    expect(conversationRepository.delete).toHaveBeenCalledWith(1);
  });

  it('rejects conversations that belong to another knowledge base', async () => {
    const { service } = createService({
      conversation: createConversation({ kbId: 99 }),
    });

    await expect(
      service.findConversationInKnowledgeBaseOrThrow(1, 10),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
