import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from "pixi.js";
import type { OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeVisualState } from "./types";
import { OFFICE_ROLE_ORDER } from "./office-layout";
import { resolveOfficeVisualPhase } from "./visual-state";
import {
  OFFICE_LAYER_Z,
  type OfficeDisplayLayerHandle,
  type OfficeDisplayLayerNode,
  type OfficeLayerContext,
  computeOfficeContainedBounds,
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

function sourceOf(texture: Texture): import("pixi.js").TextureSource {
  return texture.source;
}
function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  const office = findOfficeAssetEntry(context.manifest, "office");
  return computeOfficeContainedBounds(viewport, office?.width ?? viewport.width, office?.height ?? viewport.height);
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

function statusText(context: OfficeLayerContext, state: OfficeRoleState | undefined, visualState: OfficeVisualState): string {
  if (context.callbacks.statusLabel) {
    const callbackStatus = visualState === "error" ? "failed" : state?.status ?? "unknown";
    try {
      return context.callbacks.statusLabel(callbackStatus);
    } catch {
      // Keep the decorative layer alive if a host's localization callback is
      // intentionally strict about persisted status values.
    }
  }
  return visualState;
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

  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
    const root = new Container();
    root.label = `virtual-office-display:${roleId}`;
    root.zIndex = index;
    const main = new Sprite(textures.main);
    const side = new Sprite(textures.side);
    main.anchor.set(0.5, 1);
    side.anchor.set(0.5, 1);
    root.addChild(main, side);
    const copy = new Text({ text: "", style: { fill: 0x24322e, fontSize: 8, fontFamily: "IBM Plex Sans, sans-serif", align: "center" } });
    copy.anchor.set(0.5, 1);
    root.addChild(copy);
    layerRoot.addChild(root);

    const roleStatusRoot = new Container();
    roleStatusRoot.label = `virtual-office-status:${roleId}`;
    roleStatusRoot.zIndex = index;
    const status = new Graphics();
    roleStatusRoot.addChild(status);
    statusRoot.addChild(roleStatusRoot);
    statusRoots.set(roleId, roleStatusRoot);

    nodes.set(roleId, { root, main, side, status, copy, roleId, visualState: "idle" });
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const viewport = getOfficeViewport(context);
    const slotWidth = Math.max(48, Math.min(180, (viewport.width / OFFICE_ROLE_ORDER.length) * 0.9));
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
      node.copy.position.set(0, -displayHeight * 0.18);
      statusNode.position.set(anchor.x + displayWidth * 0.34, anchor.y - Math.max(38, displayHeight * 1.06));
    }
  };
  resize();

  const applyStatus = (roleId: OfficeRoleId, visualState: OfficeVisualState) => {
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
    statusNode.alpha = reducedMotion ? 0.86 : visualState === "work" || visualState === "thinking" ? 0.95 : 0.82;
  };

  return {
    root: layerRoot,
    statusRoot,
    nodes,
    setReducedMotion(reduced) {
      reducedMotion = reduced;
    },
    setTexture(roleId, target, texture) {
      const node = nodes.get(roleId);
      if (!node) return;
      node[target].texture = texture;
    },
    update(snapshot: OfficeSnapshot) {
      resize();
      const phaseMs = context.now?.() ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
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
        applyStatus(roleId, visualState);
        node.copy.text = state ? `${context.callbacks.roleLabel?.(roleId) ?? roleId}\n${statusText(context, state, visualState)}` : "";
      }
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(statusRoot);
    },
  };
}
