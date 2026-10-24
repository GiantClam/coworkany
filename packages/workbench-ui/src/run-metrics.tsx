"use client";

import React from "react";
import type { RunMetrics } from "@coworkany/workbench-client";

export type WorkbenchRunMetricsProps = {
  readonly metrics: RunMetrics;
  readonly locale?: "zh" | "en";
};

function compactTokens(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return new Intl.NumberFormat().format(value);
}
function numberLabel(value: number | undefined, locale: "zh" | "en") {
  return value === undefined ? (locale === "zh" ? "未提供" : "Not provided") : new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value);
}

function costLabel(value: number | undefined, locale: "zh" | "en") {
  return value === undefined ? (locale === "zh" ? "未提供" : "Not provided") : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(value);
}

function MetricRow({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return <div className="wb-run-metrics-row"><span>{label}</span><strong>{value}</strong></div>;
}

export function WorkbenchRunMetrics({ metrics, locale = "zh" }: WorkbenchRunMetricsProps) {
  const tokenTotal = metrics.tokens.input === undefined && metrics.tokens.output === undefined ? undefined : (metrics.tokens.input ?? 0) + (metrics.tokens.output ?? 0);
  const labels = locale === "zh" ? {
    title: "本轮调用与用量统计",
    tools: "工具",
    capabilities: "能力执行",
    input: "输入",
    output: "输出",
    cache: "缓存输入",
    reasoning: "推理",
    providerCost: "Provider 返回成本",
    estimatedCost: "本地估算成本",
    detail: "查看统计详情",
    partial: "部分数据未提供",
  } : {
    title: "Run calls and usage",
    tools: "Tools",
    capabilities: "Capabilities",
    input: "Input",
    output: "Output",
    cache: "Cached input",
    reasoning: "Reasoning",
    providerCost: "Provider cost",
    estimatedCost: "Estimated cost",
    detail: "View usage details",
    partial: "Some data was not provided",
  };
  return <details className="wb-run-metrics" data-completeness={metrics.completeness}>
    <summary aria-label={labels.title}>
      <span className="wb-run-metrics-model">{metrics.model ?? (locale === "zh" ? "未知模型" : "Unknown model")}</span>
      <span>{labels.tools} {metrics.modelTools.total}</span>
      <span>{labels.capabilities} {metrics.capabilities.total}</span>
      <span>{tokenTotal === undefined ? (locale === "zh" ? "Token 未提供" : "Token unavailable") : `${compactTokens(tokenTotal)} Token`}</span>
      <span className="wb-run-metrics-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="wb-run-metrics-detail">
      <div className="wb-run-metrics-grid">
        <MetricRow label={labels.input} value={numberLabel(metrics.tokens.input, locale)} />
        <MetricRow label={labels.output} value={numberLabel(metrics.tokens.output, locale)} />
        <MetricRow label={labels.cache} value={numberLabel(metrics.tokens.cachedInput, locale)} />
        <MetricRow label={labels.reasoning} value={numberLabel(metrics.tokens.reasoning, locale)} />
        <MetricRow label={labels.providerCost} value={costLabel(metrics.providerCost, locale)} />
        <MetricRow label={labels.estimatedCost} value={costLabel(metrics.estimatedCost, locale)} />
      </div>
      <div className="wb-run-metrics-status">
        <span>{labels.tools}: {metrics.modelTools.completed} ✓ · {metrics.modelTools.failed + metrics.modelTools.rejected} × · {metrics.modelTools.running} …</span>
        <span>{labels.capabilities}: {metrics.capabilities.completed} ✓ · {metrics.capabilities.failed + metrics.capabilities.rejected} × · {metrics.capabilities.running} …</span>
      </div>
      {metrics.completeness !== "complete" ? <small>{labels.partial}</small> : null}
      <a href={`/dashboard/usage?runId=${encodeURIComponent(metrics.runId)}`}>{labels.detail}</a>
    </div>
  </details>;
}
