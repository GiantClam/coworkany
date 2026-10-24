import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import type { OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeVisualState } from "./types";
import { OFFICE_ROLE_COLUMNS, OFFICE_ROLE_ORDER } from "./office-layout";
import { resolveOfficeVisualPhase } from "./visual-state";
import {
  OFFICE_LAYER_Z,
  type OfficeDisplayLayerHandle,
  type OfficeDisplayLayerNode,
  type OfficeLayerContext,
  computeOfficeStageBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  reportOfficeLayerError,
} from "./office-layer-types";
import { createNamedTexture } from "./office-layer-assets";

export type { OfficeDisplayLayerHandle, OfficeDisplayLayerNode, OfficeLayerContext, OfficeLayerHandle } from "./office-layer-types";

const STATUS_COLORS: Readonly<Record<OfficeVisualState, number>> = {
  idle: 0x72b89a,
  walk: 0x63b9e8,
  work: 0x42c7b3,
  thinking: 0xb795e8,
  waiting: 0xf2b35a,
  completed: 0x62c98b,
  error: 0xe47878,
  offline: 0x9b9b9b,
};

const SCREEN_PANEL_WIDTH_FACTOR = 0.56;
const SCREEN_PANEL_HEIGHT_FACTOR = 0.32;

function sourceOf(texture: Texture): import("pixi.js").TextureSource {
  return texture.source;
}
function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  return computeOfficeStageBounds(viewport);
}

function displayTextures(source: import("pixi.js").TextureSource, asset: ReturnType<typeof findOfficeAssetEntry>): { main: Texture; side: Texture } {
  const width = asset?.width ?? 1536;
  const height = asset?.height ?? 1024;
  return {
    main: createNamedTexture(source, asset, "main-front", new Rectangle(0, 0, width / 2, height / 2)),
    side: createNamedTexture(source, asset, "side-angle", new Rectangle(width / 2, 0, width / 2, height / 2)),
  };
}

function visualStateFor(state: OfficeRoleState | undefined, phaseMs: number, previous: OfficeVisualState | undefined, phaseOffset: number, reducedMotion: boolean): OfficeVisualState {
  if (!state) return "offline";
  return resolveOfficeVisualPhase(state, phaseMs, previous, reducedMotion ? 0 : phaseOffset);
}

function screenProgress(visualState: OfficeVisualState, phaseMs: number, phaseOffset: number, reducedMotion: boolean): number {
  if (visualState === "completed") return 1;
  if (visualState === "error") return 0.18;
  if (visualState === "offline") return 0.08;
  if (visualState === "idle") return 0.28;
  if (visualState === "waiting") return 0.66;
  if (visualState === "walk") return 0.48;
  if (reducedMotion) return visualState === "thinking" ? 0.58 : 0.72;
  const pulse = 0.5 + 0.5 * Math.sin((phaseMs + phaseOffset) / 420);
  return visualState === "thinking" ? 0.38 + pulse * 0.24 : 0.52 + pulse * 0.4;
}

function screenUiScale(visualState: OfficeVisualState): number {
  if (visualState === "work" || visualState === "thinking" || visualState === "walk") return 1.5;
  if (visualState === "waiting") return 1.15;
  return 1;
}

/** Render the independently replaceable dual-display and status-glow layer. */
export async function createOfficeDisplayLayer(context: OfficeLayerContext): Promise<OfficeDisplayLayerHandle> {
  const layerRoot = new Container();
  layerRoot.label = "virtual-office-displays";
  layerRoot.zIndex = OFFICE_LAYER_Z.display;
  const statusRoot = new Container();
  statusRoot.label = "virtual-office-status";
  statusRoot.zIndex = OFFICE_LAYER_Z.status;
  context.root.sortableChildren = true;
  context.root.addChild(layerRoot, statusRoot);

  const asset = findOfficeAssetEntry(context.manifest, "displays");
  if (!asset) {
    const error = new Error("Virtual office display asset is missing from the manifest");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(statusRoot);
    throw error;
  }
  let sourceTexture: Texture;
  try {
    sourceTexture = await loadOfficeTexture(context, asset.path);
  } catch (error) {
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(statusRoot);
    throw error;
  }
  const source = sourceOf(sourceTexture);
  const textures = displayTextures(source, asset);
  const nodes = new Map<OfficeRoleId, OfficeDisplayLayerNode>();
  const previousStates = new Map<OfficeRoleId, OfficeVisualState>();
  const statusRoots = new Map<OfficeRoleId, Container>();
  let reducedMotion = context.reducedMotion === true;
  const now = context.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
    const root = new Container();
    root.label = `virtual-office-display:${roleId}`;
    root.zIndex = index;
    const main = new Sprite(textures.main);
    const side = new Sprite(textures.side);
    main.anchor.set(0.5, 1);
    side.anchor.set(0.5, 1);
    root.addChild(main, side);
    layerRoot.addChild(root);

    const roleStatusRoot = new Container();
    roleStatusRoot.label = `virtual-office-status:${roleId}`;
    roleStatusRoot.zIndex = index;
    const status = new Graphics();
    const screenUi = new Graphics();
    // The main display remains behind the character.  This compact chrome is
    // intentionally in the shared status layer so the work state stays
    // legible even when the character torso occludes the screen artwork.
    roleStatusRoot.addChild(screenUi, status);
    statusRoot.addChild(roleStatusRoot);
    statusRoots.set(roleId, roleStatusRoot);

    nodes.set(roleId, { root, main, side, status, screenUi, roleId, visualState: "idle" });
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const viewport = getOfficeViewport(context);
    const slotWidth = Math.max(40, Math.min(180, (viewport.width / OFFICE_ROLE_COLUMNS) * 0.9));
    const displayWidth = Math.min(slotWidth * 0.48, 86);
    for (const roleId of OFFICE_ROLE_ORDER) {
      const node = nodes.get(roleId);
      const statusNode = statusRoots.get(roleId);
      if (!node || !statusNode) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      const displayHeight = displayWidth * 0.68;
      node.root.position.set(anchor.x, anchor.y - Math.max(34, displayHeight * 0.92));
      node.main.width = displayWidth;
      node.main.height = displayHeight;
      node.main.position.set(-displayWidth * 0.16, 0);
      node.side.width = displayWidth * 0.58;
      node.side.height = displayHeight * 0.72;
      node.side.position.set(displayWidth * 0.28, -displayHeight * 0.02);
      const displayRootOffsetY = -Math.max(34, displayHeight * 0.92);
      const panelX = -displayWidth * 0.30;
      const panelY = -displayHeight * 0.88;
      // `statusNode` is anchored at the workstation, so include the display
      // root offset when placing the screen chrome inside the monitor bounds.
      node.screenUi.position.set(panelX, displayRootOffsetY + panelY);
      // Keep the status layer in the station coordinate system.  Its children
      // are positioned relative to the same anchor as the desk and display.
      statusNode.position.set(anchor.x, anchor.y);
      node.status.position.set(displayWidth * 0.34, -Math.max(38, displayHeight * 1.06));
    }
  };
  resize();

  const drawScreenUi = (node: OfficeDisplayLayerNode, visualState: OfficeVisualState, phaseMs: number) => {
    const displayWidth = Math.max(1, node.main.width);
    const displayHeight = Math.max(1, node.main.height);
    const panelWidth = Math.max(18, displayWidth * SCREEN_PANEL_WIDTH_FACTOR);
    const panelHeight = Math.max(9, displayHeight * SCREEN_PANEL_HEIGHT_FACTOR);
    const progress = screenProgress(visualState, phaseMs, OFFICE_ROLE_ORDER.indexOf(node.roleId) * 137, reducedMotion);
    const color = STATUS_COLORS[visualState];
    const lineColor = visualState === "offline" ? 0x6f7b78 : 0x2d5f6e;
    node.screenUi.scale.set(screenUiScale(visualState));
    node.screenUi.clear();
    node.screenUi.roundRect(0, 0, panelWidth, panelHeight, 2).fill({ color: 0xf5fbf8, alpha: 0.82 });
    node.screenUi.roundRect(2, 2, Math.max(2, (panelWidth - 4) * progress), 1.8, 0.9).fill({ color, alpha: 0.98 });
    node.screenUi.roundRect(2, panelHeight - 3.8, panelWidth * 0.22, 1.2, 0.6).fill({ color: lineColor, alpha: 0.46 });
    node.screenUi.roundRect(panelWidth * 0.28, panelHeight - 3.8, panelWidth * 0.34, 1.2, 0.6).fill({ color: lineColor, alpha: 0.32 });
    node.screenUi.roundRect(panelWidth * 0.66, panelHeight - 3.8, panelWidth * 0.25, 1.2, 0.6).fill({ color: lineColor, alpha: 0.24 });
  };

  const applyStatus = (roleId: OfficeRoleId, visualState: OfficeVisualState, phaseMs: number) => {
    const node = nodes.get(roleId);
    const statusNode = statusRoots.get(roleId);
    if (!node || !statusNode) return;
    node.visualState = visualState;
    const color = STATUS_COLORS[visualState];
    // Keep the approved display skin's identity colors intact; status color is
    // carried by the independent indicator rather than tinting the artwork.
    node.main.tint = 0xffffff;
    node.side.tint = 0xffffff;
    node.status.clear().circle(0, 0, 5).fill({ color, alpha: visualState === "offline" ? 0.45 : 0.95 });
    drawScreenUi(node, visualState, phaseMs);
    statusNode.alpha = reducedMotion ? 0.86 : visualState === "work" || visualState === "thinking" ? 0.95 : 0.82;
  };

  return {
    root: layerRoot,
    statusRoot,
    nodes,
    setReducedMotion(reduced) {
      reducedMotion = reduced;
    },
    tick() {
      const phaseMs = now();
      for (const node of nodes.values()) {
        if (node.root.visible && (node.visualState === "work" || node.visualState === "thinking" || node.visualState === "walk")) {
          drawScreenUi(node, node.visualState, phaseMs);
        }
      }
    },
    setTexture(roleId, target, texture) {
      const node = nodes.get(roleId);
      if (!node) return;
      node[target].texture = texture;
    },
    update(snapshot: OfficeSnapshot) {
      resize();
      const phaseMs = now();
      const stateByRole = new Map(snapshot.roles.map((state) => [state.roleId, state]));
      for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
        const node = nodes.get(roleId);
        const statusNode = statusRoots.get(roleId);
        if (!node || !statusNode) continue;
        const state = stateByRole.get(roleId);
        node.root.visible = Boolean(state);
        statusNode.visible = Boolean(state);
        const visualState = visualStateFor(state, phaseMs, previousStates.get(roleId), index * 137, reducedMotion);
        previousStates.set(roleId, visualState);
        applyStatus(roleId, visualState, phaseMs);
      }
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(statusRoot);
    },
  };
}
