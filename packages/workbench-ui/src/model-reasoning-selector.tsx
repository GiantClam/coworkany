"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorShortcut,
  ModelSelectorTrigger,
  PromptInputButton,
  type ModelOption,
} from "./ai-elements";

export type WorkbenchModelReasoningOption = ModelOption;

export type WorkbenchReasoningOption = {
  readonly id: string;
  readonly label: string;
  readonly shortLabel?: string;
};

function modelBadge(provider?: string) {
  const normalized = provider?.trim();
  if (!normalized || /[\u3400-\u9fff]/u.test(normalized)) return "AI";
  return normalized.slice(0, 2).toUpperCase();
}

export function formatModelReasoningSummary(
  model: WorkbenchModelReasoningOption | undefined,
  reasoning: WorkbenchReasoningOption | undefined,
  locale: "zh" | "en",
) {
  const modelLabel = model?.label ?? (locale === "zh" ? "选择模型" : "Select model");
  const reasoningLabel = reasoning?.label ?? (locale === "zh" ? "自动" : "Auto");
  return `${modelLabel} · ${reasoningLabel}`;
}

export function WorkbenchModelReasoningSelector({
  models,
  modelId,
  reasoningOptions,
  reasoningId,
  onModelChange,
  onReasoningChange,
  modelLocked = false,
  disabled = false,
  locale = "zh",
}: {
  models: readonly WorkbenchModelReasoningOption[];
  modelId?: string;
  reasoningOptions: readonly WorkbenchReasoningOption[];
  reasoningId: string;
  onModelChange: (modelId: string) => void;
  onReasoningChange: (reasoningId: string) => void;
  modelLocked?: boolean;
  disabled?: boolean;
  locale?: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"settings" | "models">("settings");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sliderId = React.useId();
  const model = models.find((item) => item.id === modelId);
  const reasoning = reasoningOptions.find((item) => item.id === reasoningId);
  const reasoningIndex = Math.max(0, reasoningOptions.findIndex((item) => item.id === reasoningId));
  const summary = formatModelReasoningSummary(model, reasoning, locale);
  const groups = useMemo(
    () =>
      Object.entries(
        models.reduce<Record<string, WorkbenchModelReasoningOption[]>>((result, item) => {
          (result[item.provider ?? (locale === "zh" ? "模型" : "Models")] ??= []).push(item);
          return result;
        }, {}),
      ),
    [locale, models],
  );
  const updateMenuPosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect() ?? document.querySelector<HTMLElement>('[data-slot="model-reasoning-trigger"]')?.getBoundingClientRect();
    const content = contentRef.current ?? document.querySelector<HTMLDivElement>(".wb-ai-model-reasoning-content");
    if (!triggerRect || !content) return;
    const viewportPadding = 8;
    const gap = 8;
    const width = Math.min(content.offsetWidth || 352, window.innerWidth - viewportPadding * 2);
    const height = content.offsetHeight;
    const roomAbove = triggerRect.top - viewportPadding;
    const roomBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
    const openAbove = roomAbove >= height + gap || roomAbove >= roomBelow;
    const unclampedTop = openAbove ? triggerRect.top - height - gap : triggerRect.bottom + gap;
    const top = Math.min(Math.max(viewportPadding, unclampedTop), Math.max(viewportPadding, window.innerHeight - height - viewportPadding));
    const left = Math.min(Math.max(viewportPadding, triggerRect.right - width), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
    setMenuStyle({ top, left, width, transform: "none", visibility: "visible" });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMenuPosition);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    if (contentRef.current) resizeObserver?.observe(contentRef.current);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition, view]);

  return (
    <ModelSelector open={open} onOpenChange={(next) => { setOpen(next); if (!next) setView("settings"); }}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton
          ref={triggerRef}
          disabled={disabled}
          aria-label={`${locale === "zh" ? "模型与推理" : "Model and reasoning"}：${summary}`}
          data-slot="model-reasoning-trigger"
          className="wb-ai-model-reasoning-trigger"
        >
          {model ? <ModelSelectorLogo aria-hidden="true">{modelBadge(model.provider)}</ModelSelectorLogo> : null}
          <ModelSelectorName className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-full">{summary}</ModelSelectorName>
          <ModelSelectorName className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-compact" aria-hidden="true">
            {model?.label ?? (locale === "zh" ? "模型" : "Model")} · {reasoning?.shortLabel ?? reasoning?.label}
          </ModelSelectorName>
          <ChevronDown size={14} aria-hidden="true" />
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent ref={contentRef} style={menuStyle} title={locale === "zh" ? "模型与推理" : "Model and reasoning"} className="wb-ai-model-reasoning-content">
        {view === "models" ? <>
          <ModelSelectorInput placeholder={locale === "zh" ? "搜索模型" : "Search models"} />
          <ModelSelectorList>
            <ModelSelectorItem value="back-to-settings" forceMount className="wb-ai-model-reasoning-back" onSelect={() => setView("settings")}>
              <ChevronLeft size={15} aria-hidden="true" />
              <ModelSelectorName>{locale === "zh" ? "选择模型" : "Select model"}</ModelSelectorName>
            </ModelSelectorItem>
            <ModelSelectorSeparator />
            <ModelSelectorEmpty>{locale === "zh" ? "没有匹配的模型" : "No matching models"}</ModelSelectorEmpty>
            {groups.map(([provider, items]) => (
              <ModelSelectorGroup key={provider} heading={provider}>
                {items.map((item) => (
                  <ModelSelectorItem key={item.id} model={item} selected={item.id === modelId} disabled={modelLocked} onSelect={() => { onModelChange(item.id); setView("settings"); }}>
                    <ModelSelectorLogo aria-hidden="true">{modelBadge(item.provider)}</ModelSelectorLogo>
                    <ModelSelectorName>{item.label}</ModelSelectorName>
                    {item.id === modelId ? <Check size={14} aria-hidden="true" /> : null}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorGroup>
            ))}
            {models.length === 0 ? <ModelSelectorGroup heading={locale === "zh" ? "模型" : "Models"}><ModelSelectorItem value="no-models" disabled>{locale === "zh" ? "无可用模型" : "No models available"}</ModelSelectorItem></ModelSelectorGroup> : null}
          </ModelSelectorList>
        </> : <ModelSelectorList className="wb-ai-model-reasoning-settings">
          <ModelSelectorGroup heading={locale === "zh" ? "模型" : "Model"}>
            <ModelSelectorItem value="open-model-list" className="wb-ai-model-reasoning-model-item" disabled={modelLocked || models.length === 0} onSelect={() => setView("models")}>
              {model ? <ModelSelectorLogo aria-hidden="true">{modelBadge(model.provider)}</ModelSelectorLogo> : null}
              <ModelSelectorName>{model?.label ?? (locale === "zh" ? "无可用模型" : "No models available")}</ModelSelectorName>
              {!modelLocked && models.length ? <ModelSelectorShortcut><ChevronRight size={15} aria-hidden="true" /></ModelSelectorShortcut> : null}
            </ModelSelectorItem>
          </ModelSelectorGroup>
          <ModelSelectorSeparator />
          <ModelSelectorGroup heading={<label htmlFor={sliderId} className="wb-ai-model-reasoning-slider-heading"><span>{locale === "zh" ? "推理深度" : "Reasoning"}</span><strong>{reasoning?.label ?? reasoningOptions[reasoningIndex]?.label}</strong></label>}>
            <div className="wb-ai-model-reasoning-slider-field">
              <input id={sliderId} type="range" className="wb-ai-model-reasoning-slider" min={0} max={Math.max(0, reasoningOptions.length - 1)} step={1} value={reasoningIndex} disabled={reasoningOptions.length <= 1} aria-label={locale === "zh" ? "推理深度" : "Reasoning effort"} aria-valuetext={reasoning?.label} onChange={(event) => { const next = reasoningOptions[Number(event.target.value)]; if (next) onReasoningChange(next.id); }} />
            </div>
          </ModelSelectorGroup>
        </ModelSelectorList>}
      </ModelSelectorContent>
    </ModelSelector>
  );
}
