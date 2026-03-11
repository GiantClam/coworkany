/**
 * Desktop GUI E2E: recurring scheduled task creation
 *
 * Scenario:
 * 1. Launch CoworkAny Desktop through real `tauri dev`
 * 2. Send a recurring scheduling request from the desktop chat input
 * 3. Verify the agent uses `scheduled_task_create`
 * 4. Verify it does NOT get misrouted into `stock-research`
 * 5. Verify a trigger is persisted under the active workspace
 * 6. Verify the created scheduled task appears in the task list UI
 *
 * Run:
 *   cd desktop && npx playwright test tests/scheduled-task-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 6 * 60 * 1000;

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type TriggerFileState = {
    exists: boolean;
    raw: string;
    triggerCount: number;
    triggerNames: string[];
};

async function findChatInput(page: any): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

function parseWorkspacePath(rawLogs: string): string | null {
    const directMatch = rawLogs.match(/"workspacePath":"([^"]+)"/);
    if (directMatch?.[1]) {
        return directMatch[1].replace(/\\\\/g, '\\');
    }
    return null;
}

function findNewestTriggerFile(sidecarWorkspaceRoot: string, notBeforeMs: number): string | null {
    if (!fs.existsSync(sidecarWorkspaceRoot)) {
        return null;
    }

    let newestPath: string | null = null;
    let newestMtime = 0;

    for (const entry of fs.readdirSync(sidecarWorkspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const triggerFile = path.join(sidecarWorkspaceRoot, entry.name, '.coworkany', 'triggers.json');
        if (!fs.existsSync(triggerFile)) continue;

        const stat = fs.statSync(triggerFile);
        const mtime = stat.mtimeMs;
        if (mtime >= notBeforeMs && mtime > newestMtime) {
            newestMtime = mtime;
            newestPath = triggerFile;
        }
    }

    return newestPath;
}

function readTriggerFile(workspacePath: string): TriggerFileState {
    const triggerFile = path.join(workspacePath, '.coworkany', 'triggers.json');
    if (!fs.existsSync(triggerFile)) {
        return { exists: false, raw: '', triggerCount: 0, triggerNames: [] };
    }

    const raw = fs.readFileSync(triggerFile, 'utf-8');
    try {
        const parsed = JSON.parse(raw) as { triggers?: Array<{ name?: string }> };
        const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
        return {
            exists: true,
            raw,
            triggerCount: triggers.length,
            triggerNames: triggers
                .map((item) => item?.name)
                .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
        };
    } catch {
        return { exists: true, raw, triggerCount: 0, triggerNames: [] };
    }
}

function cleanupDesktopE2eArtifacts(sidecarWorkspaceRoot: string): void {
    if (!fs.existsSync(sidecarWorkspaceRoot)) {
        return;
    }

    for (const entry of fs.readdirSync(sidecarWorkspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const workspacePath = path.join(sidecarWorkspaceRoot, entry.name);
        const tasksFile = path.join(workspacePath, '.coworkany', 'jarvis', 'tasks.json');
        const triggersFile = path.join(workspacePath, '.coworkany', 'triggers.json');

        if (fs.existsSync(tasksFile)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(tasksFile, 'utf-8')) as Record<string, unknown>;
                delete parsed['desktop-e2e-regular-task'];
                if (Object.keys(parsed).length === 0) {
                    fs.rmSync(tasksFile, { force: true });
                } else {
                    fs.writeFileSync(tasksFile, JSON.stringify(parsed, null, 2));
                }
            } catch {
                // Ignore cleanup failures.
            }
        }

        if (fs.existsSync(triggersFile)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(triggersFile, 'utf-8')) as { triggers?: Array<{ id?: string }> };
                const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
                const filtered = triggers.filter((trigger) => trigger?.id !== 'desktop-e2e-scheduled-task');
                if (filtered.length === 0) {
                    fs.rmSync(triggersFile, { force: true });
                } else {
                    fs.writeFileSync(triggersFile, JSON.stringify({ triggers: filtered }, null, 2));
                }
            } catch {
                // Ignore cleanup failures.
            }
        }
    }
}

async function openTaskBoard(page: any): Promise<void> {
    await page.locator('.nav-item-collapsed').nth(1).click();
    await expect(page.locator('.task-list-empty-shell, .task-list-view').first()).toBeVisible({ timeout: 15000 });
}

async function waitForTaskBoardReady(page: any): Promise<void> {
    const taskView = page.locator('.task-list-view');
    const errorCard = page.locator('.task-list-error-card');
    const spinner = page.locator('.task-list-spinner');

    await expect.poll(
        async () => {
            if (await errorCard.isVisible().catch(() => false)) {
                return 'error';
            }
            if (await taskView.isVisible().catch(() => false)) {
                return 'ready';
            }
            if (await spinner.isVisible().catch(() => false)) {
                return 'loading';
            }
            return 'unknown';
        },
        {
            timeout: 30000,
            intervals: [500, 1000, 2000],
            message: 'Task board never reached a ready state',
        }
    ).toBe('ready');
}

test.describe('Desktop GUI E2E - scheduled recurring task', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('creates recurring task from desktop chat, persists trigger, and shows it in task list', async ({ page, tauriLogs }) => {
        const sidecarWorkspaceRoot = path.resolve(process.cwd(), '..', 'sidecar', 'workspace');
        cleanupDesktopE2eArtifacts(sidecarWorkspaceRoot);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        const taskQuery = [
            'Create a recurring scheduled task: every hour search the latest AI news and reply to me.',
            'This is a recurring task, not a one-time research request.',
            'Please create the task directly instead of only giving me a plan.',
        ].join('\n');

        tauriLogs.setBaseline();
        await input!.fill(taskQuery);
        await input!.press('Enter');
        await page.waitForTimeout(2000);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received') &&
            !tauriLogs.containsSinceBaseline('start_task command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        let submitted = false;
        let scheduledToolCalled = false;
        let taskFinished = false;
        let taskFailed = false;
        let modelAuthFailed = false;
        let stockResearchAutoTriggered = false;
        let workspacePath: string | null = null;
        let triggerPersisted = false;
        let triggerFilePath: string | null = null;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(4000);
            const elapsed = Math.round((Date.now() - start) / 1000);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');

            scheduledToolCalled =
                scheduledToolCalled ||
                lower.includes('"name":"scheduled_task_create"') ||
                (lower.includes('tool_call') && lower.includes('scheduled_task_create'));

            stockResearchAutoTriggered =
                stockResearchAutoTriggered ||
                lower.includes('auto-triggered skills: stock-research');

            taskFinished = taskFinished || lower.includes('task_finished');
            taskFailed = taskFailed || lower.includes('task_failed');
            modelAuthFailed =
                modelAuthFailed ||
                (lower.includes('401') && lower.includes('invalid api key')) ||
                lower.includes('missing_api_key');

            if (!workspacePath) {
                workspacePath = parseWorkspacePath(logs);
            }

            const triggerWorkspacePath = workspacePath
                ?? parseWorkspacePath(logs)
                ?? (triggerFilePath ? path.dirname(path.dirname(triggerFilePath)) : null);
            const triggerFileState = triggerWorkspacePath
                ? readTriggerFile(triggerWorkspacePath)
                : { exists: false, raw: '', triggerCount: 0, triggerNames: [] };

            triggerPersisted =
                triggerPersisted ||
                (triggerFileState.exists &&
                    triggerFileState.triggerCount > 0 &&
                    triggerFileState.raw.toLowerCase().includes('scheduled'));

            if (!triggerFilePath) {
                triggerFilePath = findNewestTriggerFile(sidecarWorkspaceRoot, start);
            }

            if ((scheduledToolCalled && triggerPersisted) || taskFinished || taskFailed || modelAuthFailed) {
                console.log(`[${elapsed}s] stop condition met`);
                break;
            }

            if (elapsed % 30 === 0) {
                console.log(
                    `[${elapsed}s] submitted=${submitted} scheduled=${scheduledToolCalled} triggerPersisted=${triggerPersisted} finished=${taskFinished} failed=${taskFailed} workspace=${workspacePath ?? 'n/a'}`
                );
            }
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();
        triggerFilePath = triggerFilePath ?? findNewestTriggerFile(sidecarWorkspaceRoot, start);
        const resolvedWorkspacePath = workspacePath
            ?? parseWorkspacePath(rawLogs)
            ?? (triggerFilePath ? path.dirname(path.dirname(triggerFilePath)) : null);
        const triggerFileState = resolvedWorkspacePath
            ? readTriggerFile(resolvedWorkspacePath)
            : { exists: false, raw: '', triggerCount: 0, triggerNames: [] };

        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });
        fs.writeFileSync(
            path.join(testResultsDir, 'scheduled-task-desktop-e2e-logs.txt'),
            rawLogs,
            'utf-8'
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'scheduled-task-desktop-e2e-summary.json'),
            JSON.stringify(
                {
                    submitted,
                    scheduledToolCalled,
                    stockResearchAutoTriggered,
                    taskFinished,
                    taskFailed,
                    modelAuthFailed,
                    workspacePath: resolvedWorkspacePath,
                    triggerFilePath,
                    triggerFile: triggerFileState,
                },
                null,
                2
            ),
            'utf-8'
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'scheduled-task-desktop-e2e-final.png'),
        }).catch(() => {});

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(stockResearchAutoTriggered, 'should not auto-trigger stock-research for recurring scheduling requests').toBe(false);
        expect(modelAuthFailed, 'desktop test environment must have a valid model API configuration').toBe(false);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(scheduledToolCalled, 'agent should call scheduled_task_create').toBe(true);
        expect(resolvedWorkspacePath, 'workspace path should be discoverable from logs').toBeTruthy();
        expect(triggerFileState.exists, 'trigger file should be created under active workspace').toBe(true);
        expect(triggerFileState.triggerCount, 'at least one trigger should be persisted').toBeGreaterThan(0);
        expect(triggerFileState.raw.toLowerCase()).toContain('scheduled');

        await openTaskBoard(page);
        await waitForTaskBoardReady(page);
        await page.locator('.task-list-refresh-icon').click();

        if (triggerFileState.triggerNames.at(-1)) {
            await expect(page.locator('.task-card-title', { hasText: triggerFileState.triggerNames.at(-1)! })).toBeVisible({ timeout: 30000 });
        } else {
            await expect(page.locator('.task-tag-pill', { hasText: '#scheduled' }).first()).toBeVisible({ timeout: 30000 });
        }
    });
});
