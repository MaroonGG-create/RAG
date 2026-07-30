# Mini RAG 当前实现快照

> 快照日期：2026-07-29（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 基准提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）
> 当前阶段：T06 文本清洗与切片完成后
> 详细验收：`docs/reports/task-06-completion.md`

## 1. 当前结论

- T01/T02 工程骨架、Docker Compose、MySQL/Qdrant 基础设施、TypeORM 实体、统一响应和异常处理继续存在。
- T03 知识库 CRUD 可用。
- T04 文档上传、列表、详情、删除接口可用。
- T05 文档解析可用，解析结果仍通过 `server/uploads/.parsed/{documentId}.json` 暂存传递给后续流程。
- T06 已实现文本基础清洗、PDF/Markdown/TXT 统一切片、PDF 页码保留、`DocumentChunk` 批量写入、`document.chunkCount` 更新、切片幂等和失败清理。
- T06 成功后文档状态停留在 `chunking`，语义为“已切片，待向量化”，供 T07 拣选。
- 文档详情接口 `GET /api/documents/:id` 现在返回前 20 条真实 chunk 预览。
- 本阶段没有新增公开 HTTP 路由，没有新增数据库表，没有新增 migration，没有实现 Embedding、Qdrant 写入、向量检索、LLM、Chat、SSE、Rerank 或前端页面。

本地默认 `.env` 仍存在运行环境问题：宿主机 `mysqld` 监听 `localhost:3306`，默认 `DB_HOST=localhost` / `DB_PORT=3306` 会打到宿主机 MySQL 并认证失败。本次验收继续使用临时 `localhost:3307 -> Compose mysql:3306` 转发，并通过 `DB_PORT=3307` 执行 CLI/SQL 验收。

## 2. 当前模块

后端业务模块：

- `HealthModule`
- `KnowledgeBaseModule`
- `DocumentModule`
- `ProcessingModule`

`ProcessingModule` 当前结构：

```text
server/src/modules/processing/
├── processing.module.ts
├── chunking/
│  ├── chunk.types.ts
│  ├── chunking.service.ts
│  ├── text-cleaner.ts
│  └── text-splitter.ts
└── parsing/
   ├── parsed-document.types.ts
   ├── parsed-result.store.ts
   ├── parsing.service.ts
   ├── pdf.parser.ts
   └── plain-text.parser.ts

server/src/scripts/
├── parse-document.ts
└── chunk-document.ts
```

## 3. 当前接口和 CLI

HTTP 接口仍为既有 T04 契约，T06 不新增切片 HTTP 触发接口：

| 方法 | 路径 | 成功状态码 | 说明 |
|---|---|---:|---|
| GET | `/api/health` | 200 | 健康检查 |
| POST | `/api/knowledge-bases` | 201 | 创建知识库 |
| GET | `/api/knowledge-bases` | 200 | 知识库列表 |
| GET | `/api/knowledge-bases/:id` | 200 | 知识库详情 |
| DELETE | `/api/knowledge-bases/:id` | 204 | 删除知识库 |
| POST | `/api/knowledge-bases/:kbId/documents` | 202 | multipart 上传单文件，字段名 `file` |
| GET | `/api/knowledge-bases/:kbId/documents` | 200 | 文档列表 |
| GET | `/api/documents/:id` | 200 | 文档详情，含 `chunks` 预览数组，最多 20 条 |
| DELETE | `/api/documents/:id` | 204 | 删除文档记录、磁盘文件和解析暂存；chunk 由 FK 级联删除 |

内部 CLI：

```bash
pnpm --filter server parse:document <documentId>
pnpm --filter server chunk:document <documentId>
```

`chunk:document` 成功时 stdout 只输出摘要 JSON：

```json
{"documentId":98,"chunkCount":8,"totalChars":3428}
```

失败时 stderr 输出：

```text
切片失败：<中文错误摘要>
```

## 4. 配置

T06 新增切片配置：

| 环境变量 | 默认值 | 校验 |
|---|---:|---|
| `CHUNK_SIZE` | 500 | 整数，100–10000 |
| `CHUNK_OVERLAP` | 100 | 整数，0–9999，且必须小于 `CHUNK_SIZE` |

`configuration.ts` 暴露：

```ts
chunk: {
  size: number;
  overlap: number;
}
```

本地 git-ignored `.env` 已同步加上这两个默认值，避免 CLI/服务启动时缺失配置。

## 5. 清洗规则

`cleanText(text)` 是纯函数，不新增依赖：

- `\r\n` 和独立 `\r` 统一为 `\n`。
- 删除零宽字符：`\u200B`、`\u200C`、`\u200D`、`\uFEFF`。
- 3 个及以上连续换行压缩为 2 个换行。
- 仅做首尾 `trim()`。

明确不做：

- 不清除 Markdown 标记。
- 不清除页眉页脚。
- 不改 URL、邮箱、标点、段落内换行和内部空格。

`document_chunk.content` 存储清洗后的文本；T05 `.parsed` 原文不改。

## 6. 切片策略

- PDF、Markdown、TXT 统一走 `ChunkingService.chunkDocument(documentId)`。
- 输入只来自 T05 `.parsed/{documentId}.json`，并校验 `parsed.fileHash === document.fileHash`。
- PDF 按页独立清洗和切片，不跨页合并，不跨页 overlap。
- Markdown/TXT 由 T05 的单段 `pageNo=null` 透传。
- 分隔符优先级：`\n\n`、`\n`、`。`、`！`、`？`、`. `、`! `、`? `、空格、硬切。
- `chunkIndex` 在文档内从 0 全局连续递增。
- `charCount = content.length`。
- `qdrantPointId` 使用 Node.js `crypto.randomUUID()` 生成。

## 7. 状态、事务和幂等

状态流转：

- `pending|failed|chunking -> chunking`。
- 成功后保持 `chunking`，并更新 `chunkCount=N`。
- 失败后置 `failed`，写 `errorMessage`，并重置 `chunkCount=0`。
- `embedding` / `completed` 会被拒绝切片，避免覆盖后续阶段数据。

事务边界：

- `delete old chunks + batch insert new chunks + update document.chunkCount/status` 在一个 TypeORM transaction 内完成。
- 每批最多写入 500 条 `DocumentChunk`。
- 失败 catch 会兜底删除该 document 的 chunks，再将文档置为 failed/0，避免半成品残留。

幂等：

- `status=chunking && chunkCount>0` 时直接短路返回，不重写 chunks。
- `failed` 或 `chunking && chunkCount=0` 可重试；重试时事务内先删旧 chunks，再插入新 chunks。
- 同进程并发用 `Map<number, Promise<ChunkResult>>` 复用同一个 in-flight Promise。

## 8. 已验证结果

构建和类型检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `DB_PORT=3307 pnpm --filter server migration:show` | 通过，仅 2 条历史 migration |

T06 验收摘要：

| 场景 | 结果 |
|---|---|
| 多页 PDF | `documentId=103`，解析 3 页，切片 3 条，`pageNo=1,2,3`，`chunkIndex=0..2` |
| 短 TXT | `documentId=97`，切片 1 条，`pageNo=null` |
| 长 TXT | `documentId=98`，切片 8 条，`chunkIndex=0..7`，重复执行前后 `chunkCount=8` 且 `qdrantPointId` 不变 |
| 中文 Markdown | `documentId=99`，切片 1 条，`pageNo=null`，保留 `#` / `**` 等 Markdown 标记，内容含中文 |
| 清洗后为空 | `documentId=100`，零宽字符文本 T05 可解析，T06 清洗后失败：`清洗后无可切片内容`，`chunkCount=0`，无 chunk 残留 |
| 未解析直接切片 | `documentId=101`，失败：`文档尚未解析或解析结果已丢失，请先执行 pnpm --filter server parse:document <id>` |
| fileHash 不匹配 | `documentId=102`，失败：`解析结果与文档不匹配，请重新解析` |
| 失败重试 | 手动模拟 `documentId=98` 为 failed/0 且保留旧 chunks 后重试，旧 chunks 被删除并重建，`chunkCount=8` |
| 同进程并发 | `documentId=104`，`Promise.all` 两次调用返回同一结果对象，`sameObject=true`，`chunkCount=5` |
| 文档详情预览 | `GET /api/documents/98` 返回 `chunks` 8 条，content 截断到 200 字以内 |
| 删除联动 | 删除已切片 Markdown 文档返回 204，`document_chunk` 为 0，`.parsed/{id}.json` 消失 |
| 配置边界 | `CHUNK_SIZE=100 CHUNK_OVERLAP=100` 启动失败：`CHUNK_OVERLAP 必须小于 CHUNK_SIZE` |
| 范围扫描 | 未新增 Embedding/Qdrant/Chat/SSE/Rerank 实现；搜索仅命中既有字段、状态枚举和注释 |
| 清理 | 验收后 `knowledge_base=0`、`document=0`、`document_chunk=0`，`.parsed` 无残留文件 |

补充说明：本次用 ReportLab 生成的中文 PDF 经 pdf.js 提取后中文显示为 `?`，因此 PDF 验收只断言了多页页码归属和 ASCII marker；中文内容保真用 Markdown/TXT 样本完成验证。未把该项虚构为“中文 PDF 内容命中”。

## 9. 当前未实现范围

以下仍属于后续任务：

- Embedding
- Qdrant collection/upsert/search/delete
- 向量检索
- LLM / Chat / SSE
- Rerank
- 上传后自动触发完整流水线
- 后台队列、定时任务、启动恢复钩子
- 前端知识库/文档/对话页面
- OCR / 图片型 PDF 支持
- 文件下载、预览、批量上传

## 10. 已知问题

1. 默认 `localhost:3306` 仍会打到宿主机 MySQL，本次验收使用临时 `localhost:3307 -> Compose mysql:3306` 转发。
2. 本次生成的中文 PDF 样本文本映射不适合 pdf.js 中文内容断言；中文切片质量已通过 Markdown/TXT 验证，多页 PDF 页码归属已单独验证。
3. T06 不做页眉页脚清理，避免启发式误删。
4. 直接删除知识库仍不会同步删除该知识库上传目录；本次验收后手动清理了测试目录。
5. `parsing` / `embedding` 崩溃残留仍需 T07+ 启动恢复机制处理；T06 只覆盖 `chunking` 重触发。
6. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。

## 11. 进入 T07 条件

代码层面具备进入 T07 条件：

- 成功切片文档已稳定停留在 `status='chunking'` 且 `chunkCount>0`。
- `document_chunk` 已包含 T07 所需字段：`content`、`kbId`、`documentId`、`chunkIndex`、`pageNo`、`qdrantPointId`。
- `chunkIndex` 连续、`charCount` 与 content 长度一致、失败重试无重复 chunk。
- 没有新增 schema/migration，也没有提前实现 Embedding 或 Qdrant 写入。

进入 T07 前仍建议处理默认 DB 连接冲突，避免继续依赖临时 3307 转发。
