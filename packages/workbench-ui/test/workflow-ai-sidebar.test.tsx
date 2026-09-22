import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDesktopUIMessage, type DesktopUIMessage, type WorkflowAiContext } from "@coworkany/workbench-client";
import { WorkflowAiSidebar, type WorkflowAiSidebarProps } from "../src/workflow-ai-sidebar";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

const context: WorkflowAiContext = {
  workflowId: "workflow-1",
  revision: 4,
  definition: { schemaVersion: 2, revision: 4, definitionHash: "a".repeat(64), nodes: [], edges: [] },
  selectedNodeKeys: [],
  validationIssues: [],
  configuredProviders: [],
};

const assistant: DesktopUIMessage = {
  ...createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1" }),
  parts: [
    { type: "text", text: "I can apply this change.", state: "done" },
    { type: "dynamic-tool", toolName: "update_node", toolCallId: "tool-1", state: "approval-requested", input: { nodeKey: "writer" }, approval: { id: "approval-1" } },
  ],
};

function props(overrides: Partial<WorkflowAiSidebarProps> = {}): WorkflowAiSidebarProps {
  return {
    open: true,
    width: 390,
    messages: [createDesktopUIMessage({ id: "user-1", role: "user", conversationId: "conversation-1", content: "Rename the writer" }), assistant],
    providerOptions: [
      { id: "openai:gpt-5", label: "GPT-5", provider: "OpenAI" },
      { id: "gemini:pro", label: "Gemini Pro", provider: "Google" },
    ],
    context,
    locale: "en",
    status: "ready",
    input: "",
    onOpenChange: () => undefined,
    onWidthChange: () => undefined,
    onInputChange: () => undefined,
    onSubmit: () => undefined,
    onStop: () => undefined,
    onRetry: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
    ...overrides,
  };
}

test("does not reserve sidebar markup while hidden", () => {
  assert.equal(renderToStaticMarkup(<WorkflowAiSidebar {...props({ open: false })} />), "");
});

test("renders as a resizable sibling aside instead of a canvas overlay", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props()} />);
  assert.match(markup, /<aside[^>]+data-workflow-ai-sidebar="true"/);
  assert.match(markup, /data-layout="sibling"/);
  assert.match(markup, /data-overlay="false"/);
  assert.match(markup, /role="separator"/);
  assert.match(markup, /aria-valuemin="320"/);
  assert.match(markup, /aria-valuenow="390"/);
  assert.doesNotMatch(markup, /react-flow__panel|data-slot="panel"/);
  assert.match(styles, /\.workflow-ai-sidebar\s*\{[\s\S]*?flex:\s*0 0 var\(--workflow-ai-sidebar-width/);
  assert.doesNotMatch(styles, /\.workflow-ai-sidebar\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /max-width:\s*88vw/);
});

test("composes AI Elements messages, tools, confirmation and prompt input", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props()} />);
  assert.match(markup, /data-uimessage-surface="true"/);
  assert.match(markup, /data-slot="message"/);
  assert.match(markup, /I can apply this change/);
  assert.match(markup, /data-slot="tool"/);
  assert.match(markup, /data-tool-name="update_node"/);
  assert.match(markup, /data-slot="confirmation"/);
  assert.match(markup, /Approval required: approval-1/);
  assert.match(markup, /data-slot="prompt-input"/);
  assert.match(markup, /aria-label="Message input"/);
  assert.match(markup, /aria-label="Send"/);
});

test("keeps workflow history out of the assistant and shows provider candidates", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props()} />);
  assert.doesNotMatch(markup, /AI operation history/);
  assert.doesNotMatch(markup, /Conversation operations/);
  assert.doesNotMatch(markup, /data-operation-group-id/);
  assert.doesNotMatch(markup, /aria-label="Focus operation nodes"/);
  assert.doesNotMatch(markup, /aria-label="Undo operation group"/);
  assert.doesNotMatch(markup, /aria-label="Redo operation group"/);
  assert.match(markup, /data-slot="model-selector"/);
  assert.match(markup, /data-provider-count="2"/);
  assert.match(markup, /aria-label="View available providers and models"/);
});

test("renders quick-start suggestions for a blank conversation", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ messages: [], locale: "zh" })} />);
  assert.match(markup, /data-slot="conversation-empty-state"/);
  assert.match(markup, /data-slot="suggestions"/);
  assert.match(markup, /创建一个内容发布工作流/);
  assert.match(markup, /检查并修复当前工作流/);
  assert.match(markup, /aria-label="隐藏 AI 侧栏"/);
});
