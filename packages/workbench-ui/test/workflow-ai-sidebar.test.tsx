import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDesktopUIMessage, type DesktopUIMessage, type WorkflowAiContext } from "@coworkany/workbench-client";
import { WorkflowAiSidebar, type WorkflowAiSidebarProps } from "../src/workflow-ai-sidebar";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../src/workflow-canvas.tsx", import.meta.url), "utf8");

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
    selectedProviderOptionId: "openai:gpt-5",
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
  assert.match(markup, /aria-label="Select workflow AI text model"/);
  assert.match(markup, /aria-haspopup="listbox"/);
  assert.match(markup, /GPT-5/);
  assert.doesNotMatch(markup, /ai-elements-model-selector-overlay/);
});

test("workflow AI model selector keeps the automatic-selection label when no model is pinned", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ selectedProviderOptionId: undefined })} />);
  assert.match(markup, /Auto · 2/);
});

test("renders quick-start suggestions for a blank conversation", () => {
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ messages: [], locale: "zh" })} />);
  assert.match(markup, /data-slot="conversation-empty-state"/);
  assert.match(markup, /data-slot="suggestions"/);
  assert.match(markup, /创建一个内容发布工作流/);
  assert.match(markup, /检查并修复当前工作流/);
  assert.match(markup, /aria-label="隐藏 AI 侧栏"/);
});

test("hiding and reopening the sidebar preserves the current conversation contract", () => {
  const visibleMarkup = renderToStaticMarkup(<WorkflowAiSidebar {...props()} />);
  const hiddenMarkup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ open: false })} />);

  assert.match(visibleMarkup, /data-message-id="user-1"/);
  assert.match(visibleMarkup, /data-message-id="assistant-1"/);
  assert.match(visibleMarkup, /Rename the writer/);
  assert.equal(hiddenMarkup, "");

  // The controlled open state belongs to the host. When it is restored with
  // the same messages, the sidebar renders the same conversation again.
  const reopenedMarkup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ open: true })} />);
  assert.match(reopenedMarkup, /data-message-id="user-1"/);
  assert.match(reopenedMarkup, /I can apply this change/);
  assert.match(reopenedMarkup, /data-workflow-id="workflow-1"/);
});

test("renders request, plan/approval and operation result without local history controls", () => {
  const planAndResult: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-result", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "text", text: "已完成工作流更新。", state: "done" },
      { type: "data-task", id: "plan-1", data: { taskId: "plan-1", title: "Apply workflow plan", status: "completed", steps: [{ id: "step-1", title: "Add article and image nodes", status: "completed" }] } },
      { type: "dynamic-tool", toolName: "run_workflow", toolCallId: "tool-run", state: "approval-requested", input: { workflowId: "workflow-1" }, approval: { id: "approval-run" } },
      { type: "data-workflow", id: "workflow-output", data: { nodeId: "output", title: "Article with images", status: "completed", output: { text: "Article ready" } } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ messages: [props().messages[0], planAndResult] })} />);

  assert.match(markup, /Rename the writer/);
  assert.match(markup, /Apply workflow plan/);
  assert.match(markup, /Approval required: approval-run/);
  assert.match(markup, /Article with images/);
  assert.match(markup, /Article ready/);
  assert.doesNotMatch(markup, /Undo operation group|Redo operation group|AI operation history|Conversation operations/);
  assert.doesNotMatch(markup, /data-operation-group-id/);
});

test("keeps Workflow AI tool disclosure concise and hides command JSON plus undo/redo details", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-concise", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "text", text: "已按计划更新工作流。", state: "done" },
      { type: "dynamic-tool", toolName: "undo", toolCallId: "tool-undo", state: "output-available", input: { command: "undo", operationGroupId: "history-42" }, output: { summary: "Workflow change applied", operationGroupId: "history-42" } },
      { type: "dynamic-tool", toolName: "update_node", toolCallId: "tool-update", state: "approval-requested", input: { command: "redo", nodeKey: "writer", definition: { nodes: [{ nodeKey: "secret" }] } }, approval: { id: "approval-update" } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props({ messages: [props().messages[0], message] })} />);

  assert.match(markup, /data-workflow-ai-tool-summary="true"/);
  assert.match(markup, /Workflow change applied/);
  assert.match(markup, /Approval requested: update node/);
  assert.match(markup, /Approval required: approval-update/);
  assert.doesNotMatch(markup, /history-42|secret|operationGroupId|command|redo|Undo|Redo/);
  assert.doesNotMatch(markup, /data-slot="tool-input"|data-slot="tool-output"/);
});

test("keeps whole-workflow undo and redo in the canvas contract", () => {
  assert.match(canvasSource, /aria-label=\{locale === "zh" \? "撤销" : "Undo"\}/);
  assert.match(canvasSource, /aria-label=\{locale === "zh" \? "重做" : "Redo"\}/);
  const markup = renderToStaticMarkup(<WorkflowAiSidebar {...props()} />);
  assert.doesNotMatch(markup, /aria-label="Undo"|aria-label="Redo"|aria-label="撤销"|aria-label="重做"/);
});
