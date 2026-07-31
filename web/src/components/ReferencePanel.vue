<script setup lang="ts">
import { Button, Tag } from 'ant-design-vue'
import { computed, ref } from 'vue'

import type { ChatReference } from '../types/chat'

const props = defineProps<{
  references: ChatReference[]
}>()

const expanded = ref(false)
const visibleReferences = computed(() => props.references)

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function getContent(reference: ChatReference): string {
  return 'contentSnapshot' in reference ? reference.contentSnapshot : reference.content
}

function getChunkIndex(reference: ChatReference): number | null {
  return 'chunkIndex' in reference ? reference.chunkIndex : null
}

function formatPage(pageNo: number | null): string {
  return pageNo === null ? '无页码' : `第 ${pageNo} 页`
}

function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}
</script>

<template>
  <div v-if="visibleReferences.length > 0" class="reference-panel">
    <Button type="link" size="small" class="reference-toggle" @click="toggleExpanded">
      {{ expanded ? '收起引用' : `查看引用（${visibleReferences.length}）` }}
    </Button>

    <div v-if="expanded" class="reference-list">
      <div
        v-for="(reference, index) in visibleReferences"
        :key="`${reference.documentId}-${reference.chunkId}-${index}`"
        class="reference-item"
      >
        <div class="reference-meta">
          <strong>{{ reference.documentName }}</strong>
          <Tag>{{ formatPage(reference.pageNo) }}</Tag>
          <Tag color="blue">相似度 {{ formatScore(reference.score) }}</Tag>
          <Tag v-if="getChunkIndex(reference) !== null">
            #{{ getChunkIndex(reference) }}
          </Tag>
        </div>
        <p>{{ getContent(reference) }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reference-panel {
  margin-top: 10px;
}

.reference-toggle {
  height: auto;
  padding: 0;
}

.reference-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.reference-item {
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fafafa;
}

.reference-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}

.reference-meta strong {
  margin-right: 2px;
  color: rgba(0, 0, 0, 0.82);
}

.reference-item p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: rgba(0, 0, 0, 0.65);
  font-size: 13px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
</style>
