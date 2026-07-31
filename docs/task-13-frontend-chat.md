# T13 前端 RAG 聊天、会话与引用展示 — Codex 执行指令

> 任务编号：T13（阶段 P9：前端聊天页）
> 前置条件：T12 已完成（结论：**通过**，见 `docs/reports/task-12-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v2.1 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T12 后快照）+ `docs/reports/task-12-completion.md` + `docs/task-11-streaming-chat-and-conversation.md`（T11 SSE 协议）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据 T12 快照与完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| Vue 3.5 + TypeScript 5.6 + Vite 5.4 | `web/package.json` | **不修改版本**。已有 `vue@^3.5.13`、`ant-design-vue@^4.2.6`、`axios@^1.8.4`、`vue-router@^4.5`、`vite@^5.4.11`、`vue-tsc@^2.1.10` |
| Pinia | 未安装 | **不安装**。T13 用 Vue composables 管理聊天状态（用户禁止"无必要的新状态管理框架"） |
| Vite 配置 | `web/vite.config.ts` | **不修改**。已有 `port:5173`、`proxy '/api' → localhost:3000`、`envDir:'..'` |
| TypeScript 配置 | `web/tsconfig.json` | **不修改**。`strict:true`、`noUnusedLocals:true`、`noUnusedParameters:true` |
| Axios 实例 + ApiError | `web/src/api/http.ts` | **不修改**。已有 `ApiError` 类（constructor `(message, { status?, code?, details? })`）、响应解包逻辑。T13 的 SSE 请求不走 Axios——使用原生 `fetch` |
| Vue Router | `web/src/router/index.ts` | **允许修改**：将 `chat-placeholder` 路由替换为真实聊天页（§八） |
| App.vue 布局 | `web/src/App.vue` | **不修改**。已有 Layout + LayoutHeader + LayoutContent + RouterView，响应式 `@media (max-width:640px)` |
| main.ts | `web/src/main.ts` | **不修改**。已注册 router |
| 知识库 API | `web/src/api/knowledge-base.ts` | **不修改**。已有 `getKnowledgeBase(id)` 等 |
| 知识库类型 | `web/src/types/knowledge-base.ts` | **不修改**。已有 `KnowledgeBase` 接口 |
| 格式化工具 | `web/src/utils/format.ts` | **不修改、可复用**。已有 `formatDateTime()`、`formatFileSize()` |
| ChatPlaceholderView | `web/src/views/ChatPlaceholderView.vue` | **删除**。T13 替换为真实聊天页 |
| 后端 SSE 接口 | `POST /api/knowledge-bases/:id/chat` | **不修改后端**。T11 已实现，SSE 事件协议见 §三 |
| 后端会话接口 | `GET /api/knowledge-bases/:id/conversations`、`GET /api/conversations/:id/messages`、`DELETE /api/conversations/:id` | **不修改后端**。T11 已实现 |
| 后端 DTO | `ConversationResponseDto`、`MessageResponseDto`、`MessageReferenceResponseDto` | 前端 TS 类型与后端 DTO 字段精确对齐（§五） |
| 代码约定 | `web/src/` | kebab-case 文件名、显式返回类型、`catch` 用 `unknown`、禁显式 `any`、简短中文注释、Ant Design Vue 按需导入（不 `app.use(Antd)`） |

**T12 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 MySQL 占用 `localhost:3306`）：前端开发不直接连 DB，但后端需正常启动才能联调 SSE。
2. `pnpm --filter web ...` 会先打印 `No projects matched the filters`，但命令实际执行成功（已知问题，不影响）。
3. T12 的 `ChatPlaceholderView.vue` 接收 `knowledgeBaseId` prop，T13 替换为真实聊天页后该文件删除。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

1. 知识库详情页"进入对话"按钮跳转到聊天页（已有，不改动）
2. 聊天页布局：左侧会话列表 + 右侧消息区域 + 底部输入区
3. 新建会话：发送第一条消息时后端自动创建会话，前端从 `metadata` 事件获取 `conversationId` 并同步到 URL
4. 会话列表：展示当前知识库下所有会话，按 `updatedAt` 倒序；点击切换会话
5. 历史消息加载：切换会话时从 `GET /api/conversations/:id/messages` 加载历史消息
6. 用户问题发送：输入框 + 发送按钮，回车发送（Shift+回车换行）
7. SSE 流式 token 展示：逐字增量渲染助手回答
8. SSE 事件处理：`metadata`/`token`/`references`/`done`/`error` 五种事件全部处理
9. 回答生成中的 Loading 和停止状态：生成中显示"停止生成"按钮，点击可中止请求
10. 引用来源展示：助手消息下方展示引用面板，含文档名称、页码、相似度、内容快照
11. 引用折叠/展开：默认折叠，点击展开查看详情
12. 删除会话：Popconfirm 确认后删除，删除后切换到空状态或下一个会话
13. 页面刷新后恢复会话历史：从 URL 中的 `conversationId` 恢复选中的会话
14. 异常提示和断线处理：SSE error 事件、网络断开、后端不可用均有提示
15. 移动端和基础响应式布局：小屏幕下会话列表收起为 Drawer

### 2.2 非目标（明确不做）

| 项 | 原因 |
|---|---|
| Markdown 富文本高级编辑器 | 用户禁止；纯文本输入框即可 |
| WebSocket | 用户禁止；SSE 已满足需求 |
| 登录和权限 | MVP 不做 |
| 多租户 | MVP 不做 |
| Rerank / Agent / GraphRAG | MVP 不做 |
| 修改后端业务逻辑 | 禁止 |
| Mock 假数据 | 全部使用真实 API |
| 无必要的新状态管理框架 | 用 composables 替代 |
| Markdown 渲染（回答内容） | 助手回答按纯文本展示，不做 Markdown 解析 |
| 消息编辑/重新生成 | 非 MVP 范围 |
| 文件上传（聊天中） | 非 MVP 范围 |
| 消息搜索 | 非 MVP 范围 |
| 会话重命名 | 后端无更新接口 |
| 引用跳转到文档原文 | 引用快照已包含内容，不需要跳转 |

---

## 三、SSE 事件协议回顾（来自 T11，冻结级）

### 3.1 接口

```
POST /api/knowledge-bases/:id/chat
Content-Type: application/json
Body: { question: string, conversationId?: number, topK?: number, scoreThreshold?: number }
Response: text/event-stream
```

### 3.2 事件类型

| 事件 | 时机 | data 结构 |
|---|---|---|
| `metadata` | 连接建立后第一个事件 | `{ conversationId: number, userMessageId: number }` |
| `token` | LLM 流式输出期间，每个 delta | `{ delta: string }` |
| `references` | 所有 token 结束后 | `ReferenceSnapshot[]`（可能为空数组 `[]`） |
| `done` | 引用事件之后，正常结束 | `{ assistantMessageId: number }` |
| `error` | 任何阶段失败时，替代 done | `{ message: string }` |

### 3.3 事件顺序

```
正常流程：  metadata → token(×N) → references → done
无命中流程： metadata → token(×1, 固定话术) → references(空数组) → done
失败流程：   metadata → token(×N, 部分内容) → error
                 或 metadata → error（检索/LLM 初始化失败）
```

### 3.4 SSE 帧格式

每帧格式（标准 SSE）：

```
event: {eventName}
data: {jsonString}

```

> `data:` 行后是 JSON 字符串，帧之间用 `\n\n` 分隔。

### 3.5 具体示例

```
event: metadata
data: {"conversationId":1,"userMessageId":5}

event: token
data: {"delta":"RAG"}

event: token
data: {"delta":" 是检索增强"}

event: token
data: {"delta":"生成"}

event: references
data: [{"chunkId":123,"documentId":45,"documentName":"rag-intro.txt","pageNo":null,"content":"RAG is retrieval augmented generation","score":1}]

event: done
data: {"assistantMessageId":6}

```

### 3.6 ReferenceSnapshot 结构

```ts
// 对应后端 chat.types.ts ReferenceSnapshot
interface ReferenceSnapshot {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}
```

### 3.7 错误事件安全消息

`error` 事件的 `message` 字段只包含安全的中文提示（如 `问答服务暂时不可用：模型调用失败`），不暴露 API Key、Prompt 或内部异常。

### 3.8 HTTP 状态码

| 状态码 | 场景 | 说明 |
|---|---|---|
| 200 | SSE 正常开始 | `Content-Type: text/event-stream` |
| 400 | 参数校验失败 | 空 question 等 |
| 404 | 知识库或会话不存在 | |
| 409 | 当前会话正在生成回答 | 同会话并发去重 |

> **关键**：400/404/409 在 SSE 头设置之前抛出，返回普通 JSON 错误响应（`{code, message, details?}`），**不**是 SSE 事件。前端需区分"HTTP 错误响应"和"SSE error 事件"。

---

## 四、API 清单（T13 对接的全部接口）

| # | 方法 | 路径 | 说明 | 响应 |
|---|---|---|---|---|
| 10 | POST | `/api/knowledge-bases/:id/chat` | SSE 流式问答 | `text/event-stream` |
| 11 | GET | `/api/knowledge-bases/:id/conversations` | 会话列表 | `{code:0, data: ConversationResponseDto[]}` |
| 12 | GET | `/api/conversations/:id/messages` | 消息历史（含引用） | `{code:0, data: MessageResponseDto[]}` |
| 13 | DELETE | `/api/conversations/:id` | 删除会话 | 204 |

> T13 不调用 T10 的非流式问答接口（`POST /api/knowledge-bases/:id/ask`）。

---

## 五、TypeScript 类型定义

### 5.1 `web/src/types/conversation.ts`（新建）

```typescript
/** 会话（对应后端 ConversationResponseDto） */
export interface Conversation {
  id: number
  title: string
  createdAt: string
  updatedAt: string
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 消息状态 */
export type MessageStatus = 'completed' | 'failed'

/** 消息引用（对应后端 MessageReferenceResponseDto） */
export interface MessageReference {
  documentId: number | null
  chunkId: number | null
  documentName: string
  chunkIndex: number
  pageNo: number | null
  score: number
  contentSnapshot: string
}

/** 消息（对应后端 MessageResponseDto） */
export interface ChatMessageData {
  id: number
  role: MessageRole
  content: string
  status: MessageStatus
  errorMessage: string | null
  createdAt: string
  references: MessageReference[]
}
```

### 5.2 `web/src/types/chat.ts`（新建）

```typescript
import type { MessageReference } from './conversation'

/** SSE 事件类型枚举 */
export type SseEventType =
  | 'metadata'
  | 'token'
  | 'references'
  | 'done'
  | 'error'

/** metadata 事件 data */
export interface SseMetadataEvent {
  conversationId: number
  userMessageId: number
}

/** token 事件 data */
export interface SseTokenEvent {
  delta: string
}

/** references 事件 data（引用快照数组） */
export interface SseReferenceItem {
  chunkId: number
  documentId: number
  documentName: string
  pageNo: number | null
  content: string
  score: number
}

/** done 事件 data */
export interface SseDoneEvent {
  assistantMessageId: number
}

/** error 事件 data */
export interface SseErrorEvent {
  message: string
}

/** 聊天请求参数 */
export interface ChatRequestParams {
  question: string
  conversationId?: number
}

/** 前端聊天消息（包含流式临时状态） */
export interface ChatMessageItem {
  id: number | null          // null = 流式生成中，尚未落库
  role: 'user' | 'assistant'
  content: string
  status: 'completed' | 'failed' | 'streaming'
  errorMessage: string | null
  references: MessageReference[] | SseReferenceItem[]
  createdAt: string | null
}

/** 聊天生成状态 */
export type ChatGenerationStatus =
  | 'idle'           // 空闲
  | 'connecting'     // fetch 已发送，未收到 metadata
  | 'generating'     // 收到 metadata 后，生成中
  | 'completed'      // 收到 done
  | 'error'          // 收到 error 或网络断开
  | 'aborted'        // 用户主动中止
```

### 5.3 类型与后端 DTO 对照

| 前端 TS 类型 | 后端 DTO | 说明 |
|---|---|---|
| `Conversation.id` | `ConversationResponseDto.id` | `number` |
| `Conversation.title` | `ConversationResponseDto.title` | `string` |
| `Conversation.createdAt` | `ConversationResponseDto.createdAt` | `Date.toISOString()` → `string` |
| `Conversation.updatedAt` | `ConversationResponseDto.updatedAt` | `Date.toISOString()` → `string` |
| `ChatMessageData.id` | `MessageResponseDto.id` | `number` |
| `ChatMessageData.role` | `MessageResponseDto.role` | `'user' \| 'assistant'` |
| `ChatMessageData.content` | `MessageResponseDto.content` | `string` |
| `ChatMessageData.status` | `MessageResponseDto.status` | `'completed' \| 'failed'` |
| `ChatMessageData.errorMessage` | `MessageResponseDto.errorMessage` | `string \| null` |
| `ChatMessageData.references` | `MessageResponseDto.references` | `MessageReference[]` |
| `MessageReference.documentId` | `MessageReferenceResponseDto.documentId` | `number \| null` |
| `MessageReference.chunkId` | `MessageReferenceResponseDto.chunkId` | `number \| null` |
| `MessageReference.documentName` | `MessageReferenceResponseDto.documentName` | `string` |
| `MessageReference.chunkIndex` | `MessageReferenceResponseDto.chunkIndex` | `number` |
| `MessageReference.pageNo` | `MessageReferenceResponseDto.pageNo` | `number \| null` |
| `MessageReference.score` | `MessageReferenceResponseDto.score` | `number`（DECIMAL → number） |
| `MessageReference.contentSnapshot` | `MessageReferenceResponseDto.contentSnapshot` | `string` |

---

## 六、API 请求封装

### 6.1 `web/src/api/conversation.ts`（新建）

```typescript
import http from './http'
import type { Conversation, ChatMessageData } from '../types/conversation'

/** GET /api/knowledge-bases/:id/conversations — 会话列表 */
export async function listConversations(
  knowledgeBaseId: number,
): Promise<Conversation[]> {
  const response = await http.get<Conversation[]>(
    `/knowledge-bases/${knowledgeBaseId}/conversations`,
  )
  return response.data
}

/** GET /api/conversations/:id/messages — 消息历史（含引用） */
export async function listMessages(
  conversationId: number,
): Promise<ChatMessageData[]> {
  const response = await http.get<ChatMessageData[]>(
    `/conversations/${conversationId}/messages`,
  )
  return response.data
}

/** DELETE /api/conversations/:id — 删除会话（204 No Content） */
export async function deleteConversation(
  conversationId: number,
): Promise<void> {
  await http.delete(`/conversations/${conversationId}`)
}
```

### 6.2 `web/src/api/sse.ts`（新建）— SSE 客户端封装

```typescript
import { ApiError } from './http'
import type {
  SseMetadataEvent,
  SseTokenEvent,
  SseReferenceItem,
  SseDoneEvent,
  SseErrorEvent,
  SseEventType,
} from '../types/chat'

/** SSE 事件回调 */
export interface SseCallbacks {
  onMetadata?: (data: SseMetadataEvent) => void
  onToken?: (data: SseTokenEvent) => void
  onReferences?: (data: SseReferenceItem[]) => void
  onDone?: (data: SseDoneEvent) => void
  onError?: (data: SseErrorEvent) => void
  onNetworkError?: (error: Error) => void
}

interface SseFrame {
  event: string
  data: string
}

/** 发送 SSE 聊天请求 */
export async function fetchSseChat(
  url: string,
  body: unknown,
  callbacks: SseCallbacks,
  abortSignal: AbortSignal,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal,
    })
  } catch (error: unknown) {
    if (abortSignal.aborted) {
      return // 用户主动中止，不回调
    }
    callbacks.onNetworkError?.(
      error instanceof Error ? error : new Error('网络请求失败'),
    )
    return
  }

  // HTTP 错误状态码（非 200）— 解析后端统一错误结构
  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    let details: unknown

    try {
      const errorBody = await response.json()
      if (typeof errorBody?.message === 'string') {
        message = errorBody.message
      }
      details = errorBody?.details
    } catch {
      // 响应体不是 JSON，使用默认消息
    }

    callbacks.onNetworkError?.(
      new ApiError(message, { status: response.status, details }),
    )
    return
  }

  // 解析 SSE 流
  if (response.body === null) {
    callbacks.onNetworkError?.(new Error('SSE 响应体为空'))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      // 将 Uint8Array 解码为字符串，追加到缓冲区
      buffer += decoder.decode(value, { stream: true })

      // SSE 帧以 \n\n 分隔
      const frames = buffer.split('\n\n')
      // 最后一段可能不完整，保留在缓冲区
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const parsed = parseSseFrame(frame)

        if (parsed !== null) {
          dispatchSseEvent(parsed, callbacks)
        }
      }
    }

    // 处理缓冲区中剩余的数据
    if (buffer.length > 0) {
      const parsed = parseSseFrame(buffer)

      if (parsed !== null) {
        dispatchSseEvent(parsed, callbacks)
      }
    }
  } catch (error: unknown) {
    if (abortSignal.aborted) {
      return // 用户主动中止
    }
    callbacks.onNetworkError?.(
      error instanceof Error ? error : new Error('SSE 流读取失败'),
    )
  } finally {
    reader.releaseLock()
  }
}

/** 解析单个 SSE 帧 */
function parseSseFrame(frame: string): SseFrame | null {
  const lines = frame.split('\n')
  let event = ''
  let dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5))
    }
    // 忽略空行和注释行（以 : 开头）
  }

  if (event === '' || dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join('\n'),
  }
}

/** 分发 SSE 事件到回调 */
function dispatchSseEvent(
  frame: SseFrame,
  callbacks: SseCallbacks,
): void {
  const eventType = frame.event as SseEventType

  try {
    switch (eventType) {
      case 'metadata': {
        const data = JSON.parse(frame.data) as SseMetadataEvent
        callbacks.onMetadata?.(data)
        break
      }
      case 'token': {
        const data = JSON.parse(frame.data) as SseTokenEvent
        callbacks.onToken?.(data)
        break
      }
      case 'references': {
        const data = JSON.parse(frame.data) as SseReferenceItem[]
        callbacks.onReferences?.(data)
        break
      }
      case 'done': {
        const data = JSON.parse(frame.data) as SseDoneEvent
        callbacks.onDone?.(data)
        break
      }
      case 'error': {
        const data = JSON.parse(frame.data) as SseErrorEvent
        callbacks.onError?.(data)
        break
      }
    }
  } catch {
    // JSON 解析失败，忽略该帧
  }
}
```

### 6.3 `web/src/api/chat.ts`（新建）— 聊天 SSE 请求封装

```typescript
import { fetchSseChat } from './sse'
import type { SseCallbacks } from './sse'
import type { ChatRequestParams } from '../types/chat'

/** POST /api/knowledge-bases/:id/chat — SSE 流式问答 */
export async function sendChatMessage(
  knowledgeBaseId: number,
  params: ChatRequestParams,
  callbacks: SseCallbacks,
  abortSignal: AbortSignal,
): Promise<void> {
  const url = `/api/knowledge-bases/${knowledgeBaseId}/chat`
  await fetchSseChat(url, params, callbacks, abortSignal)
}
```

> **注意**：SSE 请求不走 Axios 实例——Axios 不支持 `ReadableStream` 响应体的流式读取。使用原生 `fetch`，URL 为相对路径 `/api/...`，Vite proxy 和 Nginx 反代会正常转发。`ApiError` 从 `http.ts` 导入以保持错误类型一致。

---

## 七、SSE 客户端设计（设计问题 1、2、3）

### 7.1 为什么不用 EventSource（设计问题 1）

`EventSource` API 只支持 GET 请求，无法携带 POST body（`question`、`conversationId` 等参数）。T11 的 SSE 接口是 `POST /api/knowledge-bases/:id/chat`，必须用 `fetch` POST + `ReadableStream` 解析。

### 7.2 fetch + ReadableStream 流式解析（设计问题 2）

**核心流程**：

```
fetch(POST) → response.body.getReader() → 循环 reader.read()
  → TextDecoder 解码 → 按 \n\n 分帧 → 解析 event:/data: 行
  → JSON.parse(data) → 分发到回调
```

**关键代码结构**见 §六.2 `fetchSseChat()`。

### 7.3 SSE 半包、粘包和多行 data 处理（设计问题 3）

| 问题 | 场景 | 解决方案 |
|---|---|---|
| **半包** | 一次 `reader.read()` 返回的数据可能只包含半个 SSE 帧（如 `event: tok`，剩余 `en\ndata: {...}\n\n` 在下次 read） | 用 `buffer` 累积未完成的帧，只在 `\n\n` 分隔时处理完整帧；`frames.pop()` 保留最后一段不完整数据等待下次拼接 |
| **粘包** | 一次 `reader.read()` 可能返回多个完整帧（如 `event: token\ndata: {"delta":"a"}\n\nevent: token\ndata: {"delta":"b"}\n\n`） | `buffer.split('\n\n')` 拆分为多个完整帧，逐个处理 |
| **多行 data** | 标准允许 `data:` 行跨多行（每行一个 `data:` 前缀，最终用 `\n` 拼接） | `parseSseFrame()` 收集所有 `data:` 行，用 `\n` 拼接后再 `JSON.parse()`。T11 后端每帧只有一行 `data:`，但前端仍按标准处理多行情况 |
| **TextDecoder stream 模式** | `decoder.decode(value, { stream: true })` 确保多字节 UTF-8 字符跨 chunk 时不乱码 | 在 `decode()` 调用时传入 `{ stream: true }`，最后一次 `decode()` 不带 `stream` 选项（或传 `false`）以刷新 |
| **缓冲区残留** | 流结束后 `buffer` 可能仍有未处理的残数据 | 循环结束后检查 `buffer.length > 0`，尝试解析最后一帧 |

### 7.4 流程图

```
┌──────────┐     ┌──────────────┐     ┌────────────────┐
│  fetch   │────▶│ reader.read() │────▶│ TextDecoder    │
│  POST    │     │ (Uint8Array)  │     │ → string       │
└──────────┘     └──────────────┘     └───────┬────────┘
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │ buffer += str  │
                                     └───────┬────────┘
                                              │
                                              ▼
                                     ┌────────────────────┐
                                     │ split('\n\n')      │
                                     │ frames = 完整帧[]  │
                                     │ buffer = 残留      │
                                     └───────┬────────────┘
                                              │
                                     ┌────────┴────────┐
                                     ▼                 ▼
                              ┌─────────────┐   ┌──────────┐
                              │ parseFrame  │   │ 等待下次  │
                              │ event:/data:│   │ read()   │
                              └──────┬──────┘   └──────────┘
                                     │
                                     ▼
                              ┌─────────────┐
                              │ JSON.parse  │
                              │ → 回调分发   │
                              └─────────────┘
```

---

## 八、路由设计

### 8.1 修改 `web/src/router/index.ts`

将 `chat-placeholder` 路由替换为真实聊天页：

```typescript
{
  path: '/knowledge-bases/:id/chat',
  name: 'chat',
  component: () => import('../views/ChatView.vue'),
  props: (route) => ({
    knowledgeBaseId: Number(route.params.id),
    conversationId: route.query.conversationId
      ? Number(route.query.conversationId)
      : undefined,
  }),
}
```

### 8.2 路由说明

| 路由 | 名称 | 组件 | 说明 |
|---|---|---|---|
| `/knowledge-bases/:id/chat` | `chat` | `ChatView.vue` | 无 `conversationId` 时显示空状态 |
| `/knowledge-bases/:id/chat?conversationId=N` | `chat` | `ChatView.vue` | 加载指定会话的消息历史 |

### 8.3 conversationId 通过 query param 传递

**决策**：使用 `?conversationId=N` query param 而非路由路径参数。

**理由**：
1. 总体方案 §8 只规划了 `/knowledge-bases/:id/chat` 一条路由，不额外新增路径段；
2. query param 可选性强——无参数时进入空状态，有参数时加载会话；
3. `router.replace({ query: { conversationId } })` 不创建新的历史记录，避免回退到"无会话"状态。

### 8.4 删除 ChatPlaceholderView

`web/src/views/ChatPlaceholderView.vue` 在 T13 中删除，不再使用。

---

## 九、客户端主动中止请求（设计问题 4）

### 9.1 AbortController 方案

```typescript
// useChat composable 中
let abortController: AbortController | null = null

function sendMessage(question: string): void {
  abortController = new AbortController()

  sendChatMessage(
    knowledgeBaseId,
    { question, conversationId: currentConversationId.value },
    {
      onMetadata: (data) => { /* ... */ },
      onToken: (data) => { /* ... */ },
      onReferences: (data) => { /* ... */ },
      onDone: (data) => { /* ... */ },
      onError: (data) => { /* ... */ },
      onNetworkError: (error) => { /* ... */ },
    },
    abortController.signal,
  )
}

function stopGeneration(): void {
  if (abortController !== null) {
    abortController.abort()
    abortController = null
  }
}
```

### 9.2 中止后的行为

| 中止时机 | 前端行为 | 后端行为 |
|---|---|---|
| fetch 已发送，未收到 metadata | `onNetworkError` 不回调（aborted 信号检测），状态回到 `idle` | 后端 `req.on('close')` 触发 abort，用户消息已保存 |
| 生成中（收到 token） | 停止追加 token，状态改为 `aborted`，保留已生成内容 | 后端 abort LLM 请求，保存已生成部分为 `failed` 消息 |
| done/error 事件收到后 | 中止无效（请求已完成） | — |

### 9.3 中止后消息状态

中止后前端将当前流式消息标记为 `aborted` 状态，保留已显示的内容。下次刷新页面时从后端加载历史消息，该消息会显示为 `failed`（后端已保存为 failed）。

### 9.4 组件卸载时中止

```typescript
onUnmounted(() => {
  stopGeneration()
})
```

切换会话或离开页面时，如果有正在进行的生成，自动中止。

---

## 十、消息发送期间防止重复提交（设计问题 5）

### 10.1 状态门控

```typescript
const generationStatus = ref<ChatGenerationStatus>('idle')

const canSend = computed(() => {
  const status = generationStatus.value
  return status === 'idle' || status === 'completed' || status === 'error' || status === 'aborted'
})
```

### 10.2 UI 禁用

- 发送按钮 `:disabled="!canSend || !inputText.trim()"`
- 输入框 `:disabled="generationStatus === 'connecting' || generationStatus === 'generating'"`
- 生成中显示"停止生成"按钮替代"发送"按钮

### 10.3 防重复流程

```
用户输入问题 → 点击发送
  ↓
canSend === true?
  ├─ 否 → 忽略（按钮已 disabled，此分支不应到达）
  └─ 是 → status = 'connecting'
         → 清空输入框
         → 创建 AbortController
         → 发起 fetchSseChat
         → 收到 metadata → status = 'generating'
         → 收到 done → status = 'completed'
         → 收到 error → status = 'error'
         → 用户点击停止 → abortController.abort() → status = 'aborted'
```

---

## 十一、流式消息增量更新（设计问题 6）

### 11.1 响应式追加

```typescript
const messages = ref<ChatMessageItem[]>([])

// 收到 token 事件
function handleToken(data: SseTokenEvent): void {
  const lastMessage = messages.value[messages.value - 1]

  if (lastMessage !== undefined && lastMessage.role === 'assistant' && lastMessage.status === 'streaming') {
    // 追加到当前流式消息
    lastMessage.content += data.delta
  }
}
```

### 11.2 消息生命周期

```
1. 用户发送问题
   → messages.push({ id: null, role: 'user', content: question, status: 'completed', ... })
   → messages.push({ id: null, role: 'assistant', content: '', status: 'streaming', references: [], ... })

2. 收到 metadata
   → 更新 conversationId（如果是新会话）
   → 更新 user message 的 id

3. 收到 token
   → 追加 delta 到最后一条 assistant 消息的 content

4. 收到 references
   → 设置最后一条 assistant 消息的 references

5. 收到 done
   → 设置 assistant 消息的 id = assistantMessageId
   → 设置 status = 'completed'

6. 收到 error
   → 设置 assistant 消息的 status = 'failed'
   → 设置 errorMessage

7. 用户中止
   → 设置 assistant 消息的 status = 'aborted'（自定义状态，仅前端）
   → 保留已生成内容
```

### 11.3 Vue 响应式注意事项

使用 `ref<ChatMessageItem[]>` 时，直接修改数组元素的属性（如 `lastMessage.content += delta`）会触发 Vue 响应式更新，因为 `ref` 包装的是 `reactive` 数组。

如果遇到响应式失效问题（Vue 3 某些边缘情况），可使用 `messages.value = [...messages.value]` 强制触发更新，但通常不需要。

---

## 十二、references 与助手消息的绑定（设计问题 7）

### 12.1 绑定时机

`references` 事件在所有 `token` 事件之后、`done` 事件之前发送。前端在收到 `references` 事件时，将引用数据设置到当前流式助手消息上。

### 12.2 数据结构映射

SSE `references` 事件中的 `SseReferenceItem` 与消息历史 API 返回的 `MessageReference` 字段略有不同：

| SSE references 事件 | 消息历史 API | 差异 |
|---|---|---|
| `chunkId` | `chunkId` | 相同 |
| `documentId` | `documentId` | 相同 |
| `documentName` | `documentName` | 相同 |
| `pageNo` | `pageNo` | 相同 |
| `content` | `contentSnapshot` | **字段名不同**：SSE 用 `content`，历史 API 用 `contentSnapshot` |
| `score` | `score` | 相同 |
| — | `chunkIndex` | SSE 事件中无 `chunkIndex`，历史 API 有 |

### 12.3 统一处理

`ChatMessageItem.references` 类型为 `MessageReference[] | SseReferenceItem[]`，组件渲染时统一处理：

```typescript
// 在 ReferencePanel 组件中统一访问
function getContent(ref: MessageReference | SseReferenceItem): string {
  return 'contentSnapshot' in ref ? ref.contentSnapshot : ref.content
}
```

### 12.4 刷新后一致性

页面刷新后从 `GET /api/conversations/:id/messages` 加载历史消息，引用数据为 `MessageReference[]`（含 `chunkIndex` 和 `contentSnapshot`），字段更完整。流式生成中的引用为 `SseReferenceItem[]`（含 `content`），字段较少但足够展示。

---

## 十三、新会话 conversationId 获取和路由同步（设计问题 8）

### 13.1 流程

```
1. 用户在聊天页输入问题，此时 URL 无 conversationId query param
2. 点击发送 → 调用 sendChatMessage(kbId, { question }, ...)
3. 后端创建新会话，返回 metadata 事件 { conversationId, userMessageId }
4. 前端收到 metadata 事件：
   a. 设置 currentConversationId = data.conversationId
   b. router.replace({ query: { conversationId: data.conversationId } })
   c. 刷新会话列表（新会话出现在列表中）
5. 后续 token/references/done 事件正常处理
```

### 13.2 router.replace 而非 router.push

使用 `replace` 不创建新的历史记录——避免用户点"回退"时回到"无会话"状态。用户回退应直接回到知识库详情页。

### 13.3 继续已有会话

用户从会话列表选择一个已有会话：

```
1. 点击会话列表项
2. router.replace({ query: { conversationId: id } })
3. ChatView 的 watch(conversationId) 触发
4. 调用 GET /api/conversations/:id/messages 加载历史消息
5. messages.value = historyMessages
```

### 13.4 发送消息时带上 conversationId

```typescript
function sendMessage(question: string): void {
  const params: ChatRequestParams = { question }

  if (currentConversationId.value !== undefined) {
    params.conversationId = currentConversationId.value
  }

  // ... 发起 SSE 请求
}
```

---

## 十四、会话列表刷新策略（设计问题 9）

### 14.1 刷新时机

| 时机 | 方式 | 说明 |
|---|---|---|
| 页面加载 | `onMounted` | 加载当前知识库的会话列表 |
| 新会话创建后 | metadata 事件回调 | 新会话出现在列表顶部 |
| 消息生成完成后 | done/error 事件回调 | 更新会话的 `updatedAt` 排序 |
| 删除会话后 | deleteConversation 成功后 | 从列表中移除 |
| 知识库 ID 变化 | `watch(knowledgeBaseId)` | 切换知识库时重新加载 |

### 14.2 不做轮询

会话列表不需要轮询——只在有用户操作（发消息、删会话）后刷新。没有人操作时列表不会变化。

### 14.3 当前会话高亮

```typescript
const currentConversationId = ref<number | undefined>(undefined)

// 会话列表中高亮当前会话
function isActive(conversation: Conversation): boolean {
  return conversation.id === currentConversationId.value
}
```

### 14.4 新建会话按钮

会话列表顶部有"新建会话"按钮，点击后：
1. `currentConversationId = undefined`
2. `router.replace({ query: {} })`（清除 conversationId）
3. `messages = []`（清空消息区域）
4. 显示"输入问题开始新对话"的空状态

---

## 十五、引用折叠、展开和跳转交互（设计问题 10）

### 15.1 引用面板位置

引用面板显示在助手消息气泡下方，默认折叠。

### 15.2 折叠/展开

```
┌─────────────────────────────────────────┐
│ 助手回答内容...                           │
│ RAG 是检索增强生成，通过检索相关文档...      │
│                                          │
│ 📎 引用来源 (3)                    [展开 ▼] │
└─────────────────────────────────────────┘

点击展开后：
┌─────────────────────────────────────────┐
│ 助手回答内容...                           │
│                                          │
│ 📎 引用来源 (3)                    [收起 ▲] │
│ ┌─────────────────────────────────────┐ │
│ │ [1] rag-intro.txt    页码: -   1.00  │ │
│ │ 内容快照: RAG is retrieval...        │ │
│ ├─────────────────────────────────────┤ │
│ │ [2] 产品手册.pdf     页码: 12  0.87  │ │
│ │ 内容快照: 第三章 RAG 架构...          │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 15.3 引用项展示

每条引用展示：
- **序号**：`[1]`、`[2]`...（按 score 降序）
- **文档名称**：`documentName`
- **页码**：`pageNo` 为 `null` 时显示 `-`（MD/TXT 无页码）
- **相似度**：`score`，格式化为百分比 `(score * 100).toFixed(1) + '%'`
- **内容快照**：`contentSnapshot`（或 SSE 的 `content`），默认折叠，点击展开

### 15.4 不跳转到文档原文

引用快照已包含内容，不需要跳转到文档原文页面。用户禁止"修改后端业务逻辑"，文档详情接口虽存在但不是本阶段重点。

### 15.5 空引用

`references` 事件为空数组 `[]` 时，不显示引用面板。

### 15.6 实现方式

使用 Ant Design Vue `Collapse` 组件或自定义 `v-show` 切换：

```vue
<div v-if="message.references.length > 0" class="reference-panel">
  <button class="reference-toggle" @click="toggleReferences">
    📎 引用来源 ({{ message.references.length }})
    {{ showReferences ? '收起 ▲' : '展开 ▼' }}
  </button>
  <div v-show="showReferences" class="reference-list">
    <!-- 引用项列表 -->
  </div>
</div>
```

---

## 十六、TypeScript 类型和组件拆分（设计问题 11）

### 16.1 文件结构

```
web/src/
├── api/
│   ├── http.ts                    # 不修改
│   ├── knowledge-base.ts          # 不修改
│   ├── document.ts                # 不修改
│   ├── conversation.ts            # 新建
│   ├── chat.ts                    # 新建
│   └── sse.ts                     # 新建
├── types/
│   ├── health.ts                  # 不修改
│   ├── knowledge-base.ts          # 不修改
│   ├── document.ts                # 不修改
│   ├── conversation.ts            # 新建
│   └── chat.ts                    # 新建
├── composables/
│   ├── use-knowledge-bases.ts     # 不修改
│   ├── use-documents.ts           # 不修改
│   ├── use-chat.ts                # 新建
│   └── use-conversations.ts       # 新建
├── views/
│   ├── ChatView.vue               # 新建（替换 ChatPlaceholderView）
│   └── ...                        # 其他不修改
├── components/
│   ├── ConversationList.vue       # 新建
│   ├── MessageList.vue            # 新建
│   ├── MessageBubble.vue          # 新建
│   ├── ReferencePanel.vue         # 新建
│   └── ChatInput.vue              # 新建
├── router/
│   └── index.ts                   # 修改（替换 chat 路由）
└── ...                            # 其他不修改
```

### 16.2 组件职责

| 组件 / 页面 | 职责 | Props | Emits |
|---|---|---|---|
| `ChatView` | 聊天页主容器：左侧会话列表 + 右侧消息区 + 底部输入 | `knowledgeBaseId: number`, `conversationId?: number` | — |
| `ConversationList` | 会话列表侧边栏：新建会话、切换会话、删除会话 | `knowledgeBaseId: number`, `currentConversationId?: number` | `select`, `new`, `deleted` |
| `MessageList` | 消息区域：渲染消息列表，自动滚动到底部 | `messages: ChatMessageItem[]`, `status: ChatGenerationStatus` | — |
| `MessageBubble` | 单条消息气泡：区分 user/assistant，展示内容和引用 | `message: ChatMessageItem` | — |
| `ReferencePanel` | 引用面板：折叠/展开，展示引用项列表 | `references: (MessageReference \| SseReferenceItem)[]` | — |
| `ChatInput` | 输入区域：文本框 + 发送/停止按钮 | `status: ChatGenerationStatus` | `send`, `stop` |

### 16.3 Composable 职责

| Composable | 职责 | 返回 |
|---|---|---|
| `useChat(knowledgeBaseId, conversationId)` | 聊天核心逻辑：发送消息、SSE 流式处理、中止、消息列表管理 | `{ messages, generationStatus, currentConversationId, sendMessage, stopGeneration, loadHistory }` |
| `useConversations(knowledgeBaseId)` | 会话列表管理：加载列表、删除会话、刷新 | `{ conversations, loading, error, fetchList, remove, refresh }` |

---

## 十七、移动端和基础响应式布局（设计问题 12）

### 17.1 断点设计

| 断点 | 布局 | 说明 |
|---|---|---|
| `> 768px` | 左右分栏：左侧会话列表（固定 260px）+ 右侧消息区 | 桌面端默认布局 |
| `≤ 768px` | 单栏 + Drawer：会话列表收起为 Drawer，消息区全屏 | 移动端布局 |

### 17.2 桌面端布局

```
┌──────────────────────────────────────────────────────────────┐
│ ← 返回详情  知识库名称                                        │
├──────────────┬───────────────────────────────────────────────┤
│ 会话列表      │ 消息区域                                      │
│ (260px)      │                                               │
│              │  ┌─────────────────────────────────────────┐  │
│ [+ 新建会话]  │  │ user: 什么是 RAG?                      │  │
│              │  └─────────────────────────────────────────┘  │
│ ▸ 会话 1     │  ┌─────────────────────────────────────────┐  │
│   会话 2     │  │ assistant: RAG 是检索增强生成...         │  │
│   会话 3     │  │ 📎 引用来源 (2) [展开 ▼]               │  │
│              │  └─────────────────────────────────────────┘  │
│              │                                               │
│              │  ┌─────────────────────────────────────────┐  │
│              │  │ 输入问题...                    [发送]   │  │
│              │  └─────────────────────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────┘
```

### 17.3 移动端布局

```
┌──────────────────────────────────────────┐
│ ←  [☰]  知识库名称                       │
├──────────────────────────────────────────┤
│                                          │
│  消息区域（全屏）                         │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ user: 什么是 RAG?                  │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │ assistant: RAG 是检索增强生成...   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 输入问题...               [发送]   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘

点击 ☞ 打开 Drawer：
┌──────────────┐
│ 会话列表      │
│ [+ 新建会话]  │
│ ▸ 会话 1     │
│   会话 2     │
│   会话 3     │
└──────────────┘
```

### 17.4 实现方式

- 使用 CSS `@media (max-width: 768px)` 断点
- 会话列表在移动端用 Ant Design Vue `Drawer` 组件包裹
- 消息区域使用 `flex: 1` 自适应宽度
- 输入框在移动端占满宽度

### 17.5 App.vue 已有响应式

App.vue 已有 `@media (max-width: 640px)` 的 Header 响应式处理。T13 的聊天页内部使用自己的 `@media (max-width: 768px)` 断点，与 App.vue 的断点不冲突。

---

## 十八、ChatView 页面规格

### 18.1 页面结构

```vue
<script setup lang="ts">
import { ref, watch, toRef } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Drawer } from 'ant-design-vue'
import ConversationList from '../components/ConversationList.vue'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'
import { useChat } from '../composables/use-chat'
import { useConversations } from '../composables/use-conversations'
import { getKnowledgeBase } from '../api/knowledge-base'
import { ApiError } from '../api/http'
import type { KnowledgeBase } from '../types/knowledge-base'

const props = defineProps<{
  knowledgeBaseId: number
  conversationId?: number
}>()

const router = useRouter()

// 知识库信息
const knowledgeBase = ref<KnowledgeBase | null>(null)
const kbLoading = ref(true)
const kbError = ref('')

// 会话列表
const {
  conversations,
  loading: conversationsLoading,
  error: conversationsError,
  fetchList: fetchConversations,
  remove: removeConversation,
  refresh: refreshConversations,
} = useConversations(toRef(props, 'knowledgeBaseId'))

// 聊天核心
const {
  messages,
  generationStatus,
  currentConversationId,
  sendMessage,
  stopGeneration,
  loadHistory,
} = useChat(toRef(props, 'knowledgeBaseId'), toRef(props, 'conversationId'))

// 移动端 Drawer
const drawerVisible = ref(false)

// 加载知识库信息
async function fetchKnowledgeBase(): Promise<void> {
  kbLoading.value = true
  kbError.value = ''
  try {
    knowledgeBase.value = await getKnowledgeBase(props.knowledgeBaseId)
  } catch (error: unknown) {
    kbError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    kbLoading.value = false
  }
}

// 监听 conversationId 变化（路由 query param 变化）
watch(
  () => props.conversationId,
  (newId) => {
    if (newId !== undefined && newId > 0) {
      void loadHistory(newId)
    }
  },
  { immediate: true },
)

// 监听 knowledgeBaseId 变化
watch(
  () => props.knowledgeBaseId,
  () => {
    void fetchKnowledgeBase()
  },
  { immediate: true },
)

function backToDetail(): void {
  void router.push(`/knowledge-bases/${props.knowledgeBaseId}`)
}

function handleSelectConversation(id: number): void {
  void router.replace({
    query: { conversationId: id },
  })
  drawerVisible.value = false
}

function handleNewConversation(): void {
  void router.replace({ query: {} })
  drawerVisible.value = false
}

async function handleDeleteConversation(id: number): Promise<void> {
  await removeConversation(id)
  // 如果删除的是当前会话，回到新会话状态
  if (id === currentConversationId.value) {
    void router.replace({ query: {} })
  }
}

function handleSend(question: string): void {
  sendMessage(question, async () => {
    await refreshConversations()
  })
}
</script>
```

### 18.2 模板结构

```vue
<template>
  <div class="chat-page">
    <!-- 顶部导航 -->
    <div class="chat-header">
      <Button @click="backToDetail">← 返回</Button>
      <Button class="drawer-toggle" @click="drawerVisible = true">
        ☰
      </Button>
      <span class="chat-title">
        {{ knowledgeBase?.name ?? '加载中...' }}
      </span>
    </div>

    <!-- 主体区域 -->
    <div class="chat-body">
      <!-- 左侧会话列表（桌面端） -->
      <aside class="chat-sidebar">
        <ConversationList
          :knowledge-base-id="knowledgeBaseId"
          :current-conversation-id="currentConversationId"
          :conversations="conversations"
          :loading="conversationsLoading"
          :error="conversationsError"
          @select="handleSelectConversation"
          @new="handleNewConversation"
          @delete="handleDeleteConversation"
        />
      </aside>

      <!-- 右侧消息区 -->
      <main class="chat-main">
        <MessageList
          :messages="messages"
          :status="generationStatus"
        />
        <ChatInput
          :status="generationStatus"
          @send="handleSend"
          @stop="stopGeneration"
        />
      </main>
    </div>

    <!-- 移动端 Drawer -->
    <Drawer
      v-model:open="drawerVisible"
      placement="left"
      title="会话列表"
      :width="280"
    >
      <ConversationList
        :knowledge-base-id="knowledgeBaseId"
        :current-conversation-id="currentConversationId"
        :conversations="conversations"
        :loading="conversationsLoading"
        :error="conversationsError"
        @select="handleSelectConversation"
        @new="handleNewConversation"
        @delete="handleDeleteConversation"
      />
    </Drawer>
  </div>
</template>
```

---

## 十九、useChat composable 规格

### 19.1 完整实现

```typescript
// web/src/composables/use-chat.ts
import { ref, onUnmounted, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { sendChatMessage } from '../api/chat'
import { listMessages } from '../api/conversation'
import { ApiError } from '../api/http'
import type {
  ChatMessageItem,
  ChatGenerationStatus,
  SseMetadataEvent,
  SseTokenEvent,
  SseReferenceItem,
  SseDoneEvent,
  SseErrorEvent,
} from '../types/chat'
import type { ChatMessageData } from '../types/conversation'

export function useChat(
  knowledgeBaseId: Ref<number>,
  conversationId: Ref<number | undefined>,
) {
  const router = useRouter()
  const messages = ref<ChatMessageItem[]>([])
  const generationStatus = ref<ChatGenerationStatus>('idle')
  const currentConversationId = ref<number | undefined>(conversationId.value)
  let abortController: AbortController | null = null

  async function loadHistory(convId: number): Promise<void> {
    try {
      const history = await listMessages(convId)
      messages.value = history.map(mapHistoryToItem)
      currentConversationId.value = convId
    } catch {
      messages.value = []
    }
  }

  function sendMessage(
    question: string,
    onComplete?: () => Promise<void>,
  ): void {
    if (generationStatus.value === 'connecting' || generationStatus.value === 'generating') {
      return
    }

    generationStatus.value = 'connecting'

    // 添加用户消息和空的助手消息
    const userMessage: ChatMessageItem = {
      id: null,
      role: 'user',
      content: question,
      status: 'completed',
      errorMessage: null,
      references: [],
      createdAt: new Date().toISOString(),
    }
    const assistantMessage: ChatMessageItem = {
      id: null,
      role: 'assistant',
      content: '',
      status: 'streaming',
      errorMessage: null,
      references: [],
      createdAt: null,
    }
    messages.value.push(userMessage, assistantMessage)

    abortController = new AbortController()

    const params = { question }
    if (currentConversationId.value !== undefined) {
      params.conversationId = currentConversationId.value
    }

    sendChatMessage(
      knowledgeBaseId.value,
      params,
      {
        onMetadata: (data: SseMetadataEvent) => {
          generationStatus.value = 'generating'
          currentConversationId.value = data.conversationId

          // 如果是新会话，同步到 URL
          if (conversationId.value === undefined) {
            void router.replace({
              query: { conversationId: data.conversationId },
            })
          }

          // 更新用户消息的 id
          const lastUserMessage = findLastUserMessage()
          if (lastUserMessage !== null) {
            lastUserMessage.id = data.userMessageId
          }
        },
        onToken: (data: SseTokenEvent) => {
          const lastAssistant = findLastStreamingAssistant()
          if (lastAssistant !== null) {
            lastAssistant.content += data.delta
          }
        },
        onReferences: (data: SseReferenceItem[]) => {
          const lastAssistant = findLastStreamingAssistant()
          if (lastAssistant !== null) {
            lastAssistant.references = data
          }
        },
        onDone: (data: SseDoneEvent) => {
          const lastAssistant = findLastStreamingAssistant()
          if (lastAssistant !== null) {
            lastAssistant.id = data.assistantMessageId
            lastAssistant.status = 'completed'
          }
          generationStatus.value = 'completed'
          abortController = null
          void onComplete?.()
        },
        onError: (data: SseErrorEvent) => {
          const lastAssistant = findLastStreamingAssistant()
          if (lastAssistant !== null) {
            lastAssistant.status = 'failed'
            lastAssistant.errorMessage = data.message
          }
          generationStatus.value = 'error'
          abortController = null
          void onComplete?.()
        },
        onNetworkError: (error: Error) => {
          const lastAssistant = findLastStreamingAssistant()
          if (lastAssistant !== null) {
            lastAssistant.status = 'failed'
            lastAssistant.errorMessage = error instanceof ApiError
              ? error.message
              : '网络连接失败'
          }
          generationStatus.value = 'error'
          abortController = null
        },
      },
      abortController.signal,
    )
  }

  function stopGeneration(): void {
    if (abortController !== null) {
      abortController.abort()
      abortController = null

      const lastAssistant = findLastStreamingAssistant()
      if (lastAssistant !== null) {
        lastAssistant.status = 'completed'
        // 保留已生成的内容，但标记为不完整
        if (lastAssistant.content.length === 0) {
          // 如果没有任何内容，移除空的助手消息
          messages.value = messages.value.slice(0, -1)
        }
      }
      generationStatus.value = 'aborted'
    }
  }

  function findLastStreamingAssistant(): ChatMessageItem | null {
    const last = messages.value[messages.value.length - 1]
    if (last !== undefined && last.role === 'assistant' && last.status === 'streaming') {
      return last
    }
    return null
  }

  function findLastUserMessage(): ChatMessageItem | null {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        return messages.value[i]
      }
    }
    return null
  }

  onUnmounted(() => {
    stopGeneration()
  })

  return {
    messages,
    generationStatus,
    currentConversationId,
    sendMessage,
    stopGeneration,
    loadHistory,
  }
}

function mapHistoryToItem(msg: ChatMessageData): ChatMessageItem {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    status: msg.status,
    errorMessage: msg.errorMessage,
    references: msg.references,
    createdAt: msg.createdAt,
  }
}
```

---

## 二十、useConversations composable 规格

```typescript
// web/src/composables/use-conversations.ts
import { ref, watch, onMounted, type Ref } from 'vue'
import {
  listConversations,
  deleteConversation,
} from '../api/conversation'
import type { Conversation } from '../types/conversation'

export function useConversations(knowledgeBaseId: Ref<number>) {
  const conversations = ref<Conversation[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchList(): Promise<void> {
    if (knowledgeBaseId.value <= 0) {
      conversations.value = []
      return
    }

    loading.value = true
    error.value = ''

    try {
      conversations.value = await listConversations(knowledgeBaseId.value)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '加载会话列表失败'
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    try {
      conversations.value = await listConversations(knowledgeBaseId.value)
    } catch {
      // 静默刷新失败
    }
  }

  async function remove(id: number): Promise<void> {
    await deleteConversation(id)
    await fetchList()
  }

  watch(knowledgeBaseId, () => {
    void fetchList()
  }, { immediate: true })

  return {
    conversations,
    loading,
    error,
    fetchList,
    refresh,
    remove,
  }
}
```

---

## 二十一、ConversationList 组件规格

### 21.1 Props / Emits

```typescript
defineProps<{
  knowledgeBaseId: number
  currentConversationId?: number
  conversations: Conversation[]
  loading: boolean
  error: string
}>()

defineEmits<{
  select: [id: number]
  new: []
  delete: [id: number]
}>()
```

### 21.2 结构

```
┌──────────────────────────┐
│ [+ 新建会话]              │
├──────────────────────────┤
│ Loading... / Error...    │
│                          │
│ ▸ 会话标题 1     [删]     │  ← 高亮当前会话
│   会话标题 2     [删]     │
│   会话标题 3     [删]     │
│                          │
│ Empty: "暂无会话"         │
└──────────────────────────┘
```

### 21.3 会话项展示

- 标题：`conversation.title`（截断显示，溢出省略号）
- 时间：`formatDateTime(conversation.updatedAt)`
- 删除按钮：Popconfirm 确认
- 当前会话高亮：背景色区分

### 21.4 空状态

会话列表为空时显示 "暂无会话，点击上方创建"。

---

## 二十二、MessageList 组件规格

### 22.1 Props

```typescript
defineProps<{
  messages: ChatMessageItem[]
  status: ChatGenerationStatus
}>()
```

### 22.2 自动滚动

```typescript
import { ref, watch, nextTick } from 'vue'

const scrollContainer = ref<HTMLElement>()

watch(
  () => props.messages,
  () => {
    void nextTick(() => {
      if (scrollContainer.value !== undefined) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  },
  { deep: true },
)
```

### 22.3 空状态

`messages.length === 0` 时显示空状态："输入问题开始对话"。

### 22.4 生成中状态

`status === 'connecting'` 或 `status === 'generating'` 时，最后一条 assistant 消息显示 typing 指示器（三个跳动的点）。

### 22.5 消息排列

消息按时间正序排列（从上到下），用户消息右对齐，助手消息左对齐。

---

## 二十三、MessageBubble 组件规格

### 23.1 Props

```typescript
defineProps<{
  message: ChatMessageItem
}>()
```

### 23.2 布局

```
user 消息（右对齐）：
                              ┌──────────────────┐
                              │ 什么是 RAG?       │
                              └──────────────────┘

assistant 消息（左对齐）：
┌──────────────────────────────────────────┐
│ RAG 是检索增强生成，通过检索相关文档...     │
│                                            │
│ 📎 引用来源 (2)              [展开 ▼]      │
└──────────────────────────────────────────┘

failed 消息：
┌──────────────────────────────────────────┐
│ ⚠ 回答生成失败                            │
│ 问答服务暂时不可用：模型调用失败            │
│ （已生成的部分内容...）                     │
└──────────────────────────────────────────┘
```

### 23.3 状态处理

| status | 展示 |
|---|---|
| `streaming` | 内容 + typing 指示器（如果 content 为空） |
| `completed` | 内容 + 引用面板（如果有引用） |
| `failed` | 错误提示 + 已生成内容（如果有） |

### 23.4 引用面板

`message.references.length > 0` 且 `message.status === 'completed'` 时，在消息气泡下方渲染 `ReferencePanel` 组件。

---

## 二十四、ReferencePanel 组件规格

### 24.1 Props

```typescript
defineProps<{
  references: (MessageReference | SseReferenceItem)[]
}>()
```

### 24.2 展示

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { MessageReference, SseReferenceItem } from '../types/conversation'
import type { SseReferenceItem as SseRef } from '../types/chat'

const props = defineProps<{
  references: (MessageReference | SseRef)[]
}>()

const expanded = ref(false)
const expandedItems = ref<Set<number>>(new Set())

function toggle(): void {
  expanded.value = !expanded.value
}

function toggleItem(index: number): void {
  if (expandedItems.value.has(index)) {
    expandedItems.value.delete(index)
  } else {
    expandedItems.value.add(index)
  }
}

function getContent(ref: MessageReference | SseReferenceItem): string {
  return 'contentSnapshot' in ref ? ref.contentSnapshot : ref.content
}

function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

function formatPageNo(pageNo: number | null): string {
  return pageNo !== null ? `第 ${pageNo} 页` : '无页码'
}
</script>

<template>
  <div class="reference-panel">
    <button class="reference-toggle" @click="toggle">
      📎 引用来源 ({{ props.references.length }})
      <span>{{ expanded ? '收起 ▲' : '展开 ▼' }}</span>
    </button>

    <div v-show="expanded" class="reference-list">
      <div
        v-for="(ref, index) in props.references"
        :key="index"
        class="reference-item"
      >
        <div class="reference-header" @click="toggleItem(index)">
          <span class="reference-index">[{{ index + 1 }}]</span>
          <span class="reference-name">{{ ref.documentName }}</span>
          <span class="reference-page">{{ formatPageNo(ref.pageNo) }}</span>
          <span class="reference-score">{{ formatScore(ref.score) }}</span>
        </div>
        <div v-show="expandedItems.has(index)" class="reference-content">
          {{ getContent(ref) }}
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## 二十五、ChatInput 组件规格

### 25.1 Props / Emits

```typescript
defineProps<{
  status: ChatGenerationStatus
}>()

defineEmits<{
  send: [question: string]
  stop: []
}>()
```

### 25.2 实现

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button, Input } from 'ant-design-vue'
import type { ChatGenerationStatus } from '../types/chat'

const props = defineProps<{
  status: ChatGenerationStatus
}>()

const emit = defineEmits<{
  send: [question: string]
  stop: []
}>()

const inputText = ref('')

const isGenerating = computed(() =>
  props.status === 'connecting' || props.status === 'generating',
)

const canSend = computed(() =>
  !isGenerating.value && inputText.value.trim().length > 0,
)

function handleSend(): void {
  if (!canSend.value) return
  const question = inputText.value.trim()
  inputText.value = ''
  emit('send', question)
}

function handleStop(): void {
  emit('stop')
}

function handleKeydown(event: KeyboardEvent): void {
  // 回车发送，Shift+回车换行
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="chat-input">
    <Input
      v-model:value="inputText"
      :disabled="isGenerating"
      placeholder="输入问题，回车发送，Shift+回车换行"
      @keydown="handleKeydown"
    />
    <Button
      v-if="!isGenerating"
      type="primary"
      :disabled="!canSend"
      @click="handleSend"
    >
      发送
    </Button>
    <Button
      v-else
      danger
      @click="handleStop"
    >
      停止
    </Button>
  </div>
</template>
```

---

## 二十六、异常提示和断线处理

### 26.1 异常类型

| 异常类型 | 触发场景 | UI 处理 |
|---|---|---|
| HTTP 400 | 空 question | `message.error('请输入问题')` |
| HTTP 404 | 知识库或会话不存在 | `message.error('资源不存在')`，返回详情页 |
| HTTP 409 | 同会话并发 | `message.error('当前会话正在生成回答')` |
| SSE error 事件 | LLM 失败/检索失败 | 助手消息标记 failed，显示 error message |
| 网络断开 | fetch 失败/流中断 | 助手消息标记 failed，显示"网络连接失败" |
| 用户中止 | 点击"停止" | 保留已生成内容，状态改为 aborted |

### 26.2 HTTP 错误与 SSE error 的区别

| 阶段 | 错误类型 | 处理方式 |
|---|---|---|
| fetch 发起失败 | `onNetworkError` 回调 | 网络错误提示 |
| HTTP 状态码非 200 | `onNetworkError` 回调（含 `ApiError`） | 按 status 区分提示 |
| SSE 流中 error 事件 | `onError` 回调 | 助手消息标记 failed，显示安全消息 |
| SSE 流意外中断 | `reader.read()` 异常 | `onNetworkError` 回调 |

### 26.3 后端不可用

后端未启动时，`fetch` 会抛出 `TypeError: Failed to fetch`，前端显示"网络连接失败，请检查后端服务是否启动"。

### 26.4 流中断后的消息保留

SSE 流意外中断时（非用户主动中止），已生成的部分内容保留在助手消息中，标记为 `failed`，errorMessage 为"网络连接失败"。

---

## 二十七、页面刷新后恢复会话历史

### 27.1 恢复流程

```
1. 用户刷新页面 → Vue Router 重新解析 URL
2. ChatView 组件接收 props: { knowledgeBaseId, conversationId }
3. useChat 的 loadHistory(conversationId) 被调用
4. GET /api/conversations/:id/messages 获取历史消息
5. messages.value = historyMessages
6. currentConversationId = conversationId
7. 会话列表从 GET /api/knowledge-bases/:id/conversations 加载
8. 当前会话在列表中高亮
```

### 27.2 无 conversationId 时

URL 无 `?conversationId=N` 时，显示空状态："输入问题开始新对话"。会话列表正常加载，用户可选择已有会话或直接发消息创建新会话。

### 27.3 conversationId 无效时

`GET /api/conversations/:id/messages` 返回 404 时，清空消息，显示"会话不存在或已被删除"，清除 URL 中的 conversationId。

---

## 二十八、文件修改清单

### 28.1 新建文件（10 个）

| 文件 | 说明 |
|---|---|
| `web/src/types/conversation.ts` | 会话、消息、引用 TS 类型 |
| `web/src/types/chat.ts` | SSE 事件类型、聊天消息项、生成状态 |
| `web/src/api/conversation.ts` | 会话列表、消息历史、删除会话 API |
| `web/src/api/chat.ts` | SSE 聊天请求封装 |
| `web/src/api/sse.ts` | SSE 客户端核心（fetch + ReadableStream 解析） |
| `web/src/composables/use-chat.ts` | 聊天核心逻辑 composable |
| `web/src/composables/use-conversations.ts` | 会话列表管理 composable |
| `web/src/views/ChatView.vue` | 聊天页主容器 |
| `web/src/components/ConversationList.vue` | 会话列表侧边栏 |
| `web/src/components/MessageList.vue` | 消息区域 |
| `web/src/components/MessageBubble.vue` | 单条消息气泡 |
| `web/src/components/ReferencePanel.vue` | 引用面板 |
| `web/src/components/ChatInput.vue` | 输入区域 |

### 28.2 修改文件（1 个）

| 文件 | 修改内容 |
|---|---|
| `web/src/router/index.ts` | 将 `chat-placeholder` 路由替换为 `chat` 路由，组件改为 `ChatView.vue`，props 增加从 query param 读取 `conversationId` |

### 28.3 删除文件（1 个）

| 文件 | 原因 |
|---|---|
| `web/src/views/ChatPlaceholderView.vue` | T13 替换为真实聊天页 |

### 28.4 不修改的文件

- `web/package.json`（不新增依赖）
- `web/src/main.ts`
- `web/src/App.vue`
- `web/src/api/http.ts`
- `web/src/api/knowledge-base.ts`
- `web/src/api/document.ts`
- `web/src/api/health.ts`
- `web/src/types/*`（已有的不修改）
- `web/src/composables/use-knowledge-bases.ts`
- `web/src/composables/use-documents.ts`
- `web/src/utils/format.ts`
- `web/src/views/HomePage.vue`
- `web/src/views/KnowledgeBaseListView.vue`
- `web/src/views/KnowledgeBaseDetailView.vue`
- `web/src/components/*`（T12 已有的不修改）
- `web/vite.config.ts`
- `web/tsconfig.json`
- `web/env.d.ts`
- 所有 `server/` 文件

---

## 二十九、实现顺序

```
1. 新建类型文件
   web/src/types/conversation.ts
   web/src/types/chat.ts

2. 新建 API 封装
   web/src/api/conversation.ts
   web/src/api/sse.ts
   web/src/api/chat.ts

3. 新建 composables
   web/src/composables/use-conversations.ts
   web/src/composables/use-chat.ts

4. 新建组件（从底层到高层）
   web/src/components/ReferencePanel.vue
   web/src/components/MessageBubble.vue
   web/src/components/MessageList.vue
   web/src/components/ChatInput.vue
   web/src/components/ConversationList.vue

5. 新建页面
   web/src/views/ChatView.vue

6. 修改路由
   web/src/router/index.ts（替换 chat-placeholder 为 chat）

7. 删除占位页
   web/src/views/ChatPlaceholderView.vue

8. 验证
   pnpm --filter web type-check  → 通过
   pnpm --filter web build       → 通过
   pnpm --filter web dev         → 手动验收
```

---

## 三十、验收标准

### 30.1 构建验收

| 命令 | 预期结果 |
|---|---|
| `pnpm --filter web type-check` | 通过（无 TS 错误） |
| `pnpm --filter web build` | 通过（vue-tsc + vite build） |

### 30.2 代码质量检查

| 检查项 | 要求 |
|---|---|
| `rg "\bany\b" web/src` | 无命中（禁显式 any） |
| `rg "EventSource|WebSocket" web/src` | 无命中（不用 EventSource / WebSocket） |
| `rg "pinia|createPinia" web/src` | 无命中（不使用 Pinia） |
| `rg "localStorage|sessionStorage" web/src` | 无命中（不缓存业务数据） |
| `rg "mock|Mock|fake|dummy" web/src` | 无命中（不使用假数据） |
| `rg "app.use\(Antd\)" web/src` | 无命中（按需导入） |

### 30.3 功能验收（需后端启动 + Mock 模式）

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | 从知识库详情页点击"进入对话" | 跳转到 `/knowledge-bases/:id/chat` |
| 2 | 聊天页加载 | 左侧显示会话列表，右侧显示空状态 |
| 3 | 输入问题并回车 | 消息出现在消息区，助手回答逐字流式显示 |
| 4 | 新会话创建 | URL 更新为 `?conversationId=N`，会话列表出现新会话 |
| 5 | 流式 token 展示 | 助手回答逐字增量显示，有 typing 指示器 |
| 6 | 引用展示 | 助手回答下方显示引用面板，点击可展开 |
| 7 | 引用内容 | 展示文档名、页码、相似度、内容快照 |
| 8 | 切换会话 | 点击会话列表项，消息区加载该会话历史消息 |
| 9 | 页面刷新 | URL 中的 conversationId 恢复，历史消息重新加载 |
| 10 | 停止生成 | 点击"停止"按钮，生成中止，已生成内容保留 |
| 11 | 重复提交防护 | 生成中发送按钮禁用，输入框禁用 |
| 12 | SSE error 事件 | 助手消息显示失败提示，可继续发新消息 |
| 13 | 后端未启动 | 显示"网络连接失败"提示 |
| 14 | 删除会话 | Popconfirm 确认后删除，列表更新 |
| 15 | 无命中问题 | 返回"知识库中未找到..."固定话术，无引用 |
| 16 | 移动端 | 会话列表收为 Drawer，消息区全屏 |
| 17 | 回车发送 | 回车发送消息，Shift+回车换行 |
| 18 | 空消息 | 发送按钮在输入为空时禁用 |

### 30.4 SSE 协议验收

| # | 场景 | 预期结果 |
|---|---|---|
| 1 | 正常问答 | `metadata → token×N → references → done` 全部处理 |
| 2 | 无命中 | `metadata → token(固定话术) → references([]) → done` |
| 3 | LLM 失败 | `metadata → token×N → error`，助手消息标记 failed |
| 4 | 同会话并发 | 第二个请求返回 409，显示提示 |
| 5 | 半包处理 | 大量 token 快速到达时不丢字（buffer 正确拼接） |

---

## 三十一、基线回填

### 31.1 `docs/00-overall-plan.md` 修订

| # | 变更 | 原因 |
|---|---|---|
| 1 | §8 前端页面划分更新：`/knowledge-bases/:id/chat` 从 T13 占位改为已实现 | T13 实现了聊天页、会话列表、消息流和引用展示 |
| 2 | §3.1 前端技术栈补充：T13 确认不引入 Pinia，继续用 composables | 聊天页状态用 `useChat` + `useConversations` 管理，不需要 Pinia |
| 3 | §3.1 SSE 客户端确认：使用 `fetch` + `ReadableStream`，不用 `EventSource` | `EventSource` 只支持 GET，SSE 接口为 POST |

### 31.2 `docs/01-current-implementation.md` 修订（T13 完成后回填）

- 更新前端结构：新增 `api/conversation.ts`、`api/chat.ts`、`api/sse.ts`、`types/conversation.ts`、`types/chat.ts`、`composables/use-chat.ts`、`composables/use-conversations.ts`、`views/ChatView.vue` 和 5 个组件
- 更新路由：`/knowledge-bases/:id/chat` 从占位改为真实聊天页
- 删除 `ChatPlaceholderView.vue`
- 更新"当前阶段"为"T13 前端聊天页完成"

---

## 三十二、禁止项

| # | 禁止 | 原因 |
|---|---|---|
| 1 | Markdown 富文本高级编辑器 | 用户禁止 |
| 2 | WebSocket | 用户禁止 |
| 3 | 登录和权限 | MVP 不做 |
| 4 | 多租户 | MVP 不做 |
| 5 | Rerank / Agent / GraphRAG | MVP 不做 |
| 6 | 修改后端业务逻辑 | 禁止 |
| 7 | Mock 假数据 | 全部使用真实 API |
| 8 | 无必要的新状态管理框架 | 用 composables 替代 |
| 9 | Markdown 渲染（回答内容） | 纯文本展示 |
| 10 | 消息编辑/重新生成 | 非 MVP 范围 |
| 11 | `EventSource` API | 不支持 POST |
| 12 | `localStorage` / `sessionStorage` 持久化业务数据 | 页面刷新重新查询 |
| 13 | 显式 `any` 类型 | tsconfig strict 模式 |
| 14 | `app.use(Antd)` 全量注册 | 按需导入组件 |
| 15 | 新增依赖包 | 现有 `vue` + `ant-design-vue` + `axios` + `vue-router` 足够 |

---

## 三十三、Codex 执行指令

```
你是前端工程师，在 Mini RAG 项目中实现 T13 前端 RAG 聊天、会话与引用展示。

工作目录：web/
前置条件：后端已启动（localhost:3000），Vue dev server 代理 /api → localhost:3000。
不新增任何 npm 依赖。不修改后端代码。不修改 web/package.json。

按以下顺序执行：

1. 新建 web/src/types/conversation.ts
   - Conversation 接口（id/title/createdAt/updatedAt）
   - MessageRole = 'user' | 'assistant'
   - MessageStatus = 'completed' | 'failed'
   - MessageReference 接口（documentId/chunkId/documentName/chunkIndex/pageNo/score/contentSnapshot）
   - ChatMessageData 接口（id/role/content/status/errorMessage/createdAt/references）

2. 新建 web/src/types/chat.ts
   - SseEventType 联合类型（metadata/token/references/done/error）
   - SseMetadataEvent/SseTokenEvent/SseReferenceItem/SseDoneEvent/SseErrorEvent 接口
   - ChatRequestParams 接口（question/conversationId?）
   - ChatMessageItem 接口（id 可 null/role/content/status 含 streaming/errorMessage/references/createdAt 可 null）
   - ChatGenerationStatus 联合类型（idle/connecting/generating/completed/error/aborted）

3. 新建 web/src/api/conversation.ts
   - listConversations(knowledgeBaseId) → GET /api/knowledge-bases/:id/conversations
   - listMessages(conversationId) → GET /api/conversations/:id/messages
   - deleteConversation(conversationId) → DELETE /api/conversations/:id
   - 使用 http 实例，返回 response.data

4. 新建 web/src/api/sse.ts
   - SseCallbacks 接口（onMetadata/onToken/onReferences/onDone/onError/onNetworkError）
   - fetchSseChat(url, body, callbacks, abortSignal) 函数
   - 使用原生 fetch POST，不走 Axios
   - response.body.getReader() + TextDecoder 读取流
   - 按 \n\n 分帧，buffer 累积半包
   - parseSseFrame：解析 event:/data: 行，支持多行 data
   - dispatchSseEvent：JSON.parse 后按 event 类型分发到回调
   - HTTP 非 200 时解析后端 {code,message,details} 错误结构，抛 ApiError
   - abortSignal.aborted 时静默返回

5. 新建 web/src/api/chat.ts
   - sendChatMessage(knowledgeBaseId, params, callbacks, abortSignal) 函数
   - 调用 fetchSseChat，URL = /api/knowledge-bases/${knowledgeBaseId}/chat

6. 新建 web/src/composables/use-conversations.ts
   - useConversations(knowledgeBaseId: Ref<number>)
   - 返回 conversations/loading/error/fetchList/refresh/remove
   - watch(knowledgeBaseId, { immediate: true }) 触发 fetchList

7. 新建 web/src/composables/use-chat.ts
   - useChat(knowledgeBaseId: Ref<number>, conversationId: Ref<number | undefined>)
   - 返回 messages/generationStatus/currentConversationId/sendMessage/stopGeneration/loadHistory
   - sendMessage：push user+assistant 消息 → 创建 AbortController → sendChatMessage
   - onMetadata：设置 conversationId，router.replace 同步 URL，更新 userMessageId
   - onToken：追加 delta 到最后一条 streaming assistant 消息
   - onReferences：设置 references 到最后一条 streaming assistant 消息
   - onDone：设置 assistantMessageId 和 status=completed
   - onError：设置 status=failed 和 errorMessage
   - onNetworkError：设置 status=failed 和网络错误消息
   - stopGeneration：abortController.abort()，保留已生成内容
   - loadHistory：调用 listMessages，映射为 ChatMessageItem[]
   - onUnmounted：stopGeneration

8. 新建 web/src/components/ReferencePanel.vue
   - props: references: (MessageReference | SseReferenceItem)[]
   - 折叠/展开切换
   - 每条引用：序号/文档名/页码(null 显示"无页码")/相似度(百分比)/内容快照(可展开)
   - getContent 统一处理 contentSnapshot 和 content 字段名差异

9. 新建 web/src/components/MessageBubble.vue
   - props: message: ChatMessageItem
   - user 消息右对齐，assistant 消息左对齐
   - streaming 状态：内容为空时显示 typing 指示器
   - failed 状态：显示错误提示 + 已生成内容
   - completed 状态且有引用：显示 ReferencePanel

10. 新建 web/src/components/MessageList.vue
    - props: messages: ChatMessageItem[], status: ChatGenerationStatus
    - 自动滚动到底部（watch messages deep + nextTick）
    - 空状态："输入问题开始对话"

11. 新建 web/src/components/ChatInput.vue
    - props: status: ChatGenerationStatus
    - emits: send(question: string), stop()
    - Input + Button（发送/停止切换）
    - 回车发送，Shift+回车换行
    - isGenerating 时禁用输入框和发送按钮

12. 新建 web/src/components/ConversationList.vue
    - props: knowledgeBaseId, currentConversationId?, conversations, loading, error
    - emits: select(id), new(), delete(id)
    - 新建会话按钮
    - 会话列表（标题+时间+删除 Popconfirm）
    - 当前会话高亮
    - 空状态/loading/error 状态

13. 新建 web/src/views/ChatView.vue
    - props: knowledgeBaseId: number, conversationId?: number
    - 左右分栏布局：左侧 ConversationList + 右侧 MessageList + ChatInput
    - 移动端：会话列表收为 Drawer
    - useChat + useConversations 组合
    - watch(conversationId) 触发 loadHistory
    - 返回详情页按钮
    - 删除当前会话后清除 URL conversationId

14. 修改 web/src/router/index.ts
    - 将 chat-placeholder 路由改为：
      path: '/knowledge-bases/:id/chat', name: 'chat',
      component: () => import('../views/ChatView.vue'),
      props: (route) => ({
        knowledgeBaseId: Number(route.params.id),
        conversationId: route.query.conversationId ? Number(route.query.conversationId) : undefined,
      })

15. 删除 web/src/views/ChatPlaceholderView.vue

16. 验证
    pnpm --filter web type-check → 通过
    pnpm --filter web build → 通过
    rg "\bany\b" web/src → 无命中
    rg "EventSource|WebSocket" web/src → 无命中
    rg "pinia|createPinia" web/src → 无命中
    rg "localStorage|sessionStorage" web/src → 无命中
    rg "mock|Mock|fake|dummy" web/src → 无命中

约束：
- 禁止修改后端代码
- 禁止修改 web/package.json（不新增依赖）
- 禁止 EventSource / WebSocket
- 禁止 Pinia
- 禁止显式 any
- 禁止 Mock 假数据
- 禁止 localStorage / sessionStorage 持久化业务数据
- 全部用 Ant Design Vue 按需导入（不 app.use(Antd)）
- 文件名 kebab-case
- catch 用 unknown
- 显式返回类型
- SSE 请求用原生 fetch（不走 Axios）
- 助手回答按纯文本展示（不渲染 Markdown）
```

---

## 附：设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 用 `fetch` + `ReadableStream` 而非 `EventSource` | `EventSource` 只支持 GET，SSE 接口为 POST |
| 2 | SSE 解析用 `buffer.split('\n\n')` + `frames.pop()` | 正确处理半包和粘包 |
| 3 | `conversationId` 用 query param 而非路径参数 | 总体方案只有一条 chat 路由，query param 更灵活 |
| 4 | `router.replace` 同步 conversationId | 不创建历史记录，避免回退到"无会话"状态 |
| 5 | 不用 Pinia | 聊天状态用 `useChat` composable 管理，足够简单 |
| 6 | 引用默认折叠 | 避免长引用干扰阅读，用户按需展开 |
| 7 | 引用 `content` 与 `contentSnapshot` 统一处理 | SSE 事件和历史 API 字段名不同，组件层统一适配 |
| 8 | 中止后保留已生成内容 | 用户可看到部分回答，刷新后从后端加载 failed 状态 |
| 9 | 会话列表不做轮询 | 只在用户操作后刷新，没有人操作时列表不变 |
| 10 | 助手回答纯文本展示 | MVP 不需要 Markdown 渲染 |
| 11 | 移动端用 Drawer 收起会话列表 | Ant Design Vue 内置 Drawer，无需额外依赖 |
| 12 | HTTP 错误用 `ApiError` 包装 | 与 T12 的 `http.ts` 错误类型一致，页面可按 `status` 差异化处理 |
| 13 | 不新增 npm 依赖 | 现有 `vue` + `ant-design-vue` + `vue-router` + `axios` 完全覆盖需求 |
| 14 | 流式消息用 `ChatMessageItem` 而非 `ChatMessageData` | 流式消息需要 `id: null`、`status: 'streaming'`、`createdAt: null` 等临时状态 |
