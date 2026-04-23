export type TaskTurnCommandRecoveryHint = {
    failedCommand: string;
    retryCommands: string[];
    probeCommands: string[];
    suggestedFix?: string;
    stderrSnippet?: string;
    toolName?: string;
};

export type TaskTurnCommandFailureInfo = {
    failedCommand?: string;
    stderrSnippet?: string;
    exitCode?: number;
    toolName?: string;
};

export type TaskTurnTerminalType = 'complete' | 'error' | 'tripwire';

export type TaskTurnEventState = {
    assistantNarrativeSeen: boolean;
    assistantNarrativeChars: number;
    toolEvidenceSeen: boolean;
    strongToolEvidenceSeen: boolean;
    toolResultSeen: boolean;
    satisfiedCompletionCapabilities: string[];
    resultAttemptedCompletionCapabilities: string[];
    observedToolNames: string[];
    requireToolEvidenceForCompletion: boolean;
    requiredCompletionCapabilities: string[];
    turnContractHash?: string;
    turnContractDomain?: string;
    routeMode?: 'chat' | 'task';
    executionPath?: 'direct' | 'workflow';
    primaryNarrativeRunId?: string;
    lastAssistantChunkFingerprint?: string;
    lastCommandInvocation?: string;
    latestCommandRecoveryHint?: TaskTurnCommandRecoveryHint;
    latestCommandFailureInfo?: TaskTurnCommandFailureInfo;
    commandFailureNarrativeEmitted?: boolean;
    terminal?: TaskTurnTerminalType;
    updatedAtMs: number;
};

type CreateTaskTurnEventStateStoreInput = {
    taskTurnEventStates: Map<string, TaskTurnEventState>;
    latestCommandInvocationByTaskId: Map<string, string>;
    latestCommandRecoveryHintByTaskId: Map<string, TaskTurnCommandRecoveryHint>;
    latestCommandFailureInfoByTaskId: Map<string, TaskTurnCommandFailureInfo>;
    taskTurnEventStateTtlMs: number;
    maxTaskTurnEventStates: number;
    taskExecutionNarrationMaxSuppressChars: number;
    normalizeStringList: (value: string[]) => string[];
    normalizeTaskMessageFingerprint: (value: string) => string;
    isLikelyTaskMetaReasoningChunk: (value: string) => boolean;
    isLikelyTaskExecutionNarrationChunk: (value: string) => boolean;
    nowMs?: () => number;
};

export function createTaskTurnEventStateStore(input: CreateTaskTurnEventStateStoreInput) {
    const nowMs = input.nowMs ?? (() => Date.now());

    const pruneTaskTurnEventStates = (currentNowMs: number): void => {
        for (const [key, state] of input.taskTurnEventStates.entries()) {
            if (currentNowMs - state.updatedAtMs > input.taskTurnEventStateTtlMs) {
                input.taskTurnEventStates.delete(key);
            }
        }
        if (input.taskTurnEventStates.size <= input.maxTaskTurnEventStates) {
            return;
        }
        const oldest = [...input.taskTurnEventStates.entries()]
            .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs)
            .slice(0, input.taskTurnEventStates.size - input.maxTaskTurnEventStates);
        for (const [key] of oldest) {
            input.taskTurnEventStates.delete(key);
        }
    };

    const getTaskTurnEventState = (
        key: string,
        currentNowMs: number,
    ): TaskTurnEventState => {
        const existing = input.taskTurnEventStates.get(key);
        if (existing) {
            const updated = {
                ...existing,
                updatedAtMs: currentNowMs,
            };
            input.taskTurnEventStates.set(key, updated);
            return updated;
        }
        const created: TaskTurnEventState = {
            assistantNarrativeSeen: false,
            assistantNarrativeChars: 0,
            toolEvidenceSeen: false,
            strongToolEvidenceSeen: false,
            toolResultSeen: false,
            satisfiedCompletionCapabilities: [],
            resultAttemptedCompletionCapabilities: [],
            observedToolNames: [],
            requireToolEvidenceForCompletion: false,
            requiredCompletionCapabilities: [],
            commandFailureNarrativeEmitted: false,
            updatedAtMs: currentNowMs,
        };
        input.taskTurnEventStates.set(key, created);
        return created;
    };

    const buildTaskTurnEventStateKey = (stateInput: {
        taskId: string;
        turnId?: string;
        runId?: string;
    }): string => {
        const turnPart = (stateInput.turnId && stateInput.turnId.trim().length > 0)
            ? stateInput.turnId.trim()
            : (
                stateInput.runId && stateInput.runId.trim().length > 0
                    ? `run:${stateInput.runId.trim()}`
                    : 'unknown'
            );
        return `${stateInput.taskId}:${turnPart}`;
    };

    const setTaskTurnCompletionRequirement = (stateInput: {
        key: string;
        requireToolEvidence: boolean;
        requiredCompletionCapabilities?: string[];
        turnContractHash?: string;
        turnContractDomain?: string;
        routeMode?: 'chat' | 'task';
        executionPath?: 'direct' | 'workflow';
    }): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        const normalizedContractHash = typeof stateInput.turnContractHash === 'string' && stateInput.turnContractHash.trim().length > 0
            ? stateInput.turnContractHash.trim()
            : undefined;
        const shouldKeepExistingLock = Boolean(
            state.turnContractHash
            && normalizedContractHash
            && state.turnContractHash !== normalizedContractHash,
        );
        if (shouldKeepExistingLock) {
            console.warn('[MastraEntrypoint] Ignoring turn-contract drift for in-flight turn', {
                key: stateInput.key,
                existingContractHash: state.turnContractHash,
                incomingContractHash: normalizedContractHash,
            });
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            requireToolEvidenceForCompletion: stateInput.requireToolEvidence,
            requiredCompletionCapabilities: input.normalizeStringList(stateInput.requiredCompletionCapabilities ?? []),
            turnContractHash: shouldKeepExistingLock
                ? state.turnContractHash
                : normalizedContractHash ?? state.turnContractHash,
            turnContractDomain: shouldKeepExistingLock
                ? state.turnContractDomain
                : stateInput.turnContractDomain ?? state.turnContractDomain,
            routeMode: shouldKeepExistingLock
                ? state.routeMode
                : stateInput.routeMode ?? state.routeMode,
            executionPath: shouldKeepExistingLock
                ? state.executionPath
                : stateInput.executionPath ?? state.executionPath,
            updatedAtMs: currentNowMs,
        });
    };

    const markTaskTurnAssistantNarrative = (stateInput: {
        key: string;
        content?: string;
    }): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        const deltaChars = typeof stateInput.content === 'string' ? stateInput.content.trim().length : 0;
        const nextChars = state.assistantNarrativeChars + deltaChars;
        const nextSeen = state.assistantNarrativeSeen || deltaChars > 0;
        if (state.assistantNarrativeSeen === nextSeen && state.assistantNarrativeChars === nextChars) {
            return;
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            assistantNarrativeSeen: nextSeen,
            assistantNarrativeChars: nextChars,
            updatedAtMs: currentNowMs,
        });
    };

    const claimTaskTurnPrimaryNarrativeRun = (stateInput: {
        key: string;
        runId: string;
    }): boolean => {
        const normalizedRunId = stateInput.runId.trim();
        if (normalizedRunId.length === 0) {
            return true;
        }
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        if (state.primaryNarrativeRunId && state.primaryNarrativeRunId !== normalizedRunId) {
            return false;
        }
        if (state.primaryNarrativeRunId === normalizedRunId) {
            return true;
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            primaryNarrativeRunId: normalizedRunId,
            updatedAtMs: currentNowMs,
        });
        return true;
    };

    const shouldSuppressTaskTurnAssistantChunk = (stateInput: {
        key: string;
        chunk: string;
    }): boolean => {
        const normalizedChunk = input.normalizeTaskMessageFingerprint(stateInput.chunk);
        if (normalizedChunk.length < 24) {
            return false;
        }
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        if (state.lastAssistantChunkFingerprint === normalizedChunk) {
            return true;
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            lastAssistantChunkFingerprint: normalizedChunk,
            updatedAtMs: currentNowMs,
        });
        return false;
    };

    const hasTaskTurnAssistantNarrative = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return getTaskTurnEventState(key, currentNowMs).assistantNarrativeSeen;
    };

    const getTaskTurnAssistantNarrativeChars = (key: string): number => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return getTaskTurnEventState(key, currentNowMs).assistantNarrativeChars;
    };

    const markTaskTurnToolEvidence = (stateInput: {
        key: string;
        evidenceStrength?: 'weak' | 'strong';
        toolName?: string;
        satisfiedCompletionCapabilities?: string[];
        resultAttemptedCompletionCapabilities?: string[];
        toolResultSeen?: boolean;
    }): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        const evidenceStrength = stateInput.evidenceStrength ?? 'weak';
        const normalizedToolName = typeof stateInput.toolName === 'string' ? stateInput.toolName.trim() : '';
        const normalizedSatisfied = input.normalizeStringList(
            (stateInput.satisfiedCompletionCapabilities ?? []).map((value) => value.toLowerCase()),
        );
        const normalizedResultAttempted = input.normalizeStringList(
            (stateInput.resultAttemptedCompletionCapabilities ?? []).map((value) => value.toLowerCase()),
        );
        const nextObservedToolNames = normalizedToolName.length > 0
            ? input.normalizeStringList([...state.observedToolNames, normalizedToolName])
            : state.observedToolNames;
        const nextSatisfiedCompletionCapabilities = normalizedSatisfied.length > 0
            ? input.normalizeStringList([...state.satisfiedCompletionCapabilities, ...normalizedSatisfied])
            : state.satisfiedCompletionCapabilities;
        const nextResultAttemptedCompletionCapabilities = normalizedResultAttempted.length > 0
            ? input.normalizeStringList([...state.resultAttemptedCompletionCapabilities, ...normalizedResultAttempted])
            : state.resultAttemptedCompletionCapabilities;
        const nextToolResultSeen = state.toolResultSeen || stateInput.toolResultSeen === true;
        const shouldMarkWeakEvidence = !state.toolEvidenceSeen;
        const shouldMarkStrongEvidence = evidenceStrength === 'strong' && !state.strongToolEvidenceSeen;
        const shouldUpdateObservedToolNames = nextObservedToolNames.length !== state.observedToolNames.length;
        const shouldUpdateSatisfiedCapabilities = nextSatisfiedCompletionCapabilities.length !== state.satisfiedCompletionCapabilities.length;
        const shouldUpdateResultAttempts = nextResultAttemptedCompletionCapabilities.length !== state.resultAttemptedCompletionCapabilities.length;
        const shouldUpdateToolResultSeen = nextToolResultSeen !== state.toolResultSeen;
        if (
            !shouldMarkWeakEvidence
            && !shouldMarkStrongEvidence
            && !shouldUpdateObservedToolNames
            && !shouldUpdateSatisfiedCapabilities
            && !shouldUpdateResultAttempts
            && !shouldUpdateToolResultSeen
        ) {
            return;
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            toolEvidenceSeen: true,
            strongToolEvidenceSeen: state.strongToolEvidenceSeen || evidenceStrength === 'strong',
            toolResultSeen: nextToolResultSeen,
            observedToolNames: nextObservedToolNames,
            satisfiedCompletionCapabilities: nextSatisfiedCompletionCapabilities,
            resultAttemptedCompletionCapabilities: nextResultAttemptedCompletionCapabilities,
            updatedAtMs: currentNowMs,
        });
    };

    const markTaskTurnCommandInvocation = (stateInput: {
        key: string;
        taskId?: string;
        command: string;
    }): void => {
        const normalizedCommand = stateInput.command.trim();
        if (normalizedCommand.length === 0) {
            return;
        }
        if (stateInput.taskId && stateInput.taskId.trim().length > 0) {
            input.latestCommandInvocationByTaskId.set(stateInput.taskId, normalizedCommand);
        }
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        if (state.lastCommandInvocation === normalizedCommand) {
            return;
        }
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            lastCommandInvocation: normalizedCommand,
            updatedAtMs: currentNowMs,
        });
    };

    const markTaskTurnCommandRecoveryHint = (stateInput: {
        key: string;
        taskId?: string;
        hint: TaskTurnCommandRecoveryHint;
    }): void => {
        if (stateInput.taskId && stateInput.taskId.trim().length > 0) {
            input.latestCommandRecoveryHintByTaskId.set(stateInput.taskId, stateInput.hint);
        }
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            latestCommandRecoveryHint: stateInput.hint,
            updatedAtMs: currentNowMs,
        });
    };

    const markTaskTurnCommandFailureInfo = (stateInput: {
        key: string;
        taskId?: string;
        info: TaskTurnCommandFailureInfo;
    }): void => {
        if (stateInput.taskId && stateInput.taskId.trim().length > 0) {
            input.latestCommandFailureInfoByTaskId.set(stateInput.taskId, stateInput.info);
        }
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        input.taskTurnEventStates.set(stateInput.key, {
            ...state,
            latestCommandFailureInfo: stateInput.info,
            updatedAtMs: currentNowMs,
        });
    };

    const markTaskTurnCommandFailureNarrativeEmitted = (key: string): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        if (state.commandFailureNarrativeEmitted) {
            return;
        }
        input.taskTurnEventStates.set(key, {
            ...state,
            commandFailureNarrativeEmitted: true,
            updatedAtMs: currentNowMs,
        });
    };

    const hasTaskTurnCommandFailureNarrativeEmitted = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return getTaskTurnEventState(key, currentNowMs).commandFailureNarrativeEmitted === true;
    };

    const getTaskTurnCommandRecoveryHint = (
        key: string,
        taskId?: string,
    ): TaskTurnCommandRecoveryHint | undefined => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const perTurn = getTaskTurnEventState(key, currentNowMs).latestCommandRecoveryHint;
        if (perTurn) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return input.latestCommandRecoveryHintByTaskId.get(taskId);
        }
        return undefined;
    };

    const getTaskTurnCommandFailureInfo = (
        key: string,
        taskId?: string,
    ): TaskTurnCommandFailureInfo | undefined => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const perTurn = getTaskTurnEventState(key, currentNowMs).latestCommandFailureInfo;
        if (perTurn) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return input.latestCommandFailureInfoByTaskId.get(taskId);
        }
        return undefined;
    };

    const getTaskLatestCommandInvocation = (key: string, taskId?: string): string | undefined => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const perTurn = getTaskTurnEventState(key, currentNowMs).lastCommandInvocation;
        if (typeof perTurn === 'string' && perTurn.trim().length > 0) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return input.latestCommandInvocationByTaskId.get(taskId);
        }
        return undefined;
    };

    const hasTaskTurnToolEvidenceRequirement = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return getTaskTurnEventState(key, currentNowMs).requireToolEvidenceForCompletion;
    };

    const getTaskTurnRequiredCompletionCapabilities = (key: string): string[] => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return [...getTaskTurnEventState(key, currentNowMs).requiredCompletionCapabilities];
    };

    const getTaskTurnMissingRequiredCompletionCapabilities = (key: string): string[] => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        const satisfied = new Set(state.satisfiedCompletionCapabilities.map((value) => value.toLowerCase()));
        return state.requiredCompletionCapabilities
            .map((value) => value.toLowerCase())
            .filter((capability) => !satisfied.has(capability));
    };

    const getTaskTurnResultAttemptedCompletionCapabilities = (key: string): string[] => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return [...getTaskTurnEventState(key, currentNowMs).resultAttemptedCompletionCapabilities];
    };

    const hasTaskTurnSatisfiedCompletionEvidence = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        if (!state.requireToolEvidenceForCompletion) {
            return true;
        }
        if (state.requiredCompletionCapabilities.length === 0) {
            return state.strongToolEvidenceSeen;
        }
        return getTaskTurnMissingRequiredCompletionCapabilities(key).length === 0;
    };

    const getTaskTurnObservedToolNames = (key: string): string[] => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return [...getTaskTurnEventState(key, currentNowMs).observedToolNames];
    };

    const hasTaskTurnToolResultEvidence = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        return getTaskTurnEventState(key, currentNowMs).toolResultSeen;
    };

    const getTaskTurnRouteMode = (key: string): 'chat' | 'task' | undefined => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const routeMode = getTaskTurnEventState(key, currentNowMs).routeMode;
        return routeMode === 'chat' || routeMode === 'task'
            ? routeMode
            : undefined;
    };

    const getTaskTurnContractDomain = (key: string): string | undefined => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const domain = getTaskTurnEventState(key, currentNowMs).turnContractDomain;
        if (typeof domain !== 'string') {
            return undefined;
        }
        const normalized = domain.trim().toLowerCase();
        return normalized.length > 0 ? normalized : undefined;
    };

    const shouldSuppressTaskTurnExecutionNarrationChunk = (stateInput: {
        key: string;
        chunk: string;
    }): boolean => {
        const normalized = stateInput.chunk.trim();
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(stateInput.key, currentNowMs);
        if (state.routeMode !== 'task') {
            return false;
        }
        if (state.assistantNarrativeSeen || state.toolEvidenceSeen) {
            return false;
        }
        if (input.isLikelyTaskMetaReasoningChunk(normalized)) {
            return true;
        }
        if (
            normalized.length > input.taskExecutionNarrationMaxSuppressChars
            || !input.isLikelyTaskExecutionNarrationChunk(normalized)
        ) {
            return false;
        }
        return true;
    };

    const hasTaskTurnTerminalEvent = (key: string): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        return typeof state.terminal === 'string';
    };

    const shouldSuppressTaskTurnTerminalEvent = (
        key: string,
        nextTerminal: TaskTurnTerminalType,
    ): boolean => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        const currentTerminal = state.terminal;
        if (!currentTerminal) {
            return false;
        }
        if (currentTerminal === nextTerminal) {
            return true;
        }
        if (currentTerminal === 'complete') {
            return true;
        }
        if (nextTerminal === 'complete') {
            return false;
        }
        return true;
    };

    const markTaskTurnTerminalEvent = (
        key: string,
        terminal: TaskTurnTerminalType,
    ): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        input.taskTurnEventStates.set(key, {
            ...state,
            terminal,
            updatedAtMs: currentNowMs,
        });
    };

    const resetTaskTurnAttemptStreamState = (key: string): void => {
        const currentNowMs = nowMs();
        pruneTaskTurnEventStates(currentNowMs);
        const state = getTaskTurnEventState(key, currentNowMs);
        input.taskTurnEventStates.set(key, {
            ...state,
            assistantNarrativeSeen: false,
            assistantNarrativeChars: 0,
            toolEvidenceSeen: false,
            strongToolEvidenceSeen: false,
            toolResultSeen: false,
            satisfiedCompletionCapabilities: [],
            resultAttemptedCompletionCapabilities: [],
            observedToolNames: [],
            primaryNarrativeRunId: undefined,
            lastAssistantChunkFingerprint: undefined,
            commandFailureNarrativeEmitted: false,
            terminal: undefined,
            updatedAtMs: currentNowMs,
        });
    };

    return {
        buildTaskTurnEventStateKey,
        setTaskTurnCompletionRequirement,
        markTaskTurnAssistantNarrative,
        claimTaskTurnPrimaryNarrativeRun,
        shouldSuppressTaskTurnAssistantChunk,
        hasTaskTurnAssistantNarrative,
        getTaskTurnAssistantNarrativeChars,
        markTaskTurnToolEvidence,
        markTaskTurnCommandInvocation,
        markTaskTurnCommandRecoveryHint,
        markTaskTurnCommandFailureInfo,
        markTaskTurnCommandFailureNarrativeEmitted,
        hasTaskTurnCommandFailureNarrativeEmitted,
        getTaskTurnCommandRecoveryHint,
        getTaskTurnCommandFailureInfo,
        getTaskLatestCommandInvocation,
        hasTaskTurnToolEvidenceRequirement,
        getTaskTurnRequiredCompletionCapabilities,
        getTaskTurnMissingRequiredCompletionCapabilities,
        getTaskTurnResultAttemptedCompletionCapabilities,
        hasTaskTurnSatisfiedCompletionEvidence,
        getTaskTurnObservedToolNames,
        hasTaskTurnToolResultEvidence,
        getTaskTurnRouteMode,
        getTaskTurnContractDomain,
        shouldSuppressTaskTurnExecutionNarrationChunk,
        hasTaskTurnTerminalEvent,
        shouldSuppressTaskTurnTerminalEvent,
        markTaskTurnTerminalEvent,
        resetTaskTurnAttemptStreamState,
    };
}
