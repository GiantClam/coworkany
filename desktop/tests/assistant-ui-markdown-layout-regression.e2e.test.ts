import { test, expect } from './tauriFixtureSandboxedUi';

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
        const firstTimestamp = events[0]?.timestamp ?? '2026-04-07T12:00:00.000Z';
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
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.evaluate(() => {
        const styleId = 'assistant-ui-markdown-layout-regression-style';
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
    await page.waitForTimeout(500);
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
    await page.waitForTimeout(250);
}

test.describe('assistant-ui markdown layout regression', () => {
    test.setTimeout(120_000);

    test('keeps markdown list markers visible and message rhythm compact', async ({ page }: any) => {
        const taskId = 'assistant-ui-markdown-layout';
        const markdownReply = [
            '当前主要问题：【暂无 / 问题描述】。',
            '',
            '应对措施：【解决动作】。',
            '',
            '四、下一步计划',
            '1.推进【事项C】并完成【目标】。',
            '2）解决【遗留问题】并跟踪结果。',
            '3、按节点输出【阶段成果】。',
        ].join('\n');

        await page.evaluate(() => {
            localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });

        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui markdown layout',
            status: 'finished',
            events: [
                {
                    id: 'assistant-ui-markdown-layout-user',
                    taskId,
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-04-07T12:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '给我一个紧凑版本',
                    },
                },
                {
                    id: 'assistant-ui-markdown-layout-delta',
                    taskId,
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    timestamp: '2026-04-07T12:00:02.000Z',
                    payload: {
                        role: 'assistant',
                        delta: markdownReply,
                    },
                },
                {
                    id: 'assistant-ui-markdown-layout-finish',
                    taskId,
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-04-07T12:00:02.300Z',
                    payload: {
                        summary: markdownReply,
                        finishReason: 'stop',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'light', language: 'zh' });
        await stabilizeVisualFrame(page);

        await expect(page.getByText('四、下一步计划')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('[class*="assistantBubble"] ol > li')).toHaveCount(3, { timeout: 30_000 });

        const metrics = await page.evaluate(() => {
            const assistantBubble = document.querySelector<HTMLElement>('[class*="assistantBubble"]');
            const userBubble = document.querySelector<HTMLElement>('[class*="userBubble"]');
            const orderedList = assistantBubble?.querySelector('ol');
            const listItems = assistantBubble?.querySelectorAll('ol > li');
            const paragraphListGap = orderedList ? Number.parseFloat(getComputedStyle(orderedList).marginTop) : null;

            const assistantLineHeight = assistantBubble ? Number.parseFloat(getComputedStyle(assistantBubble).lineHeight) : null;
            const userLineHeight = userBubble ? Number.parseFloat(getComputedStyle(userBubble).lineHeight) : null;
            const orderedListStyleType = orderedList ? getComputedStyle(orderedList).listStyleType : null;
            const orderedListPaddingLeft = orderedList ? Number.parseFloat(getComputedStyle(orderedList).paddingLeft) : null;

            return {
                assistantLineHeight,
                userLineHeight,
                paragraphListGap,
                orderedListStyleType,
                orderedListPaddingLeft,
                orderedListCount: listItems?.length ?? 0,
            };
        });

        expect(metrics.orderedListCount).toBe(3);
        expect(metrics.orderedListStyleType).toBe('decimal');
        expect((metrics.orderedListPaddingLeft ?? 0) > 0).toBe(true);
        expect(metrics.paragraphListGap).not.toBeNull();
        expect((metrics.paragraphListGap ?? 99) <= 4).toBe(true);
        expect(metrics.assistantLineHeight).not.toBeNull();
        expect(metrics.userLineHeight).not.toBeNull();
        expect(Math.abs((metrics.assistantLineHeight ?? 0) - (metrics.userLineHeight ?? 0))).toBeLessThanOrEqual(1);

        await page.screenshot({
            path: 'test-results/assistant-ui-markdown-layout-after.png',
            fullPage: true,
        });

        await page.evaluate(() => {
            const styleId = 'assistant-ui-markdown-layout-before-emulated';
            const existing = document.getElementById(styleId);
            if (existing) {
                existing.remove();
            }
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                [class*="assistantBubble"] {
                    line-height: 1.6 !important;
                }
                [class*="assistantBubble"] ol,
                [class*="assistantBubble"] ul {
                    list-style: none !important;
                    padding-left: 0 !important;
                }
                [class*="assistantBubble"] p + p {
                    margin-top: 12px !important;
                }
            `;
            document.head.appendChild(style);
        });
        await page.waitForTimeout(200);
        await page.screenshot({
            path: 'test-results/assistant-ui-markdown-layout-before-emulated.png',
            fullPage: true,
        });
    });
});
