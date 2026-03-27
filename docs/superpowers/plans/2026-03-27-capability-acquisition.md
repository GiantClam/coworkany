# Capability Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class bounded capability-acquisition phase so CoworkAny can distinguish internal capability gaps from real user blockers, emit explicit runtime semantics for that phase, and route missing-capability tasks through self-learning before normal execution resumes.

**Architecture:** Extend the frozen work-request contract with a structured `capabilityPlan`, derive it during analysis using existing planner facts plus self-learning reuse signals, and gate execution on that plan before the main agent loop begins. Reuse the existing self-learning controller as the acquisition engine, but wrap it in runtime policy that emits explicit `capability_gap` progress, blocks unplanned user-input copy, and only escalates to user action for real auth/captcha/permission/policy blockers.

**Tech Stack:** TypeScript, Bun, Zod schemas, sidecar runtime/event bus, desktop reducer/timeline task cards

---

### Task 1: Capability Contract And Types

**Files:**
- Modify: `sidecar/src/orchestration/workRequestSchema.ts`
- Modify: `sidecar/src/protocol/events.ts`
- Modify: `sidecar/src/protocol/canonicalStream.ts`
- Modify: `desktop/src/types/events.ts`
- Test: `sidecar/tests/work-request-control-plane.test.ts`
- Test: `sidecar/tests/canonical-task-stream.test.ts`

- [ ] Add `CapabilityPlan` types to the frozen work-request contract with:
  - `missingCapability`
  - `learningRequired`
  - `canProceedWithoutLearning`
  - `learningScope`
  - `replayStrategy`
  - `sideEffectRisk`
  - `userAssistRequired`
  - `userAssistReason`
  - `boundedLearningBudget`
  - `reasons`
- [ ] Add protocol schema support for `capabilityPlan` on `TASK_PLAN_READY`.
- [ ] Extend runtime event payload schemas and canonical-stream passthrough to carry `blockingReason='capability_gap'` and `activeHardness='multi_step'` where applicable.
- [ ] Add desktop event typings for the new plan shape and blocking reason.
- [ ] Add control-plane/canonical tests that lock the schema and event passthrough.

### Task 2: Analyzer Capability Classification

**Files:**
- Modify: `sidecar/src/orchestration/workRequestAnalyzer.ts`
- Modify: `sidecar/src/orchestration/workRequestPolicy.ts`
- Modify: `sidecar/src/agent/selfLearning/types.ts`
- Modify: `sidecar/src/agent/selfLearning/gapDetector.ts`
- Test: `sidecar/tests/work-request-control-plane.test.ts`
- Test: `sidecar/tests/work-request-policy.test.ts`

- [ ] Add helper logic to build `capabilityPlan` from analyzer facts plus social-publish / browser / auth / review signals.
- [ ] Keep `userAssistRequired=false` for internal capability gaps, and reserve `true` for auth/captcha/permission/policy/ambiguous-goal blockers.
- [ ] Thread `capabilityPlan` into the normalized/frozen work request and into policy derivation.
- [ ] Extend self-learning gap types to include `complexityTier`-style budget inputs where needed, but keep the first slice deterministic and code-derived rather than model-generated.
- [ ] Add tests covering:
  - missing platform capability => `learningRequired=true`, `userAssistRequired=false`
  - explicit auth blocker => `learningRequired=false`, `userAssistRequired=true`
  - direct social publish with existing dedicated tool => `learningRequired=false`

### Task 3: Runtime Capability Gate

**Files:**
- Modify: `sidecar/src/execution/runtime.ts`
- Modify: `sidecar/src/agent/selfLearning/controller.ts`
- Modify: `sidecar/src/handlers/runtime.ts`
- Modify: `sidecar/src/execution/taskEventBus.ts`
- Test: `sidecar/tests/execution-runtime.test.ts`
- Test: `sidecar/tests/runtime-commands.test.ts`

- [ ] Add a pre-execution gate in `runPreparedAgentExecution(...)` that checks `preparedWorkRequest.frozen.capabilityPlan`.
- [ ] When `learningRequired=true`, emit internal capability-gap progress instead of entering the normal agent loop immediately.
- [ ] Add a bounded acquisition entrypoint on `SelfLearningController` that:
  - checks reusable capability first
  - falls back to learning only when reuse is insufficient
  - returns a structured acquisition result
- [ ] In the first slice, resume normal execution only when the acquisition result is reusable/validated and not approval-gated.
- [ ] If the acquisition result indicates auth/captcha/permission/policy, emit the existing user-action path instead of capability-gap progress.
- [ ] Add runtime tests for:
  - capability-gap path emits internal status and does not emit `TASK_USER_ACTION_REQUIRED`
  - auth blocker still emits `TASK_USER_ACTION_REQUIRED`
  - successful reusable capability path resumes execution

### Task 4: Desktop Session Semantics

**Files:**
- Modify: `desktop/src/stores/taskEvents/reducers/taskReducer.ts`
- Modify: `desktop/src/components/Chat/Timeline/components/taskCardViewModel.ts`
- Modify: `desktop/src/components/Chat/Timeline/hooks/timelineShared.ts`
- Test: `desktop/tests/task-reducer-suspension.test.ts`
- Test: `desktop/tests/structured-card-view-models.test.ts`

- [ ] Persist `capabilityPlan` from `TASK_PLAN_READY`.
- [ ] Treat `blockingReason='capability_gap'` as internal status:
  - keep the task active
  - set `activeHardness=multi_step`
  - do not surface input-request copy or input affordances
- [ ] Update task-card copy so capability acquisition reads as internal progress, not a clarification ask.
- [ ] Add reducer/view-model tests that lock the no-user-input behavior.

### Task 5: Verification And Progress Log

**Files:**
- Modify: `progress.md`

- [ ] Run focused sidecar tests:
  - `cd sidecar && bun test tests/work-request-control-plane.test.ts tests/work-request-policy.test.ts tests/runtime-commands.test.ts tests/execution-runtime.test.ts tests/canonical-task-stream.test.ts`
- [ ] Run focused desktop tests:
  - `cd desktop && bun test tests/task-reducer-suspension.test.ts tests/structured-card-view-models.test.ts`
- [ ] Run typechecks:
  - `cd sidecar && bun run typecheck`
  - `cd desktop && ./node_modules/.bin/tsc --noEmit`
- [ ] Record the implemented slice and verification evidence in `progress.md`.
