/**
 * E2E-01 ~ E2E-07: 端到端复合场景测试 (P0)
 *
 * 对标 OpenClaw 端到端任务执行 + 多工具编排能力。
 * 这些是最能体现 AI Agent 价值的综合测试：
 *   1. 股票研究（搜索+分析+写报告）
 *   2. 网页爬取+总结（crawl_url + extract_content）
 *   3. 代码生成+测试（write_to_file + run_command）
 *   4. 浏览器+文件（browser + screenshot）
 *   5. 多步规划执行（plan_step + 多工具）
 *   6. TTS 语音播报（search_web + voice_speak）
 *   7. GitHub 集成（create_issue）
 *
 * Run: cd sidecar && bun test tests/e2e-composite.test.ts
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

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per composite test

// ============================================================================
// E2E-01: 股票研究（搜索+分析+写报告）
// ============================================================================

describe('E2E-01: 股票研究', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应搜索、分析 NVDA 并生成投资报告', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-01 股票研究',
            userQuery: '分析 Nvidia (NVDA) 股票，搜索最新信息并写一份简短的投资分析报告',
            enabledSkills: ['stock-research'],
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-01 Report');
        console.log(`  Task finished: ${c.taskFinished}`);
        console.log(`  search_web: ${c.getToolCalls('search_web').length}`);
        console.log(`  write_to_file: ${c.getToolCalls('write_to_file').length}`);
        console.log(`  think: ${c.getToolCalls('think').length}`);
        console.log(`  Text length: ${c.textBuffer.length}`);

        if (skipIfExternalFailure(c)) return;

        // 1. Should call search_web
        expect(c.getToolCalls('search_web').length).toBeGreaterThan(0);

        // 2. Should produce analysis text
        expect(c.textBuffer.length).toBeGreaterThan(100);

        // 3. Should contain stock-related content
        const stockKeywords = ['nvidia', 'nvda', 'gpu', '股票', 'stock', '分析'];
        const matched = c.findKeywords(stockKeywords);
        console.log(`[Test] Stock keywords: ${matched.join(', ')}`);
        expect(matched.length).toBeGreaterThanOrEqual(2);

        // 4. Should contain investment advice
        const adviceKeywords = ['买入', '卖出', '持有', 'buy', 'sell', 'hold', '建议', '评级'];
        const adviceMatched = c.findKeywords(adviceKeywords);
        console.log(`[Test] Advice keywords: ${adviceMatched.join(', ')}`);
        expect(adviceMatched.length).toBeGreaterThanOrEqual(1);

        saveTestArtifacts('e2e-01', { 'output.txt': c.textBuffer });
    }, TASK_TIMEOUT_MS + 60_000);
});

// ============================================================================
// E2E-02: 网页爬取+总结
// ============================================================================

describe('E2E-02: 网页爬取+总结', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应爬取网页并生成中文总结', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-02 爬取+总结',
            userQuery: '爬取 https://news.ycombinator.com 首页并用中文总结 Top 3 新闻',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-02 Report');
        const crawlCalls = c.getToolCalls('crawl_url');
        const extractCalls = c.getToolCalls('extract_content');
        console.log(`  crawl_url: ${crawlCalls.length}`);
        console.log(`  extract_content: ${extractCalls.length}`);
        console.log(`  Text length: ${c.textBuffer.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should use crawl_url or search_web
        const webCalls = [...crawlCalls, ...extractCalls, ...c.getToolCalls('search_web')];
        expect(webCalls.length).toBeGreaterThan(0);

        // Should produce a summary
        expect(c.textBuffer.length).toBeGreaterThan(50);

        saveTestArtifacts('e2e-02', { 'output.txt': c.textBuffer });
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// E2E-03: 代码生成+测试
// ============================================================================

describe('E2E-03: 代码生成+测试', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应生成代码并运行验证', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-03 代码生成',
            userQuery: '写一个 Python 冒泡排序函数，保存到 /tmp/bubble_sort.py，然后运行它验证结果',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-03 Report');
        const writeCalls = c.getToolCalls('write_to_file');
        const runCalls = c.getToolCalls('run_command');
        console.log(`  write_to_file: ${writeCalls.length}`);
        console.log(`  run_command: ${runCalls.length}`);
        console.log(`  Text length: ${c.textBuffer.length}`);

        if (skipIfExternalFailure(c)) return;

        // 1. Should write a file
        expect(writeCalls.length).toBeGreaterThan(0);

        // 2. Should run a command
        expect(runCalls.length).toBeGreaterThan(0);

        // 3. Text should contain code-related content
        const codeKeywords = ['def ', 'bubble', 'sort', 'python', '排序'];
        const matched = c.findKeywords(codeKeywords);
        console.log(`[Test] Code keywords: ${matched.join(', ')}`);
        expect(matched.length).toBeGreaterThanOrEqual(1);

        saveTestArtifacts('e2e-03', { 'output.txt': c.textBuffer });
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// E2E-04: 浏览器+文件（截图保存）
// ============================================================================

describe('E2E-04: 浏览器+文件', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应打开浏览器并保存截图', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-04 浏览器+文件',
            userQuery: '打开 https://example.com 截图并保存到文件',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-04 Report');
        const browserCalls = c.toolCalls.filter(t => t.toolName.startsWith('browser_'));
        console.log(`  Browser calls: ${browserCalls.map(t => t.toolName).join(', ')}`);
        console.log(`  Text length: ${c.textBuffer.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should produce some response
        expect(c.events.length).toBeGreaterThan(0);

        if (browserCalls.length > 0) {
            // If browser is available, verify tool usage
            console.log(`[Test] ${browserCalls.length} browser tool calls made`);
        } else {
            // Browser may be unavailable; agent should still respond
            console.log('[INFO] Browser unavailable in test env, checking text response.');
            expect(c.textBuffer.length).toBeGreaterThan(0);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// E2E-05: 多步规划执行
// ============================================================================

describe('E2E-05: 多步规划执行', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 plan_step 规划并执行多步任务', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-05 多步规划',
            userQuery: '研究 React 19 的新特性，搜索资料后写一篇简短的技术总结保存到文件',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-05 Report');
        const planCalls = c.getToolCalls('plan_step');
        const thinkCalls = c.getToolCalls('think');
        const searchCalls = c.getToolCalls('search_web');
        const writeCalls = c.getToolCalls('write_to_file');
        console.log(`  plan_step: ${planCalls.length}`);
        console.log(`  think: ${thinkCalls.length}`);
        console.log(`  search_web: ${searchCalls.length}`);
        console.log(`  write_to_file: ${writeCalls.length}`);
        console.log(`  Total tool calls: ${c.toolCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // 1. Should use search
        expect(searchCalls.length).toBeGreaterThan(0);

        // 2. Should use multiple tools (multi-step)
        expect(c.toolCalls.length).toBeGreaterThanOrEqual(2);

        // 3. Should produce meaningful content about React
        const reactKeywords = ['react', '19', 'hook', 'component', 'server', '特性', '新功能'];
        const matched = c.findKeywords(reactKeywords);
        console.log(`[Test] React keywords: ${matched.join(', ')}`);
        expect(matched.length).toBeGreaterThanOrEqual(1);

        saveTestArtifacts('e2e-05', { 'output.txt': c.textBuffer });
    }, TASK_TIMEOUT_MS + 60_000);
});

// ============================================================================
// E2E-06: TTS 语音播报
// ============================================================================

describe('E2E-06: TTS 语音播报', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应调用 voice_speak 播报内容', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-06 TTS 播报',
            userQuery: '搜索今天的一条 AI 新闻，然后用语音读给我听',
            enabledSkills: ['voice-tts'],
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-06 Report');
        const searchCalls = c.getToolCalls('search_web');
        const voiceCalls = c.getToolCalls('voice_speak');
        console.log(`  search_web: ${searchCalls.length}`);
        console.log(`  voice_speak: ${voiceCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // 1. Should call voice_speak (the core assertion)
        expect(voiceCalls.length).toBeGreaterThan(0);

        // 2. voice_speak should have text parameter
        if (voiceCalls.length > 0) {
            const text = voiceCalls[0].toolArgs?.text || '';
            console.log(`[Test] TTS text preview: ${String(text).slice(0, 200)}`);
            expect(String(text).length).toBeGreaterThan(10);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// E2E-07: GitHub 集成
// ============================================================================

describe('E2E-07: GitHub 集成', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应尝试使用 GitHub 工具', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-07 GitHub',
            // Use a safe query that doesn't actually create an issue
            userQuery: '列出 GitHub 上 CoworkAny 的仓库信息（不要创建任何 issue）',
            enabledToolpacks: ['builtin-github'],
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('E2E-07 Report');
        const githubCalls = c.toolCalls.filter(t =>
            ['create_issue', 'create_pr', 'list_repos'].includes(t.toolName)
        );
        console.log(`  GitHub tool calls: ${githubCalls.map(t => t.toolName).join(', ') || 'none'}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should respond (even if GitHub token is not configured)
        expect(c.events.length).toBeGreaterThan(0);

        if (githubCalls.length > 0) {
            console.log(`[Test] GitHub tools called: ${githubCalls.length}`);
        } else {
            // No GitHub token configured — agent should explain
            console.log('[INFO] No GitHub tool calls — token likely not configured.');
            expect(c.textBuffer.length).toBeGreaterThan(0);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});
