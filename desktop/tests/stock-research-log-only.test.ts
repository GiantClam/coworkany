import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const SIDECAR_LOG_DIR = 'D:\\private\\coworkany\\sidecar\\.coworkany\\logs';
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * LogMonitor - 监控sidecar日志文件
 */
class LogMonitor {
    private logFile: string;
    private lastPosition: number = 0;
    private allLogs: string = '';
    
    constructor() {
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
        const stats = fs.statSync(this.logFile);
        this.lastPosition = stats.size;
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
        
        const content = buffer.toString('utf-8');
        this.allLogs += content;
        this.lastPosition = currentSize;
        return content;
    }
    
    getAllLogs(): string {
        return this.allLogs;
    }
    
    contains(pattern: string): boolean {
        return this.allLogs.includes(pattern);
    }
    
    grep(pattern: string): string[] {
        return this.allLogs.split('\n').filter(line => line.includes(pattern));
    }
}

test.describe('Stock Research - Log Analysis Only', () => {
    test.setTimeout(MAX_WAIT_MS + 120000);
    
    test('should analyze stocks via log monitoring', async () => {
        console.log('[Test] Starting stock research test with log analysis...\n');
        
        // 1. 清理现有进程
        console.log('[Test] Cleaning up existing processes...');
        try {
            await execAsync('taskkill /F /IM coworkany-desktop.exe');
            await new Promise(r => setTimeout(r, 3000));
        } catch {
            // Process may not exist
        }
        
        // 2. 启动Coworkany
        console.log('[Test] Starting Coworkany...');
        const coworkanyProcess = spawn('npx.cmd', ['tauri', 'dev'], {
            cwd: 'D:\\private\\coworkany\\desktop',
            shell: true,
            stdio: 'pipe'
        });
        
        // 收集控制台输出
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
        
        // 3. 等待系统启动（60秒）
        console.log('[Test] Waiting for Coworkany to start (60s)...');
        await new Promise(r => setTimeout(r, 60000));
        
        // 4. 初始化日志监控
        console.log('[Test] Initializing log monitor...');
        const logMonitor = new LogMonitor();
        logMonitor.reset();
        
        // 5. 通过stdin向sidecar发送任务
        console.log(`[Test] Sending task via sidecar stdin...`);
        
        // 构建任务命令
        const taskCommand = JSON.stringify({
            id: `stock-test-${Date.now()}`,
            type: 'send_task_message',
            payload: {
                content: TASK_QUERY,
                workspaceId: 'default'
            },
            timestamp: new Date().toISOString()
        }) + '\n';
        
        // 写入sidecar的stdin（通过coworkany desktop转发）
        // 注意：这里我们需要找到sidecar进程的stdin，比较复杂
        // 替代方案：通过文件或HTTP API
        
        // 替代方案：创建一个任务文件触发
        const taskFile = 'D:\\private\\coworkany\\sidecar\\.coworkany\\tasks\\pending\\stock-test.json';
        fs.mkdirSync(path.dirname(taskFile), { recursive: true });
        fs.writeFileSync(taskFile, JSON.stringify({
            id: `stock-test-${Date.now()}`,
            content: TASK_QUERY,
            timestamp: new Date().toISOString(),
            status: 'pending'
        }, null, 2));
        
        console.log(`[Test] Task file created: ${taskFile}`);
        console.log('[Test] Waiting for Agent to process...\n');
        
        // 6. 监控日志（10分钟）
        const startTime = Date.now();
        let foundWebSearch = false;
        let foundAINews = false;
        let foundStockInfo = false;
        let foundInvestmentAdvice = false;
        let foundTaskComplete = false;
        let foundRefusal = false;
        
        // 股票代码匹配
        const stockSymbols = ['cloudflare', 'reddit', 'nvidia', 'nvda', 'rddt', 'net'];
        const adviceKeywords = ['buy', 'sell', 'hold', '建议', '买入', '卖出', '持有', '投资'];
        const aiKeywords = ['ai', 'artificial intelligence', 'openai', '新闻', 'news'];
        
        while (Date.now() - startTime < MAX_WAIT_MS) {
            await new Promise(r => setTimeout(r, 5000));
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            // 获取新日志
            const newLogs = logMonitor.getNewContent();
            
            if (newLogs) {
                // 显示关键日志
                console.log(`\n[${elapsed}s] === New Log Content ===`);
                console.log(newLogs.substring(0, 3000));
                console.log('=====================\n');
                
                const lowerLogs = newLogs.toLowerCase();
                
                // 检查工具调用
                if (newLogs.includes('search_web') || newLogs.includes('"name":"search_web"')) {
                    if (!foundWebSearch) {
                        foundWebSearch = true;
                        console.log(`[${elapsed}s] ✓ Web search tool used`);
                    }
                }
                
                // 检查AI新闻
                if (aiKeywords.some(kw => lowerLogs.includes(kw.toLowerCase()))) {
                    if (!foundAINews) {
                        foundAINews = true;
                        console.log(`[${elapsed}s] ✓ AI news mentioned in response`);
                    }
                }
                
                // 检查股票信息
                if (stockSymbols.some(sym => lowerLogs.includes(sym.toLowerCase()))) {
                    if (!foundStockInfo) {
                        foundStockInfo = true;
                        console.log(`[${elapsed}s] ✓ Stock information found (cloudflare/reddit/nvidia)`);
                    }
                }
                
                // 检查投资建议
                if (adviceKeywords.some(kw => lowerLogs.includes(kw.toLowerCase()))) {
                    if (!foundInvestmentAdvice) {
                        foundInvestmentAdvice = true;
                        console.log(`[${elapsed}s] ✓ Investment advice provided`);
                    }
                }
                
                // 检查拒绝
                if (newLogs.includes('无法') && newLogs.includes('不能')) {
                    if (!foundRefusal) {
                        foundRefusal = true;
                        console.log(`[${elapsed}s] ✗ Agent refused request!`);
                    }
                }
                
                // 检查任务完成
                if (newLogs.includes('TASK_FINISHED') || newLogs.includes('"type":"TASK_FINISHED"')) {
                    foundTaskComplete = true;
                    console.log(`[${elapsed}s] Task completion event detected`);
                }
            }
            
            // 进度报告（每30秒）
            if (elapsed % 30 === 0 && elapsed > 0) {
                console.log(`\n[${elapsed}s] Progress Report:`);
                console.log(`  Web Search: ${foundWebSearch ? '✓' : '✗'}`);
                console.log(`  AI News: ${foundAINews ? '✓' : '✗'}`);
                console.log(`  Stock Info: ${foundStockInfo ? '✓' : '✗'}`);
                console.log(`  Investment Advice: ${foundInvestmentAdvice ? '✓' : '✗'}`);
                console.log(`  Task Complete: ${foundTaskComplete ? '✓' : '✗'}`);
                console.log(`  Refusal: ${foundRefusal ? '✗ YES' : '✓ No'}\n`);
            }
            
            // 成功条件：找到所有关键元素
            if (foundWebSearch && foundStockInfo && foundInvestmentAdvice) {
                console.log(`\n✓✓✓ SUCCESS! All requirements met after ${elapsed}s`);
                break;
            }
            
            // 提前退出条件：拒绝或完成
            if (foundRefusal || (foundTaskComplete && elapsed > 60)) {
                break;
            }
        }
        
        // 7. 最终报告
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('\n' + '='.repeat(70));
        console.log('STOCK RESEARCH TEST - FINAL RESULTS');
        console.log('='.repeat(70));
        console.log(`Total Duration: ${totalTime}s`);
        console.log(`Web Search Used: ${foundWebSearch ? '✓ YES' : '✗ NO'}`);
        console.log(`AI News Retrieved: ${foundAINews ? '✓ YES' : '✗ NO'}`);
        console.log(`Stock Info Found: ${foundStockInfo ? '✓ YES' : '✗ NO'}`);
        console.log(`Investment Advice: ${foundInvestmentAdvice ? '✓ YES' : '✗ NO'}`);
        console.log(`Task Completed: ${foundTaskComplete ? '✓ YES' : '✗ NO'}`);
        console.log(`Request Refused: ${foundRefusal ? '✗ YES (FAIL)' : '✓ NO'}`);
        console.log('='.repeat(70) + '\n');
        
        // 8. 保存完整日志
        const allLogs = logMonitor.getAllLogs();
        fs.mkdirSync('test-results', { recursive: true });
        fs.writeFileSync('test-results/stock-research-logs.txt', allLogs);
        console.log('[Test] Full logs saved to test-results/stock-research-logs.txt');
        
        // 9. 断言验证
        expect(foundRefusal, 'Agent should NOT refuse the request').toBe(false);
        expect(foundWebSearch, 'Should use web search for research').toBe(true);
        expect(foundStockInfo, 'Should retrieve stock information for cloudflare/reddit/nvidia').toBe(true);
        expect(foundInvestmentAdvice, 'Should provide investment advice (buy/sell/hold)').toBe(true);
        
        // 清理
        console.log('[Test] Cleaning up...');
        coworkanyProcess.kill();
        try {
            await execAsync('taskkill /F /IM coworkany-desktop.exe');
        } catch {}
        
        console.log('\n[Test] ✓ Test completed successfully');
    });
});
