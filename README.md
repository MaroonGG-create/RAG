# Mini RAG

基于 Vue 3、NestJS、MySQL 与 Qdrant 的轻量知识库系统。

## 前置要求

- Node.js 20
- pnpm 9
- Docker（含 Docker Compose）

## 启动

```bash
cp .env.example .env
pnpm install
docker compose up -d

# 终端 1
pnpm --filter server dev

# 终端 2
pnpm --filter web dev
```

后端默认运行于 `http://localhost:3000`，前端默认运行于 `http://localhost:5173`。

## 数据库迁移

表结构只通过 TypeORM migration 管理，后端启动时也会自动执行尚未运行的 migration。

```bash
# 查看 migration 状态
pnpm --filter server migration:show

# 执行尚未运行的 migration
pnpm --filter server migration:run

# 回滚最近一次 migration
pnpm --filter server migration:revert

# 根据实体变更生成 migration（路径参数按实际名称调整）
pnpm --filter server migration:generate src/database/migrations/ChangeName
```

## 基本验证

```bash
docker compose ps
docker compose exec mysql mysql -uroot -proot123 -e "SHOW DATABASES;"
curl http://localhost:6333/collections
curl http://localhost:3000/api/health
```

## 常见问题

### MySQL 无法启动并提示 3306 端口被占用

先确认宿主机是否已有 MySQL 服务占用端口。Windows 可在管理员 PowerShell 中执行：

```powershell
Get-Service MySQL80
Stop-Service MySQL80
docker compose up -d
```

如果该服务承载其他数据库，请勿直接停止；应先安排停机，或临时调整 Compose 端口映射并同步根目录 `.env` 中的 `DB_PORT`。
