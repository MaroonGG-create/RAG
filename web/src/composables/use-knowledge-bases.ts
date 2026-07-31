import { ref, type Ref } from 'vue'

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  listKnowledgeBases,
} from '../api/knowledge-base'
import type {
  CreateKnowledgeBasePayload,
  KnowledgeBase,
} from '../types/knowledge-base'

interface UseKnowledgeBasesResult {
  knowledgeBases: Ref<KnowledgeBase[]>
  loading: Ref<boolean>
  errorMessage: Ref<string>
  fetchKnowledgeBases: () => Promise<void>
  create: (payload: CreateKnowledgeBasePayload) => Promise<KnowledgeBase>
  remove: (id: number) => Promise<void>
}

export function useKnowledgeBases(): UseKnowledgeBasesResult {
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const loading = ref(false)
  const errorMessage = ref('')

  async function fetchKnowledgeBases(): Promise<void> {
    loading.value = true
    errorMessage.value = ''

    try {
      knowledgeBases.value = await listKnowledgeBases()
    } catch (error: unknown) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function create(
    payload: CreateKnowledgeBasePayload,
  ): Promise<KnowledgeBase> {
    const created = await createKnowledgeBase(payload)
    await fetchKnowledgeBases()

    return created
  }

  async function remove(id: number): Promise<void> {
    await deleteKnowledgeBase(id)
    await fetchKnowledgeBases()
  }

  return {
    knowledgeBases,
    loading,
    errorMessage,
    fetchKnowledgeBases,
    create,
    remove,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}
