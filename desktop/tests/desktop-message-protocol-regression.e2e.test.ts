import { test, expect } from './tauriFixtureNoChrome';

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

function buildProtocolRegressionSnapshot() {
    const finalSummary = '已从 skillhub 安装并启用技能 `skill-vetter`。';
    const latestFollowUp = '从 skillhub 中安装 skill-vetter';
    const taskId = 'message-protocol-regression-task-id';
    return {
        finalSummary,
        latestFollowUp,
        snapshot: {
            sessions: [
                {
                    taskId,
                    title: latestFollowUp,
                    status: 'finished',
                    summary: finalSummary,
                    workspacePath: '/Users/beihuang/Documents/github/coworkany/sidecar',
                    createdAt: '2026-03-21T03:54:20.000Z',
                    updatedAt: '2026-03-21T03:54:28.000Z',
                    planSteps: [],
                    toolCalls: [],
                    effects: [],
                    patches: [],
                    messages: [
                        {
                            id: 'user-followup',
                            role: 'user',
                            content: latestFollowUp,
                            timestamp: '2026-03-21T03:54:25.238Z',
                        },
                        {
                            id: 'assistant-streamed',
                            role: 'assistant',
                            content: finalSummary,
                            timestamp: '2026-03-21T03:54:27.611Z',
                        },
                    ],
                    events: [
                        {
                            id: 'event-user-followup',
                            taskId,
                            sequence: 1,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-21T03:54:25.238Z',
                            payload: {
                                role: 'user',
                                content: latestFollowUp,
                            },
                        },
                        {
                            id: 'event-assistant-streamed',
                            taskId,
                            sequence: 2,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-21T03:54:27.611Z',
                            payload: {
                                role: 'assistant',
                                content: finalSummary,
                            },
                        },
                        {
                            id: 'event-finished',
                            taskId,
                            sequence: 3,
                            type: 'TASK_FINISHED',
                            timestamp: '2026-03-21T03:54:27.612Z',
                            payload: {
                                summary: finalSummary,
                                duration: 2351,
                                artifactsCreated: [],
                            },
                        },
                    ],
                },
            ],
            activeTaskId: taskId,
        },
    };
}

test.describe('desktop message protocol regression', () => {
    test.setTimeout(TASK_TIMEOUT_MS);

    test('echoes original user message immediately and shows pending execution status after input submit', async ({ page }) => {
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

    test('routes direct system command into shell authorization without chat confirmation fallback', async ({ page, tauriLogs }) => {
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
    });

    test('renders final assistant response once and does not leak route-wrapper text', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(8000);

        const { finalSummary, latestFollowUp, snapshot } = buildProtocolRegressionSnapshot();
        await page.evaluate(async (payload) => {
            const storeModule = await import('/src/stores/taskEvents/index.ts');
            storeModule.useTaskEventStore.getState().hydrate(payload as any);
        }, snapshot);

        await expect.poll(async () => {
            return await page.locator('.chat-title').getAttribute('title');
        }, {
            timeout: 30_000,
            message: 'chat header should reflect the latest follow-up request',
        }).toBe(latestFollowUp);

        await expect(page.getByText('已从 skillhub 安装并启用技能')).toHaveCount(1);
        await expect(page.getByText('skill-vetter', { exact: true })).toHaveCount(1);
        await expect(page.locator('main').getByText(latestFollowUp)).toBeVisible();
        await expect(page.getByText('原始任务：')).toHaveCount(0);
        await expect(page.getByText('用户路由：')).toHaveCount(0);
    });

    test('renders effect confirmation dialog for shell authorization details', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        await page.evaluate(() => {
            (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit?.(
                'effect-confirmation-required',
                {
                    requestId: 'req-shell-write-protocol-regression',
                    sessionId: 'session-shell-write-protocol-regression',
                    effectType: 'shell:write',
                    description: 'Builtin shell execution requires policy approval before the command runs.',
                    details: {
                        command: 'sudo shutdown -h 03:00',
                        cwd: '/tmp/workspace',
                    },
                    riskLevel: 90,
                    source: 'agent',
                    sourceId: 'run_command',
                },
            );
        });

        await expect(page.getByText(/Permission Required|需要权限/)).toBeVisible();
        await expect(page.getByText(/shell:write/)).toBeVisible();
        await expect(page.getByText(/sudo shutdown -h 03:00/)).toBeVisible();
        await expect(page.getByRole('button', { name: /Approve|批准/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Deny|拒绝/ })).toBeVisible();
    });

    test('continues execution after user approval follow-up (approval-resume)', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15000);

        const input = await findChatInput(page);
        tauriLogs.setBaseline();

        await input.fill('早上3点关机');
        await input.press('Enter');

        const start = Date.now();
        let sawShellApprovalRequest = false;
        let sawApprovalGrant = false;
        let sawExecutionAfterApproval = false;

        while (Date.now() - start < 150_000) {
            await page.waitForTimeout(2000);
            const logs = tauriLogs.getRawSinceBaseline();
            if (
                logs.includes('"type":"request_effect"')
                && logs.includes('"effectType":"shell:write"')
                && logs.includes('"toolName":"run_command"')
            ) {
                sawShellApprovalRequest = true;
            }
            const approvalSignalIndex = Math.max(
                logs.lastIndexOf('"type":"request_effect_response"'),
                logs.lastIndexOf('"approved":true'),
            );
            if (approvalSignalIndex >= 0) {
                sawApprovalGrant = true;
            }
            if (approvalSignalIndex >= 0) {
                const afterApprovalLogs = logs.slice(approvalSignalIndex);
                if (
                    (
                        afterApprovalLogs.includes('"type":"TASK_STATUS"')
                        && (
                            afterApprovalLogs.includes('"status":"running"')
                            || afterApprovalLogs.includes('"status":"finished"')
                            || afterApprovalLogs.includes('"status":"failed"')
                        )
                    )
                    || afterApprovalLogs.includes('"type":"TASK_PROGRESS"')
                    || afterApprovalLogs.includes('"type":"TASK_FINISHED"')
                    || afterApprovalLogs.includes('"type":"TASK_FAILED"')
                ) {
                    sawExecutionAfterApproval = true;
                }
            }
            if (sawShellApprovalRequest && sawApprovalGrant && sawExecutionAfterApproval) {
                break;
            }
        }

        const logs = tauriLogs.getRawSinceBaseline();
        const startTaskCount = (logs.match(/start_task command received/g) ?? []).length;

        expect(sawShellApprovalRequest, 'task should request shell authorization through request_effect before executing the command').toBe(true);
        expect(sawApprovalGrant, 'after the authorization request, desktop should send an approved request_effect_response').toBe(true);
        expect(sawExecutionAfterApproval, 'after user approval, execution should resume in the same task').toBe(true);
        expect(startTaskCount, 'approval-resume should continue in the same task session instead of starting a new task').toBe(1);
    });
});
