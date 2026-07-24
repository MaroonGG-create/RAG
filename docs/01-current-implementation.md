# Mini RAG 当前实现快照

> 快照日期：2026-07-24（Asia/Shanghai）  
> 快照时间：约 14:42 +08:00  
> 工作区：`D:\Users\Documents\RAG`  
> 当前提交：`d99e8ce90c6980159955d6adfa928e650bf2be17`（`feat: 增删改查`）  
> 对应阶段：T03 知识库 CRUD 完成后  
> 信息来源：当前真实源码、Git 提交差异、MySQL `information_schema`/`SHOW INDEX`、实际 migration/build/type-check、完整 HTTP 接口矩阵和 Swagger 请求。  
> T03 详细验收见 `docs/reports/task-03-completion.md`。

## 1. 当前结论

- T01/T02 的工程骨架、数据库实体和后端基础能力继续存在。
- T03 新增了 `KnowledgeBaseModule`，实现知识库创建、列表、详情和删除 4 个后端接口。
- `CreateKnowledgeBaseDto`、`KnowledgeBaseResponseDto`、`KnowledgeBaseService`、`KnowledgeBaseController`、`KnowledgeBaseModule`、`ParsePositiveIntPipe` 均已落地。
- `knowledge_base.name` 已从普通索引 `idx_name` 升级为唯一约束 `uk_name`。
- 当前共有 2 条 migration，均已执行；再次运行 migration 的真实结果为 `No migrations are pending`。
- Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/docs-json`，只暴露 health 与 knowledge-bases。
- T03 全部指定接口场景已实际通过；并发同名得到 201/409，无 500；DELETE 204 严格空体。
- 本次验收测试数据已全部清理，6 张业务表当前均为 0 行，migration 记录保留 2 条。
- 没有实现 T04：不存在文档上传/管理接口、处理流程、Qdrant 客户端、Embedding、Chat、SSE、会话接口或前端知识库页面。

## 2. 当前完整工程目录

以下列出当前维护的工程文件；排除 `.git/`、各级 `node_modules/`、构建生成的 `server/dist/` 和其他缓存。根 `.env` 被 Git 忽略；`.agents/` 是空的本地工具目录。

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
│  ├─ task-03-knowledge-base-crud.md
│  └─ reports/
│     ├─ task-02-completion.md
│     └─ task-03-completion.md
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
│     │  ├─ interceptors/
│     │  │  └─ response.interceptor.ts
│     │  └─ pipes/
│     │     └─ parse-positive-int.pipe.ts
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
│     │     ├─ 1784800736682-InitSchema.ts
│     │     └─ 1784871996843-AddKnowledgeBaseNameUnique.ts
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
│           ├─ dto/
│           │  ├─ create-knowledge-base.dto.ts
│           │  └─ knowledge-base-response.dto.ts
│           ├─ entities/
│           │  └─ knowledge-base.entity.ts
│           ├─ knowledge-base.controller.ts
│           ├─ knowledge-base.module.ts
│           └─ knowledge-base.service.ts
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

用户提到的 `docs/tasks/task-03-knowledge-base-crud.md` 不存在；实际任务文档在 `docs/task-03-knowledge-base-crud.md`。

## 3. 后端模块与启动配置

### 3.1 AppModule

`server/src/app.module.ts` 当前导入顺序：

1. `ConfigModule.forRoot(...)`
2. `TypeOrmModule.forRootAsync(...)`
3. `DatabaseModule`
4. `HealthModule`
5. `KnowledgeBaseModule`

### 3.2 main.ts

当前全局配置：

- 全局前缀：`api`
- ValidationPipe：
  - `whitelist: true`
  - `transform: true`
- 全局 `HttpExceptionFilter`
- 全局 `ResponseInterceptor`
- CORS origin 取 `server.corsOrigin`
- Swagger：
  - title：`Mini RAG API`
  - version：`0.1.0`
  - setup path：`docs`
  - `useGlobalPrefix: true`
- 监听 `server.port`
- bootstrap 失败时记录错误并退出

T03 新增的 `transform: true` 是 DTO `@Transform(trim)` 生效的前提。

### 3.3 当前模块范围

已有业务 Module：

- `HealthModule`
- `KnowledgeBaseModule`

Document 和 Conversation 目录当前只有 T02 实体，没有 module/controller/service。

## 4. KnowledgeBaseModule 当前结构

位置：

```text
server/src/modules/knowledge-base/
├─ dto/
│  ├─ create-knowledge-base.dto.ts
│  └─ knowledge-base-response.dto.ts
├─ entities/
│  └─ knowledge-base.entity.ts
├─ knowledge-base.controller.ts
├─ knowledge-base.module.ts
└─ knowledge-base.service.ts
```

`KnowledgeBaseModule`：

```ts
@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
```

模块没有导出 Service，也没有注册 T04 或其他 repository。

## 5. 当前四个知识库接口

| 方法 | 实际路径 | 成功状态 | 当前行为 |
|---|---|---:|---|
| POST | `/api/knowledge-bases` | 201 | trim、校验、重名预检、创建、返回 ResponseDto |
| GET | `/api/knowledge-bases` | 200 | 按 `createdAt DESC, id DESC` 返回全部知识库 |
| GET | `/api/knowledge-bases/:id` | 200 | 正整数 id；不存在返回 404 |
| DELETE | `/api/knowledge-bases/:id` | 204 | 存在性检查后物理删除；严格空响应体 |

当前没有：

- PUT/PATCH 更新接口
- 分页参数或分页响应
- 关系加载
- 鉴权

### 5.1 普通成功响应

POST/GET 的业务结果由全局拦截器包装：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

列表时 `data` 为数组。

### 5.2 创建实际行为

本次创建“产品文档库”的真实结果：

- HTTP 201
- `code=0`
- `name="产品文档库"`
- `description="产品相关资料"`
- `documentCount=0`
- `createdAt`、`updatedAt` 均存在

### 5.3 DELETE 实际行为

存在 id：

```text
HTTP 204
body bytes = 0
Content-Type = absent
Content-Length = absent
```

不存在 id：

```json
{
  "code": 404,
  "message": "知识库不存在"
}
```

## 6. DTO 当前实现

### 6.1 CreateKnowledgeBaseDto

位置：`server/src/modules/knowledge-base/dto/create-knowledge-base.dto.ts`

| 字段 | 类型 | 处理与校验 |
|---|---|---|
| `name` | `string` | 字符串 trim；`IsString`；`IsNotEmpty`；`MaxLength(100)` |
| `description` | `string?` | 字符串 trim；`IsOptional`；`IsString`；`MaxLength(500)` |

真实验收：

- `"  研发资料  "` 保存为 `"研发资料"`。
- `"  内部资料  "` 保存为 `"内部资料"`。
- description 只含空格时保存为 `null`。
- 缺 name、空串、全空格、101 字符 name、501 字符 description 均返回 HTTP 400。
- 校验失败结构为 `{ code: 400, message: '参数校验失败', details: [...] }`。

### 6.2 KnowledgeBaseResponseDto

位置：`server/src/modules/knowledge-base/dto/knowledge-base-response.dto.ts`

只包含：

```text
id
name
description
documentCount
createdAt
updatedAt
```

`static fromEntity()` 逐字段映射，时间调用 `toISOString()`。不会返回 `documents`、`conversations` 或实体中的其他关系。

## 7. KnowledgeBaseService 当前方法

位置：`server/src/modules/knowledge-base/knowledge-base.service.ts`

### 7.1 `create(dto)`

流程：

1. 使用 DTO 已 trim 的 `name`。
2. `description = dto.description?.trim() || null`。
3. `findOne({ where: { name } })` 做重名预检。
4. 命中时抛 `ConflictException('知识库名称已存在')`。
5. `repository.create()` + `repository.save()`。
6. save 撞唯一索引时识别 `ER_DUP_ENTRY` 并转为同一个 ConflictException。
7. 使用 `KnowledgeBaseResponseDto.fromEntity()` 返回。

### 7.2 `findAll()`

```ts
repository.find({
  order: { createdAt: 'DESC', id: 'DESC' },
})
```

不写 `relations`，不加载 relation；随后逐项映射 ResponseDto。

### 7.3 `findOne(id)`

按 id 查询；未找到时抛：

```ts
new NotFoundException('知识库不存在')
```

### 7.4 `remove(id)`

先复用 `findOne(id)` 确认存在，再调用：

```ts
repository.delete(id)
```

方法包含一条“T08+ 先清理 Qdrant 再删 MySQL”的未来注释，没有任何实际 Qdrant 调用。

## 8. 重名、并发和 collation

### 8.1 应用层预检

预检使用：

```ts
repository.findOne({ where: { name } })
```

命中返回 HTTP 409：

```json
{
  "code": 409,
  "message": "知识库名称已存在"
}
```

### 8.2 数据库并发兜底

`isDuplicateEntryError(error: unknown)` 只在：

```ts
error instanceof QueryFailedError
driverError.code === 'ER_DUP_ENTRY'
```

时返回 true。这样并发撞 `uk_name` 不会落入全局 QueryFailedError 的 500 分支。

本次两个并发同名 POST 的实际结果：

```text
201
409
```

没有 500。未加运行日志，因此不能从黑盒结果区分 409 来自预检还是 save 兜底。

### 8.3 大小写重名

`knowledge_base` 表和 `name` 列实际 collation 都是 `utf8mb4_unicode_ci`。

实测：

```text
TestLib → 201
testlib → 409
```

## 9. ParsePositiveIntPipe

位置：`server/src/common/pipes/parse-positive-int.pipe.ts`

当前实现：

1. `Number(value)` 转换。
2. 要求 `Number.isInteger(id)`。
3. 要求 `id > 0`。
4. 失败抛 `BadRequestException('id 必须是正整数')`。

当前用于 GET detail 和 DELETE 的 `:id`。

真实结果：

| 输入 | HTTP | message |
|---|---:|---|
| `abc` | 400 | `id 必须是正整数` |
| `0` | 400 | `id 必须是正整数` |
| `-1` | 400 | `id 必须是正整数` |
| 不存在的正整数 | 404 | `知识库不存在` |

已知边界：`Number()` 会接受 `1e2`、`0x10`、`1.0` 等表示法，当前也没有显式限制 safe integer 或 `INT UNSIGNED` 上限。

## 10. 数据库实体和表结构

### 10.1 6 个实体实际路径

| 实体 | 表 | 文件 |
|---|---|---|
| `KnowledgeBase` | `knowledge_base` | `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts` |
| `Document` | `document` | `server/src/modules/document/entities/document.entity.ts` |
| `DocumentChunk` | `document_chunk` | `server/src/modules/document/entities/document-chunk.entity.ts` |
| `Conversation` | `conversation` | `server/src/modules/conversation/entities/conversation.entity.ts` |
| `Message` | `message` | `server/src/modules/conversation/entities/message.entity.ts` |
| `MessageReference` | `message_reference` | `server/src/modules/conversation/entities/message-reference.entity.ts` |

6 个实体仍由 `server/src/database/entities.ts` 的 `AppEntities` 显式注册。

### 10.2 当前表字段

| 表 | 当前实际字段 |
|---|---|
| `knowledge_base` | `id`, `name`, `description`, `document_count`, `created_at`, `updated_at` |
| `document` | `id`, `kb_id`, `file_name`, `file_ext`, `file_size`, `file_hash`, `storage_path`, `status`, `error_message`, `chunk_count`, `created_at`, `updated_at` |
| `document_chunk` | `id`, `document_id`, `kb_id`, `chunk_index`, `content`, `char_count`, `page_no`, `qdrant_point_id`, `created_at`, `updated_at` |
| `conversation` | `id`, `kb_id`, `title`, `created_at`, `updated_at` |
| `message` | `id`, `conversation_id`, `role`, `content`, `status`, `error_message`, `created_at`, `updated_at` |
| `message_reference` | `id`, `message_id`, `document_id`, `chunk_id`, `document_name`, `chunk_index`, `page_no`, `score`, `content_snapshot`, `created_at`, `updated_at` |
| `migrations` | `id`, `timestamp`, `name` |

6 张业务表仍为 `InnoDB`、`utf8mb4_unicode_ci`；T03 没有变更任何字段或外键。

### 10.3 knowledge_base 索引

当前实查：

```text
PRIMARY(id), Non_unique=0
uk_name(name), Non_unique=0
```

`idx_name` 已不存在。

### 10.4 其他索引/约束

T03 后总计：

- 业务唯一约束/索引 4 个：
  - `knowledge_base.uk_name`
  - `document.uk_kb_hash`
  - `document_chunk.uk_doc_index`
  - `document_chunk.uk_qdrant_point`
- 命名普通业务索引 5 个：
  - `document.idx_kb_status`
  - `document_chunk.idx_kb`
  - `conversation.idx_kb`
  - `message.idx_conv`
  - `message_reference.idx_msg`
- 外键 5 条，仍全部 `ON DELETE CASCADE`。

## 11. TypeORM 与 Migration

### 11.1 当前 TypeORM 配置

Nest 运行时：

- `entities: AppEntities`
- `migrations: migrations/*{.ts,.js}`
- `synchronize: false`
- `manualInitialization: true`

CLI DataSource：

- 位置：`server/src/database/data-source.ts`
- `dotenv.config({ path: resolve(__dirname, '../../../.env') })`
- 共用 `AppEntities`
- `synchronize: false`

### 11.2 当前 Migration

1. `server/src/database/migrations/1784800736682-InitSchema.ts`
2. `server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts`

T03 Migration：

```text
up:   DROP idx_name → CREATE UNIQUE uk_name(name)
down: DROP uk_name  → CREATE ordinary idx_name(name)
```

没有其他 schema 变化。T02 InitSchema 在 T02 基线和当前 HEAD 的 blob 相同，确认未修改。

### 11.3 当前 migration 状态

`migration:show`：

```text
[X] 2 InitSchema1784800736682
[X] 3 AddKnowledgeBaseNameUnique1784871996843
```

`migration:run`：

```text
No migrations are pending
```

## 12. DatabaseModule、健康检查与统一响应

### 12.1 DatabaseModule / DatabaseService

T03 没有修改这两个文件。

`DatabaseService` 仍负责：

- `OnApplicationBootstrap` 启动尝试；
- 共享 readiness Promise；
- DataSource initialize；
- `runMigrations()`；
- 失败清空 Promise以便健康请求重试；
- 启动失败只记录日志，不退出应用。

### 12.2 健康检查

路由：

```text
GET /api/health
```

`HealthService` 仍执行 `ensureReady()` 后 `SELECT 1`。当前实际为 HTTP 200、`data.db="up"`。

T03 只给 `HealthController` 增加：

- `@ApiTags('health')`
- `@ApiOperation(...)`

未改健康逻辑。

### 12.3 统一异常/成功结构

T03 没有修改全局过滤器和拦截器。

成功：

```json
{ "code": 0, "message": "success", "data": {} }
```

错误：

```json
{ "code": 400, "message": "参数校验失败", "details": [] }
```

或：

```json
{ "code": 404, "message": "知识库不存在" }
```

DELETE 204 由 HTTP 响应层保持空体。

## 13. Swagger 当前配置

依赖：

```text
@nestjs/swagger ^8.1.0
```

代码位置：`server/src/main.ts`

配置：

- title：`Mini RAG API`
- description：说明非 SSE 成功接口使用统一 envelope，Schema 描述 `data` 部分
- version：`0.1.0`
- `SwaggerModule.setup('docs', ..., { useGlobalPrefix: true })`

实际地址：

```text
UI:   http://localhost:3000/api/docs
JSON: http://localhost:3000/api/docs-json
```

UI HTML、CSS、bundle、init 资源均实际返回 200。

OpenAPI 实际 paths：

```text
GET          /api/health
GET, POST    /api/knowledge-bases
GET, DELETE  /api/knowledge-bases/{id}
```

各 operation 的实际 tags（OpenAPI 根级 `tags` 字段未声明）：

```text
health
knowledge-bases
```

没有 documents、chat、conversations、embedding 或 vector-store path。

## 14. 前端当前实现

T03 没有修改 `web/`。

前端仍只有健康检查占位页：

- 无 Vue Router
- 无 Pinia
- 无知识库页面
- 无知识库 API 文件
- 无上传页面

`web/src/api/http.ts` 仍负责统一 envelope 解包；Vite `/api` 代理仍固定指向 `http://localhost:3000`。

本次 `pnpm --filter web type-check` 退出码为 0。

## 15. 当前运行和数据库状态

验收时：

| 项目 | 实际状态 |
|---|---|
| Compose MySQL | `Up (healthy)`，3306 |
| Compose Qdrant | `Up (healthy)`，6333/6334 |
| Windows `MySQL80` | `Stopped`，StartType=`Automatic` |
| 后端 | `nest start --watch` 进程监听 3000 |
| `GET /api/health` | HTTP 200，`db="up"` |
| Migration | 2 条，均已执行 |
| `knowledge_base` 索引 | `PRIMARY`、`uk_name` |
| 6 张业务表行数 | 均为 0 |
| `migrations` 行数 | 2 |

本次测试通过 DELETE 接口清理，没有删除 migration 记录，没有重建数据库。

## 16. 本次关键验收结果

### 16.1 构建和 Migration

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm --filter server migration:show` | 0 | T02/T03 均 `[X]` |
| `pnpm --filter server migration:run` | 0 | `No migrations are pending` |
| `pnpm --filter server build` | 0 | `nest build` 成功 |
| `pnpm --filter web type-check` | 0 | `vue-tsc --noEmit` 成功 |

### 16.2 接口

| 场景 | 实际结果 |
|---|---|
| 创建 | 201 |
| name/description trim | 201，值正确 |
| 空描述 | 201，保存为 null |
| 5 类参数错误 | 均 400 |
| 同名 | 409 |
| 大小写同名 | 201/409 |
| 并发同名 | 201/409，无 500 |
| 列表 | 200，双字段降序、严格 6 字段 |
| 详情 | 200/400/404 符合 |
| 删除 | 204 空体；再次删除 404 |
| Swagger UI/JSON | 200，paths 正确 |
| 清理 | 全部 204，最终业务数据 0 |

完整真实状态码、响应和测试脚本修正记录见 T03 完成报告。

## 17. 当前已知问题

1. **时间字段偏移**：MySQL 容器系统时区为 UTC，TypeORM/mysql2 连接未显式配置 timezone。本次 API 返回的 ISO 时间比实际 UTC 再早 8 小时；字段存在与排序验收不受影响，但显示值不准确。
2. **ParsePositiveIntPipe 数字语法宽松**：`Number()` 会接受 `1e2`、`0x10`、`1.0`，也未检查 safe integer 或 `INT UNSIGNED` 上限。
3. **总体方案未回填 T03 索引决策**：`docs/00-overall-plan.md` 仍写 `idx_name` 和应用层重名校验，且没有任务文档所称的 v1.2 修订记录。
4. **T02 报告是历史快照**：其中 `idx_name`、单 migration、T03 未开始等是 T02 当时状态，不能作为当前事实。
5. **Nest 根 `.env` 路径依赖 cwd**：`resolve(process.cwd(), '../.env')` 仍可能在其他 cwd 下指错。
6. **CLI DataSource 不复用 Nest 环境校验**：CLI 直接读取 `process.env`。
7. **数据库使用 root 账号**：没有独立最小权限业务用户。
8. **Windows MySQL80 可能再次冲突**：当前为 Stopped，但启动类型为 Automatic。
9. **Vite 代理端口写死**：不会自动跟随 `SERVER_PORT`。
10. **前端健康请求失败时保留旧数据显示**。
11. **pnpm 非致命提示**：migration/build/type-check 会先输出一次“No projects matched”，但目标 workspace 随后正常执行且退出码为 0。
12. **Swagger Schema 只描述 data**：这是当前设计；线上实际普通成功响应仍有 `{ code, message, data }` envelope。
13. **并发分支缺少运行埋点**：黑盒已证明 201/409、无 500，但无法确认具体 409 来自预检还是 `ER_DUP_ENTRY` catch。

## 18. 当前未实现范围

以下能力仍未实现；T04 尚未开始：

- 知识库更新接口
- 列表分页
- 文档 module/controller/service/DTO
- 文档上传、文件存储和哈希去重
- 文档解析、清洗、切片
- Qdrant 客户端和 collection 管理
- Embedding 服务
- RAG、LLM、Chat、SSE 端点
- 会话接口
- 前端知识库/文档/对话页面
- Vue Router、Pinia
- 鉴权、JWT
- BaseService 或通用 CRUD 框架

## 19. 进入 T04 的当前条件

当前具备进入 T04 的技术前置：

- T03 CRUD 和 Swagger 验收通过。
- `uk_name` 已落库。
- 两条 Migration 完整且无 pending。
- server build、web type-check 通过。
- MySQL healthy，数据库业务数据已清理。
- 没有需要先回滚的越界实现。

进入 T04 时应保留 T02/T03 Migration，不应修改历史 Migration；当前状态以本文和 `docs/reports/task-03-completion.md` 为准。
