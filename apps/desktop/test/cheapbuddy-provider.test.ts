import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHEAPBUDDY, createCheapBuddyProvider, mergeCheapBuddyProvider } from "../src/cheapbuddy";
import { configuredTextModelOptions, configuredTextModelSelectionId, parseProviderImport, providerForCapability, selectConfiguredTextModel, setProviderCapabilityModel, setProviderCapabilityModels, type DesktopProviderConfig } from "../src/provider-config";
import { normalizeProviderModelsForCapability } from "../src/provider-model-discovery";
import { createPlatformProviderProfile, PROVIDER_PLATFORM_OPTIONS } from "../src/provider-platforms";
import { defaultDesktopConfig, readDesktopConfig, writeDesktopConfig } from "../runtime/config";
import { createPaths } from "../runtime/paths";

function configured(): DesktopProviderConfig {
  let provider: DesktopProviderConfig = { ...createCheapBuddyProvider(), credentialRef: "cheapbuddy:account:42" };
  provider = setProviderCapabilityModels(provider, "text", ["glm-5.3", "kimi-k3"], "glm-5.3");
  provider = setProviderCapabilityModels(provider, "image", ["grok-imagine-image-2.0", "image-extra"]);
  return setProviderCapabilityModels(provider, "video", ["MiniMax-H3"]);
}

test("CheapBuddy is built in for text, image and video with one account profile", () => {
  assert.equal(CHEAPBUDDY.purchaseUrl, "https://cheapbuddy.cc/#pricing");
  for (const capability of ["text", "image", "video"] as const) {
    assert.equal(PROVIDER_PLATFORM_OPTIONS[capability][0]?.id, "cheapbuddy");
    assert.equal(createPlatformProviderProfile(capability, "cheapbuddy").id, "cheapbuddy");
  }
  assert.equal(PROVIDER_PLATFORM_OPTIONS.audio.some((provider) => provider.id === "cheapbuddy"), false);
  assert.equal(createCheapBuddyProvider().model, "");
});

test("per-capability resolution and model edits keep the other choices", () => {
  const profile = configured();
  const edited = setProviderCapabilityModel(profile, "image", "image-extra");
  const config = { provider: edited, providers: { cheapbuddy: edited }, defaults: { text: "cheapbuddy", image: "cheapbuddy", video: "cheapbuddy" } };
  assert.equal(providerForCapability(config, "text").model, "glm-5.3");
  assert.equal(providerForCapability(config, "image").model, "image-extra");
  assert.equal(providerForCapability(config, "video").model, "MiniMax-H3");
  assert.deepEqual(configuredTextModelOptions(config).map((option) => option.modelId), ["glm-5.3", "kimi-k3"]);
  const textSelected = selectConfiguredTextModel(config, configuredTextModelSelectionId("cheapbuddy", "kimi-k3"));
  assert.equal(textSelected.providers.cheapbuddy.model, "kimi-k3");
  assert.equal(textSelected.providers.cheapbuddy.capabilityModels?.image?.model, "image-extra");
  assert.equal(profile.capabilityModels?.image?.model, "grok-imagine-image-2.0");
});

test("catalog refresh retains valid selections and removes retired models", () => {
  const previous = setProviderCapabilityModel(configured(), "text", "kimi-k3");
  const config = { provider: previous, providers: { cheapbuddy: previous }, defaults: { text: "cheapbuddy", image: "cheapbuddy", video: "cheapbuddy" } };
  assert.equal(mergeCheapBuddyProvider(config, configured()).providers.cheapbuddy.model, "kimi-k3");
  const next = setProviderCapabilityModels(configured(), "text", ["glm-5.3"]);
  assert.equal(mergeCheapBuddyProvider(config, next).providers.cheapbuddy.model, "glm-5.3");
});

test("account login preserves every explicit legacy default including empty local profiles", () => {
  const local = { id: "local", source: "local", model: "" };
  const image = { id: "image", source: "openai-compatible", model: "gpt-image-2" };
  const config = { provider: local, providers: { image }, defaults: { image: "image" } };
  const merged = mergeCheapBuddyProvider(config, configured());
  assert.deepEqual(merged.provider, local);
  assert.deepEqual(merged.defaults, { image: "image" });
  const selected = mergeCheapBuddyProvider(config, configured(), { selectAsDefault: true });
  assert.equal(selected.provider.id, "cheapbuddy");
  assert.deepEqual(selected.defaults, { text: "cheapbuddy", image: "cheapbuddy", video: "cheapbuddy" });
});

test("actual Relay capability metadata never mixes media models into text", () => {
  const payload = { data: [
    { id: "glm-5.3", capabilities: ["text_generation"] },
    { id: "grok-imagine-image-2.0", capabilities: ["text_to_image", "image_edit", "variation"] },
    { id: "MiniMax-H3", capabilities: ["text_to_video", "image_to_video", "reference_to_video"] },
  ] };
  for (const [capability, expected] of [["text", "glm-5.3"], ["image", "grok-imagine-image-2.0"], ["video", "MiniMax-H3"]] as const) {
    assert.deepEqual(normalizeProviderModelsForCapability(payload, { source: "cheapbuddy", baseUrl: CHEAPBUDDY.apiBaseUrl, capability }, `${CHEAPBUDDY.apiBaseUrl}/models`), [expected]);
  }
});

test("a legacy CheapBuddy text profile cannot become an unverified media model", () => {
  const provider = { id: "cheapbuddy", source: "cheapbuddy", model: "glm-5.3", models: ["glm-5.3"] };
  const config = { provider, providers: { cheapbuddy: provider }, defaults: { image: "cheapbuddy", video: "cheapbuddy" } };
  assert.equal(providerForCapability(config, "text").model, "glm-5.3");
  assert.equal(providerForCapability(config, "image").model, "");
  assert.equal(providerForCapability(config, "video").model, "");
});

test("import and disk normalization retain references and catalogs without persisting a resolved key", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-cheapbuddy-provider-"));
  const paths = createPaths(root, "normal");
  const profile = { ...configured(), apiKey: "resolved-fixture-secret" };
  try {
    const imported = parseProviderImport({ providers: { cheapbuddy: profile } });
    assert.equal(imported.providers.cheapbuddy?.apiKey, undefined);
    assert.equal(imported.providers.cheapbuddy?.credentialRef, "cheapbuddy:account:42");
    const config = { ...defaultDesktopConfig(paths), provider: { ...profile, model: "glm-5.3" }, providers: { cheapbuddy: profile } };
    await writeDesktopConfig(paths, config);
    await writeDesktopConfig(paths, config);
    const loaded = await readDesktopConfig(paths);
    assert.deepEqual(loaded.providers?.cheapbuddy?.capabilityModels, profile.capabilityModels);
    assert.equal(loaded.providers?.cheapbuddy?.apiKey, undefined);
    for (const path of [paths.configFile, join(paths.root, "config.backup.json")]) {
      assert.equal((await readFile(path, "utf8")).includes("resolved-fixture-secret"), false);
    }
    assert.throws(() => parseProviderImport({ providers: { cheapbuddy: { capabilityModels: { text: { models: [42] } } } } }), /provider_import_capability_models_invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
