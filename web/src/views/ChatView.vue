<script setup lang="ts">
import {
  Alert,
  Button,
  Drawer,
  Result,
  Skeleton,
  message,
} from 'ant-design-vue'
import {
  computed,
  ref,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'

import { getKnowledgeBase } from '../api/knowledge-base'
import ChatInput from '../components/ChatInput.vue'
import ConversationList from '../components/ConversationList.vue'
import MessageList from '../components/MessageList.vue'
import { useChat } from '../composables/use-chat'
import { useConversations } from '../composables/use-conversations'
import type { KnowledgeBase } from '../types/knowledge-base'
import { formatDateTime } from '../utils/format'

const props = defineProps<{
  knowledgeBaseId: number
  conversationId?: number
}>()

const router = useRouter()
const validKnowledgeBaseId = computed(() =>
  Number.isInteger(props.knowledgeBaseId) && props.knowledgeBaseId > 0
    ? props.knowledgeBaseId
    : 0,
)
const routeConversationId = computed(() =>
  props.conversationId !== undefined &&
  Number.isInteger(props.conversationId) &&
  props.conversationId > 0
    ? props.conversationId
    : undefined,
)

const knowledgeBase = ref<KnowledgeBase | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const conversationDrawerOpen = ref(false)

const {
  conversations,
  loading: conversationsLoading,
  errorMessage: conversationsError,
  refreshConversations,
  removeConversation,
} = useConversations(validKnowledgeBaseId)

const {
  messages,
  messagesLoading,
  generationStatus,
  currentConversationId,
  errorMessage: chatError,
  loadHistory,
  sendMessage,
  stopGeneration,
  clearConversation,
} = useChat(validKnowledgeBaseId, routeConversationId)

const isGenerating = computed(() =>
  generationStatus.value === 'connecting' || generationStatus.value === 'generating',
)
const currentConversationTitle = computed(() => {
  const current = conversations.value.find(
    (conversation) => conversation.id === currentConversationId.value,
  )

  return current?.title ?? '新会话'
})

watch(
  validKnowledgeBaseId,
  () => {
    void fetchKnowledgeBaseDetail()
  },
  { immediate: true },
)

watch(
  currentConversationId,
  (id, oldId) => {
    if (id !== undefined && id !== oldId) {
      void refreshConversations()
    }
  },
)

async function fetchKnowledgeBaseDetail(): Promise<void> {
  if (validKnowledgeBaseId.value <= 0) {
    knowledgeBase.value = null
    detailError.value = '知识库不存在'
    return
  }

  detailLoading.value = true
  detailError.value = ''

  try {
    knowledgeBase.value = await getKnowledgeBase(validKnowledgeBaseId.value)
  } catch (error: unknown) {
    knowledgeBase.value = null
    detailError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function backToDetail(): void {
  void router.push(`/knowledge-bases/${validKnowledgeBaseId.value}`)
}

function openConversationDrawer(): void {
  conversationDrawerOpen.value = true
}

function closeConversationDrawer(): void {
  conversationDrawerOpen.value = false
}

function handleNewConversation(): void {
  if (isGenerating.value) {
    message.warning('回答生成中，停止后再切换会话')
    return
  }

  clearConversation()
  closeConversationDrawer()
}

async function handleSelectConversation(conversationId: number): Promise<void> {
  if (isGenerating.value) {
    message.warning('回答生成中，停止后再切换会话')
    return
  }

  closeConversationDrawer()
  await router.replace({
    path: `/knowledge-bases/${validKnowledgeBaseId.value}/chat`,
    query: { conversationId: String(conversationId) },
  })
  await loadHistory(conversationId)
}

async function handleDeleteConversation(conversationId: number): Promise<void> {
  if (isGenerating.value) {
    message.warning('回答生成中，停止后再删除会话')
    return
  }

  try {
    await removeConversation(conversationId)

    if (currentConversationId.value === conversationId) {
      clearConversation()
    }

    message.success('会话已删除')
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function handleSend(question: string): Promise<void> {
  await sendMessage(question)
  await refreshConversations()
}
</script>

<template>
  <Skeleton v-if="detailLoading && knowledgeBase === null" active />

  <Result
    v-else-if="detailError"
    status="error"
    :title="detailError"
  >
    <template #extra>
      <Button type="primary" @click="backToDetail">返回知识库</Button>
    </template>
  </Result>

  <div v-else-if="knowledgeBase" class="chat-page">
    <div class="chat-header">
      <div>
        <h1>{{ knowledgeBase.name }}</h1>
        <p>
          {{ currentConversationTitle }}
          <span>更新于 {{ formatDateTime(knowledgeBase.updatedAt) }}</span>
        </p>
      </div>
      <div class="chat-header-actions">
        <Button class="mobile-conversation-button" @click="openConversationDrawer">
          会话
        </Button>
        <Button @click="backToDetail">返回知识库</Button>
      </div>
    </div>

    <Alert
      v-if="chatError"
      class="chat-alert"
      :type="generationStatus === 'aborted' ? 'info' : 'error'"
      :message="chatError"
      show-icon
    />

    <div class="chat-layout">
      <ConversationList
        class="chat-sidebar"
        :conversations="conversations"
        :current-conversation-id="currentConversationId"
        :loading="conversationsLoading"
        :error-message="conversationsError"
        @new="handleNewConversation"
        @select="handleSelectConversation"
        @delete="handleDeleteConversation"
      />

      <main class="chat-main">
        <MessageList
          :messages="messages"
          :loading="messagesLoading"
          :status="generationStatus"
        />
        <ChatInput
          :status="generationStatus"
          @send="handleSend"
          @stop="stopGeneration"
        />
      </main>
    </div>

    <Drawer
      v-model:open="conversationDrawerOpen"
      title="会话"
      placement="left"
      :width="300"
      :body-style="{ padding: 0 }"
    >
      <ConversationList
        :conversations="conversations"
        :current-conversation-id="currentConversationId"
        :loading="conversationsLoading"
        :error-message="conversationsError"
        @new="handleNewConversation"
        @select="handleSelectConversation"
        @delete="handleDeleteConversation"
      />
    </Drawer>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  min-height: calc(100vh - 104px);
  flex-direction: column;
  gap: 14px;
}

.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.chat-header h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
}

.chat-header p {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 6px 0 0;
  color: rgba(0, 0, 0, 0.52);
}

.chat-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-alert {
  flex: 0 0 auto;
}

.chat-layout {
  display: grid;
  min-height: 560px;
  flex: 1;
  grid-template-columns: 280px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #ffffff;
}

.chat-sidebar {
  min-width: 0;
}

.chat-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.mobile-conversation-button {
  display: none;
}

@media (max-width: 800px) {
  .chat-page {
    min-height: calc(100vh - 88px);
  }

  .chat-header {
    align-items: stretch;
    flex-direction: column;
  }

  .chat-layout {
    min-height: 560px;
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-sidebar {
    display: none;
  }

  .mobile-conversation-button {
    display: inline-flex;
  }
}
</style>
