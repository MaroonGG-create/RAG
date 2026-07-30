# T08 Qdrant 向量存储 — Codex 执行指令

> 任务编号：T08（阶段 P6 后半：Qdrant Collection 管理与向量写入）
> 前置条件：T07 已完成（结论：**通过**，见 `docs/reports/task-07-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.6 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T07 后快照）+ `docs/reports/task-07-completion.md`（T07 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T07 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**。status 枚举已含 `embedding`/`completed`/`failed`；`chunkCount`/`fileName`/`kbId` 已就绪 |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | 直接复用，**禁止修改**。`qdrantPointId`（CHAR(36) uuid v4）已就绪 |
| `EmbeddingService` | `src/modules/embedding/embedding.service.ts` | **不修改**。T08 调用 `embedDocument(documentId)` 获取 `EmbeddingResult`（含 `chunks: EmbeddedChunk[]`） |
| `EmbeddedChunk` 类型 | `src/modules/embedding/embedding.types.ts` | **不修改**。字段：`chunkId`/`chunkIndex`/`qdrantPointId`/`content`/`charCount`/`pageNo`/`kbId`/`documentId`/`vector` |
| `EmbeddingModule` | `src/modules/embedding/embedding.module.ts` | **不修改**。已导出 `EmbeddingService` |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `qdrant` 配置段（§四） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：`QDRANT_URL` 已有校验；追加 `QDRANT_COLLECTION`/`QDRANT_UPSERT_BATCH_SIZE`/`QDRANT_MOCK`（§四） |
| `AppModule` | `src/app.module.ts` | **允许修改**：imports 追加 `VectorStoreModule` |
| `DocumentService` | `src/modules/document/document.service.ts` | **允许修改**：`remove()` 方法在 MySQL 事务前注入向量清理（§十四） |
| `KnowledgeBaseService` | `src/modules/knowledge-base/knowledge-base.service.ts` | **允许修改**：`remove()` 方法在 MySQL 删除前注入向量清理（§十四） |
| `DocumentModule` | `src/modules/document/document.module.ts` | **允许修改**：imports 追加 `VectorStoreModule` |
| `KnowledgeBaseModule` | `src/modules/knowledge-base/knowledge-base.module.ts` | **允许修改**：imports 追加 `VectorStoreModule` |
| migration 体系 | 2 条既有 migration | **本任务零 migration、零 schema 变更** |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | **不修改**（手动触发走 CLI） |
| CLI 脚本模式 | `src/scripts/parse-document.ts` / `chunk-document.ts` / `embed-document.ts` | T08 CLI 遵循同一模式：`NestFactory.createApplicationContext` + 服务调用 + JSON stdout |
| Docker Compose Qdrant | `qdrant/qdrant:v1.12.4`，端口 6333(REST)/6334(gRPC) | 无鉴权（仅本地）；`QDRANT_URL=http://localhost:6333` |
| `QDRANT_URL` 环境变量 | `env.validation.ts` 已有 `@IsUrl` 校验；`.env.example` 已有默认值 | T08 首次建立 Qdrant 连接 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T07 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05/T06/T07），否则 DB 读写与验收 SQL 都会打到错误实例。
2. **Docker daemon 可能无法启动**：T05-T07 验收期间 Docker daemon 多次不可用。T08 首次需要连接 Qdrant，若 Docker 不可用则使用 `QDRANT_MOCK=true` 完成 Mock 验收（§十三）。
3. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。
4. `parsing` 崩溃残留仍需启动恢复机制处理；T08 覆盖 `embedding` 状态的首次写入和失败重试。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `vector-store` 模块，接收 T07 的 Embedding 结果，将向量写入 Qdrant，完成文档处理流水线的最后一步：

- **Collection 管理**：启动时检查或创建 `rag_chunks` Collection，校验向量维度和距离算法，创建 payload 索引；
- **接收 Embedding 结果**：调用 `EmbeddingService.embedDocument(documentId)` 获取 `EmbeddingResult`（含 `EmbeddedChunk[]`）；
- **批量 upsert 向量**：按 `QDRANT_UPSERT_BATCH_SIZE` 分批 upsert，point id 使用 `DocumentChunk.qdrantPointId`；
- **payload 组装**：保存 `chunkId`/`knowledgeBaseId`/`documentId`/`documentName`/`chunkIndex`/`pageNo`/`content`；
- **写入数量校验**：upsert 后按 `documentId` 过滤 count，校验与 chunk 数量一致；
- **状态流转**：`embedding → completed`（成功）/ `embedding → failed`（失败 + errorMessage）；
- **写入失败补偿**：清理当前文档已写入的向量，置 `failed`；
- **幂等策略**：重试时先删除当前文档旧向量再 upsert，保证幂等；
- **按 documentId 删除向量**：文档删除时复用；
- **按 knowledgeBaseId 删除向量**：知识库删除时复用；
- **并发控制**：同一文档并发执行用 in-flight Map 去重（同 T05/T06/T07 模式）；
- **Mock 模式**：`QDRANT_MOCK=true` 时用内存 Map 模拟 Qdrant，支持无 Docker 环境下的完整验收；
- **手动触发**：CLI 脚本 `pnpm --filter server store:document <id>`；
- **日志和异常处理**；
- **集成文档/知识库删除的向量清理**。

### 2.2 非目标（本阶段一律不做）

向量检索（TopK/search/scoreThreshold）、LLM、Chat、SSE、Rerank、前端页面、消息队列、定时任务、上传后自动触发流水线、启动恢复钩子、OCR、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 embedding 模块下任何文件、修改 parsing/chunking 子目录下任何文件。

**禁止模拟处理**：不允许假向量写入（Mock 模式除外，Mock 须显式开启）、不允许跳过 Embedding 调用。

---

## 三、模块与文件设计

### 3.1 新增文件（server/，5 个）

| 文件 | 职责 |
|---|---|
| `src/modules/vector-store/vector-store.module.ts` | NestJS 模块：`TypeOrmModule.forFeature([Document])`，imports `EmbeddingModule`，providers 注册 `QdrantClientWrapper` + `VectorStoreService`，exports 导出 `VectorStoreService` |
| `src/modules/vector-store/qdrant-client-wrapper.ts` | Qdrant 客户端封装：包装 `@qdrant/js-client-rest` 的 `QdrantClient`；提供 `collectionExists`/`getCollection`/`createCollection`/`createFieldIndex`/`upsertPoints`/`deleteByFilter`/`countPoints` 方法；Mock 分支用内存 Map 模拟；**不依赖任何 DB Repository**，仅依赖 `ConfigService` |
| `src/modules/vector-store/vector-store.service.ts` | 编排服务：`OnModuleInit` → `ensureCollection()`；`storeDocument(documentId)` 编排 embed → delete old → upsert → verify → complete；`deleteByDocumentId`/`deleteByKnowledgeBaseId`；状态流转；in-flight 去重；失败处理 |
| `src/modules/vector-store/vector-store.types.ts` | 类型定义：`QdrantPoint`/`StoreResult`/`VectorStoreFailure` |
| `src/scripts/store-document.ts` | CLI 手动触发（§十五） |

### 3.2 修改文件（server/ 6 个 + 根 2 个 + docs 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/config/configuration.ts` | 追加 `qdrant` 配置段（§四） |
| `src/config/env.validation.ts` | 追加 `QDRANT_COLLECTION`/`QDRANT_UPSERT_BATCH_SIZE`/`QDRANT_MOCK` 校验（§四） |
| `src/app.module.ts` | imports 追加 `VectorStoreModule` |
| `server/package.json` | dependencies 加 `@qdrant/js-client-rest@1.12.0`；scripts 加 `"store:document": "ts-node src/scripts/store-document.ts"` |
| `src/modules/document/document.module.ts` | imports 追加 `VectorStoreModule`（为 `DocumentService` 注入 `VectorStoreService`） |
| `src/modules/knowledge-base/knowledge-base.module.ts` | imports 追加 `VectorStoreModule`（为 `KnowledgeBaseService` 注入 `VectorStoreService`） |
| `src/modules/document/document.service.ts` | `remove()` 方法在 MySQL 事务前调用 `vectorStoreService.deleteByDocumentId(id)`（§十四） |
| `src/modules/knowledge-base/knowledge-base.service.ts` | `remove()` 方法在 MySQL 删除前调用 `vectorStoreService.deleteByKnowledgeBaseId(id)`（§十四） |
| `.env.example` | 追加 `QDRANT_COLLECTION`/`QDRANT_UPSERT_BATCH_SIZE`/`QDRANT_MOCK`（§四） |
| `docs/00-overall-plan.md` | §十六 v1.7 回填（§十六） |

**禁止改动**：`web/` 任何文件、全部实体定义、既有 migration、main.ts、过滤器、`docker-compose.yml`、processing 模块下任何文件、embedding 模块下任何文件、parsing/chunking 子目录下任何文件。

> 规模判断：一个 Qdrant 客户端封装 + 一个编排服务 + 一个类型文件即可，**不建** vector-store registry / strategy pattern / provider factory——与 T05/T06/T07「不过度细分」一致。

---

## 四、配置和环境变量（冻结级）

### 4.1 环境变量清单

| 变量 | 默认值 | 校验 | 说明 |
|---|---:|---|---|
| `QDRANT_URL` | `http://localhost:6333` | `@IsUrl`（已有） | Qdrant REST 地址；Mock 模式下不使用但仍须提供 |
| `QDRANT_COLLECTION` | `rag_chunks` | `@IsDefined @IsString @IsNotEmpty` | Collection 名（总体方案 §6 冻结） |
| `QDRANT_UPSERT_BATCH_SIZE` | 100 | `@IsDefined @IsInt @Min(1) @Max(1000)` | 每批 upsert 的 point 数 |
| `QDRANT_MOCK` | false | `@IsOptional @IsBoolean` | Mock 模式开关；true 时跳过 Qdrant HTTP 调用，用内存 Map 模拟 |

### 4.2 configuration.ts 追加

```ts
qdrant: {
  url: string;
  collection: string;
  upsertBatchSize: number;
  mock: boolean;
};
```

读取逻辑：

```ts
qdrant: {
  url: process.env.QDRANT_URL ?? '',
  collection: process.env.QDRANT_COLLECTION ?? 'rag_chunks',
  upsertBatchSize: Number(process.env.QDRANT_UPSERT_BATCH_SIZE ?? 100),
  mock: process.env.QDRANT_MOCK === 'true',
},
```

并在 `AppConfiguration` 接口追加对应类型。

### 4.3 env.validation.ts 追加

```ts
@IsDefined()
@IsString()
@IsNotEmpty()
QDRANT_COLLECTION!: string;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(1000)
QDRANT_UPSERT_BATCH_SIZE!: number;

// 可选布尔，不强制 @IsDefined
@IsOptional()
@Type(() => Boolean)
@IsBoolean()
QDRANT_MOCK?: boolean;
```

> `QDRANT_URL` 已有 `@IsUrl` 校验，不重复。

### 4.4 .env.example 追加

```env
# Qdrant（T08 首次建立连接）
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=rag_chunks
QDRANT_UPSERT_BATCH_SIZE=100
QDRANT_MOCK=false
```

同时更新原有注释：`# Qdrant（T02 起由后端校验地址，T08 开始建立连接）`。

---

## 五、Qdrant 客户端选型（冻结级，设计问题 1）

### 5.1 决策：使用官方 `@qdrant/js-client-rest@1.12.0`

**否决方案与理由**：

| 方案 | 否决理由 |
|---|---|
| Node 20 内置 `fetch` 手写 | Qdrant REST API 涉及 collection 管理、payload 索引、upsert、filter delete、count 等多端点，手写需 ~200 行样板代码，且需自行处理 Qdrant 特有的错误响应格式；面试讲解时「为什么不用官方客户端」反而更难解释 |
| `@qdrant/js-client-rest` 最新 1.18.0 | 未经验证；总体方案锁定 1.12.x 与 Qdrant Server v1.12.4 对齐 |

**选择 `@qdrant/js-client-rest@1.12.0` 的理由**：

1. **总体方案已冻结**：§3.2 明确列出 `@qdrant/js-client-rest ^1.12`；
2. **CJS 兼容**：包 `"type": "module"` 但提供 `"main": "./dist/cjs/index.js"` CJS 入口，Node 20 + NestJS 10 CJS 项目可直接 `require` / `import`；
3. **Node ≥18**：`engines.node >= 18.0.0`，与 Node 20 LTS 匹配；
4. **类型安全**：内置 TypeScript 类型定义，请求/响应均有类型；
5. **API 完备**：`collectionExists`/`createCollection`/`createFieldIndex`/`upsert`/`delete`/`count` 全部就绪；
6. **面试可讲**：「Qdrant REST API 复杂度高于 Embedding API，官方客户端封装了 OpenAPI 生成的类型化调用，减少样板代码和错误处理负担」。

### 5.2 QdrantClientWrapper 设计

```ts
import { QdrantClient } from '@qdrant/js-client-rest';

@Injectable()
export class QdrantClientWrapper implements OnModuleInit {
  private client: QdrantClient | null = null;
  private readonly mockStore = new Map<string, { vector: number[]; payload: Record<string, unknown> }>();
  private readonly mock: boolean;
  private readonly url: string;
  private readonly collection: string;

  constructor(configService: ConfigService) {
    // 读取 qdrant.url / qdrant.collection / qdrant.mock
  }

  onModuleInit(): void {
    if (!this.mock) {
      this.client = new QdrantClient({ url: this.url });
    }
  }

  // 以下方法均含 Mock 分支：
  async collectionExists(): Promise<boolean>;
  async getCollection(): Promise<{ vectors: { size: number; distance: string } }>;
  async createCollection(size: number, distance: 'Cosine'): Promise<void>;
  async createFieldIndex(fieldName: string, fieldSchema: 'integer'): Promise<void>;
  async upsertPoints(points: QdrantPoint[]): Promise<void>;
  async deleteByFilter(filter: Record<string, unknown>): Promise<void>;
  async countPoints(filter?: Record<string, unknown>): Promise<number>;
}
```

### 5.3 关键 API 方法映射

| QdrantClientWrapper 方法 | `@qdrant/js-client-rest` 方法 | 说明 |
|---|---|---|
| `collectionExists()` | `client.collectionExists(collectionName)` | 返回 `{ exists: boolean }` |
| `getCollection()` | `client.getCollection(collectionName)` | 返回含 `result.config.params.vectors.size/distance` |
| `createCollection(size, distance)` | `client.createCollection(collectionName, { vectors: { size, distance } })` | 创建 collection |
| `createFieldIndex(field, schema)` | `client.createFieldIndex(collectionName, { field_name: field, field_schema: schema })` | 创建 payload 索引 |
| `upsertPoints(points)` | `client.upsert(collectionName, { points, wait: true })` | 批量 upsert，`wait: true` 确保写入完成 |
| `deleteByFilter(filter)` | `client.delete(collectionName, { filter, wait: true })` | 按过滤条件删除 |
| `countPoints(filter)` | `client.count(collectionName, { filter, exact: true })` | 返回 `{ count: number }` |

### 5.4 兼容性说明

- `@qdrant/js-client-rest@1.12.0` 依赖 `undici ~5.28.4`（Node 20 内置 undici 的独立版本），不与 Node 内置 fetch 冲突；
- `tsconfig.json` 的 `module: commonjs` + `esModuleInterop: true` 可正确加载 CJS 入口；
- `pnpm install` 后 `node_modules/@qdrant/js-client-rest/dist/cjs/index.js` 可直接 `require`。

---

## 六、Collection 自举与维度校验（冻结级，设计问题 2+3+4）

### 6.1 启动时自举流程（OnModuleInit）

```
VectorStoreService.onModuleInit()
  → ensureCollection()

ensureCollection():
  1. exists = await qdrantClientWrapper.collectionExists()
  2. if (!exists):
     a. createCollection(EMBEDDING_DIMENSION, 'Cosine')
     b. createFieldIndex('knowledgeBaseId', 'integer')
     c. createFieldIndex('documentId', 'integer')
     d. logger.log('Collection {collection} 已创建：dimension={dim}, distance=Cosine')
  3. if (exists):
     a. info = await qdrantClientWrapper.getCollection()
     b. actualDim = info.vectors.size
     c. expectedDim = EMBEDDING_DIMENSION
     d. if (actualDim !== expectedDim):
        throw Error(`Qdrant Collection 维度不匹配：expected=${expectedDim}, actual=${actualDim}。请删除 Collection 重建或修改 EMBEDDING_DIMENSION 配置。`)
     e. actualDistance = info.vectors.distance
     f. if (actualDistance !== 'Cosine'):
        throw Error(`Qdrant Collection 距离算法不匹配：expected=Cosine, actual=${actualDistance}。`)
     g. logger.log('Collection {collection} 已存在且维度匹配：dimension={dim}, distance=Cosine')
```

### 6.2 维度一致性校验（设计问题 2）

**`EMBEDDING_DIMENSION` 与 Collection 维度必须一致。**

- Collection 不存在 → 按 `EMBEDDING_DIMENSION` 创建；
- Collection 已存在 → 校验 `config.params.vectors.size === EMBEDDING_DIMENSION`；
- 不一致 → **fail-fast**：抛错阻止应用启动，错误信息包含 expected/actual 维度和修复指引。

**理由**（总体方案 §6 + §15 风险 2）：

> 更换 Embedding 模型导致维度与已建 collection 不匹配 → 检索静默失效或报错。启动时强校验并 fail-fast，README 写明重建步骤。

### 6.3 Cosine 距离算法（设计问题 3）

**冻结决策：`Distance.Cosine`。**

- 创建 Collection 时 `distance: 'Cosine'`；
- 已存在 Collection 校验 `distance === 'Cosine'`，不匹配则 fail-fast；
- T07 Mock 向量已做 L2 归一化，与 Cosine 距离兼容；
- 理由：文本语义检索的标准做法；总体方案 §6 已冻结。

### 6.4 fail-fast 行为

| 场景 | 行为 |
|---|---|
| Qdrant 不可达 | `onModuleInit` 抛错 → NestJS 启动失败 → 日志含连接错误 |
| Collection 维度不匹配 | `onModuleInit` 抛错 → 启动失败 → 错误信息含 expected/actual |
| Collection 距离不匹配 | `onModuleInit` 抛错 → 启动失败 → 错误信息含 expected/actual |
| Mock 模式 | 跳过所有 Qdrant HTTP 调用，`ensureCollection` 为 no-op |

> **注意**：`onModuleInit` 在 NestJS 启动时同步执行。若 Qdrant 不可达，整个后端无法启动——这是刻意行为，防止在无向量库的情况下接受请求。

---

## 七、Payload 类型和索引（冻结级，设计问题 5）

### 7.1 Payload 结构（总体方案 §6 冻结）

```json
{
  "chunkId": 123,
  "knowledgeBaseId": 1,
  "documentId": 45,
  "documentName": "产品手册.pdf",
  "chunkIndex": 3,
  "pageNo": 12,
  "content": "切片原文（冗余存储，检索后直接组装上下文）"
}
```

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `chunkId` | integer | `EmbeddedChunk.chunkId` | `document_chunk.id` |
| `knowledgeBaseId` | integer | `EmbeddedChunk.kbId` | 知识库 ID，检索过滤用 |
| `documentId` | integer | `EmbeddedChunk.documentId` | 文档 ID，删除/过滤用 |
| `documentName` | string | `Document.fileName` | 文档名快照，引用展示用 |
| `chunkIndex` | integer | `EmbeddedChunk.chunkIndex` | 文档内序号 |
| `pageNo` | integer / null | `EmbeddedChunk.pageNo` | PDF 页码；MD/TXT 为 null |
| `content` | string | `EmbeddedChunk.content` | 切片原文冗余，检索后直接组装上下文 |

### 7.2 Payload 索引

| 字段 | 索引类型 | 用途 |
|---|---|---|
| `knowledgeBaseId` | integer | 按 knowledgeBaseId 过滤检索（§4.2 问答流水线核心过滤条件） |
| `documentId` | integer | 按 documentId 删除向量、文档级追问过滤 |

**创建方式**：`createFieldIndex(collectionName, { field_name, field_schema: 'integer' })`。

**幂等性**：Qdrant `createFieldIndex` 对已存在的索引返回 409，Wrapper 中 catch 并忽略（不视为错误）。

### 7.3 QdrantPoint 类型

```ts
interface QdrantPoint {
  id: string;                       // EmbeddedChunk.qdrantPointId（uuid v4）
  vector: number[];                 // EmbeddedChunk.vector
  payload: {
    chunkId: number;
    knowledgeBaseId: number;
    documentId: number;
    documentName: string;
    chunkIndex: number;
    pageNo: number | null;
    content: string;
  };
}
```

---

## 八、向量 Upsert 流程（冻结级，设计问题 6+7）

### 8.1 T07 与 T08 的调用边界（设计问题 7）

**核心设计：T08 的 `VectorStoreService.storeDocument(documentId)` 调用 T07 的 `EmbeddingService.embedDocument(documentId)` 获取 `EmbeddingResult`，在同一进程内传递向量，然后写入 Qdrant。**

```
T08 storeDocument(documentId):
  1. result = await embeddingService.embedDocument(documentId)
     // 内部：chunking/failed/embedding → embedding，返回 EmbeddingResult（含向量）
  2. document = await docRepo.findOne({ id: documentId })
     // 获取 fileName 用于 payload
  3. await this.deleteByDocumentId(documentId)
     // 幂等：先删旧向量（设计问题 8）
  4. await this.upsertChunks(result.chunks, document.fileName)
     // 批量 upsert 新向量
  5. await this.verifyUpsert(documentId, result.chunks.length)
     // count 校验
  6. await docRepo.update(documentId, { status: 'completed', errorMessage: null })
```

- **向量不落盘到 MySQL**：向量从 `embedDocument()` 返回后直接传入 Qdrant upsert，全程在内存中流转；
- **T08 重跑时重新嵌入**：如果 T08 失败后重试，会再次调用 `embedDocument()` 重新获取向量——这是「不持久化向量」的代价（同 T07 设计），MVP 可接受。

### 8.2 Upsert 批次划分

```
chunks = EmbeddingResult.chunks  // 已按 chunkIndex ASC 排列
batches = chunkArray(chunks, QDRANT_UPSERT_BATCH_SIZE)
```

- **顺序保证**：按 `chunkIndex` 升序（T07 已保证）；
- **批次大小**：每批 `QDRANT_UPSERT_BATCH_SIZE`（默认 100），最后一批可能不足；
- **串行执行**：批次之间串行（不并行），与 T07 一致，避免大批量并发请求压垮 Qdrant；
- **`wait: true`**：每批 upsert 使用 `wait: true`，确保 Qdrant 完成写入后才返回。

### 8.3 Upsert 流程

```ts
async upsertChunks(chunks: EmbeddedChunk[], documentName: string): Promise<void> {
  const points = chunks.map(chunk => ({
    id: chunk.qdrantPointId,
    vector: chunk.vector,
    payload: {
      chunkId: chunk.chunkId,
      knowledgeBaseId: chunk.kbId,
      documentId: chunk.documentId,
      documentName,
      chunkIndex: chunk.chunkIndex,
      pageNo: chunk.pageNo,
      content: chunk.content,
    },
  }));

  const batches = this.createBatches(points);
  for (const [index, batch] of batches.entries()) {
    await this.qdrantClient.upsertPoints(batch);
    logger.debug(`Upsert 批次 ${index + 1}/${batches.length} 完成：${batch.length} 条`);
  }
}
```

### 8.4 写入数量校验

```ts
async verifyUpsert(documentId: number, expectedCount: number): Promise<void> {
  const filter = { must: [{ key: 'documentId', match: { value: documentId } }] };
  const actualCount = await this.qdrantClient.countPoints(filter);
  if (actualCount !== expectedCount) {
    throw new VectorStoreFailure(
      `向量写入数量不一致：expected=${expectedCount}, actual=${actualCount}`
    );
  }
}
```

- 使用 `wait: true` upsert 后 count 应立即可见；
- 数量不一致说明写入异常，触发失败处理。

---

## 九、向量删除能力（冻结级，设计问题 9）

### 9.1 按 documentId 删除

```ts
async deleteByDocumentId(documentId: number): Promise<void> {
  const filter = {
    must: [{ key: 'documentId', match: { value: documentId } }]
  };
  await this.qdrantClient.deleteByFilter(filter);
}
```

**使用场景**：
1. T08 重试前清理旧向量（幂等）；
2. T08 写入失败后清理半成品向量（补偿）；
3. 文档删除时清理 Qdrant 向量（§十四）。

### 9.2 按 knowledgeBaseId 删除

```ts
async deleteByKnowledgeBaseId(kbId: number): Promise<void> {
  const filter = {
    must: [{ key: 'knowledgeBaseId', match: { value: kbId } }]
  };
  await this.qdrantClient.deleteByFilter(filter);
}
```

**使用场景**：
1. 知识库删除时清理 Qdrant 向量（§十四）。

### 9.3 幂等性

Qdrant `delete` by filter 是幂等的：删除不存在的 point 不会报错，返回 `status: 'completed'`。因此重试时重复调用 `deleteByDocumentId` 是安全的。

---

## 十、状态流转与并发控制（冻结级，设计问题 8）

### 10.1 状态机（本阶段仅允许这些边）

```
                        触发 storeDocument(id)
embedding  ────────────────────────────► completed   （成功：向量已写入 Qdrant）
failed     ────────────────────────────► embedding ──成功──► completed   （重试：先 embed 再 upsert）
embedding  ────────────────────────────► embedding ──失败──► failed       （重跑：errorMessage=中文摘要）
completed  ────────────────────────────► 拒绝                        （文档已完成向量写入，禁止重复存储）
```

**成功置 `completed` 的理由**：

- 总体方案 §4.1 ⑩ 规定 upsert Qdrant 后 `document.status=completed`；
- `completed` 是文档处理流水线的终态，表示「已解析 → 已切片 → 已向量化 → 已写入 Qdrant」；
- T09+ 向量检索可据此判断文档是否可检索。

**防御性拒绝**：触发时若 status 为 `completed`，抛 `VectorStoreFailure('文档已完成向量写入，禁止重复存储')`。

**允许的状态**：`embedding`（首次/重跑）、`failed`（重试）。

### 10.2 主流程（VectorStoreService.storeDocument）

```
1. in-flight 去重检查（§10.3）
2. docRepo.findOne({ id }) → null → throw NotFoundException('文档不存在')
3. status 防御性检查（§10.1）
4. try:
   a. result = await embeddingService.embedDocument(documentId)
      // T07 内部会设置 status=embedding；若 embed 失败 T07 已置 failed 并抛错
   b. document = await docRepo.findOne({ id: documentId })
      // 刷新获取 fileName
   c. await this.deleteByDocumentId(documentId)
      // 幂等清理旧向量
   d. await this.upsertChunks(result.chunks, document.fileName)
      // 批量 upsert
   e. await this.verifyUpsert(documentId, result.totalChunks)
      // count 校验
   f. await docRepo.update(documentId, { status: 'completed', errorMessage: null })
   g. logger.log 成功摘要
   h. return { documentId, chunkCount, vectorCount, collectionName }

5. catch (error: unknown):
   a. 尝试清理：await this.deleteByDocumentId(documentId)  // 清理半成品向量
      catch cleanupError → logger.warn（清理失败不影响主错误抛出）
   b. 尝试更新状态：await docRepo.update(documentId, { status: 'failed', errorMessage: 摘要 })
      catch updateError → logger.warn
   c. logger.error 失败摘要
   d. throw new VectorStoreFailure(摘要)
```

**关键区别**：
- T05/T06 失败时清理 `.parsed` 文件或 `document_chunk` 行；
- T07 失败时不清理任何数据（向量在内存中）；
- **T08 失败时清理 Qdrant 中已写入的向量**（因为向量已持久化到 Qdrant，半成品需要清除）。

### 10.3 并发控制（in-flight 去重）

```ts
private readonly inFlight = new Map<number, Promise<StoreResult>>();

async storeDocument(documentId: number): Promise<StoreResult> {
  const existing = this.inFlight.get(documentId);
  if (existing !== undefined) return existing;

  const task = this.executeStoreDocument(documentId).finally(() => {
    this.inFlight.delete(documentId);
  });
  this.inFlight.set(documentId, task);
  return task;
}
```

- 同一 documentId 并发触发时复用同一 Promise（同 T05/T06/T07 模式）；
- 不同 documentId 之间不做串行限制。

### 10.4 幂等语义

| 场景 | 行为 |
|---|---|
| **首次写入**（status=embedding） | embed → delete old（无旧向量，no-op）→ upsert → verify → completed |
| **重跑已写入**（status=completed） | 拒绝：`文档已完成向量写入，禁止重复存储` |
| **失败重试**（status=failed） | embed → delete old（清理上次半成品）→ upsert → verify → completed |
| **重跑 embedding 状态**（status=embedding） | embed → delete old（清理可能的上次半成品）→ upsert → verify → completed |

**幂等的本质**：每次 `storeDocument` 都先 `deleteByDocumentId` 再 upsert，保证 Qdrant 中不会残留旧 point。Qdrant upsert 本身也按 point id 幂等（同 id 覆盖），但先 delete 更安全——若 chunk 数量变化（重新切片后），旧 point 不会被覆盖残留。

---

## 十一、写入失败的补偿和重试（冻结级，设计问题 8）

### 11.1 失败处理矩阵

| 失败位置 | errorMessage 内容 | 清理动作 | 状态 |
|---|---|---|---|
| Embedding 失败（T07 抛错） | T07 已设置 failed + errorMessage | T08 catch 中 `deleteByDocumentId`（无向量写入，no-op） | T08 尝试更新 failed（可能与 T07 的更新重复，无害） |
| Qdrant 不可达（upsert 抛错） | `Qdrant 连接失败：{简要原因}` | `deleteByDocumentId`（可能有部分批次已写入） | failed |
| Upsert 数量校验失败 | `向量写入数量不一致：expected={n}, actual={m}` | `deleteByDocumentId` | failed |
| Collection 不存在（ensureCollection 未执行） | `Collection {name} 不存在或未初始化` | 无 | failed |
| Mock 模式下不应失败 | — | — | — |

### 11.2 errorMessage 安全规则

**允许写入 `document.error_message`**：

- 中文错误摘要，≤ 300 字符；
- 错误类型标签（如 `Qdrant 连接失败`、`向量写入数量不一致`）；
- 数量信息（如 `expected=53, actual=50`）。

**禁止写入 `document.error_message`**：

- Qdrant URL（含可能的认证信息）；
- 向量数据；
- 完整 Qdrant 响应体；
- 堆栈跟踪。

### 11.3 重试流程

```
重试（status=failed 的文档）:
  1. storeDocument(documentId)
  2. → embeddingService.embedDocument(documentId)
     // T07 重新嵌入（复用既有 chunk，不重新切片）
  3. → deleteByDocumentId(documentId)
     // 清理上次可能残留的向量
  4. → upsertChunks（重新写入全部向量）
  5. → verifyUpsert（校验数量）
  6. → status=completed
```

- 重试不需要重新上传文件、重新解析或重新切片；
- T07 的 `embedDocument` 对 `failed` 状态文档允许重试（T07 §11.1）；
- T08 的 `storeDocument` 对 `failed` 状态文档允许重试（§10.1）。

---

## 十二、与 T07 的调用边界（冻结级，设计问题 7）

### 12.1 T07 → T08 数据流

```
T08 VectorStoreService.storeDocument(documentId)
  │
  ├─► EmbeddingService.embedDocument(documentId)   [T07]
  │     │
  │     ├─ 读取 DocumentChunk（按 chunkIndex ASC）
  │     ├─ 分批调用 EmbeddingClient.embed()
  │     ├─ 校验向量数量/顺序/维度
  │     └─ 返回 EmbeddingResult { chunks: EmbeddedChunk[], ... }
  │            每个 EmbeddedChunk 含 { chunkId, qdrantPointId, vector, content, ... }
  │
  ├─► deleteByDocumentId(documentId)                [T08]
  │     清理旧向量（幂等）
  │
  ├─► upsertChunks(result.chunks, document.fileName) [T08]
  │     组装 QdrantPoint[] → 批量 upsert
  │
  ├─► verifyUpsert(documentId, result.totalChunks)  [T08]
  │     count 校验
  │
  └─► docRepo.update(documentId, { status: 'completed' })
```

### 12.2 模块依赖关系

```
AppModule
  ├─ EmbeddingModule（T07，exports EmbeddingService）
  ├─ VectorStoreModule（T08）
  │    imports: EmbeddingModule, TypeOrmModule.forFeature([Document])
  │    providers: QdrantClientWrapper, VectorStoreService
  │    exports: VectorStoreService
  ├─ DocumentModule（T04）
  │    imports: VectorStoreModule  ← T08 新增（为 DocumentService.remove 注入向量清理）
  └─ KnowledgeBaseModule（T03）
       imports: VectorStoreModule  ← T08 新增（为 KnowledgeBaseService.remove 注入向量清理）
```

**无循环依赖**：
- `DocumentModule` → `VectorStoreModule` → `EmbeddingModule`（线性）
- `KnowledgeBaseModule` → `VectorStoreModule` → `EmbeddingModule`（线性）
- `EmbeddingModule` 不依赖 `VectorStoreModule` 或 `DocumentModule`

### 12.3 T08 不修改 T07 的任何文件

- `EmbeddingService` / `EmbeddingClient` / `embedding.types.ts` / `embedding.module.ts`：**全部只读**；
- T08 通过 `EmbeddingModule` 导出的 `EmbeddingService` 调用 `embedDocument()`，不侵入 T07 实现。

---

## 十三、Mock 模式（冻结级，设计问题 10）

### 13.1 设计目标

在 Docker daemon 无法启动或 Qdrant 不可用时，通过 `QDRANT_MOCK=true` 开启 Mock 模式，用内存 Map 模拟 Qdrant 全部操作，使 T08 全流程可验收。

### 13.2 Mock 实现

```ts
// QdrantClientWrapper 内部
private readonly mockStore = new Map<string, { vector: number[]; payload: Record<string, unknown> }>();
private mockCollectionExists = false;
private mockCollectionConfig = { size: 0, distance: 'Cosine' };

// Mock 分支示例
async collectionExists(): Promise<boolean> {
  if (this.mock) return this.mockCollectionExists;
  // ... 真实 Qdrant 调用
}

async createCollection(size: number, distance: 'Cosine'): Promise<void> {
  if (this.mock) {
    this.mockCollectionExists = true;
    this.mockCollectionConfig = { size, distance };
    return;
  }
  // ... 真实 Qdrant 调用
}

async upsertPoints(points: QdrantPoint[]): Promise<void> {
  if (this.mock) {
    for (const point of points) {
      this.mockStore.set(point.id, { vector: point.vector, payload: point.payload });
    }
    return;
  }
  // ... 真实 Qdrant 调用
}

async deleteByFilter(filter: Record<string, unknown>): Promise<void> {
  if (this.mock) {
    // 解析 filter.must[0].key / match.value，删除匹配的 point
    const { key, value } = this.parseSimpleFilter(filter);
    for (const [id, point] of this.mockStore) {
      if (point.payload[key] === value) {
        this.mockStore.delete(id);
      }
    }
    return;
  }
  // ... 真实 Qdrant 调用
}

async countPoints(filter?: Record<string, unknown>): Promise<number> {
  if (this.mock) {
    if (filter === undefined) return this.mockStore.size;
    const { key, value } = this.parseSimpleFilter(filter);
    let count = 0;
    for (const point of this.mockStore.values()) {
      if (point.payload[key] === value) count++;
    }
    return count;
  }
  // ... 真实 Qdrant 调用
}
```

### 13.3 Mock 模式特性

| 特性 | 说明 |
|---|---|
| **内存存储** | `Map<string, { vector, payload }>` 模拟 Qdrant points |
| **Collection 自举** | `ensureCollection` 在 Mock 下为 no-op（首次 upsert 时自动"存在"） |
| **维度校验** | Mock 模式下跳过维度校验（Mock 不创建真实 Collection） |
| **upsert 幂等** | 同 point id 覆盖（Map 行为） |
| **delete by filter** | 支持 `documentId` 和 `knowledgeBaseId` 两种过滤 |
| **count** | 支持 filtered count |
| **进程内有效** | Mock 数据仅存在于进程内存，重启后丢失 |
| **日志标记** | Mock 模式下 logger 输出 `[MOCK]` 前缀 |

### 13.4 Mock 模式的限制

- Mock 不模拟 Qdrant 的并发控制、持久化、分片等高级特性；
- Mock 数据不跨进程共享；
- Mock 模式仅用于 T08 流程验收，不能用于 T09+ 检索质量验收（Mock 向量无语义相似性）；
- 切换 Mock ↔ 真实 Qdrant 时，Collection 维度须一致。

### 13.5 真实 Qdrant 验收（Docker 可用时）

```powershell
# 启动 Qdrant
docker compose up -d qdrant
# 验证健康
curl.exe http://localhost:6333/readyz
# 验证 Collection
curl.exe http://localhost:6333/collections/rag_chunks
```

---

## 十四、文档/知识库删除的向量清理集成（冻结级，设计问题 9）

### 14.1 文档删除集成

**修改 `DocumentService.remove(id)`**（当前已有 `// T08+ 将在 MySQL 事务前先清理 Qdrant 向量` 占位注释）：

```ts
async remove(id: number): Promise<void> {
  const document = await this.findDocumentEntity(id);

  // T08：先清理 Qdrant 向量（幂等）
  try {
    await this.vectorStoreService.deleteByDocumentId(id);
  } catch (error: unknown) {
    // 向量清理失败不阻止文档删除，仅记日志
    // 理由：MySQL 删除后 document_chunk 级联消失，Qdrant 中的孤儿向量可后续清理
    this.logger.warn(`文档向量清理失败（不阻止删除）：documentId=${id}，${this.getErrorMessage(error)}`);
  }

  // MySQL 事务（原有逻辑）
  try {
    await this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(Document, { id });
      if (deleteResult.affected === 0) {
        throw new NotFoundException('文档不存在');
      }
      await manager
        .createQueryBuilder()
        .update(KnowledgeBase)
        .set({ documentCount: () => 'GREATEST(document_count - 1, 0)' })
        .where('id = :knowledgeBaseId', { knowledgeBaseId: document.kbId })
        .execute();
    });
  } catch (error: unknown) {
    if (!(error instanceof NotFoundException)) {
      this.logger.error(`文档删除事务失败：documentId=${id}，${this.getErrorMessage(error)}`);
    }
    throw error;
  }

  await this.storageService.deleteByStoragePath(document.storagePath);
  await this.parsedResultStore.remove(id);
}
```

**设计决策**：
- 向量清理失败**不阻止**文档删除——总体方案 §5.7 规定"①失败则中止并返回错误，可重试（幂等）"，但 MVP 选择更宽松的策略：MySQL 删除后 chunk 级联消失，Qdrant 孤儿向量不影响功能，可后续提供清理脚本；
- 向量清理在 MySQL 事务**前**执行——先删 Qdrant 再删 MySQL，符合总体方案 §5.7 的"向量→库→磁盘"顺序。

**注入方式**：`DocumentService` 构造函数追加 `private readonly vectorStoreService: VectorStoreService`。`DocumentModule` imports 追加 `VectorStoreModule`。

### 14.2 知识库删除集成

**修改 `KnowledgeBaseService.remove(id)`**（当前已有 `// T08+ 将在此处先清理 Qdrant 向量再删 MySQL 数据` 占位注释）：

```ts
async remove(id: number): Promise<void> {
  await this.findOne(id);

  // T08：先清理 Qdrant 向量（按 knowledgeBaseId）
  try {
    await this.vectorStoreService.deleteByKnowledgeBaseId(id);
  } catch (error: unknown) {
    // 向量清理失败不阻止知识库删除，仅记日志
    this.logger.warn(`知识库向量清理失败（不阻止删除）：knowledgeBaseId=${id}，${this.getErrorMessage(error)}`);
  }

  await this.knowledgeBaseRepository.delete(id);
}
```

**注入方式**：`KnowledgeBaseService` 构造函数追加 `private readonly vectorStoreService: VectorStoreService`。`KnowledgeBaseModule` imports 追加 `VectorStoreModule`。

### 14.3 复用关系

| 调用方 | 调用方法 | 过滤条件 |
|---|---|---|
| `VectorStoreService.storeDocument`（重试幂等） | `deleteByDocumentId` | `documentId` |
| `VectorStoreService.storeDocument`（失败补偿） | `deleteByDocumentId` | `documentId` |
| `DocumentService.remove` | `deleteByDocumentId` | `documentId` |
| `KnowledgeBaseService.remove` | `deleteByKnowledgeBaseId` | `knowledgeBaseId` |

所有删除均通过 `VectorStoreService` 的两个公开方法，底层统一调用 `QdrantClientWrapper.deleteByFilter`。

---

## 十五、手动触发设计（冻结级）

**选型：CLI 脚本，不新增公开 HTTP 接口。** 理由同 T05/T06/T07：基线 §9 的 13 个接口为冻结级约定，本阶段无「触发向量写入」接口；T09+ 自动流水线复用同一 `VectorStoreService.storeDocument` 方法即可。

`src/scripts/store-document.ts`：

```ts
// 用法：pnpm --filter server store:document <documentId>
async function bootstrap(): Promise<void> {
  const documentId = parseDocumentId(process.argv[2]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(VectorStoreService).storeDocument(documentId);
    console.log(JSON.stringify({
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      vectorCount: result.vectorCount,
      collectionName: result.collectionName,
    }));
  } catch (error: unknown) {
    console.error(`向量写入失败：${error instanceof Error ? error.message : '未知错误'}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
```

`package.json` scripts 追加：`"store:document": "ts-node src/scripts/store-document.ts"`。

**CLI 输出说明**：

- 成功时 stdout 输出摘要 JSON：
  ```json
  {"documentId":6,"chunkCount":53,"vectorCount":53,"collectionName":"rag_chunks"}
  ```
- 失败时 stderr 输出中文错误摘要，退出码 1。

---

## 十六、基线回填（00-overall-plan.md v1.7，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 ⑩ 状态语义补充：T08 成功后 status=`completed` | T08 完成向量写入 Qdrant，是文档处理流水线的终态 |
| 2 | §7 模块划分补充：`vector-store` 模块**在 T08 创建** | 新增 `VectorStoreModule`（`src/modules/vector-store/`），含 `QdrantClientWrapper`（Qdrant 客户端封装）和 `VectorStoreService`（编排服务） |
| 3 | §12 Qdrant 环境变量**在 T08 实现** | 总体方案 §12 已列出 `QDRANT_URL`/`QDRANT_COLLECTION`；T08 补充 `QDRANT_UPSERT_BATCH_SIZE`/`QDRANT_MOCK` |
| 4 | §15 风险 3 更新：MySQL 与 Qdrant 双写一致性问题由 T08 覆盖 | T08 实现先删向量后删库的幂等顺序、失败补偿清理、重试先删旧再 upsert |
| 5 | §15 风险 5 更新：`embedding`/`completed` 状态的崩溃恢复由 T08 覆盖 | T08 支持从 `embedding`/`failed` 状态重触发；`completed` 防御性拒绝；`parsing` 崩溃残留仍需后续处理 |
| 6 | §3.2 `@qdrant/js-client-rest` 版本精确锁定为 `1.12.0` | 与 Qdrant Server v1.12.4 对齐；CJS 入口兼容 Node 20 + NestJS 10 |

---

## 十七、验收方式（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功（DB 端口冲突须先解决）。
> **Mock 模式验收**：以下验收命令在 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` 下执行，无需 Docker Qdrant 或真实 API。
> **真实 Qdrant 验收**：Docker 可用时使用 `QDRANT_MOCK=false` + `EMBEDDING_MOCK=true`。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → T05 解析 → T06 切片 → T07 嵌入
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t08-store-kb\"}"
# 上传 PDF、MD、TXT，记录各 ID
pnpm --filter server parse:document <PDF_ID>
pnpm --filter server parse:document <MD_ID>
pnpm --filter server parse:document <TXT_ID>
pnpm --filter server chunk:document <PDF_ID>
pnpm --filter server chunk:document <MD_ID>
pnpm --filter server chunk:document <TXT_ID>
pnpm --filter server embed:document <PDF_ID>
pnpm --filter server embed:document <MD_ID>
pnpm --filter server embed:document <TXT_ID>
# 确认 status=embedding, chunk_count>0

# 2. Mock 模式向量写入成功（三种格式）
$env:QDRANT_MOCK='true'
$env:EMBEDDING_MOCK='true'
pnpm --filter server store:document <PDF_ID>
# 预期：退出码 0；stdout JSON 含 chunkCount>0, vectorCount=chunkCount, collectionName=rag_chunks
pnpm --filter server store:document <MD_ID>
pnpm --filter server store:document <TXT_ID>

# 3. 状态断言
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,file_ext,status,error_message FROM document;"
# 预期：成功三件 status=completed, error_message=NULL

# 4. 向量数量校验（Mock 模式下通过 CLI 输出确认 vectorCount=chunkCount）
# 真实 Qdrant 模式下：
# curl.exe -X POST http://localhost:6333/collections/rag_chunks/points/count -H "Content-Type: application/json" -d "{\"filter\":{\"must\":[{\"key\":\"documentId\",\"match\":{\"value\":<PDF_ID>}}]},\"exact\":true}"

# 5. 幂等：重复触发已写入文档
pnpm --filter server store:document <PDF_ID>
# 预期：退出码 1；"文档已完成向量写入，禁止重复存储"

# 6. 失败重试
# a. 手动将某文档 status 改回 failed
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; UPDATE document SET status='failed' WHERE id=<MD_ID>;"
pnpm --filter server store:document <MD_ID>
# 预期：退出码 0；status=completed（重试成功）

# b. 未嵌入文档直接存储
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\new3.txt"
pnpm --filter server parse:document <NEW_ID>
pnpm --filter server chunk:document <NEW_ID>
# 不执行 embed:document，直接 store:document
pnpm --filter server store:document <NEW_ID>
# 预期：退出码 0（storeDocument 内部调用 embedDocument，会自动嵌入）；status=completed

# 7. 并发控制
# 用 Node 脚本在同一 Nest app context 内 Promise.all 两次调用
# 预期：sameObject=true（返回同一 Promise 结果）

# 8. 防御性拒绝
# 手动将某文档 status 设为 completed（已有 #2 写入的）
pnpm --filter server store:document <TXT_ID>
# 预期：退出码 1；"文档已完成向量写入，禁止重复存储"

# 9. 文档删除向量清理
# 先确认文档已完成（status=completed）
curl.exe -X DELETE http://localhost:3000/api/documents/<PDF_ID>
# 预期：204；Qdrant 中该 documentId 的向量已删除
# Mock 模式：count(documentId=<PDF_ID>) = 0
# 真实 Qdrant：curl count 确认为 0

# 10. 知识库删除向量清理
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/1
# 预期：204；Qdrant 中该 knowledgeBaseId 的向量已删除
# Mock 模式：count(knowledgeBaseId=1) = 0

# 11. 越界检查
curl.exe http://localhost:3000/api/docs-json
# 预期：paths 与 tags 与 T07 完全一致（无新增 HTTP 接口）
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：仍只有原 6 张业务表加 migrations（无新表）

# 12. Collection 自举（真实 Qdrant 模式）
# 删除 Collection 后重启服务
curl.exe -X DELETE http://localhost:6333/collections/rag_chunks
# 重启服务 → onModuleInit 自动创建 Collection
curl.exe http://localhost:6333/collections/rag_chunks
# 预期：vectors.size=1024, distance=Cosine

# 13. 维度冲突 fail-fast（真实 Qdrant 模式）
# 用错误维度创建 Collection
curl.exe -X PUT http://localhost:6333/collections/rag_chunks -H "Content-Type: application/json" -d "{\"vectors\":{\"size\":768,\"distance\":\"Cosine\"}}"
# 重启服务 → onModuleInit 抛错 → 启动失败
# 预期：错误信息含 "expected=1024, actual=768"

# 14. 清理
Remove-Item -Recurse -Force tmp-test -ErrorAction SilentlyContinue
# 预期：业务表回 0 行；migrations 表仍 2 条
```

### 17.1 真实 Qdrant + 真实 API 验收（可选，有 API Key + Docker 时执行）

```powershell
$env:QDRANT_MOCK='false'
$env:EMBEDDING_MOCK='false'
$env:EMBEDDING_API_KEY='sk-xxx'

pnpm --filter server store:document <TXT_ID>
# 预期：退出码 0；stdout JSON 含 chunkCount>0, vectorCount=chunkCount
# Qdrant count 确认
curl.exe -X POST http://localhost:6333/collections/rag_chunks/points/count -H "Content-Type: application/json" -d "{\"exact\":true}"
```

---

## 十八、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05/T06/T07）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. `pnpm --filter server add @qdrant/js-client-rest@1.12.0`；验证 `pnpm --filter server build` 通过。
2. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§四）；`pnpm --filter server build` 通过。
3. `vector-store.types.ts`（类型定义 + `VectorStoreFailure`）。
4. `qdrant-client-wrapper.ts`（§五）：封装 `@qdrant/js-client-rest` + Mock 分支。
5. `vector-store.service.ts`（§六~§十一）：`ensureCollection` + `storeDocument` + `deleteByDocumentId` + `deleteByKnowledgeBaseId` + in-flight 去重 + OnModuleInit。
6. `vector-store.module.ts`（§三）：注册 Wrapper + Service + imports + exports。
7. `app.module.ts`：imports 追加 `VectorStoreModule`。
8. `src/scripts/store-document.ts` + `package.json` script（§十五）。
9. 修改 `document.service.ts` + `document.module.ts`（§十四）：注入 `VectorStoreService`，`remove()` 增加向量清理。
10. 修改 `knowledge-base.service.ts` + `knowledge-base.module.ts`（§十四）：注入 `VectorStoreService`，`remove()` 增加向量清理。
11. 回填 `00-overall-plan.md` v1.7（§十六）。
12. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
13. 执行 §十七全量验收（Mock 模式优先；Docker 可用时追加真实 Qdrant 验收）。

---

## 十九、明确禁止（本任务一律不实现）

向量检索（TopK/search/scoreThreshold）、LLM、Chat、SSE、会话接口、前端页面、Rerank、消息队列、定时任务、上传后自动触发流水线、启动恢复钩子、OCR、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 embedding 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改全局异常过滤器/main.ts/docker-compose.yml。

---

## 二十、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① `@qdrant/js-client-rest@1.12.0` 选型理由（CJS 兼容、API 完备、与 Server v1.12.4 对齐） ② Collection 自举与维度 fail-fast ③ payload 结构与索引 ④ upsert 批处理（串行 + wait:true + 数量校验） ⑤ 状态流转（embedding → completed / failed） ⑥ 失败补偿（deleteByDocumentId 清理半成品） ⑦ 幂等策略（先删旧再 upsert） ⑧ 文档/知识库删除向量清理集成 ⑨ Mock 模式（内存 Map 模拟 Qdrant） ⑩ 并发控制（in-flight Map 去重）。
3. **启动方式**：DB 端口冲突处理结果；Qdrant 连接方式；Mock 模式开启方式；向量写入触发命令。
4. **验证方式**：§十七逐条结果（成功/失败 + 关键输出；幂等项须附两次输出对比；失败场景须附 DB 中 `error_message` 实际值；并发项须附 `sameObject` 结果；删除项须附向量 count 确认）。
5. **已知问题**：含 Mock 向量无语义相似性、`parsing` 崩溃残留需后续处理、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §十九各项均未实现。

---

## 二十一、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §二十。

```
你是一个 NestJS 后端工程师。请按 docs/task-08-qdrant-vector-store.md 实现 Qdrant 向量存储服务。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. pnpm --filter server add @qdrant/js-client-rest@1.12.0
3. pnpm --filter server build 通过
4. QDRANT_MOCK=true + EMBEDDING_MOCK=true 用于无 Docker/API 环境下的验收

## 要做的事（严格按序）
1. 配置：env.validation.ts 加 QDRANT_COLLECTION(@IsString @IsNotEmpty)、QDRANT_UPSERT_BATCH_SIZE(@IsInt @Min(1) @Max(1000))、QDRANT_MOCK(@IsOptional @IsBoolean)；configuration.ts 加 qdrant:{url,collection,upsertBatchSize,mock}；.env.example 加全部默认值

2. 新建 src/modules/vector-store/ 目录：
   - vector-store.types.ts: QdrantPoint{id,vector,payload} / StoreResult{documentId,chunkCount,vectorCount,collectionName} 接口 + VectorStoreFailure extends Error
   - qdrant-client-wrapper.ts: @Injectable QdrantClientWrapper implements OnModuleInit
     · 非 Mock: new QdrantClient({url}) 包装 @qdrant/js-client-rest
     · Mock: Map<string,{vector,payload}> 内存模拟
     · 方法: collectionExists()/getCollection()/createCollection(size,distance)/createFieldIndex(field,schema)/upsertPoints(points)/deleteByFilter(filter)/countPoints(filter?)
     · 仅依赖 ConfigService，不依赖 DB
   - vector-store.service.ts: @Injectable VectorStoreService implements OnModuleInit
     · onModuleInit → ensureCollection(): 不存在则创建(size=EMBEDDING_DIMENSION, distance=Cosine) + 建索引(knowledgeBaseId,documentId); 已存在则校验维度和距离，不匹配 fail-fast
     · storeDocument(documentId): Promise<StoreResult>
       - in-flight Map 去重
       - status 检查: embedding/failed 可触发, completed 拒绝('文档已完成向量写入，禁止重复存储')
       - 调用 embeddingService.embedDocument(documentId) 获取 EmbeddingResult
       - 获取 document.fileName
       - deleteByDocumentId(documentId) 幂等清理旧向量
       - 按 QDRANT_UPSERT_BATCH_SIZE 分批 upsertPoints(wait:true)
       - verifyUpsert: count(documentId filter) === chunks.length
       - 成功: docRepo.update(id,{status:'completed',errorMessage:null})
       - 失败: catch中 deleteByDocumentId 清理半成品 + docRepo.update(id,{status:'failed',errorMessage:摘要(≤300字)}) + throw VectorStoreFailure
     · deleteByDocumentId(documentId): filter delete by documentId
     · deleteByKnowledgeBaseId(kbId): filter delete by knowledgeBaseId
   - vector-store.module.ts: imports[TypeOrmModule.forFeature([Document]), EmbeddingModule], providers=[QdrantClientWrapper,VectorStoreService], exports=[VectorStoreService]

3. app.module.ts: imports 加 VectorStoreModule

4. scripts/store-document.ts: CLI, 调 VectorStoreService.storeDocument, 输出摘要JSON({documentId,chunkCount,vectorCount,collectionName})

5. package.json: 加 "store:document": "ts-node src/scripts/store-document.ts"

6. document.module.ts: imports 加 VectorStoreModule
   document.service.ts: 构造函数注入 VectorStoreService, remove() 在 MySQL 事务前调 vectorStoreService.deleteByDocumentId(id), 失败仅 warn 不阻止删除

7. knowledge-base.module.ts: imports 加 VectorStoreModule
   knowledge-base.service.ts: 构造函数注入 VectorStoreService + Logger, remove() 在 MySQL 删除前调 vectorStoreService.deleteByKnowledgeBaseId(id), 失败仅 warn 不阻止删除

8. 回填 00-overall-plan.md v1.7

## 不做的事
- 不做向量检索/TopK/search/scoreThreshold
- 不做 LLM/Chat/SSE/前端/消息队列/定时任务/自动触发/OCR/Rerank
- 不做新 migration/新表/改实体/改 web/
- 不引入 langchain/测试框架
- 不修改 processing/embedding 模块下任何文件
- 不修改 parsing/chunking 子目录下任何文件
- 不修改全局异常过滤器/main.ts/docker-compose.yml

## 验收（QDRANT_MOCK=true + EMBEDDING_MOCK=true）
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- PDF/MD/TXT 向量写入成功: status=completed, chunkCount>0, vectorCount=chunkCount
- 幂等: completed状态被拒绝
- 失败重试: failed→embed→store→completed
- 并发: sameObject=true
- 文档删除: 向量清理, count=0
- 知识库删除: 向量清理, count=0
- 越界: docs-json无新增接口, 无新表
- 清理: 业务表回0行
```
