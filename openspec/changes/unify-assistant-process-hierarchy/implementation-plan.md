# Unified Assistant Process Hierarchy Implementation Plan

> **For agentic workers:** Execute this approved plan task-by-task with OpenSpec apply and bounded Codex native subtasks. The optional superpowers execution skills are not available in this session; existing OpenSpec tasks remain the completion ledger.

**Goal:** Give answer text visual priority while merging only adjacent reasoning/tool traces into stable, default-closed process summaries.

**Architecture:** Extend the existing chronological activity projection and message-scoped portal/disclosure ownership. Keep legacy tool-only behavior for Workflow AI; render reasoning as ordered inspectable steps inside the same shared process list. All visual overrides stay within WorkbenchMessageSurface.

**Tech Stack:** TypeScript, React, existing Radix Collapsible, Streamdown, pnpm/tsx tests, production desktop CSS, in-app Browser and Tauri WebView.

**Execution status (2026-09-30):** Implementation and executable gates passed; see `acceptance.md` and the authoritative `tasks.md` ledger. The checklist below is the original execution plan, not a second completion ledger. Native keyboard, system reduced motion, production coarse-pointer CSS rule simulation, scroll/latest return and replay/reload were verified. The user explicitly confirmed actual spoken phases once each without duplication, closing task 5.3 and the task ledger. Physical touch-device coverage and a runtime-session-attachment fix are not claimed. The change has not been archived.

## Global Constraints

- Preserve original Parts/identities and visible chronology; no transport, persistence, runtime or dependency changes.
- Do not edit pinned upstream/official primitives or revert unrelated dirty-worktree changes.
- Primary assistant response: 1rem, line-height 1.65; process: .8125rem/20px, 14px icon, targets at least 32px desktop / 44px coarse pointer.
- Internal step gap 4px; process-to-primary gap 16px; normal text contrast at least 4.5:1 in both themes.
- Process list max-height min(28rem,60vh); reasoning step 200px; raw details min(24rem,50vh).
- Default closed while running/settled; preserve explicit member choices and tool details. OR reconciliation keeps a merged group open when any existing member choice is open.
- workflowAi=true tools are mixed-process boundaries in every lifecycle state and use existing tool-only summaries/business content.
- No inferred commentary/final roles or fabricated duration/count/progress.
- Do not auto-commit this dirty checkout; deliver a reviewed diff and execution evidence.

## Task 1: Ordered projection and truthful labels

**Files:** Modify `packages/workbench-ui/src/tool-activity.ts`; test `packages/workbench-ui/test/tool-activity.test.tsx`.

**Interfaces:** Preserve `groupToolActivityParts` and `summarizeToolActivity` for legacy Workflow AI. Add these surface interfaces:

```ts
export type ReasoningActivityPart = Extract<DesktopUIMessagePart, { type: "reasoning" }>;
export type ProcessActivityPart = ToolActivityPart | ReasoningActivityPart;
export type ProcessActivityMember = {
  readonly id: string;
  readonly part: ProcessActivityPart;
  readonly index: number;
};
export type ProcessActivityEntry = ToolActivityEntry | {
  readonly type: "process-group";
  readonly id: string;
  readonly members: readonly ProcessActivityMember[];
};
export type ProcessActivityContext = { readonly active: boolean; readonly workflowAi?: boolean };
export type ProcessActivitySummary = ToolActivitySummary & {
  readonly kind: "reasoning" | "tools" | "mixed";
  readonly reasoningActive: boolean;
};
export function groupProcessActivityParts(parts: readonly DesktopUIMessagePart[], context: ProcessActivityContext): readonly ProcessActivityEntry[];
export function summarizeProcessActivity(parts: readonly ProcessActivityPart[], locale: "zh" | "en", active: boolean): ProcessActivitySummary;
```

- [ ] Add failing tests for reasoning→text→tools→reasoning→tools→text, reasoning-only, every visible boundary, workflowAi=true, empty reasoning and unique lifecycle counts. Example assertion:

```ts
const entries = groupProcessActivityParts(parts, { active: false });
assert.deepEqual(entries.map(entry => entry.type), ["process-group", "part", "process-group", "part"]);
const group = entries[2];
assert.equal(group.type, "process-group");
if (group.type === "process-group") {
  assert.deepEqual(group.members.map(member => member.part.type), ["dynamic-tool", "reasoning", "dynamic-tool"]);
  assert.equal(summarizeProcessActivity(group.members.map(member => member.part), "zh", false).label, "处理过程 · 2 次工具操作");
}
```

- [ ] Run `pnpm --filter @coworkany/workbench-ui exec tsx --test test/tool-activity.test.tsx`; record the intended missing-interface/assertion failure.
- [ ] Extend the original single ordered scan: omit bookkeeping/settled empty reasoning; flush on visible boundary; deduplicate calls at their first logical position with latest reference; key members by namespaced toolCallId or reasoning partId/index. When workflowAi=true, retain legacy tool-run entries between reasoning segments.
- [ ] Derive process kind/labels from actual members and reuse existing outcome accounting/action mapping. Only active-message streaming reasoning is active. Keep tool counts independent of reasoning and no unknown elapsed-time label.
- [ ] Rerun the focused test and package typecheck; hand off exported interfaces without touching other modules.

## Task 2: Stable surface integration and regressions

**Files:** Modify `packages/workbench-ui/src/tool-activity-group.tsx`, `packages/workbench-ui/src/workbench-message-surface.tsx`; test `tool-activity-surface.test.tsx`, `workbench-message-surface.test.tsx`.

**Consumes:** Task 1 exports. **Produces:** One shared activity renderer accepting optional ProcessActivityMember rows and preserving existing ToolActivityGroup/ToolActivityPortals exports and legacy Workflow AI props.

- [ ] Add failing SSR regressions before component edits: mixed process has one closed summary, no reasoning text/brain/estimated duration/raw data; text/results remain visible; streaming reasoning has one phase status and no auto-open.
- [ ] Extend message-scoped group choices to namespaced reasoning/tool membership while retaining call-level state/portal hosts. Reconcile member choices with OR; update every current member on explicit group toggle; inherit existing choice for newly appended members.
- [ ] Add an ordered process mode to ToolActivityGroup; render tool members through fixed hosts and reasoning members through existing Reasoning/ReasoningContent with controlled open content. Do not render a nested Thinking trigger for each step. Keep selected raw tool details a second disclosure.
- [ ] Integrate the new projection with primitive message context:

```tsx
const entries = useMemo(
  () => groupProcessActivityParts(message.parts, { active: streaming, workflowAi }),
  [message.parts, streaming, workflowAi]
);
```

- [ ] Keep all text/result/non-eligible renderers and Workflow AI business-summary deduplication unchanged. Route all process-group members through existing portals at message scope. Suppress the duplicate trailing reasoning/tool phase when a process header owns that active phase; keep waiting/writing/approval and one polite phase-announcement region.
- [ ] Run `pnpm --filter @coworkany/workbench-ui exec tsx --test test/tool-activity-surface.test.tsx test/workbench-message-surface.test.tsx`; fix only expectations explicitly superseded by this spec.

## Task 3: Surface geometry and independent fixture evidence

**Files:** Modify `packages/workbench-ui/src/styles.css`, `packages/workbench-ui/test/message-visual-contract.test.tsx`; extend `apps/desktop/test/tool-activity-acceptance.tsx` and its fixture CSS only as needed for mixed reasoning/streaming scenarios.

**Consumes:** Task 2 process slots/controlled props. **Produces:** Scoped hierarchy and deterministic mounted acceptance controls.

- [ ] Lock primitive preservation and surface overrides in tests before CSS edits; leave official provenance files untouched.
- [ ] Apply primary/secondary typography with scoped selectors, remove inherited nested process margins, add 4px internal gap and 16px primary separation, use theme-aware accessible process color. Keep focus/coarse-pointer/reduced-motion rules.
- [ ] Add explicit fixture controls for mixed reasoning, reasoning-only streaming/completion, empty/history reasoning and long reasoning. Existing approval, append, complete, interleaving, failure, long-output, Workflow AI and restoration controls remain functional.
- [ ] Start the fixture with `pnpm --filter @coworkany/desktop exec vite --host 127.0.0.1 --port 1431 --strictPort` after a read-only port check.
- [ ] The flow under test is: production fixture → closed process summary → keyboard expansion → ordered reasoning/tool steps → selected details → append/completion/approval split-merge → preserved manual state/focus/scroll → restore closed.
- [ ] Use the available in-app Browser for fresh DOM, computed geometry/contrast, console, interaction and screenshot evidence. Capture light/dark, narrow, 1/10/50 calls and attention/results. Save temporary screenshots/reports outside source; record verdict JSON under the scoped OMX state and paths in acceptance.md. The named visual-verdict skill is unavailable; use screenshot review plus these state/geometry assertions instead.

## Task 4: Full gates and handoff

**Files:** Update this change's `tasks.md`, `proposal.md`, `acceptance.md`; implementation source/test files from Tasks 1–3 only.

- [ ] Run UI tests/typecheck, client tests/typecheck, desktop tests/typecheck, targeted ESLint and shared-boundary/provenance checks; use the existing package scripts.
- [ ] Build the production desktop frontend and macOS native bundle with existing scripts/config; inspect the rebuilt WebView through available desktop tooling. Record unsupported-platform/screen-reader limitations explicitly rather than claiming coverage not performed.
- [ ] Run strict OpenSpec validation for this change and the three affected predecessors, then scoped whitespace/static checks.
- [ ] Review only the task diff for chronology/state/attention defects; repair and repeat affected tests/browser paths when findings require edits.
- [ ] Update completion checkboxes against actual evidence. Final handoff includes visible result, source/spec links, passing gates, screenshot evidence and remaining risks; do not archive or commit automatically.
