import { describe, expect, test } from 'bun:test';
import type { TaskEvent, TaskSession } from '../src/types';
import { applyTaskEvent } from '../src/stores/taskEvents/reducers/taskReducer';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_SUSPENDED',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(): TaskSession {
    return {
        taskId: 'task-1',
        status: 'running',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

describe('task reducer suspension handling', () => {
    test('stores suspension state and appends one system message', () => {
        const event = makeEvent({
            payload: {
                reason: 'authentication_required',
                userMessage: 'Please log in to continue.',
                canAutoResume: false,
                maxWaitTimeMs: 300000,
            },
        });

        const next = applyTaskEvent(makeSession(), event);

        expect(next.status).toBe('idle');
        expect(next.suspension?.reason).toBe('authentication_required');
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0]?.content).toBe('Please log in to continue.');
    });

    test('does not append duplicate system message for replayed suspension event', () => {
        const event = makeEvent({
            payload: {
                reason: 'authentication_required',
                userMessage: 'Please log in to continue.',
                canAutoResume: false,
                maxWaitTimeMs: 300000,
            },
        });

        const once = applyTaskEvent(makeSession(), event);
        const replayed = applyTaskEvent(once, makeEvent({
            sequence: 2,
            payload: event.payload,
        }));

        expect(replayed.status).toBe('idle');
        expect(replayed.suspension?.reason).toBe('authentication_required');
        expect(replayed.messages).toHaveLength(1);
    });

    test('stores recoverable failure metadata from TASK_FAILED', () => {
        const next = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_FAILED',
            payload: {
                error: 'Task interrupted by sidecar restart',
                errorCode: 'INTERRUPTED',
                recoverable: true,
                suggestion: 'Resume the task to continue from the saved context.',
            },
        }));

        expect(next.status).toBe('failed');
        expect(next.failure).toEqual({
            error: 'Task interrupted by sidecar restart',
            errorCode: 'INTERRUPTED',
            recoverable: true,
            suggestion: 'Resume the task to continue from the saved context.',
        });
        expect(next.messages.at(-1)?.content).toContain('Resume the task');
    });

    test('stores planner contract and current collaboration requirements', () => {
        const planned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Produce a report with one review checkpoint.',
                deliverables: [
                    {
                        id: 'deliverable-1',
                        title: 'Final report',
                        type: 'report_file',
                        description: 'Save the final report',
                        required: true,
                        path: 'reports/final.md',
                    },
                ],
                checkpoints: [
                    {
                        id: 'checkpoint-1',
                        title: 'Review findings',
                        kind: 'review',
                        reason: 'Verify findings before delivery.',
                        userMessage: 'Review the findings before Coworkany delivers the report.',
                        requiresUserConfirmation: true,
                        blocking: true,
                    },
                ],
                userActionsRequired: [],
                missingInfo: [],
            },
        }));

        const withCheckpoint = applyTaskEvent(planned, makeEvent({
            sequence: 2,
            type: 'TASK_CHECKPOINT_REACHED',
            payload: {
                checkpointId: 'checkpoint-1',
                title: 'Review findings',
                kind: 'review',
                reason: 'Verify findings before delivery.',
                userMessage: 'Review the findings before Coworkany delivers the report.',
                requiresUserConfirmation: true,
                blocking: true,
            },
        }));

        const withAction = applyTaskEvent(withCheckpoint, makeEvent({
            sequence: 3,
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                actionId: 'action-1',
                title: 'Confirm delivery',
                kind: 'confirm_plan',
                description: 'Coworkany is waiting for your confirmation.',
                blocking: true,
                questions: ['Should Coworkany deliver now?'],
                instructions: ['Reply with continue to proceed.'],
                fulfillsCheckpointId: 'checkpoint-1',
            },
        }));

        expect(withAction.planSummary).toBe('Produce a report with one review checkpoint.');
        expect(withAction.plannedDeliverables?.[0]?.path).toBe('reports/final.md');
        expect(withAction.currentCheckpoint?.id).toBe('checkpoint-1');
        expect(withAction.currentUserAction?.id).toBe('action-1');
        expect(withAction.status).toBe('idle');
    });

    test('stores research progress and contract reopen state for the plan card', () => {
        const researched = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_RESEARCH_UPDATED',
            payload: {
                summary: 'Research updated: 4/4 queries processed, contract ready to freeze.',
                sourcesChecked: ['conversation', 'workspace', 'web'],
                completedQueries: 4,
                pendingQueries: 0,
                blockingUnknowns: ['target output format'],
                selectedStrategyTitle: 'Use workspace-first export flow',
            },
        }));

        const reopened = applyTaskEvent(researched, makeEvent({
            sequence: 2,
            type: 'TASK_CONTRACT_REOPENED',
            payload: {
                summary: 'Execution evidence requires contract reopen: artifact contract unmet.',
                reason: 'Artifact contract unmet: expected pptx output (generated markdown only)',
                trigger: 'execution_infeasible',
                nextStepId: 'research',
            },
        }));

        expect(reopened.researchSummary).toContain('4/4 queries processed');
        expect(reopened.researchSourcesChecked).toEqual(['conversation', 'workspace', 'web']);
        expect(reopened.researchBlockingUnknowns).toEqual(['target output format']);
        expect(reopened.selectedStrategyTitle).toBe('Use workspace-first export flow');
        expect(reopened.contractReopenReason).toContain('expected pptx output');
        expect(reopened.contractReopenCount).toBe(1);
        expect(reopened.messages.at(-1)?.content).toContain('Execution contract reopened');
    });

    test('replaces planned contract state after reopen and follow-up replanning', () => {
        const initialPlanned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Initial plan saves a markdown report.',
                deliverables: [
                    {
                        id: 'deliverable-md',
                        title: 'Markdown report',
                        type: 'report_file',
                        description: 'Save the report to markdown.',
                        required: true,
                        path: '/tmp/report.md',
                        format: 'md',
                    },
                ],
                checkpoints: [
                    {
                        id: 'checkpoint-old',
                        title: 'Old review',
                        kind: 'review',
                        reason: 'Old review step.',
                        userMessage: 'Review the markdown report.',
                        requiresUserConfirmation: true,
                        blocking: true,
                    },
                ],
                userActionsRequired: [],
                missingInfo: [],
            },
        }));

        const reopened = applyTaskEvent(initialPlanned, makeEvent({
            sequence: 2,
            type: 'TASK_CONTRACT_REOPENED',
            payload: {
                summary: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                reason: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                trigger: 'new_scope_signal',
                nextStepId: 'research',
            },
        }));

        const researched = applyTaskEvent(reopened, makeEvent({
            sequence: 3,
            type: 'TASK_RESEARCH_UPDATED',
            payload: {
                summary: 'Research updated after reopen: 3/3 queries processed.',
                sourcesChecked: ['conversation', 'workspace'],
                completedQueries: 3,
                pendingQueries: 0,
                blockingUnknowns: [],
                selectedStrategyTitle: 'Use PDF export flow',
            },
        }));

        const replanned = applyTaskEvent(researched, makeEvent({
            sequence: 4,
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Replanned contract now saves a PDF artifact.',
                deliverables: [
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
                checkpoints: [
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
                userActionsRequired: [
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
                missingInfo: [],
            },
        }));

        const blocked = applyTaskEvent(replanned, makeEvent({
            sequence: 5,
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                actionId: 'action-new',
                title: 'Grant PDF export access',
                kind: 'manual_step',
                description: 'Allow Coworkany to continue the PDF export.',
                blocking: true,
                questions: [],
                instructions: ['Grant filesystem access, then continue.'],
                fulfillsCheckpointId: 'checkpoint-new',
            },
        }));

        expect(blocked.contractReopenReason).toContain('deliverables or output targets changed');
        expect(blocked.contractReopenCount).toBe(1);
        expect(blocked.researchSummary).toContain('3/3 queries processed');
        expect(blocked.selectedStrategyTitle).toBe('Use PDF export flow');
        expect(blocked.plannedDeliverables?.[0]?.path).toBe('/tmp/report.pdf');
        expect(blocked.plannedDeliverables?.[0]?.format).toBe('pdf');
        expect(blocked.plannedCheckpoints?.[0]?.id).toBe('checkpoint-new');
        expect(blocked.currentCheckpoint).toBeUndefined();
        expect(blocked.currentUserAction?.id).toBe('action-new');
        expect(blocked.status).toBe('idle');
    });

    test('clears stale user-action and checkpoint state when clarification becomes the new blocker', () => {
        const planned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Replanned contract now waits for clarification.',
                deliverables: [],
                checkpoints: [
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
                userActionsRequired: [
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
                missingInfo: [
                    {
                        field: 'task_scope',
                        reason: 'Need the final requested deliverable.',
                        blocking: true,
                        question: 'Do you want PDF export or a TypeScript file?',
                    },
                ],
            },
        }));

        const withCheckpoint = applyTaskEvent(planned, makeEvent({
            sequence: 2,
            type: 'TASK_CHECKPOINT_REACHED',
            payload: {
                checkpointId: 'checkpoint-new',
                title: 'Grant export access',
                kind: 'manual_action',
                reason: 'Need permission to export to PDF.',
                userMessage: 'Grant PDF export access.',
                requiresUserConfirmation: true,
                blocking: true,
            },
        }));

        const withAction = applyTaskEvent(withCheckpoint, makeEvent({
            sequence: 3,
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                actionId: 'action-new',
                title: 'Grant PDF export access',
                kind: 'manual_step',
                description: 'Allow Coworkany to continue the PDF export.',
                blocking: true,
                questions: [],
                instructions: ['Grant filesystem access, then continue.'],
                fulfillsCheckpointId: 'checkpoint-new',
            },
        }));

        const clarificationRequired = applyTaskEvent(withAction, makeEvent({
            sequence: 4,
            type: 'TASK_CLARIFICATION_REQUIRED',
            payload: {
                reason: 'Need clarification before continuing.',
                questions: ['Do you want PDF export or a TypeScript file?'],
            },
        }));

        expect(withAction.currentCheckpoint?.id).toBe('checkpoint-new');
        expect(withAction.currentUserAction?.id).toBe('action-new');
        expect(clarificationRequired.status).toBe('idle');
        expect(clarificationRequired.currentCheckpoint).toBeUndefined();
        expect(clarificationRequired.currentUserAction).toBeUndefined();
        expect(clarificationRequired.clarificationQuestions).toEqual([
            'Do you want PDF export or a TypeScript file?',
        ]);
    });

    test('clears failure metadata when task resumes running', () => {
        const failed = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_FAILED',
            payload: {
                error: 'Task interrupted by sidecar restart',
                errorCode: 'INTERRUPTED',
                recoverable: true,
            },
        }));

        const resumed = applyTaskEvent(failed, makeEvent({
            sequence: 2,
            type: 'TASK_RESUMED',
            payload: {},
        }));

        expect(resumed.status).toBe('running');
        expect(resumed.failure).toBeUndefined();
    });
});
