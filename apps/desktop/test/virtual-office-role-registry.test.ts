import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficeCapabilities } from "../src/virtual-office/capabilities";
import { OFFICE_ROLE_REGISTRY, enabledOfficeRoles, officeRoleAvailable } from "../src/virtual-office/role-registry";
import type { OfficeWorkItem } from "../src/virtual-office/types";

const routeItem = (routeTarget?: string): OfficeWorkItem => ({
  sourceAdapterId: "test",
  workItemId: "test",
  roleId: "ai-chat",
  status: "running",
  statusVersion: "1",
  title: "Test",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...(routeTarget ? { routeTarget } : {}),
  artifactIds: [],
});

test("registry contains all seven roles with exact routes and health dependencies", () => {
  assert.deepEqual(OFFICE_ROLE_REGISTRY.map((role) => role.roleId), ["ai-chat", "agent-center", "ppt-expert", "workflow-operator", "writer", "image-creator", "video-producer"]);
  assert.deepEqual(Object.fromEntries(OFFICE_ROLE_REGISTRY.map((role) => [role.roleId, role.homeRoute])), { "ai-chat": "/dashboard/ai", "agent-center": "/dashboard/agent-platform", "ppt-expert": "/dashboard/ai?agent=executive-ppt", "workflow-operator": "/dashboard/workflows", writer: "/dashboard/writer", "image-creator": "/dashboard/image-assistant", "video-producer": "/dashboard/video" });
  assert.deepEqual(Object.fromEntries(OFFICE_ROLE_REGISTRY.map((role) => [role.roleId, role.sourceAdapterId])), { "ai-chat": "conversation-runs", "agent-center": "agent-runs", "ppt-expert": "ppt-runs", "workflow-operator": "workflow-runs", writer: "writer-runs", "image-creator": "image-runs", "video-producer": "video-runs" });
  assert.deepEqual(Object.fromEntries(OFFICE_ROLE_REGISTRY.map((role) => [role.roleId, role.healthSourceIds])), { "ai-chat": ["conversations", "runs", "run-details"], "agent-center": ["conversations", "runs", "run-details", "agent-directory"], "ppt-expert": ["conversations", "runs", "run-details"], "workflow-operator": ["runs", "run-details", "attempts"], writer: ["conversations", "runs", "run-details"], "image-creator": ["runs", "run-details", "attempts", "provider:image"], "video-producer": ["runs", "run-details", "attempts", "provider:video"] });
});

test("route-backed roles remain visible while capability gates control availability", () => {
  const routes = new Set(["/dashboard/ai", "/dashboard/agent-platform", "/dashboard/workflows", "/dashboard/writer", "/dashboard/image-assistant", "/dashboard/video"]);
  const base = buildOfficeCapabilities({ routes, runtime: { text: true, agents: true, workflows: true }, featureFlags: new Set(["ppt_generate"]), providers: { image: "configured", video: "configured" }, agentDirectoryReady: true });
  assert.equal(enabledOfficeRoles(base).length, 7);
  const degraded = buildOfficeCapabilities({ ...base, runtime: { text: false, agents: false, workflows: true }, featureFlags: new Set(), providers: { image: "unconfigured", video: "unavailable" }, agentDirectoryReady: false });
  assert.equal(enabledOfficeRoles(degraded).length, 7);
  assert.equal(officeRoleAvailable(degraded, OFFICE_ROLE_REGISTRY.find((role) => role.roleId === "agent-center")!), false);
  assert.equal(officeRoleAvailable(degraded, OFFICE_ROLE_REGISTRY.find((role) => role.roleId === "ppt-expert")!), false);
  assert.equal(officeRoleAvailable(degraded, OFFICE_ROLE_REGISTRY.find((role) => role.roleId === "writer")!), false);
  assert.equal(officeRoleAvailable(degraded, OFFICE_ROLE_REGISTRY.find((role) => role.roleId === "image-creator")!), false);
  assert.equal(officeRoleAvailable(degraded, OFFICE_ROLE_REGISTRY.find((role) => role.roleId === "video-producer")!), false);
  assert.ok(enabledOfficeRoles(buildOfficeCapabilities({ ...base, routes: new Set([...routes].filter((route) => route !== "/dashboard/ai")), providers: { image: "configured", video: "configured" } })).every((role) => role.roleId !== "ai-chat" && role.roleId !== "ppt-expert"));
  assert.ok(!enabledOfficeRoles(buildOfficeCapabilities({ ...base, routes: new Set([...routes].filter((route) => route !== "/dashboard/video")) })).some((role) => role.roleId === "video-producer"));
});

test("each role references the manifest atlases and has the stable device contract", () => {
  assert.equal(new Set(OFFICE_ROLE_REGISTRY.map((role) => role.roleId)).size, 7);
  for (const role of OFFICE_ROLE_REGISTRY) {
    assert.equal(role.characterAssetId, "characters");
    assert.equal(role.workstationAssetId, "workstations");
    assert.equal(role.deviceLimit, 3);
    assert.ok(role.healthSourceIds.length > 0);
    assert.notEqual(role.workItemRoute(routeItem("/persisted/entry")), role.homeRoute);
    assert.equal(role.workItemRoute(routeItem()), role.homeRoute);
  }
});
