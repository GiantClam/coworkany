import assert from "node:assert/strict";
import test from "node:test";
import { officeSceneEnabled } from "../src/virtual-office/renderer-gate";

test("production keeps React as the default until Pixi is explicitly enabled", () => {
  assert.equal(officeSceneEnabled({}), false);
  assert.equal(officeSceneEnabled({ DEV: false }), false);
  assert.equal(officeSceneEnabled({ DEV: false, VITE_COWORKANY_VIRTUAL_OFFICE_PIXI: "1" }), true);
  assert.equal(officeSceneEnabled({ DEV: false, VITE_COWORKANY_VIRTUAL_OFFICE_PIXI: "true" }), false);
});

test("development previews Pixi and the zero flag disables it in every environment", () => {
  assert.equal(officeSceneEnabled({ DEV: true }), true);
  assert.equal(officeSceneEnabled({ DEV: true, VITE_COWORKANY_VIRTUAL_OFFICE_PIXI: "0" }), false);
  assert.equal(officeSceneEnabled({ DEV: false, VITE_COWORKANY_VIRTUAL_OFFICE_PIXI: "0" }), false);
});
