# Task Plan: Ship a Runnable Multi-Platform Beta

## Goal
Make the desktop beta release runnable after installation by fixing the remaining packaging/runtime blockers, with priority on the packaged sidecar startup path.

## Current Phase
Phase 4

## Phases
### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Plan Packaging Fix
- [x] Confirm why packaged desktop builds fail at runtime
- [x] Identify the current sidecar delivery model
- [x] Decide the safest beta-compatible sidecar packaging strategy
- **Status:** complete

### Phase 3: Implement Sidecar Release Mode
- [x] Add a distributable sidecar artifact or packaged runtime path
- [x] Update desktop runtime to prefer packaged sidecar entry/binary
- [x] Keep dev-mode sidecar workflow intact
- **Status:** complete

### Phase 4: Rebuild & Verify
- [x] Rebuild Windows release bundle
- [x] Run packaged Windows smoke test
- [ ] Re-run CI/release as needed
- **Status:** in_progress

### Phase 5: Delivery
- [x] Summarize verified platform state
- [x] Call out remaining unverified risks
- [x] Deliver next-step recommendation
- **Status:** complete

## Key Questions
1. What is the minimal sidecar packaging approach that makes installed builds runnable without destabilizing dev workflow?
2. Can the current sidecar be shipped as source plus runtime, or must it be compiled/bundled separately first?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Disable Tauri updater runtime until fully configured | Packaged app was panicking at startup because Rust registered updater but config was incomplete |
| Limit Linux beta bundles to `deb` | `appimage` path was the only platform-specific packaging failure in release workflow |
| Use `npx tauri build --target ...` in workflows | `npm run tauri build -- --target ...` was forwarding args incorrectly in practice |
| Ship sidecar as a compiled Bun executable plus bundled `playwright-bridge.cjs` | This removes release builds' dependency on `sidecar/src/main.ts` while keeping the existing dev-mode Bun/tsx workflow intact |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Packaged app panicked on updater plugin initialization | 1 | Removed updater runtime/plugin registration for beta builds |
| Linux release exited 134 during bundling | 1 | Reduced Linux beta bundle targets from `deb+appimage` to `deb` only |
| Packaged app could not locate `sidecar/src/main.ts` | 1 | Replaced release startup path with bundled sidecar executable resources |
| `bundle.resources` initially pointed at the wrong relative `sidecar/dist` path | 1 | Corrected paths to `../../sidecar/dist/...` relative to `desktop/src-tauri/tauri.conf.json` |

## Follow-up Tasks
- [x] Inspect local logs for the incorrect "create skill immediately" behavior
- [x] Confirm whether local skill inventory and marketplace install primitives already exist
- [x] Add a model-visible `resolve_skill_request` tool that enforces local -> market -> create
- [x] Update prompts so skill creation is explicitly the final fallback
- [x] Re-run current sidecar/frontend verification commands

## Follow-up: Skill Prompt Injection Refactor

### Goal
- Replace "inject all enabled skill bodies" with a production-safe `catalog + router + top-k loader` strategy for chat requests.

### Current Phase
- Phase 2

### Phases
#### Phase 1: Discovery & Target Design
- [x] Confirm current skill prompt assembly path in `sidecar/src/main.ts`
- [x] Validate external best-practice direction for progressive disclosure
- [x] Define target behavior for always-on catalog metadata and per-turn body loading
- **Status:** complete

#### Phase 2: Implementation
- [x] Extract skill prompt selection/composition into a testable module
- [x] Inject skill catalog metadata into the system prompt
- [x] Route relevant skills per turn and load only top-k skill bodies
- [x] Preserve explicit user-enabled skills as ranking boosts, not unconditional full-body injection
- **Status:** complete

#### Phase 3: Verification
- [x] Add unit tests for scoring, routing, and prompt composition
- [x] Add/adjust integration regressions for chat request prompt assembly
- [x] Run typecheck and targeted sidecar/desktop tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep skill metadata always-on but make skill bodies just-in-time | Matches Anthropic/OpenAI progressive disclosure guidance and scales better with installed skill growth |
| Preserve explicit `enabledClaudeSkills` as a relevance signal instead of unconditional body injection | Enabled means available/preferred, not always relevant to the current turn |
| Extract prompt logic from `main.ts` into a dedicated module | Makes routing deterministic and directly unit-testable instead of hiding behavior inside the main runtime |

## Follow-up: Permission UI + Scheduled Task Surfacing + Python Install Loop

### Goal
- Bring the permission approval dialog into visual parity with the main desktop theme.
- Surface background scheduled-task outcomes into the active UI session when they complete during another task.
- Stop successful Python package installation commands from being re-executed indefinitely by the main agent loop.

### Current Phase
- Phase 1

### Phases
#### Phase 1: Discovery
- [x] Audit desktop UI styling for the permission approval dialog
- [x] Trace scheduled-task events from sidecar emission to desktop session rendering
- [x] Inspect logs and loop-control code for repeated successful Python install commands
- **Status:** complete

#### Phase 2: Implementation
- [ ] Re-theme the permission approval dialog with shared desktop design tokens
- [ ] Mirror scheduled background task completion/failure into the active session
- [ ] Add loop suppression for repeated successful install commands in the sidecar main loop
- **Status:** in_progress

#### Phase 3: Verification
- [ ] Add regression tests for desktop event mirroring and install-loop suppression
- [ ] Run targeted typechecks and regression suites
- **Status:** pending

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Fix scheduled-task visibility in the event hook rather than auto-switching sessions | Users should keep their current active chat while still seeing background task outcomes |
| Treat repeated successful package-install commands as a loop condition in runtime, not just prompt guidance | Prompt-only guidance is too weak against repeated `run_command` retries after successful installs |

## Follow-up: Scheduled Task Card Commercial Hardening

### Goal
- Make scheduled-task execution results first-class on the task board rather than chat-only mirrors.
- Localize the task-card execution status copy so the UI matches the active app language.
- Show recent execution history per scheduled task and cover both success and failure states in packaged desktop E2E.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Audit the task board data contract and locate where scheduled-task run metadata is persisted
- [x] Identify hardcoded task-card execution labels that bypass desktop i18n
- [x] Inspect the existing packaged desktop E2E to see what it does not yet verify
- **Status:** complete

#### Phase 2: Implementation
- [x] Persist recent scheduled-task run history in the sidecar trigger state
- [x] Extend `get_tasks` and desktop task models to expose recent runs
- [x] Render localized latest-run state and prior execution history directly in task cards
- **Status:** complete

#### Phase 3: Verification
- [x] Extend sidecar regression coverage for recent run aggregation
- [x] Extend packaged desktop E2E to assert both successful and failed scheduled-task cards
- [x] Re-run typecheck, targeted tests, release build, and packaged Playwright E2E
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep the latest run summary prominent and render older runs as a short history list | Gives users the current state immediately without losing nearby operational context |
| Synthesize `recentRuns` from legacy `lastRun*` fields when history is absent | Preserves backward compatibility for existing trigger files while enabling richer UI on new runs |
| Make the packaged desktop E2E locale-agnostic by asserting card structure and state classes instead of English-only labels | Prevents false failures when the app boots under a non-English locale |

## Follow-up: Model-Backed Benchmark Analyzer

### Goal
- Upgrade the skill-creator benchmark analyzer from heuristic-only drafts to model-backed notes generation while keeping the current in-app workflow resilient when no model is configured.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Inspect the current desktop LLM config/profile model and active-profile behavior
- [x] Confirm the official `skill-creator` analyzer prompt shape for benchmark analysis
- [x] Define a safe fallback path when model generation is unavailable or malformed
- **Status:** complete

#### Phase 2: Implementation
- [x] Resolve the active desktop LLM profile into a provider-agnostic request shape
- [x] Add model-backed benchmark note generation with provider-aware response parsing
- [x] Keep heuristic note generation as the automatic fallback path
- [x] Surface draft source/status in the Skill Creator workbench UI
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust regression tests for response parsing and active-profile resolution
- [x] Re-run desktop typecheck, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Reuse the desktop app's active LLM profile instead of inventing a skill-creator-specific model config | Keeps analyzer behavior aligned with the rest of CoworkAny and avoids another settings surface |
| Keep `Generate draft` as a single button that tries model generation first and falls back automatically | Users care about getting a draft, not choosing an internal engine up front |
| Parse both raw JSON arrays and markdown-wrapped/object-wrapped note payloads from providers | Commercial usage needs to tolerate imperfect provider output instead of failing on formatting noise |
| Support Ollama in the analyzer path even though the connection-check UI still skips it | Local-model users should not lose benchmark-analysis capability just because validation coverage lags |

## Follow-up: Benchmark Notes Provenance & Rollback

### Goal
- Make analyzer note saves auditable and reversible by persisting provenance-bearing history entries for each benchmark note save and surfacing recent snapshots in the UI.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Inspect the current benchmark-note save path and identify where overwrite-only behavior loses auditability
- [x] Define the minimum provenance fields worth persisting with each save
- **Status:** complete

#### Phase 2: Implementation
- [x] Append note-save history entries beside each benchmark file
- [x] Include previous notes and generator provenance in each snapshot
- [x] Surface recent snapshots in the Skill Creator workbench with load-into-editor behavior
- **Status:** complete

#### Phase 3: Verification
- [x] Add Rust regression coverage for note history persistence and provenance fields
- [x] Re-run desktop typecheck, cargo fmt, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Store note history in a sibling `benchmark.notes-history.jsonl` file instead of embedding full history into `benchmark.json` | Keeps the official benchmark artifact lean and viewer-compatible while still making history inspectable |
| Capture `previousNotes` on every save instead of only saving the new note set | Gives the UI enough information to explain what changed and enables basic rollback workflows |
| Keep rollback as "load into editor" rather than immediate overwrite | Avoids accidental destructive restoration while still making recovery fast |

## Follow-up: Analyzer Network Hardening & Audit Logs

### Goal
- Make model-backed benchmark analysis production-safe under real network conditions by respecting proxy settings, retrying transient failures, and writing a local audit log for every analyzer invocation.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Verify that current analyzer requests ignore the shared proxy settings
- [x] Confirm that model-backed analysis currently leaves no invocation artifact on disk
- **Status:** complete

#### Phase 2: Implementation
- [x] Reuse desktop proxy settings for analyzer HTTP clients with bypass support
- [x] Retry transient request failures for the analyzer path
- [x] Persist analyzer invocation logs with prompt, response, provenance, and fallback details
- [x] Surface the latest analyzer log path in the Skill Creator workbench UI
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust tests for proxy bypass matching and analyzer log creation
- [x] Re-run desktop typecheck, cargo fmt, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Respect the shared desktop proxy config instead of introducing analyzer-specific networking settings | Analyzer traffic should behave like the rest of CoworkAny under enterprise network constraints |
| Use a small bounded retry loop for transient send/HTTP failures instead of open-ended retries | Improves reliability without creating hung analyzer jobs |
| Write one structured JSON log per analyzer invocation under the benchmark workspace | Makes model-backed analysis inspectable without polluting the official benchmark artifacts |

## Follow-up: Analyzer Connectivity Probe

### Goal
- Surface analyzer readiness before note generation so users can verify the active model path proactively instead of inferring failure only after draft generation falls back.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that analyzer readiness is currently only visible indirectly through generation results and logs
- [x] Identify the minimum readiness payload worth surfacing in the workbench
- **Status:** complete

#### Phase 2: Implementation
- [x] Add an analyzer-specific connectivity probe command using the active LLM profile
- [x] Reuse the analyzer networking path so proxy and retry behavior match real note generation
- [x] Render readiness state and manual recheck controls in the Skill Creator workbench
- **Status:** complete

#### Phase 3: Verification
- [x] Re-run desktop typecheck, cargo fmt, and cargo check
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use an analyzer-specific probe instead of reusing generic settings UI state | The workbench needs readiness in the exact context where benchmark analysis happens |
| Keep the probe lightweight (`ping`-style request) but route it through the same client/proxy code as generation | This catches real connectivity issues without paying the cost of a full benchmark-analysis prompt |

## Follow-up: Workspace Analyzer Health State

### Goal
- Persist analyzer readiness/results per benchmark workspace so users see the last known health state when returning to an iteration, instead of starting from an empty in-memory status.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that current analyzer readiness is transient UI state only
- [x] Define the minimum persisted health fields needed for a workspace-level status view
- **Status:** complete

#### Phase 2: Implementation
- [x] Persist analyzer probe/generation health into a workspace-local status file
- [x] Expose a command to load the persisted analyzer status
- [x] Restore and render last-known analyzer health when the benchmark workspace is revisited
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust regression coverage for analyzer status persistence
- [x] Re-run desktop typecheck, cargo fmt, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Store analyzer health as a sibling `.coworkany-analyzer-status.json` file in the benchmark workspace | Keeps readiness state local to the iteration and easy to inspect/share |
| Let both probe and generation update the same health artifact | Users care about the latest analyzer reality, not which UI control produced it |
| Restore persisted health automatically when a benchmark workspace is selected | Makes the workbench feel stateful and operational instead of stateless/debug-oriented |

## Follow-up: Analyzer Health History & Trends

### Goal
- Make analyzer reliability visible over time by persisting health history events and surfacing recent success/failure trends in the Skill Creator workbench.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that a single latest-status file is insufficient for spotting flaky analyzer behavior
- [x] Define the smallest useful trend signal for the workbench
- **Status:** complete

#### Phase 2: Implementation
- [x] Append analyzer status writes to a workspace-local history log
- [x] Expose history loading over IPC
- [x] Render recent analyzer success/failure counts and recent events in the workbench
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust regression coverage for analyzer history ordering
- [x] Re-run desktop typecheck, cargo fmt, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Reuse status writes as the source of truth for history instead of inventing a second event pipeline | Keeps analyzer observability simple and consistent |
| Store health history in JSONL next to the status file | Makes it append-only, easy to inspect, and cheap to read in bounded slices |
| Keep the UI trend summary lightweight (recent success/failure counts plus recent events) | This adds operational signal without turning the workbench into a monitoring dashboard |

## Follow-up: Analyzer Smoke & Reliability Rating

### Goal
- Validate the full benchmark-analysis path with a synthetic smoke run and turn recent analyzer history into a simple operational reliability rating.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that connectivity probes alone do not validate JSON-note parsing on the real analyzer path
- [x] Define a bounded reliability-rating rule set for the workbench
- **Status:** complete

#### Phase 2: Implementation
- [x] Add a synthetic analyzer smoke command that exercises the full analysis request/parse path
- [x] Persist smoke outcomes into the same analyzer health/status history pipeline
- [x] Render a simple reliability rating from recent analyzer events
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust regression coverage for the synthetic smoke fixture
- [x] Re-run desktop typecheck, cargo fmt, cargo check, and targeted cargo tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use a synthetic benchmark fixture for smoke instead of requiring a real workspace run | This validates the full analyzer model path without depending on prior benchmark artifacts |
| Keep smoke separate from the lightweight probe | Probe answers "can I reach the model?", smoke answers "can I complete the analyzer contract?" |
| Derive reliability from the last few analyzer events instead of absolute lifetime history | Recent behavior is more useful than stale success/failure counts in an operational workbench |

## Follow-up: Analyzer Workbench Regression Coverage

### Goal
- Add explicit desktop regression coverage for the skill-creator analyzer workbench so smoke/status/history controls and reliability rules do not silently regress.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Inspect the existing desktop test style for lightweight UI contract checks
- [x] Identify the analyzer workbench logic worth extracting into a testable pure helper
- **Status:** complete

#### Phase 2: Implementation
- [x] Extract analyzer reliability derivation into an exported pure helper
- [x] Add a dedicated desktop test file covering reliability behavior and workbench UI/IPC contracts
- **Status:** complete

#### Phase 3: Verification
- [x] Run the new desktop bun test
- [x] Re-run desktop typecheck and cargo check
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use a lightweight bun test for workbench contracts instead of jumping straight to a full desktop E2E | Keeps regression coverage cheap and fast while still protecting the new analyzer surface |
| Test both pure reliability logic and source-level UI/IPC contracts | This catches both logic regressions and accidental removal of key controls/commands |

## Follow-up: Analyzer Readiness Gate

### Goal
- Turn analyzer observability into a concrete release gate so each benchmark workspace has a clear `Ready / Warning / Blocked` verdict with explicit reasons and recommendations.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that raw status/history signals still leave the user to interpret whether the analyzer is safe to trust
- [x] Define minimum gate rules that are explainable and tied to recent analyzer events
- **Status:** complete

#### Phase 2: Implementation
- [x] Add backend readiness assessment based on recent analyzer history
- [x] Persist readiness assessment as a workspace-local artifact
- [x] Surface readiness verdict, reasons, and recommendations in the workbench UI
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted Rust regression coverage for the readiness rule requiring smoke success
- [x] Re-run desktop typecheck, cargo fmt, cargo check, targeted cargo tests, and the workbench bun test
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Require at least one successful smoke before a workspace can be `Ready` | Connectivity and generation history alone are too weak to trust the full analyzer contract |
| Keep the gate recent-history based and explainable rather than statistical/opaque | Users need a verdict they can understand and act on quickly |
| Persist readiness as its own artifact next to analyzer status/history | This makes the gate auditable and shareable without recomputing it mentally from multiple files |

## Follow-up: Analyzer Live Smoke Acceptance Gate

### Goal
- Add a real-provider, env-gated desktop acceptance path for the analyzer so release validation can exercise the actual Tauri IPC + active-profile + provider request chain instead of only local mocks and unit tests.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that the repo lacks an env-gated analyzer live smoke entrypoint
- [x] Identify the minimum acceptance flow: save profile -> run smoke -> generate notes -> assess readiness
- **Status:** complete

#### Phase 2: Implementation
- [x] Add a dedicated Playwright desktop live-smoke test for the analyzer path
- [x] Support explicit env-gated provider config injection through `save_llm_settings`
- [x] Tighten readiness with failure-budget and staleness rules
- [x] Surface the new readiness budget/staleness data in the workbench UI
- [x] Add a manual GitHub Actions workflow for real-provider analyzer smoke runs
- [x] Persist live-smoke summaries/screenshots and upload them as workflow artifacts
- [x] Centralize live-smoke provider/env validation in a reusable preflight script
- [x] Make local live smoke default to the user-configured active provider/model instead of requiring GitHub-stored secrets
- **Status:** complete

#### Phase 3: Verification
- [x] Re-run desktop typecheck, cargo fmt, cargo check, targeted cargo tests, and workbench bun tests
- [x] Verify Playwright discovers the new live smoke test entrypoint
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep the real-provider smoke opt-in via env vars and a separate npm script | This avoids accidental CI spend while still creating a repeatable release gate |
| Exercise the path through Tauri IPC rather than a standalone Node HTTP script | The desktop runtime wiring is part of the product surface and needs to be validated directly |
| Treat stale smoke and exhausted recent failure budget as readiness concerns, not just informational telemetry | A commercial release gate needs explicit stop/go criteria, not only raw observability |

## Follow-up: Chat Execution Reliability & Readability

### Goal
- Fix repetitive task-status chatter, make timeline bubbles easier to read, auto-continue interrupted tasks after model reconnection, and ensure real task results are surfaced instead of generic or missing completion states.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Inspect the latest desktop/sidecar logs for duplicate status chatter, transport retries, and missing terminal task events
- [x] Trace chat/timeline rendering against task-event reducers and sidecar task command handlers
- **Status:** complete

#### Phase 2: Implementation
- [x] Remove duplicate event-to-message mirroring in the desktop task-event reducers
- [x] Collapse consecutive identical tool calls in the timeline and improve system/message bubble readability
- [x] Stop double-appending follow-up user messages in `send_task_message`
- [x] Unify `start_task` and `send_task_message` completion handling so both emit real final results
- [x] Auto-resume interrupted tasks after model connectivity recovers
- [x] Emit actionable failure when a task exhausts its reasoning loop without producing a result
- **Status:** complete

#### Phase 3: Verification
- [x] Add targeted sidecar and desktop regression tests for task outcome extraction and timeline aggregation
- [x] Re-run sidecar and desktop typecheck plus the targeted bun suites
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Treat task-event reducers as state updaters, not a second message feed | The timeline already renders from `session.events`; mirroring tool/effect/patch/task failures into `session.messages` created redundant chatter |
| Resume interrupted tasks with a guarded follow-up instruction when model connectivity returns | This preserves the existing conversation/tool context and is lower-risk than trying to reattach a dead stream mid-request |
| Use the latest assistant output as the terminal task summary when available | Generic `Task completed` summaries hide the real result and make failures look like successes |
| Fail explicitly on max-step exhaustion | The latest logs showed a tool-call loop with no `TASK_FINISHED`/`TASK_FAILED`, which is worse than returning a clear recoverable failure |

## Follow-up: Recoverable Task Snapshot Resume

### Goal
- Promote task recovery from a frontend-only reconnect trick to a workspace-backed recovery path that can survive sidecar restarts and automatically resume interrupted tasks from saved conversation/config snapshots.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm that recoverable transport failures were only resumable while the original sidecar process remained alive
- [x] Identify the minimum durable state needed to resume a task: config, conversation, workspace path, runtime status, and latest error/summary metadata
- **Status:** complete

#### Phase 2: Implementation
- [x] Persist per-task runtime snapshots under each workspace `.coworkany/runtime/tasks`
- [x] Refresh a terminal watchdog whenever a running task emits progress so stalled tasks become explicit recoverable failures
- [x] Add a `resume_recoverable_tasks` sidecar command that scans recent recoverable snapshots and resumes them in the background
- [x] Restore conversation/config/runtime state from snapshot before injecting a guarded continuation turn
- [x] Trigger snapshot recovery on desktop startup as well as explicit `sidecar-reconnected` events
- **Status:** complete

#### Phase 3: Verification
- [x] Re-run sidecar typecheck, desktop typecheck, cargo check, and targeted desktop/sidecar bun suites
- [x] Add a regression assertion that startup and reconnect both route through recoverable-task resume
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Store snapshots per workspace instead of in one global sidecar cache | Recovery needs to follow the task's project context and stay inspectable alongside other workspace state |
| Treat recent `running` snapshots as recoverable even without an explicit failure marker | A sidecar crash can prevent the failure event from ever being emitted, so relying only on `recoverable_interrupted` would miss real interruptions |
| Resume on startup and reconnect | Desktop reconnect events are not the only path back to a healthy state; cold-starting the app after a crash must also recover pending tasks |
| Filter desktop recovery hints down to valid UUID task sessions | Session history includes `scheduled_*` entries; sending them through the IPC command invalidated the entire `resume_recoverable_tasks` request |
| Keep sidecar recovery tolerant of dirty payloads | The recovery command should skip invalid task IDs rather than reject the whole message, otherwise one stale session breaks task resumption for every valid task |
| Only auto-resume fresh, current tasks | Packaged E2E showed that resuming all historic interrupted sessions creates cross-task noise and can restart stale work the user did not ask to continue |
| Hydrate sessions before startup recovery | Startup recovery with an empty in-memory session store cannot produce useful hints; hydrate-first preserves cold-start crash recovery |
| Persist task runtime diagnostics alongside workspace snapshots | Recovery and missing-result bugs need an inspectable, durable trail outside ephemeral desktop/sidecar log files |
| Surface diagnostics in the task panel via Tauri IPC instead of expanding the task-event protocol again | This keeps the real-time event model stable while still giving users and tests direct access to recovery/failure/completion evidence |

## Follow-up: Task Terminal Watchdog Acceptance

### Goal
- Validate, in packaged desktop builds, that tasks which never emit a terminal result are failed by the sidecar watchdog and surfaced with durable diagnostics.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Runtime Override Design
- [x] Confirm a packaged-safe way to override stall timeout for acceptance without changing the production default
- [x] Avoid relying solely on compiled sidecar `process.env` reads for runtime test overrides
- **Status:** complete

#### Phase 2: Acceptance Implementation
- [x] Forward `COWORKANY_TASK_STALL_TIMEOUT_MS` from desktop to sidecar as an explicit startup arg
- [x] Add a packaged stalled-task E2E that asserts `TASK_TERMINAL_TIMEOUT`, diagnostics UI, and workspace log persistence
- [x] Isolate the packaged acceptance from stale recoverable task artifacts and stalled mock-server teardown hangs
- **Status:** complete

#### Phase 3: Verification
- [x] Rebuild packaged sidecar/desktop artifacts
- [x] Re-run the full packaged recovery + watchdog E2E suite
- [x] Re-run sidecar/desktop typecheck and cargo check
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Pass stall-timeout overrides as a sidecar startup arg | This is more reliable for packaged acceptance than assuming compiled Bun binaries will honor late-bound env reads |
| Keep the production stall timeout unchanged and only override it in acceptance/debug scenarios | Commercial behavior should stay conservative while still allowing fast deterministic tests |
| Assert on workspace diagnostics and task-panel diagnostics, not only raw sidecar logs | The commercial requirement is user-visible and support-visible evidence, not just internal event emission |

## Follow-up: Runtime Failure Dedup + RAG Dependency Preflight

### Goal
- Eliminate duplicate terminal failure noise after watchdog timeouts and stop packaged RAG startup from repeatedly spawning a Python process that immediately crashes on missing dependencies.

### Current Phase
- Phase 3

### Phases
#### Phase 1: Discovery
- [x] Confirm from packaged logs that stalled-task flows still emitted a second `MODEL_STREAM_ERROR` after `TASK_TERMINAL_TIMEOUT`
- [x] Confirm from desktop logs that RAG startup was still launching `rag-service/main.py` directly and crashing on missing `fastapi`
- **Status:** complete

#### Phase 2: Implementation
- [x] Add shared task-failure guard helpers and enforce duplicate `TASK_FAILED` suppression at the unified sidecar emit boundary
- [x] Deduplicate failure-side post-learning analysis so one failed task is analyzed once
- [x] Add Python dependency preflight for the RAG service based on `rag-service/requirements.txt`
- [x] Surface failed RAG preflight as service status `failed` with a useful `last_error` instead of a bare stopped state
- [x] Stabilize the packaged recovery/watchdog Playwright suite so recovery does not inherit an unrealistically aggressive global 5s watchdog
- **Status:** complete

#### Phase 3: Verification
- [x] Re-run sidecar typecheck and targeted sidecar tests
- [x] Re-run cargo fmt, cargo check, and targeted Rust unit tests for RAG dependency mapping/error messaging
- [x] Rebuild packaged sidecar/desktop artifacts and rerun the packaged recovery + watchdog Playwright suite
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Enforce duplicate terminal-failure suppression inside `emit()` itself | Guarding only some call sites is too weak; the unified event emitter is the only reliable choke point |
| Keep the watchdog failure as the canonical terminal artifact for stalled tasks | `TASK_TERMINAL_TIMEOUT` is the user-meaningful failure; later transport closure is noise |
| Preflight Python imports before spawning RAG | Failing fast with a clear dependency error is better than starting a doomed process and logging traceback spam |
| Derive required Python modules from `rag-service/requirements.txt` with a small package->module mapping | This keeps the probe aligned with declared runtime dependencies without hardcoding the full list twice |
| Increase the packaged E2E watchdog override from 5s to 15s | Recovery acceptance needs enough time to persist a running snapshot before the watchdog intentionally trips |
