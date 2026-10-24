import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopUIMessage, desktopUIMessageText, type WorkbenchMessage } from "@coworkany/workbench-client";
import { mergeConversationMessages, mergeDesktopUIMessageViews } from "../src/conversation-history";

test("conversation history keeps an optimistic user message when the first load races persistence", () => {
  const userMessage: WorkbenchMessage = {
    id: "message-run-1",
    conversationId: "conversation-1",
    role: "user" as const,
    content: "用户输入的 Agent 任务",
    createdAt: "2026-08-21T15:00:00.000Z",
  };
  const assistantMessage: WorkbenchMessage = {
    id: "assistant-run-1",
    conversationId: "conversation-1",
    role: "assistant" as const,
    content: "Agent 返回结果",
    createdAt: "2026-08-21T15:00:01.000Z",
  };

  const merged = mergeConversationMessages([userMessage], [assistantMessage], "conversation-1");

  assert.deepEqual(merged.map((message) => [message.role, message.content]), [
    ["user", "用户输入的 Agent 任务"],
    ["assistant", "Agent 返回结果"],
  ]);
});

test("conversation history does not leak messages from another conversation", () => {
  const current: WorkbenchMessage[] = [{
    id: "other-message",
    conversationId: "conversation-2",
    role: "user" as const,
    content: "另一个会话",
    createdAt: "2026-08-21T15:00:00.000Z",
  }];

  assert.deepEqual(mergeConversationMessages(current, [], "conversation-1"), []);
});

test("conversation history orders a user message before an assistant message with the same timestamp", () => {
  const userMessage: WorkbenchMessage = {
    id: "user-same-time",
    conversationId: "conversation-1",
    role: "user" as const,
    content: "用户问题",
    createdAt: "2026-08-21T15:00:00.000Z",
  };
  const assistantMessage: WorkbenchMessage = {
    id: "assistant-same-time",
    conversationId: "conversation-1",
    role: "assistant" as const,
    content: "助手回答",
    createdAt: "2026-08-21T15:00:00.000Z",
  };

  const merged = mergeConversationMessages([assistantMessage], [userMessage], "conversation-1");

  assert.deepEqual(merged.map((message) => message.role), ["user", "assistant"]);
});

test("conversation history keeps valid chronological order when loaded rows arrive out of order", () => {
  const messages: WorkbenchMessage[] = [
    { id: "assistant-later", conversationId: "conversation-1", role: "assistant", content: "later", createdAt: "2026-08-21T15:00:02.000Z" },
    { id: "user-earlier", conversationId: "conversation-1", role: "user", content: "earlier", createdAt: "2026-08-21T15:00:01.000Z" },
  ];

  const merged = mergeConversationMessages([], messages, "conversation-1");

  assert.deepEqual(merged.map((message) => message.id), ["user-earlier", "assistant-later"]);
});

test("conversation history preserves multiple same-timestamp turns instead of grouping all users first", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const messages: WorkbenchMessage[] = [
    { id: "user-turn-1", conversationId: "conversation-1", role: "user", content: "问题一", createdAt },
    { id: "assistant-turn-1", conversationId: "conversation-1", role: "assistant", content: "回答一", createdAt },
    { id: "user-turn-2", conversationId: "conversation-1", role: "user", content: "问题二", createdAt },
    { id: "assistant-turn-2", conversationId: "conversation-1", role: "assistant", content: "回答二", createdAt },
  ];

  const merged = mergeConversationMessages([], messages, "conversation-1");

  assert.deepEqual(merged.map((message) => message.id), messages.map((message) => message.id));
});

test("conversation history keeps a restored answer after its optimistic user turn when timestamps collide", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const loaded: WorkbenchMessage[] = [
    { id: "message-first", conversationId: "conversation-1", role: "user", content: "第一个问题", createdAt },
    { id: "assistant-first", conversationId: "conversation-1", role: "assistant", content: "第一个回答", createdAt },
    { id: "assistant-second", conversationId: "conversation-1", role: "assistant", content: "第二个回答", createdAt },
  ];
  const optimistic: WorkbenchMessage[] = [
    { id: "message-second", conversationId: "conversation-1", role: "user", content: "第二个问题", createdAt },
  ];

  const merged = mergeConversationMessages(optimistic, loaded, "conversation-1");

  assert.deepEqual(merged.map((message) => message.id), ["message-first", "assistant-first", "message-second", "assistant-second"]);
});

test("history reload replaces a stale in-memory order for persisted messages", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const user = { id: "reload-user", conversationId: "conversation-1", role: "user" as const, content: "用户问题", createdAt };
  const assistant = { id: "reload-assistant", conversationId: "conversation-1", role: "assistant" as const, content: "AI 回复", createdAt };

  const merged = mergeConversationMessages([assistant, user], [user, assistant], "conversation-1");

  assert.deepEqual(merged.map((message) => message.id), ["reload-user", "reload-assistant"]);
});

test("live UI message merging preserves multiple same-timestamp turns", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const messages = [
    createDesktopUIMessage({ id: "ui-user-1", role: "user", conversationId: "conversation-1", content: "问题一", createdAt }),
    createDesktopUIMessage({ id: "ui-assistant-1", role: "assistant", conversationId: "conversation-1", content: "回答一", createdAt }),
    createDesktopUIMessage({ id: "ui-user-2", role: "user", conversationId: "conversation-1", content: "问题二", createdAt }),
    createDesktopUIMessage({ id: "ui-assistant-2", role: "assistant", conversationId: "conversation-1", content: "回答二", createdAt }),
  ];

  const merged = mergeDesktopUIMessageViews(messages, []);

  assert.deepEqual(merged.map((message) => message.id), messages.map((message) => message.id));
});

test("live UI merging keeps a streaming answer with the user message from its run after a session switch", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const displayed = [
    createDesktopUIMessage({ id: "message-first", role: "user", conversationId: "conversation-1", content: "第一个问题", createdAt }),
    createDesktopUIMessage({ id: "assistant-first", role: "assistant", conversationId: "conversation-1", content: "第一个回答", createdAt }),
    createDesktopUIMessage({ id: "assistant-second", role: "assistant", conversationId: "conversation-1", runId: "second", content: "正在生成", createdAt }),
  ];
  const live = [createDesktopUIMessage({ id: "message-second", role: "user", conversationId: "conversation-1", runId: "second", content: "第二个问题", createdAt })];

  const merged = mergeDesktopUIMessageViews(displayed, live, "assistant-second");

  assert.deepEqual(merged.map((message) => message.id), ["message-first", "assistant-first", "message-second", "assistant-second"]);
});

test("rendered UI messages keep the user text when the live SDK view has an empty user part", () => {
  const displayed = [createDesktopUIMessage({ id: "user-visible", role: "user", conversationId: "conversation-1", content: "用户输入内容", createdAt: "2026-08-21T15:00:00.000Z" })];
  const live = [{ ...displayed[0], parts: [] }];

  const merged = mergeDesktopUIMessageViews(displayed, live);

  assert.equal(desktopUIMessageText(merged[0]), "用户输入内容");
});

test("message view merging patches stable parts without discarding displayed-only entities", () => {
  const base = createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", createdAt: "2026-08-21T15:00:00.000Z" });
  const displayed = [{
    ...base,
    parts: [
      { type: "text" as const, text: "工具前", state: "done" as const, providerMetadata: { coworkany: { partId: "text:1" } } },
      { type: "data-artifact" as const, id: "artifact:report", data: { id: "report", title: "报告", relativePath: "report.md", mimeType: "text/markdown", byteLength: 10, sha256: "abc" } },
    ],
  }];
  const live = [{
    ...base,
    parts: [
      { type: "text" as const, text: "工具前（已完成）", state: "done" as const, providerMetadata: { coworkany: { partId: "text:1" } } },
      { type: "dynamic-tool" as const, toolName: "search", toolCallId: "search-1", state: "output-available" as const, input: { query: "AI" }, output: { count: 1 } },
    ],
  }];

  const merged = mergeDesktopUIMessageViews(displayed, live);

  assert.deepEqual(merged[0]?.parts.map((part) => part.type), ["text", "data-artifact", "dynamic-tool"]);
  assert.equal(desktopUIMessageText(merged[0]!), "工具前（已完成）");
});

test("rendered UI messages do not append an empty live user bubble", () => {
  const displayed = [createDesktopUIMessage({ id: "assistant-visible", role: "assistant", conversationId: "conversation-1", content: "助手回复", createdAt: "2026-08-21T15:00:01.000Z" })];
  const live = [{ id: "sdk-empty-user", role: "user" as const, parts: [], metadata: { conversationId: "conversation-1", createdAt: "2026-08-21T15:00:02.000Z", updatedAt: "2026-08-21T15:00:02.000Z" } }];

  const merged = mergeDesktopUIMessageViews(displayed, live);

  assert.deepEqual(merged.map((message) => message.id), ["assistant-visible"]);
});

test("rendered UI messages keep a live user turn before the active assistant view", () => {
  const user = createDesktopUIMessage({ id: "live-user", role: "user", conversationId: "conversation-1", content: "继续生成 PPT", createdAt: "2026-08-21T15:00:00.000Z" });
  const liveAssistant = createDesktopUIMessage({ id: "live-assistant", role: "assistant", conversationId: "conversation-1", content: "正在生成", createdAt: "2026-08-21T15:00:01.000Z" });
  const activeAssistant = createDesktopUIMessage({ id: "active-assistant", role: "assistant", conversationId: "conversation-1", content: "正在生成", createdAt: "2026-08-21T15:00:00.000Z" });

  const merged = mergeDesktopUIMessageViews([activeAssistant], [user, liveAssistant]);

  assert.deepEqual(merged.map((message) => [message.role, desktopUIMessageText(message)]), [
    ["user", "继续生成 PPT"],
    ["assistant", "正在生成"],
  ]);
  assert.equal(merged[1]?.id, "active-assistant");
});
