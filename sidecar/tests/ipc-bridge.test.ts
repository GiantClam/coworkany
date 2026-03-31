import { describe, expect, test } from 'bun:test';
import {
    extractMastraFinalAssistantTextEvent,
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
            role: 'assistant',
        });
    });

    test('maps textDelta payloads used by ai sdk v6', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            payload: { textDelta: 'hello-v6' },
        }, 'run-2b');

        expect(event).toEqual({
            type: 'text_delta',
            content: 'hello-v6',
            runId: 'run-2b',
            role: 'assistant',
        });
    });

    test('maps reasoning deltas to thinking role', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'reasoning-delta',
            payload: { textDelta: 'thinking...' },
        }, 'run-2c');

        expect(event).toEqual({
            type: 'text_delta',
            content: 'thinking...',
            runId: 'run-2c',
            role: 'thinking',
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

    test('does not map step-finish chunks to complete event', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'step-finish',
            payload: { finishReason: 'stop' },
        }, 'run-4a');

        expect(event).toBeNull();
    });

    test('extracts final assistant text from finish chunk response messages', () => {
        const event = extractMastraFinalAssistantTextEvent({
            type: 'finish',
            payload: {
                response: {
                    messages: [
                        {
                            role: 'assistant',
                            content: [{ text: 'final answer' }],
                        },
                    ],
                },
            },
        }, 'run-4b');

        expect(event).toEqual({
            type: 'text_delta',
            role: 'assistant',
            content: 'final answer',
            runId: 'run-4b',
        });
    });

    test('maps structured error chunk to error event with nested message', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'error',
            payload: {
                error: {
                    error: {
                        message: 'provider unauthorized',
                    },
                },
            },
        }, 'run-5');

        expect(event).toEqual({
            type: 'error',
            runId: 'run-5',
            message: 'provider unauthorized',
        });
    });
});
