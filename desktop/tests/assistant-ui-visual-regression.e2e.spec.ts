import { test, expect } from './tauriFixtureNoChrome';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';

type SeedEvent = {
    id: string;
    taskId: string;
    sequence: number;
    type: string;
    timestamp: string;
    payload: Record<string, unknown>;
};

async function seedSessionFromEvents(page: any, input: {
    taskId: string;
    title: string;
    status: 'running' | 'finished';
    events: SeedEvent[];
}): Promise<void> {
    await page.evaluate(async ({ taskId, title, status, events }) => {
        const storeModule = await import('/src/stores/taskEvents/index.ts');
        const store = storeModule.useTaskEventStore.getState();
        const firstTimestamp = events[0]?.timestamp ?? '2026-03-31T12:00:00.000Z';
        const lastTimestamp = events[events.length - 1]?.timestamp ?? firstTimestamp;

        store.reset();
        store.ensureSession(taskId, {
            title,
            status,
            taskMode: 'immediate_task',
            createdAt: firstTimestamp,
            updatedAt: lastTimestamp,
        }, true);
        store.addEvents(events);
        store.setActiveTask(taskId);
    }, input);
}

async function stabilizeVisualFrame(page: any): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
        const styleId = 'assistant-ui-visual-regression-style';
        if (document.getElementById(styleId)) {
            return;
        }
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          *, *::before, *::after {
            animation: none !important;
            transition: none !important;
            caret-color: transparent !important;
          }
        `;
        document.head.appendChild(style);
    });
    await page.waitForTimeout(600);
}

async function setVisualPreferences(page: any, input: {
    theme: 'light' | 'dark';
    language: 'en' | 'zh';
}): Promise<void> {
    await page.evaluate(async ({ theme, language }) => {
        const themeModule = await import('/src/stores/themeStore.ts');
        themeModule.useThemeStore.getState().setMode(theme);

        const i18nModule = await import('/src/i18n/index.ts');
        await i18nModule.default.changeLanguage(language);
    }, input);
    await page.waitForTimeout(300);
}

test.describe('assistant-ui visual regression', () => {
    test.setTimeout(120_000);

    test('thinking state remains consistent', async ({ page }: any) => {
        await seedSessionFromEvents(page, {
            taskId: 'assistant-ui-visual-thinking',
            title: 'assistant-ui visual thinking',
            status: 'running',
            events: [
                {
                    id: 'assistant-ui-visual-thinking-user',
                    taskId: 'assistant-ui-visual-thinking',
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T10:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请开始执行任务',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'zh' });
        await stabilizeVisualFrame(page);

        await expect(page.getByText('等待模型响应').first()).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.locator('.chat-interface')).toHaveScreenshot('assistant-ui-thinking-state-dark-zh.png', {
            maxDiffPixelRatio: 0.01,
        });
    });

    test('response state remains consistent', async ({ page }: any) => {
        const answer = '任务已完成：视觉回归流程正常。';
        await seedSessionFromEvents(page, {
            taskId: 'assistant-ui-visual-response',
            title: 'assistant-ui visual response',
            status: 'finished',
            events: [
                {
                    id: 'assistant-ui-visual-response-user',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T11:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请给出结果总结',
                    },
                },
                {
                    id: 'assistant-ui-visual-response-delta',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    timestamp: '2026-03-31T11:00:03.000Z',
                    payload: {
                        role: 'assistant',
                        delta: answer,
                    },
                },
                {
                    id: 'assistant-ui-visual-response-finish',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-03-31T11:00:03.500Z',
                    payload: {
                        summary: answer,
                        finishReason: 'stop',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'light', language: 'en' });
        await stabilizeVisualFrame(page);

        await expect(page.getByText(answer)).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.chat-interface')).toHaveScreenshot('assistant-ui-response-state-light-en.png', {
            maxDiffPixelRatio: 0.01,
        });
    });

    test('approval card state remains consistent', async ({ page }: any) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        await seedPendingApprovalSession(page, {
            taskId: 'assistant-ui-visual-approval',
            requestId: 'assistant-ui-visual-approval-request',
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'en' });
        await stabilizeVisualFrame(page);

        await expect(page.getByText('High risk approvals')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.chat-interface')).toHaveScreenshot('assistant-ui-approval-state-dark-en.png', {
            maxDiffPixelRatio: 0.01,
        });
    });
});
