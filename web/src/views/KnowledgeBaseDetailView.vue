<script setup lang="ts">
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Result,
  Skeleton,
  Space,
  Tag,
  message,
} from 'ant-design-vue'
import {
  computed,
  ref,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'

import { getKnowledgeBase } from '../api/knowledge-base'
import DocumentTable from '../components/DocumentTable.vue'
import DocumentUploader from '../components/DocumentUploader.vue'
import { useDocuments } from '../composables/use-documents'
import type { KnowledgeBase } from '../types/knowledge-base'
import { formatDateTime } from '../utils/format'

const props = defineProps<{
  id: number
}>()

const router = useRouter()
const knowledgeBaseId = computed(() =>
  Number.isInteger(props.id) && props.id > 0 ? props.id : 0,
)
const knowledgeBase = ref<KnowledgeBase | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

const {
  documents,
  loading: documentsLoading,
  refreshing,
  errorMessage: documentsError,
  hasProcessingDocuments,
  fetchDocuments,
  remove: removeDocument,
} = useDocuments(knowledgeBaseId)

watch(
  knowledgeBaseId,
  () => {
    void fetchKnowledgeBaseDetail()
  },
  { immediate: true },
)

async function fetchKnowledgeBaseDetail(): Promise<void> {
  if (knowledgeBaseId.value <= 0) {
    knowledgeBase.value = null
    detailError.value = '知识库不存在'
    return
  }

  detailLoading.value = true
  detailError.value = ''

  try {
    knowledgeBase.value = await getKnowledgeBase(knowledgeBaseId.value)
  } catch (error: unknown) {
    knowledgeBase.value = null
    detailError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function backToList(): void {
  void router.push('/knowledge-bases')
}

function enterChat(): void {
  if (knowledgeBaseId.value <= 0) {
    return
  }

  void router.push(`/knowledge-bases/${knowledgeBaseId.value}/chat`)
}

function handleUploaded(): void {
  void fetchDocuments({ silent: true })
  void fetchKnowledgeBaseDetail()
}

async function handleDeleteDocument(id: number): Promise<void> {
  try {
    await removeDocument(id)
    message.success('文档已删除')
    await fetchKnowledgeBaseDetail()
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
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
      <Button type="primary" @click="backToList">返回列表</Button>
    </template>
  </Result>

  <div v-else-if="knowledgeBase" class="page">
    <div class="page-header">
      <div>
        <h1>{{ knowledgeBase.name }}</h1>
        <p>{{ knowledgeBase.description || '暂无描述' }}</p>
      </div>
      <Space wrap>
        <Button @click="backToList">返回列表</Button>
        <Button type="primary" @click="enterChat">进入对话</Button>
      </Space>
    </div>

    <Card>
      <Descriptions bordered :column="{ xs: 1, sm: 2, md: 3 }">
        <DescriptionsItem label="文档数">
          {{ knowledgeBase.documentCount }}
        </DescriptionsItem>
        <DescriptionsItem label="创建时间">
          {{ formatDateTime(knowledgeBase.createdAt) }}
        </DescriptionsItem>
        <DescriptionsItem label="更新时间">
          {{ formatDateTime(knowledgeBase.updatedAt) }}
        </DescriptionsItem>
      </Descriptions>
    </Card>

    <Card>
      <div class="section-header">
        <h2>文档</h2>
        <Space v-if="refreshing || hasProcessingDocuments" size="small">
          <Tag v-if="refreshing" color="blue">刷新中</Tag>
          <Tag v-if="hasProcessingDocuments" color="processing">
            处理中
          </Tag>
        </Space>
      </div>

      <DocumentUploader
        :knowledge-base-id="knowledgeBaseId"
        @uploaded="handleUploaded"
      />

      <Alert
        v-if="documentsError"
        class="section-alert"
        type="error"
        :message="documentsError"
        show-icon
      />

      <DocumentTable
        :documents="documents"
        :loading="documentsLoading"
        @delete="handleDeleteDocument"
      />
    </Card>
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

.page-header h1,
.section-header h2 {
  margin: 0;
}

.page-header h1 {
  font-size: 24px;
  line-height: 1.3;
}

.page-header p {
  margin: 6px 0 0;
  color: rgba(0, 0, 0, 0.52);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.section-header h2 {
  font-size: 18px;
}

.section-alert {
  margin: 16px 0;
}

@media (max-width: 640px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
