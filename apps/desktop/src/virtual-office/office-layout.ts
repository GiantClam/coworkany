import type { OfficeRoleAnchor, OfficeRoleId } from "./types";

export const OFFICE_ROLE_ORDER: readonly OfficeRoleId[] = ["ai-chat", "agent-center", "ppt-expert", "workflow-operator", "writer", "image-creator", "video-producer"];

export function officeRoleAnchorForLayout(roleId: OfficeRoleId, width: number, height: number): OfficeRoleAnchor {
  const index = Math.max(0, OFFICE_ROLE_ORDER.indexOf(roleId));
  const columnWidth = Math.max(1, width) / OFFICE_ROLE_ORDER.length;
  const x = columnWidth * index + columnWidth / 2;
  const stationWidth = Math.min(116, columnWidth * 0.78);
  return { x, y: Math.max(1, height) * 0.55 - stationWidth * 0.5 };
}
