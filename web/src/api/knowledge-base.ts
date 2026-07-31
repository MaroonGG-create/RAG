import type {
  CreateKnowledgeBasePayload,
  KnowledgeBase,
} from '../types/knowledge-base'
import http from './http'

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const response = await http.get<KnowledgeBase[]>('/knowledge-bases')

  return response.data
}

export async function getKnowledgeBase(id: number): Promise<KnowledgeBase> {
  const response = await http.get<KnowledgeBase>(`/knowledge-bases/${id}`)

  return response.data
}

export async function createKnowledgeBase(
  payload: CreateKnowledgeBasePayload,
): Promise<KnowledgeBase> {
  const response = await http.post<KnowledgeBase>('/knowledge-bases', payload)

  return response.data
}

export async function deleteKnowledgeBase(id: number): Promise<void> {
  await http.delete(`/knowledge-bases/${id}`)
}
