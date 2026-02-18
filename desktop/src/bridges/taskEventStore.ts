import type { TaskEvent } from '../../../sidecar/src/protocol';
import { applyTaskEvent, createEmptyTaskState, type TaskUiState } from './taskEvents';

export type TaskStateListener = (state: TaskUiState, event: TaskEvent) => void;

export class TaskEventStore {
    private readonly states = new Map<string, TaskUiState>();
    private readonly listeners = new Set<TaskStateListener>();

    get(taskId: string): TaskUiState {
        const existing = this.states.get(taskId);
        if (existing) return existing;
        const fresh = createEmptyTaskState(taskId);
        this.states.set(taskId, fresh);
        return fresh;
    }

    apply(event: TaskEvent): TaskUiState {
        const current = this.get(event.taskId);
        const next = applyTaskEvent(current, event);
        this.states.set(event.taskId, next);
        for (const listener of this.listeners) {
            listener(next, event);
        }
        return next;
    }

    subscribe(listener: TaskStateListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
