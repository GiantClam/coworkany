import { describe, expect, test } from 'bun:test';
import type { TaskEvent } from '../src/protocol';
import { taskEventToCanonicalStreamEvents } from '../src/protocol';

function makeTextDeltaEvent(
    payload: Record<string, unknown>,
    overrides: Partial<TaskEvent> = {},
): TaskEvent {
    return {
        id: overrides.id ?? 'evt-1',
        timestamp: overrides.timestamp ?? '2026-03-31T00:00:00.000Z',
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: 'TEXT_DELTA',
        payload,
    };
}

describe('taskEventToCanonicalStreamEvents', () => {
    test('maps TEXT_DELTA payload.delta to canonical message delta', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({ role: 'assistant', delta: '你好' }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message_delta',
            payload: {
                taskId: 'task-1',
                sourceEventType: 'TEXT_DELTA',
                part: {
                    type: 'text',
                    delta: '你好',
                },
            },
        });
    });

    test('prefers payload.delta over legacy content/text fields', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({
                role: 'assistant',
                delta: 'from-delta',
                content: 'from-content',
                text: 'from-text',
            }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message_delta',
            payload: {
                part: {
                    type: 'text',
                    delta: 'from-delta',
                },
            },
        });
    });

    test('drops empty TEXT_DELTA payloads', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({ role: 'assistant' }),
        );
        expect(canonicalEvents).toEqual([]);
    });
});
