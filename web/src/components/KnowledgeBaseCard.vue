<script setup lang="ts">
import {
  Button,
  Card,
  Popconfirm,
} from 'ant-design-vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import type { KnowledgeBase } from '../types/knowledge-base'
import { formatDateTime } from '../utils/format'

const props = defineProps<{
  knowledgeBase: KnowledgeBase
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const router = useRouter()

const description = computed(
  () => props.knowledgeBase.description || '暂无描述',
)

function openDetail(): void {
  void router.push(`/knowledge-bases/${props.knowledgeBase.id}`)
}

function handleDelete(): void {
  emit('delete', props.knowledgeBase.id)
}
</script>

<template>
  <Card hoverable class="knowledge-base-card" @click="openDetail">
    <template #title>
      <span class="knowledge-base-name">
        {{ knowledgeBase.name }}
      </span>
    </template>
    <template #extra>
      <span @click.stop>
        <Popconfirm
          title="确认删除该知识库？"
          ok-text="删除"
          cancel-text="取消"
          ok-type="danger"
          @confirm="handleDelete"
        >
          <Button danger size="small">删除</Button>
        </Popconfirm>
      </span>
    </template>

    <p
      class="knowledge-base-description"
      :class="{ muted: !knowledgeBase.description }"
    >
      {{ description }}
    </p>
    <div class="knowledge-base-meta">
      <span>文档 {{ knowledgeBase.documentCount }}</span>
      <span>创建 {{ formatDateTime(knowledgeBase.createdAt) }}</span>
    </div>
  </Card>
</template>

<style scoped>
.knowledge-base-card {
  height: 100%;
}

.knowledge-base-name {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.knowledge-base-description {
  min-height: 44px;
  margin: 0 0 20px;
  color: rgba(0, 0, 0, 0.72);
  line-height: 1.6;
}

.knowledge-base-description.muted {
  color: rgba(0, 0, 0, 0.38);
}

.knowledge-base-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: rgba(0, 0, 0, 0.48);
  font-size: 13px;
}
</style>
