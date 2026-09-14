import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformProviderProfile, platformIdForProvider, PROVIDER_PLATFORM_OPTIONS } from "../src/provider-platforms";

test("image and video directly expose the cloud governance provider catalog", () => {
  assert.deepEqual(PROVIDER_PLATFORM_OPTIONS.image.map((platform) => platform.id), [
    "bailian_official", "google_official", "openai_official", "runninghub", "pptoken",
  ]);
  assert.deepEqual(PROVIDER_PLATFORM_OPTIONS.video.map((platform) => platform.id), [
    "bailian_official", "minimax_official", "gemini_official", "runninghub",
  ]);
});

test("settings platforms do not prefill a built-in model catalog", () => {
  assert.deepEqual(PROVIDER_PLATFORM_OPTIONS.text.map((platform) => platform.id), [
    "siliconflow", "openrouter", "openai_compatible", "qwen_official", "minimax_official", "glm_official", "volcengine_official", "pptoken",
  ]);
  assert.ok(Object.values(PROVIDER_PLATFORM_OPTIONS).flat().every((platform) => !("models" in platform)));
});

test("audio exposes only its supported Provider platforms", () => {
  assert.deepEqual(PROVIDER_PLATFORM_OPTIONS.audio.map((platform) => platform.id), ["minimax_official", "runninghub"]);
});

test("platform selection creates a capability-scoped profile ready for a model id", () => {
  const profile = createPlatformProviderProfile("video", "runninghub");
  assert.deepEqual(profile, {
    id: "video-runninghub",
    source: "runninghub",
    baseUrl: "https://www.runninghub.cn",
    capabilities: ["video"],
    model: "",
    models: [],
  });
  assert.deepEqual(createPlatformProviderProfile("audio", "runninghub"), {
    id: "audio-runninghub",
    source: "runninghub",
    baseUrl: "https://www.runninghub.cn",
    capabilities: ["audio"],
    model: "",
    models: [],
  });
  assert.equal(platformIdForProvider({ source: "bailian" }, "image"), "bailian_official");
  assert.equal(platformIdForProvider({ source: "openai-compatible" }, "text"), "openai_compatible");
  assert.equal(platformIdForProvider({ source: "pptoken" }, "text"), "pptoken");
  assert.equal(platformIdForProvider({ source: "pptoken" }, "image"), "pptoken");
  assert.equal(platformIdForProvider({ source: "openai-compatible", baseUrl: "https://api.pptoken.cc/v1" }, "image"), "pptoken");
  assert.equal(platformIdForProvider({ source: "openai-compatible" }, "video"), "");
  assert.throws(() => createPlatformProviderProfile("video", "openai_compatible"), /unsupported_provider_platform/);
});
