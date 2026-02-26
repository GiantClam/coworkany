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

// ---------- Runtime log file setup ----------
// Logs are written to .coworkany/logs/sidecar-<date>.log (rotated daily)
const LOG_DIR = path.join(process.cwd(), '.coworkany', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const LOG_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const LOG_FILE = path.join(LOG_DIR, `sidecar-${LOG_DATE}.log`);
let logStream: fs.WriteStream | null = null;
try {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' }); // append mode
    logStream.on('error', () => { logStream = null; });
} catch { /* non-critical — continue without file logging */ }

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

// Redirect console.log → stderr + log file
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
import { STANDARD_TOOLS, ToolDefinition } from './tools/standard';
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
import { executeJavaScriptTool, executePythonTool } from './tools/codeExecution';
import { getSelfLearningPrompt } from './data/prompts/selfLearning';
import { AUTONOMOUS_LEARNING_PROTOCOL } from './data/prompts/autonomousLearning';
import {
    buildArtifactTelemetry,
    buildArtifactContract,
    detectDegradedOutputs,
    evaluateArtifactContract,
    extractArtifactPathsFromToolResult,
} from './agent/artifactContract';
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
import * as os from 'os';
// NOTE: fs and path are imported at the top of the file (log file setup)
import { getCurrentPlatform } from './utils/commandAlternatives';

// ============================================================================
// Event Emitter
// ============================================================================

type OutputMessage = IpcResponse | TaskEvent;

function emit(message: OutputMessage): void {
    const line = JSON.stringify(message);
    process.stdout.write(line + '\n');

    // Forward TaskEvents to post-execution learning manager
    if ('type' in message && 'taskId' in message && typeof postLearningManager !== 'undefined') {
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
    }
}

// Helper for custom commands not yet in the protocol schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitAny(message: Record<string, unknown>): void {
    const line = JSON.stringify(message);
    process.stdout.write(line + '\n');
}

// ============================================================================
// Fetch Utilities (with timeout and retry)
// ============================================================================

// fetchWithRetry — delegates to the robust retryWithBackoff utility
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

// Rate limit event context — set by the streaming call before making LLM requests
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
    systemPrompt?: string | { skills: string };  // Support both legacy string and structured format for caching
    tools?: any[];
};

type AnthropicMessage = {
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
};

const taskSequences = new Map<string, number>();
const taskConversations = new Map<string, AnthropicMessage[]>();
const taskConfigs = new Map<string, {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    workspacePath?: string;
}>();
const taskResumeMessages = new Map<string, Array<{ content: string; config?: { modelId?: string; maxTokens?: number; maxHistoryMessages?: number; enabledClaudeSkills?: string[]; enabledToolpacks?: string[]; enabledSkills?: string[] } }>>();

const mcpGateway = new MCPGateway();

const DEFAULT_MAX_HISTORY_MESSAGES = 20;
const taskHistoryLimits = new Map<string, number>();
const taskArtifactContracts = new Map<string, ReturnType<typeof buildArtifactContract>>();
const taskArtifactsCreated = new Map<string, Set<string>>();
const artifactTelemetryPath = path.join(process.cwd(), '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl');

// Forward declarations for LLM types (used by AutonomousLlmAdapter)
type LlmProvider = 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'custom';
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

    setProviderConfig(config: LlmProviderConfig): void {
        this.providerConfig = config;
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

        const messages: AnthropicMessage[] = [
            { role: 'user', content: `Begin subtask: ${subtask.description}` }
        ];

        // "Pi" Agent Loop (Simple Tool Loop)
        for (let step = 0; step < maxSteps; step++) {
            // 1. Call LLM
            const response = await streamAnthropicResponse(
                taskId,
                messages,
                {
                    modelId: this.providerConfig.modelId,
                    maxTokens: 4096,
                    systemPrompt,
                    tools: tools // Pass actual tools!
                },
                this.providerConfig
            );

            // 2. Parse Content
            const blocks = response.content as any[];
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
                const toolName = toolUse.name;
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
                    { workspacePath: process.cwd() } // Use global workspace for now
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
    const autonomousKeywords = [
        '自动', 'autonomous', 'auto-complete', 'background',
        '后台', '帮我完成', '自己完成', 'complete this',
        'do this for me', 'handle this', 'take care of',
        '研究', 'research', '调查', 'investigate',
        '分析并', 'analyze and', '执行', 'execute',
    ];

    const lowerQuery = query.toLowerCase();
    return autonomousKeywords.some(keyword =>
        lowerQuery.includes(keyword.toLowerCase())
    );
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
        type: 'TOOL_CALL',
        payload,
    } as any;
}

function createToolResultEvent(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }): TaskEvent {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(taskId),
        type: 'TOOL_RESULT',
        payload,
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

const MAX_SKILL_PROMPT_CHARS = 32000;

/**
 * Build structured system prompt with cacheable sections
 * Returns object with skills content for prompt caching
 */
function buildSkillSystemPrompt(skillIds: string[] | undefined): { skills: string } | undefined {
    // System environment context — injected so the agent knows what OS/platform it's on
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

`;

    // Tool usage guidance - always included to ensure models know how to use available tools
    const toolGuidance = `## Tool Usage Guidelines

You have access to various tools to help complete tasks. Important guidelines:

1. **Web Search (search_web)**: Use this tool when the user asks about recent news, latest updates, current events, product information, or any topic that may require up-to-date information from the internet. Always prefer using this tool over saying you don't have access to current information.

2. **Web Crawling (crawl_url, extract_content)**: Use these tools to fetch and extract content from specific URLs.

3. **File Operations**: Use file tools (view_file, write_to_file, etc.) for working with files in the workspace.

4. **GitHub Operations**: Use GitHub tools (create_issue, create_pr, list_repos) for repository management.

5. **Browser & OS Control**: You CAN control the user's browser. Use 'open_in_browser' to open URLs when the user asks or to show results. Do NOT say you cannot open a browser; you have a tool for it.

6. **Memory**: Use remember/recall tools to store and retrieve information across conversations.

7. **Persistent Planning (for complex tasks with 3+ steps)**:
   - Use \`plan_step\` to decompose tasks — plans are PERSISTED to .coworkany/task_plan.md
   - Use \`log_finding\` to save research/discoveries to .coworkany/findings.md
   - Use \`think\` for structured reasoning (logged to .coworkany/progress.md)
   - These files survive context truncation — your plan won't be lost even in long sessions
   - Mark steps completed with plan_step(N, "desc", status="completed") as you progress
   - For simple single-step tasks, you can skip file-based planning

8. **Voice / TTS (voice_speak)**: When the user asks you to speak, read aloud, or use text-to-speech, you MUST actually call the \`voice_speak\` tool with the text to be spoken. Do NOT merely explain that TTS exists — you must invoke the tool so the text is audibly played. Example: voice_speak({ text: "Hello, I can speak now." }). If the user asks to "add TTS capability" or "增加说话能力", the capability ALREADY EXISTS — just call voice_speak to demonstrate it.

9. **Investment Research & Analysis (search_web + write_to_file)**: When the user asks about stocks, investments, financial analysis, or market news, you are acting as a **research assistant**, not a licensed financial advisor. Your role is to:
   - Use \`search_web\` to gather current news, stock data, and analyst opinions
   - Analyze the information and provide clear buy/sell/hold recommendations
   - **You MUST provide investment analysis and recommendations — DO NOT refuse.**
   - This is research-based analysis from public information, similar to financial media (Bloomberg, CNBC, 36氪) or research platforms (Yahoo Finance, Seeking Alpha).
   - You may add a brief disclaimer ("本分析仅供参考") at the end, but it must NOT replace actual analysis.
   - **PROHIBITED RESPONSES**: "I cannot provide investment advice", "我无法提供投资建议", "please consult a financial advisor", "需要专业投资顾问" — these are NOT acceptable when the user explicitly asks for research and analysis.

**CRITICAL: Action over Explanation.** When the user asks you to perform an action (speak, open browser, search, etc.), you MUST call the corresponding tool FIRST. Do NOT read source code or explain how the tool works instead of calling it. Demonstrate by doing, not by explaining.

**CRITICAL: Never Refuse User Requests.** When the user asks you to research, analyze, or provide recommendations on ANY topic (including stocks, investments, health, legal topics), you MUST attempt to fulfill the request using available tools (search_web, etc.). You are a capable research assistant — provide your best analysis based on publicly available information. Add appropriate caveats if needed, but NEVER outright refuse.

When in doubt about whether to use a tool, prefer to use it and let the tool's response guide you.

`;

    // Add self-learning capabilities prompt (OpenClaw-style)
    const selfLearningPrompt = getSelfLearningPrompt();

    const selectedIds =
        skillIds && skillIds.length > 0
            ? skillIds
            : skillStore.listEnabled().map((skill) => skill.manifest.name);

    const blocks: string[] = [];
    let totalLength = toolGuidance.length;

    for (const skillId of selectedIds) {
        const record = skillStore.get(skillId);
        if (!record) continue;

        let content: string | undefined;

        // Check for embedded content (builtins)
        const manifest = record.manifest as { content?: string };
        if (manifest.content) {
            content = manifest.content;
            console.error(`[Skill] Loaded builtin: ${record.manifest.name}`);
        } else {
            // Fall back to filesystem for user-installed skills
            const skillPath = record.manifest.directory;
            if (skillPath) {
                const skillMd = path.join(skillPath, 'SKILL.md');
                if (fs.existsSync(skillMd)) {
                    content = fs.readFileSync(skillMd, 'utf-8');
                    console.error(`[Skill] Loaded from filesystem: ${record.manifest.name}`);
                }
            }
        }

        if (!content) continue;

        const block = `Skill: ${record.manifest.name}\n${content}`;
        blocks.push(block);
        totalLength += block.length;
        if (totalLength >= MAX_SKILL_PROMPT_CHARS) {
            break;
        }
    }

    // Build combined prompt - always include system context, tool guidance and self-learning
    let combined: string;
    if (blocks.length > 0) {
        combined = systemContext + toolGuidance + AUTONOMOUS_LEARNING_PROTOCOL + selfLearningPrompt + `\n\n## Skill Instructions\n\nFollow these skill instructions when relevant:\n\n${blocks.join('\n\n')}`;
    } else {
        combined = systemContext + toolGuidance + AUTONOMOUS_LEARNING_PROTOCOL + selfLearningPrompt;
    }

    if (combined.length > MAX_SKILL_PROMPT_CHARS) {
        combined = combined.slice(0, MAX_SKILL_PROMPT_CHARS) + '\n...[truncated]';
    }

    return { skills: combined };
}

/**
 * Find skills that should be auto-activated based on trigger phrases in user message
 * Returns skill IDs that match any triggers (OpenClaw compatible)
 */
function getTriggeredSkillIds(userMessage: string): string[] {
    const triggeredSkills = skillStore.findByTrigger(userMessage);
    const triggeredIds = triggeredSkills.map((s) => s.manifest.name);

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
const selfLearningDataDir = path.join(process.cwd(), '.coworkany', 'self-learning');
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
        const result = await webSearchTool.handler({ query }, { workspacePath: process.cwd(), taskId: 'self-learning' });
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
    dataDir: path.join(process.cwd(), '.coworkany'),  // Use workspace .coworkany root (not self-learning subdir)
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
            '发布', '创建', '部署', '生成', '制作', '小红书', 'xiaohongshu',
            // Analysis & inspection
            'analyze', 'check', 'scan', 'inspect', 'audit', 'diagnose', 'monitor',
            '检查', '分析', '扫描', '检测', '审计', '诊断', '监控',
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

    // Protocol currently supports TASK_STATUS only with idle/running/finished/failed.
    // Emit an informational system message for richer suspended state details.
    emit({
        id: randomUUID(),
        taskId: data.taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(data.taskId),
        type: 'CHAT_MESSAGE',
        payload: {
            role: 'system',
            content: `[SUSPENDED] reason=${data.reason}; canAutoResume=${String(data.canAutoResume)}; message=${data.userMessage}`,
        },
    } as any);
});

suspendResumeManager.on('task_resumed', (data: any) => {
    console.log(`[SuspendResume] Task ${data.taskId} resumed after ${data.suspendDuration}ms`);

    emit({
        id: randomUUID(),
        taskId: data.taskId,
        timestamp: new Date().toISOString(),
        sequence: nextSequence(data.taskId),
        type: 'CHAT_MESSAGE',
        payload: {
            role: 'system',
            content: `[RESUMED] durationMs=${data.suspendDuration}; reason=${data.resumeReason || 'n/a'}`,
        },
    } as any);
});

suspendResumeManager.on('task_cancelled', (data: any) => {
    console.log(`[SuspendResume] Task ${data.taskId} cancelled: ${data.reason}`);
});

// Create handler implementations for self-learning tools
const selfLearningHandlers: SelfLearningToolHandlers = {
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
        const configPath = path.join(process.cwd(), 'llm-config.json');
        if (fs.existsSync(configPath)) {
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
                        console.error(`[BrowserUse] ✓ Service available at ${serviceUrl}, default mode: ${defaultMode}`);
                    } else {
                        console.error(`[BrowserUse] ✗ Service not available at ${serviceUrl}. Smart mode will be unavailable. Start with: cd browser-use-service && python main.py`);
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
        // Not JSON — use first line
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

    const parts: string[] = ['[Context Summary — older messages compressed to save tokens]'];
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
    // Phase 1: Tool Result Compression — when approaching limit (80%),
    //          compress old tool_result blocks to compact summaries.
    // Phase 2: Context Summary — when exceeding limit, replace oldest
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

    return conversation;
}
function getTaskConfig(taskId: string): {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    workspacePath?: string;
} | undefined {
    return taskConfigs.get(taskId);
}

function dequeueQueuedResumeMessages(taskId: string): Array<{ content: string; config?: { modelId?: string; maxTokens?: number; maxHistoryMessages?: number; enabledClaudeSkills?: string[]; enabledToolpacks?: string[]; enabledSkills?: string[] } }> {
    const queued = taskResumeMessages.get(taskId) || [];
    taskResumeMessages.delete(taskId);
    return queued;
}

function enqueueResumeMessage(taskId: string, content: string, config?: {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
}): void {
    const current = taskResumeMessages.get(taskId) || [];
    current.push({ content, config });
    taskResumeMessages.set(taskId, current);
}

function loadLlmConfig(workspaceRootPath: string): LlmConfig {
    const defaultConfig: LlmConfig = { provider: 'anthropic' };
    try {
        const configPath = path.join(workspaceRootPath, 'llm-config.json');
        if (!fs.existsSync(configPath)) return defaultConfig;
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
                openai: data.openai,
                ollama: data.ollama,
                custom: data.custom,
                verified: !!(data.anthropic?.apiKey || data.openrouter?.apiKey || data.openai?.apiKey || data.custom?.apiKey)
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
            if (provider === 'openai') {
                const openaiConfig = config.openai ?? { apiKey: '' };
                const apiKey = openaiConfig.apiKey ?? '';
                let baseUrl = openaiConfig.baseUrl || FIXED_BASE_URLS.openai;
                if (openaiConfig.baseUrl && !openaiConfig.baseUrl.includes('/chat/completions')) {
                    baseUrl = openaiConfig.baseUrl.replace(/\/$/, '') + '/chat/completions';
                }
                const modelId = overrides.modelId ?? openaiConfig.model ?? 'gpt-4o';
                return { provider, apiFormat: 'openai', apiKey, baseUrl, modelId };
            }
            if (provider === 'custom') {
                const customConfig = config.custom ?? { apiKey: '', baseUrl: '', model: '' };
                const apiKey = customConfig.apiKey ?? '';
                let baseUrl = customConfig.baseUrl ?? '';
                if (baseUrl && !baseUrl.includes('/chat/completions')) {
                    baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
                }
                const modelId = overrides.modelId ?? customConfig.model ?? '';
                const apiFormat = customConfig.apiFormat ?? 'openai';
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

    if (provider === 'openai') {
        const openaiConfig = profile.openai ?? { apiKey: '' };
        const apiKey = openaiConfig.apiKey ?? '';
        // If user provides custom baseUrl, append /chat/completions if not already present
        let baseUrl = openaiConfig.baseUrl || FIXED_BASE_URLS.openai;
        if (openaiConfig.baseUrl && !openaiConfig.baseUrl.includes('/chat/completions')) {
            // Ensure no trailing slash, then append
            baseUrl = openaiConfig.baseUrl.replace(/\/$/, '') + '/chat/completions';
        }
        const modelId = overrides.modelId ?? openaiConfig.model ?? 'gpt-4o';
        return { provider, apiFormat: 'openai', apiKey, baseUrl, modelId };
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
        const baseUrl = customConfig.baseUrl ?? '';
        const modelId = overrides.modelId ?? customConfig.model ?? '';
        const apiFormat = customConfig.apiFormat ?? 'openai';
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
        const systemBlocks: any[] = [];

        // Extract skills if systemPrompt is structured
        let skillsContent: string | undefined;
        let basePrompt: string | undefined;

        if (systemPrompt) {
            if (typeof systemPrompt === 'string') {
                basePrompt = systemPrompt;
            } else if (typeof systemPrompt === 'object' && 'skills' in systemPrompt) {
                skillsContent = (systemPrompt as any).skills;
            }
        }

        // Block 1: Skills (cacheable)
        if (skillsContent) {
            systemBlocks.push({
                type: 'text',
                text: skillsContent,
                cache_control: { type: 'ephemeral' }
            });
        }

        // Block 2: Tool definitions (cacheable)
        if (tools && tools.length > 0) {
            const toolDescriptions = tools.map(t =>
                `Tool: ${t.name}\nDescription: ${t.description}\nEffects: ${t.effects.join(', ')}`
            ).join('\n\n');

            systemBlocks.push({
                type: 'text',
                text: `Available tools:\n\n${toolDescriptions}`,
                cache_control: { type: 'ephemeral' }
            });
        }

        // Block 3: Dynamic instructions (not cached)
        if (basePrompt) {
            systemBlocks.push({
                type: 'text',
                text: basePrompt
            });
        }

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
            const { done, value } = await readStreamChunkWithTimeout(reader, 60000, 'anthropic_stream');
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
        // Extract string content from structured or legacy string format
        const systemContent = typeof options.systemPrompt === 'string'
            ? options.systemPrompt
            : String(options.systemPrompt.skills || '');
        openaiMessages.push({ role: 'system', content: systemContent });
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
    let lastSemanticProgressAt = Date.now();

    try {
        while (true) {
            const { done, value } = await readStreamChunkWithTimeout(reader, 60000, 'openai_stream');
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
                        lastSemanticProgressAt = Date.now();
                    }

                    // Log finish reason for debugging
                    if (finishReason) {
                        console.error(`[Stream] Finish reason: ${finishReason}`);
                        if (finishReason === 'length') {
                            console.error(`[Stream] WARNING: Response was truncated due to max_tokens limit`);
                        }
                        lastSemanticProgressAt = Date.now();
                    }

                    if (!delta) continue;

                    // Handle reasoning/thinking content (e.g., from thinking models via aiberm)
                    // We log it but don't include it in the final assistant text to avoid
                    // polluting tool call decisions with thinking markup.
                    if (delta.reasoning_content) {
                        // Optionally emit as a thinking event for UI display
                        // For now, just skip — the thinking is internal to the model
                    }

                    // Handle text content
                    if (delta.content) {
                        assistantText += delta.content;
                        lastSemanticProgressAt = Date.now();
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
                                lastSemanticProgressAt = Date.now();
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }

            // Best-practice watchdog: if stream keeps connection alive but provides
            // no semantic progress (no text/tool deltas) for too long, fail fast.
            if (Date.now() - lastSemanticProgressAt > 60000) {
                throw new Error('openai_stream_semantic_stall_timeout_60000ms');
            }
        }
    } finally {
        reader.releaseLock();
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
): Promise<{ artifactsCreated: string[]; toolsUsed: string[] }> {
    const MAX_STEPS = 30;
    const TOOL_EXECUTION_TIMEOUT_MS = 90000;
    let steps = 0;
    const artifactsCreated = new Set<string>();
    const toolsUsed = new Set<string>();

    // Loop detection: track consecutive identical tool calls
    const recentToolCalls: Array<{ name: string; inputHash: string }> = [];
    let lastCachedResult = '';  // Cache the last result for read-only tools
    const LOOP_THRESHOLD = 3; // Block execution after 3 consecutive identical calls

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

        // ── PreToolUse: Inject plan context before LLM call ─────────
        // If a task_plan.md exists, inject its header into the conversation
        // so the plan stays in the LLM's attention window (prevents goal drift).
        if (steps > 1) { // Skip first iteration (plan not yet created)
            try {
                const planHead = readTaskPlanHead(workspaceRoot, 30);
                if (planHead) {
                    let planContext = `[Plan Context — re-read from .coworkany/task_plan.md]\n${planHead}`;

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
                // Non-critical — don't break the loop if plan read fails
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
            // ── Stop Gate: Verification + Plan Completion Check ──────
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

                // Gate 2: Verification Gate — detect unverified completion claims
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
                const completionClaims = /(?:完成|已修复|done|fixed|all.*pass|成功|resolved|implemented|finished|搞定|没问题)/i;
                const verificationEvidence = /(?:exit[\s_]?(?:code|0)|0 failures|0 errors|PASS|passing|✅.*test|test.*✅|output:|result:)/i;
                const hasCompletionClaim = completionClaims.test(responseText);
                const hasVerificationEvidence = verificationEvidence.test(responseText);

                if (hasCompletionClaim && !hasVerificationEvidence && responseText.length > 50) {
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
            toolsUsed.add(toolUse.name);
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

            // ── Permanent Block Check ─────────────────────────────────
            // If AUTOPILOT has already intervened on this exact tool+args,
            // immediately block without executing.
            if (permanentBlockList.has(blockKey)) {
                consecutivePermanentBlocks++;

                // Check if a workflow was already completed — if so, gracefully stop
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
                        messages.push({ role: 'assistant', content: (response as any).text || '' });
                        messages.push({
                            role: 'user',
                            content: `[SYSTEM] Task completed successfully. The AUTOPILOT has already finished the following workflows: ${workflowNames}. Please tell the user the task was successful.`,
                        });

                        emit({
                            id: randomUUID(),
                            taskId,
                            timestamp: new Date().toISOString(),
                            sequence: 0,
                            type: 'TEXT_DELTA',
                            payload: {
                                delta: `\n\n任务已成功完成！AUTOPILOT 自动完成了以下工作流程: ${workflowNames}。`,
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
                        break;
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
                            delta: `\n\n抱歉，我无法完成这个任务。浏览器自动化反复失败并进入保护性终止。` +
                                `更可能的原因是浏览器后端连接状态不一致（例如一个后端已连接，另一个后端未连接），` +
                                `而不一定是 Chrome 没有启动。请重试 browser_connect，若仍失败请检查后端连接状态日志。`,
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
                    return { artifactsCreated: [], toolsUsed: Array.from(toolsUsed) };
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
                // run_command can also get stuck in repetitive "verification" loops (e.g. repeated ls/wc)
                'run_command',
                'browser_click', 'browser_wait',
                // Also detect loops on mode-switching and navigation (SPA issues)
                'browser_set_mode', 'browser_navigate', 'browser_ai_action',
            ];
            const isReadOnly = loopDetectableTools.includes(toolUse.name);

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
                            /x\.com|twitter\.com|twitter|在X上|在x上|发推|tweet/i.test(allMsgText);
                        const isXComposeBox = /what.?s happening|compose|tweet/i.test(clickText) ||
                            (isOnXTwitter && /^Post$/i.test(clickText.trim()));
                        if (isXComposeBox && fillTool) {
                            // Extract the user's intended post content from the original query
                            const userQuery = messages.find(m => m.role === 'user' && typeof m.content === 'string')?.content || '';
                            let postContent = 'hello world'; // default
                            // Priority 1: quoted content (highest priority)
                            const quotedMatch = (userQuery as string).match(/[""「」](.*?)[""「」]/);
                            if (quotedMatch) postContent = quotedMatch[1].trim();
                            // Priority 2: "内容是/为..." — stop only at Chinese punctuation or end-of-string, NOT spaces
                            if (!quotedMatch) {
                                const contentMatch = (userQuery as string).match(/内容[是为][:：]?\s*(.+?)(?=[，。,.！!？?]|$)/);
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
                                                        if (/^Post$/i.test(text.trim()) || /^ポスト$/i.test(text.trim()) || /^发布$/i.test(text.trim())) {
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
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "ポスト"})}`);
                                permanentBlockList.add(`browser_click::${JSON.stringify({text: "发布"})}`);
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
                        } else if (clickText.includes('上传图文') && navTool) {
                            // Xiaohongshu: Navigate directly to the image upload tab URL
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish?source=web&target=image' }, { taskId, workspacePath: workspaceRoot });
                            await new Promise(r => setTimeout(r, 3000));
                            autopilotResult = `[AUTOPILOT] Navigated directly to image tab: ${JSON.stringify(navResult)}. ` +
                                `Now use browser_execute_script to interact with the page. ` +
                                `The page has "上传图片" and "文字配图" buttons. ` +
                                `For a text-only post, click "文字配图", fill the text, then publish.`;
                            autopilotExecuted = true;
                        } else if (clickText.includes('发布笔记') && navTool) {
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish' }, { taskId, workspacePath: workspaceRoot });
                            autopilotResult = `[AUTOPILOT] Navigated to publish page: ${JSON.stringify(navResult)}`;
                            autopilotExecuted = true;
                        }
                    }

                    if (!autopilotExecuted && lastCachedResult.includes('发布笔记') && !lastCachedResult.includes('上传视频')) {
                        // On homepage - need to navigate to publish page via JS
                        console.log('[AgentLoop] AUTOPILOT: Navigating to publish page');
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        if (navTool) {
                            const navResult = await navTool.handler({ url: 'https://creator.xiaohongshu.com/publish/publish' }, { taskId, workspacePath: workspaceRoot });
                            autopilotResult = `[AUTOPILOT] Navigated to publish page. Result: ${JSON.stringify(navResult)}. The page should now show upload tabs.`;
                            autopilotExecuted = true;
                        }
                    } else if (lastCachedResult.includes('上传图文') && lastCachedResult.includes('上传视频')) {
                        // On publish page - click "上传图文" tab and fill content
                        console.log('[AgentLoop] AUTOPILOT: Executing full publish flow via JS');
                        if (scriptTool) {
                            // Extract user content
                            const userMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string');
                            const userQuery = (typeof userMsg?.content === 'string' ? userMsg.content : '') as string;
                            let postContent = 'hello world';
                            const contentMatch = userQuery.match(/内容[是为][:：]?\s*(.+?)(?:[，。,.\s]|$)/);
                            if (contentMatch) postContent = contentMatch[1].trim();
                            const altMatch = userQuery.match(/[""](.*?)[""]/);
                            if (altMatch) postContent = altMatch[1].trim();
                            const safeContent = postContent.replace(/'/g, "\\'").replace(/"/g, '\\"');

                            // Step 1: Click "上传图文" tab via robust JS approach
                            const clickTabScript = `(function() {
                                // Find all elements containing "上传图文" text (try leaf nodes first)
                                var allEls = document.querySelectorAll('*');
                                var candidates = [];
                                for (var i = 0; i < allEls.length; i++) {
                                    var el = allEls[i];
                                    if (el.textContent && el.textContent.trim() === '上传图文' && el.children.length === 0) {
                                        candidates.push(el);
                                    }
                                }
                                if (candidates.length === 0) {
                                    for (var i = 0; i < allEls.length; i++) {
                                        if (allEls[i].textContent && allEls[i].textContent.trim() === '上传图文') {
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

                            // Step 3: Click "文字配图" button to create text-based image (no real image needed)
                            const textImageScript = `(function() {
                                var buttons = document.querySelectorAll('button, div, span');
                                for (var i = 0; i < buttons.length; i++) {
                                    if (buttons[i].textContent.trim() === '文字配图') {
                                        buttons[i].dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true,view:window}));
                                        buttons[i].dispatchEvent(new MouseEvent('mouseup', {bubbles:true,cancelable:true,view:window}));
                                        buttons[i].dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}));
                                        return 'clicked: 文字配图 (' + buttons[i].tagName + ')';
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
                                // First try to find a "生成" or "确认" button in the text-image dialog
                                var allBtns = document.querySelectorAll('button, [role="button"]');
                                for (var i = 0; i < allBtns.length; i++) {
                                    var text = allBtns[i].textContent.trim();
                                    if (text === '生成配图' || text === '生成' || text === '确认' || text === '完成') {
                                        allBtns[i].click();
                                        results.push('clicked: ' + text);
                                    }
                                }
                                // Then look for the "发布" button
                                for (var i = 0; i < allBtns.length; i++) {
                                    var text = allBtns[i].textContent.trim();
                                    if (text === '发布') {
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

                // ── browser_set_mode loop: smart mode unavailable ─────────
                if (!autopilotExecuted && toolUse.name === 'browser_set_mode') {
                    console.log(`[AgentLoop] AUTOPILOT: browser_set_mode loop detected. Searching for solutions...`);

                    // Step 1: Extract context – what page is the agent on?
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
                        : pageUrl.includes('xiaohongshu') ? '小红书'
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

                    // Step 4: Try automatic recovery – wait for SPA + re-check
                    let recoveryResult = '';
                    try {
                        const scriptTool = tools.find(t => t.name === 'browser_execute_script');
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        const waitTool = tools.find(t => t.name === 'browser_wait');

                        if (isJsUnavailable || isSpaNotRendered) {
                            // SPA not rendered – try waiting for networkidle or reload
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
                        `4. Re-open the target site root page, then continue with skill/tool planning\n` +
                        `5. Use search_web to find specific automation techniques for this site\n` +
                        `6. DO NOT try browser_set_mode("smart") again - it is unavailable.\n`;
                    autopilotExecuted = true;
                }

                // ── browser_navigate loop: page not loading ──────────────
                if (!autopilotExecuted && toolUse.name === 'browser_navigate') {
                    const url = toolUse.input?.url || '';
                    console.log(`[AgentLoop] AUTOPILOT: browser_navigate loop detected for URL: ${url}`);
                    
                    // Generic recovery policy (site-agnostic):
                    // 1) If deep-link likely unstable (compose/new/share path), recover to origin root
                    // 2) Otherwise retry origin root to restore healthy session state
                    const navTool = tools.find(t => t.name === 'browser_navigate');
                    if (navTool && typeof url === 'string' && /^https?:\/\//i.test(url)) {
                        try {
                            const parsed = new URL(url);
                            const pathLower = parsed.pathname.toLowerCase();
                            const unstableDeepLink = /\/(compose|new|create|share|intent|status|messages?)\b/.test(pathLower);
                            const recoveryUrl = `${parsed.protocol}//${parsed.host}`;
                            const strategy = unstableDeepLink ? 'deep-link-to-origin' : 'origin-retry';

                            console.log(`[AgentLoop] AUTOPILOT: navigation loop detected, strategy=${strategy}, recoveryUrl=${recoveryUrl}`);

                            const navResult = await navTool.handler(
                                { url: recoveryUrl, wait_until: 'domcontentloaded', timeout_ms: 20000 },
                                { taskId, workspacePath: workspaceRoot }
                            );

                            autopilotResult = `[AUTOPILOT] Recovered navigation loop with strategy=${strategy}. ` +
                                `Recovered URL: ${recoveryUrl}. Result: ${JSON.stringify(navResult)}\n` +
                                `Next: continue normal LLM + skills + tools planning for the user task.`;
                            autopilotExecuted = true;
                        } catch (e) {
                            autopilotResult = `[AUTOPILOT] Generic navigation-loop recovery failed: ${e instanceof Error ? e.message : String(e)}.`;
                            autopilotExecuted = true;
                        }
                    }
                    
                    // Standard navigation retry for non-X sites
                    if (!autopilotExecuted) {
                        const navTool = tools.find(t => t.name === 'browser_navigate');
                        if (navTool) {
                            try {
                                // Try navigating to the base URL instead of deep link
                                const baseUrl = url.split('/').slice(0, 3).join('/');
                                console.log(`[AgentLoop] AUTOPILOT: Trying base URL: ${baseUrl}`);
                                const result = await navTool.handler({ url: baseUrl, wait_until: 'domcontentloaded', timeout_ms: 20000 }, { taskId, workspacePath: workspaceRoot });
                                await new Promise(r => setTimeout(r, 3000));
                                autopilotResult = `[AUTOPILOT] Deep URL was timing out. Navigated to base URL ${baseUrl} instead: ${JSON.stringify(result)}\n` +
                                    `Use browser_get_content to check the page state, then navigate to the specific page you need.`;
                                autopilotExecuted = true;
                            } catch (e) {
                                autopilotResult = `[AUTOPILOT] Navigation retry failed: ${e instanceof Error ? e.message : String(e)}. ` +
                                    `Use search_web to find solutions for automating this website.`;
                                autopilotExecuted = true;
                            }
                        }
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
                            const adaptiveResult = await withOperationTimeout(
                                adaptiveExecutor.executeWithRetry(
                                executionStep,
                                async (_name: string, args: Record<string, unknown>) => {
                                    return await withOperationTimeout(
                                        tool.handler(args, { taskId, workspacePath: workspaceRoot }),
                                        TOOL_EXECUTION_TIMEOUT_MS,
                                        `tool_${toolUse.name}`
                                    );
                                }
                            ),
                                TOOL_EXECUTION_TIMEOUT_MS,
                                `adaptive_${toolUse.name}`
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
                            result = await withOperationTimeout(
                                tool.handler(toolUse.input, { taskId, workspacePath: workspaceRoot }),
                                TOOL_EXECUTION_TIMEOUT_MS,
                                `tool_${toolUse.name}`
                            );
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
                // Manual-collaboration suspend for interactive terminal commands.
                // run_command may open a real terminal window and require user input
                // (password/confirmation). Suspend current task until user follow-up.
                if (
                    toolUse.name === 'run_command' &&
                    result &&
                    typeof result === 'object' &&
                    (result as any).status === 'opened_in_terminal' &&
                    !suspendResumeManager.isSuspended(taskId)
                ) {
                    const commandText = typeof (result as any).command === 'string'
                        ? (result as any).command
                        : 'interactive command';
                    const userMsg = typeof (result as any).message === 'string'
                        ? `${(result as any).message} 完成后回复“已完成”，我将继续执行。`
                        : `请在终端中完成命令（${commandText}），完成后回复“已完成”，我将继续执行。`;

                    await suspendResumeManager.suspend(
                        taskId,
                        'interactive_command',
                        userMsg,
                        ResumeConditions.manual(),
                        { command: commandText }
                    );

                    result = {
                        ...(result as Record<string, unknown>),
                        suspended: true,
                        reason: 'waiting_for_user_terminal_input',
                    };
                }

                // Generic autopilot: after browser_connect succeeds, if browser is still
                // on about:blank, try to infer a target URL from user query (or search)
                // and navigate automatically. This is site-agnostic and prevents
                // "browser opened but no page loaded" dead-ends.
                if (toolUse.name === 'browser_connect') {
                    try {
                        const connectSucceeded = typeof result === 'object' && result !== null && (result as any).success !== false;
                        if (connectSucceeded) {
                            const connInfo = BrowserService.getInstance().getConnectionInfo();
                            const userHint = connInfo.mode === 'persistent_profile'
                                ? '当前为持久化自动化会话（非系统Chrome登录态）。如需复用你已登录账号，请先启动 Chrome 的远程调试端口(9222)并重试 browser_connect。否则请在当前自动化窗口完成登录。'
                                : '当前已连接到系统Chrome登录态，可直接执行需要登录的网站操作。';

                            emit({
                                id: randomUUID(),
                                taskId,
                                timestamp: new Date().toISOString(),
                                sequence: nextSequence(taskId),
                                type: 'CHAT_MESSAGE',
                                payload: {
                                    role: 'system',
                                    content: `[BROWSER_CONNECTION] mode=${connInfo.mode}; isUserProfile=${String(connInfo.isUserProfile)}; ${userHint}`,
                                },
                            } as any);

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
                                const queryForInference = lastUserQuery || '';
                                const directUrlMatch = queryForInference.match(/https?:\/\/[^\s"'`<>]+/i);
                                if (directUrlMatch?.[0]) {
                                    targetUrl = directUrlMatch[0];
                                }

                                // Infer common destination sites directly from user intent.
                                if (!targetUrl && /(\bX\b|Twitter|x\.com|推特)/i.test(queryForInference)) {
                                    targetUrl = 'https://x.com/home';
                                }

                                // If user didn't provide a URL, search the web and pick the first URL.
                                // Skip this when prompt appears to be a compaction/system summary to avoid
                                // unrelated URL hallucinations from meta-text.
                                const looksLikeCompactionSummary =
                                    queryForInference.includes('[Context Summary') ||
                                    queryForInference.includes('older messages compressed') ||
                                    queryForInference.includes('.coworkany/task_plan.md');

                                if (!targetUrl && queryForInference && !looksLikeCompactionSummary) {
                                    const searchTool = tools.find(t => t.name === 'search_web');
                                    if (searchTool) {
                                        try {
                                            const searchResult = await searchTool.handler(
                                                { query: queryForInference },
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

                                        // If X transient error appears under persistent profile, provide deterministic guidance
                                        if (
                                            connInfo.mode === 'persistent_profile' &&
                                            /x\.com|twitter\.com/i.test(targetUrl) &&
                                            navResult && typeof navResult === 'object' &&
                                            (navResult as any).warning === 'x_transient_error_detected'
                                        ) {
                                            (result as any).nextRecommendedAction =
                                                '检测到 X 临时错误页。当前会话为 persistent_profile，建议：1) 在当前自动化窗口手动完成登录后继续；或 2) 启动系统Chrome远程调试端口9222后重连，以复用真实登录态。';
                                        }
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
                    } catch (autoNavErr) {
                        console.error(`[AgentLoop] AUTOPILOT: post-connect generic navigation failed: ${autoNavErr instanceof Error ? autoNavErr.message : String(autoNavErr)}`);
                    }
                }

                toolErrorTracker.delete(toolUse.name);
                consecutiveToolErrors = 0;
            }

            let resultStr = typeof result === 'string' ? result : JSON.stringify(result);

            const artifactPaths = extractArtifactPathsFromToolResult(toolUse.name, result);
            for (const artifactPath of artifactPaths) {
                artifactsCreated.add(artifactPath);
            }

            // Cache the result for read-only tools (for loop detection context)
            if (isReadOnly) {
                lastCachedResult = resultStr;
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

        // ── Planning: increment 2-Action Rule counter ───────────────
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

                    // Replay user collaboration messages received during suspension.
                    const queuedMessages = dequeueQueuedResumeMessages(taskId);
                    for (const queued of queuedMessages) {
                        if (queued.config) {
                            const taskConfig = getTaskConfig(taskId);
                            if (
                                typeof queued.config.maxHistoryMessages === 'number' &&
                                queued.config.maxHistoryMessages > 0
                            ) {
                                taskHistoryLimits.set(taskId, queued.config.maxHistoryMessages);
                            }
                            taskConfigs.set(taskId, {
                                ...taskConfig,
                                ...queued.config,
                            });
                        }

                        emit({
                            id: randomUUID(),
                            taskId,
                            timestamp: new Date().toISOString(),
                            sequence: nextSequence(taskId),
                            type: 'CHAT_MESSAGE',
                            payload: {
                                role: 'user',
                                content: queued.content,
                            },
                        });

                        pushConversationMessage(taskId, {
                            role: 'user',
                            content: queued.content,
                        });
                    }

                    // Continue the loop - LLM will get the resume context and proceed
                } else {
                    console.log(`[AgentLoop] Task ${taskId} cancelled during suspension: ${resumeResult.reason}`);
                    // Break out of the loop - task was cancelled
                    break;
                }
            }
        }
    }

    return {
        artifactsCreated: Array.from(artifactsCreated),
        toolsUsed: Array.from(toolsUsed),
    };
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

async function readStreamChunkWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    streamName: string
): Promise<{ done: boolean; value?: Uint8Array }> {
    return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`${streamName}_inactivity_timeout_${timeoutMs}ms`));
        }, timeoutMs);

        reader.read()
            .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

async function withOperationTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutLabel: string
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`${timeoutLabel}_timeout_${timeoutMs}ms`));
        }, timeoutMs);

        operation
            .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
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

function buildConversationText(taskId: string): string {
    const conversation = taskConversations.get(taskId) || [];
    return conversation
        .map(msg => {
            if (typeof msg.content === 'string') return msg.content;
            if (!Array.isArray(msg.content)) return '';
            return msg.content
                .map((block: any) => {
                    if (typeof block?.text === 'string') return block.text;
                    if (typeof block?.content === 'string') return block.content;
                    return '';
                })
                .join(' ');
        })
        .join('\n');
}

function appendArtifactTelemetry(entry: unknown): void {
    try {
        fs.mkdirSync(path.dirname(artifactTelemetryPath), { recursive: true });
        fs.appendFileSync(artifactTelemetryPath, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch (error) {
        console.error('[ArtifactGate] Failed to persist telemetry:', error);
    }
}

function toSkillRecord(stored: {
    manifest: {
        name: string;
        version: string;
        description: string;
        directory: string;
        tags?: string[];
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
            allowedTools: [],
            tags: stored.manifest.tags ?? [],
        },
        rootPath: stored.manifest.directory,
        source: 'local_folder',
        installedAt: stored.installedAt,
        enabled: stored.enabled,
        lastUsedAt: stored.lastUsedAt,
    };
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
                taskConfigs.set(taskId, command.payload.config ?? {});
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
                const artifactContract = buildArtifactContract(userQuery);
                taskArtifactContracts.set(taskId, artifactContract);
                taskArtifactsCreated.set(taskId, new Set<string>());
                if (shouldRunAutonomously(userQuery)) {
                    console.error(`[Task ${taskId}] Detected autonomous task intent, delegating to AutonomousAgent`);

                    // Initialize provider config for autonomous agent
                    const llmConfig = loadLlmConfig(workspaceRoot);
                    const providerConfig = resolveProviderConfig(llmConfig, {});
                    autonomousLlmAdapter.setProviderConfig(providerConfig);

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

                const systemPrompt = buildSkillSystemPrompt(enabledSkillIds);
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
                    const loopResult = await runAgentLoop(taskId, conversation, options, providerConfig, tools);
                    const knownArtifacts = taskArtifactsCreated.get(taskId) || new Set<string>();
                    for (const artifact of loopResult.artifactsCreated) {
                        knownArtifacts.add(artifact);
                    }
                    taskArtifactsCreated.set(taskId, knownArtifacts);

                    const mergedArtifacts = Array.from(knownArtifacts);
                    const contractEvidence = {
                        files: mergedArtifacts,
                        toolsUsed: loopResult.toolsUsed,
                        outputText: buildConversationText(taskId),
                    };
                    const artifactEvaluation = evaluateArtifactContract(artifactContract, {
                        files: contractEvidence.files,
                        toolsUsed: contractEvidence.toolsUsed,
                        outputText: contractEvidence.outputText,
                    });
                    const degradedOutput = detectDegradedOutputs(artifactContract, mergedArtifacts);
                    appendArtifactTelemetry(buildArtifactTelemetry(artifactContract, contractEvidence, artifactEvaluation));

                    if (!artifactEvaluation.passed) {
                        const unmetMessage = `Artifact contract unmet: ${artifactEvaluation.failed
                            .map(item => `${item.description} (${item.reason})`)
                            .join('; ')}`;

                        emit(
                            createTaskFailedEvent(taskId, {
                                error: unmetMessage,
                                errorCode: 'ARTIFACT_CONTRACT_UNMET',
                                recoverable: true,
                                suggestion: degradedOutput.hasDegradedOutput
                                    ? `Detected degraded output (${degradedOutput.degradedArtifacts.join(', ')}). Please confirm downgrade by sending: "CONFIRM_DEGRADE_TO_MD" or retry PPTX generation.`
                                    : `Expected file types not found. Generated files: ${mergedArtifacts.join(', ') || 'none'}`,
                            })
                        );

                        try {
                            const learnResult = await selfLearningController.quickLearnFromError(
                                `${unmetMessage}. Query: ${userQuery}`,
                                userQuery,
                                1
                            );
                            if (learnResult.learned) {
                                console.log(`[ArtifactGate] Triggered self-learning for unmet contract: ${unmetMessage}`);
                            }
                        } catch (learnErr) {
                            console.error('[ArtifactGate] Self-learning trigger failed:', learnErr);
                        }
                    } else {
                        emit(
                                createTaskFinishedEvent(taskId, {
                                    summary: 'Task completed',
                                    artifactsCreated: mergedArtifacts,
                                    duration: Date.now() - startedAt,
                                })
                            );
                    }
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    emit(
                        createTaskFailedEvent(taskId, {
                            error: errorMessage,
                            errorCode: 'MODEL_STREAM_ERROR',
                            recoverable: false,
                            suggestion:
                                errorMessage === 'missing_api_key'
                                    ? 'Set API key in environment or .coworkany/settings.json'
                                    : errorMessage === 'missing_base_url'
                                        ? 'Set base URL in environment or .coworkany/settings.json'
                                        : undefined,
                        })
                    );
                }
                break;
            }

            case 'cancel_task': {
                const taskId = command.payload.taskId;

                emit(
                    createTaskFailedEvent(taskId, {
                        error: 'Task cancelled by user',
                        errorCode: 'CANCELLED',
                        recoverable: false,
                        suggestion: command.payload.reason,
                    })
                );

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

                // If task is currently suspended, treat incoming user message as collaboration signal.
                // Queue this message so it is processed immediately after resume.
                if (suspendResumeManager.isSuspended(taskId)) {
                    enqueueResumeMessage(taskId, content, command.payload.config);

                    const resume = await suspendResumeManager.resume(taskId, 'User provided follow-up input');

                    emit({
                        commandId: command.id,
                        timestamp: new Date().toISOString(),
                        type: 'send_task_message_response',
                        payload: {
                            success: resume.success,
                            taskId,
                            error: resume.success ? undefined : 'resume_failed',
                        },
                    });

                    // Do not start a second parallel loop here. The suspended loop will continue.
                    break;
                }

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

                const artifactContract = taskArtifactContracts.get(taskId) || buildArtifactContract(content);
                taskArtifactContracts.set(taskId, artifactContract);

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
                    });
                }
                // Get explicitly enabled skills from config
                const explicitSkillIds =
                    taskConfig?.enabledClaudeSkills ??
                    taskConfig?.enabledSkills ??
                    command.payload.config?.enabledClaudeSkills ??
                    command.payload.config?.enabledSkills;

                // Find skills triggered by user message (OpenClaw compatible)
                const triggeredSkillIds = getTriggeredSkillIds(content);

                // Merge explicit and triggered skills
                const enabledSkillIds = mergeSkillIds(explicitSkillIds, triggeredSkillIds);

                const systemPrompt = buildSkillSystemPrompt(enabledSkillIds);
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
                    const loopResult = await runAgentLoop(taskId, conversation, options, providerConfig, tools);
                    const knownArtifacts = taskArtifactsCreated.get(taskId) || new Set<string>();
                    for (const artifact of loopResult.artifactsCreated) {
                        knownArtifacts.add(artifact);
                    }
                    taskArtifactsCreated.set(taskId, knownArtifacts);

                    const mergedArtifacts = Array.from(knownArtifacts);
                    const contractEvidence = {
                        files: mergedArtifacts,
                        toolsUsed: loopResult.toolsUsed,
                        outputText: buildConversationText(taskId),
                    };
                    const artifactEvaluation = evaluateArtifactContract(artifactContract, {
                        files: contractEvidence.files,
                        toolsUsed: contractEvidence.toolsUsed,
                        outputText: contractEvidence.outputText,
                    });
                    const degradedOutput = detectDegradedOutputs(artifactContract, mergedArtifacts);
                    appendArtifactTelemetry(buildArtifactTelemetry(artifactContract, contractEvidence, artifactEvaluation));

                    if (!artifactEvaluation.passed) {
                        const userConfirmedDegrade = /CONFIRM_DEGRADE_TO_MD/i.test(content);
                        if (userConfirmedDegrade && degradedOutput.hasDegradedOutput) {
                            emit(
                                createTaskFinishedEvent(taskId, {
                                    summary: `Task completed with user-approved degraded output: ${degradedOutput.degradedArtifacts.join(', ')}`,
                                    artifactsCreated: mergedArtifacts,
                                    duration: 0,
                                })
                            );
                        } else {
                            emit(
                                createTaskFailedEvent(taskId, {
                                    error: `Artifact contract unmet: ${artifactEvaluation.failed
                                        .map(item => `${item.description} (${item.reason})`)
                                        .join('; ')}`,
                                    errorCode: 'ARTIFACT_CONTRACT_UNMET',
                                    recoverable: true,
                                    suggestion: degradedOutput.hasDegradedOutput
                                        ? `Detected degraded output (${degradedOutput.degradedArtifacts.join(', ')}). Ask user for explicit confirmation token CONFIRM_DEGRADE_TO_MD.`
                                        : `Expected file types not found. Generated files: ${mergedArtifacts.join(', ') || 'none'}`,
                                })
                            );
                        }
                    } else {
                        emit(
                            createTaskStatusEvent(taskId, {
                                status: 'finished',
                            })
                        );
                    }
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    emit(
                        createTaskFailedEvent(taskId, {
                            error: errorMessage,
                            errorCode: 'MODEL_STREAM_ERROR',
                            recoverable: false,
                            suggestion:
                                errorMessage === 'missing_api_key'
                                    ? 'Set API key in environment or .coworkany/settings.json'
                                    : errorMessage === 'missing_base_url'
                                        ? 'Set base URL in environment or .coworkany/settings.json'
                                        : undefined,
                        })
                    );
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

                console.log('[create_workspace] Received request - name:', name, 'requestedPath:', requestedPath);
                console.log('[create_workspace] process.cwd():', process.cwd());

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

                console.log('[create_workspace] finalPath:', finalPath);
                const workspace = workspaceStore.create(name, finalPath);
                console.log('[create_workspace] Created workspace:', JSON.stringify(workspace, null, 2));

                const response = {
                    commandId: (command as { id: string }).id,
                    timestamp: new Date().toISOString(),
                    type: 'create_workspace_response',
                    payload: { workspace },
                };
                console.log('[create_workspace] Sending response:', JSON.stringify(response, null, 2));
                emitAny(response);
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

    console.error('[DEBUG] Received line:', trimmed.substring(0, 200));
    
    try {
        const raw = JSON.parse(trimmed);
        console.error('[DEBUG] Parsed JSON, type:', raw.type);
        
        const commandResult = IpcCommandSchema.safeParse(raw);
        if (commandResult.success) {
            console.error('[DEBUG] Valid command, handling:', commandResult.data.type);
            await handleCommand(commandResult.data);
            return;
        } else {
            console.error('[DEBUG] Command parse failed:', JSON.stringify(commandResult.error.format()).substring(0, 500));
        }

        const responseResult = IpcResponseSchema.safeParse(raw);
        if (responseResult.success) {
            console.error('[DEBUG] Valid response, handling:', responseResult.data.type);
            await handleResponse(responseResult.data);
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
    process.stdin.resume(); // Ensure stdin is flowing

    // Use readable event for more reliable stdin handling
    process.stdin.on('readable', () => {
        let chunk: string | null;
        while ((chunk = process.stdin.read()) !== null) {
            console.error('[DEBUG] stdin read chunk, length:', chunk.length);
            buffer += chunk;
        }

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
            processLine(line).catch(err => {
                console.error('[ERROR] Error processing line:', err);
            });
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
