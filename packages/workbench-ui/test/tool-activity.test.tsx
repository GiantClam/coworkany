import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopUIMessagePart } from "@coworkany/workbench-client";
import { groupProcessActivityParts, groupToolActivityParts, summarizeProcessActivity, summarizeToolActivity, type ReasoningActivityPart, type ToolActivityPart } from "../src/tool-activity";

function tool(id: string, toolName: string, state: ToolActivityPart["state"], extra: Record<string, unknown> = {}): ToolActivityPart {
  return { type: "dynamic-tool", toolCallId: id, toolName, state, input: {}, ...extra } as ToolActivityPart;
}

function reasoning(id: string, text: string, state: "streaming" | "done" = "done"): ReasoningActivityPart {
  return { type: "reasoning", text, state, providerMetadata: { coworkany: { partId: id } } } as ReasoningActivityPart;
}

test("groups maximal adjacent ordinary tools while preserving visible order and refs", () => {
  const first = tool("t1", "search", "input-available");
  const second = tool("t2", "read_file", "output-available", { output: "ok" });
  const text: DesktopUIMessagePart = { type: "text", text: "middle", state: "done" };
  const third = tool("t3", "write_file", "output-available", { output: "ok" });
  const metadata = { type: "data-usage", id: "usage-1", data: { runId: "run", model: "model" } } as DesktopUIMessagePart;
  const parts = [first, second, metadata, text, third];

  const entries = groupToolActivityParts(parts);

  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { type: "tool-group", id: "t1", parts: [first, second] });
  assert.deepEqual(entries[1], { type: "part", part: text, index: 3 });
  assert.deepEqual(entries[2], { type: "tool-group", id: "t3", parts: [third] });
  assert.equal(parts[0], first);
  assert.equal(parts[1], second);
});

test("approval and user-interaction tools are standalone boundaries", () => {
  const before = tool("t1", "search", "input-available");
  const approval = tool("t2", "shell", "approval-requested", { approval: { id: "a1" } });
  const question = tool("t3", "ask_user", "input-available");
  const after = tool("t4", "read", "input-available");

  const entries = groupToolActivityParts([before, approval, question, after]);

  assert.deepEqual(entries.map((entry) => entry.type), ["tool-group", "part", "part", "tool-group"]);
  assert.deepEqual(entries[0], { type: "tool-group", id: "t1", parts: [before] });
  assert.deepEqual(entries[1], { type: "part", part: approval, index: 1 });
  assert.deepEqual(entries[2], { type: "part", part: question, index: 2 });
  assert.deepEqual(entries[3], { type: "tool-group", id: "t4", parts: [after] });
});

test("summaries use the latest lifecycle per call id and real outcomes", () => {
  const parts = [
    tool("t1", "search", "input-available"),
    tool("t1", "search", "output-available", { output: ["result"] }),
    tool("t2", "write_file", "output-error", { errorText: "nope" }),
    tool("t3", "shell", "approval-responded", { approval: { id: "a3", approved: false } }),
    tool("t4", "read_file", "approval-responded", { approval: { id: "a4", approved: true } }),
  ];

  assert.deepEqual(summarizeToolActivity(parts, "zh"), {
    label: "正在读取内容 · 已完成 1 次操作 · 1 项失败 · 1 项被拒绝",
    phase: "running",
    active: 1,
    completed: 1,
    failed: 1,
    denied: 1,
    total: 4,
    failedCallIds: ["t2"],
  });
  const english = summarizeToolActivity(parts, "en");
  assert.equal(english.phase, "running");
  assert.match(english.label, /Reading/);
});

test("waiting and denial are distinguished from successful completion", () => {
  const waiting = summarizeToolActivity([tool("t1", "shell", "approval-requested", { approval: { id: "a1" } })], "en");
  assert.deepEqual(waiting, {
    label: "Awaiting approval",
    phase: "waiting",
    active: 1,
    completed: 0,
    failed: 0,
    denied: 0,
    total: 1,
    failedCallIds: [],
  });

  const denied = summarizeToolActivity([tool("t1", "shell", "output-denied", { approval: { id: "a1", approved: false } })], "zh");
  assert.equal(denied.phase, "denied");
  assert.equal(denied.completed, 0);
  assert.equal(denied.denied, 1);
  assert.deepEqual(denied.failedCallIds, []);
});

test("deduplicates lifecycle rows by call id and keeps the latest reference at first position", () => {
  const first = tool("t1", "read_file", "input-available");
  const second = tool("t2", "run_task", "input-available");
  const latest = tool("t1", "read_file", "output-available", { output: "done" });
  const parts = Object.freeze([first, second, latest]);
  const group = groupToolActivityParts(parts)[0];
  assert.equal(group?.type, "tool-group");
  if (group?.type !== "tool-group") return;
  assert.deepEqual(group.parts, [latest, second]);
  assert.equal(group.parts[0], latest);
  assert.equal(group.parts[1], second);
});

test("keeps dense 1/10/50-call runs compact", () => {
  for (const count of [1, 10, 50]) {
    const parts = Array.from({ length: count }, (_, index) => tool(`t${index}`, "read_file", "input-available"));
    const entries = groupToolActivityParts(parts);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.type, "tool-group");
    assert.equal(entries[0]?.type === "tool-group" ? entries[0].parts.length : 0, count);
  }
});

test("uses neutral active wording for unknown names and avoids substring misclassification", () => {
  const summary = summarizeToolActivity([tool("t1", "targeted_operation", "input-available")], "en");
  assert.equal(summary.label, "Running tools");
  const check = summarizeToolActivity([tool("t2", "check_status", "input-available")], "en");
  assert.equal(check.label, "Testing");
});

test("completed wording is localized and capitalized in English", () => {
  const summary = summarizeToolActivity([tool("t1", "write_file", "output-available", { output: "ok" })], "en");
  assert.equal(summary.label, "Completed 1 operation · View activity");
});

test("groups adjacent reasoning and tools without crossing visible text", () => {
  const first = reasoning("r1", "plan");
  const textA: DesktopUIMessagePart = { type: "text", text: "A", state: "done" };
  const t1 = tool("t1", "read_file", "output-available");
  const middle = reasoning("r2", "inspect");
  const t2 = tool("t2", "search", "output-available");
  const textB: DesktopUIMessagePart = { type: "text", text: "B", state: "done" };
  const entries = groupProcessActivityParts([first, textA, t1, middle, t2, textB], { active: false });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "part", "process-group", "part"]);
  const group = entries[2];
  assert.equal(group?.type, "process-group");
  if (group?.type !== "process-group") return;
  assert.deepEqual(group.members.map((member) => member.part.type), ["dynamic-tool", "reasoning", "dynamic-tool"]);
  assert.equal(summarizeProcessActivity(group.members.map((member) => member.part), "zh", false).label, "处理过程 · 2 次工具操作");
});

test("uses neutral reasoning labels and only active streaming reasoning feedback", () => {
  const settled = groupProcessActivityParts([reasoning("r1", "done")], { active: false });
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.type, "process-group");
  if (settled[0]?.type === "process-group") {
    assert.equal(summarizeProcessActivity(settled[0].members.map((member) => member.part), "zh", false).label, "思考过程");
  }
  const emptyHistory = groupProcessActivityParts([reasoning("r2", "")], { active: false });
  assert.equal(emptyHistory.length, 0);
  const activeEmpty = groupProcessActivityParts([reasoning("r3", "", "streaming")], { active: true });
  assert.equal(activeEmpty.length, 1);
  if (activeEmpty[0]?.type === "process-group") {
    const summary = summarizeProcessActivity(activeEmpty[0].members.map((member) => member.part), "en", true);
    assert.equal(summary.label, "Thinking");
    assert.equal(summary.reasoningActive, true);
    assert.equal(summary.phase, "running");
  }
});

test("keeps Workflow AI tools in legacy groups and splits reasoning around them", () => {
  const before = reasoning("r1", "before");
  const workflowTool = tool("t1", "search", "output-available");
  const after = reasoning("r2", "after");
  const entries = groupProcessActivityParts([before, workflowTool, after], { active: false, workflowAi: true });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "tool-group", "process-group"]);
});

test("keeps consecutive Workflow AI tools in one legacy group", () => {
  for (const count of [2, 10]) {
    const parts = Array.from({ length: count }, (_, index) => tool(`workflow-${index}`, "search", "output-available"));
    const entries = groupProcessActivityParts(parts, { active: false, workflowAi: true });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.type, "tool-group");
    if (entries[0]?.type === "tool-group") {
      assert.equal(entries[0].parts.length, count);
      assert.deepEqual(entries[0].memberIds, Array.from({ length: count }, (_, index) => `tool:workflow-${index}`));
      assert.equal(entries[0].id, "tool:workflow-0");
    }
  }
});

test("deduplicates lifecycle patches while preserving first position and latest refs", () => {
  const firstTool = tool("t1", "read_file", "input-available");
  const secondTool = tool("t2", "search", "input-available");
  const latestTool = tool("t1", "read_file", "output-available");
  const entries = groupProcessActivityParts([firstTool, secondTool, latestTool], { active: false });
  assert.equal(entries.length, 1);
  if (entries[0]?.type !== "process-group") return;
  assert.deepEqual(entries[0].members.map((member) => member.id), ["tool:t1", "tool:t2"]);
  assert.equal(entries[0].members[0]?.part, latestTool);
});

test("deduplicates a tool lifecycle across an intervening reasoning part", () => {
  const first = tool("t1", "read_file", "input-available");
  const latest = tool("t1", "read_file", "output-available");
  const entries = groupProcessActivityParts([first, reasoning("r1", "inspect"), latest], { active: false });
  assert.equal(entries.length, 1);
  if (entries[0]?.type !== "process-group") return;
  assert.deepEqual(entries[0].members.map((member) => member.part.type), ["dynamic-tool", "reasoning"]);
  assert.equal(entries[0].members[0]?.part, latest);
});

test("preserves approval chronology across repeated lifecycle boundaries", () => {
  const input = tool("t1", "shell", "input-available");
  const approval = tool("t1", "shell", "approval-requested", { approval: { id: "a1" } });
  const output = tool("t1", "shell", "output-available", { output: "done" });
  const original = Object.freeze([input, approval, output]);
  const entries = groupProcessActivityParts(original, { active: false });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "part", "process-group"]);
  if (entries[0]?.type === "process-group" && entries[1]?.type === "part" && entries[2]?.type === "process-group") {
    assert.equal(entries[0].members[0]?.part, input);
    assert.equal(entries[1].part, approval);
    assert.equal(entries[2].members[0]?.part, output);
    assert.deepEqual([entries[0].members[0]?.id, entries[2].members[0]?.id], ["tool:t1", "tool:t1:1"]);
  }
  assert.equal(original[0], input);
  assert.equal(original[1], approval);
  assert.equal(original[2], output);
});

test("keeps tool-text-tool lifecycle references on their original sides", () => {
  const input = tool("t1", "shell", "input-available");
  const text: DesktopUIMessagePart = { type: "text", text: "Need approval", state: "done" };
  const output = tool("t1", "shell", "output-available", { output: "done" });
  const entries = groupProcessActivityParts([input, text, output], { active: false });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "part", "process-group"]);
  if (entries[0]?.type === "process-group" && entries[1]?.type === "part" && entries[2]?.type === "process-group") {
    assert.equal(entries[0].members[0]?.part, input);
    assert.equal(entries[1].part, text);
    assert.equal(entries[2].members[0]?.part, output);
    assert.deepEqual([entries[0].members[0]?.id, entries[2].members[0]?.id], ["tool:t1", "tool:t1:1"]);
  }
});

test("keeps the latest approval directly visible at its original position", () => {
  const input = tool("t1", "shell", "input-available");
  const approval = tool("t1", "shell", "approval-requested", { approval: { id: "a1" } });
  const entries = groupProcessActivityParts([input, approval], { active: false });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "part"]);
  if (entries[0]?.type === "process-group" && entries[1]?.type === "part") {
    assert.equal(entries[0].members[0]?.part, input);
    assert.equal(entries[1].part, approval);
    assert.equal(entries[0].members[0]?.id, "tool:t1");
  }
});

test("settled empty reasoning does not split an adjacent process interval", () => {
  const first = tool("t1", "read_file", "output-available");
  const empty = reasoning("empty", "");
  const second = tool("t2", "search", "output-available");
  const entries = groupProcessActivityParts([first, empty, second], { active: false });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, "process-group");
  if (entries[0]?.type === "process-group") {
    assert.deepEqual(entries[0].members.map((member) => member.part), [first, second]);
  }
});

test("settled empty reasoning does not split a Workflow AI legacy tool run", () => {
  const first = tool("t1", "read_file", "output-available");
  const empty = reasoning("empty", "");
  const second = tool("t2", "search", "output-available");
  const entries = groupProcessActivityParts([first, empty, second], { active: false, workflowAi: true });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, "tool-group");
  if (entries[0]?.type === "tool-group") assert.deepEqual(entries[0].parts, [first, second]);
});

test("active reasoning owns the mixed phase while retaining tool outcomes", () => {
  const settledTools = [tool("t1", "search", "output-available"), tool("t2", "read_file", "output-available")];
  const activeMixed = summarizeProcessActivity([...settledTools, reasoning("r1", "streaming", "streaming")], "zh", true);
  assert.equal(activeMixed.phase, "running");
  assert.equal(activeMixed.reasoningActive, true);
  assert.equal(activeMixed.label, "正在思考 · 2 次工具操作");

  const attentionMixed = summarizeProcessActivity([
    tool("t1", "search", "output-error"),
    tool("t2", "read_file", "output-denied"),
    reasoning("r2", "streaming", "streaming"),
  ], "en", true);
  assert.equal(attentionMixed.phase, "running");
  assert.equal(attentionMixed.label, "Thinking · 2 tool operations · 1 failed · 1 denied");
  assert.deepEqual(attentionMixed.failedCallIds, ["t1"]);
});

test("mixed summaries keep five unique observed tools in active and outcome labels", () => {
  const activeParts = [
    reasoning("r-active", "settled"),
    tool("t1", "search", "output-available"),
    tool("t1", "search", "output-available", { output: "latest" }),
    tool("t2", "read_file", "output-available"),
    tool("t3", "read_file", "output-available"),
    tool("t4", "read_file", "output-available"),
    tool("t5", "search", "input-available"),
  ];
  const activeSummary = summarizeProcessActivity(activeParts, "zh", true);
  assert.equal(activeSummary.total, 5);
  assert.equal(activeSummary.active, 1);
  assert.equal(activeSummary.label, "正在检索资料 · 5 次工具操作");

  const outcomeSummary = summarizeProcessActivity([
    reasoning("r-outcome", "settled"),
    tool("t1", "search", "output-error"),
    tool("t1", "search", "output-error", { errorText: "latest" }),
    tool("t2", "read_file", "output-error"),
    tool("t3", "read_file", "output-denied"),
    tool("t4", "read_file", "output-available"),
    tool("t5", "read_file", "output-available"),
  ], "zh", false);
  assert.equal(outcomeSummary.total, 5);
  assert.equal(outcomeSummary.failed, 2);
  assert.equal(outcomeSummary.denied, 1);
  assert.equal(outcomeSummary.label, "5 次工具操作 · 2 项失败 · 1 项被拒绝");
  assert.equal(outcomeSummary.label.includes("查看"), false);
});

test("non-process visible parts form boundaries", () => {
  const before = tool("t1", "search", "output-available");
  const text: DesktopUIMessagePart = { type: "text", text: "answer", state: "done" };
  const approval = tool("t2", "shell", "approval-requested", { approval: { id: "a1" } });
  const question = tool("t3", "ask_user", "input-available");
  const after = reasoning("r1", "next");
  const entries = groupProcessActivityParts([before, text, approval, question, after], { active: false });
  assert.deepEqual(entries.map((entry) => entry.type), ["process-group", "part", "part", "part", "process-group"]);
});

test("keeps 1/10/50 mixed members in one process group", () => {
  for (const count of [1, 10, 50]) {
    const parts: DesktopUIMessagePart[] = [];
    for (let index = 0; index < count; index += 1) {
      parts.push(reasoning(`r${index}`, `step-${index}`), tool(`t${index}`, "read_file", "output-available"));
    }
    const entries = groupProcessActivityParts(parts, { active: false });
    assert.equal(entries.length, 1);
    if (entries[0]?.type === "process-group") assert.equal(entries[0].members.length, count * 2);
  }
});
