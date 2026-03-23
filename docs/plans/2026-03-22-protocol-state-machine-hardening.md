# Protocol State Machine Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a universal execution protocol state machine that guarantees `completed` and `user_action_required` are mutually exclusive and blocks invalid lifecycle transitions.

**Architecture:** Add a dedicated reducer-style protocol state machine in `execution`, then enforce transitions centrally from `TaskEventBus.build()` so all event construction paths (including `createTask*Event` helpers) inherit the same guardrails. Add a typed evidence object schema in the same module to standardize future evidence collection and validation.

**Tech Stack:** TypeScript, Bun tests, existing Sidecar event protocol (`TaskEventBus`), Zod for schema typing.

---

### Task 1: Create protocol state machine core

**Files:**
- Create: `sidecar/src/execution/protocolStateMachine.ts`
- Test: `sidecar/tests/task-event-bus.test.ts`

**Step 1: Add lifecycle states and error codes**
- Define `ProtocolTaskState` and `ProtocolErrorCode` enums/unions.
- Include terminal conflict code for completed/user-action overlap.

**Step 2: Add evidence object schema**
- Define `ExecutionEvidenceRecordSchema` (Zod) and exported inferred type.
- Include fields for source, grounding level, claims, confidence, and timestamps.

**Step 3: Implement reducer**
- Add `reduceTaskProtocolState(snapshot, { type, payload })`.
- Return either `nextSnapshot` or `violation` with machine-readable error code.

**Step 4: Implement transition guards**
- Forbid `TASK_FINISHED` when pending blocking user action exists.
- Forbid `TASK_USER_ACTION_REQUIRED` after terminal completion.
- Maintain `stateVersion` and `pendingBlockingUserActions` counters.

### Task 2: Integrate state machine into TaskEventBus

**Files:**
- Modify: `sidecar/src/execution/taskEventBus.ts`
- Test: `sidecar/tests/task-event-bus.test.ts`

**Step 1: Add per-task protocol snapshot map**
- Initialize/reset snapshots together with sequence resets.

**Step 2: Gate event construction in `build()`**
- Run reducer before constructing event output.
- On violation: emit `TASK_FAILED` payload (protocol code + message) instead of invalid target event.

**Step 3: Preserve compatibility**
- Keep sequence behavior unchanged for existing tests.
- Do not alter external `TaskEvent` envelope schema.

### Task 3: Add regression tests

**Files:**
- Modify: `sidecar/tests/task-event-bus.test.ts`

**Step 1: Add terminal conflict test**
- Emit blocking `TASK_USER_ACTION_REQUIRED`, then emit `TASK_FINISHED`.
- Assert second event is rewritten to `TASK_FAILED` with protocol error code.

**Step 2: Add completed-after-user-action-resolution test**
- Emit blocking action, then `TASK_STATUS running`, then `TASK_FINISHED`.
- Assert finished is allowed.

**Step 3: Add reverse conflict test**
- Emit `TASK_FINISHED`, then blocking `TASK_USER_ACTION_REQUIRED`.
- Assert second event is rewritten to `TASK_FAILED`.

### Task 4: Verification

**Files:**
- Test: `sidecar/tests/task-event-bus.test.ts`
- Test: `sidecar/tests/execution-runtime.test.ts`

**Step 1: Run focused tests**
Run: `cd sidecar && bun test tests/task-event-bus.test.ts tests/execution-runtime.test.ts`
Expected: all pass

**Step 2: Run type checks**
Run: `cd sidecar && npm run typecheck`
Expected: `tsc --noEmit` success
