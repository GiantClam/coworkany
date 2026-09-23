import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowAiOperationGroup } from "@coworkany/workbench-client";
import type { WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { createDesktopWorkbenchClient } from "../src/workbench-client";

test("desktop client applies and restores workflow AI operation groups through typed Tauri commands", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 2,
    definitionHash: "b".repeat(64),
    nodes: [],
    edges: [],
  };
  const operationGroup: WorkflowAiOperationGroup = {
    id: "group-1",
    conversationId: "conversation-1",
    workflowId: "workflow-1",
    baseRevision: 1,
    resultRevision: 2,
    commands: [{ type: "layout_nodes", nodeKeys: ["input"], positions: { input: { x: 10, y: 20 } } }],
    status: "applied",
    summary: "Rearranged the input node",
    createdAt: "2026-09-21T00:00:00Z",
  };
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args });
      if (command === "apply_workflow_ai_operation") {
        const input = args?.input as { workflowId: string; definitionJson: string };
        return {
          id: input.workflowId,
          name: "AI workflow",
          definition_json: input.definitionJson,
          updated_at: "2026-09-21T00:00:01Z",
        } as T;
      }
      if (command === "list_workflow_ai_operation_groups") {
        return [{
          id: operationGroup.id,
          conversation_id: operationGroup.conversationId,
          workflow_id: operationGroup.workflowId,
          base_revision: operationGroup.baseRevision,
          result_revision: operationGroup.resultRevision,
          commands_json: JSON.stringify(operationGroup.commands),
          status: operationGroup.status,
          summary: operationGroup.summary,
          created_at: operationGroup.createdAt,
        }] as T;
      }
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/workflow/workflow-1" });

  const workflow = await client.workflows.applyAiOperation({ workflowId: "workflow-1", expectedRevision: 1, definition, operationGroup });
  assert.equal(workflow.definition.revision, 2);
  assert.deepEqual(calls[0], {
    command: "apply_workflow_ai_operation",
    args: {
      input: {
        workflowId: "workflow-1",
        expectedRevision: 1,
        definitionJson: JSON.stringify(definition),
        operationGroup,
      },
    },
  });

  const restored = await client.workflows.operationGroups("workflow-1");
  assert.deepEqual(restored, [operationGroup]);
  assert.deepEqual(calls[1], { command: "list_workflow_ai_operation_groups", args: { workflowId: "workflow-1" } });
});
