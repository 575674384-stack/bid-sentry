# Bid Sentry Repository Guide

## Product boundary

- Bid Sentry is an open-source, single-machine Electron application for Windows and Linux.
- M1 sanitizes DOCX/PDF metadata. M2 reviews bid documents against tender documents. M3 pre-fills qualification documents from tender-provided templates.
- OCR, a hosted backend, accounts, telemetry, automatic updates, password cracking, signature removal, and direct bid submission are out of scope unless the approved design changes.

## Sources of truth

- Product and architecture: `docs/aegis/specs/2026-08-09-bid-sentry-design.md`.
- Current M0-M1 implementation plan: `docs/aegis/plans/2026-08-09-m0-m1-foundation-sanitizer.md`.
- Current execution checkpoint: `docs/aegis/work/2026-08-09-m0-m1-foundation-sanitizer/20-checkpoint.md`.
- Repository governance: `docs/aegis/BASELINE-GOVERNANCE.md`.

## Hard safety rules

- Input documents are read-only. Never overwrite them or touch their timestamps intentionally.
- Only deterministic local document adapters may write files. AI and Renderer code must never write document output.
- A final output may be published only after a fresh verification report has status `passed`.
- Reject encrypted, signed, malformed, unsupported, or unverifiable documents. Never add a “best effort”, “ignore verification”, or second-writer fallback.
- Do not log or commit API keys, document contents, original metadata values, randomized values, local absolute paths, real bid documents, personal information, or generated task reports.
- Keep DOCX/PDF format logic behind `src/core/documents`; keep orchestration/report logic behind `src/core/sanitization`; keep cross-process data in strict versioned schemas under `src/shared/contracts`.

## AI test configuration

- If a task genuinely requires a live AI compatibility test, read the repository-root `test-apikey.md` for the user-provided test endpoint, API key, and model names.
- `test-apikey.md` is local-only and ignored by Git. Never stage, commit, quote, log, copy into fixtures, expose to Renderer, or package its contents.
- Prefer mocked/local contract tests. Use live AI only when it adds evidence that mocks cannot provide, and send synthetic non-sensitive prompts only.
- The local test endpoint does not authorize weakening production URL validation or changing the approved network/security boundary.

## Development workflow

- Use Node.js 22 and pnpm 11. Install with `pnpm install --frozen-lockfile`.
- Before a task commit run at least `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build`, task-scoped Prettier, and `git diff --check`.
- UI/release changes also require Electron Playwright E2E and the relevant package build.
- Tests must cover success, rejection, cancellation, tampering, cleanup, input immutability, secret redaction, and contract validation as applicable.
- Use only synthetic fixtures. Do not commit real tender or bid files.
- Keep production and maintained test files cohesive; split responsibilities before a file becomes a mixed-purpose owner.
- Preserve unrelated user changes. Stage only task-owned paths and never bypass failing hooks or tests.

## Release rules

- Release only from a clean, reviewed commit after the full quality gate, E2E, package-content audit, and supported-host evidence pass.
- Release artifacts must exclude `.env*`, `test-apikey.md`, settings/secrets files, tests, fixtures, logs, reports, and `docs/aegis`.
- Do not claim Windows verification from a Linux-only local build; require the Windows CI result.
