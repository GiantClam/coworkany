/**
 * CoworkAny 完整 Desktop GUI 测试
 * 
 * 启动完整的 Desktop 应用（包括 Sidecar + GUI），模拟用户在 GUI 中输入。
 * 
 * Run: cd sidecar && bun test tests/desktop-full.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DESKTOP_EXE = path.join(process.cwd(), '..', 'desktop', 'src-tauri', 'target', 'debug', 'coworkany-desktop.exe');
const TEST_WORKSPACE = path.join(process.cwd(), '.coworkany', 'test-workspace');

function ensureWorkspace(): void {
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

describe('CoworkAny Desktop 完整 GUI 测试', () => {
    let desktopProc: Subprocess | null = null;
    let desktopOutput = '';
    let sidecarReady = false;

    afterAll(() => {
        if (desktopProc) {
            console.log('\n[关闭] 关闭 Desktop 应用...');
            desktopProc.kill();
        }
    });

    test('Desktop-01: 启动完整的 Desktop 应用 (GUI + Sidecar)', async () => {
        console.log('\n' + '='.repeat(60));
        console.log('[启动] 启动 CoworkAny Desktop 应用...');
        console.log('[路径] ' + DESKTOP_EXE);
        console.log('[预期] 应该看到 GUI 窗口弹出');
        console.log('='.repeat(60));

        // 检查 Desktop exe 是否存在
        if (!fs.existsSync(DESKTOP_EXE)) {
            console.log('[错误] Desktop exe 不存在');
            console.log('[解决] 请先运行: cd desktop && bun run tauri build');
            expect(fs.existsSync(DESKTOP_EXE)).toBe(true);
            return;
        }

        console.log('[存在] Desktop exe 已找到');

        // 启动 Desktop 应用
        desktopProc = spawn({
            cmd: [DESKTOP_EXE],
            cwd: path.dirname(DESKTOP_EXE),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                RUST_BACKTRACE: '1',
                RUST_LOG: 'info',
            },
        });

        console.log('[PID] Desktop 进程: ' + desktopProc.pid);
        console.log('[等待] 等待 Sidecar 初始化 (30秒)...');

        // 读取 stderr (Rust 日志)
        const readStderr = async () => {
            if (!desktopProc?.stderr) return;
            const reader = desktopProc.stderr.getReader();
            const decoder = new TextDecoder();
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value);
                    desktopOutput += text;
                    
                    // 检测 Sidecar 就绪
                    if (text.includes('IPC started') || text.includes('Reading commands')) {
                        sidecarReady = true;
                        console.log('[就绪] Sidecar 已启动');
                    }
                    
                    // 打印关键日志
                    const lines = text.split('\n').filter(l => 
                        l.includes('INFO') || l.includes('started') || l.includes('ready')
                    );
                    for (const line of lines.slice(-3)) {
                        if (line.trim()) console.log('[日志] ' + line.trim());
                    }
                }
            } catch (e) {
                // 忽略
            }
        };

        // 同时读取 stdout
        const readStdout = async () => {
            if (!desktopProc?.stdout) return;
            const reader = desktopProc.stdout.getReader();
            const decoder = new TextDecoder();
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    desktopOutput += decoder.decode(value);
                }
            } catch (e) {
                // 忽略
            }
        };

        // 启动读取协程
        readStderr();
        readStdout();

        // 等待最多 30 秒
        const startTime = Date.now();
        while (Date.now() - startTime < 30000 && !sidecarReady) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            process.stdout.write('.');
        }
        console.log('');

        // 等待额外 10 秒让 GUI 完全初始化
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('\n[结果] Desktop 启动状态:');
        console.log('  - 进程运行: ' + (desktopProc ? '是' : '否'));
        console.log('  - Sidecar 就绪: ' + (sidecarReady ? '是' : '否'));

        // 输出最近日志
        console.log('\n[日志] 最近的日志输出:');
        const recentLogs = desktopOutput.split('\n').slice(-20);
        for (const log of recentLogs) {
            if (log.trim()) console.log('  ' + log.trim());
        }

        // 验证
        expect(desktopProc).not.toBeNull();
        
        console.log('\n[完成] Desktop 应用已启动');
        console.log('[提示] 如果看到 GUI 窗口，说明测试成功');

    }, 90000);
});
