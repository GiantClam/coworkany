import { describe, expect, test } from 'bun:test';
import type { TaskRuntimeState } from '../src/mastra/taskRuntimeState';
import { handleEntrypointRuntimeCommands } from '../src/mastra/entrypointRuntimeCommands';

type EmittedMessage = {
    type: string;
    payload: Record<string, unknown>;
};

function createTaskState(overrides?: Partial<TaskRuntimeState>): TaskRuntimeState {
    return {
        taskId: 'task-1',
        conversationThreadId: 'thread-1',
        title: 'Task 1',
        workspacePath: '/workspace',
        createdAt: '2026-04-23T00:00:00.000Z',
        status: 'running',
        resourceId: 'resource-1',
        executionPath: 'workflow',
        ...overrides,
    };
}

function createBaseInput(overrides?: {
    commandType?: string;
    commandId?: string;
    payload?: Record<string, unknown>;
    taskStates?: Map<string, TaskRuntimeState>;
}) {
    const emitted: EmittedMessage[] = [];
    const taskStatuses: Array<{ taskId: string; payload: Record<string, unknown> }> = [];
    const invalidPayloads: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const hookEvents: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    let bootstrapRuntimeContext: Record<string, unknown> | undefined;

    const taskStates = overrides?.taskStates ?? new Map<string, TaskRuntimeState>();

    const input = {
        commandType: overrides?.commandType ?? 'unknown_command',
        commandId: overrides?.commandId ?? 'cmd-1',
        payload: overrides?.payload ?? {},
        taskStates,
        getString: (value: unknown) => (typeof value === 'string' ? value : null),
        toRecord: (value: unknown) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return {};
            }
            return value as Record<string, unknown>;
        },
        getNowIso: () => '2026-04-23T00:00:00.000Z',
        createId: () => 'generated-id',
        setBootstrapRuntimeContext: (context: Record<string, unknown>) => {
            bootstrapRuntimeContext = context;
        },
        hasBootstrapRuntimeContext: () => Boolean(bootstrapRuntimeContext),
        hydrateLegacyRuntimeRecordsFromBootstrap: () => undefined,
        collectRuntimeSnapshot: () => ({
            generatedAt: '2026-04-23T00:00:00.000Z',
            tasks: [{ taskId: 'task-1' }],
            count: 1,
        }),
        warmupChatRuntime: async () => ({
            mcpServerCount: 1,
            mcpToolCount: 2,
            durationMs: 100,
            mcpLoadStatus: 'ready' as const,
        }),
        buildRuntimeConfigDoctorSummary: () => ({
            loadedFromPath: '/tmp/runtime.json',
            search: {
                provider: {
                    value: 'serper',
                    source: 'env',
                },
                credentials: {
                    serperApiKeyConfigured: true,
                    exaApiKeyConfigured: false,
                    tavilyApiKeyConfigured: false,
                    braveApiKeyConfigured: false,
                },
            },
            conflicts: [],
        }),
        resolveTaskCheckpointVersion: () => 1,
        listPolicyDecisionLog: () => [{ id: 'decision-1' }],
        listHookEvents: () => [{ id: 'hook-1' }],
        applyPolicyDecision: () => ({
            allowed: true,
            reason: 'allowed',
            ruleId: 'rule-allow',
        }),
        upsertTaskState: (taskId: string, patch: Partial<TaskRuntimeState>) => {
            const previous = taskStates.get(taskId) ?? createTaskState({ taskId });
            const next = {
                ...previous,
                ...patch,
            };
            taskStates.set(taskId, next);
            return next;
        },
        appendTranscript: () => undefined,
        emitHookEvent: (type: string, event: { payload?: Record<string, unknown> }) => {
            hookEvents.push({ type, payload: event.payload });
        },
        emitTaskStatus: (taskId: string, payload: Record<string, unknown>) => {
            taskStatuses.push({ taskId, payload });
        },
        emitInvalidPayload: (type: string, payload?: Record<string, unknown>) => {
            invalidPayloads.push({ type, payload });
        },
        emitFor: (type: string, payload: Record<string, unknown>) => {
            emitted.push({ type, payload });
        },
    };

    return {
        input,
        emitted,
        taskStatuses,
        invalidPayloads,
        hookEvents,
    };
}

describe('entrypointRuntimeCommands', () => {
    test('returns false when command is not runtime-related', async () => {
        const { input } = createBaseInput();
        const handled = await handleEntrypointRuntimeCommands(input);
        expect(handled).toBe(false);
    });

    test('bootstrap_runtime_context persists context and get_runtime_snapshot returns snapshot', async () => {
        const harness = createBaseInput({
            commandType: 'bootstrap_runtime_context',
            commandId: 'cmd-bootstrap',
            payload: {
                runtimeContext: {
                    workspacePath: '/workspace',
                },
            },
        });

        const bootstrapHandled = await handleEntrypointRuntimeCommands(harness.input);
        expect(bootstrapHandled).toBe(true);
        expect(harness.emitted).toEqual([
            {
                type: 'bootstrap_runtime_context_response',
                payload: {
                    success: true,
                },
            },
        ]);

        const snapshotHandled = await handleEntrypointRuntimeCommands({
            ...harness.input,
            commandType: 'get_runtime_snapshot',
            commandId: 'cmd-snapshot',
            payload: {},
        });
        expect(snapshotHandled).toBe(true);
        expect(harness.emitted[1]).toEqual({
            type: 'get_runtime_snapshot_response',
            payload: {
                success: true,
                snapshot: {
                    generatedAt: '2026-04-23T00:00:00.000Z',
                    tasks: [{ taskId: 'task-1' }],
                    count: 1,
                },
            },
        });
    });

    test('get_tasks filters by workspace and status', async () => {
        const taskStates = new Map<string, TaskRuntimeState>([
            ['task-1', createTaskState({ status: 'idle', workspacePath: '/workspace' })],
            ['task-2', createTaskState({ taskId: 'task-2', status: 'running', workspacePath: '/workspace' })],
            ['task-3', createTaskState({ taskId: 'task-3', status: 'running', workspacePath: '/other' })],
        ]);
        const { input, emitted } = createBaseInput({
            commandType: 'get_tasks',
            commandId: 'cmd-get-tasks',
            payload: {
                workspacePath: '/workspace',
                status: ['running'],
            },
            taskStates,
        });

        const handled = await handleEntrypointRuntimeCommands(input);
        expect(handled).toBe(true);
        expect(emitted).toEqual([
            {
                type: 'get_tasks_response',
                payload: {
                    success: true,
                    tasks: [
                        {
                            id: 'task-2',
                            taskId: 'task-2',
                            title: 'Task 1',
                            workspacePath: '/workspace',
                            status: 'running',
                            createdAt: '2026-04-23T00:00:00.000Z',
                            modelId: null,
                            executionPath: 'workflow',
                        },
                    ],
                    count: 1,
                },
            },
        ]);
    });

    test('rewind_task returns policy denial when task command is blocked', async () => {
        const { input, emitted } = createBaseInput({
            commandType: 'rewind_task',
            commandId: 'cmd-rewind-denied',
            payload: {
                taskId: 'task-1',
            },
            taskStates: new Map<string, TaskRuntimeState>([
                ['task-1', createTaskState({ taskId: 'task-1' })],
            ]),
        });

        const handled = await handleEntrypointRuntimeCommands({
            ...input,
            applyPolicyDecision: () => ({
                allowed: false,
                reason: 'requires_operator',
                ruleId: 'rule-1',
            }),
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([
            {
                type: 'rewind_task_response',
                payload: {
                    success: false,
                    taskId: 'task-1',
                    error: 'policy_denied:requires_operator',
                },
            },
        ]);
    });

    test('rewind_task rewinds transcript and emits status update', async () => {
        const taskStates = new Map<string, TaskRuntimeState>([
            ['task-1', createTaskState({ taskId: 'task-1', status: 'running' })],
        ]);
        const { input, emitted, hookEvents, taskStatuses } = createBaseInput({
            commandType: 'rewind_task',
            commandId: 'cmd-rewind-ok',
            payload: {
                taskId: 'task-1',
                userTurns: 2,
            },
            taskStates,
        });

        const handled = await handleEntrypointRuntimeCommands({
            ...input,
            taskTranscriptStore: {
                list: () => [],
                rewindByUserTurns: () => ({
                    success: true,
                    removedEntries: 4,
                    removedUserTurns: 2,
                    remainingEntries: 3,
                    latestUserMessage: 'latest request',
                }),
            },
            rewindTaskContext: () => ({
                success: true,
                removedTurns: 2,
                remainingTurns: 3,
            }),
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([
            {
                type: 'rewind_task_response',
                payload: {
                    success: true,
                    taskId: 'task-1',
                    removedEntries: 4,
                    removedUserTurns: 2,
                    remainingEntries: 3,
                    latestUserMessage: 'latest request',
                    newThreadId: 'task-1-rewind-generated-id',
                    contextRewind: {
                        success: true,
                        removedTurns: 2,
                        remainingTurns: 3,
                    },
                },
            },
        ]);
        expect(hookEvents).toEqual([
            {
                type: 'TaskRewound',
                payload: {
                    removedUserTurns: 2,
                    removedEntries: 4,
                    newThreadId: 'task-1-rewind-generated-id',
                },
            },
        ]);
        expect(taskStatuses).toEqual([
            {
                taskId: 'task-1',
                payload: {
                    status: 'idle',
                    blockingReason: 'Task rewound by 2 user turn(s).',
                },
            },
        ]);
        expect(taskStates.get('task-1')?.status).toBe('idle');
        expect(taskStates.get('task-1')?.conversationThreadId).toBe('task-1-rewind-generated-id');
    });
});
