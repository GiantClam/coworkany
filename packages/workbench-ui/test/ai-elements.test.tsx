import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchAttachments, WorkbenchMessage, WorkbenchModelSelector, WorkbenchPlan, WorkbenchPromptInput, WorkbenchReasoning, WorkbenchTask, WorkbenchTool } from "../src/index";

test("prompt input exposes accessible text, attachments, model and submit controls", () => {
  const markup = renderToStaticMarkup(<WorkbenchPromptInput value="hello" onValueChange={() => undefined} onSubmit={() => undefined} onAddAttachments={() => undefined} attachments={[{ id: "file-1", name: "brief.pdf", mediaType: "application/pdf" }]} models={[{ id: "model-1", label: "Model 1", provider: "Provider" }]} model="model-1" onModelChange={() => undefined} locale="en" />);
  assert.match(markup, /aria-label="Message input"/);
  assert.match(markup, /brief\.pdf/);
  assert.match(markup, /Model 1/);
  assert.match(markup, /type="submit"/);
  assert.match(markup, /data-slot="prompt-input-header"/);
  assert.match(markup, /data-slot="prompt-input-body"/);
  assert.match(markup, /data-slot="prompt-input-footer"/);
  assert.match(markup, /data-slot="prompt-input-tools"/);
  assert.match(markup, /wb-ai-prompt-model-select/);
  assert.match(markup, /data-dropzone="prompt-input"/);
  assert.match(markup, /aria-haspopup="menu"/);
});

test("prompt input keeps contextual hints in the header and actions in the footer tools", () => {
  const markup = renderToStaticMarkup(<WorkbenchPromptInput value="" onValueChange={() => undefined} onSubmit={() => undefined} locale="zh"><div className="composer-selected-agent">当前 Agent</div><button type="button" className="composer-knowledge-button">知识库</button></WorkbenchPromptInput>);
  const headerIndex = markup.indexOf('data-slot="prompt-input-header"');
  const bodyIndex = markup.indexOf('data-slot="prompt-input-body"');
  const footerIndex = markup.indexOf('data-slot="prompt-input-footer"');
  const agentIndex = markup.indexOf("当前 Agent");
  const knowledgeIndex = markup.indexOf("知识库");
  assert.ok(headerIndex < agentIndex && agentIndex < bodyIndex);
  assert.ok(bodyIndex < footerIndex && footerIndex < knowledgeIndex);
  assert.match(markup, /data-slot="prompt-input-custom-tools"/);
});

test("model selector groups models and renders an accessible listbox trigger", () => {
  const markup = renderToStaticMarkup(<WorkbenchModelSelector models={[{ id: "openai:gpt", label: "GPT", provider: "OpenAI" }, { id: "local:qwen", label: "Qwen", provider: "Local" }]} value="openai:gpt" onChange={() => undefined} locale="en" />);
  assert.match(markup, /aria-haspopup="listbox"/);
  assert.match(markup, /GPT/);
  assert.match(markup, /ai-elements-model-selector-logo/);
});

test("model selector uses a stable neutral badge for localized provider labels", () => {
  const markup = renderToStaticMarkup(<WorkbenchModelSelector models={[{ id: "deepseek:chat", label: "deepseek-chat", provider: "已配置模型" }]} value="deepseek:chat" onChange={() => undefined} locale="zh" />);
  assert.match(markup, /ai-elements-model-selector-logo[^>]*>AI<\/span>/);
  assert.doesNotMatch(markup, />已配<\/span>/);
});

test("model selector keeps its menu anchored and opaque", () => {
  const source = readFileSync(resolve(process.cwd(), "src/prompt-input.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /data-model-menu/);
  assert.match(styleSource, /\.wb-ai-model-popover \{[\s\S]*?position: fixed;[\s\S]*?background: #fff;/);
});

test("process primitives preserve plan, task, tool and reasoning semantics", () => {
  const markup = renderToStaticMarkup(<div><WorkbenchMessage role="assistant" label="AI response" timestamp="12:00"><WorkbenchReasoning text="thinking" status="running" locale="en" /><WorkbenchPlan title="Plan" steps={[{ id: "step-1", title: "Research", status: "completed" }]} status="completed" locale="en" /><WorkbenchTask title="Task" status="waiting" locale="en" /><WorkbenchTool toolName="search" toolCallId="tool-1" input={{ query: "ai" }} status="failed" locale="en" /></WorkbenchMessage></div>);
  assert.match(markup, /Reasoning/);
  assert.match(markup, /Plan/);
  assert.match(markup, /Task/);
  assert.match(markup, /search/);
  assert.match(markup, /tool-1/);
});

test("attachments support list metadata and accessible removal", () => {
  const markup = renderToStaticMarkup(<WorkbenchAttachments attachments={[{ id: "a", name: "image.png", mediaType: "image/png" }]} variant="list" onRemove={() => undefined} locale="zh" />);
  assert.match(markup, /image\/png/);
  assert.match(markup, /移除附件/);
});
