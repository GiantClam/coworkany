import assert from "node:assert/strict";
import test from "node:test";
import { buildUsageDashboardView } from "../src/usage-dashboard-model";

test("keeps unknown usage unknown while rendering empty date buckets as zero", () => {
  const emptyCount = { total: 0, completed: 0, failed: 0, rejected: 0, running: 0, byName: [] };
  const result = { overview: { tokens: 10, modelTools: 0, capabilities: 0 }, series: [{ date: "2026-09-28", inputTokens: 0, outputTokens: 0, modelTools: 0, capabilities: 0 }, { date: "2026-09-29", inputTokens: 10, outputTokens: 0, modelTools: 0, capabilities: 0 }], models: [], tools: [], capabilities: [], runs: [{ runId: "run-1", title: "会话", source: "conversation" as const, model: "model-a", status: "completed", startedAt: "2026-09-29T00:00:00Z", metrics: { runId: "run-1", model: "model-a", modelTools: emptyCount, capabilities: emptyCount, tokens: { input: 10 }, completeness: "partial" as const } }] };
  const view = buildUsageDashboardView(result, "zh");
  assert.equal(view.series[0]?.inputTokens, 0);
  assert.equal(view.rows[0]?.reasoningTokensLabel, "未提供");
});
