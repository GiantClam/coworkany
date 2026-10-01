# Design: Compact assistant process spacing

## Approved Direction

Use contextual spacing and retain the existing adjacent-process projection. The user approved this direction; this document fixes the proposed ranges to deterministic values so implementation and acceptance can agree. This is not an implementation report.

## 1. One Owner Per Layout Boundary

The Workbench surface owns space between its rendered output blocks. Classify blocks by their existing render path, not the text's meaning:

- **Process:** an existing compact reasoning/tool summary interval. A Workflow AI tool group qualifies only if it has no directly displayed business summary; available business content remains a result boundary.
- **Primary:** assistant text rendered with MessageResponse, and directly visible useful results. All assistant text remains primary regardless of its position.
- **Other visible boundary:** approval, question, task, source, warning or visible unknown content. Keep the existing render/interaction semantics.
- **Non-rendered:** bookkeeping, settled empty reasoning and empty layout-only wrappers; these do not count as visible siblings for spacing. Do not erase stored Parts or remove active feedback.

Use surface-owned relative spacing tokens. At a 16px root:

| Relationship within one message | Token value | Default CSS pixels |
| --- | --- | --- |
| Process → process, where existing compatibility rules require separate entries | .25rem | 4 |
| Primary → process | .5rem | 8 |
| Process → primary | .75rem | 12 |
| Every other visible output boundary | 1rem | 16 |
| Expanded process header → detail list | .5rem | 8 |
| Internal compact detail steps | .25rem | 4 |

These values describe a single layout gutter between rendered block border boxes, not glyph-to-glyph whitespace. A disclosure's own accessible target height and genuine visible content height are separate. Do not stack root `gap`, block margins and nested primitive bottom margins for the same boundary. Preserve Markdown's internal paragraph/list rhythm and result-card internal padding.

Apply classification through the existing rendering projection or ephemeral DOM attributes/classes; no persisted type/schema field or content heuristic. Reuse established helpers and surface CSS. Do not split large modules or add a general layout framework for this change.

## 2. Turn / Message Rhythm

Keep `orderMessagesForTimeline` and `groupMessagesIntoTurns` behavior unchanged. A new user message starts a turn. Existing consecutive assistant rows within one turn receive a 1rem/16px gutter; user → first assistant and turn → turn retain 2rem/32px.

Row spacing takes precedence at message boundaries: a tool-only assistant row followed by a reasoning-only assistant row stays two messages with a 16px row gutter, not a 4px same-message gutter. Do not merge their IDs, move Parts, hide timestamps/avatars/actions or infer a shared runtime run ID. Each row's visible metadata/actions keep their existing behavior; measurement reports SHALL distinguish row gutters from intervening real content.

A message with no rendered output, metadata, controls or active feedback must not create an otherwise empty layout row/gutter. Do not hide valid timestamped messages or ongoing thinking to satisfy a density target. Invisible layout-only placeholders have zero layout contribution; intentionally available controls must remain discoverable and keyboard reachable.

## 3. Grouping Remains Local and Stable

Use the existing maximal eligible reasoning/tool intervals within a single message. For ordinary eligible Parts, `tool → reasoning → tool` remains one summary with truthful unique call count, rather than two labels separated by blank space. Text, approvals, questions, tasks, sources, warnings, results, visible unknown Parts and Workflow AI business paths remain boundaries.

Retain current deterministic localized labels; no model-generated copy, new timing estimate or whole-turn counter. This follow-up does not require a summary-label rename. Cross-message compactness comes from row spacing, not a new aggregation owner.

## 4. Closed Details Have Zero Footprint

After close animations settle, closed detail lists and hidden raw outputs contribute zero height, margin, padding and extra sibling gutters. A force-mounted host may remain mounted to preserve state, but cannot occupy transcript layout while hidden. Retain portal/member identity, manual choices, copied feedback, focus restoration and bounded-list offsets.

Opened header/detail spacing is 8px. Internal step spacing stays 4px. Existing bounds remain: process list `min(28rem, 60vh)`, reasoning 200px at default scale, tool details `min(24rem, 50vh)`. No overflow clipping of approvals or useful results.

Before editing, inspect the current production fixture's DOM/computed boxes to identify actual accumulated gap/margin/placeholder contributors. Do not assert that hidden containers or the deployed build caused the screenshot without evidence.

## 5. Protected Behavior

- Primary prose stays 1rem/1.65; process text .8125rem/20px, icon 14px; normal text contrast at least 4.5:1 in both themes.
- Preserve 32px desktop and 44px coarse-pointer minimum targets. Reduce gutters, not interactive target size. Use relative gutter tokens for scaling.
- Keep default-closed active/settled eligible process segments, open-wins merges and manual-close behavior.
- Keep approval/question controls, failure inspection, useful results, Workflow AI business summaries and full output/copy directly available as before.
- Retain one stable phase region outside busy ancestors, accurate aria-expanded, visible keyboard focus, phase-only announcement updates and reduced-motion state labels.
- Keep near-bottom follow, upward reading position and latest return; no focus stealing or scroll jump caused by disclosure updates. Deliberate user-triggered expansion may change document height but follows the existing scroll policy.
- Pinned source/ports/hashes, standalone official primitives, transport/persistence and user bubbles remain unchanged.

The previous restored `waiting + no pending` announcement contract gap is tracked in the predecessor acceptance; this spacing change neither resolves nor silently redefines it.

## 6. Verification Design

Create a fixture matching the screenshot sequence with three primary prose blocks, tool summaries and repeated reasoning. Provide both a single-message version and a version containing several assistant messages in one turn; also add a second user turn. The variants must preserve original message/Part identities and include visible approvals/results and empty bookkeeping wrappers.

Use mounted box measurements after layout/animations settle, with a tolerance of 1 CSS pixel at default scale. Verify the exact gutter table, closed zero-footprint and unchanged target heights. A CSS-string assertion alone is insufficient. At 200% zoom or increased root text size, check reflow and readable/non-overlapping controls rather than asserting default pixel sizes.

Recheck grouping/count/order, append/completion/split/merge, detail focus/copy/offsets, scroll/latest/restore and Chat/Agent/Writer/Workflow AI consumers. Capture light/dark/narrow screenshots under production styles and a rebuilt native macOS replay. Independently rendered official primitives retain their own geometry. Do not claim new audible speech evidence from DOM; use existing human evidence only for its original run, and request new manual listening only if speech behavior changes.

## Alternatives / Risks

- Uniform gap reduction is simple but gives process, prose, attention and turn boundaries the same rhythm; rejected.
- Whole-turn aggregation is denser but changes chronology and message identity; rejected.
- Contextual spacing is slightly more explicit; classification must follow visible render paths and not raw Part count. Workflow business summaries and multi-message boundaries are the highest-risk cases and require mounted tests.
- The supplied image cannot establish its deployed renderer or exact CSS dimensions. Runtime fixture/native inspection must precede any root-cause or completion claim.
