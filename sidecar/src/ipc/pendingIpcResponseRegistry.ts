import { randomUUID } from 'crypto';
import type { IpcResponse } from '../protocol';

type PendingIpcResponseEntry = {
    resolve: (response: IpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

export type PendingIpcResponseRegistry = {
    sendCommandAndWait: (
        type: string,
        payload: Record<string, unknown>,
        emitCommand: (message: Record<string, unknown>) => void,
        timeoutMs?: number,
    ) => Promise<IpcResponse>;
    resolvePendingResponse: (response: IpcResponse) => void;
    rejectAllPendingResponses: (errorMessage?: string) => void;
};

export function createPendingIpcResponseRegistry(): PendingIpcResponseRegistry {
    const pendingIpcResponses = new Map<string, PendingIpcResponseEntry>();

    return {
        sendCommandAndWait: (
            type: string,
            payload: Record<string, unknown>,
            emitCommand: (message: Record<string, unknown>) => void,
            timeoutMs = 30_000,
        ): Promise<IpcResponse> => {
            const commandId = randomUUID();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pendingIpcResponses.delete(commandId);
                    reject(new Error(`IPC response timeout for ${type}`));
                }, timeoutMs);

                pendingIpcResponses.set(commandId, {
                    resolve,
                    reject,
                    timeout,
                });

                emitCommand({
                    id: commandId,
                    timestamp: new Date().toISOString(),
                    type,
                    payload,
                });
            });
        },
        resolvePendingResponse: (response: IpcResponse): void => {
            if (!('commandId' in response) || typeof response.commandId !== 'string') {
                return;
            }

            const pending = pendingIpcResponses.get(response.commandId);
            if (!pending) {
                return;
            }

            clearTimeout(pending.timeout);
            pendingIpcResponses.delete(response.commandId);
            pending.resolve(response);
        },
        rejectAllPendingResponses: (errorMessage = 'IPC transport closed'): void => {
            const error = new Error(errorMessage);
            for (const [commandId, pending] of pendingIpcResponses.entries()) {
                clearTimeout(pending.timeout);
                pendingIpcResponses.delete(commandId);
                pending.reject(error);
            }
        },
    };
}
