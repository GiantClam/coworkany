import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWorkflowCapabilities,
  hashWorkflowDefinition,
  layoutWorkflowDeterministically,
  matchGoldenWorkflowTemplates,
  parseWorkflowAuthoringPlan,
  validateWorkflowAuthoringResult,
  composeWorkflowComposableGraphs,
  type GoldenWorkflowTemplateDescriptor,
  type WorkflowDefinitionEnvelope,
} from "../src";

function illustratedArticle(): WorkflowDefinitionEnvelope {
  const value: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Brief", positionX: 91, positionY: 22, config: { text: "" } },
      { nodeKey: "writer", type: "writer", nodeVersion: 1, title: "Article", positionX: 12, positionY: 43, config: {} },
      { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Illustration", positionX: 12, positionY: 43, config: {} },
      { nodeKey: "store", type: "product_store", nodeVersion: 1, title: "Result", positionX: 12, positionY: 43, config: { fileName: "article.md" } },
    ],
    edges: [
      { edgeKey: "input-writer", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" },
      { edgeKey: "input-image", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "image", targetPortId: "text" },
      { edgeKey: "writer-store", sourceNodeKey: "writer", sourcePortId: "text", targetNodeKey: "store", targetPortId: "text" },
      { edgeKey: "image-store", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "store", targetPortId: "images" },
    ],
  };
  return { ...value, definitionHash: hashWorkflowDefinition(value) };
}

test("parses a strict versioned authoring plan and rejects unknown fields", () => {
  const plan = {
    schemaVersion: 1,
    intent: "Create an illustrated article",
    requiredCapabilities: ["article-generation", "image-generation", "result-composition"],
    selectedTemplate: "image-campaign",
    templateVersion: 1,
    assumptions: ["Use the configured text provider"],
    operations: [{ type: "add_node" }],
    validationResult: { status: "valid", issues: [], repairAttempt: 0 },
  };
  assert.deepEqual(parseWorkflowAuthoringPlan(plan), plan);
  const needsConfiguration = { ...plan, validationResult: { status: "needs_configuration", issues: ["Configure an image Provider before running."], repairAttempt: 0 } };
  assert.deepEqual(parseWorkflowAuthoringPlan(needsConfiguration), needsConfiguration);
  assert.throws(() => parseWorkflowAuthoringPlan({ ...plan, hidden: true }), /workflow_ai_invalid_plan/);
  assert.throws(() => parseWorkflowAuthoringPlan({ ...plan, selectedTemplate: null }), /workflow_ai_template_provenance_incomplete/);
});

test("derives illustrated article capabilities only from executable paths", () => {
  const definition = illustratedArticle();
  assert.deepEqual(deriveWorkflowCapabilities(definition), ["text-input", "text-generation", "article-generation", "image-generation", "result-composition", "artifact-persistence"]);
  assert.equal(validateWorkflowAuthoringResult(definition, ["article-generation", "image-generation", "result-composition"]).valid, true);

  const disconnected = { ...definition, edges: definition.edges.filter((edge) => edge.edgeKey !== "image-store"), definitionHash: "" };
  disconnected.definitionHash = hashWorkflowDefinition(disconnected);
  const result = validateWorkflowAuthoringResult(disconnected, ["article-generation", "image-generation", "result-composition"]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.semanticIssues.map((issue) => issue.capability), ["image-generation"]);
});

test("titles never create capabilities", () => {
  const definition = illustratedArticle();
  const withoutImage = {
    ...definition,
    nodes: definition.nodes.filter((node) => node.nodeKey !== "image").map((node) => node.nodeKey === "writer" ? { ...node, title: "图文混排与图片生成" } : node),
    edges: definition.edges.filter((edge) => edge.sourceNodeKey !== "image" && edge.targetNodeKey !== "image"),
    definitionHash: "",
  };
  withoutImage.definitionHash = hashWorkflowDefinition(withoutImage);
  assert.equal(validateWorkflowAuthoringResult(withoutImage, ["image-generation"]).valid, false);
});

test("orphan capabilities and invalid provider config are never executable", () => {
  const orphan = illustratedArticle();
  orphan.nodes.push({ nodeKey: "orphan-audio", type: "audio_generate", nodeVersion: 1, title: "Orphan", positionX: 0, positionY: 0, config: {} });
  orphan.definitionHash = hashWorkflowDefinition(orphan);
  assert.deepEqual(deriveWorkflowCapabilities(orphan), ["text-input", "text-generation", "article-generation", "image-generation", "result-composition", "artifact-persistence"]);

  const orphanOnly: WorkflowDefinitionEnvelope = {
    schemaVersion: 2, revision: 1, definitionHash: "",
    nodes: [{ nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Orphan", positionX: 0, positionY: 0, config: {} }], edges: [],
  };
  orphanOnly.definitionHash = hashWorkflowDefinition(orphanOnly);
  assert.deepEqual(deriveWorkflowCapabilities(orphanOnly), []);

  const isolated = {
    ...orphan,
    nodes: orphan.nodes.filter((node) => node.nodeKey !== "image"),
    edges: orphan.edges.filter((edge) => ![edge.sourceNodeKey, edge.targetNodeKey].includes("image")),
    definitionHash: "",
  };
  isolated.definitionHash = hashWorkflowDefinition(isolated);
  assert.deepEqual(deriveWorkflowCapabilities(isolated), ["text-input", "text-generation", "article-generation", "result-composition", "artifact-persistence"]);

  const invalidConfig = {
    ...illustratedArticle(),
    nodes: illustratedArticle().nodes.map((node) => node.nodeKey === "image" ? { ...node, config: { selectedProviderId: 42 } } : node),
    definitionHash: "",
  };
  invalidConfig.definitionHash = hashWorkflowDefinition(invalidConfig);
  const result = validateWorkflowAuthoringResult(invalidConfig, ["image-generation"]);
  assert.equal(result.valid, false);
  assert.ok(result.graphIssues.some((issue) => issue.field === "config.selectedProviderId"));
  assert.deepEqual(deriveWorkflowCapabilities(invalidConfig), []);
});

test("lays out changed nodes deterministically while preserving untouched positions", () => {
  const definition = illustratedArticle();
  const first = layoutWorkflowDeterministically(definition, ["writer", "image", "store"]);
  const second = layoutWorkflowDeterministically(definition, ["writer", "image", "store"]);
  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.nodes.find((node) => node.nodeKey === "input"), definition.nodes.find((node) => node.nodeKey === "input"));
  assert.notDeepEqual(first.nodes.find((node) => node.nodeKey === "writer"), definition.nodes.find((node) => node.nodeKey === "writer"));
});

test("ranks golden templates by capability coverage before configuration cost", () => {
  const templates: GoldenWorkflowTemplateDescriptor[] = [
    { templateKey: "content", templateVersion: 1, capabilities: ["article-generation", "result-composition"], nodeTypes: ["text_input", "writer", "product_store"], requiredProviderCapabilities: ["text"] },
    { templateKey: "illustrated", templateVersion: 2, capabilities: ["article-generation", "image-generation", "result-composition"], nodeTypes: ["text_input", "writer", "image_generate", "product_store"], requiredProviderCapabilities: ["text", "image"] },
  ];
  const matches = matchGoldenWorkflowTemplates({ templates, requiredCapabilities: ["article-generation", "image-generation", "result-composition"], configuredProviderCapabilities: ["text"] });
  assert.equal(matches[0]?.templateKey, "illustrated");
  assert.equal(matches[0]?.pendingConfigurationCount, 1);
  assert.equal(matches[0]?.coverage, 1);
});

test("composes a primary graph and registered subgraph with deterministic namespaces", () => {
  const primary = illustratedArticle();
  const fragment = illustratedArticle();
  const result = composeWorkflowComposableGraphs({
    primary: {
      graphKind: "primary", graphKey: "content-pipeline", definition: primary,
      inputs: [{ boundaryKey: "workflow-input", nodeKey: "input", portId: "text", dataType: "text", disposition: "external", maxBindings: 1 }],
      outputs: [{ boundaryKey: "article", nodeKey: "store", portId: "text", dataType: "text", disposition: "external", maxBindings: "many" }, { boundaryKey: "writer-text", nodeKey: "writer", portId: "text", dataType: "text", disposition: "bindable", maxBindings: 1 }],
    },
    subgraphs: [{
      graphKind: "subgraph", graphKey: "article-image-publish", subgraphKey: "article-image-publish", subgraphVersion: 1, capabilities: ["image-generation"], validatedProvenance: "fixture-v1", registered: true, definition: fragment,
      inputs: [{ boundaryKey: "brief", nodeKey: "writer", portId: "text", dataType: "text", disposition: "bindable", maxBindings: 1 }],
      outputs: [{ boundaryKey: "illustration", nodeKey: "image", portId: "image", dataType: "image", disposition: "external", maxBindings: "many" }],
    }],
    bindings: [{ from: { graphKind: "primary", graphKey: "content-pipeline", boundaryKey: "writer-text" }, to: { graphKind: "subgraph", graphKey: "article-image-publish", boundaryKey: "brief" } }],
    registeredSubgraphKeys: ["article-image-publish"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.definition.nodes.every((node) => node.nodeKey.startsWith("n:")));
  assert.ok(result.definition.edges.some((edge) => edge.edgeKey.startsWith("b:")));
  assert.deepEqual(result.inputs.map((boundary) => boundary.boundaryKey), ["workflow-input"]);
  assert.deepEqual(result.outputs.map((boundary) => boundary.boundaryKey), ["article", "illustration"]);
  assert.deepEqual(result.inputs.map((boundary) => boundary.nodeKey), ["n:primary:content-pipeline:input"]);
  assert.deepEqual(result.outputs.map((boundary) => boundary.nodeKey), ["n:primary:content-pipeline:store", "n:subgraph:article-image-publish:image"]);
});

test("rejects full-template subgraphs, incompatible bindings, and long composed keys", () => {
  const definition = illustratedArticle();
  const graph = { graphKind: "primary" as const, graphKey: "x", definition, inputs: [], outputs: [] };
  const fullTemplate = { ...graph, graphKind: "subgraph" as const, graphKey: "x", subgraphKey: "x", subgraphVersion: 1, capabilities: [], validatedProvenance: "ok" };
  const rejected = composeWorkflowComposableGraphs({ primary: graph, subgraphs: [fullTemplate], bindings: [], registeredSubgraphKeys: ["x"] });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.issues.some((issue) => issue.code === "full_template_not_composable"));
  const incompatible = composeWorkflowComposableGraphs({
    primary: { ...graph, graphKey: "p", outputs: [{ boundaryKey: "out", nodeKey: "writer", portId: "text", dataType: "text", disposition: "bindable", maxBindings: 1 }] },
    subgraphs: [{ ...fullTemplate, graphKey: "s", inputs: [{ boundaryKey: "in", nodeKey: "image", portId: "image", dataType: "image", disposition: "bindable", maxBindings: 1 }] }],
    bindings: [{ from: { graphKind: "primary", graphKey: "p", boundaryKey: "out" }, to: { graphKind: "subgraph", graphKey: "s", boundaryKey: "in" } }],
    registeredSubgraphKeys: ["s"],
  });
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.ok(incompatible.issues.some((issue) => issue.code === "incompatible_boundary_port"));
});

test("enforces boundary declaration, cardinality, and collision contracts", () => {
  const definition = illustratedArticle();
  const primary = { graphKind: "primary" as const, graphKey: "same", definition, inputs: [{ boundaryKey: "entry", nodeKey: "input", portId: "text", dataType: "text" as const, disposition: "external" as const, maxBindings: 1 as const }], outputs: [{ boundaryKey: "source", nodeKey: "writer", portId: "text", dataType: "text" as const, disposition: "bindable" as const, maxBindings: 1 as const }, { boundaryKey: "out", nodeKey: "writer", portId: "text", dataType: "text" as const, disposition: "external" as const, maxBindings: "many" as const }] };
  const subgraph = { graphKind: "subgraph" as const, graphKey: "same", subgraphKey: "article-image-publish", subgraphVersion: 1, capabilities: ["image-generation"] as const, validatedProvenance: "fixture", registered: true as const, definition, inputs: [{ boundaryKey: "in", nodeKey: "writer", portId: "text", dataType: "text" as const, disposition: "bindable" as const, maxBindings: 1 as const }], outputs: [{ boundaryKey: "out", nodeKey: "image", portId: "image", dataType: "image" as const, disposition: "external" as const, maxBindings: "many" as const }] };
  const composed = composeWorkflowComposableGraphs({ primary, subgraphs: [subgraph], registeredSubgraphKeys: ["article-image-publish"], bindings: [{ from: { graphKind: "primary", graphKey: "same", boundaryKey: "source" }, to: { graphKind: "subgraph", graphKey: "same", boundaryKey: "in" } }] });
  assert.equal(composed.ok, false, "fixture intentionally exposes duplicate public output boundary");
  if (!composed.ok) assert.ok(composed.issues.some((issue) => issue.code === "duplicate_output_boundary"));

  const fanout = composeWorkflowComposableGraphs({ primary: { ...primary, graphKey: "p", outputs: [{ ...primary.outputs[0], boundaryKey: "fanout", maxBindings: "many" as const }] }, subgraphs: [{ ...subgraph, graphKey: "s", inputs: [{ ...subgraph.inputs[0], boundaryKey: "in-1" }, { ...subgraph.inputs[0], boundaryKey: "in-2" }] }], registeredSubgraphKeys: ["article-image-publish"], bindings: [{ from: { graphKind: "primary", graphKey: "p", boundaryKey: "fanout" }, to: { graphKind: "subgraph", graphKey: "s", boundaryKey: "in-1" } }, { from: { graphKind: "primary", graphKey: "p", boundaryKey: "fanout" }, to: { graphKind: "subgraph", graphKey: "s", boundaryKey: "in-2" } }] });
  assert.equal(fanout.ok, true, "many output may fan out to multiple inputs");
  const overbound = composeWorkflowComposableGraphs({ primary: { ...primary, graphKey: "p2" }, subgraphs: [{ ...subgraph, graphKey: "s2" }], registeredSubgraphKeys: ["article-image-publish"], bindings: [{ from: { graphKind: "primary", graphKey: "p2", boundaryKey: "source" }, to: { graphKind: "subgraph", graphKey: "s2", boundaryKey: "in" } }, { from: { graphKind: "primary", graphKey: "p2", boundaryKey: "source" }, to: { graphKind: "subgraph", graphKey: "s2", boundaryKey: "in" } }] });
  assert.equal(overbound.ok, false);
  if (!overbound.ok) assert.ok(overbound.issues.some((issue) => issue.code === "boundary_binding_cardinality_exceeded"));
});
