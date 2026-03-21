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
});
