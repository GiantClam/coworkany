import assert from "node:assert/strict";
import test from "node:test";
import { OFFICE_ROLE_ORDER, officeRoleAnchorForLayout, officeRoleRowForLayout } from "../src/virtual-office/office-layout";

test("uses the approved 3+4 island order", () => {
  assert.deepEqual(OFFICE_ROLE_ORDER.slice(0, 3), ["ai-chat", "agent-center", "ppt-expert"]);
  assert.deepEqual(OFFICE_ROLE_ORDER.slice(3), ["workflow-operator", "writer", "image-creator", "video-producer"]);
  assert.equal(officeRoleRowForLayout("ai-chat"), "rear");
  assert.equal(officeRoleRowForLayout("ppt-expert"), "rear");
  assert.equal(officeRoleRowForLayout("workflow-operator"), "front");
  assert.equal(officeRoleRowForLayout("video-producer"), "front");
});

test("maps the seven roles to stable 3+4 normalized anchors", () => {
  const anchors = OFFICE_ROLE_ORDER.map((roleId) => officeRoleAnchorForLayout(roleId, 1000, 800));
  assert.deepEqual(anchors.map(({ x, y }) => [Math.round(x), Math.round(y)]), [
    [308, 349], [500, 349], [691, 349],
    [152, 492], [380, 492], [614, 492], [846, 492],
  ]);
  assert.ok(anchors.slice(0, 3).every((anchor) => anchor.y < anchors[3].y));
  assert.ok(anchors.every((anchor) => anchor.x >= 0 && anchor.x <= 1000));
});

test("clamps invalid host dimensions without producing NaN", () => {
  const anchor = officeRoleAnchorForLayout("writer", 0, -10);
  assert.deepEqual(anchor, { x: 0, y: 0 });
  assert.ok(Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
});
