import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeFramePolicy } from "../src/virtual-office/frame-policy";

class Clock {
  nowMs = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  next = 1;
  now = () => this.nowMs;
  setTimeout = (callback: () => void, delayMs: number) => { const id = this.next++; this.timers.set(id, { at: this.nowMs + delayMs, callback }); return id; };
  clearTimeout = (handle: unknown) => { this.timers.delete(handle as number); };
  advance(ms: number) { this.nowMs += ms; for (const [id, timer] of [...this.timers]) if (timer.at <= this.nowMs) { this.timers.delete(id); timer.callback(); } }
}

test("frame policy enters idle after inactivity and resumes on activity", () => {
  const clock = new Clock();
  const modes: string[] = [];
  const policy = createOfficeFramePolicy({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, idleAfterMs: 30_000, onModeChange: (mode) => modes.push(mode) });
  policy.start();
  assert.equal(policy.getMode(), "active");
  clock.advance(30_000);
  assert.equal(policy.getMode(), "idle");
  policy.markActivity();
  assert.equal(policy.getMode(), "active");
  assert.deepEqual(modes, ["idle", "active"]);
});

test("hidden and reduced-motion modes stop animation without losing React actions", () => {
  const clock = new Clock();
  const policy = createOfficeFramePolicy({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  policy.start();
  policy.setVisible(false);
  assert.equal(policy.getMode(), "hidden");
  policy.setVisible(true);
  policy.setReducedMotion(true);
  assert.equal(policy.getMode(), "reduced-motion");
  policy.setReducedMotion(false);
  assert.equal(policy.getMode(), "active");
  policy.stop();
  assert.equal(clock.timers.size, 0);
});
