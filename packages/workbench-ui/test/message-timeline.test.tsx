import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkbenchMessage } from "@coworkany/workbench-client";
import { formatWorkbenchMessageTimestamp, WorkbenchMessageTimeline } from "../src/index";
import { Conversation, ConversationContent, ConversationScrollButton } from "../src/ai-elements/index";

test("conversation uses the official stick-to-bottom composition", () => {
  const markup = renderToStaticMarkup(<Conversation><ConversationContent><span>消息</span></ConversationContent><ConversationScrollButton aria-label="滚动到最新消息" title="滚动到最新消息" /></Conversation>);
  assert.match(markup, /data-slot="conversation"/);
  assert.match(markup, /data-slot="conversation-content"/);
  assert.match(markup, /class="ai-elements-conversation-viewport"/);
  assert.doesNotMatch(markup, /<button[^>]*data-slot="conversation-scroll-button"/);
});

test("shared message timeline renders stable ordered timestamps and accessible actions", () => {
  const messages: WorkbenchMessage[] = [{
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: "分析完成",
    createdAt: "2026-08-12T00:00:00Z",
    status: "succeeded",
    parts: [
      { id: "text-1", type: "text", text: "分析完成" },
      { id: "tool-1", type: "tool", tool: "writer", status: "completed", message: "写作完成", sequence: 2, createdAt: "2026-08-12T00:00:02Z" },
      { id: "artifact-1", type: "artifact", artifact: { id: "a1", relativePath: "artifacts/report.md", title: "分析报告", mimeType: "text/markdown", byteLength: 16, sha256: "hash-a" }, sequence: 3, createdAt: "2026-08-12T00:00:03Z" },
    ],
  }];

  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={messages} locale="en" onArtifactOpen={() => undefined} onCopy={() => undefined} />);
  assert.match(markup, /<time dateTime="2026-08-12T00:00:00Z"/);
  assert.match(markup, /<time dateTime="2026-08-12T00:00:02Z"/);
  assert.match(markup, /data-sequence="2"/);
  assert.match(markup, /data-sequence="3"/);
  assert.ok(markup.indexOf('data-sequence="2"') < markup.indexOf('data-sequence="3"'));
  assert.match(markup, /aria-label="Copy reply"/);
  assert.match(markup, /data-slot="message"[^>]*data-message-role="assistant"/);
  assert.match(markup, /data-slot="message-content"/);
  assert.match(markup, /data-slot="message-actions"/);
  assert.match(markup, /data-slot="message-toolbar"/);
  assert.match(markup, /aria-label="Open artifact: 分析报告"/);
  assert.match(markup, /data-status="completed"/);
});

test("message timeline renders the full local creation timestamp", () => {
  const createdAt = "2026-08-12T00:00:00Z";
  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={[{
    id: "assistant-timestamp",
    conversationId: "conversation-1",
    role: "assistant",
    content: "回答",
    createdAt,
  }]} locale="zh" />);

  assert.match(markup, new RegExp(`<time dateTime="${createdAt}"[^>]*title="创建时间（本地时区）">${formatWorkbenchMessageTimestamp(createdAt, "zh")}</time>`));
});

test("shared message timeline omits copy controls when copying is not configured", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={[{
    id: "assistant-without-copy",
    conversationId: "conversation-1",
    role: "assistant",
    content: "answer",
    createdAt: "2026-08-12T00:00:00Z",
  }]} locale="en" />);
  assert.doesNotMatch(markup, /data-slot="message-toolbar"/);
  assert.doesNotMatch(markup, /data-slot="message-actions"/);
});

test("user timeline messages keep their high-contrast body class", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={[{
    id: "user-message-1",
    conversationId: "conversation-1",
    role: "user",
    content: "请生成一份营销方案\n\n- 包含 `关键词`",
    createdAt: "2026-08-12T00:00:00Z",
  }]} locale="zh" />);

  assert.match(markup, /wb-chat-user-body/);
  assert.match(markup, /data-slot="message"[^>]*data-message-role="user"/);
  assert.doesNotMatch(markup, /assistant-body/);
  assert.match(markup, /wb-chat-user-header/);
});

test("user timeline preserves Markdown-looking input as plain text", () => {
  const content = "# 用户输入\n\n**原样保留**\n\n---";
  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={[{
    id: "user-plain-timeline",
    conversationId: "conversation-1",
    role: "user",
    content,
    createdAt: "2026-08-12T00:00:00Z",
  }]} locale="zh" />);

  assert.match(markup, /data-message-text-mode="plain"/);
  assert.match(markup, /# 用户输入\n\n\*\*原样保留\*\*\n\n---/u);
  assert.doesNotMatch(markup, /<h1|data-streamdown="strong"|<hr/);
});

test("assistant timelines preserve interleaved process, text, sources, and results", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageTimeline messages={[{
    id: "rich-message-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: "已完成研究并生成报告。",
    createdAt: "2026-08-12T00:00:00Z",
    status: "succeeded",
    parts: [
      { id: "tool-1", type: "tool", tool: "web_search", status: "completed", message: "找到 3 个来源", sequence: 1 },
      { id: "usage-1", type: "usage", usage: { runId: "run-1", model: "deepseek-v4", inputTokens: 120, outputTokens: 80 }, sequence: 2 },
      { id: "text-1", type: "text", text: "已完成研究并生成报告。", sequence: 3 },
      { id: "source-1", type: "source", title: "市场研究", href: "https://example.com/research", excerpt: "关键洞察" , sequence: 4 },
      { id: "report-1", type: "report", title: "执行摘要", body: "**可执行结论**", sequence: 5 },
    ],
  }]} locale="zh" />);

  assert.match(markup, /120 \+ 80/);
  assert.match(markup, /执行摘要/);
  assert.match(markup, /data-message-order="chronological"/);
  assert.doesNotMatch(markup, /wb-message-process|wb-message-results/);
  const markers = ["web_search", "120 + 80", "已完成研究并生成报告。", "市场研究", "执行摘要"];
  const positions = markers.map((marker) => markup.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});
