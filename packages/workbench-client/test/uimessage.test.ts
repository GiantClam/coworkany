import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceAssistantTurn, applyDesktopUIMessageRunEventToParts, applyWorkbenchRunEventToUIMessage, beginAssistantTurn, createDesktopUIMessage, createDesktopRunTransport, desktopUIMessageStorage, desktopUIMessageText, parseDesktopUIMessage, workbenchEventToUIMessageChunks, type DesktopUIMessage, type WorkbenchRunEvent } from "../src/index";

function event(input: Parameters<typeof applyWorkbenchRunEventToUIMessage>[1]) {
  return input;
}

const interleavedEvents = JSON.parse(readFileSync(new URL("./fixtures/assistant-turn-interleaved.json", import.meta.url), "utf8")) as WorkbenchRunEvent[];

function partOccurrenceId(part: DesktopUIMessage["parts"][number]) {
  if (part.type !== "text" && part.type !== "reasoning") return undefined;
  return part.providerMetadata?.coworkany?.partId;
}

test("projects one assistant turn without losing interleaved occurrence boundaries", () => {
  const initial = beginAssistantTurn({ kind: "new", id: "assistant-fixture", conversationId: "conversation-fixture", runId: "run-fixture", createdAt: "2026-09-29T00:00:00.000Z" });
  const projected = interleavedEvents.reduce(advanceAssistantTurn, initial);

  assert.deepEqual(projected.parts.map((part) => part.type), [
    "reasoning",
    "text",
    "dynamic-tool",
    "text",
    "data-artifact",
    "data-status",
  ]);
  assert.deepEqual(projected.parts.filter((part) => part.type === "text").map(partOccurrenceId), ["text:2", "text:5"]);
  assert.equal(projected.parts[2]?.type === "dynamic-tool" && projected.parts[2].state, "output-available");
  assert.equal(desktopUIMessageText(projected), "I will check the current implementation.The tool result confirms the ordering bug.");
  assert.equal(projected.metadata?.runStatus, "completed");
  assert.deepEqual(projected.metadata?.partOccurrences?.["tool:tool-search-1"], { sequence: 3, createdAt: "2026-09-29T00:00:03.000Z" });
  assert.deepEqual(projected.metadata?.partOccurrences?.["data-artifact:artifact:artifact-order-report"], { sequence: 6, createdAt: "2026-09-29T00:00:06.000Z" });
  assert.ok(projected.parts.filter((part) => part.type === "text" || part.type === "reasoning").every((part) => part.state === "done"));
});

test("keeps a completed entity at its first position and ignores duplicate sequences", () => {
  const initial = beginAssistantTurn({ kind: "new", id: "assistant-entity", conversationId: "conversation-entity", runId: "run-entity", createdAt: "2026-09-29T00:00:00.000Z" });
  const throughTool = interleavedEvents.slice(0, 4).reduce(advanceAssistantTurn, initial);
  const duplicate = advanceAssistantTurn(throughTool, interleavedEvents[3]!);
  assert.equal(duplicate, throughTool);
  assert.equal(throughTool.parts[2]?.type, "dynamic-tool");
  assert.equal(throughTool.parts[2]?.type === "dynamic-tool" && throughTool.parts[2].toolCallId, "tool-search-1");
});

test("round-trips every projected segment in chronological order", () => {
  const projected = interleavedEvents.reduce(advanceAssistantTurn, beginAssistantTurn({ kind: "new", id: "assistant-storage", conversationId: "conversation-storage", runId: "run-storage", createdAt: "2026-09-29T00:00:00.000Z" }));
  const stored = desktopUIMessageStorage(projected);
  const restored = parseDesktopUIMessage({ id: projected.id, role: projected.role, parts: JSON.parse(stored.parts_json), metadata: JSON.parse(stored.metadata_json) });
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(projected)));
});

test("creates a UIMessage with locked execution metadata", () => {
  const message = createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", runId: "run-1", providerId: "grok", modelId: "grok-4", route: "/chat" });
  assert.equal(message.metadata?.providerId, "grok");
  assert.equal(message.metadata?.modelId, "grok-4");
  assert.equal(message.metadata?.modelLocked, true);
});

test("merges streaming text immutably and preserves sequence ordering", () => {
  const initial = createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const first = applyWorkbenchRunEventToUIMessage(initial, event({ type: "text", delta: "hello", sequence: 1 }));
  const second = applyWorkbenchRunEventToUIMessage(first, event({ type: "text", delta: " world", sequence: 2 }));
  assert.equal(desktopUIMessageText(second), "hello world");
  assert.equal(desktopUIMessageText(initial), "");
  assert.equal(applyWorkbenchRunEventToUIMessage(second, event({ type: "text", delta: " duplicate", sequence: 2 })), second);
});

test("does not repeat short text fragments when a stream delivers them more than once", () => {
  let message = createDesktopUIMessage({ id: "assistant-duplicate-fragments", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const fragments = ["I'll", "I'll", "I'll", " load", " load", " load", " the", " the", " the", " D", " D", " D", "ashi", "ashi", "ashi", " PPT", " PPT", " PPT", " skill", " skill"];
  fragments.forEach((delta, index) => {
    message = applyWorkbenchRunEventToUIMessage(message, event({ type: "text", delta, sequence: index + 1 }));
  });
  assert.equal(desktopUIMessageText(message), "I'll load the Dashi PPT skill");
});

test("desktop OpenCode event replay preserves a repeated visible boundary token", () => {
  let parts = applyDesktopUIMessageRunEventToParts([], { type: "reasoning", delta: "Choose the response.", sequence: 1 });
  parts = applyDesktopUIMessageRunEventToParts(parts, { type: "text", delta: "主题", sequence: 2 });
  parts = applyDesktopUIMessageRunEventToParts(parts, { type: "text", delta: "主题-only", sequence: 3 });
  const message: DesktopUIMessage = { ...createDesktopUIMessage({ id: "assistant-boundary", role: "assistant", conversationId: "conversation-1" }), parts };
  assert.equal(desktopUIMessageText(message), "主题主题-only");
});

test("replaces a final full-text snapshot instead of appending it to streamed deltas", () => {
  const initial = createDesktopUIMessage({ id: "assistant-snapshot", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const streamed = applyWorkbenchRunEventToUIMessage(initial, event({
    type: "text",
    delta: "I'mnotgoingtouseaskillforthisgeneralquestion.",
    sequence: 1,
  }));
  const final = applyWorkbenchRunEventToUIMessage(streamed, event({
    type: "text",
    delta: "I'm not going to use a skill for this general question.",
    sequence: 2,
  }));
  assert.equal(desktopUIMessageText(final), "I'm not going to use a skill for this general question.");
});

test("preserves text parts exactly, including planning-like words", () => {
  const initial = createDesktopUIMessage({ id: "assistant-planning-residue", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const result = applyWorkbenchRunEventToUIMessage(initial, event({
    type: "text",
    delta: "TheuserTheuser审查时最需要关注的三项风险：1.付款与资金条款风险",
    sequence: 1,
  }));
  assert.equal(desktopUIMessageText(result), "TheuserTheuser审查时最需要关注的三项风险：1.付款与资金条款风险");
});

test("preserves text parts exactly across languages", () => {
  const initial = createDesktopUIMessage({ id: "assistant-repeated-planning-residue", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const result = applyWorkbenchRunEventToUIMessage(initial, event({
    type: "text",
    delta: "TheuserisTheuserisTheuser审查最值得优先盯住的三项风险：1.签约主体与授权资格",
    sequence: 1,
  }));
  assert.equal(desktopUIMessageText(result), "TheuserisTheuserisTheuser审查最值得优先盯住的三项风险：1.签约主体与授权资格");
});

test("restores persisted text without mutating Markdown source", () => {
  const restored = parseDesktopUIMessage({
    id: "assistant-persisted-planning-residue",
    role: "assistant",
    parts: [{ type: "text", text: "TheuserisTheuserisTheuser审查时最需要关注的三项风险：1.付款与资金条款风险", state: "done" }],
  });
  assert.equal(desktopUIMessageText(restored), "TheuserisTheuserisTheuser审查时最需要关注的三项风险：1.付款与资金条款风险");
});

test("preserves English text when it is explicitly a text part", () => {
  const restored = parseDesktopUIMessage({
    id: "assistant-generic-self-talk",
    role: "assistant",
    parts: [{ type: "text", text: "This is another regression test message. I should acknowledge the two lines and confirm rendering. 收到你的新回归测试消息，两行内容正常显示：\n\n第一行\n第二行", state: "done" }],
  });
  assert.equal(desktopUIMessageText(restored), "This is another regression test message. I should acknowledge the two lines and confirm rendering. 收到你的新回归测试消息，两行内容正常显示：\n\n第一行\n第二行");
});

test("preserves malformed Markdown source for the standard renderer", () => {
  const restored = parseDesktopUIMessage({
    id: "assistant-chinese-self-talk",
    role: "assistant",
    parts: [{ type: "text", text: "需要先对齐一个矛盾点：平台和任务要求不同，我按你的明确指令来。确认无误后继续：---##标题候选\n\n正文内容", state: "done" }],
  });
  assert.equal(desktopUIMessageText(restored), "需要先对齐一个矛盾点：平台和任务要求不同，我按你的明确指令来。确认无误后继续：---##标题候选\n\n正文内容");
});

test("keeps explicit reasoning separate from persisted visible text", () => {
  const restored = parseDesktopUIMessage({
    id: "assistant-compact-investigation",
    role: "assistant",
    parts: [{ type: "text", text: "The userLet me understand the task. Let me investigate the workspace and references. 一、先说结论：需求成立。", state: "done" }],
  });
  assert.equal(desktopUIMessageText(restored), "The userLet me understand the task. Let me investigate the workspace and references. 一、先说结论：需求成立。");
  assert.deepEqual(restored.parts, [{ type: "text", text: "The userLet me understand the task. Let me investigate the workspace and references. 一、先说结论：需求成立。", state: "done" }]);
});

test("persists exact text and reasoning parts for the desktop history renderer", () => {
  const message = parseDesktopUIMessage({
    id: "assistant-sales-storage",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "先检查数据", state: "done" },
      { type: "text", text: "结论。\n\n---##标题", state: "done" },
    ],
  });
  const stored = desktopUIMessageStorage(message);
  assert.equal(stored.content, "结论。\n\n---##标题");
  assert.match(stored.parts_json, /先检查数据/u);
  assert.match(stored.parts_json, /---##标题/u);
});

test("does not regress a completed tool on duplicate or late started events", () => {
  let message = createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  message = applyWorkbenchRunEventToUIMessage(message, event({ type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "started", input: { query: "ai" }, sequence: 1 }));
  message = applyWorkbenchRunEventToUIMessage(message, event({ type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "completed", output: ["result"], sequence: 2 }));
  const completed = message;
  const late = applyWorkbenchRunEventToUIMessage(message, event({ type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "started", input: { query: "ai" }, sequence: 3 }));
  assert.deepEqual(late.parts, completed.parts);
});

test("emits AI SDK UI message chunks for native and typed data parts", () => {
  assert.deepEqual(workbenchEventToUIMessageChunks({ type: "text", delta: "hi" }), [{ type: "text-delta", id: "text:assistant", delta: "hi" }]);
  const chunks = workbenchEventToUIMessageChunks({ type: "artifact", artifact: { id: "artifact-1", relativePath: "assets/a.png", title: "a.png", mimeType: "image/png", byteLength: 1, sha256: "hash" } });
  assert.equal(chunks[0]?.type, "data-artifact");
  const previewChunks = workbenchEventToUIMessageChunks({ type: "preview", preview: { kind: "ppt", title: "Deck preview", url: "http://127.0.0.1:5200/", previewSessionId: "dashi:5200", engine: "dashi-ppt", interactive: true, status: "ready" } });
  assert.equal(previewChunks[0]?.type, "data-preview");
});

test("updates one stable preview part and persists its session descriptor", () => {
  const initial = createDesktopUIMessage({ id: "assistant-preview", role: "assistant", conversationId: "conversation-preview", runId: "run-preview" });
  const loading = applyWorkbenchRunEventToUIMessage(initial, event({
    type: "preview",
    preview: { kind: "ppt", title: "Deck preview", previewSessionId: "ppt-session-1", engine: "ppt-master", interactive: true, status: "loading" },
    sequence: 1,
  }));
  const ready = applyWorkbenchRunEventToUIMessage(loading, event({
    type: "preview",
    preview: { kind: "ppt", title: "Deck preview", url: "http://127.0.0.1:6060/", previewSessionId: "ppt-session-1", engine: "ppt-master", interactive: true, status: "ready" },
    sequence: 2,
  }));
  const duplicate = applyWorkbenchRunEventToUIMessage(ready, event({
    type: "preview",
    preview: { kind: "ppt", title: "Duplicate", url: "http://127.0.0.1:6060/", previewSessionId: "ppt-session-1", engine: "ppt-master", status: "ready" },
    sequence: 2,
  }));
  const previews = ready.parts.filter((part) => part.type === "data-preview");
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.id, "preview:ppt-session-1");
  assert.equal(previews[0]?.data.status, "ready");
  assert.equal(duplicate, ready);
  const stored = desktopUIMessageStorage(ready);
  const restored = parseDesktopUIMessage({ id: ready.id, role: ready.role, parts: JSON.parse(stored.parts_json), metadata: JSON.parse(stored.metadata_json) });
  assert.deepEqual(restored.parts.find((part) => part.type === "data-preview"), previews[0]);
});

test("serializes and restores UIMessage parts and metadata without losing text", () => {
  const message = createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", runId: "run-1", providerId: "deepseek", modelId: "deepseek-v4-flash", content: "已完成" });
  const stored = desktopUIMessageStorage(message);
  const restored = parseDesktopUIMessage({ id: message.id, role: message.role, parts: JSON.parse(stored.parts_json), metadata: JSON.parse(stored.metadata_json) });
  assert.equal(desktopUIMessageText(restored), "已完成");
  assert.equal(restored.metadata?.modelId, "deepseek-v4-flash");
});

test("restores legacy thinking parts as renderable reasoning parts", () => {
  const restored = parseDesktopUIMessage({
    id: "assistant-thinking",
    role: "assistant",
    parts: [{ type: "thinking", thinking: "先分析任务" }],
  });
  assert.deepEqual(restored.parts, [{ type: "reasoning", text: "先分析任务", state: "done" }]);
});

test("adapts a run event sequence to an AI SDK readable stream", async () => {
  let listener: ((event: WorkbenchRunEvent) => void) | undefined;
  const transport = createDesktopRunTransport({
    start: async () => ({ runId: "run-1" }),
    subscribe: (_runId, onEvent) => { listener = onEvent; return () => { listener = undefined; }; },
  });
  const user = createDesktopUIMessage({ id: "user-1", role: "user", conversationId: "conversation-1", content: "hello" });
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "conversation-1", messageId: undefined, messages: [user], abortSignal: undefined });
  const reader = stream.getReader();
  listener?.({ type: "text", delta: "hi", sequence: 1 });
  listener?.({ type: "status", status: "succeeded", sequence: 2 });
  const chunks = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  assert.deepEqual(chunks.map((chunk) => chunk.type), [
    "start",
    "text-start",
    "text-delta",
    "message-metadata",
    "text-end",
    "data-status",
    "message-metadata",
    "finish",
  ]);
  assert.equal(chunks[0]?.type === "start" && chunks[0].messageId, "assistant-run-1");
  assert.deepEqual(chunks[0]?.type === "start" ? chunks[0].messageMetadata : undefined, {
    conversationId: "conversation-1",
    runId: "run-1",
    createdAt: chunks[0]?.type === "start" ? chunks[0].messageMetadata?.createdAt : undefined,
    updatedAt: chunks[0]?.type === "start" ? chunks[0].messageMetadata?.updatedAt : undefined,
    runStatus: "running",
  });
  const finalMetadata = chunks.findLast((chunk) => chunk.type === "message-metadata");
  assert.equal(finalMetadata?.type === "message-metadata" && finalMetadata.messageMetadata?.lastSequence, 2);
  assert.equal(finalMetadata?.type === "message-metadata" && finalMetadata.messageMetadata?.runStatus, "completed");
});

test("ends text at a tool barrier and resumes with a new occurrence id", async () => {
  let listener: ((event: WorkbenchRunEvent) => void) | undefined;
  const transport = createDesktopRunTransport({
    start: async () => ({ runId: "run-interleaved" }),
    subscribe: (_runId, onEvent) => { listener = onEvent; return () => { listener = undefined; }; },
  });
  const user = createDesktopUIMessage({ id: "user-interleaved", role: "user", conversationId: "conversation-interleaved", content: "inspect" });
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "conversation-interleaved", messageId: undefined, messages: [user], abortSignal: undefined });
  const reader = stream.getReader();
  interleavedEvents.forEach((item) => listener?.(item));
  const chunks = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }

  const firstTextStart = chunks.findIndex((chunk) => chunk.type === "text-start" && chunk.id === "text:2");
  const firstTextEnd = chunks.findIndex((chunk) => chunk.type === "text-end" && chunk.id === "text:2");
  const toolStart = chunks.findIndex((chunk) => chunk.type === "tool-input-available");
  const secondTextStart = chunks.findIndex((chunk) => chunk.type === "text-start" && chunk.id === "text:5");
  assert.ok(firstTextStart >= 0);
  assert.ok(firstTextStart < firstTextEnd && firstTextEnd < toolStart && toolStart < secondTextStart);
  assert.equal(chunks.filter((chunk) => chunk.type === "text-start").length, 2);
});

test("exposes a direct transport stop for desktop streams when the shell has no active run id", async () => {
  const stopped: string[] = [];
  const transport = createDesktopRunTransport({
    start: async () => ({ runId: "run-direct-stop" }),
    subscribe: () => () => undefined,
    stop: async (runId) => { stopped.push(runId); },
  });
  const user = createDesktopUIMessage({ id: "user-direct-stop", role: "user", conversationId: "conversation-stop", content: "long response" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "conversation-stop", messageId: undefined, messages: [user], abortSignal: undefined });
  await transport.stopCurrent();
  assert.deepEqual(stopped, ["run-direct-stop"]);
});

test("stops a desktop stream even when run startup is still pending", async () => {
  const stopped: string[] = [];
  let disposed = 0;
  let resolveStart: ((value: { runId: string }) => void) | undefined;
  const transport = createDesktopRunTransport({
    start: async () => new Promise<{ runId: string }>((resolve) => { resolveStart = resolve; }),
    subscribe: () => () => { disposed += 1; },
    stop: async (runId) => { stopped.push(runId); },
  });
  const user = createDesktopUIMessage({ id: "user-pending-stop", role: "user", conversationId: "conversation-pending-stop", content: "long response" });
  const request = transport.sendMessages({ trigger: "submit-message", chatId: "conversation-pending-stop", messageId: undefined, messages: [user], abortSignal: undefined });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await transport.stopCurrent();
  resolveStart?.({ runId: "run-pending-stop" });
  await request;
  assert.deepEqual(stopped, ["run-pending-stop"]);
  assert.equal(disposed, 1);
});

test("replays every UIMessage part family into stable native or typed chunks", () => {
  const events: WorkbenchRunEvent[] = [
    { type: "text", delta: "正文" },
    { type: "reasoning", delta: "推理" },
    { type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "started", input: { query: "AI" } },
    { type: "tool_call", toolName: "search", toolCallId: "tool-1", phase: "completed", output: { count: 1 } },
    { type: "source", source: { id: "source-1", title: "文档", href: "https://example.com" } },
    { type: "attachment", attachment: { id: "file-1", name: "brief.pdf", mediaType: "application/pdf", status: "ready" } },
    { type: "media", media: { artifactId: "media-1", kind: "image", title: "封面", mimeType: "image/png", relativePath: "artifacts/cover.png", previewable: true } },
    { type: "artifact", artifact: { id: "artifact-1", relativePath: "artifacts/a.png", title: "封面", mimeType: "image/png", byteLength: 1, sha256: "hash" } },
    { type: "preview", preview: { kind: "web", title: "网站预览", url: "http://localhost:5300/", previewSessionId: "web-1", engine: "generic-web", interactive: true, status: "ready" } },
  ];
  const chunks = events.flatMap(workbenchEventToUIMessageChunks);
  assert.deepEqual(chunks.map((chunk) => chunk.type), [
    "text-delta",
    "reasoning-delta",
    "tool-input-available",
    "tool-output-available",
    "source-url",
    "data-attachment",
    "data-media",
    "data-artifact",
    "data-preview",
  ]);
  assert.equal(chunks[2]?.type === "tool-input-available" && chunks[2].toolCallId, "tool-1");
  assert.equal(chunks[4]?.type === "source-url" && chunks[4].sourceId, "source-1");
  assert.equal(chunks[6]?.type === "data-media" && chunks[6].data.kind, "image");
  assert.equal(chunks[7]?.type === "data-artifact" && chunks[7].data.mimeType, "image/png");
  assert.equal(chunks[8]?.type === "data-preview" && chunks[8].data.previewSessionId, "web-1");
});

test("reconstructs the same rich UIMessage after event replay and persistence", () => {
  const events: WorkbenchRunEvent[] = [
    { type: "text", delta: "结果", sequence: 1, createdAt: "2026-08-26T00:00:01Z" },
    { type: "reasoning", delta: "已分析", sequence: 2, createdAt: "2026-08-26T00:00:02Z" },
    { type: "tool_call", toolName: "writer", toolCallId: "tool-1", phase: "started", input: { topic: "AI" }, sequence: 3 },
    { type: "tool_call", toolName: "writer", toolCallId: "tool-1", phase: "completed", output: { path: "artifacts/result.md" }, sequence: 4 },
    { type: "source", source: { id: "source-1", title: "资料", href: "https://example.com" }, sequence: 5 },
    { type: "attachment", attachment: { id: "file-1", name: "brief.pdf", mediaType: "application/pdf", status: "ready" }, sequence: 6 },
    { type: "media", media: { artifactId: "media-1", kind: "image", title: "封面", mimeType: "image/png", relativePath: "artifacts/cover.png" }, sequence: 7 },
    { type: "artifact", artifact: { id: "artifact-1", relativePath: "artifacts/result.md", title: "结果", mimeType: "text/markdown", byteLength: 8, sha256: "hash" }, sequence: 8 },
    { type: "preview", preview: { kind: "ppt", title: "演示文稿", url: "http://127.0.0.1:5200/", previewSessionId: "dashi-5200", engine: "dashi-ppt", status: "ready" }, sequence: 9 },
    { type: "status", status: "succeeded", sequence: 10 },
  ];
  const initial = createDesktopUIMessage({ id: "assistant-replay", role: "assistant", conversationId: "conversation-replay", runId: "run-replay", providerId: "deepseek", modelId: "deepseek-v4-flash" });
  const replayed = events.reduce(applyWorkbenchRunEventToUIMessage, initial);
  const stored = desktopUIMessageStorage(replayed);
  const restored = parseDesktopUIMessage({ id: replayed.id, role: replayed.role, parts: JSON.parse(stored.parts_json), metadata: JSON.parse(stored.metadata_json) });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.parts)), JSON.parse(JSON.stringify(replayed.parts)));
  assert.equal(restored.metadata?.lastSequence, 10);
  assert.equal(restored.metadata?.runStatus, "completed");
});
