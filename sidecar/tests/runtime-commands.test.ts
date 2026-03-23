import { describe, expect, test } from 'bun:test';
import { handleRuntimeCommand, handleRuntimeResponse, type RuntimeCommandDeps, type RuntimeResponseDeps } from '../src/handlers/runtime';
import { setTaskIsolationPolicy } from '../src/execution/taskIsolationPolicyStore';
import { IpcResponseSchema } from '../src/protocol';

function createRuntimeCommandDeps(overrides: Partial<RuntimeCommandDeps> = {}): RuntimeCommandDeps {
    return {
        emit: () => {},
        onBootstrapRuntimeContext: () => {},
        restorePersistedTasks: () => {},
        runDoctorPreflight: () => ({
            report: { overallStatus: 'healthy' },
            markdown: '# Doctor Report',
        }),
        executeFreshTask: async () => {},
        ensureTaskRuntimePersistence: () => {},
        cancelTaskExecution: async () => ({ success: true }),
        createTaskFailedEvent: (taskId, payload) => ({ type: 'TASK_FAILED', taskId, payload }),
        createChatMessageEvent: (taskId, payload) => ({ type: 'CHAT_MESSAGE', taskId, payload }),
        createTaskClarificationRequiredEvent: (taskId, payload) => ({ type: 'TASK_CLARIFICATION_REQUIRED', taskId, payload }),
        createTaskContractReopenedEvent: (taskId, payload) => ({ type: 'TASK_CONTRACT_REOPENED', taskId, payload }),
        createTaskPlanReadyEvent: (taskId, payload) => ({ type: 'TASK_PLAN_READY', taskId, payload }),
        createTaskResearchUpdatedEvent: (taskId, payload) => ({ type: 'TASK_RESEARCH_UPDATED', taskId, payload }),
        createPlanUpdatedEvent: (taskId, payload) => ({ type: 'PLAN_UPDATED', taskId, payload }),
        createTaskCheckpointReachedEvent: (taskId, payload) => ({ type: 'TASK_CHECKPOINT_REACHED', taskId, payload }),
        createTaskUserActionRequiredEvent: (taskId, payload) => ({ type: 'TASK_USER_ACTION_REQUIRED', taskId, payload }),
        createTaskStatusEvent: (taskId, payload) => ({ type: 'TASK_STATUS', taskId, payload }),
        createTaskResumedEvent: (taskId, payload) => ({ type: 'TASK_RESUMED', taskId, payload }),
        createTaskFinishedEvent: (taskId, payload) => ({ type: 'TASK_FINISHED', taskId, payload }),
        taskSessionStore: {
            clearConversation: () => {},
            ensureHistoryLimit: () => {},
            setHistoryLimit: () => {},
            setConfig: () => {},
            getConfig: () => undefined,
            getConversation: () => [],
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
        getActivePreparedWorkRequest: () => undefined,
        workspaceRoot: '/tmp/workspace',
        workRequestStore: {},
        prepareWorkRequestContext: async () => ({
            frozenWorkRequest: {
                clarification: { required: false },
                mode: 'immediate_task',
            },
            executionPlan: {
                workRequestId: 'wr-default',
                runMode: 'single',
                steps: [
                    {
                        stepId: 'step-analysis',
                        kind: 'analysis',
                        title: 'Analyze',
                        description: 'Analyze the request',
                        status: 'completed',
                        dependencies: [],
                    },
                    {
                        stepId: 'step-execution',
                        kind: 'execution',
                        title: 'Execute',
                        description: 'Execute the task',
                        status: 'pending',
                        dependencies: ['step-analysis'],
                    },
                ],
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
        let restored = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            onBootstrapRuntimeContext: (runtimeContext) => bootstrapped.push(runtimeContext),
            restorePersistedTasks: () => {
                restored = true;
            },
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
        expect(restored).toBe(true);
        expect(emitted[0]?.type).toBe('bootstrap_runtime_context_response');
    });

    test('handles doctor_preflight and emits a structured report response', async () => {
        const emitted: any[] = [];
        const calls: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            runDoctorPreflight: (input) => {
                calls.push(input);
                return {
                    report: {
                        overallStatus: 'healthy',
                        checks: [],
                    },
                    markdown: '# Sidecar doctor report',
                    reportPath: '/tmp/doctor/report.json',
                    markdownPath: '/tmp/doctor/report.md',
                };
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-doctor-preflight',
            type: 'doctor_preflight',
            payload: {
                startupProfile: 'development',
                outputDir: '/tmp/doctor',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(calls).toEqual([
            {
                startupProfile: 'development',
                outputDir: '/tmp/doctor',
            },
        ]);
        expect(emitted[0]?.type).toBe('doctor_preflight_response');
        expect(emitted[0]?.payload).toMatchObject({
            success: true,
            reportPath: '/tmp/doctor/report.json',
            markdownPath: '/tmp/doctor/report.md',
        });
    });

    test('handles cancel_task by delegating to cancelTaskExecution and emitting response', async () => {
        const emitted: any[] = [];
        const cancelled: Array<{ taskId: string; reason?: string }> = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            cancelTaskExecution: async (taskId, reason) => {
                cancelled.push({ taskId, reason });
                return { success: true };
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-cancel',
            type: 'cancel_task',
            payload: {
                taskId: 'task-cancel',
                reason: 'User cancelled',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(cancelled).toEqual([{ taskId: 'task-cancel', reason: 'User cancelled' }]);
        expect(emitted[0]?.type).toBe('cancel_task_response');
    });

    test('clear_task_history cancels active execution, emits history cleared, and sets status idle', async () => {
        const emitted: any[] = [];
        const cancelled: Array<{ taskId: string; reason?: string }> = [];
        const rawEvents: Array<{ taskId: string; type: string; payload: unknown }> = [];
        const statusEvents: Array<{ taskId: string; status: string }> = [];
        const clearedTaskIds: string[] = [];

        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            cancelTaskExecution: async (taskId, reason) => {
                cancelled.push({ taskId, reason });
                return { success: true };
            },
            taskSessionStore: {
                clearConversation: (taskId) => {
                    clearedTaskIds.push(taskId);
                },
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            taskEventBus: {
                emitRaw: (taskId, type, payload) => {
                    rawEvents.push({ taskId, type, payload });
                },
                emitChatMessage: () => {},
                emitStatus: (taskId, payload) => {
                    statusEvents.push({ taskId, status: payload.status });
                },
                reset: () => {},
                emitStarted: () => {},
                emitFinished: () => {},
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-clear-history',
            type: 'clear_task_history',
            payload: {
                taskId: 'task-clear-1',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(cancelled).toEqual([{ taskId: 'task-clear-1', reason: 'Task cleared by user' }]);
        expect(clearedTaskIds).toEqual(['task-clear-1']);
        expect(rawEvents).toEqual([
            {
                taskId: 'task-clear-1',
                type: 'TASK_HISTORY_CLEARED',
                payload: { reason: 'user_requested' },
            },
        ]);
        expect(statusEvents).toEqual([
            { taskId: 'task-clear-1', status: 'idle' },
        ]);
        expect(emitted[0]?.type).toBe('clear_task_history_response');
    });

    test('passes session task isolation context into autonomous task starts', async () => {
        const startCalls: any[] = [];
        const emitted: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            getTaskConfig: () => ({ workspacePath: '/tmp/task-workspace' }),
            getAutonomousAgent: () => ({
                startTask: async (_query, options) => {
                    startCalls.push(options);
                    return {
                        createdAt: new Date().toISOString(),
                        summary: 'done',
                        decomposedTasks: [],
                        verificationResult: { goalMet: true },
                    };
                },
                getTask: () => null,
                pauseTask: () => true,
                resumeTask: async () => {},
                cancelTask: () => true,
                getAllTasks: () => [],
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-autonomous',
            type: 'start_autonomous_task',
            payload: {
                taskId: 'task-autonomous',
                query: 'verify isolation',
                autoSaveMemory: true,
                runInBackground: false,
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(startCalls).toEqual([
            {
                autoSaveMemory: true,
                notifyOnComplete: true,
                runInBackground: false,
                sessionTaskId: 'task-autonomous',
                workspacePath: '/tmp/task-workspace',
            },
        ]);
        expect(emitted[0]?.type).toBe('start_autonomous_task_response');
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

    test('handles send_task_message follow-up path and continues agent flow', async () => {
        const emitted: any[] = [];
        const pushed: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
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
        expect(pushed).toHaveLength(1);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'PLAN_UPDATED',
        ]);
        expect(continued).toBe(true);
    });

    test('does not emit running status before clarification blocks execution', async () => {
        const emitted: any[] = [];
        const statusEvents: Array<{ taskId: string; status: string }> = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            taskEventBus: {
                emitRaw: () => {},
                emitChatMessage: () => {},
                emitStatus: (taskId, payload) => {
                    statusEvents.push({ taskId, status: payload.status });
                },
                reset: () => {},
                emitStarted: () => {},
                emitFinished: () => {},
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    clarification: {
                        required: true,
                        reason: '当前请求缺少明确执行对象。',
                        questions: ['请明确你要我继续处理的具体对象、文件、页面或任务目标。'],
                        missingFields: ['task_scope'],
                    },
                    mode: 'immediate_task',
                    tasks: [{ objective: '继续处理上一个任务' }],
                    deliverables: [{
                        id: 'deliverable-chat',
                        title: 'Final response',
                        type: 'chat_reply',
                        description: 'Return response',
                        required: true,
                        format: 'chat_message',
                    }],
                    userActionsRequired: [{
                        id: 'action-clarify',
                        title: 'Provide missing task details',
                        kind: 'clarify_input',
                        description: '当前请求缺少明确执行对象。',
                        riskTier: 'high',
                        executionPolicy: 'hard_block',
                        blocking: true,
                        questions: ['请明确你要我继续处理的具体对象、文件、页面或任务目标。'],
                        instructions: ['task_scope'],
                    }],
                },
                executionPlan: {
                    workRequestId: 'wr-clarify',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze follow-up',
                            status: 'completed',
                            dependencies: [],
                        },
                    ],
                },
                executionQuery: '继续',
                workRequestExecutionPrompt: 'prompt',
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-clarify',
            type: 'send_task_message',
            payload: {
                taskId: 'task-clarify',
                content: '继续',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(statusEvents).toEqual([]);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'TASK_USER_ACTION_REQUIRED',
            'CHAT_MESSAGE',
            'TASK_CLARIFICATION_REQUIRED',
            'TASK_STATUS',
        ]);
        expect(emitted[7]?.payload?.status).toBe('idle');
    });

    test('treats approval follow-up as continuing prior non-chat deliverable objective', async () => {
        const emitted: any[] = [];
        const sourceTexts: string[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'assistant', content: '如果你同意，我现在就为你安排执行。' },
                ],
                getArtifactContract: () => ({ type: 'old-artifact-contract' }),
                setArtifactContract: () => {},
            },
            getActivePreparedWorkRequest: () => ({
                frozenWorkRequest: {
                    id: 'wr-old-approval',
                    mode: 'immediate_task',
                    sourceText: '生成周报并保存为 reports/1-clawbot-openclaw.md',
                    tasks: [{ objective: '生成周报并保存为 reports/1-clawbot-openclaw.md' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-old',
                        title: 'Weekly report',
                        type: 'report_file',
                        description: 'Write report markdown file',
                        required: true,
                        path: 'reports/1-clawbot-openclaw.md',
                        format: 'md',
                    }],
                },
            }),
            prepareWorkRequestContext: async ({ sourceText }) => {
                sourceTexts.push(sourceText);
                return {
                    frozenWorkRequest: {
                        id: 'wr-new-approval',
                        mode: 'immediate_task',
                        sourceText,
                        tasks: [{ objective: '生成周报并保存为 reports/1-clawbot-openclaw.md' }],
                        clarification: { required: false },
                        deliverables: [{
                            id: 'deliverable-new',
                            title: 'Weekly report',
                            type: 'report_file',
                            description: 'Write report markdown file',
                            required: true,
                            path: 'reports/1-clawbot-openclaw.md',
                            format: 'md',
                        }],
                    },
                    executionPlan: {
                        workRequestId: 'wr-new-approval',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze approval follow-up',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Execute approved plan',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: '生成周报并保存为 reports/1-clawbot-openclaw.md',
                    workRequestExecutionPrompt: 'prompt',
                };
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-approval-followup',
            type: 'send_task_message',
            payload: {
                taskId: 'task-approval-followup',
                content: '同意',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(sourceTexts[0]).toContain('用户确认：继续执行');
        expect(sourceTexts[0]).not.toBe('同意');
        expect(emitted.some((message) => message.type === 'TASK_CLARIFICATION_REQUIRED')).toBe(false);
    });

    test('emits contradictory-evidence reopen and rebuilds artifact contract when a follow-up corrects deliverables', async () => {
        const emitted: any[] = [];
        const artifactContractCalls: Array<{ query: string; deliverables: unknown[] | undefined }> = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            getActivePreparedWorkRequest: () => ({
                frozenWorkRequest: {
                    id: 'wr-old',
                    mode: 'immediate_task',
                    sourceText: '写一个总结，保存到 /tmp/report.md',
                    tasks: [{ objective: '写一个总结' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-old',
                        title: 'Old report',
                        type: 'report_file',
                        description: 'Save the report to markdown.',
                        required: true,
                        path: '/tmp/report.md',
                        format: 'md',
                    }],
                },
            }),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [],
                getArtifactContract: () => ({ type: 'old-artifact-contract' }),
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-new',
                    mode: 'immediate_task',
                    sourceText: 'Actually, save it to /tmp/report.pdf instead.',
                    tasks: [{ objective: '写一个总结' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-new',
                        title: 'Updated report',
                        type: 'artifact_file',
                        description: 'Save the report to PDF.',
                        required: true,
                        path: '/tmp/report.pdf',
                        format: 'pdf',
                    }],
                },
                executionPlan: {
                    workRequestId: 'wr-new',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze corrected request',
                            status: 'completed',
                            dependencies: [],
                        },
                        {
                            stepId: 'step-execution',
                            kind: 'execution',
                            title: 'Execute',
                            description: 'Execute corrected plan',
                            status: 'pending',
                            dependencies: ['step-analysis'],
                        },
                    ],
                },
                executionQuery: 'Actually, save it to /tmp/report.pdf instead.',
                workRequestExecutionPrompt: 'prompt',
            }),
            buildArtifactContract: (query, deliverables) => {
                artifactContractCalls.push({ query, deliverables });
                return { type: 'rebuilt-artifact-contract' };
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-reopen-correction',
            type: 'send_task_message',
            payload: {
                taskId: 'task-reopen-correction',
                content: 'Actually, save it to /tmp/report.pdf instead.',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_CONTRACT_REOPENED',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'PLAN_UPDATED',
        ]);
        expect(emitted[1]?.payload?.trigger).toBe('contradictory_evidence');
        expect(emitted[1]?.payload?.reason).toContain('deliverables or output targets changed');
        expect(emitted[1]?.payload?.reasons).toContain('deliverables or output targets changed');
        expect(emitted[1]?.payload?.diff?.changedFields).toContain('deliverables');
        expect(emitted[1]?.payload?.diff?.deliverablesChanged?.after?.join('|')).toContain('/tmp/report.pdf');
        expect(artifactContractCalls).toEqual([{
            query: 'Actually, save it to /tmp/report.pdf instead.',
            deliverables: [
                expect.objectContaining({
                    path: '/tmp/report.pdf',
                    format: 'pdf',
                }),
            ],
        }]);
    });

    test('records superseded frozen contracts as tombstones when follow-up refreeze changes scope', async () => {
        let capturedConfig: any;
        const deps = createRuntimeCommandDeps({
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: (_taskId, config) => {
                    capturedConfig = config;
                },
                getConfig: () => undefined,
                getConversation: () => [],
                getArtifactContract: () => ({ type: 'old-artifact-contract' }),
                setArtifactContract: () => {},
            },
            getActivePreparedWorkRequest: () => ({
                frozenWorkRequest: {
                    id: 'wr-old',
                    mode: 'immediate_task',
                    sourceText: '写一个总结，保存到 /tmp/report.md',
                    tasks: [{ objective: '写一个总结' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-old',
                        title: 'Old report',
                        type: 'report_file',
                        description: 'Save the report to markdown.',
                        required: true,
                        path: '/tmp/report.md',
                        format: 'md',
                    }],
                },
            }),
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-new',
                    mode: 'immediate_task',
                    sourceText: 'Actually, save it to /tmp/report.pdf instead.',
                    tasks: [{ objective: '写一个总结' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-new',
                        title: 'Updated report',
                        type: 'artifact_file',
                        description: 'Save the report to PDF.',
                        required: true,
                        path: '/tmp/report.pdf',
                        format: 'pdf',
                    }],
                },
                executionPlan: {
                    workRequestId: 'wr-new',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze corrected request',
                            status: 'completed',
                            dependencies: [],
                        },
                        {
                            stepId: 'step-execution',
                            kind: 'execution',
                            title: 'Execute',
                            description: 'Execute corrected plan',
                            status: 'pending',
                            dependencies: ['step-analysis'],
                        },
                    ],
                },
                executionQuery: 'Actually, save it to /tmp/report.pdf instead.',
                workRequestExecutionPrompt: 'prompt',
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-tombstone',
            type: 'send_task_message',
            payload: {
                taskId: 'task-refreeze-tombstone',
                content: 'Actually, save it to /tmp/report.pdf instead.',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(capturedConfig?.lastFrozenWorkRequestSnapshot?.deliverables?.[0]?.path).toBe('/tmp/report.pdf');
        expect(capturedConfig?.supersededContractTombstones).toHaveLength(1);
        expect(capturedConfig?.supersededContractTombstones?.[0]).toMatchObject({
            reason: 'contract_refreeze',
            snapshot: {
                deliverables: [
                    expect.objectContaining({
                        path: '/tmp/report.md',
                        format: 'md',
                    }),
                ],
            },
        });
    });

    test('falls back to the stored frozen snapshot for reopen detection after the active prepared request is cleared', async () => {
        const emitted: any[] = [];
        const artifactContractCalls: Array<{ query: string; deliverables: unknown[] | undefined }> = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            getTaskConfig: () => ({
                workspacePath: '/tmp/workspace',
                lastFrozenWorkRequestSnapshot: {
                    mode: 'immediate_task',
                    sourceText: '写一个总结，保存到 /tmp/report.md',
                    primaryObjective: '写一个总结',
                    preferredWorkflows: [],
                    resolvedTargets: [],
                    deliverables: [{
                        type: 'report_file',
                        path: '/tmp/report.md',
                        format: 'md',
                    }],
                },
            }),
            getActivePreparedWorkRequest: () => undefined,
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [],
                getArtifactContract: () => ({ type: 'old-artifact-contract' }),
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-new-from-snapshot',
                    mode: 'immediate_task',
                    sourceText: 'Actually, save it to /tmp/report.pdf instead.',
                    tasks: [{ objective: '写一个总结' }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-new',
                        title: 'Updated report',
                        type: 'artifact_file',
                        description: 'Save the report to PDF.',
                        required: true,
                        path: '/tmp/report.pdf',
                        format: 'pdf',
                    }],
                },
                executionPlan: {
                    workRequestId: 'wr-new-from-snapshot',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze corrected request',
                            status: 'completed',
                            dependencies: [],
                        },
                        {
                            stepId: 'step-execution',
                            kind: 'execution',
                            title: 'Execute',
                            description: 'Execute corrected plan',
                            status: 'pending',
                            dependencies: ['step-analysis'],
                        },
                    ],
                },
                executionQuery: 'Actually, save it to /tmp/report.pdf instead.',
                workRequestExecutionPrompt: 'prompt',
            }),
            buildArtifactContract: (query, deliverables) => {
                artifactContractCalls.push({ query, deliverables });
                return { type: 'rebuilt-artifact-contract' };
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-reopen-from-snapshot',
            type: 'send_task_message',
            payload: {
                taskId: 'task-reopen-from-snapshot',
                content: 'Actually, save it to /tmp/report.pdf instead.',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_CONTRACT_REOPENED',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'PLAN_UPDATED',
        ]);
        expect(emitted[1]?.payload?.trigger).toBe('contradictory_evidence');
        expect(emitted[1]?.payload?.diff?.changedFields).toContain('deliverables');
        expect(artifactContractCalls).toEqual([{
            query: 'Actually, save it to /tmp/report.pdf instead.',
            deliverables: [
                expect.objectContaining({
                    path: '/tmp/report.pdf',
                    format: 'pdf',
                }),
            ],
        }]);
    });

    test('emits new-scope reopen when a follow-up changes the execution target', async () => {
        const emitted: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            getActivePreparedWorkRequest: () => ({
                frozenWorkRequest: {
                    id: 'wr-old-target',
                    mode: 'immediate_task',
                    sourceText: '整理 /tmp/inbox-a 里的图片',
                    tasks: [{
                        objective: '整理 /tmp/inbox-a 里的图片',
                        preferredWorkflow: 'organize-host-folder-files',
                        resolvedTargets: [{
                            kind: 'explicit_path',
                            sourcePhrase: '/tmp/inbox-a',
                            resolvedPath: '/tmp/inbox-a',
                            os: 'macos',
                            confidence: 0.99,
                        }],
                    }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-old-target',
                        title: 'Workspace changes',
                        type: 'workspace_change',
                        description: 'Apply file moves.',
                        required: true,
                    }],
                },
            }),
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-new-target',
                    mode: 'immediate_task',
                    sourceText: '整理 /tmp/inbox-b 里的图片',
                    tasks: [{
                        objective: '整理 /tmp/inbox-b 里的图片',
                        preferredWorkflow: 'organize-host-folder-files',
                        resolvedTargets: [{
                            kind: 'explicit_path',
                            sourcePhrase: '/tmp/inbox-b',
                            resolvedPath: '/tmp/inbox-b',
                            os: 'macos',
                            confidence: 0.99,
                        }],
                    }],
                    clarification: { required: false },
                    deliverables: [{
                        id: 'deliverable-new-target',
                        title: 'Workspace changes',
                        type: 'workspace_change',
                        description: 'Apply file moves.',
                        required: true,
                    }],
                },
                executionPlan: {
                    workRequestId: 'wr-new-target',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze new target',
                            status: 'completed',
                            dependencies: [],
                        },
                        {
                            stepId: 'step-execution',
                            kind: 'execution',
                            title: 'Execute',
                            description: 'Execute new target plan',
                            status: 'pending',
                            dependencies: ['step-analysis'],
                        },
                    ],
                },
                executionQuery: '整理 /tmp/inbox-b 里的图片',
                workRequestExecutionPrompt: 'prompt',
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-reopen-scope',
            type: 'send_task_message',
            payload: {
                taskId: 'task-reopen-scope',
                content: '整理 /tmp/inbox-b 里的图片',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted[1]?.type).toBe('TASK_CONTRACT_REOPENED');
        expect(emitted[1]?.payload?.trigger).toBe('new_scope_signal');
        expect(emitted[1]?.payload?.reason).toContain('execution targets changed');
        expect(emitted[1]?.payload?.diff?.changedFields).toContain('execution_targets');
        expect(emitted[1]?.payload?.diff?.targetsChanged?.after?.join('|')).toContain('/tmp/inbox-b');
    });

    test('merges short follow-up input with prior conversation before analysis', async () => {
        const preparedInputs: any[] = [];
        const artifactContractCalls: Array<{ query: string; deliverables: unknown[] | undefined }> = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'user', content: '基于过去一个月的股价波动走势，预测未来最佳买入时间点' },
                    { role: 'assistant', content: '你只要发我：股票代码（港股数字代码）。' },
                ],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async (input) => {
                preparedInputs.push(input);
                return {
                    frozenWorkRequest: {
                        clarification: { required: false },
                        mode: 'immediate_task',
                        deliverables: [
                            {
                                id: 'deliverable-1',
                                title: 'Summary report',
                                type: 'report_file',
                                description: 'Save a report to the workspace.',
                                required: true,
                                path: 'reports/summary.md',
                                format: 'md',
                            },
                        ],
                    },
                    executionPlan: {
                        workRequestId: 'wr-contextual',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze follow-up context',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Continue execution',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: input.sourceText,
                    workRequestExecutionPrompt: 'prompt',
                };
            },
            buildArtifactContract: (query, deliverables) => {
                artifactContractCalls.push({ query, deliverables });
                return { type: 'artifact' };
            },
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-contextual',
            type: 'send_task_message',
            payload: {
                taskId: 'task-3b',
                content: '00100',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(preparedInputs[0]?.sourceText).toContain('原始任务：基于过去一个月的股价波动走势，预测未来最佳买入时间点');
        expect(preparedInputs[0]?.sourceText).toContain('需要补充：你只要发我：股票代码（港股数字代码）。');
        expect(preparedInputs[0]?.sourceText).toContain('用户补充：00100');
        expect(continued).toBe(true);
        expect(artifactContractCalls[0]?.deliverables).toEqual([
            expect.objectContaining({
                path: 'reports/summary.md',
                type: 'report_file',
            }),
        ]);
    });

    test('treats confirm-plan approval replies as execution approval context', async () => {
        const preparedInputs: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            getTaskConfig: () => ({
                workspacePath: '/tmp/workspace',
                lastFrozenWorkRequestSnapshot: {
                    mode: 'immediate_task',
                    sourceText: '用 skill-vetter 审核所有已安装技能',
                    primaryObjective: '用 skill-vetter 审核所有已安装技能',
                    preferredWorkflows: [],
                    resolvedTargets: [],
                    deliverables: [
                        {
                            type: 'chat_reply',
                            format: 'chat_message',
                        },
                    ],
                },
            }),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'user', content: '用 skill-vetter 审核所有已安装技能' },
                    {
                        role: 'assistant',
                        content:
                            'This high-risk task needs explicit approval before Coworkany starts execution.\n'
                            + 'Confirm whether Coworkany should proceed with the current execution plan.\n'
                            + 'Reply with approval to continue, or provide changes that should be applied before execution starts.',
                    },
                ],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async (input) => {
                preparedInputs.push(input);
                return {
                    frozenWorkRequest: {
                        clarification: { required: false },
                        mode: 'immediate_task',
                        deliverables: [
                            {
                                id: 'deliverable-chat',
                                title: 'Final response',
                                type: 'chat_reply',
                                description: 'Return a final response.',
                                required: true,
                                format: 'chat_message',
                            },
                        ],
                    },
                    executionPlan: {
                        workRequestId: 'wr-approved',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze request context',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Execute approved plan',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: '用 skill-vetter 审核所有已安装技能',
                    workRequestExecutionPrompt: 'prompt',
                };
            },
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-confirm-approval-followup',
            type: 'send_task_message',
            payload: {
                taskId: 'task-confirm-approval-followup',
                content: '确认',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(preparedInputs[0]?.sourceText).toContain('原始任务：用 skill-vetter 审核所有已安装技能');
        expect(preparedInputs[0]?.sourceText).toContain('用户确认：继续执行');
        expect(preparedInputs[0]?.sourceText).not.toContain('需要补充：');
        expect(preparedInputs[0]?.sourceText).not.toContain('用户补充：确认');
        expect(continued).toBe(true);
    });

    test('treats generic continue replies as execution approval context for prior objective', async () => {
        const preparedInputs: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            getTaskConfig: () => ({
                workspacePath: '/tmp/workspace',
                lastFrozenWorkRequestSnapshot: {
                    mode: 'immediate_task',
                    sourceText: '检索微信发布 clawbot 的消息并分析对腾讯周一影响',
                    primaryObjective: '检索微信发布 clawbot 的消息并分析对腾讯周一影响',
                    preferredWorkflows: [],
                    resolvedTargets: [],
                    deliverables: [
                        {
                            type: 'chat_reply',
                            format: 'chat_message',
                        },
                    ],
                },
            }),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'user', content: '检索微信发布 clawbot 的消息并分析对腾讯周一影响' },
                    { role: 'assistant', content: '已完成初步检索。' },
                ],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async (input) => {
                preparedInputs.push(input);
                return {
                    frozenWorkRequest: {
                        clarification: { required: false },
                        mode: 'immediate_task',
                        deliverables: [
                            {
                                id: 'deliverable-chat',
                                title: 'Final response',
                                type: 'chat_reply',
                                description: 'Return a final response.',
                                required: true,
                                format: 'chat_message',
                            },
                        ],
                    },
                    executionPlan: {
                        workRequestId: 'wr-generic-continue',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze request context',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Execute approved plan',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: '检索微信发布 clawbot 的消息并分析对腾讯周一影响',
                    workRequestExecutionPrompt: 'prompt',
                };
            },
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-generic-continue-followup',
            type: 'send_task_message',
            payload: {
                taskId: 'task-generic-continue-followup',
                content: '继续',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(preparedInputs[0]?.sourceText).toContain('原始任务：检索微信发布 clawbot 的消息并分析对腾讯周一影响');
        expect(preparedInputs[0]?.sourceText).toContain('用户确认：继续执行');
        expect(preparedInputs[0]?.sourceText).not.toContain('请明确你要我继续处理的具体对象');
        expect(continued).toBe(true);
    });

    test('merges corrective follow-up input with the previous frozen contract context before analysis', async () => {
        const preparedInputs: any[] = [];
        const deps = createRuntimeCommandDeps({
            getTaskConfig: () => ({
                workspacePath: '/tmp/workspace',
                lastFrozenWorkRequestSnapshot: {
                    mode: 'immediate_task',
                    sourceText: 'Write a simple Hello World program and save it to /tmp/workspace/hello.js',
                    primaryObjective: 'Write a simple Hello World program',
                    preferredWorkflows: [],
                    resolvedTargets: [],
                    deliverables: [
                        {
                            type: 'artifact_file',
                            path: '/tmp/workspace/hello.js',
                            format: 'js',
                        },
                    ],
                },
            }),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'user', content: 'Write a simple Hello World program and save it to /tmp/workspace/hello.js' },
                    { role: 'assistant', content: 'Done.' },
                ],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async (input) => {
                preparedInputs.push(input);
                return {
                    frozenWorkRequest: {
                        clarification: { required: false },
                        mode: 'immediate_task',
                        deliverables: [
                            {
                                id: 'deliverable-ts',
                                title: 'TypeScript file',
                                type: 'artifact_file',
                                description: 'Save the program to the corrected TypeScript path.',
                                required: true,
                                path: '/tmp/workspace/hello.ts',
                                format: 'ts',
                            },
                        ],
                    },
                    executionPlan: {
                        workRequestId: 'wr-corrective-follow-up',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze corrected request',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Execute corrected request',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: input.sourceText,
                    workRequestExecutionPrompt: 'prompt',
                };
            },
            continuePreparedAgentFlow: async () => {},
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-corrective-context',
            type: 'send_task_message',
            payload: {
                taskId: 'task-corrective-context',
                content: 'Actually, save it to /tmp/workspace/hello.ts instead.',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(preparedInputs[0]?.sourceText).toContain('Original task: Write a simple Hello World program and save it to /tmp/workspace/hello.js');
        expect(preparedInputs[0]?.sourceText).toContain('User correction: Actually, save it to /tmp/workspace/hello.ts instead.');
    });

    test('emits plan and blocking collaboration events before clarification on follow-up', async () => {
        const emitted: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [
                    { role: 'user', content: '继续处理这个' },
                ],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-clarify',
                    sourceText: '继续处理这个',
                    tasks: [
                        {
                            objective: '继续处理这个',
                        },
                    ],
                    clarification: {
                        required: true,
                        reason: 'Need the missing object',
                        questions: ['你要继续处理哪个对象？'],
                        missingFields: ['subject'],
                        assumptions: [],
                    },
                    deliverables: [
                        {
                            id: 'deliverable-1',
                            title: 'Final report',
                            type: 'report_file',
                            description: 'Save the final report.',
                            required: true,
                            path: 'reports/final.md',
                        },
                    ],
                    checkpoints: [
                        {
                            id: 'checkpoint-1',
                            title: 'Clarify target',
                            kind: 'manual_action',
                            reason: 'Need the concrete target before execution.',
                            userMessage: 'Please tell Coworkany what should be continued.',
                            riskTier: 'high',
                            executionPolicy: 'hard_block',
                            requiresUserConfirmation: true,
                            blocking: true,
                        },
                    ],
                    userActionsRequired: [
                        {
                            id: 'action-1',
                            title: 'Clarify the target',
                            kind: 'clarify_input',
                            description: 'Coworkany needs the exact object to continue.',
                            riskTier: 'high',
                            executionPolicy: 'hard_block',
                            blocking: true,
                            questions: ['你要继续处理哪个对象？'],
                            instructions: ['Reply with the exact object or file.'],
                            fulfillsCheckpointId: 'checkpoint-1',
                        },
                    ],
                    missingInfo: [
                        {
                            field: 'subject',
                            reason: 'No concrete target provided.',
                            blocking: true,
                            question: '你要继续处理哪个对象？',
                        },
                    ],
                },
                executionPlan: {
                    workRequestId: 'wr-clarify',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-clarification',
                            kind: 'clarification',
                            title: 'Clarify missing inputs',
                            description: 'Need the concrete target.',
                            status: 'blocked',
                            dependencies: [],
                        },
                    ],
                },
                executionQuery: '继续处理这个',
                workRequestExecutionPrompt: 'prompt',
            }),
            buildClarificationMessage: () => '你要继续处理哪个对象？',
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-clarify-plan',
            type: 'send_task_message',
            payload: {
                taskId: 'task-clarify',
                content: '继续处理这个',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'TASK_CHECKPOINT_REACHED',
            'TASK_USER_ACTION_REQUIRED',
            'CHAT_MESSAGE',
            'TASK_CLARIFICATION_REQUIRED',
            'TASK_STATUS',
        ]);
        expect(emitted[2]?.payload?.deliverables?.[0]?.path).toBe('reports/final.md');
        expect(emitted[3]?.payload?.steps?.some((step: any) => step.status === 'blocked')).toBe(true);
        expect(emitted[4]?.payload?.checkpointId).toBe('checkpoint-1');
        expect(emitted[4]?.payload?.executionPolicy).toBe('hard_block');
        expect(emitted[4]?.payload?.riskTier).toBe('high');
        expect(emitted[5]?.payload?.actionId).toBe('action-1');
        expect(emitted[5]?.payload?.executionPolicy).toBe('hard_block');
        expect(emitted[5]?.payload?.riskTier).toBe('high');
    });

    test('blocks high-risk follow-up execution until the user confirms the plan', async () => {
        const emitted: any[] = [];
        const pushed: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            pushConversationMessage: (taskId, message) => {
                pushed.push({ taskId, message });
                return [];
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-confirm',
                    sourceText: '修复当前项目里的登录 bug，并直接修改代码完成实现',
                    mode: 'immediate_task',
                    tasks: [
                        {
                            objective: '修复当前项目里的登录 bug，并直接修改代码完成实现',
                        },
                    ],
                    clarification: {
                        required: false,
                        questions: [],
                        missingFields: [],
                        assumptions: [],
                        canDefault: true,
                    },
                    hitlPolicy: {
                        riskTier: 'high',
                        requiresPlanConfirmation: true,
                        reasons: ['Execution is expected to modify code or workspace state.'],
                    },
                    runtimeIsolationPolicy: {
                        connectorIsolationMode: 'deny_by_default',
                        filesystemMode: 'workspace_only',
                        allowedWorkspacePaths: ['/tmp/workspace'],
                        writableWorkspacePaths: ['/tmp/workspace'],
                        networkAccess: 'none',
                        allowedDomains: [],
                        notes: ['Connector/toolpack access is denied by default unless explicitly enabled for the task session.'],
                    },
                    sessionIsolationPolicy: {
                        workspaceBindingMode: 'frozen_workspace_only',
                        followUpScope: 'same_task_only',
                        allowWorkspaceOverride: false,
                        supersededContractHandling: 'tombstone_prior_contracts',
                        staleEvidenceHandling: 'evict_on_refreeze',
                        notes: ['Follow-up and resume execution stay bound to the original task session.'],
                    },
                    memoryIsolationPolicy: {
                        classificationMode: 'scope_tagged',
                        readScopes: ['task', 'workspace', 'user_preference'],
                        writeScopes: ['task', 'workspace'],
                        defaultWriteScope: 'workspace',
                        notes: ['Memory reads and writes must be tagged by scope before they can enter long-term storage or prompt context.'],
                    },
                    tenantIsolationPolicy: {
                        workspaceBoundaryMode: 'same_workspace_only',
                        userBoundaryMode: 'current_local_user_only',
                        allowCrossWorkspaceMemory: false,
                        allowCrossWorkspaceFollowUp: false,
                        allowCrossUserMemory: false,
                        notes: ['Task continuity is restricted to the same workspace boundary.'],
                    },
                    checkpoints: [
                        {
                            id: 'checkpoint-review',
                            title: 'Review execution plan',
                            kind: 'review',
                            reason: 'Execution risk tier is high and requires explicit user approval before continuing.',
                            userMessage: 'Review the planned execution and wait for the user to confirm before starting execution.',
                            riskTier: 'high',
                            executionPolicy: 'review_required',
                            requiresUserConfirmation: true,
                            blocking: true,
                        },
                    ],
                    userActionsRequired: [
                        {
                            id: 'action-confirm',
                            title: 'Confirm the execution plan',
                            kind: 'confirm_plan',
                            description: 'This high-risk task needs explicit approval before Coworkany starts execution.',
                            riskTier: 'high',
                            executionPolicy: 'review_required',
                            blocking: true,
                            questions: ['Confirm whether Coworkany should proceed with the current execution plan.'],
                            instructions: ['Reply with approval to continue, or provide changes that should be applied before execution starts.'],
                            fulfillsCheckpointId: 'checkpoint-review',
                        },
                    ],
                    deliverables: [
                        {
                            id: 'deliverable-code',
                            title: 'Code changes',
                            type: 'code_change',
                            description: 'Produce the required code changes and explain the outcome against the acceptance criteria.',
                            required: true,
                        },
                    ],
                    missingInfo: [],
                },
                executionPlan: {
                    workRequestId: 'wr-confirm',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze the request',
                            status: 'completed',
                            dependencies: [],
                        },
                        {
                            stepId: 'step-execution',
                            kind: 'execution',
                            title: 'Execute',
                            description: 'Execute the task',
                            status: 'pending',
                            dependencies: ['step-analysis'],
                        },
                    ],
                },
                executionQuery: '修复当前项目里的登录 bug，并直接修改代码完成实现',
                workRequestExecutionPrompt: 'prompt',
            }),
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-confirm-plan',
            type: 'send_task_message',
            payload: {
                taskId: 'task-confirm',
                content: '修复当前项目里的登录 bug，并直接修改代码完成实现',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(continued).toBe(false);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'TASK_CHECKPOINT_REACHED',
            'TASK_USER_ACTION_REQUIRED',
            'CHAT_MESSAGE',
            'TASK_STATUS',
        ]);
        expect(emitted[2]?.payload?.hitlPolicy).toMatchObject({
            riskTier: 'high',
            requiresPlanConfirmation: true,
        });
        expect(emitted[2]?.payload?.runtimeIsolationPolicy).toMatchObject({
            connectorIsolationMode: 'deny_by_default',
            filesystemMode: 'workspace_only',
        });
        expect(emitted[2]?.payload?.sessionIsolationPolicy).toMatchObject({
            followUpScope: 'same_task_only',
            allowWorkspaceOverride: false,
        });
        expect(emitted[2]?.payload?.memoryIsolationPolicy).toMatchObject({
            defaultWriteScope: 'workspace',
        });
        expect(emitted[2]?.payload?.tenantIsolationPolicy).toMatchObject({
            workspaceBoundaryMode: 'same_workspace_only',
        });
        expect(emitted[5]?.payload?.kind).toBe('confirm_plan');
        expect(emitted[5]?.payload?.executionPolicy).toBe('review_required');
        expect(emitted[5]?.payload?.riskTier).toBe('high');
        expect(emitted[7]?.payload?.status).toBe('idle');
        expect(pushed[pushed.length - 1]?.message?.role).toBe('assistant');
    });

    test('denies follow-up workspace overrides once the task session is frozen', async () => {
        const emitted: any[] = [];
        setTaskIsolationPolicy({
            taskId: 'task-boundary',
            workspacePath: '/tmp/workspace',
            sessionIsolationPolicy: {
                workspaceBindingMode: 'frozen_workspace_only',
                followUpScope: 'same_task_only',
                allowWorkspaceOverride: false,
                supersededContractHandling: 'tombstone_prior_contracts',
                staleEvidenceHandling: 'evict_on_refreeze',
                notes: [],
            },
        });
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            getTaskConfig: () => ({
                workspacePath: '/tmp/workspace',
            }),
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4-workspace-override',
            type: 'send_task_message',
            payload: {
                taskId: 'task-boundary',
                content: '继续刚才的任务',
                config: {
                    workspacePath: '/tmp/other-workspace',
                },
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'CHAT_MESSAGE',
            'TASK_STATUS',
        ]);
        expect(emitted[0]?.payload).toMatchObject({
            success: false,
            taskId: 'task-boundary',
            error: 'session_workspace_override_denied',
        });
        expect(emitted[1]?.payload?.content).toContain('/tmp/workspace');
        expect(emitted[2]?.payload?.status).toBe('idle');
    });

    test('handles send_task_message scheduled follow-up path without continuing agent flow', async () => {
        const emitted: any[] = [];
        const pushed: any[] = [];
        const scheduledCalls: any[] = [];
        let continued = false;
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            pushConversationMessage: (taskId, message) => {
                pushed.push({ taskId, message });
                return [];
            },
            prepareWorkRequestContext: async () => ({
                frozenWorkRequest: {
                    id: 'wr-1',
                    mode: 'scheduled_task',
                    schedule: { executeAt: '2026-03-19T06:00:00.000Z' },
                    presentation: { ttsEnabled: true },
                    tasks: [{
                        title: 'Scheduled Reddit',
                        objective: '检索 Reddit',
                        constraints: ['用语音播报'],
                        acceptanceCriteria: ['每篇只保留标题和简要介绍'],
                    }],
                    clarification: { required: false },
                },
                executionPlan: {
                    workRequestId: 'wr-1',
                    runMode: 'single',
                    steps: [
                        {
                            stepId: 'step-analysis',
                            kind: 'analysis',
                            title: 'Analyze',
                            description: 'Analyze scheduled request',
                            status: 'completed',
                            dependencies: [],
                        },
                    ],
                },
                executionQuery: 'ignored',
                workRequestExecutionPrompt: undefined,
            }),
            scheduleTaskInternal: (input) => {
                scheduledCalls.push(input);
                return { id: 'scheduled-2' };
            },
            buildScheduledConfirmationMessage: () => '已安排在 1 分钟后执行',
            continuePreparedAgentFlow: async () => {
                continued = true;
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-r4b',
            type: 'send_task_message',
            payload: {
                taskId: 'task-4',
                content: '1 分钟后，检索 Reddit 并语音播报',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(scheduledCalls).toHaveLength(1);
        expect(scheduledCalls[0]?.speakResult).toBe(true);
        expect(emitted.map((message) => message.type)).toEqual([
            'send_task_message_response',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'CHAT_MESSAGE',
            'TASK_FINISHED',
        ]);
        expect(pushed).toHaveLength(1);
        expect(continued).toBe(false);
    });

    test('handles resume_interrupted_task with saved context and continues agent flow', async () => {
        const emitted: any[] = [];
        const pushed: any[] = [];
        const ensured: any[] = [];
        const continued: any[] = [];
        const preparedInputs: any[] = [];

        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            ensureTaskRuntimePersistence: (input) => {
                ensured.push(input);
            },
            getTaskConfig: () => ({ workspacePath: '/tmp/ws', enabledClaudeSkills: ['browser'] }),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => ({ workspacePath: '/tmp/ws', enabledClaudeSkills: ['browser'] }),
                getConversation: () => [
                    { role: 'user', content: 'Post to Xiaohongshu with the saved draft' },
                    { role: 'assistant', content: 'Working on it' },
                ],
                getArtifactContract: () => ({ type: 'artifact' }),
                setArtifactContract: () => {},
            },
            pushConversationMessage: (taskId, message) => {
                pushed.push({ taskId, message });
                return [{ role: 'user', content: 'existing' }, message];
            },
            prepareWorkRequestContext: async (input) => {
                preparedInputs.push(input);
                return {
                    frozenWorkRequest: {
                        clarification: { required: false },
                        mode: 'immediate_task',
                    },
                    executionPlan: {
                        workRequestId: 'wr-resume',
                        runMode: 'single',
                        steps: [
                            {
                                stepId: 'step-analysis',
                                kind: 'analysis',
                                title: 'Analyze',
                                description: 'Analyze resume request',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                stepId: 'step-execution',
                                kind: 'execution',
                                title: 'Execute',
                                description: 'Resume execution',
                                status: 'pending',
                                dependencies: ['step-analysis'],
                            },
                        ],
                    },
                    executionQuery: input.sourceText,
                    workRequestExecutionPrompt: 'resume prompt',
                };
            },
            continuePreparedAgentFlow: async (input) => {
                continued.push(input);
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-resume',
            type: 'resume_interrupted_task',
            payload: {
                taskId: 'task-5',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(ensured).toEqual([{ taskId: 'task-5', title: '', workspacePath: '/tmp/ws' }]);
        expect(emitted.map((message) => message.type)).toEqual([
            'resume_interrupted_task_response',
            'TASK_STATUS',
            'TASK_RESUMED',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'PLAN_UPDATED',
            'PLAN_UPDATED',
        ]);
        expect(pushed[0]?.message?.content).toContain('[RESUME_REQUESTED]');
        expect(preparedInputs[0]?.sourceText).toBe('Post to Xiaohongshu with the saved draft');
        expect(continued[0]?.userMessage).toBe('Post to Xiaohongshu with the saved draft');
    });

    test('returns an error when resume_interrupted_task has no saved context', async () => {
        const emitted: any[] = [];
        const deps = createRuntimeCommandDeps({
            emit: (message) => emitted.push(message),
            taskSessionStore: {
                clearConversation: () => {},
                ensureHistoryLimit: () => {},
                setHistoryLimit: () => {},
                setConfig: () => {},
                getConfig: () => undefined,
                getConversation: () => [],
                getArtifactContract: () => undefined,
                setArtifactContract: () => {},
            },
        });

        const handled = await handleRuntimeCommand({
            id: 'cmd-resume-empty',
            type: 'resume_interrupted_task',
            payload: {
                taskId: 'task-6',
            },
        } as any, deps);

        expect(handled).toBe(true);
        expect(emitted[0]).toEqual(expect.objectContaining({
            type: 'resume_interrupted_task_response',
            payload: {
                success: false,
                taskId: 'task-6',
                error: 'no_saved_context',
            },
        }));
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
    test('accepts request_effect_response payloads containing null optional fields', () => {
        const parsed = IpcResponseSchema.safeParse({
            type: 'request_effect_response',
            commandId: '1f502266-10c2-4554-a141-134efeabce39',
            timestamp: new Date().toISOString(),
            payload: {
                response: {
                    requestId: '70de98df-af35-4537-8f46-4a0f93f8dbf4',
                    timestamp: new Date().toISOString(),
                    approved: false,
                    denialReason: 'awaiting_confirmation',
                    approvalType: null,
                    expiresAt: null,
                    denialCode: null,
                    modifiedScope: null,
                },
            },
        });

        expect(parsed.success).toBe(true);
    });

    test('accepts request_effect_response payloads whose effect timestamp uses UTC offset format', () => {
        const parsed = IpcResponseSchema.safeParse({
            type: 'request_effect_response',
            commandId: 'd3571c07-3933-433c-a744-8bcd9fdc931b',
            timestamp: '2026-03-22T16:40:52.732Z',
            payload: {
                response: {
                    requestId: '33632986-642b-4a04-acc1-7d8f06ba33f8',
                    timestamp: '2026-03-22T16:40:52+00:00',
                    approved: false,
                    denialReason: 'awaiting_confirmation',
                    approvalType: null,
                    expiresAt: null,
                    denialCode: null,
                    modifiedScope: null,
                },
            },
        });

        expect(parsed.success).toBe(true);
    });

    test('maps request_effect_response and apply_patch_response into task event bus raw events', async () => {
        const rawCalls: any[] = [];
        const confirmations: any[] = [];
        const deps = createRuntimeResponseDeps({
            taskEventBus: {
                emitRaw: (taskId, type, payload) => {
                    rawCalls.push({ taskId, type, payload });
                },
            },
            policyBridge: {
                handleConfirmation: (requestId, approved, approvalType) => {
                    confirmations.push({ requestId, approved, approvalType });
                },
                handleDenial: () => {},
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
                    approvalType: 'permanent',
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
        expect(confirmations).toEqual([
            {
                requestId: 'req-1',
                approved: true,
                approvalType: 'permanent',
            },
        ]);
        expect(rawCalls).toEqual([
            {
                taskId: 'global',
                type: 'EFFECT_APPROVED',
                payload: {
                    response: {
                        approved: true,
                        requestId: 'req-1',
                        approvalType: 'permanent',
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
