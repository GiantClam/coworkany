import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { validateManifest } from "../scripts/verify-virtual-office-assets.mjs";

const source = resolve("public/virtual-office/v1");
type FixtureAsset = { id: string; path: string; purpose: string; width: number; height: number; frames: string[]; sha256: string };
type AssetMutator = (asset: FixtureAsset) => void;

async function fixture() {
  const rootDir = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-"));
  await cp(resolve(source, "office.webp"), resolve(rootDir, "office.webp"));
  const bytes = await readFile(resolve(rootDir, "office.webp"));
  const asset = { id: "office-background", path: "office.webp", purpose: "background", width: 256, height: 144, frames: ["background"], sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex") };
  await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, assets: [asset] }));
  return { rootDir, asset };
}

test("accepts the checked-in manifest", async () => {
  const result = await validateManifest({ rootDir: source });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

const manifestCases: readonly (readonly [string, AssetMutator, string])[] = [
  ["missing file", (asset) => { asset.path = "missing.webp"; }, "asset_missing"],
  ["path escape", (asset) => { asset.path = "../outside.webp"; }, "asset_path_escape"],
  ["windows path escape", (asset) => { asset.path = "..\\outside.webp"; }, "asset_path_escape"],
  ["wrong hash", (asset) => { asset.sha256 = "0".repeat(64); }, "asset_hash_mismatch"],
  ["empty frames", (asset) => { asset.frames = []; }, "asset_frames_empty"],
  ["missing id", (asset) => { (asset as { id?: string }).id = undefined; }, "asset_id_invalid"],
  ["empty id", (asset) => { asset.id = "   "; }, "asset_id_invalid"],
  ["duplicate id", (asset) => { asset.id = "office-background"; }, "asset_id_duplicate"],
];

for (const [name, mutate, expectedCode] of manifestCases) {
  test(`rejects ${name}`, async () => {
    const { rootDir, asset } = await fixture();
    try {
      const changed = { ...asset };
      mutate(changed);
      const assets = expectedCode === "asset_id_duplicate" ? [asset, changed] : [changed];
      await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, assets }));
      const result = await validateManifest({ rootDir });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((item) => item.code === expectedCode), JSON.stringify(result.errors));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
}

test("rejects symlink escape", async () => {
  const { rootDir, asset } = await fixture();
  const outside = resolve(rootDir, "..", "outside.webp");
  try {
    await cp(resolve(rootDir, "office.webp"), outside);
    await rm(resolve(rootDir, "office.webp"));
    await symlink(outside, resolve(rootDir, "office.webp"));
    const result = await validateManifest({ rootDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === "asset_path_escape"), JSON.stringify(result.errors));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
  void asset;
});

test("rejects malformed manifest fields and dimensions", async () => {
  const { rootDir, asset } = await fixture();
  try {
    await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 2, assets: [asset] }));
    let result = await validateManifest({ rootDir });
    assert.equal(result.ok, false);
    await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, assets: [{ ...asset, frames: [1] }] }));
    result = await validateManifest({ rootDir });
    assert.ok(result.errors.some((item) => item.code === "asset_frames_empty"));
    await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, assets: [{ ...asset, width: 1 }] }));
    result = await validateManifest({ rootDir });
    assert.ok(result.errors.some((item) => item.code === "asset_hash_mismatch"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rejects an asset set above the gzip budget", async () => {
  const { rootDir, asset } = await fixture();
  try {
    await writeFile(resolve(rootDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, assets: Array.from({ length: 2_501 }, (_, index) => ({ ...asset, id: `office-${index}` })) }));
    const result = await validateManifest({ rootDir });
    assert.ok(result.errors.some((item) => item.code === "asset_budget_exceeded"), JSON.stringify(result.errors));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
