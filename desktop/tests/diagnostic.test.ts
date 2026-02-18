/**
 * 诊断测试：验证CoworkAny基本功能
 * 发送简单消息，检查Agent是否响应
 */

import { test, expect } from './tauriFixtureNoChrome';

const SIMPLE_QUERY = '你好，请介绍一下自己';
const TASK_TIMEOUT_MS = 3 * 60 * 1000; // 3分钟

test.describe('Diagnostic Test', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 60_000);

    test('should respond to simple greeting', async ({ page, tauriLogs }) => {
        console.log('[Diagnostic] Starting basic test...');
        
        // Wait for UI
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15000);

        // Find input
        const input = page.locator('input[placeholder="New instructions..."]');
        await input.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[Diagnostic] Input found');

        // Submit simple task
        console.log(`[Diagnostic] Sending: ${SIMPLE_QUERY}`);
        tauriLogs.setBaseline();
        
        await input.fill(SIMPLE_QUERY);
        await input.press('Enter');
        
        // Wait for response (60 seconds max)
        console.log('[Diagnostic] Waiting for response...');
        let responded = false;
        const startTime = Date.now();
        
        while (Date.now() - startTime < 60000) {
            await page.waitForTimeout(2000);
            
            const logs = tauriLogs.getRawSinceBaseline();
            
            // Check for any agent response
            if (logs.includes('TEXT_DELTA') || 
                logs.includes('conversation_item_completed') ||
                logs.includes('TASK_FINISHED')) {
                console.log('[Diagnostic] ✓ Agent responded!');
                responded = true;
                break;
            }
            
            // Check for errors
            if (logs.includes('error') || logs.includes('ERROR')) {
                console.log('[Diagnostic] ⚠️ Error detected in logs');
            }
        }

        expect(responded, 'Agent should respond to greeting').toBe(true);
        console.log('[Diagnostic] ✓ Test passed');
    });
});
