import { DataSource, EntityTarget, Repository } from 'typeorm';

import { Conversation } from '../entities/conversation.entity';
import { MessageReference } from '../entities/message-reference.entity';
import { Message } from '../entities/message.entity';
import { MessageService } from '../message.service';

interface MessageRepositoryMock {
  create: jest.MockedFunction<(entity: Partial<Message>) => Message>;
  save: jest.MockedFunction<(entity: Message) => Promise<Message>>;
  find: jest.MockedFunction<(options: unknown) => Promise<Message[]>>;
}

interface ReferenceRepositoryMock {
  create: jest.MockedFunction<
    (entity: Partial<MessageReference>) => MessageReference
  >;
  save: jest.MockedFunction<
    (entities: MessageReference[]) => Promise<MessageReference[]>
  >;
}

interface ConversationRepositoryMock {
  update: jest.MockedFunction<
    (id: number, patch: Partial<Conversation>) => Promise<{ affected: number }>
  >;
}

function createService(): {
  service: MessageService;
  messageRepository: MessageRepositoryMock;
  referenceRepository: ReferenceRepositoryMock;
  conversationRepository: ConversationRepositoryMock;
} {
  const messageRepository: MessageRepositoryMock = {
    create: jest.fn((entity: Partial<Message>) => entity as Message),
    save: jest.fn(async (entity: Message) => ({
      ...entity,
      id: entity.id ?? 101,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    find: jest.fn().mockResolvedValue([]),
  };
  const referenceRepository: ReferenceRepositoryMock = {
    create: jest.fn(
      (entity: Partial<MessageReference>) => entity as MessageReference,
    ),
    save: jest.fn(async (entities: MessageReference[]) => entities),
  };
  const conversationRepository: ConversationRepositoryMock = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = {
    getRepository: jest.fn((target: EntityTarget<unknown>) => {
      if (target === Message) {
        return messageRepository;
      }
      if (target === MessageReference) {
        return referenceRepository;
      }
      return conversationRepository;
    }),
  };
  const dataSource = {
    transaction: jest.fn(
      async (callback: (value: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };

  return {
    service: new MessageService(
      messageRepository as unknown as Repository<Message>,
      dataSource as unknown as DataSource,
    ),
    messageRepository,
    referenceRepository,
    conversationRepository,
  };
}

describe('MessageService', () => {
  it('saves assistant message and references in the same transaction', async () => {
    const {
      service,
      messageRepository,
      referenceRepository,
      conversationRepository,
    } = createService();

    const message = await service.saveAssistantMessageWithReferences(7, 'answer', [
      {
        chunkId: 11,
        documentId: 22,
        documentName: 'manual.pdf',
        chunkIndex: 3,
        pageNo: 4,
        content: 'snapshot',
        score: 0.8765,
      },
    ]);

    expect(message.id).toBe(101);
    expect(messageRepository.create).toHaveBeenCalledWith({
      conversationId: 7,
      role: 'assistant',
      content: 'answer',
      status: 'completed',
      errorMessage: null,
    });
    expect(referenceRepository.create).toHaveBeenCalledWith({
      messageId: 101,
      documentId: 22,
      chunkId: 11,
      documentName: 'manual.pdf',
      chunkIndex: 3,
      pageNo: 4,
      score: 0.8765,
      contentSnapshot: 'snapshot',
    });
    expect(referenceRepository.save).toHaveBeenCalledTimes(1);
    const updatePatch = conversationRepository.update.mock.calls[0][1];
    expect(updatePatch.updatedAt).toBeInstanceOf(Date);
  });

  it('sorts message references by id when loading history', async () => {
    const { service, messageRepository } = createService();
    messageRepository.find.mockResolvedValue([
      {
        id: 1,
        references: [
          { id: 3 } as MessageReference,
          { id: 2 } as MessageReference,
        ],
      } as Message,
    ]);

    const messages = await service.findMessagesByConversationId(7);

    expect(messages[0].references.map((reference) => reference.id)).toEqual([
      2,
      3,
    ]);
  });
});
