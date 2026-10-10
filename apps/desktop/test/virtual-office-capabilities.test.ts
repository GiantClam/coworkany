import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficeCapabilities, createAgentDirectoryHealthSource, createCapabilityHealthSources, type MediaRuntimeProbe, type MediaRuntimeReader } from "../src/virtual-office/capabilities";
import { createOfficeProjector } from "../src/virtual-office/projector";
import { enabledOfficeRoles } from "../src/virtual-office/role-registry";

const configuredCapabilities = buildOfficeCapabilities({
  routes: new Set(["/dashboard/image-assistant", "/dashboard/video"]),
  providers: { image: "configured", video: "configured" },
});

test("capability health preserves explicit provider unavailability and directory read failures", async () => {
  const provider = createCapabilityHealthSources({ providers: { image: "unavailable", video: "configured" }, routes: new Set(), featureFlags: new Set(), runtime: { text: true, agents: true, workflows: true }, agentDirectoryReady: false });
  assert.equal(await provider.find((source) => source.id === "provider:image")?.snapshot().then((health) => health.status), "offline");
  assert.equal(await provider.find((source) => source.id === "provider:video")?.snapshot().then((health) => health.status), "unknown");
  const directory = createAgentDirectoryHealthSource({ read: async () => ({ status: "unknown" as const, reason: "read failed" }), getSnapshot: () => undefined, clear: () => undefined });
  assert.equal((await directory.snapshot()).status, "unknown");
});

test("capability health uses one local runtime read for image and video snapshots", async () => {
  let reads = 0;
  let release: ((value: { node: boolean; host: boolean; media: boolean }) => void) | undefined;
  const runtimeRead = new Promise<{ node: boolean; host: boolean; media: boolean }>((resolve) => { release = resolve; });
  const provider = createCapabilityHealthSources(configuredCapabilities, {
    read: async () => { reads += 1; return runtimeRead; },
  });
  const imageSnapshot = provider.find((source) => source.id === "provider:image")?.snapshot();
  const videoSnapshot = provider.find((source) => source.id === "provider:video")?.snapshot();
  release?.({ node: true, host: true, media: true });
  const [image, video] = await Promise.all([imageSnapshot, videoSnapshot]);
  assert.equal(reads, 1);
  assert.equal(image?.status, "unknown");
  assert.equal(video?.status, "unknown");
  assert.equal(image?.reason, "provider_availability_unobserved");
  assert.equal(video?.reason, "provider_availability_unobserved");
});

test("capability health reports only explicit local prerequisite failures as offline", async () => {
  const provider = createCapabilityHealthSources(configuredCapabilities, {
    read: async () => ({ node: true, host: true, media: false }),
  });
  const image = await provider.find((source) => source.id === "provider:image")?.snapshot();
  const video = await provider.find((source) => source.id === "provider:video")?.snapshot();
  assert.equal(image?.status, "unknown");
  assert.equal(video?.status, "offline");
  assert.equal(video?.reason, "runtime_unavailable");

  for (const prerequisite of ["node", "host"] as const) {
    const unavailable = createCapabilityHealthSources(configuredCapabilities, { read: async () => ({ [prerequisite]: false }) });
    const health = await Promise.all(unavailable.map((source) => source.snapshot()));
    assert.ok(health.every((item) => item.status === "offline" && item.reason === "runtime_unavailable"));
  }
});

test("capability health keeps rejected, missing, and malformed runtime reads unknown", async () => {
  const malformedReads: MediaRuntimeReader["read"][] = [
    async () => undefined,
    async () => ({ ready: false } as unknown as MediaRuntimeProbe),
    async () => ({ node: true }),
    async () => ({ node: true, host: "unknown" } as unknown as MediaRuntimeProbe),
  ];
  for (const read of malformedReads) {
    const provider = createCapabilityHealthSources(configuredCapabilities, { read });
    const image = await provider[0]?.snapshot();
    assert.equal(image?.status, "unknown");
    assert.equal(image?.reason, "runtime_status_unavailable");
  }

  const rejected = createCapabilityHealthSources(configuredCapabilities, {
    read: async () => { throw new Error("runtime_status_failed"); },
  });
  assert.equal((await rejected[0]?.snapshot())?.status, "unknown");
});

test("runtime health can recover and ignores unrelated aggregate readiness", async () => {
  let runtime = { ready: false, node: false, host: true, media: true };
  let reads = 0;
  const sources = createCapabilityHealthSources(configuredCapabilities, { read: async () => { reads += 1; return runtime; } });
  assert.ok((await Promise.all(sources.map((source) => source.snapshot()))).every((health) => health.status === "offline"));
  runtime = { ready: false, node: true, host: true, media: true };
  assert.ok((await Promise.all(sources.map((source) => source.snapshot()))).every((health) => health.status === "unknown" && health.reason === "provider_availability_unobserved"));
  assert.equal(reads, 2);
});

test("configured media roles remain visible when local health is offline or unknown", async () => {
  const projector = createOfficeProjector({
    roles: enabledOfficeRoles(configuredCapabilities),
    clock: { now: () => 0, setTimeout: () => 0, clearTimeout() {} },
  });
  for (const sourceId of ["runs", "run-details", "attempts"] as const) {
    projector.apply({ kind: "source-health", health: { sourceId, status: "ready", observedAt: "2026-10-10T00:00:00Z" } });
  }
  try {
    const offline = createCapabilityHealthSources(configuredCapabilities, { read: async () => ({ node: false }) });
    for (const health of await Promise.all(offline.map((source) => source.snapshot()))) projector.apply({ kind: "source-health", health });
    assert.deepEqual(projector.getSnapshot().roles.map((role) => [role.roleId, role.status, role.available]), [["image-creator", "offline", false], ["video-producer", "offline", false]]);
    const unknown = createCapabilityHealthSources(configuredCapabilities, { read: async () => undefined });
    for (const health of await Promise.all(unknown.map((source) => source.snapshot()))) projector.apply({ kind: "source-health", health });
    assert.deepEqual(projector.getSnapshot().roles.map((role) => [role.roleId, role.status]), [["image-creator", "unknown"], ["video-producer", "unknown"]]);
  } finally {
    projector.dispose();
  }
});
