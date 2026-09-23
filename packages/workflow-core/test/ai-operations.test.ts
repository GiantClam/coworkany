import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWorkflowAiCommands,
  hashWorkflowDefinition,
  migrateLegacyWorkflowDefinition,
  WorkflowAiOperationError,
  type WorkflowAiCommand,
  type WorkflowDefinitionEnvelope,
  type WorkflowDefinitionNodeV2,
} from "../src";

function baseDefinition(): WorkflowDefinitionEnvelope {
  return migrateLegacyWorkflowDefinition({
    revision: 3,
    nodes: [
      { nodeKey: "input", type: "text_input", title: "Input", config: { text: "hello" } },
      { nodeKey: "writer", type: "writer", title: "Writer", config: {} },
      { nodeKey: "output", type: "output", title: "Output", config: {} },
    ],
    edges: [
      { sourceNodeKey: "input", targetNodeKey: "writer", inputName: "text" },
      { sourceNodeKey: "writer", targetNodeKey: "output", inputName: "text" },
    ],
  }, { revision: 3 });
}

const node = (overrides: Partial<WorkflowDefinitionNodeV2> = {}): WorkflowDefinitionNodeV2 => ({
  nodeKey: "second-input",
  type: "text_input",
  nodeVersion: 1,
  title: "Second input",
  positionX: 20,
  positionY: 40,
  config: { text: "world" },
  ...overrides,
});

function assertOperationError(code: WorkflowAiOperationError["code"]) {
  return (error: unknown) => error instanceof WorkflowAiOperationError && error.code === code;
}

test("applies a command group atomically and advances one revision", () => {
  const definition = baseDefinition();
  const originalHash = definition.definitionHash;
  const commands: WorkflowAiCommand[] = [
    { type: "add_node", node: node() },
    { type: "update_node", nodeKey: "writer", patch: { title: "Draft article", config: { prompt: "Concise" } } },
    { type: "layout_nodes", nodeKeys: ["writer", "output"], positions: { writer: { x: 500, y: 80 }, output: { x: 900, y: 80 } } },
    { type: "connect_nodes", edge: { edgeKey: "second-writer", sourceNodeKey: "second-input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" } },
  ];

  const result = applyWorkflowAiCommands({ definition, baseRevision: 3, commands });

  assert.equal(result.definition.revision, 4);
  assert.equal(result.definition.nodes.find((item) => item.nodeKey === "writer")?.title, "Draft article");
  assert.deepEqual(result.definition.nodes.find((item) => item.nodeKey === "writer")?.config, { prompt: "Concise" });
  assert.equal(result.definition.nodes.find((item) => item.nodeKey === "output")?.positionX, 900);
  assert.ok(result.definition.edges.some((edge) => edge.edgeKey === "second-writer"));
  assert.deepEqual(result.changedNodeKeys, ["output", "second-input", "writer"]);
  assert.equal(result.definition.definitionHash, hashWorkflowDefinition(result.definition));
  assert.equal(definition.definitionHash, originalHash);
  assert.equal(definition.nodes.some((item) => item.nodeKey === "second-input"), false);
});

test("copies nodes, updates port mappings, and removes related edges with deletion", () => {
  const definition = baseDefinition();
  const copied = node({ nodeKey: "writer-copy", type: "writer", title: "Writer copy", positionX: 500, config: {} });
  const result = applyWorkflowAiCommands({
    definition,
    baseRevision: 3,
    commands: [
      { type: "copy_node", sourceNodeKey: "writer", node: copied },
      { type: "update_port_mapping", nodeKey: "writer-copy", portId: "text", value: "input.text" },
      { type: "delete_node", nodeKey: "writer" },
    ],
  });

  assert.equal(result.definition.nodes.some((item) => item.nodeKey === "writer"), false);
  assert.deepEqual(result.definition.nodes.find((item) => item.nodeKey === "writer-copy")?.config.portMappings, { text: "input.text" });
  assert.equal(result.definition.edges.length, 0);
});

test("disconnects an existing edge without changing unrelated graph data", () => {
  const definition = baseDefinition();
  const edgeKey = definition.edges[0].edgeKey;
  const result = applyWorkflowAiCommands({ definition, baseRevision: 3, commands: [{ type: "disconnect_nodes", edgeKey }] });

  assert.equal(result.definition.edges.length, 1);
  assert.equal(result.definition.edges[0].edgeKey, definition.edges[1].edgeKey);
  assert.deepEqual(result.definition.nodes.map((item) => item.nodeKey), definition.nodes.map((item) => item.nodeKey));
});

test("rejects a stale revision before applying commands", () => {
  const definition = baseDefinition();
  assert.throws(
    () => applyWorkflowAiCommands({ definition, baseRevision: 2, commands: [{ type: "add_node", node: node() }] }),
    assertOperationError("workflow_ai_revision_conflict"),
  );
});

test("rejects unknown node types and duplicate keys as invalid commands", () => {
  const definition = baseDefinition();
  assert.throws(
    () => applyWorkflowAiCommands({ definition, baseRevision: 3, commands: [{ type: "add_node", node: node({ type: "unknown" }) }] }),
    assertOperationError("workflow_ai_invalid_command"),
  );
  assert.throws(
    () => applyWorkflowAiCommands({ definition, baseRevision: 3, commands: [{ type: "add_node", node: node({ nodeKey: "input" }) }] }),
    assertOperationError("workflow_ai_invalid_command"),
  );
});

test("rejects undeclared and incompatible ports without mutating the input", () => {
  const definition = baseDefinition();
  const original = JSON.stringify(definition);
  assert.throws(
    () => applyWorkflowAiCommands({ definition, baseRevision: 3, commands: [{ type: "connect_nodes", edge: { edgeKey: "bad-port", sourceNodeKey: "input", sourcePortId: "missing", targetNodeKey: "writer", targetPortId: "text" } }] }),
    assertOperationError("workflow_ai_validation_failed"),
  );
  assert.throws(
    () => applyWorkflowAiCommands({ definition, baseRevision: 3, commands: [{ type: "connect_nodes", edge: { edgeKey: "bad-kind", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "output", targetPortId: "image" } }] }),
    assertOperationError("workflow_ai_validation_failed"),
  );
  assert.equal(JSON.stringify(definition), original);
});

test("rejects partial command groups and leaves the input unchanged", () => {
  const definition = baseDefinition();
  const original = JSON.stringify(definition);
  assert.throws(
    () => applyWorkflowAiCommands({
      definition,
      baseRevision: 3,
      commands: [
        { type: "add_node", node: node() },
        { type: "delete_node", nodeKey: "missing" },
      ],
    }),
    assertOperationError("workflow_ai_invalid_command"),
  );
  assert.equal(JSON.stringify(definition), original);
});
