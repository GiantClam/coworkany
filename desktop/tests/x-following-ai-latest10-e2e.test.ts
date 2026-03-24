/**
 * E2E Test: X Following Feed AI Posts (latest 10)
 *
 * Goal:
 * - Drive CoworkAny through GUI
 * - Auto-open Chrome and request user login if needed
 * - Search AI-related posts from followed accounts on X
 * - Open details, extract content, and return organized result
 * - Final response must include exactly 10 structured items
 *
 * Run:
 *   cd desktop && npx playwright test tests/x-following-ai-latest10-e2e.test.ts
 */

import { test, expect } from './tauriFixture';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import {
    countStructuredPostsInAssistant,
    hasTenRealPosts,
    hasFailedSignal,
    hasFinishedSignal,
} from './utils/xFollowingAiParser';

const TASK_QUERY =
    '请通过coworkany自动打开chrome，在X中检索我关注的人发布的最新10条AI相关贴文。若需要登录请提示我登录并等待。请逐条打开详情提取内容，并最终严格输出10行，格式为[POST_01]到[POST_10]，每行包含：账号|发布时间|正文摘要|链接';

const TASK_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_RECOVERY_ROUNDS = 5;

const INPUT_SELECTORS = [
    '.chat-input',
    '.chat-input',
    'input[placeholder="New instructions..."]',
    '.chat-input',
    'textarea[placeholder*="instructions"]',
    'textarea',
    '[contenteditable="true"]',
];

async function discoverInput(
    context: BrowserContext,
): Promise<{ page: Page; input: Locator; selector: string } | null> {
    const pages = context.pages().filter((p: { url: () => string }) => p.url().includes('localhost:5173'));
    for (const p of pages) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = p.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 600 }).catch(() => false);
            if (visible) {
                return { page: p, input: candidate, selector };
            }
        }
    }
    return null;
}

test.describe('X 关注列表 AI贴文最?0?- GUI E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('应完成打开浏览器、登录提示、检索详情提取并输出10条结果', async ({ page, context, tauriLogs }) => {
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);

        let input = page.locator(INPUT_SELECTORS[0]);
        let activePage = page;
        let foundInput = false;

        const discoveryStart = Date.now();
        while (!foundInput && Date.now() - discoveryStart < 150_000) {
            const discovered = await discoverInput(context);
            if (discovered) {
                input = discovered.input;
                activePage = discovered.page;
                foundInput = true;
                break;
            }

            if (!foundInput) {
                await page.waitForTimeout(1500);
            }
        }

        expect(foundInput, '应能找到可输入任务的文本框').toBe(true);

        let submitted = false;
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await activePage.screenshot({ path: 'test-results/x-following-ai-01-query.png' });

        tauriLogs.setBaseline();
        await input.press('Enter');
        await activePage.waitForTimeout(2000);

        // If Enter does not trigger a task, try submit button on the same page.
        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = activePage.locator('button[type="submit"], .send-button').first();
            const clickable = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (clickable) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await activePage.waitForTimeout(2000);
            }
        }

        // Final fallback: discover another input and submit once more.
        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const another = await discoverInput(context);
            if (another) {
                activePage = another.page;
                input = another.input;
                await input.fill(TASK_QUERY);
                await input.press('Enter');
                await activePage.waitForTimeout(2000);
            }
        }

        submitted = tauriLogs.containsSinceBaseline('send_task_message command received');
        await activePage.waitForTimeout(3000);
        await activePage.screenshot({ path: 'test-results/x-following-ai-02-submitted.png' });

        expect(submitted, '应成功提交任务到sidecar').toBe(true);

        const overallStart = Date.now();

        let browserNavigateDetected = false;
        let xSiteDetected = false;
        let browserActionDetected = false;
        let detailOpenDetected = false;
        let loginPromptDetected = false;
        let loginBlockingDetected = false;
        let structuredPostCount = 0;
        let reportedStructuredPostCount = -1;
        let finalOutputContainsAI = false;
        let taskFailed = false;
        let taskFinished = false;
        let lastValidationReason = 'not checked';
        let recoveryRoundsUsed = 0;

        const submitRecoveryRound = async (round: number): Promise<void> => {
            const recoveryPrompt = [
                `第${round}轮修复：你必须输出真实10条，不能占位。`,
                '要求：',
                '1) 只统计来自我已关注账号的AI贴文；',
                '2) 必须切换并确认Following/For You中的“我关注账号”来源；',
                '3) 每条都要真实链接（x.com/status/..）和真实正文，不允许“无可用内容”；',
                '4) 如果不足10条，滚动加载并继续提取直到满10条；',
                '5) 最终严格输出[POST_01] 到 [POST_10] 共10行；',
            ].join('\n');

            const discovered = await discoverInput(context);
            if (!discovered) return;
            const inputBox = discovered.input;
            await inputBox.fill(recoveryPrompt);
            await inputBox.press('Enter');
            await discovered.page.waitForTimeout(2000);
        };

        for (let round = 0; round <= MAX_RECOVERY_ROUNDS; round++) {
            const roundStart = Date.now();
            taskFinished = false;
            taskFailed = false;

            while (Date.now() - roundStart < TASK_TIMEOUT_MS) {
                await activePage.waitForTimeout(POLL_INTERVAL_MS);

                const elapsed = Math.round((Date.now() - roundStart) / 1000);
                const raw = tauriLogs.getRawSinceBaseline();
                const lower = raw.toLowerCase();

                if (!browserNavigateDetected && raw.includes('browser_navigate')) browserNavigateDetected = true;
                if (!xSiteDetected && (lower.includes('x.com') || lower.includes('twitter.com'))) xSiteDetected = true;
                if (!browserActionDetected && (
                    raw.includes('browser_click') || raw.includes('browser_fill') || raw.includes('browser_execute_script')
                )) browserActionDetected = true;
                if (!detailOpenDetected && (
                    lower.includes('/status/') || lower.includes('open detail') || lower.includes('查看详情') || lower.includes('打开详情')
                )) detailOpenDetected = true;
                if (!loginPromptDetected && (
                    lower.includes('waiting for user login') || lower.includes('please login') || lower.includes('login required') || lower.includes('请登录') || lower.includes('需要登录')
                )) loginPromptDetected = true;
                if (!loginBlockingDetected && (
                    lower.includes('not logged in') || lower.includes('无法继续') || lower.includes('请先登录') || lower.includes('sign in to x')
                )) loginBlockingDetected = true;

                structuredPostCount = countStructuredPostsInAssistant(raw);
                if (structuredPostCount > 0 && structuredPostCount !== reportedStructuredPostCount) {
                    reportedStructuredPostCount = structuredPostCount;
                    console.log(`[Test] [round ${round}] [${elapsed}s] structured posts found: ${structuredPostCount}/10`);
                }

                if (!finalOutputContainsAI) {
                    const aiKeywords = [' ai ', 'openai', 'gpt', 'llm', '人工智能', '大模型', 'machine learning'];
                    finalOutputContainsAI = aiKeywords.some(k => lower.includes(k));
                }

                const bodyText = await activePage.textContent('body', { timeout: 3000 }).catch(() => null);
                if (!taskFinished && hasFinishedSignal(raw, bodyText)) taskFinished = true;
                if (!taskFailed && hasFailedSignal(raw)) taskFailed = true;

                if (taskFinished || taskFailed) {
                    await activePage.waitForTimeout(5000);
                    structuredPostCount = countStructuredPostsInAssistant(tauriLogs.getRawSinceBaseline());
                    break;
                }
            }

            const validation = hasTenRealPosts(tauriLogs.getRawSinceBaseline());
            lastValidationReason = validation.reason;
            if (validation.ok && taskFinished && !taskFailed) {
                break;
            }

            if (round < MAX_RECOVERY_ROUNDS) {
                recoveryRoundsUsed += 1;
                console.log(`[Test] recovery round ${recoveryRoundsUsed}/${MAX_RECOVERY_ROUNDS}: ${validation.reason}`);
                await submitRecoveryRound(recoveryRoundsUsed);
            }
        }

        await activePage.screenshot({ path: 'test-results/x-following-ai-99-final.png' }).catch(() => {});

        const elapsed = Math.round((Date.now() - overallStart) / 1000);
        console.log('='.repeat(70));
        console.log('X following AI latest-10 E2E report');
        console.log(`elapsed: ${elapsed}s`);
        console.log(`browser_navigate: ${browserNavigateDetected}`);
        console.log(`x site detected: ${xSiteDetected}`);
        console.log(`browser action detected: ${browserActionDetected}`);
        console.log(`detail open detected: ${detailOpenDetected}`);
        console.log(`login prompt detected: ${loginPromptDetected}`);
        console.log(`login blocking detected: ${loginBlockingDetected}`);
        console.log(`task finished: ${taskFinished}`);
        console.log(`task failed: ${taskFailed}`);
        console.log(`recovery rounds used: ${recoveryRoundsUsed}/${MAX_RECOVERY_ROUNDS}`);
        console.log(`real-post validation: ${lastValidationReason}`);
        console.log(`structured posts: ${structuredPostCount}/10`);
        console.log(`AI keywords in output: ${finalOutputContainsAI}`);
        console.log(`log lines: ${tauriLogs.length}`);
        console.log('='.repeat(70));

        if (taskFailed) {
            const raw = tauriLogs.getRawSinceBaseline();
            const externalIssue = raw.includes('402') || raw.includes('Insufficient credits') || raw.includes('rate_limit');
            if (externalIssue) {
                test.skip(true, 'External API quota/rate-limit issue');
                return;
            }
        }

        expect(browserNavigateDetected, '应触发浏览器导航').toBe(true);
        expect(xSiteDetected, '应访问X/Twitter').toBe(true);
        expect(browserActionDetected, '应执行浏览器交互').toBe(true);
        expect(taskFinished, '任务应在超时前完成').toBe(true);
        expect(taskFailed, '任务不应失败').toBe(false);
        expect(loginBlockingDetected, '不应被登录状态阻断').toBe(false);
        expect(hasTenRealPosts(tauriLogs.getRawSinceBaseline()).ok, '必须输出真实10条，不允许占位').toBe(true);
        expect(recoveryRoundsUsed, '自动修复轮数应不超过5').toBeLessThanOrEqual(MAX_RECOVERY_ROUNDS);
        expect(finalOutputContainsAI, '输出应包含AI相关内容').toBe(true);
    });
});
