import { useEffect, useRef, useState } from "react";

export type OfficeArtifactFormat = "presentation" | "document" | "spreadsheet";

type OfficeViewer = { destroy: () => void; load: (source: ArrayBuffer) => Promise<void> };

export function OfficeArtifactPreview({ format, data, title, locale }: {
  readonly format: OfficeArtifactFormat;
  readonly data: ArrayBuffer;
  readonly title: string;
  readonly locale: "zh" | "en";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let viewer: OfficeViewer | undefined;
    setState("loading");

    void (async () => {
      let instance: OfficeViewer;
      if (format === "document") {
        const { DocxScrollViewer } = await import("@silurus/ooxml/docx");
        if (!active) return;
        instance = new DocxScrollViewer(container, { mode: "worker", enableHyperlinks: false });
      } else if (format === "presentation") {
        const { PptxScrollViewer } = await import("@silurus/ooxml/pptx");
        if (!active) return;
        instance = new PptxScrollViewer(container, { mode: "worker", enableHyperlinks: false });
      } else {
        const { XlsxViewer } = await import("@silurus/ooxml/xlsx");
        if (!active) return;
        instance = new XlsxViewer(container, { mode: "worker", enableHyperlinks: false });
      }
      viewer = instance;
      await instance.load(data);
      if (active) setState("ready");
      else instance.destroy();
    })().catch(() => {
      viewer?.destroy();
      viewer = undefined;
      if (active) setState("error");
    });

    return () => {
      active = false;
      viewer?.destroy();
    };
  }, [data, format]);

  return <div className="wb-ai-office-preview" data-artifact-preview-kind={format} data-artifact-preview-state={state} aria-label={title} aria-busy={state === "loading"}>
    <div className="wb-ai-office-preview-canvas" ref={containerRef} />
    {state !== "ready" ? <div className="wb-ai-office-preview-status" role={state === "error" ? "alert" : undefined}>
      {state === "error"
        ? (locale === "zh" ? "此 Office 文件无法解析预览，可下载或打开原文件" : "This Office file could not be rendered. Download or open the original file.")
        : (locale === "zh" ? "正在解析 Office 文件…" : "Parsing Office file…")}
    </div> : null}
  </div>;
}
