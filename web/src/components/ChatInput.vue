<script setup lang="ts">
import { Button, Textarea } from 'ant-design-vue'
import { computed, ref } from 'vue'

import type { ChatGenerationStatus } from '../types/chat'

const props = defineProps<{
  status: ChatGenerationStatus
}>()

const emit = defineEmits<{
  send: [question: string]
  stop: []
}>()

const inputText = ref('')
const isGenerating = computed(() =>
  props.status === 'connecting' || props.status === 'generating',
)
const canSend = computed(() => inputText.value.trim().length > 0 && !isGenerating.value)

function submit(): void {
  if (!canSend.value) {
    return
  }

  const question = inputText.value.trim()
  inputText.value = ''
  emit('send', question)
}

function stop(): void {
  if (!isGenerating.value) {
    return
  }

  emit('stop')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return
  }

  event.preventDefault()
  submit()
}
</script>

<template>
  <div class="chat-input">
    <Textarea
      v-model:value="inputText"
      :auto-size="{ minRows: 2, maxRows: 6 }"
      :disabled="isGenerating"
      placeholder="输入问题"
      @keydown="handleKeydown"
    />
    <div class="chat-input-actions">
      <span>{{ isGenerating ? '正在生成回答' : 'Enter 发送，Shift + Enter 换行' }}</span>
      <Button v-if="isGenerating" danger @click="stop">停止</Button>
      <Button v-else type="primary" :disabled="!canSend" @click="submit">发送</Button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  border-top: 1px solid #d9d9d9;
  padding: 14px;
  background: #ffffff;
}

.chat-input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.chat-input-actions span {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

@media (max-width: 640px) {
  .chat-input-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
