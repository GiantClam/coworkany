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

    test('classifies stream exhaustion without assistant narrative as upstream timeout', () => {
        const classified = classifyRuntimeErrorMessage('Error: stream_exhausted_without_assistant_text');
        expect(classified.errorCode).toBe('UPSTREAM_TIMEOUT');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });

    test('classifies missing terminal after tooling progress as upstream timeout', () => {
        const classified = classifyRuntimeErrorMessage('missing_terminal_after_tooling_progress');
        expect(classified.errorCode).toBe('UPSTREAM_TIMEOUT');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });

    test('classifies workflow snapshot loss as temporary provider/runtime unavailability', () => {
        const classified = classifyRuntimeErrorMessage('Error: No snapshot found for this workflow run: agentic-loop run-id');
        expect(classified.errorCode).toBe('PROVIDER_TEMPORARILY_UNAVAILABLE');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });
});
