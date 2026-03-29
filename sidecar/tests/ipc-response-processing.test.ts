import { describe, expect, test } from 'bun:test';
import type { IpcResponse } from '../src/protocol';
import { createPendingIpcResponseRegistry } from '../src/ipc/pendingIpcResponseRegistry';
import { createResponseProcessor } from '../src/ipc/responseProcessor';

describe('IPC response processing', () => {
    test('pending response registry resolves matching response', async () => {
        const registry = createPendingIpcResponseRegistry();
        const sentCommands: Array<Record<string, unknown>> = [];

        const wait = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'r1' } },
            (message) => sentCommands.push(message),
            1000,
        );

        expect(sentCommands.length).toBe(1);
        const commandId = sentCommands[0]?.id as string;
        expect(typeof commandId).toBe('string');

        const response = {
            type: 'request_effect_response',
            commandId,
            timestamp: new Date().toISOString(),
            payload: { response: { approved: true } },
        } as IpcResponse;

        registry.resolvePendingResponse(response);
        const resolved = await wait;
        expect(resolved).toEqual(response);
    });

    test('pending response registry rejects on timeout', async () => {
        const registry = createPendingIpcResponseRegistry();
        const wait = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'r2' } },
            () => {},
            5,
        );

        let errorMessage = '';
        try {
            await wait;
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
        }

        expect(errorMessage).toContain('IPC response timeout for request_effect');
    });

    test('pending response registry rejects all waiters when transport closes', async () => {
        const registry = createPendingIpcResponseRegistry();
        const sentCommands: Array<Record<string, unknown>> = [];

        const waitA = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'r3' } },
            (message) => sentCommands.push(message),
            10_000,
        );
        const waitB = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'r4' } },
            (message) => sentCommands.push(message),
            10_000,
        );
        expect(sentCommands.length).toBe(2);

        registry.rejectAllPendingResponses('sidecar_shutdown:stdin_closed');

        const messages = await Promise.all([
            waitA.catch((error) => (error instanceof Error ? error.message : String(error))),
            waitB.catch((error) => (error instanceof Error ? error.message : String(error))),
        ]);
        expect(messages[0]).toContain('sidecar_shutdown:stdin_closed');
        expect(messages[1]).toContain('sidecar_shutdown:stdin_closed');
    });

    test('pending response registry resolves the right waiter when responses return out of order', async () => {
        const registry = createPendingIpcResponseRegistry();
        const sentCommands: Array<Record<string, unknown>> = [];

        const waitA = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'a' } },
            (message) => sentCommands.push(message),
            1000,
        );
        const waitB = registry.sendCommandAndWait(
            'request_effect',
            { request: { id: 'b' } },
            (message) => sentCommands.push(message),
            1000,
        );

        const commandAId = sentCommands[0]?.id as string;
        const commandBId = sentCommands[1]?.id as string;

        const responseB = {
            type: 'request_effect_response',
            commandId: commandBId,
            timestamp: new Date().toISOString(),
            payload: { response: { approved: false } },
        } as IpcResponse;
        const responseA = {
            type: 'request_effect_response',
            commandId: commandAId,
            timestamp: new Date().toISOString(),
            payload: { response: { approved: true } },
        } as IpcResponse;

        registry.resolvePendingResponse(responseB);
        registry.resolvePendingResponse(responseA);

        const [resolvedA, resolvedB] = await Promise.all([waitA, waitB]);
        expect(resolvedA.commandId).toBe(commandAId);
        expect((resolvedA.payload as any)?.response?.approved).toBe(true);
        expect(resolvedB.commandId).toBe(commandBId);
        expect((resolvedB.payload as any)?.response?.approved).toBe(false);
    });

    test('response processor resolves pending and forwards to runtime handler', async () => {
        const seen: string[] = [];
        const processor = createResponseProcessor({
            resolvePendingResponse: () => {
                seen.push('resolve_pending');
            },
            handleRuntimeResponse: async () => {
                seen.push('handle_runtime_response');
                return true;
            },
        });

        await processor({
            type: 'apply_patch_response',
            commandId: 'cmd-1',
            timestamp: new Date().toISOString(),
            payload: { success: true },
        } as IpcResponse);

        expect(seen).toEqual(['resolve_pending', 'handle_runtime_response']);
    });
});
