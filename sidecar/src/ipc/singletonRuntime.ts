import * as fs from 'fs';
import * as net from 'net';
import { randomUUID } from 'crypto';
import { canUnlinkSocketPath } from './singletonPaths';

export type SingletonInitResult =
    | { mode: 'disabled' }
    | { mode: 'primary' }
    | { mode: 'proxy'; upstream: net.Socket };

interface SingletonRuntimeOptions {
    enabled: boolean;
    socketPath?: string;
    lockPath?: string;
    enqueueLine: (line: string) => void;
    onAllTransportsClosed: () => Promise<void>;
    logInfo: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
    logError: (...args: unknown[]) => void;
}

export interface SingletonRuntime {
    initialize: () => Promise<SingletonInitResult>;
    runProxy: (upstream: net.Socket) => Promise<void>;
    closeServerSafely: () => Promise<void>;
    broadcastLine: (line: string) => void;
    markPrimaryStdinEnded: () => void;
    isPrimary: () => boolean;
    hasConnectedClients: () => boolean;
}

function buildGetRuntimeSnapshotCommandLine(): string {
    return JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'get_runtime_snapshot',
        payload: {},
    }) + '\n';
}

export function createSingletonRuntime(options: SingletonRuntimeOptions): SingletonRuntime {
    let singletonIsPrimary = false;
    let singletonServer: net.Server | null = null;
    let singletonLockFd: number | null = null;
    const singletonClients = new Set<net.Socket>();
    let primaryStdinEnded = false;

    const tryAcquireSingletonLock = (): boolean => {
        if (!options.lockPath) {
            return false;
        }
        try {
            singletonLockFd = fs.openSync(options.lockPath, 'wx');
            return true;
        } catch (error) {
            const errno = error as NodeJS.ErrnoException;
            if (errno.code === 'EEXIST') {
                return false;
            }
            throw error;
        }
    };

    const releaseSingletonLock = (): void => {
        if (singletonLockFd !== null) {
            try {
                fs.closeSync(singletonLockFd);
            } catch {
                // ignore
            }
            singletonLockFd = null;
        }

        if (!options.lockPath || !singletonIsPrimary) {
            return;
        }

        try {
            if (fs.existsSync(options.lockPath)) {
                fs.unlinkSync(options.lockPath);
            }
        } catch (error) {
            options.logWarn('[WARN] Failed to remove singleton lock file:', error);
        }
    };

    const cleanupSingletonSocketFile = (): void => {
        if (!options.socketPath || !singletonIsPrimary || !canUnlinkSocketPath(options.socketPath)) {
            releaseSingletonLock();
            return;
        }

        try {
            if (fs.existsSync(options.socketPath)) {
                fs.unlinkSync(options.socketPath);
            }
        } catch (error) {
            options.logWarn('[WARN] Failed to clean singleton socket file:', error);
        }
        releaseSingletonLock();
    };

    const connectToSingletonPrimary = (socketPath: string): Promise<net.Socket> => {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(socketPath);
            const onError = (error: NodeJS.ErrnoException) => {
                socket.removeListener('connect', onConnect);
                reject(error);
            };
            const onConnect = () => {
                socket.removeListener('error', onError);
                socket.setNoDelay(true);
                resolve(socket);
            };
            socket.once('error', onError);
            socket.once('connect', onConnect);
        });
    };

    const startSingletonPrimaryServer = async (socketPath: string): Promise<void> => {
        const server = net.createServer((client) => {
            singletonClients.add(client);
            client.setEncoding('utf-8');

            let socketBuffer = '';
            client.on('data', (chunk: string | Buffer) => {
                const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
                socketBuffer += text;
                const lines = socketBuffer.split('\n');
                socketBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    options.enqueueLine(line);
                }
            });

            const cleanupClient = (): void => {
                singletonClients.delete(client);
                if (primaryStdinEnded && singletonClients.size === 0) {
                    void options.onAllTransportsClosed().catch((error) => {
                        options.logWarn('[WARN] Sidecar shutdown failed after singleton client disconnect:', error);
                    });
                }
            };

            client.on('error', (error) => {
                options.logWarn('[WARN] Singleton client socket error:', error);
                cleanupClient();
            });
            client.on('close', cleanupClient);
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (error: NodeJS.ErrnoException) => {
                server.removeListener('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.removeListener('error', onError);
                resolve();
            };

            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(socketPath);
        });

        singletonServer = server;
        singletonIsPrimary = true;
        options.logInfo(`[INFO] Sidecar singleton primary listening: ${socketPath}`);
    };

    const initialize = async (): Promise<SingletonInitResult> => {
        if (!options.enabled) {
            return { mode: 'disabled' };
        }

        if (!options.socketPath) {
            options.logWarn('[WARN] Singleton requested but COWORKANY_SIDECAR_SOCKET_PATH is empty; singleton disabled');
            return { mode: 'disabled' };
        }

        if (tryAcquireSingletonLock()) {
            try {
                await startSingletonPrimaryServer(options.socketPath);
                return { mode: 'primary' };
            } catch (error) {
                releaseSingletonLock();
                throw error;
            }
        }

        try {
            const upstream = await connectToSingletonPrimary(options.socketPath);
            return { mode: 'proxy', upstream };
        } catch {
            if (options.lockPath) {
                try {
                    if (fs.existsSync(options.lockPath)) {
                        fs.unlinkSync(options.lockPath);
                    }
                } catch (unlinkError) {
                    options.logWarn('[WARN] Failed to remove stale singleton lock:', unlinkError);
                }
            }
            if (canUnlinkSocketPath(options.socketPath)) {
                try {
                    if (fs.existsSync(options.socketPath)) {
                        fs.unlinkSync(options.socketPath);
                    }
                } catch (unlinkError) {
                    options.logWarn('[WARN] Failed to remove stale singleton socket:', unlinkError);
                }
            }

            if (tryAcquireSingletonLock()) {
                await startSingletonPrimaryServer(options.socketPath);
                return { mode: 'primary' };
            }

            const upstream = await connectToSingletonPrimary(options.socketPath);
            return { mode: 'proxy', upstream };
        }
    };

    const runProxy = async (upstream: net.Socket): Promise<void> => {
        options.logInfo('[INFO] Existing sidecar detected; entering singleton proxy mode');
        upstream.setEncoding('utf-8');

        process.stdin.setEncoding('utf-8');
        process.stdin.resume();

        process.stdin.on('data', (chunk: string | Buffer) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            upstream.write(text);
        });

        process.stdin.on('end', () => {
            upstream.end();
        });

        process.stdin.on('error', (error) => {
            options.logError('[ERROR] Proxy stdin error:', error);
            upstream.destroy();
        });

        upstream.on('data', (chunk: string | Buffer) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            process.stdout.write(text);
        });

        upstream.on('error', (error) => {
            options.logError('[ERROR] Proxy upstream socket error:', error);
            process.exit(1);
        });

        upstream.on('close', () => {
            process.exit(0);
        });

        try {
            upstream.write(buildGetRuntimeSnapshotCommandLine());
        } catch (error) {
            options.logWarn('[WARN] Failed to request runtime snapshot from primary sidecar:', error);
        }
    };

    const closeServerSafely = async (): Promise<void> => {
        for (const client of singletonClients) {
            try {
                client.destroy();
            } catch {
                // ignore
            }
        }
        singletonClients.clear();

        if (!singletonServer) {
            cleanupSingletonSocketFile();
            return;
        }

        const server = singletonServer;
        singletonServer = null;

        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });

        cleanupSingletonSocketFile();
    };

    const broadcastLine = (line: string): void => {
        for (const client of singletonClients) {
            if (client.destroyed || !client.writable) {
                singletonClients.delete(client);
                continue;
            }
            try {
                client.write(line);
            } catch {
                singletonClients.delete(client);
                try {
                    client.destroy();
                } catch {
                    // ignore
                }
            }
        }
    };

    return {
        initialize,
        runProxy,
        closeServerSafely,
        broadcastLine,
        markPrimaryStdinEnded: () => {
            primaryStdinEnded = true;
        },
        isPrimary: () => singletonIsPrimary,
        hasConnectedClients: () => singletonClients.size > 0,
    };
}
