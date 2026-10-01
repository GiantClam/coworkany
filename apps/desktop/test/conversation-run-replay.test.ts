import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { advanceAssistantTurn, beginAssistantTurn, type WorkbenchRunEvent } from "@coworkany/workbench-client";
import { replayPersistedRunToConversationMessage } from "../src/conversation-run-replay";

const interleavedEvents = JSON.parse(readFileSync(new URL("../../../packages/workbench-client/test/fixtures/assistant-turn-interleaved.json", import.meta.url), "utf8")) as WorkbenchRunEvent[];

test("replays a completed PPT run into an assistant message with its artifact part", () => {
  const message = replayPersistedRunToConversationMessage(
    { id: "run-ppt-1", status: "succeeded", started_at: "2026-09-04T01:00:00.000Z", finished_at: "2026-09-04T01:02:00.000Z" },
    [
      { sequence: 1, event_type: "reasoning_delta", payload_json: JSON.stringify({ delta: "先加载 PPT skill" }), created_at: "2026-09-04T01:00:01.000Z" },
      { sequence: 2, event_type: "text_delta", payload_json: JSON.stringify({ delta: "已生成 PPTX。" }), created_at: "2026-09-04T01:01:59.000Z" },
      { sequence: 3, event_type: "artifact", payload_json: JSON.stringify({ artifact: { id: "run-ppt-1:deck.pptx", relativePath: "deck.pptx", title: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", byteLength: 128, sha256: "" } }), created_at: "2026-09-04T01:02:00.000Z" },
      { sequence: 4, event_type: "preview", payload_json: JSON.stringify({ preview: { kind: "ppt", title: "Deck preview", url: "http://127.0.0.1:5200/", previewSessionId: "dashi-ppt:run-ppt-1", engine: "dashi-ppt", interactive: true, status: "ready" } }), created_at: "2026-09-04T01:02:00.000Z" },
    ],
    "conversation-ppt-1",
  );

  assert.ok(message);
  assert.equal(message.createdAt, "2026-09-04T01:02:00.000Z");
  assert.equal(message.content, "已生成 PPTX。");
  assert.equal(message.parts.some((part) => part.type === "reasoning" && part.state === "done"), true);
  assert.equal(message.parts.some((part) => part.type === "data-artifact" && part.data.mimeType.includes("presentation")), true);
  assert.equal(message.parts.some((part) => part.type === "data-preview" && part.data.previewSessionId === "dashi-ppt:run-ppt-1"), true);
  assert.equal(message.parts.some((part) => part.type === "data-status" && part.data.status === "completed"), true);
});

test("replays every text delta after reasoning without dropping the first visible token", () => {
  const message = replayPersistedRunToConversationMessage(
    { id: "run-stream-boundary", status: "succeeded", started_at: "2026-09-06T12:20:39.000Z", finished_at: "2026-09-06T12:20:43.000Z" },
    [
      { sequence: 1, event_type: "reasoning_delta", payload_json: JSON.stringify({ delta: "Decide how to answer." }), created_at: "2026-09-06T12:20:40.000Z" },
      { sequence: 2, event_type: "text_delta", payload_json: JSON.stringify({ delta: "你好" }), created_at: "2026-09-06T12:20:41.000Z" },
      { sequence: 3, event_type: "text_delta", payload_json: JSON.stringify({ delta: "。需要继续做 PPT 吗？" }), created_at: "2026-09-06T12:20:42.000Z" },
    ],
    "conversation-stream-boundary",
  );

  assert.equal(message?.content, "你好。需要继续做 PPT 吗？");
});

test("persisted replay produces the same ordered parts as the live assistant projection", () => {
  const live = interleavedEvents.reduce(advanceAssistantTurn, beginAssistantTurn({
    kind: "new",
    id: "assistant-run-fixture",
    conversationId: "conversation-fixture",
    runId: "run-fixture",
    createdAt: "2026-09-29T00:00:00.000Z",
  }));
  const persisted = replayPersistedRunToConversationMessage(
    { id: "run-fixture", status: "succeeded", started_at: "2026-09-29T00:00:00.000Z", finished_at: "2026-09-29T00:00:07.000Z" },
    [
      { sequence: 1, event_type: "reasoning_delta", payload_json: JSON.stringify({ delta: "inspect the request" }), created_at: "2026-09-29T00:00:01.000Z" },
      { sequence: 2, event_type: "text_delta", payload_json: JSON.stringify({ delta: "I will check the current implementation." }), created_at: "2026-09-29T00:00:02.000Z" },
      { sequence: 3, event_type: "tool_event", payload_json: JSON.stringify({ tool: "search", toolCallId: "tool-search-1", phase: "started", message: JSON.stringify({ args: { query: "assistant stream order" } }) }), created_at: "2026-09-29T00:00:03.000Z" },
      { sequence: 4, event_type: "tool_event", payload_json: JSON.stringify({ tool: "search", toolCallId: "tool-search-1", phase: "completed", message: JSON.stringify({ result: { matches: 1 } }) }), created_at: "2026-09-29T00:00:04.000Z" },
      { sequence: 5, event_type: "text_delta", payload_json: JSON.stringify({ delta: "The tool result confirms the ordering bug." }), created_at: "2026-09-29T00:00:05.000Z" },
      { sequence: 6, event_type: "artifact", payload_json: JSON.stringify({ artifact: { id: "artifact-order-report", relativePath: "artifacts/order-report.md", title: "order-report.md", mimeType: "text/markdown", byteLength: 42, sha256: "fixture-sha256" } }), created_at: "2026-09-29T00:00:06.000Z" },
    ],
    "conversation-fixture",
  );

  assert.ok(persisted);
  assert.deepEqual(persisted.parts, live.parts);
});
