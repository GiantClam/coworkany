import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchRunMetrics } from "../src/run-metrics";

test("renders a compact localized run summary with expandable details", () => {
  const count = (total: number) => ({ total, completed: total, failed: 0, rejected: 0, running: 0, byName: [] });
  const metrics = { runId: "run-1", model: "gpt-5.6-sol", modelTools: count(4), capabilities: count(1), tokens: { input: 9600, output: 3200 }, completeness: "complete" as const };
  const markup = renderToStaticMarkup(<WorkbenchRunMetrics metrics={metrics} locale="zh" />);
  assert.match(markup, /gpt-5\.6-sol/);
  assert.match(markup, /工具 4/);
  assert.match(markup, /能力执行 1/);
  assert.match(markup, /12\.8K Token/);
  assert.match(markup, /输入/);
});
test("distinguishes zero from unavailable provider usage", () => {
  const empty = { total: 0, completed: 0, failed: 0, rejected: 0, running: 0, byName: [] };
  const markup = renderToStaticMarkup(<WorkbenchRunMetrics metrics={{ runId: "r", modelTools: empty, capabilities: empty, tokens: { input: 0 }, completeness: "partial" }} locale="zh" />);
  assert.match(markup, />0</);
  assert.match(markup, /未提供/);
});
