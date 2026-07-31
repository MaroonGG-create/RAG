# Mini RAG 当前实现快照

> 快照日期：2026-07-31（Asia/Shanghai）  
> 工作区：`D:\Users\Documents\RAG`  
> 当前阶段：T15 测试与代码质量收口完成  
> 最新报告：`docs/reports/task-15-completion.md`

## 当前结论

- T01-T11 后端能力保持可用：知识库、文档上传/删除、解析、清洗切片、Embedding、Qdrant 写入、向量检索、非流式 RAG、SSE 流式问答、会话/消息/引用持久化均已实现。
- T12-T13 前端能力保持可用：知识库列表/创建/删除/详情、文档列表/上传/删除/状态轮询、聊天页、会话列表、历史消息、SSE token 增量展示、引用展示、停止生成和刷新恢复均已实现。
- T14 已完成集成收口：接口契约核对、删除清理补齐、生产 Logger 替换、卡住文档 reset CLI、README 和环境说明更新、前端空状态微调、完整链路回归。
- T15 已完成测试与代码质量收口：新增 Jest/Vitest/ESLint 配置、后端核心单测、前端 API/SSE/composable 单测、轻量 HTTP 合约 E2E、coverage 命令和质量扫描。
- 本次未新增数据库表、未新增 migration、未实现登录权限、多租户、Agent、GraphRAG、Rerank 或 WebSocket。T15 仅新增测试/质量相关 devDependencies，未新增业务运行依赖。

## T15 测试基础设施

后端：
- Jest + ts-jest：`server/jest.config.ts`
- E2E 配置：`server/test/jest-e2e.json`
- ESLint：`server/.eslintrc.cjs`
- 脚本：`test`、`test:watch`、`test:cov`、`test:e2e`、`lint`、`lint:check`
- `server/tsconfig.json` 已补充 `noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`

前端：
- Vitest + jsdom + Vue Test Utils：`web/vitest.config.ts`
- ESLint：`web/.eslintrc.cjs`
- 脚本：`test`、`test:watch`、`test:cov`、`lint`、`lint:check`

当前测试文件：

```text
server/src/modules/
├─ processing/chunking/__tests__/text-cleaner.spec.ts
├─ processing/chunking/__tests__/text-splitter.spec.ts
├─ processing/chunking/__tests__/chunking.service.spec.ts
├─ processing/parsing/__tests__/plain-text.parser.spec.ts
├─ embedding/__tests__/embedding-client.spec.ts
├─ embedding/__tests__/embedding.service.spec.ts
├─ vector-store/__tests__/vector-store.service.spec.ts
├─ retrieval/__tests__/retrieval.service.spec.ts
├─ rag/__tests__/prompt-builder.spec.ts
├─ rag/__tests__/rag.service.spec.ts
├─ chat/__tests__/chat.service.spec.ts
├─ conversation/__tests__/conversation.service.spec.ts
├─ conversation/__tests__/message.service.spec.ts
├─ document/__tests__/document.service.spec.ts
└─ knowledge-base/__tests__/knowledge-base.service.spec.ts

server/test/api-contract.e2e-spec.ts

web/src/
├─ api/__tests__/http.spec.ts
├─ api/__tests__/sse.spec.ts
├─ composables/__tests__/use-chat.spec.ts
└─ composables/__tests__/use-conversations.spec.ts
```

T15 覆盖重点：
- 文本解析、清洗、切片、overlap、PDF 页码、chunk 元数据。
- Embedding 数量、顺序、维度、重试和失败状态。
- Qdrant filter、payload、upsert 数量校验和删除方法。
- Retrieval 的知识库过滤、completed 文档过滤、payload 安全处理。
- RAG 上下文、无命中不调用 LLM、references 快照。
- SSE 事件解析、半包/粘包/多行 data、abort 和错误事件。
- 会话、消息、引用保存一致性。
- 文档和知识库删除后的向量、文件、解析缓存清理。

T15 发现并修正：
- `text-splitter.ts` 在无分隔符长文本叠加 overlap 时可能生成超过 `chunkSize` 的 chunk，已改为 overflow 滑动切分。
- `KnowledgeBaseService.remove()` 的文件/解析缓存/目录清理失败已改为 warn 后继续删除数据库，符合 T14 删除策略。
- `MessageService` 移除未使用的 `referenceRepository` 注入。
- 前端 `sse.ts` 和 `KnowledgeBaseListView.vue` 清理 lint 触发点。

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

T14 后端收口：
- `http-exception.filter.ts`、`main.ts`、`health.service.ts`、`database.service.ts` 的生产 `console.error` 已替换为 Nest `Logger`。
- `KnowledgeBaseService.remove()` 删除知识库时先清 Qdrant，再清文档上传文件、解析缓存和知识库上传目录，最后删除数据库记录。
- `DocumentStorageService` 新增 `deleteKnowledgeBaseDirectory()`。
- 新增 `reset-stuck-documents.ts`，支持：
  - `pnpm --filter server reset:document <documentId>`
  - `pnpm --filter server reset:documents <knowledgeBaseId>`

## 前端结构

当前主要前端结构：

```text
web/src/
├─ router/
│  └─ index.ts
├─ api/
│  ├─ http.ts
│  ├─ knowledge-base.ts
│  ├─ document.ts
│  ├─ conversation.ts
│  ├─ chat.ts
│  └─ sse.ts
├─ types/
│  ├─ knowledge-base.ts
│  ├─ document.ts
│  ├─ conversation.ts
│  └─ chat.ts
├─ composables/
│  ├─ use-knowledge-bases.ts
│  ├─ use-documents.ts
│  ├─ use-conversations.ts
│  └─ use-chat.ts
├─ components/
│  ├─ KnowledgeBaseCard.vue
│  ├─ CreateKnowledgeBaseModal.vue
│  ├─ DocumentUploader.vue
│  ├─ DocumentTable.vue
│  ├─ DocumentStatusTag.vue
│  ├─ ConversationList.vue
│  ├─ MessageList.vue
│  ├─ MessageBubble.vue
│  ├─ ReferencePanel.vue
│  └─ ChatInput.vue
├─ views/
│  ├─ HomePage.vue
│  ├─ KnowledgeBaseListView.vue
│  ├─ KnowledgeBaseDetailView.vue
│  └─ ChatView.vue
├─ utils/
│  ├─ format.ts
│  └─ document-file.ts
├─ App.vue
└─ main.ts
```

T14 前端微调：
- `DocumentTable.vue` 空状态为“暂无文档，点击上方上传”。
- `MessageList.vue` 空状态为“输入问题开始对话”。

依赖现状：
- 已有：`vue`、`vue-router`、`ant-design-vue`、`axios`
- T15 新增测试依赖：`vitest`、`@vue/test-utils`、`jsdom`、`@vitest/coverage-v8`、`eslint`、`eslint-plugin-vue`、`@typescript-eslint/*`
- 未新增：Pinia、图标库、聊天专项运行依赖

## 路由与接口

前端路由：

| 路由 | 页面 |
|---|---|
| `/` | 重定向到 `/knowledge-bases` |
| `/knowledge-bases` | 知识库列表页 |
| `/knowledge-bases/:id` | 知识库详情页 + 文档管理区 |
| `/knowledge-bases/:id/chat` | RAG 聊天页，支持 `?conversationId=N` 恢复历史会话 |
| `/health` | 健康检查页面 |

核心后端接口：
- `GET /api/health`
- `POST /api/knowledge-bases`
- `GET /api/knowledge-bases`
- `GET /api/knowledge-bases/:id`
- `DELETE /api/knowledge-bases/:id`
- `POST /api/knowledge-bases/:id/documents`
- `GET /api/knowledge-bases/:id/documents`
- `GET /api/documents/:id`
- `DELETE /api/documents/:id`
- `POST /api/knowledge-bases/:id/retrieve`
- `POST /api/knowledge-bases/:id/ask`
- `POST /api/knowledge-bases/:id/chat`
- `GET /api/knowledge-bases/:id/conversations`
- `GET /api/conversations/:id/messages`
- `DELETE /api/conversations/:id`

SSE 事件：
- `metadata`：`{conversationId,userMessageId}`
- `token`：`{delta}`
- `references`：`[{chunkId,documentId,documentName,pageNo,content,score}]`
- `done`：`{assistantMessageId}`
- `error`：`{message}`

## 文档处理状态

| 状态 | 当前含义 |
|---|---|
| `pending` | 已上传，待解析；或已解析后待切片 |
| `parsing` | 正在解析 |
| `chunking` | 已切片，待向量化或向量写入 |
| `embedding` | 已向量化，待写入 Qdrant 或正在写入 |
| `completed` | 已写入 Qdrant，可检索问答 |
| `failed` | 处理失败，`errorMessage` 记录失败原因 |

CLI 流水线：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
pnpm --filter server store:document <documentId>
```

卡住文档恢复：

```bash
pnpm --filter server reset:document <documentId>
pnpm --filter server reset:documents <knowledgeBaseId>
```

## 删除一致性

删除文档：
- 先按 `documentId` 删除 Qdrant 向量。
- 再删除 MySQL `document`，由 FK 级联删除 `document_chunk`。
- 最后删除上传文件和解析缓存。
- Qdrant 删除失败会中断请求，便于重试。
- 文件清理失败只记录日志。

删除知识库：
- 先按 `knowledgeBaseId` 删除 Qdrant 向量。
- 再清理该知识库下所有文档文件和解析缓存。
- 再删除 `server/uploads/{knowledgeBaseId}` 目录。
- 最后删除 MySQL `knowledge_base`，由 FK 级联删除文档、切片、会话、消息和引用。

## 已验证结果

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server run test -- --runInBand` | 通过，15 个 test suites，103 tests |
| `pnpm --filter server run test:e2e -- --runInBand` | 通过，1 个 test suite，6 tests |
| `pnpm --filter web run test` | 通过，4 个 test files，33 tests |
| `pnpm --filter server run test:cov -- --runInBand` | 通过；All files statements 53.07%；P0 文件 `text-cleaner` 100%、`text-splitter` 95.38%、`plain-text.parser` 100%、`prompt-builder` 95.83% |
| `pnpm --filter web run test:cov` | 通过；All files statements 64.79%；`sse.ts` 97.02%、`http.ts` 94.44%、`use-chat.ts` 84.35%、`use-conversations.ts` 91.07% |
| `pnpm --filter server run lint:check` | 通过 |
| `pnpm --filter web run lint:check` | 通过 |
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 ... pnpm --filter server migration:show` | 通过，两条 migration 均已执行 |
| 前端 console/debugger/mock/EventSource/WebSocket/localStorage/sessionStorage/any 扫描 | 无命中 |
| 后端生产代码 console 扫描（排除 scripts） | 无命中 |
| 全源码显式 `any` 扫描（server/src、server/test、web/src） | 无命中 |
| 硬编码 API Key 扫描 | 源代码无命中；README 和 `.env.example` 仅有 `sk-your-api-key` 占位符 |

真实联调：

| 场景 | 实际结果 |
|---|---|
| 创建/查询知识库 | 通过 |
| 上传 PDF/MD/TXT | 通过 |
| PDF/MD/TXT 解析、切片、Embedding、Qdrant 入库 | 通过 |
| PDF 页码保留 | 通过，PDF chunk 页码为 1 和 2 |
| `chunkIndex`、`charCount`、`qdrantPointId` | 通过，连续索引、字符数大于 0、UUID 格式正确 |
| 向量检索命中 | 通过，PDF 命中 score `0.99999994` |
| 阈值过滤无命中 | 通过 |
| SSE 新会话问答 | 通过，收到 `metadata/token/references/done` |
| 引用数据 | 通过，引用来自真实检索结果，含文档名、页码、score |
| 已有会话续聊 | 通过 |
| 页面刷新恢复 | 通过 |
| 主动中止 SSE | 通过 |
| 重复上传/类型错误/超大文件/空问题/不存在知识库 | 均返回预期错误 |
| 空白 TXT 解析失败 | 通过，文档落 `failed` |
| Embedding 服务失败 | 通过，文档落 `failed` |
| reset CLI | 通过，卡住文档重置为 `pending` |
| 删除文档 | 通过，Qdrant、DB、磁盘文件、解析缓存均清理 |
| 删除知识库 | 通过，Qdrant、DB、上传目录均清理 |
| 前端 UI 创建/删除知识库 | 通过 |
| 前端详情和聊天空状态 | 通过 |

## 验证环境说明

- Docker 中 `rag-mysql-1`、`rag-qdrant-1` 运行健康。
- 本机 3306 被本机 MySQL 占用或鉴权不一致，T14 实际联调使用 `127.0.0.1:3307` 访问 Docker MySQL 转发。
- 正常链路使用真实 Qdrant、Mock Embedding、Mock LLM。
- Embedding 失败场景使用不可达 URL `http://127.0.0.1:9/v1`。
- T14 自动化临时数据 `72/73/74/75/76/77` 已清理，无 DB、Qdrant、上传目录残留。
- 当前数据库仍有既有知识库 `71/1231321`，含 2 个 `pending` 文档和 1 条会话，Qdrant 向量数为 0；该数据非 T14 临时命名数据，未删除。

## 未执行项和已知问题

1. 未通过浏览器文件选择器上传文件；上传验证使用真实 HTTP multipart 接口完成。
2. 未执行移动端截图验收。
3. 未调用真实外部 Embedding/LLM 服务。
4. 未构造应用启动后 Qdrant upsert 中途失败的假服务；仅验证了 Qdrant URL 不可达导致 CLI 初始化失败的实际表现。
5. T15 未引入真实 MySQL 测试库跑完整 AppModule E2E；当前 E2E 是 HTTP 合约层测试，Service 依赖使用 mock，避免污染开发库。
6. T15 覆盖率未覆盖 controller、storage、LLM HTTP streaming、PDF parser 等低 ROI 或外部依赖较重的文件；覆盖率数值以实际 `test:cov` 输出为准。
7. 当前 `.env` 默认 MySQL 指向 `localhost:3306` 时，`migration:show` 在本机环境会鉴权失败；需按实际 Docker 转发端口设置 `DB_HOST/DB_PORT`。
8. `pnpm --filter ...` 在当前工作区会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令随后实际执行。
9. Qdrant 在 CLI 应用初始化阶段不可达时，命令会失败并输出错误，但文档尚未进入 `storeDocument()`，状态保持 `chunking` 且 `errorMessage=null`。

## 下一阶段条件

T15 已具备进入部署与 README 收口阶段的条件。下一步建议聚焦：
- 梳理 `.env` 与 Docker Compose 的本机端口策略。
- 完善部署 README、生产环境配置和演示脚本。
- 评估 Qdrant 初始化失败时的恢复策略。
