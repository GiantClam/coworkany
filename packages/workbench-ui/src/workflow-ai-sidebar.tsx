"use client";

import React, { useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { PanelRightClose, Sparkles } from "lucide-react";
import type { DesktopUIMessage, WorkflowAiContext } from "@coworkany/workbench-client";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  Suggestion,
  Suggestions,
  type ModelOption,
} from "./ai-elements";
import { WorkbenchMessageSurface } from "./workbench-message-surface";

export type WorkflowAiSidebarProps = {
  readonly open: boolean;
  readonly width: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly messages: readonly DesktopUIMessage[];
  readonly providerOptions: readonly ModelOption[];
  readonly context: WorkflowAiContext;
  readonly locale: "zh" | "en";
  readonly status: "ready" | "streaming" | "error";
  readonly input: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onWidthChange: (width: number) => void;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: (text: string) => void | Promise<void>;
  readonly onStop: () => void;
  readonly onRetry: (message: DesktopUIMessage) => void | Promise<void>;
  readonly onApprove: (toolCallId: string) => void | Promise<void>;
  readonly onReject: (toolCallId: string) => void | Promise<void>;
};

const DEFAULT_MIN_WIDTH = 320;
const DEFAULT_MAX_WIDTH = 560;

function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(width, minWidth), maxWidth);
}

function ProviderCandidates({ options, locale }: { readonly options: readonly ModelOption[]; readonly locale: "zh" | "en" }) {
  const [open, setOpen] = useState(false);
  return <ModelSelector open={open} onOpenChange={setOpen}>
    <ModelSelectorTrigger asChild>
      <button type="button" className="workflow-ai-provider-trigger" aria-label={locale === "zh" ? "查看可用 Provider 和模型" : "View available providers and models"} data-provider-count={options.length}>
        <Sparkles size={13} aria-hidden="true" />
        <span>{locale === "zh" ? `自动选择 · ${options.length}` : `Auto · ${options.length}`}</span>
      </button>
    </ModelSelectorTrigger>
    <ModelSelectorContent title={locale === "zh" ? "可用 Provider 和模型" : "Available providers and models"}>
      <ModelSelectorInput placeholder={locale === "zh" ? "搜索 Provider 或模型" : "Search providers or models"} />
      <ModelSelectorList>
        <ModelSelectorEmpty>{locale === "zh" ? "没有可用模型" : "No available models"}</ModelSelectorEmpty>
        <ModelSelectorGroup heading={locale === "zh" ? "AI 可自动选择" : "Available to AI"}>
          {options.map((option) => <ModelSelectorItem key={option.id} model={option} onSelect={() => setOpen(false)} />)}
        </ModelSelectorGroup>
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelector>;
}

export function WorkflowAiSidebar({
  open,
  width,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  messages,
  providerOptions,
  context,
  locale,
  status,
  input,
  onOpenChange,
  onWidthChange,
  onInputChange,
  onSubmit,
  onStop,
  onRetry,
  onApprove,
  onReject,
}: WorkflowAiSidebarProps) {
  const resolvedWidth = clampWidth(width, minWidth, maxWidth);
  const sidebarStyle = useMemo(() => ({
    "--workflow-ai-sidebar-width": `${resolvedWidth}px`,
    "--workflow-ai-sidebar-min-width": `${minWidth}px`,
    "--workflow-ai-sidebar-max-width": `${maxWidth}px`,
  }) as CSSProperties, [maxWidth, minWidth, resolvedWidth]);

  if (!open) return null;

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = resolvedWidth;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => onWidthChange(clampWidth(startWidth + startX - moveEvent.clientX, minWidth, maxWidth));
    const finish = (finishEvent: globalThis.PointerEvent) => {
      handle.releasePointerCapture(finishEvent.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };
  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 16 : -16;
    onWidthChange(clampWidth(resolvedWidth + delta, minWidth, maxWidth));
  };
  const submit = () => {
    const text = input.trim();
    if (text) void onSubmit(text);
  };
  const quickStarts = locale === "zh"
    ? ["创建一个内容发布工作流", "检查并修复当前工作流", "整理所选节点布局"]
    : ["Create a content publishing workflow", "Validate and repair this workflow", "Arrange the selected nodes"];

  return <aside
    className="workflow-ai-sidebar"
    style={sidebarStyle}
    aria-label={locale === "zh" ? "工作流 AI 助手" : "Workflow AI assistant"}
    data-workflow-ai-sidebar="true"
    data-layout="sibling"
    data-overlay="false"
    data-workflow-id={context.workflowId}
  >
    <div
      className="workflow-ai-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={locale === "zh" ? "调整 AI 侧栏宽度" : "Resize AI sidebar"}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={resolvedWidth}
      onPointerDown={resizeFromPointer}
      onKeyDown={resizeFromKeyboard}
    />
    <header className="workflow-ai-sidebar-header">
      <div><Sparkles size={15} aria-hidden="true" /><strong>{locale === "zh" ? "工作流 AI" : "Workflow AI"}</strong><span>r{context.revision}</span></div>
      <button type="button" onClick={() => onOpenChange(false)} aria-label={locale === "zh" ? "隐藏 AI 侧栏" : "Hide AI sidebar"} title={locale === "zh" ? "隐藏" : "Hide"}>
        <PanelRightClose size={16} aria-hidden="true" />
      </button>
    </header>

    <div className="workflow-ai-sidebar-body">
      <WorkbenchMessageSurface
        messages={messages}
        locale={locale}
        pendingMessageId={status === "streaming" ? "workflow-ai-pending" : undefined}
        onRetry={onRetry}
        onToolApproval={(_message, part, decision) => decision === "approve" ? onApprove(part.toolCallId) : onReject(part.toolCallId)}
        emptyState={<div className="workflow-ai-empty-state">
          <span className="workflow-ai-empty-icon"><Sparkles size={18} aria-hidden="true" /></span>
          <strong>{locale === "zh" ? "工作流 AI" : "Workflow AI"}</strong>
          <Suggestions>{quickStarts.map((suggestion) => <Suggestion key={suggestion} suggestion={suggestion} onClick={onInputChange} />)}</Suggestions>
        </div>}
      />
    </div>

    <div className="workflow-ai-composer">
      {status === "error" ? <div className="workflow-ai-error" role="status">{locale === "zh" ? "请求失败，可重试上一条消息" : "Request failed. Retry the previous message."}</div> : null}
      <PromptInput value={input} onValueChange={onInputChange} onSubmit={submit} onStop={onStop} status={status} locale={locale} maxHeight={160}>
        <PromptInputBody><PromptInputTextarea placeholder={locale === "zh" ? "向 AI 提问" : "Message AI"} rows={2} /></PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools><ProviderCandidates options={providerOptions} locale={locale} /></PromptInputTools>
          <PromptInputSubmit disabled={!input.trim() && status !== "streaming"} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  </aside>;
}
