import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JevSelector, JevSelectorError, buildJevSelectorRequest } from "./jev-selector";

const step = {
  actor: "desktop-agent" as const,
  action: "type" as const,
  stepId: "fill-title",
  timeoutMs: 10_000,
  target: { pocId: "workflow-title", role: "textbox" },
  value: "user-secret-value",
};

test("Jev request contains a redacted semantic snapshot and never the typed value", () => {
  const request = buildJevSelectorRequest({
    step,
    snapshot: { tree: { role: "textbox", name: "工作流标题", value: "user-secret-value", children: [] } },
  });
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(serialized, /user-secret-value/u);
  assert.equal(request.state.step.requestedValue?.length, 17);
  assert.equal(request.questions.decision.criteria.execute.length > 0, true);
});
test("Jev request resolves PoC IDs and AX textbox aliases without exposing the value", () => {
  const request = buildJevSelectorRequest({
    step,
    snapshot: {
      tree: {
        role: "textfield",
        name: "工作流标题",
        native_id: { value: "poc-workflow-title" },
        available_actions: ["SetValue", "TypeText", "SetFocus"],
      },
    },
  });
  assert.deepEqual(request.state.targetResolution, {
    status: "exact",
    matchCount: 1,
    matches: [{ role: "textfield", name: "工作流标题", nativeId: "poc-workflow-title", availableActions: ["SetValue", "TypeText", "SetFocus"] }],
    requestedAction: "type",
    requiredCapabilities: ["SetValue", "TypeText"],
    capabilityMatch: true,
  });
  assert.equal(request.state.step.target.nativeId, "poc-workflow-title");
  assert.deepEqual(request.state.step.target.roleAliases, ["textbox", "textfield"]);
  assert.doesNotMatch(JSON.stringify(request), /user-secret-value/u);
});

test("Jev select gate matches the native combobox capabilities", () => {
  const request = buildJevSelectorRequest({
    step: { ...step, action: "select", stepId: "set-draft-status", target: { pocId: "workflow-status", role: "combobox" }, value: "draft" },
    snapshot: {
      tree: {
        role: "combobox",
        name: "状态",
        native_id: { value: "poc-workflow-status" },
        available_actions: ["Click", "SetFocus", "Expand", "Collapse"],
      },
    },
  });
  assert.deepEqual(request.state.targetResolution.requiredCapabilities, ["Expand", "Collapse"]);
  assert.equal(request.state.targetResolution.capabilityMatch, true);
});

test("Jev resolves a workflow title inside the localized open button label", () => {
  const request = buildJevSelectorRequest({
    step: { ...step, action: "click", stepId: "open-saved-card", target: { pocId: "open-workflow", role: "button", name: "POC-run-123" }, value: undefined },
    snapshot: {
      tree: {
        role: "button",
        name: "打开工作流 POC-run-123",
        description: "打开工作流 POC-run-123",
        native_id: { value: "poc-workflow-open-123" },
        available_actions: ["Click", "SetFocus"],
      },
    },
  });
  assert.equal(request.state.targetResolution.status, "exact");
  assert.equal(request.state.targetResolution.matchCount, 1);
  assert.equal(request.state.targetResolution.capabilityMatch, true);
});

test("Jev selector parses an execute choice and writes redacted evidence", async () => {
  let request: unknown;
  const root = await mkdtemp(join(tmpdir(), "coworkany-jev-selector-"));
  try {
    const selector = new JevSelector({
      requireCredentials: false,
      runCommand: async (_command, _args, input) => {
        request = JSON.parse(input);
        return { code: 0, stdout: JSON.stringify({ ok: true, model: "jev-latest", answers: { decision: { type: "choice", choice: "execute" } }, usage: { input_tokens: 10 } }), stderr: "" };
      },
    });
    const result = await selector.select({ snapshot: { tree: { role: "button", name: "保存" } }, step, evidenceRoot: root });
    assert.equal(result.response.decision, "action");
    assert.equal(result.response.action.stepId, "fill-title");
    assert.ok(result.evidencePath);
    assert.equal((request as { questions: { decision: { type: string } } }).questions.decision.type, "choice");
    const evidence = await readFile(result.evidencePath!, "utf8");
    assert.doesNotMatch(evidence, /user-secret-value/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Jev selector preserves the observation decision for a bounded retry", async () => {
  const selector = new JevSelector({
    requireCredentials: false,
    runCommand: async () => ({ code: 0, stdout: JSON.stringify({ ok: true, answers: { decision: { choice: "need_observation" } } }), stderr: "" }),
  });
  const result = await selector.select({ snapshot: {}, step });
  assert.deepEqual(result.response, { decision: "need_observation", reason: "Jev requested a fresh accessibility observation before acting." });
});

test("native Jev selector fails closed without credentials", async () => {
  const selector = new JevSelector({ environment: {}, requireCredentials: true, runCommand: async () => { throw new Error("must not call API"); } });
  await assert.rejects(() => selector.select({ snapshot: {}, step }), (error: unknown) => error instanceof JevSelectorError && error.code === "jev_credentials_missing");
});
