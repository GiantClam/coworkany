import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'events';
import { createSidecarLifecycle } from '../src/ipc/sidecarLifecycle';

class FakeStdin extends EventEmitter {
    setEncoding(_encoding: BufferEncoding): this {
        return this;
    }

    resume(): this {
        return this;
    }
}

describe('sidecar lifecycle', () => {
    test('shutdown is idempotent for cleanup operations', async () => {
        let heartbeatStops = 0;
        let singletonCloses = 0;
        let browserDisconnects = 0;
        let managedServiceStops = 0;
        let logStreamCloses = 0;
        let failPendingCalls = 0;
        let exitCalls = 0;

        const lifecycle = createSidecarLifecycle({
            lineInputProcessor: {
                pushChunk: () => {},
                flushTrailingLine: () => {},
                awaitIdle: async () => {},
            },
            singletonRuntime: {
                initialize: async () => ({ mode: 'disabled' }),
                runProxy: async () => {},
                closeServerSafely: async () => {
                    singletonCloses += 1;
                },
                broadcastLine: () => {},
                markPrimaryStdinEnded: () => {},
                isPrimary: () => false,
                hasConnectedClients: () => false,
            },
            heartbeatEngine: {
                stop: () => {
                    heartbeatStops += 1;
                },
            },
            mastraProtocolBridgeEnabled: false,
            disconnectBrowser: async () => {
                browserDisconnects += 1;
            },
            stopBrowserUseManagedService: async () => {
                managedServiceStops += 1;
            },
            closeLogStream: async () => {
                logStreamCloses += 1;
            },
            failPendingResponses: () => {
                failPendingCalls += 1;
            },
            logInfo: () => {},
            logWarn: () => {},
            logError: () => {},
            exit: (code) => {
                exitCalls += 1;
                throw new Error(`exit:${code}`);
            },
        });

        await expect(lifecycle.shutdownSidecar('first', 0)).rejects.toThrow('exit:0');
        await expect(lifecycle.shutdownSidecar('second', 1)).rejects.toThrow('exit:1');

        expect(heartbeatStops).toBe(1);
        expect(singletonCloses).toBe(1);
        expect(browserDisconnects).toBe(1);
        expect(managedServiceStops).toBe(1);
        expect(logStreamCloses).toBe(1);
        expect(failPendingCalls).toBe(1);
        expect(exitCalls).toBe(2);
    });

    test('handlePrimaryStdinEnd keeps primary alive when clients remain connected', async () => {
        let markCalled = 0;
        let flushCalled = 0;
        let awaitIdleCalled = 0;
        let exitCalled = 0;

        const lifecycle = createSidecarLifecycle({
            lineInputProcessor: {
                pushChunk: () => {},
                flushTrailingLine: () => {
                    flushCalled += 1;
                },
                awaitIdle: async () => {
                    awaitIdleCalled += 1;
                },
            },
            singletonRuntime: {
                initialize: async () => ({ mode: 'disabled' }),
                runProxy: async () => {},
                closeServerSafely: async () => {},
                broadcastLine: () => {},
                markPrimaryStdinEnded: () => {
                    markCalled += 1;
                },
                isPrimary: () => true,
                hasConnectedClients: () => true,
            },
            heartbeatEngine: {
                stop: () => {},
            },
            mastraProtocolBridgeEnabled: true,
            disconnectBrowser: async () => {},
            stopBrowserUseManagedService: async () => {},
            closeLogStream: async () => {},
            logInfo: () => {},
            logWarn: () => {},
            logError: () => {},
            exit: () => {
                exitCalled += 1;
                throw new Error('should-not-exit');
            },
        });

        await expect(lifecycle.handlePrimaryStdinEnd()).resolves.toBeUndefined();
        expect(markCalled).toBe(1);
        expect(flushCalled).toBe(1);
        expect(awaitIdleCalled).toBe(1);
        expect(exitCalled).toBe(0);
    });

    test('registerStdinHandlers forwards stdin data to line processor', () => {
        const chunks: string[] = [];
        const lifecycle = createSidecarLifecycle({
            lineInputProcessor: {
                pushChunk: (text) => {
                    chunks.push(text);
                },
                flushTrailingLine: () => {},
                awaitIdle: async () => {},
            },
            heartbeatEngine: {
                stop: () => {},
            },
            mastraProtocolBridgeEnabled: true,
            disconnectBrowser: async () => {},
            stopBrowserUseManagedService: async () => {},
            closeLogStream: async () => {},
            logInfo: () => {},
            logWarn: () => {},
            logError: () => {},
            exit: () => {
                throw new Error('unused');
            },
        });

        const stdin = new FakeStdin();
        lifecycle.registerStdinHandlers(stdin as unknown as NodeJS.ReadStream);

        stdin.emit('data', 'hello');
        stdin.emit('data', Buffer.from(' world'));

        expect(chunks).toEqual(['hello', ' world']);
    });
});
