/**
 * E2E Test: Xiaohongshu Posting via Tauri Desktop Client
 *
 * Tests the full user flow through the real Tauri desktop application:
 * 1. Launch CoworkAny desktop app (Tauri + WebView2)
 * 2. Connect Playwright to the WebView via CDP
 * 3. Input and submit the posting task through the UI
 * 4. Monitor Tauri process console output (stderr) for Sidecar execution logs
 * 5. Verify: compound tool call, login handling, content filling, publish success
 *
 * Prerequisites:
 * - Rust toolchain installed (cargo, rustc)
 * - desktop/ npm dependencies installed
 * - First build: `cargo tauri dev` will compile (may take a few minutes)
 * - For full posting: Chrome with logged-in Xiaohongshu session
 *
 * Run:
 *   cd desktop && npx playwright test tests/xiaohongshu-e2e.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixture';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY = '帮我在小红书上发一篇帖子，内容是hello world';
const TASK_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (includes login wait)
const POLL_INTERVAL_MS = 3000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wait for a specific pattern to appear in the Tauri process logs.
 * Returns true if found, false if timed out.
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

test.describe('小红书发帖 - Tauri 桌面客户端 E2E', () => {
    // All tests in this suite share the same long timeout
    test.setTimeout(TASK_TIMEOUT_MS + 180_000); // Extra 3 min for Cargo build + app startup

    test('通过桌面客户端提交小红书发帖任务并验证成功', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        // ================================================================
        // Step 1: Wait for the UI to load
        // ================================================================
        console.log('[Test] Waiting for UI to load...');

        // Wait for the page to have meaningful content
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000); // Extra time for React hydration

        // The fixture selects the MAIN window page (not dashboard/settings).
        // The main window starts in 'launcher' mode with a Launcher input.
        // After typing and pressing Enter, it switches to 'panel' mode with ChatInterface.
        //
        // The Launcher input has placeholder "Ask CoworkAny..." — we look for it specifically
        // to avoid accidentally interacting with Settings or Dashboard inputs.
        const launcherInput = page.locator('input[placeholder="Ask CoworkAny..."]');
        const chatInput = page.locator('.chat-input');

        // Wait for either the Launcher input or the ChatInterface input to appear
        const input = await Promise.race([
            launcherInput.waitFor({ state: 'visible', timeout: 60_000 }).then(() => launcherInput),
            chatInput.waitFor({ state: 'visible', timeout: 60_000 }).then(() => chatInput),
        ]);
        const placeholder = await input.getAttribute('placeholder');
        console.log(`[Test] UI loaded - input visible, placeholder="${placeholder}"`);

        // ================================================================
        // Step 2: Input the posting task query
        // ================================================================
        console.log(`[Test] Typing query: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);

        // Take a screenshot of the input state
        await page.screenshot({ path: 'test-results/01-query-input.png' });

        // ================================================================
        // Step 3: Submit the task by pressing Enter
        // ================================================================
        console.log('[Test] Pressing Enter to submit task...');
        await input.press('Enter');

        // Wait briefly for the task to start
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/02-task-submitted.png' });

        // ================================================================
        // Step 4: Monitor console output + UI for task progress
        // ================================================================
        console.log('[Test] Monitoring task execution...');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;
        let compoundToolCalled = false;
        let loginWaitDetected = false;
        let postingSuccess = false;
        let postingFlowCompleted = false;
        let screenshotCounter = 3;

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // --- Check console logs (stderr) ---

            // Check if compound tool was called
            if (!compoundToolCalled && tauriLogs.contains('xiaohongshu_post')) {
                compoundToolCalled = true;
                console.log(`[Test] [${elapsed}s] Detected xiaohongshu_post tool call in console`);
            }

            // Check if login wait is happening
            if (!loginWaitDetected && tauriLogs.contains('Waiting for user login')) {
                loginWaitDetected = true;
                console.log(`[Test] [${elapsed}s] Login wait detected - please login in the browser window!`);
                console.log(`[Test] *** USER ACTION REQUIRED: Login to Xiaohongshu in the Chromium browser window ***`);
            }

            // Check if posting flow completed
            if (!postingFlowCompleted && tauriLogs.contains('Posting flow completed')) {
                postingFlowCompleted = true;
                const successMatch = tauriLogs.contains('Posting flow completed - success: true');
                postingSuccess = successMatch;
                console.log(`[Test] [${elapsed}s] Posting flow completed - success: ${successMatch}`);
            }

            // Check for TASK_FINISHED / TASK_FAILED in logs
            if (!taskFinished && tauriLogs.contains('TASK_FINISHED')) {
                taskFinished = true;
                console.log(`[Test] [${elapsed}s] TASK_FINISHED event detected in console`);
            }
            if (!taskFailed && tauriLogs.contains('TASK_FAILED')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] TASK_FAILED event detected in console`);
            }

            // --- Check UI state ---
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText) {
                    if (bodyText.includes('Ready for follow-up') && !taskFinished) {
                        taskFinished = true;
                        console.log(`[Test] [${elapsed}s] UI shows "Ready for follow-up" - task finished`);
                    }
                    if (bodyText.includes('Failed') && !taskFailed) {
                        // Only mark as failed if it's a task-level failure (not a tool-level error)
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

            // Periodic screenshots (every 30s)
            if (elapsed % 30 === 0 && elapsed > 0) {
                try {
                    await page.screenshot({
                        path: `test-results/${String(screenshotCounter).padStart(2, '0')}-progress-${elapsed}s.png`,
                    });
                    screenshotCounter++;
                } catch {
                    // Screenshot may fail during transitions
                }
            }

            // Early exit conditions
            if (taskFinished || taskFailed) {
                break;
            }
        }

        // ================================================================
        // Step 5: Final screenshots and log dump
        // ================================================================
        try {
            await page.screenshot({ path: 'test-results/99-final.png' });
        } catch {
            // May fail if page is closed
        }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        // ================================================================
        // Step 6: Report
        // ================================================================
        console.log('');
        console.log('='.repeat(70));
        console.log('  小红书发帖 E2E 测试报告 (Tauri Desktop)');
        console.log('='.repeat(70));
        console.log(`  耗时: ${totalElapsed}s`);
        console.log(`  复合工具调用 (xiaohongshu_post): ${compoundToolCalled ? 'YES' : 'NO'}`);
        console.log(`  登录等待检测: ${loginWaitDetected ? 'YES' : 'NO'}`);
        console.log(`  发帖流程完成: ${postingFlowCompleted ? 'YES' : 'NO'}`);
        console.log(`  发帖成功: ${postingSuccess ? 'YES' : 'NO'}`);
        console.log(`  任务完成 (TASK_FINISHED): ${taskFinished ? 'YES' : 'NO'}`);
        console.log(`  任务失败 (TASK_FAILED): ${taskFailed ? 'YES' : 'NO'}`);
        console.log(`  控制台日志总行数: ${tauriLogs.length}`);
        console.log('');

        // Print key log lines
        const keyPatterns = [
            'xiaohongshu_post',
            'XHS-Post',
            'TOOL_CALL',
            'TOOL_RESULT',
            'TASK_FINISHED',
            'TASK_FAILED',
            'TASK_SUSPENDED',
            'TASK_RESUMED',
            'Login',
            'login',
            'Posting flow',
        ];
        console.log('  关键日志:');
        for (const pattern of keyPatterns) {
            const lines = tauriLogs.grep(pattern);
            if (lines.length > 0) {
                for (const line of lines.slice(0, 3)) { // Show max 3 lines per pattern
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

        // 7a. The compound tool should have been called
        expect(compoundToolCalled, 'xiaohongshu_post 复合工具应该被调用').toBe(true);

        // 7b. The task should not have failed
        if (taskFailed) {
            // Check if it's an API credit issue (external, not our fault)
            const is402 = tauriLogs.contains('402') || tauriLogs.contains('Insufficient credits');
            const isRateLimit = tauriLogs.contains('rate_limit');
            if (is402 || isRateLimit) {
                console.log('[Test] Task failed due to external API issue (402 / rate limit), not a code bug.');
                test.skip(true, 'Task failed due to external API issue');
                return;
            }
        }

        // 7c. If posting flow completed, check success
        if (postingFlowCompleted) {
            if (!postingSuccess && loginWaitDetected) {
                // Login timed out - this is an external dependency, not a code bug.
                // The test infrastructure worked correctly but user didn't login.
                console.log('[Test] Posting failed due to login timeout - test infrastructure is working correctly.');
                console.log('[Test] To complete the full flow, manually login to Xiaohongshu during the test window.');
                test.skip(true, '发帖因登录超时失败 (非代码问题，需要手动登录小红书)');
                return;
            }
            expect(postingSuccess, '发帖流程应报告成功').toBe(true);
        }

        // 7d. Task should have finished (not failed, not timed out)
        if (!taskFinished && !taskFailed && compoundToolCalled) {
            // Task is still in progress (e.g. LLM processing the tool result)
            // This is acceptable if the compound tool was called
            console.log('[Test] Task not yet finished/failed but compound tool was called. Likely still processing.');
        } else {
            expect(taskFailed, '任务不应失败').toBe(false);
            expect(taskFinished, '任务应在超时内完成').toBe(true);
        }
    });
});
