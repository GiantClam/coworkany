"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
  type ModelOption,
} from "./ai-elements";

export type WorkbenchModelReasoningOption = ModelOption;

export type WorkbenchReasoningOption = {
  readonly id: string;
  readonly label: string;
  readonly shortLabel?: string;
};

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
  const model = models.find((item) => item.id === modelId);
  const reasoning = reasoningOptions.find((item) => item.id === reasoningId);
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

  return (
    <ModelSelector
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setView("settings");
      }}
    >
      <ModelSelectorTrigger
        disabled={disabled}
        aria-label={`${locale === "zh" ? "模型与推理" : "Model and reasoning"}：${summary}`}
        data-slot="model-reasoning-trigger"
        className="wb-ai-model-reasoning-trigger"
      >
        <span className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-full">{summary}</span>
        <span className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-compact" aria-hidden="true">
          {model?.label ?? (locale === "zh" ? "模型" : "Model")} · {reasoning?.shortLabel ?? reasoning?.label}
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </ModelSelectorTrigger>
      <ModelSelectorContent title={locale === "zh" ? "模型与推理" : "Model and reasoning"} className="wb-ai-model-reasoning-content">
        {view === "models" ? (
          <>
            <button type="button" className="wb-ai-model-reasoning-back" onClick={() => setView("settings")}>
              <ChevronLeft size={14} aria-hidden="true" />
              {locale === "zh" ? "模型" : "Models"}
            </button>
            <ModelSelectorInput placeholder={locale === "zh" ? "搜索模型" : "Search models"} />
            <ModelSelectorList>
              <ModelSelectorEmpty>{locale === "zh" ? "没有匹配的模型" : "No matching models"}</ModelSelectorEmpty>
              {groups.map(([provider, items]) => (
                <ModelSelectorGroup key={provider} heading={provider}>
                  {items.map((item) => (
                    <ModelSelectorItem
                      key={item.id}
                      model={item}
                      selected={item.id === modelId}
                      onSelect={() => {
                        onModelChange(item.id);
                        setView("settings");
                      }}
                    />
                  ))}
                </ModelSelectorGroup>
              ))}
            </ModelSelectorList>
          </>
        ) : (
          <ModelSelectorList>
            <ModelSelectorGroup heading={locale === "zh" ? "模型" : "Model"}>
              <ModelSelectorItem
                value="change-model"
                disabled={modelLocked || models.length === 0}
                onSelect={() => setView("models")}
              >
                <span><strong>{model?.label ?? (locale === "zh" ? "无可用模型" : "No models")}</strong></span>
                {!modelLocked ? <ChevronRight size={14} aria-hidden="true" /> : null}
              </ModelSelectorItem>
            </ModelSelectorGroup>
            <ModelSelectorSeparator />
            <ModelSelectorGroup heading={locale === "zh" ? "推理深度" : "Reasoning"}>
              {reasoningOptions.map((item) => (
                <ModelSelectorItem
                  key={item.id}
                  value={`reasoning-${item.id}`}
                  selected={item.id === reasoningId}
                  disabled={reasoningOptions.length <= 1}
                  onSelect={() => {
                    onReasoningChange(item.id);
                    setOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {item.id === reasoningId ? <Check size={14} aria-hidden="true" /> : null}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        )}
      </ModelSelectorContent>
    </ModelSelector>
  );
}
