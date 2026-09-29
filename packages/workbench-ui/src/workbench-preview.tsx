"use client";

import React, { useEffect, useState } from "react";
import { Download, ExternalLink, Maximize2, RefreshCw, X } from "lucide-react";
import type { DesktopPreviewData } from "@coworkany/workbench-client";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
  WebPreview,
} from "./ai-elements";

export type WorkbenchPreviewSource = {
  readonly url: string;
  readonly revoke?: () => void;
};

export type WorkbenchPreviewContext = {
  readonly messageId: string;
  readonly conversationId?: string;
  readonly runId?: string;
};

export type WorkbenchPreviewProps = {
  readonly preview: DesktopPreviewData;
  readonly locale: "zh" | "en";
  readonly context: WorkbenchPreviewContext;
  readonly resolveSource?: (preview: DesktopPreviewData, context: WorkbenchPreviewContext) => Promise<WorkbenchPreviewSource | null>;
  readonly onRefresh?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onDownload?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onExport?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly onOpenExternal?: (preview: DesktopPreviewData) => void | Promise<void>;
  readonly defaultExpanded?: boolean;
};

function PreviewContent({ preview, source, expanded }: { readonly preview: DesktopPreviewData; readonly source: string; readonly expanded: boolean }) {
  if (preview.kind === "image") return <img className="wb-ai-preview-image" src={source} alt={preview.title} />;
  if (preview.kind === "video") return <video className="wb-ai-preview-video" controls preload="metadata" src={source} aria-label={preview.title} />;
  if (preview.kind === "audio") return <audio className="wb-ai-preview-audio" controls preload="metadata" src={source} aria-label={preview.title} />;
  return <WebPreview className={expanded ? "wb-ai-web-preview-expanded" : "wb-ai-web-preview-inline"} title={preview.title}>
    <iframe
      title={preview.title}
      src={source}
      sandbox="allow-downloads allow-forms allow-modals allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      referrerPolicy="no-referrer"
    />
  </WebPreview>;
}

function PreviewState({ preview, state, locale }: { readonly preview: DesktopPreviewData; readonly state: "loading" | "unavailable"; readonly locale: "zh" | "en" }) {
  const loading = state === "loading";
  const message = loading
    ? (locale === "zh" ? "正在连接本地预览…" : "Connecting to local preview…")
    : (preview.error || (locale === "zh" ? "预览暂不可用，可重试或导出文件" : "Preview unavailable; retry or export the file"));
  return <div className="wb-ai-preview-state" data-preview-state={state} role="status" aria-busy={loading || undefined}>
    <strong>{preview.title}</strong>
    <span>{message}</span>
  </div>;
}

/** Shared in-conversation preview card with a right-side preview panel. */
export function WorkbenchPreview({ preview, locale, context, resolveSource, onRefresh, onDownload, onExport, onOpenExternal, defaultExpanded = false }: WorkbenchPreviewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(preview.status === "unavailable");
  const [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    setSource(null);
    setFailed(preview.status === "unavailable");
    if (!resolveSource || preview.status === "unavailable") return () => undefined;
    void resolveSource(preview, context)
      .then((resolved) => {
        if (!active) return;
        revoke = resolved?.revoke;
        setSource(resolved?.url ?? null);
        setFailed(!resolved?.url);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      revoke?.();
    };
  }, [preview.previewSessionId, preview.artifactId, preview.relativePath, preview.url, preview.status, context.messageId, context.conversationId, context.runId, resolveSource, revision]);

  useEffect(() => {
    if (!expanded) return () => undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
    };
    globalThis.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [expanded]);

  const state = source ? "ready" : failed ? "unavailable" : "loading";
  const reload = async () => {
    setActionError(null);
    setFailed(false);
    setSource(null);
    try {
      await onRefresh?.(preview);
      setRevision((value) => value + 1);
    } catch (error) {
      setFailed(true);
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };
  const runAction = async (action: ((value: DesktopPreviewData) => void | Promise<void>) | undefined) => {
    if (!action) return;
    setActionError(null);
    try {
      await action(preview);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };
  const engine = preview.engine === "ppt-master" ? "PPT Master" : preview.engine === "dashi-ppt" ? "Dashi PPT" : preview.kind === "web" ? "Web" : preview.kind.toUpperCase();
  const expandLabel = locale === "zh" ? "在侧边栏展开预览" : "Open preview in side panel";
  const openBrowserLabel = locale === "zh" ? "在浏览器中打开" : "Open in browser";
  const downloadable = Boolean(onDownload && (preview.artifactId || preview.relativePath));
  const exportable = Boolean(onExport && (preview.artifactId || preview.engine === "dashi-ppt"));
  const externallyOpenable = Boolean(onOpenExternal && preview.url);

  return <div className="wb-ai-preview" data-preview-id={preview.previewSessionId ?? preview.artifactId ?? preview.title} data-preview-kind={preview.kind} data-preview-state={state}>
    <Artifact className="wb-ai-preview-card">
      <ArtifactHeader>
        <div className="ai-elements-artifact-heading"><ArtifactTitle>{preview.title}</ArtifactTitle><ArtifactDescription>{engine}</ArtifactDescription></div>
        <ArtifactActions>
          <ArtifactAction icon={RefreshCw} label={locale === "zh" ? "刷新预览" : "Refresh preview"} onClick={() => void reload()} />
          {downloadable ? <ArtifactAction icon={Download} label={locale === "zh" ? "下载" : "Download"} onClick={() => void runAction(onDownload)} /> : null}
          {exportable ? <button type="button" className="wb-ai-preview-text-action" onClick={() => void runAction(onExport)}>{locale === "zh" ? "导出" : "Export"}</button> : null}
          {externallyOpenable ? <ArtifactAction icon={ExternalLink} label={openBrowserLabel} onClick={() => void runAction(onOpenExternal)} /> : null}
          <ArtifactAction icon={Maximize2} label={expandLabel} onClick={() => setExpanded(true)} />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent>{source ? <PreviewContent preview={preview} source={source} expanded={false} /> : <PreviewState preview={preview} state={failed ? "unavailable" : "loading"} locale={locale} />}</ArtifactContent>
      {actionError ? <div className="wb-ai-preview-action-error" role="alert">{locale === "zh" ? `操作失败：${actionError}` : `Action failed: ${actionError}`}</div> : null}
    </Artifact>
    {expanded ? <div className="wb-ai-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setExpanded(false); }}>
      <section className="wb-ai-preview-expanded" role="dialog" aria-modal="true" aria-label={preview.title} data-preview-expanded="true" data-preview-layout="side-panel">
        <header><div><strong>{preview.title}</strong><span>{engine}</span></div><div className="wb-ai-preview-expanded-header-actions">{externallyOpenable ? <button type="button" onClick={() => void runAction(onOpenExternal)}><ExternalLink size={15} aria-hidden="true" />{openBrowserLabel}</button> : null}<button type="button" className="wb-ai-preview-close" onClick={() => setExpanded(false)} aria-label={locale === "zh" ? "关闭预览" : "Close preview"}><X size={18} aria-hidden="true" /></button></div></header>
        <div className="wb-ai-preview-expanded-content">{source ? <PreviewContent preview={preview} source={source} expanded /> : <PreviewState preview={preview} state={failed ? "unavailable" : "loading"} locale={locale} />}</div>
        <footer>{actionError ? <span role="alert">{locale === "zh" ? `操作失败：${actionError}` : `Action failed: ${actionError}`}</span> : null}<button type="button" onClick={() => void reload()}>{locale === "zh" ? "刷新" : "Refresh"}</button>{exportable ? <button type="button" onClick={() => void runAction(onExport)}>{locale === "zh" ? "导出" : "Export"}</button> : null}{downloadable ? <button type="button" onClick={() => void runAction(onDownload)}>{locale === "zh" ? "下载" : "Download"}</button> : null}<button type="button" onClick={() => setExpanded(false)}>{locale === "zh" ? "返回会话" : "Back to conversation"}</button></footer>
      </section>
    </div> : null}
  </div>;
}
