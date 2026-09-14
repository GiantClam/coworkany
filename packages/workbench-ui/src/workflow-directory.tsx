"use client";

import React, { useEffect, useMemo, useState } from "react";

export type WorkbenchWorkflowDirectoryWorkflow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: "draft" | "live" | "archived";
  readonly updatedAt: string;
  readonly nodeCount: number;
};

export type WorkbenchWorkflowDirectoryTemplate = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: "ready" | "needs-config" | "unavailable";
};

export type WorkbenchWorkflowDirectoryRun = {
  readonly id: string;
  readonly workflowId?: string;
  readonly workflowTitle: string;
  readonly status: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
};

export type WorkbenchWorkflowDirectoryAction = { readonly type: "create" | "open" | "duplicate" | "delete" | "instantiate" | "open-run"; readonly id?: string };

function formatWorkflowDate(value: string | undefined, locale: "zh" | "en", nowMs: number | null) {
  if (!value || nowMs === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function runDuration(run: WorkbenchWorkflowDirectoryRun) {
  if (!run.finishedAt) return "—";
  const milliseconds = new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function WorkbenchWorkflowDirectory({ locale, workflows, templates, recentRuns, onAction, actionAvailability }: {
  locale: "zh" | "en";
  workflows: readonly WorkbenchWorkflowDirectoryWorkflow[];
  templates: readonly WorkbenchWorkflowDirectoryTemplate[];
  recentRuns: readonly WorkbenchWorkflowDirectoryRun[];
  onAction: (action: WorkbenchWorkflowDirectoryAction) => void | Promise<void>;
  actionAvailability?: { readonly duplicate?: boolean; readonly delete?: boolean };
}) {
  const [runSearch, setRunSearch] = useState("");
  const [runStatus, setRunStatus] = useState("all");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [pendingDeleteWorkflowId, setPendingDeleteWorkflowId] = useState<string | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  useEffect(() => setNowMs(Date.now()), []);
  useEffect(() => {
    if (!pendingDeleteWorkflowId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteInFlight) setPendingDeleteWorkflowId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteInFlight, pendingDeleteWorkflowId]);
  const copy = locale === "zh" ? {
    eyebrow: "Workflow Orchestration", title: "工作流", description: "从可复用模板或已保存流程开始，在 Builder 中以 Canvas 编排节点，并在同一入口查看最近运行。", history: "查看运行历史", create: "新建工作流",
    total: "工作流总数", active: "启用中的工作流", succeeded: "近 7 天成功运行", failed: "近 7 天失败运行", updated: "最近更新",
    savedEyebrow: "Saved Workflows", saved: "已保存的工作流", savedDescription: "打开现有流程继续编辑 Canvas，或复制为新的本地流程。", createTitle: "从空白 Canvas 开始", createDescription: "创建新的可编辑节点图。", open: "打开 Canvas", duplicate: "复制", remove: "删除",
    templateEyebrow: "Workflow Templates", template: "工作流模板", templateDescription: "使用当前桌面能力支持的模板快速创建本地工作流。", instantiate: "使用模板", noTemplates: "当前没有可用模板。",
    recentEyebrow: "Recent Runs", recent: "最近运行", search: "搜索工作流或运行 ID", all: "全部状态", empty: "还没有工作流运行记录。", workflow: "工作流", run: "运行 ID", created: "创建时间", duration: "耗时", status: "状态", action: "操作", details: "查看",
  } : {
    eyebrow: "Workflow Orchestration", title: "Workflows", description: "Start from a reusable template or saved flow, compose nodes on the Builder Canvas, and review recent runs in the same entry point.", history: "View run history", create: "New workflow",
    total: "Total workflows", active: "Active workflows", succeeded: "Successful runs (7d)", failed: "Failed runs (7d)", updated: "Last updated",
    savedEyebrow: "Saved Workflows", saved: "SAVED WORKFLOWS", savedDescription: "Open an existing flow to continue editing its Canvas, or duplicate it into a new local flow.", createTitle: "START WITH A BLANK CANVAS", createDescription: "Create a new editable node graph.", open: "Open Canvas", duplicate: "Duplicate", remove: "Delete",
    templateEyebrow: "Workflow Templates", template: "WORKFLOW TEMPLATES", templateDescription: "Use templates supported by the current desktop capabilities to create local workflows.", instantiate: "Use template", noTemplates: "No templates are currently available.",
    recentEyebrow: "Recent Runs", recent: "RECENT RUNS", search: "Search workflow or run ID", all: "All statuses", empty: "No workflow runs have been recorded yet.", workflow: "Workflow", run: "Run ID", created: "Created", duration: "Duration", status: "Status", action: "Action", details: "View",
  };
  const recentThreshold = (nowMs ?? 0) - 7 * 24 * 60 * 60 * 1000;
  const recent = nowMs === null ? recentRuns : recentRuns.filter((run) => new Date(run.createdAt).getTime() >= recentThreshold);
  const lastUpdated = workflows.map((workflow) => workflow.updatedAt).sort().at(-1);
  const metrics = [
    [copy.total, workflows.length],
    [copy.active, workflows.filter((workflow) => workflow.status === "live").length],
    [copy.succeeded, recent.filter((run) => run.status === "succeeded").length],
    [copy.failed, recent.filter((run) => run.status === "failed").length],
    [copy.updated, formatWorkflowDate(lastUpdated, locale, nowMs)],
  ] as const;
  const visibleRuns = useMemo(() => recentRuns.filter((run) => {
    if (runStatus !== "all" && run.status !== runStatus) return false;
    const query = runSearch.trim().toLocaleLowerCase();
    return !query || `${run.id} ${run.workflowTitle}`.toLocaleLowerCase().includes(query);
  }), [recentRuns, runSearch, runStatus]);
  const pendingDeleteWorkflow = workflows.find((workflow) => workflow.id === pendingDeleteWorkflowId);
  const confirmDeleteWorkflow = async () => {
    if (!pendingDeleteWorkflowId || deleteInFlight) return;
    setDeleteInFlight(true);
    try {
      await onAction({ type: "delete", id: pendingDeleteWorkflowId });
      setPendingDeleteWorkflowId(null);
    } finally {
      setDeleteInFlight(false);
    }
  };

  return <div className="wb-workflow-directory" data-cloud-surface="workflow-directory">
    <header className="wb-workflow-directory-header"><div><div className="wb-workflow-eyebrow">{copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.description}</p></div><div className="wb-workflow-header-actions"><a href="#recent-runs">{copy.history}</a><button type="button" onClick={() => void onAction({ type: "create" })}>{copy.create}</button></div></header>
    <div className="wb-workflow-metrics">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>

    <section className="wb-workflow-section" data-workflow-section="saved"><header><div><div className="wb-workflow-eyebrow">{copy.savedEyebrow}</div><h2>{copy.saved}</h2><p>{copy.savedDescription}</p></div><strong>{workflows.length}</strong></header><div className="wb-workflow-card-grid">
      <article className="wb-workflow-create-card"><div className="wb-workflow-create-icon">＋</div><h3>{copy.createTitle}</h3><p>{copy.createDescription}</p><button type="button" onClick={() => void onAction({ type: "create" })}>{copy.create}</button></article>
      {workflows.map((workflow) => <article className="wb-workflow-card" key={workflow.id} data-workflow-status={workflow.status}><div className="wb-workflow-card-heading"><h3>{workflow.title}</h3><span>{workflow.status}</span></div><p>{workflow.description}</p><div className="wb-workflow-node-preview"><span>{locale === "zh" ? "开始" : "Start"}</span><i>→</i><span>{workflow.nodeCount} {locale === "zh" ? "个节点" : "nodes"}</span><i>→</i><span>＋</span></div><div className="wb-workflow-updated">{copy.updated}: {formatWorkflowDate(workflow.updatedAt, locale, nowMs)}</div><div className="wb-workflow-card-actions"><button type="button" onClick={() => void onAction({ type: "open", id: workflow.id })}>{copy.open}</button>{actionAvailability?.duplicate !== false ? <button type="button" onClick={() => void onAction({ type: "duplicate", id: workflow.id })}>{copy.duplicate}</button> : null}{actionAvailability?.delete !== false ? <button type="button" onClick={() => setPendingDeleteWorkflowId(workflow.id)}>{copy.remove}</button> : null}</div></article>)}
    </div></section>

    <section className="wb-workflow-section" data-workflow-section="templates"><header><div><div className="wb-workflow-eyebrow">{copy.templateEyebrow}</div><h2>{copy.template}</h2><p>{copy.templateDescription}</p></div><strong>{templates.length}</strong></header>{templates.length ? <div className="wb-workflow-template-grid">{templates.map((template) => <article key={template.id} data-template-status={template.status}><div className="wb-workflow-card-heading"><h3>{template.title}</h3><span>{template.status}</span></div><p>{template.description}</p><button type="button" disabled={template.status !== "ready"} onClick={() => void onAction({ type: "instantiate", id: template.id })}>{copy.instantiate}</button></article>)}</div> : <div className="wb-workflow-empty">{copy.noTemplates}</div>}</section>

    <section className="wb-workflow-section" data-workflow-section="recent-runs" id="recent-runs"><header><div><div className="wb-workflow-eyebrow">{copy.recentEyebrow}</div><h2>{copy.recent}</h2></div></header><div className="wb-workflow-run-filters"><input value={runSearch} onChange={(event) => setRunSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search} /><select value={runStatus} onChange={(event) => setRunStatus(event.target.value)}><option value="all">{copy.all}</option><option value="succeeded">succeeded</option><option value="failed">failed</option><option value="running">running</option><option value="queued">queued</option></select></div><div className="wb-workflow-run-table"><table><thead><tr><th>{copy.workflow}</th><th>{copy.run}</th><th>{copy.created}</th><th>{copy.duration}</th><th>{copy.status}</th><th>{copy.action}</th></tr></thead><tbody>{visibleRuns.map((run) => <tr key={run.id}><td>{run.workflowTitle}</td><td>#{run.id}</td><td>{formatWorkflowDate(run.createdAt, locale, nowMs)}</td><td>{runDuration(run)}</td><td><span data-run-status={run.status}>{run.status}</span></td><td><button type="button" onClick={() => void onAction({ type: "open-run", id: run.id })}>{copy.details}</button></td></tr>)}{!visibleRuns.length ? <tr><td colSpan={6}>{copy.empty}</td></tr> : null}</tbody></table></div></section>
    {pendingDeleteWorkflow ? <div className="wb-workflow-delete-overlay" data-workflow-delete-confirmation="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteInFlight) setPendingDeleteWorkflowId(null); }}><div className="wb-workflow-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-delete-title"><div className="wb-workflow-eyebrow">{locale === "zh" ? "删除确认" : "Delete confirmation"}</div><h2 id="workflow-delete-title">{locale === "zh" ? "确认删除此工作流？" : "Delete this workflow?"}</h2><p>{locale === "zh" ? `工作流“${pendingDeleteWorkflow.title}”及其保存的修订记录将被删除，且无法恢复。` : `“${pendingDeleteWorkflow.title}” and its saved revisions will be permanently deleted.`}</p><div className="wb-workflow-delete-actions"><button type="button" disabled={deleteInFlight} onClick={() => setPendingDeleteWorkflowId(null)}>{locale === "zh" ? "取消" : "Cancel"}</button><button type="button" disabled={deleteInFlight} onClick={() => void confirmDeleteWorkflow()}>{deleteInFlight ? (locale === "zh" ? "删除中…" : "Deleting…") : (locale === "zh" ? "确认删除" : "Confirm delete")}</button></div></div></div> : null}
  </div>;
}
