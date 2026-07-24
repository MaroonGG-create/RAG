# T03 知识库 CRUD 完成报告

> 验收日期：2026-07-24（Asia/Shanghai）  
> 工作区：`D:\Users\Documents\RAG`  
> 当前提交：`d99e8ce90c6980159955d6adfa928e650bf2be17`（`feat: 增删改查`）  
> T02 基线提交：`66372bc79acb4ff3edf384d5083004cf35ad1aab`  
> 实际任务文档：`docs/task-03-knowledge-base-crud.md`  
> 范围：最终验收与文档收口；没有开发 T04，没有修改业务代码。

## 1. T03 最终结论

**通过**

判定依据：

- T03 的 4 个接口、2 个 DTO、Service、Controller、Module、正整数 Pipe、唯一索引 Migration 和 Swagger 均已按当前代码落地。
- T02 的 `InitSchema` Migration 未被 T03 修改。
- `migration:show`、`migration:run`、后端构建、前端类型检查全部退出码为 `0`。
- 数据库实查确认 `uk_name(name)` 存在且 `Non_unique=0`，`idx_name` 不存在。
- 创建、trim、空描述、5 类参数校验、普通重名、大小写重名、并发重名、列表、详情、删除和 Swagger 均完成真实运行验收。
- 并发重名实际得到一个 201、一个 409，没有 500。
- DELETE 实际返回 204、0 字节响应体、无 `Content-Type: application/json`。
- 本轮创建的测试数据全部通过 DELETE 接口清理；`knowledge_base` 最终为 0 行，2 条 migration 记录均保留。
- 未发现用户列出的越界功能。

## 2. 新增文件清单

### 2.1 最新 CRUD 提交相对 T02 基线的新增文件

1. `docs/task-03-knowledge-base-crud.md`
2. `server/src/common/pipes/parse-positive-int.pipe.ts`
3. `server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts`
4. `server/src/modules/knowledge-base/dto/create-knowledge-base.dto.ts`
5. `server/src/modules/knowledge-base/dto/knowledge-base-response.dto.ts`
6. `server/src/modules/knowledge-base/knowledge-base.controller.ts`
7. `server/src/modules/knowledge-base/knowledge-base.module.ts`
8. `server/src/modules/knowledge-base/knowledge-base.service.ts`

其中 T03 任务要求的新增 server 文件为 7 个；`docs/task-03-knowledge-base-crud.md` 是同一提交中的任务文档。

### 2.2 本次验收收口新增文件

1. `docs/reports/task-03-completion.md`

## 3. 修改文件清单

### 3.1 最新 CRUD 提交相对 T02 基线的修改文件

1. `README.md`
2. `docs/reports/task-02-completion.md`
3. `pnpm-lock.yaml`
4. `server/package.json`
5. `server/src/app.module.ts`
6. `server/src/main.ts`
7. `server/src/modules/health/health.controller.ts`
8. `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts`

### 3.2 本次验收收口修改文件

1. `docs/01-current-implementation.md`

本次没有修改任何 `.ts`、`.vue`、package manifest、Migration 或其他业务文件。

## 4. 实际 Migration 文件名

```text
server/src/database/migrations/1784871996843-AddKnowledgeBaseNameUnique.ts
```

类名：

```text
AddKnowledgeBaseNameUnique1784871996843
```

当前 `migrations` 表实查记录：

| id | timestamp | name |
|---:|---:|---|
| 2 | `1784800736682` | `InitSchema1784800736682` |
| 3 | `1784871996843` | `AddKnowledgeBaseNameUnique1784871996843` |

## 5. Migration up/down 内容摘要

### 5.1 `up()`

逐行只有两条 DDL：

```sql
DROP INDEX `idx_name` ON `knowledge_base`;
CREATE UNIQUE INDEX `uk_name` ON `knowledge_base` (`name`);
```

### 5.2 `down()`

逐行只有两条 DDL：

```sql
DROP INDEX `uk_name` ON `knowledge_base`;
CREATE INDEX `idx_name` ON `knowledge_base` (`name`);
```

### 5.3 限定范围核对

- 只涉及 `knowledge_base.name` 的 `idx_name`/`uk_name`。
- 没有其他表、字段、索引或外键变化。
- `down()` 能恢复 T02 的普通索引。
- T02 `server/src/database/migrations/1784800736682-InitSchema.ts` 在 T02 基线和当前 HEAD 的 Git blob 均为：

```text
10989fa4209f40082265e759d0de8dd284241c9a
```

结论：T02 InitSchema 未修改。

## 6. `knowledge_base` 实际索引结果

最终实际执行 `SHOW INDEX FROM mini_rag.knowledge_base`：

| Key_name | Non_unique | Seq_in_index | Column_name | Index_type |
|---|---:|---:|---|---|
| `PRIMARY` | 0 | 1 | `id` | `BTREE` |
| `uk_name` | 0 | 1 | `name` | `BTREE` |

结论：

- `uk_name` 存在。
- `Non_unique=0`。
- `idx_name` 不存在。
- `name` 列和表的实际 collation 都是 `utf8mb4_unicode_ci`。

## 7. 四个接口实现摘要

| 方法 | 路径 | Controller → Service | 成功状态 | 成功响应 |
|---|---|---|---:|---|
| POST | `/api/knowledge-bases` | `create()` → `create()` | 201 | 统一 envelope，`data` 为 `KnowledgeBaseResponseDto` |
| GET | `/api/knowledge-bases` | `findAll()` → `findAll()` | 200 | 统一 envelope，`data` 为 DTO 数组 |
| GET | `/api/knowledge-bases/:id` | `findOne()` → `findOne()` | 200 | 统一 envelope，`data` 为单个 DTO |
| DELETE | `/api/knowledge-bases/:id` | `remove()` → `remove()` | 204 | 严格空响应体 |

Controller 只接收参数并转发；没有查询、重名判断或响应组装逻辑。

列表 Repository 查询为：

```ts
order: { createdAt: 'DESC', id: 'DESC' }
```

没有加载任何 relation。

## 8. DTO 校验和 trim 实现

### 8.1 `CreateKnowledgeBaseDto`

`name`：

- `@Transform()`：字符串执行 `trim()`。
- `@IsString()`。
- `@IsNotEmpty()`。
- `@MaxLength(100)`。

`description`：

- `@Transform()`：字符串执行 `trim()`。
- `@IsOptional()`。
- `@IsString()`。
- `@MaxLength(500)`。

`server/src/main.ts` 的全局 ValidationPipe 当前包含：

```ts
{
  whitelist: true,
  transform: true,
}
```

`transform: true` 使 DTO 的 trim 真正生效。

Service 对 description 再执行：

```ts
dto.description?.trim() || null
```

因此缺失、空串或只含空格的 description 最终保存为 `null`。

### 8.2 `KnowledgeBaseResponseDto`

只显式映射：

- `id`
- `name`
- `description`
- `documentCount`
- `createdAt`
- `updatedAt`

`createdAt`、`updatedAt` 由 `Date.toISOString()` 转为字符串。没有展开实体，因此不会泄漏 `documents`、`conversations` 或未来字段。

## 9. 重名预检机制

`KnowledgeBaseService.create()` 先执行：

```ts
repository.findOne({ where: { name } })
```

命中时抛出：

```ts
new ConflictException('知识库名称已存在')
```

全局异常过滤器最终返回：

```json
{
  "code": 409,
  "message": "知识库名称已存在"
}
```

由于 `knowledge_base.name` 使用 `utf8mb4_unicode_ci`，预检查询和唯一索引都按大小写不敏感规则判断，无需应用层 `LOWER()`。

## 10. `ER_DUP_ENTRY` 并发兜底机制

应用层“先查后插”存在并发窗口。`save()` 外层捕获 `unknown`，仅在同时满足以下条件时转为 409：

```ts
error instanceof QueryFailedError
(error.driverError as { code?: string }).code === 'ER_DUP_ENTRY'
```

其他错误原样继续抛出。

本次对相同动态名称同时发出两个 POST，实际状态码为：

```text
201
409
```

409 的 message 为“知识库名称已存在”，没有出现 500。

黑盒并发结果只能证明最终行为正确；在不增加日志/埋点的前提下，不能区分该 409 是第二个请求在预检阶段命中，还是在 `save()` 阶段由 `ER_DUP_ENTRY` 兜底转换。兜底分支本身已由静态代码逐行确认。

## 11. `utf8mb4_unicode_ci` 大小写重名的实际结果

实际顺序请求：

1. `TestLib` → HTTP 201。
2. `testlib` → HTTP 409。

第二个响应：

```json
{
  "code": 409,
  "message": "知识库名称已存在"
}
```

数据库实查：

```text
knowledge_base TABLE_COLLATION = utf8mb4_unicode_ci
name column Collation          = utf8mb4_unicode_ci
```

结论：当前数据库大小写重名行为与 T03 设计一致。

## 12. DELETE 204 空响应体的真实验证结果

对本轮创建且存在的知识库执行 DELETE：

| 项目 | 实际结果 |
|---|---|
| HTTP 状态码 | `204` |
| 响应体字节数 | `0` |
| `Content-Type` | 不存在 |
| `Content-Length` | 不存在 |
| JSON envelope | 不存在 |

随后再次删除同一个 id：

```text
HTTP 404
{"code":404,"message":"知识库不存在"}
```

当前实现没有给 DELETE 加 `@SkipResponseWrap()`；拦截器内部仍会处理 `undefined`，但 Express 对 HTTP 204 最终剥离实体响应头并清空 body。本次真实响应符合冻结契约。

## 13. Swagger 实际地址和 paths

### 13.1 Swagger UI

实际地址：

```text
http://localhost:3000/api/docs
```

结果：

- HTTP 200。
- `Content-Type: text/html; charset=utf-8`。
- HTML title 为 `Swagger UI`。
- `swagger-ui.css` → HTTP 200。
- `swagger-ui-bundle.js` → HTTP 200。
- `swagger-ui-init.js` → HTTP 200。

### 13.2 OpenAPI JSON

实际地址：

```text
http://localhost:3000/api/docs-json
```

结果：

- HTTP 200。
- 原始 OpenAPI JSON，不经过 `{ code, data }` 包装。
- title：`Mini RAG API`。
- version：`0.1.0`。

实际 paths/methods：

```text
/api/health                   GET
/api/knowledge-bases          GET, POST
/api/knowledge-bases/{id}     GET, DELETE
```

各 operation 的实际 tags（OpenAPI 根级 `tags` 字段未声明）：

```text
health
knowledge-bases
```

OpenAPI paths 中不存在：

- documents
- chat
- conversations
- embedding
- vector-store

`server/src/main.ts` 实际使用：

```ts
SwaggerModule.setup('docs', app, swaggerDocument, {
  useGlobalPrefix: true,
})
```

因此 Swagger 最终位于 `/api/docs`，不是根 `/docs`。

## 14. 实际执行过的命令

### 14.1 Migration 与数据库

```powershell
pnpm --filter server migration:show
pnpm --filter server migration:run
docker compose exec -T mysql mysql ... -e "SHOW INDEX FROM mini_rag.knowledge_base; ..."
```

真实结果：

```text
[X] 2 InitSchema1784800736682
[X] 3 AddKnowledgeBaseNameUnique1784871996843
No migrations are pending
```

### 14.2 构建

```powershell
pnpm --filter server build
pnpm --filter web type-check
```

两条命令均退出码 `0`。

### 14.3 运行环境

```powershell
docker compose config --quiet
docker compose ps --all
Get-Service -Name MySQL80
curl.exe -i http://localhost:3000/api/health
```

实际结果：

- Compose 配置可解析。
- MySQL `Up (healthy)`。
- Qdrant `Up (healthy)`。
- Windows `MySQL80` 为 `Stopped`。
- 后端已有 `nest start --watch` 进程监听 3000。
- 健康接口 HTTP 200，`data.db="up"`。

### 14.4 接口矩阵

使用 Node 20 原生 `fetch` 同时记录状态码、响应头、body 字节数和 JSON，并在 `finally` 中只清理本轮 201 返回的 id。

前两次测试脚本调用问题如实记录：

1. 首次脚本使用 CommonJS stdin 顶层 `await`，Node 在发出任何 HTTP 请求前以 SyntaxError 退出；没有产生测试数据。
2. 修正后，Windows PowerShell 管道把脚本源码中的中文请求字面量降级为 `?`；该轮中文语义结果作废。该轮实际创建的 4 条数据均已通过 DELETE 返回 204 清理，最终列表为 0。
3. 最终使用 ASCII 脚本源码中的 Unicode 转义重新执行完整矩阵，退出码 `0`，结果见 §15。

### 14.5 Swagger

```powershell
curl.exe -D - http://localhost:3000/api/docs -o NUL
curl.exe http://localhost:3000/api/docs
curl.exe -o NUL -w ... http://localhost:3000/api/docs/swagger-ui.css
curl.exe -o NUL -w ... http://localhost:3000/api/docs/swagger-ui-bundle.js
curl.exe -o NUL -w ... http://localhost:3000/api/docs/swagger-ui-init.js
# Node fetch + JSON.parse 检查 /api/docs-json
```

第一次 header-only 调用把 PowerShell `$null` 直接作为 curl `-o` 参数，curl 因缺少实际参数在请求前退出；改用 Windows `NUL` 后成功。该问题是验收命令写法，不是 Swagger 失败。

### 14.6 清理复查

```sql
SELECT COUNT(*) FROM mini_rag.knowledge_base;
SELECT id, timestamp, name FROM mini_rag.migrations ORDER BY id;
SHOW INDEX FROM mini_rag.knowledge_base;
```

最终：

- `knowledge_base`：0 行。
- `migrations`：2 行，记录未删除。
- `uk_name` 仍存在。

## 15. 每项验收的真实状态码和结果

| 验收项 | 实际状态码 | 真实结果 | 结论 |
|---|---:|---|---|
| 初始列表 | 200 | `data=[]` | 通过 |
| 创建“产品文档库” | 201 | `code=0`、`documentCount=0`、两个时间字段存在 | 通过 |
| name/description trim | 201 | 保存为“研发资料”/“内部资料” | 通过 |
| 空白 description | 201 | 保存为 `null` | 通过 |
| 缺少 name | 400 | 统一校验结构，含 `details` | 通过 |
| `name=""` | 400 | 统一校验结构 | 通过 |
| `name="   "` | 400 | 统一校验结构 | 通过 |
| name 101 字符 | 400 | 统一校验结构 | 通过 |
| description 501 字符 | 400 | 统一校验结构 | 通过 |
| 同名第二次创建 | 409 | message“知识库名称已存在” | 通过 |
| `TestLib` | 201 | 创建成功 | 通过 |
| `testlib` | 409 | 大小写不敏感重名 | 通过 |
| 两个并发同名 POST | 201、409 | 一个成功、一个冲突、无 500 | 通过 |
| 列表 | 200 | `createdAt DESC, id DESC`；每项严格 6 字段 | 通过 |
| 列表关系泄漏 | 200 | 无 `documents`、`conversations` | 通过 |
| 存在 id 详情 | 200 | 返回对应 id | 通过 |
| id=`abc` | 400 | message“id 必须是正整数” | 通过 |
| id=`0` | 400 | message“id 必须是正整数” | 通过 |
| id=`-1` | 400 | message“id 必须是正整数” | 通过 |
| 不存在 id 详情 | 404 | message“知识库不存在” | 通过 |
| 删除存在 id | 204 | 0 字节、无 JSON Content-Type | 通过 |
| 删除不存在 id | 404 | 统一错误结构 | 通过 |
| `/api/docs` | 200 | Swagger UI HTML 和关键资源可访问 | 通过 |
| `/api/docs-json` | 200 | paths/tags 精确符合当前接口 | 通过 |
| 测试数据清理 | 204 × 全部 | 最终列表和 DB count 均为 0 | 通过 |

规范 UTF-8 验收轮创建的 id 为 26、27、28、29、30；id 28 在删除场景中删除，其余在 finally 清理。

## 16. 未执行的验收项

用户本次列出的功能验收项均已执行。

证据边界：

- 没有重复执行 `migration:generate`，因为 T03 Migration 已存在且已执行；用户明确要求不要重复生成。
- 没有执行 Migration revert，因为本次只要求 `show` 和 `run`，`down()` 通过逐行静态核对确认。
- 没有停止已有后端再重复启动；验收开始时已确认监听 3000 的进程命令链为 `nest start --watch`，健康接口为 `db=up`，全量请求均在该真实实例执行。
- 没有增加日志或埋点区分并发 409 来自预检还是 `ER_DUP_ENTRY` 分支；只记录代码证据与黑盒最终结果。
- 没有进行人工 GUI 点击；`/api/docs` HTML、Swagger UI 标记和三个关键静态资源均实际返回 200，`/api/docs-json` 完整解析成功。

## 17. 与 task-03 文档的差异

1. 用户要求检查的路径是 `docs/tasks/task-03-knowledge-base-crud.md`，该路径不存在；仓库实际文件是 `docs/task-03-knowledge-base-crud.md`。
2. T03 文档称 `docs/00-overall-plan.md` 含 v1.2 修订记录，但总体方案当前只有 v1.1 修订记录。
3. 总体方案 §5.1 仍写 `idx_name(name)` 和“重名由应用层校验”，与 T03 当前 `uk_name` 数据库唯一约束不一致。
4. T03 §3 修改文件清单漏列 `server/src/modules/health/health.controller.ts`，但 §八第 7 步明确要求为 health 增加 Swagger 装饰器。
5. `pnpm-lock.yaml` 因安装 `@nestjs/swagger` 发生正常变化，但 §3 文件清单未列出。
6. 最新 CRUD 提交还新增任务文档、修改 `docs/reports/task-02-completion.md`，未列在 T03 §3 实现文件清单内。
7. `docs/task-03-knowledge-base-crud.md` 与实现处于同一个 Git 提交，Git 历史不能证明任务文档先于代码存在。
8. `docs/01-current-implementation.md` 未随 T03 提交更新，本次验收已补齐。
9. Axios/响应包装、DatabaseService、其他 5 个实体和 `web/` 均未被 T03 修改，符合限制。

除上述文档/清单差异外，未发现 T03 业务实现偏离冻结契约。

## 18. 已知问题

1. **时间字段存在 8 小时偏移**：本机实际时间为 `2026-07-24 14:42 +08:00`，正确的 Node UTC 为 `2026-07-24T06:42Z`，MySQL `NOW()`/`UTC_TIMESTAMP()` 均为 `2026-07-24 06:42`，但本次 API 创建结果为约 `2026-07-23T22:41Z`，相对正确 UTC 早约 8 小时。MySQL 容器系统时区为 UTC，TypeORM/mysql2 连接未显式配置 timezone，当前时间解析存在环境时区偏移。
2. **ParsePositiveIntPipe 接受宽松数字文本**：实现基于 `Number(value)`，因此 `1e2`、`0x10`、`1.0` 会被接受；也没有显式检查 `Number.isSafeInteger()` 或 `INT UNSIGNED` 上限。本次要求的 `abc/0/-1` 均正确拒绝。
3. **Nest `.env` 加载依赖 cwd**：`resolve(process.cwd(), '../.env')` 在脱离 `server/` cwd 时可能读错，属于 T02 延续问题。
4. **CLI DataSource 不复用 Nest 校验**：CLI 直接读取 `process.env`。
5. **数据库使用 root 账号**：当前没有独立最小权限业务用户。
6. **Windows MySQL80 启动类型仍为 Automatic**：当前虽为 Stopped，但系统重启后可能再次与 Compose 3306 冲突。
7. **pnpm 非致命提示**：本次 migration/build/type-check 仍先输出一次 `No projects matched the filters "D:\Users\Documents\RAG"`，随后目标 workspace 正常执行且退出码为 0。
8. **总体方案文档漂移**：`docs/00-overall-plan.md` 的 knowledge_base 索引描述仍停留在 T02。
9. **T02 完成报告是历史报告**：其中 `idx_name`、单条 migration、T03 未开始等表述是 T02 当时事实，不能再作为 T03 后当前状态；当前状态以 `docs/01-current-implementation.md` 和本报告为准。
10. **Swagger Schema 描述的是 envelope 内的 data**：这是 T03 明确设计，不是完整线上响应 envelope；调用方仍应以真实统一响应结构为准。
11. **并发分支的黑盒证据有限**：已证明最终为 201/409 且无 500，但未通过运行日志确认具体 409 分支。

## 19. 是否存在越界实现

**不存在。**

| 检查项 | 实际结果 |
|---|---|
| 前端知识库页面 | 无；`web/` 相对 T02 无修改 |
| 文档上传 | 无 |
| 文档处理/解析/切片 | 无 |
| Qdrant 功能 | 无客户端、连接、collection 或调用代码 |
| Embedding | 无服务或调用 |
| Chat | 无 |
| SSE | 无端点 |
| 会话接口 | 无 |
| 更新知识库接口 | 无 PUT/PATCH |
| 分页 | 无 |
| 鉴权/JWT | 无 |
| BaseService/通用 CRUD | 无 |
| Swagger 未来接口 | 无 |

以下既有痕迹不属于越界功能：

- Compose Qdrant、`QDRANT_URL`、`qdrant_point_id` 是 T01/T02 基础设施/模型。
- ResponseInterceptor 的 SSE 排除机制是 T02 已有能力。
- `KnowledgeBaseService.remove()` 只有一条 T08+ Qdrant 清理注释，没有实际调用。
- Swagger 描述文字提到“非 SSE 接口”，没有 SSE 路由。

## 20. 是否具备进入 T04 的条件

**具备。**

理由：

- T03 四个 CRUD 接口和 Swagger 已通过实际验收。
- `uk_name` 已正确落库，重名与并发最终一致性可用。
- Migration、构建、类型检查、数据库和清理状态正常。
- 当前没有越界提前实现 T04，不需要回滚或删除业务代码。
- `knowledge_base` 当前为空，migration 记录完整，可在干净业务数据状态进入下一阶段。

进入 T04 时应：

- 以更新后的 `docs/01-current-implementation.md` 和本报告作为当前状态基线；
- 保留两条现有 Migration，不修改 T02/T03 历史 Migration；
- 不把总体方案中仍写着的 `idx_name` 当作当前数据库事实；
- 将时间字段偏移作为非阻塞已知问题，避免在 T04 验收中误判时间值。
