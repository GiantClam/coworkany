import assert from "node:assert/strict";
import test from "node:test";
import { activateOfficeWorkItem } from "../src/virtual-office/navigation";
import type { OfficeSnapshot, OfficeWorkItem } from "../src/virtual-office/types";

const items: OfficeWorkItem[] = [
  { sourceAdapterId: "workflow-runs", workItemId: "workflow-1", roleId: "workflow-operator", status: "running", statusVersion: "1", title: "Workflow", updatedAt: "2026-01-01T00:00:00.000Z", routeTarget: "/dashboard/workflows/run-1", artifactIds: [] },
  { sourceAdapterId: "conversation-runs", workItemId: "chat-1", roleId: "ai-chat", status: "running", statusVersion: "1", title: "Chat", updatedAt: "2026-01-01T00:00:00.000Z", routeTarget: "/dashboard/ai/chat-1", artifactIds: [] },
  { sourceAdapterId: "conversation-runs", workItemId: "chat-2", roleId: "ai-chat", status: "waiting", statusVersion: "1", title: "Chat without route", updatedAt: "2026-01-01T00:00:00.000Z", artifactIds: [] },
];
const snapshot: OfficeSnapshot = { roles: [], workItems: items, revision: 1 };

test("navigation uses persisted route, composite key and role-home fallback", () => {
  const routes: string[] = [];
  const navigation = { go: (route: string) => routes.push(route) };
  assert.deepEqual(activateOfficeWorkItem({ sourceAdapterId: "workflow-runs", workItemId: "workflow-1" }, snapshot, navigation), { ok: true, route: "/dashboard/workflows/run-1" });
  assert.deepEqual(activateOfficeWorkItem({ sourceAdapterId: "conversation-runs", workItemId: "chat-2" }, snapshot, navigation), { ok: true, route: "/dashboard/ai" });
  assert.deepEqual(routes, ["/dashboard/workflows/run-1", "/dashboard/ai"]);
});

test("unknown composite key does not navigate", () => {
  const routes: string[] = [];
  const result = activateOfficeWorkItem({ sourceAdapterId: "workflow-runs", workItemId: "chat-1" }, snapshot, { go: (route) => routes.push(route) });
  assert.deepEqual(result, { ok: false, reason: "not-found" });
  assert.deepEqual(routes, []);
});

test("artifact-only work items navigate through the existing asset preview route", () => {
  const routes: string[] = [];
  const artifactSnapshot: OfficeSnapshot = {
    roles: [],
    revision: 2,
    workItems: [{ ...items[2], artifactIds: ["artifact:image-1"] }],
  };
  assert.deepEqual(activateOfficeWorkItem({ sourceAdapterId: "conversation-runs", workItemId: "chat-2" }, artifactSnapshot, { go: (route) => routes.push(route) }), { ok: true, route: "/dashboard/assets?artifactId=artifact%3Aimage-1&preview=1" });
  assert.deepEqual(routes, ["/dashboard/assets?artifactId=artifact%3Aimage-1&preview=1"]);
});

test("navigation rejects work items whose role adapter is not registered", () => {
  const routes: string[] = [];
  const invalidSnapshot: OfficeSnapshot = {
    roles: [],
    revision: 3,
    workItems: [{ ...items[0], sourceAdapterId: "conversation-runs" }],
  };
  assert.deepEqual(activateOfficeWorkItem({ sourceAdapterId: "conversation-runs", workItemId: "workflow-1" }, invalidSnapshot, { go: (route) => routes.push(route) }), { ok: false, reason: "route-unavailable" });
  assert.deepEqual(routes, []);
});

test("navigation rejects a role omitted by the capability projection", () => {
  const routes: string[] = [];
  const unavailableSnapshot: OfficeSnapshot = {
    roles: [{ roleId: "workflow-operator", status: "offline", activeCount: 0, queuedCount: 0, waitingUserCount: 0, failedCount: 0, recentItems: [], devices: [], overflowCount: 0, available: false }],
    revision: 4,
    workItems: [items[0]],
  };
  assert.deepEqual(activateOfficeWorkItem({ sourceAdapterId: "workflow-runs", workItemId: "workflow-1" }, unavailableSnapshot, { go: (route) => routes.push(route) }), { ok: false, reason: "route-unavailable" });
  assert.deepEqual(routes, []);
});
