import { describe, expect, test } from 'bun:test';
import { isConversationTurnLocked } from '../src/components/Chat/turnTaking';
import type { TaskSession } from '../src/types';

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = '2026-03-27T10:00:00.000Z';
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'idle',
        taskMode: overrides.taskMode,
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
        workspacePath: overrides.workspacePath,
        failure: overrides.failure,
        isDraft: overrides.isDraft,
    };
}

describe('isConversationTurnLocked', () => {
    test('locks the main composer while the assistant turn is running', () => {
        expect(isConversationTurnLocked(makeSession({ status: 'running' }))).toBe(true);
    });

    test('keeps the composer available for idle clarification turns', () => {
        expect(isConversationTurnLocked(makeSession({ status: 'idle' }))).toBe(false);
    });

    test('does not lock draft sessions', () => {
        expect(isConversationTurnLocked(makeSession({ status: 'running', isDraft: true }))).toBe(false);
    });
});
