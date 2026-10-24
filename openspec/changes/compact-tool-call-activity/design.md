# Design: Compact tool-call activity

## Ordered presentation projection

Add a small surface-level grouping helper beside `MessageParts` in `packages/workbench-ui/src/workbench-message-surface.tsx`. Walk the original Part array in order and group only adjacent eligible tool traces. Non-rendered bookkeeping metadata may be skipped without affecting visible order. Every visible non-tool Part, approval request and user interaction is a boundary. Never group across messages or alter stored `DesktopUIMessage.parts`.

The group references the original Parts rather than copying them into a second runtime state owner. Key a group by message identity and its first toolCallId; key call rows by toolCallId. Completion patches the original call. Adding a call or subsequent text must not recreate existing disclosures or reset manual choices. If a call becomes an approval boundary, preserve unaffected call state and expose the request immediately.

Implementation uses message-scoped keyed portals with a permanent DOM host for each call. An approval can move that host between bounded group lists without changing the portal container or remounting unaffected call components. Restore focused descendants with `preventScroll`, and retain list offsets by call identity. This preserves inspected output, clipboard feedback and focus through split/merge. If independently toggled split groups merge, an existing open choice wins so an inspected call is not hidden; individual call choices remain unchanged. Hosts live only for the mounted message lifetime, not in persisted Parts.

## Disclosure and summary

Compose a shared `ToolActivityGroup` from the existing Collapsible. Its initial state is closed whether running or settled. A one-call group uses the same row as a multi-call group. Running/completion alone never force expansion or override a user's open/closed choice.

The collapsed trigger has muted text, one lifecycle icon and a chevron, without an outer card border, filled background or repeated per-call badges. Target a visually compact 28–32 px row with 12–13 px text; verify legibility, keyboard focus, touch target and narrow layouts before fixing exact dimensions. Scope styles to this surface extension rather than globally overriding official Tool classes.

Use deterministic localized labels and real state, for example:

```text
Running:   ⟳ 正在检索资料 · 已完成 6 次操作     ›
Completed: ✓ 已完成 8 次操作 · 查看过程          ›
Failed:    ! 1 项失败 · 查看失败详情             ›
```

Count unique toolCallIds, not lifecycle events. Distinguish success, failure, denial and active calls; a denied or failed call must not contribute to a successful-completion count. Unknown tools use a neutral operation label. Only show a total-step denominator when a real plan supplies that total. Only show durations derived from real runtime timestamps or locally measured activity. File counts require successful, deduplicated targets. Do not call an LLM to summarize activity.

Opening a group reveals compact rows in original order. Opening a row reveals existing ToolInput/ToolOutput content through the current Tool composition. Bound expanded list/log height with scrolling and provide complete output inspection/copy; do not silently truncate underlying data or render all parameters when opening a large group. Mounted input/output changes remain visible to users inspecting that call.

## Attention and useful results

Approval requests and user questions render outside trace groups at their original position, including their existing typed actions. Approving/rejecting a call must not change its original Part position or lose the action callback.

Failures remain visible in a collapsed group's summary, with a direct action that opens and locates the failed call's details. Do not make the user search through successful calls. Denied, failed, active and successful mixed groups have accurate summaries.

Keep existing typed artifact, media, file, table/report and preview renderers visible in the ordered transcript, with existing download/open callbacks. Raw tool output remains available in details. Do not infer a new artifact protocol from arbitrary JSON or duplicate a result already rendered as a typed Part. Preserve concise Workflow AI business summaries and interaction behavior.

## Activity, accessibility and scrolling

The group summary owns visible tool-running feedback. Suppress a duplicate trailing tool-running label when the group already communicates that phase; retain waiting, reasoning, writing and other necessary existing activity feedback. A tool-only turn still has a visible active row and message busy state.

Use a single polite live activity region for meaningful phase changes. Do not announce every count tick, elapsed second or token. Group and call triggers retain keyboard toggling, visible focus, accessible names and accurate aria-expanded. Completion must not steal focus. Respect reduced motion.

Keep the existing near-bottom follow policy. Streaming updates and disclosure expansion must preserve intentional upward scrolling; expose the existing scroll-to-latest control. Historical/reloaded messages use the same default closed grouping and original order. No persistence field for disclosure state is required; manual choices survive updates while mounted.

## Compatibility and parity

This is an approved Workbench surface exception to upstream tool card density and automatic running expansion. Keep `ai-elements/upstream`, deterministic `ai-elements/official` ports, hashes and primitive-level parity tests intact. Existing Message, Reasoning, Markdown and Conversation parity still applies.

Add grouped-surface expectations separately from the official Tool primitive reference. Surface screenshots intentionally differ in tool grouping and summary geometry; all other differences still require the existing documented exceptions. No assistant-ui runtime, new component dependency or parallel tool graph is needed.

## Verification

Use 1/10/50-call fixtures, interleaved visible Parts, tool-only intervals, simultaneous active calls, out-of-order lifecycle updates, success/failure/denial mixtures, approval transitions, user questions and useful results. Exercise mounted group/call toggles through streaming and completion. Verify original order after replay/reload, one running label, bounded announcements, focus and reading-position preservation. Capture light/dark and narrow desktop views with production styles; verify the actual desktop WebView during implementation.
