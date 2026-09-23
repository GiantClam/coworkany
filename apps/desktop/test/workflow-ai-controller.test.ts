import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchClient, WorkflowAiOperationGroup } from "@coworkany/workbench-client";
import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import {
  createWorkflowAiController,
  parseWorkflowAiAssistantResponse,
  workflowAiProviderOptions,
} from "../src/workflow-ai-controller";

function definition(): WorkflowDefinitionEnvelope {
  const value: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 0, positionY: 0, config: { text: "Brief" } },
      { nodeKey: "writer", type: "llm_generate", nodeVersion: 1, title: "Writer", positionX: 320, positionY: 0, config: { prompt: "Draft", selectedProviderId: "text-a", selectedModelId: "model-a" } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 640, positionY: 0, config: {} },
    ],
    edges: [
      { edgeKey: "input-writer", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" },
      { edgeKey: "writer-output", sourceNodeKey: "writer", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
    ],
  };
  return { ...value, definitionHash: hashWorkflowDefinition(value) };
}

function client(
  applied: WorkflowAiOperationGroup[],
) {
  return {
    workflows: {
      async applyAiOperation(input: {
        definition: WorkflowDefinitionEnvelope;
        operationGroup: WorkflowAiOperationGroup;
      }) {
        applied.push(input.operationGroup);
        return { id: "workflow-1", title: "Workflow", definition: input.definition, updatedAt: new Date().toISOString() };
      },
      async operationGroups() { return applied; },
    },
  } as unknown as WorkbenchClient;
}

const providers = [
  { id: "text-a", source: "openai-compatible", baseUrl: "https://a.test/v1", apiKey: "secret-a", model: "model-a", models: ["model-a", "model-a-fast"], capabilities: ["text"] as const },
  { id: "image-b", source: "bailian", baseUrl: "https://b.test/v1", apiKey: "secret-b", model: "image-b", capabilities: ["image"] as const },
];

test("provider context includes only configured text providers without credentials", () => {
  const options = workflowAiProviderOptions(providers);
  assert.deepEqual(options.map((option) => option.id), ["text-a"]);
  assert.deepEqual(options.find((option) => option.id === "text-a")?.models, ["model-a", "model-a-fast"]);
  assert.equal(JSON.stringify(options).includes("secret-a"), false);
  assert.deepEqual(options[0]?.capabilities, ["text"]);
});

test("assistant protocol accepts one allowlisted operation group and rejects arbitrary tools", () => {
  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify({
    message: "Moved the writer node.",
    operationGroup: { summary: "Arrange writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 400, y: 120 } } }] },
  }));
  assert.equal(parsed.operationGroup?.commands[0]?.type, "layout_nodes");
  assert.throws(() => parseWorkflowAiAssistantResponse(JSON.stringify({ message: "no", operationGroup: { summary: "escape", commands: [{ type: "bash", command: "pwd" }] } })), /workflow_ai_tool_not_allowed/);
});

test("assistant protocol normalizes named allowlisted commands and automatic validation", () => {
  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify({
    message: "Renamed the input node.",
    operationGroup: {
      summary: "Rename input",
      commands: [
        { name: "update_node", nodeKey: "input", title: "Acceptance input" },
        { name: "validate_workflow" },
      ],
    },
    focusNodeKeys: ["input"],
    runWorkflow: false,
  }));

  assert.deepEqual(parsed.operationGroup?.commands, [
    { type: "update_node", nodeKey: "input", patch: { title: "Acceptance input" } },
  ]);
});

test("low-risk edits apply as one validated and persisted operation group", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    conversationId: "workflow-ai:workflow-1",
    definition: current,
    selectedNodeKeys: ["writer"],
    providers,
    client: client(applied),
    onDefinitionChange: (next) => { current = next; },
    onFocusNodes: () => undefined,
  });

  const result = await controller.handleAssistantResponse(JSON.stringify({
    message: "Moved the writer node.",
    operationGroup: { summary: "Arrange writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 420, y: 160 } } }] },
  }), "Arrange the selected node");

  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].commands.length, 1);
  assert.equal(current.revision, 2);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.positionX, 420);
});

test("destructive batches and runs wait for approval, and runs require an explicit request", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let runs = 0;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    conversationId: "workflow-ai:workflow-1",
    definition: definition(),
    selectedNodeKeys: [],
    providers,
    client: client(applied),
    onDefinitionChange: () => undefined,
    onFocusNodes: () => undefined,
    onRun: async () => { runs += 1; },
  });

  const deletion = await controller.handleAssistantResponse(JSON.stringify({
    message: "Remove the generated branch.",
    operationGroup: { summary: "Remove generated branch", commands: [{ type: "delete_node", nodeKey: "writer" }, { type: "delete_node", nodeKey: "output" }] },
  }), "Remove that branch");
  assert.equal(deletion.status, "approval_required");
  assert.equal(applied.length, 0);

  const implicitRun = await controller.handleAssistantResponse(JSON.stringify({ message: "Ready.", runWorkflow: true }), "Check whether this is valid");
  assert.equal(implicitRun.status, "rejected");
  assert.equal(runs, 0);

  const explicitRun = await controller.handleAssistantResponse(JSON.stringify({ message: "Ready to test.", runWorkflow: true }), "Please test run this workflow");
  assert.equal(explicitRun.status, "approval_required");
  await controller.approve(explicitRun.toolCallId!);
  assert.equal(runs, 1);
});

test("switching an already selected provider always waits for approval", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: definition(),
    selectedNodeKeys: ["writer"],
    providers: [
      ...providers,
      { id: "text-b", source: "openai-compatible", baseUrl: "https://b.test/v1", apiKey: "secret-c", model: "model-b", capabilities: ["text"] as const },
    ],
    client: client(applied),
    onDefinitionChange: () => undefined,
    onFocusNodes: () => undefined,
  });

  const result = await controller.handleAssistantResponse(JSON.stringify({
    message: "Switch the writer provider.",
    operationGroup: {
      summary: "Switch writer provider",
      commands: [{ type: "update_node", nodeKey: "writer", patch: { config: { selectedProviderId: "text-b", selectedModelId: "model-b" } } }],
    },
  }), "Switch the writer to text-b");

  assert.equal(result.status, "approval_required");
  assert.equal(applied.length, 0);
});

test("a stale persisted revision never overwrites the local definition", async () => {
  let changed = false;
  const staleClient = {
    workflows: {
      ...client([]).workflows,
      async applyAiOperation() { throw new Error("workflow_ai_revision_conflict: expected 1, actual 2"); },
    },
  } as unknown as WorkbenchClient;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: definition(),
    selectedNodeKeys: [],
    providers,
    client: staleClient,
    onDefinitionChange: () => { changed = true; },
    onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify({
    message: "Moved writer.",
    operationGroup: { summary: "Move writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 500, y: 10 } } }] },
  }), "Move writer");
  assert.equal(result.status, "failed");
  assert.equal(result.error, "workflow_ai_revision_conflict");
  assert.equal(changed, false);
});
