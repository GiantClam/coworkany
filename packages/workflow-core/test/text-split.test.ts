import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWorkflowText } from "../src";

test("splits text by blank lines and headings", () => {
  assert.deepEqual(splitWorkflowText("[Hook]\nfirst\n\n[Pain]\nsecond", "heading"), ["[Hook]\nfirst", "[Pain]\nsecond"]);
  assert.deepEqual(splitWorkflowText("one\n\ntwo\n\nthree"), ["one", "two", "three"]);
});

test("splits text with custom delimiters without changing content when trim is disabled", () => {
  assert.deepEqual(splitWorkflowText("a | b | c", "custom", "|", false), ["a ", " b ", " c"]);
});

test("splits text with a regular expression", () => {
  assert.deepEqual(splitWorkflowText("Hook: one\n---\nPain: two\n===\nCTA: three", "regex", "", true, "\\n(?:---|===)\\n"), ["Hook: one", "Pain: two", "CTA: three"]);
});
