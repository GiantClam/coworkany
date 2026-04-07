import { describe, expect, test } from 'bun:test';
import { classifyRuntimeErrorMessage } from '../src/mastra/runtimeErrorClassifier';

describe('runtimeErrorClassifier', () => {
    test('classifies generate fallback timeout as upstream timeout', () => {
        const classified = classifyRuntimeErrorMessage('Error: generate_fallback_timeout:10000');
        expect(classified.errorCode).toBe('UPSTREAM_TIMEOUT');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });

    test('classifies chat startup budget timeout as upstream timeout', () => {
        const classified = classifyRuntimeErrorMessage('chat_startup_timeout_budget_exhausted');
        expect(classified.errorCode).toBe('UPSTREAM_TIMEOUT');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });
});

