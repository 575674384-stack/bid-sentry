# Bid Sentry M0-M1 实施 - Intent

## TaskIntentDraft

- Requested outcome: 交付可安装、可测试的 Electron 基础设施和 DOCX/PDF 元数据安全重置
- Goal: 按批准规格完成 M0-M1，并以强制内容验证保护原文件
- Success evidence:
- 全量质量门、格式指纹、Electron E2E、Linux 安装包与 Windows CI 证据
- Stop condition: 10 个任务完成为 done；阻断依赖为 blocked；缺少主机或格式证据为 needs-verification；超出 M0-M1 为 scope-exceeded
- Non-goals:
- M2/M3、OCR、自动更新、遥测、LibreOffice
- Scope: Task 1-10：Electron 骨架、契约、密钥、文件安全、随机报告、DOCX/PDF、任务 IPC、UI、E2E 与打包
- Change kinds:
- implementation
- Risk hints:
- 文档格式漂移、签名漏检、API Key 泄漏、跨进程状态漂移

## BaselineReadSetHint

- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: Windows/Linux x64；DOCX/PDF；无 OCR/服务端/数据库
- Affected layers:
- Electron、共享契约、文档核心、清洗编排、UI、构建
- Owners:
- core/documents 与 core/sanitization，跨进程契约由 shared/contracts 所有
- Invariants:
- 原文件只读；AI/Renderer 不写文件；验证失败不落盘
- Non-goals:
- M2/M3、OCR、自动更新、遥测、LibreOffice

These records are Method Pack drafts / hints, not authoritative runtime decisions.

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md
- Delivered context refs:
- none
- Acknowledged before plan:
- 设计规格已由用户确认
- Cited in plan:
- Task 1 安全 Electron 进程边界与工具链
- Missing refs:
- Windows 实机/CI 与真实格式样例证据待后续任务补齐
- Advisory decision: continue
