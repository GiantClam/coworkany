import { test, expect } from './tauriFixtureNoChrome';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';

const TASK_TIMEOUT_MS = 2 * 60 * 1000;

test.describe('assistant-ui approval invoke regression', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('@critical Approve button triggers confirm_effect invoke command', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const requestId = 'assistant-ui-approve-effect-request';
        await seedPendingApprovalSession(page, {
            taskId: 'assistant-ui-approve-task',
            requestId,
        });

        await expect(page.getByText(/High risk approvals|高风险审批/)).toBeVisible({
            timeout: 20_000,
        });
        const approveButton = page.getByRole('button', { name: /Approve|批准/ }).first();
        await expect(approveButton).toBeVisible();

        tauriLogs.setBaseline();
        await approveButton.click();

        await expect.poll(
            () => tauriLogs.getRawSinceBaseline(),
            {
                timeout: 20_000,
                message: 'assistant-ui Approve action should invoke confirm_effect',
            },
        ).toContain(`invoke_confirm_effect requestId=${requestId}`);
    });

    test('@critical Deny button triggers deny_effect invoke command', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const requestId = 'assistant-ui-deny-effect-request';
        await seedPendingApprovalSession(page, {
            taskId: 'assistant-ui-deny-task',
            requestId,
        });

        await expect(page.getByText(/High risk approvals|高风险审批/)).toBeVisible({
            timeout: 20_000,
        });
        const denyButton = page.getByRole('button', { name: /Deny|拒绝/ }).first();
        await expect(denyButton).toBeVisible();

        tauriLogs.setBaseline();
        await denyButton.click();

        await expect.poll(
            () => tauriLogs.getRawSinceBaseline(),
            {
                timeout: 20_000,
                message: 'assistant-ui Deny action should invoke deny_effect',
            },
        ).toContain(`invoke_deny_effect requestId=${requestId}`);
    });
});
