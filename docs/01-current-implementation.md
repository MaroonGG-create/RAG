# Mini RAG 当前实现快照

> 快照日期：2026-07-30（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 基准提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）
> 当前阶段：T07 Embedding 服务完成后
> 详细验收：`docs/reports/task-07-completion.md`

## 1. 当前结论

- T01/T02 工程骨架、Docker Compose、MySQL/Qdrant 基础设施、TypeORM 实体、统一响应和异常处理继续存在。
- T03 知识库 CRUD 可用。
- T04 文档上传、列表、详情、删除接口可用。
- T05 文档解析可用，解析结果仍通过 `server/uploads/.parsed/{documentId}.json` 暂存传递给后续流程。
- T06 已实现文本基础清洗、PDF/Markdown/TXT 统一切片、PDF 页码保留、`DocumentChunk` 批量写入、`document.chunkCount` 更新、切片幂等和失败清理。
- T07 已实现 Embedding 配置、OpenAI 兼容客户端、确定性 Mock 模式、批量向量化、超时/重试、返回数量/顺序/维度校验、状态流转、失败重试和同文档并发控制。
- T07 成功后文档状态停留在 `embedding`，语义为“已向量化，待 T08 写入 Qdrant”。
- T07 只把 `{chunkId, chunkIndex, qdrantPointId, content, charCount, pageNo, kbId, documentId, vector}` 作为内存结果返回，不持久化 vector。
- 本阶段没有新增公开 HTTP 路由，没有新增数据库表或 migration，没有实现 Qdrant 写入、向量检索、LLM、Chat、SSE、Rerank 或前端页面。

本次 T07 验收时 Docker daemon 无法启动，本机 `localhost:3306` 的 MySQL 又拒绝 `.env` 中的 `root/root123`。为完成 DB 验收，临时使用本机 MySQL 程序初始化了工作区内的 `tmp-t07-mysql`，监听 `127.0.0.1:3307`；验收后已停止并清理。

## 2. 当前模块

后端业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`

当前新增的 Embedding 结构：

```text
server/src/modules/embedding/
├── embedding-client.ts
├── embedding.module.ts
├── embedding.service.ts
└── embedding.types.ts

server/src/scripts/
├── parse-document.ts
├── chunk-document.ts
└── embed-document.ts
```

`EmbeddingModule` 通过 `AppModule` 接入，仅导出 `EmbeddingService`。它读取既有 `Document` / `DocumentChunk`，不改 T05/T06 解析和切片逻辑。

## 3. 当前接口和 CLI

HTTP 接口仍为既有 T04/T06 契约，T07 不新增 Embedding HTTP 触发接口。

内部 CLI：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
```

`embed:document` 成功时 stdout 只输出摘要 JSON，不输出文本或向量：

```json
{"documentId":6,"chunkCount":53,"vectorDimension":1024,"batchCount":3}
```

失败时 stderr 输出：

```text
向量化失败：<中文错误摘要>
```

## 4. 配置

T06 切片配置保持不变：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `CHUNK_SIZE` | 500 | 整数，100-10000 |
| `CHUNK_OVERLAP` | 100 | 整数，0-9999，且必须小于 `CHUNK_SIZE` |

T07 新增 Embedding 配置：

| 环境变量 | 实际默认/样例 | 校验 |
|---|---:|---|
| `EMBEDDING_BASE_URL` | `https://api.openai.com/v1` | 非空字符串 |
| `EMBEDDING_API_KEY` | `.env.example` 为占位值；本地验收为 `sk-mock-key` | 非空字符串 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 非空字符串 |
| `EMBEDDING_DIMENSION` | 1024 | 整数，1-8192 |
| `EMBEDDING_BATCH_SIZE` | 20 | 整数，1-100 |
| `EMBEDDING_TIMEOUT_MS` | 30000 | 整数，1000-300000 |
| `EMBEDDING_MAX_RETRIES` | 3 | 整数，0-10 |
| `EMBEDDING_MOCK` | false；本地验收设为 true | 可选布尔值 |

`configuration.ts` 暴露：

```ts
embedding: {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
  batchSize: number;
  timeoutMs: number;
  maxRetries: number;
  mock: boolean;
}
```

## 5. Embedding 客户端

- `EmbeddingClient.embed(texts)` 接收字符串数组；空数组直接返回 `[]`。
- `EMBEDDING_MOCK=true` 时不发 HTTP 请求，使用 `sha256(text)` 生成确定性向量，维度等于 `EMBEDDING_DIMENSION`，数值映射到 `[-1, 1]` 后做 L2 归一化。
- 非 Mock 模式使用 Node 20 内置 `fetch`，POST 到 `{EMBEDDING_BASE_URL}/embeddings`。
- 请求体为 `{ model, input: texts }`，认证为 `Authorization: Bearer <apiKey>`。
- 使用 `AbortController` 实现超时。
- 可重试错误：超时、网络错误、429、500、502、503、504。
- 不重试错误：400、401、403、404、其他 4xx、非 JSON 响应、响应结构不兼容、index 不连续、数量/维度校验失败。
- 重试策略：初始请求 + `EMBEDDING_MAX_RETRIES` 次重试，指数退避 `1000ms * 2^attempt`，最大 30000ms，附加 0-500ms jitter；429 支持 `Retry-After` 秒数。
- 客户端会按响应 `data[].index` 排序，并校验 index 从 0 连续。
- 日志不打印 API key、请求文本、响应正文或向量内容。

## 6. Embedding 服务

- `EmbeddingService.embedDocument(documentId)` 先查 `Document`，不存在抛 `NotFoundException('文档不存在')`。
- `completed` 文档直接拒绝：`文档已完成向量化，禁止重复嵌入`，且不改状态。
- 其他状态进入执行后先更新为 `embedding` 并清空 `errorMessage`。
- 按 `chunkIndex ASC` 读取既有 `DocumentChunk`；无 chunk 时失败：`文档尚未切片或切片为空，请先执行 pnpm --filter server chunk:document <id>`。
- 按 `EMBEDDING_BATCH_SIZE` 串行分批调用 `EmbeddingClient.embed()`。
- 每批校验返回向量数量等于 batch 长度、每条维度等于 `EMBEDDING_DIMENSION`、数值均为 finite number。
- 成功后返回内存 `EmbeddingResult`，包含每个 chunk 的 `chunkId`、`qdrantPointId` 和 `vector`，但不写入数据库。
- 成功后状态保持 `embedding`，`document.chunkCount` 不改。
- 失败时将文档置为 `failed`，写入最多 300 字符 `errorMessage`，不删除、不修改 `document_chunk`。
- 同进程同文档并发通过 `Map<number, Promise<EmbeddingResult>>` 复用 in-flight 执行，避免重复调用模型服务。

## 7. T06 清洗和切片保持现状

- `cleanText()` 仍只做换行统一、零宽字符删除、3 个以上连续换行压缩为 2 个、首尾 `trim()`。
- PDF 按页独立清洗和切片，不跨页合并，不跨页 overlap。
- Markdown/TXT 由 T05 的单段 `pageNo=null` 透传。
- `chunkIndex` 在文档内从 0 全局连续递增。
- `charCount = content.length`。
- `qdrantPointId` 使用 Node.js `crypto.randomUUID()` 生成。

## 8. 已验证结果

构建和类型检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:run` | 通过，在临时 MySQL 执行 2 条历史 migration |

T07 样例数据：

| 文档 | 结果 |
|---|---|
| `short.txt` | 解析 1 页，切片 1 条，Embedding 输出 `chunkCount=1, vectorDimension=1024, batchCount=1` |
| `long-cn.txt` | 解析 1 页，切片 8 条，Embedding 输出 `chunkCount=8, vectorDimension=1024, batchCount=1` |
| `sample.md` | 解析 1 页，切片 1 条，Embedding 输出 `chunkCount=1, vectorDimension=1024, batchCount=1` |
| `two-pages.pdf` | 解析 2 页，切片 2 条，DB 查询 `pageNo=1,2`，Embedding 输出 `chunkCount=2, vectorDimension=1024, batchCount=1` |
| `batch-long.txt` | 解析 1 页，切片 53 条，默认 batch size 20 下 Embedding 输出 `chunkCount=53, vectorDimension=1024, batchCount=3` |

数据库查询确认：

- `document` 最终状态：成功文档均为 `embedding`，`error_message=NULL`；未切片 `blank.txt` 为 `failed`。
- `document_chunk` 聚合：`short=1`、`long-cn=8`、`sample.md=1`、`two-pages.pdf=2`、`batch-long=53`。
- `chunkIndex` 均从 0 连续到 `chunkRows - 1`。
- `COUNT(DISTINCT qdrant_point_id)` 等于 chunk 行数。
- `document_chunk` 仍只有 T06 字段，没有 vector 列。
- `SHOW TABLES` 仍只有 `conversation`、`document`、`document_chunk`、`knowledge_base`、`message`、`message_reference`、`migrations`。

错误和重试：

- 未切片 `blank.txt` 执行 `embed:document` 失败，文档置 `failed`，`chunk_rows=0`。
- 手动将 `sample.md` 置为 `completed` 后执行 `embed:document` 被拒绝，状态保持 `completed`，随后测试脚本恢复为 `embedding`。
- 受控 HTTP 服务返回 3 维向量，`long-cn.txt` 失败为 `Embedding 维度不一致：index=0，expected=1024，actual=3`，chunk 保留 8 行；随后 mock 重试成功回到 `embedding`。
- 受控 HTTP 服务首个请求返回 500，客户端执行 1 次重试；对 53 chunk 文档并发调用两次，实际 HTTP 请求数为 4（首批失败一次 + 3 个成功批次），两次调用均返回 53 个内存向量。
- 受控 HTTP 服务逆序返回 `data[]`，客户端按 index 排序后，前两个 chunk 的向量起始值为 `0`、`1`。
- 受控 HTTP 服务延迟 1500ms、客户端 timeout 1000ms 时，返回 `Embedding API 请求超时（1000ms）`。
- Mock 客户端验证：空数组返回长度 0；同文本两次向量完全一致；维度 1024；L2 norm 为 1。

范围扫描：

- `rg "\bany\b" server/src/modules/embedding server/src/scripts/embed-document.ts server/src/config`：无命中。
- `rg "QdrantClient|@qdrant|upsert|search\(|createCollection|vector-store|chat/stream|text/event-stream|EventSource|rerank|Rerank|LLM|Chat" server/src/modules/embedding server/src/scripts/embed-document.ts server/src/app.module.ts server/package.json`：无命中。
- 真实外部 Embedding API 未执行；本次实际模型调用验收使用 `EMBEDDING_MOCK=true` 和本地受控 HTTP 服务。

清理：

- 临时后端进程、临时 MySQL 3307 已停止。
- `tmp-t07-files`、`tmp-t07-mysql`、临时日志已删除。
- 本次上传残留 `server/uploads/1` 与 `.parsed/1,2,3,5,6.json` 已删除。

## 9. 当前未实现范围

以下仍属于后续任务：

- Qdrant collection/upsert/search/delete
- 向量持久化
- 向量检索
- LLM / Chat / SSE
- Rerank
- 上传后自动触发完整流水线
- 后台队列、定时任务、启动恢复钩子
- 前端知识库/文档/对话页面
- OCR / 图片型 PDF 支持
- 文件下载、预览、批量上传

## 10. 已知问题

1. Docker daemon 本次无法启动；默认 `localhost:3306` 仍会打到宿主机 MySQL，且 `root/root123` 认证失败。T07 验收使用临时 MySQL 3307 完成。
2. 未执行真实外部 Embedding API 调用；缺少真实 API key 时仅用 Mock 和本地受控 HTTP 服务验收。
3. T07 没有启动恢复钩子；进程重启后的 `embedding` 状态文档可通过再次执行 `embed:document` 重试。
4. T07 不保存向量，因此服务重启后内存向量结果不会保留；这是 T08 前的设计边界。
5. T06 生成 PDF 样例时 pdf.js 对部分字体会输出标准字体 warning，不影响本次两页页码和 embedding 验收。
6. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。

## 11. 进入 T08 条件

代码层面具备进入 T08 条件：

- 成功向量化文档稳定停留在 `status='embedding'`。
- `EmbeddingResult` 已按 `chunkIndex ASC` 提供 T08 需要的 `chunkId`、`qdrantPointId` 和 `vector`。
- 批处理、超时、重试、数量/顺序/维度校验已覆盖。
- 失败不会删除或重复生成 chunk，重试复用既有 `document_chunk`。
- 同进程同文档并发不会重复调用模型服务。
- 未新增 schema/migration，也没有提前实现 Qdrant 写入、检索、LLM、Chat、SSE 或前端。
