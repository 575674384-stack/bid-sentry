# Bid Sentry `v1.0.0` 完整产品实施计划

日期：2026-08-10

状态：用户已确认；实施中

## Goal

以当前 `v0.1.0` 为基线，先复现并修复真实 Windows/Word DOCX 点击清洗后的执行失败，再完成元数据明细预览、可选托盘、GitHub Releases 在线更新、招投标文件对照审查和资格标模板预制作。全部内部质量门 G1–G5 通过后，只创建一个新公开版本 `v1.0.0`。

开发期间允许按任务形成可回滚、已验证的 Git 提交，但不得创建中间版本号、标签、公开安装包或 GitHub Release。用户已明确授权按本计划开始源代码实施。

## Architecture

继续使用单仓库 Electron + React + TypeScript：Renderer 只展示与收集确认；bundled CommonJS Preload 只暴露版本化 IPC；Main 拥有窗口、托盘、设置、安全存储、网络、更新和任务生命周期；Utility Process Worker 执行文档解析、清洗、模板裁剪、生成和验证。

已有 `core/documents` 保持文档格式读写与验证的唯一所有者。新增只读统一文档模型供审查和模板识别复用；`core/review` 拥有确定性规则、台账和问题合并；`core/generation` 拥有模板候选、填充计划和确定性生成；`core/ai` 拥有提供商无关的提示、分块、Schema 与锚点校验；`main/ai` 独占 OpenAI 兼容网络协议和 API Key。AI、Renderer 和更新模块均不能写文档。

Worker 只能在受限临时工作区生成候选输出。所有最终文档和报告继续复用 ADR-0001 的两阶段发布协议：Worker 写入并验证，Main 校验文件系统身份、哈希、报告和清理结果后才宣布完成。不存在第二写入器、跳过验证或“最佳努力”回退。

## Tech Stack

- 保留 Node.js 22、pnpm 11、Electron 43、electron-vite 5、React 19、TypeScript 5.9、Zod 4、Vitest 4、Playwright 1.62、electron-builder 26。
- 保留 yauzl/yazl、@xmldom/xmldom、xpath 和 pdf-lib，继续只在文档适配器内部使用。
- 计划新增 `pdfjs-dist@6.2.108`，只用于 Worker 中带文本层 PDF 的文本、坐标与页面结构读取；采用前必须通过取消、资源上限、CMap/字体和打包兼容性探针。
- 计划新增 `docx@9.7.1`，只用于把带文本层 PDF 的确认模板结构化重建为新 DOCX；DOCX 来源模板不得用它重新排版，而应直接裁剪和填充原 OOXML 包。
- 计划新增 `electron-updater@6.8.9`，只在 Main 中访问固定 GitHub Releases 源；Renderer 不得提供下载 URL。
- 依赖精确版本由采用任务写入 `pnpm-lock.yaml`；兼容性探针失败时停止采用并回到设计评审，不并存两个生产适配器。

## Baseline / Authority Refs

- `CONTEXT.md`：元数据安全重置、对照审查、资格标预制作、招标模板和内部质量门的统一语言。
- `docs/aegis/specs/2026-08-09-bid-sentry-design.md`：已确认的完整产品、隐私、安全、桌面和单次发布要求。
- `docs/aegis/BASELINE-GOVERNANCE.md`：需求/架构对齐和七维架构复核规则。
- `docs/aegis/adr/ADR-0001-verified-document-publication.md`：Main 所有的验证后发布、回滚、清理和文件系统身份协议。
- `docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md`：sandboxed bundled CommonJS Preload 构建边界。
- `docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md` 及对应 work/evidence：当前 M0–M1 的实现意图和历史验证，不再代表完整产品完成状态。
- Git 基线：`83222e834af53762faf629dcf48fe40d125c43e6`，分支 `main`，标签 `v0.1.0`；本计划开始前工作树干净。

## Compatibility Boundary

- 正式目标：Windows x64、Linux x64；macOS、ARM 和其他架构不在 `v1.0.0` 承诺内。
- 元数据安全重置输入：标准 `.docx` 和 `.pdf`，包括扫描 PDF；拒绝 `.doc`、`.docm`、加密、签名、损坏或不可验证文件。
- 对照审查输入：标准 `.docx` 和带可靠文本层的 `.pdf`；扫描 PDF 明确阻止，OCR 暂不支持。
- 资格标预制作输入：标准 `.docx` 或带可靠文本层的 `.pdf` 招标文件；输出固定为可编辑 `.docx`。DOCX 以原模板保真为目标，PDF 只承诺结构化重建。
- 原输入永远只读且不覆盖；最终输出必须是新文件，并在新鲜验证报告为 `passed` 后发布。
- 元数据原值和随机新值只存在于当前预览任务内存和本机 Renderer；不得进入日志、报告、诊断、设置或历史。
- AI 只支持用户配置的 OpenAI 兼容接口；生产设置继续要求 HTTPS，只有环回地址允许 HTTP。仓库忽略的 live 测试配置不改变该生产边界。
- 在线更新固定使用官方 GitHub Releases。NSIS/AppImage 支持确认式应用内更新；portable/DEB 只提示手动下载。当前未签名状态必须持续明示，不允许静默安装。
- `v0.1.0` 的普通 AI 设置与加密密钥需要单向迁移；旧报告只读，报告/IPC/AI 输出继续采用版本化 Schema。
- OCR、服务端、账号、数据库、遥测、自动投标、法律判断、自动修改投标文件和任意 PDF 像素级转 DOCX 均不在本计划内。

## TDD Route

- Mode：off。
- Decision：skipped。
- Strict authority：not applicable。
- Test posture：先做事故诊断复现，再实施最小稳定修复并补回归；新功能在每个最小变更后运行 focused 单元/集成/E2E 验证，不编排严格 RED/GREEN 仪式。
- Reason：用户要求完整测试，但没有要求严格 TDD；文档与跨进程功能更需要真实格式夹具、失败路径、打包 E2E 和双平台证据。
- Verification：每个任务运行下述 focused 命令；每个任务提交前运行统一质量门；G5 运行 Windows/Linux 打包、完整打包 E2E、包审计和 Release 验证。

## Verification

统一任务质量门：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
git diff --check
```

涉及 UI、IPC、Worker、Main 或发布配置的任务还必须运行：

```bash
xvfb-run -a pnpm test:e2e
pnpm package:linux
pnpm audit:package
xvfb-run -a pnpm test:e2e:packaged
```

Windows 对应命令由 GitHub Actions `windows-latest` 执行；Linux 本地结果不能代替 Windows 证据。任何 focused 或统一质量门失败时停止提交，不使用 `--no-verify`、跳过测试或降低断言。

## Plan Basis

- Fact：`v0.1.0` 的合成 DOCX 在 Linux 公开 AppImage 中完成过完整流程，但用户的真实 Windows/Word DOCX 在点击执行后进入统一 `INTERNAL_ERROR`。
- Fact：当前自动化完整清洗只覆盖合成 DOCX；公开生产包测试只验证启动和安全设置，没有执行文档流程。
- Fact：未知异常在多个边界丢失阶段信息并被压缩为同一安全消息，当前没有持久化的脱敏诊断链。
- Fact：当前 Renderer 只显示字段类别/数量；托盘、在线更新、M2 和 M3 尚未实现。
- Fact：现有 `fileSafety.ts` 732 行、`taskManager.ts` 526 行，继续直接加入新任务类型会突破所有权和复杂度边界。
- Assumption：用户发生失败的文档是不含投标敏感内容的空白或可脱敏 DOCX；若不能取得原文件，必须从用户提供的安全诊断阶段和公开 Word/WPS/LibreOffice 结构样例构造等价最小复现。
- Unknown：事故根因可能在 Windows 路径/文件系统、Word OOXML 变体、发布身份核验或其组合；计划禁止在得到阶段和复现证据前宣称具体根因。
- Unknown：`pdfjs-dist`、`docx` 和 `electron-updater` 在当前 Electron/ASAR/双平台组合中的最终兼容性；每项依赖都有采用门和停止条件。

## BaselineUsageDraft

- Required baseline refs：完整设计规格、CONTEXT、Baseline Governance、ADR-0001、ADR-0002、现有 M0–M1 计划与证据。
- Delivered context refs：用户确认的元数据明细 C、托盘 A、更新 A、全部完成后只发一个版本。
- Acknowledged before plan refs：上述文档及当前 Git/源文件/测试形态已在计划前读取。
- Cited in plan refs：完整设计第 2、4–13 节，两份 ADR 的运行时与发布边界。
- Missing refs：精确事故 DOCX/安全诊断、三项新依赖的兼容性探针和未来 Windows/Linux CI 运行结果。
- Decision：continue；缺失项已转为 G1/G2/G4 的显式证据门，不用推测填补。

## Requirement Ready Check

- Requirement source refs：用户确认和完整设计规格。
- Goals and scope refs：设计第 1–3、11 节，本计划 Goal。
- User / scenario refs：设计第 4 节。
- Requirement item refs：设计第 5–11、13 节。
- Acceptance / verification criteria refs：设计第 12 节及本计划每项 Verification。
- Open blocker questions：无产品或架构决策阻塞计划；精确事故输入是执行期诊断证据，不改变批准的修复目标。
- Decision：ready。

## Change Necessity

- User-visible need：现有 DOCX 清洗在用户环境失败且明细不足，同时完整产品还缺少桌面、审查和预制作能力。
- No-change / non-code option：仅改 README 或解释无法修复执行、显示明细、提供托盘/更新、解析文档、调用 AI 或生成资格标。
- Why code change is necessary：每项价值都依赖新的运行时契约、确定性文档处理、任务编排和可验证 UI 行为。
- Minimum change boundary：事故诊断与修复、预览契约、共享发布/任务边界、设置迁移、托盘/更新、只读文档模型、review/AI/generation 所有者、Renderer 流程、测试和发布自动化。
- Decision：code-change。

## Existence Check

- Proposed new surfaces：安全诊断记录器、窗口/托盘生命周期、更新服务、只读统一文档模型、review、provider-neutral AI、generation、三类独立任务协调器。
- Existing owner / reuse candidate：复用现有格式安全、随机映射、Main 网络、安全存储、Worker、IPC 信封、路径注册、发布身份协议和 JSON→HTML 报告模式。
- Why existing surface is insufficient：现有任务管理器只拥有清洗预览/执行；把诊断、更新、审查、生成全部塞入现有文件会混合网络、文件写入、桌面生命周期和领域规则。
- Creation proof：每个新表面都有唯一权限、契约、失败模式和独立验收；review 不写文件，generation 不联网，updater 不读文档，diagnostics 不存敏感值。
- Entropy / retirement impact：先提取共享发布和 IPC 注册骨架；不创建第二写入器、第二设置文件事实来源、通用插件系统或兼容 fallback。旧设置写入和单体 IPC 路径在迁移验证后退役。
- Decision：add-with-proof。

## Architecture Integrity Lens

- Invariant：输入只读；预览和执行使用同一随机计划；AI/Renderer/Updater 不写文档；无证据不形成确定性结论；验证失败不发布。
- Canonical owner / contract：文档格式在 `core/documents`，审查在 `core/review`，生成在 `core/generation`，AI 逻辑在 `core/ai`、网络在 `main/ai`，跨进程事实在 Zod Schema。
- Responsibility overlap：Main 只调度和联网，Worker 只执行本地重任务，Renderer 只展示/确认；每类任务有独立协调器并复用共同发布协议。
- Higher-level simplification：审查和生成共用只读文档模型/锚点；三类输出共用验证后发布；JSON 是每类报告的唯一事实来源。
- Retirement / falsifier：统一 `INTERNAL_ERROR` 丢阶段路径、单体 IPC 注册、旧设置写入和仅启动的打包验证需要退役；若新库不能满足边界则拒绝采用，不保留并行生产实现。
- Verdict：proceed。

## Ripple Signal Triage

- Signals：共享契约版本、设置持久化迁移、Worker 消息、任务完成事实、报告格式、Preload API、Updater 元数据和 CI 发布。
- Canonical owners：Schema 在 `shared/contracts`，持久化在 `SettingsService`，网络在 Main，最终输出状态在验证后发布所有者。
- Downstream consumers：Main/Worker/Preload/Renderer、三类任务 UI、报告渲染器、E2E、包审计和 GitHub Release 工作流。
- Verification expansion：契约单元测试、生产者/消费者集成、格式黄金测试、AI 模拟/live 兼容、双平台 Electron E2E、打包 E2E 和更新源测试。
- Decision：共享契约变更必须同任务更新全部生产者/消费者；不在调用方增加旧字段猜测或备用完成条件。

## File Map

### 现有所有者（修改或抽取）

- `src/core/documents/fileSafety.ts`：保留输入/工作区安全；把最终输出证明抽到窄接口，避免继续增长。
- `src/core/documents/docx/*`、`pdf/*`：复用安全归档/对象读取；新增只读提取与模板能力仍留在对应格式目录。
- `src/core/sanitization/*`：生成预览随机计划、执行同一计划、清洗报告；不承载审查或生成。
- `src/main/tasks/taskManager.ts`：保留清洗任务协调；通用 Worker 生命周期和验证后发布抽出后由三类任务复用。
- `src/main/ipc/registerIpc.ts`：退化为组合入口；按设置、文件、清洗、审查、生成、更新拆注册模块。
- `src/main/index.ts`：只做应用组合根；窗口、托盘、更新生命周期移入独立所有者。
- `src/main/settings/settingsService.ts`：迁移为一个版本化 AppSettings 事实来源，同时保持 API Key 只由 SecretStore 管理。
- `src/main/ai/openAiCompatibleClient.ts`：拆分连接测试与 Chat Completions 传输，共用受限响应读取和错误映射。
- `src/preload/index.ts`、`src/renderer/src/api/bidSentryApi.ts`：扩展版本化 API，但不暴露 Node、密钥、绝对路径或任意 URL。

### 新增领域所有者

- `src/shared/contracts/diagnostics.ts`、`appSettings.ts`、`updates.ts`、`documentModel.ts`、`review.ts`、`ai.ts`、`generation.ts`：各自版本化 Zod 契约。
- `src/main/diagnostics/diagnosticRecorder.ts`：只接受白名单字段的轮换 JSONL 安全诊断。
- `src/main/app/windowController.ts`、`trayController.ts`：窗口关闭/隐藏/退出的唯一生命周期所有者。
- `src/main/updates/updateService.ts`：GitHub Releases 检查、下载、校验状态和安装确认。
- `src/main/tasks/workerRuntime.ts`、`verifiedPublication.ts`、`reviewTaskManager.ts`、`generationTaskManager.ts`：共享进程/发布与独立领域协调。
- `src/core/documents/documentModel.ts`：只读 `DocumentSnapshot`、`DocumentNode`、`SourceAnchor`、`ExtractedEntity`。
- `src/core/documents/docx/read.ts`、`anchors.ts`、`templateSections.ts`：DOCX 结构读取、稳定锚点和模板区段依赖分析。
- `src/core/documents/pdf/textLayer.ts`、`layout.ts`：PDF 文本层、坐标、阅读顺序和扫描件判定。
- `src/core/review/entities.ts`、`requirementLedger.ts`、`rules/*`、`mergeFindings.ts`、`report.ts`：确定性审查事实来源。
- `src/core/ai/chunking.ts`、`prompts/*`、`anchorValidation.ts`：提供商无关 AI 请求和结果校验。
- `src/main/ai/chatCompletionsClient.ts`、`aiTaskRunner.ts`：带预算、取消和安全错误的 OpenAI 兼容网络执行。
- `src/core/generation/templateCandidates.ts`、`fieldPlan.ts`、`docx/*`、`pdf/*`、`report.ts`：模板确认、填充计划、确定性生成和验证。
- `src/renderer/src/features/review/*`、`generation/*`、`updates/*`：独立用户流程与状态所有者。

### 测试、脚本与发布

- `tests/compatibility/*`：本地忽略事故输入的复现入口和可提交的从零构造兼容样例说明。
- `tests/fixtures/builders/*`：扩展 DOCX/PDF/招投标/模板构造器，不包含现实企业或真实标书。
- `tests/unit/{diagnostics,appSettings,updates,documentModel,reviewRules,aiContracts,generation}*.test.ts`：纯契约和领域规则。
- `tests/integration/{docxCompatibility,documentReaders,reviewTask,generationTask,updater}*.test.ts`：格式、任务和更新集成。
- `tests/e2e/{sanitizer,settings,review,generation,tray,updates,packaged}.spec.ts`：替代继续膨胀的单体 `app.spec.ts`。
- `scripts/audit-package.mjs`：审计生产包不含测试、密钥、报告、诊断、docs/aegis 或 E2E 注入。
- `scripts/run-live-ai-test.mjs`：显式读取本地忽略的 `test-apikey.md`，只发送合成文本且不输出配置值。
- `.github/workflows/ci.yml`：双平台完整质量门和打包 E2E。
- `.github/workflows/release.yml`：只对人工创建的 `v1.0.0` 标签组装已验证产物、校验和、更新清单和 GitHub Release。

## Plan Pressure Test

- Owner / contract / retirement：共享任务/发布在新增功能前抽取；旧设置写入、统一错误压缩和单体 IPC/E2E 均有明确退役任务。
- Architecture integrity / higher-level path：统一只读文档模型服务 M2/M3，已有安全适配器服务 M1/M3，避免重复解析与写入所有者。
- Verification scope：每个功能从纯逻辑、格式、进程、UI、打包到双平台发布均有证据；AI live 测试只补协议兼容，不替代模拟失败测试。
- Task executability：G1→G2→G3→G4→G5 顺序明确，每个任务有文件、停止条件、命令和提交边界。
- Pressure result：proceed。

## Plan-Time Complexity Check

### Complexity Budget

- Artifact class：Source Complexity、Test Complexity、Decision/Plan Complexity、Build Complexity。
- Target files / artifacts：`fileSafety.ts`、`taskManager.ts`、`registerIpc.ts`、`app.spec.ts` 及全部新增领域所有者。
- Current pressure：`fileSafety.ts` 接近 800 行；任务管理器、IPC 和 E2E 已出现多理由变更压力。
- Projected post-change pressure：若 add-in-place 将 over-budget；按所有权抽取后仍为 at-risk。
- Budget result：over-budget unless governed。
- Planned governance：先做行为保持型抽取；新责任进入独立 owner；测试按功能拆分；任一维护文件超过 800 行或出现混合权限前必须重新拆界。

### Boundary Decision

- Target files：Main 组合根/任务/IPC、格式读取器、review、AI、generation 和 E2E。
- Existing size / shape signals：大文件包含安全分支和清理路径，不能用批量重写替代逐步验证。
- Owner fit：清洗、审查、生成、更新各有不同状态机；共享部分仅限 Worker 运行、发布证明、IPC 信封和报告渲染模式。
- Add-in-place risk：形成巨型任务管理器、跨领域条件分支和无法独立取消/验证的任务。
- Better file boundary：组合入口 + 独立领域协调器 + 小型共享基础设施；格式特有代码留在格式目录。
- Recommendation：extract-first for existing mixed owners，add owner files for new responsibilities。

## Execution Readiness View

- Intent Lock：完整修复并交付设计规格的三项能力、托盘和更新，最终只发布 `v1.0.0`。
- Scope Fence：不加入 OCR、服务端、账号、数据库、遥测、自动改标书、自动提交或新 AI 协议。
- Baseline Lock：每个执行批次前重读完整设计、CONTEXT、两份 ADR、当前 checkpoint 和本计划。
- Approved Behavior：元数据明细 C、托盘 A、更新 A、单次发布；这些决定不得在实现中弱化。
- Owner / Contract Constraints：AI/Renderer/Updater 不写文档；Main 独占网络和最终完成；Zod 契约跨进程校验。
- Compatibility Boundary：Windows/Linux x64、DOCX/文本 PDF，扫描 PDF 仅 M1；设置单向迁移；受支持包型差异明确。
- Retirement Boundary：统一内部错误页、旧设置写路径、单体 IPC/E2E 和仅启动的打包验证必须退出主路径，不保留调用方 fallback。
- Task Batches：G1（Tasks 1–3）、G2（Tasks 4–6）、G3（Tasks 7–10）、G4（Tasks 11–13）、G5（Task 14）。
- Test Obligations：focused 测试、统一质量门、双平台 E2E/打包、live AI 合成兼容、Word/WPS/LibreOffice 手工打开。
- Review Gates：每个 G 结束执行独立代码审查；G5 前复核七维架构、供应链、隐私和发布证据。
- Drift / Rewind Rules：发现新 owner、第二写入器、跳过验证、生产 HTTP 放宽、敏感值持久化或包型静默更新时立即停止并返回设计。
- Evidence Required Before Completion：测试命令与结果、根因证据、回归夹具、双平台 CI 链接、包审计、更新清单、手工兼容记录、发布校验和。
- Advisory Boundary：本视图只指导执行，不是 GateDecision、PolicySnapshot 或完成授权。

## Tasks

### Task 1：建立事故复现入口与安全诊断链（G1）

**Files**

- Create：`src/shared/contracts/diagnostics.ts`、`src/main/diagnostics/diagnosticRecorder.ts`、`tests/unit/diagnostics.test.ts`、`tests/compatibility/docxIncident.test.ts`。
- Modify：`src/shared/contracts/errors.ts`、`src/shared/contracts/index.ts`、`src/worker/sanitizationWorker.ts`、`src/main/tasks/taskManager.ts`、`src/main/ipc/registerIpc.ts`、`src/main/index.ts`、`src/renderer/src/api/bidSentryApi.ts`、清洗失败结果组件、`package.json`。

**Why**

当前未知异常被压缩为同一 `INTERNAL_ERROR`，无法判断失败在 OOXML、Windows 工作区、验证、发布还是清理。必须先产生不泄密的阶段证据，才能做可信根因修复。

**Change Necessity**

仅靠用户截图或现有日志不能定位；最小代码边界是一个白名单诊断 Schema、Main 记录器、跨边界阶段标注和只读复现入口。

**Impact / Compatibility**

- `AppError` 增加 `stage` 和既有 `detailId` 的强制关联；用户消息继续由安全白名单产生，原始异常文本/堆栈不进入 IPC。
- 诊断 JSONL 位于 userData 的 `diagnostics/`，单文件上限 1 MiB、最多 5 个文件、最长保留 7 天；只记录 Schema 允许字段。
- `tests/compatibility/docxIncident.test.ts` 只有显式设置 `BID_SENTRY_COMPAT_DOCX` 时运行；事故文件不复制进仓库、测试结果不打印路径或元数据。

**Repair Track**

- Root cause：本任务只确定失败阶段和最小复现，不猜测代码根因。
- Canonical owner：错误来源边界生成阶段，Main 诊断记录器生成诊断编号并持久化白名单事件。
- Verification：每个阶段注入错误时，UI/诊断的 code、stage、detailId 一致且不含禁用值。

**Retirement Track**

- 退役所有 `catch {}` 或直接 `toSafeAppError(error)` 丢失阶段的主路径。
- 保留 Renderer 不能看到原始异常的安全边界，不用“显示堆栈”作为诊断回退。

**Steps**

1. 定义 `DiagnosticStageSchema`，固定设计中的十个阶段；定义 `DiagnosticEventSchema`，字段仅为 schemaVersion、timestamp、app/runtime/os 版本、taskType、stage、code、detailId 和白名单 `systemCategory`。
2. 实现 `DiagnosticRecorder.record()`、大小轮换、7 天清理和 `summary(detailId)`；序列化前后都用 Zod 严格校验，写入权限为 `0o600`。
3. 在 Worker 消息、TaskManager 工作区准备/执行/验证/发布/清理、IPC 和应用启动边界标注阶段；未知异常先生成 `detailId` 并记录，再返回安全 AppError。
4. 在清洗失败页显示“错误码 / 阶段 / 诊断编号 / 建议动作”，增加“复制安全诊断摘要”和设置页“打开诊断目录”，不显示路径或堆栈。
5. 实现本地事故测试：读取 `BID_SENTRY_COMPAT_DOCX`，复制到测试临时目录，通过真实 `sanitizeJob` 执行并断言输入字节/mtime 不变、成功时验证通过、失败时输出仅限 code/stage/detailId。
6. 添加错误注入测试覆盖十个阶段、轮换/过期清理、不可序列化异常、路径/API Key/元数据/文档片段红action 和诊断目录打开权限。
7. 运行 focused 验证；取得事故文件时，再执行显式兼容命令并把阶段和测试名写入 G1 evidence，不记录文件路径或值。

**Verification**

```bash
pnpm vitest run tests/unit/diagnostics.test.ts tests/integration/taskManager.test.ts tests/integration/ipc.test.ts
BID_SENTRY_COMPAT_DOCX=/tmp/bid-sentry-incident.docx pnpm vitest run tests/compatibility/docxIncident.test.ts
pnpm typecheck
```

第二条命令仅在 `/tmp/bid-sentry-incident.docx` 是用户确认无敏感内容的事故副本时执行；文件缺失时兼容测试必须明确 skip，不能伪造通过。

停止条件：没有复现且诊断仍不能把用户失败定位到唯一阶段时，不进入 Task 2 的根因结论或修复提交。

提交：`feat: add privacy-safe task diagnostics`

### Task 2：修复 DOCX 执行根因并补打包完整流程（G1）

**Files**

- Modify（按 Task 1 证据选择唯一 canonical owner）：`src/core/documents/docx/{archive,inspect,metadata,sanitize,verify}.ts`，或 `src/core/documents/fileSafety.ts`，或 `src/main/tasks/{taskManager,validateExecutionResult}.ts`；不得同时添加多条猜测性修复路径。
- Create/Modify：`tests/fixtures/builders/docxFixture.ts`、`tests/integration/docxCompatibility.test.ts`、`tests/e2e/sanitizer.spec.ts`、`tests/e2e/packaged.spec.ts`、`src/main/e2e/e2eHarness.ts`、`playwright.config.ts`、`package.json`、`.github/workflows/ci.yml`。
- Split：把 `tests/e2e/app.spec.ts` 中清洗和打包用例移动到上述文件，保留设置用例到 `tests/e2e/settings.spec.ts`。

**Why**

恢复用户真实 DOCX 的执行能力，并堵住“开发 E2E 通过、正式包只验证启动”的测试缺口。

**Change Necessity**

事故已证明现有实现或兼容边界存在缺陷；最小修改必须落在 Task 1 证实的唯一 owner，并把触发结构固化为无现实数据的最小回归夹具。

**Impact / Compatibility**

- 继续拒绝签名、加密、损坏和无法验证的 DOCX；不能用降低身份核验、跳过部件比较、复制代替硬链接或保留第二发布路径来“修复”。
- 事故源文件只用于本地最小化；提交的 fixture 必须从零构造并只包含触发结构。
- 新增“打包 E2E 构建”可包含编译期测试注入，但 `scripts/audit-package.mjs` 必须证明公开生产包不含 harness、测试路径或测试凭据。

**Repair Track**

- Root cause：Task 1 的 stage + 最小结构差异 + 失败系统类别共同证明。
- Canonical owner：OOXML 兼容问题归 docx adapter；工作区/路径问题归 fileSafety；最终身份/清理问题归 Main publication。只修一个归属，不在调用方包异常。
- Stable repair：修复导致该类合法文档失败的规则，同时保持非法/不可验证文档拒绝。
- Verification：最小回归夹具、原集成矩阵、打包 E2E 和 Windows CI 同时通过。

**Retirement Track**

- 删除 Task 1 为定位而临时加入的非产品诊断注入点；保留正式安全诊断能力。
- 不保留旧错误分支、宽松判断或平台特例 fallback。

**Steps**

1. 比较事故 DOCX 与合成夹具的 ZIP 条目、关系、Content Types、目标元数据节点和工作区/发布身份，不读取或记录正文；提取触发失败的最小结构事实。
2. 根据阶段决策表选择唯一 owner：`document-*` 修改 docx adapter，`workspace-prepare` 修改 fileSafety，`publish/cleanup` 修改 Main publication；若证据跨越两个 owner，先证明共同上游不变量再拆成两个独立提交，不添加调用方兜底。
3. 用 fixture builder 从零生成触发结构，加入成功、非法近邻、取消、输入中途变化、输出冲突、验证篡改和清理回归。
4. 实施最小稳定修复，保持输入哈希/mtime、允许变化部件、验证报告和最终 inode/哈希约束。
5. 把 Electron E2E 按功能拆文件；新增可打包的 E2E artifact，通过编译期常量注入系统对话框结果，生产构建完全 tree-shake 并由包审计拒绝残留。
6. Windows/Linux CI 同时运行开发 E2E、打包 E2E 和生产包启动/安全审计；打包 E2E 执行选择→预览→确认→清洗→验证→发布，不再只启动。
7. 在 Microsoft Word、WPS 和 LibreOffice 中分别打开至少一个从零构造且包含目标变体的输出，记录可打开、正文/表格/页眉页脚不变和元数据新值存在。

**Verification**

```bash
pnpm vitest run tests/integration/docxCompatibility.test.ts tests/integration/docxSanitizer.test.ts tests/unit/fileSafety.test.ts tests/integration/taskManager.test.ts
xvfb-run -a pnpm playwright test tests/e2e/sanitizer.spec.ts tests/e2e/packaged.spec.ts
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

停止条件：如果只能通过弱化验证、允许第二写入器或跳过失败阶段才能通过，停止 G1 并返回 ADR-0001/设计评审。

提交：`fix: repair verified docx sanitization flow`

### Task 3：交付字段名、原值和随机新值的真实预览（G1）

**Files**

- Modify：`src/shared/contracts/documents.ts`、`sanitization.ts`、`worker.ts`、`src/core/sanitization/randomMapping.ts`、`sanitizeJob.ts`、`src/core/documents/documentAdapter.ts`、DOCX/PDF metadata/sanitize 文件、`src/main/tasks/taskManager.ts`。
- Modify/Create：`src/renderer/src/features/sanitizer/PreviewPanel.tsx`、`MetadataDetailsTable.tsx`、`sanitizerState.ts`、相关 CSS。
- Modify：`tests/unit/contracts.test.ts`、`randomMapping.test.ts`、`sanitizerState.test.ts`、`tests/integration/{docxSanitizer,pdfSanitizer,sanitizeJob,taskManager}.test.ts`、`tests/e2e/sanitizer.spec.ts`、`tests/unit/report.test.ts`。

**Why**

用户选择 C：清洗前必须看到具体字段名、原值和实际随机新值，而不是类别和数量。

**Change Necessity**

现有 `MetadataFieldDescriptor` 没有值，且随机计划在执行边界才形成；必须调整预览/执行契约，使用户确认的计划成为执行事实来源。

**Impact / Compatibility**

- 新 `MetadataPreviewItem` 包含 part/field/valueType/category/occurrences/action、`originalDisplayValue` 和 `replacementDisplayValue`；所有显示字符串有单项和总 IPC 字节上限。
- 原值/新值不能进入 `SanitizationReport`、HTML/JSON、诊断或持久化 task journal；报告 Schema 继续只含字段名、类别、次数和状态。
- 计划由 Worker 预览阶段生成，Main 仅在任务内存持有；Renderer 只回传 taskId/planDigest/acknowledged，不回传或修改值。

**Steps**

1. 定义严格的明细预览 Schema 和总大小 refine；为二进制、过长、控制字符和不可安全显示的元数据定义稳定本地占位文本，不把原始字节送入 Renderer。
2. 重构随机映射接口，让 preview 生成不可变 mapping、planDigest 和展示投影；execute 只接受 TaskManager 保存的 plan，不重新随机。
3. 将 planDigest 绑定输入 SHA-256、字段锚点、类型和 replacement；执行前重新扫描发现任何差异即返回 `PLAN_EXPIRED`。
4. DOCX/PDF 适配器按明确锚点应用 plan；验证器检查实际值与预览 replacement 一致，而不仅检查“非空”。
5. PreviewPanel 按文件→部件→字段展示明细表，支持长值换行和仅本地复制；明确标注“这些值不会写入报告或历史”。
6. 在放弃预览、任务完成/失败/取消、Renderer 销毁和应用关闭时清除 Main/Renderer 明细状态。
7. 测试同字段多值、同原值一致映射、空原值、Unicode、长值上限、超大预览拒绝、篡改摘要、预览后输入变化、报告/诊断/设置/日志泄漏扫描。
8. 更新打包 E2E，断言具体原值和 replacement 在预览可见、输出包含 replacement、报告及任务结束页面均不含两者。

**Verification**

```bash
pnpm vitest run tests/unit/contracts.test.ts tests/unit/randomMapping.test.ts tests/unit/report.test.ts tests/unit/sanitizerState.test.ts
pnpm vitest run tests/integration/docxSanitizer.test.ts tests/integration/pdfSanitizer.test.ts tests/integration/sanitizeJob.test.ts tests/integration/taskManager.test.ts
xvfb-run -a pnpm playwright test tests/e2e/sanitizer.spec.ts
pnpm typecheck
```

G1 Gate：Tasks 1–3 的统一质量门、Linux/Windows 打包 E2E 和三种办公软件兼容记录全部通过后才能进入 G2；不创建版本或 Release。

提交：`feat: preview exact metadata randomization plan`

### Task 4：治理 Main/IPC 复杂度并迁移统一设置（G2）

**Files**

- Create：`src/main/tasks/workerRuntime.ts`、`verifiedPublication.ts`；`src/main/ipc/registerCoreIpc.ts`、`registerSanitizationIpc.ts`、`registerSettingsIpc.ts`；`src/shared/contracts/appSettings.ts`。
- Modify：`src/main/tasks/taskManager.ts`、`validateExecutionResult.ts`、`src/main/ipc/registerIpc.ts`、`src/main/index.ts`、`src/shared/contracts/settings.ts`、`ipc.ts`、`src/main/settings/settingsService.ts`、Renderer 设置页。
- Modify/Create：`tests/unit/appSettings.test.ts`、`tests/unit/verifiedPublication.test.ts`、`tests/integration/ipc.test.ts`、`taskManager.test.ts`、`tests/e2e/settings.spec.ts`。

**Why**

在加入审查、生成、托盘和更新前，把已接近压力线的通用运行/发布与 IPC 组合责任移出清洗所有者，并安全迁移 `v0.1.0` 设置。

**Change Necessity**

直接扩展现有 526 行 TaskManager 和 329 行 IPC 注册会制造多领域条件分支；新增托盘/更新设置也需要版本化持久化迁移。

**Impact / Compatibility**

- 这是行为保持型抽取：M1 任务状态、ADR-0001 发布顺序、Preload API v1 和现有 AI 设置对用户保持兼容。
- 新 `AppSettingsSchema` 同时拥有 AI public settings、`closeToTray: false`、`checkUpdatesOnStartup: true`；API Key 仍不在普通设置 Schema。
- 设置迁移读取 `settings.v1.json`，校验后原子写 `settings.v2.json`；迁移成功后只写 v2，旧文件保留为只读恢复证据一个版本周期，不再参与运行。

**Repair Track**

- Canonical owner：Worker 进程协议归 workerRuntime；最终发布归 verifiedPublication；清洗 TaskManager 只保留清洗状态。
- Verification：抽取前后既有 131+ 测试语义、错误码、完成顺序和文件身份相同。

**Retirement Track**

- 删除 TaskManager/IPC 组合入口中的重复通用逻辑；不保留“旧实现失败再调用新实现”的 fallback。
- v2 写入成功后停止写 v1；迁移失败时不修改 v1，使用安全默认普通设置并保留加密 Key 文件。

**Steps**

1. 先为当前 Worker 生命周期和最终发布顺序补 characterization tests，锁定取消、超时、崩溃、身份不符、rollback、cleanup 和 completed 唯一发出者。
2. 移出 `workerRuntime` 和 `verifiedPublication`，让清洗 TaskManager 通过窄接口调用；每次移动后运行现有 focused 测试。
3. 把 IPC 通用信封/owner/path 生命周期、清洗和设置注册拆成模块，`registerIpc.ts` 只组合并集中 dispose。
4. 定义 v2 AppSettings/Update Schema 和 v1→v2 migration；用临时文件、fsync、rename 写入，覆盖损坏 v1、已有 v2、中途写失败和重复启动幂等。
5. 设置页增加托盘/启动检查开关但暂不接运行时行为；保存后只返回 public settings，不返回 API Key。
6. 包审计拒绝 v1/v2 设置、secret、diagnostics 和测试 fixture 进入 ASAR/发布目录。

**Verification**

```bash
pnpm vitest run tests/unit/appSettings.test.ts tests/unit/verifiedPublication.test.ts tests/integration/taskManager.test.ts tests/integration/ipc.test.ts tests/unit/settingsService.test.ts
xvfb-run -a pnpm playwright test tests/e2e/settings.spec.ts tests/e2e/sanitizer.spec.ts
pnpm audit:package
pnpm typecheck
```

提交：`refactor: isolate task runtime and migrate app settings`

### Task 5：实现可选关闭到托盘（G2）

**Files**

- Create：`src/main/app/windowController.ts`、`trayController.ts`、`src/main/ipc/registerAppIpc.ts`、`tests/unit/trayController.test.ts`、`tests/e2e/tray.spec.ts`。
- Modify：`src/main/index.ts`、`src/shared/contracts/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/api/bidSentryApi.ts`、设置页和应用状态提示、构建资源中的托盘图标。

**Why**

交付用户确认的 A：可选“关闭窗口时最小化到托盘”，默认关闭，并提供显示、检查更新和退出菜单。

**Change Necessity**

Electron 默认 `window-all-closed` 会退出；必须有一个读取设置的窗口生命周期所有者区分 hide 与真正退出，并复用安全关闭。

**Impact / Compatibility**

- `closeToTray=false` 保持 `v0.1.0` 关闭即退出行为。
- `closeToTray=true` 时窗口 close 事件只隐藏；系统关机、更新安装和托盘“退出”设置 `quitRequested` 后走 TaskManager shutdown，不再被拦截。
- 托盘图标使用仓库本地静态资源，不联网；Linux 无托盘宿主时显示可操作警告并回退为正常关闭，不驻留无可见入口的进程。

**Steps**

1. 实现 WindowController 状态机：visible/hidden/quitting，唯一处理 close、activate、show、realQuit；将 `main/index.ts` 的全局关闭标志迁入该 owner。
2. 实现 TrayController 和菜单：显示主窗口、检查更新（先发命令事件，Task 6 接服务）、退出；防止重复创建托盘或多窗口。
3. 设置变更立即创建/销毁托盘并更新 close 行为；销毁托盘前若窗口隐藏则先显示，避免用户失去入口。
4. 托盘退出和 OS before-quit 统一等待所有任务取消、workspace 清理、IPC dispose，再真正退出。
5. E2E 覆盖默认关闭退出、开启后 hide、二次显示、运行中任务继续/可取消、托盘退出、无托盘宿主和重复 activate。

**Verification**

```bash
pnpm vitest run tests/unit/trayController.test.ts tests/integration/taskManager.test.ts
xvfb-run -a pnpm playwright test tests/e2e/tray.spec.ts tests/e2e/settings.spec.ts
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

提交：`feat: add opt-in system tray lifecycle`

### Task 6：实现 GitHub Releases 确认式在线更新（G2）

**Files**

- Modify：`package.json`、`pnpm-lock.yaml`、`electron-builder.yml`、`src/main/index.ts`、设置页、托盘菜单。
- Create：`src/shared/contracts/updates.ts`、`src/main/updates/updateService.ts`、`src/main/ipc/registerUpdateIpc.ts`、`src/renderer/src/features/updates/UpdateStatus.tsx`、`tests/unit/updateContracts.test.ts`、`tests/integration/updater.test.ts`、`tests/e2e/updates.spec.ts`。
- Modify：`src/shared/contracts/ipc.ts`、`src/preload/index.ts`、Renderer API、`src/main/e2e/e2eHarness.ts`、`.github/workflows/ci.yml`、`scripts/audit-package.mjs`。

**Why**

启动时自动检查 GitHub Releases，发现新版后由用户确认下载和安装，并为不支持原地更新的包型提供手动下载。

**Change Necessity**

浏览器打开 Releases 不能完成受控检查、版本状态、清单校验和确认式安装；最小边界是 Main-only UpdateService 和只表达命令/状态的 IPC。

**Impact / Compatibility**

- 采用 `electron-updater` 前先做独立探针，证明 Electron 43、NSIS、AppImage、ASAR 和当前 artifactName 可生成/读取更新清单。
- 生产 provider 固定 `github.com/575674384-stack/bid-sentry`；测试 provider 只能在 E2E 编译期 harness 中注入本地 HTTP server，生产包审计拒绝该代码。
- 启动检查在窗口 ready 后异步执行；失败非阻断且不自动重试风暴。用户确认下载，下载后再次确认重启安装。
- portable/DEB 检测为 manual-only，只用 `shell.openExternal` 打开固定官方 HTTPS Release URL。

**Steps**

1. 安装 `electron-updater@6.8.9`，配置 electron-builder GitHub provider、NSIS/AppImage 更新 metadata 和 portable/DEB manual-only 包型检测；运行最小打包探针。
2. 定义 update state machine：idle/checking/not-available/available/downloading/downloaded/error/manual-only；限制 release notes 长度并当作不可信纯文本显示。
3. UpdateService 禁用 `autoDownload`/`autoInstallOnAppQuit`，校验事件版本与来源，暴露 check、confirmDownload、confirmInstall、openReleasePage；Renderer 不能传 URL 或本地路径。
4. 启动检查尊重 `checkUpdatesOnStartup`，托盘与设置页共用同一个正在执行的检查 promise，避免并发请求。
5. 用本地受控更新服务器测试无新版、新版、404、超时、损坏 YAML、错误 SHA-512、取消/稍后、下载完成和 manual-only；断言任何失败不影响清洗任务。
6. 在 Windows CI 打包 NSIS/portable，在 Linux CI 打包 AppImage/DEB，断言更新清单与 artifact 对应、包审计无测试 provider。

**Verification**

```bash
pnpm vitest run tests/unit/updateContracts.test.ts tests/integration/updater.test.ts
xvfb-run -a pnpm playwright test tests/e2e/updates.spec.ts tests/e2e/tray.spec.ts
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

停止条件：如果 electron-updater 不能在当前包型稳定校验/确认安装，停止应用内安装并回到设计；不能通过自写不校验下载器或静默替换可执行文件绕过。

G2 Gate：Tasks 4–6 统一质量门、Windows/Linux 托盘差异、设置迁移和四种包型更新行为全部通过后进入 G3；不发布版本。

提交：`feat: add confirmed github release updates`

### Task 7：建立 DOCX/文本 PDF 统一只读文档模型（G3）

**Files**

- Modify：`package.json`、`pnpm-lock.yaml`、`src/shared/contracts/index.ts`、`worker.ts`、`src/worker/index.ts`、`src/main/tasks/workerRuntime.ts`、`scripts/audit-package.mjs`。
- Create：`src/shared/contracts/documentModel.ts`、`src/core/documents/documentModel.ts`、`documentReader.ts`、`src/core/documents/docx/read.ts`、`anchors.ts`、`src/core/documents/pdf/textLayer.ts`、`layout.ts`、`tests/unit/documentModel.test.ts`、`tests/integration/documentReaders.test.ts`、`tests/fixtures/builders/tenderFixture.ts`、`bidFixture.ts`。

**Why**

M2 和 M3 都需要一套只读、带来源锚点的结构模型；先建立共同读取事实源，避免审查和模板生成各自解析同一文档。

**Change Necessity**

现有 DOCX/PDF 适配器只扫描元数据和结构指纹，没有正文层次、表格单元格、页码/坐标或稳定锚点；M2/M3 无法基于证据工作。

**Impact / Compatibility**

- 新增 `pdfjs-dist@6.2.108` 采用探针；只在 Worker 使用 Node 构建，不把 PDF.js worker、eval 或远程资源带入 Renderer。
- `SourceAnchor` 对 DOCX 使用 part + section path + paragraph/table/cell ordinal + text digest；对 PDF 使用 page + bounding box + text item ordinal + digest。
- 单文档最多 200 MiB、2,000 页、100,000 nodes、5,000,000 提取字符；Worker→Main 单块最多 256 KiB，按序流式传输并有总预算。Renderer 只收 outline、状态和分页 findings。
- DOCX 页码不是可靠事实，不推测页码；PDF 必须提供页码和坐标。扫描/乱码 PDF 返回稳定 `TEXT_LAYER_REQUIRED`。

**Steps**

1. 先写 PDF.js 采用探针，覆盖普通文本 PDF、中文字体、旋转页、表格坐标、取消、畸形文件和 ASAR 打包启动；全部通过后才加入锁文件和生产 adapter。
2. 定义严格只读 DocumentSnapshot/Node/Anchor/ExtractedEntity Schema，节点 kind 固定 heading/paragraph/list/table/row/cell/header/footer/page-break；所有文本和集合有上限。
3. 实现 DOCX reader，复用受限 archive/XML 层读取 document、styles、numbering、headers/footers 和关系；建立层级/表格锚点，不修改包。
4. 实现 PDF text-layer reader，禁用 eval/远程资源，提取页面文字、字体、坐标和阅读顺序；用可解释阈值判定无文本层或严重乱码。
5. 在 WorkerRuntime 增加带序号、摘要、总量限制和取消的只读模型流；Main 校验每块 Schema/摘要后组装，任何缺块或超预算失败。
6. 构造完全虚拟的招标/投标 fixture，覆盖标题、编号、标段、工期、表格、页眉页脚、同名实体、空字段、扫描 PDF 和恶意提示文本。
7. 测试相同输入锚点稳定、DOCX 不伪造页码、PDF 页/坐标准确、输入不变、资源上限、取消和打包中无远程 PDF.js 资产。

**Verification**

```bash
pnpm vitest run tests/unit/documentModel.test.ts tests/integration/documentReaders.test.ts
pnpm vitest run tests/integration/docxSanitizer.test.ts tests/integration/pdfSanitizer.test.ts
pnpm build
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

停止条件：PDF.js 在 Electron Utility Process/ASAR 中不能稳定读取中文、取消或限制资源时，不采用该库并返回设计；不并存另一个未验证 PDF 文本实现。

提交：`feat: add anchored document readers`

### Task 8：实现确定性要求台账与对照规则（G3）

**Files**

- Create：`src/shared/contracts/review.ts`、`src/core/review/entities.ts`、`normalization.ts`、`requirementLedger.ts`、`rules/bidderNames.ts`、`rules/projectIdentity.ts`、`rules/fixedParameters.ts`、`rules/internalConflicts.ts`、`rules/placeholders.ts`、`rules/missingResponses.ts`、`mergeFindings.ts`、`tests/unit/reviewRules.test.ts`、`tests/integration/reviewDeterministic.test.ts`。
- Modify：`src/shared/contracts/index.ts`、`src/worker/index.ts`、Worker 契约和 fixture builders。

**Why**

先用可重复、可解释的本地规则覆盖双投标单位、项目/标段和固定参数错误，并为 AI 提供可验证台账。

**Change Necessity**

纯 AI 审查会产生不可重复和无证据结论；必须由本地所有者完成实体标准化、候选识别、双方锚点和严重级别规则。

**Impact / Compatibility**

- `ReviewFinding` 固定包含 id/type/severity/confidence/summary/tenderEvidence/bidEvidence/suggestion/source/status；确定性 `error` 必须至少有一个招标锚点和一个投标锚点。
- 名称规则只报告“疑似单位名称冲突”，使用用户确认的投标单位名称、统一社会信用代码和上下文角色提高准确度，不从后缀简单计数直接判错。
- 固定参数保留原始文本、规范化值、单位和证据；无法可靠换算的单位不强行比较。

**Steps**

1. 定义 ReviewTask/RequirementLedger/ResponseLedger/ReviewFinding/分页结果和报告 Schema；设置最多 findings、证据和摘要字节数。
2. 实现 Unicode/全半角/空白/中文数字/常用日期/时长/金额/百分比/单位规范化，原文与锚点始终保留。
3. 从招标文档提取项目名称、编号、标段、工期/服务期/交货期、有效期、保证金、质量标准和必填章节候选，形成带证据的要求台账。
4. 从投标文档提取相同实体和响应台账；用户必须在开始审查前确认投标单位名称，作为主体规则基准。
5. 实现首批六组规则：多投标主体、角色混淆、项目/标段不一致、固定参数不一致、内部矛盾、模板空白/示例/缺失响应。
6. 实现 finding 稳定 ID、去重、严重级别和 `needs-review` 降级；本地找不到证据的候选不得输出为确定性 error。
7. 测试同名简称、联合体、招标人/投标人同段、单位换算、日期歧义、否定语境、表格跨行、无响应和假阳性近邻。

**Verification**

```bash
pnpm vitest run tests/unit/reviewRules.test.ts tests/integration/reviewDeterministic.test.ts tests/unit/contracts.test.ts
pnpm typecheck
```

提交：`feat: add evidence-grounded bid review rules`

### Task 9：实现 OpenAI 兼容审查、锚点验证和报告（G3）

**Files**

- Create：`src/shared/contracts/ai.ts`、`src/core/ai/chunking.ts`、`prompts/review.ts`、`anchorValidation.ts`、`src/main/ai/chatCompletionsClient.ts`、`aiTaskRunner.ts`、`src/main/tasks/reviewTaskManager.ts`、`src/core/review/report.ts`、`tests/unit/aiContracts.test.ts`、`tests/integration/reviewAi.test.ts`、`reviewTask.test.ts`、`scripts/run-live-ai-test.mjs`。
- Modify：`src/main/ai/openAiCompatibleClient.ts`、`src/shared/contracts/errors.ts`、Worker/Main 契约、`src/main/index.ts`、`package.json`、`.gitignore`、`scripts/audit-package.mjs`。

**Why**

让 AI 从复杂招标要求和投标响应中补充语义审查，同时保证模型不能绕过本地证据、Schema、安全和文件权限。

**Change Necessity**

当前 AI 客户端只调用 `/models`；M2 需要受预算的 Chat Completions、结构化输出兼容、取消、一次纠正和本地锚点验证。

**Impact / Compatibility**

- OpenAI 兼容请求使用用户设置的 Base URL/model/API Key；Key 只在 Main 内存和 Authorization header，绝不进入 Renderer、Worker、日志或错误。
- 默认调用 `/chat/completions`；优先请求 JSON Schema 能力，不支持时只接受纯 JSON 文本并通过同一 Zod Schema，一次纠正后仍失败即停止。
- 文档文本始终放在明确 data 边界中；任何“忽略规则/泄露密钥/访问文件”的文档内容不具有指令权。
- live 测试脚本显式读取已忽略的 `test-apikey.md`，只发送 fixture 中的虚拟单位/参数，输出只含通过/失败、HTTP 类别、模型别名索引和 Schema 结果。

**Steps**

1. 定义 AiRequestPlan/AiReviewResponse/usage/error Schema 和请求预算：单块最多 24,000 字符、单任务最多 64 次请求、单响应 2 MiB、总任务 30 分钟；设置的 maxConcurrency 限制活动请求。
2. 实现结构感知 chunking，标题/表格行不在无必要时拆开，每块携带允许引用的 anchor IDs；prompt 明确系统规则、数据边界、输出 Schema 和 unknown 行为。
3. 拆分连接测试与 chat transport，共用受限 body reader、redirect:error、AbortSignal、HTTP 状态映射；新增 400/401/403/404/408/413/429/5xx、超时、断流和无效 JSON 的可操作错误。
4. ReviewTaskManager 先运行确定性规则，再生成最小 AI 请求计划；开始前向 Renderer 返回目标主机、模型、文件角色和文本预算供用户确认。
5. AI 返回后逐项校验 anchor 是否属于该请求、摘录是否匹配本地节点；虚构/越权 anchor 丢弃或降为人工复核，不能成为确定性错误。
6. 合并 rule/ai findings，JSON 报告作为事实源并安全渲染 HTML；报告只保存必要证据片段，不保存完整文档或 API 请求/响应。
7. Mock 测试覆盖结构化/纯 JSON、一次纠正、注入文本、幻觉锚点、重复 findings、限流、取消、密钥红action 和超预算。
8. 实现 `pnpm test:ai:live`：文件缺失时明确 skip；存在时读取本地配置，分别验证 models/chat/JSON Schema 或纯 JSON 兼容和取消，不打印配置内容。

**Verification**

```bash
pnpm vitest run tests/unit/aiContracts.test.ts tests/integration/reviewAi.test.ts tests/integration/reviewTask.test.ts tests/unit/openAiCompatibleClient.test.ts
pnpm test:ai:live
pnpm audit:package
pnpm typecheck
```

live AI 失败不能被 mocks 掩盖；若接口不支持已批准的最低契约，报告为兼容性阻断，不为特定测试模型在生产代码加入私有分支。

提交：`feat: add grounded ai bid review`

### Task 10：交付对照审查桌面流程与打包 E2E（G3）

**Files**

- Create：`src/main/ipc/registerReviewIpc.ts`、`src/renderer/src/features/review/ReviewPage.tsx`、`ReviewFileSelection.tsx`、`ReviewConsent.tsx`、`ReviewProgress.tsx`、`FindingsTable.tsx`、`EvidencePanel.tsx`、`ReviewResult.tsx`、`reviewState.ts`、`useReviewTask.ts`、相关 CSS、`tests/unit/reviewState.test.ts`、`tests/e2e/review.spec.ts`。
- Modify：`src/main/ipc/registerIpc.ts`、`src/shared/contracts/ipc.ts`、`src/preload/index.ts`、Renderer API、`src/renderer/src/App.tsx`、响应式样式、`src/main/e2e/e2eHarness.ts`、CI。

**Why**

让非技术用户完成招标文件 + 投标文件选择、单位确认、AI 发送确认、执行、证据查看和报告导出。

**Change Necessity**

核心规则和 AI 任务没有 UI/IPC 就不可用；最小界面必须表达双方文件角色、数据发送边界、进度、来源和证据，而不能复用清洗页的单文件状态机。

**Impact / Compatibility**

- 每次任务固定一个招标文件和一个投标文件；路径由 PathRegistry capability 持有，Renderer 只看到 displayName/id。
- Findings 通过游标分页，每页和证据详情均受 IPC 字节限制；Renderer 不能请求任意 anchor 或路径。
- 取消同时中止 Worker 和全部 AI 请求，删除临时报告；完成后只公开 HTML/JSON 报告 capability。

**Steps**

1. 扩展顶层导航为“元数据清洗 / 对照审查 / 资格标预制作 / 设置”，保持键盘和窄屏可用。
2. 文件选择页明确招标/投标角色，收集并要求确认投标单位名称；扫描 PDF、同一文件两次选择和缺失 AI 配置在开始前给出准确提示。
3. AI Consent 展示 Base URL 主机、模型、文件角色、提取字符/块上限和隐私说明；只有明确确认后调用 AI。
4. 进度页区分本地解析、规则、AI、锚点验证、报告；支持取消和安全错误/诊断编号。
5. FindingsTable 支持 severity/type/source/status/section 筛选；EvidencePanel 并排显示招标/投标锚点，DOCX 用章节/段落/单元格，PDF 用页码/坐标。
6. 完成页导出/打开 HTML/JSON 报告并持续显示“AI 辅助结果，请人工复核”；不提供自动改标书按钮。
7. E2E 覆盖双单位名、项目编号、工期矛盾、缺失章节、AI 幻觉锚点、扫描 PDF、取消、AI 401/429/超时和分页；打包 E2E 至少执行一条完整成功路径和一条 AI 失败路径。

**Verification**

```bash
pnpm vitest run tests/unit/reviewState.test.ts tests/integration/reviewTask.test.ts tests/integration/ipc.test.ts
xvfb-run -a pnpm playwright test tests/e2e/review.spec.ts
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

G3 Gate：Tasks 7–10 的统一质量门、live AI 合成兼容、Windows/Linux 打包 E2E、预置问题召回和无证据降级全部通过后进入 G4；不发布版本。

提交：`feat: deliver bid comparison workflow`

### Task 11：识别招标模板并形成可追溯填充计划（G4）

**Files**

- Create：`src/shared/contracts/generation.ts`、`src/core/generation/templateCandidates.ts`、`fieldPlan.ts`、`src/core/ai/prompts/generation.ts`、`src/main/tasks/generationTaskManager.ts`、`tests/unit/templateCandidates.test.ts`、`fieldPlan.test.ts`、`tests/integration/generationPlanning.test.ts`。
- Modify：`src/shared/contracts/ai.ts`、Worker/Main 契约、`src/main/ai/aiTaskRunner.ts`、DOCX/PDF readers、fixture builders。

**Why**

招标文件通常已经提供投标格式模板；产品应识别并让用户确认这些区段，再决定固定值、表单值、图片占位符和未知项，而不是 AI 自由创作。

**Change Necessity**

统一文档模型只有结构，没有模板候选、用户选择或可执行填充动作；必须增加 generation 领域计划，作为生成前的强制事实来源。

**Impact / Compatibility**

- `TemplateCandidate` 包含 candidateId/title/startAnchor/endAnchor/sourceType/sectionOutline/confidence/reasons；程序可以排序候选，不能静默选择。
- 用户基础表单固定包含投标单位名称、统一社会信用代码、地址、法定代表人/授权代表、联系人、电话、电子邮箱、项目/标段、编制日期；模板新增字段通过动态问题呈现，不写入全局企业数据库。
- `FieldAction.source` 只能是 `tender-fixed | user-form | placeholder | unknown`；tender-fixed 必须有招标锚点，user-form 必须有表单字段 ID，placeholder 必须有类型，unknown 不能带建议填充值。

**Steps**

1. 定义 Candidate、UserForm、FieldAction、FillPlan、GenerationPreview 和任务状态 Schema；限制候选数、字段数、文本长度、证据数和 Renderer 投影。
2. 用标题、目录、章节层级和关键词识别“投标文件格式/资格审查/资格标/附件格式”等候选；候选范围必须落在真实 anchors 且不重叠越界。
3. Renderer 尚未实现前，通过 integration API 强制传入用户确认的 candidateId/range；无确认、过期 anchor 或输入哈希变化返回稳定错误。
4. 本地规则先识别明显模板空格、下划线、括号提示、内容控件、书签和表格字段；AI 只分类剩余字段并引用目标/招标 anchors。
5. 对 AI 的每个 tender-fixed 值重新匹配招标原文并验证语义类型；证据不足降为 unknown，禁止猜测工期、质量、金额、有效期等固定参数。
6. 生成 FillPlan 摘要，列出将填值、将放占位符、未知和保持不动项目；只有 unknown 的必填项被用户处理且用户确认后才可执行。
7. 测试多个模板候选、目录误命中、嵌套表格、重复占位、联合体字段、未知固定值、恶意提示、虚构 anchor、用户表单遗漏和计划过期。

**Verification**

```bash
pnpm vitest run tests/unit/templateCandidates.test.ts tests/unit/fieldPlan.test.ts tests/integration/generationPlanning.test.ts tests/unit/aiContracts.test.ts
pnpm typecheck
```

提交：`feat: add confirmed qualification fill planning`

### Task 12：保真提取并填充 DOCX 资格标模板（G4）

**Files**

- Create：`src/core/generation/docx/dependencyGraph.ts`、`extractTemplate.ts`、`fillTemplate.ts`、`verifyGenerated.ts`、`src/core/generation/report.ts`、`tests/integration/docxTemplateGeneration.test.ts`、`tests/fixtures/builders/qualificationTemplateFixture.ts`。
- Modify：`src/core/documents/docx/archive.ts`、`xml.ts`、`wordIdentityPolicy.ts`、`src/main/tasks/generationTaskManager.ts`、Worker 契约/入口、`src/main/tasks/verifiedPublication.ts`、`tests/unit/validateExecutionResult.test.ts`。

**Why**

从招标 DOCX 的用户确认区段直接生成可编辑资格标，最大限度保留原段落、表格、样式、编号、图片、页眉页脚和分页。

**Change Necessity**

重新用通用 DOCX 库排版会漂移；必须有 OOXML 依赖图、区段裁剪、定点填值和生成专用验证器。

**Impact / Compatibility**

- 复制受限原包到 Worker 临时区，仅保留确认正文区段及其被引用依赖；不得把招标文件其他正文、评论、批注、附件或自定义 XML 隐藏进输出。
- 保留选区需要的 styles、numbering、theme、fonts、图片、页眉、页脚、脚注/尾注和分节关系；外部关系、宏、签名和无法证明归属的嵌入对象阻止生成。
- 生成文件的 Core/Extended/Custom/评论/修订身份使用 M1 随机策略重新生成，不能继承招标文件制作者身份。

**Steps**

1. 建立从选定 body nodes 出发的 OOXML dependency graph，遍历 relationships、styles、numbering、media、headers/footers、footnotes/endnotes 和 content types；拒绝路径穿越、外部 active relationship、宏和签名。
2. 生成新 package：裁剪 document.xml 到确认区段，复制必要依赖，重建关系/Content Types；扫描输出确保未选择正文和原评论不残留。
3. 按目标优先级填值：唯一内容控件→唯一书签→确认表格单元格→确认文本节点；目标不唯一或跨复杂域时停止并要求用户确认，不做全局字符串替换。
4. 保留目标 run/cell 样式，用 `【请插入：类型】` 创建醒目、可编辑的图片/证照/签章占位符；不生成图片、签名、印章或证件内容。
5. 对固定文本、未批准节点、表格结构、样式/编号引用、图片关系、页眉页脚、分节和选区边界生成规范化前后摘要；只有批准 FieldAction targets 可变化。
6. 将生成 DOCX 和 JSON/HTML 制作报告交给既有两阶段 verifiedPublication；Main 验证身份、哈希、报告和清理后才完成。
7. 测试复杂表格、跨 run 占位、书签、内容控件、多个 section、图片、页眉页脚、编号、脚注、未选内容泄漏、外部关系、计划篡改、验证失败和取消。
8. 用 Microsoft Word、WPS、LibreOffice 打开从零构造的复杂输出，记录可编辑、表格/编号/分页/图片/页眉页脚兼容结果。

**Verification**

```bash
pnpm vitest run tests/integration/docxTemplateGeneration.test.ts tests/integration/generationPlanning.test.ts tests/unit/validateExecutionResult.test.ts
pnpm vitest run tests/integration/docxSanitizer.test.ts tests/integration/taskManager.test.ts
pnpm typecheck
```

停止条件：无法证明未选招标内容被移除、固定内容不变或依赖完整时不发布生成文件；不退回整份招标文件复制或重新排版的备用路径。

提交：`feat: generate verified docx qualification templates`

### Task 13：完成 PDF 模板重建、资格标 UI 与打包 E2E（G4）

**Files**

- Modify：`package.json`、`pnpm-lock.yaml`、Worker/Main 契约、`src/main/tasks/generationTaskManager.ts`、`src/shared/contracts/ipc.ts`、Preload/Renderer API、`src/renderer/src/App.tsx`、CI 和包审计。
- Create：`src/core/generation/pdf/rebuildTemplate.ts`、`verifyRebuiltTemplate.ts`、`src/main/ipc/registerGenerationIpc.ts`、`src/renderer/src/features/generation/GenerationPage.tsx`、`TemplateCandidates.tsx`、`CompanyForm.tsx`、`FillPlanReview.tsx`、`GenerationProgress.tsx`、`GenerationResult.tsx`、`generationState.ts`、`useGenerationTask.ts`、相关 CSS、`tests/integration/pdfTemplateGeneration.test.ts`、`generationTask.test.ts`、`tests/unit/generationState.test.ts`、`tests/e2e/generation.spec.ts`。

**Why**

补齐带文本层 PDF 的结构化 DOCX 重建和完整资格标用户流程，使 DOCX/PDF 招标文件都能按批准边界完成预制作。

**Change Necessity**

Task 11/12 只有核心规划和 DOCX 写入，没有 PDF 新 DOCX writer、用户确认页面或公开结果 capability。

**Impact / Compatibility**

- 新增 `docx@9.7.1` 只用于 PDF→DOCX 新建路径；不得接管 DOCX 来源模板。
- PDF 重建保留标题层级、段落、表格候选、对齐、字体大小、页边距、分页和占位符的可解释近似；界面始终显示“可能存在版式差异”。
- 文本层缺失、阅读顺序严重错乱、表格置信度低或候选边界不可靠时停止，不输出猜测 DOCX。

**Steps**

1. 先做 docx 采用探针，覆盖中文字体、合并单元格、分页、页眉页脚、图片占位和 Word/WPS/LibreOffice 打开；通过后才加入生产依赖。
2. 从 PDF layout nodes 构造页面/段落/表格结构，映射字体大小、粗体、对齐、缩进、边距和分页；每项近似规则带可测试的 deterministic 输入输出。
3. 只重建用户确认的模板页/区段，应用同一 FillPlan；在报告中记录 source=pdf-rebuilt 和不可避免的版式警告。
4. 验证输出 DOCX 可重新解析、标题/段落/表格/字段动作/分页数在允许偏差内、所有值来源可追溯且没有选区外 PDF 文本。
5. 实现五步 UI：选择招标文件与基础表单→候选模板确认→动态表单→填充计划确认→生成/结果；任何一步变更输入都使后续计划失效。
6. TemplateCandidates 展示章节/页码或结构锚点和摘要；DOCX/PDF 都要求显式选择。FillPlanReview 分组显示 fixed/form/placeholder/unknown 及证据。
7. 生成完成页打开 DOCX/HTML/JSON；持续提示人工校对、PDF 版式差异和占位符未完成，不能标记“可直接投标”。
8. E2E 覆盖 DOCX 保真、PDF 重建、多个候选、无确认阻止、未知必填项、固定参数证据、图片占位、恶意 AI 输出、取消、验证失败和结果打开；打包 E2E 各执行一个 DOCX/PDF 成功路径。

**Verification**

```bash
pnpm vitest run tests/integration/pdfTemplateGeneration.test.ts tests/integration/docxTemplateGeneration.test.ts tests/integration/generationTask.test.ts tests/unit/generationState.test.ts
xvfb-run -a pnpm playwright test tests/e2e/generation.spec.ts
pnpm package:linux
pnpm audit:package
pnpm typecheck
```

停止条件：docx 库无法产生三种办公软件可打开的中文表格文档，或 PDF 结构置信度不能可靠阻止错误模板时，停止 PDF 发布路径并回到设计，不降低提示或验证门。

G4 Gate：Tasks 11–13 统一质量门、DOCX/PDF 打包 E2E、三种办公软件兼容、模板内容不泄漏和全部 FieldAction 可追溯通过后进入 G5；不发布版本。

提交：`feat: deliver qualification document generation`

### Task 14：完成全产品回归、文档、发布流水线与唯一 `v1.0.0` Release（G5）

**Files**

- Modify：`package.json`、`pnpm-lock.yaml`、`electron-builder.yml`、`.github/workflows/ci.yml`、`scripts/audit-package.mjs`、`README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`.gitignore`。
- Create：`.github/workflows/release.yml`、`CHANGELOG.md`、`docs/user-guide.md`、`docs/privacy.md`、从零构造的示例说明/生成脚本、必要的经实施证据支持的 ADR。
- Modify/Create：全量 unit/integration/e2e tests、Aegis work/evidence/checkpoint/reflection 和 INDEX。

**Why**

把所有功能作为一个可安装、可升级、可解释的开源桌面产品交付，并遵守“全部做好后只发布一个新版本”。

**Change Necessity**

仅本地绿测不能证明 Windows/Linux 安装包、更新 metadata、隐私排除和 GitHub Release 完整；必须有可复现双平台发布流水线和最终人工兼容门。

**Impact / Compatibility**

- 直到本任务最终发布提交才把应用版本从 `0.1.0` 改为 `1.0.0`；之前不创建其他版本号或 tag。
- Release 只包含 NSIS、portable、AppImage、DEB、electron-updater metadata、SHA-256 校验和、许可证和发布说明。
- 禁止打包/上传 `.env*`、`test-apikey.md`、settings/secrets、diagnostics、日志、报告、真实文档、tests、fixtures、E2E harness 或 `docs/aegis`。

**Repair Track**

- 对 G1–G4 全部回归，尤其验证 M1 修复未被新任务/设置/发布重构破坏。
- Windows/Linux 任一差异必须回到对应 canonical owner 修复，不在 Release workflow 忽略。

**Retirement Track**

- README/CONTRIBUTING 删除“自动更新、M2、M3 尚未实现”的旧基线表述。
- AGENTS 更新当前 owner、测试和发布边界，继续明确 live AI 只从已忽略的 `test-apikey.md` 读取。
- 旧 M0–M1 计划保留为历史记录，但 INDEX/README 指向本计划和当前证据；不篡改历史完成记录来伪装完整产品已完成。

**Steps**

1. 对照设计第 2、4–13 节建立需求→任务→测试矩阵，逐项确认元数据明细、诊断、托盘、更新、M2、M3、隐私和单次发布都有自动/手工证据。
2. 完成独立代码审查：安全/隐私、文档写入不变量、AI grounding、更新供应链、设置迁移、七维架构和复杂度；所有 Critical/Important 阻断项修复并重新验证。
3. 更新用户文档：安装、三类工作流、AI 数据边界、OCR/扫描 PDF 限制、托盘、更新包型差异、错误诊断、人工复核和未签名提醒。
4. 更新贡献/Agents 规则和合成 fixture 生成方式；确认 `test-apikey.md` 仍被 `.gitignore` 命中、未跟踪、包审计拒绝。
5. 配置 release workflow：只接受 `v1.0.0` 标签，不重新构建；从该标签提交已经成功的 Windows/Linux CI 下载按 SHA-256 锁定的产物，复核版本/哈希/更新清单，生成 `SHA256SUMS`，再创建 GitHub Release。
6. Linux 本地运行完整质量门、E2E、打包、包审计和打包 E2E；GitHub Actions 在 Windows/Linux 重复全部门并上传证据。
7. 手工在 Windows 10/11、受支持 Linux、Microsoft Word、WPS、LibreOffice 和主流 PDF 阅读器检查示例输出；记录结果、代码签名状态和已知限制。
8. 从 `v0.1.0` userData 副本验证设置迁移；用受控双版本更新源完成 NSIS/AppImage 检查→确认下载→校验→确认安装，portable/DEB 只打开官方页。
9. 运行秘密/包内容/许可证/依赖审计，确认 Git 工作树只含计划内文件且没有真实文档、绝对路径、API Key、诊断或报告。
10. 将版本一次性改为 `1.0.0`，运行新鲜最终质量门，形成并推送发布提交；等待该提交的 CI 产物完成安装、完整功能和哈希预发布复核后，才创建并推送唯一标签 `v1.0.0`。
11. 等待 release workflow 成功，下载公开资产复核校验和、安装启动、完整 M1 流程和更新 metadata；发布任务发生瞬时失败时只重跑同一标签的幂等上传，绝不移动标签或换用新版本逃逸。任何内容缺陷都说明第 10 步的预发布门失效，停止公开并请求新的版本处置决策。
12. GitHub Release 公开后更新最终 evidence/reflection，确认 Release URL、四类安装包、校验和和无中间 Release。

**Verification**

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:coverage
pnpm build
xvfb-run -a pnpm test:e2e
pnpm package:linux
pnpm audit:package
xvfb-run -a pnpm test:e2e:packaged
git diff --check
git status --short
git check-ignore -v test-apikey.md
! git ls-files --error-unmatch test-apikey.md
```

最后一条命令中的 `!` 将“未跟踪”转为成功，证明 `test-apikey.md` 没有进入 Git；其输出不得包含文件内容。Windows CI 还必须成功执行 `pnpm package:win` 和 Windows 打包 E2E。

G5 Gate：只有所有自动/手工证据新鲜、独立审查无阻断项、工作树干净且公开产物复核通过，才可声明完成和 Release-ready。

提交：`release: bid sentry v1.0.0`

## Risks and Controls

- **事故样本不可得**：保留安全诊断与本地 compatibility runner；没有唯一阶段证据就不宣称根因，G1 不通过。
- **Word/WPS OOXML 变体**：用从零构造的最小结构回归和三种办公软件手工打开；合法但未知变体保守拒绝，不弱化验证。
- **大型文档内存/IPC**：Worker 流式提取、每块/总量/节点/字符/页数上限，Renderer findings 分页；超限明确失败。
- **AI 幻觉/注入**：确定性优先、data 边界、严格 Schema、anchor membership + excerpt match、无证据降级、一次纠正上限。
- **敏感信息泄漏**：明细只在任务内存/UI；报告/诊断/live 测试/包审计分别做禁用值扫描；无遥测。
- **模板内容泄漏/格式漂移**：依赖图只复制选区所需部件，选区外文本扫描，固定节点规范化摘要和三种办公软件兼容。
- **更新供应链**：固定 GitHub provider、清单 SHA-512、用户两次确认、无任意 URL、未签名提示、manual-only 包型不自替换。
- **设置迁移破坏 Key**：普通设置与 SecretStore 分离，单向原子迁移，失败不改旧文件/密钥，迁移回归使用副本。
- **复杂度扩散**：extract-first，领域独立 owner，禁止通用巨型 manager/utils；每个 Gate 复核最大文件和责任数量。
- **单次发版压力**：内部质量门顺序阻断缺陷但不公开版本；每任务可回滚提交保留恢复能力，G5 只组装全部通过的同一 commit。

## Rollback and Retirement

- 每个 Task 一个经验证的 scoped commit；失败回滚该任务提交，不回滚用户或其他任务的无关工作。
- 新依赖只有采用探针通过才进入生产；探针失败时删除试验路径和依赖，不保留 dormant adapter。
- 设置迁移、Updater 或模板生成涉及持久化/发布边界，实施证据确认后形成 ADR 或现有 ADR amendment，并同步设计基线。
- `v0.1.0` 的清洗所有者继续服务 v1；被退役的是缺失诊断、执行期重新随机、旧设置写入、单体 IPC/E2E 和仅启动包测，不删除安全验证或旧报告读取能力。
- Release 发布前可以撤销发布提交/标签草稿；Release 公开后不得移动公开标签，任何后续缺陷按新的用户授权处理。

## Execution Route

- Decision：inline。
- Evidence：任务有严格顺序质量门和多个共享契约/文件；当前多代理规则不授权主动委派，主执行者逐 Gate 实施最容易保持单一 owner 和连续证据。
- Fallback：若用户后续明确授权并行代理，只对无共享写入的 fixture、文档或独立审查任务使用 subagent-driven；核心契约和发布仍由主协调者整合。
- User confirmation required：no — 用户已明确回复“做吧”，授权按本计划开始实施；公开 Release 仍受 G5 全部证据门约束。
