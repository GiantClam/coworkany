import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatWorkbenchMessageTimestamp, MessageAction, WorkbenchMessageSurface } from "../src/index";
import { createDesktopUIMessage, type DesktopUIMessage } from "@coworkany/workbench-client";

const workbenchStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("renders UIMessage roles, streaming process and structured output in one surface", () => {
  const user = createDesktopUIMessage({ id: "user-1", role: "user", conversationId: "conversation-1", content: "生成一张图" });
  const assistant: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-1", role: "assistant", conversationId: "conversation-1", runId: "run-1", modelId: "grok" }),
    parts: [
       { type: "text", text: "结果已准备", state: "streaming" },
       { type: "data-status", id: "status:run", data: { status: "running" } },
       { type: "data-artifact", id: "artifact:1", data: { id: "artifact-1", relativePath: "assets/result.png", title: "result.png", mimeType: "image/png", byteLength: 10, sha256: "hash" } },
       { type: "reasoning", text: "正在规划", state: "streaming" },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[user, assistant]} pendingMessageId="assistant-1" locale="zh" onCopy={() => undefined} onRetry={() => undefined} onArtifactOpen={() => undefined} onArtifactDownload={() => undefined} />);
  assert.match(markup, /data-uimessage-surface="true"/);
  assert.match(markup, /data-message-role="user"/);
  assert.match(markup, /执行过程/);
  assert.match(markup, /结果已准备/);
  assert.match(markup, /result\.png/);
  assert.match(markup, /data-slot="reasoning"[^>]*aria-busy="true"/);
  assert.match(markup, /data-slot="reasoning-content"[^>]*aria-live="polite"/);
  assert.doesNotMatch(markup, /任务状态|Task status/);
  assert.match(markup, /data-sd-animate/);
});

test("keeps empty state inside the conversation surface", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[]} locale="en" />);
  assert.match(markup, /Start a new conversation/);
});

test("shows an AI Elements pending process before the assistant response arrives", () => {
  const user = createDesktopUIMessage({ id: "user-pending", role: "user", conversationId: "conversation-1", content: "开始执行" });
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[user]} pendingMessageId="pending-assistant" locale="zh" />);
  assert.match(markup, /data-message-id="pending-assistant"/);
  assert.match(markup, /data-message-group="execution-process"/);
  assert.match(markup, /data-slot="reasoning"[^>]*aria-busy="true"/);
  assert.match(markup, /data-slot="reasoning-trigger"/);
  assert.match(markup, /data-slot="reasoning-content"/);
  assert.match(markup, /正在等待模型响应…/);
  assert.match(markup, /ai-elements-shimmer/);
});

test("does not append a second pending assistant after a live assistant arrives", () => {
  const user = createDesktopUIMessage({ id: "user-live", role: "user", conversationId: "conversation-1", content: "开始执行" });
  const assistant: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "sdk-assistant-live", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "reasoning", text: "正在处理", state: "streaming" }],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[user, assistant]} pendingMessageId="active-assistant" locale="zh" />);
  assert.equal((markup.match(/data-message-id="active-assistant"/g) ?? []).length, 0);
  assert.match(markup, /data-message-id="sdk-assistant-live"/);
  assert.match(markup, /正在处理/);
  assert.match(markup, /data-slot="reasoning"[^>]*aria-busy="true"/);
});

test("renders source citations, reports and media output slots", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-rich", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "source-url", sourceId: "source-1", url: "https://example.com/reference", title: "Reference" },
      { type: "data-report", id: "report-1", data: { title: "Generated report", body: "# Summary" } },
      { type: "data-media", id: "media-1", data: { artifactId: "artifact-1", kind: "image", mimeType: "image/png", title: "Preview", relativePath: "assets/preview.png", previewable: true } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" onMediaOpen={() => undefined} />);
  assert.match(markup, /已使用 1 个来源|Used 1 sources/);
  assert.match(markup, /data-state="closed"/);
  assert.match(markup, /Generated report/);
  assert.match(markup, /data-language="markdown"/);
  assert.match(markup, /assets\/preview\.png/);
});

test("uses the host media resolver for local artifact previews instead of a raw relative URL", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-local-media", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "data-media", id: "media-local", data: { artifactId: "artifact-local", kind: "image", mimeType: "image/png", title: "Local preview", relativePath: "artifacts/run/image.png", previewable: true } }],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" resolveMediaSource={async () => ({ url: "blob:artifact-local" })} />);
  assert.match(markup, /data-media-preview-state="loading"/);
  assert.doesNotMatch(markup, /src="artifacts\/run\/image\.png"/);
});

test("keeps non-media artifacts visible with a typed preview shell", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-document-artifact", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "data-artifact", id: "artifact-markdown", data: { id: "artifact-markdown", relativePath: "artifacts/brief.md", title: "brief.md", mimeType: "text/markdown", byteLength: 42, sha256: "hash" } },
      { type: "data-artifact", id: "artifact-pdf", data: { id: "artifact-pdf", relativePath: "artifacts/brief.pdf", title: "brief.pdf", mimeType: "application/pdf", byteLength: 42, sha256: "hash" } },
      { type: "data-artifact", id: "artifact-docx", data: { id: "artifact-docx", relativePath: "artifacts/brief.docx", title: "brief.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteLength: 42, sha256: "hash" } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
  assert.match(markup, /data-artifact-preview-kind="markdown"/);
  assert.match(markup, /data-artifact-preview-kind="pdf"/);
  assert.match(markup, /data-artifact-preview-kind="file"/);
  assert.match(markup, /Markdown 文档/);
  assert.match(markup, /PDF 文档/);
  assert.match(markup, /文件 · application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
});

test("shows an artifact filename without exposing its workspace-relative path", () => {
  const relativePath = "artifacts/0ce5abba-23c4-4b22-9360-76bb6757fcb5/capability/image_generate-1-fe71e80f1563.png";
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-path-artifact", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "data-artifact", id: "artifact-path", data: { id: "artifact-path", relativePath, title: relativePath, mimeType: "image/png", byteLength: 42, sha256: "hash" } }],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" resolveMediaSource={async () => ({ url: "blob:artifact-path" })} />);
  assert.match(markup, /image_generate-1-fe71e80f1563\.png/);
  assert.doesNotMatch(markup, /artifacts\/0ce5abba-23c4-4b22-9360-76bb6757fcb5\/capability\//);
  assert.doesNotMatch(markup, /class="wb-ai-artifact-name"/);
});

test("keeps image artifacts free of duplicate media action buttons", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-image-artifact-actions", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "data-artifact", id: "artifact-image-actions", data: { id: "artifact-image-actions", relativePath: "artifacts/run/image.png", title: "artifacts/run/image.png", mimeType: "image/png", byteLength: 42, sha256: "hash" } }],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
  assert.match(markup, /<button type="button" class="wb-ai-media-preview"/);
  assert.doesNotMatch(markup, /wb-ai-media-actions/);
});

test("renders video and audio media with native playback and artifact actions", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-media", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "data-media", id: "media-video", data: { artifactId: "video-1", kind: "video", mimeType: "video/mp4", title: "Demo video", relativePath: "assets/demo.mp4", previewable: true } },
      { type: "data-media", id: "media-audio", data: { artifactId: "audio-1", kind: "audio", mimeType: "audio/mpeg", title: "Demo audio", relativePath: "assets/demo.mp3", previewable: true } },
    ],
  };
  const downloaded: string[] = [];
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" onArtifactDownload={(id) => downloaded.push(id)} />);
  assert.match(markup, /<video[^>]+controls/);
  assert.match(markup, /assets\/demo\.mp4/);
  assert.match(markup, /<audio[^>]+controls/);
  assert.match(markup, /Demo audio/);
  assert.match(markup, /data-slot="media-results"/);
  assert.deepEqual(downloaded, []);
});

test("keeps user messages compact and assistant messages full width", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "user-geometry", role: "user", conversationId: "conversation-1", content: "question" }),
    createDesktopUIMessage({ id: "assistant-geometry", role: "assistant", conversationId: "conversation-1", content: "answer" }),
  ]} />);
  assert.match(markup, /class="[^"]*ai-elements-message-user[^"]*"/);
  assert.match(markup, /class="[^"]*ai-elements-message-assistant[^"]*"/);
  assert.match(markup, /data-uimessage-surface="true"/);
});

test("groups messages into question-and-answer turns with role avatars", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "user-turn-1", role: "user", conversationId: "conversation-1", content: "first question", createdAt: "2026-08-21T15:00:00.000Z" }),
    createDesktopUIMessage({ id: "assistant-turn-1", role: "assistant", conversationId: "conversation-1", content: "first answer", createdAt: "2026-08-21T15:00:01.000Z" }),
    createDesktopUIMessage({ id: "user-turn-2", role: "user", conversationId: "conversation-1", content: "second question", createdAt: "2026-08-21T15:00:02.000Z" }),
    createDesktopUIMessage({ id: "assistant-turn-2", role: "assistant", conversationId: "conversation-1", content: "second answer", createdAt: "2026-08-21T15:00:03.000Z" }),
  ]} locale="zh" />);
  assert.equal((markup.match(/data-message-turn-id=/g) ?? []).length, 2);
  assert.match(markup, /class="[^"]*wb-ai-role-avatar-assistant[^"]*"[^>]*aria-label="AI"/);
  assert.match(markup, /class="[^"]*wb-ai-role-avatar-user[^"]*"[^>]*aria-label="用户"/);
  assert.ok(markup.indexOf("first question") < markup.indexOf("first answer"));
  assert.ok(markup.indexOf("first answer") < markup.indexOf("second question"));
});

test("keeps an equal-timestamp streaming reply in the same causal turn after a session switch", () => {
  const createdAt = "2026-08-21T15:00:00.000Z";
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "message-first", role: "user", conversationId: "conversation-1", content: "第一个问题", createdAt }),
    createDesktopUIMessage({ id: "assistant-first", role: "assistant", conversationId: "conversation-1", content: "第一个回答", createdAt }),
    createDesktopUIMessage({ id: "assistant-second", role: "assistant", conversationId: "conversation-1", runId: "second", content: "正在生成", createdAt }),
    createDesktopUIMessage({ id: "message-second", role: "user", conversationId: "conversation-1", runId: "second", content: "第二个问题", createdAt }),
  ]} locale="zh" />);

  assert.ok(markup.indexOf("第一个问题") < markup.indexOf("第一个回答"));
  assert.ok(markup.indexOf("第一个回答") < markup.indexOf("第二个问题"));
  assert.ok(markup.indexOf("第二个问题") < markup.indexOf("正在生成"));
});

test("shows each message creation timestamp in the local time zone", () => {
  const createdAt = "2026-08-12T00:00:00Z";
  const expectedTimestamp = formatWorkbenchMessageTimestamp(createdAt, "zh");
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "user-timestamp", role: "user", conversationId: "conversation-1", content: "问题", createdAt }),
    createDesktopUIMessage({ id: "assistant-timestamp", role: "assistant", conversationId: "conversation-1", content: "回答", createdAt: "2026-08-12T00:00:01Z" }),
  ]} locale="zh" />);

  assert.equal((markup.match(/data-message-created-at=/g) ?? []).length, 2);
  assert.match(markup, /<time[^>]+dateTime="2026-08-12T00:00:00Z"[^>]+aria-label="创建时间（本地时区）:/u);
  assert.match(markup, /<time[^>]+dateTime="2026-08-12T00:00:01Z"[^>]+aria-label="创建时间（本地时区）:/u);
  assert.ok(markup.includes(expectedTimestamp));
});

test("orders a delayed assistant message after its user message before grouping turns", () => {
  const user = createDesktopUIMessage({ id: "user-delayed", role: "user", conversationId: "conversation-1", content: "用户问题", createdAt: "2026-08-21T15:00:00.000Z" });
  const assistant = createDesktopUIMessage({ id: "assistant-delayed", role: "assistant", conversationId: "conversation-1", content: "助手回答", createdAt: "2026-08-21T15:00:01.000Z" });
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[assistant, user]} locale="zh" />);

  assert.ok(markup.indexOf("用户问题") < markup.indexOf("助手回答"));
  assert.ok(markup.indexOf('data-message-id="user-delayed"') < markup.indexOf('data-message-id="assistant-delayed"'));
});

test("keeps ordinary chat turns on the native AI Elements message composition", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "user-native", role: "user", conversationId: "conversation-1", content: "question" }),
    createDesktopUIMessage({ id: "assistant-native", role: "assistant", conversationId: "conversation-1", content: "answer" }),
  ]} />);
  assert.match(markup, /class="[^"]*ai-elements-message-turn wb-ai-message-turn[^"]*"/);
  assert.doesNotMatch(markup, /data-slot="branch-messages"/);
  assert.doesNotMatch(markup, /data-slot="message-branch-content"/);
  assert.match(markup, /data-slot="message"[^>]*data-message-role="user"/);
  assert.match(markup, /data-slot="message"[^>]*data-message-role="assistant"/);
});

test("does not reserve an empty action toolbar for messages without actions", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "user-no-actions", role: "user", conversationId: "conversation-1", content: "question" }),
    createDesktopUIMessage({ id: "assistant-no-actions", role: "assistant", conversationId: "conversation-1", content: "answer" }),
  ]} />);
  assert.doesNotMatch(markup, /data-slot="message-toolbar"/);
  assert.doesNotMatch(markup, /data-slot="message-actions"/);
});

test("keeps the chat surface and message article free of legacy card geometry", () => {
  assert.match(workbenchStyles, /\.wb-ai-message-surface\s*\{[^}]*border:\s*0/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message\s*\{[^}]*display:\s*block/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message\s*\{[^}]*gap:\s*0/s);
});

test("keeps execution details visually subordinate to the answer", () => {
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message-execution > \.wb-ai-process\s*\{[\s\S]*background:\s*transparent;/);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message-execution > \.wb-ai-process\s*\{[\s\S]*box-shadow:\s*none;/);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message-execution > \.wb-ai-task\[data-status="running"\]\s*\{[\s\S]*background:/);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message-execution > \.wb-ai-task\[data-status="failed"\][\s\S]*background:/);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message-execution \.ai-elements-reasoning-content\s*\{[\s\S]*font-size:\s*\.72rem/);
});

test("uses AI Elements message slots for execution, output and actions", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-stream", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "thinking", state: "streaming" },
      { type: "text", text: "streamed answer", state: "streaming" },
      { type: "data-status", id: "status:stream", data: { status: "running", message: "Working" } },
      { type: "dynamic-tool", toolName: "webfetch", toolCallId: "tool-1", state: "output-available", input: { url: "https://example.com" }, output: "ok" },
    ],
  }]} pendingMessageId="assistant-stream" locale="en" onCopy={() => undefined} onRetry={() => undefined} />);
  assert.match(markup, /data-slot="message-group"/);
  assert.match(markup, /data-message-group="execution-process"/);
  assert.doesNotMatch(markup, /class="[^"]*ai-elements-task[^"]*"/);
  assert.doesNotMatch(markup, /wb-ai-run-status/);
  assert.match(markup, /data-slot="message-output"/);
  assert.match(markup, /data-slot="message-actions"/);
  assert.match(markup, /data-streaming="true"/);
  assert.match(markup, /Copy message/);
  assert.match(markup, /aria-label="Retry"/);
  assert.match(markup, /data-slot="tool-header"/);
  assert.match(markup, /data-tool-name="webfetch"/);
  assert.match(markup, /data-state="closed"[^>]*data-status="completed"[^>]*data-slot="tool"/);
  assert.equal((markup.match(/data-slot="tool"/g) ?? []).length, 1);
  assert.match(markup, /Completed/);
  assert.match(markup, /data-slot="tool-content"/);
  assert.ok(markup.indexOf('data-message-group="execution-process"') < markup.indexOf('data-slot="message-output"'));
});

test("consolidates streamed reasoning fragments into one collapsible process", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-reasoning-fragments", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "先确认目标", state: "done" },
      { type: "reasoning", text: "再检查约束", state: "done" },
      { type: "text", text: "结论", state: "done" },
    ],
  }]} locale="zh" />);

  assert.equal((markup.match(/data-slot="reasoning"/g) ?? []).length, 1);
  assert.equal((markup.match(/>推理过程</g) ?? []).length, 1);
  assert.match(markup, /data-slot="reasoning-content"/);
  assert.doesNotMatch(markup, /先确认目标\n\n再检查约束/u);
  assert.match(markup, /data-status="completed"/);
});

test("allows feature actions to share the native message action bar", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface
    messages={[createDesktopUIMessage({ id: "assistant-feature-actions", role: "assistant", conversationId: "conversation-1", content: "answer" })]}
    locale="en"
    renderAssistantActions={() => <MessageAction label="Preview" title="Preview">P</MessageAction>}
  />);

  const actions = markup.match(/<div class="ai-elements-message-actions"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(actions, /aria-label="Preview"/);
  assert.match(actions, /title="Preview"/);
});

test("keeps reasoning out of the message body while exposing it in execution process", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-body-boundary", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "private thinking", state: "done" },
      { type: "text", text: "public answer", state: "done" },
    ],
  }]} locale="en" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(markup, /data-slot="reasoning"/);
  assert.match(output, /public answer/);
  assert.doesNotMatch(output, /private thinking/);
});

test("renders assistant Markdown as semantic elements in the message body", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-markdown", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "# 销售策略\n\n**核心建议**\n\n- 聚焦重点客户\n- 明确下一步\n\n| 优先级 | 动作 |\n| --- | --- |\n| 高 | 本周跟进 |", state: "done" }],
  }]} locale="zh" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(output, /<h1[^>]*>销售策略<\/h1>/);
  assert.match(output, /<span[^>]+data-streamdown="strong"[^>]*>核心建议<\/span>/);
  assert.match(output, /<ul[^>]*>[\s\S]*<li[^>]*>聚焦重点客户<\/li>/);
  assert.match(output, /data-streamdown="table-wrapper"/);
  assert.doesNotMatch(output, /# 销售策略|\*\*核心建议\*\*/);
});

test("renders user text exactly as entered instead of interpreting it as Markdown", () => {
  const content = "# 输入标题\n\n**不要解析**\n\n---";
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "user-plain-text", role: "user", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: content, state: "done" }],
  }]} locale="zh" />);
  const row = markup.match(/data-message-id="user-plain-text"[\s\S]*?<\/div>\s*<\/section>/)?.[0] ?? markup;
  assert.match(row, /data-message-text-mode="plain"/);
  assert.match(row, /# 输入标题\n\n\*\*不要解析\*\*\n\n---/u);
  assert.doesNotMatch(row, /<h1|data-streamdown="strong"|<hr/);
});

test("renders thematic breaks and headings when Markdown block boundaries are valid", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-valid-block-markdown", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "结论\n\n---\n\n### 下一步\n\n继续验证。", state: "done" }],
  }]} locale="zh" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(output, /<hr[^>]*>/);
  assert.match(output, /<h3[^>]*>下一步<\/h3>/);
  assert.doesNotMatch(output, /---###/u);
});

test("renders standard Chinese Markdown emphasis and section spacing", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-collapsed-markdown", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "正确——用单页模板验证付费需求。给你一个框架：\n\n**验证目标只盯一个数字：付费转化率。**\n\n用统一的价格和文案。\n\n**单页结构照此设计**：首屏效果→价格支付。\n\n**预算与判定标准**：先跑小额预算。", state: "done" }],
  }]} locale="zh" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(output, /data-streamdown="strong"[^>]*>验证目标只盯一个数字：付费转化率。<\/span>/);
  assert.match(output, /data-streamdown="strong"[^>]*>单页结构照此设计<\/span>/);
  assert.match(output, /<p>[\s\S]*验证目标[\s\S]*<\/p>[\s\S]*<p>[\s\S]*单页结构[\s\S]*<\/p>/);
  assert.doesNotMatch(output, /\*\*验证|付费率。\*\*用统一/u);
});

test("renders standard Markdown emphasis across non-Chinese scripts", () => {
  for (const [locale, content] of [
    ["en", "Summary:\n\n**Conversion target: paid rate.**\n\nUse one price.\n\n**Landing page structure**: show the result first."],
    ["ko", "결론:\n\n**검증 목표: 유료 전환율.**\n\n통일된 가격을 사용합니다.\n\n**페이지 구조**: 결과를 먼저 보여줍니다."],
    ["ja", "結論：\n\n**検証目標：有料率。**\n\n統一価格を使う。\n\n**ページ構成**: 結果を先に表示。"],
  ] as const) {
    const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
      ...createDesktopUIMessage({ id: `assistant-${locale}-collapsed-markdown`, role: "assistant", conversationId: "conversation-1" }),
      parts: [{ type: "text", text: content, state: "done" }],
    }]} locale={locale === "en" ? "en" : "zh"} />);
    const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    assert.equal((output.match(/data-streamdown="strong"/g) ?? []).length, 2, locale);
    assert.doesNotMatch(output, /\*\*/u, locale);
  }
});

test("renders standard emphasis and numbered clauses", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-punctuation-markdown", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "规划清楚：\n\n**只看这个核心数字（按日，5天后看累计）**：\n\n1. **点击到首屏加载的转化率**——低于40%。\n2. **落地页到点击开始的动作率**——低于15%。\n3. **付费转化率**——合格线定在1.5%~3%。", state: "done" }],
  }]} locale="zh" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal((output.match(/data-streamdown="strong"/g) ?? []).length, 4);
  assert.match(output, /<ol[^>]*>[\s\S]*<li[^>]*>[\s\S]*点击到首屏加载的转化率[\s\S]*<li[^>]*>[\s\S]*落地页到点击开始的动作率/);
  assert.doesNotMatch(output, /\*\*/u);
});

test("does not move text parts into reasoning based on language or wording", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-leaked-planning", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "The user asks me to use the local skill. Let me check it first.", state: "done" },
      { type: "text", text: "Theuserisaskingtolistthethreerisks.Letmeloadtheskillfirst.Nofilegenerationneeded.Giveaconciseanswer.审查时最需要关注的三项风险：1.付款与资金条款风险", state: "done" },
    ],
  }]} locale="zh" />);
  const output = markup.match(/<div class="wb-ai-message-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(output, /Theuserisaskingtolistthethreerisks\.Letmeloadtheskillfirst\.Nofilegenerationneeded\./u);
  assert.match(output, /付款与资金条款风险/);
});

test("renders an AI Elements confirmation for a blocked tool call", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-approval", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "tool-approval", state: "approval-requested", input: { command: "pwd" }, approval: { id: "permission-1", reason: "Run pwd" } }],
  }]} locale="en" />);
  assert.match(markup, /data-state="open"[^>]*data-status="waiting"[^>]*data-slot="tool"/);
  assert.match(markup, /data-slot="confirmation"/);
  assert.match(markup, /data-tool-name="bash"/);
  assert.match(markup, /Awaiting approval/);
  assert.match(markup, /data-slot="tool-content"/);
});

test("renders failed attachments with an explicit retry action", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-attachment-failed", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "data-attachment", id: "attachment-failed", data: { attachmentId: "attachment-failed", name: "broken.png", mediaType: "image/png", status: "failed", error: "Upload failed" } }],
  }]} locale="en" />);
  assert.match(markup, /broken\.png/);
  assert.match(markup, /is-failed/);
  assert.match(markup, /Retry attachment/);
});

test("renders workflow output and data attachments through native AI Elements primitives", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-workflow", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "data-attachment", id: "attachment-1", data: { attachmentId: "attachment-1", name: "brief.pdf", mediaType: "application/pdf", status: "ready" } },
      { type: "data-workflow", id: "workflow-1", data: { nodeId: "output", title: "Workflow output", status: "completed", output: { text: "Delivered" } } },
    ],
  }]} locale="en" />);
  assert.match(markup, /data-slot="attachments"/);
  assert.match(markup, /brief\.pdf/);
  assert.match(markup, /data-slot="message-group"/);
  assert.match(markup, /data-message-group="workflow-output"/);
  assert.match(markup, /Delivered/);
  assert.doesNotMatch(markup, /Some content is unavailable/);
});

test("keeps Streamdown code lines block-formatted and preserves code whitespace", () => {
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response pre > code > span\s*\{[^}]*display:\s*block/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response pre\s*\{[^}]*white-space:\s*pre/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response pre\s*\{[^}]*overflow-wrap:\s*normal/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response > div > p\s*\{[^}]*margin:\s*\.75rem 0/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response > div > :is\(h1, h2, h3, h4\)\s*\{[^}]*line-height:\s*1\.3/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response \[data-streamdown="code-block-body"\]\s*\{[^}]*overflow:\s*auto/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response pre\s*\{[^}]*font:\s*\.875rem\/1\.5/s);
});

test("preserves single line breaks in assistant Markdown prose without changing code blocks", () => {
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response > div > :is\(p, li, blockquote\)\s*\{[^}]*white-space:\s*pre-wrap/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response > div\s*\{[^}]*white-space:\s*normal/s);
  assert.match(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-response pre\s*\{[^}]*white-space:\s*pre/s);
});

test("restores semantic Markdown styles after Tailwind preflight", () => {
  assert.match(workbenchStyles, /\.ai-elements-message-response > div ul\s*\{[^}]*list-style-type:\s*disc/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div ol\s*\{[^}]*list-style-type:\s*decimal/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div > :is\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*font-weight:\s*700/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div blockquote\s*\{[^}]*border-left:/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div table\s*\{[^}]*border-collapse:\s*collapse/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div :not\(pre\) > code\s*\{[^}]*border:/s);
  assert.match(workbenchStyles, /\.ai-elements-message-response > div :is\(\[data-streamdown="strong"\], \.font-semibold, \.font-bold\)\s*\{[^}]*font-weight:\s*700/s);
});

test("enables Streamdown animation for streaming assistant Markdown", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-animated", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "Streaming response with several words", state: "streaming" }],
  }]} pendingMessageId="assistant-animated" locale="en" />);
  assert.match(markup, /data-sd-animate/);
  assert.match(workbenchStyles, /@keyframes sd-fadeIn/);
  assert.match(workbenchStyles, /\[data-sd-animate\]\s*\{[^}]*animation:/s);
});
