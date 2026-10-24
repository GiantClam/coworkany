# Compact Assistant Process Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Those skills are unavailable in this session; execute through the available approved OpenSpec apply workflow with bounded native sub-agents and leader verification. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce process whitespace using contextual gutters without changing message identity, content or interaction behavior.

**Architecture:** Classify visible output at the existing render seam with ephemeral primary/process/boundary presentation blocks. Surface-scoped relative gutters own each boundary; consecutive assistant rows use a separate row policy. Reuse existing grouping/disclosure/portal state and native fixture.

**Tech Stack:** React 19, TypeScript, existing Radix Collapsible, shared Workbench UI CSS, Node/tsx tests, Vite/Tauri, selected Codex Browser.

## Global Constraints

- Same-message process/process .25rem, primary/process .5rem, process/primary .75rem, other boundaries 1rem; default root 16px.
- Consecutive assistant rows 1rem; user/first-assistant and turns 2rem. Never group across message IDs.
- Expanded header/list .5rem; closed lists zero footprint; internal steps .25rem.
- Preserve 16px/1.65 primary prose, 13px/20px process, 14px icons, 32/44px minimum targets and all predecessor protected behavior.
- No new dependency, schema, runtime/persistence edit, pinned-source edit, historical evidence rewrite, unrelated cleanup or automatic commit.

## Task 1: Production geometry baseline and visible-block seam

**Files:** `packages/workbench-ui/src/workbench-message-surface.tsx`, `packages/workbench-ui/test/process-spacing.test.tsx`; fixture ownership is separate in Task 3.

**Interfaces:** Consume `WorkbenchMessageSurface({messages, workflowAi, ...})` and existing `groupProcessActivityParts` entries. Produce direct assistant-output children carrying `data-output-kind="primary|process|boundary"`; preserve existing child keys and original Parts.

- [ ] Measure old mounted geometry at port 1431: uniform output gap16, turn gap32, closed lists display none/height0. Save exact rendered screenshot/measurements outside the repository.
- [ ] Add a public-render regression before implementation:

```tsx
const message = {...createDesktopUIMessage({id:"spacing", role:"assistant", conversationId:"spacing"}), parts:[
  {type:"text" as const, text:"Before", state:"done" as const},
  {type:"reasoning" as const, text:"Inspect", state:"done" as const},
  {type:"text" as const, text:"After", state:"done" as const},
]};
const html = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} />);
assert.deepEqual([...html.matchAll(/data-output-kind="([^"]+)"/g)].map(m=>m[1]), ["primary","process","primary"]);
```

- [ ] Run `pnpm --filter @coworkany/workbench-ui exec tsx --test test/process-spacing.test.tsx`; record expected failure against the old renderer.
- [ ] Preserve existing entry renderer, then wrap only its non-null assistant output in a keyed presentation block. Text returns null when whitespace-only; original Parts remain untouched and active feedback remains separate. Derive Workflow business visibility from the same existing summary predicate, without another state owner/effect.
- [ ] Re-run the targeted test, then full UI tests/typecheck. Update only predecessor CSS assertions that intentionally require the superseded uniform gap.

## Task 2: Contextual CSS and closed footprint

**Files:** `packages/workbench-ui/src/styles.css`, `packages/workbench-ui/test/message-visual-contract.test.tsx`, `scripts/process-hierarchy-acceptance.mjs` (response geometry selector only).

**Interfaces:** Consume direct `data-output-kind` children from Task 1. Produce settled border-box gutters measured by Task 3; protect independent primitives.

- [ ] Run Task 3's mounted gutter helper against the old CSS first; preserve the failed 8/12px or row16 assertion as the red baseline.
- [ ] Replace the assistant-only output's uniform gap with one margin owner:

```css
.wb-ai-message-surface .ai-elements-message-assistant .wb-ai-message-output { gap: 0; }
.wb-ai-message-surface .wb-ai-output-block { min-width: 0; margin: 0; }
.wb-ai-message-surface .wb-ai-output-block + [data-output-kind] { margin-top: 1rem; }
.wb-ai-message-surface [data-output-kind="process"] + [data-output-kind="process"] { margin-top: .25rem; }
.wb-ai-message-surface [data-output-kind="primary"] + [data-output-kind="process"] { margin-top: .5rem; }
.wb-ai-message-surface [data-output-kind="process"] + [data-output-kind="primary"] { margin-top: .75rem; }
.wb-ai-message-surface .wb-ai-tool-activity-list[data-state="open"] { margin-top: .5rem; }
```

Actual patch also normalizes direct primitive margins within each block, removes empty output wrappers from layout, maintains typography through the block wrapper and keeps closed hidden lists out of layout.

- [ ] Set turn row gap0 and row sibling margin2rem, overriding consecutive assistant sibling margin1rem. Keep Conversation's inter-turn gap unchanged.
- [ ] Re-run measured helper and verify box gutters8/12/16/32 (and Workflow process/process4), open list8 and closed list0. Retain 32/44px targets and recheck repeated phases/disclosures/scroll.

## Task 3: Fixture and acceptance delivery

**Files:** `apps/desktop/test/tool-activity-acceptance.tsx`, its `.css`, new `scripts/process-spacing-acceptance.mjs`; evidence/tasks/state documents in this change.

**Interfaces:** Fixture consumes the real production `WorkbenchMessageSurface`/style stack and exposes visible single/multi-message, scaling and existing lifecycle controls. Helper reads rendered boxes only and changes fixture modes only through visible controls. No browser hidden-state injection or provider requests.

- [ ] Extend the existing fixture with screenshot prose sequence, distinct assistant message variants, second user turn and text-size200% simulation. Keep prior controls/modes intact.
- [ ] Add independently expected literal gutter assertions with 1px tolerance, not expectations derived from CSS values. Report actual typed results/metadata separately from gutters.
- [ ] Run light/dark/narrow/root-scale checks, 1/10/50 density, all consumer paths, isolated official primitives, keyboard/phase/merge/copy/scroll/restore/reload helpers; capture inspected screenshots outside the repo.
- [ ] Run `pnpm --filter @coworkany/workbench-ui test`, client test, desktop `test:release`, three typechecks, `pnpm lint`, shared boundary/provenance checks/tests and affected strict specs. Capture complete logs in the owned temporary folder.
- [ ] Rebuild frontend and ARM64 native app with already staged resources; launch only isolated QA/replay data, inspect rebuilt WebView geometry, record limits. Do not modify original config/history or system preferences.
- [ ] Complete inline review against spec/task ledger, save accurate acceptance, and mark only verified work complete. No automatic archive or commit.

## Metadata reflow repair — approved continuation, 2026-10-01

The user requested continued verification until all gates are green after the native 390px/200% clipping finding. This is a bounded repair of the existing scaled-transcript requirement, not a timestamp/content redesign.

1. Lock the rendered public seam with user/assistant role/time fragment bounds, overlap and full timestamp-presence assertions; record red against the unmodified header layout.
2. Permit surface-scoped header/time wrapping and prevent role shrink; preserve labels, dateTime/ARIA values, default typography, avatar/action layout and contextual process gutters. Do not modify pinned Message source or hide metadata.
3. Extend visible native metrics with the same fragment-bound checks. Repeat default/200% wide/narrow light/dark single/multi fixtures, disclosure selection, revision/scroll and all consumer configurations.
4. Run fresh UI/client/desktop tests, types, lint, boundary/provenance and affected specs; rebuild production and QA assets/native binaries. Verify the repaired native 390px/200% state through Computer Use, then restore the registered QA container and preserve isolated data outside delivery.
5. Mark 4.2 complete only after metadata, process geometry and protected behavior pass. Preserve historical failing/interrupted evidence; no commit/archive or system preference change.
