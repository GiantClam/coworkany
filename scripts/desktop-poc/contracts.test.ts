import assert from "node:assert/strict";
import test from "node:test";
import { validateScenarioPlan, validateSelectorResponse } from "./contracts";

const validPlan = {
  schemaVersion: 1,
  scenarioId: "contract-fixture",
  title: "Contract fixture",
  preconditions: [],
  steps: [{ actor: "desktop-agent", action: "click", stepId: "click", timeoutMs: 1000, target: { pocId: "save-workflow", role: "button" } }],
  assertions: [],
  cleanup: [{ actor: "operator", action: "stop", stepId: "stop", timeoutMs: 1000 }, { actor: "operator", action: "cleanup", stepId: "cleanup", timeoutMs: 1000 }],
  stopConditions: [],
};

test("scenario contracts reject executable or coordinate-bearing fields", () => {
  assert.throws(() => validateScenarioPlan({ ...validPlan, steps: [{ ...validPlan.steps[0], command: "rm -rf" }] }), /scenario_forbidden_field/);
  assert.throws(() => validateScenarioPlan({ ...validPlan, steps: [{ ...validPlan.steps[0], target: { pocId: "save-workflow", coordinate: "10,10" } }] }), /scenario_forbidden_field/);
  assert.throws(() => validateScenarioPlan({ ...validPlan, cleanup: [{ actor: "operator", action: "stop", stepId: "stop", timeoutMs: 1000 }] }), /scenario_cleanup_must_end_with_cleanup/);
});

test("selector can request observation without producing an executable action", () => {
  assert.deepEqual(validateSelectorResponse({ decision: "need_observation", reason: "The target is not unique" }), { decision: "need_observation", reason: "The target is not unique" });
  assert.deepEqual(validateSelectorResponse({ decision: "action", action: validPlan.steps[0] }), { decision: "action", action: validPlan.steps[0] });
  assert.throws(() => validateSelectorResponse({ decision: "need_observation", reason: "ok", action: validPlan.steps[0] }), /selector_unknown_field/);
});

test("scenario contracts keep cleanup as an explicit operator boundary", () => {
  const plan = validateScenarioPlan(validPlan);
  assert.equal(plan.cleanup.at(-1)?.action, "cleanup");
  assert.equal(plan.steps[0]?.actor, "desktop-agent");
});
