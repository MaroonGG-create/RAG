# Mini RAG 知识库系统 — 第一版总体方案

> 版本：v1.8（MVP 设计基线，T09 修订）
> 定位：个人开发、简历展示、面试讲解
> 原则：先设计后编码、接口先行、数据结构先行、不扩大 MVP 范围

---

## 1. MVP 功能边界

### 1.1 做（In Scope）

| 模块 | 功能点 |
|---|---|
| 知识库管理 | 创建 / 列表 / 详情 / 删除 |
| 文档管理 | 上传 PDF、Markdown、TXT；列表；处理状态查询；删除；同库内相同文件去重（SHA-256） |
| 文档处理 | 文本提取 → 清洗 → 切片 → Embedding → 写入 Qdrant → 状态更新；失败记录错误信息 |
| RAG 问答 | 选定知识库提问 → TopK 检索 → 上下文组装 → 调用聊天模型 → **SSE 流式返回** → 返回引用（文档、片段、页码、相似度）；无答案时禁止编造 |
| 会话记录 | 保存会话、用户问题、模型回答、本次回答的引用来源 |

### 1.2 不做（Out of Scope）

明确排除：Agent、多智能体、GraphRAG、OCR、网页爬虫、Excel 解析、多租户、完整 RBAC、微服务、复杂工作流、知识图谱、复杂 Rerank、**登录鉴权（MVP 单机演示不做，见 §15 风险 9）**。

Rerank 仅作为基础版本验收后的可选优化项，不在本方案任务内。

---

## 2. 系统整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 (Vue3 SPA)                     │
│   知识库管理页   文档管理页   对话页(SSE 流式渲染 + 引用展示)    │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP / REST (Axios) + SSE (fetch stream)
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   NestJS 后端 (单进程, 端口 3000)              │
│                                                              │
│  knowledge-base ── document ── processing(解析/清洗/切片)      │
│        │              │              │                       │
│        │              │              ├── embedding(向量化)     │
│        │              │              └── vector-store(写入)    │
│        │              │                                      │
│  conversation ── chat(检索 → Prompt → LLM → SSE)              │
└──────┬──────────────────────┬───────────────────┬───────────┘
       │ TypeORM              │ HTTP               │ HTTP
       ▼                      ▼                    ▼
┌────────────┐        ┌────────────┐        ┌──────────────────┐
│  MySQL 8   │        │  Qdrant    │        │ OpenAI 兼容模型服务 │
│ 结构化数据  │        │ 向量数据    │        │ Chat API          │
│ + 切片文本  │        │ + payload  │        │ Embedding API     │
└────────────┘        └────────────┘        └──────────────────┘
```

**核心设计决策与理由：**

1. **单后端进程，异步任务在进程内串行执行**：文档处理用"上传后立即触发、进程内异步流水线"实现，不引入消息队列。理由：一个人可维护、无额外基础设施；风险（重启中断任务）在 §15 说明并用状态机兜底。
2. **MySQL 存结构化数据 + 切片原文，Qdrant 只存向量 + 定位用 payload**：切片文本在 MySQL `document_chunk` 有一份，Qdrant payload 冗余一份用于直接组装上下文。理由：调试时可单独查 MySQL 验证切片质量；面试可讲"双写一致性"取舍。
3. **模型服务走 OpenAI 兼容协议**：Chat 与 Embedding 的 baseURL/apiKey/model 全部环境变量化，可指向 OpenAI、DeepSeek、通义、本地 Ollama/vLLM。理由：简历演示时不绑定特定厂商。
4. **不用 LangChain 串联主流程**：仅允许在文本切片环节使用其 Splitter（可选），检索、Prompt、SSE 全部手写。理由：面试必须能逐行讲清 RAG 流程。

---

## 3. 前后端技术架构

### 3.1 前端（web/）

| 技术 | 版本要求 | 用途 | 选型理由 |
|---|---|---|---|
| Vue | ^3.5 | 框架 | 开发者主栈 |
| TypeScript | ~5.6 | 类型 | 全链路类型安全，面试加分 |
| Vite | ^5.4 | 构建 | 开发体验 |
| Vue Router | ^4.5 | 路由 | 标准 |
| Pinia | ^2.3 | 状态 | 知识库/文档/会话三类 Store |
| Ant Design Vue | ^4.2 | UI | 表格、上传、Drawer 开箱即用 |
| Axios | ^1.8 | HTTP | 统一拦截器处理错误码 |
| SSE | 原生 fetch + ReadableStream | 流式输出 | **不用 EventSource**：它只支持 GET，问答接口需要 POST 携带参数 |

### 3.2 后端（server/）

| 技术 | 版本要求 | 用途 | 选型理由 |
|---|---|---|---|
| NestJS | ^10.4 | 框架 | 模块化边界清晰，适合讲解架构 |
| TypeORM | ^0.3.20 | ORM | 实体即文档， synchronize 仅限开发 |
| MySQL | 8.0 | 关系库 | 开发者熟悉 |
| class-validator | ^0.14 | DTO 校验 | NestJS 标准组合 |
| @nestjs/swagger | ^8 | API 文档 | 接口契约可视化，方便联调验收 |
| @qdrant/js-client-rest | 1.12.0（锁定） | Qdrant 客户端 | 官方客户端；与 Qdrant Server v1.12.4 对齐，CJS 入口兼容 Node 20 + NestJS 10 |
| pdfjs-dist | 2.16.105（锁死） | PDF 逐页解析 | T05 已选定；UMD/CJS 可在 Node 20 + NestJS 10 下直接加载，`getPage().getTextContent()` 原生保留页码；详见 v1.4 修订 |
| markdown-it / 直接读文本 | — | MD/TXT 解析 | MD 按纯文本处理即可（MVP 不渲染） |
| multer（Nest 内置） | — | 文件上传 | 磁盘存储，避免大文件进内存 |

### 3.3 运行时与工具链

- Node.js **20 LTS**，包管理 **pnpm 9**，锁文件必须提交。
- 开发模式：MySQL、Qdrant 跑在 Docker；前后端本地 `pnpm dev` 启动。
- 交付模式：Docker Compose 一键拉起全部四个服务。

---

## 4. RAG 完整数据流

### 4.1 文档入库流水线（Ingestion）

```
上传文件(multipart)
 ① multer 落盘 uploads/{kbId}/{uuid}.{ext}，限制类型与大小(默认20MB)
 ② 计算 SHA-256 → 查 (kb_id, file_hash) 唯一索引
      命中 → 返回 409 + 已存在文档信息，不入库
 ③ 插入 document(status=pending)，异步触发流水线，立即返回 202
 ④ parse：pdf → 按页提取[{pageNo,text}]；md/txt → 整段文本
      status: pending → parsing；T05 成功后回到 pending，表示“已解析，待切片”，解析结果暂存于 uploads/.parsed/{documentId}.json
 ⑤ clean：去多余空白/页眉页脚式重复行/不可见字符（规则见 05 文档）
 ⑥ split：按字符递归切分，chunkSize=500字符, overlap=100字符
      产出 [{chunkIndex, content, pageNo?}]，status → chunking；T06 成功后 status 留在 chunking，表示“已切片，待向量化”
 ⑦ 写入 document_chunk 行（MySQL，含 qdrant_point_id=uuid v4）
 ⑧ embed：分批(默认20条/批)调用 Embedding API，失败指数退避重试3次
      status → embedding；T07 成功后 status 留在 embedding，表示“已向量化，待写入 Qdrant”
 ⑨ upsert Qdrant：point id=chunk.qdrant_point_id，vector + payload
 ⑩ document.status=completed, chunk_count=N；T08 成功后进入文档处理终态
     任一步失败：status=failed, error_message=具体错误，已写入的向量按 documentId 清除
```

### 4.2 问答流水线（Query）

```
POST /api/chat/stream {knowledgeBaseId, question, conversationId?}
 ① 校验知识库存在；保存 user message（若带 conversationId 则归属该会话）
 ② question → EmbeddingService.embedQuery() → queryVector
 ③ Qdrant search：filter knowledgeBaseId，TopK/SCORE_THRESHOLD 使用环境默认值或请求覆盖；仅保留 completed 文档结果
      命中 0 条 → 直接流式返回固定话术"知识库中未找到相关内容"，
      references=[]，**不调用 LLM（防编造的第一道闸）**
 ④ 组装上下文：按 score 降序拼接，标注 [来源i]，总长截断到 4000 字符
 ⑤ Prompt = 系统提示(只能依据给定资料回答,不知道就明说) + 上下文 + 问题
 ⑥ 调用 Chat API(stream=true)，逐 token 通过 SSE 推送：
      event: token   data: {delta}
      event: references  data: [{documentId,documentName,chunkIndex,pageNo,score}]
      event: done    data: {messageId}
 ⑦ 流结束后保存 assistant message + message_reference 行
     异常：SSE 推送 event: error，已生成内容照常落库并标记
```

---

## 5. MySQL 实体设计

> 字符集统一 `utf8mb4`。主键统一 `INT UNSIGNED AUTO_INCREMENT`（**v1.1 修订**，原为 BIGINT UNSIGNED：INT UNSIGNED 上限约 42.9 亿，远在 JS `Number.MAX_SAFE_INTEGER` 内，前后端 ID 统一用 `number` 类型；Qdrant point 用独立的 uuid 字段，见 §6）。所有表含 `created_at/updated_at`（TIMESTAMP，默认 CURRENT_TIMESTAMP）。**物理删除，不做软删除**，级联规则如下。

### 5.1 knowledge_base（知识库）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| name | VARCHAR(100) NOT NULL | 知识库名；重名控制 = 应用层预检 + DB 唯一约束兜底（v1.2 修订） |
| description | VARCHAR(500) NULL | |
| document_count | INT UNSIGNED DEFAULT 0 | 冗余统计，文档增删时维护 |

唯一约束：`uk_name(name)`（**v1.2 修订**：原为普通索引 `idx_name`，升级为唯一索引防并发重名；表 collation 为 `utf8mb4_unicode_ci`，重名判定**大小写不敏感**，应用层预检与唯一索引行为一致）

### 5.2 document（文档）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| kb_id | INT UNSIGNED NOT NULL FK → knowledge_base.id ON DELETE CASCADE | |
| file_name | VARCHAR(255) NOT NULL | 原始文件名 |
| file_ext | VARCHAR(10) NOT NULL | pdf / md / txt |
| file_size | BIGINT NOT NULL | 字节 |
| file_hash | CHAR(64) NOT NULL | SHA-256 |
| storage_path | VARCHAR(500) NOT NULL | 相对 uploads/ 的路径 |
| status | ENUM('pending','parsing','chunking','embedding','completed','failed') NOT NULL DEFAULT 'pending' | 状态机 |
| error_message | TEXT NULL | 失败原因 |
| chunk_count | INT DEFAULT 0 | |

索引：**`uk_kb_hash(kb_id, file_hash) UNIQUE`（去重的核心）**，`idx_kb_status(kb_id, status)`

### 5.3 document_chunk（切片）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| document_id | INT UNSIGNED NOT NULL FK → document.id ON DELETE CASCADE | |
| kb_id | INT UNSIGNED NOT NULL | 冗余列（**不设 FK**，理由见 v1.1 修订记录），便于直接按库查询 |
| chunk_index | INT NOT NULL | 文档内序号 |
| content | TEXT NOT NULL | 切片原文 |
| char_count | INT NOT NULL | 字符数（MVP 用字符数代替 token 数） |
| page_no | INT NULL | PDF 页码；MD/TXT 为 NULL |
| qdrant_point_id | CHAR(36) NOT NULL UNIQUE | uuid v4，即 Qdrant point id |

索引：`uk_doc_index(document_id, chunk_index) UNIQUE`，`idx_kb(kb_id)`

### 5.4 conversation（会话）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| kb_id | INT UNSIGNED NOT NULL FK → knowledge_base.id ON DELETE CASCADE | |
| title | VARCHAR(200) NOT NULL | 默认取首条问题前 30 字 |

索引：`idx_kb(kb_id)`（**v1.1 新增**，会话列表按库查询）

### 5.5 message（消息）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| conversation_id | INT UNSIGNED NOT NULL FK → conversation.id ON DELETE CASCADE | |
| role | ENUM('user','assistant') NOT NULL | |
| content | TEXT NOT NULL | 失败时保存已生成的部分内容 |
| status | ENUM('completed','failed') NOT NULL DEFAULT 'completed' | **v1.1 新增**：assistant 消息生成结果状态 |
| error_message | TEXT NULL | **v1.1 新增**：生成失败原因（模型超时等） |

索引：`idx_conv(conversation_id, id)`

### 5.6 message_reference（回答引用）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT UNSIGNED PK | |
| message_id | INT UNSIGNED NOT NULL FK → message.id ON DELETE CASCADE | |
| document_id | INT UNSIGNED NULL | 文档被删后保留快照，故不设 FK，可空 |
| chunk_id | INT UNSIGNED NULL | 同上 |
| document_name | VARCHAR(255) NOT NULL | 快照 |
| chunk_index | INT NOT NULL | 快照 |
| page_no | INT NULL | 快照 |
| score | DECIMAL(5,4) NOT NULL | 相似度 |
| content_snapshot | TEXT NOT NULL | 切片内容快照，保证文档删除后引用仍可展示 |

索引：`idx_msg(message_id)`

### 5.7 删除策略与一致性

| 操作 | 顺序 | 失败处理 |
|---|---|---|
| 删除文档 | ① Qdrant 按 documentId 删向量 → ② MySQL 删 document（chunk 级联）→ ③ 删磁盘文件 | ①失败则中止并返回错误，可重试（幂等）；③失败仅记日志 |
| 删除知识库 | ① Qdrant 按 knowledgeBaseId 删向量 → ② MySQL 删 knowledge_base（文档/切片/会话/消息/引用级联）→ ③ 删该库 uploads 目录 | 同上 |
| 文档处理中途失败 | 按 documentId 清 Qdrant 向量 + 清 document_chunk，置 failed | 保证不留半成品 |

> message_reference 用快照而非外键：这是刻意取舍，保证"历史回答的引用永远可看"，面试可展开讲。

---

## 6. Qdrant Collection 与 payload 设计

| 项 | 设计 |
|---|---|
| Collection | 单一 collection：`rag_chunks`（多知识库共用，靠 payload 过滤，不为每个库建 collection —— 避免动态建 collection 的运维复杂度） |
| 向量维度 | 由环境变量 `EMBEDDING_DIMENSION` 决定（默认 1024）。**启动时校验**：collection 不存在则按配置创建；已存在但维度不一致 → 直接启动失败并打印"需删除重建或修改配置"，防止静默错配 |
| 距离算法 | Cosine |
| point id | = `document_chunk.qdrant_point_id`（uuid v4），与 MySQL 一一对应 |
| payload 索引 | `knowledgeBaseId`、`documentId` 建 payload index（integer），保证过滤检索性能 |

**payload 结构：**

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

**过滤方式：** 检索时 `filter.must = [{key:"knowledgeBaseId", match:{value: X}}]`；文档级追问场景可选叠加 `documentId` 条件。

**向量删除：** 用 `delete(points_selector=Filter)` 按 `documentId` / `knowledgeBaseId` 批量删，不用逐个 id（幂等、简单）。

**检索策略：** TopK 默认 5（请求可覆盖，上限 20），score 阈值默认 0.5（余弦，可配置）。低于阈值全部丢弃 → 触发"未找到"话术。阈值的调参方法写进面试文档。

---

## 7. 后端模块划分

| 模块 | 目录 | 职责 | 依赖方向 |
|---|---|---|---|
| config | `src/config/` | 环境变量加载与校验（Joi） | 被所有模块依赖，不依赖任何模块 |
| common | `src/common/` | 全局异常过滤器、统一响应格式、错误码枚举、日志工具 | 同上 |
| database | `src/database/` | TypeORM 数据源配置 | 依赖 config |
| health | `src/modules/health/` | 存活/就绪检查（含 DB 连通性） | 依赖 database |
| knowledge-base | `src/modules/knowledge-base/` | 知识库 CRUD，删除时编排向量清理 | 依赖 vector-store |
| document | `src/modules/document/` | 上传、哈希去重、列表、删除 | 依赖 processing、vector-store |
| processing | `src/modules/processing/` | 解析(cleaner/splitter/parser)、流水线编排、状态机 | 依赖 embedding、vector-store |
| embedding | `src/modules/embedding/` | OpenAI 兼容 Embedding 客户端、Mock 模式、分批、重试、读取 DocumentChunk 并返回内存向量结果 | client 仅依赖 config；service 依赖 document 实体 |
| vector-store | `src/modules/vector-store/` | Qdrant 客户端封装：建 collection、维度校验、payload 索引、upsert、按过滤删除和向量 search | client 仅依赖 config；service 依赖 embedding 和 document 实体 |
| retrieval | `src/modules/retrieval/` | T09 检索编排：query embedding、knowledgeBaseId 过滤、TopK/阈值、payload 校验、completed 文档过滤，提供内部 Service 与测试 HTTP 接口 | 依赖 embedding、vector-store、database |
| chat | `src/modules/chat/` | 检索 → Prompt → LLM 流式调用 → SSE 输出 | 依赖 retrieval、conversation、llm |
| llm | `src/modules/llm/` | OpenAI 兼容 Chat 客户端（流式） | 仅依赖 config |
| conversation | `src/modules/conversation/` | 会话、消息、引用的存取 | 依赖 database |

**依赖规则：** controller 只做参数校验与转发；跨模块只通过对方导出的 service；禁止循环依赖；embedding / vector-store / llm 三个"外部资源客户端"不依赖任何业务模块（可单独测试、可替换实现）。

---

## 8. 前端页面划分

| 路由 | 页面 | 核心组件 |
|---|---|---|
| `/` | 重定向到 `/knowledge-bases` | — |
| `/knowledge-bases` | 知识库列表页 | 卡片列表、新建弹窗、删除确认 |
| `/knowledge-bases/:id` | 知识库详情页（默认文档 Tab） | 库信息头、Tab 容器 |
| `/knowledge-bases/:id/documents` | 文档管理页 | 上传 Dragger（显示进度）、文档表格（状态 Tag 轮询刷新）、删除 |
| `/knowledge-bases/:id/chat` | 对话页 | 左侧会话列表 + 右侧消息流（流式打字渲染）、引用折叠面板（文档名/页码/相似度/原文快照）、输入框 |

**Pinia Store：** `useKnowledgeBaseStore`（列表/当前库）、`useDocumentStore`（文档列表 + 状态轮询定时器）、`useChatStore`（会话列表、消息流、SSE 连接状态）。

**API 层：** `src/api/` 按后端模块分文件（knowledgeBase.ts / document.ts / chat.ts / conversation.ts），Axios 实例统一 baseURL 与错误码处理；SSE 单独封装 `fetchSseStream()` 工具（fetch POST + ReadableStream 解析 `event:/data:` 帧）。

**状态约定：** 文档处理中每 3 秒轮询列表接口直至全部终态；聊天页区分「连接中 / 生成中 / 完成 / 失败」四态；空知识库、空文档、无引用均有 Empty 态文案。

---

## 9. API 接口清单

> 统一前缀 `/api`；统一错误结构 `{ code, message, details? }`；完整 DTO/示例在后续 `04-api-contract.md` 细化，本清单为冻结级约定，Codex 不得擅自改动路径与字段名。

| # | 方法 | 路径 | 说明 | 关键约定 |
|---|---|---|---|---|
| 1 | GET | `/api/health` | 健康检查 | 返回 `{status, db}` |
| 2 | POST | `/api/knowledge-bases` | 创建知识库 | body: `{name, description?}` |
| 3 | GET | `/api/knowledge-bases` | 知识库列表 | 返回数组（MVP 不分页，量级小） |
| 4 | GET | `/api/knowledge-bases/:id` | 知识库详情 | 含 document_count |
| 5 | DELETE | `/api/knowledge-bases/:id` | 删除知识库 | 级联见 §5.7，返回 204 |
| 6 | POST | `/api/knowledge-bases/:id/documents` | 上传文档 | multipart 字段名 `file`；重复文件返回 **409** |
| 7 | GET | `/api/knowledge-bases/:id/documents` | 文档列表 | 含 status、chunk_count、error_message |
| 8 | GET | `/api/documents/:id` | 文档详情 | 含切片预览（前 20 条 chunk） |
| 9 | DELETE | `/api/documents/:id` | 删除文档 | 返回 204 |
| 10 | POST | `/api/chat/stream` | RAG 问答（SSE） | body: `{knowledgeBaseId, question, conversationId?, topK?, scoreThreshold?}`；响应 `text/event-stream` |
| 11 | GET | `/api/knowledge-bases/:id/conversations` | 会话列表 | 按更新时间倒序 |
| 12 | GET | `/api/conversations/:id/messages` | 会话消息（含引用） | assistant 消息带 references 数组 |
| 13 | DELETE | `/api/conversations/:id` | 删除会话 | 返回 204 |
| 14 | POST | `/api/knowledge-bases/:id/retrieve` | 向量检索测试接口 | body: `{query, topK?, scoreThreshold?}`；响应 `{results,total,took}`，结果不含向量 |

错误码段位：400 参数校验失败、404 资源不存在、409 重复文件/重名、422 文档未处理完成不可问、502 模型服务异常、500 其他。

---

## 10. 项目目录结构

```
mini-rag/
├─ docker-compose.yml          # 编排 mysql / qdrant / server / web
├─ .env.example                # 全部环境变量样例
├─ .gitignore
├─ README.md
├─ docs/                       # 设计文档（本目录）
├─ server/                     # NestJS 后端
│  ├─ src/
│  │  ├─ main.ts               # 启动入口：CORS、全局管道、Swagger
│  │  ├─ app.module.ts
│  │  ├─ config/               # 环境变量与校验
│  │  ├─ common/               # 过滤器/拦截器/错误码/工具
│  │  ├─ database/             # TypeORM 配置
│  │  └─ modules/
│  │     ├─ health/
│  │     ├─ knowledge-base/    # controller/service/dto/entities 同模块内聚
│  │     ├─ document/
│  │     ├─ processing/        # parser.ts cleaner.ts splitter.ts pipeline.service.ts
│  │     ├─ embedding/
│  │     ├─ vector-store/
│  │     ├─ retrieval/
│  │     ├─ llm/
│  │     ├─ chat/
│  │     └─ conversation/
│  ├─ uploads/                 # 运行期文件（gitignore，docker 挂卷）
│  ├─ package.json
│  └─ tsconfig.json
└─ web/                        # Vue3 前端
   ├─ src/
   │  ├─ main.ts / App.vue
   │  ├─ router/
   │  ├─ stores/
   │  ├─ api/                  # 按模块分文件 + sse.ts
   │  ├─ types/                # 与 API 契约对应的 TS 类型
   │  ├─ views/                # 4 个页面
   │  └─ components/           # 上传、文档表格、消息气泡、引用面板等
   ├─ package.json
   └─ vite.config.ts           # dev 代理 /api → localhost:3000
```

---

## 11. Docker Compose 服务设计

| 服务 | 镜像 | 端口 | 卷 | 说明 |
|---|---|---|---|---|
| mysql | `mysql:8.0` | 3306 | `mysql_data` | 健康检查 `mysqladmin ping`；初始化库 `mini_rag`（utf8mb4） |
| qdrant | `qdrant/qdrant:v1.12.4` | 6333(rest) / 6334(grpc) | `qdrant_data` | 单节点，无鉴权（仅本地） |
| server | 本地构建 `server/Dockerfile`（node:20-alpine 多阶段） | 3000 | `uploads_data` | depends_on 健康条件；启动时跑维度校验 |
| web | 本地构建 `web/Dockerfile`（node:20 构建 → nginx:alpine 托管） | 8080→80 | — | nginx 反代 `/api` 到 server，**SSE 需 `proxy_buffering off`** |

开发阶段（任务 1-13）只用 `docker compose up -d mysql qdrant`；server/web 的容器化在任务 17 完成，compose 文件预留服务定义。理由：前期本地热更新调试效率更高，容器化是交付层工作。

---

## 12. 环境变量清单

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SERVER_PORT` | 3000 | 后端端口 |
| `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME` | localhost / 3306 / root / root123 / mini_rag | MySQL 连接 |
| `QDRANT_URL` | http://localhost:6333 | Qdrant 地址 |
| `QDRANT_COLLECTION` | rag_chunks | collection 名 |
| `QDRANT_UPSERT_BATCH_SIZE` | 100 | 每批 upsert 的 point 数 |
| `QDRANT_MOCK` | false | 本地验收用内存向量存储，不调用真实 Qdrant |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | 无默认（必填） | Embedding 服务，OpenAI 兼容 |
| `EMBEDDING_DIMENSION` | 1024 | 向量维度，必须与模型一致 |
| `EMBEDDING_BATCH_SIZE` | 20 | 每批切片数 |
| `EMBEDDING_TIMEOUT_MS` | 30000 | Embedding 请求超时时间 |
| `EMBEDDING_MAX_RETRIES` | 3 | Embedding 可重试失败的最大重试次数 |
| `EMBEDDING_MOCK` | false | 本地验收用确定性 Mock 向量，不调用真实模型服务 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 无默认（必填） | 聊天模型服务 |
| `LLM_TEMPERATURE` | 0.3 | 低温减幻觉 |
| `LLM_MAX_TOKENS` | 2048 | |
| `UPLOAD_DIR` | ./uploads | 文件存储目录 |
| `MAX_FILE_SIZE_MB` | 20 | 上传大小限制 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 500 / 100 | 字符数 |
| `CONTEXT_MAX_CHARS` | 4000 | 组装上下文上限 |
| `TOP_K` / `SCORE_THRESHOLD` | 5 / 0.5 | 检索默认值；T09 已实现，支持请求级覆盖 |
| `CORS_ORIGIN` | http://localhost:5173 | 允许来源 |
| `VITE_API_BASE_URL` | /api | 前端（构建期注入） |

---

## 13. 分阶段开发任务

| 阶段 | 任务 | 目标 | 前置 |
|---|---|---|---|
| P1 | T01 项目初始化与 Docker 环境 | 仓库骨架 + mysql/qdrant 可起 + 前后端骨架 + 健康检查打通 | — |
| P2 | T02 数据库实体与基础模块 | 6 张表实体、TypeORM 接入、统一异常/响应、config 校验 | T01 |
| P3 | T03 知识库 CRUD | 接口 2-5 全部可用 | T02 |
| P4 | T04 文档上传与文档管理 | 接口 6-9、哈希去重、状态字段 | T03 |
| P5 | T05 文档解析 + T06 清洗切片 | 三种格式提取、切片落 document_chunk | T04 |
| P6 | T07 Embedding 服务 + T08 Qdrant 写入 | 分批向量化、collection 自举与维度校验、upsert、状态机闭环 | T06 |
| P7 | T09 向量检索 + T10 基础问答（非流式） | filter+TopK+阈值，同步返回完整答案 | T08 |
| P8 | T11 SSE 流式 + T12 引用来源 + T13 会话记录 | 接口 10-13 完整闭环 | T10 |
| P9 | T14a 前端：知识库与文档页；T14b 前端：对话页（SSE+引用） | 四页面可用 | T04 / T13 |
| P10 | T15 错误处理与日志打磨；T16 测试；T17 README 与容器化交付；T18 面试材料 | 可演示、可讲解 | 全部 |

规则：**每阶段验收通过后才进入下一阶段**；单任务超出预期规模时必须向我反馈并再拆分，不允许 Codex 自行合并。

---

## 14. 每阶段验收标准

| 阶段 | 验收标准（可执行） |
|---|---|
| P1 | `docker compose up -d` 后 mysql/qdrant healthy；`curl :3000/api/health` 返回 db=up；`:5173` 页面能调通健康接口 |
| P2 | 服务启动自动建出 6 张表；错误请求返回统一 `{code,message}`；非法环境变量启动即报错 |
| P3 | Swagger 可全绿调用 CRUD；删除不存在的库返回 404；重名返回 409 |
| P4 | 上传→列表可见 pending；同文件重复上传返回 409；删除后磁盘文件与记录均清除 |
| P5 | 三格式样例文档解析后 chunk 落库；中文 PDF 页码正确；空文档置 failed 且有 error_message |
| P6 | completed 文档 chunk_count 与 Qdrant 实际点数一致；维度配错时启动报错；删除文档后向量查无 |
| P7 | 命中问题返回答案+引用；无关问题返回"未找到"且不调用 LLM；阈值/TopK 可被请求覆盖 |
| P8 | 前端可见逐字输出；断网/模型超时 SSE 有 error 事件且消息已落库；刷新后会话与引用完整重现 |
| P9 | 上传进度、状态轮询、四态聊天 UI、引用面板、空态/异常态全部可操作 |
| P10 | 单测覆盖 splitter/cleaner/embedding 分批；`docker compose up` 一键起全栈；README 可复现；面试文档成稿 |

---

## 15. 当前方案的主要风险

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | `pdf-parse` 在 NestJS 下的模块加载与页码稳定性风险 | T05 卡壳或页码不可靠 | **已关闭**：T05 改用并锁死 `pdfjs-dist@2.16.105`，pdfjs 接触集中在单一兼容层文件；2.x 停更风险由锁版本和窄封装对冲 |
| 2 | 更换 Embedding 模型导致维度与已建 collection 不匹配 | 检索静默失效或报错 | 启动时强校验并 fail-fast；README 写明重建步骤 |
| 3 | MySQL 与 Qdrant 无双写事务，删除/处理中断可能残留 | 脏数据 | T08 已实现重试前按 documentId 清旧向量、写入失败补偿清理、写入数量校验，并在文档/知识库删除前调用向量清理方法 |
| 4 | SSE 经 nginx 缓冲导致前端收不到流 | 交付环境流式失效 | 响应头 `X-Accel-Buffering: no` + nginx `proxy_buffering off`，T17 验收项 |
| 5 | 进程内异步处理，服务重启后处理中文档卡死 | 状态不一致 | T06 已支持 chunking 状态重触发；T07/T08 已支持 embedding/failed 状态重触发和同文档并发去重；completed 防重复；parsing 崩溃恢复仍需后续启动恢复机制处理 |
| 6 | 字符数代替 token 数，中文场景估算偏差 | 上下文可能截断 | MVP 接受；CONTEXT_MAX_CHARS 保守取 4000；面试作为已知取舍讲解 |
| 7 | 模型服务限流/超时 | 处理失败率上升 | T07 已实现分批、超时、指数退避重试、返回数量/顺序/维度校验，失败落 error_message |
| 8 | 文档处理无重试界面，失败只能重传 | 体验差 | MVP 接受（重传会撞哈希去重 → 允许 failed 状态文档被同文件重新上传覆盖重试，写进 T04 规则） |
| 9 | 无鉴权，接口裸露 | 安全 | 定位本地/内网演示；README 声明；面试作为"刻意的范围裁剪"讲解 |
| 10 | MD/TXT 无页码概念，引用展示不一致 | UI 细节 | page_no 可空，前端对 NULL 显示"-"；契约中明确 |

---

## 附：本方案已冻结、Codex 不得更改的决策

1. 表名、字段名、枚举值（§5）；2. Collection 名与 payload 字段名（§6）；3. API 路径、错误结构、SSE 事件名（§9/§4.2）；4. 端口与目录结构（§10/§11）；5. 环境变量名（§12）。确需调整时必须回填本文件并注明修改原因。

## 附：设计修订记录

### v1.1（T02 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | 所有表主键与外键 `BIGINT UNSIGNED` → `INT UNSIGNED` | INT UNSIGNED 上限约 42.9 亿，在 JS `Number.MAX_SAFE_INTEGER` 内，前后端 ID 统一 `number`，避免 BIGINT 序列化/精度问题 |
| 2 | `message` 表新增 `status ENUM('completed','failed')` 与 `error_message TEXT NULL` | SSE 生成失败时需落库失败状态与原因（原 §4.2 ⑦ 已有"落库并标记"流程，当时字段缺失） |
| 3 | `conversation` 表新增 `idx_kb(kb_id)` | 接口 11 按知识库查询会话列表需要索引支撑 |
| 4 | `document_chunk.kb_id` 明确为**不设外键的冗余列** | chunk 生命周期完全跟随 document（FK 级联），kb_id 仅为按库直查的查询冗余，避免重复级联路径与跨表更新歧义 |
| 5 | 统一响应结构明确为：成功 `{ code: 0, message: 'success', data }`、错误 `{ code, message, details? }`（code = HTTP 状态码） | 原 §9 只定义了错误结构，成功结构在 T02 补齐 |
| 6 | schema 管理方式确定为 **migration（synchronize 固定 false）** | 原方案" synchronize 仅限开发"表述在 T02 收紧为完全禁用，表结构只能经 migration 变更 |

### v1.2（T03 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | `knowledge_base` 索引 `idx_name(name)` → 唯一约束 `uk_name(name)` | 重名控制从纯应用层校验升级为"应用层预检 + DB 唯一约束兜底"，防止并发创建产生重名；唯一索引同时承担按名查询，原普通索引冗余故移除。由独立新 migration 添加，不修改 InitSchema |
| 2 | 明确重名判定大小写规则：大小写**不敏感** | 表 collation 为 `utf8mb4_unicode_ci`，唯一索引与 `WHERE name = ?` 均大小写不敏感，两层行为一致，无需额外处理 |
| 3 | 全局 `ValidationPipe` 开启 `transform: true` | DTO 的 `@Transform`（如 name trim）只有在 transform 开启后才作用于控制器收到的值 |

### v1.3（T04 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | 统一错误结构增强：全局过滤器对 `HttpException` 响应体中显式携带的 `details` 字段予以透传 | T04 重复文件 409 需要在 `details` 中返回已有文档摘要（id/fileName/status）；基础结构 `{code,message}` 不变，无 details 时行为与之前完全一致 |
| 2 | 错误码段位补充：**415**（文件类型/内容不支持）、**413**（文件超过大小限制） | 原 §9 段位未覆盖上传场景；类型错误选定 415 并在全项目保持一致，不允许 400/415 混用 |
| 3 | Multer 错误映射规则：`MulterError: LIMIT_FILE_SIZE` → 413，其余 MulterError → 400 | Multer 错误默认会落入未知异常分支变 500，不符合契约；过滤器新增专门分支 |
| 4 | 文档详情接口（§9 #8）分阶段交付：T04/T05 仅返回元数据，切片预览顺延至 T06 | T05 不写 `document_chunk`；提前实现会产生假数据 |

### v1.4（T05 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §3.2 后端 PDF 解析库由 `pdf-parse@1.1.1` 改为 `pdfjs-dist@2.16.105` 精确锁定 | 页码引用是后续检索引用链路的硬需求；`pdfjs-dist@2.16.105` 在当前 CJS/NestJS 运行时下可直接使用，并原生逐页提取文本 |
| 2 | §4.1 状态语义补充：T05 解析成功后 `status` 回到 `pending` | 本阶段禁止 `chunking/embedding/completed`；T06 前 `pending` 表示“已解析，待切片”，解析完成事实由 `.parsed/{documentId}.json` 承载 |
| 3 | §9 #8 文档详情切片预览顺延至 T06 | T05 不写 `document_chunk`，无可展示切片；提前实现只能产生假数据 |

### v1.5（T06 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 状态语义补充：T06 成功后 `status` 留在 `chunking` | `chunking` 在 T06→T07 之间表示“已切片，待向量化”；T07 可据此拣选 `status='chunking' AND chunk_count > 0` 的文档 |
| 2 | §9 #8 文档详情切片预览在 T06 实现 | v1.3/v1.4 已将该能力顺延至 T06；本阶段写入真实 `document_chunk` 后可展示前 20 条切片预览 |
| 3 | §12 `CHUNK_SIZE` / `CHUNK_OVERLAP` 环境变量在 T06 实现 | T06 首次使用总体方案中的切片配置，并补充 `CHUNK_OVERLAP < CHUNK_SIZE` 启动校验 |
| 4 | §15 风险 5 部分关闭：`chunking` 崩溃残留由 T06 幂等处理覆盖 | T06 支持 `chunking` 状态重触发；`chunkCount > 0` 直接短路，`chunkCount = 0` 重跑并清理旧切片；`parsing`/`embedding` 仍需 T07+ 处理 |

### v1.6（T07 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 状态语义补充：T07 成功后 `status` 留在 `embedding` | T07 只完成向量化并把 `{chunkId,qdrantPointId,vector}` 作为内存结果提供给 T08，不写 Qdrant、不置 `completed` |
| 2 | §12 Embedding 环境变量补充 `EMBEDDING_TIMEOUT_MS`、`EMBEDDING_MAX_RETRIES`、`EMBEDDING_MOCK` | T07 首次实现模型调用，需要显式配置超时、重试和本地 Mock 验收模式 |
| 3 | §15 风险 7 更新：Embedding 调用的分批、超时、指数退避与返回校验已在 T07 实现 | 降低限流/超时导致的失败率，并避免数量、顺序、维度错配静默进入 T08 |
| 4 | §15 风险 5 更新：`embedding` 状态重试由 T07 覆盖 | T07 同文档内存并发去重，失败仅更新文档状态和错误信息；重试复用已有 chunk，不生成重复数据 |
| 5 | §7 后端模块补充：`src/modules/embedding/` 已创建 | T07 新增独立 Embedding 模块，暂不实现 Qdrant、检索、LLM、Chat 或前端 |

### v1.7（T08 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 状态语义补充：T08 成功后 `status=completed` | T08 完成 Qdrant 写入，是当前文档处理流水线终态 |
| 2 | §7 后端模块补充：`vector-store` 模块在 T08 创建 | 新增 `VectorStoreModule`，负责 Qdrant Collection 自举、维度/距离校验、payload 索引、upsert 与按过滤删除；T09 前不实现检索 |
| 3 | §12 Qdrant 环境变量补充 `QDRANT_UPSERT_BATCH_SIZE`、`QDRANT_MOCK` | T08 首次连接 Qdrant，需要显式配置 upsert 批量大小和无 Docker 环境验收模式 |
| 4 | §15 风险 3 更新：双写一致性由 T08 部分覆盖 | T08 实现重试前清旧向量、失败补偿清理、写入数量校验，并将文档/知识库删除接入向量清理 |
| 5 | §15 风险 5 更新：`embedding`/`failed` 状态的向量写入重试由 T08 覆盖 | T08 支持从 `embedding`/`failed` 触发写入，成功置 `completed`，同文档并发去重，`completed` 防重复 |
| 6 | §3.2 `@qdrant/js-client-rest` 版本精确锁定为 `1.12.0` | 与 Qdrant Server v1.12.4 对齐，保持 Node 20 + NestJS 10 CJS 运行时兼容 |

### v1.8（T09 设计时修订，项目负责人确认）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §7 模块划分补充：`retrieval` 模块在 T09 创建 | 新增 `RetrievalModule`，含 `RetrievalService` 和 `RetrievalController`；依赖 `EmbeddingModule` + `VectorStoreModule` |
| 2 | §9 API 接口清单补充 #14：`POST /api/knowledge-bases/:id/retrieve` | T09 新增检索测试接口；body `{query, topK?, scoreThreshold?}`；响应 `{results,total,took}` |
| 3 | §12 环境变量 `TOP_K`/`SCORE_THRESHOLD` 在 T09 实现 | 总体方案已列出，T09 首次使用检索配置，并支持请求级覆盖 |
| 4 | §4.2 问答流水线 ②③ 补充：检索参数来源和过滤逻辑 | ② query 通过 `EmbeddingService.embedQuery()` 生成向量；③ Qdrant search 使用 `knowledgeBaseId` 过滤，TopK/阈值可覆盖，并过滤无效文档 |
| 5 | `EmbeddingService` 新增 `embedQuery()` 方法 | T09 需要单条 query 向量化，复用 T07 `EmbeddingClient` 的 Mock、重试、超时和维度校验 |
