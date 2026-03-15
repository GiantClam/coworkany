import { test, expect, type Locator } from './tauriFixtureNoChrome';

const TEST_TIMEOUT_MS = 4 * 60 * 1000;
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findChatInput(page: any, options?: { requireEnabled?: boolean; timeoutMs?: number }): Promise<Locator | null> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
            if (!visible) {
                continue;
            }

            if (options?.requireEnabled) {
                const enabled = await candidate.isEnabled().catch(() => false);
                if (!enabled) {
                    continue;
                }
            }

            return candidate;
        }

        await sleep(400);
    }

    return null;
}

test.describe('Desktop GUI E2E - reminder regression', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('mirrors a fired reminder back into the active chat session', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        expect(page.isClosed(), 'desktop main window should remain open after fixture bootstrap').toBe(false);
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page, { requireEnabled: true, timeoutMs: 120000 });
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        const reminderMessage = `Regression reminder ${Date.now()}`;
        const runAt = new Date(Date.now() + 15_000).toISOString();
        const taskQuery = [
            `Set a reminder with message "${reminderMessage}".`,
            `Use the exact timestamp ${runAt}.`,
            'Set the reminder directly and do not rewrite the schedule.',
        ].join(' ');

        tauriLogs.setBaseline();
        await input!.fill(taskQuery);
        await input!.press('Enter');

        let submitted = false;
        let reminderScheduled = false;
        let reminderFired = false;
        let taskFailed = false;

        const startedAt = Date.now();
        while (Date.now() - startedAt < TEST_TIMEOUT_MS) {
            await page.waitForTimeout(3000);
            const logs = tauriLogs.getRawSinceBaseline();

            submitted = submitted || logs.includes('send_task_message command received');
            reminderScheduled =
                reminderScheduled ||
                logs.includes('"name":"set_reminder"') ||
                logs.includes('[Reminder] Successfully created reminder task');
            reminderFired =
                reminderFired ||
                logs.includes(`[Heartbeat] Trigger fired: Reminder: ${reminderMessage}`) ||
                logs.includes(`"summary":"[Reminder] ${reminderMessage}"`);
            taskFailed = taskFailed || logs.includes('"type":"TASK_FAILED"');

            if (reminderFired || taskFailed) {
                break;
            }
        }

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'reminder request should not fail').toBe(false);
        expect(reminderScheduled, 'agent should call set_reminder and create a reminder task').toBe(true);
        expect(reminderFired, 'heartbeat reminder should fire during the test window').toBe(true);
        await expect(page.getByText(`[Reminder] ${reminderMessage}`, { exact: false })).toBeVisible({ timeout: 20_000 });
    });
});
