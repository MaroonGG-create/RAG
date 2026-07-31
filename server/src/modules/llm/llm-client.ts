import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ChatCompletionApiChoice,
  ChatCompletionApiRequest,
  ChatCompletionApiResponse,
  ChatMessage,
  ChatStreamApiChoice,
  ChatStreamApiRequest,
  ChatStreamApiResponse,
  ChatStreamDelta,
  LlmFailure,
} from './llm.types';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_JITTER_MS = 500;
const MOCK_STREAM_CHUNK_SIZE = 5;
const MOCK_STREAM_DELAY_MS = 50;

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly mock: boolean;

  constructor(configService: ConfigService) {
    this.baseUrl = configService
      .getOrThrow<string>('llm.baseUrl')
      .replace(/\/+$/, '');
    this.apiKey = configService.getOrThrow<string>('llm.apiKey');
    this.model = configService.getOrThrow<string>('llm.model');
    this.temperature = configService.getOrThrow<number>(
      'llm.temperature',
    );
    this.maxTokens = configService.getOrThrow<number>(
      'llm.maxTokens',
    );
    this.timeoutMs = configService.getOrThrow<number>(
      'llm.timeoutMs',
    );
    this.maxRetries = configService.getOrThrow<number>(
      'llm.maxRetries',
    );
    this.mock = configService.getOrThrow<boolean>('llm.mock');
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (this.mock) {
      return this.mockChat(messages);
    }

    return this.httpChat(messages);
  }

  async *chatStream(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<ChatStreamDelta> {
    if (this.mock) {
      yield* this.mockChatStream(messages, abortSignal);
      return;
    }

    yield* this.httpChatStream(messages, abortSignal);
  }

  private mockChat(messages: ChatMessage[]): string {
    const userMessage = this.findLastUserMessage(messages);
    const sourceCount = (userMessage.content.match(/\[来源\d+\]/g) ?? [])
      .length;

    return `根据知识库中的 ${sourceCount} 条参考资料，可以回答用户问题。`;
  }

  private findLastUserMessage(messages: ChatMessage[]): ChatMessage {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        return messages[index];
      }
    }

    return { role: 'user', content: '' };
  }

  private async *mockChatStream(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<ChatStreamDelta> {
    const answer = this.mockChat(messages);

    for (
      let start = 0;
      start < answer.length;
      start += MOCK_STREAM_CHUNK_SIZE
    ) {
      this.assertNotAborted(abortSignal);
      await this.sleep(MOCK_STREAM_DELAY_MS);
      this.assertNotAborted(abortSignal);

      yield {
        delta: answer.slice(start, start + MOCK_STREAM_CHUNK_SIZE),
        finishReason: null,
      };
    }

    yield { delta: '', finishReason: 'stop' };
  }

  private async httpChat(messages: ChatMessage[]): Promise<string> {
    let lastError: LlmFailure | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.sendChatRequest(messages);
      } catch (error: unknown) {
        const failure = this.toLlmFailure(error);
        lastError = failure;

        if (
          !this.isRetryableFailure(failure) ||
          attempt >= this.maxRetries
        ) {
          throw failure;
        }

        const delayMs = this.getRetryDelayMs(failure, attempt);
        this.logger.warn(
          `LLM API 重试（${attempt + 1}/${this.maxRetries}）：原因=${failure.message}，等待 ${delayMs}ms`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new LlmFailure('LLM API 请求失败：未知错误');
  }

  private async sendChatRequest(
    messages: ChatMessage[],
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestBody: ChatCompletionApiRequest = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw this.createHttpFailure(response);
      }

      return this.parseChatResponse(await this.parseJson(response));
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw new LlmFailure(
          `LLM API 请求超时：${this.timeoutMs}ms`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async *httpChatStream(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<ChatStreamDelta> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abortListener = (): void => controller.abort();
    abortSignal?.addEventListener('abort', abortListener, { once: true });

    const requestBody: ChatStreamApiRequest = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw this.createHttpFailure(response);
      }

      if (response.body === null) {
        throw new LlmFailure('LLM API 流式响应体为空');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        this.assertNotAborted(abortSignal);
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const parsedFrame = this.parseSseFrame(frame);

          if (parsedFrame === 'done') {
            yield { delta: '', finishReason: 'stop' };
            return;
          }

          if (parsedFrame !== null) {
            yield parsedFrame;
          }
        }
      }

      buffer += decoder.decode();
      const remainingFrame = this.parseSseFrame(buffer);

      if (remainingFrame === 'done') {
        yield { delta: '', finishReason: 'stop' };
      } else if (remainingFrame !== null) {
        yield remainingFrame;
      }
    } catch (error: unknown) {
      if (this.isAbortError(error) || controller.signal.aborted) {
        if (timedOut) {
          throw new LlmFailure(
            `LLM API 流式请求超时：${this.timeoutMs}ms`,
          );
        }

        throw new LlmFailure('LLM API 流式请求已中止');
      }

      throw this.toLlmFailure(error);
    } finally {
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', abortListener);
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new LlmFailure('LLM API 响应不是合法 JSON');
    }
  }

  private parseChatResponse(value: unknown): string {
    if (!this.isChatCompletionApiResponse(value)) {
      throw new LlmFailure('LLM API 响应结构不兼容');
    }

    const firstChoice = value.choices[0];
    const content = firstChoice?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new LlmFailure('LLM API 响应内容为空');
    }

    return content.trim();
  }

  private parseSseFrame(
    frame: string,
  ): ChatStreamDelta | 'done' | null {
    const dataLines = frame
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'));

    for (const line of dataLines) {
      const data = line.slice('data:'.length).trim();

      if (data.length === 0) {
        continue;
      }

      if (data === '[DONE]') {
        return 'done';
      }

      const parsed = this.parseStreamJson(data);
      const choice = parsed.choices[0];
      const delta = choice?.delta?.content ?? '';

      if (
        delta.length > 0 ||
        (choice?.finish_reason !== undefined &&
          choice.finish_reason !== null)
      ) {
        return {
          delta,
          finishReason: choice?.finish_reason ?? null,
        };
      }
    }

    return null;
  }

  private parseStreamJson(data: string): ChatStreamApiResponse {
    let parsed: unknown;

    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      throw new LlmFailure('LLM API 流式响应不是合法 JSON');
    }

    if (!this.isChatStreamApiResponse(parsed)) {
      throw new LlmFailure('LLM API 流式响应结构不兼容');
    }

    return parsed;
  }

  private createHttpFailure(response: Response): LlmFailure {
    const status = response.status;
    const statusText = response.statusText || 'Unknown';

    if (status === 429) {
      return new LlmFailure(
        `LLM API 限流：${status} ${statusText}`,
        this.getRetryAfterMs(response),
      );
    }

    if ([500, 502, 503, 504].includes(status)) {
      return new LlmFailure(
        `LLM API 服务端错误：${status} ${statusText}`,
      );
    }

    if (status === 401) {
      return new LlmFailure(
        `LLM API 认证失败：${status} ${statusText}`,
      );
    }

    if (status === 403) {
      return new LlmFailure(
        `LLM API 禁止访问：${status} ${statusText}`,
      );
    }

    if (status === 404) {
      return new LlmFailure(
        `LLM API 地址或模型不存在：${status} ${statusText}`,
      );
    }

    return new LlmFailure(`LLM API 请求失败：${status} ${statusText}`);
  }

  private getRetryAfterMs(response: Response): number | null {
    const retryAfter = response.headers.get('Retry-After');

    if (retryAfter === null) {
      return null;
    }

    const delaySeconds = Number(retryAfter);

    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
      return null;
    }

    return Math.floor(delaySeconds * 1000);
  }

  private isRetryableFailure(error: LlmFailure): boolean {
    return (
      error.message.includes('请求超时') ||
      error.message.includes('网络错误') ||
      error.message.includes('限流') ||
      error.message.includes('服务端错误')
    );
  }

  private getRetryDelayMs(error: LlmFailure, attempt: number): number {
    if (error.retryAfterMs !== null) {
      return error.retryAfterMs;
    }

    const exponentialDelay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** attempt,
      RETRY_MAX_DELAY_MS,
    );

    return exponentialDelay + Math.floor(Math.random() * RETRY_JITTER_MS);
  }

  private toLlmFailure(error: unknown): LlmFailure {
    if (error instanceof LlmFailure) {
      return error;
    }

    if (error instanceof Error) {
      return new LlmFailure(`LLM API 网络错误：${error.message}`);
    }

    return new LlmFailure('LLM API 网络错误：未知错误');
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private isChatCompletionApiResponse(
    value: unknown,
  ): value is ChatCompletionApiResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ChatCompletionApiResponse>;

    return (
      Array.isArray(candidate.choices) &&
      candidate.choices.length > 0 &&
      candidate.choices.every((choice) =>
        this.isChatCompletionApiChoice(choice),
      )
    );
  }

  private isChatCompletionApiChoice(
    value: unknown,
  ): value is ChatCompletionApiChoice {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ChatCompletionApiChoice>;

    return (
      candidate.message === undefined ||
      (typeof candidate.message === 'object' &&
        candidate.message !== null)
    );
  }

  private isChatStreamApiResponse(
    value: unknown,
  ): value is ChatStreamApiResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ChatStreamApiResponse>;

    return (
      Array.isArray(candidate.choices) &&
      candidate.choices.length > 0 &&
      candidate.choices.every((choice) =>
        this.isChatStreamApiChoice(choice),
      )
    );
  }

  private isChatStreamApiChoice(
    value: unknown,
  ): value is ChatStreamApiChoice {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<ChatStreamApiChoice>;

    return (
      candidate.delta === undefined ||
      (typeof candidate.delta === 'object' && candidate.delta !== null)
    );
  }

  private assertNotAborted(abortSignal?: AbortSignal): void {
    if (abortSignal?.aborted) {
      throw new LlmFailure('LLM API 流式请求已中止');
    }
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolveSleep) => {
      setTimeout(resolveSleep, delayMs);
    });
  }
}
