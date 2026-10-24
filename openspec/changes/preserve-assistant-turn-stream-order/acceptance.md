# Acceptance: Preserve Assistant Turn Stream Order

## Current visual acceptance on 2026-09-30

The reopened visual tasks are now verified by `restore-ai-elements-message-visual-parity`. Its `acceptance.md` records the verified upstream source, independent official/full-production computed-style comparisons and screenshots, mounted transitions, keyboard/scroll/restore assertions, 140 passing UI tests and rebuilt macOS WebView evidence. Supported states match the pinned target within its documented shell/business/dependency adaptations. The previous source digest claims below are historical and superseded.

## Historical findings from the UI review

Visual and interaction parity was reopened following user feedback. The previous test/build and native ordering evidence remains valid for event projection and restore behavior; it did not establish equivalence to the official UI.

- Browser reproduction of the existing acceptance fixture found both `reasoning-trigger` and `tool-header` rendered as `BUTTON` with `display: inline-block`, `gap: normal`, and a height of 54px. A temporary browser-only flex rule reduced each header to 24px without changing data or component state.
- The shared process stylesheet still applies horizontal layout to `.wb-ai-process > summary`; the current Radix disclosure triggers are buttons. The button rule only supplies inherited typography and text alignment.
- The adapted `source.tsx` changes the upstream Message/Reasoning/Tool markup, class lists, status presentation and tool identifier display. Component names and data slots alone do not demonstrate upstream visual parity.
- The fixture imports Tailwind and shared UI CSS but excludes desktop `styles.css` and `styles-macos.css`; its own frame styles also differ from the production shell. Its screenshots are Workbench observations, not independent official reference screenshots.
- Tool lifecycle behavior needs mounted-browser verification: changing `defaultOpen` on completion does not control an already-mounted disclosure.

The repair should first establish a verifiable, compatible upstream source snapshot and independent reference view. Render the same deterministic event fixture through the official composition and the desktop composition, retain upstream component markup/classes/behavior with thin host adapters, remove conflicting message/process overrides, then compare screenshots and state transitions with the complete production stylesheet stack. Cover waiting, reasoning streaming/completion, tool execution/completion/approval, resumed text, Markdown, manual scrolling and restored history before closing the parity gate.

## Historical source record (superseded)

The following registry/version/digest values were recorded by the earlier implementation and are not the verified target for the repair. The new change uses commit `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`, retained original files, per-file SHA-256 checks and deterministic adaptation verification. See `../restore-ai-elements-message-visual-parity/acceptance.md` for current evidence.

- AI Elements registry snapshot: `2026-08-26`
- Copied registry payload SHA-256 at implementation start: `154a1d782970c9d314c96768a734298409dbd9624f6bbcb8461807c683c1d5fd`
- Source repository commit recorded before adaptation: `f7e5b1a126e4a4a877d7453b8e6a9d0ea8e7f9f3`
- Adapted local `source.tsx` SHA-256: `58d0d8874825e5c9bad2a6b9a0a74f12f045969a51818f2bd529103ae7264c82`
- AI SDK protocol dependency: `ai@^7.0.48`; desktop React binding: `@ai-sdk/react@4.0.82`
- Official references: [Chatbot](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/02-chatbot.mdx), [Message](https://elements.ai-sdk.dev/components/message), [Reasoning](https://elements.ai-sdk.dev/components/reasoning), [Tool](https://elements.ai-sdk.dev/components/tool)

## Visual target

- Light: `output/playwright/assistant-turn-order-light.png`
- Dark: `output/playwright/assistant-turn-order-dark.png`
- Viewport: `1280 × 900`
- Required order: reasoning → pre-tool text → running/completed tool at its first position → post-tool text → artifact → terminal activity.
- Allowed differences: Workbench brand color, desktop shell, role/timestamp metadata, artifact actions and typed host callbacks.
- Disallowed differences: global process/text/result buckets, a nested execution card, fabricated prose during tool-only activity, or automatic bottom-follow after the user scrolls away.

## Automated evidence

- `packages/workbench-client/test/fixtures/assistant-turn-interleaved.json` is the captured transport fixture.
- Client tests compare segment identity, entity update position, persistence round-trip and stream barrier chunks.
- Desktop replay tests compare persisted replay Parts with the live reducer output from the same event sequence.
- UI tests assert chronological DOM order, tool-only feedback, one live region, same-message activity revision and legacy timeline parity.
- Browser fixture snapshot exposed one chronological accessibility tree: Reasoning → pre-tool text → completed search tool → post-tool text → artifact → one polite waiting status.
- Manual-scroll browser check: after scrolling to `scrollTop=400`, a same-message revision kept `scrollTop=400` and exposed the scroll-to-latest control; activating it returned to 1px from the bottom, and the next revision stayed 1px from the bottom.
- Light/dark screenshots were captured at `1280 × 900`; the only browser console error was the fixture's missing optional `favicon.ico`.

## Native acceptance record

- Built the current macOS application with `tauri build --config src-tauri/tauri.macos.conf.json --target aarch64-apple-darwin --bundles app`, then launched an isolated, ad-hoc-signed acceptance copy with an empty database and the existing local Provider configuration.
- Conversation: `conversation-c4425a95-bade-487c-aa47-5a6ed211bea2`; run: `c4425a95-bade-487c-aa47-5a6ed211bea2`; assistant message: `assistant-c4425a95-bade-487c-aa47-5a6ed211bea2`; model: `grok-4.6`; terminal status: `succeeded`.
- The live accessibility order was: completed reasoning → pre-tool text → completed `read` tool → completed reasoning → post-tool text → completed `write` tool → Markdown result text → artifact. No global execution/text/result bucket was present.
- The persisted snapshot retained the same visible order. Its complete Part sequence was `reasoning, text, dynamic-tool(read), data-usage, text, reasoning, text, dynamic-tool(write), data-usage, text, data-usage, data-runMetrics, data-artifact, data-status`.
- Reloading the same conversation retained Part order, content, completed tool states and artifact. A manual pre-reload scroll-away remained away from the bottom after reload, exposed one `滚动到最新消息` control, and activating it returned to the latest content.
- Native screenshots: `output/playwright/assistant-turn-native-sequence-before-reload.png`, `output/playwright/assistant-turn-native-before-reload.png`, `output/playwright/assistant-turn-native-after-reload.png`.

## Final verification matrix

- Workbench client: 44 tests passed; typecheck passed.
- Workbench UI: 137 tests passed; typecheck passed.
- Runtime contracts: 27 tests passed; typecheck passed.
- Desktop: 502 tests passed; typecheck passed; macOS Tauri `.app` build passed.
- Repository lint, shared-boundary check and shared-provenance check passed.
- OpenSpec strict validation passed after implementation; the final documentation-only update is validated again before handoff.
- The generic desktop `build` script invokes PowerShell and is not portable to macOS. The platform-native `build:macos` and full macOS Tauri application build both passed.
