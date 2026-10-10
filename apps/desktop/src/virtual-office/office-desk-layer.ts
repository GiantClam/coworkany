import { Container, Sprite, type Texture } from "pixi.js";
import type { OfficeRoleId, OfficeRoleState, OfficeSnapshot } from "./types";
import { OFFICE_ROLE_ORDER } from "./office-layout";
import {
  OFFICE_LAYER_Z,
  type OfficeDeskLayerHandle,
  type OfficeDeskLayerNode,
  type OfficeDeskVariant,
  type OfficeLayerContext,
  computeOfficeContainedBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  reportOfficeLayerError,
} from "./office-layer-types";
import { createRoleTexture } from "./office-layer-assets";

export type { OfficeDeskLayerHandle, OfficeDeskLayerNode, OfficeDeskVariant, OfficeLayerContext, OfficeLayerHandle } from "./office-layer-types";

const VARIANTS: readonly OfficeDeskVariant[] = ["available", "active", "offline"];

function deskVariantForState(state: OfficeRoleState | undefined): OfficeDeskVariant {
  if (!state || !state.available || state.status === "offline") return "offline";
  if (state.status === "queued" || state.status === "running" || state.status === "waiting" || state.activeCount > 0 || state.waitingUserCount > 0) return "active";
  return "available";
}
function sourceOf(texture: Texture): import("pixi.js").TextureSource {
  return texture.source;
}

function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  const office = findOfficeAssetEntry(context.manifest, "office");
  return computeOfficeContainedBounds(viewport, office?.width ?? viewport.width, office?.height ?? viewport.height);
}

function roleSize(texture: Texture, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, texture.width || 128);
  const height = Math.max(1, texture.height || 96);
  const scale = Math.min(1, maxWidth / width);
  return { width: width * scale, height: height * scale };
}

/** Render the independently replaceable desk shell and front-edge overlays. */
export async function createOfficeDeskLayer(context: OfficeLayerContext): Promise<OfficeDeskLayerHandle> {
  const layerRoot = new Container();
  layerRoot.label = "virtual-office-desk-back";
  layerRoot.zIndex = OFFICE_LAYER_Z.deskBack;
  const frontRoot = new Container();
  frontRoot.label = "virtual-office-desk-front";
  frontRoot.zIndex = OFFICE_LAYER_Z.deskFront;
  context.root.sortableChildren = true;
  context.root.addChild(layerRoot, frontRoot);

  const backAsset = findOfficeAssetEntry(context.manifest, "workstations");
  const frontAsset = findOfficeAssetEntry(context.manifest, "workstations-front") ?? backAsset;
  if (!backAsset) {
    const error = new Error("Virtual office workstation asset is missing from the manifest");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(frontRoot);
    throw error;
  }

  let backTexture: Texture;
  let frontTexture: Texture;
  try {
    [backTexture, frontTexture] = await Promise.all([
      loadOfficeTexture(context, backAsset.path),
      loadOfficeTexture(context, frontAsset?.path ?? backAsset.path),
    ]);
  } catch (error) {
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(frontRoot);
    throw error;
  }

  const nodes = new Map<OfficeRoleId, OfficeDeskLayerNode>();
  const variantTextures = new Map<OfficeRoleId, Record<OfficeDeskVariant, { back: Texture; front: Texture }>>();
  const roleIndex = (roleId: OfficeRoleId) => Math.max(0, OFFICE_ROLE_ORDER.indexOf(roleId));
  const makeRoleTextures = (roleId: OfficeRoleId) => {
    const index = roleIndex(roleId);
    const textures = {} as Record<OfficeDeskVariant, { back: Texture; front: Texture }>;
    VARIANTS.forEach((variant, variantIndex) => {
      const state = variant;
      textures[variant] = {
        back: createRoleTexture(sourceOf(backTexture), backAsset, roleId, index, state, variantIndex),
        front: createRoleTexture(sourceOf(frontTexture), frontAsset, roleId, index, state, variantIndex),
      };
    });
    return textures;
  };

  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
    const textures = makeRoleTextures(roleId);
    variantTextures.set(roleId, textures);
    const roleRoot = new Container();
    roleRoot.label = `virtual-office-desk:${roleId}`;
    roleRoot.zIndex = index;
    const back = new Sprite(textures.available.back);
    back.anchor.set(0.5, 1);
    roleRoot.addChild(back);
    layerRoot.addChild(roleRoot);

    const frontRoleRoot = new Container();
    frontRoleRoot.label = `virtual-office-desk-front:${roleId}`;
    frontRoleRoot.zIndex = index;
    const front = new Sprite(textures.available.front);
    front.anchor.set(0.5, 1);
    frontRoleRoot.addChild(front);
    frontRoot.addChild(frontRoleRoot);

    const node: OfficeDeskLayerNode = { root: roleRoot, back, front, variants: textures, roleId, variant: "available" };
    // The front root is intentionally non-enumerable from the public node API;
    // it remains independently replaceable while preserving the shared role
    // identity exposed to scene tests.
    Object.defineProperty(node, "frontRoot", { value: frontRoleRoot, enumerable: false });
    nodes.set(roleId, node);
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const viewport = getOfficeViewport(context);
    const maxWidth = Math.max(56, Math.min(190, (viewport.width / OFFICE_ROLE_ORDER.length) * 0.92));
    for (const roleId of OFFICE_ROLE_ORDER) {
      const node = nodes.get(roleId);
      if (!node) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      const backSize = roleSize(node.back.texture, maxWidth);
      node.root.position.set(anchor.x, anchor.y);
      node.back.width = backSize.width;
      node.back.height = backSize.height;
      const frontRoot = (node as OfficeDeskLayerNode & { frontRoot?: Container }).frontRoot;
      if (frontRoot) {
        frontRoot.position.set(anchor.x, anchor.y);
        const frontSize = roleSize(node.front.texture, maxWidth);
        node.front.width = frontSize.width;
        node.front.height = frontSize.height;
      }
    }
  };
  resize();

  const applyVariant = (roleId: OfficeRoleId, variant: OfficeDeskVariant) => {
    const node = nodes.get(roleId);
    const textures = variantTextures.get(roleId)?.[variant];
    if (!node || !textures) return;
    node.variant = variant;
    node.back.texture = textures.back;
    node.front.texture = textures.front;
    resize();
  };

  return {
    root: layerRoot,
    frontRoot,
    nodes,
    setTexture(roleId, variant, texture, target = "both") {
      const roleTextures = variantTextures.get(roleId);
      if (!roleTextures) return;
      if (target === "back" || target === "both") roleTextures[variant].back = texture;
      if (target === "front" || target === "both") roleTextures[variant].front = texture;
      if (nodes.get(roleId)?.variant === variant) applyVariant(roleId, variant);
    },
    update(snapshot: OfficeSnapshot) {
      resize();
      const stateByRole = new Map(snapshot.roles.map((state) => [state.roleId, state]));
      for (const roleId of OFFICE_ROLE_ORDER) {
        const node = nodes.get(roleId);
        if (!node) continue;
        const state = stateByRole.get(roleId);
        node.root.visible = Boolean(state);
        const frontRoot = (node as OfficeDeskLayerNode & { frontRoot?: Container }).frontRoot;
        if (frontRoot) frontRoot.visible = Boolean(state);
        if (state) applyVariant(roleId, deskVariantForState(state));
      }
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(frontRoot);
    },
  };
}
