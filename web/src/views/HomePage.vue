<script setup lang="ts">
import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Tag,
  message,
} from 'ant-design-vue'
import { ref } from 'vue'
import { getHealth } from '../api/health'
import type { HealthResult } from '../types/health'

const loading = ref(false)
const health = ref<HealthResult | null>(null)

function handleCheck(): void {
  loading.value = true

  void getHealth()
    .then((result) => {
      health.value = result
    })
    .catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '健康检查失败')
    })
    .finally(() => {
      loading.value = false
    })
}
</script>

<template>
  <Card title="服务健康检查">
    <p class="description">检查后端服务与 MySQL 的连接状态。</p>
    <Button type="primary" :loading="loading" @click="handleCheck">
      检查服务状态
    </Button>

    <Descriptions
      v-if="health"
      class="health-result"
      title="检查结果"
      bordered
      :column="1"
    >
      <DescriptionsItem label="服务状态">
        <Tag :color="health.status === 'ok' ? 'success' : 'error'">
          {{ health.status }}
        </Tag>
      </DescriptionsItem>
      <DescriptionsItem label="数据库">
        <Tag :color="health.db === 'up' ? 'success' : 'error'">
          {{ health.db }}
        </Tag>
      </DescriptionsItem>
      <DescriptionsItem label="运行时间">
        {{ health.uptime }} 秒
      </DescriptionsItem>
    </Descriptions>
  </Card>
</template>

<style scoped>
.description {
  margin-top: 0;
  color: rgba(0, 0, 0, 0.65);
}

.health-result {
  margin-top: 24px;
}
</style>
