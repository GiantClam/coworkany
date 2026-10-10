import type { WorkbenchRunDetail } from "@coworkany/workbench-client";
import type { WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";

export type DesktopImageGenerationParameterValue = string | number | boolean;
export type DesktopImageGenerationMetadata = {
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, DesktopImageGenerationParameterValue>>;
};
export type DesktopTaskMetadata = {
  readonly kind: "workflow" | "media" | "agent";
  readonly featureId?: string;
  readonly entryPath?: string;
  readonly imageGeneration?: DesktopImageGenerationMetadata;
  readonly workflowId?: string;
  readonly workflowTitle?: string;
  readonly definitionHash?: string;
  readonly workflowDefinition?: WorkflowDefinitionEnvelope;
};

function readWorkflowDefinition(value: unknown): WorkflowDefinitionEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { schemaVersion?: unknown; revision?: unknown; definitionHash?: unknown; metadata?: unknown; nodes?: unknown; edges?: unknown };
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return undefined;
  return value as WorkflowDefinitionEnvelope;
}

function readImageGeneration(value: unknown): DesktopImageGenerationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { prompt?: unknown; parameters?: unknown };
  if (candidate.parameters !== undefined && (typeof candidate.parameters !== "object" || Array.isArray(candidate.parameters))) return undefined;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  const parameters: Record<string, DesktopImageGenerationParameterValue> = {};
  for (const [key, parameter] of Object.entries((candidate.parameters ?? {}) as Record<string, unknown>)) {
    if (key !== "response_format" && key !== "responseFormat" && (typeof parameter === "string" || typeof parameter === "number" || typeof parameter === "boolean")) parameters[key] = parameter;
  }
  return prompt || Object.keys(parameters).length ? { prompt, parameters } : undefined;
}

function parsePayload(payloadJson: string): DesktopTaskMetadata | null {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (payload.kind !== "workflow" && payload.kind !== "media" && payload.kind !== "agent") return null;
  const workflowDefinition = readWorkflowDefinition(payload.workflowDefinition);
  const imageGeneration = readImageGeneration(payload.imageGeneration);
  return {
    kind: payload.kind,
    ...(typeof payload.featureId === "string" ? { featureId: payload.featureId } : {}),
    ...(typeof payload.entryPath === "string" ? { entryPath: payload.entryPath } : {}),
    ...(imageGeneration ? { imageGeneration } : {}),
    ...(typeof payload.workflowId === "string" ? { workflowId: payload.workflowId } : {}),
    ...(typeof payload.workflowTitle === "string" ? { workflowTitle: payload.workflowTitle } : {}),
    ...(typeof payload.definitionHash === "string" ? { definitionHash: payload.definitionHash } : {}),
    ...(workflowDefinition ? { workflowDefinition } : {}),
  };
}

export function readDesktopTaskMetadata(detail: WorkbenchRunDetail): DesktopTaskMetadata | null {
  return detail.events
    .filter((event) => event.eventType === "task_metadata")
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => parsePayload(event.payloadJson))
    .filter((metadata): metadata is DesktopTaskMetadata => metadata !== null)
    .at(-1) ?? null;
}
