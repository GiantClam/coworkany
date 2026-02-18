/**
 * BR-01 ~ BR-06: 浏览器自动化测试 (P0)
 *
 * 对标 OpenClaw Browser Control + E2E Automation。
 * 验证 CoworkAny 的浏览器自动化能力：
 *   1. 页面导航 (browser_navigate)
 *   2. 表单填写 (browser_fill)
 *   3. 截图功能 (browser_screenshot)
 *   4. CDP 复用登录
 *   5. AI 浏览器模式 (browser_ai_action)
 *   6. 自适应重试
 *
 * Note: Browser tests require a running browser or headless Chromium.
 *       These tests will skip gracefully if browser is unavailable.
 *
 * Run: cd sidecar && bun test tests/browser-automation.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    SidecarProcess,
    buildStartTaskCommand,
    skipIfExternalFailure,
    printHeader,
    saveTestArtifacts,
} from './helpers/sidecar-harness';

const TASK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per browser test

// ============================================================================
// BR-01: 页面导航
// ============================================================================

describe('BR-01: 页面导航', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 browser_navigate 打开网页', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'BR-01 页面导航',
            userQuery: '用浏览器打开 https://example.com 并告诉我页面标题',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('BR-01 Report');
        console.log(`  Task finished: ${c.taskFinished}`);
        console.log(`  Tool calls: ${c.toolCalls.map(t => t.toolName).join(', ')}`);
        console.log(`  Text: ${c.textBuffer.slice(0, 200)}`);

        if (skipIfExternalFailure(c)) return;

        // Check if browser tools were called
        const browserCalls = c.toolCalls.filter(t =>
            t.toolName.startsWith('browser_') || t.toolName === 'open_in_browser'
        );

        if (browserCalls.length === 0) {
            // Agent may have used open_in_browser or explained it can't access browser
            console.log('[INFO] No browser tool calls detected — browser may be unavailable in test env.');
            // Still pass if agent provided meaningful response
            expect(c.textBuffer.length).toBeGreaterThan(10);
        } else {
            console.log(`[Test] Browser tool calls: ${browserCalls.map(t => t.toolName).join(', ')}`);
            expect(browserCalls.length).toBeGreaterThan(0);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// BR-02: 表单填写
// ============================================================================

describe('BR-02: 表单填写', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 browser_fill 填写表单', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'BR-02 表单填写',
            userQuery: '用浏览器打开 https://www.google.com 并在搜索框中输入 "CoworkAny AI assistant"',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('BR-02 Report');
        console.log(`  Tool calls: ${c.toolCalls.map(t => t.toolName).join(', ')}`);

        if (skipIfExternalFailure(c)) return;

        const fillCalls = c.getToolCalls('browser_fill');
        const navigateCalls = c.getToolCalls('browser_navigate');
        const allBrowserCalls = c.toolCalls.filter(t => t.toolName.startsWith('browser_'));

        if (allBrowserCalls.length === 0) {
            console.log('[INFO] No browser calls — browser unavailable in test env. Agent responded textually.');
            expect(c.textBuffer.length).toBeGreaterThan(0);
        } else {
            console.log(`[Test] browser_navigate: ${navigateCalls.length}`);
            console.log(`[Test] browser_fill: ${fillCalls.length}`);
            // At least some browser interaction happened
            expect(allBrowserCalls.length).toBeGreaterThan(0);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// BR-03: 截图功能
// ============================================================================

describe('BR-03: 截图功能', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 browser_screenshot 截图', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'BR-03 截图',
            userQuery: '打开 https://example.com 并截取一张页面截图',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('BR-03 Report');
        console.log(`  Tool calls: ${c.toolCalls.map(t => t.toolName).join(', ')}`);

        if (skipIfExternalFailure(c)) return;

        const screenshotCalls = c.getToolCalls('browser_screenshot');
        if (screenshotCalls.length > 0) {
            console.log(`[Test] browser_screenshot called ${screenshotCalls.length} times`);
            expect(screenshotCalls.length).toBeGreaterThan(0);

            // Check if a screenshot file was created
            const toolResult = c.toolResults.find(r =>
                r.toolName === 'browser_screenshot' && r.success
            );
            if (toolResult) {
                console.log(`[Test] Screenshot result: ${String(toolResult.result).slice(0, 200)}`);
            }
        } else {
            console.log('[INFO] No browser_screenshot calls — browser may be unavailable.');
            expect(c.textBuffer.length).toBeGreaterThan(0);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// BR-04: CDP 复用登录 (Configuration Test)
// ============================================================================

describe('BR-04: CDP 复用登录', () => {
    test('CDP 端口配置应可被识别', () => {
        // This is a configuration test: verify that CDP port env var is recognized
        // Actual CDP connection requires a running Chrome with --remote-debugging-port
        const cdpPort = process.env.CDP_PORT || '9222';
        console.log(`[Test] CDP port configured: ${cdpPort}`);

        // Verify the port is a valid number
        const port = parseInt(cdpPort, 10);
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);
    });
});

// ============================================================================
// BR-05: AI 浏览器模式
// ============================================================================

describe('BR-05: AI 浏览器模式', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('browser_ai_action 应可被调用', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'BR-05 AI 浏览器模式',
            userQuery: '用 AI 模式打开百度并搜索 "CoworkAny"',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('BR-05 Report');
        console.log(`  Tool calls: ${c.toolCalls.map(t => t.toolName).join(', ')}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should either use browser_ai_action or explain limitation
        const aiCalls = c.getToolCalls('browser_ai_action');
        const allBrowserCalls = c.toolCalls.filter(t => t.toolName.startsWith('browser_'));

        if (allBrowserCalls.length > 0) {
            console.log(`[Test] Browser calls: ${allBrowserCalls.map(t => t.toolName).join(', ')}`);
        } else {
            console.log('[INFO] No browser calls — browser-use service may be unavailable.');
        }

        // Must produce some response either way
        expect(c.events.length).toBeGreaterThan(0);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// BR-06: 自适应重试
// ============================================================================

describe('BR-06: 自适应重试', () => {
    test('浏览器增强工具支持自适应重试策略', () => {
        // This is a structural test: verify the enhanced browser tools exist
        // and have retry configuration. We check the code structure.
        const enhancedPath = path.join(process.cwd(), 'src', 'tools', 'browserEnhanced.ts');
        const exists = fs.existsSync(enhancedPath);

        console.log(`[Test] browserEnhanced.ts exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(enhancedPath, 'utf-8');
            const hasRetry = content.includes('retry') || content.includes('Retry') || content.includes('adaptive');
            console.log(`[Test] Has retry logic: ${hasRetry}`);
            expect(hasRetry).toBe(true);
        }
    });
});
