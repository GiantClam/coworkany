/**
 * Desktop GUI E2E: CoworkAny self-management config mutation
 *
 * Verifies that a natural-language request sent from the desktop chat UI can
 * update CoworkAny's own llm-config.json via self-management tools, using an
 * isolated app data directory so the test never mutates the user's real config.
 *
 * Run:
 *   cd desktop && npx playwright test tests/coworkany-self-management-update-config-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureSandboxed';
import * as fs from 'fs';
import * as path from 'path';

const TARGET_MAX_HISTORY_MESSAGES = 17;
const TASK_QUERY = [
    `请把 coworkany 自己配置里的 maxHistoryMessages 改成 ${TARGET_MAX_HISTORY_MESSAGES}。`,
    '直接修改你自己的 llm-config.json，不要修改源码，也不要只给建议。',
    '请优先调用你用于修改自身配置的工具，修改后明确告诉我新的值。',
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

test.describe('Desktop GUI E2E - coworkany self-management config mutation', () => {
    test.skip(
        !hasSupportedProviderEnv(),
        'Requires one of E2E_AIBERM_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.',
    );
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('natural self-config update should persist llm-config.json in sandboxed app data', async ({ page, tauriLogs, appDataDir }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        const configPath = path.join(appDataDir, 'llm-config.json');
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
        let updateToolUsed = false;
        let taskFinished = false;
        let taskFailed = false;
        let persistedValue: number | null = null;
        let answerMentionsNewValue = false;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);

            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();
            const toolCallLines = tauriLogs.grepSinceBaseline('TOOL_CALL');

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');

            updateToolUsed =
                updateToolUsed ||
                toolCallLines.some((line) => line.includes('"name":"update_coworkany_config"'));

            taskFinished =
                taskFinished ||
                lower.includes('"type":"task_finished"') ||
                lower.includes('task_finished');
            taskFailed =
                taskFailed ||
                lower.includes('"type":"task_failed"') ||
                lower.includes('task_failed');

            answerMentionsNewValue =
                answerMentionsNewValue ||
                lower.includes(`maxhistorymessages`) && lower.includes(String(TARGET_MAX_HISTORY_MESSAGES));

            if (fs.existsSync(configPath)) {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
                        maxHistoryMessages?: number;
                    };
                    if (typeof config.maxHistoryMessages === 'number') {
                        persistedValue = config.maxHistoryMessages;
                    }
                } catch {
                    // Keep polling while config is still being written.
                }
            }

            if ((updateToolUsed && persistedValue === TARGET_MAX_HISTORY_MESSAGES) || taskFailed) {
                break;
            }
        }

        const summary = {
            query: TASK_QUERY,
            submitted,
            updateToolUsed,
            persistedValue,
            answerMentionsNewValue,
            taskFinished,
            taskFailed,
            configPath,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'coworkany-self-management-update-config-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'coworkany-self-management-update-config-logs.txt'),
            tauriLogs.getRawSinceBaseline(),
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'coworkany-self-management-update-config-final.png'),
        }).catch(() => {});

        console.log('[Test] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(
            updateToolUsed,
            'agent should call update_coworkany_config for this natural-language request',
        ).toBe(true);
        expect(
            persistedValue,
            `sandboxed llm-config.json should persist maxHistoryMessages=${TARGET_MAX_HISTORY_MESSAGES}`,
        ).toBe(TARGET_MAX_HISTORY_MESSAGES);
    });
});
