import assert from "node:assert/strict";
import test from "node:test";
import { Application, Assets, Container, loadTextures, path as pixiPath, Texture } from "pixi.js";
import { getOfficeDeviceSlots } from "../src/virtual-office/office-scene";
import { loadOfficeTexture, officeAssetUrl } from "../src/virtual-office/office-layer-types";
import type { OfficeDeviceState } from "../src/virtual-office/types";

const devices: OfficeDeviceState[] = [
  { deviceId: "one", workItemKey: { sourceAdapterId: "runs", workItemId: "one" }, visualStatus: "running" },
  { deviceId: "two", workItemKey: { sourceAdapterId: "runs", workItemId: "two" }, visualStatus: "waiting" },
  { deviceId: "three", workItemKey: { sourceAdapterId: "runs", workItemId: "three" }, visualStatus: "completed" },
  { deviceId: "four", workItemKey: { sourceAdapterId: "runs", workItemId: "four" }, visualStatus: "failed" },
];

test("scene device slots preserve projected identity, terminal visual status, and overflow", () => {
  const slots = getOfficeDeviceSlots({ devices, overflowCount: 1 });
  assert.equal(slots.devices.length, 3);
  assert.strictEqual(slots.devices[0], devices[0]);
  assert.deepEqual(slots.devices.map((device) => device.visualStatus), ["running", "waiting", "completed"]);
  assert.equal(slots.overflowCount, 1);
});

test("office textures do not invoke blob workers blocked by the native CSP", async (t) => {
  const previous = loadTextures.config!.preferWorkers;
  loadTextures.config!.preferWorkers = true;
  t.after(() => { loadTextures.config!.preferWorkers = previous; });
  const loader = t.mock.method(Assets, "load", async (asset: unknown) => {
    assert.equal(loadTextures.config!.preferWorkers, false, "native texture loading must bypass the unresolved worker probe");
    assert.deepEqual(asset, {
      src: "/virtual-office/v1/characters.webp",
      data: { scaleMode: "linear", autoGenerateMipmaps: true },
    });
    return Texture.EMPTY;
  });
  const texture = await loadOfficeTexture({
    app: new Application(),
    root: new Container(),
    manifest: { schemaVersion: 1, assets: [] },
    callbacks: {},
  }, "characters.webp");
  assert.equal(texture, Texture.EMPTY);
  assert.equal(loader.mock.callCount(), 1);
});

test("texture URLs preserve the native protocol host through Pixi resolution", () => {
  for (const baseURI of ["tauri://localhost/dashboard/office", "http://127.0.0.1:1420/dashboard/office"]) {
    const expected = new URL("/virtual-office/v1/office.webp", baseURI).href;
    const src = officeAssetUrl("office.webp", baseURI);
    assert.equal(src, expected);
    assert.equal(pixiPath.toAbsolute(src, baseURI), expected);
  }
});
