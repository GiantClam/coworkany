import assert from "node:assert/strict";
import test from "node:test";
import { reduceOfficeSurfaceState } from "../src/virtual-office/office-surface-state";

test("renderer failures return to the complete React surface", () => {
  const loading = reduceOfficeSurfaceState({ kind: "react-ready" }, { type: "pixi-load" });
  assert.equal(loading.kind, "pixi-loading");
  const failed = reduceOfficeSurfaceState(loading, { type: "asset-load-failed", error: "missing atlas" });
  assert.deepEqual(failed, { kind: "react-ready", error: "missing atlas" });
  const ready = reduceOfficeSurfaceState(loading, { type: "pixi-ready" });
  assert.equal(ready.kind, "pixi-ready");
});
