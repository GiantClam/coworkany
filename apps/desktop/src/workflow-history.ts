import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";

export type WorkflowHistoryState = Readonly<{
  current: WorkflowDefinitionEnvelope;
  past: readonly WorkflowDefinitionEnvelope[];
  future: readonly WorkflowDefinitionEnvelope[];
  canUndo: boolean;
  canRedo: boolean;
}>;

export type WorkflowHistoryCommitOptions = Readonly<{
  /** Keep rapid edits with the same key as one canvas history item. */
  coalesceKey?: string;
  now?: number;
}>;

export type WorkflowHistory = Readonly<{
  getState: () => WorkflowHistoryState;
  commit: (next: WorkflowDefinitionEnvelope, options?: WorkflowHistoryCommitOptions) => WorkflowHistoryState;
  commitAiOperation: (next: WorkflowDefinitionEnvelope) => WorkflowHistoryState;
  /** Update persistence metadata on the current snapshot without a history item. */
  syncCurrent: (next: WorkflowDefinitionEnvelope) => WorkflowHistoryState;
  undo: () => WorkflowHistoryState;
  redo: () => WorkflowHistoryState;
}>;

/**
 * Parent renders may echo a committed snapshot back into the workspace. That
 * echo must not be mistaken for a newly opened workflow, or it would discard
 * the canvas undo stack after every edit.
 */
export function shouldResetWorkflowHistory(current: WorkflowDefinitionEnvelope, incoming: WorkflowDefinitionEnvelope, workflowIdentityChanged = false): boolean {
  return workflowIdentityChanged || current.definitionHash !== incoming.definitionHash;
}

type CoalesceState = Readonly<{ key: string; until: number }>;

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

function freezeValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child);
  return Object.freeze(value);
}

function snapshot(definition: WorkflowDefinitionEnvelope): WorkflowDefinitionEnvelope {
  return freezeValue(cloneValue(definition));
}

function restoreAtRevision(definition: WorkflowDefinitionEnvelope, revision: number) {
  const candidate = { ...definition, revision, definitionHash: "" };
  return snapshot({ ...candidate, definitionHash: hashWorkflowDefinition(candidate) });
}

function sameExceptRevision(left: WorkflowDefinitionEnvelope, right: WorkflowDefinitionEnvelope) {
  return JSON.stringify({ ...left, revision: undefined }) === JSON.stringify({ ...right, revision: undefined });
}

function state(current: WorkflowDefinitionEnvelope, past: readonly WorkflowDefinitionEnvelope[], future: readonly WorkflowDefinitionEnvelope[]): WorkflowHistoryState {
  return Object.freeze({
    current,
    past: Object.freeze([...past]),
    future: Object.freeze([...future]),
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });
}

/**
 * A canvas-owned, whole-workflow history. AI callers commit only their final
 * operation-group snapshot, so a multi-command request is one history item.
 */
export function createWorkflowHistory(initial: WorkflowDefinitionEnvelope, options: { readonly maxEntries?: number } = {}): WorkflowHistory {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 50));
  let current = snapshot(initial);
  let past: WorkflowDefinitionEnvelope[] = [];
  let future: WorkflowDefinitionEnvelope[] = [];
  let coalesce: CoalesceState | null = null;

  const getState = () => state(current, past, future);

  const commit = (nextDefinition: WorkflowDefinitionEnvelope, commitOptions: WorkflowHistoryCommitOptions = {}) => {
    const next = snapshot(nextDefinition);
    if (next.definitionHash === current.definitionHash) return getState();
    const now = commitOptions.now ?? Date.now();
    const isCoalesced = Boolean(commitOptions.coalesceKey && coalesce?.key === commitOptions.coalesceKey && coalesce.until > now);
    if (!isCoalesced) {
      past = [...past.slice(-(maxEntries - 1)), current];
      future = [];
    }
    coalesce = commitOptions.coalesceKey ? { key: commitOptions.coalesceKey, until: now + 500 } : null;
    current = next;
    return getState();
  };

  const commitAiOperation = (next: WorkflowDefinitionEnvelope) => commit(next);

  const syncCurrent = (nextDefinition: WorkflowDefinitionEnvelope) => {
    if (nextDefinition.definitionHash !== current.definitionHash || !sameExceptRevision(nextDefinition, current)) return getState();
    current = snapshot(nextDefinition);
    return getState();
  };

  const undo = () => {
    const previous = past.pop();
    if (!previous) return getState();
    future.push(current);
    current = restoreAtRevision(previous, current.revision + 1);
    coalesce = null;
    return getState();
  };

  const redo = () => {
    const next = future.pop();
    if (!next) return getState();
    past.push(current);
    current = restoreAtRevision(next, current.revision + 1);
    coalesce = null;
    return getState();
  };

  return Object.freeze({ getState, commit, commitAiOperation, syncCurrent, undo, redo });
}
