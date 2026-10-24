import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_ROLE_COLUMNS,
  OFFICE_ROLE_ORDER,
  OFFICE_ROLE_ROWS,
  officeRoleAnchorForLayout,
  officeRoleRowForLayout,
} from "../src/virtual-office/office-layout";

test("uses the requested four-column role order", () => {
  assert.equal(OFFICE_ROLE_COLUMNS, 4);
  assert.equal(OFFICE_ROLE_ROWS, 2);
  assert.deepEqual(OFFICE_ROLE_ORDER.slice(0, 4), ["ai-chat", "agent-center", "ppt-expert", "workflow-operator"]);
  assert.deepEqual(OFFICE_ROLE_ORDER.slice(4), ["writer", "image-creator", "video-producer"]);
  assert.equal(officeRoleRowForLayout("ai-chat"), "rear");
  assert.equal(officeRoleRowForLayout("ppt-expert"), "rear");
  assert.equal(officeRoleRowForLayout("workflow-operator"), "rear");
  assert.equal(officeRoleRowForLayout("image-creator"), "middle");
  assert.equal(officeRoleRowForLayout("video-producer"), "middle");
});

test("maps seven roles to four columns with the last three centered", () => {
  const anchors = OFFICE_ROLE_ORDER.map((roleId) => officeRoleAnchorForLayout(roleId, 1000, 800));
  assert.deepEqual(anchors.map(({ x, y }) => [Math.round(x), Math.round(y)]), [
    [125, 160], [375, 160], [625, 160], [875, 160],
    [250, 640], [500, 640], [750, 640],
  ]);
  assert.deepEqual(anchors.map((anchor) => anchor.x), [125, 375, 625, 875, 250, 500, 750]);
  assert.ok(anchors[0].y < anchors[4].y);
  assert.ok(anchors.every((anchor) => anchor.x >= 0 && anchor.x <= 1000 && anchor.y >= 0 && anchor.y <= 800));
});

test("keeps the four-column grid stable across responsive artboards", () => {
  const wide = OFFICE_ROLE_ORDER.map((roleId) => officeRoleAnchorForLayout(roleId, 1600, 900));
  const tall = OFFICE_ROLE_ORDER.map((roleId) => officeRoleAnchorForLayout(roleId, 900, 1200));
  assert.deepEqual(wide.map(({ x, y }) => [Math.round(x), Math.round(y)]), [
    [200, 180], [600, 180], [1000, 180], [1400, 180],
    [400, 720], [800, 720], [1200, 720],
  ]);
  assert.deepEqual(tall.map(({ x, y }) => [Math.round(x), Math.round(y)]), [
    [113, 240], [338, 240], [563, 240], [788, 240],
    [225, 960], [450, 960], [675, 960],
  ]);
  const narrow = OFFICE_ROLE_ORDER.map((roleId) => officeRoleAnchorForLayout(roleId, 360, 640));
  assert.deepEqual(narrow.map(({ x, y }) => [Math.round(x), Math.round(y)]), [
    [45, 128], [135, 128], [225, 128], [315, 128],
    [90, 512], [180, 512], [270, 512],
  ]);
});

test("clamps invalid host dimensions without producing NaN", () => {
  const anchor = officeRoleAnchorForLayout("writer", 0, -10);
  assert.deepEqual(anchor, { x: 0, y: 0 });
  assert.ok(Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
});
