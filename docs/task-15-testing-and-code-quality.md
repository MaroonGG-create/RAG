# T15 测试与代码质量收口 — 设计文档

> 任务编号：T15（阶段 P10：测试与代码质量）
> 前置条件：T14 已完成（结论：**通过**，见 `docs/reports/task-14-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v2.3）
> 实现依据：`docs/01-current-implementation.md`（T14 后快照）+ `docs/reports/task-14-completion.md`
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、任务定位

T15 是 MVP 交付前的测试与代码质量收口任务。**不新增业务功能**，只做：

1. 为后端核心 Service 补充单元测试
2. 为前端 API、SSE 解析和关键状态逻辑补充测试
3. 补充核心接口集成测试
4. 统一 lint、type-check、build 检查
5. 检查显式 `any`、未处理 Promise、无用代码和调试日志
6. 检查环境变量校验和敏感信息泄漏
7. 输出项目测试命令和测试覆盖范围

---

## 二、当前可复用实现盘点

### 2.1 测试现状（零测试基线）

| 项 | server/ | web/ |
|---|---|---|
| 测试框架 | **未安装** | **未安装** |
| 测试配置 | 无 `jest.config.*` | 无 `vitest.config.*` |
| 测试文件 | 0 个 `.spec.ts` / `.test.ts` | 0 个 `.spec.ts` / `.test.ts` |
| test 脚本 | 无 | 无 |
| ESLint 配置 | 无 | 无 |

> T15 需从零搭建测试基础设施。

### 2.2 后端可测纯函数（无需 mock，直接输入输出测试）

| 文件 | 函数 | 说明 |
|---|---|---|
| `server/src/modules/processing/chunking/text-cleaner.ts` | `cleanText(text: string): string` | 纯函数：`\r\n`/`\r` → `\n`，移除零宽字符，压缩 3+ 连续换行，`trim()` |
| `server/src/modules/processing/chunking/text-splitter.ts` | `splitText(text, chunkSize, chunkOverlap): string[]` | 纯函数：递归分割 + overlap 合并；导出 `SEPARATORS` 常量 |
| `server/src/modules/processing/parsing/plain-text.parser.ts` | `decodePlainText(buffer: Buffer): string` | 纯函数：BOM 检测、UTF-8/UTF-16 LE/BE 解码、空文件和非法编码检测 |
| `server/src/modules/rag/prompt-builder.ts` | `buildRagPrompt(question, results, maxChars): BuiltPrompt` | 纯函数：上下文组装、`[来源N]` 标注、maxChars 截断 |

### 2.3 后端可测 Service（需 mock 依赖）

| Service | 文件 | 关键方法 | Mock 依赖 |
|---|---|---|---|
| `EmbeddingClient` | `embedding-client.ts` | `embed(texts): number[][]`，Mock 模式确定性向量，HTTP 重试/超时/响应校验 | 无（mock 模式不需外部依赖） |
| `EmbeddingService` | `embedding.service.ts` | `embedDocument(id)`, `embedQuery(query)`, `assertVectorBatch()`, `createBatches()` | DocumentRepository, ChunkRepository, EmbeddingClient, ConfigService |
| `VectorStoreService` | `vector-store.service.ts` | `search()`, `deleteByDocumentId()`, `deleteByKnowledgeBaseId()`, `storeDocument()` | QdrantClient, DocumentRepository, ChunkRepository, EmbeddingService, ConfigService |
| `RetrievalService` | `retrieval.service.ts` | `search()`, `findCompletedDocumentIds()`, `mapResults()`, `getInvalidPayloadField()` | KnowledgeBaseRepository, DocumentRepository, EmbeddingService, VectorStoreService, ConfigService |
| `ChatService` | `chat.service.ts` | `streamChat()`, `prepareConversation()`, `createReferenceSnapshots()` | RetrievalService, LlmClient, ConversationService, ConfigService |
| `ConversationService` | `conversation.service.ts` | `createConversation()`, `findConversationOrThrow()`, `findConversationsByKnowledgeBaseId()`, `remove()` | ConversationRepository, MessageRepository, MessageReferenceRepository |
| `DocumentService` | `document.service.ts` | `upload()`, `remove()`, `assertPdfHeader()`, `isDuplicateEntryError()` | DocumentRepository, ChunkRepository, KnowledgeBaseService, VectorStoreService, StorageService, ParsedResultStore |
| `KnowledgeBaseService` | `knowledge-base.service.ts` | `create()`, `remove()`（级联清理） | KnowledgeBaseRepository, VectorStoreService, DocumentRepository, StorageService, ParsedResultStore |
| `ChunkingService` | `chunking.service.ts` | `chunkDocument()`, `createChunks()`（逐页分割保持页码） | DocumentRepository, ChunkRepository, ConfigService, ParsedResultStore |
| `ParsingService` | `parsing.service.ts` | `parseDocument()`, `resolveStoragePath()`（路径遍历防护） | DocumentRepository, StorageService, ParsedResultStore |

### 2.4 前端可测文件

| 文件 | 可测内容 | 说明 |
|---|---|---|
| `web/src/api/sse.ts` | `fetchSseChat()`, `parseSseFrame()`（内部函数）, 半包/粘包处理, error 事件 | 需 mock `fetch`、`ReadableStream`、`AbortSignal` |
| `web/src/api/http.ts` | `ApiError` 类, Axios 拦截器（成功解包、错误包装） | 需 mock Axios |
| `web/src/composables/use-chat.ts` | `sendMessage()` 状态机, `stopGeneration()`, `loadHistory()` | 需 mock API 调用，用 `@vue/test-utils` 的 `defineComponent` + `setup` |
| `web/src/composables/use-conversations.ts` | `fetchConversations()`, `refreshConversations()`, `removeConversation()` | 需 mock API |

### 2.5 TypeScript 配置现状

| 配置 | server/ | web/ |
|---|---|---|
| `strict` | ✅ | ✅ |
| `noUnusedLocals` | ❌ 未设置 | ✅ |
| `noUnusedParameters` | ❌ 未设置 | ✅ |
| `noFallthroughCasesInSwitch` | ❌ 未设置 | ✅ |
| ESLint | ❌ 无配置 | ❌ 无配置 |

> T15 需为 server 补充 `noUnusedLocals` / `noUnusedParameters`，并为两端补充 ESLint 配置。

### 2.6 代码约定（禁止违反）

- 前端：kebab-case 文件名、显式返回类型、`catch` 用 `unknown`、禁显式 `any`、Ant Design Vue 按需导入
- 后端：NestJS 模块化、`@SkipResponseWrap()` 仅用于 SSE、统一响应 `{code:0,message:'success',data}` / 错误 `{code,message,details?}`
- CLI 脚本（`server/src/scripts/`）中的 `console.log` / `console.error` 保留（脚本输出用途）
- 前后端均不使用 `localStorage` / `sessionStorage` 缓存业务数据

---

## 三、目标与非目标

### 3.1 目标（只做这些）

1. 搭建后端测试基础设施（Jest + ts-jest + @nestjs/testing）
2. 搭建前端测试基础设施（Vitest + @vue/test-utils + jsdom）
3. 后端纯函数单元测试（text-cleaner、text-splitter、plain-text-parser、prompt-builder）
4. 后端 Service 单元测试（EmbeddingClient、EmbeddingService、VectorStoreService、RetrievalService、ChatService、ConversationService、DocumentService、KnowledgeBaseService）
5. 前端单元测试（SSE 解析、ApiError、use-chat 状态机）
6. 核心接口集成测试（E2E）
7. 统一 lint、type-check、build 检查
8. 检查显式 `any`、未处理 Promise、无用代码和调试日志
9. 检查环境变量校验和敏感信息泄漏
10. 输出测试命令和覆盖范围

### 3.2 非目标（明确不做）

| 项 | 原因 |
|---|---|
| 新业务功能 | T15 只做测试和质量收口 |
| 大规模重构 | 禁止 |
| 登录权限 | MVP 不做 |
| Agent / Rerank / GraphRAG | MVP 不做 |
| 为追求覆盖率测试第三方库 | 只测自有代码 |
| 修改已执行 Migration | 禁止 |
| 修改 API 路径或 SSE 协议 | 冻结级约定 |
| 新增核心业务依赖 | 只新增测试依赖 |
| 修改后端业务逻辑 | T15 不改业务代码，除非 lint/type-check 发现问题 |

---

## 四、测试框架搭建

### 4.1 后端测试框架（Jest）

**新增依赖**（devDependencies）：

```bash
cd server && pnpm add -D jest@^29 @types/jest@^29 ts-jest@^29 @nestjs/testing@^10
```

> `@nestjs/cli` 已安装，`@nestjs/testing` 版本需与 `@nestjs/common` 对齐（^10.4.x）。

**新增配置文件** `server/jest.config.ts`：

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'modules/**/*.ts',
    '!modules/**/*.module.ts',
    '!modules/**/*.dto.ts',
    '!modules/**/*.entity.ts',
    '!main.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {},
  verbose: true,
};

export default config;
```

**新增 `server/package.json` 脚本**：

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  }
}
```

### 4.2 前端测试框架（Vitest）

**新增依赖**（devDependencies）：

```bash
cd web && pnpm add -D vitest@^2 @vue/test-utils@^2 jsdom@^25 @vitest/coverage-v8@^2
```

**新增配置文件** `web/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/api/**/*.ts',
        'src/composables/**/*.ts',
        'src/types/**/*.ts',
      ],
      exclude: ['src/**/*.spec.ts'],
    },
  },
});
```

**新增 `web/package.json` 脚本**：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage"
  }
}
```

### 4.3 集成测试（E2E）框架

后端 E2E 测试使用 `@nestjs/testing` 的 `Test.createTestingModule()` + `supertest`：

```bash
cd server && pnpm add -D supertest@^7 @types/supertest@^6
```

**新增配置** `server/test/jest-e2e.json`：

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.ts$": "ts-jest"
  }
}
```

---

## 五、后端纯函数单元测试

### 5.1 text-cleaner.spec.ts

**文件**：`server/src/modules/processing/chunking/__tests__/text-cleaner.spec.ts`

**测试用例**：

| # | 用例名 | 输入 | 预期 |
|---|---|---|---|
| 1 | Windows 换行统一 | `'a\r\nb\r\nc'` | `'a\nb\nc'` |
| 2 | 旧 Mac 换行统一 | `'a\rb\rc'` | `'a\nb\nc'` |
| 3 | 移除零宽字符 | `'a\u200Bb\u200Cc\u200Dd\uFEFFe'` | `'abcde'` |
| 4 | 3+ 连续换行压缩为 2 | `'a\n\n\n\nb'` | `'a\n\nb'` |
| 5 | 恰好 2 个换行不压缩 | `'a\n\nb'` | `'a\n\nb'` |
| 6 | 首尾空白 trim | `'  hello  '` | `'hello'` |
| 7 | 空字符串 | `''` | `''` |
| 8 | 组合场景 | `'  \r\n\u200Btext\r\n\r\n\r\n  '` | `'text'` |
| 9 | 纯空白字符串 | `'   \n\n  '` | `''` |

### 5.2 text-splitter.spec.ts

**文件**：`server/src/modules/processing/chunking/__tests__/text-splitter.spec.ts`

**测试用例**：

| # | 用例名 | 输入参数 | 预期 |
|---|---|---|---|
| 1 | chunkSize ≤ 0 抛异常 | `('text', 0, 0)` | `throw Error('chunkSize 必须大于 0')` |
| 2 | overlap < 0 抛异常 | `('text', 100, -1)` | `throw Error('chunkOverlap 必须大于等于 0...')` |
| 3 | overlap ≥ chunkSize 抛异常 | `('text', 100, 100)` | `throw Error('chunkOverlap 必须大于等于 0...')` |
| 4 | 短文本单 chunk | `('hello', 500, 100)` | `['hello']` |
| 5 | 空字符串 | `('', 500, 100)` | `[]` |
| 6 | 按段落分割 | 1000 字含 `\n\n` 分隔 | 每个 chunk ≤ 500 字符 |
| 7 | 按句号分割 | 中文含 `。` 的长文本 | 每个 chunk ≤ chunkSize |
| 8 | hardSplit 无分隔符长文本 | 600 字无任何分隔符 | 每个 chunk ≤ chunkSize |
| 9 | overlap 正确合并 | `chunkSize=100, overlap=20`，长文本 | 相邻 chunk 尾部和头部有 20 字符重叠 |
| 10 | chunk 不超 chunkSize | 任意长文本 | `chunks.every(c => c.length <= chunkSize)` |
| 11 | 实际参数（500/100） | 2000 字中文文本 | 每个 chunk ≤ 500，相邻 chunk 有 100 字符重叠 |
| 12 | SEPARATORS 常量完整 | — | 导出的数组包含 `'\n\n'`、`'\n'`、`'。'`、`'！'`、`'？'`、`'. '`、`'! '`、`'? '`、`' '`、`''` |

### 5.3 plain-text.parser.spec.ts

**文件**：`server/src/modules/processing/parsing/__tests__/plain-text.parser.spec.ts`

**测试用例**：

| # | 用例名 | 输入 | 预期 |
|---|---|---|---|
| 1 | UTF-8 无 BOM | `Buffer.from('hello', 'utf8')` | `'hello'` |
| 2 | UTF-8 with BOM | `Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]), Buffer.from('hello','utf8')])` | `'hello'` |
| 3 | UTF-16 LE with BOM | `Buffer.from([0xFF,0xFE, ...])` | 正确解码为字符串 |
| 4 | UTF-16 BE with BOM | `Buffer.from([0xFE,0xFF, ...])` | 正确解码为字符串 |
| 5 | 空内容抛异常 | `Buffer.from('', 'utf8')` | `throw ParseFailure('文件内容为空')` |
| 6 | 纯空白抛异常 | `Buffer.from('   \n  ', 'utf8')` | `throw ParseFailure('文件内容为空')` |
| 7 | 含 U+FFFD 抛异常 | `Buffer.from([0xFF, 0xFE, ...])`（非法编码） | `throw ParseFailure('文件编码无法识别...')` |
| 8 | 中文 UTF-8 | `Buffer.from('你好世界', 'utf8')` | `'你好世界'` |

### 5.4 prompt-builder.spec.ts

**文件**：`server/src/modules/rag/__tests__/prompt-builder.spec.ts`

**测试用例**：

| # | 用例名 | 输入 | 预期 |
|---|---|---|---|
| 1 | 空检索结果 | `('question', [], 4000)` | `context === ''`, `usedResultCount === 0` |
| 2 | 单条结果未超限 | `('q', [{content:'hello'}], 4000)` | `context` 含 `[来源1] hello`，`usedResultCount === 1` |
| 3 | 多条结果拼接 | 3 条结果，每条 100 字，maxChars=4000 | `usedResultCount === 3`，context 含 `[来源1]`/`[来源2]`/`[来源3]` |
| 4 | 超限截断 | 2 条结果，每条 3000 字，maxChars=4000 | `usedResultCount === 1`（第一条放入后剩余空间不足放第二条） |
| 5 | 第一条就超限 | 1 条 5000 字结果，maxChars=4000 | `usedResultCount === 1`，context 截断为 maxChars 长度 |
| 6 | messages 结构 | 任意 | `messages[0].role === 'system'`，`messages[1].role === 'user'` |
| 7 | system prompt 不含来源编号 | — | SYSTEM_PROMPT 中不含 `来源1` 等字样（验证防编造规则） |
| 8 | user prompt 包含问题和上下文 | — | userPrompt 含 `用户问题：` 和 `参考资料：` |

---

## 六、后端 Service 单元测试

### 6.1 embedding-client.spec.ts

**文件**：`server/src/modules/embedding/__tests__/embedding-client.spec.ts`

**测试策略**：利用 `EMBEDDING_MOCK=true` 模式测试确定性向量生成；用 `jest.spyOn(global, 'fetch')` mock HTTP 请求测试重试和错误分类。

| # | 用例名 | 策略 | 预期 |
|---|---|---|---|
| 1 | 空数组返回空 | `embed([])` | `[]` |
| 2 | Mock 模式确定性向量 | `mock=true, dimension=8`，同文本调两次 | 返回相同向量 |
| 3 | Mock 向量维度正确 | `mock=true, dimension=16` | `vectors[0].length === 16` |
| 4 | Mock 向量 L2 归一化 | `mock=true` | `vector` 模长约等于 1 |
| 5 | HTTP 成功 | `mock=false`, mock fetch 返回正常响应 | 返回排序后的向量数组 |
| 6 | HTTP 429 限流重试 | mock fetch 第一次 429 + Retry-After，第二次成功 | 重试一次后成功 |
| 7 | HTTP 500 服务端错误重试 | mock fetch 第一次 500，第二次成功 | 重试一次后成功 |
| 8 | HTTP 401 不重试 | mock fetch 返回 401 | `throw EmbeddingFailure`，不重试 |
| 9 | 超时 | mock fetch 抛 AbortError | `throw EmbeddingFailure('...请求超时...')` |
| 10 | 响应 index 不连续 | mock fetch 返回 `{data: [{index:0,...},{index:2,...}]}` | `throw EmbeddingFailure('...index 不连续')` |
| 11 | 响应结构不兼容 | mock fetch 返回 `{foo: 'bar'}` | `throw EmbeddingFailure('...结构不兼容')` |
| 12 | 网络错误包装 | mock fetch 抛 TypeError | `throw EmbeddingFailure('...网络错误...')` |

### 6.2 embedding.service.spec.ts

**文件**：`server/src/modules/embedding/__tests__/embedding.service.spec.ts`

**测试策略**：mock `DocumentRepository`、`ChunkRepository`、`EmbeddingClient`、`ConfigService`。

| # | 用例名 | 策略 | 预期 |
|---|---|---|---|
| 1 | embedQuery 返回单向量 | mock embedClient.embed 返回 `[vector]` | 返回 `vector` |
| 2 | embedQuery 数量不一致 | mock embedClient.embed 返回 `[]` | `throw EmbeddingFailure` |
| 3 | embedQuery 维度校验 | mock 返回错误维度向量 | `throw EmbeddingFailure('...维度不一致')` |
| 4 | embedDocument 并发去重 | 同 documentId 调两次 | 返回同一个 Promise |
| 5 | embedDocument 文档不存在 | mock documentRepository.findOne 返回 null | `throw NotFoundException` |
| 6 | embedDocument 已完成禁止重复 | mock document status='completed' | `throw EmbeddingFailure('...禁止重复嵌入')` |
| 7 | embedDocument 无切片 | mock chunkRepository.find 返回 [] | `throw EmbeddingFailure('...尚未切片...')` |
| 8 | embedDocument 分批处理 | 45 个 chunk, batchSize=20 | 3 批，每批调用 embed 一次 |
| 9 | embedDocument 向量数量校验 | mock embed 返回数量不匹配 | `throw EmbeddingFailure('...数量不一致')` |
| 10 | embedDocument 向量包含 NaN | mock 返回 `[NaN, Infinity]` | `throw EmbeddingFailure('...非有限数值')` |
| 11 | embedDocument 失败落库 | mock embed 抛异常 | document status 更新为 'failed' |
| 12 | createBatches 分批逻辑 | 45 chunk, batchSize=20 | `[[20],[20],[5]]` |

### 6.3 retrieval.service.spec.ts

**文件**：`server/src/modules/retrieval/__tests__/retrieval.service.spec.ts`

**测试策略**：mock `KnowledgeBaseRepository`、`DocumentRepository`、`EmbeddingService`、`VectorStoreService`、`ConfigService`。

| # | 用例名 | 策略 | 预期 |
|---|---|---|---|
| 1 | 空 query 抛异常 | `search(1, '  ')` | `throw BadRequestException` |
| 2 | 知识库不存在 | mock KB repo 返回 null | `throw NotFoundException` |
| 3 | 无已完成文档 | mock documentRepository.find 返回 [] | `{results:[], total:0}` |
| 4 | 无命中结果 | mock vectorStore.search 返回 [] | `{results:[], total:0}` |
| 5 | 正常命中 | mock search 返回有效 payload | results 按 score 降序 |
| 6 | 过滤非 completed 文档 | search 返回 docId=99，但 validDocumentIds 只含 docId=1 | results 不含 docId=99 |
| 7 | payload 缺字段跳过 | search 返回缺 chunkId 的 payload | 该结果被跳过 |
| 8 | topK 覆盖 | 传入 topK=3 | vectorStore.search 被调用时 limit=3 |
| 9 | scoreThreshold 覆盖 | 传入 scoreThreshold=0.8 | vectorStore.search 被调用时 threshold=0.8 |
| 10 | 默认值 | 不传 topK/scoreThreshold | 使用 config 默认值 |

### 6.4 chat.service.spec.ts

**文件**：`server/src/modules/chat/__tests__/chat.service.spec.ts`

**测试策略**：mock `RetrievalService`、`LlmClient`、`ConversationService`、`MessageRepository`、`MessageReferenceRepository`、`ConfigService`、`Response`、`AbortSignal`。

| # | 用例名 | 策略 | 预期 |
|---|---|---|---|
| 1 | 无检索结果不调 LLM | mock retrieval.search 返回空 | 不调用 llmClient.chatStream，返回固定话术 |
| 2 | 正常流程事件序列 | mock retrieval 有结果 + LLM 流式返回 | 依次调用 SseWriter: metadata → token×N → references → done |
| 3 | 同会话并发去重 | 同 conversationId 已在 inFlight | `throw ConflictException` |
| 4 | 客户端断开保存部分内容 | mock abortSignal.aborted=true | 保存 failed 助手消息，已生成内容保存 |
| 5 | LLM 失败发送 error 事件 | mock llmClient.chatStream 抛异常 | 发送 SSE error 事件，保存 failed 消息 |
| 6 | 新会话创建 | conversationId 为 undefined | 调用 createConversation |
| 7 | 已有会话复用 | conversationId 有值 | 调用 findConversationInKnowledgeBaseOrThrow |
| 8 | references 快照正确 | mock retrieval 返回 2 条结果 | references 事件含 2 条 ReferenceSnapshot |

### 6.5 conversation.service.spec.ts

**文件**：`server/src/modules/conversation/__tests__/conversation.service.spec.ts`

| # | 用例名 | 预期 |
|---|---|---|
| 1 | 创建会话标题截断 | 超长标题截断至 200 字符 |
| 2 | findConversationOrThrow 不存在 | throw NotFoundException |
| 3 | findConversationsByKnowledgeBaseId | 返回会话列表 |
| 4 | remove 先查找再删除 | 不存在时 throw NotFoundException |
| 5 | findConversationInKnowledgeBaseOrThrow 跨库 | 会话不属于该 KB 时 throw NotFoundException |

### 6.6 document.service.spec.ts

**文件**：`server/src/modules/document/__tests__/document.service.spec.ts`

| # | 用例名 | 预期 |
|---|---|---|
| 1 | upload PDF 头校验 | 非 `%PDF-` 开头 → throw BadRequestException |
| 2 | upload 哈希去重 | mock ER_DUP_ENTRY → throw ConflictException |
| 3 | upload 死锁重试 | mock ER_LOCK_DEADLOCK 一次 → 重试成功 |
| 4 | remove 向量清理 | 调用 vectorStoreService.deleteByDocumentId |
| 5 | remove 文件清理 | 调用 storageService 和 parsedResultStore 清理 |
| 6 | findOne 返回切片预览 | 返回前 20 条 chunk |

### 6.7 knowledge-base.service.spec.ts

**文件**：`server/src/modules/knowledge-base/__tests__/knowledge-base.service.spec.ts`

| # | 用例名 | 预期 |
|---|---|---|
| 1 | create 重名检测 | mock ER_DUP_ENTRY → throw ConflictException |
| 2 | findOne 不存在 | throw NotFoundException |
| 3 | remove 级联清理顺序 | ① Qdrant → ② 文档文件 → ③ 解析缓存 → ④ KB 目录 → ⑤ DB |
| 4 | remove 文件清理失败不阻断 | storageService 抛异常 → warn 日志，继续删除 DB |

### 6.8 vector-store.service.spec.ts

**文件**：`server/src/modules/vector-store/__tests__/vector-store.service.spec.ts`

| # | 用例名 | 预期 |
|---|---|---|
| 1 | search 传递 knowledgeBaseId 过滤 | QdrantClient.search 被调用时 filter 含 knowledgeBaseId |
| 2 | search 传递 topK 和 scoreThreshold | 参数正确传递 |
| 3 | deleteByDocumentId 调用 QdrantClient delete | 使用 Filter 删除 |
| 4 | deleteByKnowledgeBaseId 调用 QdrantClient delete | 使用 Filter 删除 |
| 5 | storeDocument 写入数量校验 | upsert 数量与 chunk 数量不匹配 → throw |

---

## 七、前端单元测试

### 7.1 sse.spec.ts

**文件**：`web/src/api/__tests__/sse.spec.ts`

**测试策略**：mock `fetch` 返回自定义 `Response`，构造 `ReadableStream` 模拟 SSE 流。

| # | 用例名 | 策略 | 预期 |
|---|---|---|---|
| 1 | 正常事件序列 | 构造 `metadata\ntoken\ntoken\nreferences\ndone` 帧 | 各回调按序调用 |
| 2 | 半包处理 | 将一帧拆成两个 chunk 投递 | 回调仍正确触发 |
| 3 | 粘包处理 | 两帧合并在一个 chunk 中 | 两个回调均触发 |
| 4 | 多行 data 拼接 | `data: {"a":1}\ndata: {"b":2}` 构造的帧 | 两行用 `\n` 拼接后 JSON.parse |
| 5 | error 事件 | `event: error\ndata: {"message":"fail"}` | `onError` 回调被调用 |
| 6 | HTTP 错误 | mock response.ok=false, status=409 | `onNetworkError` 收到 ApiError |
| 7 | HTTP 错误带 JSON body | mock response 返回 `{code:409,message:"冲突"}` | ApiError.message 为 "冲突" |
| 8 | HTTP 错误无 JSON body | mock response 返回 HTML | ApiError.message 为 `请求失败（500）` |
| 9 | abort 静默退出 | abortSignal.aborted=true 时 fetch 抛异常 | 不调用任何回调 |
| 10 | 流读取异常 | mock reader.read() 抛异常 | `onNetworkError` 被调用 |
| 11 | 空响应体 | response.body=null | `onNetworkError('流式响应为空')` |
| 12 | 注释行跳过 | `: comment\nevent: token\ndata: {...}` | 注释被忽略，正常解析 |
| 13 | 流结束时残留帧 | 最后一个 chunk 不以 `\n\n` 结尾 | flush 时正确解析 |
| 14 | 无 event 行的帧跳过 | `data: {...}`（无 event:） | 不触发任何回调 |
| 15 | 无 data 行的帧跳过 | `event: token`（无 data:） | 不触发任何回调 |

### 7.2 http.spec.ts

**文件**：`web/src/api/__tests__/http.spec.ts`

| # | 用例名 | 预期 |
|---|---|---|
| 1 | ApiError 构造 | `new ApiError('msg', {status:404, code:404})` | 属性正确设置 |
| 2 | 成功响应解包 | 拦截器收到 `{code:0, message:'success', data:{id:1}}` | 返回 `{id:1}` |
| 3 | 错误响应包装 | 拦截器收到 axios error，response.data=`{code:404,message:'不存在'}` | reject ApiError |
| 4 | 网络错误包装 | axios error 无 response | reject ApiError('网络请求失败') |
| 5 | 非 ApiResponse 透传 | response.data 不含 code/message | 原样返回 |

### 7.3 use-chat.spec.ts

**文件**：`web/src/composables/__tests__/use-chat.spec.ts`

**测试策略**：mock `sendChatMessage`、`listMessages`，用 `defineComponent` + `setup` 包装 composable。

| # | 用例名 | 预期 |
|---|---|---|
| 1 | 初始状态 | `generationStatus === 'idle'`, `messages === []` |
| 2 | sendMessage 状态流转 | 调用后 status: idle → connecting → generating → completed |
| 3 | sendMessage 空问题 | `sendMessage('  ')` → 不发送，status 保持 idle |
| 4 | sendMessage 生成中禁止重复 | status='generating' 时再调 → 不发送 |
| 5 | stopGeneration 状态 | 调用后 status='aborted' |
| 6 | onMetadata 设置 conversationId | metadata 回调后 `currentConversationId` 有值 |
| 7 | onToken 增量更新 | 助手消息 content 逐步追加 |
| 8 | onError 标记失败 | error 回调后助手消息 status='failed' |
| 9 | loadHistory 加载消息 | mock listMessages 返回数据 → messages 填充 |
| 10 | loadHistory 生成中先停止 | status='generating' 时调 loadHistory → 先 stopGeneration |

---

## 八、集成测试（E2E）

### 8.1 后端 E2E 测试

**目录**：`server/test/`

**文件**：`server/test/chat.e2e-spec.ts`

**测试策略**：使用 `@nestjs/testing` 创建完整应用实例，mock 外部依赖（EmbeddingClient 用 mock 模式、VectorStoreService mock QdrantClient、LlmClient mock API），用 `supertest` 发送真实 HTTP 请求。

| # | 用例名 | 验证重点 |
|---|---|---|
| 1 | 知识库 CRUD 完整流程 | POST → GET → GET/:id → DELETE |
| 2 | 文档上传 + 去重 | 上传后重复上传返回 409 |
| 3 | 文档删除级联 | 删除文档后 chunk 表无残留 |
| 4 | 会话列表排序 | 按 `updatedAt DESC` 排序 |
| 5 | 消息历史含引用 | GET messages 返回 assistant 消息带 references |
| 6 | 删除会话级联 | 删除后 message 和 reference 表无残留 |
| 7 | 检索接口 filter | retrieve 接口只返回指定 knowledgeBaseId 的结果 |
| 8 | 问答接口无检索结果不调 LLM | ask 接口无命中时返回固定话术，不调用 LLM |
| 9 | SSE 问答事件序列 | chat 接口返回 `metadata → token → references → done` |
| 10 | 删除知识库级联 | 删除后 documents/conversations/messages/references 表无残留 |

### 8.2 E2E Mock 策略

```typescript
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(EmbeddingClient)
  .useValue({ embed: jest.fn().mockResolvedValue([[0.1, 0.2, ...]]) })
  .overrideProvider(VectorStoreService)
  .useValue({
    search: jest.fn().mockResolvedValue([...]),
    deleteByDocumentId: jest.fn().mockResolvedValue(undefined),
    deleteByKnowledgeBaseId: jest.fn().mockResolvedValue(undefined),
    storeDocument: jest.fn().mockResolvedValue({ stored: 0 }),
  })
  .overrideProvider(LlmClient)
  .useValue({
    chat: jest.fn().mockResolvedValue({ content: 'mock answer' }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { delta: 'mock' };
    }),
  })
  .compile();
```

> E2E 测试需要真实 MySQL（可用 Docker 中的 MySQL 或内存数据库）。为避免污染开发库，E2E 测试使用单独的 `DB_NAME=mini_rag_test`。

---

## 九、优先测试矩阵（8 项验收清单）

| # | 优先测试项 | 测试文件 | 关键用例 |
|---|---|---|---|
| 1 | 文本切片边界和 overlap | `text-splitter.spec.ts` | 用例 4-11：chunkSize 边界、overlap 合并、hardSplit |
| 2 | PDF 页码保留 | `chunking.service.spec.ts` | 逐页分割、PDF pageNo 正确传递到 chunk |
| 3 | Embedding 数量与维度校验 | `embedding.service.spec.ts` | 用例 3、9、10、12：维度不一致、数量不匹配、非有限数值 |
| 4 | Qdrant knowledgeBaseId 过滤 | `retrieval.service.spec.ts` + `vector-store.service.spec.ts` | 用例 6-7：过滤非 completed 文档、payload 校验 |
| 5 | 无检索结果时禁止模型编造 | `chat.service.spec.ts` + `prompt-builder.spec.ts` | 无结果不调 LLM + system prompt 规则 |
| 6 | SSE 半包、粘包和 error 事件 | `sse.spec.ts` | 用例 2-5：半包、粘包、多行 data、error 事件 |
| 7 | 会话、消息和引用落库一致性 | `chat.service.spec.ts` + `conversation.service.spec.ts` | 引用快照保存、消息 status 落库 |
| 8 | 删除文档和知识库后的数据清理 | `document.service.spec.ts` + `knowledge-base.service.spec.ts` | 级联清理顺序、文件清理失败不阻断 |

---

## 十、Lint 与代码质量检查

### 10.1 ESLint 配置

**后端** `server/.eslintrc.cjs`（新建）：

```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'plugin:@typescript-eslint/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'jest.config.ts', 'dist', 'coverage', 'test'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'off',
  },
};
```

需安装：`pnpm --filter server add -D eslint@^8 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8`

**前端** `web/.eslintrc.cjs`（新建）：

```javascript
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'vue/multi-word-component-names': 'off',
  },
};
```

需安装：`pnpm --filter web add -D eslint@^8 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 eslint-plugin-vue@^9`

### 10.2 新增 lint 脚本

**server/package.json**：
```json
"lint": "eslint \"{src,test}/**/*.ts\" --fix",
"lint:check": "eslint \"{src,test}/**/*.ts\""
```

**web/package.json**：
```json
"lint": "eslint \"src/**/*.{ts,vue}\" --fix",
"lint:check": "eslint \"src/**/*.{ts,vue}\""
```

### 10.3 TypeScript 严格性补齐

为 `server/tsconfig.json` 补充：

```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

> 修改后需运行 `pnpm --filter server build` 确认无报错。如有 `noUnusedLocals` 报错，清理未使用的变量/import（不改业务逻辑）。

### 10.4 代码质量检查项

| # | 检查项 | 命令 | 预期 |
|---|---|---|---|
| 1 | 前端无显式 any | `rg "\bany\b" web/src --type ts` | 无命中（类型守卫中的 `unknown` 不算） |
| 2 | 后端无显式 any（warn 级） | `rg ":\s*any\b" server/src --type ts` | 审查后清理或改 `unknown` |
| 3 | 前端无 console.log/debug | `rg "console\.(log\|debug)" web/src` | 无命中 |
| 4 | 后端生产代码无 console（排除 scripts） | `rg "console\.(log\|error\|warn)" server/src --type ts -g '!**/scripts/**'` | 无命中（T14 已完成） |
| 5 | 无 debugger | `rg "debugger\b" web/src server/src` | 无命中 |
| 6 | 无未处理 Promise | `rg "\.then\(" web/src server/src --type ts` | 审查：如有 `.then()` 无 `.catch()` 则补 `await` 或 `.catch()` |
| 7 | 无 Mock/fake/dummy/EventSource/WebSocket | `rg "Mock\|mock\|fake\|dummy\|EventSource\|WebSocket" web/src` | 无命中（测试文件除外） |
| 8 | 无 localStorage/sessionStorage | `rg "localStorage\|sessionStorage" web/src server/src` | 无命中 |
| 9 | 前端 lint 通过 | `pnpm --filter web lint:check` | 通过 |
| 10 | 后端 lint 通过 | `pnpm --filter server lint:check` | 通过 |
| 11 | 前端 type-check 通过 | `pnpm --filter web type-check` | 通过 |
| 12 | 后端 build 通过 | `pnpm --filter server build` | 通过 |
| 13 | 前端 build 通过 | `pnpm --filter web build` | 通过 |
| 14 | 后端测试通过 | `pnpm --filter server test` | 全部通过 |
| 15 | 前端测试通过 | `pnpm --filter web test` | 全部通过 |

### 10.5 环境变量校验检查

检查 `server/src/config/env.validation.ts` 中的所有 `@Is*` 装饰器：

| # | 检查项 | 预期 |
|---|---|---|
| 1 | 所有必填变量有 `@IsNotEmpty` | SERVER_PORT、DB_*、QDRANT_URL、EMBEDDING_*、LLM_* 等 |
| 2 | 数值变量有 `@IsInt` / `@IsNumber` + `@Min` / `@Max` | CHUNK_SIZE 100-10000、EMBEDDING_DIMENSION 1-8192 等 |
| 3 | 布尔变量有 `@IsBoolean` | EMBEDDING_MOCK、LLM_MOCK、QDRANT_MOCK |
| 4 | URL 变量有 `@IsURL` | QDRANT_URL、LLM_BASE_URL |
| 5 | CHUNK_OVERLAP < CHUNK_SIZE 校验 | 启动时自定义校验 |

### 10.6 敏感信息泄漏检查

| # | 检查项 | 命令 | 预期 |
|---|---|---|---|
| 1 | 代码中无硬编码 API Key | `rg "sk-[a-zA-Z0-9]{20,}" server/src web/src` | 无命中 |
| 2 | 代码中无硬编码密码 | `rg "password.*=.*['\"]" server/src --type ts -g '!**/*.spec.ts' -g '!**/*.e2e-spec.ts'` | 无命中 |
| 3 | .env.example 不含真实密钥 | 人工审查 | 只有占位符 `sk-your-api-key` |
| 4 | .gitignore 包含 .env | `rg "^\.env$" .gitignore` | 命中 |
| 5 | 错误响应不含 API Key | 检查 `http-exception.filter.ts` | 异常信息不包含 `apiKey`、`Bearer` 等 |
| 6 | LLM/Embedding 错误消息安全化 | 检查 `embedding-client.ts` createHttpFailure | 不返回原始响应体，只返回状态码和状态文本 |

---

## 十一、测试覆盖范围

### 11.1 后端测试覆盖目标

| 模块 | 目标覆盖率 | 优先级 |
|---|---|---|
| `processing/chunking/text-cleaner.ts` | 100% | P0 |
| `processing/chunking/text-splitter.ts` | 95%+ | P0 |
| `processing/parsing/plain-text.parser.ts` | 95%+ | P0 |
| `rag/prompt-builder.ts` | 95%+ | P0 |
| `embedding/embedding-client.ts` | 80%+ | P1 |
| `embedding/embedding.service.ts` | 80%+ | P1 |
| `retrieval/retrieval.service.ts` | 80%+ | P1 |
| `vector-store/vector-store.service.ts` | 70%+ | P2 |
| `chat/chat.service.ts` | 70%+ | P2 |
| `conversation/conversation.service.ts` | 80%+ | P1 |
| `document/document.service.ts` | 70%+ | P2 |
| `knowledge-base/knowledge-base.service.ts` | 70%+ | P2 |

> P0 为纯函数，应接近 100%覆盖。P1 为核心业务逻辑，目标 80%+。P2 涉及复杂 mock，目标 70%+。

### 11.2 前端测试覆盖目标

| 文件 | 目标覆盖率 | 优先级 |
|---|---|---|
| `api/sse.ts` | 90%+ | P0 |
| `api/http.ts` | 80%+ | P1 |
| `composables/use-chat.ts` | 70%+ | P1 |
| `composables/use-conversations.ts` | 60%+ | P2 |

### 11.3 不测试的范围

| 项 | 原因 |
|---|---|
| 第三方库（Vue、AntDV、Axios、TypeORM、Qdrant Client） | 由库自身测试覆盖 |
| Entity / DTO 定义文件 | 无逻辑，type-check 保证 |
| Module 定义文件 | 无逻辑 |
| CLI 脚本 | 人工验收 |
| `main.ts` | 启动入口，E2E 间接覆盖 |
| 配置文件 | 静态配置 |
| 样式和模板 | 人工验收 |

---

## 十二、测试文件清单

### 12.1 后端新增测试文件

```
server/
├── jest.config.ts                                    # 新建
├── .eslintrc.cjs                                     # 新建
├── test/
│   └── jest-e2e.json                                 # 新建
├── src/
│   └── modules/
│       ├── processing/
│       │   └── chunking/
│       │       └── __tests__/
│       │           ├── text-cleaner.spec.ts          # 新建
│       │           └── text-splitter.spec.ts         # 新建
│       ├── processing/
│       │   └── parsing/
│       │       └── __tests__/
│       │           └── plain-text.parser.spec.ts     # 新建
│       ├── embedding/
│       │   └── __tests__/
│       │       ├── embedding-client.spec.ts          # 新建
│       │       └── embedding.service.spec.ts         # 新建
│       ├── vector-store/
│       │   └── __tests__/
│       │       └── vector-store.service.spec.ts      # 新建
│       ├── retrieval/
│       │   └── __tests__/
│       │       └── retrieval.service.spec.ts         # 新建
│       ├── rag/
│       │   └── __tests__/
│       │       └── prompt-builder.spec.ts            # 新建
│       ├── chat/
│       │   └── __tests__/
│       │       └── chat.service.spec.ts              # 新建
│       ├── conversation/
│       │   └── __tests__/
│       │       └── conversation.service.spec.ts      # 新建
│       ├── document/
│       │   └── __tests__/
│       │       └── document.service.spec.ts          # 新建
│       └── knowledge-base/
│           └── __tests__/
│               └── knowledge-base.service.spec.ts    # 新建
```

### 12.2 前端新增测试文件

```
web/
├── vitest.config.ts                                  # 新建
├── .eslintrc.cjs                                     # 新建
└── src/
    └── api/
        └── __tests__/
            ├── sse.spec.ts                           # 新建
            └── http.spec.ts                          # 新建
    └── composables/
        └── __tests__/
            ├── use-chat.spec.ts                      # 新建
            └── use-conversations.spec.ts             # 新建
```

### 12.3 配置文件修改

| 文件 | 修改内容 |
|---|---|
| `server/package.json` | 新增 `test`/`test:watch`/`test:cov`/`test:e2e`/`lint`/`lint:check` 脚本 + 测试 devDependencies |
| `server/tsconfig.json` | 新增 `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` |
| `web/package.json` | 新增 `test`/`test:watch`/`test:cov`/`lint`/`lint:check` 脚本 + 测试 devDependencies |

---

## 十三、文件修改清单

### 13.1 新增文件（20 个）

| # | 文件 | 类型 |
|---|---|---|
| 1 | `server/jest.config.ts` | 配置 |
| 2 | `server/.eslintrc.cjs` | 配置 |
| 3 | `server/test/jest-e2e.json` | 配置 |
| 4 | `server/src/modules/processing/chunking/__tests__/text-cleaner.spec.ts` | 测试 |
| 5 | `server/src/modules/processing/chunking/__tests__/text-splitter.spec.ts` | 测试 |
| 6 | `server/src/modules/processing/parsing/__tests__/plain-text.parser.spec.ts` | 测试 |
| 7 | `server/src/modules/embedding/__tests__/embedding-client.spec.ts` | 测试 |
| 8 | `server/src/modules/embedding/__tests__/embedding.service.spec.ts` | 测试 |
| 9 | `server/src/modules/vector-store/__tests__/vector-store.service.spec.ts` | 测试 |
| 10 | `server/src/modules/retrieval/__tests__/retrieval.service.spec.ts` | 测试 |
| 11 | `server/src/modules/rag/__tests__/prompt-builder.spec.ts` | 测试 |
| 12 | `server/src/modules/chat/__tests__/chat.service.spec.ts` | 测试 |
| 13 | `server/src/modules/conversation/__tests__/conversation.service.spec.ts` | 测试 |
| 14 | `server/src/modules/document/__tests__/document.service.spec.ts` | 测试 |
| 15 | `server/src/modules/knowledge-base/__tests__/knowledge-base.service.spec.ts` | 测试 |
| 16 | `web/vitest.config.ts` | 配置 |
| 17 | `web/.eslintrc.cjs` | 配置 |
| 18 | `web/src/api/__tests__/sse.spec.ts` | 测试 |
| 19 | `web/src/api/__tests__/http.spec.ts` | 测试 |
| 20 | `web/src/composables/__tests__/use-chat.spec.ts` | 测试 |

### 13.2 修改文件（3 个）

| 文件 | 修改内容 |
|---|---|
| `server/package.json` | 新增 test/lint 脚本 + devDependencies |
| `server/tsconfig.json` | 新增严格性选项 |
| `web/package.json` | 新增 test/lint 脚本 + devDependencies |

### 13.3 可能修改的文件（如 lint/type-check 发现问题）

| 文件 | 可能修改 |
|---|---|
| 后端各 Service | 如 `noUnusedLocals`/`noUnusedParameters` 报错，清理未使用变量 |
| 前端各文件 | 如 ESLint 报错，修复格式或类型问题 |

### 13.4 文档新增（完成后生成）

| 文件 | 说明 |
|---|---|
| `docs/reports/task-15-completion.md` | T15 完成报告 |
| `docs/01-current-implementation.md` | 更新为 T15 后快照 |

---

## 十四、验收标准

### 14.1 测试运行

| 命令 | 预期 |
|---|---|
| `pnpm --filter server test` | 全部通过 |
| `pnpm --filter server test:cov` | 覆盖率报告生成，P0 文件 ≥95% |
| `pnpm --filter web test` | 全部通过 |
| `pnpm --filter web test:cov` | 覆盖率报告生成，sse.ts ≥90% |

### 14.2 构建与静态检查

| 命令 | 预期 |
|---|---|
| `pnpm --filter server lint:check` | 通过（无 error，warn 可接受） |
| `pnpm --filter web lint:check` | 通过（无 error，warn 可接受） |
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |

### 14.3 代码质量扫描

| 命令 | 预期 |
|---|---|
| `rg "console\.(log\|debug)" web/src` | 无命中 |
| `rg "console\.(log\|error\|warn)" server/src --type ts -g '!**/scripts/**' -g '!**/*.spec.ts' -g '!**/*.e2e-spec.ts'` | 无命中 |
| `rg "debugger\b" web/src server/src` | 无命中 |
| `rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router` | 无命中 |
| `rg "localStorage\|sessionStorage" web/src server/src` | 无命中 |

### 14.4 优先测试验收

§九 的 8 项优先测试全部通过。

---

## 十五、实施顺序

按以下顺序执行，每步完成后验证：

1. **安装测试依赖**：server（jest + ts-jest + @nestjs/testing + supertest + eslint）和 web（vitest + @vue/test-utils + jsdom + eslint）
2. **创建测试配置**：jest.config.ts、vitest.config.ts、.eslintrc.cjs、jest-e2e.json
3. **更新 package.json 脚本**：server 和 web 各新增 test/lint 脚本
4. **更新 server/tsconfig.json**：补充 noUnusedLocals/noUnusedParameters
5. **编写后端纯函数测试**（P0）：text-cleaner、text-splitter、plain-text-parser、prompt-builder
6. **编写后端 Service 测试**（P1）：embedding-client、embedding.service、retrieval.service、conversation.service
7. **编写后端 Service 测试**（P2）：vector-store.service、chat.service、document.service、knowledge-base.service
8. **编写前端测试**：sse.spec.ts、http.spec.ts、use-chat.spec.ts
9. **运行测试并修复**：`pnpm --filter server test` + `pnpm --filter web test`
10. **运行 lint 并修复**：`pnpm --filter server lint:check` + `pnpm --filter web lint:check`
11. **运行 type-check 和 build**：确认全通过
12. **代码质量扫描**：§十.4 全部检查项
13. **环境变量和敏感信息检查**：§十.5 + §十.6
14. **生成完成报告**：`docs/reports/task-15-completion.md`
15. **更新快照**：`docs/01-current-implementation.md`

---

## 十六、禁止项

1. **不新增业务功能**：T15 只做测试和质量收口
2. **不大规模重构**：禁止
3. **不修改已执行 Migration**：禁止
4. **不修改 API 路径或 SSE 事件协议**：冻结级约定
5. **不为追求覆盖率测试第三方库**：只测自有代码
6. **不实现登录/权限/多租户**：MVP 不做
7. **不实现 Agent/GraphRAG/Rerank**：MVP 不做
8. **不引入 Pinia 或其他状态管理框架**
9. **不在测试中写 Mock 假业务数据**：测试中使用 mock 返回值，不创建假数据库记录（E2E 除外，使用隔离测试库）
10. **不修改后端业务逻辑**（除非 lint/type-check 发现未使用变量等需要清理）
11. **不修改 CLI 脚本**（`server/src/scripts/`）

---

## 十七、设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 后端用 Jest + ts-jest | NestJS 官方推荐，社区成熟，与 TypeScript 集成稳定 |
| 2 | 前端用 Vitest | 与 Vite 原生集成，配置简单，ESM 支持好 |
| 3 | E2E 用 supertest + @nestjs/testing | 无需启动真实 HTTP 服务器，直接测试 NestJS 实例 |
| 4 | E2E 使用隔离测试库 `mini_rag_test` | 避免污染开发数据 |
| 5 | 纯函数测试优先（P0） | 无需 mock，ROI 最高，覆盖核心算法逻辑 |
| 6 | EmbeddingClient 利用 mock 模式测试 | 避免依赖外部 API，确定性向量验证 |
| 7 | server/tsconfig.json 补充 noUnusedLocals | 与前端对齐，提升代码质量 |
| 8 | ESLint 配为 warn 级而非 error 级 | 避免大量历史代码报错阻断，逐步收紧 |
| 9 | 不强制 100% 覆盖率 | P0 纯函数接近 100%，Service 70-80% 即可，避免为覆盖率写无意义测试 |
| 10 | 前端 use-chat 测试用 70% 目标 | composable 涉及 Vue 响应式和 watch，完全覆盖成本高 |

---

## 十八、Codex 执行指令

> 以下是直接交给 Codex 的简洁执行指令。

```
你是一个资深全栈工程师。请根据 docs/task-15-testing-and-code-quality.md 完成 T15 测试与代码质量收口任务。

前置条件：T14 已完成，系统可正常运行（后端 localhost:3000，前端 localhost:5173，Docker 中 mysql 和 qdrant 运行中）。

执行步骤：

1. 安装测试依赖：
   - server: pnpm --filter server add -D jest@^29 @types/jest@^29 ts-jest@^29 @nestjs/testing@^10 supertest@^7 @types/supertest@^6 eslint@^8 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8
   - web: pnpm --filter web add -D vitest@^2 @vue/test-utils@^2 jsdom@^25 @vitest/coverage-v8@^2 eslint@^8 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 eslint-plugin-vue@^9

2. 创建测试配置：
   - server/jest.config.ts（见 §四.1）
   - server/test/jest-e2e.json（见 §四.3）
   - server/.eslintrc.cjs（见 §十.1）
   - web/vitest.config.ts（见 §四.2）
   - web/.eslintrc.cjs（见 §十.1）

3. 更新 package.json 脚本：
   - server: 新增 test/test:watch/test:cov/test:e2e/lint/lint:check
   - web: 新增 test/test:watch/test:cov/lint/lint:check

4. 更新 server/tsconfig.json：补充 noUnusedLocals、noUnusedParameters、noFallthroughCasesInSwitch

5. 编写后端纯函数单元测试（P0 优先）：
   - text-cleaner.spec.ts：§五.1 全部 9 个用例
   - text-splitter.spec.ts：§五.2 全部 12 个用例（含边界和 overlap 验证）
   - plain-text.parser.spec.ts：§五.3 全部 8 个用例（含 BOM 检测和编码错误）
   - prompt-builder.spec.ts：§五.4 全部 8 个用例（含 maxChars 截断和防编造规则验证）

6. 编写后端 Service 单元测试（P1）：
   - embedding-client.spec.ts：§六.1 全部 12 个用例（利用 mock 模式 + spyOn fetch 测试重试/错误分类）
   - embedding.service.spec.ts：§六.2 全部 12 个用例（mock Repository 和 EmbeddingClient）
   - retrieval.service.spec.ts：§六.3 全部 10 个用例（重点：completed 文档过滤、payload 校验）
   - conversation.service.spec.ts：§六.5 全部 5 个用例

7. 编写后端 Service 单元测试（P2）：
   - vector-store.service.spec.ts：§六.8 全部 5 个用例
   - chat.service.spec.ts：§六.4 全部 8 个用例（重点：无检索不调 LLM、SSE 事件序列、客户端断开）
   - document.service.spec.ts：§六.6 全部 6 个用例
   - knowledge-base.service.spec.ts：§六.7 全部 4 个用例（重点：级联清理顺序）

8. 编写前端单元测试：
   - sse.spec.ts：§七.1 全部 15 个用例（重点：半包/粘包/多行 data/error 事件）
   - http.spec.ts：§七.2 全部 5 个用例
   - use-chat.spec.ts：§七.3 全部 10 个用例（重点：状态流转、防重复提交）

9. 运行测试并修复：
   - pnpm --filter server test（全部通过）
   - pnpm --filter web test（全部通过）
   - 如有失败，修复测试代码（不修改业务逻辑，除非 tsconfig 新增选项导致编译错误）

10. 运行 lint 并修复：
    - pnpm --filter server lint:check
    - pnpm --filter web lint:check
    - 如有 error，修复代码（清理未使用变量/import、补类型标注）

11. 运行 type-check 和 build：
    - pnpm --filter server build（通过，含新增 tsconfig 选项）
    - pnpm --filter web type-check（通过）
    - pnpm --filter web build（通过）

12. 代码质量扫描（§十.4 全部 15 项），记录结果

13. 环境变量校验检查（§十.5）和敏感信息泄漏检查（§十.6），记录结果

14. 生成完成报告 docs/reports/task-15-completion.md：
    - 新增和修改文件清单
    - 测试运行结果（通过数/失败数/覆盖率）
    - lint 检查结果
    - type-check 和 build 结果
    - 代码质量扫描结果
    - 环境变量和敏感信息检查结果
    - 8 项优先测试验收结论
    - 未完成项和已知问题
    - 越界确认
    - 是否具备进入下一阶段结论

15. 更新 docs/01-current-implementation.md 为 T15 后快照：
    - 新增测试基础设施说明（框架、配置、命令）
    - 测试覆盖范围
    - 代码质量状态
    - 已验证结果

约束：
- 不新增业务功能
- 不大规模重构
- 不修改已执行 Migration
- 不修改 API 路径或 SSE 事件协议
- 不为追求覆盖率测试第三方库
- 不修改后端业务逻辑（除非 lint/type-check 发现未使用变量需清理）
- 不修改 CLI 脚本（server/src/scripts/）
- 完成后生成 docs/reports/task-15-completion.md 和更新 docs/01-current-implementation.md
```

---

## 十九、完成报告要求

完成后生成 `docs/reports/task-15-completion.md`，内容包括：

1. **新增和修改文件清单**：逐个列出
2. **测试依赖安装结果**：版本和安装是否成功
3. **测试运行结果**：server 和 web 各自的通过数/失败数/覆盖率
4. **8 项优先测试验收结论**：逐项确认通过/未通过
5. **lint 检查结果**：server 和 web 各自的 error/warn 数
6. **type-check 和 build 结果**：3 个命令的通过状态
7. **代码质量扫描结果**：§十.4 全部 15 项
8. **环境变量校验检查结果**：§十.5 全部 5 项
9. **敏感信息泄漏检查结果**：§十.6 全部 6 项
10. **未完成项和已知问题**：如有
11. **越界确认**：确认未实现禁止项
12. **是否具备进入下一阶段**：结论

同时更新 `docs/01-current-implementation.md` 为 T15 后快照，包括：
- 新增测试基础设施（Jest + Vitest + ESLint 配置）
- 测试文件清单和覆盖范围
- 测试命令（test/test:cov/lint/lint:check）
- 代码质量状态（tsconfig 严格性、ESLint、无 any/console/debugger）
- 已验证结果
- 未完成项和已知问题
