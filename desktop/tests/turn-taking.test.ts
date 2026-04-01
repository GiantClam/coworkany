import { describe, expect, test } from 'bun:test';
import { isConversationTurnLocked, TURN_LOCK_IDLE_GRACE_MS } from '../src/components/Chat/turnTaking';
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
        const now = Date.parse('2026-03-27T10:00:00.500Z');
        expect(
            isConversationTurnLocked(
                makeSession({
                    status: 'running',
                    updatedAt: '2026-03-27T10:00:00.000Z',
                }),
                { phase: 'waiting_for_model' },
                now,
            ),
        ).toBe(true);
    });

    test('keeps the composer available for idle clarification turns', () => {
        expect(isConversationTurnLocked(makeSession({ status: 'idle' }))).toBe(false);
    });

    test('does not lock draft sessions', () => {
        expect(isConversationTurnLocked(makeSession({ status: 'running', isDraft: true }))).toBe(false);
    });

    test('unlocks stale running sessions after idle grace when pending status is unknown', () => {
        const locked = isConversationTurnLocked(
            makeSession({
                status: 'running',
                updatedAt: '2026-03-27T10:00:00.000Z',
            }),
            null,
            Date.parse('2026-03-27T10:00:00.800Z'),
        );
        const unlocked = isConversationTurnLocked(
            makeSession({
                status: 'running',
                updatedAt: '2026-03-27T10:00:00.000Z',
            }),
            null,
            Date.parse('2026-03-27T10:00:00.000Z') + TURN_LOCK_IDLE_GRACE_MS + 50,
        );
        expect(locked).toBe(true);
        expect(unlocked).toBe(false);
    });
});
