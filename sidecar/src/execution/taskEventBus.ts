import { randomUUID } from 'crypto';
import type { TaskEvent } from '../protocol';

export type TaskStartedPayload = {
    title: string;
    description?: string;
    estimatedSteps?: number;
    context: {
        workspacePath?: string;
        activeFile?: string;
        userQuery: string;
        packageManager?: string;
        packageManagerCommands?: any;
    };
};

export type TaskFailedPayload = {
    error: string;
    errorCode?: string;
    recoverable: boolean;
    suggestion?: string;
};

export type TaskFinishedPayload = {
    summary: string;
    artifactsCreated?: string[];
    filesModified?: string[];
    duration: number;
};

export type TextDeltaPayload = {
    delta: string;
    role: 'assistant' | 'thinking';
};

export type TaskSuspendedPayload = {
    reason: string;
    userMessage: string;
    canAutoResume: boolean;
    maxWaitTimeMs?: number;
};

export type TaskResumedPayload = {
    resumeReason?: string;
    suspendDurationMs: number;
};

type TaskEventMeta = {
    timestamp?: string;
    sequence?: number;
};

export class TaskEventBus {
    private readonly sequences = new Map<string, number>();
    private readonly emitMessage: (event: TaskEvent) => void;

    constructor(input: {
        emit: (event: TaskEvent) => void;
    }) {
        this.emitMessage = input.emit;
    }

    reset(taskId: string, sequence: number = 0): void {
        this.sequences.set(taskId, sequence);
    }

    nextSequence(taskId: string): number {
        const current = this.sequences.get(taskId) ?? 0;
        const next = current + 1;
        this.sequences.set(taskId, next);
        return next;
    }

    started(taskId: string, payload: TaskStartedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_STARTED', payload, meta);
    }

    failed(taskId: string, payload: TaskFailedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_FAILED', payload, meta);
    }

    status(taskId: string, payload: { status: 'running' | 'failed' | 'idle' | 'finished' }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_STATUS', payload, meta);
    }

    clarificationRequired(taskId: string, payload: {
        reason?: string;
        questions: string[];
        missingFields?: string[];
    }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_CLARIFICATION_REQUIRED', payload, meta);
    }

    chatMessage(taskId: string, payload: { role: 'user' | 'assistant' | 'system'; content: string }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'CHAT_MESSAGE', payload, meta);
    }

    toolCall(taskId: string, payload: { id: string; name: string; input: any }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TOOL_CALL', payload, meta);
    }

    toolResult(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TOOL_RESULT', payload, meta);
    }

    finished(taskId: string, payload: TaskFinishedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_FINISHED', payload, meta);
    }

    textDelta(taskId: string, payload: TextDeltaPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TEXT_DELTA', payload, meta);
    }

    thinkingDelta(taskId: string, payload: { delta: string }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'THINKING_DELTA', payload, meta);
    }

    suspended(taskId: string, payload: TaskSuspendedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_SUSPENDED', payload, meta);
    }

    resumed(taskId: string, payload: TaskResumedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_RESUMED', payload, meta);
    }

    raw(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, type, payload, meta);
    }

    emit(event: TaskEvent): void {
        this.emitMessage(event);
    }

    emitStarted(taskId: string, payload: TaskStartedPayload, meta?: TaskEventMeta): void {
        this.emit(this.started(taskId, payload, meta));
    }

    emitFailed(taskId: string, payload: TaskFailedPayload, meta?: TaskEventMeta): void {
        this.emit(this.failed(taskId, payload, meta));
    }

    emitStatus(taskId: string, payload: { status: 'running' | 'failed' | 'idle' | 'finished' }, meta?: TaskEventMeta): void {
        this.emit(this.status(taskId, payload, meta));
    }

    emitClarificationRequired(taskId: string, payload: {
        reason?: string;
        questions: string[];
        missingFields?: string[];
    }, meta?: TaskEventMeta): void {
        this.emit(this.clarificationRequired(taskId, payload, meta));
    }

    emitChatMessage(taskId: string, payload: { role: 'user' | 'assistant' | 'system'; content: string }, meta?: TaskEventMeta): void {
        this.emit(this.chatMessage(taskId, payload, meta));
    }

    emitToolCall(taskId: string, payload: { id: string; name: string; input: any }, meta?: TaskEventMeta): void {
        this.emit(this.toolCall(taskId, payload, meta));
    }

    emitToolResult(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }, meta?: TaskEventMeta): void {
        this.emit(this.toolResult(taskId, payload, meta));
    }

    emitFinished(taskId: string, payload: TaskFinishedPayload, meta?: TaskEventMeta): void {
        this.emit(this.finished(taskId, payload, meta));
    }

    emitTextDelta(taskId: string, payload: TextDeltaPayload, meta?: TaskEventMeta): void {
        this.emit(this.textDelta(taskId, payload, meta));
    }

    emitThinkingDelta(taskId: string, payload: { delta: string }, meta?: TaskEventMeta): void {
        this.emit(this.thinkingDelta(taskId, payload, meta));
    }

    emitSuspended(taskId: string, payload: TaskSuspendedPayload, meta?: TaskEventMeta): void {
        this.emit(this.suspended(taskId, payload, meta));
    }

    emitResumed(taskId: string, payload: TaskResumedPayload, meta?: TaskEventMeta): void {
        this.emit(this.resumed(taskId, payload, meta));
    }

    emitRaw(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): void {
        this.emit(this.raw(taskId, type, payload, meta));
    }

    private build(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): TaskEvent {
        return {
            id: randomUUID(),
            taskId,
            timestamp: meta?.timestamp ?? new Date().toISOString(),
            sequence: this.resolveSequence(taskId, meta?.sequence),
            type,
            payload,
        } as TaskEvent;
    }

    private resolveSequence(taskId: string, override?: number): number {
        if (override === undefined) {
            return this.nextSequence(taskId);
        }
        const current = this.sequences.get(taskId) ?? 0;
        if (override > current) {
            this.sequences.set(taskId, override);
        }
        return override;
    }
}
