## 1. Migration and baseline

- [x] 1.1 Record the Grill Me decisions Q1-Q10 in `migration.md`.
- [x] 1.2 Inventory the existing `.omx/ultragoal` plan, ledger, approved PRD, test specification, and current virtual-office files without deleting or rewriting history.
- [x] 1.3 Create the single `real-state-virtual-office` OpenSpec change and make it the active implementation tracker.
- [x] 1.4 Append a migration annotation to `.omx/ultragoal/ledger.jsonl` that points to this OpenSpec change while preserving the original story state.

## 2. React data surface baseline and contract closure

- [x] 2.1 Preserve the existing metadata parser, run classification, source/cache seam, role adapters, projector, store, capability registry, dashboard composition, and versioned placeholder asset gate.
- [x] 2.2 Align role registry routes, source adapter IDs, health dependencies, capability gates, and asset IDs with the state spec.
- [x] 2.3 Complete composite-key navigation for role, device, recent-item, workflow, conversation, artifact, and preview routes without `window.open`.
- [x] 2.4 Complete source last-good, unknown/offline, single-flight, generation-safety, subscription, timer, and stop/restart cleanup tests.
- [x] 2.5 Complete status priority, permission pairing, recoverable-attempt selection, eight-second terminal feedback, startup terminal behavior, and recent-20 tests.
- [x] 2.6 Complete accessible bilingual React role cards with waiting-user/offline text, keyboard names, three devices, `+N`, recent work, and fallback behavior.
- [x] 2.7 Add asset-registry tests proving every registered character/workstation ID exists in the validated manifest.
- [x] 2.8 Run and record the Phase 1 React gate: focused tests, workbench/desktop typechecks, asset verification, and Vite build.

## 3. Pixi enhancement and fallback

- [x] 3.1 Pin `pixi.js` to 8.22.0 in the desktop package and update the lockfile.
- [x] 3.2 Add renderer-neutral scene contracts and a lazy `OfficeScene` dynamic chunk that consumes projected state and callbacks only.
- [x] 3.3 Add fixed-layout 2.5D scene composition using the versioned office manifest while keeping React as the complete surface.
- [x] 3.4 Add frame policy for hidden, active, idle, and reduced-motion states with deterministic tests.
- [x] 3.5 Add bundle verification proving Pixi is excluded from the static entry and included only in the dynamic scene chunk.
- [x] 3.6 Add initialization/asset failure fixtures proving the reducer falls back to complete React controls.
- [ ] 3.7 Run the React-to-Pixi gate and retain a macOS M1-M9 manual evidence set.

## 4. Phase 2 office roles

- [x] 4.1 Add the shared Agent directory projection and health source using one paired read-only reader for catalog and runtime status.
- [x] 4.2 Add Agent role projection for installed available Agents; active runs become devices and ordinary read rejection becomes unknown.
- [x] 4.3 Add PPT expert and writer adapters, routes, artifact kinds, and classification fixtures.
- [x] 4.4 Replace placeholder character/workstation resources with branded role assets and update manifest hashes.
- [ ] 4.5 Run Phase 2 role, directory, asset, and M13 health acceptance evidence.

## 5. Phase 3 media roles and recovery

- [x] 5.1 Add image and video adapters with exact route, artifact, provider-health, and capability behavior.
- [x] 5.2 Project recoverable provider attempts after restart without resubmitting external work.
- [x] 5.3 Add explicit provider unavailable/offline and ordinary read rejection/unknown fixtures for image and video.
- [x] 5.4 Add media navigation and artifact/preview entry points while preserving existing media pages.
- [ ] 5.5 Run Phase 3 media, provider, recovery, and M14 acceptance evidence.

## 6. Performance, release, and platform evidence

- [ ] 6.1 Add projector and renderer performance benchmarks, foreground p95 frame budget, hidden/idle ticker checks, and reduced-motion checks. Deterministic projector/frame-policy checks pass; the real foreground frame trace remains open.
- [x] 6.2 Add asset gzip and Vite static/dynamic bundle gates with measured output.
- [x] 6.3 Run the full desktop/workbench test suite, typechecks, asset checks, Vite build, and macOS Tauri checks that are executable in the current environment.
- [ ] 6.4 Execute the macOS manual matrix M1-M14 and store commit SHA, OS version, results, and screenshot/log paths.
- [x] 6.5 Record Windows validation as deferred platform scope for a follow-up change; do not claim Windows compatibility or release readiness from this change.

> Platform scope: the current product target and release evidence cover macOS only. Windows CI/build/smoke work is intentionally out of scope for this change.

## 7. Final quality gate and closure

- [x] 7.1 Run `ai-slop-cleaner` on files changed by this OpenSpec change only.
- [x] 7.2 Rerun all applicable verification after cleanup and update evidence.
- [x] 7.3 Complete an architecture-invariant audit proving one business-fact boundary, one source lifecycle owner, renderer isolation, fallback, brand, and no second database.
- [ ] 7.4 Obtain independent code-reviewer and architect approval with no unresolved blockers.
- [ ] 7.5 Mark every in-scope task complete, validate this OpenSpec change, archive it, and record the final macOS evidence in the migration record and OMX ledger.
