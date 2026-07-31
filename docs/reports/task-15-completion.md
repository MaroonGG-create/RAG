# T15 测试与代码质量收口完成报告

> 日期：2026-07-31  
> 范围：后端/前端测试基础设施、核心单元测试、轻量 HTTP 合约 E2E、lint/type/build 与代码质量扫描  
> 结论：T15 范围内完成；具备进入 T16 部署与 README 收口阶段的条件。

## 新增和修改文件

新增配置：
- `server/jest.config.ts`
- `server/test/jest-e2e.json`
- `server/.eslintrc.cjs`
- `web/vitest.config.ts`
- `web/.eslintrc.cjs`

新增后端测试：
- `server/src/modules/processing/chunking/__tests__/text-cleaner.spec.ts`
- `server/src/modules/processing/chunking/__tests__/text-splitter.spec.ts`
- `server/src/modules/processing/chunking/__tests__/chunking.service.spec.ts`
- `server/src/modules/processing/parsing/__tests__/plain-text.parser.spec.ts`
- `server/src/modules/embedding/__tests__/embedding-client.spec.ts`
- `server/src/modules/embedding/__tests__/embedding.service.spec.ts`
- `server/src/modules/vector-store/__tests__/vector-store.service.spec.ts`
- `server/src/modules/retrieval/__tests__/retrieval.service.spec.ts`
- `server/src/modules/rag/__tests__/prompt-builder.spec.ts`
- `server/src/modules/rag/__tests__/rag.service.spec.ts`
- `server/src/modules/chat/__tests__/chat.service.spec.ts`
- `server/src/modules/conversation/__tests__/conversation.service.spec.ts`
- `server/src/modules/conversation/__tests__/message.service.spec.ts`
- `server/src/modules/document/__tests__/document.service.spec.ts`
- `server/src/modules/knowledge-base/__tests__/knowledge-base.service.spec.ts`
- `server/test/api-contract.e2e-spec.ts`

新增前端测试：
- `web/src/api/__tests__/sse.spec.ts`
- `web/src/api/__tests__/http.spec.ts`
- `web/src/composables/__tests__/use-chat.spec.ts`
- `web/src/composables/__tests__/use-conversations.spec.ts`

修改：
- `server/package.json`、`web/package.json`、`pnpm-lock.yaml`：新增测试/lint devDependencies 与脚本。
- `server/tsconfig.json`：新增 `noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`。
- `.gitignore`：忽略 coverage 产物。
- `server/src/modules/processing/chunking/text-splitter.ts`：修复无分隔符长文本叠加 overlap 后 chunk 可能超过 `chunkSize` 的边界问题。
- `server/src/modules/knowledge-base/knowledge-base.service.ts`：知识库删除时文件、解析缓存和目录清理失败只记录 warn，不阻断数据库删除。
- `server/src/modules/conversation/message.service.ts`：移除未使用的 `referenceRepository` 注入。
- `web/src/api/sse.ts`：将 `while (true)` 改为显式读取状态，满足 lint。
- `web/src/views/KnowledgeBaseListView.vue`：移除未使用的事件参数和类型 import。

## 测试依赖

后端新增 devDependencies：`jest 29.7.0`、`ts-jest 29.4.12`、`@types/jest 29.5.14`、`@nestjs/testing 10.4.22`、`supertest 7.2.2`、`@types/supertest 6.0.3`、`eslint 8.57.1`、`@typescript-eslint/* 8.65.0`。

前端新增 devDependencies：`vitest 2.1.9`、`@vue/test-utils 2.4.11`、`jsdom 25.0.1`、`@vitest/coverage-v8 2.1.9`、`eslint 8.57.1`、`eslint-plugin-vue 9.33.0`、`@typescript-eslint/* 8.65.0`。

## 覆盖模块

后端覆盖：
- 文本清洗、递归切片、overlap、空白内容、PDF 多页 pageNo、chunkIndex、charCount、qdrantPointId。
- UTF-8/UTF-16 BOM 纯文本解析与非法编码。
- Embedding mock/HTTP 客户端、响应数量、顺序、维度、非有限值、重试和失败落库。
- VectorStore 的 `knowledgeBaseId`/`documentId` filter、payload、upsert 数量校验和失败补偿。
- Retrieval 的空 query、知识库不存在、completed 文档过滤、payload 校验、topK/threshold。
- RAG Prompt、上下文截断、无命中不调 LLM、references 快照。
- SSE Chat 事件顺序、无命中、并发、断开、LLM 异常安全错误。
- Conversation/Message/MessageReference 一致性、历史引用排序。
- 文档上传 PDF 头、重复文件、死锁重试、删除清理。
- 知识库重名、删除清理和文件清理失败不阻断。
- HTTP 合约 E2E：统一响应包装、ValidationPipe、204 删除、检索 DTO、Embedding 异常 502、ask 无命中。

前端覆盖：
- SSE 半包、粘包、多行 data、error/done/references、HTTP 错误、abort、空 body、非法 JSON。
- Axios 统一响应解包、错误包装、网络错误和非统一响应透传。
- `useChat` 初始状态、发送、metadata/token/references/done/error、停止生成、防重复提交、历史加载。
- `useConversations` 列表加载、无效知识库、错误提示和删除后刷新。

## 实际执行结果

| 命令 | 结果 |
|---|---|
| `pnpm --filter server run test -- --runInBand` | 通过：15 个 test suites，103 tests |
| `pnpm --filter server run test:e2e -- --runInBand` | 通过：1 个 test suite，6 tests |
| `pnpm --filter web run test` | 通过：4 个 test files，33 tests |
| `pnpm --filter server run test:cov -- --runInBand` | 通过：15 个 suites，103 tests；All files statements 53.07%；P0 文件 `text-cleaner` 100%、`text-splitter` 95.38%、`plain-text.parser` 100%、`prompt-builder` 95.83% |
| `pnpm --filter web run test:cov` | 通过：4 个 files，33 tests；All files statements 64.79%；`sse.ts` 97.02%、`http.ts` 94.44%、`use-chat.ts` 84.35%、`use-conversations.ts` 91.07% |
| `pnpm --filter server run lint:check` | 通过 |
| `pnpm --filter web run lint:check` | 通过 |
| `pnpm --filter server run build` | 通过 |
| `pnpm --filter web run type-check` | 通过 |
| `pnpm --filter web run build` | 通过 |

说明：当前工作区执行 `pnpm --filter ...` 会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令随后实际执行并以上述结果结束。

## 质量扫描

| 检查 | 实际结果 |
|---|---|
| `rg "\bany\b" server/src server/test web/src --type ts` | 无命中 |
| `rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router` | 无命中 |
| `rg ":\s*any\b" server/src --type ts -g '!**/*.spec.ts' -g '!**/*.e2e-spec.ts'` | 无命中 |
| `rg "console\.(log\|debug)" web/src` | 无命中 |
| `rg "console\.(log\|error\|warn)" server/src --type ts -g '!**/scripts/**' -g '!**/*.spec.ts' -g '!**/*.e2e-spec.ts'` | 无命中 |
| `rg "debugger\b" web/src server/src` | 无命中 |
| `rg "\.then\(" web/src server/src --type ts` | 1 处：`document-upload.config.ts`，已审查，后续有 `.catch()` |
| `rg "Mock\|mock\|fake\|dummy\|EventSource\|WebSocket" web/src -g '!**/*.spec.ts'` | 无命中 |
| `rg "localStorage\|sessionStorage" web/src server/src` | 无命中 |
| `rg "sk-[a-zA-Z0-9-]{10,}" server/src web/src README.md .env.example` | 仅 README 和 `.env.example` 的 `sk-your-api-key` 占位符 |
| `rg "^\.env$" .gitignore` | 命中 |

环境变量检查：
- `env.validation.ts` 对端口、数据库、Qdrant、检索、上传、切片、Embedding、LLM、RAG、Chat 配置做必填、数值范围、布尔或 URL 校验。
- `configuration.ts` 保留 `CHUNK_OVERLAP < CHUNK_SIZE` 自定义校验。
- Embedding/LLM 客户端错误不会返回原始响应体；源代码未发现 API Key 或 Bearer token 日志输出。

## 未完成项和已知问题

1. 没有引入真实 MySQL 测试库跑完整 AppModule E2E；本轮 E2E 是 HTTP 合约层测试，Service 依赖全部 mock，避免污染开发库。
2. 没有调用真实外部 Embedding、LLM 或真实 Qdrant；这些外部依赖在单测中用可控 mock 覆盖。
3. 覆盖率未对 controller、storage、LLM HTTP streaming、PDF parser 等低 ROI 或外部依赖重的文件做全面覆盖；报告中的覆盖率为实际 `test:cov` 输出。
4. 后端测试包含预期失败分支，运行时会输出 Nest Logger 的 error/warn 日志；测试结果本身通过。

## 越界确认

本次未实现或改造：
- 新业务功能
- 登录、权限、多租户
- Agent、GraphRAG、Rerank
- WebSocket
- 新数据库表或 Migration
- API 路径或 SSE 协议
- 前端状态管理框架

## 下一阶段条件

T15 已具备进入 T16 部署与 README 收口阶段的条件。T16 建议聚焦部署配置、Docker/环境变量一致性、生产 README、演示脚本和测试命令说明。
