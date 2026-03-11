import { test, expect, type Locator, type Page, type BrowserContext } from './tauriFixtureNoChrome';

const TASK_QUERY = '查看我最新的X上关注人员的帖文，是否有AI相关的有价值的信息';
const TEST_TIMEOUT_MS = 8 * 60 * 1000;
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

async function ensureMainShell(page: Page): Promise<void> {
    const workspaceAddButton = page.locator('.workspace-add-btn').first();
    const shellVisible = await workspaceAddButton.isVisible({ timeout: 6000 }).catch(() => false);
    if (shellVisible) {
        return;
    }

    await page.evaluate(() => {
        localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
        window.location.reload();
    });

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(workspaceAddButton).toBeVisible({ timeout: 30000 });
}

async function discoverInput(
    context: BrowserContext,
): Promise<{ page: Page; input: Locator } | null> {
    const pages = context.pages().filter((p) => p.url().includes('localhost:5173'));
    for (const p of pages) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = p.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 700 }).catch(() => false);
            if (visible) {
                return { page: p, input: candidate };
            }
        }
    }
    return null;
}

test.describe('Desktop GUI E2E - X following posts suspend flow', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('suspends cleanly and shows user-friendly resume actions when no logged-in browser can be reused', async ({ page, context, tauriLogs }) => {
        await ensureMainShell(page);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const discovered = await discoverInput(context);
        expect(discovered, 'desktop UI should expose a chat input').not.toBeNull();

        const activePage = discovered!.page;
        const input = discovered!.input;
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);

        tauriLogs.setBaseline();
        await input.press('Enter');
        await activePage.waitForTimeout(2000);

        expect(
            tauriLogs.containsSinceBaseline('send_task_message command received'),
            'desktop should submit the X query to sidecar',
        ).toBe(true);

        const deadline = Date.now() + 240000;
        let suspended = false;
        let browserConnectSeen = false;
        let suspensionReasonSeen = false;

        while (Date.now() < deadline) {
            const raw = tauriLogs.getRawSinceBaseline();
            const lower = raw.toLowerCase();

            browserConnectSeen =
                browserConnectSeen ||
                lower.includes('"name":"browser_connect"') ||
                lower.includes('tool_call: browser_connect');

            suspended =
                suspended ||
                lower.includes('"type":"task_suspended"') ||
                lower.includes('task suspended');

            suspensionReasonSeen =
                suspensionReasonSeen ||
                lower.includes('user_profile_recommended') ||
                lower.includes('authentication_required');

            const bodyText = (await activePage.textContent('body').catch(() => '')) || '';
            const userActionsVisible =
                bodyText.includes('使用我已登录的浏览器') ||
                bodyText.includes('在当前窗口登录后继续') ||
                bodyText.includes('我已登录，继续');

            if (suspended && userActionsVisible) {
                break;
            }

            await sleep(1500);
        }

        const raw = tauriLogs.getRawSinceBaseline();
        const lower = raw.toLowerCase();
        const bodyText = (await activePage.textContent('body').catch(() => '')) || '';

        expect(browserConnectSeen, 'X flow should trigger browser connection before suspension').toBe(true);
        expect(suspended, 'X flow should suspend cleanly when no reusable logged-in browser is available').toBe(true);
        expect(
            suspensionReasonSeen,
            'suspension should be associated with login or reusable-profile guidance',
        ).toBe(true);

        expect(bodyText.includes('使用我已登录的浏览器') || bodyText.includes('在当前窗口登录后继续') || bodyText.includes('我已登录，继续')).toBe(true);

        expect(bodyText.includes('9222'), 'UI should not expose remote-debugging port details').toBe(false);
        expect(bodyText.includes('persistent_profile'), 'UI should not expose internal connection mode names').toBe(false);
        expect(bodyText.includes('browser_connect'), 'UI should not expose internal tool names').toBe(false);
        expect(lower.includes('"type":"task_failed"'), 'suspended X flow should not fail').toBe(false);
    });
});
