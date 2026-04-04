import type {
    TaskRuntimeCheckpoint,
    TaskRuntimeExecutionPath,
    TaskRuntimeOperationAction,
    TaskRuntimeOperationRecord,
    TaskRuntimeState,
} from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';

type UserMessageExecutionOptions = {
    enabledSkills?: string[];
    executionPath?: 'direct' | 'workflow';
};

type RecoveryOrCheckpointCommandType =
    | 'resume_interrupted_task'
    | 'set_task_checkpoint'
    | 'retry_task'
    | 'recover_tasks';

type HandleRecoveryAndCheckpointCommandsInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    getNowIso: () => string;
    createId: () => string;
    resolveTaskResourceId: (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ) => string;
    resolveTaskCheckpointVersion: (state?: TaskRuntimeState) => number;
    resolveTaskOperationId: (payload: Record<string, unknown>, defaultValue: string) => string;
    resolveExpectedCheckpointVersion: (payload: Record<string, unknown>) => number | undefined;
    findTaskOperationRecord: (
        state: TaskRuntimeState | undefined,
        operationId: string,
        actions?: TaskRuntimeOperationAction[],
    ) => TaskRuntimeOperationRecord | null;
    appendTaskOperationRecord: (
        state: TaskRuntimeState | undefined,
        record: TaskRuntimeOperationRecord,
    ) => TaskRuntimeOperationRecord[];
    upsertTaskState: (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ) => TaskRuntimeState;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
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
    executeTaskMessage: (input: {
        taskId: string;
        turnId: string;
        message: string;
        resourceId: string;
        preferredThreadId: string;
        workspacePath?: string;
        executionOptions?: UserMessageExecutionOptions;
    }) => Promise<TaskRuntimeExecutionPath>;
};

function isRecoveryOrCheckpointCommandType(commandType: string): commandType is RecoveryOrCheckpointCommandType {
    return commandType === 'resume_interrupted_task'
        || commandType === 'set_task_checkpoint'
        || commandType === 'retry_task'
        || commandType === 'recover_tasks';
}

function isRetryableTaskStatus(status: TaskRuntimeState['status']): boolean {
    return status === 'failed'
        || status === 'interrupted'
        || status === 'suspended'
        || status === 'retrying';
}

async function runTaskCommandPolicyGuard(input: {
    commandId: string;
    commandType: string;
    payload: Record<string, unknown>;
    taskId?: string;
    source: string;
    applyPolicyDecision: HandleRecoveryAndCheckpointCommandsInput['applyPolicyDecision'];
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const guarded = await runGuardPipeline<undefined>([
        () => {
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
                return failGuard(`policy_denied:${policyDecision.reason}`, undefined);
            }
            return passGuard();
        },
    ]);
    if (guarded.ok) {
        return { ok: true };
    }
    return {
        ok: false,
        error: guarded.error,
    };
}

export async function handleRecoveryAndCheckpointCommands(
    input: HandleRecoveryAndCheckpointCommandsInput,
): Promise<boolean> {
    if (!isRecoveryOrCheckpointCommandType(input.commandType)) {
        return false;
    }
    const {
        commandType,
        commandId,
        payload,
    } = input;

    if (commandType === 'resume_interrupted_task') {
        const taskId = input.getString(payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('resume_interrupted_task_response', { taskId });
            return true;
        }
        const policyGuard = await runTaskCommandPolicyGuard({
            commandId,
            commandType,
            payload,
            taskId,
            source: 'resume_interrupted_task',
            applyPolicyDecision: input.applyPolicyDecision,
        });
        if (!policyGuard.ok) {
            input.emitFor('resume_interrupted_task_response', {
                success: false,
                taskId,
                error: policyGuard.error,
            });
            return true;
        }
        const operationId = input.resolveTaskOperationId(payload, `resume:${commandId}:${taskId}`);
        const existing = input.taskStates.get(taskId);
        const currentCheckpointVersion = input.resolveTaskCheckpointVersion(existing);
        const dedupedOperation = input.findTaskOperationRecord(existing, operationId, ['resume', 'recover_resume']);
        if (dedupedOperation) {
            input.emitFor('resume_interrupted_task_response', {
                success: true,
                taskId,
                operationId,
                deduplicated: true,
                checkpointVersion: currentCheckpointVersion,
                status: existing?.status ?? null,
            });
            return true;
        }
        const expectedCheckpointVersion = input.resolveExpectedCheckpointVersion(payload);
        if (
            typeof expectedCheckpointVersion === 'number'
            && expectedCheckpointVersion !== currentCheckpointVersion
        ) {
            input.emitFor('resume_interrupted_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'checkpoint_version_conflict',
                expectedCheckpointVersion,
                currentCheckpointVersion,
            });
            return true;
        }
        if (
            typeof expectedCheckpointVersion === 'number'
            && !existing?.checkpoint
        ) {
            input.emitFor('resume_interrupted_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'checkpoint_not_available',
                expectedCheckpointVersion,
                currentCheckpointVersion,
            });
            return true;
        }
        const operationRecord: TaskRuntimeOperationRecord = {
            operationId,
            action: 'resume',
            at: input.getNowIso(),
            result: 'applied',
            checkpointVersion: currentCheckpointVersion,
        };
        const state = input.upsertTaskState(taskId, {
            status: 'running',
            suspended: false,
            suspensionReason: undefined,
            checkpoint: undefined,
            checkpointVersion: currentCheckpointVersion,
            operationLog: input.appendTaskOperationRecord(existing, operationRecord),
            resourceId: input.resolveTaskResourceId(taskId, payload, input.taskStates.get(taskId)?.resourceId),
        });
        const resumeMessage = state.lastUserMessage ?? 'Continue from the saved task context.';
        input.emitFor('resume_interrupted_task_response', {
            success: true,
            taskId,
            operationId,
            deduplicated: false,
            checkpointVersion: currentCheckpointVersion,
        });
        input.appendTranscript(taskId, 'system', 'Task resumed after interruption.');
        const resumeExecutionPath = await input.executeTaskMessage({
            taskId,
            turnId: commandId,
            message: resumeMessage,
            resourceId: state.resourceId,
            preferredThreadId: state.conversationThreadId,
            workspacePath: state.workspacePath,
            executionOptions: {
                enabledSkills: state.enabledSkills,
                executionPath: state.executionPath === 'direct' ? 'direct' : 'workflow',
            },
        });
        if (resumeExecutionPath !== state.executionPath) {
            input.upsertTaskState(taskId, {
                executionPath: resumeExecutionPath,
            });
        }
        return true;
    }

    if (commandType === 'set_task_checkpoint') {
        const taskId = input.getString(payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('set_task_checkpoint_response', { taskId });
            return true;
        }
        const policyGuard = await runTaskCommandPolicyGuard({
            commandId,
            commandType,
            payload,
            taskId,
            source: 'set_task_checkpoint',
            applyPolicyDecision: input.applyPolicyDecision,
        });
        if (!policyGuard.ok) {
            input.emitFor('set_task_checkpoint_response', {
                success: false,
                taskId,
                error: policyGuard.error,
            });
            return true;
        }
        const operationId = input.resolveTaskOperationId(payload, `set_checkpoint:${commandId}:${taskId}`);
        const existing = input.taskStates.get(taskId);
        const dedupedOperation = input.findTaskOperationRecord(existing, operationId, ['set_checkpoint']);
        if (dedupedOperation) {
            input.emitFor('set_task_checkpoint_response', {
                success: true,
                taskId,
                operationId,
                deduplicated: true,
                state: existing
                    ? {
                        taskId: existing.taskId,
                        status: existing.status,
                        suspended: existing.suspended,
                        suspensionReason: existing.suspensionReason,
                        checkpoint: existing.checkpoint ?? null,
                        checkpointVersion: input.resolveTaskCheckpointVersion(existing),
                        executionPath: existing.executionPath ?? 'workflow',
                    }
                    : null,
            });
            return true;
        }
        const currentCheckpointVersion = input.resolveTaskCheckpointVersion(existing);
        const expectedCheckpointVersion = input.resolveExpectedCheckpointVersion(payload);
        if (
            typeof expectedCheckpointVersion === 'number'
            && expectedCheckpointVersion !== currentCheckpointVersion
        ) {
            input.emitFor('set_task_checkpoint_response', {
                success: false,
                taskId,
                operationId,
                error: 'checkpoint_version_conflict',
                expectedCheckpointVersion,
                currentCheckpointVersion,
            });
            return true;
        }
        const nextCheckpointVersion = currentCheckpointVersion + 1;
        const checkpointId = input.getString(payload.checkpointId) ?? `checkpoint:${input.createId()}`;
        const checkpointLabel = input.getString(payload.label) ?? 'Manual checkpoint';
        const checkpoint: TaskRuntimeCheckpoint = {
            id: checkpointId,
            label: checkpointLabel,
            at: input.getNowIso(),
            version: nextCheckpointVersion,
            metadata: input.toRecord(payload.metadata),
        };
        const operationRecord: TaskRuntimeOperationRecord = {
            operationId,
            action: 'set_checkpoint',
            at: input.getNowIso(),
            result: 'applied',
            checkpointVersion: nextCheckpointVersion,
        };
        const state = input.upsertTaskState(taskId, {
            title: input.getString(payload.title) ?? input.taskStates.get(taskId)?.title ?? 'Task',
            workspacePath: input.getString(payload.workspacePath) ?? input.taskStates.get(taskId)?.workspacePath ?? process.cwd(),
            status: 'suspended',
            suspended: true,
            suspensionReason: input.getString(payload.reason) ?? 'checkpoint',
            checkpoint,
            checkpointVersion: nextCheckpointVersion,
            operationLog: input.appendTaskOperationRecord(existing, operationRecord),
            resourceId: input.resolveTaskResourceId(taskId, payload, input.taskStates.get(taskId)?.resourceId),
        });
        input.appendTranscript(taskId, 'system', `Checkpoint set: ${checkpoint.label}`);
        input.emitTaskEvent(taskId, {
            type: 'checkpoint',
            action: 'set',
            checkpoint,
        });
        input.emitFor('set_task_checkpoint_response', {
            success: true,
            taskId,
            operationId,
            deduplicated: false,
            state: {
                taskId: state.taskId,
                status: state.status,
                suspended: state.suspended,
                suspensionReason: state.suspensionReason,
                checkpoint: state.checkpoint ?? null,
                checkpointVersion: state.checkpointVersion ?? input.resolveTaskCheckpointVersion(state),
                executionPath: state.executionPath ?? 'workflow',
            },
        });
        return true;
    }

    if (commandType === 'retry_task') {
        const taskId = input.getString(payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('retry_task_response', { taskId });
            return true;
        }
        const policyGuard = await runTaskCommandPolicyGuard({
            commandId,
            commandType,
            payload,
            taskId,
            source: 'retry_task',
            applyPolicyDecision: input.applyPolicyDecision,
        });
        if (!policyGuard.ok) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                error: policyGuard.error,
            });
            return true;
        }
        const existing = input.taskStates.get(taskId);
        if (!existing) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                operationId: input.resolveTaskOperationId(payload, `retry:${commandId}:${taskId}`),
                error: 'task_not_found',
            });
            return true;
        }
        const operationId = input.resolveTaskOperationId(payload, `retry:${commandId}:${taskId}`);
        const dedupedOperation = input.findTaskOperationRecord(existing, operationId, ['retry', 'recover_retry']);
        if (dedupedOperation) {
            input.emitFor('retry_task_response', {
                success: true,
                taskId,
                operationId,
                deduplicated: true,
                checkpointVersion: input.resolveTaskCheckpointVersion(existing),
                attempt: existing.retry?.attempts ?? 0,
                retry: existing.retry ?? null,
            });
            return true;
        }
        const currentCheckpointVersion = input.resolveTaskCheckpointVersion(existing);
        const expectedCheckpointVersion = input.resolveExpectedCheckpointVersion(payload);
        if (
            typeof expectedCheckpointVersion === 'number'
            && expectedCheckpointVersion !== currentCheckpointVersion
        ) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'checkpoint_version_conflict',
                expectedCheckpointVersion,
                currentCheckpointVersion,
            });
            return true;
        }
        if (
            typeof expectedCheckpointVersion === 'number'
            && !existing.checkpoint
        ) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'checkpoint_not_available',
                expectedCheckpointVersion,
                currentCheckpointVersion,
            });
            return true;
        }
        if (!isRetryableTaskStatus(existing.status)) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'task_status_not_retryable',
                status: existing.status,
            });
            return true;
        }
        const retry = existing.retry ?? { attempts: 0 };
        const nextAttempts = retry.attempts + 1;
        if (typeof retry.maxAttempts === 'number' && nextAttempts > retry.maxAttempts) {
            input.emitFor('retry_task_response', {
                success: false,
                taskId,
                operationId,
                error: 'retry_limit_reached',
                retry,
            });
            return true;
        }
        const retryMessage = input.getString(payload.message) ?? existing.lastUserMessage ?? 'Retry the last task context.';
        const operationRecord: TaskRuntimeOperationRecord = {
            operationId,
            action: 'retry',
            at: input.getNowIso(),
            result: 'applied',
            checkpointVersion: currentCheckpointVersion,
            retryAttempts: nextAttempts,
        };
        const updated = input.upsertTaskState(taskId, {
            status: 'retrying',
            suspended: false,
            suspensionReason: undefined,
            checkpoint: undefined,
            checkpointVersion: currentCheckpointVersion,
            lastUserMessage: retryMessage,
            retry: {
                attempts: nextAttempts,
                maxAttempts: retry.maxAttempts,
                lastRetryAt: input.getNowIso(),
                lastError: undefined,
            },
            operationLog: input.appendTaskOperationRecord(existing, operationRecord),
        });
        input.appendTranscript(taskId, 'system', `Retry requested (attempt ${nextAttempts}).`);
        input.emitTaskEvent(taskId, {
            type: 'retry',
            attempt: nextAttempts,
            maxAttempts: updated.retry?.maxAttempts ?? null,
            message: retryMessage,
        });
        input.emitFor('retry_task_response', {
            success: true,
            taskId,
            operationId,
            deduplicated: false,
            checkpointVersion: currentCheckpointVersion,
            attempt: nextAttempts,
            retry: updated.retry ?? null,
        });
        const retryExecutionPath = await input.executeTaskMessage({
            taskId,
            turnId: commandId,
            message: retryMessage,
            resourceId: updated.resourceId,
            preferredThreadId: updated.conversationThreadId,
            workspacePath: updated.workspacePath,
            executionOptions: {
                enabledSkills: updated.enabledSkills,
                executionPath: updated.executionPath === 'direct' ? 'direct' : 'workflow',
            },
        });
        if (retryExecutionPath !== updated.executionPath) {
            input.upsertTaskState(taskId, {
                executionPath: retryExecutionPath,
            });
        }
        return true;
    }

    const taskIdFilter = input.getString(payload.taskId) ?? undefined;
    const workspacePathFilter = input.getString(payload.workspacePath) ?? undefined;
    const recoveryOperationId = input.resolveTaskOperationId(payload, `recover:${commandId}`);
    const mode = payload.mode === 'resume' || payload.mode === 'retry' || payload.mode === 'auto'
        ? payload.mode
        : 'auto';
    const dryRun = payload.dryRun === true;
    const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
        ? Math.min(100, Math.floor(payload.limit))
        : 20;
    const statusFilterSet = Array.isArray(payload.statuses)
        ? new Set(
            payload.statuses
                .filter((item): item is string => typeof item === 'string')
                .filter((item) =>
                    item === 'interrupted'
                    || item === 'suspended'
                    || item === 'failed'
                    || item === 'retrying',
                ),
        )
        : new Set(['interrupted', 'suspended', 'failed', 'retrying']);
    const candidates = Array
        .from(input.taskStates.values())
        .filter((state) => !taskIdFilter || state.taskId === taskIdFilter)
        .filter((state) => !workspacePathFilter || state.workspacePath === workspacePathFilter)
        .filter((state) => statusFilterSet.has(state.status))
        .slice(0, limit);
    if (candidates.length === 0) {
        input.emitFor('recover_tasks_response', {
            success: true,
            operationId: recoveryOperationId,
            mode,
            dryRun,
            count: 0,
            recoveredCount: 0,
            skippedCount: 0,
            items: [],
        });
        return true;
    }
    const primaryTaskForPolicy = candidates[0]?.taskId;
    const guardResult = await runTaskCommandPolicyGuard({
        commandId,
        commandType,
        payload,
        taskId: primaryTaskForPolicy,
        source: 'recover_tasks',
        applyPolicyDecision: input.applyPolicyDecision,
    });
    if (!guardResult.ok) {
        input.emitFor('recover_tasks_response', {
            success: false,
            operationId: recoveryOperationId,
            mode,
            dryRun,
            error: guardResult.error,
        });
        return true;
    }
    const results: Array<Record<string, unknown>> = [];
    let recoveredCount = 0;
    for (const state of candidates) {
        const latestState = input.taskStates.get(state.taskId) ?? state;
        const checkpoint = state.checkpoint;
        const retry = state.retry ?? { attempts: 0 };
        const canRetry =
            state.status === 'failed'
            || state.status === 'retrying'
            || state.status === 'interrupted'
            || state.status === 'suspended';
        const retryLimitReached = typeof retry.maxAttempts === 'number'
            && retry.attempts >= retry.maxAttempts;
        const shouldSkipSuspendedApproval =
            state.status === 'suspended' && state.suspensionReason === 'approval_required';

        let action: 'resume' | 'retry' | 'skip' = 'skip';
        let reason = 'no_recovery_action';
        if (mode === 'resume') {
            if (state.status === 'interrupted' || state.status === 'suspended') {
                if (shouldSkipSuspendedApproval) {
                    reason = 'awaiting_manual_approval';
                } else {
                    action = 'resume';
                    reason = 'resume_mode';
                }
            } else {
                reason = 'status_not_resumable';
            }
        } else if (mode === 'retry') {
            if (!canRetry) {
                reason = 'status_not_retryable';
            } else if (retryLimitReached) {
                reason = 'retry_limit_reached';
            } else {
                action = 'retry';
                reason = 'retry_mode';
            }
        } else if (state.status === 'failed' || state.status === 'retrying') {
            if (retryLimitReached) {
                reason = 'retry_limit_reached';
            } else {
                action = 'retry';
                reason = 'auto_retry_failed';
            }
        } else if (state.status === 'interrupted' || state.status === 'suspended') {
            if (shouldSkipSuspendedApproval) {
                reason = 'awaiting_manual_approval';
            } else {
                action = 'resume';
                reason = 'auto_resume_interrupted';
            }
        } else {
            reason = 'status_not_recoverable';
        }

        const result: Record<string, unknown> = {
            taskId: state.taskId,
            statusBefore: state.status,
            action,
            reason,
            dryRun,
            checkpoint: checkpoint ?? null,
            checkpointVersion: input.resolveTaskCheckpointVersion(latestState),
        };
        const recoverAction: TaskRuntimeOperationAction | null = action === 'resume'
            ? 'recover_resume'
            : (action === 'retry' ? 'recover_retry' : null);
        const taskOperationId = recoverAction
            ? `${recoveryOperationId}:${state.taskId}:${recoverAction}`
            : null;
        if (taskOperationId && recoverAction) {
            result.operationId = taskOperationId;
            const dedupedOperation = input.findTaskOperationRecord(latestState, taskOperationId, [recoverAction]);
            if (dedupedOperation) {
                result.action = 'skip';
                result.reason = 'duplicate_operation';
                result.deduplicated = true;
                result.statusAfter = latestState.status;
                results.push(result);
                continue;
            }
        }
        if (action === 'skip' || dryRun) {
            results.push(result);
            continue;
        }

        try {
            if (action === 'resume') {
                const resumeState = input.taskStates.get(state.taskId) ?? state;
                const checkpointVersion = input.resolveTaskCheckpointVersion(resumeState);
                const operationRecord: TaskRuntimeOperationRecord = {
                    operationId: taskOperationId ?? `${recoveryOperationId}:${state.taskId}:recover_resume`,
                    action: 'recover_resume',
                    at: input.getNowIso(),
                    result: 'applied',
                    checkpointVersion,
                };
                const resumed = input.upsertTaskState(state.taskId, {
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    checkpointVersion,
                    operationLog: input.appendTaskOperationRecord(resumeState, operationRecord),
                });
                const resumeMessage = resumed.lastUserMessage ?? 'Continue from the saved task context.';
                input.appendTranscript(state.taskId, 'system', `Task auto-recovered by resume (${mode}).`);
                const recoveredExecutionPath = await input.executeTaskMessage({
                    taskId: state.taskId,
                    turnId: `${commandId}:${state.taskId}:recover_resume`,
                    message: resumeMessage,
                    resourceId: resumed.resourceId,
                    preferredThreadId: resumed.conversationThreadId,
                    workspacePath: resumed.workspacePath,
                    executionOptions: {
                        enabledSkills: resumed.enabledSkills,
                        executionPath: resumed.executionPath === 'direct' ? 'direct' : 'workflow',
                    },
                });
                if (recoveredExecutionPath !== resumed.executionPath) {
                    input.upsertTaskState(state.taskId, {
                        executionPath: recoveredExecutionPath,
                    });
                }
                result.statusAfter = input.taskStates.get(state.taskId)?.status ?? resumed.status;
                result.deduplicated = false;
                recoveredCount += 1;
                results.push(result);
                continue;
            }
            const nextAttempts = retry.attempts + 1;
            const retryMessage = state.lastUserMessage ?? 'Retry the last task context.';
            const retryState = input.taskStates.get(state.taskId) ?? state;
            const checkpointVersion = input.resolveTaskCheckpointVersion(retryState);
            const operationRecord: TaskRuntimeOperationRecord = {
                operationId: taskOperationId ?? `${recoveryOperationId}:${state.taskId}:recover_retry`,
                action: 'recover_retry',
                at: input.getNowIso(),
                result: 'applied',
                checkpointVersion,
                retryAttempts: nextAttempts,
            };
            const retried = input.upsertTaskState(state.taskId, {
                status: 'retrying',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
                checkpointVersion,
                lastUserMessage: retryMessage,
                retry: {
                    attempts: nextAttempts,
                    maxAttempts: retry.maxAttempts,
                    lastRetryAt: input.getNowIso(),
                    lastError: undefined,
                },
                operationLog: input.appendTaskOperationRecord(retryState, operationRecord),
            });
            input.appendTranscript(state.taskId, 'system', `Task auto-recovered by retry (${mode}), attempt ${nextAttempts}.`);
            input.emitTaskEvent(state.taskId, {
                type: 'retry',
                attempt: nextAttempts,
                maxAttempts: retried.retry?.maxAttempts ?? null,
                message: retryMessage,
                source: 'recover_tasks',
            });
            const recoveredExecutionPath = await input.executeTaskMessage({
                taskId: state.taskId,
                turnId: `${commandId}:${state.taskId}:recover_retry`,
                message: retryMessage,
                resourceId: retried.resourceId,
                preferredThreadId: retried.conversationThreadId,
                workspacePath: retried.workspacePath,
                executionOptions: {
                    enabledSkills: retried.enabledSkills,
                    executionPath: retried.executionPath === 'direct' ? 'direct' : 'workflow',
                },
            });
            if (recoveredExecutionPath !== retried.executionPath) {
                input.upsertTaskState(state.taskId, {
                    executionPath: recoveredExecutionPath,
                });
            }
            result.attempt = nextAttempts;
            result.statusAfter = input.taskStates.get(state.taskId)?.status ?? retried.status;
            result.deduplicated = false;
            recoveredCount += 1;
            results.push(result);
        } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            result.statusAfter = input.taskStates.get(state.taskId)?.status ?? state.status;
            results.push(result);
        }
    }
    input.emitFor('recover_tasks_response', {
        success: true,
        operationId: recoveryOperationId,
        mode,
        dryRun,
        count: results.length,
        recoveredCount,
        skippedCount: results.length - recoveredCount,
        items: results,
    });
    return true;
}
