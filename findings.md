# Findings

## 2026-03-27 Canonical Task Stream Phase 1

- The lowest-risk insertion point for protocol unification is `sidecar/src/main.ts` `emit(...)`, because all runtime/UI task events already pass through that function before reaching stdout and singleton clients.
- The desktop-side lowest-risk insertion point is `desktop/src-tauri/src/sidecar.rs` `classify_sidecar_message(...)` plus `stdout_reader_loop(...)`; that lets Tauri forward a second event channel without disturbing the current `task-event` path.
- Current desktop UI is intentionally event-projected, not message-native:
  - `desktop/src/stores/taskEvents/index.ts` persists `TaskSession.events`
  - `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts` collapses those events into `assistant_turn` and `task_card`
  This means phase 1 should unify transport/message protocol first and defer UI substitution.
- The repo already tolerates cross-package protocol imports from `desktop` into `sidecar/src/protocol`, so adding canonical stream schemas under `sidecar/src/protocol/` keeps type sharing consistent with the current architecture.
- A shadow canonical store in desktop is sufficient for phase 1. It provides end-to-end protocol validation and future UI integration surface without creating double-render or duplicate session-event risk today.

## 2026-03-20

- Current `NormalizedWorkRequest` is too thin for agent-led orchestration. It has `tasks`, `clarification`, and `presentation`, but no explicit `deliverables`, `checkpoints`, `userActionsRequired`, or `resumeStrategy`.
- Current clarification logic in `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestAnalyzer.ts` only blocks on very short or ambiguous immediate-task prompts. It does not model “blocking but defaultable” vs “must ask user”.
- Current execution plan is generic: `analysis -> clarification -> execution -> reduction -> presentation`. It does not expose planner-owned collaboration checkpoints.
- `executeFreshTask` already has a useful gate: if `clarification.required` is true, execution stops and the user is asked. This is the right insertion point for stronger planner-owned collaboration.
- Existing focused tests live in:
  - `/Users/beihuang/Documents/github/coworkany/sidecar/tests/work-request-control-plane.test.ts`
  - `/Users/beihuang/Documents/github/coworkany/sidecar/tests/work-request-runtime.test.ts`
- Product role target is clear: Coworkany should infer plan structure and request user help only for unresolved blockers or required manual actions.
- Added contract fields to planner output:
  - `deliverables`
  - `checkpoints`
  - `userActionsRequired`
  - `missingInfo`
  - `defaultingPolicy`
  - `resumeStrategy`
- Updated execution prompt generation so Coworkany is explicitly framed as the primary task owner, with planned deliverables/checkpoints/user actions embedded in the frozen execution prompt.
- Runtime now passes planned deliverables into artifact contract generation, so planner-selected output files begin to constrain execution instead of remaining UI-only metadata.
- Planner contract was still invisible at runtime/UI boundaries after the first slice. The missing pieces were explicit protocol events and session state for:
  - frozen plan readiness
  - currently active checkpoint
  - currently required user action
- The cleanest insertion points were:
  - immediately after `prepareWorkRequestContext(...)` in fresh/follow-up/resume flows
  - existing `TASK_SUSPENDED` runtime branch for true blocking manual actions
- Desktop already had enough structure to absorb this without a new screen. `TaskSession`, the task reducer, timeline mapping, and `ChatInterface` were sufficient for a first plan card plus current-action banner.
- The remaining gap after the first planner-event slice was that `TASK_CHECKPOINT_REACHED` and `TASK_USER_ACTION_REQUIRED` were independent from `PLAN_UPDATED`. The UI could know “a checkpoint happened” but not whether execution had actually moved to `blocked`, `reduction`, or `presentation`.
- The cleanest fix was not a second state machine. Reusing the existing `ExecutionPlan` as the single source of truth worked once sidecar started:
  - mutating in-memory plan steps during execution
  - emitting `PLAN_UPDATED` at each major transition
  - updating runtime suspension/resume through an active prepared-work-request registry keyed by `taskId`
- `PLAN_UPDATED` had an old status vocabulary (`complete`) that did not match execution-plan reality (`completed`, `blocked`). Extending the shared types to accept `blocked` and `completed` was necessary to make the state model coherent end-to-end.

## 2026-03-20 Marketplace Install Fix

- `从 skillhub 中安装 skill-vetter` was already frozen as an executable task; the bad follow-up came from execution-time model behavior, not control-plane clarification.
- Sidecar self-management tools only supported local-folder skill installs before this change.
- Desktop marketplace code already had separate Skillhub search/install and GitHub install paths; chat execution lacked a bridge to them.
- Current product marketplace skill sources are Skillhub keyword/slug installs and GitHub repository installs.
- The implemented fix adds marketplace-aware self-management tools, explicit self-management tagging in work-request analysis, and a deterministic marketplace install fast path in execution runtime.
- Verification evidence:
  - `bun test tests/app-management-tools.test.ts tests/execution-runtime.test.ts tests/work-request-control-plane.test.ts` → 37 pass, 0 fail
  - `bun run typecheck` → exit code 0

## 2026-03-20 ClawHub Marketplace Follow-Up

- `sidecar/src/claude_skills/openclawCompat.ts` already included reusable ClawHub primitives: `searchClawHub`, `getClawHubSkill`, and `installFromClawHub`.
- The missing piece was integration: the marketplace tool layer, self-management prompts/triggers, and execution fast path did not treat `clawhub` as a first-class marketplace source.
- The implemented fix extends the marketplace toolchain and runtime intent parsing to `clawhub`, reusing the existing OpenClaw compatibility installer.
- A separate TypeScript mismatch in `sidecar/src/handlers/runtime.ts` surfaced during verification because `buildArtifactContract` was typed too loosely as `unknown[]`; tightening it to `DeliverableContract[]` restored type safety and passing typecheck.
- Verification evidence:
  - `bun test tests/app-management-tools.test.ts tests/execution-runtime.test.ts tests/work-request-control-plane.test.ts` → 42 pass, 0 fail
  - `bun run typecheck` → exit code 0

## 2026-03-21 Deep Research Control Plane Hardening

- The first reopen/refreeze slice still had a safety bug: after refreeze, execution would continue even if the newly frozen contract introduced blocking clarification or manual collaboration.
- The cleanest fix was to keep decision-making in `main.ts`: execution runtime asks for refreeze, then `main` emits the refreshed research/plan events and decides whether the task is blocked or can auto-resume.
- `currentExecutingTaskId` was previously only cleared on `TASK_FINISHED` and `TASK_FAILED`. That left stale “currently executing” state behind for clarification, contract-reopen, and other idle transitions, which could confuse browser/runtime coordination.
- Desktop session state did not yet consume `TASK_RESEARCH_UPDATED` or `TASK_CONTRACT_REOPENED`, so users could not reliably see why Coworkany had gone back into research or what evidence had changed.
- Desktop task-event persistence treated research/contract-reopen/user-action events as normal debounce writes. For beta quality, these should persist quickly because they encode collaboration-critical state.
- Deterministic local workflows were another release-critical reopen gap. Their filesystem/tool failures bypassed the model execution loop entirely, so `permission_block` and `missing_resource` never had a chance to reopen the contract.
- Preserving raw tool error text for `list_dir` failures was necessary; otherwise everything collapsed into the same generic “Failed to inspect the target folder” message and trigger classification became unreliable.
- Generic agent-loop exceptions were still a second reopen gap after the deterministic fix. If `runAgentLoop(...)` threw `permission denied` or `no such file`, execution still skipped straight to `TASK_FAILED`.
- The safest fix was not a second catch-specific branch with custom behavior. Reusing one execution-failure classifier and one reopen/refreeze helper keeps artifact failures, deterministic workflows, and generic agent-loop failures aligned on:
  - trigger selection
  - replan-policy gating
  - refreeze event emission
  - blocked-vs-retry decision making
- Broad GUI smoke surfaced another real blocker in the planner/artifact boundary: explicit save targets like `/.../.coworkany/test-workspace/gui_test.js` were being truncated at the first dotted directory segment, so the frozen contract required `/.../.coworkany` instead of the actual `.js` file.
- The root cause was the same in both planner and artifact parsing: explicit-path regexes used shortest-match semantics (`+?`) and stopped at the first extension-looking substring. Greedy matching to the final extension fixed the path freeze and the artifact requirement simultaneously.
- This bug was invisible to earlier focused tests because they used simple paths like `/tmp/gui-test.js` without dotted parent directories. Keeping one regression with a dotted parent directory is necessary to prevent reintroducing the bug.
- `new_scope_signal` and `contradictory_evidence` were still inert after the earlier runtime work. The execution runtime knew those triggers existed, but the follow-up command path never emitted them, so user corrections looked like silent replans instead of governed contract reopens.
- The real hidden bug in that path was artifact reuse: `send_task_message` always preferred the previous `artifactContract` from the session, even if the newly prepared frozen request changed deliverables, output path, or target folder. That made reopened contracts visually update while validation silently stayed on the old scope.
- Comparing the previous active frozen request with the newly prepared frozen request is sufficient for a first governed version. The highest-signal differences were:
  - deliverables / output path changes
  - resolved target changes
  - workflow changes
  - mode changes
  - explicit objective changes in non-trivial follow-ups
- Correction-language cues such as `改成`, `更正`, `actually`, and `instead` are a practical first discriminator for `contradictory_evidence`; the remaining material contract shifts can route to `new_scope_signal`.
- Desktop state already had most of the right primitives, but without a regression around the full reopen sequence it was still easy to regress into “old plan + new blocker” mixed state. The important invariant is overwrite semantics:
  - `TASK_CONTRACT_REOPENED` clears the active checkpoint/user action
  - the next `TASK_PLAN_READY` replaces planned deliverables/checkpoints/actions
  - the next blocking action becomes the sole current blocker
- Hydration also matters for beta quality: a reopened idle session must preserve `contractReopenReason`, `contractReopenCount`, replanned deliverables, and the current blocking action across app restart.
- State-level regressions were not enough for the user-visible path. The timeline is the compact narrative users actually read during reopen, so it needed a direct assertion that the sequence renders in the expected order:
  - contract reopened
  - research updated
  - replanned contract ready
  - user action required
- The cleanest way to test that without introducing brittle DOM assertions was to export a pure `buildTimelineItems(...)` helper from the hook module and test the transformed system-event content directly.
- Follow-up reopen comparison still had one hidden dependency on liveness: it only worked while `activePreparedWorkRequest` existed. Once execution had finished or returned idle and that registry entry was cleared, the same correction message no longer had a previous contract to compare against.
- The smallest safe fix is to persist a comparison-oriented snapshot, not the whole frozen request. The reopen path only needs:
  - mode
  - source text / primary objective
  - preferred workflows
  - resolved targets
  - deliverable type/path/format
- `TaskSessionConfig` is already persisted with runtime records, so it is the right place to store the last frozen-contract snapshot without inventing a new persistence channel.
- The snapshot needs to be refreshed at every contract-freeze boundary, not just fresh-task start:
  - fresh start
  - follow-up replan
  - interrupted-task resume
  - execution-time contract refreeze
- A GUI-level smoke for “finish task, then correct output path” is not stable yet because the pre-freeze research phase can block for a long time on unauthenticated SearXNG fallback. That is a research-adapter latency problem, not a reopen-state correctness problem.
- The right fix for that latency problem is not to remove web research, but to give external resolvers explicit budgets. Contract freeze can accept “web research timed out” as feasibility evidence plus a known risk and continue.
- `runPreFreezeResearchLoop(...)` was sequential and synchronous across external resolvers, so even one hung web lookup delayed the entire planner. Adding timeout wrappers around web and connected-app resolvers is enough to bound that risk without redesigning the loop yet.
- There was a second persistence gap behind the follow-up reopen fix: even with `lastFrozenWorkRequestSnapshot` in `TaskSessionConfig`, finished tasks still lost that config after sidecar restart because runtime persistence deleted finished/failed sessions entirely.
- `TASK_STATUS: idle` also mattered more than it looked. Without syncing that event into the runtime record, a task that was merely waiting for user clarification could still be persisted as `running` and be misclassified as interrupted on restart.
- The smallest durable fix is to treat `idle` / `finished` / `failed` as first-class persisted runtime statuses:
  - `restorePersistedTasks()` hydrates their session/config/artifact state
  - restart recovery does not emit interruption/failure for them
  - follow-up messages can later recreate active runtime state via `ensureTaskRuntimePersistence(...)`
- Once finished/failed sessions started persisting, retention became part of correctness. Without pruning, the runtime store would accumulate terminal task context indefinitely even though only the most recent archived sessions are valuable for follow-up continuity.
- The safe pruning boundary is terminal archived work only:
  - prune oldest `finished`
  - prune oldest `failed`
  - keep `running` / `suspended` / `interrupted` / `idle`
  so active recovery paths and blocked collaboration state are never dropped for space reasons.
- A real cross-process smoke is now in place for `finished task -> sidecar restart bootstrap -> follow-up correction -> contract reopen -> replan`, using a spawned sidecar process plus persisted runtime seed data. That closes a more realistic gap than another pure unit test would.
- Desktop still had one mixed-blocker bug after reopen: if `TASK_USER_ACTION_REQUIRED` arrived before `TASK_CLARIFICATION_REQUIRED`, the reducer preserved the old `currentUserAction` and `currentCheckpoint`, so the plan card could show stale manual-action UI alongside new clarification questions.
- `TASK_CLARIFICATION_REQUIRED` should win as the current blocker in desktop session state. Replanned deliverables and research context should remain, but stale action/checkpoint state should be cleared so the user sees one active ask at a time.
- The cross-process restart smoke surfaced a deeper control-plane issue: correction-style follow-ups such as `Actually, save it to ... instead` were still being analyzed as standalone prompts after restart, so the original task objective was lost even though the frozen snapshot had been restored.
- The first fix for that was not enough on its own because clarification heuristics were too broad. Matching `it` or `that` anywhere in a sentence misclassified normal instructions like `save it to /tmp/hello.ts` as ambiguous scope.
- Explicit-path extraction had a parallel gap: it recognized `save to` but not the common phrasing `save it to`, which let corrected file targets fall back to default markdown artifacts instead of freezing the requested path.
- The robust combination is:
  - merge corrective follow-ups with the prior frozen request snapshot before analysis
  - restrict ambiguity detection to genuinely reference-only follow-ups
  - recognize `save it to` / `write it to` in explicit-path extraction
  Together, these changes make “path correction after restart” behave like a governed contract update instead of a vague new request.

## 2026-03-21 Control-Plane Eval Harness

- The repo already has strong control-plane building blocks, but they are split across focused tests and runtime code rather than one replayable eval surface:
  - planner/analyzer in `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestAnalyzer.ts`
  - research loop in `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/researchLoop.ts`
  - runtime prep in `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestRuntime.ts`
  - artifact validation in `/Users/beihuang/Documents/github/coworkany/sidecar/src/agent/artifactContract.ts`
- That means the smallest useful harness is not a new planner abstraction. It is a runner that invokes the existing production path and compares stage outputs against JSONL expectations.
- The natural stage breakdown already exists in code and aligns with the roadmap:
  - analyze
  - research/freeze
  - execution plan
  - artifact contract evaluation
- `sidecar/tests/work-request-control-plane.test.ts` already contains high-signal examples for:
  - clarification minimization
  - contract path correctness
  - strategy selection presence
  - local workflow/tool exposure inference
  Those scenarios can seed the first gold dataset instead of inventing synthetic cases from scratch.
- The first P0 harness does not need an LLM judge. Existing planner outputs are structured enough to score deterministically:
  - `clarification.required`
  - missing fields
  - deliverable types/paths/formats
  - checkpoint kinds
  - research sources/status
  - plan step kinds/statuses
  - artifact evaluation pass/fail and failed requirement kinds
- `sidecar/package.json` currently has no eval runner script, so adding a first-class command is part of making the harness usable outside the test suite.
- The current roadmap mentions production log replay and dashboards, but those should not block the first slice. The critical gap is the absence of a stable case schema and stage-metric aggregation layer.
- The landed harness in `/Users/beihuang/Documents/github/coworkany/sidecar/src/evals/controlPlaneEvalRunner.ts` now replays real control-plane stages end-to-end:
  - `analyzeWorkRequest`
  - `runPreFreezeResearchLoop`
  - `freezeWorkRequest`
  - `buildExecutionPlan`
  - `buildArtifactContract` / `evaluateArtifactContract`
- The case format is intentionally simple and repo-native:
  - JSONL rows in `/Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/gold.jsonl`
  - optional seeded workspace files/directories
  - optional stubbed `webSearch` / `connectedAppStatus` research responses
  - stage-specific expectations instead of one monolithic pass/fail
- The first seed suite covers six high-signal scenarios:
  - chat baseline
  - complex planning/report contract freeze
  - explicit-path artifact success
  - explicit-path artifact failure detection
  - minimal-blocking clarification for ambiguous follow-up
  - research-heavy request with workspace/web/template/connected-app evidence
- The current runner already emits the core P0 metrics needed to unblock later doctor/HITL/policy work:
  - clarification rate
  - unnecessary clarification rate
  - freeze expectation pass rate
  - artifact expectation pass rate
  - artifact satisfaction rate
- Running `bun run eval:control-plane` against the seed suite currently reports:
  - 6/6 cases passed against expectations
  - clarification rate: 16.7%
  - unnecessary clarification rate: 0.0%
  - artifact satisfaction rate: 50.0%
- The next integration step landed cleanly inside the same runner instead of branching the design:
  - added a `runtimeReplay` stage to the control-plane eval schema
  - runtime replay writes persisted runtime records into a temp `task-runtime.json`
  - it then launches a real sidecar process, sends `bootstrap_runtime_context`, sends a real follow-up command, and validates emitted `TaskEventSchema` events
- This is materially better than a fake event fixture because it tests the actual reopen path across:
  - persisted runtime state restoration
  - follow-up request analysis
  - contract reopen detection
  - re-research and plan re-emission
- The first integrated runtime replay case is the highest-signal reopen scenario already proven important elsewhere in the repo:
  - finished task persisted
  - follow-up output-path correction
  - `TASK_CONTRACT_REOPENED`
  - `TASK_RESEARCH_UPDATED`
  - `TASK_PLAN_READY`
  - no `TASK_CLARIFICATION_REQUIRED`
- With that case added, the seed suite now covers both static contract quality and dynamic governed replay:
  - 7/7 cases passed
  - runtime replay pass rate: 100.0%
- The next missing integration also landed inside the same system rather than beside it:
  - `runtimeReplay` can now read saved `TaskEvent` JSONL logs directly
  - those log-replay cases use the same expectation model as live sidecar replay
  - `release-readiness` now runs `eval:control-plane`, persists the JSON summary, and surfaces key control-plane metrics in the readiness report
- That matters because it closes the architecture loop:
  - one runner for static planner checks
  - one runner for live reopen replay
  - one runner for recorded-production replay

## 2026-03-21 Session / Memory / Tenant Isolation

- Current runtime hard isolation stops at filesystem/network/MCP connector scope. Task continuity and memory surfaces still lack a first-class contract analogous to `runtimeIsolationPolicy`.
- The highest-signal runtime gaps are:
  - follow-up / resume can still mutate `workspacePath` through `payload.config`
  - vault/RAG memory is global by default and not filtered by task/workspace/user scope
  - quick note / vault save flows do not stamp tenant or scope metadata
- `TaskSessionStore` is already the right persistence seam for this work. It stores `workspacePath`, frozen snapshot context, and `runtimeIsolationPolicy`, so additive session/memory/tenant policy fields can travel with existing task runtime persistence.
- The cleanest enforcement shape mirrors MCP session policy:
  - analyzer emits formal isolation contracts
  - `main.ts` resolves and registers task-scoped runtime policy
  - follow-up/resume/refreeze paths refresh that policy
  - tool/memory helpers consult the current task policy by `taskId`
- Vault/RAG memory needs metadata-aware filtering rather than only category filtering. The Python RAG service currently supports `filter_category` only, so sidecar alone cannot prevent cross-scope recall.
- Workspace-local `remember/recall` storage already has a natural workspace boundary via `.coworkany/memory.json`; the bigger commercial risk is the global vault/RAG path and task-session reuse across workspaces.
  - one release report consuming the same summary artifact
- The seed suite now includes both dynamic replay modes:
  - `runtime-followup-reopen` for live sidecar replay
  - `runtime-followup-reopen-log` for saved event-log replay
- After these additions, the suite reports:
  - 8/8 cases passed
  - runtime replay pass rate: 100.0%
- The remaining practical gap was ingestion ergonomics: without an importer, turning real canary or beta event logs into `production_replay` cases would still be manual and error-prone.
- The landed importer in `/Users/beihuang/Documents/github/coworkany/sidecar/src/evals/controlPlaneEventLogImporter.ts` closes that gap by:
  - validating `TaskEvent` JSONL with `TaskEventSchema`
  - inferring runtime replay expectations from observed events
  - templating absolute paths into `{{workspace}}` and `{{sidecarRoot}}`
  - producing a case object compatible with the existing eval runner
- The CLI wrapper in `/Users/beihuang/Documents/github/coworkany/sidecar/scripts/import-control-plane-event-log.ts` means the workflow is now:
  - capture a real event log
  - run one import command
  - append the generated line into the dataset
  rather than hand-authoring replay JSONL.
- The importer is now operationally useful rather than just generative:
  - it can `upsert` directly into a dataset file by `case id`
  - repeated imports update an existing replay case instead of duplicating lines
- `release-readiness` also moved from observability-only to actual control-plane gating:
  - control-plane eval metrics are now checked against explicit default thresholds
  - if the eval command passes but the metrics violate thresholds, the `control-plane-eval` readiness stage is still marked failed
  - this avoids the common trap where a report shows bad metrics but rollout logic ignores them
- After the first isolation pass, the remaining bypass surface was not in MCP/tool contracts but inside agent internals:
  - `ReActController` was still reading memory via global `getMemoryContext(...)`
  - `AutonomousAgentController` was still reading memory via global `getMemoryContext(...)` and saving extracted learnings via global vault writes
  - `KnowledgeUpdater` tool handlers were still saving and searching knowledge through non-task-scoped memory paths
- Those paths could bypass the intended task/session/tenant boundary even if MCP gateway and tool handlers were already locked down, because the agent could still consult or persist cross-task memory from inside its own control loop.
- The autonomous task implementation also had a separate scoping bug:
  - `start_autonomous_task` was keyed by a runtime session task id, but `AutonomousAgentController.startTask(...)` generated a different internal id
  - that meant autonomous events, memory tags, and status lookup were not guaranteed to stay aligned with the real task session boundary
- The current fix closes that hole by pushing `sessionTaskId + workspacePath` into autonomous startup and by routing agent memory reads/writes through the same `taskIsolationPolicyStore`-backed helpers used by other runtime surfaces.
- That residual cleanup is now closed:
  - the dead legacy helpers were removed from `/Users/beihuang/Documents/github/coworkany/sidecar/src/main.ts`
  - doctor now includes a `memory-source-guards` check that scans guarded runtime sources for reintroduced global memory APIs or helper patterns
- This makes the evidence chain stronger than a one-time grep:
  - code path is removed
  - regression test proves doctor fails if the helper comes back
  - operators can see the guard explicitly in `sidecar doctor` output instead of relying on code review memory
- Another concrete isolation bypass existed in autonomous subtask tool execution:
  - `AutonomousLlmAdapter.executeSubtask(...)` used to call `executeInternalTool(...)` with synthetic task ids like `subtask_${subtask.id}` plus global cwd.
  - isolation/policy mappings are keyed by real task session ids, so synthetic ids can silently degrade enforcement to an unbound context.
- The fix now resolves the parent session task id and workspace from subtask ids and executes tools under that parent session context.
- A dedicated doctor regression now flags this pattern if reintroduced, so this bug class cannot creep back quietly.

## 2026-03-22 Commercialization Gate Hardening

- Current `release-readiness` preflight was over-strict for clean local environments: it required doctor `healthy` even when no `appDataDir` evidence was supplied.
- Workspace allowlist gating should be conditional on risk surface. Requiring enforce mode while zero third-party extensions are enabled creates false blockers and does not improve safety.
- Safer gating model:
  - zero enabled third-party extensions -> allowlist gate passes with explicit note
  - any enabled third-party extension -> require `mode=enforce` and explicit allowlist membership for each enabled id
- Extension governance doctor signal should also be risk-aware:
  - missing governance store + zero enabled third-party extensions -> pass
  - missing governance store + enabled third-party extensions -> fail
- `release-readiness` now supports explicit doctor strictness and defaults to:
  - `degraded` when `appDataDir` is not provided
  - `healthy` when `appDataDir` is provided
- This keeps local/preflight runs usable while preserving strict commercial gating for real canary evidence runs.

## 2026-03-22 Canary Evidence Productization

- The roadmap canary checklist was still a markdown-only process artifact; readiness could pass without structured proof for audience/rollback/fault-injection/go-no-go ownership.
- To close that commercialization gap, release-readiness now supports a structured canary evidence file and a dedicated gate:
  - evidence summary is included in report JSON/Markdown
  - enforcement can be toggled with `--require-canary-evidence`
  - strict runs fail when required checklist areas lack evidence
- Optional mode preserves developer velocity:
  - if `--require-canary-evidence` is not set, missing evidence file does not fail the run
  - malformed evidence files still surface explicit findings
- Added a template artifact in `docs/releases/canary-evidence.template.json` so release owners can fill evidence in a machine-checkable format instead of ad-hoc comments.

## 2026-03-23 Desktop Concurrency Scenario Inventory

- Existing desktop-sidecar smoke coverage already validates one concurrent case (`desktop/tests/interrupted-task-resume-sidecar-smoke.test.ts`) with 3 simultaneous long-running tasks and a continue-task recovery action.
- The current concurrent case is hardcoded and not reusable; there is no shared scenario abstraction for batch generation.
- The repo already has a strong data-driven scenario pattern in `desktop/tests/system-tools-desktop-e2e.test.ts` (`buildScenarios` + looped `test(...)` generation), which can be applied to concurrent-task coverage.
- Current non-interference checks are partial (started/progress/tool/effect observed), but do not yet assert marker isolation per task or per-task absence of `TASK_FAILED` in a reusable framework.
- The existing real-sidecar harness (`ResumeSidecarHarness`) is suitable as the foundation for a unified desktop concurrency scenario framework because it exercises desktop-triggered IPC and real sidecar behavior.
- The concurrent desktop smoke path is now formalized as a data-driven framework in `desktop/tests/interrupted-task-resume-sidecar-smoke.test.ts` with:
  - `ConcurrentScenarioDefinition`
  - scenario matrix builder
  - batch task-input generator
  - shared readiness/assertion helpers
- The concurrent suite now batch-generates two desktop-triggered scenarios:
  - `triple-host-scan` (3 parallel tasks)
  - `quad-host-scan-stress` (4 parallel tasks)
- Non-interference validation now explicitly asserts marker isolation per task:
  - each task started description contains only its own marker
  - no foreign marker leakage from sibling concurrent tasks
- Each concurrent task must independently satisfy:
  - `TASK_STARTED`
  - `PLAN_UPDATED` with in-progress summary
  - `TOOL_CALL` for `list_dir`
  - `request_effect` awaiting-confirmation state
  - no `TASK_FAILED`
- Continue-task recovery is now validated inside each concurrent scenario batch, proving interruption recovery remains available under concurrent load.
- Verification evidence:
  - `cd desktop && npx playwright test tests/interrupted-task-resume-sidecar-smoke.test.ts --grep "concurrent scenario batch" --workers=1` -> 2 passed
  - `cd desktop && npx playwright test tests/interrupted-task-resume-sidecar-smoke.test.ts --workers=1` -> 6 passed
  - `cd desktop && npx tsc --noEmit` -> exit 0

## 2026-03-23 Desktop 股票检索分析场景框架

- desktop 侧股票测试已存在大量重复实现（输入框查找、日志轮询、关键词断言、产物落盘），缺统一抽象导致扩展新标的成本高。
- `stock-research` 能力在 sidecar 已有覆盖，但 desktop 触发路径缺矩阵化测试，不利于验证用户真实入口质量。
- 新增统一框架 `desktop/tests/utils/stockScenarioFramework.ts` 后，核心收益：
  - 场景 schema + matrix 自动生成
  - 统一 runner（提交、事件解析、证据抽取、完成判定）
  - 统一质量断言（search_web 调用、标的覆盖、建议关键词、预测关键词）
  - 统一外部依赖失败识别
- 首版矩阵覆盖 4 组场景，并显式纳入 `parallel-minimax-yankuang-glm-nvidia`。
- 初版外部失败规则曾误判成功场景（过宽匹配 `401|402|403`）；已改为仅在任务失败上下文生效，并收窄为 HTTP 语义模式匹配。

## 2026-03-27 Canonical Task Stream Phase 2

- Desktop chat-mode fallback behavior is now split deliberately:
  - if canonical messages exist for a chat task, timeline rendering prefers canonical messages
  - otherwise it continues to render from legacy `TaskEvent` projection
- This keeps migration risk low because structured task/task-card views are not yet coupled to canonical parts.
- The first failed regression during phase 2 was not in the timeline logic itself:
  - `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts` imported canonical types using a relative path that was one directory too shallow
  - `desktop/tests/timeline-items.test.ts` did not copy `taskMode` from helper overrides into the returned `TaskSession`, so the new chat-mode branch was never exercised
- After fixing those two issues, canonical chat-mode rendering passed focused desktop tests and typecheck without changing task-mode behavior.

## 2026-03-27 Canonical Task Stream Phase 3

- The existing `AssistantTurnBlock` renderer already had the right presentation primitives for structured runtime activity:
  - `toolCalls`
  - `effectRequests`
  - `patches`
- That let the migration stay narrow: only the canonical chat-mode timeline builder needed to learn how to project runtime parts into those existing item shapes.
- The next compatibility gap was task-card interaction parity, not rendering primitives:
  - canonical `task` parts needed enough structured data to rebuild task-center sections and task lists
  - canonical `collaboration` parts needed stable `actionId` plus external-auth choices to keep current desktop interactions working
- The fix was split across protocol and projection:
  - sidecar canonical `TASK_PLAN_READY` now carries `intentRouting` in task-part data
  - sidecar canonical collaboration parts now carry `actionId`, and external-auth user actions emit the same open-login / continue choices desktop already understands
  - desktop canonical chat-mode now builds `TaskCardItem` state directly from canonical `task` / `collaboration` / `finish` / `error` parts instead of falling back to legacy events
- `ToolCard` already handled non-string results at runtime, but `ToolCallItem.result` was still typed as `string`; widening it to `unknown` removed that latent type mismatch and matches the actual renderer behavior.
- Scheduled mode had three behavior differences that could not be ignored during migration:
  - suppress internal user echo messages
  - suppress research-update noise
  - keep compact finish/result behavior without duplicating assistant messages
- Those behaviors now live in the canonical builder as session-aware rules instead of forcing scheduled sessions to stay on legacy projection.
- The next leverage point was fallback strategy, not message rendering:
  - as long as event-only sessions still bypassed canonical completely, the legacy builder remained a hidden second implementation of the same product semantics
  - that creates drift risk even if live sidecar sessions already dual-write canonical
- Desktop now closes that gap by locally converting legacy `TaskEvent`s into canonical stream events for rendering when store-backed canonical messages are absent.
- To make that safe, canonical protocol coverage was extended for the remaining high-signal legacy-only cases:
  - `PLAN_UPDATED`
  - desktop-local `RATE_LIMITED` synthesis into runtime status labels
