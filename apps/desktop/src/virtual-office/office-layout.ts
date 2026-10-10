import type { OfficeRoleAnchor, OfficeRoleId } from "./types";

export const OFFICE_ROLE_ORDER: readonly OfficeRoleId[] = ["ai-chat", "agent-center", "ppt-expert", "workflow-operator", "writer", "image-creator", "video-producer"];

export type OfficeRoleRow = "rear" | "front";

const ISLAND_ANCHORS: Readonly<Record<OfficeRoleId, { readonly x: number; readonly y: number; readonly row: OfficeRoleRow }>> = {
  "ai-chat": { x: 0.308, y: 0.436, row: "rear" },
  "agent-center": { x: 0.500, y: 0.436, row: "rear" },
  "ppt-expert": { x: 0.691, y: 0.436, row: "rear" },
  "workflow-operator": { x: 0.152, y: 0.615, row: "front" },
  writer: { x: 0.380, y: 0.615, row: "front" },
  "image-creator": { x: 0.614, y: 0.615, row: "front" },
  "video-producer": { x: 0.846, y: 0.615, row: "front" },
};

export function officeRoleRowForLayout(roleId: OfficeRoleId): OfficeRoleRow {
  return ISLAND_ANCHORS[roleId]?.row ?? "front";
}

export function officeRoleAnchorForLayout(roleId: OfficeRoleId, width: number, height: number): OfficeRoleAnchor {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const normalized = ISLAND_ANCHORS[roleId] ?? ISLAND_ANCHORS["ai-chat"];
  return { x: safeWidth * normalized.x, y: safeHeight * normalized.y };
}
