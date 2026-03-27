import { describe, test, expect, beforeEach } from 'bun:test';
import { execSync } from 'child_process';

const SIDECAR_ROOT = '/Users/beihuang/Documents/github/coworkany/sidecar';
const BROWSER_PORT = 8100;

function platformSupportsLsof(): boolean {
    return process.platform !== 'win32';
}

function killBrowserUseListeners(): void {
    if (!platformSupportsLsof()) return;
    try {
        const pidsRaw = execSync(`lsof -tiTCP:${BROWSER_PORT} -sTCP:LISTEN`, {
            encoding: 'utf-8',
        }).trim();
        if (!pidsRaw) return;
        const pids = pidsRaw.split('\n').map((item) => item.trim()).filter(Boolean);
        for (const pid of pids) {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
    } catch {
        // No listener or lsof unavailable.
    }
}

function countStartupReadyLogs(output: string): number {
    return (output.match(/\[BrowserUse\] startup: available/g) || []).length;
}

function countServiceStartLogs(output: string): number {
    return (output.match(/\[BrowserUseService\] starting with/g) || []).length;
}

function runSidecarSession(options: {
    holdSeconds: number;
    crashAtSeconds?: number[];
}): string {
    const crashScript = (options.crashAtSeconds || [])
        .map((seconds) => `sleep ${Math.max(0, seconds)}; pids=$(lsof -tiTCP:${BROWSER_PORT} -sTCP:LISTEN || true); if [ -n \"$pids\" ]; then kill -9 $pids || true; fi`)
        .join('; ');

    const feeder = crashScript.length > 0
        ? `((${crashScript}) & sleep ${options.holdSeconds}; printf '')`
        : `(sleep ${options.holdSeconds}; printf '')`;

    const cmd = `cd ${SIDECAR_ROOT} && ${feeder} | bun run src/main.ts 2>&1`;

    return execSync(cmd, {
        encoding: 'utf-8',
        timeout: (options.holdSeconds + 40) * 1000,
        maxBuffer: 10 * 1024 * 1024,
    });
}

describe('Browser Service Resilience E2E', () => {
    beforeEach(() => {
        killBrowserUseListeners();
    });

    test('long-running session keeps sidecar healthy and exits cleanly', () => {
        if (!platformSupportsLsof()) return;

        const holdSeconds = Number(process.env.E2E_LONG_HOLD_SECONDS || 15);
        const output = runSidecarSession({ holdSeconds });

        expect(countServiceStartLogs(output)).toBeGreaterThanOrEqual(1);
        expect(countStartupReadyLogs(output)).toBeGreaterThanOrEqual(1);
        expect(output.includes('Sidecar IPC stdin closed')).toBe(true);
        expect(output.includes('BrowserUseService] exited')).toBe(true);
    }, 90_000);

    test('repeated sidecar restarts can repeatedly bootstrap browser-use', () => {
        if (!platformSupportsLsof()) return;

        const cycles = Number(process.env.E2E_RESTART_CYCLES || 3);
        const holdSeconds = Number(process.env.E2E_RESTART_HOLD_SECONDS || 4);

        let totalReadyLogs = 0;
        let totalStartLogs = 0;

        for (let i = 0; i < cycles; i += 1) {
            killBrowserUseListeners();
            const output = runSidecarSession({ holdSeconds });
            totalReadyLogs += countStartupReadyLogs(output);
            totalStartLogs += countServiceStartLogs(output);
            expect(output.includes('Sidecar IPC stdin closed')).toBe(true);
        }

        expect(totalStartLogs).toBeGreaterThanOrEqual(cycles);
        expect(totalReadyLogs).toBeGreaterThanOrEqual(cycles);
    }, 120_000);

    test('network jitter / repeated crash simulation remains recoverable across restarts', () => {
        if (!platformSupportsLsof()) return;

        const outputA = runSidecarSession({
            holdSeconds: Number(process.env.E2E_CRASH_HOLD_SECONDS || 8),
            crashAtSeconds: [2, 2, 2],
        });

        // First session may lose service due forced kills; second restart must recover.
        const outputB = runSidecarSession({
            holdSeconds: Number(process.env.E2E_CRASH_HOLD_SECONDS || 8),
            crashAtSeconds: [2, 2],
        });

        expect(countServiceStartLogs(outputA)).toBeGreaterThanOrEqual(1);
        expect(countServiceStartLogs(outputB)).toBeGreaterThanOrEqual(1);
        expect(countStartupReadyLogs(outputB)).toBeGreaterThanOrEqual(1);
        expect(outputB.includes('Sidecar IPC stdin closed')).toBe(true);
    }, 150_000);
});
