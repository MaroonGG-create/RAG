import { fetchSseChat, type SseCallbacks } from './sse'
import type { ChatRequestParams } from '../types/chat'

export async function sendChatMessage(
  knowledgeBaseId: number,
  params: ChatRequestParams,
  callbacks: SseCallbacks,
  abortSignal: AbortSignal,
): Promise<void> {
  await fetchSseChat(
    buildChatUrl(knowledgeBaseId),
    params,
    callbacks,
    abortSignal,
  )
}

function buildChatUrl(knowledgeBaseId: number): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'

  return `${baseUrl.replace(/\/$/, '')}/knowledge-bases/${knowledgeBaseId}/chat`
}
