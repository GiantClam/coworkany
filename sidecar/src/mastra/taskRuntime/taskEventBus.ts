import { randomUUID } from 'crypto';

type TaskEventPayload = Record<string, unknown>;

export type TaskEventEnvelope = {
    id: string;
    taskId: string;
    sequence: number;
    type: string;
    timestamp: string;
    payload: TaskEventPayload;
};

type EmitOptions = {
    sequence?: number;
};

type BusDeps = {
    emit: (event: TaskEventEnvelope) => void;
};

type TaskProtocolState = {
    pendingBlockingAction: boolean;
    terminal: 'none' | 'finished' | 'failed';
};

const TERMINAL_CONFLICT_ERROR_PAYLOAD: TaskEventPayload = {
    error: 'task_finished_while_user_action_pending',
    errorCode: 'E_PROTOCOL_TERMINAL_CONFLICT',
    recoverable: true,
};

const INVALID_TRANSITION_ERROR_PAYLOAD: TaskEventPayload = {
    error: 'invalid_task_protocol_transition',
    errorCode: 'E_PROTOCOL_INVALID_TRANSITION',
    recoverable: false,
};

function clonePayload(payload: TaskEventPayload): TaskEventPayload {
    return { ...payload };
}

export class TaskEventBus {
    private readonly emitEvent: (event: TaskEventEnvelope) => void;
    private readonly nextSequenceByTaskId = new Map<string, number>();
    private readonly protocolStateByTaskId = new Map<string, TaskProtocolState>();

    constructor(deps: BusDeps) {
        this.emitEvent = deps.emit;
    }

    reset(taskId: string): void {
        this.nextSequenceByTaskId.delete(taskId);
        this.protocolStateByTaskId.delete(taskId);
    }

    emitRaw(
        taskId: string,
        type: string,
        payload: TaskEventPayload,
        options?: EmitOptions,
    ): void {
        this.emitWithProtocolChecks(taskId, type, payload, options);
    }

    emitChatMessage(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'CHAT_MESSAGE', payload, options);
    }

    emitTextDelta(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TEXT_DELTA', payload, options);
    }

    emitStatus(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_STATUS', payload, options);
    }

    emitUserActionRequired(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_USER_ACTION_REQUIRED', payload, options);
    }

    emitFinished(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_FINISHED', payload, options);
    }

    emitFailed(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_FAILED', payload, options);
    }

    emitContractReopened(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_CONTRACT_REOPENED', payload, options);
    }

    emitPlanReady(taskId: string, payload: TaskEventPayload, options?: EmitOptions): void {
        this.emitWithProtocolChecks(taskId, 'TASK_PLAN_READY', payload, options);
    }

    private emitWithProtocolChecks(
        taskId: string,
        type: string,
        payload: TaskEventPayload,
        options?: EmitOptions,
    ): void {
        const state = this.getOrCreateTaskState(taskId);
        let nextType = type;
        let nextPayload = clonePayload(payload);

        if (nextType === 'TASK_USER_ACTION_REQUIRED') {
            if (state.terminal !== 'none') {
                nextType = 'TASK_FAILED';
                nextPayload = clonePayload(INVALID_TRANSITION_ERROR_PAYLOAD);
                state.pendingBlockingAction = false;
                state.terminal = 'failed';
            } else if (nextPayload.blocking === true) {
                state.pendingBlockingAction = true;
            }
        } else if (nextType === 'TASK_STATUS') {
            if (nextPayload.status === 'running') {
                state.pendingBlockingAction = false;
            }
        } else if (nextType === 'TASK_FINISHED') {
            if (state.pendingBlockingAction) {
                nextType = 'TASK_FAILED';
                nextPayload = clonePayload(TERMINAL_CONFLICT_ERROR_PAYLOAD);
                state.pendingBlockingAction = false;
                state.terminal = 'failed';
            } else {
                state.pendingBlockingAction = false;
                state.terminal = 'finished';
            }
        } else if (nextType === 'TASK_FAILED') {
            state.pendingBlockingAction = false;
            state.terminal = 'failed';
        }

        this.protocolStateByTaskId.set(taskId, state);
        const sequence = this.allocateSequence(taskId, options?.sequence);
        this.emitEvent({
            id: randomUUID(),
            taskId,
            sequence,
            type: nextType,
            timestamp: new Date().toISOString(),
            payload: nextPayload,
        });
    }

    private getOrCreateTaskState(taskId: string): TaskProtocolState {
        return this.protocolStateByTaskId.get(taskId) ?? {
            pendingBlockingAction: false,
            terminal: 'none',
        };
    }

    private allocateSequence(taskId: string, forcedSequence?: number): number {
        const nextSequence = this.nextSequenceByTaskId.get(taskId) ?? 1;
        if (typeof forcedSequence === 'number' && Number.isFinite(forcedSequence) && forcedSequence >= 0) {
            const value = Math.floor(forcedSequence);
            if (value >= nextSequence) {
                this.nextSequenceByTaskId.set(taskId, value + 1);
            }
            return value;
        }
        this.nextSequenceByTaskId.set(taskId, nextSequence + 1);
        return nextSequence;
    }
}
