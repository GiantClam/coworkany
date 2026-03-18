import { describe, expect, test } from 'bun:test';
import { handleRuntimeCommand, handleRuntimeResponse, type RuntimeCommandDeps, type RuntimeResponseDeps } from '../src/handlers/runtime';

function createRuntimeCommandDeps(overrides: Partial<RuntimeCommandDeps> = {}): RuntimeCommandDeps {
    return {
        emit: () => {},
        onBootstrapRuntimeContext: () => {},
        executeFreshTask: async () => {},
        createTaskFailedEvent: (taskId, payload) => ({ type: 'TASK_FAILED', taskId, payload }),
        createChatMessageEvent: (taskId, payload) => ({ type: 'CHAT_MESSAGE', taskId, payload }),
        createTaskClarificationRequiredEvent: (taskId, payload) => ({ type: 'TASK_CLARIFICATION_REQUIRED', taskId, payload }),
        createTaskStatusEvent: (taskId, payload) => ({ type: 'TASK_STATUS', taskId, payload }),
        createTaskFinishedEvent: (taskId, payload) => ({ type: 'TASK_FINISHED', taskId, payload }),
        taskSessionStore: {
            clearConversation: () => {},
            ensureHistoryLimit: () => {},
            setHistoryLimit: () => {},
            setConfig: () => {},
            getConfig: () => undefined,
            getArtifactContract: () => undefined,
            setArtifactContract: () => {},
        },
        taskEventBus: {
            emitRaw: () => {},
            emitChatMessage: () => {},
            emitStatus: () => {},
            reset: () => {},
            emitStarted: () => {},
            emitFinished: () => {},
        },
        suspendResumeManager: {
            isSuspended: () => false,
            resume: async () => ({ success: true }),
        },
        enqueueResumeMessage: () => {},
        getTaskConfig: () => undefined,
        workspaceRoot: '/tmp/workspace',
        workRequestStore: {},
        prepareWorkRequestContext: () => ({
            frozenWorkRequest: {
                clarification: { required: false },
                mode: 'immediate',
            },
            executionQuery: 'run task',
            workRequestExecutionPrompt: 'prompt',
        }),
        buildArtifactContract: () => ({ type: 'artifact' }),
        buildClarificationMessage: () => 'Need clarification',
        pushConversationMessage: () => [],
        shouldUsePlanningFiles: () => false,
        appendPlanningProgressEntry: () => {},
        scheduleTaskInternal: () => ({ id: 'scheduled-1' }),
        buildScheduledConfirmationMessage: () => 'Scheduled',
        toScheduledTaskConfig: () => undefined,
        markWorkRequestExecutionStarted: () => {},
        continuePreparedAgentFlow: async () => {},
        getExecutionRuntimeDeps: () => ({}),
        runPostEditHooks: () => [],
        formatHookResults: () => '',
        loadLlmConfig: () => ({}),
        resolveProviderConfig: () => ({}),
        autonomousLlmAdapter: {
            setProviderConfig: () => {},
        },
        getAutonomousAgent: () => ({
            startTask: async () => ({ summary: 'done', createdAt: new Date().toISOString() }),
            getTask: () => null,
            pauseTask: () => true,
            resumeTask: async () => {},
            cancelTask: () => true,
            getAllTasks: () => [],
        }),
        ...overrides,
    };
}

function createRuntimeResponseDeps(overrides: Partial<RuntimeResponseDeps> = {}): RuntimeResponseDeps {
    return {
        taskEventBus: {
            emitRaw: () => {},
        },
        ...overrides,
    };
}

describe('runtime commands handler', () => {
    test('handles bootstrap_runtime_context and emits success response', async () => {
        const emitted: any[] = [];
        const bootstrapped: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            onBootstrapRuntimeContext: (runtimeContext) => bootstrapped.push(runtimeContext),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r1',
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    platform: 'darwin',
                    appDataDir: '/tmp/app',
                },
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(bootstrapped).toHaveLength(1);
        expect(emitted[0]?.type).toBe('bootstrap_runtime_context_response');
    });

    test('handles start_task by emitting response and delegating to executeFreshTask', async () => {
        const emitted: any[] = [];
        const calls: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            executeFreshTask: async (args) => {
                calls.push(args);
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r2',
            type: 'start_task',
            payload: {
                taskId: 'task-1',
                title: 'Demo',
                userQuery: 'Do work',
                context: {
                    workspacePath: '/tmp/ws',
                    activeFile: '/tmp/ws/a.ts',
                },
                config: { modelId: 'gpt-4o' },
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted[0]?.type).toBe('start_task_response');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.taskId).toBe('task-1');
        expect(calls[0]?.allowAutonomousFallback).toBe(true);
    });

    test('handles send_task_message suspended path without continuing agent flow', async () => {
        const emitted: any[] = [];
        const resumed: any[] = [];
        const queued: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            suspendResumeManager: {
                isSuspended: () => true,
                resume: async (taskId, reason) => {
                    resumed.push({ taskId, reason });
                    return { success: true };
                },
            },
            enqueueResumeMessage: (taskId, content, config) => {
                queued.push({ taskId, content, config });
            },
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r3',
            type: 'send_task_message',
            payload: {
                taskId: 'task-2',
                content: 'follow up',
                config: { modelId: 'gpt-4o-mini' },
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(queued).toHaveLength(1);
        expect(resumed).toHaveLength(1);
        expect(emitted[0]?.type).toBe('send_task_message_response');
        expect(continued).toBe(false);
    });

    test('handles send_task_message clarification path and emits idle task state', async () => {
        const emitted: any[] = [];
        const pushed: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            prepareWorkRequestContext: () => ({
                frozenWorkRequest: {
                    id: 'wr-1',
                    clarification: {
                        required: true,
                        reason: 'missing details',
                        questions: ['Which repo?'],
                        missingFields: ['repo'],
                    },
                    mode: 'immediate',
                },
                executionQuery: 'question',
            }),
            pushConversationMessage: (taskId, message) => {
                pushed.push({ taskId, message });
                return [];
            },
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4',
            type: 'send_task_message',
            payload: {
                taskId: 'task-3',
                content: 'help me',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(pushed).toHaveLength(2);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'CHAT_MESSAGE',
            'TASK_CLARIFICATION_REQUIRED',
            'TASK_STATUS',
        ]);
        expect(continued).toBe(false);
    });

    test('handles start_autonomous_task and emits completion on success', async () => {
        const emitted: any[] = [];
        const started: any[] = [];
        const finished: any[] = [];
        const providerConfigs: any[] = [];
        const startCalls: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            taskEventBus: {
                emitRaw: () => {},
                emitChatMessage: () => {},
                emitStatus: () => {},
                reset: () => {},
                emitStarted: (taskId, payload) => started.push({ taskId, payload }),
                emitFinished: (taskId, payload) => finished.push({ taskId, payload }),
            },
            autonomousLlmAdapter: {
                setProviderConfig: (config) => providerConfigs.push(config),
            },
            getAutonomousAgent: () => ({
                startTask: async (query, options) => {
                    startCalls.push({ query, options });
                    return { summary: 'all done', createdAt: new Date().toISOString() };
                },
                getTask: () => null,
                pauseTask: () => true,
                resumeTask: async () => {},
                cancelTask: () => true,
                getAllTasks: () => [],
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r5',
            type: 'start_autonomous_task',
            payload: {
                taskId: 'auto-1',
                query: 'research stocks',
                runInBackground: true,
                autoSaveMemory: false,
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(providerConfigs).toHaveLength(1);
        expect(started).toHaveLength(1);
        expect(emitted[0]?.type).toBe('start_autonomous_task_response');
        expect(startCalls[0]?.options.runInBackground).toBe(true);
        expect(finished).toHaveLength(1);
    });
});

describe('runtime responses handler', () => {
    test('maps request_effect_response and apply_patch_response into task event bus raw events', async () => {
        const rawCalls: any[] = [];
        const deps = createRuntimeResponseDeps({
            taskEventBus: {
                emitRaw: (taskId, type, payload) => {
                    rawCalls.push({ taskId, type, payload });
                },
            },
        });

        const handledEffect = await handleRuntimeResponse({
            type: 'request_effect_response',
            commandId: 'resp-1',
            timestamp: new Date().toISOString(),
            payload: {
                response: {
                    approved: true,
                    requestId: 'req-1',
                },
            },
        } as any, deps);

        const handledPatch = await handleRuntimeResponse({
            type: 'apply_patch_response',
            commandId: 'resp-2',
            timestamp: new Date().toISOString(),
            payload: {
                success: false,
                patchId: 'patch-1',
                error: 'conflict',
            },
        } as any, deps);

        expect(handledEffect).toBe(true);
        expect(handledPatch).toBe(true);
        expect(rawCalls).toEqual([
            {
                taskId: 'global',
                type: 'EFFECT_APPROVED',
                payload: {
                    response: {
                        approved: true,
                        requestId: 'req-1',
                    },
                    approvedBy: 'policy',
                },
            },
            {
                taskId: 'global',
                type: 'PATCH_REJECTED',
                payload: {
                    patchId: 'patch-1',
                    reason: 'conflict',
                },
            },
        ]);
    });
});
