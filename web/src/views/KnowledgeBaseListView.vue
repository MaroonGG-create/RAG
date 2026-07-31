<script setup lang="ts">
import {
  Alert,
  Button,
  Col,
  Empty,
  Row,
  Spin,
  message,
} from 'ant-design-vue'
import { onMounted, ref } from 'vue'

import CreateKnowledgeBaseModal from '../components/CreateKnowledgeBaseModal.vue'
import KnowledgeBaseCard from '../components/KnowledgeBaseCard.vue'
import { useKnowledgeBases } from '../composables/use-knowledge-bases'
import type { KnowledgeBase } from '../types/knowledge-base'

const {
  knowledgeBases,
  loading,
  errorMessage,
  fetchKnowledgeBases,
  remove,
} = useKnowledgeBases()

const createModalOpen = ref(false)

onMounted(() => {
  void fetchKnowledgeBases()
})

function handleCreated(_knowledgeBase: KnowledgeBase): void {
  createModalOpen.value = false
  void fetchKnowledgeBases()
}

async function handleDelete(id: number): Promise<void> {
  try {
    await remove(id)
    message.success('知识库已删除')
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>知识库</h1>
        <p>管理文档集合和处理状态</p>
      </div>
      <Button type="primary" @click="createModalOpen = true">
        新建知识库
      </Button>
    </div>

    <Alert
      v-if="errorMessage"
      class="page-alert"
      type="error"
      :message="errorMessage"
      show-icon
    />

    <Spin :spinning="loading">
      <Row v-if="knowledgeBases.length > 0" :gutter="[16, 16]">
        <Col
          v-for="knowledgeBase in knowledgeBases"
          :key="knowledgeBase.id"
          :xs="24"
          :sm="12"
          :lg="8"
        >
          <KnowledgeBaseCard
            :knowledge-base="knowledgeBase"
            @delete="handleDelete"
          />
        </Col>
      </Row>
      <Empty v-else-if="!loading" description="暂无知识库" />
    </Spin>

    <CreateKnowledgeBaseModal
      :open="createModalOpen"
      @cancel="createModalOpen = false"
      @success="handleCreated"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
}

.page-header p {
  margin: 6px 0 0;
  color: rgba(0, 0, 0, 0.52);
}

.page-alert {
  margin-bottom: 4px;
}

@media (max-width: 640px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
