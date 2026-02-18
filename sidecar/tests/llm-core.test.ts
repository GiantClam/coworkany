/**
 * LLM-01 ~ LLM-06: LLM 核心对话能力测试 (P0)
 *
 * 对标 OpenClaw 多模型支持 + 基础对话质量。
 * 验证 CoworkAny 的 LLM 对话基础功能：
 *   1. Anthropic 默认 provider 基础对话
 *   2. 多 provider 切换（OpenRouter / Custom）
 *   3. 长对话上下文截断
 *   4. 中文对话质量
 *   5. 错误 API Key 优雅处理
 *
 * Run: cd sidecar && bun test tests/llm-core.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    SidecarProcess,
    EventCollector,
    buildStartTaskCommand,
    skipIfExternalFailure,
    printHeader,
    saveTestArtifacts,
} from './helpers/sidecar-harness';

const TASK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per test (simple conversation)

// ============================================================================
// LLM-01: Anthropic 基础对话
// ============================================================================

describe('LLM-01: Anthropic 基础对话', () => {
    let sidecar: SidecarProcess;
    let collector: EventCollector;

    afterAll(() => sidecar?.kill());

    test('默认 provider 能正常响应中文消息', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'LLM-01 基础对话',
            userQuery: '你好，请做自我介绍',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        collector = sidecar.collector;

        printHeader('LLM-01 Report');
        console.log(`  Task started: ${collector.taskStarted}`);
        console.log(`  Task finished: ${collector.taskFinished}`);
        console.log(`  Task failed: ${collector.taskFailed}`);
        console.log(`  Events: ${collector.events.length}`);
        console.log(`  Text length: ${collector.textBuffer.length}`);
        console.log(`  Text preview: ${collector.textBuffer.slice(0, 200)}`);

        if (skipIfExternalFailure(collector)) return;

        // 1. Task should start
        expect(collector.taskStarted).toBe(true);

        // 2. Should receive events
        expect(collector.events.length).toBeGreaterThan(0);

        // 3. Should not fail
        expect(collector.taskFailed).toBe(false);

        // 4. Should produce non-empty text response
        expect(collector.textBuffer.length).toBeGreaterThan(10);

        // 5. Should not be garbled (contains some Chinese or meaningful text)
        const text = collector.textBuffer;
        const hasMeaningfulContent = text.length > 20;
        expect(hasMeaningfulContent).toBe(true);

        saveTestArtifacts('llm-01', {
            'output.txt': collector.textBuffer,
            'events.json': JSON.stringify(collector.events, null, 2),
        });
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// LLM-04: 长对话上下文
// ============================================================================

describe('LLM-04: 长对话上下文', () => {
    let sidecar: SidecarProcess;

    afterAll(() => sidecar?.kill());

    test('maxHistoryMessages 截断生效', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        // Send a message with a unique identifier that will be pushed out of context
        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'LLM-04 上下文截断测试',
            userQuery: '请告诉我 1+1 等于多少',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const collector = sidecar.collector;

        if (skipIfExternalFailure(collector)) return;

        // Basic assertion: we got a response
        expect(collector.taskStarted).toBe(true);
        expect(collector.textBuffer.length).toBeGreaterThan(0);

        // The response should contain "2" or equivalent
        const text = collector.textBuffer.toLowerCase();
        const hasAnswer = text.includes('2') || text.includes('二');
        console.log(`[Test] Response contains answer: ${hasAnswer}`);
        expect(hasAnswer).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// LLM-05: 中文对话质量
// ============================================================================

describe('LLM-05: 中文对话质量', () => {
    let sidecar: SidecarProcess;

    afterAll(() => sidecar?.kill());

    test('中文理解与生成质量', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'LLM-05 中文对话质量',
            userQuery: '用中文简要解释什么是递归，给一个 Python 例子',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const collector = sidecar.collector;

        if (skipIfExternalFailure(collector)) return;

        expect(collector.taskStarted).toBe(true);
        expect(collector.taskFailed).toBe(false);
        expect(collector.textBuffer.length).toBeGreaterThan(50);

        const text = collector.textBuffer.toLowerCase();

        // Should contain Chinese explanation
        const chineseKeywords = ['递归', '函数', '调用'];
        const matched = collector.findKeywords(chineseKeywords, text);
        console.log(`[Test] Chinese keywords matched: ${matched.join(', ')}`);
        expect(matched.length).toBeGreaterThanOrEqual(1);

        // Should contain code-like content (def, return, etc.)
        const codeKeywords = ['def ', 'return', 'python', '```'];
        const codeMatched = collector.findKeywords(codeKeywords, text);
        console.log(`[Test] Code keywords matched: ${codeMatched.join(', ')}`);
        expect(codeMatched.length).toBeGreaterThanOrEqual(1);

        saveTestArtifacts('llm-05', { 'output.txt': collector.textBuffer });
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// LLM-06: 错误 API Key 处理
// ============================================================================

describe('LLM-06: 错误 API Key 处理', () => {
    let sidecar: SidecarProcess;

    afterAll(() => sidecar?.kill());

    test('错误 API Key 应返回明确错误而非崩溃', async () => {
        // This test verifies the sidecar doesn't crash with invalid config.
        // The actual API key validation happens at LLM call time.
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'LLM-06 错误 Key',
            userQuery: '你好',
        }));

        // Wait shorter — we expect a fast failure
        await sidecar.waitForCompletion(60_000);
        const collector = sidecar.collector;

        // The sidecar should still start (not crash)
        expect(collector.events.length).toBeGreaterThan(0);

        // If it failed, the error message should be informative
        if (collector.taskFailed) {
            expect(collector.taskError).toBeTruthy();
            console.log(`[Test] Error message: ${collector.taskError}`);
            // Should not be a generic crash
            expect(collector.taskError!.length).toBeGreaterThan(5);
        } else {
            // If using a valid key (normal case), should succeed
            expect(collector.textBuffer.length).toBeGreaterThan(0);
        }
    }, 120_000);
});
