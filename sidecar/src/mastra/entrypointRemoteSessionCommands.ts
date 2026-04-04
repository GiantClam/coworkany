import type { TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline, type GuardResult } from './entrypointGuardPipeline';

type RemoteSessionStatus = 'active' | 'closed';
type RemoteSessionScope = 'managed' | 'project' | 'user';
type ChannelDeliveryStatus = 'pending' | 'acked';
type RemoteSessionArbitrationAction = 'none' | 'takeover' | 'takeover_stale';

type RemoteSessionArbitration = {
    action: RemoteSessionArbitrationAction;
    previousTaskId?: string;
    previousEndpointId?: string;
    staleMs?: number;
};

type RemoteSessionState = {
    remoteSessionId: string;
    taskId: string;
    channel?: string;
    status: RemoteSessionStatus;
    linkedAt: string;
    lastSeenAt: string;
    metadata?: Record<string, unknown>;
};

type ChannelDeliveryEvent = {
    id: string;
    taskId: string;
    remoteSessionId?: string;
    channel: string;
    eventType: string;
    content?: string;
    metadata?: Record<string, unknown>;
    injectedAt: string;
    status: ChannelDeliveryStatus;
    deliveryAttempts?: number;
    lastDeliveredAt?: string;
    ackedAt?: string;
    ackMetadata?: Record<string, unknown>;
};

type RemoteSessionGovernanceDecision = {
    allowed: boolean;
    error?: string;
    existingState?: RemoteSessionState;
    arbitration?: RemoteSessionArbitration;
};

type HandleRemoteSessionCommandsInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    toOptionalRecord: (value: unknown) => Record<string, unknown> | undefined;
    getNowIso: () => string;
    createId: () => string;
    listRemoteSessions: (input?: {
        taskId?: string;
        status?: RemoteSessionStatus;
    }) => RemoteSessionState[];
    parseRemoteSessionScope: (
        payload: Record<string, unknown>,
        metadata?: Record<string, unknown>,
    ) => RemoteSessionScope;
    withRemoteSessionScopeMetadata: (
        metadata: Record<string, unknown> | undefined,
        scope: RemoteSessionScope,
    ) => Record<string, unknown> | undefined;
    evaluateManagedTenantCommandGovernance: (
        payload: Record<string, unknown>,
        remoteSessionId?: string,
    ) => { allowed: true } | { allowed: false; error: string; remoteSession: RemoteSessionState | null };
    evaluateRemoteSessionGovernance: (input: {
        remoteSessionId: string;
        targetTaskId: string;
        scope: RemoteSessionScope;
        metadata?: Record<string, unknown>;
    }) => RemoteSessionGovernanceDecision;
    resolveTaskIdForExternalEvent: (payload: Record<string, unknown>) => string | null;
    resolveRemoteSessionState: (remoteSessionId: string) => RemoteSessionState | undefined;
    resolveTaskIdForRemoteSessionId: (remoteSessionId: string) => string | undefined;
    upsertRemoteSessionRecord: (input: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }) => { success: boolean; conflict?: boolean; state?: RemoteSessionState };
    bindRemoteSessionToTask: (taskId: string, remoteSessionId: string) => void;
    unbindRemoteSession: (remoteSessionId: string) => void;
    heartbeatRemoteSessionRecord: (
        remoteSessionId: string,
        metadata?: Record<string, unknown>,
    ) => { success: boolean; state?: RemoteSessionState };
    closeRemoteSessionRecord: (remoteSessionId: string) => { success: boolean; state?: RemoteSessionState };
    enqueueChannelDeliveryEvent: (input: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }) => {
        event: ChannelDeliveryEvent;
        deduplicated: boolean;
        requeued: boolean;
    };
    listChannelDeliveryEvents: (input?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }) => ChannelDeliveryEvent[];
    ackChannelDeliveryEvent: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }) => { success: boolean; event?: ChannelDeliveryEvent };
    getChannelDeliveryEvent: (eventId: string) => ChannelDeliveryEvent | undefined;
    markChannelDeliveryDelivered: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }) => { success: boolean; event?: ChannelDeliveryEvent };
    upsertTaskState: (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ) => TaskRuntimeState;
    resolveTaskResourceId: (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ) => string;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
    emitHookEvent: (
        type: 'SessionStart' | 'TaskCreated' | 'RemoteSessionLinked' | 'ChannelEventInjected' | 'PermissionRequest' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'TaskCompleted' | 'TaskFailed' | 'TaskRewound',
        event: {
            taskId?: string;
            runId?: string;
            traceId?: string;
            payload?: Record<string, unknown>;
        },
    ) => void;
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'task_command' | 'forward_command' | 'approval_result';
        commandType?: string;
        taskId?: string;
        source: string;
        payload?: Record<string, unknown>;
        approved?: boolean;
    }) => {
        allowed: boolean;
        reason: string;
        ruleId: string;
    };
    emitInvalidPayload: (type: string, extra?: Record<string, unknown>) => void;
    emitFor: (type: string, responsePayload: Record<string, unknown>) => void;
    emitTaskEvent: (taskId: string, payload: Record<string, unknown>) => void;
};

type RemoteSessionCommandType =
    | 'list_remote_sessions'
    | 'open_remote_session'
    | 'heartbeat_remote_session'
    | 'sync_remote_session'
    | 'close_remote_session'
    | 'bind_remote_session'
    | 'inject_channel_event'
    | 'list_channel_delivery_events'
    | 'ack_channel_delivery_event'
    | 'replay_channel_delivery_events';

type RemoteTaskCommandGuardFailure = {
    kind: 'tenant' | 'policy';
    error: string;
    remoteSession?: RemoteSessionState | null;
};

function isRemoteSessionCommandType(commandType: string): commandType is RemoteSessionCommandType {
    return commandType === 'list_remote_sessions'
        || commandType === 'open_remote_session'
        || commandType === 'heartbeat_remote_session'
        || commandType === 'sync_remote_session'
        || commandType === 'close_remote_session'
        || commandType === 'bind_remote_session'
        || commandType === 'inject_channel_event'
        || commandType === 'list_channel_delivery_events'
        || commandType === 'ack_channel_delivery_event'
        || commandType === 'replay_channel_delivery_events';
}

async function runRemoteTaskCommandGuards(input: {
    commandId: string;
    commandType: string;
    payload: Record<string, unknown>;
    taskId?: string;
    remoteSessionId?: string;
    source: string;
    policyFirst?: boolean;
    applyPolicyDecision: HandleRemoteSessionCommandsInput['applyPolicyDecision'];
    evaluateManagedTenantCommandGovernance: HandleRemoteSessionCommandsInput['evaluateManagedTenantCommandGovernance'];
}): Promise<
    { ok: true } | { ok: false; failure: RemoteTaskCommandGuardFailure }
> {
    const runPolicyGuard = (): GuardResult<RemoteTaskCommandGuardFailure> => {
        if (!input.taskId) {
            return passGuard();
        }
        const policyDecision = input.applyPolicyDecision({
            requestId: input.commandId,
            action: 'task_command',
            commandType: input.commandType,
            taskId: input.taskId,
            source: input.source,
            payload: input.payload,
        });
        if (!policyDecision.allowed) {
            return failGuard(`policy_denied:${policyDecision.reason}`, {
                kind: 'policy',
                error: `policy_denied:${policyDecision.reason}`,
            });
        }
        return passGuard();
    };
    const runTenantGuard = (): GuardResult<RemoteTaskCommandGuardFailure> => {
        const tenantGovernance = input.evaluateManagedTenantCommandGovernance(
            input.payload,
            input.remoteSessionId,
        );
        if (!tenantGovernance.allowed) {
            return failGuard(tenantGovernance.error, {
                kind: 'tenant',
                error: tenantGovernance.error,
                remoteSession: tenantGovernance.remoteSession,
            });
        }
        return passGuard();
    };
    const guards = input.policyFirst
        ? [runPolicyGuard, runTenantGuard]
        : [runTenantGuard, runPolicyGuard];
    const guarded = await runGuardPipeline<RemoteTaskCommandGuardFailure>(guards);
    if (guarded.ok) {
        return { ok: true };
    }
    return {
        ok: false,
        failure: guarded.payload,
    };
}

async function handleGuardedFailure(
    failure: RemoteTaskCommandGuardFailure,
    emitFor: HandleRemoteSessionCommandsInput['emitFor'],
    responseType: string,
    payload: Record<string, unknown>,
): Promise<true> {
    emitFor(responseType, {
        success: false,
        ...payload,
        error: failure.error,
        ...(failure.kind === 'tenant'
            ? { remoteSession: failure.remoteSession ?? null }
            : {}),
    });
    return true;
}

export async function handleRemoteSessionCommands(
    input: HandleRemoteSessionCommandsInput,
): Promise<boolean> {
    if (!isRemoteSessionCommandType(input.commandType)) {
        return false;
    }

    const { commandType, commandId, payload } = input;
    if (commandType === 'list_remote_sessions') {
        const taskId = input.getString(payload.taskId) ?? undefined;
        const statusRaw = input.getString(payload.status);
        const status = statusRaw === 'active' || statusRaw === 'closed'
            ? statusRaw
            : undefined;
        const sessions = input.listRemoteSessions({ taskId, status });
        input.emitFor('list_remote_sessions_response', {
            success: true,
            sessions,
            count: sessions.length,
            taskId: taskId ?? null,
            status: status ?? null,
        });
        return true;
    }

    if (commandType === 'open_remote_session') {
        const taskId = input.getString(payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('open_remote_session_response', { taskId });
            return true;
        }
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? `remote-${input.createId()}`;
        const metadata = input.toOptionalRecord(payload.metadata);
        const scope = input.parseRemoteSessionScope(payload, metadata);
        const scopedMetadata = input.withRemoteSessionScopeMetadata(metadata, scope);
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId,
            remoteSessionId,
            source: 'remote_session_open',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            input.emitFor('open_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: commandGuard.failure.error,
                ...(commandGuard.failure.kind === 'tenant'
                    ? { remoteSession: commandGuard.failure.remoteSession ?? null }
                    : {}),
            });
            return true;
        }
        const governance = input.evaluateRemoteSessionGovernance({
            remoteSessionId,
            targetTaskId: taskId,
            scope,
            metadata: scopedMetadata,
        });
        if (!governance.allowed) {
            input.emitFor('open_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: governance.error ?? 'remote_session_governance_denied',
                remoteSession: governance.existingState ?? null,
            });
            return true;
        }
        const arbitration = governance.arbitration ?? { action: 'none' as const };
        if (
            arbitration.action !== 'none'
            && governance.existingState
            && governance.existingState.taskId !== taskId
        ) {
            input.closeRemoteSessionRecord(remoteSessionId);
            input.unbindRemoteSession(remoteSessionId);
        }
        const upserted = input.upsertRemoteSessionRecord({
            remoteSessionId,
            taskId,
            channel: input.getString(payload.channel) ?? undefined,
            metadata: scopedMetadata,
        });
        if (!upserted.success) {
            input.emitFor('open_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_open_failed',
                remoteSession: upserted.state ?? null,
                arbitration,
            });
            return true;
        }
        input.bindRemoteSessionToTask(taskId, remoteSessionId);
        input.appendTranscript(taskId, 'system', `Remote session opened: ${remoteSessionId}`);
        input.emitHookEvent('RemoteSessionLinked', {
            taskId,
            payload: {
                remoteSessionId,
                channel: input.getString(payload.channel) ?? null,
                source: 'open_remote_session',
            },
        });
        input.emitTaskEvent(taskId, {
            type: 'remote_session',
            action: arbitration.action === 'none' ? 'opened' : 'rebound',
            remoteSessionId,
            channel: input.getString(payload.channel) ?? null,
            scope,
            arbitration,
            at: input.getNowIso(),
        });
        input.emitFor('open_remote_session_response', {
            success: true,
            taskId,
            remoteSessionId,
            remoteSession: upserted.state ?? null,
            scope,
            arbitration,
        });
        return true;
    }

    if (commandType === 'heartbeat_remote_session') {
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? '';
        if (!remoteSessionId) {
            input.emitInvalidPayload('heartbeat_remote_session_response', { remoteSessionId });
            return true;
        }
        const state = input.resolveRemoteSessionState(remoteSessionId);
        const taskId = input.getString(payload.taskId)
            ?? state?.taskId
            ?? input.resolveTaskIdForRemoteSessionId(remoteSessionId)
            ?? '';
        if (!taskId) {
            input.emitFor('heartbeat_remote_session_response', {
                success: false,
                remoteSessionId,
                error: 'remote_session_not_found',
            });
            return true;
        }
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId,
            remoteSessionId,
            source: 'remote_session_heartbeat',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            input.emitFor('heartbeat_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: commandGuard.failure.error,
                ...(commandGuard.failure.kind === 'tenant'
                    ? { remoteSession: commandGuard.failure.remoteSession ?? null }
                    : {}),
            });
            return true;
        }
        const heartbeated = input.heartbeatRemoteSessionRecord(remoteSessionId, input.toOptionalRecord(payload.metadata));
        if (!heartbeated.success) {
            input.emitFor('heartbeat_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: 'remote_session_not_found',
            });
            return true;
        }
        input.bindRemoteSessionToTask(taskId, remoteSessionId);
        input.emitFor('heartbeat_remote_session_response', {
            success: true,
            taskId,
            remoteSessionId,
            remoteSession: heartbeated.state ?? null,
        });
        return true;
    }

    if (commandType === 'sync_remote_session') {
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? '';
        if (!remoteSessionId) {
            input.emitInvalidPayload('sync_remote_session_response', { remoteSessionId });
            return true;
        }
        const existingRemoteState = input.resolveRemoteSessionState(remoteSessionId);
        const taskId = input.getString(payload.taskId)
            ?? existingRemoteState?.taskId
            ?? input.resolveTaskIdForRemoteSessionId(remoteSessionId)
            ?? '';
        if (!taskId) {
            input.emitFor('sync_remote_session_response', {
                success: false,
                remoteSessionId,
                error: 'remote_session_not_found',
            });
            return true;
        }
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId,
            remoteSessionId,
            source: 'remote_session_sync',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            input.emitFor('sync_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: commandGuard.failure.error,
                ...(commandGuard.failure.kind === 'tenant'
                    ? { remoteSession: commandGuard.failure.remoteSession ?? null }
                    : {}),
            });
            return true;
        }
        const syncMetadata = input.toOptionalRecord(payload.metadata);
        const scope = input.parseRemoteSessionScope(payload, syncMetadata);
        const scopedMetadata = input.withRemoteSessionScopeMetadata(syncMetadata, scope);
        const governance = input.evaluateRemoteSessionGovernance({
            remoteSessionId,
            targetTaskId: taskId,
            scope,
            metadata: scopedMetadata,
        });
        if (!governance.allowed) {
            input.emitFor('sync_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: governance.error ?? 'remote_session_governance_denied',
                remoteSession: governance.existingState ?? null,
            });
            return true;
        }
        const arbitration = governance.arbitration ?? { action: 'none' as const };
        if (
            arbitration.action !== 'none'
            && governance.existingState
            && governance.existingState.taskId !== taskId
        ) {
            input.closeRemoteSessionRecord(remoteSessionId);
            input.unbindRemoteSession(remoteSessionId);
        }
        const syncChannel = input.getString(payload.channel) ?? existingRemoteState?.channel;
        const upserted = input.upsertRemoteSessionRecord({
            remoteSessionId,
            taskId,
            channel: syncChannel ?? undefined,
            metadata: scopedMetadata,
        });
        if (!upserted.success) {
            input.emitFor('sync_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_sync_failed',
                remoteSession: upserted.state ?? null,
                arbitration,
            });
            return true;
        }
        input.bindRemoteSessionToTask(taskId, remoteSessionId);
        const heartbeated = input.heartbeatRemoteSessionRecord(remoteSessionId, scopedMetadata);
        const replayPending = payload.replayPending !== false;
        const onlyRemoteSessionPending = payload.onlyRemoteSessionPending === true;
        const ackReplayed = payload.ackReplayed === true;
        const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
            ? Math.min(200, Math.floor(payload.limit))
            : 50;
        const allPending = replayPending
            ? input.listChannelDeliveryEvents({
                taskId,
                status: 'pending',
                limit,
            })
            : [];
        const pendingEvents = onlyRemoteSessionPending
            ? allPending.filter((event) => event.remoteSessionId === remoteSessionId)
            : allPending;
        const replayedEventIds: string[] = [];
        let ackedCount = 0;
        if (replayPending) {
            for (const event of pendingEvents) {
                const delivered = input.markChannelDeliveryDelivered({
                    eventId: event.id,
                    taskId: event.taskId,
                    remoteSessionId: event.remoteSessionId ?? remoteSessionId,
                });
                const replayEvent = delivered.event ?? event;
                replayedEventIds.push(replayEvent.id);
                input.emitTaskEvent(replayEvent.taskId, {
                    type: 'channel_event',
                    action: 'replayed_on_sync',
                    deliveryId: replayEvent.id,
                    channel: replayEvent.channel,
                    eventType: replayEvent.eventType,
                    content: replayEvent.content ?? '',
                    remoteSessionId: replayEvent.remoteSessionId ?? null,
                    metadata: replayEvent.metadata ?? {},
                    deliveryAttempts: replayEvent.deliveryAttempts ?? 0,
                    replayedAt: input.getNowIso(),
                });
                if (ackReplayed) {
                    const acked = input.ackChannelDeliveryEvent({
                        eventId: replayEvent.id,
                        taskId: replayEvent.taskId,
                        remoteSessionId: replayEvent.remoteSessionId,
                        metadata: {
                            source: 'sync_remote_session',
                            remoteSessionId,
                        },
                    });
                    if (acked.success) {
                        ackedCount += 1;
                    }
                }
            }
        }
        input.emitTaskEvent(taskId, {
            type: 'remote_session',
            action: 'synced',
            remoteSessionId,
            channel: syncChannel ?? null,
            scope,
            arbitration,
            pendingCount: pendingEvents.length,
            replayedCount: replayedEventIds.length,
            ackedCount,
            at: input.getNowIso(),
        });
        input.emitFor('sync_remote_session_response', {
            success: true,
            taskId,
            remoteSessionId,
            remoteSession: heartbeated.state ?? upserted.state ?? null,
            replayPending,
            onlyRemoteSessionPending,
            ackReplayed,
            pendingCount: pendingEvents.length,
            replayedCount: replayedEventIds.length,
            replayedEventIds,
            ackedCount,
            scope,
            arbitration,
        });
        return true;
    }

    if (commandType === 'close_remote_session') {
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? '';
        if (!remoteSessionId) {
            input.emitInvalidPayload('close_remote_session_response', { remoteSessionId });
            return true;
        }
        const state = input.resolveRemoteSessionState(remoteSessionId);
        const taskId = input.getString(payload.taskId)
            ?? state?.taskId
            ?? input.resolveTaskIdForRemoteSessionId(remoteSessionId)
            ?? '';
        if (!taskId) {
            input.emitFor('close_remote_session_response', {
                success: false,
                remoteSessionId,
                error: 'remote_session_not_found',
            });
            return true;
        }
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId,
            remoteSessionId,
            source: 'remote_session_close',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            input.emitFor('close_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: commandGuard.failure.error,
                ...(commandGuard.failure.kind === 'tenant'
                    ? { remoteSession: commandGuard.failure.remoteSession ?? null }
                    : {}),
            });
            return true;
        }
        const closed = input.closeRemoteSessionRecord(remoteSessionId);
        if (!closed.success) {
            input.emitFor('close_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: 'remote_session_not_found',
            });
            return true;
        }
        input.unbindRemoteSession(remoteSessionId);
        input.appendTranscript(taskId, 'system', `Remote session closed: ${remoteSessionId}`);
        input.emitTaskEvent(taskId, {
            type: 'remote_session',
            action: 'closed',
            remoteSessionId,
            at: input.getNowIso(),
        });
        input.emitFor('close_remote_session_response', {
            success: true,
            taskId,
            remoteSessionId,
            remoteSession: closed.state ?? null,
        });
        return true;
    }

    if (commandType === 'bind_remote_session') {
        const taskId = input.getString(payload.taskId) ?? '';
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? '';
        if (!taskId || !remoteSessionId) {
            input.emitInvalidPayload('bind_remote_session_response', { taskId, remoteSessionId });
            return true;
        }
        const metadata = input.toOptionalRecord(payload.metadata);
        const scope = input.parseRemoteSessionScope(payload, metadata);
        const scopedMetadata = input.withRemoteSessionScopeMetadata(metadata, scope);
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId,
            remoteSessionId,
            source: 'remote_session_bind',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            input.emitFor('bind_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: commandGuard.failure.error,
                ...(commandGuard.failure.kind === 'tenant'
                    ? { remoteSession: commandGuard.failure.remoteSession ?? null }
                    : {}),
            });
            return true;
        }
        const governance = input.evaluateRemoteSessionGovernance({
            remoteSessionId,
            targetTaskId: taskId,
            scope,
            metadata: scopedMetadata,
        });
        if (!governance.allowed) {
            input.emitFor('bind_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: governance.error ?? 'remote_session_governance_denied',
                remoteSession: governance.existingState ?? null,
            });
            return true;
        }
        const arbitration = governance.arbitration ?? { action: 'none' as const };
        if (
            arbitration.action !== 'none'
            && governance.existingState
            && governance.existingState.taskId !== taskId
        ) {
            input.closeRemoteSessionRecord(remoteSessionId);
            input.unbindRemoteSession(remoteSessionId);
        }
        const existing = input.taskStates.get(taskId);
        input.upsertTaskState(taskId, {
            title: input.getString(payload.title) ?? existing?.title ?? 'Task',
            workspacePath: input.getString(payload.workspacePath) ?? existing?.workspacePath ?? process.cwd(),
            status: existing?.status ?? 'idle',
            suspended: existing?.suspended,
            suspensionReason: existing?.suspensionReason,
            resourceId: input.resolveTaskResourceId(taskId, payload, existing?.resourceId),
        });
        const upserted = input.upsertRemoteSessionRecord({
            remoteSessionId,
            taskId,
            channel: input.getString(payload.channel) ?? undefined,
            metadata: scopedMetadata,
        });
        if (!upserted.success) {
            input.emitFor('bind_remote_session_response', {
                success: false,
                taskId,
                remoteSessionId,
                error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_bind_failed',
                remoteSession: upserted.state ?? null,
                arbitration,
            });
            return true;
        }
        input.bindRemoteSessionToTask(taskId, remoteSessionId);
        input.appendTranscript(taskId, 'system', `Remote session linked: ${remoteSessionId}`);
        input.emitHookEvent('RemoteSessionLinked', {
            taskId,
            payload: {
                remoteSessionId,
                channel: input.getString(payload.channel) ?? null,
                source: 'bind_remote_session',
                scope,
                arbitration,
            },
        });
        input.emitFor('bind_remote_session_response', {
            success: true,
            taskId,
            remoteSessionId,
            remoteSession: upserted.state ?? null,
            scope,
            arbitration,
        });
        return true;
    }

    if (commandType === 'inject_channel_event') {
        const resolvedTaskId = input.resolveTaskIdForExternalEvent(payload);
        const channel = input.getString(payload.channel) ?? '';
        if (!resolvedTaskId || !channel) {
            input.emitInvalidPayload('inject_channel_event_response', {
                taskId: resolvedTaskId ?? '',
                channel,
            });
            return true;
        }
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? undefined;
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId: resolvedTaskId,
            remoteSessionId,
            source: 'channel_injection',
            policyFirst: true,
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            return handleGuardedFailure(
                commandGuard.failure,
                input.emitFor,
                'inject_channel_event_response',
                {
                    taskId: resolvedTaskId,
                    channel,
                },
            );
        }
        const existing = input.taskStates.get(resolvedTaskId);
        input.upsertTaskState(resolvedTaskId, {
            title: existing?.title ?? 'Task',
            workspacePath: existing?.workspacePath ?? process.cwd(),
            status: existing?.status ?? 'idle',
            suspended: existing?.suspended,
            suspensionReason: existing?.suspensionReason,
            resourceId: existing?.resourceId ?? input.resolveTaskResourceId(resolvedTaskId, payload, undefined),
        });
        const eventType = input.getString(payload.eventType) ?? 'message';
        const content = input.getString(payload.content) ?? '';
        const metadata = input.toOptionalRecord(payload.metadata);
        const remoteScope = input.parseRemoteSessionScope(payload, metadata);
        const scopedMetadata = input.withRemoteSessionScopeMetadata(metadata, remoteScope);
        const eventId = input.getString(payload.eventId) ?? input.getString(payload.deliveryId) ?? undefined;
        const forceRequeue = payload.forceRequeue === true;
        const delivery = input.enqueueChannelDeliveryEvent({
            taskId: resolvedTaskId,
            remoteSessionId,
            channel,
            eventType,
            content,
            metadata: scopedMetadata,
            eventId,
            forceRequeue,
        });
        if (remoteSessionId) {
            const upserted = input.upsertRemoteSessionRecord({
                remoteSessionId,
                taskId: resolvedTaskId,
                channel,
                metadata: scopedMetadata,
            });
            if (upserted.success) {
                input.bindRemoteSessionToTask(resolvedTaskId, remoteSessionId);
                input.heartbeatRemoteSessionRecord(remoteSessionId, scopedMetadata);
            }
        }
        if (!delivery.deduplicated || forceRequeue) {
            input.appendTranscript(
                resolvedTaskId,
                'system',
                `[Channel:${channel}] ${eventType}${content ? ` — ${content}` : ''}`,
            );
            input.emitHookEvent('ChannelEventInjected', {
                taskId: resolvedTaskId,
                payload: {
                    channel,
                    eventType,
                    content,
                    remoteSessionId,
                    metadata: scopedMetadata ?? {},
                    deliveryId: delivery.event.id,
                },
            });
            input.emitTaskEvent(resolvedTaskId, {
                type: 'channel_event',
                action: delivery.requeued ? 'requeued' : 'injected',
                deduplicated: false,
                deliveryId: delivery.event.id,
                channel,
                eventType,
                content,
                remoteSessionId: remoteSessionId ?? null,
                metadata: scopedMetadata ?? {},
                injectedAt: input.getNowIso(),
            });
        }
        input.emitFor('inject_channel_event_response', {
            success: true,
            taskId: resolvedTaskId,
            channel,
            eventType,
            deduplicated: delivery.deduplicated,
            requeued: delivery.requeued,
            delivery: delivery.event,
        });
        return true;
    }

    if (commandType === 'list_channel_delivery_events') {
        const taskId = input.getString(payload.taskId) ?? undefined;
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? undefined;
        const statusRaw = input.getString(payload.status);
        const status = statusRaw === 'pending' || statusRaw === 'acked'
            ? statusRaw
            : undefined;
        const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
            ? Math.min(1000, Math.floor(payload.limit))
            : undefined;
        const resolvedTaskId = taskId
            ?? (remoteSessionId ? input.resolveTaskIdForRemoteSessionId(remoteSessionId) : undefined);
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId: resolvedTaskId,
            remoteSessionId,
            source: 'channel_delivery_list',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            return handleGuardedFailure(
                commandGuard.failure,
                input.emitFor,
                'list_channel_delivery_events_response',
                {
                    taskId: resolvedTaskId ?? taskId ?? null,
                    remoteSessionId: remoteSessionId ?? null,
                },
            );
        }
        const events = input.listChannelDeliveryEvents({
            taskId: resolvedTaskId ?? taskId,
            remoteSessionId,
            status,
            limit,
        });
        input.emitFor('list_channel_delivery_events_response', {
            success: true,
            taskId: resolvedTaskId ?? taskId ?? null,
            remoteSessionId: remoteSessionId ?? null,
            status: status ?? null,
            events,
            count: events.length,
        });
        return true;
    }

    if (commandType === 'ack_channel_delivery_event') {
        const eventId = input.getString(payload.eventId) ?? '';
        if (!eventId) {
            input.emitInvalidPayload('ack_channel_delivery_event_response', { eventId });
            return true;
        }
        const taskId = input.getString(payload.taskId) ?? undefined;
        const remoteSessionId = input.getString(payload.remoteSessionId) ?? undefined;
        const existingEvent = input.getChannelDeliveryEvent(eventId);
        const governanceRemoteSessionId = remoteSessionId ?? existingEvent?.remoteSessionId;
        const resolvedTaskId = taskId
            ?? existingEvent?.taskId
            ?? (remoteSessionId ? input.resolveTaskIdForRemoteSessionId(remoteSessionId) : undefined);
        const commandGuard = await runRemoteTaskCommandGuards({
            commandId,
            commandType,
            payload,
            taskId: resolvedTaskId,
            remoteSessionId: governanceRemoteSessionId,
            source: 'channel_delivery_ack',
            applyPolicyDecision: input.applyPolicyDecision,
            evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
        });
        if (!commandGuard.ok) {
            return handleGuardedFailure(
                commandGuard.failure,
                input.emitFor,
                'ack_channel_delivery_event_response',
                {
                    taskId: resolvedTaskId ?? taskId ?? null,
                    remoteSessionId: governanceRemoteSessionId ?? null,
                    eventId,
                },
            );
        }
        const acked = input.ackChannelDeliveryEvent({
            eventId,
            taskId: resolvedTaskId ?? taskId,
            remoteSessionId: remoteSessionId ?? existingEvent?.remoteSessionId,
            metadata: input.toRecord(payload.metadata),
        });
        if (!acked.success) {
            input.emitFor('ack_channel_delivery_event_response', {
                success: false,
                taskId: resolvedTaskId ?? taskId ?? null,
                remoteSessionId: remoteSessionId ?? null,
                eventId,
                error: 'channel_delivery_event_not_found',
            });
            return true;
        }
        if (acked.event?.taskId) {
            input.emitTaskEvent(acked.event.taskId, {
                type: 'channel_event_delivery',
                action: 'acked',
                deliveryId: acked.event.id,
                remoteSessionId: acked.event.remoteSessionId ?? null,
                ackedAt: acked.event.ackedAt ?? input.getNowIso(),
            });
        }
        input.emitFor('ack_channel_delivery_event_response', {
            success: true,
            taskId: acked.event?.taskId ?? resolvedTaskId ?? null,
            remoteSessionId: acked.event?.remoteSessionId ?? remoteSessionId ?? null,
            event: acked.event ?? null,
        });
        return true;
    }

    const taskId = input.getString(payload.taskId) ?? undefined;
    const remoteSessionId = input.getString(payload.remoteSessionId) ?? undefined;
    const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
        ? Math.min(100, Math.floor(payload.limit))
        : 20;
    const ackOnReplay = payload.ackOnReplay === true;
    const resolvedTaskId = taskId
        ?? (remoteSessionId ? input.resolveTaskIdForRemoteSessionId(remoteSessionId) : undefined);
    const commandGuard = await runRemoteTaskCommandGuards({
        commandId,
        commandType,
        payload,
        taskId: resolvedTaskId,
        remoteSessionId,
        source: 'channel_delivery_replay',
        applyPolicyDecision: input.applyPolicyDecision,
        evaluateManagedTenantCommandGovernance: input.evaluateManagedTenantCommandGovernance,
    });
    if (!commandGuard.ok) {
        return handleGuardedFailure(
            commandGuard.failure,
            input.emitFor,
            'replay_channel_delivery_events_response',
            {
                taskId: resolvedTaskId ?? taskId ?? null,
                remoteSessionId: remoteSessionId ?? null,
            },
        );
    }
    if (!resolvedTaskId) {
        input.emitInvalidPayload('replay_channel_delivery_events_response', {
            taskId: taskId ?? '',
            remoteSessionId: remoteSessionId ?? '',
        });
        return true;
    }
    const events = input.listChannelDeliveryEvents({
        taskId: resolvedTaskId,
        remoteSessionId,
        status: 'pending',
        limit,
    });
    let ackedCount = 0;
    for (const event of events) {
        const delivered = input.markChannelDeliveryDelivered({
            eventId: event.id,
            taskId: event.taskId,
            remoteSessionId: event.remoteSessionId ?? remoteSessionId,
        });
        const replayEvent = delivered.event ?? event;
        input.emitTaskEvent(event.taskId, {
            type: 'channel_event',
            action: 'replayed',
            deliveryId: replayEvent.id,
            channel: replayEvent.channel,
            eventType: replayEvent.eventType,
            content: replayEvent.content ?? '',
            remoteSessionId: replayEvent.remoteSessionId ?? null,
            metadata: replayEvent.metadata ?? {},
            deliveryAttempts: replayEvent.deliveryAttempts ?? 0,
            replayedAt: input.getNowIso(),
        });
        if (ackOnReplay) {
            const acked = input.ackChannelDeliveryEvent({
                eventId: replayEvent.id,
                taskId: replayEvent.taskId,
                remoteSessionId: replayEvent.remoteSessionId,
                metadata: {
                    source: 'replay_channel_delivery_events',
                },
            });
            if (acked.success) {
                ackedCount += 1;
            }
        }
    }
    input.emitFor('replay_channel_delivery_events_response', {
        success: true,
        taskId: resolvedTaskId,
        remoteSessionId: remoteSessionId ?? null,
        replayedCount: events.length,
        replayedEventIds: events.map((event) => event.id),
        ackedCount,
    });
    return true;
}
