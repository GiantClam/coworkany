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

type TaskExecutionMode = 'direct' | 'workflow';
const contextCompressionStore = new TaskContextCompressionStore();
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';

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
    const runId = `control-plane-${randomUUID()}`;
    const telemetry = createTelemetryRunContext({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
    });
    const run = await workflow.createRun({
        runId,
        resourceId: input.resourceId,
    });
    const result = await run.start({
        inputData: {
            userInput: workflowUserInput,
            workspacePath: input.workspacePath ?? process.cwd(),
        },
        tracingOptions: telemetry.tracingOptions,
        outputOptions: {
            includeState: true,
            includeResumeLabels: true,
        },
    });
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
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: failureMessage,
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
