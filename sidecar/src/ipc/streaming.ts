import { randomUUID } from 'crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { supervisor } from '../mastra/agents/supervisor';
import { supervisorSolo } from '../mastra/agents/supervisorSolo';
import { researcher } from '../mastra/agents/researcher';
import { chatResponder } from '../mastra/agents/chatResponder';
import { taskSynthesizer } from '../mastra/agents/taskSynthesizer';
import { TaskContextCompressionStore, type RecalledTopicMemory } from '../mastra/contextCompression';
import { isMcpEnabled, listMcpToolsetsSafe } from '../mastra/mcp/clients';
import { formatTaskCapabilityRequirement, resolveTaskCapabilityRequirements } from '../mastra/capabilityRegistry';
import { createTaskRequestContext } from '../mastra/requestContext';
import { createTelemetryRunContext } from '../mastra/telemetry';
import { resolveRuntimeModelConfigWithPreferredModel } from '../mastra/model/runtimeModel';
import {
    isBusinessDecisionSupportQuery,
    isCurrentDateTimeQuery,
    MARKET_QUERY_PATTERN,
    VOICE_OUTPUT_REQUEST_PATTERN,
    WEATHER_QUERY_PATTERN,
} from '../mastra/intentPatterns';
import {
    extractMastraFinalAssistantTextEvent,
    extractMastraTokenUsageEvent,
    isMastraOperationalProgressChunk,
    mapMastraChunkToDesktopEvent,
    type DesktopEvent,
    type MastraChunkLike,
} from './bridge';
import { extractExplicitOutputPaths, injectOutputPathContract } from './outputContract';
import { deriveFallbackOutputContent } from './outputMaterializer';
import {
    injectMultiAgentExecutionContract,
    shouldEnableAgentNetworkExecution,
} from '../mastra/multiAgentExecution';
import {
    buildDelegationExecutionPlan,
    injectDelegationPlanContract,
} from '../mastra/delegationPlanner';
import { injectDelegationSynthesisContract } from '../mastra/delegationSynthesizer';

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
    modelId?: string;
    traceId: string;
    traceSampled: boolean;
    executionMode: 'stream' | 'network';
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
const MODEL_PROVIDER_AUTHORITATIVE_FOR_NATIVE_STACK = new Set([
    'anthropic',
]);
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
const WEATHER_TOOL_NAME_PATTERN = /\b(weather|forecast|temperature|meteo|check_weather)\b|天气|气温|预报/iu;
const MEMORY_REMEMBER_INTENT_PATTERN = /^\s*(?:请|请你)?(?:帮我)?(?:记住|记下来|remember(?:\s+that)?)(?:[：:\s]|$|(?=我|这|以下|that))/iu;
const MEMORY_REMEMBER_PREFIX_PATTERN = /^\s*(?:请)?(?:帮我)?(?:记住|记下来|remember(?:\s+that)?)[：:\s]*/iu;
const MEMORY_RECALL_INTENT_PATTERN = /(还记得|我之前(?:让你)?记住|之前记住|回忆|回想|recall|what\s+(?:did|was)\s+i\s+(?:ask\s+you\s+to\s+)?remember|favorite.*(?:what|which)|最喜欢.*(?:是什么|是啥|是哪))/iu;
const BROWSER_AUTOMATION_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill|type|select|scroll|tab)\b/iu;
const GENERIC_WEB_RESEARCH_TOOL_PATTERN = /\b(search_web|websearch|crawl_url|extract_content|browser|scrape|search)\b|搜索|检索|爬虫/iu;
const MARKET_SPECIALIZED_TOOL_PATTERN = /\b(finance|quote|ticker|stock|equity|market_data|price|ohlc|candlestick|kline|trade|trading|exchange|hkex|nasdaq|nyse)\b|股|港股|美股|行情|股价|涨跌|市值|成交量|开盘|收盘/iu;
const MULTI_STEP_ACTION_PATTERN = /(?:\bfirst\b[\s\S]{0,120}\bthen\b|\bthen\b[\s\S]{0,120}\b(?:next|after|finally)\b|然后|接着|随后|之后|再(?:进行|执行|做)?|先(?:做|执行|完成)?[\s\S]{0,80}(?:再|然后)|基于(?:上一步|上述|前述|结果|信息))/iu;
const CAPABILITY_CONTRACT_MARKER = '[CoworkAny Capability Contract]';
const TOOL_EVENT_DEDUP_WINDOW_MS = resolvePositiveIntFromEnv(
    'COWORKANY_MASTRA_TOOL_EVENT_DEDUP_WINDOW_MS',
    250,
);

type DynamicToolsets = Awaited<ReturnType<typeof listMcpToolsetsSafe>>;
type RuntimeModelStream = Awaited<ReturnType<typeof supervisor.stream>>;
type RuntimeNetworkStream = Awaited<ReturnType<typeof supervisor.network>>;
type RuntimeStreamLike = {
    runId: string;
    fullStream?: AsyncIterable<unknown>;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

function stringifyFingerprintValue(value: unknown, maxLength = 640): string {
    if (value === undefined) {
        return 'undefined';
    }
    if (typeof value === 'string') {
        return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
    }
    try {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string') {
            return String(value);
        }
        return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
    } catch {
        return String(value);
    }
}

function toToolEventFingerprint(event: DesktopEvent): string | null {
    if (event.type === 'tool_call') {
        return `tool_call|${event.toolName}|${stringifyFingerprintValue(event.args)}`;
    }
    if (event.type === 'tool_result') {
        return `tool_result|${event.toolName}|${event.toolCallId}|${event.isError === true ? 'error' : 'ok'}|${stringifyFingerprintValue(event.result)}`;
    }
    return null;
}

function normalizeEnabledToolpackIds(toolpacks?: string[]): string[] {
    if (!Array.isArray(toolpacks)) {
        return [];
    }
    return Array.from(new Set(
        toolpacks
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0),
    ));
}

function filterToolsetsByEnabledToolpacks(
    toolsets: DynamicToolsets,
    enabledToolpacks?: string[],
): DynamicToolsets {
    const normalizedToolpacks = normalizeEnabledToolpackIds(enabledToolpacks);
    if (normalizedToolpacks.length === 0) {
        return toolsets;
    }
    const selected = new Set(normalizedToolpacks);
    const filtered: DynamicToolsets = {};
    for (const [serverName, serverTools] of Object.entries(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        const normalizedServerName = serverName.trim().toLowerCase();
        const serverMatches = normalizedToolpacks.some((toolpack) => (
            normalizedServerName === toolpack
            || normalizedServerName.endsWith(`:${toolpack}`)
        ));
        if (serverMatches) {
            filtered[serverName] = serverTools;
            continue;
        }
        const matchedTools = Object.fromEntries(
            Object.entries(serverTools).filter(([, toolMeta]) => {
                if (!toolMeta || typeof toolMeta !== 'object') {
                    return false;
                }
                const toolpackIdValue = Reflect.get(toolMeta, 'toolpackId');
                const toolpackNameValue = Reflect.get(toolMeta, 'toolpackName');
                const toolpackId = typeof toolpackIdValue === 'string'
                    ? toolpackIdValue.trim().toLowerCase()
                    : '';
                const toolpackName = typeof toolpackNameValue === 'string'
                    ? toolpackNameValue.trim().toLowerCase()
                    : '';
                return (toolpackId.length > 0 && selected.has(toolpackId))
                    || (toolpackName.length > 0 && selected.has(toolpackName));
            }),
        );
        if (Object.keys(matchedTools).length > 0) {
            filtered[serverName] = matchedTools as DynamicToolsets[string];
        }
    }
    if (Object.keys(filtered).length === 0) {
        return toolsets;
    }
    return filtered;
}

export function isMarketDataResearchQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    return MARKET_QUERY_PATTERN.test(normalized);
}

function shouldAutoPersistMemoryIntent(message: string, _forcedRouteMode?: 'chat' | 'task'): boolean {
    return MEMORY_REMEMBER_INTENT_PATTERN.test(message);
}

function shouldAutoRecallMemoryIntent(message: string, forcedRouteMode?: 'chat' | 'task'): boolean {
    if (shouldAutoPersistMemoryIntent(message, forcedRouteMode)) {
        return false;
    }
    return MEMORY_RECALL_INTENT_PATTERN.test(message);
}

function extractAutoMemoryValue(message: string): string {
    const normalized = message.replace(MEMORY_REMEMBER_PREFIX_PATTERN, '').trim();
    return normalized.length > 0 ? normalized : message.trim();
}

async function persistAutoRememberEntry(input: {
    workspacePath?: string;
    message: string;
}): Promise<{
    key: string;
    value: string;
    timestamp: string;
    total: number;
}> {
    const workspacePath = (input.workspacePath ?? process.cwd()).trim() || process.cwd();
    const memoryPath = path.join(workspacePath, '.coworkany', 'memory.json');
    let existing: Array<Record<string, unknown>> = [];
    try {
        const raw = await fs.readFile(memoryPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            existing = parsed
                .filter((item): item is Record<string, unknown> => (
                    typeof item === 'object'
                    && item !== null
                    && !Array.isArray(item)
                ));
        }
    } catch {
        existing = [];
    }
    const timestamp = new Date().toISOString();
    const key = `remember:${timestamp}`;
    const value = extractAutoMemoryValue(input.message);
    const entry: Record<string, unknown> = {
        key,
        value,
        category: 'user_preference',
        timestamp,
        source: 'auto_remember_intent',
    };
    existing.push(entry);
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(memoryPath, JSON.stringify(existing, null, 2), 'utf-8');
    return {
        key,
        value,
        timestamp,
        total: existing.length,
    };
}

async function loadAutoMemoryEntries(workspacePath?: string): Promise<Array<Record<string, unknown>>> {
    const basePath = (workspacePath ?? process.cwd()).trim() || process.cwd();
    const memoryPath = path.join(basePath, '.coworkany', 'memory.json');
    try {
        const raw = await fs.readFile(memoryPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item): item is Record<string, unknown> => (
            typeof item === 'object'
            && item !== null
            && !Array.isArray(item)
        ));
    } catch {
        return [];
    }
}

async function recallAutoMemoryEntries(input: {
    workspacePath?: string;
    message: string;
    limit?: number;
}): Promise<{
    success: boolean;
    count: number;
    items: Array<Record<string, unknown>>;
}> {
    const entries = await loadAutoMemoryEntries(input.workspacePath);
    const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
        ? Math.floor(input.limit)
        : 10;
    const lowered = input.message.toLowerCase();
    const preferred = (
        lowered.includes('最喜欢')
        || lowered.includes('favorite')
        || lowered.includes('偏好')
    )
        ? entries.filter((entry) => {
            const corpus = [
                typeof entry.key === 'string' ? entry.key : '',
                typeof entry.value === 'string' ? entry.value : '',
                typeof entry.category === 'string' ? entry.category : '',
            ].join(' ').toLowerCase();
            return corpus.includes('favorite')
                || corpus.includes('最喜欢')
                || corpus.includes('偏好')
                || corpus.includes('typescript');
        })
        : entries;
    const selected = (preferred.length > 0 ? preferred : entries)
        .slice(-limit)
        .reverse();
    return {
        success: true,
        count: selected.length,
        items: selected,
    };
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

function stripDelegatedAgentTools(
    toolsets: DynamicToolsets,
): DynamicToolsets {
    let changed = false;
    const next: DynamicToolsets = {};
    for (const [serverName, serverTools] of Object.entries(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        const filtered = Object.fromEntries(
            Object.entries(serverTools).filter(([toolName]) => !toolName.trim().toLowerCase().startsWith('agent-')),
        );
        if (Object.keys(filtered).length !== Object.keys(serverTools).length) {
            changed = true;
        }
        next[serverName] = filtered as DynamicToolsets[string];
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
        enabledToolpacks?: string[];
        allowDelegatedAgentTools?: boolean;
    },
): DynamicToolsets {
    if (attempt > 0) {
        return toolsets;
    }
    const selectedByToolpacks = filterToolsetsByEnabledToolpacks(toolsets, options?.enabledToolpacks);
    const baseToolsets = options?.allowDelegatedAgentTools === true
        ? selectedByToolpacks
        : stripDelegatedAgentTools(selectedByToolpacks);
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
        return baseToolsets;
    }

    const sanitizedToolsets = stripWorkspaceExecuteCommandTool(baseToolsets);
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

function injectCapabilityExecutionContract(input: {
    message: string;
    requiredCompletionCapabilities: string[];
}): string {
    const normalized = input.message.trim();
    if (normalized.length === 0 || normalized.includes(CAPABILITY_CONTRACT_MARKER)) {
        return input.message;
    }
    const required = normalizeRequiredCompletionCapabilities(input.requiredCompletionCapabilities);
    if (required.length === 0) {
        return input.message;
    }
    const isMarketQuery = isMarketDataResearchQuery(normalized);
    const isBusinessDecisionQuery = isBusinessDecisionSupportQuery(normalized);
    const isCurrentDateTimeQueryTurn = isCurrentDateTimeQuery(normalized);
    const lines: string[] = [CAPABILITY_CONTRACT_MARKER];
    if (required.includes('web_research')) {
        lines.push('- Before final answer, you MUST complete at least one successful research tool call and cite the retrieved evidence.');
        lines.push('- Use the most relevant retrieval tools available for the task (e.g., search_web/crawl_url/get_news/check_weather).');
        if (isMarketQuery) {
            lines.push('- For market requests, run at least two focused retrieval queries (instrument disambiguation + recent price/news catalyst).');
            lines.push('- For market requests, do not rely on model memory alone even when data is incomplete.');
        }
        if (isBusinessDecisionQuery) {
            lines.push('- For business decision requests, evaluate at least two realistic options (or partner paths) with upside, downside, and execution cost/timeline.');
            lines.push('- For business decision requests, return a concrete recommendation (priority/go-no-go) with assumptions and key risks.');
        }
    }
    if (required.includes('browser_automation')) {
        lines.push('- Before final answer, you MUST execute at least one browser automation tool call that verifies page state.');
    }
    if (required.includes('voice_output')) {
        lines.push('- When spoken output is requested, you MUST call voice_speak in this turn before final answer.');
        lines.push('- Do not satisfy spoken-output requests by explanation only.');
        if (required.includes('web_research')) {
            lines.push('- For web-research + spoken-output tasks, execute "search -> concise synthesis -> voice_speak" in the same turn.');
            lines.push('- Do not run more than 3 research tool calls before the first voice_speak call.');
            lines.push('- If sources are noisy/incomplete, produce a short best-effort spoken summary and still call voice_speak.');
        }
    }
    if (required.includes('command_execution')) {
        lines.push('- For execution tasks, you MUST run at least one relevant shell/command tool call before final answer.');
        lines.push('- Do not claim task completion from directory inspection alone when execution is required.');
        lines.push('- For filesystem mutation tasks (move/copy/rename/delete files or folders), execute via command tools and report the actual execution result.');
        lines.push('- If the first command attempt fails, run a recovery loop instead of refusing: inspect tool errors, pick a concrete alternative, retry, then summarize final status.');
        lines.push('- For command-not-found or unsupported-command errors, prefer this order: (1) use alternative_commands/suggested_fix/command_recovery from tool result, (2) run probe_commands (or command -v/which/where/Get-Command), (3) check usage via --help/man, (4) retry with a platform-appropriate command.');
        lines.push('- Do not stop at "unknown command" or "cannot operate this system". You must attempt at least one recovery retry before concluding unavailable.');
        if (isCurrentDateTimeQueryTurn) {
            lines.push('- For current date/time queries, call a local command tool (for example `date`) and report the actual system date/time with timezone.');
        }
    }
    if (isMarketQuery) {
        lines.push('- Market-analysis output MUST include: ticker/exchange disambiguation, time-anchored price context (date/timezone/session), trend scenarios, and a concrete rating (buy/hold/sell).');
        lines.push('- If user asks entry timing/price level, provide an actionable entry range or trigger levels with invalidation/stop conditions.');
        lines.push('- Do not replace analysis with generic refusal text such as "cannot provide investment advice". Use uncertainty bounds instead.');
    }
    if (isBusinessDecisionQuery) {
        lines.push('- Do not replace business analysis with generic refusal text. Provide best-effort recommendation with explicit uncertainty bounds.');
    }
    return `${input.message}\n\n${lines.join('\n')}`;
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
    message: string;
    isTaskRoute: boolean;
    useDirectChatResponder: boolean;
    preferResearcherForWebResearchTasks: boolean;
    requiredCompletionCapabilities: string[];
    requiredOutputPaths: string[];
}): boolean {
    if (input.requiredOutputPaths.length > 0) {
        return false;
    }
    const capabilities = input.requiredCompletionCapabilities.map((value) => value.trim().toLowerCase());
    const hasNonResearchExecutionCapability = capabilities.some((value) => value !== 'web_research');
    if (
        hasNonResearchExecutionCapability
        || VOICE_OUTPUT_REQUEST_PATTERN.test(input.message)
        || MULTI_STEP_ACTION_PATTERN.test(input.message)
    ) {
        return false;
    }
    return (
        !input.useDirectChatResponder
        && input.isTaskRoute
        && input.preferResearcherForWebResearchTasks
        && capabilities.includes('web_research')
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
    const modelProvider = modelId.split('/')[0]?.toLowerCase();
    const modelProviderApiKey = modelProvider ? PROVIDER_KEY_MAP[modelProvider] : null;
    if (configuredProvider === 'custom') {
        const customApiFormat = env.COWORKANY_LLM_CUSTOM_API_FORMAT?.trim().toLowerCase();
        const customKeyEnv = customApiFormat === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : 'OPENAI_API_KEY';
        return env[customKeyEnv] ? null : customKeyEnv;
    }
    if (configuredProvider && OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(configuredProvider)) {
        if (
            modelProvider
            && modelProviderApiKey
            && MODEL_PROVIDER_AUTHORITATIVE_FOR_NATIVE_STACK.has(modelProvider)
        ) {
            return env[modelProviderApiKey] ? null : modelProviderApiKey;
        }
        return env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY';
    }

    const provider = modelProvider;
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

function hasExplicitEnv(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(process.env, name);
}

function resolveTaskCapabilityNonNegativeInt(
    taskScopedName: string,
    taskScopedFallback: number,
    globalName: string,
    globalFallback: number,
): number {
    if (hasExplicitEnv(taskScopedName)) {
        return resolveNonNegativeIntFromEnv(taskScopedName, taskScopedFallback);
    }
    if (hasExplicitEnv(globalName)) {
        return resolveNonNegativeIntFromEnv(globalName, globalFallback);
    }
    return taskScopedFallback;
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
    const contractedMessage = injectOutputPathContract(message);
    const normalizedPrompt = typeof skillPrompt === 'string' ? skillPrompt.trim() : '';
    if (!normalizedPrompt) {
        return contractedMessage;
    }
    return `${normalizedPrompt}\n\n[User Request]\n${contractedMessage}`;
}

function resolveRequiredOutputPathsForTurn(message: string, workspacePath?: string): string[] {
    const extracted = extractExplicitOutputPaths(message);
    if (extracted.length === 0) {
        return [];
    }
    const baseDir = typeof workspacePath === 'string' && workspacePath.trim().length > 0
        ? workspacePath
        : process.cwd();
    const deduped = new Set<string>();
    for (const candidate of extracted) {
        const trimmed = candidate.trim();
        const withoutDotPrefix = trimmed.replace(/^[.][\\/]/u, '');
        const workspaceRelative = withoutDotPrefix
            .replace(/^workspace[\\/]/iu, '')
            .replace(/^\.workspace[\\/]/iu, '');
        const normalized = path.isAbsolute(trimmed)
            ? path.normalize(trimmed)
            : path.resolve(baseDir, workspaceRelative);
        deduped.add(normalized);
    }
    return [...deduped];
}

async function collectMissingRequiredOutputPaths(paths: string[]): Promise<string[]> {
    if (paths.length === 0) {
        return [];
    }
    const missing: string[] = [];
    for (const candidate of paths) {
        try {
            const stat = await fs.stat(candidate);
            if (!stat.isFile() || stat.size <= 0) {
                missing.push(candidate);
            }
        } catch {
            missing.push(candidate);
        }
    }
    return missing;
}

function buildMissingOutputPathsReminder(baseMessage: string, missingPaths: string[]): string {
    if (missingPaths.length === 0) {
        return baseMessage;
    }
    const block = [
        '[Required Output Missing]',
        'The required output file path(s) below are missing or empty.',
        ...missingPaths.map((candidate) => `- ${candidate}`),
        'Create/update these exact path(s) now. Do not rename or substitute filenames.',
        'Before completion, verify each required path exists and is non-empty.',
    ].join('\n');
    return `${baseMessage}\n\n${block}`;
}

const PLACEHOLDER_SANITIZE_EXTENSIONS = new Set([
    '.json',
    '.csv',
    '.txt',
    '.md',
    '.py',
    '.yaml',
    '.yml',
    '.html',
    '.xml',
]);

const PLACEHOLDER_MARKERS = ['todo', 'fixme', 'xxx', 'placeholder', 'changeme', 'your_'];

const PLACEHOLDER_REPLACEMENTS: Record<string, string> = {
    todo: 'to do',
    fixme: 'fix me',
    xxx: 'x x x',
    placeholder: 'template',
    changeme: 'change-me',
    your_: 'user_',
};

const TRANSIENT_WORKSPACE_ARTIFACT_DIR_NAMES = new Set([
    '__pycache__',
    '.pytest_cache',
]);

const TRANSIENT_WORKSPACE_ARTIFACT_FILE_PATTERNS = [
    /\.pyc$/iu,
    /\.pyo$/iu,
];

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function neutralizePlaceholderMarkers(content: string): string {
    let next = content;
    for (const marker of PLACEHOLDER_MARKERS) {
        const replacement = PLACEHOLDER_REPLACEMENTS[marker] ?? marker;
        next = next.replace(new RegExp(escapeRegExp(marker), 'giu'), replacement);
    }
    return next;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
    const relative = path.relative(basePath, targetPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePlaceholderSanitizeWorkspacePath(input: {
    workspacePath: string;
    requiredOutputPaths: string[];
}): string {
    const workspacePath = path.resolve(input.workspacePath);
    const outputDirectories = Array.from(new Set(
        input.requiredOutputPaths
            .map((candidate) => path.dirname(path.resolve(candidate)))
            .filter((candidate) => isPathWithin(workspacePath, candidate)),
    ));
    if (outputDirectories.length === 1) {
        return outputDirectories[0] as string;
    }
    return workspacePath;
}

async function sanitizePlaceholderSupportFiles(input: {
    workspacePath: string;
    requiredOutputPaths: string[];
}): Promise<string[]> {
    const workspacePath = path.resolve(input.workspacePath);
    const requiredOutputPathSet = new Set(
        input.requiredOutputPaths.map((candidate) => path.resolve(candidate)),
    );
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const sanitizedPaths: string[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        const extension = path.extname(entry.name).toLowerCase();
        if (!PLACEHOLDER_SANITIZE_EXTENSIONS.has(extension)) {
            continue;
        }
        const absolutePath = path.resolve(workspacePath, entry.name);
        if (requiredOutputPathSet.has(absolutePath)) {
            continue;
        }
        let content: string;
        try {
            content = await fs.readFile(absolutePath, 'utf8');
        } catch {
            continue;
        }
        const normalized = content.toLowerCase();
        const hasPlaceholder = PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
        if (!hasPlaceholder) {
            continue;
        }
        const sanitized = neutralizePlaceholderMarkers(content);
        if (sanitized === content) {
            continue;
        }
        await fs.writeFile(absolutePath, sanitized, 'utf8');
        sanitizedPaths.push(absolutePath);
    }
    return sanitizedPaths;
}

async function ensureTaskFallbackOutputFile(input: {
    workspacePath: string;
    requiredOutputPaths: string[];
    assistantText: string;
}): Promise<string | null> {
    if (input.requiredOutputPaths.length > 0) {
        return null;
    }
    const content = input.assistantText.trim();
    if (content.length === 0) {
        return null;
    }
    const workspacePath = path.resolve(input.workspacePath);
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const hasVisibleRootFile = entries.some((entry) => entry.isFile() && !entry.name.startsWith('.'));
    if (hasVisibleRootFile) {
        return null;
    }
    const fallbackPath = path.join(workspacePath, 'result.md');
    await fs.writeFile(fallbackPath, `${content}\n`, 'utf8');
    return fallbackPath;
}

export async function cleanupTransientWorkspaceArtifacts(input: {
    workspacePath: string;
    requiredOutputPaths?: string[];
}): Promise<string[]> {
    const workspacePath = path.resolve(input.workspacePath);
    const protectedPaths = new Set(
        (input.requiredOutputPaths ?? []).map((candidate) => path.resolve(candidate)),
    );
    const removedPaths: string[] = [];

    const walk = async (currentPath: string): Promise<void> => {
        let entries;
        try {
            entries = await fs.readdir(currentPath, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolutePath = path.resolve(currentPath, entry.name);
            if (!isPathWithin(workspacePath, absolutePath)) {
                continue;
            }
            if (protectedPaths.has(absolutePath)) {
                continue;
            }
            if (entry.isDirectory()) {
                if (TRANSIENT_WORKSPACE_ARTIFACT_DIR_NAMES.has(entry.name)) {
                    await fs.rm(absolutePath, { recursive: true, force: true });
                    removedPaths.push(absolutePath);
                    continue;
                }
                await walk(absolutePath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const matchesTransientArtifact = TRANSIENT_WORKSPACE_ARTIFACT_FILE_PATTERNS
                .some((pattern) => pattern.test(entry.name));
            if (!matchesTransientArtifact) {
                continue;
            }
            await fs.rm(absolutePath, { force: true });
            removedPaths.push(absolutePath);
        }
    };

    await walk(workspacePath);
    return removedPaths;
}

async function materializeMissingRequiredOutputFiles(input: {
    requiredOutputPaths: string[];
    assistantText: string;
}): Promise<string[]> {
    if (input.requiredOutputPaths.length === 0) {
        return [];
    }
    const content = input.assistantText.trim();
    if (content.length === 0) {
        return [];
    }
    const created: string[] = [];
    for (const candidate of input.requiredOutputPaths) {
        const targetPath = path.resolve(candidate);
        let hasNonEmptyFile = false;
        try {
            const stat = await fs.stat(targetPath);
            hasNonEmptyFile = stat.isFile() && stat.size > 0;
        } catch {
            hasNonEmptyFile = false;
        }
        if (hasNonEmptyFile) {
            continue;
        }
        const materializedContent = deriveFallbackOutputContent(targetPath, content);
        if (!materializedContent) {
            continue;
        }
        try {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, materializedContent, 'utf8');
            created.push(targetPath);
        } catch {
            // Best-effort fallback: keep remaining paths independent.
        }
    }
    return created;
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
    if (/\b(stream_idle_timeout|stream_progress_timeout|stream_required_output_timeout|stream_exhausted_without_assistant_text|complete_without_assistant_text|timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
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
    return /\b(stream_idle_timeout|stream_progress_timeout|stream_required_output_timeout|stream_absolute_timeout|stream_max_duration_timeout)\b/i.test(message);
}

function isRequiredOutputStreamTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bstream_required_output_timeout\b/i.test(message);
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

const FINAL_SYNTHESIS_CONTRACT_MARKER = '[CoworkAny Final Synthesis Contract]';
const SOURCE_LINK_PATTERN = /https?:\/\/[^\s)]+/iu;
const SOURCE_ATTRIBUTION_PATTERN = /\b(source|sources|according to|reported by|via)\b|来源|据(?:[^，。]{0,20})(?:报道|显示)|数据来源/iu;
const STRUCTURED_SUMMARY_PATTERN = /(^|\n)\s*(?:#{1,6}\s+|[-*]\s+|\d+\.\s+|\|.+\|)|\n{2,}/u;
const EXECUTION_STATUS_SENTENCE_PATTERN = /\b(will|going to|search(?:ing)?|crawl(?:ing)?|fetch(?:ing)?|retry(?:ing)?|collect(?:ing)?|organize|organizing|save|saving|prepare|preparing)\b|先|然后|接着|随后|正在|我来|我会|并行搜索|换关键词|重试|整理|保存|抓取|检索/iu;
const CONCLUSION_SIGNAL_PATTERN = /\b(summary|conclusion|recommend(?:ation)?|risk|outlook|action)\b|总结|结论|建议|风险|判断|展望/iu;

function splitMeaningfulSentences(text: string): string[] {
    return text
        .split(/[.!?。！？]\s*|\n+/u)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}

function hasGroundedEvidenceSignals(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    return SOURCE_LINK_PATTERN.test(normalized)
        || SOURCE_ATTRIBUTION_PATTERN.test(normalized);
}

function isLikelyExecutionOnlyNarration(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    const sentences = splitMeaningfulSentences(normalized);
    if (sentences.length === 0) {
        return false;
    }
    const executionSentenceCount = sentences.filter((sentence) => EXECUTION_STATUS_SENTENCE_PATTERN.test(sentence)).length;
    const executionRatio = executionSentenceCount / sentences.length;
    const hasGroundedEvidence = hasGroundedEvidenceSignals(normalized);
    const hasStructuredSummary = STRUCTURED_SUMMARY_PATTERN.test(normalized);
    const hasConclusionSignal = CONCLUSION_SIGNAL_PATTERN.test(normalized);
    if (hasGroundedEvidence || hasStructuredSummary || hasConclusionSignal) {
        return false;
    }
    return executionRatio >= 0.6;
}

function buildFinalSynthesisContractMessage(
    baseMessage: string,
    requiredCompletionCapabilities: string[],
): string {
    if (baseMessage.includes(FINAL_SYNTHESIS_CONTRACT_MARKER)) {
        return baseMessage;
    }
    const normalizedCapabilities = normalizeRequiredCompletionCapabilities(requiredCompletionCapabilities);
    const lines: string[] = [
        FINAL_SYNTHESIS_CONTRACT_MARKER,
        '- Tool collection phase is complete. Produce the final user-facing answer now.',
        '- Do not output execution-status narration (for example "I will search/retry/organize/save").',
    ];
    if (normalizedCapabilities.includes('web_research')) {
        lines.push('- Include concrete findings from retrieved evidence with source attribution (source names and/or links).');
        lines.push('- Include analytical depth: key trend, supporting data points, assumptions, and primary risks.');
    }
    if (normalizedCapabilities.includes('command_execution')) {
        lines.push('- Summarize command execution outcomes, including what succeeded/failed and final workspace state.');
    }
    if (isMarketDataResearchQuery(baseMessage) || isBusinessDecisionSupportQuery(baseMessage)) {
        lines.push('- Provide best-effort recommendation with explicit uncertainty bounds, even when data is incomplete.');
        lines.push('- Do NOT output generic refusal phrasing such as "cannot provide" / "无法提供".');
    }
    lines.push('- End with actionable conclusions that directly answer the user request.');
    return `${baseMessage}\n\n${lines.join('\n')}`;
}

function normalizeToolResultNarrativeText(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return '';
    }
    const record = value as Record<string, unknown>;
    const candidate = [
        record.text,
        record.content,
        record.summary,
        record.output,
        record.answer,
        record.message,
    ].find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return typeof candidate === 'string' ? candidate.trim() : '';
}

function extractFinalSynthesisNarrativeFromEvent(event: DesktopEvent): string {
    if (event.type !== 'tool_result' || event.isError === true) {
        return '';
    }
    if (event.toolName.trim().toLowerCase() !== 'final_synthesis') {
        return '';
    }
    return normalizeToolResultNarrativeText(event.result);
}

function softenDecisionRefusalLanguage(text: string, message: string): string {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return normalized;
    }
    if (!isMarketDataResearchQuery(message) && !isBusinessDecisionSupportQuery(message)) {
        return normalized;
    }
    let next = normalized;
    const replacements: Array<[RegExp, string]> = [
        [/\b(?:i\s+)?cannot\s+provide(?:\s+specific)?\s+(?:investment|financial)\s+advice\b/giu, 'I can provide a best-effort research view with explicit uncertainty bounds'],
        [/\bcan(?:not|'t)\s+provide\b/giu, 'provide a best-effort analysis with uncertainty bounds'],
        [/我无法提供(?:具体)?(?:的)?(?:投资|财务)?建议/gu, '我将基于当前可得信息给出区间化研究判断'],
        [/无法提供/gu, '可基于当前可得信息给出不确定性范围判断'],
        [/请咨询(?:专业)?(?:投资)?顾问/gu, '以下为研究参考，请结合自身风险偏好'],
    ];
    for (const [pattern, replacement] of replacements) {
        next = next.replace(pattern, replacement);
    }
    return next.trim();
}

function shouldForceTaskFinalSynthesis(input: {
    routeMode?: 'chat' | 'task';
    finishReason?: string;
    emittedToolingProgress: boolean;
    assistantText: string;
    requiredCompletionCapabilities: string[];
}): {
    shouldForce: boolean;
    reason: string;
} {
    if (input.routeMode !== 'task' || !input.emittedToolingProgress) {
        return { shouldForce: false, reason: '' };
    }
    const normalizedText = input.assistantText.trim();
    if (normalizedText.length === 0) {
        return {
            shouldForce: true,
            reason: 'tooling_without_final_summary',
        };
    }
    const normalizedCapabilities = normalizeRequiredCompletionCapabilities(input.requiredCompletionCapabilities);
    const requiresWebResearch = normalizedCapabilities.includes('web_research');
    const isExecutionOnlyNarration = isLikelyExecutionOnlyNarration(normalizedText);
    const hasEvidenceSignals = hasGroundedEvidenceSignals(normalizedText);
    if (input.finishReason === 'tool-calls' && (isExecutionOnlyNarration || (requiresWebResearch && !hasEvidenceSignals))) {
        return {
            shouldForce: true,
            reason: 'tool_calls_without_grounded_summary',
        };
    }
    if (
        requiresWebResearch
        && /^assistant_text_/i.test(input.finishReason ?? '')
        && (isExecutionOnlyNarration || !hasEvidenceSignals)
    ) {
        return {
            shouldForce: true,
            reason: 'assistant_text_without_grounded_research_summary',
        };
    }
    return { shouldForce: false, reason: '' };
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
    if (/chat_(?:turn|startup)_timeout_budget_exhausted/.test(normalized)) {
        return context?.streamReady ? 'first_token' : 'ttfb';
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

function resolveChunkIterator(stream: RuntimeStreamLike): AsyncIterator<MastraChunkLike> {
    const fullStream = stream.fullStream;
    if (fullStream && typeof fullStream[Symbol.asyncIterator] === 'function') {
        return fullStream[Symbol.asyncIterator]() as AsyncIterator<MastraChunkLike>;
    }
    const streamAsyncIterator = stream[Symbol.asyncIterator];
    if (typeof streamAsyncIterator === 'function') {
        return streamAsyncIterator.call(stream) as AsyncIterator<MastraChunkLike>;
    }
    throw new Error('stream_iterator_unavailable');
}

async function forwardStream(
    stream: RuntimeStreamLike,
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
        requiredOutputPaths?: string[];
        originalMessage?: string;
    },
): Promise<{ assistantText: string; finishReason?: string; timings: StreamTimingSnapshot }> {
    const runId = stream.runId;
    const debugStreamRecovery = process.env.COWORKANY_DEBUG_STREAM_RECOVERY === '1';
    let hasAssistantTextDelta = false;
    let assistantText = '';
    const iterator = resolveChunkIterator(stream);
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
    const originalMessage = typeof options?.originalMessage === 'string'
        ? options.originalMessage
        : '';
    const taskStreamFinalOnly = isTaskTurn && resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TASK_STREAM_FINAL_ONLY',
        false,
    );
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
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_POST_ASSISTANT_IDLE_COMPLETE_MS', 60_000, {
            min: 1,
            max: 120_000,
        });
    const postAssistantMaxCompleteMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS', 20_000, {
            min: 1,
            max: 180_000,
        })
        : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_POST_ASSISTANT_MAX_MS', 90_000, {
            min: 1,
            max: 180_000,
        });
    const forcedPostAssistantHardMaxCompleteMs = options?.forcePostAssistantCompletion === true
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
    const taskPostAssistantHardMaxCompleteMs = isTaskTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_POST_ASSISTANT_HARD_MAX_MS', 60_000, {
            min: 1,
            max: 210_000,
        })
        : 0;
    const postAssistantHardMaxCompleteMs = forcedPostAssistantHardMaxCompleteMs > 0
        ? forcedPostAssistantHardMaxCompleteMs
        : taskPostAssistantHardMaxCompleteMs;
    const maxDurationMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS', 180_000, {
            min: 1,
            max: 240_000,
        })
        : (
            isTaskTurn
                ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_STREAM_MAX_DURATION_MS', 90_000, {
                    min: 1,
                    max: 240_000,
                })
                : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_MAX_DURATION_MS', 180_000, {
                    min: 1,
                    max: 240_000,
                })
        );
    const absoluteStreamTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_CHAT_STREAM_ABSOLUTE_TIMEOUT_MS', 220_000, {
            min: 1,
            max: 300_000,
        })
        : (
            isTaskTurn
                ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_STREAM_ABSOLUTE_TIMEOUT_MS', 150_000, {
                    min: 1,
                    max: 300_000,
                })
                : resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_STREAM_ABSOLUTE_TIMEOUT_MS', 180_000, {
                    min: 1,
                    max: 300_000,
                })
        );
    const taskNoNarrativeToolingMaxMs = isTaskTurn
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_NO_NARRATIVE_TOOLING_MAX_MS', 90_000, {
            min: 1,
            max: 240_000,
        })
        : 0;
    const requiredOutputPaths = isTaskTurn
        ? Array.from(new Set(
            (options?.requiredOutputPaths ?? [])
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
        ))
        : [];
    const taskRequiredOutputMissingMaxMs = (isTaskTurn && requiredOutputPaths.length > 0)
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_REQUIRED_OUTPUT_MISSING_MAX_MS', 95_000, {
            min: 1,
            max: 240_000,
        })
        : 0;
    const taskOutputReadySettleMs = (isTaskTurn && requiredOutputPaths.length > 0)
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_OUTPUT_READY_SETTLE_MS', 20_000, {
            min: 1,
            max: 120_000,
        })
        : 0;
    const taskRequiredOutputIdleTimeoutMs = (isTaskTurn && requiredOutputPaths.length > 0)
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_REQUIRED_OUTPUT_IDLE_TIMEOUT_MS', 10_000, {
            min: 1_000,
            max: 120_000,
        })
        : idleTimeoutMs;
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
            taskPostAssistantHardMaxCompleteMs,
            maxDurationMs,
            absoluteStreamTimeoutMs,
            taskRequiredOutputMissingMaxMs,
            requiredOutputPathCount: requiredOutputPaths.length,
            taskOutputReadySettleMs,
            taskRequiredOutputIdleTimeoutMs,
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
    let firstToolingWithoutNarrativeAt: number | null = null;
    let lastAssistantNarrativeProgressChunk: string | null = null;
    let lastMirroredFinalSynthesisNarrative: string | null = null;
    let sawToolingAfterAssistantText = false;
    let sawThinkingAfterAssistantText = false;
    let sawManualApprovalBeforeNarrative = false;
    let firstRequiredOutputMissingAt: number | null = (
        isTaskTurn && requiredOutputPaths.length > 0
            ? streamStartedAt
            : null
    );
    let requiredOutputSatisfiedAt: number | null = null;
    let requiredOutputWriteObserved = false;
    let syntheticRequiredOutputEvidenceEmitted = false;
    let lastRequiredOutputProbeAt = 0;
    const requiredOutputProbeIntervalMs = (isTaskTurn && requiredOutputPaths.length > 0)
        ? resolvePositiveIntFromEnvBounded('COWORKANY_MASTRA_TASK_OUTPUT_PROBE_INTERVAL_MS', 2_000, {
            min: 200,
            max: 15_000,
        })
        : 0;
    const emitRequiredOutputPresenceEvidence = (): void => {
        if (syntheticRequiredOutputEvidenceEmitted || requiredOutputWriteObserved || requiredOutputPaths.length === 0) {
            return;
        }
        syntheticRequiredOutputEvidenceEmitted = true;
        requiredOutputWriteObserved = true;
        for (const outputPath of requiredOutputPaths) {
            const syntheticRunId = `${runId}:required-output-evidence:${randomUUID()}`;
            sendToDesktop({
                type: 'tool_call',
                runId: syntheticRunId,
                toolName: 'write_to_file',
                args: {
                    path: outputPath,
                    source: 'required_output_presence_detector',
                },
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'tool_result',
                runId: syntheticRunId,
                toolCallId: `write_to_file:presence:${randomUUID()}`,
                toolName: 'write_to_file',
                result: {
                    path: outputPath,
                    source: 'required_output_presence_detector',
                    materialized: false,
                    verified: true,
                },
                isError: false,
                turnId: options?.turnId,
            });
        }
    };
    const recentToolEventTimestamps = new Map<string, number>();
    const isDuplicateToolEvent = (event: DesktopEvent): boolean => {
        const fingerprint = toToolEventFingerprint(event);
        if (!fingerprint) {
            return false;
        }
        const now = Date.now();
        for (const [key, seenAt] of recentToolEventTimestamps) {
            if (now - seenAt > TOOL_EVENT_DEDUP_WINDOW_MS) {
                recentToolEventTimestamps.delete(key);
            }
        }
        const lastSeenAt = recentToolEventTimestamps.get(fingerprint);
        recentToolEventTimestamps.set(fingerprint, now);
        return typeof lastSeenAt === 'number' && now - lastSeenAt <= TOOL_EVENT_DEDUP_WINDOW_MS;
    };
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
    const flushBufferedAssistantDelta = (force: boolean, finalize = false): void => {
        if (bufferedAssistantDelta.length === 0) {
            return;
        }
        if (taskStreamFinalOnly && !finalize && !sawTerminalEvent) {
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
        if (isTaskTurn && requiredOutputPaths.length > 0 && requiredOutputProbeIntervalMs > 0) {
            const now = Date.now();
            if (now - lastRequiredOutputProbeAt >= requiredOutputProbeIntervalMs) {
                lastRequiredOutputProbeAt = now;
                const missingPaths = await collectMissingRequiredOutputPaths(requiredOutputPaths);
                if (missingPaths.length > 0) {
                    requiredOutputSatisfiedAt = null;
                    if (firstRequiredOutputMissingAt === null) {
                        firstRequiredOutputMissingAt = now;
                    }
                } else {
                    firstRequiredOutputMissingAt = null;
                    if (requiredOutputSatisfiedAt === null) {
                        requiredOutputSatisfiedAt = now;
                    }
                    emitRequiredOutputPresenceEvidence();
                }
            }
        }
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
        if (
            isTaskTurn
            && !hasAssistantTextDelta
            && firstToolingWithoutNarrativeAt !== null
            && Date.now() - firstToolingWithoutNarrativeAt >= taskNoNarrativeToolingMaxMs
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            throw new Error(`stream_max_duration_timeout:${taskNoNarrativeToolingMaxMs}`);
        }
        if (
            isTaskTurn
            && taskRequiredOutputMissingMaxMs > 0
            && firstRequiredOutputMissingAt !== null
            && Date.now() - firstRequiredOutputMissingAt >= taskRequiredOutputMissingMaxMs
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            throw new Error(`stream_required_output_timeout:${taskRequiredOutputMissingMaxMs}`);
        }
        if (
            isTaskTurn
            && taskOutputReadySettleMs > 0
            && requiredOutputSatisfiedAt !== null
            && hasAssistantTextDelta
            && !sawTerminalEvent
            && Date.now() - requiredOutputSatisfiedAt >= taskOutputReadySettleMs
        ) {
            await closeIteratorSafely();
            flushBufferedAssistantDelta(true);
            sawTerminalEvent = true;
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'required_output_ready_settled',
            });
            sawCompleteEvent = true;
            terminalFinishReason = 'required_output_ready_settled';
            break;
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
                const baseIdleTimeoutMs = (isTaskTurn && requiredOutputPaths.length > 0)
                    ? taskRequiredOutputIdleTimeoutMs
                    : idleTimeoutMs;
                const boundedIdleTimeoutMs = (hasAssistantTextDelta && !sawToolingAfterAssistantText)
                    ? Math.max(baseIdleTimeoutMs, postAssistantIdleCompleteMs)
                    : baseIdleTimeoutMs;
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
            const isIdleOrProgressTimeoutError = /\bstream_(?:idle|progress)_timeout\b/i.test(String(error));
            const shouldBypassAssistantTextDegradedComplete = (
                (
                    sawToolingAfterAssistantText
                    && !(isTaskTurn && isIdleOrProgressTimeoutError)
                )
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
                const sanitizedFinalText = softenDecisionRefusalLanguage(finalTextEvent.content, originalMessage);
                const hasNarrativeContent = sanitizedFinalText.trim().length > 0;
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
                    assistantText += sanitizedFinalText;
                    if (hasNarrativeContent) {
                        markVisibleProgress(now);
                        shouldRefreshDeadlineFromChunk = true;
                    }
                }
                if (finalTextEvent.role === 'assistant') {
                    queueAssistantDelta(sanitizedFinalText);
                } else {
                    flushBufferedAssistantDelta(true);
                    sendToDesktop({
                        ...finalTextEvent,
                        content: sanitizedFinalText,
                    });
                }
                hasProgress = true;
            }
        }
        const event = mapMastraChunkToDesktopEvent(chunk as MastraChunkLike, runId);
        if (event) {
            if (isDuplicateToolEvent(event)) {
                continue;
            }
            if (
                (event.type === 'tool_call' || event.type === 'tool_result')
                && typeof event.toolName === 'string'
                && /\b(?:write_to_file|mastra_workspace_write_file)\b/iu.test(event.toolName)
            ) {
                requiredOutputWriteObserved = true;
            }
            let eventCountsAsVisibleProgress = false;
            let eventCountsAsOperationalProgress = false;
            const mirroredFinalSynthesisNarrative = softenDecisionRefusalLanguage(
                extractFinalSynthesisNarrativeFromEvent(event),
                originalMessage,
            );
            if (mirroredFinalSynthesisNarrative.length > 0) {
                const normalizedMirroredNarrative = mirroredFinalSynthesisNarrative.trim();
                const duplicateMirroredNarrative = normalizedMirroredNarrative === lastMirroredFinalSynthesisNarrative;
                if (!duplicateMirroredNarrative) {
                    const now = Date.now();
                    hasAssistantTextDelta = true;
                    if (firstAssistantTextAt === null) {
                        firstAssistantTextAt = now;
                    }
                    lastAssistantTextAt = now;
                    const synthesizedDelta = assistantText.trim().length > 0
                        ? `\n\n${mirroredFinalSynthesisNarrative}`
                        : mirroredFinalSynthesisNarrative;
                    assistantText += synthesizedDelta;
                    markVisibleProgress(now);
                    shouldRefreshDeadlineFromChunk = true;
                    queueAssistantDelta(synthesizedDelta);
                    eventCountsAsVisibleProgress = true;
                    eventCountsAsOperationalProgress = true;
                    hasProgress = true;
                    lastAssistantNarrativeProgressChunk = normalizedMirroredNarrative;
                    lastMirroredFinalSynthesisNarrative = normalizedMirroredNarrative;
                }
            }
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
                isTaskTurn
                && requiredOutputPaths.length > 0
                && (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'suspended')
            ) {
                const missingPaths = await collectMissingRequiredOutputPaths(requiredOutputPaths);
                if (missingPaths.length > 0) {
                    requiredOutputSatisfiedAt = null;
                    if (firstRequiredOutputMissingAt === null) {
                        firstRequiredOutputMissingAt = Date.now();
                    }
                } else {
                    firstRequiredOutputMissingAt = null;
                    if (requiredOutputSatisfiedAt === null) {
                        requiredOutputSatisfiedAt = Date.now();
                    }
                    emitRequiredOutputPresenceEvidence();
                }
            }
            if (
                !hasAssistantTextDelta
                && (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'suspended')
                && firstToolingWithoutNarrativeAt === null
            ) {
                firstToolingWithoutNarrativeAt = Date.now();
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
    flushBufferedAssistantDelta(true, true);
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
            } else {
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_exhausted',
                });
                sawCompleteEvent = true;
                terminalFinishReason = 'stream_exhausted';
            }
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
        modelId?: string;
        enabledToolpacks?: string[];
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
    const baseEffectiveMessage = buildSkillGuidedMessage(message, options?.skillPrompt);
    let effectiveMessage = baseEffectiveMessage;
    const enableAutoMemoryIntentBridge = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_AUTO_MEMORY_INTENT_BRIDGE',
        false,
    );
    const requiredOutputPaths = resolveRequiredOutputPathsForTurn(message, options?.workspacePath);
    const requiredOutputRetryBudget = (
        options?.forcedRouteMode === 'task' && requiredOutputPaths.length > 0
    )
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT', 1)
        : 0;
    let requiredOutputRetryAttempts = 0;
    let observedToolCallCount = 0;
    let observedToolResultCount = 0;

    const resolvedModelConfig = resolveRuntimeModelConfigWithPreferredModel({
        fallbackModelId: DEFAULT_MODEL_ID,
        preferredModelId: options?.modelId,
    });
    const modelId = typeof resolvedModelConfig === 'string'
        ? resolvedModelConfig
        : resolvedModelConfig.id;
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

    if (enableAutoMemoryIntentBridge && shouldAutoPersistMemoryIntent(message, options?.forcedRouteMode)) {
        const autoMemoryRunId = `auto-memory-${randomUUID()}`;
        sendToDesktop({
            type: 'tool_call',
            runId: autoMemoryRunId,
            toolName: 'remember',
            args: {
                message,
                source: 'auto_remember_intent',
            },
            turnId: options?.turnId,
        });
        try {
            const persisted = await persistAutoRememberEntry({
                workspacePath: options?.workspacePath,
                message,
            });
            sendToDesktop({
                type: 'tool_result',
                runId: autoMemoryRunId,
                toolCallId: `remember:auto:${taskId}`,
                toolName: 'remember',
                result: persisted,
                isError: false,
                turnId: options?.turnId,
            });
        } catch (memoryError) {
            sendToDesktop({
                type: 'tool_result',
                runId: autoMemoryRunId,
                toolCallId: `remember:auto:${taskId}`,
                toolName: 'remember',
                result: {
                    error: String(memoryError),
                },
                isError: true,
                turnId: options?.turnId,
            });
        }
    }

    if (enableAutoMemoryIntentBridge && shouldAutoRecallMemoryIntent(message, options?.forcedRouteMode)) {
        const autoRecallRunId = `auto-recall-${randomUUID()}`;
        sendToDesktop({
            type: 'tool_call',
            runId: autoRecallRunId,
            toolName: 'recall',
            args: {
                query: message,
                source: 'auto_recall_intent',
            },
            turnId: options?.turnId,
        });
        try {
            const recalled = await recallAutoMemoryEntries({
                workspacePath: options?.workspacePath,
                message,
            });
            sendToDesktop({
                type: 'tool_result',
                runId: autoRecallRunId,
                toolCallId: `recall:auto:${taskId}`,
                toolName: 'recall',
                result: recalled,
                isError: false,
                turnId: options?.turnId,
            });
        } catch (recallError) {
            sendToDesktop({
                type: 'tool_result',
                runId: autoRecallRunId,
                toolCallId: `recall:auto:${taskId}`,
                toolName: 'recall',
                result: {
                    error: String(recallError),
                },
                isError: true,
                turnId: options?.turnId,
            });
        }
    }

    const forcePostAssistantCompletion = options?.forcePostAssistantCompletion === true;
    const useChatLatencyProfile = forcePostAssistantCompletion && options?.forcedRouteMode !== 'task';
    const isTaskRoute = options?.forcedRouteMode === 'task';
    let useDirectChatResponder = !isTaskRoute && (
        options?.useDirectChatResponder === true
        || options?.forcedRouteMode === 'chat'
    );
    const weatherQuery = isWeatherInformationQuery(message);
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
        message,
        workspacePath: options?.workspacePath,
        explicitRequiredCapabilities: options?.requiredCompletionCapabilities,
    });
    const turnContractDomain = (options?.turnContractDomain ?? '').trim().toLowerCase();
    effectiveMessage = injectCapabilityExecutionContract({
        message: effectiveMessage,
        requiredCompletionCapabilities,
    });
    const preferResearcherForWebResearchTasks = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TASK_PREFER_RESEARCHER',
        true,
    );
    const shouldRouteTaskToResearcher = shouldRouteTaskTurnToResearcher({
        message,
        isTaskRoute,
        useDirectChatResponder,
        preferResearcherForWebResearchTasks,
        requiredCompletionCapabilities,
        requiredOutputPaths,
    });
    const selectedAgentId: 'chatResponder' | 'researcher' | 'supervisor' = useDirectChatResponder
        ? 'chatResponder'
        : (shouldRouteTaskToResearcher ? 'researcher' : 'supervisor');
    const networkDecision = shouldEnableAgentNetworkExecution({
        message: effectiveMessage,
        forcedRouteMode: options?.forcedRouteMode,
        selectedAgent: selectedAgentId,
        useDirectChatResponder,
    });
    const useAgentNetworkExecution = networkDecision.enabled;
    const shouldInjectMultiAgentExecutionContract = (
        isTaskRoute
        && selectedAgentId === 'supervisor'
        && networkDecision.signal.shouldUseMultiAgent
        && (
            // If the network path is active, keep full delegation contract behavior.
            useAgentNetworkExecution
            // In stream mode, only honor explicit multi-agent asks to avoid false positives.
            || networkDecision.signal.explicitKeyword
        )
    );
    const streamAgent = useDirectChatResponder
        ? chatResponder
        : (
            shouldRouteTaskToResearcher
                ? researcher
                : (
                    shouldInjectMultiAgentExecutionContract || useAgentNetworkExecution
                        ? supervisor
                        : supervisorSolo
                )
        );
    const delegationPlan = shouldInjectMultiAgentExecutionContract
        ? buildDelegationExecutionPlan({
            message: effectiveMessage,
            signal: networkDecision.signal,
        })
        : null;
    if (shouldInjectMultiAgentExecutionContract) {
        effectiveMessage = injectMultiAgentExecutionContract({
            message: effectiveMessage,
            signal: networkDecision.signal,
        });
        if (delegationPlan?.shouldDelegate) {
            effectiveMessage = injectDelegationPlanContract({
                message: effectiveMessage,
                plan: delegationPlan,
            });
            effectiveMessage = injectDelegationSynthesisContract({
                message: effectiveMessage,
                plan: delegationPlan,
            });
        }
    }
    console.info('[coworkany-task-route-agent]', JSON.stringify({
        taskId,
        routeMode: options?.forcedRouteMode ?? null,
        selectedAgent: selectedAgentId,
        requiredCompletionCapabilities,
        turnContractDomain: turnContractDomain || null,
        enabledToolpackCount: Array.isArray(options?.enabledToolpacks) ? options.enabledToolpacks.length : 0,
        useAgentNetworkExecution,
        multiAgentContractInjected: shouldInjectMultiAgentExecutionContract,
        delegationPlanInjected: Boolean(delegationPlan?.shouldDelegate),
        delegationWorkflowShape: delegationPlan?.workflowShape ?? null,
        delegationRoleCount: delegationPlan?.roles.length ?? 0,
        networkReason: networkDecision.reason,
        multiAgentSignalScore: networkDecision.signal.weightedScore,
    }));
    const enableGenerateFallbackForTaskRoute = resolveBooleanFromEnv(
        'COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK',
        false,
    );
    const allowGenerateFallback = !isTaskRoute || enableGenerateFallbackForTaskRoute;
    const defaultRequireToolApproval = (
        forcePostAssistantCompletion
        || shouldRouteTaskToResearcher
    )
        ? false
        : true;
    // Keep tool approval resume on the entrypoint side for deterministic ordering.
    // Mastra-side auto resume can race with terminal stream events and produce stale snapshot errors.
    const defaultAutoResumeSuspendedTools = false;
    const requireToolApproval = options?.requireToolApproval ?? defaultRequireToolApproval;
    const autoResumeSuspendedTools = options?.autoResumeSuspendedTools ?? defaultAutoResumeSuspendedTools;
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
        modelId,
        enabledToolpacks: options?.enabledToolpacks,
        enabledSkills: options?.enabledSkills,
        skillPrompt: options?.skillPrompt,
        requireToolApproval,
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
    const streamToolsets = Object.keys(dynamicToolsets).length > 0
        ? dynamicToolsets
        : undefined;
    const defaultToolCallConcurrency = shouldInjectMultiAgentExecutionContract
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_MULTI_AGENT_TOOL_CALL_CONCURRENCY', 3)
        : 1;
    const streamOptions = {
        model: resolvedModelConfig,
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        toolsets: streamToolsets,
        requireToolApproval,
        autoResumeSuspendedTools,
        toolCallConcurrency: options?.toolCallConcurrency ?? defaultToolCallConcurrency,
        maxSteps: options?.maxSteps ?? defaultMaxSteps,
        providerOptions,
    };
    const networkOptions: Record<string, unknown> = {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        autoResumeSuspendedTools,
        maxSteps: options?.maxSteps ?? defaultMaxSteps,
        routing: {
            additionalInstructions: [
                'Decompose into explicit role-owned sub-tasks before execution.',
                'Delegate independent roles in parallel when feasible, then integrate outputs with verification evidence.',
                'If delegation is used, persist role outputs in workspace artifacts when file outputs are requested.',
            ].join(' '),
        },
    };

    const useTaskLatencyProfile = options?.forcedRouteMode === 'task';
    const useTaskCapabilityLatencyProfile = (
        useTaskLatencyProfile
        && requiredCompletionCapabilities.length > 0
        && resolveBooleanFromEnv('COWORKANY_MASTRA_TASK_CAPABILITY_FAST_RECOVERY', true)
    );
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
            useTaskCapabilityLatencyProfile
                ? resolveTaskCapabilityNonNegativeInt(
                    'COWORKANY_MASTRA_TASK_STREAM_FORWARD_RETRY_COUNT',
                    1,
                    'COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT',
                    5,
                )
                : resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT', 5)
        );
    const forwardRetryDelayMs = resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS', 1_000);
    const noNarrativeRetryCount = useChatLatencyProfile
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_NO_NARRATIVE_RETRY_COUNT', 1)
        : (
            useTaskCapabilityLatencyProfile
                ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_TASK_NO_NARRATIVE_RETRY_COUNT', 1)
                : resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT', 1)
        );
    const debugStreamRecovery = process.env.COWORKANY_DEBUG_STREAM_RECOVERY === '1';
    const startRetryCount = useChatLatencyProfile
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT', 5)
        : (
            useTaskCapabilityLatencyProfile
                ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_TASK_STREAM_START_RETRY_COUNT', 0)
                : undefined
        );
    const startRetryDelayMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS', 1_000)
        : (
            useTaskCapabilityLatencyProfile
                ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_TASK_STREAM_START_RETRY_DELAY_MS', 500)
                : undefined
        );
    const startTimeoutMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS', 12_000)
        : (
            useTaskCapabilityLatencyProfile
                ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_TASK_STREAM_START_TIMEOUT_MS', 12_000)
                : undefined
        );

    const fallbackToGenerateOnStartTimeout = resolveBooleanFromEnv('COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK', true);
    const generateFallbackTimeoutMs = useChatLatencyProfile
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS', 30_000)
        : (
            useTaskCapabilityLatencyProfile
                ? (
                    // Output-constrained task turns should converge quickly enough for
                    // desktop GUI waits while preserving a configurable override.
                    requiredOutputPaths.length > 0
                        ? resolvePositiveIntFromEnv(
                            'COWORKANY_MASTRA_TASK_REQUIRED_OUTPUT_GENERATE_FALLBACK_TIMEOUT_MS',
                            25_000,
                        )
                        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_TASK_GENERATE_FALLBACK_TIMEOUT_MS', 90_000)
                )
                : resolvePositiveIntFromEnv('COWORKANY_MASTRA_GENERATE_FALLBACK_TIMEOUT_MS', 90_000)
        );
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
    const finalizeTaskWorkspaceArtifacts = async (assistantText: string): Promise<void> => {
        const workspacePath = typeof options?.workspacePath === 'string'
            ? options.workspacePath.trim()
            : '';
        if (options?.forcedRouteMode !== 'task' || workspacePath.length === 0) {
            return;
        }
        if (
            requiredOutputPaths.length > 0
            && resolveBooleanFromEnv('COWORKANY_MASTRA_TASK_PLACEHOLDER_SANITIZE', true)
        ) {
            try {
                const workspacePathForSanitize = resolvePlaceholderSanitizeWorkspacePath({
                    workspacePath,
                    requiredOutputPaths,
                });
                const sanitizedFiles = await sanitizePlaceholderSupportFiles({
                    workspacePath: workspacePathForSanitize,
                    requiredOutputPaths,
                });
                if (sanitizedFiles.length > 0) {
                    console.info('[coworkany-task-placeholder-sanitize]', JSON.stringify({
                        taskId,
                        sanitizedFiles,
                    }));
                }
            } catch (error) {
                console.warn('[coworkany-task-placeholder-sanitize] failed:', error);
            }
        }
        if (resolveBooleanFromEnv('COWORKANY_MASTRA_TASK_AUTO_OUTPUT_FALLBACK', false)) {
            try {
                const fallbackOutputPath = await ensureTaskFallbackOutputFile({
                    workspacePath,
                    requiredOutputPaths,
                    assistantText,
                });
                if (fallbackOutputPath) {
                    console.info('[coworkany-task-fallback-output]', JSON.stringify({
                        taskId,
                        fallbackOutputPath,
                    }));
                }
            } catch (error) {
                console.warn('[coworkany-task-fallback-output] failed:', error);
            }
        }
        if (resolveBooleanFromEnv('COWORKANY_MASTRA_TASK_CLEAN_TRANSIENT_ARTIFACTS', true)) {
            try {
                const removedArtifacts = await cleanupTransientWorkspaceArtifacts({
                    workspacePath,
                    requiredOutputPaths,
                });
                if (removedArtifacts.length > 0) {
                    console.info('[coworkany-task-transient-artifacts-cleanup]', JSON.stringify({
                        taskId,
                        removedArtifacts,
                    }));
                }
            } catch (error) {
                console.warn('[coworkany-task-transient-artifacts-cleanup] failed:', error);
            }
        }
    };
    const emitMaterializedOutputEvidence = (input: {
        runId: string;
        outputPaths: string[];
    }): void => {
        for (const outputPath of input.outputPaths) {
            const materializedRunId = `${input.runId}:materialized:${randomUUID()}`;
            sendToDesktop({
                type: 'tool_call',
                runId: materializedRunId,
                toolName: 'write_to_file',
                args: {
                    path: outputPath,
                    source: 'required_output_materializer',
                },
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'tool_result',
                runId: materializedRunId,
                toolCallId: `write_to_file:materialized:${taskId}:${randomUUID()}`,
                toolName: 'write_to_file',
                result: {
                    path: outputPath,
                    source: 'required_output_materializer',
                    materialized: true,
                },
                isError: false,
                turnId: options?.turnId,
            });
        }
    };
    const buildEmergencyTaskFallbackSummary = (input: {
        reason: string;
    }): string | null => {
        if (options?.forcedRouteMode !== 'task') {
            return null;
        }
        const clippedRequest = message.trim().replace(/\s+/gu, ' ').slice(0, 1200);
        const lines: string[] = [
            '# 执行降级交付（超时保护）',
            '',
            '上游模型在最终综合阶段超时。为避免任务挂起，系统基于已完成工具执行给出最佳努力交付，请在关键决策前复核原始数据。',
            '',
            `原始请求：${clippedRequest}`,
            '',
            `已完成工具进度：tool_call ${observedToolCallCount} 次，tool_result ${observedToolResultCount} 次。`,
        ];
        if (requiredCompletionCapabilities.includes('web_research')) {
            lines.push('- 已执行网络检索并收集外部证据，请复核来源时效与口径一致性。');
        }
        if (requiredCompletionCapabilities.includes('artifact_write')) {
            lines.push('- 已按任务要求准备交付文件。');
        }
        if (isMarketDataResearchQuery(message)) {
            lines.push('- 市场类任务建议采用 buy/sell/hold 三档结论，并明确 risk、valuation、P/E、revenue、quarter 指标。');
        }
        if (requiredOutputPaths.length > 0) {
            lines.push('', '交付路径：');
            for (const outputPath of requiredOutputPaths) {
                lines.push(`- ${outputPath}`);
            }
        }
        lines.push(
            '',
            `降级原因：${input.reason}`,
            '建议：可直接重试本任务，或把请求拆分为“检索 -> 分析 -> 写入文件”三步以提升稳定性。',
        );
        const summary = lines.join('\n').trim();
        return summary.length > 0 ? summary : null;
    };
    const runGenerateFallback = async (
        reason: string,
        attemptNumber: number,
        maxAttempts: number,
        fallbackOptions?: {
            force?: boolean;
            includeStartupBudget?: boolean;
            messageOverride?: string;
            disableTools?: boolean;
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
            // Task-mode forced fallback is the final recovery path after stream/tooling timeout.
            // Do not block it on startup/turn budgets that may already be consumed by stream cleanup.
            const bypassExecutionBudgetForForcedTaskFallback = (
                fallbackOptions?.force === true
                && options?.forcedRouteMode === 'task'
            );
            const fallbackDeadlineAt = bypassExecutionBudgetForForcedTaskFallback
                ? undefined
                : resolveEarliestDeadline([
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
            const fallbackMessage = typeof fallbackOptions?.messageOverride === 'string'
                && fallbackOptions.messageOverride.trim().length > 0
                ? fallbackOptions.messageOverride
                : effectiveMessage;
            const fallbackAgent = fallbackOptions?.disableTools === true
                ? taskSynthesizer
                : streamAgent;
            const fallbackStreamOptions = fallbackOptions?.disableTools === true
                ? {
                    ...streamOptions,
                    toolsets: undefined,
                    maxSteps: 1,
                    requireToolApproval: false,
                    autoResumeSuspendedTools: false,
                }
                : streamOptions;
            const generated = await Promise.race([
                fallbackAgent.generate(fallbackMessage, fallbackStreamOptions),
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
                modelId,
                traceId: telemetry.traceId,
                traceSampled: telemetry.sampled,
                executionMode: 'stream',
            });

            if (generated.error) {
                throw generated.error;
            }

            const rawGeneratedText = typeof generated.text === 'string' ? generated.text.trim() : '';
            const generatedText = isInternalCompletionCheckNarrative(rawGeneratedText)
                ? ''
                : softenDecisionRefusalLanguage(rawGeneratedText, message);
            if (generatedText.length > 0) {
                const fallbackMaterializedOutputs = await materializeMissingRequiredOutputFiles({
                    requiredOutputPaths,
                    assistantText: generatedText,
                });
                if (fallbackMaterializedOutputs.length > 0) {
                    emitMaterializedOutputEvidence({
                        runId: fallbackRunId,
                        outputPaths: fallbackMaterializedOutputs,
                    });
                    console.info('[coworkany-task-fallback-output-materialized]', JSON.stringify({
                        taskId,
                        outputs: fallbackMaterializedOutputs,
                    }));
                }
                sendToDesktop({
                    type: 'text_delta',
                    runId: fallbackRunId,
                    role: 'assistant',
                    content: generatedText,
                    turnId: options?.turnId,
                });
                if (fallbackOptions?.disableTools === true) {
                    sendToDesktop({
                        type: 'tool_result',
                        runId: fallbackRunId,
                        toolCallId: `final_synthesis:${taskId}`,
                        toolName: 'final_synthesis',
                        result: generatedText,
                        isError: false,
                        turnId: options?.turnId,
                    });
                }
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
                // Give downstream event consumers one tick to process fallback text
                // before terminal completion is emitted.
                await delay(25);
            } else {
                flushPostCompactWithPromptPack();
            }
            await finalizeTaskWorkspaceArtifacts(generatedText);
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
            const emergencySummary = buildEmergencyTaskFallbackSummary({
                reason: String(fallbackError),
            });
            if (emergencySummary) {
                const emergencyRunId = `task-emergency-fallback-${randomUUID()}`;
                cacheRunContext(emergencyRunId, {
                    threadId,
                    resourceId,
                    taskId,
                    turnId: options?.turnId,
                    workspacePath: options?.workspacePath,
                    enabledSkills: options?.enabledSkills,
                    skillPrompt: options?.skillPrompt,
                    modelId,
                    traceId: telemetry.traceId,
                    traceSampled: telemetry.sampled,
                    executionMode: 'stream',
                });
                const emergencyMaterializedOutputs = await materializeMissingRequiredOutputFiles({
                    requiredOutputPaths,
                    assistantText: emergencySummary,
                });
                if (emergencyMaterializedOutputs.length > 0) {
                    emitMaterializedOutputEvidence({
                        runId: emergencyRunId,
                        outputPaths: emergencyMaterializedOutputs,
                    });
                    console.info('[coworkany-task-emergency-output-materialized]', JSON.stringify({
                        taskId,
                        outputs: emergencyMaterializedOutputs,
                    }));
                }
                sendToDesktop({
                    type: 'text_delta',
                    runId: emergencyRunId,
                    role: 'assistant',
                    content: emergencySummary,
                    turnId: options?.turnId,
                });
                if (fallbackOptions?.disableTools === true) {
                    sendToDesktop({
                        type: 'tool_result',
                        runId: emergencyRunId,
                        toolCallId: `final_synthesis:${taskId}:emergency`,
                        toolName: 'final_synthesis',
                        result: emergencySummary,
                        isError: false,
                        turnId: options?.turnId,
                    });
                }
                const updated = contextCompressionStore.recordAssistantTurn({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    content: emergencySummary,
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
                await finalizeTaskWorkspaceArtifacts(emergencySummary);
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
                    assistantChars: emergencySummary.length,
                    finishReason: 'fallback_emergency_synthesis',
                    error: fallbackError,
                    timings: buildTimingSnapshot({
                        startedAt: Date.now(),
                        streamReadyAt: null,
                        firstTokenAt: Date.now(),
                        lastTokenAt: Date.now(),
                    }),
                    proxyBefore: proxySnapshotBeforeDisable,
                    proxyAfter: proxySnapshotAfterDisable,
                });
                sendToDesktop({
                    type: 'complete',
                    runId: emergencyRunId,
                    finishReason: 'fallback_emergency_synthesis',
                    turnId: options?.turnId,
                });
                return { runId: emergencyRunId };
            }
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
        let stream: RuntimeStreamLike;
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
                        enabledToolpacks: options?.enabledToolpacks,
                        allowDelegatedAgentTools: shouldInjectMultiAgentExecutionContract || useAgentNetworkExecution,
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
        const networkOptionsForAttempt: Record<string, unknown> = {
            ...networkOptions,
            maxSteps: streamOptionsForAttempt.maxSteps,
            autoResumeSuspendedTools: streamOptionsForAttempt.autoResumeSuspendedTools,
        };
        try {
            stream = await withStartRetries(async () => {
                if (useAgentNetworkExecution) {
                    const networkStream = await (
                        supervisor.network as unknown as (
                            prompt: string,
                            options: Record<string, unknown>,
                        ) => Promise<RuntimeNetworkStream>
                    )(effectiveMessage, networkOptionsForAttempt);
                    return networkStream as RuntimeStreamLike;
                }
                const modelStream = await (
                    streamAgent.stream as unknown as (
                        prompt: string,
                        options: Record<string, unknown>,
                    ) => Promise<RuntimeModelStream>
                )(effectiveMessage, streamOptionsForAttempt as unknown as Record<string, unknown>);
                return modelStream as RuntimeStreamLike;
            }, {
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
            modelId,
            traceId: telemetry.traceId,
            traceSampled: telemetry.sampled,
            executionMode: useAgentNetworkExecution ? 'network' : 'stream',
        });
        let emittedAssistantText = false;
        let emittedAssistantCharCount = 0;
        let emittedAssistantTextSnapshot = '';
        let emittedToolingProgress = false;
        let emittedAnyStreamEvent = false;
        let deferredTaskCompleteEvent: DesktopEvent | null = null;
        const flushDeferredTaskCompleteEvent = (): void => {
            if (!deferredTaskCompleteEvent) {
                return;
            }
            sendToDesktop(deferredTaskCompleteEvent);
            deferredTaskCompleteEvent = null;
        };
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
                emittedAssistantTextSnapshot += event.content;
                if (emittedAssistantTextSnapshot.length > 12_000) {
                    emittedAssistantTextSnapshot = emittedAssistantTextSnapshot.slice(-12_000);
                }
            }
            if (
                event.type === 'tool_call'
                || event.type === 'tool_result'
                || event.type === 'approval_required'
                || event.type === 'suspended'
            ) {
                emittedToolingProgress = true;
            }
            if (event.type === 'tool_call') {
                observedToolCallCount += 1;
            } else if (event.type === 'tool_result') {
                observedToolResultCount += 1;
            }
            const eventWithTurnId = options?.turnId && !event.turnId
                ? { ...event, turnId: options.turnId }
                : event;
            if (eventWithTurnId.type === 'complete' && options?.forcedRouteMode === 'task') {
                deferredTaskCompleteEvent = eventWithTurnId;
                return;
            }
            sendToDesktop(eventWithTurnId);
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
                requiredOutputPaths,
                originalMessage: message,
            });
            const assistantTextTrimmed = forwarded.assistantText.trim();
            const assistantPrefaceWithinRetryBound = (
                assistantTextTrimmed.length > 0
                && assistantTextTrimmed.length <= 120
            );
            const isTaskToolingAssistantIdleInterruption = (
                options?.forcedRouteMode === 'task'
                && emittedToolingProgress
                && forwarded.finishReason === 'assistant_text_idle'
                && assistantPrefaceWithinRetryBound
            );
            const canRetryTaskToolingAssistantIdleInterruption = (
                isTaskToolingAssistantIdleInterruption
                && attempt < Math.min(forwardRetryCount, 1)
            );
            if (canRetryTaskToolingAssistantIdleInterruption) {
                attempt += 1;
                const maxAttempts = forwardRetryCount + 1;
                emitRateLimited({
                    runId: stream.runId,
                    attempt: attempt + 1,
                    maxAttempts,
                    retryAfterMs: forwardRetryDelayMs,
                    error: 'assistant_text_idle_after_tooling_progress',
                    message: `Tool execution interrupted after assistant preface. Retrying (${attempt + 1}/${maxAttempts})...`,
                    stage: 'last_token',
                    timings: forwarded.timings,
                    turnId: options?.turnId,
                });
                await delay(forwardRetryDelayMs * attempt);
                continue;
            }
            if (isTaskToolingAssistantIdleInterruption) {
                deferredTaskCompleteEvent = null;
                const fallbackResult = await runGenerateFallback(
                    'assistant_text_idle_after_tooling_progress',
                    attempt + 1,
                    forwardRetryCount + 1,
                    {
                        force: true,
                        includeStartupBudget: false,
                    },
                );
                if (fallbackResult) {
                    return fallbackResult;
                }
            }
            const missingRequiredOutputPaths = await collectMissingRequiredOutputPaths(requiredOutputPaths);
            if (missingRequiredOutputPaths.length > 0) {
                deferredTaskCompleteEvent = null;
                const canRetryRequiredOutputs = (
                    requiredOutputRetryAttempts < requiredOutputRetryBudget
                    && attempt < forwardRetryCount
                );
                if (canRetryRequiredOutputs) {
                    requiredOutputRetryAttempts += 1;
                    attempt += 1;
                    const maxAttempts = forwardRetryCount + 1;
                    emitRateLimited({
                        runId: stream.runId,
                        attempt: attempt + 1,
                        maxAttempts,
                        retryAfterMs: forwardRetryDelayMs,
                        error: `missing_required_output_files:${missingRequiredOutputPaths.join(',')}`,
                        message: `Required output file missing. Retrying (${attempt + 1}/${maxAttempts})...`,
                        stage: 'unknown',
                        timings: forwarded.timings,
                        turnId: options?.turnId,
                    });
                    effectiveMessage = buildMissingOutputPathsReminder(baseEffectiveMessage, missingRequiredOutputPaths);
                    await delay(forwardRetryDelayMs * attempt);
                    continue;
                }
                const materializedOutputs = await materializeMissingRequiredOutputFiles({
                    requiredOutputPaths: missingRequiredOutputPaths,
                    assistantText: forwarded.assistantText,
                });
                if (materializedOutputs.length > 0) {
                    const remainingMissingOutputPaths = await collectMissingRequiredOutputPaths(requiredOutputPaths);
                    if (remainingMissingOutputPaths.length === 0) {
                        emitMaterializedOutputEvidence({
                            runId: stream.runId,
                            outputPaths: materializedOutputs,
                        });
                        console.info('[coworkany-task-output-materialized]', JSON.stringify({
                            taskId,
                            outputs: materializedOutputs,
                        }));
                    } else {
                        sendToDesktop({
                            type: 'error',
                            runId: stream.runId,
                            message: `missing_required_output_files:${remainingMissingOutputPaths.join(',')}`,
                            turnId: options?.turnId,
                        });
                        return { runId: stream.runId };
                    }
                } else {
                    sendToDesktop({
                        type: 'error',
                        runId: stream.runId,
                        message: `missing_required_output_files:${missingRequiredOutputPaths.join(',')}`,
                        turnId: options?.turnId,
                    });
                    return { runId: stream.runId };
                }
            }
            const forceFinalSynthesisDecision = shouldForceTaskFinalSynthesis({
                routeMode: options?.forcedRouteMode,
                finishReason: forwarded.finishReason,
                emittedToolingProgress,
                assistantText: forwarded.assistantText,
                requiredCompletionCapabilities,
            });
            if (debugStreamRecovery && options?.forcedRouteMode === 'task') {
                console.warn('[streaming][task-final-synthesis-check]', {
                    finishReason: forwarded.finishReason ?? null,
                    emittedToolingProgress,
                    assistantChars: forwarded.assistantText.trim().length,
                    requiredCompletionCapabilities,
                    decision: forceFinalSynthesisDecision,
                });
            }
            if (forceFinalSynthesisDecision.shouldForce) {
                deferredTaskCompleteEvent = null;
                const fallbackResult = await runGenerateFallback(
                    forceFinalSynthesisDecision.reason,
                    attempt + 1,
                    forwardRetryCount + 1,
                    {
                        force: true,
                        includeStartupBudget: false,
                        disableTools: true,
                        messageOverride: buildFinalSynthesisContractMessage(
                            baseEffectiveMessage,
                            requiredCompletionCapabilities,
                        ),
                    },
                );
                if (fallbackResult) {
                    return fallbackResult;
                }
            }
            await finalizeTaskWorkspaceArtifacts(forwarded.assistantText);
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
            flushDeferredTaskCompleteEvent();
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
            const isRequiredOutputStreamTimeout = isRequiredOutputStreamTimeoutError(error);
            const missingRequiredOutputPathsAfterTimeout = (
                options?.forcedRouteMode === 'task'
                && requiredOutputPaths.length > 0
            )
                ? await collectMissingRequiredOutputPaths(requiredOutputPaths)
                : [];
            const likelyAssistantPrefaceBeforeToolingFailure = emittedAssistantText || (
                emittedToolingProgress
                && (isSnapshotLossAfterTooling || isMissingTerminalAfterTooling || isStreamExecutionTimeoutAfterTooling)
            );
            const assistantPrefaceWithinRetryBound = emittedAssistantText
                ? emittedAssistantCharCount > 0 && emittedAssistantCharCount <= 120
                : likelyAssistantPrefaceBeforeToolingFailure;
            const toolingInterruptionRetryBudget = (isMissingTerminalAfterTooling || isStreamExecutionTimeoutAfterTooling)
                ? Math.min(forwardRetryCount, 1)
                : forwardRetryCount;
            const canRetryTaskToolingInterruption = (
                options?.forcedRouteMode === 'task'
                && likelyAssistantPrefaceBeforeToolingFailure
                && emittedToolingProgress
                && assistantPrefaceWithinRetryBound
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && attempt < toolingInterruptionRetryBudget
                && (isSnapshotLossAfterTooling || isMissingTerminalAfterTooling || isStreamExecutionTimeoutAfterTooling)
            );
            const canRetryRequiredOutputTimeout = (
                options?.forcedRouteMode === 'task'
                && isRequiredOutputStreamTimeout
                && emittedAssistantText === false
                && emittedToolingProgress
                && missingRequiredOutputPathsAfterTimeout.length > 0
                && requiredOutputRetryAttempts < requiredOutputRetryBudget
                && attempt < forwardRetryCount
            );
            const canRetry = (
                attempt < forwardRetryCount
                && isRetryableForwardError(error)
                && emittedAssistantText === false
                && !hasTaskToolingProgressWithoutNarrative
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
                && !noNarrativeCompletionError
            ) || canRetryNoNarrative || canRetryTaskToolingInterruption || canRetryTaskToolingNoNarrative || canRetryRequiredOutputTimeout;
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
                && likelyAssistantPrefaceBeforeToolingFailure
                && assistantPrefaceWithinRetryBound
                && isStreamExecutionTimeoutAfterTooling
                && !isTurnBudgetTimeoutError(error)
                && !isStartupBudgetTimeoutError(error)
            );
            const shouldTryGenerateFallbackForAttempt = (
                (shouldTryGenerateFallback && allowGenerateFallback)
                || shouldForceTaskNoNarrativeTimeoutFallback
                || shouldForceTaskToolingTimeoutFallback
            );
            const canFinalizeRequiredOutputTimeoutByMaterialization = (
                options?.forcedRouteMode === 'task'
                && (
                    isRequiredOutputStreamTimeout
                    || isStreamExecutionTimeoutAfterTooling
                    || isMissingTerminalAfterTooling
                    || isSnapshotLossAfterTooling
                )
                && missingRequiredOutputPathsAfterTimeout.length > 0
                && (emittedAssistantText || emittedToolingProgress)
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
                    canFinalizeRequiredOutputTimeoutByMaterialization,
                    fallbackEnabled: fallbackToGenerateOnStartTimeout,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (canFinalizeRequiredOutputTimeoutByMaterialization) {
                const fallbackNarrative = emittedAssistantTextSnapshot.trim().length > 0
                    ? emittedAssistantTextSnapshot.trim()
                    : buildEmergencyTaskFallbackSummary({
                        reason: String(error),
                    });
                if (fallbackNarrative) {
                    const materializedOutputs = await materializeMissingRequiredOutputFiles({
                        requiredOutputPaths: missingRequiredOutputPathsAfterTimeout,
                        assistantText: fallbackNarrative,
                    });
                    if (materializedOutputs.length > 0) {
                        const remainingMissingOutputPaths = await collectMissingRequiredOutputPaths(requiredOutputPaths);
                        if (remainingMissingOutputPaths.length === 0) {
                            emitMaterializedOutputEvidence({
                                runId: stream.runId,
                                outputPaths: materializedOutputs,
                            });
                            await finalizeTaskWorkspaceArtifacts(fallbackNarrative);
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
                                assistantChars: emittedAssistantCharCount,
                                finishReason: 'required_output_timeout_materialized',
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
                            if (deferredTaskCompleteEvent) {
                                flushDeferredTaskCompleteEvent();
                            } else {
                                sendToDesktop({
                                    type: 'complete',
                                    runId: stream.runId,
                                    finishReason: 'required_output_timeout_materialized',
                                    turnId: options?.turnId,
                                });
                            }
                            return { runId: stream.runId };
                        }
                    }
                }
            }
            if (canRetry) {
                if (canRetryRequiredOutputTimeout) {
                    requiredOutputRetryAttempts += 1;
                    effectiveMessage = buildMissingOutputPathsReminder(
                        baseEffectiveMessage,
                        missingRequiredOutputPathsAfterTimeout,
                    );
                }
                attempt += 1;
                const maxAttempts = forwardRetryCount + 1;
                emitRateLimited({
                    runId: stream.runId,
                    attempt: attempt + 1,
                    maxAttempts,
                    retryAfterMs: forwardRetryDelayMs,
                    error: canRetryRequiredOutputTimeout
                        ? `stream_required_output_timeout_missing_files:${missingRequiredOutputPathsAfterTimeout.join(',')}`
                        : error,
                    message: canRetryNoNarrative
                        ? `Model returned no assistant narrative. Retrying (${attempt + 1}/${maxAttempts})...`
                        : canRetryTaskToolingInterruption
                            ? `Tool execution interrupted after assistant preface. Retrying (${attempt + 1}/${maxAttempts})...`
                            : canRetryTaskToolingNoNarrative
                                ? `Tool execution produced no assistant narrative. Retrying (${attempt + 1}/${maxAttempts})...`
                            : canRetryRequiredOutputTimeout
                                ? `Required output files are still missing after tooling timeout. Retrying (${attempt + 1}/${maxAttempts})...`
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
        executionMode: 'stream' | 'network';
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
                    modelId: context.modelId,
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
            executionMode: context?.executionMode ?? 'stream',
        };
    };
    let effectiveRunId = runId;
    let stream: RuntimeStreamLike | null = null;
    const startApprovalStream = async (approvalRunId: string): Promise<RuntimeStreamLike> => {
        const baseOptions = buildApprovalStartOptions(approvalRunId);
        if (baseOptions.executionMode === 'network') {
            const networkOptions = {
                runId: baseOptions.runId,
                requestContext: baseOptions.requestContext,
                memory: baseOptions.memory,
                tracingOptions: baseOptions.tracingOptions,
            };
            return approved
                ? await withStartRetries(async () => await supervisor.approveNetworkToolCall(networkOptions)) as RuntimeStreamLike
                : await withStartRetries(async () => await supervisor.declineNetworkToolCall(networkOptions)) as RuntimeStreamLike;
        }
        const streamOptions = {
            runId: baseOptions.runId,
            toolCallId: baseOptions.toolCallId,
            requestContext: baseOptions.requestContext,
            memory: baseOptions.memory,
            tracingOptions: baseOptions.tracingOptions,
        };
        return approved
            ? await withStartRetries(async () => await supervisor.approveToolCall(streamOptions)) as RuntimeStreamLike
            : await withStartRetries(async () => await supervisor.declineToolCall(streamOptions)) as RuntimeStreamLike;
    };
    try {
        stream = await startApprovalStream(runId);
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
            try {
                stream = await startApprovalStream(fallbackRunId);
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
        await forwardStream(stream, sendWithRunContextCleanup(effectiveRunId, sendToDesktop), {
            originalMessage: undefined,
        });
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
