# OMX to OpenSpec migration record

Date: 2026-10-09

## Shared decisions from Grill Me

| Decision | Answer | Consequence |
|---|---|---|
| Q1 scope | A | Track the complete virtual-office target in one change. |
| Q2 OMX history | A | Keep `.omx/ultragoal/` as historical audit; execute from OpenSpec. |
| Q3 change shape | A | Use one `real-state-virtual-office` change with phased tasks. |
| Q4 platform acceptance | Yes | macOS manual evidence and Windows CI evidence are completion requirements. |
| Q5 Pixi strategy | A | React is complete; Pixi is lazy, default-enabled only after gates, and fallbacks remain. |
| Q6 role scope | A | Finish all seven roles with real projections. |
| Q7 existing code | A | Retain and repair the current virtual-office modules and tests. |
| Q8 Windows evidence | A | Use the existing Windows runner for build/test/smoke evidence; missing evidence leaves the change open. |
| Q9 assets | A | Use placeholders during data work, replace them with branded assets before completion. |
| Q10 close condition | A | Close only after all phases, gates, review, and platform evidence pass. |

## Baseline at migration

The worktree already contains a partial React data surface under `apps/desktop/src/virtual-office/` and `apps/desktop/src/home/DesktopHome.tsx`, versioned placeholder assets under `apps/desktop/public/virtual-office/v1/`, and focused tests under `apps/desktop/test/virtual-office-*.test.ts`. The baseline includes metadata parsing, run classification, source/cache lifecycle, role adapters, projector/store/navigation seams, capability gating, and the dashboard composition.

The baseline does not prove the full change. Pixi renderer modules and frame policy, asset registry verification, complete Phase 2/3 role adapters, media provider/recovery health, final branded assets, macOS manual evidence, and final quality review remain open and are tracked in `tasks.md`.

## OMX history references

- Plan: `.omx/ultragoal/brief.md`
- Story state: `.omx/ultragoal/goals.json`
- Audit trail: `.omx/ultragoal/ledger.jsonl`
- Approved design: `.omx/specs/2026-10-08-coworkany-virtual-office-design.md`
- Approved PRD: `.omx/plans/prd-coworkany-virtual-office-20261008.md`
- Approved test specification: `.omx/plans/test-spec-coworkany-virtual-office-20261008.md`
- Approved consensus plan: `.omx/plans/ralplan-coworkany-virtual-office-consensus-20261008.md`

The OMX files are not deleted or rewritten. Their failed/in-progress story statuses explain why this OpenSpec migration was necessary; they are not a second active task list.

The referenced OMX PRD, test specification, and consensus plan retain the original dual-platform language as historical artifacts. They are not active acceptance criteria after the macOS-only scope amendment below.

## Platform scope amendment

On 2026-10-10 the current product target was narrowed to macOS-only verification. This latest steering supersedes the Q4/Q8 completion consequence recorded above for this execution while preserving those answers as historical Grill Me decisions. macOS manual evidence remains required. Windows build/test/smoke evidence is deferred to a follow-up change, is not a blocker for this change, and must not be presented as Windows compatibility or release verification.

## Current execution evidence

The automated implementation gates currently pass on 2026-10-10:

- Focused virtual-office, boundary, route, bootstrap, and WorkbenchClient suite: 185/185 passing after renderer, terminal-display, route, async-listener, renderer-gate, and contrast fixes.
- Full desktop suite: 577/577 passing after the final renderer, directory/atlas, navigation, preview, and acceptance-fixture changes.
- `pnpm --filter @coworkany/desktop typecheck`: passed.
- `pnpm --filter @coworkany/workbench-client typecheck`: passed.
- `pnpm --filter @coworkany/workbench-client test`: passed; 44/44.
- Office fallback/renderer gate and light-theme contrast regression tests: passed.
- `pnpm check:shared-boundaries`: passed.
- `pnpm --filter @coworkany/desktop verify:virtual-office-assets`: passed; checked-in branded assets total 16,404 gzip bytes, below the 2,500,000-byte budget.
- `pnpm --filter @coworkany/desktop verify:virtual-office-bundle`: passed; the complete static import closure has no Pixi marker and `office-scene-*.js` contains the dynamic Pixi scene.
- `pnpm exec vite build` from `apps/desktop`: passed; the generated dynamic scene chunk is approximately 318 kB before gzip and the Vite manifest is emitted for closure verification.
- `pnpm --filter @coworkany/desktop build:macos`: passed; ARM64 runtime staging, host/skills/agents, typecheck, Vite, and macOS icon generation completed.
- `pnpm --filter @coworkany/desktop tauri:build:macos`: passed after the final renderer and release-gate changes; ARM64 `CoworkAny.app` and `.dmg` bundles were produced.
- `TAURI_CONFIG=... cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: passed; 77 Rust unit tests.
- `pnpm exec openspec validate real-state-virtual-office --strict`: passed.
- Bounded `ai-slop-cleaner` pass: removed the unused composition navigation seam, tightened test fixtures, and verified the renderer fallback/compatibility paths without adding a second abstraction layer.
- Architecture invariant audit: `architecture-audit.md` records the one-source, renderer-isolation, fallback, brand, navigation, and no-second-database checks.

Native macOS manual evidence is now recorded in `evidence/macos-manual-2026-10-10.md`: M1, M3, and M12 pass in the Tauri dev window; M2, M5, M7, and M9 pass in the local acceptance fixture. M4, M6, M8, M10, M11, M13, and M14 remain unexecuted or partial and are not claimed as passed. The native foreground 60-second frame trace also remains open.

The generic package script `pnpm --filter @coworkany/desktop build` remains environment-blocked at its existing Windows PowerShell runtime-staging step on this macOS shell (`powershell: command not found`); the macOS-specific build and Tauri ARM64 bundle both pass. Native M1-M14 interaction evidence could not be captured in this run because the Mac was locked and the UI automation could not unlock it. Independent reviewer/architect approval and a foreground renderer frame trace remain required before archive. Windows CI evidence is deferred under the platform scope amendment. Artifact/preview-specific navigation is covered by the focused route fixture.
