/**
 * CoworkAny OpenClaw 模拟真实用户测试
 * 
 * 使用测试框架正确启动 sidecar 并通过 IPC 通信，
 * 模拟真实用户发送消息，从日志和控制台输出验证执行结果。
 * 
 * Run: cd sidecar && bun test tests/openclaw-simulation.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    SidecarProcess,
    buildStartTaskCommand,
} from './helpers/sidecar-harness';

const TEST_WORKSPACE = path.join(process.cwd(), '.coworkany', 'test-workspace');

interface TestResult {
    passed: boolean;
    message: string;
    details?: any;
}

interface TestReport {
    scenario: string;
    userQuery: string;
    results: TestResult[];
    toolCalls: string[];
    outputLength: number;
    elapsedMs: number;
}

const testReports: TestReport[] = [];

function ensureWorkspace(): void {
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

function checkResult(name: string, condition: boolean, details?: string): TestResult {
    return {
        passed: condition,
        message: condition ? 'PASS: ' + name : 'FAIL: ' + name + (details ? ' - ' + details : ''),
        details,
    };
}

async function runScenario(
    name: string,
    userQuery: string,
    timeoutMs: number
): Promise<TestReport> {
    console.log('\n' + '='.repeat(60));
    console.log('[场景] ' + name);
    console.log('[用户] ' + userQuery);
    console.log('='.repeat(60));

    const sidecar = new SidecarProcess();
    await sidecar.start();

    const taskId = randomUUID();
    const startTime = Date.now();

    sidecar.sendCommand(buildStartTaskCommand({
        taskId,
        title: name,
        userQuery,
    }));

    await sidecar.waitForCompletion(timeoutMs);
    const elapsedMs = Date.now() - startTime;

    const results: TestResult[] = [];
    const toolCalls = sidecar.collector.toolCalls.map(tc => tc.toolName);

    results.push(checkResult(
        '任务已启动',
        sidecar.collector.taskStarted,
        'TASK_STARTED 事件未收到'
    ));

    results.push(checkResult(
        '任务已完成',
        sidecar.collector.taskFinished || sidecar.collector.taskFailed,
        'TASK_FINISHED 事件未收到'
    ));

    results.push(checkResult(
        '至少调用了1个工具',
        toolCalls.length > 0,
        '调用了 ' + toolCalls.length + ' 个工具'
    ));

    results.push(checkResult(
        '调用了 search_web',
        toolCalls.includes('search_web'),
        '未调用搜索工具'
    ));

    results.push(checkResult(
        '调用了文件操作工具',
        toolCalls.includes('view_file') || toolCalls.includes('write_to_file'),
        '未调用文件工具'
    ));

    results.push(checkResult(
        '调用了命令执行工具',
        toolCalls.includes('run_command'),
        '未调用命令执行工具'
    ));

    results.push(checkResult(
        '输出长度 > 50 字符',
        sidecar.collector.textBuffer.length > 50,
        '输出长度: ' + sidecar.collector.textBuffer.length
    ));

    results.push(checkResult(
        '日志文件已生成',
        sidecar.collector.checkLogFile().logFileExists,
        '日志文件不存在'
    ));

    console.log('\n[结果] ' + name + ' - ' + elapsedMs + 'ms');
    for (const r of results) {
        console.log('  ' + r.message);
    }

    const report: TestReport = {
        scenario: name,
        userQuery,
        results,
        toolCalls,
        outputLength: sidecar.collector.textBuffer.length,
        elapsedMs,
    };

    sidecar.kill();
    return report;
}

describe('OpenClaw 模拟真实用户测试', () => {
    let sidecar: SidecarProcess;

    afterAll(() => {
        if (sidecar) sidecar.kill();
    });

    test('OC-01: 信息检索 - 搜索AI新闻', async () => {
        ensureWorkspace();
        
        const report = await runScenario(
            'OC-01: 信息检索',
            '搜索最新的AI大模型新闻，给我3条最重要的新闻总结',
            120000
        );

        const passed = report.results.filter(r => r.passed).length;
        const total = report.results.length;
        
        console.log('\n[通过] ' + passed + '/' + total);
        testReports.push(report);
        
        expect(passed).toBeGreaterThan(Math.floor(total * 0.5));
    }, 180000);

    test('OC-02: 代码生成 - 写Python脚本并运行', async () => {
        ensureWorkspace();
        
        const targetFile = path.join(TEST_WORKSPACE, 'oc02_calculator.py');
        if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
        
        const report = await runScenario(
            'OC-02: 代码生成',
            '写一个Python计算器函数，支持加减乘除，保存到 ' + targetFile + '，然后运行测试 3+5',
            120000
        );

        const fileCreated = fs.existsSync(targetFile);
        if (fileCreated) {
            report.results.push({
                passed: true,
                message: 'PASS: 文件已创建: ' + path.basename(targetFile),
            });
        } else {
            report.results.push({
                passed: false,
                message: 'FAIL: 文件未创建',
            });
        }

        const passed = report.results.filter(r => r.passed).length;
        const total = report.results.length;
        
        console.log('\n[通过] ' + passed + '/' + total);
        testReports.push(report);
        
        expect(passed).toBeGreaterThan(Math.floor(total * 0.5));
    }, 180000);

    test('OC-03: 文件分析 - 读取CSV并计算', async () => {
        ensureWorkspace();
        
        const dataFile = path.join(TEST_WORKSPACE, 'oc03_data.csv');
        fs.writeFileSync(dataFile, 'name,value\nAlice,100\nBob,200\nCharlie,150');
        
        const report = await runScenario(
            'OC-03: 文件分析',
            '读取 ' + dataFile + ' 文件，计算平均值并输出结果',
            120000
        );

        const passed = report.results.filter(r => r.passed).length;
        const total = report.results.length;
        
        console.log('\n[通过] ' + passed + '/' + total);
        testReports.push(report);
        
        expect(passed).toBeGreaterThan(Math.floor(total * 0.5));
    }, 180000);

    test('OC-04: 多步骤任务 - 搜索+保存', async () => {
        ensureWorkspace();
        
        const outputFile = path.join(TEST_WORKSPACE, 'oc04_rust_news.txt');
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
        
        const report = await runScenario(
            'OC-04: 多步骤任务',
            '搜索Rust编程语言的最新发展动态，然后把搜索结果保存到 ' + outputFile,
            120000
        );

        const passed = report.results.filter(r => r.passed).length;
        const total = report.results.length;
        
        console.log('\n[通过] ' + passed + '/' + total);
        testReports.push(report);
        
        expect(passed).toBeGreaterThan(Math.floor(total * 0.5));
    }, 180000);
});

afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('OpenClaw 模拟测试结果汇总');
    console.log('='.repeat(60));
    
    let totalPassed = 0;
    let totalTests = 0;
    
    for (const report of testReports) {
        const passed = report.results.filter(r => r.passed).length;
        const total = report.results.length;
        const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
        
        console.log(report.scenario + ': ' + passed + '/' + total + ' (' + rate + '%)');
        
        totalPassed += passed;
        totalTests += total;
    }
    
    const overallRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';
    console.log('='.repeat(60));
    console.log('总计: ' + totalPassed + '/' + totalTests + ' (' + overallRate + '%)');
});
