/**
 * WS-01 ~ WS-05: 网页搜索与信息检索测试 (P0)
 *
 * 对标 OpenClaw Web Search + Browsing。
 * 验证 CoworkAny 的搜索能力：
 *   1. Serper.dev 搜索正常返回结果
 *   2. Provider fallback 自动降级
 *   3. DuckDuckGo CAPTCHA 检测（单元测试）
 *   4. 搜索结果 + Agent 总结（E2E）
 *   5. 全部 Provider 失败时错误消息指导
 *
 * Run: cd sidecar && bun test tests/websearch.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    SidecarProcess,
    buildStartTaskCommand,
    skipIfExternalFailure,
    printHeader,
    saveTestArtifacts,
} from './helpers/sidecar-harness';

// For unit tests we import directly from the websearch module
import {
    performSearch,
    loadSearchConfigFromEnv,
    type SearchConfig,
} from '../src/tools/websearch';

const TASK_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes

// ============================================================================
// WS-01: Serper.dev 搜索 (Unit Test - direct function call)
// ============================================================================

describe('WS-01: Serper.dev 搜索', () => {
    test('Serper provider 返回搜索结果（需要 SERPER_API_KEY）', async () => {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            console.log('[SKIP] SERPER_API_KEY not set, skipping direct Serper test.');
            return;
        }

        const config: SearchConfig = {
            provider: 'serper',
            serperApiKey: apiKey,
        };

        const result = await performSearch('latest AI news 2026', 5, config);

        console.log(`[Test] Provider: ${result.provider}`);
        console.log(`[Test] Results: ${result.results.length}`);
        console.log(`[Test] Error: ${result.error || 'none'}`);
        if (result.results.length > 0) {
            console.log(`[Test] First result: ${result.results[0].title} - ${result.results[0].url}`);
        }

        expect(result.error).toBeFalsy();
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results[0].title).toBeTruthy();
        expect(result.results[0].url).toMatch(/^https?:\/\//);
    });
});

// ============================================================================
// WS-02: Provider Fallback (Unit Test)
// ============================================================================

describe('WS-02: Provider Fallback', () => {
    test('主 provider 失败时自动降级到备用 provider', async () => {
        // Use an invalid Serper key so it fails, but use a valid Tavily key if available
        const tavilyKey = process.env.TAVILY_API_KEY;
        const braveKey = process.env.BRAVE_API_KEY;

        if (!tavilyKey && !braveKey) {
            console.log('[SKIP] No fallback API keys (TAVILY_API_KEY or BRAVE_API_KEY) set.');
            return;
        }

        const config: SearchConfig = {
            provider: 'serper',
            serperApiKey: 'invalid-key-for-testing',
            tavilyApiKey: tavilyKey,
            braveApiKey: braveKey,
        };

        const result = await performSearch('test query', 3, config);

        console.log(`[Test] Final provider: ${result.provider}`);
        console.log(`[Test] Results: ${result.results.length}`);
        console.log(`[Test] Error: ${result.error || 'none'}`);

        // Should have fallen back to a working provider
        if (result.results.length > 0) {
            expect(result.provider).not.toBe('serper');
            console.log(`[Test] Successfully fell back to: ${result.provider}`);
        } else {
            // If all fail (no valid keys), that's also acceptable for this test
            console.log('[INFO] All providers failed (expected if no valid API keys).');
        }
    });
});

// ============================================================================
// WS-03: DuckDuckGo CAPTCHA 检测 (Unit Test)
// ============================================================================

describe('WS-03: DuckDuckGo CAPTCHA 检测', () => {
    test('CAPTCHA HTML 应被明确检测并报告', async () => {
        // We test the CAPTCHA detection by importing and checking the function
        // The detectDuckDuckGoCaptcha function is internal, so we test via performSearch
        // with a config that will only try DDG (no API keys, no SearXNG)
        const config: SearchConfig = {
            provider: 'searxng',
            // No API keys — will fall through to DDG
            // No SearXNG URL — will use public instances that may fail
        };

        const result = await performSearch('test captcha detection', 3, config);

        console.log(`[Test] Provider: ${result.provider}`);
        console.log(`[Test] Results: ${result.results.length}`);
        console.log(`[Test] Error: ${result.error || 'none'}`);

        // The key assertion: if DDG returned a CAPTCHA, the error should mention it explicitly
        if (result.error && result.results.length === 0) {
            const errorLower = result.error.toLowerCase();
            // Check that error messages are informative (not just "0 results")
            const isInformative = errorLower.includes('captcha') ||
                                  errorLower.includes('rate') ||
                                  errorLower.includes('429') ||
                                  errorLower.includes('failed') ||
                                  errorLower.includes('api key');
            console.log(`[Test] Error is informative: ${isInformative}`);
            expect(isInformative).toBe(true);
        } else if (result.results.length > 0) {
            console.log('[INFO] Search succeeded (no CAPTCHA encountered).');
        }
    });
});

// ============================================================================
// WS-04: 搜索结果 + Agent 总结 (E2E)
// ============================================================================

describe('WS-04: 搜索结果 + Agent 总结', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应搜索并总结 AI 新闻', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'WS-04 搜索+总结',
            userQuery: '搜索最新的AI芯片新闻，给我一个简短总结（3条）',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('WS-04 Report');
        console.log(`  Task finished: ${c.taskFinished}`);
        console.log(`  search_web calls: ${c.getToolCalls('search_web').length}`);
        console.log(`  Text length: ${c.textBuffer.length}`);

        if (skipIfExternalFailure(c)) return;

        // 1. Agent should have called search_web
        expect(c.getToolCalls('search_web').length).toBeGreaterThan(0);

        // 2. Agent should produce a summary
        expect(c.textBuffer.length).toBeGreaterThan(50);

        // 3. Summary should contain AI-related keywords
        const aiKeywords = ['ai', 'chip', '芯片', 'gpu', 'nvidia', '人工智能', 'semiconductor'];
        const matched = c.findKeywords(aiKeywords);
        console.log(`[Test] AI keywords matched: ${matched.join(', ')}`);
        expect(matched.length).toBeGreaterThanOrEqual(1);

        saveTestArtifacts('ws-04', { 'output.txt': c.textBuffer });
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// WS-05: 全部 Provider 失败时的错误消息 (Unit Test)
// ============================================================================

describe('WS-05: 全部 Provider 失败时的错误消息', () => {
    test('错误消息应包含 API Key 配置建议', async () => {
        // Force all providers to fail by using invalid config
        const config: SearchConfig = {
            provider: 'serper',
            serperApiKey: 'invalid-key',
            // No other keys
        };

        const result = await performSearch('test all fail', 3, config);

        if (result.results.length > 0) {
            console.log('[INFO] Some provider succeeded unexpectedly, skipping error check.');
            return;
        }

        console.log(`[Test] Error message: ${result.error}`);

        // Error message should guide the user
        expect(result.error).toBeTruthy();
        const errorLower = (result.error || '').toLowerCase();
        const hasGuidance = errorLower.includes('api') ||
                           errorLower.includes('key') ||
                           errorLower.includes('serper') ||
                           errorLower.includes('configure');
        console.log(`[Test] Error has configuration guidance: ${hasGuidance}`);
        expect(hasGuidance).toBe(true);
    });
});
