# T08 Qdrant 向量存储完成报告

> 日期：2026-07-30（Asia/Shanghai）
> 范围：Qdrant Collection 初始化、DocumentChunk 向量写入、删除方法、状态/幂等/失败补偿

## 1. 新增和修改文件

新增：

- `server/src/modules/vector-store/vector-store.types.ts`
- `server/src/modules/vector-store/qdrant-client-wrapper.ts`
- `server/src/modules/vector-store/vector-store.service.ts`
- `server/src/modules/vector-store/vector-store.module.ts`
- `server/src/scripts/store-document.ts`
- `docs/reports/task-08-completion.md`

修改：

- `.env.example`
- 本地 git-ignored `.env`（仅用于本次 mock/真实 Qdrant 验收）
- `pnpm-lock.yaml`
- `server/package.json`
- `server/src/app.module.ts`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`
- `server/src/modules/document/document.module.ts`
- `server/src/modules/document/document.service.ts`
- `server/src/modules/knowledge-base/knowledge-base.module.ts`
- `server/src/modules/knowledge-base/knowledge-base.service.ts`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`

新增依赖：`@qdrant/js-client-rest@1.12.0`。未新增数据库表，未新增 migration。

## 2. Qdrant Collection 设计

- Collection 名称：`QDRANT_COLLECTION`，默认 `rag_chunks`。
- 向量维度：沿用 `EMBEDDING_DIMENSION`，当前默认和验收值为 `1024`。
- 距离算法：`Cosine`。
- `VectorStoreService.onModuleInit()` 会检查 collection；不存在时自动创建。
- 已存在时会校验维度和距离。维度不一致会启动失败，例如本次验证得到：`Qdrant Collection 维度不匹配：expected=1024, actual=768`。
- `QDRANT_MOCK=true` 时跳过真实 Qdrant HTTP 调用，使用内存 Map 验证服务流程。

## 3. Payload 和索引

Collection 初始化会确保两个 payload 索引：

- `knowledgeBaseId`：integer
- `documentId`：integer

写入 payload 字段：

- `chunkId`
- `knowledgeBaseId`
- `documentId`
- `documentName`
- `chunkIndex`
- `pageNo`
- `content`

point id 使用 `DocumentChunk.qdrantPointId`，不会重新生成。多页 PDF 验证中 `two-pages.pdf` 两个点的 `pageNo` 分别为 `1`、`2`。

## 4. 批量写入策略

- CLI：`pnpm --filter server store:document <documentId>`。
- `VectorStoreService.storeDocument(documentId)` 内部调用 T07 的 `EmbeddingService.embedDocument(documentId)`，接收内存中的 `{ chunkId, qdrantPointId, vector }` 等结果。
- 写入前先按 `documentId` 删除旧向量。
- 按 `QDRANT_UPSERT_BATCH_SIZE` 分批 upsert，默认和本次验收值为 `100`，校验范围 `1-1000`。
- 每个 point 使用 `qdrantPointId` 作为 Qdrant id，因此重复重试不会产生新 point id。
- upsert 完成后按 `documentId` count，要求实际写入数量等于 embedding chunk 数。

## 5. 状态流转

- `storeDocument()` 开始前拒绝 `completed` 文档重复写入。
- 执行过程中会调用 T07，文档先进入 `embedding`。
- Qdrant 写入和数量校验成功后更新为 `completed`，并清空 `errorMessage`。
- 任意失败会补偿删除当前 `documentId` 的向量，并将文档置为 `failed`，`errorMessage` 截断到 300 字符。

## 6. 幂等、失败补偿和并发

- 同进程同文档使用 `Map<number, Promise<StoreResult>>` 复用 in-flight 任务，避免重复执行。
- 失败重试时先清理旧向量，再重新调用 T07 生成向量并 upsert。
- 写入中途失败时执行补偿删除，保证当前文档不残留部分向量。
- 对已 `completed` 文档再次执行会拒绝，不删除既有向量，不产生重复点。
- `deleteByDocumentId(documentId)` 和 `deleteByKnowledgeBaseId(knowledgeBaseId)` 已作为可复用方法提供。
- 按 T08 文档要求，现有文档删除和知识库删除流程已接入向量删除；删除失败只记录 warning，不阻断 MySQL 删除。

## 7. 实际执行的构建和测试

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，显示既有 2 条 migration 已执行 |
| `rg "\bany\b" server/src/modules/vector-store server/src/scripts/store-document.ts server/src/config server/src/modules/document server/src/modules/knowledge-base` | 无命中 |
| `rg "search\(|TopK|scoreThreshold|chat/stream|text/event-stream|EventSource|Rerank|rerank|LLM|Chat" ...` | 无命中 |

本次 Docker daemon 可用。由于宿主机 `localhost:3306` MySQL 对 `.env` 的 `root/root123` 拒绝认证，验收通过临时 `rag-mysql-3307-proxy` 将 compose 内 MySQL 暴露到 `127.0.0.1:3307`；验收后已删除该临时容器。

Qdrant Collection 和索引：

- 启动服务时 collection 不存在，自动创建 `rag_chunks`。
- REST 检查确认 `size=1024`、`distance=Cosine`。
- `payload_schema` 中存在 `knowledgeBaseId` 和 `documentId` integer 索引。

正常写入：

| 文档 | 结果 |
|---|---|
| `short.txt`，documentId=105 | parse 1 页，chunk 1 条，store 返回 `vectorCount=1` |
| `long-cn.txt`，documentId=106 | parse 1 页，chunk 10 条，store 返回 `vectorCount=10` |
| `sample.md`，documentId=107 | parse 1 页，chunk 1 条，store 返回 `vectorCount=1` |
| `two-pages.pdf`，documentId=108 | parse 2 页，chunk 2 条，store 返回 `vectorCount=2` |

数据库和 Qdrant 核对：

- 文档 105-108 写入成功后状态均为 `completed`，`error_message=NULL`。
- Qdrant 按 `documentId` count 分别为 `1`、`10`、`1`、`2`。
- `two-pages.pdf` 的 Qdrant payload 包含完整字段；两条点分别对应 `chunkIndex=0,pageNo=1` 和 `chunkIndex=1,pageNo=2`。

重复执行和失败重试：

- 对已 `completed` 的 documentId=108 重复执行 `store:document`，命令失败并输出 `文档已完成向量写入，禁止重复存储`；Qdrant count 保持 `2`。
- 手动将 documentId=107 置为 `failed` 后重试，写入成功并回到 `completed`；Qdrant count 仍为 `1`，未重复。

删除验证：

- documentId=105 删除前 Qdrant count 为 `1`；调用 `DELETE /api/documents/105` 返回 `204`；删除后 count 为 `0`。
- knowledgeBaseId=54 删除前 Qdrant count 为 `13`；调用 `DELETE /api/knowledge-bases/54` 返回 `204`；删除后 count 为 `0`，MySQL 中该知识库、文档、chunk 数均为 `0`。

失败补偿：

- 将 documentId=106 置为 `failed`，在 Nest 应用上下文中临时注入 `upsertPoints()` 故障：先真实写入 1 个点，再抛出 `injected qdrant upsert failure`。
- 测试前该文档 Qdrant count 为 `10`；故障后 count 为 `0`，文档状态为 `failed`，`error_message=injected qdrant upsert failure`。
- 随后用正式 CLI 重试 documentId=106，成功写入 `10` 个向量并回到 `completed`。

维度错误：

- 临时删除空 collection，创建 `size=768,distance=Cosine` 的 `rag_chunks`。
- 启动服务退出码为 `1`，错误明确包含 `expected=1024, actual=768`。
- 验证后已删除错误 collection，并通过应用初始化重新创建正确的空 collection 与索引。

## 8. 未执行项与已知问题

- 未执行真实外部 Embedding API；向量内容由 `EMBEDDING_MOCK=true` 生成，但 Qdrant 写入、删除、索引和维度校验均使用真实 Qdrant。
- 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍会连接到宿主 MySQL 并认证失败；本次验收实际使用 `127.0.0.1:3307` 转发到 compose MySQL。
- `pnpm --filter ...` 在该工作区会输出 `No projects matched the filters "D:\Users\Documents\RAG"` 提示，但目标 package 命令实际执行并成功。
- 文档/知识库删除中的 Qdrant 删除失败目前只记录 warning，不阻断 MySQL 删除；这是 T08 文档指定的 MVP 行为。
- T08 仍未实现后台队列、自动流水线和启动恢复。

## 9. 越界实现检查

T08 范围内新增了 Qdrant 写入和删除；未实现以下越界能力：

- 向量检索
- TopK
- scoreThreshold
- RAG 问答
- LLM
- Chat
- SSE
- Rerank
- 前端页面
- 新数据库表或 migration

## 10. 是否具备进入 T09 的条件

具备。T08 已能将 T07 返回的内存向量按 `DocumentChunk.qdrantPointId` 写入 Qdrant，payload、索引、数量校验、状态流转、幂等重试、失败补偿和按文档/知识库删除均已验证。
