import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as childProcess from 'child_process';

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

function abortShutdown(): void {
    if (process.platform !== 'win32') {
        return;
    }

    try {
        childProcess.execSync('shutdown /a', { stdio: 'ignore' });
    } catch {
        // No pending shutdown is fine.
    }
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

test.describe('Desktop GUI smoke - new session provider path', () => {
    test('fresh session can schedule shutdown without autonomous provider URL failure', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Windows only');

        abortShutdown();

        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(12000);

            const newSessionButton = page.locator('.chat-header-new-session').first();
            const canStartFresh = await newSessionButton.isVisible({ timeout: 2000 }).catch(() => false);
            expect(canStartFresh, 'fresh session button should be visible').toBe(true);
            await newSessionButton.click();
            await page.waitForTimeout(800);

            const input = await findChatInput(page);
            expect(input, 'chat input should be visible in fresh session').not.toBeNull();

            tauriLogs.setBaseline();
            await input!.fill([
                '请设置10分钟后定时关机，并立即检查设置状态。',
                '不要使用 run_command 执行 shutdown /s 或 shutdown /a。',
            ].join('\n'));
            await input!.press('Enter');

            let sawScheduleTool = false;
            let sawAutonomousUrlFailure = false;
            let sawTaskFailed = false;
            const start = Date.now();

            while (Date.now() - start < 120000) {
                await page.waitForTimeout(3000);
                const logs = tauriLogs.getRawSinceBaseline();
                const lower = logs.toLowerCase();

                sawScheduleTool =
                    sawScheduleTool ||
                    lower.includes('"name":"system_shutdown_schedule"');
                sawAutonomousUrlFailure =
                    sawAutonomousUrlFailure ||
                    lower.includes('autonomous_subtask_failed') ||
                    lower.includes('/v1/chat/completions/messages') ||
                    lower.includes('invalid url (post /v1/chat/completions/messages)');
                sawTaskFailed =
                    sawTaskFailed ||
                    lower.includes('"type":"task_failed"');

                if (sawScheduleTool || sawAutonomousUrlFailure || sawTaskFailed) {
                    break;
                }
            }

            expect(sawAutonomousUrlFailure, 'fresh session should not hit the old autonomous provider URL failure').toBe(false);
            expect(sawTaskFailed, 'fresh session task should not fail').toBe(false);
            expect(sawScheduleTool, 'fresh session should still reach system_shutdown_schedule').toBe(true);
        } finally {
            abortShutdown();
        }
    });
});

