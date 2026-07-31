import type {
  ChatMessageData,
  Conversation,
} from '../types/conversation'
import http from './http'

export async function listConversations(
  knowledgeBaseId: number,
): Promise<Conversation[]> {
  const response = await http.get<Conversation[]>(
    `/knowledge-bases/${knowledgeBaseId}/conversations`,
  )

  return response.data
}

export async function listMessages(
  conversationId: number,
): Promise<ChatMessageData[]> {
  const response = await http.get<ChatMessageData[]>(
    `/conversations/${conversationId}/messages`,
  )

  return response.data
}

export async function deleteConversation(
  conversationId: number,
): Promise<void> {
  await http.delete(`/conversations/${conversationId}`)
}
