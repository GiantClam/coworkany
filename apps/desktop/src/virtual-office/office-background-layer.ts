import { Container, Sprite, type Texture } from "pixi.js";
import type { OfficeSnapshot } from "./types";
import {
  OFFICE_LAYER_Z,
  type OfficeBackgroundLayerHandle,
  type OfficeLayerContext,
  computeOfficeContainedBounds,
  computeOfficeStageBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  reportOfficeLayerError,
} from "./office-layer-types";

export type { OfficeBackgroundLayerHandle, OfficeLayerContext, OfficeLayerHandle } from "./office-layer-types";

function textureDimension(texture: Texture, dimension: "width" | "height", fallback: number): number {
  const candidate = (texture as unknown as { [key: string]: unknown })[dimension];
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
  const source = (texture as unknown as { source?: { [key: string]: unknown } }).source;
  const sourceValue = source?.[dimension];
  return typeof sourceValue === "number" && Number.isFinite(sourceValue) && sourceValue > 0 ? sourceValue : fallback;
}

/**
 * Keep a transparent stage layer as the single owner of the shared responsive
 * anchors. The previous panorama baked in seven 3+4 podiums, so the studio
 * surface now comes from the stage itself and each workstation is independent.
 */
export async function createOfficeBackgroundLayer(context: OfficeLayerContext): Promise<OfficeBackgroundLayerHandle> {
  const layerRoot = new Container();
  layerRoot.label = "virtual-office-background";
  layerRoot.zIndex = OFFICE_LAYER_Z.background;
  context.root.sortableChildren = true;
  context.root.addChild(layerRoot);

  const asset = findOfficeAssetEntry(context.manifest, "office");
  if (!asset) {
    const error = new Error("Virtual office background asset is missing from the manifest");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    throw error;
  }

  let texture: Texture;
  try {
    texture = await loadOfficeTexture(context, asset.path);
  } catch (error) {
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    throw error;
  }

  const sourceWidth = Math.max(1, asset.width || textureDimension(texture, "width", 1));
  const sourceHeight = Math.max(1, asset.height || textureDimension(texture, "height", 1));
  const background = new Sprite(texture);
  background.anchor.set(0.5, 0.5);
  // The old panorama baked in the 3+4 podium arrangement. Keep the asset in
  // the manifest for replacement compatibility, but do not paint that base.
  background.visible = false;
  layerRoot.addChild(background);

  let layout = computeOfficeStageBounds(getOfficeViewport(context));
  let backgroundLayout = computeOfficeContainedBounds(getOfficeViewport(context), sourceWidth, sourceHeight);
  let anchors = computeOfficeLayerAnchors(layout);

  const resize = () => {
    layout = computeOfficeStageBounds(getOfficeViewport(context));
    backgroundLayout = computeOfficeContainedBounds(getOfficeViewport(context), sourceWidth, sourceHeight);
    anchors = computeOfficeLayerAnchors(layout);
    background.position.set(backgroundLayout.x + (sourceWidth * backgroundLayout.scale) / 2, backgroundLayout.y + (sourceHeight * backgroundLayout.scale) / 2);
    background.scale.set(backgroundLayout.scale);
  };
  resize();

  return {
    root: layerRoot,
    get anchors() {
      return anchors;
    },
    get bounds() {
      return layout;
    },
    get sprite() {
      return background;
    },
    update(_snapshot: OfficeSnapshot) {
      // A snapshot update is also a convenient resize boundary for hosts that
      // do not expose ResizeObserver to the lazily loaded Pixi chunk.
      resize();
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
    },
  } as OfficeBackgroundLayerHandle & { readonly sprite: Sprite };
}

/** Alias used by hosts that treat every layer as a generic background factory. */
export const createOfficeBackground = createOfficeBackgroundLayer;
