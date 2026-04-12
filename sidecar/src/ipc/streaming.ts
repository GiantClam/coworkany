import { randomUUID } from 'crypto';
import type { MastraModelOutput } from '@mastra/core/stream';
import { supervisor } from '../mastra/agents/supervisor';
import { researcher } from '../mastra/agents/researcher';
import { chatResponder } from '../mastra/agents/chatResponder';
import { TaskContextCompressionStore, type RecalledTopicMemory } from '../mastra/contextCompression';
import { isMcpEnabled, listMcpToolsetsSafe } from '../mastra/mcp/clients';
import { formatTaskCapabilityRequirement, resolveTaskCapabilityRequirements } from '../mastra/capabilityRegistry';
import { createTaskRequestContext } from '../mastra/requestContext';
import { createTelemetryRunContext } from '../mastra/telemetry';
import {
    extractMastraFinalAssistantTextEvent,
    extractMastraTokenUsageEvent,
    isMastraOperationalProgressChunk,
    mapMastraChunkToDesktopEvent,
    type DesktopEvent,
    type MastraChunkLike,
} from './bridge';

type SendToDesktop = (event: DesktopEvent) => void;

type CompactHookPayload = {
    taskId: string;
    threadId: string;
    resourceId: string;
    workspacePath?: string;
    microSummary: string;
    structuredSummary: string;
    recalledMemoryFiles: string[];
};

type RunContext = {
    threadId: string;
    resourceId: string;
    taskId: string;
    turnId?: string;
    workspacePath?: string;
    enabledSkills?: string[];
    skillPrompt?: string;
    traceId: string;
    traceSampled: boolean;
};

type TimeoutStage = 'dns' | 'connect' | 'ttfb' | 'first_token' | 'last_token' | 'unknown';

type StreamTimingSnapshot = {
    elapsedMs: number;
    dnsMs: number | null;
    connectMs: number | null;
    ttfbMs: number | null;
    firstTokenMs: number | null;
    lastTokenMs: number | null;
};

type ProxyRuntimeSnapshot = {
    enabled: boolean;
    source: string | null;
    endpoint: string | null;
    noProxy: string | null;
};

type LlmTimingLogInput = {
    taskId: string;
    threadId: string;
    turnId?: string;
    modelId: string;
    provider: string;
    phase: 'stream' | 'generate_fallback';
    outcome: 'success' | 'error';
    attempt: number;
    maxAttempts: number;
    assistantChars: number;
    finishReason?: string;
    error?: unknown;
    timings: StreamTimingSnapshot;
    proxyBefore: ProxyRuntimeSnapshot;
    proxyAfter: ProxyRuntimeSnapshot;
};

type RateLimitedEmitInput = {
    runId?: string;
    attempt?: number;
    maxAttempts?: number;
    retryAfterMs?: number;
    error: unknown;
    message: string;
    stage?: TimeoutStage;
    timings?: StreamTimingSnapshot;
    turnId?: string;
};

const runContextById = new Map<string, RunContext>();
const MAX_CACHED_RUN_CONTEXTS = 256;
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const STREAM_START_RETRY_COUNT = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT ?? '1', 10);
const STREAM_START_RETRY_DELAY_MS = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_DELAY_MS ?? '250', 10);
const STREAM_FORWARD_RETRY_COUNT = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT ?? '5', 10);
const STREAM_FORWARD_RETRY_DELAY_MS = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS ?? '1000', 10);
const contextCompressionStore = new TaskContextCompressionStore();

const PROVIDER_KEY_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    aiberm: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    xai: 'XAI_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mistral: 'MISTRAL_API_KEY',
};
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
const WORKSPACE_EXECUTE_COMMAND_TOOL = 'mastra_workspace_execute_command';
const MARKET_DATA_QUERY_PATTERN = /\b(stock|stocks|share|shares|price|prices|quote|quotes|market|markets|equity|equities|finance|financial|ticker|tickers|hkex|nasdaq|nyse|a-share|a股|港股|美股|股价|行情|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低)\b|股|港股|美股|行情|股价|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低/iu;
const WEATHER_QUERY_PATTERN = /\b(weather|forecast|temperature|humidity|rain|snow|wind|uv|aqi|air quality|meteo)\b|天气|气温|温度|湿度|降雨|下雨|下雪|风力|空气质量|预报/iu;
const WEATHER_TOOL_NAME_PATTERN = /\b(weather|forecast|temperature|meteo|check_weather)\b|天气|气温|预报/iu;
const BROWSER_AUTOMATION_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill|type|select|scroll|tab)\b/iu;
const GENERIC_WEB_RESEARCH_TOOL_PATTERN = /\b(search_web|websearch|crawl_url|extract_content|browser|scrape|search)\b|搜索|检索|爬虫/iu;
const MARKET_SPECIALIZED_TOOL_PATTERN = /\b(finance|quote|ticker|stock|equity|market_data|price|ohlc|candlestick|kline|trade|trading|exchange|hkex|nasdaq|nyse)\b|股|港股|美股|行情|股价|涨跌|市值|成交量|开盘|收盘/iu;

type DynamicToolsets = Awaited<ReturnType<typeof listMcpToolsetsSafe>>;

export function isMarketDataResearchQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    return MARKET_DATA_QUERY_PATTERN.test(normalized);
}

function stripWorkspaceExecuteCommandTool(
    toolsets: DynamicToolsets,
): DynamicToolsets {
    let changed = false;
    const next: DynamicToolsets = {};
    for (const [serverName, serverTools] of Object.entries(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        if (!(WORKSPACE_EXECUTE_COMMAND_TOOL in serverTools)) {
            next[serverName] = serverTools;
            continue;
        }
        changed = true;
        const { [WORKSPACE_EXECUTE_COMMAND_TOOL]: _omitted, ...remaining } = serverTools;
        next[serverName] = remaining;
    }
    return changed ? next : toolsets;
}

function serializeToolMetaForMatching(
    toolName: string,
    toolMeta: unknown,
): string {
    if (!toolMeta || typeof toolMeta !== 'object') {
        return toolName;
    }
    const record = toolMeta as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const description = typeof record.description === 'string' ? record.description : '';
    return [toolName, id, description].filter((value) => value.length > 0).join(' ');
}

function pickMarketSpecializedToolsets(
    toolsets: DynamicToolsets,
): DynamicToolsets {
    const selected: DynamicToolsets = {};
    for (const [serverName, serverTools] of Object.entries(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        const specializedTools = Object.fromEntries(
            Object.entries(serverTools).filter(([toolName, toolMeta]) => {
                const corpus = serializeToolMetaForMatching(toolName, toolMeta);
                return MARKET_SPECIALIZED_TOOL_PATTERN.test(corpus)
                    && !GENERIC_WEB_RESEARCH_TOOL_PATTERN.test(corpus);
            }),
        );
        if (Object.keys(specializedTools).length > 0) {
            selected[serverName] = specializedTools as DynamicToolsets[string];
        }
    }
    return selected;
}

export function buildToolsetsForMessageAttempt(
    toolsets: DynamicToolsets,
    message: string,
    attempt: number,
    options?: {
        requiredCompletionCapabilities?: string[];
        isTaskRoute?: boolean;
        workspacePath?: string;
    },
): DynamicToolsets {
    if (attempt > 0) {
        return toolsets;
    }
    const inferredCapabilities = resolveTaskCapabilityRequirements({
        message,
        workspacePath: options?.workspacePath ?? process.cwd(),
    }).map(formatTaskCapabilityRequirement);
    const requiredCompletionCapabilities = Array.from(new Set(
        [...(options?.requiredCompletionCapabilities ?? []), ...inferredCapabilities]
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0),
    ));
    const needsToolFirstRouting = requiredCompletionCapabilities.length > 0
        || isMarketDataResearchQuery(message)
        || options?.isTaskRoute === true;
    const enableToolFirstPolicy = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TOOL_FIRST',
        resolveBooleanFromEnv('COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST', true),
    );
    if (!enableToolFirstPolicy || !needsToolFirstRouting) {
        return toolsets;
    }

    const sanitizedToolsets = stripWorkspaceExecuteCommandTool(toolsets);
    if (requiredCompletionCapabilities.includes('browser_automation')) {
        const browserOnlyToolsets = pickToolsetsByPattern(sanitizedToolsets, BROWSER_AUTOMATION_TOOL_PATTERN);
        if (Object.keys(browserOnlyToolsets).length > 0) {
            return browserOnlyToolsets;
        }
    }
    if (requiredCompletionCapabilities.includes('web_research') && isMarketDataResearchQuery(message)) {
        const firstAttemptSpecializedToolsets = pickMarketSpecializedToolsets(sanitizedToolsets);
        if (Object.keys(firstAttemptSpecializedToolsets).length > 0) {
            return firstAttemptSpecializedToolsets;
        }
    }
    return sanitizedToolsets;
}

function pickToolsetsByPattern(
    toolsets: DynamicToolsets,
    pattern: RegExp,
): DynamicToolsets {
    const selected: DynamicToolsets = {};
    for (const [serverName, serverTools] of Object.entries(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        const matchedTools = Object.fromEntries(
            Object.entries(serverTools).filter(([toolName, toolMeta]) => {
                const corpus = serializeToolMetaForMatching(toolName, toolMeta);
                return pattern.test(corpus);
            }),
        );
        if (Object.keys(matchedTools).length > 0) {
            selected[serverName] = matchedTools as DynamicToolsets[string];
        }
    }
    return selected;
}

export function normalizeRequiredCompletionCapabilities(
    capabilities: string[],
): string[] {
    return Array.from(new Set(
        capabilities
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0),
    ));
}

function deriveRequiredCompletionCapabilitiesForTurn(input: {
    message: string;
    workspacePath?: string;
    explicitRequiredCapabilities?: string[];
}): string[] {
    const inferredCapabilities = resolveTaskCapabilityRequirements({
        message: input.message,
        workspacePath: input.workspacePath ?? process.cwd(),
    }).map(formatTaskCapabilityRequirement);
    return normalizeRequiredCompletionCapabilities([
        ...(input.explicitRequiredCapabilities ?? []),
        ...inferredCapabilities,
    ]);
}

function shouldRouteTaskTurnToResearcher(input: {
    isTaskRoute: boolean;
    useDirectChatResponder: boolean;
    preferResearcherForWebResearchTasks: boolean;
    requiredCompletionCapabilities: string[];
}): boolean {
    return (
        !input.useDirectChatResponder
        && input.isTaskRoute
        && input.preferResearcherForWebResearchTasks
        && input.requiredCompletionCapabilities.includes('web_research')
    );
}

export function isWeatherInformationQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    return WEATHER_QUERY_PATTERN.test(normalized);
}

export function hasWeatherInformationTool(toolsets: DynamicToolsets): boolean {
    for (const serverTools of Object.values(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        for (const [toolName, toolMeta] of Object.entries(serverTools)) {
            if (WEATHER_TOOL_NAME_PATTERN.test(toolName)) {
                return true;
            }
            if (toolMeta && typeof toolMeta === 'object') {
                const record = toolMeta as unknown as Record<string, unknown>;
                const id = typeof record.id === 'string' ? record.id : '';
                const description = typeof record.description === 'string' ? record.description : '';
                if (WEATHER_TOOL_NAME_PATTERN.test(id) || WEATHER_TOOL_NAME_PATTERN.test(description)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function shouldDisableProxyForConfiguredLlmProvider(
    env: Record<string, string | undefined> = process.env,
): boolean {
    const keepProxyRaw = env.COWORKANY_KEEP_PROXY_FOR_OPENAI_COMPAT?.trim().toLowerCase();
    const keepProxy = keepProxyRaw === '1'
        || keepProxyRaw === 'true'
        || keepProxyRaw === 'yes'
        || keepProxyRaw === 'on';
    if (keepProxy) {
        return false;
    }
    const configuredProvider = env.COWORKANY_LLM_CONFIG_PROVIDER?.trim().toLowerCase();
    if (!configuredProvider) {
        const modelProvider = env.COWORKANY_MODEL?.split('/')[0]?.trim().toLowerCase();
        if (!modelProvider) {
            return false;
        }
        return modelProvider === 'openai'
            || OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(modelProvider);
    }
    if (configuredProvider === 'custom') {
        const customApiFormat = env.COWORKANY_LLM_CUSTOM_API_FORMAT?.trim().toLowerCase();
        return customApiFormat !== 'anthropic';
    }
    return OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(configuredProvider);
}

function disableProxyEnvForLlmPath(
    env: Record<string, string | undefined> = process.env,
): void {
    if (!shouldDisableProxyForConfiguredLlmProvider(env)) {
        return;
    }
    const keys = [
        'COWORKANY_PROXY_URL',
        'HTTPS_PROXY',
        'https_proxy',
        'HTTP_PROXY',
        'http_proxy',
        'ALL_PROXY',
        'all_proxy',
        'GLOBAL_AGENT_HTTPS_PROXY',
        'GLOBAL_AGENT_HTTP_PROXY',
        'COWORKANY_PROXY_SOURCE',
    ];
    for (const key of keys) {
        delete env[key];
    }
    env.NODE_USE_ENV_PROXY = '0';
}

export function resolveMissingApiKeyForModel(
    modelId: string,
    env: Record<string, string | undefined> = process.env,
): string | null {
    const configuredProvider = env.COWORKANY_LLM_CONFIG_PROVIDER?.trim().toLowerCase();
    if (configuredProvider === 'custom') {
        const customApiFormat = env.COWORKANY_LLM_CUSTOM_API_FORMAT?.trim().toLowerCase();
        const customKeyEnv = customApiFormat === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : 'OPENAI_API_KEY';
        return env[customKeyEnv] ? null : customKeyEnv;
    }
    if (configuredProvider && OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(configuredProvider)) {
        return env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY';
    }

    const provider = modelId.split('/')[0]?.toLowerCase();
    if (!provider) {
        return null;
    }
    const apiKeyEnv = PROVIDER_KEY_MAP[provider];
    if (!apiKeyEnv) {
        return null;
    }
    return env[apiKeyEnv] ? null : apiKeyEnv;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePositiveIntFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

function resolvePositiveIntFromEnvBounded(
    name: string,
    fallback: number,
    bounds?: {
        min?: number;
        max?: number;
    },
): number {
    const min = Number.isFinite(bounds?.min) ? Math.max(1, Math.floor(bounds?.min as number)) : 1;
    const max = Number.isFinite(bounds?.max) ? Math.max(min, Math.floor(bounds?.max as number)) : Number.POSITIVE_INFINITY;
    const value = resolvePositiveIntFromEnv(name, fallback);
    return Math.min(max, Math.max(min, value));
}

function resolveNonNegativeIntFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return fallback;
}

function resolveBooleanFromEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (typeof raw !== 'string') {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

function resolveRemainingBudgetMs(deadlineAt?: number): number | null {
    if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt)) {
        return null;
    }
    return Math.max(0, deadlineAt - Date.now());
}

function buildSkillGuidedMessage(message: string, skillPrompt?: string): string {
    const normalizedPrompt = typeof skillPrompt === 'string' ? skillPrompt.trim() : '';
    if (!normalizedPrompt) {
        return message;
    }
    return `${normalizedPrompt}\n\n[User Request]\n${message}`;
}

function toOptionalFiniteNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function resolveEarliestDeadline(deadlines: Array<number | null | undefined>): number | undefined {
    let earliest: number | undefined;
    for (const deadline of deadlines) {
        if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
            continue;
        }
        if (typeof earliest !== 'number' || deadline < earliest) {
            earliest = deadline;
        }
    }
    return earliest;
}

function isTurnBudgetTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bchat_turn_timeout_budget_exhausted\b/i.test(message);
}

function isStartupBudgetTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bchat_startup_timeout_budget_exhausted\b/i.test(message);
}

function isTransientStartError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_start_timeout|timeout|timed out|econnreset|network|429|rate.?limit|temporar(?:y|ily)|unavailable)\b/i.test(message);
}

function isRetryableForwardError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b(stream_idle_timeout|stream_progress_timeout|stream_exhausted_without_assistant_text|complete_without_assistant_text|timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
        .test(message)) {
        return true;
    }
    return /\b(No snapshot found for this workflow run|missing_terminal_after_tooling_progress)\b/i.test(message);
}

function isNoAssistantNarrativeCompletionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_exhausted_without_assistant_text|complete_without_assistant_text)\b/i.test(message);
}

function isWorkflowSnapshotMissingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bNo snapshot found for this workflow run\b/i.test(message);
}

function isMissingTerminalAfterToolingProgressError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bmissing_terminal_after_tooling_progress\b/i.test(message);
}

function isStreamInactivityTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_idle_timeout|stream_progress_timeout)\b/i.test(message);
}

function isStreamExecutionTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_idle_timeout|stream_progress_timeout|stream_absolute_timeout|stream_max_duration_timeout)\b/i.test(message);
}

function isLikelyAutoApprovedToolName(toolName: string): boolean {
    const normalized = toolName.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return normalized.startsWith('agent-')
        || normalized === 'updateworkingmemory'
        || normalized === 'memory_update';
}

function shouldTreatApprovalAsManualForNoNarrativeExemption(
    event: Extract<DesktopEvent, { type: 'approval_required' }>,
): boolean {
    return !isLikelyAutoApprovedToolName(event.toolName);
}

function isInternalCompletionCheckNarrative(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    if (/^#{1,6}\s*Completion Check Results\b/i.test(normalized)) {
        return true;
    }
    if (
        /\bcoworkany-loop-has-answer\b/i.test(normalized)
        && /\bcoworkany-loop-tools-settled\b/i.test(normalized)
    ) {
        return true;
    }
    return false;
}

function isStoreDisabledHistoryReferenceError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const mentionsStoreDisabled = message.includes('store')
        && message.includes('false')
        && (
            message.includes('not persisted')
            || message.includes('store is set to false')
        );
    if (mentionsStoreDisabled) {
        return true;
    }
    return message.includes('item with id')
        && message.includes('not found')
        && message.includes('store')
        && message.includes('false');
}

function resolveTimeoutStageFromError(
    error: unknown,
    context?: { hasAssistantText?: boolean; streamReady?: boolean },
): TimeoutStage {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (context?.hasAssistantText) {
        return 'last_token';
    }
    if (/getaddrinfo|enotfound|eai_again|dns/.test(normalized)) {
        return 'dns';
    }
    if (/econnrefused|connect|socket hang up/.test(normalized)) {
        return 'connect';
    }
    if (/headers timeout|ttfb|stream_start_timeout/.test(normalized)) {
        return 'ttfb';
    }
    if (context?.streamReady) {
        return 'first_token';
    }
    return 'unknown';
}

function buildTimingSnapshot(input: {
    startedAt: number;
    streamReadyAt: number | null;
    firstTokenAt: number | null;
    lastTokenAt: number | null;
    now?: number;
}): StreamTimingSnapshot {
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    return {
        elapsedMs: Math.max(0, now - input.startedAt),
        dnsMs: null,
        connectMs: null,
        ttfbMs: input.streamReadyAt !== null ? Math.max(0, input.streamReadyAt - input.startedAt) : null,
        firstTokenMs: input.firstTokenAt !== null ? Math.max(0, input.firstTokenAt - input.startedAt) : null,
        lastTokenMs: input.lastTokenAt !== null ? Math.max(0, input.lastTokenAt - input.startedAt) : null,
    };
}

function sanitizeProxyEndpoint(raw: string | undefined): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const parsed = new URL(candidate);
        const port = parsed.port ? `:${parsed.port}` : '';
        return `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
        return 'configured';
    }
}

function getProxyRuntimeSnapshot(
    env: Record<string, string | undefined> = process.env,
): ProxyRuntimeSnapshot {
    const proxyUrl = env.COWORKANY_PROXY_URL
        || env.HTTPS_PROXY
        || env.https_proxy
        || env.HTTP_PROXY
        || env.http_proxy
        || env.ALL_PROXY
        || env.all_proxy
        || env.GLOBAL_AGENT_HTTPS_PROXY
        || env.GLOBAL_AGENT_HTTP_PROXY;
    const source = env.COWORKANY_PROXY_SOURCE?.trim() || (proxyUrl ? 'env' : null);
    const noProxy = (env.NO_PROXY || env.no_proxy || '').trim();
    return {
        enabled: typeof proxyUrl === 'string' && proxyUrl.trim().length > 0,
        source,
        endpoint: sanitizeProxyEndpoint(proxyUrl),
        noProxy: noProxy.length > 0 ? noProxy : null,
    };
}

function summarizeErrorForLog(error: unknown): string | null {
    const normalized = String(error ?? '').trim();
    if (normalized.length === 0) {
        return null;
    }
    const maxChars = 320;
    return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function emitLlmTimingLog(input: LlmTimingLogInput): void {
    const payload = {
        event: 'llm_timing',
        taskId: input.taskId,
        threadId: input.threadId,
        turnId: input.turnId ?? null,
        modelId: input.modelId,
        provider: input.provider,
        phase: input.phase,
        outcome: input.outcome,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        assistantChars: input.assistantChars,
        finishReason: input.finishReason ?? null,
        error: summarizeErrorForLog(input.error),
        timings: input.timings,
        proxy: {
            before: input.proxyBefore,
            after: input.proxyAfter,
        },
        timestamp: new Date().toISOString(),
    };
    console.info(`[coworkany-metrics] ${JSON.stringify(payload)}`);
}

type DynamicToolsetResolution = {
    toolsets: Awaited<ReturnType<typeof listMcpToolsetsSafe>>;
    loadStatus: 'disabled' | 'ready' | 'timeout' | 'error';
    timeoutMs: number;
    elapsedMs: number;
    servedFromCache: boolean;
    cacheAgeMs: number | null;
};

type DynamicToolsetResolutionDependencies = {
    isMcpEnabledFn?: () => boolean;
    listMcpToolsetsFn?: () => Promise<Awaited<ReturnType<typeof listMcpToolsetsSafe>>>;
    now?: () => number;
};

let cachedDynamicToolsets: Awaited<ReturnType<typeof listMcpToolsetsSafe>> | null = null;
let cachedDynamicToolsetsAt: number | null = null;

export function resetDynamicToolsetCacheForTests(): void {
    cachedDynamicToolsets = null;
    cachedDynamicToolsetsAt = null;
}

function countDynamicTools(
    toolsets: Awaited<ReturnType<typeof listMcpToolsetsSafe>>,
): number {
    return Object.values(toolsets).reduce((count, serverTools) => (
        count + Object.keys(serverTools || {}).length
    ), 0);
}

function getCachedDynamicToolsetFallback(
    nowMs: number,
): { toolsets: Awaited<ReturnType<typeof listMcpToolsetsSafe>>; ageMs: number } | null {
    if (!cachedDynamicToolsets || cachedDynamicToolsetsAt === null) {
        return null;
    }
    return {
        toolsets: cachedDynamicToolsets,
        ageMs: Math.max(0, nowMs - cachedDynamicToolsetsAt),
    };
}

function updateCachedDynamicToolsets(
    toolsets: Awaited<ReturnType<typeof listMcpToolsetsSafe>>,
    nowMs: number,
): void {
    cachedDynamicToolsets = toolsets;
    cachedDynamicToolsetsAt = nowMs;
}

export async function resolveDynamicToolsetsWithTimeout(
    isChatTurn: boolean,
    deps?: DynamicToolsetResolutionDependencies,
): Promise<DynamicToolsetResolution> {
    const now = deps?.now ?? Date.now;
    const isMcpEnabledFn = deps?.isMcpEnabledFn ?? isMcpEnabled;
    const listMcpToolsetsFn = deps?.listMcpToolsetsFn ?? listMcpToolsetsSafe;
    if (!isMcpEnabledFn()) {
        return {
            toolsets: {},
            loadStatus: 'disabled',
            timeoutMs: 0,
            elapsedMs: 0,
            servedFromCache: false,
            cacheAgeMs: null,
        };
    }
    const timeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS', 5_000)
        : resolvePositiveIntFromEnv('COWORKANY_MCP_TOOLSETS_TIMEOUT_MS', 8_000);
    const startedAt = Date.now();
    const timeoutResult: DynamicToolsetResolution = {
        toolsets: {},
        loadStatus: 'timeout',
        timeoutMs,
        elapsedMs: 0,
        servedFromCache: false,
        cacheAgeMs: null,
    };
    try {
        const toolsetLoadPromise = listMcpToolsetsFn()
            .then((toolsets) => {
                updateCachedDynamicToolsets(toolsets, now());
                return toolsets;
            });
        return await Promise.race([
            toolsetLoadPromise.then((toolsets) => ({
                toolsets,
                loadStatus: 'ready' as const,
                timeoutMs,
                elapsedMs: Math.max(0, now() - startedAt),
                servedFromCache: false,
                cacheAgeMs: null,
            })),
            new Promise<DynamicToolsetResolution>((resolve) => {
                setTimeout(() => resolve({
                    ...timeoutResult,
                    elapsedMs: Math.max(0, now() - startedAt),
                }), timeoutMs);
            }),
        ]).then((resolved) => {
            if (resolved.loadStatus === 'timeout') {
                void toolsetLoadPromise.catch((error) => {
                    console.warn('[streaming] Deferred MCP toolset refresh failed after timeout:', error);
                });
                const cachedFallback = getCachedDynamicToolsetFallback(now());
                if (cachedFallback) {
                    return {
                        ...resolved,
                        toolsets: cachedFallback.toolsets,
                        servedFromCache: true,
                        cacheAgeMs: cachedFallback.ageMs,
                    };
                }
            }
            return resolved;
        });
    } catch (error) {
        console.warn('[streaming] MCP toolset preload failed; continuing without MCP toolsets:', error);
        const cachedFallback = getCachedDynamicToolsetFallback(now());
        if (cachedFallback) {
            return {
                toolsets: cachedFallback.toolsets,
                loadStatus: 'error',
                timeoutMs,
                elapsedMs: Math.max(0, now() - startedAt),
                servedFromCache: true,
                cacheAgeMs: cachedFallback.ageMs,
            };
        }
        return {
            toolsets: {},
            loadStatus: 'error',
            timeoutMs,
            elapsedMs: Math.max(0, now() - startedAt),
            servedFromCache: false,
            cacheAgeMs: null,
        };
    }
}

export async function warmupChatRuntime(): Promise<{
    mcpServerCount: number;
    mcpToolCount: number;
    durationMs: number;
    mcpLoadStatus?: 'disabled' | 'ready' | 'timeout' | 'error';
}> {
    const startedAt = Date.now();
    const resolved = await resolveDynamicToolsetsWithTimeout(true);
    const toolsets = resolved.toolsets;
    const mcpServerCount = Object.keys(toolsets).length;
    const mcpToolCount = countDynamicTools(toolsets);
    return {
        mcpServerCount,
        mcpToolCount,
        durationMs: Math.max(0, Date.now() - startedAt),
        mcpLoadStatus: resolved.loadStatus,
    };
}

async function withStartRetries<T>(
    factory: () => Promise<T>,
    options?: {
        retryCount?: number;
        retryDelayMs?: number;
        startTimeoutMs?: number;
        onRetry?: (input: {
            attempt: number;
            maxAttempts: number;
            error: unknown;
            retryAfterMs: number;
            startedAt: number;
            streamReadyAt: number | null;
        }) => void;
        deadlineAt?: number;
    },
): Promise<T> {
    let lastError: unknown;
    const retryCount = Number.isFinite(options?.retryCount)
        ? Math.max(0, Math.floor(options?.retryCount ?? 0))
        : (
            Number.isFinite(STREAM_START_RETRY_COUNT) && STREAM_START_RETRY_COUNT > 0
                ? STREAM_START_RETRY_COUNT
                : 0
        );
    const retryDelayMs = Number.isFinite(options?.retryDelayMs)
        ? Math.max(0, Math.floor(options?.retryDelayMs ?? 0))
        : STREAM_START_RETRY_DELAY_MS;
    const maxAttempts = retryCount + 1;
    const startTimeoutMs = Number.isFinite(options?.startTimeoutMs)
        ? Math.max(1_000, Math.floor(options?.startTimeoutMs ?? 45_000))
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_START_TIMEOUT_MS', 45_000);
    const deadlineAt = options?.deadlineAt;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const remainingBudgetMs = resolveRemainingBudgetMs(deadlineAt);
        if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
            throw new Error('chat_turn_timeout_budget_exhausted');
        }
        const effectiveStartTimeoutMs = remainingBudgetMs !== null
            ? Math.max(1_000, Math.min(startTimeoutMs, remainingBudgetMs))
            : startTimeoutMs;
        const startedAt = Date.now();
        let streamReadyAt: number | null = null;
        try {
            const result = await (async () => {
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                try {
                    return await Promise.race<T>([
                        factory(),
                        new Promise<T>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new Error(`stream_start_timeout:${effectiveStartTimeoutMs}`));
                            }, effectiveStartTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();
            streamReadyAt = Date.now();
            return result;
        } catch (error) {
            lastError = error;
            if (attempt >= retryCount || !isTransientStartError(error)) {
                throw error;
            }
            options?.onRetry?.({
                attempt: attempt + 2,
                maxAttempts,
                error,
                retryAfterMs: retryDelayMs,
                startedAt,
                streamReadyAt,
            });
            const budgetBeforeRetryMs = resolveRemainingBudgetMs(deadlineAt);
            if (budgetBeforeRetryMs !== null && budgetBeforeRetryMs <= retryDelayMs) {
                throw new Error('chat_turn_timeout_budget_exhausted');
            }
            await delay(retryDelayMs);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function forwardStream(
    stream: MastraModelOutput<unknown>,
    sendToDesktop: SendToDesktop,
    options?: {
        forcePostAssistantCompletion?: boolean;
        chatTurn?: boolean;
        routeMode?: 'chat' | 'task';
        streamAttemptStartedAt?: number;
        streamReadyAt?: number | null;
        turnId?: string;
        onRateLimited?: (input: RateLimitedEmitInput) => void;
        deadlineAt?: number;
    },
): Promise<{ assistantText: string; finishReason?: string; timings: StreamTimingSnapshot }> {
    const runId = stream.runId;
    const debugStreamRecovery = process.env.COWORKANY_DEBUG_STREAM_RECOVERY === '1';
    let hasAssistantTextDelta = false;
    let assistantText = '';
    const iterator = stream.fullStream[Symbol.asyncIterator]();
    const iteratorReturnTimeoutMs = resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_RETURN_TIMEOUT_MS', 1_500, {
        min: 100,
        max: 10_000,
    });
    const closeIteratorSafely = async (): Promise<void> => {
        if (typeof iterator.return !== 'function') {
            return;
        }
        await Promise.race<void>([
            Promise.resolve(iterator.return.call(iterator)).then(() => undefined),
            new Promise<void>((resolve) => {
                setTimeout(resolve, iteratorReturnTimeoutMs);
            }),
        ]).catch(() => undefined);
    };
    const isChatTurn = options?.chatTurn === true;
    const isTaskTurn = options?.routeMode === 'task';
    const idleTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_IDLE_TIMEOUT_MS', 25_000, {
            min: 1,
            max: 90_000,
        })
        : (
            isTaskTurn
                ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS', 30_000, {
                    min: 1,
                    max: 120_000,
                })
                : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS', 60_000, {
                    min: 1,
                    max: 90_000,
                })
        );
    const progressTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_PROGRESS_TIMEOUT_MS', 20_000, {
            min: 1,
            max: 90_000,
        })
        : (
            isTaskTurn
                ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_STREAM_PROGRESS_TIMEOUT_MS', 20_000, {
                    min: 1,
                    max: 120_000,
                })
                : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_PROGRESS_TIMEOUT_MS', 45_000, {
                    min: 1,
                    max: 90_000,
                })
        );
    const postAssistantIdleCompleteMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS', 12_000, {
            min: 1,
            max: 120_000,
        })
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_POST_ASSISTANT_IDLE_COMPLETE_MS', 35_000, {
            min: 1,
            max: 120_000,
        });
    const postAssistantMaxCompleteMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS', 20_000, {
            min: 1,
            max: 180_000,
        })
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_POST_ASSISTANT_MAX_MS', 45_000, {
            min: 1,
            max: 180_000,
        });
    const postAssistantHardMaxCompleteMs = options?.forcePostAssistantCompletion === true
        ? (
            isChatTurn
                ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_HARD_MAX_MS', 35_000, {
                    min: 1,
                    max: 180_000,
                })
                : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_POST_ASSISTANT_HARD_MAX_MS', 90_000, {
                    min: 1,
                    max: 210_000,
                })
        )
        : 0;
    const maxDurationMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS', 180_000, {
            min: 1,
            max: 240_000,
        })
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_MAX_DURATION_MS', 180_000, {
            min: 1,
            max: 240_000,
        });
    const absoluteStreamTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_ABSOLUTE_TIMEOUT_MS', 220_000, {
            min: 1,
            max: 300_000,
        })
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_ABSOLUTE_TIMEOUT_MS', 180_000, {
            min: 1,
            max: 300_000,
        });
    if (process.env.COWORKANY_LOG_STREAM_TIMEOUT_CONFIG === '1') {
        console.info('[coworkany-stream-timeout-config]', JSON.stringify({
            runId,
            turnId: options?.turnId ?? null,
            isChatTurn,
            idleTimeoutMs,
            progressTimeoutMs,
            postAssistantIdleCompleteMs,
            postAssistantMaxCompleteMs,
            postAssistantHardMaxCompleteMs,
            maxDurationMs,
            absoluteStreamTimeoutMs,
        }));
    }
    const streamStartedAt = Date.now();
    let lastProgressAt = Date.now();
    let lastVisibleProgressAt = lastProgressAt;
    let ignoredChunkCount = 0;
    let sawTerminalEvent = false;
    let sawCompleteEvent = false;
    let terminalFinishReason: string | undefined;
    let suppressedNoNarrativeErrorMessage: string | null = null;
    let firstAssistantTextAt: number | null = null;
    let lastAssistantTextAt: number | null = null;
    let lastAssistantNarrativeProgressChunk: string | null = null;
    let sawToolingAfterAssistantText = false;
    let sawThinkingAfterAssistantText = false;
    let sawManualApprovalBeforeNarrative = false;
    const streamAttemptStartedAt = typeof options?.streamAttemptStartedAt === 'number'
        ? options.streamAttemptStartedAt
        : streamStartedAt;
    const streamReadyAt = typeof options?.streamReadyAt === 'number'
        ? options.streamReadyAt
        : null;
    const tailRetryCount = isChatTurn
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT', 2)
        : resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_STREAM_TAIL_RETRY_COUNT', 0);
    const tailRetryDelayMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS', 1_200)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_TAIL_RETRY_DELAY_MS', 800);
    let tailRetryAttempt = 0;
    const deadlineRefreshWindowMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS', 180_000)
        : 0;
    const chatDeltaFlushIntervalMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_DELTA_FLUSH_INTERVAL_MS', 80)
        : 0;
    const chatDeltaFlushChars = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_DELTA_FLUSH_CHARS', 48)
        : 0;
    let bufferedAssistantDelta = '';
    let bufferedAssistantDeltaStartedAt = 0;
    const flushBufferedAssistantDelta = (force: boolean): void => {
        if (bufferedAssistantDelta.length === 0) {
            return;
        }
        if (!force && isChatTurn) {
            const ageMs = Date.now() - bufferedAssistantDeltaStartedAt;
            if (bufferedAssistantDelta.length < chatDeltaFlushChars && ageMs < chatDeltaFlushIntervalMs) {
                return;
            }
        }
        sendToDesktop({
            type: 'text_delta',
            content: bufferedAssistantDelta,
            role: 'assistant',
            runId,
            turnId: options?.turnId,
        });
        bufferedAssistantDelta = '';
        bufferedAssistantDeltaStartedAt = 0;
    };
    const queueAssistantDelta = (content: string): void => {
        if (content.length === 0) {
            return;
        }
        if (bufferedAssistantDelta.length === 0) {
            bufferedAssistantDeltaStartedAt = Date.now();
        }
        bufferedAssistantDelta += content;
        flushBufferedAssistantDelta(false);
    };
    let deadlineAt = options?.deadlineAt;
    const shouldRefreshDeadlineOnProgress = isChatTurn
        && typeof deadlineAt === 'number'
        && Number.isFinite(deadlineAt);
    const markVisibleProgress = (at?: number): void => {
        const timestamp = typeof at === 'number' && Number.isFinite(at) ? at : Date.now();
        lastVisibleProgressAt = timestamp;
        sawThinkingAfterAssistantText = false;
    };

    while (true) {
        flushBufferedAssistantDelta(false);
        if (Date.now() - streamStartedAt >= absoluteStreamTimeoutMs) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            if (hasAssistantTextDelta && !sawTerminalEvent && !sawToolingAfterAssistantText) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_absolute_timeout_after_text',
                });
                sawCompleteEvent = true;
                terminalFinishReason = 'stream_absolute_timeout_after_text';
                break;
            }
            throw new Error(`stream_absolute_timeout:${absoluteStreamTimeoutMs}`);
        }
        const remainingBudgetMs = resolveRemainingBudgetMs(deadlineAt);
        if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
            flushBufferedAssistantDelta(true);
            if (hasAssistantTextDelta && !sawTerminalEvent) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'assistant_text_turn_timeout_budget',
                });
                sawCompleteEvent = true;
                terminalFinishReason = 'assistant_text_turn_timeout_budget';
                break;
            }
            throw new Error('chat_turn_timeout_budget_exhausted');
        }
        if (
            firstAssistantTextAt !== null
            && postAssistantHardMaxCompleteMs > 0
            && Date.now() - firstAssistantTextAt >= postAssistantHardMaxCompleteMs
            && !sawTerminalEvent
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            sawTerminalEvent = true;
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'assistant_text_hard_max_window',
            });
            sawCompleteEvent = true;
            terminalFinishReason = 'assistant_text_hard_max_window';
            break;
        }
        if (
            isChatTurn
            && options?.forcePostAssistantCompletion === true
            && firstAssistantTextAt !== null
            && sawThinkingAfterAssistantText
            && Date.now() - lastVisibleProgressAt >= postAssistantIdleCompleteMs
            && !sawTerminalEvent
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            sawTerminalEvent = true;
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'assistant_text_settled_idle_window',
            });
            sawCompleteEvent = true;
            terminalFinishReason = 'assistant_text_settled_idle_window';
            break;
        }
        if (
            firstAssistantTextAt !== null
            && (options?.forcePostAssistantCompletion === true || !sawToolingAfterAssistantText)
            && Date.now() - lastVisibleProgressAt >= postAssistantMaxCompleteMs
            && !sawTerminalEvent
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            sawTerminalEvent = true;
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'assistant_text_settled_max_window',
            });
            sawCompleteEvent = true;
            terminalFinishReason = 'assistant_text_settled_max_window';
            break;
        }

        const effectiveMaxDurationMs = remainingBudgetMs !== null
            ? Math.min(maxDurationMs, remainingBudgetMs)
            : maxDurationMs;
        const maxDurationAnchorAt = hasAssistantTextDelta ? lastVisibleProgressAt : streamStartedAt;
        if (Date.now() - maxDurationAnchorAt >= effectiveMaxDurationMs) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            if (hasAssistantTextDelta && !sawTerminalEvent) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_max_duration_after_text',
                });
                terminalFinishReason = 'stream_max_duration_after_text';
                break;
            }
            throw new Error(`stream_max_duration_timeout:${maxDurationMs}`);
        }

        let result: IteratorResult<unknown>;
        try {
            result = await (async () => {
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const boundedIdleTimeoutMs = (hasAssistantTextDelta && !sawToolingAfterAssistantText)
                    ? Math.min(idleTimeoutMs, postAssistantIdleCompleteMs)
                    : idleTimeoutMs;
                const effectiveIdleTimeoutMs = remainingBudgetMs !== null
                    ? Math.max(1_000, Math.min(boundedIdleTimeoutMs, remainingBudgetMs))
                    : boundedIdleTimeoutMs;
                try {
                    return await Promise.race<IteratorResult<unknown>>([
                        iterator.next(),
                        new Promise<IteratorResult<unknown>>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new Error(`stream_idle_timeout:${effectiveIdleTimeoutMs}`));
                            }, effectiveIdleTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();
        } catch (error) {
            if (hasAssistantTextDelta && isStoreDisabledHistoryReferenceError(error)) {
                await closeIteratorSafely();
                flushBufferedAssistantDelta(true);
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'assistant_text_store_disabled_history_recovered',
                });
                sawCompleteEvent = true;
                terminalFinishReason = 'assistant_text_store_disabled_history_recovered';
                break;
            }
            if (!hasAssistantTextDelta && sawManualApprovalBeforeNarrative && isRetryableForwardError(error)) {
                await closeIteratorSafely();
                flushBufferedAssistantDelta(true);
                sawTerminalEvent = true;
                sawCompleteEvent = true;
                terminalFinishReason = 'stream_exhausted';
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_exhausted',
                });
                break;
            }
            const canTailRetry = hasAssistantTextDelta
                && isRetryableForwardError(error)
                && tailRetryAttempt < tailRetryCount;
            if (canTailRetry) {
                tailRetryAttempt += 1;
                options?.onRateLimited?.({
                    runId,
                    attempt: tailRetryAttempt + 1,
                    maxAttempts: tailRetryCount + 1,
                    retryAfterMs: tailRetryDelayMs,
                    error,
                    stage: resolveTimeoutStageFromError(error, {
                        hasAssistantText: true,
                        streamReady: streamReadyAt !== null,
                    }),
                    timings: buildTimingSnapshot({
                        startedAt: streamAttemptStartedAt,
                        streamReadyAt,
                        firstTokenAt: firstAssistantTextAt,
                        lastTokenAt: lastAssistantTextAt,
                    }),
                    turnId: options?.turnId,
                    message: `Response tail stalled. Retrying stream tail (${tailRetryAttempt}/${tailRetryCount})...`,
                });
                await delay(tailRetryDelayMs * tailRetryAttempt);
                continue;
            }
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            const shouldBypassAssistantTextDegradedComplete = (
                sawToolingAfterAssistantText
                || isWorkflowSnapshotMissingError(error)
                || isMissingTerminalAfterToolingProgressError(error)
            );
            if (
                hasAssistantTextDelta
                && !sawTerminalEvent
                && isRetryableForwardError(error)
                && !shouldBypassAssistantTextDegradedComplete
            ) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: /\bstream_(?:idle|progress)_timeout\b/i.test(String(error))
                        ? 'assistant_text_idle'
                        : 'assistant_text_stream_interrupted',
                });
                sawCompleteEvent = true;
                terminalFinishReason = /\bstream_(?:idle|progress)_timeout\b/i.test(String(error))
                    ? 'assistant_text_idle'
                    : 'assistant_text_stream_interrupted';
                break;
            }
            throw error;
        }

        if (result.done) {
            flushBufferedAssistantDelta(true);
            break;
        }
        const chunk = result.value;
        let hasProgress = false;
        let shouldRefreshDeadlineFromChunk = false;
        const tokenUsageEvent = extractMastraTokenUsageEvent(chunk as MastraChunkLike, runId);
        if (tokenUsageEvent) {
            sendToDesktop(tokenUsageEvent);
            hasProgress = true;
        }
        if (!hasAssistantTextDelta) {
            const finalTextEvent = extractMastraFinalAssistantTextEvent(chunk as MastraChunkLike, runId);
            if (finalTextEvent && finalTextEvent.type === 'text_delta' && finalTextEvent.content) {
                const hasNarrativeContent = finalTextEvent.content.trim().length > 0;
                if (hasNarrativeContent) {
                    hasAssistantTextDelta = true;
                }
                const now = Date.now();
                if (hasNarrativeContent && firstAssistantTextAt === null) {
                    firstAssistantTextAt = now;
                }
                if (hasNarrativeContent) {
                    lastAssistantTextAt = now;
                }
                if (finalTextEvent.role !== 'thinking') {
                    assistantText += finalTextEvent.content;
                    if (hasNarrativeContent) {
                        markVisibleProgress(now);
                        shouldRefreshDeadlineFromChunk = true;
                    }
                }
                if (finalTextEvent.role === 'assistant') {
                    queueAssistantDelta(finalTextEvent.content);
                } else {
                    flushBufferedAssistantDelta(true);
                    sendToDesktop(finalTextEvent);
                }
                hasProgress = true;
            }
        }
        const event = mapMastraChunkToDesktopEvent(chunk as MastraChunkLike, runId);
        if (event) {
            let eventCountsAsVisibleProgress = false;
            let eventCountsAsOperationalProgress = false;
            const assistantNarrativeDelta = (
                event.type === 'text_delta'
                && event.role !== 'thinking'
                && typeof event.content === 'string'
                && event.content.trim().length > 0
            );
            const normalizedAssistantNarrativeDelta = assistantNarrativeDelta
                ? event.content.trim()
                : '';
            const duplicateAssistantNarrativeDelta = assistantNarrativeDelta
                && normalizedAssistantNarrativeDelta === lastAssistantNarrativeProgressChunk;
            if (
                assistantNarrativeDelta
                && !duplicateAssistantNarrativeDelta
            ) {
                hasAssistantTextDelta = true;
                const now = Date.now();
                if (firstAssistantTextAt === null) {
                    firstAssistantTextAt = now;
                }
                lastAssistantTextAt = now;
                assistantText += event.content;
                markVisibleProgress(now);
                eventCountsAsVisibleProgress = true;
                lastAssistantNarrativeProgressChunk = normalizedAssistantNarrativeDelta;
            } else if (event.type === 'text_delta' && event.role === 'thinking' && hasAssistantTextDelta) {
                sawThinkingAfterAssistantText = true;
                if (typeof event.content === 'string' && event.content.trim().length > 0) {
                    eventCountsAsOperationalProgress = true;
                }
            }
            if (
                hasAssistantTextDelta
                && (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'suspended')
            ) {
                sawToolingAfterAssistantText = true;
                markVisibleProgress();
                eventCountsAsVisibleProgress = true;
            }
            if (
                !hasAssistantTextDelta
                && event.type === 'approval_required'
                && shouldTreatApprovalAsManualForNoNarrativeExemption(event)
            ) {
                sawManualApprovalBeforeNarrative = true;
            }
            if (event.type === 'error' && hasAssistantTextDelta && isStoreDisabledHistoryReferenceError(event.message)) {
                flushBufferedAssistantDelta(true);
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'assistant_text_store_disabled_history_recovered',
                });
                await closeIteratorSafely();
                break;
            }
            const suppressNoNarrativeComplete = (
                event.type === 'complete'
                && !hasAssistantTextDelta
                && !sawManualApprovalBeforeNarrative
            );
            const suppressNoNarrativeError = (
                event.type === 'error'
                && !hasAssistantTextDelta
                && !sawManualApprovalBeforeNarrative
                && isNoAssistantNarrativeCompletionError(event.message)
            );
            if (debugStreamRecovery && event.type === 'error') {
                console.warn('[streaming][terminal-error-event]', {
                    runId,
                    message: event.message,
                    hasAssistantTextDelta,
                    sawManualApprovalBeforeNarrative,
                    suppressNoNarrativeError,
                });
            }
            if (event.type === 'complete' || event.type === 'error' || event.type === 'tripwire') {
                sawTerminalEvent = true;
            }
            if (event.type === 'complete') {
                sawCompleteEvent = true;
                terminalFinishReason = event.finishReason;
                eventCountsAsVisibleProgress = true;
            } else if (event.type === 'error') {
                terminalFinishReason = 'error';
                if (suppressNoNarrativeError) {
                    suppressedNoNarrativeErrorMessage = event.message;
                }
                eventCountsAsVisibleProgress = true;
            } else if (event.type === 'tripwire') {
                terminalFinishReason = 'tripwire';
                eventCountsAsVisibleProgress = true;
            }
            if (!suppressNoNarrativeComplete && !suppressNoNarrativeError) {
                if (event.type === 'text_delta' && event.role === 'assistant') {
                    queueAssistantDelta(event.content);
                } else {
                    flushBufferedAssistantDelta(true);
                    sendToDesktop(event);
                }
                eventCountsAsOperationalProgress = eventCountsAsOperationalProgress
                    || event.type === 'complete'
                    || event.type === 'error'
                    || event.type === 'tripwire'
                    || event.type === 'tool_call'
                    || event.type === 'tool_result'
                    || event.type === 'approval_required'
                    || event.type === 'suspended'
                    || (event.type === 'text_delta' && event.role !== 'thinking' && !duplicateAssistantNarrativeDelta && typeof event.content === 'string' && event.content.trim().length > 0)
                    || (event.type === 'text_delta' && event.role === 'thinking' && typeof event.content === 'string' && event.content.trim().length > 0);
                if (eventCountsAsOperationalProgress) {
                    hasProgress = true;
                }
            }
            if (eventCountsAsVisibleProgress) {
                shouldRefreshDeadlineFromChunk = true;
            }
            if (event.type === 'complete' || event.type === 'error' || event.type === 'tripwire') {
                break;
            }
        }

        if (!hasProgress && isMastraOperationalProgressChunk(chunk as MastraChunkLike)) {
            hasProgress = true;
        }

        if (hasProgress) {
            lastProgressAt = Date.now();
            ignoredChunkCount = 0;
            if (shouldRefreshDeadlineOnProgress && shouldRefreshDeadlineFromChunk) {
                deadlineAt = lastProgressAt + deadlineRefreshWindowMs;
            }
        } else {
            ignoredChunkCount += 1;
            if (Date.now() - lastProgressAt >= progressTimeoutMs) {
                await closeIteratorSafely();
                throw new Error(`stream_progress_timeout:${progressTimeoutMs};ignored_chunks:${ignoredChunkCount}`);
            }
        }
    }
    flushBufferedAssistantDelta(true);
    if (!sawTerminalEvent) {
        if (!hasAssistantTextDelta) {
            if (sawManualApprovalBeforeNarrative) {
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_exhausted',
                });
                sawCompleteEvent = true;
                terminalFinishReason = 'stream_exhausted';
            } else {
                throw new Error('stream_exhausted_without_assistant_text');
            }
        } else {
            if (sawToolingAfterAssistantText) {
                // If tooling started after assistant narrative, the turn must not silently
                // degrade into stream_exhausted. Surface a terminal error so upper layers
                // can retry/fail explicitly instead of reporting a false success.
                throw new Error('missing_terminal_after_tooling_progress');
            }
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'stream_exhausted',
            });
            sawCompleteEvent = true;
            terminalFinishReason = 'stream_exhausted';
        }
    }
    if (suppressedNoNarrativeErrorMessage && !hasAssistantTextDelta && !sawManualApprovalBeforeNarrative) {
        throw new Error(suppressedNoNarrativeErrorMessage);
    }
    if (sawCompleteEvent && !hasAssistantTextDelta && !sawManualApprovalBeforeNarrative) {
        throw new Error(`complete_without_assistant_text:${terminalFinishReason ?? 'unknown'}`);
    }
    return {
        assistantText: assistantText.trim(),
        finishReason: terminalFinishReason,
        timings: buildTimingSnapshot({
            startedAt: streamAttemptStartedAt,
            streamReadyAt,
            firstTokenAt: firstAssistantTextAt,
            lastTokenAt: lastAssistantTextAt,
        }),
    };
}

function cacheRunContext(runId: string, context: RunContext): void {
    runContextById.set(runId, context);
    if (runContextById.size <= MAX_CACHED_RUN_CONTEXTS) {
        return;
    }
    const oldestRunId = runContextById.keys().next().value;
    if (typeof oldestRunId === 'string') {
        runContextById.delete(oldestRunId);
    }
}

function sendWithRunContextCleanup(runId: string, sendToDesktop: SendToDesktop): SendToDesktop {
    return (event) => {
        const runContext = runContextById.get(runId);
        const withContext = runContext && event.runId === runId
            ? {
                ...event,
                traceId: event.traceId ?? runContext.traceId,
                turnId: event.turnId ?? runContext.turnId,
            }
            : event;
        sendToDesktop(withContext);
        if (event.runId === runId && (event.type === 'error' || event.type === 'tripwire')) {
            runContextById.delete(runId);
        }
    };
}

export async function handleUserMessage(
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: SendToDesktop,
    options?: {
        taskId?: string;
        turnId?: string;
        workspacePath?: string;
        enabledSkills?: string[];
        skillPrompt?: string;
        forcedRouteMode?: 'chat' | 'task';
        useDirectChatResponder?: boolean;
        forcePostAssistantCompletion?: boolean;
        requireToolApproval?: boolean;
        autoResumeSuspendedTools?: boolean;
        toolCallConcurrency?: number;
        maxSteps?: number;
        requiredCompletionCapabilities?: string[];
        turnContractDomain?: string;
        chatTurnDeadlineAtMs?: number;
        chatStartupDeadlineAtMs?: number;
        onPreCompact?: (payload: CompactHookPayload) => void;
        onPostCompact?: (payload: CompactHookPayload) => void;
    },
): Promise<{ runId: string }> {
    const proxySnapshotBeforeDisable = getProxyRuntimeSnapshot();
    disableProxyEnvForLlmPath();
    const proxySnapshotAfterDisable = getProxyRuntimeSnapshot();
    const taskId = options?.taskId ?? threadId;
    contextCompressionStore.recordUserTurn({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
        content: message,
        turnId: options?.turnId,
    });
    const promptPack = contextCompressionStore.buildPromptPack(taskId);
    const recalledTopicMemories: RecalledTopicMemory[] = promptPack?.recalledTopicMemories ?? [];
    if (promptPack) {
        options?.onPreCompact?.({
            taskId,
            threadId,
            resourceId,
            workspacePath: options?.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
        });
    }
    const effectiveMessage = buildSkillGuidedMessage(message, options?.skillPrompt);

    const modelId = process.env.COWORKANY_MODEL || DEFAULT_MODEL_ID;
    const modelProvider = modelId.split('/')[0]?.toLowerCase() ?? '';
    const openAiResponseStoreEnabled = resolveBooleanFromEnv(
        'COWORKANY_OPENAI_RESPONSES_STORE',
        true,
    );
    const providerOptions = modelProvider === 'openai'
        ? {
            openai: {
                store: openAiResponseStoreEnabled,
            },
        }
        : undefined;
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        if (promptPack) {
            options?.onPostCompact?.({
                taskId,
                threadId,
                resourceId,
                workspacePath: options?.workspacePath,
                microSummary: promptPack.microSummary,
                structuredSummary: promptPack.structuredSummary,
                recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
            });
        }
        const runId = `preflight-${randomUUID()}`;
        sendToDesktop({
            type: 'error',
            runId,
            message: `missing_api_key:${missingApiKey}`,
        });
        return { runId };
    }

    const forcePostAssistantCompletion = options?.forcePostAssistantCompletion === true;
    const useChatLatencyProfile = forcePostAssistantCompletion && options?.forcedRouteMode !== 'task';
    const isTaskRoute = options?.forcedRouteMode === 'task';
    let useDirectChatResponder = !isTaskRoute && (
        options?.useDirectChatResponder === true
        || options?.forcedRouteMode === 'chat'
    );
    const weatherQuery = isWeatherInformationQuery(effectiveMessage);
    const dynamicToolsetResolution = (useDirectChatResponder && !weatherQuery)
        ? {
            toolsets: {},
            loadStatus: 'disabled' as const,
            timeoutMs: 0,
            elapsedMs: 0,
            servedFromCache: false,
            cacheAgeMs: null,
        }
        : await resolveDynamicToolsetsWithTimeout(useChatLatencyProfile);
    let dynamicToolsets = dynamicToolsetResolution.toolsets;
    const dynamicToolCount = countDynamicTools(dynamicToolsets);
    console.info('[coworkany-mcp-toolset-resolution]', JSON.stringify({
        taskId,
        routeMode: options?.forcedRouteMode ?? null,
        useChatLatencyProfile,
        loadStatus: dynamicToolsetResolution.loadStatus,
        servedFromCache: dynamicToolsetResolution.servedFromCache,
        cacheAgeMs: dynamicToolsetResolution.cacheAgeMs,
        timeoutMs: dynamicToolsetResolution.timeoutMs,
        elapsedMs: dynamicToolsetResolution.elapsedMs,
        mcpToolCount: dynamicToolCount,
    }));
    if (!useDirectChatResponder && dynamicToolCount === 0 && isMcpEnabled()) {
        console.warn('[coworkany-runtime-gap] runtime route has zero MCP tools after resolution.', {
            taskId,
            routeMode: options?.forcedRouteMode ?? null,
            mcpLoadStatus: dynamicToolsetResolution.loadStatus,
            servedFromCache: dynamicToolsetResolution.servedFromCache,
            cacheAgeMs: dynamicToolsetResolution.cacheAgeMs,
        });
    }
    if (useDirectChatResponder && weatherQuery && hasWeatherInformationTool(dynamicToolsets)) {
        useDirectChatResponder = false;
    }
    const requiredCompletionCapabilities = deriveRequiredCompletionCapabilitiesForTurn({
        message: effectiveMessage,
        workspacePath: options?.workspacePath,
        explicitRequiredCapabilities: options?.requiredCompletionCapabilities,
    });
    const turnContractDomain = (options?.turnContractDomain ?? '').trim().toLowerCase();
    const preferResearcherForWebResearchTasks = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TASK_PREFER_RESEARCHER',
        true,
    );
    const shouldRouteTaskToResearcher = shouldRouteTaskTurnToResearcher({
        isTaskRoute,
        useDirectChatResponder,
        preferResearcherForWebResearchTasks,
        requiredCompletionCapabilities,
    });
    const streamAgent = useDirectChatResponder
        ? chatResponder
        : (shouldRouteTaskToResearcher ? researcher : supervisor);
    console.info('[coworkany-task-route-agent]', JSON.stringify({
        taskId,
        routeMode: options?.forcedRouteMode ?? null,
        selectedAgent: useDirectChatResponder
            ? 'chatResponder'
            : (shouldRouteTaskToResearcher ? 'researcher' : 'supervisor'),
        requiredCompletionCapabilities,
        turnContractDomain: turnContractDomain || null,
    }));
    const enableGenerateFallbackForTaskRoute = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK',
        false,
    );
    const allowGenerateFallback = !isTaskRoute || enableGenerateFallbackForTaskRoute;
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
        enabledSkills: options?.enabledSkills,
        skillPrompt: options?.skillPrompt,
    });
    const telemetry = createTelemetryRunContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
    });
    if (useDirectChatResponder) {
        dynamicToolsets = {};
    }
    // `forcePostAssistantCompletion` is used by direct/task routes.
    // A single step can end right after the first tool call, producing no assistant narrative.
    // Keep this path bounded, but allow at least one tool step plus a final answer step.
    const defaultForcePostMaxSteps = useChatLatencyProfile ? 3 : 12;
    const defaultMaxSteps = forcePostAssistantCompletion
        ? resolvePositiveIntFromEnv(
            useChatLatencyProfile
                ? 'COWORKANY_MASTRA_CHAT_FORCE_POST_MAX_STEPS'
                : 'COWORKANY_MASTRA_FORCE_POST_MAX_STEPS',
            defaultForcePostMaxSteps,
        )
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_DEFAULT_MAX_STEPS', 16);
    const defaultRequireToolApproval = (
        forcePostAssistantCompletion
        || shouldRouteTaskToResearcher
    )
        ? false
        : true;
    // Keep tool approval resume on the entrypoint side for deterministic ordering.
    // Mastra-side auto resume can race with terminal stream events and produce stale snapshot errors.
    const defaultAutoResumeSuspendedTools = false;
    const streamToolsets = Object.keys(dynamicToolsets).length > 0
        ? dynamicToolsets
        : undefined;
    const streamOptions = {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        toolsets: streamToolsets,
        requireToolApproval: options?.requireToolApproval ?? defaultRequireToolApproval,
        autoResumeSuspendedTools: options?.autoResumeSuspendedTools ?? defaultAutoResumeSuspendedTools,
        toolCallConcurrency: options?.toolCallConcurrency ?? 1,
        maxSteps: options?.maxSteps ?? defaultMaxSteps,
        providerOptions,
    };

    const useTaskLatencyProfile = options?.forcedRouteMode === 'task';
    const nowForExecutionDeadlines = Date.now();
    const externalChatTurnDeadlineAt = toOptionalFiniteNumber(options?.chatTurnDeadlineAtMs);
    const chatTurnTimeoutMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS', 180_000)
        : (
            useTaskLatencyProfile
                ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_TASK_TURN_TIMEOUT_MS', 240_000)
                : 0
        );
    const chatTurnDeadlineAt = externalChatTurnDeadlineAt
        ?? (chatTurnTimeoutMs > 0 ? nowForExecutionDeadlines + chatTurnTimeoutMs : null);
    const externalChatStartupDeadlineAt = toOptionalFiniteNumber(options?.chatStartupDeadlineAtMs);
    const chatStartupBudgetMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS', 90_000)
        : (
            useTaskLatencyProfile
                ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS', 90_000)
                : 0
        );
    const chatStartupDeadlineCandidate = externalChatStartupDeadlineAt
        ?? (chatStartupBudgetMs > 0 ? nowForExecutionDeadlines + chatStartupBudgetMs : null);
    const chatStartupDeadlineAt = chatStartupDeadlineCandidate !== null
        ? Math.min(chatStartupDeadlineCandidate, chatTurnDeadlineAt ?? Number.POSITIVE_INFINITY)
        : chatTurnDeadlineAt;
    const forwardRetryCount = useChatLatencyProfile
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT', 5)
        : (
            Number.isFinite(STREAM_FORWARD_RETRY_COUNT) && STREAM_FORWARD_RETRY_COUNT > 0
                ? STREAM_FORWARD_RETRY_COUNT
                : 0
        );
    const forwardRetryDelayMs = Number.isFinite(STREAM_FORWARD_RETRY_DELAY_MS) && STREAM_FORWARD_RETRY_DELAY_MS > 0
        ? STREAM_FORWARD_RETRY_DELAY_MS
        : 800;
    const noNarrativeRetryCount = useChatLatencyProfile
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_NO_NARRATIVE_RETRY_COUNT', 1)
        : resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT', 5);
    const debugStreamRecovery = process.env.COWORKANY_DEBUG_STREAM_RECOVERY === '1';
    const startRetryCount = useChatLatencyProfile
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT', 5)
        : undefined;
    const startRetryDelayMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS', 1_000)
        : undefined;
    const startTimeoutMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS', 12_000)
        : undefined;

    const fallbackToGenerateOnStartTimeout = resolveBooleanFromEnv('COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK', true);
    const generateFallbackTimeoutMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS', 30_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_GENERATE_FALLBACK_TIMEOUT_MS', 45_000);
    const emitRateLimited = (input: RateLimitedEmitInput): void => {
        sendToDesktop({
            type: 'rate_limited',
            runId: input.runId,
            attempt: input.attempt,
            maxAttempts: input.maxAttempts,
            retryAfterMs: input.retryAfterMs,
            error: String(input.error),
            message: input.message,
            stage: input.stage,
            timings: input.timings,
            turnId: input.turnId,
        });
    };
    const flushPostCompactWithPromptPack = (): void => {
        if (!promptPack) {
            return;
        }
        options?.onPostCompact?.({
            taskId,
            threadId,
            resourceId,
            workspacePath: options?.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
        });
    };
    const runGenerateFallback = async (
        reason: string,
        attemptNumber: number,
        maxAttempts: number,
        fallbackOptions?: {
            force?: boolean;
            includeStartupBudget?: boolean;
        },
    ): Promise<{ runId: string } | null> => {
        if (!fallbackToGenerateOnStartTimeout && fallbackOptions?.force !== true) {
            return null;
        }
        emitRateLimited({
            attempt: 1,
            maxAttempts: 1,
            retryAfterMs: 0,
            error: reason,
            message: 'Model stream stalled. Switching to non-streaming fallback...',
            turnId: options?.turnId,
            stage: resolveTimeoutStageFromError(reason, {
                hasAssistantText: false,
                streamReady: false,
            }),
            timings: buildTimingSnapshot({
                startedAt: Date.now(),
                streamReadyAt: null,
                firstTokenAt: null,
                lastTokenAt: null,
            }),
        });
        try {
            const fallbackStartedAt = Date.now();
            const fallbackDeadlineAt = resolveEarliestDeadline([
                chatTurnDeadlineAt ?? undefined,
                fallbackOptions?.includeStartupBudget === false
                    ? undefined
                    : (chatStartupDeadlineAt ?? undefined),
            ]);
            const remainingBudgetMs = resolveRemainingBudgetMs(fallbackDeadlineAt);
            const effectiveGenerateFallbackTimeoutMs = remainingBudgetMs !== null
                ? Math.max(1_000, Math.min(generateFallbackTimeoutMs, remainingBudgetMs))
                : generateFallbackTimeoutMs;
            if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
                throw new Error('chat_startup_timeout_budget_exhausted');
            }
            const generated = await Promise.race([
                streamAgent.generate(effectiveMessage, streamOptions),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`generate_fallback_timeout:${effectiveGenerateFallbackTimeoutMs}`)), effectiveGenerateFallbackTimeoutMs);
                }),
            ]);
            const fallbackRunId = typeof generated.runId === 'string' && generated.runId.length > 0
                ? generated.runId
                : `generate-fallback-${randomUUID()}`;
            cacheRunContext(fallbackRunId, {
                threadId,
                resourceId,
                taskId,
                turnId: options?.turnId,
                workspacePath: options?.workspacePath,
                enabledSkills: options?.enabledSkills,
                skillPrompt: options?.skillPrompt,
                traceId: telemetry.traceId,
                traceSampled: telemetry.sampled,
            });

            if (generated.error) {
                throw generated.error;
            }

            const rawGeneratedText = typeof generated.text === 'string' ? generated.text.trim() : '';
            const generatedText = isInternalCompletionCheckNarrative(rawGeneratedText)
                ? ''
                : rawGeneratedText;
            if (generatedText.length > 0) {
                sendToDesktop({
                    type: 'text_delta',
                    runId: fallbackRunId,
                    role: 'assistant',
                    content: generatedText,
                    turnId: options?.turnId,
                });
                const updated = contextCompressionStore.recordAssistantTurn({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    content: generatedText,
                    turnId: options?.turnId,
                });
                options?.onPostCompact?.({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    microSummary: updated.microSummary,
                    structuredSummary: updated.structuredSummary,
                    recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
                });
            } else {
                flushPostCompactWithPromptPack();
            }
            emitLlmTimingLog({
                taskId,
                threadId,
                turnId: options?.turnId,
                modelId,
                provider: modelProvider,
                phase: 'generate_fallback',
                outcome: 'success',
                attempt: attemptNumber,
                maxAttempts,
                assistantChars: generatedText.length,
                finishReason: generated.finishReason ?? 'fallback_generate',
                timings: buildTimingSnapshot({
                    startedAt: fallbackStartedAt,
                    streamReadyAt: null,
                    firstTokenAt: generatedText.length > 0 ? Date.now() : null,
                    lastTokenAt: generatedText.length > 0 ? Date.now() : null,
                }),
                proxyBefore: proxySnapshotBeforeDisable,
                proxyAfter: proxySnapshotAfterDisable,
            });
            sendToDesktop({
                type: 'complete',
                runId: fallbackRunId,
                finishReason: generated.finishReason ?? 'fallback_generate',
                turnId: options?.turnId,
            });
            return { runId: fallbackRunId };
        } catch (fallbackError) {
            const runId = `start-failed-${randomUUID()}`;
            emitLlmTimingLog({
                taskId,
                threadId,
                turnId: options?.turnId,
                modelId,
                provider: modelProvider,
                phase: 'generate_fallback',
                outcome: 'error',
                attempt: attemptNumber,
                maxAttempts,
                assistantChars: 0,
                error: fallbackError,
                timings: buildTimingSnapshot({
                    startedAt: Date.now(),
                    streamReadyAt: null,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                proxyBefore: proxySnapshotBeforeDisable,
                proxyAfter: proxySnapshotAfterDisable,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: String(fallbackError),
                turnId: options?.turnId,
            });
            return { runId };
        }
    };

    let attempt = 0;
    let startupBudgetClosedByStreamProgress = false;
    while (true) {
        const startupDeadlineAt = startupBudgetClosedByStreamProgress
            ? undefined
            : resolveEarliestDeadline([
                chatTurnDeadlineAt ?? undefined,
                chatStartupDeadlineAt ?? undefined,
            ]);
        if (startupDeadlineAt !== undefined && Date.now() >= startupDeadlineAt) {
            const runId = `start-failed-${randomUUID()}`;
            emitRateLimited({
                runId,
                attempt: 1,
                maxAttempts: 1,
                retryAfterMs: 0,
                error: 'chat_startup_timeout_budget_exhausted',
                message: 'Chat startup exceeded timeout budget before first response.',
                stage: 'ttfb',
                timings: buildTimingSnapshot({
                    startedAt: startupDeadlineAt - chatStartupBudgetMs,
                    streamReadyAt: null,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: 'chat_startup_timeout_budget_exhausted',
                turnId: options?.turnId,
            });
            return { runId };
        }
        if (chatTurnDeadlineAt !== null && Date.now() >= chatTurnDeadlineAt) {
            const runId = `start-failed-${randomUUID()}`;
            emitRateLimited({
                runId,
                attempt: 1,
                maxAttempts: 1,
                retryAfterMs: 0,
                error: 'chat_turn_timeout_budget_exhausted',
                message: 'Chat turn exceeded timeout budget before model response.',
                stage: 'unknown',
                timings: buildTimingSnapshot({
                    startedAt: chatTurnDeadlineAt - chatTurnTimeoutMs,
                    streamReadyAt: null,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: 'chat_turn_timeout_budget_exhausted',
                turnId: options?.turnId,
            });
            return { runId };
        }
        let stream: Awaited<ReturnType<typeof streamAgent.stream>>;
        const attemptStartedAt = Date.now();
        let streamReadyAt: number | null = null;
        const streamOptionsForAttempt = (() => {
            if (!streamToolsets) {
                return streamOptions;
            }
            const preferredToolsets = buildToolsetsForMessageAttempt(
                streamToolsets,
                effectiveMessage,
                attempt,
                {
                    requiredCompletionCapabilities,
                    isTaskRoute,
                    workspacePath: options?.workspacePath,
                },
            );
            if (preferredToolsets === streamToolsets) {
                return streamOptions;
            }
            return {
                ...streamOptions,
                toolsets: preferredToolsets,
            };
        })();
        try {
            stream = await withStartRetries(async () => await streamAgent.stream(effectiveMessage, streamOptionsForAttempt), {
                retryCount: startRetryCount,
                retryDelayMs: startRetryDelayMs,
                startTimeoutMs,
                deadlineAt: startupDeadlineAt,
                onRetry: ({ attempt: retryAttempt, maxAttempts, error, retryAfterMs, startedAt, streamReadyAt: retryStreamReadyAt }) => {
                    emitRateLimited({
                        attempt: retryAttempt,
                        maxAttempts,
                        retryAfterMs,
                        error,
                        message: `Model startup delayed. Retrying (${retryAttempt}/${maxAttempts})...`,
                        stage: resolveTimeoutStageFromError(error, {
                            hasAssistantText: false,
                            streamReady: retryStreamReadyAt !== null,
                        }),
                        timings: buildTimingSnapshot({
                            startedAt,
                            streamReadyAt: retryStreamReadyAt,
                            firstTokenAt: null,
                            lastTokenAt: null,
                        }),
                        turnId: options?.turnId,
                    });
                },
            });
            streamReadyAt = Date.now();
            // Startup budget should only guard "can we establish model response stream".
            // Once the stream is ready, first-token delays are governed by stream idle/progress timeouts.
            startupBudgetClosedByStreamProgress = true;
        } catch (error) {
            const startupNoNarrativeError = isNoAssistantNarrativeCompletionError(error);
            const transientStartError = isTransientStartError(error);
            const shouldAttemptFallback = (
                (fallbackToGenerateOnStartTimeout && transientStartError)
                || startupNoNarrativeError
            ) && allowGenerateFallback;
            if (debugStreamRecovery) {
                console.warn('[streaming][start-error]', {
                    forcedRouteMode: options?.forcedRouteMode ?? null,
                    allowGenerateFallback,
                    attempt,
                    startupNoNarrativeError,
                    transientStartError,
                    fallbackEnabled: fallbackToGenerateOnStartTimeout,
                    shouldAttemptFallback,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (shouldAttemptFallback) {
                const fallbackResult = await runGenerateFallback(
                    String(error),
                    attempt + 1,
                    forwardRetryCount + 1,
                    {
                        force: startupNoNarrativeError && options?.forcedRouteMode === 'task',
                    },
                );
                if (fallbackResult) {
                    if (debugStreamRecovery) {
                        console.warn('[streaming][start-error] fallback succeeded', {
                            runId: fallbackResult.runId,
                            attempt,
                        });
                    }
                    return fallbackResult;
                }
            }
            const runId = `start-failed-${randomUUID()}`;
            emitLlmTimingLog({
                taskId,
                threadId,
                turnId: options?.turnId,
                modelId,
                provider: modelProvider,
                phase: 'stream',
                outcome: 'error',
                attempt: attempt + 1,
                maxAttempts: forwardRetryCount + 1,
                assistantChars: 0,
                error,
                timings: buildTimingSnapshot({
                    startedAt: attemptStartedAt,
                    streamReadyAt,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                proxyBefore: proxySnapshotBeforeDisable,
                proxyAfter: proxySnapshotAfterDisable,
            });
            emitRateLimited({
                runId,
                attempt: 1,
                maxAttempts: 1,
                retryAfterMs: 0,
                error,
                message: 'Model startup failed before first token.',
                stage: resolveTimeoutStageFromError(error, {
                    hasAssistantText: false,
                    streamReady: streamReadyAt !== null,
                }),
                timings: buildTimingSnapshot({
                    startedAt: attemptStartedAt,
                    streamReadyAt,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: String(error),
                turnId: options?.turnId,
            });
            return { runId };
        }
        cacheRunContext(stream.runId, {
            threadId,
            resourceId,
            taskId,
            turnId: options?.turnId,
            workspacePath: options?.workspacePath,
            enabledSkills: options?.enabledSkills,
            skillPrompt: options?.skillPrompt,
            traceId: telemetry.traceId,
            traceSampled: telemetry.sampled,
        });
        let emittedAssistantText = false;
        let emittedAssistantCharCount = 0;
        let emittedToolingProgress = false;
        let emittedAnyStreamEvent = false;
        const sendWithAttemptTracking = sendWithRunContextCleanup(stream.runId, (event) => {
            emittedAnyStreamEvent = true;
            startupBudgetClosedByStreamProgress = true;
            if (
                event.type === 'text_delta'
                && event.role !== 'thinking'
                && typeof event.content === 'string'
                && event.content.trim().length > 0
            ) {
                emittedAssistantText = true;
                emittedAssistantCharCount += event.content.trim().length;
            }
            if (
                event.type === 'tool_call'
                || event.type === 'tool_result'
                || event.type === 'approval_required'
                || event.type === 'suspended'
            ) {
                emittedToolingProgress = true;
            }
            sendToDesktop(
                options?.turnId && !event.turnId
                    ? { ...event, turnId: options.turnId }
                    : event,
            );
        });
        try {
            const forwarded = await forwardStream(stream, sendWithAttemptTracking, {
                forcePostAssistantCompletion: options?.forcePostAssistantCompletion,
                chatTurn: useChatLatencyProfile,
                routeMode: options?.forcedRouteMode,
                streamAttemptStartedAt: attemptStartedAt,
                streamReadyAt,
                turnId: options?.turnId,
                onRateLimited: emitRateLimited,
                deadlineAt: chatTurnDeadlineAt ?? undefined,
            });
            if (forwarded.assistantText.length > 0) {
                const updated = contextCompressionStore.recordAssistantTurn({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    content: forwarded.assistantText,
                    turnId: options?.turnId,
                });
                options?.onPostCompact?.({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    microSummary: updated.microSummary,
                    structuredSummary: updated.structuredSummary,
                    recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
                });
            } else {
                flushPostCompactWithPromptPack();
            }
            emitLlmTimingLog({
                taskId,
                threadId,
                turnId: options?.turnId,
                modelId,
                provider: modelProvider,
                phase: 'stream',
                outcome: 'success',
                attempt: attempt + 1,
                maxAttempts: forwardRetryCount + 1,
                assistantChars: forwarded.assistantText.length,
                finishReason: forwarded.finishReason,
                timings: forwarded.timings,
                proxyBefore: proxySnapshotBeforeDisable,
                proxyAfter: proxySnapshotAfterDisable,
            });
            return { runId: stream.runId };
        } catch (error) {
            runContextById.delete(stream.runId);
            const hasTaskToolingProgressWithoutNarrative = (
                options?.forcedRouteMode === 'task'
                && emittedToolingProgress
                && emittedAssistantText === false
            );
            const noNarrativeCompletionError = isNoAssistantNarrativeCompletionError(error);
            const toolingNoNarrativeRetryBudget = Math.min(forwardRetryCount, 1);
            const canRetryTaskToolingNoNarrative = (
                options?.forcedRouteMode === 'task'
                && emittedAssistantText === false
                && emittedToolingProgress
                && noNarrativeCompletionError
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && attempt < toolingNoNarrativeRetryBudget
            );
            const canRetryNoNarrative = noNarrativeCompletionError
                && emittedAssistantText === false
                && !hasTaskToolingProgressWithoutNarrative
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && attempt < Math.min(forwardRetryCount, noNarrativeRetryCount);
            const isSnapshotLossAfterTooling = isWorkflowSnapshotMissingError(error);
            const isMissingTerminalAfterTooling = isMissingTerminalAfterToolingProgressError(error);
            const isStreamExecutionTimeoutAfterTooling = isStreamExecutionTimeoutError(error);
            const toolingInterruptionRetryBudget = (isMissingTerminalAfterTooling || isStreamExecutionTimeoutAfterTooling)
                ? Math.min(forwardRetryCount, 1)
                : forwardRetryCount;
            const canRetryTaskToolingInterruption = (
                options?.forcedRouteMode === 'task'
                && emittedAssistantText
                && emittedToolingProgress
                && emittedAssistantCharCount > 0
                && emittedAssistantCharCount <= 120
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && attempt < toolingInterruptionRetryBudget
                && (isSnapshotLossAfterTooling || isMissingTerminalAfterTooling || isStreamExecutionTimeoutAfterTooling)
            );
            const canRetry = (
                attempt < forwardRetryCount
                && isRetryableForwardError(error)
                && emittedAssistantText === false
                && !hasTaskToolingProgressWithoutNarrative
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && !noNarrativeCompletionError
            ) || canRetryNoNarrative || canRetryTaskToolingInterruption || canRetryTaskToolingNoNarrative;
            const shouldTryGenerateFallback = !emittedAssistantText && isRetryableForwardError(error);
            const shouldForceTaskNoNarrativeTimeoutFallback = (
                options?.forcedRouteMode === 'task'
                && emittedAssistantText === false
                && isStreamExecutionTimeoutError(error)
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
            );
            const shouldForceTaskToolingTimeoutFallback = (
                options?.forcedRouteMode === 'task'
                && emittedToolingProgress
                && emittedAssistantText
                && emittedAssistantCharCount > 0
                && emittedAssistantCharCount <= 120
                && isStreamExecutionTimeoutAfterTooling
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
            );
            const shouldTryGenerateFallbackForAttempt = (
                (shouldTryGenerateFallback && allowGenerateFallback)
                || shouldForceTaskNoNarrativeTimeoutFallback
                || shouldForceTaskToolingTimeoutFallback
            );
            if (debugStreamRecovery) {
                console.warn('[streaming][stream-error]', {
                    runId: stream.runId,
                    forcedRouteMode: options?.forcedRouteMode ?? null,
                    allowGenerateFallback,
                    emittedAssistantText,
                    emittedToolingProgress,
                    hasTaskToolingProgressWithoutNarrative,
                    forwardRetryCount,
                    noNarrativeRetryCount,
                    attempt,
                    noNarrativeCompletionError,
                    canRetryNoNarrative,
                    canRetry,
                    shouldTryGenerateFallback: shouldTryGenerateFallbackForAttempt,
                    shouldForceTaskNoNarrativeTimeoutFallback,
                    shouldForceTaskToolingTimeoutFallback,
                    startupBudgetClosedByStreamProgress,
                    emittedAnyStreamEvent,
                    fallbackEnabled: fallbackToGenerateOnStartTimeout,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (canRetry) {
                attempt += 1;
                const maxAttempts = forwardRetryCount + 1;
                emitRateLimited({
                    runId: stream.runId,
                    attempt: attempt + 1,
                    maxAttempts,
                    retryAfterMs: forwardRetryDelayMs,
                    error,
                    message: canRetryNoNarrative
                        ? `Model returned no assistant narrative. Retrying (${attempt + 1}/${maxAttempts})...`
                        : canRetryTaskToolingInterruption
                            ? `Tool execution interrupted after assistant preface. Retrying (${attempt + 1}/${maxAttempts})...`
                            : canRetryTaskToolingNoNarrative
                                ? `Tool execution produced no assistant narrative. Retrying (${attempt + 1}/${maxAttempts})...`
                        : `Model response delayed. Retrying (${attempt + 1}/${maxAttempts})...`,
                    stage: resolveTimeoutStageFromError(error, {
                        hasAssistantText: emittedAssistantText,
                        streamReady: streamReadyAt !== null,
                    }),
                    timings: buildTimingSnapshot({
                        startedAt: attemptStartedAt,
                        streamReadyAt,
                        firstTokenAt: null,
                        lastTokenAt: null,
                    }),
                });
                await delay(forwardRetryDelayMs * attempt);
                continue;
            }
            if (shouldTryGenerateFallbackForAttempt) {
                if (debugStreamRecovery) {
                    console.warn('[streaming][stream-error] attempting generate fallback', {
                        runId: stream.runId,
                        forcedRouteMode: options?.forcedRouteMode ?? null,
                        allowGenerateFallback,
                        force: noNarrativeCompletionError && options?.forcedRouteMode === 'task',
                    });
                }
                const fallbackResult = await runGenerateFallback(
                    String(error),
                    attempt + 1,
                    forwardRetryCount + 1,
                    {
                        force: (
                            (noNarrativeCompletionError && options?.forcedRouteMode === 'task')
                            || shouldForceTaskNoNarrativeTimeoutFallback
                            || shouldForceTaskToolingTimeoutFallback
                        ),
                        includeStartupBudget: !startupBudgetClosedByStreamProgress && !emittedAnyStreamEvent,
                    },
                );
                if (fallbackResult) {
                    return fallbackResult;
                }
            }
            emitLlmTimingLog({
                taskId,
                threadId,
                turnId: options?.turnId,
                modelId,
                provider: modelProvider,
                phase: 'stream',
                outcome: 'error',
                attempt: attempt + 1,
                maxAttempts: forwardRetryCount + 1,
                assistantChars: 0,
                error,
                timings: buildTimingSnapshot({
                    startedAt: attemptStartedAt,
                    streamReadyAt,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                proxyBefore: proxySnapshotBeforeDisable,
                proxyAfter: proxySnapshotAfterDisable,
            });
            sendToDesktop({
                type: 'error',
                runId: stream.runId,
                message: String(error),
            });
            return { runId: stream.runId };
        }
    }
}

export async function handleApprovalResponse(
    runId: string,
    toolCallId: string,
    approved: boolean,
    sendToDesktop: SendToDesktop,
    options?: {
        taskId?: string;
    },
): Promise<void> {
    const debugAutoApproval = process.env.COWORKANY_DEBUG_AUTO_APPROVAL === '1';
    const noSnapshotRunPattern = /\bNo snapshot found for this workflow run\b/i;
    const resolveFallbackRunIdsForTask = (taskId: string, attemptedRunId: string): string[] => {
        const candidates: string[] = [];
        for (const [cachedRunId, context] of Array.from(runContextById.entries()).reverse()) {
            if (cachedRunId === attemptedRunId) {
                continue;
            }
            if (context.taskId !== taskId) {
                continue;
            }
            candidates.push(cachedRunId);
        }
        return candidates;
    };
    const buildApprovalStartOptions = (approvalRunId: string): {
        runId: string;
        toolCallId: string;
        requestContext?: ReturnType<typeof createTaskRequestContext>;
        memory?: {
            thread: string;
            resource: string;
        };
        tracingOptions?: {
            traceId: string;
            tags: string[];
        };
    } => {
        const context = runContextById.get(approvalRunId);
        return {
            runId: approvalRunId,
            toolCallId,
            requestContext: context
                ? createTaskRequestContext({
                    threadId: context.threadId,
                    resourceId: context.resourceId,
                    taskId: context.taskId,
                    workspacePath: context.workspacePath,
                    enabledSkills: context.enabledSkills,
                    skillPrompt: context.skillPrompt,
                })
                : undefined,
            memory: context
                ? {
                    thread: context.threadId,
                    resource: context.resourceId,
                }
                : undefined,
            tracingOptions: context?.traceSampled
                ? {
                    traceId: context.traceId,
                    tags: [
                        'runtime:desktop-sidecar',
                        'resume:tool-approval',
                        `task:${context.taskId}`,
                        `resource:${context.resourceId}`,
                        `thread:${context.threadId}`,
                    ],
                }
                : undefined,
        };
    };
    let effectiveRunId = runId;
    let stream: (
        Awaited<ReturnType<typeof supervisor.approveToolCall>>
        | Awaited<ReturnType<typeof supervisor.declineToolCall>>
        | null
    ) = null;
    try {
        const baseOptions = buildApprovalStartOptions(runId);
        stream = approved
            ? await withStartRetries(async () => await supervisor.approveToolCall(baseOptions))
            : await withStartRetries(async () => await supervisor.declineToolCall(baseOptions));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const taskId = options?.taskId?.trim();
        const canFallback = Boolean(taskId && noSnapshotRunPattern.test(message));
        if (!canFallback) {
            throw error;
        }
        const fallbackRunIds = resolveFallbackRunIdsForTask(taskId as string, runId);
        let recovered = false;
        for (const fallbackRunId of fallbackRunIds) {
            const fallbackOptions = buildApprovalStartOptions(fallbackRunId);
            try {
                stream = approved
                    ? await withStartRetries(async () => await supervisor.approveToolCall(fallbackOptions))
                    : await withStartRetries(async () => await supervisor.declineToolCall(fallbackOptions));
                effectiveRunId = fallbackRunId;
                recovered = true;
                if (debugAutoApproval) {
                    console.warn('[streaming][approval] resumed with fallback run', {
                        requestedRunId: runId,
                        fallbackRunId,
                        taskId,
                        toolCallId,
                        approved,
                    });
                }
                break;
            } catch (fallbackError) {
                const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                if (!noSnapshotRunPattern.test(fallbackMessage)) {
                    throw fallbackError;
                }
            }
        }
        if (!recovered) {
            throw error;
        }
    }
    if (!stream) {
        throw new Error('approval_stream_unavailable');
    }
    if (debugAutoApproval) {
        console.warn('[streaming][approval] stream started', {
            runId: effectiveRunId,
            toolCallId,
            approved,
            streamRunId: stream.runId,
            hasRunContext: Boolean(runContextById.get(effectiveRunId)),
        });
    }
    try {
        await forwardStream(stream, sendWithRunContextCleanup(effectiveRunId, sendToDesktop));
        if (debugAutoApproval) {
            console.warn('[streaming][approval] stream completed', {
                runId: effectiveRunId,
                toolCallId,
                approved,
                streamRunId: stream.runId,
            });
        }
    } catch (error) {
        runContextById.delete(effectiveRunId);
        if (debugAutoApproval) {
            console.warn('[streaming][approval] stream failed', {
                runId: effectiveRunId,
                toolCallId,
                approved,
                streamRunId: stream.runId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        sendToDesktop({
            type: 'error',
            runId: effectiveRunId,
            message: String(error),
        });
    }
}

export function rewindTaskContextCompression(input: {
    taskId: string;
    userTurns: number;
}): {
    success: boolean;
    removedTurns: number;
    remainingTurns: number;
} {
    return contextCompressionStore.rewindByUserTurns(input.taskId, input.userTurns);
}
