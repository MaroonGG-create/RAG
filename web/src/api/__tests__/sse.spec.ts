import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../http'
import { fetchSseChat, type SseCallbacks } from '../sse'
import type { SseReferenceItem } from '../../types/chat'

function streamFrom(
  chunks: string[],
  error?: Error,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))

      if (error === undefined) {
        controller.close()
      } else {
        controller.error(error)
      }
    },
  })
}

function okStreamResponse(chunks: string[]): Response {
  return new Response(streamFrom(chunks), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function createCallbacks(): Required<SseCallbacks> {
  return {
    onMetadata: vi.fn(),
    onToken: vi.fn(),
    onReferences: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onNetworkError: vi.fn(),
  }
}

function referencePayload(): SseReferenceItem {
  return {
    chunkId: 1,
    documentId: 2,
    documentName: 'manual.pdf',
    pageNo: 3,
    content: 'content',
    score: 0.91,
  }
}

async function runSse(
  chunks: string[],
  callbacks = createCallbacks(),
  signal = new AbortController().signal,
): Promise<Required<SseCallbacks>> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okStreamResponse(chunks)))

  await fetchSseChat('/api/chat', { question: 'q' }, callbacks, signal)

  return callbacks
}

describe('fetchSseChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dispatches normal event sequence', async () => {
    const reference = referencePayload()
    const callbacks = await runSse([
      'event: metadata\ndata: {"conversationId":1,"userMessageId":2}\n\n',
      'event: token\ndata: {"delta":"你"}\n\n',
      'event: token\ndata: {"delta":"好"}\n\n',
      `event: references\ndata: ${JSON.stringify([reference])}\n\n`,
      'event: done\ndata: {"assistantMessageId":3}\n\n',
    ])

    expect(callbacks.onMetadata).toHaveBeenCalledWith({
      conversationId: 1,
      userMessageId: 2,
    })
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, { delta: '你' })
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, { delta: '好' })
    expect(callbacks.onReferences).toHaveBeenCalledWith([reference])
    expect(callbacks.onDone).toHaveBeenCalledWith({ assistantMessageId: 3 })
  })

  it('handles frames split across chunks', async () => {
    const callbacks = await runSse([
      'event: token\ndata: {"del',
      'ta":"partial"}\n\n',
    ])

    expect(callbacks.onToken).toHaveBeenCalledWith({ delta: 'partial' })
  })

  it('handles multiple frames in one chunk', async () => {
    const callbacks = await runSse([
      'event: token\ndata: {"delta":"a"}\n\nevent: token\ndata: {"delta":"b"}\n\n',
    ])

    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, { delta: 'a' })
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, { delta: 'b' })
  })

  it('joins multi-line data before JSON parsing', async () => {
    const callbacks = await runSse([
      'event: references\ndata: [\ndata: {"chunkId":1,"documentId":2,"documentName":"manual.pdf","pageNo":3,"content":"content","score":0.91}\ndata: ]\n\n',
    ])

    expect(callbacks.onReferences).toHaveBeenCalledWith([referencePayload()])
  })

  it('dispatches error events', async () => {
    const callbacks = await runSse([
      'event: error\ndata: {"message":"fail"}\n\n',
    ])

    expect(callbacks.onError).toHaveBeenCalledWith({ message: 'fail' })
  })

  it('wraps HTTP errors with JSON body as ApiError', async () => {
    const callbacks = createCallbacks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 409, message: '冲突' }), {
          status: 409,
        }),
      ),
    )

    await fetchSseChat('/api/chat', {}, callbacks, new AbortController().signal)

    const error = vi.mocked(callbacks.onNetworkError).mock.calls[0][0]
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('冲突')
    expect((error as ApiError).status).toBe(409)
  })

  it('wraps HTTP errors without JSON body', async () => {
    const callbacks = createCallbacks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html></html>', { status: 500 }),
      ),
    )

    await fetchSseChat('/api/chat', {}, callbacks, new AbortController().signal)

    expect(vi.mocked(callbacks.onNetworkError).mock.calls[0][0].message).toBe(
      '请求失败（500）',
    )
  })

  it('silently exits when fetch is aborted', async () => {
    const callbacks = createCallbacks()
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))

    await fetchSseChat('/api/chat', {}, callbacks, controller.signal)

    expect(callbacks.onNetworkError).not.toHaveBeenCalled()
  })

  it('reports stream read errors', async () => {
    const callbacks = createCallbacks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(streamFrom([], new Error('broken')), { status: 200 }),
      ),
    )

    await fetchSseChat('/api/chat', {}, callbacks, new AbortController().signal)

    expect(vi.mocked(callbacks.onNetworkError).mock.calls[0][0].message).toBe(
      'broken',
    )
  })

  it('reports empty response body', async () => {
    const callbacks = createCallbacks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: null,
      } satisfies Pick<Response, 'ok' | 'body'>),
    )

    await fetchSseChat('/api/chat', {}, callbacks, new AbortController().signal)

    expect(vi.mocked(callbacks.onNetworkError).mock.calls[0][0].message).toBe(
      '流式响应为空',
    )
  })

  it('ignores comment lines', async () => {
    const callbacks = await runSse([
      ': comment\nevent: token\ndata: {"delta":"x"}\n\n',
    ])

    expect(callbacks.onToken).toHaveBeenCalledWith({ delta: 'x' })
  })

  it('flushes a final frame without trailing blank line', async () => {
    const callbacks = await runSse(['event: token\ndata: {"delta":"tail"}'])

    expect(callbacks.onToken).toHaveBeenCalledWith({ delta: 'tail' })
  })

  it('ignores frames without event name', async () => {
    const callbacks = await runSse(['data: {"delta":"x"}\n\n'])

    expect(callbacks.onToken).not.toHaveBeenCalled()
    expect(callbacks.onNetworkError).not.toHaveBeenCalled()
  })

  it('ignores frames without data lines', async () => {
    const callbacks = await runSse(['event: token\n\n'])

    expect(callbacks.onToken).not.toHaveBeenCalled()
    expect(callbacks.onNetworkError).not.toHaveBeenCalled()
  })

  it('reports malformed JSON frames', async () => {
    const callbacks = await runSse(['event: token\ndata: not-json\n\n'])

    expect(vi.mocked(callbacks.onNetworkError).mock.calls[0][0].message).toBe(
      '流式事件解析失败',
    )
  })
})
