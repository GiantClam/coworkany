import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import {
    SidecarProcess,
    buildStartTaskCommand,
    SIDECAR_INIT_WAIT_MS,
} from './helpers/sidecar-harness';

const SIDECAR_ROOT = '/Users/beihuang/Documents/github/coworkany/sidecar';
const BROWSER_PORT = 8100;

function supportsLsof(): boolean {
    return process.platform !== 'win32';
}

function listBrowserUseListenerPids(): string[] {
    if (!supportsLsof()) {
        return [];
    }
    try {
        const raw = execSync(`lsof -tiTCP:${BROWSER_PORT} -sTCP:LISTEN`, {
            encoding: 'utf-8',
        }).trim();
        if (!raw) {
            return [];
        }
        return raw.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function killBrowserUseListeners(): void {
    const pids = listBrowserUseListenerPids();
    for (const pid of pids) {
        try {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch {
            // ignored
        }
    }
}

function countServiceStarts(stderr: string): number {
    return (stderr.match(/\[BrowserUseService\] starting with/g) || []).length;
}

async function waitForCondition(
    condition: () => boolean,
    timeoutMs: number,
    intervalMs: number = 250
): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (condition()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return condition();
}

describe('Browser Service In-Process Recovery E2E', () => {
    let sidecar: SidecarProcess | null = null;

    afterEach(() => {
        if (sidecar) {
            sidecar.kill();
            sidecar = null;
        }
        killBrowserUseListeners();
    });

    test('recovers browser-use service in same sidecar process after crash', async () => {
        if (!supportsLsof()) {
            return;
        }

        killBrowserUseListeners();

        sidecar = new SidecarProcess(undefined, {
            cwd: SIDECAR_ROOT,
        });
        await sidecar.start();

        const startupRecovered = await waitForCondition(() => {
            const stderr = sidecar?.getAllStderr() || '';
            return countServiceStarts(stderr) >= 1;
        }, SIDECAR_INIT_WAIT_MS + 12_000);
        expect(startupRecovered).toBe(true);

        killBrowserUseListeners();
        const downConfirmed = await waitForCondition(() => listBrowserUseListenerPids().length === 0, 5000);
        expect(downConfirmed).toBe(true);

        const beforeStarts = countServiceStarts(sidecar.getAllStderr());
        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'In-process browser recovery probe',
            userQuery: '在 x.com 上发布一条测试动态。先检查登录状态并用浏览器打开发布页。',
            workspacePath: SIDECAR_ROOT,
        }));

        const recoveredInProcess = await waitForCondition(() => {
            const stderr = sidecar?.getAllStderr() || '';
            const starts = countServiceStarts(stderr);
            return starts >= beforeStarts + 1;
        }, 25_000, 300);

        expect(recoveredInProcess).toBe(true);
    }, 60_000);
});
