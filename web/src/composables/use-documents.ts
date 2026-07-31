import {
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue'

import {
  deleteDocument,
  listDocuments,
} from '../api/document'
import {
  isProcessingDocumentStatus,
  type KnowledgeDocument,
} from '../types/document'

interface FetchDocumentsOptions {
  silent?: boolean
}

interface UseDocumentsResult {
  documents: Ref<KnowledgeDocument[]>
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  errorMessage: Ref<string>
  hasProcessingDocuments: Ref<boolean>
  fetchDocuments: (options?: FetchDocumentsOptions) => Promise<void>
  remove: (id: number) => Promise<void>
  stopPolling: () => void
}

export function useDocuments(
  knowledgeBaseId: Ref<number>,
): UseDocumentsResult {
  const documents = ref<KnowledgeDocument[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const errorMessage = ref('')
  const hasProcessingDocuments = ref(false)
  let pollingTimer: number | undefined

  async function fetchDocuments(
    options: FetchDocumentsOptions = {},
  ): Promise<void> {
    if (knowledgeBaseId.value <= 0) {
      documents.value = []
      hasProcessingDocuments.value = false
      stopPolling()
      return
    }

    if (options.silent === true) {
      refreshing.value = true
    } else {
      loading.value = true
    }
    errorMessage.value = ''

    try {
      documents.value = await listDocuments(knowledgeBaseId.value)
      syncPolling()
    } catch (error: unknown) {
      errorMessage.value = getErrorMessage(error)
      stopPolling()
    } finally {
      loading.value = false
      refreshing.value = false
    }
  }

  async function remove(id: number): Promise<void> {
    await deleteDocument(id)
    await fetchDocuments({ silent: true })
  }

  function syncPolling(): void {
    hasProcessingDocuments.value = documents.value.some((document) =>
      isProcessingDocumentStatus(document.status),
    )

    if (hasProcessingDocuments.value) {
      startPolling()
      return
    }

    stopPolling()
  }

  function startPolling(): void {
    if (pollingTimer !== undefined) {
      return
    }

    pollingTimer = window.setInterval(() => {
      void fetchDocuments({ silent: true })
    }, 3000)
  }

  function stopPolling(): void {
    if (pollingTimer === undefined) {
      return
    }

    window.clearInterval(pollingTimer)
    pollingTimer = undefined
  }

  watch(
    knowledgeBaseId,
    () => {
      stopPolling()
      void fetchDocuments()
    },
    { immediate: true },
  )
  onUnmounted(stopPolling)

  return {
    documents,
    loading,
    refreshing,
    errorMessage,
    hasProcessingDocuments,
    fetchDocuments,
    remove,
    stopPolling,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}
