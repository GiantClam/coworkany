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

function isTaskHardness(value: unknown): value is NonNullable<TaskSession['primaryHardness']> {
    return value === 'trivial'
        || value === 'bounded'
        || value === 'multi_step'
        || value === 'externally_blocked'
        || value === 'high_risk';
}

function isBlockingRisk(value: unknown): value is NonNullable<TaskSession['executionProfile']>['blockingRisk'] {
    return value === 'none'
        || value === 'missing_info'
        || value === 'auth'
        || value === 'permission'
        || value === 'manual_step'
        || value === 'policy_review';
}

function isInteractionMode(value: unknown): value is NonNullable<TaskSession['executionProfile']>['interactionMode'] {
    return value === 'passive_status'
        || value === 'input_first'
        || value === 'action_first'
        || value === 'review_first';
}

function isExecutionShape(value: unknown): value is NonNullable<TaskSession['executionProfile']>['executionShape'] {
    return value === 'single_step'
        || value === 'staged'
        || value === 'exploratory'
        || value === 'deterministic_workflow';
}

function isCapabilityMissingKind(value: unknown): value is NonNullable<TaskSession['capabilityPlan']>['missingCapability'] {
    return value === 'none'
        || value === 'existing_skill_gap'
        || value === 'existing_tool_gap'
        || value === 'new_runtime_tool_needed'
        || value === 'workflow_gap'
        || value === 'external_blocker';
}

function isLearningScope(value: unknown): value is NonNullable<TaskSession['capabilityPlan']>['learningScope'] {
    return value === 'none'
        || value === 'knowledge'
        || value === 'skill'
        || value === 'runtime_tool';
}

function isReplayStrategy(value: unknown): value is NonNullable<TaskSession['capabilityPlan']>['replayStrategy'] {
    return value === 'none'
        || value === 'resume_from_checkpoint'
        || value === 'restart_execution';
}

function isSideEffectRisk(value: unknown): value is NonNullable<TaskSession['capabilityPlan']>['sideEffectRisk'] {
    return value === 'none' || value === 'read_only' || value === 'write_external';
}

function isUserAssistReason(value: unknown): value is NonNullable<TaskSession['capabilityPlan']>['userAssistReason'] {
    return value === 'none'
        || value === 'auth'
        || value === 'captcha'
        || value === 'permission'
        || value === 'policy'
        || value === 'ambiguous_goal';
}

function isComplexityTier(
    value: unknown
): value is NonNullable<TaskSession['capabilityPlan']>['boundedLearningBudget']['complexityTier'] {
    return value === 'simple' || value === 'moderate' || value === 'complex';
}

function isRequiredCapability(
    value: unknown
): value is NonNullable<TaskSession['executionProfile']>['requiredCapabilities'][number] {
    return value === 'browser_interaction'
        || value === 'external_auth'
        || value === 'workspace_write'
        || value === 'host_access'
        || value === 'human_review';
}

function parseExecutionProfile(value: unknown): TaskSession['executionProfile'] | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const payload = value as Record<string, unknown>;
    if (!isTaskHardness(payload.primaryHardness)) {
        return undefined;
    }
    if (!isBlockingRisk(payload.blockingRisk) || !isInteractionMode(payload.interactionMode) || !isExecutionShape(payload.executionShape)) {
        return undefined;
    }

    return {
        primaryHardness: payload.primaryHardness,
        requiredCapabilities: ((payload.requiredCapabilities as unknown[] | undefined) ?? []).filter(isRequiredCapability),
        blockingRisk: payload.blockingRisk,
        interactionMode: payload.interactionMode,
        executionShape: payload.executionShape,
        reasons: parseStringArray(payload.reasons),
    };
}

function parseCapabilityPlan(value: unknown): TaskSession['capabilityPlan'] | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const payload = value as Record<string, unknown>;
    const budget = payload.boundedLearningBudget;
    if (
        !isCapabilityMissingKind(payload.missingCapability)
        || typeof payload.learningRequired !== 'boolean'
        || typeof payload.canProceedWithoutLearning !== 'boolean'
        || !isLearningScope(payload.learningScope)
        || !isReplayStrategy(payload.replayStrategy)
        || !isSideEffectRisk(payload.sideEffectRisk)
        || typeof payload.userAssistRequired !== 'boolean'
        || !isUserAssistReason(payload.userAssistReason)
        || !budget
        || typeof budget !== 'object'
    ) {
        return undefined;
    }

    const normalizedBudget = budget as Record<string, unknown>;
    if (
        !isComplexityTier(normalizedBudget.complexityTier)
        || typeof normalizedBudget.maxRounds !== 'number'
        || typeof normalizedBudget.maxResearchTimeMs !== 'number'
        || typeof normalizedBudget.maxValidationAttempts !== 'number'
    ) {
        return undefined;
    }

    return {
        missingCapability: payload.missingCapability,
        learningRequired: payload.learningRequired,
        canProceedWithoutLearning: payload.canProceedWithoutLearning,
        learningScope: payload.learningScope,
        replayStrategy: payload.replayStrategy,
        sideEffectRisk: payload.sideEffectRisk,
        userAssistRequired: payload.userAssistRequired,
        userAssistReason: payload.userAssistReason,
        boundedLearningBudget: {
            complexityTier: normalizedBudget.complexityTier,
            maxRounds: normalizedBudget.maxRounds,
            maxResearchTimeMs: normalizedBudget.maxResearchTimeMs,
            maxValidationAttempts: normalizedBudget.maxValidationAttempts,
        },
        reasons: parseStringArray(payload.reasons),
    };
}

function parseCapabilityReview(value: unknown): TaskSession['capabilityReview'] | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const payload = value as Record<string, unknown>;
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if ((payload.status !== 'pending' && payload.status !== 'approved') || summary.length === 0) {
        return undefined;
    }

    return {
        status: payload.status,
        summary,
        learnedEntityId: typeof payload.learnedEntityId === 'string' ? payload.learnedEntityId : undefined,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
    };
}

function parseEventActiveHardness(payload: Record<string, unknown>): TaskSession['activeHardness'] {
    return isTaskHardness(payload.activeHardness) ? payload.activeHardness : undefined;
}

function parseEventBlockingReason(payload: Record<string, unknown>): string | undefined {
    if (typeof payload.blockingReason !== 'string') {
        return undefined;
    }
    const normalized = payload.blockingReason.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function hasBlockingReasonField(payload: Record<string, unknown>): boolean {
    return Object.prototype.hasOwnProperty.call(payload, 'blockingReason');
}

function deriveFallbackActiveHardness(input: {
    session: TaskSession;
    currentCheckpoint?: TaskSession['currentCheckpoint'];
    currentUserAction?: TaskSession['currentUserAction'];
    status?: TaskStatus;
}): TaskSession['activeHardness'] {
    const profile = input.session.executionProfile;
    if (!profile) {
        return undefined;
    }

    if (
        input.currentUserAction?.kind === 'external_auth'
        || (input.currentUserAction?.kind === 'manual_step' && input.currentUserAction.blocking)
        || (input.currentCheckpoint?.kind === 'manual_action' && input.currentCheckpoint.blocking)
    ) {
        return 'externally_blocked';
    }

    if (
        input.currentUserAction?.kind === 'confirm_plan'
        || (input.currentCheckpoint?.kind === 'review' && input.currentCheckpoint.requiresUserConfirmation)
        || (input.status !== 'running' && profile.interactionMode === 'review_first')
    ) {
        return 'high_risk';
    }

    if (
        input.session.capabilityPlan?.learningRequired
        && input.status === 'running'
        && input.session.blockingReason
    ) {
        return 'multi_step';
    }

    return profile.primaryHardness;
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
                taskMode: undefined,
                title: payload.title as string,
                failure: undefined,
                clarificationQuestions: undefined,
                researchSummary: undefined,
                researchSourcesChecked: undefined,
                researchBlockingUnknowns: undefined,
                selectedStrategyTitle: undefined,
                contractReopenReason: undefined,
                contractReopenCount: 0,
                plannedTasks: undefined,
                blockingReason: undefined,
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
        {
            const taskProgress = ((payload.taskProgress as Array<Record<string, unknown>> | undefined) ?? [])
                .map((entry) => ({
                    taskId: String(entry.taskId ?? ''),
                    title: String(entry.title ?? ''),
                    status: String(entry.status ?? 'pending') as PlanStep['status'],
                    dependencies: parseStringArray(entry.dependencies),
                }))
                .filter((entry) => entry.taskId.length > 0);
            const mergedPlannedTasks = taskProgress.length > 0
                ? taskProgress.map((entry) => {
                    const existing = (session.plannedTasks ?? []).find((task) => task.id === entry.taskId);
                    return {
                        id: entry.taskId,
                        title: entry.title || existing?.title || '',
                        objective: existing?.objective ?? '',
                        dependencies: entry.dependencies.length > 0 ? entry.dependencies : (existing?.dependencies ?? []),
                        status: entry.status,
                    };
                })
                : session.plannedTasks;
            return {
                ...session,
                planSummary: payload.summary as string,
                planSteps: (payload.steps as PlanStep[]) || [],
                plannedTasks: mergedPlannedTasks,
            };
        }

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
                blockingReason: undefined,
            }, event, [
                'Execution contract reopened.',
                String(payload.reason ?? ''),
            ].filter(Boolean).join('\n'));

        case 'TASK_PLAN_READY': {
            const executionProfile = parseExecutionProfile(payload.executionProfile);
            const capabilityPlan = parseCapabilityPlan(payload.capabilityPlan);
            const capabilityReview = parseCapabilityReview(payload.capabilityReview);
            const nextSession: TaskSession = {
                ...session,
                taskMode:
                    payload.mode === 'chat' ||
                    payload.mode === 'immediate_task' ||
                    payload.mode === 'scheduled_task' ||
                    payload.mode === 'scheduled_multi_task'
                        ? payload.mode
                        : session.taskMode,
                planSummary: (payload.summary as string | undefined) ?? session.planSummary,
                plannedTasks: ((payload.tasks as Array<Record<string, unknown>> | undefined) ?? [])
                    .map((task) => ({
                        id: String(task.id ?? ''),
                        title: String(task.title ?? ''),
                        objective: String(task.objective ?? ''),
                        dependencies: parseStringArray(task.dependencies),
                        status: 'pending' as PlanStep['status'],
                    }))
                    .filter((task) => task.id.length > 0),
                plannedDeliverables: ((payload.deliverables as TaskSession['plannedDeliverables']) ?? []).slice(),
                plannedCheckpoints: ((payload.checkpoints as unknown[] | undefined) ?? [])
                    .map((checkpoint) => toPlannedCheckpoint(checkpoint))
                    .filter((checkpoint): checkpoint is NonNullable<typeof checkpoint> => checkpoint !== null),
                plannedUserActions: ((payload.userActionsRequired as unknown[] | undefined) ?? [])
                    .map((action) => toPlannedUserAction(action))
                    .filter((action): action is NonNullable<typeof action> => action !== null),
                executionProfile,
                capabilityPlan,
                capabilityReview,
                primaryHardness: executionProfile?.primaryHardness,
                blockingReason: undefined,
                missingInfo: ((payload.missingInfo as TaskSession['missingInfo']) ?? []).slice(),
                defaultingPolicy: payload.defaultingPolicy as TaskSession['defaultingPolicy'],
                resumeStrategy: payload.resumeStrategy as TaskSession['resumeStrategy'],
            };
            return {
                ...nextSession,
                activeHardness: deriveFallbackActiveHardness({
                    session: nextSession,
                    status: nextSession.status,
                }),
            };
        }

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
            const nextSession: TaskSession = {
                ...session,
                currentCheckpoint,
                blockingReason:
                    parseEventBlockingReason(payload)
                    ?? currentCheckpoint.userMessage
                    ?? currentCheckpoint.reason,
            };
            return appendSystemMessage({
                ...nextSession,
                activeHardness: parseEventActiveHardness(payload) ?? deriveFallbackActiveHardness({
                    session: nextSession,
                    currentCheckpoint,
                    currentUserAction: nextSession.currentUserAction,
                    status: nextSession.status,
                }),
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
            const nextSession: TaskSession = {
                ...session,
                status: currentUserAction.blocking ? 'idle' : session.status,
                currentUserAction,
                blockingReason:
                    parseEventBlockingReason(payload)
                    ?? currentUserAction.description
                    ?? currentUserAction.questions[0]
                    ?? currentUserAction.instructions[0],
            };
            return appendSystemMessage({
                ...nextSession,
                activeHardness: parseEventActiveHardness(payload) ?? deriveFallbackActiveHardness({
                    session: nextSession,
                    currentCheckpoint: nextSession.currentCheckpoint,
                    currentUserAction,
                    status: nextSession.status,
                }),
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
                activeHardness: session.executionProfile?.primaryHardness,
                blockingReason: undefined,
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
                activeHardness: session.executionProfile?.primaryHardness,
                blockingReason: undefined,
                assistantDraft: undefined,
            }, event, [
                `Task failed: ${(payload.error as string) ?? 'Unknown error'}`,
                typeof payload.suggestion === 'string' && payload.suggestion.trim().length > 0
                    ? payload.suggestion.trim()
                    : null,
            ].filter(Boolean).join('\n'));

        case 'TASK_STATUS': {
            const status = payload.status as TaskStatus;
            const nextSession: TaskSession = {
                ...session,
                status: status ?? session.status,
                failure: status === 'running' ? undefined : session.failure,
                currentCheckpoint: status === 'running' ? undefined : session.currentCheckpoint,
                currentUserAction: status === 'running' ? undefined : session.currentUserAction,
                blockingReason:
                    status === 'finished' || status === 'failed'
                        ? undefined
                        : hasBlockingReasonField(payload)
                            ? parseEventBlockingReason(payload)
                            : session.blockingReason,
                assistantDraft: status === 'running' ? session.assistantDraft : undefined,
            };
            return {
                ...nextSession,
                activeHardness: parseEventActiveHardness(payload) ?? deriveFallbackActiveHardness({
                    session: nextSession,
                    currentCheckpoint: nextSession.currentCheckpoint,
                    currentUserAction: nextSession.currentUserAction,
                    status: nextSession.status,
                }),
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
                activeHardness: parseEventActiveHardness(payload) ?? session.executionProfile?.primaryHardness,
                blockingReason:
                    parseEventBlockingReason(payload)
                    ?? (typeof payload.reason === 'string' ? payload.reason : undefined)
                    ?? ((payload.questions as string[] | undefined) ?? []).find(Boolean),
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
                activeHardness: session.executionProfile?.primaryHardness,
                blockingReason: nextSuspension.userMessage || session.blockingReason,
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
                activeHardness: session.executionProfile?.primaryHardness,
                blockingReason: undefined,
                capabilityReview:
                    typeof (event.payload as { resumeReason?: unknown } | undefined)?.resumeReason === 'string'
                        && (event.payload as { resumeReason?: string }).resumeReason === 'capability_review_approved'
                        ? undefined
                        : session.capabilityReview,
                lastResumeReason:
                    typeof (event.payload as { resumeReason?: unknown } | undefined)?.resumeReason === 'string'
                        ? (event.payload as { resumeReason?: string }).resumeReason
                        : undefined,
            }, event, 'Task resumed');

        case 'TASK_HISTORY_CLEARED': {
            return {
                ...session,
                status: 'idle',
                taskMode: undefined,
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
                plannedTasks: undefined,
                plannedCheckpoints: undefined,
                plannedUserActions: undefined,
                executionProfile: undefined,
                primaryHardness: undefined,
                activeHardness: undefined,
                missingInfo: undefined,
                defaultingPolicy: undefined,
                resumeStrategy: undefined,
                currentCheckpoint: undefined,
                currentUserAction: undefined,
                planSteps: [],
                blockingReason: undefined,
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
