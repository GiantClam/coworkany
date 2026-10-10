import assert from "node:assert/strict";
import test from "node:test";
import { officeRoleAnchorForLayout } from "../src/virtual-office/office-layout";
import { clampOfficePopover, officeAnchorFromRects } from "../src/virtual-office/office-popover-position";

test("places a wide-host card to the right of the selected role", () => {
  assert.equal(clampOfficePopover({ x: 120, y: 180 }, { width: 280, height: 220 }, { width: 900, height: 520 }).placement, "right");
});

test("flips the card to the left near the right edge", () => {
  assert.equal(clampOfficePopover({ x: 880, y: 180 }, { width: 280, height: 220 }, { width: 900, height: 520 }).placement, "left");
});

test("uses a bottom card in a narrow host", () => {
  const result = clampOfficePopover({ x: 40, y: 180 }, { width: 280, height: 220 }, { width: 420, height: 320 });
  assert.equal(result.placement, "bottom");
  assert.ok(result.left >= 14);
  assert.ok(result.top >= 14);
});

test("anchors a fallback trigger inside the office host", () => {
  assert.deepEqual(officeAnchorFromRects({ left: 140, top: 760, width: 80, height: 32 }, { left: 20, top: 100 }), { x: 160, y: 676 });
});

test("recomputes a scene role anchor from the current host size", () => {
  assert.notDeepEqual(officeRoleAnchorForLayout("workflow-operator", 900, 520), officeRoleAnchorForLayout("workflow-operator", 1200, 680));
});
