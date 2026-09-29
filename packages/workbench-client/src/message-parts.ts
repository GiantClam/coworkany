import type { WorkbenchMessagePart, WorkbenchRunEvent } from "./index";
import { mergeStreamingText } from "./uimessage";

const MESSAGE_PARTS_VERSION = 2 as const;

export function normalizeWorkbenchMessageParts(
  parts: readonly WorkbenchMessagePart[] | null | undefined,
  content = "",
): WorkbenchMessagePart[] {
  const normalized = Array.isArray(parts)
    ? parts.filter((part): part is WorkbenchMessagePart => Boolean(part && typeof part.id === "string" && typeof part.type === "string"))
    : [];
  if (normalized.length || !content) return [...normalized].sort(compareParts);
  return [{ id: "text:legacy", type: "text", text: content }];
}

function compareParts(left: WorkbenchMessagePart, right: WorkbenchMessagePart) {
  if (left.sequence === undefined || right.sequence === undefined) return 0;
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function samePartIdentity(left: WorkbenchMessagePart, right: WorkbenchMessagePart) {
  if (left.id === right.id) return true;
  return left.type === "tool-call" && right.type === "tool-call" && left.toolCallId === right.toolCallId;
}

export function mergeWorkbenchMessagePart(
  parts: readonly WorkbenchMessagePart[],
  incoming: WorkbenchMessagePart,
): WorkbenchMessagePart[] {
  const index = parts.findIndex((part) => samePartIdentity(part, incoming));
  if (index < 0) return [...parts, incoming].sort(compareParts);
  const current = parts[index];
  const next = current.type === "text" && incoming.type === "text"
    ? { ...current, ...incoming, text: mergeStreamingText(current.text, incoming.text) }
    : { ...current, ...incoming } as WorkbenchMessagePart;
  return parts.map((part, partIndex) => partIndex === index ? next : part).sort(compareParts);
}

export function applyWorkbenchRunEventToParts(
  parts: readonly WorkbenchMessagePart[],
  event: WorkbenchRunEvent,
): WorkbenchMessagePart[] {
  const base = { ...(event.sequence === undefined ? {} : { sequence: event.sequence }), ...(event.createdAt ? { createdAt: event.createdAt } : {}) };
  switch (event.type) {
    case "question_request":
    case "question_response": return [...parts];
    case "text": {
      const existing = parts.find((part): part is Extract<WorkbenchMessagePart, { type: "text" }> => part.type === "text" && part.id === "text:assistant");
      return mergeWorkbenchMessagePart(parts, { id: "text:assistant", type: "text", text: mergeStreamingText(existing?.text ?? "", event.delta), ...base });
    }
    case "reasoning": {
      const existing = parts.find((part): part is Extract<WorkbenchMessagePart, { type: "reasoning" }> => part.type === "reasoning" && part.id === "reasoning:assistant");
      return mergeWorkbenchMessagePart(parts, { id: "reasoning:assistant", type: "reasoning", text: mergeStreamingText(existing?.text ?? "", event.delta), status: "running", ...base });
    }
    case "plan": return mergeWorkbenchMessagePart(parts, { ...event.plan, id: event.plan.id, type: "plan", ...base });
    case "task": return mergeWorkbenchMessagePart(parts, { ...event.task, id: event.task.id, type: "task", ...base });
    case "tool_call": {
      const status = event.phase === "started" ? "running" : event.phase === "blocked" ? "blocked" : event.phase === "completed" ? "completed" : "failed";
      return mergeWorkbenchMessagePart(parts, { id: `tool-call:${event.toolCallId}`, type: "tool-call", toolName: event.toolName, toolCallId: event.toolCallId, input: event.input, output: event.output, error: event.error, status, ...base });
    }
    case "attachment": return mergeWorkbenchMessagePart(parts, { ...event.attachment, id: event.attachment.id, type: "attachment", ...base });
    case "warning": return mergeWorkbenchMessagePart(parts, { id: `warning:${event.sequence ?? event.code}`, type: "warning", message: event.message, ...base });
    case "usage": return mergeWorkbenchMessagePart(parts, { id: `usage:${event.usage.runId}`, type: "usage", usage: event.usage, ...base });
    case "artifact": return mergeWorkbenchMessagePart(parts, { id: `artifact:${event.artifact.id}`, type: "artifact", artifact: event.artifact, ...base });
    case "status": return mergeWorkbenchMessagePart(parts, { id: "status:run", type: "status", status: event.status, ...base });
    case "tool": return mergeWorkbenchMessagePart(parts, { id: `tool:${event.tool}`, type: "tool", tool: event.tool, status: event.phase === "started" ? "running" : event.phase, message: event.message, ...base });
    case "source": return mergeWorkbenchMessagePart(parts, { id: `source:${event.source.id}`, type: "source", title: event.source.title, href: event.source.href, excerpt: event.source.excerpt, ...base });
    case "media": return mergeWorkbenchMessagePart(parts, { id: `media:${event.media.artifactId}`, type: "media", media: event.media, ...base });
    case "preview": return mergeWorkbenchMessagePart(parts, { id: `preview:${event.preview.previewSessionId ?? event.preview.artifactId ?? event.preview.relativePath ?? event.preview.title}`, type: "preview", preview: event.preview, ...base });
  }
}

export function withWorkbenchMessagePartsVersion<T extends { parts?: readonly WorkbenchMessagePart[] }>(message: T): T & { partsVersion: typeof MESSAGE_PARTS_VERSION } {
  return { ...message, partsVersion: MESSAGE_PARTS_VERSION };
}
