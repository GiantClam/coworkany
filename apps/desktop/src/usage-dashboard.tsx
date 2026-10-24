import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MetricsQueryFilters, MetricsQueryResult, WorkbenchClient } from "@coworkany/workbench-client";
import { buildUsageDashboardView } from "./usage-dashboard-model";

type UsageDashboardProps = {
  readonly client: WorkbenchClient;
  readonly locale: "zh" | "en";
  readonly initialRunId?: string;
  readonly onNavigate: (path: string) => void;
};

const emptyResult: MetricsQueryResult = { overview: { tokens: 0, modelTools: 0, capabilities: 0 }, series: [], models: [], tools: [], capabilities: [], runs: [] };

function UsageTrend({ result, locale }: { readonly result: MetricsQueryResult; readonly locale: "zh" | "en" }) {
  const width = 720;
  const height = 180;
  const max = Math.max(1, ...result.series.map((item) => item.inputTokens + item.outputTokens));
  const step = result.series.length ? width / result.series.length : width;
  return <section className="usage-panel usage-trend-panel">
    <div className="usage-panel-title"><strong>{locale === "zh" ? "Token 趋势" : "Token trend"}</strong><span>{locale === "zh" ? "输入 / 输出" : "Input / output"}</span></div>
    <svg role="img" aria-labelledby="usage-trend-title usage-trend-description" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <title id="usage-trend-title">{locale === "zh" ? "每日 Token 使用趋势" : "Daily token usage trend"}</title>
      <desc id="usage-trend-description">{locale === "zh" ? "每个柱形展示当天输入和输出 Token。" : "Each stacked bar shows daily input and output tokens."}</desc>
      {result.series.map((item, index) => {
        const inputHeight = (item.inputTokens / max) * 145;
        const outputHeight = (item.outputTokens / max) * 145;
        const x = index * step + step * .2;
        return <g key={item.date}>
          <rect className="usage-chart-input" x={x} y={160 - inputHeight} width={Math.max(3, step * .6)} height={inputHeight} rx="2" />
          <rect className="usage-chart-output" x={x} y={160 - inputHeight - outputHeight} width={Math.max(3, step * .6)} height={outputHeight} rx="2" />
        </g>;
      })}
    </svg>
    <div className="usage-chart-summary" aria-label={locale === "zh" ? "趋势数据摘要" : "Trend data summary"}>{result.series.slice(-7).map((item) => <span key={item.date}>{item.date.slice(5)} · {(item.inputTokens + item.outputTokens).toLocaleString()}</span>)}</div>
  </section>;
}

function Breakdown({ title, rows, locale }: { readonly title: string; readonly rows: MetricsQueryResult["tools"]; readonly locale: "zh" | "en" }) {
  return <section className="usage-panel usage-breakdown"><strong>{title}</strong>{rows.length ? <div>{rows.slice(0, 8).map((row) => <div key={row.name}><span title={row.name}>{row.name}</span><b>{row.invocations || row.tokens || row.runs}</b></div>)}</div> : <p>{locale === "zh" ? "暂无数据" : "No data"}</p>}</section>;
}

function UsageLedgerScroll({ children, locale }: { readonly children: React.ReactNode; readonly locale: "zh" | "en" }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateOverflow = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1);
      const next = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + delta));
      if (next === viewport.scrollLeft) return;
      event.preventDefault();
      viewport.scrollLeft = next;
    };
    updateOverflow();
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
    };
  }, []);
  return <>
    {overflowing ? <p id={hintId} className="usage-scroll-hint">{locale === "zh" ? "左右滑动查看全部列；聚焦表格后可使用左右方向键，或按住 Shift 滚动。" : "Scroll horizontally to see all columns. Focus the table and use arrow keys, or hold Shift while scrolling."}</p> : null}
    <div ref={viewportRef} className="usage-table" role="region" aria-label={locale === "zh" ? "逐轮明细，可横向滚动" : "Run ledger, horizontally scrollable"} aria-describedby={overflowing ? hintId : undefined} tabIndex={overflowing ? 0 : undefined} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
      const viewport = event.currentTarget;
      const max = viewport.scrollWidth - viewport.clientWidth;
      const next = event.key === "ArrowRight" ? Math.min(max, viewport.scrollLeft + 120) : event.key === "ArrowLeft" ? Math.max(0, viewport.scrollLeft - 120) : event.key === "Home" ? 0 : event.key === "End" ? max : undefined;
      if (next === undefined || max <= 0) return;
      event.preventDefault();
      viewport.scrollLeft = next;
    }}><div className="usage-table-content">{children}</div></div>
  </>;
}

export function DesktopUsageDashboard({ client, locale, initialRunId, onNavigate }: UsageDashboardProps) {
  const [range, setRange] = useState<MetricsQueryFilters["range"]>("30d");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<MetricsQueryFilters["source"] | "all">("all");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [result, setResult] = useState<MetricsQueryResult>(emptyResult);
  const [state, setState] = useState<"loading" | "data" | "empty" | "error">("loading");
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0);
  const metrics = client.metrics;
  useEffect(() => {
    const request = ++requestRef.current;
    if (!metrics) {
      setError(locale === "zh" ? "当前桌面版本不支持用量统计" : "Usage analytics is unavailable in this desktop version");
      setState("error");
      return;
    }
    setState("loading");
    const timer = globalThis.setTimeout(() => {
      void metrics.query({ range, limit: 50, ...(query.trim() ? { query: query.trim() } : {}), ...(source === "all" ? {} : { source }), ...(model ? { model } : {}), ...(provider ? { provider } : {}), ...(initialRunId ? { runId: initialRunId } : {}) }).then((next) => {
        if (request !== requestRef.current) return;
        setResult(next);
        setState(next.runs.length || next.overview.tokens || next.overview.modelTools || next.overview.capabilities ? "data" : "empty");
      }).catch((reason) => {
        if (request !== requestRef.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setState("error");
      });
    }, 120);
    return () => globalThis.clearTimeout(timer);
  }, [initialRunId, locale, metrics, model, provider, query, range, retryNonce, source]);
  const view = useMemo(() => buildUsageDashboardView(result, locale), [locale, result]);
  const copy = locale === "zh" ? { title: "用量统计", description: "按轮次审计模型、工具调用、能力执行与真实 Token 消耗。", tokens: "Token", tools: "模型工具", capabilities: "能力执行", cost: "Provider 成本", search: "搜索会话或运行 ID", allSources: "全部来源", model: "全部模型", provider: "Provider", loading: "正在读取本地统计…", empty: "所选范围内暂无统计记录", retry: "重试", time: "时间", task: "会话 / 任务", source: "来源", calls: "调用", status: "状态" } : { title: "Usage analytics", description: "Audit model, tool, capability, and real token usage per run.", tokens: "Tokens", tools: "Model tools", capabilities: "Capabilities", cost: "Provider cost", search: "Search conversation or run ID", allSources: "All sources", model: "All models", provider: "Provider", loading: "Loading local analytics…", empty: "No metrics in the selected range", retry: "Retry", time: "Time", task: "Conversation / task", source: "Source", calls: "Calls", status: "Status" };
  const openRun = (row: MetricsQueryResult["runs"][number]) => row.conversationId
    ? onNavigate(`/dashboard/ai/${encodeURIComponent(row.conversationId)}${row.messageId ? `?message=${encodeURIComponent(row.messageId)}` : ""}`)
    : onNavigate(`/dashboard/tasks?runId=${encodeURIComponent(row.runId)}`);
  const loadMore = async () => {
    if (!metrics || !result.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await metrics.query({ range, limit: 50, cursor: result.nextCursor, ...(query.trim() ? { query: query.trim() } : {}), ...(source === "all" ? {} : { source }), ...(model ? { model } : {}), ...(provider ? { provider } : {}), ...(initialRunId ? { runId: initialRunId } : {}) });
      setResult((current) => ({ ...next, runs: [...current.runs, ...next.runs] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  };
  return <main className="usage-dashboard">
    <header className="usage-dashboard-header"><div><div className="eyebrow">LOCAL USAGE ANALYTICS</div><h1>{copy.title}</h1><p>{copy.description}</p></div><span className="chat-runtime-badge">SQLite · Provider data</span></header>
    <div className="usage-toolbar">
      <div className="usage-range" role="group" aria-label={locale === "zh" ? "时间范围" : "Date range"}>{(["7d", "30d", "all"] as const).map((item) => <button type="button" key={item} aria-pressed={range === item} onClick={() => setRange(item)}>{item === "all" ? (locale === "zh" ? "全部" : "All") : item}</button>)}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
      <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label={copy.source}><option value="all">{copy.allSources}</option>{["conversation", "agent", "workflow", "media", "ppt"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select value={model} onChange={(event) => setModel(event.target.value)} aria-label={copy.model}><option value="">{copy.model}</option>{result.models.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}</select>
      <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={copy.provider} aria-label={copy.provider} />
    </div>
    {state === "loading" ? <div className="usage-state" role="status">{copy.loading}</div> : state === "error" ? <div className="usage-state status-error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setRetryNonce((current) => current + 1)}>{copy.retry}</button></div> : state === "empty" ? <div className="usage-state">{copy.empty}</div> : <>
      <section className="usage-overview"><div><span>{copy.tokens}</span><strong>{view.overview.tokens.toLocaleString()}</strong></div><div><span>{copy.tools}</span><strong>{view.overview.modelTools.toLocaleString()}</strong></div><div><span>{copy.capabilities}</span><strong>{view.overview.capabilities.toLocaleString()}</strong></div><div><span>{copy.cost}</span><strong>{view.overview.providerCost === undefined ? (locale === "zh" ? "未提供" : "Not provided") : `$${view.overview.providerCost.toFixed(6)}`}</strong></div></section>
      <UsageTrend result={result} locale={locale} />
      <div className="usage-breakdown-grid"><Breakdown title={locale === "zh" ? "模型分布" : "Models"} rows={result.models} locale={locale} /><Breakdown title={locale === "zh" ? "工具分布" : "Tools"} rows={result.tools} locale={locale} /><Breakdown title={locale === "zh" ? "能力分布" : "Capabilities"} rows={result.capabilities} locale={locale} /></div>
      <section className="usage-panel usage-ledger">
        <div className="usage-panel-title"><strong>{locale === "zh" ? "逐轮明细" : "Run ledger"}</strong><span>{result.runs.length}</span></div>
        <UsageLedgerScroll locale={locale}>
          <div className="usage-table-head"><span>{copy.time}</span><span>{copy.task}</span><span>{copy.source}</span><span>{copy.model}</span><span>{copy.calls}</span><span>{copy.tokens}</span><span>{copy.cost}</span><span>{copy.status}</span></div>
          {view.rows.map(({ run, totalTokensLabel, costLabel }) => <button type="button" className="usage-table-row" key={run.runId} onClick={() => openRun(run)}>
            <time title={new Date(run.startedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}>{new Date(run.startedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</time>
            <span><strong title={run.title}>{run.title}</strong><small title={run.runId}>{run.runId}</small></span>
            <span title={run.source}>{run.source}</span><span title={run.model}>{run.model ?? "—"}</span><span>{run.metrics.modelTools.total} / {run.metrics.capabilities.total}</span><span title={totalTokensLabel}>{totalTokensLabel}</span><span title={costLabel}>{costLabel}</span><span title={run.status}>{run.status}</span>
          </button>)}
        </UsageLedgerScroll>
        {result.nextCursor ? <button type="button" className="ghost usage-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? (locale === "zh" ? "正在加载…" : "Loading…") : (locale === "zh" ? "加载更多" : "Load more")}</button> : null}
      </section>
    </>}
  </main>;
}
