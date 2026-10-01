import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatWorkbenchMessageTimestamp, MessageAction, workbenchMessageActivityRevision, WorkbenchMessageSurface, WorkbenchPreview } from "../src/index";
import { createDesktopUIMessage, type DesktopUIMessage } from "@coworkany/workbench-client";

const workbenchStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("renders interleaved assistant parts in chronological DOM order", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-ordered", role: "assistant", conversationId: "conversation-ordered", runId: "run-ordered" }),
    parts: [
      { type: "reasoning", text: "ReasoningAlpha", state: "done" },
      { type: "text", text: "TextBeforeBeta", state: "done" },
      { type: "dynamic-tool", toolName: "ToolGamma", toolCallId: "tool-ordered", state: "output-available", input: { query: "order" }, output: "ok" },
      { type: "text", text: "TextAfterDelta", state: "done" },
      { type: "data-artifact", id: "artifact-ordered", data: { id: "artifact-ordered", relativePath: "artifacts/ArtifactEpsilon.md", title: "ArtifactEpsilon.md", mimeType: "text/markdown", byteLength: 12, sha256: "hash" } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" />);
  const positions = [markup.indexOf('data-process-kind="reasoning"'), ...["TextBeforeBeta", "ToolGamma", "TextAfterDelta", "ArtifactEpsilon.md"].map((marker) => markup.indexOf(marker))];
  assert.ok(positions.every((position) => position >= 0), JSON.stringify(positions));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test("changes the conversation revision for updates inside the same message", () => {
  const base = createDesktopUIMessage({ id: "assistant-revision", role: "assistant", conversationId: "conversation-revision", runId: "run-revision" });
  const first: DesktopUIMessage = { ...base, parts: [{ type: "text", text: "a", state: "streaming" }], metadata: { ...base.metadata, lastSequence: 1, runStatus: "running" } };
  const second: DesktopUIMessage = { ...first, parts: [{ type: "text", text: "ab", state: "streaming" }], metadata: { ...first.metadata, lastSequence: 2 } };
  assert.notEqual(workbenchMessageActivityRevision(first), workbenchMessageActivityRevision(second));
});

test("keeps a tool-only assistant turn visibly active and accessibly announced", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-tool-only", role: "assistant", conversationId: "conversation-tool-only", runId: "run-tool-only" }),
    parts: [{ type: "dynamic-tool", toolName: "search", toolCallId: "tool-only", state: "input-available", input: { query: "active state" } }],
    metadata: { conversationId: "conversation-tool-only", runId: "run-tool-only", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:01.000Z", lastSequence: 1, runStatus: "running" },
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} pendingMessageId={message.id} locale="en" />);
  assert.match(markup, /data-message-id="assistant-tool-only"[^>]*>[\s\S]*aria-busy="true"/);
  assert.match(markup, /role="status"[^>]*aria-live="polite"/);
  assert.match(markup, /Searching|Running tools/);
  assert.match(markup, /data-slot="tool-activity-group"/);
  assert.doesNotMatch(markup, /class="wb-ai-message-activity"/);
});

test("keeps one empty phase announcement outside busy messages in completed history", () => {
  const message = createDesktopUIMessage({ id: "assistant-completed-phase", role: "assistant", conversationId: "conversation-completed" });
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" />);
  const region = markup.match(/<span[^>]*data-phase-announcement="true"[^>]*>([\s\S]*?)<\/span>/);
  assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
  assert.ok(region, "phase announcement region is missing");
  assert.equal(region?.[1], "");
  assert.match(markup, /data-phase-announcement="true"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.equal(markup.slice(0, markup.indexOf('data-slot="message"')).includes('aria-busy="true"'), false);
  assert.doesNotMatch(markup, /class="wb-ai-message-activity"/);
});

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
  assert.match(markup, /结果已准备/);
  assert.match(markup, /result\.png/);
  assert.match(markup, /data-process-kind="reasoning"[^>]*data-status="running"[^>]*aria-busy="true"/);
  assert.doesNotMatch(markup, /data-slot="reasoning-content"[^>]*aria-live=/);
  assert.match(markup, /role="status" aria-live="polite"/);
  assert.ok(markup.indexOf("结果已准备") < markup.indexOf('data-slot="artifact-results"'));
  assert.ok(markup.indexOf('data-slot="artifact-results"') < markup.indexOf('data-process-id="reasoning:3"'));
  assert.doesNotMatch(markup, /任务状态|Task status/);
  assert.doesNotMatch(markup, /data-sd-animate/);
});

test("keeps empty state inside the conversation surface", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[]} locale="en" />);
  assert.match(markup, /Start a new conversation/);
});

test("shows one accessible waiting activity before the assistant response arrives", () => {
  const user = createDesktopUIMessage({ id: "user-pending", role: "user", conversationId: "conversation-1", content: "开始执行" });
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[user]} pendingMessageId="pending-assistant" locale="zh" />);
  assert.match(markup, /data-message-id="pending-assistant"/);
  assert.match(markup, /<div(?=[^>]*data-slot="message")(?=[^>]*data-message-status="running")(?=[^>]*aria-busy="true")[^>]*>/);
  assert.match(markup, /data-phase-announcement="true"[^>]*role="status" aria-live="polite"/);
  assert.match(markup, /data-phase-announcement="true"[^>]*aria-atomic="true"><\/span>/);
  assert.doesNotMatch(markup, /data-slot="reasoning"/);
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
  assert.match(markup, /data-process-id="reasoning:0"/);
  assert.match(markup, /data-process-kind="reasoning"[^>]*data-status="running"[^>]*aria-busy="true"/);
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

test("prefers one aggregated run metrics row over legacy usage parts", () => {
  const count = { total: 1, completed: 1, failed: 0, rejected: 0, running: 0, byName: [] };
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-metrics", role: "assistant", conversationId: "conversation-1", runId: "run-1" }),
    parts: [
      { type: "data-usage", id: "usage:u1", data: { runId: "run-1", usageId: "u1", model: "model-a", inputTokens: 4, outputTokens: 2 } },
      { type: "data-runMetrics", id: "run-metrics:run-1", data: { runId: "run-1", model: "model-a", modelTools: count, capabilities: { ...count, total: 0, completed: 0 }, tokens: { input: 4, output: 2 }, completeness: "complete" } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
  assert.equal((markup.match(/class="wb-run-metrics"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /ai-elements-context-trigger/);
  assert.match(markup, /工具 1/);
});

test("merges four legacy usage events into one token summary without a fabricated context percentage", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-legacy-usage", role: "assistant", conversationId: "conversation-1", runId: "run-1" }),
    parts: [
      { type: "text", text: "Completed answer", state: "done" },
      ...[[1200, 250], [3200, 500], [4000, 642], [300, 100]].map(([inputTokens, outputTokens], index): DesktopUIMessage["parts"][number] => ({
        type: "data-usage", id: `usage:step-${index}`, data: { runId: "run-1", model: "model-a", inputTokens, outputTokens },
      })),
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
  assert.equal((markup.match(/data-slot="usage-summary"/g) ?? []).length, 1);
  assert.match(markup, /10,192 Token/);
  assert.match(markup, /输入[\s\S]*?>8,700</);
  assert.match(markup, /输出[\s\S]*?>1,492</);
  assert.doesNotMatch(markup, /% used|context-trigger|<progress/);

  const pendingMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} pendingMessageId={message.id} locale="zh" />);
  assert.doesNotMatch(pendingMarkup, /data-slot="usage-summary"/);
});

test("does not count replayed usage twice and uses the latest run snapshot instead of summing snapshots and steps", () => {
  const usage = { runId: "run-1", usageId: "step-1", model: "model-a", inputTokens: 100, outputTokens: 20 };
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-usage-snapshots", role: "assistant", conversationId: "conversation-1", runId: "run-1" }),
    parts: [
      { type: "data-usage", id: "usage:original", data: usage },
      { type: "data-usage", id: "usage:replayed", data: usage },
    ],
  };
  const deltasMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" />);
  assert.match(deltasMarkup, /120 Token/);
  assert.equal((deltasMarkup.match(/data-slot="usage-summary"/g) ?? []).length, 1);

  // More than ten snapshots also verifies numeric part order is preserved.
  const snapshots: DesktopUIMessage["parts"] = Array.from({ length: 12 }, (_, index) => ({
    type: "data-usage", id: `usage:snapshot-${index}`, data: { ...usage, usageId: `snapshot-${index}`, inputTokens: 100 + index, outputTokens: 20 + index, aggregation: "snapshot", scope: "run" },
  }));
  const snapshotsMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{ ...message, parts: [...message.parts, ...snapshots] }]} locale="en" />);
  assert.match(snapshotsMarkup, /142 Token/);
  assert.match(snapshotsMarkup, /Input[\s\S]*?>111</);
  assert.match(snapshotsMarkup, /Output[\s\S]*?>31</);
  assert.doesNotMatch(snapshotsMarkup, /% used|<progress/);
});

test("keeps zero usage distinct from missing or invalid token counts in the legacy summary", () => {
  const base = createDesktopUIMessage({ id: "assistant-usage-availability", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const zero: DesktopUIMessage = { ...base, parts: [{ type: "data-usage", id: "usage:zero", data: { runId: "run-1", model: "model-a", inputTokens: 0 } }] };
  const zeroMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[zero]} locale="zh" />);
  assert.match(zeroMarkup, /0 Token/);
  assert.match(zeroMarkup, /输入[\s\S]*?>0</);
  assert.match(zeroMarkup, /输出[\s\S]*?>未提供</);

  const invalid: DesktopUIMessage = { ...base, parts: [{ type: "data-usage", id: "usage:invalid", data: { runId: "run-1", model: "model-a", inputTokens: -1, outputTokens: Number.NaN } }] };
  const invalidMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[invalid]} locale="en" />);
  assert.match(invalidMarkup, /Token unavailable/);
  assert.doesNotMatch(invalidMarkup, /NaN|% used|>0 Token</);
});

test("reveals run metrics only after the assistant turn completes", () => {
  const count = { total: 1, completed: 1, failed: 0, rejected: 0, running: 0, byName: [] };
  const base = createDesktopUIMessage({ id: "assistant-metrics-lifecycle", role: "assistant", conversationId: "conversation-1", runId: "run-1" });
  const parts: DesktopUIMessage["parts"] = [
    { type: "text", text: "结果", state: "streaming" },
    { type: "data-runMetrics", id: "run-metrics:run-1", data: { runId: "run-1", model: "model-a", modelTools: count, capabilities: { ...count, total: 0, completed: 0 }, tokens: { input: 4, output: 2 }, completeness: "complete" } },
  ];

  for (const runStatus of ["queued", "running", "waiting", "failed", "cancelled"] as const) {
    const message: DesktopUIMessage = { ...base, parts, metadata: { ...base.metadata, runStatus } };
    const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
    assert.doesNotMatch(markup, /class="wb-run-metrics"/, `${runStatus} turn exposed metrics`);
  }

  const completed: DesktopUIMessage = { ...base, parts, metadata: { ...base.metadata, runStatus: "completed" } };
  const completedMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[completed]} locale="zh" />);
  assert.match(completedMarkup, /class="wb-run-metrics"/);

  const pendingMarkup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[completed]} pendingMessageId={completed.id} locale="zh" />);
  assert.doesNotMatch(pendingMarkup, /class="wb-run-metrics"/);
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

test("renders a typed preview inline without trusting its raw URL", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-preview", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "data-preview", id: "preview:ppt-1", data: { kind: "ppt", title: "Quarterly deck", url: "http://127.0.0.1:5200/private", previewSessionId: "ppt-1", engine: "dashi-ppt", interactive: true, status: "ready" } }],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="en" resolvePreviewSource={async () => ({ url: "http://127.0.0.1:5200/" })} onPreviewExport={() => undefined} />);
  assert.match(markup, /data-slot="preview-results"/);
  assert.match(markup, /data-preview-id="ppt-1"/);
  assert.match(markup, /Quarterly deck/);
  assert.match(markup, /Open preview in side panel/);
  assert.match(markup, /Connecting to local preview/);
  assert.doesNotMatch(markup, /src="http:\/\/127\.0\.0\.1:5200\/private"/);
  assert.doesNotMatch(markup, /Some content is unavailable/);
});

test("opens preview in the right-side panel with a one-click browser action", () => {
  const markup = renderToStaticMarkup(<WorkbenchPreview
    preview={{ kind: "web", title: "Local site", url: "http://127.0.0.1:5200/", previewSessionId: "site-1", engine: "generic-web", status: "loading" }}
    locale="en"
    context={{ messageId: "assistant-preview", conversationId: "conversation-1" }}
    onOpenExternal={() => undefined}
    defaultExpanded
  />);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /data-preview-layout="side-panel"/);
  assert.match(markup, /Back to conversation/);
  assert.match(markup, /Close preview/);
  assert.match(markup, /Open in browser/);
  assert.doesNotMatch(markup, /target="_blank"/);
});

test("keeps the expanded preview panel on an opaque theme surface", () => {
  assert.match(workbenchStyles, /\.wb-ai-preview\s*\{[^}]*--ai-elements-surface:\s*var\(--wb-card,\s*#fff\)/s);
  assert.match(workbenchStyles, /\.wb-ai-preview-expanded\s*\{[^}]*background:\s*var\(--ai-elements-surface\)/s);
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
  assert.match(markup, /data-artifact-preview-kind="document"/);
  assert.match(markup, /Markdown 文档/);
  assert.match(markup, /PDF 文档/);
  assert.match(markup, /Word 文档 · application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
});

test("recognizes PowerPoint, Word and Excel artifacts as previewable Office formats", () => {
  const message: DesktopUIMessage = {
    ...createDesktopUIMessage({ id: "assistant-office-artifacts", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "data-artifact", id: "artifact-pptx", data: { id: "artifact-pptx", relativePath: "artifacts/brief.pptx", title: "brief.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", byteLength: 42, sha256: "hash" } },
      { type: "data-artifact", id: "artifact-legacy-ppt", data: { id: "artifact-legacy-ppt", relativePath: "artifacts/legacy.ppt", title: "legacy.ppt", mimeType: "application/vnd.ms-powerpoint", byteLength: 42, sha256: "hash" } },
      { type: "data-artifact", id: "artifact-docx", data: { id: "artifact-docx", relativePath: "artifacts/brief.docx", title: "brief.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteLength: 42, sha256: "hash" } },
      { type: "data-artifact", id: "artifact-xlsx", data: { id: "artifact-xlsx", relativePath: "artifacts/brief.xlsx", title: "brief.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteLength: 42, sha256: "hash" } },
    ],
  };
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[message]} locale="zh" />);
  assert.match(markup, /data-artifact-preview-kind="presentation"/);
  assert.match(markup, /data-artifact-preview-kind="document"/);
  assert.match(markup, /data-artifact-preview-kind="spreadsheet"/);
  assert.match(markup, /data-artifact-preview-kind="file"[^>]*>[\s\S]*?legacy\.ppt/);
  assert.match(markup, /演示文稿 · application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/);
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
  assert.doesNotMatch(workbenchStyles, /\.wb-ai-message-surface \.wb-ai-message\s*\{/);
  assert.doesNotMatch(workbenchStyles, /\.wb-ai-message-surface \.ai-elements-message-content\s*\{[^}]*display:\s*grid/s);
});

test("keeps ordered process parts within the native message hierarchy", () => {
  assert.doesNotMatch(workbenchStyles, /\.wb-ai-message-output\[data-message-order="chronological"\] > \.wb-ai-process\s*\{/);
  assert.match(workbenchStyles, /\.wb-ai-message-activity\s*\{[^}]*color:\s*var\(--ai-elements-muted\)/);
  assert.doesNotMatch(workbenchStyles, /\.wb-ai-message-execution/);
});

test("uses AI Elements message slots in chronological order", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-stream", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "thinking", state: "streaming" },
      { type: "text", text: "streamed answer", state: "streaming" },
      { type: "data-status", id: "status:stream", data: { status: "running", message: "Working" } },
      { type: "dynamic-tool", toolName: "webfetch", toolCallId: "tool-1", state: "output-available", input: { url: "https://example.com" }, output: "ok" },
    ],
  }]} pendingMessageId="assistant-stream" locale="en" onCopy={() => undefined} onRetry={() => undefined} />);
  assert.doesNotMatch(markup, /class="[^"]*ai-elements-task[^"]*"/);
  assert.doesNotMatch(markup, /wb-ai-run-status/);
  assert.match(markup, /data-slot="message-output"/);
  assert.match(markup, /data-slot="message-actions"/);
  assert.match(markup, /data-streaming="true"/);
  assert.match(markup, /Copy message/);
  assert.match(markup, /aria-label="Retry"/);
  assert.match(markup, /data-slot="tool-activity-trigger"/);
  assert.match(markup, /data-tool-name="webfetch"/);
  assert.match(markup, /<div(?=[^>]*data-slot="tool-activity-group")(?=[^>]*data-state="closed")(?=[^>]*data-status="completed")[^>]*>/);
  assert.equal((markup.match(/data-slot="tool-activity-group"/g) ?? []).length, 2);
  assert.match(markup, /1 tool operation/);
  assert.match(markup, /data-slot="tool-activity-list"/);
  assert.ok(markup.indexOf('data-process-id="reasoning:0"') < markup.indexOf("streamed answer"));
  assert.ok(markup.indexOf("streamed answer") < markup.indexOf('data-tool-name="webfetch"'));
});

test("keeps distinct reasoning occurrences as distinct collapsible parts", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-reasoning-fragments", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "先确认目标", state: "done" },
      { type: "reasoning", text: "再检查约束", state: "done" },
      { type: "text", text: "结论", state: "done" },
    ],
  }]} locale="zh" />);

  assert.equal((markup.match(/data-process-kind="reasoning"/g) ?? []).length, 1);
  assert.equal((markup.match(/data-slot="tool-activity-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /先确认目标|再检查约束/u);
  assert.match(markup, /data-process-id="reasoning:0"[^>]*data-status="completed"/);
  assert.doesNotMatch(markup, /data-state="open"/);
});

test("allows feature actions to share the native message action bar", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface
    messages={[createDesktopUIMessage({ id: "assistant-feature-actions", role: "assistant", conversationId: "conversation-1", content: "answer" })]}
    locale="en"
    renderAssistantActions={() => <MessageAction label="Preview" title="Preview">P</MessageAction>}
  />);

  const actions = markup.match(/<div[^>]*data-slot="message-actions"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(actions, /aria-label="Preview"/);
  assert.match(actions, /title="Preview"/);
});

test("keeps reasoning and public text ordered inside one message body", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-body-boundary", role: "assistant", conversationId: "conversation-1" }),
    parts: [
      { type: "reasoning", text: "private thinking", state: "done" },
      { type: "text", text: "public answer", state: "done" },
    ],
  }]} locale="en" />);
  assert.match(markup, /data-process-kind="reasoning"/);
  assert.match(markup, /data-state="closed"/);
  assert.doesNotMatch(markup, /private thinking/);
  assert.match(markup, /class="wb-ai-message-output"[^>]*data-message-order="chronological"/);
  assert.ok(markup.indexOf("private thinking") < markup.indexOf("public answer"));
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
  assert.match(markup, /Theuserisaskingtolistthethreerisks\.Letmeloadtheskillfirst\.Nofilegenerationneeded\./u);
  assert.match(markup, /付款与资金条款风险/);
});

test("renders an AI Elements confirmation for a blocked tool call", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-approval", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "tool-approval", state: "approval-requested", input: { command: "pwd" }, approval: { id: "permission-1", reason: "Run pwd" } }],
  }]} locale="en" />);
  assert.match(markup, /<div(?=[^>]*data-slot="tool")(?=[^>]*data-state="open")(?=[^>]*data-status="waiting")[^>]*>/);
  assert.match(markup, /data-slot="confirmation"/);
  assert.match(markup, /data-tool-name="bash"/);
  assert.match(markup, /Awaiting Approval/);
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

test("renders attachments on the user message through native AI Elements primitives", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "user-with-attachment", role: "user", conversationId: "conversation-1", content: "Summarize this file" }),
    parts: [
      { type: "text", text: "Summarize this file", state: "done" },
      { type: "data-attachment", id: "attachment:file-1", data: { attachmentId: "file-1", name: "brief.pdf", mediaType: "application/pdf", status: "ready" } },
    ],
  }]} locale="en" />);
  assert.match(markup, /data-slot="attachments"/);
  assert.match(markup, /data-message-role="user"/);
  assert.match(markup, /brief\.pdf/);
  assert.match(markup, /application&#x2F;pdf|application\/pdf/);
  assert.match(markup, /data-attachment-id="attachment:file-1"/);
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

test("renders semantic Markdown through Streamdown without a second authored stylesheet", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[
    createDesktopUIMessage({ id: "markdown", role: "assistant", conversationId: "conversation-1", content: "## Result\n\n**Strong** and `inline`.\n\n- first\n- second\n\n> quote\n\n| Name | Value |\n| --- | --- |\n| order | preserved |\n\n```ts\nconst answer = 42;\n```" }),
  ]} />);
  for (const tag of ["h2", "ul", "blockquote", "table", "pre", "code"]) {
    assert.match(markup, new RegExp(`<${tag}[ >]`));
  }
  assert.match(markup, /data-streamdown="strong"/);
  assert.match(markup, /const answer = 42;/);
  assert.doesNotMatch(workbenchStyles, /\.ai-elements-message-response > div/);
});

test("keeps streaming assistant Markdown free of per-token animation", () => {
  const markup = renderToStaticMarkup(<WorkbenchMessageSurface messages={[{
    ...createDesktopUIMessage({ id: "assistant-animated", role: "assistant", conversationId: "conversation-1" }),
    parts: [{ type: "text", text: "Streaming response with several words", state: "streaming" }],
  }]} pendingMessageId="assistant-animated" locale="en" />);
  assert.match(markup, /data-streaming="true"/);
  assert.doesNotMatch(markup, /data-sd-animate/);
  assert.doesNotMatch(workbenchStyles, /@keyframes sd-fadeIn/);
  assert.doesNotMatch(workbenchStyles, /\[data-sd-animate\]\s*\{[^}]*animation:/s);
});
