import {
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue'
import { useRouter } from 'vue-router'

import { sendChatMessage } from '../api/chat'
import { listMessages } from '../api/conversation'
import { ApiError } from '../api/http'
import type {
  ChatGenerationStatus,
  ChatMessageItem,
} from '../types/chat'
import type { ChatMessageData } from '../types/conversation'

interface UseChatResult {
  messages: Ref<ChatMessageItem[]>
  messagesLoading: Ref<boolean>
  generationStatus: Ref<ChatGenerationStatus>
  currentConversationId: Ref<number | undefined>
  errorMessage: Ref<string>
  sendMessage: (question: string) => Promise<void>
  stopGeneration: () => void
  loadHistory: (conversationId?: number) => Promise<void>
  clearConversation: () => void
}

export function useChat(
  knowledgeBaseId: Ref<number>,
  routeConversationId: Ref<number | undefined>,
): UseChatResult {
  const router = useRouter()
  const messages = ref<ChatMessageItem[]>([])
  const messagesLoading = ref(false)
  const generationStatus = ref<ChatGenerationStatus>('idle')
  const currentConversationId = ref<number | undefined>(undefined)
  const errorMessage = ref('')
  let abortController: AbortController | undefined

  async function loadHistory(conversationId?: number): Promise<void> {
    if (isGenerating()) {
      stopGeneration()
    }

    errorMessage.value = ''

    if (conversationId === undefined) {
      currentConversationId.value = undefined
      messages.value = []
      generationStatus.value = 'idle'
      return
    }

    messagesLoading.value = true

    try {
      const history = await listMessages(conversationId)
      messages.value = history.map(toChatMessageItem)
      currentConversationId.value = conversationId
      generationStatus.value = 'idle'
    } catch (error: unknown) {
      messages.value = []
      currentConversationId.value = undefined
      generationStatus.value = 'error'
      errorMessage.value = getSafeErrorMessage(error)
      await replaceChatUrl(undefined)
    } finally {
      messagesLoading.value = false
    }
  }

  async function sendMessage(question: string): Promise<void> {
    const trimmedQuestion = question.trim()

    if (
      trimmedQuestion.length === 0 ||
      knowledgeBaseId.value <= 0 ||
      isGenerating()
    ) {
      return
    }

    errorMessage.value = ''
    generationStatus.value = 'connecting'
    abortController = new AbortController()

    const userMessage: ChatMessageItem = {
      id: null,
      role: 'user',
      content: trimmedQuestion,
      status: 'completed',
      errorMessage: null,
      references: [],
      createdAt: new Date().toISOString(),
    }
    const assistantMessage: ChatMessageItem = {
      id: null,
      role: 'assistant',
      content: '',
      status: 'streaming',
      errorMessage: null,
      references: [],
      createdAt: new Date().toISOString(),
    }

    const userMessageIndex = messages.value.length
    const assistantMessageIndex = userMessageIndex + 1
    messages.value.push(userMessage, assistantMessage)

    await sendChatMessage(
      knowledgeBaseId.value,
      {
        question: trimmedQuestion,
        conversationId: currentConversationId.value,
      },
      {
        onMetadata: (data) => {
          updateMessage(userMessageIndex, { id: data.userMessageId })
          currentConversationId.value = data.conversationId
          generationStatus.value = 'generating'
          void replaceChatUrl(data.conversationId)
        },
        onToken: (data) => {
          generationStatus.value = 'generating'
          appendAssistantContent(assistantMessageIndex, data.delta)
        },
        onReferences: (data) => {
          updateMessage(assistantMessageIndex, { references: data })
        },
        onDone: (data) => {
          updateMessage(assistantMessageIndex, {
            id: data.assistantMessageId,
            status: 'completed',
            errorMessage: null,
          })
          generationStatus.value = 'completed'
        },
        onError: (data) => {
          markAssistantFailed(assistantMessageIndex, data.message)
          generationStatus.value = 'error'
          errorMessage.value = data.message
        },
        onNetworkError: (error) => {
          const message = getSafeErrorMessage(error)
          markAssistantFailed(assistantMessageIndex, message)
          generationStatus.value = 'error'
          errorMessage.value = message
        },
      },
      abortController.signal,
    )

    const finishedStatus: ChatGenerationStatus = generationStatus.value

    if (finishedStatus === 'connecting') {
      markAssistantFailed(assistantMessageIndex, '连接已中断')
      generationStatus.value = 'error'
      errorMessage.value = '连接已中断'
    } else if (finishedStatus === 'generating') {
      markAssistantFailed(assistantMessageIndex, '生成已中断')
      generationStatus.value = 'error'
      errorMessage.value = '生成已中断'
    }

    abortController = undefined
  }

  function stopGeneration(): void {
    if (abortController === undefined) {
      return
    }

    abortController.abort()
    abortController = undefined
    generationStatus.value = 'aborted'
    errorMessage.value = '已停止生成'

    const assistantMessageIndex = findLatestStreamingAssistantIndex()

    if (assistantMessageIndex !== null) {
      markAssistantFailed(assistantMessageIndex, '已停止生成')
    }
  }

  function clearConversation(): void {
    if (isGenerating()) {
      stopGeneration()
    }

    messages.value = []
    currentConversationId.value = undefined
    generationStatus.value = 'idle'
    errorMessage.value = ''
    void replaceChatUrl(undefined)
  }

  function isGenerating(): boolean {
    return (
      generationStatus.value === 'connecting' ||
      generationStatus.value === 'generating'
    )
  }

  function findLatestStreamingAssistantIndex(): number | null {
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const message = messages.value[index]

      if (
        message !== undefined &&
        message.role === 'assistant' &&
        message.status === 'streaming'
      ) {
        return index
      }
    }

    return null
  }

  function updateMessage(
    index: number,
    patch: Partial<ChatMessageItem>,
  ): void {
    const current = messages.value[index]

    if (current === undefined) {
      return
    }

    messages.value[index] = { ...current, ...patch }
  }

  function appendAssistantContent(index: number, delta: string): void {
    const current = messages.value[index]

    if (current === undefined || current.role !== 'assistant') {
      return
    }

    messages.value[index] = {
      ...current,
      content: current.content + delta,
    }
  }

  function markAssistantFailed(index: number, message: string): void {
    updateMessage(index, {
      status: 'failed',
      errorMessage: message,
    })
  }

  async function replaceChatUrl(conversationId?: number): Promise<void> {
    if (knowledgeBaseId.value <= 0) {
      return
    }

    await router.replace({
      path: `/knowledge-bases/${knowledgeBaseId.value}/chat`,
      query:
        conversationId === undefined
          ? {}
          : { conversationId: String(conversationId) },
    })
  }

  watch(
    routeConversationId,
    (conversationId) => {
      if (
        conversationId === currentConversationId.value &&
        messages.value.length > 0
      ) {
        return
      }

      void loadHistory(conversationId)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (abortController !== undefined) {
      abortController.abort()
      abortController = undefined
    }
  })

  return {
    messages,
    messagesLoading,
    generationStatus,
    currentConversationId,
    errorMessage,
    sendMessage,
    stopGeneration,
    loadHistory,
    clearConversation,
  }
}

function toChatMessageItem(message: ChatMessageData): ChatMessageItem {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    errorMessage: message.errorMessage,
    references: message.references,
    createdAt: message.createdAt,
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return '当前会话正在生成回答'
  }

  if (error instanceof ApiError && error.status === 404) {
    return '会话或知识库不存在'
  }

  if (error instanceof ApiError && error.status === 400) {
    return error.message
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return '网络连接失败'
}
