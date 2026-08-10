# Bid Sentry Repository Guide

## Product boundary

- Bid Sentry is an open-source, single-machine Electron application for Windows and Linux.
- G1 repairs and completes DOCX/PDF metadata randomization. G2 adds opt-in tray behavior and confirmed GitHub Releases updates. G3 reviews bid documents against tender documents. G4 pre-fills qualification documents from user-confirmed tender-provided templates. G5 releases the complete product.
- OCR, a hosted backend, accounts, telemetry, password cracking, signature removal, direct bid submission, and silent updates are out of scope unless the approved design changes.
- G1-G5 are internal quality gates, not public milestones. Development may create verified commits, but the only approved new public version is `v1.0.0` after every gate passes.

## Sources of truth

- Product and architecture: `docs/aegis/specs/2026-08-09-bid-sentry-design.md`.
- Canonical domain language: `CONTEXT.md`.
- Current complete-product plan: `docs/aegis/plans/2026-08-10-v1-complete-product.md`.
- Historical M0-M1 plan/evidence: `docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md` and its work directory.
- Repository governance: `docs/aegis/BASELINE-GOVERNANCE.md`.

## Hard safety rules

- Input documents are read-only. Never overwrite them or touch their timestamps intentionally.
- Only deterministic local document adapters may write files. AI and Renderer code must never write document output.
- A final output may be published only after a fresh verification report has status `passed`.
- Reject encrypted, signed, malformed, unsupported, or unverifiable documents. Never add a “best effort”, “ignore verification”, or second-writer fallback.
- Do not log or commit API keys, document contents, original metadata values, randomized values, local absolute paths, real bid documents, personal information, or generated task reports.
- Keep DOCX/PDF format logic behind `src/core/documents`; keep sanitization, review, generation, and provider-neutral AI logic in their own `src/core/*` owners; keep network access in Main; keep cross-process data in strict versioned schemas under `src/shared/contracts`.
- Metadata original/randomized values may appear only in the active local preview. Never persist them, include them in reports/diagnostics, or regenerate a different execution plan after user confirmation.

## AI test configuration

- If a task genuinely requires a live AI compatibility test, read the repository-root `test-apikey.md` for the user-provided test endpoint, API key, and model names.
- `test-apikey.md` is local-only and ignored by Git. Never stage, commit, quote, log, copy into fixtures, expose to Renderer, or package its contents.
- Prefer mocked/local contract tests. Use live AI only when it adds evidence that mocks cannot provide, and send synthetic non-sensitive prompts only.
- The local test endpoint does not authorize weakening production URL validation or changing the approved network/security boundary.

## Development workflow

- Use Node.js 22 and pnpm 11. Install with `pnpm install --frozen-lockfile`.
- Before a task commit run at least `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build`, task-scoped Prettier, and `git diff --check`.
- UI/release changes also require Electron Playwright E2E, the relevant package build, ASAR audit, and a packaged functional E2E path that executes at least one real workflow; packaged startup alone is not functional verification. Use the separate `.e2e-release/` artifact so the production package remains free of the E2E harness.
- Tests must cover success, rejection, cancellation, tampering, cleanup, input immutability, secret redaction, and contract validation as applicable.
- Use only synthetic fixtures. Do not commit real tender or bid files.
- Keep production and maintained test files cohesive; split responsibilities before a file becomes a mixed-purpose owner.
- Preserve unrelated user changes. Stage only task-owned paths and never bypass failing hooks or tests.

## Release rules

- Release only `v1.0.0`, from a clean, reviewed commit after G1-G5, the full quality gate (including format, coverage, diff check, development E2E and packaged functional E2E), live-AI compatibility where required, package-content audit, updater source validation, and supported-host evidence pass.
- Release artifacts must exclude `.env*`, `test-apikey.md`, settings/secrets files, tests, fixtures, logs, reports, and `docs/aegis`.
- Do not claim Windows verification from a Linux-only local build; require the Windows CI result.
