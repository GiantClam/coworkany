import { hashWorkflowText } from "@coworkany/workflow-core";

export type RunningHubWorkflowCapability = "image" | "video" | "digital_human" | "video_enhance" | "audio" | "audio_transcription";
export type RunningHubWorkflowSourceKind = "url" | "manual" | "runninghub-api-json" | "runninghub-ai-app" | "comfyui-api-json" | "comfyui-ui-json";
export type RunningHubWorkflowRequestKind = "workflow" | "ai-app";
export type RunningHubWorkflowFieldType = "text" | "textarea" | "number" | "integer" | "boolean" | "select" | "image" | "image_list" | "video" | "audio" | "file" | "json";

export type RunningHubWorkflowInputField = {
  readonly id: string;
  readonly label: string;
  readonly type: RunningHubWorkflowFieldType;
  readonly required?: boolean;
  readonly multiple?: boolean;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly defaultValue?: unknown;
  readonly accept?: readonly string[];
  readonly description?: string;
};

export type RunningHubNodeBinding = {
  readonly inputId: string;
  readonly nodeId: string;
  readonly fieldName: string;
  readonly valueType: "literal" | "file" | "file_list" | "reference";
  readonly transform?: "string" | "number" | "boolean" | "json";
  readonly required?: boolean;
  /** Used only by locally migrated legacy registrations. */
  readonly defaultValue?: unknown;
};

export type RunningHubWorkflowOutputField = {
  readonly id: string;
  readonly type: "text" | "image" | "video" | "audio" | "file" | "json";
  readonly nodeId?: string;
  readonly fieldName?: string;
  readonly required?: boolean;
};

export type RunningHubWorkflowRegistration = {
  readonly id: string;
  readonly remoteWorkflowId: string;
  readonly name: string;
  readonly description?: string;
  readonly capability: RunningHubWorkflowCapability;
  readonly version: number;
  readonly definitionHash: string;
  readonly source: { readonly kind: RunningHubWorkflowSourceKind; readonly url?: string; readonly importedAt: string };
  readonly request?: { readonly kind: RunningHubWorkflowRequestKind; readonly submitPath?: string; readonly queryPath?: string };
  readonly inputSchema: readonly RunningHubWorkflowInputField[];
  readonly nodeBindings: readonly RunningHubNodeBinding[];
  readonly outputSchema: readonly RunningHubWorkflowOutputField[];
  readonly validation?: { readonly lastCheckedAt?: string; readonly status: "unknown" | "ready" | "forbidden" | "not_found" | "changed" | "invalid"; readonly message?: string };
};

export type RunningHubWorkflowImport = {
  readonly remoteWorkflowId?: string;
  readonly sourceKind: RunningHubWorkflowSourceKind;
  readonly inputSchema: readonly RunningHubWorkflowInputField[];
  readonly nodeBindings: readonly RunningHubNodeBinding[];
  readonly outputSchema: readonly RunningHubWorkflowOutputField[];
  readonly definitionHash: string;
  readonly warnings: readonly string[];
};

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const normalizeId = (value: string) => value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "input";

export function runningHubWorkflowIdFromUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/\/workflow\/([a-zA-Z0-9_-]+)/u) ?? trimmed.match(/\/(?:api-detail|ai-app)\/(\d+)/u) ?? trimmed.match(/\/run\/ai-app\/(\d+)/u);
  return match?.[1] ?? (/^[a-zA-Z0-9_-]{4,}$/u.test(trimmed) ? trimmed : undefined);
}

function sourceKindFor(value: RecordValue): RunningHubWorkflowSourceKind {
  if (isRecord(value.prompt) || isRecord(value.extra)) return "comfyui-ui-json";
  return Object.values(value).some((item) => isRecord(item) && ("class_type" in item || "inputs" in item)) ? "comfyui-api-json" : "runninghub-api-json";
}

function nodeEntries(value: RecordValue): Array<[string, RecordValue]> {
  const candidates = isRecord(value.prompt) ? value.prompt : isRecord(value.workflow) ? value.workflow : value;
  return Object.entries(candidates).filter((entry): entry is [string, RecordValue] => isRecord(entry[1]) && (typeof entry[1].class_type === "string" || isRecord(entry[1].inputs)));
}

function fieldTypeFor(node: RecordValue, fieldName: string, value: unknown): RunningHubWorkflowFieldType | undefined {
  const key = fieldName.toLowerCase();
  const classType = text(node.class_type)?.toLowerCase() ?? "";
  if (/subtitle|caption|srt/u.test(key) || /subtitle|caption|srt/u.test(classType)) return "file";
  if (/image|mask|reference|avatar|frame|character|person|subject|background/u.test(key) || /loadimage/u.test(classType)) return /images|frames/u.test(key) ? "image_list" : "image";
  if (/video|movie|source/u.test(key) || /loadvideo/u.test(classType)) return /reference|videos/u.test(key) ? "file" : "video";
  if (/audio|sound|music/u.test(key) || /loadaudio/u.test(classType)) return "audio";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (Array.isArray(value)) return "json";
  if (typeof value === "string") return value.length > 120 || /prompt|text|script|instruction/u.test(key) ? "textarea" : "text";
  return undefined;
}

function inputIdFor(nodeId: string, node: RecordValue, fieldName: string, type: RunningHubWorkflowFieldType) {
  const key = fieldName.toLowerCase();
  if (/subtitle|caption|srt/u.test(key)) return "subtitle";
  if (/character|person|subject/u.test(key)) return "characterImage";
  if (/reference[_-]?image|background/u.test(key)) return "referenceImage";
  if (/prompt|positive|text|script|instruction/u.test(key)) return "prompt";
  if (/negative/u.test(key)) return "negativePrompt";
  if (type === "image_list" || /reference[_-]?images|images/u.test(key)) return "referenceImages";
  if (/first[_-]?frame|start[_-]?image/u.test(key)) return "firstFrame";
  if (/last[_-]?frame|end[_-]?image/u.test(key)) return "lastFrame";
  if (/source[_-]?video|input[_-]?video/u.test(key)) return "sourceVideo";
  if (/reference[_-]?video|videos/u.test(key)) return "referenceVideos";
  if (/audio|sound|music/u.test(key)) return "referenceAudio";
  if (/seed/u.test(key)) return "seed";
  if (/duration|seconds/u.test(key)) return "duration";
  return `${normalizeId(text(node.title) ?? text(node._meta) ?? nodeId)}_${normalizeId(fieldName)}`;
}

function capabilityFromInputs(fields: readonly RunningHubWorkflowInputField[]): RunningHubWorkflowCapability {
  const ids = fields.map((field) => field.id).join(" ").toLowerCase();
  if (/avatar|digital|speech|script/u.test(ids) && /audio/u.test(ids)) return "digital_human";
  if (/sourcevideo|enhance|upscale/u.test(ids)) return "video_enhance";
  if (/video|firstframe|lastframe/u.test(ids)) return "video";
  if (/image|referenceimages/u.test(ids)) return "image";
  return "video";
}

function inferCharacterImageRoleRenames(fields: ReadonlyMap<string, RunningHubWorkflowInputField>, bindings: readonly RunningHubNodeBinding[]) {
  const canonicalIds = new Set(["referenceImage", "characterImage"]);
  const imageFileBindings = bindings.filter((binding) =>
    binding.valueType === "file" &&
    !canonicalIds.has(binding.inputId) &&
    ["image", "image_list"].includes(fields.get(binding.inputId)?.type ?? ""),
  );
  const renames = new Map<string, string>();
  const hasBinding = (inputId: string) => bindings.some((binding) => binding.inputId === inputId) || [...renames.values()].includes(inputId);
  for (const role of ["referenceImage", "characterImage"] as const) {
    if (hasBinding(role)) continue;
    const candidate = imageFileBindings.find((binding) => !renames.has(binding.inputId));
    if (candidate) renames.set(candidate.inputId, role);
  }
  return renames;
}

/** Repairs older image registrations that were imported before canonical
 * reference/character roles were inferred from generic LoadImage fields. */
export function normalizeRunningHubCharacterImageBindings(registration: RunningHubWorkflowRegistration): RunningHubWorkflowRegistration {
  if (registration.capability !== "image") return registration;
  const fields = new Map(registration.inputSchema.map((field) => [field.id, field]));
  const renames = inferCharacterImageRoleRenames(fields, registration.nodeBindings);
  if (!renames.size) return registration;
  const inputSchema = registration.inputSchema.flatMap((field) => {
    const nextId = renames.get(field.id);
    if (!nextId) return [field];
    return fields.has(nextId) ? [] : [{ ...field, id: nextId, label: nextId }];
  });
  return { ...registration, inputSchema, nodeBindings: registration.nodeBindings.map((binding) => ({ ...binding, inputId: renames.get(binding.inputId) ?? binding.inputId })) };
}

export function parseRunningHubWorkflowJson(raw: unknown, options: { readonly remoteWorkflowId?: string; readonly sourceKind?: RunningHubWorkflowSourceKind } = {}): RunningHubWorkflowImport {
  if (!isRecord(raw)) throw new Error("runninghub_workflow_json_invalid");
  const bindings: RunningHubNodeBinding[] = [];
  const fields = new Map<string, RunningHubWorkflowInputField>();
  const warnings: string[] = [];
  for (const [nodeId, node] of nodeEntries(raw)) {
    const inputs = isRecord(node.inputs) ? node.inputs : node;
    for (const [fieldName, value] of Object.entries(inputs)) {
      if (isRecord(value) || Array.isArray(value)) continue;
      const type = fieldTypeFor(node, fieldName, value);
      if (!type || /filename|file_name|output|preview|model_name/u.test(fieldName)) continue;
      const inputId = inputIdFor(nodeId, node, fieldName, type);
      const existing = fields.get(inputId);
      const multiple = type === "image_list" || /images|videos|references/u.test(fieldName);
      fields.set(inputId, {
        id: inputId,
        label: existing?.label ?? inputId,
        type: existing?.type === "text" && type === "textarea" ? "textarea" : existing?.type ?? type,
        ...(multiple ? { multiple: true, maxItems: inputId === "referenceImages" ? 9 : 3 } : {}),
        ...(existing?.defaultValue === undefined && value !== undefined ? { defaultValue: value } : existing?.defaultValue !== undefined ? { defaultValue: existing.defaultValue } : {}),
      });
      bindings.push({ inputId, nodeId, fieldName, valueType: type === "file" || type === "image" || type === "image_list" || type === "video" || type === "audio" ? (multiple ? "file_list" : "file") : "literal", transform: type === "number" || type === "integer" ? "number" : type === "boolean" ? "boolean" : "string" });
    }
  }
  // RunningHub exports often call both LoadImage inputs simply `image`. Keep
  // those workflows usable by assigning the first two unlabelled image files
  // to the canonical roles used by the character-replacement template.
  // Explicitly named roles always win, and list bindings are left untouched
  // because the template expects one file per role.
  const inputIdRenames = inferCharacterImageRoleRenames(fields, bindings);
  for (const [from, to] of inputIdRenames) {
    const field = fields.get(from);
    if (!field) continue;
    fields.delete(from);
    if (!fields.has(to)) fields.set(to, { ...field, id: to, label: to });
  }
  const normalizedBindings = bindings.map((binding) => ({ ...binding, inputId: inputIdRenames.get(binding.inputId) ?? binding.inputId }));
  if (!normalizedBindings.length) warnings.push("no_editable_workflow_inputs_detected");
  const inputSchema = [...fields.values()];
  const canonical = JSON.stringify({ nodes: nodeEntries(raw).map(([id, node]) => [id, node]), inputs: inputSchema, bindings: normalizedBindings });
  return { remoteWorkflowId: options.remoteWorkflowId, sourceKind: options.sourceKind ?? sourceKindFor(raw), inputSchema, nodeBindings: normalizedBindings, outputSchema: [{ id: "output", type: capabilityFromInputs(inputSchema) === "image" ? "image" : capabilityFromInputs(inputSchema) === "audio" ? "audio" : "video" }], definitionHash: hashWorkflowText(canonical), warnings };
}

export function createRunningHubWorkflowRegistration(input: RunningHubWorkflowImport & { readonly id: string; readonly remoteWorkflowId: string; readonly name: string; readonly capability?: RunningHubWorkflowCapability; readonly source?: { readonly kind: RunningHubWorkflowSourceKind; readonly url?: string }; readonly request?: { readonly kind: RunningHubWorkflowRequestKind; readonly submitPath?: string; readonly queryPath?: string } }): RunningHubWorkflowRegistration {
  if (!input.remoteWorkflowId.trim()) throw new Error("runninghub_workflow_id_required");
  const capability = input.capability ?? capabilityFromInputs(input.inputSchema);
  return { id: input.id, remoteWorkflowId: input.remoteWorkflowId.trim(), name: input.name.trim() || input.id, capability, version: 1, definitionHash: input.definitionHash, source: { kind: input.source?.kind ?? input.sourceKind, ...(input.source?.url ? { url: input.source.url } : {}), importedAt: new Date().toISOString() }, ...(input.request ? { request: input.request } : {}), inputSchema: input.inputSchema, nodeBindings: input.nodeBindings, outputSchema: input.outputSchema, validation: { status: "unknown" } };
}

export function createRunningHubAudioTranscriptionRegistration(input: {
  readonly id: string;
  readonly appId: string;
  readonly name: string;
  readonly sourceUrl?: string;
  readonly inputNodeId?: string;
  readonly inputFieldName?: string;
  readonly submitPath?: string;
  readonly queryPath?: string;
}): RunningHubWorkflowRegistration {
  const remoteWorkflowId = input.appId.trim();
  const nodeId = input.inputNodeId?.trim() || "2";
  const fieldName = input.inputFieldName?.trim() || "audio";
  if (!remoteWorkflowId) throw new Error("runninghub_ai_app_id_required");
  const inputSchema: RunningHubWorkflowInputField[] = [{ id: "audio", label: "音频文件", type: "audio", required: true, accept: ["audio/*"] }];
  const nodeBindings: RunningHubNodeBinding[] = [{ inputId: "audio", nodeId, fieldName, valueType: "file", required: true }];
  const outputSchema: RunningHubWorkflowOutputField[] = [{ id: "transcript", type: "text", required: true }];
  const request = { kind: "ai-app" as const, submitPath: input.submitPath?.trim() || `/openapi/v2/run/ai-app/${encodeURIComponent(remoteWorkflowId)}`, queryPath: input.queryPath?.trim() || "/openapi/v2/query" };
  return createRunningHubWorkflowRegistration({
    id: input.id,
    remoteWorkflowId,
    name: input.name,
    capability: "audio_transcription",
    sourceKind: "runninghub-ai-app",
    inputSchema,
    nodeBindings,
    outputSchema,
    definitionHash: hashWorkflowText(JSON.stringify({ remoteWorkflowId, inputSchema, nodeBindings, outputSchema, request })),
    warnings: [],
    request,
    source: { kind: "runninghub-ai-app", ...(input.sourceUrl?.trim() ? { url: input.sourceUrl.trim() } : {}) },
  });
}

type LegacyRunningHubWorkflowIds = {
  readonly workflowId?: string;
  readonly digitalHumanWorkflowId?: string;
  readonly videoEnhanceWorkflowId?: string;
};

function legacyRegistration(id: string, remoteWorkflowId: string, name: string, capability: RunningHubWorkflowCapability, inputSchema: readonly RunningHubWorkflowInputField[], nodeBindings: readonly RunningHubNodeBinding[]): RunningHubWorkflowRegistration {
  return {
    id,
    remoteWorkflowId,
    name,
    capability,
    version: 1,
    definitionHash: hashWorkflowText(JSON.stringify({ id, remoteWorkflowId, inputSchema, nodeBindings })),
    source: { kind: "manual", importedAt: new Date().toISOString() },
    inputSchema,
    nodeBindings,
    outputSchema: [{ id: "output", type: "video" }],
    validation: { status: "unknown" },
  };
}

/** Converts the former fixed RunningHub configuration into editable local
 * registrations. Bindings reproduce the documented desktop workflow inputs
 * so existing users continue to run without re-importing a ComfyUI file. */
export function migrateLegacyRunningHubWorkflows(existing: readonly RunningHubWorkflowRegistration[] | undefined, legacy: LegacyRunningHubWorkflowIds): readonly RunningHubWorkflowRegistration[] | undefined {
  const workflows = [...(existing ?? [])];
  const has = (capability: RunningHubWorkflowCapability, remoteWorkflowId: string) => workflows.some((workflow) => workflow.capability === capability && workflow.remoteWorkflowId === remoteWorkflowId);
  const digitalHumanWorkflowId = text(legacy.digitalHumanWorkflowId);
  if (digitalHumanWorkflowId && !has("digital_human", digitalHumanWorkflowId)) {
    workflows.push(legacyRegistration(
      `legacy-digital-human-${normalizeId(digitalHumanWorkflowId)}`,
      digitalHumanWorkflowId,
      "数字人（已迁移）",
      "digital_human",
      [
        { id: "audios", label: "驱动音频", type: "audio" },
        { id: "images", label: "人物图片", type: "image" },
        { id: "script", label: "口播文案", type: "textarea" },
        { id: "scenePrompt", label: "场景提示", type: "textarea" },
        { id: "seed", label: "Seed", type: "integer", defaultValue: -1 },
      ],
      [
        { inputId: "audios", nodeId: "243", fieldName: "audio", valueType: "file" },
        { inputId: "script", nodeId: "244", fieldName: "string", valueType: "literal", transform: "string" },
        { inputId: "__legacyDigitalHumanAudioMode", nodeId: "288", fieldName: "index", valueType: "literal", transform: "number" },
        { inputId: "images", nodeId: "343", fieldName: "image", valueType: "file" },
        { inputId: "scenePrompt", nodeId: "349", fieldName: "value", valueType: "literal", transform: "string", defaultValue: "产品展示" },
        { inputId: "seed", nodeId: "128", fieldName: "seed", valueType: "literal", transform: "number", defaultValue: 0 },
      ],
    ));
  }
  const genericWorkflowId = text(legacy.workflowId);
  if (genericWorkflowId && !has("video", genericWorkflowId)) {
    workflows.push(legacyRegistration(`legacy-video-${normalizeId(genericWorkflowId)}`, genericWorkflowId, "视频生成（已迁移）", "video", [{ id: "prompt", label: "提示词", type: "textarea" }], [{ inputId: "prompt", nodeId: "prompt", fieldName: "text", valueType: "literal", transform: "string" }]));
  }
  const videoEnhanceWorkflowId = text(legacy.videoEnhanceWorkflowId);
  if (videoEnhanceWorkflowId && !has("video_enhance", videoEnhanceWorkflowId)) {
    workflows.push(legacyRegistration(
      `legacy-video-enhance-${normalizeId(videoEnhanceWorkflowId)}`,
      videoEnhanceWorkflowId,
      "视频高清化（已迁移）",
      "video_enhance",
      [
        { id: "sourceVideoUrl", label: "源视频", type: "video", required: true },
        { id: "prompt", label: "增强目标", type: "textarea", defaultValue: "将视频转换为超高清画质，在消除伪影的同时重建高频细节，显著提升画面清晰度" },
        { id: "durationLimit", label: "处理时长上限", type: "integer", defaultValue: 10 },
        { id: "seed", label: "Seed", type: "integer", defaultValue: -1 },
      ],
      [
        { inputId: "sourceVideoUrl", nodeId: "33", fieldName: "video", valueType: "file", required: true },
        { inputId: "prompt", nodeId: "35", fieldName: "text", valueType: "literal", transform: "string", defaultValue: "将视频转换为超高清画质，在消除伪影的同时重建高频细节，显著提升画面清晰度" },
        { inputId: "durationLimit", nodeId: "42", fieldName: "value", valueType: "literal", transform: "number", defaultValue: 10 },
        { inputId: "seed", nodeId: "10", fieldName: "seed", valueType: "literal", transform: "number", defaultValue: -1 },
      ],
    ));
  }
  return workflows.length ? workflows : undefined;
}

export function resolveRunningHubWorkflowInput(registration: RunningHubWorkflowRegistration, input: Record<string, unknown>) {
  return registration.nodeBindings.flatMap((binding) => {
    const value = input[binding.inputId] ?? binding.defaultValue;
    if (value === undefined || value === null || value === "") return [];
    const values = binding.valueType === "file_list" ? (Array.isArray(value) ? value : [value]) : binding.valueType === "file" && Array.isArray(value) ? value.slice(0, 1) : [value];
    return values.map((item) => ({ nodeId: binding.nodeId, fieldName: binding.fieldName, fieldValue: binding.transform === "number" ? Number(item) : binding.transform === "boolean" ? Boolean(item) : binding.transform === "json" ? JSON.stringify(item) : typeof item === "object" && item !== null ? (item as Record<string, unknown>).fileName ?? (item as Record<string, unknown>).url ?? item : item }));
  });
}
