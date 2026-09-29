import test from "node:test";
import assert from "node:assert/strict";
import { shouldSubmitPromptInput } from "../src/ai-elements/prompt-input-shortcut";

test("submits only for Ctrl+Enter outside composition", () => {
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: true, shiftKey: false, isComposing: false }, false), true);
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: false, shiftKey: false, isComposing: false }, false), false);
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: true, shiftKey: true, isComposing: false }, false), false);
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: true, shiftKey: false, isComposing: true }, false), false);
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: true, shiftKey: false, isComposing: false }, true), false);
  assert.equal(shouldSubmitPromptInput({ key: "Enter", ctrlKey: false, shiftKey: false, isComposing: false }, false), false);
  assert.equal(shouldSubmitPromptInput({ key: "x", ctrlKey: true, shiftKey: false, isComposing: false }, false), false);
});
