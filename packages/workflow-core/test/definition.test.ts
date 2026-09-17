import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalizeWorkflowDefinition, canonicalizeWorkflowDefinitionJson, compileWorkflowPlan, hashWorkflowDefinition, migrateLegacyWorkflowDefinition, migrateWorkflowDefinitionToCurrent, parseWorkflowDefinitionEnvelope, validateWorkflowDefinition, validateWorkflowPortDefinition, WorkflowDefinitionValidationError } from "../src";

test("migrates legacy nodes and creates a stable definition hash", () => {
  const current = migrateLegacyWorkflowDefinition({ nodes: [{ nodeKey: "a", type: "text_input", config: { text: "hello" } }, { nodeKey: "b", type: "writer" }], edges: [{ sourceNodeKey: "a", targetNodeKey: "b", inputName: "text" }] });
  assert.equal(current.schemaVersion, 2);
  assert.equal(current.definitionHash.length, 64);
  assert.deepEqual(current.edges[0], { edgeKey: "legacy:a:b:text:0", sourceNodeKey: "a", sourcePortId: "text", targetNodeKey: "b", targetPortId: "text", inputName: "text" });
});

test("legacy edge migration is independent of payload ordering", () => {
  const input = { nodes: [{ nodeKey: "out", type: "text_input" }, { nodeKey: "writer", type: "writer" }], edges: [{ sourceNodeKey: "out", targetNodeKey: "writer", inputName: "text" }, { sourceNodeKey: "out", targetNodeKey: "writer", inputName: "text" }] };
  assert.deepEqual(migrateLegacyWorkflowDefinition(input).edges, migrateLegacyWorkflowDefinition({ ...input, edges: [...input.edges].reverse() }).edges);
});

test("migration prefers an adapter-supplied persisted revision", () => {
  const input = { revision: 2, nodes: [{ nodeKey: "a", type: "text_input" }], edges: [] };
  assert.equal(migrateLegacyWorkflowDefinition(input, { revision: 7 }).revision, 7);
});

test("migrates the legacy still-image video template to local composition", () => {
  const input = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 0, positionY: 0, config: {} },
      { nodeKey: "audio", type: "upload", nodeVersion: 1, title: "Audio", positionX: 0, positionY: 1, config: {} },
      { nodeKey: "subtitle", type: "file_create", nodeVersion: 1, title: "Subtitle", positionX: 0, positionY: 2, config: { fileFormat: "srt" } },
      { nodeKey: "video", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 1, positionY: 0, config: { requiresSubtitleBinding: true, mode: "auto", sound: "on", provider: "video-runninghub" } },
    ],
    edges: [
      { edgeKey: "image-video", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "video", targetPortId: "images", inputName: null },
      { edgeKey: "audio-video", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "video", targetPortId: "referenceAudios", inputName: null },
      { edgeKey: "subtitle-video", sourceNodeKey: "subtitle", sourcePortId: "asset", targetNodeKey: "video", targetPortId: "subtitle", inputName: null },
    ],
  } as const;
  const migrated = migrateWorkflowDefinitionToCurrent(input);
  const video = migrated.nodes.find((node) => node.nodeKey === "video");
  assert.equal(video?.type, "video_compose");
  assert.equal(video?.config.provider, undefined);
  assert.equal(video?.config.subtitleMode, "burn_in");
  assert.deepEqual(migrated.edges.map((edge) => edge.targetPortId).sort(), ["audio", "coverImage", "subtitle"]);
});

test("migrates legacy video compose image edges to the explicit cover port", () => {
  const input = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 0, positionY: 0, config: {} },
      { nodeKey: "compose", type: "video_compose", nodeVersion: 1, title: "Compose", positionX: 1, positionY: 0, config: {} },
    ],
    edges: [{ edgeKey: "image-compose", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "compose", targetPortId: "image", inputName: null }],
  } as const;
  const migrated = migrateWorkflowDefinitionToCurrent(input);
  assert.equal(migrated.edges[0]?.targetPortId, "coverImage");
  assert.equal(validateWorkflowDefinition(migrated).length, 0);
});

test("does not migrate AI video workflows with video inputs", () => {
  const input = {
    schemaVersion: 2, revision: 1, definitionHash: "",
    nodes: [{ nodeKey: "video", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 0, positionY: 0, config: { requiresSubtitleBinding: true } }],
    edges: [{ edgeKey: "source", sourceNodeKey: "source", sourcePortId: "video", targetNodeKey: "video", targetPortId: "videos", inputName: null }, { edgeKey: "subtitle", sourceNodeKey: "subtitle", sourcePortId: "asset", targetNodeKey: "video", targetPortId: "subtitle", inputName: null }, { edgeKey: "audio", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "video", targetPortId: "referenceAudios", inputName: null }, { edgeKey: "image", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "video", targetPortId: "images", inputName: null }],
  } as const;
  assert.equal(migrateWorkflowDefinitionToCurrent(input).nodes[0]?.type, "video_generate");
});

test("rejects cycles before workflow execution", () => {
  const definition = migrateLegacyWorkflowDefinition({ nodes: [{ nodeKey: "a", type: "text_input" }, { nodeKey: "b", type: "writer" }], edges: [{ sourceNodeKey: "a", targetNodeKey: "b", inputName: "text" }, { sourceNodeKey: "b", targetNodeKey: "a", inputName: "text" }] });
  assert.ok(validateWorkflowDefinition(definition).some((issue) => issue.code === "workflow_cycle_detected"));
  assert.throws(() => parseWorkflowDefinitionEnvelope(definition));
});

test("compiles a deterministic dependency order", () => {
  const definition = migrateLegacyWorkflowDefinition({ nodes: [{ nodeKey: "b", type: "writer" }, { nodeKey: "a", type: "text_input" }, { nodeKey: "c", type: "output" }], edges: [{ sourceNodeKey: "a", targetNodeKey: "b", inputName: "text" }, { sourceNodeKey: "b", targetNodeKey: "c", inputName: "text" }] });
  assert.deepEqual(compileWorkflowPlan(definition).steps.map((step) => step.nodeKey), ["a", "b", "c"]);
});

test("canonical hash ignores revision and nested config key ordering", () => {
  const first = migrateLegacyWorkflowDefinition({ nodes: [{ nodeKey: "input", type: "text_input", config: { nested: { beta: 2, alpha: 1 } } }], edges: [] });
  const reordered = { ...first, revision: first.revision + 1, nodes: [{ ...first.nodes[0], config: { nested: { alpha: 1, beta: 2 } } }] };
  assert.equal(hashWorkflowDefinition(first), hashWorkflowDefinition(reordered));
  assert.equal(hashWorkflowDefinition(first), createHash("sha256").update(canonicalizeWorkflowDefinitionJson(first)).digest("hex"));
  assert.deepEqual(canonicalizeWorkflowDefinition(reordered).nodes[0].config, { nested: { alpha: 1, beta: 2 } });
});

test("definition parsing rejects stale hashes and reports stable port issue codes", () => {
  const definition = migrateLegacyWorkflowDefinition({ nodes: [{ nodeKey: "input", type: "text_input" }, { nodeKey: "image", type: "image_generate" }], edges: [{ sourceNodeKey: "input", targetNodeKey: "image", inputName: "text" }] });
  assert.throws(() => parseWorkflowDefinitionEnvelope({ ...definition, definitionHash: "0".repeat(64) }), (error: unknown) => {
    assert.ok(error instanceof WorkflowDefinitionValidationError);
    assert.ok(error.issues.some((item) => item.code === "invalid_workflow_definition" && item.field === "definitionHash"));
    return true;
  });
  assert.deepEqual(validateWorkflowPortDefinition({ id: "bad", valueKind: "image", role: "unknown", cardinality: "many" }), [
    { code: "invalid_workflow_port_role", message: "port.role is invalid", nodeKey: "", field: "port" },
  ]);
});
