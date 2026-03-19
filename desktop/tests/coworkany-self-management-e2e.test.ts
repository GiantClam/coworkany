/**
 * Desktop GUI E2E: CoworkAny self-management
 *
 * Verifies that a natural-language self-config question submitted from the
 * desktop chat UI reaches the sidecar and triggers the new CoworkAny
 * self-management tools instead of falling back to generic explanations.
 *
 * Run:
 *   cd desktop && npx playwright test tests/coworkany-self-management-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_QUERY = [
    'coworkany 中的 serper key 是什么？',
    '请直接检查你自己的配置，而不是猜测。',
    '如果没有配置，请明确告诉我未配置；如果已配置，请读取实际值。',
].join('\n');

const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];

const SELF_MANAGEMENT_TOOLS = [
    'get_coworkany_config',
    'get_coworkany_paths',
    'update_coworkany_config',
    'list_coworkany_workspaces',
    'list_coworkany_skills',
    'get_coworkany_skill',
];

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
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

test.describe('Desktop GUI E2E - coworkany self-management', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('natural self-config question should trigger coworkany self-management tools', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        tauriLogs.setBaseline();
        await input!.fill(TASK_QUERY);
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
        let selfManagementToolUsed = false;
        let usedToolName: string | null = null;
        let taskFinished = false;
        let taskFailed = false;
        let answerMentionsConfig = false;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);
            const elapsed = Math.round((Date.now() - start) / 1000);
            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();
            const toolCallLines = tauriLogs.grepSinceBaseline('TOOL_CALL');

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');

            if (!selfManagementToolUsed) {
                for (const toolName of SELF_MANAGEMENT_TOOLS) {
                    const called = toolCallLines.some((line) => line.includes(`"name":"${toolName}"`));
                    if (called) {
                        selfManagementToolUsed = true;
                        usedToolName = toolName;
                        console.log(`[${elapsed}s] detected self-management tool call: ${toolName}`);
                        break;
                    }
                }
            }

            if (!answerMentionsConfig) {
                const contentHints = ['serper', 'api key', '未配置', '已配置', '[redacted]'];
                answerMentionsConfig = contentHints.some((hint) => lower.includes(hint));
            }

            taskFinished = taskFinished || lower.includes('task_finished');
            taskFailed = taskFailed || lower.includes('task_failed');

            if ((selfManagementToolUsed && (taskFinished || answerMentionsConfig)) || taskFailed) {
                break;
            }
        }

        const summary = {
            query: TASK_QUERY,
            submitted,
            selfManagementToolUsed,
            usedToolName,
            answerMentionsConfig,
            taskFinished,
            taskFailed,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'coworkany-self-management-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'coworkany-self-management-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'coworkany-self-management-final.png'),
        }).catch(() => {});

        console.log('[Test] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(
            selfManagementToolUsed,
            'agent should call a coworkany self-management tool for this query',
        ).toBe(true);
    });
});
