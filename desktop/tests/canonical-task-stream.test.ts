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

    test('keeps streaming assistant buffers isolated across turnId boundaries without terminal events', () => {
        const state = applyEvents([
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'assistant-stream-shared',
                    taskId,
                    turnId: 'turn-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    sequence: 1,
                    sourceEventId: 'evt-turn1-delta1',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: '第一轮回复' },
                },
            },
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'assistant-stream-shared',
                    taskId,
                    turnId: 'turn-2',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:02.000Z',
                    sequence: 2,
                    sourceEventId: 'evt-turn2-delta1',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: '第二轮回复' },
                },
            },
        ]);

        expect(state.messages).toHaveLength(2);
        expect(state.messages[0]).toMatchObject({
            turnId: 'turn-1',
            status: 'streaming',
            parts: [{ type: 'text', text: '第一轮回复' }],
        });
        expect(state.messages[1]).toMatchObject({
            turnId: 'turn-2',
            status: 'streaming',
            parts: [{ type: 'text', text: '第二轮回复' }],
        });
    });

    test('merges retried stream deltas for the same turn even when message id changes', () => {
        const state = applyEvents([
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'stream-retry-1',
                    taskId,
                    turnId: 'turn-retry-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    sequence: 1,
                    correlationId: 'stream-retry-1',
                    sourceEventId: 'evt-retry-1',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: '当然可以，我先给你一版' },
                },
            },
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'stream-retry-2',
                    taskId,
                    turnId: 'turn-retry-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:01.000Z',
                    sequence: 2,
                    correlationId: 'stream-retry-2',
                    sourceEventId: 'evt-retry-2',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: '当然可以，我先给你一版“更像本人表达”的简洁日报' },
                },
            },
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'stream-retry-2',
                    taskId,
                    turnId: 'turn-retry-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:00:02.000Z',
                    sequence: 3,
                    correlationId: 'stream-retry-2',
                    sourceEventId: 'evt-retry-3',
                    sourceEventType: 'TEXT_DELTA',
                    part: { type: 'text', delta: '。' },
                },
            },
        ]);

        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            turnId: 'turn-retry-1',
            status: 'streaming',
            parts: [{ type: 'text', text: '当然可以，我先给你一版“更像本人表达”的简洁日报。' }],
        });
    });

    test('keeps only rewritten markdown variant when retried stream restarts with near-identical full body', () => {
        const state = applyEvents([
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'stream-rewrite-1',
                    taskId,
                    turnId: 'turn-rewrite-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:10:00.000Z',
                    sequence: 1,
                    correlationId: 'stream-rewrite-1',
                    sourceEventId: 'evt-rewrite-1',
                    sourceEventType: 'TEXT_DELTA',
                    part: {
                        type: 'text',
                        delta: '当然可以，我先给你一版更像本人表达的简洁日报：今日完成-推进重点事项；进行中-细节收尾；明日计划-继续推进。',
                    },
                },
            },
            {
                type: 'canonical_message_delta',
                payload: {
                    id: 'stream-rewrite-2',
                    taskId,
                    turnId: 'turn-rewrite-1',
                    role: 'assistant',
                    timestamp: '2026-03-27T10:10:01.000Z',
                    sequence: 2,
                    correlationId: 'stream-rewrite-2',
                    sourceEventId: 'evt-rewrite-2',
                    sourceEventType: 'TEXT_DELTA',
                    part: {
                        type: 'text',
                        delta: '当然可以，我先给你一版“更像本人表达”的简洁日报：\n\n**今日完成**\n- 推进重点事项\n\n**进行中**\n- 细节收尾\n\n**明日计划**\n- 继续推进',
                    },
                },
            },
        ]);

        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]?.parts).toEqual([
            {
                type: 'text',
                text: '当然可以，我先给你一版“更像本人表达”的简洁日报：\n\n**今日完成**\n- 推进重点事项\n\n**进行中**\n- 细节收尾\n\n**明日计划**\n- 继续推进',
            },
        ]);
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
