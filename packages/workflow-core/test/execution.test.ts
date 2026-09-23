import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflow, type WorkflowDefinitionEnvelope } from "../src/index";

const definition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
  { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Text", positionX: 0, positionY: 0, config: { text: "hello" } },
  { nodeKey: "writer", type: "writer", nodeVersion: 1, title: "Writer", positionX: 1, positionY: 0, config: {} },
], edges: [{ edgeKey: "e1", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" }] };

test("workflow execution propagates ports and emits ordered events", async () => {
  const calls: string[] = []; const events: number[] = [];
  const result = await executeWorkflow(definition, { runId: "run-1", ports: { capability: { execute: async ({ executorId, inputs }) => { calls.push(`${executorId}:${JSON.stringify(inputs)}`); return executorId === "text_input" ? { text: "hello" } : { text: "done" }; } }, events: { append: async (event) => { events.push(event.sequence); } } } });
  assert.equal(result.status, "succeeded"); assert.equal(calls[1], 'writer:{"text":"hello"}'); assert.deepEqual(events, [1, 2, 3, 4, 5, 6]);
});

test("workflow success events carry bounded checkpoint outputs", async () => {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const result = await executeWorkflow(definition, { runId: "checkpoint-run", ports: {
    capability: { execute: async ({ executorId }) => executorId === "text_input" ? { text: "hello" } : { text: "done" } },
    events: { append: async (event) => { events.push({ type: event.type, payload: event.payload }); } },
  } });
  assert.equal(result.status, "succeeded");
  const success = events.find((event) => event.type === "node_succeeded" && event.payload.nodeKey === "writer");
  assert.deepEqual(success?.payload, { nodeKey: "writer", checkpointKey: "writer", executorId: "writer", output: { text: "done" } });
});

test("workflow checkpoint outputs truncate oversized values before event transport", async () => {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  await executeWorkflow(definition, { runId: "checkpoint-limit", ports: {
    capability: { execute: async ({ executorId }) => executorId === "text_input" ? { text: "hello" } : Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`field-${index}`, "x".repeat(16_000)])) },
    events: { append: async (event) => { events.push({ type: event.type, payload: event.payload }); } },
  } });
  const success = events.find((event) => event.type === "node_succeeded" && event.payload.nodeKey === "writer");
  assert.deepEqual(success?.payload.output, { checkpointTruncated: true });
});

test("workflow cancellation returns cancelled without executing remaining nodes", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await executeWorkflow(definition, { runId: "run-2", signal: controller.signal, ports: { capability: { execute: async () => ({}) } } });
  assert.equal(result.status, "cancelled");
});

test("workflow executes independent DAG levels concurrently and emits deterministic node events", async () => {
  const parallelDefinition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
    { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Text", positionX: 0, positionY: 0, config: { text: "hello" } },
    { nodeKey: "writer-a", type: "writer", nodeVersion: 1, title: "Writer A", positionX: 1, positionY: 0, config: {} },
    { nodeKey: "writer-b", type: "writer", nodeVersion: 1, title: "Writer B", positionX: 1, positionY: 1, config: {} },
  ], edges: [
    { edgeKey: "a", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-a", targetPortId: "text" },
    { edgeKey: "b", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-b", targetPortId: "text" },
  ] };
  let active = 0; let peak = 0; const events: string[] = [];
  const result = await executeWorkflow(parallelDefinition, { runId: "parallel-run", ports: {
    capability: { execute: async ({ executorId }) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return executorId === "text_input" ? { text: "hello" } : { text: executorId }; } },
    events: { append: async (event) => { events.push(`${event.type}:${String(event.payload.nodeKey ?? "")}`); } },
  } });
  assert.equal(result.status, "succeeded");
  assert.equal(peak, 2);
  assert.deepEqual(events, ["run_started:", "node_started:input", "node_succeeded:input", "node_started:writer-a", "node_started:writer-b", "node_succeeded:writer-a", "node_succeeded:writer-b", "run_succeeded:"]);
});

test("workflow preserves successful parallel sibling outputs when another sibling fails", async () => {
  const parallelDefinition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
    { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Text", positionX: 0, positionY: 0, config: { text: "hello" } },
    { nodeKey: "writer-a", type: "writer", nodeVersion: 1, title: "Writer A", positionX: 1, positionY: 0, config: {} },
    { nodeKey: "writer-b", type: "writer", nodeVersion: 1, title: "Writer B", positionX: 1, positionY: 1, config: {} },
  ], edges: [
    { edgeKey: "a", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-a", targetPortId: "text" },
    { edgeKey: "b", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-b", targetPortId: "text" },
  ] };
  const events: string[] = [];
  const result = await executeWorkflow(parallelDefinition, { runId: "parallel-failure", ports: {
    capability: { execute: async ({ nodeKey }) => {
      if (nodeKey === "input") return { text: "hello" };
      if (nodeKey === "writer-b") throw new Error("provider_down");
      return { text: "writer-a-complete" };
    } },
    events: { append: async (event) => { events.push(`${event.type}:${String(event.payload.nodeKey ?? "")}`); } },
  } });
  assert.equal(result.status, "failed");
  assert.equal(result.outputs["writer-a"]?.text, "writer-a-complete");
  assert.ok(events.includes("node_succeeded:writer-a"));
  assert.ok(events.includes("node_failed:writer-b"));
});

test("workflow emits a node failure event before returning a failed run", async () => {
  const events: string[] = [];
  const result = await executeWorkflow(definition, { runId: "failed-run", ports: {
    capability: { execute: async ({ executorId }) => executorId === "writer" ? Promise.reject(new Error("provider_down")) : { text: "hello" } },
    events: { append: async (event) => { events.push(event.type); } },
  } });
  assert.equal(result.status, "failed");
  assert.ok(events.includes("node_failed"));
  assert.equal(events.at(-1), "run_failed");
});

test("workflow foreach executes its body with bounded concurrency and collects input order", async () => {
  const foreachDefinition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
    { nodeKey: "upload", type: "upload", nodeVersion: 1, title: "Upload", positionX: 0, positionY: 0, config: {} },
    { nodeKey: "foreach", type: "foreach", nodeVersion: 1, title: "For Each", positionX: 1, positionY: 0, config: { inputPortId: "asset", collectNodeKey: "collect", concurrency: 2, maxIterations: 10, failurePolicy: "fail_fast" } },
    { nodeKey: "agent", type: "agent_execute", nodeVersion: 1, title: "Agent", positionX: 2, positionY: 0, config: {} },
    { nodeKey: "collect", type: "collect", nodeVersion: 1, title: "Collect", positionX: 3, positionY: 0, config: {} },
  ], edges: [
    { edgeKey: "upload-foreach", sourceNodeKey: "upload", sourcePortId: "asset", targetNodeKey: "foreach", targetPortId: "items.asset" },
    { edgeKey: "foreach-agent", sourceNodeKey: "foreach", sourcePortId: "item.asset", targetNodeKey: "agent", targetPortId: "asset" },
    { edgeKey: "agent-collect", sourceNodeKey: "agent", sourcePortId: "text", targetNodeKey: "collect", targetPortId: "items.text" },
  ] };
  let active = 0; let peak = 0; const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const result = await executeWorkflow(foreachDefinition, { runId: "foreach-run", ports: { capability: { execute: async ({ executorId, inputs }) => {
    if (executorId === "upload") return { assets: ["a", "b", "c"] };
    if (executorId === "foreach") return { assets: ["a", "b", "c"] };
    if (executorId === "agent_execute") { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 8)); active -= 1; return { text: `done-${String(inputs.asset)}` }; }
    return { text: inputs["items.text"] };
  } }, events: { append: async (event) => { events.push({ type: event.type, payload: event.payload }); } } } });
  assert.equal(result.status, "succeeded");
  assert.equal(peak, 2);
  assert.deepEqual(result.outputs.collect?.text, ["done-a", "done-b", "done-c"]);
  assert.deepEqual(events.filter((event) => event.type === "node_succeeded" && event.payload.nodeKey === "agent").map((event) => event.payload.checkpointKey), ["agent:asset-1", "agent:asset-2", "agent:asset-3"]);
});

test("workflow foreach expands text segments and carries a shared reference image into the body", async () => {
  const textDefinition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
    { nodeKey: "script", type: "text_input", nodeVersion: 1, title: "Script", positionX: 0, positionY: 0, config: {} },
    { nodeKey: "reference", type: "image_generate", nodeVersion: 1, title: "Reference", positionX: 0, positionY: 1, config: {} },
    { nodeKey: "foreach", type: "foreach", nodeVersion: 1, title: "For Each", positionX: 1, positionY: 0, config: { inputPortId: "text", collectNodeKey: "collect", concurrency: 1, maxIterations: 10, failurePolicy: "fail_fast" } },
    { nodeKey: "video", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 2, positionY: 0, config: {} },
    { nodeKey: "collect", type: "collect", nodeVersion: 1, title: "Collect", positionX: 3, positionY: 0, config: {} },
  ], edges: [
    { edgeKey: "script-foreach", sourceNodeKey: "script", sourcePortId: "text", targetNodeKey: "foreach", targetPortId: "items.text" },
    { edgeKey: "reference-foreach", sourceNodeKey: "reference", sourcePortId: "image", targetNodeKey: "foreach", targetPortId: "referenceImage" },
    { edgeKey: "foreach-video-text", sourceNodeKey: "foreach", sourcePortId: "item.text", targetNodeKey: "video", targetPortId: "text" },
    { edgeKey: "foreach-video-image", sourceNodeKey: "foreach", sourcePortId: "item.image", targetNodeKey: "video", targetPortId: "referenceImages" },
    { edgeKey: "video-collect", sourceNodeKey: "video", sourcePortId: "video", targetNodeKey: "collect", targetPortId: "items.video" },
  ] };
  const seen: Array<Record<string, unknown>> = [];
  const result = await executeWorkflow(textDefinition, { runId: "text-foreach-run", ports: { capability: { execute: async ({ executorId, inputs }) => {
    if (executorId === "text_input") return { text: "ignored" };
    if (executorId === "image_generate") return { image: "creator-reference" };
    if (executorId === "foreach") return { texts: ["hook", "demo", "cta"] };
    if (executorId === "video_generate") { seen.push(inputs); return { video: `video-${String(inputs.text)}` }; }
    return executorId === "collect" ? { videos: inputs["items.video"] } : inputs;
  } } } });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(seen.map((inputs) => inputs.text), ["hook", "demo", "cta"]);
  assert.deepEqual(seen.map((inputs) => inputs.referenceImages), ["creator-reference", "creator-reference", "creator-reference"]);
  assert.deepEqual(result.outputs.collect?.videos, ["video-hook", "video-demo", "video-cta"]);
});

test("workflow retries a failed node through the capability port", async () => {
  let writerAttempts = 0;
  const result = await executeWorkflow(definition, { runId: "retry-run", retryLimit: 1, ports: { capability: { execute: async ({ executorId }) => {
    if (executorId === "text_input") return { text: "hello" };
    writerAttempts += 1;
    if (writerAttempts === 1) throw new Error("temporary_provider_failure");
    return { text: "done" };
  } } } });
  assert.equal(result.status, "succeeded");
  assert.equal(writerAttempts, 2);
  assert.equal(result.outputs.writer?.text, "done");
});

test("workflow resumes completed outputs without re-executing those nodes", async () => {
  const calls: string[] = [];
  const result = await executeWorkflow(definition, { runId: "resume-run", completed: { input: { text: "persisted" } }, ports: { capability: { execute: async ({ executorId, inputs }) => {
    calls.push(executorId);
    return { text: `writer:${String(inputs.text)}` };
  } } } });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, ["writer"]);
  assert.equal(result.outputs.writer?.text, "writer:persisted");
});

test("workflow rejects recovery when the definition hash changed", async () => {
  const result = await executeWorkflow(definition, {
    runId: "incompatible-recovery",
    recoveryDefinitionHash: "not-the-current-definition",
    completed: { input: { text: "persisted" } },
    ports: { capability: { execute: async () => { throw new Error("must-not-run"); } } },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "workflow_recovery_incompatible_definition");
});

test("workflow cancellation signals parallel capabilities and prevents dependent nodes", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  let receivedAbort = 0;
  const cancellationDefinition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [
    { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Text", positionX: 0, positionY: 0, config: {} },
    { nodeKey: "writer-a", type: "writer", nodeVersion: 1, title: "Writer A", positionX: 1, positionY: 0, config: {} },
    { nodeKey: "writer-b", type: "writer", nodeVersion: 1, title: "Writer B", positionX: 1, positionY: 1, config: {} },
    { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 2, positionY: 0, config: {} },
  ], edges: [
    { edgeKey: "a", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-a", targetPortId: "text" },
    { edgeKey: "b", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer-b", targetPortId: "text" },
    { edgeKey: "output", sourceNodeKey: "writer-a", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
  ] };
  const result = await executeWorkflow(cancellationDefinition, { runId: "cancel-parallel", signal: controller.signal, ports: { capability: { execute: async ({ executorId, nodeKey }, signal) => {
    started.push(nodeKey);
    if (executorId === "text_input") return { text: "hello" };
    if (executorId === "output") return { text: "must-not-run" };
    return await new Promise<Record<string, unknown>>((_, reject) => {
      signal.addEventListener("abort", () => { receivedAbort += 1; const error = new Error("workflow_cancelled"); error.name = "AbortError"; reject(error); }, { once: true });
      if (started.filter((value) => value.startsWith("writer-")).length === 2) controller.abort();
    });
  } } } });
  assert.equal(result.status, "cancelled");
  assert.equal(receivedAbort, 2);
  assert.equal(started.includes("output"), false);
});

test("workflow resumes an asynchronous node through the host port without resubmitting", async () => {
  let executeCalls = 0;
  let resumedTaskId = "";
  const result = await executeWorkflow(definition, { runId: "recover-run", recovering: { writer: { providerTaskId: "provider-task-42" } }, ports: { capability: {
    execute: async ({ executorId }) => {
      executeCalls += 1;
      if (executorId === "text_input") return { text: "hello" };
      throw new Error("must_not_resubmit_provider_task");
    },
    resume: async ({ providerTaskId, executorId, inputs }) => {
      resumedTaskId = `${executorId}:${providerTaskId}:${String(inputs.text)}`;
      return { text: "recovered" };
    },
  } } });
  assert.equal(result.status, "succeeded");
  assert.equal(executeCalls, 1);
  assert.equal(resumedTaskId, "writer:provider-task-42:hello");
  assert.equal(result.outputs.writer?.text, "recovered");
});

test("workflow rejects an unavailable recovery port instead of submitting the provider task again", async () => {
  const calls: string[] = [];
  const result = await executeWorkflow(definition, { runId: "recover-unsupported", recovering: { writer: { providerTaskId: "provider-task-43" } }, ports: { capability: { execute: async ({ executorId }) => {
    calls.push(executorId);
    return { text: "hello" };
  } } } });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "workflow_recovery_unsupported");
  assert.deepEqual(calls, ["text_input"]);
});
