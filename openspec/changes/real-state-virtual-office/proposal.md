## Why

Coworkany’s desktop dashboard has started accumulating task, Agent, workflow, and media surface logic that overlaps with the existing workbench while still lacking a single, reviewable product boundary for the virtual office. The virtual office should make repeatable work visible and actionable from real persisted activity, while keeping the existing conversation, workflow, approval, preview, and artifact pages responsible for execution.

This change migrates the unfinished OMX plan into one OpenSpec change so implementation, acceptance evidence, and remaining risks live in one source of truth. The existing `.omx/ultragoal/` artifacts remain historical audit records.

## What Changes

- Preserve the existing React virtual-office data surface as the migration baseline and finish its contracts, navigation, accessibility, and fallback behavior.
- Add a seven-role office projection for AI chat, Agent, PPT expert, workflow, writer, image, and video work, driven only by existing conversations, runs, details, attempts, provider health, and Agent directory facts.
- Keep one read-only `RunRecordSource`, typed role adapters, a pure projector, and an `OfficeStore`; do not add an office task database or SQLite schema.
- Add a lazy PixiJS 2.5D enhancement with React as the complete accessible surface, deterministic frame policy, reduced-motion behavior, and a failure path that returns to React without blocking existing work.
- Replace controlled placeholder office assets with branded character and workstation assets behind the versioned manifest and SHA-256 build gate before final completion.
- Add recoverable-attempt and provider-health projection for media roles, composite-key navigation, terminal feedback timing, last-good/unknown/offline semantics, and recent-work limits.
- Add automated tests, Vite/bundle/resource gates, and macOS manual evidence for the current desktop release target. Windows validation is explicitly deferred to a follow-up change.
- Record the Grill Me decisions and the OMX-to-OpenSpec migration without running OMX and OpenSpec as parallel execution trackers.

## Capabilities

### New Capabilities

- `desktop-virtual-office-state`: Real-state role projection, source health, navigation, task status, and accessible React office behavior.
- `desktop-virtual-office-rendering`: Lazy 2.5D enhancement, asset manifest, frame policy, reduced motion, and renderer fallback behavior.
- `desktop-virtual-office-release`: Performance, bundle/resource, macOS acceptance, and release quality gates for the office.

### Modified Capabilities

None.

## Impact

- Desktop React: `apps/desktop/src/virtual-office/`, `apps/desktop/src/home/DesktopHome.tsx`, and the `/dashboard` composition in `apps/desktop/src/App.tsx`.
- Desktop client seam: `packages/workbench-client/src/index.ts` and `apps/desktop/src/workbench-client.ts` for read-only recoverable-attempt access.
- Assets and checks: `apps/desktop/public/virtual-office/v1/`, `apps/desktop/scripts/verify-virtual-office-*.mjs`, and focused tests under `apps/desktop/test/`.
- Build surface: `apps/desktop/package.json`, Vite configuration, and the existing macOS release workflow. Windows workflows remain future validation work.
- Historical audit: `.omx/ultragoal/goals.json`, `.omx/ultragoal/ledger.jsonl`, and the migration record in this change remain intact; subsequent execution uses this OpenSpec change.

## Current platform scope

The current product and verification target is macOS only. This change must not claim Windows compatibility or release readiness. Windows build, test, and smoke evidence is deferred to a follow-up change and is not a completion blocker here.
