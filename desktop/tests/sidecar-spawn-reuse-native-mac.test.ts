import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const DESKTOP_DIR = path.resolve(__dirnameLocal, '..');

const EXTRA_SPAWN_ATTEMPTS = 3;

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
    fn: () => boolean,
    timeoutMs: number,
    description: string,
): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (fn()) {
            return;
        }
        await wait(500);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function terminateProcessTree(processRef: ChildProcess | null): Promise<void> {
    if (!processRef?.pid) return;

    try {
        processRef.kill('SIGTERM');
    } catch {
        return;
    }

    await wait(1500);
    if (processRef.exitCode !== null) {
        return;
    }

    try {
        process.kill(processRef.pid, 'SIGKILL');
    } catch {
        // ignore stale pid
    }
}

function extractSpawnPid(line: string): string | null {
    const match = line.match(/Sidecar spawned with PID:\s*(?:Some\()?([0-9]+)/i);
    return match?.[1] ?? null;
}

test.describe('native macOS sidecar spawn reuse', () => {
    test.skip(process.platform !== 'darwin', 'macOS-only native integration test');

    test('@smoke @regression repeated real spawn attempts keep one sidecar instance', async () => {
        test.setTimeout(8 * 60 * 1000);

        const tempAppDataDir = fs.mkdtempSync(
            path.join(fs.realpathSync(os.tmpdir()), 'coworkany-sidecar-spawn-reuse-'),
        );

        const tauriLogs = new TauriLogCollector();
        const tauriProc = spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                env: {
                    ...process.env,
                    COWORKANY_APP_DATA_DIR: tempAppDataDir,
                    COWORKANY_DISABLE_BROWSER_CDP: 'true',
                    COWORKANY_FORCE_DEVELOPMENT_SIDECAR: '1',
                    COWORKANY_TEST_REPEAT_SPAWN_SIDE_CAR_ATTEMPTS: String(EXTRA_SPAWN_ATTEMPTS),
                    COWORKANY_TEST_REPEAT_SPAWN_SIDE_CAR_DELAY_MS: '250',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        tauriProc.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            process.stderr.write(`[tauri-stdout] ${text}`);
        });
        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            process.stderr.write(`[tauri] ${text}`);
        });

        try {
            await waitFor(
                () => tauriLogs.contains('Sidecar repeat-spawn test hook enabled'),
                180_000,
                'repeat-spawn hook enable log',
            );

            await waitFor(
                () => tauriLogs.contains('Sidecar repeat-spawn test hook completed'),
                180_000,
                'repeat-spawn hook completion log',
            );

            const spawnedLines = tauriLogs
                .getLines()
                .filter((line) => line.includes('Sidecar spawned with PID:'));
            expect(
                spawnedLines.length,
                `Expected one sidecar spawn line, got ${spawnedLines.length}\n${spawnedLines.join('\n')}`,
            ).toBe(1);

            const pids = new Set(
                spawnedLines
                    .map(extractSpawnPid)
                    .filter((pid): pid is string => Boolean(pid)),
            );
            expect(
                pids.size,
                `Expected one unique spawned PID, got ${pids.size}\n${spawnedLines.join('\n')}`,
            ).toBe(1);

            const reuseLines = tauriLogs
                .getLines()
                .filter((line) => line.includes('Sidecar transport already running, skipping spawn'));
            expect(
                reuseLines.length,
                `Expected at least ${EXTRA_SPAWN_ATTEMPTS} reuse logs, got ${reuseLines.length}`,
            ).toBeGreaterThanOrEqual(EXTRA_SPAWN_ATTEMPTS);
        } finally {
            await terminateProcessTree(tauriProc);
            fs.rmSync(tempAppDataDir, { recursive: true, force: true });
        }
    });
});
