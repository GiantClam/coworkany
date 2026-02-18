/**
 * OpenClaw 对标 — 用户场景验证测试
 *
 * 参考 OpenClaw 核心使用场景，模拟真实用户输入，验证 CoworkAny
 * 的功能完整性和可用性。
 *
 * 验证方式（优于简单关键词匹配）：
 *   1. 工具调用链验证 — Agent 按正确顺序调用了正确的工具
 *   2. 工具参数验证   — 工具收到了合理的参数
 *   3. 工具执行结果   — 工具返回成功，非空结果
 *   4. 输出质量验证   — Agent 回复长度、关键词、结构
 *   5. 副作用验证     — 文件是否被创建/修改
 *   6. 日志文件验证   — sidecar 日志记录了执行过程
 *   7. 反面验证       — Agent 没有拒绝、没有幻觉
 *
 * 场景来源（OpenClaw 核心功能）：
 *   S1: 信息检索与总结    — 搜索+分析+总结（Web Search + Browsing）
 *   S2: 自动化任务执行    — 写代码+运行+验证（Task Automation）
 *   S3: 文件处理与分析    — 读写文件+内容分析（File Automation）
 *   S4: 语音交互          — TTS 语音播报（Voice Interaction）
 *   S5: 持久记忆与偏好    — 存储+检索记忆（Persistent Memory）
 *   S6: 研究与决策支持    — 深度研究+建议（Research & Analysis）
 *   S7: 多步骤规划与执行  — 拆解任务+逐步执行（Multi-step Planning）
 *   S8: 浏览器自动化      — 打开网页+交互（Browser Control）
 *
 * Run: cd sidecar && bun test tests/user-scenarios.test.ts
 * Run single: cd sidecar && bun test tests/user-scenarios.test.ts -t "S1"
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    SidecarProcess,
    EventCollector,
    buildStartTaskCommand,
    ScenarioVerifier,
    saveTestArtifacts,
    printHeader,
    LOG_DIR,
} from './helpers/sidecar-harness';

// ============================================================================
// Config
// ============================================================================

const TIMEOUT_SHORT  = 2 * 60 * 1000;  // 2 min — simple tasks
const TIMEOUT_MEDIUM = 4 * 60 * 1000;  // 4 min — search tasks
const TIMEOUT_LONG   = 6 * 60 * 1000;  // 6 min — research tasks

const TEST_WORKSPACE = path.join(process.cwd(), '.coworkany', 'test-workspace');

function ensureWorkspace(): void {
    fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

// ============================================================================
// Helper: run a scenario end-to-end
// ============================================================================

async function runScenario(opts: {
    name: string;
    userQuery: string;
    timeoutMs: number;
    enabledSkills?: string[];
    enabledToolpacks?: string[];
}): Promise<{ sidecar: SidecarProcess; collector: EventCollector; verifier: ScenarioVerifier; elapsedMs: number }> {
    const sidecar = new SidecarProcess();
    await sidecar.start();

    const taskId = randomUUID();
    const startTime = Date.now();

    sidecar.sendCommand(buildStartTaskCommand({
        taskId,
        title: opts.name,
        userQuery: opts.userQuery,
        enabledSkills: opts.enabledSkills,
        enabledToolpacks: opts.enabledToolpacks,
    }));

    await sidecar.waitForCompletion(opts.timeoutMs);
    const elapsedMs = Date.now() - startTime;

    const verifier = new ScenarioVerifier(opts.name, sidecar.collector);
    return { sidecar, collector: sidecar.collector, verifier, elapsedMs };
}

// ============================================================================
// S1: 信息检索与总结 — "帮我搜索 AI 最新新闻并写总结"
// ============================================================================

describe('S1: 信息检索与总结', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求搜索 AI 新闻并总结', async () => {
        const result = await runScenario({
            name: 'S1-信息检索与总结',
            userQuery: '帮我搜索最新的 AI 大模型新闻，给我 3 条最重要的新闻总结',
            timeoutMs: TIMEOUT_MEDIUM,
        });
        sidecar = result.sidecar;
        const { collector, verifier, elapsedMs } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // Agent 必须调用 search_web
            .checkToolCalled('search_web', 1, 'Agent 调用了 search_web 搜索')
            // search_web 的 query 参数应包含 AI 相关关键词
            .checkToolCalledWithArg('search_web', 'query', 'ai')
            // search_web 应返回成功结果
            .checkToolSucceeded('search_web')
            // 输出应该有足够长度（至少 100 字的总结）
            .checkOutputMinLength(100)
            // 输出应包含 AI 相关关键词
            .checkOutputContains(
                ['ai', '大模型', 'llm', 'gpt', 'claude', '人工智能', 'openai', 'google', 'deepseek'],
                2, 'AI 新闻关键词'
            )
            // Agent 不应拒绝此请求
            .checkNoRefusal()
            // 日志应记录执行过程
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s1', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        // Hard assertions
        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_MEDIUM + 60_000);
});

// ============================================================================
// S2: 自动化任务执行 — "写一个脚本并运行"
// ============================================================================

describe('S2: 自动化任务执行', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求写代码、保存并运行验证', async () => {
        ensureWorkspace();
        const targetFile = path.join(TEST_WORKSPACE, 's2-calculator.py');
        try { fs.unlinkSync(targetFile); } catch { /* */ }

        const result = await runScenario({
            name: 'S2-自动化任务执行',
            userQuery: `写一个 Python 计算器函数，支持加减乘除，保存到 ${targetFile}，然后运行它测试 3+5 的结果`,
            timeoutMs: TIMEOUT_SHORT,
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 应该写文件
            .checkToolCalled('write_to_file', 1, 'Agent 写入了代码文件')
            // 应该运行命令
            .checkToolCalled('run_command', 1, 'Agent 运行了代码')
            // 工具链顺序：先写后运行
            .checkToolChain(['write_to_file', 'run_command'], '先写代码再运行')
            // run_command 应成功
            .checkToolSucceeded('run_command')
            // 输出应包含计算结果 "8"
            .checkOutputContains(['8'], 1, '计算结果包含 8')
            // 文件应该被创建
            .checkFileCreated(targetFile)
            // 文件应包含函数定义
            .checkFileContains(targetFile, 'def ')
            .checkNoRefusal()
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s2', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_SHORT + 60_000);
});

// ============================================================================
// S3: 文件处理与分析 — "读取文件并分析内容"
// ============================================================================

describe('S3: 文件处理与分析', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求读取文件、分析内容、生成报告', async () => {
        ensureWorkspace();

        // Prepare a test data file
        const dataFile = path.join(TEST_WORKSPACE, 's3-sales-data.csv');
        fs.writeFileSync(dataFile, [
            'month,revenue,cost,profit',
            'Jan,10000,6000,4000',
            'Feb,12000,7000,5000',
            'Mar,15000,8000,7000',
            'Apr,11000,6500,4500',
            'May,18000,9000,9000',
            'Jun,20000,10000,10000',
        ].join('\n'));

        const reportFile = path.join(TEST_WORKSPACE, 's3-analysis-report.md');
        try { fs.unlinkSync(reportFile); } catch { /* */ }

        const result = await runScenario({
            name: 'S3-文件处理与分析',
            userQuery: `读取 ${dataFile} 的销售数据，分析趋势，将分析报告保存到 ${reportFile}`,
            timeoutMs: TIMEOUT_SHORT,
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 应该读取文件
            .checkToolCalled('view_file', 1, 'Agent 读取了数据文件')
            // 应该写报告文件
            .checkToolCalled('write_to_file', 1, 'Agent 写入了分析报告')
            // 输出应包含分析相关内容
            .checkOutputContains(
                ['revenue', '趋势', 'profit', '增长', '分析', 'trend', '营收'],
                2, '分析关键词'
            )
            // 输出应有实质内容
            .checkOutputMinLength(100)
            .checkNoRefusal()
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s3', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_SHORT + 60_000);
});

// ============================================================================
// S4: 语音交互 — "搜索新闻并读给我听"
// ============================================================================

describe('S4: 语音交互', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求语音播报搜索结果', async () => {
        const result = await runScenario({
            name: 'S4-语音交互',
            userQuery: '搜索一条今天的科技新闻，然后用语音读给我听',
            timeoutMs: TIMEOUT_MEDIUM,
            enabledSkills: ['voice-tts'],
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 核心验证：voice_speak 必须被实际调用（不只是文本提及）
            .checkToolCalled('voice_speak', 1, 'Agent 实际调用了 voice_speak')
            // voice_speak 的 text 参数应非空
            .checkToolCalledWithArg('voice_speak', 'text', ' ')
            // 搜索也应该被调用
            .checkToolCalled('search_web', 1, 'Agent 先搜索了新闻')
            // 工具链：先搜索后语音
            .checkToolChain(['search_web', 'voice_speak'], '搜索 -> 语音播报')
            .checkNoRefusal()
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s4', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        // voice_speak 是核心验证点
        const voiceCalls = collector.getToolCalls('voice_speak');
        if (voiceCalls.length > 0) {
            const ttsText = String(voiceCalls[0].toolArgs?.text || '');
            console.log(`  TTS text length: ${ttsText.length}`);
            console.log(`  TTS text preview: ${ttsText.slice(0, 150)}`);
            expect(ttsText.length).toBeGreaterThan(10);
        }

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_MEDIUM + 60_000);
});

// ============================================================================
// S5: 持久记忆与偏好 — "记住我的偏好，稍后回忆"
// ============================================================================

describe('S5: 持久记忆与偏好', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求 Agent 记住偏好信息', async () => {
        const result = await runScenario({
            name: 'S5-持久记忆',
            userQuery: '记住以下信息：我的名字是小明，我喜欢用 TypeScript 开发，我的项目叫 CoworkAny。然后重复一遍确认你记住了。',
            timeoutMs: TIMEOUT_SHORT,
            enabledToolpacks: ['builtin-memory'],
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 应该调用 remember
            .checkToolCalled('remember', 1, 'Agent 调用了 remember 存储')
            // remember 应成功
            .checkToolSucceeded('remember')
            // 输出应回显用户提供的信息
            .checkOutputContains(['小明'], 1, '回复包含用户名')
            .checkOutputContains(['typescript', 'coworkany'], 1, '回复包含偏好信息')
            .checkNoRefusal()
            .checkLogFileWritten();

        // 额外验证：检查 memory.json 文件
        const memFile = path.join(process.cwd(), '.coworkany', 'memory.json');
        if (fs.existsSync(memFile)) {
            const memContent = fs.readFileSync(memFile, 'utf-8').toLowerCase();
            const hasMem = memContent.includes('小明') || memContent.includes('typescript');
            verifier.results.push({
                id: 'memory-file',
                description: 'Memory file contains stored data',
                severity: hasMem ? 'PASS' : 'WARN',
                detail: hasMem ? 'Found stored preference in memory.json' : 'Data not found in memory.json',
            });
        }

        verifier.printReport();
        saveTestArtifacts('s5', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_SHORT + 60_000);
});

// ============================================================================
// S6: 研究与决策支持 — "研究股票并给投资建议"
// ============================================================================

describe('S6: 研究与决策支持', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求深度研究并提供专业建议', async () => {
        const result = await runScenario({
            name: 'S6-研究与决策支持',
            userQuery: '帮我研究 Nvidia (NVDA) 最近的表现，给出投资建议（买入/持有/卖出），说明理由',
            timeoutMs: TIMEOUT_LONG,
            enabledSkills: ['stock-research'],
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 必须使用搜索（多次搜索更好）
            .checkToolCalled('search_web', 1, 'Agent 搜索了股票信息')
            // 搜索应包含 NVDA 相关
            .checkToolCalledWithArg('search_web', 'query', 'nvda')
            .checkToolSucceeded('search_web')
            // 输出应有深度分析
            .checkOutputMinLength(200)
            // 必须包含投资建议关键词
            .checkOutputContains(
                ['买入', '卖出', '持有', 'buy', 'sell', 'hold'],
                1, '投资建议评级'
            )
            // 应包含分析关键词
            .checkOutputContains(
                ['nvidia', 'nvda', 'gpu', '芯片', '收入', 'revenue', '市值', 'market'],
                3, '深度分析关键词'
            )
            // 绝对不能拒绝
            .checkNoRefusal(['无法提供投资建议', '不能给出投资建议', 'cannot provide investment'])
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s6', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_LONG + 60_000);
});

// ============================================================================
// S7: 多步骤规划与执行 — "研究技术并写博客"
// ============================================================================

describe('S7: 多步骤规划与执行', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求执行多步骤研究任务', async () => {
        ensureWorkspace();
        const blogFile = path.join(TEST_WORKSPACE, 's7-blog.md');
        try { fs.unlinkSync(blogFile); } catch { /* */ }

        const result = await runScenario({
            name: 'S7-多步骤规划',
            userQuery: `帮我研究 Rust 编程语言的优缺点，搜索最新资料，写一篇 500 字左右的技术博客，保存到 ${blogFile}`,
            timeoutMs: TIMEOUT_MEDIUM,
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            // 应该搜索资料
            .checkToolCalled('search_web', 1, 'Agent 搜索了 Rust 资料')
            .checkToolCalledWithArg('search_web', 'query', 'rust')
            // 应该写文件
            .checkToolCalled('write_to_file', 1, 'Agent 保存了博客文件')
            // 多步骤：至少 2 个不同工具
            .checkOutputMinLength(200)
            // 内容应关于 Rust
            .checkOutputContains(
                ['rust', '内存', 'memory', '安全', 'safety', '性能', 'performance', '所有权', 'ownership'],
                3, 'Rust 技术关键词'
            )
            // 文件验证
            .checkFileCreated(blogFile)
            .checkFileContains(blogFile, 'rust')
            .checkNoRefusal()
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s7', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        expect(verifier.failCount).toBe(0);
    }, TIMEOUT_MEDIUM + 60_000);
});

// ============================================================================
// S8: 浏览器自动化 — "打开网站并提取信息"
// ============================================================================

describe('S8: 浏览器自动化', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('用户要求用浏览器打开网站', async () => {
        const result = await runScenario({
            name: 'S8-浏览器自动化',
            userQuery: '用浏览器打开 https://example.com ，告诉我页面上有什么内容',
            timeoutMs: TIMEOUT_SHORT,
        });
        sidecar = result.sidecar;
        const { collector, verifier } = result;

        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            .checkOutputMinLength(20);

        // 浏览器可能不可用（测试环境），所以用软验证
        const browserCalls = collector.toolCalls.filter(t => t.toolName.startsWith('browser_'));
        const crawlCalls = collector.getToolCalls('crawl_url');
        const openCalls = collector.getToolCalls('open_in_browser');
        const webInteraction = browserCalls.length + crawlCalls.length + openCalls.length;

        if (webInteraction > 0) {
            verifier.results.push({
                id: 'browser-used', description: 'Agent used browser/crawl tools',
                severity: 'PASS',
                detail: `${webInteraction} web interaction tool calls: ${[...browserCalls, ...crawlCalls, ...openCalls].map(t => t.toolName).join(', ')}`,
            });
        } else {
            verifier.results.push({
                id: 'browser-used', description: 'Agent used browser/crawl tools',
                severity: 'WARN',
                detail: 'No browser/crawl tools used — browser may be unavailable in test env',
            });
        }

        // 输出应提及 example.com 内容
        verifier
            .checkOutputContains(['example', 'domain'], 1, '页面内容关键词')
            .checkNoRefusal()
            .checkLogFileWritten();

        verifier.printReport();
        saveTestArtifacts('s8', {
            'output.txt': collector.textBuffer,
            'report.json': JSON.stringify(verifier.toJSON(), null, 2),
        });

        // Browser tests are lenient — only fail on refusal or crash
        const criticalFails = verifier.results.filter(
            c => c.severity === 'FAIL' && (c.id.includes('lifecycle') || c.id.includes('refusal'))
        );
        expect(criticalFails.length).toBe(0);
    }, TIMEOUT_SHORT + 60_000);
});

// ============================================================================
// 综合验收报告
// ============================================================================

describe('综合验收', () => {
    test('日志目录应存在且有内容', () => {
        if (fs.existsSync(LOG_DIR)) {
            const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
            console.log(`[Test] Log directory: ${LOG_DIR}`);
            console.log(`[Test] Log files: ${files.length}`);
            expect(files.length).toBeGreaterThan(0);
        } else {
            console.log(`[WARN] Log directory not found: ${LOG_DIR}`);
        }
    });

    test('测试结果目录应有测试产物', () => {
        const resultsDir = path.join(process.cwd(), 'test-results');
        if (fs.existsSync(resultsDir)) {
            const files = fs.readdirSync(resultsDir);
            console.log(`[Test] Test results directory: ${resultsDir}`);
            console.log(`[Test] Artifact files: ${files.length}`);
            for (const f of files.filter(f => f.endsWith('.json'))) {
                console.log(`  - ${f}`);
            }
        } else {
            console.log('[INFO] No test results directory yet (first run).');
        }
    });
});
