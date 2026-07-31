import { ConfigService } from '@nestjs/config';

import { LlmClient } from '../../llm/llm-client';
import { RetrievalService } from '../../retrieval/retrieval.service';
import { RetrievalResult } from '../../retrieval/retrieval.types';
import { RagService } from '../rag.service';

type ConfigValue = number;
type RetrievalServiceMock = jest.Mocked<Pick<RetrievalService, 'search'>>;
type LlmClientMock = jest.Mocked<Pick<LlmClient, 'chat'>>;

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

function createResult(
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

function createService(results: RetrievalResult[]): {
  service: RagService;
  retrievalService: RetrievalServiceMock;
  llmClient: LlmClientMock;
} {
  const retrievalService: RetrievalServiceMock = {
    search: jest.fn().mockResolvedValue({
      results,
      total: results.length,
      took: 5,
    }),
  };
  const llmClient: LlmClientMock = {
    chat: jest.fn().mockResolvedValue('model answer'),
  };
  const configService = new TestConfigService({
    'rag.contextMaxChars': 120,
  });

  return {
    service: new RagService(
      retrievalService as unknown as RetrievalService,
      llmClient as unknown as LlmClient,
      configService as unknown as ConfigService,
    ),
    retrievalService,
    llmClient,
  };
}

describe('RagService', () => {
  it('does not call LLM when retrieval has no hits', async () => {
    const { service, llmClient } = createService([]);

    const response = await service.ask(1, ' 无关问题 ');

    expect(response.answer).toBe('知识库中未找到与您问题相关的内容。');
    expect(response.references).toEqual([]);
    expect(response.llmTook).toBe(0);
    expect(llmClient.chat).not.toHaveBeenCalled();
  });

  it('builds prompt from retrieval results and returns reference snapshots', async () => {
    const result = createResult();
    const { service, retrievalService, llmClient } = createService([result]);

    const response = await service.ask(1, ' 问题 ', 3, 0.8);

    expect(retrievalService.search).toHaveBeenCalledWith(1, '问题', 3, 0.8);
    expect(llmClient.chat).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('[来源1] retrieved content') as string,
      }),
    ]);
    expect(response.answer).toBe('model answer');
    expect(response.references).toEqual([
      {
        chunkId: result.chunkId,
        documentId: result.documentId,
        documentName: result.documentName,
        pageNo: result.pageNo,
        content: result.content,
        score: result.score,
      },
    ]);
  });
});
