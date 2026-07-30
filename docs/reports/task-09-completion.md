# T09 向量检索完成报告

> 日期：2026-07-30（Asia/Shanghai）
> 范围：Query Embedding、Qdrant 向量检索、knowledgeBaseId 过滤、TopK/阈值、检索 HTTP 接口

## 1. 新增和修改文件

新增：

- `server/src/modules/retrieval/retrieval.types.ts`
- `server/src/modules/retrieval/dto/retrieval-request.dto.ts`
- `server/src/modules/retrieval/dto/retrieval-response.dto.ts`
- `server/src/modules/retrieval/retrieval.service.ts`
- `server/src/modules/retrieval/retrieval.controller.ts`
- `server/src/modules/retrieval/retrieval.module.ts`
- `docs/reports/task-09-completion.md`

修改：

- `.env.example`
- 本地 git-ignored `.env`（仅用于本次验收配置）
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`
- `server/src/app.module.ts`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`
- `server/src/modules/embedding/embedding.service.ts`
- `server/src/modules/vector-store/qdrant-client-wrapper.ts`
- `server/src/modules/vector-store/vector-store.service.ts`
- `server/src/modules/vector-store/vector-store.types.ts`

未新增运行时依赖，未新增数据库表，未新增 migration，未修改实体。

## 2. Query Embedding 复用方式

- `EmbeddingService` 新增 `embedQuery(query: string): Promise<number[]>`。
- 内部复用 T07 的 `EmbeddingClient.embed([query])`，因此沿用 Mock、HTTP 超时、可重试失败和返回排序逻辑。
- 校验返回数量必须为 1，向量维度必须等于 `EMBEDDING_DIMENSION`，并复用 finite number 校验。
- `embedQuery()` 不读取、不更新 `Document` 或 `DocumentChunk`，不会修改任何文档状态。

## 3. Qdrant 检索和过滤条件

- `QdrantClientWrapper.search(vector, filter, limit, scoreThreshold)` 封装 `QdrantClient.search()`。
- 真实 Qdrant 调用参数：
  - `vector`: query vector
  - `filter`: `{ must: [{ key: 'knowledgeBaseId', match: { value: knowledgeBaseId } }] }`
  - `limit`: resolved topK
  - `score_threshold`: resolved scoreThreshold
  - `with_payload: true`
  - `with_vector: false`
- `QDRANT_MOCK=true` 时使用内存 Map 遍历 point，按 payload filter 匹配后计算 cosine，按阈值过滤、score 降序排序并截断到 limit。
- `VectorStoreService.search()` 只负责创建 `knowledgeBaseId` filter 并转发给 wrapper，不做 RAG/LLM 逻辑。

## 4. topK 和 scoreThreshold 配置

新增配置：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `TOP_K` | 5 | 整数，1-20 |
| `SCORE_THRESHOLD` | 0.5 | 数字，0-1 |

请求级覆盖：

- `POST /api/knowledge-bases/:id/retrieve` body 支持 `topK?` 和 `scoreThreshold?`。
- DTO 校验 `topK` 范围 1-20，`scoreThreshold` 范围 0-1。
- 未传时使用环境变量默认值。

## 5. 返回 DTO

新增接口：

```text
POST /api/knowledge-bases/:id/retrieve
```

请求 body：

```json
{
  "query": "什么是 RAG？",
  "topK": 5,
  "scoreThreshold": 0.5
}
```

控制器返回 `RetrievalResponseData`，由全局拦截器包装为 `{code,message,data}`。`data.results[]` 字段为：

- `chunkId`
- `documentId`
- `documentName`
- `chunkIndex`
- `pageNo`
- `content`
- `score`

不会返回 vector。

## 6. 应用层过滤和异常处理

- `RetrievalService.search()` 先校验知识库存在，不存在抛 `NotFoundException('知识库不存在')`。
- 查询当前知识库下 `status='completed'` 的文档 ID 集合；若为空，直接返回空结果。
- Qdrant 返回后逐条校验 payload 字段类型；缺失或类型异常的结果跳过并记录 warning。
- 只保留 `payload.documentId` 属于 completed 文档集合的结果，避免返回孤儿向量。
- 最终结果按 `score` 降序返回。
- `EmbeddingFailure` 在控制器映射为 502。
- Qdrant 检索异常保留为 500，由全局异常过滤器处理。

## 7. 实际执行的构建和测试

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，仅显示既有 2 条 migration |
| `rg "\bany\b" server/src/modules/retrieval server/src/modules/vector-store server/src/modules/embedding server/src/config` | 无命中 |
| `rg "chat/stream|text/event-stream|EventSource|\bLLM\b|\bChat\b|Rerank|rerank|conversation|message_reference|\bSSE\b" server/src/modules/retrieval server/src/modules/vector-store server/src/app.module.ts` | 无命中 |

测试环境：

- Docker MySQL 与 Qdrant 均运行。
- 本机默认 3306 仍存在历史冲突风险，本次通过临时 `rag-mysql-3307-proxy` 使用 `127.0.0.1:3307` 连接 compose MySQL。
- 后端以 `QDRANT_MOCK=false`、`EMBEDDING_MOCK=true` 启动，检索和写入均使用真实 Qdrant，向量内容使用 T07 Mock embedding。
- Qdrant collection 检查确认 `rag_chunks` 为 `size=1024`、`distance=Cosine`，payload 索引包含 `knowledgeBaseId`、`documentId`。

测试数据：

- KB 55：`T09 Retrieval Test`
- 空 KB 56：`T09 Empty KB`
- KB 57：`T09 Retrieval Filter KB`
- documentId=109：`rag-intro.txt`，内容 `RAG is retrieval augmented generation`，1 chunk，store 写入 1 向量。
- documentId=110：`other.txt`，内容 `Graph databases store nodes and edges`，1 chunk，store 写入 1 向量。
- documentId=111：同 KB57 的 `rag-intro.txt`，1 chunk，store 写入 1 向量。

检索结果：

| 场景 | 实际结果 |
|---|---|
| KB55 同文本 query | `total=1`，`score=1`，`content="RAG is retrieval augmented generation"` |
| 返回字段检查 | 结果包含 `chunkId/documentId/documentName/chunkIndex/pageNo/content/score`，未返回 vector |
| `topK=1` | `total=1`，满足 `results.length <= 1` |
| `scoreThreshold=0.99` + 同文本 | `total=1`，`score=1` |
| `scoreThreshold=0.99` + 不同文本 | `total=0` |
| 空 KB56 | `total=0` |
| 空 query | HTTP 400 |
| 不存在 KB 999999 | HTTP 404 |
| `topK=0` | HTTP 400 |
| `scoreThreshold=1.5` | HTTP 400 |
| KB 过滤 | KB55 返回 documentId=109；KB57 返回 documentId=111，未串库 |
| 删除 documentId=109 后检索 KB55 | Qdrant count `1 -> 0`，检索 `total=0` |
| Qdrant collection 临时删除后检索 KB57 | HTTP 500；documentId=111 状态仍为 `completed` |
| Swagger | `/api/docs-json` 包含 `/api/knowledge-bases/{id}/retrieve` |
| 数据库表 | 仍只有 `conversation`、`document`、`document_chunk`、`knowledge_base`、`message`、`message_reference`、`migrations` |

清理结果：

- 本次测试知识库、文档和 chunk 均已清理，业务表计数为 0。
- Qdrant `rag_chunks` point count 为 0。
- 临时上传文件、parsed JSON、`tmp-t09-files` 已删除。
- Qdrant collection 在异常测试后已恢复为空 collection，维度 1024、距离 Cosine、payload 索引存在。

## 8. 未完成项与已知问题

- 未执行真实外部 Embedding API；本次向量由 `EMBEDDING_MOCK=true` 生成，因此只能验证检索链路，不能评价真实语义召回质量。
- 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍有连接宿主 MySQL 的风险；本次实际验收使用 3307 临时转发。
- Mock embedding 对不同文本的分数无语义意义；同文本 score=1 可用于确定性验收。
- T09 未实现后台队列、自动流水线、启动恢复钩子。
- 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。
- `pnpm --filter ...` 在该工作区会输出 `No projects matched the filters "D:\Users\Documents\RAG"` 提示，但目标 package 命令实际执行并成功。

## 9. 越界实现检查

不存在以下越界实现：

- LLM 调用
- Prompt 拼装
- RAG 回答
- SSE
- Conversation / Message / 引用落库
- Rerank
- 前端页面
- 新数据库表或 migration

## 10. 是否具备进入 T10 的条件

具备。T09 已提供 `RetrievalService.search()` 和 `POST /api/knowledge-bases/:id/retrieve`，可基于 `knowledgeBaseId`、query、topK、scoreThreshold 返回按 score 降序的 chunk 引用结果；无命中返回空数组，T10 可据此决定不调用 LLM。
