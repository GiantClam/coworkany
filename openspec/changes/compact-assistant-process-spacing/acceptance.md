# Compact Assistant Process Spacing — Execution Evidence

Execution: 2026-09-30–2026-10-01 CST. This record covers the new spacing change only; it does not replace predecessor evidence or count earlier speech/build results as new verification.

Status (updated 2026-10-01 09:30 CST): all in-scope process-spacing and metadata-reflow gates pass. The earlier 390px/200% header clipping finding is retained below as red evidence; the scoped Workbench repair now passes the browser/native 16-state matrices, consumer routes, protected behavior and rebuilt delivery checks. Platform/signing/audio/physical-touch limits remain explicit.

## Metadata reflow closure — 2026-10-01

The red finding was reproduced against the unmodified header layout, then repaired with three surface-scoped CSS rules: allow the Workbench header to wrap, prevent role shrink, and allow the timestamp to wrap within the available width. No pinned AI Elements primitive, timestamp value, metadata/action semantics or persisted field changed.

Fresh mounted Browser evidence (`/tmp/coworkany-spacing-green.WfLzeR/browser-metadata-matrix.json`) passes all 16 combinations: single/multi message, light/dark theme, wide/narrow stage and 100%/200% root text. Every user and assistant header has visible nonzero role/time fragments, complete `datetime`, localized `title`/ARIA text, no overlap and bounds inside its header/content. Chat, Agent, Writer and Workflow AI configurations each retain five valid metadata headers (`consumer-reflow.json`).

Fresh native macOS WebView evidence (`native-metadata-matrix.json`) passes the same 16 combinations, including the 390px/200% narrow case. Expanded detail gutters remain 8px/4px at default scale and 16px/8px at 200%; closing/reopening retains the selected call and closed details remain zero-footprint (`native-expanded-regression.json`). The inspected light and dark screenshots show complete user/AI role and timestamp text in bounds.

Protected behavior also passes after the repair: density 1/10/50, chronology, split/merge, approval rejection, focus and 572px list offset, 27,642-character full-output copy, phase labels `"" → Thinking → "" → Running tools → "" → Writing → ""`, one status region, zero node replacements and no busy ancestor, upward reading/latest/420px restore (`behavior-regression.json`, `scroll-regression.json`, `native-full-copy.json`). Browser virtual clipboard paste is unsupported by the harness; the native system clipboard paste independently verified the complete sentinel and length.

Fresh executable gates for this closure: UI 191/191, client 44/44, desktop 502/502, UI/client/desktop typechecks, root lint, targeted ESLint, helper syntax, shared boundary/provenance checks and associated tests, strict validation of this change plus four predecessors, and scoped diff checks. Production ARM64 app was rebuilt with `--no-sign`; current production binary SHA-256 is `d8d3be6124727d11d35eb803a6a97e189149e27a233d5a177b5b7eb461fc7ed1`. The registered QA host was restored to its original SHA-256 `097d1c661a36ce31b7ddc2fc36a34175959a08947ca25a4ff84fd5658d41e603`; temporary marker/data were removed from the delivery directory and preserved under `/tmp/coworkany-spacing-green.WfLzeR/`. No CoworkAny process remains running.

## Implementation

- `packages/workbench-ui/src/workbench-message-surface.tsx`: one keyed wrapper per visible assistant output, classified from existing render paths. Assistant whitespace-only text/bookkeeping is omitted without rewriting Parts. Message/Part IDs, chronology, turn grouping and portal/disclosure identities remain unchanged.
- `packages/workbench-ui/src/styles.css`: one owner per output/row boundary; contextual rem gutters replace uniform assistant gaps. Primitive outer margins are normalized only inside these surface-owned wrappers. Closed lists/raw details have zero height/margin/padding; opened lists use .5rem and internal steps .25rem. Process line-height is 1.25rem, retaining 13px/20px at default scale and reaching 26px/40px at 200% root size. User/standalone primitive styling and minimum targets remain intact.
- Workflow business-result classification is independent of duplicate-summary suppression: a useful result remains primary whether displayed beside a closed group or inside selected open details. Running traces remain process blocks.
- New `packages/workbench-ui/test/process-spacing.test.tsx`; updated visual-contract regressions; desktop single/multi/second-user fixtures and visible text-scale/metrics controls; `scripts/process-spacing-acceptance.mjs`; existing hierarchy helper updated for the wrapper selector. No dependency, persisted field, runtime/schema change, commit or archive was introduced by this change.

## Baseline and red/green

The unmodified mounted renderer measured 16px output gaps and 32px row gaps. Closed lists already measured zero height in that baseline; no hidden-container height was established as the screenshot's cause. Their computed horizontal padding was still 20px.

- New renderer regressions failed 3/3 before implementation (`unit-red.log`), then passed.
- The corrected mounted helper was deliberately run with only the former numeric gutter values restored: it failed with `Unexpected primary->process gutter: 16px, expected 8px`. Separate adjacent process entries measured 16px and same-turn assistant rows 32px under that control. Restoring the new values made the same helper pass. This numeric-control run retained the new wrappers; it is not presented as the untouched original DOM.
- A relative-step/line-height contract failed before replacing fixed 4px/20px values (`scale-red.log`, one failed contract), then the complete UI suite passed after repair.
- An initial mounted-helper bug compared outputs across message IDs; it was corrected before the recorded red/green measurements. An initial test regex assumed a class was first in the class list; its matcher was corrected. These were harness defects, not product regressions.

## Mounted production-style measurements

Evidence: `.artifacts/process-spacing-20261001/`. Raw command logs: `/tmp/coworkany-spacing.ADtvFP/`.

| Boundary | Default measured gutter |
| --- | ---: |
| process → process | 4px |
| primary → process | 8px |
| process → primary | 12px |
| primary → primary/result | 16px |
| consecutive same-turn assistant rows | 16px |
| user → first assistant / next user turn | 32px |
| opened process header → detail list | 8px |
| closed details height / margin / padding | 0 / 0 / 0 |

`matrix-final.json` records single/multi fixtures in both themes. Multi-message rows remain distinct IDs; row gutters are `[32,16,16,32]`. Empty bookkeeping adds no output block. `mounted-green.json` also records separate 4px Workflow trace boundaries and unchanged result classification after selecting an open call.

Default prose is 16px/26.4px; process text is 13px/20px, its icon 14px and target 32px. Computed prose/process contrast is 18.54/5.10 in light and 16.90/9.64 in dark (`hierarchy-contrast-final.json`). The production coarse-pointer CSS rule measures 44px when activated by the fixture; actual pointer media remains false.

`scaled-final.json` and `matrix-final.json` verify increased-root-size reflow, not physical browser zoom: root 32px, process 26px/40px, internal steps 8px and expanded header/detail 16px. Light/820px and dark/390px fixtures have no output-block overlap or unintended stage/output horizontal overflow; trigger labels/icons remain within their controls. `after-light.png` and `after-dark-narrow.png` were inspected. A scrollable code result remains bounded rather than requiring unbounded text expansion.

The isolated pinned Reasoning/Tool fixture was measured in both themes, then temporarily imported the full production stylesheet stack and was measured again. Geometry/style comparisons reported zero mismatches (`official-production-comparison.json`); those temporary imports were removed. No pinned source/port/hash was edited for this change.

Chat/Agent/Writer fixture configurations and Workflow AI's actual summary render mode were measured (`consumer-spacing.json`). Production call sites in desktop `App.tsx` and `workflow-ai-sidebar.tsx` still share `WorkbenchMessageSurface`; consumer-contract tests pass. This is shared-surface/configuration coverage, not a claim that every full route or live-provider session was navigated.

### Reproducible mounted helper invocation

Use the existing selected Codex Browser runtime; these helpers are not standalone Playwright/CDP or CI runners. After binding a tab through that runtime:

```js
const spacing = await import('/Users/beihuang/Documents/github/coworkany/scripts/process-spacing-acceptance.mjs');
await tab.goto('http://127.0.0.1:1431/test/fixtures/tool-activity-acceptance.html?mode=completed&spacing=single&locale=zh');
await spacing.assertProcessSpacing(tab, { mode: 'single' });
await spacing.assertOpenDetailSpacing(tab);
await spacing.assertTextScaleReflow(tab);
await tab.goto('http://127.0.0.1:1431/test/fixtures/tool-activity-acceptance.html?mode=completed&spacing=multi&locale=zh');
await spacing.assertProcessSpacing(tab, { mode: 'multi' });
```

The helper changes state through visible controls and reads actual DOM boxes. It is manually invoked acceptance automation; the SSR tests alone are not counted as geometric proof.

## Behavioral regression

- Reasoning-only lifecycle: one closed entry while active, no invented duration, settled empty reasoning removed, empty active reasoning feedback retained.
- Mixed chronology: 2 reasoning members and 10 unique calls remain in original order; appending reasoning retains identity/open choice.
- Split/merge, explicit merged close and selected-call choice pass. Scrolled call 21 retains focus, copied feedback and list offset 572px through transitions; append/completion retains 51 calls and only the selected raw output.
- Full output copy is 27,642 characters and retains its sentinel; failure inspection, directly visible approval and rejection/denied reporting pass (`mounted-regression.json`).
- Closed density remains one summary for 1/10/50 calls. Primary prose/results remain outside process disclosures.
- Upward reading remains 1965px after revision; latest return and a newly visible boundary reach the bottom (5567px). Restore and subsequent revision retain 420px; the separate restore fixture retains 420px across a full reload (`scroll-regression.json`, `restore-reload.json`).
- The timed phase fixture records `"" → Thinking → "" → Running tools → "" → Writing → ""`, one region, zero node replacements and no busy ancestor (`phase-metrics.json`). This is new DOM evidence, not new audible speech evidence. Coarse-pointer/reduced-motion fixture checks are rule simulation, not physical touch or system-preference verification. No VoiceOver/audio/system setting was changed.

## Earlier executable gates

The gates in this historical section are preserved for provenance. The final closure below supersedes their counts and hash values where newer receipts exist.

- UI 190/190; client 44/44; desktop release 502/502; zero failures/skips (`ui-delivery.log`, `client-delivery.log`, `desktop-delivery.log`).
- UI/client/desktop TypeScript, root lint, targeted TS/TSX ESLint and helper syntax checks pass. The last fixture-only metrics addition separately passes desktop TypeScript and lint (`typecheck-post-native.log`, `lint-post-native.log`).
- Shared boundary/provenance checks and 4+4 associated tests pass (`static-corrected.log`). The initial repeat used a nonexistent script name; rerunning the established package commands succeeded. No check/config was suppressed.
- Strict OpenSpec validation passes for this change and all four affected predecessors (`spec-*.log`). Scoped tracked diff whitespace checks pass.
- The first native build caught a fixture `Element.dataset` typing error. Typed DOM selectors repaired it; subsequent TypeScript/frontend/native builds succeeded. No failing build is counted as a pass.

## Native delivery and limits

The production ARM64 app was rebuilt with TypeScript + Vite, platform macOS configuration, `--bundles app --no-sign`. Existing >700kB chunk warnings remain. Production binary: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app/Contents/MacOS/coworkany`; SHA-256 `17455f8a766b8a494fd261b7c1c604002b2737d625466c6858a793767aefa5e3` (`native-release-delivery.log`).

A fresh QA frontend/native build embeds the same final renderer and visible metrics fixture (`qa-frontend-native-metrics.log`, `native-qa-delivery.log`). The desktop controller refused the new QA identity/path although the application ran; refreshing discovery and an alternative isolated identity did not resolve it. The known QA identity resolved to the build-directory package, not the earlier temporary clone. Its original binary (SHA-256 `097d1c661a36ce31b7ddc2fc36a34175959a08947ca25a4ff84fd5658d41e603`) was backed up. Only that generated QA binary was replaced with the new QA binary (SHA-256 `e5a2a1adb564b888d4db7df43a7eee1526deb9438bfc02dc48ab39f45604b976`), with a temporary build-directory `portable.flag` and fresh local test data. The earlier temporary clone's original binary was restored and its original hash confirmed.

The resulting native window is `CoworkAny Spacing QA` at `tauri://localhost/test/fixtures/tool-activity-acceptance.html?mode=completed&spacing=multi&locale=zh`. Actual native metrics pass:

- Single and multi same-message `[8,12,8,12,16]` gutters.
- Multi row `[32,16,16,32]` gutters and six closed detail boxes with height/margin/padding zero.
- Root 16px; trigger 13px/20px, height 32px; one phase region outside busy ancestors. Actual reduced-motion/coarse-pointer media are false.

Evidence: `native-multi-metrics.json`, `native-single-metrics.json`, `native-single.jpeg`. The native screenshot is bottom-scrolled; measurements, not that screenshot alone, establish upper-block spacing.

Before opening the native process, Computer Use reported a locked Mac and requested manual unlocking. The native expanded/scaled follow-up has not passed; no audible speech, physical touch, Windows WebView2, release signing/notarization, live-provider or all-runtime-working claim is made. Previous restored-waiting announcement coverage and runtime-attachment limitations remain outside this spacing change.

Restoration completed without further GUI actions while the Mac was locked: only the verified owned QA process was stopped; both original QA binaries again match SHA-256 `097d1c661a36ce31b7ddc2fc36a34175959a08947ca25a4ff84fd5658d41e603`. The temporary portable marker was removed and its fresh data/instance-lock files were moved, not deleted, to `/tmp/coworkany-spacing.ADtvFP/native-replay-data` and `native-replay-instance.lock`. The earlier release verification process was left running. An extra diagnostic package/sidecar started during application-name discovery was also stopped; no unrelated running app was terminated.

The production app still matches SHA-256 `17455f8a766b8a494fd261b7c1c604002b2737d625466c6858a793767aefa5e3`. The generated QA substitution/portable marker is not left in the delivery directory. Task 4.4 is closed on the fresh build plus actual native default replay evidence above, not on the interrupted extra checks. No manual system/audio/preference or conversation/provider-send action was performed. At this checkpoint native expanded/scaled follow-up remained unverified; the dated follow-up below supersedes that coverage limit, not the historical interruption or audible-speech limits.

## Native follow-up — 2026-10-01 08:53–08:58 CST

After the user requested completion of verification, Computer Use confirmed an unlocked desktop. This run reused the exact already-built QA binary `e5a2a1adb564b888d4db7df43a7eee1526deb9438bfc02dc48ab39f45604b976`; it is a new native replay, not a new build. Only the registered generated QA container was temporarily substituted, with a fresh portable data directory. UI interaction and measurements used visible fixture controls in the native Tauri WebView, not Browser DOM injection.

Fresh receipts are `.artifacts/process-spacing-20261001/followup-*.json`; raw screenshots/logs are `/tmp/coworkany-spacing-followup.4g4pJP/`.

| Native state | Process text / target height | Header → details / internal gap | Output gutters |
| --- | --- | --- | --- |
| Default light, expanded process + selected raw tool | 13px/20px; 32px | 8px / 4px | 8,12,8,12,16px |
| 200% root, wide light, still expanded | 26px/40px; 48px | 16px / 8px | 16,24,16,24,32px |
| 200% root, 390px dark, still expanded | 26px/40px; 88px, label wraps | 16px / 8px | 16,24,16,24,32px |
| 200% root, 390px dark, explicitly closed | 26px/40px; 88px | no open detail footprint | 16,24,16,24,32px |
| Restored 16px root, 390px dark, expanded | 13px/20px; 32px | 8px / 4px | 8,12,8,12,16px |

All closed detail boxes measured zero height/margin/padding. User/assistant row spacing was 32px at default and 64px at increased root size. Closing/reopening retained the selected `search_files` raw details and reasoning content; `native-followup-reopened-scaled.jpeg` shows the wrapped process label and disclosure within the process control. The region count remained one, outside busy ancestors; no timed phase replay or audible-speech retest is claimed.

Five recorded native geometry snapshots plus reopen-selection assertions pass. Fresh UI tests pass 190/190 with no failures/skips; UI TypeScript passes (`ui-test.log`, `ui-typecheck.log`). Fresh root lint, shared boundary/provenance checks, all five affected strict OpenSpec validations and scoped whitespace/evidence-state consistency checks pass. Strict spec validation checks document validity, not resolution of the visual finding below. The earlier client 44/44, desktop 502/502 and native builds were not rerun here. No application source, dependency, persisted field or system/audio preference was changed by this follow-up.

### Open finding: metadata reflow, not process spacing

`native-followup-metadata-clipping.jpeg` shows the user role clipped at the left of its bubble and the assistant role/time exceeding the available content width at 390px/200% root size. `native-followup-default-context.jpeg` is the same narrow dark fixture after restoring default root size and shows those headers fitting. The `.wb-ai-message-header`/`.wb-ai-message-time` rules were not changed by the spacing implementation; this run does not establish when the issue was introduced. Earlier output-box assertions did not inspect metadata bounds, so they cannot establish whole-transcript overflow freedom.

The process geometry and disclosure checks pass, but the broader scaled-transcript readability scenario has an open failure. Task 4.2 is reopened rather than reporting an unconditional visual pass. This verification-only request did not authorize a separate metadata-layout repair; no speculative fix was applied. A follow-up repair should cover role/time wrapping within both user and assistant content bounds and repeat default/200% light/dark/narrow checks without hiding metadata.

### Restoration

The owned QA process exited. Its original generated binary again matches `097d1c661a36ce31b7ddc2fc36a34175959a08947ca25a4ff84fd5658d41e603`; the production binary still matches `17455f8a766b8a494fd261b7c1c604002b2737d625466c6858a793767aefa5e3`. The temporary `portable.flag` was removed, and fresh data was moved intact to `/tmp/coworkany-spacing-followup.4g4pJP/native-replay-data`. The app removed its instance-lock on exit. Marker/data/lock are absent from the delivery directory; no CoworkAny main process from this replay remains running. No commit/archive, signing/notarization, Windows, physical touch, provider send or new speech claim is made.
