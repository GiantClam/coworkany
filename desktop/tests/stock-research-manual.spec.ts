import { test, expect } from '@playwright/test';

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';

test.describe('Stock Research - Manual CoworkAny', () => {
    test('should analyze stocks and provide investment advice', async ({ page }) => {
        console.log('[Test] Connecting to CoworkAny at http://localhost:5173...');
        
        // 1. 连接到已运行的CoworkAny
        await page.goto('http://localhost:5173');
        console.log('[Test] Page loaded');
        
        // 2. 等待UI完全加载
        await page.waitForTimeout(15000);
        console.log('[Test] Waited for React hydration');
        
        // 3. 找到输入框（尝试多个选择器）
        const selectors = [
            '.chat-input',
            'input[placeholder="New instructions..."]',
            '.chat-input input',
            '.chat-input textarea',
            'input[type="text"]',
        ];

        let input = null;
        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                const count = await locator.count();
                if (count > 0) {
                    await locator.waitFor({ state: 'visible', timeout: 5000 });
                    input = locator;
                    console.log(`[Test] Found input with: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!input) {
            // 截图保存以便调试
            await page.screenshot({ path: 'test-results/debug-no-input.png' });
            throw new Error('Could not find any input field');
        }

        console.log('[Test] Input ready, sending message...');

        // 4. 发送任�?        await input.fill(TASK_QUERY);
        await input.press('Enter');
        console.log(`[Test] Sent: ${TASK_QUERY}`);

        // 5. 等待Agent响应（最�?0分钟�?        console.log('[Test] Waiting for agent response (max 10 min)...');
        let foundResponse = false;
        const startTime = Date.now();
        const MAX_WAIT = 10 * 60 * 1000; // 10分钟
        
        while (Date.now() - startTime < MAX_WAIT) {
            await page.waitForTimeout(10000); // �?0秒检查一�?            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            try {
                // 获取页面文本
                const pageText = await page.textContent('body', { timeout: 5000 });
                
                if (!pageText) continue;
                
                const lowerText = pageText.toLowerCase();
                
                // 检查股票相关信�?                const hasCloudflare = lowerText.includes('cloudflare') || lowerText.includes('net');
                const hasReddit = lowerText.includes('reddit') || lowerText.includes('rddt');
                const hasNvidia = lowerText.includes('nvidia') || lowerText.includes('nvda');
                const hasAnalysis = lowerText.includes('分析') || lowerText.includes('建议') || 
                                   lowerText.includes('buy') || lowerText.includes('sell') || 
                                   lowerText.includes('hold') || lowerText.includes('投资');
                
                // 检查是否包含AI新闻
                const hasAINews = lowerText.includes('ai') || lowerText.includes('artificial intelligence') ||
                                 lowerText.includes('openai') || lowerText.includes('news');
                
                if ((hasCloudflare || hasReddit || hasNvidia) && hasAnalysis) {
                    console.log(`[${elapsed}s] �?Found stock analysis!`);
                    console.log(`[${elapsed}s]   Cloudflare: ${hasCloudflare}`);
                    console.log(`[${elapsed}s]   Reddit: ${hasReddit}`);
                    console.log(`[${elapsed}s]   Nvidia: ${hasNvidia}`);
                    console.log(`[${elapsed}s]   AI News: ${hasAINews}`);
                    foundResponse = true;
                    
                    // 保存成功截图
                    await page.screenshot({ path: 'test-results/stock-analysis-success.png' });
                    break;
                }
                
                // 检查Agent是否拒绝
                if (lowerText.includes('无法') && lowerText.includes('不能')) {
                    console.log(`[${elapsed}s] �?Agent refused the request`);
                    await page.screenshot({ path: 'test-results/stock-analysis-refused.png' });
                    break;
                }
                
                // �?0秒报告进�?                if (elapsed % 30 === 0) {
                    console.log(`[${elapsed}s] Still waiting... Checking page content`);
                }
                
            } catch (error) {
                console.log(`[${elapsed}s] Error: ${error.message}`);
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('');
        console.log('='.repeat(60));
        console.log('STOCK RESEARCH TEST RESULT');
        console.log('='.repeat(60));
        console.log(`Duration: ${totalTime}s`);
        console.log(`Found response: ${foundResponse}`);
        console.log('='.repeat(60));
        console.log('');

        // 最终断言
        expect(foundResponse, 'Agent should provide stock analysis').toBe(true);
    });
});

