<script setup lang="ts">
import {
  Button,
  Popconfirm,
  Table,
  Tag,
} from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'

import type { KnowledgeDocument } from '../types/document'
import {
  formatDateTime,
  formatFileSize,
} from '../utils/format'
import DocumentStatusTag from './DocumentStatusTag.vue'

defineProps<{
  documents: KnowledgeDocument[]
  loading: boolean
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const columns: TableColumnsType<KnowledgeDocument> = [
  {
    title: '文件名',
    dataIndex: 'fileName',
    key: 'fileName',
    ellipsis: true,
  },
  {
    title: '类型',
    dataIndex: 'fileExt',
    key: 'fileExt',
    width: 90,
  },
  {
    title: '状态',
    key: 'status',
    width: 130,
  },
  {
    title: '切片数',
    dataIndex: 'chunkCount',
    key: 'chunkCount',
    width: 100,
  },
  {
    title: '大小',
    key: 'fileSize',
    width: 120,
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 170,
  },
  {
    title: '操作',
    key: 'action',
    width: 96,
    fixed: 'right',
  },
]

function handleDelete(id: number): void {
  emit('delete', id)
}
</script>

<template>
  <Table
    :columns="columns"
    :data-source="documents"
    :loading="loading"
    :pagination="{ pageSize: 10, hideOnSinglePage: true }"
    row-key="id"
    size="middle"
    :scroll="{ x: 760 }"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'fileName'">
        <span class="file-name">{{ record.fileName }}</span>
      </template>
      <template v-else-if="column.key === 'fileExt'">
        <Tag>{{ record.fileExt.toUpperCase() }}</Tag>
      </template>
      <template v-else-if="column.key === 'status'">
        <DocumentStatusTag
          :status="record.status"
          :error-message="record.errorMessage"
        />
      </template>
      <template v-else-if="column.key === 'fileSize'">
        {{ formatFileSize(record.fileSize) }}
      </template>
      <template v-else-if="column.key === 'createdAt'">
        {{ formatDateTime(record.createdAt) }}
      </template>
      <template v-else-if="column.key === 'action'">
        <Popconfirm
          title="确认删除该文档？"
          ok-text="删除"
          cancel-text="取消"
          ok-type="danger"
          @confirm="handleDelete(record.id)"
        >
          <Button danger size="small">删除</Button>
        </Popconfirm>
      </template>
    </template>
  </Table>
</template>

<style scoped>
.file-name {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}
</style>
