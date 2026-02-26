/**
 * CoworkAny PPT 制作测试 - AI在环卫中的应用主题
 * 
 * 测试场景: 用户要求 CoworkAny 制作一个关于"AI在环卫中的应用及2026年展望"的PPT
 * 
 * 测试流程:
 * 1. 搜索 AI 环卫相关信息
 * 2. 搜索如何制作 PPT
 * 3. 查找/安装 PPT 相关 skills
 * 4. 研究主题内容
 * 5. 创建 PPT 文件
 * 
 * Run: cd sidecar && bun test tests/ppt-sanitation.test.ts
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
const PPT_OUTPUT = path.join(TEST_WORKSPACE, 'AI环卫应用2026.pptx');

interface TestResult {
    scenario: string;
    passed: boolean;
    toolCalls: string[];
    output: string;
    files: string[];
    details: string[];
    taskError: string | null;
}

function ensureWorkspace(): void {
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

async function runPptTask(userQuery: string): Promise<TestResult> {
    console.log('\n' + '='.repeat(60));
    console.log('[任务] ' + userQuery);
    console.log('='.repeat(60));

    const sidecar = new SidecarProcess();
    await sidecar.start();

    const taskId = randomUUID();
    sidecar.sendCommand(buildStartTaskCommand({
        taskId,
        title: 'PPT制作-AI环卫',
        userQuery,
        enabledSkills: [],
    }));

    await sidecar.waitForCompletion(180000);

    const files: string[] = [];
    if (fs.existsSync(TEST_WORKSPACE)) {
        const dirFiles = fs.readdirSync(TEST_WORKSPACE);
        for (const f of dirFiles) {
            if (f.includes('ppt') || f.includes('PPT') || f.includes('环卫') || f.includes('AI')) {
                files.push(f);
            }
        }
    }

    const result: TestResult = {
        scenario: 'PPT制作',
        passed: sidecar.collector.taskFinishedByEvent && !sidecar.collector.taskFailed,
        toolCalls: sidecar.collector.toolCalls.map(tc => tc.toolName),
        output: sidecar.collector.textBuffer,
        files,
        details: [],
        taskError: sidecar.collector.taskError,
    };

    result.details.push('任务启动: ' + (sidecar.collector.taskStarted ? '是' : '否'));
    result.details.push('任务完成(终态事件): ' + (sidecar.collector.taskFinishedByEvent ? '是' : '否'));
    result.details.push('发生空闲超时: ' + (sidecar.collector.idleTimeoutReached ? '是' : '否'));
    result.details.push('工具调用数: ' + result.toolCalls.length);
    result.details.push('输出长度: ' + result.output.length + ' 字符');
    result.details.push('任务错误: ' + (result.taskError || '(无)'));

    sidecar.kill();
    return result;
}

describe('CoworkAny PPT 制作测试 - AI环卫应用主题', () => {
    let result: TestResult;

    afterAll(() => {
        if (fs.existsSync(PPT_OUTPUT)) {
            console.log('[清理] 删除测试PPT文件');
            // fs.unlinkSync(PPT_OUTPUT);
        }
    });

    test('PPT-02: 制作AI在环卫中的应用及2026年展望PPT', async () => {
        ensureWorkspace();
        
        if (fs.existsSync(PPT_OUTPUT)) {
            fs.unlinkSync(PPT_OUTPUT);
        }

        console.log('[目录] 测试工作区: ' + TEST_WORKSPACE);
        
        result = await runPptTask(
            '帮我制作一个关于"AI在环卫中的应用及2026年展望"的PPT演示文稿，' +
            '需要包含：' +
            '1. 环卫行业的定义和发展背景 ' +
            '2. AI在环卫中的主要应用场景（如智能环卫车、垃圾分拣、智慧调度等）' +
            '3. 2026年最新技术和趋势 ' +
            '4. 成功案例分析 ' +
            '5. 未来展望 ' +
            '请先搜索相关信息，然后创建一个专业的PPT文件。'
        );

        console.log('\n[结果]');
        for (const d of result.details) {
            console.log('  - ' + d);
        }

        console.log('\n[工具调用]');
        const toolCounts: Record<string, number> = {};
        for (const tc of result.toolCalls) {
            toolCounts[tc] = (toolCounts[tc] || 0) + 1;
        }
        for (const [tool, count] of Object.entries(toolCounts)) {
            console.log('  ' + tool + ': ' + count + '次');
        }

        console.log('\n[生成的文件]');
        if (result.files.length > 0) {
            for (const f of result.files) {
                const fpath = path.join(TEST_WORKSPACE, f);
                const size = fs.existsSync(fpath) ? fs.statSync(fpath).size : 0;
                console.log('  ' + f + ' (' + size + ' bytes)');
            }
        } else {
            console.log('  (无PPT文件生成)');
        }

        console.log('\n[验证]');
        
        const taskOk = result.passed;
        console.log('  任务完成: ' + (taskOk ? '✅' : '❌'));
        
        const hasSearch = result.toolCalls.includes('search_web');
        console.log('  调用搜索: ' + (hasSearch ? '✅' : '❌'));
        
        const hasWrite = result.toolCalls.includes('write_to_file');
        console.log('  写入文件: ' + (hasWrite ? '✅' : '❌'));
        
        const hasSkill = result.toolCalls.some(tc => 
            tc.includes('skill') || tc.includes('validate') || tc.includes('learn')
        );
        console.log('  使用Skill: ' + (hasSkill ? '✅' : '❌'));

        const hasContent = result.output.length > 100;
        console.log('  有输出内容: ' + (hasContent ? '✅' : '❌'));

        const hasArtifactGate = Boolean(
            result.taskError?.includes('Artifact contract unmet') ||
            result.taskError?.includes('ARTIFACT_CONTRACT_UNMET') ||
            result.taskError?.includes('Missing required artifact')
        );
        console.log('  Artifact Gate触发: ' + (hasArtifactGate ? '✅' : '❌'));

        console.log('\n[验证]');
        console.log('  任务完成: ' + (taskOk ? '✅' : '⚠️ (搜索API不可用)'));
        console.log('  调用搜索: ' + (hasSearch ? '✅' : '❌'));
        console.log('  写入文件: ' + (hasWrite ? '✅' : '❌'));
        console.log('  Artifact Gate: ' + (hasArtifactGate ? '✅' : '❌'));
        
        expect(hasSearch).toBe(true);
        // Must reach a real terminal event instead of idle-timeout completion.
        expect(result.passed || hasArtifactGate).toBe(true);
        
    }, 300000);
});
