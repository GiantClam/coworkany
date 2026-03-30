import { describe, test, expect, mock } from 'bun:test';
import { EventEmitter } from 'events';
import { BrowserUseServiceBootstrap } from '../src/runtime/browser/browserUseServiceBootstrap';

function createHealthyResponse(): Response {
    return {
        ok: true,
        json: async () => ({ status: 'ok' }),
    } as Response;
}

function createUnhealthyResponse(): Response {
    return {
        ok: false,
        json: async () => ({ status: 'down' }),
    } as Response;
}

function createFakeChildProcess(pid: number = 321): any {
    const proc = new EventEmitter() as any;
    proc.pid = pid;
    proc.killed = false;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = mock((signal?: NodeJS.Signals) => {
        proc.killed = true;
        proc.exitCode = signal === 'SIGKILL' ? 137 : 0;
        proc.emit('exit', proc.exitCode, signal ?? null);
        return true;
    });
    return proc;
}

describe('BrowserUseServiceBootstrap', () => {
    test('returns available without spawning when service is already healthy', async () => {
        const spawnFn = mock(() => createFakeChildProcess());
        const bootstrap = new BrowserUseServiceBootstrap({
            fetchFn: mock(async () => createHealthyResponse()) as any,
            spawnFn: spawnFn as any,
        });

        const result = await bootstrap.ensureReady({
            enabled: true,
            autoStart: true,
            serviceUrl: 'http://localhost:8100',
            workspaceRoot: '/tmp/workspace',
        });

        expect(result.available).toBe(true);
        expect(result.started).toBe(false);
        expect(spawnFn).toHaveBeenCalledTimes(0);
    });

    test('does not spawn when auto-start is disabled', async () => {
        const spawnFn = mock(() => createFakeChildProcess());
        const bootstrap = new BrowserUseServiceBootstrap({
            fetchFn: mock(async () => createUnhealthyResponse()) as any,
            spawnFn: spawnFn as any,
        });

        const result = await bootstrap.ensureReady({
            enabled: true,
            autoStart: false,
            serviceUrl: 'http://localhost:8100',
            workspaceRoot: '/tmp/workspace',
        });

        expect(result.available).toBe(false);
        expect(result.started).toBe(false);
        expect(result.reason).toContain('auto-start disabled');
        expect(spawnFn).toHaveBeenCalledTimes(0);
    });

    test('auto-starts local service when unavailable and startup assets exist', async () => {
        let healthy = false;
        const spawnFn = mock(() => {
            healthy = true;
            return createFakeChildProcess();
        });
        const fetchFn = mock(async () => (healthy ? createHealthyResponse() : createUnhealthyResponse()));
        const existsSync = (targetPath: string) => {
            const normalized = targetPath.replace(/\\/g, '/');
            if (normalized.endsWith('/repo/browser-use-service/main.py')) return true;
            if (normalized.endsWith('/repo/browser-use-service/.venv/bin/python')) return true;
            return false;
        };

        const bootstrap = new BrowserUseServiceBootstrap({
            fetchFn: fetchFn as any,
            spawnFn: spawnFn as any,
            existsSync,
            platform: 'darwin',
            logger: { error: () => {}, warn: () => {} },
        });

        const result = await bootstrap.ensureReady({
            enabled: true,
            autoStart: true,
            serviceUrl: 'http://localhost:8100',
            workspaceRoot: '/repo/sidecar',
            startupTimeoutMs: 500,
            healthPollIntervalMs: 25,
        });

        expect(result.available).toBe(true);
        expect(result.started).toBe(true);
        expect(spawnFn).toHaveBeenCalledTimes(1);

        await bootstrap.stopManagedService();
    });

    test('skips auto-start for non-loopback endpoint', async () => {
        const spawnFn = mock(() => createFakeChildProcess());
        const bootstrap = new BrowserUseServiceBootstrap({
            fetchFn: mock(async () => createUnhealthyResponse()) as any,
            spawnFn: spawnFn as any,
        });

        const result = await bootstrap.ensureReady({
            enabled: true,
            autoStart: true,
            serviceUrl: 'https://remote.example.com:8100',
            workspaceRoot: '/tmp/workspace',
        });

        expect(result.available).toBe(false);
        expect(result.started).toBe(false);
        expect(result.reason).toContain('not loopback');
        expect(spawnFn).toHaveBeenCalledTimes(0);
    });
});
