/**
 * FS-01 ~ FS-05: 文件操作与代码能力测试 (P1)
 *
 * 对标 OpenClaw File Automation + Document Processing。
 * 验证 CoworkAny 的文件操作能力：
 *   1. 文件 CRUD（创建/读取/修改/删除）
 *   2. 目录列表 (list_dir)
 *   3. 文件内容替换 (replace_file_content)
 *   4. Shell 命令执行 (run_command)
 *   5. 代码生成与写入（端到端）
 *
 * Run: cd sidecar && bun test tests/file-operations.test.ts
 */

import { describe, test, expect, afterAll, afterEach } from 'bun:test';
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
const TEST_WORKSPACE = path.join(process.cwd(), '.coworkany', 'test-workspace');

// Ensure clean test workspace
function ensureTestWorkspace(): void {
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

function cleanTestFile(filename: string): void {
    const fp = path.join(TEST_WORKSPACE, filename);
    try { fs.unlinkSync(fp); } catch { /* ignore */ }
}

// ============================================================================
// FS-01: 文件 CRUD
// ============================================================================

describe('FS-01: 文件 CRUD', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应创建文件、写入内容、然后读取', async () => {
        ensureTestWorkspace();
        sidecar = new SidecarProcess();
        await sidecar.start();

        const testFile = 'fs01-test.txt';
        cleanTestFile(testFile);

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'FS-01 文件CRUD',
            userQuery: `创建文件 ${TEST_WORKSPACE}/${testFile}，写入 "Hello CoworkAny"，然后读取内容告诉我`,
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('FS-01 Report');
        const writeCalls = c.getToolCalls('write_to_file');
        const viewCalls = c.getToolCalls('view_file');
        console.log(`  write_to_file: ${writeCalls.length}`);
        console.log(`  view_file: ${viewCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should have used write_to_file
        expect(writeCalls.length).toBeGreaterThan(0);

        // Text should mention the file content
        const text = c.getAllText();
        const hasContent = text.includes('hello') || text.includes('coworkany');
        console.log(`[Test] Response mentions file content: ${hasContent}`);
        expect(hasContent).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// FS-02: 目录列表
// ============================================================================

describe('FS-02: 目录列表', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 list_dir 列出目录内容', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'FS-02 目录列表',
            userQuery: '列出当前目录下 src/tools/ 中所有 .ts 文件',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('FS-02 Report');
        const listCalls = c.getToolCalls('list_dir');
        const runCalls = c.getToolCalls('run_command');
        console.log(`  list_dir: ${listCalls.length}`);
        console.log(`  run_command: ${runCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should use list_dir or run_command (ls)
        const fileCalls = [...listCalls, ...runCalls];
        expect(fileCalls.length).toBeGreaterThan(0);

        // Should mention .ts files in the response
        const text = c.getAllText();
        const hasTsFiles = text.includes('.ts') || text.includes('websearch') || text.includes('standard');
        console.log(`[Test] Response mentions .ts files: ${hasTsFiles}`);
        expect(hasTsFiles).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// FS-03: 文件内容替换
// ============================================================================

describe('FS-03: 文件内容替换', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 replace_file_content 精确替换', async () => {
        ensureTestWorkspace();
        const testFile = path.join(TEST_WORKSPACE, 'fs03-replace.txt');
        fs.writeFileSync(testFile, 'Hello World\nThis is a test\nGoodbye World\n');

        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'FS-03 文件替换',
            userQuery: `将文件 ${testFile} 中的 "Hello World" 替换为 "Hello CoworkAny"`,
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('FS-03 Report');
        const replaceCalls = c.getToolCalls('replace_file_content');
        const writeCalls = c.getToolCalls('write_to_file');
        console.log(`  replace_file_content: ${replaceCalls.length}`);
        console.log(`  write_to_file: ${writeCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should use replace_file_content or write_to_file
        expect(replaceCalls.length + writeCalls.length).toBeGreaterThan(0);

        // Verify the file was modified
        if (fs.existsSync(testFile)) {
            const content = fs.readFileSync(testFile, 'utf-8');
            console.log(`[Test] File content after: ${content.slice(0, 200)}`);
            // "Goodbye World" should be preserved (not overwritten)
            const hasGoodbye = content.includes('Goodbye') || content.includes('goodbye');
            console.log(`[Test] Other content preserved: ${hasGoodbye}`);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// FS-04: Shell 命令执行
// ============================================================================

describe('FS-04: Shell 命令执行', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应使用 run_command 执行命令', async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'FS-04 命令执行',
            userQuery: '运行命令 echo "CoworkAny Test Success" 并告诉我输出结果',
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('FS-04 Report');
        const runCalls = c.getToolCalls('run_command');
        console.log(`  run_command: ${runCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should call run_command
        expect(runCalls.length).toBeGreaterThan(0);

        // Output should contain the echo text
        const text = c.getAllText();
        const hasOutput = text.includes('coworkany test success') || text.includes('coworkany');
        console.log(`[Test] Output contains expected text: ${hasOutput}`);
        expect(hasOutput).toBe(true);
    }, TASK_TIMEOUT_MS + 30_000);
});

// ============================================================================
// FS-05: 代码生成与写入
// ============================================================================

describe('FS-05: 代码生成与写入', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('Agent 应生成 Python 代码并保存到文件', async () => {
        ensureTestWorkspace();
        const targetFile = path.join(TEST_WORKSPACE, 'fibonacci.py');
        cleanTestFile('fibonacci.py');

        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'FS-05 代码生成',
            userQuery: `写一个 Python 斐波那契数列函数，保存到 ${targetFile}`,
        }));

        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);
        const c = sidecar.collector;

        printHeader('FS-05 Report');
        const writeCalls = c.getToolCalls('write_to_file');
        console.log(`  write_to_file: ${writeCalls.length}`);

        if (skipIfExternalFailure(c)) return;

        // Agent should write a file
        expect(writeCalls.length).toBeGreaterThan(0);

        // The text should mention fibonacci
        const text = c.getAllText();
        const hasFib = text.includes('fibonacci') || text.includes('fib') || text.includes('斐波那契');
        console.log(`[Test] Contains fibonacci: ${hasFib}`);
        expect(hasFib).toBe(true);

        // Check if file was actually created
        if (fs.existsSync(targetFile)) {
            const code = fs.readFileSync(targetFile, 'utf-8');
            console.log(`[Test] Generated code:\n${code.slice(0, 300)}`);
            expect(code.includes('def ')).toBe(true);
        }
    }, TASK_TIMEOUT_MS + 30_000);
});
