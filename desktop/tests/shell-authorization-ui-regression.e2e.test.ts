import { test, expect } from './tauriFixtureNoChrome';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const INPUT_SELECTORS = [
    '.chat-input',
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
        const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
        if (visible) {
            return locator;
        }
    }
    throw new Error('Could not find desktop chat input');
}

async function readActiveSessionSnapshot(page: any) {
    return page.evaluate(async () => {
        const storeModule = await import('/src/stores/taskEvents/index.ts');
        const state = storeModule.useTaskEventStore.getState();
        const activeTaskId = state.activeTaskId;
        const session = activeTaskId ? state.getSession(activeTaskId) : null;
        if (!session) {
            return null;
        }
        return {
            taskId: session.taskId,
            status: session.status,
            title: session.title,
            messages: session.messages.map((message: any) => ({
                id: message.id,
                role: message.role,
                content: message.content,
            })),
        };
    });
}

test.describe('shell authorization desktop regression', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('desktop input immediately echoes the original user message and shows pending execution state', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15000);

        const input = await findChatInput(page);
        const statusValue = page.locator('.chat-status-chip .chat-header-chip-value').first();

        await input.fill('早上3点关机');
        await input.press('Enter');

        await expect.poll(async () => {
            const snapshot = await readActiveSessionSnapshot(page);
            return snapshot?.messages.some((message: any) =>
                message.role === 'user' && message.content === '早上3点关机'
            ) ?? false;
        }, {
            timeout: 15_000,
            message: 'the original user message should be echoed into the active desktop session immediately',
        }).toBe(true);

        const snapshot = await readActiveSessionSnapshot(page);
        const allMessageText = (snapshot?.messages ?? []).map((message: any) => String(message.content ?? ''));
        expect(allMessageText.some((content) => content.includes('原始任务：'))).toBe(false);
        expect(allMessageText.some((content) => content.includes('用户路由：'))).toBe(false);

        await expect.poll(async () => {
            return (await statusValue.textContent())?.trim() ?? '';
        }, {
            timeout: 20_000,
            message: 'desktop status chip should leave idle and show a pending/running state while the reply is in progress',
        }).toMatch(/等待模型响应|正在调用|进行中|Waiting for model response|Using |In progress/);
    });

    test('real desktop task routes shutdown request into shell authorization instead of chat confirmation', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15000);

        const input = await findChatInput(page);
        tauriLogs.setBaseline();

        await input.fill('早上3点关机');
        await input.press('Enter');

        const start = Date.now();
        let sawShellEffect = false;
        while (Date.now() - start < 120_000) {
            await page.waitForTimeout(2000);
            const logs = tauriLogs.getRawSinceBaseline();
            if (
                logs.includes('"type":"request_effect"')
                && logs.includes('"effectType":"shell:write"')
                && logs.includes('"toolName":"run_command"')
            ) {
                sawShellEffect = true;
                break;
            }
        }

        const logs = tauriLogs.getRawSinceBaseline();
        expect(sawShellEffect, 'desktop flow should request shell:write approval through run_command').toBe(true);
        expect(logs.includes('"type":"TASK_USER_ACTION_REQUIRED"'), 'desktop flow should not fall back to message-based user action').toBe(false);
        expect(logs.includes('"kind":"confirm_plan"'), 'desktop flow should not ask for chat confirmation before shell authorization').toBe(false);
        expect(logs.includes('"kind":"clarify_input"'), 'desktop flow should not regress into extra clarification for direct shell action').toBe(false);

        const snapshot = await readActiveSessionSnapshot(page);
        const userMessages = (snapshot?.messages ?? []).filter((message: any) => message.role === 'user');
        expect(userMessages.some((message: any) => message.content === '早上3点关机')).toBe(true);
        expect(userMessages.some((message: any) => String(message.content ?? '').includes('原始任务：'))).toBe(false);
    });

    test('assistant-ui approval card contract renders shell authorization UI', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        await seedPendingApprovalSession(page, {
            taskId: 'task-shell-write-regression-ui',
            requestId: 'req-shell-write-regression',
            effectType: 'shell:write',
            userContent: '早上3点关机',
            title: 'shell authorization approval card regression',
        });

        await expect(page.getByText(/High risk approvals|高风险审批/)).toBeVisible();
        await expect(page.getByText(/shell:write/)).toBeVisible();
        await expect(page.getByRole('button', { name: /^Approve$|^批准$/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Deny|拒绝/ })).toBeVisible();
    });
});
