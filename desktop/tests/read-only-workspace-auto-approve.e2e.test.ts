/**
 * Desktop GUI E2E: read-only workspace command auto-approval
 *
 * Verifies that a natural-language request sent from desktop chat UI can
 * trigger read-only workspace command execution without approval popups/events.
 *
 * Run:
 *   cd desktop && npx playwright test tests/read-only-workspace-auto-approve.e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const QUERY = [
    '请严格按下面要求执行，不要省略：',
    '1) 必须调用工作区命令执行工具，执行只读命令：pwd && ls -la | head -n 20 && git status --short',
    '2) 只返回命令输出结果，不要修改任何文件。',
].join('\n');

const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function hasSupportedProviderEnv(): boolean {
    return [
        process.env.E2E_AIBERM_API_KEY,
        process.env.OPENAI_API_KEY,
        process.env.OPENROUTER_API_KEY,
        process.env.ANTHROPIC_API_KEY,
    ].some((value) => Boolean(value?.trim()));
}

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

function extractLatestTaskId(logs: string): string | null {
    const matches = logs.matchAll(/"type":"TASK_STARTED","taskId":"([^"]+)"/g);
    let last: string | null = null;
    for (const match of matches) {
        if (match[1]) {
            last = match[1];
        }
    }
    return last;
}

test.describe('Desktop GUI E2E - read-only workspace auto-approve', () => {
    test.skip(
        !hasSupportedProviderEnv(),
        'Requires one of E2E_AIBERM_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.',
    );
    test.setTimeout(TASK_TIMEOUT_MS + 120_000);

    test('read-only workspace commands should execute without EFFECT_REQUESTED', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(10_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(QUERY);
        await input!.press('Enter');
        await page.waitForTimeout(2000);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        let submitted = false;
        let taskId: string | null = null;
        let readOnlyToolCallUsed = false;
        let taskFinished = false;
        let taskFailed = false;
        let taskFailedPayload = '';
        let effectRequestedForTask = false;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);

            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();

            submitted =
                submitted
                || lower.includes('send_task_message command received')
                || lower.includes('start_task command received')
                || lower.includes('"type":"start_task"');

            if (!taskId) {
                taskId = extractLatestTaskId(logs);
            }

            if (taskId) {
                readOnlyToolCallUsed =
                    readOnlyToolCallUsed
                    || logs.includes(`"type":"TASK_EVENT","taskId":"${taskId}"`)
                    && logs.includes('"toolName":"mastra_workspace_execute_command"')
                    && (
                        logs.includes('"command":"pwd && ls -la | head -n 20 && git status --short"')
                        || logs.includes('"command":"pwd')
                        || logs.includes('"command":"git status --short"')
                    );

                taskFinished =
                    taskFinished
                    || logs.includes(`"type":"TASK_FINISHED","taskId":"${taskId}"`)
                    || logs.includes(`"type":"TASK_EVENT","taskId":"${taskId}"`) && lower.includes('"type":"complete"');
                taskFailed =
                    taskFailed
                    || logs.includes(`"type":"TASK_FAILED","taskId":"${taskId}"`)
                    || logs.includes(`"type":"TASK_EVENT","taskId":"${taskId}"`) && lower.includes('"type":"error"');
                if (logs.includes(`"type":"TASK_FAILED","taskId":"${taskId}"`)) {
                    taskFailedPayload = logs;
                }

                effectRequestedForTask =
                    effectRequestedForTask
                    || logs.includes(`"type":"EFFECT_REQUESTED","taskId":"${taskId}"`);
            } else {
                readOnlyToolCallUsed =
                    readOnlyToolCallUsed
                    || logs.includes('"toolName":"mastra_workspace_execute_command"')
                    && (
                        logs.includes('"command":"pwd && ls -la | head -n 20 && git status --short"')
                        || logs.includes('"command":"pwd')
                        || logs.includes('"command":"git status --short"')
                    );
                effectRequestedForTask =
                    effectRequestedForTask
                    || logs.includes('"type":"EFFECT_REQUESTED"');
            }

            if (taskFinished || taskFailed) {
                break;
            }
        }

        const summary = {
            query: QUERY,
            taskId,
            submitted,
            readOnlyToolCallUsed,
            effectRequestedForTask,
            taskFinished,
            taskFailed,
            taskFailedPayloadSnippet: taskFailedPayload.slice(-600),
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'read-only-workspace-auto-approve-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'read-only-workspace-auto-approve-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'read-only-workspace-auto-approve-final.png'),
        }).catch(() => {});

        console.log('[read-only-workspace-auto-approve] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(readOnlyToolCallUsed, 'agent should call mastra_workspace_execute_command with read-only intent').toBe(true);
        expect(effectRequestedForTask, 'read-only workspace command should not trigger approval').toBe(false);
        expect(taskFinished || taskFailed, 'task should reach terminal state').toBe(true);
        if (taskFailedPayload) {
            expect(
                taskFailedPayload.toLowerCase().includes('approval_required')
                || taskFailedPayload.toLowerCase().includes('effect_requested'),
                'task failure should not be caused by approval flow',
            ).toBe(false);
        }
    });
});
