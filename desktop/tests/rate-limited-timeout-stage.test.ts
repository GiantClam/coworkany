import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { TaskSession } from '../src/types';

function makeSession(): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: 'task-timeout-stage',
        status: 'running',
        taskMode: 'chat',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events: [
            {
                id: 'event-user',
                taskId: 'task-timeout-stage',
                sequence: 1,
                type: 'CHAT_MESSAGE',
                timestamp: now,
                payload: {
                    role: 'user',
                    content: 'hello',
                },
            },
            {
                id: 'event-retry',
                taskId: 'task-timeout-stage',
                sequence: 2,
                type: 'RATE_LIMITED',
                timestamp: now,
                payload: {
                    message: 'Model startup delayed. Retrying (2/3)...',
                    stage: 'ttfb',
                    timings: {
                        elapsedMs: 1800,
                        ttfbMs: 1200,
                        firstTokenMs: null,
                        lastTokenMs: null,
                    },
                },
            },
        ],
        createdAt: now,
        updatedAt: now,
    };
}

describe('rate-limited timeout stage rendering', () => {
    test('shows timeout stage and timing telemetry in chat timeline runtime events', () => {
        const result = buildTimelineItems(makeSession());
        const assistantTurn = result.items.find((item) => item.type === 'assistant_turn');
        if (!assistantTurn || assistantTurn.type !== 'assistant_turn') {
            throw new Error('expected assistant_turn runtime event');
        }
        const systemEvents = assistantTurn.systemEvents ?? [];
        expect(systemEvents.some((line) => line.includes('Timeout stage: TTFB'))).toBe(true);
        expect(systemEvents.some((line) => line.includes('TTFB 1200ms'))).toBe(true);
        expect(systemEvents.some((line) => line.includes('DNS n/a'))).toBe(true);
    });
});

