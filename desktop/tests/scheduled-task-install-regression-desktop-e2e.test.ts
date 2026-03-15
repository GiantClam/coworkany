/**
 * Desktop GUI E2E: scheduled-task UI mirroring + Python install loop termination
 *
 * Run:
 *   cd desktop && npx playwright test tests/scheduled-task-install-regression-desktop-e2e.test.ts --reporter=line
 */

import { test, expect, type Locator } from './tauriFixtureRelease';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const TEST_TIMEOUT_MS = 10 * 60 * 1000;
const SHORT_TASK_TIMEOUT_MS = 3 * 60 * 1000;
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findChatInput(page: any, timeoutMs = 30_000): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 600 }).catch(() => false);
            const enabled = await candidate.isEnabled().catch(() => false);
            if (visible && enabled) {
                return candidate;
            }
        }
        await sleep(400);
    }
    return null;
}

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page, 120_000);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();
    await input!.fill(text);
    await input!.press('Enter');
    await page.waitForTimeout(1500);
}

async function startFreshSession(page: any): Promise<void> {
    const newSessionButton = page.locator('.chat-header-new-session').first();
    const visible = await newSessionButton.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(visible, 'new session button should be visible').toBe(true);
    await newSessionButton.click({ force: true });
    await page.waitForTimeout(800);
}

function getCurrentFrontendPage(context: any, fallbackPage: any): any | null {
    if (fallbackPage && typeof fallbackPage.isClosed === 'function' && !fallbackPage.isClosed()) {
        return fallbackPage;
    }

    try {
        const pages = context.pages().filter((candidate: any) => {
            try {
                const url = String(candidate.url());
                return !candidate.isClosed() && (url.includes('localhost:5173') || url.includes('tauri.localhost'));
            } catch {
                return false;
            }
        });
        return pages.at(-1) ?? null;
    } catch {
        return null;
    }
}

async function waitForTaskOutcome(
    tauriLogs: any,
    timeoutMs: number
): Promise<{ finished: boolean; failed: boolean; rawLogs: string }> {
    const startedAt = Date.now();
    let rawLogs = '';

    while (Date.now() - startedAt < timeoutMs) {
        await sleep(3000);
        rawLogs = tauriLogs.getRawSinceBaseline();
        const finished =
            rawLogs.includes('"type":"TASK_FINISHED"') ||
            /"type":"TASK_STATUS","payload":\{"status":"(?:finished|completed)"\}/.test(rawLogs);
        const failed = rawLogs.includes('"type":"TASK_FAILED"');

        if (finished || failed) {
            return { finished, failed, rawLogs };
        }
    }

    return {
        finished:
            rawLogs.includes('"type":"TASK_FINISHED"') ||
            /"type":"TASK_STATUS","payload":\{"status":"(?:finished|completed)"\}/.test(rawLogs),
        failed: rawLogs.includes('"type":"TASK_FAILED"'),
        rawLogs,
    };
}

function runPython(args: string[], cwd?: string): { code: number | null; stdout: string; stderr: string } {
    const proc = spawnSync('python', args, {
        cwd,
        encoding: 'utf-8',
    });

    return {
        code: proc.status,
        stdout: proc.stdout || '',
        stderr: proc.stderr || '',
    };
}

function ensurePythonPackagesInstalled(sidecarDir: string): void {
    const install = runPython(
        ['-m', 'pip', 'install', '--disable-pip-version-check', 'Pillow', 'imagehash'],
        sidecarDir
    );
    if (install.code !== 0) {
        throw new Error(`Failed to ensure Python packages are installed.\n${install.stdout}\n${install.stderr}`);
    }
}

function parseRunCommandCalls(rawLogs: string): string[] {
    const commands: string[] = [];
    const marker = 'Received from sidecar: ';
    for (const line of rawLogs.split(/\r?\n/)) {
        const idx = line.indexOf(marker);
        if (idx < 0) continue;

        const jsonPart = line.slice(idx + marker.length).trim();
        if (!jsonPart.startsWith('{')) continue;

        try {
            const evt = JSON.parse(jsonPart) as any;
            if (evt?.type === 'TOOL_CALL' && evt?.payload?.name === 'run_command') {
                const command = evt?.payload?.input?.command;
                if (typeof command === 'string' && command.trim().length > 0) {
                    commands.push(command);
                }
            }
        } catch {
            if (line.includes('"type":"TOOL_CALL"') && line.includes('"name":"run_command"')) {
                const match = line.match(/"command":"((?:\\.|[^"\\])*)"/);
                if (!match?.[1]) continue;
                try {
                    const parsed = JSON.parse(`"${match[1]}"`);
                    if (typeof parsed === 'string' && parsed.trim().length > 0) {
                        commands.push(parsed);
                    }
                } catch {
                    // Ignore malformed log lines.
                }
            }
        }
    }
    return commands;
}

function normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

function maxConsecutiveIdentical(commands: string[]): number {
    let max = 0;
    let current = 0;
    let previous = '';

    for (const command of commands.map(normalizeCommand)) {
        if (command === previous) {
            current += 1;
        } else {
            previous = command;
            current = 1;
        }
        max = Math.max(max, current);
    }

    return max;
}

test.describe('Desktop GUI E2E - scheduled task regression fixes', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('mirrors a background scheduled task completion into the currently active install session', async ({ page, context, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        await startFreshSession(page);
        tauriLogs.setBaseline();
        await submitMessage(
            page,
            [
                'Run exactly: python -m pip install --disable-pip-version-check Pillow imagehash',
                'Treat this as a Python package installation task.',
                'If the packages are already installed, stop immediately and do not repeat the install command.',
            ].join('\n')
        );

        const outcome = await waitForTaskOutcome(tauriLogs, SHORT_TASK_TIMEOUT_MS);
        expect(outcome.failed, 'foreground install task should not fail before scheduled mirror is emitted').toBe(false);
        expect(outcome.finished, 'foreground install task should finish before scheduled mirror is emitted').toBe(true);

        const scheduledSummary = 'Background task finished for E2E verification.';
        const scheduledTaskId = 'scheduled_e2e_mirror';
        const timestamp = new Date().toISOString();

        await page.evaluate(async ({ payload }) => {
            await (window as typeof window & {
                __TAURI_INTERNALS__: {
                    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
            }).__TAURI_INTERNALS__.invoke('plugin:event|emit', payload);
        }, {
            payload: {
                event: 'task-event',
                payload: {
                    id: `${scheduledTaskId}:TASK_FINISHED`,
                    taskId: scheduledTaskId,
                    timestamp,
                    sequence: 2,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: scheduledSummary,
                        duration: 1200,
                    },
                },
            },
        });

        const livePage = getCurrentFrontendPage(context, page);
        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });
        await livePage?.screenshot({
            path: path.join(testResultsDir, 'scheduled-task-ui-mirror-e2e-final.png'),
        }).catch(() => {});

        expect(livePage, 'frontend page should remain reachable after scheduled background event emission').toBeTruthy();
        await expect(livePage!.getByText(/\[Scheduled Task Completed\] Background task finished for E2E verification\./, { exact: false }))
            .toBeVisible({ timeout: 20_000 });
    });

    test('completes a Python install task after success and does not loop identical install commands', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        const sidecarDir = path.resolve(process.cwd(), '..', 'sidecar');
        ensurePythonPackagesInstalled(sidecarDir);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);
        await startFreshSession(page);

        tauriLogs.setBaseline();
        await submitMessage(
            page,
            [
                'Run exactly this command and stop when it succeeds:',
                'python -m pip install --disable-pip-version-check Pillow imagehash',
                'If output says "Requirement already satisfied" or "Successfully installed", do not run the same install command again.',
                'Finish the task immediately after the successful installation result.',
            ].join('\n')
        );

        const outcome = await waitForTaskOutcome(tauriLogs, SHORT_TASK_TIMEOUT_MS);
        const rawLogs = outcome.rawLogs;
        const runCommands = parseRunCommandCalls(rawLogs);
        const installCommands = runCommands.filter((command) =>
            normalizeCommand(command).includes('python -m pip install --disable-pip-version-check pillow imagehash')
        );
        const maxRepeat = maxConsecutiveIdentical(installCommands);
        const sawInstallSuccess =
            /requirement already satisfied/i.test(rawLogs) ||
            /successfully installed/i.test(rawLogs);

        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });
        fs.writeFileSync(
            path.join(testResultsDir, 'python-install-loop-regression-e2e-logs.txt'),
            rawLogs,
            'utf-8'
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'python-install-loop-regression-e2e-summary.json'),
            JSON.stringify(
                {
                    finished: outcome.finished,
                    failed: outcome.failed,
                    installCommands,
                    maxConsecutiveInstallRepeat: maxRepeat,
                    sawInstallSuccess,
                },
                null,
                2
            ),
            'utf-8'
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'python-install-loop-regression-e2e-final.png'),
        }).catch(() => {});

        expect(outcome.failed, 'python install task should not fail').toBe(false);
        expect(sawInstallSuccess, 'install command should report a successful installation state').toBe(true);
        expect(installCommands.length, 'agent should run the requested install command').toBeGreaterThan(0);
        expect(maxRepeat, 'identical install command should not loop indefinitely').toBeLessThanOrEqual(3);
        expect(outcome.finished, 'python install task should terminate after successful installation').toBe(true);
    });
});
