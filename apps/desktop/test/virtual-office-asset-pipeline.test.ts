import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { buildVirtualOfficeAssets } from "../scripts/build-virtual-office-assets.mjs";

const sourceDir = resolve("../../docs/superpowers/assets/drafts/2026-10-10-virtual-studio");
const roleIds = [
  "ai-chat",
  "agent-center",
  "ppt-expert",
  "workflow-operator",
  "writer",
  "image-creator",
  "video-producer",
] as const;

async function readManifest(outputDir: string) {
  return JSON.parse(await readFile(resolve(outputDir, "manifest.json"), "utf8")) as {
    schemaVersion: number;
    roles: string[];
    assets: Array<{
      id: string;
      path: string;
      width: number;
      height: number;
      format: string;
      hasAlpha: boolean;
      roleIds?: string[];
      states?: string[];
      regions?: Array<Record<string, unknown>>;
      clips?: string[];
      sha256: string;
    }>;
  };
}

test("converts the approved source families into deterministic runtime assets", async () => {
  const first = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-first-"));
  const second = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-second-"));
  try {
    await buildVirtualOfficeAssets({ sourceDir, outputDir: first });
    await buildVirtualOfficeAssets({ sourceDir, outputDir: second });

    const manifest = await readManifest(first);
    const secondManifest = await readManifest(second);
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.roles, roleIds);
    assert.deepEqual(manifest.assets.map((asset) => asset.id), [
      "office",
      "characters",
      "workstations",
      "workstations-front",
      "displays",
      "rig",
    ]);
    assert.deepEqual(manifest.assets.map((asset) => asset.sha256), secondManifest.assets.map((asset) => asset.sha256));

    const expectedDimensions = {
      office: [2172, 724],
      characters: [896, 128],
      workstations: [896, 288],
      "workstations-front": [896, 288],
      displays: [1536, 1024],
    } as const;
    for (const [id, [width, height]] of Object.entries(expectedDimensions)) {
      const asset = manifest.assets.find((entry) => entry.id === id);
      assert.ok(asset, `manifest entry missing: ${id}`);
      assert.equal(asset.width, width);
      assert.equal(asset.height, height);
      assert.equal(asset.format, "webp");
      assert.equal(asset.hasAlpha, true);
      const metadata = await sharp(resolve(first, asset.path)).metadata();
      assert.equal(metadata.width, width);
      assert.equal(metadata.height, height);
      assert.equal(metadata.hasAlpha, true);
    }

    const characterAsset = manifest.assets.find((asset) => asset.id === "characters");
    assert.deepEqual(characterAsset?.roleIds, roleIds);
    assert.equal(characterAsset?.regions?.length, roleIds.length);
    assert.deepEqual(characterAsset?.regions?.map((region) => region.roleId), roleIds);

    for (const id of ["workstations", "workstations-front"]) {
      const asset = manifest.assets.find((entry) => entry.id === id);
      assert.deepEqual(asset?.roleIds, roleIds);
      assert.deepEqual(asset?.states, ["available", "active", "offline"]);
      assert.equal(asset?.regions?.length, roleIds.length * 3);
    }

    const displayAsset = manifest.assets.find((asset) => asset.id === "displays");
    assert.deepEqual(displayAsset?.regions?.map((region) => region.id), [
      "main-front",
      "side-angle",
      "stand-front",
      "stand-side",
      "status-available",
      "status-active",
      "status-offline",
    ]);

    const rigAsset = manifest.assets.find((asset) => asset.id === "rig");
    assert.deepEqual(rigAsset?.clips, ["idle", "walk", "work", "thinking", "waiting", "completed", "error"]);
    const rig = JSON.parse(await readFile(resolve(first, "rig-animation-data.json"), "utf8")) as { bones: Array<{ name: string }>; clips: Record<string, unknown> };
    assert.deepEqual(rig.bones.map((bone) => bone.name), ["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"]);
    assert.deepEqual(Object.keys(rig.clips), ["idle", "walk", "work", "thinking", "waiting", "completed", "error"]);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("fails when an approved input is missing or not RGBA", async () => {
  const missingSource = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-missing-source-"));
  const badSource = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-bad-source-"));
  const outputDir = await mkdtemp(resolve(tmpdir(), "virtual-office-assets-output-"));
  try {
    await assert.rejects(() => buildVirtualOfficeAssets({ sourceDir: missingSource, outputDir }), /missing approved input/u);
    await cp(sourceDir, badSource, { recursive: true });
    await sharp(resolve(badSource, "display-source-art-v1.png")).removeAlpha().png().toFile(resolve(badSource, "display-source-art-v1-rgb.png"));
    await rm(resolve(badSource, "display-source-art-v1.png"));
    await cp(resolve(badSource, "display-source-art-v1-rgb.png"), resolve(badSource, "display-source-art-v1.png"));
    await assert.rejects(() => buildVirtualOfficeAssets({ sourceDir: badSource, outputDir }), /RGBA/u);
  } finally {
    await rm(missingSource, { recursive: true, force: true });
    await rm(badSource, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
});
