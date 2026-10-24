# Design: Unify assistant process hierarchy

## Context

The existing surface renders reasoning separately per Part and groups adjacent ordinary tools. Both reasoning headers and MessageContent use `text-sm`; reasoning's `mb-4` is added to the output container gap. Tool summaries already use compact 13px/32px presentation, but separate process entries still compete with the answer.

The researched AI Elements Reasoning example and Chatbot consolidate thinking. Their whole-message collection can move later reasoning before intervening content. This project instead retains one chronological projection and expands the existing adjacent-tool design to compatible process intervals.

## Goals / Non-Goals

Goals: readable answer-first hierarchy, fewer process entry points, exact visible chronology, truthful summaries and preserved inspection/interaction state.

Non-goals: global process buckets, automatic text-role classification, new dependencies/protocols, modified pinned source, unrelated refactoring or model-generated summaries.

## Decisions

### 1. Three levels, scoped to the assistant surface

| Level | Default desktop geometry | Content |
| --- | --- | --- |
| Primary | Assistant response 1rem (16px at default root), line-height 1.65; normal foreground | Every assistant text Part and existing useful typed results; keep their established content/actions |
| Secondary | Process trigger .8125rem (13px), 20px line-height, 14px disclosure icon; minimum 32px desktop / 44px coarse-pointer target | One process summary per interval, no outer border, filled background or repeated completion/brain icons |
| Detail | Readable muted text, at least 4.5:1 contrast for normal text | Expanded chronological steps and selected tool input/output |

Use relative font units so zoom and user font scaling remain effective. Preserve user bubbles and standalone official typography. The 16px response setting is a documented surface exception, not a global Message override or a way to distinguish final text from other assistant text.

Let the surface own adjacent spacing: 4px between internal compact step rows and 16px between a process segment and neighboring text/result blocks at default scale. Override inherited `mb-4` only within this surface. Do not add independent margins to each nested process primitive. Preserve existing Markdown paragraph/list spacing inside a text Part; do not rewrite Markdown or add a redundant "Answer" title/card.

Settled normal headers use a disclosure affordance, without a leading brain/check icon. Active summaries may show one spinner; failure/denial summaries retain their attention indicator. Reduced motion removes spinner motion without removing the state label. Do not make informational text translucent to achieve hierarchy; test theme tokens against actual backgrounds.

### 2. Maximal adjacent eligible process projection

Reuse/extend the current activity projection; retain original Part references and indices. Pass existing surface context to the projection: `workflowAi` and whether the message is active. Eligible Parts are non-empty reasoning (or empty reasoning whose `state` is streaming in an active message) and ordinary tools when `workflowAi === false`. A stored streaming flag alone does not establish active execution after restoration. Omit settled empty reasoning without producing a phantom header. Existing non-rendered bookkeeping metadata may be skipped; visible unknown Parts are boundaries.

Every text, approval, user question, task, source, file, warning, artifact, media, report, preview or other directly visible result is a boundary. Reuse the current ordinary-tool predicate: exclude approval-requested calls and normalized tool names `question`, `ask_user`, `request_user_input`.

For `workflowAi === true`, all ordinary tools terminate mixed process segments in every lifecycle state, even before their business summary exists. Route their adjacent runs to the existing tool-only `ToolActivityGroup` and its existing `WorkflowAiToolSummary` path; do not merge reasoning across those runs. Preserve the established summary visibility/selected-detail deduplication and host actions. This conservative flag-based decision requires neither guessed output semantics nor new metadata. Reasoning before/after a Workflow AI tool run remains in separate process segments. Do not interpret arbitrary raw tool JSON as a typed result.

Example projection:

```text
Input:  reasoning → text A → tool ×2 → reasoning → tool ×3 → text B → artifact
Output: process 1 → text A → process 2                    → text B → artifact

process 1 steps: reasoning
process 2 steps: tool ×2 → reasoning → tool ×3
```

Never move process 2 before text A or hide text A within process 1. Never combine assistant messages or modify stored `parts`. A reasoning-only interval gets one summary, not a summary for each reasoning Part.

### 3. Localized, truthful summary contract

| Interval | Settled label example |
| --- | --- |
| Reasoning only, no measured duration | `思考过程` / `Thinking process` |
| Ordinary tools only | `5 次工具操作` / `5 tool operations` |
| Mixed reasoning/tools | `处理过程 · 5 次工具操作` / `Process · 5 tool operations` |

Active labels describe actual ongoing reasoning/tool activity and may include the observed call count. They never imply an unknown planned total. Reuse deterministic tool action mapping and distinct toolCallId/latest accepted lifecycle accounting. A reasoning Part, lifecycle event or repeated patch does not increase the tool count. Mixed outcomes expose failures/denials rather than claiming all calls succeeded; the failure action directly locates the failed call.

Only measured duration may be displayed. Restored reasoning with no stored timing uses the neutral label, not "a few seconds" and not a new local timer started during restoration. Do not sum overlapping reasoning/tool durations, infer targets/files from labels or call another model for summary prose. Visible copy need not repeat "completed" or "view process"; accessible names still explain the disclosure.

### 4. Default closed, stable inspection

All eligible process segments and tool details start closed during both active and settled states, including standalone reasoning intervals. The process summary owns current reasoning/tool feedback. Supply controlled/default-closed props through adapters so pinned Reasoning remains unchanged. User opening a segment reveals its ordered steps; reasoning content is inspectable there and individual tool parameters/output remain a second explicit disclosure.

Preserve message-scoped identity/state for reasoning and tool members. Use existing stable partId/toolCallId; a message-scoped append-stable fallback is permitted for legacy reasoning without partId. Reuse fixed tool portal hosts and disclosure state instead of introducing another runtime owner. Appended reasoning/tools, completion or segment ID changes must not remount unaffected tool detail components or reset copied feedback, manual choices, focus or scroll offsets.

When approval splits/merges a segment, preserve unaffected member state. Merge open state is an OR over existing explicit member/segment choices: if any choice is true, the merged segment is open, even when its first member belongs to a manually closed segment. If there is no true choice, the segment remains closed. A direct close of the merged segment writes false for all its current member identities; appended members inherit the resolved segment choice. Individual call choices are independent and do not change. Manual close persists through ordinary streaming/completion. Fresh reloads start closed; no persisted disclosure-state field is introduced.

Bound the expanded process list to `min(28rem, 60vh)`, a reasoning content step to 200px at default scale, and existing raw tool details to `min(24rem, 50vh)`. Overflow remains inspectable by scrolling, with full output inspection/copy preserved. Bounds must not clip approvals or useful results, which remain outside the segment.

### 5. Activity and compatibility

Keep a single bounded polite phase-announcement region and assistant busy state. When the process header describes active reasoning/tools, suppress duplicate trailing reasoning/tool labels for that same phase. Retain waiting, writing, approval and other required independent feedback. Parallel call state remains truthful without starting a spinner on every historical step.

Keep the existing near-bottom follow policy and latest-activity control. Summary updates, split/merge and completion cannot steal focus or move a reader who scrolled upward. Keyboard toggles expose accurate aria-expanded and visible focus. Any focused-node restoration uses preventScroll.

Allowed parity exceptions are the Workbench response/process typography, process margin/icon/copy changes, mixed adjacent grouping and default-closed surface reasoning. Ordinary tools in eligible segments retain the default-closed exception approved by `compact-tool-call-activity`; this does not restore the older parity change's running-tool auto-open requirement. Non-eligible approval/interaction tools retain existing `OrderedTool` lifecycle controls, and Workflow AI retains its approved tool-only path. Independently rendered official Reasoning/Tool retain pinned prop/default contracts. Pinned upstream files, deterministic official ports, hashes, user bubbles, Markdown structure, Conversation scrolling and host/result contracts remain protected.

## Alternatives Considered

1. **Recommended: compact shared process segments.** Solves repetition as well as spacing while retaining visible order; adds projection/state tests.
2. **Styling only.** Lowest implementation risk, but every reasoning/tool interval still produces separate entry points. Useful first implementation phase, not the full outcome.
3. **One whole-turn process block.** Fewest entries, but reorders interleaved reasoning/tools or hides meaningful text/results. Rejected under the chronological contract.

## Risks / Trade-offs

- Default-closed reasoning differs from the pinned primitive; document and test the surface exception rather than altering source hashes.
- Mixed grouping makes approval splits/merges more frequent; reuse the prior mounted-host design and extend focus/copy/scroll coverage before changing it.
- Smaller muted text can fail contrast; verify computed foreground/background in both themes, not screenshot anti-aliasing samples alone.
- Workflow summaries may originate inside tool Parts; preserve that direct business UI rather than treating every tool output as hidden trace.
- No text-role schema means pre-tool prose remains primary. A future commentary/final change requires separate requirements; do not use positional heuristics now.

## Implementation / Verification Shape

Extend `tool-activity.ts`, `tool-activity-group.tsx`, `workbench-message-surface.tsx` and scoped `styles.css` using existing adapters/Collapsible. Add focused coverage alongside `tool-activity.test.tsx`, `tool-activity-surface.test.tsx`, `workbench-message-surface.test.tsx` and `message-visual-contract.test.tsx`; avoid unrelated renaming or abstraction layers.

First lock mixed chronology/default state with regressions, then apply typography and projection/disclosure changes. Use 1/10/50-call and multi-reasoning fixtures under the complete desktop style stack, both themes and narrow viewports. Verify independent primitives separately and capture the rebuilt native WebView during implementation. Record actual verification and limitations only after execution.
