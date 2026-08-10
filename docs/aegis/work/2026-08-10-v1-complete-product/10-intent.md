# Bid Sentry v1.0.0 complete product implementation - Intent

## TaskIntentDraft

- Requested outcome: 修复 DOCX 清洗失败并完成元数据明细、托盘、GitHub 更新、对照审查、资格标预制作，经过 G1-G5 后只发布 v1.0.0
- Goal: 修复 DOCX 清洗失败并完成元数据明细、托盘、GitHub 更新、对照审查、资格标预制作，经过 G1-G5 后只发布 v1.0.0
- Success evidence:
- fresh static/unit/integration checks and coverage
- development Electron E2E plus Linux production startup and packaged functional E2E
- Windows x64 CI build/package/E2E evidence
- package audit, updater-source/metadata/checksum verification, and manual office/PDF-reader compatibility records
- exactly one final `v1.0.0` release with documented assets and checksums
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- OCR, hosted service, accounts, database, telemetry, silent updates, automatic bid-file modification/submission, and intermediate public versions
- Scope: G1-G5；Windows/Linux x64；DOCX/PDF；不含 OCR、服务端、数据库和中间 Release
- Change kinds:
- feature
- Risk hints:
- none

## BaselineReadSetHint

- Full design, CONTEXT, baseline governance, ADR-0001, ADR-0002, historical M0-M1 plan/evidence, and current complete-product plan

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- CONTEXT.md
- docs/aegis/BASELINE-GOVERNANCE.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- docs/aegis/plans/2026-08-10-v1-complete-product.md
- Acknowledged before plan:
- docs/aegis/plans/2026-08-10-v1-complete-product.md
- user-confirmed metadata detail C, tray A, update A, and one-release boundary
- Cited in plan:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- Missing refs:
- exact user incident DOCX; Word/WPS/LibreOffice/PDF-reader manual runs; Windows CI run for the final commit
- Advisory decision: continue

## ImpactStatementDraft

- Compatibility boundary: Windows/Linux x64; DOCX/PDF metadata sanitization; DOCX and text-layer PDF review/generation; scanned PDF content workflows require text layer; no OCR.
- Affected layers: core document adapters, sanitization/review/generation workers, Main IPC/settings/updater/tray, Preload/Renderer, tests and CI/release workflows.
- Owners: `core/documents` writes and verifies documents; Main owns networking, secrets, lifecycle and verified publication; Renderer is presentation-only; shared Zod contracts own IPC data shapes.
- Invariants: inputs remain read-only; preview and execution share one plan; no sensitive values persist; validation must pass before publication; AI and updater never write document outputs.
- Non-goals:
- OCR, hosted service, accounts, database, telemetry, silent updates, automatic bid-file modification/submission, and intermediate public versions

These records are Method Pack drafts / hints, not authoritative runtime decisions.

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- CONTEXT.md
- docs/aegis/BASELINE-GOVERNANCE.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md
- Delivered context refs:
- user-confirmed metadata detail C
- user-confirmed tray A
- user-confirmed update A
- user-confirmed single v1.0.0 release
- Acknowledged before plan:
- docs/aegis/plans/2026-08-10-v1-complete-product.md
- Cited in plan:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- Missing refs:
- exact incident DOCX or equivalent Word-authored fixture
- Advisory decision: continue

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- CONTEXT.md
- docs/aegis/BASELINE-GOVERNANCE.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- docs/aegis/plans/2026-08-10-v1-complete-product.md
- Delivered context refs:
- user-confirmed metadata detail C
- user-confirmed tray A
- user-confirmed update A
- user-confirmed single v1.0.0 release
- Acknowledged before plan:
- docs/aegis/plans/2026-08-10-v1-complete-product.md
- Cited in plan:
- docs/aegis/specs/2026-08-09-bid-sentry-design.md
- docs/aegis/adr/ADR-0001-verified-document-publication.md
- docs/aegis/adr/ADR-0002-sandboxed-bundled-commonjs-preload.md
- Missing refs:
- exact user incident DOCX
- Windows CI run for final commit
- Word/WPS/LibreOffice/PDF-reader manual runs
- Advisory decision: continue
