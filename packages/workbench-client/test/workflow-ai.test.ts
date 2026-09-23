import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import {
  WORKFLOW_AI_TOOL_NAMES,
  createWorkflowAiPrompt,
  isWorkflowAiToolName,
  parseWorkflowAiToolDecision,
  workflowAiContextToMetadata,
  type WorkflowAiContext,
  type WorkflowAiToolDecision,
} from "../src/workflow-ai";
import { parseDesktopUIMessage } from "../src/uimessage";

function definition(): WorkflowDefinitionEnvelope {
  return {
    schemaVersion: 2,
    revision: 7,
    definitionHash: "a".repeat(64),
    metadata: { apiKey: "sk-metadata-secret-123456", workspace: "/Users/alice/project" },
    nodes: [{
      nodeKey: "source",
      type: "workflow_input",
      nodeVersion: 1,
      title: "Input from /Users/alice/private.txt",
      positionX: 10,
      positionY: 20,
      config: {
        apiKey: "sk-node-secret-123456",
        baseUrl: "https://alice:password@example.com/v1",
        path: "C:\\Users\\alice\\private.txt",
        prompt: "private node payload",
      },
    }],
    edges: [],
  };
}

function context(): WorkflowAiContext {
  return {
    workflowId: "workflow-1",
    revision: 7,
    definition: definition(),
    selectedNodeKeys: ["source"],
    validationIssues: [{
      code: "invalid_workflow_definition",
      nodeKey: "source",
      message: "Invalid source at file:///Users/alice/private.json",
    }],
    configuredProviders: [
      { id: "openai", label: "OpenAI", models: ["gpt-5"], capabilities: ["text", "tools"], available: true, estimatedCost: 0.2 },
      { id: "gemini", label: "Gemini", models: ["gemini-2.5-pro"], capabilities: ["text", "vision"], available: true },
      { id: "offline", label: "Offline", models: ["none"], capabilities: ["text"], available: false },
    ],
    viewport: { x: 100, y: 50, scale: 0.8 },
  };
}

test("serializes a minimal workflow context without credentials, local paths, or node payloads", () => {
  const metadata = workflowAiContextToMetadata(context());
  const serialized = JSON.stringify(metadata);

  assert.equal(serialized.includes("sk-metadata-secret"), false);
  assert.equal(serialized.includes("sk-node-secret"), false);
  assert.equal(serialized.includes("alice:password"), false);
  assert.equal(serialized.includes("/Users/alice"), false);
  assert.equal(serialized.includes("C:\\\\Users"), false);
  assert.equal(serialized.includes("private node payload"), false);
  const metadataDefinition = metadata.definition as { nodes: readonly Record<string, unknown>[] };
  assert.equal("config" in metadataDefinition.nodes[0]!, false);
  assert.equal("metadata" in (metadata.definition as Record<string, unknown>), false);
  assert.equal(serialized.includes("[redacted-path]"), true);
});

test("retains every configured provider that is currently available", () => {
  const metadata = workflowAiContextToMetadata(context());
  assert.deepEqual(metadata.configuredProviders, [
    { id: "openai", label: "OpenAI", models: ["gpt-5"], capabilities: ["text", "tools"], available: true, estimatedCost: 0.2 },
    { id: "gemini", label: "Gemini", models: ["gemini-2.5-pro"], capabilities: ["text", "vision"], available: true },
  ]);
});

test("creates a prompt with sanitized context and user text", () => {
  const prompt = createWorkflowAiPrompt(context(), "Use sk-user-secret-123456 and /home/alice/input.txt");
  assert.match(prompt, /<workflow-context>/);
  assert.match(prompt, /<user-request>/);
  assert.equal(prompt.includes("sk-user-secret"), false);
  assert.equal(prompt.includes("/home/alice"), false);
  assert.match(prompt, /Do not run the workflow unless the user explicitly asks/);
});

test("workflow prompt gives the model the canonical mutation command shape", () => {
  const prompt = createWorkflowAiPrompt(context(), "Rename the input node");
  assert.match(prompt, /"type":"update_node","nodeKey":"node-key","patch":\{"title":"New title"\}/);
  assert.match(prompt, /Never put validate_workflow, focus_nodes, run_preflight, or run_workflow inside operationGroup\.commands/);
  assert.match(prompt, /Use the type field, never name/);
});

test("accepts only the named workflow tools", () => {
  for (const toolName of WORKFLOW_AI_TOOL_NAMES) assert.equal(isWorkflowAiToolName(toolName), true, toolName);
  for (const toolName of ["execute_code", "fetch_url", "write_credentials", "database_query", "apply_json_patch", "run_shell"]) {
    assert.equal(isWorkflowAiToolName(toolName), false, toolName);
  }
});

test("round-trips approval decisions and rejects malformed decisions", () => {
  const decision: WorkflowAiToolDecision = { toolCallId: "tool-1", operationGroupId: "group-1", decision: "approve" };
  assert.deepEqual(parseWorkflowAiToolDecision(JSON.parse(JSON.stringify(decision))), decision);
  assert.equal(parseWorkflowAiToolDecision({ ...decision, decision: "always_allow" }), null);
  assert.equal(parseWorkflowAiToolDecision({ decision: "reject" }), null);
});

test("preserves the AI SDK dynamic tool states used by workflow approvals", () => {
  const states = ["input-available", "approval-requested", "output-available", "output-error", "output-denied"] as const;
  const message = parseDesktopUIMessage({
    id: "assistant-1",
    role: "assistant",
    parts: states.map((state, index) => ({
      type: "dynamic-tool",
      toolName: "update_node",
      toolCallId: `tool-${index}`,
      state,
      input: { nodeKey: "source" },
      ...(state === "approval-requested" ? { approval: { id: `approval-${index}` } } : {}),
      ...(state === "output-available" ? { output: { ok: true } } : {}),
      ...(state === "output-error" ? { errorText: "failed" } : {}),
    })),
  });

  assert.deepEqual(message.parts.map((part) => "state" in part ? part.state : undefined), states);
});
