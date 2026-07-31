<script setup lang="ts">
import {
  Progress,
  Upload,
  UploadDragger,
  message,
} from 'ant-design-vue'
import type { UploadRequestOption } from 'ant-design-vue/es/vc-upload/interface'
import { ref } from 'vue'

import { uploadDocument } from '../api/document'
import { ApiError } from '../api/http'
import type { KnowledgeDocument } from '../types/document'
import { isDuplicateDocumentDetails } from '../types/document'
import {
  ACCEPT_DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  MAX_DOCUMENT_FILE_SIZE_MB,
  isAllowedDocumentFile,
} from '../utils/document-file'

const props = defineProps<{
  knowledgeBaseId: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  uploaded: [document: KnowledgeDocument]
}>()

const uploading = ref(false)
const uploadPercent = ref(0)

function beforeUpload(file: File): boolean | string {
  if (!isAllowedDocumentFile(file)) {
    message.error('仅支持 PDF、Markdown、TXT 文件')
    return Upload.LIST_IGNORE
  }

  if (file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    message.error(`文件大小不能超过 ${MAX_DOCUMENT_FILE_SIZE_MB}MB`)
    return Upload.LIST_IGNORE
  }

  return true
}

function customRequest(
  options: UploadRequestOption<KnowledgeDocument>,
): void {
  void submitFile(options)
}

async function submitFile(
  options: UploadRequestOption<KnowledgeDocument>,
): Promise<void> {
  const file = options.file

  if (!(file instanceof File)) {
    const error = new Error('文件无效')
    message.error(error.message)
    options.onError?.(error)
    return
  }

  uploading.value = true
  uploadPercent.value = 0

  try {
    const created = await uploadDocument(
      props.knowledgeBaseId,
      file,
      (percent) => {
        uploadPercent.value = percent
        options.onProgress?.({ percent })
      },
    )

    uploadPercent.value = 100
    message.success('文档已上传')
    options.onSuccess?.(created)
    emit('uploaded', created)
  } catch (error: unknown) {
    const uploadError = new Error(getUploadErrorMessage(error))
    message.error(uploadError.message)
    options.onError?.(uploadError)
  } finally {
    uploading.value = false
  }
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && isDuplicateDocumentDetails(error.details)) {
      return `文件已存在：${error.details.fileName}（状态：${error.details.status}）`
    }

    return error.message
  }

  return error instanceof Error ? error.message : '上传失败'
}
</script>

<template>
  <div class="document-uploader">
    <UploadDragger
      name="file"
      :accept="ACCEPT_DOCUMENT_EXTENSIONS"
      :before-upload="beforeUpload"
      :custom-request="customRequest"
      :disabled="disabled || uploading"
      :max-count="1"
      :multiple="false"
      :show-upload-list="false"
    >
      <p class="upload-title">上传 PDF、Markdown 或 TXT 文档</p>
      <p class="upload-hint">单文件最大 {{ MAX_DOCUMENT_FILE_SIZE_MB }}MB</p>
    </UploadDragger>
    <Progress
      v-if="uploading"
      class="upload-progress"
      :percent="uploadPercent"
      size="small"
      status="active"
    />
  </div>
</template>

<style scoped>
.document-uploader {
  width: 100%;
}

.upload-title {
  margin: 10px 0 4px;
  color: rgba(0, 0, 0, 0.82);
  font-weight: 500;
}

.upload-hint {
  margin: 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}

.upload-progress {
  margin-top: 12px;
}
</style>
