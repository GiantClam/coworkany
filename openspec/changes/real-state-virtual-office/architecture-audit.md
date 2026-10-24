# Virtual office architecture audit

Date: 2026-10-10

## Invariants

- **One business-fact boundary:** `RunRecordSource` reads conversations, runs, details, recoverable attempts, and metadata from `WorkbenchClient`; `AgentDirectoryReader` is the only paired catalog/runtime directory read. No office-only task table, SQLite schema, or autonomous execution path was added.
- **One source lifecycle owner:** `RunRecordSource` owns cache, last-good snapshots, run subscriptions, single-flight refresh, generation invalidation, and cleanup. `OfficeStore` owns refresh orchestration and health-source application; the projector owns only projection/timers.
- **Stable role ownership:** the seven role IDs and adapter IDs live in `role-registry.ts` and `run-adapters.ts`; each record is classified once and emitted under a composite `{sourceAdapterId, workItemId}` key.
- **Renderer isolation:** `OfficeCanvasEnhancement` lazy-loads `office-scene.ts`. The scene imports only Pixi, frame policy, asset constants, and projected state/callback types. Architecture tests reject `WorkbenchClient`, Tauri, storage, and navigation imports in the scene.
- **React fallback:** `office-surface-state.ts` returns to `react-ready` on load/asset/init failure; React role cards remain rendered and keyboard accessible. The fallback path is covered by `virtual-office-surface-state.test.ts` and component SSR tests.
- **Brand and asset integrity:** the manifest points to branded Coworkany gold/ink assets, includes role IDs, dimensions, SHA-256 values, and stays under the 2.5 MB gzip budget. The asset registry test cross-checks all role references.
- **No new window navigation:** navigation resolves role/device/recent/artifact routes through the existing `NavigationAdapter`; artifact-only items route to `/dashboard/assets?...&preview=1`.
- **Renderer update locality:** role containers and three device slots are keyed and reused across snapshots; terminal visual status and overflow are projected from the same snapshot rather than recreated as autonomous work.
- **Release gate integrity:** the asset verifier rejects invalid IDs, and the bundle verifier follows the complete static import closure; both gates are wired into macOS validation/release workflows.

## Evidence

- Focused virtual-office/boundary/route/bootstrap/WorkbenchClient tests: 185/185 passing.
- Full desktop suite: 577/577 passing.
- Desktop and workbench-client typechecks: passing.
- Vite build: passing; the complete static import closure is free of Pixi markers and Pixi exists in `office-scene-*.js` dynamic output.
- Asset and OpenSpec strict validators: passing.
- Production renderer gate and office muted-text contrast regression: passing.

Independent reviewer/architect approval, the remaining native macOS M4/M6/M8/M10/M11/M13/M14 evidence, and a foreground renderer frame trace remain release tasks and are intentionally not represented as complete here. Windows validation is outside the current macOS-only target and is deferred; this change makes no Windows compatibility claim.
