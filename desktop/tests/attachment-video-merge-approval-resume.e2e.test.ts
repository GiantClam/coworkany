/**
 * Desktop GUI E2E: attachment video-merge approval-response regression
 *
 * Deterministically verifies the approval interaction path for the exact
 * attachment->video request text:
 * 1) approval card is rendered,
 * 2) clicking Approve invokes confirm_effect,
 * 3) desktop sends report_effect_result back to sidecar.
 */

import { test, expect } from './tauriFixtureNoChrome';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';

const TASK_TIMEOUT_MS = 2 * 60 * 1000;
const ATTACHMENT_PATHS = [
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2025-10-17 22.01.27.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-06 15.34.56.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-06 21.01.29.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-03 09.25.43.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.46.png',
    '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.35.png',
];
const QUERY = `[Resolved attachments] - ${ATTACHMENT_PATHS.join(' - ')} 把附件图片合并为一个视频，每张图片播放 5s`;

test.describe('Desktop GUI E2E - attachment video merge approval response', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('approve button responds for attachment video-merge approval card', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const requestId = 'attachment-video-merge-approve-request';
        await seedPendingApprovalSession(page, {
            taskId: 'attachment-video-merge-approve-task',
            requestId,
            effectType: 'shell:write',
            userContent: QUERY,
            assistantContent: '需要授权后继续执行附件视频合并命令。',
            title: 'attachment video merge approval resume regression',
        });

        await expect(page.getByText(/High risk approvals|高风险审批/)).toBeVisible({ timeout: 20_000 });
        const approveButton = page.getByRole('button', { name: /Approve|批准/ }).first();
        await expect(approveButton).toBeVisible();

        tauriLogs.setBaseline();
        await approveButton.click();

        await expect.poll(
            () => tauriLogs.getRawSinceBaseline(),
            {
                timeout: 20_000,
                message: 'clicking Approve should invoke confirm_effect',
            },
        ).toContain(`invoke_confirm_effect requestId=${requestId}`);

        await expect.poll(
            () => tauriLogs.getRawSinceBaseline(),
            {
                timeout: 20_000,
                message: 'clicking Approve should send report_effect_result to sidecar',
            },
        ).toContain('"type":"report_effect_result"');

        await expect.poll(
            () => tauriLogs.getRawSinceBaseline(),
            {
                timeout: 20_000,
                message: 'report_effect_result payload should carry the same requestId',
            },
        ).toContain(`"requestId":"${requestId}"`);
    });
});
