import { test, expect } from './tauriFixtureMacMirror';

test.describe('mac shell smoke', () => {
    test.skip(process.platform !== 'darwin', 'macOS-only shell smoke');

    test('native mac shell keeps input editable and does not render custom titlebar', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('.app-shell-macos')).toBeVisible({ timeout: 20_000 });

        await expect(page.locator('.titlebar')).toHaveCount(0);
        await expect(page.locator('.titlebar-drag-region')).toHaveCount(0);

        const getStartedButton = page.getByRole('button', { name: /get started/i }).first();
        if (await getStartedButton.isVisible({ timeout: 1500 }).catch(() => false)) {
            await getStartedButton.click();
            const apiKeyInput = page.locator('input[type="password"]').first();
            await apiKeyInput.waitFor({ state: 'visible', timeout: 20_000 });
            const probe = 'sk-test-input';
            await apiKeyInput.fill(probe);
            await expect(apiKeyInput).toHaveValue(probe);
            return;
        }

        const chatInput = page.locator('.chat-input, textarea.chat-input, input[placeholder*="instructions"], textarea').first();
        await chatInput.waitFor({ state: 'visible', timeout: 20_000 });
        const prompt = 'mac shell smoke input';
        await chatInput.fill(prompt);
        await expect(chatInput).toHaveValue(prompt);
    });
});
