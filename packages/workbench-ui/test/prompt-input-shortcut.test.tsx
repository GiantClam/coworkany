import test from "node:test";
import assert from "node:assert/strict";
import { shouldSubmitPromptInput } from "../src/ai-elements/prompt-input-shortcut";

const enter = { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false };

test("keeps modifier-enter as the shared default", () => {
  assert.equal(shouldSubmitPromptInput(enter, false), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, ctrlKey: true }, false), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, metaKey: true }, false), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, ctrlKey: true, shiftKey: true }, false), false);
});

test("supports ChatGPT-style Enter send as an opt-in mode", () => {
  assert.equal(shouldSubmitPromptInput(enter, false, "enter"), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, shiftKey: true }, false, "enter"), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, isComposing: true }, false, "enter"), false);
  assert.equal(shouldSubmitPromptInput(enter, true, "enter"), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, key: "x" }, false, "enter"), false);
});
