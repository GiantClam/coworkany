import test from "node:test";
import assert from "node:assert/strict";
import { applyRunMetricsEvent, createRunMetricsAccumulator, toRunMetrics } from "../src/run-metrics";

test("deduplicates tool lifecycle events and keeps real capability retries", () => {
  let state = createRunMetricsAccumulator("run-1");
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "tool-1", category: "model_tool", name: "read", phase: "started", attempt: 1, createdAt: "2026-09-29T00:00:00Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "tool-1", category: "model_tool", name: "read", phase: "completed", attempt: 1, createdAt: "2026-09-29T00:00:01Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "tool-1", category: "model_tool", name: "read", phase: "started", attempt: 1, createdAt: "2026-09-29T00:00:02Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "image", category: "capability", name: "image_generate", phase: "failed", attempt: 1, createdAt: "2026-09-29T00:00:03Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "image", category: "capability", name: "image_generate", phase: "completed", attempt: 2, createdAt: "2026-09-29T00:00:04Z" });

  const metrics = toRunMetrics(state);
  assert.equal(metrics.modelTools.total, 1);
  assert.equal(metrics.modelTools.completed, 1);
  assert.equal(metrics.modelTools.running, 0);
  assert.equal(metrics.capabilities.total, 2);
  assert.equal(metrics.capabilities.failed, 1);
  assert.equal(metrics.capabilities.completed, 1);
});
test("adds step deltas but uses the latest run snapshot without double counting", () => {
  let state = createRunMetricsAccumulator("run-1");
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "step-1", provider: "provider-a", model: "model-a", inputTokens: 10, outputTokens: 4, cachedInputTokens: 2, providerCost: 0.01, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:00Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "step-2", provider: "provider-a", model: "model-a", inputTokens: 8, outputTokens: 3, reasoningTokens: 1, providerCost: 0.02, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:01Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "step-2", provider: "provider-a", model: "model-a", inputTokens: 8, outputTokens: 3, reasoningTokens: 1, providerCost: 0.02, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:01Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "run-final-1", provider: "provider-a", model: "model-a", inputTokens: 18, outputTokens: 7, cachedInputTokens: 2, reasoningTokens: 1, providerCost: 0.03, aggregation: "snapshot", scope: "run", createdAt: "2026-09-29T00:00:02Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "run-final-2", provider: "provider-a", model: "model-a", inputTokens: 20, outputTokens: 8, cachedInputTokens: 3, reasoningTokens: 2, providerCost: 0.04, aggregation: "snapshot", scope: "run", createdAt: "2026-09-29T00:00:03Z" });

  const metrics = toRunMetrics(state);
  assert.deepEqual(metrics.tokens, { input: 20, output: 8, cachedInput: 3, reasoning: 2 });
  assert.equal(metrics.providerCost, 0.04);
  assert.equal(metrics.provider, "provider-a");
  assert.equal(metrics.model, "model-a");
  assert.equal(metrics.completeness, "complete");
});

test("keeps missing usage unknown and rejects invalid numeric values", () => {
  let state = createRunMetricsAccumulator("run-1");
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "invalid", model: "model-a", inputTokens: -2, outputTokens: Number.NaN, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:00Z" });
  const metrics = toRunMetrics(state);
  assert.deepEqual(metrics.tokens, {});
  assert.equal(metrics.completeness, "partial");
});
