/**
 * E2E Test: AI 新闻总结 + 股票投资建议 (Desktop Client)
 *
 * 通过 CoworkAny 桌面客户端 UI 发送消息，监控控制台输出和日志文件，
 * 验证 Agent 能完成以下任务：
 *
 *   1. 检索 AI 相关新闻信息
 *   2. 检索 Cloudflare(NET)、Reddit(RDDT)、Nvidia(NVDA) 股票信息
 *   3. 深度研究，总结，生成投资建议（买入/卖出/持有）
 *   4. 不拒绝用户的请求
 *
 * 测试目的：
 *   验证 CoworkAny 通过自学习系统，检索 AI 相关新闻和美股信息，
 *   深度研究，总结，建立股票投资人的 skills。
 *
 * 验证手段：
 *   - Tauri 进程控制台输出（stderr/stdout → TauriLogCollector）
 *   - Sidecar 日志文件（.coworkany/logs/sidecar-*.log）
 *
 * Run:
 *   cd desktop && npx playwright test tests/stock-research-e2e-v2.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY =
    '让coworkany将AI的新闻信息整理总结并发给我，并对我持有的cloudflare、reddit、nvidia股票进行买卖建议';
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 3000;

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const DESKTOP_DIR = path.resolve(__dirname_local, '..');
const SIDECAR_DIR = path.resolve(DESKTOP_DIR, '..', 'sidecar');
const SIDECAR_LOG_DIR = path.join(SIDECAR_DIR, '.coworkany', 'logs');
const DESKTOP_LOG_DIR = path.join(DESKTOP_DIR, '.coworkany', 'logs');

// ============================================================================
// Keywords
// ============================================================================

const AI_NEWS_KEYWORDS = [
    'ai', 'artificial intelligence', '人工智能', 'openai', 'gpt',
    'llm', '大模型', 'chatgpt', 'claude', 'gemini', 'deepseek',
    'generative ai', 'machine learning', '机器学习',
];

const STOCK_CLOUDFLARE = ['cloudflare', 'net'];
const STOCK_REDDIT = ['reddit', 'rddt'];
const STOCK_NVIDIA = ['nvidia', 'nvda', '英伟达'];

const ADVICE_KEYWORDS = [
    '买入', '卖出', '持有', '建议', '投资', '目标价',
    'buy', 'sell', 'hold', 'recommend', 'target',
    '看好', '看空', '评级', '风险', '收益',
];

const REFUSAL_PATTERNS = [
    '无法提供投资建议', '不能给出投资建议', '我不是投资顾问',
    '无法帮助', 'cannot provide investment', 'not financial advice',
];

const DEEP_RESEARCH_INDICATORS = [
    '市值', 'market cap', '收入', 'revenue', '利润', 'profit',
    '同比', 'YoY', '增长率', 'growth', '竞争', 'competitor',
    '趋势', 'trend', '估值', 'valuation', '股价', 'stock price',
    'P/E', '分析师', 'analyst', '季度', 'quarter', '财报', 'earnings',
];

// ============================================================================
// Helpers
// ============================================================================

function findKeywords(text: string, keywords: string[]): string[] {
    const lower = text.toLowerCase();
    return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

/** Read latest sidecar log file content */
function readLatestSidecarLog(): { content: string; filePath: string | null } {
    try {
        // Check both possible log directories
        for (const dir of [SIDECAR_LOG_DIR, DESKTOP_LOG_DIR]) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('sidecar-') && f.endsWith('.log'))
                .map(f => ({
                    name: f,
                    fullPath: path.join(dir, f),
                    mtime: fs.statSync(path.join(dir, f)).mtime,
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length > 0) {
                const content = fs.readFileSync(files[0].fullPath, 'utf-8');
                return { content, filePath: files[0].fullPath };
            }
        }
    } catch { /* ignore */ }
    return { content: '', filePath: null };
}

/** Read latest desktop log file content */
function readLatestDesktopLog(): { content: string; filePath: string | null } {
    try {
        for (const dir of [DESKTOP_LOG_DIR, SIDECAR_LOG_DIR]) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('desktop') && f.endsWith('.log'))
                .map(f => ({
                    name: f,
                    fullPath: path.join(dir, f),
                    mtime: fs.statSync(path.join(dir, f)).mtime,
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length > 0) {
                const content = fs.readFileSync(files[0].fullPath, 'utf-8');
                return { content, filePath: files[0].fullPath };
            }
        }
    } catch { /* ignore */ }
    return { content: '', filePath: null };
}

// ============================================================================
// Test Suite
// ============================================================================

test.describe('AI新闻总结与股票投资建议 - Desktop E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('通过客户端发送消息，验证AI新闻检索和股票投资建议', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        console.log('[Test] 开始股票研究 E2E 测试...\n');

        // ================================================================
        // Step 1: 找到输入框
        // ================================================================
        console.log('[Test] 查找输入框...');

        const launcherInput = page.locator('input[placeholder="Ask CoworkAny..."]');
        const chatInput = page.locator('.chat-input');

        let input;
        let placeholder;

        try {
            await launcherInput.waitFor({ state: 'visible', timeout: 15000 });
            input = launcherInput;
            placeholder = 'Ask CoworkAny...';
        } catch {
            try {
                await chatInput.waitFor({ state: 'visible', timeout: 15000 });
                input = chatInput;
                placeholder = 'chat-input';
            } catch {
                throw new Error('无法找到输入框，请检查 fixture 和应用状态。');
            }
        }

        console.log(`[Test] 输入框已找到: placeholder="${placeholder}"`);

        // ================================================================
        // Step 2: 输入查询并发送
        // ================================================================
        console.log(`[Test] 输入查询: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await page.screenshot({ path: 'test-results/stock-v2-01-query.png' });

        console.log('[Test] 按 Enter 提交任务...');
        tauriLogs.setBaseline();

        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/stock-v2-02-submitted.png' });

        // ================================================================
        // Step 3: 监控任务执行
        // ================================================================
        console.log('[Test] 监控任务执行...\n');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;

        // Tracking flags
        let foundSearchWeb = false;
        let foundAINews = false;
        let foundCloudflare = false;
        let foundReddit = false;
        let foundNvidia = false;
        let foundAdvice = false;
        let foundRefusal = false;
        let searchWebCount = 0;

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            const rawLogs = tauriLogs.getRawSinceBaseline();
            const lowerLogs = rawLogs.toLowerCase();

            // --- Detect search_web tool calls ---
            if (!foundSearchWeb) {
                const searchLines = tauriLogs.grepSinceBaseline('TOOL_CALL');
                const webSearchCalls = searchLines.filter(l =>
                    l.includes('"name":"search_web"') || l.includes('"name": "search_web"')
                );
                if (webSearchCalls.length > 0) {
                    foundSearchWeb = true;
                    searchWebCount = webSearchCalls.length;
                    console.log(`[Test] [${elapsed}s] ✅ search_web 工具已调用 (${searchWebCount} 次)`);
                }
            } else {
                // Keep updating count
                const searchLines = tauriLogs.grepSinceBaseline('TOOL_CALL');
                const newCount = searchLines.filter(l =>
                    l.includes('"name":"search_web"') || l.includes('"name": "search_web"')
                ).length;
                if (newCount > searchWebCount) {
                    searchWebCount = newCount;
                    console.log(`[Test] [${elapsed}s] 🔍 search_web 总调用次数: ${searchWebCount}`);
                }
            }

            // --- Detect AI news ---
            if (!foundAINews) {
                const aiMatched = findKeywords(rawLogs, AI_NEWS_KEYWORDS);
                if (aiMatched.length >= 2) {
                    foundAINews = true;
                    console.log(`[Test] [${elapsed}s] ✅ AI 新闻已检索到 (${aiMatched.join(', ')})`);
                }
            }

            // --- Detect each stock ---
            if (!foundCloudflare) {
                if (findKeywords(rawLogs, STOCK_CLOUDFLARE).length > 0) {
                    foundCloudflare = true;
                    console.log(`[Test] [${elapsed}s] ✅ Cloudflare (NET) 信息已找到`);
                }
            }
            if (!foundReddit) {
                if (findKeywords(rawLogs, STOCK_REDDIT).length > 0) {
                    foundReddit = true;
                    console.log(`[Test] [${elapsed}s] ✅ Reddit (RDDT) 信息已找到`);
                }
            }
            if (!foundNvidia) {
                if (findKeywords(rawLogs, STOCK_NVIDIA).length > 0) {
                    foundNvidia = true;
                    console.log(`[Test] [${elapsed}s] ✅ Nvidia (NVDA) 信息已找到`);
                }
            }

            // --- Detect investment advice ---
            if (!foundAdvice) {
                const adviceMatched = findKeywords(rawLogs, ADVICE_KEYWORDS);
                if (adviceMatched.length >= 3) {
                    foundAdvice = true;
                    console.log(`[Test] [${elapsed}s] ✅ 投资建议已生成 (${adviceMatched.join(', ')})`);
                }
            }

            // --- Detect refusal ---
            if (!foundRefusal) {
                if (findKeywords(rawLogs, REFUSAL_PATTERNS).length > 0) {
                    foundRefusal = true;
                    console.log(`[Test] [${elapsed}s] ❌ 检测到拒绝用户请求！`);
                }
            }

            // --- Check task completion ---
            if (!taskFinished && tauriLogs.containsSinceBaseline('"type":"TASK_FINISHED"')) {
                taskFinished = true;
                console.log(`[Test] [${elapsed}s] TASK_FINISHED 事件已检测到`);
            }
            if (!taskFailed && tauriLogs.containsSinceBaseline('"type":"TASK_FAILED"')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] TASK_FAILED 事件已检测到`);
            }

            // --- UI state check ---
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText && bodyText.includes('Ready for follow-up') && !taskFinished) {
                    taskFinished = true;
                    console.log(`[Test] [${elapsed}s] Agent 循环已结束 (UI)`);
                }
            } catch { /* ignore */ }

            // --- Progress report every 30s ---
            if (elapsed % 30 === 0 && elapsed > 0) {
                console.log(`\n[${elapsed}s] === 进度报告 ===`);
                console.log(`  search_web: ${foundSearchWeb ? `✅ (${searchWebCount}次)` : '❌'}`);
                console.log(`  AI 新闻:    ${foundAINews ? '✅' : '❌'}`);
                console.log(`  Cloudflare: ${foundCloudflare ? '✅' : '❌'}`);
                console.log(`  Reddit:     ${foundReddit ? '✅' : '❌'}`);
                console.log(`  Nvidia:     ${foundNvidia ? '✅' : '❌'}`);
                console.log(`  投资建议:   ${foundAdvice ? '✅' : '❌'}`);
                console.log(`  拒绝:       ${foundRefusal ? '❌ 是' : '✅ 否'}`);
                console.log(`  任务完成:   ${taskFinished ? '✅' : '⏳'}`);
                console.log(`========================\n`);
            }

            // --- Early exit ---
            if (taskFinished || taskFailed) {
                await new Promise(r => setTimeout(r, 5000)); // wait for final events
                break;
            }

            // --- Additional exit: Agent finished replying (no TASK_FINISHED event but UI idle) ---
            // Some agents finish replying without emitting TASK_FINISHED explicitly.
            // Detect by checking if we have meaningful content and UI is idle for > 30s.
            if (elapsed > 60 && !taskFinished && !taskFailed) {
                const hasContent = foundAINews || foundCloudflare || foundReddit || foundNvidia || foundAdvice || foundRefusal;
                if (hasContent) {
                    // Check if logs stopped growing (agent done)
                    const currentLogLen = rawLogs.length;
                    await new Promise(r => setTimeout(r, 15000));
                    const newLogLen = tauriLogs.getRawSinceBaseline().length;
                    if (newLogLen === currentLogLen) {
                        taskFinished = true;
                        console.log(`[Test] [${elapsed}s] Agent 已静默完成 (日志停止增长 15s)`);
                        break;
                    }
                }
            }
        }

        await page.screenshot({ path: 'test-results/stock-v2-99-final.png' });

        // ================================================================
        // Step 4: 读取日志文件
        // ================================================================
        const sidecarLog = readLatestSidecarLog();
        const desktopLog = readLatestDesktopLog();

        // ================================================================
        // Step 5: 深度研究评分（从控制台输出 + 日志文件中综合分析）
        // ================================================================
        const allTextForAnalysis = (
            tauriLogs.getRawSinceBaseline() + '\n' +
            sidecarLog.content + '\n' +
            desktopLog.content
        ).toLowerCase();

        const deepResearchMatched = findKeywords(allTextForAnalysis, DEEP_RESEARCH_INDICATORS);
        const deepResearchScore = Math.min(10, Math.round(deepResearchMatched.length / 2));

        // ================================================================
        // Step 6: Final Report
        // ================================================================
        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        console.log('');
        console.log('='.repeat(70));
        console.log('  📊 AI新闻总结与股票投资建议 - Desktop E2E 测试报告');
        console.log('='.repeat(70));
        console.log(`  查询: ${TASK_QUERY}`);
        console.log(`  耗时: ${totalElapsed}s`);
        console.log('');
        console.log('  --- 📡 控制台输出检查 ---');
        console.log(`  search_web 调用: ${foundSearchWeb ? `✅ (${searchWebCount}次)` : '❌'}`);
        console.log(`  AI 新闻:         ${foundAINews ? '✅' : '❌'}`);
        console.log(`  Cloudflare:      ${foundCloudflare ? '✅' : '❌'}`);
        console.log(`  Reddit:          ${foundReddit ? '✅' : '❌'}`);
        console.log(`  Nvidia:          ${foundNvidia ? '✅' : '❌'}`);
        console.log(`  投资建议:        ${foundAdvice ? '✅' : '❌'}`);
        console.log(`  拒绝请求:        ${foundRefusal ? '❌ (不允许)' : '✅ 未拒绝'}`);
        console.log(`  任务完成:        ${taskFinished ? '✅' : '❌'}`);
        console.log(`  任务失败:        ${taskFailed ? '❌' : '✅'}`);
        console.log('');
        console.log('  --- 📝 日志文件检查 ---');
        console.log(`  Sidecar 日志文件: ${sidecarLog.filePath || '未找到 ❌'}`);
        console.log(`  Sidecar 日志大小: ${sidecarLog.content.length} bytes`);
        console.log(`  Desktop 日志文件: ${desktopLog.filePath || '未找到 ❌'}`);
        console.log(`  Desktop 日志大小: ${desktopLog.content.length} bytes`);
        console.log('');
        console.log('  --- 🧠 深度研究 ---');
        console.log(`  深度研究评分: ${deepResearchScore}/10`);
        console.log(`  匹配指标: ${deepResearchMatched.slice(0, 12).join(', ')}`);
        console.log('='.repeat(70));
        console.log('');

        // ================================================================
        // Step 7: 保存测试结果
        // ================================================================
        try {
            fs.mkdirSync('test-results', { recursive: true });
            fs.writeFileSync('test-results/stock-v2-console-output.txt', tauriLogs.getRawSinceBaseline());
            if (sidecarLog.content) {
                fs.writeFileSync('test-results/stock-v2-sidecar-log.txt', sidecarLog.content.slice(-50000));
            }
            console.log('[Test] 测试结果已保存到 test-results/');
        } catch (e) {
            console.log(`[Test] Warning: 无法保存测试结果: ${e}`);
        }

        // ================================================================
        // Step 8: Assertions
        // ================================================================

        // Handle API errors gracefully
        if (taskFailed) {
            const rawLogs = tauriLogs.getRawSinceBaseline();
            const isApiError = rawLogs.includes('insufficient_quota') ||
                             rawLogs.includes('rate_limit') ||
                             rawLogs.includes('402');
            if (isApiError) {
                console.log('[Test] 任务因 API 问题失败，跳过测试。');
                test.skip(true, 'API error');
                return;
            }
        }

        // -- 核心断言 --

        // 1. 任务完成
        expect(taskFinished, '任务应该在超时时间内完成').toBe(true);

        // 2. 不允许拒绝
        expect(foundRefusal, '不允许拒绝用户的投资建议请求').toBe(false);

        // 3. 网络搜索
        expect(foundSearchWeb, 'Agent 应该使用 search_web 工具进行检索').toBe(true);

        // 4. AI 新闻
        expect(foundAINews, '应该检索到 AI 相关新闻').toBe(true);

        // 5. 三只股票
        expect(foundCloudflare, '应该包含 Cloudflare 股票信息').toBe(true);
        expect(foundReddit, '应该包含 Reddit 股票信息').toBe(true);
        expect(foundNvidia, '应该包含 Nvidia 股票信息').toBe(true);

        // 6. 投资建议
        expect(foundAdvice, '应该生成投资建议（买入/卖出/持有）').toBe(true);

        // 7. 深度研究
        expect(deepResearchScore, '深度研究评分至少 3/10').toBeGreaterThanOrEqual(3);

        // 8. 日志文件验证
        expect(sidecarLog.filePath !== null, 'Sidecar 日志文件应该存在').toBe(true);
        expect(sidecarLog.content.length > 0, 'Sidecar 日志文件应该有内容').toBe(true);
    });
});
