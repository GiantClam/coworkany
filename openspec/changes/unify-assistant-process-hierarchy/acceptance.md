# Assistant process hierarchy — implementation evidence

Date: 2026-09-30. Scope: approved `unify-assistant-process-hierarchy` delta only. The checkout already contained unrelated/staged work, which was preserved. No commit, archive, provider invocation or dependency addition was performed.

## Delivered behavior

- Every assistant text remains primary: 16px/26.4px. Adjacent eligible thinking/tools share one secondary, default-closed process interval: 13px/20px, 14px icons, 32px desktop targets, 16px surface separation and 4px internal gap.
- Normal settled headers have no Brain/Check icon, fabricated duration or redundant “view process” suffix. Active headers use actual reasoning/tool lifecycle, observed unique tool counts and one concise polite status region.
- Visible text, approvals, questions, tasks, warnings, sources and useful results retain chronological positions. Workflow AI keeps legacy tool-only groups and visible business summaries.
- Same-call lifecycle patches are deduplicated only within one interval. Across visible boundaries, original references stay in place and occurrence IDs (`tool:id`, `tool:id:1`) own separate portal hosts/disclosure choices. No global tool canonicalization remains.
- Inspection reuses existing message-scoped hosts/choices, bounded lists and complete copy actions. Merges reconcile open; an explicit merged close updates all members. No inferred commentary/final text roles were added.
- Styling remains surface-scoped. Pinned/official standalone primitives and provenance were not modified by this implementation.

## Changed files

Production:

- `packages/workbench-ui/src/tool-activity.ts`: mixed chronological projection, occurrence identities, truthful localized summaries; legacy projection retained.
- `packages/workbench-ui/src/tool-activity-group.tsx`: ordered reasoning/tool steps, occurrence-owned portals, disclosure reconciliation and local scroll restoration.
- `packages/workbench-ui/src/workbench-message-surface.tsx`: shared projection integration and one current-phase owner; text/result/interaction renderers retained.
- `packages/workbench-ui/src/styles.css`: scoped primary/process hierarchy, bounded inspection and focus/coarse-pointer/reduced-motion rules.

Tests/fixtures:

- UI tests: `tool-activity.test.tsx`, `tool-activity-surface.test.tsx`, `message-visual-contract.test.tsx`, `workbench-message-surface.test.tsx`.
- Desktop fixture: `apps/desktop/test/tool-activity-acceptance.tsx` and `.css`.
- Mounted helper: `scripts/process-hierarchy-acceptance.mjs`; existing `scripts/tool-activity-acceptance.mjs` reused unchanged.
- This change's plan, proposal, task ledger and acceptance evidence. Predecessor acceptance records remain historical and untouched.

The simplification removes separate surface reasoning triggers and duplicate current-phase rows, reuses the existing activity disclosure/portal owner, and does not introduce a new component package or transport schema.

## Automated gates

All final runs passed:

| Gate | Result | Log |
| --- | --- | --- |
| `pnpm --filter @coworkany/workbench-ui test` | 183/183 | `/tmp/coworkany-process-ui-final3.log` |
| `pnpm --filter @coworkany/workbench-client test` | 44/44 | `/tmp/coworkany-process-client-final.log` |
| `pnpm --filter @coworkany/desktop test` | 502/502 | `/tmp/coworkany-process-desktop-final.log` |
| Affected three-package typechecks | Passed | `/tmp/coworkany-process-typecheck-final.log` |
| Final fixture typecheck | Passed | `/tmp/coworkany-process-fixture-typecheck.log` |
| Root lint + targeted UI/fixture ESLint | Passed | `/tmp/coworkany-process-lint-final.log`, `/tmp/coworkany-process-eslint-final.log`, `/tmp/coworkany-process-fixture-eslint.log` |
| Shared boundaries + implementation provenance + provenance tests | Passed, 4/4 | `/tmp/coworkany-process-static-final.log` |
| Strict OpenSpec: current change + three affected predecessors | All four valid | `/tmp/coworkany-process-spec-final.log` |

The earlier red gate deliberately failed 8 new surface contracts before implementation (`/tmp/coworkany-process-red.log`). Final read-only review found no blocking chronology, repeated-ID, portal-key or CSS-scope issue. Final model/surface focused review passed 41 tests before the last additional SSR occurrence regression; full UI run above includes that regression.

## Mounted Browser verification

Executed through the selected in-app Browser against the fixture at port 1431 with the complete production CSS stack. Fixture controls drive mutations; DOM evaluation only inspects rendered state.

- 1/10/50 mixed calls: one closed header, respectively `Process · 1/10/50 tool operation(s)`, no raw input/output leak.
- Tool 21 inspection: detail choice, copied feedback, focus and 572px list offset retained through approval split/merge. Appending call 51 and completion retain the inspected call; only the selected output expands.
- Closed first interval + open second interval merge open; explicit merged close remains closed after tool/reasoning append and completion. Reopening preserves individual detail choice.
- Mixed members retain original reasoning/tool order; appended reasoning retains identity and group choice. Active reasoning stays closed with exactly one polite status; settled empty reasoning disappears and unknown duration stays neutral.
- Repeated logical ID around text renders two distinct live calls: `tool:repeated-call` owns `first.txt`/`FIRST_INTERVAL_OUTPUT`; `tool:repeated-call:1` owns `second.txt`/`SECOND_INTERVAL_OUTPUT`. No duplicate host/key or relocated detail.
- Full output copied/pasted through clipboard verification: 27,642 characters and the terminal sentinel intact. Failure inspection and approval denial remain reachable.
- Long reasoning content: 200px bounded viewport; process list 432px at the 720px fixture viewport, scrollable, no nested bottom margin. Reasoning keyboard focus and local scrolling remain available.
- Scroll-up reading position retained across revision (final run 1453.5px before/after); latest return works. Restored scroll retained at 420px before/after revision with closed process groups.
- Chat, Agent and Writer fixture route controls use the shared renderer and preserve typed-result labels. Production shared consumer wiring and existing route tests passed. Workflow AI keeps two legacy tool runs around reasoning; all 10 business summaries remain visible before/after selected detail expansion, with no duplicated summaries or raw inputs.
- Light process contrast approximately 5.10:1; dark 9.64:1. Primary text exceeds 16:1. All visible assistant prose computes 16px/26.4px; process triggers 13px/20px with 32px height, chevrons 14px, outer gap 16px.
- Narrow fixture stage: 390px; inner content width and scrollWidth both 314px, no horizontal overflow. This is a narrow stage, not mobile viewport/device emulation.
- Independent official fixture retains its Brain icon, 14px reasoning type, 16px reasoning bottom margin and original tool primitive. Surface CSS does not leak to that fixture.
- Reduced-motion fixture simulation computes spinner duration 0.00001s; production media rule explicitly disables spinner animation and chevron transitions. The system media preference remained false during verification.

Screenshots under `.artifacts/process-hierarchy-20260930/`:

- `chinese-light.jpeg`, `chinese-dark.jpeg`, `chinese-dark-narrow.jpeg`: the supplied screenshot's Chinese prose rendered with the new hierarchy.
- `official-light.jpeg`, `official-dark.jpeg`: independent official primitive references.
- `native-collapsed.jpeg`, `native-tool-expanded.jpeg`: rebuilt Tauri WebView historical replay and selected tool inspection.

## Rebuilt native desktop

Build command:

```sh
pnpm --filter @coworkany/desktop exec tauri build --config src-tauri/tauri.macos.conf.json --config '{"build":{"beforeBuildCommand":"pnpm exec vite build"}}' --target aarch64-apple-darwin --bundles app --no-sign
```

Passed (`/tmp/coworkany-process-native-frozen.log`). The override reuses already-staged runtime resources while rebuilding the production Vite frontend and ARM64 native binary. Existing >700kB chunk warning remains; this task does not add bundler/dependency changes.

Embedded frontend asset matches `apps/desktop/dist/assets/desktop-app-B2MpHvyB.js`. Before local ad-hoc signing, built binary and isolated verification clone both had SHA-256 `67cbaacba1491a58443246eb2b01f07b82be8bc6c8795e3be57a4083a1de184d`.

Native QA used a cloned bundle, separate bundle identifier `com.coworkany.processverify`, portable cloned historical data and no new AI requests. The first refreshed clone stalled while opening SQLite before UI startup; a diagnostic sample located that in native startup rather than the message renderer. It was terminated by exact owned PID and verified successfully from isolated `/tmp/coworkany-process-native.bjavpI/`, without changing product storage code or user data. The isolated QA clone was ad-hoc signed for local launch; this is not a release notarization/signing validation.

The real `tauri://localhost` WebView restored the existing package-summary conversation. Chinese prose, default-closed thinking/tool labels, tool/call expansion, parameter copy action and directly visible Markdown artifact download action were present in its accessibility tree and screenshots. Native history has intervening text Parts; these remain boundaries rather than being incorrectly aggregated. Actual tool output/copy completeness was separately verified in the mounted fixture above.

## Open acceptance / limits

- Task 5.3 remains unchecked for actual screen-reader spoken phase announcements and real coarse-pointer/system reduced-motion sessions. DOM live-region count, keyboard actions, native AX names, the 44px coarse CSS rule and fixture motion simulation are supporting evidence, not those real-device checks.
- Windows WebView2, other native platforms, a real mobile viewport/touch device, release signing/notarization and live-provider streaming were not exercised. No new provider requests were needed for this rendering-only change.
- `scripts/check-message-visual-parity.mjs` still targets the prior port 1427 and its standalone run failed to connect; it was not used as evidence. Independent official/production comparisons were performed in the selected Browser at 1431 instead.
- No automatic OpenSpec archive or all-tasks-complete claim. Commentary/final role distinction remains intentionally deferred.

## Native task 5.3 follow-up — 2026-09-30

The preceding results/limits are historical. This follow-up rebuilt the ARM64 desktop with TypeScript + production Vite, and exercised the production renderer in a separate, locally compiled Tauri QA bundle at `tauri://localhost/test/fixtures/tool-activity-acceptance.html`. The fixture entry/config were QA-only: the normal application entry, route, storage and provider configuration were not changed. Both QA and release verification clones use isolated bundle identities and cloned portable history under `/tmp/coworkany-spec53.SUNkRh/`; no user data or live-provider requests were required.

### Accessibility boundary repair

Inspection reproduced the phase live region beneath a streaming Message's `aria-busy="true"`. Assistive technologies may defer updates in a busy container ([WAI-ARIA](https://www.w3.org/TR/wai-aria/#aria-busy)). The targeted repair keeps one initially empty, always-mounted polite/atomic region outside the busy Message and Conversation log. Only phase/message identity changes update it, after registration; completion clears it rather than removing it. The visible waiting/writing/approval feedback remains, without a second live role. The same activity projection supplies both paths; no grouping, transport or persistence behavior changed.

The pending-activity regression failed against the old implementation before the repair (tool output only; no persisted red log). Final UI tests passed 184/184. Mounted verification and native QA recorded the exact sequence `"" → Thinking → "" → Running tools → "" → Writing → ""`, with one status region, zero node replacements during the sequence and no busy ancestor. The timed fixture holds each phase for 12 seconds, uses the same assistant message ID and records actual DOM mutations. Its controls are non-live and do not move focus. These records establish the announcement updates, not audible speech.

### Native checks completed

- Keyboard: Tab/Shift+Tab reach the process and call buttons; Space closes the process; Return reopens it and opens the first call's parameters/result. AX focus remains on the activated button. This was repeated on the final rebuilt QA bundle with VoiceOver enabled.
- Actual macOS Reduce Motion: user-authorized system preference ON; native WKWebView `matchMedia('(prefers-reduced-motion: reduce)') === true`, fixture motion flag OFF, production spinner animation `none` while tools run. After restoring the setting, the same native WebView reports `false`.
- Coarse-pointer target: the QA control activates the existing production `(pointer: coarse)` CSSMediaRule, rather than injecting a substitute rule. The native trigger measures 44px (baseline 32px, 13px text). This is rule simulation: native pointer media remains false; no physical touch device is claimed. The rule was restored and a cold restart again measured 32px.
- Scroll: native reading position 4819px remains 4819px after a same-message revision; latest return reaches 5420px. Restored conversation remount gives 420px, and a subsequent revision preserves 420px. The deliberate remount replaces the region once, as expected; it does not replay completed phase text. A full QA app quit/relaunch also completed.
- Final mounted regression helpers pass reasoning lifecycle, mixed chronological order, appended reasoning identity, closed-first/open-second merge, explicit merged close and individual call-choice preservation with the repaired announcement boundary.
- Actual VoiceOver was enabled, its speech was not muted, and two native phase sequences ran while it was active. The agent cannot capture system audio or the background VoiceOver caption panel through the available Computer Use surface. Actual spoken/no-duplicate confirmation was requested from the user; it is still required before checking task 5.3.

The Mac locked during the final reload/restoration step. The user manually unlocked it, then verification continued. Both temporarily changed system settings were restored to their original OFF values via System Settings. VoiceOver's process subsequently exited; the native WebView confirmed reduced-motion false. No other system preference was changed.

### Fresh gates and build artifacts

All fresh executable gates passed:

- UI 184/184 (`/tmp/coworkany-spec53-ui-final.log`), client 44/44 (`/tmp/coworkany-spec53-client-final.log`), desktop 502/502 (`/tmp/coworkany-spec53-desktop-final.log`), provenance tests 4/4 (`/tmp/coworkany-spec53-provenance-tests.log`).
- UI/client/desktop TypeScript, root lint, targeted UI/fixture ESLint, shared boundaries/provenance and all four strict OpenSpec validations passed (`/tmp/coworkany-spec53-*.log`).
- QA frontend + native release builds passed (`/tmp/coworkany-spec53-qa-frontend-final.log`, `/tmp/coworkany-spec53-native-qa-final.log`).
- Final normal production desktop build passed (`/tmp/coworkany-spec53-release-final.log`), using `beforeBuildCommand="pnpm exec tsc --noEmit && pnpm exec vite build"`, target `aarch64-apple-darwin`, bundle `app`, `--no-sign`.
- Normal app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app`. Its native binary SHA-256 is `e6688e8ff7bc8d2e1677b27463aef0a33f16420312df134fcb9bafe4a358f19e`. The isolated release clone was locally ad-hoc signed and signature verification passed; signing changes its binary hash. This is not notarization/release-signing verification. Existing >700kB chunk warnings remain.

Additional screenshots in `.artifacts/process-hierarchy-20260930/`: `native-spec53-keyboard.jpeg`, `native-spec53-scroll-up.jpeg`, `native-spec53-metrics.jpeg`, `native-spec53-settings-restored.jpeg`.

The final normal release clone was cold-started and left running with the existing package-summary history at `tauri://localhost/dashboard/ai/conversation-c4425a95-bade-487c-aa47-5a6ed211bea2`. Its thinking/tool intervals were initially collapsed; tool/call disclosures and complete-parameter copy remained reachable, and Markdown artifact/download controls stayed directly visible. Screenshots: `native-spec53-final-replay.jpeg`, `native-spec53-final-tool.jpeg`. This final clone initially became unresponsive: a native process sample located a synchronous `read_artifact → artifacts::inspect → File::open` on the main thread, and the cloned config still referenced the old verification workspace. Only the isolated copy's `workspacePath` was corrected to its local cloned `projects` directory, then that exact owned app/runtime process pair was terminated and relaunched successfully. No production startup/storage code or original config/database was changed. The normal compiled bundle itself was not altered by this QA-path correction.

This follow-up changed only the message-surface live-region boundary, its regressions, QA fixture/metrics, mounted helper and this change's evidence. Task 5.3 stays unchecked solely pending actual spoken-phase confirmation; physical touch-device and other-platform coverage remain explicitly unclaimed, not inferred from CSS simulation.

### Spoken-evidence continuation — 2026-09-30 21:24 CST

The user's continuation is not confirmation that the phases were heard. Read-only searches of the recent VoiceOver unified logs for `Thinking`, `Running tools`, `Writing` and speech-subsystem entries returned no matching records. No VoiceOver audio export was found on the Desktop. VoiceOver Utility's View menu exposes category navigation; its File menu exports preferences, not speech records. No preference was changed during this continuation, and VoiceOver remains stopped.

Apple documents both a caption panel and saving the last spoken phrase as audio with VO-Shift-Z ([caption panel](https://support.apple.com/en-gb/guide/voiceover/unac078/mac), [save spoken phrase](https://support.apple.com/en-euro/guide/voiceover/vo2725/10/mac/27)). The available Computer Use surface cannot read the background caption panel or invoke global VoiceOver shortcuts. Completing the remaining gate therefore needs a human's actual listening observation or a human-triggered audio export; no DOM/log substitute or affirmative observation is inferred. Exported archives also contain troubleshooting logs, so only relevant audio should be shared.

The running normal release verification clone still displays the historical message surface with collapsed process intervals and direct artifact controls. It additionally reports `opencode_session_attach_failed:opencode_request_timeout:30000`. This is an observed runtime attachment limitation, not a successful live-session restore or evidence of its cause; no live-provider request, runtime fix or new all-runtime-working claim was made. Historical rendering evidence remains valid, while active runtime attachment is outside this rendering-only acceptance evidence.

### Native VoiceOver replay — 2026-09-30 22:00 CST

The user's next continuation was handled by replaying the same compiled native QA fixture, with an asynchronous request for the user's actual listening result. VoiceOver was temporarily enabled within the previously authorized test scope; Reduce Motion and all other preferences were left unchanged. Its welcome/tutorial window initially intercepted interaction: the fixture stayed completed and the VoiceOver executable was not yet running. Those unsuccessful attempts are not counted as phase runs. Entering VoiceOver and closing the tutorial allowed the actual sequence to start; the VoiceOver process was independently observed running and speech mute remained OFF.

The resulting native metrics again record `"" → Thinking → "" → Running tools → "" → Writing → ""`, one empty status region after completion, zero phase-node replacements and no busy ancestor. Desktop target height is 32px, trigger font 13px, reduced-motion/coarse-pointer/simulation flags false. Evidence screenshot: `.artifacts/process-hierarchy-20260930/native-spec53-voiceover-replay-metrics.jpeg`. This remains evidence of interface updates during actual VoiceOver operation, not proof of speech output. The user's listening response is still pending, so task 5.3 is not checked.

After the sequence, System Settings confirmed VoiceOver OFF and a process check confirmed that its executable had exited. No new production source, fixture code, dependency or user-data change was required for this replay.

### Human spoken confirmation and task 5.3 closure — 2026-09-30 22:31 CST

The user's report of no listening result prompted read-only sound diagnostics. VoiceOver speech mute was OFF; Web live regions, keyboard/VoiceOver-cursor synchronization and automatic Tab interaction were ON, with output routed to the system default device. System Settings then showed the internal speaker selected, output volume 0.775 and output mute ON. System mute prevented audible speaker output, but does not establish whether VoiceOver had generated each utterance. No product-code defect or spoken success was inferred from that diagnosis.

The user manually opened sound. A fresh System Settings read confirmed output mute OFF and output volume 0.4375. The agent left that new user-selected audio baseline untouched. In direct response to the question about Thinking → Running tools → Writing each being spoken once, the user explicitly reported: `三个阶段各播报一次，无重复`. This is human-reported actual listening evidence. There is no automated audio recording or exported speech file, and no transcript inferred from DOM/AX updates.

The confirmation arrived while an additional native replay was being prepared, before its phase control was activated; that additional run is not claimed as completed or timestamp-correlated to the observation. The user-reported spoken/no-duplicate result supplies the previously missing manual gate alongside the native phase sequences and other 5.3 checks already documented above. Task 5.3 is now checked; the approved task ledger is complete without weakening its requirements.

The temporarily enabled VoiceOver setting was restored OFF and its executable was confirmed absent in a fresh process check. Previously tested Reduce Motion remains restored; the user's newly enabled sound was intentionally preserved rather than reset to the earlier mute setting. This closure changes only specification/evidence/state records, not production code, dependencies or user data. Existing physical touch-device, other-platform, signing/notarization, live-provider and runtime session-attachment limitations remain unclaimed. No automatic archive or commit was performed.

After recording the human confirmation, fresh strict OpenSpec validation passed for this change, `compact-tool-call-activity`, `preserve-assistant-turn-stream-order` and `restore-ai-elements-message-visual-parity`. Scoped `git diff --check` passed and the authoritative task ledger contains no unchecked tasks. Production test/build results above are prior executable evidence, not newly rerun suites in this documentation-only closure.

Final System Settings inspection reconfirmed VoiceOver OFF and system output mute OFF. The output volume now reads 0.625 (62%), rather than the user's earlier 0.4375; the agent did not operate the volume or mute controls and preserved the live user-owned setting. The isolated QA window was quit; no original app configuration or history was modified.

## Fresh regression — 2026-09-30 22:47 CST

Result: all executed gates pass; one restored-waiting accessibility contract/coverage gap remains below. This regression does not replace the earlier human-reported spoken confirmation or claim that every possible lifecycle path was tested. No application source, dependency, system preference, audio setting or user data changed in this run.

### Executable gates

Fresh logs are in `/tmp/coworkany-process-regression.gJgyx2/`:

- `pnpm --filter @coworkany/workbench-ui test`: 184/184, zero failures/skips (`ui.log`).
- `pnpm --filter @coworkany/workbench-client test`: 44/44, zero failures/skips (`client.log`).
- `pnpm --filter @coworkany/desktop test:release`: 502/502, zero failures/skips (`desktop.log`; sequential test concurrency).
- UI/client/desktop `typecheck`, root `pnpm lint`, and targeted ESLint for the activity projection, message surface, affected tests and desktop QA fixture passed. The mounted helper separately passed `node --check`.
- Shared boundary/provenance checks and their tests passed: 4 boundary + 4 provenance tests (`static.log`).
- `pnpm --filter @coworkany/desktop exec vite build --outDir /tmp/coworkany-process-regression.gJgyx2/frontend` passed (`frontend-build.log`). The existing >700kB chunk warning remains. This is a fresh production frontend build, not a new native Tauri build.
- Strict OpenSpec validation passed for this change and the three affected predecessors (`spec-*.log`).

The first targeted lint invocation included an intentionally ignored `.mjs` script and failed `--max-warnings=0` for that ignored-file warning. The in-scope TS/TSX lint invocation then passed; no lint configuration or warning suppression was added. An initial `tsx -e` reproduction also hit CJS/ESM import incompatibility; rerunning through Node's ESM entry succeeded. These invocation issues are not application failures.

### Mounted production-renderer regression

The selected Browser exercised the current worktree fixture at port 1431, through visible controls. Checks passed for:

- Reasoning lifecycle: streaming stays default-closed, unknown duration is not invented, completed empty reasoning disappears, active empty reasoning retains feedback; one status region outside the busy message, no duplicate visible phase feedback.
- Mixed chronology: reasoning → calls 1–5 → reasoning → calls 6–10. Appending reasoning preserves group choice and adds the third identified step.
- Closed-first/open-second merge: the merged interval remains open, individual call choice survives, explicit merged close remains closed after append/completion.
- 1/10/50-call density: exactly one initially closed mixed interval, truthful unique count, all calls and two reasoning steps reachable after expansion. Long reasoning stays bounded at 200px; process list at 432px in the 720px fixture.
- Light/dark and Chinese narrow presentation: primary prose 16px/26.4px, process text 13px/20px, desktop trigger 32px, icon 14px, outer gap 16px. Dark narrow stage 390px has inner width/scrollWidth both 314px. Screenshots: `chinese-light.png`, `chinese-dark-narrow.png` in the log directory. The light capture uses Chinese prose with English controls; the dark narrow capture uses Chinese controls. This is a narrow stage, not a physical touch device.
- Reading position remains 1437px after a same-message revision. Latest return reaches 5417px against a 5418px maximum after its smooth-scroll animation settles. Restored 420px remains 420px after another revision.
- Chat, Agent and Writer each retain one process group and their directly visible typed result. Workflow AI retains all ten business summaries even while its separate tool group is opened.
- Phase sequence records `"" → Thinking → "" → Running tools → "" → Writing → ""`, one status region, zero node replacements and no busy ancestor. This is DOM evidence only; no new actual speech, native WebView, system reduced-motion or physical coarse-pointer run is claimed. The previously recorded human/native evidence remains separate.
- The checked page's warning/error console log is empty.

An initial helper sequence reused a fixture left in `reasoning-only + empty-reasoning` mode, so the next mixed test could not find a process button. Resetting the fixture before each helper resolved it and all three helpers passed. An immediate latest-position assertion ran before smooth scrolling finished; its settled measurement passed. Neither required a product change.

### Restored waiting approval: coverage risk, not a confirmed live-flow regression

Read-only independent review and an ESM static-render reproduction (`waiting-approval.log`) confirm:

- `runStatus: waiting`, no `pendingMessageId`: approval remains directly reachable, but no visible activity/busy marker is supplied; the phase region has no active message to announce.
- `runStatus: waiting`, matching pending ID: approval remains reachable and “Awaiting approval” activity/busy feedback is supplied, as for running.

The current production Chat/Writer consumers retain pending identity while the run is owned; the legacy permission handler does not change the message metadata to waiting. No normal live approval failure was established. The shared surface deliberately uses run ownership rather than stale persisted stream Parts; treating every historical waiting message as streaming would require an explicit lifecycle decision, not a blanket change.

The uncovered cases are restored waiting without pending ownership and a mounted `running + pending → waiting + no pending` transition. The spec does not explicitly say whether such historical/recoverable messages should announce as active. Follow-up should define that contract and add those two tests; the static render does not prove actual speech. This risk does not reopen the completed human-listening gate in 5.3. The separate known runtime session-attachment timeout, platform/device and release-signing limits above are not retested or fixed here.
