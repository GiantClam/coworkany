# Mastra Single-Core Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CoworkAny's Mastra single-core architecture explicit in docs and tighten routing, task draft, and evidence contract behavior without introducing Pi Agent.

**Architecture:** Extend the existing Mastra control-plane path instead of creating a second runtime. `routedInput` owns explicit route parsing, `workRequestAnalyzer` owns draft/evidence contract inference, and tests lock the externally visible routing and freeze-contract behavior.

**Tech Stack:** Bun, TypeScript, Mastra, existing sidecar test harness.

**Tool Unification Decision:** Mastra tool is the only first-class runtime tool shape. `core` is a profile/filter, `STANDARD_TOOLS` is a migration-stage implementation source, toolpack/MCP is a source of registered tools, and skills remain instructions/triggers rather than executable tools. Standard CoworkAny tools are registered directly as Mastra `createTool(...)` entries with CoworkAny metadata (`effects`, `capabilities`, `evidenceKind`, `riskLevel`, `aliases`) so capability summary, evidence gates, approval policy, and agent callable tools can converge on the same registry.

---

### Task 1: Document The Single-Core Decision

**Files:**
- Create: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Write the decision document**

Record why Pi Agent is not introduced, the Mastra/CoworkAny responsibility split, route rules, task contract rules, evidence gates, and staged rollout.

- [x] **Step 2: Self-review the doc**

Verify it contains no placeholder sections and makes the implementation scope explicit.

### Task 2: Add Explicit Slash Routing

**Files:**
- Modify: `sidecar/src/orchestration/routedInput.ts`
- Test: `sidecar/tests/phase4-control-plane.test.ts`

- [x] **Step 1: Add tests for `/ask`, `/task`, `/schedule`**

Expected behavior: `/ask` forces chat, `/task` forces immediate task, `/schedule` strips the command and lets schedule analysis force scheduled task.

- [x] **Step 2: Implement parser support**

Extend `ForcedRouteMode` with `schedule`, add slash command parsing, and map schedule to `scheduled_task` in `resolveForcedWorkMode`.

### Task 3: Add Task Draft And Evidence Contract Inference

**Files:**
- Modify: `sidecar/src/orchestration/workRequestSchema.ts`
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Test: `sidecar/tests/phase4-control-plane.test.ts`

- [x] **Step 1: Add tests for taskDraftRequired and executionRequirements**

Verify file-write tasks require draft and artifact evidence; market/web tasks require web evidence; scheduled tasks require draft.

- [x] **Step 2: Implement minimal inference**

Infer evidence requirements from existing signals and attach them to each `TaskDefinition.executionRequirements`.

### Task 4: Include Evidence In Frozen Execution Query

**Files:**
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Test: `sidecar/tests/phase4-control-plane.test.ts`

- [x] **Step 1: Add freeze-contract assertion**

Verify frozen execution query includes `Required evidence:` lines.

- [x] **Step 2: Append evidence requirements to execution query**

Add deterministic text in `buildExecutionQueryForTaskIds` so the workflow agent sees the required evidence contract.

### Task 5: Verify

**Files:**
- No source changes unless tests fail.

- [x] **Step 1: Run targeted tests**

Run: `cd sidecar && bun test tests/phase4-control-plane.test.ts tests/mastra-entrypoint.test.ts --test-name-pattern "analyze intent wrapper detects work mode|freeze contract wrapper generates frozen request|start_task auto-routes chat intent to direct chat path|start_task routes market-data query to direct task path for tool-first execution"`

- [x] **Step 2: Run typecheck**

Run: `cd sidecar && npm run typecheck`

### Task 6: Capability-Specific Evidence Matching

**Files:**
- Modify: `sidecar/src/mastra/workflows/steps/execute-task.ts`
- Test: `sidecar/tests/execute-task-step.test.ts`

- [x] **Step 1: Add failing coverage for unrelated tool evidence**

Verify a `command_execution` tool call does not satisfy `web_research`.

- [x] **Step 2: Add multi-capability success coverage**

Verify a task requiring both `web_research` and `artifact_write` only completes when both matching tool classes appear.

- [x] **Step 3: Implement capability matcher**

Map observed tool names into `satisfiedCapabilities` and `missingCapabilities`, then fail with `workflow_missing_required_tool_evidence:<capability-list>` when any required capability is missing.

- [x] **Step 4: Update decision document**

Record that the completion gate now checks capability-specific tool classes rather than any tool call.

### Task 7: Real Session Replay Acceptance

**Files:**
- Create: `sidecar/tests/fixtures/real-session-replay-cases.json`
- Create: `sidecar/tests/real-session-replay.test.ts`
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Create: `sidecar/src/evals/controlPlaneEventLogImporter.ts`
- Modify: `sidecar/src/evals/controlPlaneEvalRunner.ts`
- Create: `sidecar/src/doctor/controlPlaneIncidentReplay.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Extract DB-backed real failure patterns**

Replay cases cover `thread-eml-004`, `thread-web-004`, and `thread-fin-008`, all representing false completion or missing output artifact failures from real Mastra message history.

- [x] **Step 2: Lock false-completion behavior**

Tests reject text-only completion and wrong tool-class evidence, and accept only matching capability evidence.

- [x] **Step 3: Fix real benchmark phrasing recognition**

`workRequestAnalyzer` now recognizes `[Output File Contract]`, `Read \`workspace/...\``, and `Write the result/report/output to \`workspace/...\`` as file read/write task signals.

- [x] **Step 4: Restore control-plane replay infrastructure**

Event-log importer, eval runner, and incident replay module are available again so saved runtime logs can be converted into eval cases and replayed.

### Task 8: Expand DB Replay And Live Acceptance Gate

**Files:**
- Modify: `sidecar/tests/fixtures/real-session-replay-cases.json`
- Modify: `sidecar/tests/real-session-replay.test.ts`
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Expand real DB fixture coverage**

Added replay cases for `thread-doc-004`, `thread-comm-004`, `thread-code-001`, and `thread-edu-001`, covering multi-turn output loops, code artifact false completion, and manual-review placeholder routing.

- [x] **Step 2: Add routing assertions to real-session replay**

Replay tests now verify expected mode, task draft requirement, and manual action kinds, not just tool evidence.

- [x] **Step 3: Fix analyzer gaps found by DB replay**

`manual review` now triggers manual action/task draft semantics, and bare backticked filenames such as `calculator.py` are recognized as filesystem read evidence.

- [x] **Step 4: Run live model gates**

Verified `npm run test:real-model-smoke` and `npm run test:regression:core-full:live` against the configured live provider.

### Task 9: Convert Subjective Acceptance Risks To Automated Judgement

**Files:**
- Create: `sidecar/src/acceptance/liveAcceptanceOracle.ts`
- Create: `sidecar/tests/live-acceptance-oracle.test.ts`
- Modify: `sidecar/tests/real-model-smoke.e2e.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Add deterministic acceptance oracle**

Implemented answer quality, product tone, UI understandability, and combined live acceptance checks as pure functions.

- [x] **Step 2: Lock subjective risks with tests**

Tests now reject false completion, low-information answers, raw protocol errors, AI-meta tone, unclear failure UI, and missing recovery actions.

- [x] **Step 3: Gate live model smoke with the oracle**

`real-model-smoke.e2e.test.ts` now calls `evaluateLiveAcceptance` instead of only checking that assistant text exists.

- [x] **Step 4: Update the optimization document**

The main plan now maps each former manual risk to an automated check, failure condition, and gate behavior.

### Task 10: Add Visual Screenshot Acceptance

**Files:**
- Modify: `sidecar/src/acceptance/liveAcceptanceOracle.ts`
- Modify: `sidecar/tests/live-acceptance-oracle.test.ts`
- Create: `desktop/tests/utils/visualAcceptance.ts`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts`
- Modify: `desktop/src/lib/taskFailureUi.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
- Modify: `desktop/tests/task-failure-ui.test.ts`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-recoverable-failure-state-light-en-darwin.png`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Add visual verdict to the acceptance oracle**

`evaluateVisualScreenshotAcceptance` now accepts screenshot/reference paths, score, threshold, verdict, category match, and visual differences.

- [x] **Step 2: Add structured Playwright visual acceptance helper**

`expectVisualScreenshotAccepted` wraps `toHaveScreenshot`, verifies the target is visible and large enough, and writes `*.visual-verdict.json` for pass/fail runs.

- [x] **Step 3: Cover recoverable failure UI with screenshot acceptance**

Assistant UI visual regression now includes a recoverable missing-tool-evidence failure state and asserts readable title/action plus no raw protocol error leakage.

- [x] **Step 4: Fix visual-gate finding**

The first screenshot run caught `workflow_missing_required_tool_evidence` leaking in timeline event summaries. `taskFailureUi` and `useTimelineItems` now humanize that protocol error.

- [x] **Step 5: Verify visual gate**

Ran the visual suite in update mode to create the new baseline, then reran without update mode to confirm all four visual states pass.

### Task 11: Expand Visual Risk Coverage

**Files:**
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts`
- Modify: `desktop/src/lib/taskFailureUi.ts`
- Modify: `desktop/src/components/Chat/ChatInterface.tsx`
- Modify: `desktop/src/i18n/locales/en.json`
- Modify: `desktop/src/i18n/locales/zh.json`
- Modify: `desktop/tests/task-failure-ui.test.ts`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-configuration-required-state-light-en-darwin.png`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-suspended-state-dark-en-darwin.png`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Add configuration-required screenshot acceptance**

Visual suite now checks provider configuration failures render `Provider configuration required`, expose `Open LLM Settings`, and do not leak raw protocol errors.

- [x] **Step 2: Add suspended screenshot acceptance**

Visual suite now checks suspended tasks render `Task suspended`, show the concrete suspension reason, expose `Retry`, and do not show `undefined`.

- [x] **Step 3: Fix suspended copy**

Suspended task UI now uses dedicated `failureSuspendedTitle`, `failureSuspendedDesc`, and `statusSuspended` i18n keys instead of retryable upstream copy.

- [x] **Step 4: Verify expanded visual suite**

Generated the two new baselines with update mode, then reran normal visual mode with six passing states.

### Task 12: Cover Dense Timeline Visual Risk

**Files:**
- Modify: `desktop/src/components/Chat/Timeline/components/taskCardViewModel.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/timelineShared.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
- Modify: `desktop/src/components/Chat/assistantUi/messageAdapter.ts`
- Modify: `desktop/src/components/Chat/assistantUi/AssistantUiThreadView.tsx`
- Modify: `desktop/src/components/Chat/assistantUi/AssistantUiThreadView.module.css`
- Modify: `desktop/tests/structured-card-view-models.test.ts`
- Modify: `desktop/tests/timeline-items.test.ts`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-dense-task-timeline-light-en-darwin.png`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-dense-task-timeline-narrow-dark-en-darwin.png`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Add dense multi-turn task screenshot acceptance**

Visual suite now seeds a multi-turn task with plan, research, tools, checkpoint, manual review, task progress, and execution profile capability requirements.

- [x] **Step 2: Add narrow viewport dense timeline acceptance**

The same dense task is validated at a 390px viewport to catch mobile/narrow layout clipping and unreadable task evidence.

- [x] **Step 3: Keep dense task-center evidence visible**

Dense `task-center-*` cards now expand instead of hiding; assistant-ui structured task cards render task items, sections, collaboration details, and capability requirements.

- [x] **Step 4: Persist execution profile into canonical sections**

`TASK_PLAN_READY.executionProfile.requiredCapabilities` is projected into an `Execution profile` section so replay, timeline, and assistant-ui can assert the same evidence text.

- [x] **Step 5: Verify eight-state visual suite**

Generated dense baselines with update mode, then reran normal visual mode with all eight visual states passing.

### Task 13: Expand Real DB UI Timeline Replay

**Files:**
- Create: `sidecar/tests/fixtures/real-ui-timeline-replay-cases.json`
- Create: `sidecar/tests/real-ui-timeline-db-snapshot.test.ts`
- Create: `desktop/tests/real-ui-timeline-replay.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Add DB-derived UI timeline fixture**

Fixture now captures `thread-doc-004`, `thread-comm-004-debug-no-approval`, and `thread-web-004-debug-no-approval` with DB stats plus TaskEvent seeds for long multi-turn, slow response, and manual approval branches.

- [x] **Step 2: Verify fixture stats against local DB**

`real-ui-timeline-db-snapshot.test.ts` checks message counts, role counts, first/last timestamps, duration, and max observed gap against `.coworkany/data/coworkany.db` when available.

- [x] **Step 3: Replay fixture through desktop timeline projection**

`real-ui-timeline-replay.test.ts` calls `buildTimelineItems` and verifies task sections, capability evidence, slow-response notices, manual review collaboration, and absence of false completion text.

- [x] **Step 4: Verify targeted replay gates**

Ran sidecar DB snapshot + real session replay and desktop timeline replay + structured card tests.

### Task 14: Add Real DB Timeline Screenshot Gate

**Files:**
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-doc-004-long-multiturn-ui-timeline-darwin.png`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-comm-004-debug-no-approval-slow-response-ui-timeline-darwin.png`
- Create: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-web-004-debug-no-approval-manual-approval-ui-timeline-darwin.png`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Reuse DB timeline fixture in Playwright visual suite**

The visual suite now loads `real-ui-timeline-replay-cases.json` directly, so projection replay and screenshot replay share the same source.

- [x] **Step 2: Add three DB-derived screenshot baselines**

Added screenshot coverage for long multi-turn, slow-response, and manual approval DB timeline cases.

- [x] **Step 3: Assert visible acceptance before screenshot**

Each DB visual case checks key replay text is visible and rejects `undefined` plus false-completion copy before taking the screenshot.

- [x] **Step 4: Verify real DB visual subset**

Generated baselines with update mode, then reran the same three tests without update mode.

### Task 15: Require Finished Detection For Completion Screenshots

**Files:**
- Modify: `sidecar/tests/fixtures/real-ui-timeline-replay-cases.json`
- Modify: `desktop/tests/real-ui-timeline-replay.test.ts`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-dense-task-timeline-light-en-darwin.png`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-dense-task-timeline-narrow-dark-en-darwin.png`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-doc-004-long-multiturn-ui-timeline-darwin.png`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-comm-004-debug-no-approval-slow-response-ui-timeline-darwin.png`
- Modify: `desktop/tests/assistant-ui-visual-regression.e2e.spec.ts-snapshots/assistant-ui-real-db-thread-web-004-debug-no-approval-manual-approval-ui-timeline-darwin.png`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Identify root cause**

Completion-oriented screenshots were seeded as `running` or `suspended` and lacked `TASK_FINISHED`; visual assertions checked readability, not terminal completion.

- [x] **Step 2: Add finished events to completion replay fixtures**

Dense timeline and all three real DB replay visual cases now end with `TASK_FINISHED`, final summaries, files/artifacts, and `finished` session status.

- [x] **Step 3: Assert finished in projection and visual gates**

Projection replay now requires final task status `finished`, all task items terminal, and blocking collaboration cleared. Visual replay requires final summary plus `task status finished` before screenshot.

- [x] **Step 4: Preserve negative-state coverage**

Failure/configuration-required/suspended screenshots remain intentionally non-finished UI state tests and are not counted as completion-oriented task screenshots.

- [x] **Step 5: Verify full visual suite**

Regenerated affected baselines, reran dense + real DB visual subset, and reran the full 11-state visual suite.

### Task 16: Continue Agent Loop After First-Round Command Failure

**Files:**
- Create: `sidecar/src/mastra/agents/iterationPolicy.ts`
- Modify: `sidecar/src/mastra/agents/supervisor.ts`
- Modify: `sidecar/src/mastra/agents/supervisorSolo.ts`
- Modify: `sidecar/tests/phase3-agent-loop.test.ts`
- Create: `sidecar/tests/fixtures/real-agent-loop-replay-cases.json`
- Modify: `sidecar/tests/mastra-entrypoint.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Inspect latest real session**

Read the latest `sidecar/.coworkany/data/coworkany.db` messages. The task attempted `ffmpeg -framerate1/5`, received `Unrecognized option 'framerate1/5'` and `Exit code: 8`, then asked the user to confirm continuation instead of running the corrected command.

- [x] **Step 2: Identify stop condition**

`supervisor` and `supervisorSolo` stopped any non-final iteration with no pending tool calls and text length >= 12. That short-circuited Mastra's `Overall: NOT COMPLETE` completion-check result.

- [x] **Step 3: Add shared iteration policy**

Moved the stop/continue logic into `iterationPolicy.ts`. It keeps normal complete-answer stopping, but detects command/tool failure repair prompts that ask for continuation and returns `continue: true` with feedback instructing the next loop to import the failure details, run the corrected retry command, verify the output artifact, and only then report final status.

- [x] **Step 4: Lock with tests**

Added regression tests for supervisor and supervisorSolo failure-repair prompts, plus a negative control proving optional completed follow-up offers still stop.

- [x] **Step 5: Verify**

Ran targeted iteration-policy tests, the full phase3 agent-loop plus streaming attachment suite, sidecar typecheck, and `git diff --check`.

- [x] **Step 6: Freeze DB session as full replay fixture**

Added `real-agent-loop-replay-cases.json` for source thread `03220ed5-19bb-422c-87b6-f83d4f0e41f0` and recovery thread `03220ed5-19bb-422c-87b6-f83d4f0e41f0-auto-approval-recovery-598d9d90-f9f0-4dd4-b14c-8eac4a9814d7`. The fixture preserves the failed `ffmpeg -framerate1/5` command, `Unrecognized option 'framerate1/5'`, first-round assistant confirmation request, corrected command fragments, final output path, and expected `TASK_FINISHED`.

- [x] **Step 7: Verify second loop produces TASK_FINISHED**

Added an entrypoint-level replay test that consumes the fixture, verifies the iteration policy requests continuation, then runs a deterministic second-loop `start_task` stream with corrected command execution, artifact write evidence for `output/merged_images_5s.mp4`, assistant summary, and `complete`. The acceptance requires no `TASK_FAILED`, a corrected `ffmpeg -framerate 1/5` tool call/result, output artifact evidence, and the final protocol event `TASK_FINISHED`.

- [x] **Step 8: Make timeline process/result text user-readable**

Updated timeline and assistant-ui projection so retry/process events, tool input/output summaries, and generic completion summaries are translated into user-facing language. Raw command strings, stderr, `Exit code`, timeout metrics, and protocol fields remain available in structured events but are not used as primary timeline copy. Added tests for readable retry process text, readable final completion text, and command tool summary redaction.

- [x] **Step 9: Prevent delegating automatable commands to the user**

Latest DB replay showed the model still asked the user to run the corrected `ffmpeg` command manually after repeated wrong-command attempts. Expanded `iterationPolicy.ts` so any automatable local command delegated to the user causes another agent loop unless real human assistance is required (sudo password, login, captcha, authorization, manual review). Added tests for failed-command manual delegation, no-failure manual command delegation, and the sudo/password exception. The DB replay fixture now includes the `2026-04-27T01:20:13.742Z` manual-execution text.

- [x] **Step 10: Prevent repeated failed command reuse after user approval**

Latest DB follow-up showed the user replied "帮我执行上述指令", "执行修复版", and "允许", but the tool still executed the old `ffmpeg -framerate1/5` command. Root cause: the short follow-up did not carry the corrected command as a hard retry constraint, and command recovery did not recognize ffmpeg glued-option failures. Added deterministic recovery for `Unrecognized option 'framerate1/5'` so retry contracts inject `ffmpeg -framerate 1/5`, added "do not repeat the last failed command verbatim" guidance, expanded iteration policy for "请允许/如果同意/如果愿意" repair prompts, and extended the real replay fixture with this follow-up branch.

### Task 17: Register Standard Tools As Mastra Tools

**Files:**
- Create: `sidecar/src/mastra/tools/coworkanyToolRegistry.ts`
- Modify: `sidecar/src/mastra/internalToolResolver.ts`
- Modify: `sidecar/src/mastra/agents/supervisor.ts`
- Modify: `sidecar/src/mastra/agents/supervisorSolo.ts`
- Modify: `sidecar/src/mastra/agents/coworker.ts`
- Modify: `sidecar/src/mastra/agents/coder.ts`
- Modify: `sidecar/tests/runtime-tool-catalog.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Define Mastra-native registry**

Added `CoworkAnyToolRegistry`, which registers current standard tools as Mastra `createTool(...)` objects and stores CoworkAny metadata (`effects`, `capabilities`, `evidenceKind`, `riskLevel`, `aliases`) next to the tool definition.

- [x] **Step 2: Make core a filter**

`core` profile now resolves the same Mastra-native registry and filters to `view_file`, `list_dir`, `write_to_file`, `replace_file_content`, and `run_command`. It no longer implies a separate core tool implementation.

- [x] **Step 3: Wire agents to registry tools**

Supervisor, SupervisorSolo, Coworker, and Coder now consume registry-produced Mastra tools directly. Research tools remain feature builtins for now and MCP tools are still merged as external tool sources.

- [x] **Step 4: Align runtime capability metadata**

`resolveRuntimeInternalTool` now reads standard tool metadata from the Mastra-native registry, so runtime toolset/capability views begin converging with the tools agents can actually call.

- [x] **Step 5: Lock with tests**

Added coverage that core profile exposes only baseline standard tools, full profile exposes all standard tools, and a registry-produced `view_file` Mastra tool executes using CoworkAny request context.

### Task 18: Move Builtin Research Tools Into The Registry

**Files:**
- Modify: `sidecar/src/mastra/tools/coworkanyToolRegistry.ts`
- Modify: `sidecar/src/mastra/tools/profiledBuiltins.ts`
- Modify: `sidecar/src/mastra/agents/supervisor.ts`
- Modify: `sidecar/src/mastra/agents/supervisorSolo.ts`
- Modify: `sidecar/src/mastra/agents/researcher.ts`
- Modify: `sidecar/src/mastra/agents/resolveResearchTools.ts`
- Modify: `sidecar/tests/runtime-tool-catalog.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Register research tools in CoworkAnyToolRegistry**

Added `search_web`, `crawl_url`, and `extract_content` as builtin Mastra registrations with `web_research` capability and `network:outbound` effects.

- [x] **Step 2: Remove duplicate agent-side research builtin tables**

Supervisor and SupervisorSolo now get research tools through `resolveCoworkAnyMastraTools()`. `resolveProfiledBuiltinAgentTools` delegates to the same registry instead of owning its own tool map.

- [x] **Step 3: Align researcher path**

`resolveResearchTools` now gets builtin research tools from the registry before merging MCP tools, preserving the existing MCP alias/prioritization behavior.

- [x] **Step 4: Lock with tests**

Added metadata coverage for builtin research tools and updated full-profile registry expectations.

### Task 19: Consolidate Command Tool Surface On run_command

**Files:**
- Modify: `sidecar/src/mastra/agents/coworker.ts`
- Modify: `sidecar/src/mastra/agents/coder.ts`
- Modify: `sidecar/src/mastra/agents/resolveResearchTools.ts`
- Modify: `sidecar/tests/streaming-toolset-resolution.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Stop default agent injection of bash tools**

Coworker and Coder now instruct and expose command execution through registry-provided `run_command`. The legacy `bash` and `bash_approval` tool names remain accepted in historical event/replay parsing, but the default agent tool surface no longer exposes them.

- [x] **Step 2: Replace researcher bash fallback with run_command**

`resolveResearchTools` now appends registry-provided `run_command` as the command fallback for full profile research flows. Same-name MCP command tools are aliased rather than replacing the canonical internal command tool.

- [x] **Step 3: Lock with tests**

Updated streaming toolset resolver coverage so full profile expects `run_command` fallback and core profile still excludes builtins.

### Task 20: Remove Standard Tool Runtime Fallbacks

**Files:**
- Modify: `sidecar/src/main-mastra.ts`
- Delete: `sidecar/src/mastra/tools/memory.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Remove runtime STANDARD_TOOLS fallback**

The sidecar runtime entrypoint no longer falls back from `globalToolRegistry` to `STANDARD_TOOLS` when resolving voice provider tools. Runtime-facing tool resolution should now flow through the runtime registry paths rather than the legacy standard array.

- [x] **Step 2: Delete unused memory wrapper**

Removed the unused `mastra/tools/memory.ts` wrapper. `remember` and `recall` remain available through `CoworkAnyToolRegistry`, which registers them as Mastra tools from the migration-stage implementation source.

- [x] **Step 3: Keep implementation source deliberately**

`STANDARD_TOOLS` remains in `tools/standard.ts` as a migration-stage implementation source and low-level test seam. It is no longer a default agent or runtime fallback surface.

### Task 21: Restore Structured File Tool Coverage

**Files:**
- Modify: `sidecar/src/tools/standard.ts`
- Modify: `sidecar/src/mastra/tools/coworkanyToolRegistry.ts`
- Modify: `sidecar/tests/runtime-tool-catalog.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Reintroduce missing structured file tools**

Added `create_directory`, `compute_file_hash`, `batch_delete_paths`, and `batch_move_files` to the standard implementation source. These tools are used by existing structured-file and execution-runtime expectations, so leaving them absent made the capability surface point at non-callable tools.

- [x] **Step 2: Register schemas in the Mastra registry**

Added Mastra input schemas for all restored structured file tools so full profile exposes callable Mastra tools through the same registry path as the rest of CoworkAny tools.

- [x] **Step 3: Lock with tests**

Updated runtime tool catalog expectations and restored `structured-file-tools` coverage to green.

### Task 22: Delete Legacy bash Mastra Tool

**Files:**
- Delete: `sidecar/src/mastra/tools/bash.ts`
- Modify: `sidecar/tests/phase2-tools.test.ts`
- Modify: `sidecar/tests/command-sandbox.test.ts`
- Modify: `sidecar/tests/fixtures/risk-regression-suites.json`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Move Phase 2 command tests to run_command**

Rewrote the Phase 2 command tests to execute registry-provided `run_command` and `checkCommand` instead of importing the deleted legacy `bash` and `bash_approval` tools.

- [x] **Step 2: Remove dead legacy tool implementation**

Deleted `mastra/tools/bash.ts`. Historical event names such as `bash` and `bash_approval` remain recognized by replay/evidence regexes, but no runtime agent receives those tools.

- [x] **Step 3: Update risk suite selectors**

Updated the risk regression suite test-name pattern to target `run_command` tests instead of the removed `bash` tests.

### Task 23: Prevent Legacy Registry Shadowing

**Files:**
- Modify: `sidecar/src/mastra/internalToolResolver.ts`
- Modify: `sidecar/tests/runtime-tool-catalog.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Remove globalToolRegistry from internal tool resolution**

`resolveRuntimeInternalTool` now resolves CoworkAny internal tools from `CoworkAnyToolRegistry` metadata first and no longer allows legacy `globalToolRegistry` entries to shadow canonical Mastra-native tools.

- [x] **Step 2: Lock shadowing behavior**

Added a regression test that registers a fake legacy `run_command` stub and verifies runtime internal resolution still returns the canonical Mastra-native command metadata.

- [x] **Step 3: Remove the global registry extension point**

Deleted the legacy `globalToolRegistry` singleton and removed all runtime imports. Custom voice providers now depend on an explicitly injected `getToolByName` resolver and default to unavailable when no resolver is configured, so they cannot silently reintroduce a parallel runtime tool mechanism.

### Task 24: Remove Legacy Global Tool Registry

**Files:**
- Modify: `sidecar/src/tools/core/voice.ts`
- Modify: `sidecar/src/main-mastra.ts`
- Delete: `sidecar/src/tools/registry.ts`
- Modify: `sidecar/tests/runtime-tool-catalog.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Make voice provider tool lookup explicit**

`configureVoiceProviders` now accepts an optional `getToolByName` callback. TTS and stop-tool lookup use that injected resolver instead of importing a global registry.

- [x] **Step 2: Remove the runtime singleton dependency**

`main-mastra.ts` no longer imports or passes `globalToolRegistry`. Runtime voice bindings currently pass no internal custom tool resolver, matching the prior effective behavior because no production code registered tools into the global singleton.

- [x] **Step 3: Delete the dead registry**

Removed `sidecar/src/tools/registry.ts` and the shadowing regression test that depended on it. Canonical internal tool resolution is now protected by direct Mastra registry resolver tests rather than by a legacy-stub scenario.

### Task 25: Merge Voice Provider Lookup with Mastra Tools

**Files:**
- Create: `sidecar/src/mastra/voiceProviderToolResolver.ts`
- Modify: `sidecar/src/main-mastra.ts`
- Delete: `sidecar/src/mastra/tools/voice.ts`
- Modify: `sidecar/tests/speech-providers.test.ts`
- Modify: `docs/plans/2026-04-26-mastra-single-core-optimization.md`
- Modify: `docs/superpowers/plans/2026-04-26-mastra-single-core-optimization.md`

- [x] **Step 1: Define the ownership model**

`voice_speak` is the public Mastra tool endpoint for spoken output. The voice provider layer remains the implementation/orchestration layer below it. This avoids making `voice_speak` a provider and creating a recursive `voice_speak -> provider -> voice_speak` loop.

- [x] **Step 2: Reuse Mastra registry for provider tool lookup**

Added `resolveVoiceProviderMastraToolDefinition`, which adapts a registered CoworkAny Mastra tool into the `ToolDefinition` shape expected by ASR/TTS provider code. The adapter supplies CoworkAny request context through Mastra `RequestContext`.

- [x] **Step 3: Wire runtime voice paths through the shared resolver**

`main-mastra.ts` now injects the same resolver into both `createVoiceProviderBindings` and `configureVoiceProviders`, so `/voice` utility status/transcription and `voice_speak` TTS execution observe the same provider availability.

- [x] **Step 4: Remove duplicate Mastra voice tool implementation**

Deleted the unused `sidecar/src/mastra/tools/voice.ts` implementation. The canonical `voice_speak` registration now comes from `CoworkAnyToolRegistry`.

- [x] **Step 5: Lock recursion prevention**

Added tests proving Mastra registry tools can back provider discovery while `voice_speak` itself is rejected as a provider implementation.
