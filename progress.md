# Progress Log

## Session: 2026-03-12

### Phase 1: Release Validation & Runtime Discovery
- **Status:** complete
- **Started:** 2026-03-12 07:30
- Actions taken:
  - Verified `r8` release workflow passed and produced artifacts for all configured platforms.
  - Ran packaged Windows executable and captured startup behavior.
  - Identified updater plugin initialization panic in packaged builds.
  - Removed updater runtime integration and validated `cargo check` plus `npm run test:ci`.
  - Rebuilt Windows bundle and re-ran packaged smoke test.
  - Confirmed packaged app now reaches Tauri setup but still fails to launch sidecar from release layout.
- Files created/modified:
  - `desktop/src-tauri/Cargo.toml`
  - `desktop/src-tauri/Cargo.lock`
  - `desktop/src-tauri/capabilities/default.json`
  - `desktop/src-tauri/gen/schemas/acl-manifests.json`
  - `desktop/src-tauri/gen/schemas/capabilities.json`
  - `desktop/src-tauri/gen/schemas/desktop-schema.json`
  - `desktop/src-tauri/gen/schemas/windows-schema.json`
  - `desktop/src-tauri/src/main.rs`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 2: Sidecar Packaging Strategy
- **Status:** complete
- Actions taken:
  - Inspected `desktop/src-tauri/src/sidecar.rs` startup logic.
  - Confirmed release runtime still depends on `bun run src/main.ts`, local `tsx`, or global `npx tsx`.
  - Confirmed packaged release does not currently ship a resolved sidecar entry or runtime.
  - Verified local Bun runtime is available as `1.3.9`, making a compiled sidecar path practical to test on the current machine.
  - Verified `bun build --compile --target=bun` succeeds for the sidecar when `electron` and `chromium-bidi*` are externalized.
- Files created/modified:
  - `desktop/src-tauri/src/sidecar.rs`
  - `desktop/src-tauri/tauri.conf.json`
  - `sidecar/package.json`
  - `sidecar/scripts/build-release.mjs`
  - `sidecar/src/services/browserService.ts`
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `.github/workflows/package-desktop.yml`

### Phase 3: Sidecar Release Mode Implementation
- **Status:** complete
- Actions taken:
  - Added a `sidecar` release build script that compiles a standalone Bun executable and copies `playwright-bridge.cjs` into `sidecar/dist`.
  - Updated Tauri bundle config to include `sidecar/dist` artifacts as release resources.
  - Updated Rust sidecar startup logic to prefer packaged sidecar resources in release builds and keep Bun/tsx fallback only for dev-style layouts.
  - Updated Playwright bridge resolution to honor `COWORKANY_PLAYWRIGHT_BRIDGE` when the sidecar runs from a compiled release binary.
  - Added Bun setup and `sidecar` dependency installation to CI, release, and manual desktop packaging workflows.

### Phase 4: Rebuild & Verification
- **Status:** in_progress
- Actions taken:
  - Rebuilt the release sidecar binary locally with `npm run build:release`.
  - Fixed the initial `bundle.resources` path mistake and verified `cargo check --locked` passes again.
  - Rebuilt the Windows Tauri release bundle with `npx tauri build --target x86_64-pc-windows-msvc`.
  - Verified the release output now contains `release/sidecar/coworkany-sidecar.exe` and `release/sidecar/playwright-bridge.cjs`.
  - Started the generated Windows release executable and confirmed it resolved the packaged sidecar binary, spawned it successfully, and exchanged IPC responses.
  - Checked the public GitHub Actions pages for `CI #18` and `Release #11` triggered by `64d7795` / `v0.1.0-beta.1-r10`.
  - Confirmed both runs are still in progress, with `linux-x64` and `macos-arm64` artifacts already published and no new public failure annotation visible yet.

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Rust compile after updater removal | `cargo check` | Build passes | Build passes | pass |
| Desktop acceptance suite | `npm run test:ci` | 85 tests pass | 85 tests pass | pass |
| Windows release bundle build | `npx tauri build --target x86_64-pc-windows-msvc` | Bundle generated | NSIS bundle generated | pass |
| Packaged Windows startup before updater removal | Release exe start | App stays up | Panic on updater plugin init | fail |
| Packaged Windows startup after updater removal | Release exe start | App stays up and core services initialize | Tauri starts; sidecar path resolution fails | partial |
| Sidecar release build | `sidecar npm run build:release` | Compiled sidecar binary produced | `dist/coworkany-sidecar.exe` and `dist/playwright-bridge.cjs` produced | pass |
| Rust compile after sidecar release wiring | `cargo check --locked` | Build passes | Build passes after fixing resource path | pass |
| Windows release bundle after sidecar packaging | `desktop npx tauri build --target x86_64-pc-windows-msvc` | Bundle generated with packaged sidecar resources | NSIS bundle generated with `release/sidecar/*` resources | pass |
| Windows release startup after sidecar packaging | Release exe start | App starts and packaged sidecar responds to IPC | Desktop log shows packaged sidecar path; sidecar log shows IPC started and handled list commands | pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-03-12 08:05 | Packaged app panic: updater config invalid type null | 1 | Removed updater runtime wiring from desktop build |
| 2026-03-12 08:09 | `Unable to locate sidecar/src/main.ts from current runtime paths` | 1 | Root cause captured; release-mode sidecar packaging fix pending |
| 2026-03-12 08:18 | PowerShell broke an `rg` pattern containing quote and pipe characters | 1 | Simplify the search expression and avoid that quoting pattern |
| 2026-03-12 08:32 | `bundle.resources` glob did not match any files during `cargo check` | 1 | Corrected the sidecar resource paths to be relative to `desktop/src-tauri/tauri.conf.json` |
| 2026-03-12 08:40 | Deleting `desktop/run-err.txt` and `desktop/run-out.txt` via shell was blocked by policy | 1 | Leave them uncommitted for now and call them out explicitly |

## Session: 2026-03-12 (Skill Resolution Follow-up)

### Goal
- Enforce `local skill -> marketplace search/install -> create only as fallback` when the user asks to create a skill.

### Actions taken
- Inspected local desktop and sidecar logs for the `nanobanana 2` skill request and confirmed the model never received a marketplace-resolution tool.
- Added `sidecar/src/skills/skillResolver.ts` to orchestrate installed-skill matching, GitHub discovery, ClawHub discovery, installation, and final create-or-not decisions.
- Added model-visible tool `resolve_skill_request` in `sidecar/src/tools/selfLearning.ts`.
- Wired the new tool in `sidecar/src/main.ts` and updated the builtin self-learning tool name registry.
- Tightened prompt guidance in `sidecar/src/data/prompts/selfLearning.ts` and `sidecar/src/data/prompts/autonomousLearning.ts` so creation is explicitly the last resort.
- Added a static acceptance guard in `desktop/tests/phase2-acceptance.test.ts` to keep this flow in the current CI path.

### Verification
- `sidecar/npm run typecheck` -> pass
- `desktop/npm run test:ci` -> pass (`87` tests)
- `desktop/npm run build` -> pass

### Files created/modified
- `sidecar/src/skills/skillResolver.ts`
- `sidecar/src/tools/selfLearning.ts`
- `sidecar/src/tools/builtin.ts`
- `sidecar/src/main.ts`
- `sidecar/src/data/prompts/selfLearning.ts`
- `sidecar/src/data/prompts/autonomousLearning.ts`
- `desktop/tests/phase2-acceptance.test.ts`

## Session: 2026-03-13 (Skill Prompt Injection Refactor)

### Goal
- Replace full enabled-skill prompt injection with production-grade progressive disclosure.

### Actions taken
- Re-read the local `Skill Development` skill guidance and confirmed it recommends a 3-level loading model: metadata always in context, `SKILL.md` on trigger, bundled resources on demand.
- Audited the current implementation in `sidecar/src/main.ts` and confirmed chat requests currently inline full bodies for all selected skills, with fallback to all enabled skills.
- Collected current regression surface in `sidecar/tests` and identified that prompt-routing logic is not independently testable in its current location.

### Next actions
- Extract prompt routing/composition into a dedicated module under `sidecar/src/skills/`.
- Add deterministic unit tests for ranking and body selection.
- Re-run targeted sidecar and desktop regressions after wiring the new prompt path back into chat handling.

### Completion
- Extracted prompt assembly into `sidecar/src/skills/promptBuilder.ts`.
- Rewired `sidecar/src/main.ts` so chat requests now carry:
  - cacheable stable prompt sections plus skill catalog metadata in `systemPrompt.skills`
  - per-turn directives plus routed skill bodies in `systemPrompt.dynamic`
- Added routing thresholds and top-score filtering so weakly matched builtin skills do not crowd the prompt.
- Added `sidecar/tests/skill-prompt-builder.test.ts` and included it in `sidecar` stable CI coverage.
- Updated `desktop/tests/phase2-acceptance.test.ts` with a guard for the new prompt-routing architecture and corrected the reminder notification assertion to match the actual Rust-side notification path.

### Verification
- `sidecar/npm run typecheck` -> pass
- `sidecar/bun test tests/skill-prompt-builder.test.ts` -> pass
- `sidecar/npm run test:stable` -> pass (`70` tests)
- `desktop/bun test tests/phase2-acceptance.test.ts` -> pass (`53` tests)
- `desktop/npx tsc --noEmit` -> pass

### Follow-up hardening
- Extracted provider-facing prompt serialization into `sidecar/src/llm/systemPrompt.ts` so Anthropic/OpenAI formatting rules are testable outside `main.ts`.
- Added `sidecar/tests/system-prompt-serialization.test.ts` to verify:
  - Anthropic receives stable cached blocks and dynamic blocks separately
  - plain-text providers receive flattened `stable + dynamic` content
  - legacy string prompts still behave correctly
- Expanded routing regression samples with a Chinese trigger case to catch multilingual prompt-routing drift.
- Added `sidecar/tests/skill-routing-eval.test.ts` as a transcript-style evaluation set covering weather, stocks, reminders, browser automation, PR review, slides, PDF extraction, and Chinese reminder queries.
- Added a prompt-size regression asserting routed prompt assembly stays materially smaller than naive full-body injection for focused user queries.

### Verification refresh
- `sidecar/npm run typecheck` -> pass
- `sidecar/npm run test:stable` -> pass (`78` tests)
- `desktop/bun test tests/phase2-acceptance.test.ts` -> pass (`53` tests)
- `desktop/npx tsc --noEmit` -> pass

### Desktop E2E coverage
- Added `desktop/tests/skill-prompt-routing-desktop-e2e.test.ts` to validate routed skill-body loading through the real Tauri desktop chat flow.
- Seeded two enabled local skills (`codex-e2e-weather-routing`, `codex-e2e-stock-routing`) and verified:
  - weather prompt includes the weather skill and excludes the stock skill
  - stock prompt includes the stock skill and excludes the weather skill
  - small-talk prompt routes neither custom skill
- Hardened the E2E against real desktop log conditions:
  - strips raw and escaped ANSI color codes from sidecar stderr
  - accepts `TASK_STATUS finished|completed` in addition to `TASK_FINISHED`
  - uses short prompts so the test measures routing behavior instead of long research workflows
- Observed real production behavior during the E2E:
  - builtin process skills can still be routed alongside the target custom skill
  - stock prompts currently co-route builtin `stock-research` and `browser-use`
  - the regression guard therefore asserts inclusion/exclusion for the target custom skills rather than exclusive single-skill routing

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/npx playwright test tests/skill-prompt-routing-desktop-e2e.test.ts --reporter=line` -> pass (`1` test)

## Session: 2026-03-13 (Skill Routing Commercial Hardening)

### Goal
- Tighten skill prompt routing until it meets production-grade precision and regression standards.

### Actions taken
- Reworked `sidecar/src/skills/promptBuilder.ts` to stop treating a full enabled-skill list as routing preference input.
- Added intent-aware penalties so builtin process/debug/planning skills and browser-heavy skills are not injected without matching user intent.
- Added per-family route collapsing so only the strongest skill in a domain family is injected for a turn.
- Added custom-vs-builtin family preference so user-installed skills can win within the same family when explicitly triggered.
- Added a small-talk guardrail so greeting/acknowledgement turns skip skill body routing entirely.
- Expanded unit/eval coverage for:
  - full enabled-list false-positive regression
  - browser skill contamination on finance prompts
  - custom skill preference over builtin same-family skills
  - routing quality gates for precision and forbidden-skill contamination
- Re-ran the desktop Tauri E2E and confirmed:
  - weather turn routes `codex-e2e-weather-routing`
  - stock turn routes `codex-e2e-stock-routing`
  - small-talk turn routes no custom local skills

### Files created/modified
- `sidecar/src/skills/promptBuilder.ts`
- `sidecar/tests/skill-prompt-builder.test.ts`
- `sidecar/tests/skill-routing-eval.test.ts`
- `desktop/tests/skill-prompt-routing-desktop-e2e.test.ts`
- `progress.md`

### Verification
- `sidecar/bun test tests/skill-prompt-builder.test.ts tests/skill-routing-eval.test.ts` -> pass
- `sidecar/bun test tests/token-usage.test.ts tests/tool-disable-config.test.ts tests/command-sandbox.test.ts tests/mcp-toolpack.test.ts tests/rate-limit.test.ts tests/scheduler-heartbeat.test.ts tests/skill-prompt-builder.test.ts tests/system-prompt-serialization.test.ts tests/skill-routing-eval.test.ts` -> pass (`82` tests)
- `sidecar/npm run test:stable` -> pass (`84` tests, includes `skill-routing-commercial-eval.test.ts`)
- `desktop/bun test tests/phase2-acceptance.test.ts` -> pass (`53` tests)
- `desktop/npx tsc --noEmit` -> pass
- `desktop/npx playwright test tests/skill-prompt-routing-desktop-e2e.test.ts --reporter=line` -> pass (`1` test)

## Session: 2026-03-13 (Permission UI + Scheduled Task Surfacing + Python Install Loop)

### Goal
- Fix the permission approval dialog so it matches the main desktop UI.
- Ensure scheduled-task results are surfaced in the active UI when they complete during another task.
- Stop successful Python install tasks from getting stuck in repeated install loops.

### Discovery
- Confirmed the permission dialog still uses hard-coded light colors instead of desktop theme variables.
- Confirmed only reminder completions are mirrored into the active session; generic scheduled-task completions are not.
- Confirmed logs and persisted sessions contain separate `scheduled_*` task lifecycles with valid completion summaries.
- Confirmed repeated successful `pip install` runs exist in historical task traces, with no dedicated runtime suppression in `sidecar/src/main.ts`.

### Next actions
- Re-theme `EffectConfirmationDialog` with shared CSS tokens.
- Extend `useTauriEvents` to mirror scheduled task completion/failure into the active session and toast layer.
- Add runtime detection for repeated successful package-install `run_command` invocations and back it with tests.

## Session: 2026-03-13 (In-App Skill Update Checks)

### Goal
- Add "check for skill updates" and "one-click upgrade" to the CoworkAny desktop Skills UI.

### Actions taken
- Added curated upstream mappings in `sidecar/src/skills/upstreamCatalog.ts` for the known official/community skills CoworkAny already syncs locally.
- Added `sidecar/src/skills/updater.ts` to:
  - fetch upstream `SKILL.md` files from GitHub raw URLs for version checks
  - report unsupported/builtin cases explicitly
  - download the latest skill folder to a temp directory and atomically replace the installed directory on upgrade
- Added new sidecar IPC commands and protocol schemas:
  - `check_claude_skill_updates`
  - `upgrade_claude_skill`
- Added matching Tauri IPC handlers in `desktop/src-tauri/src/ipc.rs` and registered them in `desktop/src-tauri/src/main.rs`.
- Extended the desktop Skills surface in `desktop/src/components/Skills/SkillsView.tsx` and `desktop/src/hooks/useSkills.ts` to:
  - check updates for all skills or a selected skill
  - display update availability and upstream source details
  - trigger one-click upgrade when an upstream version exists
- Added `sidecar/tests/skill-updater.test.ts` to lock the curated mapping and unsupported-upgrade behavior.

### Verification
- `sidecar/npm run typecheck` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `sidecar/bun test tests/skill-updater.test.ts` -> pass

### Files created/modified
- `sidecar/src/skills/upstreamCatalog.ts`
- `sidecar/src/skills/updater.ts`
- `sidecar/src/main.ts`
- `sidecar/src/protocol/commands.ts`
- `sidecar/src/protocol/index.ts`
- `sidecar/src/protocol/protocol_schema.ts`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/hooks/useSkills.ts`
- `desktop/src/components/Skills/SkillsView.tsx`
- `sidecar/tests/skill-updater.test.ts`

## Session: 2026-03-13 (Explicit Soul Layer)

### Goal
- Add an explicit soul layer with stable user preferences, deterministic prompt priority, and minimal desktop editing support.

### Actions taken
- Added `sidecar/src/promptContext/profile.ts` to define and format the soul profile, workspace policy, and current-session prompt sections.
- Switched the main prompt builder in `sidecar/src/main.ts` to load:
  - `user-profile.json` from shared app data
  - workspace policy files from the active workspace
  - current session metadata from `taskConfigs`
  - retrieved vault memory before routing skill content
- Added desktop Tauri commands to read and write `user-profile.json`:
  - `get_user_profile`
  - `save_user_profile`
- Added `SoulProfile` UI types and replaced the placeholder directives UI with `desktop/src/components/Settings/SoulEditor.tsx`.
- Wired the settings hook and settings page to load, save, and react to `user-profile-updated` events.
- Tightened Anthropic structured prompt serialization so dynamic context comes before the cached tool-description block.
- Added `sidecar/tests/soul-context.test.ts` to lock the soul formatting and ordering behavior.

### Verification
- `sidecar/npm run typecheck` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `sidecar/bun test tests/soul-context.test.ts tests/system-prompt-serialization.test.ts` -> pass

### Files created/modified
- `sidecar/src/promptContext/profile.ts`
- `sidecar/src/main.ts`
- `sidecar/src/llm/systemPrompt.ts`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/types/ui.ts`
- `desktop/src/types/index.ts`
- `desktop/src/components/Settings/SoulEditor.tsx`
- `desktop/src/components/Settings/SettingsView.tsx`
- `desktop/src/components/Settings/hooks/useSettings.ts`
- `sidecar/tests/soul-context.test.ts`
- `sidecar/tests/system-prompt-serialization.test.ts`

## Session: 2026-03-14 (Skill-Creator Eval Loop UI)

### Goal
- Expose the official `skill-creator` eval loop in the CoworkAny desktop UI instead of stopping at skill creation only.

### Actions taken
- Added desktop-side orchestration for the selected skill in `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`.
- Added new Tauri IPC handlers in `desktop/src-tauri/src/ipc.rs` to:
  - create or open `evals/evals.json`
  - run `.agent/skills/skill-creator/scripts/aggregate_benchmark.py`
  - run `.agent/skills/skill-creator/eval-viewer/generate_review.py --static`
- Registered the new commands in `desktop/src-tauri/src/main.rs`.
- Integrated the workbench into `desktop/src/components/Skills/SkillsView.tsx` so the selected skill now exposes:
  - `Create/Open` for `evals/evals.json`
  - benchmark aggregation
  - static review viewer generation
  - quick-open actions for `benchmark.json`, `benchmark.md`, and `review.html`
- Built a local smoke fixture under `.tmp/skill-creator-smoke/` with valid `eval_metadata.json`, `grading.json`, and output files to verify the official scripts against realistic data.

### Verification
- `python .agent/skills/skill-creator/scripts/aggregate_benchmark.py .tmp/skill-creator-smoke --skill-name sample-skill --skill-path .tmp/sample-skill` -> pass
- `python .agent/skills/skill-creator/eval-viewer/generate_review.py .tmp/skill-creator-smoke --skill-name sample-skill --benchmark .tmp/skill-creator-smoke/benchmark.json --static .tmp/skill-creator-smoke/review.html` -> pass
- Generated outputs:
  - `.tmp/skill-creator-smoke/benchmark.json`
  - `.tmp/skill-creator-smoke/benchmark.md`
  - `.tmp/skill-creator-smoke/review.html`

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src/components/Skills/SkillsView.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `.tmp/skill-creator-smoke/eval-1/eval_metadata.json`
- `.tmp/skill-creator-smoke/eval-1/with_skill/run-1/grading.json`
- `.tmp/skill-creator-smoke/eval-1/without_skill/run-1/grading.json`
- `.tmp/skill-creator-smoke/eval-1/with_skill/run-1/outputs/result.txt`
- `.tmp/skill-creator-smoke/eval-1/without_skill/run-1/outputs/result.txt`
- `.tmp/sample-skill/SKILL.md`

## Session: 2026-03-14 (Skill-Creator Review Loop UX)

### Goal
- Make the new skill-creator eval workbench actually usable for repeated human review by removing manual path typing and adding `feedback.json` re-import.

### Actions taken
- Added Tauri dialog support:
  - frontend dependency `@tauri-apps/plugin-dialog`
  - Rust dependency `tauri-plugin-dialog`
  - `dialog:allow-open` capability on the main window
- Registered the dialog plugin in `desktop/src-tauri/src/main.rs`.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` with:
  - folder picker for the benchmark workspace
  - folder picker for the optional previous workspace
  - open-folder actions for both paths
  - workspace `feedback.json` display
  - JSON file picker + import flow for downloaded review feedback
- Added `import_skill_review_feedback` to `desktop/src-tauri/src/ipc.rs` so the desktop app can validate and copy downloaded reviewer feedback into `<workspace>/feedback.json`.
- Refactored feedback import into a testable helper and added a Rust unit test to lock the normalization behavior (`status: complete` when missing).

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked import_feedback_json_normalizes_status` -> pass

### Files created/modified
- `desktop/package.json`
- `desktop/package-lock.json`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`
- `desktop/src-tauri/capabilities/default.json`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Benchmark Summary In-App)

### Goal
- Surface benchmark/analyzer output directly inside the Skills panel instead of forcing the user to open `benchmark.json` manually.

### Actions taken
- Added `load_skill_benchmark_preview` to `desktop/src-tauri/src/ipc.rs` to read generated `benchmark.json` files safely through Tauri IPC.
- Added a reusable `read_json_file` helper and a Rust unit test for benchmark JSON parsing.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` with:
  - benchmark summary loading
  - per-configuration pass-rate / time / token overview
  - delta display
  - analyzer notes display from top-level `benchmark.notes`
  - deduped run notes display from `runs[].notes`
- Wired benchmark preview refresh into the existing aggregate flow so successful aggregation immediately refreshes the in-app summary when `benchmark.json` is generated.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked read_json_file_returns_parsed_object` -> pass
- `desktop/src-tauri cargo test --locked import_feedback_json_normalizes_status` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Live Review Server)

### Goal
- Remove the last major friction in the human review loop by launching the official live review server from CoworkAny and letting feedback save straight into the workspace.

### Actions taken
- Added managed local review-server lifecycle commands in `desktop/src-tauri/src/ipc.rs`:
  - `start_skill_review_server`
  - `stop_skill_review_server`
- Added lightweight helpers for:
  - picking a free localhost TCP port
  - waiting for the review server to become reachable
  - stopping a previously launched review server child process
- Added `SkillReviewServerState` management in `desktop/src-tauri/src/main.rs` so live viewer processes are tracked per workspace.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` with:
  - `Launch live viewer`
  - `Stop live viewer`
  - live viewer URL display
  - server log access
- Kept the implementation aligned with the official `generate_review.py` server mode rather than building a custom embedded reviewer.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked pick_free_local_port_returns_non_zero_port` -> pass
- `desktop/src-tauri cargo test --locked read_json_file_returns_parsed_object` -> pass
- `desktop/src-tauri cargo test --locked import_feedback_json_normalizes_status` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Live Viewer Status Restore)

### Goal
- Make the live review server UX resilient when users switch skills or reopen the window by restoring workspace selections and probing whether the review server is still running.

### Actions taken
- Added `get_skill_review_server_status` to `desktop/src-tauri/src/ipc.rs` so the frontend can query whether a review server is still alive for a given workspace.
- Reused the managed child-process map to:
  - return URL/log metadata for live servers that are still running
  - prune stale entries when the server process has already exited
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - persist `benchmarkDir` and `previousWorkspacePath` in local storage per skill
  - restore those values when returning to the skill
  - auto-probe the live review server status for the restored workspace
  - show explicit running/stopped status in the panel

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked pick_free_local_port_returns_non_zero_port` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Analyzer Notes Editor)

### Goal
- Close the analyzer gap by letting users create and save benchmark observations directly into `benchmark.json`, even though the official skill currently ships analyzer instructions but no standalone analyzer script.

### Actions taken
- Added `save_skill_benchmark_notes` to `desktop/src-tauri/src/ipc.rs`.
- Added a `write_benchmark_notes` helper to update top-level `benchmark.notes` while preserving the rest of the benchmark schema.
- Added a Rust unit test covering benchmark note persistence.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` with:
  - an analyzer notes draft editor
  - save action back into `benchmark.json`
  - seed-from-existing-notes convenience action
- Reused the existing benchmark reload path so saved notes immediately reappear in the in-app summary.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked write_benchmark_notes_updates_top_level_notes` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Automatic Analyzer Drafts)

### Goal
- Reduce the manual benchmark-analysis burden by generating a first-pass analyzer notes draft directly from `benchmark.json`.

### Actions taken
- Added `generate_skill_benchmark_notes` to `desktop/src-tauri/src/ipc.rs`.
- Implemented heuristic note generation from benchmark data for:
  - expectation pass/fail patterns across configurations
  - high per-eval variance
  - significant pass-rate/time tradeoffs
  - significant token deltas
- Added a Rust unit test covering generated note behavior from a representative benchmark fixture.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` with a `Generate draft` action that fills the analyzer notes editor from the benchmark file without saving immediately.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked generate_benchmark_notes_from_value_surfaces_expectation_patterns_and_metrics` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`

## Session: 2026-03-14 (Benchmark Artifact Consistency)

### Goal
- Keep benchmark artifacts consistent after analyzer edits so saved notes update both `benchmark.json` and the human-readable `benchmark.md`.

### Actions taken
- Extended `write_benchmark_notes` in `desktop/src-tauri/src/ipc.rs` to regenerate `benchmark.md` whenever top-level benchmark notes change.
- Added a small Markdown renderer based on the official benchmark schema so the Markdown summary stays aligned with the current JSON payload.
- Extended the benchmark-note persistence test to verify that `benchmark.md` is rewritten and contains the saved notes.

### Verification
- `desktop/src-tauri cargo test --locked write_benchmark_notes_updates_top_level_notes` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/npx tsc --noEmit` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`

## Session: 2026-03-14 (Model-Backed Benchmark Analyzer)

### Goal
- Raise the skill-creator analyzer from heuristic-only note drafts to a model-backed analyzer that reuses the active CoworkAny LLM configuration and falls back cleanly when generation is unavailable.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - resolve the active LLM profile from `llm-config.json`
  - support Anthropic, OpenRouter, OpenAI-compatible providers, custom providers, and Ollama for benchmark-note generation
  - load the benchmark-analysis section from `.agent/skills/skill-creator/agents/analyzer.md`
  - build a curated benchmark-analysis prompt from `benchmark.json`
  - parse raw JSON arrays, object-wrapped `notes`, and markdown-fenced JSON responses
  - fall back to the existing heuristic draft generator whenever model generation fails or returns empty output
- Updated `validate_llm_settings` so `ollama` no longer shows up as an unknown provider in the desktop Rust layer.
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` so `Generate draft` now:
  - sends `skillPath` with the benchmark request
  - uses model-backed generation first
  - shows whether the draft came from the model or from heuristic fallback
  - surfaces fallback warnings inline instead of failing closed
- Added Rust regression tests for:
  - markdown-wrapped model note parsing
  - active-profile resolution precedence

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked parse_benchmark_notes_response_accepts_markdown_wrapped_notes_object` -> pass
- `desktop/src-tauri cargo test --locked resolve_active_llm_profile_prefers_active_profile_settings` -> pass
- `desktop/src-tauri cargo test --locked write_benchmark_notes_updates_top_level_notes` -> pass
- `desktop/src-tauri cargo test --locked generate_benchmark_notes_from_value_surfaces_expectation_patterns_and_metrics` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Benchmark Notes Provenance & Rollback)

### Goal
- Make benchmark note saves auditable and safely reversible by persisting per-save history with generator provenance and exposing recent snapshots in the workbench UI.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - accept optional note-save metadata on `save_skill_benchmark_notes`
  - append each save to a sibling `benchmark.notes-history.jsonl`
  - persist previous top-level notes alongside the newly saved notes
  - expose `load_skill_benchmark_notes_history` for UI consumption
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - remember the current draft metadata from model/heuristic generation
  - send that provenance when saving benchmark notes
  - load recent note-history entries for the selected benchmark
  - render recent snapshots with source/provider/model details
  - support loading any saved snapshot back into the editor for manual rollback
- Registered the new IPC command in `desktop/src-tauri/src/main.rs`.
- Added a Rust regression test covering history persistence, previous-note capture, and provenance fields.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked benchmark_notes_history_records_provenance_and_previous_notes` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Live Smoke Acceptance Gate)

### Goal
- Add a real-provider analyzer acceptance path and tighten readiness semantics so the skill-creator workbench has a practical release gate instead of only local observability.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - add readiness failure-budget and staleness signals
  - block readiness when the recent error budget is exhausted
  - warn when the latest healthy smoke is stale
  - add targeted Rust tests for failure-budget exhaustion and stale-smoke behavior
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - parse and render readiness budget/staleness fields
  - show failure-budget remaining, failure rate, latest event age, and smoke age
- Added `desktop/tests/analyzer-live-smoke-desktop-e2e.test.ts`:
  - env-gated real-provider desktop smoke
  - saves a temporary active profile through Tauri IPC
  - runs analyzer smoke
  - runs model-backed note generation
  - assesses readiness
  - verifies analyzer artifacts exist
  - restores the original LLM config
- Added `desktop/package.json` script:
  - `test:e2e:analyzer-live`
- Added `.github/workflows/analyzer-live-smoke.yml`:
  - manual Windows workflow for env-gated real-provider analyzer validation
  - validates required secret/input shape before launching the desktop live smoke
- Extended the live-smoke path to produce durable artifacts:
  - safe summary JSON in `desktop/test-results/analyzer-live-smoke`
  - optional workspace preservation via `COWORKANY_ANALYZER_SMOKE_KEEP_WORKSPACE=1`
  - HTML Playwright report generation
  - workflow artifact upload for smoke results
- Added `desktop/scripts/run-analyzer-live-smoke.mjs` as the shared preflight/runner entrypoint for both local use and GitHub Actions.
- Switched the default live-smoke contract to:
  - use the active provider/model already configured in local CoworkAny settings
  - treat env vars as optional overrides instead of required inputs
  - use a self-hosted Windows workflow rather than GitHub-hosted secrets
- Extended `desktop/tests/skill-creator-workbench.test.ts` to cover readiness controls and readiness IPC wiring.

### Verification
- `desktop/bun test tests/skill-creator-workbench.test.ts` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked assess_analyzer_readiness` -> pass
- `desktop/npx playwright test tests/analyzer-live-smoke-desktop-e2e.test.ts --list` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/tests/skill-creator-workbench.test.ts`
- `desktop/tests/analyzer-live-smoke-desktop-e2e.test.ts`
- `desktop/scripts/run-analyzer-live-smoke.mjs`
- `desktop/package.json`
- `.github/workflows/analyzer-live-smoke.yml`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Network Hardening & Audit Logs)

### Goal
- Bring the model-backed analyzer closer to production by honoring proxy settings, retrying transient failures, and writing a durable audit artifact for every analyzer invocation.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - build analyzer HTTP clients from the shared desktop proxy settings
  - respect proxy bypass host patterns for analyzer endpoints
  - retry transient analyzer send/status failures once
  - capture analyzer invocation details into structured JSON logs under `.coworkany-analyzer-logs`
  - return analyzer log path, attempt count, and proxy-routing metadata to the UI
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - store the latest analyzer log path
  - expose an `Open analyzer log` action after note generation
  - show generation timestamp and proxy-routing context alongside draft status
- Added Rust regression tests for:
  - proxy bypass hostname matching
  - analyzer invocation log creation

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked should_bypass_proxy_matches_exact_and_suffix_hosts` -> pass
- `desktop/src-tauri cargo test --locked write_analyzer_invocation_log_creates_json_artifact` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Connectivity Probe)

### Goal
- Make analyzer readiness visible before generation by probing the active model path from inside the Skill Creator workbench.

### Actions taken
- Added `check_skill_benchmark_analyzer` in `desktop/src-tauri/src/ipc.rs` to:
  - load the active LLM profile
  - run a lightweight connectivity probe through the analyzer networking path
  - return readiness, provider/model, attempts, endpoint, and proxy-routing metadata
- Reused the same proxy/retry-aware analyzer client path so the probe matches real generation behavior instead of becoming a separate code path.
- Updated `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - auto-check analyzer readiness when the workbench loads
  - expose a manual `Check analyzer` action
  - render readiness state, attempts, HTTP status, and proxy-routing hints inline
- Registered the new command in `desktop/src-tauri/src/main.rs`.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Workspace Analyzer Health State)

### Goal
- Persist analyzer health per benchmark workspace so the Skill Creator workbench restores the last known readiness/generation state when users revisit an iteration.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - define a workspace-local analyzer health artifact
  - persist `.coworkany-analyzer-status.json` beside the benchmark workspace
  - update that status from both analyzer probe and analyzer generation paths
  - expose `load_skill_benchmark_analyzer_status` for the frontend
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - load persisted analyzer status when a benchmark workspace is selected
  - merge generation results back into the visible analyzer health state
  - expose `Open status file` from the analyzer connectivity section
  - show last updated time and source (`probe` or `generate`)
- Registered the new IPC command in `desktop/src-tauri/src/main.rs`.
- Added a Rust regression test covering analyzer health status round-trip persistence.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked analyzer_health_status_round_trips_from_workspace_file` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Health History & Trends)

### Goal
- Surface recent analyzer reliability trends per benchmark workspace instead of showing only the last known analyzer status.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - append every analyzer health status write to `.coworkany-analyzer-status-history.jsonl`
  - expose `load_skill_benchmark_analyzer_history`
  - add a Rust regression test verifying newest-first analyzer history loading
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - load analyzer history for the selected benchmark workspace
  - refresh that history after analyzer probe and generation
  - render recent analyzer success/failure counts
  - render the last few analyzer events and expose `Open history file`
- Registered the new IPC command in `desktop/src-tauri/src/main.rs`.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked analyzer_health_history_loads_newest_entries_first` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Smoke & Reliability Rating)

### Goal
- Move analyzer verification beyond connectivity-only checks by adding a full-path synthetic smoke run and a simple reliability rating derived from recent analyzer events.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - add a synthetic benchmark-analysis smoke fixture
  - add `run_skill_benchmark_analyzer_smoke`
  - route smoke outcomes through the same analyzer invocation log and health/history persistence pipeline
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - add a `Run analyzer smoke` action
  - compute a `Healthy / Degraded / Unhealthy / Unknown` reliability rating from recent analyzer history
  - show that reliability rating directly in the analyzer connectivity section
- Registered the new IPC command in `desktop/src-tauri/src/main.rs`.
- Added a Rust regression test ensuring the synthetic smoke fixture includes a valid `with_skill` / `without_skill` comparison shape.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked build_benchmark_smoke_context_contains_comparison_runs` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Workbench Regression Coverage)

### Goal
- Add explicit desktop regression coverage for the skill-creator analyzer workbench instead of relying only on compile checks.

### Actions taken
- Extracted `deriveAnalyzerReliability` from `SkillCreatorWorkbench.tsx` as a pure exported helper.
- Added [skill-creator-workbench.test.ts](/d:/private/coworkany/desktop/tests/skill-creator-workbench.test.ts) covering:
  - reliability derivation for `unknown / healthy / degraded / unhealthy`
  - presence of analyzer smoke, status, history, and log controls
  - presence of the expected analyzer IPC command usage in the workbench

### Verification
- `desktop/bun test tests/skill-creator-workbench.test.ts` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass

### Files created/modified
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `desktop/tests/skill-creator-workbench.test.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Analyzer Readiness Gate)

### Goal
- Turn analyzer status/history/smoke signals into a concrete per-workspace release gate with explicit reasons and recommendations.

### Actions taken
- Extended `desktop/src-tauri/src/ipc.rs` to:
  - add a readiness assessment model
  - add `assess_skill_benchmark_analyzer_readiness`
  - persist `.coworkany-analyzer-readiness.json`
  - add a Rust regression test requiring smoke success before readiness can pass
- Extended `desktop/src/components/Skills/SkillCreatorWorkbench.tsx` to:
  - load and display analyzer readiness
  - expose an `Assess readiness` action
  - show `Ready / Warning / Blocked` verdicts plus reasons and recommendations
  - expose `Open readiness file`
- Registered the new IPC command in `desktop/src-tauri/src/main.rs`.

### Verification
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo fmt --manifest-path Cargo.toml` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/src-tauri cargo test --locked assess_analyzer_readiness_requires_smoke_success` -> pass
- `desktop/bun test tests/skill-creator-workbench.test.ts` -> pass

### Files created/modified
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src/components/Skills/SkillCreatorWorkbench.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-14 (Scheduled Task Card Commercial Hardening)

### Goal
- Bring scheduled-task execution results on the task board to commercial-readiness by localizing task-card status copy, adding recent execution history, and verifying both success and failure states in the packaged desktop app.

### Actions taken
- Extended sidecar trigger state in `sidecar/src/proactive/heartbeat.ts` with bounded `recentRuns` history while preserving `lastRun*` summary fields.
- Extended `get_tasks` in `sidecar/src/handlers/core_skills.ts` to return `recentRuns`, with backward-compatible synthesis from legacy `lastRun*` fields when needed.
- Updated the desktop task model in `desktop/src/hooks/useTasks.ts` to carry scheduled-task run history.
- Updated `desktop/src/components/jarvis/TaskListView.tsx` and `desktop/src/components/jarvis/TaskListView.css` to render:
  - localized latest-run status
  - localized latest-result label
  - recent execution history entries on each scheduled-task card
- Added the new task-card strings to:
  - `desktop/src/i18n/locales/en.json`
  - `desktop/src/i18n/locales/zh.json`
- Extended sidecar regression coverage in `sidecar/tests/task-list-aggregation.test.ts`.
- Extended packaged desktop E2E coverage in `desktop/tests/task-list-desktop-e2e.test.ts` for:
  - scheduled task success card
  - scheduled task failure card
  - recent run history rendering
- Tightened the packaged E2E selector strategy to card-scoped assertions so the test stays stable when multiple scheduled-task cards are present.

### Verification
- `sidecar/npm run typecheck` -> pass
- `sidecar/bun test tests/task-list-aggregation.test.ts` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/npx tauri build --no-bundle` -> pass
- `desktop/npx playwright test tests/task-list-desktop-e2e.test.ts --reporter=line` -> pass

### Files created/modified
- `sidecar/src/proactive/heartbeat.ts`
- `sidecar/src/handlers/core_skills.ts`
- `desktop/src/hooks/useTasks.ts`
- `desktop/src/components/jarvis/TaskListView.tsx`
- `desktop/src/components/jarvis/TaskListView.css`
- `desktop/src/i18n/locales/en.json`
- `desktop/src/i18n/locales/zh.json`
- `sidecar/tests/task-list-aggregation.test.ts`
- `desktop/tests/task-list-desktop-e2e.test.ts`
- `desktop/tests/tauriFixtureRelease.ts`

## Session: 2026-03-15 (Chat Execution Reliability & Readability)

### Goal
- Diagnose why the latest task run repeated status/action chatter, failed to show a reliable result, and did not recover cleanly after model transport drops; then harden the desktop and sidecar behavior.

### Actions taken
- Inspected the latest logs:
  - `C:\Users\liula\AppData\Roaming\com.coworkany.desktop\logs\sidecar-2026-03-15.log`
  - `C:\Users\liula\AppData\Roaming\com.coworkany.desktop\logs\desktop.log.2026-03-14`
- Confirmed the latest task loop repeatedly called `run_command`, hit transient socket-close retries, and never emitted a terminal `TASK_FINISHED`/`TASK_FAILED` event for the active run.
- Fixed `sidecar/src/main.ts` to:
  - stop double-appending the same follow-up user message in `send_task_message`
  - normalize tool event payloads for the desktop UI while preserving legacy fields
  - make `runAgentLoop` return outcome metadata instead of only `void`
  - emit real terminal summaries from the latest assistant output for both `start_task` and `send_task_message`
  - emit a recoverable `TASK_MAX_STEPS_EXCEEDED` failure when the loop exhausts its reasoning budget without a result
  - mark transport-style `MODEL_STREAM_ERROR` failures as recoverable with reconnection guidance
- Added `sidecar/src/agent/taskOutcome.ts` plus `sidecar/tests/task-outcome.test.ts` for assistant-result extraction and terminal summary building.
- Simplified desktop task-event reducers so tool/effect/patch/task-failure events update structured state without also duplicating themselves into `session.messages`.
- Updated `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts` to merge consecutive identical tool calls into one timeline card with a repeat count.
- Updated `desktop/src/components/Chat/Timeline/components/ToolCard.tsx` and `desktop/src/components/Chat/Timeline/Timeline.module.css` to surface repeated calls and improve timeline readability.
- Updated `desktop/src/components/Chat/Timeline/components/SystemBadge.tsx` and timeline styles so system notices render as readable cards instead of tiny centered pills.
- Updated `desktop/src/components/Chat/ChatInterface.tsx` so recoverable model transport failures automatically continue the interrupted task once connectivity returns.
- Added `desktop/tests/timeline-items.test.ts` to lock the new tool-call aggregation behavior.

### Verification
- `sidecar/bun test tests/task-outcome.test.ts tests/skill-prompt-builder.test.ts` -> pass
- `desktop/bun test tests/timeline-items.test.ts tests/use-tauri-events.test.ts` -> pass
- `sidecar/npm run typecheck` -> pass
- `desktop/npx tsc --noEmit` -> pass

### Files created/modified
- `sidecar/src/main.ts`
- `sidecar/src/agent/taskOutcome.ts`
- `sidecar/tests/task-outcome.test.ts`
- `desktop/src/components/Chat/ChatInterface.tsx`
- `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
- `desktop/src/components/Chat/Timeline/components/ToolCard.tsx`
- `desktop/src/components/Chat/Timeline/components/SystemBadge.tsx`
- `desktop/src/components/Chat/Timeline/Timeline.module.css`
- `desktop/src/stores/taskEvents/reducers/taskReducer.ts`
- `desktop/src/stores/taskEvents/reducers/toolReducer.ts`
- `desktop/src/stores/taskEvents/reducers/effectReducer.ts`
- `desktop/src/stores/taskEvents/reducers/patchReducer.ts`
- `desktop/src/types/events.ts`
- `desktop/tests/timeline-items.test.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-15 (Recoverable Task Snapshot Resume)

### Goal
- Make interrupted task recovery survive sidecar restarts by persisting task runtime snapshots, auto-resuming recoverable work on startup/reconnect, and surfacing stalled tasks as explicit recoverable failures.

### Actions taken
- Extended `sidecar/src/main.ts` with persistent task runtime metadata:
  - per-task config typing
  - runtime status tracking
  - workspace-local snapshot persistence under `.coworkany/runtime/tasks/<taskId>.json`
  - a progress-aware terminal watchdog for running tasks
- Updated the sidecar event emitter so task lifecycle events keep runtime snapshots in sync and stalled tasks become recoverable `TASK_FAILED` events with actionable guidance.
- Added snapshot restore/scan helpers plus a new `resume_recoverable_tasks` command in:
  - `sidecar/src/main.ts`
  - `sidecar/src/protocol/commands.ts`
- Added desktop-to-sidecar wiring for recoverable-task resume in:
  - `desktop/src-tauri/src/ipc.rs`
  - `desktop/src-tauri/src/main.rs`
- Updated `desktop/src/hooks/useTauriEvents.ts` so recoverable tasks are resumed both when the sidecar reconnects and when the desktop first connects on startup.
- Extended `desktop/tests/use-tauri-events.test.ts` to lock the startup + reconnect recovery contract.

### Verification
- `sidecar/npm run typecheck` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/bun test tests/use-tauri-events.test.ts tests/timeline-items.test.ts` -> pass
- `sidecar/bun test tests/task-outcome.test.ts tests/skill-prompt-builder.test.ts` -> pass

### Files created/modified
- `sidecar/src/main.ts`
- `sidecar/src/protocol/commands.ts`
- `desktop/src/hooks/useTauriEvents.ts`
- `desktop/src-tauri/src/ipc.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/tests/use-tauri-events.test.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

## Session: 2026-03-15 (Packaged Crash/Restart Recovery Verification)

### Goal
- Verify restart recovery in the packaged desktop app, fix the protocol/runtime issues found by the real E2E, and tighten recovery so only the intended interrupted task resumes.

### Actions taken
- Added recovery input normalization in `sidecar/src/agent/recoveryHints.ts` and a matching regression test in `sidecar/tests/recovery-hints.test.ts`.
- Relaxed the `resume_recoverable_tasks` schema in `sidecar/src/protocol/commands.ts` so invalid task IDs no longer invalidate the whole command, then normalized and skipped bad IDs inside `sidecar/src/main.ts`.
- Updated `desktop/src/hooks/useTauriEvents.ts` to:
  - filter recovery hints to UUID task sessions only
  - hydrate persisted sessions before startup recovery
  - scope reconnect recovery to currently running tasks
  - scope cold-start recovery to the fresh active/foreground recoverable task
- Tightened packaged recovery behavior in `sidecar/src/main.ts` so `recoverable_interrupted` snapshots are only resumable when they are fresh and still marked `autoResumePending`.
- Strengthened the packaged E2E in `desktop/tests/task-recovery-restart-desktop-e2e.test.ts` to assert against the concrete final result text rather than a broad `RECOVERY_OK` substring.
- Rebuilt the production artifacts needed by the packaged test:
  - `desktop npm run build`
  - `sidecar bun run build:release`
  - `desktop/src-tauri cargo build --release --locked`

### Verification
- `sidecar/.\\node_modules\\.bin\\tsc.cmd --noEmit` -> pass
- `desktop/npx tsc --noEmit` -> pass
- `sidecar/bun test tests/recovery-hints.test.ts` -> pass
- `desktop/bun test tests/use-tauri-events.test.ts` -> pass
- `desktop/src-tauri cargo check --locked` -> pass
- `desktop/npx playwright test tests/task-recovery-restart-desktop-e2e.test.ts --reporter=line` -> pass outside sandbox

### Outcome
- Packaged crash/restart recovery now completes end-to-end with:
  - sidecar crash
  - watchdog restart
  - targeted task resume
  - `TASK_FINISHED`
  - final assistant result `Recovery succeeded. Final result: RECOVERY_OK`
- Recovery no longer fans out into multiple stale historical tasks during the packaged acceptance run.

### Files created/modified
- `sidecar/src/agent/recoveryHints.ts`
- `sidecar/tests/recovery-hints.test.ts`
- `sidecar/src/protocol/commands.ts`
- `sidecar/src/main.ts`
- `desktop/src/hooks/useTauriEvents.ts`
- `desktop/tests/use-tauri-events.test.ts`
- `desktop/tests/task-recovery-restart-desktop-e2e.test.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`
