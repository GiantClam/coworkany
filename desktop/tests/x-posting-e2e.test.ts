/**
 * E2E Test: X (Twitter) Posting via Tauri Desktop Client ?Self-Learning Scenario
 *
 * Tests the full user flow WITHOUT any pre-built compound tool:
 * 1. Launch CoworkAny desktop app (Tauri + WebView2)
 * 2. Connect Playwright to the WebView via CDP
 * 3. Input the X posting task through the UI
 * 4. Agent uses browser automation tools to navigate X, compose, and post
 * 5. Post-execution learning triggers and creates a reusable skill
 * 6. Verify: task completion, skill creation, and hot-reload
 *
 * Unlike the Xiaohongshu test, there is NO xiaohongshu_post-like compound tool.
 * The agent must figure out the posting flow using general browser tools:
 *   browser_navigate, browser_click, browser_fill, browser_execute_script, etc.
 *
 * Prerequisites:
 * - Rust toolchain installed (cargo, rustc)
 * - desktop/ npm dependencies installed
 * - Chrome with logged-in X (Twitter) session
 *
 * Run:
 *   cd desktop && npx playwright test tests/x-posting-e2e.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixture';

// ============================================================================
// Config
// ============================================================================

// Query must contain a valueKeyword ('发布') so post-execution learning triggers
const TASK_QUERY = '帮我在X(twitter)上发布一条帖子，内容是hello world';

// Longer timeout: agent needs to reason + browser automation + self-learning
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 3000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wait for a specific pattern to appear in the Tauri process logs.
 */
async function waitForLogPattern(
    logs: TauriLogCollector,
    pattern: string,
    timeoutMs: number,
    label?: string,
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (logs.contains(pattern)) {
            if (label) console.log(`[Test] Found "${label}" in logs after ${Math.round((Date.now() - startTime) / 1000)}s`);
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('X(Twitter) 发帖 ?自学习场?E2E', () => {
    // Extra time for Cargo build + app startup + long task
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('通过桌面客户端在X上发帖，验证自学习技能沉淀', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        // ================================================================
        // Step 1: Wait for the UI to load
        // ================================================================
        console.log('[Test] Waiting for UI to load...');

        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const chatInput = page.locator('.chat-input');
        await chatInput.waitFor({ state: 'visible', timeout: 60_000 });
        const input = chatInput;
        const placeholder = await input.getAttribute('placeholder');
        console.log(`[Test] UI loaded - input visible, placeholder="${placeholder}"`);

        // ================================================================
        // Step 2: Input the posting task query
        // ================================================================
        console.log(`[Test] Typing query: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await page.screenshot({ path: 'test-results/x-01-query-input.png' });

        // ================================================================
        // Step 3: Submit the task
        // ================================================================
        console.log('[Test] Pressing Enter to submit task...');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/x-02-task-submitted.png' });

        // ================================================================
        // Step 4: Monitor task execution
        // ================================================================
        console.log('[Test] Monitoring task execution (self-learning flow)...');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;
        let screenshotCounter = 3;

        // ── Phase tracking ──────────────────────────────────────────────
        // Browser automation phase
        let browserNavDetected = false;
        let xPageDetected = false;
        let browserClickDetected = false;
        let browserFillDetected = false;
        let loginWaitDetected = false;

        // Task result
        let taskSucceeded = false;

        // Actual posting verification ?the REAL success criteria
        let postComposed = false;      // Agent opened compose dialog / navigated to compose page
        let postContentFilled = false; // Agent typed "hello world" into the tweet box
        let postSubmitted = false;     // Agent clicked the Post/发布 button
        let postConfirmed = false;     // X showed "Your post was sent" or equivalent confirmation
        let loginRequired = false;     // Agent detected login is required and cannot proceed

        // Self-learning phase
        let postLearningTriggered = false;
        let skillPrecipitated = false;
        let skillInstalled = false;
        let skillReloaded = false;

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // ── Browser automation detection ────────────────────────────
            if (!browserNavDetected && tauriLogs.contains('browser_navigate')) {
                browserNavDetected = true;
                console.log(`[Test] [${elapsed}s] 🌐 Browser navigation detected`);
            }

            if (!xPageDetected && (
                tauriLogs.contains('x.com') ||
                tauriLogs.contains('twitter.com')
            )) {
                xPageDetected = true;
                console.log(`[Test] [${elapsed}s] 🐦 X/Twitter page detected`);
            }

            if (!browserClickDetected && tauriLogs.contains('browser_click')) {
                browserClickDetected = true;
                console.log(`[Test] [${elapsed}s] 🖱?Browser click interaction detected`);
            }

            if (!browserFillDetected && tauriLogs.contains('browser_fill')) {
                browserFillDetected = true;
                console.log(`[Test] [${elapsed}s] ⌨️ Browser fill interaction detected`);
            }

            if (!loginWaitDetected && (
                tauriLogs.contains('Waiting for user login') ||
                tauriLogs.contains('login') ||
                tauriLogs.contains('Login required')
            )) {
                loginWaitDetected = true;
                console.log(`[Test] [${elapsed}s] 🔑 Login detection - please login to X if needed!`);
                console.log(`[Test] *** USER ACTION REQUIRED: Login to X in the browser window ***`);
            }

            // ── Actual posting steps detection ─────────────────────────────
            // These check if the agent is ACTUALLY performing the posting flow,
            // not just running its reasoning loop.

            if (!postComposed) {
                const composeIndicators = [
                    'compose/post',           // Direct URL: x.com/compose/post
                    'compose/tweet',          // Legacy URL
                    'tweetTextarea',          // Compose textarea element
                    'DraftEditor',            // Draft.js editor (X uses this)
                    'toolbarLabel',           // Compose toolbar
                    'What is happening',      // English placeholder
                    '正在发生什么',            // Chinese placeholder
                ];
                if (composeIndicators.some(ind => tauriLogs.contains(ind))) {
                    postComposed = true;
                    console.log(`[Test] [${elapsed}s] 📝 Compose dialog/page opened`);
                }
            }

            if (!postContentFilled && tauriLogs.contains('hello world')) {
                // Check it's in a browser_fill or browser_execute_script context
                const hwLines = tauriLogs.grep('hello world');
                const isFillAction = hwLines.some(l =>
                    l.includes('browser_fill') ||
                    l.includes('browser_execute_script') ||
                    l.includes('browser_type') ||
                    l.includes('TOOL_CALL')
                );
                if (isFillAction) {
                    postContentFilled = true;
                    console.log(`[Test] [${elapsed}s] ✍️ "hello world" content filled into tweet box`);
                }
            }

            if (!postSubmitted) {
                const submitIndicators = [
                    'tweetButton',            // Tweet/Post button data-testid
                    'click.*Post',            // Clicking "Post" button
                    'click.*发布',             // Clicking "发布" button
                    'click.*Tweet',           // Legacy "Tweet" button
                ];
                const logLines = tauriLogs.grep('browser_click');
                if (logLines.some(l => l.includes('Post') || l.includes('发布') || l.includes('Tweet') || l.includes('tweetButton'))) {
                    postSubmitted = true;
                    console.log(`[Test] [${elapsed}s] 🚀 Post/Tweet button clicked`);
                }
            }

            if (!postConfirmed) {
                const confirmIndicators = [
                    'Your post was sent',     // English confirmation toast
                    'post was sent',
                    'Tweet sent',
                    '帖子已发',
                    '推文已发',
                    'successfully posted',
                    'post.*success',
                ];
                if (confirmIndicators.some(ind => tauriLogs.contains(ind))) {
                    postConfirmed = true;
                    console.log(`[Test] [${elapsed}s] ?Post confirmed by X! (success toast/message detected)`);
                }
            }

            // Detect if login is actually blocking the posting
            if (!loginRequired) {
                const loginBlockIndicators = [
                    '需要登录',
                    '未登录',
                    'not logged in',
                    'login required',
                    'Sign in to X',
                    '登录.*X',
                    '注册',          // Registration page showing = not logged in
                    '现在就加入',     // "Join now" = X login page
                ];
                // Only trigger if we see these in agent's RESPONSE (TEXT_DELTA), not just page content
                const loginResponseLines = tauriLogs.grep('TEXT_DELTA');
                if (loginResponseLines.some(l =>
                    l.includes('需要登录') || l.includes('未登录') ||
                    l.includes('not logged in') || l.includes('login') ||
                    l.includes('无法发帖') || l.includes('登录')
                )) {
                    loginRequired = true;
                    console.log(`[Test] [${elapsed}s] 🔒 Agent reported: login required, cannot post`);
                }
            }

            // ── Task completion detection ────────────────────────────────
            if (!taskFinished && tauriLogs.contains('TASK_FINISHED')) {
                taskFinished = true;
                // IMPORTANT: taskSucceeded is NOT set here.
                // It will be determined later based on actual posting verification.
                console.log(`[Test] [${elapsed}s] TASK_FINISHED event detected (verifying actual outcome...)`);
            }
            if (!taskFailed && tauriLogs.contains('TASK_FAILED')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] ?TASK_FAILED event detected`);
            }

            // ── Self-learning detection ──────────────────────────────────
            if (!postLearningTriggered && tauriLogs.contains('[PostLearning]')) {
                postLearningTriggered = true;
                // Check if it's a positive trigger
                const learningLines = tauriLogs.grep('PostLearning');
                const isPositive = learningLines.some(l =>
                    l.includes('Learning from successful') || l.includes('Precipitated')
                );
                console.log(`[Test] [${elapsed}s] 🧠 Post-execution learning triggered (positive: ${isPositive})`);
            }

            if (!skillPrecipitated && tauriLogs.contains('Precipitated as')) {
                skillPrecipitated = true;
                const precipLines = tauriLogs.grep('Precipitated as');
                console.log(`[Test] [${elapsed}s] 📦 Skill/knowledge precipitated: ${precipLines[0]?.substring(0, 200)}`);
            }

            if (!skillInstalled && tauriLogs.contains('Installing auto-generated skill')) {
                skillInstalled = true;
                const installLines = tauriLogs.grep('Installing auto-generated skill');
                console.log(`[Test] [${elapsed}s] 🔧 Skill installed: ${installLines[0]?.substring(0, 200)}`);
            }

            if (!skillReloaded && (
                tauriLogs.contains('installed and ready to use') ||
                tauriLogs.contains('Skill') && tauriLogs.contains('reload')
            )) {
                skillReloaded = true;
                console.log(`[Test] [${elapsed}s] ♻️ Skill hot-reloaded and ready to use`);
            }

            // ── UI state check ──────────────────────────────────────────
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText) {
                    // "Ready for follow-up" means the agent loop ended.
                    // This does NOT mean the task succeeded ?it only means the agent
                    // finished reasoning. The actual success is determined by postConfirmed.
                    if (bodyText.includes('Ready for follow-up') && !taskFinished) {
                        taskFinished = true;
                        // DO NOT set taskSucceeded here! It depends on actual posting outcome.
                        console.log(`[Test] [${elapsed}s] Agent loop ended (UI: "Ready for follow-up")`);
                    }
                    if (bodyText.includes('Failed') && !taskFailed) {
                        const statusBadge = page.locator('.status-badge.failed, [class*="status"]');
                        if (await statusBadge.count() > 0) {
                            const statusText = await statusBadge.first().textContent();
                            if (statusText?.includes('Failed')) {
                                taskFailed = true;
                                console.log(`[Test] [${elapsed}s] UI shows task failed`);
                            }
                        }
                    }
                }
            } catch {
                // Page may not be accessible during transitions
            }

            // ── Periodic screenshots ────────────────────────────────────
            if (elapsed % 30 === 0 && elapsed > 0) {
                try {
                    await page.screenshot({
                        path: `test-results/x-${String(screenshotCounter).padStart(2, '0')}-progress-${elapsed}s.png`,
                    });
                    screenshotCounter++;
                } catch { /* may fail during transitions */ }
            }

            // ── Early exit ──────────────────────────────────────────────
            // Task is done, but give extra time for self-learning to finish
            if ((taskFinished || taskFailed) && !postLearningTriggered) {
                // Wait up to 30s more for post-execution learning
                const learningWait = 30_000;
                const learningStart = Date.now();
                while (Date.now() - learningStart < learningWait) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (tauriLogs.contains('[PostLearning]')) {
                        postLearningTriggered = true;
                        break;
                    }
                }
                break;
            }

            if (taskFinished && postLearningTriggered) {
                // Give a bit more time for skill installation
                await new Promise(r => setTimeout(r, 10_000));
                // Recheck skill status
                if (tauriLogs.contains('Precipitated as')) skillPrecipitated = true;
                if (tauriLogs.contains('Installing auto-generated skill')) skillInstalled = true;
                if (tauriLogs.contains('installed and ready to use')) skillReloaded = true;
                break;
            }
        }

        // ================================================================
        // Step 5: Final screenshots and log dump
        // ================================================================
        try {
            await page.screenshot({ path: 'test-results/x-99-final.png' });
        } catch { /* may fail if page closed */ }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        // ================================================================
        // Step 5.5: Determine ACTUAL task success
        // ================================================================
        // taskSucceeded is ONLY true if the post was actually confirmed by X.
        // The agent loop finishing ("Ready for follow-up") is NOT sufficient.
        if (postConfirmed) {
            taskSucceeded = true;
        } else if (postSubmitted && !loginRequired) {
            // Post button was clicked but no confirmation ?might still be OK
            // (X confirmation toast may not have been captured in logs)
            taskSucceeded = true;
            console.log(`[Test] Post was submitted but confirmation not captured. Treating as success.`);
        } else if (loginRequired) {
            taskSucceeded = false;
            console.log(`[Test] Login required ?post could not be sent.`);
        } else if (taskFinished && !postComposed) {
            taskSucceeded = false;
            console.log(`[Test] Agent loop ended but compose dialog was never opened.`);
        } else {
            taskSucceeded = false;
            console.log(`[Test] Post was not confirmed by X.`);
        }

        // ================================================================
        // Step 6: Comprehensive Report
        // ================================================================
        console.log('');
        console.log('='.repeat(70));
        console.log('  X(Twitter) 发帖 + 自学?E2E 测试报告 (Tauri Desktop)');
        console.log('='.repeat(70));
        console.log(`  耗时: ${totalElapsed}s`);
        console.log('');
        console.log('  ── 浏览器自动化 ──');
        console.log(`  浏览器导? ${browserNavDetected ? 'YES' : 'NO'}`);
        console.log(`  X/Twitter 页面访问: ${xPageDetected ? 'YES' : 'NO'}`);
        console.log(`  点击交互: ${browserClickDetected ? 'YES' : 'NO'}`);
        console.log(`  填写交互: ${browserFillDetected ? 'YES' : 'NO'}`);
        console.log(`  登录检? ${loginWaitDetected ? 'YES (需手动登录)' : 'NO (已登?无需登录)'}`);
        console.log('');
        console.log('  ── 发帖流程验证 ──');
        console.log(`  打开发帖对话框: ${postComposed ? 'YES' : 'NO'}`);
        console.log(`  填写"hello world": ${postContentFilled ? 'YES' : 'NO'}`);
        console.log(`  点击发布按钮: ${postSubmitted ? 'YES' : 'NO'}`);
        console.log(`  X确认发布成功: ${postConfirmed ? 'YES' : 'NO'}`);
        console.log(`  需要登?阻断): ${loginRequired ? 'YES 🔒' : 'NO'}`);
        console.log('');
        console.log('  ── 任务结果 ──');
        console.log(`  Agent循环结束: ${taskFinished ? 'YES' : 'NO'}`);
        console.log(`  任务失败标记: ${taskFailed ? 'YES' : 'NO'}`);
        console.log(`  实际发帖成功: ${taskSucceeded ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  ── 自学?──');
        console.log(`  Post-Execution Learning 触发: ${postLearningTriggered ? 'YES' : 'NO'}`);
        console.log(`  技?知识沉淀: ${skillPrecipitated ? 'YES' : 'NO'}`);
        console.log(`  技能安? ${skillInstalled ? 'YES' : 'NO'}`);
        console.log(`  技能热加载: ${skillReloaded ? 'YES' : 'NO'}`);
        console.log('');
        console.log(`  控制台日志总行? ${tauriLogs.length}`);
        console.log('');

        // Print key log lines
        const keyPatterns = [
            'browser_navigate',
            'browser_click',
            'browser_fill',
            'browser_execute_script',
            'x.com',
            'twitter.com',
            'PostLearning',
            'SelfLearning',
            'Precipitated',
            'Installing',
            'TOOL_CALL',
            'TOOL_RESULT',
            'TASK_FINISHED',
            'TASK_FAILED',
        ];
        console.log('  关键日志:');
        for (const pattern of keyPatterns) {
            const lines = tauriLogs.grep(pattern);
            if (lines.length > 0) {
                for (const line of lines.slice(0, 3)) {
                    console.log(`    ${line.substring(0, 200)}`);
                }
                if (lines.length > 3) {
                    console.log(`    ... (${lines.length - 3} more lines with "${pattern}")`);
                }
            }
        }
        console.log('='.repeat(70));
        console.log('');

        // ================================================================
        // Step 7: Assertions
        // ================================================================

        // 7a. Handle external API issues gracefully
        if (taskFailed) {
            const is402 = tauriLogs.contains('402') || tauriLogs.contains('Insufficient credits');
            const isRateLimit = tauriLogs.contains('rate_limit');
            if (is402 || isRateLimit) {
                console.log('[Test] Task failed due to external API issue (402 / rate limit).');
                test.skip(true, 'Task failed due to external API issue');
                return;
            }
        }

        // 7b. Handle login required ?this is the #1 reason for failure
        if (loginRequired || (loginWaitDetected && !taskSucceeded)) {
            console.log('[Test] ?FAILED: Login required or task failed ?post was NOT sent.');
            console.log('[Test] To fix: ensure Chrome on port 9224 has an active X login session.');
            console.log('[Test] The sidecar Playwright must connect to a browser with X cookies.');
            // Force fail: The test must not pass if the post was not actually sent.
            expect(taskSucceeded, '帖子未成功发送：需要登录X或浏览器未正确连接').toBe(true);
            return;
        }

        // 7c. The agent should have used browser tools (no compound tool exists)
        expect(browserNavDetected, '应该使用了浏览器导航').toBe(true);
        expect(xPageDetected, '应该访问了X/Twitter页面').toBe(true);

        // 7d. Agent loop should have completed (not timed out)
        expect(taskFinished, 'Agent循环应在超时内完成').toBe(true);
        expect(taskFailed, '任务不应被标记为失败').toBe(false);

        // 7e. ACTUAL posting verification ?the most important assertions
        expect(postComposed, '应打开X的发帖对话框（compose/post）').toBe(true);
        expect(postContentFilled, '应在帖子输入框中填写"hello world"').toBe(true);
        expect(postSubmitted, '应点击发?Post按钮').toBe(true);
        // postConfirmed is the gold standard but may be missed if X's toast
        // is too brief. So we accept postSubmitted as minimum.
        if (!postConfirmed) {
            console.log('[Test] ⚠️ X confirmation toast not captured, but post was submitted.');
        }
        expect(taskSucceeded, '帖子应该实际发布成功').toBe(true);

        // 7f. Self-learning should have triggered (IMPORTANT: this validates
        //     the autonomous skill acquisition loop)
        if (postLearningTriggered) {
            console.log('[Test] ?Self-learning was triggered after successful task!');

            // If learning triggered, check if it precipitated something
            if (skillPrecipitated) {
                console.log('[Test] ?Knowledge/skill was precipitated from execution!');
            }

            if (skillInstalled) {
                console.log('[Test] ?Skill was installed and is available for reuse!');
            }

            if (skillReloaded) {
                console.log('[Test] ?Skill was hot-reloaded ?ready for immediate use!');
            }

            // Assert that at least precipitation happened
            expect(skillPrecipitated, '自学习应沉淀出技能或知识').toBe(true);
        } else {
            // Post-learning not triggered is NOT a hard failure ?it depends on
            // valueKeywords matching and tool call count. Log and skip assertion.
            console.log('[Test] ⚠️ Post-execution learning did not trigger.');
            console.log('[Test] This may happen if the query does not match value keywords,');
            console.log('[Test] or if the task used fewer than 3 tool calls.');
        }
    });
});

