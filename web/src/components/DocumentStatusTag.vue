<script setup lang="ts">
import { computed } from 'vue'
import {
  Tag,
  Tooltip,
} from 'ant-design-vue'

import type { DocumentStatus } from '../types/document'

const props = defineProps<{
  status: DocumentStatus
  errorMessage?: string | null
}>()

const statusMeta: Record<
  DocumentStatus,
  { label: string; color: string }
> = {
  pending: { label: '待处理', color: 'default' },
  parsing: { label: '解析中', color: 'processing' },
  chunking: { label: '切片中', color: 'cyan' },
  embedding: { label: '向量化中', color: 'geekblue' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
}

const meta = computed(() => statusMeta[props.status])
const shouldShowError = computed(
  () => props.status === 'failed' && Boolean(props.errorMessage),
)
</script>

<template>
  <Tooltip v-if="shouldShowError" :title="errorMessage">
    <Tag :color="meta.color">{{ meta.label }}</Tag>
  </Tooltip>
  <Tag v-else :color="meta.color">{{ meta.label }}</Tag>
</template>
