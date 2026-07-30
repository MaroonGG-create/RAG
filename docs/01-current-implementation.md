# Mini RAG 当前实现快照

> 快照日期：2026-07-30（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 基准提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）
> 当前阶段：T09 向量检索完成后
> 详细验收：`docs/reports/task-09-completion.md`

## 1. 当前结论

- T01/T02 工程骨架、Docker Compose、MySQL/Qdrant 基础设施、TypeORM 实体、统一响应和异常处理继续存在。
- T03 知识库 CRUD 可用。
- T04 文档上传、列表、详情、删除接口可用。
- T05 文档解析可用，解析结果仍通过 `server/uploads/.parsed/{documentId}.json` 暂存传递给后续流程。
- T06 已实现文本基础清洗、PDF/Markdown/TXT 统一切片、PDF 页码保留、`DocumentChunk` 批量写入、`document.chunkCount` 更新、切片幂等和失败清理。
- T07 已实现 Embedding 配置、OpenAI 兼容客户端、确定性 Mock 模式、批量向量化、超时/重试、返回数量/顺序/维度校验、状态流转、失败重试和同文档并发控制。
- T08 已实现 Qdrant Collection 初始化、维度/距离校验、payload 索引、批量 upsert、数量校验、按文档/知识库删除、失败补偿、幂等重试和同文档并发控制。
- T09 已实现向量检索：query embedding、Qdrant search、knowledgeBaseId 过滤、TopK/scoreThreshold、payload 校验、completed 文档过滤、HTTP 测试接口和内部 Service。
- 检索不会修改文档状态，不返回向量本身。
- 当前没有新增数据库表或 migration，没有实现 LLM、Prompt 拼装、RAG 回答、Chat、SSE、Conversation、Message、引用落库、Rerank 或前端页面。

## 2. 当前模块

后端业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`
- `VectorStoreModule`
- `RetrievalModule`

新增检索结构：

```text
server/src/modules/retrieval/
├── dto/
│   ├── retrieval-request.dto.ts
│   └── retrieval-response.dto.ts
├── retrieval.controller.ts
├── retrieval.module.ts
├── retrieval.service.ts
└── retrieval.types.ts
```

`RetrievalModule` 通过 `AppModule` 接入，导出 `RetrievalService`，供 T10 复用。

## 3. 当前接口和 CLI

内部 CLI：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
pnpm --filter server store:document <documentId>
```

T09 新增 HTTP 测试接口：

```text
POST /api/knowledge-bases/:id/retrieve
```

请求：

```json
{"query":"什么是 RAG？","topK":5,"scoreThreshold":0.5}
```

响应 data：

```json
{
  "results": [
    {
      "chunkId": 44,
      "documentId": 109,
      "documentName": "rag-intro.txt",
      "chunkIndex": 0,
      "pageNo": null,
      "content": "RAG is retrieval augmented generation",
      "score": 1
    }
  ],
  "total": 1,
  "took": 42
}
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

Qdrant 配置保持：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `QDRANT_URL` | `http://localhost:6333` | http/https URL |
| `QDRANT_COLLECTION` | `rag_chunks` | 非空字符串 |
| `QDRANT_UPSERT_BATCH_SIZE` | 100 | 整数，1-1000 |
| `QDRANT_MOCK` | false | 可选布尔值 |

T09 检索配置：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `TOP_K` | 5 | 整数，1-20 |
| `SCORE_THRESHOLD` | 0.5 | 数字，0-1 |

`configuration.ts` 当前暴露：

```ts
retrieval: {
  topK: number;
  scoreThreshold: number;
}
```

## 5. 检索实现

- `EmbeddingService.embedQuery(query)` 复用 T07 `EmbeddingClient`，生成单条 query vector。
- `embedQuery()` 校验返回数量为 1、维度等于 `EMBEDDING_DIMENSION`、向量值有限。
- `QdrantClientWrapper.search()` 使用 Qdrant `search` API，参数包含 `filter`、`limit`、`score_threshold`、`with_payload=true`、`with_vector=false`。
- `QDRANT_MOCK=true` 时 wrapper 使用内存 cosine 检索。
- `VectorStoreService.search()` 复用 T08 的 `knowledgeBaseId` payload filter。
- `RetrievalService.search()` 校验知识库存在，读取当前知识库下 `completed` 文档集合，空集合直接返回空结果。
- Qdrant 返回结果会校验 payload 字段类型，异常 payload 跳过并记录 warning。
- 应用层只保留 `payload.documentId` 属于 completed 文档集合的结果，避免孤儿向量返回。
- 最终按 score 降序返回，不返回 vector。

## 6. 已验证结果

构建和类型检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，显示既有 2 条 migration |

T09 真实 Qdrant + Mock Embedding 验证：

| 场景 | 结果 |
|---|---|
| Qdrant collection 检查 | `rag_chunks` 为 `size=1024`、`distance=Cosine`，索引含 `knowledgeBaseId/documentId` |
| 同文本检索 | KB55 返回 1 条，`score=1`，content 为 `RAG is retrieval augmented generation` |
| 返回字段 | 含 `chunkId/documentId/documentName/chunkIndex/pageNo/content/score`，不含 vector |
| `topK=1` | 返回条数 `<=1` |
| `scoreThreshold=0.99` + 同文本 | 仍返回 1 条，`score=1` |
| `scoreThreshold=0.99` + 不同文本 | `total=0` |
| 空知识库 | `total=0` |
| 空 query | HTTP 400 |
| 不存在知识库 | HTTP 404 |
| `topK=0` | HTTP 400 |
| `scoreThreshold=1.5` | HTTP 400 |
| knowledgeBaseId 过滤 | 同内容分别在 KB55/KB57，检索各自只返回本知识库文档 |
| 删除命中文档后检索 | documentId=109 向量 count `1 -> 0`，KB55 检索 `total=0` |
| Qdrant 检索异常 | 临时删除 collection 后检索返回 HTTP 500，文档状态仍为 `completed` |
| Swagger | `/api/docs-json` 包含 `/api/knowledge-bases/{id}/retrieve` |
| 数据库表 | 仍只有 6 张业务表加 `migrations`，无新表 |

范围扫描：

- `rg "\bany\b" server/src/modules/retrieval server/src/modules/vector-store server/src/modules/embedding server/src/config`：无命中。
- `rg "chat/stream|text/event-stream|EventSource|\bLLM\b|\bChat\b|Rerank|rerank|conversation|message_reference|\bSSE\b" server/src/modules/retrieval server/src/modules/vector-store server/src/app.module.ts`：无命中。

清理：

- T09 测试知识库、文档、chunk 均已删除，业务表计数为 0。
- Qdrant `rag_chunks` point count 为 0。
- 临时上传文件、parsed JSON、`tmp-t09-files` 已删除。
- 临时 MySQL 3307 转发容器在验收后清理。

## 7. 当前未实现范围

以下仍属于后续任务：

- LLM 调用
- Prompt 拼装
- RAG 回答
- Chat / SSE
- Conversation / Message / 引用落库
- Rerank
- 上传后自动触发完整流水线
- 后台队列、定时任务、启动恢复钩子
- 前端知识库/文档/对话页面
- OCR / 图片型 PDF 支持
- 文件下载、预览、批量上传

## 8. 已知问题

1. 本次未执行真实外部 Embedding API；使用 `EMBEDDING_MOCK=true` 生成向量，但 Qdrant 检索使用真实 Qdrant。
2. Mock embedding 对不同文本的 cosine 分数无语义含义，只适合链路和边界验收。
3. 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍有连接宿主 MySQL 的风险；本次验收实际使用 3307 转发到 compose MySQL。
4. T09 未实现自动流水线和启动恢复。
5. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。
6. `pnpm --filter ...` 在该工作区会输出 `No projects matched the filters "D:\Users\Documents\RAG"` 提示，但目标 package 命令实际执行并成功。

## 9. 进入 T10 条件

代码层面具备进入 T10 条件：

- `RetrievalService.search()` 已可供 Chat 模块复用。
- 检索结果包含 T10 组装上下文和引用所需字段。
- 无命中稳定返回空数组，T10 可据此不调用 LLM。
- Query Embedding 不修改文档状态。
- 未新增 schema/migration，也没有提前实现 LLM、Prompt、RAG 回答、Chat、SSE、会话、引用落库、Rerank 或前端。
