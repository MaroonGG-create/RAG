# T02 数据库实体与后端基础能力 — Codex 执行指令

> 任务编号：T02（阶段 P2）
> 前置条件：T01 已完成（以 `docs/01-current-implementation.md` 快照为准）
> 设计基线：`docs/00-overall-plan.md`（含 v1.1 修订记录，本任务涉及的基线变更已回填）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前已有实现（判断依据：01-current-implementation.md）

以下事实来自实现快照，**不要凭 T01 原始指令推测**：

### 1.1 已存在、本任务在其上扩展

| 现状 | 说明 |
|---|---|
| TypeORM 已接入 | 已安装 `typeorm@0.3.31`、`@nestjs/typeorm@10.0.2`、`mysql2@3.23.1`；`AppModule` 已注册 `TypeOrmModule.forRootAsync`，工厂为 `TypeOrmConfigService`。**本任务不需要、也不允许重建第二套连接** |
| 当前 TypeORM 配置 | `type: mysql`、`entities: []`、`synchronize: true`、`manualInitialization: true` |
| 健康检查 | `HealthService` 注入 TypeORM `DataSource`，懒初始化（共享 Promise、失败清空可重试）后 `SELECT 1`；失败返回 `db: "down"` 且保持 HTTP 200。**不存在裸 mysql2 连接代码** |
| 配置体系 | `ConfigModule` 全局；`envFilePath: resolve(process.cwd(), '../.env')`；`configuration.ts` 嵌套键；`env.validation.ts` 用 class-validator 校验 7 个变量 |
| main.ts | 全局前缀 `api`、`ValidationPipe({ whitelist: true })`、CORS 按配置、失败 `process.exit(1)` |
| 代码约定 | 文件名小写点分隔；类 PascalCase；方法显式返回类型；catch 用 `unknown`；无显式 `any`；特殊处理写简短中文注释 |

### 1.2 当前缺失、本任务要补齐

- `src/common/`（统一异常过滤器、统一响应拦截器）
- 数据库实体、实体注册机制、migration 基础设施（CLI DataSource、脚本、目录）
- 环境变量校验未覆盖 `QDRANT_URL`

### 1.3 与 T01 原始指令的差异（以现状为准，不得"回滚到指令描述"）

1. `@nestjs/typeorm` 是计划外但必要的依赖，保留。
2. `manualInitialization: true` 是计划外配置，用于"DB 不可用时应用仍可启动"，**保留语义但调整实现归属**（见 §三.3）。
3. 根目录没有 `package.json` 与 `packageManager` 字段——本任务**不处理**，保持现状。
4. 前端 `HomePage.vue` 直接渲染无路由、`http.ts` 拦截器把错误统一转为 `Error`——本任务只对 `http.ts` 做响应包装适配，不做其他前端改动。

### 1.4 环境前置阻塞（先解决再验收，不属于代码改动）

当前宿主机 Windows 服务 `MySQL80` 占用 3306，Compose MySQL 为 Exited，健康检查 `db: "down"`。**开始验收前必须二选一**：① 停止 Windows `MySQL80` 服务后 `docker compose up -d`；② 临时改 compose 端口映射并同步 `DB_PORT`。推荐 ①。此事项写入 README 常见问题。

---

## 二、本任务目标与范围

只做以下九件事，多做任何一件都算越界：

1. TypeORM 正式化：`synchronize` 固定为 `false`，实体显式注册。
2. 独立 CLI DataSource + migration 机制（CLI 必须能读根 `.env`）。
3. 6 个实体及关系、索引、唯一约束、外键（见 §四）。
4. 首个 migration `InitSchema` 落库。
5. 环境变量校验补充 `QDRANT_URL`。
6. 统一异常过滤器（全局）。
7. 统一普通接口响应结构（全局拦截器 + SSE 预留排除机制）。
8. 数据库初始化/迁移逻辑上移至 `DatabaseService`，健康检查调整为消费方。
9. 前端 `http.ts` 适配新响应包装。

---

## 三、关键设计决策（十条，逐条冻结）

### 3.1 schema 管理：migration 唯一入口

- `synchronize: false` 写死并加中文注释"禁止改为 true，表结构只能经 migration 变更"。
- 所有 DDL 只能来自 `src/database/migrations/` 下的 migration 文件。
- Nest 运行时不自动生成任何表；启动时通过 `DatabaseService` 执行 `runMigrations()`。

### 3.2 TypeORM CLI 读取根 .env 的方案

- 新增 `server/src/database/data-source.ts`，导出 `new DataSource({...})` 供 CLI `-d` 使用。
- 文件顶部用 `dotenv` 显式加载：`dotenv.config({ path: resolve(__dirname, '../../../.env') })`。
  - 源码态 `src/database/` 与编译态 `dist/database/` 深度相同，向上三级均为仓库根，因此**不依赖 process.cwd()**，从任何目录执行都正确。这一写法要加中文注释说明。
- CLI 命令固定经 pnpm filter 执行（cwd=server），但路径方案本身已消除 cwd 依赖。

### 3.3 健康检查与数据库连接方案：保留 DataSource 方案，调整归属

结论：**不存在裸 mysql2 检查，无需删除；保留 TypeORM DataSource 健康检查，但把"初始化 + migration"职责从 HealthService 上移到新的 `DatabaseService`**。理由：

- 现状初始化逻辑藏在 HealthService 里，bootstrap 阶段无法复用，migration 没有执行入口。
- 调整后形成单一初始化路径：`DatabaseService.ensureReady()` = 共享 Promise 的 `dataSource.initialize()` + `runMigrations()`，失败清空 Promise 允许重试（沿用现有语义，不是重写）。
- 两个消费方：① `OnApplicationBootstrap` 钩子（启动时尝试一次，失败仅 `console.error`，进程不退出——保持 T01"DB 挂可启动"行为）；② `HealthService`（每次健康请求调用，兼作失败后的重试触发点）。
- `db` 字段含义收紧为：**连接成功且 migration 已就绪**才为 `up`。migration 失败时 `db: "down"`，真实原因在服务端日志。

### 3.4 主键：INT UNSIGNED，前后端 ID 统一 number

- 全部主键/外键 `INT UNSIGNED`（上限 4,294,967,295 < `Number.MAX_SAFE_INTEGER`）。
- 后端实体 ID 属性类型 `number`；前端类型定义（T03 起）一律 `number`。
- 唯一例外：`document.file_size` 用 `BIGINT UNSIGNED`（字节数），TS 类型仍为 `number`，加注释说明 MVP 20MB 上传限制下无精度风险。

### 3.5 Message 增加生成状态字段

- `status ENUM('completed','failed') NOT NULL DEFAULT 'completed'`
- `error_message TEXT NULL`
- 语义约定（T11/T12 会用到）：user 消息恒为 `completed`；assistant 消息在 SSE 流结束后落库，成功为 `completed`，模型调用失败/中断时保存已生成部分内容、`status='failed'`、`error_message` 记录原因。**本任务只建字段，不实现该流程。**

### 3.6 MessageReference.score 的 DECIMAL 转换策略

- DB 列 `DECIMAL(5,4) NOT NULL`；TypeORM 实体 TS 类型为 `number`。
- mysql2 驱动对 DECIMAL 默认返回 **string**，因此实体列必须加值转换器：`from: (v: string) => Number(v)`，`to: (v: number) => v`，并加中文注释说明原因。
- 禁止把实体属性声明成 `string` 来回避转换（引用相似度在前端要参与数值展示/排序）。

### 3.7 关系加载：禁止 eager，显式查询

- 所有 `@ManyToOne` / `@OneToMany` 一律不写 `eager: true`（TypeORM 默认即非 eager，**本约定是"禁止任何人打开"**，实体评审时检查）。
- 需要关联数据时由查询方显式 `relations: [...]` 或 join（T03 起遵守）。
- 级联只体现在数据库外键 `ON DELETE CASCADE`；实体关系选项同步声明 `onDelete: 'CASCADE'`，不使用 TypeORM 应用层 `cascade: true` 保存。

### 3.8 外键标量与关系字段命名规范

- 标量外键属性：`<关系名 camelCase>Id`，如 `kbId`、`documentId`、`conversationId`、`messageId`，显式 `@Column({ name: 'kb_id', ... })`。
- 关系属性：实体名 camelCase，如 `knowledgeBase`、`document`、`conversation`、`message`，配 `@JoinColumn({ name: 'kb_id' })`。
- DB 列名统一 snake_case 显式声明（不引入 naming-strategy 依赖）；TS 属性统一 camelCase。
- 不设外键的冗余 ID 列同样遵守（如 `document_chunk.kbId`、`message_reference.documentId/chunkId`），用注释标明"无 FK 冗余列"。

### 3.9 统一响应包装与 SSE 排除机制

- 成功响应统一包装为：`{ code: 0, message: 'success', data: T }`。
- 错误响应统一为：`{ code: <HTTP 状态码>, message: <string>, details?: unknown }`。
- 排除机制（本任务实现机制、不实现 SSE 本身）：
  - 新增 `@SkipResponseWrap()` 装饰器（`SetMetadata`），`ResponseInterceptor` 用 `Reflector` 检测 handler/controller 元数据，命中则原样透传；
  - 拦截器同时检查 `response.getHeader('content-type')`，含 `text/event-stream` 时透传（双保险，加注释）；
  - `StreamableFile` 或响应已 `headersSent` 时透传。
- 204 删除接口后续返回空体，拦截器对 `undefined` 数据返回 `{ code: 0, message: 'success', data: null }`（T03 起约定删除接口加 `@HttpCode(204)`，空体自动不经过包装问题，此处只做防御）。

### 3.10 最小改动原则

- 不允许为了模板化重命名/移动 T01 已有文件；只允许 §五列出的修改。
- `manualInitialization: true` 保留；`envFilePath` 的 cwd 依赖**本任务不改**（已知问题，T15 统一处理）；Vite 代理端口写死**不改**；前端失败态保留旧数据**不改**。

---

## 四、实体设计（冻结级，逐字段照此实现）

> 通用约定：表名即下列 snake_case 名；全部 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`；每表含 `created_at` / `updated_at`（TIMESTAMP，分别用 `@CreateDateColumn` / `@UpdateDateColumn`）。所有 ID 类列 `INT UNSIGNED`。枚举用 TS 联合类型 + TypeORM `enum`。

### 4.1 knowledge_base

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| name | string | name VARCHAR(100) | NOT NULL |
| description | string \| null | description VARCHAR(500) | NULL |
| documentCount | number | document_count INT UNSIGNED | NOT NULL DEFAULT 0 |
| createdAt / updatedAt | Date | created_at / updated_at TIMESTAMP | |

- 索引：`idx_name(name)`
- 关系：`documents: OneToMany → Document`；`conversations: OneToMany → Conversation`

### 4.2 document

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| kbId | number | kb_id INT UNSIGNED | NOT NULL，FK → knowledge_base.id，ON DELETE CASCADE |
| fileName | string | file_name VARCHAR(255) | NOT NULL |
| fileExt | string | file_ext VARCHAR(10) | NOT NULL（pdf/md/txt 由应用层校验，建注释） |
| fileSize | number | file_size BIGINT UNSIGNED | NOT NULL（见 §3.4 例外说明） |
| fileHash | string | file_hash CHAR(64) | NOT NULL，SHA-256 |
| storagePath | string | storage_path VARCHAR(500) | NOT NULL |
| status | `'pending'\|'parsing'\|'chunking'\|'embedding'\|'completed'\|'failed'` | status ENUM(同左) | NOT NULL DEFAULT 'pending' |
| errorMessage | string \| null | error_message TEXT | NULL |
| chunkCount | number | chunk_count INT UNSIGNED | NOT NULL DEFAULT 0 |
| createdAt / updatedAt | Date | TIMESTAMP | |

- 唯一约束：`uk_kb_hash(kb_id, file_hash)`（去重核心）
- 索引：`idx_kb_status(kb_id, status)`
- 关系：`knowledgeBase: ManyToOne → KnowledgeBase`（`onDelete: 'CASCADE'`，`@JoinColumn({ name: 'kb_id' })`）；`chunks: OneToMany → DocumentChunk`

### 4.3 document_chunk

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| documentId | number | document_id INT UNSIGNED | NOT NULL，FK → document.id，ON DELETE CASCADE |
| kbId | number | kb_id INT UNSIGNED | NOT NULL，**无 FK 冗余列**（注释：chunk 生命周期跟随 document，此列仅供按库直查） |
| chunkIndex | number | chunk_index INT UNSIGNED | NOT NULL |
| content | string | content TEXT | NOT NULL |
| charCount | number | char_count INT UNSIGNED | NOT NULL |
| pageNo | number \| null | page_no INT UNSIGNED | NULL（MD/TXT 为 NULL） |
| qdrantPointId | string | qdrant_point_id CHAR(36) | NOT NULL |
| createdAt / updatedAt | Date | TIMESTAMP | |

- 唯一约束：`uk_doc_index(document_id, chunk_index)`；`uk_qdrant_point(qdrant_point_id)`
- 索引：`idx_kb(kb_id)`
- 关系：`document: ManyToOne → Document`（`onDelete: 'CASCADE'`）

### 4.4 conversation

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| kbId | number | kb_id INT UNSIGNED | NOT NULL，FK → knowledge_base.id，ON DELETE CASCADE |
| title | string | title VARCHAR(200) | NOT NULL |
| createdAt / updatedAt | Date | TIMESTAMP | |

- 索引：`idx_kb(kb_id)`（v1.1 新增）
- 关系：`knowledgeBase: ManyToOne`；`messages: OneToMany → Message`

### 4.5 message

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| conversationId | number | conversation_id INT UNSIGNED | NOT NULL，FK → conversation.id，ON DELETE CASCADE |
| role | `'user'\|'assistant'` | role ENUM(同左) | NOT NULL |
| content | string | content TEXT | NOT NULL |
| status | `'completed'\|'failed'` | status ENUM(同左) | NOT NULL DEFAULT 'completed'（v1.1 新增） |
| errorMessage | string \| null | error_message TEXT | NULL（v1.1 新增） |
| createdAt / updatedAt | Date | TIMESTAMP | |

- 索引：`idx_conv(conversation_id, id)`
- 关系：`conversation: ManyToOne`；`references: OneToMany → MessageReference`

### 4.6 message_reference

| TS 属性 | TS 类型 | DB 列 | 约束 |
|---|---|---|---|
| id | number | id INT UNSIGNED | PK AUTO_INCREMENT |
| messageId | number | message_id INT UNSIGNED | NOT NULL，FK → message.id，ON DELETE CASCADE |
| documentId | number \| null | document_id INT UNSIGNED | NULL，**无 FK 快照列** |
| chunkId | number \| null | chunk_id INT UNSIGNED | NULL，**无 FK 快照列** |
| documentName | string | document_name VARCHAR(255) | NOT NULL |
| chunkIndex | number | chunk_index INT UNSIGNED | NOT NULL |
| pageNo | number \| null | page_no INT UNSIGNED | NULL |
| score | number | score DECIMAL(5,4) | NOT NULL，**必须加 §3.6 转换器** |
| contentSnapshot | string | content_snapshot TEXT | NOT NULL |
| createdAt / updatedAt | Date | TIMESTAMP | |

- 索引：`idx_msg(message_id)`
- 关系：`message: ManyToOne → Message`（`onDelete: 'CASCADE'`）

---

## 五、文件清单

### 5.1 新增文件（server/，共 13 个）

| 文件 | 职责 |
|---|---|
| `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | KnowledgeBase 实体（§4.1） |
| `src/modules/document/entities/document.entity.ts` | Document 实体（§4.2） |
| `src/modules/document/entities/document-chunk.entity.ts` | DocumentChunk 实体（§4.3） |
| `src/modules/conversation/entities/conversation.entity.ts` | Conversation 实体（§4.4） |
| `src/modules/conversation/entities/message.entity.ts` | Message 实体（§4.5） |
| `src/modules/conversation/entities/message-reference.entity.ts` | MessageReference 实体（§4.6） |
| `src/database/entities.ts` | 导出 `AppEntities` 数组（显式列出 6 个实体类），供 Nest 配置与 CLI DataSource 共同引用，保证两处实体集合一致 |
| `src/database/data-source.ts` | TypeORM CLI 专用独立 DataSource：dotenv 按 `__dirname` 定位根 `.env`（§3.2），`entities: AppEntities`，`migrations` 指向 `./migrations/*{.ts,.js}`，`synchronize: false` |
| `src/database/database.module.ts` | 声明并导出 `DatabaseService` |
| `src/database/database.service.ts` | 单一初始化路径 `ensureReady()`（共享 Promise：initialize → runMigrations，失败清空 Promise 可重试）+ `OnApplicationBootstrap` 启动尝试（失败仅日志不退出）（§3.3） |
| `src/database/migrations/<timestamp>-init-schema.ts` | 首个 migration（§八） |
| `src/common/filters/http-exception.filter.ts` | 全局异常过滤器（§6.2） |
| `src/common/interceptors/response.interceptor.ts` | 统一响应包装拦截器（§6.1） |
| `src/common/decorators/skip-response-wrap.decorator.ts` | `@SkipResponseWrap()` 元数据装饰器（§3.9） |

> 实体放在各业务模块的 `entities/` 子目录是有意为之：模块内聚，T03+ 在同一模块目录加 controller/service/dto 即可。**本任务不创建这些模块的 module/controller/service 文件。**

### 5.2 修改文件（server/，共 6 个）

| 文件 | 修改内容 |
|---|---|
| `src/database/typeorm.config.ts` | `entities` 改为引用 `AppEntities`；`synchronize: false` 并加禁止改回注释；补 `migrations` glob（运行时 `runMigrations` 需要）；保留 `manualInitialization: true`；其余不动 |
| `src/app.module.ts` | imports 增加 `DatabaseModule`（置于 HealthModule 之前） |
| `src/modules/health/health.module.ts` | imports 增加 `DatabaseModule` |
| `src/modules/health/health.service.ts` | 改为注入 `DatabaseService`，检查逻辑 = `await ensureReady()` → `SELECT 1`；删除本类内的初始化 Promise 逻辑（上移）；保持返回值结构与"失败仍 200、db=down"语义不变 |
| `src/main.ts` | 仅追加两行全局注册：`useGlobalFilters(new HttpExceptionFilter())`、`useGlobalInterceptors(new ResponseInterceptor(new Reflector()))`；其余配置不动 |
| `src/config/env.validation.ts` | 新增 `QDRANT_URL` 校验：`@IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })`（已有 `.env`/`.env.example` 均含此变量，不影响现有环境） |

### 5.3 修改文件（web/，共 1 个）

| 文件 | 修改内容 |
|---|---|
| `src/api/http.ts` | 响应拦截器适配包装结构：HTTP 2xx 且响应体为 `{ code, message, data }` 形态时返回 `data`；错误时优先取服务端错误体的 `message` 生成 `Error`（取不到再回退现有逻辑）。**`types/health.ts`、`HomePage.vue`、`App.vue` 不允许改动**——适配后首页应无感工作 |

### 5.4 修改文件（根目录，共 2 个）

| 文件 | 修改内容 |
|---|---|
| `README.md` | 新增"数据库迁移"小节（四条脚本命令及用途）；常见问题追加 3306 端口冲突处理（§1.4） |
| `.env.example` | 仅追加注释说明 `QDRANT_URL` 自 T02 起被后端校验（值不变） |

---

## 六、接口与错误结构约定（T03+ 的契约，本任务落地机制）

### 6.1 成功响应（ResponseInterceptor）

```jsonc
// GET /api/health 适配后
{ "code": 0, "message": "success", "data": { "status": "ok", "db": "up", "uptime": 12.3 } }
```

### 6.2 错误响应（HttpExceptionFilter，`@Catch()` 全局）

| 异常来源 | HTTP | 响应体 |
|---|---|---|
| `HttpException`（含 404 路由不存在） | 取其 status | `{ code: status, message }`；message 取异常响应体的 message（字符串或数组 join） |
| `ValidationPipe` 校验失败（400） | 400 | `{ code: 400, message: '参数校验失败', details: <原始 message 数组> }` |
| TypeORM `QueryFailedError` | 500 | `{ code: 500, message: '数据库操作失败' }`，完整错误 `console.error`，**不回传 SQL** |
| 其他未知异常 | 500 | `{ code: 500, message: '服务器内部错误' }`，`console.error` 堆栈 |

---

## 七、依赖与 package.json 脚本变化

### 7.1 新增依赖（server/）

| 包 | 版本 | 类型 | 用途 |
|---|---|---|---|
| `dotenv` | `^16.4.5` | dependencies | CLI DataSource 显式加载根 `.env`（§3.2） |
| `ts-node` | `^10.9.2` | devDependencies | `typeorm-ts-node-commonjs` 运行 migration CLI |

- 不引入其他任何依赖（**明确不引入** `typeorm-naming-strategies`、`@nestjs/terminus`、`@nestjs/swagger`）。
- 现有依赖版本一律不动。

### 7.2 server/package.json scripts 追加（原有 dev/build/start 不动）

```jsonc
{
  "scripts": {
    "typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
    "migration:generate": "pnpm run typeorm migration:generate",
    "migration:run": "pnpm run typeorm migration:run",
    "migration:revert": "pnpm run typeorm migration:revert",
    "migration:show": "pnpm run typeorm migration:show"
  }
}
```

用法示例：`pnpm --filter server migration:generate src/database/migrations/InitSchema`。

---

## 八、Migration 内容要求

1. 生成方式：先完成 6 个实体与 CLI DataSource，确保数据库为空库（必要时 `DROP DATABASE` 重建，见 §十），再执行 `migration:generate` 生成 `InitSchema`，**禁止手写后不与实体对账**。
2. 生成后必须人工核对并在汇报中确认：
   - 6 张表 + TypeORM 自动维护的 `migrations` 表；
   - 表级 `ENGINE=InnoDB`、`utf8mb4` / `utf8mb4_unicode_ci`；
   - 5 条外键全部 `ON DELETE CASCADE`（document.kb_id、document_chunk.document_id、conversation.kb_id、message.conversation_id、message_reference.message_id）；
   - `document_chunk.kb_id`、`message_reference.document_id/chunk_id` **没有**外键；
   - 唯一索引：`uk_kb_hash`、`uk_doc_index`、`uk_qdrant_point`；普通索引：`idx_name`、`idx_kb_status`、`idx_kb`（chunk 与 conversation 各一）、`idx_conv`、`idx_msg`；
   - 枚举值与 §四完全一致，默认值正确（document.status='pending'、message.status='completed'）。
3. `down()` 必须完整 drop 全部 6 表（generate 产物通常已满足，逐条核对）。

---

## 九、实现顺序（严格按序，每步可独立验证）

1. `env.validation.ts` 补 `QDRANT_URL`；安装 `dotenv`、`ts-node`。
2. 编写 6 个实体 + `src/database/entities.ts`。
3. 编写 `data-source.ts` + package.json 四条脚本。
4. 改造 `typeorm.config.ts`（synchronize:false、entities、migrations）。
5. 编写 `database.module.ts` + `database.service.ts`，接入 `app.module.ts`；改造 `health.module.ts` / `health.service.ts`。
6. 编写 `common/` 三个文件，接入 `main.ts`。
7. 清空本地 `mini_rag` 库 → `migration:generate` 生成 InitSchema → 按 §八.2 核对 → `migration:run`。
8. 改造 `web/src/api/http.ts`，回归前端健康检查页。
9. 执行 §十一全部验收命令；更新 README。

---

## 十、技术约束与异常场景

### 10.1 技术约束

- 延续现有代码约定（§1.1 最后一行）；枚举同时导出 TS 联合类型常量供后续任务复用（如 `export const DOCUMENT_STATUSES = [...] as const`）。
- 实体中禁止出现业务逻辑方法；禁止 `@BeforeInsert` 等钩子。
- `dataSource.ts` 不得 import 任何 Nest 装饰器/模块（保持 CLI 可独立加载）。
- 全局过滤器/拦截器只在 `main.ts` 注册，不允许再用 `APP_FILTER`/`APP_INTERCEPTOR` 双注册。
- Windows 环境注意：migration 命令不依赖 shell 特性，全部经 pnpm script。

### 10.2 异常场景及预期行为

| 场景 | 预期 |
|---|---|
| 启动时 MySQL 不可用 | 进程不退出；`console.error` 记录；`GET /api/health` 返回 200 且 `data.db="down"` |
| MySQL 恢复后 | 下一次健康请求触发 `ensureReady()` 重试（含补跑 migration），恢复 `db="up"` |
| 重复执行 `migration:run` | TypeORM 按 `migrations` 表跳过已执行项，不报错 |
| `migration:revert` 后再 `migration:run` | 表结构完整重建（幂等验证） |
| 缺 `QDRANT_URL` 启动 | 启动失败，错误信息明确列出变量名 |
| 请求不存在路由 | 404 + 统一错误结构 `{ code: 404, message }` |
| 数据库连接正常但 migration 失败（如手工改过表） | `db="down"`，服务端日志含真实 migration 错误 |
| synchronize 防回归 | `migration:revert` 后重启服务（不跑 run），`SHOW TABLES` 只剩 `migrations` 表——证明没有任何自动建表行为 |

---

## 十一、验收命令与预期结果

> 前置：已按 §1.4 解决 3306 冲突，`docker compose up -d` 且 mysql healthy；`.env` 与 `.env.example` 变量齐全。

```bash
# 0. 静态检查
pnpm --filter server build && pnpm --filter web type-check
# 预期：均 0 error

# 1. 准备空库（清除 synchronize 时代的任何残留）
docker compose exec mysql mysql -uroot -proot123 \
  -e "DROP DATABASE IF EXISTS mini_rag; CREATE DATABASE mini_rag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. migration 工作流
pnpm --filter server migration:show        # 预期：InitSchema 未执行
pnpm --filter server migration:run         # 预期：执行成功
docker compose exec mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：knowledge_base / document / document_chunk / conversation / message / message_reference / migrations 共 7 张

# 3. 结构核对
docker compose exec mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW INDEX FROM document;"
# 预期：含 uk_kb_hash(Non_unique=0) 与 idx_kb_status
docker compose exec mysql mysql -uroot -proot123 -e \
  "SELECT TABLE_NAME, CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='mini_rag';"
# 预期：5 条 FK 全部 CASCADE；document_chunk.kb_id 与 message_reference.document_id/chunk_id 无记录

# 4. 服务启动（启动后自动补跑 migration，此处已跑过应为 no-op）
pnpm --filter server dev
curl http://localhost:3000/api/health
# 预期：{"code":0,"message":"success","data":{"status":"ok","db":"up","uptime":...}}

# 5. 统一错误结构
curl http://localhost:3000/api/not-exist
# 预期：{"code":404,"message":"Cannot GET /api/not-exist"}（允许 message 细节差异，结构必须符合）
curl -X POST http://localhost:3000/api/health
# 预期：404 + 统一结构

# 6. DB 故障与恢复
docker compose stop mysql
curl http://localhost:3000/api/health    # 预期：200，data.db="down"，进程存活
docker compose start mysql
curl http://localhost:3000/api/health    # 预期：data.db="up"

# 7. migration 幂等与 synchronize 防回归
pnpm --filter server migration:run       # 预期：No migrations are pending
pnpm --filter server migration:revert    # 预期：回滚成功
docker compose exec mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW TABLES;"
# 预期：只剩 migrations 表（证明 synchronize 没有自动建表）
pnpm --filter server migration:run       # 恢复

# 8. 环境变量校验
# 临时从 .env 删除 QDRANT_URL 行 → 启动后端
# 预期：启动失败，错误信息含 QDRANT_URL；恢复 .env

# 9. 前端回归
pnpm --filter web dev
# 浏览器打开 http://localhost:5173，点击健康检查按钮
# 预期：正常展示 status/db/uptime（envelope 已被 http.ts 解包），Network 面板响应体为包装结构
```

---

## 十二、明确禁止（本任务一律不实现）

- ❌ 知识库/文档/会话的任何 controller、service、DTO、repository 注册（T03+）
- ❌ Swagger
- ❌ 文件上传、multer
- ❌ 文档解析、文本清洗、切片
- ❌ Embedding 客户端、Qdrant 客户端、collection 创建
- ❌ Chat、SSE 端点（本任务只实现 `@SkipResponseWrap` 排除机制）
- ❌ 前端业务页面、Vue Router、Pinia
- ❌ 鉴权、JWT
- ❌ `synchronize: true` 或任何绕过 migration 的建表行为
- ❌ 创建/修改 6 个实体之外的任何实体
- ❌ 改动 `web/` 下除 `src/api/http.ts` 外的任何文件
- ❌ 创建根 `package.json`、改 pnpm-workspace、动 docker-compose.yml
- ❌ 处理 §1.3/§3.10 明确"本任务不改"的既有问题（cwd 依赖、Vite 代理端口、前端失败态旧数据等，留待后续任务）

---

## 十三、完成后必须输出的内容

按以下结构汇报：

1. **修改文件清单**：新建/修改文件完整路径（分"新增/修改"两组）。
2. **核心实现说明**：重点说明 ① DatabaseService 初始化与重试机制 ② score 转换器 ③ 响应包装的排除机制 ④ CLI DataSource 的 .env 定位方式。
3. **启动方式**：从零（含解决 3306 冲突）到跑通的命令序列。
4. **验证方式**：§十一验收命令逐条执行结果（成功/失败 + 关键实际输出，含 §八.2 结构核对结论）。
5. **已知问题**：存在则列出，没有写"无"。
6. **未完成内容**：明确声明 §十二各项均未实现。
