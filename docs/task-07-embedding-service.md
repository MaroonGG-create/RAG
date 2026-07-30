# T07 Embedding 服务 — Codex 执行指令

> 任务编号：T07（阶段 P6 前半：Embedding 向量化）
> 前置条件：T06 已完成（结论：**通过**，见 `docs/reports/task-06-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.5 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T06 后快照）+ `docs/reports/task-06-completion.md`（T06 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T06 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**。status 枚举已含 `embedding`/`completed`/`failed`；`chunkCount` 已就绪 |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | 直接复用，**禁止修改**。字段齐备：`id`/`documentId`/`kbId`/`chunkIndex`/`content`/`charCount`/`pageNo`/`qdrantPointId` |
| `ProcessingModule` | `src/modules/processing/processing.module.ts` | **不修改**。T07 新建独立 `EmbeddingModule`，不侵入 processing 模块 |
| `ChunkingService` | `src/modules/processing/chunking/chunking.service.ts` | **不修改、不调用**。T07 不触发切片；若 `status='chunking' AND chunkCount=0` 则直接失败 |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `embedding` 配置段（§四） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：追加 Embedding 环境变量校验（§四） |
| `AppModule` | `src/app.module.ts` | **允许修改**：imports 追加 `EmbeddingModule` |
| migration 体系 | 2 条既有 migration | **本任务零 migration、零 schema 变更** |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | **不修改**（手动触发走 CLI） |
| Node.js 20 内置 `fetch` | 全局可用，无需 import | 用于调用 OpenAI 兼容 Embedding API，**零新增依赖** |
| Node.js 20 内置 `AbortController` | 全局可用 | 用于请求超时控制 |
| Node.js 20 内置 `crypto` | `node:crypto` | Mock 模式下用 `createHash('sha256')` 生成确定性向量 |
| CLI 脚本模式 | `src/scripts/parse-document.ts` / `chunk-document.ts` | T07 CLI 遵循同一模式：`NestFactory.createApplicationContext` + 服务调用 + JSON stdout |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T06 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05/T06），否则 Embedding 读写 DB 与验收 SQL 都会打到错误实例。
2. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。
3. `parsing` / `embedding` 崩溃残留仍需启动恢复机制处理；T07 只覆盖 `embedding` 状态的首次触发和失败重试。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `embedding` 模块，读取已切片文档的 `DocumentChunk`，调用 OpenAI 兼容 Embedding API 完成批量向量化：

- **读取切片**：按 `documentId` 读取全部 `DocumentChunk`，按 `chunkIndex` 升序排列；
- **批量向量化**：按 `EMBEDDING_BATCH_SIZE` 分批调用 Embedding API；
- **请求超时、限流和失败重试**：指数退避策略，可配重试次数；
- **向量校验**：返回向量数量、顺序和维度一致性校验；
- **状态流转**：`chunking → embedding →（成功留 embedding / 失败 failed + errorMessage）`；
- **失败重试**：`failed` 状态允许重试；
- **并发控制**：同一文档并发执行用 in-flight Map 去重（同 T05/T06 模式）；
- **内存结果返回**：`embedDocument(documentId)` 返回 `EmbeddingResult`（含 `chunkId`/`qdrantPointId`/`vector`），交给 T08；
- **不持久化向量**：向量仅存在于内存，不写入 MySQL、不写入文件；
- **Mock 模式**：`EMBEDDING_MOCK=true` 时用确定性伪向量替代 API 调用，支持无 API 环境下的完整验收；
- **手动触发**：CLI 脚本 `pnpm --filter server embed:document <id>`；
- **日志和异常处理**；
- **API Key 安全**：不记录 API Key、不将完整响应写入 errorMessage。

### 2.2 非目标（本阶段一律不做）

Qdrant 客户端（含 collection 创建/upsert/search/delete）、向量写入数据库或文件、向量检索、`status=completed`（T08 负责）、LLM、Chat、SSE、Rerank、前端页面、消息队列、定时任务、上传后自动触发流水线、启动恢复钩子、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `openai` SDK、引入 `axios`、引入 `langchain`、引入测试框架（T16 统一补）。

**禁止模拟处理**：不允许假向量结果（Mock 模式除外，Mock 须显式开启）、不允许跳过切片读取。

---

## 三、模块与文件设计

### 3.1 新增文件（server/，5 个）

| 文件 | 职责 |
|---|---|
| `src/modules/embedding/embedding.module.ts` | NestJS 模块：`TypeOrmModule.forFeature([Document, DocumentChunk])`，providers 注册 `EmbeddingClient` + `EmbeddingService`，exports 导出 `EmbeddingService` |
| `src/modules/embedding/embedding-client.ts` | 纯 HTTP 客户端：`embed(texts: string[]): Promise<number[][]>`；封装 fetch + AbortController 超时 + 指数退避重试 + Mock 分支；**不依赖任何 DB Repository**，仅依赖 `ConfigService` |
| `src/modules/embedding/embedding.service.ts` | 编排服务：`embedDocument(documentId): Promise<EmbeddingResult>`；状态流转、读切片、分批调用 client、向量校验、in-flight 去重、失败处理 |
| `src/modules/embedding/embedding.types.ts` | 类型定义：`EmbeddingRequest`/`EmbeddingResponse`/`EmbeddedChunk`/`EmbeddingResult`/`EmbeddingFailure` |
| `src/scripts/embed-document.ts` | CLI 手动触发（§十三） |

### 3.2 修改文件（server/ 4 个 + 根 2 个 + docs 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/config/configuration.ts` | 追加 `embedding` 配置段（§四） |
| `src/config/env.validation.ts` | 追加 Embedding 环境变量校验（§四） |
| `src/app.module.ts` | imports 追加 `EmbeddingModule` |
| `server/package.json` | scripts 加 `"embed:document": "ts-node src/scripts/embed-document.ts"` |
| `.env.example` | 追加 Embedding 环境变量（§四） |
| `docs/00-overall-plan.md` | §十五 v1.6 回填（§十五） |

**禁止改动**：`web/` 任何文件、全部实体定义、既有 migration、main.ts、过滤器、`docker-compose.yml`、knowledge-base 模块、document 模块、processing 模块下任何文件、parsing/chunking 子目录下任何文件。

> 规模判断：一个 HTTP 客户端 + 一个编排服务 + 一个类型文件即可，**不建** embedding registry / strategy pattern / provider factory——一个 API 端点不值得一层抽象（与 T05/T06「不过度细分」一致）。

---

## 四、配置和环境变量（冻结级）

### 4.1 环境变量清单

| 变量 | 默认值 | 校验 | 说明 |
|---|---:|---|---|
| `EMBEDDING_BASE_URL` | 无（必填） | `@IsString @IsNotEmpty` | OpenAI 兼容 API base URL，如 `https://api.openai.com/v1`；Mock 模式下不使用但仍须提供 |
| `EMBEDDING_API_KEY` | 无（必填） | `@IsString @IsNotEmpty` | API Key；Mock 模式下不使用但仍须提供 |
| `EMBEDDING_MODEL` | 无（必填） | `@IsString @IsNotEmpty` | 模型名，如 `text-embedding-3-small` |
| `EMBEDDING_DIMENSION` | 1024 | `@IsInt @Min(1) @Max(8192)` | 向量维度，必须与模型实际输出一致 |
| `EMBEDDING_BATCH_SIZE` | 20 | `@IsInt @Min(1) @Max(100)` | 每批切片数 |
| `EMBEDDING_TIMEOUT_MS` | 30000 | `@IsInt @Min(1000) @Max(300000)` | 单次请求超时（毫秒） |
| `EMBEDDING_MAX_RETRIES` | 3 | `@IsInt @Min(0) @Max(10)` | 最大重试次数（0 = 不重试） |
| `EMBEDDING_MOCK` | false | `@IsBoolean`（可选） | Mock 模式开关；true 时跳过 HTTP 调用，生成确定性伪向量 |

### 4.2 configuration.ts 追加

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
};
```

读取逻辑：

```ts
embedding: {
  baseUrl: process.env.EMBEDDING_BASE_URL ?? '',
  apiKey: process.env.EMBEDDING_API_KEY ?? '',
  model: process.env.EMBEDDING_MODEL ?? '',
  dimension: Number(process.env.EMBEDDING_DIMENSION ?? 1024),
  batchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 20),
  timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? 30000),
  maxRetries: Number(process.env.EMBEDDING_MAX_RETRIES ?? 3),
  mock: process.env.EMBEDDING_MOCK === 'true',
},
```

并在 `AppConfiguration` 接口追加对应类型。

### 4.3 env.validation.ts 追加

```ts
@IsDefined()
@IsString()
@IsNotEmpty()
EMBEDDING_BASE_URL!: string;

@IsDefined()
@IsString()
@IsNotEmpty()
EMBEDDING_API_KEY!: string;

@IsDefined()
@IsString()
@IsNotEmpty()
EMBEDDING_MODEL!: string;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(8192)
EMBEDDING_DIMENSION!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(100)
EMBEDDING_BATCH_SIZE!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1000)
@Max(300000)
EMBEDDING_TIMEOUT_MS!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(10)
EMBEDDING_MAX_RETRIES!: number;

// 可选布尔，不强制 @IsDefined
@Type(() => Boolean)
@IsBoolean()
EMBEDDING_MOCK?: boolean;
```

### 4.4 .env.example 追加

```env
# Embedding（OpenAI 兼容）
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=sk-your-api-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1024
EMBEDDING_BATCH_SIZE=20
EMBEDDING_TIMEOUT_MS=30000
EMBEDDING_MAX_RETRIES=3
EMBEDDING_MOCK=false
```

---

## 五、Embedding 请求与响应类型（冻结级，设计问题 1）

### 5.1 OpenAI 兼容 Embedding API 请求格式

```
POST {EMBEDDING_BASE_URL}/embeddings
Authorization: Bearer {EMBEDDING_API_KEY}
Content-Type: application/json

{
  "model": "text-embedding-3-small",
  "input": ["chunk text 1", "chunk text 2", ...]
}
```

- `input` 为字符串数组，长度 = 本批 `batchSize`（最后一批可能更短）；
- `model` 从配置读取；
- 不传 `dimensions` 参数（由模型本身决定维度，配置中的 `EMBEDDING_DIMENSION` 用于校验）；
- 不传 `encoding_format`（默认 `float`，JSON 数组）。

### 5.2 OpenAI 兼容 Embedding API 响应格式

```json
{
  "data": [
    { "embedding": [0.1, 0.2, ...], "index": 0 },
    { "embedding": [0.3, 0.4, ...], "index": 1 }
  ],
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 123, "total_tokens": 123 }
}
```

### 5.3 TypeScript 类型（embedding.types.ts）

```ts
/** Embedding API 请求体 */
interface EmbeddingApiRequest {
  model: string;
  input: string[];
}

/** Embedding API 响应体中的单个条目 */
interface EmbeddingApiItem {
  embedding: number[];
  index: number;
}

/** Embedding API 响应体 */
interface EmbeddingApiResponse {
  data: EmbeddingApiItem[];
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/** 单个 chunk 的向量化结果（内存对象，交给 T08） */
interface EmbeddedChunk {
  chunkId: number;          // document_chunk.id
  chunkIndex: number;       // document_chunk.chunkIndex
  qdrantPointId: string;    // document_chunk.qdrantPointId（Qdrant point id）
  content: string;          // document_chunk.content（Qdrant payload 用）
  charCount: number;        // document_chunk.charCount
  pageNo: number | null;    // document_chunk.pageNo（Qdrant payload 用）
  kbId: number;             // document_chunk.kbId（Qdrant payload 用）
  documentId: number;       // document_chunk.documentId（Qdrant payload 用）
  vector: number[];         // Embedding 向量
}

/** embedDocument 返回值 */
interface EmbeddingResult {
  documentId: number;
  chunks: EmbeddedChunk[];
  totalChunks: number;
  vectorDimension: number;
  batchCount: number;
}

/** Embedding 失败错误 */
class EmbeddingFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingFailure';
  }
}
```

---

## 六、SDK 选择：fetch 手写客户端（冻结级，设计问题 2）

### 6.1 决策：使用 Node.js 20 内置 `fetch` + `AbortController`，不引入任何 SDK

**否决方案与理由**：

| 方案 | 否决理由 |
|---|---|
| `openai` SDK（v4+） | 引入大量传递依赖（`@anthropic-ai/sdk` peer deps、node-fetch 兼容层等）；Embedding API 只有一个端点，SDK 的重试/流式/工具调用能力对本任务冗余；与项目「不用 LangChain、手写可逐行讲解」的理念冲突 |
| `axios` | 需新增依赖；Node 20 已有原生 `fetch`，功能等价；`axios` 的拦截器机制对单端点调用过度设计 |

**选择 `fetch` 的理由**：

1. **零新增依赖**：Node 20 LTS 内置全局 `fetch`（稳定可用）和 `AbortController`（超时控制），与 T05 用 `crypto.randomUUID`、T06 不引入 `uuid` 包的极简路线一致；
2. **面试可逐行讲清**：HTTP 请求、超时、重试逻辑全部在项目代码内，不隐藏在 SDK 内部；
3. **完全可控**：错误分类、重试策略、响应校验全部手写，精确匹配设计需求；
4. **Mock 友好**：在 `EmbeddingClient.embed()` 入口处加一个 `if (this.mockEnabled)` 分支即可切换，无需 mock HTTP 层。

### 6.2 EmbeddingClient 设计

```ts
@Injectable()
export class EmbeddingClient {
  constructor(
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    // 从 ConfigService 读取 embedding.baseUrl/apiKey/model/dimension/
    //       batchSize/timeoutMs/maxRetries/mock，存为私有只读属性
  }

  /**
   * 批量向量化：输入一组文本，返回对应向量数组。
   * - Mock 模式：生成确定性伪向量，不发起 HTTP 请求。
   * - 正常模式：POST /embeddings，含超时和指数退避重试。
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (this.mockEnabled) return this.mockEmbed(texts);
    return this.httpEmbed(texts);
  }

  private async httpEmbed(texts: string[]): Promise<number[][]> {
    // 1. 构造请求体 { model, input: texts }
    // 2. 循环 maxRetries+1 次：
    //    a. AbortController 设置 timeoutMs
    //    b. fetch(url, { method, headers, body, signal })
    //    c. 成功 → 解析响应 → 校验 → 返回
    //    d. 可重试错误 → 计算退避延迟 → sleep → 继续
    //    e. 不可重试错误 → 直接抛出
    // 3. 全部重试耗尽 → 抛 EmbeddingFailure
  }

  private async mockEmbed(texts: string[]): Promise<number[][]> {
    // 用 createHash('sha256')(text) 生成确定性向量（§十三）
  }
}
```

### 6.3 关键实现细节

- **URL 拼接**：`baseUrl` 末尾去掉可能的 `/`，拼接 `/embeddings`。如 `https://api.openai.com/v1` → `https://api.openai.com/v1/embeddings`。
- **请求头**：`Authorization: Bearer {apiKey}` + `Content-Type: application/json`。API Key 仅在请求头中使用，**不记录到日志**。
- **超时**：`const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);` 在 `finally` 中 `clearTimeout(timer)`。
- **JSON 解析**：`const json = await response.json() as EmbeddingApiResponse`；若 `response.json()` 抛错（非 JSON 响应），归为不可重试错误。

---

## 七、批处理流程（冻结级，设计问题 3）

### 7.1 批次划分

```
chunks = SELECT * FROM document_chunk WHERE document_id = ? ORDER BY chunk_index ASC
batches = chunkArray(chunks, batchSize)  // 按 chunkIndex 顺序切分
```

- **顺序保证**：按 `chunkIndex` 升序排列后分批，批次内顺序 = chunkIndex 顺序；
- **批次大小**：每批 `EMBEDDING_BATCH_SIZE` 条，最后一批可能不足；
- **串行执行**：批次之间**串行**处理（不并行），理由：
  1. 避免触发 API 限流（429）；
  2. 串行 + 重试 = 失败时只需重试当前批次，不影响已成功的批次；
  3. MVP 文档量级小（单文档几十到几百 chunks），串行延迟可接受。

### 7.2 批次处理流程

```
for (const [batchIndex, batch] of batches.entries()):
  texts = batch.map(chunk => chunk.content)
  vectors = await embeddingClient.embed(texts)  // 含重试
  // 校验（§九）
  assert vectors.length === batch.length
  for (const [i, chunk] of batch.entries()):
    assert vectors[i].length === dimension
    embeddedChunks.push({
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      qdrantPointId: chunk.qdrantPointId,
      content: chunk.content,
      charCount: chunk.charCount,
      pageNo: chunk.pageNo,
      kbId: chunk.kbId,
      documentId: chunk.documentId,
      vector: vectors[i],
    })
  logger.debug(`批次 ${batchIndex + 1}/${batches.length} 完成：${batch.length} 条`)
```

### 7.3 空内容处理

- `chunk.content` 经过 T06 清洗后保证非空（T06 对清洗后为空的文档直接置 `failed`），因此 T07 **不会遇到空 content**；
- 但仍做防御性检查：`if (texts.every(t => t.length === 0))` → 抛 `EmbeddingFailure('切片内容全部为空')`。

---

## 八、重试和异常策略（冻结级，设计问题 4 + 5）

### 8.1 指数退避重试

```
重试间隔 = min(baseDelay * 2^attempt, maxDelay) + jitter
  baseDelay = 1000ms
  maxDelay = 30000ms
  jitter = random(0, 500ms)
  attempt = 0, 1, ..., maxRetries-1
```

- `attempt=0`（第一次重试）：等待 1000–1500ms
- `attempt=1`（第二次重试）：等待 2000–2500ms
- `attempt=2`（第三次重试）：等待 4000–4500ms
- `maxRetries=3` 意味着最多发起 4 次请求（1 次初始 + 3 次重试）

### 8.2 错误分类与重试决策

| 错误类型 | HTTP 状态码 / 条件 | 是否重试 | 说明 |
|---|---|---|---|
| **请求超时** | `AbortError`（fetch abort） | ✅ 重试 | 网络波动或服务端响应慢 |
| **网络错误** | fetch 抛出非 AbortError | ✅ 重试 | DNS 解析失败、连接拒绝、TCP 重置等 |
| **限流** | HTTP 429 | ✅ 重试 | 尊重 `Retry-After` 响应头（如有），否则用指数退避 |
| **服务端错误** | HTTP 500 / 502 / 503 / 504 | ✅ 重试 | 服务端临时故障 |
| **请求错误** | HTTP 400 | ❌ 不重试 | 请求体格式错误（如 input 过长），重试无意义 |
| **认证错误** | HTTP 401 | ❌ 不重试 | API Key 无效，需人工介入 |
| **禁止访问** | HTTP 403 | ❌ 不重试 | Key 无权限或 IP 被封 |
| **未找到** | HTTP 404 | ❌ 不重试 | base URL 错误或模型名不存在 |
| **其他 4xx** | HTTP 4xx（非 429） | ❌ 不重试 | 客户端错误，重试无意义 |
| **响应非 JSON** | `response.json()` 抛错 | ❌ 不重试 | 可能是 HTML 错误页，非 API 响应 |
| **响应校验失败** | data.length 不匹配 / 维度不匹配 | ❌ 不重试 | 可能是 Provider 不兼容，需人工排查 |

### 8.3 429 Retry-After 处理

```ts
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter !== null) {
    const delaySeconds = Number(retryAfter);
    if (Number.isFinite(delaySeconds) && delaySeconds > 0) {
      await sleep(delaySeconds * 1000);
      continue;  // 不消耗重试计数（尊重服务端指示）
    }
  }
  // 无 Retry-After 头 → 使用指数退避
}
```

> **注意**：尊重 `Retry-After` 时不消耗重试计数，但总重试次数仍受 `maxRetries` 限制（防止无限等待）。实现时可简化为：有 `Retry-After` 就用它，没有就用指数退避，都消耗一次重试计数。MVP 选择后者以保持简单。

### 8.4 重试日志

每次重试在 `logger.warn` 级别记录：

```text
Embedding API 重试（{attempt}/{maxRetries}）：documentId={id}，batch={batchIndex}，原因={简要原因}，等待={delay}ms
```

**禁止记录**：API Key、完整请求体、完整响应体、切片内容。

### 8.5 最终失败处理

全部重试耗尽后抛出：

```ts
throw new EmbeddingFailure(
  `Embedding API 请求失败：${statusCode} ${statusText}（已重试 ${maxRetries} 次）`
);
```

---

## 九、向量数量与维度校验（冻结级，设计问题 6 + 7）

### 9.1 数量一致性校验

```ts
if (vectors.length !== texts.length) {
  throw new EmbeddingFailure(
    `向量数量不匹配：期望 ${texts.length}，实际 ${vectors.length}`
  );
}
```

- 逐批校验，不跨批累计；
- 数量不匹配不重试（属于 Provider 不兼容或响应损坏）。

### 9.2 顺序一致性校验

OpenAI 兼容 API 的 `data` 数组中每个条目含 `index` 字段。**部分 Provider 可能不保证顺序**，因此：

```ts
// 按 index 排序后取 embedding（防御性处理）
const sorted = [...response.data].sort((a, b) => a.index - b.index);
const vectors = sorted.map(item => item.embedding);
```

- 排序后 `data[i].index` 应等于 `i`（0-based 连续）；
- 若 `index` 有缺失或重复，抛 `EmbeddingFailure('Embedding 响应 index 不连续')`。

### 9.3 维度一致性校验（设计问题 7）

```ts
for (const [i, vector] of vectors.entries()) {
  if (vector.length !== this.dimension) {
    throw new EmbeddingFailure(
      `向量维度不匹配：期望 ${this.dimension}，实际 ${vector.length}（第 ${i} 条）`
    );
  }
}
```

- 逐条校验，发现不匹配立即失败；
- **不自动截断或填充**——维度不匹配说明 `EMBEDDING_DIMENSION` 配置错误或模型不匹配，须人工修正配置；
- 此错误不重试（配置问题，重试无意义）。

### 9.4 校验失败后的状态

向量校验失败属于不可重试错误，直接触发失败处理：
- Document status → `failed`
- errorMessage = 校验失败摘要（不含向量数据）
- 不影响已成功的批次（因为整个 `embedDocument` 是原子的——要么全部成功返回 `EmbeddingResult`，要么抛错置 `failed`）

---

## 十、API Key 和错误信息安全（冻结级，设计问题 8）

### 10.1 API Key 安全

| 规则 | 实现 |
|---|---|
| API Key 仅存于环境变量 | `process.env.EMBEDDING_API_KEY`，不硬编码 |
| API Key 仅出现在 HTTP 请求头 | `Authorization: Bearer {apiKey}`，不出现在 URL、请求体、日志 |
| 日志中脱敏 | 任何 `logger.*` 调用中不引用 `apiKey` 变量 |
| errorMessage 中脱敏 | 错误摘要不包含请求头、不包含完整 URL（base URL 可包含，但 API Key 不可） |
| Mock 模式下 API Key 不使用 | `EMBEDDING_MOCK=true` 时跳过 HTTP 调用，apiKey 变量虽读取但不使用 |

### 10.2 errorMessage 安全规则

**允许写入 `document.error_message` 的内容**：

- 中文错误摘要，≤ 300 字符；
- HTTP 状态码 + 状态文本（如 `429 Too Many Requests`）；
- 错误类型标签（如 `请求超时`、`限流`、`服务端错误`、`向量维度不匹配`）；
- 重试次数信息（如 `已重试 3 次`）。

**禁止写入 `document.error_message` 的内容**：

- API Key（任何形式）；
- 完整请求体（含切片内容）；
- 完整响应体（含向量数据）；
- 堆栈跟踪；
- 绝对文件路径。

### 10.3 errorMessage 摘要生成函数

```ts
private getFailureMessage(error: unknown): string {
  if (error instanceof EmbeddingFailure) {
    return error.message.slice(0, 300);
  }
  const message = error instanceof Error ? error.message : '未知错误';
  return message.slice(0, 300);
}
```

### 10.4 典型 errorMessage 示例

| 场景 | errorMessage |
|---|---|
| API 超时 | `Embedding API 请求超时（30000ms），已重试 3 次` |
| 429 限流 | `Embedding API 限流：429 Too Many Requests，已重试 3 次` |
| 401 认证失败 | `Embedding API 认证失败：401 Unauthorized` |
| 500 服务端错误 | `Embedding API 服务端错误：500 Internal Server Error，已重试 3 次` |
| 维度不匹配 | `向量维度不匹配：期望 1024，实际 768（第 0 条）` |
| 数量不匹配 | `向量数量不匹配：期望 20，实际 18` |
| 无切片 | `文档尚未切片或切片为空，请先执行 pnpm --filter server chunk:document <id>` |

---

## 十一、状态流转与并发控制（冻结级，设计问题 9）

### 11.1 状态机（本阶段仅允许这些边）

```
                   触发 embedDocument(id)
chunking  ─────────────────────► embedding ──成功──► embedding   （留在此状态，等待 T08 Qdrant 写入）
failed    ─────────────────────► embedding ──失败──► failed       （errorMessage=中文摘要）
embedding ─────────────────────► embedding           （重跑：重新计算向量，状态不变）
completed ─────────────────────► 拒绝                 （文档已完成向量化，禁止重复嵌入）
```

**成功留 `embedding` 的理由（写进代码注释与汇报）**：

- 总体方案 §4.1 ⑧ 规定 embed 阶段 status=`embedding`，⑨ 规定 upsert Qdrant 阶段仍为 `embedding`，⑩ 规定全部完成后 status=`completed`；
- T07 成功后 `embedding` 语义为「已向量化验证通过，待 T08 Qdrant 写入」，T08 据此 `WHERE status='embedding'` 拣选文档；
- T08 负责 `embedding → completed` 的状态流转。

**防御性拒绝**：触发时若 status 为 `completed`，抛 `EmbeddingFailure('文档已完成向量化，禁止重复嵌入')`——防止 T08 上线后被误调用。

**允许的状态**：`chunking`（首次）、`failed`（重试）、`embedding`（重跑）。

### 11.2 主流程（EmbeddingService.embedDocument）

```
1. in-flight 去重检查（§11.3）
2. docRepo.findOne({ id }) → null → throw NotFoundException('文档不存在')
3. status 防御性检查（§11.1）
4. docRepo.update(id, { status: 'embedding', errorMessage: null })
5. chunks = chunkRepo.find({ where: { documentId: id }, order: { chunkIndex: 'ASC' } })
     chunks.length === 0 → EmbeddingFailure('文档尚未切片或切片为空，请先执行 pnpm --filter server chunk:document <id>')
6. batches = chunkArray(chunks, batchSize)
7. embeddedChunks = []
   for (const [batchIndex, batch] of batches.entries()):
     texts = batch.map(c => c.content)
     vectors = await embeddingClient.embed(texts)  // 含重试 + 校验
     // 逐条校验（§九）
     for (const [i, chunk] of batch.entries()):
       embeddedChunks.push({ chunkId, chunkIndex, qdrantPointId, content,
                             charCount, pageNo, kbId, documentId, vector: vectors[i] })
8. logger.log 成功摘要
9. return { documentId, chunks: embeddedChunks, totalChunks, vectorDimension, batchCount }

任意步骤抛错：
   → docRepo.update(id, { status: 'failed', errorMessage: 摘要 })
   → 不需要清理 chunks（T06 的切片数据保持不变，T07 不修改 document_chunk 表）
   → 继续抛出（CLI 退出码 1）
```

**关键区别**：T05/T06 失败时需要清理半成品数据（删除 `.parsed` 文件或 `document_chunk` 行）。T07 **不需要清理任何数据**——向量仅存在于内存，失败时直接丢弃即可；`document_chunk` 中的切片数据保持不变。

### 11.3 并发控制（in-flight 去重）

```ts
private readonly inFlight = new Map<number, Promise<EmbeddingResult>>();

async embedDocument(documentId: number): Promise<EmbeddingResult> {
  const existing = this.inFlight.get(documentId);
  if (existing !== undefined) return existing;

  const task = this.executeEmbedDocument(documentId).finally(() => {
    this.inFlight.delete(documentId);
  });
  this.inFlight.set(documentId, task);
  return task;
}
```

- 同一 documentId 并发触发时复用同一 Promise（同 T05/T06 模式）；
- 不同 documentId 之间不做串行限制（手动触发量级小，不引入队列）。

### 11.4 幂等语义

| 场景 | 行为 |
|---|---|
| **首次嵌入**（status=chunking） | 正常嵌入，成功后 status=embedding |
| **重跑已验证**（status=embedding） | 重新计算向量并返回（向量未持久化，每次调用都重新计算）；status 不变 |
| **失败重试**（status=failed） | 重新嵌入，成功后 status=embedding |
| **禁止重入**（status=completed） | 抛 `EmbeddingFailure('文档已完成向量化，禁止重复嵌入')` |

**幂等的本质**：Embedding API 是无状态的（相同输入 → 相同输出），因此 `embedDocument()` 本身是幂等的——多次调用返回相同结果（Mock 模式下严格相同，真实 API 下向量值可能微小浮点差异但语义等价）。

---

## 十二、与 T08 的接口边界（冻结级，设计问题 10）

### 12.1 T07 内存结果如何交给 T08

**核心设计：`EmbeddingService.embedDocument(documentId)` 返回 `EmbeddingResult`，T08 直接调用此方法获取向量，在同一进程内传递。**

```
T08 Pipeline:
  1. embeddingResult = await embeddingService.embedDocument(documentId)
     // 内部：chunking → embedding，返回 EmbeddingResult（含向量）
  2. qdrantService.upsertBatch(embeddingResult.chunks)
     // 用 EmbeddedChunk.qdrantPointId 作为 point id
     // 用 EmbeddedChunk.vector 作为向量
     // 用 EmbeddedChunk 的其他字段组装 Qdrant payload
  3. docRepo.update(documentId, { status: 'completed' })
```

- **向量不落盘**：向量从 `embedDocument()` 返回后直接传入 T08 的 Qdrant 写入方法，全程在内存中流转；
- **不单独持久化**：不写文件、不写 MySQL、不写 Redis；
- **T08 重跑时重新嵌入**：如果 T08 失败后重试，会再次调用 `embedDocument()`，重新调用 API 获取向量——这是「不持久化向量」的代价，MVP 可接受（文档量级小，API 调用成本低）。

### 12.2 T08 拣选条件

```sql
SELECT id, kb_id, file_name FROM document
WHERE status = 'embedding';
```

T07 成功后 `status='embedding'`，T08 据此拣选。

### 12.3 T08 接管后的状态流转

```
embedding ──T08 开始──► embedding（不变，T07 已设置）
            ──T08 成功──► completed
            ──T08 失败──► failed
```

T07 的职责到 `embedding` 为止。T08 负责 `embedding → completed`。

### 12.4 EmbeddedChunk 字段与 Qdrant payload 映射

| EmbeddedChunk 字段 | Qdrant 用途 |
|---|---|
| `qdrantPointId` | Qdrant point id（直接使用） |
| `vector` | Qdrant 向量数据 |
| `kbId` | Qdrant payload `knowledgeBaseId` |
| `documentId` | Qdrant payload `documentId` |
| `chunkId` | Qdrant payload `chunkId` |
| `chunkIndex` | Qdrant payload `chunkIndex` |
| `pageNo` | Qdrant payload `pageNo` |
| `content` | Qdrant payload `content`（冗余存储，检索后直接组装上下文） |

---

## 十三、Mock Embedding 服务（冻结级，设计问题 11 + 12）

### 13.1 设计目标

在没有真实 Embedding API（或不想消耗 API 配额）时，通过 `EMBEDDING_MOCK=true` 开启 Mock 模式，生成确定性伪向量，使 T07 全流程可验收。

### 13.2 Mock 向量生成算法

```ts
import { createHash } from 'node:crypto';

private mockEmbed(texts: string[]): number[][] {
  return texts.map(text => this.generateMockVector(text));
}

private generateMockVector(text: string): number[] {
  // 1. SHA-256 哈希文本 → 32 字节
  const hash = createHash('sha256').update(text, 'utf8').digest();

  // 2. 循环使用哈希字节生成 dimension 个 float
  const vector: number[] = [];
  for (let i = 0; i < this.dimension; i++) {
    const byte = hash[i % hash.length];
    vector.push((byte / 127.5) - 1);  // 映射到 [-1, 1]
  }

  // 3. L2 归一化（与 Cosine 距离兼容）
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? vector.map(v => v / norm) : vector;
}
```

### 13.3 Mock 模式特性

| 特性 | 说明 |
|---|---|
| **确定性** | 相同文本 → 相同向量（SHA-256 决定性） |
| **维度正确** | 向量长度 = `EMBEDDING_DIMENSION` |
| **L2 归一化** | 向量模长 = 1，与 Cosine 距离兼容 |
| **无网络** | 不发起 HTTP 请求 |
| **零成本** | 不消耗 API 配额 |
| **日志标记** | Mock 模式下 logger 输出 `[MOCK]` 前缀 |

### 13.4 Mock 模式下的日志

```text
[MOCK] Embedding 批次 1/1 完成：8 条
[MOCK] 文档向量化成功：documentId=98，chunkCount=8，vectorDimension=1024，batchCount=1
```

### 13.5 Mock 模式的限制（写入已知问题）

- 伪向量无语义相似性——相同文本向量相同，但相近文本的向量不一定相近；
- Mock 模式仅用于 T07 流程验收，不能用于 T09+ 检索质量验收；
- 切换 Mock ↔ 真实 API 时维度须一致（`EMBEDDING_DIMENSION` 不变）。

### 13.6 模型服务不可用时的测试方式（设计问题 11）

| 场景 | 测试方式 |
|---|---|
| **无 API Key** | `EMBEDDING_MOCK=true`，提供 dummy 值给必填字段 |
| **API 不可达** | `EMBEDDING_MOCK=true`，跳过 HTTP |
| **API 限流** | Mock 模式不受限流影响 |
| **维度配置错误** | Mock 模式下向量维度 = `EMBEDDING_DIMENSION`，可测试维度校验逻辑 |
| **重试逻辑** | Mock 模式不触发重试（不发起 HTTP）；重试逻辑需将 `EMBEDDING_MOCK=false` 并指向可控的 mock HTTP 服务器（MVP 不实现，T16 测试阶段补） |
| **全流程验收** | Mock 模式可完成 T07 全部验收项（§十六），包括状态流转、并发、失败重试、向量校验 |

---

## 十四、手动触发设计（冻结级）

**选型：CLI 脚本，不新增公开 HTTP 接口。** 理由同 T05/T06：基线 §9 的 13 个接口为冻结级约定，本阶段无「触发嵌入」接口；T08 自动流水线复用同一 `EmbeddingService.embedDocument` 方法即可。

`src/scripts/embed-document.ts`：

```ts
// 用法：pnpm --filter server embed:document <documentId>
async function bootstrap(): Promise<void> {
  const documentId = parseDocumentId(process.argv[2]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(EmbeddingService).embedDocument(documentId);
    console.log(JSON.stringify({
      documentId: result.documentId,
      chunkCount: result.totalChunks,
      vectorDimension: result.vectorDimension,
      batchCount: result.batchCount,
    }));
  } catch (error: unknown) {
    console.error(`向量化失败：${error instanceof Error ? error.message : '未知错误'}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
```

`package.json` scripts 追加：`"embed:document": "ts-node src/scripts/embed-document.ts"`。

**CLI 输出说明**：

- 成功时 stdout 只输出摘要 JSON（不含向量数据——向量仅存在于内存，CLI 执行后即丢弃）；
- 失败时 stderr 输出中文错误摘要，退出码 1。

---

## 十五、基线回填（00-overall-plan.md v1.6，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 ⑧ 状态语义补充：T07 成功后 status **留在 embedding** | `embedding` 在 T07→T08 之间语义为「已向量化验证通过，待 Qdrant 写入」；T08 据此拣选 `status='embedding'` 的文档 |
| 2 | §12 Embedding 环境变量**在 T07 实现** | 总体方案 §12 已列出 `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSION`/`EMBEDDING_BATCH_SIZE`；T07 补充 `EMBEDDING_TIMEOUT_MS`/`EMBEDDING_MAX_RETRIES`/`EMBEDDING_MOCK` |
| 3 | §15 风险 7 更新：Embedding 分批 + 指数退避重试 **已在 T07 实现** | T07 实现了分批调用、指数退避重试（可配次数）、429 Retry-After 处理、超时控制 |
| 4 | §15 风险 5 更新：`embedding` 崩溃残留由 T07 失败重试覆盖 | T07 支持从 `embedding`/`failed` 状态重触发；`completed` 防御性拒绝；`parsing` 崩溃残留仍需后续处理 |
| 5 | §7 模块划分补充：`embedding` 模块**在 T07 创建** | 新增 `EmbeddingModule`（`src/modules/embedding/`），含 `EmbeddingClient`（纯 HTTP 客户端）和 `EmbeddingService`（编排服务）；`processing` 模块不修改 |

---

## 十六、验收方式（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功（DB 端口冲突须先解决）。
> **Mock 模式验收**：以下全部验收命令在 `EMBEDDING_MOCK=true` 下执行，无需真实 API。
> **编码注意**：含中文断言用 Node 脚本读 JSON 比对，不在 PS 管道直接 grep 中文。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → T05 解析 → T06 切片
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t07-embed-kb\"}"
# 上传 PDF、MD、TXT，记录各 ID
pnpm --filter server parse:document <PDF_ID>
pnpm --filter server parse:document <MD_ID>
pnpm --filter server parse:document <TXT_ID>
pnpm --filter server chunk:document <PDF_ID>
pnpm --filter server chunk:document <MD_ID>
pnpm --filter server chunk:document <TXT_ID>
# 确认 status=chunking, chunk_count>0

# 2. Mock 模式向量化成功（三种格式）
$env:EMBEDDING_MOCK='true'
pnpm --filter server embed:document <PDF_ID>
# 预期：退出码 0；stdout JSON 含 chunkCount>0, vectorDimension=1024, batchCount>=1
pnpm --filter server embed:document <MD_ID>
pnpm --filter server embed:document <TXT_ID>

# 3. 状态断言
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,file_ext,status,error_message FROM document;"
# 预期：成功三件 status=embedding, error_message=NULL

# 4. 向量校验（用 Node 脚本断言 EmbeddingResult 结构）
# 由于 CLI 只输出摘要，向量校验需通过以下方式确认：
#   a. 确认 vectorDimension === EMBEDDING_DIMENSION（1024）
#   b. 确认 chunkCount === document.chunk_count
#   c. 确认 batchCount === Math.ceil(chunkCount / EMBEDDING_BATCH_SIZE)
#   d. Mock 模式下相同文档重跑结果一致（deterministic）

# 5. 幂等：重复触发已向量化文档
pnpm --filter server embed:document <PDF_ID>
# 预期：退出码 0；status 仍为 embedding；chunkCount 不变
# Mock 模式下 vectorDimension 和 batchCount 与首次一致

# 6. 失败重试
# a. 无切片文档直接向量化
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\new2.txt"
pnpm --filter server embed:document <NEW_ID>
# 预期：退出码 1；"文档尚未切片或切片为空"
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,status,error_message FROM document WHERE id=<NEW_ID>;"
# 预期：status=failed, error_message 含中文摘要

# b. 失败后重试（先 chunk 再 embed）
pnpm --filter server parse:document <NEW_ID>
pnpm --filter server chunk:document <NEW_ID>
pnpm --filter server embed:document <NEW_ID>
# 预期：退出码 0；status=embedding

# 7. 并发控制
# 用 Node 脚本在同一 Nest app context 内 Promise.all 两次调用
# 预期：sameObject=true（返回同一 Promise 结果）

# 8. 防御性拒绝
# 手动将某文档 status 设为 completed
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; UPDATE document SET status='completed' WHERE id=<MD_ID>;"
pnpm --filter server embed:document <MD_ID>
# 预期：退出码 1；"文档已完成向量化，禁止重复嵌入"
# 恢复
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; UPDATE document SET status='embedding' WHERE id=<MD_ID>;"

# 9. 越界检查
curl.exe http://localhost:3000/api/docs-json
# 预期：paths 与 tags 与 T06 完全一致（无新增 HTTP 接口）
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM document_chunk;"
# 预期：T07 不修改 document_chunk 表（chunk 数量与 T06 一致）
# 全表无 completed 状态（completed 属于 T08）

# 10. 清理
curl.exe -X DELETE http://localhost:3000/api/documents/<各剩余 id>
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/1
Remove-Item -Recurse -Force tmp-test -ErrorAction SilentlyContinue
# 预期：业务表回 0 行；migrations 表仍 2 条
```

### 16.1 真实 API 验收（可选，有 API Key 时执行）

```powershell
# 切换到真实 API
$env:EMBEDDING_MOCK='false'
$env:EMBEDDING_BASE_URL='https://api.openai.com/v1'  # 或其他兼容服务
$env:EMBEDDING_API_KEY='sk-xxx'
$env:EMBEDDING_MODEL='text-embedding-3-small'
$env:EMBEDDING_DIMENSION='1024'

pnpm --filter server embed:document <TXT_ID>
# 预期：退出码 0；stdout JSON 含 chunkCount>0, vectorDimension=1024
# 日志含批次进度（无 [MOCK] 前缀）
```

---

## 十七、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05/T06）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§四）；`pnpm --filter server build` 通过。
2. `embedding.types.ts`（类型定义 + `EmbeddingFailure`）。
3. `embedding-client.ts`（§六）：`embed(texts)` 方法 + Mock 分支 + HTTP 分支 + 重试 + 校验。
4. `embedding.service.ts`（§十一）：`embedDocument(documentId)` 编排 + 状态流转 + in-flight 去重。
5. `embedding.module.ts`（§三）：注册 Client + Service + TypeOrmModule.forFeature。
6. `app.module.ts`：imports 追加 `EmbeddingModule`。
7. `src/scripts/embed-document.ts` + `package.json` script（§十四）。
8. 回填 `00-overall-plan.md` v1.6（§十五）。
9. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
10. 执行 §十六全量验收（Mock 模式）。

---

## 十八、明确禁止（本任务一律不实现）

Qdrant 客户端（含 collection 创建/upsert/search/delete）、向量写入数据库或文件、向量检索、`status=completed`（T08 负责）、LLM、Chat、SSE、会话接口、前端页面、Rerank、消息队列、定时任务、上传后自动触发流水线、启动恢复钩子、OCR、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `openai` SDK、引入 `axios`、引入 `langchain`、引入 `uuid` 包、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改 document 模块下任何文件（含实体、DTO、controller、service）。

---

## 十九、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① fetch 手写客户端选型理由（否决 openai SDK / axios） ② 批处理流程（串行 + chunkIndex 顺序） ③ 指数退避重试策略（429/5xx/超时重试，4xx 不重试） ④ 向量校验三重检查（数量/顺序/维度） ⑤ API Key 安全（不记录、不写入 errorMessage） ⑥ 状态流转（成功留 embedding，失败 failed） ⑦ 内存结果交付 T08（不持久化向量） ⑧ Mock 模式（确定性伪向量 + SHA-256 + L2 归一化） ⑨ 并发控制（in-flight Map 去重）。
3. **启动方式**：DB 端口冲突处理结果；向量化触发命令；Mock 模式开启方式。
4. **验证方式**：§十六逐条结果（成功/失败 + 关键输出；幂等项须附两次输出对比；失败场景须附 DB 中 `error_message` 实际值；并发项须附 `sameObject` 结果）。
5. **已知问题**：含 Mock 向量无语义相似性、`parsing` 崩溃残留需后续处理、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §十八各项均未实现。

---

## 二十、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §十九。

```
你是一个 NestJS 后端工程师。请按 docs/task-07-embedding-service.md 实现 Embedding 向量化服务。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. pnpm --filter server build 通过
3. EMBEDDING_MOCK=true 用于无 API 环境下的验收

## 要做的事（严格按序）
1. 配置：env.validation.ts 加 EMBEDDING_BASE_URL(@IsString @IsNotEmpty)、EMBEDDING_API_KEY(@IsString @IsNotEmpty)、EMBEDDING_MODEL(@IsString @IsNotEmpty)、EMBEDDING_DIMENSION(@IsInt @Min(1) @Max(8192))、EMBEDDING_BATCH_SIZE(@IsInt @Min(1) @Max(100))、EMBEDDING_TIMEOUT_MS(@IsInt @Min(1000) @Max(300000))、EMBEDDING_MAX_RETRIES(@IsInt @Min(0) @Max(10))、EMBEDDING_MOCK(@IsBoolean 可选)；configuration.ts 加 embedding:{baseUrl,apiKey,model,dimension,batchSize,timeoutMs,maxRetries,mock}；.env.example 加全部默认值

2. 新建 src/modules/embedding/ 目录：
   - embedding.types.ts: EmbeddingApiRequest/EmbeddingApiResponse/EmbeddedChunk/EmbeddingResult 接口 + EmbeddingFailure extends Error
   - embedding-client.ts: @Injectable EmbeddingClient
     · embed(texts: string[]): Promise<number[][]> — Mock 分支 + HTTP 分支
     · Mock: createHash('sha256')(text) → dimension 个 float → L2 归一化 → 确定性向量
     · HTTP: fetch(POST baseUrl+'/embeddings', { Authorization: Bearer apiKey, body: {model, input: texts} })
       - AbortController 超时(timeoutMs)
       - 指数退避重试(maxRetries): base=1000ms, factor=2, max=30000ms, jitter=0-500ms
       - 重试: 超时(AbortError)、网络错误、429(尊重Retry-After)、500/502/503/504
       - 不重试: 400/401/403/404、响应非JSON、校验失败
       - 响应解析: data 按 index 排序后取 embedding
     · 仅依赖 ConfigService，不依赖 DB
   - embedding.service.ts: @Injectable EmbeddingService
     · embedDocument(documentId): Promise<EmbeddingResult>
     · 状态检查: chunking/failed/embedding 可触发, completed 拒绝('文档已完成向量化，禁止重复嵌入')
     · 置 status=embedding
     · 读 document_chunk WHERE document_id=? ORDER BY chunk_index ASC
     · 空切片 → EmbeddingFailure('文档尚未切片或切片为空，请先执行 pnpm --filter server chunk:document <id>')
     · 按 batchSize 分批串行调用 embeddingClient.embed()
     · 三重校验: vectors.length===batch.length / 每条 vector.length===dimension / data index 连续
     · 组装 EmbeddedChunk[{chunkId,chunkIndex,qdrantPointId,content,charCount,pageNo,kbId,documentId,vector}]
     · 成功返回 EmbeddingResult, status 留 embedding
     · 失败: docRepo.update(id,{status:'failed',errorMessage:摘要(≤300字,无API Key,无向量数据)}), 抛 EmbeddingFailure
     · 不清理 document_chunk（切片数据不变）
     · in-flight Map<number, Promise<EmbeddingResult>> 去重
   - embedding.module.ts: TypeOrmModule.forFeature([Document, DocumentChunk]), providers=[EmbeddingClient, EmbeddingService], exports=[EmbeddingService]

3. app.module.ts: imports 加 EmbeddingModule

4. scripts/embed-document.ts: CLI, 调 EmbeddingService.embedDocument, 输出摘要JSON({documentId,chunkCount,vectorDimension,batchCount}), 不输出向量

5. package.json: 加 "embed:document": "ts-node src/scripts/embed-document.ts"

6. 回填 00-overall-plan.md v1.6

## 不做的事
- 不做 Qdrant/collection/upsert/search/delete
- 不做向量写入数据库或文件
- 不做 status=completed（T08 负责）
- 不做 LLM/Chat/SSE/前端/消息队列/定时任务/自动触发/OCR/Rerank
- 不做新 migration/新表/改实体/改 web/
- 不引入 openai SDK/axios/langchain/uuid包/测试框架
- 不修改 processing/document 模块下任何文件
- 不修改 parsing/chunking 子目录下任何文件
- 不修改全局异常过滤器/main.ts/docker-compose.yml

## 验收（EMBEDDING_MOCK=true）
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- PDF/MD/TXT 向量化成功: status=embedding, chunkCount>0, vectorDimension=1024
- 幂等: 重复触发结果一致（Mock确定性）
- 失败: status=failed, error_message有中文摘要, 无API Key泄露
- 并发: sameObject=true
- 防御: completed状态被拒绝
- 越界: docs-json无新增接口, document_chunk不变
- 清理: 业务表回0行
```
