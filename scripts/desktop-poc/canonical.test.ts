import assert from "node:assert/strict";
import test from "node:test";
import { digestValue, expandRunId, redactedPath, stableJson } from "./canonical";

test("canonical evidence is key-order independent and redacts secrets", () => {
  const left = { z: 1, nested: { apiKey: "sk-secret-value", b: 2, a: 1 } };
  const right = { nested: { a: 1, b: 2, apiKey: "sk-other-value" }, z: 1 };
  assert.equal(stableJson(left), stableJson(right));
  assert.equal(digestValue(left), digestValue(right));
  assert.doesNotMatch(stableJson(left), /sk-secret-value|sk-other-value/u);
});

test("run identifiers expand recursively and paths do not expose the user home", () => {
  assert.deepEqual(expandRunId({ a: "${runId}", b: [{ c: "x-${runId}" }] }, "run-123"), { a: "run-123", b: [{ c: "x-run-123" }] });
  assert.equal(redactedPath("/Users/alice/Library/Application Support/CoworkAny/run.json"), "<USER_PATH>/Library/Application Support/CoworkAny/run.json");
  assert.equal(redactedPath("/tmp/run/evidence/manifest.json", "/tmp/run"), "<RUN_ROOT>/evidence/manifest.json");
});
