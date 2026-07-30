# Mini RAG 当前项目实际实现总结

> 审计日期：2026-07-24  
> 代码基线：当前工作区 `HEAD=d0ccdd9`（`feat: 文件上传`）  
> 审计方式：只读扫描仓库源码、两个 `package.json`、`pnpm-lock.yaml`、环境变量样例、Docker Compose、实体、migration、Controller、Service、DTO、公共模块及现有设计/完成文档；本次未启动服务、未查询实时数据库、未执行 lint、format 或 test。  
> 结论规则：以当前代码为最高依据。历史报告中的“当时运行结果”只作为历史证据，不等同于本次已复验的当前运行状态。

# 1. 项目当前状态概览

## 1.1 项目要解决的问题

这个项目最终要做一个单机版 Mini RAG 知识库：用户把 PDF、Markdown、TXT 文档上传到指定知识库，系统解析并切片后生成向量写入 Qdrant；提问时按知识库召回相关切片，组装上下文调用 LLM，通过 SSE 流式返回答案，并保存会话、消息和引用来源。目标边界见 `docs/00-overall-plan.md` 的 MVP、入库流水线和问答流水线。

当前代码已经完成“工程底座 + 关系库模型 + 知识库管理 + 文档接收和元数据管理”，但还没有执行任何文本解析、切片、Embedding、向量写入、检索或生成。换句话说，系统现在能按配置受控接收文件并登记为 `pending`，还不能让文件内容真正参与问答。

## 1.2 当前代码可确认的真实操作

代码层面已经存在以下操作路径；它们不等于本次已做运行验收：

- Vue 首页可以发起后端与 MySQL 健康检查，并展示 `status/db/uptime`。入口为 `web/src/views/HomePage.vue` 的 `handleCheck()`，请求封装在 `web/src/api/health.ts` 和 `web/src/api/http.ts`。
- 后端提供知识库创建、列表、详情、删除四个接口。入口为 `server/src/modules/knowledge-base/knowledge-base.controller.ts`，业务逻辑在 `KnowledgeBaseService`。
- 后端提供单文件上传、指定知识库文档列表、文档元数据详情、文档删除四个接口。入口为 `server/src/modules/document/knowledge-base-documents.controller.ts` 和 `server/src/modules/document/document.controller.ts`，业务逻辑在 `DocumentService`。
- 上传支持 PDF、Markdown、TXT，包含大小上限、扩展名/MIME 校验、PDF 文件头检查、UUID 磁盘命名、流式 SHA-256、同库内容去重、数据库事务、`documentCount` 维护和失败补偿。关键实现位于 `server/src/modules/document/storage/document-upload.config.ts`、`document.service.ts`、`document-storage.service.ts`、`utils/file-hash.util.ts`。
- MySQL 的六个业务实体及两条 migration 已写入代码；普通成功响应、异常响应、Swagger 和为未来 SSE 预留的“不包装”机制也已接入。依据为 `server/src/database/`、`server/src/common/` 和 `server/src/main.ts`。

当前前端只实现健康检查，没有知识库、文档、对话页面，也没有对应的前端 API 封装。当前业务接口只能通过 Swagger、curl 或其他 API 客户端直接使用，依据为 `web/src/` 的现有文件范围。

## 1.3 阶段判断

| 阶段 | 当前判断 | 一句话总结 | 主要代码依据 |
|---|---|---|---|
| T01 | 已实际实现，存在配置遗留问题 | pnpm workspace、Vue/Nest 骨架、MySQL/Qdrant Compose 和前后端健康检查链路已搭好。 | `pnpm-workspace.yaml`、`docker-compose.yml`、`server/src/modules/health/`、`web/src/views/HomePage.vue` |
| T02 | 已实际实现基础能力；未来表目前仅有模型 | 六个实体、migration、数据库初始化、统一响应/异常已落地，但 `document_chunk` 和会话相关表还没有业务写入。 | `server/src/database/`、`server/src/common/`、六个实体文件 |
| T03 | 已实际实现 | 四个知识库接口、名称 trim、应用预检和数据库唯一约束并发兜底均已实现。 | `server/src/modules/knowledge-base/`、`1784871996843-AddKnowledgeBaseNameUnique.ts` |
| T04 | 后端代码已实际实现；项目文档和验收记录未完全收口 | 四个文档接口及上传、存储、哈希去重、事务计数和补偿清理已经落地，上传后只停在 `pending`。 | `server/src/modules/document/` |

当前没有进入“可工作的 RAG 核心链路”。如果把“上传”视为入库入口，则只完成了入口；从文本解析开始的核心步骤全部没有可执行实现。

## 1.4 完成度估算

以下百分比是按“可交付能力”估算，不按代码行数计算，也不代表测试覆盖率：

| 维度 | 估算 | 估算口径 |
|---|---:|---|
| 工程基础完成度 | 约 85% | T01/T02 的 workspace、配置、数据库、migration、统一 HTTP、Swagger 和基础设施已具备；扣除 cwd 依赖、非 root 数据库用户、测试、完整容器化和生产配置。 |
| 普通业务功能完成度 | 约 75% | 后端知识库和文档管理的 8 个计划接口均存在；扣除知识库删除不清磁盘、无分页/重试/前端业务操作、会话接口仍为空白。 |
| RAG 核心功能完成度 | 可用闭环 0%，基础准备约 10% | 已有上传入口、状态字段、`document_chunk`/引用表结构、Qdrant 容器和 SSE 包装豁免；解析到回答的任何一段都不能运行。 |
| 前端页面完成度 | 约 10% | 只有应用壳、Ant Design 样式、Axios 和健康检查页；计划中的知识库、文档、对话及引用页面均不存在。 |

如果按“工程 20% + 普通管理 20% + RAG 核心 45% + 前端 15%”加权，并在 RAG 项上采用“基础准备 10%”而不是“可用闭环 0%”，整体约为 **38%**；若只计可运行的 RAG 闭环，则约为 **34%**。本文用 38% 表达“已有可复用底座”，不表示系统已经能进行 RAG 问答。

## 1.5 实现状态分类

- **已实际实现**：T01 工程骨架与健康检查、T02 数据库/公共能力、T03 知识库管理、T04 后端文档接收与管理。
- **部分实现**：Qdrant 只有容器和 URL 校验；SSE 只有响应包装排除机制；`DocumentChunk`、Conversation、Message、MessageReference 只有实体和表；文档处理状态只有枚举及初始 `pending`。
- **已设计但未实现**：解析、清洗、切片、Embedding、Qdrant collection/upsert、检索、上下文、LLM、SSE、引用、会话和完整前端，设计集中在 `docs/00-overall-plan.md`。
- **尚未开始可执行代码**：processing、embedding、vector-store、chat/conversation 的 Module/Controller/Service，以及前端知识库/文档/对话页面。仓库中没有这些运行模块、客户端依赖或调用入口。

## 1.6 任务文档、完成报告与实际代码的差异

| 文档表述 | 当前代码事实 | 判定 |
|---|---|---|
| `docs/01-current-implementation.md` 头部仍标记提交 `d99e8ce`、T03 完成后，并明确写“T04 未实现”。 | 当前 `HEAD` 为 `d0ccdd9`；`AppModule` 已注册 `DocumentModule`，四个文档接口及完整后端实现均存在。 | 实现快照已过期，不能作为当前阶段结论。 |
| 同一快照写 Swagger 只暴露 health 和 knowledge-bases。 | 当前共有四个 Controller：Health、KnowledgeBase、KnowledgeBaseDocuments、Document；后两个共用 `documents` tag，并暴露文档上传、列表、详情和删除路径。 | 历史事实，当前不成立。 |
| `docs/reports/task-02-completion.md` 中有“单条 migration、T03 未开始”等阶段性结论。 | 当前已有第二条唯一索引 migration，T03/T04 均有代码。 | T02 历史报告，不能覆盖当前代码。 |
| `docs/reports/task-03-completion.md` 中有“文档上传不存在”等结论。 | 当前文档模块已实现。 | T03 历史报告，只能证明当时验收。 |
| `docs/01-current-implementation.md` 和 T03 报告曾写总体方案仍是 `idx_name`、未回填 v1.2。 | 当前 `docs/00-overall-plan.md` 已写 `uk_name`，并包含 v1.2、v1.3 修订。 | 这些“文档漂移”描述本身也已过期。 |
| `docs/task-04-document-management.md` 说 Multer 由平台包自带、不单独安装。 | `server/package.json` 当前直接依赖 `multer: 2.0.2`。 | 小幅实现差异；实际运行依赖以 package 为准。 |
| 总体方案的完整上传流水线包含“上传后异步触发解析”。 | T04 代码只保存 `pending`，没有触发处理器。 | 总体方案是目标架构，不能写成当前能力。 |
| 仓库有 T02、T03 完成报告。 | 没有 `docs/reports/task-04-completion.md`，也没有测试文件。 | T04 的当前运行验收结果无法从仓库确认。 |

# 2. 当前系统架构

## 2.1 已存在的组成

| 组成 | 当前实际角色 | 是否进入业务链路 | 代码/配置依据 |
|---|---|---|---|
| Vue 3 前端 | 单页应用壳和健康检查页面 | 仅健康检查 | `web/src/App.vue`、`web/src/views/HomePage.vue` |
| NestJS 后端 | HTTP 入口、参数校验、业务服务、Swagger、统一响应/异常 | 是 | `server/src/main.ts`、`server/src/app.module.ts` |
| MySQL 8 | 保存六类关系数据；当前业务代码实际读写知识库和文档 | 是 | `docker-compose.yml`、`server/src/database/`、各实体和 Service |
| Qdrant 1.12.4 | Compose 启动的向量库基础设施 | 否；后端无客户端、collection 或请求 | `docker-compose.yml`、`server/package.json` |
| Docker Compose | 当前只编排 MySQL 和 Qdrant，带数据卷、健康检查和网络 | 基础设施层 | `docker-compose.yml` |
| pnpm workspace | 在一个仓库管理 `server`、`web` 两个 package | 是 | `pnpm-workspace.yaml`、两个 `package.json`、`pnpm-lock.yaml` |
| 磁盘文件系统 | 临时接收上传并按知识库保存最终 UUID 文件 | 是 | `server/src/modules/document/storage/` |

当前 Compose **不包含** server/web 服务，也没有 Dockerfile。开发时是“容器跑存储，本机 Node 进程跑前后端”，与总体方案中未来 T17 的四服务交付架构不同。

## 2.2 普通请求的实际调用关系

前端目前只有健康接口真正走这条链路：

```text
浏览器 HomePage
  → Axios（baseURL=/api）
  → Vite dev proxy（/api → http://localhost:3000，不改写路径）
  → NestJS HealthController
  → HealthService
  → DatabaseService.ensureReady()
  → TypeORM DataSource
  → MySQL（runMigrations + SELECT 1）
  → ResponseInterceptor
  → Axios 响应拦截器解包 data
  → Vue 页面展示
```

知识库和文档接口的实际后端关系是：

```text
Swagger / curl / 其他 API 客户端
  → NestJS Controller
  → 全局 Pipe / 路由 Pipe
  → Service
  → TypeORM Repository 或 DataSource.transaction()
  → MySQL
  → Response DTO
  → ResponseInterceptor
  → HTTP JSON
```

Vue 前端还没有调用知识库或文档接口。Qdrant 也不在任一请求调用链内；它只是被 Compose 定义，`QDRANT_URL` 只在环境变量校验中出现。

## 2.3 文件上传的实际调用关系

```text
multipart/form-data
  → FileInterceptor / Multer
  → fileFilter：先校验原始 kbId、扩展名、MIME
  → limits.fileSize + diskStorage
  → {UPLOAD_DIR}/.tmp/{uuid}.{ext}
  → Controller：再次解析 kbId、检查 file
  → DocumentService：KB 存在性、PDF 头、流式 SHA-256、同库预去重
  → DocumentStorageService：rename；跨设备时 copy + unlink
  → {UPLOAD_DIR}/{kbId}/{uuid}.{ext}
  → DataSource.transaction()
      ├─ 保存 Document(status=pending)
      └─ knowledge_base.documentCount + 1
  → MySQL commit
  → DocumentResponseDto
  → ResponseInterceptor
  → 202 Accepted {code:0,message:"success",data:{...}}
```

这里有一个必须按代码纠正的顺序：扩展名/MIME 和上传路由的原始 `kbId` 在 `fileFilter` 中、落盘前校验；大小限制在 Multer 写入流期间生效。不是“所有校验都等临时文件完整落盘后再做”。只有 PDF 文件头、哈希、去重等必须读取文件内容的检查发生在临时文件落盘之后。依据是 `server/src/modules/document/storage/document-upload.config.ts` 和 `DocumentService.upload()`。

# 3. T01 项目初始化与运行环境

## 3.1 monorepo 与启动方式

根目录没有 `package.json`，但有 `pnpm-workspace.yaml`，只声明：

```yaml
packages:
  - server
  - web
```

依赖由根 `pnpm-lock.yaml` 统一锁定；前后端各自保留脚本。依据为 `server/package.json` 和 `web/package.json`：

- 后端开发：`pnpm --filter server dev`，执行 `nest start --watch`。
- 后端构建/运行：`pnpm --filter server build`；之后由 `pnpm --filter server start` 执行 `node dist/main.js`。
- 前端开发：`pnpm --filter web dev`，Vite 配置显式监听 5173。
- 前端构建/类型检查：`pnpm --filter web build`、`pnpm --filter web type-check`。

没有根级 `dev/build` 聚合脚本，也没有同时启动前后端的工具；README 要求开两个终端。

## 3.2 Docker Compose

`docker-compose.yml` 当前定义：

- `mysql:8.0`：宿主机 3306、命名卷 `mysql_data`、utf8mb4/`utf8mb4_unicode_ci`、`mysqladmin ping` 健康检查。
- `qdrant/qdrant:v1.12.4`：宿主机 6333/6334、命名卷 `qdrant_data`、通过 Bash TCP 请求 `/readyz` 做健康检查。
- 两者都使用 `restart: unless-stopped`，加入 `mini_rag_network`。

代码扫描只能确认 Compose 定义，不能确认本次审计时容器是否正在运行或是否 healthy。历史完成报告记载过成功结果，但本次没有复验。

## 3.3 环境变量加载和校验

Nest 通过 `ConfigModule.forRoot()` 全局加载根 `.env`，再调用 `validateEnvironment()`。相关文件：

- 加载入口：`server/src/app.module.ts`
- 类型化配置：`server/src/config/configuration.ts`
- 校验：`server/src/config/env.validation.ts`

后端启动时强制校验：

- `SERVER_PORT`：1–65535 的整数；
- `CORS_ORIGIN`：非空字符串；
- `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME`：非空字符串；
- `DB_PORT`：1–65535 的整数；
- `QDRANT_URL`：带 http/https 协议的 URL；
- `UPLOAD_DIR`：非空字符串；
- `MAX_FILE_SIZE_MB`：1–1024 的整数。

数字通过 `class-transformer` 转换，规则通过 `class-validator` 同步校验。任一必需项缺失/非法，`ConfigModule` 初始化抛错，`bootstrap().catch()` 记录“服务启动失败”并 `process.exit(1)`；此时没有 HTTP 状态码，因为监听端口尚未建立。依据为 `server/src/config/env.validation.ts` 的 `validateEnvironment()` 和 `server/src/main.ts`。

`configuration.ts` 把服务、数据库和上传配置映射为嵌套键。相对 `UPLOAD_DIR` 按 `configuration.ts` 所在的 `src/config` 或编译后的 `dist/config` 向上两级解析，因此默认 `./uploads` 实际落到 `server/uploads`，不依赖启动 cwd。

## 3.4 Vite 代理、Axios 与请求转发

`web/vite.config.ts` 设置 `envDir: '..'`，所以前端能读取根 `.env` 中以 `VITE_` 开头的变量；开发服务器把 `/api` 原样代理到 `http://localhost:3000`。`web/src/api/http.ts` 以 `VITE_API_BASE_URL ?? '/api'` 创建 Axios 实例。

后端普通成功响应是 `{code:0,message:'success',data}`；Axios 响应拦截器识别这个结构后把 `response.data` 改为其中的 `data`，因此 `getHealth()` 最终直接返回 `HealthResult`。失败时它只保留后端 `message`，转成普通 `Error`；HTTP 状态和 `details` 不会继续暴露给当前页面。

`server/src/main.ts` 的 CORS 只允许 `CORS_ORIGIN` 配置的单一 origin。开发页面使用相对 `/api` 并经过 Vite 代理时，浏览器看到的是同源请求；CORS 主要约束绕过代理、直接访问 Nest 的跨源客户端。

## 3.5 `/api/health` 完整执行流程

1. `HomePage.handleCheck()` 设置 loading，调用 `getHealth()`；失败时用 Ant Design Vue `message.error`。
2. `getHealth()` 调用 Axios `GET /health`；baseURL 使浏览器请求成为 `/api/health`。
3. Vite 把 `/api/health` 原样转发到 Nest 3000。
4. `main.ts` 的全局前缀 `api` 与 `HealthController` 的 `health` 路由命中 `getHealth()`。
5. `HealthService.getHealth()` 调用 `DatabaseService.ensureReady()`。
6. 第一次准备时，`DatabaseService` 初始化 TypeORM DataSource 并执行所有 pending migration；共享 Promise 避免并发重复初始化。
7. 准备成功后执行 `SELECT 1`。
8. 成功返回 `{status:'ok',db:'up',uptime}`；失败捕获后清空 readiness Promise，并返回 `{status:'ok',db:'down',uptime}`。
9. `ResponseInterceptor` 包装为统一成功结构，HTTP 仍为 200。
10. Axios 解包，Vue 展示三个字段。

关键代码为 `server/src/modules/health/health.controller.ts`、`health.service.ts`、`server/src/database/database.service.ts`、`server/src/common/interceptors/response.interceptor.ts`。

`/api/health` 不检查 Qdrant，所以 `db:'up'` 只表示 MySQL 可连接且 migration 已成功执行，不表示完整 RAG 依赖都健康；`status` 在当前类型中始终是 `'ok'`。

## 3.6 数据库不可用时的表现

运行时 TypeORM 配置启用了 `manualInitialization: true`。`DatabaseService.onApplicationBootstrap()` 会等待首次初始化/迁移尝试；连接失败被内部捕获后，进程不会退出并可继续完成监听，但端口开始监听前可能先等待 mysql2/TypeORM 的默认连接超时。代码没有配置显式连接超时。之后：

- 健康接口再次触发 `ensureReady()`；失败返回 HTTP 200、`data.db='down'`，并记录服务端错误。
- MySQL 恢复后，下一次健康检查会重新尝试 readiness 和 migration，再执行 `SELECT 1`。
- 知识库/文档业务 Service 并没有统一调用 `ensureReady()`；数据库仍不可用时，其 Repository/事务错误会被全局过滤器转换为 500，而不是业务级降级结果。
- 上传若在进入数据库前失败，会清理临时文件；若文件已移动后事务才失败，则还会尝试删除最终文件。

## 3.7 T01 技术及其实际作用

| 技术 | 当前实际作用 |
|---|---|
| pnpm workspace | 用一个 lockfile 管理 `server` 和 `web`，通过 filter 分别运行脚本。 |
| Docker Compose | 启动 MySQL、Qdrant 及其数据卷/健康检查；尚不启动应用服务。 |
| ConfigModule | 加载根环境变量、提供全局 `ConfigService`、在 Nest 创建阶段做 fail-fast 校验。 |
| TypeORM | 提供 DataSource、Repository、实体映射、migration 和事务；当前实际读写知识库/文档。 |
| ValidationPipe | 全局剔除 DTO 未声明字段并执行转换/校验；T03 的 trim 依赖 `transform:true`。 |
| Axios | 前端当前只调用健康接口，负责统一 baseURL、成功解包和错误消息转换。 |
| Vite proxy | 开发环境消除前端到后端的跨端口调用差异；请求路径不 rewrite。 |

## 3.8 当前环境和配置问题

1. `server/src/app.module.ts` 用 `resolve(process.cwd(), '../.env')` 定位根 `.env`，依赖命令 cwd。按 README 从 `server` workspace 启动可用；若从其他 cwd 直接执行编译产物，可能读错位置。
2. Vite 代理目标固定为 `http://localhost:3000`，不会自动跟随 `SERVER_PORT`。
3. Compose 只向 MySQL 传 `MYSQL_ROOT_PASSWORD` 和 `MYSQL_DATABASE`，没有设置 `MYSQL_USER/MYSQL_PASSWORD`；`.env` 若把 `DB_USER` 改成非 root，容器不会自动创建该业务用户。
4. 后端验证 `QDRANT_URL`，但不保存到 `AppConfiguration` 也不建立连接；Qdrant 故障不会反映到健康接口。
5. `DB_ROOT_PASSWORD` 和 `VITE_API_BASE_URL` 不由后端校验；它们分别由 Compose 和 Vite 消费。
6. 后端 MySQL 配置没有显式 `timezone`。`docs/reports/task-03-completion.md` 历史验收曾记录 8 小时时间偏移；本次未运行复现，但代码层风险仍在。
7. 当前使用 root 数据库账号样例，没有最小权限业务用户；Compose 宿主机端口也固定为 3306，可能与本机 MySQL 冲突。
8. 根目录没有 `package.json` 的 `packageManager` 字段，仓库没有在 package metadata 中锁定 pnpm 主版本。
9. 仓库没有自动化测试文件，也没有 lint 脚本；当前文档只能确认实现结构，不能给出新的运行通过结论。

# 4. T02 数据库与后端公共能力

## 4.1 六个实体和六张业务表

代码注册了六个实体，集中导出于 `server/src/database/entities.ts`。TypeORM 还会使用自己的 `migrations` 记录表，但它不是业务实体。

| 业务表 / 实体 | 保存内容 | 当前实际业务使用 | 为后续准备的关键字段 |
|---|---|---|---|
| `knowledge_base` / `KnowledgeBase` | 知识库名称、描述、文档计数、时间 | T03/T04 实际读写 | `document_count` 为文档列表/管理页提供汇总 |
| `document` / `Document` | 原文件元数据、SHA-256、磁盘相对路径、处理状态、错误、切片数 | T04 实际读写 | `status/error_message/chunk_count` 为处理流水线状态机准备 |
| `document_chunk` / `DocumentChunk` | 切片原文、顺序、字符数、页码、Qdrant point ID | 只有实体/表，无业务写入 | `qdrant_point_id`、`page_no`、`kb_id` 为向量和引用定位准备 |
| `conversation` / `Conversation` | 某知识库下的一次会话及标题 | 只有实体/表 | 后续会话列表和消息归属 |
| `message` / `Message` | 用户/助手消息、生成状态和错误 | 只有实体/表 | SSE 失败时保存部分回答和失败原因 |
| `message_reference` / `MessageReference` | 某条回答引用的文档/切片定位、分数和内容快照 | 只有实体/表 | 回答引用、历史可追溯和删除后的快照保留 |

实体路径：

- `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts`
- `server/src/modules/document/entities/document.entity.ts`
- `server/src/modules/document/entities/document-chunk.entity.ts`
- `server/src/modules/conversation/entities/conversation.entity.ts`
- `server/src/modules/conversation/entities/message.entity.ts`
- `server/src/modules/conversation/entities/message-reference.entity.ts`

本次只读审计没有查询实时 MySQL，因此只能确认“migration 定义会创建这些表”，不能确认此刻某个容器中的表是否存在、各表行数或 migration 是否已执行。

共同类型和索引约定：

- 所有主键/外键都是 `INT UNSIGNED`，TypeScript 侧使用 `number`；`document.file_size` 例外为 `BIGINT UNSIGNED`，API DTO 用 `Number()` 转换 mysql2 返回值，环境校验允许的最大 1024 MB 仍远低于 JS 安全整数上限。
- `message_reference.score` 是 `DECIMAL(5,4)`；实体 transformer 把 mysql2 默认返回的字符串转回 `number`。
- Document 状态枚举为 `pending/parsing/chunking/embedding/completed/failed`；Message 角色为 `user/assistant`，状态为 `completed/failed`。
- 当前静态 schema 有 4 个业务唯一索引、5 个命名普通业务索引和 5 条 CASCADE FK。所有 relation 都没有开启 eager，也没有 TypeORM 保存级联；本文所说的删除级联来自数据库 FK。

## 4.2 关系和级联删除

```text
knowledge_base
  ├─< document
  │     └─< document_chunk
  └─< conversation
        └─< message
              └─< message_reference
```

五条外键都在 `1784800736682-InitSchema.ts` 中声明 `ON DELETE CASCADE`：

| 外键 | 删除父记录后的数据库行为 |
|---|---|
| `document.kb_id → knowledge_base.id` | 删除知识库会删除文档行 |
| `document_chunk.document_id → document.id` | 删除文档会删除切片行 |
| `conversation.kb_id → knowledge_base.id` | 删除知识库会删除会话行 |
| `message.conversation_id → conversation.id` | 删除会话会删除消息行 |
| `message_reference.message_id → message.id` | 删除消息会删除引用行 |

`document_chunk.kb_id` 是按知识库直查的冗余列，没有 FK；切片生命周期只跟随 `document_id`。`message_reference.document_id/chunk_id` 也没有 FK，因此单独删除文档/切片时，历史引用行不会被联动删除。

数据库级联只处理 MySQL 行，**不会删除磁盘文件，也不会删除未来的 Qdrant point**。当前 `KnowledgeBaseService.remove()` 直接删除知识库，虽然 MySQL 会级联删除文档行，但没有逐个调用 `DocumentStorageService`，所以知识库下已经上传的文件会遗留在磁盘。这是当前最重要的一致性问题之一，依据为 `server/src/modules/knowledge-base/knowledge-base.service.ts` 的 `remove()`。

## 4.3 为什么 MySQL 保存 `document_chunk`

当前还没有产生切片，但数据模型选择让 MySQL 保存切片原文，原因是：

- MySQL 作为可查询、可审计的结构化事实源，可以直接检查切片内容、顺序、页码和切片质量；
- 重新构建 Qdrant collection 时，不必重新解析原文件就能从 MySQL 取回切片文本；
- 回答引用可回查文档和切片；Qdrant 负责向量搜索，并会按设计冗余 content 等 payload 以便直接组装上下文；
- MySQL/Qdrant 双写出现偏差时，可以用 `document.chunk_count`、`document_chunk` 行数和 point 数量核对。

这些是实体设计已经提供的基础，不代表重建、核对或双写逻辑已经实现。依据为 `DocumentChunk` 实体和 `docs/00-overall-plan.md` 的存储设计。

`qdrantPointId` 是每个 MySQL 切片对应的 Qdrant point 标识，数据库当前只约束为 `CHAR(36)` 并设置唯一索引 `uk_qdrant_point`；使用 UUID v4 是设计约定，尚没有生成或格式校验代码。未来可用它进行 upsert、删除、回查和一致性核对；当前没有插入切片或写 Qdrant 的代码。

## 4.4 为什么 `message_reference` 保存快照

`message_reference` 保存 `documentName/chunkIndex/pageNo/score/contentSnapshot`，同时保留无 FK 的可空 `documentId/chunkId`。这样即使某个文档以后被删除或重新处理，历史回答仍能展示“当时引用了什么内容”，不会因为源行消失而完全失去解释依据。当前这只是表结构设计，仓库没有 MessageReference Repository、Service 或写入流程。

快照保留只针对单独删除 Document/Chunk：删除 Conversation 时 MessageReference 会沿 `conversation → message → message_reference` 级联删除；删除整个 KnowledgeBase 时会连同其会话链一起删除。

## 4.5 Migration 和 DataSource

当前两条 migration：

1. `server/src/database/migrations/1784800736682-InitSchema.ts`：创建六张业务表、索引、枚举、默认值和五条级联外键；`down()` 反向删除。
2. `server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts`：删除普通 `idx_name`，增加唯一索引 `uk_name`；`down()` 恢复普通索引。

`synchronize` 在运行时和 CLI 两份配置中都固定为 `false`：

- 运行时：`server/src/database/typeorm.config.ts`
- CLI：`server/src/database/data-source.ts`

关闭它是为了让 schema 变更可审查、可复现、可回滚，避免实体变化在启动时静默修改数据库。实体变更后应生成新 migration，而不是改历史 migration 或打开自动同步。

常用脚本定义在 `server/package.json`：

- 生成：`pnpm --filter server migration:generate src/database/migrations/ChangeName`
- 执行：`pnpm --filter server migration:run`
- 回滚最近一条：`pnpm --filter server migration:revert`
- 查看状态：`pnpm --filter server migration:show`

一次 `migration:revert` 只回滚最新一条；按当前顺序，它会先把 `uk_name` 恢复为 `idx_name`，不会立刻删除六张表。再次回滚才会进入初始 schema 的 `down()`。

第二条 migration 直接创建唯一索引；如果从早期允许重名的数据库升级且已经存在重复名称，`CREATE UNIQUE INDEX` 会失败。当前仓库没有迁移前清洗重复数据的脚本。

### 运行时 DataSource 与 CLI DataSource 的区别

| 项目 | Nest 运行时 | TypeORM CLI |
|---|---|---|
| 文件 | `typeorm.config.ts` | `data-source.ts` |
| 配置来源 | 注入 `ConfigService` 的嵌套配置 | `dotenv` 直接加载根 `.env`，读取 `process.env` |
| 环境校验 | 先经过 `validateEnvironment()` | 不复用 Nest 校验；非法值通常表现为 CLI/驱动错误 |
| 初始化 | `manualInitialization:true`，由 `DatabaseService` 控制 | CLI 自己初始化 |
| 用途 | 应用 Repository、事务、启动 migration | generate/run/revert/show 命令 |

两者共享 `AppEntities` 和 migration 路径，但不是第二套业务连接池；CLI 只在命令进程中使用。

## 4.6 `DatabaseService` 如何初始化

`server/src/database/database.service.ts` 的流程是：

1. `onApplicationBootstrap()` 调用 `ensureReady()`；
2. `ensureReady()` 缓存一个 readiness Promise，合并并发初始化请求；
3. DataSource 未初始化时调用 `initialize()`；
4. 无论是否刚初始化，都调用 `runMigrations()`；
5. 成功返回 DataSource；
6. 失败时清空 Promise，允许健康检查稍后重试；启动钩子只记录错误，不让应用退出；
7. 健康检查查询失败时还会调用 `invalidateReadiness()`。

建立或重建 readiness 时会先执行 migration，之后健康检查通过缓存的 DataSource 做 `SELECT 1`。因此正常启动语义是“migration 就绪且当前连接可用”；但 readiness 成功后不会在每次健康请求重新扫描 pending migration，若有人在外部回滚/改坏 schema 而连接仍通，health 仍可能显示 `db:'up'`。

## 4.7 统一响应、异常和 SSE 预留

`ResponseInterceptor.intercept()` 位于 `server/src/common/interceptors/response.interceptor.ts`。普通成功值统一变成：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

以下情况不包装：标记了 `@SkipResponseWrap()`、返回 `StreamableFile`、响应头已经发送、或 `content-type` 包含 `text/event-stream`。`@SkipResponseWrap` 定义在 `server/src/common/decorators/skip-response-wrap.decorator.ts`，目的是避免未来 SSE token 被变成一次普通 JSON；当前没有任何 Controller 使用它，也没有 SSE 端点。

`HttpExceptionFilter.catch()` 位于 `server/src/common/filters/http-exception.filter.ts`，主要行为：

- class-validator 的 400 消息数组 → `{code:400,message:'参数校验失败',details:[...]}`；
- 其他 `HttpException` → 保留状态码和规范化消息，只显式透传可选 `details`；
- Nest 转换后的常见 Multer 错误中，`File too large` 和代码列出的 multipart 消息 → 413/400 中文消息；其他 `HttpException` 保留原消息；
- 直接 `MulterError` → 文件超限 413，其余上传错误 400；
- `QueryFailedError` → 500、`message:'数据库操作失败'`；
- 其他未知异常 → 500、`message:'服务器内部错误'`。

前端 `web/src/api/http.ts` 对成功 envelope 解包，对错误只提取 `message`。这对当前健康页够用，但未来若要在上传页展示 409 的既有文档 `details`，前端拦截器还需要保留结构化错误信息。

# 5. T03 知识库 CRUD

## 5.1 当前实际接口

全局前缀 `/api` 来自 `server/src/main.ts`。T03 名为 CRUD，但当前冻结范围没有更新接口，因此没有 PUT/PATCH。

| HTTP | 路径 | 请求参数 | 成功 | 常见错误 |
|---|---|---|---:|---|
| POST | `/api/knowledge-bases` | JSON：`name` 必填；`description` 可选 | 201 | 400 DTO 校验；409 重名；500 数据库/未知错误 |
| GET | `/api/knowledge-bases` | 无；当前不分页 | 200 | 500 数据库/未知错误 |
| GET | `/api/knowledge-bases/:id` | `id` 为正整数路径参数 | 200 | 400 非法 ID；404 不存在；500 |
| DELETE | `/api/knowledge-bases/:id` | `id` 为正整数路径参数 | 204，无 body | 400 非法 ID；404 不存在；500 |

普通 200/201 成功会由全局拦截器包装，`data` 是 `KnowledgeBaseResponseDto` 或数组。DTO 只返回 `id/name/description/documentCount/createdAt/updatedAt`，依据为 `server/src/modules/knowledge-base/dto/knowledge-base-response.dto.ts`。204 最终由 HTTP 适配器输出空响应体。

## 5.2 创建知识库的完整流转

```text
POST JSON
  → 匹配 KnowledgeBaseController 路由
  → 全局 ValidationPipe
  → CreateKnowledgeBaseDto：transform/trim + 类型/长度/非空校验
  → KnowledgeBaseController.create(dto)
  → KnowledgeBaseService.create()
  → Repository.findOne({name}) 预检
  → Repository.create() + save()
  → MySQL knowledge_base
  → KnowledgeBaseResponseDto.fromEntity()
  → ResponseInterceptor
  → HTTP 201 {code:0,message:"success",data:{...}}
```

详细行为：

1. `CreateKnowledgeBaseDto` 对 `name` 和 `description` 的字符串值执行 `trim()`。`name` 必须是非空字符串且最长 100；`description` 可缺失或显式为 `null`，凡非 `null/undefined` 的值都必须是字符串且最长 500，空串/空白字符串最终由 Service 归一为 `null`。代码在 `server/src/modules/knowledge-base/dto/create-knowledge-base.dto.ts`。
2. `main.ts` 的 `ValidationPipe({whitelist:true,transform:true})` 让 `@Transform` 真正生效，并静默移除未声明字段。它没有开启 `forbidNonWhitelisted`，所以多余字段不是 400，而是被丢弃。
3. Controller 只负责 HTTP 契约和调用 Service，不直接查询 Repository，也不决定重名、排序、空描述等业务规则。这样 HTTP 层、业务层和持久化层职责清楚，见 `KnowledgeBaseController`。
4. Service 把 trim 后的空描述归一化成 `null`，先用 `Repository.findOne({where:{name}})` 做友好预检。
5. 未重名时用 Repository 创建实体并保存；MySQL 自动产生 ID/时间，`documentCount` 使用默认 0。
6. 保存结果逐字段映射成响应 DTO，避免把 `documents/conversations` relation 或未来内部字段直接暴露。

## 5.3 名称去重与并发

应用层预检的价值是尽早返回清晰的 409，但“先查再写”存在并发窗口：两个请求可能同时查到不存在。最终一致性由数据库唯一约束 `uk_name(name)` 保证，依据为：

- 实体：`server/src/modules/knowledge-base/entities/knowledge-base.entity.ts` 的 `@Unique('uk_name', ['name'])`
- migration：`server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts`
- 异常转换：`KnowledgeBaseService.isDuplicateEntryError()`

若并发写触发 MySQL `ER_DUP_ENTRY`，Service 将 `QueryFailedError` 转为 `ConflictException`，对外仍是 409，而不是全局 500。表的 `utf8mb4_unicode_ci` collation 不区分大小写，所以应用查询和唯一索引对 `Name/name` 的判断一致。

## 5.4 查询、删除和当前边界

- 列表按 `createdAt DESC, id DESC` 排序；`id` 为相同时间戳提供稳定次序。代码为 `KnowledgeBaseService.findAll()`。
- 详情先按 ID 查询，`null` 时抛 `NotFoundException('知识库不存在')`，由过滤器输出 404。
- 删除先调用 `findOne()` 保证普通“不存在”场景返回 404，再执行 `Repository.delete(id)`，Controller 固定为 204。
- 当前删除没有检查 `DeleteResult.affected`。两个并发删除都在预检阶段读到记录时，后执行者也可能返回 204；这与文档删除的并发 404 语义不同。
- MySQL 会级联删除该知识库的文档、切片、会话、消息和引用行，但当前 Service 不删除上传目录，带文档删除知识库会留下磁盘文件。
- 当前没有更新知识库、分页、鉴权，也没有前端知识库页面。

## 5.5 Swagger 当前使用方式

`server/src/main.ts` 使用 `DocumentBuilder` 和 `SwaggerModule`，UI 地址为 `/api/docs`，OpenAPI JSON 默认地址为 `/api/docs-json`。知识库 Controller 用 `@ApiTags/@ApiOperation` 及成功/错误响应装饰器，DTO 用 `@ApiProperty` 描述字段。

Swagger 中端点响应 Schema 描述的是 envelope 里的 `data` 部分，而不完整展示 `{code,message,data}`；`main.ts` 的文档说明对此作了提示。当前 Swagger 按代码还会包含 health 和 document 路由，不能再使用 T03 历史报告里的“只有 health/knowledge-bases”结论。

## 5.6 T03 关键文件

- HTTP 入口：`server/src/modules/knowledge-base/knowledge-base.controller.ts`
- 业务逻辑：`server/src/modules/knowledge-base/knowledge-base.service.ts`
- 请求 DTO：`server/src/modules/knowledge-base/dto/create-knowledge-base.dto.ts`
- 响应 DTO：`server/src/modules/knowledge-base/dto/knowledge-base-response.dto.ts`
- 实体：`server/src/modules/knowledge-base/entities/knowledge-base.entity.ts`
- ID 管道：`server/src/common/pipes/parse-positive-int.pipe.ts`
- 唯一索引 migration：`server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts`

# 6. T04 文档上传与文档管理

## 6.1 当前实际接口

| HTTP | 路径 | 请求参数 | 成功 | 常见错误 |
|---|---|---|---:|---|
| POST | `/api/knowledge-bases/:kbId/documents` | `multipart/form-data`；单文件字段固定为 `file`；`kbId` 正整数 | 202 | 400 ID/缺文件/上传结构；404 KB 不存在；409 重复；413 超限；415 类型/PDF 头；500 I/O/DB |
| GET | `/api/knowledge-bases/:kbId/documents` | `kbId` 正整数；不分页 | 200 | 400、404、500 |
| GET | `/api/documents/:id` | 文档 `id` 正整数 | 200 | 400、404、500 |
| DELETE | `/api/documents/:id` | 文档 `id` 正整数 | 204，无 body | 400、404、500；磁盘删除失败仍为 204 |

上传和知识库内列表入口是 `KnowledgeBaseDocumentsController`；详情/删除入口是 `DocumentController`。`DocumentResponseDto` 只返回十个字段：

`id/knowledgeBaseId/fileName/fileExt/fileSize/status/errorMessage/chunkCount/createdAt/updatedAt`。

它不会暴露 `fileHash`、`storagePath` 或 relation，依据为 `server/src/modules/document/dto/document-response.dto.ts`。

## 6.2 上传的真实执行顺序

下面是按当前 Nest/Multer 配置和 Service 代码还原的顺序：

1. 客户端发送 `multipart/form-data`，文件字段名必须为 `file`。
2. `FileInterceptor('file')` 在 Controller 参数 Pipe 之前运行。
3. `createDocumentUploadOptions()` 的 `fileFilter` 先手动复用 `ParsePositiveIntPipe` 校验原始 `req.params.kbId`，再根据原始文件名提取小写扩展名，并校验扩展名与 MIME 的组合。非法 ID 或类型在落盘前结束。
4. 合法文件进入 `diskStorage`：确保 `{UPLOAD_DIR}/.tmp` 存在，生成 `randomUUID()+扩展名`，边接收边写临时文件；`limits.fileSize` 同时限制字节数。
5. Multer 完成后，Controller 参数上的 `ParsePositiveIntPipe` 再解析一次 `kbId`，并检查 `file` 是否存在。
6. `DocumentService.upload()` 查询知识库；不存在时删除临时文件并返回 404。
7. PDF 读取前 5 字节，必须等于 `%PDF-`；不符时删除临时文件并返回 415。MD/TXT 没有内容或编码检查。
8. `computeFileSha256()` 使用 `createReadStream` 流式计算整个临时文件的 SHA-256。
9. Repository 按 `{kbId,fileHash}` 查询；同知识库命中时删除临时文件，返回 409 和已有文档摘要。
10. `DocumentStorageService.moveTemporaryFile()` 把文件移到 `{UPLOAD_DIR}/{kbId}/{uuid}.{ext}`。
11. `DataSource.transaction()` 内保存 `Document`，同时把 `KnowledgeBase.documentCount` 加 1；文档初始值固定为 `pending/null/0`。
12. 事务成功后映射 `DocumentResponseDto`，由响应拦截器包装，以 202 返回。

关键代码：

- 拦截和落盘：`server/src/modules/document/storage/document-upload.config.ts`
- 主流程：`server/src/modules/document/document.service.ts` 的 `upload()`
- 文件移动：`server/src/modules/document/storage/document-storage.service.ts`
- 哈希：`server/src/modules/document/utils/file-hash.util.ts`

## 6.3 文件校验的准确边界

当前允许：

| 扩展名 | 允许 MIME | 内容级检查 |
|---|---|---|
| `.pdf` | `application/pdf` | 只检查前 5 字节 `%PDF-` |
| `.md` | `text/markdown`、`text/plain`、`application/octet-stream`、空 MIME | 无 |
| `.txt` | `text/plain`、`application/octet-stream`、空 MIME | 无 |

这属于“上传入口校验”，不是解析正确性保证：

- 一个只以 `%PDF-` 开头但结构损坏的文件仍可进入 `pending`；
- 二进制内容改名为 `.txt/.md` 且 MIME 可接受时也能进入 `pending`；
- 没有显式的空文件下限检查；只有配置的最大值；
- 文本编码、空内容和 PDF 真正可解析性要等 T05 处理阶段判断。

## 6.4 技术选择与原因

### 为什么先进入临时目录

临时目录把“网络接收完成”和“正式业务文件”分开。在知识库不存在、PDF 头错误、哈希重复或数据库写入前，文件都不会被当成有效文档。依据为 `document-upload.config.ts` 的 `.tmp` 和 `DocumentService.upload()` 的前半段。

### 为什么用 UUID 命名

磁盘不使用用户原始文件名，避免同名覆盖、特殊字符/路径片段和跨平台问题。原始文件名只保存在 `document.file_name` 供界面展示；数据库 `storage_path` 保存 `{kbId}/{uuid}.{ext}` 的相对路径。

### 为什么不能只按文件名去重

同一个内容可以改名，不同内容也可以同名。SHA-256 基于实际字节识别内容，能正确处理这两种情况。文件名仍作为展示元数据，不参与唯一约束。

### 为什么 SHA-256 流式读取

`createReadStream` 不需要把整个文件一次性放进内存。当前默认上限虽为 20 MB，这种写法也能承受以后调整上限，且与 Multer 的磁盘存储策略一致。

### 为什么唯一约束是 `(kb_id, file_hash)`

同一知识库内，相同内容只应有一份；不同知识库则允许各自拥有相同文件。因此实体和初始 migration 使用 `uk_kb_hash(kb_id,file_hash)`，而不是全局唯一的 `file_hash`。

### 为什么保存文档和更新计数同事务

如果先插入 Document、再单独更新 `documentCount`，第二步失败会造成“有文档但计数没加”；反过来也会产生“计数加了但文档不存在”。当前 `DataSource.transaction()` 让两步一起提交或一起回滚。代码还对同一唯一键插入与计数行更新产生的 MySQL deadlock 做一次整段事务重试。

### 为什么数据库事务不能回滚文件系统

TypeORM 事务只控制 MySQL，不能撤销 `rename/copy/unlink`。当前采用“先让最终文件就位，再开数据库事务；事务失败后主动删文件”的补偿方式。补偿式清理不是 ACID 回滚，只是应用在捕获到失败后执行相反的文件操作。

## 6.5 上传失败时怎样清理

| 失败阶段 | 数据库 | 临时文件 | 最终文件 | 对外 |
|---|---|---|---|---|
| fileFilter 拒绝 ID/类型 | 未开始 | 尚未创建 | 无 | 400/415 |
| Multer 超限 | 未开始 | Multer 调用 storage 删除部分文件 | 无 | 413 |
| 临时文件写入中断 | 未开始 | 自定义 storage 包装器尝试删除半文件 | 无 | 500 |
| KB 不存在/PDF 头错误/预检重复/SHA 读取失败 | 未开始 | `cleanupTemporaryFile()` 尝试删除 | 无 | 404/415/409/500 |
| `rename` 失败 | 未开始 | 调用方尝试删除 | 通常无 | 500 |
| EXDEV 的 copy/unlink 兜底失败 | 未开始 | 调用方继续尝试删除 | Storage Service 也尝试清除可能的半成品 | 500 |
| 数据库事务失败 | 自动回滚 | 已被移动 | `deleteByStoragePath()` 尝试补偿删除 | 409 或 500 |

所有清理都是 best-effort。`cleanupTemporaryFile()` 和 `deleteByStoragePath()` 遇到无法删除时只记录 warn；进程若在“文件已移动、事务尚未提交”之间崩溃，catch 也不会执行。当前没有启动扫描、孤儿文件对账或后台清理任务，因此不能把“任何情况下绝不残留文件”写成已保证。

## 6.6 并发重复上传为什么不返回 500

顺序请求会在应用预检阶段返回 409。并发请求可能同时通过预检，最后由 `uk_kb_hash` 决定只有一个事务能插入：

1. 失败事务由 TypeORM 回滚；
2. Service 删除该请求自己的 UUID 最终文件；
3. 捕获 `ER_DUP_ENTRY` 后按 `{kbId,fileHash}` 重查获胜记录；
4. 返回 409，通常携带 `details:{id,fileName,status}`；
5. 若极端时序下重查不到记录，仍返回不带 details 的 409，而不是 500。

当前还对 `ER_LOCK_DEADLOCK` 重试一次整个事务。每个请求使用不同 UUID 文件名，失败请求补偿时不会误删获胜请求的文件。

## 6.7 删除文档流程

```text
DocumentService.findDocumentEntity(id)
  → 不存在：404
  → DataSource.transaction()
      ├─ DELETE document WHERE id=?
      ├─ affected=0：404（并发删除防线）
      └─ knowledge_base.document_count =
           GREATEST(document_count - 1, 0)
  → commit
  → DocumentStorageService.deleteByStoragePath()
  → 204
```

数据库事务失败时，Document 和计数一起回滚，磁盘文件不动，调用方可重试。事务提交后才删磁盘，是为了避免“文件先删了、数据库事务却失败”。此时磁盘删除失败已经无法用数据库 rollback 修复，所以 Storage Service 只记录 warn，接口仍返回 204；代价是可能留下孤儿文件，需要未来的对账/清理机制。

并发删除同一文档时，即使多个请求的第一次查询都命中，事务内 `affected` 检查保证只有一个请求递减计数并返回 204，其余返回 404。`GREATEST` 只防止已有计数漂移导致负数，不代替正常事务一致性。

## 6.8 当前 T04 已知边界

- 上传成功后没有任何 worker 或异步触发器，文档会一直是 `pending`。
- 文档详情只有元数据，没有 T05 才能产生的切片预览。
- 没有多文件上传、下载、预览、重试或重新处理接口。
- 当前重复判断不看 status；未来某文档变成 `failed` 后，同 hash 重传仍会 409。总体方案曾设计“failed 可覆盖重试”，但代码尚未实现。
- 单篇文档删除不删除空的知识库目录。
- 删除整个知识库不调用文件存储服务，会遗留其全部磁盘文件。
- 前端没有上传或文档管理页面。
- 仓库没有 T04 完成报告或测试代码；本次只能确认静态实现，无法确认接口在当前机器上的运行验收结果。

# 7. 当前已经具备的异常和一致性处理

说明：表中的“回滚”指当前业务是否进入显式数据库事务；普通单条 SQL 仍由数据库保证单语句原子性。“磁盘清理”均按代码实际写为“尝试”，不代表 I/O 失败或进程崩溃时绝对成功。

| 场景 | 处理层 / 关键代码 | 对外结果 | 数据库回滚 | 磁盘补偿 |
|---|---|---|---|---|
| 环境变量缺失或非法 | `ConfigModule` → `validateEnvironment()` → `bootstrap.catch` | 无 HTTP；进程退出 1 | 不涉及 | 不涉及 |
| 数据库启动时不可用 | `DatabaseService.onApplicationBootstrap()` 捕获 | 首次连接失败被捕获后应用继续；health 为 200/`db:down` | 无业务事务；TypeORM 抛错并清 readiness，migration 是否部分生效需检查 | 不涉及 |
| 数据库在普通业务中不可用 | Repository/事务 → 全局过滤器 | 通常 500；QueryFailed 为“数据库操作失败”，其他为“服务器内部错误” | 已开启的业务事务自动回滚 | 上传按失败时点尝试删 tmp；若已经移动则尝试删 final |
| DTO 参数错误 | 全局 `ValidationPipe` + `HttpExceptionFilter` | 400，“参数校验失败”+details | 不涉及 | 不涉及 |
| 非法 ID | `ParsePositiveIntPipe`；上传的 fileFilter 提前复用 | 400，“id 必须是正整数” | 不涉及 | 上传在落盘前拒绝 |
| 知识库重名 | Service 预检或 `uk_name` 的 `ER_DUP_ENTRY` | 409 | 无显式事务；失败 INSERT 不生效 | 不涉及 |
| 知识库不存在 | KnowledgeBase/Document Service | 普通查询/删除 404；上传 404 | 无写入 | 上传会尝试删除 tmp |
| 未上传文件 | `KnowledgeBaseDocumentsController.upload()` | 400，“未上传文件” | 不涉及 | 没有文件可清 |
| 文件大小超限 | Multer limit；过滤器规范化 | 413，“文件大小超出限制” | Service 未执行 | Multer 通过 storage `_removeFile` 清部分文件 |
| 扩展名或 MIME 错误 | `fileFilter` | 415，“不支持的文件类型” | Service 未执行 | 落盘前拒绝 |
| PDF 内容与扩展名不符 | `DocumentService.assertPdfHeader()` | 415，“文件内容与扩展名不符” | 无写入 | 尝试删 tmp |
| 同知识库顺序重复上传 | SHA 后 Repository 预检 | 409 + 既有文档 details | 无写入 | 尝试删 tmp |
| 同知识库并发重复上传 | `uk_kb_hash`、一次 deadlock retry、`ER_DUP_ENTRY` 转换 | 一个 202，其余设计为 409 | 失败事务自动回滚 | 失败请求尝试删自己的 final |
| SHA 读取失败 | `computeFileSha256()` rejection → upload catch | 500 | 未开始 | 尝试删 tmp |
| 文件移动失败 | `moveTemporaryFile()` / EXDEV 兜底 | 500 | 未开始 | 尝试删 tmp 和可能的 final 半成品 |
| 上传数据库事务失败 | `DataSource.transaction()` catch | 409（重复）或 500 | 是 | 尝试删已就位 final |
| 文档删除数据库事务失败 | `DocumentService.remove()` catch | 500 | 是，Document/计数恢复 | 不删文件 |
| 删除时磁盘文件不存在或无权限 | `deleteByStoragePath()` catch + warn | 仍为 204 | DB 已提交，不回滚 | 删除失败；可能形成孤儿 |
| 并发创建知识库 | `uk_name` | 一个 201，其余 409 | 失败 INSERT 不生效 | 不涉及 |
| 并发删除文档 | 事务内检查 `affected` | 一个 204，其余 404 | 404 请求事务回滚 | 只有成功请求执行磁盘删除 |
| 并发删除知识库 | 先查后删但不检查 `affected` | 多个请求可能都 204 | 无显式事务 | 当前完全不清知识库文件 |
| 删除含文档的知识库 | MySQL FK cascade | 204 | 单条删除成功后级联提交 | **没有补偿；已上传文件遗留** |

### ID 校验的已知宽松行为

`ParsePositiveIntPipe` 使用 `Number(value)` 再判断整数和大于 0，所以 `abc/0/-1` 会正确 400，但 `1e2`、`0x10`、`1.0` 会被接受，也没有检查 safe integer 或 MySQL `INT UNSIGNED` 上限。代码路径为 `server/src/common/pipes/parse-positive-int.pipe.ts`。因此“正整数”是当前意图，尚不是严格十进制字符串语法。

# 8. 当前项目与完整 RAG 链路的对应关系

状态含义：

- **已实现**：当前请求可实际运行到该步骤。
- **部分实现**：只有容器、配置、实体、字段或公共机制，不能完成该业务动作。
- **未实现**：没有可执行业务代码。

| RAG 环节 | 当前状态 | 当前实际事实 | 未来任务 | 已准备基础 |
|---|---|---|---|---|
| 文档上传 | 已实现 | T04 接收三类文件、保存磁盘和 Document，返回 202/pending | T04 | `DocumentModule`、文件存储、SHA、事务 |
| 文本解析 | 未实现 | 没有 parser/pdf-parse/文本读取处理器 | T05 | 原文件路径、`status='parsing'` 枚举 |
| 文本清洗 | 未实现 | 没有 cleaner 或清洗规则代码 | T06 | Document 状态/错误字段 |
| 文本分片 | 未实现 | 没有 splitter 或 chunk 生成逻辑 | T06 | `DocumentChunk` 实体、`uk_doc_index` |
| 写入 DocumentChunk | 部分实现 | 表和实体存在，但没有 Repository/Service save | T05/T06 | content、pageNo、charCount、chunkIndex 字段 |
| Embedding | 未实现 | 无模型依赖、配置、客户端或调用 | T07 | `status='embedding'` 枚举 |
| Qdrant collection / 索引 | 部分实现 | Compose 和 `QDRANT_URL` 存在；后端不连接 | T08 | Qdrant 容器、`qdrantPointId` 唯一字段 |
| Qdrant upsert | 未实现 | 无 point/vector/payload 写入代码 | T08 | `qdrant_point_id` 与未来 payload 设计 |
| 向量召回 | 未实现 | 无 query embedding、filter、search | T09 | `kbId` 字段和索引设计 |
| TopK / scoreThreshold | 未实现 | 没有请求参数或默认值代码 | T09 | 总体方案中的默认设计，不是当前配置 |
| Rerank | 未实现，且非 MVP 必做 | 仓库没有实现或专门任务 | 基础 MVP 后可选优化 | 无 |
| 上下文组装 | 未实现 | 无按 score 排序、截断、来源标注代码 | T10 | Chunk/引用数据模型 |
| LLM 生成 | 未实现 | 无 Chat 模型环境变量、SDK/HTTP 客户端或调用 | T10 | Message 实体的成功/失败字段 |
| SSE | 部分实现 | 只有 `@SkipResponseWrap` 和 event-stream 旁路；无端点/事件 | T11 | 全局拦截器不会破坏未来事件流 |
| 引用溯源 | 部分实现 | `message_reference` 表存在；无查询或写入 | T12 | 文档名、页码、score、内容快照字段 |
| 会话与消息 | 部分实现 | Conversation/Message 实体存在；无 Module/API | T13 | 级联关系、角色和生成状态字段 |
| 前端流式回答和引用展示 | 未实现 | 前端只有健康页 | T14b | Axios 基础；SSE 将按规划使用原生 fetch |

## 8.1 当前几个关键“否”

- 上传后为什么只是 `pending`：`DocumentService.upload()` 显式写入 `status:'pending'`，成功后没有调用 processing service、队列或后台任务。
- 当前是否已经产生 DocumentChunk：应用代码**不会产生**；只有实体和表。实时数据库是否有人手工插入无法从代码确认。
- 当前是否调用 Embedding：否，依赖和配置都不存在。
- 当前是否写入 Qdrant：否；Qdrant 容器与 URL 校验不等于业务连接。
- 当前是否支持向量检索：否。
- 当前是否调用 LLM：否。
- 当前是否支持 SSE：否；只有兼容 SSE 的响应包装预留。
- 当前是否支持回答引用：否；只有引用表结构，没有回答、引用写入或接口。

因此当前链路在这里停止：

```text
文件上传
  → 校验 / SHA-256 / 磁盘保存
  → Document(status=pending)
  → 停止
```

# 9. 当前技术栈及实际用途

## 前端

| 技术 | 当前在哪里使用 | 解决的问题 | 是否真正进入业务链路 |
|---|---|---|---|
| Vue 3 | `web/src/main.ts`、`App.vue`、`views/HomePage.vue` | 挂载 SPA、维护 loading/health 响应状态、渲染健康页 | 仅进入健康检查；未进入知识库/文档/RAG 页面 |
| TypeScript | `web/src/**/*.ts/.vue`、`web/tsconfig.json` | 为健康响应、API 和组件状态提供静态类型 | 是，但当前前端业务类型只有 `HealthResult` |
| Vite | `web/package.json`、`web/vite.config.ts` | 开发服务器、Vue 编译、构建和 `/api` 代理 | 是；只在开发请求转发中生效 |
| Axios | `web/src/api/http.ts`、`web/src/api/health.ts` | 统一 baseURL、解包后端 envelope、提取错误消息 | 只进入健康接口；没有知识库/文档 API |
| Ant Design Vue | `web/src/main.ts`、`web/src/views/HomePage.vue` | 提供 Button、Card、Descriptions、Tag 和消息提示 | 只用于健康页 |

当前 `web/package.json` 没有 Vue Router、Pinia；`App.vue` 直接渲染 `HomePage`。因此总体方案中的页面路由和业务 Store 仍是未来设计。

TypeScript 也覆盖全部 NestJS 后端源码，`server/tsconfig.json` 开启 `strict`；这里只按用户要求把它列在前端类别，实际并非前端专用。

## 后端

| 技术 | 当前在哪里使用 | 解决的问题 | 是否真正进入业务链路 |
|---|---|---|---|
| NestJS | `server/src/main.ts`、`app.module.ts`、所有 Module/Controller/Service | 模块装配、依赖注入、HTTP 路由、拦截器、过滤器 | 是，承载全部现有后端接口 |
| TypeORM | `server/src/database/`、实体、KnowledgeBase/Document Service | 实体映射、Repository、migration、事务、计数更新 | 是，实际读写 MySQL |
| class-validator | `config/env.validation.ts`、`CreateKnowledgeBaseDto` | 启动配置和请求字段的规则校验 | 是 |
| class-transformer | `config/env.validation.ts`、`CreateKnowledgeBaseDto` | 把端口/大小转成数字，对字符串 trim | 是 |
| Multer | `DocumentModule`、`document-upload.config.ts`、`FileInterceptor` | multipart 解析、磁盘流式落盘、文件大小和类型入口校验 | 是，进入 T04 上传主链路 |
| Swagger | `server/src/main.ts`、各 Controller/DTO | 生成 API UI、OpenAPI JSON、上传 binary 契约和错误说明 | 是，覆盖当前 health/KB/document 路由 |

Nest 全局 `ValidationPipe`、`HttpExceptionFilter` 和 `ResponseInterceptor` 在 `server/src/main.ts` 注册，所以它们不是某个模块的局部工具，而是所有现有 HTTP 接口的公共边界。

## 存储和基础设施

| 技术 | 当前在哪里使用 | 解决的问题 | 是否真正进入业务链路 |
|---|---|---|---|
| MySQL 8 | `docker-compose.yml`、TypeORM 配置、migration | 保存知识库、文档元数据及未来 chunk/会话/引用 | 是；当前实际业务只读写 KB 和 Document |
| Qdrant | `docker-compose.yml`、`QDRANT_URL` 校验 | 为未来向量 collection、upsert 和 search 准备运行服务 | 否；没有 SDK、连接或请求 |
| Docker Compose | 根 `docker-compose.yml` | 为 MySQL/Qdrant 提供可复现镜像、端口、卷、网络和健康检查 | 进入开发基础设施；未容器化应用 |
| 磁盘文件系统 | `server/uploads` 逻辑路径、DocumentStorageService | 避免把文件放入内存/数据库，保存原始上传供后续解析 | 是，T04 的正式文件存储 |
| pnpm workspace | `pnpm-workspace.yaml`、`pnpm-lock.yaml` | 在同一仓库管理前后端依赖和脚本 | 是，属于开发工具链 |

# 10. 关键代码定位表

| 功能 | 入口文件 | 核心类/方法 | 作用 |
|---|---|---|---|
| 后端启动 | `server/src/main.ts` | `bootstrap()` | 创建 Nest、注册全局前缀/管道/过滤器/拦截器/CORS/Swagger并监听端口 |
| 模块总装配 | `server/src/app.module.ts` | `AppModule` | 装配 Config、TypeORM、Database、Health、KnowledgeBase、Document |
| 环境变量校验 | `server/src/config/env.validation.ts` | `EnvironmentVariables`、`validateEnvironment()` | 转换和验证启动所需变量，失败时阻止监听 |
| 类型化配置 | `server/src/config/configuration.ts` | `configuration()` | 生成 server/database/upload 嵌套配置并解析上传绝对路径 |
| 数据库运行时配置 | `server/src/database/typeorm.config.ts` | `TypeOrmConfigService.createTypeOrmOptions()` | 注册实体/migration，关闭 synchronize，开启手动初始化 |
| TypeORM CLI 配置 | `server/src/database/data-source.ts` | 默认导出的 `DataSource` | 为 generate/run/revert/show 提供 CLI 连接 |
| 实体统一注册 | `server/src/database/entities.ts` | `AppEntities` | 保证运行时和 CLI 使用同一组六个实体 |
| 数据库初始化 | `server/src/database/database.service.ts` | `ensureReady()`、`initializeAndRunMigrations()` | 初始化连接、执行 migration、共享并重置 readiness Promise |
| 初始 migration | `server/src/database/migrations/1784800736682-InitSchema.ts` | `up()`、`down()` | 创建/删除六张业务表、索引和五条 FK |
| 名称唯一 migration | `server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts` | `up()`、`down()` | 在 `idx_name` 与 `uk_name` 之间迁移 |
| 健康检查入口 | `server/src/modules/health/health.controller.ts` | `HealthController.getHealth()` | 暴露 `GET /api/health` |
| 健康检查逻辑 | `server/src/modules/health/health.service.ts` | `HealthService.getHealth()` | 确保 DB/migration 就绪、执行 `SELECT 1`、返回 up/down |
| 全局成功响应 | `server/src/common/interceptors/response.interceptor.ts` | `ResponseInterceptor.intercept()` | 包装普通成功响应，排除 `StreamableFile` 和 SSE |
| 全局异常响应 | `server/src/common/filters/http-exception.filter.ts` | `HttpExceptionFilter.catch()` | 统一 DTO、HTTP、Multer、数据库和未知异常 |
| SSE 包装豁免 | `server/src/common/decorators/skip-response-wrap.decorator.ts` | `SkipResponseWrap()` | 为未来流式端点写入元数据；当前未使用 |
| 正整数 ID | `server/src/common/pipes/parse-positive-int.pipe.ts` | `ParsePositiveIntPipe.transform()` | 把路径字符串转成正整数或抛 400 |
| 知识库创建 | `server/src/modules/knowledge-base/knowledge-base.controller.ts`、`knowledge-base.service.ts` | `create()` | DTO 后转发；预查名称、保存、转换并发重复为 409 |
| 知识库列表/详情 | 同上 | `findAll()`、`findOne()` | 倒序列表、按 ID 查询、404 |
| 知识库删除 | `server/src/modules/knowledge-base/knowledge-base.service.ts` | `remove()` | 预查后删除 MySQL；当前不处理磁盘，且不检查 affected |
| 知识库请求 DTO | `server/src/modules/knowledge-base/dto/create-knowledge-base.dto.ts` | `CreateKnowledgeBaseDto` | trim、类型、非空和长度校验 |
| 上传 HTTP 入口 | `server/src/modules/document/knowledge-base-documents.controller.ts` | `upload()` | 声明 multipart、202、文件字段并调用 Service |
| Multer 配置 | `server/src/modules/document/storage/document-upload.config.ts` | `createDocumentUploadOptions()` | ID/扩展/MIME、大小、临时目录、UUID、半文件清理 |
| PDF 内容校验与扩展名提取 | `server/src/modules/document/document.service.ts` | `assertPdfHeader()`、`getFileExtension()` | 检查 `%PDF-`；从原始文件名提取并规范化扩展名 |
| SHA-256 | `server/src/modules/document/utils/file-hash.util.ts` | `computeFileSha256()` | 流式计算文件内容 hash |
| 文件存储 | `server/src/modules/document/storage/document-storage.service.ts` | `moveTemporaryFile()` | 移动到 KB 目录，跨设备 copy+unlink |
| 临时/最终清理 | 同上 | `cleanupTemporaryFile()`、`deleteByStoragePath()` | best-effort 删除并记录 warn |
| 文档上传业务 | `server/src/modules/document/document.service.ts` | `upload()` | KB/PDF/hash/去重/移动/事务/死锁重试/补偿 |
| 文档列表/详情 | 同上 | `findAll()`、`findOne()` | KB 存在性、倒序列表、元数据详情 |
| 文档删除 | 同上 | `remove()` | 事务删除、affected 检查、计数递减、提交后删文件 |
| documentCount 维护 | 同上 | `upload()`、`remove()` | 上传时 `increment`，删除时 `GREATEST(...-1,0)`，均与文档写操作同事务 |
| 文档响应边界 | `server/src/modules/document/dto/document-response.dto.ts` | `DocumentResponseDto.fromEntity()` | 显式映射十个公开字段，隐藏 hash/path |
| 前端 Axios 解包 | `web/src/api/http.ts` | response interceptor | 把 `response.data` 替换为 envelope 内层 data，再返回原 `AxiosResponse` |
| 前端健康请求 | `web/src/api/health.ts` | `getHealth()` | 调用 `GET /health` 并返回解包后的 `HealthResult` |
| 前端健康页 | `web/src/views/HomePage.vue` | `handleCheck()` | 调用健康 API、维护 loading、显示结果/错误 |

# 11. 当前未完成内容

## 11.1 建议优先级

| 优先级 | 模块 | 当前状态 | MVP 属性 | 完成定义 |
|---|---|---|---|---|
| P0 | 修复现有文档生命周期一致性 | 已知缺口 | MVP 必做 | 删除知识库同步清理/可重试清理磁盘；并发删库检查 affected；处理孤儿文件和 failed 重试策略 |
| P1 | 文本解析 | 未开始 | MVP 必做 | PDF/MD/TXT 能提取可用文本；PDF 保留页码；空/坏文档进入 failed |
| P1 | 文本清洗 | 未开始 | MVP 必做 | 统一空白、不可见字符等规则，保留可解释性 |
| P1 | 文本分片和 DocumentChunk 写入 | 表结构已准备，业务未开始 | MVP 必做 | 稳定 chunkIndex、pageNo、charCount，事务写入 chunk，维护 chunkCount，并让文档详情增量提供切片预览 |
| P2 | Embedding 服务 | 未开始 | MVP 必做 | 环境变量化模型配置、批量请求、超时/重试、维度确认 |
| P2 | Qdrant collection | 容器就绪，应用未开始 | MVP 必做 | collection 自举、距离/维度校验、错误 fail-fast |
| P2 | Qdrant upsert 与删除 | 未开始 | MVP 必做 | 每个 chunk 使用 qdrantPointId，payload 可定位 KB/文档/chunk；删除文档/KB 清向量 |
| P3 | 向量召回 | 未开始 | MVP 必做 | question embedding、按 knowledgeBaseId filter、TopK 和 scoreThreshold |
| P3 | TopK/scoreThreshold 配置 | 只有总体设计 | MVP 必做 | 有明确默认值、输入边界和无命中分支 |
| P3 | 上下文与 Prompt 组装 | 未开始 | MVP 必做 | 按分数排序、来源标记、长度截断、只按资料回答 |
| P3 | LLM 调用 | 未开始 | MVP 必做 | 同步基础问答先闭环；无检索命中时不调用模型 |
| P4 | SSE | 只有包装豁免 | MVP 必做 | POST 流式端点、token/references/done/error 事件、断开处理 |
| P4 | 会话和消息 | 只有实体/表 | MVP 必做 | Conversation/Message Service/API、用户问题和助手答案落库 |
| P4 | 引用来源 | 只有实体/表 | MVP 必做 | 回答时写 MessageReference，详情接口能返回文档、片段、页码、分数和快照 |
| P5 | 完整前端页面 | 只有健康页 | MVP 必做 | 知识库、文档上传/状态、对话、SSE 增量渲染、引用展示及错误/空态 |
| P6 | 日志、测试和交付 | 未完成 | MVP 发布前必做 | 单测/集成测试、上传/RAG 异常覆盖、server/web Dockerfile、四服务 Compose、README 可复现 |
| 可选 | Rerank | 未开始 | 可选优化 | 基础 TopK 检索质量验证后再决定；不阻塞 MVP |

## 11.2 下一阶段最小闭环

最合理的下一步不是直接接 LLM，而是先完成一个可核对的“切片阶段里程碑”：

```text
pending 文档
  → 解析
  → 清洗
  → 分片
  → 写 DocumentChunk
  → 保持明确的待 Embedding/处理中状态
```

写完 DocumentChunk **不能**标记 `completed`。只有继续完成下面这段，整个文档入库才算闭环：

```text
DocumentChunk
  → status=embedding
  → Embedding
  → Qdrant upsert
  → status=completed
  → 向量召回
```

任一处理步骤失败才进入 `failed` 并记录 `errorMessage`。

这样每一段都能独立核对 MySQL 行、状态、切片内容和 Qdrant point 数量；否则直接做问答会难以判断问题出在解析、分片、向量还是 Prompt。

## 11.3 MVP 与可选优化的边界

MVP 必做的是完整、可追溯的基本 RAG 闭环：解析、清洗、分片、chunk 落库、Embedding、Qdrant、TopK/阈值、上下文、LLM、SSE、会话/消息/引用以及最小业务前端。基础错误处理、状态失败落库、删除向量和自动化验证也属于可演示 MVP 的可靠性要求。

Rerank、OCR、复杂页眉页脚识别、Agent、多租户、鉴权、微服务、消息队列、GraphRAG、知识图谱和高级可观测性都可以后置；其中 Rerank 在总体方案中明确是基础版本后的可选优化。

# 12. 面试讲解版本

## 3 分钟版本

> 我做的是一个 Mini RAG 知识库系统，目标是把 PDF、Markdown 和 TXT 变成可检索的知识，再根据检索结果让模型回答，并把引用来源展示出来。项目用 Vue 3 做前端，NestJS 做后端，MySQL 保存业务数据和未来的切片原文，Qdrant 负责未来的向量检索；开发环境由 pnpm workspace 和 Docker Compose 组织。
>
> 我会先说明当前真实进度：代码层面已经实现到 T04，也就是工程基础、六张表、知识库管理，以及文档上传和管理。相关路由已经注册，设计上可通过 Swagger 或 API 客户端调用，但仓库没有保留 T04 的运行验收报告。前端目前只有健康检查页；解析、Embedding、向量召回和 LLM 还没有实现，所以我不会把它说成已经能问答的 RAG。
>
> 后端的普通请求是 Controller 接收 HTTP，ValidationPipe 做参数转换和校验，Service 处理业务规则，TypeORM Repository 或事务访问 MySQL，最后由全局拦截器统一包装响应。数据库启动失败时，Nest 进程仍能起来，健康接口返回 HTTP 200 但 `db=down`，恢复后健康请求会重新尝试初始化和 migration。
>
> 当前最完整的一条业务链是文件上传。Multer 在落盘前先校验知识库 ID、扩展名和 MIME，再用 UUID 把文件流写进临时目录；大小上限是在这个写入过程中生效，超限后的部分文件由 storage 清理。Service 再检查知识库、PDF 文件头，流式计算 SHA-256，并用 `(kbId,fileHash)` 去重。文件移动到正式目录后，在一个数据库事务里保存 Document 并更新 `documentCount`；事务失败时，数据库自动回滚，代码再补偿删除磁盘文件。这样把数据库一致性和文件系统没有事务这个现实问题分开处理。
>
> 数据模型已经为下一阶段留好了位置：`document_chunk` 保存切片原文、页码和 Qdrant point ID，`message_reference` 保存回答引用的内容快照。下一步会按解析、清洗、分片、Embedding、Qdrant upsert、检索、上下文、LLM、SSE 和引用的顺序逐段打通，而不是直接跳到模型调用。
>
> 目前我最关注的已知问题是：删除知识库只会级联删 MySQL 记录，不会清理磁盘文件；文件补偿是 best-effort，进程崩溃仍可能产生孤儿文件；前端业务页面和真正的 RAG 链路还没有开始。这些边界在项目说明里会明确讲清楚。

## 8 分钟版本

> 这个项目的背景是，我想做一个规模不大、但每一层都能讲清楚的 RAG 系统。用户把自己的文档放进一个知识库，提问时系统只从选定知识库找相关资料，再让模型根据这些资料回答。相比直接调一个聊天 API，这个项目更能体现文件处理、数据建模、检索、生成和一致性设计。
>
> 整体是一个 pnpm workspace，前端在 `web`，后端在 `server`。Vue 3 前端现在只做了健康检查壳；Vite 把浏览器的 `/api` 请求代理到 3000 端口。NestJS 后端按模块组织，已经有 health、knowledge-base 和 document。MySQL、Qdrant 由 Docker Compose 启动，不过当前应用只真正连接 MySQL，Qdrant 还只是基础设施。
>
> 后端启动时，ConfigModule 从环境变量生成类型化配置，class-validator 会检查端口、数据库、Qdrant URL 和上传大小。TypeORM 关闭了 synchronize，所有表结构都走 migration。运行时 DataSource 由 DatabaseService 手动初始化并执行 migration；这样 MySQL 暂时挂掉时，Nest 进程不一定跟着退出，健康检查可以显示 `db=down`，数据库恢复后再重试。普通成功响应会统一包装，异常也由全局过滤器转换成稳定结构。
>
> 关系库现在定义了六张业务表。`knowledge_base` 是知识库；`document` 保存原文件名、大小、SHA-256、磁盘路径和处理状态；`document_chunk` 为未来切片保留原文、页码和 Qdrant point ID。另一条关系是 conversation、message、message_reference，用来保存会话、问答和引用快照。引用快照不把 documentId、chunkId 做成强外键，这样单独删除文档后，历史回答仍能说明当时引用了什么。
>
> 知识库模块已经实现创建、列表、详情和删除。创建时 DTO 会 trim 名称，校验非空和长度。Service 先查询同名知识库，让普通重复请求尽早拿到 409；但预查询无法解决并发，所以数据库还有 `uk_name` 唯一约束。如果两个请求同时创建同名，最终 MySQL 保证只插入一个，Service 把 `ER_DUP_ENTRY` 转成 409，而不是把数据库错误暴露成 500。
>
> 文档上传是当前最值得展开讲的一段。请求进来后，FileInterceptor 先运行。Multer 的 fileFilter 在落盘前检查路径里的知识库 ID、扩展名和 MIME；合法文件才会进入 `.tmp`，而且磁盘名不是原始文件名，是 UUID 加小写扩展名。这样不会因为用户文件同名而覆盖，也避免把用户输入直接拼进路径。大小限制在接收流期间生效，PDF 落盘后还会检查前五个字节是不是 `%PDF-`。
>
> 接着 Service 用流读取临时文件计算 SHA-256。不能只用文件名去重，因为同一个内容可能被改名，不同内容也可能同名。唯一约束选择 `(kb_id,file_hash)`，表示同一个知识库不接受相同内容，但同一份公共文档可以分别放进两个知识库。应用先查一次是为了友好提示，数据库复合唯一索引负责关闭并发窗口。
>
> 去重通过后，文件先移动到 `{kbId}/{uuid.ext}`。一般用 rename；如果临时目录和正式目录跨设备，就用 copy 加 unlink。然后用 TypeORM transaction 同时保存 Document 和递增 `documentCount`。这两项必须原子提交，否则会出现列表有文档但计数没变，或者计数变了却没有文档。并发插入和更新同一个知识库计数行可能死锁，所以当前实现会重试一次整个事务。
>
> 这里还有一个很典型的一致性问题：MySQL 事务不能回滚文件系统。当前方案是先让文件就位，再开数据库事务；事务失败时数据库自动回滚，应用补偿删除最终文件。如果失败发生在临时阶段，就删临时文件。删除文档时顺序反过来，先在事务里删记录并递减计数，提交后再删磁盘。磁盘删除失败只告警，接口仍然成功，因为数据库已经提交且当前以数据库为权威，已经无法再 rollback；失败的文件转成后续清理债务。我要强调补偿是 best-effort，不是严格分布式事务，进程崩溃或权限错误仍可能留下孤儿文件。
>
> 当前代码还没有进入真正的 RAG。上传后状态固定为 `pending`，没有 parser，没有 DocumentChunk 写入，没有 Embedding 客户端，也没有 Qdrant collection、upsert 或 search，更没有 LLM 和 SSE 端点。已有的 `parsing/chunking/embedding/completed/failed` 状态、chunk 表、qdrantPointId、会话和引用表只是为后续准备。
>
> 下一步我会先完成文档入库闭环：三种格式解析、清洗、分片、批量写 chunk，再接 Embedding 和 Qdrant，确保 `chunk_count`、MySQL 行数和 point 数量能核对。查询侧再做 question embedding、按 knowledgeBaseId 过滤、TopK 和阈值；没有命中时直接返回“未找到”，不调用 LLM。命中后才组装带来源标记的上下文，调用模型，最后增加 SSE、会话落库和引用快照。Rerank 会放在基础召回质量验证之后，作为可选优化。
>
> 如果问当前项目的问题，我会如实回答三个：第一，删除知识库依赖数据库级联，但没有同步清磁盘目录；第二，环境文件定位和 Vite 代理端口还有开发环境耦合；第三，T04 没有仓库内的完成报告和自动化测试，前端也没有业务页面。这些都不是隐藏的，而是下一阶段需要收口的工程项。

# 13. 我的最低学习清单

目标不是背装饰器或逐行默写 NestJS、TypeORM、Multer，而是能解释每个模块的“问题、流程、选型、失败语义”。每行严格对应这四项。

| 模块与定位 | 1. 解决什么问题 | 2. 完整运行流程 | 3. 技术及为什么 | 4. 失败时如何处理 |
|---|---|---|---|---|
| 工程启动与请求转发<br>`pnpm-workspace.yaml`、`web/vite.config.ts`、`server/src/main.ts` | 让前后端和基础设施在一个仓库中可独立启动、能互相请求 | pnpm filter 启动 Vite/Nest；浏览器 `/api` 经代理到全局前缀路由 | pnpm 管依赖；Vite 提供开发代理；Nest 建 HTTP 应用 | 前端请求 catch 后提示；后端 bootstrap 失败记录并退出 |
| 配置与数据库就绪<br>`config/`、`database/database.service.ts`、`health/` | 避免带错误配置启动，并让数据库故障对进程可见 | 加载 `.env` → 校验 → 创建手动 DataSource → 初始化/migration → `SELECT 1` | ConfigModule 做集中配置；class-validator fail-fast；TypeORM DataSource 复用业务连接 | 配置错直接退出；DB 错启动钩子记录，health 返回 `db=down` 并允许重试 |
| 数据模型与 migration<br>`database/entities.ts`、`database/migrations/` | 用可审查方式维护六张表、索引和级联关系 | 改实体 → generate migration → 审查 → run；需要时 revert 最新一条 | TypeORM 实体表达模型；migration 代替 synchronize，保证可复现/回滚 | migration 失败时 readiness 失败；不允许自动改表掩盖差异 |
| 统一 HTTP 边界<br>`common/interceptors/`、`common/filters/`、`common/pipes/` | 让成功、参数错误、数据库错误和上传错误有一致契约 | Pipe 校验 → Controller/Service → interceptor 包成功；异常交给 filter | ValidationPipe 减少重复校验；Interceptor 统一 envelope；Filter 隐藏内部错误 | 400/404/409/413/415/500 按异常类型输出；SSE/文件绕过普通包装 |
| 知识库管理<br>`modules/knowledge-base/` | 管理文档所属容器并保证名称唯一 | DTO trim/校验 → Controller → Service 预查 → Repository save/find/delete → DTO | Controller 保持薄；Repository 简化 CRUD；DB unique 关闭并发窗口 | 参数 400、重名 409、不存在 404、DB 500；当前删库磁盘清理是已知缺口 |
| 上传校验与哈希<br>`document-upload.config.ts`、`file-hash.util.ts` | 按配置受控接收文件，并按内容识别重复 | fileFilter → UUID 临时落盘/大小限制 → PDF 头 → 流式 SHA → 复合键查询 | Multer diskStorage 避免内存；UUID 隔离用户文件名；SHA-256 内容寻址 | 类型 415、超限 413、重复 409；失败按阶段清 tmp/final |
| 文件存储、事务和删除<br>`document.service.ts`、`document-storage.service.ts` | 同时维护文件、Document 记录和 `documentCount` | tmp 移 final → 事务保存+计数；删除时事务删记录+减计数 → 再 unlink | TypeORM transaction 保证 DB 原子性；补偿清理弥补文件系统无事务 | DB 失败回滚并尝试删 final；删除文件失败只 warn；进程崩溃仍可能留孤儿 |
| RAG 数据模型与当前边界<br>`document-chunk.entity.ts`、`conversation/entities/` | 为切片、向量定位、会话和引用追溯设计结构，同时识别尚未实现的部分 | 未来应是解析 → chunk → embedding → Qdrant → search → LLM → SSE → 引用落库 | MySQL 留原文/快照便于审计；QdrantPointId 做跨存储映射；SSE 旁路预留 | 当前没有执行链；以后必须用状态机记录 failed、清理半成品向量并支持可重试 |

最低学习目标可以概括为：会画出请求和数据流，能解释每个一致性边界，知道某个错误最终由哪一层转成什么 HTTP 结果；不需要逐行背框架装饰器或手写 TypeORM/Multer 样板代码。
