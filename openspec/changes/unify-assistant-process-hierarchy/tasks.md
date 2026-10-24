## 1. Specification

- [x] 1.1 Record screenshot findings, official research, scope and alternatives in proposal/design.
- [x] 1.2 Define modified parity/disclosure/grouping contracts and measurable hierarchy/chronology scenarios.
- [x] 1.3 Complete design self-review and strict OpenSpec validation; resolve contradictions before implementation.

## 2. Regression coverage before behavior changes

- [x] 2.1 Add reasoning-only, tool-only and mixed process fixtures for 1/10/50 calls, repeated reasoning Parts and original Part immutability/order.
- [x] 2.2 Lock boundaries for text, approvals/questions, task/source/warning, useful results and visible unknown Parts; verify workflowAi=true tools remain mixed-process boundaries even before their business summaries exist.
- [x] 2.3 Cover truthful unique counts, empty settled/streaming reasoning, unknown timing, mixed failures/denials and localized labels.
- [x] 2.4 Add mounted append/completion/split/merge checks for group and call choices, copied feedback, focus and bounded-list offsets; include first segment closed + later segment open merging open, followed by direct merged-group close.

## 3. Establish shared visual priority

- [x] 3.1 Add surface-scoped primary/process typography and surface-owned spacing; eliminate nested reasoning bottom-margin accumulation without changing official source.
- [x] 3.2 Simplify process labels/icons and preserve contrast, accessible names, desktop/coarse-pointer targets and reduced-motion behavior.
- [x] 3.3 Keep every assistant text readable with identical primary treatment; preserve user bubbles, Markdown and useful result actions.

## 4. Unify adjacent process presentation

- [x] 4.1 Extend the ordered activity projection to maximal eligible reasoning/tool intervals with original member identities and explicit visible boundaries.
- [x] 4.2 Render one default-closed process trigger per interval with actual lifecycle feedback; reasoning-only intervals must not auto-open while streaming.
- [x] 4.3 Reuse message-scoped disclosures/tool hosts for stable mounted inspection; preserve open-wins merge and individual detail choices.
- [x] 4.4 Render bounded chronological reasoning/tool steps and on-demand complete tool details; preserve direct attention/result/business-summary UI.
- [x] 4.5 Remove duplicate current-phase reasoning/tool activity labels while retaining busy state, one bounded announcement region and other required phases.

## 5. Verification and delivery

- [x] 5.1 Run focused/full Workbench UI tests, affected client/desktop tests and typechecks; run lint and shared-boundary/provenance/static checks.
- [x] 5.2 Capture independent official primitives and the full production surface in light/dark/narrow fixtures; verify typography, spacing, contrast and 1/10/50-call density.
- [x] 5.3 Exercise keyboard disclosures, actual screen-reader phase announcements, coarse-pointer targets, reduced motion, upward scroll/latest return and replay/reload.
- [x] 5.4 Verify Chat, Agent, Writer and Workflow AI consumers, production build and rebuilt native desktop WebView; record any unsupported-platform limits.
- [x] 5.5 Run strict OpenSpec validation for this change and affected predecessor changes; save implementation evidence without rewriting historical acceptance.
- [x] 5.6 Mark implementation tasks complete only after verification; keep commentary/final semantics deferred unless separately approved.

## Specification Verification — 2026-09-30

- Strict OpenSpec validation passed for this change, compact-tool-call-activity, preserve-assistant-turn-stream-order and restore-ai-elements-message-visual-parity.
- All four planning artifacts are complete. Placeholder scan and scoped whitespace check passed.
- Read-only review clarified the Workflow AI flag-based boundary predicate, inherited parity exceptions and closed-first/open-second merge reconciliation. Follow-up review found no remaining blocking ambiguity in those points.
- This delivery adds only specification artifacts. No application code was changed and no new runtime/build/visual verification is claimed; implementation and acceptance tasks above remain unchecked.

## Implementation Verification — 2026-09-30

- The preceding section records the earlier specification-only delivery; it is retained as historical evidence.
- Implementation and executable checks are recorded in `acceptance.md`. UI 183/183, client 44/44, desktop 502/502 and provenance 4/4 passed, together with all affected typechecks, lint, static boundaries and four strict OpenSpec validations.
- Mounted Browser checks cover 1/10/50-call density, mixed chronology, repeated IDs across visible boundaries, full copy, keyboard choices, focus, list offsets, closed-first/open-second merge, manual scroll/latest return and restored scroll. Latest ARM64 Tauri build and isolated native historical replay were verified.
- Task 5.3 remains partially unverified: real screen-reader spoken announcements and a real coarse-pointer device/system reduced-motion session were not exercised. DOM/AX, keyboard, CSS rules and fixture motion simulation do not substitute for those checks. No change archive or all-tasks-complete claim is made.

## Native Accessibility Follow-up — 2026-09-30

- The preceding section describes the earlier delivery. Fresh final UI 184/184, client 44/44, desktop 502/502, provenance 4/4 and all affected TypeScript/lint/static/strict-spec gates passed after the phase live-region boundary repair.
- Final production and QA ARM64 builds passed. Native keyboard disclosures, upward scroll/latest return, restored 420px position and cold reload were exercised. The real system reduced-motion preference was tested ON and restored OFF; production coarse-pointer CSS computed 44px under rule simulation, then returned to 32px. This does not claim a physical touch device.
- User-authorized VoiceOver was active for native phase sequences. The stable region updates Thinking → Running tools → Writing once each without token/counter updates and outside any busy ancestor. Actual audible/no-duplicate confirmation still requires the user's observation; DOM/AX does not prove speech. Task 5.3 remains unchecked until that confirmation.
- Both temporary system settings have been restored to their original OFF values. The temporary lock-screen interruption was resolved by the user's manual unlock. See `acceptance.md` for commands, logs and screenshots.
- Continuation checks found no readable VoiceOver speech record or menu-based audio export; the available Computer Use surface cannot capture system audio or invoke the global save-spoken-phrase shortcut. A continuation request is not an actual listening confirmation, so 5.3 remains unchecked. The running release clone also shows a runtime session-attachment timeout while retaining historical rendering; this limitation is recorded separately in `acceptance.md`.
- A further native VoiceOver replay completed after dismissing its welcome/tutorial interception. Fresh metrics retain the three phase updates once each, one stable region and no busy ancestor; VoiceOver was restored OFF and its process exited. An asynchronous request for the user's actual listening result remains unanswered, so this replay does not close 5.3. See the 22:00 CST acceptance entry and replay screenshot.

## Human Spoken Confirmation — 2026-09-30 22:31 CST

- Earlier pending entries above are historical. Read-only sound diagnostics found system output muted despite VoiceOver speech/live regions being enabled. The user then opened sound; System Settings confirmed output mute OFF and volume 0.4375. The agent did not change those user-selected audio settings.
- The user explicitly answered the actual-listening question: `三个阶段各播报一次，无重复`, covering Thinking → Running tools → Writing. This is human-reported spoken/no-duplicate evidence, not a claim of automated audio capture. It closes the remaining 5.3 gate together with the previously recorded native keyboard, motion, coarse-rule, scroll and replay checks.
- The response arrived while an additional replay was being prepared; that additional run is not claimed as executed. Temporarily enabled VoiceOver was restored OFF and its executable exited. No production code or dependency changed in this closure; platform/touch-device and runtime-session-attachment limits remain recorded in `acceptance.md`. No archive was performed.

## Regression Follow-up — 2026-09-30 22:47 CST

- Fresh UI 184/184, client 44/44, desktop 502/502, provenance 4/4 and boundary 4/4 tests passed, with three typechecks, lint, static checks, production frontend build and four strict spec validations.
- Mounted current-renderer checks passed for 1/10/50 density, reasoning/mixed chronology, merge and disclosure preservation, light/dark/narrow typography, scroll/latest/420px restoration, Chat/Agent/Writer and Workflow AI. Phase DOM updates remain single-region/outside-busy; no new speech or native/system-preference verification is claimed.
- Independent review identified an untested contract edge: restored `waiting` approvals without pending run ownership remain actionable but are not announced as active. Current owned live approvals retain pending identity. No product failure was established; defining and testing the restored/mounted-transition behavior is recorded as a coverage risk in `acceptance.md`, not as revocation of the earlier human-confirmed 5.3 gate.
- Only evidence/state records were changed; no product edits, dependency additions, archive or commit.
