<script setup lang="ts">
import {
  Form,
  FormItem,
  Input,
  Modal,
  Textarea,
  message,
} from 'ant-design-vue'
import { ref, watch } from 'vue'

import { createKnowledgeBase } from '../api/knowledge-base'
import { ApiError } from '../api/http'
import type { KnowledgeBase } from '../types/knowledge-base'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  cancel: []
  success: [knowledgeBase: KnowledgeBase]
}>()

const name = ref('')
const description = ref('')
const submitting = ref(false)
const nameError = ref('')
const descriptionError = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm()
    }
  },
)

function resetForm(): void {
  name.value = ''
  description.value = ''
  nameError.value = ''
  descriptionError.value = ''
}

function validateForm(): boolean {
  const trimmedName = name.value.trim()
  const trimmedDescription = description.value.trim()
  nameError.value = ''
  descriptionError.value = ''

  if (trimmedName.length === 0) {
    nameError.value = '请输入知识库名称'
  } else if (trimmedName.length > 100) {
    nameError.value = '知识库名称不能超过 100 个字符'
  }

  if (trimmedDescription.length > 500) {
    descriptionError.value = '描述不能超过 500 个字符'
  }

  return nameError.value.length === 0 && descriptionError.value.length === 0
}

async function handleOk(): Promise<void> {
  if (!validateForm()) {
    return
  }

  submitting.value = true

  try {
    const trimmedDescription = description.value.trim()
    const created = await createKnowledgeBase({
      name: name.value.trim(),
      description:
        trimmedDescription.length > 0 ? trimmedDescription : undefined,
    })
    message.success('知识库已创建')
    emit('success', created)
    resetForm()
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      nameError.value = error.message
      return
    }

    message.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    submitting.value = false
  }
}

function handleCancel(): void {
  if (submitting.value) {
    return
  }

  emit('cancel')
}
</script>

<template>
  <Modal
    :open="open"
    title="新建知识库"
    ok-text="创建"
    cancel-text="取消"
    :confirm-loading="submitting"
    destroy-on-close
    @ok="handleOk"
    @cancel="handleCancel"
  >
    <Form layout="vertical">
      <FormItem
        label="名称"
        required
        :validate-status="nameError ? 'error' : undefined"
        :help="nameError || undefined"
      >
        <Input
          v-model:value="name"
          :maxlength="100"
          show-count
          placeholder="请输入知识库名称"
          @press-enter="handleOk"
        />
      </FormItem>
      <FormItem
        label="描述"
        :validate-status="descriptionError ? 'error' : undefined"
        :help="descriptionError || undefined"
      >
        <Textarea
          v-model:value="description"
          :maxlength="500"
          :rows="4"
          show-count
          placeholder="可选"
        />
      </FormItem>
    </Form>
  </Modal>
</template>
