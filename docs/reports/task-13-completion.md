# T13 前端 RAG 聊天页面完成报告

> 日期：2026-07-31（Asia/Shanghai）
> 任务：T13 前端 RAG 聊天、会话与引用展示
> 结论：通过，具备进入整体联调和项目收口阶段的条件

## 新增和修改文件

新增：

- `web/src/types/conversation.ts`
- `web/src/types/chat.ts`
- `web/src/api/conversation.ts`
- `web/src/api/sse.ts`
- `web/src/api/chat.ts`
- `web/src/composables/use-conversations.ts`
- `web/src/composables/use-chat.ts`
- `web/src/views/ChatView.vue`
- `web/src/components/ConversationList.vue`
- `web/src/components/MessageList.vue`
- `web/src/components/MessageBubble.vue`
- `web/src/components/ReferencePanel.vue`
- `web/src/components/ChatInput.vue`

修改：

- `web/src/router/index.ts`
- `docs/00-overall-plan.md`
- `docs/01-current-implementation.md`

删除：

- `web/src/views/ChatPlaceholderView.vue`

未修改后端代码，未修改 `web/package.json`，未新增依赖。

## 页面与组件结构

- `/knowledge-bases/:id/chat` 已从占位页替换为 `ChatView.vue`。
- `ChatView.vue` 负责知识库标题、会话侧栏、消息区、输入区、移动端 Drawer 和路由 query 同步。
- `ConversationList.vue` 负责会话列表、新建、切换、删除确认和当前会话高亮。
- `MessageList.vue` 负责消息滚动和空状态。
- `MessageBubble.vue` 负责用户/助手消息、生成中状态、失败状态和引用入口。
- `ReferencePanel.vue` 负责引用折叠展开，统一适配 SSE 的 `content` 与历史接口的 `contentSnapshot`。
- `ChatInput.vue` 支持回车发送、Shift+回车换行、生成中禁用输入和停止按钮。

## SSE 客户端实现

- `web/src/api/chat.ts` 使用原生 `fetch` POST 到 `/api/knowledge-bases/:id/chat`，不走 Axios。
- `web/src/api/sse.ts` 使用 `response.body.getReader()` + `TextDecoder` 读取流。
- SSE buffer 按 `/\r?\n\r?\n/` 分帧，最后一段保留到下一次读取，支持半包和粘包。
- `parseSseFrame()` 支持 `event:`、多行 `data:` 和注释行。
- `dispatchParsedFrame()` 对 `metadata/token/references/done/error` 做结构校验后再回调。
- HTTP 非 200 响应解析后端 `{code,message,details}` 并包装为 `ApiError`。
- `AbortSignal.aborted` 时静默结束，不把用户主动中止误报为网络错误。

## 会话和消息状态管理

- `useConversations()` 通过真实接口获取会话列表、刷新和删除会话。
- `useChat()` 管理 `messages`、`generationStatus`、`currentConversationId`、错误信息和 `AbortController`。
- 新会话发送第一条消息后，从 `metadata` 事件读取 `conversationId` 和 `userMessageId`，并用 `router.replace` 同步到 URL query。
- 继续已有会话时带上当前 `conversationId`，后端校验归属。
- 页面刷新时从 `?conversationId=N` 调用 `GET /api/conversations/:id/messages` 恢复历史消息和引用。
- SSE 失败和网络失败会把对应助手消息置为 `failed`，并显示安全错误提示。
- 发现并修复了异常路径下助手气泡可能停留在 `streaming` 的前端状态问题：现在按消息下标替换数组项，确保 Vue 响应式更新。

## 引用展示

- SSE `references` 展示字段：`chunkId/documentId/documentName/pageNo/content/score`。
- 历史消息引用展示字段：`documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot`。
- 页面显示文档名、页码（`null` 显示“无页码”）、相似度百分比和内容快照。
- 引用默认折叠，点击后展开详情。

## 实际测试结果

构建和静态检查：

| 命令 | 结果 |
|---|---|
| `pnpm --filter web type-check` | 通过 |
| `pnpm --filter web build` | 通过 |
| `pnpm --filter server build` | 通过 |
| `rg "\bany\b" web/src/api web/src/components web/src/composables web/src/views web/src/router` | 无命中 |
| `rg "Mock|mock|fake|dummy|EventSource|WebSocket|localStorage|sessionStorage" web/src` | 无命中 |

验证环境：

- Docker `rag-mysql-1`、`rag-qdrant-1` 运行中。
- 宿主 3306 被本机 MySQL 占用，本次后端临时使用 `DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=root123`。
- 后端验证时使用真实 Qdrant：`QDRANT_MOCK=false`；Embedding/LLM 正常问答验证使用 mock：`EMBEDDING_MOCK=true`、`LLM_MOCK=true`。
- 为应用内浏览器验证，临时启动过 `http://[::1]:5174` Vite 服务；验证后已停止，原 `http://localhost:5173` 服务保留。

验证数据：

- 创建知识库 `69`：`T13 Chat Verification 20260731144428`。
- 上传 TXT 文档 `123`：`t13-chat-anchor-20260731144428.txt`，内容为 `T13CHAT_REFERENCE_ANCHOR`。
- 执行处理脚本：
  - `pnpm --filter server parse:document 123`：成功，`parser=plaintext`，`pageCount=1`。
  - `pnpm --filter server chunk:document 123`：成功，`chunkCount=1`。
  - `pnpm --filter server store:document 123`：成功，`vectorCount=1`，`collectionName=rag_chunks`。
- 文档最终状态：`completed`，`chunkCount=1`。

浏览器验证：

| 场景 | 实际结果 |
|---|---|
| 从知识库详情页点击“进入对话” | 跳转到 `/knowledge-bases/69/chat`，显示聊天页空状态和会话列表 |
| 新建会话问答 | 发送 `T13CHAT_REFERENCE_ANCHOR` 后创建会话 `6`，URL 同步为 `?conversationId=6` |
| 流式回答展示 | 页面显示助手回答“根据知识库中的 1 条参考资料，可以回答用户问题。” |
| 引用展示 | 展开引用后显示文档名、无页码、相似度 `100.0%`、内容 `T13CHAT_REFERENCE_ANCHOR` |
| 页面刷新恢复 | 刷新 `?conversationId=6` 后恢复历史用户消息、助手消息和引用入口 |
| 已有会话续聊 | 在会话 `6` 再次发送同一问题后，消息数从 2 增至 4，两个助手消息均有引用入口 |
| 新建第二会话 | 点击“新建”后 URL 清除 query，发送 `T13CHAT_SECOND_CONVERSATION` 创建会话 `7` |
| 无命中问题 | 会话 `7` 返回“知识库中未找到与您问题相关的内容。”，无引用 |
| 切换会话 | 点击会话 `6` 后加载 4 条历史消息 |
| 删除会话 | 页面删除会话 `7` 成功，列表刷新；接口验证 `GET /api/conversations/7/messages` 返回 404 |
| 消息和引用落库 | `GET /api/conversations/6/messages` 返回 4 条消息；助手消息引用包含 `documentId=123`、`chunkId=53`、`chunkIndex=0`、`score=1` |
| 主动中止 | 使用本地挂起 LLM 端点验证，点击“停止”后页面显示“已停止生成”，助手消息置为失败状态 |
| SSE error 事件 | 停止本地 LLM 端点后发送问题，页面顶部和助手气泡均显示“问答服务暂时不可用：模型调用失败”，不再停留在“生成中” |

SSE 事件验证：

- 直接请求 `POST /api/knowledge-bases/69/chat`，实际收到事件序列：
  - `metadata`：`conversationId=12`，`userMessageId=29`
  - `token`：5 个 token 事件
  - `references`：`chunkId=53`、`documentId=123`、`documentName=t13-chat-anchor-20260731144428.txt`、`pageNo=null`、`content=T13CHAT_REFERENCE_ANCHOR`、`score=1`
  - `done`：`assistantMessageId=30`

## 未完成项和已知问题

1. 未专门构造半包/粘包/多行 data 的网络级测试；代码已实现 buffer 累积和多行 data 拼接，实际联调验证了标准 T11 SSE 帧。
2. 未做移动端视口截图验收；代码已实现 `max-width: 800px` 下会话列表收起为 Drawer。
3. `pnpm --filter ...` 仍会先打印 `No projects matched the filters "D:\Users\Documents\RAG"`，但目标 package 命令实际执行成功且 exit code 为 0。
4. T13 验证数据未清理：知识库 `69`、文档 `123` 及若干测试会话仍保留，便于复查本次结果。

## 越界确认

- 未实现 WebSocket。
- 未实现登录、权限、多租户。
- 未实现 Rerank、Agent、GraphRAG。
- 未修改后端核心业务。
- 未新增数据库表或 migration。
- 未新增 npm 依赖，未引入 Pinia。
- 未使用 Mock 前端数据；页面全部来自真实后端接口。
- 未使用 `EventSource`、`localStorage`、`sessionStorage` 或显式 `any`。

## 是否具备进入下一阶段

具备。T13 已完成前端聊天页、会话管理、SSE 流式接入、引用展示、刷新恢复、主动中止和异常提示，并通过构建、静态扫描和真实联调验证。可以进入整体联调和项目收口阶段。
