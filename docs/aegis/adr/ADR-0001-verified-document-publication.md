# ADR-0001 - Main-owned verified document publication

Status: `recorded-from-work`
Date: `2026-08-09`

## Source Evidence

- Task 8 implementation, 103 passing tests, and independent review with 0 Critical/Important/Minor
## Context

A Worker can validate and hard-link sanitized artifacts, but the Renderer-facing completion must not be emitted until Main independently proves that every final file is the exact task-owned workspace inode, matches the report, fits IPC budgets, and cleanup succeeds.

## Decision

Use a two-phase local publication protocol: Worker writes and verifies temporary artifacts, hard-links final names, and retains the exact workspace links; Main validates final/workspace inode identity, regular-file status, size, SHA-256, report bytes, paths, uniqueness, and response/event budgets, then owns rollback, workspace cleanup, capability registration, and the sole completed transition.

## Alternatives Considered

- Let Worker clean its workspace and declare completion immediately; rejected because Main could only trust path strings and could not safely attest or roll back Renderer-visible artifacts.
- Copy or re-open outputs in Main through a second writer; rejected because it duplicates document-write ownership and weakens content verification.
## Consequences

- Successful tasks retain temporary hard links slightly longer, until Main attestation and cleanup; failed attestation rolls back only unchanged task-owned inodes, while user replacements are preserved.
- Windows release readiness requires CI evidence that Node file identity and hard-link behavior satisfy the same checks.
## Compatibility Boundary

Windows/Linux x64, DOCX/PDF, original inputs read-only, no best-effort save, no Renderer paths, and no completed state without passed verification and cleanup.

## Retirement Impact

The former Worker-success-immediately-cleans path is retired; there is no fallback, second writer, or alternate completion owner.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/specs/2026-08-09-bid-sentry-design.md
- Action: cite unchanged
- Reason: The design already assigns task lifecycle to Main, document writes to core/documents, and completion to verified publication; this ADR records the executed cross-process protocol and trade-off without changing that ownership baseline.

## Evidence References

- docs/aegis/work/2026-08-09-m0-m1-foundation-sanitizer/90-evidence.md
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.

## Amendment - 2026-08-09 - Bind publication and cleanup to exact creation-time filesystem identities: Main persists workspace root/output device, inode, and mode as decimal strings; Worker adoption, normal cleanup, crash recovery, Main artifact attestation, and rollback require exact bigint-derived identity matches.

- Status: amended

### Source Evidence

- Focused identity regressions, full 17-file/131-test gate, and independent review found and closed number inode precision loss above Number.MAX_SAFE_INTEGER.
### Change Summary

Bind publication and cleanup to exact creation-time filesystem identities: Main persists workspace root/output device, inode, and mode as decimal strings; Worker adoption, normal cleanup, crash recovery, Main artifact attestation, and rollback require exact bigint-derived identity matches.

### Compatibility Boundary

Windows/Linux x64; DOCX/PDF inputs remain read-only; replacement files/directories are preserved; no completed state without exact artifact attestation and cleanup.

### Retirement Impact

Path-only workspace cleanup, legacy path-only journal acceptance, and number-based artifact inode comparisons are retired without fallback.

### Baseline Sync

- Needed: needed
- Target: docs/aegis/specs/2026-08-09-bid-sentry-design.md
- Action: cite unchanged
- Reason: The design already requires restricted crash cleanup, Main task lifecycle ownership, local document writer ownership, and verified publication; this amendment records the exact executed identity mechanism without changing those owners or product behavior.

### Evidence References

- docs/aegis/work/2026-08-09-m0-m1-foundation-sanitizer/90-evidence.md
### Boundary

This amendment is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
