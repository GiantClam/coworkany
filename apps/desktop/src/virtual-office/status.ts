import type { WorkbenchRunAttemptSummary, WorkbenchRunDetail } from "@coworkany/workbench-client";
import type { OfficeAttention, OfficeStatus } from "./types";

export interface ResolvedOfficeStatus { readonly status: OfficeStatus; readonly attention?: OfficeAttention; readonly statusVersion: string }

export interface OpenPermissionRequest { readonly permissionId?: string; readonly callId?: string; readonly sequence: number }

export function findOpenPermissionRequest(detail: WorkbenchRunDetail): OpenPermissionRequest | null {
  const open = new Map<string, OpenPermissionRequest>();
  const events = detail.events.slice().sort((a, b) => a.sequence - b.sequence);
  for (const event of events) {
    if (event.eventType !== "tool_call" && event.eventType !== "permission_request" && event.eventType !== "permission_response") continue;
    let payload: Record<string, unknown>;
    try { const value = JSON.parse(event.payloadJson) as unknown; if (!value || typeof value !== "object") continue; payload = value as Record<string, unknown>; } catch { continue; }
    const permissionId = typeof payload.permissionId === "string" ? payload.permissionId : typeof payload.approvalId === "string" ? payload.approvalId : undefined;
    const callId = typeof payload.callId === "string" ? payload.callId : undefined;
    const id = permissionId ? `permission:${permissionId}` : callId ? `call:${callId}` : undefined;
    if (!id) continue;
    const phase = String(payload.phase ?? payload.status ?? payload.response ?? "");
    if (event.eventType === "permission_request" || phase === "blocked" || phase === "requested") open.set(id, { ...(permissionId ? { permissionId } : {}), ...(callId ? { callId } : {}), sequence: event.sequence });
    if (event.eventType === "permission_response" || ["approved", "allow", "allowed", "rejected", "deny", "denied", "completed"].includes(phase)) open.delete(id);
  }
  return [...open.values()].sort((a, b) => a.sequence - b.sequence)[0] ?? null;
}

export function aggregateRecoverableAttempts(attempts: readonly WorkbenchRunAttemptSummary[]): { readonly status: "waiting" | "running"; readonly attention: "external"; readonly statusVersion: string } | null {
  const latest = new Map<string, WorkbenchRunAttemptSummary>();
  for (const attempt of attempts) {
    const previous = latest.get(attempt.nodeKey);
    if (!previous || previous.updatedAt < attempt.updatedAt || (previous.updatedAt === attempt.updatedAt && previous.idempotencyKey < attempt.idempotencyKey)) latest.set(attempt.nodeKey, attempt);
  }
  if (latest.size === 0) return null;
  const all = [...latest.values()];
  const selected = all.some((item) => item.status === "download_failed") ? all.filter((item) => item.status === "download_failed") : all.some((item) => item.status === "running") ? all.filter((item) => item.status === "running") : all.filter((item) => item.status === "queued" || item.status === "submitted");
  const ordered = selected.sort((a, b) => a.nodeKey.localeCompare(b.nodeKey));
  const status = ordered.some((item) => item.status === "download_failed" || item.status === "queued" || item.status === "submitted") ? "waiting" : "running";
  return { status, attention: "external", statusVersion: ordered.map((item) => `${item.nodeKey}/${item.idempotencyKey}/${item.status}/${item.updatedAt}`).join("|") };
}

export function resolveOfficeStatus(detail: WorkbenchRunDetail, attempts: readonly WorkbenchRunAttemptSummary[]): ResolvedOfficeStatus {
  const runStatus = detail.run.status;
  if (runStatus === "succeeded") return { status: "completed", statusVersion: detail.run.finishedAt ?? detail.run.startedAt };
  if (runStatus === "failed" || runStatus === "interrupted") return { status: "failed", statusVersion: detail.run.finishedAt ?? detail.run.startedAt };
  if (runStatus === "cancelled") return { status: "cancelled", statusVersion: detail.run.finishedAt ?? detail.run.startedAt };
  const blockedNode = detail.nodes.filter((node) => ["blocked", "approval_requested"].includes(node.status)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
  if (blockedNode) return { status: "waiting", attention: "user", statusVersion: `node:${blockedNode.nodeKey}:${blockedNode.updatedAt}` };
  const openPermission = findOpenPermissionRequest(detail);
  if (openPermission) return { status: "waiting", attention: "user", statusVersion: `permission:${openPermission.permissionId ?? openPermission.callId ?? "unknown"}:${openPermission.sequence}` };
  const provider = aggregateRecoverableAttempts(attempts);
  if (provider) return provider;
  if (runStatus === "queued") return { status: "queued", statusVersion: detail.run.startedAt };
  if (runStatus === "running") return { status: "running", statusVersion: detail.run.startedAt };
  return { status: "unknown", statusVersion: detail.run.startedAt };
}
