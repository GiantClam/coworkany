import { describe, expect, test } from 'bun:test';
import { handleEntrypointLegacySimpleCommand } from '../src/mastra/entrypointLegacySimpleCommands';

describe('entrypointLegacySimpleCommands', () => {
    test('returns false for unsupported command types', async () => {
        const handled = await handleEntrypointLegacySimpleCommand({
            command: { type: 'unknown' },
            getString: () => null,
            toRecord: () => ({}),
            emit: () => undefined,
            getMastraHealth: () => ({ agents: [], workflows: [], storageConfigured: false }),
            handleUserMessage: async () => undefined,
            handleApprovalResponse: async () => undefined,
        });

        expect(handled).toBe(false);
    });

    test('emits health payload for health_check', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const handled = await handleEntrypointLegacySimpleCommand({
            command: { type: 'health_check' },
            getString: () => null,
            toRecord: () => ({}),
            emit: (message) => emitted.push(message),
            getMastraHealth: () => ({
                agents: ['agent-a'],
                workflows: ['workflow-a'],
                storageConfigured: true,
            }),
            handleUserMessage: async () => undefined,
            handleApprovalResponse: async () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([
            {
                type: 'health',
                runtime: 'mastra',
                health: {
                    agents: ['agent-a'],
                    workflows: ['workflow-a'],
                    storageConfigured: true,
                },
            },
        ]);
    });

    test('user_message emits invalid_command when required fields are missing', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const handled = await handleEntrypointLegacySimpleCommand({
            command: { type: 'user_message', message: 'hello' },
            getString: (value) => (typeof value === 'string' ? value : null),
            toRecord: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : {}),
            emit: (message) => emitted.push(message),
            getMastraHealth: () => ({ agents: [], workflows: [], storageConfigured: false }),
            handleUserMessage: async () => undefined,
            handleApprovalResponse: async () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([
            { type: 'error', message: 'invalid_command' },
        ]);
    });

    test('user_message calls handler and forwards returned events', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const calls: Array<{ message: string; threadId: string; resourceId: string }> = [];

        const handled = await handleEntrypointLegacySimpleCommand({
            command: {
                type: 'user_message',
                message: 'hello',
                threadId: 'thread-1',
                resourceId: 'resource-1',
            },
            getString: (value) => (typeof value === 'string' ? value : null),
            toRecord: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : {}),
            emit: (message) => emitted.push(message),
            getMastraHealth: () => ({ agents: [], workflows: [], storageConfigured: false }),
            handleUserMessage: async (message, threadId, resourceId, sendToDesktop) => {
                calls.push({ message, threadId, resourceId });
                sendToDesktop({ type: 'TEXT_DELTA', delta: 'ok' });
            },
            handleApprovalResponse: async () => undefined,
        });

        expect(handled).toBe(true);
        expect(calls).toEqual([
            { message: 'hello', threadId: 'thread-1', resourceId: 'resource-1' },
        ]);
        expect(emitted).toEqual([
            { type: 'TEXT_DELTA', delta: 'ok' },
        ]);
    });

    test('approval_response validates payload and calls approval handler', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const approvalCalls: Array<{ runId: string; toolCallId: string; approved: boolean }> = [];

        const handled = await handleEntrypointLegacySimpleCommand({
            command: {
                type: 'approval_response',
                runId: 'run-1',
                toolCallId: 'tool-1',
                approved: true,
            },
            getString: (value) => (typeof value === 'string' ? value : null),
            toRecord: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : {}),
            emit: (message) => emitted.push(message),
            getMastraHealth: () => ({ agents: [], workflows: [], storageConfigured: false }),
            handleUserMessage: async () => undefined,
            handleApprovalResponse: async (runId, toolCallId, approved, sendToDesktop) => {
                approvalCalls.push({ runId, toolCallId, approved });
                sendToDesktop({ type: 'APPROVAL_APPLIED' });
            },
        });

        expect(handled).toBe(true);
        expect(approvalCalls).toEqual([
            { runId: 'run-1', toolCallId: 'tool-1', approved: true },
        ]);
        expect(emitted).toEqual([
            { type: 'APPROVAL_APPLIED' },
        ]);
    });

    test('approval_response emits invalid_command when payload is incomplete', async () => {
        const emitted: Array<Record<string, unknown>> = [];

        const handled = await handleEntrypointLegacySimpleCommand({
            command: {
                type: 'approval_response',
                runId: 'run-1',
                approved: true,
            },
            getString: (value) => (typeof value === 'string' ? value : null),
            toRecord: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : {}),
            emit: (message) => emitted.push(message),
            getMastraHealth: () => ({ agents: [], workflows: [], storageConfigured: false }),
            handleUserMessage: async () => undefined,
            handleApprovalResponse: async () => undefined,
        });

        expect(handled).toBe(true);
        expect(emitted).toEqual([
            { type: 'error', message: 'invalid_command' },
        ]);
    });
});
