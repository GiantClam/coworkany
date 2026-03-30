/**
 * E2E Test: Failure surfacing and retry continuity via Desktop UI
 *
 * Covers full-chain behavior from desktop input to task execution status:
 * 1. Submit a task from desktop chat input
 * 2. Verify sidecar receives the message command
 * 3. Verify session reaches terminal failed state with assistant error response
 * 4. Verify user can continue by submitting another task after failure
 */

import { test, expect } from './tauriFixtureNoChrome';
import type { TauriLogCollector } from './tauriFixture';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const INPUT_SELECTORS = [
    '.chat-input',
    'textarea.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

async function findChatInput(page: any) {
    for (const selector of INPUT_SELECTORS) {
        const locator = page.locator(selector).first();
        const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return locator;
        }
    }
    throw new Error('Could not find desktop chat input');
}

async function submitTaskFromInput(page: any, tauriLogs: TauriLogCollector, query: string): Promise<void> {
    const input = await findChatInput(page);
    tauriLogs.setBaseline();
    await input.fill(query);
    await input.press('Enter');

    await expect.poll(() => tauriLogs.containsSinceBaseline('send_task_message command received'), {
        timeout: 20_000,
        message: 'desktop submit should trigger send_task_message command',
    }).toBe(true);
}

async function expectTaskFailedWithAssistantError(page: any): Promise<void> {
    await expect(page.getByRole('button', { name: /Failed/i }).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('main').getByText(/Task failed:|任务失败|missing_api_key/i).first()).toBeVisible({ timeout: 90_000 });
}

test.describe('Database Failure Recovery - Tauri Desktop E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('数据库连接失败时应在UI显示失败状态与错误反馈', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const query = '请帮我连接数据库 192.168.1.100:3306 并查询用户表';
        await submitTaskFromInput(page, tauriLogs, query);

        await expectTaskFailedWithAssistantError(page);
        await expect(page.locator('main').getByText(query).first()).toBeVisible({ timeout: 15_000 });
    });

    test('任务失败后应允许继续提交并进入新一轮执行', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const firstQuery = '连接不存在的数据库 10.0.0.999:5432 执行 SELECT * FROM users';
        await submitTaskFromInput(page, tauriLogs, firstQuery);
        await expectTaskFailedWithAssistantError(page);

        const secondQuery = '再次尝试连接数据库并查询 users 表，若失败请说明原因';
        await submitTaskFromInput(page, tauriLogs, secondQuery);
        await expectTaskFailedWithAssistantError(page);
        await expect(page.locator('main').getByText(secondQuery).first()).toBeVisible({ timeout: 15_000 });
    });
});
