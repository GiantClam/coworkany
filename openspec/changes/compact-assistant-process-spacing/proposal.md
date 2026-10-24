# Compact assistant process spacing

Status: The user approved the proposed direction on 2026-09-30. This is a specification-only follow-up; implementation and fresh product verification are pending.

## Why

The latest screenshot still shows large blank intervals between tool summaries, thinking summaries and intervening prose. The current surface applies a uniform 16px output gap and a 32px gap between messages within a turn. These are source observations, not proof of the complete runtime cause: the screenshot alone cannot establish message boundaries, hidden layout participation or which compiled renderer is running.

The previous change verified single-message process grouping, but that does not establish compact geometry across several assistant messages. This follow-up adds relationship-based spacing and explicit multi-message acceptance.

Screenshot: `/var/folders/z_/bq49_j7s03j97t1vz5b87q1m0000gn/T/codex-clipboard-80571aa8-f1e6-4017-a2bf-0d5408cdd009.png`.

## What Changes

- Replace uniform assistant-output spacing with deterministic relationship-based spacing: process/process 4px, primary/process 8px, process/primary 12px, and other visible output boundaries 16px at default scale.
- Use 16px between consecutive assistant message rows in the same existing turn; preserve 32px between turns and between a user message and its first assistant reply.
- Use 8px between an expanded process trigger and its detail list; closed details and non-rendered bookkeeping introduce no layout space or extra gap items.
- Retain one entry for each maximal eligible process interval within one message. Do not combine message IDs or collect a whole turn into one process bucket.
- Preserve readable text, desktop/coarse targets, direct attention/results, disclosures, focus, announcements, scrolling and pinned primitive contracts.
- Add multi-message, hidden-placeholder, production-style and native replay acceptance alongside the existing 1/10/50-call cases.

## Capabilities

### Modified Capabilities

- `ai-elements-message-surface`: contextual vertical rhythm and collapsed-content geometry.

No new capability, public API, transport field, persistence field or dependency.

## Scope / Non-Goals

Scope: `WorkbenchMessageSurface`, surface-scoped CSS, existing process disclosures, relevant tests and desktop acceptance fixtures used by Chat, Agent, Writer and Workflow AI.

Non-goals: commentary/final inference; cross-message grouping; changed timestamps/avatars/actions; altered Markdown paragraph/list spacing; provider/runtime fixes; restored-waiting ownership semantics; whole-turn collapse; unrelated layout or source cleanup; new dependencies; changes to pinned AI Elements source.

## Relationship to Previous Changes

This delta supersedes only `unify-assistant-process-hierarchy`'s uniform 16px process-to-content spacing requirement and the applicable Workbench row-gap policy. Its typography, lifecycle, same-message interval boundaries, truthful counts, bounded details, source provenance and accessibility contracts remain in force. `compact-tool-call-activity`, `preserve-assistant-turn-stream-order` and unaffected parity requirements remain applicable.

The previous change's completed tasks, human listening confirmation and acceptance records remain historical evidence. They SHALL NOT be edited to claim this new spacing behavior is implemented or verified.

## Success / Verification

Measure actual rendered boxes, not only CSS source declarations, under the complete production stylesheet stack. Cover one and several assistant messages, explicit user-turn boundaries, text/reasoning/tool interleaving, 1/10/50 calls, active/settled/empty states, visible results, Workflow AI, disclosure transitions, light/dark/narrow/zoom, keyboard, phase-region identity and reading-position preservation. Rebuild the production frontend and native macOS desktop before native geometry acceptance; record unavailable platforms honestly.

## References / Alternatives

- [AI Elements Chatbot](https://elements.ai-sdk.dev/examples/chatbot): reasoning and response composition in the same Message.
- [Reasoning](https://elements.ai-sdk.dev/components/reasoning): avoid repeated thinking entries; its whole-message consolidation example is not permission to reorder this project's Parts.
- [Tool](https://elements.ai-sdk.dev/components/tool): keep details behind an explicit disclosure.
- Earlier grounded research: `docs/research/2026-09-30-message-process-visual-hierarchy.md`.

Recommended: contextual spacing plus existing eligible-interval grouping. Rejected: lowering every gap equally (weakens turn/result structure), or aggregating all process content across a turn (loses chronological relationships and message identity). The chosen numbers are project design decisions, not official AI Elements spacing standards.
