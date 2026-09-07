import React, { useEffect, useState } from "react";
import type { WorkflowCanvasExecutionSnapshot, WorkflowCanvasNode } from "@coworkany/workbench-ui";
import { isTauriBridgeAvailable, tauriBridge } from "./tauri";
import type { WorkflowOutputItem } from "./workflow-output";
import { normalizeWorkflowOutput } from "./workflow-output";

type PreviewPayload = { mimeType: string; data: number[] };

function downloadInBrowser(item: WorkflowOutputItem) {
  if (!item.text && !item.url) return;
  const blob = item.text ? new Blob([item.text], { type: item.mimeType }) : undefined;
  const anchor = document.createElement("a");
  anchor.href = blob ? URL.createObjectURL(blob) : item.url!;
  anchor.download = item.fileName || item.label || "workflow-output";
  anchor.click();
  if (blob) window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function outputKindLabel(item: WorkflowOutputItem, locale: "zh" | "en") {
  if (locale === "en") return item.kind === "text" ? "Text" : item.kind === "image" ? "Image" : item.kind === "video" ? "Video" : item.kind === "audio" ? "Audio" : item.kind === "ppt" ? "Presentation" : "File";
  return item.kind === "text" ? "文本" : item.kind === "image" ? "图片" : item.kind === "video" ? "视频" : item.kind === "audio" ? "音频" : item.kind === "ppt" ? "演示文稿" : "文件";
}

function WorkflowOutputMedia({ item, locale }: { item: WorkflowOutputItem; locale: "zh" | "en" }) {
  const preferLocalPreview = isTauriBridgeAvailable() && Boolean(item.localPath || item.relativePath);
  const [source, setSource] = useState<string | null>(preferLocalPreview ? null : item.url ?? null);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    if (!preferLocalPreview || (!item.localPath && !item.relativePath)) {
      setSource(item.url ?? null);
      return undefined;
    }
    let active = true;
    let objectUrl: string | undefined;
    const command = item.localPath ? "read_workflow_local_file" : "read_artifact";
    const args = item.localPath ? { localPath: item.localPath, mimeType: item.mimeType } : { relativePath: item.relativePath, mimeType: item.mimeType };
    void tauriBridge.invoke<PreviewPayload>(command, args)
      .then((payload) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType || item.mimeType }));
        setSource(objectUrl);
      })
      .catch(() => { if (active) setPreviewError(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.url, item.localPath, item.relativePath, item.mimeType, preferLocalPreview]);

  if (item.kind === "text") return <pre className="workflow-output-text-preview">{item.text}</pre>;
  if (source && item.kind === "image") return <img className="workflow-output-image-preview" src={source} alt={item.label} />;
  if (source && item.kind === "video") return <video className="workflow-output-video-preview" controls preload="metadata" src={source} />;
  if (source && item.kind === "audio") return <audio className="workflow-output-audio-preview" controls preload="metadata" src={source} />;
  return <div className="workflow-output-file-preview"><span>{previewError ? (locale === "zh" ? "预览不可用" : "Preview unavailable") : outputKindLabel(item, locale)}</span><strong>{item.label}</strong></div>;
}

export function WorkflowOutputPreview({ node, snapshot, locale }: { node: WorkflowCanvasNode; snapshot: WorkflowCanvasExecutionSnapshot; locale: "zh" | "en" }) {
  if (snapshot.status === "failed") {
    const message = snapshot.errorMessage?.trim() || (locale === "zh" ? "该节点执行失败，未返回详细错误。" : "This node failed without a detailed error.");
    return <div className="workflow-node-error" data-node-error="true" role="alert">
      <strong>{locale === "zh" ? "节点执行失败" : "Node execution failed"}</strong>
      <span>{message}</span>
    </div>;
  }
  if (node.type !== "output" || snapshot.status !== "succeeded") return null;
  const items = normalizeWorkflowOutput(snapshot.outputPayload);
  if (!items.length) return <div className="workflow-output-empty">{locale === "zh" ? "没有可展示的输出" : "No output to display"}</div>;
  const download = (item: WorkflowOutputItem) => {
    if (!isTauriBridgeAvailable()) {
      downloadInBrowser(item);
      return;
    }
    void tauriBridge.invoke("save_workflow_output", {
      content: item.text,
      localPath: item.localPath,
      relativePath: item.relativePath,
      mimeType: item.mimeType,
      fileName: item.fileName || item.label,
    });
  };
  return <div className="workflow-output-preview" data-node-output="true" aria-label={locale === "zh" ? "结果预览内容" : "Result preview content"}>
    <div className="workflow-output-heading"><strong>{locale === "zh" ? "输出内容" : "Output content"}</strong><small>{items.length} {locale === "zh" ? "项" : items.length === 1 ? "item" : "items"}</small></div>
    {items.map((item) => <article className="workflow-output-item" key={item.id}>
      <div className="workflow-output-item-meta"><span>{outputKindLabel(item, locale)}</span><button type="button" data-node-no-drag="true" onClick={(event) => { event.stopPropagation(); download(item); }}>{locale === "zh" ? "下载" : "Download"}</button></div>
      <WorkflowOutputMedia item={item} locale={locale} />
    </article>)}
  </div>;
}
