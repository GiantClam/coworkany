import type { SingletonRuntime } from './singletonRuntime';

interface LineInputProcessorLike {
    pushChunk: (text: string) => void;
    flushTrailingLine: () => void;
    awaitIdle: () => Promise<void>;
}

interface HeartbeatEngineLike {
    stop: () => void;
}

interface SidecarLifecycleOptions {
    lineInputProcessor: LineInputProcessorLike;
    singletonRuntime?: SingletonRuntime;
    heartbeatEngine: HeartbeatEngineLike;
    mastraProtocolBridgeEnabled: boolean;
    disconnectBrowser: () => Promise<void>;
    stopBrowserUseManagedService: () => Promise<void>;
    closeLogStream: () => Promise<void>;
    failPendingResponses?: (errorMessage?: string) => void;
    logInfo: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
    logError: (...args: unknown[]) => void;
    exit: (code: number) => never | void;
}

export interface SidecarLifecycle {
    shutdownSidecar: (reason: string, exitCode: number) => Promise<never>;
    handlePrimaryStdinEnd: () => Promise<void>;
    registerStdinHandlers: (stdin: NodeJS.ReadStream) => void;
    registerSignalHandlers: (proc: NodeJS.Process) => void;
}

export function createSidecarLifecycle(options: SidecarLifecycleOptions): SidecarLifecycle {
    let shutdownPromise: Promise<void> | null = null;

    const shutdownSidecar = async (reason: string, exitCode: number): Promise<never> => {
        if (!shutdownPromise) {
            shutdownPromise = (async () => {
                options.logInfo(`[INFO] ${reason}`);
                options.failPendingResponses?.(`sidecar_shutdown:${reason}`);
                options.heartbeatEngine.stop();
                await options.singletonRuntime?.closeServerSafely();
                if (!options.mastraProtocolBridgeEnabled) {
                    try {
                        await options.disconnectBrowser();
                    } catch (error) {
                        options.logWarn('[WARN] Browser disconnect during shutdown failed:', error);
                    }
                    try {
                        await options.stopBrowserUseManagedService();
                    } catch (error) {
                        options.logWarn('[WARN] Browser-use managed service shutdown failed:', error);
                    }
                }
                await options.closeLogStream();
            })();
        }

        await shutdownPromise;
        options.exit(exitCode);
        throw new Error('unreachable');
    };

    const handlePrimaryStdinEnd = async (): Promise<void> => {
        options.singletonRuntime?.markPrimaryStdinEnded();

        options.lineInputProcessor.flushTrailingLine();
        await options.lineInputProcessor.awaitIdle();

        if (options.singletonRuntime?.isPrimary() && options.singletonRuntime.hasConnectedClients()) {
            options.logInfo('[INFO] Sidecar stdin closed; keeping singleton primary alive for connected clients');
            return;
        }

        await shutdownSidecar('Sidecar IPC stdin closed', 0);
    };

    const registerStdinHandlers = (stdin: NodeJS.ReadStream): void => {
        stdin.setEncoding('utf-8');
        stdin.resume();

        // Bun has proven unreliable with `readable` on piped stdin here; `data`
        // consistently fires for desktop IPC and one-shot CLI probes.
        stdin.on('data', (chunk: string | Buffer) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            options.logInfo('[DEBUG] stdin data chunk, length:', text.length);
            options.lineInputProcessor.pushChunk(text);
        });

        stdin.on('end', () => {
            void handlePrimaryStdinEnd();
        });

        stdin.on('error', (error) => {
            options.logError('[ERROR] stdin error:', error);
            void shutdownSidecar('stdin error triggered shutdown', 1);
        });
    };

    const registerSignalHandlers = (proc: NodeJS.Process): void => {
        proc.on('SIGINT', () => {
            void shutdownSidecar('Received SIGINT, shutting down', 0);
        });

        proc.on('SIGTERM', () => {
            void shutdownSidecar('Received SIGTERM, shutting down', 0);
        });
    };

    return {
        shutdownSidecar,
        handlePrimaryStdinEnd,
        registerStdinHandlers,
        registerSignalHandlers,
    };
}
