import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskMessageExecutionDelegateInput } from '../src/mastra/entrypoint';
import { mastra } from '../src/mastra/index';
import { createMastraTaskExecutionService } from '../src/mastra/taskExecutionService';

const ENV_KEYS = [
    'COWORKANY_MODEL',
    'ANTHROPIC_API_KEY',
    'COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT',
    'COWORKANY_TASK_EXECUTION_DEFAULT',
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

afterEach(() => {
    (mastra as unknown as { getWorkflow: typeof mastra.getWorkflow }).getWorkflow = originalGetWorkflow;
});

function createInput(input: {
    runDirect: () => Promise<void>;
    events: Array<Record<string, unknown>>;
}): TaskMessageExecutionDelegateInput {
    return {
        taskId: 'task-1',
        turnId: 'turn-1',
        message: '请执行任务',
        resourceId: 'resource-1',
        preferredThreadId: 'thread-1',
        workspacePath: process.cwd(),
        executionOptions: {
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

    test('prefers terminal workflow result and ignores seeded research summary text', async () => {
        const envSnapshot = snapshotEnv();
        let runDirectCalls = 0;
        const events: Array<Record<string, unknown>> = [];
        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT = 'true';
            process.env.COWORKANY_TASK_EXECUTION_DEFAULT = 'workflow';

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
});
