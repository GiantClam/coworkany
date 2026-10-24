import assert from "node:assert/strict";
import test from "node:test";
import { createConversationRunsAdapter, createImageRunsAdapter, createRoleRunAdapter, createVideoRunsAdapter, createWorkflowRunsAdapter, createWriterRunsAdapter } from "../src/virtual-office/adapters/run-adapters";
import type { RunRecord } from "../src/virtual-office/types";

const record = (kind: "workflow" | "agent"): RunRecord => ({ run: { id: "r1", conversationId: "c1", status: "running", startedAt: "2026-01-01T00:00:00Z" }, conversation: { id: "c1", title: "工作", updatedAt: "", messageCount: 1 }, detail: { run: { id: "r1", conversationId: "c1", status: "running", startedAt: "2026-01-01T00:00:00Z" }, nodes: [], events: [], usage: [] }, metadata: { kind }, attempts: [] });
test("role adapters only project their own classified records", () => { assert.equal(createConversationRunsAdapter().toWorkItem(record("agent"))?.roleId, "ai-chat"); assert.equal(createWorkflowRunsAdapter().toWorkItem(record("workflow"))?.roleId, "workflow-operator"); assert.equal(createConversationRunsAdapter().toWorkItem(record("workflow")), null); });

test("PPT, writer, image, and video adapters preserve role routes and artifact evidence", () => {
  const base = (metadata: RunRecord["metadata"], agentId?: string): RunRecord => ({
    ...record("agent"),
    conversation: { ...record("agent").conversation!, ...(agentId ? { agentId } : {}) },
    metadata,
    detail: { ...record("agent").detail, events: [{ sequence: 1, eventType: "artifact", payloadJson: JSON.stringify({ artifact: { id: "artifact-1" } }), createdAt: "2026-01-01T00:00:00Z" }] },
  });
  const ppt = createRoleRunAdapter("ppt-expert").toWorkItem(base({ kind: "agent", featureId: "ppt_generate" }, "executive-ppt"));
  const writer = createWriterRunsAdapter().toWorkItem(base({ kind: "agent", featureId: "writer" }, "entry:writer"));
  const image = createImageRunsAdapter().toWorkItem(base({ kind: "media", featureId: "image_generate" }));
  const video = createVideoRunsAdapter().toWorkItem(base({ kind: "media", featureId: "video_generate" }));
  assert.equal(ppt?.routeTarget, "/dashboard/ai/c1?agent=executive-ppt");
  assert.equal(writer?.routeTarget, "/dashboard/writer/c1");
  assert.equal(image?.routeTarget, "/dashboard/image-assistant/c1");
  assert.equal(video?.routeTarget, "/dashboard/video/c1");
  assert.deepEqual(new Set([ppt?.sourceAdapterId, writer?.sourceAdapterId, image?.sourceAdapterId, video?.sourceAdapterId]), new Set(["ppt-runs", "writer-runs", "image-runs", "video-runs"]));
  assert.deepEqual(ppt?.artifactIds, ["artifact-1"]);
});

import { createRunRecordSource } from "../src/virtual-office/run-record-source";
import type { WorkbenchClient, WorkbenchConversation, WorkbenchRun, WorkbenchRunDetail } from "@coworkany/workbench-client";

const sourceRun = (id: string, status: WorkbenchRun["status"] = "running"): WorkbenchRun => ({ id, conversationId: "c1", status, startedAt: "2026-01-01T00:00:00Z", ...(status === "succeeded" ? { finishedAt: "2026-01-01T00:01:00Z" } : {}) });
const sourceDetail = (run: WorkbenchRun, metadata?: Record<string, unknown>): WorkbenchRunDetail => ({ run, nodes: [], events: metadata ? [{ sequence: 1, eventType: "task_metadata", payloadJson: JSON.stringify(metadata), createdAt: "2026-01-01T00:00:00Z" }] : [], usage: [] });

interface SourceState { conversations: readonly WorkbenchConversation[]; runs: readonly WorkbenchRun[]; attempts: readonly unknown[]; failRuns?: boolean; failInspect?: Set<string>; inspectCalls: string[]; subscriptions: string[]; unsubscriptions: string[]; listRuns?: () => Promise<readonly WorkbenchRun[]>; subscribeOnRun?: (id: string) => () => void }
function makeSourceClient(state: SourceState): WorkbenchClient {
  return {
    navigation: { go() {}, replace() {}, current: () => "/dashboard" }, files: { open: async () => {}, reveal: async () => {} }, artifacts: { list: async () => [], remove: async () => {} }, knowledge: { index: async () => { throw new Error("unused"); }, search: async () => [], open: async () => {} },
    conversations: { list: async () => state.conversations, create: async () => { throw new Error("unused"); }, messages: async () => [] }, workflows: { list: async () => [], save: async () => { throw new Error("unused"); }, applyAiOperation: async () => { throw new Error("unused"); }, operationGroups: async () => [], remove: async () => {} },
    runs: { start: async () => { throw new Error("unused"); }, list: async () => { if (state.listRuns) return state.listRuns(); if (state.failRuns) throw new Error("runs unavailable"); return state.runs; }, inspect: async (id) => { state.inspectCalls.push(id); if (state.failInspect?.has(id)) throw new Error("inspect unavailable"); const run = state.runs.find((item) => item.id === id) ?? sourceRun(id); return sourceDetail(run, id === "r1" ? { kind: "workflow", workflowId: "w1", workflowTitle: "Workflow" } : undefined); }, cancel: async () => {}, emergencyStop: async () => {}, subscribe: (id) => { state.subscriptions.push(id); return state.subscribeOnRun?.(id) ?? (() => state.unsubscriptions.push(id)); }, recoverableAttempts: async () => state.attempts as never }, usage: { list: async () => [] },
  } as WorkbenchClient;
}

test("RunRecordSource caches detail/metadata, isolates channel failure, and preserves last-good runs", async () => {
  const state: SourceState = { conversations: [{ id: "c1", title: "Chat", updatedAt: "", messageCount: 1 }], runs: [sourceRun("r1"), sourceRun("r2", "succeeded")], attempts: [], inspectCalls: [] as string[], subscriptions: [] as string[], unsubscriptions: [] as string[] };
  const source = createRunRecordSource({ client: makeSourceClient(state), clock: { now: () => Date.parse("2026-01-01T00:02:00Z"), setTimeout: () => 0, clearTimeout() {} }, reportDiagnostic: () => {} });
  const first = await source.snapshot();
  assert.equal(first.records.length, 2); assert.deepEqual(state.subscriptions, ["r1"]); assert.deepEqual(state.inspectCalls, ["r1", "r2"]);
  const second = await source.snapshot();
  assert.deepEqual(state.inspectCalls, ["r1", "r2", "r1"]); assert.deepEqual(second.health.map((item) => item.sourceId), ["conversations", "runs", "run-details", "attempts"]);
  state.failRuns = true;
  const failed = await source.snapshot();
  assert.equal(failed.records.length, 2); assert.equal(failed.health.find((item) => item.sourceId === "runs")?.status, "unknown"); assert.deepEqual(state.subscriptions, ["r1"]);
});

test("RunRecordSource clear invalidates old generation and permits restart", async () => {
  let resolveList!: (runs: readonly WorkbenchRun[]) => void;
  const pending = new Promise<readonly WorkbenchRun[]>((resolve) => { resolveList = resolve; });
  const state: SourceState = { conversations: [{ id: "c1", title: "Chat", updatedAt: "", messageCount: 1 }], runs: [sourceRun("old")], attempts: [], inspectCalls: [] as string[], subscriptions: [] as string[], unsubscriptions: [] as string[] };
  const client = makeSourceClient(state);
  let first = true;
  state.listRuns = async () => first ? pending : [sourceRun("new")];
  const source = createRunRecordSource({ client, clock: { now: () => Date.parse("2026-01-01T00:02:00Z"), setTimeout: () => 0, clearTimeout() {} }, reportDiagnostic: () => {} });
  const old = source.snapshot(); source.clear(); first = false; const restarted = await source.snapshot(); resolveList([sourceRun("old")]);
  await old;
  assert.deepEqual(restarted.records.map((record) => record.run.id), ["new"]); assert.deepEqual(state.subscriptions, ["new"]); assert.deepEqual(state.unsubscriptions, []);
});

test("RunRecordSource does not retain a listener when clear re-enters subscribe", async () => {
  const state: SourceState = { conversations: [], runs: [sourceRun("r1")], attempts: [], inspectCalls: [], subscriptions: [], unsubscriptions: [] };
  let clear!: () => void;
  state.subscribeOnRun = (id) => {
    clear();
    return () => state.unsubscriptions.push(id);
  };
  const client = makeSourceClient(state);
  const source = createRunRecordSource({ client, clock: { now: () => Date.parse("2026-01-01T00:02:00Z"), setTimeout: () => 0, clearTimeout() {} }, reportDiagnostic: () => {} });
  clear = source.clear;
  await source.snapshot();
  assert.deepEqual(state.subscriptions, ["r1"]);
  assert.deepEqual(state.unsubscriptions, ["r1"]);
  source.clear();
  assert.deepEqual(state.unsubscriptions, ["r1"]);
});
