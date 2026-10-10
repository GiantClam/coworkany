import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { validateBundle } from "../scripts/verify-virtual-office-bundle.mjs";

async function fixture(staticSource: string) {
  const dist = await mkdtemp(resolve(tmpdir(), "virtual-office-bundle-"));
  await mkdir(resolve(dist, "assets"));
  await writeFile(resolve(dist, "index.html"), '<script type="module" src="./assets/index.js"></script>');
  await writeFile(resolve(dist, "assets/index.js"), 'import "./desktop-app.js";');
  await writeFile(resolve(dist, "assets/desktop-app.js"), staticSource);
  await writeFile(resolve(dist, "assets/office-scene-test.js"), 'import { Application } from "pixi.js";');
  await mkdir(resolve(dist, ".vite"));
  await writeFile(resolve(dist, ".vite/manifest.json"), JSON.stringify({ main: { file: "assets/index.js", isEntry: true, imports: [] } }));
  return dist;
}

async function emptyEntryFixture() {
  const dist = await mkdtemp(resolve(tmpdir(), "virtual-office-bundle-empty-"));
  await mkdir(resolve(dist, "assets"));
  await writeFile(resolve(dist, "index.html"), "<!doctype html>");
  await writeFile(resolve(dist, "assets/office-scene-test.js"), 'import { Application } from "pixi.js";');
  return dist;
}

test("bundle verifier checks the complete static import closure", async () => {
  const dist = await fixture('import "./shared.js";');
  try {
    await writeFile(resolve(dist, "assets/shared.js"), 'import { Application } from "pixi.js";');
    const result = await validateBundle({ distDir: dist });
    assert.equal(result.ok, false);
    assert.equal(result.staticHasPixi, true);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("bundle verifier accepts a clean static closure with a dynamic Pixi scene", async () => {
  const dist = await fixture("export const ready = true;");
  try {
    const result = await validateBundle({ distDir: dist });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.staticFiles.sort(), ["desktop-app.js", "index.js"]);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("bundle verifier rejects a statically imported Pixi scene", async () => {
  const dist = await fixture('import "./office-scene-test.js";');
  try {
    const result = await validateBundle({ distDir: dist });
    assert.equal(result.ok, false);
    assert.equal(result.staticHasPixi, true);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("bundle verifier fails closed when no static entry is discoverable", async () => {
  const dist = await emptyEntryFixture();
  try {
    const result = await validateBundle({ distDir: dist });
    assert.equal(result.ok, false);
    assert.equal(result.manifestError, "manifest_missing");
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("bundle verifier rejects a malformed required Vite manifest", async () => {
  const dist = await fixture("export const ready = true;");
  try {
    await writeFile(resolve(dist, ".vite/manifest.json"), "[]");
    const result = await validateBundle({ distDir: dist });
    assert.equal(result.ok, false);
    assert.equal(result.manifestError, "manifest_invalid");
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("bundle verifier permits explicit HTML fallback for bounded fixtures", async () => {
  const dist = await fixture("export const ready = true;");
  try {
    await rm(resolve(dist, ".vite"), { recursive: true, force: true });
    const result = await validateBundle({ distDir: dist, allowMissingManifest: true });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
