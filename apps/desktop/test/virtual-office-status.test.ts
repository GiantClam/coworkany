import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchRunAttemptSummary, WorkbenchRunDetail } from "@coworkany/workbench-client";
import { aggregateRecoverableAttempts, resolveOfficeStatus } from "../src/virtual-office/status";

const attempt = (overrides: Partial<WorkbenchRunAttemptSummary>): WorkbenchRunAttemptSummary => ({ runId: "r1", nodeKey: "node", idempotencyKey: "key", status: "running", providerTaskId: "provider", updatedAt: "2026-01-01T00:00:00Z", ...overrides });
const detail = (status: string, events: WorkbenchRunDetail["events"] = []): WorkbenchRunDetail => ({ run: { id: "r1", conversationId: "c1", status: status as never, startedAt: "2026-01-01T00:00:00Z" }, nodes: [], events, usage: [] });

test("recoverable attempts select newest retry per node and aggregate deterministically", () => {
  assert.deepEqual(aggregateRecoverableAttempts([attempt({ nodeKey: "a", idempotencyKey: "old", status: "running" }), attempt({ nodeKey: "a", idempotencyKey: "new", status: "submitted", updatedAt: "2026-01-01T00:01:00Z" }), attempt({ nodeKey: "b", status: "download_failed" })]), { status: "waiting", attention: "external", statusVersion: "b/key/download_failed/2026-01-01T00:00:00Z" });
});

test("office status prioritizes terminal, user permission and provider evidence", () => {
  assert.equal(resolveOfficeStatus(detail("interrupted"), []).status, "failed");
  assert.deepEqual(resolveOfficeStatus(detail("running", [{ sequence: 1, eventType: "tool_call", payloadJson: JSON.stringify({ phase: "blocked", approvalId: "p1" }), createdAt: "" }]), []).status, "waiting");
  assert.equal(resolveOfficeStatus(detail("running"), [attempt({ status: "running" })]).status, "running");
  assert.equal(resolveOfficeStatus(detail("queued"), []).status, "queued");
  assert.equal(resolveOfficeStatus(detail("running"), []).status, "running");
});
