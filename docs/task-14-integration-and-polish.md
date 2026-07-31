# T14 整体联调与交互收口 — Codex 执行指令

> 任务编号：T14（阶段 P10：整体联调与项目收口）
> 前置条件：T13 已完成（结论：**通过**，见 `docs/reports/task-13-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v2.2 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T13 后快照）+ `docs/reports/task-13-completion.md`
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、任务定位

T14 是 MVP 交付前的最后一个工程任务。**不新增核心业务功能**，只做前后端整体联调、异常处理补全、交互体验收口和工程清理。完成后系统应能完整跑通"创建知识库 → 上传文档 → 文档处理 → SSE 流式问答 → 引用展示 → 会话恢复 → 删除清理"全链路，各类失败场景有明确提示，代码无调试残留。

---

## 二、当前可复用实现盘点（依据 T13 快照与探索结果，禁止凭记忆假设）

### 2.1 后端模块（11 个，均保持可用）

| 模块 | 目录 | T14 关系 |
|---|---|---|
| HealthModule | `src/modules/health/` | 不修改 |
| KnowledgeBaseModule | `src/modules/knowledge-base/` | **修改**：删除时清理磁盘文件 |
| DocumentModule | `src/modules/document/` | 不修改（已正确清理向量+文件+缓存） |
| ProcessingModule | `src/modules/processing/` | 不修改 |
| EmbeddingModule | `src/modules/embedding/` | 不修改 |
| VectorStoreModule | `src/modules/vector-store/` | 不修改 |
| RetrievalModule | `src/modules/retrieval/` | 不修改 |
| LlmModule | `src/modules/llm/` | 不修改 |
| RagModule | `src/modules/rag/` | 不修改 |
| ConversationModule | `src/modules/conversation/` | 不修改 |
| ChatModule | `src/modules/chat/` | 不修改 |

### 2.2 前端结构（T13 后完整结构）

```text
web/src/
├── api/         http.ts / knowledge-base.ts / document.ts / conversation.ts / chat.ts / sse.ts
├── types/       health.ts / knowledge-base.ts / document.ts / conversation.ts / chat.ts
├── composables/ use-knowledge-bases.ts / use-documents.ts / use-conversations.ts / use-chat.ts
├── views/       HomePage.vue / KnowledgeBaseListView.vue / KnowledgeBaseDetailView.vue / ChatView.vue
├── components/  KnowledgeBaseCard / CreateKnowledgeBaseModal / DocumentUploader / DocumentTable / DocumentStatusTag
│                ConversationList / MessageList / MessageBubble / ReferencePanel / ChatInput
├── utils/       format.ts / document-file.ts
├── router/      index.ts
├── App.vue / main.ts
```

依赖现状：`vue@^3.5.13`、`ant-design-vue@^4.2.6`、`axios@^1.8.4`、`vue-router@^4.5`。无 Pinia、无 dayjs、无 `@ant-design/icons-vue`。**T14 不新增依赖。**

### 2.3 已确认的工程问题（T14 需修复）

| # | 问题 | 位置 | 严重性 |
|---|---|---|---|
| 1 | 知识库删除不清理磁盘文件 | `knowledge-base.service.ts` `remove()` | 中——磁盘泄漏 |
| 2 | 6 处生产代码 `console.error` | `http-exception.filter.ts`(3)、`main.ts`(1)、`health.service.ts`(1)、`database.service.ts`(1) | 低——应迁移到 NestJS Logger |
| 3 | README 严重过时 | `README.md` | 高——仍停留在 T04/T05 阶段描述 |
| 4 | 无卡住文档恢复机制 | processing 模块 | 中——中间状态文档需手动 CLI 恢复 |
| 5 | 文档处理为手动 CLI 触发 | 4 个 CLI 脚本 | 信息项——MVP 接受，但 README 需文档化 |
| 6 | T13 验证数据未清理 | KB 69、文档 123、测试会话 | 低——需清理 |

### 2.4 代码约定（禁止违反）

- 前端：kebab-case 文件名、显式返回类型、`catch` 用 `unknown`、禁显式 `any`、Ant Design Vue 按需导入
- 后端：NestJS 模块化、`@SkipResponseWrap()` 仅用于 SSE、统一响应 `{code:0,message:'success',data}` / 错误 `{code,message,details?}`
- 前后端均不使用 `localStorage` / `sessionStorage` 缓存业务数据

---

## 三、目标与非目标

### 3.1 目标（只做这些）

1. 完整业务链路回归验证（§四）
2. 前后端接口契约核对（§五）
3. 统一 Loading、空状态和错误提示（§六）
4. 上传/解析/Embedding/Qdrant 失败展示完善（§七）
5. 文档处理状态刷新和异常恢复（§八）
6. SSE 断线、中止和错误处理验证（§九）
7. 会话刷新恢复验证（§十）
8. 删除知识库/文档/会话后的状态同步（§十一）
9. 重复提交和重复点击控制（§十二）
10. 页面路由和刷新行为验证（§十三）
11. 响应式布局和基础样式优化（§十四）
12. 清理无用代码、调试日志和临时文件（§十五）
13. 环境变量与 README 配置核对（§十六）

### 3.2 非目标（明确不做）

| 项 | 原因 |
|---|---|
| 登录权限 | MVP 不做 |
| 多租户 | MVP 不做 |
| Agent / GraphRAG / Rerank | MVP 不做 |
| WebSocket | SSE 已满足需求 |
| 新核心功能 | T14 只做联调和收口 |
| 大规模架构重构 | 禁止 |
| 自动化文档处理流水线（上传后自动解析→切片→向量化→入库） | MVP 保持手动 CLI 触发，仅文档化 |
| 新增 npm 依赖 | 零新增依赖 |
| 修改数据库表结构或 migration | 禁止 |
| 修改后端 API 路径或 SSE 事件协议 | 冻结级约定 |
| Markdown 渲染 | 助手回答按纯文本展示 |
| Pinia / 状态管理框架 | composables 已满足 |

---

## 四、完整业务链路回归验证

### 4.1 验收流程（10 步）

按以下顺序执行完整流程验证，每步必须通过：

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 1 | 创建知识库 | 知识库出现在列表中 | UI 操作 + `GET /api/knowledge-bases` |
| 2 | 上传 PDF、MD、TXT 各一个 | 三个文档状态为 `pending`，出现在文档列表 | UI 操作 + `GET /api/knowledge-bases/:id/documents` |
| 3 | 依次执行 parse → chunk → store CLI | 文档状态最终为 `completed`，`chunk_count > 0` | `pnpm --filter server parse:document <id>` 等 |
| 4 | 进入聊天页，发起问答 | SSE 流式返回回答 | UI 操作 + 观察 token 逐字输出 |
| 5 | 观察 SSE 事件序列 | `metadata → token×N → references → done` | 浏览器 DevTools Network 面板 |
| 6 | 展开引用面板 | 显示文档名、页码（PDF 有值，MD/TXT 显示"无页码"）、相似度、内容快照 | UI 操作 |
| 7 | 刷新页面 | 会话和消息历史完整恢复，引用可展开 | 浏览器刷新 + 验证 URL `?conversationId=N` |
| 8 | 删除一个文档 | 文档从列表消失，Qdrant 向量已清理 | `DELETE /api/documents/:id` + Qdrant 查询 |
| 9 | 删除知识库 | 知识库及关联数据全部清除，磁盘文件清理 | `DELETE /api/knowledge-bases/:id` + 文件系统检查 |
| 10 | 各类失败场景 | 有明确错误提示，不出现白屏或未捕获异常 | §七 详述 |

### 4.2 验收环境要求

- Docker `mysql` 和 `qdrant` 容器运行中
- 后端使用真实 Qdrant（`QDRANT_MOCK=false`）
- Embedding/LLM 可使用 Mock 模式（`EMBEDDING_MOCK=true`、`LLM_MOCK=true`）或真实 API
- 前端 Vite dev server 运行在 `localhost:5173`
- 后端运行在 `localhost:3000`

### 4.3 验证数据清理

T13 遗留的测试数据（知识库 69、文档 123、测试会话等）需在 T14 验证前清理：

```bash
# 通过 API 删除 T13 测试数据
curl -X DELETE http://localhost:3000/api/knowledge-bases/69
```

如果 404 则说明已删除。T14 验证使用全新创建的测试数据。

---

## 五、前后端接口契约核对

### 5.1 API 清单核对（15 个接口）

逐个核对前端调用路径、请求体、响应结构与后端实现是否一致：

| # | 方法 | 路径 | 前端调用位置 | 核对要点 |
|---|---|---|---|---|
| 1 | GET | `/api/health` | `HomePage.vue` | 返回 `{status, db}` |
| 2 | POST | `/api/knowledge-bases` | `api/knowledge-base.ts` | body `{name, description?}`，返回 `KnowledgeBase` |
| 3 | GET | `/api/knowledge-bases` | `api/knowledge-base.ts` | 返回 `KnowledgeBase[]` |
| 4 | GET | `/api/knowledge-bases/:id` | `api/knowledge-base.ts` | 返回 `KnowledgeBase`（含 `documentCount`） |
| 5 | DELETE | `/api/knowledge-bases/:id` | `api/knowledge-base.ts` | 返回 204 |
| 6 | POST | `/api/knowledge-bases/:id/documents` | `api/document.ts` | multipart `file`，重复返 409 |
| 7 | GET | `/api/knowledge-bases/:id/documents` | `api/document.ts` | 返回 `KnowledgeDocument[]` |
| 8 | GET | `/api/documents/:id` | 暂无前端调用 | 含切片预览前 20 条 |
| 9 | DELETE | `/api/documents/:id` | `api/document.ts` | 返回 204 |
| 10 | POST | `/api/knowledge-bases/:id/chat` | `api/chat.ts` | SSE `text/event-stream` |
| 11 | GET | `/api/knowledge-bases/:id/conversations` | `api/conversation.ts` | 返回 `Conversation[]` |
| 12 | GET | `/api/conversations/:id/messages` | `api/conversation.ts` | 返回 `ChatMessageData[]` |
| 13 | DELETE | `/api/conversations/:id` | `api/conversation.ts` | 返回 204 |
| 14 | POST | `/api/knowledge-bases/:id/retrieve` | 暂无前端调用 | 检索测试接口 |
| 15 | POST | `/api/knowledge-bases/:id/ask` | 暂无前端调用 | 非流式问答 |

### 5.2 核对项

- [ ] 请求路径精确匹配（含 `/api` 前缀）
- [ ] 请求体字段名和类型与后端 DTO 一致
- [ ] 响应解包：Axios 拦截器已自动解包 `{code:0, data}` → `data`
- [ ] SSE 接口不走 Axios，使用原生 `fetch`
- [ ] 错误响应：`{code, message, details?}` 被包装为 `ApiError`
- [ ] 204 响应：`DELETE` 接口返回空 body，Axios 需处理
- [ ] HTTP 状态码段位：400/404/409/413/415/500/502 各场景正确

### 5.3 类型对齐核对

| 前端类型 | 后端 DTO | 关键字段 |
|---|---|---|
| `KnowledgeBase` | `KnowledgeBase` 实体 | `id/name/description/documentCount/createdAt/updatedAt` |
| `KnowledgeDocument` | `Document` 实体 | `id/fileName/fileExt/fileSize/status/errorMessage/chunkCount/createdAt/updatedAt` |
| `Conversation` | `ConversationResponseDto` | `id/title/createdAt/updatedAt` |
| `ChatMessageData` | `MessageResponseDto` | `id/role/content/status/errorMessage/createdAt/references[]` |
| `MessageReference` | `MessageReferenceResponseDto` | `documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot` |
| `SseReferenceItem` | `ReferenceSnapshot` | `chunkId/documentId/documentName/pageNo/content/score` |

> **已知差异**：SSE `references` 用 `content` 字段，消息历史 API 用 `contentSnapshot` 字段。前端 `ReferencePanel` 已用 `'contentSnapshot' in ref` 类型守卫统一处理，T14 验证此逻辑在两种场景下均正确。

---

## 六、统一 Loading、空状态和错误提示

### 6.1 当前状态审计

| 页面/组件 | Loading | 空状态 | 错误提示 | 需改进 |
|---|---|---|---|---|
| `KnowledgeBaseListView` | `Spin :spinning` | `Empty` "暂无知识库" | `Alert type="error"` | ✅ 已完善 |
| `KnowledgeBaseDetailView` | `Skeleton` + `Spin` | `Empty`（文档表格内） | `Result status="error"` + `Alert` | ✅ 已完善 |
| `ChatView` | `Skeleton`（KB 加载） | 空消息区提示 | `Alert` + `message.error` | ✅ 已完善 |
| `ConversationList` | `Spin` | "暂无会话" | `Alert` | 需验证 |
| `MessageList` | `Spin`（消息加载） | "输入问题开始对话" | — | 需验证 |
| `DocumentUploader` | `Progress`（上传进度） | — | `message.error` | ✅ 已完善 |
| `DocumentTable` | `Spin` | `Empty` | — | 需验证 |

### 6.2 统一规范

T14 需确保所有页面遵循以下规范（如已符合则不修改）：

**Loading 规范**：
- 首次加载用 `Skeleton` 或 `Spin` 全屏遮罩
- 后台刷新用 `Spin` 内联或 Tag 提示（如"刷新中"）
- 按钮提交中用 `Button :loading`

**空状态规范**：
- 列表为空时用 Ant Design Vue `Empty` 组件
- 空状态文案统一：知识库"暂无知识库"、文档"暂无文档，点击上方上传"、会话"暂无会话"、消息"输入问题开始对话"

**错误提示规范**：
- 页面级错误用 `Alert type="error" show-icon`
- 操作级错误用 `message.error()`
- 资源不存在用 `Result status="error"` + 返回按钮
- 错误消息来自后端 `ApiError.message`，前端不编造错误原因

### 6.3 需要检查和补全的点

1. **ConversationList 空状态**：会话列表为空时是否显示"暂无会话"文案
2. **MessageList 空状态**：无消息时是否显示引导文案
3. **网络错误统一提示**：所有 `catch` 块是否用 `error instanceof Error ? error.message : '操作失败'` 模式
4. **删除操作反馈**：删除成功后是否 `message.success`，失败是否 `message.error`

---

## 七、各类失败场景展示

### 7.1 失败场景矩阵

| 场景 | 触发方式 | 前端预期展示 | 后端行为 |
|---|---|---|---|
| 上传重复文件 | 上传同库下相同文件 | `message.error('文件已存在：xxx（状态：yyy）')` | 409 + details |
| 上传超大文件 | 上传 >20MB 文件 | `message.error('文件大小不能超过 20MB')` | 前端拦截，不发请求 |
| 上传不支持类型 | 上传 .docx | `message.error('仅支持 PDF、Markdown、TXT 文件')` | 前端拦截 |
| 文档解析失败 | CLI parse 指定损坏 PDF | 文档状态显示 `failed` + error_message Tooltip | status=failed + errorMessage |
| Embedding 失败 | 关闭 Embedding API 或 Mock 异常 | 文档状态 `failed` + error_message | status=failed + errorMessage |
| Qdrant 写入失败 | 关闭 Qdrant 容器后 store | 文档状态 `failed` + error_message | status=failed + errorMessage |
| 问答-无命中 | 问无关问题 | 助手回答固定话术，无引用面板 | references=[] + 固定回答 |
| 问答-LLM 失败 | 关闭 LLM API | 助手消息 `failed` + 安全错误提示 | SSE error 事件 |
| 问答-同会话并发 | 同会话快速连续发送 | `message.error('当前会话正在生成回答')` | 409 JSON 响应 |
| 问答-知识库不存在 | URL 手动改不存在的 KB ID | `Result status="error"` + 返回按钮 | 404 JSON 响应 |
| 会话不存在 | 刷新时 conversationId 无效 | 清空消息 + 提示"会话不存在" | 404 JSON 响应 |
| 后端未启动 | 关闭后端服务 | `message.error('网络连接失败')` 或 `Alert` | fetch 抛 TypeError |
| 用户主动中止 | 生成中点击"停止" | 保留已生成内容，状态改为已停止 | abort LLM + 保存 failed 消息 |

### 7.2 文档处理失败展示

文档状态 Tag 展示规则（`DocumentStatusTag` 组件，已实现）：

| 状态 | Tag 颜色 | 文案 | Tooltip |
|---|---|---|---|
| `pending` | `default` | 待处理 | — |
| `parsing` | `processing` | 解析中 | — |
| `chunking` | `processing` | 切片中 | — |
| `embedding` | `processing` | 向量化中 | — |
| `completed` | `success` | 已完成 | — |
| `failed` | `error` | 失败 | `errorMessage` 内容 |

T14 需验证：
- `failed` 状态的文档，鼠标悬停 Tag 时 Tooltip 正确显示 `errorMessage`
- `errorMessage` 为空时不显示 Tooltip
- 处理中状态的文档有 3 秒轮询自动刷新

### 7.3 T14 需修复的问题

**知识库删除磁盘文件泄漏**：

当前 `KnowledgeBaseService.remove()` 只清理 Qdrant 向量和数据库记录，不清理磁盘文件。T14 修改为：删除知识库前，查出该库下所有文档的 `storagePath`，删除对应磁盘文件和 `.parsed/` 缓存。

修改文件：`server/src/modules/knowledge-base/knowledge-base.service.ts`

修改方案：
```typescript
async remove(id: number): Promise<void> {
  await this.findKnowledgeBaseOrThrow(id);

  // 清理 Qdrant 向量
  try {
    await this.vectorStoreService.deleteByKnowledgeBaseId(id);
  } catch (error) {
    this.logger.warn(`清理知识库 ${id} 向量失败：`, error);
  }

  // 查出所有文档，清理磁盘文件和解析缓存
  const documents = await this.documentRepository.find({
    where: { kbId: id },
    select: ['id', 'storagePath'],
  });
  for (const doc of documents) {
    this.storageService.deleteByStoragePath(doc.storagePath);
    this.parsedResultStore.remove(doc.id);
  }

  // 删除知识库目录
  this.storageService.deleteKnowledgeBaseDirectory(id);

  await this.knowledgeBaseRepository.delete(id);
}
```

> 需要确认 `StorageService` 是否有 `deleteKnowledgeBaseDirectory` 方法。如果没有，需新增：删除 `uploads/{kbId}/` 目录。`ParsedResultStore` 已有 `remove(id)` 方法。

---

## 八、文档处理状态刷新和异常恢复

### 8.1 当前状态

- 文档处理为手动 CLI 触发：`parse:document` → `chunk:document` → `store:document`
- 前端 `useDocuments` 每 3 秒轮询 `GET /api/knowledge-bases/:id/documents`
- 轮询条件：存在 `parsing/chunking/embedding` 状态文档时启动，全部终态时停止
- `onUnmounted` 清理轮询定时器

### 8.2 卡住文档恢复

**问题**：如果 CLI 脚本在中间状态（如 `parsing`）崩溃，文档将永久停留该状态。

**T14 方案**：新增 CLI 脚本 `reset-stuck-documents.ts`，将指定知识库下所有非终态文档重置为 `pending`（保留 `errorMessage` 为空），允许重新触发处理。

```bash
# 重置指定知识库下所有卡住的文档
pnpm --filter server reset:documents <kbId>

# 重置指定文档
pnpm --filter server reset:document <documentId>
```

脚本逻辑：
1. 查询 `status IN ('parsing', 'chunking', 'embedding')` 的文档
2. 将状态重置为 `pending`，清空 `errorMessage`
3. 输出重置的文档列表

> **注意**：此脚本只重置状态，不清理已写入的部分数据（chunk 或向量）。各处理服务已有幂等设计：
> - `ChunkingService`：先删旧 chunk 再写入
> - `VectorStoreService`：先删旧向量再写入
> - `ParsingService`：暂存文件 fileHash 匹配则跳过

### 8.3 前端轮询验证

T14 验证以下场景：
1. 上传文档后，文档列表自动出现 `pending` 状态文档
2. 执行 `parse:document` 后，3 秒内状态更新为 `parsing` → `pending`
3. 执行 `chunk:document` 后，状态更新为 `chunking`
4. 执行 `store:document` 后，状态更新为 `completed`
5. 所有文档进入终态后，轮询自动停止
6. 离开详情页后，轮询定时器被清理

---

## 九、SSE 断线、中止和错误处理验证

### 9.1 T13 已实现的 SSE 客户端

`web/src/api/sse.ts` 使用 `fetch` + `ReadableStream` + `TextDecoder`：
- 半包/粘包：`buffer.split('\r?\n\r?\n')` + `frames.pop()` 保留尾部
- 多行 `data:`：`parseSseFrame()` 收集所有 `data:` 行用 `\n` 拼接
- HTTP 错误：`!response.ok` 时解析 `{code,message,details}` 包装为 `ApiError`
- 中止：`AbortSignal.aborted` 时静默退出
- 网络错误：`fetch` 抛异常时回调 `onNetworkError`

### 9.2 T14 验证场景

| 场景 | 操作 | 预期 |
|---|---|---|
| 正常 SSE 流 | 发送问题，LLM 正常 | `metadata → token×N → references → done` |
| LLM 服务挂掉 | 停止 LLM 端点后发问 | 助手消息 `failed` + 安全错误提示 |
| 用户主动中止 | 生成中点"停止" | 保留已生成内容，状态"已停止生成" |
| 后端服务挂掉 | 停止后端后发问 | 网络错误提示 |
| 同会话并发 | 快速连续发送两次 | 第二次被 409 拦截 |
| 页面刷新恢复 | 生成中刷新页面 | 历史消息恢复，流式消息显示为 `failed`（后端保存） |
| 组件卸载中止 | 生成中导航离开页面 | `onUnmounted` 触发 abort，不报错 |

### 9.3 T14 需验证的边界

1. **SSE 流意外中断**（非用户中止）：`reader.read()` 抛异常 → `onNetworkError` → 助手消息 `failed`
2. **SSE 流正常结束但未收到 done**：`reader.read()` 返回 `done:true` → 循环结束 → 检查缓冲区残留
3. **HTTP 409 同会话并发**：在 SSE headers 设置前返回 JSON → `onNetworkError` 收到 `ApiError(status:409)`
4. **后端返回非 SSE 响应**（如 500 HTML 页面）：`response.ok === false` → 解析 JSON 失败 → 用默认消息

---

## 十、会话刷新恢复验证

### 10.1 验证场景

| 场景 | 操作 | 预期 |
|---|---|---|
| 新会话首次问答 | 无 conversationId 时发送问题 | metadata 事件设置 conversationId，URL 同步为 `?conversationId=N` |
| 页面刷新恢复 | 刷新 `?conversationId=N` 页面 | 加载历史消息和引用，会话列表中当前会话高亮 |
| 切换会话 | 点击会话列表项 | URL 更新，消息区替换为新会话历史 |
| 新建会话 | 点击"新建会话" | URL 清除 query，消息区清空，显示空状态 |
| 删除当前会话 | 删除正在查看的会话 | 回到空状态，URL 清除 query |
| 删除其他会话 | 删除非当前会话 | 会话列表刷新，当前会话不变 |
| conversationId 无效 | URL 手动改不存在的 ID | 清空消息，提示"会话不存在或已被删除" |
| 继续已有会话 | 在已有会话中发问 | 消息追加到现有历史，会话 updatedAt 更新 |

### 10.2 验证要点

- 刷新后引用面板可正常展开，显示 `contentSnapshot` 内容
- 刷新后 `failed` 状态的助手消息仍显示错误信息
- 刷新后会话列表按 `updatedAt DESC` 排序

---

## 十一、删除操作后的状态同步

### 11.1 删除知识库

| 层面 | 当前行为 | T14 修复 |
|---|---|---|
| Qdrant 向量 | 按 knowledgeBaseId 删除 ✅ | 不变 |
| MySQL 记录 | 级联删除 document/chunk/conversation/message/reference ✅ | 不变 |
| 磁盘文件 | **不清理** ❌ | **修复**：删除 `uploads/{kbId}/` 目录和 `.parsed/` 缓存 |
| 前端状态 | 列表刷新，返回列表页 ✅ | 不变 |

**修改文件**：`server/src/modules/knowledge-base/knowledge-base.service.ts`

**修改要点**：
- 注入 `DocumentStorageService`（或等效的文件管理服务）和 `ParsedResultStore`
- 在 `remove()` 中查出该库下所有文档，逐个清理磁盘文件和解析缓存
- 删除知识库上传目录 `uploads/{kbId}/`
- 文件删除失败仅 `warn` 日志，不阻止删除流程（与向量清理策略一致）

### 11.2 删除文档

| 层面 | 当前行为 | T14 |
|---|---|---|
| Qdrant 向量 | 按 documentId 删除 ✅ | 不变 |
| MySQL 记录 | 删除 document（chunk 级联）✅ | 不变 |
| 磁盘文件 | 删除 storagePath 对应文件 ✅ | 不变 |
| 解析缓存 | 删除 `.parsed/{id}.json` ✅ | 不变 |
| 前端状态 | 文档列表刷新，知识库 documentCount 更新 ✅ | 不变 |

> 文档删除逻辑已完善（`DocumentService.remove()`），T14 仅验证。

### 11.3 删除会话

| 层面 | 当前行为 | T14 |
|---|---|---|
| MySQL 记录 | 删除 conversation（message/reference 级联）✅ | 不变 |
| 前端状态 | 会话列表刷新，当前会话被删则回到空状态 ✅ | 不变 |
| 边界检查 | 生成中禁止删除 ✅ | 不变 |

### 11.4 删除后前端状态同步验证

| 操作 | 前端预期 |
|---|---|
| 删除知识库 | `message.success('知识库已删除')` → 列表刷新 |
| 删除文档 | `message.success('文档已删除')` → 文档列表刷新 + 知识库 documentCount 更新 |
| 删除会话 | `message.success('会话已删除')` → 会话列表刷新 → 当前会话被删则清空消息区 |
| 删除失败 | `message.error(错误消息)` → 状态不变 |

---

## 十二、重复提交和重复点击控制

### 12.1 当前实现审计

| 场景 | 控制方式 | 状态 |
|---|---|---|
| 创建知识库 | Modal 提交按钮 `:loading` | ✅ 已实现 |
| 上传文档 | `uploading` ref + `:disabled="uploading"` | ✅ 已实现 |
| 删除知识库 | `Popconfirm` 确认 + `handleDelete` async | 需验证按钮禁用 |
| 删除文档 | `Popconfirm` 确认 + `handleDeleteDocument` async | 需验证按钮禁用 |
| 删除会话 | `Popconfirm` 确认 + `handleDeleteConversation` async | 需验证按钮禁用 |
| 发送消息 | `generationStatus` 状态门控 + 按钮 `:disabled` | ✅ 已实现 |
| 切换会话 | `isGenerating` 检查 + `message.warning` | ✅ 已实现 |

### 12.2 T14 需验证和补全

1. **删除操作防重复**：`Popconfirm` 确认后，删除请求发出期间应禁用删除按钮，防止连击
2. **知识库创建防重复**：Modal 中提交后到成功回调前，按钮应为 loading 状态
3. **上传防重复**：上传进行中 UploadDragger 应禁用（已实现 `:disabled="disabled || uploading"`）

### 12.3 验证方法

- 快速双击删除确认按钮，应只发出一次 DELETE 请求
- 上传进行中再次拖拽文件，应被禁用拦截
- 生成中点击发送，应被 `canSend` computed 拦截

---

## 十三、页面路由和刷新行为

### 13.1 路由表验证

| 路由 | 刷新行为 | T14 验证 |
|---|---|---|
| `/` | 重定向到 `/knowledge-bases` | ✅ |
| `/knowledge-bases` | 重新加载列表 | ✅ |
| `/knowledge-bases/:id` | 重新加载详情和文档列表 | ✅ |
| `/knowledge-bases/:id/chat` | 重新加载聊天页空状态 | ✅ |
| `/knowledge-bases/:id/chat?conversationId=N` | 恢复指定会话历史 | ✅ |
| `/health` | 重新加载健康检查 | ✅ |

### 13.2 边界场景

| 场景 | 预期 |
|---|---|
| 访问不存在的知识库 ID（如 `/knowledge-bases/99999`） | `Result status="error"` + "返回列表"按钮 |
| 访问不存在的会话（`?conversationId=99999`） | 清空消息 + 提示"会话不存在" + 清除 URL query |
| 直接访问 `/knowledge-bases/:id/chat`（无 conversationId） | 显示空状态 + 会话列表 |
| 路由参数 `:id` 非数字（如 `/knowledge-bases/abc`） | Vue Router props 函数 `Number(route.params.id)` 返回 `NaN` → `validKnowledgeBaseId` computed 返回 0 → 显示错误状态 |

### 13.3 浏览器前进/后退

| 操作 | 预期 |
|---|---|
| 从列表页进入详情页 → 按后退 | 回到列表页 |
| 从详情页进入聊天页 → 按后退 | 回到详情页 |
| 聊天页中切换会话（`router.replace`） → 按后退 | 回到详情页（不回到上一个会话，因为用了 `replace`） |
| 聊天页中新建会话（`router.replace` 清除 query） → 按后退 | 回到详情页 |

---

## 十四、响应式布局和基础样式优化

### 14.1 当前断点

| 断点 | 位置 | 布局变化 |
|---|---|---|
| `max-width: 640px` | `App.vue` | Header 从横排变竖排 |
| `max-width: 640px` | `KnowledgeBaseListView.vue` | 页面头部从横排变竖排 |
| `max-width: 640px` | `KnowledgeBaseDetailView.vue` | 页面头部从横排变竖排 |
| `max-width: 800px` | `ChatView.vue` | 会话列表隐藏，显示"会话"按钮打开 Drawer |

### 14.2 T14 验证项

1. **知识库列表页**（`max-width: 640px`）：卡片单列、头部竖排
2. **知识库详情页**（`max-width: 640px`）：头部竖排、Descriptions 单列、文档表格横向滚动
3. **聊天页**（`max-width: 800px`）：会话列表收起为 Drawer、消息区全宽
4. **聊天页**（`> 800px`）：左右分栏，左侧 280px 会话列表 + 右侧消息区

### 14.3 样式优化

T14 允许以下微调（不改变整体布局）：
- 统一各页面 `gap` 间距为 `16px`（已有）
- 统一卡片圆角和边框样式（已有）
- 确保深色模式下的可读性（如果有用户反馈）
- 消息气泡最大宽度限制（避免超长行）

### 14.4 不做

- 不引入 CSS 预处理器
- 不引入 Tailwind CSS
- 不做主题切换
- 不做动画特效

---

## 十五、清理无用代码、调试日志和临时文件

### 15.1 后端 console.error 清理

将以下 6 处生产代码中的 `console.error` 替换为 NestJS `Logger`：

| 文件 | 当前 | 替换为 |
|---|---|---|
| `http-exception.filter.ts:77` | `console.error('文件上传失败：', exception.code)` | `Logger.error(...)` |
| `http-exception.filter.ts:89` | `console.error('数据库操作失败：', exception)` | `Logger.error(...)` |
| `http-exception.filter.ts:97` | `console.error('服务器内部错误：', exception)` | `Logger.error(...)` |
| `main.ts:45` | `console.error('服务启动失败：', error)` | `Logger.error(...)` |
| `health.service.ts:28` | `console.error('数据库健康检查失败：', error)` | `Logger.error(...)` |
| `database.service.ts:15` | `console.error('数据库初始化失败：', error)` | `Logger.error(...)` |

> `HttpExceptionFilter` 是 `new` 实例化的（不在 DI 容器中），使用 `Logger` 类的静态方法 `Logger.error(message, stack?, context?)`。其他文件如已有 `Logger` 实例则复用。

CLI 脚本中的 `console.log` / `console.error` **保留**（脚本输出用途，不是生产代码）。

### 15.2 前端调试代码清理

检查并清理：
- `console.log` / `console.debug` / `console.warn`（如有）
- `debugger` 语句（如有）
- 注释掉的代码块
- 未使用的 import（TypeScript `noUnusedLocals` 会报错，但需确认）

验证命令：
```bash
# 检查前端是否有调试代码
rg "console\.(log|debug|warn|info)\b" web/src --type ts --type vue
rg "debugger\b" web/src
```

### 15.3 临时文件清理

- 清理 T13 验证数据：知识库 69、文档 123 及测试会话
- 清理 `server/uploads/.parsed/` 下的孤儿缓存文件（对应文档已删除的）
- 清理 `server/uploads/.tmp/` 下的临时上传文件

### 15.4 无用代码检查

```bash
# 检查未使用的导出
rg "export (function|const|class|interface|type)" web/src --type ts | sort

# 检查是否有被引用但已删除的模块
# 通过 TypeScript 编译检查
pnpm --filter web type-check
pnpm --filter server build
```

---

## 十六、环境变量与 README 配置核对

### 16.1 .env.example 核对

逐项核对 `.env.example` 与 `server/src/config/env.validation.ts` 和 `server/src/config/configuration.ts`：

| 变量 | .env.example | env.validation.ts | configuration.ts | 一致性 |
|---|---|---|---|---|
| `SERVER_PORT` | `3000` | `@IsInt @Min(1) @Max(65535)` | `server.port` | ✅ |
| `CORS_ORIGIN` | `http://localhost:5173` | `@IsString @IsNotEmpty` | `server.corsOrigin` | ✅ |
| `DB_HOST` | `localhost` | `@IsString @IsNotEmpty` | `database.host` | ✅ |
| `DB_PORT` | `3306` | `@IsInt @Min(1) @Max(65535)` | `database.port` | ✅ |
| `DB_USER` | `root` | `@IsString @IsNotEmpty` | `database.user` | ✅ |
| `DB_PASSWORD` | `root123` | `@IsString @IsNotEmpty` | `database.password` | ✅ |
| `DB_ROOT_PASSWORD` | `root123` | docker-compose 用 | — | ✅ |
| `DB_NAME` | `mini_rag` | `@IsString @IsNotEmpty` | `database.name` | ✅ |
| `QDRANT_URL` | `http://localhost:6333` | `@IsURL` | `qdrant.url` | ✅ |
| `QDRANT_COLLECTION` | `rag_chunks` | `@IsString @IsNotEmpty` | `qdrant.collection` | ✅ |
| `QDRANT_UPSERT_BATCH_SIZE` | `100` | `@IsInt @Min(1) @Max(1000)` | `qdrant.upsertBatchSize` | ✅ |
| `QDRANT_MOCK` | `false` | `@IsBoolean` (可选) | `qdrant.mock` | ✅ |
| `TOP_K` | `5` | `@IsInt @Min(1) @Max(20)` | `retrieval.topK` | ✅ |
| `SCORE_THRESHOLD` | `0.5` | `@IsNumber @Min(0) @Max(1)` | `retrieval.scoreThreshold` | ✅ |
| `UPLOAD_DIR` | `./uploads` | `@IsString @IsNotEmpty` | `upload.dir` | ✅ |
| `MAX_FILE_SIZE_MB` | `20` | `@IsInt @Min(1) @Max(1024)` | `upload.maxFileSizeMb` | ✅ |
| `CHUNK_SIZE` | `500` | `@IsInt @Min(100) @Max(10000)` | `chunk.size` | ✅ |
| `CHUNK_OVERLAP` | `100` | `@IsInt @Min(0) @Max(9999)` | `chunk.overlap` | ✅ |
| `EMBEDDING_BASE_URL` | `https://api.openai.com/v1` | `@IsString @IsNotEmpty` | `embedding.baseUrl` | ✅ |
| `EMBEDDING_API_KEY` | `sk-your-api-key` | `@IsString @IsNotEmpty` | `embedding.apiKey` | ✅ |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | `@IsString @IsNotEmpty` | `embedding.model` | ✅ |
| `EMBEDDING_DIMENSION` | `1024` | `@IsInt @Min(1) @Max(8192)` | `embedding.dimension` | ✅ |
| `EMBEDDING_BATCH_SIZE` | `20` | `@IsInt @Min(1) @Max(100)` | `embedding.batchSize` | ✅ |
| `EMBEDDING_TIMEOUT_MS` | `30000` | `@IsInt @Min(1000) @Max(300000)` | `embedding.timeoutMs` | ✅ |
| `EMBEDDING_MAX_RETRIES` | `3` | `@IsInt @Min(0) @Max(10)` | `embedding.maxRetries` | ✅ |
| `EMBEDDING_MOCK` | `false` | `@IsBoolean` (可选) | `embedding.mock` | ✅ |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | `@IsURL` | `llm.baseUrl` | ✅ |
| `LLM_API_KEY` | `sk-your-api-key` | `@IsString @IsNotEmpty` | `llm.apiKey` | ✅ |
| `LLM_MODEL` | `gpt-4o-mini` | `@IsString @IsNotEmpty` | `llm.model` | ✅ |
| `LLM_TEMPERATURE` | `0.3` | `@IsNumber @Min(0) @Max(2)` | `llm.temperature` | ✅ |
| `LLM_MAX_TOKENS` | `2048` | `@IsInt @Min(1) @Max(8192)` | `llm.maxTokens` | ✅ |
| `LLM_TIMEOUT_MS` | `60000` | `@IsInt @Min(5000) @Max(300000)` | `llm.timeoutMs` | ✅ |
| `LLM_MAX_RETRIES` | `3` | `@IsInt @Min(0) @Max(10)` | `llm.maxRetries` | ✅ |
| `LLM_MOCK` | `false` | `@IsBoolean` (可选) | `llm.mock` | ✅ |
| `CONTEXT_MAX_CHARS` | `4000` | `@IsInt @Min(500) @Max(20000)` | `rag.contextMaxChars` | ✅ |
| `CHAT_HISTORY_MAX_MESSAGES` | `6` | `@IsInt @Min(0) @Max(20)` | `chat.historyMaxMessages` | ✅ |
| `VITE_API_BASE_URL` | `/api` | 前端构建期注入 | — | ✅ |

> T14 需实际运行核对脚本确认无遗漏。`.env.example` 末尾的 `# 后续任务会按总体方案扩充其他环境变量。` 需删除（所有环境变量已全部列出）。

### 16.2 README 更新

当前 `README.md` 严重过时，仍停留在 T04/T05 阶段。T14 需重写为完整的 MVP 使用说明。

**README 结构**：

```markdown
# Mini RAG

基于 Vue 3、NestJS、MySQL 与 Qdrant 的轻量知识库系统。

## 功能概览

- 知识库管理：创建、列表、详情、删除
- 文档管理：上传 PDF/Markdown/TXT、SHA-256 去重、状态查询、删除
- 文档处理：文本解析 → 清洗 → 切片 → Embedding → Qdrant 写入（CLI 触发）
- RAG 问答：SSE 流式返回、引用展示、会话管理
- 会话管理：保存、历史恢复、删除

## 前置要求

- Node.js 20
- pnpm 9
- Docker（含 Docker Compose）

## 快速开始

（保留现有启动步骤，补充 .env 配置说明）

## 环境变量

（列出全部环境变量，分组说明）

## 文档处理

（说明 CLI 触发流程：parse → chunk → store）

## API 接口

（列出全部 15 个接口，或指向 Swagger）

## 常见问题

（保留 MySQL 端口冲突，补充 Qdrant 连接失败、Mock 模式说明）
```

**需更新的内容**：
1. 功能概览：从 T04/T05 描述更新为完整 MVP 功能
2. 文档处理章节：说明 `parse:document` → `chunk:document` → `store:document` 流程
3. CLI 命令：补充 `chunk:document`、`embed:document`、`store:document`、`reset:document` 命令
4. 环境变量：列出全部 28+ 个环境变量，按功能分组
5. Mock 模式：说明 `EMBEDDING_MOCK`、`LLM_MOCK`、`QDRANT_MOCK` 用途
6. 删除"切片、Embedding、Qdrant 写入和 Chat 不属于当前阶段"的过时描述
7. 删除末尾"后续任务会按总体方案扩充其他环境变量"注释

---

## 十七、文件修改清单

### 17.1 后端修改（3 个文件）

| 文件 | 修改内容 |
|---|---|
| `server/src/modules/knowledge-base/knowledge-base.service.ts` | `remove()` 方法增加磁盘文件和解析缓存清理 |
| `server/src/common/filters/http-exception.filter.ts` | 3 处 `console.error` → `Logger.error` |
| `server/src/main.ts` | 1 处 `console.error` → `Logger.error` |
| `server/src/modules/health/health.service.ts` | 1 处 `console.error` → `Logger.error` |
| `server/src/database/database.service.ts` | 1 处 `console.error` → `Logger.error` |

### 17.2 后端新增（1 个文件）

| 文件 | 说明 |
|---|---|
| `server/src/scripts/reset-stuck-documents.ts` | 重置卡住文档状态的 CLI 脚本 |

`server/package.json` 需新增 script：
```json
"reset:documents": "tsx src/scripts/reset-stuck-documents.ts",
"reset:document": "tsx src/scripts/reset-stuck-documents.ts"
```

### 17.3 前端修改（可能涉及，以验证结果为准）

| 文件 | 可能修改 |
|---|---|
| 各组件 | 验证后如发现 Loading/空状态/错误提示不一致则微调 |
| 样式文件 | 如发现响应式布局问题则微调 |

> T14 前端修改以验证和微调为主，不预期大规模改动。如果验证通过则不修改。

### 17.4 文档修改（3 个文件）

| 文件 | 修改内容 |
|---|---|
| `README.md` | 全面重写，反映 MVP 完整功能 |
| `.env.example` | 删除末尾过时注释 |
| `docs/00-overall-plan.md` | 追加 v2.3 修订记录（T14 修订） |

### 17.5 文档新增（2 个文件，完成后生成）

| 文件 | 说明 |
|---|---|
| `docs/reports/task-14-completion.md` | T14 完成报告 |
| `docs/01-current-implementation.md` | 更新为 T14 后快照 |

---

## 十八、验收标准

### 18.1 构建与静态检查

| 命令 | 预期 |
|---|---|
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `pnpm --filter server build` | 通过 |
| `rg "console\.(log|debug)" web/src` | 无命中（`console.warn`/`console.error` 允许但需审查） |
| `rg "console\.(log|error|warn)" server/src --type ts -g '!scripts/**'` | 无命中（已迁移到 Logger） |
| `rg "debugger\b" web/src server/src` | 无命中 |
| `rg "Mock|mock|fake|dummy|EventSource|WebSocket|localStorage|sessionStorage" web/src` | 无命中 |
| `rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router` | 无命中 |

### 18.2 完整流程验收

按 §四 的 10 步验收流程全部通过。

### 18.3 失败场景验收

按 §七 的失败场景矩阵全部验证，每种场景有明确提示。

### 18.4 删除清理验收

| 操作 | 验证 |
|---|---|
| 删除文档 | Qdrant 向量已清理 + 磁盘文件已删除 + 解析缓存已删除 |
| 删除知识库 | Qdrant 向量已清理 + 磁盘文件已清理 + 数据库记录级联删除 |
| 删除会话 | 消息和引用级联删除 + 前端状态同步 |

### 18.5 环境变量验收

- `.env.example` 与 `env.validation.ts` 完全一致
- README 环境变量章节与 `.env.example` 一致

---

## 十九、实施顺序

按以下顺序执行，每步完成后验证：

1. **后端清理**：console.error → Logger（§十五）
2. **后端修复**：知识库删除磁盘文件清理（§十一）
3. **后端新增**：reset-stuck-documents CLI 脚本（§八）
4. **前端验证**：Loading/空状态/错误提示审计（§六）
5. **前端验证**：重复提交控制审计（§十二）
6. **前端验证**：路由和刷新行为（§十三）
7. **前端验证**：响应式布局（§十四）
8. **全链路回归**：完整 10 步流程（§四）
9. **失败场景验证**：§七 矩阵
10. **文档更新**：README + .env.example（§十六）
11. **静态检查**：§十八.1 全部命令
12. **清理验证数据**：删除 T14 测试创建的数据
13. **生成完成报告**：`docs/reports/task-14-completion.md`
14. **更新快照**：`docs/01-current-implementation.md`

---

## 二十、禁止项

1. **不新增核心业务功能**：T14 只做联调和收口
2. **不修改数据库表结构或 migration**：不新增表、不修改字段
3. **不修改后端 API 路径或 SSE 事件协议**：冻结级约定
4. **不新增 npm 依赖**：零新增依赖
5. **不引入 Pinia 或其他状态管理框架**：composables 已满足
6. **不实现自动化文档处理流水线**：保持手动 CLI 触发
7. **不实现登录/权限/多租户**：MVP 不做
8. **不实现 Agent/GraphRAG/Rerank**：MVP 不做
9. **不实现 WebSocket**：SSE 已满足
10. **不实现 Markdown 渲染**：助手回答按纯文本展示
11. **不使用前端 Mock 数据**：全部使用真实 API
12. **不使用 `localStorage` / `sessionStorage`**：不缓存业务数据
13. **不做大规模架构重构**：只做补全和修复

---

## 二十一、设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 知识库删除增加磁盘文件清理 | 修复资源泄漏：当前只清 Qdrant + DB，磁盘文件残留 |
| 2 | console.error → Logger | 统一日志输出到 NestJS Logger，生产环境可配置日志级别 |
| 3 | 新增 reset-stuck-documents CLI | 卡在中间状态的文档需手动恢复，CLI 提供标准化恢复手段 |
| 4 | README 全面重写 | 当前 README 停留在 T04/T05 阶段，严重过时 |
| 5 | .env.example 删除末尾注释 | 所有环境变量已全部列出，"后续任务扩充"提示已过时 |
| 6 | T14 前端以验证为主，不预期大规模改动 | T12/T13 已建立完善的前端架构，T14 只需验证和微调 |
| 7 | 不实现自动化文档处理流水线 | MVP 保持手动 CLI 触发，自动化流水线属于后续优化 |
| 8 | 文件删除失败不阻止删除流程 | 与向量清理策略一致，失败仅 warn 日志 |

---

## 二十二、Codex 执行指令

> 以下是直接交给 Codex 的简洁执行指令。

```
你是一个资深全栈工程师。请根据 docs/task-14-integration-and-polish.md 完成 T14 整体联调与交互收口任务。

前置条件：T13 已完成，系统已可运行（后端 localhost:3000，前端 localhost:5173，Docker 中 mysql 和 qdrant 运行中）。

执行步骤：

1. 后端 console.error 清理：
   - 将 server/src/common/filters/http-exception.filter.ts 中 3 处 console.error 替换为 NestJS Logger.error（使用类级别静态方法，因为过滤器是 new 实例化的）
   - 将 server/src/main.ts 中 1 处 console.error 替换为 Logger.error
   - 将 server/src/modules/health/health.service.ts 中 1 处 console.error 替换为 Logger.error
   - 将 server/src/database/database.service.ts 中 1 处 console.error 替换为 Logger.error
   - CLI 脚本（server/src/scripts/）中的 console.log/console.error 保留不动

2. 后端知识库删除磁盘文件清理：
   - 修改 server/src/modules/knowledge-base/knowledge-base.service.ts 的 remove() 方法
   - 在删除 Qdrant 向量之后、删除数据库记录之前，查出该库下所有文档的 id 和 storagePath
   - 逐个调用 storageService.deleteByStoragePath(doc.storagePath) 和 parsedResultStore.remove(doc.id)
   - 删除知识库上传目录 uploads/{kbId}/（如果 StorageService 有此方法，没有则新增）
   - 文件删除失败仅 warn 日志，不阻止删除流程
   - 需要先阅读 DocumentService.remove() 了解现有文件清理逻辑，复用相同的 storageService 和 parsedResultStore

3. 新增 reset-stuck-documents CLI 脚本：
   - 新建 server/src/scripts/reset-stuck-documents.ts
   - 接受参数：知识库 ID 或文档 ID
   - 查询 status IN ('parsing', 'chunking', 'embedding') 的文档
   - 重置为 pending，清空 errorMessage
   - 输出重置的文档列表（JSON 格式）
   - 在 server/package.json 中添加 "reset:documents" 和 "reset:document" 脚本
   - 参考现有 CLI 脚本（parse-document.ts 等）的代码结构

4. 前端验证和微调：
   - 验证所有页面的 Loading、空状态、错误提示是否符合 docs/task-14-integration-and-polish.md §六 的规范
   - 验证重复提交控制（§十二）
   - 验证路由和刷新行为（§十三）
   - 验证响应式布局（§十四）
   - 如发现问题则修复，如无问题则不修改
   - 运行 pnpm --filter web type-check 和 pnpm --filter web build 确认通过

5. 文档更新：
   - 重写 README.md，反映 MVP 完整功能（参考 §十六.2 的结构要求）
   - 更新 .env.example，删除末尾过时注释
   - 在 docs/00-overall-plan.md 追加 v2.3 修订记录

6. 静态检查：
   - pnpm --filter web type-check 通过
   - pnpm --filter web build 通过
   - pnpm --filter server build 通过
   - rg "console\.(log|debug)" web/src 无命中
   - rg "console\.(log|error|warn)" server/src --type ts -g '!scripts/**' 无命中
   - rg "debugger" web/src server/src 无命中
   - rg "Mock|mock|fake|dummy|EventSource|WebSocket|localStorage|sessionStorage" web/src 无命中

7. 完整流程验证：
   - 创建知识库 → 上传 PDF/MD/TXT → CLI 处理 → 问答 → 引用展示 → 刷新恢复 → 删除清理
   - 验证各类失败场景有明确提示
   - 验证删除知识库后磁盘文件已清理

8. 清理验证数据：
   - 删除 T13 遗留数据（知识库 69 等）
   - 删除 T14 验证创建的测试数据

9. 生成完成报告：
   - 创建 docs/reports/task-14-completion.md，记录所有修改、验证结果和已知问题
   - 更新 docs/01-current-implementation.md 为 T14 后快照

约束：
- 不新增 npm 依赖
- 不修改数据库表结构或 migration
- 不修改后端 API 路径或 SSE 事件协议
- 不引入 Pinia 或其他状态管理框架
- 不实现登录/权限/多租户/Agent/GraphRAG/Rerank/WebSocket
- 不使用前端 Mock 数据
- 不使用 localStorage/sessionStorage
- CLI 脚本中的 console 语句保留
- 完成后生成 docs/reports/task-14-completion.md 和更新 docs/01-current-implementation.md
```

---

## 二十三、完成报告要求

完成后生成 `docs/reports/task-14-completion.md`，内容包括：

1. **新增和修改文件清单**：逐个列出
2. **后端修改摘要**：console.error 清理、知识库删除磁盘清理、CLI 脚本
3. **前端验证结果**：Loading/空状态/错误提示/重复提交/路由/响应式 各项验证结论
4. **完整流程验证结果**：10 步验收流程每步的实际结果
5. **失败场景验证结果**：§七 矩阵每项的实际结果
6. **静态检查结果**：§十八.1 全部命令的输出
7. **验证环境说明**：Docker 状态、端口、Mock 模式等
8. **未完成项和已知问题**：如有
9. **越界确认**：确认未实现禁止项
10. **是否具备进入下一阶段**：结论

同时更新 `docs/01-current-implementation.md` 为 T14 后快照，包括：
- 后端模块变化（知识库删除清理增强、CLI 脚本新增、Logger 迁移）
- 前端状态（验证结论，如有微调则列出）
- README 更新说明
- 已验证的完整流程结果
- 未完成项和已知问题
