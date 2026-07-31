<script setup lang="ts">
import {
  Button,
  Result,
} from 'ant-design-vue'
import { useRouter } from 'vue-router'

const props = defineProps<{
  knowledgeBaseId: number
}>()

const router = useRouter()

function backToDetail(): void {
  void router.push(`/knowledge-bases/${props.knowledgeBaseId}`)
}
</script>

<template>
  <Result status="info" title="对话页面将在 T13 实现">
    <template #extra>
      <Button type="primary" @click="backToDetail">返回知识库详情</Button>
    </template>
  </Result>
</template>
