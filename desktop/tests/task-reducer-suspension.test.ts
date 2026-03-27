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
                reasons: ['artifact contract unmet'],
                diff: {
                    changedFields: ['deliverables'],
                    deliverablesChanged: {
                        before: ['report_file:/tmp/report.pptx:pptx'],
                        after: ['report_file:/tmp/report.md:md'],
                    },
                },
                nextStepId: 'research',
            },
        }));

        expect(reopened.researchSummary).toContain('4/4 queries processed');
        expect(reopened.researchSourcesChecked).toEqual(['conversation', 'workspace', 'web']);
        expect(reopened.researchBlockingUnknowns).toEqual(['target output format']);
        expect(reopened.selectedStrategyTitle).toBe('Use workspace-first export flow');
        expect(reopened.contractReopenReason).toContain('expected pptx output');
        expect(reopened.contractReopenReasons).toEqual(['artifact contract unmet']);
        expect(reopened.contractReopenDiff?.changedFields).toEqual(['deliverables']);
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
                reasons: ['deliverables or output targets changed'],
                diff: {
                    changedFields: ['deliverables'],
                    deliverablesChanged: {
                        before: ['report_file:/tmp/report.md:md'],
                        after: ['artifact_file:/tmp/report.pdf:pdf'],
                    },
                },
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
                executionProfile: {
                    primaryHardness: 'high_risk',
                    requiredCapabilities: ['workspace_write', 'human_review'],
                    blockingRisk: 'permission',
                    interactionMode: 'action_first',
                    executionShape: 'staged',
                    reasons: ['Execution is expected to write files or mutate workspace state.'],
                },
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
        expect(blocked.contractReopenDiff?.changedFields).toEqual(['deliverables']);
        expect(blocked.contractReopenCount).toBe(1);
        expect(blocked.researchSummary).toContain('3/3 queries processed');
        expect(blocked.selectedStrategyTitle).toBe('Use PDF export flow');
        expect(blocked.plannedDeliverables?.[0]?.path).toBe('/tmp/report.pdf');
        expect(blocked.plannedDeliverables?.[0]?.format).toBe('pdf');
        expect(blocked.plannedCheckpoints?.[0]?.id).toBe('checkpoint-new');
        expect(blocked.currentCheckpoint).toBeUndefined();
        expect(blocked.currentUserAction?.id).toBe('action-new');
        expect(blocked.primaryHardness).toBe('high_risk');
        expect(blocked.activeHardness).toBe('externally_blocked');
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

    test('prefers explicit activeHardness from sidecar events over local fallback derivation', () => {
        const planned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Task starts as multi-step.',
                deliverables: [],
                checkpoints: [],
                userActionsRequired: [],
                executionProfile: {
                    primaryHardness: 'multi_step',
                    requiredCapabilities: ['workspace_write'],
                    blockingRisk: 'none',
                    interactionMode: 'passive_status',
                    executionShape: 'staged',
                    reasons: ['Execution is expected to write files or mutate workspace state.'],
                },
                missingInfo: [],
            },
        }));

        const clarificationRequired = applyTaskEvent(planned, makeEvent({
            sequence: 2,
            type: 'TASK_CLARIFICATION_REQUIRED',
            payload: {
                reason: 'Need clarification before continuing.',
                questions: ['Which target file should be updated?'],
                activeHardness: 'bounded',
                blockingReason: 'Need clarification before continuing.',
            },
        }));

        const idleStatus = applyTaskEvent(clarificationRequired, makeEvent({
            sequence: 3,
            type: 'TASK_STATUS',
            payload: {
                status: 'idle',
                activeHardness: 'high_risk',
            },
        }));

        expect(clarificationRequired.activeHardness).toBe('bounded');
        expect(clarificationRequired.blockingReason).toBe('Need clarification before continuing.');
        expect(idleStatus.activeHardness).toBe('high_risk');
    });

    test('stores capability plan and keeps capability-gap running status as internal progress', () => {
        const planned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Acquire missing capability before publishing.',
                deliverables: [],
                checkpoints: [],
                userActionsRequired: [],
                executionProfile: {
                    primaryHardness: 'high_risk',
                    requiredCapabilities: ['browser_interaction', 'external_auth'],
                    blockingRisk: 'none',
                    interactionMode: 'passive_status',
                    executionShape: 'staged',
                    reasons: ['Execution must complete a real publish action on the target platform.'],
                },
                capabilityPlan: {
                    missingCapability: 'new_runtime_tool_needed',
                    learningRequired: true,
                    canProceedWithoutLearning: false,
                    learningScope: 'runtime_tool',
                    replayStrategy: 'resume_from_checkpoint',
                    sideEffectRisk: 'write_external',
                    userAssistRequired: false,
                    userAssistReason: 'none',
                    boundedLearningBudget: {
                        complexityTier: 'complex',
                        maxRounds: 4,
                        maxResearchTimeMs: 180000,
                        maxValidationAttempts: 3,
                    },
                    reasons: ['Coworkany does not have a dedicated validated publish capability for the target platform.'],
                },
                capabilityReview: {
                    status: 'pending',
                    summary: 'Generated capability requires review before execution can resume.',
                    learnedEntityId: 'skill-wechat-official-post',
                    updatedAt: '2026-03-28T09:30:00.000Z',
                },
                missingInfo: [],
            },
        }));

        const running = applyTaskEvent(planned, makeEvent({
            sequence: 2,
            type: 'TASK_STATUS',
            payload: {
                status: 'running',
                activeHardness: 'multi_step',
                blockingReason: 'Acquiring the missing capability before continuing execution.',
            },
        }));

        expect(planned.capabilityPlan?.learningRequired).toBe(true);
        expect(planned.capabilityReview).toEqual({
            status: 'pending',
            summary: 'Generated capability requires review before execution can resume.',
            learnedEntityId: 'skill-wechat-official-post',
            updatedAt: '2026-03-28T09:30:00.000Z',
        });
        expect(running.status).toBe('running');
        expect(running.activeHardness).toBe('multi_step');
        expect(running.blockingReason).toBe('Acquiring the missing capability before continuing execution.');
        expect(running.currentUserAction).toBeUndefined();
        expect(running.clarificationQuestions).toBeUndefined();
    });

    test('clears pending capability review once capability review approval resumes the task', () => {
        const planned = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Review generated capability before resuming execution.',
                deliverables: [],
                checkpoints: [],
                userActionsRequired: [],
                capabilityReview: {
                    status: 'pending',
                    summary: 'Generated capability requires review before execution can resume.',
                },
                missingInfo: [],
            },
        }));

        const resumed = applyTaskEvent(planned, makeEvent({
            sequence: 2,
            type: 'TASK_RESUMED',
            payload: {
                resumeReason: 'capability_review_approved',
                suspendDurationMs: 1000,
            },
        }));

        expect(planned.capabilityReview?.status).toBe('pending');
        expect(resumed.capabilityReview).toBeUndefined();
        expect(resumed.lastResumeReason).toBe('capability_review_approved');
    });

    test('preserves explicit runtime hardness and blocking reason across blocker, idle, resume, and running replay', () => {
        const started = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_STARTED',
            payload: {
                title: 'Publish weekly update',
                context: {
                    userQuery: 'Publish the weekly update to X',
                    workspacePath: '/tmp/ws',
                },
            },
        }));

        const planned = applyTaskEvent(started, makeEvent({
            sequence: 2,
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Publish the prepared update after validation.',
                deliverables: [],
                checkpoints: [],
                userActionsRequired: [],
                executionProfile: {
                    primaryHardness: 'multi_step',
                    requiredCapabilities: ['browser_interaction', 'external_auth'],
                    blockingRisk: 'auth',
                    interactionMode: 'action_first',
                    executionShape: 'staged',
                    reasons: ['Execution may require a real account/login state.'],
                },
                missingInfo: [],
            },
        }));

        const blocked = applyTaskEvent(planned, makeEvent({
            sequence: 3,
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                actionId: 'auth-login',
                title: 'Login to X',
                kind: 'external_auth',
                description: 'Please log in to continue publishing.',
                blocking: true,
                questions: [],
                instructions: ['Open the login page and confirm once signed in.'],
                activeHardness: 'externally_blocked',
                blockingReason: 'Please log in to continue publishing.',
            },
        }));

        const idle = applyTaskEvent(blocked, makeEvent({
            sequence: 4,
            type: 'TASK_STATUS',
            payload: {
                status: 'idle',
                activeHardness: 'externally_blocked',
                blockingReason: 'Please log in to continue publishing.',
            },
        }));

        const resumed = applyTaskEvent(idle, makeEvent({
            sequence: 5,
            type: 'TASK_RESUMED',
            payload: {},
        }));

        const running = applyTaskEvent(resumed, makeEvent({
            sequence: 6,
            type: 'TASK_STATUS',
            payload: {
                status: 'running',
                activeHardness: 'multi_step',
            },
        }));

        expect(blocked.status).toBe('idle');
        expect(blocked.activeHardness).toBe('externally_blocked');
        expect(blocked.blockingReason).toBe('Please log in to continue publishing.');
        expect(idle.status).toBe('idle');
        expect(idle.activeHardness).toBe('externally_blocked');
        expect(idle.blockingReason).toBe('Please log in to continue publishing.');
        expect(resumed.status).toBe('running');
        expect(resumed.activeHardness).toBe('multi_step');
        expect(resumed.blockingReason).toBeUndefined();
        expect(running.status).toBe('running');
        expect(running.activeHardness).toBe('multi_step');
        expect(running.blockingReason).toBeUndefined();
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

    test('stores capability-review resume reason when task resumes', () => {
        const resumed = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_RESUMED',
            payload: {
                resumeReason: 'capability_review_approved',
                suspendDurationMs: 0,
            },
        }));

        expect(resumed.status).toBe('running');
        expect(resumed.lastResumeReason).toBe('capability_review_approved');
        expect(resumed.blockingReason).toBeUndefined();
    });

    test('TASK_HISTORY_CLEARED resets session history state and visible timeline events', () => {
        const session: TaskSession = {
            ...makeSession(),
            status: 'running',
            summary: 'Existing summary',
            failure: {
                error: 'old failure',
                recoverable: true,
            },
            clarificationQuestions: ['old question'],
            planSummary: 'old plan',
            planSteps: [
                {
                    id: 'step-1',
                    description: 'old step',
                    status: 'in_progress',
                },
            ],
            toolCalls: [
                {
                    id: 'tool-1',
                    name: 'search_web',
                    args: {},
                    status: 'running',
                },
            ],
            effects: [
                {
                    id: 'effect-1',
                    effectType: 'shell_command',
                    riskLevel: 2,
                    status: 'pending',
                    timestamp: new Date().toISOString(),
                },
            ],
            patches: [
                {
                    id: 'patch-1',
                    filePath: '/tmp/a.ts',
                    diff: '+a',
                    status: 'proposed',
                    timestamp: new Date().toISOString(),
                },
            ],
            messages: [
                {
                    id: 'msg-1',
                    role: 'assistant',
                    content: 'old message',
                    timestamp: new Date().toISOString(),
                },
            ],
            events: [
                makeEvent({
                    id: 'old-event',
                    sequence: 1,
                    type: 'TASK_FAILED',
                    payload: {
                        error: 'old failure',
                        recoverable: true,
                    },
                }),
            ],
            tokenUsage: {
                inputTokens: 120,
                outputTokens: 80,
                estimatedCost: 0.1,
            },
        };

        const clearEvent = makeEvent({
            id: 'clear-event',
            sequence: 2,
            type: 'TASK_HISTORY_CLEARED',
            payload: {
                reason: 'user_requested',
            },
        });

        const cleared = applyTaskEvent(session, clearEvent);

        expect(cleared.status).toBe('idle');
        expect(cleared.summary).toBeUndefined();
        expect(cleared.failure).toBeUndefined();
        expect(cleared.planSummary).toBeUndefined();
        expect(cleared.planSteps).toEqual([]);
        expect(cleared.toolCalls).toEqual([]);
        expect(cleared.effects).toEqual([]);
        expect(cleared.patches).toEqual([]);
        expect(cleared.messages).toEqual([]);
        expect(cleared.events).toEqual([clearEvent]);
        expect(cleared.tokenUsage).toBeUndefined();
    });
});
