# T04 文档上传与文档管理完成报告

> 验收日期：2026-07-29（Asia/Shanghai）  
> 工作区：`D:\Users\Documents\RAG`  
> 验收提交：`d0ccdd92b51a7756469da754a47574e3f39ff4bb`（`feat: 文件上传`）  
> 实际任务文档：`docs/task-04-document-management.md`  
> 说明：用户提到的 `docs/tasks/task-04-document-management.md` 在当前仓库不存在。

## 1. 最终结论

**部分通过。**

判定拆分如下：

- **T04 功能验收通过**：在连接到 Compose MySQL 的实际数据库后，上传、校验、去重、查询、删除、Swagger、数据库和文件系统清理均完成真实验收，未发现 T05 越界实现。
- **默认运行环境部分通过**：当前宿主机 `MySQL80` 占用 `localhost:3306`，且该实例不接受项目 `.env` 中的账号密码；因此直接执行 `pnpm --filter server migration:show` 首次退出码为 `1`。本次为完成验收，启动了临时 Docker 转发容器，把 Compose MySQL 暴露到 `localhost:3307`，并用临时 `DB_PORT=3307` 重启后端完成验收。未修改 `.env`，未停止或强杀本机 MySQL。

进入 T05 的代码条件具备；进入前应先处理本机 MySQL 端口/连接冲突，否则默认 `.env` 下的本地运行命令仍会失败。

## 2. 新增和修改文件

相对 T03 提交 `d99e8ce90c6980159955d6adfa928e650bf2be17`：

新增文件：

- `docs/task-04-document-management.md`
- `docs/reports/task-04-completion.md`
- `server/src/modules/document/document.controller.ts`
- `server/src/modules/document/document.module.ts`
- `server/src/modules/document/document.service.ts`
- `server/src/modules/document/dto/document-response.dto.ts`
- `server/src/modules/document/knowledge-base-documents.controller.ts`
- `server/src/modules/document/storage/document-storage.service.ts`
- `server/src/modules/document/storage/document-upload.config.ts`
- `server/src/modules/document/utils/file-hash.util.ts`

修改文件：

- `.env.example`
- `README.md`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`
- `docs/reports/task-03-completion.md`
- `pnpm-lock.yaml`
- `server/package.json`
- `server/src/app.module.ts`
- `server/src/common/filters/http-exception.filter.ts`
- `server/src/config/configuration.ts`
- `server/src/config/env.validation.ts`

未新增 migration；`server/src/database/migrations/` 仍只有 T02/T03 两条历史 migration。

## 3. 新增依赖

项目依赖实际变化：

- `server.dependencies`: 新增 `multer@2.0.2`
- `server.devDependencies`: 新增 `@types/multer@^1.4.12`

与任务文档差异：T04 文档预期只新增 `@types/multer`，并说明 runtime multer 由 Nest 平台包间接提供；当前实现显式加入了 runtime `multer`。这未造成验收失败，但属于文档差异。

## 4. 接口实现

已实现 4 个接口：

| 方法 | 路径 | 成功状态 | 验收结论 |
|---|---|---:|---|
| POST | `/api/knowledge-bases/:kbId/documents` | 202 | 通过 |
| GET | `/api/knowledge-bases/:kbId/documents` | 200 | 通过 |
| GET | `/api/documents/:id` | 200 | 通过 |
| DELETE | `/api/documents/:id` | 204 | 通过 |

响应 DTO 使用 `DocumentResponseDto.fromEntity()` 显式逐字段映射，只暴露：

`id`, `knowledgeBaseId`, `fileName`, `fileExt`, `fileSize`, `status`, `errorMessage`, `chunkCount`, `createdAt`, `updatedAt`。

上传、列表、详情响应均未暴露 `storagePath`、`fileHash`、`chunks`、`knowledgeBase` 或其他 relation 对象。

## 5. Multer 配置与文件校验

`DocumentModule` 使用 `MulterModule.registerAsync()`，由 `createDocumentUploadOptions()` 生成配置：

- 磁盘存储：`diskStorage`
- 临时目录：`{upload.dir}/.tmp`
- 临时文件名：`randomUUID() + ext`
- 文件字段名：`file`
- 大小限制：`MAX_FILE_SIZE_MB * 1024 * 1024`
- 文件过滤：扩展名 + MIME 双校验

文件类型规则：

| 扩展名 | 允许 MIME | 额外校验 |
|---|---|---|
| `.pdf` | `application/pdf` | 服务层读取前 5 字节，必须为 `%PDF-` |
| `.md` | `text/markdown`, `text/plain`, `application/octet-stream`, 空字符串 | 无 |
| `.txt` | `text/plain`, `application/octet-stream`, 空字符串 | 无 |

实际验收：

- 未传 `file`：400，`未上传文件`
- 不支持扩展名：415，`不支持的文件类型`
- MIME 与扩展名不匹配：415，`不支持的文件类型`
- 超过 20MB：413，`文件大小超出限制`
- 伪造 `.pdf` 且文件头不是 `%PDF-`：415，`文件内容与扩展名不符`
- 所有失败场景后 `.tmp` 均为空，最终目录文件数未增加
- 失败响应为统一异常结构，未返回原始 Multer 或文件系统错误

## 6. 存储与路径方案

当前 `.env.example`：

- `UPLOAD_DIR=./uploads`
- `MAX_FILE_SIZE_MB=20`

运行时 `configuration.ts` 将相对 `UPLOAD_DIR` 解析为 server 项目根下路径。验收环境中实际上传根目录为：

- `D:\Users\Documents\RAG\server\uploads`

目录布局：

```text
server/uploads/
├─ .tmp/
└─ {knowledgeBaseId}/
   └─ {uuid}.{pdf|md|txt}
```

验收时 KB `47` 成功上传后最终文件：

```text
4fdfefa8-be93-4e73-8ed1-6af2b6313c6b.md
62aae7f3-fe97-4656-a712-d9c31638abb1.pdf
c8312597-80b0-494b-aef7-92bb40835390.txt
ece03948-a61a-4e9c-ac20-393db13ffde2.txt
```

结论：

- 最终磁盘文件名均为 UUID，不含原始文件名
- `storage_path` 为相对路径，使用正斜杠，如 `47/62aae7f3-fe97-4656-a712-d9c31638abb1.pdf`
- API 响应不包含 `storagePath`
- 路径穿越请求 `filename=../escape.txt` 被 Multer 默认规整为 `escape.txt`，磁盘仍写入 UUID 文件，未发生路径穿越

## 7. SHA-256 与去重

`computeFileSha256()` 使用 `createReadStream()` + `crypto.createHash('sha256')` 流式计算，未全量 `readFileSync`。

去重策略：

- 应用层先查 `documentRepository.findOne({ kbId, fileHash })`
- 命中返回 409，响应 `details` 只含 `id`, `fileName`, `status`
- 数据库唯一约束 `uk_kb_hash(kb_id, file_hash)` 兜底并发
- `ER_DUP_ENTRY` 时删除本次已移动到最终目录的文件，再重查已有文档并返回 409

实际去重结果：

| 场景 | 实际状态码 | 结果 |
|---|---:|---|
| 同一文件再次上传到同一知识库 | 409 | `documentCount` 仍为 4，`.tmp` 为空，最终文件数仍为 4 |
| 同一文件上传到不同知识库 | 202 | KB2 `documentCount=1` |
| 5 个并发相同文件上传到新知识库 | 202, 409, 409, 409, 409 | 无 500，KB3 `documentCount=1`，最终目录 1 个文件 |

## 8. 文件系统与数据库补偿流程

上传补偿：

- KB 不存在、类型错误、PDF 文件头错误、重复文件：删除临时文件，不写 DB
- 移动失败：尝试删除临时文件，不写 DB
- 事务失败：删除最终文件；`ER_DUP_ENTRY` 转 409

删除补偿：

- 先查文档
- 事务内删除 `document`，并用 `GREATEST(document_count - 1, 0)` 递减知识库计数
- 事务提交后删除磁盘文件
- 磁盘文件已不存在时仍返回 204，DB 删除成功，并记录 warning

实际删除验收：

| 场景 | 实际状态码 | 结果 |
|---|---:|---|
| 删除存在文档 | 204 | body 0 字节，DB 行删除，磁盘文件删除，`documentCount` 4 -> 3 |
| 重复删除同一文档 | 404 | `documentCount` 未再次减少 |
| 手动提前删除磁盘文件后调用 DELETE | 204 | DB 行删除，body 0 字节，日志包含对应 `storagePath` warning |
| 3 个并发 DELETE 同一文档 | 204, 404, 404 | 无重复递减 |

## 9. 实际执行命令

| 命令 | 退出码 | 真实结果 |
|---|---:|---|
| `pnpm --filter server build` | 0 | `nest build` 成功 |
| `pnpm --filter web type-check` | 0 | `vue-tsc --noEmit` 成功 |
| `pnpm --filter server migration:show` | 1 | 首次连接到宿主机 `MySQL80`，返回 `ER_ACCESS_DENIED_ERROR` |
| `docker compose ps` | 1 | 首次 Docker daemon 未可用 |
| `docker compose ps` | 0 | 后续 Docker Desktop 恢复后，MySQL/Qdrant 均 `Up (healthy)` |
| `$env:DB_PORT='3307'; pnpm --filter server migration:show` | 0 | `[X] 2 InitSchema1784800736682`、`[X] 3 AddKnowledgeBaseNameUnique1784871996843` |
| 临时启动 `alpine/socat` 转发容器 | 0 | `localhost:3307 -> mysql:3306`，用于避免强停宿主机 `MySQL80` |
| 后端以临时 `DB_PORT=3307` 启动 | 0 | `/api/health` 返回 200，`db="up"` |

未执行 `migration:generate`；未生成无意义 migration。

## 10. 上传验收结果

| 验收项 | 实际结果 |
|---|---|
| PDF 上传成功 | 202，`fileName=sample.pdf`，`status=pending` |
| Markdown 上传成功 | 202，`fileName=notes.md`，`status=pending` |
| TXT 上传成功 | 202，`fileName=plain.txt`，`status=pending` |
| `chunkCount` | 成功上传均为 0 |
| `errorMessage` | 成功上传均为 null |
| `documentCount` | 0 -> 1 -> 2 -> 3；路径穿越文件上传后为 4 |
| 文件最终写入 | 通过，最终目录有 UUID 文件 |
| API 不含 `storagePath`/`fileHash` | 通过 |
| 原始文件名保存 | 普通文件名正确保存；`../escape.txt` 被 Multer 规整为 `escape.txt` |
| 路径穿越防护 | 通过，磁盘路径仍为 `{kbId}/{uuid}.txt` |

## 11. 查询验收结果

| 验收项 | 实际结果 |
|---|---|
| 文档列表 | 200 |
| 排序 | `createdAt DESC, id DESC` 通过 |
| 不存在知识库列表 | 404，`知识库不存在` |
| 文档详情 | 200 |
| `abc` / `0` / `-1` id | 均 400，`id 必须是正整数` |
| 不存在文档 | 404，`文档不存在` |
| 列表/详情敏感字段 | 无 `storagePath`、`fileHash`、`chunks`、`knowledgeBase` 或其他 relation |

## 12. 数据库查询结果

初始业务数据：

| 表 | 行数 |
|---|---:|
| `knowledge_base` | 0 |
| `document` | 0 |
| `document_chunk` | 0 |

成功上传后 `document` 查询结果：

| id | kb_id | file_name | file_ext | file_size | file_hash | storage_path | status | error_message | chunk_count |
|---:|---:|---|---|---:|---|---|---|---|---:|
| 68 | 47 | sample.pdf | pdf | 30 | fcc6a28174237ac624bc918f092d3cdd5eb95eed72290c8166e5241a54dd3c2a | 47/62aae7f3-fe97-4656-a712-d9c31638abb1.pdf | pending | null | 0 |
| 69 | 47 | notes.md | md | 20 | 752c044efe421f66cfb15f0248e7e89649215fc86353a44aeb063f82d3ee7a9e | 47/4fdfefa8-be93-4e73-8ed1-6af2b6313c6b.md | pending | null | 0 |
| 70 | 47 | plain.txt | txt | 18 | 9fd6d0b2904aaabe0455818ffcbbe215f602b48829584e9a415aee75b2ae3202 | 47/c8312597-80b0-494b-aef7-92bb40835390.txt | pending | null | 0 |
| 71 | 47 | escape.txt | txt | 22 | 2dc46770d0248da784c40bd8f4509b09442bf2e6957bccb3c9c8bb30bb2ff894 | 47/ece03948-a61a-4e9c-ac20-393db13ffde2.txt | pending | null | 0 |

去重和跨库上传后新增：

| id | kb_id | file_name | file_ext | file_size | storage_path | status | chunk_count |
|---:|---:|---|---|---:|---|---|---:|
| 72 | 48 | plain.txt | txt | 18 | 48/88f2f409-1db4-4379-816b-c171a688ee1a.txt | pending | 0 |
| 73 | 49 | concurrent-0.txt | txt | 25 | 49/ba09970e-d83f-4dd8-9b0a-fcf9941b3b0c.txt | pending | 0 |

`knowledge_base.document_count`：

| id | document_count |
|---:|---:|
| 47 | 4 |
| 48 | 1 |
| 49 | 1 |

唯一约束：

```text
document.uk_kb_hash(kb_id, file_hash), Non_unique=0
```

清理后：

| 表 | 行数 |
|---|---:|
| `knowledge_base`（T04 测试数据） | 0 |
| `document` | 0 |
| `document_chunk` | 0 |
| `migrations` | 2 |

Migration 记录保留：

```text
2  1784800736682  InitSchema1784800736682
3  1784871996843  AddKnowledgeBaseNameUnique1784871996843
```

## 13. 文件系统检查结果

验收后：

```text
server/uploads/
└─ .tmp/
```

结果：

- `.tmp` 为空
- KB `47`、`48`、`49` 的最终测试文件目录已清理
- 失败上传未留下临时文件
- 重复上传未留下临时文件或最终垃圾文件
- 超限上传未留下临时文件

## 14. Swagger 验收

| 项 | 结果 |
|---|---|
| `/api/docs` | 200，`text/html; charset=utf-8` |
| `/api/docs-json` | 200 |
| tags | `health`, `knowledge-bases`, `documents` |
| paths | `/api/health`, `/api/knowledge-bases`, `/api/knowledge-bases/{id}`, `/api/knowledge-bases/{kbId}/documents`, `/api/documents/{id}` |
| 上传接口 | `multipart/form-data`，`file` 为 `string/binary` |
| 未来接口 | 未出现 `processing`、`embedding`、`vector-store`、`chat`、`conversation` |

## 15. 未执行项

本次用户要求的并发上传和并发删除均已执行。

没有执行：

- `migration:generate`：本阶段无 schema 变化，且用户要求确认不生成无意义 migration。
- GUI 手工点击 Swagger UI：已通过 `/api/docs` HTML 与 `/api/docs-json` 结构化结果验收。

## 16. 与 task-04 文档的差异

1. 用户请求路径 `docs/tasks/task-04-document-management.md` 不存在；实际路径是 `docs/task-04-document-management.md`。
2. 当前实现显式新增 runtime `multer@2.0.2`，而任务文档预期只新增 `@types/multer`。
3. `document-upload.config.ts` 额外在 `fileFilter` 中复用 `ParsePositiveIntPipe` 校验 `kbId`，避免非法 `kbId` 请求落盘临时文件；这属于同阶段上传清理边界内的加固。
4. `DocumentService` 对 MySQL 死锁 `ER_LOCK_DEADLOCK` 做一次事务重试；这不是 T05 越界，属于并发上传稳定性补强。
5. 路径穿越文件名测试中，Multer 默认不保留路径，`../escape.txt` 在 `fileName` 中体现为 `escape.txt`。

## 17. 已知问题

1. **默认 DB 端口冲突**：当前 Windows `MySQL80` 占用 `localhost:3306`，导致默认 `.env` 下 CLI 和后端连接到错误实例。本次通过临时 `localhost:3307` 转发 Compose MySQL 完成验收。
2. **时间字段 8 小时偏移仍存在**：验收响应时间如 `2026-07-28T22:50:33.305Z`，与实际北京时间存在既有偏移；本次只验证排序相对顺序。
3. **`ParsePositiveIntPipe` 仍使用 `Number()`**：`abc`、`0`、`-1` 正确拒绝，但 `1e2`、`0x10` 等宽松数字语法仍是 T03 遗留问题。
4. **直接删除知识库不会清理磁盘目录**：本次清理先逐个删除 Document，再删除 KB，并手工清理测试目录。知识库级磁盘清理仍是后续生命周期一致性事项。
5. **Swagger Schema 仍描述 envelope 内的 data**：实际普通成功响应仍是 `{ code, message, data }`。

## 18. 是否存在越界实现

**不存在 T05/T06/T07/T08/T09/T10/T11/T12/T13/T14 越界业务实现。**

实际检查：

- 无 PDF/Markdown/TXT 内容提取
- 无文本清洗
- 无文本切片
- 无 `DocumentChunk` 写入
- 无 Embedding 服务或调用
- 无 Qdrant 客户端、collection、upsert、search 或删除调用
- 无文档状态自动流转，上传后保持 `pending`
- 无 Chat、SSE、Conversation API
- 无前端业务页面
- 无文件下载、预览、批量上传

现有 `DocumentChunk`、`Conversation`、`Message`、`MessageReference` 实体和 Qdrant Compose 服务属于 T01/T02 基础设施与数据模型，不构成本阶段越界。

## 19. 是否具备进入 T05 的条件

**代码层面具备，运行环境需先修复。**

理由：

- T04 四接口功能验收通过
- 文件校验、存储、去重、事务计数、删除补偿和 Swagger 均可用
- 无新增 migration，schema 状态稳定
- 无 T05 越界实现
- 测试数据、临时目录、最终文件已清理

进入 T05 前必须处理：

- 让项目默认数据库连接指向 Compose MySQL，或停止/改端口处理 Windows `MySQL80` 冲突
- 保留当前 T04 边界，T05 才开始解析、清洗、切片和 `DocumentChunk` 写入
