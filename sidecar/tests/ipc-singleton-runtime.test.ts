import { describe, expect, test } from 'bun:test';
import { createSingletonRuntime } from '../src/ipc/singletonRuntime';
import { canUnlinkSocketPath, isNamedPipePath } from '../src/ipc/singletonPaths';

describe('singleton path utilities', () => {
    test('detects named pipe path', () => {
        expect(isNamedPipePath('\\\\.\\pipe\\coworkany-sidecar')).toBe(true);
        expect(isNamedPipePath('/tmp/coworkany.sock')).toBe(false);
    });

    test('can unlink unix socket path but not named pipe or win32 path', () => {
        expect(canUnlinkSocketPath('/tmp/coworkany.sock', 'darwin')).toBe(true);
        expect(canUnlinkSocketPath('\\\\.\\pipe\\coworkany-sidecar', 'win32')).toBe(false);
        expect(canUnlinkSocketPath('/tmp/coworkany.sock', 'win32')).toBe(false);
    });
});

describe('singleton runtime basic behavior', () => {
    test('initialize returns disabled when singleton is off', async () => {
        const runtime = createSingletonRuntime({
            enabled: false,
            enqueueLine: () => {},
            onAllTransportsClosed: async () => {},
            logInfo: () => {},
            logWarn: () => {},
            logError: () => {},
        });

        await expect(runtime.initialize()).resolves.toEqual({ mode: 'disabled' });
        expect(runtime.isPrimary()).toBe(false);
        expect(runtime.hasConnectedClients()).toBe(false);
    });

    test('initialize returns disabled and warns when socket path missing', async () => {
        const warnings: string[] = [];
        const runtime = createSingletonRuntime({
            enabled: true,
            socketPath: undefined,
            enqueueLine: () => {},
            onAllTransportsClosed: async () => {},
            logInfo: () => {},
            logWarn: (...args) => {
                warnings.push(String(args[0] ?? ''));
            },
            logError: () => {},
        });

        await expect(runtime.initialize()).resolves.toEqual({ mode: 'disabled' });
        expect(warnings.some((entry) => entry.includes('COWORKANY_SIDECAR_SOCKET_PATH'))).toBe(true);
    });

    test('closeServerSafely and broadcastLine are safe without active server', async () => {
        const runtime = createSingletonRuntime({
            enabled: false,
            enqueueLine: () => {},
            onAllTransportsClosed: async () => {},
            logInfo: () => {},
            logWarn: () => {},
            logError: () => {},
        });

        runtime.markPrimaryStdinEnded();
        runtime.broadcastLine('{"type":"ping"}\n');
        await expect(runtime.closeServerSafely()).resolves.toBeUndefined();
    });
});
