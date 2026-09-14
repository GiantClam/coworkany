import test from "node:test";
import assert from "node:assert/strict";
import { configuredModelOptions, configuredProviderEntries, isDevelopmentRunningHubWorkflowId, modelOptionsForProvider, preferredConfiguredModel, providerForCapability, providerForId, supportsProviderCapability, usableRunningHubWorkflowId, type DesktopProviderConfig } from "../src/provider-config";

const text: DesktopProviderConfig = { id: "text", model: "text/model", baseUrl: "https://text.test/v1" };
const image: DesktopProviderConfig = { id: "image", model: "image/model", baseUrl: "https://image.test/v1" };
const video: DesktopProviderConfig = { id: "video", model: "video/model", baseUrl: "https://video.test/v1" };

test("capability defaults select independent provider profiles", () => {
  const config = {
    provider: text,
    providers: { text, image, video },
    defaults: { text: "text", image: "image", video: "video" },
  };
  assert.deepEqual(providerForCapability(config, "text"), text);
  assert.deepEqual(providerForCapability(config, "image"), image);
  assert.deepEqual(providerForCapability(config, "video"), video);
  assert.deepEqual(providerForCapability(config, "audio"), text);
});

test("unknown profile ids fall back safely to the legacy provider", () => {
  const config = { provider: text, providers: { image }, defaults: { image: "missing" } };
  assert.deepEqual(providerForCapability(config, "image"), text);
  assert.deepEqual(providerForId(config, "image"), image);
  assert.deepEqual(providerForId(config, "missing"), text);
});

test("configured profiles are used when a capability has no explicit default", () => {
  const config = {
    provider: { ...text, model: "legacy/model" },
    providers: {
      "text-zeta": { ...text, id: "text-zeta", model: "zeta/model", models: ["zeta/model"] },
      "text-alpha": { ...text, id: "text-alpha", model: "alpha/model", models: ["alpha/model"] },
    },
  };
  const selected = providerForCapability(config, "text");
  assert.equal(selected.id, "text-alpha");
  assert.deepEqual(modelOptionsForProvider(config, selected), ["alpha/model"]);
});

test("profile model catalogs do not leak the legacy provider models", () => {
  const config = {
    provider: { ...text, models: ["text/model-a", "text/model-b"] },
    providers: { image: { ...image } },
    defaults: { image: "image" },
  };
  const imageProvider = providerForCapability(config, "image");
  assert.equal(modelOptionsForProvider(config, imageProvider), undefined);
  assert.deepEqual(modelOptionsForProvider(config, config.provider), ["text/model-a", "text/model-b"]);
});

test("configured model lists are canonical and prefer the first configured model", () => {
  const provider = { ...text, model: "missing", models: ["", " text/model-a ", "text/model-a", "text/model-b"] };
  assert.deepEqual(configuredModelOptions(provider), ["text/model-a", "text/model-b"]);
  assert.equal(preferredConfiguredModel(provider), "text/model-a");
  assert.deepEqual(modelOptionsForProvider({ provider }, provider), ["text/model-a", "text/model-b"]);
});

test("legacy profiles without a model catalog still expose the active model", () => {
  const provider: DesktopProviderConfig = { id: "text", source: "openai-compatible", model: "gpt-5.4" };
  assert.deepEqual(modelOptionsForProvider({ provider }, provider), ["gpt-5.4"]);
  assert.deepEqual(modelOptionsForProvider({ provider, providers: { text: provider }, defaults: { text: "text" } }, provider), ["gpt-5.4"]);
});

test("same-capability provider profiles keep independent model catalogs and defaults", () => {
  const imageFast: DesktopProviderConfig = { id: "image-fast", source: "openai-compatible", model: "retired", models: ["image/fast", "image/quality"], baseUrl: "https://fast.test/v1" };
  const imageQuality: DesktopProviderConfig = { id: "image-quality", source: "bailian", model: "image/hd", models: ["image/hd", "image/4k"], baseUrl: "https://quality.test/v1" };
  const audioFast: DesktopProviderConfig = { id: "audio-fast", source: "minimax", model: "audio/fast", models: ["audio/fast", "audio/quality"], baseUrl: "https://audio-fast.test/v1" };
  const audioQuality: DesktopProviderConfig = { id: "audio-quality", source: "minimax", model: "audio/hd", models: ["audio/hd", "audio/studio"], baseUrl: "https://audio-quality.test/v1" };
  const videoFast: DesktopProviderConfig = { id: "video-fast", source: "runninghub", model: "video/fast", models: ["video/fast", "video/quality"], baseUrl: "https://video-fast.test/v1" };
  const videoQuality: DesktopProviderConfig = { id: "video-quality", source: "runninghub", model: "video/hd", models: ["video/hd", "video/cinema"], baseUrl: "https://video-quality.test/v1" };
  const config = {
    provider: text,
    providers: { "image-fast": imageFast, "image-quality": imageQuality, "audio-fast": audioFast, "audio-quality": audioQuality, "video-fast": videoFast, "video-quality": videoQuality },
    defaults: { image: "image-quality" as const, audio: "audio-quality" as const, video: "video-quality" as const },
  };
  const selected = providerForCapability(config, "image");
  assert.equal(selected.id, "image-quality");
  assert.equal(selected.model, "image/hd");
  assert.deepEqual(modelOptionsForProvider(config, selected), ["image/hd", "image/4k"]);
  assert.equal(providerForId(config, "image-fast").model, "image/fast");
  assert.deepEqual(modelOptionsForProvider(config, providerForId(config, "image-fast")), ["image/fast", "image/quality"]);
  assert.equal(providerForCapability(config, "audio").id, "audio-quality");
  assert.equal(providerForCapability(config, "audio").model, "audio/hd");
  assert.deepEqual(modelOptionsForProvider(config, providerForCapability(config, "audio")), ["audio/hd", "audio/studio"]);
  assert.equal(providerForId(config, "audio-fast").model, "audio/fast");
  assert.equal(providerForCapability(config, "video").id, "video-quality");
  assert.equal(providerForCapability(config, "video").model, "video/hd");
  assert.deepEqual(modelOptionsForProvider(config, providerForCapability(config, "video")), ["video/hd", "video/cinema"]);
  assert.equal(providerForId(config, "video-fast").model, "video/fast");
});

test("settings can filter known profiles by capability without breaking legacy profiles", () => {
  assert.equal(supportsProviderCapability({ source: "openai-compatible", model: "gpt-5.4" }, "text"), true);
  assert.equal(supportsProviderCapability({ source: "openai-compatible", model: "gpt-image-2" }, "image"), true);
  assert.equal(supportsProviderCapability({ source: "openai-compatible", model: "gpt-image-2" }, "text"), false);
  assert.equal(supportsProviderCapability({ source: "minimax", model: "MiniMax-Hailuo-H3" }, "video"), true);
  assert.equal(supportsProviderCapability({ source: "minimax", model: "speech-2.8-turbo" }, "audio"), true);
  assert.equal(supportsProviderCapability({ capabilities: ["image"] }, "image"), true);
  assert.equal(supportsProviderCapability({ capabilities: ["image"] }, "audio"), false);
  assert.equal(supportsProviderCapability({ id: "custom", model: "custom-model" }, "text"), true);
});

test("pptoken profiles are available to both text and image settings", () => {
  const provider: DesktopProviderConfig = { id: "pptoken-image", source: "pptoken", model: "" };
  assert.equal(supportsProviderCapability(provider, "text"), true);
  assert.equal(supportsProviderCapability(provider, "image"), true);
  const legacyProvider: DesktopProviderConfig = { id: "image-main", source: "openai-compatible", baseUrl: "https://api.pptoken.cc/v1", model: "" };
  assert.equal(supportsProviderCapability(legacyProvider, "text"), true);
  assert.equal(supportsProviderCapability(legacyProvider, "image"), true);
});

test("legacy top-level providers remain visible in settings", () => {
  const provider: DesktopProviderConfig = { id: "local", source: "pptoken", model: "gpt-image-2.5" };
  assert.deepEqual(configuredProviderEntries({ provider }), [["local", provider]]);
  assert.deepEqual(configuredProviderEntries({ provider: { id: "local", source: "local", model: "" } }), []);
});

test("capability defaults recover from an existing incompatible profile", () => {
  const config = {
    provider: text,
    providers: {
      text,
      image: { ...image, source: "openai-compatible" },
      audio: { id: "audio", source: "minimax", model: "speech-2.8-turbo", baseUrl: "https://audio.test/v1" },
    },
    defaults: { image: "audio" },
  };
  assert.equal(providerForCapability(config, "image").id, "image");
  assert.equal(providerForCapability(config, "audio").id, "audio");
});

test("RunningHub developer workflow IDs are never treated as user-owned", () => {
  assert.equal(isDevelopmentRunningHubWorkflowId("2019410250268418050"), true);
  assert.equal(usableRunningHubWorkflowId("2019410250268418050"), undefined);
  assert.equal(usableRunningHubWorkflowId(" user-workflow-42 "), "user-workflow-42");
});
