import type { RuntimeFailureClassification } from './runtimeErrorClassifier';
import type { TaskRuntimeExecutionPath, TaskRuntimeState } from './taskRuntimeState';

export type MissingToolEvidenceRetryReason =
    | 'missing_tool_evidence'
    | 'command_failure'
    | 'missing_terminal_event';

type TaskTurnCommandRecoveryHint = {
    failedCommand: string;
    retryCommands: string[];
    probeCommands: string[];
    suggestedFix?: string;
    stderrSnippet?: string;
    toolName?: string;
};

type TaskTurnCommandFailureInfo = {
    failedCommand?: string;
    stderrSnippet?: string;
    exitCode?: number;
    toolName?: string;
};

export type MissingToolEvidenceRetryInput = {
    taskId: string;
    turnEventStateKey: string;
    turnId?: string;
    traceId?: string | null;
    requiredCapabilities: string[];
    source: 'complete' | 'error';
    reason?: MissingToolEvidenceRetryReason;
    runId?: string;
};

type RetryExecutionOptionsFactory<ExecutionOptions> = (state: TaskRuntimeState) => ExecutionOptions;

type CreateMissingToolEvidenceAutoRetryRunnerInput<ExecutionOptions> = {
    missingToolEvidenceAutoRetryByTurnKey: Set<string>;
    taskStates: Map<string, TaskRuntimeState>;
    commandExecutionCapability: string;
    resolveMissingToolEvidenceAutoRetryMaxAttempts: () => number;
    resolveMissingToolEvidenceRetryFloor: (requiredCapabilities: string[]) => number;
    resolveAdaptiveMissingToolEvidenceRetryMaxAttempts: (input: {
        configuredMaxAttempts: number;
        currentAttempts: number;
        lastError?: string;
        requiredCapabilities: string[];
    }) => number;
    resolveMissingToolEvidenceAutoRetryDelayMs: () => number;
    hasTaskTurnAssistantNarrative: (key: string) => boolean;
    getTaskTurnObservedToolNames: (key: string) => string[];
    getTaskTurnMissingRequiredCompletionCapabilities: (key: string) => string[];
    getTaskTurnRequiredCompletionCapabilities: (key: string) => string[];
    getTaskTurnCommandRecoveryHint: (
        key: string,
        taskId?: string,
    ) => TaskTurnCommandRecoveryHint | undefined;
    getTaskTurnCommandFailureInfo: (
        key: string,
        taskId?: string,
    ) => TaskTurnCommandFailureInfo | undefined;
    getTaskTurnResultAttemptedCompletionCapabilities: (key: string) => string[];
    buildMissingToolEvidenceRetryMessage: (input: {
        message: string;
        requiredCapabilities: string[];
        source: 'complete' | 'error';
        reason?: MissingToolEvidenceRetryReason;
        commandRecoveryHint?: TaskTurnCommandRecoveryHint;
    }) => string;
    upsertTaskState: (taskId: string, patch: Partial<TaskRuntimeState>) => TaskRuntimeState;
    getNowIso: () => string;
    resetTaskTurnAttemptStreamState: (key: string) => void;
    clearPendingApprovalsForTask: (taskId: string) => void;
    emitTaskEvent: (event: {
        type: 'RATE_LIMITED' | 'TASK_FAILED';
        taskId: string;
        payload: Record<string, unknown>;
    }) => void;
    buildRetryExecutionOptionsFromTaskState: RetryExecutionOptionsFactory<ExecutionOptions>;
    createId: () => string;
    enqueueTaskExecution: (input: {
        taskId: string;
        turnId: string;
        run: () => Promise<TaskRuntimeExecutionPath>;
    }) => {
        queuePosition: number;
        completion: Promise<TaskRuntimeExecutionPath>;
    };
    executeTaskMessage: (input: {
        taskId: string;
        turnId: string;
        message: string;
        resourceId: string;
        preferredThreadId: string;
        workspacePath?: string;
        executionOptions?: ExecutionOptions;
    }) => Promise<TaskRuntimeExecutionPath>;
    classifyRuntimeErrorMessage: (message: string) => RuntimeFailureClassification;
    hasTaskTurnTerminalEvent: (key: string) => boolean;
    markTaskTurnTerminalEvent: (key: string, terminal: 'complete' | 'error' | 'tripwire') => void;
};

export function createMissingToolEvidenceAutoRetryRunner<ExecutionOptions>(
    deps: CreateMissingToolEvidenceAutoRetryRunnerInput<ExecutionOptions>,
): (input: MissingToolEvidenceRetryInput) => boolean {
    return (retryInput) => {
        const turnRetryKey = `${retryInput.turnEventStateKey}:missing-tool-evidence`;
        if (deps.missingToolEvidenceAutoRetryByTurnKey.has(turnRetryKey)) {
            return true;
        }

        const existingState = deps.taskStates.get(retryInput.taskId);
        if (!existingState) {
            return false;
        }

        const baseRetryMessage = typeof existingState.lastUserMessage === 'string'
            ? existingState.lastUserMessage.trim()
            : '';
        if (baseRetryMessage.length === 0) {
            return false;
        }

        const envMaxAttempts = deps.resolveMissingToolEvidenceAutoRetryMaxAttempts();
        const currentAttempts = Math.max(0, existingState.retry?.attempts ?? 0);

        const hasActionableProgressSignal = deps.hasTaskTurnAssistantNarrative(retryInput.turnEventStateKey)
            || deps.getTaskTurnObservedToolNames(retryInput.turnEventStateKey).length > 0;
        const missingCapabilitiesForTurn = deps.getTaskTurnMissingRequiredCompletionCapabilities(
            retryInput.turnEventStateKey,
        );
        const requiredCapabilitiesForTurn = deps.getTaskTurnRequiredCompletionCapabilities(
            retryInput.turnEventStateKey,
        );
        const commandRecoveryHint = deps.getTaskTurnCommandRecoveryHint(
            retryInput.turnEventStateKey,
            retryInput.taskId,
        );
        const commandFailureInfo = deps.getTaskTurnCommandFailureInfo(
            retryInput.turnEventStateKey,
            retryInput.taskId,
        );
        const retryFloorCapabilities = missingCapabilitiesForTurn.length > 0
            ? missingCapabilitiesForTurn
            : retryInput.requiredCapabilities;
        const attemptedCapabilitiesForTurn = deps.getTaskTurnResultAttemptedCompletionCapabilities(
            retryInput.turnEventStateKey,
        );
        const attemptedRetryFloorCapability = attemptedCapabilitiesForTurn.some((capability) => (
            retryFloorCapabilities.includes(capability)
        ));
        const hasAnyRequiredCapability = requiredCapabilitiesForTurn.length > 0;
        const canApplyProtocolSafetyFloor = retryInput.source === 'complete'
            && hasActionableProgressSignal
            && hasAnyRequiredCapability
            && !attemptedRetryFloorCapability;
        const hasCommandFailureSignal = Boolean(commandFailureInfo || commandRecoveryHint);
        const canApplyErrorRecoveryFloor = retryInput.source === 'error'
            && retryInput.requiredCapabilities.includes(deps.commandExecutionCapability)
            && retryInput.reason === 'command_failure'
            && hasCommandFailureSignal;
        const canApplyMissingEvidenceErrorFloor = retryInput.source === 'error'
            && retryInput.reason === 'missing_tool_evidence'
            && retryInput.requiredCapabilities.length > 0
            && !attemptedRetryFloorCapability;
        const implicitRetryFloor = canApplyProtocolSafetyFloor
            ? deps.resolveMissingToolEvidenceRetryFloor(retryFloorCapabilities)
            : (canApplyErrorRecoveryFloor || canApplyMissingEvidenceErrorFloor ? 1 : 0);

        const configuredRetryCapFromState = existingState.retry?.maxAttempts;
        const configuredMaxAttempts = configuredRetryCapFromState === 0
            ? implicitRetryFloor
            : Math.max(
                0,
                configuredRetryCapFromState ?? envMaxAttempts,
                implicitRetryFloor,
            );
        const maxAttempts = deps.resolveAdaptiveMissingToolEvidenceRetryMaxAttempts({
            configuredMaxAttempts,
            currentAttempts,
            lastError: existingState.retry?.lastError,
            requiredCapabilities: retryInput.requiredCapabilities,
        });

        const nextAttempts = currentAttempts + 1;
        if (maxAttempts <= 0 || nextAttempts > maxAttempts) {
            return false;
        }

        const retryDelayMs = deps.resolveMissingToolEvidenceAutoRetryDelayMs();
        const retryMessage = deps.buildMissingToolEvidenceRetryMessage({
            message: baseRetryMessage,
            requiredCapabilities: retryInput.requiredCapabilities,
            source: retryInput.source,
            reason: retryInput.reason,
            commandRecoveryHint,
        });
        const retryReason = retryInput.reason === 'command_failure'
            ? 'retryable_command_failure'
            : 'complete_without_required_tool_evidence';
        const retryStatusMessage = retryInput.reason === 'command_failure'
            ? `命令步骤失败，正在仅重试失败步骤 (${nextAttempts}/${maxAttempts})...`
            : `缺少工具证据，正在自动重试 (${nextAttempts}/${maxAttempts})...`;

        const updatedState = deps.upsertTaskState(retryInput.taskId, {
            status: 'retrying',
            suspended: false,
            suspensionReason: undefined,
            checkpoint: undefined,
            retry: {
                attempts: nextAttempts,
                maxAttempts,
                lastRetryAt: deps.getNowIso(),
                lastError: retryReason,
            },
        });

        deps.resetTaskTurnAttemptStreamState(retryInput.turnEventStateKey);
        deps.clearPendingApprovalsForTask(retryInput.taskId);
        deps.missingToolEvidenceAutoRetryByTurnKey.add(turnRetryKey);

        deps.emitTaskEvent({
            type: 'RATE_LIMITED',
            taskId: retryInput.taskId,
            payload: {
                message: retryStatusMessage,
                attempt: nextAttempts,
                maxRetries: maxAttempts,
                retryAfterMs: retryDelayMs,
                error: retryReason,
                stage: 'unknown',
                requiredCapabilities: retryInput.requiredCapabilities,
                source: retryInput.source,
                traceId: retryInput.traceId ?? null,
                turnId: retryInput.turnId,
            },
        });

        const executionOptions = deps.buildRetryExecutionOptionsFromTaskState(updatedState);
        const retryTurnId = retryInput.turnId ?? `auto-retry:${deps.createId()}`;
        const queueExecution = deps.enqueueTaskExecution({
            taskId: retryInput.taskId,
            turnId: retryTurnId,
            run: async () => {
                deps.missingToolEvidenceAutoRetryByTurnKey.delete(turnRetryKey);
                if (retryDelayMs > 0) {
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, retryDelayMs);
                    });
                }
                return await deps.executeTaskMessage({
                    taskId: retryInput.taskId,
                    turnId: retryTurnId,
                    message: retryMessage,
                    resourceId: updatedState.resourceId,
                    preferredThreadId: updatedState.conversationThreadId,
                    workspacePath: updatedState.workspacePath,
                    executionOptions,
                });
            },
        });

        void queueExecution.completion
            .then((executionPath) => {
                if (executionPath !== updatedState.executionPath) {
                    deps.upsertTaskState(retryInput.taskId, {
                        executionPath,
                    });
                }
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                const classification = deps.classifyRuntimeErrorMessage(message);
                const adaptiveMaxAttempts = deps.resolveAdaptiveMissingToolEvidenceRetryMaxAttempts({
                    configuredMaxAttempts: maxAttempts,
                    currentAttempts: nextAttempts,
                    lastError: message,
                    requiredCapabilities: retryInput.requiredCapabilities,
                });
                if (!deps.hasTaskTurnTerminalEvent(retryInput.turnEventStateKey)) {
                    deps.markTaskTurnTerminalEvent(retryInput.turnEventStateKey, 'error');
                    deps.upsertTaskState(retryInput.taskId, {
                        status: 'failed',
                        suspended: false,
                        suspensionReason: undefined,
                        checkpoint: undefined,
                        retry: {
                            attempts: nextAttempts,
                            maxAttempts: adaptiveMaxAttempts,
                            lastRetryAt: deps.getNowIso(),
                            lastError: message,
                        },
                    });
                    deps.emitTaskEvent({
                        type: 'TASK_FAILED',
                        taskId: retryInput.taskId,
                        payload: {
                            error: message,
                            errorCode: classification.errorCode,
                            recoverable: classification.recoverable,
                            suggestion: classification.suggestion,
                            failureClass: classification.failureClass,
                            traceId: retryInput.traceId ?? null,
                            turnId: retryInput.turnId,
                        },
                    });
                }
            })
            .finally(() => {
                deps.missingToolEvidenceAutoRetryByTurnKey.delete(turnRetryKey);
            });

        return true;
    };
}
