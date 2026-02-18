/**
 * Stock Research Test - Log File Analysis Version
 * 
 * This test:
 * 1. Starts Coworkany manually
 * 2. Sends the stock analysis task via HTTP API or direct sidecar command
 * 3. Monitors sidecar log files for results
 * 4. Checks for AI news retrieval and stock analysis
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const SIDECAR_LOG_DIR = 'D:\\private\\coworkany\\sidecar\\.coworkany\\logs';
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

class LogMonitor {
    private logFile: string;
    private lastPosition: number = 0;
    
    constructor() {
        // Find the latest sidecar log file
        this.logFile = this.findLatestLogFile();
    }
    
    private findLatestLogFile(): string {
        const files = fs.readdirSync(SIDECAR_LOG_DIR)
            .filter(f => f.startsWith('sidecar-') && f.endsWith('.log'))
            .map(f => ({
                name: f,
                path: path.join(SIDECAR_LOG_DIR, f),
                mtime: fs.statSync(path.join(SIDECAR_LOG_DIR, f)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        
        if (files.length === 0) {
            throw new Error('No sidecar log files found');
        }
        
        console.log(`[Monitor] Using log file: ${files[0].name}`);
        return files[0].path;
    }
    
    reset(): void {
        this.lastPosition = fs.statSync(this.logFile).size;
        console.log(`[Monitor] Reset position to ${this.lastPosition}`);
    }
    
    getNewContent(): string {
        const stats = fs.statSync(this.logFile);
        const currentSize = stats.size;
        
        if (currentSize <= this.lastPosition) {
            return '';
        }
        
        const fd = fs.openSync(this.logFile, 'r');
        const buffer = Buffer.alloc(currentSize - this.lastPosition);
        fs.readSync(fd, buffer, 0, buffer.length, this.lastPosition);
        fs.closeSync(fd);
        
        this.lastPosition = currentSize;
        return buffer.toString('utf-8');
    }
    
    getAllContent(): string {
        return fs.readFileSync(this.logFile, 'utf-8');
    }
}

test.describe('Stock Research via Log Analysis', () => {
    test.setTimeout(MAX_WAIT_MS + 120000);
    
    test('should analyze stocks and provide investment advice', async () => {
        console.log('[Test] Starting stock research test with log monitoring...\n');
        
        // Initialize log monitor
        const logMonitor = new LogMonitor();
        
        // Clean up any existing Coworkany processes
        console.log('[Test] Cleaning up existing processes...');
        try {
            await execAsync('taskkill /F /IM coworkany-desktop.exe');
            await new Promise(r => setTimeout(r, 3000));
        } catch {
            // Process may not exist
        }
        
        // Start Coworkany with CDP enabled
        console.log('[Test] Starting Coworkany...');
        const isWindows = process.platform === 'win32';
        const coworkanyProcess = spawn(isWindows ? 'npx.cmd' : 'npx', ['tauri', 'dev'], {
            cwd: 'D:\\private\\coworkany\\desktop',
            shell: true,
            env: {
                ...process.env,
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9945'
            },
            stdio: 'pipe'
        });
        
        // Collect stdout/stderr
        let consoleOutput = '';
        coworkanyProcess.stdout?.on('data', (data) => {
            const text = data.toString();
            consoleOutput += text;
            process.stdout.write(`[Coworkany] ${text}`);
        });
        
        coworkanyProcess.stderr?.on('data', (data) => {
            const text = data.toString();
            consoleOutput += text;
            process.stderr.write(`[Coworkany-err] ${text}`);
        });
        
        // Wait for startup
        console.log('[Test] Waiting for Coworkany to start (60s)...');
        await new Promise(r => setTimeout(r, 60000));
        
        // Reset log monitor to current position
        logMonitor.reset();
        
        // Send task via HTTP to sidecar or use Playwright to interact with UI
        console.log(`[Test] Sending task: ${TASK_QUERY}\n`);
        
        // Use Playwright to interact with the web UI
        const browser = await (await import('@playwright/test')).chromium.launch();
        const page = await browser.newPage();
        
        try {
            // Connect to Coworkany WebView2 via CDP
            await page.goto('http://localhost:5173');
            console.log('[Test] Connected to Coworkany UI');
            
            // Wait for UI
            await page.waitForTimeout(15000);
            
            // Find and use input
            const input = page.locator('input[placeholder="New instructions..."]').first();
            await input.waitFor({ state: 'visible', timeout: 30000 });
            
            // Send message
            await input.fill(TASK_QUERY);
            await input.press('Enter');
            console.log('[Test] Task sent to Coworkany\n');
            
            // Monitor logs and UI for 10 minutes
            console.log('[Test] Monitoring for responses (10 minutes max)...\n');
            
            const startTime = Date.now();
            let foundAINews = false;
            let foundStockInfo = false;
            let foundInvestmentAdvice = false;
            let foundWebSearch = false;
            let foundRefusal = false;
            
            while (Date.now() - startTime < MAX_WAIT_MS) {
                await new Promise(r => setTimeout(r, 5000));
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                
                // Check log file for new content
                const newLogs = logMonitor.getNewContent();
                
                if (newLogs) {
                    console.log(`\n[${elapsed}s] === New Log Content ===`);
                    console.log(newLogs.substring(0, 2000));
                    console.log('=====================\n');
                    
                    // Check for key indicators
                    if (newLogs.includes('search_web') || newLogs.includes('websearch')) {
                        if (!foundWebSearch) {
                            foundWebSearch = true;
                            console.log(`[${elapsed}s] ✓ Web search tool used`);
                        }
                    }
                    
                    if (newLogs.toLowerCase().includes('ai') && 
                        (newLogs.includes('news') || newLogs.includes('新闻'))) {
                        if (!foundAINews) {
                            foundAINews = true;
                            console.log(`[${elapsed}s] ✓ AI news retrieved`);
                        }
                    }
                    
                    const lowerLogs = newLogs.toLowerCase();
                    if (lowerLogs.includes('cloudflare') || lowerLogs.includes('reddit') || 
                        lowerLogs.includes('nvidia') || lowerLogs.includes('nvda')) {
                        if (!foundStockInfo) {
                            foundStockInfo = true;
                            console.log(`[${elapsed}s] ✓ Stock information found`);
                        }
                    }
                    
                    if (lowerLogs.includes('buy') || lowerLogs.includes('sell') || 
                        lowerLogs.includes('hold') || newLogs.includes('建议') || 
                        newLogs.includes('投资')) {
                        if (!foundInvestmentAdvice) {
                            foundInvestmentAdvice = true;
                            console.log(`[${elapsed}s] ✓ Investment advice provided`);
                        }
                    }
                    
                    if (newLogs.includes('无法') && newLogs.includes('不能')) {
                        if (!foundRefusal) {
                            foundRefusal = true;
                            console.log(`[${elapsed}s] ✗ Agent refused request!`);
                        }
                    }
                    
                    // Check for task completion
                    if (newLogs.includes('TASK_FINISHED')) {
                        console.log(`[${elapsed}s] Task finished event detected`);
                    }
                }
                
                // Progress report every 60 seconds
                if (elapsed % 60 === 0 && elapsed > 0) {
                    console.log(`\n[${elapsed}s] Progress Report:`);
                    console.log(`  Web Search: ${foundWebSearch ? '✓' : '✗'}`);
                    console.log(`  AI News: ${foundAINews ? '✓' : '✗'}`);
                    console.log(`  Stock Info: ${foundStockInfo ? '✓' : '✗'}`);
                    console.log(`  Investment Advice: ${foundInvestmentAdvice ? '✓' : '✗'}`);
                    console.log(`  Refusal: ${foundRefusal ? '✗ YES' : '✓ No'}\n`);
                }
                
                // Success condition
                if ((foundAINews || foundWebSearch) && foundStockInfo && foundInvestmentAdvice) {
                    console.log(`\n✓✓✓ SUCCESS! All requirements met after ${elapsed}s`);
                    break;
                }
            }
            
            // Final results
            const totalTime = Math.round((Date.now() - startTime) / 1000);
            
            console.log('\n' + '='.repeat(70));
            console.log('STOCK RESEARCH TEST - FINAL RESULTS');
            console.log('='.repeat(70));
            console.log(`Total Duration: ${totalTime}s`);
            console.log(`Web Search Used: ${foundWebSearch ? '✓ YES' : '✗ NO'}`);
            console.log(`AI News Retrieved: ${foundAINews ? '✓ YES' : '✗ NO'}`);
            console.log(`Stock Info Found: ${foundStockInfo ? '✓ YES' : '✗ NO'}`);
            console.log(`Investment Advice: ${foundInvestmentAdvice ? '✓ YES' : '✗ NO'}`);
            console.log(`Request Refused: ${foundRefusal ? '✗ YES (FAIL)' : '✓ NO'}`);
            console.log('='.repeat(70) + '\n');
            
            // Assertions
            expect(foundRefusal, 'Agent should NOT refuse the request').toBe(false);
            expect(foundWebSearch || foundAINews, 'Should use web search or retrieve AI news').toBe(true);
            expect(foundStockInfo, 'Should retrieve stock information').toBe(true);
            expect(foundInvestmentAdvice, 'Should provide investment advice').toBe(true);
            
            // Save full logs for analysis
            const fullLogs = logMonitor.getAllContent();
            fs.writeFileSync('test-results/full-sidecar-logs.txt', fullLogs);
            console.log('[Test] Full logs saved to test-results/full-sidecar-logs.txt');
            
        } finally {
            await browser.close();
            
            // Cleanup
            console.log('[Test] Cleaning up...');
            coworkanyProcess.kill();
            try {
                await execAsync('taskkill /F /IM coworkany-desktop.exe');
            } catch {}
        }
    });
});
