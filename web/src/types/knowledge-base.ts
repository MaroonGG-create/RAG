export interface KnowledgeBase {
  id: number
  name: string
  description: string | null
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeBasePayload {
  name: string
  description?: string
}
