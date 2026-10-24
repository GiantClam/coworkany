import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchPromptInput } from "../src/prompt-input";

test("desktop prompt input keeps one compact row and combines its menus", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchPromptInput
      value=""
      onValueChange={() => undefined}
      onSubmit={() => undefined}
      onAddAttachments={() => undefined}
      models={[{ id: "gpt", label: "GPT", provider: "OpenAI" }]}
      model="gpt"
      onModelChange={() => undefined}
      reasoningEffort="high"
      onReasoningChange={() => undefined}
      knowledgeBases={[{ id: "vault", label: "产品知识库", description: "Obsidian Vault" }]}
      knowledgeEnabled
      onKnowledgeToggle={() => undefined}
      locale="zh"
    />,
  );
  const source = readFileSync(resolve(process.cwd(), "src/prompt-input.tsx"), "utf8");
  const aiElementsSource = readFileSync(resolve(process.cwd(), "src/ai-elements/source.tsx"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  assert.match(source, /<PromptInputTextarea[^>]*minRows=\{1\}[^>]*maxRows=\{3\}[^>]*submitMode="enter"/);
  assert.equal((markup.match(/data-slot="model-reasoning-trigger"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-haspopup="menu"/g) ?? []).length, 1);
  assert.match(markup, /aria-label="添加内容"/);
  assert.doesNotMatch(markup, /wb-ai-prompt-model-select/);
  assert.match(source, /PromptInputActionAddAttachments/);
  assert.match(source, /PromptInputActionAddAttachments[\s\S]*description=/);
  assert.match(source, /<PromptInputActionMenuSub>/);
  assert.match(source, /<PromptInputActionMenuSubTrigger/);
  assert.match(source, /<PromptInputActionMenuSubContent/);
  assert.match(source, /<PromptInputActionMenuRadioGroup/);
  assert.match(source, /knowledgeBases\.map/);
  assert.match(source, /<PromptInputActionMenuRadioItem/);
  assert.match(source, /<PromptInputActionMenuContent side="top"/);
  assert.doesNotMatch(source, /移除知识库/);
  assert.match(source, /onKnowledgeToggle/);
  assert.match(aiElementsSource, /DropdownMenu\.SubTrigger/);
  assert.match(aiElementsSource, /DropdownMenu\.SubContent/);
  assert.match(aiElementsSource, /DropdownMenu\.RadioItem/);
  assert.match(aiElementsSource, /DropdownMenu\.ItemIndicator/);
  assert.match(styles, /\.ai-elements-prompt-input-action-menu-item-copy/);
  assert.match(styles, /\.ai-elements-prompt-input-action-menu-item\[data-highlighted\]/);
  assert.match(styles, /\.ai-elements-prompt-input-action-menu-sub-content/);
});
