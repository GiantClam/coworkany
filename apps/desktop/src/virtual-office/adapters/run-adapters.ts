import type { AgentDirectoryReader, OfficeRoleAdapter, OfficeRoleId, OfficeWorkItem, RunRecord } from "../types";
import { classifyRunRole } from "../classify-run-role";
import { resolveOfficeStatus } from "../status";

const ROLE_ADAPTER_IDS: Readonly<Record<OfficeRoleId, string>> = {
  "ai-chat": "conversation-runs",
  "agent-center": "agent-runs",
  "ppt-expert": "ppt-runs",
  "workflow-operator": "workflow-runs",
  writer: "writer-runs",
  "image-creator": "image-runs",
  "video-producer": "video-runs",
};

function routeForRecord(record: RunRecord, roleId: OfficeRoleId): string | undefined {
  if (record.metadata?.entryPath?.trim()) return record.metadata.entryPath.trim();
  const conversationId = record.conversation?.id ?? record.run.conversationId;
  if (!conversationId) return undefined;
  const encoded = encodeURIComponent(conversationId);
  if (roleId === "writer") return `/dashboard/writer/${encoded}`;
  if (roleId === "image-creator") return `/dashboard/image-assistant/${encoded}`;
  if (roleId === "video-producer") return `/dashboard/video/${encoded}`;
  if (roleId === "ppt-expert") return `/dashboard/ai/${encoded}?agent=executive-ppt`;
  if (roleId === "agent-center" && record.conversation?.agentId) return `/dashboard/ai/${encoded}?agent=${encodeURIComponent(record.conversation.agentId)}`;
  return `/dashboard/ai/${encoded}`;
}

function toWorkItem(record: RunRecord, id: string, expectedRole: OfficeRoleId): OfficeWorkItem | null {
  const roleId = classifyRunRole({ run: record.run, conversation: record.conversation, metadata: record.metadata });
  if (!roleId || roleId !== expectedRole) return null;
  const resolved = resolveOfficeStatus(record.detail, record.attempts);
  const title = record.conversation?.title?.trim() || record.metadata?.workflowTitle?.trim() || record.metadata?.featureId || record.run.id;
  const routeTarget = routeForRecord(record, roleId);
  const artifactIds = record.detail.events.flatMap((event) => { try { const payload = JSON.parse(event.payloadJson) as { artifact?: { id?: unknown } }; return typeof payload.artifact?.id === "string" ? [payload.artifact.id] : []; } catch { return []; } });
  return { sourceAdapterId: id, workItemId: record.run.id, roleId, status: resolved.status, ...(resolved.attention ? { attention: resolved.attention } : {}), statusVersion: resolved.statusVersion, title, updatedAt: record.run.finishedAt ?? record.run.startedAt, ...(routeTarget ? { routeTarget } : {}), artifactIds };
}

export function createRoleRunAdapter(roleId: OfficeRoleId, agentDirectoryReader?: AgentDirectoryReader): OfficeRoleAdapter {
  const id = ROLE_ADAPTER_IDS[roleId];
  return {
    id,
    toWorkItem(record) {
      if (roleId === "agent-center") {
        const directory = agentDirectoryReader?.getSnapshot?.();
        const agentId = record.conversation?.agentId;
        const installed = directory && "snapshot" in directory && directory.snapshot?.entries.some((entry) => entry.agentId === agentId && entry.installed && entry.availability === "available");
        if (!installed) return null;
      }
      return toWorkItem(record, id, roleId);
    },
  };
}

export function createConversationRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("ai-chat"); }
export function createAgentRunsAdapter(reader?: AgentDirectoryReader): OfficeRoleAdapter { return createRoleRunAdapter("agent-center", reader); }
export function createPptRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("ppt-expert"); }
export function createWorkflowRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("workflow-operator"); }
export function createWriterRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("writer"); }
export function createImageRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("image-creator"); }
export function createVideoRunsAdapter(): OfficeRoleAdapter { return createRoleRunAdapter("video-producer"); }
