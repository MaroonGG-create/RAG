# T04 文档上传与文档管理 — Codex 执行指令

> 任务编号：T04（阶段 P4）
> 前置条件：T03 已完成（结论：**通过**，见 `docs/reports/task-03-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.1 / v1.2 / v1.3 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T03 后快照）+ `docs/reports/task-03-completion.md`
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T03 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**（status 枚举、uk_kb_hash 等已就绪） |
| `KnowledgeBase` 实体（含 `documentCount`、`uk_name`） | `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | 直接复用，禁止修改 |
| `ParsePositiveIntPipe` | `src/common/pipes/parse-positive-int.pipe.ts` | 所有 `:id` / `:kbId` 路径参数复用 |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | **允许小幅扩展**（§六.3），其余不动 |
| 统一响应拦截器 / `@SkipResponseWrap` | `src/common/interceptors/`、`src/common/decorators/` | 不动 |
| `DatabaseService` / DataSource | `src/database/` | 注入 DataSource 做事务 |
| migration 体系 | 4 条 pnpm 脚本 | **本任务无 schema 变更，不生成 migration** |
| Swagger | main.ts 已接入，`useGlobalPrefix: true`，`/api/docs` | 只追加 documents 相关声明 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T03 验收结论摘要**：4 接口全绿、并发重名 201/409 无 500、204 空体验证通过、Swagger paths 精确。遗留两个与 T04 相关的已知问题：

1. **时间字段 8 小时偏移**（MySQL 容器 UTC、连接未配 timezone）：T04 验收中 `createdAt` 排序断言只验证**相对顺序**，不断言绝对值；**本任务不修**（记入 T15）。
2. **ParsePositiveIntPipe 接受 `1e2`/`0x10` 等宽松数字**：见 §十二 可选加固项，非阻塞。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

实现 4 个接口：文档上传（multipart）、文档列表、文档详情、文档删除；含文件校验、UUID 存储、SHA-256 去重、documentCount 事务维护、补偿式清理。

### 2.2 非目标（本阶段一律不做）

PDF/MD/TXT 内容解析、文本清洗、切片、DocumentChunk 插入、Embedding、Qdrant、处理流水线、状态流转（上传后 status 恒为 `pending`）、Chat、SSE、会话接口、前端页面、文件下载/预览、多文件上传、软删除、鉴权。

**禁止模拟处理**：不允许 setTimeout 假装处理、不允许自动改状态、不允许造假 chunk。

---

## 三、API 契约（冻结级）

| # | 方法 | 路径 | 成功 | 说明 |
|---|---|---|---|---|
| 1 | POST | `/api/knowledge-bases/:kbId/documents` | **202** | multipart/form-data，文件字段名固定 `file` |
| 2 | GET | `/api/knowledge-bases/:kbId/documents` | 200 | KB 不存在 → 404 |
| 3 | GET | `/api/documents/:id` | 200 | 仅元数据 |
| 4 | DELETE | `/api/documents/:id` | **204** | 严格空响应体 |

`kbId` / `id` 均经 `ParsePositiveIntPipe`。

**202 的理由**（写进 Swagger description）：文件已接收、记录已创建（status=pending），后续阶段才异步解析向量化，请求已被接受但处理未完成。

### 3.1 DocumentResponseDto（上传/列表/详情三处复用，不另建 DTO）

| 字段 | TS 类型 | 来源/说明 |
|---|---|---|
| id | number | entity.id |
| knowledgeBaseId | number | **由 entity.kbId 映射改名** |
| fileName | string | 原始文件名（仅此处保存，磁盘不用） |
| fileExt | `'pdf' \| 'md' \| 'txt'` | 小写，无点 |
| fileSize | number | 字节 |
| status | `'pending'\|'parsing'\|'chunking'\|'embedding'\|'completed'\|'failed'` | 本阶段恒 `pending` |
| errorMessage | string \| null | 本阶段恒 null |
| chunkCount | number | 本阶段恒 0 |
| createdAt / updatedAt | string | `Date.toISOString()` |

- `static fromEntity(entity: Document): DocumentResponseDto`，**显式逐字段映射，禁止展开实体**。
- **禁止暴露**：`storagePath`、`fileHash`、`qdrantPointId`、任何 relation 对象。

### 3.2 错误响应与 details 约定

| 场景 | HTTP | body |
|---|---|---|
| 未上传文件 | 400 | `{ code: 400, message: '未上传文件' }` |
| 扩展名不支持 / MIME 与扩展名不匹配 / PDF 文件头不符 | **415** | `{ code: 415, message: '不支持的文件类型' }` 或 `'文件内容与扩展名不符'` |
| kbId/id 非法 | 400 | `{ code: 400, message: 'id 必须是正整数' }` |
| 知识库不存在 | 404 | `{ code: 404, message: '知识库不存在' }` |
| 文档不存在 | 404 | `{ code: 404, message: '文档不存在' }` |
| 同库重复文件 | 409 | `{ code: 409, message: '同一知识库已存在相同文件', details: { id, fileName, status } }` |
| 文件超限 | 413 | `{ code: 413, message: '文件大小超出限制' }` |

**决策（v1.3 已回填基线）**：类型错误统一 **415**（全项目一致，不与 400 混用）；409 的 `details` 依赖 §六.3 的过滤器小幅扩展，**不暴露 fileHash/storagePath**。

---

## 四、文件校验规则（冻结级）

### 4.1 扩展名 + MIME 双重校验（fileFilter 中执行）

| 扩展名（小写） | 允许的 MIME | 额外校验 |
|---|---|---|
| `.pdf` | `application/pdf` 仅此一种 | 落盘后检查前 5 字节为 `%PDF-`（§七 步骤 2） |
| `.md` | `text/markdown`、`text/plain`、`application/octet-stream`、空字符串 | 无 |
| `.txt` | `text/plain`、`application/octet-stream`、空字符串 | 无 |

**设计理由（写进代码注释与汇报）**：

- `application/octet-stream` 与空 MIME 对 md/txt **必须接受**：Windows Chrome/Edge 对 `.md` 经常上报空串或 octet-stream，文本格式本无可靠 MIME 注册；拒绝会误伤正常文件。文本类文件的真实校验由后续 T05 解析阶段兜底。
- `.pdf` 拒绝 octet-stream：PDF 有 `%PDF-` 魔数可做内容级校验，收紧 MIME 不会误伤。
- 扩展名从 `file.originalname` 用 `path.extname().toLowerCase()` 提取；不信任浏览器 MIME 作为唯一依据，也不允许扩展名绕过。

### 4.2 其他校验

- 大小：Multer `limits.fileSize = MAX_FILE_SIZE_MB × 1024 × 1024`（超限由 MulterError → 413，见 §六.3）。
- 缺文件：Controller 判空 → 400。
- 本阶段**不做**编码检测、内容深度检查。

---

## 五、文件存储设计（冻结级）

### 5.1 目录布局

```
{UPLOAD_DIR}/
├─ .tmp/                  # Multer 落盘临时目录
└─ {knowledgeBaseId}/     # 按库分目录
   └─ {uuid}.{ext}        # 最终文件，UUID 命名
```

### 5.2 路径解析（不依赖 process.cwd()）

- `configuration.ts` 新增 `upload` 段：
  - `UPLOAD_DIR` 为绝对路径 → 直接使用；
  - 相对路径 → `resolve(__dirname, '../..', UPLOAD_DIR)`。**原理（写注释）**：`configuration.ts` 位于 `src/config/`，编译后位于 `dist/config/`，两者向上两级都是 server 项目根，因此 src 运行与 dist 运行解析结果一致，与执行命令的 cwd 无关。
- 解析结果（绝对路径）放入 `upload.dir`，业务代码只读 `configService.get('upload.dir')`，**禁止在业务代码中拼写死路径**。
- `storagePath` 保存**相对 UPLOAD_DIR 的相对路径**，格式固定为 `{kbId}/{uuid}.{ext}`，**手工用正斜杠拼接**（Windows 反斜杠会进数据库造成跨平台不一致）；读取时用 `path.join(uploadDir, storagePath)` 还原。
- 原始文件名只进 `document.fileName`；磁盘文件名 = Multer filename 回调生成的 `${randomUUID()}${ext}`。**用户输入的任何字符串（文件名、kbId）不直接拼路径**：kbId 经正整数管道验证后才允许进目录名——这是路径穿越的根本防线，加注释说明。
- 目录不存在时 `fs.mkdir(..., { recursive: true })` 自动创建（tmp 目录在 Multer destination 回调中确保，kb 目录在移动前确保）。

---

## 六、上传处理流程（补偿式，冻结顺序）

### 6.1 主流程（Service.upload）

```
Multer 落盘 {UPLOAD_DIR}/.tmp/{uuid}{ext}
  │
  1. KB 存在性检查（kbRepo.findOne）
       不存在 → 删 tmp → 404
  2. 扩展名为 pdf 时读文件头 5 字节校验 %PDF-
       不符 → 删 tmp → 415 '文件内容与扩展名不符'
  3. 流式 SHA-256（crypto + createReadStream，见 §八）
  4. 应用层去重：docRepo.findOne({ where: { kbId, fileHash } })
       命中 → 删 tmp → 409 + details
  5. 确保 {UPLOAD_DIR}/{kbId}/ 存在，将 tmp 移动（fs.rename，跨设备失败时 copy+unlink 兜底并注释）
       移动失败 → 尝试删 tmp → 抛出，不写库
  6. DataSource.transaction(manager => {
       saved = manager.save(Document, { kbId, fileName: originalname, fileExt, fileSize,
                 fileHash, storagePath, status: 'pending', chunkCount: 0, errorMessage: null })
       manager.increment(KnowledgeBase, { id: kbId }, 'documentCount', 1)
       return saved
     })
     失败 → 删最终文件（失败仅告警日志）→ 按 §6.2 分类抛出
  7. Logger.log 记录 documentId/kbId/fileSize → 返回 DocumentResponseDto
```

### 6.2 失败补偿矩阵（必须在代码注释中体现）

| 失败点 | 临时文件 | 最终文件 | DB | 对外结果 |
|---|---|---|---|---|
| KB 不存在 / 类型校验失败 / 去重命中 | 删除 | 未产生 | 无写入 | 404 / 415 / 409 |
| 移动失败 | 尝试删除 | 未产生 | 无写入 | 500 |
| 事务内 `ER_DUP_ENTRY`（并发同文件） | 已清理 | **删除** | 回滚 | 409 + details（重新查询已有文档填充） |
| 事务内其他错误 | 已清理 | **删除** | 回滚 | 原样抛出（过滤器兜底 500） |

核心原则（写进汇报）：**文件系统无事务，用"先文件后库、失败删文件"的补偿顺序；任何路径下 tmp 不残留；绝不出现"DB 有记录但文件从未落盘"的正常路径**（文件先就位再开事务）。

### 6.3 全局过滤器的小幅扩展（本任务唯一允许修改的 common 文件）

`http-exception.filter.ts` 追加两处，其余逻辑逐行不动：

1. **HttpException 分支**：`getResponse()` 为对象时，透传 `message` 与**可选的 `details` 字段**（只透传这两个键，禁止整包展开）。用途：409 返回已有文档摘要。无 details 时输出与现状完全一致（T03 全部用例必须回归）。
2. **新增 MulterError 分支**（置于未知异常分支之前）：`error instanceof MulterError` → `code === 'LIMIT_FILE_SIZE'` 时返回 **413** `{ code: 413, message: '文件大小超出限制' }`；其余 MulterError 返回 **400** `{ code: 400, message: '文件上传失败' }`，服务端日志记录原始 code。MulterError 从 `multer` 包 import。

**理由（写入汇报）**：FileInterceptor 抛出的 MulterError 非 HttpException，现状会落入未知分支变 500；两处扩展是契约要求的最小改动，不构成"第二套异常结构"。

---

## 七、SHA-256 去重

- 实现：`src/modules/document/utils/file-hash.util.ts`，导出 `computeFileSha256(filePath: string): Promise<string>`。
- 必须**流式**：`createReadStream` 管道进 `crypto.createHash('sha256')`，禁止 `readFileSync` 全量读入（20MB 上限下也要保持该实现，注释说明理由）。
- 只用 Node 内置 `crypto`/`fs`，不新增依赖。
- 两层去重：
  1. 应用层 `findOne({ kbId, fileHash })` → 409 + details；
  2. DB 唯一约束 `uk_kb_hash(kb_id, file_hash)` 并发兜底 → 事务捕获 `ER_DUP_ENTRY`（判定方式同 T03：`QueryFailedError` + `driverError.code`）→ 删最终文件 → 重查已有文档 → 409 + details。**绝不允许 500**。
- 同一文件跨知识库上传：合法成功（uk 含 kb_id）。

---

## 八、删除流程（冻结顺序）

```
Service.remove(id):
  1. docRepo.findOne({ where: { id } }) → null → 404 '文档不存在'
  2. dataSource.transaction(manager => {
       res = manager.delete(Document, { id })
       res.affected === 0 → throw NotFoundException('文档不存在')   // 并发重复删除防线
       manager.createQueryBuilder().update(KnowledgeBase)
         .set({ documentCount: () => 'GREATEST(document_count - 1, 0)' })
         .where('id = :kbId', { kbId: doc.kbId }).execute()
     })
  3. 事务提交后删除磁盘文件（storage.deleteByStoragePath）
       文件不存在或删除失败 → Logger.warn（含 storagePath 与错误摘要），不回滚 DB，接口仍 204
  4. 中文注释占位：T08+ 将在第 2 步之前插入 Qdrant 向量清理（先向量→后 MySQL→再磁盘）
```

- **并发语义**：两个并发删除，一个 `affected=1` 走完全程，另一个 `affected=0` → 404，计数只减一次。不引入行锁（`affected` 检查已足够，加注释说明取舍）。
- `GREATEST(..., 0)` 防负计数（计数漂移的兜底，正常路径不会触发，加注释）。

---

## 九、documentCount 事务维护

- **选型：`DataSource.transaction(async manager => {...})`**。理由：回调式自动 commit/rollback，比手动 QueryRunner（connect/startTransaction/commit/rollback/release 五步）代码少一半、不易漏 release；EntityManager 由回调注入，无需手动创建。个人 MVP 选可读性最高的方案。
- 上传：`save(Document)` 与 `increment(KnowledgeBase, 'documentCount')` 同一事务。
- 删除：`delete(Document)` + affected 检查与计数递减同一事务。
- 禁止：Controller 维护计数、先提交 Document 再单独更新计数。

---

## 十、NestJS 与 Multer 配置

- 在 `DocumentModule` 用 `MulterModule.registerAsync({ inject: [ConfigService], useFactory })`：
  - `storage: diskStorage({ destination: 确保 {upload.dir}/.tmp 存在后写入, filename: (req, file, cb) => cb(null, randomUUID() + ext) })`；
  - `limits: { fileSize: maxFileSizeMb * 1024 * 1024 }`；
  - `fileFilter`：执行 §4.1 规则，不接受时 `cb(new UnsupportedMediaTypeException('不支持的文件类型'), false)`（HttpException 子类可直达全局过滤器，415 生效）。
- Controller 用 `@UseInterceptors(FileInterceptor('file'))` + `@UploadedFile() file?: Express.Multer.File`，`!file` → `BadRequestException('未上传文件')`。
- **依赖核查**：`multer` 运行时由 `@nestjs/platform-express` 自带（不单独安装）；需新增 devDependency **`@types/multer@^1.4.12`**（否则 `Express.Multer.File` 无类型）。
- 临时文件名不含用户原始名；fileFilter 先于 filename 执行，ext 已验证。
- 禁止 `MemoryStorage`。

---

## 十一、模块与文件设计

### 11.1 新增文件（server/，8 个）

| 文件 | 职责 |
|---|---|
| `src/modules/document/document.module.ts` | 装配：`TypeOrmModule.forFeature([Document, KnowledgeBase])` + `MulterModule.registerAsync` + 两个 controller + service + storage service |
| `src/modules/document/knowledge-base-documents.controller.ts` | `@Controller('knowledge-bases/:kbId/documents')`：POST 上传（FileInterceptor）、GET 列表。**独立 controller 是因为基础路径不同**，无法用单 controller |
| `src/modules/document/document.controller.ts` | `@Controller('documents')`：GET `:id` 详情、DELETE `:id` |
| `src/modules/document/document.service.ts` | 全部业务编排：上传主流程、去重、事务、计数、删除编排；私有方法允许（如 `assertKnowledgeBaseExists`），禁止 BaseService |
| `src/modules/document/storage/document-storage.service.ts` | 文件系统操作：确保目录、tmp→final 移动、按 storagePath 删除、静默清理（catch 后仅告警日志）；**所有路径操作只认 upload.dir + storagePath** |
| `src/modules/document/storage/document-upload.config.ts` | Multer 异步配置工厂 + §4.1 的扩展名/MIME 规则表（导出常量供 fileFilter 使用） |
| `src/modules/document/utils/file-hash.util.ts` | `computeFileSha256()`（§七） |
| `src/modules/document/dto/document-response.dto.ts` | §3.1 DTO + `fromEntity` + Swagger 装饰器 |

> 规模判断：`storage/` 与 `utils/` 保留（职责确实独立：文件系统 vs 配置 vs 纯函数），除此之外不再细分目录。

### 11.2 修改文件（server/ 4 个 + 根 2 个）

| 文件 | 修改内容 |
|---|---|
| `src/app.module.ts` | imports 追加 `DocumentModule`（KnowledgeBaseModule 之后） |
| `src/common/filters/http-exception.filter.ts` | §六.3 两处扩展（details 透传 + MulterError 分支），其余不动 |
| `src/config/configuration.ts` | 新增 `upload.dir`（§5.2 解析逻辑+注释）、`upload.maxFileSizeMb`（Number 转换） |
| `src/config/env.validation.ts` | 新增 `UPLOAD_DIR`（IsString + IsNotEmpty）、`MAX_FILE_SIZE_MB`（IsInt + Min(1) + Max(1024)） |
| `.env.example` | 追加 `UPLOAD_DIR=./uploads`、`MAX_FILE_SIZE_MB=20`（含注释） |
| `README.md` | documents 四接口 curl 速查 + uploads 目录说明 |
| `server/package.json` | devDependencies 加 `@types/multer` |

**禁止改动**：`web/` 任何文件、6 个实体、既有 migration（**本任务零 migration**）、main.ts、DatabaseService、knowledge-base 模块全部文件、`docker-compose.yml`。`.gitignore` 检查：`uploads/` 应已忽略（T01 已配置，确认即可不修改）。

---

## 十二、可选加固项（不阻塞验收）

`ParsePositiveIntPipe` 宽松数字问题（T03 报告已知问题 #2）：**可选**改为 `/^\d+$/` 正则前置 + `Number.isSafeInteger` 检查。若执行，必须回归 T03 的 `abc/0/-1` 用例与知识库正常接口；不执行则在汇报"已知问题"中声明遗留。

---

## 十三、Swagger 方案

- 只新增 documents 相关：`@ApiTags('documents')` 两个 controller。
- 上传接口：`@ApiConsumes('multipart/form-data')` + `@ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })` + `@ApiAcceptedResponse`（202）+ 400/404/409/413/415 响应装饰器。
- 列表/详情 `@ApiOkResponse`（`type: [DocumentResponseDto]` / 单体型），删除 `@ApiNoContentResponse`。
- 完成后 docs-json 应含 tags：health、knowledge-bases、documents；**禁止出现** processing/embedding/vector-store/chat/conversations。

---

## 十四、日志设计（NestJS Logger，不引新框架）

| 时机 | 级别 | 内容 |
|---|---|---|
| 上传成功 | log | documentId、knowledgeBaseId、fileSize |
| 重复文件 | log | knowledgeBaseId、已有 documentId |
| tmp/最终文件清理失败 | warn | 相对路径 + 错误摘要 |
| 删除时磁盘文件缺失/失败 | warn | storagePath + 错误摘要 |
| 事务失败 | error | documentId（若已生成）、错误摘要（不回传客户端） |

**禁止记录**：文件内容、DB 密码、API Key、绝对路径（日志统一用 storagePath 相对路径）、完整堆栈给客户端。

---

## 十五、实现顺序（严格按序）

1. `@types/multer` 安装；`.env.example`/`env.validation.ts`/`configuration.ts` 三处环境变量落地；本地 `.env` 同步加两个变量。
2. 过滤器两处扩展 → 回归 T03 用例（409/404/400 结构不变）。
3. `file-hash.util.ts` → `document-upload.config.ts` → `document-storage.service.ts`。
4. `document-response.dto.ts` → `document.service.ts` → 两个 controller → module → app.module 注册。
5. `pnpm --filter server build` 0 error。
6. Swagger 声明核对（docs-json）。
7. 执行 §十六全量验收；README 更新；可选加固项（如选择执行）。

## 十六、验收命令（Windows PowerShell 可执行）

> 前置：mysql/qdrant healthy；`.env` 已含 `UPLOAD_DIR`/`MAX_FILE_SIZE_MB`；后端运行中。
> **编码注意**：PowerShell 管道传中文会乱码（T03 已踩坑）。测试文件名与 KB 名用 ASCII；含中文的 body 写入 UTF-8 临时文件用 `--data-binary @file` 发送，或改用 Node fetch 脚本。

```powershell
# 0. 静态检查（本任务无新 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending

# 1. 准备：建两个测试知识库，记录返回 id（此处假设 KB1=1, KB2=2，按实际替换）
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"doc-test-kb1\"}"
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"doc-test-kb2\"}"

# 2. 准备测试文件（在仓库根新建 tmp-test/ 目录）
mkdir tmp-test -Force
# 合法 PDF（含真实魔数）
[System.IO.File]::WriteAllText("$PWD\tmp-test\sample.pdf", "%PDF-1.4`nfake pdf body for t04")
[System.IO.File]::WriteAllText("$PWD\tmp-test\notes.md", "# T04 Markdown`nhello")
[System.IO.File]::WriteAllText("$PWD\tmp-test\plain.txt", "plain text content")
# 假 PDF（魔数错误）
[System.IO.File]::WriteAllText("$PWD\tmp-test\fake.pdf", "NOT-A-PDF content")
# 不支持的类型
[System.IO.File]::WriteAllText("$PWD\tmp-test\evil.exe", "MZ fake")
# 21MB 超限文件（用 .txt 避开 PDF 魔数干扰）
fsutil file createnew tmp-test\big.txt 22020096

# 3. 三种类型上传成功（KB1）
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\sample.pdf"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\notes.md"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\plain.txt"
# 预期：均 HTTP 202；data 含 id/knowledgeBaseId=1/fileName/fileExt/fileSize/
#       status="pending"/errorMessage=null/chunkCount=0/createdAt/updatedAt；
#       响应中不存在 storagePath、fileHash 字段

# 4. documentCount 与文件落盘核对
curl.exe http://localhost:3000/api/knowledge-bases/1
# 预期：data.documentCount=3
Get-ChildItem server\uploads\1
# 预期：3 个文件，文件名为 UUID 格式（无原始文件名），扩展名正确
Get-ChildItem server\uploads\.tmp
# 预期：空目录
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,kb_id,file_name,file_ext,status,chunk_count,storage_path FROM document;"
# 预期：3 行；status=pending；storage_path 形如 1/xxxxxxxx-xxxx....pdf（正斜杠相对路径）

# 5. 校验类错误
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents
# 预期：400 {"code":400,"message":"未上传文件"}
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\evil.exe"
# 预期：415 {"code":415,"message":"不支持的文件类型"}
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\fake.pdf"
# 预期：415 {"code":415,"message":"文件内容与扩展名不符"}
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\big.txt"
# 预期：413 {"code":413,"message":"文件大小超出限制"}（不得为 500）
curl.exe -X POST http://localhost:3000/api/knowledge-bases/99999/documents -F "file=@tmp-test\plain.txt"
# 预期：404 {"code":404,"message":"知识库不存在"}
Get-ChildItem server\uploads\.tmp   # 预期：上述错误后仍为空目录

# 6. 去重
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\plain.txt"
# 预期：409 {"code":409,"message":"同一知识库已存在相同文件","details":{"id":<已有id>,"fileName":"plain.txt","status":"pending"}}
curl.exe http://localhost:3000/api/knowledge-bases/1
# 预期：documentCount 仍为 3（未增加）
curl.exe -X POST http://localhost:3000/api/knowledge-bases/2/documents -F "file=@tmp-test\plain.txt"
# 预期：202（跨库允许）

# 7. 并发同文件上传（Node 脚本，保存为 tmp-test\concurrent-upload.mjs 后 node 执行）：
#    对 KB2 同时发 5 个相同文件上传
#    预期：恰好 1 个 202，其余 4 个 409，无 500；KB2 documentCount=2；
#    server\uploads\2 只有 2 个文件；.tmp 为空

# 8. 列表与详情
curl.exe http://localhost:3000/api/knowledge-bases/1/documents
# 预期：200；createdAt DESC、id DESC；每项严格为契约 10 字段
curl.exe http://localhost:3000/api/knowledge-bases/99999/documents   # 404
curl.exe http://localhost:3000/api/documents/<存在的id>               # 200 元数据
curl.exe http://localhost:3000/api/documents/abc                      # 400
curl.exe http://localhost:3000/api/documents/0                        # 400
curl.exe http://localhost:3000/api/documents/-1                       # 400
curl.exe http://localhost:3000/api/documents/99999                    # 404

# 9. 删除
curl.exe -i -X DELETE http://localhost:3000/api/documents/<id>
# 预期：204，0 字节 body，无 Content-Type: application/json
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM document WHERE id=<id>;"
# 预期：0
Test-Path server\uploads\1\<对应文件名>    # 预期：False
curl.exe http://localhost:3000/api/knowledge-bases/1   # documentCount 已减 1
curl.exe -i -X DELETE http://localhost:3000/api/documents/<同一id>   # 404，计数不再减

# 10. 磁盘文件意外丢失的容错：手动删除 server\uploads\1 下某文件后调用 DELETE
# 预期：仍 204，DB 记录删除，后端日志出现 warn（含 storagePath）

# 11. 并发删除（Node 脚本）：对同一文档同时发 3 个 DELETE
# 预期：1 个 204，2 个 404；documentCount 只减 1

# 12. Swagger
curl.exe http://localhost:3000/api/docs-json
# 预期：paths 含 /api/knowledge-bases/{id}/documents 与 /api/documents/{id}；
#       上传接口为 multipart + binary file；不含 chat/processing/conversations

# 13. 清理
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/1
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/2
Remove-Item -Recurse -Force tmp-test, server\uploads\1, server\uploads\2 -ErrorAction SilentlyContinue
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM knowledge_base; SELECT COUNT(*) FROM document;"
# 预期：均为 0；migrations 表仍为 2 条
```

> 说明：KB 删除时磁盘目录清理属知识库级联删除范畴（T08 完善），本任务验收后手工清理 `uploads/{kbId}` 目录即可，不作为缺陷。

## 十七、明确禁止（本任务一律不实现）

PDF/MD/TXT 文本提取、清洗、切片、DocumentChunk 插入、Embedding、Qdrant（含 collection）、文档状态自动流转、处理重试接口、Chat、SSE、会话接口、前端页面、Vue Router、Pinia、文件下载/预览接口、多文件批量上传、文件覆盖/版本管理、软删除、鉴权、BaseService/CRUD 生成器、消息队列、定时任务、假数据/假进度、Testcontainers、新 migration、修改既有 migration 与任何实体、修改 `web/`。

## 十八、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① 补偿式事务顺序与失败矩阵 ② ER_DUP_ENTRY 并发兜底与最终文件清理 ③ 过滤器两处扩展及 T03 回归结论 ④ 路径解析为何与 cwd 无关 ⑤ 事务选型理由。
3. **启动方式**：含新增环境变量的准备步骤。
4. **验证方式**：§十六逐条结果（成功/失败 + 关键输出；并发两项须附真实状态码分布）。
5. **已知问题**：含时间偏移、ParsePositiveIntPipe（若未加固）等遗留声明。
6. **未完成内容**：明确声明 §十七各项均未实现。
