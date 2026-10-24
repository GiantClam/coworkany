import assert from "node:assert/strict"
import test from "node:test"

import { isDeprecatedTextModelId } from "../src/model-policy"

test("retired GPT versions and provider-qualified aliases are rejected", () => {
  for (const modelId of [
    "gpt-5",
    "gpt-5.6-sol",
    "gpt_5_6-thinking",
    "GPT5.4-mini",
    "openai/gpt-5.6-thinking",
    "openai/gpt-4.1",
  ]) {
    assert.equal(isDeprecatedTextModelId(modelId), true, modelId)
  }
})

test("Claude 5.0 and earlier, including unversioned aliases, are rejected", () => {
  for (const modelId of [
    "claude",
    "anthropic/claude-opus-5",
    "claude-sonnet-5.0",
    "claude-sonnet-5_0",
    "claude-haiku-4.5",
  ]) {
    assert.equal(isDeprecatedTextModelId(modelId), true, modelId)
  }
})

test("GPT 5.7+, Claude 5.1+, and non-text GPT image IDs remain eligible", () => {
  for (const modelId of [
    "gpt-5.7",
    "gpt-6.1-sol",
    "anthropic/claude-sonnet-5.1",
    "claude-opus-6.1-thinking",
    "gpt-image-2",
  ]) {
    assert.equal(isDeprecatedTextModelId(modelId), false, modelId)
  }
})
