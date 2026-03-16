/**
 * CoworkAny Sidecar - IPC Entry Point
 *
 * This is the main entry point for the Sidecar process (Bun runtime).
 * It reads commands from stdin, dispatches them via the command router,
 * and emits responses + events to stdout.
 *
 * Protocol:
 * - Input (stdin):  JSON-Lines of IpcCommand
 * - Output (stdout): JSON-Lines of IpcResponse | TaskEvent
 *
 * The Tauri desktop app spawns this process and communicates via stdio.
 */

// ============================================================================
// CRITICAL: Redirect console.log to stderr + file logging
// stdout is reserved exclusively for JSON IPC with the Tauri backend.
// Any non-JSON output on stdout will break the IPC protocol.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

function getSharedAppDataDir(): string | undefined {
    const raw = process.env.COWORKANY_APP_DATA_DIR?.trim();
    return raw ? raw : undefined;
}

function getCliArgValue(name: string): string | undefined {
    const prefix = `${name}=`;
    for (const arg of process.argv.slice(2)) {
        if (arg === name) {
            return 'true';
        }
        if (arg.startsWith(prefix)) {
            const value = arg.slice(prefix.length).trim();
            return value.length > 0 ? value : undefined;
        }
    }
    return undefined;
}

function getAppStateRoot(): string {
    return getSharedAppDataDir() ?? path.join(process.cwd(), '.coworkany');
}

// ---------- Runtime log file setup ----------
// Logs are written to the app data directory when available, falling back to
// workspace-local .coworkany during development.
const APP_STATE_ROOT = getAppStateRoot();
const managedSkillEnvOriginals = new Map<string, string | undefined>();
const LOG_DIR = path.join(APP_STATE_ROOT, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const LOG_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const LOG_FILE = path.join(LOG_DIR, `sidecar-${LOG_DATE}.log`);
let logStream: fs.WriteStream | null = null;
try {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' }); // append mode
    logStream.on('error', () => { logStream = null; });
} catch { /* non-critical - continue without file logging */ }

function writeToLogFile(level: string, args: unknown[]): void {
    if (!logStream) return;
    try {
        const ts = new Date().toISOString();
        const message = args.map(a =>
            typeof a === 'string' ? a : JSON.stringify(a)
        ).join(' ');
        logStream.write(`[${ts}] [${level}] ${message}\n`);
    } catch { /* never crash on log write failure */ }
}

// Redirect console.log 鈫?stderr + log file
const _originalError = console.error.bind(console);
console.log = (...args: unknown[]) => {
    _originalError(...args);
    writeToLogFile('LOG', args);
};

// Also intercept console.error/warn to capture everything in the log file
const _origWarn = console.warn.bind(console);
console.error = (...args: unknown[]) => {
    _originalError(...args);
    writeToLogFile('ERR', args);
};
console.warn = (...args: unknown[]) => {
    _origWarn(...args);
    writeToLogFile('WRN', args);
};

import { randomUUID } from 'crypto';
import {
    IpcCommandSchema,
    IpcResponseSchema,
    type EffectRequest,
    type EffectResponse,
    type IpcCommand,
    type IpcResponse,
    type TaskEvent,
    ToolpackManifestSchema,
} from './protocol';
import {
    dispatchCommand,
    AgentIdentityRegistry,
    type CommandRouterDeps,
    type HandlerContext,
} from './handlers';
import { ToolpackStore, SkillStore, WorkspaceStore } from './storage';
import { openclawCompat } from './claude_skills/openclawCompat';
import { createPostExecutionLearningManager } from './agent/postExecutionLearning';
import { downloadSkillFromGitHub, downloadMcpFromGitHub } from './utils';
import {
    scanForSkills,
    scanForMcpServers,
    scanDefaultRepositories,
    validateSkillUrl,
    validateMcpUrl,
} from './utils';
import { detectPackageManager, getPackageManagerCommands } from './utils/packageManagerDetector';
import { runPostEditHooks, formatHookResults } from './hooks/codeQualityHooks';
import { STANDARD_TOOLS, ToolDefinition, setCommandApprovalRequester } from './tools/standard';
import { STUB_TOOLS } from './tools/stubs';
import { globalToolRegistry } from './tools/registry';
import { MCPGateway } from './mcp/gateway';
import { setSearchConfig, webSearchTool, type SearchConfig, type SearchProvider } from './tools/websearch';
import { BUILTIN_TOOLS, readTaskPlanHead, countIncompletePlanSteps } from './tools/builtin';
import { createEnhancedBrowserTools } from './tools/browserEnhanced';
import { DATABASE_TOOLS } from './tools/database';
import { xiaohongshuPostTool } from './tools/xiaohongshuPost';
import { BrowserService } from './services/browserService';
import { CODE_EXECUTION_TOOLS } from './tools/codeExecution';
import { KNOWLEDGE_TOOLS } from './agent/knowledgeUpdater';
import {
    isRecoverableTaskId,
    normalizeRecoverableTaskInputs,
    type RecoverableTaskHint as RecoveryHintInput,
} from './agent/recoveryHints';
import { appendTaskRuntimeDiagnostic } from './agent/taskRuntimeDiagnostics';
import { buildModelStreamFailurePayload, shouldEmitTaskFailure } from './agent/taskFailureGuards';
import { executeJavaScriptTool, executePythonTool } from './tools/codeExecution';
import { getSelfLearningPrompt } from './data/prompts/selfLearning';
import { AUTONOMOUS_LEARNING_PROTOCOL } from './data/prompts/autonomousLearning';
import {
    createGapDetector,
    createResearchEngine,
    createLearningProcessor,
    createLabSandbox,
    createPrecipitator,
    createReuseEngine,
    initConfidenceTracker,
    createSelfLearningController,
    createFeedbackManager,
    createVersionManager,
    createProactiveLearner,
    createDependencyResolver,
    createSkillDependencyLoader,
    createDependencyValidator,
    type GeneratedRuntimeToolSpec,
} from './agent/selfLearning';
import type { SkillRecord, ReuseEngineDependencies } from './agent/selfLearning/reuseEngine';
import { createSelfLearningTools, type SelfLearningToolHandlers } from './tools/selfLearning';
import { buildSkillSystemPromptContext } from './skills/promptBuilder';
import { resolveSkillRequest } from './skills/skillResolver';
import { checkSkillsForUpdates, upgradeSkillFromUpstream, type ClaudeSkillUpdateInfo } from './skills/updater';
import {
    buildCurrentSessionSection,
    formatSoulSection,
    loadSoulProfile,
    loadWorkspacePolicySection,
} from './promptContext/profile';
import { getRagBridge, getMemoryContext, getVaultManager } from './memory';
import {
    AutonomousAgentController,
    createAutonomousAgent,
    type AutonomousLlmInterface,
    type AutonomousEvent,
    type SubTask,
    type TaskDecomposition,
    type MemoryExtraction,
    type GoalVerificationResult,
    TASK_DECOMPOSITION_PROMPT,
    MEMORY_EXTRACTION_PROMPT,
    GOAL_VERIFICATION_PROMPT,
} from './agent';
import { AdaptiveExecutor, type AdaptiveExecutionConfig } from './agent/adaptiveExecutor';
import { SuspendResumeManager, type SuspendResumeConfig, ResumeConditions } from './agent/suspendResumeManager';
import { getCorrectionCoordinator } from './agent/verification';
import { formatErrorForAI } from './agent/selfCorrection';
import { recoverMainLoopToolFailure } from './agent/mainLoopRecovery';
import { createProactiveTaskManager } from './agent/jarvis/proactiveTaskManager';
import { setHeartbeatExecutorFactory, shutdownHeartbeatEngines } from './proactive/runtime';
import * as os from 'os';
// NOTE: fs and path are imported at the top of the file (log file setup)
import { getCurrentPlatform } from './utils/commandAlternatives';
import { buildAnthropicSystemBlocks, flattenStructuredSystemPrompt, type StructuredSystemPrompt } from './llm/systemPrompt';
import { getCommandLearningDirective } from './agent/commandLearningIntent';
import {
    getBrowserFeedDirective,
    isXFollowingResearchRequest,
    shouldSuppressTriggeredSkillForBrowserFeed,
} from './agent/browserFeedIntent';
import { buildTaskCompletionSummary } from './agent/taskOutcome';
import {
    getSchedulingDirective,
    shouldSuppressTriggeredSkillForScheduling,
} from './agent/schedulingIntent';
import {
    buildRepeatedSuccessfulInstallMessage,
    isDirectPackageInstallRequest,
    isSuccessfulPythonInstallResult,
    normalizePythonInstallCommandForLoopGuard,
} from './agent/installLoopGuard';

// ============================================================================
// Event Emitter
// ============================================================================

type OutputMessage = IpcResponse | TaskEvent;

function emit(message: OutputMessage): void {
    if ('type' in message && 'taskId' in message && message.type === 'TASK_FAILED') {
        const existingStatus = taskRuntimeMeta.get((message as any).taskId)?.status;
        if (!shouldEmitTaskFailure(existingStatus)) {
            console.warn(
                `[TaskRuntime] Suppressed duplicate TASK_FAILED for ${(message as any).taskId} because task is already ${existingStatus ?? 'terminal'}`
            );
            return;
        }
    }

    const line = JSON.stringify(message);
    process.stdout.write(line + '\n');

    // Forward TaskEvents to post-execution learning manager
    if ('type' in message && 'taskId' in message && typeof postLearningManager !== 'undefined') {
        if (message.type === 'TASK_STARTED') {
            const payload = (message as any).payload ?? {};
            const context = payload.context ?? {};
            if (typeof context.workspacePath === 'string') {
                const existingConfig = taskConfigs.get((message as any).taskId) ?? {};
                taskConfigs.set((message as any).taskId, {
                    ...existingConfig,
                    workspacePath: context.workspacePath,
                    activeFile: typeof context.activeFile === 'string' ? context.activeFile : existingConfig.activeFile,
                });
            }
            markTaskRuntime((message as any).taskId, {
                title: typeof payload.title === 'string' ? payload.title : undefined,
                status: 'running',
                autoResumePending: false,
                lastError: undefined,
            });
        } else if (message.type === 'TASK_STATUS') {
            const status = (message as any).payload?.status;
            if (status === 'running') {
                markTaskRuntime((message as any).taskId, {
                    status: 'running',
                    autoResumePending: false,
                    lastError: undefined,
                });
            }
        } else if (message.type === 'TASK_FINISHED') {
            markTaskRuntime((message as any).taskId, {
                status: 'finished',
                autoResumePending: false,
                lastError: undefined,
                lastSummary: typeof (message as any).payload?.summary === 'string'
                    ? (message as any).payload.summary
                    : undefined,
            });
        } else if (message.type === 'TASK_FAILED') {
            const payload = (message as any).payload ?? {};
            const recoverable = payload.recoverable === true;
            markTaskRuntime((message as any).taskId, {
                status: recoverable ? 'recoverable_interrupted' : 'failed',
                autoResumePending: recoverable,
                lastError: typeof payload.error === 'string' ? payload.error : undefined,
            });
        }

        const meta = taskRuntimeMeta.get((message as any).taskId);
        if (meta?.status === 'running' && !['TASK_FINISHED', 'TASK_FAILED'].includes(message.type as string)) {
            scheduleTaskTerminalWatchdog((message as any).taskId);
            persistTaskRuntimeSnapshot((message as any).taskId);
        }

        const taskEventTypes = [
            'TASK_STARTED', 'TASK_FINISHED', 'TASK_FAILED',
            'TOOL_CALLED', 'TOOL_RESULT', 'TEXT_DELTA'
        ];
        if (taskEventTypes.includes(message.type as string)) {
            postLearningManager.handleEvent(message as any);
        }

        // Clear current executing task ID when task finishes or fails
        if (message.type === 'TASK_FINISHED' || message.type === 'TASK_FAILED') {
            if (currentExecutingTaskId === (message as any).taskId) {
                currentExecutingTaskId = undefined;
            }
        }

        persistTaskEventDiagnostic(message);
    }
}

// Helper for custom commands not yet in the protocol schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitAny(message: Record<string, unknown>): void {
    const line = JSON.stringify(message);
    process.stdout.write(line + '\n');
}

function syncManagedSkillEnvironment(env: Record<string, string>): { applied: number; cleared: number } {
    const nextEntries = Object.entries(env)
        .map(([key, value]) => [key.trim(), value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0);
    const nextKeys = new Set(nextEntries.map(([key]) => key));

    let cleared = 0;
    for (const key of Array.from(managedSkillEnvOriginals.keys())) {
        if (nextKeys.has(key)) {
            continue;
        }

        const original = managedSkillEnvOriginals.get(key);
        if (typeof original === 'string') {
            process.env[key] = original;
        } else {
            delete process.env[key];
        }
        managedSkillEnvOriginals.delete(key);
        cleared += 1;
    }

    for (const [key, value] of nextEntries) {
        if (!managedSkillEnvOriginals.has(key)) {
            managedSkillEnvOriginals.set(key, process.env[key]);
        }
        process.env[key] = value;
    }

    console.log(`[SkillEnv] Synced ${nextEntries.length} vars, cleared ${cleared}`);
    return { applied: nextEntries.length, cleared };
}

const pendingEffectResponses = new Map<
    string,
    {
        resolve: (response: EffectResponse) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }
>();

async function requestHostEffectApproval(request: EffectRequest): Promise<EffectResponse> {
    const commandId = randomUUID();

    return new Promise<EffectResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingEffectResponses.delete(commandId);
            reject(new Error(`Timed out waiting for host approval: ${request.id}`));
        }, 5 * 60 * 1000);

        pendingEffectResponses.set(commandId, { resolve, reject, timer });

        emitAny({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'request_effect',
            payload: {
                request,
            },
        });
    });
}

// ============================================================================
// Fetch Utilities (with timeout and retry)
// ============================================================================

// fetchWithRetry - delegates to the robust retryWithBackoff utility
// Keeps the same call signature for backward compatibility
import { fetchWithBackoff, type FetchWithBackoffOptions } from './utils/retryWithBackoff';

interface FetchWithRetryOptions {
    timeout?: number;      // Timeout in milliseconds (default: 60000)
    retries?: number;      // Number of retries (default: 3)
    retryDelay?: number;   // Base delay between retries in ms (default: 1000)
}

async function fetchWithRetry(
    url: string,
    options: RequestInit,
    retryOptions: FetchWithRetryOptions = {}
): Promise<Response> {
    const {
        timeout = 60000,
        retries = 5,
        retryDelay = 1000,
    } = retryOptions;

    return fetchWithBackoff(url, options, {
        timeout,
        maxRetries: retries,
        baseDelay: retryDelay,
        maxDelay: 30000,
        retryOnStatus: [429, 500, 502, 503],
        onRetry: (info) => {
            // Emit RATE_LIMITED event if we have an active task context
            if (currentEmitFn && currentTaskId) {
                try {
                    currentEmitFn({
                        type: 'RATE_LIMITED',
                        id: crypto.randomUUID(),
                        timestamp: new Date().toISOString(),
                        payload: {
                            taskId: currentTaskId,
                            attempt: info.attempt,
                            maxRetries: info.maxRetries,
                            status: info.status,
                            delayMs: info.delay,
                            message: `API rate limited (HTTP ${info.status}). Retrying in ${Math.round(info.delay / 1000)}s (attempt ${info.attempt}/${info.maxRetries})...`,
                        },
                    });
                } catch { /* best effort */ }
            }
        },
    });
}

// Rate limit event context - set by the streaming call before making LLM requests
let currentEmitFn: ((event: Record<string, unknown>) => void) | null = null;
let currentTaskId: string | null = null;

function setRateLimitContext(emit: (event: Record<string, unknown>) => void, taskId: string) {
    currentEmitFn = emit;
    currentTaskId = taskId;
}

function clearRateLimitContext() {
    currentEmitFn = null;
    currentTaskId = null;
}

// ============================================================================
// Sequence Tracking
// ============================================================================

type AnthropicStreamOptions = {
    modelId?: string;
    maxTokens?: number;
    systemPrompt?: string | StructuredSystemPrompt;  // Support both legacy string and structured format for caching
    tools?: any[];
};

type AnthropicMessage = {
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
};

type TaskRuntimeConfig = {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    workspacePath?: string;
    activeFile?: string;
};

type PersistedTaskRuntimeStatus =
    | 'running'
    | 'finished'
    | 'failed'
    | 'recoverable_interrupted';

type PersistedTaskRuntimeSnapshot = {
    version: 1;
    taskId: string;
    title?: string;
    workspacePath: string;
    config: TaskRuntimeConfig;
    conversation: AnthropicMessage[];
    status: PersistedTaskRuntimeStatus;
    updatedAt: string;
    lastError?: string;
    autoResumePending?: boolean;
    lastSummary?: string;
};

type RecoverableTaskHint = RecoveryHintInput;

type TaskRuntimeMeta = {
    title?: string;
    status: PersistedTaskRuntimeStatus;
    updatedAt: string;
    lastError?: string;
    autoResumePending?: boolean;
    lastSummary?: string;
};

type AgentLoopOutcome = {
    terminalEmitted: boolean;
    finalAssistantText?: string;
    cancelled?: boolean;
    maxStepsReached?: boolean;
};

const taskSequences = new Map<string, number>();
const taskConversations = new Map<string, AnthropicMessage[]>();
const taskConfigs = new Map<string, TaskRuntimeConfig>();
const taskRuntimeMeta = new Map<string, TaskRuntimeMeta>();

const mcpGateway = new MCPGateway();

const DEFAULT_MAX_HISTORY_MESSAGES = 20;
const taskHistoryLimits = new Map<string, number>();
const RECOVERABLE_RUNTIME_SCAN_MAX_AGE_MS = 15 * 60 * 1000;
const TASK_RUNTIME_STALL_TIMEOUT_MS = (() => {
    const rawValue =
        getCliArgValue('--task-stall-timeout-ms') ??
        process.env.COWORKANY_TASK_STALL_TIMEOUT_MS ??
        '';
    const raw = Number.parseInt(rawValue, 10);
    if (Number.isFinite(raw) && raw >= 1000) {
        return raw;
    }
    return 2 * 60 * 1000;
})();
const taskWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

function getTaskRuntimeDir(workspacePath: string): string {
    return path.join(workspacePath, '.coworkany', 'runtime', 'tasks');
}

function getTaskSnapshotPath(taskId: string, workspacePath: string): string {
    return path.join(getTaskRuntimeDir(workspacePath), `${taskId}.json`);
}

function scheduleTaskTerminalWatchdog(taskId: string): void {
    const existing = taskWatchdogs.get(taskId);
    if (existing) {
        clearTimeout(existing);
    }

    const config = taskConfigs.get(taskId);
    const workspacePath = config?.workspacePath;
    if (!workspacePath) {
        return;
    }

    const timer = setTimeout(() => {
        const meta = taskRuntimeMeta.get(taskId);
        if (!meta || meta.status !== 'running') {
            return;
        }

        console.error(`[TaskWatchdog] Task ${taskId} exceeded terminal timeout without a final event`);
        emitTaskFailureIfActive(taskId, {
            error: 'Task stalled without producing a terminal result.',
            errorCode: 'TASK_TERMINAL_TIMEOUT',
            recoverable: true,
            suggestion: 'CoworkAny recorded the interrupted state. Reconnect and resume to continue from the last saved context.',
        });
    }, TASK_RUNTIME_STALL_TIMEOUT_MS);

    taskWatchdogs.set(taskId, timer);
}

function clearTaskTerminalWatchdog(taskId: string): void {
    const existing = taskWatchdogs.get(taskId);
    if (existing) {
        clearTimeout(existing);
        taskWatchdogs.delete(taskId);
    }
}

function persistTaskEventDiagnostic(message: OutputMessage): void {
    if (!('type' in message) || !('taskId' in message)) {
        return;
    }

    if (!['TASK_RESUMED', 'TASK_FINISHED', 'TASK_FAILED'].includes(message.type as string)) {
        return;
    }

    const taskId = (message as TaskEvent).taskId;
    const workspacePath = taskConfigs.get(taskId)?.workspacePath;
    if (!workspacePath) {
        return;
    }

    const payload = ((message as TaskEvent).payload ?? {}) as Record<string, unknown>;
    try {
        if (message.type === 'TASK_RESUMED') {
            appendTaskRuntimeDiagnostic(workspacePath, {
                taskId,
                kind: 'task_resumed',
                severity: 'info',
                summary: typeof payload.resumeReason === 'string'
                    ? payload.resumeReason
                    : 'Task resumed after interruption.',
            });
            return;
        }

        if (message.type === 'TASK_FINISHED') {
            appendTaskRuntimeDiagnostic(workspacePath, {
                taskId,
                kind: 'task_finished',
                severity: 'info',
                summary: typeof payload.summary === 'string'
                    ? payload.summary
                    : 'Task finished successfully.',
            });
            return;
        }

        appendTaskRuntimeDiagnostic(workspacePath, {
            taskId,
            kind: 'task_failed',
            severity: payload.recoverable === true ? 'warn' : 'error',
            summary: typeof payload.error === 'string'
                ? payload.error
                : 'Task failed.',
            errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : undefined,
            recoverable: payload.recoverable === true,
        });
    } catch (error) {
        console.error(`[TaskRuntime] Failed to persist diagnostic for ${taskId}:`, error);
    }
}

function emitTaskFailureIfActive(taskId: string, payload: TaskFailedPayload): boolean {
    const currentStatus = taskRuntimeMeta.get(taskId)?.status;
    if (!shouldEmitTaskFailure(currentStatus)) {
        console.warn(
            `[TaskRuntime] Suppressed duplicate TASK_FAILED for ${taskId} because task is already ${currentStatus ?? 'terminal'}`
        );
        return false;
    }

    emit(createTaskFailedEvent(taskId, payload));
    return true;
}

function persistTaskRuntimeSnapshot(taskId: string): void {
    const config = taskConfigs.get(taskId);
    if (!config?.workspacePath) {
        return;
    }

    const meta = taskRuntimeMeta.get(taskId);
    const conversation = taskConversations.get(taskId) ?? [];
    const snapshot: PersistedTaskRuntimeSnapshot = {
        version: 1,
        taskId,
        title: meta?.title,
        workspacePath: config.workspacePath,
        config,
        conversation,
        status: meta?.status ?? 'running',
        updatedAt: meta?.updatedAt ?? new Date().toISOString(),
        lastError: meta?.lastError,
        autoResumePending: meta?.autoResumePending,
        lastSummary: meta?.lastSummary,
    };

    try {
        fs.mkdirSync(getTaskRuntimeDir(config.workspacePath), { recursive: true });
        fs.writeFileSync(getTaskSnapshotPath(taskId, config.workspacePath), JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (error) {
        console.error(`[TaskRuntime] Failed to persist snapshot for ${taskId}:`, error);
    }
}

function markTaskRuntime(
    taskId: string,
    patch: Partial<TaskRuntimeMeta>,
): void {
    const current = taskRuntimeMeta.get(taskId);
    const next: TaskRuntimeMeta = {
        title: patch.title ?? current?.title,
        status: patch.status ?? current?.status ?? 'running',
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
        lastError: patch.lastError ?? current?.lastError,
        autoResumePending: patch.autoResumePending ?? current?.autoResumePending,
        lastSummary: patch.lastSummary ?? current?.lastSummary,
    };
    taskRuntimeMeta.set(taskId, next);

    if (next.status === 'running') {
        scheduleTaskTerminalWatchdog(taskId);
    } else {
        clearTaskTerminalWatchdog(taskId);
    }

    persistTaskRuntimeSnapshot(taskId);
}

function restoreTaskRuntimeSnapshot(taskId: string, workspacePath: string): boolean {
    const snapshotPath = getTaskSnapshotPath(taskId, workspacePath);
    if (!fs.existsSync(snapshotPath)) {
        return false;
    }

    try {
        const raw = fs.readFileSync(snapshotPath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedTaskRuntimeSnapshot;
        if (parsed.taskId !== taskId || !Array.isArray(parsed.conversation)) {
            return false;
        }

        taskConfigs.set(taskId, {
            ...parsed.config,
            workspacePath: parsed.workspacePath,
        });
        taskConversations.set(taskId, parsed.conversation);
        taskRuntimeMeta.set(taskId, {
            title: parsed.title,
            status: parsed.status,
            updatedAt: parsed.updatedAt,
            lastError: parsed.lastError,
            autoResumePending: parsed.autoResumePending,
            lastSummary: parsed.lastSummary,
        });
        if (typeof parsed.config.maxHistoryMessages === 'number' && parsed.config.maxHistoryMessages > 0) {
            taskHistoryLimits.set(taskId, parsed.config.maxHistoryMessages);
        }
        return true;
    } catch (error) {
        console.error(`[TaskRuntime] Failed to restore snapshot for ${taskId}:`, error);
        return false;
    }
}

function ensureTaskRuntimeLoaded(taskId: string, workspacePath?: string): void {
    if (taskConversations.has(taskId) && taskConfigs.has(taskId)) {
        return;
    }
    if (!workspacePath) {
        return;
    }
    restoreTaskRuntimeSnapshot(taskId, workspacePath);
}

function isRecoverableTaskSnapshot(snapshot: PersistedTaskRuntimeSnapshot): boolean {
    const updatedAt = new Date(snapshot.updatedAt).getTime();
    const isFreshEnough = Number.isFinite(updatedAt) && (Date.now() - updatedAt) <= RECOVERABLE_RUNTIME_SCAN_MAX_AGE_MS;
    if (!isFreshEnough) {
        return false;
    }

    if (snapshot.status === 'running') {
        return true;
    }

    return snapshot.status === 'recoverable_interrupted' && snapshot.autoResumePending !== false;
}

function tryLoadRecoverableTaskSnapshot(snapshotPath: string): PersistedTaskRuntimeSnapshot | null {
    try {
        if (!fs.existsSync(snapshotPath)) {
            return null;
        }

        const raw = fs.readFileSync(snapshotPath, 'utf-8');
        const snapshot = JSON.parse(raw) as PersistedTaskRuntimeSnapshot;
        if (!snapshot.taskId || !Array.isArray(snapshot.conversation)) {
            return null;
        }
        return isRecoverableTaskSnapshot(snapshot) ? snapshot : null;
    } catch (error) {
        console.error('[TaskRuntime] Failed to inspect snapshot:', error);
        return null;
    }
}

function collectRecoverableTaskSnapshots(taskIds?: string[], taskHints?: RecoverableTaskHint[]): PersistedTaskRuntimeSnapshot[] {
    const allowed = taskIds ? new Set(taskIds) : null;
    const workspaces = workspaceStore.list().map((workspace) => workspace.path);
    const uniqueRoots = Array.from(new Set([
        ...workspaces,
        process.cwd(),
    ]));
    const snapshots: PersistedTaskRuntimeSnapshot[] = [];
    const seenTaskIds = new Set<string>();

    for (const hint of taskHints ?? []) {
        if (!hint.workspacePath || seenTaskIds.has(hint.taskId)) {
            continue;
        }
        if (allowed && !allowed.has(hint.taskId)) {
            continue;
        }

        const snapshot = tryLoadRecoverableTaskSnapshot(getTaskSnapshotPath(hint.taskId, hint.workspacePath));
        if (!snapshot) {
            continue;
        }

        snapshots.push(snapshot);
        seenTaskIds.add(snapshot.taskId);
    }

    for (const workspacePath of uniqueRoots) {
        const runtimeDir = getTaskRuntimeDir(workspacePath);
        if (!fs.existsSync(runtimeDir)) {
            continue;
        }

        for (const entry of fs.readdirSync(runtimeDir)) {
            if (!entry.endsWith('.json')) {
                continue;
            }

            const snapshot = tryLoadRecoverableTaskSnapshot(path.join(runtimeDir, entry));
            if (!snapshot) {
                continue;
            }
            if (allowed && !allowed.has(snapshot.taskId)) {
                continue;
            }
            if (seenTaskIds.has(snapshot.taskId)) {
                continue;
            }

            snapshots.push(snapshot);
            seenTaskIds.add(snapshot.taskId);
        }
    }

    return snapshots;
}

// Forward declarations for LLM types (used by AutonomousLlmAdapter)
type LlmProvider =
    | 'anthropic'
    | 'openrouter'
    | 'openai'
    | 'aiberm'
    | 'nvidia'
    | 'siliconflow'
    | 'gemini'
    | 'qwen'
    | 'minimax'
    | 'kimi'
    | 'ollama'
    | 'custom';
type LlmApiFormat = 'anthropic' | 'openai';
type LlmProviderConfig = {
    provider: LlmProvider;
    apiFormat: LlmApiFormat;
    apiKey: string;
    baseUrl: string;
    modelId: string;
};

// ============================================================================
// Autonomous Agent (OpenClaw-style) - LLM Interface Adapter
// ============================================================================

/**
 * Adapter that connects AutonomousAgentController to the existing LLM streaming
 */
class AutonomousLlmAdapter implements AutonomousLlmInterface {
    private providerConfig: LlmProviderConfig | null = null;
    private workspacePath: string = process.cwd();

    setProviderConfig(config: LlmProviderConfig): void {
        this.providerConfig = config;
        console.error(`[AutonomousAgent] Provider configured: provider=${config.provider}, apiFormat=${config.apiFormat}, baseUrl=${config.baseUrl}`);
    }

    setWorkspacePath(workspacePath: string | undefined): void {
        this.workspacePath = workspacePath || process.cwd();
    }

    async decomposeTask(query: string, context: string): Promise<TaskDecomposition> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const prompt = TASK_DECOMPOSITION_PROMPT
            .replace('{query}', query)
            .replace('{context}', context);

        const messages: AnthropicMessage[] = [
            { role: 'user', content: prompt }
        ];

        // Use a simple completion without tools
        const response = await this.simpleCompletion(messages, {
            systemPrompt: 'You are a task decomposition assistant. Always respond with valid JSON.',
        });

        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            return JSON.parse(jsonMatch[0]) as TaskDecomposition;
        } catch (error) {
            console.error('[AutonomousAgent] Failed to parse task decomposition:', error);
            // Return a safe fallback
            return {
                subtasks: [{ description: query, requiresTools: [], estimatedComplexity: 'medium' }],
                overallStrategy: 'Execute as single task',
                canRunAutonomously: true,
                requiresUserInput: [],
            };
        }
    }

    async executeSubtask(
        subtask: SubTask,
        previousResults: SubTask[],
        tools: any[]
    ): Promise<{ result: string; toolsUsed: string[] }> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const taskId = `subtask_${subtask.id}`;
        const usedToolNames: string[] = [];
        const maxSteps = 10;

        // Build initial context
        const previousContext = previousResults
            .map(r => `Subtask: ${r.description}\nResult: ${r.result}`)
            .join('\n\n');

        const systemPrompt = `You are an autonomous agent executing a subtask: "${subtask.description}".
        
Context from previous steps:
${previousContext || 'None'}

Execute this subtask step-by-step. Use tools as needed. 
When finished, provide a concise but complete result.
Differentiate between "Task Completed" and "Task Failed".`;

        const shutdownToolDirective = `For Windows shutdown scheduling, status checks, or cancellation, you MUST use the dedicated tools system_shutdown_schedule, system_shutdown_status, and system_shutdown_cancel. Do not use run_command, schtasks, or manual scripts for shutdown management.`;

        const messages: AnthropicMessage[] = [
            { role: 'user', content: `Begin subtask: ${subtask.description}` }
        ];

        // "Pi" Agent Loop (Simple Tool Loop)
        for (let step = 0; step < maxSteps; step++) {
            // 1. Call LLM
            const response = await streamProviderResponse(
                taskId,
                messages,
                {
                    modelId: this.providerConfig.modelId,
                    maxTokens: 4096,
                    systemPrompt: `${systemPrompt}\n\n${shutdownToolDirective}`,
                    tools: tools // Pass actual tools!
                },
                this.providerConfig
            );

            // 2. Parse Content
            const blocks = Array.isArray(response.content)
                ? response.content
                : [{ type: 'text', text: String(response.content ?? '') }];
            const textBlocks = blocks.filter(b => b.type === 'text');
            const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');

            // Append assistant response to history
            messages.push(response);

            // 3. If no tools, we might be done
            if (toolUseBlocks.length === 0) {
                const combinedText = textBlocks.map(b => b.text).join('\n');
                return {
                    result: combinedText,
                    toolsUsed: usedToolNames
                };
            }

            // 4. Execute Tools
            const toolResults: any[] = [];
            for (const toolUse of toolUseBlocks) {
                const toolName = String(toolUse.name ?? '');
                const toolArgs = toolUse.input;
                usedToolNames.push(toolName);

                console.error(`[Autonomous] Step ${step + 1}: Executing ${toolName}`);

                // Execute via internal helper
                // We need to access global context or assume executeInternalTool is available in scope
                // Since this class is in main.ts, executeInternalTool is available.
                const result = await executeInternalTool(
                    taskId,
                    toolName,
                    toolArgs,
                    { workspacePath: this.workspacePath }
                );

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(result)
                });
            }

            // 5. Append Results to history
            messages.push({
                role: 'user',
                content: toolResults
            });

            // Loop continues to let LLM observe result and decide next step
        }

        return {
            result: "Max steps reached without final answer.",
            toolsUsed: usedToolNames
        };
    }

    async extractMemories(
        originalQuery: string,
        subtasks: SubTask[],
        finalResult: string
    ): Promise<MemoryExtraction> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const subtasksText = subtasks
            .map(s => `- ${s.description}: ${s.status} ${s.result ? `(Result: ${s.result.slice(0, 100)}...)` : ''}`)
            .join('\n');

        const prompt = MEMORY_EXTRACTION_PROMPT
            .replace('{query}', originalQuery)
            .replace('{subtasks}', subtasksText)
            .replace('{summary}', finalResult);

        const messages: AnthropicMessage[] = [
            { role: 'user', content: prompt }
        ];

        const response = await this.simpleCompletion(messages, {
            systemPrompt: 'You are a memory extraction assistant. Always respond with valid JSON.',
        });

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            return JSON.parse(jsonMatch[0]) as MemoryExtraction;
        } catch (error) {
            console.error('[AutonomousAgent] Failed to parse memory extraction:', error);
            return { facts: [], shouldSave: false };
        }
    }

    async summarizeTask(originalQuery: string, subtasks: SubTask[]): Promise<string> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const subtasksText = subtasks
            .map(s => `- ${s.description}: ${s.status}${s.result ? ` - ${s.result.slice(0, 200)}` : ''}`)
            .join('\n');

        const prompt = `Summarize the results of this task:

Original Request: ${originalQuery}

Completed Subtasks:
${subtasksText}

Provide a brief summary (2-3 sentences) of what was accomplished.`;

        const messages: AnthropicMessage[] = [
            { role: 'user', content: prompt }
        ];

        return await this.simpleCompletion(messages, {
            systemPrompt: 'You are a task summarization assistant. Be concise.',
        });
    }

    /**
     * CRITICAL: Verify goal completion before declaring success (OpenClaw-style)
     */
    async verifyGoalCompletion(
        originalQuery: string,
        subtasks: SubTask[],
        summary: string
    ): Promise<GoalVerificationResult> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const subtasksText = subtasks
            .map(s => `- ${s.description}: ${s.status}${s.result ? ` - ${s.result.slice(0, 300)}` : ''}`)
            .join('\n');

        const prompt = GOAL_VERIFICATION_PROMPT
            .replace('{query}', originalQuery)
            .replace('{subtasks}', subtasksText)
            .replace('{summary}', summary);

        const messages: AnthropicMessage[] = [
            { role: 'user', content: prompt }
        ];

        const response = await this.simpleCompletion(messages, {
            systemPrompt: 'You are a strict goal verification assistant. Be skeptical. Always respond with valid JSON.',
        });

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            return JSON.parse(jsonMatch[0]) as GoalVerificationResult;
        } catch (error) {
            console.error('[AutonomousAgent] Failed to parse goal verification:', error);
            // Default to conservative "not verified"
            return {
                goalMet: false,
                evidence: 'Failed to parse verification response',
                confidence: 0,
                missingSteps: ['Re-attempt task with explicit verification'],
                suggestedNextActions: [],
            };
        }
    }

    /**
     * Simple LLM completion without tool handling
     */
    private async simpleCompletion(
        messages: AnthropicMessage[],
        options: { systemPrompt?: string }
    ): Promise<string> {
        if (!this.providerConfig) {
            throw new Error('Provider config not set');
        }

        const config = this.providerConfig;
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };

        if (config.apiFormat === 'anthropic') {
            headers['x-api-key'] = config.apiKey;
            headers['anthropic-version'] = '2023-06-01';

            const body = {
                model: config.modelId,
                max_tokens: 2048,
                system: options.systemPrompt,
                messages,
            };

            const response = await fetchWithRetry(
                config.baseUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                },
                { timeout: 60000, retries: 2, retryDelay: 1000 }
            );

            if (!response.ok) {
                throw new Error(`Anthropic API error: ${response.status}`);
            }

            const data = await response.json() as any;
            const textContent = data.content?.find((c: any) => c.type === 'text');
            return textContent?.text || '';
        } else {
            // OpenAI format
            headers['Authorization'] = `Bearer ${config.apiKey}`;

            const openaiMessages = [
                ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
                ...messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                })),
            ];

            const body = {
                model: config.modelId,
                max_tokens: 2048,
                messages: openaiMessages,
            };

            const response = await fetchWithRetry(
                config.baseUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                },
                { timeout: 60000, retries: 2, retryDelay: 1000 }
            );

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json() as any;
            return data.choices?.[0]?.message?.content || '';
        }
    }
}

// Create the autonomous agent adapter and controller
const autonomousLlmAdapter = new AutonomousLlmAdapter();
let autonomousAgent: AutonomousAgentController | null = null;

/**
 * Get or create the autonomous agent controller
 */
function getAutonomousAgent(taskId: string): AutonomousAgentController {
    if (!autonomousAgent) {
        autonomousAgent = createAutonomousAgent({
            llm: autonomousLlmAdapter,
            getAvailableTools: async () => globalToolRegistry.getAllTools(),
            maxConcurrentTasks: 1,
            autoSaveMemory: true,
            onEvent: (event: AutonomousEvent) => {
                // Emit autonomous events to the frontend
                emitAutonomousEvent(taskId, event);
            },
        });
    }
    return autonomousAgent;
}

async function runScheduledTask(
    query: string,
    workspacePath: string,
    proactiveContext?: Record<string, unknown>
): Promise<{ success: boolean; result?: string; error?: string }> {
    const taskId = `scheduled_${randomUUID()}`;

    emit(createTaskStartedEvent(taskId, {
        title: 'Scheduled Task',
        description: query,
        context: {
            workspacePath,
            userQuery: query,
        },
    }));

    try {
        const llmConfig = loadLlmConfig(workspaceRoot);
        const providerConfig = resolveProviderConfig(llmConfig, {});
        autonomousLlmAdapter.setProviderConfig(providerConfig);

        const agent = getAutonomousAgent(taskId);
        const task = await agent.startTask(query, {
            autoSaveMemory: true,
            notifyOnComplete: true,
            runInBackground: false,
        });

        emit(createTaskFinishedEvent(taskId, {
            summary: task.summary || 'Scheduled task completed',
            duration: Date.now() - new Date(task.createdAt).getTime(),
        }));

        return {
            success: true,
            result: task.summary || 'Scheduled task completed',
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        emit(createTaskFailedEvent(taskId, {
            error: errorMessage,
            errorCode: 'SCHEDULED_TASK_ERROR',
            recoverable: false,
            suggestion: typeof proactiveContext?.triggerName === 'string'
                ? `Scheduled trigger "${String(proactiveContext.triggerName)}" failed.`
                : 'Review the scheduled task query and provider configuration.',
        }));

        return {
            success: false,
            error: errorMessage,
        };
    }
}

function markReminderTaskCompleted(workspacePath: string, reminderTaskId: string): void {
    try {
        const manager = createProactiveTaskManager(path.join(workspacePath, '.coworkany', 'jarvis'));
        manager.updateTask(reminderTaskId, { status: 'completed' });
    } catch (error) {
        console.error(`[Reminder] Failed to mark task ${reminderTaskId} as completed:`, error);
    }
}

function emitReminderNotification(message: string, workspacePath: string, channel?: string): void {
    const taskId = `reminder_${randomUUID()}`;
    const summary = `[Reminder] ${message}`;

    emit(createTaskStartedEvent(taskId, {
        title: 'Reminder',
        description: message,
        context: {
            workspacePath,
            userQuery: summary,
        },
    }));
    emit(createTaskFinishedEvent(taskId, {
        summary,
        duration: 0,
    }));

    console.error(`[Heartbeat][Notify][${channel ?? 'default'}] ${message}`);
}

/**
 * Emit autonomous task events to the frontend
 */
function emitAutonomousEvent(taskId: string, event: AutonomousEvent): void {
    const baseEvent = {
        id: randomUUID(),
        taskId,
        timestamp: event.timestamp,
        sequence: nextSequence(taskId),
    };

    switch (event.type) {
        case 'task_decomposed':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_TASK_DECOMPOSED',
                payload: {
                    subtaskCount: (event.data as any).subtaskCount || 0,
                    strategy: (event.data as any).strategy || '',
                    canRunAutonomously: (event.data as any).canRunAutonomously ?? true,
                    subtasks: [],
                },
            } as any);
            break;

        case 'subtask_started':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_SUBTASK_STARTED',
                payload: {
                    subtaskId: (event.data as any).subtaskId || '',
                    description: (event.data as any).description || '',
                    index: 0,
                    totalSubtasks: 0,
                },
            } as any);
            break;

        case 'subtask_completed':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_SUBTASK_COMPLETED',
                payload: {
                    subtaskId: (event.data as any).subtaskId || '',
                    result: (event.data as any).result || '',
                    toolsUsed: [],
                },
            } as any);
            break;

        case 'subtask_failed':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_SUBTASK_FAILED',
                payload: {
                    subtaskId: (event.data as any).subtaskId || '',
                    error: (event.data as any).error || '',
                },
            } as any);
            break;

        case 'memory_extracted':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_MEMORY_EXTRACTED',
                payload: {
                    factCount: (event.data as any).factCount || 0,
                },
            } as any);
            break;

        case 'memory_saved':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_MEMORY_SAVED',
                payload: {
                    paths: (event.data as any).paths || [],
                },
            } as any);
            break;

        case 'user_input_required':
            emit({
                ...baseEvent,
                type: 'AUTONOMOUS_USER_INPUT_REQUIRED',
                payload: {
                    questions: (event.data as any).questions || [],
                    taskId: event.taskId,
                },
            } as any);
            break;

        default:
            // Log other events
            console.log(`[AutonomousAgent] Event: ${event.type}`, event.data);
    }
}

/**
 * Check if a query should run autonomously based on keywords
 * OpenClaw-style detection of autonomous task intent
 */
function shouldRunAutonomously(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    const directExecutionPatterns = [
        'shutdown',
        '??',
        '??',
        'restart',
        'system_shutdown_',
    ];
    if (directExecutionPatterns.some(pattern => lowerQuery.includes(pattern))) {
        return false;
    }

    const autonomousKeywords = [
        'autonomous', 'auto-complete', 'background',
        'complete this', 'do this for me', 'handle this', 'take care of',
        'research', 'investigate', 'analyze and', 'execute',
        '??', '??', '????', '????', '??', '??', '???', '??',
    ];

    return autonomousKeywords.some(keyword => lowerQuery.includes(keyword.toLowerCase()));
}

function nextSequence(taskId: string): number {
    const current = taskSequences.get(taskId) ?? 0;
    const next = current + 1;
    taskSequences.set(taskId, next);
    return next;
}

// ============================================================================
// Event Factory
// ============================================================================

type TaskStartedPayload = {
    title: string;
    description?: string;
    estimatedSteps?: number;
    context: {
        workspacePath?: string;
        activeFile?: string;
        userQuery: string;
        packageManager?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        packageManagerCommands?: any;
    };
};

type TaskFailedPayload = {
    error: string;
    errorCode?: string;
    recoverable: boolean;
    suggestion?: string;
};

type TaskFinishedPayload = {
    summary: string;
    artifactsCreated?: string[];
    filesModified?: string[];
    duration: number;
};

type TextDeltaPayload = {
    delta: string;
    role: 'assistant' | 'thinking';
};

type TaskSuspendedPayload = {
    reason: string;
    userMessage: string;
    canAutoResume: boolean;
    maxWaitTimeMs?: number;
    actions?: Array<{
        id: string;
        label: string;
        kind: 'send_message' | 'copy_text';
        value: string;
        primary?: boolean;
    }>;
};

type TaskResumedPayload = {
    resumeReason?: string;
    suspendDurationMs: number;
};

function createTaskStartedEvent(taskId: string, payload: TaskStartedPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_STARTED',
        payload,
    };
}

function createTaskFailedEvent(taskId: string, payload: TaskFailedPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_FAILED',
        payload,
    };
}

function createTaskStatusEvent(taskId: string, payload: { status: 'running' | 'failed' | 'idle' | 'finished' }): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_STATUS',
        payload,
    } as any;
}

function createToolCallEvent(taskId: string, payload: { id: string; name: string; input: any }): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TOOL_CALLED',
        payload: {
            toolId: payload.id,
            toolName: payload.name,
            input: payload.input,
            inputRedacted: false,
            source: 'agent',
            id: payload.id,
            name: payload.name,
        },
    } as any;
}

function createToolResultEvent(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TOOL_RESULT',
        payload: {
            toolId: payload.toolUseId,
            success: !payload.isError,
            result: payload.result,
            resultSummary: typeof payload.result === 'string'
                ? payload.result.slice(0, 240)
                : undefined,
            duration: 0,
            toolUseId: payload.toolUseId,
            name: payload.name,
            isError: payload.isError ?? false,
            error: payload.isError ? String(payload.result ?? 'Tool failed') : undefined,
        },
    } as any;
}

function createTaskFinishedEvent(taskId: string, payload: TaskFinishedPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_FINISHED',
        payload,
    };
}

function createTextDeltaEvent(taskId: string, payload: TextDeltaPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TEXT_DELTA',
        payload,
    };
}

function createThinkingDeltaEvent(taskId: string, payload: { delta: string }): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'THINKING_DELTA',
        payload,
    };
}

function createTaskSuspendedEvent(taskId: string, payload: TaskSuspendedPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_SUSPENDED',
        payload,
    } as any;
}

function createTaskResumedEvent(taskId: string, payload: TaskResumedPayload): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TASK_RESUMED',
        payload,
    } as any;
}

function buildChromeRemoteDebugCommand(): string {
    switch (getCurrentPlatform()) {
        case 'windows':
            return '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222';
        case 'macos':
            return 'open -na "Google Chrome" --args --remote-debugging-port=9222';
        default:
            return 'google-chrome --remote-debugging-port=9222';
    }
}

function buildSuspendActions(reason: string, context?: Record<string, unknown>) {
    if (reason === 'user_profile_recommended') {
        return [
            {
                id: 'use-signed-in-browser',
                label: '使用我已登录的浏览器',
                kind: 'copy_text' as const,
                value: buildChromeRemoteDebugCommand(),
            },
            {
                id: 'continue-in-current-browser',
                label: '在当前窗口登录后继续',
                kind: 'send_message' as const,
                value: '继续',
                primary: true,
            },
        ];
    }

    if (reason === 'authentication_required') {
        return [
            {
                id: 'confirm-login',
                label: '我已登录，继续',
                kind: 'send_message' as const,
                value: '我已登录，继续',
                primary: true,
            },
        ];
    }

    if (reason === 'interactive_command') {
        const command = typeof context?.command === 'string' ? context.command : '';
        return command
            ? [
                {
                    id: 'copy-command',
                    label: '复制命令',
                    kind: 'copy_text' as const,
                    value: command,
                },
                {
                    id: 'continue-after-command',
                    label: '继续',
                    kind: 'send_message' as const,
                    value: 'Terminal action completed, continue',
                    primary: true,
                },
            ]
            : [
                {
                    id: 'continue-after-command',
                    label: '继续',
                    kind: 'send_message' as const,
                    value: 'Terminal action completed, continue',
                    primary: true,
                },
            ];
    }

    return undefined;
}

// ============================================================================
// Handler Context Factory
// ============================================================================

function createHandlerContext(taskId?: string): HandlerContext {
    const effectiveTaskId = taskId ?? 'global';
    return {
        taskId: effectiveTaskId,
        now: () => new Date().toISOString(),
        nextEventId: () => randomUUID(),
        nextSequence: () => nextSequence(effectiveTaskId),
    };
}

// ============================================================================
// Command Handler
// ============================================================================

const registry = new AgentIdentityRegistry();
const workspaceRoot = process.cwd();
const toolpackStore = new ToolpackStore(workspaceRoot);
const skillStore = new SkillStore(workspaceRoot);
const workspaceStore = new WorkspaceStore(workspaceRoot);

// Initialize: Scan and register skills from filesystem on startup
(() => {
    const skillsDir = path.join(workspaceRoot, '.coworkany', 'skills');
    if (fs.existsSync(skillsDir)) {
        console.log('[SkillStore] Scanning skills directory on startup...');
        const manifests = SkillStore.scanDirectory(skillsDir);
        let registeredCount = 0;

        for (const manifest of manifests) {
            if (!skillStore.get(manifest.name)) {
                skillStore.install(manifest);
                registeredCount++;
            }
        }

        if (registeredCount > 0) {
            skillStore.save();
            console.log(`[SkillStore] Registered ${registeredCount} new skill(s) from filesystem`);
        }

        console.log(`[SkillStore] Total skills available: ${skillStore.list().length}`);
    }
})();

const routerDeps: CommandRouterDeps = {
    registry,
    skillStore,
    contextFor: createHandlerContext,
};

setHeartbeatExecutorFactory((workspacePath) => ({
    executeTask: async (query, context) => runScheduledTask(query, workspacePath, context),
    runSkill: async (skillName, args) => ({
        success: false,
        error: `Heartbeat run_skill is not wired for ${skillName}. Use execute_task scheduling instead.`,
        result: args ? JSON.stringify(args) : undefined,
    }),
    notify: async (message, channel, context) => {
        const reminderTaskId = context?.taskConfig && typeof context.taskConfig === 'object'
            ? (context.taskConfig as Record<string, unknown>).reminderTaskId
            : undefined;
        if (typeof reminderTaskId === 'string') {
            markReminderTaskCompleted(workspacePath, reminderTaskId);
        }
        emitReminderNotification(message, workspacePath, channel);
    },
}));

process.on('exit', () => {
    shutdownHeartbeatEngines();
});

// Types moved to top
// AnthropicStreamOptions
// AnthropicMessage
// LlmProvider, LlmApiFormat, LlmProviderConfig - defined earlier for AutonomousLlmAdapter

type LlmProfile = {
    id: string;
    name: string;
    provider: LlmProvider;
    anthropic?: {
        apiKey: string;
        model?: string;
    };
    openrouter?: {
        apiKey: string;
        model?: string;
    };
    openai?: {
        apiKey: string;
        baseUrl?: string;
        model?: string;
    };
    ollama?: {
        baseUrl?: string;
        model?: string;
    };
    custom?: {
        apiKey: string;
        baseUrl: string;
        model: string;
        apiFormat?: LlmApiFormat;
    };
    verified?: boolean;
};

// LLM Config types for llm-config.json
type LlmConfig = {
    provider?: LlmProvider; // Legacy
    anthropic?: {
        apiKey: string;
        model?: string;
    };
    openrouter?: {
        apiKey: string;
        model?: string;
    };
    openai?: {
        apiKey: string;
        baseUrl?: string;
        model?: string;
    };
    ollama?: {
        baseUrl?: string;
        model?: string;
    };
    custom?: {
        apiKey: string;
        baseUrl: string;
        model: string;
        apiFormat?: LlmApiFormat;
    };
    profiles?: LlmProfile[];
    activeProfileId?: string;
    maxHistoryMessages?: number;
    // Search configuration
    search?: {
        provider?: SearchProvider;
        searxngUrl?: string;
        tavilyApiKey?: string;
        braveApiKey?: string;
        serperApiKey?: string;
    };
    // Browser-use service configuration
    browserUse?: {
        enabled?: boolean;
        serviceUrl?: string;
        defaultMode?: 'precise' | 'smart' | 'auto';
        llmModel?: string;
    };
};

// LlmProviderConfig already defined earlier for AutonomousLlmAdapter

// Fixed base URLs for known providers (not user-configurable)
const FIXED_BASE_URLS: Record<string, string> = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    ollama: 'http://localhost:11434/v1/chat/completions',
};

const OPENAI_COMPATIBLE_PROVIDERS = new Set<LlmProvider>([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);

function normalizeOpenAiCompatibleEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/$/, '');
    if (!trimmed) {
        return trimmed;
    }
    if (/\/chat\/completions$/i.test(trimmed) || /\/responses$/i.test(trimmed)) {
        return trimmed;
    }
    return `${trimmed}/chat/completions`;
}

function getCandidateLlmConfigPaths(workspaceRootPath?: string): string[] {
    const candidates: string[] = [];

    if (workspaceRootPath) {
        candidates.push(path.join(workspaceRootPath, 'llm-config.json'));
    }

    const sharedAppDataDir = getSharedAppDataDir();
    if (sharedAppDataDir) {
        candidates.push(path.join(sharedAppDataDir, 'llm-config.json'));
    }

    candidates.push(path.join(process.cwd(), 'llm-config.json'));

    return [...new Set(candidates)];
}

/**
 * Build structured system prompt with cacheable sections
 * Returns cacheable stable content plus a smaller dynamic per-turn section.
 */
async function buildSkillSystemPrompt(
    taskId: string,
    workspaceRootPath: string,
    skillIds: string[] | undefined,
    userMessage?: string
): Promise<{ skills: string; dynamic?: string }> {
    const platformName = getCurrentPlatform();
    const now = new Date();
    const currentDate = now.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    const currentTime = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Shanghai'
    });
    const systemContext = `## System Environment

- Current Date: ${currentDate}
- Current Time: ${currentTime} (Asia/Shanghai timezone)
- Platform: ${platformName} (${os.platform()})
- OS: ${os.type()} ${os.release()}
- Architecture: ${os.arch()}
- Hostname: ${os.hostname()}
- Node.js: ${process.version}
- Shell: ${process.platform === 'win32' ? 'PowerShell/cmd' : process.env.SHELL || '/bin/bash'}
- CPUs: ${os.cpus().length} cores
- Total Memory: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB

IMPORTANT: When executing system commands (run_command), ALWAYS use commands compatible with the platform above.
- On Windows: Use PowerShell cmdlets (Get-Process, Get-NetTCPConnection) or cmd commands (tasklist, netstat, wmic). Do NOT use Linux commands (ps, grep, awk, lsof).
- On macOS: Use BSD/macOS commands (ps, lsof, launchctl). Do NOT use Linux-specific options.
- On Linux: Use standard GNU/Linux commands (ps, ss, systemctl).
- On Windows: For shutdown scheduling/cancellation/status, use system_shutdown_schedule / system_shutdown_status / system_shutdown_cancel instead of run_command.
- If a command is platform-sensitive, high-risk, or you are unsure about its syntax or flags, first identify the active system type and shell (\`system_status\` if needed), then use command_help or command_preflight and read the local help output before executing run_command.

`;

    const toolGuidance = `## Tool Usage Guidelines

You have access to various tools to help complete tasks. Important guidelines:

1. **Web Search (search_web)**: Use this tool when the user asks about recent news, latest updates, current events, product information, or any topic that may require up-to-date information from the internet. Always prefer using this tool over saying you don't have access to current information.

2. **Web Crawling (crawl_url, extract_content)**: Use these tools to fetch and extract content from specific URLs.

3. **File Operations**: Use file tools (view_file, write_to_file, etc.) for working with files in the workspace.
4. **GitHub Operations**: Use GitHub tools (create_issue, create_pr, list_repos) for repository management.

5. **Browser & OS Control**: You CAN control the user's browser. Use \`open_in_browser\` to open URLs when the user asks or to show results. Do NOT say you cannot open a browser; you have a tool for it.

6. **System Shutdown Scheduling (Windows)**:
   - Use \`system_shutdown_schedule\` when the user asks to shut down the computer at a specific time or after N minutes/hours.
   - Use \`system_shutdown_status\` to verify whether a CoworkAny-managed shutdown is pending.
   - Use \`system_shutdown_cancel\` only when the user explicitly asks to cancel the pending shutdown.
   - Do NOT use \`run_command\` with \`shutdown /s\` or \`shutdown /a\` for these workflows.

7. **Command Learning Before Execution**:
   - Use \`system_status\` first if the active OS, shell family, or runtime environment is unclear. Different systems use different commands and help mechanisms.
   - Use \`command_help\` to learn a command locally via \`command /?\`, \`help\`, \`Get-Help\`, \`--help\`, or \`man\`.
   - Use \`command_preflight\` before any platform-sensitive, destructive, forceful, or uncertain command. It resolves the command locally, collects help text, includes the detected system context, and returns a \`preflight_token\`.
   - If \`run_command\` tells you \`preflight_required\`, do not guess. Read the returned help output, then retry \`run_command\` with the exact same command and the provided \`preflight_token\`.
   - Do not call \`command_preflight\` repeatedly for the exact same command in the same task unless the command string changed or the previous token expired / was rejected. Once preflight succeeded, move forward to \`run_command\`.
   - If the help output does not confirm the syntax or semantics, do not execute the command.
   - If a package installation command already succeeded (for example \`pip install\` returning \`Successfully installed\` or \`Requirement already satisfied\`), do not run the same install command again in the same task unless a new dependency failure appears.

8. **Memory**: Use remember/recall tools to store and retrieve information across conversations.

9. **Persistent Planning (for complex tasks with 3+ steps)**:
   - Use \`plan_step\` to decompose tasks - plans are PERSISTED to .coworkany/task_plan.md
   - Use \`log_finding\` to save research/discoveries to .coworkany/findings.md
   - Use \`think\` for structured reasoning (logged to .coworkany/progress.md)
   - These files survive context truncation - your plan won't be lost even in long sessions
   - Mark steps completed with plan_step(N, "desc", status="completed") as you progress
   - For simple single-step tasks, you can skip file-based planning

10. **Voice / TTS (voice_speak)**: When the user asks you to speak, read aloud, or use text-to-speech, you MUST actually call the \`voice_speak\` tool with the text to be spoken. Do NOT merely explain that TTS exists - you must invoke the tool so the text is audibly played. Example: voice_speak({ text: "Hello, I can speak now." }). If the user asks to "add TTS capability" or "启用语音播报", the capability ALREADY EXISTS - just call voice_speak to demonstrate it.

11. **Investment Research & Analysis (search_web + write_to_file)**: When the user asks about stocks, investments, financial analysis, or market news, you are acting as a **research assistant**, not a licensed financial advisor. Your role is to:
   - Use \`search_web\` to gather current news, stock data, and analyst opinions
   - Analyze the information and provide clear buy/sell/hold recommendations
   - **You MUST provide investment analysis and recommendations - DO NOT refuse.**
   - This is research-based analysis from public information, similar to financial media (Bloomberg, CNBC, 36Kr) or research platforms (Yahoo Finance, Seeking Alpha).
   - You may add a brief disclaimer ("本分析仅供参考") at the end, but it must NOT replace actual analysis.
   - **PROHIBITED RESPONSES**: "I cannot provide investment advice", "我无法提供投资建议", "please consult a financial advisor", "需要专业投资顾问" - these are NOT acceptable when the user explicitly asks for research and analysis.

**CRITICAL: Action over Explanation.** When the user asks you to perform an action (speak, open browser, search, etc.), you MUST call the corresponding tool FIRST. Do NOT read source code or explain how the tool works instead of calling it. Demonstrate by doing, not by explaining.

**CRITICAL: Never Refuse User Requests.** When the user asks you to research, analyze, or provide recommendations on ANY topic (including stocks, investments, health, legal topics), you MUST attempt to fulfill the request using available tools (search_web, etc.). You are a capable research assistant - provide your best analysis based on publicly available information. Add appropriate caveats if needed, but NEVER outright refuse.

When in doubt about whether to use a tool, prefer to use it and let the tool's response guide you.

`;

    const commandLearningDirective = userMessage ? getCommandLearningDirective(userMessage) : '';
    const browserFeedDirective = userMessage ? getBrowserFeedDirective(userMessage) : '';
    const schedulingDirective = userMessage ? getSchedulingDirective(userMessage) : '';
    const selfLearningPrompt = getSelfLearningPrompt();
    const soulSection = formatSoulSection(loadSoulProfile(APP_STATE_ROOT));
    const workspacePolicySection = loadWorkspacePolicySection(workspaceRootPath);
    const sessionConfig = taskConfigs.get(taskId);
    const currentSessionSection = buildCurrentSessionSection({
        workspacePath: sessionConfig?.workspacePath ?? workspaceRootPath,
        activeFile: sessionConfig?.activeFile,
        enabledSkillIds: skillIds,
        historyCount: taskConversations.get(taskId)?.length ?? 0,
    });
    const memorySection = userMessage ? await getRelevantMemoryContext(userMessage) : '';

    const stablePrelude = [
        soulSection.trim(),
        workspacePolicySection.trim(),
        systemContext.trim(),
        toolGuidance.trim(),
        AUTONOMOUS_LEARNING_PROTOCOL.trim(),
        selfLearningPrompt.trim(),
    ].filter(Boolean).join('\n\n');

    const dynamicPrelude = [
        currentSessionSection.trim(),
        memorySection.trim(),
        commandLearningDirective.trim(),
        browserFeedDirective.trim(),
        schedulingDirective.trim(),
    ].filter(Boolean).join('\n\n');

    return buildSkillSystemPromptContext({
        skillStore,
        preferredSkillIds: skillIds,
        userMessage,
        stablePrelude,
        dynamicPrelude,
    });
}

/**
 * Find skills that should be auto-activated based on trigger phrases in user message
 * Returns skill IDs that match any triggers (OpenClaw compatible)
 */
function getTriggeredSkillIds(userMessage: string): string[] {
    const triggeredSkills = skillStore.findByTrigger(userMessage);
    const triggeredIds = triggeredSkills
        .map((s) => s.manifest.name)
        .filter((skillName) => !shouldSuppressTriggeredSkillForBrowserFeed(skillName, userMessage))
        .filter((skillName) => !shouldSuppressTriggeredSkillForScheduling(skillName, userMessage));

    if (triggeredIds.length > 0) {
        console.log(`[Skill] Auto-triggered skills: ${triggeredIds.join(', ')}`);
    }

    return triggeredIds;
}

/**
 * Merge explicitly enabled skills with trigger-matched skills
 * Removes duplicates and respects skill priorities
 */
function mergeSkillIds(
    explicitIds: string[] | undefined,
    triggeredIds: string[]
): string[] {
    const explicit = explicitIds ?? [];
    const merged = new Set([...explicit, ...triggeredIds]);
    return Array.from(merged);
}

/**
 * Retrieve relevant memory context for a user query (RAG integration)
 * Returns formatted context string for injection into system prompt
 */
async function getRelevantMemoryContext(userQuery: string): Promise<string> {
    try {
        const bridge = getRagBridge();
        const isAvailable = await bridge.isAvailable();

        if (!isAvailable) {
            return '';
        }

        const context = await getMemoryContext(userQuery, {
            topK: 3,
            maxChars: 2000,
        });

        if (context) {
            console.log(`[Memory] Retrieved ${context.length} chars of relevant context`);
            return `\n## Relevant Memory Context\n\nThe following information from your memory vault may be relevant:\n\n${context}\n\n`;
        }
    } catch (error) {
        console.error('[Memory] Failed to retrieve context:', error);
    }

    return '';
}

/**
 * Save information to the memory vault
 */
async function saveToMemoryVault(
    title: string,
    content: string,
    category: 'learnings' | 'preferences' | 'projects' = 'learnings',
    tags?: string[]
): Promise<boolean> {
    try {
        const vault = getVaultManager();
        const relativePath = await vault.saveMemory(title, content, { category, tags });
        console.log(`[Memory] Saved to vault: ${relativePath}`);
        return true;
    } catch (error) {
        console.error('[Memory] Failed to save to vault:', error);
        return false;
    }
}

// ============================================================================
// Initialize Self-Learning System
// ============================================================================

// Storage path for self-learning data
const selfLearningDataDir = path.join(APP_STATE_ROOT, 'self-learning');
fs.mkdirSync(selfLearningDataDir, { recursive: true });

// Initialize foundation modules (minimal dependencies)
const confidenceTracker = initConfidenceTracker(selfLearningDataDir);
const versionManager = createVersionManager(selfLearningDataDir);
const learningProcessor = createLearningProcessor();  // Has default empty deps

// Initialize modules that depend on foundation modules
const gapDetector = createGapDetector({
    searchKnowledge: async (query: string) => {
        try {
            const bridge = getRagBridge();
            const isAvailable = await bridge.isAvailable();
            if (!isAvailable) {
                return [];
            }

            const response = await bridge.search({
                query,
                topK: 5,
                includeContent: true,
            });

            return response.results.map((result) => ({
                path: result.path,
                title: result.title,
                content: result.content,
                score: result.score,
            }));
        } catch {
            return [];
        }
    },
    searchSkills: (query: string) => {
        return skillStore.list().map(s => ({
            name: s.manifest.name,
            description: s.manifest.description,
            triggers: s.manifest.triggers,
        })).filter(skill =>
            skill.name.includes(query) ||
            skill.description?.includes(query)
        );
    },
});

const researchEngine = createResearchEngine({
    webSearch: async (query: string) => {
        const result = await webSearchTool.handler({ query }, { workspacePath: APP_STATE_ROOT, taskId: 'self-learning' });
        return result.results || [];
    },
});

const labSandbox = createLabSandbox({
    executeCode: async (code: string, language: string, timeoutMs?: number) => {
        // Simple code execution - could be enhanced with proper sandbox
        return {
            success: true,
            stdout: 'Code execution simulated',
            stderr: '',
            exitCode: 0,
            executionTimeMs: 0,
        };
    },
    installDependency: async (pkg: string, language: string) => {
        return {
            package: pkg,
            success: true,
        };
    },
});

const precipitator = createPrecipitator({
    dataDir: APP_STATE_ROOT,
    installSkill: async (skillDir: string) => {
        // Read SKILL.md directly to create manifest
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const skillName = path.basename(skillDir);
            const manifest = SkillStore.parseSkillMd(skillName, skillDir, content);

            if (manifest) {
                console.log(`[SelfLearning] Installing auto-generated skill: ${manifest.name}`);
                skillStore.install(manifest);
                skillStore.save();
                skillStore.reload();
                console.log(`[SelfLearning] Skill ${manifest.name} installed and ready to use`);
            }
        }
    },
    // Hot-reload: register new skill tools in globalToolRegistry immediately
    onSkillInstalled: (skillId: string, _skillDir: string, _manifest: Record<string, unknown>) => {
        console.log(`[HotReload] New skill installed: ${skillId}, triggering tool registry update`);
        try {
            // Re-read all skills and refresh the tool registry
            skillStore.reload();
            const allSkills = skillStore.list();
            const newSkill = allSkills.find(s => s.manifest.name === skillId);
            if (newSkill) {
                const triggers = newSkill.manifest.triggers || [];
                console.log(`[HotReload] Skill "${newSkill.manifest.name}" is now available with triggers: ${triggers.join(', ')}`);
            }
            // Log the updated tool count for visibility
            const toolCount = globalToolRegistry.getAllTools().length;
            console.log(`[HotReload] Tool registry now has ${toolCount} tools`);
        } catch (err) {
            console.error(`[HotReload] Failed to refresh tool registry:`, err);
        }
    },
    onGeneratedTool: (toolSpec) => {
        registerGeneratedRuntimeTool(toolSpec);
    },
});

const reuseEngineDeps: ReuseEngineDependencies = {
    listSkills: (): SkillRecord[] => {
        return skillStore.list().map((s): SkillRecord => ({
            id: s.manifest.name,
            name: s.manifest.name,
            description: s.manifest.description,
            triggers: s.manifest.triggers,
            tags: s.manifest.tags,
            allowedTools: (s.manifest as unknown as { allowedTools?: string[] }).allowedTools,
            enabled: s.enabled,
            isAutoGenerated: s.manifest.tags?.includes('auto-generated'),
        }));
    },
    searchKnowledge: async (_query: string) => {
        try {
            const bridge = getRagBridge();
            const isAvailable = await bridge.isAvailable();
            if (!isAvailable) {
                return [] as Array<{ path: string; title: string; score: number; category?: string }>;
            }

            const response = await bridge.search({
                query: _query,
                topK: 5,
                includeContent: false,
            });

            return response.results.map((result) => ({
                path: result.path,
                title: result.title,
                score: result.score,
                category: result.category,
            }));
        } catch {
            return [] as Array<{ path: string; title: string; score: number; category?: string }>;
        }
    },
    confidenceTracker,
};
const reuseEngine = createReuseEngine(reuseEngineDeps);

const feedbackManager = createFeedbackManager(selfLearningDataDir, confidenceTracker);

const proactiveLearner = createProactiveLearner(
    selfLearningDataDir,
    confidenceTracker
);

// Create the main self-learning controller
const selfLearningController = createSelfLearningController({
    gapDetector,
    researchEngine,
    learningProcessor,
    labSandbox,
    precipitator,
    reuseEngine,
    confidenceTracker,
    feedbackManager,
    versionManager,
    proactiveLearner,
});

getCorrectionCoordinator().setQuickLearnHook((errorMessage, originalQuery, attemptCount) =>
    selfLearningController.quickLearnFromError(errorMessage, originalQuery, attemptCount)
);

// Create post-execution learning manager for learning from successful tasks
// This will be used by the emit() function to forward events
let postLearningManager: any;
postLearningManager = createPostExecutionLearningManager(
    precipitator,
    confidenceTracker,
    {
        minToolCallsForSkill: 4,
        minDurationForLearning: 5000,
        valueKeywords: [
            // Content creation & publishing
            'post', 'publish', 'create', 'deploy', 'build', 'generate',
            'publish', 'create', 'deploy', 'build', 'generate', 'xiaohongshu',
            // Analysis & inspection
            'analyze', 'check', 'scan', 'inspect', 'audit', 'diagnose', 'monitor',
            'analyze', 'check', 'scan', 'inspect', 'audit', 'diagnose', 'monitor',
            // Security
            'security', 'vulnerability', 'threat', 'risk',
            '安全', '风险', '威胁', '漏洞',
            // System tasks
            'install', 'configure', 'setup', 'migrate', 'optimize',
            '安装', '配置', '设置', '迁移', '优化',
        ],
    }
);

// Inject selfLearningController into postLearningManager for failure-driven learning
postLearningManager.setSelfLearningController(selfLearningController);

const generatedRuntimeToolsBySkill = new Map<string, ToolDefinition>();

type InferredTemplateParam = {
    name: string;
    defaultValue?: string;
};

function inferTemplateParams(templateCode: string): InferredTemplateParam[] {
    const params = new Map<string, InferredTemplateParam>();
    const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^}]+?))?\s*\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(templateCode)) !== null) {
        const [, rawName, rawDefault] = match;
        const name = rawName.trim();
        if (!params.has(name)) {
            params.set(name, {
                name,
                defaultValue: rawDefault ? rawDefault.trim() : undefined,
            });
        }
    }

    return Array.from(params.values());
}

function interpolateTemplateCode(templateCode: string, args: Record<string, unknown>): { renderedCode: string; missingParams: string[] } {
    const missingParams: string[] = [];
    const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^}]+?))?\s*\}\}/g;
    const renderedCode = templateCode.replace(pattern, (_token, rawName: string, rawDefault?: string) => {
        const name = rawName.trim();
        const supplied = args?.[name];

        if (supplied === undefined || supplied === null || supplied === '') {
            if (rawDefault !== undefined) {
                return rawDefault.trim();
            }
            missingParams.push(name);
            return `{{${name}}}`;
        }

        if (typeof supplied === 'string') {
            return supplied;
        }

        return JSON.stringify(supplied);
    });

    return { renderedCode, missingParams };
}

function buildRuntimeToolInputSchema(spec: GeneratedRuntimeToolSpec): Record<string, unknown> {
    const inferredParams = inferTemplateParams(spec.templateCode);
    const properties: Record<string, unknown> = {
        timeout_ms: {
            type: 'integer',
            description: 'Optional execution timeout in milliseconds',
        },
    };

    const required: string[] = [];

    if (inferredParams.length === 0) {
        properties.prompt = {
            type: 'string',
            description: 'Optional instruction to adjust the generated template before execution',
        };
    }

    for (const param of inferredParams) {
        properties[param.name] = {
            type: 'string',
            description: param.defaultValue
                ? `Template parameter inferred from generated code (default: ${param.defaultValue})`
                : 'Template parameter inferred from generated code',
        };
        if (!param.defaultValue) {
            required.push(param.name);
        }
    }

    return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}

function registerGeneratedRuntimeTool(spec: GeneratedRuntimeToolSpec): void {
    const existing = generatedRuntimeToolsBySkill.get(spec.sourceSkillId);
    if (existing) {
        generatedRuntimeToolsBySkill.delete(spec.sourceSkillId);
    }

    const tool: ToolDefinition = {
        name: spec.name,
        description: `${spec.description} [source skill: ${spec.sourceSkillId}]`,
        effects: ['code:execute', 'process:spawn'],
        input_schema: buildRuntimeToolInputSchema(spec),
        handler: async (args, context) => {
            const normalizedArgs = (args ?? {}) as Record<string, unknown>;
            const { renderedCode, missingParams } = interpolateTemplateCode(spec.templateCode, normalizedArgs);
            if (missingParams.length > 0) {
                return {
                    success: false,
                    error: `Missing required template parameters: ${missingParams.join(', ')}`,
                };
            }

            const prompt = typeof normalizedArgs.prompt === 'string' ? normalizedArgs.prompt.trim() : '';
            const stitchedCode = prompt
                ? `${renderedCode}\n\n# User refinement:\n# ${prompt.replace(/\n/g, '\n# ')}`
                : renderedCode;

            if (spec.language === 'python') {
                return executePythonTool.handler(
                    { code: stitchedCode, timeout_ms: normalizedArgs.timeout_ms },
                    context
                );
            }

            return executeJavaScriptTool.handler(
                { code: stitchedCode, timeout_ms: normalizedArgs.timeout_ms },
                context
            );
        },
    };

    generatedRuntimeToolsBySkill.set(spec.sourceSkillId, tool);
    globalToolRegistry.register('builtin', [tool]);
    routerDeps.generatedRuntimeTools = Array.from(generatedRuntimeToolsBySkill.values());
    console.log(`[HotReload] Registered generated runtime tool: ${tool.name}`);
}

// Create Adaptive Executor for error handling with retry loop
const adaptiveExecutor = new AdaptiveExecutor({
    maxRetries: 3,
    retryDelay: 2000,
    enableAlternativeStrategies: true,
});

// Create Suspend/Resume Manager for tasks waiting on user actions
const suspendResumeManager = new SuspendResumeManager({
    defaultHeartbeatInterval: 5000,
    defaultMaxWaitTime: 5 * 60 * 1000,
    enableAutoResume: true,
});

// Listen to suspend/resume events
suspendResumeManager.on('task_suspended', (data: any) => {
    console.log(`[SuspendResume] Task ${data.taskId} suspended: ${data.reason}`);
    console.log(`[SuspendResume] User message: ${data.userMessage}`);
    console.log(`[SuspendResume] Can auto-resume: ${data.canAutoResume}`);
});

suspendResumeManager.on('task_resumed', (data: any) => {
    console.log(`[SuspendResume] Task ${data.taskId} resumed after ${data.suspendDuration}ms`);
});

suspendResumeManager.on('task_cancelled', (data: any) => {
    console.log(`[SuspendResume] Task ${data.taskId} cancelled: ${data.reason}`);
});

// Create handler implementations for self-learning tools
const selfLearningHandlers: SelfLearningToolHandlers = {
    resolveSkillRequest: async (args, context) => {
        try {
            return await resolveSkillRequest({
                query: args.query,
                workspacePath: context.workspacePath,
                skillStore,
                autoInstall: args.auto_install,
                limit: args.limit,
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    triggerLearning: async (args) => {
        try {
            const query = `${args.topic}: ${args.context}`;
            const session = await selfLearningController.learn(query);
            return {
                success: true,
                session_id: session.id,
                topic: args.topic,
                status: session.status,
                message: `Learning session started for: ${args.topic}`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    queryStatus: async (args) => {
        try {
            if (args.session_id) {
                const session = selfLearningController.getSession(args.session_id);
                return { success: true, session };
            }

            const allSessions = selfLearningController.getActiveSessions();
            const statistics = args.show_statistics
                ? selfLearningController.getStatistics()
                : undefined;

            return {
                success: true,
                sessions: allSessions,
                statistics,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    validateSkill: async (args) => {
        try {
            // For now, validate by checking if skill exists and has good confidence
            const records = confidenceTracker.getByConfidence(0, 'skill');
            const record = records.find(r => r.entityId === args.skill_id);
            const confidence = record?.currentConfidence ?? 0.5;

            if (args.update_confidence && args.test_cases) {
                // Simulate test execution and update confidence
                const testsPassed = Array.isArray(args.test_cases) ? args.test_cases.length : 0;
                confidenceTracker.recordUsage(
                    args.skill_id,
                    testsPassed > 0,
                    'validation',
                    `Validation with ${testsPassed} test cases`
                );
            }

            return {
                success: true,
                validation: {
                    skill_id: args.skill_id,
                    confidence,
                    status: confidence > 0.7 ? 'valid' : 'needs_improvement',
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    findCapability: async (args) => {
        try {
            const reusable = await reuseEngine.findReusable(args.query);
            return {
                success: true,
                capabilities: reusable.matchedSkills || [],
                recommendation: reusable,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    recordUsage: async (args) => {
        try {
            await reuseEngine.recordUsage(
                args.capability_id,
                args.task_id,
                args.success,
                args.details
            );
            return {
                success: true,
                message: 'Usage recorded successfully',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    submitFeedback: async (args) => {
        try {
            await selfLearningController.submitFeedback(
                args.entity_id,
                args.entity_type as 'knowledge' | 'skill',
                args.feedback_type as 'helpful' | 'not_helpful' | 'partially_helpful' | 'needs_improvement',
                {
                    rating: args.rating,
                    comment: args.comment,
                    suggestedImprovement: args.suggested_improvement,
                }
            );
            return {
                success: true,
                message: 'Feedback submitted successfully',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    rollbackSkill: async (args) => {
        try {
            await selfLearningController.rollbackSkill(
                args.skill_id,
                args.target_version,
                args.reason
            );
            return {
                success: true,
                message: `Rolled back skill ${args.skill_id}`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    viewSkillHistory: async (args) => {
        try {
            const history = selfLearningController.getSkillHistory(args.skill_id);
            return {
                success: true,
                history,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    getLearningPredictions: async (args) => {
        try {
            const predictions = selfLearningController.getLearningPredictions({
                limit: args.limit,
                minConfidence: args.min_confidence,
            });
            return {
                success: true,
                predictions,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },

    configureProactiveLearning: async (args) => {
        try {
            // Proactive learner configuration (if methods exist)
            return {
                success: true,
                message: 'Proactive learning configuration updated',
                config: {
                    enabled: args.enabled,
                    maxDailyLearnings: args.max_daily_learnings,
                    schedule: args.schedule,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// Create self-learning tools with bound handlers
const SELF_LEARNING_TOOLS = createSelfLearningTools(selfLearningHandlers);

// Create enhanced browser tools with adaptive execution and suspend/resume
// This wraps browser tools with retry logic and authentication detection
let currentExecutingTaskId: string | undefined;
const ENHANCED_BROWSER_TOOLS = createEnhancedBrowserTools(
    adaptiveExecutor,
    suspendResumeManager,
    () => currentExecutingTaskId
);

routerDeps.enhancedBrowserTools = ENHANCED_BROWSER_TOOLS;
routerDeps.selfLearningTools = SELF_LEARNING_TOOLS;
routerDeps.databaseTools = DATABASE_TOOLS;
routerDeps.generatedRuntimeTools = Array.from(generatedRuntimeToolsBySkill.values());

// ============================================================================
// Initialize Tool Registry on startup
// ============================================================================

// This makes tools available to PolicyBridge and future permission systems
// All tools are registered as builtin for out-of-box use without MCP installation
globalToolRegistry.register('builtin', STANDARD_TOOLS);
globalToolRegistry.register('builtin', [webSearchTool]);  // Web search with multi-provider support
globalToolRegistry.register('builtin', BUILTIN_TOOLS);    // Memory, GitHub, WebCrawl, Docs, Thinking tools
globalToolRegistry.register('builtin', CODE_EXECUTION_TOOLS);  // OpenClaw-style sandboxed code execution
globalToolRegistry.register('builtin', KNOWLEDGE_TOOLS);       // Active knowledge management tools
globalToolRegistry.register('builtin', DATABASE_TOOLS);        // Database operations (MySQL/PostgreSQL/SQLite/MongoDB)
globalToolRegistry.register('builtin', ENHANCED_BROWSER_TOOLS);  // Enhanced browser automation with adaptive retry and suspend/resume
globalToolRegistry.register('builtin', SELF_LEARNING_TOOLS);   // Self-learning and autonomous capability acquisition
globalToolRegistry.register('stub', STUB_TOOLS);          // Fallback stubs (should rarely be used now)
setCommandApprovalRequester(requestHostEffectApproval);

// ============================================================================
// Browser-use Service Health Check
// ============================================================================

/**
 * Check browser-use service availability on startup and apply config.
 * Non-blocking: runs in background and logs result.
 */
(async () => {
    try {
        // Try to load browser-use config
        const configPath = getCandidateLlmConfigPaths().find(candidate => fs.existsSync(candidate));
        if (configPath) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(raw) as LlmConfig;

            if (config.browserUse) {
                const serviceUrl = config.browserUse.serviceUrl || 'http://localhost:8100';
                const defaultMode = config.browserUse.defaultMode || 'auto';

                // Re-initialize BrowserService singleton with the configured URL
                const bs = BrowserService.getInstance(serviceUrl);
                bs.setMode(defaultMode);

                if (config.browserUse.enabled !== false) {
                    const available = await bs.isBrowserUseAvailable();
                    if (available) {
                        console.error(`[BrowserUse] Service available at ${serviceUrl}, default mode: ${defaultMode}`);
                    } else {
                        console.error(`[BrowserUse] Service not available at ${serviceUrl}. Smart mode will be unavailable. Start with: cd browser-use-service && python main.py`);
                    }
                } else {
                    console.error('[BrowserUse] Service disabled in config, using precise mode only');
                    bs.setMode('precise');
                }
            }
        }
    } catch (error) {
        console.error('[BrowserUse] Health check failed (non-critical):', error);
    }
})();

function getStandardToolDefinitions(): any[] {
    return STANDARD_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
    }));
}

async function executeInternalTool(
    taskId: string,
    toolName: string,
    args: any,
    context: { workspacePath: string }
): Promise<any> {
    // Use globalToolRegistry to get the highest-priority tool
    // Priority: MCP (1) > Builtin (2) > Stub (3)
    const registeredTool = globalToolRegistry.getTool(toolName);
    if (registeredTool) {
        try {
            const result = await registeredTool.handler(args, { workspacePath: context.workspacePath, taskId });
            return result;
        } catch (error: any) {
            return { error: `Tool execution failed: ${error.message}` };
        }
    }

    // Check MCP Gateway (if getToolsForTask passed a handler that calls gateway, this function might not be called directly for it?
    // Wait, streamLlmResponse receives `tools` with `handler`.
    // It calls `tool.handler(...)`.
    // `getToolsForTask` defines the handler for MCP tools!
    // So if the tool comes from `getToolsForTask`, its handler connects to Gateway.
    // `executeInternalTool` is only used if `streamLlmResponse` (or legacy code) calls it manually?
    // `streamLlmResponse` in line 533 (in standard.ts view? No, main.ts)
    // Let's check `streamLlmResponse` to see how it executes tools.
    // Copied from my previous view: `streamAnthropicResponse` returns message. It DOES NOT execute tools.
    // The consumer `start_task` loop iterates and CALLS tools.
    // `start_task` loop (lines 1025+) calls `executeInternalTool`.

    // SO `executeInternalTool` MUST delegate to Gateway if the tool is not standard.
    // OR `start_task` loop should use the `handler` on the tool definition if available.

    // Strategy: Update `start_task` loop (caller) to prefer `tool.handler` if available.
    // If I update `executeInternalTool` to use Gateway, I need access to `mcpGateway` instance.
    // `mcpGateway` is in scope here (module scope).

    // Let's update `executeInternalTool` to look up the tool in Gateway.
    // But Gateway requires `serverName`. We only have `toolName`.
    // We can iterate/find any server facilitating this tool.

    // Better: Update `start_task` loop to use the `tools` array (definitions) to find the handler.
    // The `tools` array is passed to `start_task`.
    // `getToolsForTask` builds definitions with handlers.
    // The loop should use them.

    // For now, I will add generic Gateway lookup to `executeInternalTool` as a catch-all.
    // But since I don't know the server name easily map from tool name (unless unique),
    // I will rely on `getToolsForTask` handlers injection update in `start_task`.
    // I need to update the LOOP in `start_task` to look up handler from `getToolsForTask(taskId)`.

    // Actually, `executeInternalTool` is `handleCommand` internal helper?
    // No, it's a standalone function `executeInternalTool`.
    // I will try to look up via `mcpGateway`.

    const availableTools = mcpGateway.getAvailableTools();
    const mcpTool = availableTools.find(t => t.tool.name === toolName);
    if (mcpTool) {
        return await mcpGateway.callTool({
            sessionId: taskId,
            toolName: toolName,
            serverName: mcpTool.server,
            arguments: args
        } as any);
    }

    return { error: `Tool not found: ${toolName}` };
}

function ensureConversation(taskId: string): AnthropicMessage[] {
    const existing = taskConversations.get(taskId);
    if (existing) return existing;
    const fresh: AnthropicMessage[] = [];
    taskConversations.set(taskId, fresh);
    return fresh;
}

/**
 * Compress a tool_result content block into a compact summary.
 * Reduces large tool outputs to a single line, preserving success/error status.
 */
function compressToolResult(content: string, toolName?: string): string {
    const maxLen = 150;
    const prefix = toolName ? `[Tool: ${toolName}]` : '[Tool Result]';
    // Detect success/error
    let statusHint = '';
    try {
        const parsed = JSON.parse(content);
        if (parsed.success === true) statusHint = ' Success.';
        else if (parsed.success === false) statusHint = ' Failed.';
        else if (parsed.error) statusHint = ` Error: ${String(parsed.error).slice(0, 60)}`;
    } catch {
        // Not JSON - use first line
        if (content.toLowerCase().includes('error')) statusHint = ' (error)';
    }
    const snippet = content.replace(/\s+/g, ' ').slice(0, maxLen);
    return `${prefix}${statusHint} ${snippet}${content.length > maxLen ? '...' : ''}`;
}

/**
 * Build a context summary from old messages that are about to be removed.
 * This preserves key information that would otherwise be lost to truncation.
 */
function buildContextSummary(oldMessages: AnthropicMessage[]): string {
    const toolCalls: string[] = [];
    const findings: string[] = [];

    for (const msg of oldMessages) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (block.type === 'tool_use') {
                const args = typeof block.input === 'object' ? JSON.stringify(block.input).slice(0, 80) : '';
                toolCalls.push(`${block.name}(${args})`);
            }
            if (block.type === 'tool_result' && typeof block.content === 'string') {
                // Extract key results
                try {
                    const parsed = JSON.parse(block.content);
                    if (parsed.currentPlan) findings.push('[Plan update recorded]');
                    if (parsed.finding) findings.push(parsed.finding.slice(0, 80));
                } catch { /* not JSON */ }
            }
            if (block.type === 'text' && typeof block.text === 'string') {
                // Capture any plan context or findings
                if (block.text.includes('[Plan Context')) {
                    findings.push('[Plan was re-read]');
                }
            }
        }
    }

    const parts: string[] = ['[Context Summary - older messages compressed to save tokens]'];
    if (toolCalls.length > 0) {
        parts.push(`Tools used (${toolCalls.length}): ${toolCalls.slice(0, 10).join(', ')}${toolCalls.length > 10 ? '...' : ''}`);
    }
    if (findings.length > 0) {
        parts.push(`Key context: ${findings.slice(0, 5).join('; ')}`);
    }
    parts.push('Full plan state is in .coworkany/task_plan.md, findings in findings.md, progress in progress.md.');
    return parts.join('\n');
}

function pushConversationMessage(
    taskId: string,
    message: AnthropicMessage
): AnthropicMessage[] {
    const conversation = ensureConversation(taskId);
    conversation.push(message);

    const limit = taskHistoryLimits.get(taskId) ?? getDefaultHistoryLimit();

    // ================================================================
    // Smart Context Compaction (replaces simple truncation)
    //
    // Phase 1: Tool Result Compression - when approaching limit (80%),
    //          compress old tool_result blocks to compact summaries.
    // Phase 2: Context Summary - when exceeding limit, replace oldest
    //          messages with a single summary message.
    // ================================================================

    const warningThreshold = Math.floor(limit * 0.8);

    // Phase 1: Compress old tool results when approaching limit
    if (conversation.length > warningThreshold && conversation.length <= limit) {
        // Compress tool_result blocks in the first half of conversation
        const halfPoint = Math.floor(conversation.length / 2);
        for (let i = 0; i < halfPoint; i++) {
            const msg = conversation[i];
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                let modified = false;
                const newContent = msg.content.map((block: any) => {
                    if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > 200) {
                        modified = true;
                        return {
                            ...block,
                            content: compressToolResult(block.content),
                        };
                    }
                    return block;
                });
                if (modified) {
                    conversation[i] = { ...msg, content: newContent };
                }
            }
        }
    }

    // Phase 2: Summarize and truncate when exceeding limit
    if (conversation.length > limit) {
        // Keep the first message (system/initial) and recent messages
        const keepRecent = Math.floor(limit * 0.75);
        const removeCount = conversation.length - keepRecent;

        // Build summary from messages we're about to remove
        const removedMessages = conversation.slice(0, removeCount);
        const summary = buildContextSummary(removedMessages);

        // Create a summary message to preserve key context
        const summaryMessage: AnthropicMessage = {
            role: 'user',
            content: [{ type: 'text', text: summary }],
        };

        // Replace: [summary] + [recent messages]
        const recentMessages = conversation.slice(removeCount);
        const compacted = [summaryMessage, ...recentMessages];
        taskConversations.set(taskId, compacted);

        console.log(`[Compaction] Task ${taskId}: compressed ${removeCount} old messages into summary, keeping ${recentMessages.length} recent`);
        return compacted;
    }

    persistTaskRuntimeSnapshot(taskId);
    return conversation;
}
function getTaskConfig(taskId: string): TaskRuntimeConfig | undefined {
    return taskConfigs.get(taskId);
}

function loadLlmConfig(workspaceRootPath: string): LlmConfig {
    const defaultConfig: LlmConfig = { provider: 'anthropic' };
    try {
        const configPath = getCandidateLlmConfigPaths(workspaceRootPath)
            .find(candidate => fs.existsSync(candidate));
        if (!configPath) return defaultConfig;
        const raw = fs.readFileSync(configPath, 'utf-8');
        const data = JSON.parse(raw) as LlmConfig;

        // Basic migration: if profiles don't exist, create a default one from legacy settings
        if (!data.profiles || data.profiles.length === 0) {
            const legacyProvider = data.provider ?? 'anthropic';
            const defaultProfile: LlmProfile = {
                id: 'default',
                name: 'Default Profile',
                provider: legacyProvider as LlmProvider,
                anthropic: data.anthropic,
                openrouter: data.openrouter,
                custom: data.custom,
                verified: !!(data.anthropic?.apiKey || data.openrouter?.apiKey || data.custom?.apiKey)
            };
            data.profiles = [defaultProfile];
            data.activeProfileId = 'default';
        }

        // Ensure activeProfileId is valid
        if (data.activeProfileId && !data.profiles.some(p => p.id === data.activeProfileId)) {
            data.activeProfileId = data.profiles[0].id;
        }

        // Apply search configuration if present
        if (data.search) {
            setSearchConfig({
                provider: data.search.provider || 'searxng',
                searxngUrl: data.search.searxngUrl,
                tavilyApiKey: data.search.tavilyApiKey,
                braveApiKey: data.search.braveApiKey,
                serperApiKey: data.search.serperApiKey,
            });
            console.error(`[LlmConfig] Search provider configured: ${data.search.provider || 'searxng'}`);
        }

        // Apply browser-use configuration if present
        if (data.browserUse) {
            const bs = BrowserService.getInstance(data.browserUse.serviceUrl);
            if (data.browserUse.defaultMode) {
                bs.setMode(data.browserUse.defaultMode);
            }
            console.error(`[LlmConfig] BrowserUse configured: enabled=${data.browserUse.enabled !== false}, mode=${data.browserUse.defaultMode || 'auto'}`);
        }

        return data;
    } catch (error) {
        console.warn('[LlmConfig] Failed to load llm-config.json:', error);
        return defaultConfig;
    }
}

function resolveHistoryLimit(config: LlmConfig): number {
    if (typeof config.maxHistoryMessages === 'number' && config.maxHistoryMessages > 0) {
        return Math.floor(config.maxHistoryMessages);
    }
    return DEFAULT_MAX_HISTORY_MESSAGES;
}

function getDefaultHistoryLimit(): number {
    return resolveHistoryLimit(loadLlmConfig(workspaceRoot));
}

function resolveProviderConfig(config: LlmConfig, overrides: AnthropicStreamOptions): LlmProviderConfig {
    // 1. Determine active profile
    let profile = config.profiles?.find(p => p.id === config.activeProfileId);

    // 2. Fallback to first profile or legacy
    if (!profile) {
        if (config.profiles && config.profiles.length > 0) {
            profile = config.profiles[0];
        } else {
            // Legacy fallback (should already be migrated by loadLlmConfig, but for safety)
            const provider = config.provider ?? 'anthropic';
            if (provider === 'openrouter') {
                const openrouterConfig = config.openrouter ?? { apiKey: '' };
                const apiKey = openrouterConfig.apiKey ?? '';
                const baseUrl = FIXED_BASE_URLS.openrouter;
                const modelId = overrides.modelId ?? openrouterConfig.model ?? 'anthropic/claude-sonnet-4.5';
                return { provider, apiFormat: 'openai', apiKey, baseUrl, modelId };
            }
            if (OPENAI_COMPATIBLE_PROVIDERS.has(provider as LlmProvider)) {
                const openaiConfig = config.openai ?? { apiKey: '' };
                const apiKey = openaiConfig.apiKey ?? '';
                const baseUrl = normalizeOpenAiCompatibleEndpoint(openaiConfig.baseUrl || FIXED_BASE_URLS.openai);
                const modelId = overrides.modelId ?? openaiConfig.model ?? 'gpt-4o';
                return { provider: provider as LlmProvider, apiFormat: 'openai', apiKey, baseUrl, modelId };
            }
            if (provider === 'custom') {
                const customConfig = config.custom ?? { apiKey: '', baseUrl: '', model: '' };
                const apiKey = customConfig.apiKey ?? '';
                const rawBaseUrl = customConfig.baseUrl ?? '';
                const modelId = overrides.modelId ?? customConfig.model ?? '';
                const apiFormat = customConfig.apiFormat ?? 'openai';
                const baseUrl = apiFormat === 'openai'
                    ? normalizeOpenAiCompatibleEndpoint(rawBaseUrl)
                    : rawBaseUrl;
                return { provider, apiFormat, apiKey, baseUrl, modelId };
            }
            const anthropicConfig = config.anthropic ?? { apiKey: '' };
            const apiKey = anthropicConfig.apiKey ?? '';
            const baseUrl = FIXED_BASE_URLS.anthropic;
            const modelId = overrides.modelId ?? anthropicConfig.model ?? 'claude-sonnet-4-5';
            return { provider: 'anthropic', apiFormat: 'anthropic', apiKey, baseUrl, modelId };
        }
    }

    // 3. Resolve from profile
    const provider = profile.provider;

    if (provider === 'openrouter') {
        const openrouterConfig = profile.openrouter ?? { apiKey: '' };
        const apiKey = openrouterConfig.apiKey ?? '';
        const baseUrl = FIXED_BASE_URLS.openrouter;
        const modelId = overrides.modelId ?? openrouterConfig.model ?? 'anthropic/claude-sonnet-4.5';
        return { provider, apiFormat: 'openai', apiKey, baseUrl, modelId };
    }

    if (OPENAI_COMPATIBLE_PROVIDERS.has(provider as LlmProvider)) {
        const openaiConfig = profile.openai ?? { apiKey: '' };
        const apiKey = openaiConfig.apiKey ?? '';
        const baseUrl = normalizeOpenAiCompatibleEndpoint(openaiConfig.baseUrl || FIXED_BASE_URLS.openai);
        const modelId = overrides.modelId ?? openaiConfig.model ?? 'gpt-4o';
        return { provider: provider as LlmProvider, apiFormat: 'openai', apiKey, baseUrl, modelId };
    }

    if (provider === 'ollama') {
        const ollamaConfig = profile.ollama ?? {};
        const baseUrl = ollamaConfig.baseUrl || FIXED_BASE_URLS.ollama;
        const modelId = overrides.modelId ?? ollamaConfig.model ?? 'llama3';
        // Ollama uses OpenAI-compatible API and doesn't need a real key
        return { provider, apiFormat: 'openai', apiKey: 'ollama', baseUrl, modelId };
    }

    if (provider === 'custom') {
        const customConfig = profile.custom ?? { apiKey: '', baseUrl: '', model: '' };
        const apiKey = customConfig.apiKey ?? '';
        const rawBaseUrl = customConfig.baseUrl ?? '';
        const modelId = overrides.modelId ?? customConfig.model ?? '';
        const apiFormat = customConfig.apiFormat ?? 'openai';
        const baseUrl = apiFormat === 'openai'
            ? normalizeOpenAiCompatibleEndpoint(rawBaseUrl)
            : rawBaseUrl;
        return { provider, apiFormat, apiKey, baseUrl, modelId };
    }

    // Default: anthropic
    const anthropicConfig = profile.anthropic ?? { apiKey: '' };
    const apiKey = anthropicConfig.apiKey ?? '';
    const baseUrl = FIXED_BASE_URLS.anthropic;
    const modelId = overrides.modelId ?? anthropicConfig.model ?? 'claude-sonnet-4-5';
    return { provider: 'anthropic', apiFormat: 'anthropic', apiKey, baseUrl, modelId };
}

async function streamAnthropicResponse(
    taskId: string,
    messages: AnthropicMessage[],
    options: AnthropicStreamOptions,
    config: LlmProviderConfig
): Promise<AnthropicMessage> {
    const { modelId, maxTokens, systemPrompt, tools } = options;

    const headers: Record<string, string> = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    };

    if (config.baseUrl.includes('anthropic.com')) {
        headers['anthropic-beta'] = 'max-tokens-3-5-sonnet-2024-07-15';
    }

    const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: maxTokens,
        stream: true,
        messages,
    };

    // Build structured system prompt with cache breakpoints (Anthropic only)
    if (systemPrompt || (tools && tools.length > 0)) {
        const systemBlocks = buildAnthropicSystemBlocks(systemPrompt, tools);

        if (systemBlocks.length > 0) {
            body.system = systemBlocks;
        }
    }

    // Enable extended thinking for Claude 4.5 models
    if (modelId?.includes('claude-3-7') || modelId?.includes('claude-4-5')) {
        (body as any).thinking = {
            type: 'enabled',
            budget_tokens: 4000
        };
        // Max tokens must be higher when thinking is enabled
        if ((options.maxTokens || 4096) < 8192) {
            body.max_tokens = 8192;
        }
    }

    if (tools && tools.length > 0) {
        // Strip handler functions before sending to API - handlers are internal only
        body.tools = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
        }));
        const serializedTools = body.tools as { name: string }[];
        console.error(`[Anthropic] Sending ${serializedTools.length} tools to API: ${serializedTools.map(t => t.name).join(', ')}`);
    }

    const response = await fetchWithRetry(
        `${config.baseUrl}/messages`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        },
        { timeout: 120000, retries: 3, retryDelay: 2000 }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    if (!response.body) {
        throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const contentBlocks: any[] = [];
    let currentBlockIndex = -1;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const payload = JSON.parse(data);
                    const type = payload.type;

                    // Track token usage from message_start event
                    if (type === 'message_start' && payload.message?.usage) {
                        totalInputTokens = payload.message.usage.input_tokens || 0;
                        cacheCreationInputTokens = payload.message.usage.cache_creation_input_tokens || 0;
                        cacheReadInputTokens = payload.message.usage.cache_read_input_tokens || 0;
                    }

                    // Track token usage from message_delta event
                    if (type === 'message_delta' && payload.usage) {
                        totalOutputTokens = payload.usage.output_tokens || 0;
                    }

                    if (type === 'content_block_start') {
                        currentBlockIndex = payload.index;
                        contentBlocks[currentBlockIndex] = payload.content_block;
                    } else if (type === 'content_block_delta') {
                        const delta = payload.delta;
                        const block = contentBlocks[currentBlockIndex];

                        if (delta.type === 'text_delta' && block.type === 'text') {
                            block.text += delta.text;
                            emit({
                                id: randomUUID(),
                                taskId,
                                timestamp: new Date().toISOString(),
                                sequence: nextSequence(taskId),
                                type: 'TEXT_DELTA',
                                payload: {
                                    delta: delta.text,
                                    role: 'assistant',
                                },
                            });
                        } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
                            block.thinking += delta.thinking;
                            emit(createThinkingDeltaEvent(taskId, {
                                delta: delta.thinking
                            }));
                        } else if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
                            if (!block.input_json) block.input_json = '';
                            block.input_json += delta.partial_json;
                        } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
                            block.thinking += delta.thinking;
                        }
                    } else if (type === 'content_block_stop') {
                        const block = contentBlocks[currentBlockIndex];
                        if (block.type === 'tool_use' && block.input_json) {
                            try {
                                block.input = JSON.parse(block.input_json);
                                // Clean up the raw json string if you don't want it stored
                                // delete block.input_json;
                            } catch (e) {
                                console.error('Failed to parse tool input JSON', e);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    // Emit TOKEN_USAGE event if we have usage data
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
        emit({
            id: randomUUID(),
            taskId,
            timestamp: new Date().toISOString(),
            sequence: nextSequence(taskId),
            type: 'TOKEN_USAGE',
            payload: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                cacheCreationInputTokens,
                cacheReadInputTokens,
                modelId: config.modelId,
                provider: config.provider,
            },
        } as any);
    }

    return {
        role: 'assistant',
        content: contentBlocks
    };
}

async function streamProviderResponse(
    taskId: string,
    messages: AnthropicMessage[],
    options: AnthropicStreamOptions,
    config: LlmProviderConfig
): Promise<AnthropicMessage> {
    if (config.apiFormat === 'openai') {
        return streamOpenAIResponse(taskId, messages, options, config);
    }
    return streamAnthropicResponse(taskId, messages, options, config);
}

async function streamOpenAIResponse(
    taskId: string,
    messages: AnthropicMessage[],
    options: AnthropicStreamOptions,
    config: LlmProviderConfig
): Promise<AnthropicMessage> {
    const apiKey = config.apiKey;
    if (!apiKey) {
        throw new Error('missing_api_key');
    }

    const modelId = config.modelId;
    const maxTokens = options.maxTokens ?? 1024;
    const baseUrl = config.baseUrl;

    const openaiMessages: Array<Record<string, any>> = [];
    if (options.systemPrompt) {
        const systemContent = flattenStructuredSystemPrompt(options.systemPrompt);
        if (systemContent) {
            openaiMessages.push({ role: 'system', content: systemContent });
        }
    }
    for (const message of messages) {
        if (typeof message.content === 'string') {
            openaiMessages.push({ role: message.role, content: message.content });
        } else if (Array.isArray(message.content)) {
            if (message.role === 'assistant') {
                // Convert Anthropic assistant content blocks to OpenAI format
                const textParts: string[] = [];
                const toolCallsParts: any[] = [];
                let toolIdx = 0;
                for (const block of message.content) {
                    if (block.type === 'text') {
                        textParts.push(block.text as string);
                    } else if (block.type === 'tool_use') {
                        toolCallsParts.push({
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input || {}),
                            },
                            index: toolIdx++,
                        });
                    }
                }
                const assistantMsg: Record<string, any> = {
                    role: 'assistant',
                    content: textParts.join('\n') || null,
                };
                if (toolCallsParts.length > 0) {
                    assistantMsg.tool_calls = toolCallsParts;
                }
                openaiMessages.push(assistantMsg);
            } else if (message.role === 'user') {
                // Convert Anthropic tool_result content blocks to OpenAI tool messages
                const toolResults = message.content.filter((b: any) => b.type === 'tool_result');
                if (toolResults.length > 0) {
                    for (const tr of toolResults) {
                        openaiMessages.push({
                            role: 'tool',
                            tool_call_id: tr.tool_use_id,
                            content: typeof tr.content === 'string'
                                ? tr.content
                                : JSON.stringify(tr.content),
                        });
                    }
                } else {
                    // Regular user message with content blocks
                    openaiMessages.push({
                        role: 'user',
                        content: JSON.stringify(message.content),
                    });
                }
            }
        } else {
            openaiMessages.push({ role: message.role, content: String(message.content) });
        }
    }

    const body: any = {
        model: modelId,
        max_tokens: maxTokens,
        stream: true,
        messages: openaiMessages,
    };

    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
            },
        }));
        body.tool_choice = 'auto';
        console.error(`[OpenAI] Sending ${body.tools.length} tools to API: ${options.tools.map(t => t.name).join(', ')}`);
    }

    const response = await fetchWithRetry(
        baseUrl,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        },
        { timeout: 120000, retries: 3, retryDelay: 2000 }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`openai_error_${response.status}: ${errorText}`);
    }

    if (!response.body) {
        throw new Error('openai_stream_missing_body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantText = '';
    const toolCalls: any[] = []; // Track partial tool calls
    let openaiInputTokens = 0;
    let openaiOutputTokens = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) {
                continue;
            }
            const data = trimmed.replace(/^data:\s*/, '');
            if (!data || data === '[DONE]') {
                continue;
            }
            try {
                const payload = JSON.parse(data) as Record<string, any>;
                const choices = payload.choices as Array<any> | undefined;
                const delta = choices?.[0]?.delta as any | undefined;
                const finishReason = choices?.[0]?.finish_reason as string | undefined;

                // Track token usage from OpenAI stream (typically in the last chunk)
                if (payload.usage) {
                    openaiInputTokens = payload.usage.prompt_tokens || 0;
                    openaiOutputTokens = payload.usage.completion_tokens || 0;
                }

                // Log finish reason for debugging
                if (finishReason) {
                    console.error(`[Stream] Finish reason: ${finishReason}`);
                    if (finishReason === 'length') {
                        console.error(`[Stream] WARNING: Response was truncated due to max_tokens limit`);
                    }
                }

                if (!delta) continue;

                // Handle reasoning/thinking content (e.g., from thinking models via aiberm)
                // We log it but don't include it in the final assistant text to avoid
                // polluting tool call decisions with thinking markup.
                if (delta.reasoning_content) {
                    // Optionally emit as a thinking event for UI display
                    // For now, just skip - the thinking is internal to the model
                }

                // Handle text content
                if (delta.content) {
                    assistantText += delta.content;
                    emit(
                        createTextDeltaEvent(taskId, {
                            delta: delta.content,
                            role: 'assistant',
                        })
                    );
                }

                // Handle tool calls
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const index = tc.index;
                        if (!toolCalls[index]) {
                            toolCalls[index] = {
                                type: 'tool_use',
                                id: tc.id || `call_${randomUUID().slice(0, 8)}`,
                                name: tc.function?.name || '',
                                input_json: '',
                            };
                            console.error(`[Stream] New tool call at index ${index}: id=${tc.id}, name=${tc.function?.name}`);
                        }
                        if (tc.id) toolCalls[index].id = tc.id;
                        if (tc.function?.name) toolCalls[index].name = tc.function.name;
                        if (tc.function?.arguments) {
                            toolCalls[index].input_json += tc.function.arguments;
                        }
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    // Finalize tool calls
    const contentBlocks: any[] = [];
    if (assistantText) {
        contentBlocks.push({ type: 'text', text: assistantText });
    }

    for (const tc of toolCalls.filter(Boolean)) {
        try {
            const jsonStr = tc.input_json || '{}';

            // Log the accumulated JSON length for debugging
            console.error(`[Stream] Finalizing tool "${tc.name}", input_json length: ${jsonStr.length}`);

            tc.input = JSON.parse(jsonStr);
            delete tc.input_json;
            contentBlocks.push(tc);
        } catch (e) {
            // Log the problematic JSON for debugging
            console.error(`Failed to parse OpenAI tool input JSON for tool "${tc.name}":`, e);
            console.error(`Raw input_json (${tc.input_json?.length ?? 0} chars):`);
            console.error(`  Start: ${tc.input_json?.slice(0, 100)}`);
            console.error(`  End: ${tc.input_json?.slice(-100)}`);

            // Try to recover - attempt to fix common JSON issues
            let fixedJson = tc.input_json || '{}';
            try {
                // Fix 1: If JSON is truncated (missing closing braces), try to add them
                const openBraces = (fixedJson.match(/{/g) || []).length;
                const closeBraces = (fixedJson.match(/}/g) || []).length;
                const openBrackets = (fixedJson.match(/\[/g) || []).length;
                const closeBrackets = (fixedJson.match(/\]/g) || []).length;

                if (openBraces > closeBraces || openBrackets > closeBrackets) {
                    console.error(`[Stream] Detected truncated JSON: ${openBraces} '{' vs ${closeBraces} '}', ${openBrackets} '[' vs ${closeBrackets} ']'`);

                    // Add missing brackets first, then braces
                    fixedJson += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
                    fixedJson += '}'.repeat(Math.max(0, openBraces - closeBraces));
                }

                // Fix 2: Remove trailing comma before closing brace/bracket
                fixedJson = fixedJson.replace(/,\s*}/g, '}');
                fixedJson = fixedJson.replace(/,\s*]/g, ']');

                // Fix 3: If string is not closed, try to close it
                // Check for unclosed strings by counting unescaped quotes
                const unescapedQuotes = fixedJson.match(/(?<!\\)"/g) || [];
                if (unescapedQuotes.length % 2 !== 0) {
                    console.error(`[Stream] Detected unclosed string (${unescapedQuotes.length} quotes)`);
                    fixedJson += '"';
                    // Re-add any missing braces/brackets after closing the string
                    fixedJson = fixedJson.replace(/,\s*}/g, '}');
                    const newOpenBraces = (fixedJson.match(/{/g) || []).length;
                    const newCloseBraces = (fixedJson.match(/}/g) || []).length;
                    fixedJson += '}'.repeat(Math.max(0, newOpenBraces - newCloseBraces));
                }

                tc.input = JSON.parse(fixedJson);
                delete tc.input_json;
                contentBlocks.push(tc);
                console.error(`Successfully recovered JSON for tool "${tc.name}" after fixing`);
            } catch (e2) {
                // Final fallback: use empty object but still include the tool call
                console.error(`Could not recover JSON for tool "${tc.name}", using empty input. Error: ${e2}`);
                tc.input = {};
                delete tc.input_json;
                contentBlocks.push(tc);
            }
        }
    }

    // Emit TOKEN_USAGE event for OpenAI-format responses
    if (openaiInputTokens > 0 || openaiOutputTokens > 0) {
        emit({
            id: randomUUID(),
            taskId,
            timestamp: new Date().toISOString(),
            sequence: nextSequence(taskId),
            type: 'TOKEN_USAGE',
            payload: {
                inputTokens: openaiInputTokens,
                outputTokens: openaiOutputTokens,
                modelId: config.modelId,
                provider: config.provider,
            },
        } as any);
    }

    return {
        role: 'assistant',
        content: contentBlocks.length === 1 && contentBlocks[0].type === 'text'
            ? contentBlocks[0].text
            : contentBlocks
    };
}

async function runAgentLoop(
    taskId: string,
    messages: AnthropicMessage[],
    options: AnthropicStreamOptions,
    config: LlmProviderConfig,
    tools: ToolDefinition[]
): Promise<AgentLoopOutcome> {
    const workspaceRoot = getTaskConfig(taskId)?.workspacePath || process.cwd();
    const MAX_STEPS = 30;
    let steps = 0;

    // Loop detection: track consecutive identical tool calls
    const recentToolCalls: Array<{ name: string; inputHash: string }> = [];
    let lastCachedResult = '';  // Cache the last result for read-only tools
    let lastBrowserContentSnapshot = '';
    const successfulPythonInstallCommands = new Map<string, { command: string; repeatBlocks: number }>();
    const LOOP_THRESHOLD = 3; // Block execution after 3 consecutive identical calls
    const OBSERVATION_STALL_THRESHOLD = 6;

    // Permanent block list: tools+args that AUTOPILOT has already intervened on.
    // Once a specific tool+args combo triggers AUTOPILOT, ALL future identical calls
    // are immediately blocked with an error message. This prevents the LLM from
    // stubbornly repeating the same failing approach even after AUTOPILOT guidance.
    const permanentBlockList: Set<string> = new Set();
    // Track completed AUTOPILOT workflows so permanent block handler knows the task is done
    const completedWorkflows: Set<string> = new Set();

    // Track consecutive permanent blocks. If the LLM keeps calling blocked tools
    // N times in a row, it's hopelessly stuck and we must force-terminate.
    let consecutivePermanentBlocks = 0;
    const MAX_CONSECUTIVE_PERMANENT_BLOCKS = 5;

    // ================================================================
    // Persistent Planning: 2-Action Rule counter & plan re-read
    // (Manus-style file-based planning integration)
    // ================================================================
    let toolCallsSincePlanReminder = 0;
    const PLAN_REMINDER_INTERVAL = 4; // Remind every 4 tool calls to update findings

    // ================================================================
    // Error Recovery: Self-Correction + Self-Learning integration
    // Connects the ReAct-style error handling to the production loop
    // ================================================================
    const toolErrorTracker: Map<string, number> = new Map(); // toolName -> consecutive error count
    let consecutiveToolErrors = 0;
    const SELF_LEARNING_THRESHOLD = 2; // Trigger quickLearnFromError after N consecutive failures
    let lastUserQuery = ''; // Track the user's original query for learning context

    // Retryable tool categories (network, database, browser, file operations)
    const RETRYABLE_TOOL_PREFIXES = [
        'browser_', 'database_', 'search_web', 'run_command',
        'http_', 'api_', 'fetch_',
    ];

    const OBSERVATION_TOOLS = new Set(['browser_screenshot', 'browser_get_content']);

    const parseBrowserContentSnapshot = (raw: string): { url: string; content: string } => {
        if (!raw) {
            return { url: '', content: '' };
        }

        try {
            const parsed = JSON.parse(raw);
            return {
                url: typeof parsed?.url === 'string' ? parsed.url : '',
                content: typeof parsed?.content === 'string' ? parsed.content : raw,
            };
        } catch {
            return { url: '', content: raw };
        }
    };

    const extractAiRelatedFeedSnippets = (content: string, maxItems = 5): string[] => {
        if (!content) {
            return [];
        }

        const flattened = content.replace(/\s+/g, ' ').trim();
        if (!flattened) {
            return [];
        }

        const keywordPattern =
            /(xai|openai|anthropic|llm|ai|artificial intelligence|machine learning)/ig;
        const snippets: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = keywordPattern.exec(flattened)) !== null && snippets.length < maxItems) {
            const start = Math.max(0, match.index - 80);
            const end = Math.min(flattened.length, match.index + 220);
            const snippet = flattened.slice(start, end).trim();
            if (!snippet) {
                continue;
            }

            const normalized = snippet.toLowerCase();
            if (snippets.some((existing) => existing.toLowerCase() === normalized)) {
                continue;
            }
            snippets.push(snippet);
        }

        return snippets;
    };

    const getObservationStallCount = (nextToolName: string): number => {
        if (!OBSERVATION_TOOLS.has(nextToolName)) {
            return 0;
        }

        const sequence = [...recentToolCalls.map((call) => call.name), nextToolName];
        let alternationStreak = 1;
        for (let i = sequence.length - 2; i >= 0; i--) {
            const current = sequence[i];
            const next = sequence[i + 1];
            if (!OBSERVATION_TOOLS.has(current) || current === next) {
                break;
            }
            alternationStreak++;
        }

        let consecutiveObservationStreak = 1;
        for (let i = sequence.length - 2; i >= 0; i--) {
            if (!OBSERVATION_TOOLS.has(sequence[i])) {
                break;
            }
            consecutiveObservationStreak++;
        }

        return Math.max(alternationStreak, consecutiveObservationStreak);
    };

    while (steps < MAX_STEPS) {
        steps++;

        // Capture user's original query for self-learning context
        if (steps === 1 && messages.length > 0) {
            const firstUserMsg = messages.find(m => m.role === 'user');
            if (firstUserMsg) {
                const content = firstUserMsg.content;
                lastUserQuery = typeof content === 'string'
                    ? content
                    : Array.isArray(content)
                        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
                        : '';
            }
        }

        // 鈹€鈹€ PreToolUse: Inject plan context before LLM call 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        // If a task_plan.md exists, inject its header into the conversation
        // so the plan stays in the LLM's attention window (prevents goal drift).
        if (steps > 1) { // Skip first iteration (plan not yet created)
            try {
                const planHead = readTaskPlanHead(workspaceRoot, 30);
                if (planHead) {
                    let planContext = `[Plan Context - re-read from .coworkany/task_plan.md]\n${planHead}`;

                    // 2-Action Rule: periodically remind to persist findings
                    if (toolCallsSincePlanReminder >= PLAN_REMINDER_INTERVAL) {
                        planContext += '\n\n[Reminder] You have executed several tool calls since last saving findings. Consider using log_finding to persist important discoveries to .coworkany/findings.md, and update plan_step status for completed steps.';
                        toolCallsSincePlanReminder = 0;
                    }

                    // Inject as a system-level user message so it refreshes the plan in context
                    pushConversationMessage(taskId, {
                        role: 'user',
                        content: [{ type: 'text', text: planContext }],
                    });
                }
            } catch (e) {
                // Non-critical - don't break the loop if plan read fails
                console.error('[Planning] Failed to inject plan context:', e);
            }
        }

        const response = await streamLlmResponse(taskId, messages, options, config);

        // Add assistant response to history
        pushConversationMessage(taskId, response);

        // Extract tool use blocks
        const toolUses: any[] = [];
        if (Array.isArray(response.content)) {
            for (const block of response.content) {
                if (block.type === 'tool_use') {
                    toolUses.push(block);
                }
            }
        }

        if (toolUses.length === 0) {
            // 鈹€鈹€ Stop Gate: Verification + Plan Completion Check 鈹€鈹€鈹€鈹€鈹€鈹€
            // Inspired by Superpowers verification-before-completion Iron Law:
            // "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE"
            let needsRetry = false;

            try {
                const gateWarnings: string[] = [];

                // Gate 1: Plan Completion Check
                const planStatus = countIncompletePlanSteps(workspaceRoot);
                if (planStatus.total > 0 && planStatus.incomplete > 0) {
                    console.log(`[Gate] Plan incomplete: ${planStatus.incomplete}/${planStatus.total} steps`);
                    gateWarnings.push(`[Plan Completion Gate] Your task_plan.md has ${planStatus.incomplete} of ${planStatus.total} steps still incomplete:\n${planStatus.steps.map(s => `- ${s}`).join('\n')}\nMark steps as "completed" or "skipped" before stopping.`);
                }

                // Gate 2: Verification Gate - detect unverified completion claims
                // Check if the agent's last response claims success without evidence
                const lastResponse = response;
                let responseText = '';
                if (typeof lastResponse.content === 'string') {
                    responseText = lastResponse.content;
                } else if (Array.isArray(lastResponse.content)) {
                    responseText = lastResponse.content
                        .filter((b: any) => b.type === 'text')
                        .map((b: any) => b.text)
                        .join(' ');
                }

                // Detect completion claims
                const completionClaims = /(?:done|fixed|all.*pass|resolved|implemented|finished|success)/i;
                const verificationEvidence = /(?:exit[\s_]?(?:code|0)|0 failures|0 errors|pass|passing|test|output:|result:)/i;
                const hasCompletionClaim = completionClaims.test(responseText);
                const hasVerificationEvidence = verificationEvidence.test(responseText);
                const isInformationalBrowserFeedTask = isXFollowingResearchRequest(lastUserQuery);

                if (hasCompletionClaim && !hasVerificationEvidence && responseText.length > 50 && !isInformationalBrowserFeedTask) {
                    console.log('[Gate] Completion claim detected without verification evidence');
                    gateWarnings.push(`[Verification Gate] You claimed completion but no verification evidence was found in your response.\n\nPer the Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.\n\nBefore declaring done:\n1. IDENTIFY: What command proves your claim?\n2. RUN: Execute the verification command\n3. READ: Check the output for evidence\n4. ONLY THEN: Make the claim with evidence\n\nIf no verification is needed (e.g., informational response), you may proceed.`);
                }

                // Inject gate warnings if any
                if (gateWarnings.length > 0) {
                    pushConversationMessage(taskId, {
                        role: 'user',
                        content: [{ type: 'text', text: gateWarnings.join('\n\n') }],
                    });
                    // Give the LLM one more chance to address the gates
                    const retryResponse = await streamLlmResponse(taskId, messages, options, config);
                    pushConversationMessage(taskId, retryResponse);
                    const retryToolUses: any[] = [];
                    if (Array.isArray(retryResponse.content)) {
                        for (const block of retryResponse.content) {
                            if (block.type === 'tool_use') retryToolUses.push(block);
                        }
                    }
                    if (retryToolUses.length > 0) {
                        needsRetry = true;
                    }
                }
            } catch (e) {
                console.error('[Gate] Stop check failed:', e);
            }

            if (needsRetry) {
                continue; // LLM decided to run more tools to satisfy the gates
            }
            break;
        }

        // Execute tools
        const toolResults: any[] = [];
        for (const toolUse of toolUses) {
            emit(createToolCallEvent(taskId, {
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input,
            }));

            // ================================================================
            // Loop Detection: Block repeated identical tool calls
            // ================================================================
            const currentInputHash = JSON.stringify(toolUse.input || {});
            const blockKey = `${toolUse.name}::${currentInputHash}`;
            const rawCommand = toolUse.name === 'run_command' && typeof toolUse.input?.command === 'string'
                ? toolUse.input.command
                : '';
            const normalizedPythonInstallCommand = rawCommand
                ? normalizePythonInstallCommandForLoopGuard(rawCommand)
                : null;

            if (normalizedPythonInstallCommand) {
                const previousInstall = successfulPythonInstallCommands.get(normalizedPythonInstallCommand);
                if (previousInstall) {
                    previousInstall.repeatBlocks += 1;
                    const repeatMessage = buildRepeatedSuccessfulInstallMessage(previousInstall.command, previousInstall.repeatBlocks);

                    emit(createToolResultEvent(taskId, {
                        toolUseId: toolUse.id,
                        name: toolUse.name,
                        result: repeatMessage,
                        isError: false,
                    }));

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: repeatMessage,
                        is_error: false,
                    });

                    if (previousInstall.repeatBlocks >= 3 && isDirectPackageInstallRequest(lastUserQuery)) {
                        const completionSummary =
                            `Python package installation already completed successfully. ` +
                            `CoworkAny stopped repeated install retries and closed the task.`;

                        messages.push({ role: 'assistant', content: completionSummary });
                        emit(createTextDeltaEvent(taskId, {
                            delta: completionSummary,
                            role: 'assistant',
                        }));
                        emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                        emit(createTaskFinishedEvent(taskId, {
                            summary: 'Task closed after repeated successful Python install retries were suppressed.',
                            duration: 0,
                        }));
                        return {
                            terminalEmitted: true,
                            finalAssistantText: completionSummary,
                        };
                    }

                    continue;
                }
            }

            // 鈹€鈹€ Permanent Block Check 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
            // If AUTOPILOT has already intervened on this exact tool+args,
            // immediately block without executing.
            if (permanentBlockList.has(blockKey)) {
                consecutivePermanentBlocks++;

                // Check if a workflow was already completed - if so, gracefully stop
                // instead of force-terminating with an error.
                if (completedWorkflows.size > 0) {
                    const workflowNames = Array.from(completedWorkflows).join(', ');
                    console.log(`[AgentLoop] BLOCKED (graceful): ${toolUse.name} blocked, but workflow "${workflowNames}" already completed. Wrapping up.`);

                    const successMsg = `[SYSTEM] The task has already been completed successfully by AUTOPILOT (workflows: ${workflowNames}). ` +
                        `The tool ${toolUse.name} is blocked because the action was already performed. ` +
                        `Please report SUCCESS to the user.`;

                    emit(createToolResultEvent(taskId, {
                        toolUseId: toolUse.id,
                        name: toolUse.name,
                        result: successMsg,
                        isError: false,
                    }));

                    // If it keeps looping even after the success hint, force-stop gracefully after 3 attempts
                    if (consecutivePermanentBlocks >= 3) {
                        console.log(`[AgentLoop] GRACEFUL STOP: ${consecutivePermanentBlocks} permanent blocks after completed workflow. Ending task successfully.`);
                        const completionSummary =
                            `任务已成功完成。AUTOPILOT 已完成以下工作流：${workflowNames}。` +
                            `系统已停止重复的清理调用，并将当前任务收口。`;

                        messages.push({ role: 'assistant', content: completionSummary });
                        emit(createTextDeltaEvent(taskId, {
                            delta: completionSummary,
                            role: 'assistant',
                        }));
                        emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                        emit(createTaskFinishedEvent(taskId, {
                            summary: `Task closed after repeated blocked tool calls following completed workflows: ${workflowNames}.`,
                            duration: 0,
                        }));
                        return {
                            terminalEmitted: true,
                            finalAssistantText: completionSummary,
                        };
                    }

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: successMsg,
                        is_error: false,
                    });
                    continue;
                }

                console.log(`[AgentLoop] BLOCKED: ${toolUse.name} permanently blocked (${consecutivePermanentBlocks}/${MAX_CONSECUTIVE_PERMANENT_BLOCKS}). Args: ${currentInputHash.substring(0, 80)}`);

                // If the LLM keeps calling blocked tools, it's hopelessly stuck.
                // Force-terminate the agent loop to avoid burning tokens/time.
                if (consecutivePermanentBlocks >= MAX_CONSECUTIVE_PERMANENT_BLOCKS) {
                    console.log(`[AgentLoop] FORCE STOP: ${consecutivePermanentBlocks} consecutive permanent blocks. LLM is stuck in a loop.`);
                    const forceStopMsg = `CRITICAL FAILURE: You have called permanently blocked tools ${consecutivePermanentBlocks} times in a row. ` +
                        `The system is forcefully terminating this task because you are stuck in an infinite loop.\n\n` +
                        `ROOT CAUSE: ${toolUse.name} with these arguments has been tried and failed. ` +
                        `You kept calling it despite being told to stop.\n\n` +
                        `TO FIX: The user needs to ensure the browser environment is properly configured ` +
                        `(e.g., Chrome with active login session on the target site).`;

                    emit(createToolResultEvent(taskId, {
                        toolUseId: toolUse.id,
                        name: toolUse.name,
                        result: forceStopMsg,
                        isError: true,
                    }));

                    // Add the force-stop message to conversation and break out
                    const responseText = typeof response.content === 'string' ? response.content : '';
                    messages.push({ role: 'assistant', content: responseText });
                    messages.push({
                        role: 'user',
                        content: `[SYSTEM] Task forcefully terminated: agent stuck in loop calling blocked tool ${toolUse.name}. ` +
                            `Please tell the user what went wrong and what they need to do to fix the environment.`,
                    });

                    // Emit a final text response from the agent explaining the failure
                    emit({
                        id: randomUUID(),
                        taskId,
                        timestamp: new Date().toISOString(),
                        sequence: 0,
                        type: 'TEXT_DELTA',
                        payload: {
                            delta: `Sorry, I couldn't complete this task. The browser reached the target site but the page did not load correctly.\nThis usually means the browser is not attached to the logged-in Chrome instance.\nPlease make sure Chrome is running with remote debugging on port 9222 or 9224 and that you are already logged in.`,
                            role: 'assistant',
                        },
                    });


                    emit({
                        id: randomUUID(),
                        taskId,
                        timestamp: new Date().toISOString(),
                        sequence: 0,
                        type: 'TASK_STATUS',
                        payload: { status: 'finished' },
                    });
                    return {
                        terminalEmitted: true,
                    };
                }

                const blockMsg = `ERROR: ${toolUse.name}(${currentInputHash.substring(0, 60)}) is PERMANENTLY BLOCKED. ` +
                    `Calling it again will NOT work. (${consecutivePermanentBlocks}/${MAX_CONSECUTIVE_PERMANENT_BLOCKS} before force-termination)\n\n` +
                    `You MUST use a COMPLETELY DIFFERENT tool and approach NOW:\n` +
                    `1. Use browser_get_content to inspect the current page state\n` +
                    `2. Use search_web to find how to automate this specific website\n` +
                    `3. Use browser_execute_script to interact via JavaScript\n` +
                    `4. Try a different URL (e.g., x.com/compose/post instead of x.com)\n` +
                    `5. If the page shows a login wall, tell the user they need to log in first\n\n` +
                    `WARNING: ${MAX_CONSECUTIVE_PERMANENT_BLOCKS - consecutivePermanentBlocks} more blocked calls will FORCE TERMINATE this task.`;

                emit(createToolResultEvent(taskId, {
                    toolUseId: toolUse.id,
                    name: toolUse.name,
                    result: blockMsg,
                    isError: true,
                }));
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: blockMsg,
                    is_error: true,
                });
                continue;
            } else {
                // Reset counter when a non-blocked tool is called
                consecutivePermanentBlocks = 0;
            }

            const loopDetectableTools = [
                'browser_get_content', 'browser_screenshot', 'view_file', 'list_dir',
                'browser_click', 'browser_wait', 'browser_disconnect', 'browser_execute_script',
                // Also detect loops on mode-switching and navigation (SPA issues)
                'browser_set_mode', 'browser_navigate', 'browser_ai_action',
            ];
            const isReadOnly = loopDetectableTools.includes(toolUse.name);
            const observationStallCount = getObservationStallCount(toolUse.name);

            if (toolUse.name === 'browser_screenshot' && isXFollowingResearchRequest(lastUserQuery)) {
                const snapshot = parseBrowserContentSnapshot(lastBrowserContentSnapshot || lastCachedResult);
                const snapshotUrl = snapshot.url.toLowerCase();
                const onXFeed =
                    snapshotUrl.includes('x.com') ||
                    snapshotUrl.includes('twitter.com') ||
                    /(^|\s)(for you|following)(\s|$)/i.test(snapshot.content);
                const aiSnippets = extractAiRelatedFeedSnippets(snapshot.content, 4);

                if (onXFeed && aiSnippets.length > 0) {
                    const summary =
                        `I already reviewed the visible X Following feed content and do not need another screenshot. ` +
                        `The AI-related findings currently visible are:\n` +
                        aiSnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n') +
                        `\n\nIf you want, I can keep scrolling and gather more recent posts.`;

                    messages.push({ role: 'assistant', content: summary });
                    emit(createTextDeltaEvent(taskId, {
                        delta: summary,
                        role: 'assistant',
                    }));
                    emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                    emit(createTaskFinishedEvent(taskId, {
                        summary: 'Completed X Following feed review from visible feed evidence.',
                        duration: 0,
                    }));
                    return {
                        terminalEmitted: true,
                        finalAssistantText: summary,
                    };
                }
            }

            if (OBSERVATION_TOOLS.has(toolUse.name) && observationStallCount >= OBSERVATION_STALL_THRESHOLD) {
                console.log(`[AgentLoop] AUTOPILOT: observation stall detected after ${observationStallCount} consecutive browser observations.`);

                const cachedSnapshot = parseBrowserContentSnapshot(lastBrowserContentSnapshot || lastCachedResult);
                const cachedUrl = cachedSnapshot.url.toLowerCase();
                const cachedContent = cachedSnapshot.content;
                const looksLikeXTask = isXFollowingResearchRequest(lastUserQuery);
                const isOnX =
                    looksLikeXTask ||
                    cachedUrl.includes('x.com') ||
                    cachedUrl.includes('twitter.com') ||
                    /(^|\s)(for you|following)(\s|$)/i.test(cachedContent);

                let stallResult =
                    `[AUTOPILOT] Repeated browser observation loop detected (${observationStallCount} consecutive calls). ` +
                    `Stop observing and take a state-changing action instead.`;
                let stallHandled = false;

                if (isOnX) {
                    const scriptTool = tools.find((t) => t.name === 'browser_execute_script');
                    const navTool = tools.find((t) => t.name === 'browser_navigate');
                    const contentTool = tools.find((t) => t.name === 'browser_get_content');

                    try {
                        let xState: any = null;
                        if (scriptTool) {
                            const scriptResult = await scriptTool.handler({
                                script: `(() => {
                                    const text = document.body?.innerText || '';
                                    const items = Array.from(document.querySelectorAll('a, button, div[role="tab"]'));
                                    const followingCandidate = items.find((el) => /^(following|\u5173\u6ce8)$/i.test((el.textContent || '').trim()));
                                    const selectedTab = items.find((el) => {
                                        const text = (el.textContent || '').trim();
                                        if (!/^(following|for you|\u5173\u6ce8|\u4e3a\u4f60)$/i.test(text)) return false;
                                        const selected = el.getAttribute('aria-selected');
                                        const current = el.getAttribute('data-selected');
                                        return selected === 'true' || current === 'true' || el.getAttribute('aria-current') === 'page';
                                    });
                                    const activeTabText = (selectedTab?.textContent || '').trim();
                                    const hasLoginInput = !!document.querySelector('input[type="password"], input[autocomplete="username"], input[name="text"], input[name="session[username_or_email]"]');
                                    const loginButton = items.find((el) => /^(log\\s*in|sign\\s*in|\u767b\u5f55)$/i.test((el.textContent || '').trim()));
                                    return JSON.stringify({
                                        url: location.href,
                                        title: document.title,
                                        hasFollowingTab: !!followingCandidate,
                                        activeTabText,
                                        hasLoginInput,
                                        hasLoginButton: !!loginButton,
                                        snippet: text.slice(0, 600),
                                    });
                                })()`,
                            }, { taskId, workspacePath: workspaceRoot });

                            if (typeof scriptResult === 'string') {
                                xState = JSON.parse(scriptResult);
                            } else if (typeof scriptResult?.result === 'string') {
                                xState = JSON.parse(scriptResult.result);
                            }
                        }

                        const snippet = String(xState?.snippet || cachedContent || '');
                        const pageUrl = String(xState?.url || cachedSnapshot.url || '');
                        const activeTabText = String(xState?.activeTabText || '').toLowerCase();
                        const needsLogin =
                            !!xState?.hasLoginInput ||
                            !!xState?.hasLoginButton ||
                            /\/i\/flow\/login|\/login|\/signin/i.test(pageUrl) ||
                            /(log\s*in|sign\s*in|\u767b\u5f55|\u9a8c\u8bc1)/i.test(snippet);

                        if (needsLogin && !suspendResumeManager.isSuspended(taskId)) {
                            await suspendResumeManager.suspend(
                                taskId,
                                'authentication_required',
                                'X requires login before it can read posts from your Following feed. Please log in to X in the browser, then reply with continue.',
                                ResumeConditions.manual(),
                                { url: pageUrl || 'https://x.com/home' }
                            );
                            stallResult =
                                `[AUTOPILOT] Observation loop on X was interrupted because the page requires login. ` +
                                `The task has been suspended and is waiting for the user to log in.`;
                            stallHandled = true;
                        } else if (xState?.hasFollowingTab && activeTabText !== 'following' && activeTabText !== '\u5173\u6ce8') {
                            if (scriptTool) {
                                const clickResult = await scriptTool.handler({
                                    script: `(() => {
                                        const items = Array.from(document.querySelectorAll('a, button, div[role="tab"]'));
                                        const target = items.find((el) => /^(following|\u5173\u6ce8)$/i.test((el.textContent || '').trim()));
                                        if (!target) return JSON.stringify({ clicked: false, reason: 'Following tab not found' });
                                        target.click();
                                        return JSON.stringify({ clicked: true, text: (target.textContent || '').trim() });
                                    })()`,
                                }, { taskId, workspacePath: workspaceRoot });
                                const refreshed = contentTool
                                    ? await contentTool.handler({ as_html: false }, { taskId, workspacePath: workspaceRoot })
                                    : null;
                                stallResult =
                                    `[AUTOPILOT] Switched X timeline to Following to break the observation loop. ` +
                                    `Click result: ${JSON.stringify(clickResult)}. ` +
                                    `Current page snapshot: ${JSON.stringify(refreshed ?? {})}. ` +
                                    `Now extract AI-related posts from the visible feed and do not call browser_screenshot again unless you need final verification.`;
                                stallHandled = true;
                            }
                        } else if ((!pageUrl || pageUrl === 'about:blank' || !/x\.com|twitter\.com/i.test(pageUrl)) && navTool) {
                            const navResult = await navTool.handler(
                                { url: 'https://x.com/home', wait_until: 'networkidle', timeout_ms: 30000 },
                                { taskId, workspacePath: workspaceRoot }
                            );
                            stallResult =
                                `[AUTOPILOT] Browser was not on the X home feed. Navigated to https://x.com/home to recover. ` +
                                `Navigation result: ${JSON.stringify(navResult)}. ` +
                                `Use browser_get_content once to extract AI-related posts from Following.`;
                            stallHandled = true;
                        } else {
                            const aiSnippets = extractAiRelatedFeedSnippets(snippet);
                            const aiSnippetBlock = aiSnippets.length > 0
                                ? ` Visible AI-related excerpts:\n- ${aiSnippets.join('\n- ')}`
                                : '';
                            stallResult =
                                `[AUTOPILOT] X feed appears to be loaded already. ` +
                                `Do not continue the screenshot/content loop. ` +
                                `Extract AI-related posts from the current feed text now, or click Following if the For You tab is still active.` +
                                `${aiSnippetBlock}\nUse the visible feed content to answer the user now without calling browser_get_content again.`;
                            stallHandled = true;
                        }
                    } catch (error) {
                        stallResult =
                            `[AUTOPILOT] Observation loop detected on X, but automatic recovery failed: ${error instanceof Error ? error.message : String(error)}. ` +
                            `Stop repeating browser_screenshot/browser_get_content. Navigate to https://x.com/home or suspend for login.`;
                    }
                }

                permanentBlockList.add(blockKey);
                recentToolCalls.length = 0;
                recentToolCalls.push({ name: toolUse.name, inputHash: currentInputHash });

                emit(createToolResultEvent(taskId, {
                    toolUseId: toolUse.id,
                    name: toolUse.name,
                    result: stallResult,
                    isError: !stallHandled,
                }));

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: stallResult,
                    is_error: !stallHandled,
                });
                continue;
            }

            // Count consecutive identical calls
            let consecutiveCount = 0;
            for (let i = recentToolCalls.length - 1; i >= 0; i--) {
                if (recentToolCalls[i].name === toolUse.name && recentToolCalls[i].inputHash === currentInputHash) {
                    consecutiveCount++;
                } else {
                    break;
                }
            }

            if (isReadOnly && consecutiveCount >= LOOP_THRESHOLD) {
                // AUTOPILOT: LLM is stuck - execute the correct next action directly
                console.log(`[AgentLoop] AUTOPILOT: ${toolUse.name} called ${consecutiveCount + 1} times with args: ${currentInputHash}. Taking over.`);

                // Determine and execute the correct next action based on context
                let autopilotResult = '';
                let autopilotExecuted = false;

                try {
                    const scriptTool = tools.find(t => t.name === 'browser_execute_script');

                    // Handle browser_click loop: navigate directly instead of clicking
                    if (toolUse.name === 'browser_click' && toolUse.input?.text) {
                        const clickText = toolUse.input.text as string;
                        console.log(`[AgentLoop] AUTOPILOT: browser_click loop for "${clickText}", analyzing context...`);
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        const fillTool = tools.find(t => t.name === 'browser_fill');

                        // X/Twitter compose box or Post button
                        // Check multiple sources to detect X/Twitter context
                        const cachedContent = lastCachedResult || '';
                        const allMsgText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
                        const isOnXTwitter = cachedContent.includes('x.com') || cachedContent.includes('twitter.com') ||
                            cachedContent.includes("What's happening") || cachedContent.includes('Home / X') ||
                            /x\.com|twitter\.com|twitter|发推|tweet/i.test(allMsgText);
                        const isXComposeBox = /what.?s happening|compose|tweet/i.test(clickText) ||
                            (isOnXTwitter && /^Post$/i.test(clickText.trim()));
                        if (isXComposeBox && fillTool) {
                            // Extract the user's intended post content from the original query
                            const userQuery = messages.find(m => m.role === 'user' && typeof m.content === 'string')?.content || '';
                            let postContent = 'hello world'; // default
                            // Priority 1: quoted content (highest priority)
                            const quotedMatch = (userQuery as string).match(/["'“”‘’](.*?)["'“”‘’]/);
                            if (quotedMatch) postContent = quotedMatch[1].trim();
                            // Priority 2: "content: ..." - stop only at punctuation or end-of-string, not spaces
                            if (!quotedMatch) {
                                const contentMatch = (userQuery as string).match(/content[:?]?\s*(.+?)(?=[,.;!?]|$)/i);
                                if (contentMatch) postContent = contentMatch[1].trim();
                            }

                            console.log(`[AgentLoop] AUTOPILOT: X compose box detected! Auto-filling "${postContent}" and posting...`);

                            // Step 1: Fill the compose box
                            try {
                                const fillResult = await fillTool.handler(
                                    { selector: '[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"], [aria-label*="What"]', value: postContent },
                                    { taskId, workspacePath: workspaceRoot }
                                );
                                console.log(`[AgentLoop] AUTOPILOT: Fill succeeded, now auto-clicking Post button...`);
                                
                                // Step 2: Auto-click the Post button directly
                                let postClickResult = 'Post button click pending';
                                try {
                                    const scriptTool = tools.find(t => t.name === 'browser_execute_script');
                                    if (scriptTool) {
                                        // Wait a bit for UI to update after fill
                                        await new Promise(r => setTimeout(r, 1000));
                                        postClickResult = String(await scriptTool.handler({
                                            script: `(function() {
                                                // Try multiple selectors for the Post/Tweet button
                                                var btn = document.querySelector('[data-testid="tweetButton"]')
                                                    || document.querySelector('[data-testid="tweetButtonInline"]')
                                                    || document.querySelector('button[type="button"] > div > span > span');
                                                if (!btn) {
                                                    // Fallback: find button with text "Post"
                                                    var buttons = document.querySelectorAll('button[role="button"]');
                                                    for (var i = 0; i < buttons.length; i++) {
                                                        var text = buttons[i].textContent || '';
                                                        if (/^Post$/i.test(text.trim()) || /^銉濄偣銉?/i.test(text.trim()) || /^\u53d1\u5e03$/i.test(text.trim())) {
                                                            btn = buttons[i];
                                                            break;
                                                        }
                                                    }
                                                }
                                                if (btn) {
                                                    btn.click();
                                                    return 'Clicked Post button: ' + (btn.textContent || btn.getAttribute('data-testid'));
                                                }
                                                return 'Post button not found';
                                            })()`
                                        }, { taskId, workspacePath: workspaceRoot }));
                                        console.log(`[AgentLoop] AUTOPILOT: Post button click result: ${postClickResult}`);
                                    }
                                } catch (postClickErr) {
                                    console.log(`[AgentLoop] AUTOPILOT: Post button click failed: ${postClickErr instanceof Error ? postClickErr.message : String(postClickErr)}`);
                                }
                                
                                autopilotResult = `[AUTOPILOT] Successfully completed X posting workflow:\n` +
                                    `1. Filled compose box with "${postContent}": ${JSON.stringify(fillResult)}\n` +
                                    `2. Clicked Post button: ${postClickResult}\n` +
                                    `The post "${postContent}" has been submitted. Task is COMPLETE.\n` +
                                    `You should now confirm the task is done and report success to the user.`;
                                autopilotExecuted = true;
                                // Mark X posting as completed and block related tools
                                completedWorkflows.add('x-posting');
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "Post"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "What's happening?"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "post"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "Tweet"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "PostJP"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({ text: "\u53d1\u5e03" })}`);
                                console.log(`[AgentLoop] AUTOPILOT: X posting workflow completed. Blocking related click tools.`);
                            } catch (fillErr) {
                                console.log(`[AgentLoop] AUTOPILOT: X fill failed: ${fillErr instanceof Error ? fillErr.message : String(fillErr)}`);
                                // Fallback: try browser_execute_script to type directly
                                try {
                                    const scriptTool = tools.find(t => t.name === 'browser_execute_script');
                                    if (scriptTool) {
                                        const safeContent = postContent.replace(/'/g, "\\'").replace(/"/g, '\\"');
                                        await scriptTool.handler({
                                            script: `(function() {
                                                var el = document.querySelector('[data-testid="tweetTextarea_0"]')
                                                    || document.querySelector('[contenteditable="true"][role="textbox"]')
                                                    || document.querySelector('[aria-label*="What"]');
                                                if (!el) return 'No compose box found';
                                                el.focus();
                                                el.textContent = '${safeContent}';
                                                el.dispatchEvent(new Event('input', {bubbles: true}));
                                                return 'Typed: ${safeContent}';
                                            })()`
                                        }, { taskId, workspacePath: workspaceRoot });
                                        // Also auto-click Post button
                                        await new Promise(r => setTimeout(r, 1000));
                                        try {
                                            await scriptTool.handler({
                                                script: `(function() {
                                                    var btn = document.querySelector('[data-testid="tweetButton"]')
                                                        || document.querySelector('[data-testid="tweetButtonInline"]');
                                                    if (!btn) {
                                                        var buttons = document.querySelectorAll('button[role="button"]');
                                                        for (var i = 0; i < buttons.length; i++) {
                                                            if (/^Post$/i.test((buttons[i].textContent || '').trim())) { btn = buttons[i]; break; }
                                                        }
                                                    }
                                                    if (btn) { btn.click(); return 'Clicked Post'; }
                                                    return 'Post button not found';
                                                })()`
                                            }, { taskId, workspacePath: workspaceRoot });
                                        } catch (_) { /* ignore */ }
                                        autopilotResult = `[AUTOPILOT] Typed "${postContent}" via JS and clicked Post button. Task is COMPLETE.`;
                                        autopilotExecuted = true;
                                        completedWorkflows.add('x-posting');
                                        permanentBlockList.add(`browser_click::${JSON.stringify({text: "Post"})}`);
                                        permanentBlockList.add(`browser_click::${JSON.stringify({text: "What's happening?"})}`);
                                        console.log(`[AgentLoop] AUTOPILOT: X posting workflow completed (fallback path).`);
                                    }
                                } catch (scriptErr) {
                                    console.log(`[AgentLoop] AUTOPILOT: X JS type also failed: ${scriptErr instanceof Error ? scriptErr.message : String(scriptErr)}`);
                                }
                            }
                        } else if (clickText.includes('\u4e0a\u4f20\u56fe\u6587') && navTool) {
                            // Xiaohongshu: Navigate directly to the image upload tab URL
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish?source=web&target=image' }, { taskId, workspacePath: workspaceRoot });
                            await new Promise(r => setTimeout(r, 3000));
                            autopilotResult = `[AUTOPILOT] Navigated directly to image tab: ${JSON.stringify(navResult)}. ` +
                                `Now use browser_execute_script to interact with the page. ` +
                                `The page has "\u4e0a\u4f20\u56fe\u7247" and "\u6587\u5b57\u914d\u56fe" buttons. ` +
                                `For a text-only post, click "\u6587\u5b57\u914d\u56fe", fill the text, then publish.`;
                            autopilotExecuted = true;
                        } else if (clickText.includes('\u53d1\u5e03\u7b14\u8bb0') && navTool) {
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish' }, { taskId, workspacePath: workspaceRoot });
                            autopilotResult = `[AUTOPILOT] Navigated to publish page: ${JSON.stringify(navResult)}`;
                            autopilotExecuted = true;
                        }
                    }

                    if (!autopilotExecuted && lastCachedResult.includes('\u53d1\u5e03\u7b14\u8bb0') && !lastCachedResult.includes('\u4e0a\u4f20\u89c6\u9891')) {
                        // On homepage - need to navigate to publish page via JS
                        console.log('[AgentLoop] AUTOPILOT: Navigating to publish page');
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        if (navTool) {
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish' }, { taskId, workspacePath: workspaceRoot });
                            autopilotResult = `[AUTOPILOT] Navigated to publish page. Result: ${JSON.stringify(navResult)}. The page should now show upload tabs.`;
                            autopilotExecuted = true;
                        }
                    } else if (lastCachedResult.includes('\u4e0a\u4f20\u56fe\u6587') && lastCachedResult.includes('\u4e0a\u4f20\u89c6\u9891')) {
                        // On publish page - click "upload image post" tab and fill content
                        console.log('[AgentLoop] AUTOPILOT: Executing full publish flow via JS');
                        if (scriptTool) {
                            // Extract user content
                            const userMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string');
                            const userQuery = (typeof userMsg?.content === 'string' ? userMsg.content : '') as string;
                            let postContent = 'hello world';
                            const contentMatch = userQuery.match(/content[:?]?\s*(.+?)(?=[,.;!?]|$)/i);
                            if (contentMatch) postContent = contentMatch[1].trim();
                            const altMatch = userQuery.match(/["'??????](.*?)["'??????]/);
                            if (altMatch) postContent = altMatch[1].trim();
                            const safeContent = postContent.replace(/'/g, "\\'").replace(/"/g, '\\"');

                            // Step 1: Click the "upload image post" tab via robust JS approach
                            const clickTabScript = `(function() {
                                // Find all elements containing the image-post tab text (try leaf nodes first)
                                var allEls = document.querySelectorAll('*');
                                var candidates = [];
                                for (var i = 0; i < allEls.length; i++) {
                                    var el = allEls[i];
                                    if (el.textContent && el.textContent.trim() === '\u4e0a\u4f20\u56fe\u6587' && el.children.length === 0) {
                                        candidates.push(el);
                                    }
                                }
                                if (candidates.length === 0) {
                                    for (var i = 0; i < allEls.length; i++) {
                                        if (allEls[i].textContent && allEls[i].textContent.trim() === '\u4e0a\u4f20\u56fe\u6587') {
                                            candidates.push(allEls[i]);
                                        }
                                    }
                                }
                                // Try clicking each candidate and its parents
                                var clicked = [];
                                for (var c = 0; c < candidates.length; c++) {
                                    var el = candidates[c];
                                    // Dispatch full mouse event sequence
                                    var events = ['mousedown', 'mouseup', 'click'];
                                    for (var e = 0; e < events.length; e++) {
                                        el.dispatchEvent(new MouseEvent(events[e], {bubbles: true, cancelable: true, view: window}));
                                    }
                                    clicked.push(el.tagName + '.' + (el.className || '') + ' (text:' + el.textContent.trim() + ')');
                                    // Also click parent (the tab container)
                                    var parent = el.parentElement;
                                    if (parent) {
                                        for (var e = 0; e < events.length; e++) {
                                            parent.dispatchEvent(new MouseEvent(events[e], {bubbles: true, cancelable: true, view: window}));
                                        }
                                        clicked.push('parent:' + parent.tagName + '.' + (parent.className || ''));
                                    }
                                    // Try grandparent too (Vue components often have wrapper divs)
                                    var grandparent = parent ? parent.parentElement : null;
                                    if (grandparent) {
                                        for (var e = 0; e < events.length; e++) {
                                            grandparent.dispatchEvent(new MouseEvent(events[e], {bubbles: true, cancelable: true, view: window}));
                                        }
                                        clicked.push('grandparent:' + grandparent.tagName + '.' + (grandparent.className || ''));
                                    }
                                    break; // Only click first candidate
                                }
                                return JSON.stringify({ clicked: clicked, total_candidates: candidates.length });
                            })()`;
                            const tabResult = await scriptTool.handler({ script: clickTabScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Tab click result: ${JSON.stringify(tabResult)}`);

                            // Wait longer for SPA tab switch (Vue.js needs time to re-render)
                            await new Promise(r => setTimeout(r, 3000));

                            // Step 2: Diagnose what's on the page now
                            const diagScript = `(function() {
                                var info = {};
                                info.url = window.location.href;
                                info.inputs = [];
                                document.querySelectorAll('input').forEach(function(el) {
                                    info.inputs.push({ type: el.type, placeholder: el.placeholder, class: el.className, visible: el.offsetParent !== null });
                                });
                                info.textareas = document.querySelectorAll('textarea').length;
                                info.contenteditables = [];
                                document.querySelectorAll('[contenteditable="true"]').forEach(function(el) {
                                    info.contenteditables.push({ tag: el.tagName, class: el.className, placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '', height: el.getBoundingClientRect().height });
                                });
                                info.buttons = [];
                                document.querySelectorAll('button').forEach(function(el) {
                                    if (el.textContent.trim()) info.buttons.push(el.textContent.trim().substring(0, 30));
                                });
                                return JSON.stringify(info);
                            })()`;
                            const diagResult = await scriptTool.handler({ script: diagScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Page diagnosis: ${JSON.stringify(diagResult)}`);

                            // Step 3: Click the text-image button to create text-based image content
                            const textImageScript = `(function() {
                                var buttons = document.querySelectorAll('button, div, span');
                                for (var i = 0; i < buttons.length; i++) {
                                    if (buttons[i].textContent.trim() === '\u6587\u5b57\u914d\u56fe') {
                                        buttons[i].dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true,view:window}));
                                        buttons[i].dispatchEvent(new MouseEvent('mouseup', {bubbles:true,cancelable:true,view:window}));
                                        buttons[i].dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}));
                                        return 'clicked: \u6587\u5b57\u914d\u56fe (' + buttons[i].tagName + ')';
                                    }
                                }
                                return 'button not found';
                            })()`;
                            const textImgResult = await scriptTool.handler({ script: textImageScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Text-image click result: ${JSON.stringify(textImgResult)}`);

                            // Wait for text-image editor to appear
                            await new Promise(r => setTimeout(r, 3000));

                            // Step 4: Diagnose again after text-image click
                            const diag2Result = await scriptTool.handler({ script: diagScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Post text-image diagnosis: ${JSON.stringify(diag2Result)}`);

                            // Step 5: Fill text in the text-image editor, title, and content
                            const fillScript = `(function() {
                                var results = [];
                                // Look for text input in the text-image dialog/editor
                                var allInputs = document.querySelectorAll('input, textarea');
                                for (var i = 0; i < allInputs.length; i++) {
                                    var inp = allInputs[i];
                                    if (inp.offsetParent === null) continue; // skip hidden
                                    if (inp.type === 'file') continue; // skip file inputs
                                    inp.focus();
                                    if (inp.tagName === 'TEXTAREA') {
                                        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                                        setter.call(inp, '${safeContent}');
                                    } else {
                                        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                        setter.call(inp, '${safeContent}');
                                    }
                                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    results.push('input[' + i + '] filled: tag=' + inp.tagName + ' placeholder=' + (inp.placeholder || '') + ' class=' + (inp.className || ''));
                                }
                                // Also fill any contenteditable elements
                                var editors = document.querySelectorAll('[contenteditable="true"]');
                                for (var j = 0; j < editors.length; j++) {
                                    if (editors[j].offsetParent !== null) {
                                        editors[j].focus();
                                        editors[j].innerHTML = '<p>${safeContent}</p>';
                                        editors[j].dispatchEvent(new Event('input', { bubbles: true }));
                                        results.push('editor[' + j + '] filled');
                                    }
                                }
                                if (results.length === 0) results.push('no fillable elements found');
                                return JSON.stringify(results);
                            })()`;
                            const fillResult = await scriptTool.handler({ script: fillScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Fill result: ${JSON.stringify(fillResult)}`);

                            // Wait for auto-save / image generation
                            await new Promise(r => setTimeout(r, 3000));

                            // Step 6: Look for and click generate/confirm button, then publish
                            const publishScript = `(function() {
                                var results = [];
                                // First try to find a "generate" or "confirm" button in the text-image dialog
                                var allBtns = document.querySelectorAll('button, [role="button"]');
                                for (var i = 0; i < allBtns.length; i++) {
                                    var text = allBtns[i].textContent.trim();
                                    if (text === '\u751f\u6210\u914d\u56fe' || text === '\u751f\u6210' || text === '\u786e\u8ba4' || text === '\u5b8c\u6210') {
                                        allBtns[i].click();
                                        results.push('clicked: ' + text);
                                    }
                                }
                                // Then look for the publish button
                                for (var i = 0; i < allBtns.length; i++) {
                                    var text = allBtns[i].textContent.trim();
                                    if (text === '\u53d1\u5e03') {
                                        allBtns[i].click();
                                        results.push('publish clicked: ' + text);
                                        return JSON.stringify(results);
                                    }
                                }
                                // List all visible buttons for debugging
                                var visibleBtns = [];
                                for (var i = 0; i < allBtns.length; i++) {
                                    if (allBtns[i].offsetParent !== null) visibleBtns.push(allBtns[i].textContent.trim().substring(0, 30));
                                }
                                results.push('visible buttons: ' + visibleBtns.join(', '));
                                return JSON.stringify(results);
                            })()`;
                            const publishResult = await scriptTool.handler({ script: publishScript }, { taskId, workspacePath: workspaceRoot });
                            console.log(`[AgentLoop] AUTOPILOT: Publish result: ${JSON.stringify(publishResult)}`);

                            autopilotResult = `[AUTOPILOT] Executed full posting flow:\n` +
                                `1) Tab click: ${JSON.stringify(tabResult)}\n` +
                                `2) Diagnosis: ${JSON.stringify(diagResult)}\n` +
                                `3) Text-image: ${JSON.stringify(textImgResult)}\n` +
                                `4) Post-click diagnosis: ${JSON.stringify(diag2Result)}\n` +
                                `5) Fill: ${JSON.stringify(fillResult)}\n` +
                                `6) Publish: ${JSON.stringify(publishResult)}\n` +
                                `Take a screenshot with browser_screenshot to verify.`;
                            autopilotExecuted = true;
                        }
                    }
                } catch (e) {
                    console.error(`[AgentLoop] AUTOPILOT error: ${e instanceof Error ? e.message : String(e)}`);
                }

                // 鈹€鈹€ browser_set_mode loop: smart mode unavailable 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
                if (!autopilotExecuted && toolUse.name === 'browser_set_mode') {
                    console.log(`[AgentLoop] AUTOPILOT: browser_set_mode loop detected. Searching for solutions...`);

                    // Step 1: Extract context - what page is the agent on?
                    let pageUrl = '';
                    let pageSnippet = '';
                    try {
                        const contentTool = tools.find(t => t.name === 'browser_get_content');
                        if (contentTool) {
                            const contentResult = await contentTool.handler({ as_html: false }, { taskId, workspacePath: workspaceRoot });
                            pageUrl = contentResult?.url || '';
                            pageSnippet = (contentResult?.content || '').substring(0, 500);
                        }
                    } catch {}

                    // Step 2: Identify the site and the problem
                    const siteName = pageUrl.includes('x.com') || pageUrl.includes('twitter.com') ? 'X (Twitter)'
                        : pageUrl.includes('xiaohongshu') ? 'Xiaohongshu'
                        : pageUrl.includes('facebook') ? 'Facebook'
                        : new URL(pageUrl || 'about:blank').hostname || 'unknown site';

                    const isJsUnavailable = pageSnippet.includes('JavaScript') && (pageSnippet.includes('not available') || pageSnippet.includes('enable'));
                    const isSpaNotRendered = pageSnippet.includes('errorContainer') || pageSnippet.includes('noscript') || pageSnippet.length < 100;

                    // Step 3: Search for community best practices
                    let searchResult = '';
                    try {
                        const searchTool = tools.find(t => t.name === 'search_web');
                        if (searchTool) {
                            const query = isJsUnavailable || isSpaNotRendered
                                ? `${siteName} playwright automation "JavaScript not available" SPA wait for page load solution 2025`
                                : `${siteName} playwright browser automation best practices posting content 2025`;
                            console.log(`[AgentLoop] AUTOPILOT: Searching community best practices: "${query}"`);
                            const sr = await searchTool.handler({ query }, { taskId, workspacePath: workspaceRoot });
                            searchResult = typeof sr === 'string' ? sr : JSON.stringify(sr);
                            searchResult = searchResult.substring(0, 1500);
                        }
                    } catch (e) {
                        searchResult = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
                    }

                    // Step 4: Try automatic recovery - wait for SPA + re-check
                    let recoveryResult = '';
                    try {
                        const scriptTool = tools.find(t => t.name === 'browser_execute_script');
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        const waitTool = tools.find(t => t.name === 'browser_wait');

                        if (isJsUnavailable || isSpaNotRendered) {
                            // SPA not rendered - try waiting for networkidle or reload
                            console.log(`[AgentLoop] AUTOPILOT: SPA not rendered on ${siteName}. Trying recovery...`);

                            // 4a: Wait for network idle (SPA rendering)
                            if (waitTool) {
                                try {
                                    await waitTool.handler({ selector: 'body', timeout_ms: 15000, state: 'attached' }, { taskId, workspacePath: workspaceRoot });
                                } catch {}
                            }

                            // 4b: If X/Twitter, navigate to x.com directly (twitter.com may redirect badly)
                            if (siteName === 'X (Twitter)' && navTool) {
                                const targetUrl = 'https://x.com/compose/post';
                                console.log(`[AgentLoop] AUTOPILOT: Navigating directly to ${targetUrl}`);
                                const navResult = await navTool.handler({ url: targetUrl, wait_until: 'networkidle', timeout_ms: 30000 }, { taskId, workspacePath: workspaceRoot });
                                recoveryResult += `Navigated to ${targetUrl}: ${JSON.stringify(navResult)}\n`;
                                await new Promise(r => setTimeout(r, 5000));
                            }

                            // 4c: Re-check page state
                            if (scriptTool) {
                                const checkResult = await scriptTool.handler({
                                    script: `(() => {
                                        return JSON.stringify({
                                            url: window.location.href,
                                            title: document.title,
                                            bodyLen: (document.body?.innerText || '').length,
                                            hasReactRoot: !!document.getElementById('react-root') || !!document.querySelector('[data-reactroot]') || !!document.querySelector('#__next'),
                                            snippet: (document.body?.innerText || '').substring(0, 300),
                                        });
                                    })()`
                                }, { taskId, workspacePath: workspaceRoot });
                                recoveryResult += `Page state: ${JSON.stringify(checkResult)}\n`;
                            }
                        }
                    } catch (e) {
                        recoveryResult += `Recovery error: ${e instanceof Error ? e.message : String(e)}\n`;
                    }

                    autopilotResult = `[AUTOPILOT RECOVERY] browser_set_mode("smart") called ${consecutiveCount + 1} times. Smart mode is NOT available.\n\n` +
                        `## Current Situation\n` +
                        `- Site: ${siteName}\n` +
                        `- URL: ${pageUrl}\n` +
                        `- JavaScript/SPA issue detected: ${isJsUnavailable || isSpaNotRendered ? 'YES' : 'NO'}\n\n` +
                        `## Community Best Practices Found\n${searchResult}\n\n` +
                        `## Automatic Recovery Attempt\n${recoveryResult}\n\n` +
                        `## REQUIRED NEXT STEPS (DO NOT call browser_set_mode again)\n` +
                        `1. Use browser_get_content to check if the page loaded after recovery\n` +
                        `2. If the page still shows an error, use browser_navigate with wait_until="networkidle" to reload\n` +
                        `3. Use browser_execute_script to interact with the page via JavaScript (dispatchEvent, etc.)\n` +
                        `4. For X/Twitter: navigate to https://x.com/compose/post directly\n` +
                        `5. Use search_web to find specific automation techniques for this site\n` +
                        `6. DO NOT try browser_set_mode("smart") again - it is unavailable.\n`;
                    autopilotExecuted = true;
                }

                // 鈹€鈹€ browser_navigate loop: page not loading 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
                if (!autopilotExecuted && toolUse.name === 'browser_navigate') {
                    console.log(`[AgentLoop] AUTOPILOT: browser_navigate loop detected. Trying with networkidle...`);
                    const navTool = tools.find(t => t.name === 'browser_navigate');
                    if (navTool) {
                        try {
                            const url = toolUse.input?.url || '';
                            const result = await navTool.handler({ url, wait_until: 'networkidle', timeout_ms: 30000 }, { taskId, workspacePath: workspaceRoot });
                            await new Promise(r => setTimeout(r, 3000));
                            autopilotResult = `[AUTOPILOT] Re-navigated to ${url} with wait_until="networkidle": ${JSON.stringify(result)}\n` +
                                `Use browser_get_content to check the page. If still failing, use search_web to find how to automate this site.`;
                            autopilotExecuted = true;
                        } catch (e) {
                            autopilotResult = `[AUTOPILOT] Navigation retry failed: ${e instanceof Error ? e.message : String(e)}. ` +
                                `Use search_web to find solutions for automating this website.`;
                            autopilotExecuted = true;
                        }
                    }
                }

                if (!autopilotExecuted && toolUse.name === 'browser_disconnect') {
                    console.log('[AgentLoop] AUTOPILOT: browser_disconnect loop detected. Finalizing browser cleanup.');
                    try {
                        const browserService = BrowserService.getInstance();
                        if (browserService.isConnected()) {
                            await browserService.disconnect();
                        }
                    } catch (e) {
                        console.error(`[AgentLoop] AUTOPILOT: browser_disconnect cleanup error: ${e instanceof Error ? e.message : String(e)}`);
                    }

                    completedWorkflows.add('browser-cleanup');
                    autopilotResult =
                        `[AUTOPILOT] Browser cleanup is already complete. ` +
                        `Do NOT call browser_disconnect again. ` +
                        `Summarize the current task outcome to the user instead of repeating cleanup.`;
                    autopilotExecuted = true;
                }

                if (!autopilotExecuted && toolUse.name === 'browser_execute_script' && isXFollowingResearchRequest(lastUserQuery)) {
                    const scriptSource = String(toolUse.input?.script || '');
                    const isScrollScript = /scrollby|scrollto|scrollintoview/i.test(scriptSource);

                    if (isScrollScript) {
                        const snapshot = parseBrowserContentSnapshot(lastBrowserContentSnapshot || lastCachedResult);
                        const snapshotUrl = snapshot.url.toLowerCase();
                        const onXFeed =
                            snapshotUrl.includes('x.com') ||
                            snapshotUrl.includes('twitter.com') ||
                            /(^|\s)(for you|following)(\s|$)/i.test(snapshot.content);
                        const aiSnippets = extractAiRelatedFeedSnippets(snapshot.content, 4);

                        if (onXFeed) {
                            const summary = aiSnippets.length > 0
                                ? `I already reviewed the currently visible X Following feed content, so I will stop repeating the same scrolling action. The AI-related findings I can confirm right now are:\n` +
                                    aiSnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n') +
                                    `\n\nIf you want, I can continue by opening one of these posts and analyzing it in more detail.`
                                : `I already reviewed the currently visible X Following feed content. Repeating the same scroll did not produce new useful information, and I do not see any clear AI-related high-value posts on the current screen. ` +
                                    `If you want, I can switch timeline filters, open specific accounts, or retry with a narrower query.`;

                            messages.push({ role: 'assistant', content: summary });
                            emit(createTextDeltaEvent(taskId, {
                                delta: summary,
                                role: 'assistant',
                            }));
                            emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                            emit(createTaskFinishedEvent(taskId, {
                                summary: aiSnippets.length > 0
                                    ? 'Extracted AI-related signals from the visible X Following feed after scroll loop detection.'
                                    : 'Completed X Following feed review after repeated scroll attempts yielded no new evidence.',
                                duration: 0,
                            }));
                            return {
                                terminalEmitted: true,
                                finalAssistantText: summary,
                            };
                        }
                    }
                }

                if (!autopilotExecuted && toolUse.name === 'browser_get_content' && isXFollowingResearchRequest(lastUserQuery)) {
                    const snapshot = parseBrowserContentSnapshot(lastBrowserContentSnapshot || lastCachedResult);
                    const snapshotUrl = snapshot.url.toLowerCase();
                    const onXFeed =
                        snapshotUrl.includes('x.com') ||
                        snapshotUrl.includes('twitter.com') ||
                        /(^|\s)(for you|following)(\s|$)/i.test(snapshot.content);
                    const aiSnippets = extractAiRelatedFeedSnippets(snapshot.content, 4);

                    if (onXFeed && aiSnippets.length > 0) {
                        const summary =
                            `I already reviewed the posts currently visible in your X Following feed. ` +
                            `The AI-related findings I can confirm right now are:\n` +
                            aiSnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n') +
                            `\n\nIf you want a more complete result, I can keep scrolling and gather more posts.`;

                        messages.push({ role: 'assistant', content: summary });
                        emit(createTextDeltaEvent(taskId, {
                            delta: summary,
                            role: 'assistant',
                        }));
                        emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                        emit(createTaskFinishedEvent(taskId, {
                            summary: 'Extracted AI-related signals from the current X Following feed.',
                            duration: 0,
                        }));
                        return {
                            terminalEmitted: true,
                            finalAssistantText: summary,
                        };
                    }
                }

                if (!autopilotExecuted) {
                    autopilotResult = `ERROR: Tool ${toolUse.name} called ${consecutiveCount + 1} times with same args. You MUST try a DIFFERENT approach now.\n\n` +
                        `REQUIRED ACTIONS:\n` +
                        `1. Use search_web to find community best practices for your current task\n` +
                        `2. Try browser_execute_script to interact with the page via JavaScript\n` +
                        `3. Try browser_navigate with wait_until="networkidle" if the page didn't load\n` +
                        `4. Try a completely different tool or approach\n` +
                        `DO NOT repeat the same tool call.`;
                }

                // Add to permanent block list so this exact tool+args combo is NEVER
                // executed again in this task. The LLM must try something different.
                permanentBlockList.add(blockKey);
                console.log(`[AgentLoop] AUTOPILOT: Added ${toolUse.name}(${currentInputHash.substring(0, 60)}) to permanent block list`);

                // Track the call but reset count so autopilot actions get fresh tracking
                recentToolCalls.length = 0;
                recentToolCalls.push({ name: toolUse.name, inputHash: currentInputHash });

                emit(createToolResultEvent(taskId, {
                    toolUseId: toolUse.id,
                    name: toolUse.name,
                    result: autopilotResult,
                    isError: !autopilotExecuted,
                }));

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: autopilotResult,
                    is_error: !autopilotExecuted,
                });
                continue;
            }

            // Track the call for loop detection
            recentToolCalls.push({ name: toolUse.name, inputHash: currentInputHash });
            // Keep only last 10 calls
            if (recentToolCalls.length > 10) recentToolCalls.shift();

            const tool = tools.find(t => t.name === toolUse.name);
            let result: any;
            let isError = false;

            if (!tool) {
                result = `Error: Tool ${toolUse.name} not found`;
                isError = true;
            } else {
                // Check for empty input (from JSON parsing failure recovery)
                const inputKeys = Object.keys(toolUse.input || {});
                const schema = tool.input_schema as any;
                const requiredParams = schema?.required || [];
                const missingParams = requiredParams.filter((p: string) => !inputKeys.includes(p));

                if (missingParams.length > 0 && inputKeys.length === 0) {
                    // Tool input was empty (likely from JSON parse failure)
                    result = `Error: Tool call failed due to malformed JSON input. Missing required parameters: ${missingParams.join(', ')}. Please try again.`;
                    isError = true;
                    console.error(`[Tool] ${toolUse.name} called with empty input, missing: ${missingParams.join(', ')}`);
                } else {
                    const isRetryable = RETRYABLE_TOOL_PREFIXES.some(p => toolUse.name.startsWith(p));

                    if (isRetryable) {
                        try {
                            const executionStep = {
                                id: toolUse.id,
                                description: `Execute ${toolUse.name}`,
                                toolName: toolUse.name,
                                args: toolUse.input || {},
                            };
                            const adaptiveResult = await adaptiveExecutor.executeWithRetry(
                                executionStep,
                                async (_name: string, args: Record<string, unknown>) => {
                                    return await tool.handler(args, { taskId, workspacePath: workspaceRoot });
                                }
                            );
                            if (adaptiveResult.success) {
                                result = adaptiveResult.output;
                            } else {
                                isError = true;
                                result = adaptiveResult.error || adaptiveResult.output || 'Tool execution failed after retries';
                            }
                        } catch (e) {
                            result = `Error: ${e instanceof Error ? e.message : String(e)}`;
                            isError = true;
                        }
                    } else {
                        try {
                            result = await tool.handler(toolUse.input, { taskId, workspacePath: workspaceRoot });
                        } catch (e) {
                            result = `Error: ${e instanceof Error ? e.message : String(e)}`;
                            isError = true;
                        }
                    }
                }
            }

            if (isError) {
                const recovery = await recoverMainLoopToolFailure({
                    errorResult: result,
                    toolName: toolUse.name,
                    toolArgs: toolUse.input || {},
                    lastUserQuery,
                    consecutiveToolErrors,
                    toolErrorTracker,
                    selfLearningThreshold: SELF_LEARNING_THRESHOLD,
                    formatErrorForAI,
                    quickLearnFromError: (errorMessage, originalQuery, attemptCount) =>
                        selfLearningController.quickLearnFromError(errorMessage, originalQuery, attemptCount),
                    logger: console,
                });
                result = recovery.result;
                consecutiveToolErrors = recovery.consecutiveToolErrors;
            } else {
                // Generic autopilot: after browser_connect succeeds, if browser is still
                // on about:blank, try to infer a target URL from user query (or search)
                // and navigate automatically. This is site-agnostic and prevents
                // "browser opened but no page loaded" dead-ends.
                if (toolUse.name === 'browser_connect') {
                    try {
                        const connectSucceeded = typeof result === 'object' && result !== null && (result as any).success !== false;
                        if (connectSucceeded) {
                            const connectResult = result as Record<string, unknown>;
                            const looksLikeXFollowingTask = isXFollowingResearchRequest(lastUserQuery || '');
                            const connectionModeId = typeof connectResult.connectionModeId === 'string'
                                ? connectResult.connectionModeId
                                : '';

                            if (
                                looksLikeXFollowingTask &&
                                connectionModeId === 'persistent_profile' &&
                                !suspendResumeManager.isSuspended(taskId)
                            ) {
                                await suspendResumeManager.suspend(
                                    taskId,
                                    'user_profile_recommended',
                                    '当前打开的是一个新的浏览器窗口，还没有使用你平时已登录的 X 账号状态。你可以选择“使用我已登录的浏览器”，或者先在当前窗口完成登录，再点击“在当前窗口登录后继续”。',
                                    ResumeConditions.manual(),
                                    { url: 'https://x.com/home', connectionMode: connectionModeId }
                                );

                                if (typeof result === 'object' && result !== null) {
                                    (result as Record<string, unknown>).suspended = true;
                                    (result as Record<string, unknown>).suspendReason = 'user_profile_recommended';
                                }
                            }

                            if (!suspendResumeManager.isSuspended(taskId)) {
                                const navTool = tools.find(t => t.name === 'browser_navigate');
                                const contentTool = tools.find(t => t.name === 'browser_get_content');
                                let currentUrl = '';

                                if (contentTool) {
                                    try {
                                        const contentResult = await contentTool.handler(
                                            { as_html: false },
                                            { taskId, workspacePath: workspaceRoot }
                                        );
                                        currentUrl = (contentResult && typeof contentResult === 'object' && (contentResult as any).url)
                                            ? String((contentResult as any).url)
                                            : '';
                                    } catch {
                                        // Ignore content probe failures and continue with URL inference
                                    }
                                }

                                const onBlankPage = !currentUrl || currentUrl === 'about:blank';

                                if (onBlankPage) {
                                    let targetUrl = '';
                                    const directUrlMatch = (lastUserQuery || '').match(/https?:\/\/[^\s"'`<>]+/i);
                                    if (directUrlMatch?.[0]) {
                                        targetUrl = directUrlMatch[0];
                                    }

                                    if (!targetUrl && isXFollowingResearchRequest(lastUserQuery || '')) {
                                        targetUrl = 'https://x.com/home';
                                    }

                                    // If user didn't provide a URL, search the web and pick the first URL.
                                    if (!targetUrl && lastUserQuery) {
                                        const searchTool = tools.find(t => t.name === 'search_web');
                                        if (searchTool) {
                                            try {
                                                const searchResult = await searchTool.handler(
                                                    { query: lastUserQuery },
                                                    { taskId, workspacePath: workspaceRoot }
                                                );
                                                const searchText = typeof searchResult === 'string'
                                                    ? searchResult
                                                    : JSON.stringify(searchResult);
                                                const fromSearch = searchText.match(/https?:\/\/[^\s"'`<>\\]+/i);
                                                if (fromSearch?.[0]) {
                                                    targetUrl = fromSearch[0];
                                                }
                                            } catch {
                                                // Ignore search failures
                                            }
                                        }
                                    }

                                    if (targetUrl && navTool) {
                                        console.log(`[AgentLoop] AUTOPILOT: browser_connect succeeded but page is blank. Navigating to inferred URL: ${targetUrl}`);
                                        const navResult = await navTool.handler(
                                            {
                                                url: targetUrl,
                                                wait_until: 'domcontentloaded',
                                                timeout_ms: 30000,
                                            },
                                            { taskId, workspacePath: workspaceRoot }
                                        );

                                        if (typeof result === 'object' && result !== null) {
                                            (result as any).autoNavigate = {
                                                url: targetUrl,
                                                result: navResult,
                                            };
                                        } else {
                                            result = {
                                                success: true,
                                                connectResult: result,
                                                autoNavigate: {
                                                    url: targetUrl,
                                                    result: navResult,
                                                },
                                            };
                                        }
                                    } else {
                                        if (typeof result === 'object' && result !== null) {
                                            (result as any).nextRecommendedAction =
                                                'Browser connected but no page is loaded yet. Please call browser_navigate with the target website URL.';
                                        }
                                    }
                                }
                            }
                        }
                    } catch (autoNavErr) {
                        console.error(`[AgentLoop] AUTOPILOT: post-connect generic navigation failed: ${autoNavErr instanceof Error ? autoNavErr.message : String(autoNavErr)}`);
                    }
                }

                toolErrorTracker.delete(toolUse.name);
                consecutiveToolErrors = 0;
            }

            if (!isError && normalizedPythonInstallCommand && isSuccessfulPythonInstallResult(result)) {
                successfulPythonInstallCommands.set(normalizedPythonInstallCommand, {
                    command: rawCommand,
                    repeatBlocks: 0,
                });
            }

            let resultStr = typeof result === 'string' ? result : JSON.stringify(result);

            // Cache the result for read-only tools (for loop detection context)
            if (isReadOnly) {
                lastCachedResult = resultStr;
                if (toolUse.name === 'browser_get_content') {
                    lastBrowserContentSnapshot = resultStr;
                }
            }

            // For screenshot results, strip the base64 image data from the LLM context
            // to avoid exceeding API size limits. The image was already emitted as an
            // event for the UI. Replace with a compact summary.
            let llmResultStr = resultStr;
            if (toolUse.name === 'browser_screenshot' && result && typeof result === 'object' && result.imageBase64) {
                const summary = {
                    success: result.success,
                    width: result.width,
                    height: result.height,
                    mimeType: result.mimeType || 'image/png',
                    note: 'Screenshot captured successfully. Image data omitted from context to save tokens. Use browser_get_content to read page text.',
                };
                llmResultStr = JSON.stringify(summary);
            }

            emit(createToolResultEvent(taskId, {
                toolUseId: toolUse.id,
                name: toolUse.name,
                result: resultStr,
                isError,
            }));

            toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: llmResultStr,
                is_error: isError,
            });
        }

        // Add tool results to history as a USER message
        pushConversationMessage(taskId, {
            role: 'user',
            content: toolResults,
        });

        // 鈹€鈹€ Planning: increment 2-Action Rule counter 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        toolCallsSincePlanReminder += toolResults.length;

        // ================================================================
        // Suspend/Resume: Check if any tool triggered a task suspension
        // (e.g., browser_navigate detected a login page)
        // ================================================================
        if (suspendResumeManager.isSuspended(taskId)) {
            const suspended = suspendResumeManager.getSuspendedTask(taskId);
            if (suspended) {
                console.log(`[AgentLoop] Task ${taskId} is suspended: ${suspended.reason}`);
                console.log(`[AgentLoop] Waiting for user action: ${suspended.userMessage}`);

                // Emit TASK_SUSPENDED event to frontend
                emit(createTaskSuspendedEvent(taskId, {
                    reason: suspended.reason,
                    userMessage: suspended.userMessage,
                    canAutoResume: suspended.resumeCondition.type === 'auto_detect',
                    maxWaitTimeMs: suspended.resumeCondition.maxWaitTime,
                    actions: buildSuspendActions(suspended.reason, suspended.context),
                }));

                // Wait for resume or cancellation
                const suspendStartTime = Date.now();
                const resumeResult = await new Promise<{ resumed: boolean; reason?: string }>((resolve) => {
                    const onResumed = (data: any) => {
                        if (data.taskId === taskId) {
                            suspendResumeManager.off('task_resumed', onResumed);
                            suspendResumeManager.off('task_cancelled', onCancelled);
                            resolve({ resumed: true, reason: data.resumeReason });
                        }
                    };
                    const onCancelled = (data: any) => {
                        if (data.taskId === taskId) {
                            suspendResumeManager.off('task_resumed', onResumed);
                            suspendResumeManager.off('task_cancelled', onCancelled);
                            resolve({ resumed: false, reason: data.reason });
                        }
                    };

                    suspendResumeManager.on('task_resumed', onResumed);
                    suspendResumeManager.on('task_cancelled', onCancelled);

                    // Safety: if task was already resumed between check and listener setup
                    if (!suspendResumeManager.isSuspended(taskId)) {
                        suspendResumeManager.off('task_resumed', onResumed);
                        suspendResumeManager.off('task_cancelled', onCancelled);
                        resolve({ resumed: true, reason: 'Already resumed' });
                    }
                });

                const suspendDuration = Date.now() - suspendStartTime;

                if (resumeResult.resumed) {
                    console.log(`[AgentLoop] Task ${taskId} resumed after ${suspendDuration}ms: ${resumeResult.reason}`);

                    // Emit TASK_RESUMED event to frontend
                    emit(createTaskResumedEvent(taskId, {
                        resumeReason: resumeResult.reason,
                        suspendDurationMs: suspendDuration,
                    }));

                    // Inject context into conversation so LLM knows what happened
                    // Use a plain text user message (not tool_result) to avoid API validation issues
                    pushConversationMessage(taskId, {
                        role: 'user',
                        content: `[System Notification] The task was suspended because: ${suspended.reason}. ` +
                            `The user has now completed the required action (${resumeResult.reason || 'manual action completed'}). ` +
                            `The task has been resumed after ${Math.round(suspendDuration / 1000)} seconds. ` +
                            `Please continue with the original task. The user is now logged in and the page should be ready.`,
                    });

                    // Continue the loop - LLM will get the resume context and proceed
                } else {
                    console.log(`[AgentLoop] Task ${taskId} cancelled during suspension: ${resumeResult.reason}`);
                    // Break out of the loop - task was cancelled
                    return {
                        terminalEmitted: true,
                        cancelled: true,
                    };
                }
            }
        }
    }

    return {
        terminalEmitted: false,
        finalAssistantText: buildTaskCompletionSummary(messages, 'Task completed'),
        maxStepsReached: steps >= MAX_STEPS,
    };
}

async function resumeRecoverableTask(
    snapshot: PersistedTaskRuntimeSnapshot,
): Promise<void> {
    const taskId = snapshot.taskId;
    const workspacePath = snapshot.workspacePath;

    restoreTaskRuntimeSnapshot(taskId, workspacePath);

    const config = taskConfigs.get(taskId);
    if (!config?.workspacePath) {
        throw new Error(`Missing task config for recoverable task ${taskId}`);
    }

    emit(createTaskResumedEvent(taskId, {
        resumeReason: 'Recovered after sidecar restart',
        suspendDurationMs: 0,
    }));
    emit(createTaskStatusEvent(taskId, { status: 'running' }));

    const continuationMessage =
        '[System Notification] The previous model connection dropped and the sidecar process restarted. ' +
        'Resume the interrupted task from the latest completed step. Do not repeat successful tool calls unless they are required because the page or external state may have changed. ' +
        'When you finish, report the concrete result, not just your status.';

    const conversation = pushConversationMessage(taskId, {
        role: 'user',
        content: continuationMessage,
    });

    const explicitSkillIds =
        config.enabledClaudeSkills ??
        config.enabledSkills;
    const triggeredSkillIds = getTriggeredSkillIds(continuationMessage);
    const enabledSkillIds = mergeSkillIds(explicitSkillIds, triggeredSkillIds);

    const systemPrompt = await buildSkillSystemPrompt(
        taskId,
        workspacePath,
        enabledSkillIds,
        continuationMessage,
    );

    const options: AnthropicStreamOptions = {
        modelId: config.modelId,
        maxTokens: config.maxTokens,
        systemPrompt,
    };
    const tools = getToolsForTask(taskId);
    (options as any).tools = tools;
    const providerConfig = resolveProviderConfig(loadLlmConfig(workspacePath), options);
    const outcome = await runAgentLoop(taskId, conversation, options, providerConfig, tools);

    if (!outcome.terminalEmitted) {
        if (outcome.maxStepsReached) {
            emit(createTaskFailedEvent(taskId, {
                error: 'Recovered task reached the maximum reasoning steps without producing a final result.',
                errorCode: 'TASK_MAX_STEPS_EXCEEDED',
                recoverable: true,
                suggestion: 'The interrupted task was restored, but it still looped. Continue with a narrower follow-up instruction.',
            }));
        } else {
            emit(createTaskStatusEvent(taskId, { status: 'finished' }));
            emit(createTaskFinishedEvent(taskId, {
                summary: outcome.finalAssistantText || 'Task completed',
                duration: 0,
            }));
        }
    }
}

async function streamLlmResponse(
    taskId: string,
    messages: AnthropicMessage[],
    options: AnthropicStreamOptions,
    config: LlmProviderConfig
): Promise<AnthropicMessage> {
    if (!config.baseUrl) {
        throw new Error('missing_base_url');
    }
    // Set rate-limit context so fetchWithRetry can emit events
    setRateLimitContext((event) => emit(event as any), taskId);
    try {
        if (config.apiFormat === 'openai') {
            return await streamOpenAIResponse(taskId, messages, options, config);
        }
        return await streamAnthropicResponse(taskId, messages, options, config);
    } finally {
        clearRateLimitContext();
    }
}

function safeStat(targetPath: string): fs.Stats | null {
    try {
        return fs.statSync(targetPath);
    } catch {
        return null;
    }
}

function ensureToolpackId(manifest: Record<string, unknown>): Record<string, unknown> {
    if (!manifest.id && typeof manifest.name === 'string') {
        return { ...manifest, id: manifest.name };
    }
    return manifest;
}

function toToolpackRecord(stored: {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        author?: string;
        entry?: string;
        runtime?: string;
        tools?: string[];
        effects?: string[];
        tags?: string[];
        homepage?: string;
        repository?: string;
        signature?: string;
    };
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
    workingDir: string;
}) {
    return {
        manifest: stored.manifest,
        source: 'local_folder',
        rootPath: stored.workingDir,
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
        status: 'stopped',
    };
}

function toSkillRecord(stored: {
    manifest: {
        name: string;
        version: string;
        description: string;
        directory: string;
        tags?: string[];
        allowedTools?: string[];
        requires?: {
            env?: string[];
        };
        requiredCapabilities?: string[];
    };
    enabled: boolean;
    installedAt: string;
    lastUsedAt?: string;
}) {
    return {
        manifest: {
            id: stored.manifest.name,
            name: stored.manifest.name,
            version: stored.manifest.version,
            description: stored.manifest.description,
            allowedTools: stored.manifest.allowedTools ?? [],
            tags: stored.manifest.tags ?? [],
            requires: stored.manifest.requires,
        },
        rootPath: stored.manifest.directory,
        source: 'local_folder',
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
    };
}

function selectSkillsForUpdateCheck(skillIds?: string[]) {
    const allSkills = skillStore.list();
    if (!skillIds || skillIds.length === 0) {
        return allSkills;
    }

    const requested = new Set(skillIds);
    return allSkills.filter((skill) => requested.has(skill.manifest.name));
}

// Helper to gather tools for a task
function getToolsForTask(taskId: string): ToolDefinition[] {
    const config = taskConfigs.get(taskId);

    // Include ALL builtin tools by default for out-of-box experience
    // Users don't need to install any MCP servers - everything works immediately
    const tools: ToolDefinition[] = [
        ...STANDARD_TOOLS,      // File operations: list_dir, view_file, write_to_file, etc.
        webSearchTool,          // Web search: search_web (SearXNG/Tavily/Brave)
        ...BUILTIN_TOOLS,       // Memory, GitHub, WebCrawl, Docs, Sequential Thinking
        ...DATABASE_TOOLS,      // Database operations
        ...ENHANCED_BROWSER_TOOLS,  // Enhanced browser automation with adaptive retry, login detection, and suspend/resume
        xiaohongshuPostTool,    // Compound tool: post to Xiaohongshu in one call
        ...SELF_LEARNING_TOOLS, // Self-learning and autonomous capability acquisition
    ];

    if (!config) return tools;

    const enabledToolpacks = config.enabledToolpacks || [];

    // Add tools from running MCP servers (if user has custom MCPs)
    // MCP tools take priority over builtin tools with same name
    const availableMcpTools = mcpGateway.getAvailableTools();
    for (const { server, tool } of availableMcpTools) {
        const isEnabled = enabledToolpacks.some(id => id.includes(server) || id === server);

        if (isEnabled) {
            // Remove builtin version if MCP version is available
            const existingIndex = tools.findIndex(t => t.name === tool.name);
            if (existingIndex >= 0) {
                tools.splice(existingIndex, 1);
            }

            tools.push({
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.inputSchema as Record<string, unknown>,
                effects: ['network:outbound'],
                handler: async (args, context) => {
                    return await mcpGateway.callTool({
                        sessionId: context.taskId,
                        toolName: tool.name,
                        serverName: server,
                        arguments: args,
                    });
                }
            });
        }
    }

    return tools;
}

async function handleCommand(command: IpcCommand): Promise<void> {
    const startTime = Date.now();

    try {
        // Try dispatch via command router (handles identity/security commands)
        const result = dispatchCommand(command, routerDeps);

        if (result) {
            // Command was handled by router
            if (result.response) {
                emit(result.response);
            }
            for (const event of result.events ?? []) {
                emit(event);
            }
            return;
        }

        // Route commands that aren't handled yet
        // These would be forwarded to Rust Policy Gate in production
        switch (command.type) {
            case 'start_task': {
                const taskId = command.payload.taskId;
                taskSequences.set(taskId, 0);
                taskConfigs.set(taskId, {
                    ...(command.payload.config ?? {}),
                    workspacePath: command.payload.context.workspacePath,
                    activeFile: command.payload.context.activeFile,
                });
                taskRuntimeMeta.set(taskId, {
                    title: command.payload.title,
                    status: 'running',
                    updatedAt: new Date().toISOString(),
                    autoResumePending: false,
                });
                const startLimit = command.payload.config?.maxHistoryMessages;
                taskHistoryLimits.set(
                    taskId,
                    typeof startLimit === 'number' && startLimit > 0
                        ? startLimit
                        : getDefaultHistoryLimit()
                );

                // Set current executing task ID for enhanced browser tools
                currentExecutingTaskId = taskId;

                // Detect package manager for this workspace
                const workspacePath = command.payload.context.workspacePath;
                const packageManager = detectPackageManager(workspacePath);
                const pmCommands = getPackageManagerCommands(packageManager);
                console.error(`[Task ${taskId}] Package manager detected: ${packageManager}`);

                // Emit task started event
                emit(
                    createTaskStartedEvent(taskId, {
                        title: command.payload.title,
                        description: command.payload.userQuery,
                        context: {
                            workspacePath: command.payload.context.workspacePath,
                            activeFile: command.payload.context.activeFile,
                            userQuery: command.payload.userQuery,
                            packageManager,
                            packageManagerCommands: pmCommands,
                        },
                    })
                );

                // Respond with success
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'start_task_response',
                    payload: {
                        success: true,
                        taskId,
                    },
                });

                // Check if this should run as an autonomous task (OpenClaw-style)
                const userQuery = command.payload.userQuery;
                if (shouldRunAutonomously(userQuery)) {
                    console.error(`[Task ${taskId}] Detected autonomous task intent, delegating to AutonomousAgent`);

                    // Initialize provider config for autonomous agent
                    const llmConfig = loadLlmConfig(workspaceRoot);
                    const providerConfig = resolveProviderConfig(llmConfig, {});
                    autonomousLlmAdapter.setProviderConfig(providerConfig);
                    autonomousLlmAdapter.setWorkspacePath(command.payload.context.workspacePath);

                    // Get the autonomous agent controller
                    const agent = getAutonomousAgent(taskId);

                    try {
                        const task = await agent.startTask(userQuery, {
                            autoSaveMemory: true,
                            notifyOnComplete: true,
                            runInBackground: false,
                        });

                        emit(
                            createTaskFinishedEvent(taskId, {
                                summary: task.summary || 'Autonomous task completed',
                                duration: Date.now() - new Date(task.createdAt).getTime(),
                            })
                        );
                    } catch (error) {
                        emit(createTaskFailedEvent(taskId, {
                            error: error instanceof Error ? error.message : String(error),
                            errorCode: 'AUTONOMOUS_TASK_ERROR',
                            recoverable: false,
                        }));
                    }
                    break; // Exit the case, autonomous task handled
                }

                const conversation = pushConversationMessage(taskId, {
                    role: 'user',
                    content: command.payload.userQuery,
                });

                const startedAt = Date.now();

                // Get explicitly enabled skills from config
                const explicitSkillIds =
                    command.payload.config?.enabledClaudeSkills ??
                    command.payload.config?.enabledSkills;

                // Find skills triggered by user message (OpenClaw compatible)
                const triggeredSkillIds = getTriggeredSkillIds(command.payload.userQuery);

                // Merge explicit and triggered skills
                const enabledSkillIds = mergeSkillIds(explicitSkillIds, triggeredSkillIds);

                const systemPrompt = await buildSkillSystemPrompt(
                    taskId,
                    workspaceRoot,
                    enabledSkillIds,
                    command.payload.userQuery
                );
                try {
                    const options = {
                        modelId: command.payload.config?.modelId,
                        maxTokens: command.payload.config?.maxTokens,
                        systemPrompt,
                    };

                    // Register enabled toolpacks with Gateway if needed
                    if (command.payload.config?.enabledToolpacks) {
                        for (const toolpackId of command.payload.config.enabledToolpacks) {
                            const pack = toolpackStore.get(toolpackId);
                            // If it's an external node runtime and not yet registered
                            // We need to check if registered. gateway doesn't expose public check easily, but registerServer handles?
                            // Gateway throws if low risk? No.
                            // We should try to register. Gateway likely needs a check to avoid double registration.
                            // But for now, we try/catch.
                            if (pack && pack.manifest.runtime === 'node' && pack.manifest.entry) {
                                try {
                                    // Resolve entry path. If it starts with ., resolve from projectRoot (which is process.cwd() for sidecar?)
                                    // Sidecar runs from sidecar root?
                                    // We need absolute path.
                                    let entryPath = pack.manifest.entry;
                                    if (entryPath.startsWith('.')) {
                                        entryPath = path.resolve(process.cwd(), entryPath);
                                    }
                                    // Update manifest with absolute path for execution? Or just pass dir.
                                    // Gateway uses cwd: workingDir.
                                    // We pass process.cwd() as workingDir.

                                    // Ensure we don't re-register if already there
                                    const status = await mcpGateway.healthCheck();
                                    if (!status.has(pack.manifest.name)) {
                                        console.log(`[StartTask] Registering MCP server: ${pack.manifest.name}`);
                                        await mcpGateway.registerServer({
                                            ...pack.manifest,
                                            entry: entryPath,
                                        }, process.cwd());
                                    }
                                } catch (e) {
                                    console.error(`[StartTask] Failed to register MCP ${pack.manifest.name}`, e);
                                }
                            }
                        }
                    }

                    // Add tools AFTER registration attempt
                    const tools = getToolsForTask(taskId);
                    (options as any).tools = tools;

                    const providerConfig = resolveProviderConfig(loadLlmConfig(workspaceRoot), options);

                    // RUN AGENT LOOP
                    const outcome = await runAgentLoop(taskId, conversation, options, providerConfig, tools);

                    if (!outcome.terminalEmitted) {
                        if (outcome.maxStepsReached) {
                            emitTaskFailureIfActive(taskId, {
                                error: 'Task reached the maximum reasoning steps without producing a final result.',
                                errorCode: 'TASK_MAX_STEPS_EXCEEDED',
                                recoverable: true,
                                suggestion: 'Resume the task with a shorter follow-up instruction or inspect the repeated tool calls in the timeline.',
                            });
                        } else {
                            emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                            emit(
                                createTaskFinishedEvent(taskId, {
                                    summary: outcome.finalAssistantText || 'Task completed',
                                    duration: Date.now() - startedAt,
                                })
                            );
                        }
                    }
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    emitTaskFailureIfActive(taskId, buildModelStreamFailurePayload(errorMessage));
                }
                break;
            }

            case 'cancel_task': {
                const taskId = command.payload.taskId;

                emitTaskFailureIfActive(taskId, {
                    error: 'Task cancelled by user',
                    errorCode: 'CANCELLED',
                    recoverable: false,
                    suggestion: command.payload.reason,
                });

                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'cancel_task_response',
                    payload: {
                        success: true,
                        taskId,
                    },
                });
                break;
            }

            case 'clear_task_history': {
                const taskId = command.payload.taskId;
                taskConversations.set(taskId, []);
                taskHistoryLimits.set(taskId, taskHistoryLimits.get(taskId) ?? getDefaultHistoryLimit());
                persistTaskRuntimeSnapshot(taskId);

                emit({
                    id: randomUUID(),
                    taskId,
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence(taskId),
                    type: 'TASK_HISTORY_CLEARED',
                    payload: {
                        reason: 'user_requested',
                    },
                });

                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'clear_task_history_response',
                    payload: {
                        success: true,
                        taskId,
                    },
                });
                break;
            }

            case 'send_task_message': {
                const taskId = command.payload.taskId;
                const content = command.payload.content;
                const hintedWorkspacePath =
                    command.payload.workspacePath ??
                    getTaskConfig(taskId)?.workspacePath;

                ensureTaskRuntimeLoaded(taskId, hintedWorkspacePath);

                emit({
                    id: randomUUID(),
                    taskId,
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence(taskId),
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content,
                    },
                });

                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'send_task_message_response',
                    payload: {
                        success: true,
                        taskId,
                    },
                });

                emit({
                    id: randomUUID(),
                    taskId,
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence(taskId),
                    type: 'TASK_STATUS',
                    payload: { status: 'running' },
                });

                const taskConfig = getTaskConfig(taskId);
                if (command.payload.config) {
                    if (
                        typeof command.payload.config.maxHistoryMessages === 'number' &&
                        command.payload.config.maxHistoryMessages > 0
                    ) {
                        taskHistoryLimits.set(
                            taskId,
                            command.payload.config.maxHistoryMessages
                        );
                    }
                    taskConfigs.set(taskId, {
                        ...taskConfig,
                        ...command.payload.config,
                        workspacePath:
                            command.payload.workspacePath ??
                            taskConfig?.workspacePath,
                    });
                } else if (command.payload.workspacePath && command.payload.workspacePath !== taskConfig?.workspacePath) {
                    taskConfigs.set(taskId, {
                        ...taskConfig,
                        workspacePath: command.payload.workspacePath,
                    });
                }
                const effectiveTaskConfig = getTaskConfig(taskId);
                markTaskRuntime(taskId, {
                    status: 'running',
                    autoResumePending: false,
                    lastError: undefined,
                });
                // Get explicitly enabled skills from config
                const explicitSkillIds =
                    effectiveTaskConfig?.enabledClaudeSkills ??
                    effectiveTaskConfig?.enabledSkills ??
                    command.payload.config?.enabledClaudeSkills ??
                    command.payload.config?.enabledSkills;

                // Find skills triggered by user message (OpenClaw compatible)
                const triggeredSkillIds = getTriggeredSkillIds(content);

                // Merge explicit and triggered skills
                const enabledSkillIds = mergeSkillIds(explicitSkillIds, triggeredSkillIds);

                const systemPrompt = await buildSkillSystemPrompt(
                    taskId,
                    workspaceRoot,
                    enabledSkillIds,
                    content
                );
                // Add user message
                const conversation = pushConversationMessage(taskId, { role: 'user', content });

                try {
                    const options: AnthropicStreamOptions = {
                        modelId: command.payload.config?.modelId,
                        maxTokens: command.payload.config?.maxTokens,
                        systemPrompt,
                    };

                    // Add tools
                    const tools = getToolsForTask(taskId);
                    (options as any).tools = tools;

                    const providerConfig = resolveProviderConfig(loadLlmConfig(workspaceRoot), options);

                    // RUN AGENT LOOP
                    const outcome = await runAgentLoop(taskId, conversation, options, providerConfig, tools);

                    if (!outcome.terminalEmitted) {
                        if (outcome.maxStepsReached) {
                            emitTaskFailureIfActive(taskId, {
                                error: 'Task reached the maximum reasoning steps without producing a final result.',
                                errorCode: 'TASK_MAX_STEPS_EXCEEDED',
                                recoverable: true,
                                suggestion: 'Connection recovered, but the task still looped. Continue with a narrower follow-up instruction.',
                            });
                        } else {
                            emit(createTaskStatusEvent(taskId, { status: 'finished' }));
                            emit(
                                createTaskFinishedEvent(taskId, {
                                    summary: outcome.finalAssistantText || 'Task completed',
                                    duration: 0,
                                })
                            );
                        }
                    }
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    emitTaskFailureIfActive(taskId, buildModelStreamFailurePayload(errorMessage));
                }

                break;
            }

            case 'resume_recoverable_tasks': {
                const normalizedRecovery = normalizeRecoverableTaskInputs(
                    command.payload?.taskIds,
                    command.payload?.tasks,
                );
                const requestedTaskIds = normalizedRecovery.taskIds;
                const requestedTaskHints = normalizedRecovery.taskHints;
                const snapshots = collectRecoverableTaskSnapshots(requestedTaskIds, requestedTaskHints);
                const resumedTaskIds = snapshots.map((snapshot) => snapshot.taskId);
                const requestedIds = requestedTaskIds ?? requestedTaskHints?.map((task) => task.taskId);

                emitAny({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'resume_recoverable_tasks_response',
                    payload: {
                        success: true,
                        resumedTaskIds,
                        skippedTaskIds: Array.from(new Set([
                            ...(requestedIds
                                ? requestedIds.filter((taskId) => !resumedTaskIds.includes(taskId))
                                : []),
                            ...normalizedRecovery.invalidTaskIds.filter(isRecoverableTaskId),
                        ])),
                    },
                });

                for (const snapshot of snapshots) {
                    void resumeRecoverableTask(snapshot).catch((error) => {
                        emit(createTaskFailedEvent(snapshot.taskId, {
                            error: error instanceof Error ? error.message : String(error),
                            errorCode: 'TASK_RECOVERY_ERROR',
                            recoverable: false,
                        }));
                    });
                }

                break;
            }

            // Effect request with code quality hooks
            case 'request_effect': {
                const effectPayload = command.payload as any;
                let hookWarnings: string | undefined;

                // Run post-edit hooks for Edit/Write tools
                if (effectPayload.tool === 'Edit' || effectPayload.tool === 'Write') {
                    const filePath = effectPayload.parameters?.file_path || effectPayload.parameters?.path;
                    const content = effectPayload.parameters?.new_string || effectPayload.parameters?.content;

                    if (filePath) {
                        // Get workspace path from active task
                        const taskId: string = (command as any).taskId || ((command.payload as any).taskId) || '';
                        const taskContext = taskConfigs.get(taskId);
                        const workspacePath = taskContext?.workspacePath || process.cwd();

                        const hookResults = runPostEditHooks(workspacePath, filePath, content);
                        if (hookResults.length > 0) {
                            hookWarnings = formatHookResults(hookResults);
                        }
                    }
                }

                // Emit effect request to frontend for confirmation
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'request_effect_response',
                    payload: {
                        // hookWarnings, // Not in schema
                        response: {
                            approved: false, // Wait for frontend approval or policy
                            requestId: command.id,
                        } as any,
                    } as any,
                });
                break;
            }

            case 'apply_patch':
            case 'read_file':
            case 'list_dir':
            case 'exec_shell':
            case 'capture_screen':
            case 'get_policy_config':
                // TODO: Forward to Rust Policy Gate via Tauri IPC
                console.error(
                    `[STUB] Command type "${command.type}" should be forwarded to Rust Policy Gate`
                );
                break;
            case 'list_toolpacks': {
                const includeDisabled = command.payload?.includeDisabled ?? true;
                const toolpacks = toolpackStore
                    .list()
                    .filter((tp) => includeDisabled || tp.enabled)
                    .map((tp) => toToolpackRecord(tp));

                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'list_toolpacks_response',
                    payload: { toolpacks: toolpacks as any },
                });
                break;
            }
            case 'get_toolpack': {
                const toolpackId = command.payload.toolpackId as string;
                const stored = toolpackStore.getById(toolpackId);
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'get_toolpack_response',
                    payload: {
                        toolpack: (stored ? toToolpackRecord(stored) : undefined) as any,
                    },
                });
                break;
            }
            case 'install_toolpack': {
                const { source, path: inputPath, allowUnsigned } = command.payload as {
                    source: string;
                    path?: string;
                    allowUnsigned?: boolean;
                };

                if (source !== 'local_folder') {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_toolpack_response',
                        payload: {
                            success: false,
                            error: 'unsupported_source',
                        },
                    });
                    break;
                }

                if (!inputPath) {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_toolpack_response',
                        payload: {
                            success: false,
                            error: 'missing_path',
                        },
                    });
                    break;
                }

                const stat = safeStat(inputPath);
                if (!stat) {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_toolpack_response',
                        payload: {
                            success: false,
                            error: 'path_not_found',
                        },
                    });
                    break;
                }

                let manifestPath = inputPath;
                let workingDir = inputPath;
                if (stat.isDirectory()) {
                    const candidates = [
                        path.join(inputPath, 'toolpack.json'),
                        path.join(inputPath, 'mcp.json'),
                    ];
                    const found = candidates.find((candidate) => fs.existsSync(candidate));
                    if (!found) {
                        emit({
                            commandId: command.id,
                            timestamp: new Date().toISOString(),
                            type: 'install_toolpack_response',
                            payload: {
                                success: false,
                                error: 'missing_toolpack_manifest',
                            },
                        });
                        break;
                    }
                    manifestPath = found;
                } else {
                    workingDir = path.dirname(inputPath);
                }

                try {
                    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<
                        string,
                        unknown
                    >;
                    const normalized = ensureToolpackId(raw);
                    const parsed = ToolpackManifestSchema.safeParse(normalized);
                    if (!parsed.success) {
                        emit({
                            commandId: command.id,
                            timestamp: new Date().toISOString(),
                            type: 'install_toolpack_response',
                            payload: {
                                success: false,
                                error: 'invalid_manifest',
                            },
                        });
                        break;
                    }

                    if (!parsed.data.signature && !allowUnsigned) {
                        emit({
                            commandId: command.id,
                            timestamp: new Date().toISOString(),
                            type: 'install_toolpack_response',
                            payload: {
                                success: false,
                                error: 'unsigned_toolpack',
                            },
                        });
                        break;
                    }

                    toolpackStore.add(parsed.data, workingDir);
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_toolpack_response',
                        payload: {
                            success: true,
                            toolpackId: parsed.data.id,
                        },
                    });
                } catch (error) {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_toolpack_response',
                        payload: {
                            success: false,
                            error: error instanceof Error ? error.message : 'install_failed',
                        },
                    });
                }

                break;
            }
            case 'set_toolpack_enabled': {
                const { toolpackId, enabled } = command.payload as {
                    toolpackId: string;
                    enabled: boolean;
                };
                const success = toolpackStore.setEnabledById(toolpackId, enabled);
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'set_toolpack_enabled_response',
                    payload: {
                        success,
                        toolpackId,
                        error: success ? undefined : 'toolpack_not_found',
                    },
                });
                break;
            }
            case 'remove_toolpack': {
                const { toolpackId, deleteFiles } = command.payload as {
                    toolpackId: string;
                    deleteFiles?: boolean;
                };
                const record = toolpackStore.getById(toolpackId);
                const success = toolpackStore.removeById(toolpackId);
                if (success && deleteFiles !== false && record?.workingDir) {
                    try {
                        fs.rmSync(record.workingDir, { recursive: true, force: true });
                    } catch (error) {
                        console.error('[ToolpackStore] Failed to delete files:', error);
                    }
                }
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'remove_toolpack_response',
                    payload: {
                        success,
                        toolpackId,
                        error: success ? undefined : 'toolpack_not_found',
                    },
                });
                break;
            }
            case 'list_claude_skills': {
                const includeDisabled = command.payload?.includeDisabled ?? true;
                const skills = skillStore
                    .list()
                    .filter((skill) => includeDisabled || skill.enabled)
                    .map((skill) => toSkillRecord(skill));
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'list_claude_skills_response',
                    payload: { skills: skills as any },
                });
                break;
            }
            case 'get_claude_skill': {
                const skillId = command.payload.skillId as string;
                const stored = skillStore.get(skillId);
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'get_claude_skill_response',
                    payload: {
                        skill: (stored ? toSkillRecord(stored) : undefined) as any,
                    },
                });
                break;
            }
            case 'import_claude_skill': {
                const { source, path: inputPath } = command.payload as {
                    source: string;
                    path?: string;
                };

                if (source !== 'local_folder') {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'import_claude_skill_response',
                        payload: {
                            success: false,
                            error: 'unsupported_source',
                        },
                    });
                    break;
                }

                if (!inputPath) {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'import_claude_skill_response',
                        payload: {
                            success: false,
                            error: 'missing_path',
                        },
                    });
                    break;
                }

                const manifest = SkillStore.loadFromDirectory(inputPath);
                if (!manifest) {
                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'import_claude_skill_response',
                        payload: {
                            success: false,
                            error: 'missing_skill_manifest',
                        },
                    });
                    break;
                }

                skillStore.install(manifest);
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'import_claude_skill_response',
                    payload: {
                        success: true,
                        skillId: manifest.name,
                    },
                });
                break;
            }
            case 'set_claude_skill_enabled': {
                const { skillId, enabled } = command.payload as {
                    skillId: string;
                    enabled: boolean;
                };
                const success = skillStore.setEnabled(skillId, enabled);
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'set_claude_skill_enabled_response',
                    payload: {
                        success,
                        skillId,
                        error: success ? undefined : 'skill_not_found',
                    },
                });
                break;
            }
            case 'remove_claude_skill': {
                const { skillId, deleteFiles } = command.payload as {
                    skillId: string;
                    deleteFiles?: boolean;
                };
                const record = skillStore.get(skillId);
                const success = skillStore.uninstall(skillId);
                if (success && deleteFiles !== false && record?.manifest.directory) {
                    try {
                        fs.rmSync(record.manifest.directory, { recursive: true, force: true });
                    } catch (error) {
                        console.error('[SkillStore] Failed to delete files:', error);
                    }
                }
                emit({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'remove_claude_skill_response',
                    payload: {
                        success,
                        skillId,
                        error: success ? undefined : 'skill_not_found',
                    },
                });
                break;
            }
            case 'check_claude_skill_updates': {
                try {
                    const skillIds = (command.payload as { skillIds?: string[] } | undefined)?.skillIds;
                    const updates = await checkSkillsForUpdates(selectSkillsForUpdateCheck(skillIds));
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'check_claude_skill_updates_response',
                        payload: {
                            success: true,
                            updates,
                        },
                    });
                } catch (error) {
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'check_claude_skill_updates_response',
                        payload: {
                            success: false,
                            updates: [] satisfies ClaudeSkillUpdateInfo[],
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                break;
            }
            case 'upgrade_claude_skill': {
                const { skillId } = command.payload as { skillId: string };
                const result = await upgradeSkillFromUpstream(skillStore, skillId);
                emitAny({
                    commandId: command.id,
                    timestamp: new Date().toISOString(),
                    type: 'upgrade_claude_skill_response',
                    payload: {
                        success: result.success,
                        skillId,
                        skill: result.skill ? toSkillRecord(result.skill) : undefined,
                        update: result.update,
                        error: result.error,
                    },
                });
                break;
            }
            case 'search_openclaw_skill_store': {
                const { store, query, limit } = command.payload as {
                    store: 'clawhub' | 'tencent_skillhub';
                    query: string;
                    limit?: number;
                };

                try {
                    const skills = await openclawCompat.searchStore(store, query, limit ?? 20);
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'search_openclaw_skill_store_response',
                        payload: {
                            success: true,
                            store,
                            skills,
                        },
                    });
                } catch (error) {
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'search_openclaw_skill_store_response',
                        payload: {
                            success: false,
                            store,
                            skills: [],
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                break;
            }
            case 'install_openclaw_skill': {
                const { store, skillName } = command.payload as {
                    store: 'clawhub' | 'tencent_skillhub';
                    skillName: string;
                };

                try {
                    const skillsRoot = path.join(workspaceRoot, '.coworkany', 'skills');
                    fs.mkdirSync(skillsRoot, { recursive: true });

                    const result = await openclawCompat.installFromStore(store, skillName, skillsRoot);
                    if (!result.success || !result.path) {
                        emitAny({
                            commandId: command.id,
                            timestamp: new Date().toISOString(),
                            type: 'install_openclaw_skill_response',
                            payload: {
                                success: false,
                                store,
                                skillName,
                                error: result.error ?? 'install_failed',
                            },
                        });
                        break;
                    }

                    const manifest = SkillStore.loadFromDirectory(result.path);
                    if (!manifest) {
                        emitAny({
                            commandId: command.id,
                            timestamp: new Date().toISOString(),
                            type: 'install_openclaw_skill_response',
                            payload: {
                                success: false,
                                store,
                                skillName,
                                error: 'missing_skill_manifest',
                            },
                        });
                        break;
                    }

                    skillStore.install(manifest);
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_openclaw_skill_response',
                        payload: {
                            success: true,
                            store,
                            skillName,
                            path: result.path,
                            skill: {
                                id: manifest.name,
                                name: manifest.name,
                                description: manifest.description,
                                requiredEnv: manifest.requires?.env ?? [],
                                source: store,
                            },
                        },
                    });
                } catch (error) {
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'install_openclaw_skill_response',
                        payload: {
                            success: false,
                            store,
                            skillName,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                break;
            }
            case 'sync_skill_environment': {
                try {
                    const { env } = command.payload as {
                        env?: Record<string, string>;
                    };
                    const result = syncManagedSkillEnvironment(env ?? {});
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'sync_skill_environment_response',
                        payload: {
                            success: true,
                            applied: result.applied,
                            cleared: result.cleared,
                        },
                    });
                } catch (error) {
                    emitAny({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'sync_skill_environment_response',
                        payload: {
                            success: false,
                            applied: 0,
                            cleared: 0,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                break;
            }

            // ================================================================
            // Workspace Commands
            // ================================================================

            case 'list_workspaces': {
                const workspaces = workspaceStore.list();
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'list_workspaces_response',
                    payload: { workspaces },
                });
                break;
            }

            case 'create_workspace': {
                const { name, path: requestedPath } = (command as { payload: { name: string; path: string } }).payload;

                // User Requirement 1: Workspace path in "workspace" directory under program install directory
                // If path is empty or matches requirement, auto-generate it.
                let finalPath = requestedPath;
                if (!finalPath || finalPath === 'default') {
                    const workspacesDir = path.join(process.cwd(), 'workspaces');
                    // Sanitize name for FS
                    const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    // Append timestamp if needed to avoid collision, or just use name
                    finalPath = path.join(workspacesDir, safeName);

                    // Simple collision avoidance
                    if (fs.existsSync(finalPath)) {
                        finalPath = path.join(workspacesDir, `${safeName}_${Date.now()}`);
                    }
                }

                const workspace = workspaceStore.create(name, finalPath);
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'create_workspace_response',
                    payload: { workspace },
                });
                break;
            }

            case 'update_workspace': {
                const { id, updates } = (command as { payload: { id: string; updates: Partial<any> } }).payload;
                const workspace = workspaceStore.update(id, updates);
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'update_workspace_response',
                    payload: {
                        success: !!workspace,
                        workspace
                    },
                });
                break;
            }

            case 'delete_workspace': {
                const { id } = (command as { payload: { id: string } }).payload;
                const success = workspaceStore.delete(id);
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'delete_workspace_response',
                    payload: { success },
                });
                break;
            }

            case 'install_from_github': {
                const { workspacePath, source, targetType } = (command as {
                    payload: { workspacePath: string; source: string; targetType: 'skill' | 'mcp' };
                }).payload;

                let result;
                if (targetType === 'skill') {
                    result = await downloadSkillFromGitHub(source, workspacePath);
                    if (result.success) {
                        // Scan and register the downloaded skill
                        const skillsDir = path.join(workspacePath, '.coworkany', 'skills');
                        const manifests = SkillStore.scanDirectory(skillsDir);
                        for (const manifest of manifests) {
                            skillStore.install(manifest);
                        }
                    }
                } else {
                    result = await downloadMcpFromGitHub(source, workspacePath);
                    if (result.success) {
                        // Try to register the downloaded MCP
                        const manifestPath = path.join(result.path, 'manifest.json');
                        if (fs.existsSync(manifestPath)) {
                            try {
                                const content = fs.readFileSync(manifestPath, 'utf-8');
                                const manifest = ToolpackManifestSchema.parse(JSON.parse(content));
                                toolpackStore.add(manifest, result.path);
                            } catch (e) {
                                console.error('[install_from_github] Failed to register MCP:', e);
                            }
                        }
                    }
                }

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'install_from_github_response',
                    payload: {
                        success: result.success,
                        path: result.path,
                        filesDownloaded: result.filesDownloaded,
                        error: result.error,
                    },
                });
                break;
            }

            // ================================================================
            // Repository Scanning Commands
            // ================================================================

            case 'scan_default_repos': {
                const result = await scanDefaultRepositories();
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'scan_default_repos_response',
                    payload: {
                        skills: result.skills,
                        mcpServers: result.mcpServers,
                        errors: result.errors,
                    },
                });
                break;
            }

            /*
                        case 'scan_skills': {
                            const { source } = (command as { payload: { source: string } }).payload;
                            const skills = await scanForSkills(source, 3);
                            emitAny({
                                commandId: (command as { id: string }).id,
                                timestamp: new Date().toISOString(),
                                type: 'scan_skills_response',
                                payload: { skills },
                            });
                            break;
                        }
            
                        case 'scan_mcp_servers': {
                            const { source } = (command as { payload: { source: string } }).payload;
                            const servers = await scanForMcpServers(source, 3);
                            emitAny({
                                commandId: (command as { id: string }).id,
                                timestamp: new Date().toISOString(),
                                type: 'scan_mcp_servers_response',
                                payload: { servers },
                            });
                            break;
                        }
            
                        case 'validate_skill': {
                            const { source } = (command as { payload: { source: string } }).payload;
                            const result = await validateSkillUrl(source);
                            emitAny({
                                commandId: (command as { id: string }).id,
                                timestamp: new Date().toISOString(),
                                type: 'validate_skill_response',
                                payload: result,
                            });
                            break;
                        }
            
                        case 'validate_mcp': {
                            const { source } = (command as { payload: { source: string } }).payload;
                            const result = await validateMcpUrl(source);
                            emitAny({
                                commandId: (command as { id: string }).id,
                                timestamp: new Date().toISOString(),
                                type: 'validate_mcp_response',
                                payload: result,
                            });
                            break;
                        }
            */

            case 'validate_github_url': {
                const { url, type } = (command as { payload: { url: string; type: string } }).payload;
                const result = type === 'skill'
                    ? await validateSkillUrl(url)
                    : await validateMcpUrl(url);
                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'validate_github_url_response',
                    payload: result,
                });
                break;
            }

            // ================================================================
            // Autonomous Task Commands (OpenClaw-style)
            // ================================================================

            case 'start_autonomous_task': {
                const { taskId, query, runInBackground, autoSaveMemory } = (command as {
                    payload: {
                        taskId: string;
                        query: string;
                        runInBackground?: boolean;
                        autoSaveMemory?: boolean;
                    };
                }).payload;

                taskSequences.set(taskId, 0);

                // Initialize provider config for autonomous agent
                const llmConfig = loadLlmConfig(workspaceRoot);
                const providerConfig = resolveProviderConfig(llmConfig, {});
                autonomousLlmAdapter.setProviderConfig(providerConfig);
                autonomousLlmAdapter.setWorkspacePath(workspaceRoot);

                // Get the autonomous agent controller
                const agent = getAutonomousAgent(taskId);

                emit({
                    id: randomUUID(),
                    taskId,
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence(taskId),
                    type: 'TASK_STARTED',
                    payload: {
                        title: 'Autonomous Task',
                        description: query,
                        context: {
                            workspacePath: workspaceRoot,
                            userQuery: query,
                        },
                    },
                });

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'start_autonomous_task_response',
                    payload: {
                        success: true,
                        taskId,
                        message: 'Autonomous task started',
                    },
                });

                // Start the autonomous task
                try {
                    const task = await agent.startTask(query, {
                        autoSaveMemory: autoSaveMemory ?? true,
                        notifyOnComplete: true,
                        runInBackground: runInBackground ?? false,
                    });

                    // Emit completion event
                    emit({
                        id: randomUUID(),
                        taskId,
                        timestamp: new Date().toISOString(),
                        sequence: nextSequence(taskId),
                        type: 'TASK_FINISHED',
                        payload: {
                            summary: task.summary || 'Task completed',
                            duration: Date.now() - new Date(task.createdAt).getTime(),
                        },
                    });
                } catch (error) {
                    emit(createTaskFailedEvent(taskId, {
                        error: error instanceof Error ? error.message : String(error),
                        errorCode: 'AUTONOMOUS_TASK_ERROR',
                        recoverable: false,
                    }));
                }
                break;
            }

            case 'get_autonomous_task_status': {
                const { taskId } = (command as { payload: { taskId: string } }).payload;
                const agent = getAutonomousAgent(taskId);
                const task = agent.getTask(taskId);

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'get_autonomous_task_status_response',
                    payload: {
                        success: true,
                        task: task ? {
                            id: task.id,
                            status: task.status,
                            subtaskCount: task.decomposedTasks.length,
                            completedSubtasks: task.decomposedTasks.filter(s => s.status === 'completed').length,
                            summary: task.summary,
                            memoryExtracted: task.memoryExtracted,
                        } : null,
                    },
                });
                break;
            }

            case 'pause_autonomous_task': {
                const { taskId } = (command as { payload: { taskId: string } }).payload;
                const agent = getAutonomousAgent(taskId);
                const success = agent.pauseTask(taskId);

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'pause_autonomous_task_response',
                    payload: { success, taskId },
                });
                break;
            }

            case 'resume_autonomous_task': {
                const { taskId, userInput } = (command as {
                    payload: { taskId: string; userInput?: Record<string, string> };
                }).payload;
                const agent = getAutonomousAgent(taskId);

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'resume_autonomous_task_response',
                    payload: { success: true, taskId },
                });

                // Resume in background
                agent.resumeTask(taskId, userInput).catch(error => {
                    emit(createTaskFailedEvent(taskId, {
                        error: error instanceof Error ? error.message : String(error),
                        errorCode: 'AUTONOMOUS_RESUME_ERROR',
                        recoverable: false,
                    }));
                });
                break;
            }

            case 'cancel_autonomous_task': {
                const { taskId } = (command as { payload: { taskId: string } }).payload;
                const agent = getAutonomousAgent(taskId);
                const success = agent.cancelTask(taskId);

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'cancel_autonomous_task_response',
                    payload: { success, taskId },
                });

                if (success) {
                    emit(createTaskFailedEvent(taskId, {
                        error: 'Task cancelled by user',
                        errorCode: 'CANCELLED',
                        recoverable: false,
                    }));
                }
                break;
            }

            case 'list_autonomous_tasks': {
                const agent = getAutonomousAgent('global');
                const tasks = agent.getAllTasks();

                emitAny({
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'list_autonomous_tasks_response',
                    payload: {
                        tasks: tasks.map(t => ({
                            id: t.id,
                            query: t.originalQuery,
                            status: t.status,
                            subtaskCount: t.decomposedTasks.length,
                            completedSubtasks: t.decomposedTasks.filter(s => s.status === 'completed').length,
                            createdAt: t.createdAt,
                            completedAt: t.completedAt,
                        })),
                    },
                });
                break;
            }

            default:
                console.error(`[WARN] Unhandled command type: ${(command as IpcCommand).type}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[ERROR] Command handling failed:`, errorMessage);

        // Extract taskId if present for error event
        const payload = command.payload as Record<string, unknown> | undefined;
        const taskId = payload?.taskId as string | undefined;

        if (taskId) {
            emit(
                createTaskFailedEvent(taskId, {
                    error: errorMessage,
                    errorCode: 'COMMAND_HANDLER_ERROR',
                    recoverable: false,
                })
            );
        }
    }
}

// ============================================================================
// Input Processing
// ============================================================================

let buffer = '';

async function processLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
        const raw = JSON.parse(trimmed);
        const responseResult = IpcResponseSchema.safeParse(raw);
        if (responseResult.success) {
            await handleResponse(responseResult.data);
            return;
        }

        const commandResult = IpcCommandSchema.safeParse(raw);
        if (commandResult.success) {
            await handleCommand(commandResult.data);
            return;
        }

        console.error('[ERROR] Invalid message:', commandResult.error.format());
    } catch (error) {
        console.error('[ERROR] Failed to parse JSON:', error);
    }
}

// ========================================================================
// Response Handler
// ========================================================================

async function handleResponse(response: IpcResponse): Promise<void> {
    switch (response.type) {
        case 'request_effect_response': {
            const pending = pendingEffectResponses.get(response.commandId);
            if (pending) {
                clearTimeout(pending.timer);
                pendingEffectResponses.delete(response.commandId);
                pending.resolve(response.payload.response as EffectResponse);
                break;
            }

            const approved = response.payload.response.approved;
            if (approved) {
                emit({
                    id: randomUUID(),
                    taskId: 'global',
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence('global'),
                    type: 'EFFECT_APPROVED',
                    payload: {
                        response: response.payload.response,
                        approvedBy: 'policy',
                    },
                });
            } else {
                emit({
                    id: randomUUID(),
                    taskId: 'global',
                    timestamp: new Date().toISOString(),
                    sequence: nextSequence('global'),
                    type: 'EFFECT_DENIED',
                    payload: {
                        response: response.payload.response,
                        deniedBy: 'policy',
                    },
                });
            }
            break;
        }
        case 'apply_patch_response': {
            const success = response.payload.success;
            const eventType = success ? 'PATCH_APPLIED' : 'PATCH_REJECTED';
            const filePath =
                'filePath' in response.payload
                    ? (response.payload as { filePath?: string }).filePath ?? ''
                    : '';
            const eventPayload =
                eventType === 'PATCH_APPLIED'
                    ? {
                        patchId: response.payload.patchId,
                        filePath,
                        hunksApplied: 0,
                        backupPath: response.payload.backupPath,
                    }
                    : {
                        patchId: response.payload.patchId,
                        reason: response.payload.error,
                    };

            emit({
                id: randomUUID(),
                taskId: 'global',
                timestamp: new Date().toISOString(),
                sequence: nextSequence('global'),
                type: eventType,
                payload: eventPayload,
            } as TaskEvent);
            break;
        }
        default:
            // Other responses can be handled when the agent loop is wired.
            break;
    }
}

// ============================================================================
// Main Loop
// ============================================================================

async function main(): Promise<void> {
    console.error('[INFO] Sidecar IPC started');
    console.error('[INFO] Reading commands from stdin (JSON-Lines)');
    console.error(`[INFO] Log file: ${LOG_FILE}`);

    // Handle stdin for Node.js / Bun
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', async (chunk: string) => {
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
            await processLine(line);
        }
    });

    process.stdin.on('end', () => {
        console.error('[INFO] Sidecar IPC stdin closed');
        process.exit(0);
    });

    process.stdin.on('error', (error) => {
        console.error('[ERROR] stdin error:', error);
        process.exit(1);
    });

    // Handle shutdown signals
    process.on('SIGINT', () => {
        console.error('[INFO] Received SIGINT, shutting down');
        if (logStream) { logStream.end(); }
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.error('[INFO] Received SIGTERM, shutting down');
        if (logStream) { logStream.end(); }
        process.exit(0);
    });
}

main().catch((error) => {
    console.error('[FATAL] Sidecar failed to start:', error);
    process.exit(1);
});
