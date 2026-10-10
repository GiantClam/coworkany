import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchRunDetail } from "@coworkany/workbench-client";
import { readDesktopTaskMetadata } from "../src/desktop-task-metadata";

function makeDetail(events: Array<{ sequence: number; payloadJson: string; eventType?: string }>): WorkbenchRunDetail {
  return {
    run: { id: "run-1", conversationId: "conversation-1", status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
    nodes: [],
    usage: [],
    events: events.map((event) => ({ sequence: event.sequence, eventType: event.eventType ?? "task_metadata", payloadJson: event.payloadJson, createdAt: "2026-01-01T00:00:00Z" })),
  };
}

test("metadata parser chooses the last valid task_metadata event by sequence", () => {
  const result = readDesktopTaskMetadata(makeDetail([
    { sequence: 3, payloadJson: JSON.stringify({ kind: "workflow", workflowId: "older" }) },
    { sequence: 1, payloadJson: JSON.stringify({ kind: "media", featureId: "image_generate" }) },
    { sequence: 2, payloadJson: "{" },
    { sequence: 4, payloadJson: JSON.stringify({ kind: "agent", entryPath: "/dashboard/agent-platform" }) },
  ]));
  assert.deepEqual(result, { kind: "agent", entryPath: "/dashboard/agent-platform" });
});

test("metadata parser returns null for malformed or unsupported payloads", () => {
  assert.equal(readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: "not-json" }])), null);
  assert.equal(readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ kind: "unknown" }) }])), null);
  assert.equal(readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ featureId: "image_generate" }) }])), null);
  assert.equal(readDesktopTaskMetadata(makeDetail([{ sequence: 1, eventType: "done", payloadJson: JSON.stringify({ kind: "media" }) }])), null);
});

test("metadata parser preserves full schema-v2 workflow data and image parameter filtering", () => {
  const workflow = { schemaVersion: 2, revision: 4, definitionHash: "hash", metadata: { description: "desc", status: "live" }, nodes: [{ nodeKey: "input" }], edges: [] };
  const result = readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ kind: "workflow", workflowId: "w1", workflowDefinition: workflow }) }, { sequence: 2, payloadJson: JSON.stringify({ kind: "media", imageGeneration: { prompt: "  draw a cat  ", parameters: { width: 1024, response_format: "url", responseFormat: "base64", ignored: { nested: true } } } }) }]));
  assert.deepEqual(result, { kind: "media", imageGeneration: { prompt: "draw a cat", parameters: { width: 1024 } } });
  const workflowResult = readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ kind: "workflow", workflowDefinition: workflow }) }]));
  assert.deepEqual(workflowResult?.workflowDefinition, workflow);
  assert.deepEqual(readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ kind: "media", imageGeneration: { prompt: "prompt only" } }) }])), { kind: "media", imageGeneration: { prompt: "prompt only", parameters: {} } });
  assert.deepEqual(readDesktopTaskMetadata(makeDetail([{ sequence: 1, payloadJson: JSON.stringify({ kind: "media", imageGeneration: { parameters: { width: 1 } } }) }])), { kind: "media", imageGeneration: { prompt: "", parameters: { width: 1 } } });
});
