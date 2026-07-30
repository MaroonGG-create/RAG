# T09 向量检索 — Codex 执行指令

> 任务编号：T09（阶段 P7 前半：向量检索服务）
> 前置条件：T08 已完成（结论：**通过**，见 `docs/reports/task-08-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.7 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T08 后快照）+ `docs/reports/task-08-completion.md`（T08 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T08 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**。`status` 枚举含 `completed`；`kbId`/`fileName`/`chunkCount` 已就绪；索引 `idx_kb_status(kb_id, status)` 支持按库+状态查询 |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | 直接复用，**禁止修改** |
| `KnowledgeBase` 实体 | `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | 直接复用，**禁止修改** |
| `EmbeddingService` | `src/modules/embedding/embedding.service.ts` | **允许修改**：新增 `embedQuery(query)` 方法（§五） |
| `EmbeddingClient` | `src/modules/embedding/embedding-client.ts` | **不修改**。已有 `embed(texts: string[]): Promise<number[][]>`，支持 Mock + 重试 + 超时 |
| `EmbeddingModule` | `src/modules/embedding/embedding.module.ts` | **不修改**。已导出 `EmbeddingService` |
| `VectorStoreService` | `src/modules/vector-store/vector-store.service.ts` | **允许修改**：新增 `search()` 公开方法（§六） |
| `QdrantClientWrapper` | `src/modules/vector-store/qdrant-client-wrapper.ts` | **允许修改**：新增 `search()` 方法 + Mock 检索（§六/§十七） |
| `vector-store.types.ts` | `src/modules/vector-store/vector-store.types.ts` | **允许修改**：新增 `QdrantScoredPoint` 类型 |
| `VectorStoreModule` | `src/modules/vector-store/vector-store.module.ts` | **不修改**。已导出 `VectorStoreService` |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `retrieval` 配置段（§四） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：追加 `TOP_K`/`SCORE_THRESHOLD` 校验（§四） |
| `AppModule` | `src/app.module.ts` | **允许修改**：imports 追加 `RetrievalModule` |
| `ResponseInterceptor` | `src/common/interceptors/response.interceptor.ts` | **不修改**。控制器直接返回 data，拦截器自动包装为 `{ code: 0, message: 'success', data }` |
| `HttpExceptionFilter` | `src/common/filters/http-exception.filter.ts` | **不修改**。已有统一异常处理 |
| `ValidationPipe` | `main.ts` 中全局注册，`whitelist: true, transform: true` | **不修改**。DTO 校验由管道处理 |
| Swagger | `main.ts` 中 `SwaggerModule.setup('docs', ...)` | **不修改**。新控制器自动出现在 Swagger |
| `@qdrant/js-client-rest` | 1.12.0（T08 已安装） | **不新增依赖**。`QdrantClient.search()` 方法可用 |
| `KnowledgeBaseService` | `src/modules/knowledge-base/knowledge-base.service.ts` | **不修改、不注入**。T09 直接用 `KnowledgeBase` Repository 校验存在性，避免跨模块依赖 |
| CLI 脚本模式 | `src/scripts/*.ts` | T09 **不新增 CLI**。检索通过 HTTP 接口测试 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T08 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05-T08），否则 DB 读写与验收 SQL 都会打到错误实例。
2. **Docker daemon 可能无法启动**：T09 需要连接 Qdrant 进行检索。若 Docker 不可用则使用 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` 完成 Mock 验收（§十七）。
3. Mock 向量无语义相似性——但同文本 query 和 chunk 的 Mock 向量完全一致（cosine=1.0），可用于确定性验收。
4. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `retrieval` 模块，实现向量检索全流程：

- **接收查询**：接收 `knowledgeBaseId` 和 `query` 字符串；
- **Query Embedding**：复用 T07 `EmbeddingService` 生成 query 向量；
- **Qdrant 检索**：在 Qdrant 中按 `knowledgeBaseId` 过滤，向量相似度搜索；
- **TOP_K 和 SCORE_THRESHOLD**：支持环境变量默认值 + 请求级覆盖；
- **结果排序**：按 score 降序返回；
- **结果映射**：返回 `chunkId`/`documentId`/`documentName`/`chunkIndex`/`pageNo`/`content`/`score`；
- **知识库校验**：校验 `knowledgeBaseId` 是否存在；
- **已删除/无效文档过滤**：仅返回 `status=completed` 文档的 chunk；
- **空问题处理**：空 query → 400 参数校验失败；
- **无结果处理**：返回空数组，不报错；
- **模型服务异常处理**：Embedding API 失败 → 502；
- **耗时日志**：记录 embedding 耗时、检索耗时、总耗时；
- **Mock 检索**：`QDRANT_MOCK=true` 时内存 cosine 检索；
- **HTTP 接口**：`POST /api/knowledge-bases/:id/retrieve` 用于测试和 T10 集成；
- **内部 Service**：`RetrievalService.search()` 供 T10 Chat 模块调用。

### 2.2 非目标（本阶段一律不做）

LLM 调用、Prompt 拼装、RAG 回答、SSE、Conversation、Message、引用落库、Rerank、前端页面、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改 `EmbeddingClient`/`EmbeddingModule`、修改 `VectorStoreModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`。

**T09 不修改任何文档的 `status` 字段**——检索是只读操作，不触碰文档状态机。

---

## 三、模块与文件设计

### 3.1 新增文件（server/，6 个）

| 文件 | 职责 |
|---|---|
| `src/modules/retrieval/retrieval.module.ts` | NestJS 模块：`TypeOrmModule.forFeature([KnowledgeBase, Document])`，imports `EmbeddingModule` + `VectorStoreModule`，providers 注册 `RetrievalService`，controllers 注册 `RetrievalController`，exports 导出 `RetrievalService` |
| `src/modules/retrieval/retrieval.service.ts` | 编排服务：校验 KB → 获取已完成文档 ID → embedQuery → vectorStoreService.search → 过滤无效文档 → 映射 DTO → 日志 |
| `src/modules/retrieval/retrieval.controller.ts` | HTTP 控制器：`POST /api/knowledge-bases/:id/retrieve`，参数校验 + 调用 Service + 异常映射 |
| `src/modules/retrieval/retrieval.types.ts` | 类型定义：`RetrievalResult`/`RetrievalResponseData`/`RetrievalFailure` |
| `src/modules/retrieval/dto/retrieval-request.dto.ts` | 请求 DTO：`query`/`topK?`/`scoreThreshold?` + class-validator 装饰器 |
| `src/modules/retrieval/dto/retrieval-response.dto.ts` | 响应 DTO：`RetrievalResultDto` + `RetrievalResponseDto`（Swagger 展示用） |

### 3.2 修改文件（server/ 7 个 + 根 1 个 + docs 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/modules/embedding/embedding.service.ts` | 新增 `embedQuery(query: string): Promise<number[]>` 公开方法（§五） |
| `src/modules/vector-store/qdrant-client-wrapper.ts` | 新增 `search()` 方法 + Mock cosine 检索（§六/§十七） |
| `src/modules/vector-store/vector-store.service.ts` | 新增 `search()` 公开方法（§六） |
| `src/modules/vector-store/vector-store.types.ts` | 新增 `QdrantScoredPoint` 接口 |
| `src/config/configuration.ts` | 追加 `retrieval` 配置段（§四） |
| `src/config/env.validation.ts` | 追加 `TOP_K`/`SCORE_THRESHOLD` 校验（§四） |
| `src/app.module.ts` | imports 追加 `RetrievalModule` |
| `.env.example` | 追加 `TOP_K`/`SCORE_THRESHOLD`（§四） |
| `docs/00-overall-plan.md` | §十九 v1.8 回填（§十九） |

**禁止改动**：`web/` 任何文件、全部实体定义、既有 migration、main.ts、过滤器、拦截器、`docker-compose.yml`、processing 模块下任何文件、`EmbeddingClient`/`EmbeddingModule`、`VectorStoreModule`、`KnowledgeBaseService`/`KnowledgeBaseModule`、`DocumentService`/`DocumentModule`。

> 规模判断：一个编排服务 + 一个控制器 + 一个类型文件 + 两个 DTO 即可，**不建** retrieval strategy / provider factory——与 T05-T08「不过度细分」一致。

---

## 四、配置和环境变量（冻结级）

### 4.1 环境变量清单

| 变量 | 默认值 | 校验 | 说明 |
|---|---:|---|---|
| `TOP_K` | 5 | `@IsDefined @IsInt @Min(1) @Max(20)` | 默认检索返回数量上限 |
| `SCORE_THRESHOLD` | 0.5 | `@IsDefined @Type(() => Number) @Min(0) @Max(1)` | 默认相似度阈值（Cosine），低于此值的结果被丢弃 |

> 这两个变量在总体方案 §12 中已列出，T09 首次实现。

### 4.2 configuration.ts 追加

```ts
retrieval: {
  topK: number;
  scoreThreshold: number;
};
```

读取逻辑：

```ts
retrieval: {
  topK: Number(process.env.TOP_K ?? 5),
  scoreThreshold: Number(process.env.SCORE_THRESHOLD ?? 0.5),
},
```

并在 `AppConfiguration` 接口追加对应类型。

### 4.3 env.validation.ts 追加

```ts
@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(20)
TOP_K!: number;

@IsDefined()
@Type(() => Number)
@Min(0)
@Max(1)
SCORE_THRESHOLD!: number;
```

### 4.4 .env.example 追加

```env
# 检索（T09 首次使用）
TOP_K=5
SCORE_THRESHOLD=0.5
```

---

## 五、Query Embedding 复用设计（冻结级，设计问题 1）

### 5.1 决策：在 `EmbeddingService` 新增 `embedQuery()` 方法

**核心设计**：T09 不直接调用 `EmbeddingClient`（未从 `EmbeddingModule` 导出），而是在 `EmbeddingService` 上新增一个轻量方法 `embedQuery(query: string): Promise<number[]>`，内部调用 `this.embeddingClient.embed([query])`。

**选择在 Service 层新增而非导出 Client 的理由**：

| 方案 | 否决理由 |
|---|---|
| 导出 `EmbeddingClient` 从 `EmbeddingModule` | 暴露低层客户端，绕过 Service 抽象；`RetrievalService` 需自行处理维度校验 |
| 在 `retrieval` 模块新建 `QueryEmbeddingService` | 重复维度校验逻辑；需导出 `EmbeddingClient` |
| **在 `EmbeddingService` 新增 `embedQuery()`** ✅ | 复用已有 `EmbeddingClient`（含 Mock/重试/超时）；Service 已注入 `dimension` 可做校验；一个方法追加，零新文件 |

### 5.2 `embedQuery` 方法签名

```ts
// EmbeddingService 新增公开方法
async embedQuery(query: string): Promise<number[]>
```

### 5.3 实现逻辑

```ts
async embedQuery(query: string): Promise<number[]> {
  const vectors = await this.embeddingClient.embed([query]);

  if (vectors.length !== 1) {
    throw new EmbeddingFailure(
      `Query Embedding 返回数量不一致：expected=1，actual=${vectors.length}`,
    );
  }

  const vector = vectors[0];

  if (vector.length !== this.dimension) {
    throw new EmbeddingFailure(
      `Query Embedding 维度不一致：expected=${this.dimension}，actual=${vector.length}`,
    );
  }

  return vector;
}
```

### 5.4 关键特性

| 特性 | 说明 |
|---|---|
| **不修改文档状态** | `embedQuery` 是纯查询操作，不触碰 `document.status`/`errorMessage` |
| **复用 Mock** | `EMBEDDING_MOCK=true` 时自动走 `EmbeddingClient.mockEmbed()`，生成确定性向量 |
| **复用重试** | `EmbeddingClient.httpEmbed()` 内置指数退避重试（429/5xx/超时） |
| **复用超时** | `EMBEDDING_TIMEOUT_MS` 生效 |
| **维度校验** | 返回向量维度必须等于 `EMBEDDING_DIMENSION`，否则抛 `EmbeddingFailure` |
| **无 in-flight 去重** | Query embedding 是无状态的，不同 query 产生不同向量，不需要去重 |

### 5.5 Mock 行为说明

`EMBEDDING_MOCK=true` 时，`EmbeddingClient.mockEmbed([query])` 使用 SHA-256 哈希生成确定性向量：

- **同文本 → 同向量**：query 与 chunk content 相同时，Mock 向量完全一致，cosine similarity = 1.0
- **不同文本 → 不同向量**：cosine similarity 为确定性值但无语义含义
- **L2 归一化**：Mock 向量已归一化，与 Cosine 距离兼容

这使得 Mock 模式下的检索验收完全确定性和可重复。

---

## 六、Qdrant Search API 用法（冻结级，设计问题 2）

### 6.1 三层调用链

```
RetrievalController
  → RetrievalService.search(kbId, query, topK?, scoreThreshold?)
      → EmbeddingService.embedQuery(query)              [T07 复用]
      → VectorStoreService.search(vector, kbId, topK, scoreThreshold)
          → QdrantClientWrapper.search(vector, filter, limit, scoreThreshold)
              → QdrantClient.search(collection, params)  [真实]
              → mockSearch(vector, filter, limit, threshold)  [Mock]
```

### 6.2 `QdrantClientWrapper.search()` 方法

```ts
async search(
  vector: number[],
  filter: QdrantFilter,
  limit: number,
  scoreThreshold: number,
): Promise<QdrantScoredPoint[]>
```

**真实 Qdrant 调用**：

```ts
const result = await this.getClient().search(this.collection, {
  vector,
  filter,
  limit,
  score_threshold: scoreThreshold,
  with_payload: true,
});

return result.map((point) => ({
  id: String(point.id),
  score: point.score,
  payload: (point.payload ?? {}) as QdrantPayload,
}));
```

**关键参数说明**：

| 参数 | 值 | 说明 |
|---|---|---|
| `vector` | `number[]` | query 向量 |
| `filter` | `{ must: [{ key: 'knowledgeBaseId', match: { value: kbId } }] }` | 按 KB 过滤 |
| `limit` | `topK`（1-20） | 返回最大数量 |
| `score_threshold` | `scoreThreshold`（0-1） | 低于此分数的结果被 Qdrant 直接丢弃 |
| `with_payload` | `true` | 返回 payload（chunkId/content/pageNo 等） |

### 6.3 `VectorStoreService.search()` 方法

```ts
async search(
  queryVector: number[],
  knowledgeBaseId: number,
  limit: number,
  scoreThreshold: number,
): Promise<QdrantScoredPoint[]>
```

**实现逻辑**：

```ts
async search(
  queryVector: number[],
  knowledgeBaseId: number,
  limit: number,
  scoreThreshold: number,
): Promise<QdrantScoredPoint[]> {
  const filter = this.createKnowledgeBaseFilter(knowledgeBaseId);
  return this.qdrantClient.search(queryVector, filter, limit, scoreThreshold);
}
```

- 复用已有 `createKnowledgeBaseFilter()` 私有方法（T08 实现）；
- 不做业务逻辑过滤（已完成文档过滤在 `RetrievalService` 中做）；
- 不做结果映射（DTO 映射在 `RetrievalService` 中做）。

### 6.4 `QdrantScoredPoint` 类型

```ts
// vector-store.types.ts 新增
export interface QdrantScoredPoint {
  id: string;
  score: number;
  payload: QdrantPayload;
}
```

---

## 七、knowledgeBaseId Payload Filter（冻结级，设计问题 3）

### 7.1 过滤条件

```json
{
  "must": [
    { "key": "knowledgeBaseId", "match": { "value": 1 } }
  ]
}
```

- 与 T08 `createKnowledgeBaseFilter()` 完全一致；
- `knowledgeBaseId` 已在 T08 创建为 integer payload 索引，过滤性能有保障；
- **不叠加 `documentId` 过滤**——T09 是知识库级检索，不需要限定文档。

### 7.2 过滤在 Qdrant 侧执行

`score_threshold` 和 `filter` 都在 Qdrant 服务端执行，只有同时满足「KB 匹配 + 分数 ≥ 阈值」的 point 才会返回。这减少了网络传输量。

### 7.3 文档级过滤（应用层）

Qdrant 返回结果后，`RetrievalService` 再做一次应用层过滤：检查 `payload.documentId` 是否在「已完成文档 ID 集合」中（§十五）。这是防御性措施，处理 Qdrant 中可能残留的孤儿向量。

---

## 八、TopK 和 ScoreThreshold 边界（冻结级，设计问题 4）

### 8.1 默认值与范围

| 参数 | 环境变量 | 默认值 | 范围 | 请求级覆盖 |
|---|---|---:|---|---|
| `topK` | `TOP_K` | 5 | 1-20 | `topK` 字段（可选） |
| `scoreThreshold` | `SCORE_THRESHOLD` | 0.5 | 0-1 | `scoreThreshold` 字段（可选） |

### 8.2 优先级

```
请求 DTO 中的 topK/scoreThreshold  >  环境变量 TOP_K/SCORE_THRESHOLD
```

- 请求未传 `topK` → 使用 `configService.get('retrieval.topK')`（即 `TOP_K` 环境变量）；
- 请求传了 `topK=3` → 使用 3；
- `scoreThreshold` 同理。

### 8.3 边界校验

**环境变量层**（启动时 `env.validation.ts`）：

- `TOP_K`：`@IsInt @Min(1) @Max(20)` → 超范围启动失败；
- `SCORE_THRESHOLD`：`@Min(0) @Max(1)` → 超范围启动失败。

**请求 DTO 层**（运行时 `ValidationPipe`）：

- `topK`：`@IsOptional @IsInt @Min(1) @Max(20)` → 超范围返回 400；
- `scoreThreshold`：`@IsOptional @Min(0) @Max(1)` → 超范围返回 400。

### 8.4 `score_threshold` 语义

Qdrant 的 `score_threshold` 是 **minimum score filter**：只有 `score >= score_threshold` 的结果才会返回。

- `scoreThreshold=0` → 返回所有匹配（不过滤分数）；
- `scoreThreshold=1` → 只返回完全匹配（cosine=1.0）；
- `scoreThreshold=0.5`（默认）→ 只返回相似度 ≥ 0.5 的结果。

---

## 九、相似度分数含义（冻结级，设计问题 5）

### 9.1 Cosine 相似度

Collection 使用 `Distance.Cosine`（T08 冻结），Qdrant `search` 返回的 `score` 即 **cosine similarity**：

| 分数 | 含义 |
|---|---|
| 1.0 | 方向完全一致（最大相似度） |
| 0.0 | 正交（无相似性） |
| -1.0 | 方向完全相反 |

**实际范围**：文本 Embedding 向量通常归一化后非负，score 实际分布在 [0, 1]。Mock 向量已做 L2 归一化。

### 9.2 分数排序

Qdrant `search` 默认按 score 降序返回。**不需要在应用层重新排序**——Qdrant 已保证。

### 9.3 阈值调参建议（写入面试文档）

| 阈值 | 效果 | 适用场景 |
|---|---|---|
| 0.3 | 宽松，召回率高 | 探索性搜索 |
| 0.5（默认） | 平衡 | 通用 RAG |
| 0.7 | 严格，精确率高 | 事实性问答 |
| 0.9 | 极严格 | 精确匹配 |

---

## 十、无命中结果处理（冻结级，设计问题 6）

### 10.1 冻结决策：返回空数组，不报错

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "results": [],
    "total": 0,
    "took": 42
  }
}
```

**理由**：

- 「无命中」是正常的检索结果，不是错误；
- T10 RAG 问答将根据 `results.length === 0` 判断是否返回「知识库中未找到相关内容」固定话术（总体方案 §4.2 ③），**不调用 LLM（防编造的第一道闸）**；
- HTTP 状态码 200，不返回 404（知识库存在，只是没有匹配内容）。

### 10.2 无命中的可能原因

| 原因 | 行为 |
|---|---|
| 知识库为空（无已完成文档） | 提前返回空数组（§十五 步骤 4） |
| 有文档但分数全部低于阈值 | Qdrant 返回空，`RetrievalService` 返回空 |
| 有文档但 KB 不匹配 | Qdrant filter 过滤后返回空 |
| Embedding 正常但语义不相关 | 分数低于阈值，返回空 |

### 10.3 日志

无命中时记录 INFO 级日志：

```
检索无命中：knowledgeBaseId=1，query="什么是RAG..."，took=42ms
```

---

## 十一、Payload 缺失或类型错误处理（冻结级，设计问题 7）

### 11.1 防御性校验

Qdrant 返回的每个 `ScoredPoint` 的 `payload` 理论上应包含完整字段（T08 写入时保证），但 T09 做防御性校验以应对异常情况（手动修改 Qdrant、版本迁移残留等）。

### 11.2 校验规则

```ts
private isValidPayload(payload: QdrantPayload): boolean {
  return (
    typeof payload.chunkId === 'number' &&
    typeof payload.knowledgeBaseId === 'number' &&
    typeof payload.documentId === 'number' &&
    typeof payload.documentName === 'string' &&
    typeof payload.chunkIndex === 'number' &&
    (payload.pageNo === null || typeof payload.pageNo === 'number') &&
    typeof payload.content === 'string'
  );
}
```

### 11.3 处理策略

| 情况 | 行为 |
|---|---|
| `payload` 为 `undefined`/`null` | 跳过该结果，`logger.warn` 记录 point id |
| 字段缺失或类型不匹配 | 跳过该结果，`logger.warn` 记录 point id + 缺失字段 |
| `pageNo` 为 `null` | **正常**（MD/TXT 无页码） |
| `content` 为空字符串 | **正常**（不跳过，可能是清洗后空 chunk） |
| `score` 不是有限数值 | 跳过该结果（理论上不会发生，Qdrant 保证） |

### 11.4 日志

```
检索结果 payload 校验失败，已跳过：pointId=abc-123，缺失字段=content
```

---

## 十二、检索结果 DTO（冻结级，设计问题 8）

### 12.1 `RetrievalResult` 接口

```ts
// retrieval.types.ts
export interface RetrievalResult {
  chunkId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
  pageNo: number | null;
  content: string;
  score: number;
}
```

### 12.2 `RetrievalResponseData` 接口

```ts
// retrieval.types.ts
export interface RetrievalResponseData {
  results: RetrievalResult[];
  total: number;
  took: number;  // 总耗时（ms）
}
```

### 12.3 请求 DTO

```ts
// dto/retrieval-request.dto.ts
export class RetrievalRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  scoreThreshold?: number;
}
```

### 12.4 响应 DTO（Swagger 展示用）

```ts
// dto/retrieval-response.dto.ts
export class RetrievalResultDto {
  chunkId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
  pageNo: number | null;
  content: string;
  score: number;
}

export class RetrievalResponseDto {
  results: RetrievalResultDto[];
  total: number;
  took: number;
}
```

> 控制器直接返回 `RetrievalResponseData`，`ResponseInterceptor` 自动包装为 `{ code: 0, message: 'success', data: RetrievalResponseData }`。

### 12.5 HTTP 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "results": [
      {
        "chunkId": 123,
        "documentId": 45,
        "documentName": "产品手册.pdf",
        "chunkIndex": 3,
        "pageNo": 12,
        "content": "RAG（检索增强生成）是一种...",
        "score": 0.8732
      }
    ],
    "total": 1,
    "took": 156
  }
}
```

---

## 十三、内部 Service 与 HTTP 接口（冻结级，设计问题 9）

### 13.1 冻结决策：同时提供内部 Service 和 HTTP 接口

| 形式 | 消费方 | 用途 |
|---|---|---|
| `RetrievalService.search()` | T10 Chat 模块 | RAG 问答流程中检索上下文 |
| `POST /api/knowledge-bases/:id/retrieve` | 手动测试 / Swagger | 检索质量验证、参数调优 |

### 13.2 HTTP 接口设计

```
POST /api/knowledge-bases/:id/retrieve
Content-Type: application/json

{
  "query": "什么是RAG",
  "topK": 5,
  "scoreThreshold": 0.5
}
```

- **路径**：`/api/knowledge-bases/:id/retrieve`（`id` = knowledgeBaseId）
- **方法**：POST（query 可能很长，不适合 GET query string）
- **`id` 参数**：`@Param('id', ParseIntPipe)` → 自动校验为正整数
- **Body**：`RetrievalRequestDto`（`ValidationPipe` 自动校验）
- **响应**：`RetrievalResponseData`（`ResponseInterceptor` 自动包装）

### 13.3 控制器异常映射

| 异常类型 | HTTP 状态码 | 说明 |
|---|---|---|
| `NotFoundException`（KB 不存在） | 404 | 直接抛出，全局过滤器处理 |
| `EmbeddingFailure`（向量生成失败） | 502 | 控制器 catch → `BadGatewayException` |
| `VectorStoreFailure`（Qdrant 检索失败） | 500 | 控制器 catch → `InternalServerErrorException` |
| `RetrievalFailure`（其他检索错误） | 500 | 控制器 catch → `InternalServerErrorException` |
| ValidationPipe 校验失败 | 400 | 自动处理（`@IsNotEmpty`/`@Min`/`@Max` 等） |

### 13.4 控制器实现

```ts
@Controller('knowledge-bases/:id/retrieve')
@ApiTags('retrieval')
export class RetrievalController {
  constructor(
    private readonly retrievalService: RetrievalService,
  ) {}

  @Post()
  @ApiOperation({ summary: '向量检索' })
  @ApiOkResponse({ type: RetrievalResponseDto })
  async retrieve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RetrievalRequestDto,
  ): Promise<RetrievalResponseData> {
    try {
      return await this.retrievalService.search(
        id,
        dto.query,
        dto.topK,
        dto.scoreThreshold,
      );
    } catch (error: unknown) {
      if (error instanceof EmbeddingFailure) {
        throw new BadGatewayException('检索服务暂时不可用：向量生成失败');
      }
      throw error;
    }
  }
}
```

> `NotFoundException` 和 `VectorStoreFailure`/`RetrievalFailure` 不在控制器 catch 中处理——`NotFoundException` 是 `HttpException` 子类，全局过滤器直接处理；`VectorStoreFailure`/`RetrievalFailure` 非 `HttpException`，全局过滤器返回 500。

### 13.5 新增 API 编号

此接口为总体方案 §9 的 13 个冻结接口之外的 **T09 新增测试接口**，编号 #14，需在基线回填中注明（§十九）。

---

## 十四、与 T10 RAG 问答的调用边界（冻结级，设计问题 10）

### 14.1 T10 调用方式

```ts
// T10 ChatService 中
const retrievalResult = await this.retrievalService.search(
  knowledgeBaseId,
  question,
  topK,
  scoreThreshold,
);

if (retrievalResult.results.length === 0) {
  // 不调用 LLM，直接返回"知识库中未找到相关内容"
  // 总体方案 §4.2 ③：防编造的第一道闸
}

// 有结果 → 组装上下文
const context = retrievalResult.results
  .map((r, i) => `[来源${i + 1}] ${r.content}`)
  .join('\n\n');
// 截断到 CONTEXT_MAX_CHARS（默认 4000）

// 调用 LLM...
// 保存引用时使用 r.documentId, r.documentName, r.chunkIndex, r.pageNo, r.score, r.content
```

### 14.2 数据接口

```ts
// T10 从 RetrievalService 获取的数据
interface RetrievalResponseData {
  results: RetrievalResult[];  // 按 score 降序
  total: number;               // results.length
  took: number;                // 检索耗时（ms），用于日志
}

interface RetrievalResult {
  chunkId: number;             // → message_reference.chunk_id
  documentId: number;          // → message_reference.document_id
  documentName: string;        // → message_reference.document_name
  chunkIndex: number;          // → message_reference.chunk_index
  pageNo: number | null;       // → message_reference.page_no
  content: string;             // → 上下文组装 + message_reference.content_snapshot
  score: number;               // → message_reference.score
}
```

### 14.3 模块依赖

```
T10 ChatModule
  imports: RetrievalModule（获取 RetrievalService）
```

- `RetrievalModule` exports `RetrievalService`；
- T10 不直接依赖 `EmbeddingModule` 或 `VectorStoreModule`——通过 `RetrievalService` 间接使用；
- 无循环依赖。

### 14.4 T09 不做的事

- 不组装 Prompt；
- 不调用 LLM；
- 不保存会话/消息/引用；
- 不做 SSE 流式输出；
- 不做 Rerank。

---

## 十五、已删除/无效文档过滤（冻结级）

### 15.1 设计原因

T08 文档/知识库删除时调用 `deleteByDocumentId()`/`deleteByKnowledgeBaseId()` 清理 Qdrant 向量，但删除失败只记录 warning 不阻断 MySQL 删除（T08 §14.1 设计决策）。因此 Qdrant 中可能残留孤儿向量。T09 需要过滤这些无效结果。

### 15.2 过滤流程

```
RetrievalService.search():
  ...
  3. validDocIds = SELECT id FROM document WHERE kb_id = :kbId AND status = 'completed'
     → Set<number>
  4. if (validDocIds.size === 0) → 提前返回空数组（知识库无可用文档）
  ...
  7. 过滤 Qdrant 结果：只保留 payload.documentId ∈ validDocIds 的结果
```

### 15.3 查询优化

- 单次 DB 查询获取所有已完成文档 ID（利用 `idx_kb_status` 索引）；
- 内存中用 `Set` 做O(1) 查找；
- 不逐条查 DB。

### 15.4 过滤场景

| 场景 | Qdrant 中有向量？ | 过滤结果 |
|---|---|---|
| 文档正常 `completed` | 是 | 保留 |
| 文档已从 MySQL 删除 | 可能（孤儿） | 过滤掉 |
| 文档 `failed` | 不应有（T08 失败时清理） | 过滤掉 |
| 文档 `pending`/`parsing`/`chunking`/`embedding` | 不应有 | 过滤掉 |

### 15.5 日志

如果过滤掉了结果，记录 warning：

```
检索结果过滤无效文档：knowledgeBaseId=1，过滤掉 N 条（documentId 不在已完成列表中）
```

---

## 十六、状态流转说明

### 16.1 T09 不修改文档状态

**检索是只读操作**。`RetrievalService` 不触碰 `document.status`/`errorMessage`/`chunkCount`。

```
T09 涉及的状态判断（只读）：
  document.status === 'completed' → 该文档的向量可被检索
  document.status !== 'completed' → 该文档的向量不可被检索（过滤掉）
```

### 16.2 不需要并发控制

检索操作是幂等的只读操作，同一 KB 的并发检索不会互相影响，**不需要 in-flight 去重**（与 T05-T08 的写入操作不同）。

### 16.3 不需要重试

检索失败（Qdrant 不可达、Embedding 超时等）直接抛错给调用方。T10 可自行决定是否重试。T09 的 HTTP 接口返回错误后，客户端可重新发起请求。

---

## 十七、Mock 检索实现（冻结级，设计问题 12）

### 17.1 设计目标

`QDRANT_MOCK=true` 时，`QdrantClientWrapper.search()` 使用内存 cosine 相似度搜索，无需真实 Qdrant。配合 `EMBEDDING_MOCK=true`，可实现全链路 Mock 检索验收。

### 17.2 Mock 检索实现

```ts
// QdrantClientWrapper 内部
private mockSearch(
  vector: number[],
  filter: QdrantFilter,
  limit: number,
  scoreThreshold: number,
): QdrantScoredPoint[] {
  const results: QdrantScoredPoint[] = [];

  for (const [id, point] of this.mockStore.entries()) {
    if (!this.matchesFilter(point.payload, filter)) continue;

    const score = this.cosineSimilarity(vector, point.vector);

    if (score < scoreThreshold) continue;

    results.push({
      id,
      score,
      payload: point.payload,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

private cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}
```

### 17.3 Mock 检索特性

| 特性 | 说明 |
|---|---|
| **内存搜索** | 遍历 `mockStore` 中所有 point，按 filter 过滤后计算 cosine |
| **score_threshold** | 在应用层过滤（真实 Qdrant 在服务端过滤） |
| **排序** | 按 score 降序（与真实 Qdrant 一致） |
| **limit** | 取前 N 条（与真实 Qdrant 一致） |
| **确定性** | 同一 query + 同一 mockStore → 完全相同的结果 |
| **同文本 score=1.0** | query 与 chunk content 相同时，Mock 向量完全一致 |

### 17.4 Mock 模式的限制

- Mock 向量无语义相似性——不同文本的 cosine 分数无含义；
- Mock 数据仅存在于进程内存，重启后丢失；
- Mock 模式仅用于 T09 流程验收，不能用于检索质量评估。

### 17.5 真实 Qdrant 验收（Docker 可用时）

```powershell
# 启动 Qdrant
docker compose up -d qdrant
# 验证健康
curl.exe http://localhost:6333/readyz
# 验证 Collection
curl.exe http://localhost:6333/collections/rag_chunks
```

---

## 十八、日志和异常处理

### 18.1 日志矩阵

| 事件 | 级别 | 内容 |
|---|---|---|
| 检索成功（有结果） | `log` | `检索完成：kbId={id}，query="{truncated}"，resultCount={n}，embeddingTook={ms}ms，searchTook={ms}ms，took={ms}ms` |
| 检索成功（无结果） | `log` | `检索无命中：kbId={id}，query="{truncated}"，took={ms}ms` |
| KB 不存在 | 不记录（抛 `NotFoundException`） | — |
| 无已完成文档 | `log` | `知识库无已完成文档：kbId={id}，提前返回空结果` |
| Embedding 失败 | `error` | `检索失败-向量生成：kbId={id}，{message}` |
| Qdrant 检索失败 | `error` | `检索失败-Qdrant搜索：kbId={id}，{message}` |
| Payload 校验失败 | `warn` | `检索结果 payload 校验失败，已跳过：pointId={id}，缺失字段={field}` |
| 无效文档过滤 | `warn` | `检索结果过滤无效文档：kbId={id}，过滤掉 {n} 条` |

### 18.2 query 截断

日志中的 query 截断到 50 字符，避免长 query 刷屏：

```ts
private truncateQuery(query: string): string {
  return query.length > 50 ? query.slice(0, 50) + '...' : query;
}
```

### 18.3 `RetrievalFailure` 类型

```ts
// retrieval.types.ts
export class RetrievalFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalFailure';
  }
}
```

### 18.4 errorMessage 安全规则

**允许记录到日志**：

- 中文错误摘要；
- 错误类型标签；
- 耗时信息。

**禁止记录到日志或返回给客户端**：

- API Key；
- 向量数据；
- 完整 Qdrant 响应体；
- 堆栈跟踪（仅 `logger.error` 内部记录，不返回 HTTP 响应）。

---

## 十九、基线回填（00-overall-plan.md v1.8，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §7 模块划分补充：`retrieval` 模块在 T09 创建 | 新增 `RetrievalModule`（`src/modules/retrieval/`），含 `RetrievalService`（检索编排）和 `RetrievalController`（HTTP 接口）；依赖 `EmbeddingModule` + `VectorStoreModule` |
| 2 | §9 API 接口清单补充 #14：`POST /api/knowledge-bases/:id/retrieve` | T09 新增检索测试接口；body `{query, topK?, scoreThreshold?}`；响应 `{results, total, took}` |
| 3 | §12 环境变量 `TOP_K`/`SCORE_THRESHOLD` 在 T09 实现 | 总体方案 §12 已列出但未实现；T09 首次使用检索配置 |
| 4 | §4.2 问答流水线 ②③ 补充：检索参数来源和过滤逻辑 | ② query → `EmbeddingService.embedQuery()` → queryVector；③ Qdrant search filter=knowledgeBaseId，TopK/阈值可被请求覆盖，无效文档过滤 |
| 5 | `EmbeddingService` 新增 `embedQuery()` 方法 | T09 需要单条 query 向量化，复用 T07 的 `EmbeddingClient`（含 Mock/重试/超时） |

---

## 二十、验收方式（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功（DB 端口冲突须先解决）。
> **Mock 模式验收**：以下验收命令在 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` 下执行，无需 Docker Qdrant 或真实 API。
> **真实 Qdrant 验收**：Docker 可用时使用 `QDRANT_MOCK=false` + `EMBEDDING_MOCK=true`。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → 完整流水线（parse → chunk → embed → store）
$env:QDRANT_MOCK='true'
$env:EMBEDDING_MOCK='true'
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t09-retrieval-kb\"}"
# 记录知识库 ID，假设为 $kbId

# 上传 TXT（内容为已知文本，便于 Mock 同文本检索）
# 假设 tmp-test\rag-intro.txt 内容为 "RAG is retrieval augmented generation"
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/documents" -F "file=@tmp-test\rag-intro.txt"
# 记录文档 ID，假设为 $docId

pnpm --filter server parse:document $docId
pnpm --filter server chunk:document $docId
pnpm --filter server embed:document $docId
pnpm --filter server store:document $docId
# 确认 status=completed, chunk_count>0

# 2. 基础检索（Mock 模式，同文本 query → score=1.0）
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"RAG is retrieval augmented generation\"}"
# 预期：code=0, results.length>=1, results[0].score=1.0, results[0].content 包含原文
# 预期：results[0] 包含 chunkId, documentId, documentName, chunkIndex, pageNo, content, score

# 3. topK 覆盖
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"RAG is retrieval augmented generation\",\"topK\":1}"
# 预期：results.length<=1

# 4. scoreThreshold 覆盖（极高阈值 → 无结果）
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"RAG is retrieval augmented generation\",\"scoreThreshold\":0.99}"
# 预期：同文本 score=1.0 >= 0.99，仍有结果

curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"completely unrelated text content\",\"scoreThreshold\":0.99}"
# 预期：不同文本 score < 0.99，results=[]

# 5. 空查询 → 400
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"\"}"
# 预期：400 参数校验失败

# 6. 不存在的知识库 → 404
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/999999/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"test\"}"
# 预期：404 知识库不存在

# 7. 知识库无已完成文档 → 空结果
# 新建知识库，不上传任何文档
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t09-empty-kb\"}"
# 记录空知识库 ID，假设为 $emptyKbId
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$emptyKbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"test\"}"
# 预期：code=0, results=[], total=0

# 8. 已删除文档过滤
# 删除步骤 1 中的文档
curl.exe -X DELETE "http://localhost:3000/api/documents/$docId"
# 预期：204
# 再次检索
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"RAG is retrieval augmented generation\"}"
# 预期：results=[]（文档已删除，向量已清理）

# 9. Swagger 包含新接口
curl.exe http://localhost:3000/api/docs-json | jq '.paths | keys[] | select(contains("retrieve"))'
# 预期：包含 "knowledge-bases/{id}/retrieve"

# 10. 越界检查
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：仍只有原 6 张业务表加 migrations（无新表）
curl.exe http://localhost:3000/api/docs-json | jq '.paths | keys | length'
# 预期：比 T08 多 1 个路径（retrieve）

# 11. 范围扫描
# rg "chat/stream|text/event-stream|EventSource|LLM|Chat|Rerank|conversation|message_reference" server/src/modules/retrieval
# 预期：无命中

# 12. 清理
curl.exe -X DELETE "http://localhost:3000/api/knowledge-bases/$kbId"
curl.exe -X DELETE "http://localhost:3000/api/knowledge-bases/$emptyKbId"
Remove-Item -Recurse -Force tmp-test -ErrorAction SilentlyContinue
```

### 20.1 真实 Qdrant + 真实 API 验收（可选，有 API Key + Docker 时执行）

```powershell
$env:QDRANT_MOCK='false'
$env:EMBEDDING_MOCK='false'
$env:EMBEDDING_API_KEY='sk-xxx'

# 上传真实文档，完整流水线后检索
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/retrieve" -H "Content-Type: application/json" -d "{\"query\":\"什么是RAG\"}"
# 预期：返回语义相关的 chunk，score 在 0.5-0.9 之间
```

---

## 二十一、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05-T08）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§四）；`pnpm --filter server build` 通过。
2. 修改 `embedding.service.ts`：新增 `embedQuery()` 方法（§五）；`pnpm --filter server build` 通过。
3. 修改 `vector-store.types.ts`：新增 `QdrantScoredPoint` 接口。
4. 修改 `qdrant-client-wrapper.ts`：新增 `search()` 方法 + Mock `mockSearch()` + `cosineSimilarity()`（§六/§十七）；`pnpm --filter server build` 通过。
5. 修改 `vector-store.service.ts`：新增 `search()` 公开方法（§六）；`pnpm --filter server build` 通过。
6. 新建 `src/modules/retrieval/retrieval.types.ts`（§十二）。
7. 新建 `src/modules/retrieval/dto/retrieval-request.dto.ts` + `retrieval-response.dto.ts`（§十二）。
8. 新建 `src/modules/retrieval/retrieval.service.ts`（§十五 + §十八）。
9. 新建 `src/modules/retrieval/retrieval.controller.ts`（§十三）。
10. 新建 `src/modules/retrieval/retrieval.module.ts`（§三）。
11. 修改 `app.module.ts`：imports 追加 `RetrievalModule`；`pnpm --filter server build` 通过。
12. 回填 `00-overall-plan.md` v1.8（§十九）。
13. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
14. 执行 §二十全量验收（Mock 模式优先；Docker 可用时追加真实 Qdrant 验收）。

---

## 二十二、明确禁止（本任务一律不实现）

LLM 调用、Prompt 拼装、RAG 回答、SSE、Conversation、Message、引用落库、Rerank、前端页面、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改 `EmbeddingClient`/`EmbeddingModule`、修改 `VectorStoreModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`、修改任何文档的 `status` 字段、上传后自动触发流水线、启动恢复钩子、OCR。

---

## 二十三、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① `embedQuery()` 复用 T07 `EmbeddingClient`（Mock/重试/超时/维度校验） ② Qdrant `search` API 用法（`vector`/`filter`/`limit`/`score_threshold`/`with_payload`） ③ `knowledgeBaseId` payload filter ④ topK/scoreThreshold 默认值 + 请求级覆盖 ⑤ cosine 相似度分数含义 ⑥ 无命中返回空数组 ⑦ payload 防御性校验 ⑧ `RetrievalResult` DTO ⑨ HTTP 接口 + 内部 Service 双提供 ⑩ 已删除/无效文档过滤（`status=completed` 交集） ⑪ Mock cosine 检索 ⑫ 日志（耗时/query 截断）。
3. **启动方式**：DB 端口冲突处理结果；Qdrant 连接方式；Mock 模式开启方式；检索触发命令。
4. **验证方式**：§二十逐条结果（成功/失败 + 关键输出；Mock 同文本 score=1.0；topK/threshold 覆盖；空查询 400；KB 不存在 404；空知识库空结果；删除后无结果；Swagger 新路径；范围扫描无命中）。
5. **已知问题**：含 Mock 向量无语义相似性、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §二十二各项均未实现。

---

## 二十四、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §二十三。

```
你是一个 NestJS 后端工程师。请按 docs/task-09-vector-retrieval.md 实现向量检索服务。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. 确认 @qdrant/js-client-rest@1.12.0 已安装（T08 安装）
3. QDRANT_MOCK=true + EMBEDDING_MOCK=true 用于无 Docker/API 环境下的验收

## 要做的事（严格按序）

1. 配置：env.validation.ts 加 TOP_K(@IsInt @Min(1) @Max(20))、SCORE_THRESHOLD(@Min(0) @Max(1))；
   configuration.ts 加 retrieval:{topK,scoreThreshold}；.env.example 加 TOP_K=5, SCORE_THRESHOLD=0.5

2. embedding.service.ts 新增公开方法：
   async embedQuery(query: string): Promise<number[]>
   - 调用 this.embeddingClient.embed([query])
   - 校验返回数量=1, 维度=EMBEDDING_DIMENSION
   - 返回 vectors[0]
   - 不修改文档状态

3. vector-store.types.ts 新增：
   export interface QdrantScoredPoint { id: string; score: number; payload: QdrantPayload; }

4. qdrant-client-wrapper.ts 新增 search() 方法：
   async search(vector, filter: QdrantFilter, limit: number, scoreThreshold: number): Promise<QdrantScoredPoint[]>
   - Mock: 遍历 mockStore, matchesFilter 后算 cosineSimilarity, 过滤 score<scoreThreshold, 降序排序, slice(limit)
   - 真实: client.search(collection, { vector, filter, limit, score_threshold: scoreThreshold, with_payload: true })
     返回 result.map(p => ({ id: String(p.id), score: p.score, payload: (p.payload ?? {}) as QdrantPayload }))
   - 新增 private cosineSimilarity(a: number[], b: number[]): number

5. vector-store.service.ts 新增公开方法：
   async search(queryVector: number[], knowledgeBaseId: number, limit: number, scoreThreshold: number): Promise<QdrantScoredPoint[]>
   - 调用 this.createKnowledgeBaseFilter(knowledgeBaseId) 创建 filter
   - 调用 this.qdrantClient.search(queryVector, filter, limit, scoreThreshold)

6. 新建 src/modules/retrieval/ 目录：
   - retrieval.types.ts: RetrievalResult{chunkId,documentId,documentName,chunkIndex,pageNo,content,score} + RetrievalResponseData{results,total,took} + RetrievalFailure extends Error
   - dto/retrieval-request.dto.ts: query(@IsString @IsNotEmpty @MaxLength(2000)), topK?(@IsOptional @IsInt @Min(1) @Max(20)), scoreThreshold?(@IsOptional @Min(0) @Max(1))
   - dto/retrieval-response.dto.ts: RetrievalResultDto + RetrievalResponseDto (Swagger 展示用)
   - retrieval.service.ts: @Injectable RetrievalService
     · 构造函数注入 KnowledgeBase Repository, Document Repository, EmbeddingService, VectorStoreService, ConfigService
     · search(kbId, query, topK?, scoreThreshold?): Promise<RetrievalResponseData>
       a. query trim 后非空检查（空则 throw BadRequestException）
       b. KB 存在性: knowledgeBaseRepository.findOne({where:{id:kbId}}) → null 则 throw NotFoundException('知识库不存在')
       c. 获取已完成文档ID: documentRepository.find({where:{kbId,status:'completed'},select:['id']}) → Set<number>
       d. 若空集 → log('知识库无已完成文档') → return {results:[],total:0,took:0}
       e. queryVector = await embeddingService.embedQuery(query)  记录 embeddingMs
       f. resolvedTopK = topK ?? configService.getOrThrow('retrieval.topK')
          resolvedThreshold = scoreThreshold ?? configService.getOrThrow('retrieval.scoreThreshold')
       g. rawResults = await vectorStoreService.search(queryVector, kbId, resolvedTopK, resolvedThreshold)  记录 searchMs
       h. 过滤: 只保留 payload.documentId ∈ validDocIds 的结果；被过滤的 warn 日志
       i. 逐条校验 payload 字段类型(isValidPayload)，无效的跳过 + warn
       j. 映射为 RetrievalResult[]
       k. log: '检索完成：kbId=...,query="...",resultCount=...,embeddingTook=...ms,searchTook=...ms,took=...ms'
       l. return { results, total: results.length, took: totalMs }
   - retrieval.controller.ts: @Controller('knowledge-bases/:id/retrieve') @ApiTags('retrieval')
     · @Post() async retrieve(@Param('id',ParseIntPipe) id, @Body() dto: RetrievalRequestDto): Promise<RetrievalResponseData>
     · try { return await retrievalService.search(...) }
       catch (error) { if (error instanceof EmbeddingFailure) throw new BadGatewayException('检索服务暂时不可用：向量生成失败'); throw error; }
   - retrieval.module.ts: imports[TypeOrmModule.forFeature([KnowledgeBase,Document]), EmbeddingModule, VectorStoreModule], providers=[RetrievalService], controllers=[RetrievalController], exports=[RetrievalService]

7. app.module.ts: imports 加 RetrievalModule

8. 回填 00-overall-plan.md v1.8

## 不做的事
- 不做 LLM/Prompt/RAG回答/SSE/Conversation/Message/引用落库/Rerank/前端
- 不做新 migration/新表/改实体/改 web/
- 不引入 langchain/测试框架
- 不修改 processing/parsing/chunking 模块下任何文件
- 不修改 KnowledgeBaseService/DocumentService/EmbeddingClient/EmbeddingModule/VectorStoreModule
- 不修改全局异常过滤器/main.ts/docker-compose.yml/ResponseInterceptor
- 不修改任何文档的 status 字段（检索是只读操作）

## 验收（QDRANT_MOCK=true + EMBEDDING_MOCK=true）
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- 基础检索: 同文本 query → score=1.0, results包含完整字段
- topK=1 → results.length<=1
- scoreThreshold=0.99 + 不同文本 → results=[]
- 空查询 → 400
- 不存在的KB → 404
- 空知识库 → results=[]
- 删除文档后检索 → results=[]
- Swagger 包含 retrieve 路径
- SHOW TABLES 无新表
- rg 范围扫描: 无 LLM/Chat/SSE/Rerank/conversation 命中
- 清理: 业务表回0行
```
