# T11 完成报告：SSE 流式问答、会话与消息持久化

> 完成日期：2026-07-31（Asia/Shanghai）  
> 任务范围：T11，仅实现 SSE 流式 RAG、Conversation/Message/MessageReference 持久化与查询删除。

## 新增和修改文件

新增：

- `server/src/modules/chat/chat.controller.ts`
- `server/src/modules/chat/chat.module.ts`
- `server/src/modules/chat/chat.service.ts`
- `server/src/modules/chat/chat.types.ts`
- `server/src/modules/chat/dto/chat-request.dto.ts`
- `server/src/modules/chat/sse-writer.ts`
- `server/src/modules/conversation/conversation.controller.ts`
- `server/src/modules/conversation/conversation.module.ts`
- `server/src/modules/conversation/conversation.service.ts`
- `server/src/modules/conversation/message.service.ts`
- `server/src/modules/conversation/dto/conversation-response.dto.ts`
- `server/src/modules/conversation/dto/message-response.dto.ts`
- `docs/reports/task-11-completion.md`

修改：

- `server/src/app.module.ts`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`
- `server/src/modules/llm/llm-client.ts`
- `server/src/modules/llm/llm.types.ts`
- `.env.example`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`

本地验证时还给未跟踪的 `.env` 补充了 `CHAT_HISTORY_MAX_MESSAGES=6`。

## SSE 事件协议

接口：`POST /api/knowledge-bases/:id/chat`

请求 body：

```json
{
  "question": "什么是 RAG？",
  "conversationId": 1,
  "topK": 5,
  "scoreThreshold": 0.5
}
```

事件：

| 事件 | data |
|---|---|
| `metadata` | `{ "conversationId": number, "userMessageId": number }` |
| `token` | `{ "delta": string }` |
| `references` | `[{ "chunkId": number, "documentId": number, "documentName": string, "pageNo": number \| null, "content": string, "score": number }]` |
| `done` | `{ "assistantMessageId": number }` |
| `error` | `{ "message": string }` |

正常顺序：`metadata -> token* -> references -> done`。  
无命中顺序：`metadata -> token -> references([]) -> done`，不调用 LLM。  
失败顺序：`metadata -> token* -> error` 或 `metadata -> error`。

SSE 接口使用 `@SkipResponseWrap()`，并设置 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`。

## 会话、消息、引用落库流程

- `conversationId` 不传：先校验知识库存在，再创建 `Conversation`，标题为问题前 30 字，不额外调用 LLM 生成标题。
- `conversationId` 传入：校验会话存在且 `kbId` 属于当前知识库；不存在或不归属均返回 404。
- 用户消息在检索前保存为 `role=user,status=completed`，`metadata` 使用真实 `userMessageId`。
- 检索无命中：保存 completed 助手消息，content 为固定无命中提示，references 为空。
- 检索命中：复用 `RetrievalService.search()` 和 T10 `buildRagPrompt()`，取实际进入上下文的检索结果作为引用来源。
- LLM 完整生成成功后，通过 `DataSource.transaction()` 同事务保存 completed 助手消息和批量 `MessageReference` 快照。
- LLM、检索等流内失败时，保存 failed 助手消息，不写引用。
- `MessageService` 保存消息时同步更新 `conversation.updatedAt`，会话列表按 `updatedAt DESC, id DESC` 返回。
- 删除会话使用数据库级联删除 message 和 message_reference。

## LLM 流式调用方式

- `LlmClient.chat()` 保留 T10 非流式行为。
- 新增 `LlmClient.chatStream()`，调用 OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`，请求体 `stream:true`。
- 使用 `fetch` 与 `response.body.getReader()` 读取流，按 SSE frame 解析 `data:` 行，只提取 `choices[0].delta.content` 和 `finish_reason`。
- 流式调用不做失败重试，避免已发送 token 后重放。
- 超时使用 `AbortController`；外部 abort 用于客户端断开。
- `LLM_MOCK=true` 时，按 5 字符一组、约 50ms 间隔输出 mock token。

## 客户端断开处理

- `ChatController` 监听 `req.on('close')`，触发 `AbortController.abort()`。
- `ChatService` 将该 abort signal 传给 `LlmClient.chatStream()`，并在每次写 token 前检查连接状态。
- 客户端断开后停止继续生成，不再写 SSE 事件。
- 已生成的部分内容保存为 failed 助手消息，`errorMessage` 为安全摘要。

## 事务和异常处理

- 助手 completed 消息与 `MessageReference` 使用单事务保存，保证回答和引用一致。
- failed 助手消息单独保存；保存失败只记录日志，不向客户端泄露内部异常。
- SSE `error` 事件只返回安全消息，不包含 API Key、Prompt、原始响应体、堆栈或内部配置。
- 同一会话并发用进程内 `Map<number, AbortController>` 控制；已有生成任务时返回 409，且 SSE 头未设置。

## 实际测试结果

构建与静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3306 pnpm --filter server migration:show` | 失败，命中本机错误 MySQL，`Access denied for user 'root'@'localhost'` |
| 临时启动 `rag-mysql-3307-proxy` 后执行 `DB_HOST=127.0.0.1 DB_PORT=3307 pnpm --filter server migration:show` | 通过，显示 2 条既有 migration 已执行 |
| `rg "\bany\b" server/src/modules/chat server/src/modules/conversation server/src/modules/llm server/src/config server/src/app.module.ts` | 无命中 |
| `rg "WebSocket|websocket|Rerank|rerank|GraphRAG|Agent|EventSource|langchain|axios|from 'openai'|require\('openai'\)" ...` | 无命中 |

集成测试环境：

- Docker 中 `rag-mysql-1` 和 `rag-qdrant-1` 均为 healthy。
- 正常链路使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=true`。
- LLM 异常链路使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=false`、`LLM_BASE_URL=http://127.0.0.1:3999`。
- 测试脚本第一次从仓库根目录运行时未找到 `reflect-metadata`，未进入业务逻辑；改在 `server/` 目录运行。
- 主集成脚本第一次业务请求成功，但测试 helper 因提前读取 SSE body 导致 `ReadableStream is locked`；修正 helper 后重跑通过。

实际场景：

| 场景 | 实际结果 |
|---|---|
| 新会话问答 | `metadata -> token x5 -> references -> done`，引用数 1 |
| 已有会话继续问答 | `metadata.conversationId` 与传入会话一致，返回 token、references、done |
| token 流 | mock LLM 按多次 `token` 事件输出 |
| references 和 done | references 在 token 后发送，done 含 `assistantMessageId` |
| 消息与引用落库 | 消息历史返回 user + assistant，assistant references 含 `documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot` |
| 会话列表 | 返回 `code=0`，包含 `id/title/createdAt/updatedAt` |
| 无命中 | `metadata -> token -> references([]) -> done` |
| 空问题 | HTTP 400 |
| 知识库不存在 | HTTP 404 |
| 会话不存在 | HTTP 404 |
| 会话不属于当前知识库 | HTTP 404 |
| 同一会话并发 | 第二个请求 HTTP 409 |
| 客户端断开 | 生成被 abort，落库 failed assistant message |
| LLM 调用失败 | SSE `metadata -> error`，无 `done`；落库 user completed + assistant failed；引用数 0 |
| 删除会话 | HTTP 204；删除后消息查询 HTTP 404；直接查库确认 message/reference 级联删除 |
| 测试数据清理 | `t11-chat-%`、`t11-llm-failure-%` 知识库残留为 0；相关测试标题会话残留为 0 |

## 未完成项与已知问题

- 未调用真实外部 LLM；正常输出使用 `LLM_MOCK=true`，失败路径使用不可连接的本地 base URL。
- 未使用真实 Embedding 服务；本次用 `EMBEDDING_MOCK=true` 验证链路，不评价语义召回质量。
- 默认 `.env` 的 `localhost:3306` 在本机可能误连历史 MySQL；本次使用临时 3307 转发容器验证，验证后已删除该容器。
- `pnpm --filter ...` 在当前工作区会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令实际执行成功。

## 越界检查

- 没有新增前端页面。
- 没有实现 WebSocket。
- 没有实现 Rerank、Agent、GraphRAG。
- 没有新增数据库表或 migration。
- 没有修改已执行 migration。
- 没有引入 OpenAI SDK、axios 或 langchain。
- 没有额外调用 LLM 生成会话标题。

## 是否具备进入前端开发阶段

具备。T11 后端 SSE 问答、会话列表、消息历史、删除会话、消息和引用落库已经实现并通过本次实际验证。
