import type { OfficeRoleId } from "./types";

export const OFFICE_ASSET_MANIFEST_VERSION = "v1" as const;
export const OFFICE_ASSET_IDS = ["office", "characters", "workstations"] as const;
export const OFFICE_CHARACTER_ASSET_ID = "characters" as const;
export const OFFICE_WORKSTATION_ASSET_ID = "workstations" as const;
export const OFFICE_ATLAS_CELL = { width: 128, height: 64, columns: 7 } as const;
export const OFFICE_ROLE_ASSET_IDS: readonly OfficeRoleId[] = [
  "ai-chat",
  "agent-center",
  "ppt-expert",
  "workflow-operator",
  "writer",
  "image-creator",
  "video-producer",
];

export interface OfficeAssetManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly purpose: string;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly string[];
  readonly roleIds?: readonly string[];
  readonly sha256?: string;
}

export interface OfficeAssetManifest {
  readonly schemaVersion: number;
  readonly assets: readonly OfficeAssetManifestEntry[];
}

/** Public assets are served from the versioned root in both Vite and Tauri. */
export function officeAssetPath(fileName: string): string {
  return `/virtual-office/${OFFICE_ASSET_MANIFEST_VERSION}/${fileName}`;
}

export function officeAssetManifestPath(): string {
  return officeAssetPath("manifest.json");
}

export function validateOfficeAssetManifest(value: unknown): OfficeAssetManifest {
  if (!value || typeof value !== "object") throw new Error("Virtual office asset manifest is not an object");
  const manifest = value as Partial<OfficeAssetManifest>;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new Error("Virtual office asset manifest schema is invalid");
  if (manifest.assets.length !== OFFICE_ASSET_IDS.length) throw new Error("Virtual office asset manifest has an unexpected asset count");
  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== "object" || typeof asset.id !== "string" || ids.has(asset.id)) throw new Error("Virtual office asset manifest contains an invalid asset entry");
    ids.add(asset.id);
    if (!(OFFICE_ASSET_IDS as readonly string[]).includes(asset.id) || typeof asset.path !== "string" || asset.path !== asset.id + ".webp" || !Number.isInteger(asset.width) || asset.width <= 0 || !Number.isInteger(asset.height) || asset.height <= 0 || !Array.isArray(asset.frames) || asset.frames.length === 0 || asset.frames.some((frame: unknown) => typeof frame !== "string" || frame.trim() === "")) {
      throw new Error(`Virtual office asset manifest entry is invalid: ${asset.id}`);
    }
    if (asset.id === OFFICE_CHARACTER_ASSET_ID || asset.id === OFFICE_WORKSTATION_ASSET_ID) {
      if (!Array.isArray(asset.roleIds) || asset.roleIds.length !== OFFICE_ROLE_ASSET_IDS.length || asset.roleIds.some((roleId: unknown, index: number) => roleId !== OFFICE_ROLE_ASSET_IDS[index])) throw new Error(`Virtual office role atlas manifest entry is invalid: ${asset.id}`);
      const expectedRows = asset.id === OFFICE_CHARACTER_ASSET_ID ? 4 : 3;
      if (asset.width !== OFFICE_ATLAS_CELL.width * OFFICE_ATLAS_CELL.columns || asset.height !== OFFICE_ATLAS_CELL.height * expectedRows) throw new Error(`Virtual office role atlas dimensions are invalid: ${asset.id}`);
    }
  }
  for (const id of OFFICE_ASSET_IDS) if (!ids.has(id)) throw new Error(`Virtual office asset manifest is missing: ${id}`);
  return manifest as OfficeAssetManifest;
}

export async function loadOfficeAssetManifest(fetcher: typeof fetch = globalThis.fetch): Promise<OfficeAssetManifest> {
  if (typeof fetcher !== "function") throw new Error("Virtual office asset manifest loader is unavailable");
  const response = await fetcher(officeAssetManifestPath());
  if (!response.ok) throw new Error(`Virtual office asset manifest request failed: ${response.status}`);
  return validateOfficeAssetManifest(await response.json());
}

export function isRegisteredOfficeAsset(id: string): boolean {
  return (OFFICE_ASSET_IDS as readonly string[]).includes(id);
}
