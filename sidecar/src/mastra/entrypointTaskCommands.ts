import type { TaskRuntimeExecutionPath, TaskRuntimeRetryState, TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';
import { analyzeWorkRequest } from '../orchestration/workRequestAnalyzer';
import { parseRoutedInput } from '../orchestration/routedInput';
import {
    buildTaskMessageDispatchKey,
    buildTaskTurnContract,
    formatTaskCapabilityRequirement,
    normalizeResolvedAttachmentsMessage,
    resolveTaskCapabilityRequirements as resolveTaskCapabilityRequirementsFromRegistry,
    type TaskCapabilityRequirement,
} from './capabilityRegistry';

type UserMessageExecutionOptions = {
    modelId?: string;
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    skillPrompt?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
    toolCallConcurrency?: number;
    maxSteps?: number;
    executionPath?: 'direct' | 'workflow';
    forcedRouteMode?: 'chat' | 'task';
    useDirectChatResponder?: boolean;
    forcePostAssistantCompletion?: boolean;
    requireToolEvidenceForCompletion?: boolean;
    requiredCompletionCapabilities?: string[];
    turnContractHash?: string;
    turnContractDomain?: string;
};

type StartOrSendCommandType = 'start_task' | 'send_task_message' | 'send_subagent_message';

type TaskStartedMode = 'chat' | 'immediate_task' | 'scheduled_task';

type RuntimeCapabilitySkill = {
    id: string;
    name?: string;
    enabled: boolean;
    description?: string;
};

type RuntimeCapabilityToolpack = {
    id: string;
    name?: string;
    enabled: boolean;
    description?: string;
    tools?: string[];
    runtimeStatus?: 'disabled' | 'configured_only' | 'configured' | 'resolved' | 'callable' | 'blocked';
    callableToolCount?: number;
    unresolvedTools?: string[];
    blockedReason?: string;
};

type RuntimeCapabilitySnapshot = {
    skills: RuntimeCapabilitySkill[];
    toolpacks: RuntimeCapabilityToolpack[];
};

type RuntimeToolsetMap = Record<string, Record<string, unknown>>;
type RuntimeMcpSnapshot = {
    enabled: boolean;
    status: 'disabled' | 'idle' | 'ready' | 'degraded';
    cachedToolCount: number;
    cachedToolsetCount: number;
    allowedServerCount?: number;
    runtimeToolCount?: number;
};


type TaskCapabilityGateResult = {
    ready: boolean;
    requirements: TaskCapabilityRequirement[];
    summary?: string;
};

type ExecutionForcedRouteMode = NonNullable<UserMessageExecutionOptions['forcedRouteMode']>;

type TaskTranscriptHistoryEntry = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

type HandleStartOrSendTaskCommandInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    pickStringConfigValue: (config: Record<string, unknown>, key: string) => string | undefined;
    pickStringArrayConfigValue: (config: Record<string, unknown>, key: string) => string[] | undefined;
    pickTaskRuntimeRetryConfig: (config: Record<string, unknown>) => TaskRuntimeRetryState | undefined;
    pickBooleanConfigValue: (config: Record<string, unknown>, key: string) => boolean | undefined;
    pickPositiveIntegerConfigValue: (
        config: Record<string, unknown>,
        key: string,
        min: number,
        max: number,
    ) => number | undefined;
    pickTaskExecutionPath: (config: Record<string, unknown>) => 'direct' | 'workflow' | undefined;
    toUserMessageExecutionPath: (path?: TaskRuntimeExecutionPath) => 'direct' | 'workflow';
    resolveSkillPrompt?: (input: {
        message: string;
        workspacePath: string;
        explicitEnabledSkills?: string[];
    }) => {
        prompt?: string;
        enabledSkillIds: string[];
    };
    listRuntimeCapabilities?: () => RuntimeCapabilitySnapshot | Promise<RuntimeCapabilitySnapshot>;
    listRuntimeToolsets?: () => RuntimeToolsetMap | Promise<RuntimeToolsetMap>;
    isRuntimeMcpEnabled?: () => boolean;
    getRuntimeMcpSnapshot?: () => RuntimeMcpSnapshot;
    resolveTaskResourceId: (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ) => string;
    upsertTaskState: (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ) => TaskRuntimeState;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
    listTaskTranscriptEntries?: (taskId: string, limit?: number) => TaskTranscriptHistoryEntry[];
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'task_command' | 'forward_command' | 'approval_result';
        commandType?: string;
        taskId?: string;
        source: string;
        payload?: Record<string, unknown>;
        approved?: boolean;
    }) => {
        allowed: boolean;
        reason: string;
        ruleId: string;
    };
    emitCurrentInvalidPayload: (extra?: Record<string, unknown>) => void;
    emitCurrent: (responsePayload: Record<string, unknown>) => void;
    emitFor: (type: string, responsePayload: Record<string, unknown>) => void;
    emitHookEvent: (
        type: 'SessionStart' | 'TaskCreated' | 'RemoteSessionLinked' | 'ChannelEventInjected' | 'PermissionRequest' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'TaskCompleted' | 'TaskFailed' | 'TaskRewound',
        event: {
            taskId?: string;
            runId?: string;
            traceId?: string;
            payload?: Record<string, unknown>;
        },
    ) => void;
    emitTaskStarted: (input: {
        taskId: string;
        title: string;
        message: string;
        workspacePath: string;
        mode: TaskStartedMode;
        scheduled?: boolean;
        turnId?: string;
    }) => void;
    emitTaskSummary: (input: {
        taskId: string;
        summary: string;
        finishReason: string;
        turnId?: string;
    }) => void;
    enqueueTaskExecution: (input: {
        taskId: string;
        turnId: string;
        run: () => Promise<TaskRuntimeExecutionPath>;
    }) => {
        queuePosition: number;
        completion: Promise<TaskRuntimeExecutionPath>;
    };
    executeTaskMessage: (input: {
        taskId: string;
        turnId: string;
        message: string;
        resourceId: string;
        preferredThreadId: string;
        workspacePath?: string;
        executionOptions?: UserMessageExecutionOptions;
    }) => Promise<TaskRuntimeExecutionPath>;
    isScheduledCancellationRequest: (text: string) => boolean;
    scheduleTaskIfNeeded?: (input: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }) => Promise<{
        scheduled: boolean;
        summary?: string;
        error?: string;
    }>;
    cancelScheduledTasksForSourceTask?: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
    claimTaskMessageDispatch?: (input: {
        taskId: string;
        message: string;
        dedupeKey?: string;
    }) => {
        deduplicated: boolean;
        reason?: 'in_flight';
        token?: {
            taskId: string;
            fingerprint: string;
        };
    };
    completeTaskMessageDispatch?: (input: {
        taskId: string;
        fingerprint: string;
    }) => void;
};

function isStartOrSendCommandType(commandType: string): commandType is StartOrSendCommandType {
    return (
        commandType === 'start_task'
        || commandType === 'send_task_message'
        || commandType === 'send_subagent_message'
    );
}

const EXPLICIT_SCHEDULE_PREFIX = /^(?:创建|新建)?定时任务[：:\s,，、-]*/u;
const EXPLICIT_ROUTE_COMMAND_PATTERN = /^\s*\/(?:ask|task|schedule)\b/iu;
const HIGH_RISK_HOST_ACTION_PATTERN = /\b(shutdown|reboot|poweroff|halt)\b|关机|重启/u;
const SPACED_ABSOLUTE_TIME_PATTERN = /(?:今天|明天|后天)?\s*(?:凌晨|早上|上午|中午|下午|晚上)?\s*[零〇一二两兩三四五六七八九十\d]{1,3}\s*点/u;
const DATABASE_OPERATION_PATTERN = /(连接(?:到)?数据库|数据库.*(?:查询|执行)|\b(?:mysql|postgres(?:ql)?|sqlite|database)\b|(?:select|insert|update|delete)\s+.+\s+from)/iu;
const SKILL_QUERY_SUBJECT_PATTERN = /\bskills?\b|技能|skill/iu;
const TOOL_QUERY_SUBJECT_PATTERN = /\btools?\b|\btoolpacks?\b|工具|toolpack/iu;
const CAPABILITY_QUERY_HINT_PATTERN = /[?？]|哪些|什么|列表|列出|有哪些|支持|可用|是否|能否|查看|当前|show|list|available|what|which|can\s+(?:use|call)/iu;
const CAPABILITY_QUERY_SHORT_PATTERN = /^\s*(?:skills?|tools?|toolpacks?|技能|工具)\s*[?？]?\s*$/iu;
const CAPABILITY_EXPLAIN_HINT_PATTERN = /说明|介绍|解释|用途|作用|怎么用|如何用|详情|明细|逐个|分别|含义|describe|explain|usage|what\s+is|what\s+does|tell\s+me\s+about/iu;
const CAPABILITY_REFERENCE_HINT_PATTERN = /\b(these|those|them)\b|这些|上述|以上|它们/u;
const GENERAL_CAPABILITY_QUERY_PATTERN = /你(?:能|可)做什么|你会什么|能帮我做什么|可以帮我做什么|what\s+can\s+you\s+do|what\s+are\s+you\s+capable\s+of|your\s+capabilities/iu;
const WEB_RESEARCH_AVAILABLE_TOOL_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|websearch|lookup|research)\b|股|行情|涨跌|天气|新闻|资讯|预报|查询|检索/iu;
const BROWSER_AVAILABLE_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill|crawl_url|extract_content|open_in_browser)\b/iu;
const VOICE_OUTPUT_AVAILABLE_TOOL_PATTERN = /\b(voice_speak|tts|text[-\s]?to[-\s]?speech|read[_\s-]?aloud|speak)\b|语音|朗读|播报/iu;
const FILESYSTEM_READ_AVAILABLE_TOOL_PATTERN = /\b(list_dir|view_file|read_file|mastra_workspace_list_files|mastra_workspace_read_file|mastra_workspace_file_stat|filesystem)\b|文件|目录|路径|列出|读取|查看/iu;
const ARTIFACT_WRITE_AVAILABLE_TOOL_PATTERN = /\b(write_to_file|replace_file_content|append_to_file|move_file|delete_path|mastra_workspace_write_file|mastra_workspace_replace_in_file|mastra_workspace_delete_file)\b|写入|保存|替换|更新|创建文件/iu;
const ARTIFACT_WRITE_CAPABILITY = 'artifact_write';
const SAVE_TARGET_INTENT_PATTERN = /(?:save(?:\s+it)?\s+to|write(?:\s+(?:it|result|output|report|file))?\s+to|保存到|写入|输出到)\s+([^\s,，。!?]+)/iu;
const SAVE_TARGET_PATH_PATTERN = /(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)[^\s,，。!?"'`]+/gu;
const TOOL_PREVIEW_LIMIT = 12;
const TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_ENV_KEY = 'COWORKANY_TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MS';
const TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MARKER = 'runtime_toolset_timeout:';
const TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_DEFAULT_MS = 1_500;
const TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MIN_MS = 200;
const TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MAX_MS = 10_000;
const FILESYSTEM_TOOLS_PATH_HINT_PATTERN = /(?:^|[\\/])(?:src|lib|app|test|tests|tools?)(?:[\\/]|$)|(?:^|[\\/])[^\s\\/]+\.[a-z0-9]{1,8}(?:$|[\\/])|目录|文件|路径|\b(?:path|folder|directory)\b/iu;
const DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_SIMPLE = 1;
const DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_MODERATE = 2;
const DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_COMPLEX = 3;
const RETRY_COMPLEXITY_CHAIN_PATTERN = /\b(first|then|after\s+that|next|finally|and\s+then)\b|先|然后|接着|随后|之后|再(?:执行|做|进行)?/iu;
const RETRY_COMPLEXITY_PARALLEL_PATTERN = /\b(parallel|concurrently|simultaneously|in\s+parallel)\b|并行|同时/iu;
const RESOLVED_ATTACHMENTS_HEADER_PATTERN = /^\s*\[Resolved attachments\]\s*$/iu;
const RESOLVED_ATTACHMENT_LIST_ITEM_PATTERN = /^\s*-\s+(?:\/|~\/|[A-Za-z]:\\|[A-Za-z0-9._-]+[\\/]).+/u;
const ATTACHMENT_CONTEXT_REFERENCE_PATTERN = /\b(?:above|previous|earlier|prior|these|those|same)\b|上述|以上|上面|前面|前面的|之前|刚才|这些|那些|这几张|那几张|这批|那批|同一批/u;
const ATTACHMENT_OBJECT_REFERENCE_PATTERN = /\b(?:image|images|picture|pictures|photo|photos|screenshot|screenshots|file|files|attachment|attachments)\b|图片|照片|截图|文件|附件/u;
const ATTACHMENT_DERIVATIVE_ACTION_PATTERN = /(?:\b(convert|transcode|re-?encode|compress|resize|crop|rotate|merge|split|extract|export|transform)\b|转(?:换|成|为)|改成|变成|另存为|导出(?:为)?|压缩|缩放|裁剪|旋转|合并|拆分|提取|生成)/iu;
const ATTACHMENT_MEDIA_TARGET_PATTERN = /\b(video|image|images|picture|pictures|photo|photos|screenshot|screenshots|gif|png|jpe?g|webp|heic|pdf|mp4|mov|avi|mkv|audio|voice|wav|mp3)\b|视频|图片|照片|截图|附件|文件|音频|语音|动图|png|jpg|jpeg|webp|heic|pdf|mp4|mov|avi|mkv|wav|mp3/iu;

function extractResolvedAttachmentBlock(message: string | undefined): string | null {
    if (typeof message !== 'string' || message.trim().length === 0) {
        return null;
    }
    const normalizedMessage = normalizeResolvedAttachmentsMessage(message);
    const lines = normalizedMessage.split(/\r?\n/u);
    const attachmentLines: string[] = [];
    let inAttachmentBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (RESOLVED_ATTACHMENTS_HEADER_PATTERN.test(trimmed)) {
            inAttachmentBlock = true;
            continue;
        }
        if (!inAttachmentBlock) {
            continue;
        }
        if (!trimmed) {
            continue;
        }
        if (!RESOLVED_ATTACHMENT_LIST_ITEM_PATTERN.test(trimmed)) {
            break;
        }
        attachmentLines.push(trimmed);
    }
    if (attachmentLines.length === 0) {
        return null;
    }
    return ['[Resolved attachments]', ...attachmentLines].join('\n');
}

function inheritResolvedAttachmentsForFollowup(input: {
    message: string;
    previousMessages?: Array<string | undefined>;
}): string {
    if (RESOLVED_ATTACHMENTS_HEADER_PATTERN.test(input.message)) {
        return input.message;
    }
    const attachmentBlock = (input.previousMessages ?? [])
        .map((message) => extractResolvedAttachmentBlock(message))
        .find((value): value is string => typeof value === 'string');
    if (!attachmentBlock) {
        return input.message;
    }
    const hasContextReference = ATTACHMENT_CONTEXT_REFERENCE_PATTERN.test(input.message);
    const hasObjectReference = ATTACHMENT_OBJECT_REFERENCE_PATTERN.test(input.message);
    const hasDerivativeTargetReference = (
        ATTACHMENT_DERIVATIVE_ACTION_PATTERN.test(input.message)
        && ATTACHMENT_MEDIA_TARGET_PATTERN.test(input.message)
    );
    const shouldInherit = hasContextReference && (hasObjectReference || hasDerivativeTargetReference);
    if (!shouldInherit) {
        return input.message;
    }
    return `${attachmentBlock}\n\n${input.message}`;
}

function hasToolBackedCapabilityRequirement(requirements: TaskCapabilityRequirement[]): boolean {
    return requirements.length > 0;
}

function resolveDefaultCapabilityRetryMaxAttempts(input: {
    message: string;
    workspacePath: string;
    requirements: TaskCapabilityRequirement[];
}): number {
    const normalizedMessage = input.message.trim();
    const hasParallelCue = RETRY_COMPLEXITY_PARALLEL_PATTERN.test(normalizedMessage);
    const hasChainCue = RETRY_COMPLEXITY_CHAIN_PATTERN.test(normalizedMessage);
    const hasLongInstruction = normalizedMessage.length >= 140;
    const hasMultiCapability = input.requirements.length >= 2;

    let hasMultiTaskPlan = false;
    let hasDependencyChain = false;
    try {
        const normalizedRequest = analyzeWorkRequest({
            sourceText: input.message,
            workspacePath: input.workspacePath,
        });
        hasMultiTaskPlan = normalizedRequest.tasks.length > 1;
        hasDependencyChain = normalizedRequest.tasks.some((task) => (task.dependencies?.length ?? 0) > 0);
    } catch {
        // Best-effort complexity inference should not block default routing.
    }

    if (hasMultiCapability || hasMultiTaskPlan || hasDependencyChain || hasParallelCue) {
        return DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_COMPLEX;
    }
    if (hasChainCue || hasLongInstruction) {
        return DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_MODERATE;
    }
    return DEFAULT_CAPABILITY_TASK_RETRY_MAX_ATTEMPTS_SIMPLE;
}

function buildDefaultCapabilityRetryState(maxAttempts: number): TaskRuntimeRetryState {
    const boundedMaxAttempts = Math.max(1, Math.min(5, Math.floor(maxAttempts)));
    return {
        attempts: 0,
        maxAttempts: boundedMaxAttempts,
        lastRetryAt: undefined,
        lastError: undefined,
    };
}

function normalizeCapabilityValues(values: string[]): string[] {
    return Array.from(new Set(
        values
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    )).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' }));
}

function maybeAppendArtifactWriteCapability(message: string, capabilities: string[]): string[] {
    const normalized = normalizeCapabilityValues(capabilities);
    const explicitSaveIntent = SAVE_TARGET_INTENT_PATTERN.test(message);
    SAVE_TARGET_INTENT_PATTERN.lastIndex = 0;
    if (!explicitSaveIntent) {
        return normalized;
    }
    const pathHint = SAVE_TARGET_PATH_PATTERN.exec(message);
    SAVE_TARGET_PATH_PATTERN.lastIndex = 0;
    if (!pathHint) {
        return normalized;
    }
    return normalizeCapabilityValues([...normalized, ARTIFACT_WRITE_CAPABILITY]);
}

function collectToolpackHints(
    snapshot: RuntimeCapabilitySnapshot | null,
    options?: {
        callableOnly?: boolean;
        includeDescription?: boolean;
    },
): string[] {
    if (!snapshot) {
        return [];
    }
    const callableOnly = options?.callableOnly === true;
    const includeDescription = options?.includeDescription === true;
    const values: string[] = [];
    for (const toolpack of snapshot.toolpacks) {
        if (!toolpack.enabled) {
            continue;
        }
        const hasCallableTools = (
            toolpack.runtimeStatus === 'callable'
            || (typeof toolpack.callableToolCount === 'number' && toolpack.callableToolCount > 0)
        );
        if (callableOnly && !hasCallableTools) {
            continue;
        }
        const id = typeof toolpack.id === 'string' ? toolpack.id : '';
        const name = typeof toolpack.name === 'string' ? toolpack.name : '';
        const description = typeof toolpack.description === 'string' ? toolpack.description : '';
        if (id.length > 0) {
            values.push(id);
        }
        if (name.length > 0) {
            values.push(name);
        }
        if (includeDescription && description.length > 0) {
            values.push(description);
        }
        if (Array.isArray(toolpack.tools)) {
            for (const tool of toolpack.tools) {
                if (typeof tool === 'string') {
                    values.push(tool);
                }
            }
        }
    }
    return normalizeCapabilityValues(values);
}

function collectEnabledToolpackHints(snapshot: RuntimeCapabilitySnapshot | null): string[] {
    return collectToolpackHints(snapshot, {
        includeDescription: true,
    });
}

function collectCallableToolpackHints(snapshot: RuntimeCapabilitySnapshot | null): string[] {
    return collectToolpackHints(snapshot, {
        callableOnly: true,
    });
}

function collectRuntimeToolHints(toolsets: RuntimeToolsetMap): string[] {
    const values: string[] = [];
    for (const serverTools of Object.values(toolsets)) {
        if (!serverTools || typeof serverTools !== 'object') {
            continue;
        }
        for (const [toolName, toolMeta] of Object.entries(serverTools)) {
            values.push(toolName);
            if (toolMeta && typeof toolMeta === 'object') {
                const record = toolMeta as Record<string, unknown>;
                const id = typeof record.id === 'string' ? record.id : '';
                const description = typeof record.description === 'string' ? record.description : '';
                if (id) {
                    values.push(id);
                }
                if (description) {
                    values.push(description);
                }
            }
        }
    }
    return normalizeCapabilityValues(values);
}

function truncateCapabilityPreview(values: string[]): string {
    if (values.length === 0) {
        return '(none)';
    }
    const preview = values.slice(0, TOOL_PREVIEW_LIMIT);
    const suffix = values.length > TOOL_PREVIEW_LIMIT ? ` ...(+${values.length - TOOL_PREVIEW_LIMIT})` : '';
    return `${preview.join(', ')}${suffix}`;
}

function resolveTaskCapabilityRequirements(input: {
    message: string;
    workspacePath: string;
}): TaskCapabilityRequirement[] {
    return resolveTaskCapabilityRequirementsFromRegistry(input);
}

function isRequirementAvailable(
    requirement: TaskCapabilityRequirement,
    hints: string[],
): boolean {
    if (requirement === 'web_research') {
        return hints.some((hint) => (
            WEB_RESEARCH_AVAILABLE_TOOL_PATTERN.test(hint)
            || BROWSER_AVAILABLE_TOOL_PATTERN.test(hint)
        ));
    }
    if (requirement === 'browser_automation') {
        return hints.some((hint) => BROWSER_AVAILABLE_TOOL_PATTERN.test(hint));
    }
    if (requirement === 'voice_output') {
        return hints.some((hint) => VOICE_OUTPUT_AVAILABLE_TOOL_PATTERN.test(hint));
    }
    if (requirement === 'filesystem_read') {
        return hints.some((hint) => FILESYSTEM_READ_AVAILABLE_TOOL_PATTERN.test(hint));
    }
    if (requirement === 'command_execution') {
        // Command execution is a core built-in lane in direct task mode.
        // Runtime toolset snapshots may not enumerate built-ins consistently.
        void hints;
        return true;
    }
    if (requirement === 'artifact_write') {
        return hints.some((hint) => ARTIFACT_WRITE_AVAILABLE_TOOL_PATTERN.test(hint));
    }
    return false;
}

function formatRequirementLabel(requirement: TaskCapabilityRequirement): string {
    return formatTaskCapabilityRequirement(requirement);
}

type RuntimeToolsetLookupResult = {
    runtimeToolsets: RuntimeToolsetMap;
    runtimeToolsetLookupOk: boolean;
    runtimeToolsetLookupTimedOut: boolean;
};

function resolveTaskCapabilityGateToolsetTimeoutMs(): number {
    const raw = Number.parseInt(process.env[TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_ENV_KEY] ?? '', 10);
    if (!Number.isFinite(raw)) {
        return TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_DEFAULT_MS;
    }
    return Math.min(
        TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MAX_MS,
        Math.max(TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MIN_MS, Math.floor(raw)),
    );
}

function isRuntimeToolsetTimeoutError(error: unknown): boolean {
    return String(error).includes(TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MARKER);
}

async function lookupRuntimeToolsetsWithTimeout(input: {
    listRuntimeToolsets?: () => RuntimeToolsetMap | Promise<RuntimeToolsetMap>;
    timeoutMs: number;
}): Promise<RuntimeToolsetLookupResult> {
    if (!input.listRuntimeToolsets) {
        return {
            runtimeToolsets: {},
            runtimeToolsetLookupOk: false,
            runtimeToolsetLookupTimedOut: false,
        };
    }
    try {
        const runtimeToolsets = await Promise.race([
            Promise.resolve(input.listRuntimeToolsets()),
            new Promise<RuntimeToolsetMap>((_, reject) => {
                setTimeout(
                    () => reject(new Error(`${TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MARKER}${input.timeoutMs}`)),
                    input.timeoutMs,
                );
            }),
        ]);
        return {
            runtimeToolsets,
            runtimeToolsetLookupOk: true,
            runtimeToolsetLookupTimedOut: false,
        };
    } catch (error) {
        const runtimeToolsetLookupTimedOut = isRuntimeToolsetTimeoutError(error);
        if (runtimeToolsetLookupTimedOut) {
            console.warn('[coworkany-capability-gate] runtime toolset lookup timed out; bypassing strict gate for this turn.', {
                timeoutMs: input.timeoutMs,
            });
        }
        return {
            runtimeToolsets: {},
            runtimeToolsetLookupOk: false,
            runtimeToolsetLookupTimedOut,
        };
    }
}

function shouldBypassCapabilityGateForMcpLoading(input: {
    mcpSnapshot?: RuntimeMcpSnapshot;
    runtimeToolsetLookupOk: boolean;
    runtimeToolsetLookupTimedOut: boolean;
    runtimeToolHints: string[];
}): boolean {
    return Boolean(
        input.mcpSnapshot?.enabled
        && (
            input.runtimeToolsetLookupTimedOut
            || (
                input.runtimeToolsetLookupOk
                && input.runtimeToolHints.length === 0
                && input.mcpSnapshot.status !== 'ready'
            )
        ),
    );
}

function buildTaskCapabilityMissingSummary(input: {
    requirements: TaskCapabilityRequirement[];
    missingRequirements: TaskCapabilityRequirement[];
    mcpEnabled: boolean | null;
    mcpSnapshot?: RuntimeMcpSnapshot;
    runtimeToolHints: string[];
    callableConfiguredToolHints: string[];
    configuredToolHints: string[];
}): string {
    const requirementLabels = input.requirements.map(formatRequirementLabel).join(', ');
    const missingLabels = input.missingRequirements.map(formatRequirementLabel).join(', ');
    return [
        '当前无法稳定执行该任务：缺少所需工具能力。',
        `required_capabilities=${requirementLabels}; missing_capabilities=${missingLabels}; mcp_enabled=${input.mcpEnabled === null ? 'unknown' : (input.mcpEnabled ? 'yes' : 'no')}; mcp_status=${input.mcpSnapshot?.status ?? 'unknown'}; mcp_allowed_servers=${input.mcpSnapshot?.allowedServerCount ?? 'unknown'}.`,
        `运行时工具预览：${truncateCapabilityPreview(input.runtimeToolHints)}`,
        `运行时可调用工具包预览：${truncateCapabilityPreview(input.callableConfiguredToolHints)}`,
        `已启用工具包预览：${truncateCapabilityPreview(input.configuredToolHints)}`,
        '请在 CoworkAny 中启用并加载对应工具后重试（例如 search_web、crawl_url、check_weather、get_news、browser_*、run_command、write_to_file）。',
    ].join('\n');
}

async function evaluateTaskCapabilityGate(input: {
    message: string;
    workspacePath: string;
    requirements?: TaskCapabilityRequirement[];
    listRuntimeCapabilities?: () => RuntimeCapabilitySnapshot | Promise<RuntimeCapabilitySnapshot>;
    listRuntimeToolsets?: () => RuntimeToolsetMap | Promise<RuntimeToolsetMap>;
    isRuntimeMcpEnabled?: () => boolean;
    getRuntimeMcpSnapshot?: () => RuntimeMcpSnapshot;
}): Promise<TaskCapabilityGateResult> {
    const requirements = input.requirements ?? resolveTaskCapabilityRequirements({
        message: input.message,
        workspacePath: input.workspacePath,
    });
    if (requirements.length === 0) {
        return { ready: true, requirements };
    }

    let snapshot: RuntimeCapabilitySnapshot | null = null;
    if (input.listRuntimeCapabilities) {
        try {
            snapshot = await input.listRuntimeCapabilities();
        } catch {
            snapshot = null;
        }
    }

    const runtimeToolsetLookupTimeoutMs = resolveTaskCapabilityGateToolsetTimeoutMs();
    const {
        runtimeToolsets,
        runtimeToolsetLookupOk,
        runtimeToolsetLookupTimedOut,
    } = await lookupRuntimeToolsetsWithTimeout({
        listRuntimeToolsets: input.listRuntimeToolsets,
        timeoutMs: runtimeToolsetLookupTimeoutMs,
    });

    const configuredToolHints = collectEnabledToolpackHints(snapshot);
    const callableConfiguredToolHints = collectCallableToolpackHints(snapshot);
    const runtimeToolHints = collectRuntimeToolHints(runtimeToolsets);
    const hasCapabilitySnapshot = snapshot !== null;
    const hasRuntimeToolsetSnapshot = runtimeToolsetLookupOk;
    if (!hasCapabilitySnapshot && !hasRuntimeToolsetSnapshot) {
        return {
            ready: true,
            requirements,
        };
    }
    const mcpEnabled = input.isRuntimeMcpEnabled ? input.isRuntimeMcpEnabled() : null;
    const mcpSnapshot = input.getRuntimeMcpSnapshot?.();
    if (!runtimeToolsetLookupOk) {
        return {
            ready: true,
            requirements,
        };
    }
    const combinedHints = normalizeCapabilityValues([...runtimeToolHints, ...callableConfiguredToolHints]);
    const availableRequirements = requirements.filter((requirement) => isRequirementAvailable(requirement, combinedHints));
    const missingRequirements = requirements.filter((requirement) => !availableRequirements.includes(requirement));
    const isRuntimeMcpStillLoading = shouldBypassCapabilityGateForMcpLoading({
        mcpSnapshot,
        runtimeToolsetLookupOk,
        runtimeToolsetLookupTimedOut,
        runtimeToolHints,
    });
    if (isRuntimeMcpStillLoading) {
        return {
            ready: true,
            requirements,
        };
    }
    const ready = missingRequirements.length === 0;
    if (ready) {
        return {
            ready: true,
            requirements,
        };
    }

    return {
        ready: false,
        requirements,
        summary: buildTaskCapabilityMissingSummary({
            requirements,
            missingRequirements,
            mcpEnabled,
            mcpSnapshot,
            runtimeToolHints,
            callableConfiguredToolHints,
            configuredToolHints,
        }),
    };
}

type CapabilitySummaryMode = 'list' | 'details';

type CapabilityQueryIntent = {
    includeSkills: boolean;
    includeTools: boolean;
    mode: CapabilitySummaryMode;
};

function detectCapabilityQueryIntent(message: string): CapabilityQueryIntent | null {
    const normalized = message.trim();
    if (!normalized) {
        return null;
    }
    const includeSkills = SKILL_QUERY_SUBJECT_PATTERN.test(normalized);
    const includeTools = TOOL_QUERY_SUBJECT_PATTERN.test(normalized);
    if (!includeSkills && !includeTools) {
        return null;
    }
    // Avoid false positives on file-path oriented requests like "列出 src/tools/*.ts":
    // these should execute filesystem tools instead of returning capability summaries.
    if (
        includeTools
        && !includeSkills
        && !CAPABILITY_QUERY_SHORT_PATTERN.test(normalized)
        && FILESYSTEM_TOOLS_PATH_HINT_PATTERN.test(normalized)
    ) {
        return null;
    }
    const shouldExplain = CAPABILITY_EXPLAIN_HINT_PATTERN.test(normalized);
    const hasReferenceCue = CAPABILITY_REFERENCE_HINT_PATTERN.test(normalized);
    const looksLikeCapabilityQuery = CAPABILITY_QUERY_HINT_PATTERN.test(normalized)
        || CAPABILITY_QUERY_SHORT_PATTERN.test(normalized)
        || shouldExplain
        || hasReferenceCue;
    if (!looksLikeCapabilityQuery) {
        return null;
    }
    return {
        includeSkills,
        includeTools,
        mode: shouldExplain ? 'details' : 'list',
    };
}

function collectSortedCapabilityLabels(
    values: string[],
): string[] {
    return Array.from(
        new Set(
            values
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
        ),
    ).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' }));
}

function buildCapabilitySummary(
    intent: CapabilityQueryIntent,
    snapshot: RuntimeCapabilitySnapshot,
): string | null {
    const lines: string[] = [];
    const formatSkillName = (skill: RuntimeCapabilitySkill): string => (
        (skill.id || skill.name || '').trim()
    );
    const formatSkillDetail = (skill: RuntimeCapabilitySkill): string => {
        const name = formatSkillName(skill);
        if (!name) {
            return '';
        }
        const description = (skill.description ?? '').trim();
        return description.length > 0
            ? `- ${name}: ${description}`
            : `- ${name}: （无描述）`;
    };
    const formatToolpackName = (toolpack: RuntimeCapabilityToolpack): string => {
        const base = (toolpack.name || toolpack.id || '').trim();
        if (!base) {
            return '';
        }
        const toolCount = Array.isArray(toolpack.tools) ? toolpack.tools.length : 0;
        return toolCount > 0 ? `${base}[${toolCount}]` : base;
    };
    const formatToolpackDetail = (toolpack: RuntimeCapabilityToolpack): string => {
        const name = formatToolpackName(toolpack);
        if (!name) {
            return '';
        }
        const description = (toolpack.description ?? '').trim();
        return description.length > 0
            ? `- ${name}: ${description}`
            : `- ${name}: （无描述）`;
    };
    if (intent.includeSkills) {
        const enabledSkills = snapshot.skills
            .filter((skill) => skill.enabled)
            .sort((left, right) => formatSkillName(left).localeCompare(formatSkillName(right), 'zh-Hans-CN', { sensitivity: 'base' }));
        const disabledSkills = snapshot.skills
            .filter((skill) => !skill.enabled)
            .sort((left, right) => formatSkillName(left).localeCompare(formatSkillName(right), 'zh-Hans-CN', { sensitivity: 'base' }));
        if (intent.mode === 'details') {
            lines.push(
                enabledSkills.length > 0
                    ? `当前可调用 skills（${enabledSkills.length}）：\n${enabledSkills.map(formatSkillDetail).filter((line) => line.length > 0).join('\n')}`
                    : '当前没有可调用 skills。',
            );
            if (disabledSkills.length > 0) {
                lines.push(
                    `已安装但禁用 skills（${disabledSkills.length}）：\n${disabledSkills.map(formatSkillDetail).filter((line) => line.length > 0).join('\n')}`,
                );
            }
        } else {
            const enabledNames = collectSortedCapabilityLabels(enabledSkills.map(formatSkillName));
            const disabledNames = collectSortedCapabilityLabels(disabledSkills.map(formatSkillName));
            lines.push(
                enabledNames.length > 0
                    ? `当前可调用 skills（${enabledNames.length}）：${enabledNames.join(', ')}`
                    : '当前没有可调用 skills。',
            );
            if (disabledNames.length > 0) {
                lines.push(`已安装但禁用 skills（${disabledNames.length}）：${disabledNames.join(', ')}`);
            }
        }
    }
    if (intent.includeTools) {
        const enabledToolpacks = snapshot.toolpacks
            .filter((toolpack) => toolpack.enabled)
            .sort((left, right) => formatToolpackName(left).localeCompare(formatToolpackName(right), 'zh-Hans-CN', { sensitivity: 'base' }));
        const disabledToolpacks = snapshot.toolpacks
            .filter((toolpack) => !toolpack.enabled)
            .sort((left, right) => formatToolpackName(left).localeCompare(formatToolpackName(right), 'zh-Hans-CN', { sensitivity: 'base' }));
        if (intent.mode === 'details') {
            lines.push(
                enabledToolpacks.length > 0
                    ? `当前可调用 tools/toolpacks（${enabledToolpacks.length}）：\n${enabledToolpacks.map(formatToolpackDetail).filter((line) => line.length > 0).join('\n')}`
                    : '当前没有可调用 tools/toolpacks。',
            );
            if (disabledToolpacks.length > 0) {
                lines.push(
                    `已安装但禁用 toolpacks（${disabledToolpacks.length}）：\n${disabledToolpacks.map(formatToolpackDetail).filter((line) => line.length > 0).join('\n')}`,
                );
            }
        } else {
            const enabledNames = collectSortedCapabilityLabels(enabledToolpacks.map(formatToolpackName));
            const disabledNames = collectSortedCapabilityLabels(disabledToolpacks.map(formatToolpackName));
            lines.push(
                enabledNames.length > 0
                    ? `当前可调用 tools/toolpacks（${enabledNames.length}）：${enabledNames.join(', ')}`
                    : '当前没有可调用 tools/toolpacks。',
            );
            if (disabledNames.length > 0) {
                lines.push(`已安装但禁用 toolpacks（${disabledNames.length}）：${disabledNames.join(', ')}`);
            }
        }
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

function isGeneralCapabilityQuery(message: string): boolean {
    return GENERAL_CAPABILITY_QUERY_PATTERN.test(message.trim());
}

function buildGeneralCapabilitySummary(snapshot: RuntimeCapabilitySnapshot): string {
    const enabledSkillCount = snapshot.skills.filter((skill) => skill.enabled).length;
    const enabledToolpackCount = snapshot.toolpacks.filter((toolpack) => toolpack.enabled).length;
    return [
        '我可以帮你：问答与写作、代码与调试、资料检索与总结、文件与命令操作（涉及风险操作会先审批）。',
        `当前已启用能力：skills ${enabledSkillCount} 个，toolpacks ${enabledToolpackCount} 个。`,
        '直接告诉我目标即可，例如“写一份紧凑日报”或“解释这段报错原因”。',
    ].join('\n');
}

function resolveTaskStartedMode(input: {
    forcedRouteMode?: UserMessageExecutionOptions['forcedRouteMode'];
    executionPath?: UserMessageExecutionOptions['executionPath'];
    scheduled?: boolean;
}): TaskStartedMode {
    if (input.scheduled) {
        return 'scheduled_task';
    }
    if (input.forcedRouteMode === 'chat') {
        return 'chat';
    }
    if (input.forcedRouteMode === 'task') {
        return 'immediate_task';
    }
    return input.executionPath === 'direct' ? 'chat' : 'immediate_task';
}

function resolveStartTaskIntentRoute(input: {
    message: string;
    workspacePath: string;
    capabilityRequirements: TaskCapabilityRequirement[];
}): {
    executionPath: 'direct' | 'workflow';
    forcedRouteMode: 'chat' | 'task';
} {
    if (hasToolBackedCapabilityRequirement(input.capabilityRequirements)) {
        return {
            executionPath: 'direct',
            forcedRouteMode: 'task',
        };
    }
    const mode = analyzeWorkRequest({
        sourceText: input.message,
        workspacePath: input.workspacePath,
    }).mode;
    if (mode === 'chat') {
        return {
            executionPath: 'direct',
            forcedRouteMode: 'chat',
        };
    }
    if (mode === 'immediate_task') {
        return {
            executionPath: 'direct',
            forcedRouteMode: 'task',
        };
    }
    return {
        executionPath: 'workflow',
        forcedRouteMode: 'task',
    };
}

function toExecutionForcedRouteMode(
    routeMode: 'chat' | 'task' | 'schedule' | null | undefined,
): ExecutionForcedRouteMode | null {
    if (routeMode === 'chat') {
        return 'chat';
    }
    if (routeMode === 'task' || routeMode === 'schedule') {
        return 'task';
    }
    return null;
}

const TASK_ROUTE_CONTINUITY_STATUSES = new Set<TaskRuntimeState['status']>([
    'running',
    'retrying',
    'suspended',
    'interrupted',
    'scheduled',
]);

function resolveFollowupRouteMode(input: {
    commandType: StartOrSendCommandType;
    routedForcedRouteMode: 'chat' | 'task' | null;
    previousState?: TaskRuntimeState;
}): 'chat' | 'task' | undefined {
    if (
        (input.commandType !== 'send_task_message' && input.commandType !== 'send_subagent_message')
        || input.routedForcedRouteMode !== null
    ) {
        return undefined;
    }
    if (input.commandType === 'send_subagent_message') {
        return 'task';
    }
    const previousState = input.previousState;
    if (!previousState) {
        // Keep existing first-turn behavior for direct follow-up commands without state.
        return 'chat';
    }
    if (previousState.turnContract?.mode === 'task') {
        return 'task';
    }
    if (previousState.turnContract?.mode === 'chat') {
        return 'chat';
    }
    if (previousState.executionPath === 'workflow' || previousState.executionPath === 'workflow_fallback') {
        return 'task';
    }
    if (TASK_ROUTE_CONTINUITY_STATUSES.has(previousState.status)) {
        return 'task';
    }
    // Legacy task states may miss turnContract metadata; keep follow-up in task lane by default.
    return 'task';
}

export async function handleStartOrSendTaskCommand(
    input: HandleStartOrSendTaskCommandInput,
): Promise<boolean> {
    if (!isStartOrSendCommandType(input.commandType)) {
        return false;
    }
    const { commandType, commandId, payload } = input;
    const turnId = commandId;
    const taskId = input.getString(payload.taskId) ?? '';
    const isFollowupCommand = commandType === 'send_task_message' || commandType === 'send_subagent_message';
    const followupResponseType = commandType === 'send_subagent_message'
        ? 'send_subagent_message_response'
        : 'send_task_message_response';
    const rawMessage = commandType === 'start_task'
        ? input.getString(payload.userQuery)
        : input.getString(payload.content);
    if (!taskId || !rawMessage) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
    const previousState = input.taskStates.get(taskId);
    const shouldEmitTaskLifecycleEvents = commandType === 'start_task' || !previousState;
    const routedMessage = parseRoutedInput(rawMessage);
    const message = routedMessage.cleanText.trim().length > 0
        ? routedMessage.cleanText
        : (
            routedMessage.forcedRouteMode
                ? (previousState?.lastUserMessage ?? '')
                : rawMessage
        );
    const normalizedMessage = normalizeResolvedAttachmentsMessage(message);
    if (!normalizedMessage || normalizedMessage.trim().length === 0) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
    const followupHistoryMessages = isFollowupCommand
        ? (
            input.listTaskTranscriptEntries?.(taskId, 32)
                .filter((entry) => entry.role === 'user')
                .map((entry) => entry.content)
                .reverse()
            ?? []
        )
        : [];
    const effectiveMessage = isFollowupCommand
        ? inheritResolvedAttachmentsForFollowup({
            message: normalizedMessage,
            previousMessages: [
                previousState?.lastUserMessage,
                ...followupHistoryMessages,
            ],
        })
        : normalizedMessage;
    const taskCommandGuard = await runGuardPipeline<undefined>([
        () => {
            const taskCommandDecision = input.applyPolicyDecision({
                requestId: commandId,
                action: 'task_command',
                commandType,
                taskId,
                source: 'entrypoint',
                payload,
            });
            if (!taskCommandDecision.allowed) {
                return failGuard(`policy_denied:${taskCommandDecision.reason}`, undefined);
            }
            return passGuard();
        },
    ]);
    if (!taskCommandGuard.ok) {
        input.emitCurrent({
            success: false,
            taskId,
            error: taskCommandGuard.error,
        });
        return true;
    }
    const appendUserTranscript = (): void => {
        input.appendTranscript(taskId, 'user', normalizedMessage);
    };
    const workspacePath = input.getString(input.toRecord(payload.context).workspacePath)
        ?? previousState?.workspacePath
        ?? process.cwd();
    const inferredCapabilityRequirements = resolveTaskCapabilityRequirements({
        message: effectiveMessage,
        workspacePath,
    });
    const commandConfig = input.toRecord(payload.config);
    const allowDuplicateTaskMessage = input.pickBooleanConfigValue(commandConfig, 'allowDuplicateTaskMessage') === true;
    const explicitEnabledSkills = input.pickStringArrayConfigValue(commandConfig, 'enabledSkills');
    const explicitEnabledToolpacksRaw = input.pickStringArrayConfigValue(commandConfig, 'enabledToolpacks');
    const explicitEnabledToolpacks = explicitEnabledToolpacksRaw && explicitEnabledToolpacksRaw.length > 0
        ? explicitEnabledToolpacksRaw
        : undefined;
    const requestedTitle = input.getString(payload.title);
    const configuredModelId = input.pickStringConfigValue(commandConfig, 'modelId');
    const resolvedModelId = configuredModelId ?? previousState?.modelId;
    const retryConfig = input.pickTaskRuntimeRetryConfig(commandConfig);
    const inheritedExecutionPath = input.toUserMessageExecutionPath(previousState?.executionPath);
    const configuredExecutionPath = input.pickTaskExecutionPath(commandConfig);
    const hasKnownExecutionPath = previousState?.executionPath === 'direct' || previousState?.executionPath === 'workflow';
    const defaultExecutionPath = (
        isFollowupCommand
        && routedMessage.forcedRouteMode !== 'task'
        && !hasKnownExecutionPath
    )
        ? 'direct'
        : inheritedExecutionPath;
    const routedForcedRouteMode = toExecutionForcedRouteMode(routedMessage.forcedRouteMode);
    const followupRouteMode = resolveFollowupRouteMode({
        commandType,
        routedForcedRouteMode,
        previousState,
    });
    let resolvedExecutionPath = configuredExecutionPath ?? defaultExecutionPath;
    let resolvedForcedRouteMode = routedForcedRouteMode ?? (
        commandType === 'start_task'
            ? (resolvedExecutionPath === 'direct' ? 'chat' : 'task')
            : followupRouteMode
    );
    const hasExplicitToolingRuntimeConfig = (
        (explicitEnabledSkills?.length ?? 0) > 0
        || (explicitEnabledToolpacks?.length ?? 0) > 0
    );
    if (
        hasExplicitToolingRuntimeConfig
        && routedMessage.forcedRouteMode == null
        && configuredExecutionPath === undefined
    ) {
        resolvedExecutionPath = 'direct';
        resolvedForcedRouteMode = 'task';
    }
    const shouldApplyStartTaskIntentRouting = commandType === 'start_task'
        && routedMessage.forcedRouteMode == null
        && !hasExplicitToolingRuntimeConfig;
    if (shouldApplyStartTaskIntentRouting) {
        // `executionPath` from desktop can be a UI default (especially chat/direct),
        // not an explicit user routing decision. Re-run server-side intent routing
        // unless the user provided an explicit route token.
        const intentRoute = resolveStartTaskIntentRoute({
            message: effectiveMessage,
            workspacePath,
            capabilityRequirements: inferredCapabilityRequirements,
        });
        resolvedExecutionPath = intentRoute.executionPath;
        resolvedForcedRouteMode = intentRoute.forcedRouteMode;
    }
    const shouldDisableChatSkillsByDefault = resolvedExecutionPath === 'direct'
        && resolvedForcedRouteMode !== 'task'
        && (!explicitEnabledSkills || explicitEnabledSkills.length === 0)
        && input.pickBooleanConfigValue(commandConfig, 'enableChatSkills') !== true;
    const resolvedSkillPrompt = shouldDisableChatSkillsByDefault
        ? {
            prompt: undefined,
            enabledSkillIds: [] as string[],
        }
        : (
            input.resolveSkillPrompt
                ? input.resolveSkillPrompt({
                    message: effectiveMessage,
                    workspacePath,
                    explicitEnabledSkills,
                })
                : {
                    prompt: undefined,
                    enabledSkillIds: explicitEnabledSkills ?? [],
                }
        );
    let executionOptions: UserMessageExecutionOptions = {
        modelId: resolvedModelId,
        enabledToolpacks: explicitEnabledToolpacks,
        enabledSkills: resolvedSkillPrompt.enabledSkillIds,
        skillPrompt: resolvedSkillPrompt.prompt,
        requireToolApproval: input.pickBooleanConfigValue(commandConfig, 'requireToolApproval'),
        autoResumeSuspendedTools: input.pickBooleanConfigValue(commandConfig, 'autoResumeSuspendedTools'),
        toolCallConcurrency: input.pickPositiveIntegerConfigValue(commandConfig, 'toolCallConcurrency', 1, 32),
        maxSteps: input.pickPositiveIntegerConfigValue(commandConfig, 'maxSteps', 1, 128),
        executionPath: resolvedExecutionPath,
        forcedRouteMode: resolvedForcedRouteMode,
        useDirectChatResponder: (
            resolvedExecutionPath === 'direct'
            && resolvedForcedRouteMode !== 'task'
        )
            ? true
            : undefined,
        forcePostAssistantCompletion: (
            resolvedExecutionPath === 'direct'
            || routedMessage.forcedRouteMode === 'chat'
            || (
                routedMessage.forcedRouteMode == null
                && previousState?.executionPath === 'direct'
            )
        )
            ? true
            : undefined,
    };
    const patchExecutionOptions = (patch: Partial<UserMessageExecutionOptions>): void => {
        executionOptions = {
            ...executionOptions,
            ...patch,
        };
    };
    const setRequiredCompletionCapabilities = (requiredCompletionCapabilities: string[]): void => {
        patchExecutionOptions({
            requiredCompletionCapabilities,
            requireToolEvidenceForCompletion: requiredCompletionCapabilities.length > 0,
        });
    };
    const resourceId = input.resolveTaskResourceId(taskId, payload, previousState?.resourceId);
    const shouldSeedDefaultCapabilityRetryBudget = (
        commandType === 'start_task'
        && !retryConfig
        && !previousState?.retry
        && hasToolBackedCapabilityRequirement(inferredCapabilityRequirements)
    );
    const nextRetryState: TaskRuntimeRetryState | undefined = retryConfig
        ? retryConfig
        : (previousState?.retry
            ? {
                ...previousState.retry,
                attempts: 0,
                lastRetryAt: undefined,
                lastError: undefined,
            }
            : (
                shouldSeedDefaultCapabilityRetryBudget
                    ? buildDefaultCapabilityRetryState(resolveDefaultCapabilityRetryMaxAttempts({
                        message: effectiveMessage,
                        workspacePath,
                        requirements: inferredCapabilityRequirements,
                    }))
                    : undefined
            ));
    const startedTaskTitle = requestedTitle ?? 'Task';
    const persistedExecutionPath = executionOptions.executionPath === 'direct' ? 'direct' : 'workflow';
    const emitAcceptedResponse = (queuePosition: number, responseType?: string): void => {
        const payload = {
            success: true,
            taskId,
            accepted: true,
            queuePosition,
            turnId,
        };
        if (responseType) {
            input.emitFor(responseType, payload);
            return;
        }
        input.emitCurrent(payload);
    };
    const emitAcceptedSummary = (inputSummary: {
        summary: string;
        finishReason: string;
        responseType?: string;
        queuePosition?: number;
    }): void => {
        emitAcceptedResponse(inputSummary.queuePosition ?? 0, inputSummary.responseType);
        input.emitTaskSummary({
            taskId,
            summary: inputSummary.summary,
            finishReason: inputSummary.finishReason,
            turnId,
        });
    };
    const emitSessionAndTaskStartLifecycle = (
        state: TaskRuntimeState,
        modeInput: {
            forcedRouteMode?: UserMessageExecutionOptions['forcedRouteMode'];
            executionPath?: UserMessageExecutionOptions['executionPath'];
        },
        title: string,
    ): void => {
        if (!shouldEmitTaskLifecycleEvents) {
            return;
        }
        input.emitHookEvent('SessionStart', {
            taskId,
            payload: {
                threadId: state.conversationThreadId,
                workspacePath: state.workspacePath,
                resourceId: state.resourceId,
            },
        });
        input.emitHookEvent('TaskCreated', {
            taskId,
            payload: {
                title: state.title,
                workspacePath: state.workspacePath,
                enabledSkills: state.enabledSkills ?? [],
            },
        });
        input.emitTaskStarted({
            taskId,
            title,
            message: effectiveMessage,
            workspacePath,
            mode: resolveTaskStartedMode(modeInput),
            turnId,
        });
    };
    const upsertTaskStateWithDefaults = (
        patch: Partial<TaskRuntimeState>,
    ): TaskRuntimeState => {
        const nextTitle = requestedTitle
            ?? previousState?.title
            ?? 'Task';
        return input.upsertTaskState(taskId, {
            title: nextTitle,
            workspacePath,
            suspended: false,
            suspensionReason: undefined,
            lastUserMessage: effectiveMessage,
            enabledSkills: resolvedSkillPrompt.enabledSkillIds,
            modelId: resolvedModelId,
            resourceId,
            checkpoint: undefined,
            retry: nextRetryState,
            ...patch,
        });
    };
    const emitCapabilityQueryShortcutSuccess = (summary: string): void => {
        appendUserTranscript();
        const state = upsertTaskStateWithDefaults({
            status: 'idle',
            executionPath: persistedExecutionPath,
        });
        emitSessionAndTaskStartLifecycle(state, {
            forcedRouteMode: executionOptions.forcedRouteMode,
            executionPath: executionOptions.executionPath,
        }, startedTaskTitle);
        emitAcceptedSummary({
            summary,
            finishReason: 'capability_query',
        });
    };

    if (
        commandType === 'send_task_message'
        && input.cancelScheduledTasksForSourceTask
        && input.isScheduledCancellationRequest(effectiveMessage)
    ) {
        appendUserTranscript();
        const cancelled = await input.cancelScheduledTasksForSourceTask({
            sourceTaskId: taskId,
            userMessage: effectiveMessage,
        });
        upsertTaskStateWithDefaults({
            status: 'idle',
        });
        const cancellationSummary = cancelled.cancelledCount > 0
            ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
            : '没有可取消的定时任务。';
        emitAcceptedSummary({
            summary: cancellationSummary,
            finishReason: 'scheduled_cancel',
            responseType: 'send_task_message_response',
        });
        return true;
    }

    const capabilityQueryIntent = detectCapabilityQueryIntent(effectiveMessage);
    if (capabilityQueryIntent && input.listRuntimeCapabilities) {
        try {
            const capabilitySummary = buildCapabilitySummary(
                capabilityQueryIntent,
                await input.listRuntimeCapabilities(),
            );
            if (capabilitySummary) {
                emitCapabilityQueryShortcutSuccess(capabilitySummary);
                return true;
            }
        } catch {
            // Best-effort optimization; fall back to normal LLM execution on capability lookup failure.
        }
    }
    if (isGeneralCapabilityQuery(effectiveMessage) && input.listRuntimeCapabilities) {
        try {
            const capabilitySummary = buildGeneralCapabilitySummary(await input.listRuntimeCapabilities());
            emitCapabilityQueryShortcutSuccess(capabilitySummary);
            return true;
        } catch {
            // Best-effort optimization; fall back to normal LLM execution on capability lookup failure.
        }
    }

    const hasExplicitSchedulePrefix = EXPLICIT_SCHEDULE_PREFIX.test(rawMessage);
    const hasExplicitRouteCommand = EXPLICIT_ROUTE_COMMAND_PATTERN.test(rawMessage.trim());
    const isHighRiskHostAction = HIGH_RISK_HOST_ACTION_PATTERN.test(effectiveMessage);
    const hasSpacedAbsoluteTimeCue = SPACED_ABSOLUTE_TIME_PATTERN.test(effectiveMessage);
    const isDatabaseOperation = DATABASE_OPERATION_PATTERN.test(effectiveMessage);
    const forceDirectTaskPath = (): void => {
        patchExecutionOptions({
            executionPath: 'direct',
            forcedRouteMode: 'task',
            useDirectChatResponder: undefined,
            forcePostAssistantCompletion: undefined,
        });
    };
    const skipImplicitSchedule =
        !hasExplicitRouteCommand
        && !hasExplicitSchedulePrefix
        && isHighRiskHostAction
        && !hasSpacedAbsoluteTimeCue;
    if (skipImplicitSchedule) {
        forceDirectTaskPath();
    }
    const shouldForceDatabaseTaskPath = isDatabaseOperation
        && routedMessage.forcedRouteMode !== 'chat';
    if (shouldForceDatabaseTaskPath) {
        forceDirectTaskPath();
    }
    const shouldForceToolFirstTaskPath = hasToolBackedCapabilityRequirement(inferredCapabilityRequirements);
    if (shouldForceToolFirstTaskPath) {
        forceDirectTaskPath();
    }
    const shouldRunTaskCapabilityGate = executionOptions.forcedRouteMode === 'task';
    if (shouldRunTaskCapabilityGate) {
        const taskCapabilityGate = await evaluateTaskCapabilityGate({
            message: effectiveMessage,
            workspacePath,
            requirements: inferredCapabilityRequirements,
            listRuntimeCapabilities: input.listRuntimeCapabilities,
            listRuntimeToolsets: input.listRuntimeToolsets,
            isRuntimeMcpEnabled: input.isRuntimeMcpEnabled,
            getRuntimeMcpSnapshot: input.getRuntimeMcpSnapshot,
        });
        if (!taskCapabilityGate.ready && taskCapabilityGate.summary) {
            appendUserTranscript();
            const turnContract = buildTaskTurnContract({
                message: effectiveMessage,
                workspacePath,
                mode: 'task',
                route: 'direct',
                requiredCapabilities: maybeAppendArtifactWriteCapability(
                    effectiveMessage,
                    taskCapabilityGate.requirements.map(formatTaskCapabilityRequirement),
                ),
                createdAt: new Date().toISOString(),
            });
            const state = upsertTaskStateWithDefaults({
                status: 'idle',
                executionPath: 'direct',
                turnContract,
            });
            emitSessionAndTaskStartLifecycle(state, {
                forcedRouteMode: 'task',
                executionPath: 'direct',
            }, startedTaskTitle);
            emitAcceptedSummary({
                summary: taskCapabilityGate.summary,
                finishReason: 'capability_missing',
            });
            return true;
        }
        if (taskCapabilityGate.requirements.length > 0) {
            const requiredCompletionCapabilities = maybeAppendArtifactWriteCapability(
                effectiveMessage,
                taskCapabilityGate.requirements.map(formatRequirementLabel),
            );
            setRequiredCompletionCapabilities(requiredCompletionCapabilities);
        }
    }
    const shouldDisableChatSkills = isFollowupCommand
        && executionOptions.executionPath === 'direct'
        && executionOptions.forcedRouteMode !== 'task'
        && input.pickBooleanConfigValue(commandConfig, 'enableChatSkills') !== true;
    if (shouldDisableChatSkills) {
        patchExecutionOptions({
            enabledSkills: [],
            skillPrompt: undefined,
        });
    }

    const inheritedRequiredCompletionCapabilities = (
        isFollowupCommand
        && previousState?.turnContract?.mode === 'task'
        && executionOptions.forcedRouteMode === 'task'
    )
        ? normalizeCapabilityValues(previousState.turnContract.requiredCapabilities)
        : [];
    const baseRequiredCompletionCapabilities = (executionOptions.requiredCompletionCapabilities ?? []).length > 0
        ? (executionOptions.requiredCompletionCapabilities ?? [])
        : inheritedRequiredCompletionCapabilities;
    const augmentedRequiredCompletionCapabilities = maybeAppendArtifactWriteCapability(
        effectiveMessage,
        baseRequiredCompletionCapabilities,
    );
    setRequiredCompletionCapabilities(augmentedRequiredCompletionCapabilities);
    const turnContract = buildTaskTurnContract({
        message: effectiveMessage,
        workspacePath,
        mode: executionOptions.forcedRouteMode === 'task' ? 'task' : 'chat',
        route: executionOptions.executionPath === 'workflow' ? 'workflow' : 'direct',
        requiredCapabilities: executionOptions.requiredCompletionCapabilities,
        createdAt: new Date().toISOString(),
    });
    setRequiredCompletionCapabilities(turnContract.requiredCapabilities);
    patchExecutionOptions({
        turnContractHash: turnContract.hash,
        turnContractDomain: turnContract.domain,
    });
    const stateExecutionPath: TaskRuntimeExecutionPath = executionOptions.executionPath === 'direct'
        ? 'direct'
        : 'workflow';

    if (input.scheduleTaskIfNeeded && !skipImplicitSchedule) {
        const scheduleDecision = await input.scheduleTaskIfNeeded({
            sourceTaskId: taskId,
            title: requestedTitle ?? undefined,
            message: effectiveMessage,
            workspacePath,
            config: input.toRecord(payload.config),
        });
        if (scheduleDecision.error) {
            input.emitCurrent({
                success: false,
                taskId,
                error: scheduleDecision.error,
            });
            return true;
        }
        if (scheduleDecision.scheduled) {
            appendUserTranscript();
            upsertTaskStateWithDefaults({
                status: 'scheduled',
                executionPath: stateExecutionPath,
            });
            if (shouldEmitTaskLifecycleEvents) {
                input.emitTaskStarted({
                    taskId,
                    title: startedTaskTitle,
                    message: effectiveMessage,
                    workspacePath,
                    mode: resolveTaskStartedMode({
                        forcedRouteMode: executionOptions.forcedRouteMode,
                        executionPath: executionOptions.executionPath,
                        scheduled: true,
                    }),
                    scheduled: true,
                    turnId,
                });
            }
            const summary = scheduleDecision.summary ?? '已安排定时任务。';
            emitAcceptedSummary({
                summary,
                finishReason: 'scheduled',
            });
            return true;
        }
    }

    let messageDispatchToken:
        | {
            taskId: string;
            fingerprint: string;
        }
        | undefined;
    const completeMessageDispatch = (): void => {
        if (!messageDispatchToken || !input.completeTaskMessageDispatch) {
            return;
        }
        input.completeTaskMessageDispatch({
            taskId: messageDispatchToken.taskId,
            fingerprint: messageDispatchToken.fingerprint,
        });
        messageDispatchToken = undefined;
    };
    if (
        isFollowupCommand
        && !allowDuplicateTaskMessage
        && input.claimTaskMessageDispatch
    ) {
        const claim = input.claimTaskMessageDispatch({
            taskId,
            message: effectiveMessage,
            dedupeKey: buildTaskMessageDispatchKey({
                message: effectiveMessage,
                route: turnContract.route,
                mode: turnContract.mode,
                contractHash: turnContract.hash,
            }),
        });
        if (claim.deduplicated) {
            input.emitFor(followupResponseType, {
                success: true,
                taskId,
                accepted: true,
                deduplicated: true,
                dedupReason: claim.reason ?? 'in_flight',
                queuePosition: 0,
                turnId,
            });
            return true;
        }
        messageDispatchToken = claim.token;
    }

    appendUserTranscript();
    const state = upsertTaskStateWithDefaults({
        status: 'running',
        executionPath: stateExecutionPath,
        turnContract,
    });
    emitSessionAndTaskStartLifecycle(state, {
        forcedRouteMode: executionOptions.forcedRouteMode,
        executionPath: executionOptions.executionPath,
    }, startedTaskTitle);
    let queuedExecution: ReturnType<HandleStartOrSendTaskCommandInput['enqueueTaskExecution']>;
    try {
        queuedExecution = input.enqueueTaskExecution({
            taskId,
            turnId,
            run: () => input.executeTaskMessage({
                taskId,
                turnId,
                message: effectiveMessage,
                resourceId,
                preferredThreadId: state.conversationThreadId,
                workspacePath: state.workspacePath,
                executionOptions,
            }),
        });
    } catch (error) {
        completeMessageDispatch();
        throw error;
    }
    try {
        emitAcceptedResponse(queuedExecution.queuePosition);
    } catch (error) {
        completeMessageDispatch();
        throw error;
    }
    let executionPath: TaskRuntimeExecutionPath;
    try {
        executionPath = await queuedExecution.completion;
    } finally {
        completeMessageDispatch();
    }
    if (executionPath !== state.executionPath) {
        input.upsertTaskState(taskId, {
            executionPath,
        });
    }
    return true;
}
