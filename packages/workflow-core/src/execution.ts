import { compileWorkflowPlan, type CompiledWorkflowPlan, type CompiledWorkflowPlanStep } from "./compiler";
import type { WorkflowDefinitionEnvelope } from "./definition";
import type { WorkflowCapabilityPort, WorkflowClock, WorkflowRunEventSink, WorkflowRunRepository } from "./ports";
import { workflowNodeRegistry } from "./node-definitions/registry";

const CHECKPOINT_OUTPUT_MAX_BYTES = 48 * 1024;

export interface WorkflowExecutionOptions {
  readonly runId: string;
  readonly ports: { readonly capability: WorkflowCapabilityPort; readonly repository?: WorkflowRunRepository; readonly events?: WorkflowRunEventSink; readonly clock?: WorkflowClock };
  readonly signal?: AbortSignal;
  readonly retryLimit?: number;
  readonly completed?: Readonly<Record<string, Record<string, unknown>>>;
  readonly recovering?: Readonly<Record<string, { readonly providerTaskId: string; readonly metadata?: Readonly<Record<string, unknown>> }>>;
  /**
   * Hash captured when a recoverable run started. A retry must use the exact
   * same graph/configuration so completed nodes cannot be replayed against a
   * different branch or provider binding.
   */
  readonly recoveryDefinitionHash?: string;
}

export interface WorkflowExecutionResult {
  readonly runId: string;
  readonly status: "succeeded" | "failed" | "cancelled" | "interrupted";
  readonly outputs: Readonly<Record<string, Record<string, unknown>>>;
  readonly plan: CompiledWorkflowPlan;
  readonly error?: string;
}

export async function executeWorkflow(definition: WorkflowDefinitionEnvelope, options: WorkflowExecutionOptions): Promise<WorkflowExecutionResult> {
  const plan = compileWorkflowPlan(definition);
  const outputs: Record<string, Record<string, unknown>> = { ...(options.completed ?? {}) };
  const sequence = { value: 0 };
  await options.ports.repository?.create({ runId: options.runId, definition });
  if (options.recoveryDefinitionHash && options.recoveryDefinitionHash !== plan.definitionHash) {
    await options.ports.repository?.updateStatus(options.runId, "failed");
    await appendEvent(options, sequence, "run_recovery_rejected", { expectedDefinitionHash: options.recoveryDefinitionHash, actualDefinitionHash: plan.definitionHash });
    return { runId: options.runId, status: "failed", outputs, plan, error: "workflow_recovery_incompatible_definition" };
  }
  await options.ports.repository?.updateStatus(options.runId, "running");
  await appendEvent(options, sequence, "run_started", { definitionHash: plan.definitionHash });
  try {
    const pending = new Map(plan.steps.filter((step) => !outputs[step.nodeKey]).map((step) => [step.nodeKey, step]));
    while (pending.size > 0) {
      throwIfCancelled(options.signal);
      const ready = [...pending.values()]
        .filter((step) => step.dependsOn.every((dependency) => Boolean(outputs[dependency])))
        .sort((left, right) => left.nodeKey.localeCompare(right.nodeKey));
      if (!ready.length) throw new Error("workflow_dependency_unresolved");
      for (const step of ready) {
        const node = definition.nodes.find((candidate) => candidate.nodeKey === step.nodeKey)!;
        const executorId = workflowNodeRegistry.require(node.type).executorId;
        await appendEvent(options, sequence, "node_started", { nodeKey: node.nodeKey, executorId });
      }
      const settled = await Promise.allSettled(ready.map(async (step) => {
        const node = definition.nodes.find((candidate) => candidate.nodeKey === step.nodeKey)!;
        const executorId = workflowNodeRegistry.require(node.type).executorId;
        const inputs = collectInputs(definition, node.nodeKey, outputs);
        try {
          const recovery = options.recovering?.[node.nodeKey];
          if (recovery) await appendEvent(options, sequence, "node_resumed", { nodeKey: node.nodeKey, executorId, providerTaskId: recovery.providerTaskId });
          const execution = step.kind === "foreach"
            ? await executeForeach(definition, step, node.config, inputs, outputs, options, sequence, recovery)
            : { output: await executeWithRetry(executorId, node.nodeKey, node.config, inputs, options, undefined, recovery), consumedNodeKeys: [] as const };
          return { step, executorId, ...execution } as const;
        } catch (error) {
          await appendEvent(options, sequence, "node_failed", { nodeKey: node.nodeKey, executorId, message: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }));
      const results = settled
        .filter((outcome): outcome is PromiseFulfilledResult<{ readonly step: CompiledWorkflowPlanStep; readonly executorId: string; readonly output: Record<string, unknown>; readonly consumedNodeKeys: readonly string[] }> => outcome.status === "fulfilled")
        .map((outcome) => outcome.value)
        .sort((left, right) => left.step.nodeKey.localeCompare(right.step.nodeKey));
      for (const { step, executorId, output, consumedNodeKeys = [] } of results) {
        outputs[step.nodeKey] = output;
        pending.delete(step.nodeKey);
        for (const nodeKey of consumedNodeKeys) pending.delete(nodeKey);
        await appendEvent(options, sequence, "node_succeeded", { nodeKey: step.nodeKey, checkpointKey: step.nodeKey, executorId, output: checkpointOutput(output) });
      }
      const failure = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (failure) throw failure.reason;
    }
    await options.ports.repository?.updateStatus(options.runId, "succeeded");
    await appendEvent(options, sequence, "run_succeeded", { nodeCount: plan.steps.length });
    return { runId: options.runId, status: "succeeded", outputs, plan };
  } catch (error) {
    const cancelled = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const status = cancelled ? "cancelled" : "failed";
    await options.ports.repository?.updateStatus(options.runId, status);
    await appendEvent(options, sequence, status === "cancelled" ? "run_cancelled" : "run_failed", { message: error instanceof Error ? error.message : String(error) });
    return { runId: options.runId, status, outputs, plan, error: error instanceof Error ? error.message : String(error) };
  }
}

type WorkflowRecoveryAttempt = NonNullable<WorkflowExecutionOptions["recovering"]>[string];

async function executeWithRetry(executorId: string, nodeKey: string, config: Record<string, unknown>, inputs: Record<string, unknown>, options: WorkflowExecutionOptions, iteration?: { readonly key: string; readonly index: number; readonly item: unknown }, recovery?: WorkflowRecoveryAttempt) {
  const limit = Math.max(0, Math.min(5, options.retryLimit ?? 0));
  let attempt = 0;
  while (true) {
    throwIfCancelled(options.signal);
    try {
      const signal = options.signal ?? new AbortController().signal;
      if (recovery) {
        if (!options.ports.capability.resume) throw new Error("workflow_recovery_unsupported");
        return await options.ports.capability.resume({ executorId, nodeKey, config, inputs, providerTaskId: recovery.providerTaskId, ...(recovery.metadata ? { metadata: recovery.metadata } : {}) }, signal);
      }
      return await options.ports.capability.execute({ executorId, nodeKey, config, inputs, ...(iteration ? { iteration } : {}) }, signal);
    }
    catch (error) { if (attempt >= limit) throw error; attempt += 1; }
  }
}

type ForeachExecution = { readonly output: Record<string, unknown>; readonly consumedNodeKeys: readonly string[] };

async function executeForeach(
  definition: WorkflowDefinitionEnvelope,
  step: Extract<CompiledWorkflowPlanStep, { kind: "foreach" }>,
  config: Record<string, unknown>,
  inputs: Record<string, unknown>,
  completed: Record<string, Record<string, unknown>>,
  options: WorkflowExecutionOptions,
  sequence: { value: number },
  recovery?: WorkflowRecoveryAttempt,
): Promise<ForeachExecution> {
  const inputPortId = String(config.inputPortId ?? "image");
  const inputKind = inputPortId.includes("asset") ? "asset" : inputPortId.includes("text") ? "text" : "image";
  const resolved = await executeWithRetry("foreach", step.nodeKey, config, inputs, options, undefined, recovery);
  const items = extractIterationItems(resolved, inputs, inputKind);
  const collectNode = definition.nodes.find((node) => node.nodeKey === step.collectNodeKey && node.type === "collect");
  if (!collectNode) throw new Error("workflow_foreach_collect_required");
  const bodySteps = step.bodyNodeKeys.map((nodeKey) => definition.nodes.find((node) => node.nodeKey === nodeKey)).filter((node): node is WorkflowDefinitionEnvelope["nodes"][number] => Boolean(node));
  const iterationOutputs = await mapWithConcurrency(items.slice(0, step.maxIterations), step.concurrency, async (item, index) => {
    throwIfCancelled(options.signal);
    const iterationKey = `${inputKind}-${index + 1}`;
    const localOutputs: Record<string, Record<string, unknown>> = {
      ...completed,
      [step.nodeKey]: { [inputKind]: item, [`item.${inputKind}`]: item },
    };
    const sharedImage = inputs.referenceImage ?? inputs.image;
    if (sharedImage !== undefined) localOutputs[step.nodeKey]!["item.image"] = sharedImage;
    try {
      for (const node of bodySteps) {
        throwIfCancelled(options.signal);
        const executorId = workflowNodeRegistry.require(node.type).executorId;
        const nodeInputs = collectInputs(definition, node.nodeKey, localOutputs);
        await appendEvent(options, sequence, "node_started", { nodeKey: node.nodeKey, executorId, iterationKey, iterationIndex: index });
        try {
          localOutputs[node.nodeKey] = await executeWithRetry(executorId, node.nodeKey, node.config, nodeInputs, options, { key: iterationKey, index, item });
          await appendEvent(options, sequence, "node_succeeded", { nodeKey: node.nodeKey, checkpointKey: `${node.nodeKey}:${iterationKey}`, executorId, iterationKey, iterationIndex: index, output: checkpointOutput(localOutputs[node.nodeKey]) });
        } catch (error) {
          await appendEvent(options, sequence, "node_failed", { nodeKey: node.nodeKey, executorId, iterationKey, iterationIndex: index, message: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
      return localOutputs;
    } catch (error) {
      if (step.failurePolicy === "fail_fast") throw error;
      return null;
    }
  });
  const successful = iterationOutputs.filter((value): value is Record<string, Record<string, unknown>> => value !== null);
  const collectInputsByPort: Record<string, unknown[]> = {};
  for (const edge of definition.edges.filter((candidate) => candidate.targetNodeKey === collectNode.nodeKey)) {
    for (const localOutputs of successful) {
      const value = localOutputs[edge.sourceNodeKey]?.[edge.sourcePortId];
      if (value !== undefined) (collectInputsByPort[edge.targetPortId] ??= []).push(value);
    }
  }
  const collectExecutor = workflowNodeRegistry.require(collectNode.type).executorId;
  await appendEvent(options, sequence, "node_started", { nodeKey: collectNode.nodeKey, executorId: collectExecutor });
  const output = await executeWithRetry(collectExecutor, collectNode.nodeKey, collectNode.config, collectInputsByPort, options);
  await appendEvent(options, sequence, "node_succeeded", { nodeKey: collectNode.nodeKey, checkpointKey: collectNode.nodeKey, executorId: collectExecutor, output: checkpointOutput(output) });
  completed[collectNode.nodeKey] = output;
  return { output, consumedNodeKeys: [collectNode.nodeKey, ...step.bodyNodeKeys] };
}

function extractIterationItems(resolved: Record<string, unknown>, inputs: Record<string, unknown>, inputKind: "asset" | "image" | "text") {
  const candidates = [resolved[`${inputKind}s`], resolved[inputKind], resolved[`items.${inputKind}`], inputs[`items.${inputKind}`], inputs[`${inputKind}s`], inputs[inputKind]];
  return (candidates.find(Array.isArray) ?? []) as unknown[];
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, callback: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (true) { const index = next++; if (index >= items.length) return; results[index] = await callback(items[index], index); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

function collectInputs(definition: WorkflowDefinitionEnvelope, nodeKey: string, outputs: Record<string, Record<string, unknown>>) {
  const inputs: Record<string, unknown> = {};
  for (const edge of definition.edges.filter((candidate) => candidate.targetNodeKey === nodeKey)) {
    const value = outputs[edge.sourceNodeKey]?.[edge.sourcePortId];
    if (value === undefined) continue;
    if (inputs[edge.targetPortId] === undefined) inputs[edge.targetPortId] = value;
    else inputs[edge.targetPortId] = Array.isArray(inputs[edge.targetPortId]) ? [...(inputs[edge.targetPortId] as unknown[]), value] : [inputs[edge.targetPortId], value];
  }
  return inputs;
}

async function appendEvent(options: WorkflowExecutionOptions, sequence: { value: number }, type: string, payload: Record<string, unknown>) {
  sequence.value += 1;
  await options.ports.events?.append({ runId: options.runId, sequence: sequence.value, type, payload });
}

function checkpointOutput(value: unknown): unknown {
  const bounded = boundCheckpointValue(value, 0);
  try {
    const serialized = JSON.stringify(bounded);
    return serialized.length <= CHECKPOINT_OUTPUT_MAX_BYTES ? bounded : { checkpointTruncated: true };
  } catch {
    return { checkpointTruncated: true };
  }
}

function boundCheckpointValue(value: unknown, depth: number): unknown {
  if (depth > 5 || value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 16_000);
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => boundCheckpointValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 64).map(([key, item]) => [key.slice(0, 160), boundCheckpointValue(item, depth + 1)]));
  }
  return undefined;
}

function throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) { const error = new Error("workflow_cancelled"); error.name = "AbortError"; throw error; } }
