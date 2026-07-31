import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LlmClient } from '../llm/llm-client';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalResult } from '../retrieval/retrieval.types';
import { buildRagPrompt } from './prompt-builder';
import { RagReference, RagResponseData } from './rag.types';

const NO_RETRIEVAL_ANSWER =
  '知识库中未找到与您问题相关的内容。';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly contextMaxChars: number;

  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly llmClient: LlmClient,
    configService: ConfigService,
  ) {
    this.contextMaxChars = configService.getOrThrow<number>(
      'rag.contextMaxChars',
    );
  }

  async ask(
    knowledgeBaseId: number,
    question: string,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<RagResponseData> {
    const startedAt = Date.now();
    const normalizedQuestion = question.trim();
    const retrievalData = await this.retrievalService.search(
      knowledgeBaseId,
      normalizedQuestion,
      topK,
      scoreThreshold,
    );

    if (retrievalData.results.length === 0) {
      const took = Date.now() - startedAt;
      this.logger.log(
        `RAG 问答无检索命中：kbId=${knowledgeBaseId}，retrievalTook=${retrievalData.took}ms，llmTook=0ms，took=${took}ms`,
      );

      return {
        answer: NO_RETRIEVAL_ANSWER,
        references: [],
        retrievalTook: retrievalData.took,
        llmTook: 0,
        took,
      };
    }

    const builtPrompt = buildRagPrompt(
      normalizedQuestion,
      retrievalData.results,
      this.contextMaxChars,
    );
    const usedResults = retrievalData.results.slice(
      0,
      builtPrompt.usedResultCount,
    );
    const llmStartedAt = Date.now();
    let answer: string;

    try {
      answer = await this.llmClient.chat(builtPrompt.messages);
    } catch (error: unknown) {
      const llmTook = Date.now() - llmStartedAt;
      const took = Date.now() - startedAt;
      this.logger.error(
        `RAG 问答模型调用失败：kbId=${knowledgeBaseId}，retrievalTook=${retrievalData.took}ms，llmTook=${llmTook}ms，took=${took}ms，reason=${this.getFailureMessage(error)}`,
      );
      throw error;
    }

    const llmTook = Date.now() - llmStartedAt;
    const took = Date.now() - startedAt;
    const references = this.createReferences(usedResults);

    this.logger.log(
      `RAG 问答完成：kbId=${knowledgeBaseId}，referenceCount=${references.length}，retrievalTook=${retrievalData.took}ms，llmTook=${llmTook}ms，took=${took}ms`,
    );

    return {
      answer,
      references,
      retrievalTook: retrievalData.took,
      llmTook,
      took,
    };
  }

  private createReferences(results: RetrievalResult[]): RagReference[] {
    return results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      pageNo: result.pageNo,
      content: result.content,
      score: result.score,
    }));
  }

  private getFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
