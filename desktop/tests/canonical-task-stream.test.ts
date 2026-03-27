import { describe, expect, test } from 'bun:test';
import type { CanonicalStreamEvent } from '../../sidecar/src/protocol';
import {
    applyCanonicalStreamEvent,
    createEmptyCanonicalTaskStreamState,
} from '../src/bridges/canonicalTaskStream';

const taskId = '22222222-2222-4222-8222-222222222222';

function applyEvents(events: CanonicalStreamEvent[]) {
    return events.reduce(
        (state, event) => applyCanonicalStreamEvent(state, event),
        createEmptyCanonicalTaskStreamState(taskId),
    );
}

describe('canonical task stream bridge', () => {
    test('coalesces assistant text deltas into a streaming message', () => {
        const state = applyEvents([
            {
                type: 'canonical_message_delta',
                payload: {
                    id: `stream:${taskId}:assistant`,
                    taskId,
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    sequence: 1,
                    correlationId: `stream:${taskId}:assistant`,
                    sourceEventId: 'evt-1',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: 'Hello' },
                },
            },
            {
                type: 'canonical_message_delta',
                payload: {
                    id: `stream:${taskId}:assistant`,
                    taskId,
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:01.000Z',
                    sequence: 2,
                    correlationId: `stream:${taskId}:assistant`,
                    sourceEventId: 'evt-2',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: ' world' },
                },
            },
        ]);

        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            id: `stream:${taskId}:assistant`,
            status: 'streaming',
            parts: [{ type: 'text', text: 'Hello world' }],
        });
    });

    test('replaces the streaming placeholder with the final assistant message', () => {
        const state = applyEvents([
            {
                type: 'canonical_message_delta',
                payload: {
                    id: `stream:${taskId}:assistant`,
                    taskId,
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    sequence: 1,
                    correlationId: `stream:${taskId}:assistant`,
                    sourceEventId: 'evt-1',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: 'Draft' },
                },
            },
            {
                type: 'canonical_message',
                payload: {
                    id: 'evt-final',
                    taskId,
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:02.000Z',
                    sequence: 3,
                    correlationId: `stream:${taskId}:assistant`,
                    sourceEventId: 'evt-final',
                    sourceEventType: 'CHAT_MESSAGE',
                    status: 'complete',
                    parts: [{ type: 'text', text: 'Final answer' }],
                },
            },
        ]);

        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            id: 'evt-final',
            status: 'complete',
            parts: [{ type: 'text', text: 'Final answer' }],
        });
    });

    test('keeps independent runtime messages alongside assistant content', () => {
        const state = applyEvents([
            {
                type: 'canonical_message',
                payload: {
                    id: 'evt-status',
                    taskId,
                    role: 'runtime',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    sequence: 1,
                    sourceEventId: 'evt-status',
                    sourceEventType: 'TASK_STATUS',
                    status: 'complete',
                    parts: [{ type: 'status', status: 'running' }],
                },
            },
            {
                type: 'canonical_message',
                payload: {
                    id: 'evt-tool',
                    taskId,
                    role: 'runtime',
                    timestamp: '2026-03-27T10:00:01.000Z',
                    sequence: 2,
                    sourceEventId: 'evt-tool',
                    sourceEventType: 'TOOL_CALLED',
                    status: 'complete',
                    parts: [{ type: 'tool-call', toolId: 'tool-1', toolName: 'search' }],
                },
            },
        ]);

        expect(state.messages.map((message) => message.id)).toEqual(['evt-status', 'evt-tool']);
        expect(state.messages[1]?.parts[0]).toMatchObject({
            type: 'tool-call',
            toolId: 'tool-1',
            toolName: 'search',
        });
    });
});
