import assert from "node:assert/strict";
import test from "node:test";
import { validateGoldenWorkflowTemplateDescriptor } from "@coworkany/workflow-core";
import { createWorkflowGoldenTemplatePrimary, createWorkflowGoldenTemplateRegistry, WORKFLOW_GOLDEN_SUBGRAPH_REGISTRY, WORKFLOW_GOLDEN_TEMPLATE_REGISTRY, composeWorkflowGoldenTemplate, getWorkflowGoldenTemplateReadiness, validateWorkflowGoldenTemplateRegistry } from "../src/workflow-golden-template-registry";
import { buildCampaignImageWorkflowDefinition } from "../src/workflow-templates";
import { buildCharacterSwapVideoWorkflowDefinition } from "../src/workflow-templates";
import { buildLocalMediaWorkflowDefinition, buildProductPromotionWorkflowDefinition, buildWorkflowDefinition } from "../src/App";
import { deriveWorkflowCapabilities, hashWorkflowDefinition, validateWorkflowDefinition } from "@coworkany/workflow-core";

function registryFromReadiness(input: { locale: "zh" | "en"; readiness: Readonly<Record<string, "ready" | "needs-config">>; builders: Parameters<typeof createWorkflowGoldenTemplateRegistry>[0]["builders"] }) {
  const provider = { id: "fixture", source: "openai-compatible", model: "fixture", baseUrl: "https://fixture.invalid", capabilities: ["text", "image", "video", "audio"] as const };
  const empty = { id: "local", source: "local", model: "", capabilities: [] };
  return createWorkflowGoldenTemplateRegistry({ context: { locale: input.locale, providers: { text: input.readiness["content-pipeline"] === "ready" ? provider : empty, image: input.readiness["image-campaign"] === "ready" ? provider : empty, video: provider, audio: empty, audioTranscriptionWorkflowCount: 0 } }, builders: input.builders });
}
function registeredPrimary(definition: ReturnType<typeof buildWorkflowDefinition>, boundaries: Parameters<typeof createWorkflowGoldenTemplatePrimary>[1]) {
  const builders = Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map(entry => [entry.templateKey, () => ({ definition })]));
  const entry = registryFromReadiness({ locale: "en", readiness: {}, builders }).find(entry => entry.key === "content-pipeline")!;
  return createWorkflowGoldenTemplatePrimary(entry, boundaries);
}

test("golden template registry preserves the seven stable built-in keys and versions", () => {
  assert.deepEqual(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((template) => template.templateKey), [
    "content-pipeline",
    "presentation",
    "image-campaign",
    "video-ffmpeg-transform",
    "audio-ffmpeg-trim",
    "product-promotion-video",
    "character-swap-video",
  ]);
  assert.deepEqual(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((template) => template.templateVersion), [1, 1, 2, 1, 1, 2, 1]);
  assert.equal(new Set(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((template) => template.templateKey)).size, WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.length);
  for (const template of WORKFLOW_GOLDEN_TEMPLATE_REGISTRY) assert.deepEqual(validateGoldenWorkflowTemplateDescriptor(template), []);
});

test("golden registry passes release validation and rejects duplicate or invalid entries", () => {
  assert.equal(validateWorkflowGoldenTemplateRegistry(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY).filter(issue => issue.code === "template_builder_missing").length, 7);
  assert.ok(validateWorkflowGoldenTemplateRegistry([
    ...WORKFLOW_GOLDEN_TEMPLATE_REGISTRY,
    { ...WORKFLOW_GOLDEN_TEMPLATE_REGISTRY[0], templateVersion: 0 },
  ]).some((issue) => issue.code === "duplicate_template_key"));
});

test("registry surfaces builder failures without substituting unrelated graphs", () => {
  const provider = { id: "", model: "", capabilities: [] as const };
  const failures: { key: string; issues: readonly string[] }[] = [];
  const entries = createWorkflowGoldenTemplateRegistry({
    context: { locale: "en", providers: { text: provider, image: provider, video: provider, audio: provider, audioTranscriptionWorkflowCount: 0 } },
    builders: Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map(descriptor => [descriptor.templateKey, () => { throw new Error("fixture failure"); }])),
    onInvalid: (key, issues) => failures.push({ key, issues }),
  });
  assert.deepEqual(entries, []);
  assert.equal(failures.length, 7);
  assert.ok(failures.every(failure => failure.issues[0] === "builder_failed:fixture failure"));
});

test("directory snapshots retain complete missing-provider nodes and explicit pending configuration", () => {
  const unbound = { id: "", model: "", capabilities: [] as const };
  const graph = buildCampaignImageWorkflowDefinition("fixture", unbound);
  const entries = createWorkflowGoldenTemplateRegistry({
    context: { locale: "en", providers: { text: unbound, image: unbound, video: unbound, audio: unbound, audioTranscriptionWorkflowCount: 0 } },
    builders: Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map(descriptor => [descriptor.templateKey, () => ({ definition: graph })])),
    onInvalid: () => undefined,
  });
  const instance = entries.find(entry => entry.key === "image-campaign")!.instantiate();
  assert.equal(instance.nodes.length, graph.nodes.length);
  assert.equal(instance.edges.length, graph.edges.length);
  for (const node of instance.nodes.filter(node => node.type === "image_generate" || node.type === "writer")) {
    assert.equal(node.config.needsConfig, true);
    for (const key of ["provider", "model", "selectedProviderId", "selectedModelId", "baseUrl"]) assert.equal(node.config[key], undefined);
  }
  assert.equal(instance.metadata?.templateVersion, 2);
  assert.equal(instance.definitionHash, hashWorkflowDefinition(instance));
});

test("illustrated campaign golden template explicitly includes writing, image generation, and composition", () => {
  const template = WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.find((candidate) => candidate.templateKey === "image-campaign");
  assert.ok(template);
  assert.deepEqual(template.nodeTypes, ["text_input", "writer", "image_generate", "product_store"]);
  assert.ok(template.capabilities.includes("article-generation"));
  assert.ok(template.capabilities.includes("text-generation"));
  assert.ok(template.capabilities.includes("image-generation"));
  assert.ok(template.capabilities.includes("result-composition"));
  const definition = buildCampaignImageWorkflowDefinition("A mixed-media article", { id: "", model: "" });
  assert.deepEqual(validateWorkflowDefinition(definition), []);
  assert.deepEqual(deriveWorkflowCapabilities(definition), ["text-input", "text-generation", "article-generation", "image-generation", "result-composition", "artifact-persistence"]);
  assert.deepEqual(new Set(definition.edges.map((edge) => `${edge.sourceNodeKey}:${edge.targetNodeKey}`)), new Set(["input:copy", "input:image", "copy:asset-library", "image:asset-library"]));
});

test("public composition entry rejects shape-only unregistered subgraphs", () => {
  const definition = buildWorkflowDefinition("fixture", "writer", { id: "", model: "" });
  const primary = registeredPrimary(definition, { inputs: [], outputs: [] });
  const subgraph = { graphKind: "subgraph" as const, graphKey: "arbitrary-template", subgraphKey: "arbitrary-template", subgraphVersion: 1, capabilities: [], validatedProvenance: "looks-valid", definition, inputs: [], outputs: [] };
  const result = composeWorkflowGoldenTemplate({ primary, subgraphs: [subgraph], bindings: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "full_template_not_composable"));
});

test("public composition rejects primary graphs that copy a registered label or graph", () => {
  const primary = registeredPrimary(buildWorkflowDefinition("fixture", "writer", { id: "", model: "" }), { inputs: [], outputs: [] });
  assert.equal(composeWorkflowGoldenTemplate({ primary, subgraphs: [], bindings: [] }).ok, true);
  assert.equal(composeWorkflowGoldenTemplate({ primary: { ...primary }, subgraphs: [], bindings: [] }).ok, false);
  assert.throws(() => createWorkflowGoldenTemplatePrimary({ key: "content-pipeline" } as Parameters<typeof createWorkflowGoldenTemplatePrimary>[0], { inputs: [], outputs: [] }), /not_registered/);
});

test("primary boundary inputs cannot reference an output-only node port", () => {
  assert.throws(() => registeredPrimary(buildWorkflowDefinition("fixture", "writer", { id: "", model: "" }), {
    inputs: [{ boundaryKey: "invalid-input", nodeKey: "input", portId: "text", dataType: "text", disposition: "external", maxBindings: 1 }], outputs: [],
  }), /invalid_boundary/);
});

test("public composition accepts only the registry-owned article-image subgraph", () => {
  const primaryDefinition = buildWorkflowDefinition("fixture", "writer", { id: "", model: "" });
  const primary = registeredPrimary(primaryDefinition, { inputs: [{ boundaryKey: "workflow-input", nodeKey: "capability", portId: "text", dataType: "text" as const, disposition: "external" as const, maxBindings: 1 as const }], outputs: [{ boundaryKey: "writer-text", nodeKey: "capability", portId: "text", dataType: "text" as const, disposition: "bindable" as const, maxBindings: 1 as const }, { boundaryKey: "article-artifact", nodeKey: "capability", portId: "text" as const, dataType: "text" as const, disposition: "external" as const, maxBindings: "many" as const }] });
  const registered = WORKFLOW_GOLDEN_SUBGRAPH_REGISTRY[0];
  const subgraph = { ...registered };
  const result = composeWorkflowGoldenTemplate({ primary, subgraphs: [subgraph], bindings: [{ from: { graphKind: "primary", graphKey: "content-pipeline", boundaryKey: "writer-text" }, to: { graphKind: "subgraph", graphKey: "article-image-publish", boundaryKey: "article-text" } }] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.definition.metadata?.composedFrom as string[] | undefined)?.includes("subgraph:article-image-publish"), true);
    assert.deepEqual(result.inputs.map((boundary) => [boundary.boundaryKey, boundary.disposition]), [["workflow-input", "external"]]);
    assert.deepEqual(result.outputs.map((boundary) => [boundary.boundaryKey, boundary.disposition]), [["article-artifact", "external"], ["illustrated-article-artifact", "external"]]);
    const capabilities = deriveWorkflowCapabilities(result.definition);
    for (const capability of ["article-generation", "image-generation", "result-composition"] as const) assert.ok(capabilities.includes(capability), capability);
  }

  const spoofed = { ...subgraph, capabilities: ["image-generation"] as const };
  const rejected = composeWorkflowGoldenTemplate({ primary, subgraphs: [spoofed], bindings: [] });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.issues.some((issue) => issue.code === "full_template_not_composable"));
});

test("golden template readiness preserves the seven existing policies", () => {
  const base = { textModelConfigured: false, imageProviderConfigured: false, videoProviderConfigured: false, characterSwapImageProviderConfigured: false, audioProviderConfigured: false, audioTranscriptionWorkflowCount: 0 };
  assert.deepEqual(getWorkflowGoldenTemplateReadiness(base), {
    "content-pipeline": "needs-config", presentation: "needs-config", "image-campaign": "needs-config",
    "video-ffmpeg-transform": "ready", "audio-ffmpeg-trim": "ready", "product-promotion-video": "needs-config", "character-swap-video": "needs-config",
  });
  assert.deepEqual(getWorkflowGoldenTemplateReadiness({ ...base, textModelConfigured: true }), {
    "content-pipeline": "ready", presentation: "ready", "image-campaign": "needs-config",
    "video-ffmpeg-transform": "ready", "audio-ffmpeg-trim": "ready", "product-promotion-video": "needs-config", "character-swap-video": "needs-config",
  });
  assert.equal(getWorkflowGoldenTemplateReadiness({ ...base, imageProviderConfigured: true })["image-campaign"], "ready");
  assert.equal(getWorkflowGoldenTemplateReadiness({ ...base, imageProviderConfigured: true, videoProviderConfigured: true })["product-promotion-video"], "ready");
  assert.equal(getWorkflowGoldenTemplateReadiness({ ...base, imageProviderConfigured: true, videoProviderConfigured: true, characterSwapImageProviderConfigured: true, audioProviderConfigured: true, audioTranscriptionWorkflowCount: 2 })["character-swap-video"], "needs-config");
  assert.equal(getWorkflowGoldenTemplateReadiness({ ...base, imageProviderConfigured: true, characterSwapImageProviderConfigured: true, audioProviderConfigured: true, audioTranscriptionWorkflowCount: 1 })["character-swap-video"], "ready");
});

test("golden template readiness resolves real provider capability fixtures", () => {
  const asr = (id: string) => ({ id, remoteWorkflowId: id, name: id, capability: "audio_transcription" as const, version: 1, definitionHash: "fixture", source: { kind: "manual" as const, importedAt: "2026-01-01T00:00:00Z" }, inputSchema: [], nodeBindings: [], outputSchema: [] });
  const image = { id: "image", source: "openai-compatible", baseUrl: "https://image.invalid", model: "image-model", capabilities: ["image"] as const };
  const video = { id: "video", source: "openai-compatible", baseUrl: "https://video.invalid", model: "video-model", capabilities: ["video"] as const };
  const text = { id: "text", source: "openai", baseUrl: "https://text.invalid", model: "text-model", capabilities: ["text"] as const };
  const config = { provider: { id: "local", source: "local", model: "" }, providers: { image, video, text }, defaults: { image: "image", video: "video", text: "text" } };
  const ready = getWorkflowGoldenTemplateReadiness({ config, audioTranscriptionProvider: { id: "audio", source: "openai-compatible", baseUrl: "https://audio.invalid", model: "audio-model", capabilities: ["audio"] } });
  assert.equal(ready["image-campaign"], "ready");
  assert.equal(ready["product-promotion-video"], "ready");
  assert.equal(ready["content-pipeline"], "ready");
  assert.equal(ready["character-swap-video"], "needs-config");

  const noText = getWorkflowGoldenTemplateReadiness({ config: { ...config, providers: { image, video }, defaults: { image: "image", video: "video" } } });
  assert.equal(noText["content-pipeline"], "needs-config");
  const oneAsr = getWorkflowGoldenTemplateReadiness({ config, audioTranscriptionProvider: { ...image, id: "runninghub", source: "runninghub", capabilities: ["audio"] as const, workflows: [asr("asr-1")] } });
  assert.equal(oneAsr["character-swap-video"], "ready");
  const twoAsr = getWorkflowGoldenTemplateReadiness({ config, audioTranscriptionProvider: { ...image, id: "runninghub", source: "runninghub", capabilities: ["audio"] as const, workflows: [asr("asr-1"), asr("asr-2")] } });
  assert.equal(twoAsr["character-swap-video"], "needs-config");
  const unsupportedImage = getWorkflowGoldenTemplateReadiness({ config: { ...config, providers: { ...config.providers, image: { ...image, capabilities: ["text"] as const } } } });
  assert.equal(unsupportedImage["image-campaign"], "needs-config");
});

test("golden catalog exposes exactly registry metadata and readiness for all seven builders", () => {
  const readiness = getWorkflowGoldenTemplateReadiness({ textModelConfigured: true, imageProviderConfigured: false, videoProviderConfigured: true, characterSwapImageProviderConfigured: false, audioProviderConfigured: false, audioTranscriptionWorkflowCount: 0 });
  const provider = { id: "fixture-provider", model: "fixture-model", baseUrl: "https://fixture.invalid" };
  const builders = {
    "content-pipeline": () => ({ definition: buildWorkflowDefinition("fixture", "writer", provider) }),
    presentation: () => ({ definition: buildWorkflowDefinition("fixture", "ppt_generate", provider) }),
    "image-campaign": () => ({ definition: buildCampaignImageWorkflowDefinition("fixture", provider) }),
    "video-ffmpeg-transform": () => ({ definition: buildLocalMediaWorkflowDefinition("video") }),
    "audio-ffmpeg-trim": () => ({ definition: buildLocalMediaWorkflowDefinition("audio") }),
    "product-promotion-video": () => ({ definition: buildProductPromotionWorkflowDefinition(provider, provider, provider) }),
    "character-swap-video": () => ({ definition: buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }) }),
  };
  const catalog = registryFromReadiness({ locale: "en", readiness, builders });
  assert.equal(catalog.length, WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.length);
  assert.deepEqual(catalog.map((entry) => entry.id), WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((entry) => entry.templateKey));
  for (const [index, descriptor] of WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.entries()) {
    const entry = catalog[index];
    assert.equal(entry.version, descriptor.templateVersion);
    assert.equal(entry.title, descriptor.title.en);
    assert.equal(entry.description, descriptor.description.en);
    assert.equal(entry.status, readiness[descriptor.templateKey]);
    assert.deepEqual(entry.capabilities, descriptor.capabilities);
    assert.deepEqual(entry.nodeTypes, descriptor.nodeTypes);
    assert.deepEqual(entry.requiredProviderCapabilities, descriptor.requiredProviderCapabilities);
  }
});

test("all seven golden descriptors match their public builder graph contracts", () => {
  const provider = { id: "fixture-provider", model: "fixture-model", baseUrl: "https://fixture.invalid" };
  const definitions = new Map([
    ["content-pipeline", buildWorkflowDefinition("fixture brief", "writer", provider)],
    ["presentation", buildWorkflowDefinition("fixture brief", "ppt_generate", provider)],
    ["image-campaign", buildCampaignImageWorkflowDefinition("fixture brief", provider)],
    ["video-ffmpeg-transform", buildLocalMediaWorkflowDefinition("video")],
    ["audio-ffmpeg-trim", buildLocalMediaWorkflowDefinition("audio")],
    ["product-promotion-video", buildProductPromotionWorkflowDefinition(provider, provider, provider)],
    ["character-swap-video", buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider })],
  ]);
  for (const descriptor of WORKFLOW_GOLDEN_TEMPLATE_REGISTRY) {
    const definition = definitions.get(descriptor.templateKey);
    assert.ok(definition, `missing builder fixture for ${descriptor.templateKey}`);
    assert.deepEqual(validateWorkflowDefinition(definition), [], descriptor.templateKey);
    assert.deepEqual([...new Set(definition.nodes.map((node) => node.type))], descriptor.nodeTypes, descriptor.templateKey);
    const derived = deriveWorkflowCapabilities(definition);
    for (const capability of descriptor.capabilities) assert.ok(derived.includes(capability), `${descriptor.templateKey} missing ${capability}`);
    assert.equal(typeof definition.definitionHash, "string");
    assert.ok(definition.definitionHash.length > 0);
  }
});

test("release validator executes all seven deterministic builder fixtures", () => {
  const provider = { id: "fixture-provider", model: "fixture-model", baseUrl: "https://fixture.invalid" };
  const builders = {
    "content-pipeline": () => buildWorkflowDefinition("fixture brief", "writer", provider),
    presentation: () => buildWorkflowDefinition("fixture brief", "ppt_generate", provider),
    "image-campaign": () => buildCampaignImageWorkflowDefinition("fixture brief", provider),
    "video-ffmpeg-transform": () => buildLocalMediaWorkflowDefinition("video"),
    "audio-ffmpeg-trim": () => buildLocalMediaWorkflowDefinition("audio"),
    "product-promotion-video": () => buildProductPromotionWorkflowDefinition(provider, provider, provider),
    "character-swap-video": () => buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }),
  } as const;
  const entries = WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((descriptor) => ({ ...descriptor, build: builders[descriptor.templateKey] }));
  assert.deepEqual(validateWorkflowGoldenTemplateRegistry(entries), []);
  for (const descriptor of WORKFLOW_GOLDEN_TEMPLATE_REGISTRY) {
    const actual = deriveWorkflowCapabilities(builders[descriptor.templateKey]());
    assert.deepEqual(descriptor.capabilities, descriptor.templateKey === "product-promotion-video"
      ? ["text-input", "image-generation", "video-generation", "controlled-iteration", "media-transform", "result-composition"]
      : descriptor.capabilities);
    for (const capability of descriptor.capabilities) assert.ok(actual.includes(capability), `${descriptor.templateKey}:${capability}`);
  }
  const poisoned = [{ ...entries[0], build: () => ({ ...entries[0].build(), metadata: { api_key: "secret", path: "/Users/private/file" } }) }];
  assert.ok(validateWorkflowGoldenTemplateRegistry(poisoned).some((issue) => issue.code === "credential_or_path_in_graph"));
  const credentialMetadata = [{ ...entries[0], metadata: { api_key: "secret" } }];
  assert.ok(validateWorkflowGoldenTemplateRegistry(credentialMetadata).some((issue) => issue.code === "credential_in_template"));
  const windowsPath = [{ ...entries[0], metadata: { path: "C:\\Users\\private\\workflow.json" } }];
  assert.ok(validateWorkflowGoldenTemplateRegistry(windowsPath).some((issue) => issue.code === "absolute_path_in_template"));
});

test("golden catalog builds once, exposes validation, and returns independent snapshots", () => {
  let calls = 0;
  const validDefinition = buildCampaignImageWorkflowDefinition("fixture", { id: "", model: "" });
  const builders = Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((descriptor) => [descriptor.templateKey, () => {
    calls += 1;
    return { definition: validDefinition };
  }]));
  const catalog = registryFromReadiness({ locale: "en", readiness: getWorkflowGoldenTemplateReadiness({ textModelConfigured: true, imageProviderConfigured: true, videoProviderConfigured: true }), builders });
  assert.equal(calls, WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.length);
  assert.equal(catalog[0]?.validationResult.valid, true);
  const first = catalog[0]!.build();
  first.definition.nodes[0]!.config.text = "mutated";
  const second = catalog[0]!.build();
  assert.notEqual(second.definition.nodes[0]!.config.text, "mutated");
});

test("golden registry factory builds canonical snapshots once and exposes fresh instances", () => {
  const provider = { id: "fixture-provider", source: "openai-compatible", model: "fixture-model", baseUrl: "https://fixture.invalid", capabilities: ["text", "image", "video", "audio"] as const };
  const context = { locale: "en" as const, providers: { text: provider, image: provider, video: provider, audio: provider, audioTranscriptionWorkflowCount: 0 } };
  const calls = new Map<string, number>();
  const builders = Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((descriptor) => [descriptor.templateKey, () => {
    calls.set(descriptor.templateKey, (calls.get(descriptor.templateKey) ?? 0) + 1);
    if (descriptor.templateKey === "content-pipeline") return { definition: buildWorkflowDefinition("fixture", "writer", provider) };
    if (descriptor.templateKey === "presentation") return { definition: buildWorkflowDefinition("fixture", "ppt_generate", provider) };
    if (descriptor.templateKey === "image-campaign") return { definition: buildCampaignImageWorkflowDefinition("fixture", provider) };
    if (descriptor.templateKey === "video-ffmpeg-transform") return { definition: buildLocalMediaWorkflowDefinition("video") };
    if (descriptor.templateKey === "audio-ffmpeg-trim") return { definition: buildLocalMediaWorkflowDefinition("audio") };
    if (descriptor.templateKey === "product-promotion-video") return { definition: buildProductPromotionWorkflowDefinition(provider, provider, provider) };
    return { definition: buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }) };
  }]));
  const registry = createWorkflowGoldenTemplateRegistry({ context, builders });
  assert.equal(registry.length, 7);
  assert.deepEqual([...calls.values()], [1, 1, 1, 1, 1, 1, 1]);
  const content = registry.find((entry) => entry.key === "content-pipeline")!;
  assert.equal(content.availability, "ready");
  assert.equal(content.metadata.title.en, content.title);
  const first = content.instantiate();
  first.nodes[0]!.config.text = "mutated";
  assert.notEqual(content.instantiate().nodes[0]!.config.text, "mutated");
});

test("golden registry preserves seven-template graph semantics across locales", () => {
  const provider = { id: "fixture-provider", source: "openai-compatible", model: "fixture-model", baseUrl: "https://fixture.invalid", capabilities: ["text", "image", "video", "audio"] as const };
  const builders = (locale: "zh" | "en") => Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((descriptor) => [descriptor.templateKey, () => {
    if (descriptor.templateKey === "content-pipeline") return { definition: buildWorkflowDefinition("fixture", "writer", provider, {}, locale) };
    if (descriptor.templateKey === "presentation") return { definition: buildWorkflowDefinition("fixture", "ppt_generate", provider, {}, locale) };
    if (descriptor.templateKey === "image-campaign") return { definition: buildCampaignImageWorkflowDefinition("fixture", provider, locale) };
    if (descriptor.templateKey === "video-ffmpeg-transform") return { definition: buildLocalMediaWorkflowDefinition("video", locale) };
    if (descriptor.templateKey === "audio-ffmpeg-trim") return { definition: buildLocalMediaWorkflowDefinition("audio", locale) };
    if (descriptor.templateKey === "product-promotion-video") return { definition: buildProductPromotionWorkflowDefinition(provider, provider, provider, locale) };
    return { definition: buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }, locale) };
  }]));
  const context = (locale: "zh" | "en") => ({ locale, providers: { text: provider, image: provider, video: provider, audio: provider, audioTranscriptionWorkflowCount: 0 } });
  const zh = createWorkflowGoldenTemplateRegistry({ context: context("zh"), builders: builders("zh") });
  const en = createWorkflowGoldenTemplateRegistry({ context: context("en"), builders: builders("en") });
  const structural = (definition: ReturnType<typeof buildWorkflowDefinition>) => JSON.stringify({
    schemaVersion: definition.schemaVersion,
    revision: definition.revision,
    // Localized titles/prompts/default language values are presentation data;
    // graph identity and topology must remain byte-stable across locales.
    nodes: definition.nodes.map(({ nodeKey, type, nodeVersion, positionX, positionY }) => ({ nodeKey, type, nodeVersion, positionX, positionY })),
    edges: definition.edges,
  });
  assert.deepEqual(zh.map((entry) => [entry.key, entry.version]), en.map((entry) => [entry.key, entry.version]));
  assert.deepEqual(zh.map((entry) => structural(entry.instantiate())), en.map((entry) => structural(entry.instantiate())));
});

test("golden catalog excludes entries whose builder graph is invalid or semantically false", () => {
  const validDefinition = buildCampaignImageWorkflowDefinition("fixture", { id: "", model: "" });
  const builders = Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((descriptor) => [descriptor.templateKey, () => ({ definition: descriptor.templateKey === "image-campaign" ? validDefinition : { ...validDefinition, nodes: validDefinition.nodes.map((node) => node.type === "image_generate" ? { ...node, type: "writer" as const } : node) } })]));
  const catalog = registryFromReadiness({ locale: "en", readiness: getWorkflowGoldenTemplateReadiness({ textModelConfigured: true, imageProviderConfigured: true, videoProviderConfigured: true }), builders });
  assert.equal(catalog.some((entry) => entry.id === "image-campaign"), true);
  assert.equal(catalog.some((entry) => entry.id === "content-pipeline"), false);
});

test("golden builder graph contracts remain stable across zh and en labels", () => {
  const provider = { id: "fixture-provider", model: "fixture-model", baseUrl: "https://fixture.invalid" };
  const locales = ["zh", "en"] as const;
  for (const locale of locales) {
    const definitions = [
      buildWorkflowDefinition("fixture", "writer", provider, {}, locale),
      buildWorkflowDefinition("fixture", "ppt_generate", provider, {}, locale),
      buildCampaignImageWorkflowDefinition("fixture", provider, locale),
      buildLocalMediaWorkflowDefinition("video", locale),
      buildLocalMediaWorkflowDefinition("audio", locale),
      buildProductPromotionWorkflowDefinition(provider, provider, provider, locale),
      buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }, locale),
    ];
    for (const definition of definitions) {
      assert.deepEqual(validateWorkflowDefinition(definition), []);
      assert.equal(definition.schemaVersion, 2);
      assert.equal(definition.revision, 1);
      assert.ok(definition.edges.length > 0);
    }
  }
  const structural = (definition: ReturnType<typeof buildWorkflowDefinition>) => JSON.stringify({
    schemaVersion: definition.schemaVersion,
    revision: definition.revision,
    nodes: definition.nodes.map(({ nodeKey, type, nodeVersion, positionX, positionY }) => ({ nodeKey, type, nodeVersion, positionX, positionY })),
    edges: definition.edges,
  });
  const zh = [buildWorkflowDefinition("fixture", "writer", provider, {}, "zh"), buildWorkflowDefinition("fixture", "ppt_generate", provider, {}, "zh"), buildCampaignImageWorkflowDefinition("fixture", provider, "zh"), buildLocalMediaWorkflowDefinition("video", "zh"), buildLocalMediaWorkflowDefinition("audio", "zh"), buildProductPromotionWorkflowDefinition(provider, provider, provider, "zh"), buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }, "zh")];
  const en = [buildWorkflowDefinition("fixture", "writer", provider, {}, "en"), buildWorkflowDefinition("fixture", "ppt_generate", provider, {}, "en"), buildCampaignImageWorkflowDefinition("fixture", provider, "en"), buildLocalMediaWorkflowDefinition("video", "en"), buildLocalMediaWorkflowDefinition("audio", "en"), buildProductPromotionWorkflowDefinition(provider, provider, provider, "en"), buildCharacterSwapVideoWorkflowDefinition({ image: provider, audio: provider, video: provider }, "en")];
  assert.deepEqual(en.map(structural), zh.map(structural));
});
