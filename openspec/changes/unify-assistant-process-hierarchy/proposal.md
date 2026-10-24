# Unify assistant process hierarchy

Status: Implemented on 2026-09-30 following user approval to execute. Automated, mounted Browser and rebuilt macOS WebView verification passed, including native keyboard/scroll/reload, actual system reduced motion and production coarse-pointer rule simulation. The user explicitly confirmed Thinking → Running tools → Writing each spoken once without duplication, closing task 5.3. Agent-changed system settings were restored; the user's later sound adjustment was preserved. No automated audio capture, physical touch-device coverage or runtime-session-attachment fix is claimed. See `acceptance.md`.

## Why

`compact-tool-call-activity` reduced individual tool cards, but the supplied screenshot still shows repeated reasoning/tool entries with near-body typography and large gaps. Reasoning's own bottom margin adds to the message container gap. Process information competes with the answer instead of supporting it.

Evidence and official AI Elements/Chatbot comparisons are recorded in `docs/research/2026-09-30-message-process-visual-hierarchy.md`.

## What Changes

- Establish three presentation levels: answer text/useful results, compact process summaries, and on-demand reasoning/tool details.
- Apply shared compact typography, spacing and localized labels to reasoning and ordinary tools. Do not display an approximate thinking duration when actual timing is unavailable.
- Project each maximal adjacent eligible reasoning/tool interval into one default-closed process segment, including reasoning-only and tool-only intervals. Expanded steps retain their original chronology.
- Preserve manual disclosure choices, mounted tool details, focus, bounded scrolling, real lifecycle counts and a single current-phase feedback path.
- Keep text, required interaction, tasks, sources and useful results outside process segments. Preserve existing Workflow AI business summaries.
- Document surface-only exceptions to pinned parity and reasoning auto-expansion; leave official source, ports and standalone primitive contracts unchanged.

## Capabilities

### New Capabilities

None. This extends the existing shared message surface.

### Modified Capabilities

- `ai-elements-message-surface`: visual priority, compatible adjacent-process grouping, default-closed reasoning, stable lifecycle presentation and bounded activity feedback.

## Scope and Non-Goals

Scope: shared `WorkbenchMessageSurface`, existing activity helpers/disclosures, surface-scoped styles, regressions and acceptance fixtures used by Chat, Agent, Writer and Workflow AI.

Non-goals: text-role inference or a new commentary/final schema; transport/persistence/runtime changes; whole-turn aggregation; content rewriting; hidden-reasoning generation; additional model calls; new dependencies; unrelated composer or page redesign.

All assistant text remains equally readable until explicit presentation roles are separately designed. Do not weaken a text Part merely because it precedes a tool or is not the last Part.

## Relationship to Existing Changes

Upon implementation, this delta extends the already approved default-closed ordinary-tool exception from `compact-tool-call-activity`, and supersedes its tool-only compatibility boundary, process typography/labels and unchanged-reasoning behavior. It also explicitly replaces `restore-ai-elements-message-visual-parity`'s reasoning auto-open requirement only for eligible Workbench process segments. Running ordinary tools inside those segments remain default closed under the prior approved tool exception. Non-eligible approval/interaction tools retain existing `OrderedTool` lifecycle controls; official Reasoning/Tool rendered independently retain their pinned prop/default contracts. `preserve-assistant-turn-stream-order` still prohibits global collection/reordering; source provenance remains protected.

Completed predecessor acceptance records remain historical evidence and SHALL NOT be rewritten as verification of this new change.

## Impact and Verification

No new API, dependency or persistence field. Verification adds mixed reasoning/tool chronology, 1/10/50-call density, user-state continuity during split/merge, attention/results boundaries, theme contrast, keyboard/scroll behavior and production/native screenshots. Implementation tasks remain unchecked until actual evidence is collected.
