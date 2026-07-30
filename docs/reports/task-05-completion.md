# T05 文档解析完成报告

> 验收日期：2026-07-29（Asia/Shanghai）
> 工作区：`D:\Users\Documents\RAG`
> 基准提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）
> 实际任务文档：`docs/task-05-document-parsing.md`
> 说明：用户提到的 `docs/tasks/task-05-document-parsing.md` 在当前仓库不存在。

## 1. 最终结论

**通过。**

T05 范围内的 PDF 按页解析、Markdown/TXT 读取、统一解析结果、路径安全校验、状态流转、失败落库、重复解析短路、同进程并发控制和 CLI 触发均已实现并通过真实运行验收。

本阶段未新增数据库表、未生成 migration、未写入 `document_chunk`，也未实现文本清洗、切片、Embedding、Qdrant、Chat、SSE、前端页面或公开解析 HTTP 接口。

## 2. 新增和修改文件

新增文件：

- `docs/reports/task-05-completion.md`
- `server/src/modules/processing/processing.module.ts`
- `server/src/modules/processing/parsing/parsed-document.types.ts`
- `server/src/modules/processing/parsing/parsed-result.store.ts`
- `server/src/modules/processing/parsing/parsing.service.ts`
- `server/src/modules/processing/parsing/pdf.parser.ts`
- `server/src/modules/processing/parsing/plain-text.parser.ts`
- `server/src/scripts/parse-document.ts`

修改文件：

- `README.md`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`
- `pnpm-lock.yaml`
- `server/package.json`
- `server/src/app.module.ts`
- `server/src/modules/document/document.module.ts`
- `server/src/modules/document/document.service.ts`

新增依赖：

- `server.dependencies`: `pdfjs-dist@2.16.105`（精确版本）

## 3. 核心实现

- `pdf.parser.ts` 是唯一 import/require `pdfjs-dist` 的文件，使用 `pdfjs-dist/legacy/build/pdf.js`，设置 worker 和 CMap 路径，逐页调用 `getPage(i).getTextContent()`。
- PDF 结果按页输出 `pages: [{ pageNo, text }]`，页码从 1 连续递增，保留空页对象；全 PDF 文本长度为 0 时按扫描件/OCR 不支持失败。
- Markdown/TXT 通过 `decodePlainText(buffer)` 读取，支持 UTF-8 BOM、UTF-16LE BOM、UTF-16BE BOM；无 BOM 按 UTF-8；包含 `U+FFFD` 时失败；空/全空白文本失败。
- 统一暂存类型为 `ParsedDocument`，字段含 `documentId/fileExt/parser/parserVersion/fileHash/parsedAt/pages/totalChars`。
- 解析结果写入 `{upload.dir}/.parsed/{documentId}.json`，采用临时文件 + rename；不写 MySQL，不新增 schema。
- `ParsingService.parseDocument(id)` 负责状态流转：`pending|failed|parsing -> parsing`；成功回 `pending`；失败置 `failed + errorMessage`。
- 成功回 `pending` 的语义：T05 后表示“已解析，待 T06 切片”，解析完成事实由 `.parsed` 文件承载。
- `chunking/embedding/completed` 状态会被防御性拒绝，避免 T06+ 流水线被重复解析覆盖。
- 重复解析先读暂存；若 `fileHash` 与 DB 一致，直接返回，不刷新 `parsedAt`，不改状态。
- 同进程并发通过 `Map<documentId, Promise<ParsedDocument>>` 复用同一个解析 Promise。
- 文件路径使用 `resolve(uploadDir, storagePath)` + `relative(uploadDir, absolutePath)` 校验，拒绝越界路径。
- 文档删除流程新增 `.parsed/{documentId}.json` 清理；磁盘文件缺失时仍按 T04 行为记录 warning 并返回 204。
- CLI：`pnpm --filter server parse:document <documentId>`；成功只输出摘要 JSON，不输出正文；失败输出 `解析失败：...` 并退出 1。

## 4. 实际执行命令

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm --filter server add -E pdfjs-dist@2.16.105` | 0 | 依赖加入 server，lockfile 更新 |
| `pnpm --filter server build` | 1 | 首次失败：`pdfjs-dist` 2.x 未导出 `TextItem` 类型 |
| `pnpm --filter server build` | 0 | 改为本地窄类型守卫后通过 |
| `pnpm --filter web type-check` | 0 | 通过 |
| `docker compose ps` | 0 | MySQL/Qdrant 均 `Up (healthy)` |
| 临时启动 `alpine/socat` 转发 `localhost:3307 -> mysql:3306` | 0 | 用于绕开宿主机 `MySQL80` 占用 `3306` |
| `$env:DB_PORT='3307'; pnpm --filter server migration:show` | 0 | `[X] 2 InitSchema...`、`[X] 3 AddKnowledgeBaseNameUnique...` |
| `$env:DB_PORT='3307'; pnpm --filter server parse:document abc` | 1 | `解析失败：documentId 必须是正整数` |
| 后端以临时 `DB_PORT=3307` 启动并请求 `/api/health` | 0 / HTTP 200 | `db="up"` |
| T05 完整上传/解析/失败/并发/清理验收脚本 | 0 | 通过；见下方结果 |
| T05 内容断言脚本 | 0 | PDF 页码和 MD/TXT 正文命中 |
| 清理校验 SQL（密码已从报告中省略） | 0 | 临时 KB/Document 为 0，`document_chunk=0` |

未执行：

- 未执行 `migration:generate`。
- 未执行任何前端业务页面开发。

## 5. 测试结果

上传阶段（临时知识库 `51`，后续已清理）：

| 文件 | MIME | HTTP | documentId | status | chunkCount | errorMessage |
|---|---|---:|---:|---|---:|---|
| `sample.pdf` | `application/pdf` | 202 | 84 | pending | 0 | null |
| `sample.md` | `text/markdown` | 202 | 85 | pending | 0 | null |
| `sample.txt` | `text/plain` | 202 | 86 | pending | 0 | null |
| `utf16le.txt` | `text/plain` | 202 | 87 | pending | 0 | null |
| `blank.pdf` | `application/pdf` | 202 | 88 | pending | 0 | null |
| `broken.pdf` | `application/pdf` | 202 | 89 | pending | 0 | null |
| `empty.txt` | `text/plain` | 202 | 90 | pending | 0 | null |
| `missing.txt` | `text/plain` | 202 | 91 | pending | 0 | null |
| `path.txt` | `text/plain` | 202 | 92 | pending | 0 | null |

解析结果：

| 场景 | 退出码 | 结果 |
|---|---:|---|
| PDF 首次解析 | 0 | `parser=pdfjs`, `pageCount=2`, `totalChars=46`, `parsedAt=2026-07-29T08:19:12.775Z` |
| PDF 重复解析 | 0 | `parsedAt` 与首次相同，幂等短路通过 |
| Markdown | 0 | `parser=plaintext`, `pageCount=1`, `totalChars=59` |
| TXT | 0 | `parser=plaintext`, `pageCount=1`, `totalChars=47` |
| UTF-16LE TXT | 0 | `parser=plaintext`, `pageCount=1`, `totalChars=13` |
| 空白 PDF | 1 | `解析失败：未能提取到文本内容，可能是扫描件，当前版本不支持 OCR` |
| 损坏 PDF | 1 | `解析失败：PDF 文件损坏或格式无法解析` |
| 空 TXT | 1 | `解析失败：文件内容为空` |
| 文件丢失 | 1 | `解析失败：文件不存在或已被移动：51/b098b32d-6040-4490-b345-c14d91d58fb4.txt` |
| 路径越界 | 1 | `解析失败：文件路径越界：../outside.txt` |
| 同进程并发解析 | 0 | `sameObject=true`, `parsedAtEqual=true`, `pageCount=1`, `totalChars=59` |

内容断言（临时知识库 `52`，后续已清理）：

| 断言 | 结果 |
|---|---|
| PDF `pages.pageNo` | `1,2` |
| PDF 第 1 页包含 `page one marker` | true |
| PDF 第 2 页包含 `page two marker` | true |
| MD `pageNo=null` | true |
| MD 文本包含 `# T05 Markdown` | true |
| TXT `pageNo=null` | true |
| TXT 文本包含 `Second line is preserved.` | true |

数据库查询结果（清理前）：

```text
84  sample.pdf    pdf  pending  NULL  0
85  sample.md     md   pending  NULL  0
86  sample.txt    txt  pending  NULL  0
87  utf16le.txt   txt  pending  NULL  0
88  blank.pdf     pdf  failed   <空白 PDF OCR 不支持错误>  0
89  broken.pdf    pdf  failed   <PDF 损坏错误>             0
90  empty.txt     txt  failed   <文件内容为空>             0
91  missing.txt   txt  failed   <文件不存在或已被移动>     0
92  path.txt      txt  failed   <文件路径越界>             0
```

PowerShell/MySQL 客户端对中文 `error_message` 的直接表格输出出现问号编码显示；准确中文错误以上方 CLI 输出为准。

文件系统和数据库补充检查：

| 检查项 | 结果 |
|---|---|
| `.parsed` 清理前文件 | `84.json`, `85.json`, `86.json`, `87.json` |
| storage_path | 均为相对路径，如 `51/938cfcf3-5a66-423e-81bb-78432aa4c577.pdf` |
| `document_chunk` | `COUNT(*) = 0` |
| 临时 KB/Document 清理后 | `knowledge_base=0`, `document=0` |
| `.parsed` 清理后 | 无文件 |
| 测试文档删除 | 9 个 Document 均 204 |
| 测试知识库删除 | 204 |

越界检查：

- 代码搜索确认本次未新增 `DocumentChunk` 写入。
- 代码搜索确认没有新增 processing/parse HTTP 路由。
- Swagger/HTTP 路由仍只有 T04 已有接口。
- 未新增 `embedding`、`vector-store`、`chat`、`SSE`、前端业务页面实现。

## 6. 已知问题

1. 默认 `.env` 的 `DB_PORT=3306` 仍会连接到宿主机 `MySQL80`，本次验收必须用临时 `DB_PORT=3307` 转发 Compose MySQL。未修改 `.env`。
2. 直接删除知识库仍不会删除该知识库的上传目录；本次清理继续采用先删 Document 再删 KB。
3. `ParsePositiveIntPipe` 仍保留 T03 遗留问题：`1e2`、`0x10` 等宽松数字语法不在 T05 范围内处理。
4. 本次第一次验收脚本未给 PDF 上传指定 `application/pdf` MIME，按 T04 设计被 415 拒绝；修正脚本后完整重跑通过，半成品数据已清理。

## 7. 是否具备进入 T06 的条件

**具备。**

理由：

- 解析输出已经有稳定、可复用的 `.parsed/{documentId}.json` 暂存格式。
- PDF 页码、纯文本读取、异常状态和错误信息均已真实验证。
- 重复解析和同进程并发控制已验证。
- 无 schema 变化、无 migration、无 `document_chunk` 写入。
- T06 所需的输入边界已经清晰：从 `.parsed` 读取 `ParsedDocument` 后再做清洗、切片和 `document_chunk` 写入。

进入 T06 前仍建议先处理本机数据库端口冲突，避免后续流水线验收反复依赖临时转发。
