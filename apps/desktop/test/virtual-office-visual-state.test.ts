import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeRoleState } from "../src/virtual-office/types";
import {
  OFFICE_WORK_THINKING_CYCLE_MS,
  resolveOfficeVisualPhase,
  resolveOfficeVisualState,
  type OfficeVisualState,
} from "../src/virtual-office/visual-state";

function roleState(overrides: Partial<Pick<OfficeRoleState, "status" | "available" | "activeCount" | "waitingUserCount">> = {}): Pick<OfficeRoleState, "status" | "available" | "activeCount" | "waitingUserCount"> {
  return {
    status: "idle",
    available: true,
    activeCount: 0,
    waitingUserCount: 0,
    ...overrides,
  };
}

test("visual state gives unavailable roles an offline pose", () => {
  assert.equal(resolveOfficeVisualState(roleState({ available: false, status: "idle" })), "offline");
  assert.equal(resolveOfficeVisualState(roleState({ available: true, status: "offline" })), "offline");
});

test("visual state maps failure, waiting, and completion to explicit poses", () => {
  assert.equal(resolveOfficeVisualState(roleState({ status: "failed" })), "error");
  assert.equal(resolveOfficeVisualState(roleState({ status: "cancelled" })), "error");
  assert.equal(resolveOfficeVisualState(roleState({ status: "waiting" })), "waiting");
  assert.equal(resolveOfficeVisualState(roleState({ status: "running", waitingUserCount: 1 })), "waiting");
  assert.equal(resolveOfficeVisualState(roleState({ status: "completed" })), "completed");
});

test("running work keeps a prior thinking phase stable across snapshots", () => {
  assert.equal(resolveOfficeVisualState(roleState({ status: "running", activeCount: 1 }), "thinking"), "thinking");
  assert.equal(resolveOfficeVisualState(roleState({ status: "running", activeCount: 1 }), "work"), "work");
  assert.equal(resolveOfficeVisualState(roleState({ status: "running", activeCount: 1 })), "work");
});

test("idle roles stay idle unless an active item is projected", () => {
  assert.equal(resolveOfficeVisualState(roleState()), "idle");
  assert.equal(resolveOfficeVisualState(roleState({ status: "idle", activeCount: 1 })), "work");
  assert.equal(resolveOfficeVisualState(roleState({ status: "unknown", activeCount: 1 })), "work");
});

test("a role becoming available after offline receives one walk transition", () => {
  const state = roleState();
  assert.equal(resolveOfficeVisualState(state, "offline"), "walk");
  assert.equal(resolveOfficeVisualState(state, "walk"), "idle");
  assert.equal(resolveOfficeVisualState(state, "idle"), "idle");
});

test("work and thinking phase is deterministic and wraps on a fixed cycle", () => {
  const state = roleState({ status: "running", activeCount: 1 });
  const cycle = OFFICE_WORK_THINKING_CYCLE_MS;
  assert.equal(resolveOfficeVisualPhase(state, 0), "work");
  assert.equal(resolveOfficeVisualPhase(state, cycle * 2), "work");
  assert.equal(resolveOfficeVisualPhase(state, 1_700), "thinking");
  assert.equal(resolveOfficeVisualPhase(state, 1_700 + cycle * 3), "thinking");
  assert.notEqual(resolveOfficeVisualPhase(state, 100), resolveOfficeVisualPhase(state, 1_700));
});

test("phase resolver preserves one-shot and terminal states", () => {
  assert.equal(resolveOfficeVisualPhase(roleState(), 1_700, "offline"), "walk");
  assert.equal(resolveOfficeVisualPhase(roleState({ status: "completed" }), 1_700), "completed");
  assert.equal(resolveOfficeVisualPhase(roleState({ status: "failed" }), 1_700), "error");
});

test("visual state union remains explicit for renderer consumers", () => {
  const states: OfficeVisualState[] = ["idle", "walk", "work", "thinking", "waiting", "completed", "error", "offline"];
  assert.equal(new Set(states).size, 8);
});
