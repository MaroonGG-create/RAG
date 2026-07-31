import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteConversation,
  listConversations,
} from '../../api/conversation'
import type { Conversation } from '../../types/conversation'
import { useConversations } from '../use-conversations'

vi.mock('../../api/conversation', () => ({
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
}))

interface Harness {
  result: ReturnType<typeof useConversations>
  knowledgeBaseId: Ref<number>
  wrapper: VueWrapper
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function createConversation(id: number): Conversation {
  return {
    id,
    title: `conversation-${id}`,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }
}

function mountUseConversations(knowledgeBaseIdValue = 1): Harness {
  const knowledgeBaseId = ref(knowledgeBaseIdValue)
  let result: ReturnType<typeof useConversations> | undefined

  const wrapper = mount(
    defineComponent({
      setup() {
        result = useConversations(knowledgeBaseId)
        return () => null
      },
    }),
  )

  if (result === undefined) {
    throw new Error('useConversations 初始化失败')
  }

  return { result, knowledgeBaseId, wrapper }
}

describe('useConversations', () => {
  beforeEach(() => {
    vi.mocked(listConversations).mockReset()
    vi.mocked(deleteConversation).mockReset()
    vi.mocked(listConversations).mockResolvedValue([createConversation(1)])
    vi.mocked(deleteConversation).mockResolvedValue()
  })

  it('fetches conversations for the current knowledge base', async () => {
    const { result, wrapper } = mountUseConversations(1)
    await flushPromises()

    expect(listConversations).toHaveBeenCalledWith(1)
    expect(result.conversations.value).toEqual([createConversation(1)])
    expect(result.loading.value).toBe(false)
    wrapper.unmount()
  })

  it('clears conversations when knowledgeBaseId is invalid', async () => {
    const { result, wrapper } = mountUseConversations(0)
    await flushPromises()

    expect(listConversations).not.toHaveBeenCalled()
    expect(result.conversations.value).toEqual([])
    wrapper.unmount()
  })

  it('stores readable error message when fetch fails', async () => {
    vi.mocked(listConversations).mockRejectedValue(new Error('network down'))
    const { result, wrapper } = mountUseConversations(1)
    await flushPromises()

    expect(result.errorMessage.value).toBe('network down')
    expect(result.loading.value).toBe(false)
    wrapper.unmount()
  })

  it('refreshes conversations after deletion', async () => {
    vi.mocked(listConversations)
      .mockResolvedValueOnce([createConversation(1)])
      .mockResolvedValueOnce([createConversation(2)])
    const { result, wrapper } = mountUseConversations(1)
    await flushPromises()

    await result.removeConversation(1)

    expect(deleteConversation).toHaveBeenCalledWith(1)
    expect(result.conversations.value).toEqual([createConversation(2)])
    wrapper.unmount()
  })
})
