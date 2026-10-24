import { advanceAssistantTurn, beginAssistantTurn, desktopUIMessageText, type DesktopUIMessagePart, type WorkbenchRunEvent } from "@coworkany/workbench-client";
import { isWorkbenchQuestionToolEvent } from "@coworkany/workbench-client";

type PersistedRun = {
  readonly id: string;
  readonly status: string;
  readonly started_at: string;
  readonly finished_at?: string | null;
};

type PersistedRunEvent = {
  readonly sequence: number;
  readonly event_type: string;
  readonly payload_json: string;
  readonly created_at: string;
};

type ReplayConversationMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly status: "succeeded" | "failed" | "cancelled" | "interrupted";
  readonly parts: readonly DesktopUIMessagePart[];
};

function persistedEventToWorkbenchEvent(event: PersistedRunEvent): WorkbenchRunEvent | undefined {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(event.payload_json);
    if (!parsed || typeof parsed !== "object") return undefined;
    payload = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const base = { sequence: event.sequence, createdAt: event.created_at };
  if (isWorkbenchQuestionToolEvent({ ...payload, event: event.event_type })) return undefined;
  const delta = typeof payload.delta === "string" ? payload.delta : "";
  if (event.event_type === "text_delta" && delta) return { type: "text", delta, ...base };
  if (event.event_type === "reasoning_delta" && delta) return { type: "reasoning", delta, ...base };
  if (event.event_type === "artifact" && payload.artifact && typeof payload.artifact === "object") {
    const artifact = payload.artifact as Record<string, unknown>;
    if (typeof artifact.id !== "string" || typeof artifact.relativePath !== "string") return undefined;
    return {
      type: "artifact",
      artifact: {
        id: artifact.id,
        relativePath: artifact.relativePath,
        title: typeof artifact.title === "string" ? artifact.title : artifact.relativePath.split("/").pop() ?? artifact.relativePath,
        mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : "application/octet-stream",
        byteLength: typeof artifact.byteLength === "number" ? artifact.byteLength : 0,
        sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : "",
      },
      ...base,
    };
  }
  if (event.event_type === "preview" && payload.preview && typeof payload.preview === "object") {
    const preview = payload.preview as Record<string, unknown>;
    const kind = preview.kind;
    if (typeof preview.title !== "string" || !["web", "ppt", "image", "video", "audio", "document"].includes(String(kind))) return undefined;
    return {
      type: "preview",
      preview: {
        kind: kind as "web" | "ppt" | "image" | "video" | "audio" | "document",
        title: preview.title,
        ...(typeof preview.url === "string" ? { url: preview.url } : {}),
        ...(typeof preview.relativePath === "string" ? { relativePath: preview.relativePath } : {}),
        ...(typeof preview.artifactId === "string" ? { artifactId: preview.artifactId } : {}),
        ...(typeof preview.mimeType === "string" ? { mimeType: preview.mimeType } : {}),
        ...(typeof preview.previewSessionId === "string" ? { previewSessionId: preview.previewSessionId } : {}),
        ...(preview.engine === "ppt-master" || preview.engine === "dashi-ppt" || preview.engine === "generic-web" ? { engine: preview.engine } : {}),
        ...(typeof preview.interactive === "boolean" ? { interactive: preview.interactive } : {}),
        ...(preview.status === "loading" || preview.status === "ready" || preview.status === "unavailable" ? { status: preview.status } : {}),
        ...(typeof preview.error === "string" ? { error: preview.error } : {}),
      },
      ...base,
    };
  }
  if (event.event_type === "runtime_warning") {
    return { type: "warning", code: String(payload.code ?? "runtime_warning"), message: String(payload.message ?? "Runtime warning"), ...base };
  }
  if (event.event_type === "tool_event") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    const phase = payload.phase === "completed" ? "completed" : payload.phase === "failed" ? "failed" : "started";
    const detail = typeof payload.message === "string" ? payload.message : "";
    let detailRecord: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(detail);
      if (parsed && typeof parsed === "object") detailRecord = parsed as Record<string, unknown>;
    } catch { /* tool detail is optional during replay */ }
    return {
      type: "tool_call",
      toolName: tool,
      toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : typeof payload.callId === "string" ? payload.callId : `${tool}:${event.sequence}`,
      phase,
      input: detailRecord.args ?? detailRecord.input,
      output: detailRecord.result ?? detailRecord.output,
      error: phase === "failed" ? detail : undefined,
      ...base,
    };
  }
  return undefined;
}

function normalizePersistedTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}

export function replayPersistedRunToConversationMessage(
  run: PersistedRun,
  events: readonly PersistedRunEvent[],
  conversationId: string,
): ReplayConversationMessage | null {
  if (!["succeeded", "failed", "cancelled", "interrupted"].includes(run.status)) return null;
  // SQLite returns run timestamps without a timezone. The assistant message is
  // a completed turn, so use the finish time when available; this also keeps
  // it after the persisted user message instead of being parsed as local time
  // and appearing before the user turn in the browser.
  const createdAt = normalizePersistedTimestamp(run.finished_at || run.started_at || new Date(0).toISOString());
  let message = beginAssistantTurn({ kind: "new", id: `assistant-${run.id}`, conversationId, runId: run.id, createdAt });
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  for (const event of orderedEvents) {
    const workbenchEvent = persistedEventToWorkbenchEvent(event);
    if (workbenchEvent) message = advanceAssistantTurn(message, workbenchEvent);
  }
  const terminalStatus = run.status === "succeeded" ? "succeeded" as const : run.status === "cancelled" ? "cancelled" as const : run.status === "interrupted" ? "interrupted" as const : "failed" as const;
  message = advanceAssistantTurn(message, {
    type: "status",
    status: terminalStatus,
    sequence: (orderedEvents.at(-1)?.sequence ?? 0) + 1,
    createdAt,
  });
  const hasText = desktopUIMessageText(message).trim().length > 0;
  const hasArtifact = message.parts.some((part) => part.type === "data-artifact");
  const hasPreview = message.parts.some((part) => part.type === "data-preview");
  if (!hasText && !hasArtifact && !hasPreview) return null;
  const finalParts = message.parts as readonly DesktopUIMessagePart[];
  return {
    id: `assistant-${run.id}`,
    conversationId,
    role: "assistant",
    content: desktopUIMessageText(message),
    createdAt,
    status: run.status as ReplayConversationMessage["status"],
    parts: finalParts,
  };
}
