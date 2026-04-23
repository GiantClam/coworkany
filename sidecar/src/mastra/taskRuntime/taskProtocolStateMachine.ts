type TaskEventPayload = Record<string, unknown>;

export type TaskProtocolTerminalState = 'none' | 'finished' | 'failed';

export type TaskProtocolStateSnapshot = {
    pendingBlockingAction: boolean;
    pendingBlockingUserActions: number;
    terminal: TaskProtocolTerminalState;
    stateVersion: number;
};

export type TaskProtocolEvent = {
    type: string;
    payload: TaskEventPayload;
};

export type TaskProtocolViolationCode = 'E_PROTOCOL_TERMINAL_CONFLICT' | 'E_PROTOCOL_INVALID_TRANSITION';

export type TaskProtocolViolation = {
    code: TaskProtocolViolationCode;
    message: string;
    recoverable: boolean;
    rewriteType: 'TASK_FAILED';
    payload: TaskEventPayload;
};

export type TaskProtocolReduction = {
    nextState: TaskProtocolStateSnapshot;
    violation?: TaskProtocolViolation;
};

export function createInitialTaskProtocolStateSnapshot(): TaskProtocolStateSnapshot {
    return {
        pendingBlockingAction: false,
        pendingBlockingUserActions: 0,
        terminal: 'none',
        stateVersion: 0,
    };
}

function normalizeNonNegativeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
}

function normalizeSnapshot(snapshot?: TaskProtocolStateSnapshot): TaskProtocolStateSnapshot {
    const base = snapshot ?? createInitialTaskProtocolStateSnapshot();
    const pendingBlockingUserActions = normalizeNonNegativeInteger(base.pendingBlockingUserActions);
    const terminal = base.terminal === 'finished' || base.terminal === 'failed'
        ? base.terminal
        : 'none';
    const stateVersion = normalizeNonNegativeInteger(base.stateVersion);
    const pendingBlockingAction = base.pendingBlockingAction === true || pendingBlockingUserActions > 0;
    return {
        pendingBlockingAction,
        pendingBlockingUserActions,
        terminal,
        stateVersion,
    };
}

function clearPendingBlockingActions(snapshot: TaskProtocolStateSnapshot): void {
    snapshot.pendingBlockingAction = false;
    snapshot.pendingBlockingUserActions = 0;
}

function buildViolation(violation: {
    code: TaskProtocolViolationCode;
    message: string;
    recoverable: boolean;
}): TaskProtocolViolation {
    return {
        ...violation,
        rewriteType: 'TASK_FAILED',
        payload: {
            error: violation.message,
            errorCode: violation.code,
            recoverable: violation.recoverable,
        },
    };
}

function markFailed(snapshot: TaskProtocolStateSnapshot): void {
    clearPendingBlockingActions(snapshot);
    snapshot.terminal = 'failed';
}

export function reduceTaskProtocolState(
    snapshot: TaskProtocolStateSnapshot | undefined,
    event: TaskProtocolEvent,
): TaskProtocolReduction {
    const nextState = normalizeSnapshot(snapshot);
    nextState.stateVersion += 1;

    let violation: TaskProtocolViolation | undefined;
    if (event.type === 'TASK_USER_ACTION_REQUIRED') {
        if (nextState.terminal !== 'none') {
            violation = buildViolation({
                code: 'E_PROTOCOL_INVALID_TRANSITION',
                message: 'invalid_task_protocol_transition',
                recoverable: false,
            });
            markFailed(nextState);
        } else if (event.payload.blocking === true) {
            nextState.pendingBlockingUserActions += 1;
            nextState.pendingBlockingAction = true;
        }
    } else if (event.type === 'TASK_STATUS') {
        if (event.payload.status === 'running') {
            clearPendingBlockingActions(nextState);
        }
    } else if (event.type === 'TASK_FINISHED') {
        if (nextState.pendingBlockingAction) {
            violation = buildViolation({
                code: 'E_PROTOCOL_TERMINAL_CONFLICT',
                message: 'task_finished_while_user_action_pending',
                recoverable: true,
            });
            markFailed(nextState);
        } else {
            clearPendingBlockingActions(nextState);
            nextState.terminal = 'finished';
        }
    } else if (event.type === 'TASK_FAILED') {
        markFailed(nextState);
    }

    if (nextState.pendingBlockingUserActions === 0) {
        nextState.pendingBlockingAction = false;
    }

    return {
        nextState,
        violation,
    };
}
