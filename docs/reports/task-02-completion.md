# T02 数据库实体与后端基础能力完成报告

> 审计日期：2026-07-24（Asia/Shanghai）  
> 工作区：`D:\Users\Documents\RAG`  
> 对照基线：`docs/task-02-database-core.md`  
> 实现快照：`docs/01-current-implementation.md`  
> 限定范围：仅核对 T02、执行指定验收与更新文档；没有开发 T03，也没有修改业务功能。

## 0. 结论摘要

- T02 静态实现完整：6 个实体、实体注册、CLI DataSource、migration、数据库初始化/重试、健康检查、统一异常/响应、SkipResponseWrap 和 Axios 解包均已落地。
- 用户本次指定的 5 条命令全部退出码为 `0`。
- 最终数据库实查确认 6 张业务表和 `migrations` 表全部存在，字段、3 个唯一约束、6 个命名普通索引、5 个外键及 `ON DELETE CASCADE` 均与 T02 数据模型一致。
- Compose MySQL 当前为 `healthy`，没有发生 3306 阻塞；HTTP 健康检查当前为 `db="up"`。
- 没有发现 T03 业务代码。
- 由于 `task-02-database-core.md` §十一中的故障恢复、缺失环境变量、浏览器人工回归和独立 synchronize 防回归场景未在本次审计中全部重跑，本报告的最终验收判定为：**部分通过**。这是验收覆盖不完整，不是已发现的 T02 核心代码或 schema 失败。

## 1. 实际新增文件

### 1.1 可由当前代码基线确认的 T02 新增文件

当前 Git 历史只有一个基线提交 `3871eec init`。相对该基线，T02 可确认新增 14 个 server 文件：

1. `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts`
2. `server/src/modules/document/entities/document.entity.ts`
3. `server/src/modules/document/entities/document-chunk.entity.ts`
4. `server/src/modules/conversation/entities/conversation.entity.ts`
5. `server/src/modules/conversation/entities/message.entity.ts`
6. `server/src/modules/conversation/entities/message-reference.entity.ts`
7. `server/src/database/entities.ts`
8. `server/src/database/data-source.ts`
9. `server/src/database/database.module.ts`
10. `server/src/database/database.service.ts`
11. `server/src/database/migrations/1784800736682-InitSchema.ts`
12. `server/src/common/filters/http-exception.filter.ts`
13. `server/src/common/interceptors/response.interceptor.ts`
14. `server/src/common/decorators/skip-response-wrap.decorator.ts`

### 1.2 本次核查新增的文档

1. `docs/reports/task-02-completion.md`

### 1.3 Git 证据边界

`docs/00-overall-plan.md`、原 `docs/01-current-implementation.md`、`docs/task-01-init-docker.md`、`docs/task-02-database-core.md` 在 Git 中也都相对唯一基线显示为新增，但仓库没有“T01 文档完成/T02 开始”的中间提交。根据文档内容和引用关系，它们是 T02 的前置设计/快照材料，本报告不把这 4 个文件强行归因成 T02 实现新增。

## 2. 实际修改文件

### 2.1 相对基线的 T02 实际修改

1. `.env.example`
2. `README.md`
3. `pnpm-lock.yaml`
4. `server/package.json`
5. `server/src/app.module.ts`
6. `server/src/config/env.validation.ts`
7. `server/src/database/typeorm.config.ts`
8. `server/src/main.ts`
9. `server/src/modules/health/health.module.ts`
10. `server/src/modules/health/health.service.ts`
11. `web/src/api/http.ts`

### 2.2 本次核查更新的文档

1. `docs/01-current-implementation.md`

本次没有修改任何 T03 或业务功能文件。

## 3. 与 `task-02-database-core.md` 的差异

| 项目 | 任务说明 | 当前真实实现/状态 | 判断 |
|---|---|---|---|
| 新增 server 文件计数 | §5.1 标题写“共 13 个” | 表格本身列 14 个，实际也新增 14 个 | 任务说明计数错误，不是实现缺失 |
| 修改文件清单 | §5 只列 server 6 个、web 1 个、根目录 2 个 | 另有 `server/package.json`、`pnpm-lock.yaml` | 两者是 §7 依赖/scripts 要求的必要变更，§5 清单漏列 |
| migration 文件名 | 示例为 `<timestamp>-init-schema.ts` | `1784800736682-InitSchema.ts` | TypeORM 生成命名和大小写不同，功能一致 |
| 时间列 | 规格简写 `TIMESTAMP` | 实际为 `timestamp(6)` 和 `CURRENT_TIMESTAMP(6)` | TypeORM 生成的微秒精度形式，字段语义一致 |
| Axios“返回 data” | 文案描述成功时返回 `data` | 实现把 `response.data` 替换为内层 `data`，再返回 AxiosResponse | 对现有 `health.ts` 等价解包，且避免修改任务禁止改动的调用方 |
| DatabaseService 重试 | 要求失败后可重试 | 另提供 `invalidateReadiness()`，健康查询失败时清空就绪状态 | 支撑连接恢复后重新确认 migration，符合目标 |
| synchronize 防回归描述 | 一处要求应用启动自动 `runMigrations()`；另一处写 revert 后“重启服务”仍只剩 `migrations` | 当前应用重启会按设计自动补跑 migration | 任务说明内部矛盾；不能同时满足两种描述 |
| 当前 migration 记录 id | 未规定 | 当前为 `id=2` | 本次 revert 后重新 run 导致自增值为 2，正常 |

除以上记录外，没有发现 6 个实体字段、枚举、默认值、索引、唯一约束、外键、响应机制或数据库初始化流程偏离 T02 冻结设计。

## 4. 6 张表和索引实际创建结果

### 4.1 表存在性、引擎与字符集

最终 `SHOW TABLES FROM mini_rag` 实际返回：

```text
conversation
document
document_chunk
knowledge_base
message
message_reference
migrations
```

`information_schema.TABLES` 实查结果：

| 表 | 是否存在 | Engine | Collation |
|---|---:|---|---|
| `knowledge_base` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `document` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `document_chunk` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `conversation` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `message` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `message_reference` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |
| `migrations` | 是 | `InnoDB` | `utf8mb4_unicode_ci` |

最终 6 张业务表行数均为 `0`，`migrations` 表为 `1` 行。业务表为空是本次按要求执行 `migration:revert` 后再 `migration:run` 的结果。

### 4.2 实际索引和唯一约束

| 表 | 实际普通索引 | 实际唯一约束 | 结论 |
|---|---|---|---|
| `knowledge_base` | `idx_name(name)` | — | 符合 |
| `document` | `idx_kb_status(kb_id, status)` | `uk_kb_hash(kb_id, file_hash)` | 符合 |
| `document_chunk` | `idx_kb(kb_id)` | `uk_doc_index(document_id, chunk_index)`；`uk_qdrant_point(qdrant_point_id)` | 符合 |
| `conversation` | `idx_kb(kb_id)` | — | 符合 |
| `message` | `idx_conv(conversation_id, id)` | — | 符合 |
| `message_reference` | `idx_msg(message_id)` | — | 符合 |

每张表另有 `PRIMARY(id)`；`migrations` 表也有 `PRIMARY(id)`。

`information_schema.TABLE_CONSTRAINTS` 确认以下 3 个对象的类型均为 `UNIQUE`：

```text
document.uk_kb_hash
document_chunk.uk_doc_index
document_chunk.uk_qdrant_point
```

### 4.3 枚举与默认值

实查确认：

- `document.status`：
  `enum('pending','parsing','chunking','embedding','completed','failed')`
  且默认值为 `pending`。
- `message.role`：
  `enum('user','assistant')`，无默认值。
- `message.status`：
  `enum('completed','failed')`
  且默认值为 `completed`。
- `knowledge_base.document_count` 和 `document.chunk_count` 默认值均为 `0`。

完整字段快照见 `docs/01-current-implementation.md` §4。

## 5. 外键和级联规则

最终数据库实查共有且只有以下 5 条外键：

| 子表字段 | 引用字段 | 实际约束名 | ON DELETE | ON UPDATE |
|---|---|---|---|---|
| `document.kb_id` | `knowledge_base.id` | `FK_de194591c1b6476246598f17347` | `CASCADE` | `NO ACTION` |
| `document_chunk.document_id` | `document.id` | `FK_13fe21b6cbdda6d223de93c1b4b` | `CASCADE` | `NO ACTION` |
| `conversation.kb_id` | `knowledge_base.id` | `FK_6c46eb6af21906b5de097dad0db` | `CASCADE` | `NO ACTION` |
| `message.conversation_id` | `conversation.id` | `FK_7fe3e887d78498d9c9813375ce2` | `CASCADE` | `NO ACTION` |
| `message_reference.message_id` | `message.id` | `FK_13ab388ba9004222977d552f832` | `CASCADE` | `NO ACTION` |

以下列在 `information_schema.REFERENTIAL_CONSTRAINTS`/`KEY_COLUMN_USAGE` 的引用记录中均不存在，符合设计：

- `document_chunk.kb_id`
- `message_reference.document_id`
- `message_reference.chunk_id`

结论：外键数量、引用目标和删除级联规则与 `task-02-database-core.md` 一致。

## 6. 实际执行过的命令

本节列出本次审计中对构建、类型、migration、数据库结构和 HTTP 行为有验收意义的命令。纯源码读取用的 `Get-Content`、`rg` 和 Git 差异查看不逐条展开。

### 6.1 用户指定的执行顺序

```powershell
pnpm --filter server build
pnpm --filter web type-check
pnpm --filter server migration:run
pnpm --filter server migration:revert
pnpm --filter server migration:run
```

### 6.2 数据库存在性与结构查询

实际通过 Compose MySQL 执行了：

```sql
SHOW TABLES FROM mini_rag;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'mini_rag';

SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE,
       IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'mini_rag';

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'mini_rag';

SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'mini_rag';

SELECT rc.TABLE_NAME, rc.CONSTRAINT_NAME, kcu.COLUMN_NAME,
       kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
       rc.UPDATE_RULE, rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
 AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
 AND kcu.TABLE_NAME = rc.TABLE_NAME
WHERE rc.CONSTRAINT_SCHEMA = 'mini_rag';

SELECT id, timestamp, name
FROM mini_rag.migrations
ORDER BY id;
```

另执行了 6 张业务表和 `migrations` 表的 `COUNT(*)` 查询。

### 6.3 其他运行态核查

```powershell
docker compose config --quiet
docker compose ps --all
Get-Service -Name MySQL80
pnpm --filter server migration:show
curl.exe -sS -i http://localhost:3000/api/health
curl.exe -sS -i http://localhost:3000/api/not-exist
curl.exe -sS -i -X POST http://localhost:3000/api/health
```

## 7. 每条命令的真实结果

### 7.1 用户指定的 5 条命令

| 顺序 | 命令 | 退出码 | 真实结果 |
|---:|---|---:|---|
| 1 | `pnpm --filter server build` | 0 | 执行 `nest build`，无 TypeScript error |
| 2 | `pnpm --filter web type-check` | 0 | 执行 `vue-tsc --noEmit`，无 TypeScript error |
| 3 | `pnpm --filter server migration:run` | 0 | 数据库当时已有 `InitSchema` 记录，输出 `No migrations are pending` |
| 4 | `pnpm --filter server migration:revert` | 0 | 识别最后一次 migration 为 `InitSchema1784800736682`；删除 5 条 FK、6 张业务表和 migration 记录；输出 `has been reverted successfully` |
| 5 | `pnpm --filter server migration:run` | 0 | 发现 1 条新 migration；创建 6 张业务表、索引与 5 条 FK；插入 migration 记录；输出 `has been executed successfully` |

以上 pnpm 命令都先出现一次：

```text
No projects matched the filters "D:\Users\Documents\RAG" in "D:\Users\Documents\RAG"
```

但随后正确进入 `server` 或 `web` workspace 执行目标脚本，退出码均为 `0`。该提示未被误记为命令失败。

### 7.2 数据库查询

| 查询 | 退出码 | 真实结果 |
|---|---:|---|
| `SHOW TABLES FROM mini_rag` | 0 | 返回 6 张业务表和 `migrations`，共 7 张 |
| `information_schema.TABLES` | 0 | 7 张表均为 `InnoDB`、`utf8mb4_unicode_ci` |
| `information_schema.COLUMNS` | 0 | 字段、类型、NULL、默认值与 migration/实体一致 |
| `information_schema.STATISTICS` | 0 | 3 个唯一索引、6 个命名普通索引及各表主键均存在 |
| `information_schema.TABLE_CONSTRAINTS` | 0 | 3 个 `UNIQUE`、5 个 `FOREIGN KEY` 及主键均存在 |
| FK 联查 | 0 | 仅 5 条 FK，全部 `DELETE_RULE=CASCADE`、`UPDATE_RULE=NO ACTION` |
| `mini_rag.migrations` | 0 | `2 / 1784800736682 / InitSchema1784800736682` |
| 表行数查询 | 0 | 6 张业务表均为 0 行，`migrations` 为 1 行 |

MySQL CLI 每次输出了安全警告：

```text
mysql: [Warning] Using a password on the command line interface can be insecure.
```

查询命令从本地 `.env` 读取密码并传给容器；报告和命令输出均未记录真实密码值。

### 7.3 Docker、migration 状态和 HTTP

| 命令 | 退出码 | 真实结果 |
|---|---:|---|
| `docker compose config --quiet` | 0 | Compose 配置可解析 |
| `docker compose ps --all` | 0 | MySQL、Qdrant 均为 `Up (healthy)` |
| `Get-Service -Name MySQL80` | 0 | Windows `MySQL80` 为 `Stopped` |
| `pnpm --filter server migration:show` | 0 | `[X] 2 InitSchema1784800736682` |
| `GET /api/health` | 0（curl） | HTTP 200；`{"code":0,"message":"success","data":{"status":"ok","db":"up",...}}` |
| `GET /api/not-exist` | 0（curl） | HTTP 404；`{"code":404,"message":"Cannot GET /api/not-exist"}` |
| `POST /api/health` | 0（curl） | HTTP 404；`{"code":404,"message":"Cannot POST /api/health"}` |

### 7.4 本次出现过的命令调用失败

第一次尝试通过嵌套 `sh -lc` 执行 `SHOW TABLES` 时，PowerShell/容器 shell 的引号传递使 SQL 被截断：

```text
退出码：1
ERROR 1064 (42000) ... SQL syntax
```

随后改为在 PowerShell 中读取 `.env`、将 SQL 作为单独参数传给容器内 mysql，等价查询退出码为 `0` 并返回全部 7 张表。该失败是审计命令的引号问题，不是 migration、数据库连接或 schema 失败。

## 8. 没有执行或执行失败的验收项

### 8.1 本次没有执行

以下项目来自 `task-02-database-core.md` 的完整验收清单，但不在用户本次强制执行的 5 条命令和结构查询范围内，且涉及修改环境、停启基础设施或人工浏览器检查，因此本次没有执行：

1. 没有执行 `DROP DATABASE IF EXISTS mini_rag; CREATE DATABASE ...` 的空库重建。当前第一次 `migration:run` 因 migration 已执行而为 no-op，随后通过指定的 `revert → run` 完成了等价的 6 张业务表删除/重建验证。
2. 没有在 `migration:revert` 与最终 `migration:run` 之间单独执行 `SHOW TABLES`，因此没有留下“当时只剩 migrations 表”的数据库输出证据。
3. 没有停止/启动 Compose MySQL 并在中间请求健康接口，故未重跑“数据库故障时进程存活、恢复后健康请求重试”的动态场景。
4. 没有临时删除根 `.env` 中的 `QDRANT_URL` 并启动后端；只静态确认了 `env.validation.ts` 中的校验实现。
5. 没有启动/操作浏览器进行前端按钮人工回归；已执行前端 `type-check`，并静态核对 Axios 解包。
6. 没有单独执行 synchronize 防回归实验。当前源码和两个 DataSource 均明确为 `synchronize: false`；同时任务说明中“重启自动跑 migration”和“revert 后重启仍只剩 migrations 表”存在语义冲突。
7. 没有重新执行 `migration:generate`。当前 `InitSchema` 已存在，且本次实查确认其最终 schema 与实体一致。

### 8.2 验收失败

- 用户本次指定的 5 条命令：**无失败**。
- 最终数据库表、字段、索引、唯一约束、外键查询：**无失败**。
- HTTP 健康和统一 404 结构检查：**无失败**。
- 唯一退出码非 0 的调用是 §7.4 的 SQL shell 引号错误；修正调用后查询成功，不计为产品验收失败。

## 9. 已知问题

1. Nest 运行时通过 `resolve(process.cwd(), '../.env')` 定位根 `.env`，依赖 cwd；T02 说明明确将其留待 T15。
2. CLI DataSource 直接读取 `process.env`，不复用 Nest 的 `validateEnvironment()`。
3. 后端当前使用 MySQL root 账号，没有独立最小权限业务用户。
4. Vite `/api` 代理目标固定为 `http://localhost:3000`，不会跟随 `SERVER_PORT`。
5. 前端健康请求失败时不清空之前的成功数据。
6. 根目录没有 `package.json` 和 `packageManager` 字段，仓库未在 package metadata 中固定精确 pnpm 版本。
7. pnpm 命令会输出一次非致命的“No projects matched”提示，虽然目标 workspace 随后正常执行。
8. README 的 MySQL 示例命令硬编码 `root123`，与 `.env` 修改不会自动同步。
9. `task-02-database-core.md` 的新增文件数量标题错误，并存在启动自动 migration 与 synchronize 防回归描述之间的矛盾。
10. 完整的故障恢复、环境变量失败和浏览器场景没有在本次核查中动态验证。

## 10. T02 最终结论

**部分通过**

判定依据：

- 代码交付层面：完成，未发现 T02 核心实现缺失。
- 用户本次明确要求的 build、type-check、migration `run → revert → run`：全部成功。
- 当前数据库结构：7 张目标表全部存在；字段、引擎、字符集、索引、唯一约束、5 条 CASCADE 外键全部符合。
- 当前运行态：MySQL healthy，3306 无冲突，健康接口 `db="up"`，统一成功/错误响应可用。
- 扣减项：T02 原完整验收清单仍有 7 类场景未在本次审计中执行，因此没有把“核心验收通过”扩大表述为“所有验收项完整通过”。

T03 未开始，本次也未修改任何业务功能。
