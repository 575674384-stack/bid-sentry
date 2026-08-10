# Bid Sentry 隐私边界

## 本机数据

Bid Sentry 默认在本机解析 DOCX/PDF、生成随机元数据、运行确定性审查规则、裁剪/重建模板、验证输出并生成报告。输入文件始终只读，临时工作区在完成、失败、取消和下次启动恢复时受限清理。

元数据预览中的原值和随机新值只存在当前任务的 Main/Renderer 内存。它们不会写入 JSON/HTML 报告、任务日志、诊断 JSONL、设置文件、更新请求或发布包；任务结束、取消、失败或窗口关闭后清除。

## AI 发送边界

用户必须自行配置 OpenAI 兼容 Base URL、模型和 API Key，并在对照审查页明确确认 AI 辅助。确认后，Main 只发送受预算限制的文本片段和结构锚点，不发送本机绝对路径、API Key 或整个文件包。文档文本中的“忽略规则”之类内容始终是数据，不是系统指令。

AI 返回先经过 JSON Schema、请求内 anchor membership 和摘录匹配验证。无效或虚构锚点会丢弃/降级为人工复核；AI 不能成为确定性 `error`，也不能写入文档。

生产设置要求远程 HTTPS；仅环回地址允许 HTTP，方便用户连接本机模型。API Key 不通过 Preload/Renderer 暴露；支持 Electron `safeStorage` 时加密保存，不支持时只保留在当前会话。

## 更新网络

更新检查默认访问固定的 `575674384-stack/bid-sentry` GitHub Releases API。检查不会静默安装；下载和打开安装程序都需要用户确认。portable/DEB 等包型使用官方页面手动更新。Release notes 作为不可信纯文本处理。

## 诊断、报告与发布包

诊断记录器只接受固定 schema：应用/运行时/操作系统类别、任务类型、阶段、错误码和诊断编号，并轮换和限制文件权限。报告只包含完成审查或生成所需的最小证据，不包含完整文档或密钥。

公开发布包排除 `.env*`、`test-apikey.md`、settings/secrets、诊断、日志、报告、测试、fixtures、E2E harness 和 `docs/aegis`。仓库的 `test-apikey.md` 仅用于维护者本地 live AI 兼容性测试，始终被 `.gitignore` 忽略。

## 明确限制

工具不提供 OCR，不联网上传文档到自有服务器，不创建账号/数据库，不做遥测，不自动提交投标文件，也不作法律或合规裁决。扫描 PDF 的审查/预制作需要另行 OCR 后再输入可靠文本层文件。
