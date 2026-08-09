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
