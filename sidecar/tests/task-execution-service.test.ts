import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskMessageExecutionDelegateInput } from '../src/mastra/entrypoint';
import { mastra } from '../src/mastra/index';
import { createMastraTaskExecutionService } from '../src/mastra/taskExecutionService';

const ENV_KEYS = [
    'COWORKANY_MODEL',
    'ANTHROPIC_API_KEY',
    'COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT',
    'COWORKANY_TASK_EXECUTION_DEFAULT',
    'COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED',
    'COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED',
    'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT',
    'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS',
    'COWORKANY_MASTRA_TASK_STAGE_CHECKPOINT_MAX_RECORDS',
    'COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS',
    'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT',
    'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS',
];

function snapshotEnv(): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) {
        snapshot[key] = process.env[key];
    }
    return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
    for (const key of ENV_KEYS) {
        const value = snapshot[key];
        if (typeof value === 'string') {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
}

const originalGetWorkflow = mastra.getWorkflow.bind(mastra);
const originalGetAgent = mastra.getAgent.bind(mastra);

afterEach(() => {
    (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = originalGetWorkflow;
    (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = originalGetAgent;
});

function createInput(input: {
    runDirect: () => Promise<void>;
    events: Array<Record<string, unknown>>;
    executionOptions?: TaskMessageExecutionDelegateInput['executionOptions'];
    message?: string;
    taskId?: string;
    turnId?: string;
}): TaskMessageExecutionDelegateInput {
    return {
        taskId: input.taskId ?? 'task-1',
        turnId: input.turnId ?? 'turn-1',
        message: input.message ?? '请执行任务',
        resourceId: 'resource-1',
        preferredThreadId: 'thread-1',
        workspacePath: process.cwd(),
        executionOptions: input.executionOptions ?? {
            executionPath: 'workflow',
        },
        runDirect: input.runDirect,
        emitDesktopEvent: async (event) => {
            input.events.push(event as Record<string, unknown>);
        },
    };
}

describe('taskExecutionService', () => {
    test('falls back to direct execution when workflow run times out', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS = '500';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '1';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS = '100';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => await new Promise<never>(() => undefined),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const startedAt = Date.now();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));
            const elapsedMs = Date.now() - startedAt;

            expect(result.executionPath).toBe('workflow_fallback');
            expect(runDirectCalls).toBe(1);
            expect(elapsedMs).toBeLessThan(2_500);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => event.type === 'error')).toBe(false);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('falls back to direct execution on retryable workflow failure status', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '0';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => ({
                        status: 'failed',
                        result: 'stream_idle_timeout:25000',
                    }),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow_fallback');
            expect(runDirectCalls).toBe(1);
            expect(events.some((event) => event.type === 'error')).toBe(false);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('keeps workflow failure for non-retryable status', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '0';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => ({
                        status: 'failed',
                        result: 'policy_denied_non_retryable',
                    }),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow');
            expect(runDirectCalls).toBe(0);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('policy_denied_non_retryable')
            ))).toBe(true);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('keeps workflow failure for persistent TLS trust error without retries or direct fallback', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '5';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => ({
                        status: 'failed',
                        result: 'unable to get issuer certificate',
                    }),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow');
            expect(runDirectCalls).toBe(0);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(false);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('unable to get issuer certificate')
            ))).toBe(true);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('prefers terminal workflow result and ignores seeded research summary text', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => ({
                        status: 'success',
                        state: {
                            normalized: {
                                researchEvidence: [
                                    { summary: 'Seeded from user request: 今天 minimax 的港股股价怎么样？本周会有哪些趋势？' },
                                ],
                            },
                        },
                        output: {
                            result: '已基于工具结果整理：MiniMax 本周波动偏大，短线关注成交量变化。',
                        },
                    }),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow');
            expect(runDirectCalls).toBe(0);
            const assistantText = events.find((event) => event.type === 'text_delta');
            expect(assistantText).toBeDefined();
            expect(String(assistantText?.content ?? '')).toContain('已基于工具结果整理');
            expect(String(assistantText?.content ?? '')).not.toContain('Seeded from user request');
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('falls back to direct execution when workflow has no assistant narrative', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'false';

            (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = (() => ({
                createRun: async () => ({
                    start: async () => ({
                        status: 'success',
                        state: {
                            normalized: {
                                researchEvidence: [
                                    { summary: 'Seeded from user request: 今天 minimax 的港股股价怎么样？本周会有哪些趋势？' },
                                ],
                            },
                        },
                    }),
                }),
            })) as typeof mastra.getWorkflow;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow_fallback');
            expect(runDirectCalls).toBe(1);
            const assistantTexts = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''));
            expect(assistantTexts.some((text) => text.includes('Seeded from user request'))).toBe(false);
            expect(events.some((event) => event.type === 'error')).toBe(false);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('staged control-plane retries only failed execute step and avoids direct fallback', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        let generateCalls = 0;
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '1';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS = '10';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS = '10';
            process.env.COWORKANY_MASTRA_TASK_STAGE_CHECKPOINT_MAX_RECORDS = '20';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    if (generateCalls === 1) {
                        throw new Error('stream_idle_timeout:1200');
                    }
                    return {
                        text: 'staged retry ok',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
            }));

            expect(result.executionPath).toBe('workflow');
            expect(runDirectCalls).toBe(0);
            expect(generateCalls).toBe(2);
            expect(events.some((event) => (
                event.type === 'rate_limited'
                && String(event.message ?? '').includes('execute-task')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('direct command task runs through staged workflow and only retries failed execute step', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '1';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS = '10';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS = '10';
            process.env.COWORKANY_MASTRA_TASK_STAGE_CHECKPOINT_MAX_RECORDS = '20';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async (_prompt: string, options?: Record<string, unknown>) => {
                    generateCalls += 1;
                    if (generateCalls === 1) {
                        throw new Error('stream_idle_timeout:1200');
                    }
                    const onIterationComplete = typeof options?.onIterationComplete === 'function'
                        ? options.onIterationComplete as (payload: Record<string, unknown>) => unknown
                        : null;
                    onIterationComplete?.({
                        iteration: 1,
                        toolCalls: [{
                            toolName: 'mastra_workspace_execute_command',
                        }],
                        text: 'executing command',
                        isFinal: false,
                    });
                    return {
                        text: 'direct staged retry ok',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-direct-command-staged',
                turnId: 'turn-direct-command-staged',
                message: '[Resolved attachments] - /tmp/a.png - /tmp/b.png 合并成视频，每张 5s',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }));

            expect(result.executionPath).toBe('direct');
            expect(runDirectCalls).toBe(0);
            expect(generateCalls).toBe(2);
            expect(events.some((event) => (
                event.type === 'rate_limited'
                && String(event.message ?? '').includes('execute-task')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('direct command staged path does not fallback to direct on retryable execute-task failure', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS = '10';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    throw new Error('stream_idle_timeout:1200');
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            await expect(service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-direct-command-timeout-no-fallback',
                turnId: 'turn-direct-command-timeout-no-fallback',
                message: '[Resolved attachments] - /tmp/a.png - /tmp/b.png 合并成视频，每张 5s',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }))).rejects.toThrow('stream_idle_timeout:1200');

            expect(runDirectCalls).toBe(0);
            expect(generateCalls).toBe(1);
            expect(events.some((event) => (
                event.type === 'rate_limited'
                && String(event.message ?? '').includes('execute-task')
            ))).toBe(false);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('direct command staged path does not fall back to direct when required command evidence is missing', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS = '10';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    return {
                        text: '我先说明下执行计划，然后开始执行。',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            await expect(service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-direct-command-no-tool-evidence',
                turnId: 'turn-direct-command-no-tool-evidence',
                message: '[Resolved attachments] - /tmp/a.png - /tmp/b.png 合并成视频，每张 5s',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }))).rejects.toThrow('workflow_missing_required_tool_evidence:command_execution');

            expect(runDirectCalls).toBe(0);
            expect(generateCalls).toBe(1);
            expect(events.some((event) => event.type === 'complete')).toBe(false);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('host-control direct command keeps runDirect path even when staged-direct flag is enabled', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    return {
                        text: 'unexpected',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-host-control-direct',
                turnId: 'turn-host-control-direct',
                message: '设置电脑一分钟后关机',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }));

            expect(result.executionPath).toBe('direct');
            expect(runDirectCalls).toBe(1);
            expect(generateCalls).toBe(0);
            expect(events.length).toBe(0);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('direct command task keeps runDirect path when staged-direct flag is disabled', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED = 'false';

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    return {
                        text: 'unexpected',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-direct-command-direct',
                turnId: 'turn-direct-command-direct',
                message: '合并附件视频',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }));

            expect(result.executionPath).toBe('direct');
            expect(runDirectCalls).toBe(1);
            expect(generateCalls).toBe(0);
            expect(events.length).toBe(0);
        } finally {
            restoreEnv(envSnapshot);
        }
    });

    test('direct command task keeps runDirect path when staged-direct flag is unset (default off)', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        let generateCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'direct';
            process.env.COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED = 'true';
            delete process.env.COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED;

            (mastra as unknown as { getAgent: typeof mastra.getAgent }).getAgent = (() => ({
                generate: async () => {
                    generateCalls += 1;
                    return {
                        text: 'unexpected',
                        finishReason: 'stop',
                    };
                },
            })) as typeof mastra.getAgent;

            const service = createMastraTaskExecutionService();
            const result = await service.executeTaskMessage(createInput({
                runDirect: async () => {
                    runDirectCalls += 1;
                },
                events,
                taskId: 'task-direct-command-default-direct',
                turnId: 'turn-direct-command-default-direct',
                message: '设置电脑一分钟后关机',
                executionOptions: {
                    executionPath: 'direct',
                    forcedRouteMode: 'task',
                    requireToolEvidenceForCompletion: true,
                    requiredCompletionCapabilities: ['command_execution'],
                },
            }));

            expect(result.executionPath).toBe('direct');
            expect(runDirectCalls).toBe(1);
            expect(generateCalls).toBe(0);
            expect(events.length).toBe(0);
        } finally {
            restoreEnv(envSnapshot);
        }
    });
});
