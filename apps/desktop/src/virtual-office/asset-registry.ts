import type { OfficeRoleId } from "./types";

export const OFFICE_ASSET_MANIFEST_VERSION = "v1" as const;

/** Stable order shared by the generated manifest and the renderer. */
export const OFFICE_ASSET_IDS = [
  "office",
  "characters",
  "workstations",
  "workstations-front",
  "chair",
  "displays",
  "rig",
] as const;

export const OFFICE_CHARACTER_ASSET_ID = "characters" as const;
export const OFFICE_WORKSTATION_ASSET_ID = "workstations" as const;
export const OFFICE_WORKSTATION_FRONT_ASSET_ID = "workstations-front" as const;
export const OFFICE_CHAIR_ASSET_ID = "chair" as const;
export const OFFICE_DISPLAY_ASSET_ID = "displays" as const;
export const OFFICE_RIG_ASSET_ID = "rig" as const;

/** Legacy alias retained for older consumers that only need a nominal cell. */
export const OFFICE_ATLAS_CELL = { width: 128, height: 64, columns: 7 } as const;
/** Physical texel dimensions of the 2× runtime atlases. */
export const OFFICE_CHARACTER_CELL = { width: 256, height: 256, columns: 7 } as const;
export const OFFICE_WORKSTATION_CELL = { width: 256, height: 192, columns: 7, rows: 3 } as const;
/** Layout stays independent of atlas density. */
export const OFFICE_WORKSTATION_LOGICAL_WIDTH = 128;

export const OFFICE_ROLE_ASSET_IDS: readonly OfficeRoleId[] = [
  "ai-chat",
  "agent-center",
  "ppt-expert",
  "workflow-operator",
  "writer",
  "image-creator",
  "video-producer",
];

export const OFFICE_RIG_CLIP_ASSET_IDS = ["idle", "walk", "work", "thinking", "waiting", "completed", "error"] as const;
export const OFFICE_DISPLAY_REGION_IDS = ["main-front", "side-angle", "stand-front", "stand-side", "status-available", "status-active", "status-offline"] as const;

export interface OfficeAssetRegion {
  readonly id?: string;
  readonly roleId?: string;
  readonly state?: string;
  readonly target?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OfficeAssetCell {
  readonly width: number;
  readonly height: number;
}

export interface OfficeAssetManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly purpose: string;
  readonly format?: "webp" | "png" | "json" | string;
  readonly width?: number;
  readonly height?: number;
  readonly hasAlpha?: boolean;
  readonly frames: readonly string[];
  readonly states?: readonly string[];
  readonly roleIds?: readonly string[];
  readonly cell?: OfficeAssetCell;
  readonly regions?: readonly OfficeAssetRegion[];
  readonly sha256?: string;
}

export interface OfficeAssetManifest {
  readonly schemaVersion: number;
  readonly sourceVersion?: string;
  readonly roles?: readonly string[];
  readonly roleIds?: readonly string[];
  readonly clips?: readonly string[];
  readonly states?: readonly string[];
  readonly sourceInputs?: readonly Record<string, unknown>[];
  readonly assets: readonly OfficeAssetManifestEntry[];
}

/** Public assets are served from the versioned root in both Vite and Tauri. */
export function officeAssetPath(fileName: string): string {
  return `/virtual-office/${OFFICE_ASSET_MANIFEST_VERSION}/${fileName}`;
}

export function officeAssetManifestPath(): string {
  return officeAssetPath("manifest.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`Virtual office asset manifest ${message}`);
}

function validateFrames(asset: OfficeAssetManifestEntry, expected?: readonly string[]): void {
  if (!Array.isArray(asset.frames) || asset.frames.length === 0 || asset.frames.some((frame) => typeof frame !== "string" || frame.trim() === "")) {
    fail(`entry is invalid: ${asset.id}`);
  }
  if (expected && (asset.frames.length !== expected.length || expected.some((frame, index) => asset.frames[index] !== frame))) {
    fail(`frames are invalid: ${asset.id}`);
  }
}

function validateImageBase(asset: OfficeAssetManifestEntry, expectedFormat: "webp" | "png" = "webp", expectedPath?: string): void {
  const width = asset.width;
  const height = asset.height;
  const path = expectedPath ?? `${asset.id}.${expectedFormat}`;
  if (asset.format !== expectedFormat || typeof asset.path !== "string" || asset.path !== path || typeof width !== "number" || !Number.isInteger(width) || width <= 0 || typeof height !== "number" || !Number.isInteger(height) || height <= 0 || asset.hasAlpha !== true) {
    fail(`entry is invalid: ${asset.id}`);
  }
  validateFrames(asset);
}

function validateRoleIds(asset: OfficeAssetManifestEntry): void {
  if (!Array.isArray(asset.roleIds) || asset.roleIds.length !== OFFICE_ROLE_ASSET_IDS.length || asset.roleIds.some((roleId, index) => roleId !== OFFICE_ROLE_ASSET_IDS[index])) {
    fail(`role atlas manifest entry is invalid: ${asset.id}`);
  }
}

function validateCell(asset: OfficeAssetManifestEntry, width: number, height: number): void {
  if (!asset.cell || asset.cell.width !== width || asset.cell.height !== height) fail(`atlas cell is invalid: ${asset.id}`);
}

function validateRegions(asset: OfficeAssetManifestEntry, requiredIds: readonly string[]): void {
  if (!Array.isArray(asset.regions) || asset.regions.length < requiredIds.length) fail(`regions are invalid: ${asset.id}`);
  const ids = new Set<string>();
  for (const region of asset.regions) {
    if (!isRecord(region) || typeof region.x !== "number" || !Number.isFinite(region.x) || typeof region.y !== "number" || !Number.isFinite(region.y) || typeof region.width !== "number" || !Number.isFinite(region.width) || region.width <= 0 || typeof region.height !== "number" || !Number.isFinite(region.height) || region.height <= 0) fail(`region is invalid: ${asset.id}`);
    if (typeof region.id === "string") ids.add(region.id);
  }
  for (const id of requiredIds) if (!ids.has(id)) fail(`regions are invalid: ${asset.id}`);
}

function validateStationRegions(asset: OfficeAssetManifestEntry): void {
  if (!Array.isArray(asset.regions) || asset.regions.length !== OFFICE_ROLE_ASSET_IDS.length * 3) fail(`regions are invalid: ${asset.id}`);
  const expectedStates = ["available", "active", "offline"] as const;
  for (const roleId of OFFICE_ROLE_ASSET_IDS) {
    for (const state of expectedStates) {
      if (!asset.regions.some((region) => region.roleId === roleId && region.state === state)) fail(`regions are invalid: ${asset.id}`);
    }
  }
}

function validateCharacterRegions(asset: OfficeAssetManifestEntry): void {
  if (!Array.isArray(asset.regions) || asset.regions.length !== OFFICE_ROLE_ASSET_IDS.length) fail(`regions are invalid: ${asset.id}`);
  for (const roleId of OFFICE_ROLE_ASSET_IDS) if (!asset.regions.some((region) => region.roleId === roleId)) fail(`regions are invalid: ${asset.id}`);
}

/** Validate the checked-in seven-asset contract before any Pixi texture loads. */
export function validateOfficeAssetManifest(value: unknown): OfficeAssetManifest {
  if (!isRecord(value)) fail("is not an object");
  if (value.schemaVersion !== 1 || !Array.isArray(value.assets)) fail("schema is invalid");
  if (value.assets.length !== OFFICE_ASSET_IDS.length) fail("has an unexpected asset count");

  const ids = new Set<string>();
  for (const [index, rawAsset] of value.assets.entries()) {
    if (!isRecord(rawAsset) || typeof rawAsset.id !== "string" || rawAsset.id.trim() === "" || ids.has(rawAsset.id)) fail("contains an invalid asset entry");
    const asset = rawAsset as unknown as OfficeAssetManifestEntry;
    ids.add(asset.id);
    const expectedId = OFFICE_ASSET_IDS[index];
    if (asset.id !== expectedId || typeof asset.path !== "string" || asset.path.includes("/") || asset.path.includes("\\") || asset.path.startsWith(".") || typeof asset.purpose !== "string" || asset.purpose.trim() === "") {
      fail(`entry is invalid: ${asset.id}`);
    }

    switch (asset.id) {
      case "office":
        validateImageBase(asset);
        if (asset.width !== 2172 || asset.height !== 724) fail(`entry dimensions are invalid: ${asset.id}`);
        validateFrames(asset, ["background"]);
        validateRegions(asset, ["background"]);
        break;
      case OFFICE_CHARACTER_ASSET_ID:
        validateImageBase(asset);
        validateRoleIds(asset);
        validateCell(asset, OFFICE_CHARACTER_CELL.width, OFFICE_CHARACTER_CELL.height);
        if (asset.width !== OFFICE_CHARACTER_CELL.width * OFFICE_CHARACTER_CELL.columns || asset.height !== OFFICE_CHARACTER_CELL.height) fail(`atlas dimensions are invalid: ${asset.id}`);
        validateFrames(asset, ["back"]);
        validateCharacterRegions(asset);
        break;
      case OFFICE_WORKSTATION_ASSET_ID:
      case OFFICE_WORKSTATION_FRONT_ASSET_ID:
        validateImageBase(asset);
        validateRoleIds(asset);
        validateCell(asset, OFFICE_WORKSTATION_CELL.width, OFFICE_WORKSTATION_CELL.height);
        if (asset.width !== OFFICE_WORKSTATION_CELL.width * OFFICE_WORKSTATION_CELL.columns || asset.height !== OFFICE_WORKSTATION_CELL.height * OFFICE_WORKSTATION_CELL.rows) fail(`atlas dimensions are invalid: ${asset.id}`);
        validateFrames(asset, ["available", "active", "offline"]);
        if (!Array.isArray(asset.states) || asset.states.length !== 3 || asset.states.some((state, stateIndex) => state !== ["available", "active", "offline"][stateIndex])) fail(`states are invalid: ${asset.id}`);
        validateStationRegions(asset);
        break;
      case OFFICE_CHAIR_ASSET_ID:
        validateImageBase(asset, "png", "office-chair.png");
        if (asset.width !== 715 || asset.height !== 1047) fail(`entry dimensions are invalid: ${asset.id}`);
        validateFrames(asset, ["chair"]);
        validateRegions(asset, ["chair"]);
        break;
      case OFFICE_DISPLAY_ASSET_ID:
        validateImageBase(asset);
        if (asset.width !== 1536 || asset.height !== 1024) fail(`entry dimensions are invalid: ${asset.id}`);
        validateFrames(asset, OFFICE_DISPLAY_REGION_IDS);
        validateRegions(asset, OFFICE_DISPLAY_REGION_IDS);
        break;
      case OFFICE_RIG_ASSET_ID:
        if (asset.format !== "json" || asset.path !== "rig-animation-data.json" || typeof asset.sha256 !== "string") fail(`entry is invalid: ${asset.id}`);
        validateFrames(asset, OFFICE_RIG_CLIP_ASSET_IDS);
        break;
      default:
        fail(`contains an unknown asset: ${asset.id}`);
    }
    if (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(asset.sha256)) fail(`hash is invalid: ${asset.id}`);
  }
  for (const id of OFFICE_ASSET_IDS) if (!ids.has(id)) fail(`is missing: ${id}`);
  return value as unknown as OfficeAssetManifest;
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
