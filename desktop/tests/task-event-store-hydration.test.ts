import { afterEach, describe, expect, test } from 'bun:test';
import { useTaskEventStore } from '../src/stores/taskEvents';
import type { TaskSession } from '../src/types';

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'running',
        planSteps: overrides.planSteps ?? [],
        toolCalls: overrides.toolCalls ?? [],
        effects: overrides.effects ?? [],
        patches: overrides.patches ?? [],
        messages: overrides.messages ?? [],
        events: overrides.events ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        summary: overrides.summary,
        title: overrides.title,
        suspension: overrides.suspension,
        failure: overrides.failure,
        workspacePath: overrides.workspacePath,
    };
}

afterEach(() => {
    useTaskEventStore.getState().reset();
});

describe('task event store hydration', () => {
    test('converts stale running sessions into recoverable interrupted failures', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-interrupted',
                    status: 'running',
                    title: 'Long task',
                }),
            ],
            activeTaskId: 'task-interrupted',
        });

        const session = useTaskEventStore.getState().getSession('task-interrupted');

        expect(session?.status).toBe('failed');
        expect(session?.summary).toContain('Resume the task');
        expect(session?.failure).toEqual({
            error: 'Task interrupted by app restart',
            errorCode: 'INTERRUPTED',
            recoverable: true,
            suggestion: 'Resume the task to continue from the saved context.',
        });
    });

    test('does not rewrite suspended sessions during hydration', () => {
        useTaskEventStore.getState().hydrate({
            sessions: [
                makeSession({
                    taskId: 'task-suspended',
                    status: 'running',
                    suspension: {
                        reason: 'authentication_required',
                        userMessage: 'Please log in.',
                        canAutoResume: false,
                    },
                }),
            ],
            activeTaskId: 'task-suspended',
        });

        const session = useTaskEventStore.getState().getSession('task-suspended');

        expect(session?.status).toBe('running');
        expect(session?.failure).toBeUndefined();
        expect(session?.suspension?.reason).toBe('authentication_required');
    });
});
