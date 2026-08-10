# Bid Sentry（标安）

Bid Sentry 是一个开源、单机运行的 Windows/Linux x64 投标文档安全工具。它把文档隐私清洗、招投标文件对照审查和资格标预制作放在一个本地 Electron 应用中；原文件只读，任何生成结果都必须经过验证后才会交给用户。

> 本工具用于降低文档元数据和明显文件错误造成的非预期风险，不替代人工校对、招投标合规审查或法律意见。AI 结果必须人工复核。

## 功能

### 元数据安全重置

- 支持标准 `.docx` 和 `.pdf`；清洗前按“字段名、原值、随机新值”逐项预览。
- 制作人、最后修改人、组织、应用、文档标识等身份类字段会重置为合法、非空的随机值，而不是清空。
- 创建时间、修改时间、打印时间等文档历史时间会保留原值，不会被随机化。
- 预览和执行使用同一随机计划；输入文件字节、大小、时间和文件身份保持不变。
- 输出始终保存在原文件所在目录：默认另存为「原文件名 + 后缀」的新文件（同名自动追加 (2)、(3) 序号），也可以在设置中改为验证通过后原子覆盖原文件；两种情况都会附带不包含原值/随机值的 JSON/HTML 验证报告。

### 招标文件与投标文件对照审查

- 选择一个招标文件和一个投标文件，确认投标单位名称后开始审查。
- 本机确定性规则检查多个投标单位名称、项目/标段编号、工期/服务期/交货期、质量标准、内部矛盾和可能缺失的响应章节。
- 可选使用用户配置的 OpenAI 兼容接口补充语义建议。发送前界面展示数据边界；AI 只能产生“需人工复核”结果，不能修改文件或形成无证据的确定性错误。
- 报告保存双方来源锚点和必要摘录，不保存完整文档、API Key、请求/响应原文或本机绝对路径。

### 资格标预制作

- 从招标文件中识别“投标文件格式/资格审查/资格标/附件格式”等候选区段，必须由用户确认后使用；不会静默套用内置模板。
- 分析步骤（本地规则，可选 AI 辅助）只总结招标方的资格与合规要求、列出模板需要投标人填写的字段，不会猜测任何填写值。
- 设置页可预先保存公司资料（投标单位、统一社会信用代码、地址、法定代表人/授权代表、联系人、联系方式），预制作表单会自动预填。
- 招标文件有证据的固定值才会填入；未知项不会猜测。图片、证照、签章使用醒目的可编辑占位符。
- DOCX 来源优先复用原 OOXML 模板结构；文本层 PDF 只承诺可解释的结构化 DOCX 重建，必须人工检查版式。
- 生成的 DOCX 会重新读取、结构检查并附带制作报告；不是“可直接投标”文件。

### 桌面与更新

- 设置中可选“关闭窗口时隐藏到系统托盘”，默认关闭；托盘提供显示窗口、检查更新和退出。
- 启动检查固定的官方 GitHub Releases；检查不自动下载，下载和打开安装程序都需要用户点击确认。portable/DEB 等不适合原地替换的包型会提示手动更新。
- 当前发布包未做代码签名。Windows 可能显示 SmartScreen，请从官方 Release 下载并核对校验和。

## 支持边界

| 输入/场景                                 | 行为                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| 标准 DOCX                                 | 支持元数据重置、只读审查和模板复用                         |
| 带可靠文本层的 PDF                        | 支持元数据重置、只读审查和基础结构化重建                   |
| 扫描 PDF / 图片 PDF                       | 元数据清洗可用；审查和预制作返回“需要文本层”，OCR 暂不支持 |
| `.doc`、`.docm`、加密、损坏、数字签名文件 | 保守拒绝，不提供“忽略验证”或“尽力保存”开关                 |
| macOS、ARM、服务端/账号/数据库/遥测       | 不在 v1.0.0 支持范围                                       |

## 安装与使用

从 [GitHub Releases](https://github.com/575674384-stack/bid-sentry/releases) 下载对应 Windows/Linux x64 包：

- Windows：NSIS 安装程序或 portable `.exe`。
- Linux：AppImage 或 `.deb`。

Linux AppImage 首次运行：

```bash
chmod +x bid-sentry-*.AppImage
./bid-sentry-*.AppImage
```

应用内三类流程分别是：选择文件 → 预览或确认 → 执行 → 查看验证结果。清洗结果始终保存在原文件所在目录（默认加后缀另存，可在设置中改为覆盖原文件），不再需要每次手动选择输出目录。原文件在验证通过前不会被修改。

## 隐私与 AI

- 文档读取、元数据随机化、验证、报告和资格标生成默认在本机完成；没有账户、服务端、数据库或遥测。
- 只有用户明确勾选 AI 辅助审查后，才会把截断后的文本和结构锚点发送到用户配置的接口。API Key 只在 Main 进程内存和受保护存储中使用，不进入 Renderer、Worker、日志、报告或诊断。
- Base URL 远程必须为 HTTPS；只有 `localhost`、`127.0.0.1` 和 `[::1]` 允许 HTTP。
- 元数据原值和本次随机值只存在当前预览任务内存/UI，任务结束、取消、失败或应用关闭后清除，不写入历史。
- 诊断目录只记录固定阶段、错误码、诊断编号和脱敏系统类别；不会记录路径、正文、元数据值或密钥。

## 本地开发与测试

要求 Node.js 22、pnpm 11.18：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

提交前质量门：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:coverage
pnpm build
xvfb-run -a pnpm test:e2e
pnpm package:linux       # Windows 请在 windows-latest/Windows 主机运行 package:win
pnpm audit:package
BID_SENTRY_PACKAGED_APP=release/linux-unpacked/bid-sentry xvfb-run -a pnpm test:e2e:production
pnpm package:e2e:linux  # 生成仅用于打包功能 E2E 的临时包
BID_SENTRY_PACKAGED_E2E_APP=.e2e-release/linux-unpacked/bid-sentry-e2e xvfb-run -a pnpm test:e2e:packaged
git diff --check
```

需要真实协议兼容性时，`pnpm test:ai:live` 会读取仓库根目录、且被 `.gitignore` 忽略的 `test-apikey.md`，只发送合成文本；该文件不得提交、打印或打包。大多数测试使用本地模拟 AI 服务，不需要真实 Key。

项目规则见 [AGENTS.md](AGENTS.md)，贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，用户操作说明见 [docs/user-guide.md](docs/user-guide.md)，隐私边界见 [docs/privacy.md](docs/privacy.md)。

## 开源许可

本项目使用 [MIT License](LICENSE)。安全问题请不要公开上传真实标书、个人信息或 API Key；请通过仓库的私密安全渠道提交最小合成复现。
