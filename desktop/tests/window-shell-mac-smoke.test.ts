import { test, expect } from './tauriFixtureMacMirror';

test.describe('mac shell smoke', () => {
    test.skip(process.platform !== 'darwin', 'macOS-only shell smoke');

    test('titlebar drag region remains interactive and onboarding input remains editable', async ({ page }) => {
        await page.locator('.titlebar').waitFor({ state: 'visible', timeout: 20_000 });
        await page.locator('.titlebar-drag-region').waitFor({ state: 'visible', timeout: 20_000 });

        await expect(page.locator('.titlebar')).not.toHaveAttribute('data-tauri-drag-region', /.+/);
        await expect(page.locator('.titlebar-drag-region')).toHaveAttribute('data-tauri-drag-region', /.+/);

        await page.getByRole('button', { name: /get started/i }).click();

        const apiKeyInput = page.locator('input[type="password"]');
        await apiKeyInput.waitFor({ state: 'visible', timeout: 20_000 });

        const probe = 'sk-test-input';
        await apiKeyInput.fill(probe);
        await expect(apiKeyInput).toHaveValue(probe);

        await expect(page.locator('body')).toHaveCSS('font-size', '13px');
        await expect(page.locator('.titlebar-brand-wordmark')).toHaveCSS('font-size', '12px');
    });
});
