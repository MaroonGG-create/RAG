# T12 前端知识库与文档管理 — Codex 执行指令

> 任务编号：T12（阶段 P9：前端知识库与文档管理）
> 前置条件：T11 已完成（结论：**通过**，见 `docs/reports/task-11-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v2.0 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T11 后快照）+ `docs/reports/task-11-completion.md`
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T11 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| Vue 3.5 + TypeScript 5.6 + Vite 5.4 | `web/package.json` | **不修改版本**。已有 `vue@^3.5.13`、`ant-design-vue@^4.2.6`、`axios@^1.8.4`、`vite@^5.4.11`、`vue-tsc@^2.1.10` |
| **vue-router** | 未安装 | **新增依赖**：`vue-router@^4.5`（总体方案 §3.1 已规划） |
| Pinia | 未安装 | **不安装**。T12 用 Vue composables 管理状态，不引入状态管理框架（用户禁止"新增复杂状态管理框架"） |
| Vite 配置 | `web/vite.config.ts` | **不修改**。已有 `port:5173`、`proxy '/api' → localhost:3000`、`envDir:'..'`（读根目录 `.env`） |
| TypeScript 配置 | `web/tsconfig.json` | **不修改**。`strict:true`、`noUnusedLocals:true`、`noUnusedParameters:true`、`noFallthroughCasesInSwitch:true` |
| 环境变量类型 | `web/env.d.ts` | **不修改**。已声明 `VITE_API_BASE_URL?: string` |
| Axios 实例 | `web/src/api/http.ts` | **允许修改**：增强错误拦截器，保留 HTTP 状态码和 `details` 字段（§五） |
| 响应解包逻辑 | `web/src/api/http.ts` | **不修改**。已有 `isApiResponse()` 检测 `{code,message,data}` 结构并解包为 `data`；204 无 body 时跳过解包 |
| 健康检查 API | `web/src/api/health.ts` | **不修改、不删除**。保留备用 |
| 健康检查类型 | `web/src/types/health.ts` | **不修改** |
| 健康检查页面 | `web/src/views/HomePage.vue` | **保留文件**。不再作为首页路由，改为 `/health` 独立路由（调试用） |
| 全局样式 | `web/src/App.vue` `<style>` | **允许修改**：重构为 Layout 布局，保留全局 reset |
| Ant Design Vue | `web/package.json` | **已安装**。4.2.6，按需导入组件（tree-shaking），不 `app.use(Antd)` |
| `ant-design-vue/dist/reset.css` | `web/src/main.ts` | **不修改**。已在 main.ts 中引入 |
| 后端 API 前缀 | `server/src/main.ts` | 全局前缀 `api`，前端 baseURL 为 `/api`（Vite proxy 转发） |
| 统一响应结构 | `server/src/common/interceptors/response.interceptor.ts` | 成功 `{code:0, message:'success', data}`；错误 `{code, message, details?}`；code = HTTP 状态码 |
| 文件上传限制 | `server/src/modules/document/storage/document-upload.config.ts` | 字段名 `file`；扩展名 `.pdf/.md/.txt`；大小上限 `MAX_FILE_SIZE_MB`（默认 20MB）；415 类型不符；413 超限 |
| `VITE_API_BASE_URL` | `.env.example` | 默认 `/api`，Vite 构建期注入 |
| pnpm workspace | `pnpm-workspace.yaml` | `packages: [server, web]`，命令 `pnpm --filter web dev/build/type-check` |
| 代码约定 | `web/src/` | 小写连字符文件名、显式返回类型、`catch` 用 `unknown`、禁显式 `any`、简短中文注释 |

**T11 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：前端开发不直接连 DB，但后端需正常启动才能联调。
2. **Docker daemon 可能无法启动**：前端纯静态开发不依赖 Docker，但后端 API 需要 MySQL + Qdrant。若后端不可用，前端可独立开发但无法端到端验收。
3. `pnpm --filter web ...` 会先打印 `No projects matched the filters`，但命令实际执行成功（已知问题，不影响）。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

1. 前端基础布局和路由（Vue Router 安装 + 配置）
2. 知识库列表页（卡片展示、空状态、Loading、错误提示）
3. 新建知识库（Modal 表单、名称重名校验提示）
4. 删除知识库（Popconfirm 确认、级联删除提示）
5. 知识库详情页（库信息头 + 文档管理区域）
6. 文档列表（表格展示、状态 Tag、切片数、文件大小、创建时间）
7. PDF / MD / TXT 文件上传（单文件、类型限制、大小提示、上传进度）
8. 上传结果提示（成功 / 重复文件 409 / 类型不符 415 / 超限 413）
9. 文档处理状态展示（pending / parsing / chunking / embedding / completed / failed）
10. 处理中文档定时刷新（3 秒轮询，全部终态后停止）
11. 文档删除（Popconfirm 确认、删除后列表刷新）
12. 空状态、Loading、错误提示（Ant Design Vue Empty / Spin / Result）
13. 对接现有后端接口（全部使用真实 API，不 Mock）
14. API 类型封装（TypeScript DTO 与后端返回结构一致）
15. 页面刷新后重新查询真实数据（不缓存、不持久化）
16. 与 T13 聊天页面入口衔接（详情页"进入对话"按钮 + 预留路由）

### 2.2 非目标（明确不做）

| 项 | 原因 |
|---|---|
| RAG 聊天页面 | T13 实现 |
| SSE 客户端 | T13 实现 |
| 会话列表 / 消息历史 / 引用展示 | T13 实现 |
| 登录和权限 | MVP 不做（总体方案 §1.2） |
| 多租户 | MVP 不做 |
| 修改后端业务逻辑 | 禁止 |
| Mock 假数据 | 全部使用真实 API |
| 新增复杂状态管理框架（Pinia / Vuex 等） | 用 composables 替代 |
| 编辑知识库 | 后端无 PUT/PATCH 接口（§二十一） |
| 文档详情页（切片预览） | 非本阶段必须；接口已存在但 UI 优先级低 |
| 国际化 | MVP 中文 |

---

## 三、新增依赖与安装

### 3.1 新增

| 包 | 版本 | 用途 |
|---|---|---|
| `vue-router` | `^4.5` | 前端路由（总体方案 §3.1 已规划） |

### 3.2 安装命令

```bash
pnpm --filter web add vue-router@^4.5
```

### 3.3 不安装

- **pinia**：T12 用 Vue composables 管理状态（`useKnowledgeBases` / `useDocuments`），不引入状态管理框架。
- **dayjs**：日期格式化用原生 `Date` 方法，不引入额外依赖。
- **@ant-design/icons-vue**：T12 不需要图标（Ant Design Vue 4.x 内置基础图标）。

---

## 四、前端环境变量与 API Base URL

### 4.1 现有配置（不修改）

| 文件 | 配置项 | 值 | 说明 |
|---|---|---|---|
| `.env.example` | `VITE_API_BASE_URL` | `/api` | Vite 构建期注入，Axios baseURL 使用 |
| `web/env.d.ts` | `ImportMetaEnv.VITE_API_BASE_URL` | `string \| undefined` | TypeScript 类型声明 |
| `web/vite.config.ts` | `server.proxy['/api']` | `→ http://localhost:3000` | 开发模式代理 |
| `web/src/api/http.ts` | `baseURL` | `import.meta.env.VITE_API_BASE_URL ?? '/api'` | Axios 实例 baseURL |

### 4.2 运行时行为

- **开发模式**（`pnpm --filter web dev`）：Vite dev server 监听 `localhost:5173`，`/api` 请求被 proxy 转发到 `localhost:3000`（后端 NestJS）。
- **生产构建**（`pnpm --filter web build`）：`VITE_API_BASE_URL` 被替换为 `/api`，Nginx 反代 `/api` 到后端（总体方案 §11）。
- **环境变量来源**：`web/vite.config.ts` 的 `envDir: '..'` 指向项目根目录，Vite 从根目录 `.env` 读取 `VITE_` 前缀变量。

### 4.3 不新增环境变量

T12 不需要新的前端环境变量。文件大小上限 `20MB` 在前端硬编码（与后端 `MAX_FILE_SIZE_MB=20` 默认值一致，§十五）。

---

## 五、Axios 封装增强（`web/src/api/http.ts` 修改）

### 5.1 问题

当前错误拦截器将所有错误转为 `new Error(message)`，丢失了 HTTP 状态码和 `details` 字段。T12 需要区分：
- 404（资源不存在）→ 提示后返回列表页
- 409（重复文件）→ 展示 `details` 中的已存在文档信息
- 413（文件超限）→ 提示文件大小限制
- 415（类型不符）→ 提示支持的文件类型

### 5.2 新增 `ApiError` 类

在 `web/src/api/http.ts` 中新增：

```typescript
export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}
```

### 5.3 修改错误拦截器

```typescript
interface ApiErrorResponse {
  code: number
  message: string
  details?: unknown
}

http.interceptors.response.use(
  (response) => {
    if (isApiResponse(response.data)) {
      response.data = response.data.data
    }
    return response
  },
  (error: unknown) => {
    if (axios.isAxiosError<ApiErrorResponse>(error)) {
      const status = error.response?.status ?? 0
      const errorData = error.response?.data
      const message = errorData?.message ?? error.message
      const details = errorData?.details
      throw new ApiError(message, status, details)
    }

    if (error instanceof Error) {
      throw new ApiError(error.message, 0)
    }

    throw new ApiError('请求失败', 0)
  },
)
```

### 5.4 向后兼容

- `ApiError extends Error`，现有 `HomePage.vue` 的 `error instanceof Error` 判断仍然成立。
- 成功响应的解包逻辑（`isApiResponse` 检测 + `response.data = response.data.data`）不变。
- 204 No Content 响应：`response.data` 为空，`isApiResponse` 返回 false，不解包，调用方得到 `undefined`。

### 5.5 导出

`http.ts` 同时导出 `default http`（Axios 实例）和 `export { ApiError }`（类型供调用方 `instanceof` 判断）。

---

## 六、TypeScript DTO 类型定义

### 6.1 `web/src/types/knowledge-base.ts`（新建）

```typescript
/** 知识库响应（对应后端 KnowledgeBaseResponseDto） */
export interface KnowledgeBase {
  id: number
  name: string
  description: string | null
  documentCount: number
  createdAt: string
  updatedAt: string
}

/** 创建知识库请求（对应后端 CreateKnowledgeBaseDto） */
export interface CreateKnowledgeBasePayload {
  name: string
  description?: string
}
```

### 6.2 `web/src/types/document.ts`（新建）

```typescript
/** 文档状态枚举（对应后端 DOCUMENT_STATUSES） */
export type DocumentStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'completed'
  | 'failed'

/** 文件扩展名（对应后端 DocumentFileExtension） */
export type DocumentFileExtension = 'pdf' | 'md' | 'txt'

/** 文档响应（对应后端 DocumentResponseDto） */
export interface Document {
  id: number
  knowledgeBaseId: number
  fileName: string
  fileExt: DocumentFileExtension
  fileSize: number
  status: DocumentStatus
  errorMessage: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

/** 切片预览（对应后端 ChunkPreviewDto） */
export interface ChunkPreview {
  id: number
  chunkIndex: number
  content: string
  charCount: number
  pageNo: number | null
  qdrantPointId: string
}

/** 文档详情响应（对应后端 DocumentDetailResponseDto） */
export interface DocumentDetail extends Document {
  chunks: ChunkPreview[]
}

/** 终态状态集合 */
export const TERMINAL_STATUSES: readonly DocumentStatus[] = ['completed', 'failed']

/** 处理中状态集合 */
export const PROCESSING_STATUSES: readonly DocumentStatus[] = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
]

/** 判断是否终态 */
export function isTerminalStatus(status: DocumentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** 判断是否处理中 */
export function isProcessingStatus(status: DocumentStatus): boolean {
  return PROCESSING_STATUSES.includes(status)
}
```

### 6.3 类型与后端返回结构对照

| 前端 TS 类型 | 后端 DTO | 后端 Entity 字段 | 说明 |
|---|---|---|---|
| `KnowledgeBase.id` | `KnowledgeBaseResponseDto.id` | `knowledge_base.id` | INT UNSIGNED → number |
| `KnowledgeBase.description` | `KnowledgeBaseResponseDto.description` | `knowledge_base.description` | nullable → `string \| null` |
| `KnowledgeBase.documentCount` | `KnowledgeBaseResponseDto.documentCount` | `knowledge_base.document_count` | INT UNSIGNED → number |
| `KnowledgeBase.createdAt` | `KnowledgeBaseResponseDto.createdAt` | `knowledge_base.created_at` | Date.toISOString() → string |
| `Document.knowledgeBaseId` | `DocumentResponseDto.knowledgeBaseId` | `document.kb_id` | 字段名映射：后端 `kbId` → DTO `knowledgeBaseId` |
| `Document.fileExt` | `DocumentResponseDto.fileExt` | `document.file_ext` | `pdf \| md \| txt` |
| `Document.fileSize` | `DocumentResponseDto.fileSize` | `document.file_size` | BIGINT → Number() → number |
| `Document.status` | `DocumentResponseDto.status` | `document.status` | ENUM → 联合类型 |
| `Document.errorMessage` | `DocumentResponseDto.errorMessage` | `document.error_message` | nullable → `string \| null` |
| `Document.chunkCount` | `DocumentResponseDto.chunkCount` | `document.chunk_count` | INT → number |

**注意**：后端 DTO `fromEntity()` 已完成 Entity → DTO 的字段名映射（`kbId` → `knowledgeBaseId`）和类型转换（`Date.toISOString()`、`Number(fileSize)`）。前端 DTO 直接与后端 DTO 对齐，不需要处理 Entity 层的字段名差异。

---

## 七、API 请求封装

### 7.1 `web/src/api/knowledge-base.ts`（新建）

```typescript
import http from './http'
import type {
  KnowledgeBase,
  CreateKnowledgeBasePayload,
} from '../types/knowledge-base'

/** GET /api/knowledge-bases — 知识库列表 */
export async function getKnowledgeBases(): Promise<KnowledgeBase[]> {
  const response = await http.get<KnowledgeBase[]>('/knowledge-bases')
  return response.data
}

/** GET /api/knowledge-bases/:id — 知识库详情 */
export async function getKnowledgeBase(id: number): Promise<KnowledgeBase> {
  const response = await http.get<KnowledgeBase>(`/knowledge-bases/${id}`)
  return response.data
}

/** POST /api/knowledge-bases — 创建知识库 */
export async function createKnowledgeBase(
  payload: CreateKnowledgeBasePayload,
): Promise<KnowledgeBase> {
  const response = await http.post<KnowledgeBase>('/knowledge-bases', payload)
  return response.data
}

/** DELETE /api/knowledge-bases/:id — 删除知识库（204 No Content） */
export async function deleteKnowledgeBase(id: number): Promise<void> {
  await http.delete(`/knowledge-bases/${id}`)
}
```

### 7.2 `web/src/api/document.ts`（新建）

```typescript
import http from './http'
import type { Document, DocumentDetail } from '../types/document'

/** GET /api/knowledge-bases/:kbId/documents — 文档列表 */
export async function getDocuments(kbId: number): Promise<Document[]> {
  const response = await http.get<Document[]>(
    `/knowledge-bases/${kbId}/documents`,
  )
  return response.data
}

/** GET /api/documents/:id — 文档详情（含切片预览） */
export async function getDocument(id: number): Promise<DocumentDetail> {
  const response = await http.get<DocumentDetail>(`/documents/${id}`)
  return response.data
}

/** DELETE /api/documents/:id — 删除文档（204 No Content） */
export async function deleteDocument(id: number): Promise<void> {
  await http.delete(`/documents/${id}`)
}

/** POST /api/knowledge-bases/:kbId/documents — 上传文档（multipart/form-data） */
export async function uploadDocument(
  kbId: number,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Document> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await http.post<Document>(
    `/knowledge-bases/${kbId}/documents`,
    formData,
    {
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(
            Math.round((progressEvent.loaded * 100) / progressEvent.total),
          )
        }
      },
    },
  )

  return response.data
}
```

### 7.3 接口对照表

| API 函数 | 后端接口 | 后端 Controller | 返回类型 | 特殊状态码 |
|---|---|---|---|---|
| `getKnowledgeBases()` | `GET /api/knowledge-bases` | `KnowledgeBaseController.findAll()` | `KnowledgeBase[]` | — |
| `getKnowledgeBase(id)` | `GET /api/knowledge-bases/:id` | `KnowledgeBaseController.findOne()` | `KnowledgeBase` | 404 不存在 |
| `createKnowledgeBase(payload)` | `POST /api/knowledge-bases` | `KnowledgeBaseController.create()` | `KnowledgeBase` | 400 校验失败, 409 重名 |
| `deleteKnowledgeBase(id)` | `DELETE /api/knowledge-bases/:id` | `KnowledgeBaseController.remove()` | `void` | 204, 404 不存在 |
| `getDocuments(kbId)` | `GET /api/knowledge-bases/:kbId/documents` | `KnowledgeBaseDocumentsController.findAll()` | `Document[]` | 404 KB 不存在 |
| `getDocument(id)` | `GET /api/documents/:id` | `DocumentController.findOne()` | `DocumentDetail` | 404 不存在 |
| `deleteDocument(id)` | `DELETE /api/documents/:id` | `DocumentController.remove()` | `void` | 204, 404 不存在 |
| `uploadDocument(kbId, file, onProgress)` | `POST /api/knowledge-bases/:kbId/documents` | `KnowledgeBaseDocumentsController.upload()` | `Document` | 202, 400 无文件, 404 KB 不存在, 409 重复, 413 超限, 415 类型不符 |

### 7.4 响应解包说明

Axios 拦截器自动解包 `{code:0, message:'success', data: T}` → `T`。因此：
- `response.data` 在拦截器处理后已是后端 DTO 对象（如 `KnowledgeBase`），无需再取 `.data.data`。
- 204 No Content 响应无 body，`response.data` 为 `undefined`，调用方返回 `void`。
- 202 Accepted 响应有 body（`DocumentResponseDto`），正常解包。

---

## 八、路由设计

### 8.1 `web/src/router/index.ts`（新建）

```typescript
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/knowledge-bases',
    },
    {
      path: '/knowledge-bases',
      name: 'KnowledgeBaseList',
      component: () => import('../views/KnowledgeBaseListView.vue'),
    },
    {
      path: '/knowledge-bases/:id',
      name: 'KnowledgeBaseDetail',
      component: () => import('../views/KnowledgeBaseDetailView.vue'),
      props: (route) => ({ id: Number(route.params.id) }),
    },
    {
      path: '/knowledge-bases/:id/chat',
      name: 'KnowledgeBaseChat',
      // T13 实现；T12 预留路由，显示占位页面
      component: () => import('../views/ChatPlaceholderView.vue'),
      props: (route) => ({ id: Number(route.params.id) }),
    },
    {
      path: '/health',
      name: 'Health',
      component: () => import('../views/HomePage.vue'),
    },
  ],
})

export default router
```

### 8.2 路由说明

| 路由 | 名称 | 组件 | T12 状态 |
|---|---|---|---|
| `/` | — | redirect → `/knowledge-bases` | ✅ 实现 |
| `/knowledge-bases` | KnowledgeBaseList | `KnowledgeBaseListView.vue` | ✅ 实现 |
| `/knowledge-bases/:id` | KnowledgeBaseDetail | `KnowledgeBaseDetailView.vue` | ✅ 实现 |
| `/knowledge-bases/:id/chat` | KnowledgeBaseChat | `ChatPlaceholderView.vue` | 占位（T13 实现） |
| `/health` | Health | `HomePage.vue` | 保留（调试用） |

### 8.3 路由 props 传递

`KnowledgeBaseDetailView` 和 `ChatPlaceholderView` 通过 `props: (route) => ({ id: Number(route.params.id) })` 接收知识库 ID。若 `Number(route.params.id)` 为 `NaN`，API 调用将返回 400，页面显示错误提示。

### 8.4 不使用路由守卫

T12 不需要路由守卫（无登录鉴权、无权限控制）。路由参数校验由后端 `ParsePositiveIntPipe` 保证。

---

## 九、页面与组件拆分

### 9.1 文件结构

```
web/src/
├── main.ts                              # 修改：注册 router
├── App.vue                              # 修改：Layout + router-view
├── api/
│   ├── http.ts                          # 修改：增强错误拦截器
│   ├── health.ts                        # 保留
│   ├── knowledge-base.ts                # 新建
│   └── document.ts                      # 新建
├── types/
│   ├── health.ts                        # 保留
│   ├── knowledge-base.ts                # 新建
│   └── document.ts                      # 新建
├── router/
│   └── index.ts                         # 新建
├── composables/
│   ├── use-knowledge-bases.ts           # 新建
│   └── use-documents.ts                 # 新建
├── utils/
│   └── format.ts                        # 新建
├── views/
│   ├── HomePage.vue                     # 保留（移至 /health 路由）
│   ├── KnowledgeBaseListView.vue        # 新建
│   ├── KnowledgeBaseDetailView.vue      # 新建
│   └── ChatPlaceholderView.vue          # 新建（T13 占位）
└── components/
    ├── KnowledgeBaseCard.vue            # 新建
    ├── CreateKnowledgeBaseModal.vue     # 新建
    ├── DocumentUploader.vue             # 新建
    ├── DocumentTable.vue                # 新建
    └── DocumentStatusTag.vue            # 新建
```

### 9.2 组件职责

| 组件 / 页面 | 职责 | Props | Emits |
|---|---|---|---|
| `App.vue` | 全局 Layout（Header + Content + router-view） | — | — |
| `KnowledgeBaseListView` | 知识库列表页：卡片网格、新建按钮、删除确认 | — | — |
| `KnowledgeBaseDetailView` | 知识库详情页：库信息头 + 文档管理区域 + 进入对话按钮 | `id: number` | — |
| `ChatPlaceholderView` | T13 占位页：显示"对话功能即将上线" | `id: number` | — |
| `KnowledgeBaseCard` | 单个知识库卡片：名称、描述、文档数、创建时间、进入/删除按钮 | `kb: KnowledgeBase` | `delete`, `click` |
| `CreateKnowledgeBaseModal` | 新建知识库弹窗：名称 + 描述表单、重名校验 | `visible: boolean` | `success`, `cancel` |
| `DocumentUploader` | 文档上传区域：拖拽上传、类型/大小限制、进度条 | `kbId: number` | `success` |
| `DocumentTable` | 文档列表表格：文件名、类型、大小、状态、切片数、时间、删除 | `documents: Document[]`, `loading: boolean` | `delete`, `refresh` |
| `DocumentStatusTag` | 文档状态标签：6 种状态对应不同颜色 | `status: DocumentStatus`, `errorMessage?: string \| null` | — |

### 9.3 Composables 职责

| Composable | 职责 | 返回 |
|---|---|---|
| `useKnowledgeBases` | 知识库列表加载、创建、删除 | `{ loading, knowledgeBases, error, fetchList, create, remove }` |
| `useDocuments(kbId)` | 文档列表加载、删除、轮询刷新 | `{ loading, documents, error, hasProcessingDocuments, fetchList, refresh, remove }` |

---

## 十、App.vue 布局改造

### 10.1 修改后的 `web/src/App.vue`

```vue
<script setup lang="ts">
import { Layout, LayoutHeader, LayoutContent } from 'ant-design-vue'
import { useRouter } from 'vue-router'

const router = useRouter()

function goHome(): void {
  void router.push('/knowledge-bases')
}
</script>

<template>
  <Layout class="app-layout">
    <LayoutHeader class="app-header">
      <h1 class="app-title" @click="goHome">RAG 知识库</h1>
    </LayoutHeader>
    <LayoutContent class="app-content">
      <router-view />
    </LayoutContent>
  </Layout>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: #f5f5f5;
  color: rgba(0, 0, 0, 0.88);
}

.app-layout {
  min-height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  background: #001529;
}

.app-title {
  margin: 0;
  font-size: 20px;
  color: #fff;
  cursor: pointer;
}

.app-content {
  width: min(1200px, 100%);
  margin: 0 auto;
  padding: 32px 24px;
}
</style>
```

### 10.2 变更说明

- 引入 `Layout / LayoutHeader / LayoutContent` 组件（Ant Design Vue 按需导入）。
- 用 `<router-view />` 替代直接渲染 `<HomePage />`。
- 点击标题返回知识库列表页。
- 内容区宽度从 `960px` 调整为 `1200px`（文档表格需要更宽空间）。
- 移除 `<script setup>` 中的 `import HomePage`。

---

## 十一、main.ts 改造

### 11.1 修改后的 `web/src/main.ts`

```typescript
import { createApp } from 'vue'
import 'ant-design-vue/dist/reset.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).mount('#app')
```

### 11.2 变更说明

- 新增 `import router from './router'`。
- 链式调用 `.use(router)` 注册 Vue Router。
- 不引入 Pinia（T12 不使用状态管理框架）。

---

## 十二、知识库列表页（KnowledgeBaseListView）

### 12.1 页面结构

```
┌─────────────────────────────────────────────────┐
│ 知识库列表                      [+ 新建知识库]    │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 卡片 1    │  │ 卡片 2    │  │ 卡片 3    │       │
│  │ 名称      │  │ 名称      │  │ 名称      │       │
│  │ 描述      │  │ 描述      │  │ 描述      │       │
│  │ 文档数    │  │ 文档数    │  │ 文档数    │       │
│  │ [进入] [删]│  │ [进入] [删]│  │ [进入] [删]│       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                   │
└─────────────────────────────────────────────────┘
```

### 12.2 数据流

- `onMounted` → `useKnowledgeBases.fetchList()` → `getKnowledgeBases()` → 渲染卡片列表。
- 点击"新建" → 打开 `CreateKnowledgeBaseModal`。
- 创建成功 → Modal 关闭 → `fetchList()` 刷新列表。
- 点击"删除" → `Popconfirm` 确认 → `remove(id)` → `fetchList()` 刷新列表。
- 点击卡片或"进入" → `router.push('/knowledge-bases/:id')`。

### 12.3 状态展示

| 状态 | 展示 |
|---|---|
| Loading | `<Spin>` 居中 |
| 空列表 | `<Empty description="还没有知识库，点击右上角创建" />` |
| 错误 | `<Result status="error" title="加载失败" :sub-title="error" />` + 重试按钮 |
| 正常 | 卡片网格（`Row + Col`，每行 3 列，`gutter: [16, 16]`） |

### 12.4 实现要点

```vue
<script setup lang="ts">
import { Button, Row, Col, Spin, Empty, Result } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { useKnowledgeBases } from '../composables/use-knowledge-bases'
import KnowledgeBaseCard from '../components/KnowledgeBaseCard.vue'
import CreateKnowledgeBaseModal from '../components/CreateKnowledgeBaseModal.vue'

const router = useRouter()
const { loading, knowledgeBases, error, fetchList, remove } = useKnowledgeBases()
const modalVisible = ref(false)

function handleDelete(id: number): void {
  void remove(id)
}

function handleCreateSuccess(): void {
  modalVisible.value = false
}

function goToDetail(id: number): void {
  void router.push(`/knowledge-bases/${id}`)
}
</script>
```

---

## 十三、新建知识库弹窗（CreateKnowledgeBaseModal）

### 13.1 表单字段

| 字段 | 组件 | 校验规则 | 对应后端 DTO |
|---|---|---|---|
| 名称 | `Input` | 必填、trim、1-100 字符 | `CreateKnowledgeBaseDto.name` |
| 描述 | `TextArea` | 可选、trim、≤500 字符 | `CreateKnowledgeBaseDto.description` |

### 13.2 提交流程

1. 用户填写表单 → 点击"确定"。
2. 前端校验通过 → 调用 `createKnowledgeBase({ name, description })`。
3. 成功 → `emit('success')` → 关闭 Modal → 列表刷新。
4. 409 冲突 → 表单"名称"字段显示错误"知识库名称已存在"。
5. 其他错误 → `message.error(errorMessage)` → Modal 不关闭。

### 13.3 实现要点

- 使用 Ant Design Vue `Modal + Form + FormItem + Input + Textarea`。
- `formRef.validate()` 前端校验通过后才提交。
- 捕获 `ApiError`：`error.status === 409` 时设置表单字段错误。
- 提交时按钮 `loading` 状态，防止重复提交。
- Modal 关闭时 `resetFields()` 清空表单。

```typescript
import { ApiError } from '../api/http'

async function handleSubmit(): Promise<void> {
  // ...validate...
  submitting.value = true
  try {
    await createKnowledgeBase({ name: form.name, description: form.description || undefined })
    emit('success')
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      // 设置名称字段错误
      formErrors.name = '知识库名称已存在'
    } else {
      message.error(error instanceof Error ? error.message : '创建失败')
    }
  } finally {
    submitting.value = false
  }
}
```

---

## 十四、知识库详情页（KnowledgeBaseDetailView）

### 14.1 页面结构

```
┌─────────────────────────────────────────────────┐
│ ← 返回列表    知识库名称                         │
│ 描述 | 文档数：N | 创建时间：2026-07-31          │
│                              [进入对话 →]        │
├─────────────────────────────────────────────────┤
│ 文档管理                                         │
│ ┌─────────────────────────────────────────────┐ │
│ │  拖拽区域 / 点击上传                          │ │
│ │  支持 PDF、MD、TXT，单文件 ≤ 20MB            │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 文件名 | 类型 | 大小 | 状态 | 切片数 | 操作  │ │
│ │ doc.pdf | PDF  | 1.2M | 已完成 | 42    | [删]│ │
│ │ doc.md  | MD   | 12K  | 解析中 | 0     | [删]│ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 14.2 数据流

- `props.id` → `useDocuments(toRef(props, 'id'))` → `fetchList()` → 渲染文档表格。
- 同时调用 `getKnowledgeBase(id)` 获取库信息头。
- 上传成功 → `refresh()` 静默刷新文档列表 → 轮询自动启动。
- 删除文档 → `Popconfirm` 确认 → `remove(id)` → `refresh()` 刷新。
- 点击"进入对话" → `router.push('/knowledge-bases/:id/chat')`。
- 点击"返回列表" → `router.push('/knowledge-bases')`。

### 14.3 知识库不存在处理

`getKnowledgeBase(id)` 返回 404 时：
- 显示 `<Result status="404" title="知识库不存在" />`。
- 不渲染文档管理区域。
- 提供"返回列表"按钮。

### 14.4 实现要点

```vue
<script setup lang="ts">
import { ref, toRef, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Descriptions, DescriptionsItem, Result, Spin } from 'ant-design-vue'
import { getKnowledgeBase } from '../api/knowledge-base'
import { ApiError } from '../api/http'
import { useDocuments } from '../composables/use-documents'
import type { KnowledgeBase } from '../types/knowledge-base'
import DocumentUploader from '../components/DocumentUploader.vue'
import DocumentTable from '../components/DocumentTable.vue'

const props = defineProps<{ id: number }>()
const router = useRouter()

const kbLoading = ref(true)
const kbNotFound = ref(false)
const knowledgeBase = ref<KnowledgeBase | null>(null)

const { loading, documents, error, refresh, remove } = useDocuments(toRef(props, 'id'))

async function fetchKnowledgeBase(): Promise<void> {
  kbLoading.value = true
  try {
    knowledgeBase.value = await getKnowledgeBase(props.id)
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) {
      kbNotFound.value = true
    }
  } finally {
    kbLoading.value = false
  }
}

function goToChat(): void {
  void router.push(`/knowledge-bases/${props.id}/chat`)
}

onMounted(fetchKnowledgeBase)
</script>
```

---

## 十五、文档上传组件（DocumentUploader）

### 15.1 上传限制

| 限制项 | 值 | 来源 |
|---|---|---|
| 字段名 | `file` | 后端 `FileInterceptor('file')` |
| 文件类型 | `.pdf`、`.md`、`.txt` | 后端 `DOCUMENT_UPLOAD_MIME_RULES` |
| 文件大小 | ≤ 20MB | 后端 `MAX_FILE_SIZE_MB=20`，前端硬编码 |
| 单文件上传 | 是 | `multiple={false}`、`maxCount={1}` |

### 15.2 组件设计

使用 Ant Design Vue `UploadDragger`（拖拽上传区域）+ `customRequest`。

### 15.3 `customRequest` 实现

不使用 Upload 组件内置的 XHR 请求，改用项目 Axios 实例：

```typescript
import { UploadDragger, message } from 'ant-design-vue'
import type { UploadProps } from 'ant-design-vue'
import { uploadDocument } from '../api/document'
import { ApiError } from '../api/http'
import type { Document } from '../types/document'

const MAX_FILE_SIZE_MB = 20
const ACCEPTED_EXTENSIONS = ['.pdf', '.md', '.txt']

const props = defineProps<{ kbId: number }>()
const emit = defineEmits<{ success: [document: Document] }>()

const customRequest: UploadProps['customRequest'] = async (options) => {
  const { file, onSuccess, onError, onProgress } = options
  try {
    const doc = await uploadDocument(
      props.kbId,
      file as File,
      (percent) => onProgress?.({ percent }),
    )
    onSuccess?.(doc)
    emit('success', doc)
    message.success(`${doc.fileName} 上传成功，正在处理...`)
  } catch (error: unknown) {
    onError?.(error)
    handleUploadError(error)
  }
}
```

### 15.4 `beforeUpload` 前端预校验

```typescript
const beforeUpload: UploadProps['beforeUpload'] = (file) => {
  // 校验扩展名
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    message.error('仅支持 PDF、MD、TXT 文件')
    return false
  }
  // 校验文件大小
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    message.error(`文件大小不能超过 ${MAX_FILE_SIZE_MB}MB`)
    return false
  }
  return true
}
```

### 15.5 上传错误处理

```typescript
function handleUploadError(error: unknown): void {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 409: {
        // 重复文件，details 含已存在文档信息
        const details = error.details as { fileName?: string; status?: string } | undefined
        const detail = details?.fileName
          ? `已存在文件：${details.fileName}（状态：${details.status ?? '未知'}）`
          : '同一知识库已存在相同文件'
        message.warning(detail)
        break
      }
      case 413:
        message.error('文件大小超过限制（20MB）')
        break
      case 415:
        message.error('不支持的文件类型')
        break
      case 404:
        message.error('知识库不存在')
        break
      default:
        message.error(error.message)
    }
  } else {
    message.error(error instanceof Error ? error.message : '上传失败')
  }
}
```

### 15.6 UI 提示

- 拖拽区域显示：`点击或拖拽文件上传` + `支持 PDF、MD、TXT，单文件 ≤ 20MB`。
- 上传中显示进度条（Upload 组件内置）。
- 上传成功后清空文件列表（`fileList` 置空），准备下一次上传。
- 上传成功后 `emit('success')` 触发父组件刷新文档列表。

### 15.7 `accept` 属性

```html
<UploadDragger
  accept=".pdf,.md,.txt"
  :multiple="false"
  :max-count="1"
  :before-upload="beforeUpload"
  :custom-request="customRequest"
>
  ...
</UploadDragger>
```

---

## 十六、文档列表与状态展示（DocumentTable + DocumentStatusTag）

### 16.1 DocumentTable 列定义

| 列名 | 字段 | 宽度 | 格式化 |
|---|---|---|---|
| 文件名 | `fileName` | 自适应 | 原文显示 |
| 类型 | `fileExt` | 80px | 大写（PDF / MD / TXT） |
| 大小 | `fileSize` | 100px | `formatFileSize()`（B / KB / MB） |
| 状态 | `status` | 120px | `DocumentStatusTag` 组件 |
| 切片数 | `chunkCount` | 80px | 数字 |
| 创建时间 | `createdAt` | 160px | `formatDateTime()` |
| 操作 | — | 80px | 删除按钮（`Popconfirm`） |

### 16.2 DocumentStatusTag 状态映射

| `status` | 中文标签 | Tag color | 说明 |
|---|---|---|---|
| `pending` | 待处理 | `default` | 等待解析 |
| `parsing` | 解析中 | `processing` | 正在提取文本 |
| `chunking` | 切片中 | `processing` | 正在切分文本 |
| `embedding` | 向量化中 | `processing` | 正在生成向量 |
| `completed` | 已完成 | `success` | 处理完成 |
| `failed` | 失败 | `error` | 处理失败（Tooltip 显示 `errorMessage`） |

### 16.3 DocumentStatusTag 实现

```vue
<script setup lang="ts">
import { Tag, Tooltip } from 'ant-design-vue'
import type { DocumentStatus } from '../types/document'

const props = defineProps<{
  status: DocumentStatus
  errorMessage?: string | null
}>()

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'default' },
  parsing: { label: '解析中', color: 'processing' },
  chunking: { label: '切片中', color: 'processing' },
  embedding: { label: '向量化中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
}
</script>

<template>
  <Tooltip v-if="props.status === 'failed' && props.errorMessage" :title="props.errorMessage">
    <Tag :color="STATUS_CONFIG[props.status].color">
      {{ STATUS_CONFIG[props.status].label }}
    </Tag>
  </Tooltip>
  <Tag v-else :color="STATUS_CONFIG[props.status].color">
    {{ STATUS_CONFIG[props.status].label }}
  </Tag>
</template>
```

### 16.4 空状态

文档列表为空时，表格显示 Ant Design Vue `Table` 内置的空状态（`locale` 配置），或自定义 `<Empty>` 组件。

---

## 十七、处理中文档定时刷新

### 17.1 轮询策略

| 项 | 值 | 说明 |
|---|---|---|
| 轮询间隔 | 3000ms（3 秒） | 总体方案 §8 约定 |
| 触发条件 | 存在非终态文档 | `pending / parsing / chunking / embedding` |
| 停止条件 | 全部文档为终态 | `completed / failed` |
| 轮询时 Loading | 不显示 | 静默刷新，不触发 `loading` 状态 |
| 清理时机 | 组件卸载 | `onUnmounted` 清除 `setInterval` |
| kbId 变化 | 停止轮询 → 重新加载 | `watch(kbId)` |

### 17.2 `useDocuments` composable 实现

```typescript
// web/src/composables/use-documents.ts
import { ref, computed, watch, onUnmounted, type Ref } from 'vue'
import { getDocuments, deleteDocument } from '../api/document'
import {
  isTerminalStatus,
  type Document,
} from '../types/document'

const POLL_INTERVAL = 3000

export function useDocuments(kbId: Ref<number>) {
  const loading = ref(false)
  const documents = ref<Document[]>([])
  const error = ref<string | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const hasProcessingDocuments = computed(() =>
    documents.value.some((doc) => !isTerminalStatus(doc.status)),
  )

  async function fetchList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      documents.value = await getDocuments(kbId.value)
      if (hasProcessingDocuments.value) {
        startPolling()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载文档列表失败'
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    try {
      documents.value = await getDocuments(kbId.value)
      if (!hasProcessingDocuments.value) {
        stopPolling()
      }
    } catch {
      // 静默重试，保持轮询
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    pollTimer = setInterval(() => void refresh(), POLL_INTERVAL)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function remove(id: number): Promise<void> {
    await deleteDocument(id)
    await refresh()
  }

  watch(
    kbId,
    () => {
      stopPolling()
      documents.value = []
      void fetchList()
    },
    { immediate: true },
  )

  onUnmounted(stopPolling)

  return {
    loading,
    documents,
    error,
    hasProcessingDocuments,
    fetchList,
    refresh,
    remove,
  }
}
```

### 17.3 轮询与上传联动

1. 用户上传文档 → `DocumentUploader` 的 `emit('success')` 触发。
2. 父组件 `KnowledgeBaseDetailView` 调用 `refresh()` 静默刷新列表。
3. `refresh()` 检测到新的非终态文档 → 调用 `startPolling()`。
4. 轮询每 3 秒执行 `refresh()` → 更新文档状态。
5. 全部终态 → `stopPolling()`。

### 17.4 轮询与删除联动

1. 用户删除文档 → `remove(id)` 调用 `deleteDocument(id)`。
2. 删除成功 → `refresh()` 静默刷新列表。
3. 如果删除后没有非终态文档 → `stopPolling()`。

### 17.5 不使用 WebSocket

T12 仅使用 HTTP 轮询。WebSocket 不在 MVP 范围内（总体方案 §1.2 排除）。

---

## 十八、删除确认与接口异常处理

### 18.1 删除知识库

| 步骤 | 实现 |
|---|---|
| 触发 | `KnowledgeBaseCard` 的删除按钮 |
| 确认 | `Popconfirm` 弹出确认框，提示"删除知识库将同时删除所有文档和会话，且不可恢复" |
| 调用 | `useKnowledgeBases.remove(id)` → `deleteKnowledgeBase(id)` |
| 成功 | `message.success('删除成功')` → `fetchList()` 刷新列表 |
| 404 | `message.error('知识库不存在')` → `fetchList()` 刷新列表（可能已被其他端删除） |
| 其他错误 | `message.error(errorMessage)` |

### 18.2 删除文档

| 步骤 | 实现 |
|---|---|
| 触发 | `DocumentTable` 操作列的删除按钮 |
| 确认 | `Popconfirm` 弹出确认框，提示"删除文档将同时删除其切片和向量数据，且不可恢复" |
| 调用 | `useDocuments.remove(id)` → `deleteDocument(id)` |
| 成功 | `message.success('删除成功')` → `refresh()` 静默刷新列表 |
| 404 | `message.error('文档不存在')` → `refresh()` 刷新列表 |
| 其他错误 | `message.error(errorMessage)` |

### 18.3 通用异常处理模式

```typescript
import { ApiError } from '../api/http'
import { message } from 'ant-design-vue'

try {
  await someApiCall()
  message.success('操作成功')
} catch (error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      message.error('资源不存在')
    } else if (error.status === 409) {
      message.warning(error.message)
    } else {
      message.error(error.message)
    }
  } else {
    message.error(error instanceof Error ? error.message : '操作失败')
  }
}
```

### 18.4 网络错误处理

- Axios 网络错误（无 response）→ `ApiError(message, 0)`。
- `error.status === 0` → `message.error('网络连接失败，请检查后端服务是否启动')`。

---

## 十九、空状态、Loading、错误提示

### 19.1 统一规范

| 场景 | 组件 | 文案 |
|---|---|---|
| 知识库列表空 | `Empty` | "还没有知识库，点击右上角创建" |
| 文档列表空 | `Empty` | "还没有上传文档" |
| 列表 Loading | `Spin` | 居中旋转 |
| 表格 Loading | `Table` 内置 `loading` | 表格上方 Spin |
| 页面错误 | `Result` | `status="error"` + 错误消息 + 重试按钮 |
| 404 页面错误 | `Result` | `status="404"` + "资源不存在" + 返回按钮 |
| 操作成功 | `message.success` | "创建成功" / "删除成功" / "上传成功" |
| 操作失败 | `message.error` | 具体错误信息 |
| 操作警告 | `message.warning` | 重复文件等业务冲突 |

### 19.2 页面刷新后重新查询

- **不缓存数据**：所有列表数据在组件 `onMounted` 或 `watch(immediate)` 时从 API 获取。
- **不持久化**：不使用 `localStorage` / `sessionStorage` 存储业务数据。
- **浏览器刷新**：页面状态重置，重新从 API 加载数据。
- **路由切换回来**：组件重新挂载，重新加载数据。

---

## 二十、与 T13 聊天页面入口衔接

### 20.1 入口位置

知识库详情页（`KnowledgeBaseDetailView`）库信息头区域，显示"进入对话"按钮：

```html
<Button type="primary" @click="goToChat">
  进入对话
</Button>
```

### 20.2 路由跳转

```typescript
function goToChat(): void {
  void router.push(`/knowledge-bases/${props.id}/chat`)
}
```

### 20.3 T13 占位页（ChatPlaceholderView）

```vue
<script setup lang="ts">
import { Result, Button } from 'ant-design-vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ id: number }>()
const router = useRouter()
</script>

<template>
  <Result
    status="info"
    title="对话功能即将上线"
    sub-title="T13 将实现 SSE 流式问答、会话管理和引用展示"
  >
    <template #extra>
      <Button type="primary" @click="router.push(`/knowledge-bases/${props.id}`)">
        返回知识库详情
      </Button>
    </template>
  </Result>
</template>
```

### 20.4 T13 将使用的接口（不在 T12 实现）

| 接口 | 用途 | T12 状态 |
|---|---|---|
| `POST /api/knowledge-bases/:id/chat` | SSE 流式问答 | 路由占位 |
| `GET /api/knowledge-bases/:id/conversations` | 会话列表 | 不调用 |
| `GET /api/conversations/:id/messages` | 消息历史 | 不调用 |
| `DELETE /api/conversations/:id` | 删除会话 | 不调用 |

### 20.5 前端 API 文件预留

T12 不创建 `web/src/api/chat.ts` 和 `web/src/api/conversation.ts`。这些文件在 T13 创建。T12 的 `web/src/types/` 下也不创建会话/消息相关类型。

---

## 二十一、编辑知识库说明

### 21.1 后端 API 现状

后端知识库接口（§9 #1-#5）仅支持：
- `POST /api/knowledge-bases` — 创建
- `GET /api/knowledge-bases` — 列表
- `GET /api/knowledge-bases/:id` — 详情
- `DELETE /api/knowledge-bases/:id` — 删除

**没有 `PUT / PATCH /api/knowledge-bases/:id` 更新接口。**

### 21.2 T12 处理方式

- T12 **不实现编辑知识库功能**。
- 知识库卡片**不显示编辑按钮**。
- 用户要求"禁止修改后端业务逻辑"，因此不在 T12 新增后端接口。
- 如需编辑功能，需后续任务新增后端 `PATCH /api/knowledge-bases/:id` 接口后，再在前端补充编辑 Modal。

### 21.3 记录

此项作为已知限制记入基线回填（§二十五）。

---

## 二十二、Composable 实现

### 22.1 `web/src/composables/use-knowledge-bases.ts`（新建）

```typescript
import { ref, onMounted } from 'vue'
import {
  getKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
} from '../api/knowledge-base'
import type {
  KnowledgeBase,
  CreateKnowledgeBasePayload,
} from '../types/knowledge-base'

export function useKnowledgeBases() {
  const loading = ref(false)
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const error = ref<string | null>(null)

  async function fetchList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      knowledgeBases.value = await getKnowledgeBases()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载知识库列表失败'
    } finally {
      loading.value = false
    }
  }

  async function create(
    payload: CreateKnowledgeBasePayload,
  ): Promise<KnowledgeBase> {
    const kb = await createKnowledgeBase(payload)
    await fetchList()
    return kb
  }

  async function remove(id: number): Promise<void> {
    await deleteKnowledgeBase(id)
    await fetchList()
  }

  onMounted(fetchList)

  return { loading, knowledgeBases, error, fetchList, create, remove }
}
```

### 22.2 `web/src/composables/use-documents.ts`

见 §十七 完整实现。

---

## 二十三、工具函数

### 23.1 `web/src/utils/format.ts`（新建）

```typescript
/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化日期时间 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
```

---

## 二十四、KnowledgeBaseCard 组件

### 24.1 实现

```vue
<script setup lang="ts">
import { Card, Button, Popconfirm, Typography, Tag } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import type { KnowledgeBase } from '../types/knowledge-base'
import { formatDateTime } from '../utils/format'

const props = defineProps<{ kb: KnowledgeBase }>()
const emit = defineEmits<{ delete: [id: number] }>()
const router = useRouter()

function goToDetail(): void {
  void router.push(`/knowledge-bases/${props.kb.id}`)
}

function handleDelete(): void {
  emit('delete', props.kb.id)
}
</script>

<template>
  <Card class="kb-card" hoverable @click="goToDetail">
    <template #title>{{ props.kb.name }}</template>
    <template #extra>
      <Popconfirm
        title="删除知识库将同时删除所有文档和会话，且不可恢复"
        ok-text="删除"
        cancel-text="取消"
        ok-type="danger"
        @confirm="handleDelete"
        @click.stop
      >
        <Button type="text" danger size="small" @click.stop>删除</Button>
      </Popconfirm>
    </template>
    <p class="kb-description">
      {{ props.kb.description || '暂无描述' }}
    </p>
    <div class="kb-meta">
      <Tag color="blue">{{ props.kb.documentCount }} 个文档</Tag>
      <span class="kb-time">{{ formatDateTime(props.kb.createdAt) }}</span>
    </div>
  </Card>
</template>

<style scoped>
.kb-card {
  cursor: pointer;
}

.kb-description {
  color: rgba(0, 0, 0, 0.65);
  min-height: 44px;
}

.kb-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kb-time {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
```

### 24.2 交互说明

- 点击卡片任意区域 → 进入详情页。
- 点击"删除"按钮 → `Popconfirm` 确认（`@click.stop` 阻止冒泡到卡片）。
- 卡片标题显示知识库名称。
- 卡片内容显示描述（空时"暂无描述"）、文档数 Tag、创建时间。

---

## 二十五、文件修改清单

### 25.1 修改文件（3 个）

| 文件 | 修改内容 |
|---|---|
| `web/package.json` | 新增 `vue-router@^4.5` 依赖 |
| `web/src/main.ts` | 新增 `import router` + `.use(router)` |
| `web/src/App.vue` | Layout 布局 + `<router-view />`，移除直接渲染 `HomePage` |
| `web/src/api/http.ts` | 新增 `ApiError` 类，增强错误拦截器保留 status/details |

### 25.2 新建文件（14 个）

| 文件 | 说明 |
|---|---|
| `web/src/router/index.ts` | Vue Router 配置 |
| `web/src/types/knowledge-base.ts` | 知识库 TS 类型 |
| `web/src/types/document.ts` | 文档 TS 类型 + 状态判断函数 |
| `web/src/api/knowledge-base.ts` | 知识库 API 封装 |
| `web/src/api/document.ts` | 文档 API 封装 |
| `web/src/composables/use-knowledge-bases.ts` | 知识库列表 composable |
| `web/src/composables/use-documents.ts` | 文档列表 + 轮询 composable |
| `web/src/utils/format.ts` | 文件大小 / 日期格式化 |
| `web/src/views/KnowledgeBaseListView.vue` | 知识库列表页 |
| `web/src/views/KnowledgeBaseDetailView.vue` | 知识库详情页 |
| `web/src/views/ChatPlaceholderView.vue` | T13 占位页 |
| `web/src/components/KnowledgeBaseCard.vue` | 知识库卡片 |
| `web/src/components/CreateKnowledgeBaseModal.vue` | 新建知识库弹窗 |
| `web/src/components/DocumentUploader.vue` | 文档上传组件 |
| `web/src/components/DocumentTable.vue` | 文档列表表格 |
| `web/src/components/DocumentStatusTag.vue` | 文档状态标签 |

### 25.3 保留文件（不修改）

| 文件 | 说明 |
|---|---|
| `web/src/api/health.ts` | 保留备用 |
| `web/src/types/health.ts` | 保留 |
| `web/src/views/HomePage.vue` | 移至 `/health` 路由 |
| `web/vite.config.ts` | 不修改 |
| `web/tsconfig.json` | 不修改 |
| `web/env.d.ts` | 不修改 |

### 25.4 不创建文件

| 文件 | 原因 |
|---|---|
| `web/src/api/chat.ts` | T13 创建 |
| `web/src/api/conversation.ts` | T13 创建 |
| `web/src/api/sse.ts` | T13 创建 |
| `web/src/types/chat.ts` | T13 创建 |
| `web/src/types/conversation.ts` | T13 创建 |
| `web/src/stores/*` | 不使用 Pinia |

---

## 二十六、实现顺序

```
1. 安装 vue-router
   pnpm --filter web add vue-router@^4.5

2. 修改 web/src/api/http.ts
   新增 ApiError 类 + 增强错误拦截器

3. 新建类型文件
   web/src/types/knowledge-base.ts
   web/src/types/document.ts

4. 新建 API 封装
   web/src/api/knowledge-base.ts
   web/src/api/document.ts

5. 新建工具函数
   web/src/utils/format.ts

6. 新建 composables
   web/src/composables/use-knowledge-bases.ts
   web/src/composables/use-documents.ts

7. 新建路由
   web/src/router/index.ts

8. 修改 main.ts（注册 router）

9. 修改 App.vue（Layout + router-view）

10. 新建组件（从底层到高层）
    web/src/components/DocumentStatusTag.vue
    web/src/components/KnowledgeBaseCard.vue
    web/src/components/CreateKnowledgeBaseModal.vue
    web/src/components/DocumentUploader.vue
    web/src/components/DocumentTable.vue

11. 新建页面
    web/src/views/KnowledgeBaseListView.vue
    web/src/views/KnowledgeBaseDetailView.vue
    web/src/views/ChatPlaceholderView.vue

12. 验证
    pnpm --filter web type-check  → 通过
    pnpm --filter web build       → 通过
    pnpm --filter web dev         → 手动验收
```

---

## 二十七、验收标准

### 27.1 构建验收

| 命令 | 预期结果 |
|---|---|
| `pnpm --filter web type-check` | 通过（无 TS 错误） |
| `pnpm --filter web build` | 通过（vue-tsc + vite build） |

### 27.2 功能验收（需后端启动）

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | 访问 `localhost:5173/` | 自动重定向到 `/knowledge-bases` |
| 2 | 知识库列表页加载 | 显示已有知识库卡片或空状态 |
| 3 | 点击"新建知识库" | 弹出 Modal，含名称和描述输入 |
| 4 | 创建知识库 | Modal 关闭，列表刷新，新卡片出现 |
| 5 | 创建重名知识库 | 名称字段显示"知识库名称已存在" |
| 6 | 点击知识库卡片 | 进入详情页，显示库信息和文档列表 |
| 7 | 上传 PDF 文件 | 进度条显示，上传成功后列表出现 pending 文档 |
| 8 | 上传 .docx 文件 | 前端提示"仅支持 PDF、MD、TXT 文件" |
| 9 | 上传 >20MB 文件 | 前端提示"文件大小不能超过 20MB" |
| 10 | 上传重复文件 | 提示"已存在文件：xxx（状态：completed）" |
| 11 | 文档状态轮询 | pending 文档状态自动更新（3 秒间隔） |
| 12 | 全部文档终态 | 轮询自动停止（Network 面板无继续请求） |
| 13 | 删除文档 | Popconfirm 确认后删除，列表刷新 |
| 14 | 删除知识库 | Popconfirm 确认后删除，返回列表页 |
| 15 | 访问不存在的知识库 | 显示 404 Result |
| 16 | 后端未启动 | 显示网络错误提示 |
| 17 | 浏览器刷新 | 重新从 API 加载数据 |
| 18 | 点击"进入对话" | 跳转到占位页，显示"对话功能即将上线" |
| 19 | 访问 `/health` | 显示健康检查页面 |

### 27.3 代码质量检查

| 检查项 | 要求 |
|---|---|
| `rg "\bany\b" web/src` | 无命中（禁显式 any） |
| `rg "EventSource|WebSocket|SSE|fetchSse" web/src` | 无命中（T12 不实现 SSE） |
| `rg "pinia|useStore|createPinia" web/src` | 无命中（不使用 Pinia） |
| `rg "localStorage|sessionStorage" web/src` | 无命中（不缓存业务数据） |
| `rg "mock|Mock|fake|dummy" web/src` | 无命中（不使用假数据） |

---

## 二十八、基线回填

### 28.1 `docs/00-overall-plan.md` 修订

| # | 变更 | 原因 |
|---|---|---|
| 1 | §13 任务编号调整：原 P8 T11/T12/T13 合并为 T11；原 P9 T14a 改为 T12，T14b 改为 T13 | T11 已将 SSE + 引用 + 会话合并为一个任务；前端任务编号顺延 |
| 2 | §8 前端页面划分补充：T12 不使用 Pinia，改用 Vue composables；编辑知识库因后端无更新接口而暂不实现 | 用户要求不新增复杂状态管理框架；后端 KB API 无 PUT/PATCH |
| 3 | §3.1 前端技术栈补充：`vue-router@^4.5` 在 T12 安装；Pinia 延后至 T13 视需要引入 | T12 路由需要 vue-router；T12 用 composables 替代 Pinia |

### 28.2 `docs/01-current-implementation.md` 修订（T12 完成后回填）

- 新增前端模块列表（router、api、composables、views、components）
- 新增前端页面路由清单
- 更新"当前阶段"为"T12 前端知识库与文档管理完成"

---

## 二十九、禁止项

| # | 禁止 | 原因 |
|---|---|---|
| 1 | RAG 聊天页面 | T13 实现 |
| 2 | SSE 客户端（fetch ReadableStream / EventSource） | T13 实现 |
| 3 | 会话列表页面 | T13 实现 |
| 4 | 消息历史展示 | T13 实现 |
| 5 | 引用来源展示 | T13 实现 |
| 6 | 登录和权限 | MVP 不做 |
| 7 | 多租户 | MVP 不做 |
| 8 | 修改后端业务逻辑 | 禁止 |
| 9 | Mock 假数据 / 硬编码列表 | 全部使用真实 API |
| 10 | 新增 Pinia / Vuex 等状态管理框架 | 用 composables 替代 |
| 11 | 编辑知识库功能 | 后端无 PUT/PATCH 接口 |
| 12 | 新增 dayjs / moment 等日期库 | 用原生 Date 方法 |
| 13 | `localStorage` / `sessionStorage` 持久化业务数据 | 页面刷新重新查询 |
| 14 | `app.use(Antd)` 全量注册 | 按需导入组件（tree-shaking） |
| 15 | 显式 `any` 类型 | tsconfig strict 模式 |

---

## 三十、Codex 执行指令

```
你是前端工程师，在 Mini RAG 项目中实现 T12 前端知识库与文档管理。

工作目录：web/
前置条件：后端已启动（localhost:3000），Vue dev server 代理 /api → localhost:3000。

按以下顺序执行：

1. 安装依赖
   pnpm --filter web add vue-router@^4.5

2. 修改 web/src/api/http.ts
   - 新增 ApiError 类（extends Error，含 status: number 和 details?: unknown）
   - 修改错误拦截器：从 error.response 中提取 status、message、details，抛出 ApiError
   - 保留成功响应的 isApiResponse 解包逻辑不变
   - 导出 { ApiError } 和 default http

3. 新建 web/src/types/knowledge-base.ts
   - KnowledgeBase 接口（id/name/description/documentCount/createdAt/updatedAt）
   - CreateKnowledgeBasePayload 接口（name/description?）

4. 新建 web/src/types/document.ts
   - DocumentStatus 联合类型（pending/parsing/chunking/embedding/completed/failed）
   - DocumentFileExtension 联合类型（pdf/md/txt）
   - Document 接口（id/knowledgeBaseId/fileName/fileExt/fileSize/status/errorMessage/chunkCount/createdAt/updatedAt）
   - ChunkPreview 接口、DocumentDetail 接口（extends Document）
   - TERMINAL_STATUSES / PROCESSING_STATUSES 常量
   - isTerminalStatus / isProcessingStatus 函数

5. 新建 web/src/api/knowledge-base.ts
   - getKnowledgeBases()、getKnowledgeBase(id)、createKnowledgeBase(payload)、deleteKnowledgeBase(id)
   - 使用 http 实例，返回 response.data

6. 新建 web/src/api/document.ts
   - getDocuments(kbId)、getDocument(id)、deleteDocument(id)
   - uploadDocument(kbId, file, onProgress?)：FormData + onUploadProgress

7. 新建 web/src/utils/format.ts
   - formatFileSize(bytes)、formatDateTime(isoString)

8. 新建 web/src/composables/use-knowledge-bases.ts
   - useKnowledgeBases()：loading/knowledgeBases/error/fetchList/create/remove
   - onMounted 自动 fetchList

9. 新建 web/src/composables/use-documents.ts
   - useDocuments(kbId: Ref<number>)：loading/documents/error/hasProcessingDocuments/fetchList/refresh/remove
   - watch(kbId, { immediate: true }) 触发 fetchList
   - 3 秒轮询，有非终态文档时启动，全部终态时停止
   - onUnmounted 清理定时器
   - fetchList 显示 loading，refresh 静默

10. 新建 web/src/router/index.ts
    - createWebHistory
    - 路由：/ → redirect /knowledge-bases
    - /knowledge-bases → KnowledgeBaseListView
    - /knowledge-bases/:id → KnowledgeBaseDetailView（props 传 id: number）
    - /knowledge-bases/:id/chat → ChatPlaceholderView（props 传 id: number）
    - /health → HomePage
    - 全部使用懒加载 import()

11. 修改 web/src/main.ts
    - import router from './router'
    - createApp(App).use(router).mount('#app')

12. 修改 web/src/App.vue
    - Layout + LayoutHeader + LayoutContent + router-view
    - 标题点击返回 /knowledge-bases
    - 内容区宽度 1200px

13. 新建 web/src/components/DocumentStatusTag.vue
    - 6 种状态映射（label + color）
    - failed 状态用 Tooltip 显示 errorMessage

14. 新建 web/src/components/KnowledgeBaseCard.vue
    - Card + Popconfirm 删除
    - 点击进入详情，删除 emit('delete', id)

15. 新建 web/src/components/CreateKnowledgeBaseModal.vue
    - Modal + Form（name 必填 1-100 字符, description 可选 ≤500 字符）
    - 提交调用 createKnowledgeBase，409 时设名称字段错误
    - success 时 emit('success')，cancel 时 emit('cancel')

16. 新建 web/src/components/DocumentUploader.vue
    - UploadDragger + customRequest（用 uploadDocument API）
    - beforeUpload 校验扩展名和大小
    - accept=".pdf,.md,.txt", multiple=false, maxCount=1
    - 错误处理：409 展示 details, 413/415/404 分别提示
    - 成功后 emit('success', doc) + 清空文件列表

17. 新建 web/src/components/DocumentTable.vue
    - Table 列：文件名/类型/大小/状态/切片数/创建时间/操作
    - 状态列用 DocumentStatusTag
    - 操作列 Popconfirm 删除，emit('delete', id)
    - loading 时 Table 内置 Spin

18. 新建 web/src/views/KnowledgeBaseListView.vue
    - useKnowledgeBases composable
    - 卡片网格（Row + Col，每行 3 列）
    - 新建按钮 + CreateKnowledgeBaseModal
    - 空状态 Empty / Loading Spin / 错误 Result

19. 新建 web/src/views/KnowledgeBaseDetailView.vue
    - getKnowledgeBase 获取库信息，404 显示 Result
    - useDocuments(toRef(props, 'id')) 管理文档列表
    - 库信息头（名称/描述/文档数/创建时间）+ 进入对话按钮
    - DocumentUploader + DocumentTable
    - 上传成功后调用 refresh()，删除后调用 refresh()

20. 新建 web/src/views/ChatPlaceholderView.vue
    - Result status="info" + 返回详情按钮

21. 验证
    pnpm --filter web type-check
    pnpm --filter web build
    rg "\bany\b" web/src → 无命中
    rg "EventSource|WebSocket|SSE|fetchSse" web/src → 无命中
    rg "pinia|createPinia" web/src → 无命中
    rg "localStorage|sessionStorage" web/src → 无命中

约束：
- 禁止修改后端代码
- 禁止实现 SSE/聊天/会话/消息/引用
- 禁止 Mock 假数据
- 禁止 Pinia
- 禁止显式 any
- 全部用 Ant Design Vue 按需导入（不 app.use(Antd)）
- 文件名小写连字符
- catch 用 unknown
- 显式返回类型
```

---

## 附：设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 用 composables 替代 Pinia | 用户禁止"新增复杂状态管理框架"；T12 状态简单（列表 + 轮询），composable 足够 |
| 2 | 不编辑知识库 | 后端无 PUT/PATCH 接口，T12 禁止修改后端 |
| 3 | 文件大小 20MB 前端硬编码 | 与后端 MAX_FILE_SIZE_MB 默认值一致；前端无后端配置 API |
| 4 | 路由 /knowledge-bases/:id/chat 占位 | T13 衔接入口 |
| 5 | 不新建 /knowledge-bases/:id/documents 独立路由 | 文档管理内嵌于详情页，简化路由 |
| 6 | http.ts 错误拦截器用 ApiError 替代 Error | 保留 HTTP status 和 details，支持 409/413/415 差异化处理 |
| 7 | 日期格式化用原生 Date | 不引入 dayjs 依赖 |
| 8 | UploadDragger + customRequest | 使用项目 Axios 实例，复用拦截器和 baseURL |
| 9 | 轮询用 setInterval 而非 setTimeout 递归 | 简单可靠，3 秒固定间隔，onUnmounted 清理 |
| 10 | HomePage.vue 保留在 /health 路由 | 保留调试能力，不删除已有代码 |
