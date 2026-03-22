# Task Plan: Agent-Led Long-Task Orchestration

## Goal
Make Coworkany own task planning and collaboration by adding structured deliverables, checkpoints, user-action requests, and defaulting/clarification logic to the work-request control plane.

## Current Phase
Phase 5

## Phases
### Phase 1: Requirements & Discovery
- [x] Confirm product role: Coworkany leads, user assists only when needed
- [x] Inspect current planner/runtime/UI surfaces
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define execution-contract fields to add first
- [x] Identify first implementation slice: schema + analyzer + focused tests
- [x] Confirm compatibility expectations for existing runtime/tests
- **Status:** complete

### Phase 3: Implementation
- [x] Extend work request schema with contract fields
- [x] Implement analyzer defaults for deliverables/checkpoints/user actions
- [x] Update prompt generation to encode Coworkany-owned execution contract
- [x] Start consuming planned deliverables in artifact contract generation
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Add/extend sidecar control-plane tests
- [x] Run focused analyzer/runtime test suite
- [x] Fix regressions
- [x] Add first-class planner/collaboration event coverage
- [x] Run focused desktop reducer/type verification
- **Status:** complete

### Phase 5: Delivery
- [x] Summarize product-level behavior changes
- [x] Call out remaining runtime/UI follow-up work
- [x] Deliver verification evidence
- **Status:** complete

## Key Questions
1. What is the smallest execution-contract schema that changes behavior without forcing a runtime rewrite?
2. Which missing-info cases are safe to default vs must block execution?
3. How can current tests be extended without destabilizing unrelated planner behavior?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Start with schema + analyzer before runtime/UI | This is the narrowest slice that enforces the product role boundary. |
| Keep suspend/resume as the existing runtime primitive | The planner should describe collaboration, not invent a second pause system. |
| Add contract fields additively | Existing stored work requests and scheduled tasks need forward compatibility. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Planner misclassified content summarization as workspace change | 1 | Restricted workspace-change deliverables to explicit host-folder workflows requiring host access. |
| Planner misclassified “实现方案” as code change | 1 | Added narrower code-change heuristic and defaulted complex planning tasks to report deliverables. |
| Planner-event rollout broke lightweight runtime test doubles | 1 | Relaxed plan-summary helper inputs and updated runtime-command expectations to include `TASK_PLAN_READY`. |

## Notes
- Planner contract should remain serializable and persistence-safe.
- Do not require users to specify deliverables/checkpoints up front; infer/default them where safe.

## 2026-03-21 Deep Research Control Plane Hardening

### Goal
Close the highest-risk gaps between the deep-research control-plane design and the current implementation so the feature is safe for a small beta rollout.

### Phases
- Discovery and gap review: complete
- Reopen/refreeze correctness: complete
- Desktop observability and persistence: complete
- Verification and release assessment: in_progress

### Decisions
- Treat `artifact contract unmet` as the first formal reopen trigger and auto-refreeze path, but cap automatic retries to one attempt.
- Stop auto-resume after refreeze if the new frozen contract contains blocking clarification or manual collaboration.
- Surface research progress and contract reopen state in desktop session state and persist those events with high priority.
- Reuse one execution-failure classifier and one reopen/refreeze helper across artifact failures, deterministic local workflows, and generic agent-loop exceptions so trigger handling stays consistent.
- When the user gives an explicit output path, freeze that exact path into the contract instead of inventing a default artifact location or extension.
- Treat materially different follow-up messages as formal contract-reopen signals, and rebuild the artifact contract instead of reusing stale validation from the previous scope.
- Keep desktop session state overwrite-oriented after reopen: the new plan, new deliverables, and new blocker must replace the previous contract rather than accumulating stale state.
- Prefer pure-function UI regressions over brittle render-heavy tests when validating timeline semantics; the important beta invariant is event ordering and visible content, not DOM structure.
- Persist only a minimal frozen-contract snapshot in task session config for follow-up reopen detection; storing the whole frozen request would duplicate too much planner state and make persistence harder to evolve.
- External research adapters need explicit latency budgets during contract freeze; slow web/community lookups should degrade into evidence + risk, not block the control plane indefinitely.
- Non-running task sessions still need durable control-plane context across sidecar restarts; otherwise follow-up correction after finish/idle regresses back to stateless chat.
- Persisted follow-up context needs retention control; keeping finished/failed sessions forever would trade correctness for unbounded local growth.
- Clarification must become the sole active blocker in desktop session state; otherwise reopened tasks can show stale manual-action cards alongside fresh clarification questions.
- Correction-style follow-ups must preserve the prior frozen task context during analysis, and clarification heuristics must not treat normal phrases like `save it to ...` as ambiguous scope.

### Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Auto-refreeze retry test expected only the second artifact path, but execution session merges artifacts across attempts | 1 | Updated the assertion to reflect merged artifact history. |
| Auto-refreeze retry test expected an in-progress execution snapshot, but final `PLAN_UPDATED` reflected presentation phase | 1 | Updated the test to assert the final emitted plan state instead of the intermediate retry state. |
| Generic agent-loop exceptions still bypassed contract reopen and went straight to `TASK_FAILED` | 1 | Routed catch-path permission and missing-resource failures through the same reopen/refreeze helper already used by deterministic workflows. |
| Explicit output-path requests inside dotted directories were truncated at the first dotted segment (for example `.coworkany`) and still failed artifact validation | 1 | Switched explicit-path extraction from shortest-match to full path matching and added regression coverage plus a GUI smoke rerun. |
| Follow-up scope changes still reused the old artifact contract, so a reopened plan could be validated against obsolete deliverables | 1 | Added follow-up reopen detection and forced artifact-contract rebuild whenever the task scope or corrected evidence materially changed. |
| Desktop tests did not cover the reopen sequence `TASK_CONTRACT_REOPENED -> TASK_RESEARCH_UPDATED -> TASK_PLAN_READY -> TASK_USER_ACTION_REQUIRED`, leaving stale-plan regressions invisible | 1 | Added reducer and hydration regressions that verify the replanned contract replaces the previous one after reopen. |
| Timeline had no regression for the reopen sequence, so system-event ordering could regress without breaking state tests | 1 | Exported a pure timeline builder and added sequence-based assertions for reopen/research/plan/blocker rendering. |
| Follow-up reopen still failed once `activePreparedWorkRequest` had been cleared after idle/finish, because comparison depended on in-memory prepared state only | 1 | Stored a minimal frozen-contract snapshot in `TaskSessionConfig` and taught follow-up analysis to fall back to that snapshot when no active prepared request exists. |
| Attempting a GUI-level reopen smoke exposed that pre-freeze web research can stall badly on unauthenticated SearXNG fallback, making the smoke flaky for the wrong reason | 1 | Dropped the flaky GUI smoke and logged web-fallback latency as a separate beta-hardening item instead of baking the instability into CI. |
| Pre-freeze web research had no independent timeout budget, so external search fallback latency could block contract freeze for tens of seconds | 1 | Added resolver-level research timeouts and verified that slow web research now degrades into failed evidence plus `knownRisks` while the contract still freezes promptly. |
| Finished or idle tasks lost reopen context after sidecar restart because runtime persistence only kept running/suspended/interrupted records and deleted finished/failed ones entirely | 1 | Extended persisted runtime status to keep `idle`/`finished`/`failed` session context, hydrate those records without restart-failure handling, and sync `TASK_STATUS: idle` into the runtime record instead of leaving it as stale `running`. |
| Keeping finished/failed task sessions forever would eventually bloat the runtime store and slow persistence/reload | 1 | Added pruning for the oldest archived terminal records while preserving active and blocked sessions, so restart-safe follow-up context stays bounded. |
| Desktop reducer kept stale `currentUserAction` and `currentCheckpoint` after `TASK_CLARIFICATION_REQUIRED`, so reopened tasks could show an old manual-action card and new clarification questions at the same time | 1 | Made clarification the sole active blocker by clearing stale checkpoint/action state and added a reducer regression for the mixed reopen sequence. |
| Restart follow-up correction still triggered `task_scope` clarification because follow-up analysis dropped the original objective, then the ambiguity heuristic treated normal phrases like `save it to ...` as scope-free pronouns | 1 | Merged corrective follow-ups with the prior frozen request context, narrowed ambiguity detection to truly reference-only prompts, expanded explicit-path extraction to cover `save it to`, and upgraded the cross-process smoke to assert no clarification is emitted. |

## 2026-03-20 Marketplace Skill Install Follow-Up

### Goal
Enable chat-driven installation for CoworkAny-supported skill marketplace sources, including Skillhub and GitHub, and return install/enable status plus usage guidance without unnecessary clarification.

### Phases
- Discovery: complete
- Structure: complete
- Implementation: complete
- Verification: complete
- Delivery: complete

### Decisions
- Add marketplace-aware self-management tools instead of relying on the existing local-folder install tool.
- Add a deterministic execution fast path so explicit marketplace install requests do not depend on model reasoning alone.
- Treat current supported marketplace skill sources as Skillhub keyword/slug installs plus GitHub repository installs.

## 2026-03-21 Control-Plane Eval Harness

### Goal
Implement the first commercial-grade control-plane eval harness so Coworkany can replay gold cases against the real planner/freeze/artifact pipeline and measure stage-level quality instead of relying on ad hoc unit tests.

### Phases
- Discovery and scope cut: complete
- Harness schema and runner: complete
- Seed dataset and focused regressions: complete
- Verification and delivery: complete

### Decisions
- Reuse the production control-plane path (`analyzeWorkRequest` -> `runPreFreezeResearchLoop` -> `freezeWorkRequest` -> `buildExecutionPlan` -> `buildArtifactContract/evaluateArtifactContract`) instead of building a separate eval-only planner.
- Keep the first harness deterministic and file-backed: JSONL cases in-repo, optional stubbed research resolver responses, and stage-specific expectations.
- Measure per-stage outcomes directly from structured planner state. Do not introduce an LLM judge in the first slice.
- Start with the highest-signal metrics needed for P0:
  - clarification rate
  - unnecessary clarification rate
  - contract freeze expectation pass rate
  - artifact satisfaction pass rate
- Extend the same case schema with a `runtimeReplay` stage instead of creating a second replay framework. Runtime replay should drive a real sidecar process, validate emitted protocol events, and assert reopen/refreeze behavior through the same suite summary.
- Support both live replay and saved event-log replay inside `runtimeReplay`; recorded production traces should be consumable without changing the stage expectation model.
- Treat the eval JSON summary as a release artifact and wire it into `release-readiness` instead of inventing a separate readiness-specific scoring path.
- Add a log-to-case importer so `production_replay` coverage can scale from real event logs without hand-authoring JSONL.
- Make importer output operational: support dataset upsert/deduplication by case id.
- Turn control-plane metrics into explicit readiness thresholds so rollout gating uses the eval summary rather than just displaying it.
- Move control-plane readiness thresholds into a repo config file and load them from the release gate entrypoint so policy changes do not require code edits.
- Extend threshold config to release-stage profiles (`canary`, `beta`, `ga`) so commercialization gates stay unified while rollout strictness changes by cohort.
- Add production replay source labels plus per-source minimum sample-count gates so readiness cannot pass on a single unlabeled replay trace.
- Add batch event-log ingestion tooling so canary/beta production replay coverage can be expanded from directories of saved traces instead of one-off imports.
- Add a one-shot production replay sync entrypoint that ingests rollout source folders into `production-replay.jsonl` and emits a machine-readable import report.
- Wire optional production replay sync into release-readiness so the release artifact can include both replay import evidence and eval/gate results from the same run.
- When readiness sync uses explicit replay roots or a temporary dataset override, pass the synced dataset into the eval stage as an explicit input and keep sync runs side-effect-safe for the repo dataset.
- Turn replay import evidence into explicit threshold-raise recommendations so beta/ga coverage policy can tighten from the same readiness artifact instead of a separate manual review.
- Emit a machine-readable threshold-update suggestion artifact from release-readiness so governance can promote replay minimums without manually extracting values from markdown.
- Add a separate apply step for threshold suggestions so replay evidence can be promoted into config with an explicit, auditable action instead of hidden report-side effects.
- Have release-readiness emit a ready-to-review candidate threshold config alongside the suggestion artifact so governance can inspect the full resulting policy before any in-place apply.
- Start Workstream 6 with a first operator-facing `sidecar doctor` preflight command that checks runtime-store integrity, readiness posture, and observability coverage from one entrypoint.
- Add a first incident replay tool that turns a saved runtime event log into a single-case control-plane eval bundle, so operators can locally replay top failure classes from evidence instead of from memory.
- Extend `sidecar doctor` with anomaly detection over saved incident logs and artifact telemetry so repeated reopen, clarification, and degraded-output patterns are surfaced before operators widen rollout.
- Leave reopen replay and dashboard UI as follow-up work once the runner and dataset contract are stable.

### Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| TypeScript treated optional artifact-stage payloads as possibly undefined inside the eval runner. | 1 | Narrowed the artifact stage type to `NonNullable<...>` and kept the callsite guard in `runControlPlaneEvalCase(...)`. |
| `import.meta.main` is not part of the project's TypeScript typing surface. | 1 | Replaced it with an explicit `isMainModule()` helper based on `process.argv[1]` and `import.meta.url`. |
| The runtime replay case exceeded Bun test's default 5-second timeout once it started a real sidecar process. | 1 | Increased the focused eval test timeout to 30 seconds and reduced per-case replay delays in the seed dataset. |

## 2026-03-21 Session / Memory / Tenant Isolation

### Goal
Extend the safe-by-default isolation work into a first productized Workstream 5 slice: formal contract fields, task-session runtime enforcement, and eval/doctor evidence for session, memory, and tenant boundaries.

### Phases
- Discovery and scope cut: complete
- Contract and runtime policy wiring: complete
- Memory/tenant enforcement: complete
- Verification and evidence chain: complete

### Decisions
- Reuse the existing control-plane pattern: analyzer-owned contract fields, task-session config persistence, and runtime registry enforcement keyed by `taskId`.
- Keep session isolation narrow in the first slice: same-task/same-workspace continuity only, no workspace override through follow-up or resume config.
- Treat vault/RAG memory as the primary cross-session isolation surface; keep workspace-local `memory.json` as workspace-scoped storage rather than inventing a second global store migration in this slice.
- Model memory access explicitly by scope (`task`, `workspace`, `user_preference`, `system`) and enforce those scopes at read/write time for vault-backed memory operations.
- Encode tenant safety through workspace and local-user boundaries, with runtime-resolved tenant keys rather than making the analyzer guess local identity values.

### Verification
- `bun x tsc -p sidecar/tsconfig.json --noEmit`
- `bun test sidecar/tests/work-request-control-plane.test.ts sidecar/tests/runtime-commands.test.ts sidecar/tests/mcp-gateway-runtime-isolation.test.ts sidecar/tests/sidecar-doctor.test.ts sidecar/tests/control-plane-incident-replay.test.ts sidecar/tests/release-readiness.test.ts sidecar/tests/control-plane-event-log-importer.test.ts sidecar/tests/control-plane-evals.test.ts sidecar/tests/task-isolation-policy-store.test.ts`
- `bun run sidecar/src/evals/controlPlaneEvalRunner.ts`

## 2026-03-22 Release Gate Alignment (Roadmap v2 Diff Fix)

### Goal
Remove false-negative release blockers while preserving strict commercial gating for real canary evidence runs.

### Phases
- Discovery and failure triage: complete
- Gate policy adjustments: complete
- Test and readiness verification: complete

### Decisions
- `sidecar-doctor` gate strictness in `release-readiness` is now explicit and configurable via `--doctor-required-status`.
- Default doctor strictness now depends on evidence context:
  - no `appDataDir` => require `degraded`
  - explicit `appDataDir` => require `healthy`
- Workspace extension allowlist release gate is now risk-surface-aware:
  - no enabled third-party extension => pass with explanatory note
  - enabled third-party extension => require enforce-mode allowlist coverage for enabled ids
- Missing extension governance store is now treated as:
  - pass when no third-party extension is enabled
  - fail when third-party extensions are enabled

## 2026-03-22 Canary Checklist Evidence Gate

### Goal
Turn release checklist evidence from markdown-only process text into a machine-checkable readiness artifact for small commercial rollout.

### Phases
- Evidence schema and readiness helpers: complete
- CLI and stage wiring: complete
- Template/doc/test updates: complete

### Decisions
- Keep evidence enforcement opt-in for local/dev (`--require-canary-evidence`), but make strict commercial runs enforceable from the same release-readiness entrypoint.
- Default evidence path is `artifacts/release-readiness/canary-evidence.json` when `--canary-evidence` is not specified.
- Required mode fails on:
  - missing evidence file
  - invalid evidence JSON
  - missing evidence for checklist areas
- Optional mode remains non-blocking for missing/incomplete evidence so developers can run fast preflights while still seeing checklist deltas in the report.
