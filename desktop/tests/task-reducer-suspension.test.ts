import { describe, expect, test } from 'bun:test';
import type { TaskEvent, TaskSession } from '../src/types';
import { applyTaskEvent } from '../src/stores/taskEvents/reducers/taskReducer';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_SUSPENDED',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(): TaskSession {
    return {
        taskId: 'task-1',
        status: 'running',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

describe('task reducer suspension handling', () => {
    test('stores suspension state and appends one system message', () => {
        const event = makeEvent({
            payload: {
                reason: 'authentication_required',
                userMessage: 'Please log in to continue.',
                canAutoResume: false,
                maxWaitTimeMs: 300000,
            },
        });

        const next = applyTaskEvent(makeSession(), event);

        expect(next.status).toBe('idle');
        expect(next.suspension?.reason).toBe('authentication_required');
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0]?.content).toBe('Please log in to continue.');
    });

    test('does not append duplicate system message for replayed suspension event', () => {
        const event = makeEvent({
            payload: {
                reason: 'authentication_required',
                userMessage: 'Please log in to continue.',
                canAutoResume: false,
                maxWaitTimeMs: 300000,
            },
        });

        const once = applyTaskEvent(makeSession(), event);
        const replayed = applyTaskEvent(once, makeEvent({
            sequence: 2,
            payload: event.payload,
        }));

        expect(replayed.status).toBe('idle');
        expect(replayed.suspension?.reason).toBe('authentication_required');
        expect(replayed.messages).toHaveLength(1);
    });

    test('stores recoverable failure metadata from TASK_FAILED', () => {
        const next = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_FAILED',
            payload: {
                error: 'Task interrupted by sidecar restart',
                errorCode: 'INTERRUPTED',
                recoverable: true,
                suggestion: 'Resume the task to continue from the saved context.',
            },
        }));

        expect(next.status).toBe('failed');
        expect(next.failure).toEqual({
            error: 'Task interrupted by sidecar restart',
            errorCode: 'INTERRUPTED',
            recoverable: true,
            suggestion: 'Resume the task to continue from the saved context.',
        });
        expect(next.messages.at(-1)?.content).toContain('Resume the task');
    });

    test('clears failure metadata when task resumes running', () => {
        const failed = applyTaskEvent(makeSession(), makeEvent({
            type: 'TASK_FAILED',
            payload: {
                error: 'Task interrupted by sidecar restart',
                errorCode: 'INTERRUPTED',
                recoverable: true,
            },
        }));

        const resumed = applyTaskEvent(failed, makeEvent({
            sequence: 2,
            type: 'TASK_RESUMED',
            payload: {},
        }));

        expect(resumed.status).toBe('running');
        expect(resumed.failure).toBeUndefined();
    });
});
