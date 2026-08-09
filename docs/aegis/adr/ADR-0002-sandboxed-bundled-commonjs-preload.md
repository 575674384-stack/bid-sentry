# ADR-0002 - Sandboxed bundled CommonJS preload artifact

Status: `recorded-from-work`
Date: `2026-08-09`

## Source Evidence

- Task 10 real Electron startup: ESM preload could not execute under sandbox; externalized CommonJS preload could not require zod; bundled CommonJS preload passed E2E and packaged startup.
## Context

The project uses package type module, but Electron sandboxed preload execution has a narrower module contract than Main. A .mjs preload failed to execute, while a CommonJS preload with external dependencies failed because sandboxed preload cannot require arbitrary npm modules.

## Decision

Build Preload as CommonJS at out/preload/index.cjs, bundle every dependency except the Electron built-in module, and keep BrowserWindow sandbox, context isolation, and disabled Node integration. Main loads only this artifact.

## Alternatives Considered

- Emit an ESM .mjs preload; rejected because it did not execute in the sandboxed Electron window.
- Externalize normal npm dependencies from a CommonJS preload; rejected because sandboxed preload could not require zod.
- Disable the Renderer sandbox; rejected because it weakens the approved Electron security boundary to accommodate packaging.
## Consequences

- Preload output is larger and its build configuration must prevent non-Electron runtime require calls; E2E and package startup verify the resulting artifact. Future dependency changes must preserve this bundling boundary.
## Compatibility Boundary

Windows/Linux x64; contextIsolation true, nodeIntegration false, sandbox true; Renderer receives only the versioned context bridge and no Node API or secret.

## Retirement Impact

The .mjs preload path and externalized-dependency preload build are retired with no compatibility fallback; production and tests consume index.cjs.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/specs/2026-08-09-bid-sentry-design.md
- Action: update baseline
- Reason: The design already mandates a sandboxed minimal Preload but did not state the executable artifact/module boundary; add the current bundled CommonJS contract so future changes do not reintroduce the failed paths.

## Evidence References

- docs/aegis/work/2026-08-09-m0-m1-foundation-sanitizer/90-evidence.md
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
