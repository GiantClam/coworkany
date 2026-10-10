import { Container, Sprite, type Texture } from "pixi.js";
import type { OfficeSnapshot } from "./types";
import {
  OFFICE_LAYER_Z,
  type OfficeBackgroundLayerHandle,
  type OfficeLayerContext,
  computeOfficeContainedBounds,
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
 * Create the independent panoramic background layer.  The background owns no
 * business state; update() only recalculates the contained rect and shared
 * anchors so desk, display, and character layers stay pixel-aligned.
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
  background.alpha = 1;
  layerRoot.addChild(background);

  let layout = computeOfficeContainedBounds(getOfficeViewport(context), sourceWidth, sourceHeight);
  let anchors = computeOfficeLayerAnchors(layout);

  const resize = () => {
    layout = computeOfficeContainedBounds(getOfficeViewport(context), sourceWidth, sourceHeight);
    anchors = computeOfficeLayerAnchors(layout);
    background.position.set(layout.x + (sourceWidth * layout.scale) / 2, layout.y + (sourceHeight * layout.scale) / 2);
    background.scale.set(layout.scale);
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
