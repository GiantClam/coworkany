import { describe, expect, test } from 'bun:test';
import {
    extractMastraTokenUsageEvent,
    mapMastraChunkToDesktopEvent,
} from '../src/ipc/bridge';

describe('ipc bridge', () => {
    test('extracts token usage from finish chunk payload', () => {
        const event = extractMastraTokenUsageEvent({
            type: 'finish',
            payload: {
                modelId: 'openai/gpt-5',
                usage: {
                    inputTokens: 11,
                    outputTokens: 13,
                    totalTokens: 24,
                },
            },
        }, 'run-1');

        expect(event).toBeDefined();
        expect(event?.type).toBe('token_usage');
        expect(event?.runId).toBe('run-1');
        expect(event?.modelId).toBe('openai/gpt-5');
        expect(event?.provider).toBe('openai');
        if (!event || event.type !== 'token_usage') {
            throw new Error('expected token_usage event');
        }
        expect(event.usage.inputTokens).toBe(11);
        expect(event.usage.outputTokens).toBe(13);
        expect(event.usage.totalTokens).toBe(24);
    });

    test('maps text-delta chunks to desktop text_delta event', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            payload: { text: 'hello' },
        }, 'run-2');

        expect(event).toEqual({
            type: 'text_delta',
            content: 'hello',
            runId: 'run-2',
        });
    });

    test('maps tool-call-approval chunks to approval_required event', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-call-approval',
            payload: {
                toolCallId: 'call-1',
                toolName: 'exec_shell',
                args: { command: 'echo hi' },
                resumeSchema: '{"type":"object"}',
            },
        }, 'run-3');

        expect(event).toEqual({
            type: 'approval_required',
            runId: 'run-3',
            toolCallId: 'call-1',
            toolName: 'exec_shell',
            args: { command: 'echo hi' },
            resumeSchema: '{"type":"object"}',
        });
    });

    test('maps finish chunk to complete event', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'finish',
            payload: { finishReason: 'stop' },
        }, 'run-4');

        expect(event).toEqual({
            type: 'complete',
            runId: 'run-4',
            finishReason: 'stop',
        });
    });
});
