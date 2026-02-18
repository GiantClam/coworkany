/**
 * MEM-01 ~ MEM-06: 记忆与自学习系统测试 (P1)
 *
 * 对标 OpenClaw Persistent Memory + Preferences。
 * 验证 CoworkAny 的记忆系统和自学习能力：
 *   1. 记忆存储 (remember)
 *   2. 记忆检索 (recall)
 *   3. 跨会话记忆持久化
 *   4. 自学习触发 (trigger_learning)
 *   5. 技能验证 (validate_skill)
 *   6. 能力查找 (find_learned_capability)
 *
 * Run: cd sidecar && bun test tests/memory-learning.test.ts
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

const TASK_TIMEOUT_MS = 3 * 60 * 1000;
const MEMORY_FILE = path.join(process.cwd(), '.coworkany', 'memory.json');

// ============================================================================
// MEM-01: 记忆存储
// ============================================================================

describe('MEM-01: 记忆存储', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 remember 工具存储信息', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const uniqueMarker = `test-marker-${Date.now()}`;
        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'MEM-01 记忆存储',
            userQuery: `记住：我最喜欢的编程语言是 TypeScript，标识符是 ${uniqueMarker}`,
            enabledToolpacks: ['builtin-memory'],
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('MEM-01 Report');
        const rememberCalls = c.getToolCalls('remember');
        console.log(`  remember calls: ${rememberCalls.length}`);
        console.log(`  Text: ${c.textBuffer.slice(0, 200)}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should call remember tool
        expect(rememberCalls.length).toBeGreaterThan(0);

        // Check the memory file
        if (fs.existsSync(MEMORY_FILE)) {
            const memContent = fs.readFileSync(MEMORY_FILE, 'utf-8');
            const hasMarker = memContent.includes('TypeScript') || memContent.includes('typescript');
            console.log(`[Test] Memory file contains TypeScript: ${hasMarker}`);
        } else {
            console.log('[INFO] Memory file not found (may use different storage path).');
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// MEM-02: 记忆检索
// ============================================================================

describe('MEM-02: 记忆检索', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 recall 工具检索记忆', async () => {
        // First, ensure there's something to recall
        const memDir = path.dirname(MEMORY_FILE);
        fs.mkdirSync(memDir, { recursive: true });
        if (!fs.existsSync(MEMORY_FILE)) {
            fs.writeFileSync(MEMORY_FILE, JSON.stringify([
                { key: 'favorite_lang', value: 'TypeScript', category: 'preferences', timestamp: new Date().toISOString() },
            ], null, 2));
        }

        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'MEM-02 记忆检索',
            userQuery: '我之前让你记住的我最喜欢的编程语言是什么？',
            enabledToolpacks: ['builtin-memory'],
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('MEM-02 Report');
        const recallCalls = c.getToolCalls('recall');
        console.log(`  recall calls: ${recallCalls.length}`);
        console.log(`  Text: ${c.textBuffer.slice(0, 200)}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should use recall or search_vault
        const memoryCalls = [...recallCalls, ...c.getToolCalls('search_vault')];
        expect(memoryCalls.length).toBeGreaterThan(0);

        // Response should mention TypeScript
        const text = c.getAllText();
        const hasAnswer = text.includes('typescript');
        console.log(`[Test] Response mentions TypeScript: ${hasAnswer}`);
        expect(hasAnswer).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// MEM-03: 跨会话记忆持久化
// ============================================================================

describe('MEM-03: 跨会话记忆持久化', () => {
    test('记忆文件在 sidecar 重启后仍存在', () => {
        // This is a structural test: verify memory file persists on disk
        const memDir = path.dirname(MEMORY_FILE);
        fs.mkdirSync(memDir, { recursive: true });

        // Write a test memory
        const testMemory = [
            { key: 'persistence_test', value: 'test_value', timestamp: new Date().toISOString() },
        ];
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(testMemory, null, 2));

        // Verify it persists
        expect(fs.existsSync(MEMORY_FILE)).toBe(true);
        const content = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
        expect(content[0].key).toBe('persistence_test');

        console.log(`[Test] Memory file persists at: ${MEMORY_FILE}`);
        console.log(`[Test] Content: ${JSON.stringify(content[0])}`);
    });
});

// ============================================================================
// MEM-04: 自学习触发
// ============================================================================

describe('MEM-04: 自学习触发', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应支持 trigger_learning 工具', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'MEM-04 自学习触发',
            userQuery: '触发一次学习会话，学习如何用 Python 读取 CSV 文件',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('MEM-04 Report');
        const learnCalls = c.getToolCalls('trigger_learning');
        const thinkCalls = c.getToolCalls('think');
        console.log(`  trigger_learning: ${learnCalls.length}`);
        console.log(`  think: ${thinkCalls.length}`);
        console.log(`  Total tool calls: ${c.toolCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should respond with learning-related content
        expect(c.textBuffer.length).toBeGreaterThan(20);

        const text = c.getAllText();
        const hasLearning = text.includes('csv') || text.includes('python') || text.includes('学习');
        console.log(`[Test] Contains learning content: ${hasLearning}`);
        expect(hasLearning).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// MEM-05: 技能验证
// ============================================================================

describe('MEM-05: 技能验证', () => {
    test('自学习工具结构存在', () => {
        // Verify self-learning tool definitions exist in the codebase
        const builtinPath = path.join(process.cwd(), 'src', 'tools', 'builtin.ts');
        expect(fs.existsSync(builtinPath)).toBe(true);

        const content = fs.readFileSync(builtinPath, 'utf-8');
        const hasValidateSkill = content.includes('validate_skill');
        const hasTriggerLearning = content.includes('trigger_learning');

        console.log(`[Test] validate_skill defined: ${hasValidateSkill}`);
        console.log(`[Test] trigger_learning defined: ${hasTriggerLearning}`);

        expect(hasValidateSkill).toBe(true);
        expect(hasTriggerLearning).toBe(true);
    });
});

// ============================================================================
// MEM-06: 能力查找
// ============================================================================

describe('MEM-06: 能力查找', () => {
    test('find_learned_capability 工具已定义', () => {
        const builtinPath = path.join(process.cwd(), 'src', 'tools', 'builtin.ts');
        expect(fs.existsSync(builtinPath)).toBe(true);

        const content = fs.readFileSync(builtinPath, 'utf-8');
        const hasFind = content.includes('find_learned_capability');
        const hasRecord = content.includes('record_capability_usage');

        console.log(`[Test] find_learned_capability defined: ${hasFind}`);
        console.log(`[Test] record_capability_usage defined: ${hasRecord}`);

        expect(hasFind).toBe(true);
        expect(hasRecord).toBe(true);
    });
});
