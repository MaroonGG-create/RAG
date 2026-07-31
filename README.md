# Mini RAG

Mini RAG 是一个本地演示用知识库问答系统，包含 Vue 3 前端、NestJS 后端、MySQL 元数据存储和 Qdrant 向量存储。

当前能力覆盖：
- 知识库创建、列表、详情和删除
- PDF、Markdown、TXT 单文件上传、状态展示和删除
- 文档解析、清洗、切片、Embedding、Qdrant 写入
- 按知识库过滤的向量检索
- 非流式 RAG 问答和 SSE 流式 RAG 问答
- 会话、消息和引用持久化

本项目不包含登录、权限、多租户、Rerank、Agent、GraphRAG 或 WebSocket。默认用于本地或内网演示。

## 环境要求

- Node.js 20
- pnpm 9
- Docker 和 Docker Compose

## 快速启动

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm --filter server migration:run
```

启动后端：

```bash
pnpm --filter server dev
```

启动前端：

```bash
pnpm --filter web dev
```

默认地址：
- 前端：http://localhost:5173
- 后端：http://localhost:3000
- Swagger：http://localhost:3000/api/docs
- Qdrant：http://localhost:6333

如果本机 MySQL 已占用 3306，可以调整 `.env` 的 `DB_PORT` 或停止本机 MySQL 服务后再启动 Docker。

## 关键环境变量

服务与数据库：

```dotenv
SERVER_PORT=3000
CORS_ORIGIN=http://localhost:5173
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root123
DB_ROOT_PASSWORD=root123
DB_NAME=mini_rag
```

上传与切片：

```dotenv
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=20
CHUNK_SIZE=500
CHUNK_OVERLAP=100
```

`UPLOAD_DIR` 的相对路径会解析到 `server` 项目目录。上传文件保存在 `server/uploads/{knowledgeBaseId}/`，解析缓存保存在 `server/uploads/.parsed/`。

Embedding：

```dotenv
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=sk-your-api-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1024
EMBEDDING_BATCH_SIZE=20
EMBEDDING_TIMEOUT_MS=30000
EMBEDDING_MAX_RETRIES=3
EMBEDDING_MOCK=false
```

LLM：

```dotenv
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-api-key
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=2048
LLM_TIMEOUT_MS=60000
LLM_MAX_RETRIES=3
LLM_MOCK=false
```

Qdrant 与检索：

```dotenv
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=rag_chunks
QDRANT_UPSERT_BATCH_SIZE=100
QDRANT_MOCK=false
TOP_K=5
SCORE_THRESHOLD=0.5
CONTEXT_MAX_CHARS=4000
CHAT_HISTORY_MAX_MESSAGES=6
```

本地无模型服务时，可将 `EMBEDDING_MOCK=true`、`LLM_MOCK=true` 用于功能联调。Mock 模式只用于开发验证，不代表真实模型质量。

## 文档处理流水线

上传接口只负责接收文件并创建 `pending` 文档记录。后续处理可用 CLI 逐步执行：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
pnpm --filter server embed:document <documentId>
pnpm --filter server store:document <documentId>
```

`store:document` 会复用 Embedding 服务生成向量并写入 Qdrant，成功后将文档状态置为 `completed`。重复执行会按既有幂等规则处理，写入失败会按 `documentId` 清理已写入的当前文档向量。

文档状态含义：

| 状态 | 含义 |
|---|---|
| `pending` | 已上传，待解析或已解析待切片 |
| `parsing` | 正在解析 |
| `chunking` | 已切片，待向量化或向量写入 |
| `embedding` | 已向量化，待写入 Qdrant 或正在写入 |
| `completed` | 已写入 Qdrant，可检索问答 |
| `failed` | 处理失败，`errorMessage` 记录失败原因 |

服务重启导致处理中状态卡住时，可用恢复脚本把指定文档或知识库下卡住的文档重置为 `pending`：

```bash
pnpm --filter server reset:document <documentId>
pnpm --filter server reset:documents <knowledgeBaseId>
```

脚本只重置 `parsing`、`chunking`、`embedding` 状态，并输出 JSON 摘要。

## 常用接口

健康检查：

```bash
curl http://localhost:3000/api/health
```

知识库：

```bash
curl -X POST http://localhost:3000/api/knowledge-bases \
  -H "Content-Type: application/json" \
  -d '{"name":"产品文档库","description":"产品相关资料"}'

curl http://localhost:3000/api/knowledge-bases
curl http://localhost:3000/api/knowledge-bases/1
curl -X DELETE http://localhost:3000/api/knowledge-bases/1
```

文档：

```bash
curl -X POST http://localhost:3000/api/knowledge-bases/1/documents \
  -F "file=@./example.pdf"

curl http://localhost:3000/api/knowledge-bases/1/documents
curl http://localhost:3000/api/documents/1
curl -X DELETE http://localhost:3000/api/documents/1
```

检索与问答：

```bash
curl -X POST http://localhost:3000/api/knowledge-bases/1/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"问题内容","topK":5,"scoreThreshold":0.5}'

curl -X POST http://localhost:3000/api/knowledge-bases/1/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"问题内容"}'
```

SSE 流式问答：

```bash
curl -N -X POST http://localhost:3000/api/knowledge-bases/1/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"问题内容","conversationId":1}'
```

SSE 事件协议：
- `metadata`：`{conversationId,userMessageId}`
- `token`：`{delta}`
- `references`：`[{chunkId,documentId,documentName,pageNo,content,score}]`
- `done`：`{assistantMessageId}`
- `error`：`{message}`

## 数据和向量清理

- 删除文档会先按 `documentId` 清理 Qdrant 向量，再删除 MySQL 文档和切片，最后清理磁盘文件和解析缓存。
- 删除知识库会先按 `knowledgeBaseId` 清理 Qdrant 向量，再清理该知识库下文档文件、解析缓存和上传目录，最后删除 MySQL 知识库记录并级联删除关联数据。
- 文件清理失败只记录告警，不阻断已完成的向量和数据库删除。

Qdrant collection：
- 名称：`rag_chunks`
- 向量维度：`EMBEDDING_DIMENSION`
- 距离算法：Cosine
- point id：`document_chunk.qdrant_point_id`
- payload 索引：`knowledgeBaseId`、`documentId`

如果修改 `EMBEDDING_DIMENSION` 后已有 collection 维度不一致，后端会启动失败。开发环境可删除旧 collection 后重建：

```bash
curl -X DELETE http://localhost:6333/collections/rag_chunks
```

## 构建与检查

```bash
pnpm --filter server build
pnpm --filter web type-check
pnpm --filter web build
pnpm --filter server migration:show
```

调试日志和越界实现检查可用：

```bash
rg "console\.(log|debug)" web/src
rg "console\.(log|error|warn)" server/src --type ts -g "!**/scripts/**"
rg "debugger" web/src server/src
rg "Mock|mock|fake|dummy|EventSource|WebSocket|localStorage|sessionStorage" web/src
rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router
```

## 常见问题

### 后端启动时报 Qdrant Collection 维度不匹配

原因通常是 `EMBEDDING_DIMENSION` 与已存在 collection 的维度不同。开发环境删除 `rag_chunks` 后重新执行文档入库；生产环境应先完成数据迁移或重建方案。

### 文档一直停在处理中

如果服务在 `parsing`、`chunking` 或 `embedding` 状态中断，可执行：

```bash
pnpm --filter server reset:document <documentId>
```

然后重新跑文档处理流水线。

### 前端上传失败

前端和后端均限制文件类型和大小。当前只支持 PDF、Markdown、TXT，默认大小上限为 `MAX_FILE_SIZE_MB=20`。
