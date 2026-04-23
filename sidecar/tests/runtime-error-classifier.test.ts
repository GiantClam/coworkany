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

    test('classifies TLS socket disconnect as temporary provider/runtime unavailability', () => {
        const classified = classifyRuntimeErrorMessage(
            'Cannot connect to API: Client network socket disconnected before secure TLS connection was established',
        );
        expect(classified.errorCode).toBe('PROVIDER_TEMPORARILY_UNAVAILABLE');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('retryable');
    });

    test('classifies certificate chain failures as configuration-required TLS trust errors', () => {
        const classified = classifyRuntimeErrorMessage('unable to get issuer certificate');
        expect(classified.errorCode).toBe('PROVIDER_TLS_TRUST_FAILURE');
        expect(classified.recoverable).toBe(true);
        expect(classified.failureClass).toBe('configuration_required');
    });

    test('classifies insufficient quota as blocked quota exceeded', () => {
        const classified = classifyRuntimeErrorMessage('insufficient_user_quota');
        expect(classified.errorCode).toBe('PROVIDER_QUOTA_EXCEEDED');
        expect(classified.recoverable).toBe(false);
        expect(classified.failureClass).toBe('blocked');
    });

    test('classifies Chinese quota exceeded message as blocked quota exceeded', () => {
        const classified = classifyRuntimeErrorMessage('用户额度不足, 剩余额度: ＄-0.001');
        expect(classified.errorCode).toBe('PROVIDER_QUOTA_EXCEEDED');
        expect(classified.recoverable).toBe(false);
        expect(classified.failureClass).toBe('blocked');
    });
});
