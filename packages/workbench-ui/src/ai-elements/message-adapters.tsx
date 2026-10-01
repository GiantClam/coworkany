"use client";

import React, { createContext, useContext, useEffect, useRef, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import { Copy, Download } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import * as MessageCore from "./official/message";
import * as ConversationCore from "./official/conversation";
import * as ReasoningCore from "./official/reasoning";
import * as ToolCore from "./official/tool";
import { Button, cn, Shimmer } from "./official/primitives";
import type { AIElementStatus } from "./source";

export function Message({ from, className, ...props }: ComponentProps<typeof MessageCore.Message>) {
  return <MessageCore.Message from={from} className={cn("ai-elements-message", `ai-elements-message-${from}`, className)} data-slot="message" data-message-role={from} data-from={from} {...props} />;
}
export function MessageContent({ className, ...props }: ComponentProps<typeof MessageCore.MessageContent>) {
  return <MessageCore.MessageContent className={cn("ai-elements-message-content", className)} data-slot="message-content" {...props} />;
}
export function MessageResponse({ content, children, streaming = false, parseIncompleteMarkdown = streaming, className, ...props }: ComponentProps<typeof MessageCore.MessageResponse> & { content?: string; streaming?: boolean; parseIncompleteMarkdown?: boolean }) {
  // Streamdown owns its root and does not forward arbitrary HTML data props.
  return <MessageCore.MessageResponse mode={streaming ? "streaming" : "static"} isAnimating={streaming} parseIncompleteMarkdown={parseIncompleteMarkdown} className={cn("ai-elements-message-response", className)} {...props}>{children ?? content ?? ""}</MessageCore.MessageResponse>;
}
export function MessagePlainText({ content, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { content?: string }) {
  return <div className={cn("ai-elements-message-plain-text", className)} data-slot="message-plain-text" data-message-text-mode="plain" {...props}>{children ?? content ?? ""}</div>;
}
export function MessageActions({ className, ...props }: ComponentProps<typeof MessageCore.MessageActions>) {
  return <MessageCore.MessageActions className={cn("ai-elements-message-actions", className)} data-slot="message-actions" {...props} />;
}
export function MessageToolbar({ className, ...props }: ComponentProps<typeof MessageCore.MessageToolbar>) {
  return <MessageCore.MessageToolbar className={cn("ai-elements-message-toolbar", className)} data-slot="message-toolbar" {...props} />;
}
export function MessageAction({ label, children, className, ...props }: ComponentProps<typeof MessageCore.MessageAction>) {
  return <MessageCore.MessageAction label={label} className={cn("ai-elements-message-action", className)} data-slot="message-action" aria-label={props["aria-label"] ?? label} title={props.title ?? label ?? props.tooltip} {...props}>{children ?? <Copy size={14} aria-hidden="true" />}</MessageCore.MessageAction>;
}

const ReasoningLocale = createContext<"zh" | "en">("zh");
export function Reasoning({ text, status = "running", locale = "zh", children, className, ...props }: ComponentProps<typeof ReasoningCore.Reasoning> & { text?: string; status?: AIElementStatus; locale?: "zh" | "en" }) {
  if (!text?.trim() && !children) return null;
  return <ReasoningLocale.Provider value={locale}><ReasoningCore.Reasoning className={cn("ai-elements-reasoning", className)} data-slot="reasoning" data-status={status} aria-busy={props.isStreaming || undefined} {...props}>{children ?? <><ReasoningTrigger /><ReasoningContent>{text ?? ""}</ReasoningContent></>}</ReasoningCore.Reasoning></ReasoningLocale.Provider>;
}
function thinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) return <Shimmer duration={1}>正在思考…</Shimmer>;
  return <p>{duration === undefined ? "思考了几秒" : `思考了 ${duration} 秒`}</p>;
}
export function ReasoningTrigger({ className, ...props }: ComponentProps<typeof ReasoningCore.ReasoningTrigger>) {
  const locale = useContext(ReasoningLocale);
  return <ReasoningCore.ReasoningTrigger className={cn("ai-elements-reasoning-trigger", className)} data-slot="reasoning-trigger" getThinkingMessage={locale === "zh" ? thinkingMessage : undefined} {...props} />;
}
export function ReasoningContent({ className, ...props }: ComponentProps<typeof ReasoningCore.ReasoningContent>) {
  return <ReasoningCore.ReasoningContent className={cn("ai-elements-reasoning-content", className)} data-slot="reasoning-content" {...props} />;
}

const TOOL_LABELS: Record<string, string> = { Parameters: "参数", Result: "结果", Error: "错误", "Awaiting Approval": "等待批准", Responded: "已响应", Running: "运行中", Pending: "等待中", Completed: "已完成", Denied: "已拒绝" };
// These pinned Tool renderers are pure. Translate their static labels while
// retaining their original element tree, classes and Radix behavior.
function translateTool(node: ReactNode, locale: "zh" | "en"): ReactNode {
  if (locale === "en") return node;
  if (typeof node === "string") return TOOL_LABELS[node] ?? node;
  if (!React.isValidElement<{ children?: ReactNode }>(node)) return node;
  return React.cloneElement(node, {}, React.Children.map(node.props.children, (child) => translateTool(child, locale)));
}
function toolState(status?: AIElementStatus): ToolCore.ToolState {
  if (status === "waiting" || status === "blocked") return "approval-requested";
  if (status === "completed" || status === "succeeded") return "output-available";
  if (status === "failed") return "output-error";
  if (status === "denied" || status === "cancelled") return "output-denied";
  if (status === "queued") return "input-streaming";
  return "input-available";
}
export function Tool({ toolName, toolCallId, input, output, error, status = "running", locale = "zh", children, className, ...props }: ComponentProps<typeof ToolCore.Tool> & { toolName?: string; toolCallId?: string; input?: unknown; output?: unknown; error?: string; status?: AIElementStatus; locale?: "zh" | "en" }) {
  return <ToolCore.Tool className={cn("ai-elements-tool", className)} data-slot="tool" data-status={status} aria-busy={status === "running"} {...props}>{children ?? <><ToolHeader toolName={toolName} toolCallId={toolCallId} state={toolState(status)} locale={locale} /><ToolContent><ToolInput input={input} locale={locale} /><ToolOutput output={output} errorText={error} locale={locale} /></ToolContent></>}</ToolCore.Tool>;
}
export function ToolHeader({ toolCallId, locale = "zh", type, state, status, toolName, className, ...props }: ComponentProps<typeof ToolCore.ToolContent> & { type?: string; state?: ToolCore.ToolState | AIElementStatus; status?: AIElementStatus; toolName?: string; toolCallId?: string; locale?: "zh" | "en" }) {
  const resolvedState = state && state in TOOL_STATES ? state as ToolCore.ToolState : toolState(status ?? state as AIElementStatus | undefined);
  const name = toolName ?? type?.replace(/^(dynamic-tool-|tool-)/, "") ?? (locale === "zh" ? "工具调用" : "Tool call");
  return translateTool(ToolCore.ToolHeader({ ...props, className: cn("ai-elements-tool-header", className), type: "dynamic-tool", toolName: name, state: resolvedState, "data-slot": "tool-header", "data-tool-call-id": toolCallId, "data-tool-name": name } as ToolCore.ToolHeaderProps), locale);
}
const TOOL_STATES = { "approval-requested": true, "approval-responded": true, "input-available": true, "input-streaming": true, "output-available": true, "output-denied": true, "output-error": true };
export function ToolContent({ className, ...props }: ComponentProps<typeof ToolCore.ToolContent>) {
  return <ToolCore.ToolContent className={cn("ai-elements-tool-content", className)} data-slot="tool-content" {...props} />;
}
export function ToolInput({ input, locale = "zh", className, children, ...props }: HTMLAttributes<HTMLDivElement> & { input?: unknown; locale?: "zh" | "en" }) {
  return translateTool(ToolCore.ToolInput({ input, children, className: cn("ai-elements-tool-input", className), ...props, "data-slot": "tool-input" } as ToolCore.ToolInputProps), locale);
}
export function ToolOutput({ output, errorText, locale = "zh", className, children, ...props }: HTMLAttributes<HTMLDivElement> & { output?: unknown; errorText?: string; locale?: "zh" | "en" }) {
  const value = children ?? output;
  const displayValue = value === 0 || value === false || value === "" ? <span>{value === "" ? '""' : String(value)}</span> : value;
  return translateTool(ToolCore.ToolOutput({ output: displayValue, errorText, className: cn("ai-elements-tool-output", className), ...props, "data-slot": "tool-output" } as ToolCore.ToolOutputProps), locale);
}

type ConversationProps = ComponentProps<typeof ConversationCore.Conversation> & { autoScroll?: boolean; scrollButtonLabel?: string; scrollToBottomKey?: string | number | null; onReachTop?: (viewport: HTMLDivElement) => void; onViewportScroll?: (viewport: HTMLDivElement) => void; restoreScrollTop?: number; scrollStateKey?: string | number | null };
function ConversationBridge({ autoScroll, scrollToBottomKey, onReachTop, onViewportScroll, restoreScrollTop, scrollStateKey }: Pick<ConversationProps, "autoScroll" | "scrollToBottomKey" | "onReachTop" | "onViewportScroll" | "restoreScrollTop" | "scrollStateKey">) {
  const { scrollRef, scrollToBottom } = useStickToBottomContext();
  const previous = useRef(scrollToBottomKey);
  const restored = useRef<string | number | null | undefined>(undefined);
  const nearTop = useRef(false);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const onScroll = () => {
      onViewportScroll?.(viewport as HTMLDivElement);
      const atTop = viewport.scrollTop <= 48;
      if (atTop && !nearTop.current) onReachTop?.(viewport as HTMLDivElement);
      nearTop.current = atTop;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [onReachTop, onViewportScroll, scrollRef]);
  useEffect(() => {
    if (autoScroll && previous.current !== scrollToBottomKey) void scrollToBottom({ animation: "instant", preserveScrollPosition: true });
    previous.current = scrollToBottomKey;
  }, [autoScroll, scrollToBottom, scrollToBottomKey]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || restoreScrollTop === undefined || restored.current === scrollStateKey) return;
    restored.current = scrollStateKey;
    const frame = requestAnimationFrame(() => { viewport.scrollTop = Math.max(0, Math.min(restoreScrollTop, viewport.scrollHeight - viewport.clientHeight)); });
    return () => cancelAnimationFrame(frame);
  }, [restoreScrollTop, scrollRef, scrollStateKey]);
  return null;
}
export function Conversation({ children, className, autoScroll = true, scrollButtonLabel, scrollToBottomKey, onReachTop, onViewportScroll, restoreScrollTop, scrollStateKey, ...props }: ConversationProps) {
  return <ConversationCore.Conversation initial={autoScroll ? "smooth" : false} className={cn("ai-elements-conversation", "wb-message-conversation", className)} data-slot="conversation" aria-live="off" data-auto-scroll={autoScroll ? "true" : "false"} {...props}>{(context) => <><ConversationBridge autoScroll={autoScroll} scrollToBottomKey={scrollToBottomKey} onReachTop={onReachTop} onViewportScroll={onViewportScroll} restoreScrollTop={restoreScrollTop} scrollStateKey={scrollStateKey} />{typeof children === "function" ? children(context) : children}<ConversationScrollButton aria-label={scrollButtonLabel} title={scrollButtonLabel} /></>}</ConversationCore.Conversation>;
}
export function ConversationContent({ className, ...props }: ComponentProps<typeof ConversationCore.ConversationContent>) {
  return <ConversationCore.ConversationContent className={cn("ai-elements-conversation-content", className)} scrollClassName="ai-elements-conversation-viewport" data-slot="conversation-content" {...props} />;
}
export function ConversationScrollButton({ className, ...props }: ComponentProps<typeof ConversationCore.ConversationScrollButton>) {
  return <ConversationCore.ConversationScrollButton className={cn("ai-elements-conversation-scroll-button", className)} data-slot="conversation-scroll-button" aria-label="Scroll to latest" {...props} />;
}
export function ConversationEmptyState({ className, ...props }: ComponentProps<typeof ConversationCore.ConversationEmptyState>) {
  return <ConversationCore.ConversationEmptyState className={cn("ai-elements-conversation-empty-state", className)} data-slot="conversation-empty-state" {...props} />;
}
export function ConversationDownload({ onClick, ...props }: ComponentProps<typeof Button>) {
  return <Button onClick={onClick} variant="outline" size="icon" type="button" aria-label="Download conversation" {...props}><Download size={14} aria-hidden="true" /></Button>;
}
