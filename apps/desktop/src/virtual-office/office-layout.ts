import type { OfficeRoleAnchor, OfficeRoleId } from "./types";

export const OFFICE_ROLE_ORDER: readonly OfficeRoleId[] = ["ai-chat", "agent-center", "ppt-expert", "workflow-operator", "writer", "image-creator", "video-producer"];
export const OFFICE_ROLE_COLUMNS = 4;
export const OFFICE_ROLE_ROWS = Math.ceil(OFFICE_ROLE_ORDER.length / OFFICE_ROLE_COLUMNS);

export type OfficeRoleRow = "rear" | "middle" | "front";

const ROW_NAMES: readonly OfficeRoleRow[] = ["rear", "middle", "front"];
const GRID_VERTICAL_INSET = 0.2;

function roleGridPosition(roleId: OfficeRoleId): { readonly x: number; readonly y: number; readonly row: OfficeRoleRow } {
  const roleIndex = Math.max(0, OFFICE_ROLE_ORDER.indexOf(roleId));
  const rowIndex = Math.floor(roleIndex / OFFICE_ROLE_COLUMNS);
  const columnIndex = roleIndex % OFFICE_ROLE_COLUMNS;
  const rowItemCount = Math.min(OFFICE_ROLE_COLUMNS, OFFICE_ROLE_ORDER.length - rowIndex * OFFICE_ROLE_COLUMNS);
  const centeredColumn = columnIndex + (OFFICE_ROLE_COLUMNS - rowItemCount) / 2;
  const rowProgress = OFFICE_ROLE_ROWS <= 1 ? 0.5 : rowIndex / (OFFICE_ROLE_ROWS - 1);
  const y = GRID_VERTICAL_INSET + rowProgress * (1 - GRID_VERTICAL_INSET * 2);
  return {
    x: (centeredColumn + 0.5) / OFFICE_ROLE_COLUMNS,
    y,
    row: ROW_NAMES[rowIndex] ?? "front",
  };
}

export function officeRoleRowForLayout(roleId: OfficeRoleId): OfficeRoleRow {
  return roleGridPosition(roleId).row;
}

export function officeRoleAnchorForLayout(roleId: OfficeRoleId, width: number, height: number): OfficeRoleAnchor {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const normalized = roleGridPosition(roleId);
  return { x: safeWidth * normalized.x, y: safeHeight * normalized.y };
}
