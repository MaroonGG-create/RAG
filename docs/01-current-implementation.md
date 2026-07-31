# Mini RAG 当前实现快照

> 快照日期：2026-07-31（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 当前阶段：T12 前端知识库与文档管理完成
> 详细报告：`docs/reports/task-12-completion.md`

## 当前结论

- T01-T11 后端能力保持可用：知识库、文档上传/删除、解析、清洗切片、Embedding、Qdrant 写入、向量检索、非流式 RAG、SSE 流式问答、会话/消息/引用持久化均保留原模块职责。
- T12 新增 Vue Router 前端路由、知识库列表/创建/删除/详情、文档列表/上传/删除、状态展示和处理中轮询。
- 前端全部对接真实 `/api` 接口和统一响应结构，不使用 Mock 数据，不使用 `localStorage` / `sessionStorage` 缓存业务数据。
- 本次未实现知识库编辑：当前后端没有 PUT/PATCH 更新接口，T12 明确不修改后端核心业务。
- 本次没有实现聊天页面、SSE 客户端、会话列表、消息历史、引用来源展示、登录权限、多租户、Rerank、Agent 或 GraphRAG。

## 后端模块

当前业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`
- `VectorStoreModule`
- `RetrievalModule`
- `LlmModule`
- `RagModule`
- `ConversationModule`
- `ChatModule`

T12 未修改后端核心业务、实体、数据库表或 migration。

## 前端结构

T12 新增和调整的前端结构：

```text
web/src/
├── router/
│   └── index.ts
├── api/
│   ├── http.ts
│   ├── knowledge-base.ts
│   └── document.ts
├── types/
│   ├── knowledge-base.ts
│   └── document.ts
├── composables/
│   ├── use-knowledge-bases.ts
│   └── use-documents.ts
├── components/
│   ├── KnowledgeBaseCard.vue
│   ├── CreateKnowledgeBaseModal.vue
│   ├── DocumentUploader.vue
│   ├── DocumentTable.vue
│   └── DocumentStatusTag.vue
├── views/
│   ├── HomePage.vue
│   ├── KnowledgeBaseListView.vue
│   ├── KnowledgeBaseDetailView.vue
│   └── ChatPlaceholderView.vue
├── utils/
│   ├── format.ts
│   └── document-file.ts
├── App.vue
└── main.ts
```

新增依赖：

| 包 | 配置 | 实际锁定 |
|---|---:|---:|
| `vue-router` | `^4.5` | `4.6.4` |

未新增 Pinia、dayjs/moment、`@ant-design/icons-vue`。

## 前端路由

| 路由 | 页面 |
|---|---|
| `/` | 重定向到 `/knowledge-bases` |
| `/knowledge-bases` | 知识库列表页 |
| `/knowledge-bases/:id` | 知识库详情页 + 文档管理区 |
| `/knowledge-bases/:id/chat` | T13 对话页占位，不调用聊天或 SSE 接口 |
| `/health` | 原健康检查页面 |

## 前端 API 封装

- `web/src/api/http.ts` 保留成功响应 `{code,message,data}` 解包逻辑。
- 错误响应封装为 `ApiError`，保留 `status`、`code`、`details`，页面只展示安全的 `message`。
- `knowledge-base.ts` 对接：
  - `GET /api/knowledge-bases`
  - `GET /api/knowledge-bases/:id`
  - `POST /api/knowledge-bases`
  - `DELETE /api/knowledge-bases/:id`
- `document.ts` 对接：
  - `GET /api/knowledge-bases/:kbId/documents`
  - `GET /api/documents/:id`
  - `POST /api/knowledge-bases/:kbId/documents`
  - `DELETE /api/documents/:id`
- 上传使用 `FormData` 字段名 `file`，通过 Axios `onUploadProgress` 更新进度。

## 页面行为

- 知识库列表页支持 loading、错误提示、空状态、创建 Modal、删除确认；创建/删除后重新请求列表。
- 知识库详情页进入或刷新时重新请求后端详情和文档列表，不依赖本地缓存。
- 文档上传组件前端限制 `.pdf/.md/.txt`，大小上限 20MB；后端仍是最终校验来源。
- 文档状态完整展示 `pending`、`parsing`、`chunking`、`embedding`、`completed`、`failed`。
- `useDocuments` 只在存在 `pending/parsing/chunking/embedding` 文档时每 3 秒轮询列表接口；全部终态或页面卸载后停止。
- 文档删除使用确认提示，删除后刷新文档列表，并刷新知识库详情里的 `documentCount`。

## 已验证结果

构建与静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `pnpm --filter server build` | 通过 |
| `rg "\bany\b" web/src` | 无命中 |
| `rg "EventSource|WebSocket|SSE|fetchSse" web/src` | 无命中 |
| `rg "pinia|createPinia|localStorage|sessionStorage|mock|Mock|fake|dummy" web/src` | 无命中 |

真实接口验证：

| 场景 | 实际结果 |
|---|---|
| 知识库创建、列表、详情、删除 | 通过；删除后列表中无测试知识库 |
| TXT 上传 | 通过，返回 `status=pending` |
| Markdown 上传 | 通过，返回 `status=pending` |
| PDF 上传 | 通过，返回 `status=pending` |
| 文档列表 | 上传 3 个文档后列表返回 3 条，均为 `pending` |
| `documentCount` | 上传后为 3，删除文档后回到 0 |
| 重复文件上传 | HTTP 409 |
| `.docx` 上传 | HTTP 415 |
| 超过 20MB 文件上传 | HTTP 413 |
| 文档删除 | HTTP 204，删除后列表为空 |
| 测试数据清理 | `T12验证%`、`T12 UI%` 知识库残留 0；相关测试文档残留 0 |

浏览器页面验证：

| 场景 | 实际结果 |
|---|---|
| `/knowledge-bases` 初次进入 | 显示空状态，来自真实后端数据 |
| UI 新建知识库 | 成功创建并显示在列表 |
| 进入详情并刷新页面 | 详情仍从后端加载，显示真实 `documentCount` |
| 文档状态展示 | 真实上传后的文档显示 `待处理` 和 `处理中` 标识 |
| 状态轮询 | 测试中将文档状态改为 `completed` 后，页面约 3 秒后自动更新为 `已完成`，`处理中` 标识消失 |
| UI 删除文档 | 成功，表格回到空状态 |
| UI 删除知识库 | 成功，列表回到空状态 |
| `/health` | 路由可访问，健康检查页面保留 |
| `/knowledge-bases/:id/chat` | 仅显示“T13 实现”占位，不调用聊天或 SSE |

## 验证环境说明

- Docker 中 `rag-mysql-1`、`rag-qdrant-1` 为 healthy。
- 本机 3306 被宿主 `mysqld` 占用；本次验证临时启动 `rag-mysql-3307` 转发容器，将宿主 3307 转到 compose MySQL。
- 后端验证进程临时使用 `DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=root123` 启动。
- 本地联调服务当前可通过 `http://localhost:5173/knowledge-bases` 访问。

## 未完成项和已知问题

1. 知识库编辑未实现；当前后端没有更新接口，T12 不修改后端核心业务。
2. 浏览器自动化工具没有暴露设置本地文件选择器的能力，因此未通过浏览器点击上传控件选择文件；已用同一后端上传接口验证真实上传，并在页面验证列表、状态和轮询。
3. 文档上传后仍停留 `pending` 属于当前后端处理触发链路现状；T12 只负责展示和轮询状态。
4. `pnpm --filter ...` 在该工作区会先输出 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令实际执行并成功。

## 下一阶段条件

T12 已具备进入 T13 聊天页面开发的条件：知识库与文档管理前端已接入真实后端，路由、API 封装、上传、状态展示、轮询、删除和刷新取数已完成并通过验证。
