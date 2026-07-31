import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendChatMessage } from '../../api/chat'
import { listMessages } from '../../api/conversation'
import { ApiError } from '../../api/http'
import type { ChatMessageData } from '../../types/conversation'
import { useChat } from '../use-chat'

const routerReplace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplace }),
}))

vi.mock('../../api/chat', () => ({
  sendChatMessage: vi.fn(),
}))

vi.mock('../../api/conversation', () => ({
  listMessages: vi.fn(),
}))

interface Harness {
  result: ReturnType<typeof useChat>
  knowledgeBaseId: Ref<number>
  routeConversationId: Ref<number | undefined>
  wrapper: VueWrapper
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function mountUseChat(
  initialKnowledgeBaseId = 1,
  initialConversationId?: number,
): Harness {
  const knowledgeBaseId = ref(initialKnowledgeBaseId)
  const routeConversationId = ref<number | undefined>(initialConversationId)
  let result: ReturnType<typeof useChat> | undefined

  const wrapper = mount(
    defineComponent({
      setup() {
        result = useChat(knowledgeBaseId, routeConversationId)
        return () => null
      },
    }),
  )

  if (result === undefined) {
    throw new Error('useChat 初始化失败')
  }

  return { result, knowledgeBaseId, routeConversationId, wrapper }
}

function createHistoryMessage(
  overrides: Partial<ChatMessageData> = {},
): ChatMessageData {
  return {
    id: 1,
    role: 'assistant',
    content: 'history',
    status: 'completed',
    errorMessage: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    references: [],
    ...overrides,
  }
}

describe('useChat', () => {
  beforeEach(() => {
    vi.mocked(sendChatMessage).mockReset()
    vi.mocked(listMessages).mockReset()
    routerReplace.mockReset()
    vi.mocked(listMessages).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with idle state and empty messages', async () => {
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    expect(result.generationStatus.value).toBe('idle')
    expect(result.messages.value).toEqual([])
    wrapper.unmount()
  })

  it('updates messages during a successful streaming send', async () => {
    vi.mocked(sendChatMessage).mockImplementation(
      async (_knowledgeBaseId, _params, callbacks) => {
        callbacks.onMetadata?.({ conversationId: 9, userMessageId: 101 })
        callbacks.onToken?.({ delta: '你' })
        callbacks.onToken?.({ delta: '好' })
        callbacks.onReferences?.([
          {
            chunkId: 1,
            documentId: 2,
            documentName: 'manual.pdf',
            pageNo: 3,
            content: 'content',
            score: 0.9,
          },
        ])
        callbacks.onDone?.({ assistantMessageId: 202 })
      },
    )
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    await result.sendMessage('  问题  ')

    expect(result.currentConversationId.value).toBe(9)
    expect(result.generationStatus.value).toBe('completed')
    expect(result.messages.value).toMatchObject([
      { id: 101, role: 'user', content: '问题' },
      {
        id: 202,
        role: 'assistant',
        content: '你好',
        status: 'completed',
        references: [{ documentName: 'manual.pdf', pageNo: 3 }],
      },
    ])
    expect(routerReplace).toHaveBeenCalledWith({
      path: '/knowledge-bases/1/chat',
      query: { conversationId: '9' },
    })
    wrapper.unmount()
  })

  it('ignores empty questions', async () => {
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    await result.sendMessage('   ')

    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(result.generationStatus.value).toBe('idle')
    wrapper.unmount()
  })

  it('prevents duplicate submit while generating', async () => {
    let resolveSend: () => void = () => undefined
    vi.mocked(sendChatMessage).mockImplementation(
      async (_knowledgeBaseId, _params, callbacks) => {
        callbacks.onMetadata?.({ conversationId: 9, userMessageId: 101 })
        await new Promise<void>((resolve) => {
          resolveSend = resolve
        })
      },
    )
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    const first = result.sendMessage('first')
    await nextTick()
    await result.sendMessage('second')
    resolveSend()
    await first

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('aborts active generation and marks streaming answer failed', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveSend: () => void = () => undefined
    vi.mocked(sendChatMessage).mockImplementation(
      async (_knowledgeBaseId, _params, callbacks, signal) => {
        capturedSignal = signal
        callbacks.onMetadata?.({ conversationId: 9, userMessageId: 101 })
        callbacks.onToken?.({ delta: 'partial' })
        await new Promise<void>((resolve) => {
          resolveSend = resolve
        })
      },
    )
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    const sending = result.sendMessage('question')
    await nextTick()
    result.stopGeneration()
    resolveSend()
    await sending

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.generationStatus.value).toBe('aborted')
    expect(result.errorMessage.value).toBe('已停止生成')
    expect(result.messages.value[1]).toMatchObject({
      status: 'failed',
      errorMessage: '已停止生成',
    })
    wrapper.unmount()
  })

  it('loads conversation history', async () => {
    vi.mocked(listMessages).mockResolvedValue([
      createHistoryMessage({ id: 5, content: 'old answer' }),
    ])
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    await result.loadHistory(12)

    expect(result.currentConversationId.value).toBe(12)
    expect(result.messages.value).toMatchObject([
      { id: 5, content: 'old answer' },
    ])
    wrapper.unmount()
  })

  it('clears state when history loading fails with a missing conversation', async () => {
    vi.mocked(listMessages).mockRejectedValue(
      new ApiError('missing', { status: 404 }),
    )
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    await result.loadHistory(404)

    expect(result.currentConversationId.value).toBeUndefined()
    expect(result.messages.value).toEqual([])
    expect(result.generationStatus.value).toBe('error')
    expect(result.errorMessage.value).toBe('会话或知识库不存在')
    expect(routerReplace).toHaveBeenCalledWith({
      path: '/knowledge-bases/1/chat',
      query: {},
    })
    wrapper.unmount()
  })

  it('maps SSE error events to failed assistant state', async () => {
    vi.mocked(sendChatMessage).mockImplementation(
      async (_knowledgeBaseId, _params, callbacks) => {
        callbacks.onMetadata?.({ conversationId: 9, userMessageId: 101 })
        callbacks.onError?.({ message: '问答服务暂时不可用' })
      },
    )
    const { result, wrapper } = mountUseChat()
    await flushPromises()

    await result.sendMessage('question')

    expect(result.generationStatus.value).toBe('error')
    expect(result.errorMessage.value).toBe('问答服务暂时不可用')
    expect(result.messages.value[1]).toMatchObject({
      status: 'failed',
      errorMessage: '问答服务暂时不可用',
    })
    wrapper.unmount()
  })
})
