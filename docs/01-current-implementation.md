# Mini RAG 当前实现快照

> 快照日期：2026-07-31（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 当前阶段：T10 RAG 问答与 LLM 生成完成
> 详细报告：`docs/reports/task-10-completion.md`

## 1. 当前结论

- T01-T09 的既有能力保持不变：知识库 CRUD、文档上传、解析、清洗切片、Embedding、Qdrant 写入、向量检索均仍由原模块负责。
- T10 新增 `LlmModule` 和 `RagModule`，实现非流式 RAG 问答接口 `POST /api/knowledge-bases/:id/ask`。
- T10 复用 `RetrievalService.search()`，没有重复实现 query embedding、Qdrant search 或 knowledgeBaseId 过滤。
- T10 已完成正常问答、无检索命中、知识库不存在、空问题和 LLM 调用失败的 HTTP 级验证。
- 当前没有新增数据库表或 migration，没有实现 SSE、Conversation/Message 落库、MessageReference 落库、历史会话上下文、Rerank、Agent、GraphRAG 或前端页面。

## 2. 当前模块

后端业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`
- `EmbeddingModule`
- `VectorStoreModule`
- `RetrievalModule`
- `LlmModule`
- `RagModule`

T10 新增结构：

```text
server/src/modules/llm/
├─ llm-client.ts
├─ llm.module.ts
└─ llm.types.ts

server/src/modules/rag/
├─ dto/
│  ├─ rag-request.dto.ts
│  └─ rag-response.dto.ts
├─ prompt-builder.ts
├─ rag.controller.ts
├─ rag.module.ts
├─ rag.service.ts
└─ rag.types.ts
```

`RagModule` 通过 `AppModule` 接入，依赖 `RetrievalModule` 与 `LlmModule`。

## 3. 当前接口和 CLI

内部 CLI 保持：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
pnpm --filter server store:document <documentId>
```

T09 检索接口保持：

```text
POST /api/knowledge-bases/:id/retrieve
```

T10 新增问答接口：

```text
POST /api/knowledge-bases/:id/ask
```

请求 body：

```json
{
  "question": "什么是 RAG？",
  "topK": 5,
  "scoreThreshold": 0.5
}
```

成功响应的 `data`：

```json
{
  "answer": "模型回答",
  "references": [
    {
      "chunkId": 123,
      "documentId": 45,
      "documentName": "rag-intro.txt",
      "pageNo": null,
      "content": "RAG is retrieval augmented generation",
      "score": 1
    }
  ],
  "retrievalTook": 42,
  "llmTook": 1200,
  "took": 1242
}
```

无检索命中时返回固定回答 `知识库中未找到与您问题相关的内容。`，`references=[]`，`llmTook=0`，不调用 LLM。

## 4. 当前配置

T10 新增 LLM/RAG 配置：

| 环境变量 | 默认值/样例 | 校验 |
|---|---:|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` | http/https URL |
| `LLM_API_KEY` | `sk-your-api-key` | 非空字符串 |
| `LLM_MODEL` | `gpt-4o-mini` | 非空字符串 |
| `LLM_TEMPERATURE` | 0.3 | 数字，0-2 |
| `LLM_MAX_TOKENS` | 2048 | 整数，1-8192 |
| `LLM_TIMEOUT_MS` | 60000 | 整数，5000-300000 |
| `LLM_MAX_RETRIES` | 3 | 整数，0-10 |
| `LLM_MOCK` | false | 可选布尔值 |
| `CONTEXT_MAX_CHARS` | 4000 | 整数，500-20000 |

既有配置保持：`CHUNK_SIZE=500`、`CHUNK_OVERLAP=100`、`TOP_K=5`、`SCORE_THRESHOLD=0.5`、`EMBEDDING_DIMENSION=1024`、`QDRANT_COLLECTION=rag_chunks`。

## 5. RAG 实现

- `RagService.ask()` 接收 `knowledgeBaseId`、`question`、`topK?`、`scoreThreshold?`。
- 先调用 `RetrievalService.search()`；query embedding、Qdrant 检索、knowledgeBaseId 过滤、completed 文档过滤均由 T09 继续负责。
- 检索为空时直接返回固定提示，不进入 LLM。
- 检索非空时由 `buildRagPrompt()` 组装 System Prompt 与 User Prompt。
- System Prompt 明确要求只基于参考资料回答、不能编造、资料不足时明确说明无法回答、不要暴露来源编号或内部元数据。
- 上下文格式为 `[来源{i}] {content}`，按检索排序依次拼接。
- `CONTEXT_MAX_CHARS` 限制上下文总字符数；后续 chunk 超限即停止，首个 chunk 单独超限时截断首个 chunk 并保留该引用。
- `references` 只来自实际用于上下文的检索结果，不返回向量。

## 6. LLM 实现

- `LlmClient` 使用 Node `fetch` 调用 OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`。
- 请求体包含 `model`、`messages`、`temperature`、`max_tokens`、`stream:false`。
- 不引入 OpenAI SDK、axios 或新运行时依赖。
- `LLM_MOCK=true` 时返回确定性 mock 文本，不发起网络请求。
- 超时使用 `AbortController`。
- 429、500、502、503、504、网络错误和超时按指数退避重试；`Retry-After` 会优先使用。
- 响应校验 `choices` 非空且 `choices[0].message.content` 为非空字符串。
- 控制器将 `EmbeddingFailure` 映射为 502 `问答服务暂时不可用：向量生成失败`，将 `LlmFailure` 映射为 502 `问答服务暂时不可用：模型调用失败`。
- 日志只记录耗时、数量和失败原因，不记录 API Key、Prompt、向量或原始响应体。

## 7. 已验证结果

构建、迁移和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，显示 2 条既有 migration 已执行 |
| `rg "\bany\b" server/src/modules/llm server/src/modules/rag server/src/config` | 无命中 |
| `rg "@Sse|text/event-stream|EventSource|Conversation|MessageReference|message_reference|Rerank|rerank|SSE" server/src/modules/llm server/src/modules/rag server/src/app.module.ts` | 无命中 |

无数据库依赖的实际验证：

| 场景 | 实际结果 |
|---|---|
| LLM mock 调用 | 返回 `根据知识库中的 2 条参考资料，可以回答用户问题。` |
| Prompt 正常组装 | 2 条检索结果生成 2 条 message，`usedResultCount=2` |
| 上下文截断 | 1000 字符首 chunk 在 `maxChars=500` 时截为 500 字符，`usedResultCount=1` |
| LLM HTTP 500 | 本地 fake server 返回 500，`LlmClient.chat()` 抛出 `LlmFailure`，错误消息包含 `500` |
| DTO 空问题 | `question: "   "` trim 后为空，校验错误数为 1 |
| DTO `topK=21` | 校验错误数为 1 |
| DTO 正常请求 | `question: " q "` trim 后为 `q`，校验错误数为 0 |

端到端 HTTP 实测：

| 场景 | 实际结果 |
|---|---|
| 正常问答 | HTTP 200，`code=0`，`answer="根据知识库中的 1 条参考资料，可以回答用户问题。"`，`references.length=1` |
| references 字段 | 包含 `chunkId/documentId/documentName/pageNo/content/score`，不含 vector |
| 耗时字段 | `retrievalTook/llmTook/took` 均为 number |
| 无检索结果 | HTTP 200，固定回答 `知识库中未找到与您问题相关的内容。`，`references.length=0`，`llmTook=0` |
| 知识库不存在 | HTTP 404，message 为 `知识库不存在` |
| 空问题 | HTTP 400，message 为 `参数校验失败` |
| LLM 调用失败 | fake Chat Completions server 返回 500，接口返回 HTTP 502，message 为 `问答服务暂时不可用：模型调用失败` |
| Qdrant 写入与清理 | 测试文档写入后 point count 为 1，清理后 point count 为 0 |
| 测试数据清理 | `T10 Smoke %` 知识库、`t10-smoke-%` 文档、测试 chunk 均为 0 |

测试环境：

- Docker compose 中 `rag-mysql-1` 和 `rag-qdrant-1` 均为 healthy。
- 宿主 `localhost:3306` 有历史 MySQL 干扰风险；本次实际通过临时 `rag-mysql-3307-proxy` 连接 compose MySQL，验收后已删除该临时容器。
- T10 HTTP 验证使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=true`；LLM 失败场景使用本地 fake Chat Completions server。

## 8. 当前未实现范围

以下仍属于后续任务：

- SSE 流式输出
- Conversation / Message / MessageReference 落库
- 历史会话上下文
- 引用持久化
- Rerank
- Agent / GraphRAG
- 前端页面
- 后台队列、自动流水线、启动恢复
- 真实外部 LLM/Embedding 质量评估

## 9. 已知问题

1. 本次未调用真实外部 LLM；正常回答使用 `LLM_MOCK=true`，失败路径通过本地 fake HTTP server 验证。
2. 本次向量内容由 `EMBEDDING_MOCK=true` 生成，真实 Qdrant 仅验证存储、过滤和检索链路，不评价语义召回质量。
3. 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍可能连接到宿主历史 MySQL；端到端验收实际使用 3307 临时转发到 compose MySQL。
4. `pnpm --filter ...` 在该工作区仍会输出 `No projects matched the filters "D:\Users\Documents\RAG"` 提示，但目标 package 命令实际执行并成功。

## 10. 进入 T11 条件

具备进入 T11 的条件。T10 已提供非流式 RAG Service/HTTP 接口、LLM 客户端、Prompt 组装、上下文截断、references 返回和基础异常映射，并完成 HTTP 级验收。
