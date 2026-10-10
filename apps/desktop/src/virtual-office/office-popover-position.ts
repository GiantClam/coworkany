import type { OfficeRoleAnchor } from "./types";

export type OfficePopoverPlacement = "right" | "left" | "bottom";
export interface OfficePopoverSize { readonly width: number; readonly height: number }
export interface OfficePopoverPosition extends OfficeRoleAnchor { readonly left: number; readonly top: number; readonly placement: OfficePopoverPlacement }

const GAP = 14;
const NARROW_HOST_WIDTH = 560;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function officeAnchorFromRects(trigger: Pick<DOMRect, "left" | "top" | "width" | "height">, host: Pick<DOMRect, "left" | "top">): OfficeRoleAnchor {
  return { x: trigger.left - host.left + trigger.width / 2, y: trigger.top - host.top + trigger.height / 2 };
}

export function clampOfficePopover(anchor: OfficeRoleAnchor, card: OfficePopoverSize, host: OfficePopoverSize): OfficePopoverPosition {
  if (host.width < NARROW_HOST_WIDTH || host.width <= card.width + GAP * 2) {
    return { ...anchor, left: clamp((host.width - card.width) / 2, GAP, host.width - card.width - GAP), top: clamp(host.height - card.height - GAP, GAP, host.height - card.height - GAP), placement: "bottom" };
  }
  const placeRight = anchor.x + GAP + card.width <= host.width - GAP;
  const placement: OfficePopoverPlacement = placeRight ? "right" : "left";
  const left = placement === "right" ? anchor.x + GAP : anchor.x - card.width - GAP;
  return { ...anchor, left: clamp(left, GAP, host.width - card.width - GAP), top: clamp(anchor.y - 24, GAP, host.height - card.height - GAP), placement };
}
