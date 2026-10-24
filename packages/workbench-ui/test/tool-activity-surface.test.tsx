import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDesktopUIMessage, type DesktopUIMessagePart } from "@coworkany/workbench-client";
import { WorkbenchMessageSurface } from "../src/workbench-message-surface";
import { ToolOutput } from "../src/ai-elements";

const tool = (index: number, state: "input-available" | "output-available" | "output-error" | "output-denied" = "output-available"): DesktopUIMessagePart => ({
  type: "dynamic-tool", toolCallId: `call-${index}`, toolName: "read", state,
  input: { path: `private-parameter-${index}.txt` }, output: state === "output-available" ? `private-result-${index}` : undefined,
  errorText: state === "output-error" ? "File not found" : undefined,
});

function render(parts: DesktopUIMessagePart[], running = false, workflowAi = false) {
  const base = createDesktopUIMessage({ id: "compact-turn", role: "assistant", conversationId: "compact-chat", runId: "compact-run" });
  const message = { ...base, parts, metadata: { ...base.metadata, runStatus: running ? "running" as const : "completed" as const } };
  return renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} pendingMessageId={running ? message.id : undefined} locale="en" workflowAi={workflowAi} />);
}

for (const count of [1, 10, 50]) {
  test(`${count} consecutive calls default to one closed summary without raw details`, () => {
    const markup = render(Array.from({ length: count }, (_, index) => tool(index)));
    assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 1);
    assert.match(markup, /data-slot="tool-activity-trigger"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.doesNotMatch(markup, /private-parameter|private-result|data-slot="tool-header"/);
    assert.match(markup, new RegExp(`${count} tool operation`));
  });
}

test("visible text and useful results remain between separate tool groups", () => {
  const markup = render([tool(1), { type: "text", text: "Interleaved answer", state: "done" }, tool(2), { type: "data-report", id: "report", data: { title: "Useful report", body: "Report result" } }, tool(3)]);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 3);
  const positions = ["call-1", "Interleaved answer", "call-2", "Useful report", "call-3"].map((value) => markup.indexOf(value));
  assert.ok(positions.every((value) => value >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("repeated logical tool IDs on either side of prose retain distinct process occurrences", () => {
  const first = tool(1);
  const last = { ...tool(1), output: "later lifecycle output" } as DesktopUIMessagePart;
  const markup = render([first, { type: "text", text: "Visible lifecycle boundary", state: "done" }, last]);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 2);
  assert.match(markup, /data-process-id="tool:call-1"/);
  assert.match(markup, /data-process-id="tool:call-1:1"/);
  assert.ok(markup.indexOf('data-process-id="tool:call-1"') < markup.indexOf("Visible lifecycle boundary"));
  assert.ok(markup.indexOf("Visible lifecycle boundary") < markup.indexOf('data-process-id="tool:call-1:1"'));
});

test("tool-only activity has one bounded announcement and no duplicate running row", () => {
  const markup = render([tool(1, "input-available"), tool(2, "input-available")], true);
  assert.match(markup, /aria-busy="true"/);
  assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /class="wb-ai-message-activity"/);
  assert.match(markup, /data-slot="tool-activity-group"/);
  assert.doesNotMatch(markup, /private-parameter/);
});

test("a pending approval stays directly visible between trace groups", () => {
  const markup = render([tool(1), { type: "dynamic-tool", toolCallId: "approval-call", toolName: "bash", state: "approval-requested", input: { command: "pwd" }, approval: { id: "permission", reason: "Run pwd" } }, tool(2)], true);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 2);
  assert.match(markup, /data-slot="confirmation"/);
  assert.match(markup, />Approve<|>Allow</);
  assert.match(markup, />Reject<|>Deny</);
  assert.ok(markup.indexOf("call-1") < markup.indexOf("approval-call"));
  assert.ok(markup.indexOf("approval-call") < markup.indexOf("call-2"));
});

test("failure and denial remain visible without displaying successful raw outputs", () => {
  const markup = render([tool(1), tool(2, "output-error"), tool(3, "output-denied")]);
  assert.match(markup, /1 failed/);
  assert.match(markup, /1 denied/);
  assert.match(markup, /data-slot="tool-activity-failure-action"/);
  assert.doesNotMatch(markup, /private-result/);
});

test("workflow business results stay visible while raw trace is folded", () => {
  const markup = render([{ type: "dynamic-tool", toolCallId: "workflow-change", toolName: "undo", state: "output-available", input: { internal: "private-workflow-parameter" }, output: { summary: "Restored prior workflow" } }], false, true);
  assert.match(markup, /Restored prior workflow/);
  assert.match(markup, /data-slot="tool-activity-group"/);
  assert.doesNotMatch(markup, /private-workflow-parameter/);
});

for (const value of [0, false, ""]) {
  test(`tool details preserve a falsy output (${JSON.stringify(value)})`, () => {
    const markup = renderToStaticMarkup(<ToolOutput output={value} locale="en" />);
    assert.match(markup, /data-slot="tool-output"/);
    assert.match(markup, /Result/);
    assert.ok(markup.includes(value === "" ? "&quot;&quot;" : String(value)));
  });
}

const reasoning = (id: string, text = `private-reasoning-${id}`, state: "done" | "streaming" = "done"): DesktopUIMessagePart => ({
  type: "reasoning", text, state, providerMetadata: { coworkany: { partId: id } },
});

for (const count of [1, 10, 50]) {
  test(`${count} tools interleaved with reasoning have one closed mixed process`, () => {
    const parts = [reasoning("first"), ...Array.from({ length: count }, (_, index) => [tool(index), reasoning(`r-${index}`)]).flat()];
    const markup = render(parts);
    assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 1);
    assert.match(markup, /data-process-kind="mixed"/);
    assert.match(markup, new RegExp(`Process · ${count} tool operation`));
    assert.match(markup, /aria-expanded="false"/);
    assert.doesNotMatch(markup, /private-reasoning|private-result|private-parameter|lucide-brain|lucide-check|data-slot="reasoning-trigger"/);
  });
}

test("reasoning-only streaming remains closed with one truthful phase announcement", () => {
  const markup = render([reasoning("stream", "private-streaming-reasoning", "streaming")], true);
  assert.match(markup, /data-process-kind="reasoning"/);
  assert.match(markup, /data-state="closed"/);
  assert.match(markup, /Thinking/);
  assert.match(markup, /aria-busy="true"/);
  assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /private-streaming-reasoning|class="wb-ai-message-activity"|data-slot="reasoning-trigger"/);
});

test("historical reasoning uses a neutral label and omits settled empty reasoning", () => {
  const markup = render([reasoning("historical", "private-historical-reasoning", "streaming"), reasoning("empty", "   ")]);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 1);
  assert.match(markup, /Thinking process/);
  assert.doesNotMatch(markup, /Thought for|Thinking\.\.\.|private-historical-reasoning/);
  assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
  assert.match(markup, /data-phase-announcement="true"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"><\/span>/);
  assert.equal((render([reasoning("empty", "")]).match(/data-slot="tool-activity-group"/g) ?? []).length, 0);
  assert.match(render([reasoning("empty-active", "", "streaming")], true), /data-process-kind="reasoning"/);
});

test("mixed process projection leaves prose, tasks, sources and useful results directly visible", () => {
  const markup = render([
    reasoning("first"), { type: "text", text: "Pre-tool explanation", state: "done" },
    tool(1), reasoning("middle"), tool(2), { type: "text", text: "Final answer", state: "done" },
    { type: "data-task", id: "task", data: { id: "task", title: "Visible task", status: "completed" } },
    { type: "source-url", sourceId: "source", title: "Visible source", url: "https://example.com" },
    { type: "data-report", id: "report", data: { title: "Visible result", body: "Typed body" } },
    reasoning("after-result"),
  ]);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 3);
  const positions = ['data-process-kind="reasoning"', "Pre-tool explanation", 'data-process-kind="mixed"', "Final answer", "Visible task", 'data-slot="sources"', "Visible result"].map((marker) => markup.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0), JSON.stringify(positions));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.doesNotMatch(markup, /private-reasoning/);
});

test("Workflow AI tool runs remain boundaries between reasoning processes", () => {
  const call: DesktopUIMessagePart = { type: "dynamic-tool", toolCallId: "workflow-change", toolName: "undo", state: "output-available", input: {}, output: { summary: "Direct workflow result" } };
  const markup = render([reasoning("before"), call, reasoning("after")], false, true);
  assert.equal((markup.match(/data-process-kind="reasoning"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /data-process-kind="mixed"/);
  const positions = ["reasoning:before", "Direct workflow result", "reasoning:after"].map((marker) => markup.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0), JSON.stringify(positions));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  const active = render([reasoning("before"), { ...call, state: "input-available", output: undefined } as DesktopUIMessagePart, reasoning("after")], true, true);
  assert.equal((active.match(/data-process-kind="reasoning"/g) ?? []).length, 2);
  assert.match(active, /data-slot="tool-activity-group"/);
});
