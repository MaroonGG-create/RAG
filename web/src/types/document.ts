export type DocumentFileExtension = 'pdf' | 'md' | 'txt'

export type DocumentStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'completed'
  | 'failed'

export interface KnowledgeDocument {
  id: number
  knowledgeBaseId: number
  fileName: string
  fileExt: DocumentFileExtension
  fileSize: number
  status: DocumentStatus
  errorMessage: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface ChunkPreview {
  id: number
  chunkIndex: number
  content: string
  charCount: number
  pageNo: number | null
  qdrantPointId: string
}

export interface DocumentDetail extends KnowledgeDocument {
  chunks: ChunkPreview[]
}

export interface DuplicateDocumentDetails {
  id: number
  fileName: string
  status: DocumentStatus
}

export const PROCESSING_DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
]

export function isProcessingDocumentStatus(
  status: DocumentStatus,
): boolean {
  return PROCESSING_DOCUMENT_STATUSES.includes(status)
}

export function isDuplicateDocumentDetails(
  value: unknown,
): value is DuplicateDocumentDetails {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const details = value as Record<string, unknown>

  return (
    typeof details.id === 'number' &&
    typeof details.fileName === 'string' &&
    typeof details.status === 'string' &&
    isDocumentStatus(details.status)
  )
}

function isDocumentStatus(value: string): value is DocumentStatus {
  return [
    'pending',
    'parsing',
    'chunking',
    'embedding',
    'completed',
    'failed',
  ].includes(value)
}
