import type { Page } from '@playwright/test';
import { test, expect, type TauriLogCollector } from './tauriFixtureNoChrome';

const SIDE_CAR_STATUS_TIMEOUT_MS = 30_000;

type SidecarStatusResult = {
    running: boolean;
};

async function invokeTauri<T>(
    page: Page,
    cmd: string,
    args: Record<string, unknown> = {},
): Promise<T> {
    return await page.evaluate(
        async ({ c, a }) => {
            const tauri = (window as Window & {
                __TAURI_INTERNALS__?: {
                    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
            }).__TAURI_INTERNALS__;
            if (!tauri?.invoke) {
                throw new Error('__TAURI_INTERNALS__.invoke is unavailable');
            }
            return await tauri.invoke(c, a);
        },
        { c: cmd, a: args },
    ) as T;
}

async function getSidecarRunning(page: Page): Promise<boolean> {
    const status = await invokeTauri<SidecarStatusResult>(page, 'get_sidecar_status');
    return Boolean(status?.running);
}

async function waitForSidecarRunningState(
    page: Page,
    expectedRunning: boolean,
    timeoutMs: number,
): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const running = await getSidecarRunning(page);
            if (running === expectedRunning) {
                return;
            }
        } catch {
            // Keep polling while startup/shutdown transitions settle.
        }
        await page.waitForTimeout(400);
    }
    throw new Error(`Timed out waiting for sidecar running=${expectedRunning}`);
}

function extractSpawnPid(line: string): string | null {
    const match = line.match(/Sidecar spawned with PID:\s*(?:Some\()?([0-9]+)/i);
    return match?.[1] ?? null;
}

function assertSingleSpawnAfterBaseline(tauriLogs: TauriLogCollector): void {
    const spawnedLines = tauriLogs
        .grepSinceBaseline('Sidecar spawned with PID:')
        .filter((line) => line.includes('Sidecar spawned with PID:'));

    expect(
        spawnedLines.length,
        `Expected only one sidecar spawn after baseline, got ${spawnedLines.length}\n${spawnedLines.join('\n')}`,
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
}

test.describe('Desktop sidecar spawn reuse', () => {
    test.skip(process.platform === 'darwin', 'Darwin fixture uses mocked invoke bridge, skip real spawn_sidecar integration');
    test.setTimeout(180_000);

    test('@critical @smoke @regression repeated spawn_sidecar calls reuse the same running sidecar', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');

        // Force a clean baseline: stop any currently connected sidecar transport first.
        await invokeTauri<null>(page, 'shutdown_sidecar');
        await waitForSidecarRunningState(page, false, SIDE_CAR_STATUS_TIMEOUT_MS);

        tauriLogs.setBaseline();

        // First call should start sidecar, subsequent calls should reuse current transport.
        await invokeTauri<null>(page, 'spawn_sidecar');
        await waitForSidecarRunningState(page, true, SIDE_CAR_STATUS_TIMEOUT_MS);
        await invokeTauri<null>(page, 'spawn_sidecar');
        await invokeTauri<null>(page, 'spawn_sidecar');
        await page.waitForTimeout(1500);

        assertSingleSpawnAfterBaseline(tauriLogs);

        const reuseHintPresent =
            tauriLogs.containsSinceBaseline('Sidecar transport already running, skipping spawn')
            || tauriLogs.containsSinceBaseline('Sidecar already running, skipping spawn');
        expect(reuseHintPresent, 'Expected reuse/skip log hint after repeated spawn_sidecar calls').toBe(true);
    });
});
