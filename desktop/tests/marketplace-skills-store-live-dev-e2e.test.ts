/**
 * Live (no-mock) Tauri dev checklist for skills marketplace.
 *
 * Validates real ClawHub integration in desktop UI:
 * - New tab visibility
 * - Search
 * - Install
 * - Refresh/list sync
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';

const TASK_TIMEOUT_MS = 8 * 60 * 1000;
const LIVE_SKILL_NAME = process.env.COWORKANY_LIVE_CLAWHUB_SKILL ?? 'windows-ui-automation';

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

test.describe('Marketplace Skills Store - Live dev E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('real clawhub search/install/refresh flow', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(8_000);

        const input = await findChatInput(page);
        expect(input, 'chat input should be visible').not.toBeNull();

        // Ensure we are in active session mode so SK header action is visible.
        await input!.fill('create live session');
        await input!.press('Enter');

        const skillsButton = page.locator('button.chat-header-icon-button:has-text("SK")').first();
        await skillsButton.waitFor({ state: 'visible', timeout: 45_000 });
        await skillsButton.click();

        const clawHubTab = page.getByRole('button', { name: 'ClawHub' });
        await expect(clawHubTab).toBeVisible();
        await clawHubTab.click();

        const searchInput = page.getByPlaceholder('Search ClawHub skills');
        await searchInput.fill(LIVE_SKILL_NAME);
        await page.getByRole('button', { name: 'Search' }).first().click();
        await expect(page.getByText(LIVE_SKILL_NAME)).toBeVisible({ timeout: 40_000 });

        const skillCard = page.locator(`div:has-text("${LIVE_SKILL_NAME}")`).first();
        const installButton = skillCard.getByRole('button').first();
        const installLabel = (await installButton.textContent())?.trim() ?? '';
        const needInstall = /install/i.test(installLabel) && !/installed/i.test(installLabel);

        if (needInstall) {
            tauriLogs.setBaseline();
            await installButton.click();
            await expect(skillCard.getByRole('button', { name: 'Installed' })).toBeVisible({ timeout: 60_000 });

            const installLogs = tauriLogs.getRawSinceBaseline();
            expect(installLogs).toContain('install_openclaw_skill');
            expect(installLogs).toContain('list_claude_skills');
        }

        // Refresh list to ensure installed-state sync remains stable in live mode.
        const refreshButton = page.getByRole('button', { name: /Refresh|刷新/ }).first();
        await refreshButton.click();
        await expect(page.getByText(LIVE_SKILL_NAME)).toHaveCount(1, { timeout: 40_000 });
    });
});
