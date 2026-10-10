import assert from "node:assert/strict";
import test from "node:test";
import { getOfficeDeviceSlots } from "../src/virtual-office/office-scene";
import type { OfficeDeviceState } from "../src/virtual-office/types";

const devices: OfficeDeviceState[] = [
  { deviceId: "one", workItemKey: { sourceAdapterId: "runs", workItemId: "one" }, visualStatus: "running" },
  { deviceId: "two", workItemKey: { sourceAdapterId: "runs", workItemId: "two" }, visualStatus: "waiting" },
  { deviceId: "three", workItemKey: { sourceAdapterId: "runs", workItemId: "three" }, visualStatus: "completed" },
  { deviceId: "four", workItemKey: { sourceAdapterId: "runs", workItemId: "four" }, visualStatus: "failed" },
];

test("scene device slots preserve projected identity, terminal visual status, and overflow", () => {
  const slots = getOfficeDeviceSlots({ devices, overflowCount: 1 });
  assert.equal(slots.devices.length, 3);
  assert.strictEqual(slots.devices[0], devices[0]);
  assert.deepEqual(slots.devices.map((device) => device.visualStatus), ["running", "waiting", "completed"]);
  assert.equal(slots.overflowCount, 1);
});
