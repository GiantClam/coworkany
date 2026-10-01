import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MetricsQueryFilters, MetricsQueryResult, WorkbenchClient } from "@coworkany/workbench-client";
import { WORKBENCH_THEME, WorkbenchShell } from "@coworkany/workbench-ui/desktop";
import "../src/tailwind.css";
import "@coworkany/workbench-ui/styles.css";
import "../src/styles.css";
import { DesktopUsageDashboard } from "../src/usage-dashboard";

const counts = { total: 8, completed: 8, failed: 0, rejected: 0, running: 0, byName: [] };
const longModel = "provider-with-a-long-name/model-with-a-very-long-unbroken-identifier-20260930";
const result: MetricsQueryResult = {
  overview: { tokens: 123456789012, modelTools: 8, capabilities: 2, providerCost: 123456.123456 },
  series: [{ date: "2026-09-28", inputTokens: 100, outputTokens: 20, modelTools: 4, capabilities: 1 }, { date: "2026-09-29", inputTokens: 200, outputTokens: 40, modelTools: 4, capabilities: 1 }],
  models: [{ name: longModel, runs: 3, invocations: 8, completed: 8, failed: 0, tokens: 123456789012 }],
  tools: [{ name: "read", runs: 2, invocations: 8, completed: 8, failed: 0 }],
  capabilities: [],
  runs: [0, 1, 2].map((index) => ({
    runId: `run-${index}-a-very-long-unbroken-run-identifier-12345678901234567890`,
    conversationId: index === 0 ? "conversation-acceptance" : undefined,
    messageId: index === 0 ? "message-acceptance" : undefined,
    title: index === 0 ? "请检查项目资料并生成完整的市场分析报告，包含竞争情况与未来规划 / Very long task title for layout regression" : `Usage acceptance task ${index}`,
    source: "conversation" as const,
    provider: "provider-acceptance",
    model: longModel,
    status: index === 2 ? "failed" : "succeeded",
    startedAt: "2026-09-29T08:30:00Z",
    metrics: { runId: `run-${index}`, modelTools: counts, capabilities: counts, tokens: { input: 123456789012, output: 12345 }, providerCost: index === 2 ? undefined : 123456.123456, completeness: "partial" as const },
  })),
  nextCursor: "page-2",
};

function Acceptance() {
  const [collapsed, setCollapsed] = useState(false);
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState("data");
  const [query, setQuery] = useState<MetricsQueryFilters>();
  const [navigation, setNavigation] = useState("");
  const theme = dark ? WORKBENCH_THEME.dark : WORKBENCH_THEME.light;
  const styles = Object.fromEntries(Object.entries(theme).flatMap(([name, value]) => {
    const token = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return [[`--${token}`, value], [`--wb-${token}`, value]];
  })) as React.CSSProperties;
  const client = useMemo(() => ({ metrics: { query: async (filters: MetricsQueryFilters) => {
    setQuery(filters);
    if (mode === "loading") return new Promise<MetricsQueryResult>(() => {});
    if (mode === "error") throw new Error("Acceptance: metrics request failed");
    if (mode === "empty" || filters.query === "nothing") return { overview: { tokens: 0, modelTools: 0, capabilities: 0 }, series: [], models: [], tools: [], capabilities: [], runs: [] };
    return filters.cursor ? { ...result, runs: [{ ...result.runs[0]!, runId: "page-2-run" }], nextCursor: undefined } : result;
  } } }) as WorkbenchClient, [mode]);
  return <div className="shell" style={{ ...styles, background: theme.background }}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 12px", height: 42, background: theme.card, color: theme.foreground }}>
      <label><input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} /> Dark theme</label>
      <select aria-label="Fixture state" value={mode} onChange={(event) => setMode(event.target.value)}>{["data", "loading", "empty", "error"].map((item) => <option key={item}>{item}</option>)}</select>
      <output aria-label="Last query">{query ? JSON.stringify(query) : "Waiting for query"}</output>
      <output aria-label="Last navigation">{navigation}</output>
    </div>
    <div style={{ height: "calc(100% - 42px)", minHeight: 0 }}>
      <WorkbenchShell title="CoworkAny" locale={locale} onLocaleChange={setLocale} onLocaleToggle={() => setLocale(locale === "zh" ? "en" : "zh")} localLabel="Acceptance workspace" navItems={[{ path: "/dashboard/usage", label: locale === "zh" ? "用量统计" : "Usage analytics" }]} activePath="/dashboard/usage" collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} onNavigate={setNavigation}>
        <section className="workspace"><DesktopUsageDashboard client={client} locale={locale} onNavigate={setNavigation} /></section>
      </WorkbenchShell>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Acceptance />);
