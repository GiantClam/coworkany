import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopRunModel } from "../src/desktop-run-model";

test("prefers the model reported by the active provider", () => {
  assert.equal(resolveDesktopRunModel("provider/gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-sol"), "provider/gpt-6-luna");
});

test("preserves unknown for a mixed-model workflow instead of substituting the global chat model", () => {
  assert.equal(resolveDesktopRunModel(undefined, "unknown", "gpt-6.1-sol"), "unknown");
});

test("uses the selected node model for a single-model workflow", () => {
  assert.equal(resolveDesktopRunModel(undefined, "gpt-6-luna", "gpt-6.1-sol"), "gpt-6-luna");
});

test("uses the selected capability model when run tracking has no model", () => {
  assert.equal(resolveDesktopRunModel(undefined, undefined, "gpt-6.1-sol"), "gpt-6.1-sol");
});
