"use client";

import React from "react";
import { workflowNodeRegistry, type WorkflowDefinitionNodeV2, type WorkflowFieldDefinition } from "@coworkany/workflow-core";
import { resolveWorkbenchImageParameterFields, resolveWorkbenchMediaFeature, type WorkbenchMediaField } from "./media";

type WorkflowParameterValue = string | number | boolean;

const workflowOptionLabels: Record<string, { zh: string; en: string }> = {
  Markdown: { zh: "Markdown", en: "Markdown" },
  Text: { zh: "文本", en: "Text" },
  HTML: { zh: "HTML", en: "HTML" },
  JSON: { zh: "JSON", en: "JSON" },
  WeChat: { zh: "微信公众号", en: "WeChat" },
  Generic: { zh: "通用", en: "Generic" },
  Article: { zh: "文章", en: "Article" },
  Social: { zh: "社交内容", en: "Social" },
  Campaign: { zh: "营销活动", en: "Campaign" },
  Auto: { zh: "自动", en: "Auto" },
  Chinese: { zh: "中文", en: "Chinese" },
  English: { zh: "英文", en: "English" },
  "Image reference": { zh: "图片引用", en: "Image reference" },
  Asset: { zh: "资产", en: "Asset" },
  Continue: { zh: "继续", en: "Continue" },
  "Fail fast": { zh: "快速失败", en: "Fail fast" },
  "Input order": { zh: "输入顺序", en: "Input order" },
  Low: { zh: "低", en: "Low" },
  High: { zh: "高", en: "High" },
  Transparent: { zh: "透明", en: "Transparent" },
  Opaque: { zh: "不透明", en: "Opaque" },
  "Text to video": { zh: "文生视频", en: "Text to video" },
  "Image to video": { zh: "图生视频", en: "Image to video" },
  "First and last frame": { zh: "首尾帧", en: "First and last frame" },
  "Reference to video": { zh: "参考图生视频", en: "Reference to video" },
  "Video edit": { zh: "视频编辑", en: "Video edit" },
  Off: { zh: "关闭", en: "Off" },
  On: { zh: "开启", en: "On" },
  "Electronic pop": { zh: "电子流行", en: "Electronic pop" },
  Cinematic: { zh: "电影感", en: "Cinematic" },
  Uplifting: { zh: "振奋", en: "Uplifting" },
  Calm: { zh: "舒缓", en: "Calm" },
  Instrumental: { zh: "纯音乐", en: "Instrumental" },
  Vocal: { zh: "人声", en: "Vocal" },
  "AI generate": { zh: "AI 生成", en: "AI generate" },
  Custom: { zh: "自定义", en: "Custom" },
  "HTML PPT": { zh: "HTML 演示文稿", en: "HTML PPT" },
  "Editable PPT": { zh: "可编辑演示文稿", en: "Editable PPT" },
  "Marketing campaign": { zh: "营销活动", en: "Marketing campaign" },
  "Business report": { zh: "业务报告", en: "Business report" },
  General: { zh: "通用", en: "General" },
  Brand: { zh: "品牌", en: "Brand" },
  Product: { zh: "产品", en: "Product" },
};

function localizedWorkflowOptionLabel(label: string, locale: "zh" | "en") {
  return workflowOptionLabels[label]?.[locale] ?? label;
}

export type WorkbenchWorkflowModelOption = {
  value: string;
  label: string;
};

export type WorkbenchWorkflowProviderOption = {
  value: string;
  label: string;
};

export type WorkbenchWorkflowParameterFieldsProps = {
  locale: "zh" | "en";
  node: WorkflowDefinitionNodeV2;
  modelOptions?: readonly WorkbenchWorkflowModelOption[];
  /** Hosts may give model IDs a domain-specific meaning, such as a registered remote workflow. */
  modelLabel?: string;
  /** A selected remote workflow is represented by the model selector, so do not expose its internal reference separately. */
  hideWorkflowReference?: boolean;
  providerOptions?: readonly WorkbenchWorkflowProviderOption[];
  onUpdate: (key: string, value: WorkflowParameterValue) => void;
  className?: string;
};

function isVisible(field: WorkflowFieldDefinition, config: Record<string, unknown>) {
  return !field.visibleWhen || config[field.visibleWhen.fieldId] === field.visibleWhen.equals;
}

function valueForField(field: WorkflowFieldDefinition, config: Record<string, unknown>) {
  const value = config[field.id] ?? field.defaultValue;
  if (value === undefined || value === null || typeof value === "object") return "";
  return value as WorkflowParameterValue;
}

function renderMediaField(field: WorkbenchMediaField, node: WorkflowDefinitionNodeV2, locale: "zh" | "en", onUpdate: (key: string, value: WorkflowParameterValue) => void) {
  const rawValue = node.config[field.id] ?? field.defaultValue ?? "";
  const value = typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean" ? rawValue : "";
  const controlType = field.type === "select" ? "select" : field.type === "textarea" ? "textarea" : "input";
  return <label key={"media-" + field.id} className={`workflow-editor-field workflow-editor-field-${controlType}`} data-field-id={field.id}>
    <span>{field.label}</span>
    {field.type === "select" && field.options?.length ? (
      <select aria-label={field.label} title={field.label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)}>
        {field.options.map((option) => <option key={option.value} value={option.value}>{localizedWorkflowOptionLabel(option.label, locale)}</option>)}
      </select>
    ) : field.type === "textarea" ? (
      <textarea aria-label={field.label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)} placeholder={field.placeholder} />
    ) : (
      <input aria-label={field.label} type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"} value={String(value)} onChange={(event) => onUpdate(field.id, field.type === "number" ? Number(event.target.value) : event.target.value)} placeholder={field.placeholder} min={field.min} max={field.max} step={field.step} required={field.required} />
    )}
    {field.required && !String(value).trim() ? <small className="muted">{locale === "zh" ? "必填" : "Required"}</small> : null}
  </label>;
}

/**
 * Host-neutral renderer for the portable workflow schema. Hosts can keep
 * asset, agent, and dataset pickers as extensions while standard controls
 * remain identical wherever a workflow definition is edited.
 */
export function WorkbenchWorkflowParameterFields({ locale, node, modelOptions = [], modelLabel, hideWorkflowReference = false, providerOptions = [], onUpdate, className = "" }: WorkbenchWorkflowParameterFieldsProps) {
  const fields = workflowNodeRegistry.get(node.type)?.configSchema ?? [];
  const workflowVideoMode = typeof node.config.mode === "string" ? node.config.mode : "text-to-video";
  const workflowVideoFeatureId = workflowVideoMode === "image-to-video" || workflowVideoMode === "reference-to-video" || workflowVideoMode === "video-edit"
    ? workflowVideoMode
    : "text-to-video";
  const workflowVideoFeature = node.type === "video_generate"
    ? resolveWorkbenchMediaFeature({
        id: workflowVideoFeatureId,
        group: "video",
        title: "",
        summary: "",
        submitLabel: "",
        fields: [{ id: "model", label: "模型", type: "select", defaultValue: String(node.config.model ?? ""), options: modelOptions.map((option) => ({ value: option.value, label: option.label })) }],
      }, String(node.config.model ?? node.config.selectedModelId ?? ""), String(node.config.selectedProviderId ?? ""))
    : null;
  const dynamicVideoFields = workflowVideoFeature?.fields.filter((field) => field.id !== "model") ?? [];
  const dynamicVideoFieldIds = new Set(workflowVideoFeature?.fields.filter((field) => field.id !== "model").map((field) => field.id) ?? []);
  const visibleFields = fields.filter((field) => isVisible(field, node.config)
    && !(field.id === "selectedProviderId" && modelOptions.length > 0 && providerOptions.length === 0)
    && !(hideWorkflowReference && field.id === "workflowRef")
    // A selected model's parameter schema owns the common generation fields.
    // Do not render the legacy duration/ratio/prompt defaults beside it.
    && !(node.type === "video_generate" && dynamicVideoFieldIds.has(field.id))
    && !(node.type === "video_generate" && dynamicVideoFieldIds.size > 0 && field.id === "sound"));
  const workflowImageModel = String(node.config.model ?? node.config.selectedModelId ?? modelOptions[0]?.value ?? "");
  const dynamicImageFields = node.type === "image_generate"
    ? resolveWorkbenchImageParameterFields(workflowImageModel, String(node.config.selectedProviderId ?? "")).filter((field) => !fields.some((candidate) => candidate.id === field.id))
    : [];

  const renderField = (field: WorkflowFieldDefinition) => {
    const value = valueForField(field, node.config);
    const schemaLabel = field.label[locale] ?? field.label.en ?? field.id;
    const textarea = field.rendererId === "textarea" || ["prompt", "script", "text", "query", "systemPrompt", "scenePrompt"].includes(field.id);
    const modelSelect = (field.id === "model" || field.id === "selectedModelId") && modelOptions.length > 0;
    const providerSelect = field.id === "selectedProviderId" && providerOptions.length > 0;
    const label = modelSelect && modelLabel ? modelLabel : schemaLabel;
    const controlType = modelSelect || providerSelect || field.rendererId === "select" ? "select" : field.rendererId === "toggle" || field.valueType === "boolean" ? "toggle" : textarea ? "textarea" : "input";
    if (field.rendererId === "asset" || field.rendererId === "agent" || field.rendererId === "dataset" || field.rendererId === "custom") {
      return <div key={field.id} className="workflow-editor-readonly"><span>{label}</span><small>{locale === "zh" ? "请通过相应的工作区选择此配置。" : "Select this configuration in its workspace."}</small></div>;
    }
    return (
      <label key={field.id} className={`workflow-editor-field workflow-editor-field-${controlType}`} data-field-id={field.id}>
        <span>{label}</span>
        {modelSelect ? (
          <select aria-label={label} title={label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)}>
            {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : providerSelect ? (
          <select aria-label={label} title={label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)}>
            {providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : field.rendererId === "select" && field.options?.length ? (
          <select aria-label={label} title={label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)}>
            {field.options.map((option) => <option key={option.value} value={option.value}>{localizedWorkflowOptionLabel(option.label, locale)}</option>)}
          </select>
        ) : field.rendererId === "toggle" || field.valueType === "boolean" ? (
          <span className="workflow-toggle-field"><input aria-label={label} type="checkbox" checked={Boolean(value)} onChange={(event) => onUpdate(field.id, event.target.checked)} /><span>{value ? (locale === "zh" ? "已启用" : "Enabled") : (locale === "zh" ? "未启用" : "Disabled")}</span></span>
        ) : textarea ? (
          <textarea aria-label={label} value={String(value)} onChange={(event) => onUpdate(field.id, event.target.value)} />
        ) : (
          <input aria-label={label} type={field.valueType === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.step} value={String(value)} onChange={(event) => onUpdate(field.id, field.valueType === "number" ? Number(event.target.value) : event.target.value)} />
        )}
      </label>
    );
  };

  return (
    <div className={`workflow-node-parameter-list ${className}`.trim()}>
      {visibleFields.map(renderField)}
      {dynamicImageFields.map((field) => renderMediaField(field, node, locale, onUpdate))}
      {dynamicVideoFields.map((field) => renderMediaField(field, node, locale, onUpdate))}
      {!visibleFields.length ? <small className="muted">{locale === "zh" ? "此节点没有可编辑参数" : "No editable parameters"}</small> : null}
    </div>
  );
}
