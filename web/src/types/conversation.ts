export interface Conversation {
  id: number
  title: string
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'user' | 'assistant'

export type MessageStatus = 'completed' | 'failed'

export interface MessageReference {
  documentId: number | null
  chunkId: number | null
  documentName: string
  chunkIndex: number
  pageNo: number | null
  score: number
  contentSnapshot: string
}

export interface ChatMessageData {
  id: number
  role: MessageRole
  content: string
  status: MessageStatus
  errorMessage: string | null
  createdAt: string
  references: MessageReference[]
}
