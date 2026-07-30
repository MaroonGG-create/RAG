import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  EmbeddingApiItem,
  EmbeddingApiRequest,
  EmbeddingApiResponse,
  EmbeddingFailure,
} from './embedding.types';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_JITTER_MS = 500;

@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimension: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly mock: boolean;

  constructor(configService: ConfigService) {
    this.baseUrl = configService
      .getOrThrow<string>('embedding.baseUrl')
      .replace(/\/+$/, '');
    this.apiKey = configService.getOrThrow<string>(
      'embedding.apiKey',
    );
    this.model = configService.getOrThrow<string>(
      'embedding.model',
    );
    this.dimension = configService.getOrThrow<number>(
      'embedding.dimension',
    );
    this.timeoutMs = configService.getOrThrow<number>(
      'embedding.timeoutMs',
    );
    this.maxRetries = configService.getOrThrow<number>(
      'embedding.maxRetries',
    );
    this.mock = configService.getOrThrow<boolean>(
      'embedding.mock',
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (this.mock) {
      return this.mockEmbed(texts);
    }

    return this.httpEmbed(texts);
  }

  private mockEmbed(texts: string[]): number[][] {
    return texts.map((text) => this.generateMockVector(text));
  }

  private generateMockVector(text: string): number[] {
    const hash = createHash('sha256').update(text, 'utf8').digest();
    const vector: number[] = [];

    for (let index = 0; index < this.dimension; index += 1) {
      const byte = hash[index % hash.length];
      vector.push(byte / 127.5 - 1);
    }

    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    return norm > 0
      ? vector.map((value) => value / norm)
      : vector;
  }

  private async httpEmbed(texts: string[]): Promise<number[][]> {
    let lastError: EmbeddingFailure | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.sendEmbeddingRequest(texts);
      } catch (error: unknown) {
        const failure = this.toEmbeddingFailure(error);
        lastError = failure;

        if (
          !this.isRetryableFailure(failure) ||
          attempt >= this.maxRetries
        ) {
          throw failure;
        }

        const delayMs = this.getRetryDelayMs(failure, attempt);
        this.logger.warn(
          `Embedding API 重试（${attempt + 1}/${this.maxRetries}）：原因=${failure.message}，等待=${delayMs}ms`,
        );
        await this.sleep(delayMs);
      }
    }

    throw (
      lastError ??
      new EmbeddingFailure('Embedding API 请求失败：未知错误')
    );
  }

  private async sendEmbeddingRequest(
    texts: string[],
  ): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestBody: EmbeddingApiRequest = {
      model: this.model,
      input: texts,
    };

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
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

      return this.parseEmbeddingResponse(await this.parseJson(response));
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw new EmbeddingFailure(
          `Embedding API 请求超时（${this.timeoutMs}ms）`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new EmbeddingFailure('Embedding API 响应不是合法 JSON');
    }
  }

  private parseEmbeddingResponse(value: unknown): number[][] {
    if (!this.isEmbeddingApiResponse(value)) {
      throw new EmbeddingFailure('Embedding API 响应结构不兼容');
    }

    const sortedItems = [...value.data].sort(
      (left, right) => left.index - right.index,
    );

    sortedItems.forEach((item, index) => {
      if (item.index !== index) {
        throw new EmbeddingFailure('Embedding 响应 index 不连续');
      }
    });

    return sortedItems.map((item) => item.embedding);
  }

  private createHttpFailure(response: Response): EmbeddingFailure {
    const status = response.status;
    const statusText = response.statusText || 'Unknown';

    if (status === 429) {
      const retryAfterMs = this.getRetryAfterMs(response);
      const suffix =
        retryAfterMs === null ? '' : `；retryAfterMs=${retryAfterMs}`;
      return new EmbeddingFailure(
        `Embedding API 限流：${status} ${statusText}${suffix}`,
      );
    }

    if ([500, 502, 503, 504].includes(status)) {
      return new EmbeddingFailure(
        `Embedding API 服务端错误：${status} ${statusText}`,
      );
    }

    if (status === 401) {
      return new EmbeddingFailure(
        `Embedding API 认证失败：${status} ${statusText}`,
      );
    }

    if (status === 403) {
      return new EmbeddingFailure(
        `Embedding API 禁止访问：${status} ${statusText}`,
      );
    }

    if (status === 404) {
      return new EmbeddingFailure(
        `Embedding API 地址或模型不存在：${status} ${statusText}`,
      );
    }

    return new EmbeddingFailure(
      `Embedding API 请求失败：${status} ${statusText}`,
    );
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

  private isRetryableFailure(error: EmbeddingFailure): boolean {
    return (
      error.message.includes('请求超时') ||
      error.message.includes('网络错误') ||
      error.message.includes('限流') ||
      error.message.includes('服务端错误')
    );
  }

  private getRetryDelayMs(
    error: EmbeddingFailure,
    attempt: number,
  ): number {
    const retryAfterMatch = /retryAfterMs=(\d+)/.exec(error.message);

    if (retryAfterMatch !== null) {
      return Number(retryAfterMatch[1]);
    }

    const exponentialDelay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** attempt,
      RETRY_MAX_DELAY_MS,
    );

    return exponentialDelay + Math.floor(Math.random() * RETRY_JITTER_MS);
  }

  private toEmbeddingFailure(error: unknown): EmbeddingFailure {
    if (error instanceof EmbeddingFailure) {
      return error;
    }

    if (error instanceof Error) {
      return new EmbeddingFailure(
        `Embedding API 网络错误：${error.message}`,
      );
    }

    return new EmbeddingFailure('Embedding API 网络错误：未知错误');
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private isEmbeddingApiResponse(
    value: unknown,
  ): value is EmbeddingApiResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<EmbeddingApiResponse>;

    return (
      Array.isArray(candidate.data) &&
      candidate.data.every((item) => this.isEmbeddingApiItem(item))
    );
  }

  private isEmbeddingApiItem(
    value: unknown,
  ): value is EmbeddingApiItem {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<EmbeddingApiItem>;

    return (
      typeof candidate.index === 'number' &&
      Array.isArray(candidate.embedding) &&
      candidate.embedding.every((item) => typeof item === 'number')
    );
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolveSleep) => {
      setTimeout(resolveSleep, delayMs);
    });
  }
}
