/**
 * Provenance for the source snapshot used by the desktop message surface.
 * AI Elements is a shadcn registry: the source is copied into the app and
 * reviewed here, rather than loaded as a runtime package.
 */
export const AI_ELEMENTS_SOURCE_SNAPSHOT = {
  registryBaseUrl: "https://elements.ai-sdk.dev/api/registry",
  sourceRepository: "https://github.com/vercel/ai-elements",
  sourceCommit: "6a9d5b1822ffb10bba4bd97175f01edd7d8651cd",
  sourceKind: "git-snapshot",
  provenanceManifest: "packages/workbench-ui/src/ai-elements/official/provenance.json",
  adaptationScript: "scripts/ai-elements-port.mjs",
  verifiedComponents: ["message", "reasoning", "tool", "conversation"],
  license: "Apache-2.0",
  references: {
    chatbot: "https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/02-chatbot.mdx",
    message: "https://elements.ai-sdk.dev/components/message",
    reasoning: "https://elements.ai-sdk.dev/components/reasoning",
    tool: "https://elements.ai-sdk.dev/components/tool",
  },
  acceptanceScreenshots: {
    light: "output/playwright/message-parity-desktop-light.png",
    dark: "output/playwright/message-parity-desktop-dark.png",
  },
  components: ["attachments", "conversation", "message", "model-selector", "prompt-input", "sources", "artifact", "audio-player", "agent", "task", "tool", "image", "suggestion", "queue"],
  dependencies: {
    "@radix-ui/react-accordion": "1.2.2",
    ai: "^7.0.48",
    cmdk: "1.0.4",
    lucideReact: "^0.454.0",
    "media-chrome": "^4.19.2",
    streamdown: "2.6.0",
    "use-stick-to-bottom": "1.1.3",
  },
} as const;
