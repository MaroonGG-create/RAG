<script setup lang="ts">
import { Alert, Tag } from 'ant-design-vue'
import { computed } from 'vue'

import type { ChatMessageItem } from '../types/chat'
import { formatDateTime } from '../utils/format'
import ReferencePanel from './ReferencePanel.vue'

const props = defineProps<{
  message: ChatMessageItem
}>()

const isUser = computed(() => props.message.role === 'user')
const messageTime = computed(() =>
  props.message.createdAt === null ? '' : formatDateTime(props.message.createdAt),
)
const hasReferences = computed(() => props.message.references.length > 0)
const hasFailed = computed(() => props.message.status === 'failed')
</script>

<template>
  <div class="message-row" :class="{ user: isUser, assistant: !isUser }">
    <div class="message-bubble">
      <div class="message-head">
        <span>{{ isUser ? '我' : '助手' }}</span>
        <Tag v-if="message.status === 'streaming'" color="processing">生成中</Tag>
        <time v-if="messageTime">{{ messageTime }}</time>
      </div>

      <div class="message-content">
        <span v-if="message.content">{{ message.content }}</span>
        <span v-else-if="message.status === 'streaming'" class="muted">正在生成...</span>
      </div>

      <Alert
        v-if="hasFailed"
        class="message-error"
        type="error"
        :message="message.errorMessage || '回答生成失败'"
        show-icon
      />

      <ReferencePanel v-if="!isUser && hasReferences" :references="message.references" />
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  width: 100%;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message-bubble {
  width: min(760px, 86%);
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 12px 14px;
  background: #ffffff;
}

.message-row.user .message-bubble {
  border-color: #91caff;
  background: #e6f4ff;
}

.message-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: rgba(0, 0, 0, 0.52);
  font-size: 12px;
}

.message-head span {
  color: rgba(0, 0, 0, 0.82);
  font-weight: 600;
}

.message-head time {
  margin-left: auto;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(0, 0, 0, 0.88);
  font-size: 14px;
  line-height: 1.75;
}

.muted {
  color: rgba(0, 0, 0, 0.45);
}

.message-error {
  margin-top: 10px;
}

@media (max-width: 640px) {
  .message-bubble {
    width: 100%;
  }
}
</style>
