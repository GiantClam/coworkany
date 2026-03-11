import { test, expect, type Locator, type BrowserContext, type Page } from './tauriFixture';
import { hasFailedSignal, hasFinishedSignal } from './utils/xFollowingAiParser';

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
): Promise<{ page: Page; input: Locator; selector: string } | null> {
    const pages = context.pages().filter((p) => p.url().includes('localhost:5173'));
    for (const p of pages) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = p.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 700 }).catch(() => false);
            const enabled = await candidate.isEnabled({ timeout: 700 }).catch(() => false);
            if (visible && enabled) {
                return { page: p, input: candidate, selector };
            }
        }
    }
    return null;
}

async function ensureFreshSession(page: Page): Promise<void> {
    const newSessionButton = page.locator('.chat-header-new-session').first();
    const canStartFresh = await newSessionButton.isVisible({ timeout: 4000 }).catch(() => false);
    if (!canStartFresh) {
        return;
    }

    await newSessionButton.click();
    await page.waitForTimeout(1000);
}

function countOccurrences(raw: string, pattern: string): number {
    return raw.split(pattern).length - 1;
}

test.describe('Desktop GUI E2E - X following posts natural query', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('submits the natural X query and either completes or suspends cleanly for login', async ({ page, context, tauriLogs }) => {
        await ensureMainShell(page);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        await ensureFreshSession(page);

        const discovered = await discoverInput(context);
        expect(discovered, 'desktop UI should expose a chat input').not.toBeNull();

        const activePage = discovered!.page;
        const input = discovered!.input;
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);

        tauriLogs.setBaseline();
        await input.press('Enter');
        await activePage.waitForTimeout(2000);

        const submitSeen =
            tauriLogs.containsSinceBaseline('send_task_message command received') ||
            tauriLogs.containsSinceBaseline('start_task command received');
        expect(submitSeen, 'desktop should submit the X query to sidecar').toBe(true);

        const deadline = Date.now() + 240000;
        let suspended = false;
        let finished = false;
        let failed = false;
        let browserConnectSeen = false;
        let xNavigationSeen = false;

        while (Date.now() < deadline) {
            const raw = tauriLogs.getRawSinceBaseline();
            const lower = raw.toLowerCase();

            browserConnectSeen =
                browserConnectSeen ||
                lower.includes('"name":"browser_connect"') ||
                lower.includes('tool_call: browser_connect');

            xNavigationSeen =
                xNavigationSeen ||
                lower.includes('https://x.com/home') ||
                lower.includes('"name":"browser_navigate"') && lower.includes('x.com');

            suspended =
                suspended ||
                lower.includes('"type":"task_suspended"') ||
                lower.includes('task suspended') ||
                lower.includes('[suspendresume] task');

            const bodyText = (await activePage.textContent('body').catch(() => null)) || null;
            finished = finished || hasFinishedSignal(raw, bodyText);

            failed = failed || hasFailedSignal(raw);

            if (suspended || finished || failed) {
                break;
            }

            await sleep(1500);
        }

        const raw = tauriLogs.getRawSinceBaseline();
        const lower = raw.toLowerCase();
        const bodyText = (await activePage.textContent('body').catch(() => '')) || '';
        const disconnectCalls =
            countOccurrences(lower, '"name":"browser_disconnect"') +
            countOccurrences(lower, 'tool_call: browser_disconnect');

        expect(browserConnectSeen, 'X flow should trigger browser connection').toBe(true);
        expect(xNavigationSeen || suspended, 'X flow should navigate to x.com or suspend with guidance').toBe(true);
        expect(disconnectCalls, 'cleanup should not loop on browser_disconnect').toBeLessThanOrEqual(4);

        if (suspended) {
            expect(
                bodyText.includes('使用我已登录的浏览器') ||
                bodyText.includes('在当前窗口登录后继续') ||
                lower.includes('使用我已登录的浏览器') ||
                lower.includes('在当前窗口登录后继续'),
                'suspended state should show user-friendly resume actions',
            ).toBe(true);
            expect(failed, 'suspended X flow should not fail').toBe(false);
            return;
        }

        expect(finished, 'X flow should either finish or suspend before timeout').toBe(true);
        expect(failed, 'finished X flow should not fail').toBe(false);
        expect(
            /ai|人工智能|llm|大模型/i.test(bodyText) || /ai|人工智能|llm|大模型/i.test(raw),
            'completed response should mention AI-related findings',
        ).toBe(true);
    });
});
