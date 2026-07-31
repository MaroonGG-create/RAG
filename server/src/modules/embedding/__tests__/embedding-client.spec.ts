import { ConfigService } from '@nestjs/config';

import { EmbeddingClient } from '../embedding-client';
import { EmbeddingFailure } from '../embedding.types';

type ConfigValue = string | number | boolean;

class TestConfigService {
  constructor(private readonly values: Record<string, ConfigValue>) {}

  getOrThrow<T>(key: string): T {
    return this.values[key] as T;
  }
}

function createClient(
  overrides: Partial<Record<string, ConfigValue>> = {},
): EmbeddingClient {
  return new EmbeddingClient(
    new TestConfigService({
      'embedding.baseUrl': 'http://embedding.test/v1',
      'embedding.apiKey': 'test-key',
      'embedding.model': 'test-embedding',
      'embedding.dimension': 4,
      'embedding.timeoutMs': 1000,
      'embedding.maxRetries': 0,
      'embedding.mock': false,
      ...overrides,
    }) as unknown as ConfigService,
  );
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(JSON.stringify(body), init);
}

function patchSleep(client: EmbeddingClient): jest.MockedFunction<(delayMs: number) => Promise<void>> {
  const sleep = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
  Object.defineProperty(client, 'sleep', { value: sleep });
  return sleep;
}

describe('EmbeddingClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns empty vectors for empty input', async () => {
    await expect(createClient().embed([])).resolves.toEqual([]);
  });

  it('generates deterministic vectors in mock mode', async () => {
    const client = createClient({
      'embedding.mock': true,
      'embedding.dimension': 8,
    });

    await expect(client.embed(['same text'])).resolves.toEqual(
      await client.embed(['same text']),
    );
  });

  it('uses configured mock vector dimension', async () => {
    const client = createClient({
      'embedding.mock': true,
      'embedding.dimension': 16,
    });

    const vectors = await client.embed(['text']);

    expect(vectors[0]).toHaveLength(16);
  });

  it('normalizes mock vectors', async () => {
    const client = createClient({ 'embedding.mock': true });
    const [vector] = await client.embed(['text']);
    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    expect(norm).toBeCloseTo(1, 8);
  });

  it('sorts HTTP embeddings by response index', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        model: 'test-embedding',
        data: [
          { index: 1, embedding: [2, 2, 2, 2] },
          { index: 0, embedding: [1, 1, 1, 1] },
        ],
      }),
    );

    await expect(createClient().embed(['a', 'b'])).resolves.toEqual([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
    ]);
  });

  it('retries retryable HTTP failures', async () => {
    const client = createClient({ 'embedding.maxRetries': 1 });
    const sleep = patchSleep(client);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ error: 'limit' }, {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': '1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'test-embedding',
          data: [{ index: 0, embedding: [1, 1, 1, 1] }],
        }),
      );

    await expect(client.embed(['a'])).resolves.toEqual([[1, 1, 1, 1]]);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'unauthorized' }, {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    await expect(createClient({ 'embedding.maxRetries': 2 }).embed(['a'])).rejects.toThrow(
      new EmbeddingFailure('Embedding API 认证失败：401 Unauthorized'),
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('wraps timeout abort errors', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    await expect(createClient().embed(['a'])).rejects.toThrow(
      'Embedding API 请求超时',
    );
  });

  it('rejects non-continuous response indexes', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        model: 'test-embedding',
        data: [
          { index: 0, embedding: [1, 1, 1, 1] },
          { index: 2, embedding: [2, 2, 2, 2] },
        ],
      }),
    );

    await expect(createClient().embed(['a', 'b'])).rejects.toThrow(
      'Embedding 响应 index 不连续',
    );
  });

  it('rejects incompatible response shape', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ foo: 'bar' }));

    await expect(createClient().embed(['a'])).rejects.toThrow(
      'Embedding API 响应结构不兼容',
    );
  });

  it('wraps network errors', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));

    await expect(createClient().embed(['a'])).rejects.toThrow(
      'Embedding API 网络错误：offline',
    );
  });
});
