import assert from "node:assert/strict";
import test from "node:test";
import { classifyRunRole } from "../src/virtual-office/classify-run-role";

const run = { id: "r1", conversationId: "c1", status: "running" as const, startedAt: "2026-01-01T00:00:00Z" };
test("run classification uses stable priority and keeps ordinary conversations as ai-chat", () => {
  assert.equal(classifyRunRole({ run, metadata: { kind: "workflow", featureId: "video_generate" }, conversation: { id: "c1", title: "", updatedAt: "", messageCount: 0 } }), "workflow-operator");
  assert.equal(classifyRunRole({ run, metadata: { kind: "media", featureId: "video_generate" }, conversation: undefined }), "video-producer");
  assert.equal(classifyRunRole({ run, metadata: { kind: "media", featureId: "image_generate" }, conversation: undefined }), "image-creator");
  assert.equal(classifyRunRole({ run, metadata: { kind: "agent", featureId: "ppt_generate" }, conversation: { id: "c1", title: "", updatedAt: "", messageCount: 0, agentId: "executive-ppt" } }), "ppt-expert");
  assert.equal(classifyRunRole({ run, metadata: { kind: "agent" }, conversation: { id: "c1", title: "", updatedAt: "", messageCount: 0, agentId: "custom-agent" } }), "agent-center");
  assert.equal(classifyRunRole({ run, metadata: { kind: "agent" }, conversation: { id: "c1", title: "", updatedAt: "", messageCount: 0 } }), "ai-chat");
});
