# Task-Centered Card Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate task lifecycle signals into a single task card with multi-task visibility (sequential/parallel), collaboration controls, and result delivery to reduce timeline noise.

**Architecture:** Extend sidecar task event payloads to expose task graph and per-task progress, then reshape desktop timeline projection to aggregate task-related events into one `task_card` model. Render interactive collaboration controls directly in the card and route user responses through existing `send_task_message` flow.

**Tech Stack:** TypeScript, React, Zustand, Sidecar runtime event bus, Tauri IPC

---

### Task 1: Extend Sidecar event payload contracts

**Files:**
- Modify: `sidecar/src/orchestration/workRequestRuntime.ts`
- Modify: `sidecar/src/handlers/runtime.ts`
- Modify: `sidecar/src/execution/taskEventBus.ts`
- Modify: `sidecar/src/protocol/events.ts`

**Steps:**
1. Add `tasks` to `TASK_PLAN_READY` payload type and include dependencies/objective metadata.
2. Add `taskProgress` to `PLAN_UPDATED` payload type based on execution steps (`kind === execution`).
3. Update runtime payload builders to emit the new fields.
4. Update protocol zod schema to accept optional new fields.

### Task 2: Extend desktop types for task-centered card

**Files:**
- Modify: `desktop/src/types/events.ts`

**Steps:**
1. Add typed structures for task graph rows, collaboration metadata, and result metadata on `TaskCardItem`.
2. Add optional `tasks` and `taskProgress` on corresponding event payload interfaces.

### Task 3: Refactor timeline projection to single task center card

**Files:**
- Modify: `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`

**Steps:**
1. Add card upsert helpers for append/replace section strategies.
2. Aggregate task lifecycle/tool/effect/patch/system statuses into one `task_card` item.
3. Keep user messages visible while routing task progress/result into card sections.
4. Build workflow mode inference (`single/sequential/parallel/dag`) and task status syncing from `taskProgress`.
5. Add collaboration state generation for `TASK_USER_ACTION_REQUIRED` and `TASK_CLARIFICATION_REQUIRED`.

### Task 4: Add task card UI for multi-task and collaboration controls

**Files:**
- Modify: `desktop/src/components/Chat/Timeline/components/TaskCardMessage.tsx`
- Modify: `desktop/src/components/Chat/Timeline/Timeline.tsx`
- Modify: `desktop/src/components/Chat/Timeline/Timeline.module.css`
- Modify: `desktop/src/components/Chat/ChatInterface.tsx`

**Steps:**
1. Render task list with dependency/status chips.
2. Render collaboration action/button + optional input box.
3. Wire card interactions to existing message transport (`sendMessage`) via `ChatInterface` callback.
4. Preserve existing resume card behavior.

### Task 5: Update tests and verify behavior

**Files:**
- Modify: `desktop/tests/timeline-items.test.ts`

**Steps:**
1. Update expected card title/sections for task-centered aggregation.
2. Add multi-task workflow expectation and collaboration metadata assertions.
3. Run targeted desktop tests and fix regressions.
