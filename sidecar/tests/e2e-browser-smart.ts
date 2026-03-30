import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BrowserService } from '../src/runtime/browser/browserService';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/health`);
            if (res.ok) {
                return;
            }
        } catch {
            // Service might still be starting.
        }
        await sleep(500);
    }
    throw new Error(`browser-use-service did not become healthy within ${timeoutMs}ms`);
}

function pickPythonExecutable(serviceDir: string): string {
    const candidates = [
        path.join(serviceDir, '.venv311', 'Scripts', 'python.exe'),
        path.join(serviceDir, '.venv', 'Scripts', 'python.exe'),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('No local Python executable found for browser-use-service (.venv311 or .venv).');
}

async function main(): Promise<void> {
    const sidecarRoot = process.cwd();
    const serviceDir = path.resolve(sidecarRoot, '..', 'browser-use-service');
    const mainPy = path.join(serviceDir, 'main.py');
    const pythonExe = pickPythonExecutable(serviceDir);
    const port = 8122;
    const baseUrl = `http://127.0.0.1:${port}`;

    const svc = spawn(pythonExe, [mainPy], {
        cwd: serviceDir,
        env: { ...process.env, BROWSER_USE_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    svc.stderr.on('data', (d) => {
        stderr += d.toString();
    });

    try {
        await waitForHealth(baseUrl, 20000);

        const browserService = new BrowserService(baseUrl);
        await browserService.connect({ headless: true });

        const status = await browserService.getSmartModeStatus();
        assert.equal(status.available, true, `Smart mode expected available, got: ${status.reason || 'unknown'}`);
        assert.ok(status.sharedCdpUrl?.includes('localhost:'), `Missing sharedCdpUrl: ${JSON.stringify(status)}`);

        browserService.setMode('smart');

        const nav = await browserService.navigate('https://example.com');
        assert.ok(nav.title.includes('Example'), `Unexpected title: ${nav.title}`);

        const shot = await browserService.screenshot();
        assert.ok(shot.base64.length > 100, 'Screenshot base64 is unexpectedly short');

        await browserService.disconnect();
        console.log('E2E smart browser reuse passed');
    } catch (error) {
        console.error('E2E smart browser reuse failed');
        if (stderr.trim()) {
            console.error('[browser-use-service stderr]');
            console.error(stderr.slice(-4000));
        }
        throw error;
    } finally {
        svc.kill('SIGTERM');
        await sleep(500);
        if (!svc.killed) {
            svc.kill('SIGKILL');
        }
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
