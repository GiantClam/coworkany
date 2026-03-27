# Canonical Task Stream Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a transport-agnostic canonical task stream beside the current `TaskEvent` protocol so desktop can start consuming unified message parts without changing the existing timeline UI.

**Architecture:** Keep the current `TaskEvent` pipeline as the production UI source of truth. Add a parallel canonical message-part protocol in `sidecar/src/protocol`, mirror selected `TaskEvent`s to canonical stream envelopes in `sidecar/src/main.ts`, forward them through Rust/Tauri as a separate event channel, and parse them into a new desktop shadow store for later UI migration.

**Tech Stack:** TypeScript, Bun, Zod, React, Zustand, Tauri Rust bridge, existing CoworkAny sidecar protocol.

---

### Task 1: Define canonical protocol types

**Files:**
- Create: `/Users/beihuang/Documents/github/coworkany/sidecar/src/protocol/canonicalStream.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/protocol/index.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/canonical-task-stream.test.ts`

### Task 2: Mirror task events to canonical stream in sidecar

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/sidecar/src/main.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/canonical-task-stream.test.ts`

### Task 3: Forward canonical stream through Rust/Tauri

**Files:**
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src-tauri/src/sidecar.rs`

### Task 4: Add desktop canonical shadow parser/store

**Files:**
- Create: `/Users/beihuang/Documents/github/coworkany/desktop/src/bridges/canonicalTaskStream.ts`
- Create: `/Users/beihuang/Documents/github/coworkany/desktop/src/stores/useCanonicalTaskStreamStore.ts`
- Modify: `/Users/beihuang/Documents/github/coworkany/desktop/src/hooks/useTauriEvents.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/desktop/tests/canonical-task-stream.test.ts`

### Task 5: Verify focused protocol round-trip coverage

**Files:**
- Test: `/Users/beihuang/Documents/github/coworkany/sidecar/tests/canonical-task-stream.test.ts`
- Test: `/Users/beihuang/Documents/github/coworkany/desktop/tests/canonical-task-stream.test.ts`

**Verification commands:**
- `cd /Users/beihuang/Documents/github/coworkany/sidecar && bun test tests/canonical-task-stream.test.ts tests/task-event-bus.test.ts`
- `cd /Users/beihuang/Documents/github/coworkany/desktop && bun test tests/canonical-task-stream.test.ts tests/timeline-items.test.ts`
- `cd /Users/beihuang/Documents/github/coworkany/sidecar && bun x tsc -p tsconfig.json --noEmit`
- `cd /Users/beihuang/Documents/github/coworkany/desktop && bun x tsc -p tsconfig.json --noEmit`

---

## Phase 2 Follow-on

**Completed follow-on slice:** desktop timeline rendering now prefers canonical messages for `chat`, `immediate_task`, `scheduled_task`, and `scheduled_multi_task` sessions when canonical messages are available, including structured `tool-call`, `tool-result`, `effect`, `patch`, `task`, `collaboration`, `finish`, and `error` parts.

**Current status:** canonical rendering is now the default desktop timeline path for `chat`, `immediate_task`, `scheduled_task`, and `scheduled_multi_task`, and also for event-only sessions whose source events are covered by the local canonical synthesis gate. Legacy event projection remains as a fallback for non-migrated event types only.

**Next slice:** audit any still-renderable legacy-only events, then retire or heavily slim the legacy event-specific timeline builder now that desktop either consumes store-backed canonical messages or locally synthesizes canonical messages from legacy `TaskEvent`s before rendering.

**Current desktop event coverage:** all current `TaskEventType` values are now covered by the local canonical safety gate. The final no-op group for timeline rendering is `TASK_SUSPENDED`, `TASK_RESUMED`, `TASK_HISTORY_CLEARED`, `SKILL_RECOMMENDATION`, `AGENT_IDENTITY_ESTABLISHED`, `MCP_GATEWAY_DECISION`, `RUNTIME_SECURITY_ALERT`, and `TOKEN_USAGE`.

**Current code structure:** the desktop timeline code is now split into:
- `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
  canonical-first entrypoint and canonical builder
- `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/hooks/legacyTimelineBuilder.ts`
  legacy fallback state machine
- `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/hooks/timelineShared.ts`
  shared normalization and task-step helpers used by both paths

**UI unification status:** the first structured-message UI slice is now in place via `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/StructuredMessageCard.tsx`.
- `TaskCardMessage` and `ToolCard` now share the same message-card shell
- `AssistantTurnBlock` now renders assistant markdown/system content inside the same structured-message shell as a unified response card
- `AssistantTurnBlock` pending/runtime status now also renders inside the same structured-message shell, preserving the existing animated pending indicator inside the card body
- `AssistantTurnBlock` now consumes a canonical assistant-turn card schema from `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/assistantTurnCardSchema.ts` and renders it through `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/AssistantTurnCardStack.tsx` instead of manually composing response/runtime/tool/task card branches
- `StructuredMessageCard` now supports explicit semantic kinds (`assistant`, `runtime`, `task`, `tool`) so the unified shell can carry small kind-specific visual variants without per-component ad hoc styling
- `TaskCardMessage` and `ToolCard` now render from dedicated pure view models in `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/taskCardViewModel.ts` and `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/toolCardViewModel.ts`
- `assistantTurnCardSchema.ts` now emits task/tool entries as canonical view models, so the assistant-turn card schema no longer leaks raw `TaskCardItem` / `ToolCallItem`
- shared body/action primitives now live in `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/Timeline/components/StructuredCardPrimitives.tsx`, and both `TaskCardMessage` and `ToolCard` reuse them for labeled sections, action rows, and input rows
- timeline task-center interaction has been reshaped toward chat-first UX:
  - primary task-center cards now render as headerless input-first panels in timeline mode instead of visible `Task center` cards
  - explicit continue/choice buttons were removed from collaboration UI, with route/task-draft control now driven by freeform text that is encoded back to canonical tokens in `/Users/beihuang/Documents/github/coworkany/desktop/src/components/Chat/collaborationMessage.ts`
  - assistant step/card stacks now cap at two-thirds of the conversation width on desktop
- the follow-up cleanup pass removed the dead interaction scaffolding left behind by that shift:
  - resume-card props and handlers are gone from the timeline surface
  - `onTaskActionClick` is no longer threaded through assistant/task-card components
  - obsolete task/button CSS aliases were pruned now that the new canonical primitives own the UI

**Next UI slice:** run a visual cleanup pass on the now chat-first timeline UX, especially spacing, header density, and tool/runtime differentiation after task-center chrome removal.
