import type { WorkbenchPreviewData, WorkbenchRunEvent } from "./index";
import type { DesktopDataParts, DesktopMessageMetadata, DesktopRunStatus, DesktopUIMessage, DesktopUIMessagePart } from "./uimessage";

const PART_ID_KEY = "partId";
const SEQUENCE_KEY = "sequence";
const CREATED_AT_KEY = "createdAt";

export type SequencedRunEvent = WorkbenchRunEvent & {
  readonly sequence: number;
  readonly createdAt: string;
};

export type AssistantTurnSeed =
  | {
      readonly kind: "new";
      readonly id: string;
      readonly conversationId: string;
      readonly runId: string;
      readonly createdAt: string;
      readonly providerId?: string;
      readonly modelId?: string;
    }
  | {
      readonly kind: "stored";
      readonly message: DesktopUIMessage;
    };

function providerMetadata(partId: string, sequence: number, createdAt?: string) {
  return { coworkany: { [PART_ID_KEY]: partId, [SEQUENCE_KEY]: sequence, ...(createdAt ? { [CREATED_AT_KEY]: createdAt } : {}) } };
}

function dataPart<K extends keyof DesktopDataParts>(name: K, id: string, data: DesktopDataParts[K]): Extract<DesktopUIMessagePart, { type: `data-${K}` }> {
  return { type: `data-${name}`, id, data } as Extract<DesktopUIMessagePart, { type: `data-${K}` }>;
}

function statusFromWorkbench(status: string): DesktopRunStatus {
  if (status === "succeeded" || status === "completed") return "completed";
  if (status === "interrupted" || status === "cancelled") return "cancelled";
  if (status === "blocked" || status === "waiting") return "waiting";
  if (status === "failed") return "failed";
  if (status === "queued") return "queued";
  return "running";
}

function previewPartId(preview: WorkbenchPreviewData) {
  return `preview:${preview.previewSessionId ?? preview.artifactId ?? preview.relativePath ?? preview.title}`;
}

function eventEntityPart(event: WorkbenchRunEvent): DesktopUIMessagePart | undefined {
  switch (event.type) {
    case "plan":
      return dataPart("task", event.plan.id, { title: event.plan.title ?? "Execution plan", status: statusFromWorkbench(event.plan.status), steps: event.plan.steps.map((step) => ({ id: step.id, title: step.title, status: statusFromWorkbench(step.status), detail: step.detail })) });
    case "task":
      return dataPart("task", event.task.id, { taskId: event.task.taskId, title: event.task.title, status: statusFromWorkbench(event.task.status), steps: event.task.steps?.map((step) => ({ id: step.id, title: step.title, status: statusFromWorkbench(step.status), detail: step.detail, toolName: step.toolName })) });
    case "tool_call": {
      const state = event.phase === "started" ? "input-available" : event.phase === "blocked" ? "approval-requested" : event.phase === "completed" ? "output-available" : "output-error";
      if (state === "input-available") return { type: "dynamic-tool", toolName: event.toolName, toolCallId: event.toolCallId, state, input: event.input };
      if (state === "approval-requested") return { type: "dynamic-tool", toolName: event.toolName, toolCallId: event.toolCallId, state, input: event.input, approval: { id: event.approvalId ? `approval:${event.approvalId}` : `approval:${event.toolCallId}` } };
      if (state === "output-available") return { type: "dynamic-tool", toolName: event.toolName, toolCallId: event.toolCallId, state, input: event.input, output: event.output };
      return { type: "dynamic-tool", toolName: event.toolName, toolCallId: event.toolCallId, state, input: event.input, errorText: event.error ?? "Tool execution failed" };
    }
    case "attachment":
      return dataPart("attachment", event.attachment.id, { attachmentId: event.attachment.id, name: event.attachment.name, mediaType: event.attachment.mediaType, uri: event.attachment.uri, status: event.attachment.status ?? "ready" });
    case "warning":
      return dataPart("warning", `warning:${event.sequence ?? event.code}`, { code: event.code, message: event.message });
    case "tool":
      return dataPart("status", `tool:${event.tool}`, { status: statusFromWorkbench(event.phase), message: event.message });
    case "usage":
      return dataPart("usage", `usage:${event.usage.usageId ?? event.sequence ?? event.usage.runId}`, event.usage);
    case "artifact":
      return dataPart("artifact", `artifact:${event.artifact.id}`, event.artifact);
    case "status":
      return dataPart("status", "status:run", { status: statusFromWorkbench(event.status) });
    case "source":
      return event.source.href
        ? { type: "source-url", sourceId: event.source.id, url: event.source.href, title: event.source.title }
        : { type: "source-document", sourceId: event.source.id, mediaType: "text/plain", title: event.source.title };
    case "media":
      return dataPart("media", `media:${event.media.artifactId}`, event.media);
    case "preview":
      return dataPart("preview", previewPartId(event.preview), event.preview);
    default:
      return undefined;
  }
}

function entityIdentity(part: DesktopUIMessagePart) {
  if (part.type === "dynamic-tool") return `tool:${part.toolCallId}`;
  if (part.type === "source-url" || part.type === "source-document") return `source:${part.sourceId}`;
  if (part.type.startsWith("data-") && "id" in part && part.id) return `${part.type}:${part.id}`;
  return undefined;
}

function isTerminalTool(part: DesktopUIMessagePart) {
  return part.type === "dynamic-tool" && (part.state === "output-available" || part.state === "output-error" || part.state === "output-denied");
}

function finalizeOpenSegments(parts: readonly DesktopUIMessagePart[]) {
  let changed = false;
  const next = parts.map((part) => {
    if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") {
      changed = true;
      return { ...part, state: "done" as const };
    }
    return part;
  });
  return changed ? next : [...parts];
}

function mergeEntity(parts: readonly DesktopUIMessagePart[], incoming: DesktopUIMessagePart) {
  const identity = entityIdentity(incoming);
  const index = identity ? parts.findIndex((part) => entityIdentity(part) === identity) : -1;
  if (index < 0) return [...parts, incoming];
  const current = parts[index]!;
  if (isTerminalTool(current) && incoming.type === "dynamic-tool" && !isTerminalTool(incoming)) return [...parts];
  return parts.map((part, partIndex) => partIndex === index ? { ...part, ...incoming } as DesktopUIMessagePart : part);
}

export function mergeStreamingText(previous: string, incoming: string) {
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  const compactPrevious = previous.replace(/\s+/gu, "");
  const compactIncoming = incoming.replace(/\s+/gu, "");
  const isFullSnapshot = previous.length >= 16
    && incoming.length > previous.length
    && compactIncoming.startsWith(compactPrevious);
  return isFullSnapshot ? incoming : `${previous}${incoming}`;
}

export function beginAssistantTurn(seed: AssistantTurnSeed): DesktopUIMessage {
  if (seed.kind === "stored") {
    if (seed.message.role !== "assistant") throw new Error("assistant_turn_requires_assistant_role");
    return seed.message;
  }
  const metadata: DesktopMessageMetadata = {
    conversationId: seed.conversationId,
    runId: seed.runId,
    ...(seed.providerId ? { providerId: seed.providerId } : {}),
    ...(seed.modelId ? { modelId: seed.modelId, modelLocked: true } : {}),
    createdAt: seed.createdAt,
    updatedAt: seed.createdAt,
  };
  return { id: seed.id, role: "assistant", parts: [], metadata };
}

export function advanceAssistantTurn(current: DesktopUIMessage, event: WorkbenchRunEvent): DesktopUIMessage {
  if (current.role !== "assistant") throw new Error("assistant_turn_requires_assistant_role");
  const previousSequence = current.metadata?.lastSequence;
  const sequence = event.sequence ?? (previousSequence ?? 0) + 1;
  if (previousSequence !== undefined && sequence <= previousSequence) return current;
  const updatedAt = event.createdAt ?? current.metadata?.updatedAt ?? current.metadata?.createdAt ?? new Date(0).toISOString();
  let parts: DesktopUIMessagePart[];
  let partOccurrences = current.metadata?.partOccurrences;

  if (event.type === "text" || event.type === "reasoning") {
    const last = current.parts.at(-1);
    if (last?.type === event.type && last.state === "streaming") {
      const updated = { ...last, text: mergeStreamingText(last.text, event.delta) };
      parts = current.parts.map((part, index) => index === current.parts.length - 1 ? updated : part);
    } else {
      const finalized = finalizeOpenSegments(current.parts);
      const partId = `${event.type}:${sequence}`;
      const incoming = { type: event.type, text: event.delta, state: "streaming" as const, providerMetadata: providerMetadata(partId, sequence, event.createdAt) };
      parts = [...finalized, incoming] as DesktopUIMessagePart[];
    }
  } else {
    const incoming = eventEntityPart(event);
    if (!incoming) return current;
    const finalized = finalizeOpenSegments(current.parts);
    const identity = entityIdentity(incoming);
    const isFirstOccurrence = Boolean(identity) && !finalized.some((part) => entityIdentity(part) === identity);
    parts = mergeEntity(finalized, incoming);
    if (identity && isFirstOccurrence) {
      partOccurrences = {
        ...partOccurrences,
        [identity]: { sequence, ...(event.createdAt ? { createdAt: event.createdAt } : {}) },
      };
    }
    if (event.type === "status" && ["succeeded", "failed", "cancelled", "interrupted"].includes(event.status)) {
      parts = finalizeOpenSegments(parts);
    }
  }

  const runStatus = event.type === "status" ? statusFromWorkbench(event.status) : current.metadata?.runStatus;
  return {
    ...current,
    parts,
    metadata: {
      ...current.metadata,
      conversationId: current.metadata?.conversationId ?? "",
      createdAt: current.metadata?.createdAt ?? updatedAt,
      updatedAt,
      lastSequence: sequence,
      ...(runStatus ? { runStatus } : {}),
      ...(partOccurrences ? { partOccurrences } : {}),
    },
  };
}
