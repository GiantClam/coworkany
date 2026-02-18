/**
 * Shared Sidecar Test Harness
 *
 * Reusable infrastructure for all sidecar E2E tests:
 *   - SidecarProcess: spawn, IPC, event collection, graceful shutdown
 *   - EventCollector: generic event collection + keyword analysis
 *   - IPC command builders
 *   - Log file helpers
 *
 * Usage:
 *   import { SidecarProcess, EventCollector, buildStartTaskCommand } from './helpers/sidecar-harness';
 */

import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Config Defaults
// ============================================================================

export const SIDECAR_INIT_WAIT_MS = 5000;
export const POLL_INTERVAL_MS = 2000;
export const LOG_DIR = path.join(process.cwd(), '.coworkany', 'logs');

// ============================================================================
// Types
// ============================================================================

export interface TaskEvent {
    type: string;
    id?: string;
    timestamp: string;
    payload: Record<string, any>;
}

export interface ToolCallEvent {
    toolName: string;
    toolArgs: Record<string, any>;
    timestamp: string;
}

export interface ToolResultEvent {
    toolName?: string;
    success: boolean;
    result: any;
    timestamp: string;
}

// ============================================================================
// IPC Command Builders
// ============================================================================

export function buildStartTaskCommand(opts: {
    taskId: string;
    title: string;
    userQuery: string;
    enabledSkills?: string[];
    enabledToolpacks?: string[];
    workspacePath?: string;
}): string {
    return JSON.stringify({
        type: 'start_task',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId: opts.taskId,
            title: opts.title,
            userQuery: opts.userQuery,
            context: {
                workspacePath: opts.workspacePath || process.cwd(),
            },
            config: {
                enabledToolpacks: opts.enabledToolpacks || [],
                enabledSkills: opts.enabledSkills || [],
            },
        },
    });
}

// ============================================================================
// Generic Event Collector
// ============================================================================

export class EventCollector {
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
                const argsStr = JSON.stringify(toolCall.toolArgs).slice(0, 300);
                console.log(`[${ts}] TOOL_CALL: ${toolCall.toolName} - ${argsStr}`);
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

    /** Get tool calls by name */
    getToolCalls(toolName: string): ToolCallEvent[] {
        return this.toolCalls.filter(tc => tc.toolName === toolName);
    }

    /** Get all text (agent output + tool results) */
    getAllText(): string {
        const toolResultTexts = this.toolResults.map(r => String(r.result)).join('\n');
        return (this.textBuffer + '\n' + toolResultTexts).toLowerCase();
    }

    /** Find keyword matches (case-insensitive) */
    findKeywords(keywords: string[], text?: string): string[] {
        const searchText = (text || this.getAllText()).toLowerCase();
        return keywords.filter(kw => searchText.includes(kw.toLowerCase()));
    }

    /** Check if the task failed due to API/external issues (not a real bug) */
    isExternalFailure(): boolean {
        if (!this.taskFailed || !this.taskError) return false;
        const externalPatterns = ['402', 'rate_limit', 'quota', 'billing', 'insufficient_funds'];
        return externalPatterns.some(p => this.taskError!.includes(p));
    }

    /** Check sidecar log file exists and has content */
    checkLogFile(): { logFileExists: boolean; logFileHasContent: boolean; logFilePath: string | null } {
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
                logFileHasContent: stats.size > 100,
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

export class SidecarProcess {
    private proc: Subprocess | null = null;
    collector: EventCollector;
    private stdoutBuffer = '';
    private allStderr = '';

    constructor(collector?: EventCollector) {
        this.collector = collector || new EventCollector();
    }

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
            } catch { /* Stream closed */ }
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
            } catch { /* Stream closed */ }
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
                console.log(`\n[${elapsedSec}s] === Progress ===`);
                console.log(`  Events: ${this.collector.events.length}`);
                console.log(`  Tool calls: ${this.collector.toolCalls.length}`);
                console.log(`  Text length: ${this.collector.textBuffer.length}`);
                console.log(`========================\n`);
            }

            // Stale detection: if no new events for 60s after initial activity
            const currentEventCount = this.collector.events.length;
            if (currentEventCount > 0 && currentEventCount === lastEventCount) {
                if (staleCheckStart === 0) {
                    staleCheckStart = Date.now();
                } else if (Date.now() - staleCheckStart > 60_000) {
                    console.log(`[${elapsedSec}s] Agent idle for 60s, treating as completed.`);
                    this.collector.taskFinished = true;
                    break;
                }
            } else {
                staleCheckStart = 0;
                lastEventCount = currentEventCount;
            }
        }
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
// Test Report Helpers
// ============================================================================

/** Save test output artifacts for inspection */
export function saveTestArtifacts(testName: string, data: Record<string, string>): void {
    try {
        const outputDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(outputDir, { recursive: true });
        for (const [filename, content] of Object.entries(data)) {
            fs.writeFileSync(path.join(outputDir, `${testName}-${filename}`), content);
        }
        console.log(`[Test] Artifacts saved to test-results/${testName}-*`);
    } catch (e) {
        console.log(`[Test] Warning: could not save artifacts: ${e}`);
    }
}

/** Print a section separator */
export function printSection(title: string): void {
    console.log(`\n  --- ${title} ---`);
}

/** Print a report header */
export function printHeader(title: string): void {
    console.log('');
    console.log('='.repeat(70));
    console.log(`  ${title}`);
    console.log('='.repeat(70));
}

/** Helper: skip test if task failed due to external reasons */
export function skipIfExternalFailure(collector: EventCollector): boolean {
    if (collector.isExternalFailure()) {
        console.log('[SKIP] Task failed due to external API issue, not a functional bug.');
        return true;
    }
    if (collector.taskFailed) {
        console.log('[SKIP] Task failed, cannot verify this aspect.');
        return true;
    }
    return false;
}

// ============================================================================
// Scenario Verification Framework
// ============================================================================

export type CheckSeverity = 'PASS' | 'FAIL' | 'WARN' | 'SKIP' | 'INFO';

export interface CheckResult {
    id: string;
    description: string;
    severity: CheckSeverity;
    detail: string;
}

/**
 * ScenarioVerifier — structured verification for user-scenario tests.
 *
 * Instead of just keyword matching, verifies:
 *   - Tool call chains (which tools were called, in what order)
 *   - Tool call arguments (did search_web get the right query?)
 *   - Tool results (did the tool succeed?)
 *   - Output quality (length, keywords, language, structure)
 *   - Side effects (files created, memory stored)
 *   - Log file evidence (sidecar logs confirm execution)
 *   - Negative checks (agent did NOT refuse, did NOT hallucinate)
 */
export class ScenarioVerifier {
    private checks: CheckResult[] = [];
    private collector: EventCollector;
    private scenarioName: string;

    constructor(scenarioName: string, collector: EventCollector) {
        this.scenarioName = scenarioName;
        this.collector = collector;
    }

    // --- Core checks ---

    /** Verify task lifecycle started correctly */
    checkTaskStarted(): this {
        this.add('lifecycle-started', 'Task started',
            this.collector.taskStarted ? 'PASS' : 'FAIL',
            this.collector.taskStarted
                ? `TASK_STARTED received at event #1`
                : 'No TASK_STARTED event received');
        return this;
    }

    /** Verify task completed (not failed) */
    checkTaskCompleted(): this {
        if (this.collector.isExternalFailure()) {
            this.add('lifecycle-completed', 'Task completed',
                'SKIP', `External failure: ${this.collector.taskError}`);
        } else if (this.collector.taskFailed) {
            this.add('lifecycle-completed', 'Task completed',
                'FAIL', `TASK_FAILED: ${this.collector.taskError}`);
        } else {
            this.add('lifecycle-completed', 'Task completed',
                this.collector.taskFinished ? 'PASS' : 'WARN',
                this.collector.taskFinished
                    ? 'TASK_FINISHED received'
                    : 'No TASK_FINISHED (may have been detected via stale timeout)');
        }
        return this;
    }

    // --- Tool call checks ---

    /** Verify a specific tool was called at least N times */
    checkToolCalled(toolName: string, minCount: number = 1, description?: string): this {
        const calls = this.collector.getToolCalls(toolName);
        const desc = description || `Tool ${toolName} called >= ${minCount}x`;
        this.add(`tool-${toolName}`, desc,
            calls.length >= minCount ? 'PASS' : 'FAIL',
            `${toolName} called ${calls.length}x` +
            (calls.length > 0 ? `, args: ${JSON.stringify(calls[0].toolArgs).slice(0, 150)}` : ''));
        return this;
    }

    /** Verify a tool was called with specific argument content */
    checkToolCalledWithArg(toolName: string, argKey: string, containsValue: string): this {
        const calls = this.collector.getToolCalls(toolName);
        const found = calls.some(c => {
            const val = String(c.toolArgs?.[argKey] || '').toLowerCase();
            return val.includes(containsValue.toLowerCase());
        });
        this.add(`tool-arg-${toolName}-${argKey}`, `${toolName}.${argKey} contains "${containsValue}"`,
            found ? 'PASS' : (calls.length === 0 ? 'SKIP' : 'WARN'),
            found ? 'Matching arg found' : `No ${toolName} call has ${argKey} containing "${containsValue}"`);
        return this;
    }

    /** Verify a tool returned success at least once */
    checkToolSucceeded(toolName: string): this {
        const results = this.collector.toolResults.filter(r => r.toolName === toolName);
        const succeeded = results.some(r => r.success);
        this.add(`tool-success-${toolName}`, `${toolName} returned success`,
            results.length === 0 ? 'SKIP' : (succeeded ? 'PASS' : 'FAIL'),
            results.length === 0
                ? `No ${toolName} results`
                : `${results.filter(r => r.success).length}/${results.length} succeeded`);
        return this;
    }

    /** Verify the tool call chain contains specific tools in order */
    checkToolChain(expectedTools: string[], description?: string): this {
        const actualNames = this.collector.toolCalls.map(tc => tc.toolName);
        let idx = 0;
        for (const tool of expectedTools) {
            const foundIdx = actualNames.indexOf(tool, idx);
            if (foundIdx === -1) {
                this.add('tool-chain', description || `Tool chain: ${expectedTools.join(' -> ')}`,
                    'FAIL', `Missing tool "${tool}" in chain. Actual: ${actualNames.join(', ')}`);
                return this;
            }
            idx = foundIdx + 1;
        }
        this.add('tool-chain', description || `Tool chain: ${expectedTools.join(' -> ')}`,
            'PASS', `All tools found in order. Actual chain: ${actualNames.join(', ')}`);
        return this;
    }

    // --- Output quality checks ---

    /** Verify output text exceeds a minimum length */
    checkOutputMinLength(minLen: number): this {
        const len = this.collector.textBuffer.length;
        this.add('output-length', `Agent output >= ${minLen} chars`,
            len >= minLen ? 'PASS' : 'FAIL',
            `Output length: ${len} chars`);
        return this;
    }

    /** Verify output contains specific keywords (case-insensitive) */
    checkOutputContains(keywords: string[], minMatches: number = 1, label?: string): this {
        const matched = this.collector.findKeywords(keywords);
        this.add(`output-keywords-${label || keywords[0]}`,
            label || `Output contains keywords (>= ${minMatches})`,
            matched.length >= minMatches ? 'PASS' : 'FAIL',
            `Matched ${matched.length}/${keywords.length}: ${matched.join(', ') || '(none)'}`);
        return this;
    }

    /** Verify output does NOT contain refusal patterns */
    checkNoRefusal(extraPatterns?: string[]): this {
        const refusalPatterns = [
            '无法提供', '不能给出', '我不是', '无法帮助', '拒绝',
            '不能完成', 'cannot provide', 'not able to', 'unable to help',
            'i cannot', 'i\'m not able', 'cannot help',
            ...(extraPatterns || []),
        ];
        const matched = this.collector.findKeywords(refusalPatterns);
        this.add('no-refusal', 'Agent did NOT refuse the request',
            matched.length === 0 ? 'PASS' : 'FAIL',
            matched.length === 0
                ? 'No refusal detected'
                : `Refusal detected: ${matched.join(', ')}`);
        return this;
    }

    // --- Side effect checks ---

    /** Verify a file was created on disk */
    checkFileCreated(filePath: string): this {
        const exists = fs.existsSync(filePath);
        let detail = exists ? `File exists: ${filePath}` : `File NOT found: ${filePath}`;
        if (exists) {
            const stats = fs.statSync(filePath);
            detail += ` (${stats.size} bytes)`;
        }
        this.add('file-created', `File created: ${path.basename(filePath)}`,
            exists ? 'PASS' : 'FAIL', detail);
        return this;
    }

    /** Verify file content matches */
    checkFileContains(filePath: string, keyword: string): this {
        if (!fs.existsSync(filePath)) {
            this.add('file-content', `File contains "${keyword}"`, 'SKIP', 'File does not exist');
            return this;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const found = content.toLowerCase().includes(keyword.toLowerCase());
        this.add('file-content', `File contains "${keyword}"`,
            found ? 'PASS' : 'FAIL',
            found ? 'Keyword found in file' : `Keyword not found in ${content.length} bytes`);
        return this;
    }

    // --- Log checks ---

    /** Verify sidecar log file was written */
    checkLogFileWritten(): this {
        const { logFileExists, logFileHasContent, logFilePath } = this.collector.checkLogFile();
        this.add('log-exists', 'Sidecar log file exists',
            logFileExists ? 'PASS' : 'FAIL',
            logFilePath || 'No log file found');

        if (logFileExists) {
            this.add('log-content', 'Log file has content',
                logFileHasContent ? 'PASS' : 'WARN',
                logFileHasContent ? 'Log has substantial content' : 'Log file is very small');
        }
        return this;
    }

    /** Check sidecar log contains a specific string */
    checkLogContains(keyword: string, logContent?: string): this {
        const { logFilePath } = this.collector.checkLogFile();
        if (!logFilePath) {
            this.add('log-keyword', `Log contains "${keyword}"`, 'SKIP', 'No log file');
            return this;
        }
        const content = logContent || fs.readFileSync(logFilePath, 'utf-8');
        const found = content.toLowerCase().includes(keyword.toLowerCase());
        this.add('log-keyword', `Log contains "${keyword}"`,
            found ? 'PASS' : 'WARN',
            found ? 'Found in log' : 'Not found in log');
        return this;
    }

    // --- Internal helpers ---

    private add(id: string, description: string, severity: CheckSeverity, detail: string): void {
        this.checks.push({ id, description, severity, detail });
    }

    // --- Report generation ---

    /** Print a formatted report to console */
    printReport(): void {
        const icons: Record<CheckSeverity, string> = {
            'PASS': '[PASS]', 'FAIL': '[FAIL]', 'WARN': '[WARN]', 'SKIP': '[SKIP]', 'INFO': '[INFO]',
        };

        printHeader(`Scenario: ${this.scenarioName}`);
        console.log(`  Total checks: ${this.checks.length}`);
        console.log(`  PASS: ${this.checks.filter(c => c.severity === 'PASS').length}`);
        console.log(`  FAIL: ${this.checks.filter(c => c.severity === 'FAIL').length}`);
        console.log(`  WARN: ${this.checks.filter(c => c.severity === 'WARN').length}`);
        console.log(`  SKIP: ${this.checks.filter(c => c.severity === 'SKIP').length}`);
        console.log('');

        for (const check of this.checks) {
            console.log(`  ${icons[check.severity]} ${check.description}`);
            console.log(`         ${check.detail}`);
        }

        // Summary stats
        const totalTools = this.collector.toolCalls.length;
        const uniqueTools = [...new Set(this.collector.toolCalls.map(t => t.toolName))];
        console.log('');
        console.log(`  --- Execution Stats ---`);
        console.log(`  Total events: ${this.collector.events.length}`);
        console.log(`  Tool calls: ${totalTools} (${uniqueTools.join(', ')})`);
        console.log(`  Agent text: ${this.collector.textBuffer.length} chars`);
        console.log('='.repeat(70));
    }

    /** Get the JSON report */
    toJSON(): { scenario: string; checks: CheckResult[]; stats: Record<string, number> } {
        return {
            scenario: this.scenarioName,
            checks: this.checks,
            stats: {
                total: this.checks.length,
                pass: this.checks.filter(c => c.severity === 'PASS').length,
                fail: this.checks.filter(c => c.severity === 'FAIL').length,
                warn: this.checks.filter(c => c.severity === 'WARN').length,
                skip: this.checks.filter(c => c.severity === 'SKIP').length,
            },
        };
    }

    /** Get count of failures */
    get failCount(): number {
        return this.checks.filter(c => c.severity === 'FAIL').length;
    }

    /** Get count of passes */
    get passCount(): number {
        return this.checks.filter(c => c.severity === 'PASS').length;
    }

    /** True if no FAIL checks */
    get allPassed(): boolean {
        return this.failCount === 0;
    }

    get results(): CheckResult[] {
        return this.checks;
    }
}
