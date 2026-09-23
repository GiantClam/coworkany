"use client";

import React, { useEffect, useState, type ReactNode } from "react";
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
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextCacheUsage,
  ContextTrigger,
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
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Shimmer,
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
import { createDesktopUIMessage, type DesktopArtifactData, type DesktopMediaData, type DesktopRunStatus, type DesktopUIMessage, type DesktopUIMessagePart } from "@coworkany/workbench-client";
import { artifactDisplayName } from "./artifact-label";
import { formatWorkbenchMessageTimestamp, workbenchMessageTimestampLabel } from "./message-time";

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
  readonly onArtifactOpen?: (artifact: DesktopArtifactData) => void;
  readonly onArtifactDownload?: (artifactId: string) => void;
  readonly onMediaOpen?: (media: DesktopMediaData) => void;
  /** Resolve a workspace-relative media path into a browser-readable URL. */
  readonly resolveMediaSource?: (media: DesktopMediaData) => Promise<WorkbenchMediaSource | null>;
  /** Resolve a workspace-relative artifact into a preview URL and, when safe, text content. */
  readonly resolveArtifactSource?: (artifact: DesktopArtifactData) => Promise<WorkbenchArtifactSource | null>;
  readonly onToolApproval?: (message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") => void | Promise<void>;
  readonly emptyState?: ReactNode;
};

export type WorkbenchMediaSource = string | { readonly url: string; readonly revoke?: () => void };
export type WorkbenchArtifactSource = {
  readonly url?: string;
  readonly text?: string;
  readonly mimeType?: string;
  readonly revoke?: () => void;
};

const HANDLED_DATA_PARTS = new Set([
  "data-artifact",
  "data-writerAsset",
  "data-attachment",
  "data-media",
  "data-report",
  "data-status",
  "data-task",
  "data-usage",
  "data-warning",
  "data-workflow",
]);

function status(value: DesktopRunStatus): "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" {
  return value;
}

function textParts(message: DesktopUIMessage) {
  return message.parts
    .filter((part): part is Extract<DesktopUIMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part);
}

function processParts(message: DesktopUIMessage) {
  // Run status is surfaced by the composer and Task Center. It is transport
  // metadata, not a conversational message, so keep it out of the transcript.
  return message.parts.filter((part) => part.type === "reasoning" || part.type === "dynamic-tool" || part.type === "data-task");
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

function artifactPreviewKind(artifact: DesktopArtifactData): "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "file" {
  const mimeType = artifact.mimeType.toLowerCase().split(";", 1)[0] ?? "";
  const extension = artifactExtension(artifact);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown" || ["md", "markdown", "mdown"].includes(extension)) return "markdown";
  if (mimeType.startsWith("text/") || ["json", "csv", "tsv", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css"].includes(extension)) return "text";
  return "file";
}

function artifactKindLabel(kind: ReturnType<typeof artifactPreviewKind>, locale: "zh" | "en") {
  if (locale === "en") return kind === "markdown" ? "Markdown" : kind === "text" ? "Text" : kind === "pdf" ? "PDF" : kind === "image" ? "Image" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : "File";
  return kind === "markdown" ? "Markdown 文档" : kind === "text" ? "文本文件" : kind === "pdf" ? "PDF 文档" : kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文件";
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
    if (!resolveArtifactSource || !artifact.relativePath || kind === "image" || kind === "video" || kind === "audio") return () => undefined;
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
  return <ArtifactFilePreview artifact={artifact} kind={kind} locale={locale} loading={Boolean(resolveArtifactSource && artifact.relativePath) && !source && !previewError} error={previewError} />;
}

function renderArtifactMedia(artifact: DesktopArtifactData, locale: "zh" | "en", onOpen?: (artifact: DesktopArtifactData) => void, onDownload?: (artifactId: string) => void, resolveMediaSource?: WorkbenchMessageSurfaceProps["resolveMediaSource"], resolveArtifactSource?: WorkbenchMessageSurfaceProps["resolveArtifactSource"]) {
  return <ResolvedArtifactPreview artifact={artifact} locale={locale} onOpen={onOpen} onDownload={onDownload} resolveMediaSource={resolveMediaSource} resolveArtifactSource={resolveArtifactSource} />;
}

function ExecutionParts({ message, locale, streaming, waiting = false, onToolApproval }: { message: DesktopUIMessage; locale: "zh" | "en"; streaming: boolean; waiting?: boolean; onToolApproval?: WorkbenchMessageSurfaceProps["onToolApproval"] }) {
    const process = processParts(message);
    if (!process.length && !waiting) return null;
    if (!process.length && waiting) {
      return <section className="ai-elements-message-group wb-ai-message-execution" data-message-group="execution-process" data-slot="message-group" aria-label={locale === "zh" ? "执行过程" : "Execution process"}>
        <Reasoning status="running" isStreaming locale={locale}>
          <ReasoningTrigger />
          <ReasoningContent><Shimmer>{locale === "zh" ? "正在等待模型响应…" : "Waiting for the model response…"}</Shimmer></ReasoningContent>
        </Reasoning>
      </section>;
    }
    const reasoningParts = process.filter((part): part is Extract<DesktopUIMessagePart, { type: "reasoning" }> => part.type === "reasoning");
    const reasoningText = reasoningParts.map((part) => part.text.trim()).filter(Boolean).join("\n\n");
    const lastPart = message.parts.at(-1);
    const reasoningStreaming = streaming && lastPart?.type === "reasoning";
    const reasoningStatus = reasoningStreaming ? "running" as const : "completed" as const;
    let reasoningRendered = false;
    return <section className="ai-elements-message-group wb-ai-message-execution" data-message-group="execution-process" data-slot="message-group" aria-label={locale === "zh" ? "执行过程" : "Execution process"}>
      {process.map((part) => {
        if (part.type === "reasoning") {
          if (reasoningRendered) return null;
          reasoningRendered = true;
          return <Reasoning key={`reasoning:${message.id}`} status={reasoningStatus} isStreaming={reasoningStreaming} locale={locale}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>;
      }
      if (part.type === "data-task") {
        const taskStatus = status(part.data.status);
        return <Task key={part.id} defaultOpen={taskStatus === "running" || taskStatus === "waiting"} status={taskStatus} data-status={taskStatus}>
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
      if (part.type === "dynamic-tool") {
        const toolStatus = part.state === "approval-requested" ? "waiting" : part.state === "output-available" ? "completed" : part.state === "output-error" ? "failed" : part.state === "output-denied" ? "denied" : "running";
        return <Tool key={`tool:${part.toolCallId}`} defaultOpen={part.state === "approval-requested"} status={toolStatus}>
          <ToolHeader type="dynamic-tool" toolName={part.toolName} toolCallId={part.toolCallId} state={part.state} locale={locale} />
          <ToolContent>
            <ToolInput input={part.input} locale={locale} />
            <ToolOutput output={part.state === "output-available" ? part.output : undefined} errorText={part.state === "output-error" ? part.errorText : undefined} locale={locale} />
            {part.state === "approval-requested" ? <Confirmation state="approval-requested" approval={{ id: part.approval?.id ?? part.toolCallId }}>
              <ConfirmationTitle>{locale === "zh" ? (part.approval?.id ? `需要审批：${part.approval.id}` : "此工具调用需要审批") : (part.approval?.id ? `Approval required: ${part.approval.id}` : "This tool call requires approval")}</ConfirmationTitle>
              <ConfirmationRequest><ConfirmationActions><ConfirmationAction onClick={() => void (onToolApproval ? onToolApproval(message, part, "reject") : emitToolApproval(message, part, "reject"))}>{locale === "zh" ? "拒绝" : "Reject"}</ConfirmationAction><ConfirmationAction onClick={() => void (onToolApproval ? onToolApproval(message, part, "approve") : emitToolApproval(message, part, "approve"))}>{locale === "zh" ? "批准" : "Approve"}</ConfirmationAction></ConfirmationActions></ConfirmationRequest>
            </Confirmation> : null}
          </ToolContent>
        </Tool>;
      }
      return null;
    })}
  </section>;
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

function MessageParts({ message, locale, streaming, onArtifactOpen, onArtifactDownload, onMediaOpen, resolveMediaSource, resolveArtifactSource, onToolApproval }: Pick<WorkbenchMessageSurfaceProps, "onArtifactOpen" | "onArtifactDownload" | "onMediaOpen" | "resolveMediaSource" | "resolveArtifactSource" | "onToolApproval"> & { message: DesktopUIMessage; locale: "zh" | "en"; streaming: boolean }) {
  const sources = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "source-url" | "source-document" }> => part.type === "source-url" || part.type === "source-document");
  const artifacts = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-artifact" }> => part.type === "data-artifact");
  const media = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-media" }> => part.type === "data-media");
  const files = message.parts.flatMap((part, index) => {
    if (part.type === "file") return [{ id: `file:${index}`, name: part.filename ?? "Attachment", mediaType: part.mediaType, uri: part.url, status: "ready" as const }];
    if (part.type === "data-attachment") return [{ id: part.id ?? `attachment:${index}`, name: part.data.name, mediaType: part.data.mediaType, uri: part.data.uri, status: part.data.status }];
    return [];
  });
  const reports = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-report" }> => part.type === "data-report");
  const workflows = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-workflow" }> => part.type === "data-workflow");
  const warnings = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-warning" }> => part.type === "data-warning");
  const usages = message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "data-usage" }> => part.type === "data-usage");
  const text = textParts(message);
  const waitingForAssistant = message.role === "assistant" && streaming && !text.length && !processParts(message).length;

  return <>
    {sources.length ? <Sources>
      <SourcesTrigger count={sources.length}>{locale === "zh" ? `已使用 ${sources.length} 个来源` : `Used ${sources.length} sources`}</SourcesTrigger>
      <SourcesContent>{sources.map((part) => { const title = part.type === "source-url" ? part.title ?? part.url : part.title; const href = part.type === "source-url" ? part.url : undefined; return <Source key={part.sourceId} title={title} href={href}><InlineCitation title={title} href={href}>{title}</InlineCitation></Source>; })}</SourcesContent>
    </Sources> : null}
    {message.role === "assistant" ? <ExecutionParts message={message} locale={locale} streaming={streaming} waiting={waitingForAssistant} onToolApproval={onToolApproval} /> : null}
    {files.length ? <WorkbenchAttachments attachments={files} variant="grid" locale={locale} /> : null}
    {media.length ? <div className="wb-ai-media-results" data-slot="media-results">{media.map((part) => <div key={part.id}>{renderMedia(part.data, locale, onMediaOpen, onArtifactDownload, resolveMediaSource)}</div>)}</div> : null}
    <div className="wb-ai-message-output" data-slot="message-output">
      {text.map((part, index) => message.role === "user"
        ? <MessagePlainText key={`text:${index}`} content={part.text} />
        : <MessageResponse key={`text:${index}`} content={part.text} streaming={streaming} data-streaming={streaming ? "true" : undefined} />)}
      {!text.length && message.role === "assistant" && streaming && !waitingForAssistant ? <MessageResponse><Shimmer>{locale === "zh" ? "正在生成…" : "Generating…"}</Shimmer></MessageResponse> : null}
      {reports.length ? <div className="wb-ai-report-results" data-slot="report-results">{reports.map((part) => <section key={part.id} className="wb-ai-report"><strong>{part.data.title}</strong>{part.data.body ? <><MessageResponse content={part.data.body} /><CodeBlock code={part.data.body} language="markdown" /></> : null}</section>)}</div> : null}
      {workflows.map((part) => <WorkflowOutput key={part.id} part={part} locale={locale} onArtifactDownload={onArtifactDownload} onMediaOpen={onMediaOpen} resolveMediaSource={resolveMediaSource} />)}
      {artifacts.length ? <div className="wb-ai-artifact-results" data-slot="artifact-results">{artifacts.map((part) => { const displayName = artifactDisplayName(part.data.title, part.data.relativePath); return <div key={part.id} className="wb-ai-artifact-item"><Artifact className="wb-ai-artifact-card"><ArtifactHeader><div className="ai-elements-artifact-heading"><ArtifactTitle>{displayName}</ArtifactTitle><ArtifactDescription>{part.data.mimeType}</ArtifactDescription></div><ArtifactActions><ArtifactAction label={locale === "zh" ? "下载产物" : "Download artifact"} tooltip={locale === "zh" ? "下载" : "Download"} icon={Download} onClick={() => onArtifactDownload?.(part.data.id)} /></ArtifactActions></ArtifactHeader><ArtifactContent onClick={() => onArtifactOpen?.(part.data)}>{renderArtifactMedia(part.data, locale, onArtifactOpen, onArtifactDownload, resolveMediaSource, resolveArtifactSource)}</ArtifactContent></Artifact></div>; })}</div> : null}
      {usages.length ? <div className="wb-ai-usage-results" data-slot="usage-results">{usages.map((part) => { const usedTokens = (part.data.inputTokens ?? 0) + (part.data.outputTokens ?? 0); return <Context key={part.id} usedTokens={usedTokens} maxTokens={Math.max(usedTokens, 1)} usage={part.data} modelId={message.metadata?.modelId}><ContextTrigger aria-label="Model context usage" /><ContextContent><ContextContentHeader /><ContextContentBody><ContextInputUsage /><ContextOutputUsage /><ContextReasoningUsage /><ContextCacheUsage /></ContextContentBody></ContextContent></Context>; })}</div> : null}
      {warnings.length ? <div className="wb-ai-warning-results" data-slot="warning-results" role="status">{warnings.map((part) => <div key={part.id}><strong>{part.data.code}</strong><span>{part.data.message}</span></div>)}</div> : null}
      {message.parts.some((part) => part.type.startsWith("data-") && !HANDLED_DATA_PARTS.has(part.type)) ? <div className="wb-ai-unavailable-part" role="status">{locale === "zh" ? "部分内容暂不可用" : "Some content is unavailable"}</div> : null}
    </div>
  </>;
}

export function WorkbenchMessageSurface({ messages, locale = "zh", pendingMessageId, className = "", onCopy, onRetry, renderAssistantActions, onArtifactOpen, onArtifactDownload, onMediaOpen, resolveMediaSource, resolveArtifactSource, onToolApproval, emptyState, onReachTop, onViewportScroll, scrollStateKey, restoreScrollTop }: WorkbenchMessageSurfaceProps) {
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
    const hasActions = Boolean(onCopy || (onRetry && message.role === "assistant") || featureActions || streaming);
    return <div className={`wb-ai-message-row wb-ai-message-row-${message.role}`} data-message-id={message.id} key={message.id}>
      {message.role === "assistant" ? <RoleAvatar role="assistant" locale={locale} /> : null}
      <Message from={message.role === "user" ? "user" : "assistant"} data-model-id={message.metadata?.modelId} data-message-status={currentStatus} data-streaming={streaming ? "true" : "false"}>
        <MessageContent className={streaming ? "wb-ai-message-content-streaming" : undefined}>
          <MessageTimestamp message={message} locale={locale} />
          <MessageParts message={message} locale={locale} streaming={streaming} onArtifactOpen={onArtifactOpen} onArtifactDownload={onArtifactDownload} onMediaOpen={onMediaOpen} resolveMediaSource={resolveMediaSource} resolveArtifactSource={resolveArtifactSource} onToolApproval={onToolApproval} />
        </MessageContent>
        {hasActions ? <MessageToolbar>
          <MessageActions>
            {onCopy ? <MessageAction label={copyLabel} title={copyLabel} onClick={() => void copyMessage(message)}>{copiedMessageId === message.id ? "✓" : undefined}</MessageAction> : null}
            {onRetry && message.role === "assistant" ? <MessageAction label={locale === "zh" ? "重试" : "Retry"} onClick={() => void onRetry(message)} disabled={streaming}>↻</MessageAction> : null}
            {featureActions}
            {streaming ? <span className="wb-ai-streaming-indicator" aria-live="polite"><Shimmer>{locale === "zh" ? "生成中…" : "Streaming…"}</Shimmer></span> : null}
          </MessageActions>
        </MessageToolbar> : null}
      </Message>
      {message.role === "user" ? <RoleAvatar role="user" locale={locale} /> : null}
    </div>;
  };
  return <Conversation className={`wb-ai-message-surface ${className}`.trim()} data-uimessage-surface="true" autoScroll={restoreScrollTop === undefined} scrollButtonLabel={locale === "zh" ? "滚动到最新消息" : "Scroll to latest"} scrollToBottomKey={orderedMessages.at(-1)?.id ?? null} onReachTop={onReachTop} onViewportScroll={onViewportScroll} restoreScrollTop={restoreScrollTop} scrollStateKey={scrollStateKey}>
    <ConversationContent>
      {!turns.length ? <ConversationEmptyState>{emptyState ?? (locale === "zh" ? "开始一段新的对话" : "Start a new conversation")}</ConversationEmptyState> : turns.map((turn, index) => <section className="ai-elements-message-turn wb-ai-message-turn" data-message-turn-id={turn.id} data-turn-index={index} key={turn.id}>
        {turn.user ? renderMessage(turn.user) : null}
        {turn.assistants.map(renderMessage)}
      </section>)}
    </ConversationContent>
  </Conversation>;
}
