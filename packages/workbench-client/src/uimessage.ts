import type { ChatTransport, UIMessage, UIMessageChunk, UIMessagePart } from "ai";
import type { WorkbenchArtifact, WorkbenchMessage, WorkbenchMessagePart, WorkbenchPreviewData, WorkbenchRunEvent, WorkbenchUsage } from "./index";

export type DesktopRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type DesktopMessageMetadata = {
  readonly conversationId: string;
  readonly runId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly route?: string;
  readonly capability?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSequence?: number;
  readonly modelLocked?: boolean;
  readonly branchOf?: string;
  readonly runStatus?: DesktopRunStatus;
};

export type DesktopTaskData = {
  readonly taskId?: string;
  readonly title: string;
  readonly steps?: readonly { readonly id: string; readonly title: string; readonly status: DesktopRunStatus; readonly detail?: string; readonly toolName?: string }[];
  readonly status: DesktopRunStatus;
};

export type DesktopWorkflowData = {
  readonly nodeId: string;
  readonly title?: string;
  readonly status: DesktopRunStatus;
  readonly output?: unknown;
  readonly media?: readonly DesktopMediaData[];
};

export type DesktopMediaData = {
  readonly artifactId: string;
  readonly kind: "image" | "video" | "audio" | "document";
  readonly mimeType: string;
  readonly title: string;
  readonly relativePath?: string;
  readonly previewable?: boolean;
};

export type DesktopArtifactData = WorkbenchArtifact;
export type DesktopPreviewData = WorkbenchPreviewData;

/** Associates generated media with the Writer article it belongs to. */
export type DesktopWriterAssetData = {
  readonly articleMessageId: string;
  readonly kind: "image";
};

export type DesktopDataParts = {
  task: DesktopTaskData;
  workflow: DesktopWorkflowData;
  media: DesktopMediaData;
  artifact: DesktopArtifactData;
  preview: DesktopPreviewData;
  writerAsset: DesktopWriterAssetData;
  status: { readonly status: DesktopRunStatus; readonly message?: string };
  attachment: { readonly attachmentId: string; readonly name: string; readonly mediaType: string; readonly uri?: string; readonly status: "queued" | "uploading" | "ready" | "failed" };
  warning: { readonly code: string; readonly message: string };
  usage: WorkbenchUsage;
  report: { readonly title: string; readonly body?: string; readonly artifactId?: string };
};

export type DesktopTools = Record<string, never>;
export type DesktopUIMessage = UIMessage<DesktopMessageMetadata, DesktopDataParts, DesktopTools>;
export type DesktopUIMessagePart = UIMessagePart<DesktopDataParts, DesktopTools>;
export type DesktopUIMessageChunk = UIMessageChunk<DesktopMessageMetadata, DesktopDataParts>;

const PART_ID_KEY = "partId";
const SEQUENCE_KEY = "sequence";
function now() {
  return new Date().toISOString();
}

function providerMetadata(partId: string, sequence?: number) {
  return { coworkany: { [PART_ID_KEY]: partId, ...(sequence === undefined ? {} : { [SEQUENCE_KEY]: sequence }) } };
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

function eventPart(event: WorkbenchRunEvent): DesktopUIMessagePart | undefined {
  const sequence = event.sequence;
  const createdAt = event.createdAt;
  switch (event.type) {
    case "text":
      return { type: "text", text: event.delta, state: "streaming", providerMetadata: providerMetadata("text:assistant", sequence) };
    case "reasoning":
      return { type: "reasoning", text: event.delta, state: "streaming", providerMetadata: providerMetadata("reasoning:assistant", sequence) };
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
      return dataPart("usage", `usage:${event.usage.runId}`, event.usage);
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
  }
  void createdAt;
}

function previewPartId(preview: WorkbenchPreviewData) {
  return `preview:${preview.previewSessionId ?? preview.artifactId ?? preview.relativePath ?? preview.title}`;
}

function partIdentity(part: DesktopUIMessagePart): string | undefined {
  if (part.type === "dynamic-tool") return `tool:${part.toolCallId}`;
  if (part.type.startsWith("data-") && "id" in part && part.id) return `${part.type}:${part.id}`;
  if ((part.type === "text" || part.type === "reasoning") && part.providerMetadata?.coworkany?.[PART_ID_KEY]) return String(part.providerMetadata.coworkany[PART_ID_KEY]);
  return undefined;
}

function partSequence(part: DesktopUIMessagePart) {
  if ((part.type === "text" || part.type === "reasoning") && part.providerMetadata?.coworkany?.[SEQUENCE_KEY]) return Number(part.providerMetadata.coworkany[SEQUENCE_KEY]);
  return undefined;
}

function isTerminalTool(part: DesktopUIMessagePart) {
  return part.type === "dynamic-tool" && (part.state === "output-available" || part.state === "output-error" || part.state === "output-denied");
}

export function mergeStreamingText(previous: string, incoming: string) {
  if (!previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  // Runtime responses are delivered at-least-once while the desktop host
  // reconnects or more than one UI consumer is attached to a run. Treat an
  // already-complete trailing fragment as idempotent, including short tokens
  // such as "D", "PPT", or "skill". Without this, a repeated transport
  // fragment becomes visible as `I'llI'llI'll` instead of one assistant turn.
  if (previous.endsWith(incoming)) return previous;
  const compactPrevious = previous.replace(/\s+/gu, "");
  const compactIncoming = incoming.replace(/\s+/gu, "");
  const isFullSnapshot = previous.length >= 16
    && incoming.length > previous.length
    && compactIncoming.startsWith(compactPrevious);
  return isFullSnapshot ? incoming : `${previous}${incoming}`;
}

function mergePart(parts: readonly DesktopUIMessagePart[], incoming: DesktopUIMessagePart): DesktopUIMessagePart[] {
  const identity = partIdentity(incoming);
  const index = identity === undefined ? -1 : parts.findIndex((part) => partIdentity(part) === identity);
  if (index < 0) return [...parts, incoming];
  const current = parts[index];
  if (isTerminalTool(current) && incoming.type === "dynamic-tool" && !isTerminalTool(incoming)) return [...parts];
  if (incoming.type === "text" && current.type === "text") {
    const nextText = mergeStreamingText(current.text, incoming.text);
    const next = { ...current, ...incoming, text: nextText };
    return parts.map((part, partIndex) => partIndex === index ? next : part);
  }
  if (incoming.type === "reasoning" && current.type === "reasoning") {
    const nextText = mergeStreamingText(current.text, incoming.text);
    const next = { ...current, ...incoming, text: nextText };
    return parts.map((part, partIndex) => partIndex === index ? next : part);
  }
  return parts.map((part, partIndex) => partIndex === index ? { ...part, ...incoming } as DesktopUIMessagePart : part);
}

/** Apply one host event to a UIMessage part list without introducing a second UI protocol. */
export function applyDesktopUIMessageRunEventToParts(parts: readonly DesktopUIMessagePart[], event: WorkbenchRunEvent): DesktopUIMessagePart[] {
  if (event.type === "text" || event.type === "reasoning") {
    const incoming = eventPart(event);
    if (incoming && (incoming.type === "text" || incoming.type === "reasoning")) {
      const identity = partIdentity(incoming);
      const index = identity === undefined ? -1 : parts.findIndex((part) => partIdentity(part) === identity);
      if (index < 0) return [...parts, incoming];
      const current = parts[index];
      if (current.type === incoming.type) {
        const next = { ...current, ...incoming, text: `${current.text}${incoming.text}` };
        return parts.map((part, partIndex) => partIndex === index ? next : part);
      }
    }
  }
  const lastSequence = parts.reduce((highest, part) => Math.max(highest, partSequence(part) ?? -1), -1);
  const seed = createDesktopUIMessage({ id: "desktop-run-parts", role: "assistant", conversationId: "" });
  const updated = applyWorkbenchRunEventToUIMessage({ ...seed, parts: [...parts], metadata: { conversationId: "", createdAt: seed.metadata?.createdAt ?? now(), updatedAt: now(), lastSequence } }, event);
  return updated.parts;
}

function sortedParts(parts: readonly DesktopUIMessagePart[]) {
  return [...parts].sort((left, right) => (partSequence(left) ?? Number.MAX_SAFE_INTEGER) - (partSequence(right) ?? Number.MAX_SAFE_INTEGER));
}

export function createDesktopUIMessage(input: {
  readonly id: string;
  readonly role: DesktopUIMessage["role"];
  readonly conversationId: string;
  readonly content?: string;
  readonly runId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly route?: string;
  readonly capability?: string;
  readonly createdAt?: string;
  readonly branchOf?: string;
}): DesktopUIMessage {
  const createdAt = input.createdAt ?? now();
  const content = input.content;
  const parts: DesktopUIMessagePart[] = content ? [{ type: "text", text: content, state: "done", providerMetadata: providerMetadata(`${input.role}:text`) }] : [];
  return {
    id: input.id,
    role: input.role,
    parts,
    metadata: {
      conversationId: input.conversationId,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId, modelLocked: Boolean(input.runId) } : {}),
      ...(input.route ? { route: input.route } : {}),
      ...(input.capability ? { capability: input.capability } : {}),
      createdAt,
      updatedAt: createdAt,
      ...(input.branchOf ? { branchOf: input.branchOf } : {}),
    },
  };
}

function workbenchPartToUIMessagePart(part: WorkbenchMessagePart): DesktopUIMessagePart | undefined {
  if (part.type === "text") return { type: "text", text: part.text, state: "done", providerMetadata: providerMetadata(part.id, part.sequence) };
  if (part.type === "reasoning") return { type: "reasoning", text: part.text, state: part.status === "running" ? "streaming" : "done", providerMetadata: providerMetadata(part.id, part.sequence) };
  if (part.type === "plan") return dataPart("task", part.id, { title: part.title ?? "Execution plan", status: statusFromWorkbench(part.status), steps: part.steps.map((step) => ({ id: step.id, title: step.title, status: statusFromWorkbench(step.status), detail: step.detail })) });
  if (part.type === "task") return dataPart("task", part.id, { taskId: part.taskId, title: part.title, status: statusFromWorkbench(part.status), steps: part.steps?.map((step) => ({ id: step.id, title: step.title, status: statusFromWorkbench(step.status), detail: step.detail, toolName: step.toolName })) });
  if (part.type === "tool-call") {
    if (part.status === "blocked" || part.status === "waiting") return { type: "dynamic-tool", toolName: part.toolName, toolCallId: part.toolCallId, state: "approval-requested", input: part.input, approval: { id: `approval:${part.toolCallId}` } };
    if (part.status === "completed" || part.status === "succeeded") return { type: "dynamic-tool", toolName: part.toolName, toolCallId: part.toolCallId, state: "output-available", input: part.input, output: part.output };
    if (part.status === "failed") return { type: "dynamic-tool", toolName: part.toolName, toolCallId: part.toolCallId, state: "output-error", input: part.input, errorText: part.error ?? "Tool execution failed" };
    return { type: "dynamic-tool", toolName: part.toolName, toolCallId: part.toolCallId, state: "input-available", input: part.input };
  }
  if (part.type === "attachment") return dataPart("attachment", part.id, { attachmentId: part.id, name: part.name, mediaType: part.mediaType, uri: part.uri, status: part.status ?? "ready" });
  if (part.type === "warning") return dataPart("warning", part.id, { code: part.id, message: part.message });
  if (part.type === "tool") return dataPart("status", part.id, { status: statusFromWorkbench(part.status), message: part.message });
  if (part.type === "status") return dataPart("status", part.id, { status: statusFromWorkbench(part.status), message: part.message });
  if (part.type === "usage") return dataPart("usage", part.id, part.usage);
  if (part.type === "artifact") return dataPart("artifact", part.id, part.artifact);
  if (part.type === "preview") return dataPart("preview", part.id, part.preview);
  if (part.type === "source") return part.href ? { type: "source-url", sourceId: part.id, url: part.href, title: part.title } : { type: "source-document", sourceId: part.id, mediaType: "text/plain", title: part.title };
  if (part.type === "report") return dataPart("report", part.id, { title: part.title, body: part.body, artifactId: part.artifact?.id });
  return undefined;
}

export function workbenchMessageToDesktopUIMessage(message: WorkbenchMessage): DesktopUIMessage {
  const parts = (message.parts ?? []).map(workbenchPartToUIMessagePart).filter((part): part is DesktopUIMessagePart => Boolean(part));
  const role = message.role === "system" || message.role === "tool" ? "assistant" : message.role;
  const createdAt = message.createdAt;
  return {
    id: message.id,
    role,
    parts: parts.length ? parts : (message.content ? [{ type: "text", text: message.content, state: "done", providerMetadata: providerMetadata(`${message.role}:text`) }] : []),
    metadata: { conversationId: message.conversationId, createdAt, updatedAt: createdAt, ...(message.status ? { runStatus: statusFromWorkbench(message.status) } : {}) },
  };
}

export function applyWorkbenchRunEventToUIMessage(message: DesktopUIMessage, event: WorkbenchRunEvent): DesktopUIMessage {
  const sequence = event.sequence;
  const previousSequence = message.metadata?.lastSequence;
  if (sequence !== undefined && previousSequence !== undefined && sequence <= previousSequence) return message;
  const incoming = eventPart(event);
  if (!incoming) return message;
  const parts = sortedParts(mergePart(message.parts, incoming));
  const status = event.type === "status" ? statusFromWorkbench(event.status) : undefined;
  const updatedAt = event.createdAt ?? now();
  return {
    ...message,
    parts,
    metadata: {
      ...message.metadata,
      conversationId: message.metadata?.conversationId ?? "",
      createdAt: message.metadata?.createdAt ?? updatedAt,
      updatedAt,
      ...(sequence === undefined ? {} : { lastSequence: Math.max(previousSequence ?? -1, sequence) }),
      ...(status ? { runStatus: status } : {}),
    },
  };
}

export function desktopUIMessageText(message: DesktopUIMessage) {
  return message.parts.filter((part): part is Extract<DesktopUIMessagePart, { type: "text" }> => part.type === "text").map((part) => part.text).join("");
}

export function desktopUIMessageStorage(message: DesktopUIMessage) {
  return {
    content: desktopUIMessageText(message),
    parts_json: JSON.stringify(message.parts),
    metadata_json: JSON.stringify(message.metadata ?? {}),
  } as const;
}

export function parseDesktopUIMessage(input: { readonly id: string; readonly role: DesktopUIMessage["role"]; readonly parts: unknown; readonly metadata?: unknown }): DesktopUIMessage {
  const parts = (Array.isArray(input.parts)
    ? input.parts.map(normalizeDesktopUIMessagePart).filter(isDesktopUIMessagePart)
    : []);
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata as DesktopMessageMetadata : undefined;
  return { id: input.id, role: input.role, parts, ...(metadata ? { metadata } : {}) };
}

function normalizeDesktopUIMessagePart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const value = part as { type?: unknown; text?: unknown; thinking?: unknown; state?: unknown };
  if (value.type !== "thinking" && !(value.type === "reasoning" && typeof value.text !== "string" && typeof value.thinking === "string")) return part;
  const text = typeof value.text === "string" ? value.text : typeof value.thinking === "string" ? value.thinking : "";
  const rest = { ...value };
  delete rest.thinking;
  return { ...rest, type: "reasoning", text, state: value.state === "streaming" ? "streaming" : "done" };
}

function isDesktopUIMessagePart(part: unknown): part is DesktopUIMessagePart {
  if (!part || typeof part !== "object") return false;
  const value = part as { type?: unknown; text?: unknown; state?: unknown; data?: unknown; sourceId?: unknown; url?: unknown; mediaType?: unknown; name?: unknown; toolCallId?: unknown };
  if (typeof value.type !== "string") return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string" && (value.state === "streaming" || value.state === "done");
  if (value.type === "dynamic-tool") return typeof value.toolCallId === "string" && typeof value.state === "string";
  if (value.type === "source-url") return typeof value.sourceId === "string" && typeof value.url === "string";
  if (value.type === "source-document") return typeof value.sourceId === "string" && typeof value.mediaType === "string";
  if (value.type === "file") return typeof value.mediaType === "string" && typeof value.name === "string";
  return value.type.startsWith("data-") && "data" in value;
}

export function desktopUIMessageToWorkbenchParts(message: DesktopUIMessage): WorkbenchMessagePart[] {
  const output: WorkbenchMessagePart[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") output.push({ id: partIdentity(part) ?? `text:${index}`, type: "text", text: part.text, sequence: partSequence(part) });
    else if (part.type === "reasoning") output.push({ id: partIdentity(part) ?? `reasoning:${index}`, type: "reasoning", text: part.text, status: part.state === "done" ? "completed" : "running", sequence: partSequence(part) });
    else if (part.type === "dynamic-tool") output.push({ id: `tool-call:${part.toolCallId}`, type: "tool-call", toolName: part.toolName, toolCallId: part.toolCallId, input: part.input, output: part.state === "output-available" ? part.output : undefined, error: part.state === "output-error" ? part.errorText : undefined, status: part.state === "output-available" ? "completed" : part.state === "output-error" ? "failed" : part.state === "approval-requested" ? "blocked" : "running" });
    else if (part.type === "data-artifact") output.push({ id: part.id ?? `artifact:${index}`, type: "artifact", artifact: part.data });
    else if (part.type === "data-attachment") output.push({ id: part.id ?? `attachment:${index}`, type: "attachment", name: part.data.name, mediaType: part.data.mediaType, uri: part.data.uri, status: part.data.status });
    else if (part.type === "data-status") output.push({ id: part.id ?? `status:${index}`, type: "status", status: part.data.status === "completed" ? "succeeded" : part.data.status === "waiting" ? "running" : part.data.status });
    else if (part.type === "source-url") output.push({ id: part.sourceId, type: "source", title: part.title ?? part.url, href: part.url });
    else if (part.type === "source-document") output.push({ id: part.sourceId, type: "source", title: part.title });
    else if (part.type === "data-media") output.push({ id: part.id ?? `media:${index}`, type: "media", media: part.data });
    else if (part.type === "data-preview") output.push({ id: part.id ?? `preview:${index}`, type: "preview", preview: part.data });
  });
  return output;
}

export function workbenchEventToUIMessageChunks(event: WorkbenchRunEvent): DesktopUIMessageChunk[] {
  const part = eventPart(event);
  if (event.type === "text") return [{ type: "text-delta", id: "text:assistant", delta: event.delta }];
  if (event.type === "reasoning") return [{ type: "reasoning-delta", id: "reasoning:assistant", delta: event.delta }];
  if (!part) return [];
  if (part.type === "dynamic-tool") {
    if (part.state === "input-available") return [{ type: "tool-input-available", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, dynamic: true }];
    if (part.state === "output-available") return [{ type: "tool-output-available", toolCallId: part.toolCallId, output: part.output, dynamic: true }];
    if (part.state === "output-error") return [{ type: "tool-output-error", toolCallId: part.toolCallId, errorText: part.errorText, dynamic: true }];
  }
  if (part.type === "source-url") return [{ type: "source-url", sourceId: part.sourceId, url: part.url, title: part.title }];
  if (part.type === "source-document") return [{ type: "source-document", sourceId: part.sourceId, mediaType: part.mediaType, title: part.title, filename: part.filename }];
  if (part.type.startsWith("data-") && "data" in part) return [{ type: part.type, id: "id" in part ? part.id : undefined, data: part.data } as DesktopUIMessageChunk];
  return [];
}

export type DesktopTransportRequest = {
  readonly trigger: "submit-message" | "regenerate-message";
  readonly chatId: string;
  readonly messageId: string | undefined;
  readonly messages: DesktopUIMessage[];
  readonly abortSignal: AbortSignal | undefined;
};

export type DesktopTransportHandler = (request: DesktopTransportRequest) => Promise<ReadableStream<DesktopUIMessageChunk> | AsyncIterable<DesktopUIMessageChunk>>;

function toReadableStream(source: ReadableStream<DesktopUIMessageChunk> | AsyncIterable<DesktopUIMessageChunk>) {
  if (source instanceof ReadableStream) return source;
  return new ReadableStream<DesktopUIMessageChunk>({
    async start(controller) {
      try {
        for await (const chunk of source) controller.enqueue(chunk);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export class DesktopChatTransport implements ChatTransport<DesktopUIMessage> {
  private readonly activeStopHandlers = new Set<() => Promise<void>>();
  private stopRequested = false;

  constructor(private readonly sendHandler: DesktopTransportHandler, private readonly reconnectHandler?: (request: { readonly chatId: string }) => Promise<ReadableStream<DesktopUIMessageChunk> | AsyncIterable<DesktopUIMessageChunk> | null>) {}

  registerActiveStop(handler: () => Promise<void>) {
    if (this.stopRequested) {
      void handler().catch(() => undefined);
      return () => undefined;
    }
    this.activeStopHandlers.add(handler);
    return () => this.activeStopHandlers.delete(handler);
  }

  async stopCurrent() {
    this.stopRequested = true;
    await Promise.all([...this.activeStopHandlers].map((handler) => handler().catch(() => undefined)));
  }

  sendMessages(request: DesktopTransportRequest) {
    this.stopRequested = false;
    return this.sendHandler(request).then(toReadableStream);
  }

  reconnectToStream(request: { readonly chatId: string }) {
    return this.reconnectHandler?.(request).then((stream) => stream ? toReadableStream(stream) : null) ?? Promise.resolve(null);
  }
}

export type DesktopRunTransportAdapter = {
  readonly start: (request: { readonly chatId: string; readonly message: DesktopUIMessage; readonly prompt: string; readonly abortSignal: AbortSignal | undefined }) => Promise<{ readonly runId: string }>;
  readonly subscribe: (runId: string, onEvent: (event: WorkbenchRunEvent) => void) => () => void;
  readonly stop?: (runId: string) => Promise<void>;
};

/** Adapts the existing Tauri/OpenCode run lifecycle to the AI SDK ChatTransport stream. */
export function createDesktopRunTransport(adapter: DesktopRunTransportAdapter) {
  const transport = new DesktopChatTransport(async ({ chatId, messages, abortSignal }) => {
    const message = messages.at(-1);
    if (!message || message.role !== "user") throw new Error("desktop_transport_requires_user_message");
    const { runId } = await adapter.start({ chatId, message, prompt: desktopUIMessageText(message), abortSignal });
    let controller: ReadableStreamDefaultController<DesktopUIMessageChunk> | undefined;
    // `finish` can run synchronously from an already-aborted stream before the
    // subscription is assigned; keep this mutable closure slot intentional.
    // eslint-disable-next-line prefer-const
    let dispose: (() => void) | undefined;
    let settled = false;
    let textOpen = false;
    let reasoningOpen = false;
    let unregisterStop: () => void = () => undefined;
    const buffered: DesktopUIMessageChunk[] = [];
    const closeController = () => {
      if (controller) controller.close();
    };
    const finish = (options: { readonly finishReason?: "stop" | "error" | "other"; readonly abortReason?: string } = {}) => {
      if (settled) return;
      if (options.abortReason) {
        push({ type: "abort", reason: options.abortReason });
      } else {
        if (textOpen) push({ type: "text-end", id: "text:assistant" });
        if (reasoningOpen) push({ type: "reasoning-end", id: "reasoning:assistant" });
        push({ type: "finish", finishReason: options.finishReason ?? "stop" });
      }
      settled = true;
      unregisterStop();
      dispose?.();
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
      closeController();
    };
    const stopRun = () => {
      finish({ abortReason: "desktop_run_cancelled" });
      return adapter.stop?.(runId) ?? Promise.resolve();
    };
    const onAbort = () => { void stopRun(); };
    const push = (chunk: DesktopUIMessageChunk) => {
      if (settled) return;
      if (controller) controller.enqueue(chunk);
      else buffered.push(chunk);
    };
    const stream = new ReadableStream<DesktopUIMessageChunk>({
      start(nextController) {
        controller = nextController;
        buffered.splice(0).forEach((chunk) => nextController.enqueue(chunk));
        if (settled) nextController.close();
        if (abortSignal?.aborted) onAbort();
      },
      cancel() {
        onAbort();
      },
    });
    push({ type: "start", messageId: `assistant-${runId}` });
    dispose = adapter.subscribe(runId, (event) => {
      if (settled) return;
      if (event.type === "text" && !textOpen) {
        textOpen = true;
        push({ type: "text-start", id: "text:assistant" });
      }
      if (event.type === "reasoning" && !reasoningOpen) {
        reasoningOpen = true;
        push({ type: "reasoning-start", id: "reasoning:assistant" });
      }
      workbenchEventToUIMessageChunks(event).forEach(push);
      if (event.type === "status" && ["succeeded", "completed"].includes(event.status)) finish();
      else if (event.type === "status" && ["failed", "interrupted"].includes(event.status)) finish({ finishReason: "error" });
      else if (event.type === "status" && event.status === "cancelled") finish({ abortReason: "desktop_run_cancelled" });
    });
    unregisterStop = transport.registerActiveStop(stopRun);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    return stream;
  });
  return transport;
}
