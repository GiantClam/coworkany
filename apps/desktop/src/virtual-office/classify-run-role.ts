import type { WorkbenchConversation, WorkbenchRun } from "@coworkany/workbench-client";
import type { DesktopTaskMetadata } from "../desktop-task-metadata";
import type { OfficeRoleId } from "./types";

export interface RunClassificationInput { readonly run: WorkbenchRun; readonly conversation?: WorkbenchConversation; readonly metadata: DesktopTaskMetadata | null }

export function classifyRunRole(input: RunClassificationInput): OfficeRoleId | null {
  const metadata = input.metadata;
  if (metadata?.kind === "workflow") return "workflow-operator";
  if (metadata?.kind === "media" && (metadata.featureId === "video_generate" || metadata.entryPath?.includes("/video"))) return "video-producer";
  if (metadata?.kind === "media" && (metadata.featureId === "image_generate" || metadata.entryPath?.includes("image-assistant"))) return "image-creator";
  const agentId = input.conversation?.agentId?.trim();
  if (agentId === "executive-ppt" || metadata?.featureId === "ppt_generate") return "ppt-expert";
  if (agentId === "entry:writer" || agentId === "writer" || metadata?.featureId === "writer") return "writer";
  if (agentId && !["executive-ppt", "entry:writer", "entry:image-assistant", "writer"].includes(agentId)) return "agent-center";
  return "ai-chat";
}
