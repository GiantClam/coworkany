import { randomUUID } from 'crypto';
import type { TaskRuntimeExecutionPath } from './taskRuntimeState';
import type {
    TaskMessageExecutionDelegateInput,
    TaskMessageExecutionDelegateResult,
} from './entrypoint';
import { mastra } from './index';
import { createTelemetryRunContext } from './telemetry';
import { TaskContextCompressionStore } from './contextCompression';
import { resolveMissingApiKeyForModel } from '../ipc/streaming';
import { classifyRuntimeErrorMessage } from './runtimeErrorClassifier';

type TaskExecutionMode = 'direct' | 'workflow';
const contextCompressionStore = new TaskContextCompressionStore();
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const DEFAULT_WORKFLOW_TIMEOUT_MS = 35_000;
const DEFAULT_WORKFLOW_RETRY_COUNT = 1;
const DEFAULT_WORKFLOW_RETRY_DELAY_MS = 500;

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function pickText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function pickWorkflowResultText(value: unknown): string | null {
    const visited = new Set<object>();
    const queue: unknown[] = [value];
    const textFields = ['result', 'text', 'summary', 'message', 'answer', 'finalAnswer', 'content'];

    while (queue.length > 0) {
        const current = queue.shift();
        const currentRecord = toRecord(current);
        if (!currentRecord) {
            continue;
        }
        if (visited.has(currentRecord)) {
            continue;
        }
        visited.add(currentRecord);

        for (const field of textFields) {
            const candidate = pickText(currentRecord[field]);
            if (candidate) {
                return candidate;
            }
        }

        const nestedCandidates: unknown[] = [
            currentRecord.result,
            currentRecord.output,
            currentRecord.response,
            currentRecord.data,
            currentRecord.payload,
            currentRecord.steps,
            currentRecord.state,
        ];
        for (const nested of nestedCandidates) {
            if (nested && typeof nested === 'object') {
                queue.push(nested);
            }
        }

        for (const nested of Object.values(currentRecord)) {
            if (!nested || typeof nested !== 'object') {
                continue;
            }
            if (Array.isArray(nested)) {
                for (const value of nested) {
                    if (value && typeof value === 'object') {
                        queue.push(value);
                    }
                }
                continue;
            }
            queue.push(nested);
        }
    }
    return null;
}

function pickWorkflowStatus(value: unknown): string {
    const record = toRecord(value);
    if (!record) {
        return 'unknown';
    }
    return pickText(record.status) ?? 'unknown';
}

function readFlag(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (value == null) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

function readBoundedInt(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWorkflowError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(workflow_run_timeout|workflow_retryable_failure|timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
        .test(message);
}

function resolveExecutionMode(input: TaskMessageExecutionDelegateInput): TaskExecutionMode {
    const configuredPath = input.executionOptions?.executionPath;
    if (configuredPath === 'workflow') {
        return 'workflow';
    }
    if (configuredPath === 'direct') {
        return 'direct';
    }
    const envDefault = process.env.COWORKANY_TASK_EXECUTION_DEFAULT?.trim().toLowerCase();
    if (envDefault === 'direct') {
        return 'direct';
    }
    if (envDefault === 'workflow') {
        return 'workflow';
    }
    return 'workflow';
}

async function runWithWorkflow(input: TaskMessageExecutionDelegateInput): Promise<TaskRuntimeExecutionPath> {
    contextCompressionStore.recordUserTurn({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
        content: input.message,
        turnId: input.turnId,
    });
    const promptPack = contextCompressionStore.buildPromptPack(input.taskId);
    const recalledMemoryFiles = promptPack?.recalledTopicMemories.map((entry) => entry.relativePath) ?? [];
    if (promptPack) {
        input.executionOptions?.onPreCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles,
        });
    }
    const modelId = process.env.COWORKANY_MODEL || DEFAULT_MODEL_ID;
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        const failureMessage = `missing_api_key:${missingApiKey}`;
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: failureMessage,
            turnId: input.turnId,
        });
        input.executionOptions?.onPostCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledMemoryFiles,
        });
        await input.emitDesktopEvent({
            type: 'error',
            runId: `preflight-${randomUUID()}`,
            message: failureMessage,
            turnId: input.turnId,
        });
        return 'workflow';
    }
    const workflowUserInput = input.message;
    const workflow = mastra.getWorkflow('controlPlane');
    const telemetry = createTelemetryRunContext({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
    });
    const workflowTimeoutMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS',
        DEFAULT_WORKFLOW_TIMEOUT_MS,
        500,
        120_000,
    );
    const workflowRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT',
        DEFAULT_WORKFLOW_RETRY_COUNT,
        0,
        5,
    );
    const workflowRetryDelayMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS',
        DEFAULT_WORKFLOW_RETRY_DELAY_MS,
        100,
        10_000,
    );
    const maxAttempts = workflowRetryCount + 1;

    for (let attempt = 0; attempt <= workflowRetryCount; attempt += 1) {
        const runId = `control-plane-${randomUUID()}`;
        try {
            const run = await workflow.createRun({
                runId,
                resourceId: input.resourceId,
            });
            const abortController = new AbortController();
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const startPayload = {
                inputData: {
                    userInput: workflowUserInput,
                    workspacePath: input.workspacePath ?? process.cwd(),
                },
                tracingOptions: telemetry.tracingOptions,
                outputOptions: {
                    includeState: true,
                    includeResumeLabels: true,
                },
                signal: abortController.signal,
            };
            const result = await (async () => {
                try {
                    return await Promise.race([
                        (run.start as (input: unknown) => Promise<unknown>)(startPayload),
                        new Promise<never>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                abortController.abort(new Error('workflow_run_timeout'));
                                reject(new Error(`workflow_run_timeout:${workflowTimeoutMs}`));
                            }, workflowTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();

            const status = pickWorkflowStatus(result);
            if (status === 'suspended') {
                if (promptPack) {
                    input.executionOptions?.onPostCompact?.({
                        taskId: input.taskId,
                        threadId: input.preferredThreadId,
                        resourceId: input.resourceId,
                        workspacePath: input.workspacePath,
                        microSummary: promptPack.microSummary,
                        structuredSummary: promptPack.structuredSummary,
                        recalledMemoryFiles,
                    });
                }
                await input.emitDesktopEvent({
                    type: 'suspended',
                    runId,
                    toolCallId: `workflow-suspend-${input.taskId}`,
                    toolName: 'control_plane',
                    payload: result,
                    turnId: input.turnId,
                });
                return 'workflow';
            }
            if (status === 'failed' || status === 'tripwire') {
                const failureMessage = pickWorkflowResultText(result) ?? `control_plane_failed:${status}`;
                const failureClassification = classifyRuntimeErrorMessage(failureMessage);
                const canRetry = failureClassification.failureClass === 'retryable'
                    && attempt < workflowRetryCount;
                if (canRetry) {
                    await input.emitDesktopEvent({
                        type: 'rate_limited',
                        runId,
                        message: `Workflow execution delayed. Retrying (${attempt + 2}/${maxAttempts})...`,
                        attempt: attempt + 2,
                        maxAttempts,
                        retryAfterMs: workflowRetryDelayMs,
                        error: failureMessage,
                        stage: 'unknown',
                        turnId: input.turnId,
                    });
                    await delay(workflowRetryDelayMs * (attempt + 1));
                    continue;
                }
                if (failureClassification.failureClass === 'retryable') {
                    throw new Error(`workflow_retryable_failure:${failureMessage}`);
                }
                const snapshot = contextCompressionStore.recordAssistantTurn({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    content: failureMessage,
                    turnId: input.turnId,
                });
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: snapshot.microSummary,
                    structuredSummary: snapshot.structuredSummary,
                    recalledMemoryFiles,
                });
                await input.emitDesktopEvent({
                    type: 'error',
                    runId,
                    message: failureMessage,
                    turnId: input.turnId,
                });
                return 'workflow';
            }
            const summary = pickWorkflowResultText(result) ?? 'Task completed via workflow runtime.';
            if (summary) {
                const snapshot = contextCompressionStore.recordAssistantTurn({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    content: summary,
                    turnId: input.turnId,
                });
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: snapshot.microSummary,
                    structuredSummary: snapshot.structuredSummary,
                    recalledMemoryFiles,
                });
                await input.emitDesktopEvent({
                    type: 'text_delta',
                    runId,
                    role: 'assistant',
                    content: summary,
                    turnId: input.turnId,
                });
            } else if (promptPack) {
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: promptPack.microSummary,
                    structuredSummary: promptPack.structuredSummary,
                    recalledMemoryFiles,
                });
            }
            await input.emitDesktopEvent({
                type: 'complete',
                runId,
                finishReason: `workflow:${status}`,
                turnId: input.turnId,
            });
            return 'workflow';
        } catch (error) {
            const canRetry = isRetryableWorkflowError(error)
                && attempt < workflowRetryCount;
            if (!canRetry) {
                throw error;
            }
            await input.emitDesktopEvent({
                type: 'rate_limited',
                message: `Workflow request timed out. Retrying (${attempt + 2}/${maxAttempts})...`,
                attempt: attempt + 2,
                maxAttempts,
                retryAfterMs: workflowRetryDelayMs,
                error: String(error),
                stage: 'unknown',
                turnId: input.turnId,
            });
            await delay(workflowRetryDelayMs * (attempt + 1));
        }
    }

    throw new Error('workflow_exhausted_without_result');
}

export function createMastraTaskExecutionService(): {
    executeTaskMessage: (
        input: TaskMessageExecutionDelegateInput,
    ) => Promise<TaskMessageExecutionDelegateResult>;
} {
    const workflowFallbackToDirect = readFlag(
        'COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT',
        true,
    );
    return {
        executeTaskMessage: async (input): Promise<TaskMessageExecutionDelegateResult> => {
            const mode = resolveExecutionMode(input);
            if (mode === 'direct') {
                await input.runDirect();
                return { executionPath: 'direct' };
            }
            try {
                const executionPath = await runWithWorkflow(input);
                return { executionPath };
            } catch (error) {
                if (!workflowFallbackToDirect) {
                    throw error;
                }
                await input.runDirect();
                return { executionPath: 'workflow_fallback' };
            }
        },
    };
}
