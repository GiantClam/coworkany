## Decision summary

The product is a local Coworkany desktop workspace for repeatable work. The office is a projection and navigation layer, not a second task system and not a game. Existing conversations, runs, workflow records, run details, events, recoverable attempts, artifacts, provider status, and the local Agent directory remain the only business facts.

The implementation keeps the current React/Tauri architecture. React renders the complete office surface and all accessible controls. PixiJS is an optional lazy renderer for the visual 2.5D scene only; it receives projected state and navigation callbacks but cannot import WorkbenchClient, Tauri commands, storage, or route code. If the manifest, dynamic import, asset load, initialization, or frame policy fails, the React surface remains complete and usable.

## Migration decisions

- Full target: this one change ends only after all seven roles, Pixi fallback, media recovery, performance gates, macOS evidence, and final review are complete.
- Tracker migration: `.omx/ultragoal/` is retained as historical audit; OpenSpec is the only active implementation tracker after this migration.
- Existing code: keep and repair the current `apps/desktop/src/virtual-office/` implementation; do not create a parallel office directory.
- Pixi release: React remains always available; Pixi is lazy-loaded and default-enabled only after its gates pass, with a kill switch/fallback.
- Current renderer gate: production defaults to React while native macOS evidence is pending. Development previews Pixi; `VITE_COWORKANY_VIRTUAL_OFFICE_PIXI=0` disables it in every environment. A production `=1` build is a controlled opt-in for acceptance, not evidence that release gates passed.
- Assets: placeholder assets may support early data/interaction work, but branded assets are required before final completion.
- Platform evidence: the macOS manual matrix is required for this release. Windows validation is deferred to a follow-up change and is not a completion prerequisite; no Windows support claim may be made from this change.

## Data and lifecycle boundaries

1. `RunRecordSource` owns read calls, cache, subscriptions, last-good snapshots, and lifecycle cleanup.
2. Role adapters classify each record once and emit `OfficeWorkItem` values with stable `{sourceAdapterId, workItemId}` keys.
3. `OfficeStore` owns generation tokens, single-flight refresh, health-source reads, and cleanup.
4. The projector owns status priority, device slots, `+N`, recent-20, terminal eight-second display, and timer disposal.
5. Navigation resolves a composite key to persisted entry paths, conversation routes, artifact/previews, or role home routes through the existing navigation adapter.
6. Agent directory reads use one injected paired reader for `list_local_skill_catalog` and `runtime_status`; all calls are read-only.
7. Media health reads existing local `runtime_status` prerequisites once per concurrent refresh. Explicit local prerequisites unavailable are offline; ordinary read failure and unobserved remote Provider availability are unknown. Configuration alone never proves remote readiness, and this change adds no autonomous Provider probe.

## Delivery phases

- Phase 1: seal the existing React data surface and dashboard composition for AI chat and workflow.
- Phase 2: add Agent directory projection, Agent, PPT, and writer adapters plus branded assets.
- Phase 3: add image/video adapters, recoverable attempts, provider health, frame policy, and release gates.
- Final gate: run cleaner, post-cleaner verification, architecture invariant audit, independent code review, and macOS platform evidence review before archive.

## Open questions

None. Grill Me rounds Q1–Q10 were answered and recorded in `migration.md`.

## Review remediation plan

Preserve the projected state and existing React controls with regression tests before changing renderer internals. Keep scene nodes stable by role ID, update status and device slots in place, and release removed nodes on teardown. This removes whole-scene rebuilds on every source refresh while keeping the same fixed office layout and optional renderer boundary. Measure renderer work separately from the projector; the macOS release frame trace remains an explicit acceptance gate.

Close the concrete review gaps in the existing modules: validate the runtime manifest before scene initialization, route runtime render failures into React fallback, centralize work-item routing in the role registry, dispose asynchronous bridge listeners after stop, retain terminal devices for eight seconds, and enforce static import/asset gates in the macOS CI and release workflows.
