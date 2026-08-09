# Bid Sentry M0–M1 实施计划

日期：2026-08-09

状态：已规划，待执行

## Goal

在空仓库中交付可安装、可测试的 Windows/Linux Electron 应用基础设施，以及首个完整业务里程碑“DOCX/PDF 元数据安全重置”。用户能够选择文件、预览处理类别、确认执行、获得经过内容不变验证的新文件和脱敏报告，并配置/测试自己的 OpenAI 兼容接口。

本计划只细化 M0 和 M1。M2 对照审查与 M3 资格标预制作继续由已批准的设计规格约束，待 M1 的文档适配器、任务模型和界面边界获得真实证据后分别制定实施计划。

## Architecture

采用单仓库 Electron + React + TypeScript 应用。Renderer 仅负责界面；Preload 仅暴露版本化 IPC；Main 拥有窗口、文件选择、设置、安全存储、网络和任务生命周期；独立 Electron Utility Process 执行文档解析与改写；`core/documents` 是格式安全的唯一所有者；`core/sanitization` 是清洗计划、验证和报告的唯一所有者；跨进程数据由 `shared/contracts` 中的 Zod Schema 约束。

AI 不参与 M1 文件修改。M0 只实现 OpenAI 兼容接口配置与连接测试，为 M2 提供经过安全存储和网络边界验证的基础。

## Tech Stack

- Node.js 22，pnpm 11。
- Electron 43、electron-vite 5、Vite 7、React 19、TypeScript 5.9。
- Zod 4：IPC、设置、任务、报告契约。
- yauzl/yazl：受限读取与重建 DOCX ZIP 包。
- @xmldom/xmldom + xpath：定点修改 OOXML 元数据和身份属性。
- pdf-lib：PDF Info/XMP/Trailer ID 修改和结构检查，封装在 PDF 适配器内。
- Vitest 4：单元、格式夹具和集成测试。
- Playwright 1.62：Electron 端到端测试。
- ESLint + Prettier：静态质量与格式检查。
- electron-builder 26：Windows x64 与 Linux x64 安装包。

依赖版本以首次执行时写入的 `pnpm-lock.yaml` 为准，不在运行时自动漂移。

## Baseline / Authority Refs

- `docs/aegis/specs/2026-08-09-bid-sentry-design.md`：已确认的产品与架构要求。
- `docs/aegis/BASELINE-GOVERNANCE.md`：需求与架构对齐规则。
- Git 基线：`48cafc14e96ad8ba24e11322281aa7f17480d76a`，分支 `main`，计划开始时仓库干净。

## Compatibility Boundary

- 正式目标：Windows x64、Linux x64。
- 输入：`.docx` 和 `.pdf`；拒绝 `.doc`、`.docm`、加密/损坏文件和带数字签名 PDF。
- 扫描 PDF 在 M1 可清洗元数据，因为该流程不依赖 OCR；扫描 PDF 仍不得进入未来的 M2/M3 内容流程。
- 原文件只读，永不覆盖；输出为 `<原名>_sanitized.<扩展名>`。
- AI 配置只支持 OpenAI 兼容的 Base URL、API Key、模型名称、超时和最大并发；M1 不发送文档内容。
- 不引入数据库、服务端、自动更新、遥测或 LibreOffice 依赖。

## TDD Route

- Mode：off。
- Decision：skipped。
- Strict authority：not applicable。
- Test posture：完成每个最小变更后增加针对性回归、格式夹具和跨模块集成验证，不编排 RED/GREEN 仪式。
- Reason：用户和项目没有要求严格 TDD；通过高覆盖的后置格式验证与黄金夹具控制文档损坏风险。
- Verification：每个任务运行列出的 focused 命令；每个提交前运行 `pnpm lint && pnpm typecheck && pnpm test`，发布任务额外运行 E2E 和打包。

## Plan Basis

- Fact：仓库无业务代码，只有已确认设计规格和 Aegis 工作区。
- Fact：本机已有 Node `v22.22.2`、pnpm `11.18.0`、x86_64 Linux 和 `xvfb-run`。
- Fact：用户确认单机开源、用户自配 API、暂不支持 OCR、分阶段交付和强制文件安全规则。
- Assumption：首批真实用户主要使用 Windows/Linux x64 和标准 OOXML DOCX/PDF；通过合成复杂夹具与后续脱敏样例补足格式差异。
- Unknown：具体真实标书中非标准 OOXML/XMP 变体的比例；本计划用适配器兼容性门和拒绝策略约束，而不猜测支持。

## BaselineUsageDraft

- Required baseline refs：设计规格、Baseline Governance。
- Delivered context refs：用户确认的功能、部署、OCR、模板、API 和安全边界。
- Acknowledged before plan refs：用户于 2026-08-09 确认设计规格。
- Cited in plan refs：设计规格第 2、4.1、5、8、9、11、12 节。
- Missing refs：合法脱敏真实样例集与 Windows 实机运行证据。
- Decision：continue；真实样例作为 M1 发布前证据，Windows 证据由 CI 和实机检查补齐。

## Requirement Ready Check

- Requirement source refs：已批准设计规格。
- Goals and scope refs：规格第 1–3 节，本计划 Goal。
- User / scenario refs：规格第 4.1 节。
- Requirement item refs：规格第 5、8–11 节。
- Acceptance / verification criteria refs：规格第 12.1、12.2 节。
- Open blocker questions：无。
- Decision：ready。

## Change Necessity

- User-visible need：从空仓库得到能安全清洗 DOCX/PDF 元数据的跨平台桌面应用。
- No-change / non-code option：文档或脚本说明无法提供文件解析、随机重置、内容验证、桌面交互和安装包。
- Why code change is necessary：核心价值依赖确定性的本地文件处理、跨进程安全边界和自动验证。
- Minimum change boundary：Electron 骨架、版本化契约、设置/密钥、任务进程、DOCX/PDF 适配器、清洗编排、报告、UI 与构建验证。
- Decision：code-change。

## Existence Check

- Proposed new surfaces：Main/Preload/Renderer/Worker 边界、文档格式适配器、清洗所有者、AI 配置适配器、共享契约和报告 Schema。
- Existing owner / reuse candidate：空仓库无既有源代码所有者；Node/Electron 内建能力可复用进程、加密存储和网络功能。
- Why existing surface is insufficient：文件格式安全、清洗计划、AI 设置和 UI 权限具有不同不变量，不能由单个通用模块安全承载。
- Creation proof：每个表面有唯一调用方边界、失败模式和独立测试；规格已确认其责任分离。
- Entropy / retirement impact：保持单应用内部目录，不拆 npm 包、不建数据库、不增加服务；无旧路径需要保留。
- Decision：add-with-proof。

## Architecture Integrity Lens

- Invariant：原文件只读；AI/Renderer 不写文件；验证失败不产生最终输出。
- Canonical owner / contract：`core/documents` 拥有格式读写，`core/sanitization` 拥有清洗计划与报告，Zod Schema 是跨进程契约。
- Responsibility overlap：Main 只调度，Worker 只执行，Renderer 只展示和确认。
- Higher-level simplification：DOCX/PDF 都实现相同 `DocumentAdapter`，共用输入快照、输出提交、报告和任务状态机。
- Retirement / falsifier：无旧路径；若 pdf-lib 或 OOXML 重建不能证明非目标内容不变，对应适配器停止进入发布路径，不增加“忽略验证”回退。
- Verdict：proceed。

## Ripple Signal Triage

- Signals：共享契约、跨进程生产者/消费者、文件输出事实来源、格式适配器和未来 M2/M3 消费者。
- Canonical owners：契约在 `shared/contracts`，内容指纹在格式适配器，最终报告在 `core/sanitization`。
- Source-of-truth risk：输出状态只能由 `VerificationReport.status === "passed"` 提升为 completed；UI 不自行推断。
- Downstream consumers：Main 任务管理器、Renderer 进度/报告页、HTML 报告渲染器、未来审查/生成模块。
- Verification expansion：契约单元测试 + Worker/Main 集成测试 + Electron E2E + 安装包构建。
- Decision：按共享契约向外辐射验证，不在调用方增加格式判断或备用完成条件。

## File Map

### 根目录和构建

- `package.json`：唯一脚本和依赖清单。
- `pnpm-lock.yaml`：可复现依赖解析。
- `electron.vite.config.ts`：Main、Preload、Renderer 与 Worker 构建入口。
- `electron-builder.yml`：Windows/Linux 打包目标和资源规则。
- `tsconfig.json`、`tsconfig.node.json`、`tsconfig.web.json`：严格类型边界。
- `eslint.config.mjs`、`.prettierrc.json`、`.prettierignore`：质量规则。
- `.gitignore`：构建、缓存、临时和本地密钥文件。
- `.github/workflows/ci.yml`：Linux/Windows 检查与构建矩阵。

### Electron 边界

- `src/main/index.ts`：BrowserWindow 与安全参数。
- `src/main/ipc/registerIpc.ts`：唯一 IPC 注册入口。
- `src/main/settings/settingsService.ts`：普通设置与安全密钥组合。
- `src/main/settings/secretStore.ts`：`safeStorage` 适配器和测试接口。
- `src/main/ai/openAiCompatibleClient.ts`：连接测试，不处理文档。
- `src/main/tasks/taskManager.ts`：任务状态、Utility Process、取消和消息校验。
- `src/preload/index.ts`：最小 `window.bidSentry` API。
- `src/worker/index.ts`：Worker 消息入口。

### 核心与契约

- `src/shared/contracts/settings.ts`：AI 设置 Schema。
- `src/shared/contracts/documents.ts`：文件类型、输入快照、元数据字段类别。
- `src/shared/contracts/sanitization.ts`：预览、命令、进度、验证、报告 Schema。
- `src/shared/contracts/ipc.ts`：IPC channel 常量和 request/response Schema。
- `src/shared/contracts/errors.ts`：稳定错误码和用户安全消息。
- `src/core/documents/documentAdapter.ts`：DOCX/PDF 共同接口。
- `src/core/documents/fileSafety.ts`：魔数、大小、路径、哈希和原子输出。
- `src/core/documents/docx/*`：ZIP 限制、OOXML 扫描、修改和验证。
- `src/core/documents/pdf/*`：加密/签名检测、Info/XMP 修改和页面内容验证。
- `src/core/sanitization/randomMapping.ts`：加密安全随机值与同文档一致映射。
- `src/core/sanitization/sanitizeJob.ts`：预览/执行的唯一编排器。
- `src/core/sanitization/report.ts`：JSON 事实来源与 HTML 渲染。

### Renderer

- `src/renderer/index.html`、`src/renderer/src/main.tsx`：入口。
- `src/renderer/src/App.tsx`：清洗和设置两个顶层页面。
- `src/renderer/src/api/bidSentryApi.ts`：Preload 类型安全客户端。
- `src/renderer/src/features/sanitizer/*`：选择、预览、确认、进度和报告。
- `src/renderer/src/features/settings/*`：AI 设置与连接测试。
- `src/renderer/src/styles.css`：无远程字体/资源的响应式样式。

### 测试和文档

- `tests/unit/**/*`：随机、契约、安全、设置与错误测试。
- `tests/fixtures/builders/docxFixture.ts`：按需生成 OOXML 夹具。
- `tests/fixtures/builders/pdfFixture.ts`：按需生成 PDF 夹具。
- `tests/integration/**/*`：适配器、清洗任务和报告测试。
- `tests/e2e/app.spec.ts`：Electron 用户路径。
- `playwright.config.ts`、`vitest.config.ts`：测试入口。
- `README.md`：安装、开发、安全边界和 M1 使用说明。
- `CONTRIBUTING.md`：贡献和格式夹具要求。

## Plan Pressure Test

- Owner / contract / retirement：所有新增责任都有单一所有者；无旧逻辑或兼容路径需要退休。
- Architecture integrity / higher-level path：统一 `DocumentAdapter`、任务状态和报告 Schema，避免 UI/Main 重复判断格式。
- Verification scope：从纯函数、格式夹具、进程契约、UI 到双平台构建均有命令。
- Task executability：任务按基础设施、契约、安全、格式、编排、UI、发布顺序，前置关系明确。
- Pressure result：proceed。

## Plan-Time Complexity Check

### Complexity Budget

- Artifact class：Source Complexity、Test Complexity、Build Complexity。
- Target files / artifacts：格式适配器、任务管理器、共享 Schema、夹具生成器和 E2E。
- Current pressure：无源代码。
- Projected post-change pressure：DOCX/PDF 适配器具有分支和第三方库耦合风险；UI 状态机具有异步状态增长风险。
- Budget result：at-risk。
- Planned governance：按格式和阶段拆文件；解析、计划、写入、验证分离；UI 消费共享任务状态；拒绝通用 `utils.ts` 和巨型适配器。

### Boundary Decision

- Target files：`src/core/documents/docx/*`、`src/core/documents/pdf/*`、`src/core/sanitization/*`。
- Existing size / shape signals：新文件，无历史压力。
- Owner fit：每个文件仅承担安全检查、元数据扫描、改写或验证之一。
- Add-in-place risk：将 DOCX/PDF 放入同一实现会混合 ZIP/XML 与 PDF 对象模型。
- Better file boundary：共享接口 + 两个独立格式目录 + 共同编排器。
- Recommendation：add owner files；任一维护源文件接近 500 行时先按解析/写入/验证责任拆分，不等待 800 行压力线。

## Tasks

### Task 1：建立可构建的 Electron 安全骨架

**Files**

- Create：`package.json`、`pnpm-lock.yaml`、`electron.vite.config.ts`、`electron-builder.yml`、`tsconfig*.json`、`eslint.config.mjs`、`.prettierrc.json`、`.prettierignore`、`.gitignore`。
- Create：`src/main/index.ts`、`src/preload/index.ts`、`src/worker/index.ts`、`src/renderer/index.html`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`。

**Why**

提供后续所有功能依赖的安全进程边界、可复现工具链和跨平台构建入口。

**Change Necessity**

空仓库无法运行或打包；最小边界是一个禁用 Renderer Node 权限、包含独立 Worker 构建入口的 Electron 应用。

**Impact / Compatibility**

- BrowserWindow 固定 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Renderer CSP 只允许本地脚本/样式，不允许远程资源。
- Worker 入口构建为稳定文件名 `worker.js`，供 Main 后续启动。

**Steps**

1. 创建 `package.json`，设置 `name: "bid-sentry"`、`type: "module"`、`packageManager: "pnpm@11.18.0"`、`engines.node: ">=22"`，并定义 `dev`、`build`、`lint`、`typecheck`、`test`、`test:e2e`、`package:win`、`package:linux` 脚本。
2. 安装固定主版本依赖：`pnpm add react@19 react-dom@19 zod@4 pdf-lib@1 yauzl@3 yazl@3 @xmldom/xmldom@0.9 xpath@0.0.34 @electron-toolkit/preload @electron-toolkit/utils`。
3. 安装开发依赖：`pnpm add -D electron@43 electron-vite@5 vite@7 @vitejs/plugin-react@5 typescript@5.9.3 electron-builder@26 vitest@4 @vitest/coverage-v8 @playwright/test@1.62 eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier @types/node @types/react @types/react-dom @types/yauzl @types/yazl`；在 `pnpm-workspace.yaml` 中只允许 Electron、esbuild 和 electron-winstaller 执行安装脚本。
4. 创建三个严格 TypeScript 配置：Node 侧启用 `noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`，Web 侧只包含 DOM/React，根配置只做 project references。
5. 配置 electron-vite 的 Main 多入口 `index`/`worker`、Preload 入口和 React Renderer；输出名固定为 `[name].js`。
6. 创建仅显示“Bid Sentry / 文档安全助手”的最小界面和本地 CSS，不引用 CDN、远程字体或内联脚本。
7. 创建 BrowserWindow，设置安全 webPreferences、外部导航拦截、生产环境本地文件加载和开发环境 Vite URL 加载。
8. 创建空白 Preload API 和 Worker 消息循环，未知消息返回稳定错误而不执行操作。
9. 运行 `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`；预期全部退出码为 0，`out/main/index.js`、`out/main/worker.js`、sandbox 可执行且除 Electron 内建模块外无运行时 `require` 的 CommonJS `out/preload/index.cjs` 和 Renderer 产物存在。

**Verification**

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
test -f out/main/index.js
test -f out/main/worker.js
test -f out/preload/index.cjs
```

提交：`chore: scaffold secure electron application`

### Task 2：定义版本化共享契约与错误模型

**Files**

- Create：`src/shared/contracts/settings.ts`、`documents.ts`、`sanitization.ts`、`ipc.ts`、`errors.ts`、`index.ts`。
- Create：`tests/unit/contracts.test.ts`。

**Why**

确保 Main、Worker、Preload 和 Renderer 对任务、报告和失败状态使用同一事实来源，避免调用方自行解析或猜测完成状态。

**Change Necessity**

跨进程数据不能依赖 TypeScript 编译期类型；最小边界是带版本号的 Zod Schema 和稳定错误码。

**Impact / Compatibility**

- `schemaVersion` 首版固定为 `1`。
- 任务状态只允许 `created | previewing | awaiting-confirmation | running | verifying | completed | failed | cancelled`。
- `completed` 必须携带 `verification.status: "passed"`。
- 错误码包含：`UNSUPPORTED_TYPE`、`FILE_TOO_LARGE`、`FILE_CHANGED`、`ENCRYPTED_FILE`、`SIGNED_PDF`、`INVALID_DOCUMENT`、`UNSAFE_ARCHIVE`、`OUTPUT_EXISTS`、`AI_CONFIG_INVALID`、`AI_CONNECTION_FAILED`、`TASK_CANCELLED`、`INTERNAL_ERROR`。

**Steps**

1. 定义只读 `AiSettingsSchema`，字段为 Base URL、model、timeoutMs（5,000–120,000）、maxConcurrency（1–4）和 `hasApiKey`；另定义只用于用户单向提交的 `AiSettingsUpdateSchema`，可携带本次输入的 Key，但任何 Main 响应均不得回显已保存明文 Key。
2. 定义 `InputSnapshotSchema`，包含规范路径、displayName、类型、size、sha256、mtimeMs；路径只在 Main/Worker 契约出现，报告只保存 displayName 和哈希。
3. 定义 `SanitizationPreviewSchema`、`SanitizationCommandSchema`、`TaskProgressSchema`、`VerificationReportSchema`、`SanitizationReportSchema`，并用 Zod refine 强制 completed/verified 约束。
4. 定义 IPC channel 常量，只有 `settings:get`、`settings:save`、`settings:test-ai`、`files:select-inputs`、`files:select-output`、`sanitize:preview`、`sanitize:execute`、`task:cancel`、`task:subscribe`。
5. 定义 `AppErrorSchema` 和从未知异常到安全用户消息的映射；内部堆栈不通过 IPC。
6. 在 `contracts.test.ts` 覆盖合法解析、未知字段拒绝、明文 Key 拒绝、非法状态转换拒绝和 completed 无验证拒绝。
7. 运行 `pnpm vitest run tests/unit/contracts.test.ts && pnpm typecheck`；预期所有契约测试通过且无类型错误。

**Verification**

```bash
pnpm vitest run tests/unit/contracts.test.ts
pnpm typecheck
```

提交：`feat: define versioned desktop contracts`

### Task 3：实现设置、安全密钥与 OpenAI 兼容连接测试

**Files**

- Create：`src/main/settings/secretStore.ts`、`settingsService.ts`。
- Create：`src/main/ai/openAiCompatibleClient.ts`。
- Create：`tests/unit/settingsService.test.ts`、`openAiCompatibleClient.test.ts`。

**Why**

满足单机开源项目“用户自配 API Key”的基础要求，并保证已保存 Key 不以明文落盘、不能被 Renderer 读回且不进入日志。

**Change Necessity**

普通 JSON 配置无法安全保存 Key；最小边界是 `SecretStore` 接口、Electron `safeStorage` 实现和只返回 `hasApiKey` 的设置服务。

**Impact / Compatibility**

- 普通配置写入 `app.getPath("userData")/settings.v1.json`。
- 加密 Key 写入 `secrets.v1.bin`；若 `safeStorage.isEncryptionAvailable()` 为 false，只保存在进程内并在 UI 提示“本次会话有效”。
- Base URL 必须是 HTTPS；仅 `127.0.0.1`、`localhost`、`[::1]` 可显式允许 HTTP。
- 连接测试调用 `<base>/models`，15 秒超时；401、403、404、429 和网络错误使用不同安全消息。

**Steps**

1. 定义 `SecretStore` 的 `getApiKey`、`setApiKey`、`clearApiKey` 和 `persistence` 接口，并实现 ElectronSafeStorageSecretStore 与测试用 MemorySecretStore。
2. 实现 SettingsService 的默认设置、Schema 迁入、临时文件 + 原子重命名保存、损坏配置隔离和不返回明文 Key。
3. 实现 URL 规范化，移除末尾 `/`，禁止凭据嵌入 URL，HTTP 仅允许环回地址。
4. 用 Node 内建 `fetch` 实现 `/models` 连接测试，使用 AbortController 超时，响应正文最多读取 4 KiB，日志只记录状态码与主机名。
5. 测试 Key 不出现在配置 JSON/服务返回值/错误文本，测试无安全存储时会话模式，测试各 HTTP 状态和超时映射。
6. 运行 `pnpm vitest run tests/unit/settingsService.test.ts tests/unit/openAiCompatibleClient.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/unit/settingsService.test.ts tests/unit/openAiCompatibleClient.test.ts
pnpm typecheck
```

提交：`feat: add secure user-managed ai settings`

### Task 4：实现输入快照、路径安全与原子输出

**Files**

- Create：`src/core/documents/fileSafety.ts`、`documentAdapter.ts`。
- Create：`tests/unit/fileSafety.test.ts`。

**Why**

在接触格式细节之前固定原文件只读、文件未变化、类型可信和验证后落盘等强制边界。

**Change Necessity**

扩展名检查和直接写目标文件不能保证安全；最小边界是统一输入快照、魔数识别、受限临时目录和原子 finalize。

**Impact / Compatibility**

- 单文件默认上限 200 MiB。
- DOCX 必须同时满足 ZIP 魔数、`[Content_Types].xml` 和 Word 主文档关系；普通 ZIP 拒绝。
- PDF 必须以 `%PDF-` 开始。
- 临时目录创建于目标目录同一文件系统下的 `.bid-sentry-tmp-<随机值>`，finalize 前重新计算输入哈希。
- 输出已存在时返回 `OUTPUT_EXISTS`，不自动覆盖或编号。

**Steps**

1. 实现流式 SHA-256、规范路径解析、符号链接输入拒绝、文件类型魔数识别和 `InputSnapshot` 创建。
2. 实现 `assertInputUnchanged`，同时校验 size、mtimeMs 和 sha256；任何一项变化返回 `FILE_CHANGED`。
3. 实现目标文件名生成和输出冲突检查，使用权限 `0o600` 创建临时文件。
4. 实现 `finalizeVerifiedOutput`，只接受 `VerificationReport.status === "passed"`，先 fsync 文件再在同一目录原子重命名。
5. 实现失败/取消清理，清理函数只能删除任务记录的确切临时路径，拒绝目录根、用户目录和未登记路径。
6. 定义 `DocumentAdapter` 的 `inspect`、`createPlan`、`sanitizeToTemp`、`verify` 方法和 AbortSignal 参数。
7. 测试扩展名伪装、符号链接、200 MiB 边界、输出冲突、输入中途变化、未验证 finalize 和受限清理。
8. 运行 `pnpm vitest run tests/unit/fileSafety.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/unit/fileSafety.test.ts
pnpm typecheck
```

提交：`feat: enforce immutable document input boundary`

### Task 5：实现随机映射和脱敏报告事实来源

**Files**

- Create：`src/core/sanitization/randomMapping.ts`、`report.ts`。
- Create：`tests/unit/randomMapping.test.ts`、`report.test.ts`。

**Why**

保证所有格式使用相同的非空、同类型、同文档一致随机策略，并确保报告不会泄露清洗前后的敏感值。

**Change Necessity**

格式适配器各自生成随机值会产生不一致和泄漏风险；最小边界是一个无格式依赖的随机映射所有者和一个报告所有者。

**Impact / Compatibility**

- 使用 `node:crypto` 的 `randomBytes`/`randomUUID`，不使用 `Math.random`。
- 同文件同原值映射一致，不同文件无共享映射或种子。
- 时间不晚于任务开始时间，并保持 created <= modified。
- JSON 报告是事实来源；HTML 仅转义并渲染同一对象。

**Steps**

1. 实现人员、缩写、组织、UUID、描述、数字、布尔和时间类型生成器，所有字符串均非空且不伪造真实企业名。
2. 实现以字段类别 + 原值哈希为键的任务内映射，禁止暴露映射键和种子。
3. 实现 created/modified 有序时间对生成器，固定注入时钟以便测试。
4. 实现 `buildSanitizationReport`，报告仅包含字段名、类别、状态、警告、输入/输出哈希和验证摘要。
5. 实现无脚本 HTML 渲染器，对文件名、警告和错误做实体转义，禁止嵌入正文或元数据值。
6. 测试 1,000 次非空/类型/时间约束、跨任务差异、同任务一致、原值与随机值不出现在 JSON/HTML、HTML 注入转义。
7. 运行 `pnpm vitest run tests/unit/randomMapping.test.ts tests/unit/report.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/unit/randomMapping.test.ts tests/unit/report.test.ts
pnpm typecheck
```

提交：`feat: add privacy-safe randomization and reports`

### Task 6：实现 DOCX 安全适配器

**Files**

- Create：`src/core/documents/docx/archive.ts`、`inspect.ts`、`metadata.ts`、`sanitize.ts`、`verify.ts`、`index.ts`。
- Create：`tests/fixtures/builders/docxFixture.ts`。
- Create：`tests/integration/docxSanitizer.test.ts`。

**Why**

交付 DOCX Core/Extended/Custom Properties 及评论/修订身份属性的安全随机重置，同时证明正文、图片、关系和版式相关部件未被意外改变。

**Change Necessity**

通用 ZIP/XML 库不会自动实现 OOXML 关系、路径和内容不变约束；最小边界是受限归档读取、定点元数据修改和 OOXML 专用验证器。

**Impact / Compatibility**

- ZIP 最多 10,000 个条目、总展开大小 1 GiB、单条目 256 MiB、压缩比 100:1；非法路径、重复条目和加密条目拒绝。
- 仅修改规格第 5.2 节列出的属性和 `w:author`、`w:initials`、`w:date` 身份属性。
- 未批准部件逐字节保持；含身份属性的 XML 部件以移除批准属性后的规范化 XML 哈希比较。

**Steps**

1. 用 yauzl lazyEntries 实现受限读取，逐条检查路径、大小、压缩比、重复名和取消信号；用 yazl 按原条目顺序重建。
2. 解析 `[Content_Types].xml` 和 `_rels/.rels`，确认 Word 主文档，拒绝宏启用内容类型和外部主文档关系。
3. 实现 Core、Extended、Custom Properties 扫描，保留页数/字数等内容统计值，按属性类型形成 `SanitizationPlan`。
4. 扫描 `word/**/*.xml` 中评论和修订元素的身份属性，只记录字段类别和节点锚点，不记录原值。
5. 用 DOM + namespace XPath 定点替换已批准属性；缺失属性不凭空增加，类型无效的 Custom Property 返回可解释警告并不修改。
6. 重建 DOCX 到任务临时文件，并重新解析确认包结构和关系完整。
7. 实现验证器：批准元数据部件按目标属性验证非空随机值；未批准部件字节哈希一致；身份 XML 移除批准属性后规范化哈希一致；正文文本、图片和关系摘要一致。
8. 夹具生成器创建包含段落、表格、图片占位字节、页眉、页脚、Core/App/Custom Properties、评论、修订和外部关系提示的合成 DOCX，不提交真实敏感文件。
9. 集成测试覆盖正常清洗、同身份一致映射、内容统计保留、评论正文保留、ZIP bomb 指标、路径穿越、DOCM 伪装、损坏关系、取消和验证失败不落盘。
10. 运行 `pnpm vitest run tests/integration/docxSanitizer.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/integration/docxSanitizer.test.ts
pnpm typecheck
```

停止条件：如果所选 XML/ZIP 组合不能稳定保持未批准部件或规范化比较无法区分身份属性与正文变化，停止 DOCX 发布路径并回到适配器边界评审，不添加“最佳努力保存”。

提交：`feat: sanitize docx metadata without content drift`

### Task 7：实现 PDF 安全适配器

**Files**

- Create：`src/core/documents/pdf/inspect.ts`、`metadata.ts`、`fingerprint.ts`、`sanitize.ts`、`verify.ts`、`index.ts`。
- Create：`tests/fixtures/builders/pdfFixture.ts`。
- Create：`tests/integration/pdfSanitizer.test.ts`。

**Why**

交付 PDF Info、XMP 和 Trailer ID 的随机重置，拒绝签名/加密文件，并证明页面及其非目标对象不变。

**Change Necessity**

PDF 重写可能改变页面对象或签名有效性；最小边界是 PDF 专用签名检测、元数据操作、页面指纹和发布阻断验证器。

**Impact / Compatibility**

- 文件上限 200 MiB、页数上限 2,000。
- 同时检查 AcroForm `/FT /Sig`、签名字典、`/ByteRange` 与相关引用；任一可靠签名证据都拒绝。
- 任何加密标记或 pdf-lib 加密错误都映射为 `ENCRYPTED_FILE`，不使用 ignoreEncryption。
- 允许变化的对象仅为 Info、Metadata XMP 流和 Trailer ID；页面树、MediaBox/CropBox、Resources、Contents、Annots、Names/EmbeddedFiles 指纹必须一致。

**Steps**

1. 用 pdf-lib `PDFDocument.load(bytes, { updateMetadata: false })` 实现结构加载，检查加密、页数和取消信号。
2. 遍历 AcroForm 字段与引用对象检测签名，并以原始字节 `/ByteRange` 作为补充证据；将检测理由写入安全错误详情但不输出文档内容。
3. 扫描 Info Dictionary 和 XMP 中的规格字段，形成类型化清洗计划；未知 XMP namespace 保持原样。
4. 实现 Info setter、XMP DOM 定点替换和 Trailer ID 更新；不调用会自动覆盖其他元数据的默认更新路径。
5. 实现页面/非目标指纹：页数、页框、旋转、内容流字节、Resources、Annots、附件名称与字节哈希；对象编号变化不影响语义指纹。
6. 写入临时 PDF 后重新加载，验证目标字段非空随机、签名不存在、页面/附件/注释指纹一致。
7. 夹具生成器创建多页、字体资源、图片、注释、附件、Info/XMP/Trailer ID、AcroForm 签名和加密拒绝样例；签名样例不含真实证书。
8. 集成测试覆盖正常清洗、扫描页面 PDF、Info/XMP 同步、附件保留、签名拒绝、加密拒绝、损坏文件、输出验证故意失败和取消。
9. 运行 `pnpm vitest run tests/integration/pdfSanitizer.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/integration/pdfSanitizer.test.ts
pnpm typecheck
```

停止条件：如果 pdf-lib 写回会改变任何页面内容、资源、注释或附件语义指纹，停止 PDF 发布路径并评估新的单一适配器实现；不保留两个并行写入器，也不允许用户跳过验证。

提交：`feat: sanitize pdf metadata with structural verification`

### Task 8：实现清洗任务编排、Worker 和 IPC

**Files**

- Create：`src/core/sanitization/sanitizeJob.ts`。
- Create：`src/main/tasks/taskManager.ts`、`src/main/ipc/registerIpc.ts`。
- Modify：`src/main/index.ts`、`src/preload/index.ts`、`src/worker/index.ts`。
- Create：`tests/integration/sanitizeJob.test.ts`、`taskManager.test.ts`。

**Why**

把已验证格式能力连接成可取消、可预览、需确认、失败可清理的实际桌面任务，而不让 Main 或 UI 复制业务判断。

**Change Necessity**

直接从 UI 调用适配器会破坏权限边界和任务一致性；最小边界是 Main 任务管理器 + Utility Process + Schema 校验消息协议。

**Impact / Compatibility**

- 每个任务一个 Utility Process；并发默认 1，最大 2 个清洗任务。
- 预览阶段只读取和扫描，不写输出。
- execute 必须携带预览生成的 planDigest；输入或计划变化后旧确认失效。
- 取消、进程崩溃、Schema 错误和超时都进入单一失败/清理路径。

**Steps**

1. 实现 `sanitizeJob.preview`：创建输入快照、选择适配器、inspect、createPlan、计算 planDigest，并返回不含原值的预览。
2. 实现 `sanitizeJob.execute`：校验 planDigest 和输入快照、创建任务临时区、适配器写临时文件、验证、finalize、写 JSON/HTML 报告。
3. Worker 只接受 `preview`、`execute`、`cancel` 三类版本化消息；每次输出进度、结果或稳定错误，未知消息拒绝。
4. TaskManager 启动 Utility Process，维护允许的状态转换、订阅者和 Abort/kill 超时；进程退出后清理临时路径。
5. registerIpc 对每个 request/response 做 Zod 校验，文件选择使用 Electron dialog，Renderer 不能提交任意未选择路径。
6. Preload 只暴露设置、文件选择、清洗、取消和事件退订 API；事件订阅返回幂等 unsubscribe。
7. 集成测试覆盖预览无写入、未确认执行拒绝、planDigest 过期、输入变化、Worker 崩溃、取消、成功落盘和报告一致。
8. 运行 `pnpm vitest run tests/integration/sanitizeJob.test.ts tests/integration/taskManager.test.ts && pnpm typecheck`。

**Verification**

```bash
pnpm vitest run tests/integration/sanitizeJob.test.ts tests/integration/taskManager.test.ts
pnpm typecheck
```

提交：`feat: orchestrate verified sanitization jobs`

### Task 9：实现清洗与设置用户界面

**Files**

- Create：`src/renderer/src/api/bidSentryApi.ts`。
- Modify：`src/renderer/src/App.tsx`、`styles.css`。
- Create：`src/renderer/src/features/sanitizer/SanitizerPage.tsx`、`FileSelection.tsx`、`PreviewPanel.tsx`、`TaskProgress.tsx`、`ResultPanel.tsx`、`useSanitizationTask.ts`。
- Create：`src/renderer/src/features/settings/SettingsPage.tsx`、`useSettings.ts`。
- Create：`tests/unit/sanitizerState.test.ts`。

**Why**

提供非技术用户可理解的文件选择、修改预览、明确确认、进度、失败恢复和结果入口。

**Change Necessity**

命令行或隐藏后台逻辑不能满足桌面工具使用场景；最小边界是两个页面和一个由共享任务状态驱动的 UI 状态机。

**Impact / Compatibility**

- 中文为首期界面语言，文案不承诺法律结论。
- 清洗按钮在预览确认前禁用。
- 原值和随机后值均不显示，只展示字段类别和数量。
- 失败后允许返回文件选择；不得复用过期 planDigest。
- 设置页 Key 输入保存后立即清空，只显示“已保存/会话使用”。

**Steps**

1. 创建 bidSentryApi 客户端，所有 Preload 响应再次用共享 Schema 解析，拒绝 Renderer 本地伪造 completed 状态。
2. 实现清洗状态 reducer/hook，完整覆盖 idle、selecting、previewing、awaiting-confirmation、running、verifying、completed、failed、cancelled。
3. 实现系统文件选择和输出目录选择；展示文件名、类型、大小和拒绝原因，不展示完整本机路径。
4. 实现预览面板，按文件显示将修改的字段类别、警告和数字签名/加密阻断结果。
5. 实现明确确认复选框、执行按钮、阶段进度、取消按钮和不可忽略验证提示。
6. 实现结果页，显示新文件、JSON/HTML 报告和“原文件未修改”；打开路径通过受限 Main API 完成，不允许任意 shell 命令。
7. 实现设置页，校验 Base URL/模型/超时/并发，Key 不回显；连接测试明确区分认证、限流、模型列表不支持和网络错误。
8. 添加键盘焦点、ARIA label、对比度和 1024×720 最小窗口布局；所有资源本地加载。
9. 测试 reducer 的每条允许/拒绝转换、取消、过期确认和 completed 验证约束。
10. 运行 `pnpm vitest run tests/unit/sanitizerState.test.ts && pnpm typecheck && pnpm build`。

**Verification**

```bash
pnpm vitest run tests/unit/sanitizerState.test.ts
pnpm typecheck
pnpm build
```

提交：`feat: add sanitizer and ai settings interface`

### Task 10：完成 E2E、双平台 CI、打包和 M1 文档

**Files**

- Create：`playwright.config.ts`、`vitest.config.ts`、`tests/e2e/app.spec.ts`、`src/main/e2e/e2eHarness.ts`。
- Create：`.github/workflows/ci.yml`。
- Modify：`electron-builder.yml`、`electron.vite.config.ts`、`package.json`、`pnpm-workspace.yaml`、`src/main/index.ts`。
- Create：`scripts/audit-package.mjs`、`README.md`、`CONTRIBUTING.md`、`LICENSE`。
- Modify：`docs/aegis/specs/2026-08-09-bid-sentry-design.md` 仅在实际证据要求修正规格时修改。

**Why**

证明 M0–M1 在真实 Electron 进程和 Windows/Linux 构建环境中可用，并为开源用户提供清晰的安全边界和贡献入口。

**Change Necessity**

单元测试不能证明 Electron IPC、Utility Process、文件选择后流程和打包资源正确；最小边界是 E2E、双平台 CI、安装包配置和用户文档。

**Impact / Compatibility**

- Linux 产物：AppImage 和 deb（x64）。
- Windows 产物：NSIS 安装包和 portable（x64）。
- CI 不使用真实 API Key，不上传测试文档或任务报告。
- 发布产物暂不签名；README 明确 Windows SmartScreen/Linux 权限提示，后续签名不改变功能契约。

**Steps**

1. 配置 Playwright Electron 启动已构建应用，测试安全 webPreferences、设置表单、合成 DOCX 选择、预览、确认、完成、报告和取消路径。
2. 为文件选择 IPC 提供仅测试构建启用的固定夹具注入；开关只接受 `BID_SENTRY_E2E=1`，生产打包配置明确排除测试入口。
3. 在 Linux 本机运行 `pnpm build && xvfb-run -a pnpm playwright test`，预期全部 E2E 通过。
4. 配置 GitHub Actions 的 ubuntu-latest/windows-latest 矩阵：checkout、pnpm、Node 22、冻结安装、lint、typecheck、test、build；两平台都跑真实 Electron E2E，并各自生成、审计和启动未发布安装包 artifact。
5. 配置 electron-builder 的 appId、productName、asar、文件白名单和 Windows/Linux targets；M1 不配置自定义图标，并禁止把 `.env`、测试夹具、日志和 docs/aegis 打入应用。
6. README 记录功能范围、隐私模型、支持格式、拒绝条件、安装、开发命令、AI Key 存储行为和“不替代人工复核”。
7. CONTRIBUTING 记录无真实标书/个人信息夹具政策、格式适配器停止条件、提交前命令和安全问题报告方式。
8. 运行全量本机门：`pnpm lint && pnpm typecheck && pnpm test --run && pnpm build && xvfb-run -a pnpm test:e2e && pnpm package:linux`。
9. 用 `pnpm audit:package` 检查安装包内容不含 `.env`、`settings.v1.json`、`secrets.v1.bin`、测试夹具、E2E 入口或任务报告；直接启动解包后的生产应用完成 ASAR/Preload/Renderer 冒烟测试，合成 DOCX 全流程由真实 Electron E2E 证明。
10. 对照设计规格第 12.2 节记录 M1 验收证据；若实现验证迫使架构决策变化，先更新设计规格并审阅，随后执行 ADR Backfill Check，不从计划直接创建未经验证 ADR。

**Verification**

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
xvfb-run -a pnpm test:e2e
pnpm package:linux
pnpm audit:package
BID_SENTRY_PACKAGED_APP=release/linux-unpacked/bid-sentry xvfb-run -a pnpm test:e2e:packaged
python /root/.codex/aegis/scripts/aegis-workspace.py check --root /vol1/1000/docker/dpanel/compose/bid-sentry
git diff --check
```

停止条件：Windows CI 未通过、任一安装包包含密钥/测试私有数据、E2E 绕过用户确认、或格式验证存在未解决失败时，不声明 M1 完成或发布就绪。

提交：`docs: complete m1 release evidence and guidance`

## Verification Matrix

| Slice | Direct evidence | Regression evidence | Host evidence |
| --- | --- | --- | --- |
| M0 骨架 | build/typecheck/lint | 基础 Vitest | Linux 本机 + Windows/Linux CI |
| 设置与 Key | 设置/网络单测 | 契约与错误模型 | Electron 设置 E2E |
| 文件安全 | 路径/哈希/原子输出单测 | 任务取消与失败集成测试 | 临时文件/权限冒烟 |
| DOCX | OOXML 集成/黄金指纹 | 全量单元与任务集成 | Word/LibreOffice 手工打开 |
| PDF | PDF 结构/黄金指纹 | 全量单元与任务集成 | 主流 PDF 阅读器手工打开 |
| UI/任务 | reducer、IPC、Worker 集成 | 全量 Vitest | Playwright Electron E2E |
| 发布 | 安装包内容审计 | 全量质量门 | Linux 包 + Windows CI 包 |

## Risks and Controls

- **DOCX 重打包造成格式漂移**：未批准部件字节比较、身份 XML 规范化比较、复杂夹具和 Office/LibreOffice 打开测试；失败即停止该适配器。
- **PDF 库重写非目标对象**：页面/资源/注释/附件语义指纹；失败不提供跳过验证路径。
- **签名检测漏报**：AcroForm、签名字典、ByteRange 多证据检测；不确定状态按拒绝处理。
- **API Key 泄漏**：safeStorage、会话降级、Renderer 不可见、日志红线测试、打包内容审计。
- **跨进程状态漂移**：共享 Zod 契约、单一状态机、completed 必须包含 passed verification。
- **异步取消留下文件**：任务登记的精确临时路径、受限清理、进程退出统一收口。
- **计划过度预测 M2/M3**：当前只计划 M0/M1；后续基于已验证模块另写计划，不改变已批准产品规格。

## Retirement and Rollback

- 仓库无旧代码、旧契约、持久化数据或兼容路径，本计划无 Repair/Retirement 双轨迁移。
- 每个 Task 是独立验证和提交边界；出现回归时优先 `git revert <task-commit>`，不使用硬重置或清理用户文件。
- 设置 Schema v1 在 M0–M1 内不做迁移；损坏配置改名隔离并恢复默认值，密钥文件不自动删除。
- 若第三方格式库被兼容性门否决，删除该未发布适配器后再选择单一替代实现；不长期保留两个写入器或调用方 fallback。
- 输出文件由用户拥有；应用升级、回滚和卸载均不删除用户输出或报告。

## ADR / Baseline Sync Signals

- Electron/Utility Process 边界、`DocumentAdapter` 契约、VerificationReport 完成条件和格式库选择在 M1 证据完成后运行 ADR Backfill Check。
- 如果实现与规格完全一致且没有新的真实替代决策，只同步初始架构基线，不重复抄写规格。
- 如果格式库停止条件触发，先返回设计评审；计划不得自行添加第二写入器、兼容分支或降低验证标准。

## Execution Readiness View

- Intent Lock：完成 M0–M1，不提前实现 M2/M3。
- Scope Fence：仅单机 Electron、AI 配置测试、DOCX/PDF 元数据清洗、报告和双平台构建；无 OCR、服务端、数据库、自动更新。
- Baseline Lock：已批准设计规格 + Baseline Governance + Git `48cafc1`。
- Approved Behavior：预览后确认、原文件只读、非空随机值、签名/加密拒绝、验证通过后落盘。
- Owner / Contract Constraints：格式写入仅在 `core/documents`；清洗编排/报告仅在 `core/sanitization`；跨进程只用共享 Schema。
- Compatibility Boundary：Windows/Linux x64；DOCX/PDF；扫描 PDF 只清洗元数据。
- Retirement Boundary：无旧路径；被否决适配器删除，不增加并行 fallback。
- Task Batches：1–3 基础设施与契约；4–5 安全事实来源；6–7 格式适配器；8–9 产品串联；10 发布证据。
- Test Obligations：focused tests、每任务全量质量门、M1 E2E/打包/实机打开。
- Review Gates：Task 3 密钥边界、Task 6 DOCX 停止条件、Task 7 PDF 停止条件、Task 10 发布门。
- Drift / Rewind Rules：任何验证弱化、AI 直接写文件、原文件覆盖、调用方格式分支都视为 Implementation Drift，回到规格与最近通过提交。
- Evidence Required Before Completion：全量命令通过、格式指纹证据、Linux 安装包、Windows CI、无敏感内容打包审计。
- Advisory Boundary：method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority。

## Execution Route

- Decision：inline。
- Evidence：任务有明显顺序依赖，且当前仓库单一、干净；用户未要求并行代理工作。
- Fallback：按 Task 边界暂停并保留已验证提交，下一轮从最近通过的 Task 恢复。
- User confirmation required：no。
