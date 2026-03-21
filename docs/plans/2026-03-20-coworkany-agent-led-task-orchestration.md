# Coworkany Agent-Led Task Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Coworkany act as the primary task owner: it should decompose, plan, decide deliverables, request user help only when necessary, and drive execution/recovery instead of relying on user-authored execution scripts.

**Architecture:** Extend the control-plane work request model into a real execution contract with deliverables, checkpoints, user collaboration requests, and defaulting rules. Gate task execution on this contract, surface the plan in desktop UI, and route suspend/resume through structured collaboration checkpoints rather than ad hoc tool behavior.

**Tech Stack:** TypeScript, Zod-style runtime schemas already used in sidecar protocol, React desktop UI, Tauri IPC, existing suspend/resume runtime, Playwright desktop tests.

---

### Task 1: Expand the Work Request Schema Into an Execution Contract

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestSchema.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestAnalyzer.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/work-request-analyzer.test.ts`

**Step 1: Add contract fields to the schema**

Add structured planning fields to `NormalizedWorkRequest` and `TaskDefinition`:
- `deliverables`
- `checkpoints`
- `userActionsRequired`
- `missingInfo`
- `assumptions`
- `defaultingPolicy`
- `resumeStrategy`

Keep the first version minimal. Do not add speculative fields for delegation, costing, or multi-user approvals yet.

**Step 2: Add schema-level types for collaboration**

Define small, explicit types:
- `DeliverableContract`
- `CheckpointContract`
- `UserActionRequest`
- `ResumeStrategy`

Make each one serializable and persistence-safe.

**Step 3: Write failing analyzer tests**

Add tests that assert:
- a concrete task gets at least one deliverable
- ambiguous tasks produce `missingInfo` and `questions`
- long-running tasks with external/manual dependencies produce at least one `userActionRequest`
- artifact-producing requests set a concrete artifact deliverable instead of generic `chat_message`

**Step 4: Implement minimal schema changes**

Update the analyzer output so the new fields are present with safe defaults.

**Step 5: Run focused tests**

Run: `bun test sidecar/tests/work-request-analyzer.test.ts`

**Step 6: Commit**

`git add sidecar/src/orchestration/workRequestSchema.ts sidecar/src/orchestration/workRequestAnalyzer.ts sidecar/tests/work-request-analyzer.test.ts && git commit -m "feat: extend work request schema with execution contract"`

### Task 2: Teach the Analyzer to Default, Ask, and Plan Like the Task Owner

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestAnalyzer.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/orchestration/workRequestRuntime.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/work-request-analyzer.test.ts`

**Step 1: Define defaulting rules**

Implement deterministic defaults for:
- output language
- output format
- default artifact folder
- checkpoint requirement
- whether user interaction can be deferred

Only ask the user when the missing value blocks safe execution.

**Step 2: Tighten clarification rules**

Upgrade `buildClarificationDecision` so it distinguishes:
- safe-to-default missing info
- unsafe-to-default blocking info

Blocking examples:
- target account/site/entity
- irreversible destructive scope
- mandatory external dependency not inferable from workspace

**Step 3: Generate explicit deliverables**

For tasks that imply artifacts, infer a concrete deliverable such as:
- report file
- code patch
- presentation deck
- research summary

Do not leave such requests as `chat_message` only.

**Step 4: Generate explicit checkpoints**

Planner should create checkpoints when:
- external/manual action is likely
- long-running work has a natural review boundary
- assumptions materially affect the rest of execution

**Step 5: Update execution prompt generation**

Make `buildWorkRequestExecutionPrompt` include:
- Coworkany is the task owner
- the frozen contract is authoritative
- deliverables
- checkpoints
- what can be defaulted
- when to suspend and ask the user

**Step 6: Run focused tests**

Run: `bun test sidecar/tests/work-request-analyzer.test.ts`

**Step 7: Commit**

`git add sidecar/src/orchestration/workRequestAnalyzer.ts sidecar/src/orchestration/workRequestRuntime.ts sidecar/tests/work-request-analyzer.test.ts && git commit -m "feat: make planner own defaults checkpoints and deliverables"`

### Task 3: Gate Execution on the Contract Instead of Freeform Prompt Following

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/main.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/handlers/runtime.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/runtime-commands.test.ts`

**Step 1: Persist the execution contract**

Ensure the frozen work request with its new contract fields is available through resume/restart paths.

**Step 2: Block execution when blocking info is unresolved**

Before `executeFreshTask` enters the main agent flow, stop on unresolved blocking `missingInfo` and emit a clarification request.

**Step 3: Require artifact contract alignment**

Replace the current loose artifact contract generation with one that derives from planner deliverables when available.

**Step 4: Route resume through the contract**

When `resume_interrupted_task` runs, ensure the restored plan still drives:
- next checkpoint
- remaining deliverables
- pending user actions

**Step 5: Add runtime tests**

Test these cases:
- missing blocking info returns clarification and does not execute
- resumed task keeps deliverables/checkpoints
- artifact-producing task preserves planned deliverable after resume

**Step 6: Run focused tests**

Run: `bun test sidecar/tests/runtime-commands.test.ts`

**Step 7: Commit**

`git add sidecar/src/main.ts sidecar/src/handlers/runtime.ts sidecar/tests/runtime-commands.test.ts && git commit -m "feat: gate runtime execution on planner contract"`

### Task 4: Make Collaboration a First-Class Runtime Concept

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/protocol/events.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/execution/taskEventBus.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/handlers/runtime.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/runtime-commands.test.ts`

**Step 1: Add collaboration events**

Introduce events for:
- `TASK_PLAN_READY`
- `TASK_CHECKPOINT_REACHED`
- `TASK_USER_ACTION_REQUIRED`

Keep them additive so existing clients still work.

**Step 2: Emit events from planner/runtime**

Emit:
- `TASK_PLAN_READY` after planning/freeze
- `TASK_CHECKPOINT_REACHED` when runtime stops at a planned checkpoint
- `TASK_USER_ACTION_REQUIRED` when runtime needs manual help

**Step 3: Keep suspend/resume integrated**

Map manual-action checkpoints to existing suspend/resume infrastructure rather than inventing a second pause system.

**Step 4: Add tests**

Assert that planned collaboration emits the right events before execution resumes.

**Step 5: Run focused tests**

Run: `bun test sidecar/tests/runtime-commands.test.ts`

**Step 6: Commit**

`git add sidecar/src/protocol/events.ts sidecar/src/execution/taskEventBus.ts sidecar/src/handlers/runtime.ts sidecar/tests/runtime-commands.test.ts && git commit -m "feat: add first-class collaboration events"`

### Task 5: Surface the Coworkany Plan in Desktop UI

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/types/events.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/stores/taskEvents/reducers/taskReducer.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/stores/taskEvents/index.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/ChatInterface.tsx`
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/Timeline.tsx`
- Add or Modify: a small plan/checkpoint UI component under `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/`
- Test: `/Users/beihuang/Documents/github/coworkany/desktop/tests/interrupted-task-resume-e2e.test.ts`

**Step 1: Add desktop event types**

Extend task event typing for the new planning/collaboration events.

**Step 2: Store plan state**

Persist in the reducer:
- planned deliverables
- current checkpoint
- pending user action request

**Step 3: Render a plan summary**

Show a compact banner or panel:
- what Coworkany plans to produce
- current phase
- what it needs from the user, if anything

This should make the role boundary explicit: Coworkany leads, user assists.

**Step 4: Keep recovery UI coherent**

If a task is interrupted, the resume banner should reference the active checkpoint/user action rather than generic text only.

**Step 5: Add UI tests**

Extend browser-based desktop tests to assert:
- planned deliverables are shown
- checkpoint banner is shown
- user-action-required state is shown

**Step 6: Run focused tests**

Run: `npx playwright test desktop/tests/interrupted-task-resume-e2e.test.ts`

**Step 7: Commit**

`git add desktop/src/types/events.ts desktop/src/stores/taskEvents/reducers/taskReducer.ts desktop/src/stores/taskEvents/index.ts desktop/src/components/Chat desktop/tests/interrupted-task-resume-e2e.test.ts && git commit -m "feat: show agent-led task plan and checkpoints in desktop UI"`

### Task 6: Add a Real Manual Long-Task Template for Human QA

**Files:**
- Add: `/Users/beihuang/Documents/github/coworkany/docs/manual-testing/long-task-agent-led.md`
- Add: `/Users/beihuang/Documents/github/coworkany/desktop/tests/fixtures/manual-long-task/` (seed files)
- Optionally add: `/Users/beihuang/Documents/github/coworkany/desktop/tests/manual-long-task-smoke.test.ts`

**Step 1: Create a human-test task template**

Document one canonical manual task that exercises:
- planning
- deliverables
- checkpoint
- user assist
- interruption
- resume
- final artifact

**Step 2: Add deterministic fixture inputs**

Provide a small workspace fixture so QA can run the same long task repeatedly.

**Step 3: Optionally add a smoke**

If useful, add a non-native smoke that seeds this fixture and verifies plan/checkpoint events, without trying to validate the whole LLM result.

**Step 4: Run targeted validation**

Run whichever test you add, or validate the manual script for correctness.

**Step 5: Commit**

`git add docs/manual-testing/long-task-agent-led.md desktop/tests/fixtures/manual-long-task && git commit -m "docs: add manual long-task QA scenario"`

### Task 7: End-to-End Verification

**Files:**
- No new files required

**Step 1: Run sidecar analyzer/runtime tests**

Run: `bun test sidecar/tests/work-request-analyzer.test.ts sidecar/tests/runtime-commands.test.ts`

**Step 2: Run sidecar typecheck**

Run: `cd /Users/beihuang/Documents/github/coworkany/sidecar && bun run typecheck`

**Step 3: Run desktop typecheck**

Run: `cd /Users/beihuang/Documents/github/coworkany/desktop && npx tsc --noEmit`

**Step 4: Run desktop browser recovery tests**

Run: `cd /Users/beihuang/Documents/github/coworkany/desktop && npx playwright test tests/interrupted-task-resume-e2e.test.ts tests/interrupted-task-resume-sidecar-smoke.test.ts`

**Step 5: Run native macOS regression when on macOS GUI**

Run: `cd /Users/beihuang/Documents/github/coworkany/desktop && npx playwright test tests/interrupted-task-resume-native-shell-mac.test.ts`

**Step 6: Re-read requirements**

Verify the implementation now supports:
- Coworkany-led planning
- structured deliverables
- planner-owned checkpoints
- planner-owned user assistance requests
- resume preserving the contract

**Step 7: Final commit**

`git status && git add -A && git commit -m "feat: make coworkany the primary long-task orchestrator"`
