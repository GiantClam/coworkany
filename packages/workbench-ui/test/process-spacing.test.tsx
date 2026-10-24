import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDesktopUIMessage, type DesktopUIMessage } from "@coworkany/workbench-client";
import { WorkbenchMessageSurface } from "../src/workbench-message-surface";

test("assistant spacing follows visible primary/process boundaries without changing Parts", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "spacing", role: "assistant", conversationId: "spacing" }),
    parts: [
      { type: "text", text: "Before", state: "done" },
      { type: "data-status", data: { status: "completed" } },
      { type: "reasoning", text: "Inspect", state: "done" },
      { type: "text", text: "After", state: "done" },
    ],
  };
  const before = JSON.stringify(message);
  const html = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} />);
  assert.deepEqual([...html.matchAll(/data-output-kind="([^"]+)"/g)].map((match) => match[1]), ["primary", "process", "primary"]);
  assert.equal(JSON.stringify(message), before);
  assert.ok(html.indexOf("Before") < html.indexOf('data-slot="tool-activity-group"'));
  assert.ok(html.indexOf('data-slot="tool-activity-group"') < html.indexOf("After"));
});

test("non-rendered bookkeeping and blank text do not create spacing placeholders", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "empty-spacing", role: "assistant", conversationId: "spacing" }),
    parts: [
      { type: "text", text: "   ", state: "done" },
      { type: "reasoning", text: "   ", state: "done" },
      { type: "data-status", data: { status: "completed" } },
      { type: "text", text: "Visible", state: "done" },
    ],
  };
  const html = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} />);
  assert.equal((html.match(/data-output-kind=/g) ?? []).length, 1);
  assert.equal((html.match(/class="[^"]*\bai-elements-message-response\b/g) ?? []).length, 1);
});

test("Workflow AI business summaries remain primary boundaries rather than process traces", () => {
  const base = createDesktopUIMessage({ id: "workflow-spacing", role: "assistant", conversationId: "spacing" });
  const message: DesktopUIMessage = { ...base, parts: [
    { type: "reasoning", text: "Inspect", state: "done" },
    { type: "dynamic-tool", toolName: "read_file", toolCallId: "business", state: "output-available", input: {}, output: { summary: "Business result" } },
    { type: "reasoning", text: "Continue", state: "done" },
  ] };
  const html = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} workflowAi />);
  assert.deepEqual([...html.matchAll(/data-output-kind="([^"]+)"/g)].map((match) => match[1]), ["process", "primary", "process"]);
  assert.match(html, /data-workflow-ai-tool-summary="true"/);
  const running: DesktopUIMessage = { ...message, parts: message.parts.map((part) => part.type === "dynamic-tool" ? { ...part, state: "input-available", output: undefined } : part) };
  const runningHtml = renderToStaticMarkup(<WorkbenchMessageSurface messages={[running]} workflowAi />);
  assert.deepEqual([...runningHtml.matchAll(/data-output-kind="([^"]+)"/g)].map((match) => match[1]), ["process", "process", "process"]);
});
