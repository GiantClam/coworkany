import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    SidecarProcess,
    buildSendTaskMessageCommand,
    buildStartTaskCommand,
    saveTestArtifacts,
    ScenarioVerifier,
} from './helpers/sidecar-harness';

const TIMEOUT_E2E = 18 * 60 * 1000;
const REPORT_PATH = path.join(process.cwd(), 'test-results', 'x-following-ai-learning-report.md');
const AGENT_MD_PATH = path.join(process.cwd(), 'test-results', 'x-following-ai-learning-agent.md');
const SKILLS_DIR = path.join(process.cwd(), '.coworkany', 'skills');
const GENERATED_SKILL_DIR = path.join(SKILLS_DIR, 'auto-generated', 'x-following-ai-learning');
const GENERATED_SKILL_MD = path.join(GENERATED_SKILL_DIR, 'SKILL.md');
const GENERATED_TOOL_TS = path.join(GENERATED_SKILL_DIR, 'tool-template.ts');

function listSkillDirsWithMtime(baseDir: string): Map<string, number> {
    const result = new Map<string, number>();
    if (!fs.existsSync(baseDir)) return result;
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(baseDir, entry.name);
        const stat = fs.statSync(fullPath);
        result.set(entry.name, stat.mtimeMs);
    }
    return result;
}

function detectSkillDelta(before: Map<string, number>, after: Map<string, number>): string[] {
    const changed: string[] = [];
    for (const [name, mtime] of after.entries()) {
        const prev = before.get(name);
        if (!prev || mtime > prev) {
            changed.push(name);
        }
    }
    return changed;
}

function countNumberedItems(text: string): number {
    const matches = text.match(/^\s*\d+\./gm);
    return matches ? matches.length : 0;
}

function findSkillMarkdownFiles(baseDir: string): string[] {
    if (!fs.existsSync(baseDir)) return [];
    const results: string[] = [];
    const stack = [baseDir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (entry.isFile() && entry.name === 'SKILL.md') {
                results.push(full);
            }
        }
    }
    return results;
}

function writeMarkdownReport(data: {
    changedSkills: string[];
    toolCalls: string[];
    stderr: string;
    outputText: string;
    verifier: ScenarioVerifier;
}): void {
    const { changedSkills, toolCalls, stderr, outputText, verifier } = data;
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

    const learningEvidence = [
        changedSkills.length > 0 ? `- 新增或更新技能目录: ${changedSkills.join(', ')}` : '- 未检测到新增技能目录',
        stderr.includes('Installing auto-generated skill')
            ? '- 日志包含自动安装技能证据'
            : '- 日志未出现自动安装技能关键字',
        stderr.includes('Registered generated runtime tool')
            ? '- 日志包含自动注册运行时工具证据'
            : '- 日志未出现运行时工具注册关键字',
    ].join('\n');

    const content = [
        '# X Following AI Learning E2E Report',
        '',
        `- 测试时间: ${new Date().toISOString()}`,
        `- 目标: 禁用 browser_ai_action 后，验证 CoworkAny 自动学习并完成 X AI 信息提取`,
        `- Markdown 输出路径(Agent 目标): ${AGENT_MD_PATH}`,
        '',
        '## 核心验证',
        '',
        `- 校验项总数: ${verifier.results.length}`,
        `- 失败数: ${verifier.failCount}`,
        `- 工具调用总数: ${toolCalls.length}`,
        '',
        '## 学习证据',
        '',
        learningEvidence,
        '',
        '## 工具调用列表',
        '',
        ...toolCalls.map((t) => `- ${t}`),
        '',
        '## 输出片段（前3000字符）',
        '',
        '```text',
        outputText.slice(0, 3000),
        '```',
        '',
    ].join('\n');

    fs.writeFileSync(REPORT_PATH, content, 'utf-8');
}

describe('X Following AI Learning E2E', () => {
    let sidecar: SidecarProcess;

    afterAll(() => sidecar?.kill());

    test('disables browser_ai_action, triggers learning, and completes 10-item extraction', async () => {
        console.log('\n[MANUAL ACTION REQUIRED] A Chrome window may open. Please log into X manually when prompted.');
        console.log('[MANUAL ACTION REQUIRED] After login, keep X home/feed open and wait for the test to continue.\n');

        const skillsBefore = listSkillDirsWithMtime(SKILLS_DIR);
        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        const bootstrapQuery = '请回复“已就绪”。不要调用任何工具。';
        const learningQuery = [
            '只做学习准备：',
            '1) 先调用 find_learned_capability；',
            '2) 再调用 trigger_learning（主题为 x.com AI 帖文提取）；',
            `3) 创建 skill 文件：${GENERATED_SKILL_MD}`,
            `4) 创建 tool 模板文件：${GENERATED_TOOL_TS}`,
            '5) 完成后立即回复“学习准备完成”。',
        ].join('\n');

        const query = [
            '执行提取任务（禁止循环同一动作超过2次）：',
            '1) 连接浏览器并导航到 https://x.com/home；必要时点击 Following；',
            '2) 使用 browser_get_content 获取页面文本并提取 AI 相关贴文，作者需为关注列表里出现的账号；',
            '3) 若可见贴文不足10条，继续滚动/刷新后再次读取，最多2轮；',
            '4) 最终必须整理出编号1-10（若个别缺失，用“无可用内容”占位），每条含作者+正文摘要；',
            `5) 将最终结果写入 Markdown 文件: ${AGENT_MD_PATH}`,
            '6) 禁止使用 browser_ai_action。',
        ].join('\n');

        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'X Following AI Learning E2E',
            userQuery: bootstrapQuery,
            disabledTools: ['browser_ai_action'],
        } as any));

        await sidecar.waitForCompletion(2 * 60 * 1000);

        sidecar.collector.taskFinished = false;
        sidecar.collector.taskFailed = false;
        sidecar.collector.taskError = null;

        sidecar.sendCommand(buildSendTaskMessageCommand({
            taskId,
            content: learningQuery,
            disabledTools: ['browser_ai_action'],
        }));

        await sidecar.waitForCompletion(3 * 60 * 1000);

        sidecar.collector.taskFinished = false;
        sidecar.collector.taskFailed = false;
        sidecar.collector.taskError = null;

        sidecar.sendCommand(buildSendTaskMessageCommand({
            taskId,
            content: query,
            disabledTools: ['browser_ai_action'],
        }));

        await sidecar.waitForCompletion(TIMEOUT_E2E);

        const repairPrompt = [
            '修复执行（禁止循环）：',
            '1) 只允许调用 browser_get_content 1次，基于当前页面文本提取10条（不足用“无可用内容”补齐）；',
            `2) 若 skill 文件不存在，先写入 ${GENERATED_SKILL_MD}，再写入 ${GENERATED_TOOL_TS};`,
            `3) 写入 Markdown: ${AGENT_MD_PATH}`,
            '4) 最终直接输出编号1-10列表。',
        ].join('\n');

        const collectedText = sidecar.collector.textBuffer;
        const needRepair = countNumberedItems(collectedText) < 10 || !fs.existsSync(AGENT_MD_PATH);
        if (needRepair) {
            sidecar.collector.taskFinished = false;
            sidecar.collector.taskFailed = false;
            sidecar.collector.taskError = null;

            sidecar.sendCommand(buildSendTaskMessageCommand({
                taskId,
                content: repairPrompt,
                disabledTools: ['browser_ai_action'],
            }));

            await sidecar.waitForCompletion(8 * 60 * 1000);
        }

        const collector = sidecar.collector;
        const verifier = new ScenarioVerifier('X Following AI Learning E2E', collector);
        const toolNames = collector.toolCalls.map((t) => t.toolName);
        const skillsAfter = listSkillDirsWithMtime(SKILLS_DIR);
        const changedSkills = detectSkillDelta(skillsBefore, skillsAfter);
        const skillMdFiles = findSkillMarkdownFiles(path.join(SKILLS_DIR, 'auto-generated'));
        const stderr = sidecar.getAllStderr();

        const learningToolCalled = toolNames.some((name) => [
            'trigger_learning',
            'find_learned_capability',
            'query_learning_status',
            'validate_skill',
            'record_capability_usage',
        ].includes(name));

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            .checkToolCalled('browser_navigate', 1, 'Agent navigates to X')
            .checkNoRefusal()
            .checkLogFileWritten();

        const numberedItems = countNumberedItems(collector.textBuffer);

        saveTestArtifacts('x-following-ai-learning', {
            'output.txt': collector.textBuffer,
            'stderr.txt': stderr,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        writeMarkdownReport({
            changedSkills,
            toolCalls: toolNames,
            stderr,
            outputText: collector.textBuffer,
            verifier,
        });

        verifier.printReport();

        expect(toolNames.includes('browser_ai_action')).toBe(false);
        expect(learningToolCalled).toBe(true);
        expect(skillMdFiles.length > 0 || fs.existsSync(GENERATED_SKILL_MD)).toBe(true);
        expect(fs.existsSync(GENERATED_TOOL_TS)).toBe(true);
        expect(numberedItems).toBeGreaterThanOrEqual(10);
        expect(fs.existsSync(REPORT_PATH)).toBe(true);
        expect(fs.existsSync(AGENT_MD_PATH)).toBe(true);
    }, TIMEOUT_E2E + 60_000);
});
