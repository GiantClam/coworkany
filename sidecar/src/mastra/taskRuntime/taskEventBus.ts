import { randomUUID } from 'crypto';
import {
    createInitialTaskProtocolStateSnapshot,
    reduceTaskProtocolState,
    type TaskProtocolStateSnapshot,
} from './taskProtocolStateMachine';

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

function clonePayload(payload: TaskEventPayload): TaskEventPayload {
    return { ...payload };
}

export class TaskEventBus {
    private readonly emitEvent: (event: TaskEventEnvelope) => void;
    private readonly nextSequenceByTaskId = new Map<string, number>();
    private readonly protocolStateByTaskId = new Map<string, TaskProtocolStateSnapshot>();

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
        const reduction = reduceTaskProtocolState(state, {
            type,
            payload,
        });
        const nextType = reduction.violation?.rewriteType ?? type;
        const nextPayload = reduction.violation
            ? clonePayload(reduction.violation.payload)
            : clonePayload(payload);

        this.protocolStateByTaskId.set(taskId, reduction.nextState);
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

    private getOrCreateTaskState(taskId: string): TaskProtocolStateSnapshot {
        return this.protocolStateByTaskId.get(taskId) ?? createInitialTaskProtocolStateSnapshot();
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
