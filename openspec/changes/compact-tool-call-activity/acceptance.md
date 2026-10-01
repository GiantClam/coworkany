# Compact tool activity: implementation acceptance

Date: 2026-09-30. Approved change: `compact-tool-call-activity`.

## Delivered behavior

- Each maximal adjacent ordinary-tool run renders one muted, borderless, default-closed summary. Visible text/results, approvals and question tools remain chronological boundaries.
- Group → compact call list → original input/output is a two-level disclosure. Lists/details have bounded overflow and full copy controls; `0`, `false` and empty-string output remain inspectable.
- Summaries count distinct calls and real outcomes, including failures/denials during active work. No fabricated totals, timestamps, file counts or model-generated prose.
- Approvals remain actionable even when their parameter disclosure is closed. Failures have a direct inspection action. Typed results and Workflow AI business summaries stay visible without duplicate summaries/raw workflow JSON.
- Message-scoped choices and fixed portal containers preserve unaffected call components, copied feedback, focus and list offsets through approval splits/merges. When split groups have conflicting open choices, open wins on merging; call-level choices are unchanged.
- Tool-only work keeps one concise polite announcement, without a duplicate visible activity row. Keyboard focus and the existing conversation scroll policy remain intact.

## Verification evidence

Automated checks:

- Workbench UI: **159/159** tests passed; TypeScript passed. The 19 focused tool tests cover grouping, lifecycle counts, chronology, attention, density, results and falsy output.
- Workbench client: **44/44** tests passed. Desktop: **502/502** tests passed; desktop TypeScript passed.
- Repository lint and targeted lint for the changed UI/test files passed. Shared-boundary and shared-provenance checks passed. Pinned upstream/official source and primitive parity tests remained unchanged and passed.
- Production Vite build passed; the existing large-chunk warning remains. macOS ARM64 release `.app` build passed with signing skipped for local acceptance. The final binary embeds `desktop-app-Bp-xWTt9.js`, matching the final production build.
- Existing desktop static assertions were updated to inspect the public re-export plus the actual message adapter after the earlier source migration. No behavioral assertion was removed.

Mounted acceptance used the Codex in-app Browser, the production stylesheet stack and real fixture controls. `scripts/tool-activity-acceptance.mjs` is a repeatable Node REPL/browser-runtime regression helper, not standalone Playwright/CDP. Its density, boundary-continuity and full-inspection checks all passed:

- 1/10/50 calls: exactly one closed group each, no raw input/output in the transcript.
- 50 → 51 calls: only the selected call remains open after append/completion.
- First/middle approval boundaries and merge: call `fixture-tool-21` stays focused; its list offset stays **446px** and its local “Input copied” state survives. Conflicting split-group choices do not hide the inspected call after merging.
- Failed-call action exposes the failure directly. Approval buttons remain visible after closing parameters; rejection is shown as denied, not successful.
- Long-output copy was verified by ordinary paste into a fixture textarea: **27,642 characters**, including the terminal sentinel. The browser runtime clipboard API uses a separate clipboard, so it was not used as proof of `navigator.clipboard` output.
- Interleaved text produces separate groups around the text. Question tools remain outside groups. Typed reports retain their original position. Chat/Agent/Writer fixture variants render the shared behavior; production source wiring and route tests verify the actual consumers. Workflow AI has exactly one business summary both closed and expanded, with no raw input disclosure.
- Manual reading: message revision retained conversation `scrollTop=3932`, still **601px** from the bottom, and exposed the latest-message control. Restored `scrollTop=420` remained 420 after a revision; restored disclosures were closed.
- Enter/Space toggles have accurate `aria-expanded` and a **2px** visible focus outline. Reduced-motion fixture mode uses one **0.00001s** animation iteration; the production media query disables spinner animation. OS-level reduced-motion preferences were not changed.
- 1280×900 light/dark and 420×900 narrow views were inspected. The summary has a **32px** default height, transparent background, zero border and muted theme text. At 420px its content width and scroll width were both **347px**.

Native WebView acceptance used the rebuilt application and an existing two-tool historical conversation (`conversation-70653c65-fb08-48de-951d-1b7fb16f447c`), without issuing a new Provider request. The visible order remained reasoning → pre-tool text → read summary → reasoning/text → write summary → final text → Markdown artifact. Group opening exposed a still-closed call row; opening that row exposed its existing parameter controls. After restarting into the final build and reopening that saved conversation, both summaries were closed, raw copy controls were absent and the Markdown artifact remained visible. Raw-data completeness is exercised by the deterministic populated-Part fixture, since legacy saved traces can omit raw fields.

## Captures

Browser captures are outside the repository:

- `/tmp/coworkany-tool-activity-{1,10,50}-{light,dark}.png`
- `/tmp/coworkany-tool-activity-narrow-dark.png`
- `/tmp/coworkany-tool-activity-attention-dark.png` (failures, denials, approvals and typed result)
- `/tmp/coworkany-tool-activity-interleaved-dark.png`
- `/tmp/coworkany-tool-activity-native-restored.jpeg`

The upstream/reference visual script keeps raw Tool primitive expectations and has separate desktop compact-surface expectations. Its syntax passed; its legacy browser launcher was not invoked. Equivalent mounted acceptance ran through the supported in-app Browser instead. A fresh final fixture tab reported no console errors or warnings; earlier development-only HMR root warnings were fixed by disposing the fixture root before hot replacement.

## Changed implementation files

- `packages/workbench-ui/src/tool-activity.ts`, `tool-activity-group.tsx`: ordered projection, deterministic summaries, two-level presentation and stable mounted disclosure ownership.
- `packages/workbench-ui/src/workbench-message-surface.tsx`, `styles.css`, `ai-elements/message-adapters.tsx`: shared integration, scoped compact styles, approval/activity/result handling and empty-output compatibility.
- `packages/workbench-ui/test/tool-activity*.test.tsx`, `workbench-message-surface.test.tsx`; `apps/desktop/test/routes.test.ts`: focused regressions and approved contract adjustments.
- `apps/desktop/test/tool-activity-acceptance.tsx`, `.css`, `fixtures/tool-activity-acceptance.html`; `scripts/tool-activity-acceptance.mjs`, `message-visual-acceptance.code.js`: production-styled fixtures and distinct compact/primitive acceptance.

No new dependencies, transport/persistence schema, runtime graph, model call or upstream source changes. Unrelated pre-existing workspace edits were preserved. Windows native UI and fresh live Provider concurrency were not exercised; complex state transitions were verified in mounted deterministic fixtures. Portal hosts live for the mounted message lifetime; disclosure choices are intentionally not persisted across reloads.
