import assert from "node:assert/strict";
import test from "node:test";
import { replayPersistedRunToConversationMessage } from "../src/conversation-run-replay";

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
