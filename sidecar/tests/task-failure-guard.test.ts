import { describe, expect, test } from 'bun:test';
import {
    buildModelStreamFailurePayload,
    isTerminalTaskStatus,
    shouldEmitTaskFailure,
} from '../src/agent/taskFailureGuards';

describe('task failure guards', () => {
    test('treats recoverable interrupted tasks as terminal for duplicate failure suppression', () => {
        expect(isTerminalTaskStatus('recoverable_interrupted')).toBe(true);
        expect(shouldEmitTaskFailure('recoverable_interrupted')).toBe(false);
        expect(shouldEmitTaskFailure('finished')).toBe(false);
        expect(shouldEmitTaskFailure('failed')).toBe(false);
        expect(shouldEmitTaskFailure('running')).toBe(true);
    });

    test('builds recoverable stream failure payloads for transient transport errors', () => {
        const payload = buildModelStreamFailurePayload('socket connection was closed unexpectedly');
        expect(payload.errorCode).toBe('MODEL_STREAM_ERROR');
        expect(payload.recoverable).toBe(true);
        expect(payload.suggestion).toContain('continue this task');
    });

    test('keeps non-network model failures non-recoverable', () => {
        const payload = buildModelStreamFailurePayload('invalid response schema');
        expect(payload.recoverable).toBe(false);
        expect(payload.suggestion).toBeUndefined();
    });
});
