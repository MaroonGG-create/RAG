import {
  ref,
  watch,
  type Ref,
} from 'vue'

import {
  deleteConversation,
  listConversations,
} from '../api/conversation'
import type { Conversation } from '../types/conversation'

interface UseConversationsResult {
  conversations: Ref<Conversation[]>
  loading: Ref<boolean>
  errorMessage: Ref<string>
  fetchConversations: () => Promise<void>
  refreshConversations: () => Promise<void>
  removeConversation: (id: number) => Promise<void>
}

export function useConversations(
  knowledgeBaseId: Ref<number>,
): UseConversationsResult {
  const conversations = ref<Conversation[]>([])
  const loading = ref(false)
  const errorMessage = ref('')

  async function fetchConversations(): Promise<void> {
    if (knowledgeBaseId.value <= 0) {
      conversations.value = []
      return
    }

    loading.value = true
    errorMessage.value = ''

    try {
      conversations.value = await listConversations(knowledgeBaseId.value)
    } catch (error: unknown) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function refreshConversations(): Promise<void> {
    if (knowledgeBaseId.value <= 0) {
      conversations.value = []
      return
    }

    try {
      conversations.value = await listConversations(knowledgeBaseId.value)
    } catch (error: unknown) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function removeConversation(id: number): Promise<void> {
    await deleteConversation(id)
    await refreshConversations()
  }

  watch(
    knowledgeBaseId,
    () => {
      void fetchConversations()
    },
    { immediate: true },
  )

  return {
    conversations,
    loading,
    errorMessage,
    fetchConversations,
    refreshConversations,
    removeConversation,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}
