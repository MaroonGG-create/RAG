# Mini RAG 当前实现快照

> 快照日期：2026-07-31（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 当前阶段：T11 SSE 流式问答、会话与消息持久化完成
> 详细报告：`docs/reports/task-11-completion.md`

## 当前结论

- T01-T10 能力保持可用：知识库、文档上传、解析、清洗切片、Embedding、Qdrant 写入、向量检索、非流式 RAG 问答均保留原模块职责。
- T11 新增 `ConversationModule` 与 `ChatModule`，实现 SSE 流式 RAG 问答、会话列表、消息历史、会话删除、用户/助手消息落库和引用快照落库。
- 本次没有新增数据库表或 migration；`conversation`、`message`、`message_reference` 继续使用初始 migration 已定义的表。
- 本次没有实现前端页面、WebSocket、Rerank、Agent、GraphRAG、消息队列、权限系统或新的检索/LLM 能力。

## 后端模块

当前业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`
- `VectorStoreModule`
- `RetrievalModule`
- `LlmModule`
- `RagModule`
- `ConversationModule`
- `ChatModule`

T11 新增结构：

```text
server/src/modules/conversation/
├── conversation.controller.ts
├── conversation.module.ts
├── conversation.service.ts
├── dto/
│   ├── conversation-response.dto.ts
│   └── message-response.dto.ts
├── entities/
│   ├── conversation.entity.ts
│   ├── message.entity.ts
│   └── message-reference.entity.ts
└── message.service.ts

server/src/modules/chat/
├── chat.controller.ts
├── chat.module.ts
├── chat.service.ts
├── chat.types.ts
├── dto/
│   └── chat-request.dto.ts
└── sse-writer.ts
```

## 接口

已有接口继续保留：

```text
POST /api/knowledge-bases/:id/retrieve
POST /api/knowledge-bases/:id/ask
```

T11 新增接口：

```text
POST /api/knowledge-bases/:id/chat
GET  /api/knowledge-bases/:id/conversations
GET  /api/conversations/:id/messages
DELETE /api/conversations/:id
```

`POST /api/knowledge-bases/:id/chat` 请求 body：

```json
{
  "question": "什么是 RAG？",
  "conversationId": 1,
  "topK": 5,
  "scoreThreshold": 0.5
}
```

SSE 事件协议：

```text
metadata   data: {"conversationId":1,"userMessageId":5}
token      data: {"delta":"..."}
references data: [{"chunkId":123,"documentId":45,"documentName":"a.txt","pageNo":null,"content":"...","score":1}]
done       data: {"assistantMessageId":6}
error      data: {"message":"问答服务暂时不可用：模型调用失败"}
```

正常顺序为 `metadata -> token* -> references -> done`；失败顺序为 `metadata -> token* -> error` 或 `metadata -> error`。SSE 接口使用 `@SkipResponseWrap()` 和 `Content-Type: text/event-stream` 绕过统一响应包装。

## 配置

T11 新增配置：

| 环境变量 | 实际默认/示例 | 校验 |
|---|---:|---|
| `CHAT_HISTORY_MAX_MESSAGES` | 6 | 整数，0-20 |

继续使用的相关配置：

| 环境变量 | 默认/示例 | 用途 |
|---|---:|---|
| `CONTEXT_MAX_CHARS` | 4000 | 检索上下文最大字符数 |
| `TOP_K` | 5 | 检索默认 TopK |
| `SCORE_THRESHOLD` | 0.5 | 检索默认阈值 |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容 Chat Completions 地址 |
| `LLM_MODEL` | `gpt-4o-mini` | Chat 模型 |
| `LLM_TIMEOUT_MS` | 60000 | 非流式和流式 LLM 请求超时 |
| `LLM_MAX_RETRIES` | 3 | 仅非流式 `chat()` 使用的重试次数 |
| `LLM_MOCK` | false | 本地 mock 回答与 mock 流式 token |

## T11 实现要点

- `LlmClient.chat()` 保持 T10 非流式逻辑不变；新增 `chatStream()`，使用 `fetch POST {LLM_BASE_URL}/chat/completions`、`stream:true`、`ReadableStream.getReader()` 解析 OpenAI 兼容 SSE `data:` 帧。
- 流式 LLM 不做失败重试，避免 token 已发送后重放；超时和外部 abort 均通过 `AbortController` 终止。
- `LLM_MOCK=true` 时，`chatStream()` 把 mock 回答按 5 个字符一组、约 50ms 间隔输出，用于验证 token 流和客户端断开。
- `ChatService` 复用 `RetrievalService.search()` 与 T10 `buildRagPrompt()`；没有重复实现 query embedding、Qdrant search 或 Prompt 规则。
- `conversationId` 不传时创建新会话，标题为首个问题前 30 字；传入时校验会话存在且 `kbId` 匹配当前知识库。
- 同一会话用进程内 `Map<number, AbortController>` 做 in-flight 并发控制，重复请求返回 409，且此时 SSE 头尚未发送。
- 用户消息在检索前保存，`metadata` 事件携带真实 `conversationId` 和 `userMessageId`。
- 无检索结果时不调用 LLM，保存 completed 助手消息，发送固定提示、空引用和 `done`。
- 检索命中时加载最近 `CHAT_HISTORY_MAX_MESSAGES` 条 completed 历史消息，插入 system prompt 与当前带上下文的 user prompt 之间。
- LLM 流式完成后，助手完整回答和引用快照通过 `DataSource.transaction()` 同事务保存；引用来自实际进入 prompt 的检索结果。
- LLM、检索等失败时发送安全 `error` 事件，并保存 failed 助手消息；失败助手消息不保存 references。
- 客户端断开时通过 `req.on('close')` 触发 abort，停止后续模型流，并保存 failed 助手消息；断开后不再写 SSE 事件。
- `MessageService` 在保存消息时更新 `conversation.updatedAt`，会话列表按 `updatedAt DESC, id DESC` 返回。
- 删除会话使用 MySQL 外键级联删除消息和引用。

## 已验证结果

构建与静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 pnpm --filter server migration:show` | 通过，显示 2 条既有 migration 已执行 |
| `rg "\bany\b" server/src/modules/chat server/src/modules/conversation server/src/modules/llm server/src/config server/src/app.module.ts` | 无命中 |
| `rg "WebSocket|websocket|Rerank|rerank|GraphRAG|Agent|EventSource|langchain|axios|from 'openai'|require\('openai'\)" ...` | 无命中 |

集成验证环境：

- Docker 中 `rag-mysql-1`、`rag-qdrant-1` 为 healthy。
- `localhost:3306` 在本机仍有误连历史 MySQL 的风险；本次验证临时启动 `rag-mysql-3307-proxy` 连接 compose MySQL，验证后已删除。
- 正常路径使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=true`。
- LLM 失败路径使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=false`、`LLM_BASE_URL=http://127.0.0.1:3999`。

实际接口验证：

| 场景 | 实际结果 |
|---|---|
| 新会话问答 | `metadata -> token x5 -> references -> done`，`references.length=1`，引用 content 与测试 chunk 一致 |
| 已有会话继续问答 | `metadata.conversationId` 与传入会话一致，返回 token、references、done |
| 会话列表 | `GET /api/knowledge-bases/:id/conversations` 返回 `code=0`，包含 `id/title/createdAt/updatedAt` |
| 消息历史 | `GET /api/conversations/:id/messages` 返回 user + assistant，assistant 带 references，引用含 `documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot` |
| 无命中 | `metadata -> token -> references([]) -> done`，不调用 LLM |
| 空问题 | HTTP 400 |
| 知识库不存在 | HTTP 404 |
| 会话不存在 | HTTP 404 |
| 会话不属于当前知识库 | HTTP 404 |
| 同一会话并发请求 | 第二个请求返回 HTTP 409 |
| 客户端断开 | 服务端 abort 流式生成，落库 failed assistant message |
| 删除会话 | HTTP 204，删除后消息查询 HTTP 404，直接查库确认 message/reference 级联删除 |
| LLM 调用失败 | SSE `metadata -> error`，无 `done`；错误消息不含 API Key、fetch 细节、配置名或堆栈；落库 user completed + assistant failed，引用数 0 |
| 测试数据清理 | `t11-chat-%`、`t11-llm-failure-%` 知识库残留为 0；相关测试标题会话残留为 0 |

## 已知问题

1. 本次未调用真实外部 LLM；正常流式输出使用 `LLM_MOCK=true`，失败路径用不可连接的本地 base URL 验证。
2. 本次使用 `EMBEDDING_MOCK=true`；真实 Qdrant 只验证写入、过滤、检索和 SSE/RAG 链路，不评价语义召回质量。
3. 默认 `.env` 的 `DB_HOST=localhost, DB_PORT=3306` 在本机仍可能误连历史 MySQL；端到端验证实际使用 3307 临时转发到 compose MySQL。
4. `pnpm --filter ...` 在该工作区会先输出 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令实际执行并成功。

## 下一阶段条件

T11 已具备进入前端开发阶段的条件：后端已提供 SSE 流式问答、会话列表、消息历史、删除会话、消息和引用落库能力，并完成本次实际验证。
