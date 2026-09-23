import type { WorkflowCanvasExecutionSnapshot } from "@coworkany/workbench-ui";

type WorkflowNodeEventTool = "workflow:node_started" | "workflow:node_succeeded" | "workflow:node_failed";
type WorkflowTerminalStatus = "succeeded" | "failed" | "cancelled";

function parsePayload(message: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(message);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function createWorkflowNodeSnapshots(nodeKeys: readonly string[]): WorkflowCanvasExecutionSnapshot[] {
  return [...new Set(nodeKeys)].map((nodeKey) => ({ nodeKey, status: "queued" }));
}

export function applyWorkflowNodeEvent(snapshots: readonly WorkflowCanvasExecutionSnapshot[], tool: string, message: string): WorkflowCanvasExecutionSnapshot[] {
  if (!["workflow:node_started", "workflow:node_succeeded", "workflow:node_failed"].includes(tool)) return [...snapshots];
  const payload = parsePayload(message);
  const nodeKey = typeof payload.nodeKey === "string" ? payload.nodeKey : "";
  if (!nodeKey) return [...snapshots];
  const status = tool === "workflow:node_started" ? "running" : tool === "workflow:node_succeeded" ? "succeeded" : "failed";
  const snapshot = {
    nodeKey,
    status,
    ...(status === "succeeded" && payload.output && typeof payload.output === "object" && !Array.isArray(payload.output) ? { outputPayload: payload.output as Record<string, unknown> } : {}),
    ...(status === "failed" && typeof payload.message === "string" ? { errorMessage: payload.message } : {}),
  };
  const found = snapshots.some((candidate) => candidate.nodeKey === nodeKey);
  return found ? snapshots.map((candidate) => candidate.nodeKey === nodeKey ? snapshot : candidate) : [...snapshots, snapshot];
}

export function finalizeWorkflowNodeSnapshots(snapshots: readonly WorkflowCanvasExecutionSnapshot[], status: WorkflowTerminalStatus): WorkflowCanvasExecutionSnapshot[] {
  return snapshots.map((snapshot) => {
    if (["succeeded", "failed", "cancelled", "skipped"].includes(snapshot.status)) return snapshot;
    if (status === "failed" && snapshot.status === "running") return { ...snapshot, status: "failed" };
    if (status === "cancelled" && snapshot.status === "running") return { ...snapshot, status: "cancelled" };
    // 未收到启动事件的节点没有执行证据，保留 queued，避免把启动失败误报为“已跳过”。
    return snapshot;
  });
}
