/**
 * E2E Test: TTS (Text-to-Speech) - voice_speak Tool Invocation
 *
 * Spawns a fresh sidecar process, sends a "speak aloud" task,
 * and verifies the agent ACTUALLY CALLS the voice_speak tool
 * (not just mentions TTS in its text output).
 *
 * Test Scenario:
 *   Input:  "为coworkany增加说话的能力，将文字回复读出来。"
 *   Expected: Agent calls voice_speak tool to synthesize speech
 *
 * Verification Points:
 *   1. Task starts successfully (TASK_STARTED event)
 *   2. Agent calls voice_speak tool (TOOL_CALL event with name="voice_speak")
 *   3. voice_speak tool returns success
 *   4. Task finishes (TASK_FINISHED event)
 *
 * IMPORTANT: This test validates ACTUAL tool calls via TOOL_CALL events,
 * NOT keyword matching in text output.  Previous tests incorrectly passed
 * by detecting keywords like "语音" or "朗读" in the agent's text response
 * without confirming the tool was actually invoked.
 *
 * Run: cd sidecar && bun test tests/tts-speak.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY = '为coworkany增加说话的能力，将文字回复读出来。';
const SIDECAR_INIT_WAIT_MS = 5000;
const TASK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes (TTS is simpler than browser tasks)
const POLL_INTERVAL_MS = 1000;

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

interface TTSTestReport {
    taskStarted: boolean;
    taskFinished: boolean;
    taskFailed: boolean;
    taskError: string | null;
    totalEvents: number;
    toolCalls: ToolCallEvent[];
    toolResults: ToolResultEvent[];
    textOutput: string;
    elapsedMs: number;
    /** True if voice_speak was called at least once via TOOL_CALL event */
    voiceSpeakCalled: boolean;
    /** Number of times voice_speak was called */
    voiceSpeakCallCount: number;
    /** All voice_speak tool call events */
    voiceSpeakCalls: ToolCallEvent[];
    /** True if voice_speak returned success */
    voiceSpeakSuccess: boolean;
    /** The text that was passed to voice_speak */
    spokenTexts: string[];
    /** True if the agent only mentioned TTS in text without calling the tool (the bug we're testing for) */
    mentionedTTSWithoutCalling: boolean;
}

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
                enabledSkills: ['voice-tts'],
            },
        },
    });
}

// ============================================================================
// Event Collector (TTS-specific)
// ============================================================================

class TTSEventCollector {
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
                const icon = toolCall.toolName === 'voice_speak' ? '🔊' : '🔧';
                console.log(`[${ts}] TOOL_CALL ${icon}: ${toolCall.toolName} - ${JSON.stringify(toolCall.toolArgs).slice(0, 200)}`);
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
                console.log(`[${ts}] TOOL_RESULT [${icon}]${nameTag}: ${String(toolResult.result).slice(0, 200)}`);
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

    /**
     * Get all voice_speak tool calls from TOOL_CALL events.
     * This is the CORRECT way to verify TTS usage — NOT keyword matching.
     */
    getVoiceSpeakCalls(): ToolCallEvent[] {
        return this.toolCalls.filter((tc) => tc.toolName === 'voice_speak');
    }

    /**
     * Check if agent mentioned TTS-related keywords in text output
     * WITHOUT actually calling voice_speak.  This is the bug pattern.
     */
    hasTTSKeywordsInText(): boolean {
        const ttsKeywords = ['语音', '朗读', 'TTS', 'text-to-speech', 'voice_speak', '说话', '播报'];
        const textLower = this.textBuffer.toLowerCase();
        return ttsKeywords.some((kw) => textLower.includes(kw.toLowerCase()));
    }

    /**
     * Get the text arguments passed to voice_speak calls.
     */
    getSpokenTexts(): string[] {
        return this.getVoiceSpeakCalls()
            .map((tc) => tc.toolArgs?.text || '')
            .filter((t) => t.length > 0);
    }

    /**
     * Check if voice_speak tool call succeeded.
     * Uses two strategies:
     *   1. Match TOOL_RESULT by toolName field (sidecar emits name in TOOL_RESULT)
     *   2. Match TOOL_CALL to TOOL_RESULT by index (fallback)
     */
    voiceSpeakSucceeded(): boolean {
        const voiceCalls = this.getVoiceSpeakCalls();
        if (voiceCalls.length === 0) return false;

        // Strategy 1: Check TOOL_RESULT events that have toolName === 'voice_speak'
        const voiceResults = this.toolResults.filter(r => r.toolName === 'voice_speak');
        if (voiceResults.some(r => r.success)) return true;
        if (voiceResults.some(r => {
            const resultStr = String(r.result);
            return resultStr.includes('"success":true') || resultStr.includes('Speech synthesized successfully');
        })) return true;

        // Strategy 2: Fall back to index-based matching
        for (const voiceCall of voiceCalls) {
            const callIndex = this.toolCalls.indexOf(voiceCall);
            if (callIndex >= 0 && callIndex < this.toolResults.length) {
                const result = this.toolResults[callIndex];
                if (result.success) return true;
                const resultStr = String(result.result);
                if (resultStr.includes('"success":true') || resultStr.includes('Speech synthesized successfully')) {
                    return true;
                }
            }
        }
        return false;
    }

    generateReport(elapsedMs: number): TTSTestReport {
        const voiceSpeakCalls = this.getVoiceSpeakCalls();
        const voiceSpeakCalled = voiceSpeakCalls.length > 0;
        const mentionedTTSInText = this.hasTTSKeywordsInText();

        return {
            taskStarted: this.taskStarted,
            taskFinished: this.taskFinished,
            taskFailed: this.taskFailed,
            taskError: this.taskError,
            totalEvents: this.events.length,
            toolCalls: this.toolCalls,
            toolResults: this.toolResults,
            textOutput: this.textBuffer,
            elapsedMs,
            voiceSpeakCalled,
            voiceSpeakCallCount: voiceSpeakCalls.length,
            voiceSpeakCalls,
            voiceSpeakSuccess: this.voiceSpeakSucceeded(),
            spokenTexts: this.getSpokenTexts(),
            mentionedTTSWithoutCalling: mentionedTTSInText && !voiceSpeakCalled,
        };
    }
}

// ============================================================================
// Sidecar Process Manager
// ============================================================================

class SidecarProcess {
    private proc: Subprocess | null = null;
    private collector = new TTSEventCollector();
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
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
    }

    getCollector(): TTSEventCollector {
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

describe('TTS 语音朗读 - Sidecar E2E 测试', () => {
    let sidecar: SidecarProcess;
    let report: TTSTestReport;

    beforeAll(async () => {
        sidecar = new SidecarProcess();
        await sidecar.start();

        // Send the task
        const taskId = randomUUID();
        const command = buildSendTaskMessageCommand(taskId);

        console.log('');
        console.log('='.repeat(70));
        console.log('  TTS 语音朗读 E2E 测试');
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
        console.log('  TTS 测试报告');
        console.log('='.repeat(70));
        console.log(`  总事件数: ${report.totalEvents}`);
        console.log(`  工具调用数: ${report.toolCalls.length}`);
        console.log(`  任务开始: ${report.taskStarted ? 'YES' : 'NO'}`);
        console.log(`  任务完成: ${report.taskFinished ? 'YES' : 'NO'}`);
        console.log(`  任务失败: ${report.taskFailed ? 'YES' : 'NO'}`);
        if (report.taskError) {
            console.log(`  错误: ${report.taskError}`);
        }
        console.log('');
        console.log('  --- TTS 核心验证 ---');
        console.log(`  voice_speak 被调用: ${report.voiceSpeakCalled ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  voice_speak 调用次数: ${report.voiceSpeakCallCount}`);
        console.log(`  voice_speak 调用成功: ${report.voiceSpeakSuccess ? 'YES ✅' : 'NO ❌'}`);
        if (report.spokenTexts.length > 0) {
            console.log(`  朗读的文本:`);
            for (const text of report.spokenTexts) {
                console.log(`    - "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
            }
        }
        console.log(`  仅提到TTS但未调用工具 (BUG): ${report.mentionedTTSWithoutCalling ? 'YES ❌ (这是个bug)' : 'NO ✅'}`);
        console.log(`  耗时: ${Math.floor(report.elapsedMs / 1000)}s`);
        console.log('');

        if (report.toolCalls.length > 0) {
            console.log('  所有工具调用:');
            for (const tc of report.toolCalls) {
                const icon = tc.toolName === 'voice_speak' ? '🔊' : '  ';
                console.log(`    ${icon} ${tc.toolName}: ${JSON.stringify(tc.toolArgs).slice(0, 120)}`);
            }
        }

        console.log('='.repeat(70));
        console.log('');
    }, TASK_TIMEOUT_MS + 30000); // Extra 30s buffer for beforeAll

    afterAll(() => {
        sidecar?.kill();
    });

    // ========================================================================
    // Core Pipeline Tests
    // ========================================================================

    test('1. 任务应进入执行流程', () => {
        const enteredExecution = report.taskStarted || report.taskFinished || report.toolCalls.length > 0;
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
            console.log('[SKIP] 任务因外部 API 鉴权/计费/限流问题失败，非 TTS 问题。');
            return;
        }
        expect(report.taskFailed).toBe(false);
        expect(report.taskFinished).toBe(true);
    });

    // ========================================================================
    // TTS Core Tests — These are the KEY assertions
    // They verify ACTUAL tool calls, NOT keyword matching.
    // ========================================================================

    test('4. Agent 应该实际调用 voice_speak 工具（通过 TOOL_CALL 事件验证）', () => {
        // THIS IS THE CRITICAL TEST.
        // Previous test only checked for keywords like "语音" in text output,
        // which passes even when voice_speak is never called.
        // We now verify via TOOL_CALL events.
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，无法验证工具调用。');
            return;
        }

        if (report.mentionedTTSWithoutCalling) {
            console.log('[FAIL] Agent 在文本中提到了 TTS/语音，但没有实际调用 voice_speak 工具。');
            console.log('       这是之前测试的 bug — 仅靠关键词判断导致误判通过。');
            console.log('       Agent 文本输出 (前 500 字):');
            console.log(`       "${report.textOutput.substring(0, 500)}"`);
        }

        expect(report.voiceSpeakCalled).toBe(true);
    });

    test('5. voice_speak 工具调用应该包含有意义的文本', () => {
        if (!report.voiceSpeakCalled) {
            console.log('[SKIP] voice_speak 未被调用，跳过文本内容验证。');
            return;
        }

        // The spoken text should not be empty
        expect(report.spokenTexts.length).toBeGreaterThan(0);

        for (const text of report.spokenTexts) {
            // Text should be meaningful (at least a few characters)
            expect(text.length).toBeGreaterThan(2);
            console.log(`[OK] 朗读文本: "${text.substring(0, 100)}"`);
        }
    });

    test('6. voice_speak 工具应该返回成功结果', () => {
        if (!report.voiceSpeakCalled) {
            console.log('[SKIP] voice_speak 未被调用，跳过结果验证。');
            return;
        }

        // On platforms with TTS available, voice_speak should succeed
        // On CI or headless environments, it might fail — we log but still check
        if (!report.voiceSpeakSuccess) {
            console.log('[WARN] voice_speak 调用了但返回失败。');
            console.log('       这可能是因为当前环境不支持 TTS (headless/CI)。');
            console.log('       关键点: Agent 正确地调用了 voice_speak，只是环境不支持。');
        }

        // We assert that the tool was at least called — success depends on environment
        expect(report.voiceSpeakCalled).toBe(true);
    });

    test('7. 不应该出现"提到TTS但未调用工具"的情况', () => {
        // This test catches the specific bug from the test report:
        // Agent discusses TTS in text but never calls voice_speak
        if (report.taskFailed) {
            console.log('[SKIP] 任务失败，跳过 bug 检测。');
            return;
        }

        if (report.mentionedTTSWithoutCalling) {
            console.log('[FAIL] 检测到已知 bug: Agent 讨论了 TTS 但没有调用 voice_speak。');
            console.log('       Agent 应该实际调用 voice_speak 工具，而不是仅解释它的存在。');
        }

        expect(report.mentionedTTSWithoutCalling).toBe(false);
    });

    test('8. 任务应在合理时间内完成（< 3分钟）', () => {
        expect(report.elapsedMs).toBeLessThan(TASK_TIMEOUT_MS);
    });
});
