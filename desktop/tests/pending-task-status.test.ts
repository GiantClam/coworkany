import { describe, expect, test } from 'bun:test';
import type { TaskEvent, TaskSession } from '../src/types';
import { getPendingTaskStatus } from '../src/components/Chat/Timeline/pendingTaskStatus';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_STARTED',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(events: TaskEvent[]): TaskSession {
    return {
        taskId: 'task-1',
        status: 'running',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

describe('getPendingTaskStatus', () => {
    test('shows waiting_for_model before first assistant response', () => {
        const session = makeSession([
            makeEvent({
                type: 'TASK_STARTED',
                payload: {
                    title: 'Test',
                    context: { userQuery: 'hello' },
                },
            }),
        ]);

        expect(getPendingTaskStatus(session)).toEqual({ phase: 'waiting_for_model' });
    });

    test('shows running_tool when a tool is still in flight before assistant text', () => {
        const session = makeSession([
            makeEvent({
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: { role: 'user', content: 'search docs' },
            }),
            makeEvent({
                sequence: 2,
                type: 'TOOL_CALLED',
                payload: { toolId: 'tool-1', toolName: 'search_web', args: {} },
            }),
        ]);

        expect(getPendingTaskStatus(session)).toEqual({ phase: 'running_tool', toolName: 'search_web' });
    });

    test('shows retrying when rate limited before assistant text', () => {
        const session = makeSession([
            makeEvent({
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: { role: 'user', content: 'hello' },
            }),
            makeEvent({
                sequence: 2,
                type: 'RATE_LIMITED',
                payload: { message: 'retry later' },
            }),
        ]);

        expect(getPendingTaskStatus(session)).toEqual({ phase: 'retrying' });
    });

    test('clears pending state once assistant text starts streaming', () => {
        const session = makeSession([
            makeEvent({
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: { role: 'user', content: 'hello' },
            }),
            makeEvent({
                sequence: 2,
                type: 'TEXT_DELTA',
                payload: { role: 'assistant', delta: 'Hi' },
            }),
        ]);

        expect(getPendingTaskStatus(session)).toBeNull();
    });
});
