import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatModelReasoningSummary,
  WorkbenchModelReasoningSelector,
} from "../src/model-reasoning-selector";

const models = [
  { id: "gpt", label: "GPT 5.6", provider: "OpenAI" },
  { id: "claude", label: "Claude Sonnet", provider: "Anthropic" },
];
const reasoning = [
  { id: "auto", label: "自动", shortLabel: "自" },
  { id: "high", label: "高", shortLabel: "高" },
];

test("formats one compact model and reasoning summary", () => {
  assert.equal(formatModelReasoningSummary(models[0], reasoning[1], "zh"), "GPT 5.6 · 高");
  assert.equal(formatModelReasoningSummary(undefined, reasoning[0], "zh"), "选择模型 · 自动");
});

test("renders one trigger for both model and reasoning", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchModelReasoningSelector
      models={models}
      modelId="gpt"
      reasoningOptions={reasoning}
      reasoningId="auto"
      onModelChange={() => undefined}
      onReasoningChange={() => undefined}
      locale="zh"
    />,
  );
  assert.match(markup, /aria-label="模型与推理：GPT 5\.6 · 自动"/);
  assert.equal((markup.match(/data-slot="model-reasoning-trigger"/g) ?? []).length, 1);
});
