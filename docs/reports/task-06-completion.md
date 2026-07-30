# T06 文本清洗与切片完成报告

> 验收日期：2026-07-29（Asia/Shanghai）
> 收尾核对日期：2026-07-30（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 实际任务文档：`docs/task-06-text-cleaning-and-chunking.md`
> 说明：用户提到的 `docs/tasks/task-06-text-cleaning-and-chunking.md` 在当前仓库不存在，实际执行依据为仓库中的 `docs/task-06-text-cleaning-and-chunking.md`。

## 1. 最终结论

**通过，具备进入 T07 的代码条件。**

T06 范围内的文本基础清洗、PDF/Markdown/TXT 统一切片、PDF 页码保留、连续 `chunkIndex`、`charCount`、`qdrantPointId` UUID、`DocumentChunk` 批量写入、`document.chunkCount` 更新、状态流转、失败清理、重试幂等和同进程并发控制均已实现并通过真实运行验收。

本阶段未新增数据库表、未生成 migration、未修改实体定义，也未实现 Embedding、Qdrant 写入、向量检索、LLM、Chat、SSE、前端页面或 Rerank。

2026-07-30 收尾仅核对当前文档、代码范围和 migration 文件列表；未重新执行构建或验收脚本，以下测试结果均为 2026-07-29 T06 实施时的实际执行结果。

## 2. 新增和修改文件

新增文件：

- `docs/reports/task-06-completion.md`
- `server/src/modules/processing/chunking/chunk.types.ts`
- `server/src/modules/processing/chunking/chunking.service.ts`
- `server/src/modules/processing/chunking/text-cleaner.ts`
- `server/src/modules/processing/chunking/text-splitter.ts`
- `server/src/scripts/chunk-document.ts`

修改文件：

- `.env.example`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`
- `server/package.json`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`
- `server/src/modules/document/document.controller.ts`
- `server/src/modules/document/document.module.ts`
- `server/src/modules/document/document.service.ts`
- `server/src/modules/document/dto/document-response.dto.ts`
- `server/src/modules/processing/processing.module.ts`

本地运行配置：

- git-ignored `.env` 同步增加了 `CHUNK_SIZE=500` / `CHUNK_OVERLAP=100`，用于本机 CLI 和后端启动。

## 3. 清洗规则

`cleanText(text)` 为纯函数，不新增依赖：

- `\r\n` 和独立 `\r` 统一为 `\n`。
- 删除零宽字符：`\u200B`、`\u200C`、`\u200D`、`\uFEFF`。
- 3 个及以上连续换行压缩为 2 个换行。
- 只做首尾 `trim()`。

明确不做：

- 不清理 Markdown 标记、URL、邮箱、标点、段落内换行和内部空格。
- 不做页眉页脚启发式清理。
- 不解析 Markdown 结构，不做 NLP 分词。

`document_chunk.content` 存储清洗后的文本；T05 `.parsed` 原文不改。

## 4. 切片策略

- T06 从 `ParsedResultStore.read(documentId)` 读取 T05 `.parsed/{documentId}.json`。
- 读取后校验 `parsed.documentId` 和 `parsed.fileHash`，避免旧解析结果误用。
- PDF 按页独立清洗和切片，不跨页合并，不跨页 overlap。
- Markdown/TXT 的 `pageNo` 透传为 `null`。
- 分隔符优先级：`\n\n`、`\n`、`。`、`！`、`？`、`. `、`! `、`? `、空格、硬切。
- `chunkIndex` 从 0 开始，在整个文档内连续递增。
- `charCount = content.length`。
- 每条 chunk 用 `crypto.randomUUID()` 生成 `qdrantPointId`。

## 5. 页码处理

- PDF chunk 继承 T05 `ParsedPage.pageNo`。
- 同一页产生的多个 chunk 共享同一 `pageNo`。
- 空白页清洗后跳过，不占用 `chunkIndex`。
- 跨页不合并，保证每个 chunk 只有一个明确页码。
- Markdown/TXT 始终 `pageNo=null`。

## 6. 状态流转

T06 状态机：

- `pending -> chunking -> chunking`：成功切片后停在 `chunking`。
- `failed -> chunking -> chunking/failed`：允许失败文档重试。
- `chunking` 可重触发：`chunkCount>0` 幂等短路，`chunkCount=0` 重跑。
- `embedding` / `completed` 防御性拒绝：`文档已进入后续处理阶段，禁止重复切片`。

成功停在 `chunking` 的语义：文档已切片，等待 T07 Embedding 接管。

## 7. 事务和幂等实现

事务边界：

```text
delete old DocumentChunk
batch save new DocumentChunk（每批最多 500）
update Document(status='chunking', errorMessage=null, chunkCount=N)
```

这些操作在一个 TypeORM transaction 内完成，保证 chunk 写入和 `chunkCount` 一致。

失败补偿：

- catch 后兜底删除该 document 的 chunks。
- 更新文档为 `status='failed'`、`chunkCount=0`、`errorMessage=<摘要>`。
- 失败文档不会残留半成品 chunk。

幂等：

- 已成功切片文档重复执行直接短路，不删除和重写 chunks。
- failed/0 或 chunking/0 重试会先删除旧 chunks，再插入新 chunks。
- 同进程并发由 `Map<number, Promise<ChunkResult>>` 复用同一个 Promise。

## 8. 实际执行命令和结果

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter server migration:show` | 默认 `.env` 失败：宿主机 MySQL 认证拒绝 |
| `$env:DB_PORT='3307'; pnpm --filter server migration:show` | 通过，仅 `[X] InitSchema`、`[X] AddKnowledgeBaseNameUnique` |
| `rg "\bany\b" ...` | 本次新增/修改 T06 代码未命中显式 `any` |
| 范围扫描 Embedding/Qdrant/Chat/SSE/Rerank | 未发现新增实现或调用；仅命中既有字段名、状态枚举和注释 |

测试环境：

- Compose MySQL/Qdrant 均 healthy。
- 宿主机 `mysqld` 监听 3306，使用临时 `alpine/socat` 转发 `localhost:3307 -> rag-mysql-1:3306`。
- 临时后端以 `DB_PORT=3307` 启动，`GET /api/health` 返回 `db="up"`。

## 9. 功能验收结果

上传并解析的临时知识库：`53`。验收后已清理。

成功切片：

| 文档 | documentId | 结果 |
|---|---:|---|
| 多页 PDF | 103 | `chunkCount=3`，`totalChars=1059`，`pageNo=1,2,3`，`chunkIndex=0..2` |
| 短 TXT | 97 | `chunkCount=1`，`pageNo=null` |
| 长 TXT | 98 | `chunkCount=8`，`chunkIndex=0..7`，`pageNo=null` |
| Markdown | 99 | `chunkCount=1`，`pageNo=null`，保留 `#`、`**` 等 Markdown 标记，内容含中文 |

数据库断言通过：

- `chunkIndex` 从 0 连续递增。
- `charCount === content.length`。
- `qdrantPointId` 均为 UUID v4 格式。
- 默认配置下 chunk 长度均不超过 `CHUNK_SIZE + CHUNK_OVERLAP = 600`。
- PDF chunk 的 `pageNo` 均为正整数，Markdown/TXT 均为 `null`。

幂等与重试：

| 场景 | 结果 |
|---|---|
| 重复执行已切片长 TXT | 前后 `chunkCount=8`，`qdrantPointId` 完全不变，确认短路 |
| 失败重试模拟 | 手动将 `documentId=98` 置为 failed/0 且保留旧 chunks 后重试；旧 chunks 被删除并重建，`chunkCount=8`，新旧 UUID 不同 |
| 同进程并发 | `documentId=104` 用同一 Nest app context `Promise.all` 调用两次，`sameObject=true`，`chunkCount=5` |

失败路径：

| 场景 | documentId | 结果 |
|---|---:|---|
| 清洗后为空 | 100 | 失败：`清洗后无可切片内容`；DB 为 `failed/0`，无 chunks |
| 未解析直接切片 | 101 | 失败：`文档尚未解析或解析结果已丢失，请先执行 pnpm --filter server parse:document <id>`；DB 为 `failed/0`，无 chunks |
| fileHash 不匹配 | 102 | 失败：`解析结果与文档不匹配，请重新解析`；DB 为 `failed/0`，无 chunks |
| overlap 非法 | 97 | `CHUNK_SIZE=100 CHUNK_OVERLAP=100` 启动失败：`CHUNK_OVERLAP 必须小于 CHUNK_SIZE` |

文档详情预览：

- `GET /api/documents/98` 返回 `chunks` 8 条。
- 每条含 `id/chunkIndex/content/charCount/pageNo/qdrantPointId`。
- `content` 截断到 200 字符以内。
- 未切片文档详情返回 `chunks: []`。

删除联动：

- 删除已切片 Markdown 文档 `99` 返回 204。
- `document_chunk WHERE document_id=99` 为 0。
- `.parsed/99.json` 已删除。

清理结果：

- 验收结束后 `knowledge_base=0`、`document=0`、`document_chunk=0`。
- `.parsed` 目录无残留文件。
- 本次测试生成的 `tmp-test` 和 `server/uploads/53` 已删除。

## 10. 已知问题

1. 默认 `.env` 的 `DB_HOST=localhost` / `DB_PORT=3306` 仍会连接到宿主机 MySQL 并认证失败；本次验收继续使用 `DB_PORT=3307` 临时转发。
2. 本次用 ReportLab 生成的中文 PDF 经 pdf.js 提取后中文变为 `?`，因此 PDF 验收只断言了多页页码归属和 ASCII marker；中文内容切片通过 Markdown/TXT 验证。该项未虚构为“中文 PDF 内容命中”。
3. T06 不做页眉页脚清理，属于 MVP 取舍。
4. 直接删除知识库仍不会同步删除上传目录；本次测试目录已手动清理。
5. `parsing` / `embedding` 崩溃残留仍需 T07+ 启动恢复处理；T06 只覆盖 `chunking` 状态重触发。
6. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字语法仍为既有遗留问题。

## 11. 是否具备进入 T07 的条件

**具备。**

理由：

- T07 所需的 `document_chunk` 数据已真实落库。
- 成功文档稳定处于 `status='chunking'` 且 `chunkCount>0`。
- `qdrantPointId`、`content`、`kbId`、`documentId`、`chunkIndex`、`pageNo` 字段齐备。
- `chunkIndex` 连续，失败重试不会产生重复数据，失败后不残留半成品 chunk。
- 未提前实现 Embedding 或 Qdrant 写入，T07 边界清晰。

进入 T07 前建议优先修复默认 DB 连接冲突，避免后续验收继续依赖临时 3307 转发。
