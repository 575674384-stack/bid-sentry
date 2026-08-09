# Bid Sentry（标安）

Bid Sentry 是一个开源、单机运行的 Windows/Linux 投标文档安全工具。首个发布里程碑 `v0.1.0` 聚焦：把 DOCX/PDF 中可能暴露制作环境或人员身份的元数据重置为同类型随机值，并在验证原文件未变化、非目标内容未漂移后才发布新文件。

> 本工具用于降低文档元数据造成的非预期关联风险，不保证消除所有可识别特征，也不能替代人工复核、招投标合规审查或法律意见。

## 当前功能

- 批量选择 `.docx`、`.pdf`，先预览修改类别，再明确确认执行。
- 重置制作人、最后修改人、公司、管理者、应用标识、修订号、文档标识和相关时间等受支持元数据；随机值不会留空。
- 原文件只读，输出默认命名为 `<原名>_sanitized.<扩展名>`。
- 每次任务生成不含原值、随机后值和本机绝对路径的 JSON/HTML 报告。
- DOCX 通过 OOXML 部件验证，PDF 通过页面、资源、注释和附件语义指纹验证；验证失败不发布最终文件。
- 配置并测试用户自己的 OpenAI 兼容接口。目前 AI 只用于连接能力准备，M1 清洗不会把文档内容发送给 AI。

后续规划中的 M2（投标文件与招标文件对照检查）和 M3（从招标文件提供的资格标模板预制作投标文件）尚未实现。OCR 也暂不支持。

## 支持与拒绝范围

| 输入                       | 当前行为                                         |
| -------------------------- | ------------------------------------------------ |
| 标准 DOCX                  | 支持元数据重置；保留正文、样式、图片等非目标内容 |
| 普通 PDF（含扫描 PDF）     | 支持元数据重置；不对扫描内容做 OCR               |
| `.doc`、`.docm`            | 拒绝                                             |
| 加密、损坏或无法验证的文件 | 拒绝                                             |
| 带数字签名的 DOCX/PDF      | 拒绝，避免使签名失效                             |

复杂或非标准文件可能被保守拒绝。这是安全停止条件，不提供“忽略验证”或“尽力保存”开关。

## 安装与使用

从 [Releases](https://github.com/575674384-stack/bid-sentry/releases) 下载对应的 x64 文件：

- Windows：NSIS 安装程序或 portable `.exe`。
- Linux：AppImage 或 `.deb`。

当前版本未做代码签名。Windows 可能显示 SmartScreen 提示，请核对下载来源和 Release 校验值后再决定是否运行。Linux AppImage 首次运行前需要执行：

```bash
chmod +x bid-sentry-*.AppImage
./bid-sentry-*.AppImage
```

Debian/Ubuntu 可安装 `.deb`：

```bash
sudo apt install ./bid-sentry-*.deb
```

应用内流程：选择文件 → 选择输出目录 → 生成预览 → 查看修改类别并确认 → 执行 → 查看验证结果与报告。不要把输出目录选在输入文件所在目录的受限或只读位置。

## 隐私与 AI 配置

- 文档解析、随机化、验证和报告都在本机完成；没有账户、服务端、遥测、数据库或自动更新。
- 原文件不会被覆盖。任务临时目录在完成、失败、取消和下次启动恢复时受限清理。
- API Key 不返回 Renderer，也不会在保存后回显。系统加密能力可用时通过 Electron `safeStorage` 加密保存；不可用时仅保留在当前会话，关闭应用后失效。
- AI Base URL 必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 或 `[::1]` 可以使用 HTTP。
- M1 的“测试连接”只请求 OpenAI 兼容的 `/models`，不会上传文档。未来 M2/M3 若启用 AI，应由用户明确发起并遵循届时公布的数据边界。

## 本地开发

要求 Node.js 22、pnpm 11.18。所有测试只使用合成文档和本地模拟 AI 服务，不需要真实 API Key。

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
pnpm build
xvfb-run -a pnpm test:e2e   # Linux
pnpm package:linux          # Linux x64
pnpm package:win            # Windows x64
pnpm audit:package          # 打包后检查 ASAR 内容
```

发布包输出到 `release/`。项目架构与安全约束见 [AGENTS.md](AGENTS.md)，贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开源许可

本项目使用 [MIT License](LICENSE)。安全问题请不要公开附带真实标书、个人信息或 API Key；请通过仓库维护者的私密联系方式报告，并只提供最小可复现的合成样例。
