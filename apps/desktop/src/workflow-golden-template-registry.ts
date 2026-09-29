import { canonicalizeWorkflowDefinition, deriveWorkflowCapabilities, hashWorkflowDefinition, validateGoldenWorkflowTemplateDescriptor, validateWorkflowDefinition, workflowNodeRegistry, type GoldenWorkflowTemplateDescriptor, type WorkflowComposableGraphDescriptor, type WorkflowGoldenSubgraphDescriptor, type WorkflowGraphBinding, composeWorkflowComposableGraphs, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { isMediaProviderConfigured, providerForCapability, supportsProviderCapability, type DesktopProviderConfig } from "./provider-config";

export type WorkflowGoldenTemplateDisplayMetadata = {
  readonly title: { readonly zh: string; readonly en: string };
  readonly description: { readonly zh: string; readonly en: string };
};

type RegisteredDesktopGoldenTemplateDescriptor = GoldenWorkflowTemplateDescriptor & WorkflowGoldenTemplateDisplayMetadata;

/** Stable semantic contract shared by template creation and AI authoring. */
export const WORKFLOW_GOLDEN_TEMPLATE_REGISTRY = [
  { templateKey: "content-pipeline", templateVersion: 1, capabilities: ["text-input", "text-generation", "article-generation", "result-composition", "artifact-persistence"], nodeTypes: ["text_input", "writer", "product_store"], requiredProviderCapabilities: ["text"], title: { zh: "内容营销流水线", en: "Content marketing pipeline" }, description: { zh: "从任务输入开始，生成可编辑营销文案并写入本地产物。", en: "Turn a task into editable marketing copy and a local artifact." } },
  { templateKey: "presentation", templateVersion: 1, capabilities: ["text-input", "presentation-generation", "artifact-persistence"], nodeTypes: ["text_input", "ppt_generate", "product_store"], requiredProviderCapabilities: ["text"], title: { zh: "演示文稿生成", en: "Presentation generation" }, description: { zh: "使用本地 ppt-master Skill 构建演示文稿工作流。", en: "Build a presentation workflow with the local ppt-master Skill." } },
  { templateKey: "image-campaign", templateVersion: 2, capabilities: ["text-input", "text-generation", "article-generation", "image-generation", "result-composition", "artifact-persistence"], nodeTypes: ["text_input", "writer", "image_generate", "product_store"], requiredProviderCapabilities: ["text", "image"], title: { zh: "营销图片批量生成", en: "Campaign image generation" }, description: { zh: "以 Canvas 编排文案与图片生成节点；未配置图片 Provider 时保持可见。", en: "Compose copy and image generation on Canvas; remains visible until an image provider is configured." } },
  { templateKey: "video-ffmpeg-transform", templateVersion: 1, capabilities: ["file-input", "media-transform", "result-composition"], nodeTypes: ["upload", "video_process", "output"], requiredProviderCapabilities: [], title: { zh: "FFmpeg 视频变换", en: "FFmpeg video transform" }, description: { zh: "上传本地视频，使用 FFmpeg 调整为 16:9、1280×720、30 FPS。", en: "Upload a local video and transform it to 16:9, 1280×720 at 30 FPS with FFmpeg." } },
  { templateKey: "audio-ffmpeg-trim", templateVersion: 1, capabilities: ["file-input", "media-transform", "result-composition"], nodeTypes: ["upload", "audio_process", "output"], requiredProviderCapabilities: [], title: { zh: "FFmpeg 音频裁剪", en: "FFmpeg audio trim" }, description: { zh: "上传本地音频，使用 FFmpeg 裁剪前两秒并输出纯音频。", en: "Upload a local audio file and trim the first two seconds to a pure audio output." } },
  { templateKey: "product-promotion-video", templateVersion: 2, capabilities: ["text-input", "image-generation", "video-generation", "controlled-iteration", "media-transform", "result-composition"], nodeTypes: ["text_input", "image_generate", "text_split", "foreach", "video_generate", "collect", "video_process", "video_compose", "output"], requiredProviderCapabilities: ["image", "video"], title: { zh: "产品宣传视频流水线", en: "Product promotion video pipeline" }, description: { zh: "生成统一人物参考图，由一个文本分割节点拆出多个场景，再用一个视频节点逐段生成内置口播、动作、字幕与声音的 UGC 视频，拼接后生成封面并写入成片。", en: "Generate one creator reference image, split a reusable script into scene segments, run one video node per segment with built-in voice, performance, captions, and sound, then stitch the scenes and embed a generated cover." } },
  { templateKey: "character-swap-video", templateVersion: 1, capabilities: ["text-input", "file-input", "image-generation", "text-generation", "media-transform", "result-composition", "artifact-persistence"], nodeTypes: ["text_input", "upload", "image_generate", "agent_execute", "file_create", "video_compose", "output", "product_store"], requiredProviderCapabilities: ["image", "audio"], title: { zh: "人物替换字幕视频", en: "Character replacement video" }, description: { zh: "参考图与人物图替换，音频 ASR 生成字幕，再通过本地 FFmpeg 合成。", en: "Replace a character in a reference image, transcribe the audio, then compose the result with local FFmpeg." } },
] as const satisfies readonly RegisteredDesktopGoldenTemplateDescriptor[];

/** Subgraphs are allowlisted here; a caller cannot authorize an arbitrary
 * complete template by supplying a provenance string. */
export const WORKFLOW_GOLDEN_SUBGRAPH_KEYS = ["article-image-publish"] as const;

const articleImagePublishDefinitionBase: WorkflowDefinitionEnvelope = {
  schemaVersion: 2,
  revision: 1,
  definitionHash: "",
  nodes: [
    { nodeKey: "article", type: "writer", nodeVersion: 1, title: "Article", positionX: 0, positionY: 0, config: {} },
    { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 408, positionY: 0, config: {} },
    { nodeKey: "product-store", type: "product_store", nodeVersion: 1, title: "Article artifact", positionX: 816, positionY: 0, config: {} },
  ],
  edges: [
    { edgeKey: "article-image", sourceNodeKey: "article", sourcePortId: "text", targetNodeKey: "image", targetPortId: "text" },
    { edgeKey: "image-product-store", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "product-store", targetPortId: "images" },
  ],
};
const articleImagePublishDefinition = { ...articleImagePublishDefinitionBase, definitionHash: hashWorkflowDefinition(articleImagePublishDefinitionBase) };

/**
 * Registry-owned subgraph descriptor. The descriptor is intentionally a small
 * boundary-based fragment, not a complete directory template. A caller must
 * provide the same version, provenance and graph hash before the wrapper adds
 * the core `registered` authority marker.
 */
export const WORKFLOW_GOLDEN_SUBGRAPH_REGISTRY = [
  {
    graphKind: "subgraph",
    graphKey: "article-image-publish",
    subgraphKey: "article-image-publish",
    subgraphVersion: 1,
    capabilities: ["article-generation", "image-generation"],
    validatedProvenance: "workflow-golden-subgraph:article-image-publish:v1",
    definition: articleImagePublishDefinition,
    inputs: [{ boundaryKey: "article-text", nodeKey: "article", portId: "text", dataType: "text", disposition: "bindable", maxBindings: 1 }],
    outputs: [{ boundaryKey: "illustrated-article-artifact", nodeKey: "image", portId: "image", dataType: "image", disposition: "external", maxBindings: "many" }],
  },
] as const satisfies readonly WorkflowGoldenSubgraphDescriptor[];

export type WorkflowGoldenTemplateReadinessContext = {
  readonly textModelConfigured?: boolean;
  readonly imageProviderConfigured?: boolean;
  readonly videoProviderConfigured?: boolean;
  readonly characterSwapImageProviderConfigured?: boolean;
  readonly audioProviderConfigured?: boolean;
  readonly audioTranscriptionWorkflowCount?: number;
  readonly config?: { readonly provider: DesktopProviderConfig; readonly providers?: Readonly<Record<string, DesktopProviderConfig>>; readonly defaults?: Partial<Record<"text" | "image" | "video" | "audio", string>> };
  readonly audioTranscriptionProvider?: DesktopProviderConfig;
};
export type WorkflowGoldenTemplateStatus = "ready" | "needs-config";

/** Preserves the directory's established per-template readiness predicates. */
export function getWorkflowGoldenTemplateStatus(templateKey: string, context: WorkflowGoldenTemplateReadinessContext): WorkflowGoldenTemplateStatus {
  const resolved = context.config ? (() => {
    const text = providerForCapability(context.config!, "text");
    const image = providerForCapability(context.config!, "image");
    const video = providerForCapability(context.config!, "video");
    const audio = context.audioTranscriptionProvider ?? providerForCapability(context.config!, "audio");
    const transcriptionWorkflows = audio.workflows?.filter((workflow) => workflow.capability === "audio_transcription") ?? [];
    const transcriptionCount = transcriptionWorkflows.length;
    const transcriptionReady = transcriptionCount === 1 && Boolean(transcriptionWorkflows[0]?.remoteWorkflowId?.trim());
    const imageConfigured = isMediaProviderConfigured(image) && supportsProviderCapability(image, "image");
    const videoConfigured = isMediaProviderConfigured(video) && supportsProviderCapability(video, "video");
    const audioConfigured = isMediaProviderConfigured(audio) && supportsProviderCapability(audio, "audio");
    const runningHubImage = image.source?.trim().toLowerCase() === "runninghub";
    const characterImageConfigured = !runningHubImage || image.workflows?.some((workflow) => workflow.capability === "image"
      && workflow.nodeBindings.some((binding) => binding.inputId === "referenceImage" && binding.valueType === "file")
      && workflow.nodeBindings.some((binding) => binding.inputId === "characterImage" && binding.valueType === "file")) === true;
    return { textModelConfigured: Boolean(text.model?.trim()) && supportsProviderCapability(text, "text"), imageProviderConfigured: imageConfigured, videoProviderConfigured: videoConfigured, characterSwapImageProviderConfigured: characterImageConfigured, audioProviderConfigured: audioConfigured && transcriptionReady, audioTranscriptionWorkflowCount: transcriptionCount };
  })() : context;
  const ready = (() => {
    switch (templateKey) {
      case "content-pipeline":
      case "presentation": return resolved.textModelConfigured;
      case "image-campaign": return resolved.imageProviderConfigured;
      case "video-ffmpeg-transform":
      case "audio-ffmpeg-trim": return true;
      case "product-promotion-video": return resolved.imageProviderConfigured && resolved.videoProviderConfigured;
      case "character-swap-video": return resolved.imageProviderConfigured && (resolved.characterSwapImageProviderConfigured ?? false) && (resolved.audioProviderConfigured ?? false) && resolved.audioTranscriptionWorkflowCount === 1;
      default: throw new Error(`workflow_golden_template_not_found:${templateKey}`);
    }
  })();
  return ready ? "ready" : "needs-config";
}

export function getWorkflowGoldenTemplateReadiness(context: WorkflowGoldenTemplateReadinessContext): Readonly<Record<string, WorkflowGoldenTemplateStatus>> {
  return Object.fromEntries(WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.map((template) => [template.templateKey, getWorkflowGoldenTemplateStatus(template.templateKey, context)]));
}

export type WorkflowGoldenTemplateBuildResult = {
  readonly definition: WorkflowDefinitionEnvelope;
  readonly title?: string;
};

export type WorkflowProviderBinding = Pick<DesktopProviderConfig, "id" | "source" | "baseUrl" | "model" | "capabilities" | "workflows">;
export type WorkflowGoldenTemplateBuildContext = {
  readonly locale: "zh" | "en";
  readonly providers: {
    readonly text: WorkflowProviderBinding;
    readonly image: WorkflowProviderBinding;
    readonly video: WorkflowProviderBinding;
    readonly audio: WorkflowProviderBinding;
    readonly audioTranscriptionWorkflowCount: number;
  };
};
export type WorkflowGoldenTemplateBuilder = (context: WorkflowGoldenTemplateBuildContext) => WorkflowGoldenTemplateBuildResult;

export type WorkflowGoldenTemplateCatalogEntry = {
  readonly id: string;
  readonly version: number;
  readonly capabilities: readonly string[];
  readonly nodeTypes: readonly string[];
  readonly requiredProviderCapabilities: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly status: WorkflowGoldenTemplateStatus;
  readonly validationResult: { readonly valid: true; readonly issues: readonly [] };
  readonly build: () => { readonly definition: WorkflowDefinitionEnvelope; readonly title: string };
};

export type WorkflowGoldenTemplateRegistryEntry = WorkflowGoldenTemplateCatalogEntry & {
  readonly key: string;
  readonly metadata: WorkflowGoldenTemplateDisplayMetadata;
  readonly requirements: { readonly providerCapabilities: readonly string[] };
  readonly availability: WorkflowGoldenTemplateStatus;
  readonly instantiate: () => WorkflowDefinitionEnvelope;
};

const registeredEntries = new WeakSet<WorkflowGoldenTemplateRegistryEntry>();
const registeredPrimaryGraphs = new WeakSet<WorkflowComposableGraphDescriptor>();

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return value;
}

function credentialOrPathIssue(value: unknown): string[] {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const issues: string[] = [];
  if (/["']?(?:api[_-]?key|secret|token|password)["']?\s*:/i.test(serialized)) issues.push("credential_in_template");
  if (/(?:^|["'\s:=])\/(?:Users|home|private|var|tmp|opt|etc)\/(?:[^\s"']*)/i.test(serialized) || /(?:^|["'\s:=])[A-Za-z]:[\\/][^\s"']*/i.test(serialized) || /(?:^|["'\s:=])\\\\[^\s"']+/i.test(serialized)) issues.push("absolute_path_in_template");
  return issues;
}

function readinessFromBindings(context: WorkflowGoldenTemplateBuildContext): Readonly<Record<string, WorkflowGoldenTemplateStatus>> {
  const { text, image, video, audio, audioTranscriptionWorkflowCount } = context.providers;
  const mediaReady = (provider: WorkflowProviderBinding, capability: "image" | "video" | "audio") => isMediaProviderConfigured(provider) && supportsProviderCapability(provider, capability);
  const imageReady = mediaReady(image, "image");
  const videoReady = mediaReady(video, "video");
  const audioReady = mediaReady(audio, "audio");
  const transcriptionWorkflows = audio.workflows?.filter((workflow) => workflow.capability === "audio_transcription") ?? [];
  const transcriptionReady = audioTranscriptionWorkflowCount === 1 && Boolean(transcriptionWorkflows[0]?.remoteWorkflowId?.trim());
  const runningHubImage = image.source?.trim().toLowerCase() === "runninghub";
  const characterImageReady = !runningHubImage || image.workflows?.some((workflow) => workflow.capability === "image"
    && workflow.nodeBindings.some((binding) => binding.inputId === "referenceImage" && binding.valueType === "file")
    && workflow.nodeBindings.some((binding) => binding.inputId === "characterImage" && binding.valueType === "file")) === true;
  const textReady = Boolean(text.model?.trim()) && supportsProviderCapability(text, "text");
  return {
    "content-pipeline": textReady ? "ready" : "needs-config",
    presentation: textReady ? "ready" : "needs-config",
    "image-campaign": imageReady ? "ready" : "needs-config",
    "video-ffmpeg-transform": "ready",
    "audio-ffmpeg-trim": "ready",
    "product-promotion-video": imageReady && videoReady ? "ready" : "needs-config",
    "character-swap-video": imageReady && characterImageReady && audioReady && transcriptionReady ? "ready" : "needs-config",
  };
}

/** Builds the one immutable registry shared by directory and AI surfaces. */
export function createWorkflowGoldenTemplateRegistry(input: {
  readonly context: WorkflowGoldenTemplateBuildContext;
  readonly builders: Readonly<Record<string, WorkflowGoldenTemplateBuilder>>;
  readonly validate?: (definition: WorkflowDefinitionEnvelope, descriptor: RegisteredDesktopGoldenTemplateDescriptor) => readonly string[];
  readonly onInvalid?: (templateKey: string, issues: readonly string[]) => void;
}): readonly WorkflowGoldenTemplateRegistryEntry[] {
  const readiness = readinessFromBindings(input.context);
  const validate = (definition: WorkflowDefinitionEnvelope, descriptor: RegisteredDesktopGoldenTemplateDescriptor) => {
    const issues: string[] = validateWorkflowDefinition(definition).map((issue) => issue.code);
    if (!sameJson([...new Set(definition.nodes.map((node) => node.type))].sort(), [...descriptor.nodeTypes].sort())) issues.push("node_types_mismatch");
    const actual = new Set(deriveWorkflowCapabilities(definition));
    for (const capability of descriptor.capabilities) if (!actual.has(capability)) issues.push(`capability_claim_mismatch:${capability}`);
    issues.push(...credentialOrPathIssue(definition));
    issues.push(...(input.validate?.(definition, descriptor) ?? []));
    return issues;
  };
  const reportInvalid = input.onInvalid ?? ((key: string, issues: readonly string[]) => console.warn(`workflow_golden_template_invalid:${key}`, issues));
  return WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.flatMap((descriptor) => {
    const builder = input.builders[descriptor.templateKey];
    if (!builder) throw new Error(`workflow_golden_template_builder_missing:${descriptor.templateKey}`);
    let built: WorkflowGoldenTemplateBuildResult;
    let issues: readonly string[];
    try {
      built = builder(input.context);
      issues = [...new Set(validate(built.definition, descriptor))];
    } catch (error) {
      reportInvalid(descriptor.templateKey, [`builder_failed:${error instanceof Error ? error.message : String(error)}`]);
      return [];
    }
    if (issues.length) {
      reportInvalid(descriptor.templateKey, issues);
      return [];
    }
    const nodes = built.definition.nodes.map((node) => {
      const capability = node.type === "image_generate" ? "image" : node.type === "video_generate" ? "video"
        : node.type === "audio_generate" || (node.type === "agent_execute" && node.config.operation === "audio_transcription") ? "audio"
        : ["writer", "llm_generate", "ppt_generate", "agent_execute"].includes(node.type) ? "text" : null;
      if (!capability) return node;
      const provider = input.context.providers[capability];
      const configured = supportsProviderCapability(provider, capability) && (capability === "text" ? Boolean(provider.model?.trim()) : isMediaProviderConfigured(provider));
      if (configured) return node;
      const config = { ...node.config, needsConfig: true } as Record<string, unknown>;
      for (const key of ["provider", "model", "selectedProviderId", "selectedModelId", "baseUrl", "endpoint"]) delete config[key];
      return { ...node, config };
    });
    const withProvenance = { ...built.definition, nodes, metadata: { ...built.definition.metadata, templateKey: descriptor.templateKey, templateVersion: descriptor.templateVersion }, definitionHash: "" };
    const snapshot = freezeDeep(cloneJson(canonicalizeWorkflowDefinition({ ...withProvenance, definitionHash: hashWorkflowDefinition(withProvenance) })));
    const instantiate = () => cloneJson(snapshot);
    const entry: WorkflowGoldenTemplateRegistryEntry = {
      key: descriptor.templateKey,
      id: descriptor.templateKey,
      version: descriptor.templateVersion,
      capabilities: descriptor.capabilities,
      nodeTypes: descriptor.nodeTypes,
      requiredProviderCapabilities: descriptor.requiredProviderCapabilities,
      requirements: { providerCapabilities: descriptor.requiredProviderCapabilities },
      metadata: descriptor,
      title: descriptor.title[input.context.locale],
      description: descriptor.description[input.context.locale],
      status: readiness[descriptor.templateKey] ?? "needs-config",
      availability: readiness[descriptor.templateKey] ?? "needs-config",
      validationResult: { valid: true, issues: [] },
      instantiate,
      build: () => ({ definition: instantiate(), title: descriptor.title[input.context.locale] }),
    };
    registeredEntries.add(entry);
    return [freezeDeep(entry)];
  });
}

export type WorkflowGoldenTemplateReleaseIssue = { readonly templateKey?: string; readonly code: string; readonly message: string };
type ReleasableTemplate = GoldenWorkflowTemplateDescriptor & { readonly build?: () => WorkflowDefinitionEnvelope; readonly instantiate?: () => WorkflowDefinitionEnvelope };

export function validateWorkflowGoldenTemplateRegistry(templates: readonly ReleasableTemplate[]): readonly WorkflowGoldenTemplateReleaseIssue[] {
  const issues: WorkflowGoldenTemplateReleaseIssue[] = [];
  const keys = new Set<string>();
  for (const template of templates) {
    if (keys.has(template.templateKey)) issues.push({ templateKey: template.templateKey, code: "duplicate_template_key", message: "Template keys must be unique" });
    keys.add(template.templateKey);
    for (const code of validateGoldenWorkflowTemplateDescriptor(template)) issues.push({ templateKey: template.templateKey, code, message: code });
    const serialized = JSON.stringify(template);
    for (const code of credentialOrPathIssue(serialized)) issues.push({ templateKey: template.templateKey, code, message: code === "credential_in_template" ? "Template metadata must not contain credentials" : "Template metadata must not contain host paths" });
    const instantiate = template.instantiate ?? template.build;
    if (!instantiate) issues.push({ templateKey: template.templateKey, code: "template_builder_missing", message: "Release validation requires an instantiated graph for every template" });
    if (instantiate) {
      try {
        const first = instantiate(); const second = instantiate();
        const firstIssues = validateWorkflowDefinition(first);
        if (!sameJson([...new Set(first.nodes.map((node) => node.type))].sort(), [...template.nodeTypes].sort())) issues.push({ templateKey: template.templateKey, code: "node_types_mismatch", message: "Declared node types differ from the instantiated graph" });
        if (firstIssues.length) issues.push({ templateKey: template.templateKey, code: "invalid_instantiated_graph", message: firstIssues.map((issue) => issue.message).join("; ") });
        const actual = new Set(deriveWorkflowCapabilities(first));
        for (const capability of template.capabilities) if (!actual.has(capability)) issues.push({ templateKey: template.templateKey, code: "capability_claim_mismatch", message: `Declared capability is not present in instantiated graph: ${capability}` });
        const normalized = (definition: WorkflowDefinitionEnvelope) => JSON.stringify({ ...canonicalizeWorkflowDefinition(definition), definitionHash: hashWorkflowDefinition({ ...definition, definitionHash: "" }) });
        if (normalized(first) !== normalized(second)) issues.push({ templateKey: template.templateKey, code: "nondeterministic_instantiation", message: "Template builder must be deterministic" });
        if (credentialOrPathIssue(first).length) issues.push({ templateKey: template.templateKey, code: "credential_or_path_in_graph", message: "Instantiated graph contains credentials or host paths" });
      } catch (error) { issues.push({ templateKey: template.templateKey, code: "template_builder_failed", message: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return issues;
}

export const validateGoldenWorkflowTemplateRegistry = validateWorkflowGoldenTemplateRegistry;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDeclaredBoundaries(graph: WorkflowComposableGraphDescriptor): boolean {
  const seen = new Set<string>();
  for (const [direction, boundary] of [...graph.inputs.map((boundary) => ["inputs", boundary] as const), ...graph.outputs.map((boundary) => ["outputs", boundary] as const)]) {
    if (seen.has(boundary.boundaryKey)) return false;
    seen.add(boundary.boundaryKey);
    const node = graph.definition.nodes.find((candidate) => candidate.nodeKey === boundary.nodeKey);
    const definition = node ? workflowNodeRegistry.get(node.type) : undefined;
    const port = definition?.[direction].find((candidate) => candidate.id === boundary.portId);
    if (!node || !port || port.valueKind !== boundary.dataType) return false;
  }
  return true;
}

function validateRegisteredPrimary(graph: WorkflowComposableGraphDescriptor): boolean {
  if (!registeredPrimaryGraphs.has(graph)) return false;
  if (graph.graphKind !== "primary" || !WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.some((template) => template.templateKey === graph.graphKey)) return false;
  if (!validateDeclaredBoundaries(graph) || validateWorkflowDefinition(graph.definition).length) return false;
  const descriptor = WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.find((template) => template.templateKey === graph.graphKey)!;
  const nodeTypes = [...new Set(graph.definition.nodes.map((node) => node.type))];
  if (!sameJson(nodeTypes.sort(), [...descriptor.nodeTypes].sort())) return false;
  const actual = new Set(deriveWorkflowCapabilities(graph.definition));
  return descriptor.capabilities.every((capability) => actual.has(capability));
}

/** Primary authority comes from a validated factory entry, never a caller label. */
export function createWorkflowGoldenTemplatePrimary(entry: WorkflowGoldenTemplateRegistryEntry, boundaries: Pick<WorkflowComposableGraphDescriptor, "inputs" | "outputs">): WorkflowComposableGraphDescriptor {
  if (!registeredEntries.has(entry)) throw new Error("workflow_golden_primary_not_registered");
  const graph: WorkflowComposableGraphDescriptor = freezeDeep({ graphKind: "primary", graphKey: entry.key, definition: entry.instantiate(), inputs: cloneJson(boundaries.inputs), outputs: cloneJson(boundaries.outputs) });
  if (!validateDeclaredBoundaries(graph)) throw new Error("workflow_golden_primary_invalid_boundary");
  registeredPrimaryGraphs.add(graph);
  return graph;
}

export function composeWorkflowGoldenTemplate(input: { readonly primary: WorkflowComposableGraphDescriptor; readonly subgraphs: readonly WorkflowComposableGraphDescriptor[]; readonly bindings: readonly WorkflowGraphBinding[] }) {
  if (!validateRegisteredPrimary(input.primary)) return { ok: false as const, issues: [{ code: "invalid_composed_graph" as const, message: "Primary graph is not a validated registered golden template" }] };
  const registered = input.subgraphs.map((graph) => {
    const candidate = graph as Partial<WorkflowGoldenSubgraphDescriptor>;
    const registration = WORKFLOW_GOLDEN_SUBGRAPH_REGISTRY.find((entry) => entry.subgraphKey === candidate.subgraphKey
      && candidate.graphKey === entry.graphKey
      && entry.subgraphVersion === candidate.subgraphVersion
      && entry.validatedProvenance === candidate.validatedProvenance
      && hashWorkflowDefinition(candidate.definition as WorkflowDefinitionEnvelope) === hashWorkflowDefinition(entry.definition)
      && sameJson(candidate.capabilities, entry.capabilities)
      && sameJson(candidate.inputs, entry.inputs)
      && sameJson(candidate.outputs, entry.outputs));
    return registration ? { ...registration, registered: true as const } : graph;
  });
  return composeWorkflowComposableGraphs({ ...input, subgraphs: registered, registeredSubgraphKeys: [...WORKFLOW_GOLDEN_SUBGRAPH_KEYS] });
}

export function getWorkflowGoldenTemplateDescriptor(templateKey: string) {
  const descriptor = WORKFLOW_GOLDEN_TEMPLATE_REGISTRY.find((template) => template.templateKey === templateKey);
  if (!descriptor) throw new Error(`workflow_golden_template_not_found:${templateKey}`);
  return {
    id: descriptor.templateKey,
    version: descriptor.templateVersion,
    capabilities: descriptor.capabilities,
    nodeTypes: descriptor.nodeTypes,
    requiredProviderCapabilities: descriptor.requiredProviderCapabilities,
  };
}
