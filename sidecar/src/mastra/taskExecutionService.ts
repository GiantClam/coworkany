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
const DEFAULT_WORKFLOW_TIMEOUT_MS = 45_000;
const DEFAULT_WORKFLOW_RETRY_COUNT = 5;
const DEFAULT_WORKFLOW_RETRY_DELAY_MS = 1_000;
const DEFAULT_WORKFLOW_SHORT_RETRY_COUNT = 2;
const DEFAULT_WORKFLOW_BACKOFF_MULTIPLIER = 2;
const DEFAULT_WORKFLOW_BACKOFF_MAX_MS = 15_000;
const DEFAULT_WORKFLOW_JITTER_RATIO = 0.2;
const INTERNAL_WORKFLOW_RESULT_PATTERNS = [
    /^Seeded from user request:/i,
    /^Task completed via workflow runtime\.?$/i,
];

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

function isInternalWorkflowResultText(value: string): boolean {
    return INTERNAL_WORKFLOW_RESULT_PATTERNS.some((pattern) => pattern.test(value));
}

function pickPublicText(value: unknown): string | null {
    const text = pickText(value);
    if (!text) {
        return null;
    }
    return isInternalWorkflowResultText(text) ? null : text;
}

function pickWorkflowResultText(value: unknown): string | null {
    const root = toRecord(value);
    const rootOutput = toRecord(root?.output);
    const rootResponse = toRecord(root?.response);
    const rootPayload = toRecord(root?.payload);
    const preferredCandidates = [
        pickPublicText(root?.result),
        pickPublicText(rootOutput?.result),
        pickPublicText(rootOutput?.text),
        pickPublicText(rootOutput?.message),
        pickPublicText(rootResponse?.result),
        pickPublicText(rootResponse?.text),
        pickPublicText(rootPayload?.result),
        pickPublicText(rootPayload?.text),
        pickPublicText(root?.text),
        pickPublicText(root?.message),
    ];
    for (const candidate of preferredCandidates) {
        if (candidate) {
            return candidate;
        }
    }

    const visited = new Set<object>();
    const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const textFields = ['result', 'text', 'message', 'answer', 'finalAnswer', 'content'];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        const currentRecord = toRecord(current.value);
        const depth = current.depth;
        if (!currentRecord) {
            continue;
        }
        if (visited.has(currentRecord)) {
            continue;
        }
        visited.add(currentRecord);

        for (const field of textFields) {
            const candidate = pickPublicText(currentRecord[field]);
            if (candidate) {
                return candidate;
            }
        }
        // Keep shallow summary support for explicit workflow outputs,
        // but ignore deep planning/research summaries (e.g. seed evidence).
        if (depth <= 1) {
            const shallowSummary = pickPublicText(currentRecord.summary);
            if (shallowSummary) {
                return shallowSummary;
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
                queue.push({
                    value: nested,
                    depth: depth + 1,
                });
            }
        }

        for (const nested of Object.values(currentRecord)) {
            if (!nested || typeof nested !== 'object') {
                continue;
            }
            if (Array.isArray(nested)) {
                for (const value of nested) {
                    if (value && typeof value === 'object') {
                        queue.push({
                            value,
                            depth: depth + 1,
                        });
                    }
                }
                continue;
            }
            queue.push({
                value: nested,
                depth: depth + 1,
            });
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

function readBoundedNumber(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWorkflowRetryDelayMs(input: {
    retryOrdinal: number;
    baseDelayMs: number;
    shortRetryCount: number;
    backoffMultiplier: number;
    backoffMaxMs: number;
    jitterRatio: number;
}): number {
    const retryOrdinal = Math.max(1, Math.floor(input.retryOrdinal));
    let candidate = input.baseDelayMs;
    if (retryOrdinal > input.shortRetryCount) {
        const exponentialIndex = retryOrdinal - input.shortRetryCount;
        candidate = Math.min(
            input.backoffMaxMs,
            Math.round(input.baseDelayMs * Math.pow(input.backoffMultiplier, exponentialIndex)),
        );
    }
    const jitterWindow = Math.max(0, Math.floor(candidate * input.jitterRatio));
    const jitterOffset = jitterWindow > 0
        ? Math.floor((Math.random() * ((jitterWindow * 2) + 1)) - jitterWindow)
        : 0;
    return Math.max(100, candidate + jitterOffset);
}

function isRetryableWorkflowError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(workflow_run_timeout|workflow_retryable_failure|missing_terminal_after_tooling_progress|No snapshot found for this workflow run|timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
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
    const workflowShortRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_SHORT_RETRY_COUNT',
        DEFAULT_WORKFLOW_SHORT_RETRY_COUNT,
        0,
        5,
    );
    const workflowBackoffMultiplier = readBoundedNumber(
        'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MULTIPLIER',
        DEFAULT_WORKFLOW_BACKOFF_MULTIPLIER,
        1.1,
        4,
    );
    const workflowBackoffMaxMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MAX_MS',
        DEFAULT_WORKFLOW_BACKOFF_MAX_MS,
        workflowRetryDelayMs,
        60_000,
    );
    const workflowJitterRatio = readBoundedNumber(
        'COWORKANY_MASTRA_TASK_WORKFLOW_JITTER_RATIO',
        DEFAULT_WORKFLOW_JITTER_RATIO,
        0,
        0.5,
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
                    const retryDelayMs = resolveWorkflowRetryDelayMs({
                        retryOrdinal: attempt + 1,
                        baseDelayMs: workflowRetryDelayMs,
                        shortRetryCount: workflowShortRetryCount,
                        backoffMultiplier: workflowBackoffMultiplier,
                        backoffMaxMs: workflowBackoffMaxMs,
                        jitterRatio: workflowJitterRatio,
                    });
                    await input.emitDesktopEvent({
                        type: 'rate_limited',
                        runId,
                        message: `Workflow execution delayed. Retrying (${attempt + 2}/${maxAttempts})...`,
                        attempt: attempt + 2,
                        maxAttempts,
                        retryAfterMs: retryDelayMs,
                        error: failureMessage,
                        stage: 'unknown',
                        turnId: input.turnId,
                    });
                    await delay(retryDelayMs);
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
            const summary = pickWorkflowResultText(result);
            if (!summary) {
                throw new Error('workflow_missing_assistant_narrative');
            }
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
            const retryDelayMs = resolveWorkflowRetryDelayMs({
                retryOrdinal: attempt + 1,
                baseDelayMs: workflowRetryDelayMs,
                shortRetryCount: workflowShortRetryCount,
                backoffMultiplier: workflowBackoffMultiplier,
                backoffMaxMs: workflowBackoffMaxMs,
                jitterRatio: workflowJitterRatio,
            });
            await input.emitDesktopEvent({
                type: 'rate_limited',
                message: `Workflow request timed out. Retrying (${attempt + 2}/${maxAttempts})...`,
                attempt: attempt + 2,
                maxAttempts,
                retryAfterMs: retryDelayMs,
                error: String(error),
                stage: 'unknown',
                turnId: input.turnId,
            });
            await delay(retryDelayMs);
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
