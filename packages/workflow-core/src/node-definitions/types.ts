export const WORKFLOW_NODE_TYPES = [
  "upload", "text_input", "file_create", "writer", "llm_generate", "agent_execute",
  "image_generate", "video_generate", "video_compose", "digital_human", "music_generate", "voice_synthesis", "voice_clone",
  "audio_generate", "ppt_generate", "knowledge_retrieve", "knowledge_write", "product_store",
  "video_process", "audio_process",
  "foreach", "collect", "output",
] as const;

export const WORKFLOW_VALUE_KINDS = ["text", "asset", "image", "video", "audio", "ppt"] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];
export type WorkflowValueKind = (typeof WORKFLOW_VALUE_KINDS)[number];
export type WorkflowLocale = "zh" | "en";
export type WorkflowPortValueKind = WorkflowValueKind;
export type WorkflowPortRole = "image.reference" | "image.first_frame" | "image.last_frame" | "image.mask" | "image.cover" | "video.source" | "video.reference" | "audio.reference" | "text.prompt";

export type WorkflowPortDefinition = {
  id: string;
  valueKind: WorkflowPortValueKind;
  role?: WorkflowPortRole;
  required: boolean;
  cardinality: "one" | "many";
  minItems?: number;
  maxItems?: number;
  acceptedMimeTypes?: string[];
};

export type WorkflowFieldDefinition = {
  id: string;
  label: Record<WorkflowLocale, string>;
  rendererId: "text" | "textarea" | "number" | "select" | "toggle" | "asset" | "model" | "agent" | "dataset" | "custom";
  valueType: "string" | "number" | "boolean" | "string[]" | "object";
  required: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  visibleWhen?: { fieldId: string; equals: unknown };
  extensionId?: string;
};

export type WorkflowNodeCategory = "input" | "control" | "ai" | "media" | "integration" | "output";
export type WorkflowNodeSideEffect = "none" | "external" | "persistent";

export type WorkflowNodeDefinitionV2 = {
  type: WorkflowNodeType;
  version: number;
  category: WorkflowNodeCategory;
  title: Record<WorkflowLocale, string>;
  icon: string;
  colorToken: string;
  inputs: WorkflowPortDefinition[];
  outputs: WorkflowPortDefinition[];
  configSchema: WorkflowFieldDefinition[];
  defaultConfig: Record<string, unknown>;
  executorId: string;
  sideEffect: WorkflowNodeSideEffect;
  legacyTitles?: string[];
  migrate: (config: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
};

export type WorkflowRegistryError = {
  code: "workflow_registry_duplicate_type" | "workflow_registry_invalid_version" | "workflow_registry_executor_missing" | "workflow_registry_invalid_port" | "workflow_registry_invalid_default_config";
  nodeType: string;
  field?: string;
};

export type WorkflowNodeRegistry = {
  get(type: string): WorkflowNodeDefinitionV2 | null;
  require(type: string): WorkflowNodeDefinitionV2;
  list(): readonly WorkflowNodeDefinitionV2[];
  validate(): readonly WorkflowRegistryError[];
};
