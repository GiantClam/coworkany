import { test, expect } from './tauriFixtureNoChrome';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';
import { assertChatInputEditableAfterTaskTerminal } from './utils/chatInputAssertions';

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

async function ensureTaskListVisible(page: any) {
    const taskList = page.locator('.task-list').first();
    const isVisible = await taskList.isVisible().catch(() => false);
    if (isVisible) {
        return taskList;
    }

    const toggle = page.getByRole('button', { name: /Tasks|任务/ }).first();
    if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
    }
    await expect(taskList).toBeVisible({ timeout: 10_000 });
    return taskList;
}

function buildAibermSeededLlmConfigFromEnv() {
    const apiKey = process.env.E2E_AIBERM_API_KEY?.trim();
    if (!apiKey) {
        return null;
    }

    const profileId = 'desktop-message-protocol-regression-aiberm';
    const model = process.env.TEST_MODEL_ID?.trim() || 'gpt-5.3-codex';
    const baseUrl = process.env.E2E_AIBERM_BASE_URL?.trim() || 'https://aiberm.com/v1';

    return {
        provider: 'aiberm',
        activeProfileId: profileId,
        maxHistoryMessages: 20,
        profiles: [
            {
                id: profileId,
                name: 'Aiberm Desktop Protocol Regression',
                provider: 'aiberm',
                verified: true,
                openai: {
                    apiKey,
                    baseUrl,
                    model,
                },
            },
        ],
    } as const;
}

async function seedAibermLlmConfigIfAvailable(page: any): Promise<boolean> {
    const config = buildAibermSeededLlmConfigFromEnv();
    if (!config) {
        return false;
    }

    const seededProvider = await page.evaluate(async (input) => {
        const tauriInternals = (window as Window & {
            __TAURI_INTERNALS__?: {
                invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
        }).__TAURI_INTERNALS__;
        if (!tauriInternals?.invoke) {
            throw new Error('TAURI invoke bridge is unavailable');
        }

        await tauriInternals.invoke('save_llm_settings', { input });
        const saved = await tauriInternals.invoke('get_llm_settings', {});
        const payload = (saved as { payload?: { provider?: string } })?.payload;
        return typeof payload?.provider === 'string' ? payload.provider : null;
    }, config);

    expect(seededProvider, 'full-chain regression should run with seeded Aiberm provider when E2E_AIBERM_API_KEY is present').toBe('aiberm');
    return true;
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

    test('@critical echoes original user message immediately and shows pending execution status after input submit', async ({ page }) => {
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

    test('@critical shows scheduled confirmation in timeline and sidebar after desktop submit', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15_000);

        const input = await findChatInput(page);
        await input.fill('早上3 点关机');
        await input.press('Enter');

        await expect.poll(async () => {
            const snapshot = await readActiveSessionSnapshot(page);
            return snapshot?.messages.some((message: any) =>
                message.role === 'assistant'
                && String(message.content ?? '').includes('已安排在')
                && String(message.content ?? '').includes('执行')
            ) ?? false;
        }, {
            timeout: 60_000,
            message: 'active session should include the scheduled confirmation assistant message',
        }).toBe(true);

        await expect(page.getByRole('heading', { name: /早上3\s*点关机/ })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByRole('heading', { name: /How can I help you today\?/ })).toHaveCount(0);

        await ensureTaskListVisible(page);
        await expect.poll(async () => {
            const inTaskList = await page
                .locator('.task-list .session-item', { hasText: /早上3\s*点关机/ })
                .first()
                .isVisible()
                .catch(() => false);
            const inWorkspaceSessions = await page
                .locator('.workspace-sessions .session-item', { hasText: /早上3\s*点关机/ })
                .first()
                .isVisible()
                .catch(() => false);
            return inTaskList || inWorkspaceSessions;
        }, {
            timeout: 30_000,
            message: 'scheduled task should be visible in sidebar (task list or workspace section)',
        }).toBe(true);

        await assertChatInputEditableAfterTaskTerminal(page, {
            terminalTimeoutMs: 60_000,
            editableTimeoutMs: 20_000,
        });
    });

    test('@critical @regression renders real assistant timeline reply after send_task_message (full chain)', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15_000);
        const seededAibermConfig = await seedAibermLlmConfigIfAvailable(page);

        const input = await findChatInput(page);
        const prompt = '请用一句中文回复“桌面端回复回归验证通过”，不要执行命令或调用工具。';
        tauriLogs.setBaseline();

        await input.fill(prompt);
        await input.press('Enter');

        let sawTextDelta = false;
        let sawTaskFailed = false;
        let latestAssistantContent = '';
        const start = Date.now();

        while (Date.now() - start < 120_000) {
            await page.waitForTimeout(2_000);
            const logs = tauriLogs.getRawSinceBaseline();
            if (!sawTextDelta && logs.includes('"type":"TEXT_DELTA"')) {
                sawTextDelta = true;
            }
            if (!sawTaskFailed && logs.includes('"type":"TASK_FAILED"')) {
                sawTaskFailed = true;
            }

            const snapshot = await readActiveSessionSnapshot(page);
            const assistantMessages = (snapshot?.messages ?? [])
                .filter((message: any) => message.role === 'assistant')
                .map((message: any) => String(message.content ?? '').trim())
                .filter((content: string) => content.length > 0);
            if (assistantMessages.length > 0) {
                latestAssistantContent = assistantMessages[assistantMessages.length - 1] ?? '';
            }

            if (sawTextDelta && latestAssistantContent.length > 0) {
                break;
            }
        }

        const postLogs = tauriLogs.getRawSinceBaseline();
        const externalDependencyFailure = sawTaskFailed && (
            postLogs.includes('missing_api_key')
            || postLogs.includes('ANTHROPIC_API_KEY')
            || postLogs.includes('OPENAI_API_KEY')
            || postLogs.includes('OPENROUTER_API_KEY')
            || postLogs.includes('E2E_AIBERM_API_KEY')
            || postLogs.includes('Provider returned status 401')
            || postLogs.includes('rate_limit')
            || postLogs.includes('quota')
            || postLogs.includes('insufficient credits')
            || postLogs.includes('generate_fallback_timeout')
            || postLogs.includes('stream_start_timeout')
            || postLogs.includes('stream_idle_timeout')
            || postLogs.includes('stream_progress_timeout')
            || postLogs.includes('stream_max_duration_timeout')
            || postLogs.includes('Model response timed out')
        );
        if (externalDependencyFailure) {
            const reason = seededAibermConfig
                ? 'External model quota/endpoint failure detected after seeding Aiberm settings.'
                : 'External model configuration/quota failure detected during full-chain assistant reply validation (Aiberm seed unavailable).';
            test.skip(true, reason);
        }

        expect(sawTaskFailed, 'task should not fail while validating real assistant timeline rendering').toBe(false);
        expect(sawTextDelta, 'real chain should stream assistant content via TEXT_DELTA').toBe(true);
        expect(latestAssistantContent.length > 0, 'active session should record a non-empty assistant reply').toBe(true);

        const normalizedAssistant = latestAssistantContent.replace(/\s+/g, ' ').trim();
        const excerpt = normalizedAssistant.slice(0, Math.min(24, normalizedAssistant.length));
        expect(excerpt.length > 0, 'assistant reply excerpt should be non-empty').toBe(true);
        await expect(page.locator('main')).toContainText(excerpt, { timeout: 20_000 });

        expect(latestAssistantContent.includes('原始任务：'), 'assistant timeline content should not leak runtime wrapper text').toBe(false);
        expect(latestAssistantContent.includes('用户路由：'), 'assistant timeline content should not leak runtime wrapper text').toBe(false);

        await assertChatInputEditableAfterTaskTerminal(page, {
            terminalTimeoutMs: 90_000,
            editableTimeoutMs: 20_000,
        });
    });

    test('@critical @regression keeps two consecutive chat turns in separate assistant bubbles (full chain)', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15_000);
        const seededAibermConfig = await seedAibermLlmConfigIfAvailable(page);

        const input = await findChatInput(page);
        const promptOne = '你好，请简单问候我一下。';
        const promptTwo = '再补充一句新的问候。';
        tauriLogs.setBaseline();
        const responseWaitMs = 90_000;
        const hasExternalDependencyFailure = (logs: string): boolean => (
            logs.includes('missing_api_key')
            || logs.includes('ANTHROPIC_API_KEY')
            || logs.includes('OPENAI_API_KEY')
            || logs.includes('OPENROUTER_API_KEY')
            || logs.includes('E2E_AIBERM_API_KEY')
            || logs.includes('Provider returned status 401')
            || logs.includes('rate_limit')
            || logs.includes('quota')
            || logs.includes('insufficient credits')
            || logs.includes('generate_fallback_timeout')
            || logs.includes('stream_start_timeout')
            || logs.includes('stream_idle_timeout')
            || logs.includes('stream_progress_timeout')
            || logs.includes('stream_max_duration_timeout')
            || logs.includes('Model response timed out')
        );

        await input.fill(promptOne);
        await input.press('Enter');

        let sawTaskFailed = false;
        let sawFirstAssistantMessage = false;
        let externalDependencyFailure = false;
        let firstAssistantMessageCount = 0;
        const firstDeadline = Date.now() + responseWaitMs;
        while (Date.now() < firstDeadline) {
            await page.waitForTimeout(2_000);
            const logs = tauriLogs.getRawSinceBaseline();
            if (!sawTaskFailed && logs.includes('"type":"TASK_FAILED"')) {
                sawTaskFailed = true;
            }
            if (sawTaskFailed && hasExternalDependencyFailure(logs)) {
                externalDependencyFailure = true;
                break;
            }

            const snapshot = await readActiveSessionSnapshot(page);
            const assistantMessages = (snapshot?.messages ?? [])
                .filter((message: any) => message.role === 'assistant')
                .map((message: any) => String(message.content ?? '').trim())
                .filter((content: string) => content.length > 0);
            if (assistantMessages.length > 0) {
                sawFirstAssistantMessage = true;
                firstAssistantMessageCount = assistantMessages.length;
                break;
            }
        }

        if (!externalDependencyFailure) {
            await assertChatInputEditableAfterTaskTerminal(page, {
                terminalTimeoutMs: 90_000,
                editableTimeoutMs: 20_000,
            });
            await input.fill(promptTwo);
            await input.press('Enter');
        }

        let sawSecondAssistantBubble = false;
        let sawSecondUserMessage = false;
        const secondDeadline = Date.now() + responseWaitMs;
        while (!externalDependencyFailure && Date.now() < secondDeadline) {
            await page.waitForTimeout(2_000);
            const logs = tauriLogs.getRawSinceBaseline();
            if (!sawTaskFailed && logs.includes('"type":"TASK_FAILED"')) {
                sawTaskFailed = true;
            }
            if (sawTaskFailed && hasExternalDependencyFailure(logs)) {
                externalDependencyFailure = true;
                break;
            }

            const snapshot = await readActiveSessionSnapshot(page);
            const userMessages = (snapshot?.messages ?? [])
                .filter((message: any) => message.role === 'user')
                .map((message: any) => String(message.content ?? '').trim())
                .filter((content: string) => content.length > 0);
            const assistantMessages = (snapshot?.messages ?? [])
                .filter((message: any) => message.role === 'assistant')
                .map((message: any) => String(message.content ?? '').trim())
                .filter((content: string) => content.length > 0);
            if (userMessages.length >= 2) {
                sawSecondUserMessage = true;
            }
            if (assistantMessages.length >= firstAssistantMessageCount + 1) {
                sawSecondAssistantBubble = true;
                break;
            }
        }

        const postLogs = tauriLogs.getRawSinceBaseline();
        externalDependencyFailure = externalDependencyFailure || (sawTaskFailed && hasExternalDependencyFailure(postLogs));
        if (externalDependencyFailure) {
            const reason = seededAibermConfig
                ? 'External model quota/endpoint failure detected after seeding Aiberm settings.'
                : 'External model configuration/quota failure detected during two-turn assistant bubble isolation validation (Aiberm seed unavailable).';
            test.skip(true, reason);
        }

        expect(sawTaskFailed, 'two-turn full-chain regression should not fail while validating turn isolation').toBe(false);
        expect(sawFirstAssistantMessage, 'first turn should produce assistant output').toBe(true);
        expect(sawSecondUserMessage, 'second turn should be submitted into session messages').toBe(true);
        expect(sawSecondAssistantBubble, 'second turn should create a new assistant bubble instead of merging into the first one').toBe(true);

        const snapshot = await readActiveSessionSnapshot(page);
        const assistantMessages = (snapshot?.messages ?? [])
            .filter((message: any) => message.role === 'assistant')
            .map((message: any) => String(message.content ?? ''))
            .filter((content: string) => content.trim().length > 0);
        expect(assistantMessages.length >= 2, 'assistant replies should remain in separate bubbles after two turns').toBe(true);

        await assertChatInputEditableAfterTaskTerminal(page, {
            terminalTimeoutMs: 120_000,
            editableTimeoutMs: 20_000,
        });
    });

    test('@regression renders sidecar task events in UI even when event id is missing', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5_000);

        const taskId = `task-ui-missing-id-${Date.now()}`;
        const now = new Date().toISOString();
        const streamedAssistantText = '流式回复展示验证：请在时间线展示这条助手消息。';
        const finishedSummaryText = '任务已结束：这是完成摘要（不应替代上面的流式回复）。';

        await page.evaluate((payload) => {
            const emit = (window as Window & { __codexEmit?: (eventName: string, payload: unknown) => void }).__codexEmit;
            if (!emit) {
                return;
            }
            emit('task-event', {
                taskId: payload.taskId,
                type: 'TASK_STARTED',
                timestamp: payload.now,
                payload: {
                    title: '早上3 点关机',
                    description: '原始任务：早上3 点关机\n用户路由：chat',
                    context: {
                        workspacePath: '/tmp/ui-missing-id',
                        userQuery: '原始任务：早上3 点关机\n用户路由：chat',
                        scheduled: true,
                    },
                },
            });
            emit('task-event', {
                taskId: payload.taskId,
                type: 'TEXT_DELTA',
                timestamp: payload.now,
                payload: {
                    delta: payload.streamedAssistantText,
                    role: 'assistant',
                },
            });
            emit('task-event', {
                taskId: payload.taskId,
                type: 'TASK_FINISHED',
                timestamp: payload.now,
                payload: {
                    summary: payload.finishedSummaryText,
                    finishReason: 'scheduled',
                },
            });
        }, { taskId, now, streamedAssistantText, finishedSummaryText });

        await expect.poll(async () => {
            return await page.evaluate(async (targetTaskId) => {
                const storeModule = await import('/src/stores/taskEvents/index.ts');
                const session = storeModule.useTaskEventStore.getState().getSession(targetTaskId as string);
                if (!session) {
                    return { exists: false, eventCount: 0, allHaveIds: false };
                }
                const allHaveIds = session.events.every((event: any) =>
                    typeof event.id === 'string' && event.id.trim().length > 0
                );
                const hasAssistantDeltaMessage = session.messages.some((message: any) =>
                    message.role === 'assistant'
                    && typeof message.content === 'string'
                    && message.content.includes('流式回复展示验证')
                );
                return {
                    exists: true,
                    eventCount: session.events.length,
                    allHaveIds,
                    hasAssistantDeltaMessage,
                };
            }, taskId);
        }, {
            timeout: 20_000,
            message: 'missing-id sidecar events should still be stored with synthesized ids',
        }).toEqual({
            exists: true,
            eventCount: 3,
            allHaveIds: true,
            hasAssistantDeltaMessage: true,
        });

        const taskList = await ensureTaskListVisible(page);
        const sessionItem = taskList.locator('.session-item', { hasText: /早上3\s*点关机/ }).first();
        await expect(sessionItem).toBeVisible({
            timeout: 20_000,
        });
        await sessionItem.click();

        await expect(page.getByRole('heading', { name: /早上3\s*点关机/ })).toBeVisible({
            timeout: 20_000,
        });
        await expect(page.getByRole('heading', { name: /How can I help you today\?/ })).toHaveCount(0);
        await expect(page.locator('main').getByText(streamedAssistantText)).toBeVisible({
            timeout: 20_000,
        });

        await assertChatInputEditableAfterTaskTerminal(page, {
            terminalTimeoutMs: 20_000,
            editableTimeoutMs: 20_000,
        });
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
        await expect(page.getByRole('heading', { name: latestFollowUp, exact: true })).toBeVisible();
        await expect(page.getByText('原始任务：')).toHaveCount(0);
        await expect(page.getByText('用户路由：')).toHaveCount(0);
    });

    test('renders assistant-ui approval card for shell authorization details', async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        await seedPendingApprovalSession(page, {
            taskId: 'task-shell-write-protocol-regression-ui',
            requestId: 'req-shell-write-protocol-regression',
            effectType: 'shell:write',
            userContent: '早上3点关机',
            title: 'desktop protocol approval card regression',
        });

        await expect(page.getByText(/High risk approvals|高风险审批/)).toBeVisible();
        await expect(page.getByText(/shell:write/)).toBeVisible();
        await expect(page.getByRole('button', { name: /^Approve$|^批准$/ })).toBeVisible();
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
