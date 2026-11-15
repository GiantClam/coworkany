import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveOpenCodeModelHint } from "./opencode-model"

test("qualifies DeepSeek display IDs for OpenCode", () => {
  assert.equal(resolveOpenCodeModelHint({ providerId: "enterprise-openai-compatible", modelId: "deepseek-v4-pro" }), "enterprise_openai_compatible/deepseek-v4-pro")
  assert.equal(resolveOpenCodeModelHint({ providerId: "deepseek", modelId: "deepseek-v4-pro" }), "deepseek/deepseek-v4-pro")
})

test("preserves already-qualified and non-DeepSeek model IDs", () => {
  assert.equal(resolveOpenCodeModelHint({ providerId: "deepseek", modelId: "deepseek/deepseek-v4-pro" }), "deepseek/deepseek-v4-pro")
  assert.equal(resolveOpenCodeModelHint({ providerId: "pptoken", modelId: "gpt-6.1-sol" }), "pptoken/gpt-6.1-sol")
  assert.throws(
    () => resolveOpenCodeModelHint({ providerId: "pptoken", modelId: "gpt-5.4" }),
    { message: "deprecated_text_model_unavailable" },
  )
  assert.equal(resolveOpenCodeModelHint({ providerId: null, modelId: null }), null)
})

test("qualifies Grok 4.5 through the application-selected PPToken provider", () => {
  assert.equal(resolveOpenCodeModelHint({ providerId: "pptoken", modelId: "grok-4.5" }), "pptoken/grok-4.5")
})

test("qualifies an OpenRouter vendor model ID for OpenCode", () => {
  assert.equal(resolveOpenCodeModelHint({ providerId: "openrouter", modelId: "x-ai/grok-4.5" }), "openrouter/x-ai/grok-4.5")
})
