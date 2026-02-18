/**
 * E2E Test: Stock Investment Research with Self-Learning
 *
 * Test: CoworkAny retrieves AI news, researches CLOUDFLARE, REDDIT, NVIDIA stocks,
 * provides investment advice, and creates stock investor skill via self-learning.
 *
 * Run: cd desktop && npx playwright test tests/stock-research-e2e.test.ts
 */

import { test, expect } from './tauriFixtureNoChrome';

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const TASK_TIMEOUT_MS = 15 * 60 * 1000;

test.describe('Stock Research Self-Learning E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('should research AI news and stocks, then provide investment advice', async ({ page, tauriLogs }) => {
        console.log('[Test] Starting stock research test...');
        
        // Wait for UI - extended wait for React hydration (15 seconds)
        await page.waitForLoadState('domcontentloaded');
        console.log('[Test] Waiting 15s for React hydration...');
        await page.waitForTimeout(15000);

        // Find input - try multiple selectors
        const selectors = [
            'input[placeholder="Ask CoworkAny..."]',
            'input[placeholder="New instructions..."]',
            '.chat-input input',
            '.chat-input textarea',
            'input[type="text"]',
        ];

        let input = null;
        for (const selector of selectors) {
            try {
                const locator = page.locator(selector);
                const count = await locator.count();
                if (count > 0) {
                    await locator.first().waitFor({ state: 'visible', timeout: 5000 });
                    input = locator.first();
                    console.log(`[Test] Found input with: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!input) {
            throw new Error('Could not find any input field');
        }

        console.log('[Test] Input ready');

        // Submit task
        console.log(`[Test] Submitting: ${TASK_QUERY}`);
        tauriLogs.setBaseline();
        
        await input.fill(TASK_QUERY);
        await input.press('Enter');
        await page.waitForTimeout(3000);

        console.log('[Test] Monitoring task execution...');

        const startTime = Date.now();
        let finished = false;
        let failed = false;
        let researchCompleted = false;
        let lastActivityTime = Date.now();
        
        // Monitor for 15 minutes
        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(5000); // Check every 5 seconds
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            const logs = tauriLogs.getRawSinceBaseline();
            const rawLogs = tauriLogs.getRaw();
            
            // Check for various completion indicators
            const hasTaskFinished = logs.includes('TASK_FINISHED') || logs.includes('"type":"TASK_FINISHED"');
            const hasTaskFailed = logs.includes('TASK_FAILED') || logs.includes('"type":"TASK_FAILED"');
            const hasAgentResponse = logs.includes('TEXT_DELTA') || logs.includes('conversation_item_completed');
            
            // Check research activities
            if (!finished && hasTaskFinished) {
                finished = true;
                console.log(`[${elapsed}s] ✓ Task finished event detected`);
                lastActivityTime = Date.now();
            }
            
            if (!failed && hasTaskFailed) {
                failed = true;
                console.log(`[${elapsed}s] ✗ Task failed event detected`);
                break;
            }
            
            // Check for web search usage
            if (logs.includes('search_web') || logs.includes('"name":"search_web"')) {
                if (elapsed % 30 === 0) { // Log every 30 seconds to avoid spam
                    console.log(`[${elapsed}s] Web search tool used`);
                }
                lastActivityTime = Date.now();
            }
            
            // Check for AI/stock research indicators
            const hasStockMention = logs.toLowerCase().includes('cloudflare') || 
                                   logs.toLowerCase().includes('reddit') || 
                                   logs.toLowerCase().includes('nvidia') ||
                                   logs.toLowerCase().includes('nvda');
            
            const hasInvestmentAdvice = logs.toLowerCase().includes('buy') || 
                                       logs.toLowerCase().includes('sell') || 
                                       logs.toLowerCase().includes('hold') ||
                                       logs.includes('投资') ||
                                       logs.includes('建议');
            
            if (hasStockMention && hasInvestmentAdvice && !researchCompleted) {
                researchCompleted = true;
                console.log(`[${elapsed}s] ✓ Research and investment advice detected`);
                lastActivityTime = Date.now();
            }
            
            // Check for refusal (agent saying it cannot do it)
            if (logs.includes('无法') && logs.includes('不能')) {
                console.log(`[${elapsed}s] ⚠️ WARNING: Agent may be refusing the request`);
            }
            
            // Exit conditions:
            // 1. Task explicitly finished
            // 2. Task failed
            // 3. Research completed and no activity for 30 seconds
            if (finished) {
                console.log(`[${elapsed}s] Task completed successfully`);
                break;
            }
            
            if (failed) {
                console.log(`[${elapsed}s] Task failed`);
                break;
            }
            
            // If research is done and no new activity for 30s, consider it complete
            if (researchCompleted && (Date.now() - lastActivityTime > 30000)) {
                console.log(`[${elapsed}s] Research completed, no new activity for 30s - marking as finished`);
                finished = true;
                break;
            }
            
            // Log progress every minute
            if (elapsed % 60 === 0 && elapsed > 0) {
                console.log(`[${elapsed}s] Still monitoring... Research: ${researchCompleted ? 'YES' : 'NO'}`);
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        const finalLogs = tauriLogs.getRawSinceBaseline();
        
        console.log('');
        console.log('='.repeat(60));
        console.log('STOCK RESEARCH TEST RESULT');
        console.log('='.repeat(60));
        console.log(`Duration: ${totalTime}s`);
        console.log(`Task finished: ${finished}`);
        console.log(`Task failed: ${failed}`);
        console.log(`Research completed: ${researchCompleted}`);
        console.log('='.repeat(60));
        console.log('');

        // Assertions
        expect(finished || researchCompleted, 'Task should complete or provide research').toBe(true);
        expect(failed, 'Task should not fail').toBe(false);
        
        // Core check: Agent must NOT refuse the request
        const hasRefusal = finalLogs.includes('无法') && finalLogs.includes('不能') && 
                          (finalLogs.includes('拒绝') || finalLogs.includes('不支持'));
        expect(hasRefusal, 'Should NOT refuse user request').toBe(false);
        
        console.log('[Test] ✓ Test completed successfully');
    });
});
