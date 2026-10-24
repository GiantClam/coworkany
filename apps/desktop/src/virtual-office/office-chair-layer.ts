import { Container, Graphics, Rectangle, Sprite, Texture, type TextureSource } from "pixi.js";
import type { OfficeRoleState, OfficeSnapshot } from "./types";
import { OFFICE_ROLE_COLUMNS, OFFICE_ROLE_ORDER } from "./office-layout";
import {
  OFFICE_LAYER_Z,
  type OfficeChairLayerHandle,
  type OfficeChairLayerNode,
  type OfficeLayerContext,
  computeOfficeStageBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  reportOfficeLayerError,
} from "./office-layer-types";

export type { OfficeChairLayerHandle, OfficeChairLayerNode, OfficeLayerContext, OfficeLayerHandle } from "./office-layer-types";

/** The approved chair is a single transparent PNG shared by every station. */
const CHAIR_ASSET_ID = "chair";
const CHAIR_ASPECT_FALLBACK = 715 / 1_047;
const CHAIR_SEAT_COLOR = 0xe9e1d2;
const CHAIR_SEAT_EDGE = 0x67747a;
// The approved chair is deliberately subordinate to the character silhouette:
// retain roughly two thirds of the previous full-chair fit so the workstation
// reads first and the furniture still remains fully visible.
const CHAIR_SCALE = 2 / 3;
const CHAIR_HEIGHT_TO_CHARACTER_RATIO = 0.98;
const CHAIR_MIN_HEIGHT = 28;
const CHAIR_MAX_HEIGHT = 60;
// Lift the complete chair as one unit so the foreground backrest reaches the
// lower edge of the rear-view hair without separating it from the seat/base.
const CHAIR_VERTICAL_LIFT_RATIO = 0.14;
// The source chair is a single approved illustration. These source-space
// cuts keep the lower seat/base as one complete furniture layer while the
// backrest itself is deliberately brought to the foreground. The small
// overlap hides any seam.
const CHAIR_BACKREST_HEIGHT_RATIO = 0.5;
const CHAIR_REAR_START_RATIO = 0.46;

interface ChairTextures {
  readonly backrest: Texture;
  readonly rear: Texture;
  readonly width: number;
  readonly height: number;
  readonly derived: boolean;
}

function textureSourceSize(texture: Texture, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
  const source = texture.source as TextureSource & { width?: number; height?: number };
  return {
    width: Math.max(1, Math.round(source.width ?? texture.width ?? fallbackWidth)),
    height: Math.max(1, Math.round(source.height ?? texture.height ?? fallbackHeight)),
  };
}

function splitChairTexture(texture: Texture, fallbackWidth: number, fallbackHeight: number): ChairTextures {
  const { width, height } = textureSourceSize(texture, fallbackWidth, fallbackHeight);
  // A deterministic 1×1 test texture cannot support the production crop;
  // keeping it whole makes unit tests and host adapters safe while the real
  // manifest texture uses the two explicit source-space frames below.
  if (width < 4 || height < 4) return { backrest: texture, rear: texture, width, height, derived: false };
  const backHeight = Math.max(1, Math.min(height, Math.round(height * CHAIR_BACKREST_HEIGHT_RATIO)));
  const rearStart = Math.max(0, Math.min(backHeight, Math.round(height * CHAIR_REAR_START_RATIO)));
  return {
    backrest: new Texture({ source: texture.source, frame: new Rectangle(0, 0, width, backHeight) }),
    rear: new Texture({ source: texture.source, frame: new Rectangle(0, rearStart, width, height - rearStart) }),
    width,
    height,
    derived: true,
  };
}

function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  return computeOfficeStageBounds(viewport);
}

function deskScale(context: OfficeLayerContext): number {
  const viewport = getOfficeViewport(context);
  const maxWidth = Math.max(36, Math.min(190, (viewport.width / OFFICE_ROLE_COLUMNS) * 0.9));
  return Math.min(1, maxWidth / 128);
}

function chairDimensions(texture: Texture, context: OfficeLayerContext): { width: number; height: number } {
  const sourceWidth = Math.max(1, texture.width || 715);
  const sourceHeight = Math.max(1, texture.height || 1_047);
  const sourceAspect = sourceWidth / sourceHeight || CHAIR_ASPECT_FALLBACK;
  const viewport = getOfficeViewport(context);
  // Match the complete chair to the chibi figure rather than sizing it from
  // the backrest alone. The earlier fit made the backrest readable but pushed
  // the seat, column, and casters behind the workstation; keeping the full
  // chair just under one character height makes every component visible.
  const characterWidth = Math.max(30, Math.min(100, (viewport.width / OFFICE_ROLE_COLUMNS) * 0.54));
  const targetHeight = Math.max(
    CHAIR_MIN_HEIGHT,
    Math.min(CHAIR_MAX_HEIGHT, characterWidth * CHAIR_HEIGHT_TO_CHARACTER_RATIO * CHAIR_SCALE),
  );
  return { width: targetHeight * sourceAspect, height: targetHeight };
}

function drawOcclusion(node: OfficeChairLayerNode, width: number, height: number): void {
  // The workstation-front atlas does the main lower-body masking. This very
  // slim seat edge only bridges the hips to the chair cushion; keeping it
  // below the torso prevents the old "panel in front of the person" effect.
  const occlusion = node.occlusion;
  occlusion.clear();
  const radiusX = width * 0.38;
  const radiusY = Math.max(1.5, height * 0.045);
  const centerY = -height * 0.445;
  occlusion.ellipse(0, centerY, radiusX, radiusY).fill({ color: CHAIR_SEAT_COLOR, alpha: 0.82 });
  occlusion.ellipse(0, centerY, radiusX, radiusY).stroke({ color: CHAIR_SEAT_EDGE, alpha: 0.62, width: Math.max(1, width * 0.018) });
  occlusion.ellipse(0, centerY - radiusY * 0.35, radiusX * 0.68, Math.max(0.7, radiusY * 0.24)).fill({ color: 0xffffff, alpha: 0.2 });
}

/**
 * Render independent approved PNG chairs plus a slim foreground cushion edge.
 *
 * Loading is asynchronous by design: the scene keeps its canvas hidden until
 * all replaceable image layers have decoded, so a partially built studio is
 * never shown to the user.
 */
export async function createOfficeChairLayer(context: OfficeLayerContext): Promise<OfficeChairLayerHandle> {
  const layerRoot = new Container();
  layerRoot.label = "virtual-office-chairs";
  // The seat/base must sit above the desk front so the complete chair is
  // visible, while the separate backrest root remains the final furniture
  // occluder over the character torso.
  layerRoot.zIndex = OFFICE_LAYER_Z.chair;
  const frontRoot = new Container();
  frontRoot.label = "virtual-office-chair-occlusion";
  frontRoot.zIndex = OFFICE_LAYER_Z.chairFront;
  context.root.sortableChildren = true;
  context.root.addChild(layerRoot, frontRoot);

  const asset = findOfficeAssetEntry(context.manifest, CHAIR_ASSET_ID) ?? findOfficeAssetEntry(context.manifest, "office-chair");
  if (!asset) {
    const error = new Error("Virtual office chair asset is missing from the manifest");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(frontRoot);
    throw error;
  }

  let texture: Texture;
  try {
    texture = await loadOfficeTexture(context, asset.path);
  } catch (error) {
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(frontRoot);
    throw error;
  }

  const chairTextures = splitChairTexture(texture, asset.width ?? 715, asset.height ?? 1_047);

  const nodes = new Map<OfficeRoleState["roleId"], OfficeChairLayerNode>();
  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
    const root = new Container();
    root.label = `virtual-office-chair:${roleId}`;
    root.zIndex = index;
    const rear = new Sprite(chairTextures.rear);
    rear.label = `virtual-office-chair-png-rear:${roleId}`;
    rear.anchor.set(0.5, 1);
    root.addChild(rear);
    layerRoot.addChild(root);

    const frontRoleRoot = new Container();
    frontRoleRoot.label = `virtual-office-chair-occlusion:${roleId}`;
    frontRoleRoot.zIndex = index;
    const art = new Sprite(chairTextures.backrest);
    art.label = `virtual-office-chair-png-backrest:${roleId}`;
    // The cropped backrest is brought forward but seated at the role's hip
    // line. Keeping its top at half the full chair height leaves the head
    // fully readable while the foreground backrest covers the lower torso.
    art.anchor.set(0.5, 0);
    frontRoleRoot.addChild(art);
    const occlusion = new Graphics();
    frontRoleRoot.addChild(occlusion);
    frontRoot.addChild(frontRoleRoot);

    const node: OfficeChairLayerNode = { root, rear, art, occlusion, roleId };
    Object.defineProperty(node, "frontRoot", { value: frontRoleRoot, enumerable: false });
    nodes.set(roleId, node);
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const { width, height } = chairDimensions(texture, context);
    const scale = Math.min(1, deskScale(context) * 1.05);
    // Keep each complete chair within its responsive grid station.
    const fittedWidth = Math.min(width, Math.max(18, width * (0.94 + scale * 0.06)));
    const fittedHeight = fittedWidth / Math.max(0.0001, width / height);
    const chairLift = fittedHeight * CHAIR_VERTICAL_LIFT_RATIO;
    for (const roleId of OFFICE_ROLE_ORDER) {
      const node = nodes.get(roleId);
      if (!node) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      // The rear crop starts at source y=46%. Its bottom therefore needs to
      // sit roughly half a full-chair height below the hip line; anchoring it
      // at the hip line made the seat, column, and casters sit underneath the
      // foreground backrest and look as if they were missing.
      node.root.position.set(anchor.x, anchor.y + fittedHeight * 0.5 + scale * 2 - chairLift);
      node.rear.width = fittedWidth;
      node.rear.height = fittedHeight * (chairTextures.rear.height / Math.max(1, chairTextures.height));
      node.art.width = fittedWidth;
      node.art.height = fittedHeight * (chairTextures.backrest.height / Math.max(1, chairTextures.height));
      node.art.position.set(0, -fittedHeight * 0.5);
      const frontRoleRoot = (node as OfficeChairLayerNode & { frontRoot?: Container }).frontRoot;
      frontRoleRoot?.position.set(anchor.x, anchor.y + scale * 2 - chairLift);
      drawOcclusion(node, fittedWidth, fittedHeight);
    }
  };
  resize();

  return {
    root: layerRoot,
    frontRoot,
    nodes,
    update(snapshot: OfficeSnapshot) {
      resize();
      const stateByRole = new Map(snapshot.roles.map((state) => [state.roleId, state]));
      for (const roleId of OFFICE_ROLE_ORDER) {
        const visible = Boolean(stateByRole.get(roleId));
        const node = nodes.get(roleId);
        if (!node) continue;
        node.root.visible = visible;
        const frontRoleRoot = (node as OfficeChairLayerNode & { frontRoot?: Container }).frontRoot;
        if (frontRoleRoot) frontRoleRoot.visible = visible;
      }
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(frontRoot);
      if (chairTextures.derived) {
        try {
          chairTextures.backrest.destroy(false);
          chairTextures.rear.destroy(false);
        } catch {
          // Pixi may already have torn down the renderer during navigation.
        }
      }
    },
  };
}
