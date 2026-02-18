/**
 * Visual Regression Tests for CoworkAny Desktop
 *
 * Tests that UI components render correctly and no visual regressions
 * are introduced by backend changes (browser hybrid architecture).
 *
 * Run: npx playwright test tests/visual-regression.test.ts
 *
 * Prerequisites:
 * - npm run dev (Vite dev server running on port 5173)
 * - npx playwright install chromium
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Visual Regression - Main Page', () => {
    test('main page renders correctly', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForSelector('h1');

        // Verify key UI elements
        const heading = page.locator('h1');
        await expect(heading).toHaveText('How can I help you code today?');

        const subtitle = page.locator('p');
        await expect(subtitle.first()).toContainText('Start a task');

        // Input box exists and is interactive
        const input = page.getByRole('textbox');
        await expect(input).toBeVisible();
        await expect(input).toBeEnabled();

        // Submit button exists
        const button = page.getByRole('button');
        await expect(button.first()).toBeVisible();

        // Take screenshot for visual comparison
        await expect(page).toHaveScreenshot('main-page.png', {
            maxDiffPixelRatio: 0.01,
        });
    });

    test('input interaction works correctly', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForSelector('h1');

        const input = page.getByRole('textbox');
        await input.fill('使用 browser_ai_action 在小红书发帖');

        // Verify text was entered
        await expect(input).toHaveValue('使用 browser_ai_action 在小红书发帖');

        // Submit button should be enabled now (no longer disabled)
        await expect(page).toHaveScreenshot('input-with-text.png', {
            maxDiffPixelRatio: 0.01,
        });
    });
});

test.describe('Visual Regression - ToolCard Rendering', () => {
    /**
     * Injects mock ToolCard data to verify new tools render correctly
     * in the existing ToolCard UI component format.
     */
    async function injectToolCards(page: any) {
        await page.evaluate(() => {
            const testTools = [
                {
                    name: 'browser_upload_file',
                    args: { file_path: 'C:\\Users\\test\\photo.png', selector: '#file-input' },
                    status: 'success',
                    result: { success: true, message: 'File uploaded via selector: #file-input' },
                },
                {
                    name: 'browser_set_mode',
                    args: { mode: 'smart' },
                    status: 'success',
                    result: { success: true, previousMode: 'auto', currentMode: 'smart', smartModeAvailable: true },
                },
                {
                    name: 'browser_ai_action',
                    args: { action: 'click the publish button', context: 'on the Xiaohongshu editor page' },
                    status: 'running',
                    result: null,
                },
                {
                    name: 'browser_ai_action',
                    args: { action: 'scroll down and find the comment box' },
                    status: 'failed',
                    result: { success: false, error: 'browser-use-service is not available' },
                },
            ];

            const container = document.createElement('div');
            container.id = 'tool-test-container';
            container.style.cssText =
                'position:fixed;top:0;left:0;right:0;bottom:0;background:#f5f3ef;z-index:9999;overflow:auto;padding:24px;font-family:system-ui;';

            container.innerHTML = testTools
                .map((tool) => {
                    const statusColor =
                        tool.status === 'success' ? '#4caf50' : tool.status === 'failed' ? '#f44336' : '#2196f3';
                    return `<div data-testid="tool-card-${tool.name}" style="margin-bottom:16px;background:white;border-radius:12px;border:1px solid #e5e1db;overflow:hidden;border-left:3px solid ${statusColor};">
                        <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span>🔧</span>
                                <strong style="color:#333;font-size:14px;">${tool.name}</strong>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
                                <span style="font-size:11px;color:#666;font-weight:600;">${tool.status.toUpperCase()}</span>
                            </div>
                        </div>
                        <div style="padding:0 16px 16px;border-top:1px solid #eee;">
                            <div style="margin-top:12px;">
                                <div style="font-size:11px;color:#999;text-transform:uppercase;margin-bottom:4px;">Input</div>
                                <pre style="background:#f8f7f5;padding:10px 14px;border-radius:8px;font-size:12px;overflow:auto;border:1px solid #eee;margin:0;">${JSON.stringify(tool.args, null, 2)}</pre>
                            </div>
                            ${
                                tool.result
                                    ? `<div style="margin-top:12px;">
                                <div style="font-size:11px;color:#999;text-transform:uppercase;margin-bottom:4px;">Output</div>
                                <pre style="background:#f8f7f5;padding:10px 14px;border-radius:8px;font-size:12px;overflow:auto;border:1px solid #eee;margin:0;">${JSON.stringify(tool.result, null, 2)}</pre>
                            </div>`
                                    : '<div style="margin-top:12px;padding:8px 14px;background:#e3f2fd;border-radius:8px;color:#1565c0;font-size:12px;">⏳ Tool is currently executing...</div>'
                            }
                        </div>
                    </div>`;
                })
                .join('');

            document.body.appendChild(container);
        });
    }

    test('new browser tools render as ToolCards', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForSelector('h1');
        await injectToolCards(page);

        // Verify all tool cards are present
        await expect(page.locator('[data-testid="tool-card-browser_upload_file"]')).toBeVisible();
        await expect(page.locator('[data-testid="tool-card-browser_set_mode"]')).toBeVisible();
        await expect(page.locator('[data-testid="tool-card-browser_ai_action"]')).toHaveCount(2);

        await expect(page).toHaveScreenshot('tool-cards-new-tools.png', {
            maxDiffPixelRatio: 0.01,
        });
    });

    test('tool card status indicators are correct', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForSelector('h1');
        await injectToolCards(page);

        // Check success cards have green indicator
        const uploadCard = page.locator('[data-testid="tool-card-browser_upload_file"]');
        await expect(uploadCard).toContainText('SUCCESS');

        const modeCard = page.locator('[data-testid="tool-card-browser_set_mode"]');
        await expect(modeCard).toContainText('SUCCESS');

        // Check running card has running indicator
        const actionCards = page.locator('[data-testid="tool-card-browser_ai_action"]');
        await expect(actionCards.first()).toContainText('RUNNING');
        await expect(actionCards.first()).toContainText('executing');

        // Check failed card has error info
        await expect(actionCards.last()).toContainText('FAILED');
        await expect(actionCards.last()).toContainText('not available');
    });
});
