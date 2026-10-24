import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

test("uses a compact reasoning slider and drills into the searchable model list", () => {
  const source = readFileSync(resolve(process.cwd(), "src/model-reasoning-selector.tsx"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  assert.match(source, /<ModelSelectorTrigger\s+asChild>/);
  assert.match(source, /<PromptInputButton[\s\S]*data-slot="model-reasoning-trigger"/);
  assert.match(source, /useState<"settings" \| "models">\("settings"\)/);
  assert.match(source, /<ModelSelectorList className="wb-ai-model-reasoning-settings">/);
  assert.match(source, /<ModelSelectorGroup heading=\{locale === "zh" \? "模型" : "Model"\}>/);
  assert.match(source, /<ModelSelectorItem value="open-model-list"/);
  assert.match(source, /onSelect=\{\(\) => setView\("models"\)\}/);
  assert.match(source, /<ModelSelectorSeparator \/>/);
  assert.match(source, /<ModelSelectorShortcut>/);
  assert.match(source, /type="range"/);
  assert.match(source, /className="wb-ai-model-reasoning-slider"/);
  assert.match(source, /<ModelSelectorInput/);
  assert.match(source, /<ModelSelectorList>/);
  assert.match(source, /<ModelSelectorGroup key=\{provider\} heading=\{provider\}>/);
  assert.match(source, /<ModelSelectorItem value="back-to-settings" forceMount/);
  assert.match(source, /onModelChange\(item\.id\); setView\("settings"\);/);
  assert.doesNotMatch(source, /<button[^>]+wb-ai-model-reasoning-(?:model-row|back)/);
  assert.match(source, /view === "models"/);
  assert.doesNotMatch(source, /reasoningOptions\.map\(\(item\) => \(\s*<ModelSelectorItem/);
  assert.match(source, /triggerRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(source, /new ResizeObserver\(updateMenuPosition\)/);
  assert.match(source, /<ModelSelectorContent[\s\S]*?ref=\{contentRef\}[\s\S]*?style=\{menuStyle\}/);
  assert.match(styles, /\.ai-elements-model-selector-content \{[\s\S]*?position: fixed;[\s\S]*?background: var\(--ai-elements-surface, #fff\)/);
  assert.doesNotMatch(styles, /\.ai-elements-model-selector-content \{[^}]*top: 50%;/);
  assert.match(styles, /\.ai-elements-model-selector-content \.ai-elements-model-selector-input:focus-visible \{[^}]*outline: 0 !important;/);
});
