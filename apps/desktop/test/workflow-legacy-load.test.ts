import assert from "node:assert/strict";
import test from "node:test";
import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { parseSavedWorkflowDefinition } from "../src/App";

function savedDefinition(): WorkflowDefinitionEnvelope {
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 7,
    definitionHash: "",
    metadata: { templateKey: "legacy-template", templateVersion: 1 },
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 12, positionY: 24, config: { text: "keep" } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 612, positionY: 24, config: {} },
    ],
    edges: [{ edgeKey: "input-output", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" }],
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}

test("saved workflow reads preserve the serialized legacy definition by default", () => {
  const definition = savedDefinition();
  const serialized = JSON.stringify(definition);
  const parsed = parseSavedWorkflowDefinition({ id: "legacy", name: "Legacy", definition_json: serialized, updated_at: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(parsed, definition);
  assert.equal(JSON.stringify(parsed), serialized);
});
