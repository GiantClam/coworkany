import { Rectangle, Texture, type TextureSource } from "pixi.js";
import type { OfficeAssetManifestEntry } from "./asset-registry";
import type { OfficeRoleId } from "./types";
import { finiteNumber } from "./office-layer-types";

/** Runtime manifest region shape. Kept structural for backwards-compatible manifests. */
export interface OfficeAssetRegionLike {
  readonly id?: string;
  readonly roleId?: string;
  readonly state?: string;
  readonly target?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export type OfficeCharacterPart = "body" | "head";

/** Cropping ratios stay independent of the runtime atlas's pixel density. */
export const OFFICE_CHARACTER_HEAD_HEIGHT_FACTOR = 0.58;
export const OFFICE_CHARACTER_BODY_START_FACTOR = 0.4;

function regionsOf(asset: OfficeAssetManifestEntry | undefined): readonly OfficeAssetRegionLike[] {
  if (!asset || !Array.isArray((asset as OfficeAssetManifestEntry & { regions?: unknown }).regions)) return [];
  return ((asset as OfficeAssetManifestEntry & { regions?: unknown }).regions as unknown[]).filter((region): region is OfficeAssetRegionLike => Boolean(region && typeof region === "object"));
}

export function findOfficeRegion(
  asset: OfficeAssetManifestEntry | undefined,
  query: { readonly id?: string; readonly roleId?: OfficeRoleId; readonly state?: string; readonly target?: string },
): OfficeAssetRegionLike | undefined {
  const regions = regionsOf(asset);
  return regions.find((region) => {
    if (query.id && region.id !== query.id) return false;
    if (query.roleId && region.roleId !== query.roleId) return false;
    if (query.state && region.state !== query.state) return false;
    if (query.target && region.target !== query.target && region.id !== query.target) return false;
    return true;
  });
}

export function regionRectangle(region: OfficeAssetRegionLike | undefined): Rectangle | undefined {
  if (!region) return undefined;
  const x = finiteNumber(region.x, NaN);
  const y = finiteNumber(region.y, NaN);
  const width = finiteNumber(region.width, NaN);
  const height = finiteNumber(region.height, NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return new Rectangle(x, y, width, height);
}

export function textureFromRegion(source: TextureSource, region?: OfficeAssetRegionLike): Texture {
  const frame = regionRectangle(region);
  return frame ? new Texture({ source, frame }) : new Texture({ source });
}

export function atlasCellRectangle(
  asset: Pick<OfficeAssetManifestEntry, "width" | "height" | "roleIds" | "frames"> | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  stateIndex = 0,
): Rectangle | undefined {
  if (!asset || !Number.isFinite(asset.width) || !Number.isFinite(asset.height)) return undefined;
  const assetWidth = asset.width ?? 0;
  const assetHeight = asset.height ?? 0;
  const columns = Math.max(1, asset.roleIds?.length ?? 7);
  const rows = Math.max(1, asset.frames?.length ?? 1);
  const cellWidth = assetWidth / columns;
  const cellHeight = assetHeight / rows;
  const column = Math.max(0, asset.roleIds?.indexOf(roleId) ?? roleIndex);
  const row = Math.max(0, Math.min(rows - 1, stateIndex));
  if (cellWidth <= 0 || cellHeight <= 0) return undefined;
  return new Rectangle(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
}

/** Resolve the complete source cell before deriving any cropped character part. */
export function roleCellRectangle(
  asset: OfficeAssetManifestEntry | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  state?: string,
  stateIndex = 0,
): Rectangle | undefined {
  const regionFrame = regionRectangle(findOfficeRegion(asset, { roleId, state }));
  return regionFrame ?? atlasCellRectangle(asset, roleId, roleIndex, stateIndex);
}

/**
 * Derive overlapping head/body frames from a full role cell. The overlap keeps
 * the neck seam covered while allowing the head slot to rotate independently.
 */
export function characterPartRectangle(
  asset: OfficeAssetManifestEntry | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  part: OfficeCharacterPart,
  state?: string,
  stateIndex = 0,
): Rectangle | undefined {
  const cell = roleCellRectangle(asset, roleId, roleIndex, state, stateIndex);
  if (!cell) return undefined;
  const headHeight = Math.max(1, Math.round(cell.height * OFFICE_CHARACTER_HEAD_HEIGHT_FACTOR));
  const bodyY = Math.max(0, Math.min(cell.height - 1, Math.round(cell.height * OFFICE_CHARACTER_BODY_START_FACTOR)));
  if (part === "head") return new Rectangle(cell.x, cell.y, cell.width, headHeight);
  return new Rectangle(cell.x, cell.y + bodyY, cell.width, Math.max(1, cell.height - bodyY));
}

export function createRoleTexture(
  source: TextureSource,
  asset: OfficeAssetManifestEntry | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  state: string | undefined,
  stateIndex: number,
): Texture {
  const frame = roleCellRectangle(asset, roleId, roleIndex, state, stateIndex);
  return frame ? new Texture({ source, frame }) : new Texture({ source });
}

export function createRolePartTexture(
  source: TextureSource,
  asset: OfficeAssetManifestEntry | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  part: OfficeCharacterPart,
  state?: string,
  stateIndex = 0,
): Texture {
  const frame = characterPartRectangle(asset, roleId, roleIndex, part, state, stateIndex);
  return frame ? new Texture({ source, frame }) : new Texture({ source });
}

export function createNamedTexture(source: TextureSource, asset: OfficeAssetManifestEntry | undefined, id: string, fallback?: Rectangle): Texture {
  const regionFrame = regionRectangle(findOfficeRegion(asset, { id }));
  return new Texture({ source, frame: regionFrame ?? fallback });
}
