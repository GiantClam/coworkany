import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TASK_QUERY = '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const SIDECAR_LOG_DIR = 'D:\\private\\coworkany\\sidecar\\.coworkany\\logs';
const MAX_WAIT_MS = 10 * 60 * 1000;

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
        return files[0].path;
    }
    
    reset(): void {
        const stats = fs.statSync(this.logFile);
        this.lastPosition = stats.size;
    }
    
    getNewContent(): string {
        try {
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
        } catch {
            return '';
        }
    }
    
    getAllLogs(): string {
        return this.allLogs;
    }
}

test.describe('Stock Research - Direct Sidecar Command', () => {
    test.setTimeout(MAX_WAIT_MS + 180000);
    
    test('should analyze stocks via direct sidecar stdin', async () => {
        console.log('[Test] Starting stock research test...\n');
        
        // 1. 清理进程
        console.log('[Test] Cleaning up...');
        try {
            await execAsync('taskkill /F /IM coworkany-desktop.exe');
            await new Promise(r => setTimeout(r, 3000));
        } catch {}
        
        // 2. 启动sidecar进程（不通过Tauri）
        console.log('[Test] Starting sidecar process directly...');
        const sidecarProcess = spawn('node', ['dist/index.js'], {
            cwd: 'D:\\private\\coworkany\\sidecar',
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let sidecarOutput = '';
        sidecarProcess.stdout?.on('data', (data) => {
            sidecarOutput += data.toString();
            process.stdout.write(`[Sidecar] ${data}`);
        });
        
        sidecarProcess.stderr?.on('data', (data) => {
            sidecarOutput += data.toString();
            process.stderr.write(`[Sidecar-err] ${data}`);
        });
        
        // 3. 等待sidecar启动
        console.log('[Test] Waiting for sidecar to start (30s)...');
        await new Promise(r => setTimeout(r, 30000));
        
        // 4. 初始化日志监控
        const logMonitor = new LogMonitor();
        logMonitor.reset();
        
        // 5. 通过stdin发送任务
        console.log(`[Test] Sending task via stdin...`);
        const taskCommand = JSON.stringify({
            id: `stock-test-${Date.now()}`,
            type: 'create_task',
            payload: {
                workspacePath: 'D:\\private\\coworkany\\sidecar\\workspaces\\new_workspace_1769516546813',
                content: TASK_QUERY,
                config: {
                    toolpacks: ['builtin-websearch']
                }
            },
            timestamp: new Date().toISOString()
        });
        
        console.log(`[Test] Command: ${taskCommand}`);
        sidecarProcess.stdin?.write(taskCommand + '\n');
        sidecarProcess.stdin?.end();
        
        console.log('[Test] Task sent, monitoring logs...\n');
        
        // 6. 监控日志
        const startTime = Date.now();
        let foundWebSearch = false;
        let foundAINews = false;
        let foundStockInfo = false;
        let foundInvestmentAdvice = false;
        let foundRefusal = false;
        
        while (Date.now() - startTime < MAX_WAIT_MS) {
            await new Promise(r => setTimeout(r, 5000));
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            const newLogs = logMonitor.getNewContent();
            
            if (newLogs) {
                console.log(`\n[${elapsed}s] === New Logs ===`);
                console.log(newLogs.substring(0, 2000));
                console.log('================\n');
                
                const lowerLogs = newLogs.toLowerCase();
                
                if (newLogs.includes('search_web')) {
                    if (!foundWebSearch) {
                        foundWebSearch = true;
                        console.log(`[${elapsed}s] ✓ Web search used`);
                    }
                }
                
                if (['ai', 'openai', 'news'].some(kw => lowerLogs.includes(kw))) {
                    if (!foundAINews) {
                        foundAINews = true;
                        console.log(`[${elapsed}s] ✓ AI news found`);
                    }
                }
                
                if (['cloudflare', 'reddit', 'nvidia'].some(s => lowerLogs.includes(s))) {
                    if (!foundStockInfo) {
                        foundStockInfo = true;
                        console.log(`[${elapsed}s] ✓ Stock info found`);
                    }
                }
                
                if (['buy', 'sell', 'hold', '建议'].some(kw => lowerLogs.includes(kw))) {
                    if (!foundInvestmentAdvice) {
                        foundInvestmentAdvice = true;
                        console.log(`[${elapsed}s] ✓ Investment advice found`);
                    }
                }
                
                if (newLogs.includes('无法') && newLogs.includes('不能')) {
                    if (!foundRefusal) {
                        foundRefusal = true;
                        console.log(`[${elapsed}s] ✗ Agent refused!`);
                    }
                }
            }
            
            if (foundWebSearch && foundStockInfo && foundInvestmentAdvice) {
                console.log(`\n✓✓✓ SUCCESS after ${elapsed}s!`);
                break;
            }
        }
        
        // 报告结果
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('\n' + '='.repeat(60));
        console.log('STOCK RESEARCH TEST RESULTS');
        console.log('='.repeat(60));
        console.log(`Duration: ${totalTime}s`);
        console.log(`Web Search: ${foundWebSearch ? '✓' : '✗'}`);
        console.log(`AI News: ${foundAINews ? '✓' : '✗'}`);
        console.log(`Stock Info: ${foundStockInfo ? '✓' : '✗'}`);
        console.log(`Investment Advice: ${foundInvestmentAdvice ? '✓' : '✗'}`);
        console.log(`Refused: ${foundRefusal ? '✗ YES' : '✓ NO'}`);
        console.log('='.repeat(60));
        
        // 保存日志
        fs.mkdirSync('test-results', { recursive: true });
        fs.writeFileSync('test-results/stock-logs.txt', logMonitor.getAllLogs());
        
        // 断言
        expect(foundRefusal).toBe(false);
        expect(foundWebSearch).toBe(true);
        expect(foundStockInfo).toBe(true);
        expect(foundInvestmentAdvice).toBe(true);
        
        // 清理
        sidecarProcess.kill();
        console.log('[Test] ✓ Test completed');
    });
});
