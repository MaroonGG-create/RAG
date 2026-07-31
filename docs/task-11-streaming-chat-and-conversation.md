# T11 SSE 流式对话与会话管理 — Codex 执行指令

> 任务编号：T11（阶段 P8：SSE 流式 + 会话记录）
> 前置条件：T10 已完成（结论：**通过**，见 `docs/reports/task-10-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.9 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T10 后快照）+ `docs/reports/task-10-completion.md`（T10 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T10 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `RetrievalService` | `src/modules/retrieval/retrieval.service.ts` | **不修改**。已有 `search(kbId, query, topK?, scoreThreshold?): Promise<RetrievalResponseData>`；返回 `{ results: RetrievalResult[], total, took }`；已做 KB 校验、completed 文档过滤、payload 校验、score 降序 |
| `RetrievalModule` | `src/modules/retrieval/retrieval.module.ts` | **不修改**。已 exports `RetrievalService` |
| `RetrievalResult` | `src/modules/retrieval/retrieval.types.ts` | **不修改**。含 `chunkId/documentId/documentName/chunkIndex/pageNo/content/score` |
| `LlmClient.chat()` | `src/modules/llm/llm-client.ts` | **允许修改**：新增 `chatStream()` 方法（§八）。已有 `chat()` 非流式方法保持不变 |
| `LlmClient` 配置 | `src/modules/llm/llm-client.ts` | **不修改构造函数**。baseUrl/apiKey/model/temperature/maxTokens/timeoutMs/mock 已就绪 |
| `ChatMessage` / `LlmFailure` | `src/modules/llm/llm.types.ts` | **允许修改**：追加流式类型（§八） |
| `LlmModule` | `src/modules/llm/llm.module.ts` | **不修改**。已 providers/exports `LlmClient`；T11 新方法自动可用 |
| `buildRagPrompt()` | `src/modules/rag/prompt-builder.ts` | **不修改、不直接调用**。T11 复用同一 `SYSTEM_PROMPT` 常量和 `buildContext` 逻辑，但在 `ChatService` 中重新组装含历史消息的 messages 数组（§十五）。如需复用 `buildRagPrompt` 的逻辑，可 import `SYSTEM_PROMPT` 导出 |
| `RagService` | `src/modules/rag/rag.service.ts` | **不修改、不注入**。T11 的 `ChatService` 独立编排检索→Prompt→流式 LLM→SSE，不调用 `RagService.ask()` |
| `Conversation` 实体 | `src/modules/conversation/entities/conversation.entity.ts` | **不修改**。已含 id/kbId/title/createdAt/updatedAt + KnowledgeBase ManyToOne + Messages OneToMany |
| `Message` 实体 | `src/modules/conversation/entities/message.entity.ts` | **不修改**。已含 id/conversationId/role/content/status/errorMessage/createdAt/updatedAt + Conversation ManyToOne + References OneToMany；`MESSAGE_ROLES`/`MESSAGE_STATUSES` 导出 |
| `MessageReference` 实体 | `src/modules/conversation/entities/message-reference.entity.ts` | **不修改**。已含 id/messageId/documentId(nullable)/chunkId(nullable)/documentName/chunkIndex/pageNo/score/contentSnapshot/createdAt/updatedAt |
| `AppEntities` | `src/database/entities.ts` | **不修改**。已包含 Conversation/Message/MessageReference |
| `SkipResponseWrap` | `src/common/decorators/skip-response-wrap.decorator.ts` | **不修改**。已有装饰器，标记后 `ResponseInterceptor` 跳过包装 |
| `ResponseInterceptor` | `src/common/interceptors/response.interceptor.ts` | **不修改**。已有 `isEventStream()` 检查：`Content-Type` 含 `text/event-stream` 时自动跳过包装；配合 `@SkipResponseWrap()` 双保险 |
| `HttpExceptionFilter` | `src/common/filters/http-exception.filter.ts` | **不修改**。已有统一异常处理 |
| `ParsePositiveIntPipe` | `src/common/pipes/parse-positive-int.pipe.ts` | **不修改** |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `chat` 配置段（§七） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：追加 `CHAT_HISTORY_MAX_MESSAGES` 校验（§七） |
| `AppModule` | `src/app.module.ts` | **允许修改**：imports 追加 `ConversationModule` + `ChatModule` |
| `KnowledgeBase` 实体 | `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | **不修改**。已有 `conversations` OneToMany 关系 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T10 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05-T10），否则 DB 读写会打到错误实例。
2. **Docker daemon 可能无法启动**：T11 需要 Embedding + Qdrant + LLM。若 Docker 不可用则使用 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` + `LLM_MOCK=true` 完成 Mock 验收（§二十四）。
3. Mock Embedding 向量无语义相似性——但同文本 query 和 chunk 的 Mock 向量完全一致（cosine=1.0），可用于确定性验收。
4. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `conversation` 模块和 `chat` 模块，实现 SSE 流式 RAG 问答全流程：

- **SSE 流式对话**：接收 `knowledgeBaseId`（路径参数）和 `question`，通过 SSE 流式返回回答 token；
- **复用 T09 检索**：调用 `RetrievalService.search()` 获取检索结果；
- **复用 T10 Prompt**：使用同一 `SYSTEM_PROMPT` 和 `buildContext` 逻辑组装上下文；
- **流式 LLM 调用**：在 `LlmClient` 新增 `chatStream()` 方法，调用 OpenAI 兼容 `POST /chat/completions`（`stream: true`），逐 token 通过 SSE 推送；
- **无命中短路**：`results.length === 0` → 通过 SSE 推送固定话术，**不调用 LLM**；
- **Conversation 管理**：新建会话和继续已有会话；
- **Message 落库**：用户消息在检索前保存；助手消息在 LLM 完成后保存（成功 `completed`，失败 `failed`）；
- **MessageReference 落库**：助手消息保存后批量插入引用快照；
- **会话列表**：`GET /api/knowledge-bases/:id/conversations`；
- **消息历史**：`GET /api/conversations/:id/messages`（assistant 消息带 references）；
- **删除会话**：`DELETE /api/conversations/:id`（MySQL CASCADE 删消息和引用）；
- **会话标题**：首个问题截断 30 字（**不调用 LLM 生成标题**）；
- **历史上下文**：加载最近 N 条消息传给 LLM（§十五）；
- **客户端断开**：`req.on('close')` → `AbortController.abort()` → 保存已生成部分内容；
- **异常处理**：流式过程中 LLM 失败 → 发送 `error` 事件，已生成内容落库并标记 `failed`；
- **Mock 流式**：`LLM_MOCK=true` 时模拟逐 token 输出；
- **SSE 绕过响应包装**：`@SkipResponseWrap()` + `text/event-stream` 双保险。

### 2.2 非目标（本阶段一律不做）

前端页面、WebSocket、Rerank、Agent、GraphRAG、多租户、权限系统、消息队列、新增数据库表、新增 migration、修改既有 migration、修改已定义实体（Conversation/Message/MessageReference）、修改 `web/`、修改 `RetrievalService`/`RetrievalModule`、修改 `RagService`/`RagModule`、修改 `EmbeddingService`/`EmbeddingClient`/`EmbeddingModule`、修改 `VectorStoreService`/`VectorStoreModule`、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`、修改任何文档的 `status` 字段、上传后自动触发流水线、启动恢复钩子、OCR、自动生成会话标题的额外 LLM 调用、Conversation 级别的向量清理（向量属于文档不属于会话）。

---

## 三、API 和 DTO（冻结级）

### 3.1 API 清单

| # | 方法 | 路径 | 说明 | 响应 |
|---|---|---|---|---|
| 16 | POST | `/api/knowledge-bases/:id/chat` | SSE 流式 RAG 问答 | `text/event-stream` |
| 17 | GET | `/api/knowledge-bases/:id/conversations` | 会话列表（按 updatedAt 倒序） | `{ code:0, data: ConversationResponseDto[] }` |
| 18 | GET | `/api/conversations/:id/messages` | 会话消息历史（含引用） | `{ code:0, data: MessageResponseDto[] }` |
| 19 | DELETE | `/api/conversations/:id` | 删除会话（级联删消息和引用） | 204 |

> **路径变更说明**：总体方案 §9 #10 原为 `POST /api/chat/stream`（`knowledgeBaseId` 在 body 中）。T11 改为 `POST /api/knowledge-bases/:id/chat`，理由：与已有 `/api/knowledge-bases/:id/ask`（T10）和 `/api/knowledge-bases/:id/retrieve`（T09）保持一致的路径风格，`knowledgeBaseId` 在路径参数中更 RESTful。此变更在基线回填中注明（§二十八）。

### 3.2 SSE 问答请求 DTO

```ts
// dto/chat-request.dto.ts
export class ChatRequestDto {
  @ApiProperty({ example: '什么是 RAG？', maxLength: 2000 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional({ example: 1, description: '已有会话 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number;

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

### 3.3 会话列表响应 DTO

```ts
// dto/conversation-response.dto.ts
export class ConversationResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '什么是 RAG？' })
  title!: string;

  @ApiProperty({ example: '2026-07-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-07-31T10:05:00.000Z' })
  updatedAt!: Date;

  static fromEntity(conversation: Conversation): ConversationResponseDto {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
```

### 3.4 消息历史响应 DTO

```ts
// dto/message-response.dto.ts
export class MessageReferenceResponseDto {
  @ApiProperty({ example: 45, nullable: true })
  documentId!: number | null;

  @ApiProperty({ example: 123, nullable: true })
  chunkId!: number | null;

  @ApiProperty({ example: '产品手册.pdf' })
  documentName!: string;

  @ApiProperty({ example: 3 })
  chunkIndex!: number;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  pageNo!: number | null;

  @ApiProperty({ example: 0.8732 })
  score!: number;

  @ApiProperty({ example: '切片内容快照...' })
  contentSnapshot!: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ example: 'user' })
  role!: string;

  @ApiProperty({ example: '什么是 RAG？' })
  content!: string;

  @ApiProperty({ example: 'completed' })
  status!: string;

  @ApiProperty({ nullable: true, example: null })
  errorMessage!: string | null;

  @ApiProperty({ example: '2026-07-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ type: [MessageReferenceResponseDto] })
  references!: MessageReferenceResponseDto[];

  static fromEntity(
    message: Message,
  ): MessageResponseDto {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      errorMessage: message.errorMessage,
      createdAt: message.createdAt,
      references: (message.references ?? []).map((ref) => ({
        documentId: ref.documentId,
        chunkId: ref.chunkId,
        documentName: ref.documentName,
        chunkIndex: ref.chunkIndex,
        pageNo: ref.pageNo,
        score: ref.score,
        contentSnapshot: ref.contentSnapshot,
      })),
    };
  }
}
```

---

## 四、SSE 事件协议（冻结级）

### 4.1 事件类型

| 事件 | 时机 | data 结构 |
|---|---|---|
| `metadata` | 连接建立后第一个事件 | `{ conversationId: number, userMessageId: number }` |
| `token` | LLM 流式输出期间，每个 delta | `{ delta: string }` |
| `references` | 所有 token 结束后 | `ReferenceSnapshot[]`（可能为空数组 `[]`） |
| `done` | 引用事件之后，正常结束 | `{ assistantMessageId: number }` |
| `error` | 任何阶段失败时，替代 done | `{ message: string }` |

### 4.2 事件顺序

```
正常流程：  metadata → token(×N) → references → done
无命中流程： metadata → token(×1, 固定话术) → references(空数组) → done
失败流程：   metadata → token(×N, 部分内容) → error
                 或 metadata → error（检索/LLM 初始化失败）
```

### 4.3 SSE 帧格式

每帧格式（标准 SSE）：

```
event: {eventName}
data: {jsonString}

```

> 注意：`data:` 行后是 JSON 字符串，帧之间用 `\n\n` 分隔。

### 4.4 具体示例

```
event: metadata
data: {"conversationId":1,"userMessageId":5}

event: token
data: {"delta":"RAG"}

event: token
data: {"delta":" 是检索增强"}

event: token
data: {"delta":"生成"}

event: references
data: [{"chunkId":123,"documentId":45,"documentName":"rag-intro.txt","pageNo":null,"content":"RAG is retrieval augmented generation","score":1}]

event: done
data: {"assistantMessageId":6}

```

### 4.5 失败示例

```
event: metadata
data: {"conversationId":1,"userMessageId":5}

event: token
data: {"delta":"RAG 是"}

event: error
data: {"message":"问答服务暂时不可用：模型调用失败"}

```

### 4.6 ReferenceSnapshot 类型

```ts
// chat.types.ts
export interface ReferenceSnapshot {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}
```

> `ReferenceSnapshot` 与 T10 `RagReference` 字段一致，但独立定义在 `chat` 模块中，避免跨模块类型耦合。

### 4.7 错误信息安全

`error` 事件的 `message` 字段只允许：

| 场景 | message |
|---|---|
| LLM 调用失败 | `问答服务暂时不可用：模型调用失败` |
| 向量生成失败 | `问答服务暂时不可用：向量生成失败` |
| Qdrant 检索失败 | `问答服务暂时不可用：检索失败` |
| 其他未预期错误 | `问答服务暂时不可用，请稍后重试` |

**禁止**在 `error` 事件中暴露：API Key、完整 Prompt、LLM 原始响应体、堆栈跟踪、内部异常消息。

---

## 五、Conversation、Message、MessageReference 落库流程（冻结级）

### 5.1 整体时序

```
1. 校验知识库存在（RetrievalService.search 内部已做，但如果要在保存用户消息前就校验，需独立查一次 KB）
2. 创建或校验会话
   - conversationId 未传 → 新建 Conversation（title = question.slice(0, 30)），保存
   - conversationId 传入 → 查询 Conversation，校验 kbId 匹配，不存在 → 404
3. 保存用户消息（content = question, role = 'user', status = 'completed'）→ 独立事务
4. 发送 metadata 事件（conversationId, userMessageId）
5. 调用 RetrievalService.search() → 获取检索结果
6. if results.length === 0:
   - 保存助手消息（content = 固定话术, status = 'completed'）→ 独立事务
   - 发送 token 事件（固定话术）
   - 发送 references 事件（空数组）
   - 发送 done 事件（assistantMessageId）
   - 结束
7. if results.length > 0:
   - 构建上下文（buildContext）+ 加载历史消息
   - 开始 LLM 流式调用
   - 逐 token 发送 token 事件，同时累积 fullAnswer
   - LLM 完成（正常 finish_reason='stop'）:
     a. 发送 references 事件（实际进入上下文的引用快照）
     b. 保存助手消息 + references（单事务：message + batch insert message_references）
     c. 发送 done 事件（assistantMessageId）
   - LLM 失败（超时/5xx/网络错误）:
     a. 保存助手消息（content = 已累积的 fullAnswer, status = 'failed', errorMessage = 安全摘要）
     b. 发送 error 事件
   - 客户端断开:
     a. 保存助手消息（content = 已累积的 fullAnswer, status = 'failed', errorMessage = '客户端断开连接'）
     b. 不发送任何事件（连接已断）
8. 结束 SSE 连接
```

### 5.2 用户消息保存时机

**决策**：在检索之前保存用户消息。

**理由**：
1. 用户消息是确定性的（不需要 LLM），先保存不会浪费资源；
2. 如果后续步骤失败，用户消息已落库，用户可在历史中看到自己的问题；
3. `metadata` 事件中的 `userMessageId` 需要真实 ID，必须在发送前完成保存。

### 5.3 助手消息保存时机

**决策**：只在 LLM 完全成功后保存 `status=completed` 的助手消息；流式失败或客户端断开时保存 `status=failed` 的助手消息（含已生成的部分内容）。

**理由**：
1. 成功路径：LLM 流结束后，助手消息 + references 在同一事务中保存，保证一致性；
2. 失败路径：已生成的部分内容有保留价值（用户可看到模型部分回答），以 `failed` 状态落库；
3. 不在流式过程中边生成边保存——避免频繁 DB 写入和事务复杂度。

### 5.4 MessageReference 与真实检索结果关联

**决策**：`MessageReference` 快照来自实际进入 Prompt 的 `RetrievalResult[]`（即 `usedResultCount` 范围内的结果）。

**关联方式**：

```ts
// 从 RetrievalResult 到 MessageReference 快照
const references: MessageReferenceSnapshot[] = usedResults.map((r) => ({
  messageId: assistantMessage.id,        // 关联到刚保存的助手消息
  documentId: r.documentId,
  chunkId: r.chunkId,
  documentName: r.documentName,
  chunkIndex: r.chunkIndex,              // RetrievalResult 有 chunkIndex
  pageNo: r.pageNo,
  score: r.score,
  contentSnapshot: r.content,           // 切片内容快照
}));
```

> **注意**：`RetrievalResult` 包含 `chunkIndex`，而 T10 的 `RagReference` 不包含。`MessageReference` 实体有 `chunkIndex` 字段，所以 T11 从 `RetrievalResult` 直接映射。

### 5.5 事务边界

| 操作 | 事务范围 |
|---|---|
| 保存用户消息 | 独立事务（单个 INSERT） |
| 保存成功助手消息 + references | 单事务（INSERT message + batch INSERT message_references） |
| 保存失败助手消息（无 references） | 独立事务（单个 INSERT message） |
| 新建会话 | 独立事务（单个 INSERT conversation） |

**实现方式**：使用 `DataSource.transaction()` 包裹需要原子性的操作。用户消息和会话创建各自独立事务；助手消息 + references 使用一个事务。

### 5.6 无命中时的消息保存

无命中时也保存助手消息：

```ts
const assistantMessage = await this.messageService.saveMessage({
  conversationId,
  role: 'assistant',
  content: '知识库中未找到与您问题相关的内容。',
  status: 'completed',
  errorMessage: null,
});
// 无 references 需要保存
```

---

## 六、模块与文件设计

### 6.1 新增文件（server/，13 个）

| 文件 | 职责 |
|---|---|
| `src/modules/conversation/conversation.module.ts` | NestJS 模块：注册 Conversation/Message/MessageReference 实体，providers 注册 ConversationService + MessageService，controllers 注册 ConversationController，exports 导出 ConversationService + MessageService |
| `src/modules/conversation/conversation.service.ts` | 会话 CRUD：创建会话、查找会话（校验 kbId 归属）、按知识库列出会话、删除会话 |
| `src/modules/conversation/message.service.ts` | 消息 CRUD：保存消息、保存消息+引用（事务）、按会话查消息（含 references）、查最近 N 条历史消息 |
| `src/modules/conversation/conversation.controller.ts` | HTTP 控制器：`GET /api/knowledge-bases/:id/conversations`、`GET /api/conversations/:id/messages`、`DELETE /api/conversations/:id` |
| `src/modules/conversation/dto/conversation-response.dto.ts` | 会话列表响应 DTO |
| `src/modules/conversation/dto/message-response.dto.ts` | 消息历史响应 DTO（含 references） |
| `src/modules/chat/chat.module.ts` | NestJS 模块：imports RetrievalModule + LlmModule + ConversationModule，controllers 注册 ChatController，providers 注册 ChatService |
| `src/modules/chat/chat.service.ts` | SSE 编排服务：会话准备 → 保存用户消息 → 检索 → 流式 LLM → SSE 推送 → 保存助手消息+引用 |
| `src/modules/chat/chat.controller.ts` | HTTP 控制器：`POST /api/knowledge-bases/:id/chat`（SSE） |
| `src/modules/chat/chat.types.ts` | 类型定义：`ChatSseEvent`/`ReferenceSnapshot`/`ChatStreamDelta` |
| `src/modules/chat/dto/chat-request.dto.ts` | 请求 DTO：`question`/`conversationId?`/`topK?`/`scoreThreshold?` |
| `src/modules/chat/sse-writer.ts` | SSE 写入助手：封装 `res.write()` 为 `writeEvent(event, data)` + `end()` |

### 6.2 修改文件（server/ 5 个 + 根 1 个 + docs 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/modules/llm/llm.types.ts` | 追加流式类型：`ChatStreamRequest`/`ChatStreamDelta`/`ChatStreamChunk`（§八） |
| `src/modules/llm/llm-client.ts` | 新增 `chatStream()` 方法 + Mock 流式实现（§八） |
| `src/config/configuration.ts` | 追加 `chat` 配置段（§七） |
| `src/config/env.validation.ts` | 追加 `CHAT_HISTORY_MAX_MESSAGES` 校验（§七） |
| `src/app.module.ts` | imports 追加 `ConversationModule` + `ChatModule` |
| `.env.example` | 追加 `CHAT_HISTORY_MAX_MESSAGES` |
| `docs/00-overall-plan.md` | §二十八 v2.0 回填 |

### 6.3 模块依赖

```
ConversationModule
  imports: TypeOrmModule.forFeature([Conversation, Message, MessageReference])
  exports: ConversationService, MessageService

ChatModule
  imports: RetrievalModule, LlmModule, ConversationModule
  controllers: [ChatController]
  providers: [ChatService]
```

> **注意**：`ChatModule` 不 import `RagModule`——T11 的 `ChatService` 独立编排，直接调用 `RetrievalService.search()` + `LlmClient.chatStream()` + `ConversationService`/`MessageService`。`RagService.ask()`（T10 非流式）保持不变，不被 T11 调用。

### 6.4 不修改的模块

`RetrievalModule`、`RagModule`、`EmbeddingModule`、`VectorStoreModule`、`KnowledgeBaseModule`、`DocumentModule`、`ProcessingModule`——均不修改。

---

## 七、配置和环境变量（冻结级）

### 7.1 环境变量清单

| 变量 | 默认值 | 校验 | 说明 |
|---|---|---|---|
| `CHAT_HISTORY_MAX_MESSAGES` | 6 | `@IsDefined @IsInt @Min(0) @Max(20)` | 传给 LLM 的历史消息最大条数（0=不传历史，6=3 轮对话） |

> T11 不新增 LLM/Embedding/Qdrant 配置——全部复用 T07-T10 已有配置。

### 7.2 configuration.ts 追加

```ts
chat: {
  historyMaxMessages: number;
};
```

读取逻辑：

```ts
chat: {
  historyMaxMessages: Number(
    process.env.CHAT_HISTORY_MAX_MESSAGES ?? 6,
  ),
},
```

并在 `AppConfiguration` 接口追加对应类型。

### 7.3 env.validation.ts 追加

```ts
@IsDefined()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(20)
CHAT_HISTORY_MAX_MESSAGES!: number;
```

### 7.4 .env.example 追加

```env
# 对话历史（T11 首次使用）
CHAT_HISTORY_MAX_MESSAGES=6
```

---

## 八、流式 LLM 调用方式（冻结级，设计问题 1）

### 8.1 决策：在 LlmClient 新增 chatStream() 方法

**不新建独立的 streaming client**——在现有 `LlmClient` 类上新增 `chatStream()` 方法，共享 baseUrl/apiKey/model/temperature/maxTokens/timeoutMs/mock 配置。

### 8.2 新增类型（llm.types.ts 追加）

```ts
export interface ChatStreamApiRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: true;
}

export interface ChatStreamDelta {
  delta: string;
  finishReason: string | null;
}
```

### 8.3 chatStream() 方法签名

```ts
async *chatStream(
  messages: ChatMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<ChatStreamDelta> {
  if (this.mock) {
    yield* this.mockChatStream(messages);
    return;
  }

  yield* this.httpChatStream(messages, abortSignal);
}
```

### 8.4 HTTP 流式请求

```ts
private async *httpChatStream(
  messages: ChatMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<ChatStreamDelta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

  // 如果外部传入 abortSignal（客户端断开），链接到内部 controller
  if (abortSignal !== undefined) {
    abortSignal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }

  const requestBody: ChatStreamApiRequest = {
    model: this.model,
    messages,
    temperature: this.temperature,
    max_tokens: this.maxTokens,
    stream: true,
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

    if (response.body === null) {
      throw new LlmFailure('LLM API 流式响应体为空');
    }

    yield* this.parseSseStream(response.body);
  } catch (error: unknown) {
    if (this.isAbortError(error)) {
      throw new LlmFailure(`LLM API 请求超时或被中断：${this.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
```

### 8.5 SSE 响应解析

OpenAI 兼容流式响应格式：

```
data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

解析逻辑：

```ts
private async *parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以 \n\n 分隔
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const delta = this.parseSseFrame(frame);

        if (delta !== null) {
          yield delta;
        }
      }
    }

    // 处理剩余 buffer
    if (buffer.length > 0) {
      const delta = this.parseSseFrame(buffer);

      if (delta !== null) {
        yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

private parseSseFrame(frame: string): ChatStreamDelta | null {
  // 提取 data: 行
  const dataLine = frame
    .split('\n')
    .find((line) => line.startsWith('data: '));

  if (dataLine === undefined) {
    return null;
  }

  const jsonStr = dataLine.slice(6).trim();

  // [DONE] 标记
  if (jsonStr === '[DONE]') {
    return { delta: '', finishReason: 'done' };
  }

  try {
    const parsed = JSON.parse(jsonStr) as {
      choices?: Array<{
        delta?: { content?: string };
        finish_reason?: string | null;
      }>;
    };

    const choice = parsed.choices?.[0];

    if (choice === undefined) {
      return null;
    }

    return {
      delta: choice.delta?.content ?? '',
      finishReason: choice.finish_reason ?? null,
    };
  } catch {
    // 忽略无法解析的帧
    return null;
  }
}
```

### 8.6 Mock 流式实现

```ts
private async *mockChatStream(
  messages: ChatMessage[],
): AsyncGenerator<ChatStreamDelta> {
  // 复用非流式 mock 生成完整回答
  const fullAnswer = this.mockChat(messages);

  // 按每 5 个字符一组模拟逐 token 输出
  const chunkSize = 5;
  const chunks: string[] = [];

  for (let i = 0; i < fullAnswer.length; i += chunkSize) {
    chunks.push(fullAnswer.slice(i, i + chunkSize));
  }

  if (chunks.length === 0) {
    chunks.push('');
  }

  for (let i = 0; i < chunks.length; i += 1) {
    // 50ms 延迟模拟网络延迟
    await this.sleep(50);

    yield {
      delta: chunks[i],
      finishReason: i === chunks.length - 1 ? 'stop' : null,
    };
  }
}
```

### 8.7 流式不支持重试

**决策**：`chatStream()` 不实现重试逻辑。

**理由**：
1. 流式响应一旦开始传输，无法从中间恢复；
2. 初始连接失败时，上层 `ChatService` 捕获 `LlmFailure` 并发送 `error` 事件，客户端可重新发起请求；
3. MVP 不需要流式重试——简单可靠优先。

---

## 九、SSE 响应头、事件格式和连接关闭处理（冻结级，设计问题 2、3）

### 9.1 SSE 响应头

```ts
// ChatController 中设置
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no'); // nginx 反代时禁用缓冲
res.flushHeaders();
```

> `X-Accel-Buffering: no` 对应总体方案 §15 风险 4（SSE 经 nginx 缓冲）的应对措施。

### 9.2 SSE 写入助手

```ts
// sse-writer.ts
import type { Response } from 'express';

export class SseWriter {
  constructor(private readonly res: Response) {}

  writeEvent(event: string, data: unknown): void {
    if (this.res.writableEnded) {
      return;
    }

    this.res.write(`event: ${event}\n`);
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }
}
```

### 9.3 连接关闭处理

**正常结束**：`ChatService` 完成所有事件推送后调用 `sseWriter.end()`，`ChatController` 的方法返回。

**异常结束**：`ChatService` 在 `finally` 块中调用 `sseWriter.end()`。

**客户端主动断开**：通过 `req.on('close')` 监听，触发 `AbortController.abort()`，中断 LLM 流式请求，保存已生成的部分内容。

---

## 十、客户端断开处理（冻结级，设计问题 3）

### 10.1 断开检测

```ts
// ChatController
@Post('chat')
@SkipResponseWrap()
async chat(
  @Param('id', ParsePositiveIntPipe) id: number,
  @Body() dto: ChatRequestDto,
  @Res() res: Response,
  @Req() req: Request,
): Promise<void> {
  const abortController = new AbortController();

  const onClose = (): void => {
    abortController.abort();
  };

  req.on('close', onClose);

  try {
    await this.chatService.streamChat(
      id,
      dto.question,
      dto.conversationId,
      dto.topK,
      dto.scoreThreshold,
      res,
      abortController.signal,
    );
  } finally {
    req.off('close', onClose);
  }
}
```

### 10.2 断开后的行为

| 断开时机 | 行为 |
|---|---|
| 用户消息保存前 | 用户消息未保存，无数据残留 |
| 用户消息保存后、检索前 | 用户消息已落库，无助手消息 |
| 检索中 | 同上 |
| LLM 流式输出中 | `AbortController.abort()` → LLM fetch 中断 → 保存已累积的 `fullAnswer` 为 `status=failed`、`errorMessage='客户端断开连接'` → 不发送 SSE 事件（连接已断） |
| LLM 完成后、助手消息保存前 | 正常保存助手消息（客户端虽断开但内容已完整生成） |
| 助手消息保存后、done 事件发送前 | 助手消息已落库，done 事件可能未送达 |

### 10.3 关键原则

1. **已保存的用户消息不因断开而回滚**——用户问题是确定性的输入；
2. **已生成的部分内容尽量保存**——以 `failed` 状态落库，有保留价值；
3. **不因断开而抛出未捕获异常**——`ChatService` 内部 catch 所有 `AbortError`/`LlmFailure`。

---

## 十一、用户消息、助手消息的落库时机（冻结级，设计问题 4、5、6）

### 11.1 落库时机总结

| 消息 | 保存时机 | 事务 | status |
|---|---|---|---|
| 用户消息 | 检索之前（会话创建/校验之后） | 独立 INSERT | `completed` |
| 助手消息（成功） | LLM 完全成功后 | 单事务：INSERT message + batch INSERT references | `completed` |
| 助手消息（LLM 失败） | LLM 失败后 | 独立 INSERT（无 references） | `failed` |
| 助手消息（客户端断开） | 断开检测后 | 独立 INSERT（无 references） | `failed` |
| 助手消息（无命中） | 检索结果为空时 | 独立 INSERT（无 references） | `completed` |

### 11.2 流式失败时保留用户消息

**决策**：保留。用户消息在检索前已保存，后续任何失败都不回滚用户消息。

**理由**：
1. 用户消息是确定性的，不依赖外部服务；
2. 保留后用户可在消息历史中看到自己的问题，即使助手回答失败；
3. 前端可据此显示"该问题未获得有效回答"。

### 11.3 助手消息支持失败状态

**决策**：支持。助手消息有 `status` 字段（`completed`/`failed`），失败时 `errorMessage` 记录原因。

**已有支持**：`Message` 实体已有 `status` 和 `errorMessage` 字段（总体方案 §5.5 + v1.1 修订 #2），T11 直接使用。

### 11.4 errorMessage 安全规则

**允许写入 `errorMessage`**：
- 安全的中文错误摘要（如 `模型调用失败`、`客户端断开连接`、`向量生成失败`）

**禁止写入 `errorMessage`**：
- API Key
- 完整 Prompt 内容
- 完整 LLM 响应体
- 堆栈跟踪

---

## 十二、conversationId 处理和会话标题生成（冻结级，设计问题 8、9）

### 12.1 conversationId 不传 → 创建新会话

```ts
const conversation = await this.conversationService.createConversation(
  knowledgeBaseId,
  question.slice(0, 30), // title = 首个问题前 30 字
);
```

### 12.2 conversationId 传入 → 校验归属

```ts
const conversation = await this.conversationService.findConversationById(
  conversationId,
);

if (conversation === null) {
  throw new NotFoundException('会话不存在');
}

if (conversation.kbId !== knowledgeBaseId) {
  throw new NotFoundException('会话不存在');
  // 不暴露"会话存在但不属于该知识库"的信息
}
```

### 12.3 会话标题策略

**决策**：首个问题截断 30 字，**不调用 LLM 生成标题**。

**理由**：
1. MVP 简单可靠——不增加额外的 LLM 调用延迟和成本；
2. 首问题截断 30 字足够区分会话；
3. 总体方案 §5.4 明确"默认取首条问题前 30 字"。

### 12.4 继续已有会话时的标题

**决策**：不更新标题。首次创建后标题固定。

**理由**：标题变更不是 MVP 需求，避免额外 UPDATE。

---

## 十三、历史消息上下文策略（冻结级，设计问题 10）

### 13.1 决策：传给 LLM 最近 N 条消息

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---:|---|
| `historyMaxMessages` | `CHAT_HISTORY_MAX_MESSAGES` | 6 | 传给 LLM 的历史消息最大条数（0=不传历史） |

### 13.2 历史消息加载

仅当 `conversationId` 传入（继续已有会话）时加载历史：

```ts
let historyMessages: ChatMessage[] = [];

if (conversationId !== undefined && this.historyMaxMessages > 0) {
  const recentMessages = await this.messageService.findRecentMessages(
    conversationId,
    this.historyMaxMessages,
  );

  historyMessages = recentMessages.map((m) => ({
    role: m.role,       // 'user' | 'assistant'
    content: m.content, // 用户消息存的是 question，助手消息存的是 answer
  }));
}
```

### 13.3 消息内容约定

**关键**：用户消息的 `content` 字段存储**用户原始问题**（不含 `[来源i]` 上下文），助手消息的 `content` 存储**模型回答原文**。这使得历史消息可直接作为 `ChatMessage` 传给 LLM，无需提取或过滤。

### 13.4 组装完整 messages 数组

```ts
const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...historyMessages,
  { role: 'user', content: userPrompt }, // 当前轮的上下文 + 问题
];
```

> **顺序**：system → 历史 user/assistant 交替 → 当前 user（含 RAG 上下文）。
> **历史中不包含当前轮的上下文**——历史消息的 user content 只是纯问题，不含 `[来源i]` 标注。当前轮的上下文由 `buildContext()` 实时构建。

### 13.5 新会话不加载历史

`conversationId` 未传（新会话）时，`historyMessages` 为空数组，messages 只有 system + 当前 user。

### 13.6 上下文长度控制

历史消息不参与 `CONTEXT_MAX_CHARS` 截断——截断只针对当前轮的检索上下文（`[来源i] content` 部分）。历史消息的总长度由 `CHAT_HISTORY_MAX_MESSAGES` 间接控制（条数少 + 每条内容通常不长）。

> 如果历史消息过长导致超出模型上下文窗口，MVP 不做额外处理——`CHAT_HISTORY_MAX_MESSAGES=6` 是保守值，面试时作为已知取舍讲解。

---

## 十四、数据库事务边界（冻结级，设计问题 11）

### 14.1 事务策略

| 操作 | 事务 | 方式 |
|---|---|---|
| 新建会话 | 单个 INSERT | `conversationRepository.save()` |
| 保存用户消息 | 单个 INSERT | `messageRepository.save()` |
| 保存成功助手消息 + references | 单事务 | `dataSource.transaction(async (manager) => { ... })` |
| 保存失败助手消息（无 references） | 单个 INSERT | `messageRepository.save()` |
| 删除会话 | MySQL CASCADE | `conversationRepository.delete(id)` |

### 14.2 成功助手消息 + references 事务实现

```ts
async saveAssistantMessageWithReferences(
  conversationId: number,
  content: string,
  references: MessageReferenceSnapshot[],
): Promise<Message> {
  return this.dataSource.transaction(async (manager) => {
    const message = manager.create(Message, {
      conversationId,
      role: 'assistant',
      content,
      status: 'completed',
      errorMessage: null,
    });
    const savedMessage = await manager.save(message);

    if (references.length > 0) {
      const referenceEntities = references.map((ref) =>
        manager.create(MessageReference, {
          messageId: savedMessage.id,
          documentId: ref.documentId,
          chunkId: ref.chunkId,
          documentName: ref.documentName,
          chunkIndex: ref.chunkIndex,
          pageNo: ref.pageNo,
          score: ref.score,
          contentSnapshot: ref.content,
        }),
      );
      await manager.save(MessageReference, referenceEntities);
    }

    return savedMessage;
  });
}
```

### 14.3 不使用长事务

**不**将 SSE 流式过程包裹在单个事务中——SSE 持续时间长（数十秒），长事务会占用数据库连接并可能导致死锁。各步骤独立短事务。

---

## 十五、SSE 接口绕过全局响应包装（冻结级，设计问题 12）

### 15.1 已有支持

`ResponseInterceptor` 已有两层保护：

1. `@SkipResponseWrap()` 装饰器 → `skipResponseWrap = true` → 直接 `return next.handle()`
2. `isEventStream(response)` 检查 → `Content-Type` 含 `text/event-stream` → 不包装

### 15.2 T11 使用方式

```ts
@Post('chat')
@SkipResponseWrap()           // 第一层：装饰器
async chat(...): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');  // 第二层：响应头
  // ...
}
```

双保险：即使装饰器遗漏，`text/event-stream` 也会触发 `isEventStream()` 跳过包装。

### 15.3 非 SSE 接口（会话列表、消息历史、删除会话）

`GET /api/knowledge-bases/:id/conversations`、`GET /api/conversations/:id/messages`、`DELETE /api/conversations/:id` 不加 `@SkipResponseWrap()`——走正常 `ResponseInterceptor` 包装为 `{ code: 0, message: 'success', data }`。

---

## 十六、删除会话级联行为（冻结级，设计问题 13）

### 16.1 决策：MySQL CASCADE 自动级联

`Conversation` 实体已有 `@ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })`，`Message` 实体已有 `@ManyToOne(() => Conversation, { onDelete: 'CASCADE' })`，`MessageReference` 实体已有 `@ManyToOne(() => Message, { onDelete: 'CASCADE' })`。

删除会话时 MySQL 自动级联删除该会话下的所有 `message` 行和 `message_reference` 行。

### 16.2 不清理 Qdrant 向量

**决策**：删除会话时**不**清理 Qdrant 向量。

**理由**：Qdrant 向量属于**文档**（`documentId` payload），不属于会话。删除会话只删除对话记录，不影响已入库的文档向量。文档删除时才需要清理向量（T08 已实现）。

### 16.3 实现

```ts
// ConversationService
async remove(id: number): Promise<void> {
  const conversation = await this.conversationRepository.findOne({
    where: { id },
    select: ['id'],
  });

  if (conversation === null) {
    throw new NotFoundException('会话不存在');
  }

  await this.conversationRepository.delete(id);
  // MySQL CASCADE 自动删除 messages 和 message_references
}
```

---

## 十七、并发提交和重复请求处理（冻结级，设计问题 14）

### 17.1 决策：同会话 in-flight 去重

使用 `Map<number, AbortController>` 跟踪正在进行的会话请求：

```ts
// ChatService
private readonly inFlightConversations = new Map<number, AbortController>();

async streamChat(...): Promise<void> {
  // ... 创建/校验会话后
  const conversationId = conversation.id;

  if (this.inFlightConversations.has(conversationId)) {
    throw new ConflictException('该会话正在处理中，请等待当前回答完成');
  }

  const internalAbortController = new AbortController();
  this.inFlightConversations.set(conversationId, internalAbortController);

  try {
    // ... 流式处理
  } finally {
    this.inFlightConversations.delete(conversationId);
  }
}
```

### 17.2 新会话不需要去重

新建会话（`conversationId` 未传）不会有并发冲突——每次请求创建新的会话。

### 17.3 去重范围

只对同一 `conversationId` 去重。不同知识库、不同会话的请求互不影响。

### 17.4 异常映射

重复请求 → `ConflictException`（409）。但 SSE 接口的异常处理需要特殊处理——如果 SSE 已经开始（`Content-Type` 已设置），409 无法通过正常 HTTP 状态码返回。

**解决方案**：在设置 SSE 响应头**之前**完成会话校验和去重检查。如果去重检查失败，此时响应头未设置，可以正常返回 409 JSON 响应。

```ts
// ChatService.streamChat() 流程
async streamChat(kbId, question, conversationId?, topK?, scoreThreshold?, res, externalAbortSignal): Promise<void> {
  // 1. 会话准备（此时 res 还未设置 SSE 头）
  const { conversation, userMessage } = await this.prepareConversation(kbId, question, conversationId);

  // 2. 去重检查（此时仍可正常抛 HttpException）
  if (this.inFlightConversations.has(conversation.id)) {
    throw new ConflictException('该会话正在处理中，请等待当前回答完成');
  }

  // 3. 设置 SSE 响应头（此后只能通过 SSE 事件返回错误）
  res.setHeader('Content-Type', 'text/event-stream');
  // ...
  res.flushHeaders();

  // 4. 注册 in-flight
  const internalAbortController = new AbortController();
  this.inFlightConversations.set(conversation.id, internalAbortController);

  try {
    // ... 流式处理
  } finally {
    this.inFlightConversations.delete(conversation.id);
  }
}
```

---

## 十八、与 T12 前端页面的接口契约（冻结级，设计问题 15）

### 18.1 SSE 接口契约

T12 前端使用 `fetch` POST + `ReadableStream` 解析 SSE（不用 `EventSource`，因为 `EventSource` 只支持 GET）。

**前端消费方式**：

```ts
const response = await fetch(`/api/knowledge-bases/${kbId}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question, conversationId }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';

  for (const frame of frames) {
    const eventLine = frame.match(/event: (.+)/);
    const dataLine = frame.match(/data: (.+)/s);

    if (eventLine && dataLine) {
      const eventName = eventLine[1].trim();
      const data = JSON.parse(dataLine[1].trim());

      switch (eventName) {
        case 'metadata': // { conversationId, userMessageId }
        case 'token':    // { delta }
        case 'references': // ReferenceSnapshot[]
        case 'done':     // { assistantMessageId }
        case 'error':    // { message }
      }
    }
  }
}
```

### 18.2 非 SSE 接口契约

- `GET /api/knowledge-bases/:id/conversations` → `{ code: 0, data: ConversationResponseDto[] }`
- `GET /api/conversations/:id/messages` → `{ code: 0, data: MessageResponseDto[] }`
- `DELETE /api/conversations/:id` → 204

### 18.3 前端状态约定

| 状态 | 触发 |
|---|---|
| 连接中 | `fetch` 已发送，未收到 `metadata` 事件 |
| 生成中 | 收到 `metadata` 后，收到 `done` 或 `error` 前 |
| 完成 | 收到 `done` 事件 |
| 失败 | 收到 `error` 事件，或流意外中断 |

---

## 十九、ChatService 完整流程规格

### 19.1 streamChat() 主流程

```ts
async streamChat(
  knowledgeBaseId: number,
  question: string,
  conversationId: number | undefined,
  topK: number | undefined,
  scoreThreshold: number | undefined,
  res: Response,
  externalAbortSignal: AbortSignal,
): Promise<void> {
  // 1. 会话准备（SSE 头未设置，可正常抛 HttpException）
  const { conversation, userMessage } = await this.prepareConversation(
    knowledgeBaseId,
    question,
    conversationId,
  );

  // 2. 去重检查
  if (this.inFlightConversations.has(conversation.id)) {
    throw new ConflictException('该会话正在处理中，请等待当前回答完成');
  }

  // 3. 设置 SSE 响应头
  const writer = new SseWriter(res);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 4. 注册 in-flight
  const internalAbortController = new AbortController();
  this.inFlightConversations.set(conversation.id, internalAbortController);

  // 链接外部 abort（客户端断开）到内部 controller
  const onExternalAbort = (): void => internalAbortController.abort();
  externalAbortSignal.addEventListener('abort', onExternalAbort, {
    once: true,
  });

  try {
    // 5. 发送 metadata 事件
    writer.writeEvent('metadata', {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
    });

    // 6. 检索
    const retrievalData = await this.retrievalService.search(
      knowledgeBaseId,
      question,
      topK,
      scoreThreshold,
    );

    // 7. 无命中短路
    if (retrievalData.results.length === 0) {
      const answer = '知识库中未找到与您问题相关的内容。';
      const assistantMessage =
        await this.messageService.saveMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: answer,
          status: 'completed',
          errorMessage: null,
        });

      writer.writeEvent('token', { delta: answer });
      writer.writeEvent('references', []);
      writer.writeEvent('done', {
        assistantMessageId: assistantMessage.id,
      });

      this.logger.log(
        `流式问答无命中：conversationId=${conversation.id}，retrievalTook=${retrievalData.took}ms`,
      );
      return;
    }

    // 8. 构建上下文
    const { context, usedResultCount } = buildContext(
      retrievalData.results,
      this.contextMaxChars,
    );
    const usedResults = retrievalData.results.slice(0, usedResultCount);

    // 9. 加载历史消息
    const historyMessages = await this.loadHistoryMessages(
      conversation.id,
      conversationId,
    );

    // 10. 组装 messages
    const userPrompt = `参考资料：\n\n${context}\n\n用户问题：${question}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: 'user', content: userPrompt },
    ];

    // 11. 流式 LLM 调用
    let fullAnswer = '';
    let llmFailed = false;
    let failureMessage = '';

    try {
      for await (const chunk of this.llmClient.chatStream(
        messages,
        internalAbortController.signal,
      )) {
        if (internalAbortController.signal.aborted) {
          break;
        }

        if (chunk.delta.length > 0) {
          fullAnswer += chunk.delta;
          writer.writeEvent('token', { delta: chunk.delta });
        }

        if (chunk.finishReason === 'done' || chunk.finishReason === 'stop') {
          break;
        }
      }
    } catch (error: unknown) {
      llmFailed = true;
      failureMessage = this.getSafeErrorMessage(error);
    }

    // 12. 客户端断开检查
    if (internalAbortController.signal.aborted && !llmFailed) {
      // 客户端断开，保存部分内容
      await this.messageService.saveMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: fullAnswer,
        status: 'failed',
        errorMessage: '客户端断开连接',
      });
      this.logger.warn(
        `流式问答客户端断开：conversationId=${conversation.id}，已保存部分内容（${fullAnswer.length} 字符）`,
      );
      return;
    }

    // 13. LLM 失败
    if (llmFailed) {
      await this.messageService.saveMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: fullAnswer,
        status: 'failed',
        errorMessage: failureMessage,
      });
      writer.writeEvent('error', {
        message: '问答服务暂时不可用：模型调用失败',
      });
      this.logger.error(
        `流式问答模型调用失败：conversationId=${conversation.id}，reason=${failureMessage}`,
      );
      return;
    }

    // 14. 成功保存助手消息 + references
    const references: ReferenceSnapshot[] = usedResults.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      pageNo: r.pageNo,
      content: r.content,
      score: r.score,
    }));

    const assistantMessage =
      await this.messageService.saveAssistantMessageWithReferences(
        conversation.id,
        fullAnswer,
        usedResults.map((r) => ({
          documentId: r.documentId,
          chunkId: r.chunkId,
          documentName: r.documentName,
          chunkIndex: r.chunkIndex,
          pageNo: r.pageNo,
          score: r.score,
          contentSnapshot: r.content,
        })),
      );

    // 15. 发送 references 和 done
    writer.writeEvent('references', references);
    writer.writeEvent('done', {
      assistantMessageId: assistantMessage.id,
    });

    this.logger.log(
      `流式问答完成：conversationId=${conversation.id}，referenceCount=${references.length}，answerLength=${fullAnswer.length}`,
    );
  } catch (error: unknown) {
    // 检索失败或其他未预期错误
    writer.writeEvent('error', {
      message: this.getSafeErrorMessage(error),
    });
    this.logger.error(
      `流式问答失败：conversationId=${conversation.id}，${this.getSafeErrorMessage(error)}`,
    );
  } finally {
    this.inFlightConversations.delete(conversation.id);
    externalAbortSignal.removeEventListener('abort', onExternalAbort);
    writer.end();
  }
}
```

### 19.2 prepareConversation() 辅助方法

```ts
private async prepareConversation(
  knowledgeBaseId: number,
  question: string,
  conversationId: number | undefined,
): Promise<{ conversation: Conversation; userMessage: Message }> {
  let conversation: Conversation;

  if (conversationId !== undefined) {
    conversation = await this.conversationService.findConversationById(
      conversationId,
    );

    if (conversation === null || conversation.kbId !== knowledgeBaseId) {
      throw new NotFoundException('会话不存在');
    }
  } else {
    conversation = await this.conversationService.createConversation(
      knowledgeBaseId,
      question.slice(0, 30),
    );
  }

  const userMessage = await this.messageService.saveMessage({
    conversationId: conversation.id,
    role: 'user',
    content: question,
    status: 'completed',
    errorMessage: null,
  });

  return { conversation, userMessage };
}
```

### 19.3 loadHistoryMessages() 辅助方法

```ts
private async loadHistoryMessages(
  conversationId: number,
  originalConversationId: number | undefined,
): Promise<ChatMessage[]> {
  // 只有继续已有会话时才加载历史
  if (originalConversationId === undefined || this.historyMaxMessages === 0) {
    return [];
  }

  const recentMessages = await this.messageService.findRecentMessages(
    conversationId,
    this.historyMaxMessages,
  );

  return recentMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
```

### 19.4 getSafeErrorMessage() 辅助方法

```ts
private getSafeErrorMessage(error: unknown): string {
  if (error instanceof EmbeddingFailure) {
    return '向量生成失败';
  }
  if (error instanceof LlmFailure) {
    return '模型调用失败';
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return '请求被中断';
  }
  return '未知错误';
}
```

---

## 二十、ConversationService 规格

```ts
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  async createConversation(
    knowledgeBaseId: number,
    title: string,
  ): Promise<Conversation> {
    const conversation = this.conversationRepository.create({
      kbId: knowledgeBaseId,
      title,
    });
    return this.conversationRepository.save(conversation);
  }

  async findConversationById(id: number): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: { id },
    });
  }

  async findConversationsByKnowledgeBaseId(
    knowledgeBaseId: number,
  ): Promise<Conversation[]> {
    return this.conversationRepository.find({
      where: { kbId: knowledgeBaseId },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  async remove(id: number): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id },
      select: ['id'],
    });

    if (conversation === null) {
      throw new NotFoundException('会话不存在');
    }

    await this.conversationRepository.delete(id);
  }
}
```

---

## 二十一、MessageService 规格

```ts
@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(MessageReference)
    private readonly referenceRepository: Repository<MessageReference>,
    private readonly dataSource: DataSource,
  ) {}

  async saveMessage(params: {
    conversationId: number;
    role: MessageRole;
    content: string;
    status: MessageStatus;
    errorMessage: string | null;
  }): Promise<Message> {
    const message = this.messageRepository.create({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      status: params.status,
      errorMessage: params.errorMessage,
    });
    return this.messageRepository.save(message);
  }

  async saveAssistantMessageWithReferences(
    conversationId: number,
    content: string,
    references: Array<{
      documentId: number;
      chunkId: number;
      documentName: string;
      chunkIndex: number;
      pageNo: number | null;
      score: number;
      contentSnapshot: string;
    }>,
  ): Promise<Message> {
    return this.dataSource.transaction(async (manager) => {
      const message = manager.create(Message, {
        conversationId,
        role: 'assistant',
        content,
        status: 'completed',
        errorMessage: null,
      });
      const savedMessage = await manager.save(message);

      if (references.length > 0) {
        const entities = references.map((ref) =>
          manager.create(MessageReference, {
            messageId: savedMessage.id,
            documentId: ref.documentId,
            chunkId: ref.chunkId,
            documentName: ref.documentName,
            chunkIndex: ref.chunkIndex,
            pageNo: ref.pageNo,
            score: ref.score,
            contentSnapshot: ref.contentSnapshot,
          }),
        );
        await manager.save(MessageReference, entities);
      }

      return savedMessage;
    });
  }

  async findMessagesByConversationId(
    conversationId: number,
  ): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { id: 'ASC' },
      relations: ['references'],
    });
  }

  async findRecentMessages(
    conversationId: number,
    limit: number,
  ): Promise<Message[]> {
    // 取最近 limit 条消息，但按时间正序返回（ oldest→newest ）
    const messages = await this.messageRepository.find({
      where: { conversationId, status: 'completed' },
      order: { id: 'DESC' },
      take: limit,
    });
    return messages.reverse();
  }
}
```

> **注意**：`findRecentMessages` 过滤 `status='completed'` —— `failed` 消息不作为历史传给 LLM（失败回答可能不正确）。

---

## 二十二、ConversationController 规格

```ts
@ApiTags('conversations')
@Controller()
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  @Get('knowledge-bases/:id/conversations')
  @ApiOperation({ summary: '获取知识库的会话列表' })
  @ApiOkResponse({ type: ConversationResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  async listConversations(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<ConversationResponseDto[]> {
    // 校验知识库存在（复用 KnowledgeBase Repository 或 Service）
    // 此处通过注入 KnowledgeBaseRepository 或 KnowledgeBaseService 校验
    const conversations =
      await this.conversationService.findConversationsByKnowledgeBaseId(id);
    return conversations.map(ConversationResponseDto.fromEntity);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '获取会话消息历史（含引用）' })
  @ApiOkResponse({ type: MessageResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '会话不存在' })
  async listMessages(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<MessageResponseDto[]> {
    const conversation = await this.conversationService.findConversationById(id);
    if (conversation === null) {
      throw new NotFoundException('会话不存在');
    }
    const messages =
      await this.messageService.findMessagesByConversationId(id);
    return messages.map(MessageResponseDto.fromEntity);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除会话' })
  @ApiNoContentResponse({ description: '会话删除成功' })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '会话不存在' })
  async remove(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<void> {
    await this.conversationService.remove(id);
  }
}
```

> **注意**：`ConversationController` 使用 `@Controller()` 无前缀，因为路由路径混合了 `knowledge-bases/:id/conversations` 和 `conversations/:id/messages` 两种前缀。每个方法用完整路径装饰器。

> **知识库存在性校验**：`listConversations` 需要校验知识库存在。实现方式有两种：
> 1. 注入 `KnowledgeBaseRepository` 直接查（简单但跨模块）
> 2. 注入 `KnowledgeBaseService`（但 `KnowledgeBaseModule` 不 exports 它）
>
> **推荐方案**：在 `ConversationModule` 的 `TypeOrmModule.forFeature()` 中注册 `KnowledgeBase` 实体，在 `ConversationService` 中注入 `KnowledgeBaseRepository` 进行校验。这与 `RetrievalModule` 的做法一致（它也注册了 `KnowledgeBase` 实体）。

---

## 二十三、日志和异常处理

### 23.1 日志矩阵

| 事件 | 级别 | 内容 |
|---|---|---|
| 流式问答启动 | `log` | `流式问答启动：kbId={id}，conversationId={cid}，question="{truncated}"` |
| 流式问答无命中 | `log` | `流式问答无命中：conversationId={cid}，retrievalTook={ms}ms` |
| 流式问答完成 | `log` | `流式问答完成：conversationId={cid}，referenceCount={n}，answerLength={n}` |
| 流式问答模型失败 | `error` | `流式问答模型调用失败：conversationId={cid}，reason={message}` |
| 流式问答客户端断开 | `warn` | `流式问答客户端断开：conversationId={cid}，已保存部分内容（{n} 字符）` |
| 流式问答检索失败 | `error` | `流式问答检索失败：conversationId={cid}，reason={message}` |
| 会话创建 | `log` | `会话创建：kbId={id}，conversationId={cid}，title="{truncated}"` |
| 会话删除 | `log` | `会话删除：conversationId={cid}` |
| 重复请求拒绝 | `warn` | `流式问答重复请求：conversationId={cid}` |

### 23.2 question 截断

日志中的 question 截断到 50 字符（同 T10）。

### 23.3 SSE 中的异常映射

| 阶段 | 异常类型 | 处理方式 |
|---|---|---|
| SSE 头设置前 | `NotFoundException`/`BadRequestException`/`ConflictException` | 正常 HTTP 状态码响应（全局过滤器处理） |
| SSE 头设置后 | `EmbeddingFailure`/`LlmFailure`/其他 | `error` SSE 事件 + `finally` 中 `writer.end()` |
| SSE 头设置后 | 客户端断开 | 不发送事件，保存部分内容，`finally` 中清理 |

---

## 二十四、Mock 流式验收（冻结级）

### 24.1 全链路 Mock 配置

```env
QDRANT_MOCK=true
EMBEDDING_MOCK=true
LLM_MOCK=true
```

### 24.2 Mock 流式行为

`LLM_MOCK=true` 时 `LlmClient.chatStream()` 返回逐 token 的 Mock 回答：
- Mock 回答内容同 T10 非流式 `mockChat()`（根据来源数量生成模板回答）
- 按 5 字符一组，每组间隔 50ms，模拟逐 token 输出
- 最后一个 chunk 的 `finishReason` 为 `stop`

### 24.3 Mock 验收可观测性

Mock 流式使得 SSE 的 token 事件可被明确观测——前端（或 curl）可逐行看到 `event: token` 事件，验证流式链路完整性。

---

## 二十五、文件修改清单

### 25.1 新增文件（13 个）

```text
server/src/modules/conversation/
├─ conversation.module.ts
├─ conversation.service.ts
├─ message.service.ts
├─ conversation.controller.ts
└─ dto/
   ├─ conversation-response.dto.ts
   └─ message-response.dto.ts

server/src/modules/chat/
├─ chat.module.ts
├─ chat.service.ts
├─ chat.controller.ts
├─ chat.types.ts
├─ sse-writer.ts
└─ dto/
   └─ chat-request.dto.ts

docs/reports/task-11-completion.md（Codex 完成后生成）
```

### 25.2 修改文件（7 个）

```text
server/src/modules/llm/llm.types.ts          — 追加流式类型
server/src/modules/llm/llm-client.ts         — 新增 chatStream() + mockChatStream()
server/src/config/configuration.ts            — 追加 chat 配置段
server/src/config/env.validation.ts          — 追加 CHAT_HISTORY_MAX_MESSAGES
server/src/app.module.ts                      — imports 追加 ConversationModule + ChatModule
.env.example                                  — 追加 CHAT_HISTORY_MAX_MESSAGES
docs/00-overall-plan.md                       — v2.0 回填（§二十八）
```

### 25.3 不修改的文件

全部实体定义、既有 migration、`main.ts`、`http-exception.filter.ts`、`response.interceptor.ts`、`skip-response-wrap.decorator.ts`、`parse-positive-int.pipe.ts`、`docker-compose.yml`、`web/`、processing 模块、parsing/chunking 子目录、retrieval 模块、embedding 模块、vector-store 模块、knowledge-base 模块、document 模块、rag 模块。

---

## 二十六、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05-T10）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§七）；`pnpm --filter server build` 通过。
2. 新建 `src/modules/llm/llm.types.ts` 追加流式类型（§八.2）；`pnpm --filter server build` 通过。
3. 修改 `src/modules/llm/llm-client.ts` 新增 `chatStream()` + `mockChatStream()` + `parseSseStream()`（§八）；`pnpm --filter server build` 通过。
4. 新建 `src/modules/conversation/dto/conversation-response.dto.ts` + `message-response.dto.ts`（§三）。
5. 新建 `src/modules/conversation/conversation.service.ts`（§二十）。
6. 新建 `src/modules/conversation/message.service.ts`（§二十一）。
7. 新建 `src/modules/conversation/conversation.controller.ts`（§二十二）。
8. 新建 `src/modules/conversation/conversation.module.ts`（§六）；`pnpm --filter server build` 通过。
9. 新建 `src/modules/chat/chat.types.ts`（§四.6）。
10. 新建 `src/modules/chat/sse-writer.ts`（§九.2）。
11. 新建 `src/modules/chat/dto/chat-request.dto.ts`（§三.2）。
12. 新建 `src/modules/chat/chat.service.ts`（§十九）；`pnpm --filter server build` 通过。
13. 新建 `src/modules/chat/chat.controller.ts`（§九、§十）。
14. 新建 `src/modules/chat/chat.module.ts`（§六）。
15. 修改 `src/app.module.ts`：imports 追加 `ConversationModule` + `ChatModule`；`pnpm --filter server build` 通过。
16. 回填 `docs/00-overall-plan.md` v2.0（§二十八）。
17. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
18. 执行 §二十七全量验收。

---

## 二十七、验收方式（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功（DB 端口冲突须先解决）。
> **Mock 模式验收**：以下验收命令在 `QDRANT_MOCK=true` + `EMBEDDING_MOCK=true` + `LLM_MOCK=true` 下执行。

```powershell
# 0. 静态检查
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show  # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → 完整流水线
$env:QDRANT_MOCK='true'
$env:EMBEDDING_MOCK='true'
$env:LLM_MOCK='true'
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t11-chat-kb\"}"
# 记录知识库 ID，假设为 $kbId

# 上传 TXT
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/documents" -F "file=@tmp-test\rag-intro.txt"
# 记录文档 ID，假设为 $docId

pnpm --filter server parse:document $docId
pnpm --filter server chunk:document $docId
pnpm --filter server embed:document $docId
pnpm --filter server store:document $docId
# 确认 status=completed, chunk_count>0

# 2. SSE 流式问答（新会话）— 使用 curl --no-buffer 接收 SSE
curl.exe --no-buffer -N -X POST "http://localhost:3000/api/knowledge-bases/$kbId/chat" -H "Content-Type: application/json" -d "{\"question\":\"RAG is retrieval augmented generation\"}"
# 预期输出（逐行）：
# event: metadata
# data: {"conversationId":1,"userMessageId":1}
# event: token
# data: {"delta":"根据知识库中的 1 条"}
# ...（更多 token）
# event: references
# data: [{"chunkId":...,"documentId":...,"documentName":"rag-intro.txt","pageNo":null,"content":"RAG is retrieval augmented generation","score":1}]
# event: done
# data: {"assistantMessageId":2}

# 3. 验证会话列表
curl.exe "http://localhost:3000/api/knowledge-bases/$kbId/conversations"
# 预期：code=0, data 数组长度>=1, 包含 id/title/createdAt/updatedAt

# 4. 验证消息历史（含引用）
# 记录会话 ID，假设为 $convId
curl.exe "http://localhost:3000/api/conversations/$convId/messages"
# 预期：code=0, data 数组长度=2（user + assistant）
# user 消息：role="user", content="RAG is retrieval augmented generation", status="completed"
# assistant 消息：role="assistant", content 非空, status="completed", references 数组长度>=1
# references[0] 包含 documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot

# 5. SSE 继续已有会话
curl.exe --no-buffer -N -X POST "http://localhost:3000/api/knowledge-bases/$kbId/chat" -H "Content-Type: application/json" -d "{\"question\":\"详细解释一下\",\"conversationId\":$convId}"
# 预期：metadata 事件中 conversationId=$convId，有 token/references/done 事件

# 6. 无命中 SSE 问答
curl.exe --no-buffer -N -X POST "http://localhost:3000/api/knowledge-bases/$kbId/chat" -H "Content-Type: application/json" -d "{\"question\":\"completely unrelated cooking question\"}"
# 预期：
# metadata 事件
# token 事件（delta="知识库中未找到与您问题相关的内容。"）
# references 事件（空数组 []）
# done 事件

# 7. 空问题 → 400
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/chat" -H "Content-Type: application/json" -d "{\"question\":\"\"}"
# 预期：400 参数校验失败

# 8. 不存在的知识库 → 404
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/999999/chat" -H "Content-Type: application/json" -d "{\"question\":\"test\"}"
# 预期：404

# 9. 不存在的会话 → 404
curl.exe -X POST "http://localhost:3000/api/knowledge-bases/$kbId/chat" -H "Content-Type: application/json" -d "{\"question\":\"test\",\"conversationId\":999999}"
# 预期：404 会话不存在

# 10. 删除会话
curl.exe -X DELETE "http://localhost:3000/api/conversations/$convId"
# 预期：204
# 验证删除后：
curl.exe "http://localhost:3000/api/conversations/$convId/messages"
# 预期：404 会话不存在

# 11. Swagger 包含新接口
curl.exe http://localhost:3000/api/docs-json | jq '.paths | keys[] | select(contains("chat") or contains("conversations"))'
# 预期：包含 "knowledge-bases/{id}/chat"、"knowledge-bases/{id}/conversations"、"conversations/{id}/messages"、"conversations/{id}"

# 12. 越界检查
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：仍只有原 6 张业务表加 migrations（无新表）

# 13. 范围扫描
# rg "websocket|WebSocket|EventSource|Rerank|rerank|GraphRAG|agent\b" server/src/modules/chat server/src/modules/conversation server/src/app.module.ts
# 预期：无命中

# 14. 清理
curl.exe -X DELETE "http://localhost:3000/api/knowledge-bases/$kbId"
Remove-Item -Recurse -Force tmp-test -ErrorAction SilentlyContinue
```

---

## 二十八、基线回填（00-overall-plan.md v2.0，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §9 API #10 路径由 `POST /api/chat/stream` 改为 `POST /api/knowledge-bases/:id/chat` | 与已有 `/api/knowledge-bases/:id/ask`（T10）和 `/api/knowledge-bases/:id/retrieve`（T09）保持一致路径风格；`knowledgeBaseId` 从 body 移至路径参数 |
| 2 | §9 API #10-#13 在 T11 实现 | SSE 流式问答（#10→#16）、会话列表（#11→#17）、消息历史（#12→#18）、删除会话（#13→#19） |
| 3 | §7 模块划分补充：`conversation` 模块和 `chat` 模块在 T11 创建 | `ConversationModule`（会话/消息/引用存取）+ `ChatModule`（SSE 编排）；`chat` 模块依赖 `RetrievalModule` + `LlmModule` + `ConversationModule` |
| 4 | §12 环境变量补充 `CHAT_HISTORY_MAX_MESSAGES` | T11 首次使用历史上下文，需配置传给 LLM 的历史消息条数 |
| 5 | §4.2 问答流水线 ⑥⑦ 更新：T11 实现 SSE 流式 + 落库 | ⑥ `stream=true` 逐 token SSE 推送（metadata/token/references/done/error 事件）；⑦ 助手消息 + message_reference 在流结束后事务保存 |
| 6 | §15 风险 4 更新：SSE 响应头 `X-Accel-Buffering: no` 已在 T11 实现 | nginx 反代缓冲应对措施已落地 |
| 7 | `LlmClient` 新增 `chatStream()` 流式方法 | T10 的 `chat()` 非流式方法保持不变；T11 扩展流式调用能力 |
| 8 | §7 `llm` 模块说明更新：T11 扩展流式 Chat Completions | `llm` 模块从 T10 的非流式客户端扩展为支持流式 |

---

## 二十九、明确禁止（本任务一律不实现）

前端页面、WebSocket、Rerank、Agent、GraphRAG、多租户、权限系统、消息队列、新增数据库表、新增 migration、修改既有 migration、修改已定义实体（Conversation/Message/MessageReference）、修改 `web/`、修改 `RetrievalService`/`RetrievalModule`、修改 `RagService`/`RagModule`、修改 `EmbeddingService`/`EmbeddingClient`/`EmbeddingModule`、修改 `VectorStoreService`/`VectorStoreModule`、修改 `KnowledgeBaseService`/`KnowledgeBaseModule`、修改 `DocumentService`/`DocumentModule`、修改全局异常过滤器/main.ts/docker-compose.yml、修改 `ResponseInterceptor`、修改任何文档的 `status` 字段、上传后自动触发流水线、启动恢复钩子、OCR、自动生成会话标题的额外 LLM 调用、Conversation 级别的向量清理、引入 `openai` SDK、引入 `axios`、引入 `langchain`、引入测试框架（T16 统一补）。

---

## 三十、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① `LlmClient.chatStream()` 使用 `fetch` + `stream:true` + SSE 解析 ② Mock 流式逐 token 输出 ③ `ChatService.streamChat()` 编排全流程 ④ `@SkipResponseWrap()` + `text/event-stream` 绕过响应包装 ⑤ `req.on('close')` → `AbortController.abort()` 客户端断开处理 ⑥ 用户消息检索前保存、助手消息 LLM 完成后事务保存 ⑦ `MessageReference` 快照来自实际进入 Prompt 的 `RetrievalResult` ⑧ `conversationId` 不传创建新会话（title=首问题 30 字）、传入校验归属 ⑨ 历史 `CHAT_HISTORY_MAX_MESSAGES` 条消息传给 LLM ⑩ `DataSource.transaction()` 包裹助手消息+引用保存 ⑪ MySQL CASCADE 删除会话级联 ⑫ in-flight Map 同会话去重 ⑬ SSE 事件协议（metadata/token/references/done/error）。
3. **启动方式**：DB 端口冲突处理结果；Qdrant/Embedding/LLM 连接方式；Mock 模式开启方式；SSE 问答触发命令。
4. **验证方式**：§二十七逐条结果（成功/失败 + 关键输出）。
5. **已知问题**：含 Mock 回答无语义、Mock Embedding 无语义相似性、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §二十九各项均未实现。

---

## 三十一、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §三十。

```
你是一个 NestJS 后端工程师。请按 docs/task-11-streaming-chat-and-conversation.md 实现 SSE 流式对话与会话管理。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. 确认 Conversation/Message/MessageReference 实体已存在（src/modules/conversation/entities/）
3. 确认 AppEntities（src/database/entities.ts）已包含这三个实体
4. 确认 SkipResponseWrap 装饰器已存在（src/common/decorators/）
5. 确认 ResponseInterceptor 已有 isEventStream() 检查
6. QDRANT_MOCK=true + EMBEDDING_MOCK=true + LLM_MOCK=true 用于无 Docker/API 环境下的验收

## 要做的事（严格按序）

1. 配置：env.validation.ts 加 CHAT_HISTORY_MAX_MESSAGES(@IsDefined @IsInt @Min(0) @Max(20));
   configuration.ts 加 chat:{historyMaxMessages:number};
   .env.example 加 CHAT_HISTORY_MAX_MESSAGES=6

2. llm.types.ts 追加流式类型：
   ChatStreamApiRequest{model,messages,temperature,max_tokens,stream:true}
   ChatStreamDelta{delta:string, finishReason:string|null}

3. llm-client.ts 新增 chatStream() 方法：
   async *chatStream(messages, abortSignal?): AsyncGenerator<ChatStreamDelta>
   - mock=true → mockChatStream：将 mockChat() 结果按 5 字符分组，每组 50ms 延迟，yield delta + finishReason
   - mock=false → httpChatStream：
     · fetch POST {baseUrl}/chat/completions, stream:true, signal=AbortController(timeoutMs + 外部 abortSignal)
     · response.body.getReader() 读取，按 \n\n 分割 SSE 帧
     · parseSseFrame：提取 data: 行，JSON.parse，choices[0].delta.content，choices[0].finish_reason
     · [DONE] → yield {delta:'', finishReason:'done'}
     · 不重试（流式不支持重试）
   - 构造函数不修改，共享已有配置

4. 新建 src/modules/conversation/ 目录：
   - dto/conversation-response.dto.ts:
     ConversationResponseDto{id,title,createdAt,updatedAt} + static fromEntity
   - dto/message-response.dto.ts:
     MessageReferenceResponseDto{documentId,chunkId,documentName,chunkIndex,pageNo,score,contentSnapshot}
     MessageResponseDto{id,role,content,status,errorMessage,createdAt,references[]} + static fromEntity
   - conversation.service.ts:
     · 注入 Conversation Repository
     · createConversation(kbId, title): Promise<Conversation>
     · findConversationById(id): Promise<Conversation|null>
     · findConversationsByKnowledgeBaseId(kbId): Promise<Conversation[]>（按 updatedAt DESC）
     · remove(id): Promise<void>（先查不存在→404，再 delete，MySQL CASCADE）
     · validateKnowledgeBaseExists(kbId): Promise<void>（查 KnowledgeBase Repository，不存在→404）
   - message.service.ts:
     · 注入 Message Repository, MessageReference Repository, DataSource
     · saveMessage({conversationId,role,content,status,errorMessage}): Promise<Message>
     · saveAssistantMessageWithReferences(conversationId, content, references[]): Promise<Message>
       （dataSource.transaction：先 save Message，再 batch save MessageReference）
     · findMessagesByConversationId(conversationId): Promise<Message[]>
       （find + relations:['references'] + order id ASC）
     · findRecentMessages(conversationId, limit): Promise<Message[]>
       （find status=completed + order id DESC + take limit + reverse）
   - conversation.controller.ts:
     · @Controller() 无前缀（路由混合两种前缀）
     · @Get('knowledge-bases/:id/conversations') listConversations(@Param('id',ParsePositiveIntPipe))
       → 校验 KB 存在 → conversationService.findConversationsByKnowledgeBaseId → map fromEntity
     · @Get('conversations/:id/messages') listMessages(@Param('id',ParsePositiveIntPipe))
       → 校验会话存在 → messageService.findMessagesByConversationId → map fromEntity
     · @Delete('conversations/:id') @HttpCode(204) remove(@Param('id',ParsePositiveIntPipe))
       → conversationService.remove
   - conversation.module.ts:
     · imports: TypeOrmModule.forFeature([Conversation, Message, MessageReference, KnowledgeBase])
     · controllers: [ConversationController]
     · providers: [ConversationService, MessageService]
     · exports: [ConversationService, MessageService]

5. 新建 src/modules/chat/ 目录：
   - chat.types.ts:
     ReferenceSnapshot{chunkId,documentId,documentName,pageNo,content,score}
     ChatSseEvent 联合类型（metadata/token/references/done/error）
   - sse-writer.ts:
     class SseWriter {
       constructor(res: Response)
       writeEvent(event: string, data: unknown): void  // res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)
       end(): void  // res.end() if !writableEnded
     }
   - dto/chat-request.dto.ts:
     question(@IsString @IsNotEmpty @MaxLength(2000) @Transform trim)
     conversationId?(@IsOptional @IsInt @Min(1))
     topK?(@IsOptional @IsInt @Min(1) @Max(20))
     scoreThreshold?(@IsOptional @IsNumber @Min(0) @Max(1))
   - chat.service.ts:
     · 注入 RetrievalService, LlmClient, ConversationService, MessageService, ConfigService
     · 读取 chat.historyMaxMessages 和 rag.contextMaxChars
     · private inFlightConversations = new Map<number, AbortController>()
     · async streamChat(kbId, question, conversationId?, topK?, scoreThreshold?, res: Response, externalAbortSignal: AbortSignal): Promise<void>
       流程（§十九）：
       a. prepareConversation：conversationId 传入→查会话+校验 kbId 归属；不传→创建新会话(title=question.slice(0,30))
       b. 保存用户消息（content=question, role=user, status=completed）
       c. inFlightConversations 去重检查（有→409 ConflictException，此时 SSE 头未设置）
       d. 设置 SSE 响应头（Content-Type:text/event-stream, Cache-Control:no-cache, Connection:keep-alive, X-Accel-Buffering:no）
       e. 注册 inFlight + 链接外部 abortSignal
       f. 发送 metadata 事件 {conversationId, userMessageId}
       g. retrievalService.search(kbId, question, topK, scoreThreshold)
       h. 无命中 → 保存助手消息(completed) → 发送 token(固定话术) + references([]) + done
       i. 有命中 → buildContext(results, contextMaxChars) → 加载历史消息 → 组装 messages[system,...history,user]
       j. llmClient.chatStream(messages, internalAbortSignal) → 逐 chunk 发送 token 事件 + 累积 fullAnswer
       k. 客户端断开 → 保存部分内容(failed, "客户端断开连接") → return
       l. LLM 失败 → 保存部分内容(failed, 安全错误摘要) → 发送 error 事件
       m. 成功 → saveAssistantMessageWithReferences(conversationId, fullAnswer, references) → 发送 references + done
       n. finally: 删除 inFlight + removeEventListener + writer.end()
     · getSafeErrorMessage(error): EmbeddingFailure→"向量生成失败", LlmFailure→"模型调用失败", AbortError→"请求被中断", else→"未知错误"
   - chat.controller.ts:
     · @Controller('knowledge-bases/:id/chat') @ApiTags('chat')
     · @Post() @SkipResponseWrap()
     · async chat(@Param('id',ParsePositiveIntPipe) id, @Body() dto: ChatRequestDto, @Res() res, @Req() req): Promise<void>
       → 创建 AbortController, req.on('close', () => abort), try { chatService.streamChat(id, dto.question, dto.conversationId, dto.topK, dto.scoreThreshold, res, abortSignal) } finally { req.off('close', ...) }
   - chat.module.ts:
     · imports: [RetrievalModule, LlmModule, ConversationModule]
     · controllers: [ChatController]
     · providers: [ChatService]

6. app.module.ts: imports 加 ConversationModule + ChatModule

7. 回填 00-overall-plan.md v2.0

## 不做的事
- 不做前端页面/WebSocket/Rerank/Agent/GraphRAG/多租户/权限/消息队列
- 不做新 migration/新表/修改实体定义/改 web/
- 不引入 openai SDK/axios/langchain/测试框架
- 不修改 processing/parsing/chunking/retrieval/embedding/vector-store 模块下任何文件
- 不修改 KnowledgeBaseService/DocumentService/RagService
- 不修改全局异常过滤器/main.ts/docker-compose.yml/ResponseInterceptor
- 不修改任何文档的 status 字段
- 不做自动生成会话标题的额外 LLM 调用
- 不做 Conversation 级别的向量清理

## 验收（QDRANT_MOCK=true + EMBEDDING_MOCK=true + LLM_MOCK=true）
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- SSE 新会话问答: curl --no-buffer -N POST → 收到 metadata/token×N/references/done 事件
- 会话列表: GET → code=0, data 数组含 id/title/createdAt/updatedAt
- 消息历史: GET → code=0, data 含 user+assistant 消息, assistant 带 references
- 继续会话: POST 带 conversationId → metadata 中 conversationId 一致
- 无命中: SSE → token(固定话术) + references([]) + done
- 空问题 → 400
- 不存在的KB → 404
- 不存在的会话 → 404
- 删除会话 → 204, 删除后 GET messages → 404
- Swagger 包含 chat/conversations 路径
- SHOW TABLES 无新表
- rg 范围扫描: 无 websocket/rerank/graphrag/agent 命中
- 清理: 业务数据回0行
```
