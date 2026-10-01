import type { MetricEvent, InvocationPhase } from "@coworkany/workbench-client";

const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value : undefined;

function messageData(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
function capabilityName(tool: string) {
  return tool.replace(/^(?:media|workflow|ppt):/u, "");
}

function invocationPhase(event: Record<string, unknown>, data: Record<string, unknown>): InvocationPhase {
  if (event.event === "permission_response" && event.response === "reject") return "rejected";
  if (event.event === "tool_result") return data.ok === false || data.error ? "failed" : "completed";
  return event.phase === "completed" ? "completed" : event.phase === "failed" ? "failed" : event.phase === "rejected" ? "rejected" : "started";
}

function attemptFrom(value: unknown) {
  const direct = numberValue(value);
  if (direct !== undefined) return Math.max(1, Math.trunc(direct));
  const match = stringValue(value)?.match(/:(\d+)$/u);
  return match ? Math.max(1, Number(match[1])) : 1;
}

/** Normalize raw desktop runtime frames into the sole metrics event contract. */
export function normalizeDesktopMetricEvent(event: Record<string, unknown>, sequence: number): MetricEvent | undefined {
  const runId = stringValue(event.runId);
  if (!runId) return undefined;
  const createdAt = stringValue(event.createdAt) ?? new Date().toISOString();
  if (event.event === "usage") {
    const usageId = stringValue(event.usageId) ?? `${runId}:usage:${sequence}`;
    return {
      kind: "usage",
      runId,
      usageId,
      ...(stringValue(event.provider) ? { provider: String(event.provider) } : {}),
      ...(stringValue(event.model) ? { model: String(event.model) } : {}),
      ...(numberValue(event.inputTokens) === undefined ? {} : { inputTokens: numberValue(event.inputTokens) }),
      ...(numberValue(event.outputTokens) === undefined ? {} : { outputTokens: numberValue(event.outputTokens) }),
      ...(numberValue(event.cachedInputTokens) === undefined ? {} : { cachedInputTokens: numberValue(event.cachedInputTokens) }),
      ...(numberValue(event.reasoningTokens) === undefined ? {} : { reasoningTokens: numberValue(event.reasoningTokens) }),
      ...(numberValue(event.costUsd ?? event.providerCost) === undefined ? {} : { providerCost: numberValue(event.costUsd ?? event.providerCost) }),
      ...(numberValue(event.estimatedCost) === undefined ? {} : { estimatedCost: numberValue(event.estimatedCost) }),
      aggregation: event.aggregation === "snapshot" ? "snapshot" : "delta",
      scope: event.scope === "run" ? "run" : "step",
      createdAt,
    };
  }

  if (!["tool_event", "tool_call", "tool_result", "permission_request", "permission_response"].includes(String(event.event))) return undefined;
  const nested = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  const message = messageData(event.message);
  const tool = stringValue(nested.toolName ?? nested.tool ?? event.toolName ?? event.tool) ?? (String(event.event).startsWith("permission") ? "permission" : undefined);
  if (!tool || /^(?:artifact|run|progress):/u.test(tool)) return undefined;
  const isCapability = /^(?:media|workflow|ppt):/u.test(tool);
  const idempotencyKey = stringValue(nested.idempotencyKey ?? message.idempotencyKey);
  const invocationId = stringValue(nested.toolCallId ?? nested.callId ?? nested.id ?? event.toolCallId ?? event.callId ?? event.permissionId) ?? idempotencyKey ?? `${tool}:${sequence}`;
  return {
    kind: "invocation",
    runId,
    invocationId,
    category: isCapability ? "capability" : "model_tool",
    name: isCapability ? capabilityName(tool) : tool,
    phase: invocationPhase(event, nested),
    attempt: attemptFrom(nested.attempt ?? message.attempt ?? idempotencyKey),
    createdAt,
  };
}
