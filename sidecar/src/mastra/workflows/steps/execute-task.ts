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
    requiredCapabilities?: string[];
}

export interface ExecuteTaskToolEvidence {
    toolCallCount: number;
    commandToolCallCount: number;
    toolNames: string[];
}
export interface ExecuteTaskOutput {
    result: string;
    completed: boolean;
    toolEvidence: ExecuteTaskToolEvidence;
}

const COMMAND_EXECUTION_CAPABILITY = 'command_execution';
const COMMAND_EXECUTION_TOOL_PATTERN = /\b(mastra_workspace_execute_command|run_command|bash|bash_approval|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/i;
const MAX_TOOL_EVIDENCE_SCAN_DEPTH = 8;
const MAX_TOOL_EVIDENCE_SCAN_ITEMS = 512;

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function normalizeRequiredCapabilities(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
}

function extractToolNameFromUnknown(value: unknown): string | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const directCandidates = [
        record.toolName,
        record.tool_name,
        record.tool,
        record.name,
    ];
    for (const candidate of directCandidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    const functionRecord = toRecord(record.function);
    if (functionRecord && typeof functionRecord.name === 'string' && functionRecord.name.trim().length > 0) {
        return functionRecord.name.trim();
    }
    return null;
}

function collectToolNamesFromUnknown(input: {
    value: unknown;
    target: Set<string>;
}): void {
    const queue: Array<{ value: unknown; depth: number }> = [{
        value: input.value,
        depth: 0,
    }];
    const seen = new Set<object>();
    let scanned = 0;

    while (queue.length > 0 && scanned < MAX_TOOL_EVIDENCE_SCAN_ITEMS) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        if (current.depth > MAX_TOOL_EVIDENCE_SCAN_DEPTH) {
            continue;
        }
        scanned += 1;

        if (Array.isArray(current.value)) {
            for (const item of current.value) {
                queue.push({
                    value: item,
                    depth: current.depth + 1,
                });
            }
            continue;
        }

        const record = toRecord(current.value);
        if (!record) {
            continue;
        }
        if (seen.has(record)) {
            continue;
        }
        seen.add(record);

        const toolName = extractToolNameFromUnknown(record);
        if (toolName) {
            input.target.add(toolName);
        }
        for (const key of ['toolCalls', 'tool_calls', 'toolCall', 'tool_call', 'steps', 'messages', 'response', 'output']) {
            if (key in record) {
                queue.push({
                    value: record[key],
                    depth: current.depth + 1,
                });
            }
        }
    }
}

function buildToolEvidence(toolNames: Set<string>): ExecuteTaskToolEvidence {
    const normalized = Array.from(new Set(
        [...toolNames]
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
    ));
    const commandToolCallCount = normalized.filter((name) => COMMAND_EXECUTION_TOOL_PATTERN.test(name)).length;
    return {
        toolCallCount: normalized.length,
        commandToolCallCount,
        toolNames: normalized,
    };
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
            toolEvidence: {
                toolCallCount: 0,
                commandToolCallCount: 0,
                toolNames: [],
            },
        };
    }
    const threadId = `control-plane-${input.task.frozen.id}`;
    const resourceId = deriveDefaultResourceId(input.task.frozen.id);
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId: input.task.frozen.id,
        workspacePath: input.workspacePath,
        requireToolApproval: true,
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
    const requiredCapabilities = new Set(normalizeRequiredCapabilities(input.task.requiredCapabilities));
    const requiresCommandExecutionEvidence = requiredCapabilities.has(COMMAND_EXECUTION_CAPABILITY);
    let output: Awaited<ReturnType<Agent['generate']>> | null = null;
    let lastError: unknown;
    let toolEvidence: ExecuteTaskToolEvidence = {
        toolCallCount: 0,
        commandToolCallCount: 0,
        toolNames: [],
    };
    for (let attempt = 0; attempt <= executeStepRetryCount; attempt += 1) {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const observedToolNames = new Set<string>();
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
                onIterationComplete: (iteration: unknown) => {
                    const iterationRecord = toRecord(iteration);
                    if (iterationRecord?.toolCalls) {
                        collectToolNamesFromUnknown({
                            value: iterationRecord.toolCalls,
                            target: observedToolNames,
                        });
                    }
                    return undefined;
                },
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
            collectToolNamesFromUnknown({
                value: output,
                target: observedToolNames,
            });
            toolEvidence = buildToolEvidence(observedToolNames);
            if (requiredCapabilities.size > 0) {
                const hasAnyRequiredToolEvidence = toolEvidence.toolCallCount > 0;
                const hasRequiredCommandEvidence = !requiresCommandExecutionEvidence
                    || toolEvidence.commandToolCallCount > 0;
                if (!hasAnyRequiredToolEvidence || !hasRequiredCommandEvidence) {
                    const missingLabel = requiresCommandExecutionEvidence
                        ? COMMAND_EXECUTION_CAPABILITY
                        : [...requiredCapabilities].join(',');
                    const evidenceError = new Error(`workflow_missing_required_tool_evidence:${missingLabel}`);
                    lastError = evidenceError;
                    const canRetry = attempt < executeStepRetryCount;
                    if (!canRetry) {
                        throw evidenceError;
                    }
                    await delay(executeStepRetryDelayMs * (attempt + 1));
                    continue;
                }
            }
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
        toolEvidence,
    };
}
