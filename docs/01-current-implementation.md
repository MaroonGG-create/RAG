# Mini RAG 当前实现快照

> 快照日期：2026-07-24（Asia/Shanghai）  
> 工作区：`D:\Users\Documents\RAG`  
> 对应阶段：T02 数据库实体与后端基础能力完成后  
> 信息来源：当前工作树中的真实源码、Git 差异、实际执行的构建/类型检查/migration 命令、MySQL `information_schema` 查询、Docker 状态与 HTTP 请求。  
> 本文是实现快照，不以任务说明中的预期结果代替实际结果。T02 验收明细见 `docs/reports/task-02-completion.md`。

## 1. 当前结论

- T02 要求的 6 个实体、显式实体注册、独立 CLI DataSource、首个 migration、`DatabaseModule`、`DatabaseService`、健康检查调整、统一异常过滤器、统一响应拦截器、`SkipResponseWrap` 机制和前端 Axios 解包均已存在。
- Nest 运行时和 CLI DataSource 的 `synchronize` 都是 `false`。
- 2026-07-24 本次实际执行的后端构建、前端类型检查以及 migration `run → revert → run` 均以退出码 `0` 完成。
- 当前 Compose MySQL 和 Qdrant 均为 `healthy`；Windows `MySQL80` 服务为 `Stopped`，当前没有 3306 冲突。
- `mini_rag` 中当前实际存在 6 张业务表和 TypeORM 的 `migrations` 表；索引、3 个唯一约束、5 个外键及级联规则均与 T02 数据模型一致。
- `GET /api/health` 当前实际返回 HTTP 200，响应经过统一包装，`data.db` 为 `"up"`。
- T03 尚未开始：没有知识库/文档/会话业务 controller、service、DTO、repository，也没有上传、解析、Embedding、RAG 或 SSE 端点。

## 2. 当前完整工程目录

以下列出当前维护的工程文件；排除 `.git/`、`node_modules/`、构建生成的 `server/dist/` 和其他缓存。`.agents/` 是当前为空的本地工具目录；根 `.env` 被 Git 忽略。

```text
RAG/
├─ .agents/
├─ .env
├─ .env.example
├─ .gitignore
├─ docker-compose.yml
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ README.md
├─ docs/
│  ├─ 00-overall-plan.md
│  ├─ 01-current-implementation.md
│  ├─ task-01-init-docker.md
│  ├─ task-02-database-core.md
│  └─ reports/
│     └─ task-02-completion.md
├─ server/
│  ├─ nest-cli.json
│  ├─ package.json
│  ├─ tsconfig.build.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ app.module.ts
│     ├─ main.ts
│     ├─ common/
│     │  ├─ decorators/
│     │  │  └─ skip-response-wrap.decorator.ts
│     │  ├─ filters/
│     │  │  └─ http-exception.filter.ts
│     │  └─ interceptors/
│     │     └─ response.interceptor.ts
│     ├─ config/
│     │  ├─ configuration.ts
│     │  └─ env.validation.ts
│     ├─ database/
│     │  ├─ data-source.ts
│     │  ├─ database.module.ts
│     │  ├─ database.service.ts
│     │  ├─ entities.ts
│     │  ├─ typeorm.config.ts
│     │  └─ migrations/
│     │     └─ 1784800736682-InitSchema.ts
│     └─ modules/
│        ├─ conversation/
│        │  └─ entities/
│        │     ├─ conversation.entity.ts
│        │     ├─ message.entity.ts
│        │     └─ message-reference.entity.ts
│        ├─ document/
│        │  └─ entities/
│        │     ├─ document.entity.ts
│        │     └─ document-chunk.entity.ts
│        ├─ health/
│        │  ├─ health.controller.ts
│        │  ├─ health.module.ts
│        │  └─ health.service.ts
│        └─ knowledge-base/
│           └─ entities/
│              └─ knowledge-base.entity.ts
└─ web/
   ├─ env.d.ts
   ├─ index.html
   ├─ package.json
   ├─ tsconfig.json
   ├─ vite.config.ts
   └─ src/
      ├─ App.vue
      ├─ main.ts
      ├─ api/
      │  ├─ health.ts
      │  └─ http.ts
      ├─ types/
      │  └─ health.ts
      └─ views/
         └─ HomePage.vue
```

根目录仍没有 `package.json`。`pnpm-workspace.yaml` 只包含 `server` 和 `web` 两个 workspace。

## 3. 6 个实体的真实路径与注册方式

| 实体类 | 实际表名 | 实际文件路径 |
|---|---|---|
| `KnowledgeBase` | `knowledge_base` | `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts` |
| `Document` | `document` | `server/src/modules/document/entities/document.entity.ts` |
| `DocumentChunk` | `document_chunk` | `server/src/modules/document/entities/document-chunk.entity.ts` |
| `Conversation` | `conversation` | `server/src/modules/conversation/entities/conversation.entity.ts` |
| `Message` | `message` | `server/src/modules/conversation/entities/message.entity.ts` |
| `MessageReference` | `message_reference` | `server/src/modules/conversation/entities/message-reference.entity.ts` |

`server/src/database/entities.ts` 中的 `AppEntities` 显式列出以上 6 个实体。Nest TypeORM 配置与 CLI DataSource 共用该数组，不使用 `autoLoadEntities` 或目录通配发现实体。

所有实体关系均保持非 eager；没有 `eager: true`，也没有应用层保存用的 `cascade: true`。级联删除只由实体关系中的 `onDelete: 'CASCADE'` 和数据库外键实现。

## 4. 实际数据库表、字段与索引

以下类型、可空性和默认值来自 2026-07-24 对 `mini_rag` 的 `information_schema` 实查。6 张业务表均为 `InnoDB`、`utf8mb4_unicode_ci`。

### 4.1 `knowledge_base`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `name` | `varchar(100)` | 否 | — |
| `description` | `varchar(500)` | 是 | `NULL` |
| `document_count` | `int unsigned` | 否 | `0` |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引：

- `PRIMARY(id)`
- 普通索引 `idx_name(name)`

### 4.2 `document`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `kb_id` | `int unsigned` | 否 | FK → `knowledge_base.id` |
| `file_name` | `varchar(255)` | 否 | — |
| `file_ext` | `varchar(10)` | 否 | 列注释说明由应用层限制 `pdf/md/txt` |
| `file_size` | `bigint unsigned` | 否 | — |
| `file_hash` | `char(64)` | 否 | — |
| `storage_path` | `varchar(500)` | 否 | — |
| `status` | `enum('pending','parsing','chunking','embedding','completed','failed')` | 否 | `'pending'` |
| `error_message` | `text` | 是 | `NULL` |
| `chunk_count` | `int unsigned` | 否 | `0` |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引/约束：

- `PRIMARY(id)`
- 唯一约束 `uk_kb_hash(kb_id, file_hash)`
- 普通索引 `idx_kb_status(kb_id, status)`

### 4.3 `document_chunk`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `document_id` | `int unsigned` | 否 | FK → `document.id` |
| `kb_id` | `int unsigned` | 否 | 无 FK 冗余列 |
| `chunk_index` | `int unsigned` | 否 | — |
| `content` | `text` | 否 | — |
| `char_count` | `int unsigned` | 否 | — |
| `page_no` | `int unsigned` | 是 | `NULL` |
| `qdrant_point_id` | `char(36)` | 否 | — |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引/约束：

- `PRIMARY(id)`
- 唯一约束 `uk_doc_index(document_id, chunk_index)`
- 唯一约束 `uk_qdrant_point(qdrant_point_id)`
- 普通索引 `idx_kb(kb_id)`

### 4.4 `conversation`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `kb_id` | `int unsigned` | 否 | FK → `knowledge_base.id` |
| `title` | `varchar(200)` | 否 | — |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引：

- `PRIMARY(id)`
- 普通索引 `idx_kb(kb_id)`

### 4.5 `message`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `conversation_id` | `int unsigned` | 否 | FK → `conversation.id` |
| `role` | `enum('user','assistant')` | 否 | 无默认值 |
| `content` | `text` | 否 | — |
| `status` | `enum('completed','failed')` | 否 | `'completed'` |
| `error_message` | `text` | 是 | `NULL` |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引：

- `PRIMARY(id)`
- 普通索引 `idx_conv(conversation_id, id)`

### 4.6 `message_reference`

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int unsigned` | 否 | PK，`auto_increment` |
| `message_id` | `int unsigned` | 否 | FK → `message.id` |
| `document_id` | `int unsigned` | 是 | 无 FK 快照列，默认 `NULL` |
| `chunk_id` | `int unsigned` | 是 | 无 FK 快照列，默认 `NULL` |
| `document_name` | `varchar(255)` | 否 | — |
| `chunk_index` | `int unsigned` | 否 | — |
| `page_no` | `int unsigned` | 是 | `NULL` |
| `score` | `decimal(5,4)` | 否 | — |
| `content_snapshot` | `text` | 否 | — |
| `created_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)` |
| `updated_at` | `timestamp(6)` | 否 | `CURRENT_TIMESTAMP(6)`，更新时自动刷新 |

索引：

- `PRIMARY(id)`
- 普通索引 `idx_msg(message_id)`

`score` 的实体属性类型为 `number`。列 transformer 的 `from` 将 mysql2 默认返回的 DECIMAL 字符串转为 `number`，`to` 保持数值写入。

### 4.7 TypeORM `migrations` 表

该表由 TypeORM 自动创建和维护，不属于 6 个业务实体：

| 字段 | 实际类型 | NULL | 默认/附加 |
|---|---|---:|---|
| `id` | `int` | 否 | PK，`auto_increment` |
| `timestamp` | `bigint` | 否 | — |
| `name` | `varchar(255)` | 否 | — |

当前唯一记录为：

```text
id=2
timestamp=1784800736682
name=InitSchema1784800736682
```

`id=2` 是本次先回滚再重新执行 migration 后的真实自增值。

## 5. 外键和级联规则

当前数据库实查共有 5 条外键，删除规则均为 `CASCADE`，更新规则均为 `NO ACTION`：

| 子表字段 | 父表字段 | 实际约束名 | ON DELETE |
|---|---|---|---|
| `document.kb_id` | `knowledge_base.id` | `FK_de194591c1b6476246598f17347` | `CASCADE` |
| `document_chunk.document_id` | `document.id` | `FK_13fe21b6cbdda6d223de93c1b4b` | `CASCADE` |
| `conversation.kb_id` | `knowledge_base.id` | `FK_6c46eb6af21906b5de097dad0db` | `CASCADE` |
| `message.conversation_id` | `conversation.id` | `FK_7fe3e887d78498d9c9813375ce2` | `CASCADE` |
| `message_reference.message_id` | `message.id` | `FK_13ab388ba9004222977d552f832` | `CASCADE` |

`document_chunk.kb_id`、`message_reference.document_id`、`message_reference.chunk_id` 在实际数据库中均没有外键，符合冗余查询列/历史快照列的设计。

## 6. TypeORM 当前配置

### 6.1 Nest 运行时配置

位置：`server/src/database/typeorm.config.ts`

实际配置：

```ts
{
  type: 'mysql',
  host,
  port,
  username,
  password,
  database,
  entities: AppEntities,
  migrations: [resolve(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
  manualInitialization: true,
}
```

关键结论：

- `synchronize` 实际为 `false`，并有“禁止改为 true，表结构只能经 migration 变更”的中文注释。
- `manualInitialization` 实际为 `true`，连接和 migration 就绪流程由 `DatabaseService` 驱动。
- 没有 `migrationsRun`；启动迁移由 `DatabaseService.runMigrations()` 显式执行。
- 没有 `autoLoadEntities`、naming strategy 或第二套 Nest 数据库连接。

### 6.2 Nest 环境变量加载

`server/src/app.module.ts` 的 `ConfigModule.forRoot()` 使用：

```ts
envFilePath: resolve(process.cwd(), '../.env')
```

通过 `pnpm --filter server ...` 执行时 cwd 为 `server/`，因此可加载仓库根 `.env`。该实现仍依赖 cwd，属于已知问题。

`server/src/config/env.validation.ts` 当前校验：

- `SERVER_PORT`
- `CORS_ORIGIN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `QDRANT_URL`

`QDRANT_URL` 要求带 `http` 或 `https` 协议，允许本地地址且不要求 TLD。

## 7. CLI DataSource、migration 与 scripts

### 7.1 CLI DataSource

位置：`server/src/database/data-source.ts`

文件顶部执行：

```ts
dotenv.config({ path: resolve(__dirname, '../../../.env') })
```

源码态 `server/src/database/` 和编译态 `server/dist/database/` 向上三级都指向仓库根，因此该路径不依赖执行命令时的 cwd。

CLI DataSource：

- 直接从 `process.env` 读取 MySQL 配置；
- 使用 `AppEntities`；
- migration glob 为 `migrations/*{.ts,.js}`；
- `synchronize: false`；
- 不 import Nest 模块或装饰器。

### 7.2 Migration 文件

当前唯一 migration：

```text
server/src/database/migrations/1784800736682-InitSchema.ts
```

`up()` 创建 6 张业务表、3 个唯一索引、6 个命名普通索引和 5 条外键；`down()` 先删除 5 条外键，再完整删除 6 张业务表。

### 7.3 实际 migration scripts

`server/package.json` 当前脚本：

```json
{
  "typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
  "migration:generate": "pnpm run typeorm migration:generate",
  "migration:run": "pnpm run typeorm migration:run",
  "migration:revert": "pnpm run typeorm migration:revert",
  "migration:show": "pnpm run typeorm migration:show"
}
```

当前相关依赖为：

- dependencies：`dotenv ^16.4.5`
- devDependencies：`ts-node ^10.9.2`

## 8. DatabaseModule 与 DatabaseService

### 8.1 DatabaseModule

位置：`server/src/database/database.module.ts`

实际实现只注册并导出 `DatabaseService`：

```ts
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
```

`AppModule` 在 `HealthModule` 之前导入 `DatabaseModule`；`HealthModule` 也显式导入 `DatabaseModule`。

### 8.2 DatabaseService

位置：`server/src/database/database.service.ts`

实际职责：

1. 实现 `OnApplicationBootstrap`，应用启动时调用 `ensureReady()`。
2. 数据库启动失败时只记录 `console.error`，不让 Nest 进程退出。
3. `ensureReady()` 通过 `readinessPromise` 合并并发初始化。
4. DataSource 未初始化时先执行 `initialize()`。
5. 随后总是执行 `runMigrations()`，只有连接与 migration 都成功才返回 DataSource。
6. 初始化或 migration 失败时清空共享 Promise，使后续健康请求可以重试。
7. `invalidateReadiness()` 供健康检查在查询失败后清空就绪状态；下一次请求会重新确认 migration。

## 9. 健康检查当前实现

路由仍为：

```text
GET /api/health
```

`HealthService` 当前注入 `DatabaseService`，不再自行维护 DataSource 初始化 Promise。处理流程：

1. `await databaseService.ensureReady()`；
2. 使用返回的 DataSource 执行 `SELECT 1`；
3. 成功返回 `{ status: 'ok', db: 'up', uptime }`；
4. 失败时调用 `invalidateReadiness()`、记录错误，并返回 `{ status: 'ok', db: 'down', uptime }`；
5. Controller 不抛出异常，因此数据库失败时仍保持 HTTP 200。

普通成功响应会再被全局拦截器包装。本次实测响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok",
    "db": "up",
    "uptime": 145.3559899
  }
}
```

## 10. 统一异常过滤器

位置：`server/src/common/filters/http-exception.filter.ts`

`HttpExceptionFilter` 使用 `@Catch()` 捕获所有异常，并在 `main.ts` 通过 `app.useGlobalFilters(new HttpExceptionFilter())` 全局注册。

实际行为：

| 异常类型 | HTTP/`code` | 实际响应语义 |
|---|---:|---|
| `HttpException` | 异常自身状态码 | `{ code, message }` |
| ValidationPipe 的字符串数组错误 | `400` | `{ code: 400, message: '参数校验失败', details }` |
| `QueryFailedError` | `500` | `{ code: 500, message: '数据库操作失败' }`，完整异常只写服务端日志 |
| 其他异常 | `500` | `{ code: 500, message: '服务器内部错误' }`，完整异常只写服务端日志 |

本次实测：

```text
GET  /api/not-exist → HTTP 404 {"code":404,"message":"Cannot GET /api/not-exist"}
POST /api/health    → HTTP 404 {"code":404,"message":"Cannot POST /api/health"}
```

## 11. 统一响应拦截器与 SkipResponseWrap

### 11.1 ResponseInterceptor

位置：`server/src/common/interceptors/response.interceptor.ts`

在 `main.ts` 中通过以下代码全局注册：

```ts
app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()))
```

普通成功结果统一为：

```json
{ "code": 0, "message": "success", "data": "<原返回值；undefined/null 时为 null>" }
```

以下情况原样透传：

- handler 或 controller 命中 `@SkipResponseWrap()`；
- 返回值是 `StreamableFile`；
- Express response 已经 `headersSent`；
- `content-type` 包含 `text/event-stream`。

### 11.2 SkipResponseWrap

位置：`server/src/common/decorators/skip-response-wrap.decorator.ts`

实现使用：

```ts
SetMetadata('skipResponseWrap', true)
```

拦截器通过 `Reflector.getAllAndOverride()` 同时检查 handler 和 controller。当前没有 SSE 端点，也没有业务 handler 使用该装饰器；T02 只落地排除机制，这与当前范围一致。

## 12. 前端 Axios 响应解包

位置：`web/src/api/http.ts`

成功拦截器先用 `isApiResponse()` 检查响应体是否同时满足：

- 是非空对象；
- `code` 是数字；
- `message` 是字符串；
- 存在 `data` 字段。

命中后执行：

```ts
response.data = response.data.data
```

随后仍返回 AxiosResponse。这样 `web/src/api/health.ts` 无需改动，继续读取 `response.data` 即可得到内部 `HealthResult`。

错误拦截器对 AxiosError 优先使用服务端错误体的 `message`，其次使用 Axios 自身消息；普通 Error 保留其消息，未知值统一为“请求失败”。

当前 `baseURL` 仍为：

```ts
import.meta.env.VITE_API_BASE_URL ?? '/api'
```

Vite 通过 `envDir: '..'` 加载根 `.env`，开发代理仍固定将 `/api` 转发至 `http://localhost:3000`。

## 13. 当前数据库与服务运行状态

快照时间：`2026-07-24 11:07:31 +08:00`

| 项目 | 当前真实状态 |
|---|---|
| Compose MySQL `rag-mysql-1` | `Up (healthy)`，映射 `3306:3306` |
| Compose Qdrant `rag-qdrant-1` | `Up (healthy)`，映射 `6333:6333`、`6334:6334` |
| Windows `MySQL80` | `Stopped` |
| 3306 冲突 | 当前不存在；Compose MySQL 正在占用 3306 |
| `mini_rag` 业务表 | 6 张全部存在 |
| `migrations` 表 | 存在，1 条记录 |
| 业务表当前行数 | 6 张表均为 `0` |
| `GET /api/health` | HTTP 200，`data.db="up"` |

当前实际表：

```text
conversation
document
document_chunk
knowledge_base
message
message_reference
migrations
```

本次 migration 往返会删除并重建 6 张业务表，因此最终业务表为空；这是用户指定的 `migration:revert` 后再 `migration:run` 的结果。

## 14. 本次关键验证结果

| 命令/检查 | 退出码 | 真实结果 |
|---|---:|---|
| `pnpm --filter server build` | 0 | `nest build` 成功，无 TypeScript error |
| `pnpm --filter web type-check` | 0 | `vue-tsc --noEmit` 成功 |
| 第一次 `pnpm --filter server migration:run` | 0 | `No migrations are pending` |
| `pnpm --filter server migration:revert` | 0 | `InitSchema1784800736682 has been reverted successfully` |
| 第二次 `pnpm --filter server migration:run` | 0 | 重新创建 6 表、5 外键并插入 migration 记录 |
| `pnpm --filter server migration:show` | 0 | `[X] 2 InitSchema1784800736682` |
| MySQL 表/列/索引/约束查询 | 0 | 7 表存在，字段、3 个唯一约束、6 个普通索引、5 个 CASCADE FK 均符合 |
| `GET /api/health` | 0（curl） | HTTP 200，统一响应包装，`db="up"` |
| 404 请求检查 | 0（curl） | GET/POST 均返回统一 `{ code, message }` |

两条 pnpm 静态命令及 migration 命令仍会先输出：

```text
No projects matched the filters "D:\Users\Documents\RAG" in "D:\Users\Documents\RAG"
```

但目标 workspace 脚本随后确实执行，最终退出码均为 `0`。

## 15. 当前已知问题

1. **Nest 根 `.env` 路径依赖 cwd**：`resolve(process.cwd(), '../.env')` 只在 cwd 为 `server/` 时指向仓库根；直接从其他目录运行编译产物可能读错。T02 任务明确将该问题留待 T15。
2. **CLI DataSource 不复用 Nest 环境校验**：CLI 会加载根 `.env`，但直接读取 `process.env`，不会调用 `validateEnvironment()`；CLI 配置缺失时通常表现为驱动连接错误。
3. **数据库使用 root 账号**：Compose 没有独立最小权限业务用户，后端当前通过 `DB_USER=root` 连接。
4. **Vite 代理端口写死为 3000**：修改 `SERVER_PORT` 不会自动同步开发代理。
5. **前端失败态保留旧健康数据**：请求失败时只提示错误，不清空上一次成功结果。
6. **根目录没有 `package.json`/`packageManager`**：仓库没有通过 package metadata 固定精确 pnpm 版本。
7. **pnpm 有非致命 filter 提示**：本次命令均出现一次“No projects matched”提示，但随后正确执行目标 workspace，未影响退出码。
8. **README 数据库示例硬编码密码**：示例中的 `root123` 不会随 `.env` 变化。
9. **任务说明存在计数错误**：`task-02-database-core.md` 的 §5.1 标题写“新增 13 个 server 文件”，但其表格和实际实现均为 14 个。
10. **任务说明有一处验收语义矛盾**：一处要求应用启动自动 `runMigrations()`，另一处又描述“revert 后重启服务仍只剩 migrations 表”；按当前实现，重启会自动补跑 migration。
11. **部分完整场景未在本次审计中重跑**：没有停启 MySQL 验证故障恢复、没有临时移除 `QDRANT_URL`、没有进行浏览器人工回归，也没有单独完成 synchronize 防回归的运行态实验。详见完成报告。

## 16. 当前未实现范围

以下能力仍未实现，且本次没有开始 T03：

- 知识库、文档、会话业务 controller/service/DTO/repository；
- 文件上传、解析、清洗、切片；
- Embedding、Qdrant 客户端和 collection 管理；
- RAG 检索、LLM 调用、Chat 和 SSE 端点；
- Vue Router、Pinia 和业务页面；
- Swagger、鉴权、JWT。

