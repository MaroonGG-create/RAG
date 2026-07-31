<script setup lang="ts">
import { Empty, Spin } from 'ant-design-vue'
import { nextTick, ref, watch } from 'vue'

import type { ChatGenerationStatus, ChatMessageItem } from '../types/chat'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{
  messages: ChatMessageItem[]
  loading: boolean
  status: ChatGenerationStatus
}>()

const listRef = ref<HTMLDivElement | null>(null)

watch(
  () => [props.messages.length, props.status, props.messages.at(-1)?.content],
  () => {
    void scrollToBottom()
  },
  { flush: 'post' },
)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (listRef.value === null) {
    return
  }

  listRef.value.scrollTop = listRef.value.scrollHeight
}
</script>

<template>
  <div ref="listRef" class="message-list">
    <div v-if="loading" class="message-loading">
      <Spin />
    </div>

    <Empty
      v-else-if="messages.length === 0"
      class="message-empty"
      description="输入问题开始对话"
    />

    <template v-else>
      <MessageBubble
        v-for="(message, index) in messages"
        :key="message.id ?? `${message.role}-${index}`"
        :message="message"
      />
    </template>
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 18px;
  background: #f5f7fb;
}

.message-loading,
.message-empty {
  margin: auto;
}
</style>
