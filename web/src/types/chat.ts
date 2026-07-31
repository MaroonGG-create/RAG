import type {
  MessageReference,
  MessageRole,
} from './conversation'

export type SseEventType =
  | 'metadata'
  | 'token'
  | 'references'
  | 'done'
  | 'error'

export interface SseMetadataEvent {
  conversationId: number
  userMessageId: number
}

export interface SseTokenEvent {
  delta: string
}

export interface SseReferenceItem {
  chunkId: number
  documentId: number
  documentName: string
  pageNo: number | null
  content: string
  score: number
}

export interface SseDoneEvent {
  assistantMessageId: number
}

export interface SseErrorEvent {
  message: string
}

export interface ChatRequestParams {
  question: string
  conversationId?: number
}

export type ChatReference = MessageReference | SseReferenceItem

export type ChatMessageStatus = 'completed' | 'failed' | 'streaming'

export interface ChatMessageItem {
  id: number | null
  role: MessageRole
  content: string
  status: ChatMessageStatus
  errorMessage: string | null
  references: ChatReference[]
  createdAt: string | null
}

export type ChatGenerationStatus =
  | 'idle'
  | 'connecting'
  | 'generating'
  | 'completed'
  | 'error'
  | 'aborted'
