type FollowupPayload = Record<string, unknown>;

type TaskStateShape = {
    status?: string;
    workspacePath?: string;
    lastUserMessage?: string;
};

type FollowupCorrectionDeps = {
    commandType: string;
    commandId: string;
    payload: FollowupPayload;
    getString: (value: unknown) => string | null;
    getTaskState: (taskId: string) => TaskStateShape | undefined;
    getLegacyDeliverables: (taskId: string) => string[] | undefined;
    setLegacyDeliverables: (taskId: string, deliverables: string[]) => void;
    extractSaveTargetFromMessage: (message?: string) => string | null;
    emitTaskEvent: (taskId: string, type: string, payload: FollowupPayload) => void;
    upsertTaskState: (taskId: string, patch: Record<string, unknown>) => TaskStateShape;
    buildTaskTurnContract: (input: {
        message: string;
        workspacePath: string;
        mode: 'chat' | 'task';
        route: 'direct' | 'workflow';
        requiredCapabilities: string[];
        createdAt: string;
    }) => unknown;
    emitFor: (type: string, payload: FollowupPayload) => void;
    getNowIso: () => string;
    defaultWorkspacePath: () => string;
};

export function handleEntrypointFollowupCorrection(input: FollowupCorrectionDeps): boolean {
    if (input.commandType !== 'send_task_message') {
        return false;
    }

    const followupTaskId = input.getString(input.payload.taskId);
    const followupMessage = input.getString(input.payload.content);
    if (!followupTaskId || !followupMessage) {
        return false;
    }

    const previousState = input.getTaskState(followupTaskId);
    const previousTargets = input.getLegacyDeliverables(followupTaskId) ?? [];
    const previousTarget = previousTargets[0]
        ?? input.extractSaveTargetFromMessage(previousState?.lastUserMessage);
    const requestedTarget = input.extractSaveTargetFromMessage(followupMessage);
    const correctionHint = /\b(instead|actually|correct(?:ed|ion)?|update)\b/i.test(followupMessage)
        || /改成|改为|改到|换成|修正/u.test(followupMessage);
    if (
        previousState?.status !== 'finished'
        || !correctionHint
        || !previousTarget
        || !requestedTarget
        || previousTarget === requestedTarget
    ) {
        return false;
    }

    input.setLegacyDeliverables(followupTaskId, [requestedTarget]);
    input.emitTaskEvent(followupTaskId, 'TASK_CONTRACT_REOPENED', {
        trigger: 'contradictory_evidence',
        reason: 'User corrected the previous contract deliverable target.',
        diff: {
            changedFields: ['deliverables'],
            deliverablesChanged: {
                before: [previousTarget],
                after: [requestedTarget],
            },
        },
    });
    input.emitTaskEvent(followupTaskId, 'TASK_RESEARCH_UPDATED', {
        trigger: 'contradictory_evidence',
        summary: 'Follow-up correction detected and deliverable research refreshed.',
    });
    input.emitTaskEvent(followupTaskId, 'TASK_PLAN_READY', {
        trigger: 'contradictory_evidence',
        summary: `Updated deliverable target: ${requestedTarget}`,
        deliverables: [requestedTarget],
    });
    const workspacePath = previousState.workspacePath || input.defaultWorkspacePath();
    input.upsertTaskState(followupTaskId, {
        status: 'idle',
        suspended: false,
        suspensionReason: undefined,
        lastUserMessage: followupMessage,
        executionPath: 'direct',
        turnContract: input.buildTaskTurnContract({
            message: followupMessage,
            workspacePath,
            mode: 'task',
            route: 'direct',
            requiredCapabilities: [],
            createdAt: input.getNowIso(),
        }),
    });
    input.emitFor('send_task_message_response', {
        success: true,
        taskId: followupTaskId,
        accepted: true,
        queuePosition: 0,
        turnId: input.commandId,
    });
    return true;
}
