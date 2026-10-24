import assert from "node:assert/strict";
import test from "node:test";
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { createOfficeBackgroundLayer } from "../src/virtual-office/office-background-layer";
import { createOfficeCharacterLayer, getOfficeCharacterMotionProfile, OFFICE_SEATED_ROOT_Y_FACTOR } from "../src/virtual-office/office-character-layer";
import { createOfficeDeskLayer } from "../src/virtual-office/office-desk-layer";
import { createOfficeChairLayer } from "../src/virtual-office/office-chair-layer";
import { createOfficeDisplayLayer } from "../src/virtual-office/office-display-layer";
import { OFFICE_ROLE_ORDER } from "../src/virtual-office/office-layout";
import { computeOfficeLayerAnchors, computeOfficeStageBounds, OFFICE_LAYER_Z } from "../src/virtual-office/office-layer-types";
import type { OfficeRoleId, OfficeSnapshot } from "../src/virtual-office/types";

function manifest(atlasScale = 1) {
  return {
    schemaVersion: 1,
    assets: [
      { id: "office", path: "office.webp", purpose: "background", width: 2172, height: 724, frames: ["background"] },
      { id: "characters", path: "characters.webp", purpose: "characters", width: 896 * atlasScale, height: 128 * atlasScale, frames: ["idle"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "workstations", path: "workstations.webp", purpose: "desk back", width: 896 * atlasScale, height: 288 * atlasScale, frames: ["available", "active", "offline"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "workstations-front", path: "workstations-front.webp", purpose: "desk front", width: 896 * atlasScale, height: 288 * atlasScale, frames: ["available", "active", "offline"], roleIds: [...OFFICE_ROLE_ORDER] },
      { id: "chair", path: "office-chair.png", purpose: "office chair", format: "png", width: 715, height: 1047, hasAlpha: true, frames: ["chair"] },
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

function context(root: Container, atlasScale = 1, width = 1200) {
  return {
    app: { screen: { width, height: 600 } } as never,
    root,
    manifest: manifest(atlasScale),
    callbacks: { roleLabel: (roleId: OfficeRoleId) => roleId, statusLabel: (status: string) => status },
    loadTexture: async () => Texture.WHITE,
    viewport: { width, height: 600 },
  } as never;
}

function motionRig() {
  return {
    bones: [
      { name: "root", parent: null, x: 0, y: 0, rotation: 0 },
      { name: "torso", parent: "root", x: 0, y: -0.02, rotation: 0 },
      { name: "head", parent: "torso", x: 0, y: -0.3, rotation: 0 },
    ],
    clips: {
      idle: { durationMs: 1_000, loop: true, tracks: { head: [{ t: 0, rotation: -1 }, { t: 0.5, rotation: 1 }, { t: 1, rotation: -1 }] } },
      walk: { durationMs: 900, loop: true, tracks: { root: [{ t: 0, x: -0.03 }, { t: 0.5, x: 0.03 }, { t: 1, x: -0.03 }], torso: [{ t: 0, rotation: -3 }, { t: 0.5, rotation: 3 }, { t: 1, rotation: -3 }] } },
      work: { durationMs: 1_000, loop: true, tracks: {} },
      thinking: { durationMs: 1_000, loop: true, tracks: {} },
      waiting: { durationMs: 1_000, loop: true, tracks: {} },
      completed: { durationMs: 1_000, loop: false, tracks: {} },
      error: { durationMs: 1_000, loop: false, tracks: {} },
    },
    reducedMotion: { staticPoseByClip: { idle: "idle", walk: "idle", work: "idle", thinking: "idle", waiting: "idle", completed: "idle", error: "idle" } },
  } as never;
}

function containsPixiText(node: Container): boolean {
  return node.children.some((child) => child instanceof Text || (child instanceof Container && containsPixiText(child)));
}

test("higher-density atlases preserve station sizes and seated alignment on small and large screens", async () => {
  for (const width of [360, 1200]) {
    const scenes = await Promise.all([1, 2].map(async (atlasScale) => {
      const root = new Container();
      const ctx = context(root, atlasScale, width);
      return {
        desk: await createOfficeDeskLayer(ctx),
        character: await createOfficeCharacterLayer(ctx),
        chair: await createOfficeChairLayer(ctx),
      };
    }));
    try {
      for (const role of OFFICE_ROLE_ORDER) {
        for (const layer of ["desk", "character", "chair"] as const) {
          const normal = scenes[0][layer].nodes.get(role)!;
          const dense = scenes[1][layer].nodes.get(role)!;
          assert.deepEqual([dense.root.x, dense.root.y], [normal.root.x, normal.root.y], `${layer} anchor changed at ${width}px`);
        }
        for (const part of ["back", "front"] as const) {
          const normal = scenes[0].desk.nodes.get(role)![part];
          const dense = scenes[1].desk.nodes.get(role)![part];
          assert.equal(dense.width, normal.width, `desk ${part} grew with atlas density`);
          assert.equal(dense.height, normal.height);
        }
        assert.equal(scenes[1].character.nodes.get(role)!.characterHeight, scenes[0].character.nodes.get(role)!.characterHeight);
        assert.equal(scenes[1].chair.nodes.get(role)!.art.height, scenes[0].chair.nodes.get(role)!.art.height);
      }
    } finally {
      for (const scene of scenes) for (const layer of Object.values(scene)) layer.destroy();
    }
  }
});

test("layer factories expose the required z-order and seven aligned anchors", async () => {
  const root = new Container();
  const contextValue = context(root);
  const background = await createOfficeBackgroundLayer(contextValue);
  const desk = await createOfficeDeskLayer(contextValue);
  const chair = await createOfficeChairLayer(contextValue);
  const character = await createOfficeCharacterLayer(contextValue);
  const display = await createOfficeDisplayLayer(contextValue);
  const zValues = root.children.map((child) => child.zIndex).sort((left, right) => left - right);
  assert.deepEqual(zValues, [OFFICE_LAYER_Z.background, OFFICE_LAYER_Z.deskBack, OFFICE_LAYER_Z.display, OFFICE_LAYER_Z.deskFront, OFFICE_LAYER_Z.character, OFFICE_LAYER_Z.chair, OFFICE_LAYER_Z.chairFront, OFFICE_LAYER_Z.status, OFFICE_LAYER_Z.status]);
  assert.ok(OFFICE_LAYER_Z.deskBack < OFFICE_LAYER_Z.display);
  assert.ok(OFFICE_LAYER_Z.display < OFFICE_LAYER_Z.deskFront);
  assert.ok(OFFICE_LAYER_Z.deskFront < OFFICE_LAYER_Z.character);
  assert.ok(OFFICE_LAYER_Z.character < OFFICE_LAYER_Z.chair);
  assert.ok(OFFICE_LAYER_Z.character < OFFICE_LAYER_Z.chairFront);
  assert.ok(OFFICE_LAYER_Z.deskFront < OFFICE_LAYER_Z.chairFront);
  assert.ok(OFFICE_LAYER_Z.deskFront < OFFICE_LAYER_Z.status);
  assert.equal(background.anchors.size, 7);
  assert.deepEqual(background.bounds, computeOfficeStageBounds({ width: 1_200, height: 600 }));
  assert.equal(background.sprite?.visible, false);
  assert.equal(desk.nodes.size, 7);
  assert.equal(chair.nodes.size, 7);
  assert.equal(character.nodes.size, 7);
  assert.equal(display.nodes.size, 7);
  assert.equal(typeof display.tick, "function");
  assert.ok(display.nodes.get("writer")!.screenUi instanceof Graphics);
  assert.ok(chair.nodes.get("writer")!.art instanceof Sprite);
  assert.ok(chair.nodes.get("writer")!.occlusion instanceof Graphics);
  chair.update(snapshot());
  const chairNode = chair.nodes.get("writer")!;
  assert.ok(chairNode.root.visible);
  assert.ok(chairNode.rear instanceof Sprite);
  assert.ok(chairNode.art.width > 0);
  assert.ok(chairNode.art.height > 0);
  assert.ok(chairNode.rear.height >= chairNode.art.height);
  assert.equal(chairNode.art.parent?.parent?.zIndex, OFFICE_LAYER_Z.chairFront);
  assert.equal(chairNode.rear.parent?.parent?.zIndex, OFFICE_LAYER_Z.chair);
  assert.ok((chairNode.rear.parent?.position.y ?? 0) > (chairNode.art.parent?.position.y ?? 0));
  assert.ok(chairNode.occlusion.getLocalBounds().width < chairNode.art.width);
  // The foreground chair can cover the torso, but its cushion edge must stay
  // slim; the backrest, rather than a broad desk panel, supplies the seated
  // occlusion.
  const cushionBounds = chairNode.occlusion.getLocalBounds();
  assert.ok(cushionBounds.height > chairNode.art.height * 0.06);
  assert.ok(cushionBounds.height < chairNode.art.height * 0.2);
  assert.ok(cushionBounds.y < -6);
  assert.equal(chairNode.occlusion.parent?.parent?.zIndex, OFFICE_LAYER_Z.chairFront);
  assert.ok(OFFICE_LAYER_Z.deskFront < OFFICE_LAYER_Z.character);
  display.update(snapshot());
  assert.equal(display.nodes.get("writer")!.visualState, "idle");
  assert.ok(display.nodes.get("writer")!.screenUi.getBounds().width > 0);
  assert.equal(containsPixiText(root), false);
  const writerNode = character.nodes.get("writer")!;
  assert.deepEqual([...writerNode.bones.keys()], ["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"]);
  assert.equal(writerNode.character, writerNode.body);
  assert.notEqual(writerNode.body, writerNode.head);
  assert.notEqual(writerNode.body.texture.frame.y, writerNode.head.texture.frame.y);
  assert.ok(writerNode.characterHeight > writerNode.body.height);
  assert.equal(writerNode.body.parent, writerNode.bones.get("torso"));
  assert.equal(writerNode.head.parent, writerNode.bones.get("head"));
  const torsoRotationBeforeHeadTurn = writerNode.bones.get("torso")!.rotation;
  const bodyRotationBeforeHeadTurn = writerNode.body.rotation;
  const headRotationBeforeHeadTurn = writerNode.head.rotation;
  writerNode.bones.get("head")!.rotation += 0.2;
  assert.notEqual(writerNode.bones.get("head")!.rotation, 0);
  assert.equal(writerNode.bones.get("torso")!.rotation, torsoRotationBeforeHeadTurn);
  assert.equal(writerNode.body.rotation, bodyRotationBeforeHeadTurn);
  assert.equal(writerNode.head.rotation, headRotationBeforeHeadTurn);
  assert.equal(background.anchors.get("ai-chat")?.y, background.anchors.get("workflow-operator")?.y);
  assert.ok((background.anchors.get("ai-chat")?.y ?? 0) < (background.anchors.get("writer")?.y ?? 0));
  background.destroy();
  desk.destroy();
  character.destroy();
  display.destroy();
  chair.destroy();
});
test("independent replacement keeps sibling layer object identity intact", async () => {
  const root = new Container();
  const contextValue = context(root);
  const desk = await createOfficeDeskLayer(contextValue);
  const chair = await createOfficeChairLayer(contextValue);
  const character = await createOfficeCharacterLayer(contextValue);
  const display = await createOfficeDisplayLayer(contextValue);
  const role = "writer" as const;
  const deskNode = desk.nodes.get(role)!;
  const characterNode = character.nodes.get(role)!;
  const displayNode = display.nodes.get(role)!;
  const frontBefore = deskNode.front;
  const rigBefore = characterNode.rigRoot;
  const displayTextureBefore = displayNode.main.texture;
  const characterBodyBefore = characterNode.body.texture;
  const characterHeadBefore = characterNode.head.texture;
  character.setTexture?.(role, Texture.WHITE);
  display.setTexture?.(role, "main", Texture.WHITE);
  desk.setTexture?.(role, "available", Texture.WHITE, "back");
  assert.equal(deskNode.front, frontBefore);
  assert.equal(characterNode.rigRoot, rigBefore);
  assert.notEqual(characterNode.body.texture, characterBodyBefore);
  assert.notEqual(characterNode.head.texture, characterHeadBefore);
  assert.notEqual(displayNode.main.texture, displayTextureBefore);
  desk.destroy();
  character.destroy();
  display.destroy();
  chair.destroy();
});

test("screen chrome follows the projected work state", async () => {
  const root = new Container();
  const display = await createOfficeDisplayLayer(context(root));
  const idle = snapshot();
  display.update(idle);
  const node = display.nodes.get("ai-chat")!;
  const idlePanelWidth = node.screenUi.getBounds().width;
  const running: OfficeSnapshot = {
    ...idle,
    revision: idle.revision + 1,
    roles: idle.roles.map((role) => role.roleId === "ai-chat" ? { ...role, status: "running", activeCount: 1 } : role),
  };
  display.update(running);
  assert.ok(node.visualState === "work" || node.visualState === "thinking");
  assert.ok(node.screenUi.getBounds().width > 0);
  assert.ok(node.screenUi.getBounds().width > idlePanelWidth);
  assert.equal(containsPixiText(root), false);
  display.destroy();
});

test("character motion is seated, role-offset, and reduced-motion safe", async () => {
  const profiles = OFFICE_ROLE_ORDER.map(getOfficeCharacterMotionProfile);
  assert.equal(new Set(profiles.map((profile) => profile.walkDirection)).size, 2);
  assert.equal(new Set(profiles.map((profile) => profile.phaseOffsetMs)).size, OFFICE_ROLE_ORDER.length);
  let clock = 0;
  const root = new Container();
  const baseContext = context(root) as unknown as Record<string, unknown>;
  const character = await createOfficeCharacterLayer({ ...baseContext, now: () => clock, rig: motionRig() } as never);
  const idle = snapshot();
  character.update(idle);
  assert.equal(character.nodes.get("ai-chat")!.visualState, "idle");
  const idleHeadAtStart = character.nodes.get("ai-chat")!.bones.get("head")!.rotation;
  const idleTorsoAtStart = character.nodes.get("ai-chat")!.bones.get("torso")!.rotation;
  const seatedRootY = character.nodes.get("ai-chat")!.root.position.y;
  clock = 500;
  character.update(idle);
  const idleHeadLater = character.nodes.get("ai-chat")!.bones.get("head")!.rotation;
  const idleTorsoLater = character.nodes.get("ai-chat")!.bones.get("torso")!.rotation;
  assert.notEqual(idleHeadLater, idleHeadAtStart);
  assert.equal(idleTorsoLater, idleTorsoAtStart);
  const stageBounds = computeOfficeStageBounds({ width: 1_200, height: 600 });
  const seatedAnchor = computeOfficeLayerAnchors(stageBounds).get("ai-chat")!;
  assert.equal(seatedRootY, seatedAnchor.y + character.nodes.get("ai-chat")!.characterHeight * OFFICE_SEATED_ROOT_Y_FACTOR);

  const unavailable: OfficeSnapshot = {
    ...idle,
    roles: idle.roles.map((role, index) => index < 2 ? { ...role, status: "offline", available: false } : role),
  };
  character.update(unavailable);
  clock = 1_000;
  const availableAgain: OfficeSnapshot = {
    ...idle,
    roles: idle.roles.map((role, index) => index < 2 ? { ...role, status: "idle", available: true } : role),
  };
  character.update(availableAgain);
  const evenWalkX = character.nodes.get("ai-chat")!.bones.get("root")!.position.x;
  const oddWalkX = character.nodes.get("agent-center")!.bones.get("root")!.position.x;
  assert.ok(Math.sign(evenWalkX) !== Math.sign(oddWalkX));

  character.setReducedMotion?.(true);
  clock = 1_400;
  character.update(idle);
  const reducedHeadAtStart = character.nodes.get("ai-chat")!.bones.get("head")!.rotation;
  clock = 1_900;
  character.update(idle);
  const reducedHeadLater = character.nodes.get("ai-chat")!.bones.get("head")!.rotation;
  assert.equal(reducedHeadLater, reducedHeadAtStart);
  character.destroy();
});
