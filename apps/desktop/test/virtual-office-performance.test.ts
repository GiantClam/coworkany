import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createOfficeProjector } from "../src/virtual-office/projector";
import { OFFICE_ROLE_REGISTRY } from "../src/virtual-office/role-registry";
import type { OfficeClock, OfficeStatus, OfficeWorkItem } from "../src/virtual-office/types";

const clock: OfficeClock = { now: () => 0, setTimeout: () => 1, clearTimeout: () => undefined };
const roles = OFFICE_ROLE_REGISTRY;
const statuses: readonly OfficeStatus[] = ["queued", "running", "waiting"];

function seededSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function createFixture() {
  assert.equal(roles.length, 7, "the benchmark fixture must cover all seven office roles");
  const next = seededSequence(0xc0774a11);
  const items: OfficeWorkItem[] = Array.from({ length: 50 }, (_, index) => {
    const role = roles[index % roles.length];
    return {
      sourceAdapterId: role.sourceAdapterId,
      workItemId: `benchmark-${index}`,
      roleId: role.roleId,
      status: statuses[next() % statuses.length] ?? "running",
      statusVersion: "1",
      title: `Benchmark item ${index}`,
      updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      artifactIds: [],
    };
  });
  const changes = Array.from({ length: 10 }, (_, index) => {
    const item = items[(next() + index) % items.length] as OfficeWorkItem;
    return {
      ...item,
      status: statuses[next() % statuses.length] ?? "running",
      statusVersion: String(index + 2),
    } satisfies OfficeWorkItem;
  });
  return { items, changes };
}

test("projects the fixed seven-role workload within the 50ms p95 budget", () => {
  const { items, changes } = createFixture();
  const projector = createOfficeProjector({ clock, roles });
  const project = () => {
    projector.hydrate(items);
    for (const item of changes) projector.apply({ kind: "upsert", item });
  };

  for (let run = 0; run < 50; run += 1) project();

  const durations: number[] = [];
  for (let run = 0; run < 200; run += 1) {
    const start = performance.now();
    project();
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
  console.log(`projection_p95_ms=${p95.toFixed(3)}`);
  assert.ok(p95 <= 50, `projection p95 took ${p95}ms`);
  projector.dispose();
});
