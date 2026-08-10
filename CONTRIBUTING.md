# 贡献指南

感谢参与 Bid Sentry。文档安全软件的首要要求是保守、可验证和不泄露用户数据。

## 开始开发

请使用 Node.js 22 与 pnpm 11.18：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

产品与架构事实来源是 `docs/aegis/specs/2026-08-09-bid-sentry-design.md`，领域语义见 `CONTEXT.md`，仓库安全与发布规则见 `AGENTS.md`。

当前 v1.0.0 范围包括：DOCX/PDF 元数据安全重置、招标/投标对照审查、资格标模板预制作、可选系统托盘和确认式 GitHub Releases 更新。OCR、服务端、账号、数据库、遥测、自动投标、自动改写投标文件和静默更新不在范围内。

## 测试数据政策

- 只能提交程序生成或人工构造的合成 DOCX/PDF 夹具。
- 禁止提交真实招标文件、投标文件、个人信息、任务输出报告、绝对路径、API Key 或其他凭据。
- 不要把真实值“脱敏后”作为夹具；应从零生成没有现实对应关系的数据。
- 默认使用本地模拟的 OpenAI 兼容服务。只有模拟无法提供必要证据时，才可按 `AGENTS.md` 使用本地忽略的 `test-apikey.md`，并且只能发送合成、非敏感提示。

## 文档适配器安全门

DOCX/PDF 写入逻辑只能位于 `src/core/documents` 或经过审查的 `src/core/generation` 所有者，并必须证明：

1. 原文件字节、大小、时间和文件身份在任务前后保持不变。
2. 仅批准的元数据类别发生变化，且重置值非空、不可从报告恢复。
3. DOCX 的非目标部件，或 PDF 的页面、资源、注释和附件语义保持不变；模板生成必须证明选区外内容没有泄漏。
4. 加密、数字签名、结构损坏、格式不支持或验证不确定时停止并拒绝输出。
5. 验证通过前不发布最终文件；不得增加跳过验证、第二写入器或“尽力保存”回退。

对照审查只能产生有来源锚点的问题；AI finding 必须经过本地 Schema 和锚点校验，不能成为无证据的确定性 `error`。Renderer 不得接触密钥、任意路径或任意下载地址。

## 提交前检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:coverage
pnpm build
xvfb-run -a pnpm test:e2e
pnpm package:linux        # 或在 Windows 运行 pnpm package:win
pnpm audit:package
BID_SENTRY_PACKAGED_APP=release/linux-unpacked/bid-sentry xvfb-run -a pnpm test:e2e:production
pnpm package:e2e:linux    # 或 package:e2e:win；仅用于功能打包 E2E
BID_SENTRY_PACKAGED_E2E_APP=.e2e-release/linux-unpacked/bid-sentry-e2e xvfb-run -a pnpm test:e2e:packaged
git diff --check
```

UI、IPC、Worker、托盘、更新或发布配置变更必须同时覆盖：成功、拒绝、取消、篡改、清理、输入不变、契约校验和密钥脱敏（按适用范围）。打包功能 E2E 必须执行至少一条真实流程，不得只启动窗口。

## 发布与分支

- 只允许最终公开版本 `v1.0.0`；G1–G5 是内部质量门，不创建中间 Release 或标签。
- 发布前必须有 Linux 本地证据、Windows CI 证据、包内容审计、SHA-256 清单、更新源验证和 Word/WPS/LibreOffice/PDF 阅读器手工兼容记录。
- `test-apikey.md`、`.env*`、settings/secrets、日志、报告、测试、fixtures、E2E harness 和 `docs/aegis` 不得进入发布包。
- 保留无关用户改动；只暂存当前任务拥有的路径，不使用 `--no-verify` 绕过检查。

## 报告安全问题

请不要在公开 Issue 上传真实文档、凭据、完整日志或可识别路径。优先使用 GitHub 仓库的私密安全报告渠道；若渠道不可用，请先联系维护者索取私密接收方式，只提交最小复现步骤和从零生成的合成样例。
