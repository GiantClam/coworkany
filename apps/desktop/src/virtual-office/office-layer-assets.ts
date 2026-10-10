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

export function createRoleTexture(
  source: TextureSource,
  asset: OfficeAssetManifestEntry | undefined,
  roleId: OfficeRoleId,
  roleIndex: number,
  state: string | undefined,
  stateIndex: number,
): Texture {
  const region = findOfficeRegion(asset, { roleId, state });
  const regionFrame = regionRectangle(region);
  if (regionFrame) return new Texture({ source, frame: regionFrame });
  const frame = atlasCellRectangle(asset, roleId, roleIndex, stateIndex);
  return frame ? new Texture({ source, frame }) : new Texture({ source });
}

export function createNamedTexture(source: TextureSource, asset: OfficeAssetManifestEntry | undefined, id: string, fallback?: Rectangle): Texture {
  const regionFrame = regionRectangle(findOfficeRegion(asset, { id }));
  return new Texture({ source, frame: regionFrame ?? fallback });
}
