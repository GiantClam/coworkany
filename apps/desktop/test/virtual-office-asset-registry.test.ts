import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { OFFICE_ASSET_IDS, OFFICE_CHARACTER_ASSET_ID, OFFICE_ROLE_ASSET_IDS, OFFICE_WORKSTATION_ASSET_ID, officeAssetPath, validateOfficeAssetManifest } from "../src/virtual-office/asset-registry";
import { OFFICE_ROLE_REGISTRY } from "../src/virtual-office/role-registry";

test("every role atlas and manifest role id stay aligned", async () => {
  const manifest = JSON.parse(await readFile(resolve("public/virtual-office/v1/manifest.json"), "utf8")) as { assets: Array<{ id: string; roleIds?: string[] }> };
  const ids = new Set(manifest.assets.map((asset) => asset.id));
  assert.deepEqual([...OFFICE_ASSET_IDS], manifest.assets.map((asset) => asset.id));
  assert.ok(ids.has(OFFICE_CHARACTER_ASSET_ID));
  assert.ok(ids.has(OFFICE_WORKSTATION_ASSET_ID));
  const roleIds = new Set(OFFICE_ROLE_ASSET_IDS);
  assert.deepEqual(new Set(OFFICE_ROLE_REGISTRY.map((role) => role.roleId)), roleIds);
  for (const asset of manifest.assets.filter((item) => item.id === OFFICE_CHARACTER_ASSET_ID || item.id === OFFICE_WORKSTATION_ASSET_ID)) assert.deepEqual(new Set(asset.roleIds), roleIds);
  assert.deepEqual(manifest.assets.find((asset) => asset.id === OFFICE_CHARACTER_ASSET_ID)?.roleIds, [...roleIds]);
  assert.deepEqual(manifest.assets.find((asset) => asset.id === OFFICE_WORKSTATION_ASSET_ID)?.roleIds, [...roleIds]);
});

test("renderer assets resolve through the public versioned root", () => {
  assert.equal(officeAssetPath("office.webp"), "/virtual-office/v1/office.webp");
  assert.equal(officeAssetPath("characters.webp"), "/virtual-office/v1/characters.webp");
  assert.equal(officeAssetPath("workstations.webp"), "/virtual-office/v1/workstations.webp");
});

test("runtime manifest validation rejects missing, unknown, or reordered assets", async () => {
  const manifest = JSON.parse(await readFile(resolve("public/virtual-office/v1/manifest.json"), "utf8"));
  assert.equal(validateOfficeAssetManifest(manifest).schemaVersion, 1);
  assert.throws(() => validateOfficeAssetManifest({ ...manifest, assets: manifest.assets.slice(1) }), /unexpected asset count/u);
  assert.throws(() => validateOfficeAssetManifest({ ...manifest, assets: manifest.assets.map((asset: { id: string; path?: string }) => asset.id === "office" ? { ...asset, path: "missing.webp" } : asset) }), /entry is invalid/u);
  assert.throws(() => validateOfficeAssetManifest({ ...manifest, assets: manifest.assets.map((asset: { id: string; roleIds?: string[] }) => asset.id === "characters" ? { ...asset, roleIds: [...(asset.roleIds ?? [])].reverse() } : asset) }), /role atlas manifest entry is invalid/u);
  for (const invalid of [{ width: 0 }, { height: -1 }, { frames: [] }]) {
    assert.throws(() => validateOfficeAssetManifest({ ...manifest, assets: manifest.assets.map((asset: { id: string }) => asset.id === "office" ? { ...asset, ...invalid } : asset) }), /entry is invalid/u);
  }
  assert.throws(() => validateOfficeAssetManifest({ ...manifest, assets: manifest.assets.map((asset: { id: string }) => asset.id === "characters" ? { ...asset, width: 128 } : asset) }), /atlas dimensions are invalid/u);
});
