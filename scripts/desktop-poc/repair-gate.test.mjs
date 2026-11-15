import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REPAIR_ROUNDS, validateRepairAttempt } from "./repair-gate.mjs";

const failureCard = { category: "persistence", eligibleForRepair: true, reproducible: true };

test("repair gate allows only bounded reproducible code repairs", () => {
  assert.equal(validateRepairAttempt({ round: 1, failureCard }).ok, true);
  assert.equal(validateRepairAttempt({ round: MAX_REPAIR_ROUNDS, failureCard }).ok, true);
  assert.equal(validateRepairAttempt({ round: MAX_REPAIR_ROUNDS + 1, failureCard }).code, "repair_round_limit_exceeded");
  assert.equal(validateRepairAttempt({ round: 1, failureCard: { ...failureCard, category: "environment" } }).code, "environment_failure_not_code_repair");
});

test("repair gate requires real passing verification before publication", () => {
  assert.equal(validateRepairAttempt({ round: 1, failureCard, phase: "verify", manifest: { status: "failed", cleanup: { completed: true } }, testResult: { ok: true } }).code, "verification_manifest_not_passed");
  assert.equal(validateRepairAttempt({ round: 1, failureCard, phase: "verify", manifest: { status: "passed", cleanup: { completed: true } }, testResult: { ok: true } }).action, "publish_candidate");
  assert.equal(validateRepairAttempt({ round: 1, failureCard, phase: "verify", manifest: { status: "passed", cleanup: { completed: false } }, testResult: { ok: true } }).code, "verification_cleanup_incomplete");
});
