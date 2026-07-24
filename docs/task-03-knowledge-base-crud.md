# T03 知识库 CRUD（后端）— Codex 执行指令

> 任务编号：T03（阶段 P3）
> 前置条件：T02 已完成（结论：部分通过，核心实现完整；详见 `docs/reports/task-02-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（含 v1.1 / v1.2 修订记录）
> 实现依据：`docs/01-current-implementation.md`（2026-07-24 快照）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（判断依据：实现快照 + T02 完成报告）

| 资产 | 位置 | 本任务如何使用 |
|---|---|---|
| `KnowledgeBase` 实体 | `server/src/modules/knowledge-base/entities/knowledge-base.entity.ts` | 直接复用；仅按 §五.2 修改索引装饰器（`idx_name` → `uk_name` 唯一约束） |
| 实体注册 | `server/src/database/entities.ts` 的 `AppEntities` | **不动**；KnowledgeBase 已注册，`TypeOrmModule.forFeature([KnowledgeBase])` 即可注入 Repository |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | 已能把 `HttpException` 子类映射为 `{ code, message }`、ValidationPipe 数组错误映射为 `{ code: 400, message: '参数校验失败', details }`。**不动此文件** |
| 统一响应拦截器 | `src/common/interceptors/response.interceptor.ts` | 成功响应自动包装 `{ code: 0, message: 'success', data }`。**不动此文件** |
| migration 体系 | `src/database/data-source.ts` + 4 条 pnpm 脚本 | 用 `migration:generate` 生成新 migration（§七） |
| 统一成功/错误结构 | 见 §四.4 | 遵守，不得另造格式 |
| 代码约定 | 快照 §1.1：小写点分隔文件名、显式返回类型、catch 用 `unknown`、无显式 `any`、简短中文注释 | 严格遵守 |

**明确不存在、且本任务不得创建的东西**：`BusinessException` 基类（快照确认 T02 未创建）。**决策：复用 Nest 内置 `ConflictException` / `NotFoundException` / `BadRequestException`**，过滤器已覆盖其映射，引入自定义异常基类属于过度设计。

**一个重要的现有行为约束**：过滤器把 `QueryFailedError` 统一映射为 500。因此并发撞唯一索引的场景**不能依赖过滤器**，必须由 Service 在 `save()` 处捕获 `ER_DUP_ENTRY` 并转为 `ConflictException`（§四.3）。

---

## 二、本任务目标与范围

只实现 4 个后端接口 + Swagger 接入 + 1 个新 migration：

| # | 方法 | 路径 | 成功状态码 |
|---|---|---|---|
| 1 | POST | `/api/knowledge-bases` | 201 |
| 2 | GET | `/api/knowledge-bases` | 200 |
| 3 | GET | `/api/knowledge-bases/:id` | 200 |
| 4 | DELETE | `/api/knowledge-bases/:id` | 204（无响应体） |

---

## 三、文件清单

### 3.1 新增文件（server/，6 个代码文件 + 1 个生成文件）

| 文件 | 职责 |
|---|---|
| `src/modules/knowledge-base/knowledge-base.module.ts` | 知识库模块：`TypeOrmModule.forFeature([KnowledgeBase])` 注册 Repository，声明 controller 与 service |
| `src/modules/knowledge-base/knowledge-base.controller.ts` | 4 个路由；只做参数接收与转发，无业务逻辑；Swagger 装饰器 |
| `src/modules/knowledge-base/knowledge-base.service.ts` | 全部业务逻辑：重名预检、并发兜底、CRUD 编排、实体→响应 DTO 转换；删除编排也在此（含中文注释占位："T08+ 将在此处先清理 Qdrant 向量再删 MySQL 数据"） |
| `src/modules/knowledge-base/dto/create-knowledge-base.dto.ts` | 创建请求 DTO + class-validator 规则 + Swagger 装饰器 |
| `src/modules/knowledge-base/dto/knowledge-base-response.dto.ts` | 响应 DTO + `static fromEntity()` 映射方法 + Swagger 装饰器 |
| `src/common/pipes/parse-positive-int.pipe.ts` | 正整数路径参数管道：非数字或 ≤0 抛 `BadRequestException('id 必须是正整数')`；放在 common 是因为后续任务（documents/:id、conversations/:id）复用 |
| `src/database/migrations/<timestamp>-AddKnowledgeBaseNameUnique.ts` | 由 `migration:generate` 生成（§七） |

### 3.2 修改文件（server/，4 个）

| 文件 | 修改内容 |
|---|---|
| `src/modules/knowledge-base/entities/knowledge-base.entity.ts` | 删除 `@Index('idx_name', ['name'])`，改为 `@Unique('uk_name', ['name'])`；**其余字段、关系一概不动** |
| `src/app.module.ts` | imports 追加 `KnowledgeBaseModule`（位置在 `HealthModule` 之后） |
| `src/main.ts` | 两处：① 全局 ValidationPipe 增加 `transform: true`（`whitelist: true` 保留；不加 `forbidNonWhitelisted`）；② 追加 Swagger 初始化（§八）。其余配置不动 |
| `server/package.json` | 新增依赖 `@nestjs/swagger`（§八.1） |

### 3.3 修改文件（根目录，1 个）

| 文件 | 修改内容 |
|---|---|
| `README.md` | 新增"接口文档"一行：Swagger 地址 `http://localhost:3000/api/docs`；知识库 4 个接口的 curl 速查示例 |

**不允许改动**：`web/` 下任何文件、`src/common/filters/`、`src/common/interceptors/`、`src/database/` 下除新 migration 外的任何文件、实体目录下其他 5 个实体、`docker-compose.yml`、`.env*`、`env.validation.ts`、`configuration.ts`。

---

## 四、接口契约（冻结级）

### 4.1 DTO 字段与验证规则

**CreateKnowledgeBaseDto**

| 字段 | TS 类型 | 验证装饰器（顺序即语义） | Swagger |
|---|---|---|---|
| name | string | `@Transform(trim)` → `@IsString()` → `@IsNotEmpty()` → `@MaxLength(100)` | `@ApiProperty({ maxLength: 100, example: '产品文档库' })` |
| description | string? | `@Transform(trim)` → `@IsOptional()` → `@IsString()` → `@MaxLength(500)` | `@ApiPropertyOptional({ maxLength: 500 })` |

规则细化：
- `@Transform` 实现：`({ value }) => (typeof value === 'string' ? value.trim() : value)`。trim 后为空串的 name 触发 `@IsNotEmpty` → 400（"空白 name 返回 400"即由此路径实现，不允许在 Service 里再判空白）。
- description 为可选；trim 后是空串时由 **Service 归一化为 `null` 存储**（唯一允许的 Service 侧归一化）。
- 验证失败统一走过滤器现有分支：HTTP 400，`{ code: 400, message: '参数校验失败', details: [...] }`。

**KnowledgeBaseResponseDto**

| 字段 | TS 类型 | 来源 |
|---|---|---|
| id | number | entity.id |
| name | string | entity.name |
| description | string \| null | entity.description |
| documentCount | number | entity.documentCount（当前阶段恒为 0） |
| createdAt | string | entity.createdAt（Date 经 JSON 序列化为 ISO 字符串，DTO 声明 `string`） |
| updatedAt | string | 同上 |

- 提供 `static fromEntity(entity: KnowledgeBase): KnowledgeBaseResponseDto`，显式逐字段映射（禁止 `Object.assign`/展开实体，防止未来字段泄漏）。
- 响应 DTO 描述的是**包装结构里 `data` 的部分**；包装由拦截器完成，Controller 返回 DTO 本身。

### 4.2 Controller 路由与状态码

| 路由 | 参数 | 成功 | 说明 |
|---|---|---|---|
| `@Post()` | `@Body() dto: CreateKnowledgeBaseDto` | 默认 201 | 返回 ResponseDto |
| `@Get()` | 无 | 200 | 返回 `ResponseDto[]`，`order: { createdAt: 'DESC', id: 'DESC' }`（id 作并列决胜，保证稳定顺序） |
| `@Get(':id')` | `@Param('id', ParsePositiveIntPipe) id: number` | 200 | 不存在 → 404 |
| `@Delete(':id')` | 同上 | `@HttpCode(204)` | 返回 `void`，**无响应体**；不存在 → 404 |

- Controller 内不写 try/catch、不组装响应、不查库——全部在 Service。

### 4.3 Service 方法与 Repository 查询

```
create(dto):
  1. name 已trim（信任 DTO）；description = dto.description?.trim() || null
  2. 预检：repo.findOne({ where: { name } }) 命中 → throw new ConflictException('知识库名称已存在')
  3. try { saved = await repo.save(repo.create({ name, description })) }
     catch (e) { isDuplicateEntryError(e) → throw new ConflictException('知识库名称已存在'); 否则 rethrow }
  4. return KnowledgeBaseResponseDto.fromEntity(saved)

isDuplicateEntryError(e: unknown): boolean
  = e instanceof QueryFailedError
    && (e.driverError as { code?: string }).code === 'ER_DUP_ENTRY'
  （类型断言到带可选 code 的结构类型，禁止 any，加中文注释说明这是并发兜底）

findAll(): repo.find({ order: { createdAt: 'DESC', id: 'DESC' } }) → map(fromEntity)
  — 不加载任何关系（不写 relations），禁止 eager

findOne(id): repo.findOne({ where: { id } }) → null → throw new NotFoundException('知识库不存在')

remove(id):
  1. 复用 findOne 逻辑确认存在（不存在抛 404）
  2. repo.delete(id)   // MySQL 外键级联清理 document/conversation 等子表
  3. 中文注释占位：T08+ 将在 delete 之前插入 Qdrant 向量清理步骤，顺序为先向量后库
```

### 4.4 错误码与 HTTP 状态映射

| 场景 | 触发路径 | HTTP | 响应体 |
|---|---|---|---|
| 缺 name / 空白 name / name 超 100 / description 超 500 | ValidationPipe | 400 | `{ code: 400, message: '参数校验失败', details: [...] }` |
| id 非数字或 ≤0 | ParsePositiveIntPipe | 400 | `{ code: 400, message: 'id 必须是正整数' }` |
| 重名（预检命中） | ConflictException | 409 | `{ code: 409, message: '知识库名称已存在' }` |
| 重名（并发撞 uk_name） | ER_DUP_ENTRY → ConflictException | 409 | 同上 |
| 查询/删除不存在 | NotFoundException | 404 | `{ code: 404, message: '知识库不存在' }` |
| 成功 | 拦截器包装 | 200/201 | `{ code: 0, message: 'success', data }` |
| 删除成功 | `@HttpCode(204)` | 204 | **无响应体** |

---

## 五、重名与并发冲突处理（专项说明）

1. **为什么需要 DB 唯一约束**：应用层"先查后插"在并发下存在 TOCTOU 窗口，两个请求同时通过预检会双双插入。当前 `knowledge_base.name` 只有普通索引 `idx_name`（快照 §4.1 确认），必须升级为唯一约束。
2. **collation 影响（必须写进代码注释与汇报）**：表 collation 为 `utf8mb4_unicode_ci`，**大小写不敏感**。`'TestLib'` 与 `'testlib'` 在唯一索引和 `WHERE name = ?` 预检中都视为同名 → 两层判定行为一致，无需在应用层做大小写归一化。**不要**自作主张加 `LOWER()` 或改 collation。
3. **兜底路径**：预检通过但 `save()` 撞 `uk_name`（并发或 collation 边界情况）→ Service 捕获 `ER_DUP_ENTRY` 转 409，绝不允许以 500 暴露给调用方。

---

## 六、是否新增 migration

**是**。

- 实体改动：`idx_name` → `@Unique('uk_name', ['name'])` 后执行 `pnpm --filter server migration:generate src/database/migrations/AddKnowledgeBaseNameUnique`。
- 预期生成内容：`DROP INDEX idx_name ON knowledge_base` + `ADD UNIQUE INDEX uk_name(name)`。**逐行核对**，如生成内容包含任何其他表的变更说明实体与库已不一致，立即停止并报告，不允许手工修补生成结果蒙混。
- 生成的 migration 不允许修改 `1784800736682-InitSchema.ts`；`down()` 应能还原（删 uk_name、恢复 idx_name）。
- 执行顺序：先 `migration:run` 应用，再启动服务验收。

---

## 七、Swagger 方案

### 7.1 依赖

| 包 | 版本 | 说明 |
|---|---|---|
| `@nestjs/swagger` | `^8.1.0` | 适配 NestJS 10；`swagger-ui-express` 为其自带依赖，不单独安装 |

### 7.2 接入方式（main.ts 追加）

- `DocumentBuilder`：`setTitle('Mini RAG API')`、`setVersion('0.1.0')`、`setDescription('所有非 SSE 接口的成功响应统一包装为 { code: 0, message: "success", data }；本文档中的 Schema 描述 data 部分。')`。
- `SwaggerModule.setup('docs', app, document)` 放在 `setGlobalPrefix('api')` **之后**，最终访问路径：**`http://localhost:3000/api/docs`**（JSON 描述：`/api/docs-json`）。
- 只描述**当前已存在**的接口：health 与 knowledge-bases 两组。禁止在 Swagger 里预先声明 documents、chat、conversations 等未来接口。

### 7.3 装饰器约定

- Controller：`@ApiTags('knowledge-bases')`；每个路由 `@ApiOperation({ summary })` + 状态码响应装饰器（`@ApiCreatedResponse` / `@ApiOkResponse` / `@ApiNoContentResponse` / `@ApiConflictResponse` / `@ApiNotFoundResponse` / `@ApiBadRequestResponse`）。
- DTO：`@ApiProperty` / `@ApiPropertyOptional` 与 §4.1 表格一致。
- HealthController：仅补 `@ApiTags('health')` 与 `@ApiOperation`，**不改动其任何逻辑**。

---

## 八、实现顺序（严格按序）

1. 改实体索引装饰器 → `migration:generate` → 按 §六核对 → `migration:run` → 数据库确认 `uk_name`（`SHOW INDEX FROM knowledge_base`）。
2. 安装 `@nestjs/swagger`。
3. `parse-positive-int.pipe.ts`。
4. 两个 DTO。
5. Service（§4.3）。
6. Controller + Module，`app.module.ts` 注册。
7. `main.ts`：`transform: true` + Swagger；`health.controller.ts` 补两个装饰器。
8. `pnpm --filter server build` 通过后执行 §十全部验收。
9. 更新 README。

---

## 九、技术约束

1. 延续 T01/T02 代码约定；新增公开方法显式声明返回类型。
2. 禁止 `any`；`driverError` 断言按 §4.3 给定的结构类型写法。
3. 所有查询禁止加载关系、禁止 eager；列表不分页（MVP 约定，加注释说明数据量级假设）。
4. 事务：本任务无多步写入，不引入 `dataSource.transaction`。
5. 不改全局过滤器/拦截器/DatabaseService 的任何行为。

---

## 十、验收命令与接口测试

> 前置：`docker compose ps` 确认 mysql healthy；后端 `pnpm --filter server dev` 运行中。
> Windows PowerShell 下用 `curl.exe`；JSON body 注意引号转义，或将 body 写入临时文件用 `--data-binary @file`。

```bash
# 0. 静态检查与 migration
pnpm --filter server build
# 预期：0 error
docker compose exec mysql mysql -uroot -proot123 -e "USE mini_rag; SHOW INDEX FROM knowledge_base;"
# 预期：uk_name Non_unique=0；不存在 idx_name

# 1. 创建成功
curl -X POST http://localhost:3000/api/knowledge-bases \
  -H "Content-Type: application/json" -d '{"name":"产品文档库","description":"产品相关文档"}'
# 预期：201；body = {"code":0,"message":"success","data":{"id":<n>,"name":"产品文档库","description":"产品相关文档","documentCount":0,"createdAt":"...","updatedAt":"..."}}

# 2. name 自动 trim
curl -X POST .../api/knowledge-bases -d '{"name":"  研发资料  "}'
# 预期：201，data.name 为 "研发资料"（无首尾空格），description 为 null

# 3. 缺少 name → 400
curl -X POST .../api/knowledge-bases -d '{"description":"x"}'
# 预期：400 {"code":400,"message":"参数校验失败","details":[...]}

# 4. 空白 name → 400
curl -X POST .../api/knowledge-bases -d '{"name":"   "}'
# 预期：400 同上

# 5. name 超长（101 字符）→ 400
# 6. description 超长（501 字符）→ 400
# 预期：均 400 统一结构

# 7. 重复 name → 409（应用层预检路径）
curl -X POST .../api/knowledge-bases -d '{"name":"产品文档库"}'
# 预期：409 {"code":409,"message":"知识库名称已存在"}

# 7b. 大小写变体重名 → 409（验证 collation 行为）
curl -X POST .../api/knowledge-bases -d '{"name":"TestLib"}'
curl -X POST .../api/knowledge-bases -d '{"name":"testlib"}'
# 预期：第一个 201，第二个 409

# 7c. 并发兜底路径（可选但鼓励执行）：两个终端同时 POST 相同新名
# 预期：一个 201，另一个 409（绝不允许出现 500 "数据库操作失败"）

# 8. 列表按 createdAt 倒序
curl http://localhost:3000/api/knowledge-bases
# 预期：200；data 数组按 createdAt 降序；每项含 id/name/description/documentCount/createdAt/updatedAt，无 documents/conversations 字段

# 9. 查询不存在 → 404
curl http://localhost:3000/api/knowledge-bases/99999
# 预期：404 {"code":404,"message":"知识库不存在"}

# 9b. id 非法 → 400
curl http://localhost:3000/api/knowledge-bases/abc   # 预期：400 {"code":400,"message":"id 必须是正整数"}
curl http://localhost:3000/api/knowledge-bases/-1    # 预期：同上

# 10. 删除成功 → 204 无 body
curl -i -X DELETE http://localhost:3000/api/knowledge-bases/<上一步创建的id>
# 预期：HTTP 204，响应体为空（无 Content-Type: application/json 包装残留）

# 11. 删除不存在 → 404
curl -i -X DELETE http://localhost:3000/api/knowledge-bases/99999
# 预期：404 统一结构

# 12. Swagger
curl http://localhost:3000/api/docs-json
# 预期：200；paths 仅包含 /api/health 与 /api/knowledge-bases 相关路径；无 documents/chat 等未来接口
# 浏览器打开 http://localhost:3000/api/docs 可渲染
```

验收后清理：可用 DELETE 接口清掉测试数据，保持库内数据可展示。

---

## 十一、明确禁止（本任务一律不实现）

- ❌ 前端知识库页面及 `web/` 下任何改动
- ❌ 文档上传和文档接口、文档解析与切片
- ❌ Qdrant、Embedding、LLM、Chat、SSE、会话接口
- ❌ 鉴权、JWT
- ❌ 软删除（`deleted_at`、TypeORM softRemove 等）
- ❌ 通用 BaseService、CRUD 生成器、自定义 BusinessException 基类
- ❌ PUT/PATCH 更新接口（MVP 无更新功能，不允许顺手实现）
- ❌ 分页参数与分页逻辑
- ❌ Jest/单测框架搭建（统一属 T16；本任务验收以 §十 curl 用例为准）
- ❌ 修改 `1784800736682-InitSchema.ts`
- ❌ 修改全局过滤器、拦截器、DatabaseService、其他 5 个实体
- ❌ Swagger 中声明任何未来接口

---

## 十二、完成后必须输出的内容

1. **修改文件清单**：分"新增/修改"两组列完整路径。
2. **核心实现说明**：重点说明 ① 重名预检 + ER_DUP_ENTRY 兜底两级机制 ② collation 对重名判定的影响及结论 ③ trim 的实现位置与生效前提（transform: true）④ 删除接口的编排位置与 204 实现方式 ⑤ 新 migration 的生成与核对结论。
3. **启动方式**：从 migration 到服务的命令序列。
4. **验证方式**：§十验收命令逐条结果（成功/失败 + 关键实际输出；7c 若执行需附两个并发请求的真实状态码）。
5. **已知问题**：存在则列出，没有写"无"。
6. **未完成内容**：明确声明 §十一各项均未实现。
