import assert from "node:assert/strict";
import test from "node:test";
import { Container, Texture } from "pixi.js";
import { createOfficeBackgroundLayer } from "../src/virtual-office/office-background-layer";
import { createOfficeCharacterLayer } from "../src/virtual-office/office-character-layer";
import { createOfficeDeskLayer } from "../src/virtual-office/office-desk-layer";
import { createOfficeDisplayLayer } from "../src/virtual-office/office-display-layer";
import { OFFICE_ROLE_ORDER } from "../src/virtual-office/office-layout";
import { OFFICE_LAYER_Z } from "../src/virtual-office/office-layer-types";
import type { OfficeRoleId, OfficeSnapshot } from "../src/virtual-office/types";

function manifest() {
  return {
    schemaVersion: 1,
    assets: [
      { id: "office", path: "office.webp", purpose: "background", width: 2172, height: 724, frames: ["background"] },
      { id: "characters", path: "characters.webp", purpose: "characters", width: 896, height: 128, frames: ["idle"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "workstations", path: "workstations.webp", purpose: "desk back", width: 896, height: 288, frames: ["available", "active", "offline"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "workstations-front", path: "workstations-front.webp", purpose: "desk front", width: 896, height: 288, frames: ["available", "active", "offline"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "displays", path: "displays.webp", purpose: "displays", width: 1536, height: 1024, frames: ["display"], regions: [{ id: "main-front", x: 0, y: 0, width: 768, height: 512 }, { id: "side-angle", x: 768, y: 0, width: 768, height: 512 }] },
    ],
  } as never;
}

function snapshot(): OfficeSnapshot {
  return {
    roles: OFFICE_ROLE_ORDER.map((roleId) => ({
      roleId,
      status: "idle",
      activeCount: 0,
      queuedCount: 0,
      waitingUserCount: 0,
      failedCount: 0,
      recentItems: [],
      devices: [],
      overflowCount: 0,
      available: true,
    })),
    workItems: [],
    revision: 1,
  } as OfficeSnapshot;
}

function context(root: Container) {
  return {
    app: { screen: { width: 1200, height: 600 } } as never,
    root,
    manifest: manifest(),
    callbacks: { roleLabel: (roleId: OfficeRoleId) => roleId, statusLabel: (status: string) => status },
    loadTexture: async () => Texture.WHITE,
    viewport: { width: 1200, height: 600 },
  } as never;
}

test("layer factories expose the required z-order and seven aligned anchors", async () => {
  const root = new Container();
  const contextValue = context(root);
  const background = await createOfficeBackgroundLayer(contextValue);
  const desk = await createOfficeDeskLayer(contextValue);
  const character = await createOfficeCharacterLayer(contextValue);
  const display = await createOfficeDisplayLayer(contextValue);
  const zValues = root.children.map((child) => child.zIndex).sort((left, right) => left - right);
  assert.deepEqual(zValues, [OFFICE_LAYER_Z.background, OFFICE_LAYER_Z.deskBack, OFFICE_LAYER_Z.character, OFFICE_LAYER_Z.display, OFFICE_LAYER_Z.deskFront, OFFICE_LAYER_Z.status, OFFICE_LAYER_Z.status]);
  assert.equal(background.anchors.size, 7);
  assert.equal(desk.nodes.size, 7);
  assert.equal(character.nodes.size, 7);
  assert.equal(display.nodes.size, 7);
  assert.deepEqual([...character.nodes.get("writer")!.bones.keys()], ["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"]);
  assert.ok((background.anchors.get("ai-chat")?.y ?? 0) < (background.anchors.get("workflow-operator")?.y ?? 0));
  background.destroy();
  desk.destroy();
  character.destroy();
  display.destroy();
});
test("independent replacement keeps sibling layer object identity intact", async () => {
  const root = new Container();
  const contextValue = context(root);
  const desk = await createOfficeDeskLayer(contextValue);
  const character = await createOfficeCharacterLayer(contextValue);
  const display = await createOfficeDisplayLayer(contextValue);
  const role = "writer" as const;
  const deskNode = desk.nodes.get(role)!;
  const characterNode = character.nodes.get(role)!;
  const displayNode = display.nodes.get(role)!;
  const frontBefore = deskNode.front;
  const rigBefore = characterNode.rigRoot;
  const displayTextureBefore = displayNode.main.texture;
  character.setTexture?.(role, Texture.WHITE);
  display.setTexture?.(role, "main", Texture.WHITE);
  desk.setTexture?.(role, "available", Texture.WHITE, "back");
  assert.equal(deskNode.front, frontBefore);
  assert.equal(characterNode.rigRoot, rigBefore);
  assert.notEqual(displayNode.main.texture, displayTextureBefore);
  desk.destroy();
  character.destroy();
  display.destroy();
});
