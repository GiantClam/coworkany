# Hardness-First Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a hardness-first analysis contract in the sidecar and update desktop timeline/task cards to present collaboration around `primaryHardness` and `activeHardness` instead of legacy planner wording.

**Architecture:** Add a new execution-profile layer to the frozen work-request contract, derive existing checkpoints/user actions from that profile, and keep protocol compatibility by preserving legacy fields. On desktop, store the execution profile in session state, derive `activeHardness` from the current blocker/runtime state, and render task cards around hardness as the primary narrative with capabilities as supporting context.

**Tech Stack:** TypeScript, Bun tests, Zod schemas, React desktop timeline UI

---

### Task 1: Sidecar Execution Profile Contract

**Files:**
- Modify: `sidecar/src/orchestration/workRequestSchema.ts`
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Modify: `sidecar/src/protocol/events.ts`
- Test: `sidecar/tests/work-request-control-plane.test.ts`

- [ ] Add execution-profile types for hardness, required capabilities, blocking risk, interaction mode, and execution shape.
- [ ] Infer `executionProfile` during work-request analysis before checkpoint and user-action generation.
- [ ] Update checkpoint/user-action builders to consume the inferred profile instead of raw ad hoc booleans where possible.
- [ ] Extend the `TASK_PLAN_READY` protocol payload to include `executionProfile`.
- [ ] Add control-plane tests that lock:
  - complex planning => `primaryHardness=multi_step`
  - explicit external auth/manual tasks => `requiredCapabilities` includes `external_auth`
  - code or workspace mutations => `requiredCapabilities` includes write/review capability where applicable

### Task 2: Runtime/Event Payload Bridging

**Files:**
- Modify: `sidecar/src/handlers/runtime.ts`
- Modify: `sidecar/src/protocol/canonicalStream.ts`
- Test: `sidecar/tests/runtime-commands.test.ts`
- Test: `sidecar/tests/canonical-task-stream.test.ts`

- [ ] Pass `executionProfile` through the task-plan-ready payload builder.
- [ ] Include `executionProfile` in canonical task-plan-ready data so canonical timeline synthesis can access it.
- [ ] Add focused protocol/runtime tests that assert the new field is emitted without breaking existing plan/checkpoint/action payloads.

### Task 3: Desktop Session State + Hardness Derivation

**Files:**
- Modify: `desktop/src/types/events.ts`
- Modify: `desktop/src/stores/taskEvents/reducers/taskReducer.ts`
- Test: `desktop/tests/task-reducer-suspension.test.ts`
- Test: `desktop/tests/task-event-store-hydration.test.ts`

- [ ] Add desktop types for the execution profile and session-level `primaryHardness` / `activeHardness`.
- [ ] Persist `executionProfile` from `TASK_PLAN_READY`.
- [ ] Derive `activeHardness` from current blocker and runtime state:
  - external auth/manual block => `externally_blocked`
  - review/confirmation gate => `high_risk`
  - otherwise fall back to primary hardness
- [ ] Add reducer/hydration tests covering plan-ready state plus runtime blocker transitions.

### Task 4: Timeline/Task Card Hardness-First UI

**Files:**
- Modify: `desktop/src/components/Chat/Timeline/hooks/timelineShared.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/legacyTimelineBuilder.ts`
- Modify: `desktop/src/components/Chat/Timeline/components/taskCardViewModel.ts`
- Modify: `desktop/src/components/Chat/Timeline/components/TaskCardMessage.tsx`
- Test: `desktop/tests/structured-card-view-models.test.ts`
- Test: `desktop/tests/timeline-items.test.ts`
- Test: `desktop/tests/task-card-message-interaction.test.tsx`

- [ ] Add shared helpers that convert execution profile + active hardness into card title/subtitle/sections.
- [ ] Populate task cards with hardness metadata on both canonical and legacy fallback paths.
- [ ] Change task-card summary/kicker text to show hardness-first narrative, with capabilities and blocking reason as support text.
- [ ] Preserve existing collaboration controls and tokens; only change the framing and default descriptive copy.
- [ ] Add UI regressions covering:
  - multi-step plan cards
  - external-auth blocked cards
  - action-first auth cards still rendering explicit buttons

### Task 5: Verification

**Files:**
- Modify: `progress.md`

- [ ] Run focused sidecar tests:
  - `bun test sidecar/tests/work-request-control-plane.test.ts sidecar/tests/runtime-commands.test.ts sidecar/tests/canonical-task-stream.test.ts`
- [ ] Run focused desktop tests:
  - `cd desktop && bun test tests/task-reducer-suspension.test.ts tests/task-event-store-hydration.test.ts tests/structured-card-view-models.test.ts tests/timeline-items.test.ts tests/task-card-message-interaction.test.tsx`
- [ ] Run typechecks:
  - `bunx tsc --noEmit --pretty false -p sidecar/tsconfig.json`
  - `bunx tsc --noEmit --pretty false -p desktop/tsconfig.json`
