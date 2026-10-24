# AI Elements message visual repair acceptance

User approved the spec and implementation on 2026-09-30. Core browser acceptance passes against the pinned source, and the rebuilt macOS WebView was verified.

## Implementation and provenance

- Verified upstream repository HEAD at `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`. The four original Message, Reasoning, Tool and Conversation files are retained in `packages/workbench-ui/src/ai-elements/upstream/`.
- `official/provenance.json` records original and adapted per-file SHA-256. `scripts/ai-elements-port.mjs` deterministically reproduces import/type/dependency adaptations. UI tests compare complete adapted source text, not only component names or class markers.
- `official/*.tsx` retains upstream markup, classes and disclosure hooks. `message-adapters.tsx` handles Workbench metadata, locale and host scrolling. `source.tsx` re-exports the restored components after deleting their superseded implementations. Other component APIs remain available.
- `apps/desktop/src/tailwind.css` supplies semantic shadcn tokens, neutral chat colors, the base border rule and the original utility scale under the existing 15px desktop root. The font reset in desktop `styles.css` is now in the base layer.
- Shared `styles.css` removes message cards, forced width/grid/toolbar styles, capped reasoning content and custom Markdown overrides. Existing artifact/workflow actions, role metadata, pagination, overflow handling and composer clearance remain.
- `OrderedTool` uses controlled expansion: automatic running expansion closes when completed; manual choices survive updates; a new approval/error phase remains accessible. Conversation disables initial bottom animation when restoring a saved position.
- No dependencies were added. No provider, transport, reducer or persistence changes were needed for this repair.

## Independent browser evidence

Run Vite on port 1427, then `node scripts/check-message-visual-parity.mjs`. The reference imports the verified ports directly with Tailwind and host-frame styles. The production view imports WorkbenchMessageSurface plus Tailwind, shared CSS, desktop CSS, native-question CSS and macOS CSS. Both consume the same existing ordered event fixture.

Report: `output/playwright/message-visual-acceptance.json`. Page errors: zero.

- Light and dark comparisons match 18 computed properties for eight core slots, including the user bubble. They verify flex direction, gap, typography, padding, border width/color, radius and surface colors.
- Expanded comparisons also match Conversation content, Reasoning content, Tool content/input/output, status badge and disclosure icons. Badge dimensions and 16px icon dimensions match. Conversation bottom padding is excluded because it clears the desktop composer.
- Both themes match the centered 36×36 scroll control, its offset, padding, radius and colors.
- Mounted interactions pass for reasoning streaming/automatic close/manual keyboard reopen; running tool completion without remount; Enter/Space toggles; preserved manual expansion; approval/error/denied presentation and controls.
- Streaming Markdown with an incomplete code fence completes correctly in both themes, including heading, list, quote and table content; a 420px viewport has no page overflow. Reduced-motion preference disables shimmer.
- Manual reading position remains `3094 → 3094` during tool completion and same-message activity. Return-to-latest succeeds. A fresh fixture mount preserves completed chronology and collapsed tool state. Saved position restores to 420px and remains there during later activity.
- The restoration test failed before the fix (`3698` instead of `420`), demonstrating the initial smooth-scroll race, and passes after disabling initial follow for restored conversations.

Screenshots in `output/playwright/`:

| State | Official | Desktop |
| --- | --- | --- |
| Complete light | `message-parity-official-light.png` | `message-parity-desktop-light.png` |
| Complete dark | `message-parity-official-dark.png` | `message-parity-desktop-dark.png` |
| Expanded light/dark | `message-parity-official-expanded-{light,dark}.png` | `message-parity-desktop-expanded-{light,dark}.png` |
| Thinking | `message-parity-official-thinking.png` | `message-parity-desktop-thinking.png` |
| Reasoning expanded | `message-parity-official-reasoning-expanded.png` | `message-parity-desktop-reasoning-expanded.png` |
| Tool running/completed | `message-parity-official-tool-{running,completed}.png` | `message-parity-desktop-tool-{running,completed}.png` |

Additional desktop screenshots cover approval, error, denied and narrow Markdown in both themes. Rendered images were reviewed directly. Avatars, timestamps and artifacts explain the composition's extra rows and height.

## Rebuilt native WebView

Built final frontend assets, then rebuilt the macOS Tauri app with the platform config and `beforeBuildCommand` disabled because the frontend was already built. No unchanged runtime resources were regenerated. Verified an isolated, ad-hoc-signed copy under `.artifacts/message-visual-parity-20260930/package/` using the prior test conversation database; the user's installed app/data was not modified.

The existing conversation `conversation-c4425a95-bade-487c-aa47-5a6ed211bea2` renders in the actual `tauri://localhost` WebView. Its accessibility order is reasoning → pre-tool text → completed read → reasoning → post-tool text → completed write → Markdown result → artifact. Both reasoning disclosures and tools initially collapse. Native pointer interactions expand reasoning text and tool parameters; the settled screenshot retains the brain/label/chevron row and separate bordered tool container. Scrolling upward shows the centered return-to-latest button. Leaving and reopening the conversation restores the chronological content and collapsed terminal disclosures.

Native evidence: `output/playwright/message-parity-native-{restored,sequence,expanded,remount}.png`, `message-parity-native-remount.txt` and `message-visual-native-acceptance.json`. Native checks cover the current light desktop theme; both themes and the full mounted streaming/keyboard matrix are covered by the independent browser harness. The prior spec retains the real provider live-run/persistence evidence; this repair reuses that conversation rather than rerunning its file-writing task.

## Quality gates

| Check | Result |
| --- | --- |
| Workbench client tests/typecheck | 44 passed / passed |
| Workbench UI tests/typecheck | 140 passed / passed |
| Runtime contracts tests/typecheck | 27 passed / passed |
| Desktop release tests/typecheck | 502 passed / passed |
| Repository lint and scoped UI/fixture lint | passed |
| Deterministic port/provenance checks | passed |
| Shared package boundaries/provenance | passed |
| Production desktop bundle boundaries | passed, zero violations |
| Vite production build | passed |
| macOS Tauri app build | passed |
| Actual desktop WebView and persisted-turn remount | passed |

The production bundle still reports its existing large-chunk warnings. The additional network URL scanner reports five `https://fonts.googleapis.com/` literals in document preview/worker chunks; those dependencies are outside this message repair and were not changed or allowlisted. The bundle boundary check itself has zero violations. This report does not claim every repository diagnostic is clean.

The configured `visual-verdict` skill was unavailable in the installed skill roots/tool catalog. Equivalent independent computed-style, interaction and screenshot evidence is retained, with a scoped verdict JSON under `.omx/state/restore-ai-elements-message-visual-parity/ralph-progress.json`.

## Supported scope and limitations

Parity is verified for the pinned four components and tested states, using the product's theme. Desktop shell/composer clearance, brand palette and focus outline, avatars, timestamps, artifact/workflow actions and typed host callbacks are documented exceptions. The fixture is a reproducible official composition, not a claim that arbitrary future upstream demos render identically.

Existing Streamdown default Markdown plugins are used. Optional syntax highlighting, math, Mermaid and CJK plugins were not installed. Tool code uses a plain-code fallback, actions use native tooltip titles, and thinking shimmer uses CSS rather than motion. These adaptations are recorded explicitly; advanced plugin/animation parity is not claimed.
