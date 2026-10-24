import { Assets, Container, type Application, type Texture } from "pixi.js";
import { officeAssetPath } from "./asset-registry";
import type { OfficeAssetManifest, OfficeAssetManifestEntry } from "./asset-registry";
import type { OfficeRoleAnchor, OfficeRoleId, OfficeSnapshot, OfficeVisualState } from "./types";
import { OFFICE_ROLE_ORDER, officeRoleAnchorForLayout } from "./office-layout";

/**
 * The layer modules deliberately depend on this small structural callback
 * contract instead of the scene implementation.  Keeping it structural makes
 * the renderer safe to load in isolation and prevents a Workbench/Tauri
 * dependency from leaking into the Pixi chunk.
 */
export interface OfficeLayerCallbacks {
  /** Bivariant callbacks accept the narrower scene callback signatures too. */
  readonly roleLabel?: { bivarianceHack(roleId: OfficeRoleId): string }["bivarianceHack"];
  readonly statusLabel?: { bivarianceHack(status: string): string }["bivarianceHack"];
  readonly onError?: { bivarianceHack(error: unknown): void }["bivarianceHack"];
}
export interface OfficeLayerContext {
  readonly app: Application;
  readonly root: Container;
  readonly manifest: OfficeAssetManifest;
  readonly callbacks: OfficeLayerCallbacks;
  /** Test and host adapters may provide a deterministic texture loader. */
  readonly loadTexture?: (path: string) => Promise<Texture>;
  /** Test and host adapters may provide a deterministic clock. */
  readonly now?: () => number;
  /** Scene-level reduced-motion preference, when known. */
  readonly reducedMotion?: boolean;
  /** Optional viewport override for offscreen rendering and unit tests. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Optional prevalidated rig manifest/evaluator supplied by the scene. */
  readonly rig?: OfficeRigLike;
  readonly loadRig?: (path: string) => Promise<OfficeRigLike>;
  readonly rigEvaluator?: OfficeRigEvaluatorLike;
}

/** Structural rig types keep this module independent from a specific adapter. */
export interface OfficeRigTrackValue {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

export interface OfficeRigLike {
  readonly bones?: readonly { readonly name: string; readonly parent?: string | null; readonly x?: number; readonly y?: number; readonly rotation?: number }[];
  readonly clips?: Readonly<Record<string, { readonly durationMs: number; readonly loop: boolean; readonly tracks: Readonly<Record<string, readonly { readonly t: number; readonly x?: number; readonly y?: number; readonly rotation?: number; readonly opacity?: number }[]>> }>>;
  readonly reducedMotion?: { readonly staticPoseByClip?: Readonly<Record<string, string>>; readonly disableStatusFx?: boolean };
}

export interface OfficeRigEvaluationLike {
  readonly clip?: string;
  readonly durationMs?: number;
  readonly loop?: boolean;
  readonly t?: number;
  readonly tracks?: Readonly<Record<string, OfficeRigTrackValue>>;
}

export interface OfficeRigEvaluatorLike {
  evaluate?: (clip: string, elapsedMs: number, reducedMotion?: boolean) => OfficeRigEvaluationLike;
}

export interface OfficeLayerHandle {
  readonly root: Container;
  update(snapshot: OfficeSnapshot): void;
  /** Frame-policy hosts can toggle this without recreating the layer. */
  setReducedMotion?(reduced: boolean): void;
  destroy(): void;
}

export interface OfficeBackgroundLayerHandle extends OfficeLayerHandle {
  readonly anchors: ReadonlyMap<OfficeRoleId, OfficeRoleAnchor>;
  readonly bounds: Readonly<{ x: number; y: number; width: number; height: number; scale: number }>;
  readonly sprite?: import("pixi.js").Sprite;
}

export type OfficeDeskVariant = "available" | "active" | "offline";
export interface OfficeDeskLayerHandle extends OfficeLayerHandle {
  readonly nodes: ReadonlyMap<OfficeRoleId, OfficeDeskLayerNode>;
  readonly frontRoot?: Container;
  setTexture?(roleId: OfficeRoleId, variant: OfficeDeskVariant, texture: Texture, target?: "back" | "front" | "both"): void;
}

/** Independent PNG chair art and the front-edge occlusion used to make the
 * standing source sprites read as seated workstation characters. */
export interface OfficeChairLayerHandle extends OfficeLayerHandle {
  readonly nodes: ReadonlyMap<OfficeRoleId, OfficeChairLayerNode>;
  readonly frontRoot?: Container;
}

export interface OfficeDisplayLayerHandle extends OfficeLayerHandle {
  readonly nodes: ReadonlyMap<OfficeRoleId, OfficeDisplayLayerNode>;
  readonly statusRoot?: Container;
  /** Advance renderer-only screen chrome without reprojecting business state. */
  tick?(): void;
  setTexture?(roleId: OfficeRoleId, target: "main" | "side", texture: Texture): void;
}

export interface OfficeCharacterLayerHandle extends OfficeLayerHandle {
  readonly nodes: ReadonlyMap<OfficeRoleId, OfficeCharacterLayerNode>;
  readonly statusRoot?: Container;
  setTexture?(roleId: OfficeRoleId, texture: Texture): void;
}

export interface OfficeDeskLayerNode {
  readonly root: Container;
  readonly back: import("pixi.js").Sprite;
  readonly front: import("pixi.js").Sprite;
  readonly variants: Readonly<Record<OfficeDeskVariant, { readonly back: Texture; readonly front: Texture }>>;
  readonly roleId: OfficeRoleId;
  variant: OfficeDeskVariant;
}

export interface OfficeChairLayerNode {
  readonly root: Container;
  /** Lower seat/column/wheel portion of the approved PNG, above the desk and lower body. */
  readonly rear: import("pixi.js").Sprite;
  /** Cropped backrest portion, rendered in the foreground over the role. */
  readonly art: import("pixi.js").Sprite;
  /** A slim foreground cushion edge that completes the seated read. */
  readonly occlusion: import("pixi.js").Graphics;
  readonly roleId: OfficeRoleId;
}

export interface OfficeDisplayLayerNode {
  readonly root: Container;
  readonly main: import("pixi.js").Sprite;
  readonly side: import("pixi.js").Sprite;
  readonly status: import("pixi.js").Graphics;
  /** Compact work-state chrome rendered above the character occlusion layer. */
  readonly screenUi: import("pixi.js").Graphics;
  readonly roleId: OfficeRoleId;
  visualState: OfficeVisualState;
}

export interface OfficeCharacterLayerNode {
  readonly root: Container;
  readonly rigRoot: Container;
  readonly bones: ReadonlyMap<string, Container>;
  /** Body sprite retained as the compatibility alias exposed by `character`. */
  readonly body: import("pixi.js").Sprite;
  /** Head sprite is attached to the visual head bone, not the torso. */
  readonly head: import("pixi.js").Sprite;
  readonly character: import("pixi.js").Sprite;
  /** Full source-cell height after fitting, used as the rig's normalized unit. */
  characterHeight: number;
  readonly statusFx: import("pixi.js").Graphics;
  readonly roleId: OfficeRoleId;
  visualState: OfficeVisualState;
}

export const OFFICE_LAYER_Z = Object.freeze({
  background: 0,
  deskBack: 10,
  display: 20,
  // The desk sits behind the character; the front edge no longer masks the
  // torso because the chair back is the intentional foreground occluder.
  deskFront: 25,
  character: 30,
  // The complete seat/base is above the character's lower body so its column
  // and casters remain visible; chairFront is the backrest occluder.
  chair: 35,
  chairFront: 45,
  status: 50,
} as const);

export type OfficeLayerZ = (typeof OFFICE_LAYER_Z)[keyof typeof OFFICE_LAYER_Z];

export interface OfficeViewport {
  readonly width: number;
  readonly height: number;
}

export interface OfficeContainedBounds {
  readonly x: number;
  readonly y: number;
  /** Fitted (contained) image dimensions, not the outer viewport dimensions. */
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export function getOfficeViewport(context: Pick<OfficeLayerContext, "app" | "viewport">): OfficeViewport {
  const override = context.viewport;
  if (override && Number.isFinite(override.width) && Number.isFinite(override.height)) {
    return { width: Math.max(1, override.width), height: Math.max(1, override.height) };
  }
  const app = context.app as unknown as {
    screen?: { width?: number; height?: number };
    renderer?: { width?: number; height?: number };
    canvas?: { clientWidth?: number; clientHeight?: number; width?: number; height?: number };
  };
  const width = app.screen?.width ?? app.renderer?.width ?? app.canvas?.clientWidth ?? app.canvas?.width ?? 1;
  const height = app.screen?.height ?? app.renderer?.height ?? app.canvas?.clientHeight ?? app.canvas?.height ?? 1;
  return { width: Math.max(1, Number.isFinite(width) ? width : 1), height: Math.max(1, Number.isFinite(height) ? height : 1) };
}

/** Fit the approved panoramic background without cropping any station marker. */
export function computeOfficeContainedBounds(viewport: OfficeViewport, sourceWidth: number, sourceHeight: number): OfficeContainedBounds {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.min(width / safeSourceWidth, height / safeSourceHeight);
  const fittedWidth = safeSourceWidth * scale;
  const fittedHeight = safeSourceHeight * scale;
  return { width: fittedWidth, height: fittedHeight, x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, scale };
}

/** Use the complete responsive canvas as the shared grid artboard. */
export function computeOfficeStageBounds(viewport: OfficeViewport): OfficeContainedBounds {
  const width = Math.max(1, Number.isFinite(viewport.width) ? viewport.width : 1);
  const height = Math.max(1, Number.isFinite(viewport.height) ? viewport.height : 1);
  return { x: 0, y: 0, width, height, scale: 1 };
}

/**
 * Resolve the same seven responsive grid anchors for every visual layer. The
 * normalized anchor source remains office-layout.ts; this helper maps it into
 * the shared artboard so independent textures cannot drift.
 */
export function computeOfficeLayerAnchors(
  bounds: Pick<OfficeContainedBounds, "x" | "y" | "width" | "height">,
): ReadonlyMap<OfficeRoleId, OfficeRoleAnchor> {
  const anchors = new Map<OfficeRoleId, OfficeRoleAnchor>();
  for (const roleId of OFFICE_ROLE_ORDER) {
    const normalized = officeRoleAnchorForLayout(roleId, 1, 1);
    anchors.set(roleId, {
      x: bounds.x + normalized.x * bounds.width,
      y: bounds.y + normalized.y * bounds.height,
    });
  }
  return anchors;
}

export function findOfficeAssetEntry(manifest: OfficeAssetManifest, id: string): OfficeAssetManifestEntry | undefined {
  return manifest.assets.find((asset) => asset.id === id);
}

export function officeAssetUrl(path: string, baseURI?: string): string {
  const assetPath = /^(?:https?:|data:|blob:|\/)/u.test(path) ? path : officeAssetPath(path);
  // Pixi's root-relative resolver drops the host for Tauri's custom protocol.
  // A standard absolute URL preserves it in both the browser and native app.
  return baseURI ? new URL(assetPath, baseURI).href : assetPath;
}

export async function loadOfficeTexture(context: OfficeLayerContext, path: string): Promise<Texture> {
  if (context.loadTexture) return context.loadTexture(path);
  // Tauri's CSP disallows blob workers. Pixi's image-bitmap worker probe does
  // not reject on CSP failure, so it can leave every scene layer pending.
  // Decode on the main thread instead, without relaxing the native CSP.
  Assets.setPreferences({ preferWorkers: false });
  // All approved raster layers use the same filtering. Mipmaps retain smooth
  // edges when the high-resolution chair/displays shrink to workstation size.
  return Assets.load<Texture>({
    src: officeAssetUrl(path, globalThis.document?.baseURI),
    data: { scaleMode: "linear", autoGenerateMipmaps: true },
  });
}

export function reportOfficeLayerError(context: Pick<OfficeLayerContext, "callbacks">, error: unknown): void {
  try {
    context.callbacks.onError?.(error);
  } catch {
    // Error reporting must never break the React fallback or another layer.
  }
}

export function destroyOfficeLayerContainer(container: Container): void {
  try {
    container.removeFromParent();
    container.destroy({ children: true, texture: false, textureSource: false });
  } catch {
    // Pixi can already have torn down the renderer during route transitions.
  }
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
