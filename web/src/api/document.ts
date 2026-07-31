import type { AxiosProgressEvent } from 'axios'

import type {
  DocumentDetail,
  KnowledgeDocument,
} from '../types/document'
import http from './http'

export async function listDocuments(
  knowledgeBaseId: number,
): Promise<KnowledgeDocument[]> {
  const response = await http.get<KnowledgeDocument[]>(
    `/knowledge-bases/${knowledgeBaseId}/documents`,
  )

  return response.data
}

export async function getDocument(id: number): Promise<DocumentDetail> {
  const response = await http.get<DocumentDetail>(`/documents/${id}`)

  return response.data
}

export async function uploadDocument(
  knowledgeBaseId: number,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<KnowledgeDocument> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await http.post<KnowledgeDocument>(
    `/knowledge-bases/${knowledgeBaseId}/documents`,
    formData,
    {
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (event.total === undefined || event.total <= 0) {
          return
        }

        onProgress?.(Math.round((event.loaded / event.total) * 100))
      },
    },
  )

  return response.data
}

export async function deleteDocument(id: number): Promise<void> {
  await http.delete(`/documents/${id}`)
}
