"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { WorkbenchAttachments } from "./prompt-input";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
  AudioPlayer,
  CodeBlock,
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  Image,
  InlineCitation,
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessagePlainText,
  MessageResponse,
  MessageToolbar,
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./ai-elements";
import { applyRunMetricsEvent, createDesktopUIMessage, createRunMetricsAccumulator, toRunMetrics, type DesktopArtifactData, type DesktopMediaData, type DesktopPreviewData, type DesktopRunStatus, type DesktopUIMessage, type DesktopUIMessagePart } from "@coworkany/workbench-client";
import { artifactDisplayName } from "./artifact-label";
import { formatWorkbenchMessageTimestamp, workbenchMessageTimestampLabel } from "./message-time";
import { WorkbenchPreview, type WorkbenchPreviewContext, type WorkbenchPreviewSource } from "./workbench-preview";
import { OfficeArtifactPreview } from "./office-artifact-preview";
import { WorkbenchRunMetrics } from "./run-metrics";
import { groupProcessActivityParts, summarizeProcessActivity, summarizeToolActivity, type ProcessActivityEntry } from "./tool-activity";
import { ToolActivityGroup, ToolActivityPortals, useToolActivityDisclosures } from "./tool-activity-group";

export type WorkbenchMessageSurfaceProps = {
  readonly messages: readonly DesktopUIMessage[];
  readonly locale?: "zh" | "en";
  readonly pendingMessageId?: string;
  readonly onReachTop?: (viewport: HTMLDivElement) => void;
  readonly onViewportScroll?: (viewport: HTMLDivElement) => void;
  readonly scrollStateKey?: string;
  readonly restoreScrollTop?: number;
  readonly className?: string;
  readonly onCopy?: (message: DesktopUIMessage) => void | Promise<void>;
  readonly onRetry?: (message: DesktopUIMessage) => void | Promise<void>;
  readonly renderAssistantActions?: (message: DesktopUIMessage) => ReactNode;
  readonly onArtifactOpen?: (artifact: DesktopArtifactData) => void | Promise<void>;
  readonly onArtifactDownload?: (artifactId: string) => void | Promise<void>;
  readonly onMediaOpen?: (media: DesktopMediaData) => void;
  /** Resolve a workspace-relative media path into a browser-readable URL. */
  readonly resolveMediaSource?: (media: DesktopMediaData) => Promise<WorkbenchMediaSource | null>;
  /** Resolve a workspace-relative artifact into a preview URL and, when safe, text content. */
  readonly resolveArtifactSource?: (artifact: DesktopArtifactData) => Promise<WorkbenchArtifactSource | null>;
  /** Validate and resolve a preview descriptor into a browser-readable local source. */
  readonly resolvePreviewSource?: (preview: DesktopPreviewData, context: WorkbenchPreviewContext) => Promise<WorkbenchPreviewSource | null>;
  readonly onPreviewRefresh?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onPreviewDownload?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onPreviewExport?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onPreviewOpenExternal?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onToolApproval?: (message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") => void | Promise<void>;
  /** Workflow AI keeps concise business summaries; ordinary tool traces use on-demand details. */
  readonly workflowAi?: boolean;
  readonly emptyState?: ReactNode;
};

export type WorkbenchMediaSource = string | { readonly url: string; readonly revoke?: () => void };
export type WorkbenchArtifactSource = {
  readonly url?: string;
  readonly text?: string;
  readonly data?: ArrayBuffer;
  readonly mimeType?: string;
  readonly revoke?: () => void;
};

const HANDLED_DATA_PARTS = new Set([
  "data-artifact",
  "data-writerAsset",
  "data-attachment",
  "data-media",
  "data-preview",
  "data-report",
  "data-status",
  "data-task",
  "data-usage",
  "data-runMetrics",
  "data-warning",
  "data-workflow",
]);

function status(value: DesktopRunStatus): "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" {
  return value;
}

function emitToolApproval(message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("coworkany:tool-approval", {
    detail: { messageId: message.id, runId: message.metadata?.runId, approvalId: part.approval?.id, toolCallId: part.toolCallId, decision },
  }));
}

function messageStatus(message: DesktopUIMessage, pending: boolean) {
  if (pending) return "running" as const;
  if (message.metadata?.runStatus) return message.metadata.runStatus;
  return "completed" as const;
}

type MessageActivityAnnouncement = { identity: string; label: string };
type MessageActivityProjection = { activePart: DesktopUIMessagePart | undefined; activeIndex: number; groupedToolActivity: boolean; announcement?: MessageActivityAnnouncement };
type ProcessActivityEntries = ReturnType<typeof groupProcessActivityParts>;

function messageActivityProjection(message: DesktopUIMessage, locale: "zh" | "en", streaming: boolean, workflowAi: boolean, entries: ProcessActivityEntries = groupProcessActivityParts(message.parts, { active: streaming, workflowAi })): MessageActivityProjection {
  const lastVisibleIndex = message.parts.reduce((last, part, index) => ["data-status", "data-usage", "data-runMetrics", "data-writerAsset"].includes(part.type) ? last : index, -1);
  const activePart = lastVisibleIndex >= 0 ? message.parts[lastVisibleIndex] : undefined;
  if (message.role !== "assistant" || !streaming) return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity: false };
  const reasoningActive = entries.some((entry) => entry.type === "process-group" && summarizeProcessActivity(entry.members.map((member) => member.part), locale, streaming).reasoningActive);
  const activeTrace = reasoningActive || entries.some((entry) => entry.type === "tool-group" ? summarizeToolActivity(entry.parts, locale).active > 0 : entry.type === "process-group" && summarizeProcessActivity(entry.members.map((member) => member.part), locale, streaming).active > 0);
  const interactivePhase = activePart?.type === "dynamic-tool" && entries.some((entry) => entry.type === "part" && entry.part === activePart);
  const writingPhase = activePart?.type === "text" && activePart.state === "streaming";
  const groupedToolActivity = activeTrace && !interactivePhase && !writingPhase && activePart?.type !== "data-task";
  if (groupedToolActivity) {
    return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: reasoningActive
      ? { identity: `${message.id}:thinking`, label: locale === "zh" ? "正在思考" : "Thinking" }
      : { identity: `${message.id}:tools`, label: locale === "zh" ? "正在执行工具操作" : "Running tools" } };
  }
  if (activePart?.type === "reasoning") return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:thinking`, label: locale === "zh" ? "正在思考" : "Thinking" } };
  if (activePart?.type === "text") return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:writing`, label: locale === "zh" ? "正在撰写" : "Writing" } };
  if (activePart?.type === "dynamic-tool") {
    if (activePart.state === "approval-requested") {
      return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:approval:${activePart.toolCallId}`, label: locale === "zh" ? `等待批准 ${activePart.toolName}` : `Awaiting approval for ${activePart.toolName}` } };
    }
    if (summarizeToolActivity([activePart], locale).active > 0) {
      return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:tool:${activePart.toolCallId}`, label: locale === "zh" ? `正在运行 ${activePart.toolName}` : `Running ${activePart.toolName}` } };
    }
  }
  if (activePart?.type === "data-task") return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:task`, label: locale === "zh" ? `正在执行 ${activePart.data.title}` : `Running ${activePart.data.title}` } };
  return { activePart, activeIndex: lastVisibleIndex, groupedToolActivity, announcement: { identity: `${message.id}:waiting`, label: locale === "zh" ? "正在等待模型响应" : "Waiting for the model response" } };
}

function MessageActivityAnnouncement({ message, locale, streaming, workflowAi }: { message: DesktopUIMessage | undefined; locale: "zh" | "en"; streaming: boolean; workflowAi: boolean }) {
  const announcement = useMemo(() => message ? messageActivityProjection(message, locale, streaming, workflowAi).announcement : undefined, [message, locale, streaming, workflowAi]);
  const [text, setText] = useState("");
  useEffect(() => {
    setText("");
    if (!announcement) return;
    const timer = globalThis.setTimeout(() => setText(announcement.label), 100);
    return () => globalThis.clearTimeout(timer);
  }, [announcement?.identity, announcement?.label]);
  return <span className="sr-only" data-slot="phase-announcement" data-phase-announcement="true" role="status" aria-live="polite" aria-atomic="true">{text}</span>;
}

function MessageActivity({ part, locale }: { part: DesktopUIMessagePart | undefined; locale: "zh" | "en" }) {
  const [elapsed, setElapsed] = useState(0);
  const activityKey = part?.type === "dynamic-tool" ? `${part.toolCallId}:${part.state}` : part?.type ?? "waiting";
  useEffect(() => {
    setElapsed(0);
    const timer = globalThis.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => globalThis.clearInterval(timer);
  }, [activityKey]);
  let label = locale === "zh" ? "正在等待模型响应…" : "Waiting for the model response…";
  if (part?.type === "reasoning") label = locale === "zh" ? "正在思考…" : "Thinking…";
  else if (part?.type === "text") label = locale === "zh" ? "正在撰写…" : "Writing…";
  else if (part?.type === "dynamic-tool") {
    label = part.state === "approval-requested"
      ? (locale === "zh" ? `等待批准 ${part.toolName}` : `Awaiting approval for ${part.toolName}`)
      : summarizeToolActivity([part], locale).active > 0 ? (locale === "zh" ? `正在运行 ${part.toolName}` : `Running ${part.toolName}`) : label;
  } else if (part?.type === "data-task") label = locale === "zh" ? `正在执行 ${part.data.title}` : `Running ${part.data.title}`;
  return <div className="wb-ai-message-activity" data-output-kind="boundary">
    <span className="wb-ai-process-spinner" aria-hidden="true" />
    <span>{label}</span>
    <span aria-hidden="true"> · {elapsed}s</span>
  </div>;
}

export function workbenchMessageActivityRevision(message: DesktopUIMessage) {
  const partRevision = message.parts.map((part, index) => {
    if (part.type === "text" || part.type === "reasoning") {
      const occurrenceId = part.providerMetadata?.coworkany?.partId ?? index;
      return `${part.type}:${occurrenceId}:${part.state}:${part.text.length}`;
    }
    if (part.type === "dynamic-tool") return `tool:${part.toolCallId}:${part.state}`;
    if (part.type === "source-url" || part.type === "source-document") return `${part.type}:${part.sourceId}`;
    if (part.type === "file") return `file:${part.filename ?? index}:${part.url ?? ""}`;
    if (part.type.startsWith("data-")) {
      const id = "id" in part ? part.id ?? index : index;
      const state = part.type === "data-task" ? `${part.data.status}:${part.data.steps?.map((step) => step.status).join(",") ?? ""}` : "";
      return `${part.type}:${id}:${state}`;
    }
    return `${part.type}:${index}`;
  }).join("|");
  return `${message.id}:${message.metadata?.lastSequence ?? "legacy"}:${message.metadata?.runStatus ?? "unknown"}:${partRevision}`;
}

function createPendingAssistantMessage(id: string, messages: readonly DesktopUIMessage[]): DesktopUIMessage {
  const conversationId = messages.at(-1)?.metadata?.conversationId ?? "pending";
  const message = createDesktopUIMessage({
    id,
    role: "assistant",
    conversationId,
  });
  const createdAt = message.metadata?.createdAt ?? new Date().toISOString();
  const updatedAt = message.metadata?.updatedAt ?? createdAt;
  return {
    ...message,
    metadata: {
      ...message.metadata,
      conversationId,
      createdAt,
      updatedAt,
      runStatus: "running" as const,
    },
  };
}

type MessageTurn = {
  readonly id: string;
  readonly user?: DesktopUIMessage;
  readonly assistants: readonly DesktopUIMessage[];
};

function messageTurnId(message: DesktopUIMessage) {
  const prefix = message.role === "user" ? "message-" : message.role === "assistant" ? "assistant-" : "";
  return prefix && message.id.startsWith(prefix) ? message.id.slice(prefix.length) : message.metadata?.runId;
}

function orderMessagesForTimeline(messages: readonly DesktopUIMessage[]) {
  const ordered = messages
    .map((message, index) => ({ message, index, time: Date.parse(message.metadata?.createdAt ?? "") }))
    .sort((left, right) => {
      const leftHasTime = !Number.isNaN(left.time);
      const rightHasTime = !Number.isNaN(right.time);
      if (leftHasTime && rightHasTime && left.time !== right.time) return left.time - right.time;
      if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
      const leftTurnId = messageTurnId(left.message);
      const rightTurnId = messageTurnId(right.message);
      if (leftTurnId && leftTurnId === rightTurnId && left.message.role !== right.message.role) {
        return left.message.role === "user" ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ message }) => message);

  // Persisted timestamps may have second precision. Repair only an adjacent
  // assistant→user inversion so same-timestamp multi-turn sequences remain
  // stable instead of moving every user message ahead of every answer.
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const previousTime = Date.parse(previous.metadata?.createdAt ?? "");
    const currentTime = Date.parse(current.metadata?.createdAt ?? "");
    if (previous.role !== "assistant" || current.role !== "user" || previousTime !== currentTime) continue;
    const beforePreviousTime = index > 1 ? Date.parse(ordered[index - 2].metadata?.createdAt ?? "") : Number.NaN;
    if (beforePreviousTime === previousTime) continue;
    ordered[index - 1] = current;
    ordered[index] = previous;
  }
  return ordered;
}

function groupMessagesIntoTurns(messages: readonly DesktopUIMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let activeTurn: MessageTurn | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      activeTurn = { id: `turn:${message.id}`, user: message, assistants: [] };
      turns.push(activeTurn);
      continue;
    }
    if (!activeTurn) {
      activeTurn = { id: `turn:${message.id}`, assistants: [message] };
      turns.push(activeTurn);
      continue;
    }
    activeTurn = { ...activeTurn, assistants: [...activeTurn.assistants, message] };
    turns[turns.length - 1] = activeTurn;
  }
  return turns;
}

function RoleAvatar({ role, locale }: { role: "user" | "assistant"; locale: "zh" | "en" }) {
  const label = role === "user" ? (locale === "zh" ? "用户" : "You") : "AI";
  return <span className={`wb-ai-role-avatar wb-ai-role-avatar-${role}`} role="img" aria-label={label}>{role === "user" ? "U" : "AI"}</span>;
}

function MessageTimestamp({ message, locale }: { message: DesktopUIMessage; locale: "zh" | "en" }) {
  const createdAt = message.metadata?.createdAt;
  if (!createdAt) return null;
  const label = workbenchMessageTimestampLabel(locale);
  return <div className="wb-ai-message-header" data-message-created-at={createdAt}>
    <span className="wb-ai-message-role">{message.role === "user" ? (locale === "zh" ? "用户" : "You") : "AI"}</span>
    <time className="wb-ai-message-time" dateTime={createdAt} title={label} aria-label={`${label}: ${formatWorkbenchMessageTimestamp(createdAt, locale)}`}>
      {formatWorkbenchMessageTimestamp(createdAt, locale)}
    </time>
  </div>;
}

function mediaActions(media: DesktopMediaData, locale: "zh" | "en", onOpen?: (media: DesktopMediaData) => void, onDownload?: (artifactId: string) => void) {
  return <div className="wb-ai-media-actions" data-slot="media-actions">
    {onOpen ? <button type="button" onClick={() => onOpen(media)}>{locale === "zh" ? "预览" : "Preview"}</button> : null}
    {onDownload ? <button type="button" onClick={() => onDownload(media.artifactId)}>{locale === "zh" ? "下载" : "Download"}</button> : null}
  </div>;
}

function ResolvedMedia({ media, locale, onOpen, onDownload, resolveMediaSource, showActions = true }: {
  readonly media: DesktopMediaData;
  readonly locale: "zh" | "en";
  readonly onOpen?: (media: DesktopMediaData) => void;
  readonly onDownload?: (artifactId: string) => void;
  readonly resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"];
  readonly showActions?: boolean;
}) {
  const [source, setSource] = useState<string | null>(() => resolveMediaSource ? null : media.relativePath ?? null);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    setPreviewError(false);
    if (!resolveMediaSource) {
      setSource(media.relativePath ?? null);
      return () => undefined;
    }
    setSource(null);
    if (!media.relativePath) return () => undefined;
    void resolveMediaSource(media)
      .then((resolved) => {
        if (!active) return;
        const nextSource = typeof resolved === "string" ? resolved : resolved?.url ?? null;
        revoke = typeof resolved === "string" ? undefined : resolved?.revoke;
        setSource(nextSource);
        if (!nextSource) setPreviewError(true);
      })
      .catch(() => { if (active) setPreviewError(true); });
    return () => {
      active = false;
      revoke?.();
    };
  }, [media.artifactId, media.relativePath, media.mimeType, resolveMediaSource]);

  const actions = showActions ? mediaActions(media, locale, onOpen, onDownload) : null;
  if (source && media.kind === "image") {
    return <div className="wb-ai-media-result">
      <button type="button" className="wb-ai-media-preview" onClick={() => onOpen?.(media)} aria-label={media.title}><Image src={source} alt={media.title} /></button>
      {actions}
    </div>;
  }
  if (source && media.kind === "video") {
    return <div className="wb-ai-media-result">
      <video controls preload="metadata" src={source} aria-label={media.title} />
      {actions}
    </div>;
  }
  if (source && media.kind === "audio") {
    return <div className="wb-ai-media-result">
      <AudioPlayer src={source} title={media.title} />
      {actions}
    </div>;
  }
  return <button type="button" className="wb-ai-media-result wb-ai-media-result-unavailable" onClick={() => onOpen?.(media)} data-media-preview-state={previewError ? "error" : resolveMediaSource && media.relativePath ? "loading" : "unavailable"} aria-busy={!source && !previewError && Boolean(resolveMediaSource && media.relativePath)}>
    <strong>{media.title}</strong>
    <small>{previewError ? (locale === "zh" ? "预览不可用" : "Preview unavailable") : media.mimeType}</small>
  </button>;
}

function renderMedia(media: DesktopMediaData, locale: "zh" | "en", onOpen?: (media: DesktopMediaData) => void, onDownload?: (artifactId: string) => void, resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"], showActions = true) {
  return <ResolvedMedia media={media} locale={locale} onOpen={onOpen} onDownload={onDownload} resolveMediaSource={resolveMediaSource} showActions={showActions} />;
}

function artifactExtension(artifact: DesktopArtifactData) {
  const match = artifact.title.match(/\.([a-z0-9]+)$/i) ?? artifact.relativePath.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function artifactPreviewKind(artifact: DesktopArtifactData): "image" | "video" | "audio" | "pdf" | "presentation" | "document" | "spreadsheet" | "markdown" | "text" | "file" {
  const mimeType = artifact.mimeType.toLowerCase().split(";", 1)[0] ?? "";
  const extension = artifactExtension(artifact);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (extension === "pptx" || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "presentation";
  if (extension === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "document";
  if (extension === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "spreadsheet";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown" || ["md", "markdown", "mdown"].includes(extension)) return "markdown";
  if (mimeType.startsWith("text/") || ["json", "csv", "tsv", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css"].includes(extension)) return "text";
  return "file";
}

function artifactKindLabel(kind: ReturnType<typeof artifactPreviewKind>, locale: "zh" | "en") {
  if (locale === "en") return kind === "markdown" ? "Markdown" : kind === "text" ? "Text" : kind === "pdf" ? "PDF" : kind === "presentation" ? "PowerPoint" : kind === "document" ? "Word document" : kind === "spreadsheet" ? "Excel workbook" : kind === "image" ? "Image" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : "File";
  return kind === "markdown" ? "Markdown 文档" : kind === "text" ? "文本文件" : kind === "pdf" ? "PDF 文档" : kind === "presentation" ? "演示文稿" : kind === "document" ? "Word 文档" : kind === "spreadsheet" ? "电子表格" : kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文件";
}

function artifactMediaData(artifact: DesktopArtifactData, kind: "image" | "video" | "audio"): DesktopMediaData {
  const media: DesktopMediaData = {
    artifactId: artifact.id,
    kind,
    mimeType: artifact.mimeType,
    title: artifactDisplayName(artifact.title, artifact.relativePath),
    relativePath: artifact.relativePath,
    previewable: true,
  };
  return media;
}

function ArtifactFilePreview({ artifact, kind, locale, loading, error }: { artifact: DesktopArtifactData; kind: ReturnType<typeof artifactPreviewKind>; locale: "zh" | "en"; loading?: boolean; error?: boolean }) {
  const displayName = artifactDisplayName(artifact.title, artifact.relativePath);
  return <div className="wb-ai-artifact-file-preview" data-artifact-preview-kind={kind} data-artifact-preview-state={error ? "error" : loading ? "loading" : "ready"}>
    <strong>{displayName}</strong>
    <span>{artifactKindLabel(kind, locale)} · {artifact.mimeType}</span>
    <small>{error ? (locale === "zh" ? "预览不可用，可下载或打开文件" : "Preview unavailable; download or open the file") : loading ? (locale === "zh" ? "正在加载预览…" : "Loading preview…") : displayName}</small>
  </div>;
}

function ResolvedArtifactPreview({ artifact, locale, onOpen, onDownload, resolveMediaSource, resolveArtifactSource }: {
  readonly artifact: DesktopArtifactData;
  readonly locale: "zh" | "en";
  readonly onOpen?: (artifact: DesktopArtifactData) => void;
  readonly onDownload?: (artifactId: string) => void;
  readonly resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"];
  readonly resolveArtifactSource?: WorkbenchMessageSurfaceProps["resolveArtifactSource"];
}) {
  const kind = artifactPreviewKind(artifact);
  const [source, setSource] = useState<WorkbenchArtifactSource | null>(() => resolveArtifactSource ? null : null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    setPreviewError(false);
    setSource(null);
    if (!resolveArtifactSource || !artifact.relativePath || kind === "image" || kind === "video" || kind === "audio" || kind === "file") return () => undefined;
    void resolveArtifactSource(artifact)
      .then((resolved) => {
        if (!active) return;
        revoke = resolved?.revoke;
        setSource(resolved);
        if (!resolved) setPreviewError(true);
      })
      .catch(() => { if (active) setPreviewError(true); });
    return () => {
      active = false;
      revoke?.();
    };
  }, [artifact.id, artifact.relativePath, artifact.mimeType, kind, resolveArtifactSource]);

  if (kind === "image" || kind === "video" || kind === "audio") {
    const media = artifactMediaData(artifact, kind);
    return <div data-artifact-preview-kind={kind}>{renderMedia(media, locale, () => onOpen?.(artifact), onDownload, resolveMediaSource, false)}</div>;
  }
  if (source?.text !== undefined && (kind === "markdown" || kind === "text")) {
    return <div className="wb-ai-artifact-text-preview" data-artifact-preview-kind={kind}><MessageResponse content={source.text} /></div>;
  }
  if (source?.url && kind === "pdf") {
    return <iframe className="wb-ai-artifact-pdf-preview" data-artifact-preview-kind="pdf" title={artifactDisplayName(artifact.title, artifact.relativePath)} src={source.url} />;
  }
  if (source?.data && (kind === "presentation" || kind === "document" || kind === "spreadsheet")) {
    return <OfficeArtifactPreview format={kind} data={source.data} title={artifactDisplayName(artifact.title, artifact.relativePath)} locale={locale} />;
  }
  return <ArtifactFilePreview artifact={artifact} kind={kind} locale={locale} loading={Boolean(resolveArtifactSource && artifact.relativePath) && !source && !previewError} error={previewError} />;
}

function renderArtifactMedia(artifact: DesktopArtifactData, locale: "zh" | "en", onOpen?: (artifact: DesktopArtifactData) => void, onDownload?: (artifactId: string) => void, resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"], resolveArtifactSource?: WorkbenchMessageSurfaceProps["resolveArtifactSource"]) {
  return <ResolvedArtifactPreview artifact={artifact} locale={locale} onOpen={onOpen} onDownload={onDownload} resolveMediaSource={resolveMediaSource} resolveArtifactSource={resolveArtifactSource} />;
}

function workflowAiToolLabel(toolName: string, locale: "zh" | "en") {
  if (toolName === "undo" || toolName === "redo") return locale === "zh" ? "工作流变更" : "Workflow change";
  return toolName.replace(/[_-]+/g, " ");
}

function workflowAiToolResult(output: unknown, locale: "zh" | "en") {
  const fallback = locale === "zh" ? "操作已完成" : "Operation completed";
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return fallback;
    return trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed;
  }
  if (!output || typeof output !== "object") return fallback;
  const record = output as Record<string, unknown>;
  for (const key of ["summary", "message", "description", "status", "result"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && !/["']?(?:undo|redo)["']?/iu.test(value)) {
      return value.length > 180 ? `${value.slice(0, 177)}…` : value;
    }
  }
  return fallback;
}

function WorkflowAiToolSummary({ part, locale }: { part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>; locale: "zh" | "en" }) {
  const toolLabel = workflowAiToolLabel(part.toolName, locale);
  const result = part.state === "output-available" ? workflowAiToolResult(part.output, locale) : part.state === "output-error" ? (part.errorText ?? (locale === "zh" ? "操作失败" : "Operation failed")) : undefined;
  return <div className="wb-ai-workflow-tool-summary" data-workflow-ai-tool-summary="true">
      <strong>{part.state === "approval-requested" ? (locale === "zh" ? `请求批准：${toolLabel}` : `Approval requested: ${toolLabel}`) : toolLabel}</strong>
      {result ? <span data-workflow-ai-tool-result="true">{result}</span> : null}
    </div>;
}

function ToolApproval({ message, part, locale, onToolApproval }: { message: DesktopUIMessage; part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>; locale: "zh" | "en"; onToolApproval?: WorkbenchMessageSurfaceProps["onToolApproval"] }) {
  return <Confirmation state="approval-requested" approval={{ id: part.approval?.id ?? part.toolCallId }}>
    <ConfirmationTitle>{locale === "zh" ? (part.approval?.id ? `需要审批：${part.approval.id}` : "此工具调用需要审批") : (part.approval?.id ? `Approval required: ${part.approval.id}` : "This tool call requires approval")}</ConfirmationTitle>
    <ConfirmationRequest><ConfirmationActions><ConfirmationAction onClick={() => void (onToolApproval ? onToolApproval(message, part, "reject") : emitToolApproval(message, part, "reject"))}>{locale === "zh" ? "拒绝" : "Reject"}</ConfirmationAction><ConfirmationAction onClick={() => void (onToolApproval ? onToolApproval(message, part, "approve") : emitToolApproval(message, part, "approve"))}>{locale === "zh" ? "批准" : "Approve"}</ConfirmationAction></ConfirmationActions></ConfirmationRequest>
  </Confirmation>;
}

function OrderedTask({ part, locale }: { part: Extract<DesktopUIMessagePart, { type: "data-task" }>; locale: "zh" | "en" }) {
  const taskStatus = status(part.data.status);
  return <Task defaultOpen={taskStatus === "running" || taskStatus === "waiting"} status={taskStatus} data-status={taskStatus}>
    <TaskTrigger title={part.data.title} status={taskStatus} locale={locale} />
    <TaskContent>
      {part.data.steps?.map((step) => <TaskItem key={step.id} data-status={step.status}>
        <span aria-hidden="true">{step.status === "completed" ? "✓" : "·"}</span>
        <span><strong>{step.title}</strong>{step.toolName ? <small>{step.toolName}</small> : null}</span>
        <em>{status(step.status)}</em>
      </TaskItem>)}
    </TaskContent>
  </Task>;
}

function OrderedTool({ message, part, locale, onToolApproval, workflowAi }: { message: DesktopUIMessage; part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>; locale: "zh" | "en"; onToolApproval?: WorkbenchMessageSurfaceProps["onToolApproval"]; workflowAi: boolean }) {
  const toolStatus = part.state === "approval-requested" ? "waiting" : part.state === "output-available" ? "completed" : part.state === "output-error" ? "failed" : part.state === "output-denied" ? "denied" : "running";
  // Automatic expansion follows the part lifecycle. A user's explicit choice
  // survives streaming updates; approval/error phases remain easy to inspect.
  const [manualChoice, setManualChoice] = useState<{ open: boolean; state: typeof part.state }>();
  const needsAttention = part.state === "approval-requested" || toolStatus === "failed";
  const open = (needsAttention && manualChoice?.state !== part.state) || (manualChoice?.open ?? (workflowAi || toolStatus === "running"));
  return <Tool open={open} onOpenChange={(next) => setManualChoice({ open: next, state: part.state })} status={toolStatus}>
    <ToolHeader type="dynamic-tool" toolName={workflowAi && (part.toolName === "undo" || part.toolName === "redo") ? "workflow-change" : part.toolName} toolCallId={part.toolCallId} state={part.state} locale={locale} />
    {workflowAi ? <ToolContent><WorkflowAiToolSummary part={part} locale={locale} /></ToolContent> : <ToolContent>
      <ToolInput input={part.input} locale={locale} />
      <ToolOutput output={part.state === "output-available" ? part.output : undefined} errorText={part.state === "output-error" ? part.errorText : undefined} locale={locale} />
    </ToolContent>}
    {part.state === "approval-requested" ? <ToolApproval message={message} part={part} locale={locale} onToolApproval={onToolApproval} /> : null}
  </Tool>;
}

function WorkflowOutput({ part, locale, onArtifactDownload, onMediaOpen, resolveMediaSource }: {
  readonly part: Extract<DesktopUIMessagePart, { type: "data-workflow" }>;
  readonly locale: "zh" | "en";
  readonly onArtifactDownload?: WorkbenchMessageSurfaceProps["onArtifactDownload"];
  readonly onMediaOpen?: WorkbenchMessageSurfaceProps["onMediaOpen"];
  readonly resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"];
}) {
  const output = part.data.output;
  const outputText = typeof output === "string" ? output : output && typeof output === "object" && "text" in output && typeof output.text === "string" ? output.text : undefined;
  const outputMedia = part.data.media ?? (output && typeof output === "object" && "media" in output && Array.isArray(output.media) ? output.media.filter((item): item is DesktopMediaData => Boolean(item && typeof item === "object" && "kind" in item && "artifactId" in item)) : []);
  const fallback = outputText === undefined && outputMedia.length === 0 && output !== undefined ? JSON.stringify(output, null, 2) : undefined;
  return <section className="ai-elements-message-group wb-ai-workflow-output" data-message-group="workflow-output" data-slot="message-group" aria-label={locale === "zh" ? "工作流输出" : "Workflow output"}>
    <Task title={part.data.title ?? part.data.nodeId} status={status(part.data.status)} locale={locale} />
    {outputText ? <MessageResponse content={outputText} /> : null}
    {fallback ? <CodeBlock code={fallback} language="json" /> : null}
    {outputMedia.length ? <div className="wb-ai-media-results" data-slot="media-results">{outputMedia.map((media) => <div key={media.artifactId}>{renderMedia(media, locale, onMediaOpen, onArtifactDownload, resolveMediaSource)}</div>)}</div> : null}
  </section>;
}

function MessageUsage({ message, usages, locale }: { message: DesktopUIMessage; usages: readonly Extract<DesktopUIMessagePart, { type: "data-usage" }>[]; locale: "zh" | "en" }) {
  const runId = usages[0]?.data.runId ?? message.metadata?.runId ?? message.id;
  const metrics = toRunMetrics(usages.reduce((state, part, index) => applyRunMetricsEvent(state, {
    ...part.data,
    kind: "usage",
    usageId: part.data.usageId ?? part.id ?? `${message.id}:usage:${index}`,
    aggregation: part.data.aggregation ?? "delta",
    scope: part.data.scope ?? "step",
    // Parts are chronological; retain their order when selecting the latest snapshot.
    createdAt: String(index).padStart(16, "0"),
  }), createRunMetricsAccumulator(runId)));
  const total = metrics.tokens.input === undefined && metrics.tokens.output === undefined
    ? undefined
    : (metrics.tokens.input ?? 0) + (metrics.tokens.output ?? 0);
  const unavailable = locale === "zh" ? "未提供" : "Not provided";
  const format = (value: number | undefined) => value === undefined ? unavailable : value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
  const rows = [
    [locale === "zh" ? "输入" : "Input", metrics.tokens.input],
    [locale === "zh" ? "输出" : "Output", metrics.tokens.output],
    [locale === "zh" ? "推理" : "Reasoning", metrics.tokens.reasoning],
    [locale === "zh" ? "缓存输入" : "Cached input", metrics.tokens.cachedInput],
  ] as const;
  return <details className="wb-run-metrics" data-slot="usage-summary" data-completeness={metrics.completeness}>
    <summary aria-label={locale === "zh" ? "本轮 Token 用量" : "Turn token usage"}>
      <span>{total === undefined ? (locale === "zh" ? "Token 未提供" : "Token unavailable") : `${format(total)} Token`}</span>
      <span className="wb-run-metrics-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="wb-run-metrics-detail">
      {metrics.model ? <span className="wb-run-metrics-model">{metrics.model}</span> : null}
      <div className="wb-run-metrics-grid">{rows.map(([label, value]) => <div key={label} className="wb-run-metrics-row"><span>{label}</span><strong>{format(value)}</strong></div>)}</div>
    </div>
  </details>;
}

function MessageParts({ message, locale, streaming, completed, workflowAi = false, onArtifactOpen, onArtifactDownload, onMediaOpen, resolveMediaSource, resolveArtifactSource, resolvePreviewSource, onPreviewRefresh, onPreviewDownload, onPreviewExport, onPreviewOpenExternal, onToolApproval }: Pick<WorkbenchMessageSurfaceProps, "onArtifactOpen" | "onArtifactDownload" | "onMediaOpen" | "resolveMediaSource" | "resolveArtifactSource" | "resolvePreviewSource" | "onPreviewRefresh" | "onPreviewDownload" | "onPreviewExport" | "onPreviewOpenExternal" | "onToolApproval" | "workflowAi"> & { message: DesktopUIMessage; locale: "zh" | "en"; streaming: boolean; completed: boolean }) {
  const entries = useMemo(() => groupProcessActivityParts(message.parts, { active: streaming, workflowAi }), [message.parts, streaming, workflowAi]);
  const activity = useMemo(() => messageActivityProjection(message, locale, streaming, workflowAi, entries), [message, locale, streaming, workflowAi, entries]);
  const disclosures = useToolActivityDisclosures(entries);
  const artifacts = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-artifact" }> => part.type === "data-artifact");
  const usages = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-usage" }> => part.type === "data-usage");
  const runMetrics = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-runMetrics" }> => part.type === "data-runMetrics").at(-1);
  const activePart = activity.activePart;
  const renderToolDetails = (part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>) => <Tool open status={part.state === "output-error" ? "failed" : part.state === "output-available" ? "completed" : part.state === "output-denied" ? "denied" : "running"}>
    {workflowAi ? <ToolContent><WorkflowAiToolSummary part={part} locale={locale} /></ToolContent> : <ToolContent><ToolInput input={part.input} locale={locale} /><ToolOutput output={part.state === "output-available" ? part.output : undefined} errorText={part.state === "output-error" ? part.errorText : undefined} locale={locale} /></ToolContent>}
  </Tool>;
  const partKey = (part: DesktopUIMessagePart, index: number) => {
    if (part.type === "text" || part.type === "reasoning") return String(part.providerMetadata?.coworkany?.partId ?? `${part.type}:${index}`);
    if (part.type === "dynamic-tool") return `tool:${part.toolCallId}`;
    if (part.type === "source-url" || part.type === "source-document") return `source:${part.sourceId}`;
    if (part.type === "file") return `file:${part.filename ?? index}`;
    if (part.type.startsWith("data-") && "id" in part) return String(part.id ?? `${part.type}:${index}`);
    return `${part.type}:${index}`;
  };

  const workflowSummaries = (entry: Extract<ProcessActivityEntry, { type: "tool-group" }>) => workflowAi
    ? entry.parts.filter((part, index) => (part.state === "output-available" || part.state === "output-error") && !(disclosures.groupOpen(entry.parts, entry.memberIds) && disclosures.callOpen(entry.memberIds?.[index] ?? `tool:${part.toolCallId}`)))
    : [];
  const renderEntry = (entry: ProcessActivityEntry) => {
        if (entry.type === "process-group") return <ToolActivityGroup key={`process-group:${entry.id}:${entry.members[0]?.index}`} members={entry.members} parts={entry.members.flatMap((member) => member.part.type === "dynamic-tool" ? [member.part] : [])} active={streaming} locale={locale} disclosures={disclosures} />;
        if (entry.type === "tool-group") return <ToolActivityGroup key={`tool-group:${entry.id}`} parts={entry.parts} memberIds={entry.memberIds} locale={locale} disclosures={disclosures}>
          {workflowSummaries(entry).map((part) => <WorkflowAiToolSummary key={part.toolCallId} part={part} locale={locale} />)}
        </ToolActivityGroup>;
        const { part, index } = entry;
        const key = partKey(part, index);
        const active = streaming && index === activity.activeIndex;
        if (part.type === "text" && message.role === "assistant" && !part.text.trim()) return null;
        if (part.type === "text") return message.role === "user"
          ? <MessagePlainText key={key} content={part.text} />
          : <MessageResponse key={key} content={part.text} streaming={active} data-streaming={active ? "true" : undefined} />;
        if (part.type === "reasoning") return null;
        if (part.type === "dynamic-tool") return <OrderedTool key={key} message={message} part={part} locale={locale} onToolApproval={onToolApproval} workflowAi={workflowAi} />;
        if (part.type === "data-task") return <OrderedTask key={key} part={part} locale={locale} />;
        if (part.type === "source-url" || part.type === "source-document") {
          const title = part.type === "source-url" ? part.title ?? part.url : part.title;
          const href = part.type === "source-url" ? part.url : undefined;
          return <Sources key={key}><SourcesTrigger count={1}>{locale === "zh" ? "已使用 1 个来源" : "Used 1 sources"}</SourcesTrigger><SourcesContent><Source title={title} href={href}><InlineCitation title={title} href={href}>{title}</InlineCitation></Source></SourcesContent></Sources>;
        }
        if (part.type === "file") return <WorkbenchAttachments key={key} attachments={[{ id: key, name: part.filename ?? "Attachment", mediaType: part.mediaType, uri: part.url, status: "ready" }]} variant="grid" locale={locale} />;
        if (part.type === "data-attachment") return <WorkbenchAttachments key={key} attachments={[{ id: part.id ?? key, name: part.data.name, mediaType: part.data.mediaType, uri: part.data.uri, status: part.data.status }]} variant="grid" locale={locale} />;
        if (part.type === "data-media") return <div key={key} className="wb-ai-media-results" data-slot="media-results">{renderMedia(part.data, locale, onMediaOpen, onArtifactDownload, resolveMediaSource)}</div>;
        if (part.type === "data-report") return <section key={key} className="wb-ai-report" data-slot="report-results"><strong>{part.data.title}</strong>{part.data.body ? <><MessageResponse content={part.data.body} /><CodeBlock code={part.data.body} language="markdown" /></> : null}</section>;
        if (part.type === "data-workflow") return <WorkflowOutput key={key} part={part} locale={locale} onArtifactDownload={onArtifactDownload} onMediaOpen={onMediaOpen} resolveMediaSource={resolveMediaSource} />;
        if (part.type === "data-preview") {
          const previewArtifactCandidates = part.data.engine === "ppt-master" && !part.data.artifactId
            ? artifacts.filter((artifact) => artifact.data.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || artifact.data.relativePath.toLowerCase().endsWith(".pptx"))
            : [];
          const preview = previewArtifactCandidates.length === 1
            ? { ...part.data, artifactId: previewArtifactCandidates[0]?.data.id, relativePath: previewArtifactCandidates[0]?.data.relativePath, mimeType: previewArtifactCandidates[0]?.data.mimeType }
            : part.data;
          return <div key={key} className="wb-ai-preview-results" data-slot="preview-results"><WorkbenchPreview preview={preview} locale={locale} context={{ messageId: message.id, conversationId: message.metadata?.conversationId, runId: message.metadata?.runId }} resolveSource={resolvePreviewSource} onRefresh={onPreviewRefresh} onDownload={onPreviewDownload} onExport={onPreviewExport} onOpenExternal={onPreviewOpenExternal} /></div>;
        }
        if (part.type === "data-artifact") {
          const displayName = artifactDisplayName(part.data.title, part.data.relativePath);
          return <div key={key} className="wb-ai-artifact-results" data-slot="artifact-results"><div className="wb-ai-artifact-item"><Artifact className="wb-ai-artifact-card"><ArtifactHeader><div className="ai-elements-artifact-heading"><ArtifactTitle>{displayName}</ArtifactTitle><ArtifactDescription>{part.data.mimeType}</ArtifactDescription></div><ArtifactActions><ArtifactAction label={locale === "zh" ? "下载产物" : "Download artifact"} tooltip={locale === "zh" ? "下载" : "Download"} icon={Download} onClick={() => onArtifactDownload?.(part.data.id)} /></ArtifactActions></ArtifactHeader><ArtifactContent onClick={() => onArtifactOpen?.(part.data)}>{renderArtifactMedia(part.data, locale, onArtifactOpen, onArtifactDownload, resolveMediaSource, resolveArtifactSource)}</ArtifactContent></Artifact></div></div>;
        }
        if (part.type === "data-warning") return <div key={key} className="wb-ai-warning-results" data-slot="warning-results"><strong>{part.data.code}</strong><span>{part.data.message}</span></div>;
        if (part.type === "data-status" || part.type === "data-writerAsset" || part.type === "data-usage" || part.type === "data-runMetrics") return null;
        if (part.type.startsWith("data-") && !HANDLED_DATA_PARTS.has(part.type)) return <div key={key} className="wb-ai-unavailable-part">{locale === "zh" ? "部分内容暂不可用" : "Some content is unavailable"}</div>;
        return null;
  };
  return <>
    <div className="wb-ai-message-output" data-slot="message-output" data-message-order="chronological">
      {entries.map((entry) => {
        const content = renderEntry(entry);
        if (!content || message.role === "user") return content;
        const kind = entry.type === "process-group" ? "process"
          : entry.type === "tool-group" ? (workflowAi && entry.parts.some((part) => part.state === "output-available" || part.state === "output-error") ? "primary" : "process")
          : ["text", "file", "data-attachment", "data-media", "data-report", "data-workflow", "data-preview", "data-artifact"].includes(entry.part.type) ? "primary" : "boundary";
        return <div className="wb-ai-output-block" data-output-kind={kind} key={content.key}>{content}</div>;
      })}
      {message.role === "assistant" && streaming && !activity.groupedToolActivity ? <MessageActivity part={activePart} locale={locale} /> : null}
    </div>
    <ToolActivityPortals entries={entries} locale={locale} disclosures={disclosures} renderDetails={renderToolDetails} copyDetails={!workflowAi} callLabel={workflowAi ? (part) => workflowAiToolLabel(part.toolName, locale) : undefined} />
    {completed && runMetrics ? <div className="wb-ai-usage-results" data-slot="run-metrics-results"><WorkbenchRunMetrics metrics={runMetrics.data} locale={locale} /></div> : completed && usages.length ? <div className="wb-ai-usage-results" data-slot="usage-results"><MessageUsage message={message} usages={usages} locale={locale} /></div> : null}
  </>;
}

export function WorkbenchMessageSurface({ messages, locale = "zh", pendingMessageId, className = "", onCopy, onRetry, renderAssistantActions, onArtifactOpen, onArtifactDownload, onMediaOpen, resolveMediaSource, resolveArtifactSource, resolvePreviewSource, onPreviewRefresh, onPreviewDownload, onPreviewExport, onPreviewOpenExternal, onToolApproval, workflowAi = false, emptyState, onReachTop, onViewportScroll, scrollStateKey, restoreScrollTop }: WorkbenchMessageSurfaceProps) {
  const orderedBaseMessages = orderMessagesForTimeline(messages);
  const latestMessage = orderedBaseMessages.at(-1);
  const pendingMessagePresent = Boolean(pendingMessageId && messages.some((message) => message.id === pendingMessageId));
  const effectivePendingMessageId = pendingMessageId && !pendingMessagePresent && latestMessage?.role === "assistant"
    ? latestMessage.id
    : pendingMessageId;
  const shouldCreatePendingAssistant = Boolean(
    pendingMessageId
      && !pendingMessagePresent
      && (!latestMessage || latestMessage.role === "user"),
  );
  const timelineMessages = shouldCreatePendingAssistant
    ? [...messages, createPendingAssistantMessage(pendingMessageId!, messages)]
    : messages;
  const orderedMessages = shouldCreatePendingAssistant ? orderMessagesForTimeline(timelineMessages) : orderedBaseMessages;
  const turns = groupMessagesIntoTurns(orderedMessages);
  const activeAssistant = [...orderedMessages].reverse().find((message) => message.role === "assistant" && (effectivePendingMessageId === message.id || message.metadata?.runStatus === "running"));
  const activeAssistantStreaming = Boolean(activeAssistant && (effectivePendingMessageId === activeAssistant.id || activeAssistant.metadata?.runStatus === "running"));
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyMessage = async (message: DesktopUIMessage) => {
    if (!onCopy) return;
    await onCopy(message);
    setCopiedMessageId(message.id);
    globalThis.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400);
  };
  const renderMessage = (message: DesktopUIMessage) => {
    const pending = effectivePendingMessageId === message.id;
    // Persisted UIMessage text parts may retain the stream state from
    // the last delta. The transport/run metadata is the authoritative
    // lifecycle signal for the desktop surface.
    const streaming = pending || message.metadata?.runStatus === "running";
    const currentStatus = messageStatus(message, pending);
    const featureActions = message.role === "assistant" ? renderAssistantActions?.(message) : null;
    const copyLabel = copiedMessageId === message.id
      ? (locale === "zh" ? "已复制" : "Copied")
      : (locale === "zh" ? "复制消息" : "Copy message");
    const hasActions = Boolean(onCopy || (onRetry && message.role === "assistant") || featureActions);
    return <div className={`wb-ai-message-row wb-ai-message-row-${message.role}`} data-message-id={message.id} key={message.id}>
      {message.role === "assistant" ? <RoleAvatar role="assistant" locale={locale} /> : null}
      <Message from={message.role === "user" ? "user" : "assistant"} data-model-id={message.metadata?.modelId} data-message-status={currentStatus} data-streaming={streaming ? "true" : "false"} aria-busy={streaming || undefined}>
        <MessageContent className={streaming ? "wb-ai-message-content-streaming" : undefined}>
          <MessageTimestamp message={message} locale={locale} />
          <MessageParts message={message} locale={locale} streaming={streaming} completed={currentStatus === "completed"} workflowAi={workflowAi} onArtifactOpen={onArtifactOpen} onArtifactDownload={onArtifactDownload} onMediaOpen={onMediaOpen} resolveMediaSource={resolveMediaSource} resolveArtifactSource={resolveArtifactSource} resolvePreviewSource={resolvePreviewSource} onPreviewRefresh={onPreviewRefresh} onPreviewDownload={onPreviewDownload} onPreviewExport={onPreviewExport} onPreviewOpenExternal={onPreviewOpenExternal} onToolApproval={onToolApproval} />
        </MessageContent>
        {hasActions ? <MessageToolbar>
          <MessageActions>
            {onCopy ? <MessageAction label={copyLabel} title={copyLabel} onClick={() => void copyMessage(message)}>{copiedMessageId === message.id ? "✓" : undefined}</MessageAction> : null}
            {onRetry && message.role === "assistant" ? <MessageAction label={locale === "zh" ? "重试" : "Retry"} onClick={() => void onRetry(message)} disabled={streaming}>↻</MessageAction> : null}
            {featureActions}
          </MessageActions>
        </MessageToolbar> : null}
      </Message>
      {message.role === "user" ? <RoleAvatar role="user" locale={locale} /> : null}
    </div>;
  };
  return <>
    <MessageActivityAnnouncement message={activeAssistant} locale={locale} streaming={activeAssistantStreaming} workflowAi={workflowAi} />
    <Conversation className={`wb-ai-message-surface ${className}`.trim()} data-uimessage-surface="true" autoScroll={restoreScrollTop === undefined} scrollButtonLabel={locale === "zh" ? "滚动到最新消息" : "Scroll to latest"} scrollToBottomKey={orderedMessages.at(-1) ? workbenchMessageActivityRevision(orderedMessages.at(-1)!) : null} onReachTop={onReachTop} onViewportScroll={onViewportScroll} restoreScrollTop={restoreScrollTop} scrollStateKey={scrollStateKey}>
      <ConversationContent>
        {!turns.length ? <ConversationEmptyState>{emptyState ?? (locale === "zh" ? "开始一段新的对话" : "Start a new conversation")}</ConversationEmptyState> : turns.map((turn, index) => <section className="ai-elements-message-turn wb-ai-message-turn" data-message-turn-id={turn.id} data-turn-index={index} key={turn.id}>
          {turn.user ? renderMessage(turn.user) : null}
          {turn.assistants.map(renderMessage)}
        </section>)}
      </ConversationContent>
    </Conversation>
  </>;
}
