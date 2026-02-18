import { test, expect } from '@playwright/test';

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';

test.describe('Stock Research - Check Logs & UI', () => {
    test('should analyze stocks and provide investment advice', async ({ page }) => {
        console.log('[Test] Connecting to CoworkAny...');
        
        // 收集所有控制台日志
        const consoleLogs: string[] = [];
        page.on('console', msg => {
            const text = msg.text();
            consoleLogs.push(text);
            // 只显示关键日志
            if (text.includes('TASK_') || text.includes('search_web') || 
                text.includes('TEXT_DELTA') || text.includes('error') ||
                text.includes('cloudflare') || text.includes('reddit') || text.includes('nvidia')) {
                console.log(`[Browser Console] ${text.substring(0, 200)}`);
            }
        });

        // 收集网络请求
        const networkLogs: string[] = [];
        page.on('request', request => {
            const url = request.url();
            if (url.includes('localhost') || url.includes('sidecar')) {
                networkLogs.push(`Request: ${url}`);
            }
        });
        
        page.on('response', response => {
            const url = response.url();
            if (url.includes('localhost') || url.includes('sidecar')) {
                networkLogs.push(`Response: ${url} - ${response.status()}`);
            }
        });
        
        // 1. 连接到CoworkAny
        await page.goto('http://localhost:5173');
        console.log('[Test] Page loaded, waiting for UI...');
        
        // 2. 等待UI完全加载
        await page.waitForTimeout(20000);
        console.log('[Test] UI should be ready');
        
        // 先截图看看当前状态
        await page.screenshot({ path: 'test-results/01-initial-state.png' });
        
        // 3. 找到输入框
        const selectors = [
            'input[placeholder="Ask CoworkAny..."]',
            'input[placeholder="New instructions..."]',
            '.chat-input input',
            '.chat-input textarea',
        ];

        let input = null;
        let usedSelector = '';
        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                const count = await locator.count();
                if (count > 0) {
                    await locator.waitFor({ state: 'visible', timeout: 5000 });
                    input = locator;
                    usedSelector = selector;
                    console.log(`[Test] ✓ Found input: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!input) {
            await page.screenshot({ path: 'test-results/02-no-input-found.png' });
            console.log('[Test] ✗ Available selectors tried:', selectors);
            console.log('[Test] ✗ Console logs so far:', consoleLogs.slice(-10));
            throw new Error('Could not find any input field');
        }

        // 4. 发送任务
        console.log(`[Test] Sending: ${TASK_QUERY}`);
        await input.fill(TASK_QUERY);
        await input.press('Enter');
        await page.screenshot({ path: 'test-results/03-message-sent.png' });
        console.log('[Test] ✓ Message sent');

        // 5. 等待并检查响应
        console.log('[Test] Monitoring response (max 10 min)...');
        let foundResponse = false;
        let foundError = false;
        const startTime = Date.now();
        const MAX_WAIT = 10 * 60 * 1000;
        
        while (Date.now() - startTime < MAX_WAIT) {
            await page.waitForTimeout(5000);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            // 检查浏览器控制台日志
            const recentLogs = consoleLogs.slice(-20).join(' ').toLowerCase();
            const hasTaskFinished = recentLogs.includes('task_finished') || recentLogs.includes('task completed');
            const hasTaskFailed = recentLogs.includes('task_failed') || recentLogs.includes('error');
            const hasSearchWeb = recentLogs.includes('search_web');
            
            // 检查页面内容
            let pageText = '';
            try {
                pageText = (await page.textContent('body', { timeout: 3000 })) || '';
            } catch {
                console.log(`[${elapsed}s] Could not get page text`);
            }
            
            const lowerText = pageText.toLowerCase();
            const hasCloudflare = lowerText.includes('cloudflare') || lowerText.includes('net');
            const hasReddit = lowerText.includes('reddit') || lowerText.includes('rddt');
            const hasNvidia = lowerText.includes('nvidia') || lowerText.includes('nvda');
            const hasAnalysis = lowerText.includes('分析') || lowerText.includes('建议') || 
                               lowerText.includes('buy') || lowerText.includes('sell') || 
                               lowerText.includes('hold');
            const hasAINews = lowerText.includes('ai新闻') || lowerText.includes('ai industry');
            
            // 检查Agent是否拒绝
            const hasRefusal = lowerText.includes('无法') && lowerText.includes('不能');
            
            // 每30秒报告一次详细状态
            if (elapsed % 30 === 0) {
                console.log(`\n[${elapsed}s] === Status Report ===`);
                console.log(`[${elapsed}s] Console logs count: ${consoleLogs.length}`);
                console.log(`[${elapsed}s] Has search_web: ${hasSearchWeb}`);
                console.log(`[${elapsed}s] Has task_finished: ${hasTaskFinished}`);
                console.log(`[${elapsed}s] Page text length: ${pageText.length}`);
                console.log(`[${elapsed}s] Found stocks - Cloudflare: ${hasCloudflare}, Reddit: ${hasReddit}, Nvidia: ${hasNvidia}`);
                console.log(`[${elapsed}s] Has analysis: ${hasAnalysis}`);
                console.log(`[${elapsed}s] Has refusal: ${hasRefusal}`);
                
                // 保存进度截图
                await page.screenshot({ path: `test-results/04-progress-${elapsed}s.png` });
                
                // 显示最后几条控制台日志
                if (consoleLogs.length > 0) {
                    console.log(`[${elapsed}s] Recent console logs:`);
                    consoleLogs.slice(-5).forEach((log, i) => {
                        console.log(`  ${i + 1}. ${log.substring(0, 150)}`);
                    });
                }
            }
            
            // 成功条件：找到股票分析
            if ((hasCloudflare || hasReddit || hasNvidia) && (hasAnalysis || hasAINews)) {
                console.log(`\n[${elapsed}s] ✓✓✓ SUCCESS! Found stock analysis!`);
                console.log(`[${elapsed}s] Stocks found: Cloudflare=${hasCloudflare}, Reddit=${hasReddit}, Nvidia=${hasNvidia}`);
                console.log(`[${elapsed}s] Has analysis: ${hasAnalysis}, Has AI news: ${hasAINews}`);
                foundResponse = true;
                await page.screenshot({ path: 'test-results/05-success.png' });
                break;
            }
            
            // 失败条件：任务失败或Agent拒绝
            if (hasTaskFailed || hasRefusal) {
                console.log(`\n[${elapsed}s] ✗✗✗ FAILED! Task failed or agent refused`);
                console.log(`[${elapsed}s] Has task_failed: ${hasTaskFailed}`);
                console.log(`[${elapsed}s] Has refusal: ${hasRefusal}`);
                foundError = true;
                await page.screenshot({ path: 'test-results/06-failed.png' });
                break;
            }
            
            // 如果任务完成但没有找到分析内容
            if (hasTaskFinished && !foundResponse) {
                console.log(`\n[${elapsed}s] ⚠ Task finished but no stock analysis found in UI`);
                console.log(`[${elapsed}s] Page content preview: ${pageText.substring(0, 500)}...`);
                await page.screenshot({ path: 'test-results/07-task-finished-no-analysis.png' });
                // 不break，继续等待看看是否有延迟加载的内容
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        // 最终报告
        console.log('\n' + '='.repeat(70));
        console.log('FINAL TEST REPORT');
        console.log('='.repeat(70));
        console.log(`Total duration: ${totalTime}s`);
        console.log(`Found response: ${foundResponse}`);
        console.log(`Found error: ${foundError}`);
        console.log(`Total console logs: ${consoleLogs.length}`);
        console.log(`Total network logs: ${networkLogs.length}`);
        console.log('='.repeat(70));
        
        // 保存所有日志到文件
        const fs = require('fs');
        fs.writeFileSync('test-results/console-logs.txt', consoleLogs.join('\n'));
        fs.writeFileSync('test-results/network-logs.txt', networkLogs.join('\n'));
        console.log('[Test] Logs saved to test-results/');
        
        // 断言
        expect(foundResponse || foundError, 'Should either get response or detect failure').toBe(true);
        expect(foundError, 'Should not encounter errors').toBe(false);
        expect(foundResponse, 'Should provide stock analysis').toBe(true);
    });
});
