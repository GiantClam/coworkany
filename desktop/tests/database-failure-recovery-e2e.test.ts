/**
 * E2E Test: Database Failure Recovery via Tauri Desktop Client
 *
 * Tests the ReAct failure recovery mechanism:
 * 1. Launch CoworkAny desktop app
 * 2. Connect to the WebView via CDP
 * 3. Submit a database query task that will fail (invalid connection)
 * 4. Monitor Sidecar logs for:
 *    - Tool failure detection
 *    - Error enhancement (formatErrorForAI)
 *    - Consecutive failure tracking
 *    - Self-learning trigger after threshold
 *    - Suggestion injection into next tool result
 *
 * Run:
 *   cd desktop && npx playwright test tests/database-failure-recovery-e2e.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixture';

const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

async function waitForLogPattern(
    logs: TauriLogCollector,
    pattern: string | RegExp,
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

test.describe('Database Failure Recovery - Tauri Desktop E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('数据库连接失败应触发错误恢复与自学习机制', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        console.log('[Test] Waiting for UI to load...');
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);

        console.log('[Test] Looking for chat input...');
        
        const chatInput = page.locator('input[placeholder*="Ask"], input[placeholder*="cowork"], textarea').first();
        await chatInput.waitFor({ state: 'visible', timeout: 15000 });
        
        console.log('[Test] Submitting database query task that will fail...');
        
        const dbQueryTask = '请帮我连接数据库 192.168.1.100:3306 并查询用户表';
        
        await chatInput.fill(dbQueryTask);
        await chatInput.press('Enter');

        console.log('[Test] Task submitted, waiting for failure recovery logs...');

        const checks = [
            { pattern: /\[ErrorRecovery\] Tool database_/, label: 'ErrorRecovery detected tool failure', timeout: 60000 },
            { pattern: /formatErrorForAI|Enhanced error/, label: 'Error enhancement applied', timeout: 60000 },
            { pattern: /consecutive: (1|2)/, label: 'Consecutive failure tracking', timeout: 90000 },
            { pattern: /triggering self-learning|quickLearnFromError/, label: 'Self-learning triggered', timeout: 120000 },
            { pattern: /\[Self-Learning Recovery\]/, label: 'Learning suggestion injected', timeout: 120000 },
        ];

        let allPassed = true;
        const results: string[] = [];

        for (const check of checks) {
            const found = await waitForLogPattern(tauriLogs, check.pattern, check.timeoutMs, check.label);
            if (found) {
                results.push(`✓ ${check.label}`);
                console.log(`[Test] ✓ ${check.label}`);
            } else {
                results.push(`✗ ${check.label} (timeout after ${check.timeoutMs}ms)`);
                console.log(`[Test] ✗ ${check.label} - NOT FOUND (timeout after ${check.timeoutMs}ms)`);
                allPassed = false;
            }
        }

        console.log('\n[Test] ======= Results =======');
        results.forEach(r => console.log(`[Test] ${r}`));

        // Get recent logs for debugging
        console.log('\n[Test] Recent sidecar logs:');
        const recentLogs = tauriLogs.get().slice(-30);
        recentLogs.forEach((log: string) => {
            if (log.includes('ErrorRecovery') || log.includes('database') || log.includes('Self-Learning')) {
                console.log(`[Log] ${log.substring(0, 200)}`);
            }
        });

        expect(allPassed, `Some recovery checks failed: ${results.join(', ')}`).toBe(true);
    });

    test('数据库操作连续失败应自动重试', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        console.log('[Test] Waiting for UI to load...');
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);

        console.log('[Test] Looking for chat input...');
        const chatInput = page.locator('input[placeholder*="Ask"], input[placeholder*="cowork"], textarea').first();
        await chatInput.waitFor({ state: 'visible', timeout: 15000 });

        console.log('[Test] Submitting task that will trigger retry...');
        
        const dbQueryTask = '连接不存在的数据库 10.0.0.999:5432 执行 SELECT * FROM users';
        
        await chatInput.fill(dbQueryTask);
        await chatInput.press('Enter');

        console.log('[Test] Task submitted, waiting for retry logs...');

        // Check for adaptive retry or error tracking
        const foundRetry = await waitForLogPattern(
            tauriLogs,
            /retry|consecutive|ErrorRecovery/,
            90000,
            'Retry or error tracking'
        );

        // Get logs for analysis
        console.log('\n[Test] Relevant logs:');
        const logs = tauriLogs.get();
        logs.slice(-50).forEach((log: string) => {
            if (log.includes('Error') || log.includes('retry') || log.includes('database')) {
                console.log(`[Log] ${log.substring(0, 200)}`);
            }
        });

        console.log(`[Test] Retry/error tracking detected: ${foundRetry}`);
        expect(foundRetry).toBe(true);
    });
});
