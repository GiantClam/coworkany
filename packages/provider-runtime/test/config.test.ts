import test from "node:test";
import assert from "node:assert/strict";
import { redactProviderConfig, resolveProviderRequest } from "../src/index";

test("local provider is the default path and API config is explicit", () => {
  assert.equal(resolveProviderRequest({ id: "", source: "local", model: "qwen-local" }).providerId, "local");
  assert.throws(() => resolveProviderRequest({ id: "api", source: "openai-compatible", model: "gpt" }), /base_url_required/);
  assert.equal(redactProviderConfig({ id: "api", source: "openai-compatible", model: "gpt", baseUrl: "https://example.test/", apiKey: "secret" }).apiKey, "[REDACTED]");
});

test("CheapBuddy text uses the injected OpenAI-compatible request config", () => {
  assert.throws(() => resolveProviderRequest({ id: "cheapbuddy", source: "cheapbuddy", model: "glm-5.3" }), /base_url_required/);
  assert.deepEqual(resolveProviderRequest({ id: "cheapbuddy", source: "cheapbuddy", model: "glm-5.3", baseUrl: "https://api.cheapbuddy.cc/v1/", apiKey: "fixture" }), { providerId: "cheapbuddy", model: "glm-5.3", baseUrl: "https://api.cheapbuddy.cc/v1", apiKey: "fixture" });
});
