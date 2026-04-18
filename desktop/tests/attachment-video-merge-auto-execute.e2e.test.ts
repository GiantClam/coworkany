/**
 * Desktop GUI E2E: attachment video-merge command-execution regression
 *
 * Verifies that an attachment-style request with screenshot-like filenames:
 * 1) routes to workspace command execution,
 * 2) does not trigger EFFECT_REQUESTED approval cards for read-only probe chains,
 * 3) does not drift into browser automation.
 *
 * Run:
 *   cd desktop && npx playwright test tests/attachment-video-merge-auto-execute.e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const ATTACHMENT_PATHS = [
    '/tmp/截屏2025-10-17 22.01.27.png',
    '/tmp/截屏2026-01-06 15.34.56.png',
    '/tmp/截屏2026-04-06 21.01.29.png',
];
const QUERY = [
    '[Resolved attachments]',
    ...ATTACHMENT_PATHS.map((filePath) => `- ${filePath}`),
    '',
    '把附件图片合并为一个视频，每张图片播放 5s',
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

function ensureAttachmentFixtures(): void {
    const onePixelPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
    ]);
    for (const filePath of ATTACHMENT_PATHS) {
        fs.writeFileSync(filePath, onePixelPng);
    }
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

test.describe('Desktop GUI E2E - attachment video merge auto execute', () => {
    test.skip(
        !hasSupportedProviderEnv(),
        'Requires one of E2E_AIBERM_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.',
    );
    test.setTimeout(TASK_TIMEOUT_MS + 120_000);

    test('attachment merge request executes without approval popup and without browser drift', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);
        ensureAttachmentFixtures();

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
        let workspaceExecCalled = false;
        let commandObserved = false;
        let browserNavigateCalled = false;
        let effectRequestedForTask = false;
        let toolingWithoutFinalSummarySeen = false;
        let taskFinished = false;
        let taskFailed = false;
        let taskFailedPayload = '';

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

            toolingWithoutFinalSummarySeen =
                toolingWithoutFinalSummarySeen
                || lower.includes('tooling_without_final_summary');

            const taskScopedLogs = taskId
                ? logs
                    .split('\n')
                    .filter((line) => line.includes(`"taskId":"${taskId}"`))
                    .join('\n')
                : logs;

            workspaceExecCalled =
                workspaceExecCalled
                || taskScopedLogs.includes('"toolName":"mastra_workspace_execute_command"');
            commandObserved =
                commandObserved
                || (
                    taskScopedLogs.includes('"toolName":"mastra_workspace_execute_command"')
                    && taskScopedLogs.includes('"command":"')
                )
                || ATTACHMENT_PATHS.some((filePath) => taskScopedLogs.includes(filePath))
                || /"command":"[^"]*ffmpeg/iu.test(taskScopedLogs);

            browserNavigateCalled =
                browserNavigateCalled
                || taskScopedLogs.includes('"toolName":"browser_navigate"');
            effectRequestedForTask =
                effectRequestedForTask
                || (taskId
                    ? taskScopedLogs.includes('"type":"EFFECT_REQUESTED"')
                    : logs.includes('"type":"EFFECT_REQUESTED"'));

            taskFinished =
                taskFinished
                || (taskId ? taskScopedLogs.includes('"type":"TASK_FINISHED"') : logs.includes('"type":"TASK_FINISHED"'));
            taskFailed =
                taskFailed
                || (taskId ? taskScopedLogs.includes('"type":"TASK_FAILED"') : logs.includes('"type":"TASK_FAILED"'));

            if (taskFailed) {
                taskFailedPayload = taskScopedLogs.slice(-1200);
            }

            if (taskFinished || taskFailed) {
                break;
            }
        }

        const summary = {
            query: QUERY,
            taskId,
            submitted,
            workspaceExecCalled,
            commandObserved,
            browserNavigateCalled,
            effectRequestedForTask,
            toolingWithoutFinalSummarySeen,
            taskFinished,
            taskFailed,
            taskFailedPayloadSnippet: taskFailedPayload,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'attachment-video-merge-auto-execute-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'attachment-video-merge-auto-execute-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'attachment-video-merge-auto-execute-final.png'),
        }).catch(() => {});

        console.log('[attachment-video-merge-auto-execute] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(workspaceExecCalled, 'agent should call mastra_workspace_execute_command').toBe(true);
        expect(commandObserved, 'task should include executable command payload').toBe(true);
        expect(effectRequestedForTask, 'probe chain should not trigger approval flow').toBe(false);
        expect(browserNavigateCalled, 'request should not drift into browser automation').toBe(false);
        expect(toolingWithoutFinalSummarySeen, 'task should not degrade into tooling_without_final_summary').toBe(false);
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
