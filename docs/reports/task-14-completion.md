# T14 整体联调与体验收口完成报告

> 日期：2026-07-31  
> 范围：整体接口契约核对、联调回归、体验收口、README 和环境配置核对  
> 结论：T14 范围内收口完成；具备进入测试、部署和项目收口阶段的条件。

## 修复的问题

1. 后端生产代码中的 `console.error` 已替换为 Nest `Logger`：
   - `server/src/common/filters/http-exception.filter.ts`
   - `server/src/main.ts`
   - `server/src/modules/health/health.service.ts`
   - `server/src/database/database.service.ts`
   CLI 脚本仍保留 stdout/stderr 输出，用于机器可读 JSON 和命令行错误提示。

2. 知识库删除补齐磁盘清理：
   - 删除知识库前先按 `knowledgeBaseId` 清理 Qdrant 向量。
   - 查询知识库下文档，逐个清理上传文件和 `.parsed/{documentId}.json`。
   - 删除 `server/uploads/{knowledgeBaseId}` 目录。
   - 最后删除 `knowledge_base` 记录，由数据库级联删除文档、切片、会话、消息和引用。
   - 文件清理失败只写 warn，不阻断数据库删除。

3. 新增卡住文档重置脚本：
   - `pnpm --filter server reset:document <documentId>`
   - `pnpm --filter server reset:documents <knowledgeBaseId>`
   - 只重置 `parsing`、`chunking`、`embedding` 状态为 `pending`，并清空 `errorMessage`。

4. 前端体验小修：
   - 聊天空状态文案改为“输入问题开始对话”。
   - 文档表空状态文案改为“暂无文档，点击上方上传”。

5. 文档收口：
   - `README.md` 已改为当前全链路启动、处理、问答和排障说明。
   - `.env.example` 删除了早期“后续任务扩充”的过期注释。
   - `docs/00-overall-plan.md` 更新到 v2.3，回填 T14 修订记录。

## 修改文件

T14 新增：
- `server/src/scripts/reset-stuck-documents.ts`
- `docs/reports/task-14-completion.md`

T14 修改：
- `.env.example`
- `README.md`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`
- `server/package.json`
- `server/src/common/filters/http-exception.filter.ts`
- `server/src/database/database.service.ts`
- `server/src/main.ts`
- `server/src/modules/document/storage/document-storage.service.ts`
- `server/src/modules/health/health.service.ts`
- `server/src/modules/knowledge-base/knowledge-base.module.ts`
- `server/src/modules/knowledge-base/knowledge-base.service.ts`
- `web/src/components/DocumentTable.vue`
- `web/src/components/MessageList.vue`

## 完整链路测试结果

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter server build` | 通过 |
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `pnpm --filter server migration:show` | 默认 `.env` 指向本机 3306 时失败：`Access denied for user 'root'@'localhost'` |
| `DB_HOST=127.0.0.1 DB_PORT=3307 ... pnpm --filter server migration:show` | 通过，`InitSchema1784800736682` 和 `AddKnowledgeBaseNameUnique1784871996843` 均已执行 |
| `rg "console\.(log\|debug)" web/src` | 无命中 |
| `rg "console\.(log\|error\|warn)" server/src --type ts -g '!**/scripts/**'` | 无命中 |
| `rg "debugger" web/src server/src` | 无命中 |
| `rg "Mock\|mock\|fake\|dummy\|EventSource\|WebSocket\|localStorage\|sessionStorage" web/src` | 无命中 |
| `rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router` | 无命中 |

运行环境：
- Docker：`rag-mysql-1`、`rag-qdrant-1` healthy。
- 后端：使用 `DB_HOST=127.0.0.1 DB_PORT=3307`、真实 Qdrant、`EMBEDDING_MOCK=true`、`LLM_MOCK=true` 启动，健康检查 `db=up`。

主链路回归实际结果：

| 场景 | 实际结果 |
|---|---|
| 创建知识库、查询列表、查询详情 | 通过 |
| 上传 PDF、Markdown、TXT | 通过，上传后均为 `pending` |
| PDF 解析、切片、向量写入 | 通过：PDF 文档 `140`，2 页，2 个 chunk，2 个 Qdrant point |
| Markdown 解析、切片、向量写入 | 通过：Markdown 文档 `141`，1 个 chunk，1 个 Qdrant point |
| TXT 解析、切片、向量写入 | 通过：TXT 文档 `142`，1 个 chunk，1 个 Qdrant point |
| PDF 页码、`chunkIndex`、`charCount`、`qdrantPointId` | 通过：PDF chunk 页码为 1 和 2，`chunkIndex` 连续，`qdrantPointId` 为 UUID |
| 向量检索命中 | 通过：命中 PDF chunk，`pageNo=1`，score `0.99999994` |
| 阈值过滤无命中 | 通过：`scoreThreshold=1` 返回 0 条 |
| SSE 新会话问答 | 通过：收到 `metadata -> token* -> references -> done` |
| 引用展示数据 | 通过：引用来自真实检索结果，包含 PDF 文档名、页码 1、score |
| 已有会话续聊 | 通过：同一 conversation 消息数从 2 增至 4 |
| SSE 主动中止 | 通过：客户端收到 `metadata` 和首个 `token` 后 abort |
| 空 query / 空 question | 通过：返回 400 |
| 不存在知识库检索 / 聊天 | 通过：返回 404 |
| 重复上传 | 通过：返回 409 |
| 不支持文件类型 | 通过：返回 415 |
| 超大文件 | 通过：返回 413 |
| 空白 TXT 解析失败 | 通过：文档状态为 `failed`，`errorMessage=文件内容为空` |

补充收口验证实际结果：

| 场景 | 实际结果 |
|---|---|
| Embedding 服务调用失败 | 通过：文档 `147` 状态为 `failed`，错误为 `Embedding API 网络错误：fetch failed` |
| `reset:document` | 通过：文档 `148` 从 `embedding` 重置为 `pending`，`errorMessage` 清空 |
| 删除文档 | 通过：文档 `145` 删除后 Qdrant point `1 -> 0`，DB 行为 0，磁盘文件和解析缓存均不存在 |
| 删除知识库 | 通过：知识库 `76` 删除后 Qdrant point `1 -> 0`，知识库/文档/会话 DB 行为 0，上传目录不存在 |
| T14 临时数据清理 | 通过：KB `72/73/74/75/76/77` 均无 DB、Qdrant、上传目录残留 |

前端页面验证：

| 场景 | 实际结果 |
|---|---|
| 前端 UI 创建知识库 | 通过：列表显示 `T14 UI 1785487480720` |
| 知识库详情空文档提示 | 通过：显示“暂无文档，点击上方上传” |
| 聊天页空消息提示 | 通过：显示“输入问题开始对话” |
| 聊天路由刷新 | 通过：刷新 `/knowledge-bases/77/chat` 后空消息状态恢复 |
| 前端 UI 删除知识库 | 通过：列表消失，后端查询返回 404 |

## 未执行项

- 未通过浏览器文件选择器上传真实文件；文件上传验证使用真实 HTTP multipart 接口完成，前端页面级验证覆盖了列表、详情、聊天和删除交互。
- 未执行移动端截图验收；仅基于现有响应式代码和桌面浏览器页面做了基础验证。
- 未调用真实外部 Embedding/LLM 服务；正常主链路使用 Mock Embedding/Mock LLM，失败场景使用不可达 Embedding URL 验证错误处理。
- 未构造“应用已启动后 Qdrant upsert 中途失败”的专用假 Qdrant；本次验证了 Qdrant URL 不可达导致 CLI 启动失败的实际表现。

## 已知问题

1. 当前本机 `.env` 默认 MySQL 指向 `localhost:3306` 时会命中本机 MySQL 并鉴权失败；本轮联调实际使用 `127.0.0.1:3307` 转发到 Docker MySQL。
2. `pnpm --filter ...` 在当前工作区会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令随后实际执行。
3. Qdrant 在 CLI 应用初始化阶段不可达时，命令会清晰失败，但业务逻辑尚未进入 `storeDocument()`，因此测试文档保持 `chunking` 且 `errorMessage=null`。Qdrant upsert 阶段失败的补偿清理和 `failed` 落库仍由 T08 的 `storeDocument()` catch 分支负责。
4. 当前数据库仍有一个既有知识库 `71/1231321`，含 2 个 `pending` 文档和 1 条会话，Qdrant 向量数为 0。该数据不是本轮 T14 临时命名数据，未删除。

## 越界确认

本次未新增或修改：
- 登录、权限、多租户
- Agent、GraphRAG、Rerank
- WebSocket
- 新核心业务能力
- 新数据库表或 Migration
- 新状态管理框架

## 下一阶段条件

T14 已具备进入测试、部署和项目收口阶段的条件。建议下一阶段优先处理自动化测试、`.env`/Compose 端口一致性、生产部署说明，以及 Qdrant 初始化失败时的运维恢复策略。
