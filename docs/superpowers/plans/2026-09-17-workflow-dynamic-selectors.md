# Workflow Dynamic Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Provider-scoped voice and Agent Center-backed Agent dropdowns to desktop workflow node editing.

**Architecture:** Extend the host-neutral parameter renderer with optional dynamic option props and localized loading/empty status. The desktop workflow canvas derives options from the selected node Provider and existing Agent Center groups, while its node update path invalidates stale Provider-specific voice IDs.

**Tech Stack:** React, TypeScript, shared workflow schema, Node test runner, Vite/Tauri desktop.

## Global Constraints

- Preserve existing persisted string values and normal schema rendering.
- Preserve `agent_execute` `audio_transcription` Provider/model behavior.
- Do not add dependencies or revert unrelated worktree changes.

### Task 1: Add dynamic option support to shared renderer

**Files:**
- Modify: `packages/workbench-ui/src/workflow-parameter-fields.tsx`
- Test: `packages/workbench-ui/test/workflow-parameter-fields.test.tsx`

- [ ] Add `WorkbenchWorkflowDynamicOption` and optional `voiceOptions`, `agentOptions`, `voiceOptionsLoading`, `voiceOptionsError` props. Render `voiceId` and `agentId` as selects, retaining a non-catalog current value as a compatibility option and showing localized empty/loading/error status.
- [ ] Add renderer tests for both selects, localized labels, and retained legacy values.
- [ ] Run `npm test -- packages/workbench-ui/test/workflow-parameter-fields.test.tsx` (or the repository's package test command) and confirm pass.

### Task 2: Supply Provider voices and Agent Center catalog from desktop

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/test/workflow-parameter-fields.test.tsx` or a focused desktop helper test beside existing workflow tests.

- [ ] Add a cached Provider-keyed voice loader around the existing `media.voices` request; expose loading/error state to the workflow editor and invalidate the selected `voiceId` when `selectedProviderId` changes to a Provider that does not contain it.
- [ ] Derive Agent options from `localAgentGroups` cards using stable IDs and localized titles; pass both option sets through `DesktopWorkflowCanvas` to `WorkbenchWorkflowParameterFields`.
- [ ] Keep the Agent selector present only for normal Agent execution semantics while leaving `audio_transcription` binding untouched.
- [ ] Add focused tests for Provider-scoped option mapping, Agent catalog mapping, and stale voice cleanup.
- [ ] Run the focused desktop tests and TypeScript check.

### Task 3: Verify desktop integration

**Files:**
- Modify only files required by failing verification.

- [ ] Run shared workbench tests, desktop tests covering workflow editing/provider binding, and workspace typecheck/build.
- [ ] Inspect the final diff to ensure only the design/renderer/desktop integration files changed beyond pre-existing user edits.
- [ ] Record any verification gap explicitly before final response.
