import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchClient, WorkflowAiOperationGroup } from "@coworkany/workbench-client";
import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import {
  createWorkflowAiController,
  parseWorkflowAiAssistantResponse,
  workflowAiProviderOptions,
  resolveWorkflowAiTextProvider,
  resolveWorkflowAiNextInferenceProvider,
  recordWorkflowAiRepairAttempt,
  shouldRetryWorkflowAiRepair,
} from "../src/workflow-ai-controller";
import type { DesktopProviderConfig } from "../src/provider-config";
import { WORKFLOW_GOLDEN_TEMPLATE_REGISTRY } from "../src/workflow-golden-template-registry";

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

function authoringResponse<T extends { operationGroup?: { commands: readonly unknown[] } }>(response: T, requiredCapabilities: readonly string[] = [], selectedTemplate: string | null = null, templateVersion: number | null = null) {
  if (!response.operationGroup) return response;
  return {
    ...response,
    plan: {
      schemaVersion: 1,
      intent: "Test workflow change",
      requiredCapabilities,
      selectedTemplate,
      templateVersion,
      assumptions: [],
      operations: response.operationGroup.commands,
      validationResult: { status: "valid", issues: [], repairAttempt: 0 },
    },
  };
}

test("provider context includes only configured text providers without credentials", () => {
  const options = workflowAiProviderOptions(providers);
  assert.deepEqual(options.map((option) => option.id), ["text-a"]);
  assert.deepEqual(options.find((option) => option.id === "text-a")?.models, ["model-a", "model-a-fast"]);
  assert.equal(JSON.stringify(options).includes("secret-a"), false);
  assert.deepEqual(options[0]?.capabilities, ["text"]);
});

test("workflow assistant can select any configured text Provider/model without exposing media Providers", () => {
  const paidProvider = { id: "paid-text", source: "openai-compatible", baseUrl: "https://paid.test/v1", apiKey: "secret-paid", model: "premium", models: ["premium", "fast"], capabilities: ["text"] as const };
  const fallback = providers[0]!;
  const selected = resolveWorkflowAiTextProvider([...providers, paidProvider], "paid-text", "premium", fallback);
  assert.equal(selected.id, "paid-text");
  assert.equal(selected.model, "premium");
  assert.equal(selected.apiKey, "secret-paid");
  assert.equal(resolveWorkflowAiTextProvider([...providers, paidProvider], "image-b", "image-b", fallback), fallback);
  assert.equal(resolveWorkflowAiTextProvider([...providers, paidProvider], "paid-text", "unconfigured", fallback), fallback);
});

test("assistant may declare a configured paid text provider for the next turn, but rejects media or unknown targets", () => {
  const paidProvider = { id: "paid-text", source: "openai-compatible", baseUrl: "https://paid.test/v1", apiKey: "secret-paid", model: "premium", models: ["premium"], capabilities: ["text"] as const };
  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify({ message: "I will use the premium model next.", nextInferenceProvider: { providerId: "paid-text", modelId: "premium" } }));
  assert.deepEqual(parsed.nextInferenceProvider, { providerId: "paid-text", modelId: "premium" });
  assert.throws(() => parseWorkflowAiAssistantResponse(JSON.stringify({ message: "bad", nextInferenceProvider: { providerId: "paid-text", modelId: "premium", apiKey: "leak" } })), /workflow_ai_invalid_next_inference_provider/);
  assert.equal(resolveWorkflowAiNextInferenceProvider([...providers, paidProvider], { providerId: "image-b", modelId: "image-b" }), undefined);
  assert.equal(resolveWorkflowAiNextInferenceProvider([...providers, paidProvider], { providerId: "missing", modelId: "premium" }), undefined);
});

test("declared next provider changes only the next inference target and never mutates workflow bindings", async () => {
  const paidProvider = { id: "paid-text", source: "openai-compatible", baseUrl: "https://paid.test/v1", apiKey: "secret-paid", model: "premium", models: ["premium"], capabilities: ["text"] as const };
  const applied: WorkflowAiOperationGroup[] = [];
  let nextProvider: DesktopProviderConfig | undefined;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: [], providers: [...providers, paidProvider],
    client: client(applied), onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
    onNextInferenceProvider: (provider) => { nextProvider = provider; },
  });
  const result = await controller.handleAssistantResponse(JSON.stringify({ message: "Done; use premium next.", nextInferenceProvider: { providerId: "paid-text", modelId: "premium" } }), "Describe this workflow");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.nextInferenceProvider, { providerId: "paid-text", modelId: "premium" });
  assert.equal(nextProvider?.id, "paid-text");
  assert.equal(nextProvider?.model, "premium");
  assert.equal(applied.length, 0);
});

test("workflow graph validation permits one repair request and then fails closed", () => {
  const attempts = new Map<string, 0 | 1>();
  const failed = { status: "failed" as const, error: "workflow_ai_semantic_validation_failed:image-generation" };
  assert.equal(shouldRetryWorkflowAiRepair(failed, "original-user", attempts), true);
  recordWorkflowAiRepairAttempt(attempts, "original-user", "repair-user");
  assert.equal(shouldRetryWorkflowAiRepair(failed, "original-user", attempts), false);
  assert.equal(shouldRetryWorkflowAiRepair(failed, "repair-user", attempts), false);
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "provider_timeout" }, "new-user", attempts), false);
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "workflow_ai_plan_operations_mismatch" }, "protocol-user", attempts), true);
  recordWorkflowAiRepairAttempt(attempts, "protocol-user", "protocol-repair-user");
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "workflow_ai_plan_operations_mismatch" }, "protocol-user", attempts), false);
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "workflow_ai_invalid_response" }, "invalid-user", attempts), true);
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "workflow_ai_invalid_validation_result" }, "validation-user", attempts), true);
  recordWorkflowAiRepairAttempt(attempts, "invalid-user", "invalid-repair-user");
  assert.equal(shouldRetryWorkflowAiRepair({ status: "failed", error: "workflow_ai_invalid_response" }, "invalid-user", attempts), false);
  assert.equal(shouldRetryWorkflowAiRepair({ status: "applied" }, "new-user", attempts), false);
});

test("assistant protocol extracts one JSON object surrounded by plain text", () => {
  assert.deepEqual(parseWorkflowAiAssistantResponse('Here is the workflow update:\n{"message":"Ready."}\nDone.'), { message: "Ready." });
});

test("assistant protocol accepts one allowlisted operation group and rejects arbitrary tools", () => {
  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify(authoringResponse({
    message: "Moved the writer node.",
    operationGroup: { summary: "Arrange writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 400, y: 120 } } }] },
  })));
  assert.equal(parsed.operationGroup?.commands[0]?.type, "layout_nodes");
  assert.throws(() => parseWorkflowAiAssistantResponse(JSON.stringify({ message: "no", operationGroup: { summary: "escape", commands: [{ type: "bash", command: "pwd" }] } })), /workflow_ai_tool_not_allowed/);
});

test("assistant protocol fails closed when the versioned plan is missing or diverges from commands", () => {
  const commands = [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 400, y: 120 } } }];
  assert.throws(() => parseWorkflowAiAssistantResponse(JSON.stringify({
    message: "Moved the writer.", operationGroup: { summary: "Move", commands },
  })), /workflow_ai_plan_required/);
  assert.throws(() => parseWorkflowAiAssistantResponse(JSON.stringify({
    message: "Moved the writer.",
    plan: { schemaVersion: 1, intent: "Move", requiredCapabilities: [], selectedTemplate: null, templateVersion: null, assumptions: [], operations: [], validationResult: { status: "valid", issues: [], repairAttempt: 0 } },
    operationGroup: { summary: "Move", commands },
  })), /workflow_ai_plan_operations_mismatch/);
});

test("plan-only provider responses use plan operations and still wait for explicit approval", async () => {
  const commands = [{ type: "update_node", nodeKey: "writer", patch: { config: { prompt: "Draft a short cafe announcement." } } }];
  const response = {
    message: "Proposed a writer prompt update. Approval is required before this change is applied.",
    plan: {
      schemaVersion: 1,
      intent: "Update the writer prompt",
      requiredCapabilities: [],
      selectedTemplate: null,
      templateVersion: null,
      assumptions: [],
      operations: commands,
      validationResult: { status: "valid", issues: [], repairAttempt: 0 },
    },
    runWorkflow: false,
  };
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: current,
    selectedNodeKeys: [],
    providers,
    client: client(applied),
    onDefinitionChange: (next) => { current = next; },
    onFocusNodes: () => undefined,
  });

  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify(response));
  assert.deepEqual(parsed.operationGroup, { summary: response.plan.intent, commands });
  const result = await controller.handleAssistantResponse(JSON.stringify(response), "Require approval before applying this change.");

  assert.equal(result.status, "approval_required");
  assert.equal(applied.length, 0);
  assert.equal(current.revision, 1);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.config.prompt, "Draft");

  const approved = await controller.approve(result.toolCallId!);
  assert.equal(approved.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.revision, 2);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.config.prompt, "Draft a short cafe announcement.");
});

test("assistant protocol normalizes named allowlisted commands and automatic validation", () => {
  const parsed = parseWorkflowAiAssistantResponse(JSON.stringify(authoringResponse({
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
  })));

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

  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Moved the writer node.",
    operationGroup: { summary: "Arrange writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 420, y: 160 } } }] },
  })), "Arrange the selected node");

  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].commands.length, 1);
  assert.equal(current.revision, 2);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.positionX, 420);
});

test("one AI request persists a multi-command change once and notifies global history once", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let notifications = 0;
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: current, selectedNodeKeys: [], providers,
    client: client(applied),
    onDefinitionChange: (next) => { notifications += 1; current = next; },
    onFocusNodes: () => undefined,
  });
  const commands = [
    { type: "layout_nodes", nodeKeys: ["writer", "output"], positions: { writer: { x: 420, y: 120 }, output: { x: 840, y: 120 } } },
    { type: "update_node", nodeKey: "writer", patch: { title: "Edited article" } },
  ];
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Updated the writer and arranged the result path.", operationGroup: { summary: "Edit and arrange", commands },
  })), "Rename and arrange the authoring path");
  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.commands.length, 2);
  assert.equal(notifications, 1);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.title, "Edited article");
});

test("capability requests reject title-only mutations without changing the workflow", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let changed = false;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: definition(),
    selectedNodeKeys: ["writer"],
    providers,
    client: client(applied),
    onDefinitionChange: () => { changed = true; },
    onFocusNodes: () => undefined,
  });

  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "已改成图文混排文章工作流。",
    operationGroup: {
      summary: "改为图文混排文章",
      commands: [{ type: "update_node", nodeKey: "writer", patch: { title: "图文混排文章写作" } }],
    },
  })), "当前工作流应该是生成图文混排的文章");

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "workflow_ai_capability_change_requires_structure");
  assert.equal(applied.length, 0);
  assert.equal(changed, false);
});

test("explicit rename requests still apply title-only mutations", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: current,
    selectedNodeKeys: ["writer"],
    providers,
    client: client(applied),
    onDefinitionChange: (next) => { current = next; },
    onFocusNodes: () => undefined,
  });

  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Renamed the writer node.",
    operationGroup: {
      summary: "Rename writer",
      commands: [{ type: "update_node", nodeKey: "writer", patch: { title: "Article writer" } }],
    },
  })), "Rename the writer node to Article writer");

  assert.equal(result.status, "applied");
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.title, "Article writer");
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

  const deletion = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Remove the generated branch.",
    operationGroup: { summary: "Remove generated branch", commands: [{ type: "delete_node", nodeKey: "writer" }, { type: "delete_node", nodeKey: "output" }] },
  })), "Remove that branch");
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

test("switching an already selected configured provider does not require approval", async () => {
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

  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Switch the writer provider.",
    operationGroup: {
      summary: "Switch writer provider",
      commands: [{ type: "update_node", nodeKey: "writer", patch: { config: { selectedProviderId: "text-b", selectedModelId: "model-b" } } }],
    },
  })), "Switch the writer to text-b");

  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
});

test("explicit user approval requests keep an ordinary edit pending until approved", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const before = definition();
  let current = before;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: before, selectedNodeKeys: ["writer"], providers,
    client: client(applied), onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "I will wait for your approval before applying this prompt edit.",
    operationGroup: {
      summary: "Update writer prompt",
      commands: [{ type: "update_node", nodeKey: "writer", patch: { config: { prompt: "Draft a concise launch announcement." } } }],
    },
  })), "Present this edit for approval before applying it");

  assert.equal(result.status, "approval_required");
  assert.ok(result.toolCallId);
  assert.equal(applied.length, 0);
  assert.deepEqual(current, before);
  assert.equal(controller.messages.some((message) => JSON.stringify(message).includes("approval-requested")), true);

  const approved = await controller.approve(result.toolCallId!);
  assert.equal(approved.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.config.prompt, "Draft a concise launch announcement.");
});

test("rejects a configured text Provider bound to an image node without approval or mutation", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const before = definition();
  let current = before;
  let historyNotifications = 0;
  let focused = 0;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: before,
    selectedNodeKeys: [],
    providers,
    client: client(applied),
    onDefinitionChange: (next) => { historyNotifications += 1; current = next; },
    onFocusNodes: () => { focused += 1; },
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "I added an image-generation node.",
    operationGroup: {
      summary: "Add image node",
      commands: [
        { type: "add_node", node: { nodeKey: "illustration", type: "image_generate", nodeVersion: 1, title: "Illustration", positionX: 0, positionY: 0, config: { prompt: "Create an illustration", selectedProviderId: "text-a", selectedModelId: "model-a" } } },
        { type: "connect_nodes", edge: { edgeKey: "input-illustration", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "illustration", targetPortId: "text" } },
        { type: "connect_nodes", edge: { edgeKey: "illustration-output", sourceNodeKey: "illustration", sourcePortId: "image", targetNodeKey: "output", targetPortId: "images" } },
      ],
    },
  }, ["image-generation", "result-composition"])), "Add an image-generation node");

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "workflow_ai_incompatible_provider_rejected");
  assert.equal(applied.length, 0);
  assert.equal(historyNotifications, 0);
  assert.equal(focused, 0);
  assert.deepEqual(current, before);
  assert.equal(controller.messages.some((message) => JSON.stringify(message).includes("approval-requested")), false);
});

test("keeps provider-dependent nodes and graph edges while marking missing execution setup", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current: WorkflowDefinitionEnvelope = { ...definition(), metadata: { templateKey: "content-pipeline", templateVersion: 1 } };
  const controller = createWorkflowAiController({
    workflowId: "workflow-1",
    definition: current,
    selectedNodeKeys: [],
    providers,
    goldenTemplates: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY,
    client: client(applied),
    onDefinitionChange: (next) => { current = next; },
    onFocusNodes: () => undefined,
  });
  const commands = [
    { type: "add_node", node: { nodeKey: "illustration", type: "image_generate", nodeVersion: 1, title: "Illustration", positionX: 0, positionY: 0, config: { prompt: "Create an illustration" } } },
    { type: "connect_nodes", edge: { edgeKey: "input-illustration", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "illustration", targetPortId: "text" } },
    { type: "connect_nodes", edge: { edgeKey: "illustration-output", sourceNodeKey: "illustration", sourcePortId: "image", targetNodeKey: "output", targetPortId: "images" } },
  ] as const;
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Added the image-generation path; configure an image provider before running.",
    operationGroup: { summary: "Add illustration path", commands },
  }, ["image-generation", "result-composition"], "image-campaign", WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.find((template) => template.templateKey === "image-campaign")?.templateVersion ?? 1)), "Add images to this workflow");

  assert.equal(result.status, "applied");
  assert.equal(current.nodes.some((node) => node.nodeKey === "illustration"), true);
  assert.equal(current.edges.some((edge) => edge.edgeKey === "illustration-output"), true);
  assert.equal(current.nodes.find((node) => node.nodeKey === "illustration")?.config.needsConfig, true);
  assert.equal(current.nodes.find((node) => node.nodeKey === "illustration")?.config.provider, undefined);
  assert.equal(current.nodes.find((node) => node.nodeKey === "illustration")?.config.model, undefined);
  assert.equal(current.metadata?.templateKey, "content-pipeline");
  assert.equal(current.metadata?.templateVersion, 1);
});

test("accepts a needs-configuration plan when its valid graph adds an unconfigured execution node", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current: WorkflowDefinitionEnvelope = { ...definition(), metadata: { templateKey: "content-pipeline", templateVersion: 1 } };
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: current, selectedNodeKeys: [], providers,
    goldenTemplates: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY, client: client(applied),
    onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const commands = [
    { type: "add_node", node: { nodeKey: "illustration", type: "image_generate", nodeVersion: 1, title: "Illustration", positionX: 0, positionY: 0, config: { prompt: "Create an illustration" } } },
    { type: "connect_nodes", edge: { edgeKey: "input-illustration", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "illustration", targetPortId: "text" } },
    { type: "connect_nodes", edge: { edgeKey: "illustration-output", sourceNodeKey: "illustration", sourcePortId: "image", targetNodeKey: "output", targetPortId: "images" } },
  ];
  const response = {
    message: "Added the image path; configure an image provider before running.",
    plan: {
      schemaVersion: 1, intent: "Add image generation", requiredCapabilities: ["image-generation", "result-composition"],
      selectedTemplate: "image-campaign", templateVersion: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.find((template) => template.templateKey === "image-campaign")?.templateVersion ?? 1, assumptions: [], operations: commands,
      validationResult: { status: "needs_configuration", issues: ["Configure an image provider before running."], repairAttempt: 0 },
    },
    operationGroup: { summary: "Add image path", commands },
  };
  const result = await controller.handleAssistantResponse(JSON.stringify(response), "Add images to this workflow");
  assert.equal(result.status, "applied", result.error);
  assert.equal(current.nodes.find((node) => node.nodeKey === "illustration")?.config.needsConfig, true);
  assert.equal(applied.length, 1);
});

test("adding a node may connect to an existing node with a stale provider binding", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const base = definition();
  const beforeWithoutHash = {
    ...base,
    nodes: base.nodes.map((node) => node.nodeKey === "writer"
      ? { ...node, nodeKey: "capability", config: { ...node.config, selectedProviderId: "fixture-a", selectedModelId: "fixture-a-model" } }
      : node),
    edges: base.edges.map((edge) => ({
      ...edge,
      sourceNodeKey: edge.sourceNodeKey === "writer" ? "capability" : edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey === "writer" ? "capability" : edge.targetNodeKey,
    })),
    definitionHash: "",
  };
  const before = { ...beforeWithoutHash, definitionHash: hashWorkflowDefinition(beforeWithoutHash) };
  let current = before;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: before, selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Added a text node.",
    operationGroup: { summary: "Add text node", commands: [
      { type: "add_node", node: { nodeKey: "new-writer", type: "llm_generate", nodeVersion: 1, title: "New writer", positionX: 480, positionY: 180, config: { prompt: "Expand this draft" } } },
      { type: "connect_nodes", edge: { edgeKey: "capability-new-writer", sourceNodeKey: "capability", sourcePortId: "text", targetNodeKey: "new-writer", targetPortId: "text" } },
    ] },
  })), "Add a text node after the capability node");

  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.nodes.find((node) => node.nodeKey === "capability")?.config.selectedProviderId, "fixture-a");
  assert.equal(current.nodes.find((node) => node.nodeKey === "new-writer")?.config.needsConfig, true);
});

test("preserves existing template provenance for an ordinary edit", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const before: WorkflowDefinitionEnvelope = { ...definition(), metadata: { templateKey: "image-campaign", templateVersion: 2 } };
  let current = before;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: before, selectedNodeKeys: [], providers,
    goldenTemplates: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY, client: client(applied),
    onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Renamed the output.",
    operationGroup: { summary: "Rename output", commands: [{ type: "update_node", nodeKey: "output", patch: { title: "Result" } }] },
  })), "Rename the output");
  assert.equal(result.status, "applied");
  assert.equal(applied.length, 1);
  assert.deepEqual(current.metadata && { templateKey: current.metadata.templateKey, templateVersion: current.metadata.templateVersion }, { templateKey: "image-campaign", templateVersion: 2 });
});

test("rejects a declared template outside the deterministic top match set", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: [], providers,
    goldenTemplates: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY, client: client(applied),
    onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Added a presentation path.",
    operationGroup: { summary: "Add presentation", commands: [{ type: "update_node", nodeKey: "output", patch: { config: { format: "slides" } } }] },
  }, ["image-generation"], "presentation", 1)), "Add image generation");
  assert.equal(result.status, "rejected");
  assert.equal(result.error, "workflow_ai_unknown_golden_template");
  assert.equal(applied.length, 0);
});

test("nonempty starter graphs cannot bypass a matching template with null selection", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "starter", definition: definition(), selectedNodeKeys: [], providers,
    goldenTemplates: WORKFLOW_GOLDEN_TEMPLATE_REGISTRY, client: client(applied),
    onDefinitionChange: () => assert.fail("must not mutate"), onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Claim success without choosing an available template.",
    operationGroup: { summary: "Add images", commands: [{ type: "update_node", nodeKey: "output", patch: { config: { format: "images" } } }] },
  }, ["image-generation"])), "Add image generation");
  assert.equal(result.error, "workflow_ai_golden_template_required");
  assert.equal(applied.length, 0);
});

test("template structure requires every repeated node type", async () => {
  const graph = definition();
  const template = { templateKey: "two-writers", templateVersion: 1, capabilities: ["text-generation"] as const, nodeTypes: ["text_input", "llm_generate", "output"], requiredProviderCapabilities: ["text"], definition: { ...graph, nodes: [...graph.nodes, { ...graph.nodes[1]!, nodeKey: "second-writer" }] } };
  const controller = createWorkflowAiController({
    workflowId: "starter", definition: graph, selectedNodeKeys: [], providers,
    goldenTemplates: [template], client: client([]),
    onDefinitionChange: () => assert.fail("must not mutate"), onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Only updated one writer.", operationGroup: { summary: "Missing second writer", commands: [{ type: "update_node", nodeKey: "writer", patch: { config: { prompt: "Draft new copy" } } }] },
  }, ["text-generation"], "two-writers", 1)), "Create a two-writer workflow");
  assert.equal(result.error, "workflow_ai_golden_template_structure_mismatch");
});

test("fails closed with concrete missing capabilities when a repair candidate remains semantically incomplete", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let changes = 0;
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: () => { changes += 1; }, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Added an image node, but did not connect it to the workflow.",
    operationGroup: { summary: "Incomplete image path", commands: [{ type: "add_node", node: { nodeKey: "illustration", type: "image_generate", nodeVersion: 1, title: "Illustration", positionX: 0, positionY: 0, config: {} } }] },
  }, ["image-generation"])), "Add an image-generation path");
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /workflow_ai_semantic_validation_failed:image-generation/);
  assert.equal(applied.length, 0);
  assert.equal(changes, 0);
});

test("requires approval before adding more than twenty nodes", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
  });
  const commands = Array.from({ length: 21 }, (_, index) => ({ type: "add_node", node: { nodeKey: `extra-${index}`, type: "llm_generate", nodeVersion: 1, title: `Extra ${index}`, positionX: 0, positionY: 0, config: {} } }));
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Add the requested nodes.", operationGroup: { summary: "Large node addition", commands },
  })), "Add these generated steps");
  assert.equal(result.status, "approval_required");
  assert.equal(applied.length, 0);
});

test("rejects Provider IDs that are not configured instead of treating them as an approval choice", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: ["writer"], providers,
    client: client(applied), onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "I selected a provider.",
    operationGroup: { summary: "Configure writer", commands: [{ type: "update_node", nodeKey: "writer", patch: { config: { selectedProviderId: "invented-provider" } } }] },
  })), "Set the writer provider");
  assert.equal(result.status, "rejected");
  assert.equal(result.error, "workflow_ai_unconfigured_provider_rejected");
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
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Moved writer.",
    operationGroup: { summary: "Move writer", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 500, y: 10 } } }] },
  })), "Move writer");
  assert.equal(result.status, "failed");
  assert.equal(result.error, "workflow_ai_revision_conflict");
  assert.equal(changed, false);
});

test("conceptual and ambiguous requests do not mutate, while safe defaults can accompany a deterministic edit", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: current, selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const conceptual = await controller.handleAssistantResponse(JSON.stringify({ message: "The workflow already has a text input, writer, and output path." }), "What is in this workflow?");
  assert.equal(conceptual.status, "completed");
  assert.equal(applied.length, 0);
  assert.equal(current.revision, 1);
  const ambiguousTopology = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "I could not safely connect the requested branch because its source node is missing.",
    operationGroup: { summary: "Connect requested branch", commands: [{ type: "connect_nodes", edge: { edgeKey: "missing-writer", sourceNodeKey: "missing", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" } }] },
  })), "Connect the branch");
  assert.equal(ambiguousTopology.status, "failed");
  assert.equal(applied.length, 0);
  assert.equal(current.revision, 1);
  const safeDefault = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Arranged the writer using the deterministic default layout.",
    operationGroup: { summary: "Use deterministic default layout", commands: [{ type: "layout_nodes", nodeKeys: ["writer"], positions: { writer: { x: 420, y: 0 } } }] },
  })), "Arrange the writer");
  assert.equal(safeDefault.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.nodes.find((node) => node.nodeKey === "writer")?.positionX, 420);
});

test("exactly twenty added nodes apply automatically, while a single-node deletion stays below the approval boundary", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: current, selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const commands = Array.from({ length: 20 }, (_, index) => ({ type: "add_node", node: { nodeKey: `exact-${index}`, type: "llm_generate", nodeVersion: 1, title: `Exact ${index}`, positionX: 0, positionY: 0, config: {} } }));
  const additions = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Added twenty generated steps.", operationGroup: { summary: "Twenty-node addition", commands },
  })), "Add these twenty generated steps");
  assert.equal(additions.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.nodes.length, 23);
  const deletion = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Removed the selected generated step.", operationGroup: { summary: "Remove one step", commands: [{ type: "delete_node", nodeKey: "exact-0" }] },
  })), "Remove this one node");
  assert.equal(deletion.status, "applied");
  assert.equal(applied.length, 2);
  assert.equal(current.nodes.some((node) => node.nodeKey === "exact-0"), false);
});

test("irreversible node replacement waits for approval", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: ["writer"], providers,
    client: client(applied), onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
  });
  const result = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Replace the writer with an image generator.", operationGroup: { summary: "Replace writer node", commands: [{ type: "update_node", nodeKey: "writer", patch: { type: "image_generate" } }] },
  })), "Replace the writer node");
  assert.equal(result.status, "approval_required");
  assert.equal(applied.length, 0);
  assert.equal(result.toolCallId !== undefined, true);
});

test("send fails explicitly when the assistant transport is unavailable", async () => {
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: definition(), selectedNodeKeys: [], providers,
    client: client([]), onDefinitionChange: () => undefined, onFocusNodes: () => undefined,
  });
  const result = await controller.send("Describe this workflow");
  assert.equal(result.status, "failed");
  assert.equal(result.error, "workflow_ai_transport_unavailable");
});

test("a valid repair candidate succeeds after the first candidate fails semantic validation", async () => {
  const applied: WorkflowAiOperationGroup[] = [];
  let current = definition();
  const controller = createWorkflowAiController({
    workflowId: "workflow-1", definition: current, selectedNodeKeys: [], providers,
    client: client(applied), onDefinitionChange: (next) => { current = next; }, onFocusNodes: () => undefined,
  });
  const invalid = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "The first candidate is incomplete.", operationGroup: { summary: "Incomplete repair", commands: [{ type: "add_node", node: { nodeKey: "repair-image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 0, positionY: 0, config: {} } }] },
  }, ["image-generation"])), "Create an image path");
  assert.equal(invalid.status, "failed");
  assert.match(invalid.error ?? "", /workflow_ai_semantic_validation_failed:image-generation/);
  assert.equal(applied.length, 0);
  assert.equal(current.nodes.some((node) => node.nodeKey === "repair-image"), false);
  const repaired = await controller.handleAssistantResponse(JSON.stringify(authoringResponse({
    message: "Repaired the candidate with a connected image path.",
    operationGroup: { summary: "Repair image path", commands: [
      { type: "add_node", node: { nodeKey: "repair-image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 0, positionY: 0, config: {} } },
      { type: "connect_nodes", edge: { edgeKey: "input-repair-image", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "repair-image", targetPortId: "text" } },
      { type: "connect_nodes", edge: { edgeKey: "repair-image-output", sourceNodeKey: "repair-image", sourcePortId: "image", targetNodeKey: "output", targetPortId: "images" } },
    ] },
  }, ["image-generation"])), "Repair the image path");
  assert.equal(repaired.status, "applied");
  assert.equal(applied.length, 1);
  assert.equal(current.nodes.some((node) => node.nodeKey === "repair-image"), true);
  assert.equal(current.edges.some((edge) => edge.edgeKey === "repair-image-output"), true);
});
