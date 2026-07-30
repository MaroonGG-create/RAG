# T06 文本清洗与切片 — Codex 执行指令

> 任务编号：T06（阶段 P5 后半：清洗 + 切片 + DocumentChunk 落库）
> 前置条件：T05 已完成（结论：**通过**，见 `docs/reports/task-05-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.4 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T05 后快照）+ `docs/reports/task-05-completion.md`（T05 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T05 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**。status 枚举已含 `chunking`/`failed`；`chunkCount`（INT UNSIGNED DEFAULT 0）已就绪 |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | **本任务首次写入**。字段全部就绪：`documentId`/`kbId`/`chunkIndex`/`content`/`charCount`/`pageNo`/`qdrantPointId`；唯一索引 `uk_doc_index(documentId, chunkIndex)`、`uk_qdrant_point(qdrantPointId)` 已由 InitSchema 创建 |
| `ParsedDocument` 类型 | `src/modules/processing/parsing/parsed-document.types.ts` | T06 的输入：从 `.parsed/{documentId}.json` 读取，结构含 `pages: ParsedPage[]`、`fileHash`、`fileExt` |
| `ParsedResultStore` | `src/modules/processing/parsing/parsed-result.store.ts` | 复用 `read(documentId)` 读取 T05 暂存；**不修改**该文件 |
| `ParsingService` | `src/modules/processing/parsing/parsing.service.ts` | **不修改**。T06 不调用 parseDocument；若 `.parsed` 不存在则直接失败 |
| `ProcessingModule` | `src/modules/processing/processing.module.ts` | **允许修改**：`forFeature` 追加 `DocumentChunk`，providers 追加 `ChunkingService` |
| `configuration.ts` | `src/config/configuration.ts` | **允许修改**：追加 `chunk.size` / `chunk.overlap`（§十二） |
| `env.validation.ts` | `src/config/env.validation.ts` | **允许修改**：追加 `CHUNK_SIZE` / `CHUNK_OVERLAP` 校验（§十二） |
| `DocumentService.remove` | `src/modules/document/document.service.ts` | **不修改**：DocumentChunk 的 `onDelete: CASCADE` 已由数据库保证级联删除；T05 已追加 `.parsed` 清理 |
| migration 体系 | 2 条既有 migration | **本任务零 migration、零 schema 变更**：`document_chunk` 表已由 InitSchema 创建 |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | **不修改**（手动触发走 CLI） |
| `crypto.randomUUID` | Node.js 20 内置 | 用于生成 `qdrantPointId`（UUID v4），**零新增依赖** |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T05 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 `MySQL80` 占用 `localhost:3306`）：**进入本任务前必须先处理**（同 T05 §十五 步骤 0），否则切片写库与验收 SQL 都会打到错误实例。
2. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，记入已知问题。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

在 `processing` 模块内新建 `chunking` 子目录，接收 T05 的 `ParsedDocument`，完成：

- **文本清洗**：按页/段清洗 T05 输出的原文（§三）；
- **文本切片**：按字符递归切分，保留 PDF 页码（§四）；
- **DocumentChunk 落库**：批量写入 `document_chunk` 表，含 `qdrantPointId`（UUID v4）、连续 `chunkIndex`、`charCount`（§七）；
- **状态流转**：`pending → chunking →（成功留 chunking / 失败 failed + errorMessage）`（§十）；
- **幂等重跑**：重试时先清理旧切片，保证结果恒定（§十一）；
- **失败补偿**：失败时清理半成品切片并置 `failed`（§十一）；
- **更新 `document.chunkCount`**；
- **文档详情切片预览**：`GET /api/documents/:id` 返回前 20 条 chunk 摘要（§十四，v1.4 从 T05 顺延至 T06）；
- **手动触发**：内部 Service 方法 + CLI 脚本（§十三）；
- **日志与异常处理**。

### 2.2 非目标（本阶段一律不做）

Embedding、Qdrant（含 collection/upsert/search/delete）、`status=embedding/completed`、上传后自动触发切片（自动流水线属 T07+）、Chat、SSE、会话接口、前端页面、消息队列、定时任务、OCR、Rerank、新数据库表、新 migration、修改既有 migration 与任何实体。

**禁止模拟处理**：不允许假切片结果、不允许跳过 `.parsed` 文件读取。

---

## 三、文本清洗规则（冻结级，设计问题 1）

`cleanText(text: string): string`，**纯函数、不新增依赖**，对每页/段的 T05 原文执行：

### 3.1 应清洗的内容

| # | 规则 | 实现 | 理由 |
|---|---|---|---|
| 1 | 换行符归一化 | `\r\n` → `\n`；独立 `\r` → `\n` | T05 保留了原始 `\r\n`；切片前统一为 `\n` 以保证分隔符一致性 |
| 2 | 零宽字符移除 | 删除 `\u200B`(ZWSP)、`\u200C`(ZWNJ)、`\u200D`(ZWJ)、`\uFEFF`(BOM/ZWNBSP) | 不可见字符干扰字符计数和检索匹配；BOM 在 T05 已处理但 PDF 提取可能残留 |
| 3 | 连续空行压缩 | 3+ 连续 `\n` → 2 个 `\n` | 保留段落分隔（双换行）但去除 excessive 空行；减少无内容切片 |
| 4 | 首尾空白修剪 | `text.trim()` | 去除页/段首尾的空白和空行；**仅首尾**，内部空白保留 |

### 3.2 不应清洗的内容（显式禁止）

| # | 内容 | 理由 |
|---|---|---|
| 1 | Markdown 语法符号（`#`、`**`、`` ` ``、`[]()` 等） | MVP 将 MD 按纯文本处理，标记符号是正文的一部分；清洗会丢失语义信息 |
| 2 | 页眉/页脚 | MVP 不做启发式页眉页脚检测（误删风险高于收益）；记入已知取舍 |
| 3 | URL 和邮箱地址 | 保留原文 |
| 4 | 标点和特殊字符 | 保留原文 |
| 5 | 段落内换行 | 保留（可能是有意义的行 break）；只有连续 3+ 空行才压缩 |
| 6 | 多余空格（非首尾） | 保留（MVP 不做 NLP 级空白归一化） |

**铁律**：清洗后的文本是切片输入，但 `document_chunk.content` 存储的是**清洗后文本**（不再是 T05 原文）。T05 的 `.parsed` 文件保留原文不动。

---

## 四、文本切片算法（冻结级，设计问题 2）

### 4.1 整体策略：按页处理 + 递归字符切分 + 合并重叠

```
chunkDocument(parsed, chunkSize, chunkOverlap)
  ├─ for each page in parsed.pages:
  │    ├─ cleanedText = cleanText(page.text)
  │    ├─ if cleanedText.trim() === '' → skip（空白页，§六）
  │    ├─ segments = recursiveSplit(cleanedText, chunkSize, SEPARATORS)
  │    └─ chunks = mergeWithOverlap(segments, chunkSize, chunkOverlap)
  │         每个_chunk_继承 page.pageNo
  └─ 全局 chunkIndex 从 0 连续递增
```

**核心原则：切片不跨页边界。** PDF 每页独立切分，保证每个 chunk 的 `pageNo` 唯一且准确（设计问题 4，§九）。

### 4.2 递归切分（recursiveSplit）

分隔符按优先级从高到低：

```ts
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ', ''];
```

算法：

```
recursiveSplit(text, maxLen, separators):
  if text.length <= maxLen → return [text]
  if separators 为空 → return hardSplit(text, maxLen)

  sep = separators[0]
  parts = text.split(sep)
  result = []
  for part in parts:
    if part.length <= maxLen:
      result.push(part + sep)  // 保留分隔符，维持原文连续性
    else:
      result.push(...recursiveSplit(part, maxLen, separators[1:]))
  return result
```

`hardSplit(text, maxLen)`：从 maxLen 位置向前找最近的空格，找不到则直接截断。

### 4.3 合并重叠（mergeWithOverlap）

```
mergeWithOverlap(segments, chunkSize, chunkOverlap):
  chunks = []
  current = ''
  for seg in segments:
    if current.length + seg.length <= chunkSize:
      current += seg
    else:
      if current !== '':
        chunks.push(current)
        // 重叠：取 current 末尾 chunkOverlap 字符作为下一段开头
        overlap = current.slice(-chunkOverlap)
        current = overlap + seg
      else:
        // 单个 segment 就超过 chunkSize（hardSplit 后不应出现，兜底）
        current = seg
  if current !== '' → chunks.push(current)
  return chunks
```

**重叠边界规则**：
- 重叠只发生在**同一页内**的相邻 chunk 之间；
- 跨页不重叠（保证 pageNo 唯一）；
- 每页第一个 chunk **不**携带上一页末尾的重叠。

### 4.4 中文/英文/Markdown 适配说明

| 场景 | 适配点 |
|---|---|
| 中文文本 | `。！？` 作为句子级分隔符；中文无空格，`hardSplit` 直接截断（中文字符独立性强，截断不影响理解） |
| 英文文本 | `. ` / `! ` / `? ` 带空格的句子分隔符；`hardSplit` 优先在空格处截断 |
| Markdown | 按 `\n\n`（段落）和 `\n`（行）切分，保留 `#`/`**` 等标记符号；MVP 不解析 MD 结构 |
| 跨页文本 | 不跨页；每页独立切分 |

---

## 五、ChunkSize / Overlap 边界校验（冻结级，设计问题 3）

### 5.1 配置项

| 环境变量 | 默认值 | 范围 | 说明 |
|---|---|---|---|
| `CHUNK_SIZE` | 500 | 100–10000 | 每个切片最大字符数 |
| `CHUNK_OVERLAP` | 100 | 0–(CHUNK_SIZE-1) | 相邻切片重叠字符数 |

### 5.2 校验层级

1. **env.validation.ts**：`CHUNK_SIZE` — `@IsInt @Min(100) @Max(10000)`；`CHUNK_OVERLAP` — `@IsInt @Min(0) @Max(9999)`；
2. **configuration.ts**：读取后做跨字段校验 `overlap < size`，不满足则 `throw new Error('CHUNK_OVERLAP 必须小于 CHUNK_SIZE')`；
3. **ChunkingService 构造函数**：从 `ConfigService` 读取 `chunk.size` / `chunk.overlap`，存为私有只读属性，启动时即可失败。

### 5.3 边界场景

| 场景 | 行为 |
|---|---|
| `CHUNK_OVERLAP = 0` | 无重叠，合法 |
| `CHUNK_OVERLAP >= CHUNK_SIZE` | 启动即报错 |
| `CHUNK_SIZE = 100`（最小值） | 正常切分，切片较小 |
| 文本长度 < CHUNK_SIZE | 整段作为一个 chunk |

---

## 六、边界场景处理（冻结级，设计问题 5）

| 场景 | 处理 |
|---|---|
| **短文档**（清洗后总长 ≤ CHUNK_SIZE） | 单个 chunk，`pageNo` 取对应页（MD/TXT 为 null） |
| **空白 PDF 页**（清洗后 `trim() === ''`） | 跳过，不产生 chunk；页码不占 chunkIndex |
| **全空白文档**（所有页清洗后都为空） | 抛 `ChunkFailure('清洗后无可切片内容')`，status=failed |
| **超长段落**（单段 > CHUNK_SIZE 且无自然分隔符） | `hardSplit` 在 CHUNK_SIZE 处截断，带 overlap 继续切分 |
| **单页产生多个 chunk** | 所有 chunk 共享同一 `pageNo`；`chunkIndex` 全局连续递增 |
| **`.parsed` 文件不存在** | 抛 `ChunkFailure('文档尚未解析或解析结果已丢失，请先执行 pnpm --filter server parse:document <id>')` |
| **`.parsed` 文件 fileHash 与 DB 不一致** | 抛 `ChunkFailure('解析结果与文档不匹配，请重新解析')`；安全防护，防 documentId 复用 |
| **`.parsed` 文件 JSON 损坏** | 抛 `ChunkFailure('解析结果损坏，请重新解析')` |

---

## 七、DocumentChunk 批量写入与事务（冻结级，设计问题 6）

### 7.1 事务边界

```
dataSource.transaction(async (manager) => {
  // 1. 删除旧切片（幂等重跑安全）
  await manager.delete(DocumentChunk, { documentId });

  // 2. 分批插入新切片
  for (const batch of chunkBatches) {
    await manager.save(DocumentChunk, batch);  // batch ≤ 500 条
  }

  // 3. 更新 document.chunkCount
  await manager.update(Document, documentId, { chunkCount: chunks.length });
});
```

**事务保证**：delete + insert + chunkCount 更新原子化。事务失败则回滚，旧切片（如有）恢复，chunkCount 不变。

### 7.2 批量大小

- 每批 `save()` 最多 **500 条** DocumentChunk；
- 20MB 文本文件极端情况约 14000 chunks → 28 批，每批约 500KB，远低于 MySQL `max_allowed_packet` 默认 64MB；
- 批量大小为常量，不做环境变量配置（MVP 不需要调参）。

### 7.3 qdrantPointId 生成

```ts
import { randomUUID } from 'node:crypto';
// 每个 chunk 在构造时生成：qdrantPointId: randomUUID()
```

- Node.js 20 内置 `crypto.randomUUID()`，产出 RFC 4122 v4 UUID；
- `uk_qdrant_point` 唯一索引兜底防碰撞（概率极低）；
- 重跑时旧 UUID 随旧切片删除，新 UUID 随新切片插入——Qdrant 侧的旧向量由 T08 清理（本任务不涉及 Qdrant）。

### 7.4 chunkIndex 规则

- **0-based**，从 0 开始；
- **全局连续**，跨页递增（page 1 的 chunks 是 0,1,2；page 2 的 chunks 是 3,4；…）；
- `uk_doc_index(documentId, chunkIndex)` 唯一索引保证不重复。

### 7.5 kbId 冗余填充

从 `Document.kbId` 获取，写入每个 chunk 的 `kbId` 列。理由：`idx_kb` 索引支撑按知识库直查（总体方案 §5.3 v1.1 #4）。

---

## 八、模块与文件设计

### 8.1 新增文件（server/，5 个）

| 文件 | 职责 |
|---|---|
| `src/modules/processing/chunking/chunking.service.ts` | 唯一编排入口 `chunkDocument(documentId): Promise<ChunkResult>`：状态流转、读 `.parsed`、fileHash 校验、调用清洗+切片、事务写入、失败清理、in-flight 去重 |
| `src/modules/processing/chunking/text-cleaner.ts` | 纯函数 `cleanText(text: string): string`（§三） |
| `src/modules/processing/chunking/text-splitter.ts` | 纯函数 `splitText(text: string, chunkSize: number, chunkOverlap: number): string[]`（§四）；导出 `SEPARATORS` 常量 |
| `src/modules/processing/chunking/chunk.types.ts` | `ChunkResult` 接口 + `ChunkFailure` 错误类（携带面向用户的中文摘要） |
| `src/scripts/chunk-document.ts` | CLI 手动触发（§十三），`NestFactory.createApplicationContext` 调用 `ChunkingService` |

### 8.2 修改文件（server/ 6 个 + 根 3 个）

| 文件 | 修改内容 |
|---|---|
| `src/modules/processing/processing.module.ts` | `forFeature` 追加 `DocumentChunk`；providers 追加 `ChunkingService`；exports 追加 `ChunkingService` |
| `src/modules/document/document.module.ts` | `forFeature` 追加 `DocumentChunk`（供 DocumentService 查询切片预览） |
| `src/modules/document/document.service.ts` | `findOne()` 追加切片预览查询（§十四）；**其余逻辑逐行不动** |
| `src/modules/document/dto/document-response.dto.ts` | 追加 `DocumentDetailResponseDto`（含 `chunks: ChunkPreviewDto[]`）和 `ChunkPreviewDto`（§十四） |
| `src/config/configuration.ts` | 追加 `chunk: { size: number; overlap: number }`（§十二） |
| `src/config/env.validation.ts` | 追加 `CHUNK_SIZE` / `CHUNK_OVERLAP` 校验（§十二） |
| `server/package.json` | scripts 加 `"chunk:document": "ts-node src/scripts/chunk-document.ts"` |
| `.env.example` | 追加 `CHUNK_SIZE=500` / `CHUNK_OVERLAP=100`（§十二） |
| `docs/00-overall-plan.md` | §十五 v1.5 回填（§十五） |

**禁止改动**：`web/` 任何文件、全部实体定义、既有 migration、main.ts、过滤器、`docker-compose.yml`、knowledge-base 模块、parsing 子目录下任何文件。

> 规模判断：清洗和切片各一个纯函数文件即可，**不建** cleaner registry / splitter factory / strategy pattern——两个函数不值得一层抽象（与 T05「不过度细分」一致）。

---

## 九、页码归属规则（冻结级，设计问题 4）

| 文档类型 | pageNo 取值 | 规则 |
|---|---|---|
| PDF | `1..numPages`（来自 T05 `ParsedPage.pageNo`） | 切片不跨页；同一页产生的所有 chunk 共享同一 pageNo；空白页跳过但页码不占 chunkIndex |
| Markdown | `null` | T05 输出 `pageNo=null`，T06 透传 |
| TXT | `null` | 同上 |

**跨页切片禁止**：即使 page N 末尾只有 10 字符且 page N+1 开头只有 10 字符（合计 20 < CHUNK_SIZE），也**不合并**为单个 chunk。理由：

1. 合并后 chunk 的 `pageNo` 无法归属——填 N 还是 N+1 都丢失另一页的信息；
2. 页码是后续检索引用链路的硬需求（§4.2 SSE references / §5.6 message_reference / §6 Qdrant payload），准确性高于切片紧凑度；
3. 短页产生的短 chunk 在检索时不影响质量（TopK 按相似度排序，与 chunk 长度无关）。

**重叠不跨页**：每页第一个 chunk 不携带上一页的重叠内容。重叠只存在于同一页内相邻 chunk 之间。

---

## 十、切片主流程与状态机（冻结级）

### 10.1 状态机（本阶段仅允许这些边）

```
                触发 chunkDocument(id)
pending ──────────────────────► chunking ──成功──► chunking   （chunkCount=N；等待 T07 Embedding 接管）
failed ───────────────────────► chunking ──失败──► failed     （errorMessage=中文摘要；chunkCount=0）
chunking ─────────────────────► chunking           （上次崩溃残留或已成功，幂等处理见 §十一）
```

**成功留 `chunking` 的理由（写进代码注释与汇报）**：

- 总体方案 §4.1 ⑥ 规定 split 阶段 status=`chunking`，⑧ 规定 embed 阶段 status=`embedding`；
- T06 成功后 `chunking` 语义为「已切片，待向量化」，T07 据此 `WHERE status='chunking' AND chunk_count > 0` 拣选文档；
- 与 T05「成功回 pending」的区别：T05 禁止 `chunking`，只能回 `pending`；T06 本身就是 `chunking` 阶段，成功后留在 `chunking` 是最自然的语义。

**防御性拒绝**：触发时若 status 为 `embedding` 或 `completed`，抛 `ChunkFailure('文档已进入后续处理阶段，禁止重复切片')`——防止 T07+ 上线后被误调用。

### 10.2 主流程（ChunkingService.chunkDocument）

```
1. docRepo.findOne({ id }) → null → throw NotFoundException('文档不存在')
2. status 防御性检查（§10.1）
3. 幂等短路：if status === 'chunking' AND chunkCount > 0 → 直接返回 { documentId, chunkCount }（§十一）
4. docRepo.update(id, { status: 'chunking', errorMessage: null })
5. parsed = parsedResultStore.read(id)
     null → ChunkFailure('文档尚未解析或解析结果已丢失，请先执行 pnpm --filter server parse:document <id>')
     parsed.fileHash !== doc.fileHash → ChunkFailure('解析结果与文档不匹配，请重新解析')
6. chunks = chunkDocumentInternal(parsed, chunkSize, chunkOverlap)（§四 + §三 + §六）
     chunks.length === 0 → ChunkFailure('清洗后无可切片内容')
7. dataSource.transaction:
     a. delete DocumentChunk where documentId = id
     b. batch insert chunks（§七）
     c. update Document set chunkCount = chunks.length
8. Logger.log 成功摘要 → return { documentId, chunkCount, totalChars }

任意步骤抛错：
   → 清理：chunkRepo.delete({ documentId: id }).catch(() => {})（兜底，事务回滚后通常无残留）
   → docRepo.update(id, { status: 'failed', errorMessage: 摘要, chunkCount: 0 })
   → 继续抛出（CLI 退出码 1）
```

---

## 十一、并发、幂等与失败补偿（冻结级，设计问题 7+8）

### 11.1 并发语义（in-flight 去重）

- `private readonly inFlight = new Map<number, Promise<ChunkResult>>()`：同一 documentId 并发触发时复用同一 Promise，`finally` 中删除——与 T05 模式一致；
- 不同 documentId 之间不做串行限制（手动触发量级小，不引入队列）。

### 11.2 幂等策略

| 场景 | 行为 |
|---|---|
| **首次切片**（status=pending, chunkCount=0） | 正常切片 |
| **重复触发已成功**（status=chunking, chunkCount>0） | 幂等短路：直接返回 `{ documentId, chunkCount }`，不重跑、不删旧切片、不刷新状态 |
| **崩溃恢复**（status=chunking, chunkCount=0） | 重新切片：事务内 delete（无旧数据）+ insert |
| **失败重试**（status=failed, chunkCount=0） | 重新切片：事务内 delete（清理可能残留）+ insert |
| **重试时旧切片存在** | 事务内 delete 先清理，再 insert 新切片——结果对同一 `.parsed` 输入恒定 |

### 11.3 失败补偿

```
catch (error):
  // 1. 兜底清理：删除可能残留的半成品切片
  //    （事务失败会回滚，正常情况无残留；此步是防御性兜底）
  await chunkRepo.delete({ documentId: id }).catch(() => {});

  // 2. 置 failed 并重置 chunkCount
  await docRepo.update(id, {
    status: 'failed',
    errorMessage: 摘要化(error),
    chunkCount: 0,
  });

  // 3. 继续抛出
  throw new ChunkFailure(摘要);
```

**chunkCount=0 的理由**：失败时 chunkCount 归零，确保 T07 不会拣选到 `status=failed` 的文档（T07 查询条件含 `status='chunking' AND chunk_count > 0`）。即使旧切片因事务回滚仍存在，chunkCount=0 也阻止 T07 误读。

### 11.4 errorMessage 摘要规则

- `ChunkFailure` → 直接用其文案；
- 其余错误 → `error instanceof Error ? error.message : '未知错误'`，截取前 300 字符；
- **禁止包含**：绝对路径、堆栈、文件内容、切片内容。

---

## 十二、配置与环境变量

### 12.1 configuration.ts 追加

```ts
chunk: {
  size: Number(process.env.CHUNK_SIZE ?? 500),
  overlap: Number(process.env.CHUNK_OVERLAP ?? 100),
},
```

并在 `AppConfiguration` 接口追加：

```ts
chunk: {
  size: number;
  overlap: number;
};
```

**跨字段校验**（configuration 函数末尾）：

```ts
if (config.chunk.overlap >= config.chunk.size) {
  throw new Error('CHUNK_OVERLAP 必须小于 CHUNK_SIZE');
}
```

### 12.2 env.validation.ts 追加

```ts
@IsDefined()
@Type(() => Number)
@IsInt()
@Min(100)
@Max(10000)
CHUNK_SIZE!: number;

@IsDefined()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(9999)
CHUNK_OVERLAP!: number;
```

### 12.3 .env.example 追加

```env
# 文本切片
CHUNK_SIZE=500
CHUNK_OVERLAP=100
```

---

## 十三、手动触发设计（冻结级）

**选型：内部 Service 方法 + CLI 脚本，不新增公开 HTTP 接口。** 理由同 T05：基线 §9 的 13 个接口为冻结级约定，本阶段无「触发切片」接口；T07 自动流水线复用同一 `ChunkingService.chunkDocument` 方法即可。

`src/scripts/chunk-document.ts`：

```ts
// 用法：pnpm --filter server chunk:document <documentId>
async function bootstrap(): Promise<void> {
  const documentId = parseDocumentId(process.argv[2]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(ChunkingService).chunkDocument(documentId);
    console.log(JSON.stringify({
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      totalChars: result.totalChars,
    }));
  } catch (error: unknown) {
    console.error(`切片失败：${error instanceof Error ? error.message : '未知错误'}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
```

`package.json` scripts 追加：`"chunk:document": "ts-node src/scripts/chunk-document.ts"`。

---

## 十四、文档详情切片预览（v1.4 从 T05 顺延至 T06）

### 14.1 新增 DTO

`src/modules/document/dto/document-response.dto.ts` 追加：

```ts
export class ChunkPreviewDto {
  id!: number;
  chunkIndex!: number;
  content!: string;       // 截断到前 200 字符
  charCount!: number;
  pageNo!: number | null;
  qdrantPointId!: string;
}

export class DocumentDetailResponseDto extends DocumentResponseDto {
  chunks!: ChunkPreviewDto[];
}
```

### 14.2 DocumentService.findOne 修改

```ts
async findOne(id: number): Promise<DocumentDetailResponseDto> {
  const document = await this.findDocumentEntity(id);
  const chunks = await this.chunkRepository.find({
    where: { documentId: id },
    order: { chunkIndex: 'ASC' },
    take: 20,
  });
  return DocumentDetailResponseDto.fromEntity(document, chunks);
}
```

- 预览最多 20 条，按 `chunkIndex` 升序；
- `content` 截断到前 200 字符（`content.slice(0, 200)`）；
- `DocumentModule` 的 `forFeature` 追加 `DocumentChunk`（§8.2）；
- `DocumentController.findOne` 返回类型改为 `DocumentDetailResponseDto`，Swagger 注解同步更新。

---

## 十五、与 T07 Embedding 的数据接口（设计问题 9）

### 15.1 T07 拣选条件

```sql
SELECT id, kb_id, file_name FROM document
WHERE status = 'chunking' AND chunk_count > 0;
```

T06 成功后 `status='chunking'` + `chunk_count=N`，T07 据此拣选。

### 15.2 T07 读取切片

```sql
SELECT id, document_id, kb_id, chunk_index, content, char_count, page_no, qdrant_point_id
FROM document_chunk
WHERE document_id = ?
ORDER BY chunk_index ASC;
```

### 15.3 字段映射（T07 使用）

| document_chunk 字段 | T07 用途 |
|---|---|
| `qdrant_point_id` | Qdrant point id（直接使用） |
| `content` | 调用 Embedding API 的输入文本 |
| `kb_id` | Qdrant payload `knowledgeBaseId` |
| `document_id` | Qdrant payload `documentId` |
| `chunk_index` | Qdrant payload `chunkIndex` |
| `page_no` | Qdrant payload `pageNo` |

### 15.4 T07 接管后的状态流转

```
chunking ──T07 开始──► embedding ──T07 成功──► completed
                      ──T07 失败──► failed
```

T06 的职责到 `chunking` 为止。T07 负责 `chunking → embedding → completed`。

---

## 十六、基线回填（00-overall-plan.md v1.5，必须执行）

| # | 变更 | 原因 |
|---|---|---|
| 1 | §4.1 ⑥ 状态语义补充：T06 成功后 status **留在 chunking** | `chunking` 在 T06→T07 之间语义为「已切片，待向量化」；T07 据此拣选 `status='chunking' AND chunk_count > 0` 的文档 |
| 2 | §9 #8 文档详情切片预览**在 T06 实现** | v1.3 #4 / v1.4 #3 将此功能顺延至 T06；T06 写入 `document_chunk` 后切片预览有真实数据 |
| 3 | §12 `CHUNK_SIZE` / `CHUNK_OVERLAP` 环境变量**在 T06 实现** | 总体方案 §12 已列出但 T05 未使用；T06 首次需要切片配置 |
| 4 | §15 风险 5 部分关闭：`chunking` 崩溃残留由 T06 幂等短路处理 | T06 支持从 `chunking` 状态重触发（`chunkCount > 0` 短路、`chunkCount = 0` 重跑）；`parsing`/`embedding` 崩溃残留仍需 T07+ 处理 |

---

## 十七、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（同 T05）。验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。
1. 修改 `env.validation.ts` + `configuration.ts` + `.env.example`（§十二）；`pnpm --filter server build` 通过。
2. `chunk.types.ts`（ChunkResult + ChunkFailure）→ `text-cleaner.ts`（§三）→ `text-splitter.ts`（§四）。
3. `chunking.service.ts`（§十）→ `processing.module.ts` 注册（§八）。
4. `document.module.ts` forFeature + `document.service.ts` findOne 切片预览 + DTO（§十四）。
5. `src/scripts/chunk-document.ts` + package.json script（§十三）。
6. 回填 `00-overall-plan.md` v1.5（§十六）。
7. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
8. 执行 §十八全量验收。

---

## 十八、验收命令（Windows PowerShell 可执行）

> 前置：mysql healthy；默认 `.env` 直连 Compose MySQL 成功；后端需常驻（文档详情接口验收用）。
> **编码注意**：含中文断言用 Node 脚本读 JSON 比对，不在 PS 管道直接 grep 中文。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建知识库 → 上传文件 → T05 解析（T06 依赖 .parsed 文件）
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t06-chunk-kb\"}"
# 上传 PDF（≥3 页中文，每页含"第N页标记"）、MD、TXT
# 记录 PDF_ID, MD_ID, TXT_ID

pnpm --filter server parse:document <PDF_ID>   # T05 解析
pnpm --filter server parse:document <MD_ID>
pnpm --filter server parse:document <TXT_ID>

# 2. 三种格式切片成功
pnpm --filter server chunk:document <PDF_ID>
# 预期：退出码 0；stdout JSON 含 chunkCount>0、totalChars>0
pnpm --filter server chunk:document <MD_ID>
pnpm --filter server chunk:document <TXT_ID>

# 3. 状态与切片落库断言
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,file_ext,status,chunk_count,error_message FROM document;"
# 预期：成功三件 status=chunking、chunk_count>0、error_message=NULL

# 用 Node 脚本断言切片内容（避免 PS 中文乱码）：
#   a. PDF：chunkIndex 从 0 连续递增；pageNo 全部为正整数且在 1..numPages 范围内；
#      同一 pageNo 的 chunk 连续；content 含"第N页标记"对应文本
#   b. MD：pageNo 全部为 null；content 含 Markdown 标记（#、**）证明未清洗标记
#   c. TXT：pageNo 全部为 null
#   d. charCount === content.length（每条）
#   e. qdrantPointId 为 36 字符 UUID 格式
#   f. content.length <= CHUNK_SIZE + CHUNK_OVERLAP（含重叠时上限）

# 4. 幂等：重复触发已切片文档
pnpm --filter server chunk:document <PDF_ID>
# 预期：退出码 0；stdout 的 chunkCount 与首次一致（幂等短路）

# 5. 重跑：删除旧切片后重切（模拟参数变更）
# 手动删除 .parsed 文件后重新 T05 解析（生成新 parsedAt），再 T06 切片
# 预期：旧切片被删除，新切片插入，chunkIndex 从 0 重新开始

# 6. 失败场景
# a. 未解析文档直接切片
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\new.txt"
pnpm --filter server chunk:document <NEW_ID>
# 预期：退出码 1；"文档尚未解析或解析结果已丢失"

# b. fileHash 不匹配（手动篡改 .parsed 中的 fileHash）
# 预期：退出码 1；"解析结果与文档不匹配，请重新解析"

# 验证失败后状态
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,status,chunk_count,error_message FROM document WHERE id=<NEW_ID>;"
# 预期：status=failed、chunk_count=0、error_message 含中文摘要

# 7. 文档详情切片预览
curl.exe http://localhost:3000/api/documents/<PDF_ID>
# 预期：响应含 chunks 数组，最多 20 条，每条含 id/chunkIndex/content(≤200字)/charCount/pageNo/qdrantPointId
# 预期：无 chunks 字段时返回空数组（未切片文档）

# 8. 删除联动（T04 回归 + chunk 级联）
curl.exe -i -X DELETE http://localhost:3000/api/documents/<MD_ID>
# 预期：204
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM document_chunk WHERE document_id=<MD_ID>;"
# 预期：0（CASCADE 删除）
# .parsed/<MD_ID>.json 同步消失（T05 已实现）

# 9. 越界检查
curl.exe http://localhost:3000/api/docs-json
# 预期：paths 与 tags 与 T05 完全一致（无新增 HTTP 接口）
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM document_chunk;"
# 预期：仅成功切片的文档有 chunk（失败文档 chunk_count=0）
# 全表无 embedding/completed 状态

# 10. 清理
curl.exe -X DELETE http://localhost:3000/api/documents/<各剩余 id>
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/1
Remove-Item -Recurse -Force tmp-test, server\uploads\1, server\uploads\.parsed -ErrorAction SilentlyContinue
# 预期：业务表回 0 行；migrations 表仍 2 条
```

---

## 十九、明确禁止（本任务一律不实现）

Embedding、Qdrant（含 collection/upsert/search/delete）、`status=embedding/completed`、上传后自动触发切片、启动时状态重置钩子、Chat、SSE、会话接口、前端页面、Rerank、消息队列、定时任务、OCR、新数据库表、新 migration、修改既有 migration 与任何实体定义、修改 `web/`、引入测试框架（T16 统一补）、引入 LangChain（切片手写）、引入 `uuid` 包（用 Node.js 内置 `crypto.randomUUID`）、页眉页脚启发式清除、Markdown 结构化解析、NLP 分词、跨页合并切片。

---

## 二十、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① 清洗规则取舍（做什么、不做什么、为什么） ② 递归字符切分算法与分隔符优先级 ③ 页码归属——不跨页切分的理由 ④ 事务原子写入与失败补偿 ⑤ 幂等短路策略（`chunkCount > 0` 短路） ⑥ 成功留 `chunking` 语义。
3. **启动方式**：DB 端口冲突处理结果；切片触发命令。
4. **验证方式**：§十八逐条结果（成功/失败 + 关键输出；幂等项须附两次 `chunkCount` 对比；失败场景须附 DB 中 `error_message` 实际值；切片预览须附 API 响应片段）。
5. **已知问题**：含页眉页脚未清洗、`parsing`/`embedding` 崩溃残留需 T07+ 处理、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §十九各项均未实现。

---

## 二十一、Codex 简洁执行指令

> 以下为可直接交给 Codex 的精简指令，完整设计细节见 §一至 §二十。

```
你是一个 NestJS 后端工程师。请按 docs/task-06-text-cleaning-and-chunking.md 实现文本清洗与切片功能。

## 环境准备
1. 确认默认 .env 能直连 Compose MySQL（DB_PORT 冲突需先解决）
2. pnpm --filter server build 通过

## 要做的事（严格按序）
1. 配置：env.validation.ts 加 CHUNK_SIZE(@IsInt @Min(100) @Max(10000)) 和 CHUNK_OVERLAP(@IsInt @Min(0) @Max(9999))；configuration.ts 加 chunk:{size,overlap} 并做 overlap<size 跨字段校验；.env.example 加 CHUNK_SIZE=500 / CHUNK_OVERLAP=100
2. 新建 src/modules/processing/chunking/ 目录：
   - chunk.types.ts: ChunkResult 接口 + ChunkFailure extends Error
   - text-cleaner.ts: 纯函数 cleanText(text) → 换行归一化(\r\n→\n) + 删零宽字符(\u200B\u200C\u200D\uFEFF) + 3+连续换行压2 + trim；不改 Markdown 标记/标点/URL/内部空格
   - text-splitter.ts: 纯函数 splitText(text, chunkSize, chunkOverlap) → 递归按 SEPARATORS=['\n\n','\n','。','！','？','. ','! ','? ',' ',''] 分割 + 合并重叠；不跨页
   - chunking.service.ts: chunkDocument(documentId) → 状态检查(pending/failed/chunking可触发, embedding/completed拒绝) → 幂等短路(status=chunking AND chunkCount>0 直接返回) → 置 chunking → 读.parsed(校验fileHash) → 逐页cleanText+splitText(跳过空白页, 全空报错) → 生成ChunkResult[{chunkIndex:0-based连续, content, charCount:content.length, pageNo, qdrantPointId:randomUUID()}] → dataSource.transaction(delete旧+batch save新(每批500)+update chunkCount) → 成功留chunking → 失败catch: delete chunks兜底+置failed+chunkCount=0 → in-flight Map去重
3. processing.module.ts: forFeature加DocumentChunk, providers加ChunkingService
4. document.module.ts: forFeature加DocumentChunk; document.service.ts: findOne()加切片预览(查前20条chunkIndex升序, content截200字); dto加ChunkPreviewDto+DocumentDetailResponseDto
5. scripts/chunk-document.ts: CLI, 调ChunkingService.chunkDocument, 输出摘要JSON
6. package.json: 加 "chunk:document": "ts-node src/scripts/chunk-document.ts"
7. 回填 00-overall-plan.md v1.5

## 不做的事
- 不做 Embedding/Qdrant/Chat/SSE/前端/消息队列/定时任务/自动触发/OCR/Rerank
- 不做新 migration/新表/改实体/改 web/
- 不做页眉页脚清除/Markdown解析/NLP分词/跨页合并
- 不引入 LangChain/uuid包/测试框架
- 不修改 parsing/ 子目录下任何文件

## 验收
- pnpm --filter server build 0 error
- pnpm --filter web type-check 0 error
- pnpm --filter server migration:show 仅2条历史
- PDF/MD/TXT 切片成功: status=chunking, chunk_count>0
- 幂等: 重复触发 chunkCount 不变
- 失败: status=failed, chunk_count=0, error_message有中文摘要
- 删除: chunk 级联消失, .parsed 消失
- 文档详情API: 含 chunks 预览数组
- docs-json: 无新增HTTP接口
```
