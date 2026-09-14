import { useEffect, useRef, useState } from "react";

type ImageMaskEditorProps = {
  readonly sourceUrl: string;
  readonly locale: "zh" | "en";
  readonly onCancel: () => void;
  readonly onSubmit: (prompt: string, input: { inputImageUrl: string; maskImageUrl: string; taskType: "mask_edit" }) => void;
};

type Point = { x: number; y: number };

function buildTransparentEditMask(maskCanvas: HTMLCanvasElement) {
  const output = document.createElement("canvas");
  output.width = maskCanvas.width;
  output.height = maskCanvas.height;
  const context = output.getContext("2d");
  if (!context) return maskCanvas.toDataURL("image/png");
  const image = maskCanvas.getContext("2d")?.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  if (!image) return maskCanvas.toDataURL("image/png");
  for (let index = 0; index < image.data.length; index += 4) {
    const painted = image.data[index] > 200 && image.data[index + 1] > 200 && image.data[index + 2] > 200;
    image.data[index] = 255;
    image.data[index + 1] = 255;
    image.data[index + 2] = 255;
    image.data[index + 3] = painted ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
  return output.toDataURL("image/png");
}

export function ImageMaskEditor({ sourceUrl, locale, onCancel, onSubmit }: ImageMaskEditorProps) {
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(32);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const image = new window.Image();
    image.onload = () => {
      const imageCanvas = imageCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!imageCanvas || !maskCanvas) return;
      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      for (const canvas of [imageCanvas, maskCanvas]) {
        canvas.width = width;
        canvas.height = height;
      }
      const imageContext = imageCanvas.getContext("2d");
      const maskContext = maskCanvas.getContext("2d");
      if (!imageContext || !maskContext) return;
      imageContext.clearRect(0, 0, width, height);
      imageContext.drawImage(image, 0, 0, width, height);
      maskContext.fillStyle = "#000";
      maskContext.fillRect(0, 0, width, height);
      setReady(true);
    };
    image.onerror = () => setReady(false);
    image.src = sourceUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [sourceUrl]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const paint = (point: Point) => {
    const context = maskCanvasRef.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fff";
    context.strokeStyle = "#fff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.lineTo(point.x, point.y);
    context.stroke();
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const startPaint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const context = maskCanvasRef.current?.getContext("2d");
    context?.beginPath();
    context?.moveTo(point.x, point.y);
    paint(point);
  };

  const continuePaint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    if (point) paint(point);
  };

  const stopPaint = () => {
    drawingRef.current = false;
    maskCanvasRef.current?.getContext("2d")?.beginPath();
  };

  const submit = () => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!ready || !imageCanvas || !maskCanvas) return;
    onSubmit(prompt.trim(), {
      inputImageUrl: imageCanvas.toDataURL("image/png"),
      maskImageUrl: buildTransparentEditMask(maskCanvas),
      taskType: "mask_edit",
    });
  };

  const copy = locale === "zh"
    ? { title: "局部编辑", hint: "在图片上涂抹需要修改的区域", brush: "画笔大小", prompt: "编辑说明", placeholder: "例如：把标记区域改成夜景", cancel: "取消", submit: "应用编辑", loading: "图片加载中" }
    : { title: "Edit image", hint: "Paint over the area you want to change", brush: "Brush size", prompt: "Edit instruction", placeholder: "For example: turn the marked area into a night scene", cancel: "Cancel", submit: "Apply edit", loading: "Loading image" };

  return <div className="desktop-image-editor" role="dialog" aria-modal="true" aria-label={copy.title}>
    <div className="desktop-image-editor-sheet">
      <header className="desktop-image-editor-header">
        <div><span className="eyebrow">{copy.title}</span><p>{copy.hint}</p></div>
        <button type="button" className="media-preview-fullscreen" onClick={onCancel}>{copy.cancel}</button>
      </header>
      <div className="desktop-image-editor-stage">
        <div className="desktop-image-editor-surface">
          <canvas ref={imageCanvasRef} className="desktop-image-editor-canvas" aria-label={copy.title} />
          <canvas ref={maskCanvasRef} className="desktop-image-editor-canvas desktop-image-editor-mask" onPointerDown={startPaint} onPointerMove={continuePaint} onPointerUp={stopPaint} onPointerCancel={stopPaint} onPointerLeave={stopPaint} />
        </div>
        {!ready ? <span className="desktop-image-editor-loading">{copy.loading}</span> : null}
      </div>
      <div className="desktop-image-editor-controls">
        <label><span>{copy.brush}</span><input type="range" min="8" max="100" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
        <label className="desktop-image-editor-prompt"><span>{copy.prompt}</span><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={copy.placeholder} /></label>
        <button type="button" className="primary" disabled={!ready || !prompt.trim()} onClick={submit}>{copy.submit}</button>
      </div>
    </div>
  </div>;
}
