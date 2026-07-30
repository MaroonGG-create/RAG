# T07 Embedding 服务完成报告

> 日期：2026-07-30（Asia/Shanghai）
> 范围：Embedding 配置、客户端、DocumentChunk 批量向量化、状态/重试/并发控制

## 1. 新增和修改文件

新增：

- `server/src/modules/embedding/embedding.types.ts`
- `server/src/modules/embedding/embedding-client.ts`
- `server/src/modules/embedding/embedding.service.ts`
- `server/src/modules/embedding/embedding.module.ts`
- `server/src/scripts/embed-document.ts`
- `docs/reports/task-07-completion.md`

修改：

- `.env.example`
- 本地 git-ignored `.env`（用于 mock 验收）
- `server/src/config/env.validation.ts`
- `server/src/config/configuration.ts`
- `server/src/app.module.ts`
- `server/package.json`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`

未新增数据库表，未新增 migration，未新增运行时依赖。

## 2. 模型调用方式

- 非 Mock 模式使用 Node 20 内置 `fetch`，POST `{EMBEDDING_BASE_URL}/embeddings`。
- 请求体为 `{ model, input: texts }`。
- Header 使用 `Authorization: Bearer <EMBEDDING_API_KEY>` 和 `Content-Type: application/json`。
- 不使用 OpenAI SDK、axios、LangChain 或 Qdrant 客户端。
- 日志不输出 API key、文本内容、响应正文或向量。
- `EMBEDDING_MOCK=true` 时使用 SHA-256 生成确定性向量，不调用外部服务。

## 3. 实际配置

本次实现的配置项：

- `EMBEDDING_BASE_URL=https://api.openai.com/v1`
- `EMBEDDING_API_KEY=sk-your-api-key`（`.env.example` 占位）；本地验收使用 `sk-mock-key`
- `EMBEDDING_MODEL=text-embedding-3-small`
- `EMBEDDING_DIMENSION=1024`
- `EMBEDDING_BATCH_SIZE=20`
- `EMBEDDING_TIMEOUT_MS=30000`
- `EMBEDDING_MAX_RETRIES=3`
- `EMBEDDING_MOCK=false`（本地验收设为 true）

校验范围：

- dimension：1-8192
- batch size：1-100
- timeout：1000-300000ms
- max retries：0-10

## 4. 批处理和重试策略

- `EmbeddingService` 按 `chunkIndex ASC` 读取 `DocumentChunk`。
- 按 `EMBEDDING_BATCH_SIZE` 切分 batch，串行调用 `EmbeddingClient.embed()`。
- `EMBEDDING_BATCH_SIZE=20` 时，53 个 chunk 的文档实际返回 `batchCount=3`。
- 可重试错误：超时、网络错误、429、500、502、503、504。
- 不重试错误：400/401/403/404/其他 4xx、非 JSON、响应结构错误、index 不连续、数量或维度校验失败。
- 重试次数语义为“初始请求 + `EMBEDDING_MAX_RETRIES` 次重试”。
- 退避为 `1000ms * 2^attempt`，最大 30000ms，附加 0-500ms jitter；429 可使用 `Retry-After`。

## 5. 维度、数量和顺序校验

- 客户端先按响应 `data[].index` 排序，并要求 index 从 0 连续。
- 服务按 batch 校验 `vectors.length === batch.length`。
- 服务校验每个向量长度等于 `EMBEDDING_DIMENSION`。
- 服务校验向量值均为 finite number。
- 校验失败时文档置 `failed`，error message 截断到 300 字符。

## 6. 状态与并发处理

状态流转：

- 执行开始：更新 `document.status='embedding'`，清空 `errorMessage`。
- 成功：保持 `embedding`，表示“已向量化，待 T08 写入 Qdrant”。
- 失败：更新 `status='failed'`，写 `errorMessage`。
- `completed`：拒绝重复嵌入，状态保持不变。

幂等和重试：

- T07 不生成、不删除、不改写 `document_chunk`。
- 失败后保留既有 chunk；再次执行会重新读取 chunk 并重新向量化。
- 因不持久化 vector，重复执行不会产生重复向量数据。

并发控制：

- 同进程用 `Map<number, Promise<EmbeddingResult>>` 缓存同一 document 的 in-flight 执行。
- 同一文档并发调用会复用当前执行，避免重复请求模型服务。

## 7. 内存结果给 T08

`EmbeddingService.embedDocument()` 返回：

```ts
{
  documentId: number;
  totalChunks: number;
  vectorDimension: number;
  batchCount: number;
  chunks: Array<{
    chunkId: number;
    chunkIndex: number;
    qdrantPointId: string;
    content: string;
    charCount: number;
    pageNo: number | null;
    kbId: number;
    documentId: number;
    vector: number[];
  }>;
}
```

CLI 只输出摘要，不输出 vectors。

## 8. 实际执行的构建和测试

构建：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |

测试环境：

- Docker daemon 无法启动。
- 本机 `localhost:3306` MySQL 使用 `.env` 的 `root/root123` 认证失败。
- 临时使用本机 MySQL 8 程序初始化 `tmp-t07-mysql`，监听 `127.0.0.1:3307`。
- `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:run` 通过，执行 2 条历史 migration。
- 验收后临时 MySQL、后端进程、临时文件、上传残留已清理。

样例数据和成功路径：

| 样例 | parse/chunk | embed 结果 |
|---|---|---|
| `short.txt` | 1 页，1 chunk | `{"documentId":1,"chunkCount":1,"vectorDimension":1024,"batchCount":1}` |
| `long-cn.txt` | 1 页，8 chunks | `{"documentId":2,"chunkCount":8,"vectorDimension":1024,"batchCount":1}` |
| `sample.md` | 1 页，1 chunk | `{"documentId":3,"chunkCount":1,"vectorDimension":1024,"batchCount":1}` |
| `two-pages.pdf` | 2 页，2 chunks | `{"documentId":5,"chunkCount":2,"vectorDimension":1024,"batchCount":1}` |
| `batch-long.txt` | 1 页，53 chunks | `{"documentId":6,"chunkCount":53,"vectorDimension":1024,"batchCount":3}` |

数据库核对：

- 成功文档最终状态均为 `embedding`，`error_message=NULL`。
- `two-pages.pdf` 的两条 chunk 分别为 `page_no=1`、`page_no=2`。
- `document_chunk` 聚合结果：`documentId=1 -> 1`、`2 -> 8`、`3 -> 1`、`5 -> 2`、`6 -> 53`。
- 每个文档 `MIN(chunk_index)=0`，`MAX(chunk_index)=COUNT(*)-1`。
- `COUNT(DISTINCT qdrant_point_id)=COUNT(*)`。
- `document_chunk` 无 vector 列。
- `SHOW TABLES` 仍只有原 6 张业务表加 `migrations`。

错误、重试和并发：

- 未切片 `blank.txt` 执行 `embed:document` 失败，文档置 `failed`，chunk 行数为 0。
- `completed` 文档执行 `embed:document` 被拒绝，状态保持 `completed`。
- 受控 HTTP 服务返回 3 维向量，文档失败为 `Embedding 维度不一致：index=0，expected=1024，actual=3`，chunk 保留 8 行；随后 mock 重试成功回到 `embedding`。
- 受控 HTTP 服务首个请求返回 500，客户端重试一次；对 53 chunk 文档并发调用两次，实际 HTTP 请求数为 4，说明同文档并发已去重。
- 同一受控 HTTP 服务逆序返回响应，服务结果前两个 chunk 的向量起始值为 `0`、`1`，确认按 index 排序。
- 超时测试：HTTP 服务延迟 1500ms、client timeout 1000ms，得到 `Embedding API 请求超时（1000ms）`。
- Mock 测试：空输入返回 0；同文本两次向量一致；维度 1024；L2 norm 为 1。

范围扫描：

- T07 新代码 `rg "\bany\b"` 无命中。
- T07 新代码及接线范围扫描未命中 Qdrant、检索、LLM、Chat、SSE、Rerank 实现。

## 9. 未完成项与已知问题

- 未执行真实外部 Embedding API 调用；当前缺少真实 API key，本次使用 Mock 和本地受控 HTTP 服务验收。
- T07 不持久化 vector，进程结束后内存结果不会保留；这是 T08 前的设计边界。
- T07 未实现启动恢复钩子；`embedding` 状态文档可通过再次执行 CLI 重试。
- Docker daemon 本次无法启动，默认 3306 也无法用 `.env` 认证；后续本地验收仍需先解决 DB 连接冲突或继续使用临时 3307。

## 10. 越界实现检查

不存在以下越界实现：

- Qdrant 写入
- 向量持久化
- 向量检索
- LLM
- Chat
- SSE
- 前端页面
- Rerank
- 新数据库表或 migration

## 11. 是否具备进入 T08 的条件

具备。

T07 已能从 `document_chunk` 读取切片，按配置批量生成并校验向量，把 T08 需要的 `chunkId`、`qdrantPointId`、`vector` 以内存结构返回。状态、失败重试和同文档并发控制已验证，且没有提前写入 Qdrant 或持久化向量。
