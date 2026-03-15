/**
 * Desktop GUI E2E: one-off delayed Reddit AI summary execution
 *
 * Run:
 *   cd desktop && npx playwright test tests/delayed-reddit-summary-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureRelease';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 7 * 60 * 1000;
const TARGET_PROMPT = '2分钟之后，总结reddit关于ai的热点信息，发给我';
const SIDECAR_WORKSPACE_ROOT = path.resolve(process.cwd(), '..', 'sidecar', 'workspace');
const PACKAGED_SIDECAR_ROOT = path.resolve(
    process.cwd(),
    'src-tauri',
    'target',
    'x86_64-pc-windows-msvc',
    'release',
    'sidecar',
);
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
        runAt?: string;
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

function hasToolCall(logs: string, toolName: string): boolean {
    const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolCallPattern = new RegExp(`"type":"TOOL_CALL"[\\s\\S]*?"name":"${escapedName}"`, 'i');
    return toolCallPattern.test(logs);
}

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

function cleanupMatchingDelayedTasks(sidecarWorkspaceRoot: string): void {
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
                const taskText = `${trigger.name ?? ''} ${trigger.description ?? ''} ${trigger.action?.taskQuery ?? ''}`.toLowerCase();
                return !(taskText.includes('reddit') && taskText.includes('ai'));
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

function cleanupPackagedSidecarTriggers(sidecarRoot: string): void {
    const triggersFile = path.join(sidecarRoot, '.coworkany', 'triggers.json');
    if (!fs.existsSync(triggersFile)) {
        return;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(triggersFile, 'utf-8')) as { triggers?: PersistedTrigger[] };
        const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
        const filtered = triggers.filter((trigger) => {
            const taskText = `${trigger.name ?? ''} ${trigger.description ?? ''} ${trigger.action?.taskQuery ?? ''}`.toLowerCase();
            return !(taskText.includes('reddit') && taskText.includes('ai'));
        });

        if (filtered.length === 0) {
            fs.rmSync(triggersFile, { force: true });
            return;
        }

        if (filtered.length !== triggers.length) {
            fs.writeFileSync(triggersFile, JSON.stringify({ triggers: filtered }, null, 2), 'utf-8');
        }
    } catch {
        // Ignore stale or malformed persisted trigger files in packaged sidecar state.
    }
}

test.describe('Desktop GUI E2E - delayed Reddit AI summary execution', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('creates a one-off execute_task trigger and runs it after 2 minutes instead of degrading into reminder-only notify', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        cleanupMatchingDelayedTasks(SIDECAR_WORKSPACE_ROOT);
        cleanupPackagedSidecarTriggers(PACKAGED_SIDECAR_ROOT);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(TARGET_PROMPT);
        await input!.press('Enter');
        await page.waitForTimeout(2_000);

        let submitted = false;
        let scheduledToolCalled = false;
        let reminderToolCalled = false;
        let taskFailed = false;
        let workspacePath: string | null = null;
        let matchingTrigger: PersistedTrigger | null = null;
        const startedAt = Date.now();

        while (Date.now() - startedAt < 150_000) {
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
                hasToolCall(rawLogs, 'scheduled_task_create');
            reminderToolCalled =
                reminderToolCalled ||
                hasToolCall(rawLogs, 'set_reminder');
            taskFailed = taskFailed || lower.includes('task_failed');

            workspacePath = workspacePath ?? parseWorkspacePath(rawLogs);
            const triggerState = workspacePath
                ? readTriggerFile(workspacePath)
                : { exists: false, raw: '', triggers: [] };

                matchingTrigger =
                matchingTrigger ??
                triggerState.triggers.find((trigger) => {
                    const taskText = `${trigger.name ?? ''} ${trigger.description ?? ''} ${trigger.action?.taskQuery ?? ''}`.toLowerCase();
                    const runAtValue = trigger.config?.runAt ? new Date(trigger.config.runAt).getTime() : Number.NaN;
                    return (
                        trigger.type === 'date' &&
                        trigger.action?.type === 'execute_task' &&
                        Number.isFinite(runAtValue) &&
                        runAtValue > startedAt + 60_000 &&
                        runAtValue < startedAt + 3 * 60_000 + 15_000 &&
                        taskText.includes('reddit') &&
                        taskText.includes('ai')
                    );
                }) ??
                null;

            if ((scheduledToolCalled && matchingTrigger) || taskFailed) {
                break;
            }
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();
        workspacePath = workspacePath ?? parseWorkspacePath(rawLogs);
        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'delayed scheduling request should not fail').toBe(false);
        expect(scheduledToolCalled, 'agent should call scheduled_task_create for delayed execution').toBe(true);
        expect(reminderToolCalled, 'agent should not route delayed work into set_reminder').toBe(false);
        expect(workspacePath, 'workspace path should be discoverable from logs').toBeTruthy();
        expect(matchingTrigger, 'trigger should persist as a date execute_task schedule').toBeTruthy();
        expect(matchingTrigger?.config?.runAt, 'one-off execute_task trigger should include runAt').toBeTruthy();

        const runAtMs = new Date(matchingTrigger!.config!.runAt!).getTime();
        expect(runAtMs).toBeGreaterThan(startedAt + 60_000);
        expect(runAtMs).toBeLessThan(startedAt + 3 * 60_000);

        tauriLogs.setBaseline();

        let triggerFired = false;
        let notifyOnlyReminder = false;
        let scheduledTaskStarted = false;
        const executionDeadline = Date.now() + Math.max(210_000, runAtMs - Date.now() + 75_000);
        while (Date.now() < executionDeadline) {
            await page.waitForTimeout(4_000);
            const executionLogs = tauriLogs.getRawSinceBaseline();
            const lower = executionLogs.toLowerCase();

            triggerFired =
                triggerFired ||
                lower.includes('[heartbeat] trigger fired:') ||
                lower.includes(`trigger fired: ${String(matchingTrigger?.name ?? '').toLowerCase()}`);
            notifyOnlyReminder =
                notifyOnlyReminder ||
                lower.includes('[heartbeat][notify][reminder]') ||
                lower.includes('"summary":"[reminder]');
            scheduledTaskStarted =
                scheduledTaskStarted ||
                /"taskId":"scheduled_[^"]+"/.test(executionLogs) ||
                (lower.includes('"type":"task_started"') &&
                    lower.includes('scheduled task') &&
                    lower.includes('reddit') &&
                    lower.includes('ai'));

            if ((triggerFired && scheduledTaskStarted) || notifyOnlyReminder) {
                break;
            }
        }

        let finalTriggerState = workspacePath ? readTriggerFile(workspacePath) : { exists: false, raw: '', triggers: [] };
        const removalDeadline = Date.now() + 15_000;
        while (Date.now() < removalDeadline) {
            if (!finalTriggerState.triggers.some((trigger) => trigger.id === matchingTrigger!.id)) {
                break;
            }
            await page.waitForTimeout(1_000);
            finalTriggerState = workspacePath ? readTriggerFile(workspacePath) : { exists: false, raw: '', triggers: [] };
        }
        const testResultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(testResultsDir, { recursive: true });
        fs.writeFileSync(
            path.join(testResultsDir, 'delayed-reddit-summary-desktop-e2e-logs.txt'),
            `${rawLogs}\n\n===== EXECUTION =====\n\n${tauriLogs.getRawSinceBaseline()}`,
            'utf-8',
        );

        expect(triggerFired, 'date trigger should fire after roughly 2 minutes').toBe(true);
        expect(notifyOnlyReminder, 'delayed execution should not degrade into notify-only reminder').toBe(false);
        expect(scheduledTaskStarted, 'heartbeat should start a scheduled task when the trigger fires').toBe(true);
        expect(
            finalTriggerState.triggers.some((trigger) => trigger.id === matchingTrigger!.id),
            'one-off date trigger should be removed after firing',
        ).toBe(false);
    });
});
