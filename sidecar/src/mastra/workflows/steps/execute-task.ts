import type { Agent } from '@mastra/core/agent';
import type {
    ExecutionPlan,
    FrozenWorkRequest,
} from '../../../orchestration/workRequestSchema';
import { deriveDefaultResourceId } from '../../runtimeIdentity';
import { createTaskRequestContext } from '../../requestContext';
import { createTelemetryRunContext } from '../../telemetry';
export interface ExecuteTaskInput {
    frozen: FrozenWorkRequest;
    executionPlan: ExecutionPlan;
    executionQuery: string;
}
export interface ExecuteTaskOutput {
    result: string;
    completed: boolean;
}

function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
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

function isRetryableExecutionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
        .test(message);
}

export async function executeFrozenTask(input: {
    coworker: Agent;
    task: ExecuteTaskInput;
    approved?: boolean;
    workspacePath?: string;
}): Promise<ExecuteTaskOutput> {
    const checkpoint = input.task.executionPlan.steps.find((step) => step.kind === 'execution');
    if (checkpoint && input.approved === false) {
        return {
            result: 'Execution cancelled by approval gate.',
            completed: false,
        };
    }
    const threadId = `control-plane-${input.task.frozen.id}`;
    const resourceId = deriveDefaultResourceId(input.task.frozen.id);
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId: input.task.frozen.id,
        workspacePath: input.workspacePath,
    });
    const telemetry = createTelemetryRunContext({
        taskId: input.task.frozen.id,
        threadId,
        resourceId,
        workspacePath: input.workspacePath,
    });
    const executeStepTimeoutMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS',
        30_000,
        3_000,
        90_000,
    );
    const executeStepRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT',
        5,
        0,
        5,
    );
    const executeStepRetryDelayMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS',
        1_000,
        100,
        10_000,
    );
    let output: Awaited<ReturnType<Agent['generate']>> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= executeStepRetryCount; attempt += 1) {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
            const generateOptions = {
                memory: {
                    thread: threadId,
                    resource: resourceId,
                },
                requestContext,
                tracingOptions: telemetry.tracingOptions
                    ? {
                        ...telemetry.tracingOptions,
                        tags: [...telemetry.tracingOptions.tags, 'workflow:control-plane'],
                    }
                    : undefined,
                requireToolApproval: true,
                autoResumeSuspendedTools: false,
                toolCallConcurrency: 1,
                maxSteps: 8,
                signal: abortController.signal,
            } as Record<string, unknown>;
            output = await Promise.race([
                (
                    input.coworker.generate as unknown as (
                        prompt: string,
                        options: Record<string, unknown>,
                    ) => Promise<Awaited<ReturnType<Agent['generate']>>>
                )(input.task.executionQuery, generateOptions),
                new Promise<never>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        abortController.abort(new Error('execute_task_timeout'));
                        reject(new Error(`execute_task_timeout:${executeStepTimeoutMs}`));
                    }, executeStepTimeoutMs);
                }),
            ]);
            break;
        } catch (error) {
            lastError = error;
            const canRetry = attempt < executeStepRetryCount
                && isRetryableExecutionError(error);
            if (!canRetry) {
                throw error;
            }
            await delay(executeStepRetryDelayMs * (attempt + 1));
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
    if (output === null) {
        throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
    }
    return {
        result: output.text,
        completed: output.finishReason !== 'error',
    };
}
