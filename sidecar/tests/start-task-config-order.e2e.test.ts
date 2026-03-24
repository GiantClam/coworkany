import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    SidecarProcess,
    buildBootstrapRuntimeContextCommand,
    buildStartTaskCommand,
} from './helpers/sidecar-harness';

let sidecar: SidecarProcess | null = null;

function resolveSidecarCwd(): string {
    const nested = path.join(process.cwd(), 'sidecar', 'src', 'main.ts');
    if (fs.existsSync(nested)) {
        return path.join(process.cwd(), 'sidecar');
    }
    return process.cwd();
}

async function waitForLogs(
    getLogs: () => string,
    predicate: (logs: string) => boolean,
    timeoutMs: number
): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const logs = getLogs();
        if (predicate(logs)) {
            return logs;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return getLogs();
}

describe('start_task config initialization order (e2e)', () => {
    afterAll(() => {
        sidecar?.kill();
        sidecar = null;
    });

    test('loads llm-config before first web research after start_task', async () => {
        const sidecarCwd = resolveSidecarCwd();
        const workspaceRoot = path.resolve(sidecarCwd, '..');
        const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-start-order-'));
        const configPath = path.join(appDataDir, 'llm-config.json');

        try {
            // Use an explicit search provider to make web-search log matching deterministic.
            fs.writeFileSync(configPath, JSON.stringify({
                provider: 'anthropic',
                search: {
                    provider: 'serper',
                    serperApiKey: 'test-key',
                },
            }, null, 2));

            sidecar = new SidecarProcess(undefined, { cwd: sidecarCwd });
            await sidecar.start();

            sidecar.sendCommand(buildBootstrapRuntimeContextCommand({
                appDataDir,
                appDir: sidecarCwd,
            }));

            sidecar.sendCommand(buildStartTaskCommand({
                taskId: randomUUID(),
                title: 'config-order-e2e',
                userQuery: '5秒后，只回复：阶段1完成。然后再等5秒，只回复：阶段2完成。',
                workspacePath: workspaceRoot,
            }));

            const logs = await waitForLogs(
                () => sidecar?.getAllStderr() ?? '',
                (stderr) => {
                    const startIdx = stderr.indexOf('Valid command, handling: start_task');
                    if (startIdx < 0) return false;

                    const afterStart = stderr.slice(startIdx);
                    const loadIdx = afterStart.indexOf(`[LlmConfig] Loaded config from ${configPath}`);
                    const serperIdx = afterStart.indexOf('[WebSearch] Trying Serper.dev search...');
                    const searxIdx = afterStart.indexOf('[WebSearch] Fetching SearXNG instances from searx.space...');
                    const searchIdxCandidates = [serperIdx, searxIdx].filter((idx) => idx >= 0);
                    if (loadIdx < 0 || searchIdxCandidates.length === 0) return false;

                    const firstSearchIdx = Math.min(...searchIdxCandidates);
                    return loadIdx < firstSearchIdx;
                },
                30_000
            );

            const startIdx = logs.indexOf('Valid command, handling: start_task');
            expect(startIdx).toBeGreaterThanOrEqual(0);
            const afterStart = logs.slice(startIdx);

            const loadIdx = afterStart.indexOf(`[LlmConfig] Loaded config from ${configPath}`);
            const serperIdx = afterStart.indexOf('[WebSearch] Trying Serper.dev search...');
            const searxIdx = afterStart.indexOf('[WebSearch] Fetching SearXNG instances from searx.space...');
            const searchIdxCandidates = [serperIdx, searxIdx].filter((idx) => idx >= 0);
            const firstSearchIdx = searchIdxCandidates.length > 0 ? Math.min(...searchIdxCandidates) : -1;

            expect(loadIdx).toBeGreaterThanOrEqual(0);
            expect(firstSearchIdx).toBeGreaterThanOrEqual(0);
            expect(loadIdx).toBeLessThan(firstSearchIdx);
        } finally {
            sidecar?.kill();
            sidecar = null;
            fs.rmSync(appDataDir, { recursive: true, force: true });
        }
    }, 120_000);
});

