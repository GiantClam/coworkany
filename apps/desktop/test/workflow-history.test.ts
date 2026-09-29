import assert from "node:assert/strict";
import test from "node:test";
import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { createWorkflowHistory, shouldResetWorkflowHistory } from "../src/workflow-history";

function definition(label: string, revision: number): WorkflowDefinitionEnvelope {
  const value: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision,
    definitionHash: "",
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: label, positionX: 0, positionY: 0, config: { text: label } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 320, positionY: 0, config: {} },
    ],
    edges: [{ edgeKey: "input-output", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" }],
  };
  return { ...value, definitionHash: hashWorkflowDefinition(value) };
}

test("one AI multi-command snapshot is one global workflow history entry", () => {
  const initial = definition("Initial", 1);
  const aiResult = { ...definition("AI", 2), nodes: [...definition("AI", 2).nodes, { nodeKey: "writer", type: "llm_generate", nodeVersion: 1, title: "Writer", positionX: 160, positionY: 160, config: {} }] };
  aiResult.definitionHash = hashWorkflowDefinition({ ...aiResult, definitionHash: "" });
  const history = createWorkflowHistory(initial);

  const applied = history.commitAiOperation(aiResult);
  assert.equal(applied.past.length, 1);
  assert.equal(applied.future.length, 0);
  assert.equal(applied.current.nodes.length, 3);
  assert.equal(history.undo().current.definitionHash, initial.definitionHash);
  assert.equal(history.redo().current.definitionHash, aiResult.definitionHash);
});

test("AI undo/redo and manual edits share one stack; a new edit invalidates redo", () => {
  const initial = definition("Initial", 1);
  const ai = definition("AI", 2);
  const manual = definition("Manual", 3);
  const afterUndo = definition("After undo", 4);
  const history = createWorkflowHistory(initial);

  history.commitAiOperation(ai);
  assert.equal(history.undo().current.definitionHash, initial.definitionHash);
  assert.equal(history.redo().current.definitionHash, ai.definitionHash);

  history.commit(manual);
  assert.equal(history.undo().current.definitionHash, ai.definitionHash);
  assert.equal(history.redo().current.definitionHash, manual.definitionHash);
  history.undo();
  const afterNewEdit = history.commit(afterUndo);
  assert.equal(afterNewEdit.canRedo, false);
  assert.equal(history.redo().current.definitionHash, afterUndo.definitionHash);
});

test("history snapshots are isolated and immutable", () => {
  const initial = definition("Initial", 1);
  const next = definition("Next", 2);
  const history = createWorkflowHistory(initial);
  const result = history.commit(next);
  assert.notEqual(result.current, next);
  assert.equal(Object.isFrozen(result.current), true);
  assert.equal(Object.isFrozen(result.current.nodes), true);
  assert.throws(() => { (result.current.nodes[0] as { title: string }).title = "mutated"; }, TypeError);
  assert.equal(history.undo().current.nodes[0]?.title, "Initial");
});

test("parent echoes of the committed definition do not reset the global history", () => {
  const initial = definition("Initial", 1);
  const next = definition("Next", 2);
  assert.equal(shouldResetWorkflowHistory(next, { ...next }), false);
  assert.equal(shouldResetWorkflowHistory(initial, next), true);
  assert.equal(shouldResetWorkflowHistory(next, { ...next }, true), true);

  const history = createWorkflowHistory(initial);
  history.commitAiOperation(next);
  assert.equal(history.getState().canUndo, true);
  // The App workspace effect skips the reset for this same-hash parent echo.
  assert.equal(shouldResetWorkflowHistory(history.getState().current, next), false);
  assert.equal(history.undo().current.definitionHash, initial.definitionHash);
});

test("revision-only persistence sync preserves undo and redo stacks", () => {
  const initial = definition("Initial", 1);
  const next = definition("Next", 2);
  const history = createWorkflowHistory(initial);
  history.commit(next);
  const revisionOnly = { ...next, revision: 10 };
  const synced = history.syncCurrent(revisionOnly);
  assert.equal(synced.current.revision, 10);
  assert.equal(synced.past.length, 1);
  assert.equal(synced.future.length, 0);
  assert.equal(history.undo().current.definitionHash, initial.definitionHash);
  assert.equal(history.redo().current.revision, 12);
});

test("undo and redo restore graph snapshots with monotonic revisions before a second AI edit", () => {
  const initial = definition("Initial", 1);
  const firstAi = definition("AI", 2);
  const secondAi = definition("Second AI", 5);
  const history = createWorkflowHistory(initial);
  history.commitAiOperation(firstAi);
  const undone = history.undo();
  assert.equal(undone.current.revision, 3);
  assert.equal(undone.current.definitionHash, initial.definitionHash);
  const redone = history.redo();
  assert.equal(redone.current.revision, 4);
  assert.equal(redone.current.definitionHash, firstAi.definitionHash);
  const committed = history.commitAiOperation(secondAi);
  assert.equal(committed.current.revision, 5);
  assert.equal(committed.current.definitionHash, secondAi.definitionHash);
  assert.equal(history.undo().current.revision, 6);
});

test("syncCurrent ignores structural changes instead of creating history entries", () => {
  const initial = definition("Initial", 1);
  const next = definition("Next", 2);
  const history = createWorkflowHistory(initial);
  const synced = history.syncCurrent({ ...next, revision: 3 });
  assert.equal(synced.current.definitionHash, initial.definitionHash);
  assert.equal(synced.past.length, 0);
});
