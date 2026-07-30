# T05 文档文本解析 — Codex 执行指令

> 任务编号：T05（阶段 P5 前半：仅文档解析，不含清洗/切片）
> 前置条件：T04 已完成（结论：**部分通过**——功能通过，默认运行环境存在 DB 端口冲突，见 `docs/reports/task-04-completion.md`）
> 设计基线：`docs/00-overall-plan.md`（v1.1 / v1.2 / v1.3 修订记录）
> 实现依据：`docs/01-current-implementation.md`（T04 后快照）+ `docs/reports/task-04-completion.md`（T04 实际结果以此为准）
> 本文全文即 Codex 执行指令，可直接复制使用。

---

## 一、当前可复用实现（依据快照与 T04 完成报告，禁止凭记忆假设）

| 资产 | 位置 | 用法 |
|---|---|---|
| `Document` 实体 | `src/modules/document/entities/document.entity.ts` | 直接复用，**禁止修改**。status 枚举已含 `parsing` / `failed`，`storagePath`（相对路径、正斜杠）、`fileHash`、`errorMessage` 均已就绪 |
| `DocumentChunk` 实体 | `src/modules/document/entities/document-chunk.entity.ts` | **本任务只读引用都禁止**，不写入任何 chunk |
| `DocumentStorageService` | `src/modules/document/storage/document-storage.service.ts` | 复用其 `upload.dir` 注入方式与 warn-only 清理语义；本任务**不修改**该文件 |
| `DocumentService.remove` | `src/modules/document/document.service.ts` | **允许一处追加**：删除文档后清理暂存文件（§七.4），其余逻辑逐行不动 |
| `configuration.ts` `upload.dir` | `src/config/configuration.ts` | 已是与 cwd 无关的绝对路径，业务代码只读 `configService.getOrThrow('upload.dir')`，禁止拼写死路径 |
| 全局异常过滤器 | `src/common/filters/http-exception.filter.ts` | **本任务不动**（手动触发走 CLI，不经过 HTTP 异常链） |
| migration 体系 | 4 条 pnpm 脚本 | **本任务零 schema 变更、零 migration**（暂存走文件系统，见 §七） |
| Swagger | main.ts 已接入 | **本任务不新增任何公开接口**，docs-json 应保持不变 |
| 代码约定 | 小写点分隔文件名、显式返回类型、catch 用 `unknown`、禁显式 `any`、简短中文注释 | 严格遵守 |

**T04 遗留问题（与本任务的关系）**：

1. **默认 DB 端口冲突**（宿主机 `MySQL80` 占用 `localhost:3306`，T04 靠临时 3307 转发验收）：**进入本任务前必须先处理**，见 §十五 步骤 0，否则解析的状态写库与验收 SQL 都会打到错误实例。
2. 时间字段 8 小时偏移、`ParsePositiveIntPipe` 宽松数字：**本任务不修**，验收断言只验证相对顺序与行为，记入已知问题。

---

## 二、本任务目标与非目标

### 2.1 目标（只做这些）

新建 `processing` 模块，根据 `document.storagePath` 读取已上传文件，完成三种格式的**文本解析**：

- PDF：逐页提取文本，产出连续 1-based `pageNo`；
- Markdown / TXT：按纯文本读取，产出单段结果（`pageNo=null`）；
- 统一输出 `ParsedDocument`（§四），为 T06 清洗和切片提供输入；
- 状态流转 `pending → parsing → (成功回 pending / 失败 failed + errorMessage)`；
- 解析成功结果的**文件系统暂存**与**幂等重跑**；
- 手动触发的内部 Service 方法 + CLI 脚本；
- 日志与异常处理。

### 2.2 非目标（本阶段一律不做）

文本清洗（含去页眉页脚、多余空白归一化、`\r\n` 归一化、trim 后改写原文）、文本切片、`DocumentChunk` 插入、Embedding、Qdrant、`status=chunking/embedding/completed`、上传后自动触发解析（自动流水线属 T06）、Chat、SSE、会话接口、前端处理进度页面、消息队列、定时任务、OCR、公开 HTTP 接口、文档详情的切片预览（顺延 T06，见 §十四）。

**禁止模拟处理**：不允许假解析结果、不允许跳过真实文件读取。

---

## 三、PDF 解析库选型（冻结级决策，关键设计问题 1）

### 3.1 评估前提：页码引用是硬需求

引用链路明确要求 `pageNo`：§4.2 SSE `references` 事件含 `pageNo`；§5.6 `message_reference.page_no` 落库；§6 Qdrant payload 含 `pageNo`。因此解析层必须**原生逐页提取并保证页码连续正确**，拼接全文再猜页码的方案不可接受。

### 3.2 候选评估（版本事实均以 npm registry 实测为准）

| 候选 | 模块格式 / Node 兼容 | 逐页能力 | 结论 |
|---|---|---|---|
| `pdf-parse@1.1.1`（原基线 §3.2） | CJS，但 `index.js` 含 `module.parent` 调试代码坑 | **不满足**：输出单段拼接文本，页码只能靠 `pagerender` 回调 hack 重建；捆绑 2018 年 pdf.js v1.10.100，CJK CMap 支持弱；2019 年后停更 | **否决** |
| `pdf-parse@2.4.5`（2025 重写版） | 双格式：`require` → `dist/pdf-parse/cjs/index.cjs`；engines `>=20.16.0 <21 \|\| >=22.3.0` | 满足（内置按页结果） | **备选**：引入 `@napi-rs/canvas` **原生依赖** + `pdfjs-dist@5.4.296`，Windows 与 Alpine(musl) 两个目标环境安装面都变大；2025-12 才由新维护者重写，生产验证积累少。收益不抵风险 |
| `pdfjs-dist@2.16.105` | **UMD**（`main: build/pdf.js`，`module.exports` 导出），Node 20 CJS 直接加载；自带类型 `types/src/pdf.d.ts`；无 engines 限制，Node 20 实测可用 | **原生满足**：`getPage(i).getTextContent()` 逐页提取，页码即循环序号；`cmaps/` 随包分发，Node 下从磁盘读 CMap（中文 PDF 必需） | **选定，精确锁死** |
| `pdfjs-dist@3.11.174`（3.x 最终版） | 实测 `legacy/build/pdf.js` 内含 214 处顶层 `export`/`import` 语句（ESM 语法），Node CommonJS `require` 直接抛 SyntaxError | — | **否决** |
| `pdfjs-dist@4.x+` | `main: build/pdf.mjs`，纯 ESM；Node 20 CJS 无法 `require`（`require(esm)` 需 Node ≥22.12） | — | **否决** |

### 3.3 兼容性结论

当前技术栈：Node 20 LTS + NestJS 10 + TypeScript 5.6（`module: commonjs`、`esModuleInterop: true`、`strict: true`），编译产物为 CommonJS。在该约束下：

- 只有 **UMD/CJS 构建** 能被 `nest build` 产物直接 `require`；
- `pdfjs-dist@2.16.105` 是同时满足「UMD + 自带类型 + 纯 JS 零原生依赖 + 逐页 API」的唯一候选；
- `pnpm --filter server add -E pdfjs-dist@2.16.105`（**`-E` 精确版本，禁止 `^`**：pdfjs 次版本曾发生构建格式断裂，锁死是本次选型的一部分）；
- 不需要 `@types/pdfjs-dist`（包自带类型），不安装 `pdf-parse`。

### 3.4 兼容层设计（冻结级）

**全部 pdfjs 接触集中在唯一文件** `src/modules/processing/parsing/pdf.parser.ts`，其余任何文件不得 import `pdfjs-dist`。兼容层三要素：

1. **类型化加载**（一行解决子路径无类型声明问题，免建 shim 文件）：
   ```ts
   import type { PDFDocumentProxy } from 'pdfjs-dist';
   // pdfjs-dist@2.16.105 未为 legacy 子路径提供类型声明；运行时取 UMD legacy 构建，类型复用主入口。
   const pdfjsLib: typeof import('pdfjs-dist') = require('pdfjs-dist/legacy/build/pdf.js');
   ```
2. **worker 与 CMap**（模块顶层执行一次，加注释）：
   ```ts
   // Node 下 pdf.js 始终使用 fake worker；显式指定 workerSrc 避免初始化告警。
   pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
   // 中文 PDF 必需 CMap；Node 下 NodeCMapReaderFactory 按文件系统路径读取随包分发的 cmaps/。
   const CMAP_URL = join(dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + '/';
   ```
3. **加载参数**：`getDocument({ data, cMapUrl: CMAP_URL, cMapPacked: true, isEvalSupported: false })`（`isEvalSupported: false` 禁止执行 PDF 内嵌 JS，服务端安全加固，写注释）。

**基线回填**：本决策替换原 §3.2 的 `pdf-parse@1.1.1`，必须按 §十四 回填 `00-overall-plan.md`（v1.4）。

---

## 四、统一解析结果类型（冻结级，关键设计问题 2）

新建 `src/modules/processing/parsing/parsed-document.types.ts`：

```ts
export interface ParsedPage {
  /** PDF 为 1-based 连续页码；MD/TXT 无页码概念，恒为 null（契约沿用 §15 风险 10：前端对 NULL 显示 "-"） */
  pageNo: number | null;
  /** 解析原文。本阶段不做任何清洗：保留 \r\n、多余空白、Markdown 标记符号，原样交给 T06 */
  text: string;
}

export interface ParsedDocument {
  documentId: number;
  fileExt: 'pdf' | 'md' | 'txt';
  /** 实际使用的解析器标识，便于排障 */
  parser: 'pdfjs' | 'plaintext';
  /** 解析器版本（pdfjs-dist 版本号；纯文本为 'builtin'），结果可复现性的元数据 */
  parserVersion: string;
  /** 幂等锚点：暂存结果必须对应当前文件的 SHA-256（§十二） */
  fileHash: string;
  /** ISO 时间；幂等短路时该值不刷新，是"未重复解析"的验收证据 */
  parsedAt: string;
  pages: ParsedPage[];
  /** Σ pages[i].text.length（JS string.length 口径，与 chunk.charCount 的字符数口径一致） */
  totalChars: number;
}
```

**页级 vs 段级约定**：

- PDF：页级，`pageNo = 1..numPages` **连续不间断**；某页提取为空文本时**保留该页**（`text: ''`），维持页码与物理页的一一对应——页码引用是硬需求，丢页会导致后续引用错位；
- MD/TXT：段级，整个文件一条 `{ pageNo: null, text }`；
- `totalChars` 统计**原文**长度，不做 trim 折扣（空文件判定见 §八，判定用 trim、存储用原文，两者不得混用）。

---

## 五、模块与文件设计

### 5.1 新增文件（server/，8 个）

| 文件 | 职责 |
|---|---|
| `src/modules/processing/processing.module.ts` | 装配：`TypeOrmModule.forFeature([Document])` + providers；`exports: [ParsedResultStore]`（供 DocumentModule 删除清理用，依赖方向 document → processing，符合总体方案 §7） |
| `src/modules/processing/parsing/parsing.service.ts` | 唯一编排入口 `parseDocument(documentId): Promise<ParsedDocument>`：状态流转、读文件、按 `fileExt` 分发解析器、写暂存、失败落库、in-flight 去重（§六） |
| `src/modules/processing/parsing/parsed-document.types.ts` | §四类型 + `ParseFailure` 错误类（携带面向用户的中文摘要，与系统异常区分） |
| `src/modules/processing/parsing/pdf.parser.ts` | pdfjs 兼容层（§三.4）+ 逐页提取（§九）；**唯一 import pdfjs-dist 的文件** |
| `src/modules/processing/parsing/plain-text.parser.ts` | MD/TXT 解码纯函数 `decodePlainText(buffer): string`：BOM 处理 + UTF-8 解码 + 乱码/空判定（§八） |
| `src/modules/processing/parsing/parsed-result.store.ts` | 暂存读写删：`read / write / remove`，原子写（§七）；路径只认 `upload.dir + .parsed/` |
| `src/scripts/parse-document.ts` | CLI 手动触发（§十），`NestFactory.createApplicationContext` 调用 `ParsingService` |
| `src/modules/processing/parsing/pdf.parser.spec-note.ts` | **不建**。本阶段无测试框架（jest 未安装，T16 统一补），禁止为测试引入新依赖 |

> 规模判断：3 个解析器用 `ParsingService` 内私有方法按 `fileExt` switch 分发即可，**不建** parser registry / 抽象工厂——两个具体 parser 不值得一层抽象（与 T04「不过度细分」一致）。

### 5.2 修改文件（server/ 3 个 + 根 3 个）

| 文件 | 修改内容 |
|---|---|
| `src/app.module.ts` | imports 追加 `ProcessingModule`（DocumentModule 之后） |
| `src/modules/document/document.module.ts` | imports 追加 `ProcessingModule`（取 `ParsedResultStore`） |
| `src/modules/document/document.service.ts` | `remove()` 事务提交后追加暂存清理一行（§七.4），其余逐行不动 |
| `server/package.json` | dependencies 加 `pdfjs-dist`（精确 `2.16.105`）；scripts 加 `"parse:document": "ts-node src/scripts/parse-document.ts"` |
| `docs/00-overall-plan.md` | §十四 v1.4 回填（选型变更 + 风险 1 关闭 + 状态语义 + 切片预览顺延） |
| `README.md` | 解析触发命令与 `.parsed/` 目录说明 |

**禁止改动**：`web/` 任何文件、全部实体、既有 migration（**本任务零 migration**）、main.ts、过滤器、`env.validation.ts` / `configuration.ts`（无新增环境变量，§十三）、knowledge-base 模块、`docker-compose.yml`、`.env.example`。

---

## 六、解析主流程与状态机（冻结级）

### 6.1 状态机（本阶段仅允许这三条边）

```
                触发 parseDocument(id)
pending ──────────────────────► parsing ──成功──► pending   （等待 T06；唯一合法成功落点）
failed ───────────────────────► parsing ──失败──► failed    （errorMessage=中文摘要）
parsing ──────────────────────► parsing           （上次崩溃残留，允许重触发，幂等自愈）
```

**成功回 `pending` 的理由（写进代码注释与汇报）**：status 枚举被基线 §5 冻结，且本阶段禁止 `chunking/embedding/completed`；`pending` 在 T05→T06 之间语义为「待切片」，「已解析」这一事实由暂存文件承载（§七），不由状态位承载。

**防御性拒绝**：触发时若 status 为 `chunking/embedding/completed`（本阶段不可能出现），抛 `ParseFailure('文档已进入后续处理阶段，禁止重复解析')`——防止 T06 上线后本方法被误调用破坏流水线，加注释说明。

### 6.2 主流程（ParsingService.parseDocument）

```
1. docRepo.findOne({ id }) → null → throw NotFoundException('文档不存在')
2. status 防御性检查（§6.1）
3. 幂等短路：store.read(id)
     命中且 fileHash === doc.fileHash → 直接返回暂存结果（不动 status、不刷新 parsedAt）
     命中但形状损坏 → Logger.warn，按未命中继续
4. docRepo.update(id, { status: 'parsing', errorMessage: null })
5. readFile(join(uploadDir, doc.storagePath))
     ENOENT → ParseFailure('文件不存在或已被移动：{storagePath}')
6. 按 fileExt 分发：
     pdf      → extractPdfPages(buffer)          → pages（页级）
     md / txt → decodePlainText(buffer)          → [{ pageNo: null, text }]（段级）
7. totalChars = Σ text.length；
   trim 后总长为 0 → ParseFailure（文案按分支，见 §十一）
8. store.write(id, parsedDocument)（原子写）
9. docRepo.update(id, { status: 'pending', errorMessage: null })
10. Logger.log 成功摘要 → return parsedDocument

任意步骤抛错：
   errorMessage = 摘要化(error)（§十一）→ docRepo.update(id, { status: 'failed', errorMessage })
   → 继续抛出（CLI 退出码 1）
```

### 6.3 并发语义（in-flight 去重）

- `private readonly inflightParses = new Map<number, Promise<ParsedDocument>>()`：同一 documentId 并发触发时复用同一 Promise，`finally` 中删除——防并发重复解析与暂存写竞争；
- 不同 documentId 之间不做串行限制（手动触发量级小，不引入队列）；
- 失败**不写**暂存文件、不删除已有暂存（文件不可变，不存在「先成功后失败」的正常路径，加注释）。

---

## 七、解析结果暂存方案（冻结级）

### 7.1 选型：文件系统 JSON，**不入库**

- 路径：`{upload.dir}/.parsed/{documentId}.json`（隐藏点目录，与 `.tmp` 风格一致；按 documentId 命名而非 storagePath——documentId 在删除流程中直接可得，无需反查实体）；
- **不写 MySQL 的理由（写进汇报）**：暂存是 T05→T06 之间的中间产物，T06 后 `document_chunk` 才是最终存储；入列需要 migration 与回填，违反本阶段「零 schema 变更」边界，且 T04 已确认 schema 稳定；
- 文件内容 = `ParsedDocument` 的 JSON 序列化（§四全字段）。

### 7.2 原子写

写 `{documentId}.json.tmp` → 同目录 `rename` 为 `.json`（同分区 rename 原子；进程崩溃只留 tmp 残文件，下次触发覆盖自愈；读取方永远读到完整 JSON）。tmp 残文件读取时忽略。

### 7.3 读校验

`JSON.parse` + 最小形状校验（`documentId` 为 number、`pages` 为数组、`totalChars` 为 number、`fileHash` 为 string）；任一失败 → 视为未命中并 warn，走真实解析后覆盖。

### 7.4 删除联动（DocumentService 唯一允许的修改）

`DocumentService.remove()` 事务提交后、`deleteByStoragePath` 之后追加：

```ts
// 解析暂存随文档生命周期清理；失败仅告警，与磁盘文件删除语义一致。
await this.parsedResultStore.remove(id);
```

`ParsedResultStore.remove` 与 `deleteByStoragePath` 同语义：ENOENT 静默、其余失败 warn-only，**不影响 204 返回**。T04 删除用例（含并发删除、磁盘文件缺失容错）必须全部回归通过。

---

## 八、MD/TXT 读取与编码处理（冻结级）

`decodePlainText(buffer: Buffer): string`，**纯函数、不新增依赖**：

| 步骤 | 规则 |
|---|---|
| 1. BOM 检测 | `EF BB BF` → UTF-8（去 BOM）；`FF FE` → UTF-16LE（`toString('utf16le')`）；`FE FF` → UTF-16BE（Node 无原生 utf16be，先逐字节交换再按 utf16le 解码，加注释） |
| 2. 无 BOM | 按 UTF-8 解码 |
| 3. 乱码判定 | 解码结果含 `U+FFFD`（替换字符）→ `ParseFailure('文件编码无法识别，请转换为 UTF-8 编码后重新上传')`。理由：GBK/ANSI 文本按 UTF-8 解码必产 FFFD；严格失败 + 可读文案 优于 静默乱码进知识库（取舍写注释） |
| 4. 空判定 | `text.trim().length === 0` → `ParseFailure('文件内容为空')`（0 字节文件与纯空白文件同一路径） |

**铁律**：暂存的 `text` 是**解码原文**，禁止做任何改写（不做 trim、不做 `\r\n` 归一化、不去 BOM 以外的任何字符）——清洗是 T06 的事。判定用 trim、存储用原文。

**可选加固项（不阻塞验收）**：引入 `iconv-lite` 对 FFFD 结果做 GBK 二次解码兜底。若执行，需更新 §三选型说明与 README，并在汇报中声明；不执行则在已知问题中声明「GBK 文件明确失败并提示转码」。

---

## 九、PDF 逐页提取设计（冻结级）

`pdf.parser.ts` 导出 `extractPdfPages(buffer: Buffer): Promise<ParsedPage[]>`：

```ts
export async function extractPdfPages(buffer: Buffer): Promise<ParsedPage[]> {
  // 显式拷贝为 Uint8Array，避免 pdf.js 内部长期持有对原始 Buffer 的引用。
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    isEvalSupported: false,
  });
  const pdf: PDFDocumentProxy = await loadingTask.promise; // 异常映射见下表

  try {
    const pages: ParsedPage[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue; // TextItem / TextMarkedContent 类型守卫
        text += item.str;
        if (item.hasEOL) text += '\n';  // 只依赖 hasEOL 换行；布局级重建属 T06 清洗范畴
      }
      pages.push({ pageNo, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy(); // 释放 worker 与缓存；destroy 返回 Promise
  }
}
```

**异常映射（catch `unknown`，按 `error.name` 分类）**：

| pdf.js 异常 | ParseFailure 文案 |
|---|---|
| `PasswordException` | `'加密或受密码保护的 PDF 暂不支持'` |
| `InvalidPDFException` | `'PDF 文件损坏或格式无法解析'` |
| 其他 | 原样上抛，由 §十一 摘要化兜底 |

**空文本 PDF**（扫描件/纯图片）：逐页提取成功但 trim 后总长为 0 → `ParseFailure('未能提取到文本内容，可能是扫描件，当前版本不支持 OCR')`。

---

## 十、手动触发设计（冻结级）

**选型：内部 Service 方法 + CLI 脚本，不新增公开 HTTP 接口。** 理由：基线 §9 的 13 个接口为冻结级约定，本阶段无「触发解析」接口；T06 自动流水线复用同一 `ParsingService.parseDocument` 方法即可，CLI 脚本同时是 T05 的验收入口。未来如需 HTTP 触发，必须先回填 §9 再实现。

`src/scripts/parse-document.ts`：

```ts
// 用法：pnpm --filter server parse:document <documentId>
async function bootstrap(): Promise<void> {
  const rawId = process.argv[2];
  const documentId = Number(rawId);
  if (!/^\d+$/.test(rawId ?? '') || !Number.isSafeInteger(documentId) || documentId <= 0) {
    console.error('用法：pnpm --filter server parse:document <正整数 documentId>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await app.get(ParsingService).parseDocument(documentId);
    // 只输出摘要，禁止打印解析内容本身
    console.log(JSON.stringify({
      documentId: result.documentId,
      parser: result.parser,
      pageCount: result.pages.length,
      totalChars: result.totalChars,
      parsedAt: result.parsedAt,
    }));
  } catch (error: unknown) {
    console.error(`解析失败：${error instanceof Error ? error.message : '未知错误'}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
void bootstrap();
```

`package.json` scripts 追加：`"parse:document": "ts-node src/scripts/parse-document.ts"`（项目已有 ts-node，零新增依赖；脚本经 ConfigModule 校验加载 `.env`，与 dev 启动同源）。

---

## 十一、失败处理与日志（冻结级）

### 11.1 errorMessage 摘要规则

写入 `document.error_message` 前统一处理：

- `ParseFailure` → 直接用其文案；
- 其余错误 → `error instanceof Error ? error.message : '未知错误'`，截取前 300 字符；
- **禁止包含**：绝对路径（替换为 `storagePath` 相对路径）、堆栈、文件内容。

### 11.2 失败分类矩阵

| 场景 | errorMessage 文案 |
|---|---|
| 磁盘文件缺失 | `文件不存在或已被移动：{storagePath}` |
| 空文件 / 纯空白（md/txt） | `文件内容为空` |
| 编码无法识别（md/txt） | `文件编码无法识别，请转换为 UTF-8 编码后重新上传` |
| 空文本 PDF | `未能提取到文本内容，可能是扫描件，当前版本不支持 OCR` |
| 加密 PDF | `加密或受密码保护的 PDF 暂不支持` |
| 损坏 PDF | `PDF 文件损坏或格式无法解析` |
| 越阶段触发 | `文档已进入后续处理阶段，禁止重复解析` |
| 未知错误 | 原始 message 前 300 字符 |

### 11.3 日志矩阵（NestJS Logger，不引新框架）

| 时机 | 级别 | 内容 |
|---|---|---|
| 解析开始 | log | documentId、fileExt、fileSize |
| 幂等短路 | log | documentId、parsedAt（来自暂存） |
| 解析成功 | log | documentId、parser、pageCount、totalChars、耗时 ms |
| 解析失败 | error | documentId、摘要（不回传堆栈给 CLI 之外的地方） |
| 暂存损坏 | warn | documentId |
| 暂存/文件清理失败 | warn | documentId + 错误摘要 |

**禁止记录**：文件内容、解析出的文本、绝对路径、完整堆栈进响应。

---

## 十二、幂等策略（冻结级）

1. **暂存短路**：`store.read` 命中且 `fileHash` 与 DB 一致 → 直接返回，不动 status、不刷新 `parsedAt`。验收以「二次触发后 `parsedAt` 不变」为幂等证据；
2. **重触发覆盖写**：暂存缺失/损坏/失效时重新解析，原子 rename 覆盖，结果对同一文件（内容不可变）恒定；
3. **in-flight 去重**：同 id 并发触发共享同一 Promise（§6.3）；
4. **失败可重试**：`failed` 文档允许重触发（`failed → parsing → pending/failed`），同一文件结果恒定（错误也恒定），不产生副作用积累；
5. **崩溃自愈**：进程崩溃残留 `parsing` 状态时，允许直接重触发（§6.1 第三条边）；启动时自动重置 `parsing → pending` 属 T06+ 流水线职责（总体方案 §15 风险 5），本阶段不实现，写入已知取舍。

---

## 十三、配置与环境变量

**零新增环境变量。** 暂存目录固定派生自 `upload.dir`（`.parsed/` 子目录），解析无阈值类配置；`MAX_FILE_SIZE_MB` 已在 T04 限制了解析输入的体积上限。`.env.example`、`env.validation.ts`、`configuration.ts` 均不动——这是刻意简化，写进汇报。

---

## 十四、基线回填（00-overall-plan.md v1.4，必须执行）

在 `docs/00-overall-plan.md` 修订记录追加 v1.4，并同步修改 §3.2 与 §15：

| # | 变更 | 原因 |
|---|---|---|
| 1 | §3.2 后端表 `pdf-parse@1.1.1（锁死）` → **`pdfjs-dist@2.16.105（锁死）`** | 页码引用是硬需求（§4.2 / §5.6 / §6 均含 pageNo），pdf-parse 1.1.1 单段拼接文本无法稳定产出 pageNo，且捆绑 2018 年 pdf.js、CJK CMap 弱、存在 `module.parent` 调试代码坑；pdfjs-dist 2.16.105 为 2.x 最终版，UMD 构建与 Node 20 + NestJS 10 + CommonJS + TS 5.6 完全兼容，`getPage().getTextContent()` 原生逐页产出 pageNo。pdf-parse 2.4.5（2025 重写版）评估为备选：双 CJS/ESM 且内置按页结果，但引入 `@napi-rs/canvas` 原生依赖与 pdfjs-dist 5，安装面与运维风险大于收益 |
| 2 | §15 风险 1 标记为**已关闭** | 选型已按「逐页提取」重新决策并锁定 pdfjs-dist@2.16.105，原 pdf-parse 两处已知坑不再适用；新风险（2.x 停更）由锁死版本 + 单一兼容层文件对冲 |
| 3 | §4.1 ④ 状态语义补充：T05 阶段解析成功后 status **回到 pending** | 枚举冻结且 T05 禁止 chunking/completed；T06 前 pending 语义为「待切片」，「已解析」由暂存文件承载 |
| 4 | v1.3 #4「文档详情 T05 增量加入切片预览」**顺延至 T06** | 本阶段无 DocumentChunk 数据（切片属 T06），提前实现只能是假数据 |

---

## 十五、实现顺序（严格按序）

0. **前置：处理 DB 端口冲突**（T04 报告 §19 要求）。与负责人确认方案（停止/禁用本机 `MySQL80`，或调整 compose 端口映射并同步 `.env`），验证 `pnpm --filter server migration:show` 用默认 `.env` 退出码 0。未完成不得进入下一步。
1. `pnpm --filter server add -E pdfjs-dist@2.16.105`；`pnpm --filter server build` 通过。
2. `parsed-document.types.ts`（§四）→ `pdf.parser.ts`（§九）→ `plain-text.parser.ts`（§八）。
3. `parsed-result.store.ts`（§七）→ `parsing.service.ts`（§六）→ `processing.module.ts` → `app.module.ts` 注册。
4. `document.module.ts` imports + `document.service.ts` 追加暂存清理一行 → **回归 T04 删除用例**。
5. `src/scripts/parse-document.ts` + package.json script（§十）。
6. 回填 `00-overall-plan.md` v1.4（§十四）；README 更新。
7. `pnpm --filter server build` 0 error；`pnpm --filter web type-check` 0 error。
8. 执行 §十六全量验收。

---

## 十六、验收命令（Windows PowerShell 可执行）

> 前置：mysql/qdrant healthy；默认 `.env` 直连 Compose MySQL 成功；后端不需要常驻（CLI 脚本自建应用上下文）。
> **编码注意**：PowerShell 管道传中文会乱码（T03/T04 已踩坑）。含中文的断言用 Node 脚本读 JSON 比对，不在 PS 管道里直接 grep 中文。

```powershell
# 0. 静态检查（本任务零 migration）
pnpm --filter server build            # 0 error
pnpm --filter web type-check          # 0 error
pnpm --filter server migration:show   # 仅 2 条历史记录，无 pending、无新增

# 1. 准备：建测试知识库并上传三种文件（T04 接口）
curl.exe -X POST http://localhost:3000/api/knowledge-bases -H "Content-Type: application/json" -d "{\"name\":\"t05-parse-kb\"}"
mkdir tmp-test -Force

# 真实 PDF（人工准备项，T04 的 30 字节假 PDF 不可用）：
#   a. multi-cn.pdf：Word/WPS 造 ≥3 页中文文档，每页开头写"第N页标记"，另存为 PDF
#   b. one-en.pdf：任意单页英文 PDF
# 截断损坏 PDF：复制 multi-cn.pdf 后截掉尾部 1/4 字节
[System.IO.File]::WriteAllText("$PWD\tmp-test\notes.md", "# 标题`n`n中文正文 **加粗** 与 ``代码`` `n第二段")
[System.IO.File]::WriteAllText("$PWD\tmp-test\utf8.txt", "UTF-8 中文文本`n第二行")
[System.IO.File]::WriteAllBytes("$PWD\tmp-test\empty.txt", [byte[]]@())
[System.IO.File]::WriteAllText("$PWD\tmp-test\blank.txt", "   `n`t  ")
[System.IO.File]::WriteAllText("$PWD\tmp-test\gbk.txt", "GBK 编码中文", [System.Text.Encoding]::GetEncoding('GB2312'))

curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\multi-cn.pdf"   # 记 id=PDF_ID
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\one-en.pdf"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\notes.md"      # 记 id=MD_ID
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\utf8.txt"      # 记 id=TXT_ID
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\empty.txt"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\blank.txt"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\gbk.txt"
curl.exe -X POST http://localhost:3000/api/knowledge-bases/1/documents -F "file=@tmp-test\broken.pdf"

# 2. 三种格式解析成功
pnpm --filter server parse:document <PDF_ID>
# 预期：退出码 0；stdout JSON 含 parser="pdfjs"、pageCount=实际页数、totalChars>0
pnpm --filter server parse:document <MD_ID>
# 预期：parser="plaintext"、pageCount=1
pnpm --filter server parse:document <TXT_ID>

# 3. 状态与暂存断言
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT id,file_ext,status,error_message FROM document;"
# 预期：成功三件 status=pending、error_message=NULL（成功回 pending，不是 chunking/completed）
Get-ChildItem server\uploads\.parsed   # 预期：<PDF_ID>.json <MD_ID>.json <TXT_ID>.json，无 .tmp 残留

# 用 Node 脚本断言暂存内容（避免 PS 中文乱码）：
#   a. PDF：pages.length=实际页数；pageNo 为 1..N 连续；pages[i].text 含"第{i+1}页标记"；中文无乱码
#   b. MD：pages[0].pageNo === null；text 含'#'与'**'（证明未清洗）；fileHash 与 document 行一致
#   c. totalChars === pages 各 text.length 之和

# 4. 幂等
pnpm --filter server parse:document <PDF_ID>
# 预期：stdout 的 parsedAt 与首次完全一致（短路证据）；暂存文件内容字节级不变

# 5. 失败场景（均退出码 1，且 DB status=failed、error_message 匹配 §11.2 文案）
pnpm --filter server parse:document <empty.txt 的 id>   # 文件内容为空
pnpm --filter server parse:document <blank.txt 的 id>   # 文件内容为空
pnpm --filter server parse:document <gbk.txt 的 id>     # 文件编码无法识别...
pnpm --filter server parse:document <broken.pdf 的 id>  # PDF 文件损坏或格式无法解析
Get-ChildItem server\uploads\.parsed   # 预期：失败文档无对应 .json
# failed 文档重触发：结果恒定 failed，无副作用积累

# 6. 磁盘文件缺失容错：手动删除某已上传未解析文件的最终文件后触发
# 预期：failed，error_message=文件不存在或已被移动：{storagePath}

# 7. 删除联动
curl.exe -i -X DELETE http://localhost:3000/api/documents/<MD_ID>
# 预期：204；.parsed/<MD_ID>.json 同步消失；T04 删除回归（重复删除 404、并发删除 204/404/404）通过

# 8. 越界检查
curl.exe http://localhost:3000/api/docs-json
# 预期：paths 与 tags 与 T04 完全一致；无 processing/parse 相关条目
docker compose exec -T mysql mysql -uroot -proot123 -e "USE mini_rag; SELECT COUNT(*) FROM document_chunk;"
# 预期：0（本阶段禁止写 chunk）；全表无 chunking/embedding/completed 状态

# 9. 清理
curl.exe -X DELETE http://localhost:3000/api/documents/<各剩余 id>
curl.exe -X DELETE http://localhost:3000/api/knowledge-bases/1
Remove-Item -Recurse -Force tmp-test, server\uploads\1, server\uploads\.parsed -ErrorAction SilentlyContinue
# 预期：业务表回 0 行；migrations 表仍 2 条
```

---

## 十七、明确禁止（本任务一律不实现）

文本清洗（去页眉页脚、多余空白/空行归一化、`\r\n` → `\n`、trim 后改写原文）、文本切片、`DocumentChunk` 插入、Embedding、Qdrant（含 collection/upsert/search/delete）、`status=chunking/embedding/completed`、上传后自动触发解析、启动时状态重置钩子、Chat、SSE、会话接口、前端页面、文档详情切片预览、消息队列、定时任务、OCR / 图片型 PDF 支持、文件下载/预览、公开 HTTP 触发接口、新 migration、修改既有 migration 与任何实体、修改 `web/`、引入 `pdf-parse`、引入测试框架（T16 统一补）、GBK 转码兜底（除非执行 §八可选加固项并声明）。

## 十八、完成后必须输出的内容

1. **修改文件清单**：新增/修改分组列完整路径。
2. **核心实现说明**：重点 ① pdfjs-dist 2.16.105 选型理由与 CJS/ESM 兼容性证据 ② 状态机「成功回 pending」语义 ③ 暂存原子写与幂等短路 ④ 编码处理与 FFFD 判定的取舍 ⑤ 兼容层为何集中在单文件。
3. **启动方式**：DB 端口冲突的处理结果；解析触发命令。
4. **验证方式**：§十六逐条结果（成功/失败 + 关键输出；幂等项须附两次 `parsedAt` 对比；失败场景须附 DB 中 error_message 实际值）。
5. **已知问题**：含 GBK 明确失败策略、`parsing` 崩溃残留需手动重触发（T06 自愈）、时间偏移、`ParsePositiveIntPipe` 等遗留声明。
6. **未完成内容**：明确声明 §十七各项均未实现。
