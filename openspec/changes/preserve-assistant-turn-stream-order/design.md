# Design: Ordered Assistant Turn with AI Elements Parity

## Context

The existing system already uses `DesktopUIMessage`, a Tauri-compatible `ChatTransport`, persisted `parts_json` and official AI Elements source primitives. The defect is at the seam between runtime events and an assistant turn:

```text
OpenCode/Tauri event
        -> multiple page/client projections
        -> fixed text/reasoning identities
        -> globally grouped renderer
        -> process block + message block + result block
```

The target keeps `DesktopUIMessage` as the only public message protocol:

```text
OpenCode/Tauri event
        -> normalized sequenced WorkbenchRunEvent
        -> AssistantTurn projection
        -> ordered DesktopUIMessage.parts
        -> single-pass WorkbenchMessageSurface
        -> pinned AI Elements primitives
```

## Decision 1: Use one deep assistant-turn module

Add a pure in-process module under `packages/workbench-client` with a small interface:

```ts
export type SequencedRunEvent = WorkbenchRunEvent & {
  readonly sequence: number;
  readonly createdAt: string;
};

export type AssistantTurnSeed =
  | {
      readonly kind: "new";
      readonly id: string;
      readonly conversationId: string;
      readonly runId: string;
      readonly createdAt: string;
      readonly providerId?: string;
      readonly modelId?: string;
    }
  | {
      readonly kind: "stored";
      readonly message: DesktopUIMessage;
    };

export function beginAssistantTurn(seed: AssistantTurnSeed): DesktopUIMessage;

export function advanceAssistantTurn(
  current: DesktopUIMessage,
  event: SequencedRunEvent,
): DesktopUIMessage;
```

The module hides segment lifecycle, Part identity, ordering, idempotency, terminal-state protection and finalization. It does not introduce a second page-facing timeline type.

Dependencies are in-process. Tauri/OpenCode frame parsing remains an adapter at the existing host seam; file and preview resolution remain typed host adapters.

## Decision 2: Separate occurrence identity from entity identity

Text and reasoning are occurrences. Their ids identify a contiguous segment:

```text
reasoning:<first-sequence>
text:<first-sequence>
```

Tools, tasks, previews and artifacts are entities. Their stable ids identify the same item across lifecycle updates:

```text
tool:<tool-call-id>
task:<task-id>
preview:<session-or-artifact-id>
artifact:<artifact-id>
```

The first event inserts an entity at the current position. Later events patch that position without moving it.

## Segment and barrier rules

1. Adjacent deltas of the same active text or reasoning segment append to that segment.
2. A tool, task, approval, source, attachment, media, preview, artifact, report or workflow output is a barrier.
3. Before a barrier, the transport closes an active text/reasoning stream with the corresponding `*-end` chunk.
4. Text or reasoning after a barrier opens a new segment with a new id.
5. A terminal run event closes all open segments and updates message metadata.
6. Usage and run metrics remain message-level trailing summaries and do not reorder the visible reply.
7. Copy, search, storage summaries and retry prompt extraction concatenate all text Parts in array order.

Example:

```text
reasoning-start reasoning:1
reasoning-delta "检查实现"
reasoning-end reasoning:1
text-start text:4
text-delta "我先读取当前代码。"
text-end text:4
tool-input-available tool:read-1
tool-output-available tool:read-1
text-start text:12
text-delta "已找到固定 Part identity。"
text-end text:12
data-artifact artifact:report-1
finish
```

## Ordering and error semantics

- Live adapters assign a monotonic arrival sequence when the runtime does not provide one.
- Persisted replay sorts stored events by sequence before reduction.
- A duplicate or `sequence <= lastSequence` event is a no-op unless it is an explicitly supported idempotent entity patch with the same terminal result.
- A completed/failed/denied tool cannot regress to started because of a late event.
- A terminal tool event without a visible start creates one terminal tool Part at its arrival position.
- Unknown typed data Parts remain in the ordered array and render a safe fallback.
- Malformed host frames are rejected and logged before entering the projection.
- Stored v2 messages keep their existing Part order. The projection cannot infer chronology that no longer exists.

## Decision 3: Render Parts in one pass

`WorkbenchMessageSurface` shall traverse `message.parts` in order. It may group only adjacent Parts when the official interaction benefits from it, for example consecutive sources or related media. It shall not collect all reasoning, tools, text or artifacts across the turn.

Mapping remains based on existing AI Elements primitives:

| Part | Primitive |
|---|---|
| `text` | `MessageResponse` |
| `reasoning` | `Reasoning`, `ReasoningTrigger`, `ReasoningContent` |
| `dynamic-tool` / typed tool | `Tool`, `ToolHeader`, `ToolContent`, `ToolInput`, `ToolOutput` |
| `data-task` | `Task`, `TaskTrigger`, `TaskContent` |
| sources | `Sources`, `Source`, `InlineCitation` |
| artifact/media/preview/report/workflow | Existing typed Workbench renderer composed within the same ordered stream |

Only the active text Part uses streaming Markdown. Completed text Parts use static Markdown so earlier content does not continually reparse.

## Decision 4: Keep one live message owner

Conversation routes shall use `useChat<DesktopUIMessage>.messages` as the live source of truth. Page-owned assistant text buffers, Part refs and tool-status arrays may remain temporarily as runtime diagnostics, but they shall not participate in rendered message composition.

Completion, failure and cancellation persist the same final `DesktopUIMessage` snapshot that was rendered. `mergeDesktopUIMessageViews` shall no longer select one entire Parts array based on which view contains text.

The App and Workbench client currently have overlapping runtime response listeners. This change shall consolidate visible-message event projection so one accepted event creates one message update. Non-message metrics and task-center consumers may remain separate subscribers.

## Decision 5: Define parity against a pinned target

Before implementation, record the exact AI Elements source provenance used for acceptance: registry snapshot, source repository commit or registry payload digest, AI SDK version and reference screenshots. The current `AI_ELEMENTS_SOURCE_SNAPSHOT` remains the starting target.

Parity covers the message area:

- `Conversation > ConversationContent > Message > MessageContent` hierarchy;
- ordered `message.parts` composition;
- Reasoning automatic open/close behavior;
- Tool running, approval, completed and error behavior;
- streaming `MessageResponse` behavior;
- stick-to-bottom behavior and scroll-to-latest affordance;
- neutral AI Elements/shadcn spacing, borders and typography.

Allowed Workbench differences:

- brand color token;
- desktop shell geometry;
- role avatar and timestamp;
- artifact/media/preview actions;
- host-specific approval, file and navigation callbacks.

Disallowed differences:

- a separate execution-process region that reorders Parts;
- heavy nested process cards that replace the AI Elements hierarchy;
- page-owned tool/reasoning/message renderers;
- fabricated assistant text during a tool-only phase.

Reference behavior:

- AI SDK Chatbot ordered Parts composition: `https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/02-chatbot.mdx`
- AI Elements Message: `https://elements.ai-sdk.dev/components/message`
- AI Elements Reasoning: `https://elements.ai-sdk.dev/components/reasoning`
- AI Elements Tool: `https://elements.ai-sdk.dev/components/tool`

## Activity, scrolling and accessibility

- The active Part renders at its chronological position.
- A concise trailing indicator announces waiting, reasoning, tool, approval or writing activity. It does not invent model prose.
- Tool activity may show locally measured elapsed time when the runtime emits no progress detail.
- The scroll revision includes the last message id, last accepted sequence and active state, rather than only the message id.
- New content follows only while the user remains near the bottom. Manual upward scrolling suspends following and exposes a new-activity/scroll-to-latest control.
- The active assistant message uses `aria-busy="true"`.
- Only the concise activity indicator uses `aria-live="polite"`; token deltas are not individually announced.
- Reasoning and tool disclosures retain keyboard operation and correct `aria-expanded` state.
- Approval requests remain visible and focusable; completion never steals focus.

## Alternatives considered

### Change only the JSX to `message.parts.map`

Rejected because the transport has already collapsed all text and reasoning into fixed identities. The renderer cannot recover tool boundaries that are absent from the data.

### Add a second public timeline view model

Rejected because it would duplicate `UIMessage`, introduce synchronization risk and expand the interface that every caller and persistence path must understand.

### Expose the raw append-only event log

Rejected because lifecycle patches would be noisy in normal conversation and would diverge from AI Elements/chatbot behavior. The projection preserves first occurrence and updates entities in place.

### Add a generic renderer registry and host dispatcher immediately

Deferred. The ordered renderer and existing workflow/tool variants are sufficient for this change. A registry becomes a real seam only when another independent renderer adapter is required.

## Verification strategy

1. Reducer contract tests establish Part order, segment boundaries, idempotency and terminal-state behavior.
2. Transport tests assert exact UI Message Stream chunks around barriers.
3. Replay tests compare live and persisted projections from the same captured event fixture.
4. Component tests assert DOM order and official primitive states.
5. Browser tests verify streaming, activity feedback, bottom following, user-controlled scrolling and accessibility.
6. Screenshot comparisons at agreed light/dark desktop viewports verify the pinned AI Elements hierarchy within allowed Workbench differences.
7. Real Tauri acceptance runs a tool-bearing conversation and verifies the same order during streaming and after reload.
