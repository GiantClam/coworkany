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
const OPENAI_COMPATIBLE_PROFILE_PROVIDERS = new Set([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toNonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeOpenAiBaseUrl(value: string | null): string | null {
    if (!value) {
        return null;
    }
    if (value.endsWith('/chat/completions')) {
        return value.slice(0, -'/chat/completions'.length);
    }
    return value.replace(/\/+$/u, '');
}

function withModelPrefix(provider: string, model: string | null): string | null {
    if (!model) {
        return null;
    }
    if (model.includes('/')) {
        return model;
    }
    return `${provider}/${model}`;
}

function resolveLlmConfigCandidatePaths(cwd: string): string[] {
    const candidates = [
        path.join(cwd, 'llm-config.json'),
    ];
    const appDataDir = toNonEmpty(process.env.COWORKANY_APP_DATA_DIR);
    if (appDataDir) {
        candidates.push(path.join(appDataDir, 'llm-config.json'));
    }
    const home = toNonEmpty(process.env.HOME);
    if (home) {
        candidates.push(path.join(home, 'Library', 'Application Support', 'com.coworkany.desktop', 'llm-config.json'));
    }
    return Array.from(new Set(candidates));
}

function resolveHarnessProviderEnv(cwd: string): NodeJS.ProcessEnv {
    for (const configPath of resolveLlmConfigCandidatePaths(cwd)) {
        if (!fs.existsSync(configPath)) {
            continue;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
            const root = toRecord(parsed);
            const provider = toNonEmpty(root.provider)?.toLowerCase();
            if (!provider) {
                continue;
            }
            const seeded: NodeJS.ProcessEnv = {
                COWORKANY_LLM_CONFIG_PROVIDER: provider,
            };
            if (provider === 'anthropic') {
                const config = toRecord(root.anthropic);
                const apiKey = toNonEmpty(config.apiKey);
                const modelId = withModelPrefix('anthropic', toNonEmpty(config.model));
                if (apiKey) {
                    seeded.ANTHROPIC_API_KEY = apiKey;
                }
                if (modelId) {
                    seeded.COWORKANY_MODEL = modelId;
                }
                return seeded;
            }
            if (provider === 'custom') {
                const config = toRecord(root.custom);
                const apiFormat = toNonEmpty(config.apiFormat)?.toLowerCase() ?? 'openai';
                seeded.COWORKANY_LLM_CUSTOM_API_FORMAT = apiFormat;
                const apiKey = toNonEmpty(config.apiKey);
                const baseUrl = normalizeOpenAiBaseUrl(toNonEmpty(config.baseUrl));
                if (apiFormat === 'anthropic') {
                    const modelId = withModelPrefix('anthropic', toNonEmpty(config.model));
                    if (apiKey) {
                        seeded.ANTHROPIC_API_KEY = apiKey;
                    }
                    if (modelId) {
                        seeded.COWORKANY_MODEL = modelId;
                    }
                } else {
                    const modelId = withModelPrefix('openai', toNonEmpty(config.model));
                    if (apiKey) {
                        seeded.OPENAI_API_KEY = apiKey;
                    }
                    if (baseUrl) {
                        seeded.OPENAI_BASE_URL = baseUrl;
                    }
                    if (modelId) {
                        seeded.COWORKANY_MODEL = modelId;
                    }
                }
                return seeded;
            }
            if (OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(provider)) {
                const config = toRecord(root.openai);
                const apiKey = toNonEmpty(config.apiKey);
                const baseUrl = normalizeOpenAiBaseUrl(toNonEmpty(config.baseUrl));
                const modelId = withModelPrefix('openai', toNonEmpty(config.model));
                if (apiKey) {
                    seeded.OPENAI_API_KEY = apiKey;
                }
                if (baseUrl) {
                    seeded.OPENAI_BASE_URL = baseUrl;
                }
                if (modelId) {
                    seeded.COWORKANY_MODEL = modelId;
                }
                return seeded;
            }
            return seeded;
        } catch {
            // continue loading the next candidate path
        }
    }
    return {};
}

function resolveHarnessBunExecutable(): string {
    const envOverride = toNonEmpty(process.env.COWORKANY_TEST_BUN_BIN);
    if (envOverride) {
        return envOverride;
    }

    const runtimeExecPath = toNonEmpty(process.execPath);
    if (runtimeExecPath && path.basename(runtimeExecPath).toLowerCase().includes('bun')) {
        try {
            return fs.realpathSync(runtimeExecPath);
        } catch {
            return runtimeExecPath;
        }
    }

    const bunWhich = typeof Bun !== 'undefined' && typeof Bun.which === 'function'
        ? toNonEmpty(Bun.which('bun') ?? null)
        : null;
    if (bunWhich) {
        try {
            return fs.realpathSync(bunWhich);
        } catch {
            return bunWhich;
        }
    }

    return 'bun';
}

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
    disabledTools?: string[];
    workspacePath?: string;
    modelId?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
}): string {
    const modelId = opts.modelId || process.env.TEST_MODEL_ID || process.env.COWORKANY_MODEL;
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
                disabledTools: opts.disabledTools || [],
                modelId,
                requireToolApproval: opts.requireToolApproval ?? false,
                autoResumeSuspendedTools: opts.autoResumeSuspendedTools ?? true,
            },
        },
    });
}

export function buildSendTaskMessageCommand(opts: {
    taskId: string;
    content: string;
    disabledTools?: string[];
}): string {
    return JSON.stringify({
        type: 'send_task_message',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId: opts.taskId,
            content: opts.content,
            config: {
                disabledTools: opts.disabledTools || [],
            },
        },
    });
}

export function buildBootstrapRuntimeContextCommand(opts: {
    appDataDir: string;
    appDir?: string;
    shell?: string;
}): string {
    return JSON.stringify({
        type: 'bootstrap_runtime_context',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            runtimeContext: {
                platform: process.platform,
                arch: process.arch,
                appDir: opts.appDir || process.cwd(),
                appDataDir: opts.appDataDir,
                shell: opts.shell || process.env.SHELL || '/bin/zsh',
                python: { available: false },
                skillhub: { available: false },
                managedServices: [],
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
    taskFinishedByEvent = false;
    taskFailed = false;
    taskError: string | null = null;
    idleTimeoutReached = false;
    private recentToolCallEvents = new Map<string, number>();
    private recentToolResultEvents = new Map<string, number>();
    private readonly duplicateWindowMs = 600;

    private normalizeToolName(toolName: string): string {
        const legacyMap: Record<string, string> = {
            mastra_workspace_read_file: 'view_file',
            mastra_workspace_write_file: 'write_to_file',
            mastra_workspace_replace_in_file: 'replace_file_content',
            mastra_workspace_list_directory: 'list_dir',
            mastra_workspace_list_files: 'list_dir',
            mastra_workspace_execute_command: 'run_command',
            mastra_workspace_edit_file: 'replace_file_content',
            mastra_workspace_move_path: 'move_file',
            mastra_workspace_delete_path: 'delete_path',
        };
        return legacyMap[toolName] ?? toolName;
    }

    private normalizeTimestampMs(timestamp?: string): number {
        if (typeof timestamp === 'string' && timestamp.trim().length > 0) {
            const parsed = Date.parse(timestamp);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return Date.now();
    }

    private normalizeForFingerprint(value: unknown): string {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private isDuplicate(
        cache: Map<string, number>,
        fingerprint: string,
        timestampMs: number,
    ): boolean {
        const previous = cache.get(fingerprint);
        cache.set(fingerprint, timestampMs);
        for (const [key, ts] of cache.entries()) {
            if (timestampMs - ts > this.duplicateWindowMs * 4) {
                cache.delete(key);
            }
        }
        if (typeof previous !== 'number') {
            return false;
        }
        return timestampMs - previous <= this.duplicateWindowMs;
    }

    private recordToolCall(rawToolName: string, toolArgs: Record<string, any>, timestamp?: string): void {
        const toolName = this.normalizeToolName(rawToolName);
        const timestampMs = this.normalizeTimestampMs(timestamp);
        const fingerprint = `call|${toolName}|${this.normalizeForFingerprint(toolArgs)}`;
        if (this.isDuplicate(this.recentToolCallEvents, fingerprint, timestampMs)) {
            return;
        }
        this.toolCalls.push({
            toolName,
            toolArgs,
            timestamp: typeof timestamp === 'string' ? timestamp : new Date(timestampMs).toISOString(),
        });
        const ts = new Date().toLocaleTimeString();
        const argsStr = JSON.stringify(toolArgs).slice(0, 300);
        console.log(`[${ts}] TOOL_CALL: ${toolName} - ${argsStr}`);
    }

    private recordToolResult(
        rawToolName: string | undefined,
        isError: boolean,
        resultValue: unknown,
        timestamp?: string,
    ): void {
        const toolName = rawToolName ? this.normalizeToolName(rawToolName) : undefined;
        const timestampMs = this.normalizeTimestampMs(timestamp);
        const fingerprint = `result|${toolName ?? 'unknown'}|${isError ? 'error' : 'ok'}|${this.normalizeForFingerprint(resultValue)}`;
        if (this.isDuplicate(this.recentToolResultEvents, fingerprint, timestampMs)) {
            return;
        }
        this.toolResults.push({
            toolName,
            success: !isError,
            result: resultValue,
            timestamp: typeof timestamp === 'string' ? timestamp : new Date(timestampMs).toISOString(),
        });
        const ts = new Date().toLocaleTimeString();
        const icon = isError ? 'FAIL' : 'OK';
        console.log(`[${ts}] TOOL_RESULT [${icon}]${toolName ? ` (${toolName})` : ''}: ${String(resultValue).slice(0, 300)}`);
    }

    private processRuntimeTaskEvent(payload: Record<string, any>): void {
        const runtimeType = typeof payload.type === 'string' ? payload.type : '';
        if (!runtimeType) {
            return;
        }
        switch (runtimeType) {
            case 'text_delta': {
                const delta = typeof payload.content === 'string'
                    ? payload.content
                    : typeof payload.delta === 'string'
                        ? payload.delta
                        : '';
                this.textBuffer += delta;
                break;
            }
            case 'tool_call': {
                const rawToolName = typeof payload.toolName === 'string'
                    ? payload.toolName
                    : typeof payload.name === 'string'
                        ? payload.name
                        : 'unknown';
                const toolArgs = (payload.args && typeof payload.args === 'object')
                    ? payload.args as Record<string, any>
                    : (payload.input && typeof payload.input === 'object')
                        ? payload.input as Record<string, any>
                        : {};
                this.recordToolCall(rawToolName, toolArgs, payload.timestamp);
                break;
            }
            case 'tool_result': {
                const rawToolName = typeof payload.toolName === 'string'
                    ? payload.toolName
                    : typeof payload.name === 'string'
                        ? payload.name
                        : undefined;
                const isError = payload.isError === true;
                const resultValue = payload.result ?? payload.resultSummary ?? '';
                this.recordToolResult(rawToolName, isError, resultValue, payload.timestamp);
                break;
            }
            case 'error': {
                this.taskFailed = true;
                const message = typeof payload.message === 'string'
                    ? payload.message
                    : 'Unknown runtime error';
                this.taskError = message;
                break;
            }
            case 'complete': {
                this.taskFinished = true;
                this.taskFinishedByEvent = true;
                break;
            }
            default:
                break;
        }
    }

    processEvent(event: TaskEvent): void {
        this.events.push(event);
        const ts = new Date().toLocaleTimeString();

        switch (event.type) {
            case 'TASK_EVENT': {
                this.processRuntimeTaskEvent(event.payload || {});
                break;
            }
            case 'TASK_STARTED':
                this.taskStarted = true;
                console.log(`[${ts}] TASK_STARTED: ${event.payload?.title || 'untitled'}`);
                break;

            case 'TEXT_DELTA':
                this.textBuffer += event.payload?.delta || '';
                break;

            case 'TOOL_CALL': {
                const rawToolName = typeof event.payload?.name === 'string'
                    ? event.payload.name
                    : 'unknown';
                const toolArgs = (event.payload?.input && typeof event.payload.input === 'object')
                    ? event.payload.input as Record<string, any>
                    : {};
                this.recordToolCall(rawToolName, toolArgs, event.timestamp);
                break;
            }

            case 'TOOL_RESULT': {
                const rawToolName = typeof event.payload?.name === 'string'
                    ? event.payload.name
                    : undefined;
                const isError = event.payload?.isError === true;
                const resultValue = event.payload?.result || event.payload?.resultSummary || '';
                this.recordToolResult(rawToolName, isError, resultValue, event.timestamp);
                break;
            }

            case 'TASK_FINISHED':
                this.taskFinished = true;
                this.taskFinishedByEvent = true;
                console.log(`[${ts}] TASK_FINISHED: ${event.payload?.summary || 'completed'}`);
                break;

            case 'TASK_FAILED':
                this.taskFailed = true;
                this.taskError = event.payload?.error || 'Unknown error';
                console.log(`[${ts}] TASK_FAILED: ${this.taskError}`);
                break;

            case 'tool_call':
            case 'tool_result':
            case 'text_delta':
            case 'error':
            case 'complete':
                this.processRuntimeTaskEvent({
                    ...event.payload,
                    type: event.type,
                    timestamp: event.timestamp,
                });
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
        const toolResultTexts = this.toolResults
            .map((r) => {
                if (typeof r.result === 'string') {
                    return r.result;
                }
                try {
                    return JSON.stringify(r.result);
                } catch {
                    return String(r.result);
                }
            })
            .join('\n');
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
        const externalPatterns = [
            '401',
            '402',
            '403',
            'rate_limit',
            'quota',
            'billing',
            'insufficient_funds',
            'unauthorized',
            '无效的令牌',
        ];
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
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;

    constructor(
        collector?: EventCollector,
        options?: {
            cwd?: string;
            env?: NodeJS.ProcessEnv;
        }
    ) {
        this.collector = collector || new EventCollector();
        const requestedCwd = options?.cwd || process.cwd();
        this.cwd = fs.existsSync(requestedCwd) ? requestedCwd : process.cwd();
        const seededProviderEnv = resolveHarnessProviderEnv(this.cwd);
        this.env = {
            ...seededProviderEnv,
            ...process.env,
            COWORKANY_DISABLE_SCHEDULER: options?.env?.COWORKANY_DISABLE_SCHEDULER
                ?? process.env.COWORKANY_DISABLE_SCHEDULER
                ?? '1',
            ...(options?.env || {}),
        };
    }

    async start(): Promise<void> {
        console.log('[SIDECAR] Spawning sidecar process...');
        const bunExecutable = resolveHarnessBunExecutable();

        this.proc = spawn({
            cmd: [bunExecutable, 'run', 'src/main.ts'],
            cwd: this.cwd,
            env: this.env,
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

    resetCollector(collector?: EventCollector): EventCollector {
        this.collector = collector || new EventCollector();
        return this.collector;
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

            // Stale detection: if no new events for 60s after initial activity.
            // IMPORTANT: if task is suspended awaiting user collaboration, do not
            // auto-mark as finished. Let caller timeout or explicitly resume.
            const currentEventCount = this.collector.events.length;
            if (currentEventCount > 0 && currentEventCount === lastEventCount) {
                if (staleCheckStart === 0) {
                    staleCheckStart = Date.now();
                } else if (Date.now() - staleCheckStart > 60_000) {
                    const lastSuspended = [...this.collector.events]
                        .reverse()
                        .find(e => e.type === 'TASK_SUSPENDED');
                    const lastResumed = [...this.collector.events]
                        .reverse()
                        .find(e => e.type === 'TASK_RESUMED');
                    const isWaitingForCollab = !!lastSuspended &&
                        (!lastResumed || new Date(lastSuspended.timestamp).getTime() > new Date(lastResumed.timestamp).getTime());

                    if (isWaitingForCollab) {
                        console.log(`[${elapsedSec}s] Agent idle but task is suspended, still waiting for user collaboration...`);
                        staleCheckStart = Date.now();
                    } else {
                        console.log(`[${elapsedSec}s] Agent idle for 60s, treating as stalled (no terminal event).`);
                        this.collector.idleTimeoutReached = true;
                        break;
                    }
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
        
        // Check if failure was due to external service issues (not code bug)
        const hasExternalFailure = results.some(r => {
            const resultStr = String(r.result || '');
            return resultStr.includes('401') || 
                   resultStr.includes('403') || 
                   resultStr.includes('429') ||
                   resultStr.includes('rate_limit') ||
                   resultStr.includes('quota') ||
                   resultStr.includes('exhausted') ||
                   resultStr.includes('Unauthorized');
        });
        
        const status = results.length === 0 
            ? 'SKIP' 
            : (succeeded ? 'PASS' : (hasExternalFailure ? 'WARN' : 'FAIL'));
        
        this.add(`tool-success-${toolName}`, `${toolName} returned success`,
            status,
            results.length === 0
                ? `No ${toolName} results`
                : `${results.filter(r => r.success).length}/${results.length} succeeded` +
                  (hasExternalFailure ? ' (external service error)' : ''));
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
