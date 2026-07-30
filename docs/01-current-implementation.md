# Mini RAG 当前实现快照

> 快照日期：2026-07-30（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 基准提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）
> 当前阶段：T08 Qdrant 向量存储完成后
> 详细验收：`docs/reports/task-08-completion.md`

## 1. 当前结论

- T01/T02 工程骨架、Docker Compose、MySQL/Qdrant 基础设施、TypeORM 实体、统一响应和异常处理继续存在。
- T03 知识库 CRUD 可用。
- T04 文档上传、列表、详情、删除接口可用。
- T05 文档解析可用，解析结果仍通过 `server/uploads/.parsed/{documentId}.json` 暂存传递给后续流程。
- T06 已实现文本基础清洗、PDF/Markdown/TXT 统一切片、PDF 页码保留、`DocumentChunk` 批量写入、`document.chunkCount` 更新、切片幂等和失败清理。
- T07 已实现 Embedding 配置、OpenAI 兼容客户端、确定性 Mock 模式、批量向量化、超时/重试、返回数量/顺序/维度校验、状态流转、失败重试和同文档并发控制。
- T08 已实现 Qdrant Collection 初始化、维度/距离校验、payload 索引、批量 upsert、数量校验、按文档/知识库删除、失败补偿、幂等重试和同文档并发控制。
- 成功完成 T08 后文档状态为 `completed`。
- 当前没有新增公开 HTTP 路由，没有新增数据库表或 migration，没有实现向量检索、TopK、scoreThreshold、LLM、Chat、SSE、Rerank 或前端页面。

## 2. 当前模块

后端业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`
- `VectorStoreModule`

向量存储结构：

```text
server/src/modules/vector-store/
├── qdrant-client-wrapper.ts
├── vector-store.module.ts
├── vector-store.service.ts
└── vector-store.types.ts

server/src/scripts/
├── parse-document.ts
├── chunk-document.ts
├── embed-document.ts
└── store-document.ts
```

`VectorStoreModule` 通过 `AppModule` 接入，导出 `VectorStoreService`。`DocumentModule` 和 `KnowledgeBaseModule` 复用删除方法清理 Qdrant 向量；删除失败只记录 warning，不阻断既有 MySQL 删除。

## 3. 当前接口和 CLI

HTTP 接口仍为 T04/T06 既有契约；T08 不新增向量写入 HTTP 触发接口。

内部 CLI：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
pnpm --filter server store:document <documentId>
```

`store:document` 成功时 stdout 输出摘要 JSON：

```json
{"documentId":106,"chunkCount":10,"vectorCount":10,"collectionName":"rag_chunks"}
```

失败时 stderr 输出：

```text
向量写入失败：<中文错误摘要>
```

## 4. 配置

切片配置保持：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `CHUNK_SIZE` | 500 | 整数，100-10000 |
| `CHUNK_OVERLAP` | 100 | 整数，0-9999，且必须小于 `CHUNK_SIZE` |

Embedding 配置保持：

| 环境变量 | 默认值/样例 | 校验 |
|---|---:|---|
| `EMBEDDING_BASE_URL` | `https://api.openai.com/v1` | 非空字符串 |
| `EMBEDDING_API_KEY` | `sk-your-api-key` | 非空字符串 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 非空字符串 |
| `EMBEDDING_DIMENSION` | 1024 | 整数，1-8192 |
| `EMBEDDING_BATCH_SIZE` | 20 | 整数，1-100 |
| `EMBEDDING_TIMEOUT_MS` | 30000 | 整数，1000-300000 |
| `EMBEDDING_MAX_RETRIES` | 3 | 整数，0-10 |
| `EMBEDDING_MOCK` | false | 可选布尔值 |

T08 Qdrant 配置：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `QDRANT_URL` | `http://localhost:6333` | http/https URL |
| `QDRANT_COLLECTION` | `rag_chunks` | 非空字符串 |
| `QDRANT_UPSERT_BATCH_SIZE` | 100 | 整数，1-1000 |
| `QDRANT_MOCK` | false | 可选布尔值 |

`configuration.ts` 暴露：

```ts
qdrant: {
  url: string;
  collection: string;
  upsertBatchSize: number;
  mock: boolean;
}
```

## 5. T06 清洗和切片

- `cleanText()` 做换行统一、零宽字符删除、3 个以上连续换行压缩为 2 个、首尾 `trim()`。
- PDF 按页独立清洗和切片，不跨页合并，不跨页 overlap。
- Markdown/TXT 由 T05 的单段 `pageNo=null` 透传。
- `chunkIndex` 在文档内从 0 全局连续递增。
- `charCount = content.length`。
- `qdrantPointId` 使用 Node.js `crypto.randomUUID()` 生成，并在 T08 作为 Qdrant point id。

## 6. T07 Embedding 服务

- `EmbeddingService.embedDocument(documentId)` 按 `chunkIndex ASC` 读取 `DocumentChunk`。
- 执行开始时将文档置为 `embedding`，清空 `errorMessage`。
- 按 `EMBEDDING_BATCH_SIZE` 串行分批调用 `EmbeddingClient.embed()`。
- 客户端按响应 `data[].index` 排序，并校验 index 连续、数量正确、维度等于 `EMBEDDING_DIMENSION`、向量值为 finite number。
- 成功后返回内存 `EmbeddingResult`，包含每个 chunk 的 `chunkId`、`qdrantPointId`、`vector`、`content`、`pageNo`、`kbId`、`documentId` 等字段。
- T07 不保存 vector，不写 Qdrant。
- 同进程同文档并发通过 `Map<number, Promise<EmbeddingResult>>` 复用 in-flight 执行。

## 7. T08 向量存储

Collection：

- 名称为 `QDRANT_COLLECTION`，默认 `rag_chunks`。
- 向量维度为 `EMBEDDING_DIMENSION`，当前默认 1024。
- 距离算法为 `Cosine`。
- Collection 不存在时自动创建。
- 已存在时校验维度和距离，不匹配则启动失败，不静默继续。
- 确保 `knowledgeBaseId`、`documentId` 两个 integer payload 索引。

写入：

- `VectorStoreService.storeDocument(documentId)` 拒绝 `completed` 文档重复写入。
- 重试前先按 `documentId` 删除旧向量。
- 调用 T07 `EmbeddingService.embedDocument(documentId)` 获取内存向量结果。
- 再次校验 chunk 的 `documentId`、`chunkIndex` 连续性和 vector 维度。
- 按 `QDRANT_UPSERT_BATCH_SIZE` 分批 upsert，point id 使用 `DocumentChunk.qdrantPointId`。
- payload 包含 `chunkId`、`knowledgeBaseId`、`documentId`、`documentName`、`chunkIndex`、`pageNo`、`content`。
- upsert 后按 `documentId` count，数量必须等于 chunk 数。
- 成功后文档状态更新为 `completed`，`errorMessage=NULL`。

失败和删除：

- 写入失败会按 `documentId` 补偿删除向量，并将文档置为 `failed`。
- 同文档并发通过 `Map<number, Promise<StoreResult>>` 复用 in-flight 任务。
- `deleteByDocumentId(documentId)` 和 `deleteByKnowledgeBaseId(knowledgeBaseId)` 已提供。
- 文档删除会先尝试按 `documentId` 删除向量。
- 知识库删除会先尝试按 `knowledgeBaseId` 删除向量。

## 8. 已验证结果

构建和类型检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，显示既有 2 条 migration 已执行 |

T08 样例数据：

| 文档 | 结果 |
|---|---|
| `short.txt`，documentId=105 | parse 1 页，chunk 1 条，store 写入 1 个向量 |
| `long-cn.txt`，documentId=106 | parse 1 页，chunk 10 条，store 写入 10 个向量 |
| `sample.md`，documentId=107 | parse 1 页，chunk 1 条，store 写入 1 个向量 |
| `two-pages.pdf`，documentId=108 | parse 2 页，chunk 2 条，store 写入 2 个向量；payload 中 `pageNo=1,2` |

Qdrant 验证：

- `rag_chunks` 不存在时由应用自动创建。
- REST 检查确认 `size=1024`、`distance=Cosine`。
- `payload_schema` 存在 `knowledgeBaseId`、`documentId` integer 索引。
- Qdrant 按 `documentId` count：105 为 1、106 为 10、107 为 1、108 为 2。
- documentId=108 的 payload 包含完整字段，point id 等于对应 `document_chunk.qdrant_point_id`。

幂等、重试、删除和失败：

- 对 completed 的 documentId=108 重复执行被拒绝，Qdrant count 保持 2。
- 手动将 documentId=107 置为 failed 后重试成功，Qdrant count 保持 1，未重复。
- documentId=105 删除前 Qdrant count 为 1；`DELETE /api/documents/105` 返回 204；删除后 count 为 0。
- knowledgeBaseId=54 删除前 Qdrant count 为 13；`DELETE /api/knowledge-bases/54` 返回 204；删除后 count 为 0，MySQL 中该知识库、文档、chunk 数均为 0。
- 对 documentId=106 注入 upsert 中途失败，失败前 count 为 10，失败后 count 为 0，文档状态为 `failed`；正式 CLI 重试后写回 10 个向量并回到 `completed`。
- 临时创建 768 维 collection 后启动服务失败，错误包含 `expected=1024, actual=768`；验证后已恢复 1024 维空 collection 与索引。

范围扫描：

- `rg "\bany\b" server/src/modules/vector-store server/src/scripts/store-document.ts server/src/config server/src/modules/document server/src/modules/knowledge-base`：无命中。
- T08 新代码及接线范围扫描未命中向量检索、TopK、scoreThreshold、LLM、Chat、SSE、Rerank 或前端实现。

## 9. 当前未实现范围

以下仍属于后续任务：

- 向量检索
- TopK / scoreThreshold
- RAG 问答
- LLM / Chat / SSE
- Rerank
- 上传后自动触发完整流水线
- 后台队列、定时任务、启动恢复钩子
- 前端知识库/文档/对话页面
- OCR / 图片型 PDF 支持
- 文件下载、预览、批量上传

## 10. 已知问题

1. 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍会连接到宿主 MySQL 并认证失败；本次验收使用临时 3307 转发到 compose MySQL，验收后已删除转发容器。
2. 本次未执行真实外部 Embedding API；使用 `EMBEDDING_MOCK=true` 生成向量，但 Qdrant 写入和删除使用真实 Qdrant。
3. 文档/知识库删除中的 Qdrant 删除失败目前只记录 warning，不阻断 MySQL 删除，这是 T08 文档要求的 MVP 行为。
4. T08 没有实现后台队列、自动流水线和启动恢复钩子。
5. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。
6. `pnpm --filter ...` 在该工作区会输出 `No projects matched the filters "D:\Users\Documents\RAG"` 提示，但目标 package 命令实际执行并成功。

## 11. 进入 T09 条件

代码层面具备进入 T09 条件：

- T07 的内存向量结果已能写入 Qdrant。
- Collection、维度、距离、payload 索引和 payload 字段已验证。
- upsert 数量校验、幂等重试、失败补偿、按文档/知识库删除已验证。
- 成功文档最终稳定为 `completed`。
- 未新增 schema/migration，也没有提前实现向量检索、LLM、Chat、SSE、Rerank 或前端。
