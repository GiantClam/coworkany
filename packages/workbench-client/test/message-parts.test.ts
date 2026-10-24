import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkbenchRunEventToParts,
  mergeWorkbenchMessagePart,
  normalizeWorkbenchMessageParts,
  type WorkbenchMessagePart,
} from "../src/index";

test("legacy flat content becomes a text part and parts are sequence ordered", () => {
  const parts = normalizeWorkbenchMessageParts([
    { id: "tool", type: "tool", tool: "search", status: "completed", sequence: 2 },
    { id: "text", type: "text", text: "done", sequence: 1 },
  ], "ignored");
  assert.deepEqual(parts.map((part) => part.id), ["text", "tool"]);
  assert.deepEqual(normalizeWorkbenchMessageParts(undefined, "legacy"), [{ id: "text:legacy", type: "text", text: "legacy" }]);
});

test("stream events merge by stable identity and keep tool calls idempotent", () => {
  let parts: WorkbenchMessagePart[] = [];
  parts = applyWorkbenchRunEventToParts(parts, { type: "text", delta: "hel", sequence: 1 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "text", delta: "lo", sequence: 2 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "started", input: { query: "ai" }, sequence: 3 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "completed", output: { count: 2 }, sequence: 4 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "completed", output: { count: 2 }, sequence: 4 });
  assert.equal(parts.find((part) => part.type === "text")?.text, "hello");
  assert.equal(parts.filter((part) => part.type === "tool-call").length, 1);
  assert.equal(parts.find((part) => part.type === "tool-call")?.status, "completed");
});

test("plan, task and attachment events remain structured", () => {
  let parts: WorkbenchMessagePart[] = [];
  parts = applyWorkbenchRunEventToParts(parts, { type: "plan", plan: { id: "plan-1", title: "Plan", status: "running", steps: [{ id: "step-1", title: "Research", status: "running" }] }, sequence: 1 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "task", task: { id: "task-1", title: "Research task", status: "waiting" }, sequence: 2 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "attachment", attachment: { id: "file-1", name: "brief.pdf", mediaType: "application/pdf", status: "ready" }, sequence: 3 });
  assert.deepEqual(parts.map((part) => part.type), ["plan", "task", "attachment"]);
});

test("merge preserves a single stable part when the incoming id repeats", () => {
  const first: WorkbenchMessagePart = { id: "reasoning-1", type: "reasoning", text: "thinking", status: "running" };
  const next = mergeWorkbenchMessagePart([first], { ...first, text: "thinking more", status: "completed" });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.type === "reasoning" ? next[0].text : "", "thinking more");
});

test("reasoning snapshots do not duplicate in the process part", () => {
  let parts: WorkbenchMessagePart[] = [];
  parts = applyWorkbenchRunEventToParts(parts, { type: "reasoning", delta: "先判断用户需求。", sequence: 1 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "reasoning", delta: "先判断用户需求。", sequence: 2 });
  assert.equal(parts.find((part) => part.type === "reasoning")?.text, "先判断用户需求。");
});

test("preview events merge by stable session identity", () => {
  let parts: WorkbenchMessagePart[] = [];
  parts = applyWorkbenchRunEventToParts(parts, { type: "preview", preview: { kind: "ppt", title: "Deck", previewSessionId: "session-1", engine: "ppt-master", status: "loading" }, sequence: 1 });
  parts = applyWorkbenchRunEventToParts(parts, { type: "preview", preview: { kind: "ppt", title: "Deck", previewSessionId: "session-1", engine: "ppt-master", status: "ready", url: "http://127.0.0.1:6060/" }, sequence: 2 });
  const previews = parts.filter((part) => part.type === "preview");
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.id, "preview:session-1");
  assert.equal(previews[0]?.type === "preview" ? previews[0].preview.url : undefined, "http://127.0.0.1:6060/");
});
