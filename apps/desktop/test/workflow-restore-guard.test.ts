import test from "node:test";
import assert from "node:assert/strict";
import { isCurrentWorkflowRestore } from "../src/workflow-restore-guard";

const token = { workflowKey: "workflow-a", generation: 4, activePath: "/dashboard/workflows" };

test("workflow restore is current only for the same canvas, generation, and route", () => {
  assert.equal(isCurrentWorkflowRestore(token, token), true);
  assert.equal(isCurrentWorkflowRestore(token, { ...token, workflowKey: "workflow-b" }), false);
  assert.equal(isCurrentWorkflowRestore(token, { ...token, generation: 5 }), false);
  assert.equal(isCurrentWorkflowRestore(token, { ...token, activePath: "/dashboard" }), false);
});
