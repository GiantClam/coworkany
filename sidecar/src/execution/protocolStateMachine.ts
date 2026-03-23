import { z } from 'zod';

export type ProtocolTaskState =
    | 'draft'
    | 'planned'
    | 'running'
    | 'replanning'
    | 'verifying'
    | 'waiting_user_action'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type ProtocolErrorCode =
    | 'E_PROTOCOL_UNPLANNED_USER_ACTION'
    | 'E_PROTOCOL_MISSING_GROUNDED_EVIDENCE'
    | 'E_PROTOCOL_CONTRACT_UNMET'
    | 'E_PROTOCOL_TERMINAL_CONFLICT'
    | 'E_PROTOCOL_INVALID_TRANSITION'
    | 'E_PROTOCOL_STALE_VERSION';

export type TaskProtocolSnapshot = {
    state: ProtocolTaskState;
    stateVersion: number;
    pendingBlockingActionIds: string[];
};

export type ProtocolViolation = {
    errorCode: ProtocolErrorCode;
    message: string;
    suggestion?: string;
    fromState: ProtocolTaskState;
    eventType: string;
};

export type ProtocolReductionResult =
    | {
        ok: true;
        snapshot: TaskProtocolSnapshot;
    }
    | {
        ok: false;
        snapshot: TaskProtocolSnapshot;
        violation: ProtocolViolation;
    };

const LifecycleEventTypeSet = new Set([
    'TASK_STARTED',
    'TASK_STATUS',
    'TASK_PLAN_READY',
    'TASK_CONTRACT_REOPENED',
    'TASK_CLARIFICATION_REQUIRED',
    'TASK_USER_ACTION_REQUIRED',
    'TASK_RESUMED',
    'TASK_FINISHED',
    'TASK_FAILED',
]);

const TerminalStateSet = new Set<ProtocolTaskState>(['completed', 'failed', 'cancelled']);

const EvidenceSourceSchema = z.object({
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    path: z.string().optional(),
    uri: z.string().optional(),
    command: z.string().optional(),
    exitCode: z.number().int().optional(),
});

const EvidenceGroundingSchema = z.object({
    level: z.enum(['grounded', 'metadata', 'none']),
    targets: z.array(z.string()),
    hash: z.string().optional(),
});

export const ExecutionEvidenceRecordSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    stepId: z.string().optional(),
    collectedAt: z.string().datetime(),
    type: z.enum(['tool_result', 'command_output', 'file_snapshot', 'artifact', 'web_source', 'user_confirmation']),
    source: EvidenceSourceSchema,
    grounding: EvidenceGroundingSchema,
    summary: z.string(),
    excerpt: z.string().optional(),
    claims: z.array(z.string()),
    confidence: z.number().min(0).max(1),
});

export type ExecutionEvidenceRecord = z.infer<typeof ExecutionEvidenceRecordSchema>;

export function createInitialTaskProtocolSnapshot(): TaskProtocolSnapshot {
    return {
        state: 'draft',
        stateVersion: 0,
        pendingBlockingActionIds: [],
    };
}

export function toTaskFailedPayloadFromProtocolViolation(violation: ProtocolViolation): {
    error: string;
    errorCode: ProtocolErrorCode;
    recoverable: boolean;
    suggestion?: string;
} {
    return {
        error: `Protocol violation: ${violation.message}`,
        errorCode: violation.errorCode,
        recoverable: false,
        suggestion: violation.suggestion,
    };
}

export function reduceTaskProtocolState(
    snapshot: TaskProtocolSnapshot,
    input: { type: string; payload: unknown }
): ProtocolReductionResult {
    if (!LifecycleEventTypeSet.has(input.type)) {
        return {
            ok: true,
            snapshot,
        };
    }

    const from = snapshot;
    const nextBase: TaskProtocolSnapshot = {
        ...from,
        pendingBlockingActionIds: [...from.pendingBlockingActionIds],
    };

    if (
        TerminalStateSet.has(from.state) &&
        input.type !== 'TASK_STATUS' &&
        input.type !== 'TASK_FAILED' &&
        input.type !== 'TASK_FINISHED' &&
        input.type !== 'TASK_CONTRACT_REOPENED' &&
        input.type !== 'TASK_PLAN_READY'
    ) {
        return {
            ok: false,
            snapshot: from,
            violation: {
                errorCode: 'E_PROTOCOL_INVALID_TRANSITION',
                message: `Cannot apply ${input.type} after terminal state ${from.state}.`,
                suggestion: 'Start a new task or re-open contract before emitting new lifecycle events.',
                fromState: from.state,
                eventType: input.type,
            },
        };
    }

    const consumePendingAndEnterRunning = () => {
        nextBase.pendingBlockingActionIds = [];
        nextBase.state = 'running';
    };

    const enterWaitingForAction = (actionId: string) => {
        if (!nextBase.pendingBlockingActionIds.includes(actionId)) {
            nextBase.pendingBlockingActionIds.push(actionId);
        }
        nextBase.state = 'waiting_user_action';
    };

    const hasBlockingPendingActions = nextBase.pendingBlockingActionIds.length > 0;

    switch (input.type) {
        case 'TASK_STARTED': {
            if (from.state === 'draft') {
                nextBase.state = 'planned';
            }
            break;
        }
        case 'TASK_PLAN_READY': {
            const payload = (input.payload ?? {}) as {
                userActionsRequired?: Array<{ id?: string; blocking?: boolean }>;
            };
            nextBase.state = 'planned';
            nextBase.pendingBlockingActionIds = [];
            for (const action of payload.userActionsRequired ?? []) {
                if (action.blocking === true && typeof action.id === 'string' && action.id.trim()) {
                    enterWaitingForAction(action.id);
                }
            }
            break;
        }
        case 'TASK_CONTRACT_REOPENED': {
            nextBase.state = 'replanning';
            break;
        }
        case 'TASK_CLARIFICATION_REQUIRED': {
            enterWaitingForAction('clarification_required');
            break;
        }
        case 'TASK_USER_ACTION_REQUIRED': {
            const payload = (input.payload ?? {}) as { actionId?: string; blocking?: boolean };
            const actionId = typeof payload.actionId === 'string' && payload.actionId.trim().length > 0
                ? payload.actionId
                : `manual_action_${from.stateVersion + 1}`;
            if (from.state === 'completed') {
                return {
                    ok: false,
                    snapshot: from,
                    violation: {
                        errorCode: 'E_PROTOCOL_TERMINAL_CONFLICT',
                        message: 'Task already completed but a blocking user action was requested.',
                        suggestion: 'Do not emit user action requests after completion. Re-open contract if new blockers appear.',
                        fromState: from.state,
                        eventType: input.type,
                    },
                };
            }
            if (payload.blocking === true) {
                enterWaitingForAction(actionId);
            }
            break;
        }
        case 'TASK_RESUMED': {
            consumePendingAndEnterRunning();
            break;
        }
        case 'TASK_STATUS': {
            const payload = (input.payload ?? {}) as { status?: string };
            switch (payload.status) {
                case 'running':
                    consumePendingAndEnterRunning();
                    break;
                case 'idle':
                    nextBase.state = nextBase.pendingBlockingActionIds.length > 0
                        ? 'waiting_user_action'
                        : 'planned';
                    break;
                case 'finished':
                    if (hasBlockingPendingActions || from.state === 'waiting_user_action') {
                        return {
                            ok: false,
                            snapshot: from,
                            violation: {
                                errorCode: 'E_PROTOCOL_TERMINAL_CONFLICT',
                                message: 'Cannot mark task finished while blocking user action is still pending.',
                                suggestion: 'Resolve pending user action first, then emit running/finished.',
                                fromState: from.state,
                                eventType: input.type,
                            },
                        };
                    }
                    nextBase.pendingBlockingActionIds = [];
                    nextBase.state = 'completed';
                    break;
                case 'failed':
                    nextBase.pendingBlockingActionIds = [];
                    nextBase.state = 'failed';
                    break;
                default:
                    break;
            }
            break;
        }
        case 'TASK_FINISHED': {
            if (from.state === 'failed' || from.state === 'cancelled') {
                return {
                    ok: false,
                    snapshot: from,
                    violation: {
                        errorCode: 'E_PROTOCOL_INVALID_TRANSITION',
                        message: `Cannot emit TASK_FINISHED after terminal state ${from.state}.`,
                        suggestion: 'Keep terminal events consistent: failed/cancelled tasks must not transition to finished.',
                        fromState: from.state,
                        eventType: input.type,
                    },
                };
            }
            if (hasBlockingPendingActions || from.state === 'waiting_user_action') {
                return {
                    ok: false,
                    snapshot: from,
                    violation: {
                        errorCode: 'E_PROTOCOL_TERMINAL_CONFLICT',
                        message: 'Cannot emit TASK_FINISHED while blocking user action is pending.',
                        suggestion: 'Resolve pending user action before completion.',
                        fromState: from.state,
                        eventType: input.type,
                    },
                };
            }
            nextBase.pendingBlockingActionIds = [];
            nextBase.state = 'completed';
            break;
        }
        case 'TASK_FAILED': {
            nextBase.pendingBlockingActionIds = [];
            nextBase.state = 'failed';
            break;
        }
        default:
            break;
    }

    return {
        ok: true,
        snapshot: {
            ...nextBase,
            stateVersion: from.stateVersion + 1,
        },
    };
}
