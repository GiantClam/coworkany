## 1. Specification

- [x] 1.1 Record approved direction, screenshot/source evidence, exact spacing values and protected behavior.
- [x] 1.2 Define same-message versus cross-message precedence, zero-footprint rules and measurable scenarios.
- [x] 1.3 Self-review scope/contradictions and pass strict validation for this change and affected predecessors.

## 2. Baseline / Regression Fixtures

- [x] 2.1 Inspect mounted production/native DOM boxes and record actual gap/margin/hidden-wrapper contributors; distinguish screenshot inference from measured cause.
- [x] 2.2 Add single-message and multi-assistant-message versions of the supplied sequence, a second user turn, 1/10/50 calls and reasoning-only/tool-only cases.
- [x] 2.3 Add mounted failing assertions for 4/8/12/16px output gutters, 16px consecutive-assistant rows, 32px user/turn boundaries and closed zero-footprint; allow 1px rounding tolerance.
- [x] 2.4 Lock existing chronology, stored Part/message identity, approvals/questions/results, Workflow AI business boundaries, primary typography and 32/44px targets before styling changes.

## 3. Implementation

- [x] 3.1 Apply surface-owned relative gutter tokens and deterministic existing-render-path block classification; remove overlapping spacing only at affected boundaries.
- [x] 3.2 Apply consecutive-assistant row spacing without changing timeline order, turn grouping, message IDs or visible metadata/actions.
- [x] 3.3 Ensure closed details/non-rendered layout wrappers introduce no extra footprint while preserving mounted hosts, disclosures and active feedback.
- [x] 3.4 Keep existing same-message eligible grouping, localization, attention/results, bounds and official-source integrity; add no dependency or persistence field.

## 4. Verification / Delivery

- [x] 4.1 Run UI/client/desktop tests, affected typechecks, lint and shared boundary/provenance checks; verify repaired tests fail against the old geometry and pass after the change.
- [x] 4.2 Measure default-scale gutters/targets and capture light/dark/narrow production fixtures; check 200% zoom/reflow, isolated official primitives and all four consumer paths. Reopened for metadata bounds on 2026-10-01, then closed after the scoped wrapping repair passed the browser/native 16-state matrices and four consumer paths.
- [x] 4.3 Recheck mounted append/completion/split/merge, keyboard/focus/copy/list offsets, stable phase region, reduced-motion rules, upward reading/latest/420px restore/reload. Do not infer audible speech or physical coarse-device verification.
- [x] 4.4 Build the production frontend and native macOS desktop; measure replay geometry in the rebuilt WebView. Record any provider/platform/signing limitations separately.
- [x] 4.5 Run strict validation for this change and affected predecessors plus scoped diff checks; save new evidence without rewriting prior acceptance, and mark only actually verified tasks complete.

Execution evidence is in `acceptance.md`. Native expanded/scaled replay first found role/time metadata clipping at 390px/200%; a bounded Workbench-only wrapping repair was then implemented and verified. Browser and native 16-state matrices, consumer routes, protected behavior, rebuilt production/QA packages and QA-container restoration now pass. Historical red evidence remains in `acceptance.md`; no commit or archive was performed.

## Specification Verification — 2026-09-30

- Strict `pnpm exec openspec validate <change-id> --strict` passed for this change, `unify-assistant-process-hierarchy`, `compact-tool-call-activity`, `preserve-assistant-turn-stream-order` and `restore-ai-elements-message-visual-parity`.
- Inline self-review checked predecessor supersession, block classification, cross-message precedence, relative spacing, preserved targets/identity and evidence limits. All four added documents passed no-index whitespace checks; no unresolved marker was found.
- This delivery adds only proposal/design/task/delta-spec documents. No application source, dependency, historical acceptance or system preference changed. Implementation tests, builds and new mounted/native measurements were not executed and remain unchecked above. No commit or archive was performed.
