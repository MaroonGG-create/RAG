import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { ConversationService } from '../../conversation/conversation.service';
import { Conversation } from '../../conversation/entities/conversation.entity';
import { Message } from '../../conversation/entities/message.entity';
import { MessageService } from '../../conversation/message.service';
import { LlmClient } from '../../llm/llm-client';
import { LlmFailure } from '../../llm/llm.types';
import { RetrievalService } from '../../retrieval/retrieval.service';
import { RetrievalResult } from '../../retrieval/retrieval.types';
import { ChatService } from '../chat.service';

type ConfigValue = number;
type RetrievalServiceMock = jest.Mocked<Pick<RetrievalService, 'search'>>;
type LlmClientMock = jest.Mocked<Pick<LlmClient, 'chatStream'>>;
type ConversationServiceMock = jest.Mocked<
  Pick<
    ConversationService,
    | 'validateKnowledgeBaseExists'
    | 'createConversation'
    | 'findConversationInKnowledgeBaseOrThrow'
  >
>;
type MessageServiceMock = jest.Mocked<
  Pick<
    MessageService,
    | 'saveUserMessage'
    | 'saveAssistantMessageWithReferences'
    | 'saveAssistantFailedMessage'
    | 'findRecentCompletedMessages'
  >
>;

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

interface ResponseHarness {
  response: Response;
  writes: string[];
  markDestroyed: () => void;
}

function createConversation(id = 7, kbId = 1): Conversation {
  return {
    id,
    kbId,
    title: 'question',
    createdAt: new Date(),
    updatedAt: new Date(),
    knowledgeBase: undefined as unknown as Conversation['knowledgeBase'],
    messages: [],
  };
}

function createMessage(id: number, role: Message['role']): Message {
  return {
    id,
    conversationId: 7,
    role,
    content: role === 'user' ? 'question' : 'answer',
    status: 'completed',
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    conversation: undefined as unknown as Conversation,
    references: [],
  };
}

function createRetrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  return {
    chunkId: 11,
    documentId: 22,
    documentName: 'manual.pdf',
    chunkIndex: 0,
    pageNo: 3,
    content: 'retrieved content',
    score: 0.91,
    ...overrides,
  };
}

function createResponseHarness(): ResponseHarness {
  const writes: string[] = [];
  let destroyed = false;
  let ended = false;
  const response = {
    get writableEnded(): boolean {
      return ended;
    },
    get destroyed(): boolean {
      return destroyed;
    },
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: jest.fn(() => {
      ended = true;
    }),
  } as unknown as Response;

  return {
    response,
    writes,
    markDestroyed: () => {
      destroyed = true;
    },
  };
}

async function* createStream(
  deltas: string[],
): AsyncGenerator<{ delta: string; finishReason: string | null }> {
  for (const delta of deltas) {
    yield { delta, finishReason: null };
  }
}

async function* createThrowingStream(): AsyncGenerator<{
  delta: string;
  finishReason: string | null;
}> {
  throw new LlmFailure('upstream failed');
}

function createService(options: {
  results?: RetrievalResult[];
  llmStream?: AsyncGenerator<{ delta: string; finishReason: string | null }>;
  conversation?: Conversation;
} = {}): {
  service: ChatService;
  retrievalService: RetrievalServiceMock;
  llmClient: LlmClientMock;
  conversationService: ConversationServiceMock;
  messageService: MessageServiceMock;
} {
  const conversation = options.conversation ?? createConversation();
  const retrievalService: RetrievalServiceMock = {
    search: jest.fn().mockResolvedValue({
      results: options.results ?? [createRetrievalResult()],
      total: options.results?.length ?? 1,
      took: 12,
    }),
  };
  const llmClient: LlmClientMock = {
    chatStream: jest.fn().mockReturnValue(
      options.llmStream ?? createStream(['答', '案']),
    ),
  };
  const conversationService: ConversationServiceMock = {
    validateKnowledgeBaseExists: jest.fn().mockResolvedValue(undefined),
    createConversation: jest.fn().mockResolvedValue(conversation),
    findConversationInKnowledgeBaseOrThrow: jest
      .fn()
      .mockResolvedValue(conversation),
  };
  const messageService: MessageServiceMock = {
    saveUserMessage: jest.fn().mockResolvedValue(createMessage(101, 'user')),
    saveAssistantMessageWithReferences: jest
      .fn()
      .mockResolvedValue(createMessage(202, 'assistant')),
    saveAssistantFailedMessage: jest
      .fn()
      .mockResolvedValue({
        ...createMessage(203, 'assistant'),
        status: 'failed',
      }),
    findRecentCompletedMessages: jest.fn().mockResolvedValue([]),
  };
  const configService = new TestConfigService({
    'rag.contextMaxChars': 4000,
    'chat.historyMaxMessages': 6,
  });

  return {
    service: new ChatService(
      retrievalService as unknown as RetrievalService,
      llmClient as unknown as LlmClient,
      conversationService as unknown as ConversationService,
      messageService as unknown as MessageService,
      configService as unknown as ConfigService,
    ),
    retrievalService,
    llmClient,
    conversationService,
    messageService,
  };
}

function eventNames(writes: string[]): string[] {
  return writes
    .map((write) => /^event: (.+)$/m.exec(write)?.[1])
    .filter((event): event is string => event !== undefined);
}

describe('ChatService', () => {
  it('does not call LLM when retrieval has no results', async () => {
    const { service, llmClient, messageService } = createService({
      results: [],
    });
    const { response, writes } = createResponseHarness();

    await service.streamChat(
      1,
      ' question ',
      undefined,
      undefined,
      undefined,
      response,
      new AbortController().signal,
    );

    expect(llmClient.chatStream).not.toHaveBeenCalled();
    expect(messageService.saveAssistantMessageWithReferences).toHaveBeenCalledWith(
      7,
      '知识库中未找到与您问题相关的内容。',
      [],
    );
    expect(eventNames(writes)).toEqual([
      'metadata',
      'token',
      'references',
      'done',
    ]);
  });

  it('streams metadata, tokens, references and done in order', async () => {
    const result = createRetrievalResult();
    const { service, messageService } = createService({
      results: [result],
      llmStream: createStream(['你', '好']),
    });
    const { response, writes } = createResponseHarness();

    await service.streamChat(
      1,
      '问题',
      undefined,
      undefined,
      undefined,
      response,
      new AbortController().signal,
    );

    expect(eventNames(writes)).toEqual([
      'metadata',
      'token',
      'token',
      'references',
      'done',
    ]);
    expect(messageService.saveAssistantMessageWithReferences).toHaveBeenCalledWith(
      7,
      '你好',
      [
        {
          chunkId: result.chunkId,
          documentId: result.documentId,
          documentName: result.documentName,
          chunkIndex: result.chunkIndex,
          pageNo: result.pageNo,
          content: result.content,
          score: result.score,
        },
      ],
    );
  });

  it('rejects concurrent generation in the same conversation', async () => {
    const { service } = createService({ conversation: createConversation(9) });
    const inFlight = service as unknown as {
      inFlightConversations: Map<number, AbortController>;
    };
    inFlight.inFlightConversations.set(9, new AbortController());

    await expect(
      service.streamChat(
        1,
        '问题',
        9,
        undefined,
        undefined,
        createResponseHarness().response,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses existing conversation when conversationId is provided', async () => {
    const { service, conversationService } = createService();

    await service.streamChat(
      1,
      '问题',
      7,
      undefined,
      undefined,
      createResponseHarness().response,
      new AbortController().signal,
    );

    expect(conversationService.findConversationInKnowledgeBaseOrThrow).toHaveBeenCalledWith(
      7,
      1,
    );
    expect(conversationService.createConversation).not.toHaveBeenCalled();
  });

  it('saves failed assistant message when the client disconnects', async () => {
    async function* disconnectingStream(
      harness: ResponseHarness,
    ): AsyncGenerator<{ delta: string; finishReason: string | null }> {
      yield { delta: 'partial', finishReason: null };
      harness.markDestroyed();
      yield { delta: ' ignored', finishReason: null };
    }
    const harness = createResponseHarness();
    const { service, messageService } = createService({
      llmStream: disconnectingStream(harness),
    });

    await service.streamChat(
      1,
      '问题',
      undefined,
      undefined,
      undefined,
      harness.response,
      new AbortController().signal,
    );

    expect(messageService.saveAssistantFailedMessage).toHaveBeenCalledWith(
      7,
      'partial',
      '客户端断开连接',
    );
  });

  it('sends safe error event and saves failed assistant when LLM fails', async () => {
    const { service, messageService } = createService({
      llmStream: createThrowingStream(),
    });
    const { response, writes } = createResponseHarness();

    await service.streamChat(
      1,
      '问题',
      undefined,
      undefined,
      undefined,
      response,
      new AbortController().signal,
    );

    expect(messageService.saveAssistantFailedMessage).toHaveBeenCalledWith(
      7,
      '',
      '问答服务暂时不可用：模型调用失败',
    );
    expect(eventNames(writes)).toContain('error');
    expect(writes.join('')).toContain('问答服务暂时不可用：模型调用失败');
    expect(writes.join('')).not.toContain('upstream failed');
  });
});
