# Design and cleanup plan

1. Preserve original upstream files under `ai-elements/upstream` and deterministic compatible ports under `ai-elements/official`. Imports point to local primitives; optional unavailable Markdown plugins are omitted. CSS implements shimmer without adding motion. Record and verify each adaptation and SHA-256.
2. Move only Message/Reasoning/Tool/Conversation implementations out of `source.tsx`. Re-export the existing API through a single adapter module. Leave other components intact. Never import `source.tsx` from the official modules.
3. Preserve the business scroll bridge and callbacks. Use official Conversation content/scroll-button classes; keep desktop bottom composer clearance as a documented shell exception.
4. Keep official Reasoning auto-open/one-time delayed close. Map locale with its thinking-message callback. Tool starts open during an active/approval/error phase, closes on successful completion unless the user selected an expansion state; failed/approval content remains accessible. Use controlled state in the chronological tool adapter, not changing `defaultOpen`.
5. Before cleanup, add regressions requiring original structural classes, no visible tool ID, verifiable provenance and production stylesheet loading. Remove conflicting `.wb-ai-message`, message-content grid, branded bubble/toolbar, process button font shorthand, reasoning height caps and custom Markdown selectors from restored primitives. Preserve artifact, workflow, pagination and overflow safety behavior.
6. Reference view imports official ports directly and never Workbench wrappers/shared/desktop CSS. Production view uses WorkbenchMessageSurface and the full desktop CSS stack inside the same theme-variable scope as App. Both consume the same fixture. Compare core slots excluding approved shell elements; expose state advancement, remount/reload and enough history to test scrolling.
7. Browser evidence must measure real computed styles and mounted state. A screenshot of Workbench alone or SSR data-slot assertions is insufficient. Verify a real desktop WebView after rebuilding frontend assets.

## Visual targets

Reasoning trigger: flex row, 8px gap, 14px text, 16px icons, no extra status badge. Tool: rounded bordered container, 12px header padding, separate name/status badge, right chevron, no visible raw toolCallId. MessageContent: flex column, 8px gap, 14px text; user secondary bubble with upstream padding/radius. MessageResponse: Streamdown as its root with upstream first/last margin behavior. Scroll-to-latest: centered round outline control.

## Risks

Global unlayered resets can override Tailwind utilities; scope those resets away from AI Elements rather than introducing more overriding CSS. The installed Radix controllable-state API can return undefined, requiring a documented type compatibility fallback. Optional Markdown plugins remain outside the approved dependency boundary. Visual similarity is measured only for supported message content and explicitly tested states, not guaranteed for arbitrary future upstream changes.

The shell's secondary color is black with white control text, whereas the upstream user bubble selects secondary background and foreground text. The chat adapter maps secondary/accent to the existing neutral muted surface and foreground within Conversation. The independent reference uses the same normalized chat palette; unrelated brand controls retain their tokens. Fixed 4px spacing and 14px/12px utility typography preserve the upstream scale under the desktop's existing 15px root font.
