# 贡献指南

感谢参与 Bid Sentry。文档安全软件的首要要求是保守、可验证和不泄露用户数据。

## 开始开发

请使用 Node.js 22 与 pnpm 11.18：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

产品与架构事实来源是 `docs/aegis/specs/2026-08-09-bid-sentry-design.md`，仓库协作和安全规则见 `AGENTS.md`。M2、M3、OCR、服务端、遥测或自动更新不属于当前 M1 范围；涉及这些边界的变更请先提出设计讨论。

## 测试数据政策

- 只能提交程序生成或人工构造的合成 DOCX/PDF 夹具。
- 禁止提交真实招标文件、投标文件、个人信息、公司隐私、任务输出报告、绝对路径、API Key 或其他凭据。
- 不要用真实值“脱敏后”作为夹具；应从零生成没有现实对应关系的数据。
- 默认使用本地模拟的 OpenAI 兼容服务。只有模拟无法提供必要证据时才可按 `AGENTS.md` 使用本地忽略的 AI 测试配置，并且只能发送合成、非敏感提示。

## 文档适配器安全门

DOCX/PDF 写入逻辑只能位于 `src/core/documents`，并必须证明：

1. 原文件字节、大小和文件身份在任务前后保持不变。
2. 仅批准的元数据类别发生变化，且重置值非空、不可从报告恢复。
3. DOCX 的非目标部件，或 PDF 的页面、资源、注释和附件语义保持不变。
4. 加密、数字签名、结构损坏、格式不支持或验证不确定时停止并拒绝输出。
5. 验证通过前不发布最终文件；不得增加跳过验证、第二写入器或“尽力保存”回退。

若所用格式库无法满足这些条件，应停止该适配器的发布路径并发起设计评审，而不是降低验证标准。

## 提交前检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

涉及 UI、IPC、Electron 运行时或发布配置时，还需运行：

```bash
xvfb-run -a pnpm test:e2e   # Linux
pnpm package:linux          # 或在 Windows 运行 pnpm package:win
pnpm audit:package
git diff --check
```

新增测试应覆盖适用的成功、拒绝、取消、篡改、清理、原文件不变、密钥脱敏和跨进程契约验证。请保持提交边界单一，并说明仍未覆盖的平台或格式风险。

## 报告安全问题

请不要在公开 Issue 中上传真实文档、凭据、完整日志或可识别路径。优先使用 GitHub 仓库提供的私密安全报告渠道；若该渠道不可用，请先联系维护者索取私密接收方式，只提交最小复现步骤和从零生成的合成样例。
