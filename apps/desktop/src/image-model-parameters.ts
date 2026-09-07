export type DesktopImageModelKind =
  | "gpt-image-2"
  | "bailian-qwen"
  | "nanobanana-2"
  | "seedream-text-to-image"
  | "seedream-image-to-image"
  | "generic";

export type DesktopImageParameterType = "select" | "number" | "text";

export type DesktopImageParameterField = {
  readonly id: string;
  readonly type: DesktopImageParameterType;
  readonly label: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly defaultValue?: string;
  readonly min?: number;
  readonly max?: number;
  readonly placeholder?: string;
  readonly visibleWhen?: (settings: Readonly<Record<string, string>>) => boolean;
};

export type DesktopImageSettings = Record<string, string>;

function normalizedModel(model: string) {
  return model.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

export function resolveDesktopImageModelKind(model: string): DesktopImageModelKind {
  const value = normalizedModel(model);
  if (value.includes("gpt-image-2")) return "gpt-image-2";
  if (value.includes("qwen-image")) return "bailian-qwen";
  if (value.includes("nanobanana-2") || value.includes("nanobanana2") || value.includes("gemini-2.5-flash-image")) return "nanobanana-2";
  if (value.includes("seedream") && /image-to-image|img2img|image2image/iu.test(value)) return "seedream-image-to-image";
  if (value.includes("seedream")) return "seedream-text-to-image";
  return "generic";
}

function select(id: string, label: string, options: readonly string[], defaultValue: string): DesktopImageParameterField {
  return { id, type: "select", label, defaultValue, options: options.map((value) => ({ value, label: value })) };
}

export function getDesktopImageParameterSchema(model: string, locale: "zh" | "en" = "zh"): readonly DesktopImageParameterField[] {
  const kind = resolveDesktopImageModelKind(model);
  const labels = locale === "zh";
  if (kind === "gpt-image-2") {
    return [
      select("size", labels ? "尺寸" : "Size", ["auto", "1024x1024", "1536x1024", "1024x1536"], "1024x1024"),
      select("quality", labels ? "质量" : "Quality", ["auto", "low", "medium", "high"], "auto"),
      select("background", labels ? "背景" : "Background", ["auto", "transparent", "opaque"], "auto"),
      select("outputFormat", labels ? "输出格式" : "Output format", ["png", "jpeg", "webp"], "png"),
      { id: "outputCompression", type: "number", label: labels ? "输出压缩" : "Output compression", defaultValue: "80", min: 0, max: 100, visibleWhen: (settings) => settings.outputFormat === "jpeg" || settings.outputFormat === "webp" },
      select("moderation", labels ? "内容审核" : "Moderation", ["auto", "low"], "auto"),
      select("responseFormat", labels ? "响应格式" : "Response format", ["url", "b64_json"], "url"),
      { id: "candidateCount", type: "number", label: labels ? "生成数量" : "Candidates", defaultValue: "1", min: 1, max: 9 },
      { id: "referenceImages", type: "text", label: labels ? "参考图片" : "Reference images", placeholder: labels ? "本地产物路径或 URL，多个用逗号分隔" : "Local artifact paths or URLs, comma-separated" },
    ];
  }
  if (kind === "bailian-qwen") {
    const normalized = normalizedModel(model);
    const editModel = /(?:-edit|image-to-image|img2img)/iu.test(normalized);
    const qwen27Model = normalized.includes("2.7");
    const supportsAdvanced = !editModel && !qwen27Model;
    return [
      select("size", labels ? "尺寸" : "Size", qwen27Model || editModel ? ["auto", "1024*1024", "2048*2048"] : ["auto", "1024*1024", "1536*1024", "1024*1536", "2048*2048"], editModel ? "auto" : "1024*1024"),
      ...(supportsAdvanced || editModel ? [{ id: "negativePrompt", type: "text" as const, label: labels ? "反向提示词" : "Negative prompt" }] : []),
      ...(supportsAdvanced || editModel ? [{ id: "candidateCount", type: "number" as const, label: labels ? "生成数量" : "Candidates", defaultValue: "1", min: 1, max: 6 }] : []),
      ...(supportsAdvanced ? [select("promptExtend", labels ? "提示词扩写" : "Prompt extension", ["true", "false"], "true"), select("watermark", labels ? "水印" : "Watermark", ["false", "true"], "false"), { id: "seed", type: "number" as const, label: labels ? "随机种子" : "Seed", defaultValue: "0", min: 0, max: 2147483647 }] : []),
      { id: "referenceImages", type: "text", label: labels ? "参考图片" : "Reference images", placeholder: labels ? "本地产物路径或 URL，多个用逗号分隔" : "Local artifact paths or URLs, comma-separated" },
    ];
  }
  if (kind === "nanobanana-2") {
    return [
      select("size", labels ? "宽高比" : "Aspect ratio", ["1:1", "4:5", "3:4", "4:3", "16:9", "9:16"], "1:1"),
      select("resolution", labels ? "分辨率" : "Resolution", ["1K", "2K", "4K"], "2K"),
      { id: "referenceImages", type: "text", label: labels ? "参考图片" : "Reference images", placeholder: labels ? "本地产物路径或 URL，多个用逗号分隔" : "Local artifact paths or URLs, comma-separated" },
    ];
  }
  if (kind === "seedream-image-to-image") {
    return [
      select("size", labels ? "尺寸" : "Size", ["1024x1024", "1536x1024"], "1024x1024"),
      { id: "inputImageUrl", type: "text", label: labels ? "输入图片" : "Input image", placeholder: labels ? "必填：图片 URL 或本地产物路径" : "Required: image URL or local artifact path" },
    ];
  }
  if (kind === "seedream-text-to-image") {
    return [select("size", labels ? "尺寸" : "Size", ["1024x1024", "1536x1024"], "1024x1024")];
  }
  return [
    select("quality", labels ? "质量" : "Quality", ["standard", "hd"], "standard"),
    select("size", labels ? "尺寸" : "Size", ["1024x1024", "1536x1024", "1024x1536"], "1024x1024"),
    { id: "count", type: "number", label: labels ? "生成数量" : "Count", defaultValue: "1", min: 1, max: 4 },
    { id: "referenceImages", type: "text", label: labels ? "参考图片" : "Reference images", placeholder: labels ? "本地产物路径或 URL，多个用逗号分隔" : "Local artifact paths or URLs, comma-separated" },
  ];
}

export function normalizeDesktopImageSettings(model: string, previous: Readonly<Record<string, unknown>> = {}): DesktopImageSettings {
  const kind = resolveDesktopImageModelKind(model);
  const fields = getDesktopImageParameterSchema(model, "en");
  return Object.fromEntries(fields.map((field) => {
    const value = previous[field.id];
    if (kind === "gpt-image-2" && field.id === "responseFormat") return [field.id, "url"];
    return [field.id, typeof value === "string" && (field.type !== "select" || field.options?.some((option) => option.value === value)) ? value : field.defaultValue ?? ""];
  }));
}

export function buildDesktopImageRunInput(model: string, settings: Readonly<Record<string, unknown>>, attachments: readonly string[] = []): Record<string, unknown> {
  const kind = resolveDesktopImageModelKind(model);
  const fields = getDesktopImageParameterSchema(model, "en");
  const validIds = new Set(fields.map((field) => field.id));
  const values = Object.fromEntries(Object.entries(settings).filter(([id]) => validIds.has(id) && settings[id] !== ""));
  const input: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find((candidate) => candidate.id === id);
    if (field?.type === "number") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) input[id] = numeric;
    } else input[id] = value;
  }
  if (kind === "gpt-image-2") {
    if (typeof input.outputFormat === "string") { input.output_format = input.outputFormat; delete input.outputFormat; }
    if (typeof input.responseFormat === "string") { input.response_format = input.responseFormat; delete input.responseFormat; }
    if (typeof input.outputCompression === "number") { input.output_compression = input.outputCompression; delete input.outputCompression; }
    if (typeof input.candidateCount === "number") { input.n = input.candidateCount; delete input.candidateCount; }
    if (input.output_format === "png") delete input.output_compression;
  } else if (kind === "bailian-qwen" && typeof input.candidateCount === "number") {
    input.n = input.candidateCount;
    delete input.candidateCount;
  } else if (kind === "generic" && typeof input.count === "number") {
    input.n = input.count;
    delete input.count;
  }
  if (typeof input.referenceImages === "string") {
    input.referenceImages = input.referenceImages.split(",").map((value) => value.trim()).filter(Boolean);
  }
  if (attachments.length) input.localAttachments = [...new Set(attachments.filter(Boolean))];
  return input;
}
