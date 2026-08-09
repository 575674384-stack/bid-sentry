# Bid Sentry M0-M1 实施 - Checkpoint

- Task ID: 2026-08-09-m0-m1-foundation-sanitizer
- Current todo: Task 1 建立可构建的 Electron 安全骨架
- Active slice: Task 1：根配置、Main/Preload/Worker/Renderer 最小入口
- Blocked on: none
- Next step: 创建 package/config/source skeleton 并运行 lint/typecheck/test/build

## DriftCheckDraft

- Scope status: Task 1 仅基础设施与最小入口，未进入 M2/M3 或业务逻辑
- Compatibility status: Electron 43 + electron-vite 5 + Vite 7 + TypeScript 5.9 peer 契约通过；安全窗口配置保留
- Retirement status: 无旧路径；未添加 fallback
- New risk signals:
- 当前 root 容器手工启动 Electron 需 --no-sandbox；生产配置仍强制 sandbox，真实启动由后续 E2E 验证
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 2 定义版本化共享契约与错误模型
- Active slice: Task 2：settings/documents/sanitization/ipc/errors Zod 契约
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Evidence refs:
- task1-quality-gate
- Blocked on: none
- Next step: 实现共享 Schema 与 contracts.test.ts，运行 focused test 和 typecheck

## DriftCheckDraft

- Scope status: Task 2 仅共享契约和测试；未接线 IPC、文件或业务逻辑
- Compatibility status: schemaVersion 1；Main/Worker/Renderer 共享 Zod；完成状态以 passed verification 为事实来源
- Retirement status: 无旧契约；未添加兼容分支
- New risk signals:
- none
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 3 实现设置、安全密钥与 AI 连接测试
- Active slice: Task 3：SecretStore、SettingsService、OpenAI Compatible /models 连接测试
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- Blocked on: none
- Next step: 实现密钥与设置所有者，使用内存/临时目录/MockAgent 测试，不接触真实 API

## DriftCheckDraft

- Scope status: Task 3 仅设置、密钥和 /models 连接测试；未发送文档或连接真实 API
- Compatibility status: 公开契约不返回已保存 Key；safeStorage 不可用时会话降级；HTTPS/环回 HTTP 边界保持
- Retirement status: 无旧密钥存储；无明文 fallback
- New risk signals:
- none
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 4 实现输入快照、路径安全与原子输出
- Active slice: Task 4：fileSafety 与 DocumentAdapter 契约
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- Blocked on: none
- Next step: 实现流式哈希、类型/符号链接/大小检查、临时目录、验证后原子 finalize 与受限清理

## DriftCheckDraft

- Scope status: Task 4 仅共享文件安全底座与适配器契约，未修改元数据
- Compatibility status: DOCX/PDF 输入；原文件快照；同目录临时文件；passed verification 后无覆盖 hard-link finalize
- Retirement status: 无旧文件路径；无跳过验证或覆盖 fallback
- New risk signals:
- fileSafety.ts 为 411 行，低于 500 行提前拆分线；后续格式逻辑不得继续加入该文件
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 5 实现随机映射和脱敏报告事实来源
- Active slice: Task 5：randomMapping 与 report
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Task 4 实现输入快照、路径安全与原子输出
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- task4-file-safety-gate
- Blocked on: none
- Next step: 实现 CSPRNG 类型化映射、顺序时间和 JSON/HTML 脱敏报告

## DriftCheckDraft

- Scope status: Task 5 仅随机策略和报告事实来源，未接触格式文件
- Compatibility status: 同文件身份一致、跨文件独立；JSON 单一事实来源；报告无原值/随机值字段
- Retirement status: 无旧随机策略或第二报告事实来源
- New risk signals:
- none
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 6 实现 DOCX 安全适配器
- Active slice: Task 6：受限 OOXML ZIP、元数据计划、定点改写与内容验证
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Task 4 实现输入快照、路径安全与原子输出
- Task 5 实现随机映射和脱敏报告
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- task4-file-safety-gate
- task5-random-report-gate
- Blocked on: none
- Next step: 先实现 archive 受限读写和合成夹具，再实现 metadata/sanitize/verify

## Checkpoint Update

- Current todo: Task 6 完成 DOCX 最终质量门与任务提交
- Active slice: Task 6：复审已闭环，待全仓质量门与提交
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Task 4 实现输入快照、路径安全与原子输出
- Task 5 实现随机映射和脱敏报告
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- task4-file-safety-gate
- task5-random-report-gate
- task6-docx-review-gate
- Blocked on: none
- Next step: 运行 focused/lint/typecheck/full test/build/format/diff 最终门，记录证据后仅提交 Task 6 路径

## DriftCheckDraft

- Scope status: Task 6 仍只实现 DOCX 元数据安全重置与内容验证，未进入 PDF/M2/M3/OCR
- Compatibility status: 格式写入仍由 core/documents/docx 单一所有；外部关系保留并警告，危险 ZIP/OPC/签名/DOCM 拒绝，验证失败不保存
- Retirement status: 无旧写入器、fallback 或最佳努力保存路径；宽松解析行为已原位替换
- New risk signals:
- 最终全仓质量门待运行
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Task 7 实现 PDF 安全适配器
- Active slice: Task 7：PDF 签名/加密检测、元数据改写与结构指纹
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Task 4 实现输入快照、路径安全与原子输出
- Task 5 实现随机映射和脱敏报告
- Task 6 实现 DOCX 安全适配器
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- task4-file-safety-gate
- task5-random-report-gate
- task6-docx-review-gate
- task6-docx-quality-gate
- Blocked on: none
- Next step: 按计划复核 pdf-lib 能力与 PDF 适配器最小边界，再实现合成夹具和定向验证

## DriftCheckDraft

- Scope status: Task 6 完成 DOCX 安全适配器，下一切片仅进入计划内 Task 7 PDF；未进入 M2/M3/OCR
- Compatibility status: DOCX 原文件只读、批准字段随机化、签名/DOCM/危险包拒绝、内容验证后落盘；跨进程契约边界未提前接线
- Retirement status: 无旧路径、并行写入器或 fallback；宽松 ZIP/OPC 行为已替换且回归覆盖
- New risk signals:
- 全仓 Prettier 检查仍报告 6 个未被 Task 6 修改的历史文件；Task 6 定向格式检查通过
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 8 实现清洗任务编排、Worker 和 IPC
- Active slice: Task 8：预览/执行编排、Utility Process、任务状态与 IPC
- Completed todos:
- Task 1 建立可构建的 Electron 安全骨架
- Task 2 定义版本化共享契约与错误模型
- Task 3 实现设置、安全密钥与 AI 连接测试
- Task 4 实现输入快照、路径安全与原子输出
- Task 5 实现随机映射和脱敏报告
- Task 6 实现 DOCX 安全适配器
- Task 7 实现 PDF 安全适配器
- Evidence refs:
- task1-quality-gate
- task2-contract-gate
- task3-settings-security-gate
- task4-file-safety-gate
- task5-random-report-gate
- task6-docx-review-gate
- task6-docx-quality-gate
- task7-pdf-review-gate
- task7-pdf-quality-gate
- Blocked on: none
- Next step: 按计划实现 sanitizeJob 的 preview/execute，再接线 Worker、TaskManager 和 IPC

## DriftCheckDraft

- Scope status: Task 7 完成 PDF 元数据安全重置与结构验证；下一切片仅进入计划内 Task 8，未进入 M2/M3/OCR
- Compatibility status: PDF Info/XMP/Trailer ID 随机化；扫描 PDF 可清洗；签名/加密/损坏拒绝；页面/资源/注释/附件指纹通过后才可发布
- Retirement status: DOCX 私有 XML 与临时输出守卫已 delete-first 迁至公共单一 owner；无并行 PDF 写入器、fallback 或跳过验证路径
- New risk signals:
- 主流 PDF 阅读器与合法脱敏真实样例兼容性仍需 Task 10 手工证据
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Task 8 completes only planned M1 orchestration, Worker, IPC, recovery, and verified publication; no M2/M3/OCR
- Compatibility status: Inputs remain read-only; only core document adapters write; Main is sole completion authority after inode/hash/report/budget/cleanup attestation; Windows inode behavior remains for CI
- Retirement status: Worker-success-immediately-cleans path retired; no fallback, second writer, or alternate completion owner
- New risk signals:
- Windows dev/ino and hard-link behavior requires Task 10 CI evidence
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 9 实现清洗与设置用户界面
- Active slice: Task 9：Renderer API、清洗状态机、清洗页面和 AI 设置页
- Completed todos:
- Task 1-7 基础设施、契约、安全事实来源和 DOCX/PDF 适配器
- Task 8 清洗任务编排、Worker、IPC、恢复日志和两阶段验证发布
- Evidence refs:
- task8-review-gate
- task8-quality-gate
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- Blocked on: none
- Next step: 实现 Renderer 类型安全 API、纯 reducer/hook、清洗流程与设置表单，并运行 focused/full gates

## DriftCheckDraft

- Scope status: Task 9 completes only the planned M1 sanitizer and AI settings Renderer; no OCR, M2, M3, server, database, telemetry, or updater
- Compatibility status: Renderer revalidates shared schemas, never receives paths or saved API keys, preserves active tasks across navigation, requires explicit preview confirmation, and displays completion only for same-task passed verification
- Retirement status: Task 1 placeholder UI was replaced; no fallback, duplicate completion owner, second writer, or stale conditional-unmount path remains
- New risk signals:
- Electron E2E, observed 1024x720 layout, Linux packaging, and Windows host evidence remain Task 10 gates
- Advisory decision: continue

## Checkpoint Update

- Current todo: Task 10 完成 E2E、双平台 CI、打包和 M1 文档
- Active slice: Task 10：Electron E2E、测试夹具注入、CI、打包白名单、README 与 CONTRIBUTING
- Completed todos:
- Task 1-8 基础设施、契约、安全、格式适配器与两阶段任务编排
- Task 9 清洗与 AI 设置用户界面
- Evidence refs:
- task9-quality-gate
- task9-review-gate
- Blocked on: none
- Next step: 提交 Task 9 后实现只在 BID_SENTRY_E2E=1 生效的测试注入与 Electron Playwright 路径

## Checkpoint Update

- Current todo: Task 10 等待 Windows/Linux GitHub Actions 与发布证据
- Active slice: 提交并推送 Task 10，等待 GitHub Actions 两平台 E2E/安装包通过后记录最终证据并发布 v0.1.0
- Completed todos:
- Task 1-9 全部实现并通过各自质量门
- Task 10 本地实现、全量测试、Linux 打包、双 ASAR 审计、生产包启动与独立复审
- Evidence refs:
- task10-local-quality-gate
- task10-review-gate
- Blocked on: Windows-host GitHub Actions 尚未运行
- Next step: 提交 Task 10 工作树并推送 main；等待 Linux/Windows CI 通过，下载 CI 安装包并核验后更新最终 evidence

## DriftCheckDraft

- Scope status: Task 10 only adds M1 E2E, CI, packaging, package audit, open-source docs and release evidence; no OCR, M2, M3, server, database, telemetry or updater
- Compatibility status: Windows/Linux x64 and DOCX/PDF boundaries remain; production packages exclude E2E/private/test artifacts; sandboxed bundled CJS Preload is baseline-synced in ADR-0002; original-file and verified-publication invariants unchanged
- Retirement status: Failed ESM/externalized preload paths are retired without fallback; E2E harness is test-build-only; app-builder-lib @electron/get override has an explicit upstream retirement trigger; no second writer or verification bypass
- New risk signals:
- Windows-host full E2E, NSIS/portable generation, ASAR audit and packaged startup await GitHub Actions
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: 关闭 workspace 创建身份绑定缺口并重新完成 Task 10 发布验证
- Active slice: Task 10 安全补强：workspace 创建身份契约、Worker、journal 与清理器
- Completed todos:
- 实现 canonical path 逐级 symlink/junction 拒绝
- 贯穿 workspace root/output 创建身份并增加 focused regressions
- Evidence refs:
- task10-workspace-identity-focused-gate
- Blocked on: Windows junction 与最终安装包仍需 Windows CI
- Next step: 运行全仓 lint/typecheck/Vitest/build 后请求独立复审

## DriftCheckDraft

- Scope status: Task 10 内部临时工作区安全补强；未进入 M2/M3/OCR，也未触碰用户源文件
- Compatibility status: 未发布 schema v1 原位收紧；Main-to-Worker 与 journal 必须携带 root/output 创建身份；旧 path-only journal 隔离
- Retirement status: 仅路径清理契约 delete-first 退休，无 fallback 或双 owner
- New risk signals:
- Windows junction、inode/mode 稳定性和最终安装包需 Windows CI 直接证据
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: 提交并推送 exact identity 修复，等待双平台 CI 与最终发布证据
- Active slice: Task 10 最终本地发布门完成；准备 Git 提交与 Windows/Linux CI
- Completed todos:
- 关闭 workspace 创建身份与 same-path replacement 缺口
- 关闭 PublishedFile number inode 精度与误回滚缺口
- 通过最新全仓门、Electron E2E、Linux 打包/审计/启动及独立复审
- Evidence refs:
- task10-workspace-identity-focused-gate
- task10-workspace-identity-full-gate
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- Blocked on: Windows junction、Windows E2E、NSIS/portable、Windows ASAR/packaged startup 和最终双平台 artifacts 需 GitHub Actions
- Next step: 运行最终稳定工作树质量门，按任务路径提交并推送 main，等待 GitHub Actions

## DriftCheckDraft

- Scope status: Task 10 M0-M1 发布安全修复和证据；未进入 M2/M3/OCR，也未触碰用户源文件
- Compatibility status: Windows/Linux x64；exact bigint-derived identity 贯穿 workspace、hard-link attestation 与 rollback；用户替换对象保留
- Retirement status: path-only cleanup、legacy path-only journal 和 number inode 比较均 delete-first 退休，无 fallback
- New risk signals:
- 仅最终 Windows-host 与双平台 CI/artifact 证据未完成
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: 推送 Windows canonical temp path 测试修复并重跑双平台 CI
- Active slice: Task 10 Windows-host canonical path regression 修复与 CI 复验
- Completed todos:
- exact identity 修复已提交并推送为 bdbbbc2
- GitHub Actions 31326853393 的 Linux x64 全链通过
- Windows 临时目录别名导致的四个测试消费者漂移已定位并最小修复；本地完整门通过
- Evidence refs:
- task10-workspace-identity-full-gate
- task10-windows-canonical-path-repair-gate
- Blocked on: 最终 Windows x64 E2E、NSIS/portable、ASAR、packaged startup 和 artifacts 仍需新 CI
- Next step: 精确提交两个测试文件和 Aegis 记录，推送 main，等待新 Linux/Windows CI

## DriftCheckDraft

- Scope status: Task 10 Windows-host 测试契约修复；仅调整四个测试调用点，不修改生产路径、M2/M3/OCR 或用户文件
- Compatibility status: Windows/Linux x64；测试现在消费 TemporaryWorkspace 的 canonical outputDirectory，生产 canonical-path 与 exact identity 守卫保持不变
- Retirement status: 无新增 fallback、平台特判或第二 owner；错误的测试别名消费被原位替换
- New risk signals:
- 仅新 Windows/Linux CI 与最终 artifacts 未完成
- Advisory decision: needs-verification
