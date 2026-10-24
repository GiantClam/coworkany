# Proposal: Preserve Assistant Turn Order and Restore AI Elements Message Parity

**Change ID:** `preserve-assistant-turn-stream-order`
**Status:** Draft
**Depends on:** `refactor-desktop-ai-elements-uimessage`

## Problem

The shared message surface uses AI SDK `UIMessage` and AI Elements primitives, but the current implementation does not preserve an assistant turn as one chronological reply.

- Runtime text and reasoning deltas use one fixed identity for the entire turn, so `text -> tool -> text` collapses into one text Part plus one tool Part.
- The renderer globally separates reasoning/tools, text, media and artifacts, then displays those categories in a fixed layout. This destroys the original Part order even when the transport emitted it correctly.
- The desktop shell maintains live reply data in both `useChat` messages and page-owned buffers/refs. Tool-only updates rely on unrelated React state to trigger a render, which makes the reply appear frozen while a tool is running.
- Custom execution containers and styling diverge from the official AI Elements Message, Reasoning, Tool and Conversation composition.

The existing UIMessage migration established the right primitives and contracts. This change closes the gap between that contract and the live behavior.

## Proposed solution

Introduce a small assistant-turn projection module at the runtime-event-to-`DesktopUIMessage` seam. It shall:

1. Preserve first-occurrence order across reasoning, text, tools, tasks, sources, media, previews and artifacts.
2. Merge only adjacent deltas that belong to the same active text or reasoning segment.
3. Close the active segment at a process/output barrier and create a new segment when text or reasoning resumes.
4. Update tool/task entities in their original position through stable identities.
5. Produce immutable `DesktopUIMessage` updates for live rendering, persistence and replay.

Render assistant Parts with one ordered traversal and the pinned official AI Elements compound components. The active Part and a concise trailing activity indicator shall communicate progress while no text delta is arriving. `useChat<DesktopUIMessage>` shall become the only live message owner for conversation surfaces.

The target interaction and message hierarchy is the pinned AI Elements source snapshot recorded in `packages/workbench-ui/src/ai-elements/manifest.ts`, together with the official AI SDK Chatbot ordered-Parts composition. Workbench may retain its brand color, desktop shell, timestamps, avatars and typed host actions, but it shall not introduce alternate message grouping or process-card hierarchy.

## Scope

### In scope

- Pure assistant-turn projection and immutable event reduction in `@coworkany/workbench-client`.
- Distinct text/reasoning segment identities and correct AI SDK UI Message Stream start/end boundaries.
- Stable sequence, creation-time and entity identity handling for every visible Part family.
- Ordered Part rendering in `WorkbenchMessageSurface` and the legacy/shared message timeline entry point.
- One live `DesktopUIMessage` state owner for desktop conversations.
- Tool/reasoning/task activity feedback, elapsed state, scrolling and accessibility behavior.
- Removal of layout CSS and rendering logic that globally separates process Parts from message text.
- Pinned AI Elements/chatbot parity fixtures, component contracts, screenshots and real Tauri acceptance.
- Best-effort rendering for existing persisted messages whose lost chronology cannot be reconstructed.

### Out of scope

- Displaying hidden model chain-of-thought or inventing reasoning that the runtime did not emit.
- A raw event-log or developer audit console inside the conversation transcript.
- A causal graph UI for parallel tool calls; parallel tools remain ordered by first appearance.
- Provider routing, model selection, prompt behavior or runtime capability changes.
- Pixel-identical reproduction of the surrounding AI Elements demo application shell.
- Backfilling chronology that was already destroyed in old persisted Parts.
- New third-party dependencies.

## Success criteria

- A captured `reasoning -> text-before -> tool-start -> tool-complete -> text-after -> artifact` run produces that exact Part and DOM order during streaming and after reload.
- Tool completion patches the original tool position; later text appears below the tool in a new text segment.
- Every accepted visible event produces an immutable message update. Tool-only phases never depend on an unrelated state update to become visible.
- While a tool is active, the message shows the tool state, progress indicator and elapsed activity without fabricating assistant prose.
- Live transport, persisted replay and restored conversation views produce equivalent ordered Parts and terminal states.
- Message composition, Reasoning/Tool behavior, streaming Markdown and bottom-follow behavior match the pinned AI Elements/chatbot reference within the documented Workbench exceptions.
- Custom styling retains only approved brand and host-shell differences; no separate execution-process region reorders the reply.
- Users who scroll upward are not forced back to the bottom and receive a visible new-activity affordance.
- Workbench client/UI tests, desktop tests and typecheck, shared boundary/provenance checks, build, OpenSpec validation and real Tauri parity acceptance pass.

## Affected areas

| Area | Change |
|---|---|
| `packages/workbench-client` | Add assistant-turn projection; segment stream Parts; unify live/replay semantics |
| `packages/workbench-ui` | Render one ordered Part stream with official AI Elements primitives; narrow custom CSS |
| `apps/desktop` | Remove page-owned message projection and parts arbitration; keep host callbacks and persistence |
| Desktop persistence/replay | Round-trip segment order and terminal states; support legacy best-effort fallback |
| Tests and acceptance evidence | Add interleaving, activity, scroll, accessibility, screenshot and Tauri parity coverage |

## Risks

| Risk | Mitigation |
|---|---|
| Text on both sides of a tool becomes separate Markdown blocks | Split only at real non-text barriers; concatenate all text segments for copy/search/export |
| Long runs create many Parts | Merge adjacent deltas and create a new Part only at a semantic barrier |
| Old messages cannot recover lost order | Preserve existing array order and label the projection as legacy/best-effort internally |
| Duplicate or late runtime events regress terminal state | Keep stable entity identity, monotonic sequence handling and terminal-state guards |
| “Parity” becomes a moving target | Pin source provenance and reference screenshots before implementation; compare only against that target |
| Visual cleanup removes desktop capabilities | Keep artifact, media, preview and approval behavior behind typed host callbacks |
