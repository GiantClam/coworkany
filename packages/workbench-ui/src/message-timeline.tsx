"use client";

import React, { useState, type ReactNode } from "react";
import type { WorkbenchArtifact, WorkbenchMessage, WorkbenchMessagePart } from "@coworkany/workbench-client";
import { renderWorkbenchProcessPart } from "./process-parts";
import { artifactDisplayName } from "./artifact-label";
import { formatWorkbenchMessageTimestamp, workbenchMessageTimestampLabel } from "./message-time";
import { Artifact, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle, Checkpoint, Conversation, ConversationContent, ConversationEmptyState, Message, MessageAction, MessageActions, MessageContent, MessagePlainText, MessageResponse, MessageToolbar, Source, Shimmer } from "./ai-elements/index";

export type WorkbenchMessageTimelineProps<TMessage extends WorkbenchMessage = WorkbenchMessage> = {
  messages: readonly TMessage[];
  locale?: "zh" | "en";
  pendingMessageId?: string;
  className?: string;
  onCopy?: (message: TMessage) => void | Promise<void>;
  onArtifactOpen?: (artifact: WorkbenchArtifact) => void;
  onToolApproval?: (part: Extract<WorkbenchMessagePart, { type: "tool-call" }>, decision: "approve" | "reject") => void;
  checkpoints?: readonly { readonly id: string; readonly title: string; readonly description?: string }[];
  onCheckpointRestore?: (checkpointId: string) => void;
  onCheckpointBranch?: (checkpointId: string) => void;
  labels?: { readonly user?: string; readonly assistant?: string };
  renderMessage?: (message: TMessage, index: number) => ReactNode;
};

function formatTimelineTime(value: string, locale: "zh" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

function orderedParts(message: WorkbenchMessage): readonly WorkbenchMessagePart[] {
  if (message.parts?.length) return message.parts;
  return message.content ? [{ id: `${message.id}:text`, type: "text", text: message.content }] : [];
}

function timelineActivityRevision(message: WorkbenchMessage | undefined) {
  if (!message) return null;
  const parts = orderedParts(message);
  const lastPart = parts.at(-1);
  const lastPartState = lastPart && "status" in lastPart ? lastPart.status : "";
  const lastPartContent = lastPart?.type === "text" || lastPart?.type === "reasoning" ? lastPart.text.length : "";
  return `${message.id}:${message.status ?? ""}:${parts.length}:${lastPart?.id ?? ""}:${lastPartState}:${lastPartContent}`;
}

function TimelinePart({ part, locale, user = false, onArtifactOpen, onToolApproval }: { part: WorkbenchMessagePart; locale: "zh" | "en"; user?: boolean; onArtifactOpen?: (artifact: WorkbenchArtifact) => void; onToolApproval?: (part: Extract<WorkbenchMessagePart, { type: "tool-call" }>, decision: "approve" | "reject") => void }) {
  const metadata = {
    ...(typeof part.sequence === "number" ? { "data-sequence": part.sequence } : {}),
    ...(part.createdAt ? { "data-created-at": part.createdAt } : {}),
  };
  if (part.type === "text") return user
    ? <MessagePlainText className="wb-chat-user-body wb-timeline-text" content={part.text} {...metadata} />
    : <MessageResponse className="assistant-body wb-timeline-text" content={part.text} {...metadata} />;
  if (part.type === "reasoning") return <div className="wb-timeline-process-part" {...metadata}>{renderWorkbenchProcessPart(part, locale, { onToolApproval })}</div>;
  if (part.type === "plan" || part.type === "task" || part.type === "tool-call") return renderWorkbenchProcessPart(part, locale, { onToolApproval });
  if (part.type === "attachment") return <div className="wb-message-attachment" {...metadata}><span aria-hidden="true">{part.mediaType.startsWith("image/") ? "▧" : "⌕"}</span><span>{part.name}</span><small>{part.mediaType}</small></div>;
  if (part.type === "warning") return <div className="wb-message-event wb-timeline-event" data-status="warning" {...metadata}><span className="wb-event-dot wb-event-running" /><span><strong>{locale === "zh" ? "运行提示" : "Runtime warning"}</strong>{part.message ? ` · ${part.message}` : ""}</span>{part.createdAt ? <time dateTime={part.createdAt}>{formatTimelineTime(part.createdAt, locale)}</time> : null}</div>;
  if (part.type === "tool") return <div className="wb-message-event wb-timeline-event" data-status={part.status} {...metadata}><span className={`wb-event-dot wb-event-${part.status}`} /><span><strong>{part.tool}</strong>{part.message ? ` · ${part.message}` : ""}</span>{part.createdAt ? <time dateTime={part.createdAt}>{formatTimelineTime(part.createdAt, locale)}</time> : null}</div>;
  if (part.type === "status") return <div className="wb-message-event wb-timeline-event" data-status={part.status} {...metadata}><span className={`wb-event-dot wb-event-${part.status}`} /><span>{part.message || part.status}</span>{part.createdAt ? <time dateTime={part.createdAt}>{formatTimelineTime(part.createdAt, locale)}</time> : null}</div>;
  if (part.type === "usage") {
    const inputTokens = part.usage.inputTokens ?? 0;
    const outputTokens = part.usage.outputTokens ?? 0;
    return <div className="wb-message-event wb-timeline-event" data-status="completed" {...metadata}><span className="wb-event-dot wb-event-completed" /><span>{part.usage.model} · {inputTokens} + {outputTokens} {locale === "zh" ? "tokens" : "tokens"}</span>{part.createdAt ? <time dateTime={part.createdAt}>{formatTimelineTime(part.createdAt, locale)}</time> : null}</div>;
  }
  if (part.type === "artifact") { const displayName = artifactDisplayName(part.artifact.title, part.artifact.relativePath); return <Artifact className="wb-artifact-card-wrapper" {...metadata}><ArtifactHeader><ArtifactTitle>{displayName}</ArtifactTitle><ArtifactDescription>{part.artifact.mimeType}</ArtifactDescription></ArtifactHeader><ArtifactContent onClick={() => onArtifactOpen?.(part.artifact)}><button type="button" className="wb-artifact-card" aria-label={`${locale === "zh" ? "打开产物" : "Open artifact"}: ${displayName}`} onClick={(event) => { event.stopPropagation(); onArtifactOpen?.(part.artifact); }}><span className="wb-artifact-name">{displayName}</span>{part.createdAt ? <time dateTime={part.createdAt}>{formatTimelineTime(part.createdAt, locale)}</time> : null}</button></ArtifactContent></Artifact>; }
  if (part.type === "source") return <Source title={part.title} href={part.href} excerpt={part.excerpt} className="wb-message-source" {...metadata} />;
  if (part.type === "report") return <section className="wb-message-report" {...metadata}><strong>{part.title}</strong>{part.body ? <MessageResponse content={part.body} /> : null}</section>;
  return null;
}

function DefaultTimelineMessage({ message, locale, pending, copied, onCopy, onArtifactOpen, onToolApproval, labels }: { message: WorkbenchMessage; locale: "zh" | "en"; pending: boolean; copied: boolean; onCopy?: (message: WorkbenchMessage) => void | Promise<void>; onArtifactOpen?: (artifact: WorkbenchArtifact) => void; onToolApproval?: (part: Extract<WorkbenchMessagePart, { type: "tool-call" }>, decision: "approve" | "reject") => void; labels?: { readonly user?: string; readonly assistant?: string } }) {
  const user = message.role === "user";
  const label = user ? (labels?.user || (locale === "zh" ? "你的指令" : "Your Command")) : (labels?.assistant || "AI RESPONSE");
  const copyLabel = locale === "zh" ? "复制回复" : "Copy reply";
  const parts = orderedParts(message);
  return <Message from={user ? "user" : "assistant"} className={`wb-cloud-message wb-cloud-message-${user ? "user" : "assistant"}`} data-cloud-surface="message" data-message-id={message.id} data-status={message.status}>
    {!user ? <div className="ai-avatar">AI</div> : null}
    <MessageContent className={user ? "message-card-user" : "message-card assistant-message"}>
      <div className={`message-header ${user ? "wb-chat-user-header" : "assistant-message-header"}`}>
        <div className="min-w-0 flex-1"><div className={`dashboard-kicker ${user ? "text-primary" : "text-foreground"}`}>{label}</div><div className="message-time"><time dateTime={message.createdAt} title={workbenchMessageTimestampLabel(locale)}>{formatWorkbenchMessageTimestamp(message.createdAt, locale)}</time></div></div>
      </div>
      <div className="wb-message-ordered-parts" data-message-order="chronological">
        {pending && !parts.length ? <div className="wb-chat-pending" role="status" aria-live="polite"><span className="wb-chat-pending-dot" /><Shimmer>{locale === "zh" ? "正在生成…" : "Generating…"}</Shimmer></div> : parts.map((part) => <TimelinePart key={part.id} part={part} locale={locale} user={user} onArtifactOpen={onArtifactOpen} onToolApproval={onToolApproval} />)}
      </div>
    </MessageContent>
    {!user && message.content && onCopy ? <MessageToolbar><MessageActions className="message-actions message-feedback"><MessageAction label={copyLabel} title={copyLabel} onClick={() => void onCopy(message)} className="message-feedback-btn">{copied ? "✓" : "⧉"}</MessageAction></MessageActions></MessageToolbar> : null}
    {user ? <div className="ai-avatar wb-chat-user-avatar" aria-label={label}>U</div> : null}
  </Message>;
}

export function WorkbenchMessageTimeline<TMessage extends WorkbenchMessage = WorkbenchMessage>({ messages, locale = "zh", pendingMessageId, className = "", onCopy, onArtifactOpen, onToolApproval, checkpoints = [], onCheckpointRestore, onCheckpointBranch, labels, renderMessage }: WorkbenchMessageTimelineProps<TMessage>) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyMessage = async (message: TMessage) => {
    if (!onCopy) return;
    await onCopy(message);
    setCopiedMessageId(message.id);
    globalThis.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400);
  };
  return <Conversation className={`wb-message-timeline ${className}`.trim()} data-cloud-surface="message-timeline" scrollButtonLabel={locale === "zh" ? "滚动到最新消息" : "Scroll to latest"} scrollToBottomKey={timelineActivityRevision(messages.at(-1))}><ConversationContent>{messages.length ? messages.map((message, index) => renderMessage ? <div className="wb-message-timeline-item" key={message.id}>{renderMessage(message, index)}</div> : <DefaultTimelineMessage key={message.id} message={message} locale={locale} pending={message.id === pendingMessageId} copied={copiedMessageId === message.id} onCopy={onCopy ? copyMessage as ((message: WorkbenchMessage) => void | Promise<void>) : undefined} onArtifactOpen={onArtifactOpen} onToolApproval={onToolApproval} labels={labels} />) : <ConversationEmptyState>{locale === "zh" ? "从第一条指令开始" : "Start with your first instruction"}</ConversationEmptyState>}</ConversationContent>{checkpoints.length ? <div className="ai-elements-checkpoints">{checkpoints.map((checkpoint) => <Checkpoint key={checkpoint.id} title={checkpoint.title} description={checkpoint.description} onRestore={() => onCheckpointRestore?.(checkpoint.id)} onBranch={() => onCheckpointBranch?.(checkpoint.id)} />)}</div> : null}</Conversation>;
}
