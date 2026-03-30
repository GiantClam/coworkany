import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildBrowserConcurrentScenarioMatrix,
    buildBrowserTaskInventory,
    runConcurrentBrowserDesktopScenario,
    type BrowserConcurrentScenario,
} from './utils/browserConcurrentScenarioFramework';

const TASK_TIMEOUT_MS = Number(process.env.COWORKANY_BROWSER_SCENARIO_TIMEOUT_MS ?? 9 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.COWORKANY_BROWSER_SCENARIO_POLL_MS ?? 3000);

const REPO_ROOT = path.resolve(process.cwd(), '..');
const ARTIFACT_DIR = path.join(REPO_ROOT, 'artifacts', 'desktop-browser-concurrent-scenarios');
const BROWSER_USE_PORT = Number(process.env.BROWSER_USE_PORT ?? 8100);
const BROWSER_USE_SERVICE_URL = (
    process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL?.trim()
    || `http://127.0.0.1:${BROWSER_USE_PORT}`
).replace(/\/$/, '');
const BROWSER_USE_HEALTH_URL = `${BROWSER_USE_SERVICE_URL}/health`;
const ORIGINAL_ENABLE_SHARED_CDP = process.env.COWORKANY_TEST_ENABLE_BROWSER_SHARED_CDP;
const ORIGINAL_DISABLE_BROWSER_CDP = process.env.COWORKANY_DISABLE_BROWSER_CDP;
const ORIGINAL_ISOLATE_APP_DATA = process.env.COWORKANY_TEST_ISOLATE_APP_DATA;
const ORIGINAL_BROWSER_USE_SERVICE_URL = process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL;

type BrowserUseServiceHandle = {
    available: boolean;
    startedByTest: boolean;
    reason: string;
    process: null;
    stderrTail: string;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isBrowserUseHealthy(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: 'GET' });
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForBrowserUseHealth(url: string, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isBrowserUseHealthy(url)) {
            return true;
        }
        await wait(500);
    }
    return false;
}

async function ensureBrowserUseService(): Promise<BrowserUseServiceHandle> {
    if (await isBrowserUseHealthy(BROWSER_USE_HEALTH_URL)) {
        return {
            available: true,
            startedByTest: false,
            reason: `browser-use-service already healthy at ${BROWSER_USE_HEALTH_URL}`,
            process: null,
            stderrTail: '',
        };
    }
    const healthyAfterGrace = await waitForBrowserUseHealth(BROWSER_USE_HEALTH_URL, 5_000);
    if (healthyAfterGrace) {
        return {
            available: true,
            startedByTest: false,
            reason: `browser-use-service became healthy at ${BROWSER_USE_HEALTH_URL}`,
            process: null,
            stderrTail: '',
        };
    }

    return {
        available: false,
        startedByTest: false,
        reason: `browser-use-service is unavailable at ${BROWSER_USE_HEALTH_URL}; start it externally before running agentbrowser scenarios`,
        process: null,
        stderrTail: '',
    };
}

async function stopBrowserUseService(handle: BrowserUseServiceHandle | null): Promise<void> {
    const _ = handle;
}

function scenarioRequiresAgentBrowser(scenario: BrowserConcurrentScenario): boolean {
    return scenario.tasks.some((task) => task.backend === 'agentbrowser');
}

test.describe('Desktop concurrent browser scenarios (agentbrowser + playwright)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(TASK_TIMEOUT_MS + 300_000);

    let browserUseHandle: BrowserUseServiceHandle | null = null;

    test.beforeAll(async () => {
        process.env.COWORKANY_TEST_ENABLE_BROWSER_SHARED_CDP = 'true';
        process.env.COWORKANY_DISABLE_BROWSER_CDP = 'false';
        process.env.COWORKANY_TEST_ISOLATE_APP_DATA = 'true';
        process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL = BROWSER_USE_SERVICE_URL;

        ensureDir(ARTIFACT_DIR);
        fs.writeFileSync(
            path.join(ARTIFACT_DIR, 'browser-task-inventory.json'),
            JSON.stringify(buildBrowserTaskInventory(), null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(ARTIFACT_DIR, 'browser-scenario-matrix.json'),
            JSON.stringify(buildBrowserConcurrentScenarioMatrix(), null, 2),
            'utf-8',
        );

        browserUseHandle = await ensureBrowserUseService();
        fs.writeFileSync(
            path.join(ARTIFACT_DIR, 'browser-use-service-bootstrap.json'),
            JSON.stringify(browserUseHandle, null, 2),
            'utf-8',
        );
    });

    test.afterAll(async () => {
        if (browserUseHandle?.startedByTest) {
            await stopBrowserUseService(browserUseHandle);
        }

        if (ORIGINAL_ENABLE_SHARED_CDP === undefined) {
            delete process.env.COWORKANY_TEST_ENABLE_BROWSER_SHARED_CDP;
        } else {
            process.env.COWORKANY_TEST_ENABLE_BROWSER_SHARED_CDP = ORIGINAL_ENABLE_SHARED_CDP;
        }

        if (ORIGINAL_DISABLE_BROWSER_CDP === undefined) {
            delete process.env.COWORKANY_DISABLE_BROWSER_CDP;
        } else {
            process.env.COWORKANY_DISABLE_BROWSER_CDP = ORIGINAL_DISABLE_BROWSER_CDP;
        }

        if (ORIGINAL_ISOLATE_APP_DATA === undefined) {
            delete process.env.COWORKANY_TEST_ISOLATE_APP_DATA;
        } else {
            process.env.COWORKANY_TEST_ISOLATE_APP_DATA = ORIGINAL_ISOLATE_APP_DATA;
        }

        if (ORIGINAL_BROWSER_USE_SERVICE_URL === undefined) {
            delete process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL;
        } else {
            process.env.COWORKANY_TEST_BROWSER_USE_SERVICE_URL = ORIGINAL_BROWSER_USE_SERVICE_URL;
        }
    });

    const scenarios = buildBrowserConcurrentScenarioMatrix();
    for (const scenario of scenarios) {
        test(`browser concurrent scenario: ${scenario.id}`, async ({ page, tauriLogs }) => {
            if (scenarioRequiresAgentBrowser(scenario) && !browserUseHandle?.available) {
                test.skip(true, `Agentbrowser scenarios require browser-use-service: ${browserUseHandle?.reason ?? 'unavailable'}`);
                return;
            }

            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(5000);

            const result = await runConcurrentBrowserDesktopScenario({
                page,
                tauriLogs,
                scenario,
                timeoutMs: TASK_TIMEOUT_MS,
                pollIntervalMs: POLL_INTERVAL_MS,
                workspacePath: REPO_ROOT,
            });

            const summary = {
                scenario,
                browserUseBootstrap: browserUseHandle,
                result,
            };

            const rawLogs = tauriLogs.getRawSinceBaseline();
            fs.writeFileSync(
                path.join(ARTIFACT_DIR, `browser-concurrent-${scenario.id}-summary.json`),
                JSON.stringify(summary, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(ARTIFACT_DIR, `browser-concurrent-${scenario.id}-logs.txt`),
                rawLogs,
                'utf-8',
            );
            await page.screenshot({
                path: path.join(ARTIFACT_DIR, `browser-concurrent-${scenario.id}-final.png`),
            }).catch(() => {});

            if (result.externalFailure) {
                test.skip(true, `External dependency/config failure detected in scenario ${scenario.id}`);
                return;
            }

            expect(result.allSubmitted, 'all browser tasks should be submitted by desktop invoke(start_task)').toBe(true);
            expect(result.allStarted, 'all browser tasks should emit TASK_STARTED').toBe(true);
            expect(result.allNoFailure, 'no browser task should fail').toBe(true);
            expect(result.backendCoverageOk, 'each task should honor backend expectation (agentbrowser or playwright)').toBe(true);
            expect(result.isolationOk, 'task markers should remain isolated without cross-task contamination').toBe(true);
            expect(result.loginCollaborationOk, 'login-required tasks should produce suspend/help signals (and resume evidence when available)').toBe(true);
            expect(result.completionOk, 'each task should reach finish or verified post-resume continuation').toBe(true);
            expect(result.allTasksPassed, 'scenario should pass all checks').toBe(true);
        });
    }
});
