import { describe, expect, test } from 'bun:test';
import { handleEntrypointForwardedCommand } from '../src/mastra/entrypointForwardCommands';

describe('entrypointForwardCommands', () => {
    test('returns false when command is not in forwarded command allowlist', async () => {
        const handled = await handleEntrypointForwardedCommand({
            commandId: 'cmd-1',
            commandType: 'unknown',
            payload: {},
            forwardedCommandTypes: new Set(['read_file']),
            requestEffectTimeoutMs: 1000,
            defaultTimeoutMs: 1000,
            getString: () => null,
            toRecord: () => ({}),
            emitFor: () => undefined,
            emitCurrent: () => undefined,
            createId: () => 'id-1',
            applyPolicyDecision: () => ({ allowed: true }),
            forwardCommandAndWait: async () => ({ type: 'read_file_response', payload: {} }),
            emitRaw: () => undefined,
        });

        expect(handled).toBe(false);
    });

    test('emits policy_denied error when policy blocks forwarded command', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const handled = await handleEntrypointForwardedCommand({
            commandId: 'cmd-2',
            commandType: 'read_file',
            payload: {},
            forwardedCommandTypes: new Set(['read_file']),
            requestEffectTimeoutMs: 1000,
            defaultTimeoutMs: 1000,
            getString: () => null,
            toRecord: () => ({}),
            emitFor: () => undefined,
            emitCurrent: (payload) => {
                emitted.push(payload);
            },
            createId: () => 'id-2',
            applyPolicyDecision: () => ({ allowed: false, reason: 'blocked' }),
            forwardCommandAndWait: async () => ({ type: 'read_file_response', payload: {} }),
            emitRaw: () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([{
            success: false,
            error: 'policy_denied:blocked',
        }]);
    });

    test('forwards response payload when policy gate returns expected response type', async () => {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const handled = await handleEntrypointForwardedCommand({
            commandId: 'cmd-3',
            commandType: 'read_file',
            payload: { path: 'README.md' },
            forwardedCommandTypes: new Set(['read_file']),
            requestEffectTimeoutMs: 1000,
            defaultTimeoutMs: 1000,
            getString: () => null,
            toRecord: (value) => value as Record<string, unknown>,
            emitFor: (type, payload) => {
                emitted.push({ type, payload });
            },
            emitCurrent: () => undefined,
            createId: () => 'id-3',
            applyPolicyDecision: () => ({ allowed: true }),
            forwardCommandAndWait: async () => ({
                type: 'read_file_response',
                payload: { success: true, content: 'hello' },
            }),
            emitRaw: () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([{
            type: 'read_file_response',
            payload: {
                success: true,
                content: 'hello',
            },
        }]);
    });

    test('emits invalid response error when forwarded response type mismatches expected type', async () => {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        let invalidCount = 0;
        const handled = await handleEntrypointForwardedCommand({
            commandId: 'cmd-4',
            commandType: 'read_file',
            payload: {},
            forwardedCommandTypes: new Set(['read_file']),
            requestEffectTimeoutMs: 1000,
            defaultTimeoutMs: 1000,
            getString: () => null,
            toRecord: () => ({}),
            emitFor: (type, payload) => {
                emitted.push({ type, payload });
            },
            emitCurrent: () => undefined,
            createId: () => 'id-4',
            applyPolicyDecision: () => ({ allowed: true }),
            forwardCommandAndWait: async () => ({
                type: 'unexpected_response',
                payload: {},
            }),
            emitRaw: () => undefined,
            onInvalidResponse: () => {
                invalidCount += 1;
            },
        });

        expect(handled).toBe(true);
        expect(invalidCount).toBe(1);
        expect(emitted).toEqual([{
            type: 'read_file_response',
            payload: {
                success: false,
                error: 'policy_gate_invalid_response:unexpected_response',
            },
        }]);
    });

    test('apply_patch forward errors return io_error payload shape', async () => {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const handled = await handleEntrypointForwardedCommand({
            commandId: 'cmd-5',
            commandType: 'apply_patch',
            payload: {
                patchId: 'patch-1',
            },
            forwardedCommandTypes: new Set(['apply_patch']),
            requestEffectTimeoutMs: 1000,
            defaultTimeoutMs: 1000,
            getString: (value) => (typeof value === 'string' ? value : null),
            toRecord: () => ({}),
            emitFor: (type, payload) => {
                emitted.push({ type, payload });
            },
            emitCurrent: () => undefined,
            createId: () => 'generated-patch-id',
            applyPolicyDecision: () => ({ allowed: true }),
            forwardCommandAndWait: async () => {
                throw new Error('timeout');
            },
            emitRaw: () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([{
            type: 'apply_patch_response',
            payload: {
                patchId: 'patch-1',
                success: false,
                error: 'policy_gate_unavailable:timeout',
                errorCode: 'io_error',
            },
        }]);
    });
});
