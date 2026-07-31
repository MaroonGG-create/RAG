# T10 RAG 问答与 LLM 生成完成报告

> 日期：2026-07-31（Asia/Shanghai）
> 范围：RAG 非流式问答、Prompt 组装、OpenAI 兼容 Chat Completions 客户端、answer + references 返回

## 1. 新增和修改文件

新增：

- `server/src/modules/llm/llm.types.ts`
- `server/src/modules/llm/llm-client.ts`
- `server/src/modules/llm/llm.module.ts`
- `server/src/modules/rag/rag.types.ts`
- `server/src/modules/rag/prompt-builder.ts`
- `server/src/modules/rag/dto/rag-request.dto.ts`
- `server/src/modules/rag/dto/rag-response.dto.ts`
- `server/src/modules/rag/rag.service.ts`
- `server/src/modules/rag/rag.controller.ts`
- `server/src/modules/rag/rag.module.ts`
- `docs/reports/task-10-completion.md`

修改：

- `server/src/app.module.ts`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`
- `.env.example`
- 本地 git-ignored `.env`，仅补充 T10 本地 mock 配置
- `docs/01-current-implementation.md`

未新增数据库表，未新增 migration，未新增运行时依赖。

## 2. LLM 客户端与配置

- `LlmClient` 使用 Node `fetch`，调用 OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`。
- 请求体为 `model`、`messages`、`temperature`、`max_tokens`、`stream:false`。
- 未使用 OpenAI SDK，未使用 axios。
- `LLM_MOCK=true` 时不发起网络请求，返回确定性 mock 文本。

新增环境变量：

| 变量 | 当前默认/样例 |
|---|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `LLM_API_KEY` | `sk-your-api-key` / 本地 `sk-mock-key` |
| `LLM_MODEL` | `gpt-4o-mini` |
| `LLM_TEMPERATURE` | `0.3` |
| `LLM_MAX_TOKENS` | `2048` |
| `LLM_TIMEOUT_MS` | `60000` |
| `LLM_MAX_RETRIES` | `3` |
| `LLM_MOCK` | `.env.example=false`，本地 `.env=true` |
| `CONTEXT_MAX_CHARS` | `4000` |

## 3. RetrievalService 复用方式

- `RagService` 直接注入并调用 `RetrievalService.search(knowledgeBaseId, question, topK?, scoreThreshold?)`。
- T10 没有重复实现 query embedding、Qdrant 检索、knowledgeBaseId 过滤、payload 校验或 completed 文档过滤。
- `RetrievalService` 抛出的 `NotFoundException`、`BadRequestException` 等继续由原异常链路处理。

## 4. Prompt 和上下文组装策略

- System Prompt 明确限制模型只能基于参考资料回答，资料不足时回答无法回答，禁止编造。
- User Prompt 格式为：

```text
参考资料：

{context}

用户问题：{question}
```

- 每个 chunk 上下文格式为 `[来源{i}] {content}`。
- 上下文按 T09 检索结果顺序拼接，即 score 降序。
- `references` 只取实际进入上下文的 chunk，不返回向量。

## 5. 上下文截断规则

- 使用 `CONTEXT_MAX_CHARS` 控制上下文字符上限，当前默认 4000。
- 追加下一个 chunk 会超限时停止追加。
- 如果第一个 chunk 自身超限，则截断第一个 chunk 到上限并保留该引用。
- references 与实际进入上下文的 chunk 数量保持一致。

## 6. answer 与 references 返回结构

接口：

```text
POST /api/knowledge-bases/:id/ask
```

请求：

```json
{
  "question": "什么是 RAG？",
  "topK": 5,
  "scoreThreshold": 0.5
}
```

响应 `data`：

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

无检索命中时：

- `answer="知识库中未找到与您问题相关的内容。"`
- `references=[]`
- `llmTook=0`
- 不调用 LLM

## 7. 异常和重试处理

- `AbortController` 控制 LLM 请求超时。
- 429、500、502、503、504、网络错误和超时会重试。
- 重试使用指数退避，基础 1000ms，最大 30000ms，并增加 0-500ms 抖动。
- 429 的 `Retry-After` 会优先使用。
- 响应必须包含非空 `choices[0].message.content`。
- `EmbeddingFailure` 在控制器映射为 502：`问答服务暂时不可用：向量生成失败`。
- `LlmFailure` 在控制器映射为 502：`问答服务暂时不可用：模型调用失败`。
- 客户端响应不暴露 API Key、System Prompt、向量、原始模型响应体或内部异常堆栈。

## 8. 实际执行命令及测试结果

构建、迁移和静态检查：

| 命令 | 实际结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_HOST=127.0.0.1 DB_PORT=3307 DB_PASSWORD=root123 pnpm --filter server migration:show` | 通过，显示 `[X] 2 InitSchema1784800736682` 和 `[X] 3 AddKnowledgeBaseNameUnique1784871996843` |
| `rg "\bany\b" server/src/modules/llm server/src/modules/rag server/src/config` | 无命中 |
| `rg "@Sse|text/event-stream|EventSource|Conversation|MessageReference|message_reference|Rerank|rerank|SSE" server/src/modules/llm server/src/modules/rag server/src/app.module.ts` | 无命中 |

无数据库依赖测试：

| 场景 | 实际结果 |
|---|---|
| LLM mock 调用 | 返回 `根据知识库中的 2 条参考资料，可以回答用户问题。` |
| Prompt 正常组装 | 2 条检索结果生成 2 条 message，`usedResultCount=2` |
| 上下文截断 | 1000 字符首 chunk 在 `maxChars=500` 时截为 500 字符，`usedResultCount=1` |
| LLM 调用失败 | 本地 fake server 返回 500，`LlmClient.chat()` 抛出 `LlmFailure`，错误消息包含 `500` |
| 空问题 DTO | `question: "   "` trim 后为空，校验错误数为 1 |
| `topK=21` DTO | 校验错误数为 1 |
| 正常 DTO | `question: " q "` trim 后为 `q`，校验错误数为 0 |

端到端 HTTP 测试：

| 场景 | 实际结果 |
|---|---|
| 正常问答 | HTTP 200，`code=0`，`answer="根据知识库中的 1 条参考资料，可以回答用户问题。"` |
| references | `references.length=1`；首条包含 `chunkId=48/documentId=113/documentName/pageNo=null/content/score=1`，不含 vector |
| 耗时字段 | `retrievalTook/llmTook/took` 均为 number |
| 无检索结果 | HTTP 200，`answer="知识库中未找到与您问题相关的内容。"`，`references.length=0`，`llmTook=0` |
| 知识库不存在 | HTTP 404，message 为 `知识库不存在` |
| 空问题 | HTTP 400，message 为 `参数校验失败` |
| LLM 失败 HTTP 映射 | fake Chat Completions server 返回 500，接口返回 HTTP 502，message 为 `问答服务暂时不可用：模型调用失败`，fake server 收到 1 次请求 |
| Qdrant 写入与清理 | 测试文档写入后 point count 为 1，清理后 point count 为 0 |
| 测试数据清理 | `T10 Smoke %` 知识库、`t10-smoke-%` 文档、测试 chunk 均为 0 |

测试环境：

- `docker compose ps` 显示 `rag-mysql-1`、`rag-qdrant-1` 均 healthy。
- Qdrant readyz 返回 `all shards are ready`。
- 宿主 `localhost:3306` 存在历史 MySQL 干扰风险；本次使用临时 `rag-mysql-3307-proxy` 将 compose MySQL 暴露为 `127.0.0.1:3307`，验收后已删除该临时容器。
- HTTP 验证使用真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=true`；LLM 失败场景使用本地 fake Chat Completions server。

## 9. 未执行项和已知问题

- 未调用真实外部 LLM；本次只验证 mock 成功路径和 fake server 失败路径。
- 本次向量由 `EMBEDDING_MOCK=true` 生成，真实 Qdrant 参与写入和检索，但不能评价真实语义召回质量。
- 默认 `.env` 的 `DB_HOST=localhost,DB_PORT=3306` 在本机仍可能连到宿主历史 MySQL；验收实际使用 3307 临时转发，转发容器已在验收后删除。
- PowerShell stdin 中直接写中文会影响脚本内中文字面量比较；最终验收采用 HTTP 响应 JSON 原始输出和 ASCII 状态码检查。

## 10. T11 越界检查

本次没有实现：

- SSE 流式输出
- Conversation / Message / MessageReference 落库
- 历史会话上下文
- 引用持久化
- Rerank
- Agent / GraphRAG
- 前端页面
- 新数据库表或 migration

仓库已有的 `conversation`、`message`、`message_reference` 实体属于前序结构，不是 T10 新增或改造内容。

## 11. 是否具备进入 T11 的条件

具备。T10 已提供非流式 RAG Service/HTTP 接口、LLM 客户端、Prompt 组装、上下文截断、references 返回和基础异常映射，并完成 HTTP 级验收。
