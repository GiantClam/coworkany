import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDesktopMetricEvent } from "../src/run-metrics-events";

test("classifies OpenCode tools separately from media capabilities", () => {
  const tool = normalizeDesktopMetricEvent({ event: "tool_event", runId: "r1", tool: "read", toolCallId: "t1", phase: "completed" }, 3);
  assert.equal(tool?.kind, "invocation");
  if (tool?.kind !== "invocation") throw new Error("expected invocation");
  assert.equal(tool.invocationId, "t1");
  assert.equal(tool.category, "model_tool");
  assert.equal(tool.name, "read");
  assert.equal(tool.phase, "completed");
  assert.equal(tool.attempt, 1);
  assert.match(tool.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const media = normalizeDesktopMetricEvent({ event: "tool_event", runId: "r1", tool: "media:image_generate", phase: "started", message: JSON.stringify({ nodeKey: "image", idempotencyKey: "r1:image:2" }) }, 4);
  assert.equal(media?.kind, "invocation");
  if (media?.kind !== "invocation") throw new Error("expected invocation");
  assert.equal(media.category, "capability");
  assert.equal(media.attempt, 2);
});
test("normalizes real provider usage without inventing unknown values", () => {
  const metric = normalizeDesktopMetricEvent({ event: "usage", runId: "r1", usageId: "u1", provider: "openai", model: "gpt", inputTokens: 12, aggregation: "delta", scope: "step" }, 5);
  assert.deepEqual(metric, {
    kind: "usage", runId: "r1", usageId: "u1", provider: "openai", model: "gpt", inputTokens: 12,
    aggregation: "delta", scope: "step", createdAt: metric?.createdAt,
  });
});
