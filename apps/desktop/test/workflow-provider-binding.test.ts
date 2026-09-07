import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { bindWorkflowProviderDefaults } from "../src/workflow-provider-binding";
import { sanitizeWorkflowDefinitionForStorage } from "../src/workflow-storage";

const definition: WorkflowDefinitionEnvelope = {
  schemaVersion: 2,
  revision: 1,
  definitionHash: "hash",
  nodes: [
    { nodeKey: "text", type: "text_input", nodeVersion: 1, title: "Text", positionX: 0, positionY: 0, config: { text: "hello" } },
    { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 1, positionY: 0, config: { provider: "stale", model: "stale/image", apiKey: "stale-secret" } },
    { nodeKey: "video", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 2, positionY: 0, config: {} },
    { nodeKey: "audio", type: "music_generate", nodeVersion: 1, title: "Audio", positionX: 3, positionY: 0, config: {} },
  ],
  edges: [],
};

test("mixed media workflows bind each node to its configured capability provider and model", () => {
  const bound = bindWorkflowProviderDefaults(definition, {
    provider: { id: "text-main", source: "openai-compatible", model: "text/default", models: ["text/default"], baseUrl: "https://text.example.test" },
    providers: {
      "image-main": { id: "image-main", source: "openai-compatible", model: "image/fast", models: ["image/fast", "image/quality"], baseUrl: "https://image.example.test" },
      "video-main": { id: "video-main", source: "runninghub", model: "video/standard", models: ["video/standard"], baseUrl: "https://video.example.test" },
      "audio-main": { id: "audio-main", source: "minimax", model: "audio/music", models: ["audio/music"], baseUrl: "https://audio.example.test" },
    },
    defaults: { image: "image-main", video: "video-main", audio: "audio-main" },
  });

  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "image")?.config, { provider: "image-main", model: "image/fast", baseUrl: "https://image.example.test" });
  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "video")?.config, { provider: "video-main", model: "video/standard", baseUrl: "https://video.example.test" });
  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "audio")?.config, { provider: "audio-main", model: "audio/music", baseUrl: "https://audio.example.test" });
});

test("provider binding leaves text/input nodes unchanged and does not introduce credentials", () => {
  const bound = bindWorkflowProviderDefaults(definition, {
    provider: { id: "text-main", model: "text/default", baseUrl: "https://text.example.test" },
    providers: { image: { id: "image", model: "image/default", baseUrl: "https://image.example.test" } },
    defaults: { image: "image" },
  });
  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "text")?.config, { text: "hello" });
  assert.equal("apiKey" in (bound.nodes.find((node) => node.nodeKey === "image")?.config ?? {}), false);
  const portable = sanitizeWorkflowDefinitionForStorage(bound);
  assert.equal("provider" in (portable.nodes.find((node) => node.nodeKey === "image")?.config ?? {}), false);
  assert.equal("model" in (portable.nodes.find((node) => node.nodeKey === "image")?.config ?? {}), false);
});

test("provider binding keeps an explicitly selected music model", () => {
  const musicDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "audio" ? { ...node, config: { model: "music-2.6" } } : node),
  };
  const bound = bindWorkflowProviderDefaults(musicDefinition, {
    provider: { id: "text-main", model: "text/default" },
    providers: { audio: { id: "audio", source: "minimax", model: "speech-2.8-hd", baseUrl: "https://audio.example.test" } },
    defaults: { audio: "audio" },
  });
  assert.equal(bound.nodes.find((node) => node.nodeKey === "audio")?.config.model, "music-2.6");
});

test("provider binding keeps a video model selected from the active video profile", () => {
  const videoDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "video" ? { ...node, config: { model: "video/cinema" } } : node),
  };
  const bound = bindWorkflowProviderDefaults(videoDefinition, {
    provider: { id: "text-main", model: "text/default" },
    providers: { video: { id: "video", source: "openai-compatible", model: "video/standard", models: ["video/standard", "video/cinema"], baseUrl: "https://video.example.test" } },
    defaults: { video: "video" },
  });
  assert.equal(bound.nodes.find((node) => node.nodeKey === "video")?.config.model, "video/cinema");
});

test("provider binding honors a video node's configured provider and its model catalog", () => {
  const videoDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "video" ? { ...node, config: { selectedProviderId: "video-cinema", model: "cinema-v2" } } : node),
  };
  const bound = bindWorkflowProviderDefaults(videoDefinition, {
    provider: { id: "text-main", model: "text/default" },
    providers: {
      "video-standard": { id: "video-standard", source: "openai-compatible", model: "standard-v1", models: ["standard-v1"], baseUrl: "https://video-standard.example.test", capabilities: ["video"] },
      "video-cinema": { id: "video-cinema", source: "openai-compatible", model: "cinema-v1", models: ["cinema-v1", "cinema-v2"], baseUrl: "https://video-cinema.example.test", capabilities: ["video"] },
    },
    defaults: { video: "video-standard" },
  });
  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "video")?.config, { selectedProviderId: "video-cinema", model: "cinema-v2", provider: "video-cinema", baseUrl: "https://video-cinema.example.test" });
});

test("provider binding replaces stale image provider and model selections from a Skill or imported workflow", () => {
  const imageDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "image"
      ? { ...node, config: { ...node.config, selectedProviderId: "pptoken", selectedModelId: "gpt-image-2" } }
      : node),
  };
  const bound = bindWorkflowProviderDefaults(imageDefinition, {
    provider: { id: "text-main", source: "deepseek", model: "deepseek-v4-flash" },
    providers: {
      "image-main": { id: "image-main", source: "openai-compatible", model: "image/quality", models: ["image/fast", "image/quality"], baseUrl: "https://image.example.test" },
    },
    defaults: { image: "image-main" },
  });
  const image = bound.nodes.find((node) => node.nodeKey === "image")?.config ?? {};
  assert.equal(image.provider, "image-main");
  assert.equal(image.model, "image/quality");
  assert.equal(image.selectedProviderId, "image-main");
  assert.equal(image.selectedModelId, "image/quality");
});

test("provider binding keeps account-owned RunningHub workflow IDs in the local profile only", () => {
  const digitalDefinition: WorkflowDefinitionEnvelope = { ...definition, nodes: [...definition.nodes, { nodeKey: "human", type: "digital_human", nodeVersion: 1, title: "Human", positionX: 4, positionY: 0, config: {} }] };
  const bound = bindWorkflowProviderDefaults(digitalDefinition, {
    provider: { id: "text", model: "text/default" },
    providers: { video: { id: "video", source: "runninghub", model: "workflow", baseUrl: "https://video.example.test", digitalHumanWorkflowId: "human-workflow" } },
    defaults: { video: "video" },
  });
  assert.deepEqual(bound.nodes.find((node) => node.nodeKey === "human")?.config, { provider: "video", model: "workflow", baseUrl: "https://video.example.test" });
  assert.equal("digitalHumanWorkflowId" in (sanitizeWorkflowDefinitionForStorage(bound).nodes.find((node) => node.nodeKey === "human")?.config ?? {}), false);
});

test("RunningHub treats registered video workflows as its model catalog without a workflow reference field", () => {
  const videoDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "video"
      ? { ...node, config: { selectedProviderId: "runninghub-video", model: "remote-video-2" } }
      : node),
  };
  const bound = bindWorkflowProviderDefaults(videoDefinition, {
    provider: { id: "text", model: "text/default" },
    providers: {
      "runninghub-video": {
        id: "runninghub-video",
        source: "runninghub",
        model: "legacy-model-id",
        models: ["legacy-model-id"],
        baseUrl: "https://www.runninghub.ai",
        capabilities: ["video"],
        workflows: [
          { id: "video-one", remoteWorkflowId: "remote-video-1", name: "First video", capability: "video", version: 1, definitionHash: "one", source: { kind: "manual", importedAt: "2026-01-01T00:00:00.000Z" }, inputSchema: [], nodeBindings: [], outputSchema: [] },
          { id: "video-two", remoteWorkflowId: "remote-video-2", name: "Second video", capability: "video", version: 1, definitionHash: "two", source: { kind: "manual", importedAt: "2026-01-01T00:00:00.000Z" }, inputSchema: [], nodeBindings: [], outputSchema: [] },
        ],
      },
    },
    defaults: { video: "runninghub-video" },
  });

  const video = bound.nodes.find((node) => node.nodeKey === "video")?.config ?? {};
  assert.equal(video.model, "remote-video-2");
  assert.equal("workflowRef" in video, false);
  assert.equal(video.provider, "runninghub-video");
});

test("RunningHub treats registered image workflows as the image model catalog", () => {
  const imageDefinition: WorkflowDefinitionEnvelope = {
    ...definition,
    nodes: definition.nodes.map((node) => node.nodeKey === "image"
      ? { ...node, config: { selectedProviderId: "runninghub-image", selectedModelId: "remote-image-2", workflowRef: "legacy-image-ref" } }
      : node),
  };
  const bound = bindWorkflowProviderDefaults(imageDefinition, {
    provider: { id: "text", model: "text/default" },
    providers: {
      "runninghub-image": {
        id: "runninghub-image",
        source: "runninghub",
        model: "legacy-model-id",
        models: ["legacy-model-id"],
        baseUrl: "https://www.runninghub.ai",
        capabilities: ["image"],
        workflows: [
          { id: "image-one", remoteWorkflowId: "remote-image-1", name: "First image", capability: "image", version: 1, definitionHash: "one", source: { kind: "manual", importedAt: "2026-01-01T00:00:00.000Z" }, inputSchema: [], nodeBindings: [], outputSchema: [] },
          { id: "image-two", remoteWorkflowId: "remote-image-2", name: "Second image", capability: "image", version: 1, definitionHash: "two", source: { kind: "manual", importedAt: "2026-01-01T00:00:00.000Z" }, inputSchema: [], nodeBindings: [], outputSchema: [] },
        ],
      },
    },
    defaults: { image: "runninghub-image" },
  });

  const image = bound.nodes.find((node) => node.nodeKey === "image")?.config ?? {};
  assert.equal(image.model, "remote-image-2");
  assert.equal("workflowRef" in image, false);
});
