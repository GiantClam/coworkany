import * as fs from 'fs';
import * as path from 'path';
import { spawn as spawnChildProcess, type ChildProcess } from 'child_process';

const DEFAULT_BROWSER_USE_SERVICE_URL = 'http://localhost:8100';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export type BrowserUseServiceBootstrapDeps = {
    fetchFn?: typeof fetch;
    spawnFn?: typeof spawnChildProcess;
    existsSync?: (targetPath: string) => boolean;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    logger?: Pick<Console, 'error' | 'warn'>;
};

export type EnsureBrowserUseServiceOptions = {
    enabled: boolean;
    autoStart: boolean;
    serviceUrl?: string;
    llmModel?: string;
    workspaceRoot: string;
    startupTimeoutMs?: number;
    healthPollIntervalMs?: number;
    serviceDirectoryHint?: string;
};

export type EnsureBrowserUseServiceResult = {
    available: boolean;
    started: boolean;
    reason?: string;
};

type ServiceUrlDetails = {
    normalizedUrl: string;
    host?: string;
    port?: string;
    isLoopback: boolean;
};

export class BrowserUseServiceBootstrap {
    private readonly deps: Required<BrowserUseServiceBootstrapDeps>;
    private managedChild: ChildProcess | null = null;
    private managedServiceUrl: string | null = null;
    private startupPromise: Promise<EnsureBrowserUseServiceResult> | null = null;

    constructor(deps: BrowserUseServiceBootstrapDeps = {}) {
        this.deps = {
            fetchFn: deps.fetchFn ?? fetch,
            spawnFn: deps.spawnFn ?? spawnChildProcess,
            existsSync: deps.existsSync ?? fs.existsSync,
            env: deps.env ?? process.env,
            platform: deps.platform ?? process.platform,
            logger: deps.logger ?? console,
        };
    }

    getManagedProcessInfo(): { pid: number | null; serviceUrl: string | null } {
        return {
            pid: this.managedChild?.pid ?? null,
            serviceUrl: this.managedServiceUrl,
        };
    }

    async ensureReady(options: EnsureBrowserUseServiceOptions): Promise<EnsureBrowserUseServiceResult> {
        const urlDetails = this.parseServiceUrl(options.serviceUrl);

        if (!options.enabled) {
            return {
                available: false,
                started: false,
                reason: 'browser-use disabled by config',
            };
        }

        if (await this.isServiceHealthy(urlDetails.normalizedUrl)) {
            return {
                available: true,
                started: false,
            };
        }

        if (!options.autoStart) {
            return {
                available: false,
                started: false,
                reason: 'browser-use auto-start disabled by config',
            };
        }

        if (!urlDetails.isLoopback) {
            return {
                available: false,
                started: false,
                reason: `browser-use endpoint is not loopback (${urlDetails.normalizedUrl}), skip auto-start`,
            };
        }

        if (
            this.managedChild
            && this.managedServiceUrl
            && this.managedServiceUrl !== urlDetails.normalizedUrl
        ) {
            await this.stopManagedService();
        }

        if (this.startupPromise) {
            return this.startupPromise;
        }

        if (this.isManagedChildAlive() && this.managedServiceUrl === urlDetails.normalizedUrl) {
            const becameHealthy = await this.waitForHealth(
                urlDetails.normalizedUrl,
                options.startupTimeoutMs ?? 15000,
                options.healthPollIntervalMs ?? 500
            );
            return {
                available: becameHealthy,
                started: false,
                reason: becameHealthy ? undefined : 'managed browser-use process stayed unhealthy',
            };
        }

        this.startupPromise = this.startManagedProcessAndWait(urlDetails, options)
            .finally(() => {
                this.startupPromise = null;
            });

        return this.startupPromise;
    }

    async stopManagedService(): Promise<void> {
        const child = this.managedChild;
        if (!child) {
            return;
        }

        this.managedChild = null;
        this.managedServiceUrl = null;

        if (child.exitCode !== null || child.killed) {
            return;
        }

        await new Promise<void>((resolve) => {
            let settled = false;
            const finalize = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(forceTimer);
                child.removeListener('exit', onExit);
                resolve();
            };

            const onExit = () => finalize();
            const forceTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // ignored
                }
                finalize();
            }, 1500);

            child.once('exit', onExit);

            try {
                child.kill('SIGTERM');
            } catch {
                finalize();
            }
        });
    }

    private async startManagedProcessAndWait(
        urlDetails: ServiceUrlDetails,
        options: EnsureBrowserUseServiceOptions
    ): Promise<EnsureBrowserUseServiceResult> {
        const serviceDir = this.resolveServiceDirectory(options.workspaceRoot, options.serviceDirectoryHint);
        if (!serviceDir) {
            return {
                available: false,
                started: false,
                reason: 'browser-use-service directory not found',
            };
        }

        const pythonExecutable = this.resolvePythonExecutable(serviceDir);
        const env = {
            ...this.deps.env,
            ...(options.llmModel?.trim() ? { BROWSER_USE_LLM_MODEL: options.llmModel.trim() } : {}),
            ...(urlDetails.host ? { BROWSER_USE_HOST: urlDetails.host } : {}),
            ...(urlDetails.port ? { BROWSER_USE_PORT: urlDetails.port } : {}),
        };

        const child = this.deps.spawnFn(
            pythonExecutable,
            ['main.py'],
            {
                cwd: serviceDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
            }
        );

        this.managedChild = child;
        this.managedServiceUrl = urlDetails.normalizedUrl;

        child.stdout?.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            const line = text.trim();
            if (line) {
                this.deps.logger.error(`[BrowserUseService] ${line}`);
            }
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            const line = text.trim();
            if (line) {
                this.deps.logger.error(`[BrowserUseService:stderr] ${line}`);
            }
        });
        child.once('error', (error) => {
            if (this.managedChild === child) {
                this.managedChild = null;
                this.managedServiceUrl = null;
            }
            this.deps.logger.warn(`[BrowserUseService] spawn error: ${error instanceof Error ? error.message : String(error)}`);
        });
        child.once('exit', (code, signal) => {
            if (this.managedChild === child) {
                this.managedChild = null;
                this.managedServiceUrl = null;
            }
            this.deps.logger.warn(`[BrowserUseService] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
        });

        this.deps.logger.error(`[BrowserUseService] starting with ${pythonExecutable} (cwd=${serviceDir})`);

        const healthy = await this.waitForHealth(
            urlDetails.normalizedUrl,
            options.startupTimeoutMs ?? 15000,
            options.healthPollIntervalMs ?? 500
        );

        if (!healthy) {
            await this.stopManagedService();
            return {
                available: false,
                started: true,
                reason: `browser-use-service failed to become healthy at ${urlDetails.normalizedUrl}`,
            };
        }

        return {
            available: true,
            started: true,
        };
    }

    private isManagedChildAlive(): boolean {
        return Boolean(this.managedChild && this.managedChild.exitCode === null && !this.managedChild.killed);
    }

    private async waitForHealth(serviceUrl: string, timeoutMs: number, pollIntervalMs: number): Promise<boolean> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (await this.isServiceHealthy(serviceUrl)) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, Math.max(25, pollIntervalMs)));
        }
        return false;
    }

    private async isServiceHealthy(serviceUrl: string): Promise<boolean> {
        const healthUrl = `${serviceUrl.replace(/\/$/, '')}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort(new Error('health check timeout'));
        }, 3000);

        try {
            const response = await this.deps.fetchFn(healthUrl, {
                signal: controller.signal,
            });
            if (!response.ok) {
                return false;
            }
            const payload = await response.json() as { status?: string };
            return payload.status === 'ok';
        } catch {
            return false;
        } finally {
            clearTimeout(timeout);
        }
    }

    private resolveServiceDirectory(workspaceRoot: string, explicitHint?: string): string | null {
        const explicit = explicitHint?.trim();
        const candidates = [
            explicit,
            this.deps.env.BROWSER_USE_SERVICE_DIR,
            path.join(workspaceRoot, 'browser-use-service'),
            path.join(workspaceRoot, '..', 'browser-use-service'),
            path.join(workspaceRoot, '..', '..', 'browser-use-service'),
        ].filter((value): value is string => Boolean(value));

        for (const candidate of candidates) {
            const absolute = path.resolve(candidate);
            const mainPath = path.join(absolute, 'main.py');
            if (this.deps.existsSync(mainPath)) {
                return absolute;
            }
        }

        return null;
    }

    private resolvePythonExecutable(serviceDir: string): string {
        const platform = this.deps.platform;
        const candidates = platform === 'win32'
            ? [
                path.join(serviceDir, '.venv', 'Scripts', 'python.exe'),
                path.join(serviceDir, '.venv311', 'Scripts', 'python.exe'),
                path.join(serviceDir, '.venv312', 'Scripts', 'python.exe'),
            ]
            : [
                path.join(serviceDir, '.venv', 'bin', 'python'),
                path.join(serviceDir, '.venv311', 'bin', 'python'),
                path.join(serviceDir, '.venv312', 'bin', 'python'),
            ];

        for (const candidate of candidates) {
            if (this.deps.existsSync(candidate)) {
                return candidate;
            }
        }

        return platform === 'win32' ? 'python' : 'python3';
    }

    private parseServiceUrl(serviceUrl?: string): ServiceUrlDetails {
        const normalizedUrl = (serviceUrl?.trim() || DEFAULT_BROWSER_USE_SERVICE_URL).replace(/\/$/, '');
        try {
            const parsed = new URL(normalizedUrl);
            const host = parsed.hostname;
            return {
                normalizedUrl,
                host,
                port: parsed.port,
                isLoopback: LOOPBACK_HOSTS.has(host),
            };
        } catch {
            return {
                normalizedUrl,
                isLoopback: false,
            };
        }
    }
}

export const browserUseServiceBootstrap = new BrowserUseServiceBootstrap();
