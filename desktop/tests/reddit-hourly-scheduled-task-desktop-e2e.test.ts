/**
 * Desktop GUI E2E: Chinese recurring Reddit AI digest scheduling
 *
 * Run:
 *   cd desktop && npx playwright test tests/reddit-hourly-scheduled-task-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 6 * 60 * 1000;
const TARGET_PROMPT = '每1小时检索reddit中最新的ai相关信息，整理总结';
const SIDECAR_WORKSPACE_ROOT = path.resolve(process.cwd(), '..', 'sidecar', 'workspace');
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

type PersistedTrigger = {
    id: string;
    name?: string;
    description?: string;
    type: string;
    config?: {
        intervalMs?: number;
        expression?: string;
    };
    action?: {
        type?: string;
        taskQuery?: string;
        workspacePath?: string;
    };
    enabled?: boolean;
    triggerCount?: number;
};

type TriggerFileState = {
    exists: boolean;
    raw: string;
    triggers: PersistedTrigger[];
};

async function findChatInput(page: any, timeoutMs = 30_000): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
            const enabled = await candidate.isEnabled().catch(() => false);
            if (visible && enabled) {
                return candidate;
            }
        }
        await page.waitForTimeout(400);
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
        if (stat.mtimeMs >= notBeforeMs && stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = triggerFile;
        }
    }

    return newestPath;
}

function readTriggerFile(workspacePath: string): TriggerFileState {
    const triggerFile = path.join(workspacePath, '.coworkany', 'triggers.json');
    if (!fs.existsSync(triggerFile)) {
        return { exists: false, raw: '', triggers: [] };
    }

    const raw = fs.readFileSync(triggerFile, 'utf-8');
    try {
        const parsed = JSON.parse(raw) as { triggers?: PersistedTrigger[] };
        return {
            exists: true,
            raw,
            triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
        };
    } catch {
        return { exists: true, raw, triggers: [] };
    }
}

function cleanupMatchingRedditTasks(sidecarWorkspaceRoot: string): void {
    if (!fs.existsSync(sidecarWorkspaceRoot)) {
        return;
    }

    for (const entry of fs.readdirSync(sidecarWorkspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const workspacePath = path.join(sidecarWorkspaceRoot, entry.name);
        const triggersFile = path.join(workspacePath, '.coworkany', 'triggers.json');
        if (!fs.existsSync(triggersFile)) {
            continue;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(triggersFile, 'utf-8')) as { triggers?: PersistedTrigger[] };
            const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
            const filtered = triggers.filter((trigger) => {
                const taskQuery = trigger.action?.taskQuery?.toLowerCase() ?? '';
                const name = trigger.name?.toLowerCase() ?? '';
                const description = trigger.description?.toLowerCase() ?? '';
                return !(taskQuery.includes('reddit') || name.includes('reddit') || description.includes('reddit'));
            });

            if (filtered.length === triggers.length) {
                continue;
            }

            if (filtered.length === 0) {
                fs.rmSync(triggersFile, { force: true });
            } else {
                fs.writeFileSync(triggersFile, JSON.stringify({ triggers: filtered }, null, 2), 'utf-8');
            }
        } catch {
            // Ignore cleanup failures from stale workspaces.
        }
    }
}

async function openTaskBoard(page: any): Promise<void> {
    await page.locator('.nav-item-collapsed').nth(1).click();
    await expect(page.locator('.task-list-empty-shell, .task-list-view').first()).toBeVisible({ timeout: 15_000 });
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
            timeout: 30_000,
            intervals: [500, 1000, 2000],
            message: 'Task board never reached a ready state',
        },
    ).toBe('ready');
}

test.describe('Desktop GUI E2E - hourly Reddit AI scheduled task', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('creates an hourly Reddit AI digest schedule from Chinese chat input', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        cleanupMatchingRedditTasks(SIDECAR_WORKSPACE_ROOT);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        const taskQuery = [
            TARGET_PROMPT,
            '这是定时任务，不是一次性搜索。',
            '请直接创建任务，而不是只给建议。',
        ].join('\n');

        tauriLogs.setBaseline();
        await input!.fill(taskQuery);
        await input!.press('Enter');
        await page.waitForTimeout(2_000);

        if (
            !tauriLogs.containsSinceBaseline('send_task_message command received') &&
            !tauriLogs.containsSinceBaseline('start_task command received')
        ) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2_000);
            }
        }

        let submitted = false;
        let scheduledToolCalled = false;
        let taskFinished = false;
        let taskFailed = false;
        let stockResearchAutoTriggered = false;
        let workspacePath: string | null = null;
        let triggerFilePath: string | null = null;

        const startedAt = Date.now();
        while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(4_000);
            const rawLogs = tauriLogs.getRawSinceBaseline();
            const lower = rawLogs.toLowerCase();

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');
            scheduledToolCalled =
                scheduledToolCalled ||
                lower.includes('"name":"scheduled_task_create"') ||
                (lower.includes('tool_call') && lower.includes('scheduled_task_create'));
            taskFinished = taskFinished || lower.includes('task_finished');
            taskFailed = taskFailed || lower.includes('task_failed');
            stockResearchAutoTriggered =
                stockResearchAutoTriggered || lower.includes('auto-triggered skills: stock-research');

            workspacePath = workspacePath ?? parseWorkspacePath(rawLogs);
            triggerFilePath = triggerFilePath ?? findNewestTriggerFile(SIDECAR_WORKSPACE_ROOT, startedAt);

            const resolvedWorkspacePath =
                workspacePath ??
                parseWorkspacePath(rawLogs) ??
                (triggerFilePath ? path.dirname(path.dirname(triggerFilePath)) : null);
            const triggerState = resolvedWorkspacePath
                ? readTriggerFile(resolvedWorkspacePath)
                : { exists: false, raw: '', triggers: [] };

            const hasHourlyExecuteTask = triggerState.triggers.some((trigger) => {
                const taskText = `${trigger.name ?? ''} ${trigger.description ?? ''} ${trigger.action?.taskQuery ?? ''}`.toLowerCase();
                return (
                    trigger.type === 'interval' &&
                    trigger.config?.intervalMs === 60 * 60 * 1000 &&
                    trigger.action?.type === 'execute_task' &&
                    taskText.includes('reddit') &&
                    taskText.includes('ai')
                );
            });

            if ((scheduledToolCalled && hasHourlyExecuteTask) || taskFinished || taskFailed) {
                break;
            }
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();
        triggerFilePath = triggerFilePath ?? findNewestTriggerFile(SIDECAR_WORKSPACE_ROOT, startedAt);
        const resolvedWorkspacePath =
            workspacePath ??
            parseWorkspacePath(rawLogs) ??
            (triggerFilePath ? path.dirname(path.dirname(triggerFilePath)) : null);
        const triggerState = resolvedWorkspacePath
            ? readTriggerFile(resolvedWorkspacePath)
            : { exists: false, raw: '', triggers: [] };

        const matchingTrigger = triggerState.triggers.find((trigger) => {
            const taskText = `${trigger.name ?? ''} ${trigger.description ?? ''} ${trigger.action?.taskQuery ?? ''}`.toLowerCase();
            return (
                trigger.type === 'interval' &&
                trigger.config?.intervalMs === 60 * 60 * 1000 &&
                trigger.action?.type === 'execute_task' &&
                taskText.includes('reddit') &&
                taskText.includes('ai')
            );
        });

        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });
        fs.writeFileSync(
            path.join(testResultsDir, 'reddit-hourly-scheduled-task-desktop-e2e-logs.txt'),
            rawLogs,
            'utf-8',
        );

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'scheduled-task request should not fail').toBe(false);
        expect(stockResearchAutoTriggered, 'recurring request should not auto-trigger stock-research').toBe(false);
        expect(scheduledToolCalled, 'agent should call scheduled_task_create').toBe(true);
        expect(resolvedWorkspacePath, 'workspace path should be discoverable from logs').toBeTruthy();
        expect(triggerState.exists, 'trigger file should be persisted under the active workspace').toBe(true);
        expect(matchingTrigger, 'trigger should persist as an hourly Reddit AI execute_task schedule').toBeTruthy();
        expect(matchingTrigger?.enabled, 'new scheduled task should be enabled immediately').toBe(true);
        expect(matchingTrigger?.action?.taskQuery?.toLowerCase() ?? '').toContain('reddit');
        expect(matchingTrigger?.action?.taskQuery?.toLowerCase() ?? '').toContain('ai');
        expect(matchingTrigger?.action?.taskQuery ?? '').toMatch(/总结|摘要|summary/i);

        await openTaskBoard(page);
        await waitForTaskBoardReady(page);
        await page.locator('.task-list-refresh-icon').click();

        if (matchingTrigger?.name) {
            await expect(page.locator('.task-card-title', { hasText: matchingTrigger.name }).first()).toBeVisible({ timeout: 30_000 });
        } else {
            await expect(page.locator('.task-tag-pill', { hasText: '#scheduled' }).first()).toBeVisible({ timeout: 30_000 });
        }
    });
});
