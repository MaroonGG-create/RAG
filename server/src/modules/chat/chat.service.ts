import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import {
  ConversationService,
} from '../conversation/conversation.service';
import { Conversation } from '../conversation/entities/conversation.entity';
import { Message } from '../conversation/entities/message.entity';
import {
  MessageService,
  SaveMessageReferenceInput,
} from '../conversation/message.service';
import { EmbeddingFailure } from '../embedding/embedding.types';
import { ChatMessage, LlmFailure } from '../llm/llm.types';
import { LlmClient } from '../llm/llm-client';
import { buildRagPrompt } from '../rag/prompt-builder';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalResult } from '../retrieval/retrieval.types';
import { VectorStoreFailure } from '../vector-store/vector-store.types';
import {
  ChatErrorEvent,
  ChatMetadataEvent,
  ChatTokenEvent,
  ReferenceSnapshot,
} from './chat.types';
import { SseWriter } from './sse-writer';

const NO_RETRIEVAL_ANSWER =
  '知识库中未找到与您问题相关的内容。';
const CLIENT_DISCONNECTED_MESSAGE = '客户端断开连接';
const SAFE_LLM_ERROR_MESSAGE =
  '问答服务暂时不可用：模型调用失败';
const SAFE_EMBEDDING_ERROR_MESSAGE =
  '问答服务暂时不可用：向量生成失败';
const SAFE_RETRIEVAL_ERROR_MESSAGE =
  '问答服务暂时不可用：检索失败';
const SAFE_UNKNOWN_ERROR_MESSAGE =
  '问答服务暂时不可用，请稍后重试';

class ClientDisconnectedError extends Error {
  constructor() {
    super(CLIENT_DISCONNECTED_MESSAGE);
    this.name = 'ClientDisconnectedError';
  }
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly contextMaxChars: number;
  private readonly historyMaxMessages: number;
  private readonly inFlightConversations = new Map<
    number,
    AbortController
  >();

  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly llmClient: LlmClient,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    configService: ConfigService,
  ) {
    this.contextMaxChars = configService.getOrThrow<number>(
      'rag.contextMaxChars',
    );
    this.historyMaxMessages = configService.getOrThrow<number>(
      'chat.historyMaxMessages',
    );
  }

  async streamChat(
    knowledgeBaseId: number,
    question: string,
    conversationId: number | undefined,
    topK: number | undefined,
    scoreThreshold: number | undefined,
    response: Response,
    clientAbortSignal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    const normalizedQuestion = question.trim();
    const conversation = await this.prepareConversation(
      knowledgeBaseId,
      normalizedQuestion,
      conversationId,
    );

    if (this.inFlightConversations.has(conversation.id)) {
      throw new ConflictException('当前会话正在生成回答');
    }

    const generationAbortController = new AbortController();
    const abortGeneration = (): void =>
      generationAbortController.abort();
    clientAbortSignal.addEventListener('abort', abortGeneration, {
      once: true,
    });
    this.inFlightConversations.set(
      conversation.id,
      generationAbortController,
    );

    let writer: SseWriter | undefined;
    let answer = '';

    try {
      const userMessage = await this.messageService.saveUserMessage(
        conversation.id,
        normalizedQuestion,
      );
      writer = new SseWriter(response);
      writer.setHeaders();
      writer.writeEvent('metadata', {
        conversationId: conversation.id,
        userMessageId: userMessage.id,
      } satisfies ChatMetadataEvent);

      const retrievalData = await this.retrievalService.search(
        knowledgeBaseId,
        normalizedQuestion,
        topK,
        scoreThreshold,
      );

      this.assertClientConnected(clientAbortSignal, writer);

      if (retrievalData.results.length === 0) {
        const assistantMessage =
          await this.messageService.saveAssistantMessageWithReferences(
            conversation.id,
            NO_RETRIEVAL_ANSWER,
            [],
          );

        writer.writeEvent('token', {
          delta: NO_RETRIEVAL_ANSWER,
        } satisfies ChatTokenEvent);
        writer.writeEvent('references', []);
        writer.writeEvent('done', {
          assistantMessageId: assistantMessage.id,
        });
        this.logger.log(
          `SSE 问答无检索命中：kbId=${knowledgeBaseId}，conversationId=${conversation.id}，retrievalTook=${retrievalData.took}ms，llmTook=0ms，took=${Date.now() - startedAt}ms`,
        );
        return;
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
      const historyMessages =
        await this.messageService.findRecentCompletedMessages(
          conversation.id,
          this.historyMaxMessages,
          userMessage.id,
        );
      const messages = this.createMessagesWithHistory(
        builtPrompt.messages,
        historyMessages,
      );

      const llmStartedAt = Date.now();

      for await (const streamDelta of this.llmClient.chatStream(
        messages,
        generationAbortController.signal,
      )) {
        this.assertClientConnected(clientAbortSignal, writer);

        if (streamDelta.delta.length === 0) {
          continue;
        }

        answer += streamDelta.delta;
        writer.writeEvent('token', {
          delta: streamDelta.delta,
        } satisfies ChatTokenEvent);
      }

      this.assertClientConnected(clientAbortSignal, writer);

      const llmTook = Date.now() - llmStartedAt;
      const finalAnswer = answer.trim();

      if (finalAnswer.length === 0) {
        throw new LlmFailure('LLM API 响应内容为空');
      }

      const references = this.createReferenceSnapshots(usedResults);
      const assistantMessage =
        await this.messageService.saveAssistantMessageWithReferences(
          conversation.id,
          finalAnswer,
          this.createReferenceInputs(usedResults),
        );

      writer.writeEvent('references', references);
      writer.writeEvent('done', {
        assistantMessageId: assistantMessage.id,
      });
      this.logger.log(
        `SSE 问答完成：kbId=${knowledgeBaseId}，conversationId=${conversation.id}，referenceCount=${references.length}，retrievalTook=${retrievalData.took}ms，llmTook=${llmTook}ms，took=${Date.now() - startedAt}ms`,
      );
    } catch (error: unknown) {
      if (
        writer !== undefined &&
        this.isClientDisconnect(error, clientAbortSignal, writer)
      ) {
        await this.saveFailedAssistantIfPossible(
          conversation.id,
          answer,
          CLIENT_DISCONNECTED_MESSAGE,
        );
        this.logger.warn(
          `SSE 问答客户端断开：kbId=${knowledgeBaseId}，conversationId=${conversation.id}，took=${Date.now() - startedAt}ms`,
        );
        return;
      }

      if (writer === undefined) {
        throw error;
      }

      const safeMessage = this.getSafeErrorMessage(error);
      await this.saveFailedAssistantIfPossible(
        conversation.id,
        answer,
        safeMessage,
      );
      this.logger.error(
        `SSE 问答失败：kbId=${knowledgeBaseId}，conversationId=${conversation.id}，reason=${this.getLogErrorMessage(error)}，took=${Date.now() - startedAt}ms`,
      );
      writer.writeEvent('error', {
        message: safeMessage,
      } satisfies ChatErrorEvent);
    } finally {
      clientAbortSignal.removeEventListener('abort', abortGeneration);
      this.inFlightConversations.delete(conversation.id);
      writer?.end();
    }
  }

  private async prepareConversation(
    knowledgeBaseId: number,
    question: string,
    conversationId: number | undefined,
  ): Promise<Conversation> {
    await this.conversationService.validateKnowledgeBaseExists(
      knowledgeBaseId,
    );

    if (conversationId !== undefined) {
      return this.conversationService.findConversationInKnowledgeBaseOrThrow(
        conversationId,
        knowledgeBaseId,
      );
    }

    return this.conversationService.createConversation(
      knowledgeBaseId,
      question.slice(0, 30),
    );
  }

  private createMessagesWithHistory(
    promptMessages: ChatMessage[],
    historyMessages: Message[],
  ): ChatMessage[] {
    const systemMessage = promptMessages[0];
    const userMessage = promptMessages[1];

    if (systemMessage === undefined || userMessage === undefined) {
      throw new LlmFailure('Prompt 构建失败');
    }

    return [
      systemMessage,
      ...historyMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      userMessage,
    ];
  }

  private createReferenceSnapshots(
    results: RetrievalResult[],
  ): ReferenceSnapshot[] {
    return results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      pageNo: result.pageNo,
      content: result.content,
      score: result.score,
    }));
  }

  private createReferenceInputs(
    results: RetrievalResult[],
  ): SaveMessageReferenceInput[] {
    return results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      chunkIndex: result.chunkIndex,
      pageNo: result.pageNo,
      content: result.content,
      score: result.score,
    }));
  }

  private assertClientConnected(
    clientAbortSignal: AbortSignal,
    writer: SseWriter,
  ): void {
    if (clientAbortSignal.aborted || writer.isClosed()) {
      throw new ClientDisconnectedError();
    }
  }

  private isClientDisconnect(
    error: unknown,
    clientAbortSignal: AbortSignal,
    writer: SseWriter,
  ): boolean {
    return (
      error instanceof ClientDisconnectedError ||
      clientAbortSignal.aborted ||
      writer.isClosed()
    );
  }

  private async saveFailedAssistantIfPossible(
    conversationId: number,
    content: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.messageService.saveAssistantFailedMessage(
        conversationId,
        content,
        errorMessage,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `失败助手消息落库失败：conversationId=${conversationId}，reason=${this.getLogErrorMessage(error)}`,
      );
    }
  }

  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof EmbeddingFailure) {
      return SAFE_EMBEDDING_ERROR_MESSAGE;
    }

    if (error instanceof VectorStoreFailure) {
      return SAFE_RETRIEVAL_ERROR_MESSAGE;
    }

    if (error instanceof LlmFailure) {
      return SAFE_LLM_ERROR_MESSAGE;
    }

    return SAFE_UNKNOWN_ERROR_MESSAGE;
  }

  private getLogErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 300);
    }

    return '未知错误';
  }
}
