# Findings & Decisions

## Requirements
- The user wants the current beta release to be actually runnable across platforms, not merely buildable.
- Current priority is to continue from release workflow fixes into real packaged runtime validation.
- Windows packaged smoke test is the primary concrete validation path available in the current environment.

## Research Findings
- `v0.1.0-beta.1-r8` release workflow passed and produced artifacts for `windows-x64`, `macos-x64`, `macos-arm64`, and `linux-x64`.
- A successful release workflow does not prove the installed app runs; Windows packaged smoke testing exposed runtime failures not caught by CI packaging.
- The desktop app previously panicked at startup because `tauri_plugin_updater` was registered while `plugins.updater` was not configured in `tauri.conf.json`.
- After removing updater runtime wiring, the packaged Windows executable starts Tauri successfully and writes logs.
- The local environment has `bun 1.3.9` available, so building a release-mode sidecar executable is feasible to validate directly on Windows before changing CI.
- `bun build --compile --target=bun` works for the sidecar when `electron` and `chromium-bidi*` are externalized; it produces a Windows binary successfully on the current machine.
- The Tauri bundle can carry `sidecar/dist/*` as resources, and the Windows release build now materializes them under `target/x86_64-pc-windows-msvc/release/sidecar/`.
- A fresh Windows release smoke test now shows `coworkany-desktop.exe` resolving `release/sidecar/coworkany-sidecar.exe`, spawning it successfully, and exchanging IPC commands such as `list_workspaces`, `list_toolpacks`, and `list_claude_skills`.
- GitHub Actions runs triggered by `64d7795` / `v0.1.0-beta.1-r10` are still in progress as of March 12, 2026, but both CI and Release have already produced `linux-x64` and `macos-arm64` artifacts without exposing any new failure annotation yet.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat packaged runtime smoke tests as release gates | CI packaging success was insufficient; runtime validation exposed real blockers |
| Remove updater runtime before solving sidecar packaging | Updater panic was a guaranteed startup failure and low-value for beta |
| Keep sidecar issue as the next primary blocker | It affects real packaged functionality across platforms, not just one CI runner |
| Compile the sidecar into a per-platform Bun executable for release builds | This avoids shipping source-only `src/main.ts` into release packages and keeps the runtime self-contained enough for beta |
| Bundle `playwright-bridge.cjs` as a resource and pass its path via `COWORKANY_PLAYWRIGHT_BRIDGE` | The compiled sidecar still launches a Node bridge for Playwright, so that bridge must remain available on disk in release builds |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `tauri_plugin_updater` caused startup panic in packaged Windows build | Disabled updater dependency, permission, and plugin registration |
| Packaged sidecar auto-spawn cannot find `sidecar/src/main.ts` | Replaced release startup with packaged sidecar binary/resource lookup in `desktop/src-tauri/src/sidecar.rs` |
| PowerShell mangled one `rg` pattern containing quotes/pipes | Use single-quoted regex or simpler searches on the next attempt |
| `bundle.resources` first pointed at the wrong relative source directory | Adjusted the resource paths to be relative to `desktop/src-tauri/tauri.conf.json`, not the `desktop/` working directory |

## Resources
- `desktop/src-tauri/src/sidecar.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src-tauri/tauri.conf.json`
- Release run `22936499338`
- CI run `22936495805`

## Visual/Browser Findings
- Public GitHub release page and Actions page confirm artifact production for all four release targets on `r8`.
- Public Actions pages do not provide enough raw Linux logs unauthenticated to diagnose platform failures beyond annotations, so local/runtime verification is more reliable for current progress.

## Follow-up: Skill Resolution Flow
- Local runtime logs from `2026-03-12 03:34:09` show the model received `trigger_learning` and `find_learned_capability`, but no tool that could search or install marketplace skills before creating one.
- The same log sequence shows a user asking to create a skill for `nanobanana 2`, after which the model immediately pivoted to `search_web`, confirming there was no enforced local-or-market skill resolution path.
- The sidecar already had all lower-level pieces for the intended flow:
  - local installed skill inventory via `SkillStore.list()`
  - curated GitHub discovery via `scanDefaultRepositories()`
  - ClawHub search/install via `openclawCompat.searchClawHub()` and `installFromClawHub()`
  - GitHub download/install via `downloadSkillFromGitHub()`
- The missing layer was a model-visible orchestration tool. Adding `resolve_skill_request` is the lowest-risk fix because it reuses existing stores and installers instead of reworking IPC or frontend flows.
- Prompt-only guidance was insufficient. The previous prompts said "check existing skills first", but the model tool surface still made creation/self-learning the easiest path.

## Follow-up: Skill Prompt Injection
- `sidecar/src/main.ts` currently builds chat system prompt content by concatenating the system environment, tool guidance, self-learning prompt, and the full `SKILL.md` bodies for every selected skill.
- If `enabledClaudeSkills` is empty, current behavior falls back to `skillStore.listEnabled()`, which means every enabled skill body can be injected into chat requests even when unrelated to the current turn.
- The current hard cap is `32000` characters. This limits runaway prompt growth but still allows substantial irrelevant context to displace current-task instructions before truncation.
- Existing `SkillStore` metadata already includes enough signal for first-pass routing: `name`, `description`, `tags`, `triggers`, `allowedTools`, and `requires`.
- Existing resolver scoring in `sidecar/src/skills/skillResolver.ts` already provides a usable baseline for lexical matching and can be adapted for prompt-time skill routing.
- The implemented production-safe shape is:
  - stable cached prompt: system environment, tool guidance, autonomous/self-learning guidance, skill catalog metadata
  - dynamic per-turn prompt: command/browser/scheduling directives plus routed top-k skill bodies only
- A simple score threshold alone was not enough because generic builtin skills still leaked into routed bodies. Adding a second-stage `topScore * 0.55` floor removed those weak matches in practice without breaking direct trigger routing.

## Follow-up: Permission UI + Scheduled Task Surfacing + Python Install Loop
- `desktop/src/components/EffectConfirmationDialog.css` is still using standalone light-theme colors (`white`, gray, blue, red) instead of shared desktop theme variables from `desktop/src/styles/variables.css`, which is why the approval UI looks detached from the main app.
- `desktop/src/hooks/useTauriEvents.ts` only mirrors reminder summaries (`[Reminder] ...`) into the active session. Other `scheduled_*` tasks finish in their own background session, so when they run while the user is focused on another task the result is persisted but not surfaced in the current chat UI.
- Desktop runtime logs for March 13, 2026 show scheduled tasks and foreground tasks executing concurrently under different task IDs. The scheduled task emits its own `TASK_STARTED`/`TASK_FINISHED`, confirming the backend completes it correctly; the gap is in frontend presentation rather than execution.
- Persisted desktop sessions confirm scheduled tasks are stored with summaries under `scheduled_*` task IDs, matching the user-visible symptom that results exist in storage but are not displayed in the active conversation.
- Historical session logs also show repeated successful `pip install imagehash Pillow` commands, including cases where the tool output already said `Requirement already satisfied` or `Successfully installed`, but the agent still called the same install command again.
- Current loop handling in `sidecar/src/main.ts` focuses on blocked tools and browser observation loops. There is no targeted runtime guard for repeated successful install commands invoked via `run_command`, which leaves Python installation workflows vulnerable to non-terminating retry loops.

## Follow-up: In-App Skill Update Checks
- The desktop Skills UI already had list/import/enable/remove flows, but there was no concept of skill upstream metadata or update status.
- Existing skill records are not persisted with a trustworthy upstream source. The safest first implementation is a curated upstream catalog for known skills instead of trying to infer upgrade origins from every historical install.
- A lightweight update check does not need to clone repositories. Fetching upstream `SKILL.md` from GitHub raw URLs is enough to compare the installed version with the upstream version.
- One-click upgrade can reuse the existing GitHub folder downloader if it downloads into a sibling temp directory first, validates `SKILL.md`, then swaps the directory and re-installs the manifest in `SkillStore`.
- The implemented feature covers curated upstream-backed skills and explicitly reports unsupported cases for builtin skills and arbitrary local-only skills, which avoids unsafe upgrades on unknown sources.

## Follow-up: Explicit Soul Layer
- The current prompt assembly path already had a stable cacheable section and a dynamic per-turn section, which makes a minimal soul implementation straightforward without redesigning the provider adapters.
- The desktop app did not have a real persisted user-directives feature yet. `DirectivesEditor.tsx` was placeholder UI only, so replacing it with a real soul editor is lower-risk than trying to retrofit the stub.
- A separate `user-profile.json` in the shared app data directory is the cleanest minimal storage format because it is explicit, user-editable, portable, and does not overload `llm-config.json`.
- The implemented soul schema stores only stable traits:
  - `identity`
  - `stablePreferences`
  - `workingStyle`
  - `longTermGoals`
  - `avoid`
  - `outputRules`
- The implemented prompt layering is:
  - stable block: `soul -> workspace policy -> system/tool guidance/protocols`
  - dynamic block: `current session context -> retrieved vault memory -> turn-specific directives`
- Workspace policy is now read from explicit repo-local files in this order:
  - `.coworkany/WORKSPACE_POLICY.md`
  - `WORKSPACE_POLICY.md`
  - `CLAUDE.md`
  - `AGENTS.md`
- Anthropic block serialization was adjusted so dynamic context is emitted before tool descriptions, preventing tool metadata from splitting the intended `soul -> workspace -> current session -> memory` ordering.

## Follow-up: Skill-Creator Eval Loop in UI
- The locally synced official `skill-creator` already ships the exact pieces needed for a first-class UI loop:
  - `evals/evals.json`
  - `scripts/aggregate_benchmark.py`
  - `eval-viewer/generate_review.py`
- CoworkAny already had a generic `open_local_path` IPC path, so the missing work was orchestration, not a new file viewer.
- The lowest-risk desktop integration is to keep the official scripts as the source of truth and add thin Tauri wrappers that:
  - create/open `evals/evals.json`
  - execute benchmark aggregation against a chosen workspace
  - generate a static `review.html` viewer from that workspace
- A real smoke test needs more than empty files. `aggregate_benchmark.py` only produces meaningful summaries when each run has a valid `grading.json` using the official field names:
  - `expectations[].text`
  - `expectations[].passed`
  - `expectations[].evidence`
  - `summary`
  - `execution_metrics`
  - `timing`
- Static viewer generation does not require a live server. `generate_review.py --static` is sufficient for desktop integration because CoworkAny can open the generated HTML directly in the OS.
- For a usable static-review workflow, the UI still needs a way to bring downloaded `feedback.json` back into the workspace. Without that import step, the official loop breaks after human review.
- Tauri did not already have dialog support enabled. Adding a real folder/file picker required:
  - `@tauri-apps/plugin-dialog` on the frontend
  - `tauri-plugin-dialog` in Rust
  - `dialog:allow-open` in the main window capability
- The current official viewer supports `--previous-workspace` directly, so the right UI shape is two workspace selectors:
  - current benchmark workspace
  - optional previous workspace for side-by-side iteration context
- Making benchmark/analyzer results actually visible in-app does not require a new analysis format. Reading the existing `benchmark.json` and rendering:
  - `run_summary`
  - top-level `notes`
  - deduped per-run `runs[].notes`
  is enough to surface the key signals without forking the official schema.
- A thin Tauri JSON-reader command is the lowest-risk bridge here. The frontend only needs filesystem access to the generated benchmark file; all interpretation can stay in React.
- The remaining UX gap after static viewer + feedback import is avoidable: the official `generate_review.py` already supports a long-running local server mode that writes feedback directly to `<workspace>/feedback.json`.
- The safest desktop integration is to launch that Python process as a managed child, wait for the HTTP port to become reachable, and expose only `start/stop` controls in the UI. That keeps CoworkAny aligned with the official viewer instead of embedding or rewriting it.
- Preselecting an ephemeral local TCP port in Rust is simpler than parsing Python stdout for the chosen port, and makes readiness checks deterministic.
- Once live viewer support exists, the next practical issue is state drift in the desktop UI rather than process management itself: React state resets when users switch skills or reopen the window, while the managed Python child may still be running.
- The lightweight fix is:
  - persist the selected benchmark/previous workspace paths per skill in local storage
  - add a `get_skill_review_server_status` IPC command that probes the managed child state for a workspace and cleans up stale entries if the process already exited
- There is still no official analyzer script in the synced `skill-creator`; only `agents/analyzer.md` and the `benchmark.json` schema define the expected output. That makes a benchmark-notes editor and save path the right minimal integration point for CoworkAny.
- Writing analyzer observations back into top-level `benchmark.notes` is schema-compatible and immediately benefits both:
  - the in-app benchmark summary
  - the official review viewer, which already reads those notes
- A pragmatic next step is a heuristic draft generator that reads `benchmark.json` and proposes notes for:
  - expectation patterns (always passes, always fails, with-skill-only wins, with-skill-only losses)
  - pass-rate variance across runs for the same eval/configuration
  - large time/token deltas between with-skill and without-skill
- This is not a substitute for a true analyzer agent, but it matches the current product layer better: the UI can seed a useful draft now, and a future sidecar/LLM analyzer can replace the implementation behind the same draft button later.
- Saving `benchmark.notes` without also refreshing `benchmark.md` leaves the official Markdown artifact stale. That inconsistency is user-visible and undermines trust in the review outputs.
- The desktop side already has provider-aware LLM connectivity logic in `validate_llm_settings`. A true model-backed analyzer can be layered on top of that later without rethinking the benchmark UI contract.

## Follow-up: Model-Backed Benchmark Analyzer
- The desktop app already persists an active LLM profile in `llm-config.json`; resolving `activeProfileId` first and falling back to top-level provider settings is the least surprising behavior for users.
- The official `.agent/skills/skill-creator/agents/analyzer.md` already contains a benchmark-analysis section with the right note-generation contract, so CoworkAny can reuse that guidance instead of inventing a separate analyzer prompt.
- Provider output formatting is not reliable enough to require perfect raw JSON. Accepting:
  - a direct JSON array
  - an object with `notes`
  - markdown-fenced JSON
  makes the analyzer materially more robust in practice.
- Passing the full benchmark file to a model is unnecessary and can become noisy. A curated context with:
  - `metadata`
  - `run_summary`
  - top-level `notes`
  - per-run `eval_id/configuration/run_number/result/expectations/notes`
  is sufficient for analysis while keeping prompt size bounded.
- The right UX is still one `Generate draft` action. Exposing a separate "heuristic vs model" choice would add UI complexity without helping the main workflow.
- Fallback cannot be silent. If the model path fails or returns malformed output, the workbench should still return usable heuristic notes while telling the user that fallback happened and why.
- `validate_llm_settings` did not previously support `ollama`, but the analyzer path can. Treating Ollama as OpenAI-compatible (`/v1/chat/completions`) is enough for the benchmark-notes flow.

## Follow-up: Benchmark Notes Provenance & Rollback
- Saving `benchmark.notes` directly is operationally weak for commercial usage because it destroys attribution and leaves no local rollback path when a generated or edited note set turns out to be worse.
- A sibling `benchmark.notes-history.jsonl` artifact is a better fit than expanding `benchmark.json` with full history:
  - it preserves compatibility with the official `skill-creator` viewer and benchmark scripts
  - it remains easy to inspect manually
  - it avoids unbounded benchmark artifact growth
- The minimum useful snapshot shape is:
  - `savedAt`
  - `notes`
  - `previousNotes`
  - `source`
  - `provider`
  - `model`
  - `warning`
  - `generatedAt`
- For human workflows, "rollback" should be non-destructive first. Loading a previous snapshot back into the editor is safer than immediately overwriting `benchmark.json` on click.
- Persisting `previousNotes` matters even when history entries are read newest-first; without it, users can see what was saved but not what changed.

## Follow-up: Analyzer Network Hardening & Audit Logs
- The model-backed analyzer was still bypassing the app's shared proxy settings, which is a real enterprise-readiness gap. If the desktop app runs behind a corporate proxy, analyzer requests need to follow the same routing rules as the rest of the provider traffic.
- Proxy bypass needs hostname-aware matching, not just a binary proxy-on/proxy-off switch. Supporting exact host matches and suffix-domain matches from the existing bypass string is enough for the analyzer path.
- Model-backed analysis also lacked a durable invocation artifact. Without that, users can see the resulting notes but cannot audit:
  - which provider/model was used
  - what prompt was sent
  - whether fallback happened
  - how many attempts were needed
  - what raw response came back
- A per-invocation JSON artifact under the benchmark workspace is the right balance:
  - local and inspectable
  - easy to share in debugging
  - separate from official benchmark artifacts
- Retry policy should be narrow. Retrying on send failures, `408`, `429`, and `5xx` is worthwhile; retrying malformed content parsing is usually not.

## Follow-up: Analyzer Connectivity Probe
- The workbench still lacked a proactive signal for model readiness. Users could only discover misconfiguration or network failure after pressing `Generate draft`, which is too late for a polished eval workflow.
- A generic provider-validation result from settings is not enough here because the workbench cares about the exact analyzer path, including:
  - active profile resolution
  - analyzer proxy routing
  - analyzer retry behavior
- The probe should stay cheap. A one-token `ping` request is enough to validate:
  - credentials
  - endpoint reachability
  - proxy behavior
  without pretending to validate benchmark-analysis quality.
- The right UI shape is small and local: show readiness, provider/model, attempts, and proxy routing directly in the workbench rather than sending users back to global settings.

## Follow-up: Workspace Analyzer Health State
- Analyzer readiness was still too ephemeral. Even after adding a probe, users lost the signal when switching workspaces or reopening the app because the result only lived in React state.
- A workspace-local health artifact is the right level of persistence:
  - tied to a benchmark iteration
  - survives window/app reloads
  - inspectable without opening the global app logs
- The health artifact needs to capture both:
  - probe outcomes
  - generation outcomes
  because the last meaningful analyzer state may come from either path.
- Persisted health should include:
  - `checkedAt`
  - `configured`
  - `reachable`
  - `provider/model/endpoint`
  - `resultSource`
  - `attemptCount`
  - `proxy` context
  - `warning/error`
  - `logPath`
- Once the status is persisted, the workbench can restore last-known analyzer health on workspace selection and feel materially more operational.

## Follow-up: Analyzer Health History & Trends
- A single latest-status file still hides flakiness. If the analyzer alternates between success and failure, the most recent status alone can mislead users.
- Appending each status write to a history log is enough to recover basic operational trends without adding a full telemetry backend.
- The useful trend signal in-workbench is small:
  - how many recent events succeeded
  - how many failed
  - what the last few events were
- This gives users a quick answer to "is this analyzer path stable for this workspace?" without sending them into raw logs.

## Follow-up: Analyzer Smoke & Reliability Rating
- A connectivity probe still stops short of the actual analyzer contract. It can say the model is reachable while the real benchmark-analysis path still fails on output formatting or parsing.
- A synthetic smoke fixture is the right middle ground:
  - cheap to run
  - exercises the real analyzer prompt/response parser
  - does not depend on a finished benchmark workspace
- Reliability rating should stay simple and explainable. A small recent-window rule like:
  - `healthy`
  - `degraded`
  - `unhealthy`
  is enough for operational awareness without pretending to be full SRE telemetry.

## Follow-up: Analyzer Workbench Regression Coverage
- The analyzer workbench had grown enough surface area that relying only on compile checks was no longer sufficient.
- The cheapest useful coverage split is:
  - pure function tests for reliability derivation
  - source-level UI contract tests for required buttons, labels, and IPC command usage
- This kind of lightweight regression suite is valuable here because the workbench is orchestration-heavy: many failures would be "button disappeared", "wrong IPC command", or "heuristic logic changed" rather than type errors.

## Follow-up: Analyzer Readiness Gate
- Status, history, smoke, and reliability signals are useful, but without a verdict they still force the user to decide whether the analyzer is trustworthy.
- The most important hard rule is smoke success. A workspace should not be considered ready unless at least one smoke run has succeeded.
- A recent-history gate is enough here. It should consider:
  - whether smoke has ever succeeded
  - whether the latest event is healthy
  - whether recent failures indicate instability
- Persisting the readiness assessment as a separate artifact keeps the result auditable and makes it possible to review the gate decision independently of the raw status/history logs.

## Follow-up: Analyzer Live Smoke Acceptance Gate
- The workbench now has smoke/probe/history/readiness surfaces, but before this pass there was still no automated path that exercised the real provider chain end-to-end through the desktop runtime.
- A commercial release gate needs more than unit tests here. The minimum useful acceptance path is:
  - inject a known-good active LLM profile
  - run analyzer smoke
  - run model-backed note generation
  - confirm readiness becomes `ready`
  - verify status/history/log/readiness artifacts exist on disk
- This should stay explicitly opt-in. A separate env-gated Playwright entrypoint is the safest shape because it prevents accidental API spend in default CI while still making provider validation repeatable.
- The same opt-in contract should exist in CI as a manual workflow, otherwise the live smoke remains a purely local ritual and cannot become part of a release checklist.
- Readiness also needed stricter policy semantics. Once real-provider validation exists, staleness and recent-failure budget become release criteria rather than passive telemetry.
- A live smoke without durable artifacts is still weak operationally. The useful minimum is:
  - a safe summary JSON
  - the workspace-local analyzer artifacts already produced by the runtime
  - at least one screenshot / Playwright report for the run
  so failures can be audited after the fact without rerunning against a paid provider.
- The local CLI path and the manual workflow should not each hand-roll different provider-validation logic. A single preflight script is the right shape because it keeps provider support, missing-secret messages, and future provider additions in one place.
- For this product, the correct default trust boundary is local desktop settings, not GitHub-hosted secrets. The live smoke should assume:
  - local/manual runs use the active provider/model already configured by the user
  - env overrides are optional, mainly for explicit troubleshooting or self-hosted automation
  - GitHub-hosted runners are not the default home for paid model credentials

## Follow-up: Chat Execution Reliability & Readability
- The latest sidecar log [2026-03-15] did not end with a terminal task event for the active task. It showed repeated `run_command` tool calls, periodic compaction, and transient socket-close retries, but no final `TASK_FINISHED` or `TASK_FAILED`. That means the user saw activity without a trustworthy result boundary.
- `send_task_message` was appending the same user message into the conversation twice. This is a direct cause of model repetition because each follow-up turn was effectively duplicated in the LLM context.
- `start_task` and `send_task_message` were inconsistent:
  - `start_task` always emitted a generic `Task completed` summary after the loop
  - `send_task_message` only emitted `TASK_STATUS=finished`, with no `TASK_FINISHED` summary at all
  - neither path used the actual final assistant output as the task result
- Desktop task-event reducers were mirroring tool/effect/patch/task-failure events into `session.messages` even though the timeline is already built from `session.events`. This created a second, redundant status channel and inflated exported conversation noise.
- The tool event payloads in `sidecar/src/main.ts` were still emitting legacy field shapes (`TOOL_CALL`, `toolUseId`, `name`, `isError`) instead of the UI-facing `TOOL_CALLED` / `toolId` / `toolName` / `success` shape. Keeping both legacy and normalized fields is the safest compatibility path.
- Consecutive identical tool calls should not always occupy independent cards in the timeline. In the latest logs, repeated `run_command` calls were the dominant visual noise; collapsing adjacent identical calls into a single `xN` card materially improves readability without hiding the fact that repetition happened.
- The safest commercially-acceptable recovery for transient model transport failure is not to fake stream continuation. It is to:
  - mark the task failed with a recoverable model transport error
  - watch for connectivity recovery
  - send a guarded continuation message into the same task context
  This preserves context and avoids inventing a transport-level resume protocol the providers do not support.

## Follow-up: Recoverable Task Snapshot Resume
- The current reconnect continuation path still depended on in-memory task state. If the sidecar died or was restarted, the desktop could reconnect but had no durable conversation/config snapshot to resume from.
- Commercially acceptable recovery needs a durable record of:
  - task config
  - conversation history
  - workspace path
  - runtime status
  - latest error/summary
  Without that, "resume on reconnect" is only reliable for transient socket drops inside the same process lifetime.
- The right minimum implementation is workspace-local snapshotting. Keeping snapshots under `.coworkany/runtime/tasks` makes them inspectable, keeps project context attached, and avoids inventing a second global persistence model.
- A terminal watchdog must be progress-aware. Resetting it only at task start is too coarse for long-running tasks; any nonterminal running event should refresh the stall timer so active tasks are not falsely marked dead.
- Recovery cannot rely only on explicit `recoverable_interrupted` failures. A hard sidecar crash can leave the last persisted status as `running`, so recent `running` snapshots also need to be considered recoverable.
- `sidecar-reconnected` is not enough as a trigger. Cold-launching the desktop after a crash should still attempt recoverable-task resume, otherwise the most common restart path silently drops interrupted work.
- The packaged restart E2E proved the `resume_recoverable_tasks` payload itself was fine JSON. The sidecar rejected it because desktop recovery hints included `scheduled_*` task IDs, and the command schema still required strict UUIDs.
- `commandResult.error.format()` from zod renders array validation failures as numeric object keys. The earlier `payload.taskIds: { "14": ... }` log looked like an array/object transport bug, but the real fault was per-item UUID validation failure.
- After filtering `scheduled_*`, packaged recovery still resumed too many stale sessions. The deeper issue was recovery scope, not parsing:
  - desktop reconnect logic was gathering every fresh recoverable session in history
  - sidecar considered `recoverable_interrupted` snapshots resumable forever
  Together, those two choices caused unrelated historical tasks to restart alongside the one just interrupted.
- Recovery should be scenario-aware:
  - on reconnect, only tasks that were actively running in the current live session should auto-resume
  - on cold startup, only the fresh active/foreground recoverable task should be resumed by default
- `recoverable_interrupted` snapshots need freshness and `autoResumePending` gating. Otherwise old crash artifacts remain resumable indefinitely and pollute future recovery cycles.
- The packaged crash/restart E2E is now materially more valuable than source-level checks because it proved all of the following in one run:
  - runtime snapshots are written before crash
  - the watchdog restarts the packaged sidecar
  - desktop reconnect emits resume hints
  - sidecar restores the interrupted task and emits `TASK_RESUMED`
  - the recovered task reaches `TASK_FINISHED` with a real assistant result
- Recovery correctness is not enough for commercial supportability. Users still need a durable explanation of what happened when a task stalls, resumes, or finishes after recovery; otherwise every incident still devolves into raw log archaeology.
- The right minimum artifact is workspace-local `task-diagnostics.jsonl`, written next to the task runtime snapshots. This preserves project context, survives restarts, and gives both support and users a stable file to inspect.
- The diagnostic trail should capture at least:
  - recoverable failures
  - task resumes
  - task finishes
  so a missing-result report can be reconstructed without needing the full sidecar log file.
- This diagnostic view does not need a new sidecar event type. A simpler, lower-risk shape is:
  - sidecar appends JSONL entries
  - desktop reads them on demand through Tauri IPC
  - task panel shows the latest entries and offers an "open log" action
  That keeps the event protocol stable while still making runtime evidence visible in-product.

## Follow-up: Scheduled Task Card Commercial Hardening
- The task board was already receiving `latestRunStatus/latestRunSummary/latestRunAt` for scheduled tasks, but commercial-readiness still had two gaps:
  - execution-copy labels on the card were hardcoded instead of localized
  - users only saw a single latest result with no short execution history
- The lowest-risk data-model extension is to store bounded `recentRuns` directly on each trigger and cap the list to a small number. That keeps the task board query cheap and avoids introducing a separate run-log store before it is needed.
- `get_tasks` can expose `recentRuns` without breaking older trigger files by synthesizing a one-entry history from legacy `lastRun*` fields when history is missing.
- The packaged desktop E2E failure after implementation was not a product defect. The release app rendered two scheduled-task cards, so the old global `#scheduled` locator violated Playwright strict mode. Scoping the assertion to each card fixed the test while preserving coverage.
- A locale-sensitive UI cannot rely on English-only E2E text assertions for status badges. Structural assertions on card state classes are more stable for packaged desktop verification.

## Follow-up: Task Terminal Watchdog Acceptance
- A packaged-only timeout override is needed for watchdog acceptance testing. Reading `process.env` directly inside the compiled Bun sidecar was not reliable enough for test-time overrides, so the safer shape is:
  - desktop reads `COWORKANY_TASK_STALL_TIMEOUT_MS`
  - desktop passes it to the sidecar as an explicit startup arg
  - sidecar reads the CLI arg at runtime and falls back to env/default
- Release E2E needed stronger isolation from prior crash artifacts. Even after the recovery fixes, packaged startup was still seeing old recoverable snapshots from previous runs, so the acceptance suite now clears the release-side workspace root before boot.
- The initial stalled-task E2E timeout was a test harness bug, not a product bug. The mock SSE server kept its client socket open forever, which caused `server.close()` to hang during teardown; tracking active sockets and destroying them on close fixed the leak.
- The packaged watchdog acceptance now proves a commercially important boundary:
  - a task can emit partial assistant output
  - fail to produce a terminal result
  - be failed by the sidecar watchdog within the configured timeout
  - persist `TASK_TERMINAL_TIMEOUT` into workspace diagnostics
  - surface that failure in the desktop task panel
- The stalled-task path also exposed a secondary recoverable `MODEL_STREAM_ERROR` after the mock server is torn down. That does not invalidate the watchdog path, but it means diagnostics can contain multiple recoverable failures for one task, and UI/tests should assert on presence of the watchdog failure rather than assume a single terminal artifact.
- The strongest place to suppress duplicate terminal task failures is not the individual catch blocks but the shared sidecar `emit()` boundary. Even after patching the main `start_task` / `send_task_message` paths, packaged E2E still found duplicate `TASK_FAILED` events because any missed call site could emit a second failure. Once suppression moved into `emit()`, packaged logs showed the watchdog failure once and the later stream-close error only as an internal suppression warning.
- Duplicate `TASK_FAILED` events were also causing duplicate post-learning runs. A lightweight per-task failed-session guard in `PostExecutionLearningManager` prevents the same stalled task from re-saving identical failure knowledge.
- The latest packaged logs no longer need to launch the Python RAG process to discover missing dependencies. A preflight that maps `rag-service/requirements.txt` package names to importable module names catches missing `fastapi`/friends before spawn.
- For Python dependency probing, requirement names are not always import names. The minimum package->module mappings needed here are:
  - `sentence-transformers` -> `sentence_transformers`
  - `python-multipart` -> `multipart`
  - `pyyaml` -> `yaml`
  Everything else can safely fall back to `-` -> `_`.
- A service that fails dependency preflight should report `failed` with `last_error`, not merely `stopped`. Otherwise the frontend cannot distinguish "service not started yet" from "service cannot start in this environment".
- The packaged recovery/watchdog Playwright suite had a hidden coupling bug: it globally forced `COWORKANY_TASK_STALL_TIMEOUT_MS=5000`, which made the recovery test race its own watchdog. Raising the shared override to 15s keeps the watchdog acceptance fast while still leaving enough time for the recovery test to capture a `running` snapshot before the intentional crash.
- The existing `desktop.log.2026-03-16` file still contains older `fastapi` tracebacks from runs before the preflight fix. Verification after the patch therefore has to focus on new log segments and packaged reruns, not on the historical log file as a whole.
