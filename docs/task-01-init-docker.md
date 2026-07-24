# T01 项目初始化与 Docker 环境 — Codex 执行指令

> 任务编号：T01（阶段 P1）
> 前置条件：无（仓库为空）
> 设计基线：见 `docs/00-overall-plan.md`，其中表结构、API 路径、端口、目录结构为冻结决策

---

## 一、当前项目背景

我们要从零搭建一个 Mini RAG 知识库系统（Vue3 + NestJS + MySQL + Qdrant），最终支持文档上传、切片、向量化、检索问答（SSE 流式）。**本任务只做工程脚手架与基础设施**，为后续所有任务提供可运行的地基。后续任务（解析、Embedding、检索、聊天）由其他指令单独下发。

## 二、本任务目标

1. 建立 monorepo 目录骨架（`server/` 后端 + `web/` 前端 + 根编排文件）。
2. `docker-compose.yml` 可一键启动 MySQL 8 和 Qdrant，带健康检查与数据卷。
3. NestJS 骨架可启动，提供 `GET /api/health`（含数据库连通性检查）。
4. Vue3 骨架可启动，首页能调用健康接口并展示结果（验证 CORS 与代理）。
5. `.env.example`、`.gitignore`、根 `README.md`（仅启动说明）齐备。

## 三、已有代码情况

仓库完全为空。没有任何代码，全部从零创建。

## 四、允许创建的文件清单及每个文件的职责

### 4.1 根目录

| 文件 | 职责 |
|---|---|
| `docker-compose.yml` | 仅定义 `mysql`、`qdrant` 两个服务（server/web 的容器化属于 T17，**本任务不写**） |
| `.env.example` | 仅包含本阶段需要的变量（见 §六），并保留注释说明后续任务会扩充 |
| `.gitignore` | node_modules、dist、.env、uploads/、*.log |
| `README.md` | 项目一句话简介 + 前置要求（Node 20 / pnpm 9 / Docker）+ 启动步骤 |
| `pnpm-workspace.yaml` | 声明 `server` 与 `web` 两个 workspace |

### 4.2 `server/`（NestJS 骨架）

| 文件 | 职责 |
|---|---|
| `package.json` | 依赖与脚本（见 §五），脚本含 `dev`(start:dev) / `build` / `start` |
| `tsconfig.json` / `tsconfig.build.json` | Nest 标准配置，`strict: true` |
| `nest-cli.json` | 标准配置 |
| `src/main.ts` | 启动入口：全局前缀 `api`、ValidationPipe(whitelist)、CORS 按 `CORS_ORIGIN` 配置、监听 `SERVER_PORT` |
| `src/app.module.ts` | 装配 ConfigModule(全局) + TypeOrmModule(异步配置) + HealthModule |
| `src/config/configuration.ts` | 读取环境变量并导出类型化配置对象 |
| `src/config/env.validation.ts` | 用 class-validator 校验本阶段必需变量，缺失即启动失败并指明变量名 |
| `src/database/typeorm.config.ts` | TypeORM 异步配置工厂（本阶段实体数组为空 `entities: []`，`synchronize: true` 仅开发期，加注释说明后续任务会注册实体） |
| `src/modules/health/health.module.ts` | 健康模块 |
| `src/modules/health/health.controller.ts` | `GET /api/health`：返回 `{ status: 'ok', db: 'up' \| 'down', uptime }` |
| `src/modules/health/health.service.ts` | 用 TypeORM DataSource 执行 `SELECT 1` 判断 DB 连通性，异常时 db='down' 但接口仍返回 200 |

> 禁止创建其他 module/controller/entity。**数据库实体属于 T02**。

### 4.3 `web/`（Vue3 骨架）

| 文件 | 职责 |
|---|---|
| `package.json` | 依赖与脚本（见 §五），脚本含 `dev` / `build` / `type-check` |
| `vite.config.ts` | dev server 端口 5173；代理 `/api → http://localhost:3000`（不 rewrite） |
| `tsconfig.json` + `env.d.ts` | Vue3 + TS 标准配置 |
| `index.html` | Vite 入口页 |
| `src/main.ts` | 挂载 App，引入 ant-design-vue 样式 |
| `src/App.vue` | 顶部项目标题 + `<router-view>`（本阶段可先不放 router，直接渲染 HomePage，二选一但需一致） |
| `src/api/http.ts` | Axios 实例：`baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api'`，响应拦截器统一抛出错误 |
| `src/api/health.ts` | `getHealth()` 调用 `GET /health`（经 baseURL 拼接后为 `/api/health`） |
| `src/types/health.ts` | `interface HealthResult { status: string; db: 'up' | 'down'; uptime: number }` |
| `src/views/HomePage.vue` | 占位首页：点击按钮调用健康接口，用 Ant Design 的 `Descriptions` 或卡片展示返回 JSON；失败时 `message.error` 展示错误信息 |

> Pinia、Vue Router 的完整接入、业务页面均不在本任务（属于 T14），如本阶段引入，仅允许最小可运行配置，不许建业务 store/路由表。

## 五、依赖与版本要求（锁版本，不得随意升级）

### server/package.json 关键依赖

```jsonc
{
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "mysql2": "^3.11.5",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.20"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.9",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.0",
    "typescript": "^5.6.3"
  }
}
```

### web/package.json 关键依赖

```jsonc
{
  "dependencies": {
    "ant-design-vue": "^4.2.6",
    "axios": "^1.8.4",
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "typescript": "~5.6.3",
    "vite": "^5.4.11",
    "vue-tsc": "^2.1.10"
  }
}
```

### docker-compose.yml 要求

- `mysql`：镜像 `mysql:8.0`；环境变量从根 `.env` 读取（`DB_USER/DB_PASSWORD/DB_NAME`，root 密码固定变量名 `DB_ROOT_PASSWORD`）；端口 `3306:3306`；卷 `mysql_data:/var/lib/mysql`；healthcheck 用 `mysqladmin ping`，`interval: 5s, retries: 10`；启动参数 `--character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci`。
- `qdrant`：镜像 `qdrant/qdrant:v1.12.4`；端口 `6333:6333`、`6334:6334`；卷 `qdrant_data:/qdrant/storage`；healthcheck 用 `wget -qO- http://localhost:6333/healthz`（镜像自带 wget，如不可用改用 `readyz`，二选一并在注释说明）。
- 两服务 `restart: unless-stopped`，置于同一自定义 bridge 网络。

### .env.example（本阶段最小集）

```bash
# Server
SERVER_PORT=3000
CORS_ORIGIN=http://localhost:5173
# MySQL（容器与后端共用）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root123
DB_ROOT_PASSWORD=root123
DB_NAME=mini_rag
# Qdrant（本阶段后端不连，仅起容器，T07 起使用）
QDRANT_URL=http://localhost:6333
# Web
VITE_API_BASE_URL=/api
```

## 六、启动方式（README 需照此编写）

```bash
cp .env.example .env
pnpm install                 # 根目录安装 workspace 全部依赖
docker compose up -d         # 启动 mysql + qdrant
pnpm --filter server dev     # 终端 1：后端 http://localhost:3000
pnpm --filter web dev        # 终端 2：前端 http://localhost:5173
```

## 七、验收命令与预期结果

```bash
# 1. 基础设施
docker compose up -d
docker compose ps
# 预期：mysql、qdrant 均为 running (healthy)

# 2. MySQL 可用且库已建
docker compose exec mysql mysql -uroot -proot123 -e "SHOW DATABASES;"
# 预期：列表含 mini_rag

# 3. Qdrant 可用
curl http://localhost:6333/collections
# 预期：{"result":{"collections":[]}, ...} （本阶段还没有 collection，正常）

# 4. 后端健康检查
curl http://localhost:3000/api/health
# 预期：{"status":"ok","db":"up","uptime":<number>}

# 5. 数据库断开时降级正确（停掉 mysql 再 curl）
docker compose stop mysql && curl http://localhost:3000/api/health
# 预期：HTTP 200，db 字段为 "down"；恢复后再测回到 "up"

# 6. 前端
# 浏览器打开 http://localhost:5173，点击按钮后页面展示健康检查 JSON，
# 浏览器 Network 面板可见 /api/health 请求 200，无 CORS 报错

# 7. 类型检查
pnpm --filter web type-check && pnpm --filter server build
# 预期：两者均 0 error
```

## 八、技术约束

1. Node.js 20、pnpm 9；所有依赖版本遵循 §五，pnpm-lock.yaml 需提交。
2. 后端开启 TypeScript strict；禁用 `any`（确需使用时注释原因）。
3. 健康接口路径必须是 `/api/health`（全局前缀 + 控制器内 `health` 路由，不要在控制器里写死 `/api`）。
4. CORS 只允许 `CORS_ORIGIN` 配置的来源，禁止 `origin: true` 全放通。
5. docker-compose 中禁止出现 `latest` 标签。
6. 不引入本清单以外的任何依赖（包括 Swagger、@nestjs/terminus —— Swagger 属于 T03，健康检查手写即可）。

## 九、异常处理要求

- 缺少必需环境变量 → 进程启动失败，错误信息列出缺失变量名。
- DB 连接失败 → 不阻止进程启动（健康接口负责暴露状态），但需 `console.error` 明确日志。
- 前端健康检查请求失败 → 页面用 `message.error` 提示，不允许白屏或未捕获 Promise。

## 十、明确禁止（属于后续任务，本任务一律不实现）

- ❌ 任何数据库实体/表（knowledge_base、document 等，T02）
- ❌ 知识库、文档、会话相关的任何接口与前端页面
- ❌ 文件上传、multer 配置
- ❌ pdf 解析、文本清洗、切片
- ❌ Embedding 客户端、Qdrant 客户端封装、collection 创建
- ❌ 聊天、SSE、LLM 调用
- ❌ Swagger 接入（T03 做）
- ❌ server/web 的 Dockerfile 与 compose 服务定义（T17）
- ❌ 鉴权、JWT、用户体系

## 十一、完成后必须输出的内容

请在最终回复中按以下结构汇报：

1. **修改文件清单**：新建/修改文件的完整路径列表。
2. **核心实现说明**：关键文件的设计要点（每个文件 1-3 句）。
3. **启动方式**：从零到跑通的命令序列。
4. **验证方式**：§七 验收命令的逐条执行结果（成功/失败 + 实际输出）。
5. **已知问题**：存在则列出，没有写"无"。
6. **未完成内容**：明确声明 §十 中各项均未实现。
