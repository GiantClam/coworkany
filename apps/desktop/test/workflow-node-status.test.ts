import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowNodeEvent, createWorkflowNodeSnapshots, finalizeWorkflowNodeSnapshots } from "../src/workflow-node-status";

test("workflow node snapshots follow node lifecycle events", () => {
  const queued = createWorkflowNodeSnapshots(["input", "writer", "output"]);
  assert.deepEqual(queued.map((snapshot) => snapshot.status), ["queued", "queued", "queued"]);

  const running = applyWorkflowNodeEvent(queued, "workflow:node_started", JSON.stringify({ nodeKey: "writer" }));
  assert.equal(running.find((snapshot) => snapshot.nodeKey === "writer")?.status, "running");

  const succeeded = applyWorkflowNodeEvent(running, "workflow:node_succeeded", JSON.stringify({ nodeKey: "writer", output: { text: "Delivered" } }));
  assert.deepEqual(succeeded.find((snapshot) => snapshot.nodeKey === "writer"), { nodeKey: "writer", status: "succeeded", outputPayload: { text: "Delivered" } });
});

test("workflow node snapshots retain the failure message for the node canvas", () => {
  const snapshots = applyWorkflowNodeEvent(createWorkflowNodeSnapshots(["image"]), "workflow:node_failed", JSON.stringify({ nodeKey: "image", message: "media_outputs_not_downloadable" }));
  assert.deepEqual(snapshots, [{ nodeKey: "image", status: "failed", errorMessage: "media_outputs_not_downloadable" }]);
});

test("workflow completion keeps terminal nodes and leaves untouched nodes queued", () => {
  const snapshots = [
    { nodeKey: "input", status: "succeeded" },
    { nodeKey: "writer", status: "failed", errorMessage: "provider_unavailable" },
    { nodeKey: "output", status: "queued" },
  ];
  assert.deepEqual(finalizeWorkflowNodeSnapshots(snapshots, "failed"), [
    { nodeKey: "input", status: "succeeded" },
    { nodeKey: "writer", status: "failed", errorMessage: "provider_unavailable" },
    { nodeKey: "output", status: "queued" },
  ]);
});

test("workflow failure marks an in-flight node as failed", () => {
  assert.deepEqual(finalizeWorkflowNodeSnapshots([
    { nodeKey: "writer", status: "running" },
    { nodeKey: "output", status: "queued" },
  ], "failed"), [
    { nodeKey: "writer", status: "failed" },
    { nodeKey: "output", status: "queued" },
  ]);
});

test("workflow failure before the first node does not mark every node as skipped", () => {
  assert.deepEqual(finalizeWorkflowNodeSnapshots([
    { nodeKey: "input", status: "queued" },
    { nodeKey: "output", status: "queued" },
  ], "failed"), [
    { nodeKey: "input", status: "queued" },
    { nodeKey: "output", status: "queued" },
  ]);
});
