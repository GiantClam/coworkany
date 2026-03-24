/**
 * Desktop GUI E2E: SiliconFlow provider availability via Settings
 *
 * Verifies that users can configure a SiliconFlow profile in Settings and
 * successfully send a chat message with that profile active.
 *
 * Run:
 *   cd desktop && E2E_SILICONFLOW_API_KEY=sk-xxx npx playwright test tests/siliconflow-settings-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';

const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;
const SILICONFLOW_MODEL = process.env.E2E_SILICONFLOW_MODEL?.trim() || 'Qwen/Qwen2.5-7B-Instruct';

if (process.platform === 'darwin' && !process.env.COWORKANY_TEST_ISOLATE_APP_DATA) {
    process.env.COWORKANY_TEST_ISOLATE_APP_DATA = 'true';
}

const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input textarea',
    '.chat-input input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    'input[placeholder="New instructions..."]',
    'input[type="text"]',
];

function hasSiliconFlowApiKeyEnv(): boolean {
    return Boolean(process.env.E2E_SILICONFLOW_API_KEY?.trim());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

async function clickIfVisible(button: Locator, timeout = 800): Promise<boolean> {
    const visible = await button.isVisible({ timeout }).catch(() => false);
    if (!visible) {
        return false;
    }
    await button.click({ timeout: 2_000 }).catch(() => {});
    return true;
}

async function advanceOnboarding(page: any): Promise<boolean> {
    const getStartedButton = page.getByRole('button', { name: /Get Started|开始使用/ }).first();
    const skipButton = page.getByRole('button', { name: /Skip for now|暂时跳过|稍后再说/ }).first();
    const startUsingButton = page.getByRole('button', {
        name: /Start Using CoworkAny|开始使用 CoworkAny|Start Using|开始使用/i,
    }).first();

    let progressed = false;
    if (await clickIfVisible(getStartedButton)) {
        progressed = true;
    }
    if (await clickIfVisible(skipButton)) {
        progressed = true;
    }
    if (await clickIfVisible(skipButton)) {
        progressed = true;
    }
    if (await clickIfVisible(startUsingButton)) {
        progressed = true;
    }

    if (progressed) {
        await page.waitForTimeout(700);
    }
    return progressed;
}

test.describe('Desktop GUI E2E - SiliconFlow provider in Settings', () => {
    test.skip(
        !hasSiliconFlowApiKeyEnv(),
        'Requires E2E_SILICONFLOW_API_KEY.',
    );
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('configure SiliconFlow in Settings and send a successful message', async ({ page, tauriLogs }) => {
        const siliconFlowApiKey = process.env.E2E_SILICONFLOW_API_KEY?.trim();
        expect(siliconFlowApiKey, 'E2E_SILICONFLOW_API_KEY must be set').toBeTruthy();

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await expect.poll(
            async () => {
                const input = await findChatInput(page);
                if (input) {
                    return true;
                }
                await advanceOnboarding(page);
                return Boolean(await findChatInput(page));
            },
            {
                timeout: 120_000,
                message: 'desktop UI should expose chat input',
            },
        ).toBe(true);

        const initialChatInput = await findChatInput(page);
        expect(initialChatInput, 'desktop UI should expose chat input').not.toBeNull();

        const profileName = `SiliconFlow E2E ${Date.now()}`;

        await page.locator('.sidebar-settings-btn').first().click();
        const settingsDialog = page.locator('.modal-dialog-content').first();
        await expect(settingsDialog).toBeVisible({ timeout: 20_000 });
        await expect(settingsDialog.getByText(/Add\/Edit Profile|添加\/编辑配置/).first()).toBeVisible({ timeout: 20_000 });

        const profileEditor = settingsDialog.locator('[class*="profileEditor"]').first();
        await expect(profileEditor).toBeVisible({ timeout: 20_000 });

        const profileNameInput = profileEditor.locator('input[type="text"]').first();
        await profileNameInput.fill(profileName);

        const providerSelect = profileEditor.locator('select').first();
        await providerSelect.selectOption('siliconflow');

        const apiKeyInput = profileEditor.locator('input[type="password"]').first();
        await apiKeyInput.fill(siliconFlowApiKey!);

        const modelInput = profileEditor.locator('input[type="text"]').last();
        await modelInput.fill(SILICONFLOW_MODEL);

        tauriLogs.setBaseline();
        await profileEditor.getByRole('button', { name: /Verify\s*&\s*Save Profile|验证并保存配置/ }).click();

        await expect.poll(
            () => profileEditor.locator('[class*="validationMessage"]').first().textContent().catch(() => null),
            {
                timeout: 60_000,
                message: 'Settings should verify and save SiliconFlow profile',
            },
        ).toContain('Verification successful');

        const profileCard = settingsDialog.locator('[class*="profileCard"]', { hasText: profileName }).first();
        await expect(profileCard).toBeVisible({ timeout: 30_000 });
        await profileCard.click();
        await expect(profileCard.getByText(/Active|活跃/i).first()).toBeVisible({ timeout: 15_000 });

        await settingsDialog.getByRole('button', { name: /Close|关闭/ }).click();
        await expect(settingsDialog).toBeHidden({ timeout: 15_000 });

        const newSessionButton = page.getByRole('button', {
            name: /Create new session|创建新会话|新建任务/i,
        }).first();
        const canCreateSession = await newSessionButton.isVisible({ timeout: 5_000 }).catch(() => false);
        if (canCreateSession) {
            await newSessionButton.click({ timeout: 5_000 });
            await page.waitForTimeout(1200);
        }

        const llmSettingsSelect = page.getByRole('combobox', { name: /LLM Settings|模型设置/i }).first();
        await expect(llmSettingsSelect).toBeVisible({ timeout: 30_000 });
        await expect.poll(
            async () => llmSettingsSelect.locator('option').allTextContents(),
            {
                timeout: 30_000,
                message: 'LLM dropdown should include newly created SiliconFlow profile',
            },
        ).toContain(profileName);
        await llmSettingsSelect.selectOption({ label: profileName });
        await expect(llmSettingsSelect.locator('option:checked')).toHaveText(new RegExp(escapeRegExp(profileName)));

        const chatInput = await findChatInput(page);
        expect(chatInput, 'chat input should still be available after closing settings').not.toBeNull();

        const taskQuery = '请只回复：siliconflow-e2e-ok';
        tauriLogs.setBaseline();
        await chatInput!.fill(taskQuery);
        await chatInput!.press('Enter');
        await page.waitForTimeout(2000);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        let submitted = false;
        let taskFinished = false;
        let taskFailed = false;
        let taskProducedOutput = false;
        let anthropicNotFound = false;

        const start = Date.now();
        while (Date.now() - start < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);

            const directAnswerButton = page.getByRole('button', {
                name: /直接回答|Direct Answer|Direct response|Direct reply/i,
            }).first();
            const chooseTaskButton = page.getByRole('button', {
                name: /创建任务|Create Task/i,
            }).first();
            const canDirectAnswer = await directAnswerButton.isVisible({ timeout: 300 }).catch(() => false);
            if (canDirectAnswer) {
                await directAnswerButton.click({ timeout: 1_500 }).catch(() => {});
                await page.waitForTimeout(1000);
            } else {
                const canChooseTask = await chooseTaskButton.isVisible({ timeout: 300 }).catch(() => false);
                if (canChooseTask) {
                    await chooseTaskButton.click({ timeout: 1_500 }).catch(() => {});
                    await page.waitForTimeout(1000);
                }
            }

            const logs = tauriLogs.getRawSinceBaseline();
            const lower = logs.toLowerCase();

            submitted =
                submitted ||
                lower.includes('send_task_message command received') ||
                lower.includes('start_task command received') ||
                lower.includes('"type":"start_task"');

            taskFinished =
                taskFinished ||
                lower.includes('"type":"task_finished"') ||
                lower.includes('task_finished');
            taskFailed =
                taskFailed ||
                lower.includes('"type":"task_failed"') ||
                lower.includes('task_failed');
            taskProducedOutput =
                taskProducedOutput ||
                lower.includes('"type":"text_delta"') ||
                lower.includes('"type":"textdelta"') ||
                lower.includes('"type":"text-delta"') ||
                lower.includes('"type":"assistant_message_delta"') ||
                lower.includes('"type":"assistant_delta"');

            anthropicNotFound =
                anthropicNotFound ||
                lower.includes('anthropic api error: 404') ||
                (lower.includes('not_found_error') && lower.includes('anthropic'));

            if (taskFinished || taskFailed || taskProducedOutput) {
                break;
            }
        }

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(taskFailed, 'task should not fail after selecting SiliconFlow profile').toBe(false);
        expect(
            taskFinished || taskProducedOutput,
            'task should produce output (or finish) with SiliconFlow profile',
        ).toBe(true);
        expect(anthropicNotFound, 'should not hit Anthropic 404 not_found_error path').toBe(false);
    });
});
