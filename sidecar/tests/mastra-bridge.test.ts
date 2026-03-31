import { describe, expect, test } from 'bun:test';
import { extractMastraTokenUsageEvent, mapMastraChunkToDesktopEvent } from '../src/ipc/bridge';

describe('mastra bridge mapping', () => {
    test('maps payload text-delta events', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            payload: {
                text: 'hello',
            },
        }, 'run-1');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-1',
            content: 'hello',
        });
    });

    test('maps direct text-delta events without payload wrapper', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            text: 'hi',
        }, 'run-2');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-2',
            content: 'hi',
        });
    });

    test('extracts token usage from finish payload', () => {
        const event = extractMastraTokenUsageEvent({
            type: 'finish',
            payload: {
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                },
                response: {
                    modelId: 'anthropic/claude-sonnet-4-5',
                },
            },
        }, 'run-3');

        expect(event).toMatchObject({
            type: 'token_usage',
            runId: 'run-3',
            modelId: 'anthropic/claude-sonnet-4-5',
            provider: 'anthropic',
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        });
    });

    test('extracts token usage from step-finish prompt/completion fields', () => {
        const event = extractMastraTokenUsageEvent({
            type: 'step-finish',
            usage: {
                promptTokens: 4,
                completionTokens: 6,
                totalTokens: 10,
            },
            response: {
                model: 'openai/gpt-4.1',
            },
        }, 'run-4');

        expect(event).toMatchObject({
            type: 'token_usage',
            runId: 'run-4',
            modelId: 'openai/gpt-4.1',
            provider: 'openai',
            usage: {
                inputTokens: 4,
                outputTokens: 6,
                totalTokens: 10,
            },
        });
    });

    test('maps tripwire events with reason and processor metadata', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tripwire',
            payload: {
                reason: 'prompt_injection_detected',
                retry: false,
                processorId: 'prompt-injection-detector',
                metadata: {
                    severity: 'high',
                },
            },
        }, 'run-5');

        expect(event).toEqual({
            type: 'tripwire',
            runId: 'run-5',
            reason: 'prompt_injection_detected',
            retry: false,
            processorId: 'prompt-injection-detector',
            metadata: {
                severity: 'high',
            },
        });
    });
});
