# T10 RAG 生成 — Codex 执行指令

> 任务编号：T10（阶段 P7 后半：基础问答，非流式）
> 前置条件：T09 已完成（结论：**通过**，见 `docs/reports/task-09-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.8 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T09 后快照）+ `docs/reports/task-09-completion.md`（T09 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T09 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `RetrievalService` | `src/modules/retrieval/retrieval.service.ts` | **不修改**。已有 `search(kbId, query, topK?, scoreThreshold?): Promise<RetrievalResponseData>`；返回 `{ results: RetrievalResult[], total, took }`；已做 KB 校验、completed 文档过滤、payload 校验、score 降序 |
| `RetrievalModule` | `src/modules/retrieval/retrieval.module.ts` | **不修改**。已 exports `RetrievalService`，T10 直接 import |
| `RetrievalResult` | `src/modules/retrieval/retrieval.types.ts` | **不修改**。含 `chunkId/documentId/documentName/chunkIndex/pageNo/content/score` |
| `RetrievalResponseData` | `src/modules/retrieval/retrieval.types.ts` | **不修改**。含 `results/total/took` |
| `EmbeddingService.embedQuery()` | `src/modules/embedding/embedding.service.ts` | **不修改**。T10 不直接调用——通过 `RetrievalService.search()` 间接复用 |
| `EmbeddingClient` | `src/modules/embedding/embedding-client.ts` | **不修改、不注入**。T10 的 LLM 客户端参考其模式但独立实现 |
| `EmbeddingModule` | `src/modules/embedding/embedding.module.ts` | **不修改** |
| `VectorStoreModule` | `src/modules/vector-store/vector-store.module.ts` | **不修改、不注入** |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `llm` 和 `rag` 配置段（§四） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：追加 LLM 环境变量校验（§四） |
| `AppModule` | `src/app.module.ts` | **允许修改**：imports 追加 `LlmModule` + `RagModule` |
| `ResponseInterceptor` | `src/common/interceptors/response.interceptor.ts` | **不修改**。控制器直接返回 data，拦截器自动包装为 `{ code: 0, message: 'success', data }` |
| `HttpExceptionFilter` | `src/common/filters/http-exception.filter.ts` | **不修改**。已有统一异常处理 |
| `ValidationPipe` | `main.ts` 中全局注册，`whitelist: true, transform: true` | **不修改**。DTO 校验由管道处理 |
| `ParsePositiveIntPipe` | `src/common/pipes/parse-positive-int.pipe.ts` | **不修改**。路由参数 `:id` 校验 |
| Swagger | `main.ts` 中 `SwaggerModule.setup('docs', ...)` | **不修改**。新控制器自动出现在 Swagger |
| `KnowledgeBase` 实体 | `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | **不修改** |
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | **不修改** |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | **不修改** |
| CLI 脚本模式 | `src/scripts/*.ts` | T10 **不新增 CLI**。RAG 问答通过 HTTP 接口测试 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T09 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05-T09），否则 DB 读写会打到错误实例。
2. **Docker daemon 可能无法启动**：T10 需要 Embedding + Qdrant + LLM。若 Docker 不可用则使用 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` + `LLM_MOCK=true` 完成 Mock 验收（§十五）。
3. Mock Embedding 向量无语义相似性——但同文本 query 和 chunk 的 Mock 向量完全一致（cosine=1.0），可用于确定性验收。
4. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `llm` 模块和 `rag` 模块，实现基于检索结果的 RAG 回答全流程：

- **接收查询**：接收 `knowledgeBaseId` 和用户 `question` 字符串；
- **复用 T09 检索**：调用 `RetrievalService.search()` 获取 `RetrievalResult[]`；
- **无命中短路**：`results.length === 0` → 返回固定话术，**不调用 LLM**（防编造第一道闸）；
- **上下文组装**：按 score 降序拼接检索结果，标注 `[来源{i}]`，截断到 `CONTEXT_MAX_CHARS`；
- **Prompt 构建**：System Prompt（中文规则 + 禁止编造）+ User Prompt（上下文 + 问题）；
- **LLM 调用**：调用 OpenAI 兼容 `POST /chat/completions`（**非流式**），获取完整回答；
- **返回 answer 和 references**：references 与实际使用的 chunk 一一对应；
- **元数据防泄露**：Prompt 中不包含 `chunkId`/`documentId`/`score` 等内部元数据；
- **耗时日志**：记录检索耗时、LLM 耗时、总耗时；
- **异常处理**：超时、429、5xx、模型返回异常 → 502；
- **Mock LLM**：`LLM_MOCK=true` 时使用确定性 Mock 回答，零网络调用；
- **HTTP 接口**：`POST /api/knowledge-bases/:id/ask` 用于测试和 T11 集成；
- **内部 Service**：`RagService.ask()` 供 T11 Chat 模块调用。

### 2.2 非目标（本阶段一律不做）

SSE 流式输出、Conversation、Message、MessageReference 落库、历史会话上下文、Rerank、Agent、GraphRAG、前端页面、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入 `openai` SDK、引入 `axios`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改 `RetrievalService`/`RetrievalModule`、修改 `EmbeddingService`/`EmbeddingClient`/`EmbeddingModule`、修改 `VectorStoreService`/`VectorStoreModule`、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`、修改任何文档的 `status` 字段、上传后自动触发流水线、启动恢复钩子、OCR。

**T10 不修改任何文档的 `status` 字段**——RAG 问答是只读操作，不触碰文档状态机。

---

## 三、模块与文件设计

### 3.1 新增文件（server/，10 个）

| 文件 | 职责 |
|---|---|
| `src/modules/llm/llm.module.ts` | NestJS 模块：providers 注册 `LlmClient`，exports 导出 `LlmClient`；仅依赖 `ConfigModule`（全局） |
| `src/modules/llm/llm-client.ts` | OpenAI 兼容 Chat Completions 客户端：非流式 `chat()` 方法 + Mock 模式 + 指数退避重试 + 超时 |
| `src/modules/llm/llm.types.ts` | 类型定义：`ChatMessage`/`ChatCompletionRequest`/`ChatCompletionResponse`/`LlmFailure` |
| `src/modules/rag/rag.module.ts` | NestJS 模块：imports `RetrievalModule` + `LlmModule`，providers 注册 `RagService`，controllers 注册 `RagController`，exports 导出 `RagService` |
| `src/modules/rag/rag.service.ts` | RAG 编排服务：检索 → 无命中短路 → 上下文组装 → Prompt 构建 → LLM 调用 → 映射结果 |
| `src/modules/rag/rag.controller.ts` | HTTP 控制器：`POST /api/knowledge-bases/:id/ask`，参数校验 + 调用 Service + 异常映射 |
| `src/modules/rag/rag.types.ts` | 类型定义：`RagAnswer`/`RagReference`/`RagResponseData` |
| `src/modules/rag/dto/rag-request.dto.ts` | 请求 DTO：`question`/`topK?`/`scoreThreshold?` + class-validator 装饰器 |
| `src/modules/rag/dto/rag-response.dto.ts` | 响应 DTO：`RagReferenceDto` + `RagResponseDto`（Swagger 展示用） |
| `src/modules/rag/prompt-builder.ts` | Prompt 构建器：System Prompt + User Prompt + 上下文格式化 + 元数据脱敏 |

### 3.2 修改文件（server/ 3 个 + 根 1 个 + docs 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/config/configuration.ts` | 追加 `llm` 和 `rag` 配置段（§四） |
| `src/config/env.validation.ts` | 追加 LLM 环境变量校验（§四） |
| `src/app.module.ts` | imports 追加 `LlmModule` + `RagModule` |
| `.env.example` | 追加 LLM 环境变量（§四） |
| `docs/00-overall-plan.md` | §二十 v1.9 回填（§十九） |

**禁止改动**：`web/` 任何文件、全部实体定义、既有 migration、main.ts、过滤器、拦截器、`docker-compose.yml`、processing 模块下任何文件、retrieval 模块下任何文件、embedding 模块下任何文件、vector-store 模块下任何文件、`KnowledgeBaseService`/`KnowledgeBaseModule`、`DocumentService`/`DocumentModule`。

> 规模判断：一个 LLM 客户端 + 一个 RAG 编排服务 + 一个 Prompt 构建器 + 一个控制器 + 类型/DTO 即可，**不建** RAG strategy / provider factory——与 T05-T09「不过度细分」一致。

> **模块命名说明**：总体方案 §7 规划了 `chat` 和 `llm` 模块。T10 创建 `llm`（Chat Completions 客户端）和 `rag`（RAG 编排）。**不创建 `chat` 模块**——`chat` 模块在 T11 实现 SSE 流式 + Conversation + Message 时创建。T10 的 `RagService` 供 T11 `ChatService` 调用。

---

## 四、配置和环境变量（冻结级）

### 4.1 环境变量清单

| 变量 | 默认值 | 校验 | 说明 |
|---|---|---|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` | `@IsString @IsNotEmpty` | Chat 模型服务地址，OpenAI 兼容 |
| `LLM_API_KEY` | `sk-your-api-key` | `@IsString @IsNotEmpty` | Chat 模型 API Key |
| `LLM_MODEL` | `gpt-4o-mini` | `@IsString @IsNotEmpty` | Chat 模型名称 |
| `LLM_TEMPERATURE` | 0.3 | `@IsNumber @Min(0) @Max(2)` | 低温减幻觉 |
| `LLM_MAX_TOKENS` | 2048 | `@IsInt @Min(1) @Max(8192)` | 最大生成 token 数 |
| `LLM_TIMEOUT_MS` | 60000 | `@IsInt @Min(5000) @Max(300000)` | 请求超时时间 |
| `LLM_MAX_RETRIES` | 3 | `@IsInt @Min(0) @Max(10)` | 可重试失败的最大重试次数 |
| `LLM_MOCK` | false | `@IsOptional @IsBoolean` | Mock 模式开关 |
| `CONTEXT_MAX_CHARS` | 4000 | `@IsInt @Min(500) @Max(20000)` | 上下文最大字符数 |

> `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` 在总体方案 §12 中已列出；`LLM_TEMPERATURE`/`LLM_MAX_TOKENS` 已列出但未实现。T10 首次使用，并补充 `LLM_TIMEOUT_MS`/`LLM_MAX_RETRIES`/`LLM_MOCK`/`CONTEXT_MAX_CHARS`。

### 4.2 configuration.ts 追加

```ts
llm: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  mock: boolean;
};

rag: {
  contextMaxChars: number;
};
```

读取逻辑：

```ts
llm: {
  baseUrl: process.env.LLM_BASE_URL ?? '',
  apiKey: process.env.LLM_API_KEY ?? '',
  model: process.env.LLM_MODEL ?? '',
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.3),
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2048),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 3),
  mock: process.env.LLM_MOCK === 'true',
},
rag: {
  contextMaxChars: Number(process.env.CONTEXT_MAX_CHARS ?? 4000),
},
```

并在 `AppConfiguration` 接口追加对应类型。

### 4.3 env.validation.ts 追加

```ts
@IsDefined()
@IsString()
@IsNotEmpty()
LLM_BASE_URL!: string;

@IsDefined()
@IsString()
@IsNotEmpty()
LLM_API_KEY!: string;

@IsDefined()
@IsString()
@IsNotEmpty()
LLM_MODEL!: string;

@IsDefined()
@Type(() => Number)
@IsNumber()
@Min(0)
@Max(2)
LLM_TEMPERATURE!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(8192)
LLM_MAX_TOKENS!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(5000)
@Max(300000)
LLM_TIMEOUT_MS!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(10)
LLM_MAX_RETRIES!: number;

@IsOptional()
@Type(() => Boolean)
@IsBoolean()
LLM_MOCK?: boolean;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(500)
@Max(20000)
CONTEXT_MAX_CHARS!: number;
```

### 4.4 .env.example 追加

```env
# LLM（OpenAI 兼容，T10 首次使用）
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-api-key
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=2048
LLM_TIMEOUT_MS=60000
LLM_MAX_RETRIES=3
LLM_MOCK=false

# RAG 上下文（T10 首次使用）
CONTEXT_MAX_CHARS=4000
```

---

## 五、如何复用 T09 RetrievalService（冻结级，设计问题 1）

### 5.1 决策：直接调用 `RetrievalService.search()`

**核心设计**：T10 的 `RagService` 注入 `RetrievalService`，直接调用其 `search()` 方法获取检索结果。不绕过、不重新实现检索逻辑。

```ts
// RagService 构造函数注入
constructor(
  private readonly retrievalService: RetrievalService,
  private readonly llmClient: LlmClient,
  configService: ConfigService,
) {}
```

### 5.2 调用方式

```ts
const retrievalData = await this.retrievalService.search(
  knowledgeBaseId,
  question,
  topK,
  scoreThreshold,
);
```

### 5.3 复用的能力

| 能力 | 来源 | 说明 |
|---|---|---|
| KB 存在性校验 | `RetrievalService` | 不存在 → `NotFoundException`（404） |
| Query 空检查 | `RetrievalService` | 空 query → `BadRequestException`（400） |
| Query Embedding | `RetrievalService` → `EmbeddingService.embedQuery()` | 复用 T07 Mock/重试/超时/维度校验 |
| Qdrant 向量检索 | `RetrievalService` → `VectorStoreService.search()` | 复用 T08/T09 filter + search |
| completed 文档过滤 | `RetrievalService` | 只返回 `status=completed` 的文档结果 |
| Payload 校验 | `RetrievalService` | 防御性跳过无效 payload |
| Score 降序 | `RetrievalService` | 结果已按 score 降序排列 |
| 耗时记录 | `RetrievalService` | `took` 字段（ms） |

### 5.4 不复用的能力

T10 **不直接调用**以下组件——全部通过 `RetrievalService` 间接使用：

- `EmbeddingService` / `EmbeddingClient`
- `VectorStoreService` / `QdrantClientWrapper`

### 5.5 模块依赖

```
T10 RagModule
  imports: RetrievalModule（获取 RetrievalService）, LlmModule（获取 LlmClient）
```

- `RetrievalModule` exports `RetrievalService`（T09 已实现）；
- `LlmModule` exports `LlmClient`（T10 新建）；
- 无循环依赖。

---

## 六、Prompt 模板和上下文格式（冻结级，设计问题 2）

### 6.1 上下文格式

检索结果按 score 降序（`RetrievalService` 已保证），拼接为带来源标注的上下文文本：

```
[来源1] {content1}

[来源2] {content2}

[来源3] {content3}
```

**格式规则**：

- 每条 chunk 以 `[来源{i}] ` 开头，`i` 从 1 开始递增；
- chunk 之间用 `\n\n` 分隔；
- **只使用 `content` 字段**——不包含 `chunkId`/`documentId`/`score` 等内部元数据（§八 防泄露）；
- 总长度截断到 `CONTEXT_MAX_CHARS`（§九）。

### 6.2 Prompt 结构

```ts
const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userPrompt },
];
```

### 6.3 System Prompt（冻结级，中文）

```
你是一个知识库问答助手。请根据下方提供的参考资料回答用户问题。

回答规则：
1. 只能基于参考资料中的内容回答问题，不得编造、猜测或使用参考资料以外的知识。
2. 如果参考资料中没有相关信息，请明确回答"根据知识库中的资料，我无法回答这个问题"。
3. 回答使用中文，语言简洁明了。
4. 如果参考资料中有多个相关片段，请综合归纳后回答。
5. 回答中不要提及"来源1""来源2"等标注编号。
6. 回答中不要提及文档名、页码、chunkId 等内部元数据。
```

### 6.4 User Prompt

```
参考资料：

{context}

用户问题：{question}
```

### 6.5 Prompt 构建器

```ts
// prompt-builder.ts

const SYSTEM_PROMPT = `你是一个知识库问答助手。请根据下方提供的参考资料回答用户问题。

回答规则：
1. 只能基于参考资料中的内容回答问题，不得编造、猜测或使用参考资料以外的知识。
2. 如果参考资料中没有相关信息，请明确回答"根据知识库中的资料，我无法回答这个问题"。
3. 回答使用中文，语言简洁明了。
4. 如果参考资料中有多个相关片段，请综合归纳后回答。
5. 回答中不要提及"来源1""来源2"等标注编号。
6. 回答中不要提及文档名、页码、chunkId 等内部元数据。`;

export function buildContext(
  results: RetrievalResult[],
  maxChars: number,
): { context: string; usedResultCount: number } {
  const parts: string[] = [];
  let totalChars = 0;
  let usedCount = 0;

  for (let i = 0; i < results.length; i += 1) {
    const label = `[来源${i + 1}] `;
    const content = results[i].content;
    const part = `${label}${content}`;

    if (totalChars + part.length > maxChars && parts.length > 0) {
      break;
    }

    parts.push(part);
    totalChars += part.length + 2; // +2 for \n\n separator
    usedCount = i + 1;
  }

  return { context: parts.join('\n\n'), usedResultCount: usedCount };
}

export function buildUserPrompt(context: string, question: string): string {
  return `参考资料：\n\n${context}\n\n用户问题：${question}`;
}

export function buildMessages(
  context: string,
  question: string,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(context, question) },
  ];
}
```

### 6.6 无命中时的固定话术

当 `retrievalData.results.length === 0` 时，**不调用 LLM**，直接返回：

```ts
{
  answer: '知识库中未找到与您问题相关的内容。',
  references: [],
  retrievalTook: retrievalData.took,
  llmTook: 0,
  took: retrievalData.took,
}
```

---

## 七、中文问答规则和防编造（冻结级，设计问题 3、4）

### 7.1 中文问答规则

| 规则 | 实现方式 |
|---|---|
| 回答语言 | System Prompt 第 3 条：「回答使用中文」 |
| 综合归纳 | System Prompt 第 4 条：「如果参考资料中有多个相关片段，请综合归纳后回答」 |
| 禁止标注编号 | System Prompt 第 5 条：「回答中不要提及"来源1""来源2"等标注编号」 |
| 禁止内部元数据 | System Prompt 第 6 条：「回答中不要提及文档名、页码、chunkId 等内部元数据」 |

### 7.2 防编造机制（三道闸）

| 闸门 | 实现位置 | 机制 |
|---|---|---|
| **第一道闸** | `RagService` | 无命中 → 不调用 LLM，返回固定话术（§6.6） |
| **第二道闸** | System Prompt 第 1 条 | 「只能基于参考资料中的内容回答问题，不得编造、猜测或使用参考资料以外的知识」 |
| **第三道闸** | System Prompt 第 2 条 | 「如果参考资料中没有相关信息，请明确回答"根据知识库中的资料，我无法回答这个问题"」 |

### 7.3 上下文截断但不截断引用

- 上下文（Prompt 中的 `content`）可能被截断到 `CONTEXT_MAX_CHARS`；
- **references 不截断**——但只返回实际使用了其 content 的 chunk 的引用（§九）；
- 被截断掉的 chunk（因超长未进入 Prompt）不出现在 references 中。

---

## 八、上下文长度和 Chunk 截断策略（冻结级，设计问题 5）

### 8.1 截断参数

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---:|---|
| `contextMaxChars` | `CONTEXT_MAX_CHARS` | 4000 | 上下文最大字符数（含来源标注和分隔符） |

### 8.2 截断策略

```
1. 检索结果已按 score 降序排列（RetrievalService 保证）
2. 从 score 最高的 chunk 开始，逐条拼接
3. 每条格式：[来源{i}] {content}
4. 累计字符数（含标注和 \n\n 分隔符）
5. 当添加下一条会超过 contextMaxChars 且已有至少 1 条时 → 停止
6. 返回实际拼接的 context 和 usedResultCount
```

### 8.3 截断规则细节

| 场景 | 行为 |
|---|---|
| 第一条 chunk 就超过 `contextMaxChars` | 仍然使用这一条（至少要有 1 条上下文），不硬截断 chunk 内容本身 |
| 后续 chunk 添加后超过 `contextMaxChars` | 停止添加，使用已拼接的部分 |
| 所有 chunk 拼接后未超过 `contextMaxChars` | 全部使用 |
| `contextMaxChars` 太小导致只用了 1 条 | 正常——质量由检索保证，截断是安全措施 |

### 8.4 不硬截断单条 chunk

**决策**：不把单条 chunk 的 `content` 从中间截断。

**理由**：
- chunk 本身已经是 T06 切片的产物（默认 500 字符），通常远小于 `contextMaxChars`；
- 中间截断会破坏语义完整性；
- 如果单条 chunk 超过 `contextMaxChars`（极端情况），整个 chunk 原样进入 Prompt，LLM 能处理。

### 8.5 references 只包含使用的 chunk

```ts
const { context, usedResultCount } = buildContext(
  retrievalData.results,
  this.contextMaxChars,
);

// references 只包含实际进入 Prompt 的 chunk
const references = retrievalData.results
  .slice(0, usedResultCount)
  .map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    pageNo: r.pageNo,
    content: r.content,
    score: r.score,
  }));
```

---

## 九、References 去重和排序（冻结级，设计问题 6）

### 9.1 冻结决策：不去重，按 score 降序

| 问题 | 决策 | 理由 |
|---|---|---|
| 去重 | **不去重** | `RetrievalService` 返回的 `RetrievalResult[]` 每个 `chunkId` 已唯一（Qdrant point 与 MySQL chunk 一一对应）；不同 chunk 可能 content 相似但 `chunkId` 不同，都是有效引用 |
| 排序 | **按 score 降序** | `RetrievalService` 已保证；references 顺序与 Prompt 中 `[来源{i}]` 顺序一致 |

### 9.2 references 字段

```ts
export interface RagReference {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}
```

> **注意**：与 `RetrievalResult` 相比，`RagReference` 不包含 `chunkIndex`——引用展示不需要文档内序号。T11 的 `message_reference` 表需要 `chunk_index`，但 T10 不落库，所以不需要。

### 9.3 references 与 Prompt 的一致性

references 的数量 **必须等于** 实际进入 Prompt 的 chunk 数量（`usedResultCount`）。这保证「引用与实际使用的 Chunk 一一对应」。

---

## 十、LLM 客户端选型（冻结级，设计问题 7）

### 10.1 决策：Node.js 20 内置 `fetch` + `AbortController`，零新增依赖

| 方案 | 否决理由 |
|---|---|
| `openai` SDK | 传递依赖冗余（`openai` 包含自动重试、流式解析等大量功能）；版本锁定风险；与 T07 EmbeddingClient 的手写模式不一致 |
| `axios` | 功能等价于 `fetch`，但引入额外依赖；`fetch` 已是 Node 20 内置 |
| **Node 20 原生 `fetch` + `AbortController`** ✅ | 零新增依赖；与 T07 `EmbeddingClient` 模式完全一致；代码风格统一；面试可逐行讲解 |

### 10.2 与 EmbeddingClient 的模式对比

| 特性 | EmbeddingClient | LlmClient |
|---|---|---|
| HTTP 方法 | POST | POST |
| 端点 | `/embeddings` | `/chat/completions` |
| 请求体 | `{ model, input: string[] }` | `{ model, messages, temperature, max_tokens }` |
| 响应解析 | `data[].embedding` | `choices[0].message.content` |
| 超时 | `AbortController` | `AbortController` |
| 重试 | 指数退避 + jitter | 指数退避 + jitter |
| Mock | SHA-256 确定性向量 | 确定性模板回答 |
| 错误类 | `EmbeddingFailure` | `LlmFailure` |

### 10.3 LlmClient 不注入任何 Repository

`LlmClient` 是纯 HTTP 客户端，**只依赖 `ConfigService`**，不注入任何 TypeORM Repository。与 `EmbeddingClient` 的设计原则一致：「外部资源客户端不依赖任何业务模块」。

---

## 十一、Chat Completions 请求与响应类型（冻结级，设计问题 8）

### 11.1 请求类型

```ts
// llm.types.ts

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: false;  // T10 只做非流式
}
```

### 11.2 响应类型

```ts
export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

### 11.3 HTTP 请求

```ts
const requestBody: ChatCompletionRequest = {
  model: this.model,
  messages,
  temperature: this.temperature,
  max_tokens: this.maxTokens,
  stream: false,
};

const response = await fetch(`${this.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${this.apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
  signal: controller.signal,
});
```

### 11.4 响应解析

```ts
private parseChatResponse(value: unknown): string {
  if (!this.isChatCompletionResponse(value)) {
    throw new LlmFailure('Chat Completions 响应结构不兼容');
  }

  if (value.choices.length === 0) {
    throw new LlmFailure('Chat Completions 响应 choices 为空');
  }

  const content = value.choices[0].message.content;

  if (typeof content !== 'string' || content.length === 0) {
    throw new LlmFailure('Chat Completions 响应 content 为空');
  }

  return content;
}
```

### 11.5 类型守卫

```ts
private isChatCompletionResponse(
  value: unknown,
): value is ChatCompletionResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ChatCompletionResponse>;

  return (
    Array.isArray(candidate.choices) &&
    candidate.choices.every((choice) => this.isChatCompletionChoice(choice))
  );
}

private isChatCompletionChoice(
  value: unknown,
): value is ChatCompletionChoice {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ChatCompletionChoice>;

  return (
    typeof candidate.index === 'number' &&
    typeof candidate.message === 'object' &&
    candidate.message !== null &&
    typeof candidate.message.content === 'string'
  );
}
```

---

## 十二、超时、重试和异常处理（冻结级，设计问题 9）

### 12.1 重试策略

与 T07 `EmbeddingClient` 完全一致的模式：

| 参数 | 值 | 说明 |
|---|---|---|
| base delay | 1000ms | 初始退避延迟 |
| factor | 2 | 指数因子 |
| max delay | 30000ms | 最大退避延迟 |
| jitter | 0-500ms | 随机抖动 |
| max retries | `LLM_MAX_RETRIES`（默认 3） | 最大重试次数 |

```ts
const delayMs = Math.min(
  RETRY_BASE_DELAY_MS * 2 ** attempt,
  RETRY_MAX_DELAY_MS,
);
return delayMs + Math.floor(Math.random() * RETRY_JITTER_MS);
```

### 12.2 可重试 vs 不可重试

| HTTP 状态 | 是否重试 | 错误消息标签 |
|---|---|---|
| 429 | ✅ 重试（尊重 `Retry-After`） | `Chat API 限流` |
| 500/502/503/504 | ✅ 重试 | `Chat API 服务端错误` |
| 超时（AbortController） | ✅ 重试 | `Chat API 请求超时` |
| 网络错误（fetch reject） | ✅ 重试 | `Chat API 网络错误` |
| 400 | ❌ 不重试 | `Chat API 请求错误` |
| 401 | ❌ 不重试 | `Chat API 认证失败` |
| 403 | ❌ 不重试 | `Chat API 禁止访问` |
| 404 | ❌ 不重试 | `Chat API 地址或模型不存在` |
| 其他 4xx | ❌ 不重试 | `Chat API 请求失败` |

### 12.3 重试判断

```ts
private isRetryableFailure(error: LlmFailure): boolean {
  return (
    error.message.includes('请求超时') ||
    error.message.includes('网络错误') ||
    error.message.includes('限流') ||
    error.message.includes('服务端错误')
  );
}
```

### 12.4 `Retry-After` 处理

```ts
private getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter === null) return null;

  const delaySeconds = Number(retryAfter);
  if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) return null;

  return Math.floor(delaySeconds * 1000);
}
```

### 12.5 异常映射

| 异常类型 | HTTP 状态码 | 说明 |
|---|---|---|
| `NotFoundException`（KB 不存在） | 404 | `RetrievalService` 抛出，全局过滤器处理 |
| `BadRequestException`（空 query） | 400 | `RetrievalService` 抛出 |
| `EmbeddingFailure`（向量生成失败） | 502 | `RetrievalService` 抛出，控制器 catch → `BadGatewayException` |
| `LlmFailure`（LLM 调用失败） | 502 | 控制器 catch → `BadGatewayException` |
| `VectorStoreFailure`（Qdrant 检索失败） | 500 | `RetrievalService` 抛出，全局过滤器处理 |
| 其他非 HttpException | 500 | 全局过滤器处理 |

### 12.6 `LlmFailure` 类型

```ts
// llm.types.ts
export class LlmFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmFailure';
  }
}
```

### 12.7 API Key 和错误信息安全

**允许记录到日志**：

- 中文错误摘要；
- 错误类型标签；
- 耗时信息；
- HTTP 状态码和 statusText。

**禁止记录到日志或返回给客户端**：

- API Key；
- 完整请求体（含 Prompt 内容）；
- 完整 LLM 响应体；
- 堆栈跟踪（仅 `console.error` 内部记录，不返回 HTTP 响应）。

---

## 十三、RagService 和 HTTP 接口（冻结级，设计问题 10）

### 13.1 冻结决策：同时提供内部 Service 和 HTTP 接口

| 形式 | 消费方 | 用途 |
|---|---|---|
| `RagService.ask()` | T11 Chat 模块 | RAG 问答流程中获取非流式回答 |
| `POST /api/knowledge-bases/:id/ask` | 手动测试 / Swagger | 问答质量验证、参数调优 |

### 13.2 RagService 接口

```ts
@Injectable()
export class RagService {
  async ask(
    knowledgeBaseId: number,
    question: string,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<RagResponseData> {
    // §十三 13.3 流程
  }
}
```

### 13.3 完整流程

```
RagService.ask(kbId, question, topK?, scoreThreshold?):
  1. startedAt = Date.now()
  2. retrievalData = await retrievalService.search(kbId, question, topK, scoreThreshold)
     - KB 不存在 → NotFoundException（404）
     - 空 query → BadRequestException（400）
     - Embedding 失败 → EmbeddingFailure（→ 502）
     - Qdrant 失败 → VectorStoreFailure（→ 500）
  3. retrievalTook = retrievalData.took
  4. if (retrievalData.results.length === 0):
     - log: 'RAG 问答无命中：kbId=..., question="...", took=...ms'
     - return {
         answer: '知识库中未找到与您问题相关的内容。',
         references: [],
         retrievalTook,
         llmTook: 0,
         took: Date.now() - startedAt,
       }
  5. { context, usedResultCount } = buildContext(retrievalData.results, contextMaxChars)
  6. messages = buildMessages(context, question)
  7. llmStartedAt = Date.now()
  8. answer = await llmClient.chat(messages)
     - LLM 失败 → LlmFailure（→ 502）
  9. llmTook = Date.now() - llmStartedAt
  10. references = retrievalData.results.slice(0, usedResultCount).map(toRagReference)
  11. took = Date.now() - startedAt
  12. log: 'RAG 问答完成：kbId=..., question="...", resultCount=..., usedCount=..., retrievalTook=...ms, llmTook=...ms, took=...ms'
  13. return { answer, references, retrievalTook, llmTook, took }
```

### 13.4 HTTP 接口设计

```
POST /api/knowledge-bases/:id/ask
Content-Type: application/json

{
  "question": "什么是RAG",
  "topK": 5,
  "scoreThreshold": 0.5
}
```

- **路径**：`/api/knowledge-bases/:id/ask`（`id` = knowledgeBaseId）
- **方法**：POST（question 可能很长，不适合 GET query string）
- **`id` 参数**：`@Param('id', ParsePositiveIntPipe)` → 自动校验为正整数
- **Body**：`RagRequestDto`（`ValidationPipe` 自动校验）
- **响应**：`RagResponseData`（`ResponseInterceptor` 自动包装）

### 13.5 请求 DTO

```ts
// dto/rag-request.dto.ts
export class RagRequestDto {
  @ApiProperty({ example: '什么是 RAG？', maxLength: 2000 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @ApiPropertyOptional({ example: 0.5, minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  scoreThreshold?: number;
}
```

### 13.6 响应 DTO

```ts
// rag.types.ts
export interface RagReference {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}

export interface RagResponseData {
  answer: string;
  references: RagReference[];
  retrievalTook: number;
  llmTook: number;
  took: number;
}
```

```ts
// dto/rag-response.dto.ts (Swagger 展示用)
export class RagReferenceDto {
  @ApiProperty({ example: 123 })
  chunkId!: number;

  @ApiProperty({ example: 45 })
  documentId!: number;

  @ApiProperty({ example: '产品手册.pdf' })
  documentName!: string;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  pageNo!: number | null;

  @ApiProperty({ example: 'RAG 是检索增强生成。' })
  content!: string;

  @ApiProperty({ example: 0.8732 })
  score!: number;
}

export class RagResponseDto {
  @ApiProperty({ example: 'RAG 是一种结合检索和生成的技术...' })
  answer!: string;

  @ApiProperty({ type: [RagReferenceDto] })
  references!: RagReferenceDto[];

  @ApiProperty({ example: 42 })
  retrievalTook!: number;

  @ApiProperty({ example: 1500 })
  llmTook!: number;

  @ApiProperty({ example: 1542 })
  took!: number;
}
```

### 13.7 控制器实现

```ts
@Controller('knowledge-bases/:id/ask')
@ApiTags('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  @ApiOperation({ summary: 'RAG 问答（非流式）' })
  @ApiOkResponse({ type: RagResponseDto })
  @ApiBadRequestResponse({ description: '请求参数校验失败' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  @ApiBadGatewayResponse({ description: '模型服务暂时不可用' })
  async ask(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: RagRequestDto,
  ): Promise<RagResponseData> {
    try {
      return await this.ragService.ask(
        id,
        dto.question,
        dto.topK,
        dto.scoreThreshold,
      );
    } catch (error: unknown) {
      if (error instanceof EmbeddingFailure) {
        throw new BadGatewayException(
          '问答服务暂时不可用：向量生成失败',
        );
      }
      if (error instanceof LlmFailure) {
        throw new BadGatewayException(
          '问答服务暂时不可用：模型调用失败',
        );
      }
      throw error;
    }
  }
}
```

> `NotFoundException` 和 `VectorStoreFailure` 不在控制器 catch 中处理——`NotFoundException` 是 `HttpException` 子类，全局过滤器直接处理；`VectorStoreFailure` 非 `HttpException`，全局过滤器返回 500。

### 13.8 新增 API 编号

此接口为总体方案 §9 的接口之外 **T10 新增测试接口**，编号 #15，需在基线回填中注明（§十九）。

---

## 十四、与 T11 SSE、Conversation、Message 的边界（冻结级，设计问题 11）

### 14.1 T10 做的事

| 能力 | T10 实现 |
|---|---|
| 检索 | 复用 `RetrievalService.search()` |
| 上下文组装 | `buildContext()` |
| Prompt 构建 | `buildMessages()` |
| LLM 调用 | `LlmClient.chat()`（非流式） |
| 返回 answer + references | `RagResponseData` |
| HTTP 接口 | `POST /api/knowledge-bases/:id/ask` |
| 内部 Service | `RagService.ask()` |

### 14.2 T10 不做的事（T11+ 实现）

| 能力 | T11 负责方 | 说明 |
|---|---|---|
| SSE 流式输出 | `ChatController` + `LlmClient` 流式方法 | T11 在 `LlmClient` 新增 `chatStream()` 方法 |
| Conversation 持久化 | `ConversationModule` | T11 新建 |
| Message 持久化 | `ConversationModule` | T11 新建 |
| MessageReference 落库 | `ConversationModule` | T11 新建 |
| 历史会话上下文 | `ChatService` | T11 新建；T10 的 `RagService.ask()` 不接收 `conversationId` |
| `POST /api/chat/stream` | `ChatController` | T11 新建（总体方案 §9 #10） |

### 14.3 T11 调用 T10 的方式

```ts
// T11 ChatService 中（示意）
const ragResult = await this.ragService.ask(
  knowledgeBaseId,
  question,
  topK,
  scoreThreshold,
);

// ragResult.answer → 流式推送给前端（T11 可能改用流式 LLM 调用）
// ragResult.references → 保存到 message_reference 表
```

> **注意**：T11 如果要做 SSE 流式输出，可能需要 `LlmClient` 新增流式方法，而不是调用 `RagService.ask()`。T10 的 `RagService.ask()` 是非流式的，T11 可根据需要选择：
> - 复用 `RagService.ask()` 获取完整回答后再推送（简单但非真流式）
> - 或在 T11 中直接调 `RetrievalService.search()` + `LlmClient.chatStream()`（真流式）
>
> 这不影响 T10 的设计——T10 提供的 `RagService.ask()` 和 `LlmClient.chat()` 都是非流式的，T11 可以在此基础上扩展。

### 14.4 模块依赖方向

```
T11 ChatModule
  imports: RagModule（或 RetrievalModule + LlmModule）, ConversationModule
```

- T10 的 `RagModule` exports `RagService`；
- T10 的 `LlmModule` exports `LlmClient`；
- T11 可以选择 import `RagModule` 或直接 import `RetrievalModule` + `LlmModule`；
- 无循环依赖。

---

## 十五、Mock LLM 实现（冻结级）

### 15.1 设计目标

`LLM_MOCK=true` 时，`LlmClient.chat()` 使用确定性模板回答，零网络调用。配合 `EMBEDDING_MOCK=true` + `QDRANT_MOCK=true`，可实现全链路 Mock RAG 验收。

### 15.2 Mock 回答模板

```ts
private mockChat(messages: ChatMessage[]): string {
  // 从 user message 中提取 question
  const userMessage = messages.find((m) => m.role === 'user');
  if (!userMessage) {
    return 'Mock 回答：未找到用户问题。';
  }

  // 从 user message 中提取参考资料数量
  const sourceCount = (userMessage.content.match(/\[来源\d+\]/g) || []).length;

  if (sourceCount === 0) {
    return 'Mock 回答：未提供参考资料。';
  }

  // 确定性回答：根据来源数量生成回答
  return `根据知识库中的 ${sourceCount} 条参考资料，回答您的问题。这是一条 Mock 回答，用于验证 RAG 链路完整性。`;
}
```

### 15.3 Mock 特性

| 特性 | 说明 |
|---|---|
| **零网络调用** | `LLM_MOCK=true` 时不发 HTTP 请求 |
| **确定性** | 相同输入 → 相同输出 |
| **回答内容** | 基于来源数量生成模板回答，不包含实际语义 |
| **用途** | 验证 RAG 链路完整性（检索 → 上下文 → Prompt → LLM → answer + references） |

### 15.4 全链路 Mock 验收

```env
QDRANT_MOCK=true
EMBEDDING_MOCK=true
LLM_MOCK=true
```

在此模式下：
1. 上传文件 → Mock 解析 → Mock 切片 → Mock Embedding → Mock Qdrant 写入
2. RAG 问答 → Mock 检索（同文本 score=1.0）→ Mock LLM 回答
3. 全流程零网络调用、零外部依赖、确定性可重复

---

## 十六、日志和异常处理

### 16.1 日志矩阵

| 事件 | 级别 | 内容 |
|---|---|---|
| RAG 问答成功（有结果） | `log` | `RAG 问答完成：kbId={id}，question="{truncated}"，resultCount={n}，usedCount={m}，retrievalTook={ms}ms，llmTook={ms}ms，took={ms}ms` |
| RAG 问答成功（无命中） | `log` | `RAG 问答无命中：kbId={id}，question="{truncated}"，took={ms}ms` |
| KB 不存在 | 不记录（抛 `NotFoundException`） | — |
| 检索 Embedding 失败 | `error` | `RAG 问答失败-向量生成：kbId={id}，{message}` |
| Qdrant 检索失败 | `error` | `RAG 问答失败-Qdrant搜索：kbId={id}，{message}` |
| LLM 调用失败 | `error` | `RAG 问答失败-LLM调用：kbId={id}，{message}` |
| LLM 重试 | `warn` | `Chat API 重试（{n}/{max}）：原因={message}，等待={ms}ms` |

### 16.2 question 截断

日志中的 question 截断到 50 字符，避免长问题刷屏：

```ts
private truncateQuestion(question: string): string {
  return question.length > 50 ? `${question.slice(0, 50)}...` : question;
}
```

### 16.3 errorMessage 安全规则

**允许记录到日志**：

- 中文错误摘要；
- 错误类型标签；
- 耗时信息。

**禁止记录到日志或返回给客户端**：

- API Key；
- 完整 Prompt 内容；
- 完整 LLM 响应体；
- 堆栈跟踪（仅 `console.error` 内部记录，不返回 HTTP 响应）。

---

## 十七、LlmClient 完整实现规格

### 17.1 构造函数

```ts
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly mock: boolean;

  constructor(configService: ConfigService) {
    this.baseUrl = configService
      .getOrThrow<string>('llm.baseUrl')
      .replace(/\/+$/, '');
    this.apiKey = configService.getOrThrow<string>('llm.apiKey');
    this.model = configService.getOrThrow<string>('llm.model');
    this.temperature = configService.getOrThrow<number>('llm.temperature');
    this.maxTokens = configService.getOrThrow<number>('llm.maxTokens');
    this.timeoutMs = configService.getOrThrow<number>('llm.timeoutMs');
    this.maxRetries = configService.getOrThrow<number>('llm.maxRetries');
    this.mock = configService.getOrThrow<boolean>('llm.mock');
  }
}
```

### 17.2 公开方法

```ts
async chat(messages: ChatMessage[]): Promise<string> {
  if (messages.length === 0) {
    throw new LlmFailure('Chat 消息列表不能为空');
  }

  if (this.mock) {
    return this.mockChat(messages);
  }

  return this.httpChat(messages);
}
```

### 17.3 HTTP 请求 + 重试

与 T07 `EmbeddingClient.httpEmbed()` 完全一致的模式：

```ts
private async httpChat(messages: ChatMessage[]): Promise<string> {
  let lastError: LlmFailure | undefined;

  for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
    try {
      return await this.sendChatRequest(messages);
    } catch (error: unknown) {
      const failure = this.toLlmFailure(error);
      lastError = failure;

      if (!this.isRetryableFailure(failure) || attempt >= this.maxRetries) {
        throw failure;
      }

      const delayMs = this.getRetryDelayMs(failure, attempt);
      this.logger.warn(
        `Chat API 重试（${attempt + 1}/${this.maxRetries}）：原因=${failure.message}，等待=${delayMs}ms`,
      );
      await this.sleep(delayMs);
    }
  }

  throw lastError ?? new LlmFailure('Chat API 请求失败：未知错误');
}
```

### 17.4 sendChatRequest

```ts
private async sendChatRequest(messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
  const requestBody: ChatCompletionRequest = {
    model: this.model,
    messages,
    temperature: this.temperature,
    max_tokens: this.maxTokens,
    stream: false,
  };

  try {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw this.createHttpFailure(response);
    }

    return this.parseChatResponse(await this.parseJson(response));
  } catch (error: unknown) {
    if (this.isAbortError(error)) {
      throw new LlmFailure(
        `Chat API 请求超时（${this.timeoutMs}ms）`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
```

### 17.5 createHttpFailure

与 T07 `EmbeddingClient.createHttpFailure()` 完全一致的模式，只是前缀改为 `Chat API`：

```ts
private createHttpFailure(response: Response): LlmFailure {
  const status = response.status;
  const statusText = response.statusText || 'Unknown';

  if (status === 429) {
    const retryAfterMs = this.getRetryAfterMs(response);
    const suffix = retryAfterMs === null ? '' : `；retryAfterMs=${retryAfterMs}`;
    return new LlmFailure(`Chat API 限流：${status} ${statusText}${suffix}`);
  }

  if ([500, 502, 503, 504].includes(status)) {
    return new LlmFailure(`Chat API 服务端错误：${status} ${statusText}`);
  }

  if (status === 401) {
    return new LlmFailure(`Chat API 认证失败：${status} ${statusText}`);
  }

  if (status === 403) {
    return new LlmFailure(`Chat API 禁止访问：${status} ${statusText}`);
  }

  if (status === 404) {
    return new LlmFailure(`Chat API 地址或模型不存在：${status} ${statusText}`);
  }

  return new LlmFailure(`Chat API 请求失败：${status} ${statusText}`);
}
```

---

## 十八、RagModule 完整规格

```ts
// rag.module.ts
@Module({
  imports: [RetrievalModule, LlmModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
```

```ts
// llm.module.ts
@Module({
  providers: [LlmClient],
  exports: [LlmClient],
})
export class LlmModule {}
```

---

## 十九、基线回填（00-overall-plan.md v1.9，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §7 模块划分补充：`llm` 模块在 T10 创建 | 新增 `LlmModule`（`src/modules/llm/`），含 `LlmClient`（OpenAI 兼容 Chat Completions 客户端，非流式）；仅依赖 `ConfigModule` |
| 2 | §7 模块划分补充：`rag` 模块在 T10 创建 | 新增 `RagModule`（`src/modules/rag/`），含 `RagService`（RAG 编排）和 `RagController`（HTTP 接口）；依赖 `RetrievalModule` + `LlmModule` |
| 3 | §9 API 接口清单补充 #15：`POST /api/knowledge-bases/:id/ask` | T10 新增 RAG 问答测试接口；body `{question, topK?, scoreThreshold?}`；响应 `{answer, references, retrievalTook, llmTook, took}` |
| 4 | §12 环境变量 `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`/`LLM_TEMPERATURE`/`LLM_MAX_TOKENS` 在 T10 实现 | 总体方案 §12 已列出但未实现；T10 首次使用 LLM 配置 |
| 5 | §12 环境变量补充 `LLM_TIMEOUT_MS`/`LLM_MAX_RETRIES`/`LLM_MOCK`/`CONTEXT_MAX_CHARS` | T10 首次实现 LLM 调用，需要显式配置超时、重试、Mock 模式和上下文长度限制 |
| 6 | §4.2 问答流水线 ④⑤⑥ 补充：非流式实现 | ④ 上下文按 score 降序拼接 `[来源i]`，截断到 `CONTEXT_MAX_CHARS`；⑤ System Prompt（中文规则 + 禁止编造）；⑥ T10 调用 Chat API 非流式（`stream=false`），T11 改为流式 |
| 7 | §15 风险 7 更新：LLM 调用的超时、重试和异常处理已在 T10 实现 | T10 实现指数退避重试（429/5xx/超时）、超时控制、响应校验、Mock 模式 |

---

## 二十、验收方式（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功（DB 端口冲突须先解决）。
> **Mock 模式验收**：以下验收命令在 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` + `LLM_MOCK=true` 下执行，无需 Docker Qdrant 或真实 API。
> **真实 Qdrant + Mock LLM 验收**：Docker 可用时使用 `QDRANT_MOCK=false` + `EMBEDDING_MOCK=true` + `LLM_MOCK=true`。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → 完整流水线（parse → chunk → embed → store）
$env:QDRANT_MOCK='true'
$env:EMBEDDING_MOCK='true'
$env:LLM_MOCK='true'
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t10-rag-kb\"}"
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

# 2. 基础 RAG 问答（Mock 模式，同文本 query → 有检索结果 → Mock LLM 回答）
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"What is RAG?\"}"
# 预期：code=0, answer 非空（Mock 回答含"参考资料"字样），references.length>=1
# 预期：references[0] 包含 chunkId, documentId, documentName, pageNo, content, score
# 预期：retrievalTook>0, llmTook>=0, took>0

# 3. 无命中问答（不同文本 → 无检索结果 → 固定话术 → 不调用 LLM）
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"completely unrelated question about cooking\"}"
# 预期：code=0, answer="知识库中未找到与您问题相关的内容。", references=[], llmTook=0

# 4. topK 覆盖
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"What is RAG?\",\"topK\":1}"
# 预期：references.length<=1

# 5. 空问题 → 400
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"\"}"
# 预期：400 参数校验失败

# 6. 不存在的知识库 → 404
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/999999/ask" -H "Content-Type: application/json" -d "{\"question\":\"test\"}"
# 预期：404 知识库不存在

# 7. 空知识库 → 无命中话术
# 新建知识库，不上传任何文档
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t10-empty-kb\"}"
# 记录空知识库 ID，假设为 $emptyKbId
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$emptyKbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"test\"}"
# 预期：code=0, answer="知识库中未找到与您问题相关的内容。", references=[]

# 8. references 一致性检查
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"RAG is retrieval augmented generation\"}"
# 预期：references 中的 content 字段与检索结果一致；references 数量 = 实际进入 Prompt 的 chunk 数

# 9. Swagger 包含新接口
curl.exe http://localhost:3000/api/docs-json | jq '.paths | keys[] | select(contains("ask"))'
# 预期：包含 "knowledge-bases/{id}/ask"

# 10. 越界检查
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：仍只有原 6 张业务表加 migrations（无新表）
curl.exe http://localhost:3000/api/docs-json | jq '.paths | keys | length'
# 预期：比 T09 多 1 个路径（ask）

# 11. 范围扫描
# rg "chat/stream|text/event-stream|EventSource|conversation|message_reference|chat\.module|conversation\.module" server/src/modules/llm server/src/modules/rag server/src/app.module.ts
# 预期：无命中

# 12. 清理
curl.exe -X DELETE "http://localhost:3000/api/knowledge-bases/$kbId"
curl.exe -X DELETE "http://localhost:3000/api/knowledge-bases/$emptyKbId"
Remove-Item -Recurse -Force tmp-test -ErrorAction SilentlyContinue
```

### 20.1 真实 Qdrant + 真实 LLM API 验收（可选，有 API Key + Docker 时执行）

```powershell
$env:QDRANT_MOCK='false'
$env:EMBEDDING_MOCK='false'
$env:LLM_MOCK='false'
$env:EMBEDDING_API_KEY='sk-xxx'
$env:LLM_API_KEY='sk-xxx'

# 上传真实文档，完整流水线后提问
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/ask" -H "Content-Type: application/json" -d "{\"question\":\"什么是RAG\"}"
# 预期：answer 为中文回答，基于文档内容；references 含相关 chunk
```

---

## 二十一、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05-T09）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§四）；`pnpm --filter server build` 通过。
2. 新建 `src/modules/llm/llm.types.ts`（§十一）。
3. 新建 `src/modules/llm/llm-client.ts`（§十七 + §十五）；`pnpm --filter server build` 通过。
4. 新建 `src/modules/llm/llm.module.ts`（§十八）。
5. 新建 `src/modules/rag/rag.types.ts`（§十三）。
6. 新建 `src/modules/rag/prompt-builder.ts`（§六）。
7. 新建 `src/modules/rag/dto/rag-request.dto.ts` + `rag-response.dto.ts`（§十三）。
8. 新建 `src/modules/rag/rag.service.ts`（§十三 + §十六）。
9. 新建 `src/modules/rag/rag.controller.ts`（§十三）。
10. 新建 `src/modules/rag/rag.module.ts`（§十八）。
11. 修改 `app.module.ts`：imports 追加 `LlmModule` + `RagModule`；`pnpm --filter server build` 通过。
12. 回填 `00-overall-plan.md` v1.9（§十九）。
13. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
14. 执行 §二十全量验收（Mock 模式优先；Docker 可用时追加真实 Qdrant + Mock LLM 验收）。

---

## 二十二、明确禁止（本任务一律不实现）

SSE 流式输出、Conversation、Message、MessageReference 落库、历史会话上下文、Rerank、Agent、GraphRAG、前端页面、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入 `langchain`、引入 `openai` SDK、引入 `axios`、引入测试框架（T16 统一补）、修改 processing 模块下任何文件、修改 parsing/chunking 子目录下任何文件、修改 retrieval 模块下任何文件、修改 embedding 模块下任何文件、修改 vector-store 模块下任何文件、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`、修改任何文档的 `status` 字段、上传后自动触发流水线、启动恢复钩子、OCR。

---

## 二十三、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① `RagService` 复用 `RetrievalService.search()` 获取检索结果 ② 无命中短路不调用 LLM ③ `buildContext()` 按 score 降序拼接 `[来源i]`，截断到 `CONTEXT_MAX_CHARS` ④ `buildMessages()` 构建 System Prompt + User Prompt（中文规则 + 禁止编造 + 元数据脱敏） ⑤ `LlmClient` 使用 Node 20 原生 `fetch` + `AbortController`，零新增依赖 ⑥ Chat Completions 非流式调用 ⑦ 指数退避重试（429/5xx/超时） ⑧ `LlmFailure` 异常映射为 502 ⑨ references 与实际使用 chunk 一一对应 ⑩ Mock LLM 确定性回答 ⑪ 日志（检索耗时/LLM 耗时/总耗时/question 截断） ⑫ API Key 安全。
3. **启动方式**：DB 端口冲突处理结果；Qdrant/Embedding/LLM 连接方式；Mock 模式开启方式；RAG 问答触发命令。
4. **验证方式**：§二十逐条结果（成功/失败 + 关键输出；Mock 同文本有检索结果 + Mock LLM 回答；无命中固定话术 + llmTook=0；topK 覆盖；空问题 400；KB 不存在 404；空知识库无命中话术；references 一致性；Swagger 新路径；范围扫描无命中）。
5. **已知问题**：含 Mock 回答无语义、Mock Embedding 无语义相似性、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §二十二各项均未实现。

---

## 二十四、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §二十三。

```
你是一个 NestJS 后端工程师。请按 docs/task-10-rag-generation.md 实现 RAG 生成服务。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. 确认 RetrievalModule 已导出 RetrievalService（T09 已实现）
3. QDRANT_MOCK=true + EMBEDDING_MOCK=true + LLM_MOCK=true 用于无 Docker/API 环境下的验收

## 要做的事（严格按序）

1. 配置：env.validation.ts 加 LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TEMPERATURE(@Min(0) @Max(2)),
   LLM_MAX_TOKENS(@IsInt @Min(1) @Max(8192)), LLM_TIMEOUT_MS(@IsInt @Min(5000) @Max(300000)),
   LLM_MAX_RETRIES(@IsInt @Min(0) @Max(10)), LLM_MOCK(@IsOptional @IsBoolean),
   CONTEXT_MAX_CHARS(@IsInt @Min(500) @Max(20000));
   configuration.ts 加 llm:{baseUrl,apiKey,model,temperature,maxTokens,timeoutMs,maxRetries,mock} + rag:{contextMaxChars};
   .env.example 加对应变量

2. 新建 src/modules/llm/ 目录：
   - llm.types.ts:
     ChatMessage{role:'system'|'user'|'assistant', content:string}
     ChatCompletionRequest{model,messages,temperature,max_tokens,stream:false}
     ChatCompletionChoice{index,message,finish_reason}
     ChatCompletionResponse{id,object,model,choices:ChatCompletionChoice[],usage?}
     LlmFailure extends Error
   - llm-client.ts: @Injectable LlmClient
     · 构造函数注入 ConfigService，读取 llm.* 配置
     · async chat(messages: ChatMessage[]): Promise<string>
       - mock=true → mockChat(messages)：提取来源数量，返回"根据知识库中的 N 条参考资料..."模板
       - mock=false → httpChat(messages)：指数退避重试（同 EmbeddingClient 模式）
     · sendChatRequest: fetch POST {baseUrl}/chat/completions, headers{Authorization:Bearer,Content-Type:application/json},
       body{model,messages,temperature,max_tokens,stream:false}, signal=AbortController(timeoutMs)
     · parseChatResponse: 校验 choices.length>0, choices[0].message.content 非空字符串
     · createHttpFailure: 429→限流, 500/502/503/504→服务端错误, 401→认证失败, 403→禁止访问, 404→地址或模型不存在
     · isRetryableFailure: 包含"请求超时"/"网络错误"/"限流"/"服务端错误"
     · getRetryDelayMs: Retry-After 优先，否则指数退避 base=1000 factor=2 max=30000 jitter=500
   - llm.module.ts: providers=[LlmClient], exports=[LlmClient]

3. 新建 src/modules/rag/ 目录：
   - rag.types.ts:
     RagReference{chunkId,documentId,documentName,pageNo:number|null,content,score}
     RagResponseData{answer,references:RagReference[],retrievalTook,llmTook,took}
   - prompt-builder.ts:
     SYSTEM_PROMPT（中文规则：只基于资料回答/不知道就说不知道/中文/综合归纳/不提标注编号/不提内部元数据）
     buildContext(results, maxChars): {context, usedResultCount} — 按 score 降序拼接 [来源i] content，超 maxChars 停止
     buildUserPrompt(context, question): "参考资料：\n\n{context}\n\n用户问题：{question}"
     buildMessages(context, question): [{role:'system',content:SYSTEM_PROMPT},{role:'user',content:buildUserPrompt}]
   - dto/rag-request.dto.ts: question(@IsString @IsNotEmpty @MaxLength(2000) @Transform trim),
     topK?(@IsOptional @IsInt @Min(1) @Max(20)), scoreThreshold?(@IsOptional @Min(0) @Max(1))
   - dto/rag-response.dto.ts: RagReferenceDto + RagResponseDto (Swagger 展示用)
   - rag.service.ts: @Injectable RagService
     · 构造函数注入 RetrievalService, LlmClient, ConfigService
     · ask(kbId, question, topK?, scoreThreshold?): Promise<RagResponseData>
       a. startedAt = Date.now()
       b. retrievalData = await retrievalService.search(kbId, question, topK, scoreThreshold)
       c. retrievalTook = retrievalData.took
       d. if results.length===0 → log + return {answer:"知识库中未找到与您问题相关的内容。",references:[],retrievalTook,llmTook:0,took}
       e. {context, usedResultCount} = buildContext(results, contextMaxChars)
       f. messages = buildMessages(context, question)
       g. llmStartedAt = Date.now()
       h. answer = await llmClient.chat(messages)
       i. llmTook = Date.now() - llmStartedAt
       j. references = results.slice(0, usedResultCount).map(r → {chunkId,documentId,documentName,pageNo,content,score})
       k. log: 'RAG 问答完成：kbId=...,question="...",resultCount=...,usedCount=...,retrievalTook=...ms,llmTook=...ms,took=...ms'
       l. return {answer, references, retrievalTook, llmTook, took: Date.now()-startedAt}
   - rag.controller.ts: @Controller('knowledge-bases/:id/ask') @ApiTags('rag')
     · @Post() async ask(@Param('id',ParsePositiveIntPipe) id, @Body() dto: RagRequestDto): Promise<RagResponseData>
     · try { return await ragService.ask(...) }
       catch (error) {
         if (error instanceof EmbeddingFailure) throw new BadGatewayException('问答服务暂时不可用：向量生成失败');
         if (error instanceof LlmFailure) throw new BadGatewayException('问答服务暂时不可用：模型调用失败');
         throw error;
       }
   - rag.module.ts: imports[RetrievalModule, LlmModule], controllers=[RagController], providers=[RagService], exports=[RagService]

4. app.module.ts: imports 加 LlmModule + RagModule

5. 回填 00-overall-plan.md v1.9

## 不做的事
- 不做 SSE/流式输出/Conversation/Message/MessageReference落库/历史会话上下文
- 不做 Rerank/Agent/GraphRAG/前端
- 不做新 migration/新表/改实体/改 web/
- 不引入 langchain/openai SDK/axios/测试框架
- 不修改 processing/parsing/chunking/retrieval/embedding/vector-store 模块下任何文件
- 不修改 KnowledgeBaseService/DocumentService
- 不修改全局异常过滤器/main.ts/docker-compose.yml/ResponseInterceptor
- 不修改任何文档的 status 字段（RAG 问答是只读操作）

## 验收（QDRANT_MOCK=true + EMBEDDING_MOCK=true + LLM_MOCK=true）
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- 基础问答: 同文本 question → answer 非空(Mock回答含"参考资料"), references.length>=1, references含完整字段
- 无命中: 不同文本 question → answer="知识库中未找到与您问题相关的内容。", references=[], llmTook=0
- topK=1 → references.length<=1
- 空问题 → 400
- 不存在的KB → 404
- 空知识库 → 无命中话术
- references 一致性: references 数量 = 实际进入 Prompt 的 chunk 数
- Swagger 包含 ask 路径
- SHOW TABLES 无新表
- rg 范围扫描: 无 SSE/conversation/message_reference/chat.module 命中
- 清理: 业务表回0行
```
