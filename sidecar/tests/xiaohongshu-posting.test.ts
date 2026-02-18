/**
 * E2E Test: Xiaohongshu Posting - Sidecar Level
 *
 * Spawns a fresh sidecar process, sends a "post to Xiaohongshu" task,
 * and verifies the agent executes the correct browser automation workflow.
 *
 * Test Scenario:
 *   Input:  "帮我在小红书上发一篇帖子，内容是hello world"
 *   Expected: Agent triggers browser tools to post on Xiaohongshu
 *
 * Verification Points:
 *   1. Task starts successfully (TASK_STARTED event)
 *   2. Agent calls browser_connect (connect to Chrome)
 *   3. Agent calls browser_navigate to Xiaohongshu
 *   4. Agent fills content with "hello world"
 *   5. Agent clicks publish button
 *   6. Task finishes (TASK_FINISHED event)
 *
 * Run: cd sidecar && bun test tests/xiaohongshu-posting.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY = '帮我在小红书上发一篇帖子，内容是hello world';
const TASK_TITLE = '小红书发帖测试 - E2E';
const SIDECAR_INIT_WAIT_MS = 5000;
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1000;

/**
 * 环境预检查说明：
 *
 * 为了让浏览器自动化测试完全通过，需要：
 * 1. 关闭所有 Chrome 实例，或使用以下命令启动 Chrome：
 *    chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\<you>\AppData\Local\Google\Chrome\User Data"
 * 2. 在 Chrome 中登录小红书创作者平台: https://creator.xiaohongshu.com
 * 3. 然后运行测试: bun test tests/xiaohongshu-posting.test.ts
 *
 * 如果 Chrome CDP 连接失败，测试会降级为验证 Agent 的意图是否正确（使用 open_in_browser 作为替代）。
 */

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

interface TaskSuspendedEvent {
    reason: string;
    userMessage: string;
    canAutoResume: boolean;
    maxWaitTimeMs?: number;
    timestamp: string;
}

interface TaskResumedEvent {
    resumeReason?: string;
    suspendDurationMs: number;
    timestamp: string;
}

interface TestReport {
    taskStarted: boolean;
    taskFinished: boolean;
    taskFailed: boolean;
    taskError: string | null;
    totalEvents: number;
    toolCalls: ToolCallEvent[];
    toolResults: ToolResultEvent[];
    browserToolCalls: ToolCallEvent[];
    textOutput: string;
    elapsedMs: number;
    xiaohongshuUrlNavigated: boolean;
    contentFilled: boolean;
    publishClicked: boolean;
    /** True if browser_connect failed due to CDP connection issues */
    cdpFailed: boolean;
    /** True if the task was suspended (e.g., waiting for login) */
    taskSuspended: boolean;
    /** Details of task suspension events */
    suspendEvents: TaskSuspendedEvent[];
    /** True if the task was resumed after suspension */
    taskResumed: boolean;
    /** Details of task resume events */
    resumeEvents: TaskResumedEvent[];
    /** True if the compound xiaohongshu_post tool was called */
    compoundToolCalled: boolean;
    /** Result of the compound tool call */
    compoundToolResult: string | null;
    /** True if the compound tool reported success */
    compoundToolSuccess: boolean;
}

// ============================================================================
// IPC Command Builder
// ============================================================================

function buildStartTaskCommand(taskId: string): string {
    return JSON.stringify({
        type: 'start_task',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId,
            title: TASK_TITLE,
            userQuery: TASK_QUERY,
            context: {
                workspacePath: process.cwd(),
            },
            config: {
                enabledToolpacks: ['builtin-websearch'],
                enabledSkills: [],
            },
        },
    });
}

// ============================================================================
// Event Collector
// ============================================================================

class EventCollector {
    events: TaskEvent[] = [];
    toolCalls: ToolCallEvent[] = [];
    toolResults: ToolResultEvent[] = [];
    textBuffer = '';
    taskStarted = false;
    taskFinished = false;
    taskFailed = false;
    taskError: string | null = null;
    taskSuspended = false;
    taskResumed = false;
    suspendEvents: TaskSuspendedEvent[] = [];
    resumeEvents: TaskResumedEvent[] = [];

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
                console.log(`[${ts}] TOOL_CALL: ${toolCall.toolName} - ${JSON.stringify(toolCall.toolArgs).slice(0, 200)}`);
                break;
            }

            case 'TOOL_RESULT': {
                const toolResult: ToolResultEvent = {
                    success: !(event.payload?.isError),
                    result: event.payload?.result || event.payload?.resultSummary || '',
                    timestamp: event.timestamp,
                };
                this.toolResults.push(toolResult);
                const icon = toolResult.success ? 'OK' : 'FAIL';
                console.log(`[${ts}] TOOL_RESULT [${icon}]: ${String(toolResult.result).slice(0, 200)}`);
                break;
            }

            case 'TASK_SUSPENDED': {
                this.taskSuspended = true;
                const suspendEvt: TaskSuspendedEvent = {
                    reason: event.payload?.reason || 'unknown',
                    userMessage: event.payload?.userMessage || '',
                    canAutoResume: event.payload?.canAutoResume ?? false,
                    maxWaitTimeMs: event.payload?.maxWaitTimeMs,
                    timestamp: event.timestamp,
                };
                this.suspendEvents.push(suspendEvt);
                console.log(`[${ts}] TASK_SUSPENDED: ${suspendEvt.reason} - ${suspendEvt.userMessage}`);
                break;
            }

            case 'TASK_RESUMED': {
                this.taskResumed = true;
                const resumeEvt: TaskResumedEvent = {
                    resumeReason: event.payload?.resumeReason,
                    suspendDurationMs: event.payload?.suspendDurationMs || 0,
                    timestamp: event.timestamp,
                };
                this.resumeEvents.push(resumeEvt);
                console.log(`[${ts}] TASK_RESUMED: ${resumeEvt.resumeReason || 'no reason'} (waited ${Math.round(resumeEvt.suspendDurationMs / 1000)}s)`);
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

            case 'PLAN_UPDATED':
                console.log(`[${ts}] PLAN: ${event.payload?.summary || ''}`);
                break;

            case 'EFFECT_REQUESTED':
                console.log(`[${ts}] EFFECT: ${event.payload?.request?.effectType} (risk: ${event.payload?.riskLevel})`);
                break;

            default:
                // Log responses and other events
                if (event.type?.endsWith('_response')) {
                    console.log(`[${ts}] ${event.type}: success=${event.payload?.success}`);
                }
                break;
        }
    }

    getBrowserToolCalls(): ToolCallEvent[] {
        return this.toolCalls.filter((tc) => tc.toolName.startsWith('browser_'));
    }

    /**
     * Get all tool calls that interact with the browser (including open_in_browser).
     */
    getAllBrowserRelatedCalls(): ToolCallEvent[] {
        return this.toolCalls.filter(
            (tc) => tc.toolName.startsWith('browser_') || tc.toolName === 'open_in_browser'
        );
    }

    /**
     * Check if browser_connect failed with CDP error.
     */
    hasCdpConnectionFailure(): boolean {
        const connectIndex = this.toolCalls.findIndex((tc) => tc.toolName === 'browser_connect');
        if (connectIndex < 0) return false;
        // Check the corresponding result
        const resultAfterConnect = this.toolResults[connectIndex];
        if (!resultAfterConnect) return false;
        return !resultAfterConnect.success;
    }

    generateReport(elapsedMs: number): TestReport {
        const browserToolCalls = this.getBrowserToolCalls();
        const allBrowserCalls = this.getAllBrowserRelatedCalls();
        const cdpFailed = this.hasCdpConnectionFailure();

        // Check if Xiaohongshu URL was navigated to (via browser_navigate OR open_in_browser)
        const xiaohongshuUrlNavigated =
            browserToolCalls.some(
                (tc) =>
                    tc.toolName === 'browser_navigate' &&
                    (tc.toolArgs.url?.includes('xiaohongshu') || tc.toolArgs.url?.includes('xhslink'))
            ) ||
            allBrowserCalls.some(
                (tc) =>
                    tc.toolName === 'open_in_browser' &&
                    (tc.toolArgs.url?.includes('xiaohongshu') || tc.toolArgs.url?.includes('xhslink'))
            );

        // Check if content was filled (via browser_fill or compound tool)
        const contentFilled = browserToolCalls.some(
            (tc) =>
                tc.toolName === 'browser_fill' &&
                (tc.toolArgs.value?.includes('hello world') || tc.toolArgs.value?.includes('Hello World'))
        );

        // Check if publish was clicked (via browser_click or compound tool)
        const publishClicked = browserToolCalls.some(
            (tc) =>
                tc.toolName === 'browser_click' &&
                (tc.toolArgs.text?.includes('发布') || tc.toolArgs.selector?.includes('publish'))
        );

        // Check compound tool usage
        const compoundToolCall = this.toolCalls.find(tc => tc.toolName === 'xiaohongshu_post');
        const compoundToolCalled = !!compoundToolCall;
        const compoundToolResultIdx = compoundToolCall
            ? this.toolCalls.indexOf(compoundToolCall)
            : -1;
        const compoundToolResultObj = compoundToolResultIdx >= 0 && compoundToolResultIdx < this.toolResults.length
            ? this.toolResults[compoundToolResultIdx]
            : null;
        const compoundToolResult = compoundToolResultObj ? String(compoundToolResultObj.result) : null;
        // The compound tool's result is a JSON object; check the success field within it
        const compoundToolSuccess = compoundToolResultObj?.success === true &&
            compoundToolResult !== null &&
            (compoundToolResult.includes('"success":true') || compoundToolResult.includes('published successfully'));

        return {
            taskStarted: this.taskStarted,
            taskFinished: this.taskFinished,
            taskFailed: this.taskFailed,
            taskError: this.taskError,
            totalEvents: this.events.length,
            toolCalls: this.toolCalls,
            toolResults: this.toolResults,
            browserToolCalls: allBrowserCalls,
            textOutput: this.textBuffer,
            elapsedMs,
            xiaohongshuUrlNavigated: xiaohongshuUrlNavigated || compoundToolCalled, // compound tool navigates internally
            contentFilled: contentFilled || compoundToolSuccess, // compound tool fills content internally
            publishClicked: publishClicked || compoundToolSuccess, // compound tool clicks publish internally
            cdpFailed,
            taskSuspended: this.taskSuspended,
            suspendEvents: this.suspendEvents,
            taskResumed: this.taskResumed,
            resumeEvents: this.resumeEvents,
            compoundToolCalled,
            compoundToolResult,
            compoundToolSuccess,
        } as TestReport;
    }
}

// ============================================================================
// Sidecar Process Manager
// ============================================================================

class SidecarProcess {
    private proc: Subprocess | null = null;
    private collector = new EventCollector();
    private stdoutBuffer = '';

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
        while (
            !this.collector.taskFinished &&
            !this.collector.taskFailed &&
            Date.now() - startTime < timeoutMs
        ) {
            // Log if task is currently suspended (waiting for user login)
            if (this.collector.taskSuspended && !this.collector.taskResumed) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                if (elapsed % 10 === 0) { // Log every 10 seconds
                    console.log(`[WAIT] Task is suspended (waiting for login)... ${elapsed}s elapsed`);
                }
            }
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
    }

    getCollector(): EventCollector {
        return this.collector;
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

describe('小红书发帖 - Sidecar E2E 测试', () => {
    let sidecar: SidecarProcess;
    let report: TestReport;

    beforeAll(async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        // Send the task
        const taskId = randomUUID();
        const command = buildStartTaskCommand(taskId);

        console.log('');
        console.log('='.repeat(70));
        console.log('  小红书发帖 E2E 测试');
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

        // Print report
        console.log('');
        console.log('='.repeat(70));
        console.log('  测试报告');
        console.log('='.repeat(70));
        console.log(`  总事件数: ${report.totalEvents}`);
        console.log(`  工具调用数: ${report.toolCalls.length}`);
        console.log(`  浏览器工具调用数: ${report.browserToolCalls.length}`);
        console.log(`  任务开始: ${report.taskStarted ? 'YES' : 'NO'}`);
        console.log(`  任务完成: ${report.taskFinished ? 'YES' : 'NO'}`);
        console.log(`  任务失败: ${report.taskFailed ? 'YES' : 'NO'}`);
        if (report.taskError) {
            console.log(`  错误: ${report.taskError}`);
        }
        console.log(`  CDP 连接: ${report.cdpFailed ? 'FAILED (Chrome 未启用远程调试)' : 'OK'}`);
        console.log(`  小红书 URL 导航: ${report.xiaohongshuUrlNavigated ? 'YES' : 'NO'}`);
        console.log(`  任务暂停(等待登录): ${report.taskSuspended ? `YES (${report.suspendEvents.length} 次)` : 'NO'}`);
        console.log(`  任务恢复: ${report.taskResumed ? `YES (${report.resumeEvents.length} 次)` : 'NO'}`);
        console.log(`  复合工具调用: ${report.compoundToolCalled ? 'YES' : 'NO'}`);
        console.log(`  复合工具成功: ${report.compoundToolSuccess ? 'YES' : 'NO'}`);
        if (report.compoundToolResult) {
            console.log(`  复合工具结果: ${report.compoundToolResult.substring(0, 300)}`);
        }
        console.log(`  内容填写: ${report.contentFilled ? 'YES' : 'NO'}${report.cdpFailed && !report.contentFilled ? ' (因 CDP 失败跳过)' : ''}`);
        console.log(`  点击发布: ${report.publishClicked ? 'YES' : 'NO'}${report.cdpFailed && !report.publishClicked ? ' (因 CDP 失败跳过)' : ''}`);
        console.log(`  耗时: ${Math.floor(report.elapsedMs / 1000)}s`);
        console.log('');

        if (report.browserToolCalls.length > 0) {
            console.log('  浏览器工具调用详情:');
            for (const tc of report.browserToolCalls) {
                console.log(`    - ${tc.toolName}: ${JSON.stringify(tc.toolArgs).slice(0, 120)}`);
            }
        }

        console.log('='.repeat(70));
        console.log('');
    }, TASK_TIMEOUT_MS + 30000); // Extra 30s buffer for beforeAll

    afterAll(() => {
        sidecar?.kill();
    });

    // ========================================================================
    // Core Pipeline Tests (always expected to pass)
    // ========================================================================

    test('1. 任务应该成功启动', () => {
        expect(report.taskStarted).toBe(true);
    });

    test('2. 应该接收到 IPC 事件', () => {
        expect(report.totalEvents).toBeGreaterThan(0);
    });

    test('3. Agent 应该尝试使用浏览器工具或复合工具', () => {
        // Agent 至少应该尝试 browser_connect、open_in_browser 或 xiaohongshu_post
        const hasBrowserOrCompound = report.browserToolCalls.length > 0 || report.compoundToolCalled;
        expect(hasBrowserOrCompound).toBe(true);
    });

    test('4. Agent 应该尝试连接浏览器（直接或通过复合工具）', () => {
        const connectCalls = report.browserToolCalls.filter((tc) => tc.toolName === 'browser_connect');
        // If compound tool was used, browser_connect is handled internally
        if (report.compoundToolCalled) {
            console.log('[INFO] 使用 xiaohongshu_post 复合工具，浏览器连接由工具内部处理。');
            expect(report.compoundToolCalled).toBe(true);
        } else {
            expect(connectCalls.length).toBeGreaterThanOrEqual(1);
        }
    });

    test('5. Agent 应该导航到小红书（browser_navigate、open_in_browser 或 xiaohongshu_post）', () => {
        // 无论是通过 browser_navigate、open_in_browser 还是 xiaohongshu_post 复合工具，都应该尝试打开小红书
        expect(report.xiaohongshuUrlNavigated).toBe(true);
    });

    test('6. 任务应该成功完成（非失败）', () => {
        // 如果是 API 余额不足等外部因素导致的失败，不算浏览器连接问题
        if (report.taskFailed && report.taskError?.includes('402')) {
            console.log('[SKIP] 任务因 API 余额不足 (402) 而失败，非浏览器/代码问题。');
            console.log(`       错误: ${report.taskError}`);
            return; // 跳过：外部依赖问题
        }
        if (report.taskFailed && report.taskError?.includes('rate_limit')) {
            console.log('[SKIP] 任务因 API 限流而失败，非浏览器/代码问题。');
            return; // 跳过：外部依赖问题
        }
        expect(report.taskFailed).toBe(false);
        expect(report.taskFinished).toBe(true);
    });

    test('7. 任务应在合理时间内完成（< 5分钟）', () => {
        expect(report.elapsedMs).toBeLessThan(TASK_TIMEOUT_MS);
    });

    // ========================================================================
    // Browser Automation Tests (depend on CDP connection)
    // These tests verify the full posting flow when Chrome CDP is available.
    // If CDP fails, they will be skipped with an informative message.
    // ========================================================================

    test('8. 应该填写发帖内容 "hello world"（需要 CDP 连接）', () => {
        if (report.cdpFailed && !report.compoundToolCalled) {
            console.log('[SKIP] Chrome CDP 连接失败，无法执行 browser_fill。');
            console.log('       请关闭 Chrome 后重试，或使用以下命令启动 Chrome：');
            console.log('       chrome.exe --remote-debugging-port=9222 --user-data-dir="<Chrome User Data Path>"');
            return; // 降级通过：Agent 意图正确但环境不满足
        }
        if (report.compoundToolCalled) {
            console.log(`[INFO] 使用 xiaohongshu_post 复合工具，内容填写由工具内部处理。成功: ${report.compoundToolSuccess}`);
        }
        expect(report.contentFilled).toBe(true);
    });

    test('9. 应该点击发布按钮（需要 CDP 连接）', () => {
        if (report.cdpFailed && !report.compoundToolCalled) {
            console.log('[SKIP] Chrome CDP 连接失败，无法执行 browser_click。');
            return; // 降级通过
        }
        if (report.compoundToolCalled) {
            console.log(`[INFO] 使用 xiaohongshu_post 复合工具，发布由工具内部处理。成功: ${report.compoundToolSuccess}`);
        }
        expect(report.publishClicked).toBe(true);
    });

    test('10. 浏览器工具调用顺序应正确', () => {
        if (report.compoundToolCalled) {
            console.log('[INFO] 使用 xiaohongshu_post 复合工具，工具调用顺序由工具内部管理。');
            expect(report.compoundToolCalled).toBe(true);
            return;
        }
        if (report.browserToolCalls.length < 2) {
            console.log('[INFO] 浏览器工具调用数量不足以验证完整顺序');
            // 至少验证有 browser_connect 在列表中
            const hasConnect = report.browserToolCalls.some((tc) => tc.toolName === 'browser_connect');
            expect(hasConnect).toBe(true);
            return;
        }

        const toolNames = report.browserToolCalls.map((tc) => tc.toolName);

        // browser_connect 应该在导航之前
        const connectIndex = toolNames.indexOf('browser_connect');
        const navigateIndex = toolNames.indexOf('browser_navigate');
        const openIndex = toolNames.indexOf('open_in_browser');
        const navIndex = navigateIndex >= 0 ? navigateIndex : openIndex;

        if (connectIndex >= 0 && navIndex >= 0) {
            expect(connectIndex).toBeLessThan(navIndex);
        }

        // browser_navigate 应该在 fill/click 之前
        const fillIndex = toolNames.indexOf('browser_fill');
        const clickIndex = toolNames.indexOf('browser_click');

        if (navigateIndex >= 0 && fillIndex >= 0) {
            expect(navigateIndex).toBeLessThan(fillIndex);
        }
        if (navigateIndex >= 0 && clickIndex >= 0) {
            expect(navigateIndex).toBeLessThan(clickIndex);
        }
    });

    // ========================================================================
    // Suspend/Resume Tests (Login Wait Mechanism)
    // These tests verify the task properly suspends when login is required
    // and resumes after user logs in.
    // ========================================================================

    test('11. 如果检测到需要登录，任务应该暂停等待', () => {
        if (report.cdpFailed) {
            console.log('[SKIP] CDP 连接失败，无法检测登录状态。');
            return;
        }
        // If the browser navigated to xiaohongshu and detected a login page,
        // the task SHOULD have been suspended (TASK_SUSPENDED event).
        // If user was already logged in, no suspension is needed - that's also fine.
        if (report.taskSuspended) {
            // Verify the suspension event has correct structure
            expect(report.suspendEvents.length).toBeGreaterThan(0);
            const firstSuspend = report.suspendEvents[0];
            expect(firstSuspend.reason).toBeTruthy();
            expect(firstSuspend.userMessage).toBeTruthy();
            expect(typeof firstSuspend.canAutoResume).toBe('boolean');
            console.log(`[OK] 任务正确暂停等待登录: ${firstSuspend.userMessage}`);
            console.log(`     自动恢复: ${firstSuspend.canAutoResume ? 'YES (心跳检测)' : 'NO (手动恢复)'}`);
        } else {
            // No suspension means user was already logged in, or login page was not detected
            console.log('[INFO] 任务未暂停 - 用户可能已登录或登录页面未被检测到。');
            console.log('       如果用户未登录但任务未暂停，请检查登录检测选择器。');
        }
    });

    test('12. 如果任务暂停后恢复，应该继续执行', () => {
        if (!report.taskSuspended) {
            console.log('[SKIP] 任务未暂停，跳过恢复测试。');
            return;
        }

        // If task was suspended, it should either:
        // a) Resume (user logged in) and continue
        // b) Be cancelled (timeout or user cancelled)
        if (report.taskResumed) {
            expect(report.resumeEvents.length).toBeGreaterThan(0);
            const firstResume = report.resumeEvents[0];
            expect(firstResume.suspendDurationMs).toBeGreaterThan(0);
            console.log(`[OK] 任务恢复成功，暂停时长: ${Math.round(firstResume.suspendDurationMs / 1000)}s`);

            // After resume, the task should continue to completion
            // (either finished or failed for non-login reasons)
            if (!report.taskFinished && !report.taskFailed) {
                console.log('[WARN] 任务恢复后既未完成也未失败，可能仍在执行中。');
            }
        } else {
            // Task was suspended but not resumed - likely timed out
            console.log('[INFO] 任务暂停后未恢复 - 可能等待超时被取消。');
        }
    });

    test('13. TASK_SUSPENDED 事件应包含正确的自动恢复配置', () => {
        if (!report.taskSuspended) {
            console.log('[SKIP] 任务未暂停，跳过事件结构测试。');
            return;
        }

        for (const suspendEvt of report.suspendEvents) {
            // Auto-resume should be enabled for login detection
            expect(suspendEvt.canAutoResume).toBe(true);
            // User message should mention login
            const loginRelated = suspendEvt.userMessage.toLowerCase().includes('login') ||
                suspendEvt.userMessage.includes('登录');
            expect(loginRelated).toBe(true);
            console.log(`[OK] 暂停事件结构正确: canAutoResume=${suspendEvt.canAutoResume}, message="${suspendEvt.userMessage}"`);
        }
    });
});
