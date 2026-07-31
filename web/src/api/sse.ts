import { ApiError } from './http'
import type {
  SseDoneEvent,
  SseErrorEvent,
  SseEventType,
  SseMetadataEvent,
  SseReferenceItem,
  SseTokenEvent,
} from '../types/chat'

export interface SseCallbacks {
  onMetadata?: (data: SseMetadataEvent) => void
  onToken?: (data: SseTokenEvent) => void
  onReferences?: (data: SseReferenceItem[]) => void
  onDone?: (data: SseDoneEvent) => void
  onError?: (data: SseErrorEvent) => void
  onNetworkError?: (error: Error) => void
}

interface SseFrame {
  event: string
  data: string
}

interface ErrorResponseBody {
  code?: number
  message?: string
  details?: unknown
}

export async function fetchSseChat(
  url: string,
  body: unknown,
  callbacks: SseCallbacks,
  abortSignal: AbortSignal,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal,
    })
  } catch (error: unknown) {
    if (abortSignal.aborted) {
      return
    }

    callbacks.onNetworkError?.(toError(error, '网络请求失败'))
    return
  }

  if (!response.ok) {
    callbacks.onNetworkError?.(await createResponseError(response))
    return
  }

  if (response.body === null) {
    callbacks.onNetworkError?.(new Error('流式响应为空'))
    return
  }

  await readSseStream(response.body, callbacks, abortSignal)
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: SseCallbacks,
  abortSignal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reading = true

  try {
    while (reading) {
      const result = await reader.read()

      if (result.done) {
        reading = false
        break
      }

      buffer += decoder.decode(result.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        dispatchParsedFrame(parseSseFrame(frame), callbacks)
      }
    }

    buffer += decoder.decode()

    if (buffer.trim().length > 0) {
      dispatchParsedFrame(parseSseFrame(buffer), callbacks)
    }
  } catch (error: unknown) {
    if (!abortSignal.aborted) {
      callbacks.onNetworkError?.(toError(error, '流式读取失败'))
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSseFrame(frame: string): SseFrame | null {
  const lines = frame.split(/\r?\n/)
  let event = ''
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  if (event.length === 0 || dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join('\n'),
  }
}

function dispatchParsedFrame(
  frame: SseFrame | null,
  callbacks: SseCallbacks,
): void {
  if (frame === null) {
    return
  }

  const eventType = frame.event as SseEventType
  const parsedData = parseJson(frame.data)

  if (parsedData === undefined) {
    callbacks.onNetworkError?.(new Error('流式事件解析失败'))
    return
  }

  switch (eventType) {
    case 'metadata':
      if (isMetadataEvent(parsedData)) {
        callbacks.onMetadata?.(parsedData)
      }
      break
    case 'token':
      if (isTokenEvent(parsedData)) {
        callbacks.onToken?.(parsedData)
      }
      break
    case 'references':
      if (isReferenceArray(parsedData)) {
        callbacks.onReferences?.(parsedData)
      }
      break
    case 'done':
      if (isDoneEvent(parsedData)) {
        callbacks.onDone?.(parsedData)
      }
      break
    case 'error':
      if (isErrorEvent(parsedData)) {
        callbacks.onError?.(parsedData)
      }
      break
    default:
      break
  }
}

async function createResponseError(response: Response): Promise<ApiError> {
  let body: ErrorResponseBody | undefined

  try {
    const parsed = await response.json()
    body = isRecord(parsed) ? parsed : undefined
  } catch {
    body = undefined
  }

  return new ApiError(getResponseMessage(response, body), {
    status: response.status,
    code: body?.code,
    details: body?.details,
  })
}

function getResponseMessage(
  response: Response,
  body: ErrorResponseBody | undefined,
): string {
  if (typeof body?.message === 'string' && body.message.length > 0) {
    return body.message
  }

  return `请求失败（${response.status}）`
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function isMetadataEvent(value: unknown): value is SseMetadataEvent {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.conversationId === 'number' &&
    typeof value.userMessageId === 'number'
  )
}

function isTokenEvent(value: unknown): value is SseTokenEvent {
  return isRecord(value) && typeof value.delta === 'string'
}

function isDoneEvent(value: unknown): value is SseDoneEvent {
  return isRecord(value) && typeof value.assistantMessageId === 'number'
}

function isErrorEvent(value: unknown): value is SseErrorEvent {
  return isRecord(value) && typeof value.message === 'string'
}

function isReferenceArray(value: unknown): value is SseReferenceItem[] {
  return Array.isArray(value) && value.every(isReferenceItem)
}

function isReferenceItem(value: unknown): value is SseReferenceItem {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.chunkId === 'number' &&
    typeof value.documentId === 'number' &&
    typeof value.documentName === 'string' &&
    (typeof value.pageNo === 'number' || value.pageNo === null) &&
    typeof value.content === 'string' &&
    typeof value.score === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage)
}
