import type { TaskRuntimeExecutionPath, TaskRuntimeRetryState, TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';
import { analyzeWorkRequest } from '../orchestration/workRequestAnalyzer';
import { parseRoutedInput } from '../orchestration/routedInput';
import {
    buildTaskMessageDispatchKey,
    buildTaskTurnContract,
    formatTaskCapabilityRequirement,
    resolveTaskCapabilityRequirements as resolveTaskCapabilityRequirementsFromRegistry,
    type TaskCapabilityRequirement,
} from './capabilityRegistry';

type UserMessageExecutionOptions = {
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

type StartOrSendCommandType = 'start_task' | 'send_task_message';

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

type HandleStartOrSendTaskCommandInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
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
    return commandType === 'start_task' || commandType === 'send_task_message';
}

const EXPLICIT_SCHEDULE_PREFIX = /^(?:创建|新建)?定时任务[：:\s,，、-]*/u;
const HIGH_RISK_HOST_ACTION_PATTERN = /\b(shutdown|reboot|poweroff|halt)\b|关机|重启/u;
const SPACED_ABSOLUTE_TIME_PATTERN = /(?:今天|明天|后天)?\s*(?:凌晨|早上|上午|中午|下午|晚上)?\s*[零〇一二两兩三四五六七八九十\d]{1,3}\s+点/u;
const DATABASE_OPERATION_PATTERN = /(连接(?:到)?数据库|数据库.*(?:查询|执行)|\b(?:mysql|postgres(?:ql)?|sqlite|database)\b|(?:select|insert|update|delete)\s+.+\s+from)/iu;
const SKILL_QUERY_SUBJECT_PATTERN = /\bskills?\b|技能|skill/iu;
const TOOL_QUERY_SUBJECT_PATTERN = /\btools?\b|\btoolpacks?\b|工具|toolpack/iu;
const CAPABILITY_QUERY_HINT_PATTERN = /[?？]|哪些|什么|列表|列出|有哪些|支持|可用|是否|能否|查看|当前|show|list|available|what|which|can\s+(?:use|call)/iu;
const CAPABILITY_QUERY_SHORT_PATTERN = /^\s*(?:skills?|tools?|toolpacks?|技能|工具)\s*[?？]?\s*$/iu;
const CAPABILITY_EXPLAIN_HINT_PATTERN = /说明|介绍|解释|用途|作用|怎么用|如何用|详情|明细|逐个|分别|含义|describe|explain|usage|what\s+is|what\s+does|tell\s+me\s+about/iu;
const CAPABILITY_REFERENCE_HINT_PATTERN = /\b(these|those|them)\b|这些|上述|以上|它们/u;
const GENERAL_CAPABILITY_QUERY_PATTERN = /你(?:能|可)做什么|你会什么|能帮我做什么|可以帮我做什么|what\s+can\s+you\s+do|what\s+are\s+you\s+capable\s+of|your\s+capabilities/iu;
const WEB_RESEARCH_AVAILABLE_TOOL_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|websearch|lookup|research)\b|股|行情|涨跌|天气|新闻|资讯|预报|查询|检索/iu;
const BROWSER_AVAILABLE_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill)\b/iu;
const TOOL_PREVIEW_LIMIT = 12;

function hasToolBackedCapabilityRequirement(requirements: TaskCapabilityRequirement[]): boolean {
    return requirements.length > 0;
}

function normalizeCapabilityValues(values: string[]): string[] {
    return Array.from(new Set(
        values
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    )).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' }));
}

function collectEnabledToolpackHints(snapshot: RuntimeCapabilitySnapshot | null): string[] {
    if (!snapshot) {
        return [];
    }
    const values: string[] = [];
    for (const toolpack of snapshot.toolpacks) {
        if (!toolpack.enabled) {
            continue;
        }
        if (typeof toolpack.id === 'string') {
            values.push(toolpack.id);
        }
        if (typeof toolpack.name === 'string') {
            values.push(toolpack.name);
        }
        if (typeof toolpack.description === 'string') {
            values.push(toolpack.description);
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

function collectCallableToolpackHints(snapshot: RuntimeCapabilitySnapshot | null): string[] {
    if (!snapshot) {
        return [];
    }
    const values: string[] = [];
    for (const toolpack of snapshot.toolpacks) {
        if (!toolpack.enabled) {
            continue;
        }
        const hasCallableTools = (
            toolpack.runtimeStatus === 'callable'
            || (typeof toolpack.callableToolCount === 'number' && toolpack.callableToolCount > 0)
        );
        if (!hasCallableTools) {
            continue;
        }
        if (typeof toolpack.id === 'string') {
            values.push(toolpack.id);
        }
        if (typeof toolpack.name === 'string') {
            values.push(toolpack.name);
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
    return false;
}

function formatRequirementLabel(requirement: TaskCapabilityRequirement): string {
    return formatTaskCapabilityRequirement(requirement);
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

    let runtimeToolsets: RuntimeToolsetMap = {};
    let runtimeToolsetLookupOk = false;
    let runtimeToolsetLookupTimedOut = false;
    const runtimeToolsetLookupTimeoutMs = (() => {
        const raw = Number.parseInt(process.env.COWORKANY_TASK_CAPABILITY_GATE_TOOLSET_TIMEOUT_MS ?? '', 10);
        if (!Number.isFinite(raw)) {
            return 1_500;
        }
        return Math.min(10_000, Math.max(200, Math.floor(raw)));
    })();
    if (input.listRuntimeToolsets) {
        try {
            runtimeToolsets = await Promise.race([
                Promise.resolve(input.listRuntimeToolsets()),
                new Promise<RuntimeToolsetMap>((_, reject) => {
                    setTimeout(() => reject(new Error(`runtime_toolset_timeout:${runtimeToolsetLookupTimeoutMs}`)), runtimeToolsetLookupTimeoutMs);
                }),
            ]);
            runtimeToolsetLookupOk = true;
        } catch (error) {
            runtimeToolsets = {};
            runtimeToolsetLookupOk = false;
            runtimeToolsetLookupTimedOut = String(error).includes('runtime_toolset_timeout:');
            if (runtimeToolsetLookupTimedOut) {
                console.warn('[coworkany-capability-gate] runtime toolset lookup timed out; bypassing strict gate for this turn.', {
                    timeoutMs: runtimeToolsetLookupTimeoutMs,
                });
            }
        }
    }

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
    const isRuntimeMcpStillLoading = Boolean(
        mcpSnapshot?.enabled
        && (
            runtimeToolsetLookupTimedOut
            || (
                runtimeToolsetLookupOk
                && runtimeToolHints.length === 0
                && mcpSnapshot.status !== 'ready'
            )
        ),
    );
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

    const requirementLabels = requirements.map(formatRequirementLabel).join(', ');
    const missingLabels = missingRequirements.map(formatRequirementLabel).join(', ');
    const summary = [
        '当前无法稳定执行该任务：缺少所需工具能力。',
        `required_capabilities=${requirementLabels}; missing_capabilities=${missingLabels}; mcp_enabled=${mcpEnabled === null ? 'unknown' : (mcpEnabled ? 'yes' : 'no')}; mcp_status=${mcpSnapshot?.status ?? 'unknown'}; mcp_allowed_servers=${mcpSnapshot?.allowedServerCount ?? 'unknown'}.`,
        `运行时工具预览：${truncateCapabilityPreview(runtimeToolHints)}`,
        `运行时可调用工具包预览：${truncateCapabilityPreview(callableConfiguredToolHints)}`,
        `已启用工具包预览：${truncateCapabilityPreview(configuredToolHints)}`,
        '请在 CoworkAny 中启用并加载对应工具后重试（例如 search_web、crawl_url、check_weather、get_news、browser_*）。',
    ].join('\n');

    return {
        ready: false,
        requirements,
        summary,
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
    return {
        executionPath: 'workflow',
        forcedRouteMode: 'task',
    };
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
    const rawMessage = commandType === 'start_task'
        ? input.getString(payload.userQuery)
        : input.getString(payload.content);
    if (!taskId || !rawMessage) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
    const previousState = input.taskStates.get(taskId);
    const routedMessage = parseRoutedInput(rawMessage);
    const message = routedMessage.cleanText.trim().length > 0
        ? routedMessage.cleanText
        : (
            routedMessage.forcedRouteMode
                ? (previousState?.lastUserMessage ?? '')
                : rawMessage
        );
    if (!message || message.trim().length === 0) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
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
        input.appendTranscript(taskId, 'user', message);
    };
    const workspacePath = input.getString(input.toRecord(payload.context).workspacePath) ?? process.cwd();
    const inferredCapabilityRequirements = resolveTaskCapabilityRequirements({
        message,
        workspacePath,
    });
    const commandConfig = input.toRecord(payload.config);
    const allowDuplicateTaskMessage = input.pickBooleanConfigValue(commandConfig, 'allowDuplicateTaskMessage') === true;
    const explicitEnabledSkills = input.pickStringArrayConfigValue(commandConfig, 'enabledSkills');
    const retryConfig = input.pickTaskRuntimeRetryConfig(commandConfig);
    const inheritedExecutionPath = input.toUserMessageExecutionPath(previousState?.executionPath);
    const configuredExecutionPath = input.pickTaskExecutionPath(commandConfig);
    const hasKnownExecutionPath = previousState?.executionPath === 'direct' || previousState?.executionPath === 'workflow';
    const defaultExecutionPath = (
        commandType === 'send_task_message'
        && routedMessage.forcedRouteMode !== 'task'
        && !hasKnownExecutionPath
    )
        ? 'direct'
        : inheritedExecutionPath;
    let resolvedExecutionPath = configuredExecutionPath ?? defaultExecutionPath;
    let resolvedForcedRouteMode = routedMessage.forcedRouteMode ?? (
        commandType === 'start_task'
            ? (resolvedExecutionPath === 'direct' ? 'chat' : 'task')
            : undefined
    );
    if (
        commandType === 'send_task_message'
        && routedMessage.forcedRouteMode == null
        && resolvedExecutionPath === 'direct'
    ) {
        resolvedForcedRouteMode = 'chat';
    }
    const shouldApplyStartTaskIntentRouting = commandType === 'start_task'
        && routedMessage.forcedRouteMode == null
        && configuredExecutionPath === undefined;
    if (shouldApplyStartTaskIntentRouting) {
        const intentRoute = resolveStartTaskIntentRoute({
            message,
            workspacePath,
            capabilityRequirements: inferredCapabilityRequirements,
        });
        resolvedExecutionPath = intentRoute.executionPath;
        resolvedForcedRouteMode = intentRoute.forcedRouteMode;
    }
    const shouldDisableChatSkillsByDefault = resolvedExecutionPath === 'direct'
        && routedMessage.forcedRouteMode !== 'task'
        && input.pickBooleanConfigValue(commandConfig, 'enableChatSkills') !== true;
    const resolvedSkillPrompt = shouldDisableChatSkillsByDefault
        ? {
            prompt: undefined,
            enabledSkillIds: [] as string[],
        }
        : (
            input.resolveSkillPrompt
                ? input.resolveSkillPrompt({
                    message,
                    workspacePath,
                    explicitEnabledSkills,
                })
                : {
                    prompt: undefined,
                    enabledSkillIds: explicitEnabledSkills ?? [],
                }
        );
    let executionOptions: UserMessageExecutionOptions = {
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
    const resourceId = input.resolveTaskResourceId(taskId, payload, previousState?.resourceId);
    const nextRetryState: TaskRuntimeRetryState | undefined = retryConfig
        ? retryConfig
        : (previousState?.retry
            ? {
                ...previousState.retry,
                attempts: 0,
                lastRetryAt: undefined,
                lastError: undefined,
            }
            : undefined);

    if (
        commandType === 'send_task_message'
        && input.cancelScheduledTasksForSourceTask
        && input.isScheduledCancellationRequest(message)
    ) {
        appendUserTranscript();
        const cancelled = await input.cancelScheduledTasksForSourceTask({
            sourceTaskId: taskId,
            userMessage: message,
        });
        input.upsertTaskState(taskId, {
            title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
            workspacePath,
            status: 'idle',
            suspended: false,
            suspensionReason: undefined,
            lastUserMessage: message,
            enabledSkills: resolvedSkillPrompt.enabledSkillIds,
            resourceId,
            checkpoint: undefined,
            retry: nextRetryState,
        });
        input.emitFor('send_task_message_response', {
            success: true,
            taskId,
            accepted: true,
            queuePosition: 0,
            turnId,
        });
        const cancellationSummary = cancelled.cancelledCount > 0
            ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
            : '没有可取消的定时任务。';
        input.emitTaskSummary({
            taskId,
            summary: cancellationSummary,
            finishReason: 'scheduled_cancel',
            turnId,
        });
        return true;
    }

    const capabilityQueryIntent = detectCapabilityQueryIntent(message);
    if (capabilityQueryIntent && input.listRuntimeCapabilities) {
        try {
            const capabilitySummary = buildCapabilitySummary(
                capabilityQueryIntent,
                await input.listRuntimeCapabilities(),
            );
            if (capabilitySummary) {
                appendUserTranscript();
                const state = input.upsertTaskState(taskId, {
                    title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
                    workspacePath,
                    status: 'idle',
                    suspended: false,
                    suspensionReason: undefined,
                    lastUserMessage: message,
                    enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                    resourceId,
                    checkpoint: undefined,
                    retry: nextRetryState,
                    executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
                });
                if (commandType === 'start_task') {
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
                        title: input.getString(payload.title) ?? 'Task',
                        message,
                        workspacePath,
                        mode: resolveTaskStartedMode({
                            forcedRouteMode: executionOptions.forcedRouteMode,
                            executionPath: executionOptions.executionPath,
                        }),
                        turnId,
                    });
                }
                input.emitCurrent({
                    success: true,
                    taskId,
                    accepted: true,
                    queuePosition: 0,
                    turnId,
                });
                input.emitTaskSummary({
                    taskId,
                    summary: capabilitySummary,
                    finishReason: 'capability_query',
                    turnId,
                });
                return true;
            }
        } catch {
            // Best-effort optimization; fall back to normal LLM execution on capability lookup failure.
        }
    }
    if (isGeneralCapabilityQuery(message) && input.listRuntimeCapabilities) {
        try {
            const capabilitySummary = buildGeneralCapabilitySummary(await input.listRuntimeCapabilities());
            appendUserTranscript();
            const state = input.upsertTaskState(taskId, {
                title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
                workspacePath,
                status: 'idle',
                suspended: false,
                suspensionReason: undefined,
                lastUserMessage: message,
                enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                resourceId,
                checkpoint: undefined,
                retry: nextRetryState,
                executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
            });
            if (commandType === 'start_task') {
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
                    title: input.getString(payload.title) ?? 'Task',
                    message,
                    workspacePath,
                    mode: resolveTaskStartedMode({
                        forcedRouteMode: executionOptions.forcedRouteMode,
                        executionPath: executionOptions.executionPath,
                    }),
                    turnId,
                });
            }
            input.emitCurrent({
                success: true,
                taskId,
                accepted: true,
                queuePosition: 0,
                turnId,
            });
            input.emitTaskSummary({
                taskId,
                summary: capabilitySummary,
                finishReason: 'capability_query',
                turnId,
            });
            return true;
        } catch {
            // Best-effort optimization; fall back to normal LLM execution on capability lookup failure.
        }
    }

    const hasExplicitSchedulePrefix = EXPLICIT_SCHEDULE_PREFIX.test(rawMessage);
    const isHighRiskHostAction = HIGH_RISK_HOST_ACTION_PATTERN.test(message);
    const hasSpacedAbsoluteTimeCue = SPACED_ABSOLUTE_TIME_PATTERN.test(message);
    const isDatabaseOperation = DATABASE_OPERATION_PATTERN.test(message);
    const skipImplicitSchedule =
        !routedMessage.usedEnvelope
        && !hasExplicitSchedulePrefix
        && isHighRiskHostAction
        && !hasSpacedAbsoluteTimeCue;
    if (skipImplicitSchedule) {
        executionOptions = {
            ...executionOptions,
            executionPath: 'direct',
            forcedRouteMode: 'task',
            useDirectChatResponder: undefined,
            forcePostAssistantCompletion: undefined,
        };
    }
    const shouldForceDatabaseTaskPath = isDatabaseOperation
        && routedMessage.forcedRouteMode !== 'chat';
    if (shouldForceDatabaseTaskPath) {
        executionOptions = {
            ...executionOptions,
            executionPath: 'direct',
            forcedRouteMode: 'task',
            useDirectChatResponder: undefined,
            forcePostAssistantCompletion: undefined,
        };
    }
    const shouldForceToolFirstTaskPath = hasToolBackedCapabilityRequirement(inferredCapabilityRequirements);
    if (shouldForceToolFirstTaskPath) {
        executionOptions = {
            ...executionOptions,
            executionPath: 'direct',
            forcedRouteMode: 'task',
            useDirectChatResponder: undefined,
            forcePostAssistantCompletion: undefined,
        };
    }
    const shouldRunTaskCapabilityGate = executionOptions.forcedRouteMode === 'task';
    if (shouldRunTaskCapabilityGate) {
        const taskCapabilityGate = await evaluateTaskCapabilityGate({
            message,
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
                message,
                workspacePath,
                mode: 'task',
                route: 'direct',
                requiredCapabilities: taskCapabilityGate.requirements.map(formatTaskCapabilityRequirement),
                createdAt: new Date().toISOString(),
            });
            const state = input.upsertTaskState(taskId, {
                title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
                workspacePath,
                status: 'idle',
                suspended: false,
                suspensionReason: undefined,
                lastUserMessage: message,
                enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                resourceId,
                checkpoint: undefined,
                retry: nextRetryState,
                executionPath: 'direct',
                turnContract,
            });
            if (commandType === 'start_task') {
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
                    title: input.getString(payload.title) ?? 'Task',
                    message,
                    workspacePath,
                    mode: resolveTaskStartedMode({
                        forcedRouteMode: 'task',
                        executionPath: 'direct',
                    }),
                    turnId,
                });
            }
            input.emitCurrent({
                success: true,
                taskId,
                accepted: true,
                queuePosition: 0,
                turnId,
            });
            input.emitTaskSummary({
                taskId,
                summary: taskCapabilityGate.summary,
                finishReason: 'capability_missing',
                turnId,
            });
            return true;
        }
        if (taskCapabilityGate.requirements.length > 0) {
            executionOptions = {
                ...executionOptions,
                requireToolEvidenceForCompletion: true,
                requiredCompletionCapabilities: taskCapabilityGate.requirements.map(formatRequirementLabel),
            };
        }
    }
    const shouldDisableChatSkills = commandType === 'send_task_message'
        && executionOptions.executionPath === 'direct'
        && executionOptions.forcedRouteMode !== 'task'
        && input.pickBooleanConfigValue(commandConfig, 'enableChatSkills') !== true;
    if (shouldDisableChatSkills) {
        executionOptions = {
            ...executionOptions,
            enabledSkills: [],
            skillPrompt: undefined,
        };
    }

    const turnContract = buildTaskTurnContract({
        message,
        workspacePath,
        mode: executionOptions.forcedRouteMode === 'task' ? 'task' : 'chat',
        route: executionOptions.executionPath === 'workflow' ? 'workflow' : 'direct',
        requiredCapabilities: executionOptions.requiredCompletionCapabilities,
        createdAt: new Date().toISOString(),
    });
    executionOptions = {
        ...executionOptions,
        requiredCompletionCapabilities: turnContract.requiredCapabilities,
        requireToolEvidenceForCompletion: turnContract.requiredCapabilities.length > 0,
        turnContractHash: turnContract.hash,
        turnContractDomain: turnContract.domain,
    };

    if (input.scheduleTaskIfNeeded && !skipImplicitSchedule) {
        const scheduleDecision = await input.scheduleTaskIfNeeded({
            sourceTaskId: taskId,
            title: input.getString(payload.title) ?? undefined,
            message,
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
            input.upsertTaskState(taskId, {
                title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
                workspacePath,
                status: 'scheduled',
                suspended: false,
                suspensionReason: undefined,
                lastUserMessage: message,
                enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                resourceId,
                checkpoint: undefined,
                retry: nextRetryState,
                executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
            });
            if (commandType === 'start_task') {
                input.emitTaskStarted({
                    taskId,
                    title: input.getString(payload.title) ?? 'Task',
                    message,
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
            input.emitCurrent({
                success: true,
                taskId,
                accepted: true,
                queuePosition: 0,
                turnId,
            });
            const summary = scheduleDecision.summary ?? '已安排定时任务。';
            input.emitTaskSummary({
                taskId,
                summary,
                finishReason: 'scheduled',
                turnId,
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
    if (
        commandType === 'send_task_message'
        && !allowDuplicateTaskMessage
        && input.claimTaskMessageDispatch
    ) {
        const claim = input.claimTaskMessageDispatch({
            taskId,
            message,
            dedupeKey: buildTaskMessageDispatchKey({
                message,
                route: turnContract.route,
                mode: turnContract.mode,
                contractHash: turnContract.hash,
            }),
        });
        if (claim.deduplicated) {
            input.emitFor('send_task_message_response', {
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
    const state = input.upsertTaskState(taskId, {
        title: input.getString(payload.title) ?? input.taskStates.get(taskId)?.title ?? 'Task',
        workspacePath,
        status: 'running',
        suspended: false,
        suspensionReason: undefined,
        lastUserMessage: message,
        enabledSkills: resolvedSkillPrompt.enabledSkillIds,
        resourceId,
        checkpoint: undefined,
        retry: nextRetryState,
        executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
        turnContract,
    });
    if (commandType === 'start_task') {
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
            title: input.getString(payload.title) ?? 'Task',
            message,
            workspacePath,
            mode: resolveTaskStartedMode({
                forcedRouteMode: executionOptions.forcedRouteMode,
                executionPath: executionOptions.executionPath,
            }),
            turnId,
        });
    }
    let queuedExecution: ReturnType<HandleStartOrSendTaskCommandInput['enqueueTaskExecution']>;
    try {
        queuedExecution = input.enqueueTaskExecution({
            taskId,
            turnId,
            run: () => input.executeTaskMessage({
                taskId,
                turnId,
                message,
                resourceId,
                preferredThreadId: state.conversationThreadId,
                workspacePath: state.workspacePath,
                executionOptions,
            }),
        });
    } catch (error) {
        if (messageDispatchToken && input.completeTaskMessageDispatch) {
            input.completeTaskMessageDispatch({
                taskId: messageDispatchToken.taskId,
                fingerprint: messageDispatchToken.fingerprint,
            });
        }
        throw error;
    }
    try {
        input.emitCurrent({
            success: true,
            taskId,
            accepted: true,
            queuePosition: queuedExecution.queuePosition,
            turnId,
        });
    } catch (error) {
        if (messageDispatchToken && input.completeTaskMessageDispatch) {
            input.completeTaskMessageDispatch({
                taskId: messageDispatchToken.taskId,
                fingerprint: messageDispatchToken.fingerprint,
            });
        }
        throw error;
    }
    let executionPath: TaskRuntimeExecutionPath;
    try {
        executionPath = await queuedExecution.completion;
    } finally {
        if (messageDispatchToken && input.completeTaskMessageDispatch) {
            input.completeTaskMessageDispatch({
                taskId: messageDispatchToken.taskId,
                fingerprint: messageDispatchToken.fingerprint,
            });
        }
    }
    if (executionPath !== state.executionPath) {
        input.upsertTaskState(taskId, {
            executionPath,
        });
    }
    return true;
}
