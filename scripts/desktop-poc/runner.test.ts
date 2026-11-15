import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expandRunId } from "./canonical";
import { runScenario, MockScenarioAdapter, selectRunWindow, snapshotContainsTarget, snapshotContainsText, snapshotObservation, snapshotPropertyValue, snapshotTargetRefs, unwrapAgentDesktopProperty } from "./runner";
import scenario from "./scenarios/workflow-persistence.json";

function plan() {
  return {
    schemaVersion: 1,
    scenarioId: "runner-fixture",
    title: "Runner fixture",
    preconditions: [],
    steps: [
      { actor: "operator", action: "launch", stepId: "launch", timeoutMs: 1000 },
      { actor: "desktop-agent", action: "type", stepId: "title", timeoutMs: 1000, target: { pocId: "workflow-title" }, value: "${runId}" },
      { actor: "desktop-agent", action: "click", stepId: "save", timeoutMs: 1000, target: { pocId: "save-workflow" } },
      { actor: "desktop-agent", action: "capture", stepId: "capture", timeoutMs: 1000, target: { pocId: "workflow-builder" }, captureAs: "before" },
      { actor: "desktop-agent", action: "assert", stepId: "assert", timeoutMs: 1000, target: { pocId: "workflow-title" }, assertion: { kind: "value", expected: { $ref: "before.title" }, captureAs: "observed.title" } },
    ],
    assertions: [],
    cleanup: [
      { actor: "operator", action: "stop", stepId: "stop", timeoutMs: 1000 },
      { actor: "operator", action: "cleanup", stepId: "cleanup", timeoutMs: 1000 },
    ],
    stopConditions: [],
  };
}

test("runScenario expands placeholders, writes one timeline event per step, and always cleans up", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-runner-"));
  const adapter = new MockScenarioAdapter();
  try {
    const result = await runScenario({ plan: plan(), runId: "run-fixture", evidenceRoot: root, adapter, repoRoot: process.cwd() });
    assert.equal(result.ok, true);
    assert.equal(adapter.values.cleaned, true);
    assert.equal(adapter.executed.at(-1), "cleanup");
    const lines = (await readFile(join(root, "timeline.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 7);
    assert.ok(lines.every((line) => JSON.parse(line).startedAt !== JSON.parse(line).finishedAt || JSON.parse(line).result === "passed"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "passed");
    assert.equal(manifest.timelineEvents, 7);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runScenario records a failure card but still runs declared cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-runner-failure-"));
  const adapter = new MockScenarioAdapter("save");
  try {
    const result = await runScenario({ plan: plan(), runId: "run-failure", evidenceRoot: root, adapter, repoRoot: process.cwd() });
    assert.equal(result.ok, false);
    assert.ok(result.failureCardPath);
    assert.equal(adapter.executed.at(-1), "cleanup");
    const card = JSON.parse(await readFile(join(root, "failure-card.json"), "utf8"));
    assert.equal(card.stepId, "save");
    assert.equal(card.eligibleForRepair, true);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.cleanup.completed, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runId expansion is recursive and does not leave an unresolved placeholder", () => {
  const value = expandRunId({ nested: [{ text: "POC-${runId}" }], expected: { value: "${runId}" } }, "run-123");
  assert.deepEqual(value, { nested: [{ text: "POC-run-123" }], expected: { value: "run-123" } });
});

test("snapshot target matching accepts a non-actionable semantic container", () => {
  const snapshot = { tree: { role: "group", name: "工作流", native_id: { value: "poc-workflow-directory" }, children: [] } };
  assert.equal(snapshotContainsTarget(snapshot, { pocId: "workflow-directory", role: "group", name: "工作流" }), true);
});

test("agent-desktop property envelopes are unwrapped before idempotence and assertions", () => {
  assert.equal(unwrapAgentDesktopProperty({ property: "value", value: "draft" }), "draft");
  assert.equal(unwrapAgentDesktopProperty({ value: false }), false);
  assert.deepEqual(unwrapAgentDesktopProperty({ property: "bounds", value: { x: 1 } }), { x: 1 });
  assert.equal(unwrapAgentDesktopProperty("draft"), "draft");
});

test("capture can read a stable non-interactive PoC node without an action ref", () => {
  const snapshot = { tree: { role: "group", native_id: { value: "poc-workflow-builder" }, children: [{ native_id: { value: "poc-workflow-definition-hash" }, value: "hash-123" }] } };
  assert.deepEqual(snapshotObservation(snapshot, { pocId: "workflow-builder" }), {});
  assert.deepEqual(snapshotObservation(snapshot, { pocId: "workflow-definition-hash" }), { text: "hash-123", value: "hash-123" });
});

test("capture falls back to the hash output's accessible name when AX omits its DOM id", () => {
  const snapshot = { tree: { role: "statictext", name: "Workflow definition hash", value: "hash-456" } };
  assert.deepEqual(snapshotObservation(snapshot, { pocId: "workflow-definition-hash" }), { text: "hash-456", value: "hash-456", title: "Workflow definition hash" });
});

test("assertions fall back to rendered semantic text when get returns null", () => {
  const snapshot = { tree: { role: "button", native_id: { value: "poc-workflow-save" }, name: "已保存" } };
  assert.equal(snapshotPropertyValue(snapshot, { pocId: "save-workflow" }, "text"), "已保存");
});

test("hash captures prefer a descendant output value over its accessible label", () => {
  const snapshot = { tree: { role: "status", name: "Workflow definition hash", native_id: { value: "poc-workflow-definition-hash" }, children: [{ role: "statictext", name: "hash-789", value: "hash-789" }] } };
  assert.deepEqual(snapshotObservation(snapshot, { pocId: "workflow-definition-hash" }), { text: "hash-789", value: "hash-789", title: "Workflow definition hash" });
  assert.equal(snapshotPropertyValue(snapshot, { pocId: "workflow-definition-hash" }, "text"), "hash-789");
});

test("directory card existence is case-insensitive to CSS text transforms", () => {
  const snapshot = { tree: { role: "article", name: "POC-RUN-ABC", children: [{ role: "button", name: "打开工作流 POC-run-abc" }] } };
  assert.equal(snapshotContainsText(snapshot, "POC-run-abc"), true);
});

test("action refs come from the authorized snapshot for composed workflow labels", () => {
  const snapshot = { tree: { role: "button", name: "打开工作流 POC-run-ABC", ref_id: "@snapshot:e1", available_actions: ["Click"] } };
  assert.deepEqual(snapshotTargetRefs(snapshot, { pocId: "open-workflow", role: "button", name: "POC-run-abc" }), ["@snapshot:e1"]);
});

test("native window binding selects the run-owned instance when another CoworkAny is open", () => {
  const windows = [
    { id: "release-window", pid: 9000, accessible: true, title: "CoworkAny" },
    { id: "poc-window", pid: 9100, accessible: true, title: "CoworkAny" },
  ];
  assert.equal(selectRunWindow(windows, new Set([9100]))?.id, "poc-window");
  assert.equal(selectRunWindow(windows, new Set([9999])), undefined);
  assert.equal(selectRunWindow([{ id: "only-window", pid: 9000 }], new Set())?.id, "only-window");
});

test("the committed workflow persistence scenario completes with the deterministic adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-scenario-"));
  try {
    const result = await runScenario({ plan: scenario, runId: "run-scenario-fixture", evidenceRoot: root, adapter: new MockScenarioAdapter(), repoRoot: process.cwd() });
    assert.equal(result.ok, true);
    assert.equal(result.manifest.cleanup.completed, true);
    assert.equal(result.manifest.mainSteps, 34);
  } finally { await rm(root, { recursive: true, force: true }); }
});
