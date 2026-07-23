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

## 基本验证

```bash
docker compose ps
docker compose exec mysql mysql -uroot -proot123 -e "SHOW DATABASES;"
curl http://localhost:6333/collections
curl http://localhost:3000/api/health
```
