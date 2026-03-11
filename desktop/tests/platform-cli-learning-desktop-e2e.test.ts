import { test, expect, type Locator } from './tauriFixtureNoChrome';

const TEST_TIMEOUT_MS = 5 * 60 * 1000;

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

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

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();
    await input!.fill(text);
    await input!.press('Enter');
    await page.waitForTimeout(1500);
}

test.describe('Desktop GUI E2E - platform CLI learning', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('uses command_preflight before run_command for a platform-sensitive CLI request', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Current E2E scenario uses Windows schtasks.');

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12000);

        const prompt = [
            '请用 Windows 系统自带的 schtasks 命令查看当前计划任务列表，',
            '直接告诉我结果摘要，不要写脚本，也不要编程。',
        ].join('');

        tauriLogs.setBaseline();
        await submitMessage(page, prompt);

        let preflightSeen = false;
        let runCommandSeen = false;
        let preflightIndex = -1;
        let runCommandIndex = -1;
        let taskFailed = false;
        const start = Date.now();

        while (Date.now() - start < 120000) {
            await page.waitForTimeout(3000);
            const lines = tauriLogs.grepSinceBaseline('TOOL_CALL');

            for (let index = 0; index < lines.length; index += 1) {
                const line = lines[index].toLowerCase();
                if (!preflightSeen && line.includes('"name":"command_preflight"') && line.includes('schtasks')) {
                    preflightSeen = true;
                    preflightIndex = index;
                }
                if (!runCommandSeen && line.includes('"name":"run_command"') && line.includes('schtasks')) {
                    runCommandSeen = true;
                    runCommandIndex = index;
                }
            }

            taskFailed = taskFailed || tauriLogs.containsSinceBaseline('"type":"TASK_FAILED"');

            if (preflightSeen && runCommandSeen) {
                break;
            }
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();

        expect(taskFailed, 'task should not fail while querying schtasks').toBe(false);
        expect(preflightSeen, 'agent should call command_preflight for schtasks').toBe(true);
        expect(runCommandSeen, 'agent should call run_command for schtasks after preflight').toBe(true);
        expect(preflightIndex, 'preflight should appear before run_command in TOOL_CALL logs').toBeGreaterThanOrEqual(0);
        expect(runCommandIndex, 'run_command should appear after preflight').toBeGreaterThan(preflightIndex);
        expect(rawLogs.toLowerCase()).toContain('"name":"command_preflight"');
        expect(rawLogs.toLowerCase()).toContain('"name":"run_command"');
    });
});
