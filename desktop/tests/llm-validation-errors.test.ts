import { describe, expect, test } from 'bun:test';
import { mapValidationErrorToUserMessage } from '../src/lib/llmValidationErrors';

describe('mapValidationErrorToUserMessage', () => {
    test('maps OpenRouter 403 policy block into a clearer hint', () => {
        const rawError = 'Provider returned status 403 Forbidden: {"error":{"message":"The request is prohibited due to a violation of provider Terms Of Service.","code":403,"metadata":{"provider_name":null}}}';
        const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '';
        const message = mapValidationErrorToUserMessage({
            provider: 'openrouter',
            rawError,
            t: t as never,
        });

        expect(message).toContain('OpenRouter rejected this request (403)');
        expect(message).toContain(rawError);
    });

    test('keeps raw error for non-OpenRouter providers', () => {
        const rawError = 'Provider returned status 429: too many requests';
        const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '';
        const message = mapValidationErrorToUserMessage({
            provider: 'openai',
            rawError,
            t: t as never,
        });

        expect(message).toBe(rawError);
    });
});
