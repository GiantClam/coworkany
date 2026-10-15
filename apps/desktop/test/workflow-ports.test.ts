import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopWorkflowPorts } from "../runtime/workflow-ports";

test("desktop workflow ports bridge repository, artifact and ordered event evidence", async () => {
  const emitted: Array<Record<string, unknown>> = [];
  const serviceCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const capability = { execute: async () => ({ text: "ok" }) };
  const ports = createDesktopWorkflowPorts({ runId: "run-ports", workspacePath: "C:/CoworkAny/projects", capability, emit: (event) => emitted.push(event as unknown as Record<string, unknown>), requestService: async (method, payload) => { serviceCalls.push({ method, payload }); return method === "workflow.artifact.register" ? { artifactId: "run-ports:artifacts/run-ports/result.md" } : {}; } });
  const definition = { schemaVersion: 2, revision: 1, definitionHash: "hash-1", nodes: [], edges: [] } as never;

  await ports.repository.create({ runId: "run-ports", definition });
  await ports.repository.updateStatus("run-ports", "running");
  await ports.events.append({ runId: "run-ports", sequence: 3, type: "node_succeeded", payload: { nodeKey: "writer", output: { text: "ok" } } });
  const registration = await ports.artifacts.register({ relativePath: "artifacts/run-ports/result.md", mimeType: "text/markdown", byteLength: 2, sha256: "sha" });

  assert.equal(ports.capability, capability);
  assert.equal(registration.artifactId, "run-ports:artifacts/run-ports/result.md");
  assert.deepEqual(serviceCalls.map((call) => call.method), ["workflow.repository.create", "workflow.repository.update_status", "workflow.event.append", "workflow.artifact.register"]);
  assert.equal(serviceCalls[3]?.payload.workspacePath, "C:/CoworkAny/projects");
  assert.deepEqual(emitted.map((event) => (event as { tool?: string }).tool), [
    "workflow:run_created",
    "workflow:run_status",
    "workflow:node_succeeded",
    "workflow:artifact_registered",
  ]);
  assert.match(String(emitted[2].message), /"sequence":3/);
  assert.match(String(emitted[3].message), /"sha256":"sha"/);
});

test("desktop workflow event sink bounds oversized checkpoint payloads", async () => {
  const emitted: Array<Record<string, unknown>> = [];
  const ports = createDesktopWorkflowPorts({ runId: "run-bounded", workspacePath: "C:/CoworkAny/projects", capability: { execute: async () => ({}) }, emit: (event) => emitted.push(event as unknown as Record<string, unknown>), requestService: async () => ({}) });
  await ports.events.append({ runId: "run-bounded", sequence: 1, type: "node_succeeded", payload: { output: "x".repeat(80_000) } });
  const message = String(emitted[0].message);
  assert.ok(message.length <= 64 * 1024);
  assert.match(message, /"truncated":true/);
});
