<script setup lang="ts">
import { Alert, Button, Empty, Popconfirm, Spin } from 'ant-design-vue'

import type { Conversation } from '../types/conversation'
import { formatDateTime } from '../utils/format'

defineProps<{
  conversations: Conversation[]
  currentConversationId: number | undefined
  loading: boolean
  errorMessage: string
}>()

const emit = defineEmits<{
  new: []
  select: [conversationId: number]
  delete: [conversationId: number]
}>()
</script>

<template>
  <aside class="conversation-list">
    <div class="conversation-head">
      <h2>会话</h2>
      <Button size="small" type="primary" @click="emit('new')">新建</Button>
    </div>

    <Alert
      v-if="errorMessage"
      class="conversation-error"
      type="error"
      :message="errorMessage"
      show-icon
    />

    <div v-if="loading" class="conversation-loading">
      <Spin />
    </div>

    <Empty
      v-else-if="conversations.length === 0"
      class="conversation-empty"
      description="暂无会话"
    />

    <div v-else class="conversation-items">
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        role="button"
        tabindex="0"
        class="conversation-item"
        :class="{ active: conversation.id === currentConversationId }"
        @click="emit('select', conversation.id)"
        @keydown.enter="emit('select', conversation.id)"
        @keydown.space.prevent="emit('select', conversation.id)"
      >
        <span class="conversation-title">{{ conversation.title }}</span>
        <span class="conversation-time">{{ formatDateTime(conversation.updatedAt) }}</span>
        <Popconfirm
          title="确认删除该会话？"
          ok-text="删除"
          cancel-text="取消"
          @confirm.stop="emit('delete', conversation.id)"
        >
          <Button
            class="conversation-delete"
            size="small"
            danger
            @click.stop
          >
            删除
          </Button>
        </Popconfirm>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.conversation-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid #d9d9d9;
  background: #ffffff;
}

.conversation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid #f0f0f0;
}

.conversation-head h2 {
  margin: 0;
  font-size: 16px;
}

.conversation-error {
  margin: 12px;
}

.conversation-loading,
.conversation-empty {
  margin: auto;
}

.conversation-items {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding: 10px;
}

.conversation-item {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px;
  background: transparent;
  color: rgba(0, 0, 0, 0.88);
  text-align: left;
  cursor: pointer;
}

.conversation-item:hover,
.conversation-item.active {
  border-color: #91caff;
  background: #e6f4ff;
}

.conversation-title {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-time {
  overflow: hidden;
  grid-column: 1;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-delete {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}
</style>
