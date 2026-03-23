/**
 * Task Reducer
 *
 * Handles TASK_* events
 */

import type { TaskSession, TaskEvent, PlanStep, TaskStatus } from '../../../types';

function isRiskTier(value: unknown): value is 'low' | 'medium' | 'high' {
    return value === 'low' || value === 'medium' || value === 'high';
}

function isExecutionPolicy(value: unknown): value is 'auto' | 'review_required' | 'hard_block' {
    return value === 'auto' || value === 'review_required' || value === 'hard_block';
}

function inferCheckpointExecutionPolicy(input: {
    kind: NonNullable<TaskSession['currentCheckpoint']>['kind'];
    executionPolicy: unknown;
    blocking: boolean;
}): 'auto' | 'review_required' | 'hard_block' {
    if (isExecutionPolicy(input.executionPolicy)) {
        return input.executionPolicy;
    }
    if (!input.blocking) {
        return 'auto';
    }
    return input.kind === 'review' ? 'review_required' : 'hard_block';
}

function inferUserActionExecutionPolicy(input: {
    kind: NonNullable<TaskSession['currentUserAction']>['kind'];
    executionPolicy: unknown;
    blocking: boolean;
}): 'auto' | 'review_required' | 'hard_block' {
    if (isExecutionPolicy(input.executionPolicy)) {
        return input.executionPolicy;
    }
    if (!input.blocking) {
        return 'auto';
    }
    return input.kind === 'confirm_plan' ? 'review_required' : 'hard_block';
}

function inferRiskTier(
    riskTier: unknown,
    executionPolicy: 'auto' | 'review_required' | 'hard_block'
): 'low' | 'medium' | 'high' {
    if (isRiskTier(riskTier)) {
        return riskTier;
    }
    if (executionPolicy === 'hard_block') {
        return 'high';
    }
    if (executionPolicy === 'review_required') {
        return 'medium';
    }
    return 'low';
}

function toPlannedCheckpoint(raw: unknown): NonNullable<TaskSession['plannedCheckpoints']>[number] | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const payload = raw as Record<string, unknown>;
    const kind = (payload.kind as NonNullable<TaskSession['currentCheckpoint']>['kind']) ?? 'review';
    const blocking = Boolean(payload.blocking);
    const executionPolicy = inferCheckpointExecutionPolicy({
        kind,
        executionPolicy: payload.executionPolicy,
        blocking,
    });

    return {
        id: String(payload.id ?? ''),
        title: String(payload.title ?? ''),
        kind,
        reason: String(payload.reason ?? ''),
        userMessage: String(payload.userMessage ?? ''),
        riskTier: inferRiskTier(payload.riskTier, executionPolicy),
        executionPolicy,
        requiresUserConfirmation: Boolean(payload.requiresUserConfirmation),
        blocking,
    };
}

function toPlannedUserAction(raw: unknown): NonNullable<TaskSession['plannedUserActions']>[number] | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const payload = raw as Record<string, unknown>;
    const kind = (payload.kind as NonNullable<TaskSession['currentUserAction']>['kind']) ?? 'manual_step';
    const blocking = Boolean(payload.blocking);
    const executionPolicy = inferUserActionExecutionPolicy({
        kind,
        executionPolicy: payload.executionPolicy,
        blocking,
    });

    return {
        id: String(payload.id ?? ''),
        title: String(payload.title ?? ''),
        kind,
        description: String(payload.description ?? ''),
        riskTier: inferRiskTier(payload.riskTier, executionPolicy),
        executionPolicy,
        blocking,
        questions: ((payload.questions as string[] | undefined) ?? []).filter(Boolean),
        instructions: ((payload.instructions as string[] | undefined) ?? []).filter(Boolean),
        fulfillsCheckpointId:
            typeof payload.fulfillsCheckpointId === 'string' ? payload.fulfillsCheckpointId : undefined,
    };
}

function parseStringArray(value: unknown): string[] {
    return (Array.isArray(value) ? value : [])
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function parseContractReopenDiff(value: unknown): TaskSession['contractReopenDiff'] | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const payload = value as Record<string, unknown>;
    const changedFields = ((payload.changedFields as unknown[] | undefined) ?? [])
        .filter((field): field is NonNullable<TaskSession['contractReopenDiff']>['changedFields'][number] =>
            field === 'mode' ||
            field === 'objective' ||
            field === 'deliverables' ||
            field === 'execution_targets' ||
            field === 'workflow'
        );

    if (changedFields.length === 0) {
        return undefined;
    }

    const modeChanged = payload.modeChanged && typeof payload.modeChanged === 'object'
        ? {
            before: String((payload.modeChanged as Record<string, unknown>).before ?? ''),
            after: String((payload.modeChanged as Record<string, unknown>).after ?? ''),
        }
        : undefined;

    const objectiveChanged = payload.objectiveChanged && typeof payload.objectiveChanged === 'object'
        ? {
            before: String((payload.objectiveChanged as Record<string, unknown>).before ?? ''),
            after: String((payload.objectiveChanged as Record<string, unknown>).after ?? ''),
        }
        : undefined;

    const deliverablesChanged = payload.deliverablesChanged && typeof payload.deliverablesChanged === 'object'
        ? {
            before: parseStringArray((payload.deliverablesChanged as Record<string, unknown>).before),
            after: parseStringArray((payload.deliverablesChanged as Record<string, unknown>).after),
        }
        : undefined;

    const targetsChanged = payload.targetsChanged && typeof payload.targetsChanged === 'object'
        ? {
            before: parseStringArray((payload.targetsChanged as Record<string, unknown>).before),
            after: parseStringArray((payload.targetsChanged as Record<string, unknown>).after),
        }
        : undefined;

    const workflowsChanged = payload.workflowsChanged && typeof payload.workflowsChanged === 'object'
        ? {
            before: parseStringArray((payload.workflowsChanged as Record<string, unknown>).before),
            after: parseStringArray((payload.workflowsChanged as Record<string, unknown>).after),
        }
        : undefined;

    return {
        changedFields,
        modeChanged,
        objectiveChanged,
        deliverablesChanged,
        targetsChanged,
        workflowsChanged,
    };
}

function appendSystemMessage(session: TaskSession, event: TaskEvent, content: string): TaskSession {
    return {
        ...session,
        messages: [
            ...session.messages,
            {
                id: event.id,
                role: 'system',
                content,
                timestamp: event.timestamp,
            },
        ],
    };
}

function shouldAppendFinishedAssistantMessage(session: TaskSession, summary: string | undefined): boolean {
    const normalizedSummary = summary?.trim();
    if (!normalizedSummary) {
        return false;
    }

    const latestAssistantMessage = [...session.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.content.trim().length > 0);

    if (!latestAssistantMessage) {
        return true;
    }

    if (latestAssistantMessage.content.trim() === normalizedSummary) {
        return false;
    }

    const latestUserMessage = [...session.messages]
        .reverse()
        .find((message) => message.role === 'user' && message.content.trim().length > 0);

    if (!latestUserMessage) {
        return false;
    }

    return latestAssistantMessage.timestamp < latestUserMessage.timestamp;
}

export function applyTaskEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TASK_STARTED':
            return {
                ...session,
                status: 'running',
                title: payload.title as string,
                failure: undefined,
                clarificationQuestions: undefined,
                researchSummary: undefined,
                researchSourcesChecked: undefined,
                researchBlockingUnknowns: undefined,
                selectedStrategyTitle: undefined,
                contractReopenReason: undefined,
                contractReopenCount: 0,
                workspacePath: (payload.context as Record<string, unknown>)?.workspacePath as string,
                messages: [
                    ...session.messages,
                    {
                        id: event.id,
                        role: 'user',
                        content:
                            ((payload.context as Record<string, unknown>)?.userQuery as string) ??
                            (payload.description as string) ??
                            '',
                        timestamp: event.timestamp,
                    },
                ],
            };

        case 'PLAN_UPDATED':
            return {
                ...session,
                planSummary: payload.summary as string,
                planSteps: (payload.steps as PlanStep[]) || [],
            };

        case 'TASK_RESEARCH_UPDATED':
            return {
                ...session,
                researchSummary: (payload.summary as string | undefined) ?? session.researchSummary,
                researchSourcesChecked: ((payload.sourcesChecked as string[] | undefined) ?? []).filter(Boolean),
                researchBlockingUnknowns: ((payload.blockingUnknowns as string[] | undefined) ?? []).filter(Boolean),
                selectedStrategyTitle:
                    typeof payload.selectedStrategyTitle === 'string'
                        ? payload.selectedStrategyTitle
                        : session.selectedStrategyTitle,
            };

        case 'TASK_CONTRACT_REOPENED':
            return appendSystemMessage({
                ...session,
                status: 'running',
                summary: (payload.summary as string | undefined) ?? session.summary,
                contractReopenReason: String(payload.reason ?? ''),
                contractReopenReasons: parseStringArray(payload.reasons),
                contractReopenDiff: parseContractReopenDiff(payload.diff),
                contractReopenCount: (session.contractReopenCount ?? 0) + 1,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                clarificationQuestions: undefined,
            }, event, [
                'Execution contract reopened.',
                String(payload.reason ?? ''),
            ].filter(Boolean).join('\n'));

        case 'TASK_PLAN_READY':
            return {
                ...session,
                planSummary: (payload.summary as string | undefined) ?? session.planSummary,
                plannedDeliverables: ((payload.deliverables as TaskSession['plannedDeliverables']) ?? []).slice(),
                plannedCheckpoints: ((payload.checkpoints as unknown[] | undefined) ?? [])
                    .map((checkpoint) => toPlannedCheckpoint(checkpoint))
                    .filter((checkpoint): checkpoint is NonNullable<typeof checkpoint> => checkpoint !== null),
                plannedUserActions: ((payload.userActionsRequired as unknown[] | undefined) ?? [])
                    .map((action) => toPlannedUserAction(action))
                    .filter((action): action is NonNullable<typeof action> => action !== null),
                missingInfo: ((payload.missingInfo as TaskSession['missingInfo']) ?? []).slice(),
                defaultingPolicy: payload.defaultingPolicy as TaskSession['defaultingPolicy'],
                resumeStrategy: payload.resumeStrategy as TaskSession['resumeStrategy'],
            };

        case 'TASK_CHECKPOINT_REACHED': {
            const currentCheckpoint: NonNullable<TaskSession['currentCheckpoint']> = {
                id: String(payload.checkpointId ?? ''),
                title: String(payload.title ?? ''),
                kind: (payload.kind as NonNullable<TaskSession['currentCheckpoint']>['kind']) ?? 'review',
                reason: String(payload.reason ?? ''),
                userMessage: String(payload.userMessage ?? ''),
                riskTier: inferRiskTier(
                    payload.riskTier,
                    inferCheckpointExecutionPolicy({
                        kind: (payload.kind as NonNullable<TaskSession['currentCheckpoint']>['kind']) ?? 'review',
                        executionPolicy: payload.executionPolicy,
                        blocking: Boolean(payload.blocking),
                    })
                ),
                executionPolicy: inferCheckpointExecutionPolicy({
                    kind: (payload.kind as NonNullable<TaskSession['currentCheckpoint']>['kind']) ?? 'review',
                    executionPolicy: payload.executionPolicy,
                    blocking: Boolean(payload.blocking),
                }),
                requiresUserConfirmation: Boolean(payload.requiresUserConfirmation),
                blocking: Boolean(payload.blocking),
            };
            return appendSystemMessage({
                ...session,
                currentCheckpoint,
            }, event, currentCheckpoint.userMessage || currentCheckpoint.reason || 'Checkpoint reached');
        }

        case 'TASK_USER_ACTION_REQUIRED': {
            const currentUserAction: NonNullable<TaskSession['currentUserAction']> = {
                id: String(payload.actionId ?? ''),
                title: String(payload.title ?? ''),
                kind: (payload.kind as NonNullable<TaskSession['currentUserAction']>['kind']) ?? 'manual_step',
                description: String(payload.description ?? ''),
                riskTier: inferRiskTier(
                    payload.riskTier,
                    inferUserActionExecutionPolicy({
                        kind: (payload.kind as NonNullable<TaskSession['currentUserAction']>['kind']) ?? 'manual_step',
                        executionPolicy: payload.executionPolicy,
                        blocking: Boolean(payload.blocking),
                    })
                ),
                executionPolicy: inferUserActionExecutionPolicy({
                    kind: (payload.kind as NonNullable<TaskSession['currentUserAction']>['kind']) ?? 'manual_step',
                    executionPolicy: payload.executionPolicy,
                    blocking: Boolean(payload.blocking),
                }),
                blocking: Boolean(payload.blocking),
                questions: ((payload.questions as string[] | undefined) ?? []).filter(Boolean),
                instructions: ((payload.instructions as string[] | undefined) ?? []).filter(Boolean),
                fulfillsCheckpointId:
                    typeof payload.fulfillsCheckpointId === 'string' ? payload.fulfillsCheckpointId : undefined,
            };
            return appendSystemMessage({
                ...session,
                status: currentUserAction.blocking ? 'idle' : session.status,
                currentUserAction,
            }, event, [
                currentUserAction.description,
                ...currentUserAction.questions,
                ...currentUserAction.instructions,
            ].filter(Boolean).join('\n'));
        }

        case 'TASK_FINISHED':
        {
            const nextSession: TaskSession = {
                ...session,
                status: 'finished',
                summary: payload.summary as string,
                failure: undefined,
                suspension: undefined,
                clarificationQuestions: undefined,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                assistantDraft: undefined,
            };
            if (!shouldAppendFinishedAssistantMessage(nextSession, payload.summary as string | undefined)) {
                return nextSession;
            }
            return {
                ...nextSession,
                messages: [
                    ...nextSession.messages,
                    {
                        id: `${event.id}-assistant`,
                        role: 'assistant',
                        content: String(payload.summary ?? ''),
                        timestamp: event.timestamp,
                    },
                ],
            };
        }

        case 'TASK_FAILED':
            return appendSystemMessage({
                ...session,
                status: 'failed',
                summary: payload.error as string,
                failure: {
                    error: (payload.error as string) ?? 'Unknown error',
                    errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : undefined,
                    recoverable: payload.recoverable === true,
                    suggestion: typeof payload.suggestion === 'string' ? payload.suggestion.trim() : undefined,
                },
                suspension: undefined,
                clarificationQuestions: undefined,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                assistantDraft: undefined,
            }, event, [
                `Task failed: ${(payload.error as string) ?? 'Unknown error'}`,
                typeof payload.suggestion === 'string' && payload.suggestion.trim().length > 0
                    ? payload.suggestion.trim()
                    : null,
            ].filter(Boolean).join('\n'));

        case 'TASK_STATUS': {
            const status = payload.status as TaskStatus;
            return {
                ...session,
                status: status ?? session.status,
                failure: status === 'running' ? undefined : session.failure,
                currentCheckpoint: status === 'running' ? undefined : session.currentCheckpoint,
                currentUserAction: status === 'running' ? undefined : session.currentUserAction,
                assistantDraft: status === 'running' ? session.assistantDraft : undefined,
            };
        }

        case 'TASK_CLARIFICATION_REQUIRED':
            return {
                ...session,
                status: 'idle',
                summary: (payload.reason as string | undefined) ?? session.summary,
                failure: undefined,
                suspension: undefined,
                clarificationQuestions: ((payload.questions as string[] | undefined) ?? []).filter(Boolean),
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                assistantDraft: undefined,
            };

        case 'TASK_SUSPENDED':
        {
            const nextSuspension = {
                reason: String(payload.reason ?? ''),
                userMessage: String(payload.userMessage ?? ''),
                canAutoResume: Boolean(payload.canAutoResume),
                maxWaitTimeMs:
                    typeof payload.maxWaitTimeMs === 'number'
                        ? payload.maxWaitTimeMs
                        : undefined,
            };
            const isDuplicateSuspension =
                session.suspension?.reason === nextSuspension.reason &&
                session.suspension?.userMessage === nextSuspension.userMessage &&
                session.suspension?.canAutoResume === nextSuspension.canAutoResume &&
                session.suspension?.maxWaitTimeMs === nextSuspension.maxWaitTimeMs;

            const nextSession: TaskSession = {
                ...session,
                status: 'idle',
                failure: undefined,
                suspension: nextSuspension,
                assistantDraft: undefined,
            };

            if (isDuplicateSuspension) {
                return nextSession;
            }

            return appendSystemMessage(
                nextSession,
                event,
                nextSuspension.userMessage || 'Task suspended'
            );
        }

        case 'TASK_RESUMED':
            return appendSystemMessage({
                ...session,
                status: 'running',
                failure: undefined,
                suspension: undefined,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
            }, event, 'Task resumed');

        case 'TASK_HISTORY_CLEARED': {
            return {
                ...session,
                status: 'idle',
                summary: undefined,
                failure: undefined,
                suspension: undefined,
                clarificationQuestions: undefined,
                planSummary: undefined,
                researchSummary: undefined,
                researchSourcesChecked: undefined,
                researchBlockingUnknowns: undefined,
                selectedStrategyTitle: undefined,
                contractReopenReason: undefined,
                contractReopenReasons: undefined,
                contractReopenDiff: undefined,
                contractReopenCount: undefined,
                plannedDeliverables: undefined,
                plannedCheckpoints: undefined,
                plannedUserActions: undefined,
                missingInfo: undefined,
                defaultingPolicy: undefined,
                resumeStrategy: undefined,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                planSteps: [],
                toolCalls: [],
                effects: [],
                patches: [],
                messages: [],
                events: [event],
                assistantDraft: undefined,
                tokenUsage: undefined,
            };
        }

        case 'AGENT_IDENTITY_ESTABLISHED': {
            const identity = payload.identity as Record<string, unknown> | undefined;
            const sessionId = identity?.sessionId as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `Agent identity established${sessionId ? ` (${sessionId})` : ''}`
            );
        }

        case 'MCP_GATEWAY_DECISION': {
            const toolName = payload.toolName as string | undefined;
            const action = payload.decision as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `MCP decision${toolName ? ` for ${toolName}` : ''}: ${action ?? 'unknown'}`
            );
        }

        case 'RUNTIME_SECURITY_ALERT': {
            const threat = payload.threatType as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `Security alert${threat ? `: ${threat}` : ''}`
            );
        }

        default:
            return session;
    }
}
