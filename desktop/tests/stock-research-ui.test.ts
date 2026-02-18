/**
 * 基于UI的股票研究测试
 * 通过检查页面上的实际文本内容来验证Agent响应
 */

import { test, expect } from './tauriFixtureNoChrome';

const TASK_QUERY = '请分析Cloudflare、Reddit、Nvidia这三只股票的投资价值';
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10分钟

test.describe('Stock Research via UI', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 60_000);

    test('should provide stock analysis', async ({ page }) => {
        console.log('[Test] Starting stock research via UI...');
        
        // 1. 等待UI加载
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(15000);
        console.log('[Test] UI loaded');

        // 2. 找到输入框
        const input = page.locator('input[placeholder="New instructions..."]').first();
        await input.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[Test] Input found');

        // 3. 发送消息
        console.log(`[Test] Sending: ${TASK_QUERY}`);
        await input.fill(TASK_QUERY);
        await input.press('Enter');
        console.log('[Test] Message sent');

        // 4. 等待并检查响应（最多10分钟）
        console.log('[Test] Waiting for response (max 10min)...');
        let foundResponse = false;
        const startTime = Date.now();
        
        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(10000); // 每10秒检查一次
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            try {
                // 获取页面文本
                const pageText = await page.textContent('body', { timeout: 5000 });
                
                if (!pageText) {
                    console.log(`[${elapsed}s] No page text found`);
                    continue;
                }
                
                const lowerText = pageText.toLowerCase();
                
                // 检查是否包含股票相关信息
                const hasCloudflare = lowerText.includes('cloudflare') || lowerText.includes('net');
                const hasReddit = lowerText.includes('reddit') || lowerText.includes('rddt');
                const hasNvidia = lowerText.includes('nvidia') || lowerText.includes('nvda');
                const hasAnalysis = lowerText.includes('分析') || lowerText.includes('建议') || 
                                   lowerText.includes('buy') || lowerText.includes('sell') || 
                                   lowerText.includes('hold') || lowerText.includes('投资');
                
                if ((hasCloudflare || hasReddit || hasNvidia) && hasAnalysis) {
                    console.log(`[${elapsed}s] ✓ Found stock analysis!`);
                    console.log(`[${elapsed}s]   - Cloudflare: ${hasCloudflare}`);
                    console.log(`[${elapsed}s]   - Reddit: ${hasReddit}`);
                    console.log(`[${elapsed}s]   - Nvidia: ${hasNvidia}`);
                    foundResponse = true;
                    break;
                }
                
                // 检查Agent是否拒绝
                if (lowerText.includes('无法') && lowerText.includes('不能')) {
                    console.log(`[${elapsed}s] ✗ Agent refused the request`);
                    break;
                }
                
                // 每30秒报告一次进度
                if (elapsed % 30 === 0) {
                    const preview = pageText.substring(0, 200).replace(/\n/g, ' ');
                    console.log(`[${elapsed}s] Still waiting... Page preview: ${preview}...`);
                }
                
            } catch (error) {
                console.log(`[${elapsed}s] Error checking page: ${error.message}`);
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('');
        console.log('='.repeat(60));
        console.log('TEST RESULT');
        console.log('='.repeat(60));
        console.log(`Duration: ${totalTime}s`);
        console.log(`Found response: ${foundResponse}`);
        console.log('='.repeat(60));
        console.log('');

        expect(foundResponse, 'Should provide stock analysis').toBe(true);
    });
});
