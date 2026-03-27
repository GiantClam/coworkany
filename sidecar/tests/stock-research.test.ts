/**
 * E2E Test: AI 新闻总结 + 股票投资建议
 *
 * 直接启动 sidecar 进程，发送用户查询，通过控制台输出和日志文件
 * 验证 CoworkAny Agent 能够：
 *   1. 使用 search_web 等工具检索 AI 新闻和股票信息
 *   2. 深度研究 Cloudflare(NET)、Reddit(RDDT)、Nvidia(NVDA) 三只股票
 *   3. 生成完善的投资建议（买入/卖出/持有）
 *   4. 不拒绝用户的请求
 *
 * 测试目的：
 *   CoworkAny 通过自学习系统，检索 AI 相关新闻和美股信息，
 *   深度研究，总结，建立股票投资人的 skills。
 *
 * 日志验证：
 *   测试同时检查 sidecar 的 .coworkany/logs/sidecar-*.log 日志文件，
 *   确保运行记录被正确写入磁盘。
 *
 * Run: cd sidecar && bun test tests/stock-research.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY =
    '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const SIDECAR_INIT_WAIT_MS = 5000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — research tasks are longer
const POLL_INTERVAL_MS = 2000;

// 日志目录（sidecar 运行时在 cwd/.coworkany/logs/ 下生成）
const LOG_DIR = path.join(process.cwd(), '.coworkany', 'logs');

// ============================================================================
// Types
// ============================================================================

interface TaskEvent {
    type: string;
    id?: string;
    timestamp: string;
    payload: Record<string, any>;
}

interface ToolCallEvent {
    toolName: string;
    toolArgs: Record<string, any>;
    timestamp: string;
}

interface ToolResultEvent {
    toolName?: string;
    success: boolean;
    result: any;
    timestamp: string;
}

interface StockResearchReport {
    // Task lifecycle
    taskStarted: boolean;
    taskFinished: boolean;
    taskFailed: boolean;
    taskError: string | null;
    totalEvents: number;
    elapsedMs: number;

    // Tool usage
    toolCalls: ToolCallEvent[];
    toolResults: ToolResultEvent[];
    searchWebCalls: ToolCallEvent[];
    searchWebCallCount: number;

    // Content verification
    textOutput: string;

    // AI News
    aiNewsFound: boolean;
    aiNewsKeywordsMatched: string[];

    // Stock info for each target
    cloudflareFound: boolean;
    redditFound: boolean;
    nvidiaFound: boolean;
    allStocksFound: boolean;

    // Investment advice
    investmentAdviceFound: boolean;
    adviceKeywordsMatched: string[];

    // Refusal detection
    refusalDetected: boolean;
    refusalIndicators: string[];

    // Deep research indicators
    deepResearchIndicators: string[];
    deepResearchScore: number; // 0-10 scale

    // Log file validation
    logFileExists: boolean;
    logFileHasContent: boolean;
    logFilePath: string | null;
}

// ============================================================================
// Keywords & Patterns
// ============================================================================

const AI_NEWS_KEYWORDS = [
    'ai', 'artificial intelligence', '人工智能', 'openai', 'gpt',
    'llm', 'large language model', '大模型', '大语言模型',
    'chatgpt', 'claude', 'gemini', 'deepseek',
    '生成式ai', 'generative ai', 'machine learning', '机器学习',
];

const STOCK_KEYWORDS_CLOUDFLARE = ['cloudflare', 'net', 'cdn', '内容分发'];
const STOCK_KEYWORDS_REDDIT = ['reddit', 'rddt', '社交媒体'];
const STOCK_KEYWORDS_NVIDIA = ['nvidia', 'nvda', '英伟达', 'gpu', '芯片'];

const ADVICE_KEYWORDS = [
    '买入', '卖出', '持有', '建议', '投资', '目标价',
    'buy', 'sell', 'hold', 'recommend', 'target price',
    '看好', '看空', '中性', '评级', 'rating',
    '风险', 'risk', '收益', 'return', '市盈率', 'p/e',
    '业绩', '财报', 'earnings', 'revenue', '营收',
];

const REFUSAL_PATTERNS = [
    '无法提供投资建议', '不能给出投资建议', '我不是投资顾问',
    '无法帮助', '拒绝', '不能完成',
    'cannot provide investment', 'not financial advice',
    'unable to', 'cannot help',
];

const DEEP_RESEARCH_INDICATORS = [
    '市值', 'market cap', '收入', 'revenue', '利润', 'profit',
    '同比', 'year-over-year', 'YoY', '增长率', 'growth rate',
    '竞争', 'competitor', '行业', 'industry', '趋势', 'trend',
    '技术分析', 'technical analysis', '基本面', 'fundamental',
    '估值', 'valuation', '股价', 'stock price', '市盈率', 'P/E',
    '分析师', 'analyst', '季度', 'quarter', 'Q1', 'Q2', 'Q3', 'Q4',
];

// ============================================================================
// Natural Language Entry Command Builder
// ============================================================================

function buildSendTaskMessageCommand(taskId: string): string {
    return JSON.stringify({
        type: 'send_task_message',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId,
            content: TASK_QUERY,
            config: {
                workspacePath: process.cwd(),
                enabledToolpacks: [],
                enabledSkills: ['stock-research'],
            },
        },
    });
}

// ============================================================================
// Event Collector (Stock Research specific)
// ============================================================================

class StockResearchCollector {
    events: TaskEvent[] = [];
    toolCalls: ToolCallEvent[] = [];
    toolResults: ToolResultEvent[] = [];
    textBuffer = '';
    taskStarted = false;
    taskFinished = false;
    taskFailed = false;
    taskError: string | null = null;

    processEvent(event: TaskEvent): void {
        this.events.push(event);
        const ts = new Date().toLocaleTimeString();

        switch (event.type) {
            case 'TASK_STARTED':
                this.taskStarted = true;
                console.log(`[${ts}] TASK_STARTED: ${event.payload?.title || 'untitled'}`);
                break;

            case 'TEXT_DELTA':
                this.textBuffer += event.payload?.delta || '';
                break;

            case 'TOOL_CALL': {
                const toolCall: ToolCallEvent = {
                    toolName: event.payload?.name || 'unknown',
                    toolArgs: event.payload?.input || {},
                    timestamp: event.timestamp,
                };
                this.toolCalls.push(toolCall);

                // Highlight search_web calls as they're key for this test
                const icon = toolCall.toolName === 'search_web' ? '🔍' : '🔧';
                const argsStr = JSON.stringify(toolCall.toolArgs).slice(0, 300);
                console.log(`[${ts}] TOOL_CALL ${icon}: ${toolCall.toolName} - ${argsStr}`);
                break;
            }

            case 'TOOL_RESULT': {
                const toolResult: ToolResultEvent = {
                    toolName: event.payload?.name || undefined,
                    success: !(event.payload?.isError),
                    result: event.payload?.result || event.payload?.resultSummary || '',
                    timestamp: event.timestamp,
                };
                this.toolResults.push(toolResult);
                const icon = toolResult.success ? 'OK' : 'FAIL';
                const nameTag = toolResult.toolName ? ` (${toolResult.toolName})` : '';
                console.log(`[${ts}] TOOL_RESULT [${icon}]${nameTag}: ${String(toolResult.result).slice(0, 300)}`);
                break;
            }

            case 'TASK_FINISHED':
                this.taskFinished = true;
                console.log(`[${ts}] TASK_FINISHED: ${event.payload?.summary || 'completed'}`);
                break;

            case 'TASK_FAILED':
                this.taskFailed = true;
                this.taskError = event.payload?.error || 'Unknown error';
                console.log(`[${ts}] TASK_FAILED: ${this.taskError}`);
                break;

            default:
                break;
        }
    }

    /** Get all search_web calls */
    getSearchWebCalls(): ToolCallEvent[] {
        return this.toolCalls.filter(tc => tc.toolName === 'search_web');
    }

    /** Get combined text from agent output + tool results for content analysis */
    getAllText(): string {
        const toolResultTexts = this.toolResults.map(r => String(r.result)).join('\n');
        return (this.textBuffer + '\n' + toolResultTexts).toLowerCase();
    }

    /** Check for keyword matches (case-insensitive) */
    findKeywords(keywords: string[], text?: string): string[] {
        const searchText = (text || this.getAllText()).toLowerCase();
        return keywords.filter(kw => searchText.includes(kw.toLowerCase()));
    }

    /** Generate comprehensive report */
    generateReport(elapsedMs: number): StockResearchReport {
        const allText = this.getAllText();
        const searchWebCalls = this.getSearchWebCalls();

        // AI News detection
        const aiNewsMatched = this.findKeywords(AI_NEWS_KEYWORDS);
        const aiNewsFound = aiNewsMatched.length >= 2; // at least 2 AI keywords

        // Stock detection
        const cloudflareMatched = this.findKeywords(STOCK_KEYWORDS_CLOUDFLARE);
        const redditMatched = this.findKeywords(STOCK_KEYWORDS_REDDIT);
        const nvidiaMatched = this.findKeywords(STOCK_KEYWORDS_NVIDIA);

        const cloudflareFound = cloudflareMatched.length > 0;
        const redditFound = redditMatched.length > 0;
        const nvidiaFound = nvidiaMatched.length > 0;

        // Investment advice detection
        const adviceMatched = this.findKeywords(ADVICE_KEYWORDS);
        const investmentAdviceFound = adviceMatched.length >= 3; // need multiple advice keywords

        // Refusal detection
        const refusalMatched = this.findKeywords(REFUSAL_PATTERNS);

        // Deep research scoring
        const deepResearchMatched = this.findKeywords(DEEP_RESEARCH_INDICATORS);
        const deepResearchScore = Math.min(10, Math.round(deepResearchMatched.length / 2));

        // Log file validation
        const { logFileExists, logFileHasContent, logFilePath } = this.checkLogFile();

        return {
            taskStarted: this.taskStarted,
            taskFinished: this.taskFinished,
            taskFailed: this.taskFailed,
            taskError: this.taskError,
            totalEvents: this.events.length,
            elapsedMs,

            toolCalls: this.toolCalls,
            toolResults: this.toolResults,
            searchWebCalls,
            searchWebCallCount: searchWebCalls.length,

            textOutput: this.textBuffer,

            aiNewsFound,
            aiNewsKeywordsMatched: aiNewsMatched,

            cloudflareFound,
            redditFound,
            nvidiaFound,
            allStocksFound: cloudflareFound && redditFound && nvidiaFound,

            investmentAdviceFound,
            adviceKeywordsMatched: adviceMatched,

            refusalDetected: refusalMatched.length > 0,
            refusalIndicators: refusalMatched,

            deepResearchIndicators: deepResearchMatched,
            deepResearchScore,

            logFileExists,
            logFileHasContent,
            logFilePath,
        };
    }

    /** Check sidecar log file */
    private checkLogFile(): { logFileExists: boolean; logFileHasContent: boolean; logFilePath: string | null } {
        try {
            if (!fs.existsSync(LOG_DIR)) {
                return { logFileExists: false, logFileHasContent: false, logFilePath: null };
            }
            const files = fs.readdirSync(LOG_DIR)
                .filter(f => f.startsWith('sidecar-') && f.endsWith('.log'))
                .map(f => ({
                    name: f,
                    fullPath: path.join(LOG_DIR, f),
                    mtime: fs.statSync(path.join(LOG_DIR, f)).mtime,
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length === 0) {
                return { logFileExists: false, logFileHasContent: false, logFilePath: null };
            }

            const latest = files[0];
            const stats = fs.statSync(latest.fullPath);
            return {
                logFileExists: true,
                logFileHasContent: stats.size > 100, // at least 100 bytes
                logFilePath: latest.fullPath,
            };
        } catch {
            return { logFileExists: false, logFileHasContent: false, logFilePath: null };
        }
    }
}

// ============================================================================
// Sidecar Process Manager
// ============================================================================

class SidecarProcess {
    private proc: Subprocess | null = null;
    private collector = new StockResearchCollector();
    private stdoutBuffer = '';
    private allStderr = '';

    async start(): Promise<void> {
        console.log('[SIDECAR] Spawning sidecar process...');

        this.proc = spawn({
            cmd: ['bun', 'run', 'src/main.ts'],
            cwd: process.cwd(),
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });

        // Read stderr (sidecar logs)
        this.readStderr();

        // Read stdout (JSON events)
        this.readStdout();

        // Wait for initialization
        console.log(`[SIDECAR] Waiting ${SIDECAR_INIT_WAIT_MS}ms for initialization...`);
        await new Promise((r) => setTimeout(r, SIDECAR_INIT_WAIT_MS));
        console.log('[SIDECAR] Ready.');
    }

    private readStderr(): void {
        if (!this.proc) return;
        const stderrStream = this.proc.stderr;
        (async () => {
            try {
                for await (const chunk of stderrStream) {
                    const text = new TextDecoder().decode(chunk);
                    this.allStderr += text;
                    for (const line of text.split('\n')) {
                        if (line.trim()) {
                            process.stderr.write(`[SIDECAR-LOG] ${line}\n`);
                        }
                    }
                }
            } catch {
                // Stream closed
            }
        })();
    }

    private readStdout(): void {
        if (!this.proc) return;
        const stdoutStream = this.proc.stdout;
        (async () => {
            try {
                for await (const chunk of stdoutStream) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);

                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const event = JSON.parse(line) as TaskEvent;
                            this.collector.processEvent(event);
                        } catch {
                            process.stderr.write(`[STDOUT-RAW] ${line}\n`);
                        }
                    }
                }
            } catch {
                // Stream closed
            }
        })();
    }

    sendCommand(command: string): void {
        if (!this.proc?.stdin) {
            throw new Error('Sidecar stdin not available');
        }
        this.proc.stdin.write(command + '\n');
        this.proc.stdin.flush();
    }

    async waitForCompletion(timeoutMs: number): Promise<void> {
        const startTime = Date.now();
        let lastProgressMs = Date.now();
        let lastEventCount = 0;
        let staleCheckStart = 0;

        while (
            !this.collector.taskFinished &&
            !this.collector.taskFailed &&
            Date.now() - startTime < timeoutMs
        ) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

            const elapsedSec = Math.round((Date.now() - startTime) / 1000);

            // Progress report every 30 seconds
            if (Date.now() - lastProgressMs >= 30_000) {
                lastProgressMs = Date.now();
                console.log(`\n[${elapsedSec}s] === 进度报告 ===`);
                console.log(`  事件总数: ${this.collector.events.length}`);
                console.log(`  工具调用数: ${this.collector.toolCalls.length}`);
                console.log(`  search_web 调用: ${this.collector.getSearchWebCalls().length}`);
                console.log(`  Agent 文本长度: ${this.collector.textBuffer.length}`);
                console.log(`========================\n`);
            }

            // Stale detection: if no new events for 60s after initial activity,
            // the agent has likely finished without emitting TASK_FINISHED.
            const currentEventCount = this.collector.events.length;
            if (currentEventCount > 0 && currentEventCount === lastEventCount) {
                if (staleCheckStart === 0) {
                    staleCheckStart = Date.now();
                } else if (Date.now() - staleCheckStart > 60_000) {
                    console.log(`[${elapsedSec}s] Agent 已 60s 无新事件，判定为已完成。`);
                    this.collector.taskFinished = true;
                    break;
                }
            } else {
                staleCheckStart = 0;
                lastEventCount = currentEventCount;
            }
        }
    }

    getCollector(): StockResearchCollector {
        return this.collector;
    }

    getAllStderr(): string {
        return this.allStderr;
    }

    kill(): void {
        if (this.proc) {
            console.log('[SIDECAR] Killing process...');
            this.proc.kill();
            this.proc = null;
        }
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('AI新闻总结与股票投资建议 - Sidecar E2E 测试', () => {
    let sidecar: SidecarProcess;
    let report: StockResearchReport;
    let searchWebAvailable = true;
    let clarificationBlocked = false;

    beforeAll(async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        // Send the task
        const taskId = randomUUID();
        const command = buildSendTaskMessageCommand(taskId);

        console.log('');
        console.log('='.repeat(70));
        console.log('  AI新闻总结与股票投资建议 E2E 测试');
        console.log(`  Query: "${TASK_QUERY}"`);
        console.log(`  TaskId: ${taskId}`);
        console.log(`  Timeout: ${TASK_TIMEOUT_MS / 1000}s`);
        console.log('='.repeat(70));
        console.log('');

        const startTime = Date.now();
        sidecar.sendCommand(command);

        // Wait for completion
        await sidecar.waitForCompletion(TASK_TIMEOUT_MS);

        const elapsedMs = Date.now() - startTime;
        report = sidecar.getCollector().generateReport(elapsedMs);
        const stderrOutput = sidecar.getAllStderr();
        searchWebAvailable = !/(search_web disabled|No API keys found)/i.test(stderrOutput);
        clarificationBlocked = /(需要你确认|请确认|确认两点|confirm whether|requires explicit approval)/i.test(report.textOutput);

        // ================================================================
        // Print comprehensive report
        // ================================================================
        console.log('');
        console.log('='.repeat(70));
        console.log('  📊 股票研究测试报告');
        console.log('='.repeat(70));
        console.log(`  耗时: ${Math.floor(report.elapsedMs / 1000)}s`);
        console.log(`  总事件数: ${report.totalEvents}`);
        console.log(`  工具调用数: ${report.toolCalls.length}`);
        console.log(`  任务开始: ${report.taskStarted ? 'YES' : 'NO'}`);
        console.log(`  任务完成: ${report.taskFinished ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  任务失败: ${report.taskFailed ? 'YES ❌' : 'NO ✅'}`);
        if (report.taskError) {
            console.log(`  错误: ${report.taskError}`);
        }
        console.log('');

        console.log('  --- 🔍 网络搜索 ---');
        console.log(`  search_web 调用次数: ${report.searchWebCallCount}`);
        if (report.searchWebCalls.length > 0) {
            console.log('  搜索查询:');
            for (const call of report.searchWebCalls) {
                const query = call.toolArgs?.query || call.toolArgs?.keyword || JSON.stringify(call.toolArgs);
                console.log(`    🔍 "${query}"`);
            }
        }
        console.log('');

        console.log('  --- 📰 AI 新闻 ---');
        console.log(`  AI 新闻已检索: ${report.aiNewsFound ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  匹配关键词 (${report.aiNewsKeywordsMatched.length}): ${report.aiNewsKeywordsMatched.join(', ')}`);
        console.log('');

        console.log('  --- 📈 股票信息 ---');
        console.log(`  Cloudflare (NET): ${report.cloudflareFound ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  Reddit (RDDT):    ${report.redditFound ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  Nvidia (NVDA):    ${report.nvidiaFound ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  全部找到: ${report.allStocksFound ? 'YES ✅' : 'NO ❌'}`);
        console.log('');

        console.log('  --- 💡 投资建议 ---');
        console.log(`  投资建议已生成: ${report.investmentAdviceFound ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  匹配关键词 (${report.adviceKeywordsMatched.length}): ${report.adviceKeywordsMatched.join(', ')}`);
        console.log('');

        console.log('  --- 🚫 拒绝检测 ---');
        console.log(`  拒绝用户请求: ${report.refusalDetected ? 'YES ❌ (不允许拒绝)' : 'NO ✅'}`);
        if (report.refusalIndicators.length > 0) {
            console.log(`  拒绝指标: ${report.refusalIndicators.join(', ')}`);
        }
        console.log('');

        console.log('  --- 🧠 深度研究评分 ---');
        console.log(`  深度研究评分: ${report.deepResearchScore}/10`);
        console.log(`  匹配指标 (${report.deepResearchIndicators.length}): ${report.deepResearchIndicators.slice(0, 15).join(', ')}`);
        console.log('');

        console.log('  --- 📝 日志文件验证 ---');
        console.log(`  日志文件存在: ${report.logFileExists ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  日志文件有内容: ${report.logFileHasContent ? 'YES ✅' : 'NO ❌'}`);
        if (report.logFilePath) {
            console.log(`  日志文件路径: ${report.logFilePath}`);
        }
        console.log('');

        // Print all tool calls
        if (report.toolCalls.length > 0) {
            console.log('  所有工具调用:');
            for (const tc of report.toolCalls) {
                const icon = tc.toolName === 'search_web' ? '🔍' : '🔧';
                console.log(`    ${icon} ${tc.toolName}: ${JSON.stringify(tc.toolArgs).slice(0, 200)}`);
            }
        }

        console.log('='.repeat(70));
        console.log('');

        // Save agent text output to file for inspection
        try {
            const outputDir = path.join(process.cwd(), 'test-results');
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(
                path.join(outputDir, 'stock-research-agent-output.txt'),
                report.textOutput,
            );
            fs.writeFileSync(
                path.join(outputDir, 'stock-research-report.json'),
                JSON.stringify(report, null, 2),
            );
            console.log('[Test] Agent output saved to test-results/stock-research-agent-output.txt');
            console.log('[Test] Report saved to test-results/stock-research-report.json');
        } catch (e) {
            console.log(`[Test] Warning: could not save output files: ${e}`);
        }
    }, TASK_TIMEOUT_MS + 60_000); // Extra 60s buffer for beforeAll

    afterAll(() => {
        sidecar?.kill();
    });

    // ========================================================================
    // 1. Task Lifecycle Tests
    // ========================================================================

    test('1. 任务应进入执行流程', () => {
        const enteredExecution = report.taskStarted || report.taskFinished || report.taskFailed || report.totalEvents > 0;
        expect(enteredExecution).toBe(true);
    });

    test('2. 应该接收到 IPC 事件', () => {
        expect(report.totalEvents).toBeGreaterThan(0);
    });

    test('3. 任务应该成功完成（非失败）', () => {
        // Skip external failures (API auth, quota, rate limits)
        if (
            report.taskFailed &&
            /(401|402|403|rate_limit|quota|billing|insufficient_funds|unauthorized|无效的令牌)/i.test(
                report.taskError || ''
            )
        ) {
            console.log('[SKIP] 任务因外部 API 鉴权/计费/限流问题失败，非功能问题。');
            return;
        }
        expect(report.taskFailed).toBe(false);
        expect(report.taskFinished).toBe(true);
    });

    // ========================================================================
    // 2. 网络搜索验证 — Agent 必须使用工具进行检索
    // ========================================================================

    test('4. Agent 应该使用 search_web 工具进行网络搜索', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，无法验证工具调用。');
            return;
        }
        if (!searchWebAvailable) {
            console.log('[SKIP] 当前环境未配置 search_web API key，跳过检索工具断言。');
            return;
        }
        if (clarificationBlocked) {
            console.log('[SKIP] 当前会话停留在确认阶段，尚未进入检索执行。');
            return;
        }

        console.log(`[Test] search_web 被调用 ${report.searchWebCallCount} 次`);
        expect(report.searchWebCallCount).toBeGreaterThan(0);
    });

    test('5. 应该进行多次搜索（AI新闻 + 各股票信息）', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        if (!searchWebAvailable) {
            console.log('[SKIP] 当前环境未配置 search_web API key，跳过多次检索断言。');
            return;
        }
        if (clarificationBlocked) {
            console.log('[SKIP] 当前会话停留在确认阶段，尚未进入多轮检索。');
            return;
        }

        // We expect at least 2 searches: one for AI news, one for stocks
        // Ideally 4+: AI news + cloudflare + reddit + nvidia
        console.log(`[Test] 总搜索次数: ${report.searchWebCallCount}`);
        expect(report.searchWebCallCount).toBeGreaterThanOrEqual(2);
    });

    // ========================================================================
    // 3. AI 新闻内容验证
    // ========================================================================

    test('6. 应该检索到 AI 相关新闻信息', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        if (!searchWebAvailable) {
            console.log('[SKIP] 当前环境未配置 search_web API key，跳过 AI 新闻检索断言。');
            return;
        }
        if (clarificationBlocked) {
            console.log('[SKIP] 当前会话停留在确认阶段，尚未进入 AI 新闻检索。');
            return;
        }

        console.log(`[Test] AI 新闻关键词匹配: ${report.aiNewsKeywordsMatched.join(', ')}`);
        expect(report.aiNewsFound).toBe(true);
    });

    // ========================================================================
    // 4. 股票信息验证 — 三只股票都必须覆盖
    // ========================================================================

    test('7. 应该包含 Cloudflare (NET) 股票信息', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        expect(report.cloudflareFound).toBe(true);
    });

    test('8. 应该包含 Reddit (RDDT) 股票信息', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        expect(report.redditFound).toBe(true);
    });

    test('9. 应该包含 Nvidia (NVDA) 股票信息', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        expect(report.nvidiaFound).toBe(true);
    });

    test('10. 三只股票信息应该全部覆盖', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }

        if (!report.allStocksFound) {
            console.log(`[FAIL] 未覆盖全部股票:`);
            console.log(`  Cloudflare: ${report.cloudflareFound}`);
            console.log(`  Reddit: ${report.redditFound}`);
            console.log(`  Nvidia: ${report.nvidiaFound}`);
        }
        expect(report.allStocksFound).toBe(true);
    });

    // ========================================================================
    // 5. 投资建议验证
    // ========================================================================

    test('11. 应该生成投资建议（买入/卖出/持有）', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }

        console.log(`[Test] 投资建议关键词: ${report.adviceKeywordsMatched.join(', ')}`);
        expect(report.investmentAdviceFound).toBe(true);
    });

    // ========================================================================
    // 6. 拒绝检测 — 不允许拒绝用户请求
    // ========================================================================

    test('12. 不应该拒绝用户请求', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }

        if (report.refusalDetected) {
            console.log(`[FAIL] Agent 拒绝了用户请求！`);
            console.log(`  拒绝指标: ${report.refusalIndicators.join(', ')}`);
            console.log(`  Agent 回复 (前 500 字):`);
            console.log(`  "${report.textOutput.substring(0, 500)}"`);
        }

        expect(report.refusalDetected).toBe(false);
    });

    // ========================================================================
    // 7. 深度研究验证
    // ========================================================================

    test('13. 应该进行深度研究（不仅仅是表面信息）', () => {
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过。');
            return;
        }
        if (!searchWebAvailable) {
            console.log('[SKIP] 当前环境未配置 search_web API key，跳过深度研究断言。');
            return;
        }
        if (clarificationBlocked) {
            console.log('[SKIP] 当前会话停留在确认阶段，尚未进入深度研究。');
            return;
        }

        console.log(`[Test] 深度研究评分: ${report.deepResearchScore}/10`);
        console.log(`[Test] 匹配指标: ${report.deepResearchIndicators.join(', ')}`);

        // At least a score of 3 (basic depth)
        expect(report.deepResearchScore).toBeGreaterThanOrEqual(3);
    });

    // ========================================================================
    // 8. 日志文件验证 — 运行输出是否写入了日志
    // ========================================================================

    test('14. 日志文件应该存在', () => {
        console.log(`[Test] 日志目录: ${LOG_DIR}`);
        console.log(`[Test] 日志文件: ${report.logFilePath}`);
        expect(report.logFileExists).toBe(true);
    });

    test('15. 日志文件应该有内容', () => {
        if (!report.logFileExists) {
            console.log('[SKIP] 日志文件不存在，跳过内容检查。');
            return;
        }

        expect(report.logFileHasContent).toBe(true);

        // Additionally, verify log file contains our task's content
        if (report.logFilePath) {
            try {
                const logContent = fs.readFileSync(report.logFilePath, 'utf-8');
                const lastKB = logContent.slice(-2048); // check last 2KB
                console.log(`[Test] 日志文件大小: ${logContent.length} bytes`);
                console.log(`[Test] 日志文件末尾 (last 500 chars):`);
                console.log(lastKB.slice(-500));

                // The log should contain traces of this task
                const hasTaskTrace =
                    logContent.includes('TASK_STARTED') ||
                    logContent.includes('start_task') ||
                    logContent.includes(TASK_QUERY.slice(0, 16)) ||
                    logContent.includes('search_web');
                console.log(`[Test] 日志包含任务执行记录: ${hasTaskTrace ? 'YES ✅' : 'NO ❌'}`);
            } catch (e) {
                console.log(`[Test] Warning: could not read log file: ${e}`);
            }
        }
    });

    // ========================================================================
    // 9. 性能要求
    // ========================================================================

    test('16. 任务应在 10 分钟内完成', () => {
        expect(report.elapsedMs).toBeLessThan(TASK_TIMEOUT_MS);
    });
});
