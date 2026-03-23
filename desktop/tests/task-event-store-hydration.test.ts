import { afterEach, describe, expect, test } from 'bun:test';
import { useTaskEventStore } from '../src/stores/taskEvents';
import type { TaskSession } from '../src/types';

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'running',
        planSteps: overrides.planSteps ?? [],
        toolCalls: overrides.toolCalls ?? [],
        effects: overrides.effects ?? [],
        patches: overrides.patches ?? [],
        messages: overrides.messages ?? [],
        events: overrides.events ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        summary: overrides.summary,
        title: overrides.title,
        suspension: overrides.suspension,
        failure: overrides.failure,
        researchSummary: overrides.researchSummary,
        researchSourcesChecked: overrides.researchSourcesChecked,
        researchBlockingUnknowns: overrides.researchBlockingUnknowns,
        selectedStrategyTitle: overrides.selectedStrategyTitle,
        contractReopenReason: overrides.contractReopenReason,
        contractReopenCount: overrides.contractReopenCount,
        plannedDeliverables: overrides.plannedDeliverables,
        plannedCheckpoints: overrides.plannedCheckpoints,
        plannedUserActions: overrides.plannedUserActions,
        currentUserAction: overrides.currentUserAction,
        workspacePath: overrides.workspacePath,
    };
}

afterEach(() => {
    useTaskEventStore.getState().reset();
});

describe('task event store hydration', () => {
    test('converts stale running sessions into recoverable interrupted failures', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-interrupted',
                    status: 'running',
                    title: 'Long task',
                }),
            ],
            activeTaskId: 'task-interrupted',
        });

        const session = useTaskEventStore.getState().getSession('task-interrupted');

        expect(session?.status).toBe('failed');
        expect(session?.summary).toContain('Resume the task');
        expect(session?.failure).toEqual({
            error: 'Task interrupted by app restart',
            errorCode: 'INTERRUPTED',
            recoverable: true,
            suggestion: 'Resume the task to continue from the saved context.',
        });
    });

    test('does not rewrite suspended sessions during hydration', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-suspended',
                    status: 'running',
                    suspension: {
                        reason: 'authentication_required',
                        userMessage: 'Please log in.',
                        canAutoResume: false,
                    },
                }),
            ],
            activeTaskId: 'task-suspended',
        });

        const session = useTaskEventStore.getState().getSession('task-suspended');

        expect(session?.status).toBe('running');
        expect(session?.failure).toBeUndefined();
        expect(session?.suspension?.reason).toBe('authentication_required');
    });

    test('preserves reopened contract metadata and replanned deliverables during hydration', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-reopened',
                    status: 'idle',
                    summary: 'Allow Coworkany to continue the PDF export.',
                    researchSummary: 'Research updated after reopen: 3/3 queries processed.',
                    researchSourcesChecked: ['conversation', 'workspace'],
                    selectedStrategyTitle: 'Use PDF export flow',
                    contractReopenReason: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                    contractReopenCount: 1,
                    plannedDeliverables: [
                        {
                            id: 'deliverable-pdf',
                            title: 'PDF report',
                            type: 'artifact_file',
                            description: 'Save the report to PDF.',
                            required: true,
                            path: '/tmp/report.pdf',
                            format: 'pdf',
                        },
                    ],
                    plannedCheckpoints: [
                        {
                            id: 'checkpoint-new',
                            title: 'Grant export access',
                            kind: 'manual_action',
                            reason: 'Need permission to export to PDF.',
                            userMessage: 'Grant PDF export access.',
                            requiresUserConfirmation: true,
                            blocking: true,
                        },
                    ],
                    plannedUserActions: [
                        {
                            id: 'action-new',
                            title: 'Grant PDF export access',
                            kind: 'manual_step',
                            description: 'Allow Coworkany to continue the PDF export.',
                            blocking: true,
                            questions: [],
                            instructions: ['Grant filesystem access, then continue.'],
                            fulfillsCheckpointId: 'checkpoint-new',
                        },
                    ],
                    currentUserAction: {
                        id: 'action-new',
                        title: 'Grant PDF export access',
                        kind: 'manual_step',
                        description: 'Allow Coworkany to continue the PDF export.',
                        blocking: true,
                        questions: [],
                        instructions: ['Grant filesystem access, then continue.'],
                        fulfillsCheckpointId: 'checkpoint-new',
                    },
                }),
            ],
            activeTaskId: 'task-reopened',
        });

        const session = useTaskEventStore.getState().getSession('task-reopened');

        expect(session?.status).toBe('idle');
        expect(session?.contractReopenReason).toContain('deliverables or output targets changed');
        expect(session?.contractReopenCount).toBe(1);
        expect(session?.researchSummary).toContain('3/3 queries processed');
        expect(session?.selectedStrategyTitle).toBe('Use PDF export flow');
        expect(session?.plannedDeliverables?.[0]?.path).toBe('/tmp/report.pdf');
        expect(session?.currentUserAction?.id).toBe('action-new');
    });

    test('retitles persisted follow-up sessions from the latest user request during hydration', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-followup',
                    title: '[Scheduled] Old task title',
                    status: 'finished',
                    messages: [
                        {
                            id: 'user-1',
                            role: 'user',
                            content: 'Schedule the Reddit search',
                            timestamp: '2026-03-19T08:15:01.650Z',
                        },
                        {
                            id: 'user-2',
                            role: 'user',
                            content: '从 skillhub 中安装 skill-vetter',
                            timestamp: '2026-03-21T03:54:25.238Z',
                        },
                    ],
                }),
            ],
            activeTaskId: 'task-followup',
        });

        const session = useTaskEventStore.getState().getSession('task-followup');

        expect(session?.title).toBe('从 skillhub 中安装 skill-vetter');
    });

    test('drops persisted sessions that do not have a valid taskId', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({ taskId: 'task-valid', status: 'finished' }),
                {
                    ...makeSession({ taskId: 'task-invalid' }),
                    taskId: '' as unknown as string,
                },
            ],
            activeTaskId: 'task-valid',
        });

        const state = useTaskEventStore.getState();
        expect(state.sessions.has('task-valid')).toBe(true);
        expect(state.sessions.size).toBe(1);
        expect(state.activeTaskId).toBe('task-valid');
    });

    test('request_effect awaiting_confirmation becomes task-level user action requirement', () => {
        useTaskEventStore.getState().ensureSession('task-effect', { status: 'running' }, true);

        useTaskEventStore.getState().handleIpcResponse({
            commandId: 'ipc-effect-1',
            type: 'request_effect_response',
            timestamp: '2026-03-23T01:00:00.000Z',
            payload: {
                taskId: 'task-effect',
                effectType: 'filesystem:read',
                response: {
                    requestId: 'req-1',
                    approved: false,
                    denialReason: 'awaiting_confirmation',
                },
            },
        } as any);

        const session = useTaskEventStore.getState().getSession('task-effect');
        expect(session?.status).toBe('idle');
        expect(session?.currentUserAction?.id).toBe('req-1');
        expect(session?.currentUserAction?.blocking).toBe(true);
        expect(session?.events.some((event) => event.type === 'EFFECT_DENIED')).toBe(true);
        expect(session?.events.some((event) => event.type === 'TASK_USER_ACTION_REQUIRED')).toBe(true);
    });

    test('request_effect_response uses payload.taskId instead of active task fallback', () => {
        useTaskEventStore.getState().ensureSession('task-active', { status: 'running' }, true);
        useTaskEventStore.getState().ensureSession('task-target', { status: 'running' }, false);
        useTaskEventStore.getState().setActiveTask('task-active');

        useTaskEventStore.getState().handleIpcResponse({
            commandId: 'ipc-effect-2',
            type: 'request_effect_response',
            timestamp: '2026-03-23T01:00:05.000Z',
            payload: {
                taskId: 'task-target',
                effectType: 'filesystem:read',
                response: {
                    requestId: 'req-2',
                    approved: false,
                    denialReason: 'awaiting_confirmation',
                },
            },
        } as any);

        const active = useTaskEventStore.getState().getSession('task-active');
        const target = useTaskEventStore.getState().getSession('task-target');
        expect(active?.events.some((event) => event.id === 'ipc-effect-2')).toBe(false);
        expect(target?.events.some((event) => event.id === 'ipc-effect-2')).toBe(true);
        expect(target?.currentUserAction?.id).toBe('req-2');
    });

    test('request_effect_response creates missing target session when payload.taskId is present', () => {
        useTaskEventStore.getState().setActiveTask('task-active');

        useTaskEventStore.getState().handleIpcResponse({
            commandId: 'ipc-effect-3',
            type: 'request_effect_response',
            timestamp: '2026-03-23T01:00:10.000Z',
            payload: {
                taskId: 'task-late-bound',
                effectType: 'filesystem:read',
                response: {
                    requestId: 'req-3',
                    approved: false,
                    denialReason: 'awaiting_confirmation',
                },
            },
        } as any);

        const created = useTaskEventStore.getState().getSession('task-late-bound');
        const active = useTaskEventStore.getState().getSession('task-active');
        expect(created).toBeDefined();
        expect(created?.events.some((event) => event.id === 'ipc-effect-3')).toBe(true);
        expect(created?.currentUserAction?.id).toBe('req-3');
        expect(active).toBeUndefined();
    });
});
