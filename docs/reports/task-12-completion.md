# T12 前端知识库与文档管理完成报告

> 日期：2026-07-31（Asia/Shanghai）
> 任务：T12 前端知识库与文档管理
> 结论：通过，具备进入 T13 的条件

## 新增和修改文件

新增：

- `web/src/router/index.ts`
- `web/src/api/knowledge-base.ts`
- `web/src/api/document.ts`
- `web/src/types/knowledge-base.ts`
- `web/src/types/document.ts`
- `web/src/composables/use-knowledge-bases.ts`
- `web/src/composables/use-documents.ts`
- `web/src/components/KnowledgeBaseCard.vue`
- `web/src/components/CreateKnowledgeBaseModal.vue`
- `web/src/components/DocumentUploader.vue`
- `web/src/components/DocumentTable.vue`
- `web/src/components/DocumentStatusTag.vue`
- `web/src/views/KnowledgeBaseListView.vue`
- `web/src/views/KnowledgeBaseDetailView.vue`
- `web/src/views/ChatPlaceholderView.vue`
- `web/src/utils/format.ts`
- `web/src/utils/document-file.ts`

修改：

- `web/package.json`
- `pnpm-lock.yaml`
- `web/src/main.ts`
- `web/src/App.vue`
- `web/src/api/http.ts`
- `web/src/views/HomePage.vue`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`

## 页面、路由和组件结构

- `/` 重定向到 `/knowledge-bases`。
- `/knowledge-bases` 实现知识库列表、新建和删除。
- `/knowledge-bases/:id` 实现知识库详情、文档上传、文档列表、状态展示和文档删除。
- `/knowledge-bases/:id/chat` 仅为 T13 占位路由，没有实现聊天页面或 SSE 客户端。
- `/health` 保留原健康检查页面。
- 组件按知识库卡片、创建弹窗、上传器、文档表格、状态 Tag 拆分；状态逻辑放在 composables，不引入 Pinia。

## API 封装和类型

- `ApiError` 保留后端错误响应的 `status`、`code`、`details`，页面展示安全 message。
- 成功响应继续从 `{code,message,data}` 解包到 `response.data`。
- 知识库类型包含 `id/name/description/documentCount/createdAt/updatedAt`。
- 文档类型包含 `id/knowledgeBaseId/fileName/fileExt/fileSize/status/errorMessage/chunkCount/createdAt/updatedAt`。
- 文档状态联合类型覆盖 `pending/parsing/chunking/embedding/completed/failed`。

## 上传与状态轮询

- 上传使用 `POST /api/knowledge-bases/:kbId/documents`，字段名为 `file`。
- 前端允许 `.pdf/.md/.txt`，最大 20MB；后端响应仍作为最终判断。
- Axios `onUploadProgress` 驱动上传进度。
- `useDocuments` 在存在 `pending/parsing/chunking/embedding` 文档时每 3 秒刷新列表。
- 全部文档进入 `completed/failed` 或页面卸载时停止轮询。

## 实际测试结果

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `pnpm --filter server build` | 通过 |
| `rg "\bany\b" web/src` | 无命中 |
| `rg "EventSource|WebSocket|SSE|fetchSse" web/src` | 无命中 |
| `rg "pinia|createPinia|localStorage|sessionStorage|mock|Mock|fake|dummy" web/src` | 无命中 |

真实后端接口验证：

| 场景 | 实际结果 |
|---|---|
| 知识库创建、列表、详情、删除 | 通过 |
| TXT 上传 | 通过，`status=pending` |
| Markdown 上传 | 通过，`status=pending` |
| PDF 上传 | 通过，`status=pending` |
| 文档列表 | 上传后返回 3 条文档 |
| `documentCount` | 上传后为 3，删除后为 0 |
| 重复上传 | HTTP 409 |
| `.docx` 上传 | HTTP 415 |
| 超过 20MB 上传 | HTTP 413 |
| 文档删除 | HTTP 204 |
| 测试数据清理 | `T12验证%`、`T12 UI%` 知识库残留 0；相关测试文档残留 0 |

浏览器页面验证：

| 场景 | 实际结果 |
|---|---|
| 页面刷新取数 | `/knowledge-bases` 和详情页刷新后均从真实后端加载 |
| UI 新建知识库 | 通过 |
| UI 删除知识库 | 通过 |
| 文档状态展示 | 真实上传文档显示 `待处理`，详情页显示 `处理中` |
| 状态轮询 | 将测试文档状态改为 `completed` 后，页面约 3 秒自动更新为 `已完成` |
| UI 删除文档 | 通过 |
| `/health` | 可访问 |
| `/knowledge-bases/:id/chat` | 仅显示 T13 占位 |

验证环境：

- Docker `rag-mysql-1`、`rag-qdrant-1` 为 healthy。
- 因宿主 3306 被本机 `mysqld` 占用，本次联调启动了临时 `rag-mysql-3307` 转发容器。
- 后端联调进程临时使用 `DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=root123`。
- 本地前端地址：`http://localhost:5173/knowledge-bases`。

## 未完成项和已知问题

1. 知识库编辑未实现；后端无 PUT/PATCH 更新接口，且 T12 禁止修改后端核心业务。
2. 浏览器自动化工具未暴露本地文件选择器设置能力，因此没有通过浏览器点击上传控件选择文件；真实上传 API、页面状态展示和轮询已验证。
3. 文档上传后状态停留 `pending` 是当前后端处理触发链路现状，T12 只负责展示和轮询。
4. `pnpm --filter ...` 仍会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但实际目标命令执行成功。

## 越界确认

- 未实现聊天页面。
- 未实现 SSE 客户端、`EventSource`、`WebSocket` 或 `fetchSse`。
- 未实现会话列表、消息历史、引用来源展示。
- 未引入 Pinia、dayjs/moment、`@ant-design/icons-vue`。
- 未修改后端核心业务、数据库表或 migration。
- `web/src` 未出现显式 `any`。

## 是否具备进入 T13

具备。T12 前端知识库与文档管理已完成真实接口对接、构建验证、主要页面交互验证和状态轮询验证。T13 可以在现有 `/knowledge-bases/:id/chat` 占位路由基础上实现聊天页面、SSE 客户端、会话列表、消息历史和引用展示。
