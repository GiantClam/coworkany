import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { OFFICE_ASSET_IDS, OFFICE_ROLE_ASSET_IDS, OFFICE_RIG_CLIP_ASSET_IDS, validateOfficeAssetManifest } from "../src/virtual-office/asset-registry";
import { validateManifest } from "../scripts/verify-virtual-office-assets.mjs";

const rootDir = resolve("public/virtual-office/v1");
const expectedDimensions: Record<string, readonly [number, number]> = {
  office: [2172, 724],
  characters: [1792, 256],
  workstations: [1792, 576],
  "workstations-front": [1792, 576],
  chair: [715, 1047],
  displays: [1536, 1024],
};
const expectedFormats: Record<string, string> = {
  office: "webp",
  characters: "webp",
  workstations: "webp",
  "workstations-front": "webp",
  chair: "png",
  displays: "webp",
};

test("generated virtual-office assets match the approved manifest contract", async () => {
  const manifest = JSON.parse(await readFile(resolve(rootDir, "manifest.json"), "utf8"));
  validateOfficeAssetManifest(manifest);
  const gate = await validateManifest({ rootDir });
  assert.equal(gate.ok, true, JSON.stringify(gate.errors));
  assert.deepEqual(manifest.assets.map((asset: { id: string }) => asset.id), [...OFFICE_ASSET_IDS]);
  assert.deepEqual(manifest.roles, [...OFFICE_ROLE_ASSET_IDS]);
  assert.deepEqual(manifest.clips, [...OFFICE_RIG_CLIP_ASSET_IDS]);

  for (const [id, [width, height]] of Object.entries(expectedDimensions)) {
    const asset = manifest.assets.find((entry: { id: string }) => entry.id === id);
    assert.ok(asset, `missing generated asset: ${id}`);
    assert.equal(asset.format, expectedFormats[id]);
    assert.equal(asset.hasAlpha, true);
    assert.equal(asset.width, width);
    assert.equal(asset.height, height);
    const metadata = await sharp(resolve(rootDir, asset.path)).metadata();
    assert.equal(metadata.format, expectedFormats[id]);
    assert.equal(metadata.hasAlpha, true);
    assert.deepEqual([metadata.width, metadata.height], [width, height]);
  }

  const characters = manifest.assets.find((entry: { id: string }) => entry.id === "characters");
  assert.deepEqual(characters.roleIds, [...OFFICE_ROLE_ASSET_IDS]);
  assert.deepEqual(characters.regions.map((region: { roleId: string }) => region.roleId), [...OFFICE_ROLE_ASSET_IDS]);
  const rig = JSON.parse(await readFile(resolve(rootDir, "rig-animation-data.json"), "utf8"));
  assert.deepEqual(Object.keys(rig.clips), [...OFFICE_RIG_CLIP_ASSET_IDS]);
  assert.deepEqual(rig.bones.map((bone: { name: string }) => bone.name), ["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"]);
  assert.deepEqual(rig.slots.map((slot: { name: string }) => slot.name), ["body", "head", "prop", "statusFx"]);
});

test("generated asset gate reports missing files and hash drift", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "virtual-office-generated-gate-"));
  try {
    await cp(rootDir, fixture, { recursive: true });
    await rm(resolve(fixture, "displays.webp"));
    let result = await validateManifest({ rootDir: fixture });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === "asset_missing"), JSON.stringify(result.errors));

    await cp(rootDir, fixture, { recursive: true });
    const manifestPath = resolve(fixture, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.assets.find((asset: { id: string }) => asset.id === "characters").sha256 = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    result = await validateManifest({ rootDir: fixture });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === "asset_hash_mismatch"), JSON.stringify(result.errors));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("generated asset gate rejects alpha metadata drift and unknown rig clips", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "virtual-office-generated-schema-"));
  try {
    await cp(rootDir, fixture, { recursive: true });
    const alphaManifestPath = resolve(fixture, "manifest.json");
    const manifest = JSON.parse(await readFile(alphaManifestPath, "utf8"));
    manifest.assets.find((asset: { id: string }) => asset.id === "characters").hasAlpha = false;
    await writeFile(alphaManifestPath, JSON.stringify(manifest));
    let result = await validateManifest({ rootDir: fixture });
    assert.ok(result.errors.some((item) => item.code === "asset_alpha_invalid"), JSON.stringify(result.errors));

    await cp(rootDir, fixture, { recursive: true });
    const manifestPath = resolve(fixture, "manifest.json");
    const manifestWithUnknownClip = JSON.parse(await readFile(manifestPath, "utf8"));
    manifestWithUnknownClip.assets.find((asset: { id: string }) => asset.id === "rig").clips.push("preview");
    await writeFile(manifestPath, JSON.stringify(manifestWithUnknownClip));
    result = await validateManifest({ rootDir: fixture });
    assert.ok(result.errors.some((item) => item.code === "asset_rig_invalid"), JSON.stringify(result.errors));

    await cp(rootDir, fixture, { recursive: true });
    const rigPath = resolve(fixture, "rig-animation-data.json");
    const rig = JSON.parse(await readFile(rigPath, "utf8"));
    rig.clips.preview = { durationMs: 1, loop: false, tracks: {} };
    await writeFile(rigPath, JSON.stringify(rig));
    result = await validateManifest({ rootDir: fixture });
    assert.ok(result.errors.some((item) => item.code === "asset_rig_invalid"), JSON.stringify(result.errors));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
