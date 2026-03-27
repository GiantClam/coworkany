import * as fs from 'fs';
import * as path from 'path';
import {
    markWorkRequestPresentationStarted,
    markWorkRequestReductionStarted,
    reopenPreparedWorkRequestForExecution,
    reopenPreparedWorkRequestForResearch,
    type PreparedWorkRequestContext,
} from '../orchestration/workRequestRuntime';
import type {
    ExecutionRequirementCapability,
    ReplanTrigger,
    RuntimeIsolationPolicy,
} from '../orchestration/workRequestSchema';
import { type ToolDefinition } from '../tools/standard';
import { type ExecutionResultReporter } from './resultReporter';
import { type ExecutionSession } from './session';
import type { LocalTaskPlanHint } from '../orchestration/localTaskIntent';
import { TaskCancelledError } from './taskCancellationRegistry';
import { cleanScheduledTaskResultText } from '../scheduling/scheduledTaskPresentation';

export type ExecutionTaskConfig = {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    disabledTools?: string[];
    workspacePath?: string;
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
};

export type ExecutionStreamOptions = {
    modelId?: string;
    maxTokens?: number;
    systemPrompt?: string | { skills: string };
    tools?: ToolDefinition[];
};

export type ExecutionRuntimeResult = {
    success: boolean;
    summary: string;
    error?: string;
    artifactsCreated: string[];
    toolsUsed?: string[];
};

type AgentLoopResult = {
    artifactsCreated: string[];
    toolsUsed: string[];
};

type CapabilityAcquisitionResult =
    | {
        outcome: 'reused';
        summary: string;
    }
    | {
        outcome: 'learned';
        summary: string;
    }
    | {
        outcome: 'review_required';
        summary: string;
    }
    | {
        outcome: 'blocked';
        summary: string;
        blockerType?: 'external_auth' | 'manual_step';
    }
    | {
        outcome: 'failed';
        summary: string;
        error?: string;
    };

type AutonomousTaskResult = {
    createdAt: string;
    summary?: string;
    decomposedTasks: Array<{ status: string }>;
    verificationResult?: { goalMet: boolean };
};

type ArtifactEvaluationResult = {
    passed: boolean;
    failed: Array<{ description: string; reason: string }>;
};

type DegradedOutputResult = {
    hasDegradedOutput: boolean;
    degradedArtifacts: string[];
};

type MarketplaceInstallIntent = {
    marketplace: 'auto' | 'skillhub' | 'github' | 'clawhub';
    source: string;
};

export type ExecutionRuntimeDeps = {
    shouldRunAutonomously: (query: string) => boolean;
    prepareAutonomousProvider: (config?: ExecutionTaskConfig) => void;
    getAutonomousAgent: (taskId: string) => {
        startTask: (
            query: string,
            options: {
                autoSaveMemory: boolean;
                notifyOnComplete: boolean;
                runInBackground: boolean;
                sessionTaskId?: string;
                workspacePath?: string;
            }
        ) => Promise<AutonomousTaskResult>;
    };
    tryDeterministicResearchArtifactFallback: (
        taskId: string,
        query: string
    ) => Promise<string | null>;
    tryPptGeneratorSkillFastPath: (
        taskId: string,
        userQuery: string,
        workspacePath: string,
        enabledSkillIds?: string[]
    ) => Promise<{ summary: string; artifactsCreated: string[] } | null>;
    getTriggeredSkillIds: (userMessage: string) => string[];
    mergeSkillIds: (...skillGroups: Array<string[] | undefined>) => string[];
    buildSkillSystemPrompt: (
        skillIds: string[] | undefined
    ) => string | { skills: string } | undefined;
    getDirectivePromptAdditions?: (query: string) => string | undefined;
    mergeSystemPrompt: (
        basePrompt: string | { skills: string } | undefined,
        extraPrompt: string | undefined
    ) => string | { skills: string } | undefined;
    ensureToolpacksRegistered: (toolpackIds?: string[]) => Promise<void>;
    getToolsForTask: (taskId: string) => ToolDefinition[];
    executeTool: (
        taskId: string,
        toolName: string,
        args: Record<string, unknown>,
        context: { workspacePath: string }
    ) => Promise<any>;
    buildProviderConfig: (options: ExecutionStreamOptions) => unknown;
    runAgentLoop: (
        taskId: string,
        conversation: any,
        options: ExecutionStreamOptions,
        providerConfig: any,
        tools: ToolDefinition[],
        executionContext?: {
            frozenWorkRequest?: PreparedWorkRequestContext['frozenWorkRequest'];
        }
    ) => Promise<AgentLoopResult>;
    session: ExecutionSession;
    reporter: ExecutionResultReporter;
    evaluateArtifactContract: (
        artifactContract: any,
        evidence: { files: string[]; toolsUsed: string[]; outputText: string }
    ) => ArtifactEvaluationResult;
    detectDegradedOutputs: (
        artifactContract: any,
        artifacts: string[]
    ) => DegradedOutputResult;
    buildArtifactTelemetry: (
        artifactContract: any,
        evidence: { files: string[]; toolsUsed: string[]; outputText: string },
        evaluation: any
    ) => unknown;
    reduceWorkResult: (input: {
        canonicalResult: string;
        request: PreparedWorkRequestContext['frozenWorkRequest'];
        artifacts?: string[];
    }) => { canonicalResult: string; uiSummary: string; ttsSummary: string; artifacts: string[] };
    markWorkRequestExecutionStarted: (
        prepared: PreparedWorkRequestContext
    ) => void;
    markWorkRequestExecutionCompleted: (
        prepared: PreparedWorkRequestContext,
        summary: string
    ) => void;
    refreezePreparedWorkRequestForResearch: (input: {
        prepared: PreparedWorkRequestContext;
        reason: string;
        trigger: ReplanTrigger;
    }) => Promise<PreparedWorkRequestContext>;
    emitContractReopened: (
        taskId: string,
        payload: {
            summary: string;
            reason: string;
            trigger: ReplanTrigger;
            reasons?: string[];
            diff?: {
                changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
                modeChanged?: { before: string; after: string };
                objectiveChanged?: { before: string; after: string };
                deliverablesChanged?: { before: string[]; after: string[] };
                targetsChanged?: { before: string[]; after: string[] };
                workflowsChanged?: { before: string[]; after: string[] };
            };
            nextStepId?: string;
        }
    ) => void;
    emitPreparedWorkRequestRefrozen: (
        input: {
            taskId: string;
            prepared: PreparedWorkRequestContext;
            reason: string;
            trigger: ReplanTrigger;
        }
    ) => Promise<{
        blocked: boolean;
        summary?: string;
    }> | {
        blocked: boolean;
        summary?: string;
    };
    emitPlanUpdated: (taskId: string, prepared: PreparedWorkRequestContext) => void;
    activatePreparedWorkRequest: (taskId: string, prepared: PreparedWorkRequestContext) => void;
    clearPreparedWorkRequest: (taskId: string) => void;
    markWorkRequestExecutionFailed: (
        prepared: PreparedWorkRequestContext,
        error: string
    ) => void;
    acquireCapabilityForTask?: (input: {
        taskId: string;
        preparedWorkRequest: PreparedWorkRequestContext;
        userMessage: string;
    }) => Promise<CapabilityAcquisitionResult>;
    quickLearnFromError?: (
        error: string,
        query: string,
        severity: number
    ) => Promise<{ learned: boolean }>;
    assessExecutionProtocol?: (input: {
        executionQuery: string;
        outputText: string;
        toolsUsed: string[];
        hasBlockingUserAction: boolean;
        toolResultText?: string;
    }) => Promise<{
        asksForAdditionalUserAction: boolean;
        objectiveRefusal?: boolean;
        objectiveSatisfied?: boolean;
        objectiveGap?: string;
        requestedEvidence: 'grounded' | 'standard' | 'unknown';
        deliveredEvidence: 'grounded' | 'metadata' | 'none' | 'unknown';
        completionClaim?: 'present' | 'absent' | 'unknown';
        verificationEvidence?: 'present' | 'absent' | 'unknown';
        confidence?: number;
        rationale?: string;
    } | null>;
};

function extractMarketplaceInstallIntent(text: string): MarketplaceInstallIntent | null {
    const trimmed = text.trim();
    if (!trimmed || !/(安装|install)/i.test(trimmed)) {
        return null;
    }

    const extractTrailingSource = (): string | null => {
        const installMatch = trimmed.match(/(?:安装|install)/i);
        if (!installMatch || typeof installMatch.index !== 'number') {
            return null;
        }

        const tail = trimmed.slice(installMatch.index + installMatch[0].length)
            .trim()
            .replace(/^(?:(?:一个|一下|这个|该|技能|从|from|via|在|中|的|使用)\s+)*/i, '')
            .replace(/^(?:skillhub|github|clawhub)(?:\s*(?:中|上|里|repo|仓库))?\s*/i, '')
            .trim();

        const tokenMatch = tail.match(/^([A-Za-z0-9._/-]+)/);
        return tokenMatch?.[1] ?? null;
    };

    const githubMatch = trimmed.match(/(github:[^\s，。；,;]+|https?:\/\/github\.com\/[^\s，。；,;]+)/i);
    if (githubMatch) {
        return {
            marketplace: 'github',
            source: githubMatch[1],
        };
    }

    if (/github/i.test(trimmed)) {
        const source = extractTrailingSource();
        if (source && source.includes('/')) {
            return {
                marketplace: 'github',
                source,
            };
        }
    }

    const explicitClawhub = /clawhub/i.test(trimmed);
    const explicitSkillhub = /skillhub/i.test(trimmed);
    const explicitCoworkanySkill = /(coworkany|技能|skill|marketplace)/i.test(trimmed);
    if (!explicitClawhub && !explicitSkillhub && !explicitCoworkanySkill) {
        return null;
    }

    const source = extractTrailingSource();
    if (!source) {
        return null;
    }

    return {
        marketplace: explicitClawhub ? 'clawhub' : explicitSkillhub ? 'skillhub' : 'auto',
        source,
    };
}

async function tryMarketplaceSkillInstallFastPath(input: {
    taskId: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult | null> {
    const disabledTools = input.config?.disabledTools ?? [];
    if (Array.isArray(disabledTools) && disabledTools.includes('install_coworkany_skill_from_marketplace')) {
        return null;
    }

    const intent = extractMarketplaceInstallIntent(input.preparedWorkRequest.executionQuery);
    if (!intent) {
        return null;
    }

    const result = await deps.executeTool(
        input.taskId,
        'install_coworkany_skill_from_marketplace',
        {
            source: intent.source,
            marketplace: intent.marketplace,
        },
        { workspacePath: input.workspacePath }
    );

    const message = typeof result?.message === 'string'
        ? result.message
        : typeof result?.error === 'string'
            ? result.error
            : 'Marketplace install completed.';

    if (result?.needsClarification) {
        deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, message);
        deps.reporter.finished({
            summary: message,
            artifactsCreated: [],
            duration: Date.now() - input.startedAt,
        });
        return {
            success: true,
            summary: message,
            artifactsCreated: [],
        };
    }

    if (result?.success) {
        deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, message);
        deps.reporter.finished({
            summary: message,
            artifactsCreated: [],
            duration: Date.now() - input.startedAt,
        });
        return {
            success: true,
            summary: message,
            artifactsCreated: [],
        };
    }

    deps.markWorkRequestExecutionFailed(input.preparedWorkRequest, message);
    deps.reporter.failed({
        error: message,
        errorCode: 'MARKETPLACE_INSTALL_FAILED',
        recoverable: Boolean(result?.needsClarification),
        suggestion: result?.needsClarification
            ? 'Provide a specific marketplace slug or repository source.'
            : undefined,
    });
    return {
        success: false,
        summary: message,
        error: typeof result?.error === 'string' ? result.error : message,
        artifactsCreated: [],
    };
}

function canReopenForTrigger(
    preparedWorkRequest: PreparedWorkRequestContext,
    trigger: ReplanTrigger,
    contractReopenAttempts: number,
    maxContractReopenAttempts = 1
): boolean {
    return Boolean(
        preparedWorkRequest.frozenWorkRequest.replanPolicy?.allowReturnToResearch === true &&
        (preparedWorkRequest.frozenWorkRequest.replanPolicy?.triggers ?? []).includes(trigger) &&
        contractReopenAttempts < maxContractReopenAttempts
    );
}

function collectPlannedArtifactFilesFromDisk(
    artifactContract: unknown,
    workspacePath: string
): string[] {
    if (!artifactContract || typeof artifactContract !== 'object') {
        return [];
    }

    const requirements = (artifactContract as { requirements?: unknown }).requirements;
    if (!Array.isArray(requirements)) {
        return [];
    }

    const discovered = new Set<string>();

    for (const requirement of requirements) {
        if (!requirement || typeof requirement !== 'object') {
            continue;
        }

        const normalizedRequirement = requirement as {
            kind?: unknown;
            payload?: { path?: unknown };
        };
        if (normalizedRequirement.kind !== 'file') {
            continue;
        }

        const requiredPath =
            typeof normalizedRequirement.payload?.path === 'string'
                ? normalizedRequirement.payload.path.trim()
                : '';
        if (!requiredPath) {
            continue;
        }

        const resolvedPath = path.isAbsolute(requiredPath)
            ? requiredPath
            : path.resolve(workspacePath, requiredPath);
        try {
            const stats = fs.statSync(resolvedPath);
            if (stats.isFile()) {
                discovered.add(resolvedPath);
            }
        } catch {
            // Missing file; keep artifact evidence unchanged.
        }
    }

    return Array.from(discovered);
}

function isPathWithinWorkspace(workspacePath: string, resolvedPath: string): boolean {
    const relative = path.relative(workspacePath, resolvedPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function materializeMissingMarkdownDeliverables(input: {
    preparedWorkRequest: PreparedWorkRequestContext;
    workspacePath: string;
    outputText: string;
    knownArtifacts: string[];
}): string[] {
    const output = input.outputText.trim();
    if (!output) {
        return [];
    }

    const deliverables = input.preparedWorkRequest.frozenWorkRequest.deliverables ?? [];
    if (deliverables.length === 0) {
        return [];
    }

    const knownResolvedArtifacts = new Set(
        input.knownArtifacts.map((artifactPath) =>
            path.isAbsolute(artifactPath)
                ? artifactPath
                : path.resolve(input.workspacePath, artifactPath)
        )
    );
    const createdArtifacts: string[] = [];

    for (const deliverable of deliverables) {
        if (!deliverable.required) {
            continue;
        }
        if (deliverable.type !== 'report_file' && deliverable.type !== 'artifact_file') {
            continue;
        }
        if (typeof deliverable.path !== 'string' || deliverable.path.trim().length === 0) {
            continue;
        }

        const plannedPath = deliverable.path.trim();
        const inferredExtension = path.extname(plannedPath).toLowerCase();
        const deliverableFormat =
            typeof deliverable.format === 'string'
                ? deliverable.format.trim().toLowerCase()
                : '';
        const extension = inferredExtension || (deliverableFormat ? `.${deliverableFormat}` : '');
        if (extension !== '.md') {
            continue;
        }

        const resolvedPath = path.isAbsolute(plannedPath)
            ? plannedPath
            : path.resolve(input.workspacePath, plannedPath);
        if (!isPathWithinWorkspace(input.workspacePath, resolvedPath)) {
            continue;
        }
        if (knownResolvedArtifacts.has(resolvedPath)) {
            continue;
        }

        try {
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            fs.writeFileSync(resolvedPath, output.endsWith('\n') ? output : `${output}\n`, 'utf-8');
            createdArtifacts.push(resolvedPath);
            knownResolvedArtifacts.add(resolvedPath);
        } catch (error) {
            console.warn('[ExecutionRuntime] Failed to materialize markdown deliverable:', error);
        }
    }

    return createdArtifacts;
}

const GROUNDED_INSPECTION_TOOLS = new Set([
    'view_file',
    'list_dir',
    'run_command',
    'search_web',
    'crawl_url',
    'extract_content',
    'browser_get_content',
    'get_coworkany_skill',
    'get_coworkany_config',
    'get_coworkany_paths',
]);

const METADATA_ONLY_TOOLS = new Set([
    'list_coworkany_skills',
    'list_coworkany_workspaces',
    'get_coworkany_paths',
    'get_coworkany_config',
]);

const GROUNDED_INSPECTION_INTENT_PATTERN = new RegExp(
    [
        'audit',
        'review',
        'inspect',
        'inspection',
        'investigate',
        'verification',
        'verify',
        'root\\s*cause',
        'triage',
        'diagnos',
        'code\\s*review',
        '审计',
        '复核',
        '复盘',
        '核查',
        '排查',
        '诊断',
        '深入分析',
        '检查',
        '核验',
        '验收',
    ].join('|'),
    'i',
);

const WEB_RESEARCH_TOOLS = new Set([
    'search_web',
    'crawl_url',
    'extract_content',
    'get_news',
    'browser_get_content',
]);

const BROWSER_INTERACTION_EVIDENCE_TOOLS = [
    'browser_navigate',
    'browser_click',
    'browser_fill',
    'browser_execute_script',
] as const;

function collectRequiredToolEvidenceCapabilities(prepared: PreparedWorkRequestContext): ExecutionRequirementCapability[] {
    const capabilities = new Set<ExecutionRequirementCapability>();
    for (const task of prepared.frozenWorkRequest.tasks ?? []) {
        for (const requirement of task.executionRequirements ?? []) {
            if (requirement.kind === 'tool_evidence' && requirement.required) {
                capabilities.add(requirement.capability);
            }
        }
    }
    return Array.from(capabilities);
}

function hasBrowserInteractionEvidence(toolsUsed: string[]): boolean {
    const used = new Set(toolsUsed);
    if (used.has('browser_ai_action') || used.has('xiaohongshu_post')) {
        return true;
    }
    const hasConnect = used.has('browser_connect');
    const hasInteractiveAction = BROWSER_INTERACTION_EVIDENCE_TOOLS.some((tool) => used.has(tool));
    return hasConnect && hasInteractiveAction;
}

function hasRequiredToolEvidenceCapability(
    capability: ExecutionRequirementCapability,
    toolsUsed: string[],
): boolean {
    switch (capability) {
        case 'browser_interaction':
            return hasBrowserInteractionEvidence(toolsUsed);
        default:
            return true;
    }
}

function hasGroundedInspectionToolEvidence(toolsUsed: string[]): boolean {
    return toolsUsed.some((tool) => GROUNDED_INSPECTION_TOOLS.has(tool));
}

function requiresSourceLinksInFinalOutput(input: {
    prepared: PreparedWorkRequestContext;
    executionQuery: string;
    toolsUsed: string[];
}): boolean {
    const mode = input.prepared.frozenWorkRequest.mode;
    if (mode === 'chat') {
        return false;
    }

    const hasRequiredWebResearch = (input.prepared.frozenWorkRequest.researchQueries ?? []).some((query) =>
        query.required && query.source === 'web' && query.status !== 'skipped'
    );
    if (hasRequiredWebResearch) {
        return true;
    }

    const usedWebResearchTools = input.toolsUsed.some((tool) => WEB_RESEARCH_TOOLS.has(tool));
    if (usedWebResearchTools) {
        return true;
    }

    const sourceSignal = `${input.executionQuery}\n${input.prepared.frozenWorkRequest.sourceText ?? ''}`.trim();
    return /(检索|搜索|查找|查询|news|latest|最新|官方|来源|source|evidence|证据)/i
        .test(sourceSignal);
}

function shouldBypassAutonomousFallback(prepared: PreparedWorkRequestContext): boolean {
    const mode = prepared.frozenWorkRequest.mode;
    if (mode === 'chat') {
        return false;
    }

    const hasRequiredWebResearch = (prepared.frozenWorkRequest.researchQueries ?? []).some((query) =>
        query.required && query.source === 'web' && query.status !== 'skipped'
    );
    if (hasRequiredWebResearch) {
        return true;
    }

    const query = (prepared.executionQuery || prepared.frozenWorkRequest.sourceText || '').trim();
    if (!query) {
        return false;
    }

    return /(检索|搜索|查找|查询|research|latest|最新|新闻|news|来源|source|证据|evidence)/i.test(query);
}

function hasHyperlink(text: string): boolean {
    return /https?:\/\/[^\s)\]]+/i.test(text);
}

function extractHyperlinks(text: string): string[] {
    if (!text.trim()) {
        return [];
    }
    const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawUrl of matches) {
        const url = rawUrl.replace(/[.,;:!?]+$/g, '');
        if (!url || seen.has(url)) {
            continue;
        }
        seen.add(url);
        normalized.push(url);
    }
    return normalized;
}

function stripTrailingExecutionFollowup(text: string): string {
    let cleaned = cleanScheduledTaskResultText(text).trim();
    const patterns: RegExp[] = [
        /\n{1,}(?:如果你愿意|如果你同意|如需我继续|如果需要我继续|我下一步可以|我可以下一步)[\s\S]*$/u,
        /\n{1,}(?:if you want|if you'd like|if needed)[\s\S]*$/iu,
    ];
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, '').trim();
    }
    return cleaned;
}

function ensureFinalOutputHasSourceLinks(input: {
    outputText: string;
    prepared: PreparedWorkRequestContext;
    executionQuery: string;
    toolsUsed: string[];
    conversationText: string;
}): string {
    const base = stripTrailingExecutionFollowup(input.outputText);
    if (
        !requiresSourceLinksInFinalOutput({
            prepared: input.prepared,
            executionQuery: input.executionQuery,
            toolsUsed: input.toolsUsed,
        })
    ) {
        return base;
    }
    if (hasHyperlink(base)) {
        return base;
    }

    const sourceLinks = extractHyperlinks(input.conversationText).slice(0, 6);
    if (sourceLinks.length === 0) {
        return base;
    }

    const heading = /[\u4e00-\u9fff]/.test(input.prepared.frozenWorkRequest.sourceText ?? '')
        ? '来源链接'
        : 'Sources';
    return `${base}\n\n${heading}:\n${sourceLinks.map((url) => `- ${url}`).join('\n')}`;
}

function isMetadataOnlyExecution(toolsUsed: string[]): boolean {
    return toolsUsed.length > 0 && toolsUsed.every((tool) => METADATA_ONLY_TOOLS.has(tool));
}

function contractDemandsGroundedInspection(
    prepared: PreparedWorkRequestContext,
    executionQuery?: string,
): boolean {
    const tasks = prepared.frozenWorkRequest.tasks ?? [];
    const semanticScope = [
        executionQuery ?? '',
        prepared.frozenWorkRequest.sourceText ?? '',
        ...tasks.flatMap((task) => [
            task.title,
            task.objective,
            ...(task.constraints ?? []),
            ...(task.acceptanceCriteria ?? []),
        ]),
    ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n');

    return GROUNDED_INSPECTION_INTENT_PATTERN.test(semanticScope);
}

function objectiveDemandsExplicitBuyPrice(prepared: PreparedWorkRequestContext, executionQuery: string): boolean {
    const taskText = [
        executionQuery,
        ...((prepared.frozenWorkRequest.tasks ?? []).flatMap((task) => [
            task.objective,
            ...(task.acceptanceCriteria ?? []),
        ])),
    ].join('\n');

    return /(买入价|买入价格|买入区间|建仓价|建仓区间|入场价|买点|目标价|target price|entry price|buy price|buy range|entry range|price range|at what price)/i
        .test(taskText);
}

function extractPriceDeliverySignals(outputText: string): {
    hasPriceValue: boolean;
    hasBuyContext: boolean;
    hasTimeAnchor: boolean;
} {
    const hasPriceValue = /(?:HK\$|US\$|CNY|RMB|USD|￥|¥|\$)?\s*\d{1,6}(?:\.\d{1,4})?(?:\s*(?:-|~|～|至|到)\s*(?:HK\$|US\$|CNY|RMB|USD|￥|¥|\$)?\s*\d{1,6}(?:\.\d{1,4})?)?/.test(outputText);
    const hasBuyContext = /(买入|建仓|入场|买点|目标价|价格区间|buy|entry|accumulate|target)/i.test(outputText);
    const hasTimeAnchor = /(截至|时间|日期|交易日|盘中|收盘|北京时间|UTC|today|as of|session|close|open|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b)/i
        .test(outputText);
    return {
        hasPriceValue,
        hasBuyContext,
        hasTimeAnchor,
    };
}

function hasPlannedBlockingUserAction(prepared: PreparedWorkRequestContext): boolean {
    const request = prepared.frozenWorkRequest;
    if (request.clarification.required) {
        return true;
    }
    const userActions = request.userActionsRequired ?? [];
    return userActions.some((action) => action?.blocking === true);
}

function isLikelyCapabilityRefusal(outputText: string): boolean {
    const trimmed = outputText.trim();
    if (!trimmed) {
        return false;
    }

    const refusalPatterns = [
        /\b(?:i|we)\s+(?:cannot|can't|am unable to)\s+(?:directly\s+)?(?:access|log\s*in|login|post|publish|operate|perform)\b/i,
        /\b(?:cannot|can't|unable to)\b.{0,40}\b(?:account|twitter|x\.com|website|browser)\b/i,
        /(?:我|当前).{0,8}(?:无法|不能|没法|不可以).{0,30}(?:替你|为你|直接)?(?:操作|发布|发帖|登录|访问|执行|处理)/u,
        /(?:无法|不能).{0,30}(?:账号|账户).{0,20}(?:操作|发布|发帖|登录|访问)/u,
    ];

    return refusalPatterns.some((pattern) => pattern.test(trimmed));
}

function isLikelyApprovalGateRequest(outputText: string): boolean {
    const trimmed = outputText.trim();
    if (!trimmed) {
        return false;
    }

    const approvalPatterns: RegExp[] = [
        /请你确认[^。！？\n]{0,80}(?:后|之后)?(?:我|我就|我会|再|然后)/u,
        /你说的[^。！？\n]{0,80}(?:是指|指的是)[^。！？\n]{0,80}(?:吗|么)/u,
        /(?:是要|要不要|还是要)[^。！？\n]{0,80}(?:还是|或者)/u,
        /(?:先给你看草稿再发|先给你看草稿|先看草稿再发|直接发正式内容还是先给你看草稿再发)/u,
        /如果你(?:愿意|同意|确认|批准)[^。！？\n]{0,50}(?:我|我就|我可以|我下一步|我会)/u,
        /(?:我下一步可以|我可以下一步|你回复一句|请回复|请选择)[^。！？\n]{0,50}(?:继续|执行|开始|确认)/u,
        /if you (?:want|agree|approve|confirm)[^.!?\n]{0,80}(?:i|i'll|i will)/i,
        /please (?:reply|confirm|approve)[^.!?\n]{0,60}(?:continue|proceed|execute|start)/i,
    ];
    return approvalPatterns.some((pattern) => pattern.test(trimmed));
}

async function evaluateExecutionProtocolCompliance(input: {
    preparedWorkRequest: PreparedWorkRequestContext;
    executionQuery: string;
    toolsUsed: string[];
    outputText: string;
    assessExecutionProtocol?: ExecutionRuntimeDeps['assessExecutionProtocol'];
}): Promise<{
    trigger: ReplanTrigger;
    error: string;
    suggestion: string;
    recoveryStage: 'research' | 'execution';
} | null> {
    const hasBlockingUserAction = hasPlannedBlockingUserAction(input.preparedWorkRequest);
    const assessedProtocol = await input.assessExecutionProtocol?.({
        executionQuery: input.executionQuery,
        outputText: input.outputText,
        toolsUsed: input.toolsUsed,
        hasBlockingUserAction,
    });
    const asksForAdditionalUserAction =
        assessedProtocol?.asksForAdditionalUserAction === true ||
        isLikelyApprovalGateRequest(input.outputText);
    const objectiveRefusal = assessedProtocol?.objectiveRefusal === true || isLikelyCapabilityRefusal(input.outputText);
    const objectiveSatisfied = assessedProtocol?.objectiveSatisfied;
    const requestsBlockingAdditionalAction = asksForAdditionalUserAction;

    if (
        requestsBlockingAdditionalAction &&
        !hasBlockingUserAction
    ) {
        return {
            trigger: 'contradictory_evidence',
            error:
                'Execution protocol unmet: final response requested additional user approval/execution, ' +
                'but the frozen contract has no blocking user-action checkpoint.',
            suggestion:
                'Continue execution and provide evidence directly. Only request user action when the contract ' +
                'explicitly blocks or a new hard blocker is surfaced.',
            recoveryStage: 'execution',
        };
    }

    if (objectiveRefusal && !hasBlockingUserAction) {
        return {
            trigger: 'contradictory_evidence',
            error:
                'Execution protocol unmet: final response refused the core task objective, ' +
                'but the frozen contract has no blocking checkpoint requiring refusal.',
            suggestion:
                'Continue execution toward the requested objective with explicit uncertainty and risk language. ' +
                'Do not stop at refusal unless a concrete technical blocker is surfaced.',
            recoveryStage: 'execution',
        };
    }

    if (objectiveSatisfied === false && !hasBlockingUserAction) {
        return {
            trigger: 'contradictory_evidence',
            error:
                `Execution protocol unmet: final response did not satisfy the frozen objective. ` +
                `${assessedProtocol?.objectiveGap || 'Missing required objective deliverable.'}`,
            suggestion:
                'Re-run the task against the frozen acceptance criteria and deliver the missing objective output directly.',
            recoveryStage: 'execution',
        };
    }

    if (objectiveDemandsExplicitBuyPrice(input.preparedWorkRequest, input.executionQuery) && !hasBlockingUserAction) {
        const priceSignals = extractPriceDeliverySignals(input.outputText);
        if (!priceSignals.hasPriceValue || !priceSignals.hasBuyContext || !priceSignals.hasTimeAnchor) {
            return {
                trigger: 'contradictory_evidence',
                error:
                    'Execution protocol unmet: buy-price objective requires explicit price values and a concrete market time anchor, ' +
                    'but the final response did not provide complete pricing evidence.',
                suggestion:
                    'Provide a concrete buy-price value or range, include currency units, and anchor it to a specific market timepoint.',
                recoveryStage: 'execution',
            };
        }
    }

    const requiredCapabilities = collectRequiredToolEvidenceCapabilities(input.preparedWorkRequest);
    const unmetCapabilities = requiredCapabilities.filter((capability) =>
        !hasRequiredToolEvidenceCapability(capability, input.toolsUsed)
    );
    if (!hasBlockingUserAction && unmetCapabilities.length > 0) {
        const capabilityLabel = unmetCapabilities.join(', ');
        return {
            trigger: 'contradictory_evidence',
            error:
                `Execution protocol unmet: required tool-evidence capability was not satisfied (${capabilityLabel}).`,
            suggestion:
                'Execute the contract-required capability workflow first (for example browser_interaction: browser_connect -> browser_navigate -> browser_fill/browser_click), then deliver the final result.',
            recoveryStage: 'execution',
        };
    }

    if (
        requiresSourceLinksInFinalOutput({
            prepared: input.preparedWorkRequest,
            executionQuery: input.executionQuery,
            toolsUsed: input.toolsUsed,
        }) &&
        !hasHyperlink(input.outputText)
    ) {
        return {
            trigger: 'contradictory_evidence',
            error:
                'Execution protocol unmet: web-research task finished without source links in the final response.',
            suggestion:
                'Include a source-links section in the final output using concrete URLs gathered from web research tools.',
            recoveryStage: 'execution',
        };
    }

    const requestedGroundedEvidence =
        assessedProtocol?.requestedEvidence === 'grounded' ||
        (!assessedProtocol && contractDemandsGroundedInspection(input.preparedWorkRequest, input.executionQuery));

    if (requestedGroundedEvidence) {
        const hasGroundedEvidence =
            assessedProtocol?.deliveredEvidence === 'grounded' ||
            hasGroundedInspectionToolEvidence(input.toolsUsed);
        const deliveredEvidence = assessedProtocol?.deliveredEvidence;
        const isMetadataOnlyByAssessment = deliveredEvidence === 'metadata' || deliveredEvidence === 'none';
        const isMetadataOnlyByFallback =
            !assessedProtocol &&
            (isMetadataOnlyExecution(input.toolsUsed) || input.toolsUsed.length === 0);

        if (
            !hasGroundedEvidence &&
            (
                isMetadataOnlyByAssessment ||
                isMetadataOnlyByFallback
            )
        ) {
            return {
                trigger: 'contradictory_evidence',
                error:
                    'Execution protocol unmet: requested audit/review requires grounded inspection evidence, ' +
                    'but execution produced only metadata-level verification.',
                suggestion:
                    'Run grounded inspection steps (file/command/content checks) and provide file-level or command-level evidence before finishing.',
                recoveryStage: 'execution',
            };
        }
    }

    return null;
}

async function reopenAndRefreezePreparedContract(input: {
    taskId: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    reason: string;
    trigger: ReplanTrigger;
    recoveryStage?: 'research' | 'execution';
}, deps: ExecutionRuntimeDeps): Promise<{
    reopenedSummary: string;
    refrozenPrepared?: PreparedWorkRequestContext;
    blockedSummary?: string;
}> {
    if (input.recoveryStage === 'execution') {
        const reopenedPayload = reopenPreparedWorkRequestForExecution({
            prepared: input.preparedWorkRequest,
            reason: input.reason,
            trigger: input.trigger,
        });
        deps.emitContractReopened(input.taskId, reopenedPayload);
        deps.emitPlanUpdated(input.taskId, input.preparedWorkRequest);
        return {
            reopenedSummary: reopenedPayload.summary,
            refrozenPrepared: input.preparedWorkRequest,
        };
    }

    const reopenedPayload = reopenPreparedWorkRequestForResearch({
        prepared: input.preparedWorkRequest,
        reason: input.reason,
        trigger: input.trigger,
    });
    deps.emitContractReopened(input.taskId, reopenedPayload);
    deps.emitPlanUpdated(input.taskId, input.preparedWorkRequest);
    const refrozenPrepared = await deps.refreezePreparedWorkRequestForResearch({
        prepared: input.preparedWorkRequest,
        reason: input.reason,
        trigger: input.trigger,
    });
    const refrozenOutcome = await deps.emitPreparedWorkRequestRefrozen({
        taskId: input.taskId,
        prepared: refrozenPrepared,
        reason: input.reason,
        trigger: input.trigger,
    });
    if (refrozenOutcome.blocked) {
        return {
            reopenedSummary: reopenedPayload.summary,
            blockedSummary: refrozenOutcome.summary || reopenedPayload.summary,
        };
    }
    return {
        reopenedSummary: reopenedPayload.summary,
        refrozenPrepared,
    };
}

export async function executePreparedTaskFlow(input: {
    taskId: string;
    userQuery: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    allowAutonomousFallback: boolean;
    workRequestExecutionPrompt?: string;
    extraSystemPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    startedAt: number;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    const explicitlyEnabledSkillIds =
        input.config?.enabledClaudeSkills ??
        input.config?.enabledSkills ??
        [];
    const hasExplicitSkillSelection =
        Array.isArray(explicitlyEnabledSkillIds) && explicitlyEnabledSkillIds.length > 0;

    if (
        !hasExplicitSkillSelection &&
        input.allowAutonomousFallback &&
        !shouldBypassAutonomousFallback(input.preparedWorkRequest) &&
        deps.shouldRunAutonomously(input.preparedWorkRequest.executionQuery)
    ) {
        const autonomousResult = await executeAutonomousFlow(input, deps);
        if (autonomousResult) {
            return autonomousResult;
        }
    }

    return runPreparedAgentExecution({
        taskId: input.taskId,
        userMessage: input.userQuery,
        workspacePath: input.workspacePath,
        config: input.config,
        preparedWorkRequest: input.preparedWorkRequest,
        workRequestExecutionPrompt: input.workRequestExecutionPrompt,
        extraSystemPrompt: input.extraSystemPrompt,
        conversation: input.conversation,
        artifactContract: input.artifactContract,
        startedAt: input.startedAt,
        explicitSkillIds: explicitlyEnabledSkillIds,
        allowPptFastPath: true,
        allowUserConfirmedDegrade: false,
        emitFinishedStatus: false,
        artifactFailureErrorCode: 'ARTIFACT_CONTRACT_UNMET',
        artifactFailureSuggestionPrefix:
            'Detected degraded output ({artifacts}). Please confirm downgrade by sending: "CONFIRM_DEGRADE_TO_MD" or retry PPTX generation.',
        missingArtifactSuggestionPrefix: 'Expected file types not found. Generated files: {artifacts}',
        modelErrorCode: 'MODEL_STREAM_ERROR',
        learnOnArtifactFailure: true,
        contractReopenAttempts: 0,
    }, deps);
}

export async function continuePreparedAgentFlow(input: {
    taskId: string;
    userMessage: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    workRequestExecutionPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    explicitSkillIds?: string[];
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    return runPreparedAgentExecution({
        taskId: input.taskId,
        userMessage: input.userMessage,
        workspacePath: input.workspacePath,
        config: input.config,
        preparedWorkRequest: input.preparedWorkRequest,
        workRequestExecutionPrompt: input.workRequestExecutionPrompt,
        conversation: input.conversation,
        artifactContract: input.artifactContract,
        startedAt: Date.now(),
        explicitSkillIds: input.explicitSkillIds,
        allowPptFastPath: false,
        allowUserConfirmedDegrade: true,
        emitFinishedStatus: true,
        artifactFailureErrorCode: 'ARTIFACT_CONTRACT_UNMET',
        artifactFailureSuggestionPrefix:
            'Detected degraded output ({artifacts}). Ask user for explicit confirmation token CONFIRM_DEGRADE_TO_MD.',
        missingArtifactSuggestionPrefix: 'Expected file types not found. Generated files: {artifacts}',
        modelErrorCode: 'MODEL_STREAM_ERROR',
        learnOnArtifactFailure: false,
        contractReopenAttempts: 0,
    }, deps);
}

async function executeAutonomousFlow(input: {
    taskId: string;
    userQuery: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    config?: ExecutionTaskConfig;
    startedAt: number;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult | null> {
    deps.prepareAutonomousProvider(input.config);
    const agent = deps.getAutonomousAgent(input.taskId);

    try {
        const task = await agent.startTask(input.preparedWorkRequest.executionQuery, {
            autoSaveMemory: true,
            notifyOnComplete: true,
            runInBackground: false,
            sessionTaskId: input.taskId,
            workspacePath:
                input.config?.workspacePath ||
                input.preparedWorkRequest.frozenWorkRequest.workspacePath ||
                process.cwd(),
        });

        const completedAutonomousSubtasks = task.decomposedTasks.filter(
            (subtask) => subtask.status === 'completed'
        ).length;
        const autonomousGoalMet = task.verificationResult?.goalMet ?? false;

        if (!autonomousGoalMet && completedAutonomousSubtasks === 0) {
            const deterministicFallbackSummary = await deps.tryDeterministicResearchArtifactFallback(
                input.taskId,
                input.preparedWorkRequest.executionQuery
            );
            if (deterministicFallbackSummary) {
                const normalizedSummary = stripTrailingExecutionFollowup(deterministicFallbackSummary);
                deps.markWorkRequestExecutionCompleted(
                    input.preparedWorkRequest,
                    normalizedSummary
                );
                deps.reporter.finished({
                    summary: normalizedSummary,
                    duration: Date.now() - new Date(task.createdAt).getTime(),
                });
                return {
                    success: true,
                    summary: normalizedSummary,
                    artifactsCreated: [],
                };
            }
            return null;
        } else {
            const summary = stripTrailingExecutionFollowup(task.summary || 'Autonomous task completed');
            deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, summary);
            deps.reporter.finished({
                summary,
                duration: Date.now() - new Date(task.createdAt).getTime(),
            });
            return {
                success: true,
                summary,
                artifactsCreated: [],
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        deps.markWorkRequestExecutionFailed(input.preparedWorkRequest, errorMessage);
        deps.reporter.failed({
            error: errorMessage,
            errorCode: 'AUTONOMOUS_TASK_ERROR',
            recoverable: false,
        });
        return {
            success: false,
            summary: '',
            error: errorMessage,
            artifactsCreated: [],
        };
    }
}

async function runPreparedAgentExecution(input: {
    taskId: string;
    userMessage: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    workRequestExecutionPrompt?: string;
    extraSystemPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    startedAt: number;
    explicitSkillIds?: string[];
    allowPptFastPath: boolean;
    allowUserConfirmedDegrade: boolean;
    emitFinishedStatus: boolean;
    artifactFailureErrorCode: string;
    artifactFailureSuggestionPrefix: string;
    missingArtifactSuggestionPrefix: string;
    modelErrorCode: string;
    learnOnArtifactFailure: boolean;
    contractReopenAttempts?: number;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    const {
        taskId,
        userMessage,
        workspacePath,
        config,
        preparedWorkRequest,
        workRequestExecutionPrompt,
        extraSystemPrompt,
        conversation,
        artifactContract,
        startedAt,
        explicitSkillIds,
        contractReopenAttempts = 0,
    } = input;
    const { frozenWorkRequest, executionQuery, preferredSkillIds } = preparedWorkRequest;
    const triggeredSkillIds = deps.getTriggeredSkillIds(userMessage);
    const enabledSkillIds = deps.mergeSkillIds(explicitSkillIds, triggeredSkillIds, preferredSkillIds);

    deps.activatePreparedWorkRequest(taskId, preparedWorkRequest);

    try {
        if (preparedWorkRequest.frozenWorkRequest.capabilityPlan?.learningRequired && deps.acquireCapabilityForTask) {
            const acquisition = await deps.acquireCapabilityForTask({
                taskId,
                preparedWorkRequest,
                userMessage,
            });
            if (acquisition.outcome === 'reused' || acquisition.outcome === 'learned') {
                preparedWorkRequest.frozenWorkRequest.capabilityPlan = {
                    ...preparedWorkRequest.frozenWorkRequest.capabilityPlan,
                    learningRequired: false,
                    canProceedWithoutLearning: true,
                    replayStrategy: 'resume_from_checkpoint',
                    reasons: Array.from(new Set([
                        ...(preparedWorkRequest.frozenWorkRequest.capabilityPlan?.reasons ?? []),
                        acquisition.summary,
                    ])),
                };
            } else if (acquisition.outcome === 'review_required' || acquisition.outcome === 'blocked') {
                return {
                    success: false,
                    summary: acquisition.summary,
                    error: acquisition.summary,
                    artifactsCreated: [],
                    toolsUsed: [],
                };
            } else {
                deps.markWorkRequestExecutionFailed(preparedWorkRequest, acquisition.error || acquisition.summary);
                deps.reporter.failed({
                    error: acquisition.error || acquisition.summary,
                    errorCode: 'CAPABILITY_ACQUISITION_FAILED',
                    recoverable: true,
                    suggestion: acquisition.summary,
                });
                return {
                    success: false,
                    summary: '',
                    error: acquisition.error || acquisition.summary,
                    artifactsCreated: [],
                    toolsUsed: [],
                };
            }
        }

        const marketplaceInstallResult = await tryMarketplaceSkillInstallFastPath({
            taskId,
            workspacePath,
            config,
            preparedWorkRequest,
            startedAt,
            emitFinishedStatus: input.emitFinishedStatus,
        }, deps);
        if (marketplaceInstallResult) {
            return marketplaceInstallResult;
        }

        const deterministicLocalWorkflowResult = await tryExecuteDeterministicLocalWorkflow({
            taskId,
            workspacePath,
            preparedWorkRequest,
            startedAt,
            emitFinishedStatus: input.emitFinishedStatus,
        }, deps);
        if (deterministicLocalWorkflowResult) {
            return deterministicLocalWorkflowResult;
        }

        if (input.allowPptFastPath) {
            const pptGeneratorFastPathResult = await deps.tryPptGeneratorSkillFastPath(
                taskId,
                executionQuery,
                workspacePath,
                enabledSkillIds
            );
            if (pptGeneratorFastPathResult) {
                deps.session.replaceKnownArtifacts(pptGeneratorFastPathResult.artifactsCreated);
                deps.markWorkRequestExecutionCompleted(preparedWorkRequest, pptGeneratorFastPathResult.summary);
                deps.reporter.finished({
                    summary: pptGeneratorFastPathResult.summary,
                    artifactsCreated: pptGeneratorFastPathResult.artifactsCreated,
                    duration: Date.now() - startedAt,
                });
                return {
                    success: true,
                    summary: pptGeneratorFastPathResult.summary,
                    artifactsCreated: pptGeneratorFastPathResult.artifactsCreated,
                    toolsUsed: [],
                };
            }
        }

        const systemPromptWithDirectives = deps.mergeSystemPrompt(
            deps.buildSkillSystemPrompt(enabledSkillIds),
            deps.getDirectivePromptAdditions?.(userMessage)
        );
        const systemPrompt = deps.mergeSystemPrompt(
            systemPromptWithDirectives,
            [workRequestExecutionPrompt, extraSystemPrompt].filter(Boolean).join('\n\n') || undefined
        );

        const options: ExecutionStreamOptions = {
            modelId: config?.modelId,
            maxTokens: config?.maxTokens,
            systemPrompt,
        };

        await deps.ensureToolpacksRegistered(config?.enabledToolpacks);

        const tools = deps.getToolsForTask(taskId);
        options.tools = tools;

        const providerConfig = deps.buildProviderConfig(options);
        const loopResult = await deps.runAgentLoop(taskId, conversation, options, providerConfig, tools, {
            frozenWorkRequest: preparedWorkRequest.frozenWorkRequest,
        });
        const mergedArtifacts = deps.session.mergeKnownArtifacts(loopResult.artifactsCreated);
        const diskDiscoveredArtifacts = collectPlannedArtifactFilesFromDisk(artifactContract, workspacePath);
        const effectiveArtifacts = diskDiscoveredArtifacts.length > 0
            ? deps.session.mergeKnownArtifacts(diskDiscoveredArtifacts)
            : mergedArtifacts;
        const fullConversationText = deps.session.buildConversationText();
        const latestAssistantOutputText = deps.session.getLatestAssistantResponseText();
        const normalizedLatestOutput = ensureFinalOutputHasSourceLinks({
            outputText:
                typeof latestAssistantOutputText === 'string' && latestAssistantOutputText.trim().length > 0
                    ? latestAssistantOutputText
                    : fullConversationText,
            prepared: preparedWorkRequest,
            executionQuery,
            toolsUsed: loopResult.toolsUsed,
            conversationText: fullConversationText,
        });
        const protocolOutputText =
            normalizedLatestOutput;
        const protocolViolation = await evaluateExecutionProtocolCompliance({
            preparedWorkRequest,
            executionQuery,
            toolsUsed: loopResult.toolsUsed,
            outputText: protocolOutputText,
            assessExecutionProtocol: deps.assessExecutionProtocol,
        });
        if (protocolViolation) {
            const canReopenContract = protocolViolation.recoveryStage === 'execution'
                ? contractReopenAttempts < 1
                : canReopenForTrigger(
                    preparedWorkRequest,
                    protocolViolation.trigger,
                    contractReopenAttempts
                );
            if (canReopenContract) {
                const reopenOutcome = await reopenAndRefreezePreparedContract({
                    taskId,
                    preparedWorkRequest,
                    reason: protocolViolation.error,
                    trigger: protocolViolation.trigger,
                    recoveryStage: protocolViolation.recoveryStage,
                }, deps);
                if (!reopenOutcome.refrozenPrepared) {
                    return {
                        success: false,
                        summary: reopenOutcome.blockedSummary || reopenOutcome.reopenedSummary,
                        error: protocolViolation.error,
                        artifactsCreated: effectiveArtifacts,
                        toolsUsed: loopResult.toolsUsed,
                    };
                }
                const refrozenPrepared = reopenOutcome.refrozenPrepared;
                deps.markWorkRequestExecutionStarted(refrozenPrepared);
                deps.emitPlanUpdated(taskId, refrozenPrepared);
                return await runPreparedAgentExecution({
                    ...input,
                    preparedWorkRequest: refrozenPrepared,
                    extraSystemPrompt: [
                        extraSystemPrompt,
                        `Previous execution drifted from the required execution protocol. ` +
                        `Resolve this before final delivery: ${protocolViolation.error}`,
                    ].filter(Boolean).join('\n\n'),
                    contractReopenAttempts: contractReopenAttempts + 1,
                }, deps);
            }

            deps.markWorkRequestExecutionFailed(preparedWorkRequest, protocolViolation.error);
            deps.reporter.failed({
                error: protocolViolation.error,
                errorCode: 'EXECUTION_PROTOCOL_UNMET',
                recoverable: true,
                suggestion: protocolViolation.suggestion,
            });
            return {
                success: false,
                summary: '',
                error: protocolViolation.error,
                artifactsCreated: effectiveArtifacts,
                toolsUsed: loopResult.toolsUsed,
            };
        }
        const autoMaterializedArtifacts = materializeMissingMarkdownDeliverables({
            preparedWorkRequest,
            workspacePath,
            outputText: protocolOutputText,
            knownArtifacts: effectiveArtifacts,
        });
        const artifactsAfterMaterialization = autoMaterializedArtifacts.length > 0
            ? deps.session.mergeKnownArtifacts(autoMaterializedArtifacts)
            : effectiveArtifacts;
        const contractEvidence = {
            files: artifactsAfterMaterialization,
            toolsUsed: loopResult.toolsUsed,
            outputText: fullConversationText,
        };
        const artifactEvaluation = deps.evaluateArtifactContract(artifactContract, contractEvidence);
        const degradedOutput = deps.detectDegradedOutputs(artifactContract, artifactsAfterMaterialization);
        deps.reporter.appendArtifactTelemetry(
            deps.buildArtifactTelemetry(artifactContract, contractEvidence, artifactEvaluation)
        );

        if (!artifactEvaluation.passed) {
            if (input.allowUserConfirmedDegrade && /CONFIRM_DEGRADE_TO_MD/i.test(userMessage) && degradedOutput.hasDegradedOutput) {
                const summary = `Task completed with user-approved degraded output: ${degradedOutput.degradedArtifacts.join(', ')}`;
                deps.markWorkRequestExecutionCompleted(preparedWorkRequest, summary);
                if (input.emitFinishedStatus) {
                    deps.reporter.status('finished');
                }
                deps.reporter.finished({
                    summary,
                    artifactsCreated: artifactsAfterMaterialization,
                    duration: 0,
                });
                return {
                    success: true,
                    summary,
                    artifactsCreated: artifactsAfterMaterialization,
                    toolsUsed: loopResult.toolsUsed,
                };
            }

            const unmetMessage = `Artifact contract unmet: ${artifactEvaluation.failed
                .map((item) => `${item.description} (${item.reason})`)
                .join('; ')}`;
            const canReopenContract = canReopenForTrigger(
                preparedWorkRequest,
                'execution_infeasible',
                contractReopenAttempts
            );

            if (canReopenContract) {
                const reopenOutcome = await reopenAndRefreezePreparedContract({
                    taskId,
                    preparedWorkRequest,
                    reason: unmetMessage,
                    trigger: 'execution_infeasible',
                }, deps);
                if (!reopenOutcome.refrozenPrepared) {
                    return {
                        success: false,
                        summary: reopenOutcome.blockedSummary || reopenOutcome.reopenedSummary,
                        error: unmetMessage,
                        artifactsCreated: artifactsAfterMaterialization,
                        toolsUsed: loopResult.toolsUsed,
                    };
                }
                const refrozenPrepared = reopenOutcome.refrozenPrepared;
                deps.markWorkRequestExecutionStarted(refrozenPrepared);
                deps.emitPlanUpdated(taskId, refrozenPrepared);
                return await runPreparedAgentExecution({
                    ...input,
                    preparedWorkRequest: refrozenPrepared,
                    extraSystemPrompt: [
                        extraSystemPrompt,
                        `Previous execution attempt failed artifact validation and triggered contract reopen. Resolve this issue before final delivery: ${unmetMessage}`,
                    ].filter(Boolean).join('\n\n'),
                    contractReopenAttempts: contractReopenAttempts + 1,
                }, deps);
            }

            deps.markWorkRequestExecutionFailed(preparedWorkRequest, unmetMessage);

            deps.reporter.failed({
                error: unmetMessage,
                errorCode: input.artifactFailureErrorCode,
                recoverable: true,
                suggestion: degradedOutput.hasDegradedOutput
                    ? input.artifactFailureSuggestionPrefix.replace(
                        '{artifacts}',
                        degradedOutput.degradedArtifacts.join(', ')
                    )
                    : input.missingArtifactSuggestionPrefix.replace(
                        '{artifacts}',
                        artifactsAfterMaterialization.join(', ') || 'none'
                    ),
            });

            if (input.learnOnArtifactFailure && deps.quickLearnFromError) {
                try {
                    await deps.quickLearnFromError(`${unmetMessage}. Query: ${userMessage}`, userMessage, 1);
                } catch {
                    // Best effort only.
                }
            }

            return {
                success: false,
                summary: '',
                error: unmetMessage,
                artifactsCreated: artifactsAfterMaterialization,
                toolsUsed: loopResult.toolsUsed,
            };
        }

        const latestTextForDelivery = deps.session.getLatestAssistantResponseText() || protocolOutputText || 'Task completed';
        const finalAssistantText = ensureFinalOutputHasSourceLinks({
            outputText: latestTextForDelivery,
            prepared: preparedWorkRequest,
            executionQuery,
            toolsUsed: loopResult.toolsUsed,
            conversationText: fullConversationText,
        });
        markWorkRequestReductionStarted(preparedWorkRequest);
        deps.emitPlanUpdated(taskId, preparedWorkRequest);
        const reducedPresentation = deps.reduceWorkResult({
            canonicalResult: finalAssistantText,
            request: frozenWorkRequest,
            artifacts: artifactsAfterMaterialization,
        });
        const finalSummary = reducedPresentation.uiSummary || reducedPresentation.canonicalResult || 'Task completed';
        markWorkRequestPresentationStarted(preparedWorkRequest);
        deps.emitPlanUpdated(taskId, preparedWorkRequest);
        deps.markWorkRequestExecutionCompleted(preparedWorkRequest, finalSummary);
        if (input.emitFinishedStatus) {
            deps.reporter.status('finished');
        }
        deps.reporter.finished({
            summary: finalSummary,
            artifactsCreated: artifactsAfterMaterialization,
            duration: input.emitFinishedStatus ? 0 : Date.now() - startedAt,
        });
        return {
            success: true,
            summary: finalSummary,
            artifactsCreated: artifactsAfterMaterialization,
            toolsUsed: loopResult.toolsUsed,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCancelled = error instanceof TaskCancelledError || errorMessage === 'task_cancelled';
        const trigger = isCancelled
            ? null
            : classifyExecutionFailureReplanTrigger(errorMessage);
        const canReopenContract = Boolean(
            trigger &&
            canReopenForTrigger(preparedWorkRequest, trigger, contractReopenAttempts)
        );

        if (trigger && canReopenContract) {
            const reopenOutcome = await reopenAndRefreezePreparedContract({
                taskId,
                preparedWorkRequest,
                reason: errorMessage,
                trigger,
            }, deps);
            if (!reopenOutcome.refrozenPrepared) {
                return {
                    success: false,
                    summary: reopenOutcome.blockedSummary || reopenOutcome.reopenedSummary,
                    error: errorMessage,
                    artifactsCreated: [],
                    toolsUsed: [],
                };
            }
            const refrozenPrepared = reopenOutcome.refrozenPrepared;
            deps.markWorkRequestExecutionStarted(refrozenPrepared);
            deps.emitPlanUpdated(taskId, refrozenPrepared);
            return await runPreparedAgentExecution({
                ...input,
                preparedWorkRequest: refrozenPrepared,
                extraSystemPrompt: [
                    extraSystemPrompt,
                    `Previous execution attempt failed and triggered contract reopen. Resolve this issue before final delivery: ${errorMessage}`,
                ].filter(Boolean).join('\n\n'),
                contractReopenAttempts: contractReopenAttempts + 1,
            }, deps);
        }

        deps.markWorkRequestExecutionFailed(preparedWorkRequest, errorMessage);
        deps.reporter.failed({
            error: errorMessage,
            errorCode: isCancelled ? 'CANCELLED' : input.modelErrorCode,
            recoverable: false,
            suggestion:
                isCancelled
                    ? undefined
                    : errorMessage === 'missing_api_key'
                    ? 'Set API key in environment or .coworkany/settings.json'
                    : errorMessage === 'missing_base_url'
                        ? 'Set base URL in environment or .coworkany/settings.json'
                        : undefined,
        });
        return {
            success: false,
            summary: '',
            error: errorMessage,
            artifactsCreated: [],
            toolsUsed: [],
        };
    } finally {
        deps.clearPreparedWorkRequest(taskId);
    }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md']);

type SupportedFileKind = 'images' | 'videos' | 'documents';

type DirectoryEntry = {
    name: string;
    path?: string;
    isDir: boolean;
    size?: number;
};

type FileHashResult = {
    success?: boolean;
    hash?: string;
    error?: string;
};

type MatchedFile = {
    name: string;
    relativePath: string;
    extension: string;
};

function normalizeExtension(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || 'other';
}

function isImageFile(fileName: string): boolean {
    return IMAGE_EXTENSIONS.has(normalizeExtension(fileName));
}

function isVideoFile(fileName: string): boolean {
    return VIDEO_EXTENSIONS.has(normalizeExtension(fileName));
}

function isDocumentFile(fileName: string): boolean {
    return DOCUMENT_EXTENSIONS.has(normalizeExtension(fileName));
}

function getSupportedFileKind(fileKinds: string[]): SupportedFileKind | null {
    if (fileKinds.includes('images')) {
        return 'images';
    }
    if (fileKinds.includes('videos')) {
        return 'videos';
    }
    if (fileKinds.includes('documents')) {
        return 'documents';
    }
    return null;
}

function isMatchingFileKind(fileKind: SupportedFileKind, fileName: string): boolean {
    switch (fileKind) {
        case 'images':
            return isImageFile(fileName);
        case 'videos':
            return isVideoFile(fileName);
        case 'documents':
            return isDocumentFile(fileName);
    }
}

function getKindRootFolderName(fileKind: SupportedFileKind): string {
    switch (fileKind) {
        case 'images':
            return 'Images';
        case 'videos':
            return 'Videos';
        case 'documents':
            return 'Documents';
    }
}

function getKindLabelPlural(fileKind: SupportedFileKind): string {
    switch (fileKind) {
        case 'images':
            return 'image files';
        case 'videos':
            return 'video files';
        case 'documents':
            return 'document files';
    }
}

function summarizeNames(names: string[], limit = 5): string {
    if (names.length <= limit) {
        return names.join(', ');
    }
    return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

function getPrimaryLocalTaskHint(preparedWorkRequest: PreparedWorkRequestContext): LocalTaskPlanHint | undefined {
    return preparedWorkRequest.frozenWorkRequest.tasks[0]?.localPlanHint;
}

function hasExplicitCommandFirstDirective(preparedWorkRequest: PreparedWorkRequestContext): boolean {
    const mergedText = [
        preparedWorkRequest.frozenWorkRequest.sourceText,
        preparedWorkRequest.executionQuery,
    ]
        .filter((segment): segment is string => typeof segment === 'string')
        .join('\n')
        .toLowerCase();

    if (!mergedText.trim()) {
        return false;
    }

    const asksCommandFirst =
        /execute (?:this |the )?(?:exact )?command first/.test(mergedText) ||
        /run (?:this |the )?command first/.test(mergedText) ||
        /先(?:执行|运行).{0,12}命令/.test(mergedText);

    if (!asksCommandFirst) {
        return false;
    }

    return /\b(?:python|python3|bash|sh|node|npm|pnpm|yarn|bun)\b\s+["'`]?[^"'`\n]+/.test(mergedText);
}

function getEntryRelativePath(entry: DirectoryEntry): string {
    return entry.path || entry.name;
}

function listTopLevelFilesByKind(
    listing: DirectoryEntry[],
    fileKind: SupportedFileKind
): MatchedFile[] {
    return listing
        .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
        .map((entry) => ({
            name: entry.name,
            relativePath: getEntryRelativePath(entry),
            extension: normalizeExtension(entry.name).toUpperCase(),
        }));
}

function buildListDirArgs(targetPath: string, traversalScope: LocalTaskPlanHint['traversalScope']): Record<string, unknown> {
    return traversalScope === 'recursive'
        ? { path: targetPath, recursive: true, max_depth: 16 }
        : { path: targetPath };
}

function describeListDirFailure(result: unknown): string {
    if (typeof (result as { error?: unknown })?.error === 'string' && (result as { error: string }).error.trim()) {
        return `Failed to inspect the target folder: ${(result as { error: string }).error}`;
    }
    return 'Failed to inspect the target folder.';
}

async function tryExecuteDeterministicLocalWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult | null> {
    if (hasExplicitCommandFirstDirective(input.preparedWorkRequest)) {
        return null;
    }

    const localHint = getPrimaryLocalTaskHint(input.preparedWorkRequest);
    const targetPath = localHint?.targetFolder?.resolvedPath;
    const fileKind = localHint ? getSupportedFileKind(localHint.fileKinds) : null;

    if (!localHint || !targetPath || !fileKind) {
        return null;
    }

    switch (localHint.intent) {
        case 'inspect_folder':
            return executeInspectFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'organize_files':
            return executeOrganizeFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'deduplicate_files':
            return executeDeduplicateFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'delete_files':
            return executeDeleteFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        default:
            return null;
    }
}

async function executeInspectFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, describeListDirFailure(listing));
    }

    const matchingFiles = (listing as DirectoryEntry[])
        .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
        .map((entry) => entry.name);
    const kindLabel = getKindLabelPlural(fileKind);
    const scopeLabel = traversalScope === 'recursive' ? 'recursive' : 'top-level';

    const summary = matchingFiles.length === 0
        ? `No ${scopeLabel} ${kindLabel} were found in ${targetPath}.`
        : `Found ${matchingFiles.length} ${scopeLabel} ${kindLabel} in ${targetPath}: ${summarizeNames(matchingFiles)}.`;

    return completeDeterministicWorkflow(input, deps, summary);
}

async function executeOrganizeFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, describeListDirFailure(listing));
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);

    if (matchingFiles.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} were found in ${targetPath}, so nothing was reorganized.`
        );
    }

    const categoryRoot = path.join(targetPath, getKindRootFolderName(fileKind));
    const categories = Array.from(new Set(matchingFiles.map((file) => file.extension)));
    for (const category of categories) {
        const result = await deps.executeTool(
            input.taskId,
            'create_directory',
            { path: path.join(categoryRoot, category) },
            { workspacePath: input.workspacePath }
        );

        if (result?.error) {
            return failDeterministicWorkflow(
                input,
                deps,
                `Failed to create destination folder for ${category}: ${result.error}`
            );
        }
    }

    const moves = matchingFiles.map((file) => ({
        source_path: path.join(targetPath, file.relativePath),
        destination_path: path.join(categoryRoot, file.extension, file.relativePath),
    }));
    const moveResult = await deps.executeTool(
        input.taskId,
        'batch_move_files',
        { moves },
        { workspacePath: input.workspacePath }
    );

    if (moveResult?.error || moveResult?.success === false) {
        const failedMoves = Array.isArray(moveResult?.results)
            ? moveResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedMoves.length > 0
            ? failedMoves.map((result: any) => result.error).join('; ')
            : moveResult?.error || 'Unknown move failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to organize image files: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        { path: categoryRoot },
        { workspacePath: input.workspacePath }
    );
    const createdFolders = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[]).filter((entry) => entry.isDir).map((entry) => entry.name)
        : categories;

    return completeDeterministicWorkflow(
        input,
        deps,
        `Organized ${matchingFiles.length} ${kindLabel} from ${targetPath} into ${categoryRoot}. Created folders: ${createdFolders.join(', ')}.`
    );
}

async function executeDeduplicateFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, describeListDirFailure(listing));
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);
    if (matchingFiles.length < 2) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `Found fewer than two ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} in ${targetPath}, so there were no duplicates to quarantine.`
        );
    }

    const hashGroups = new Map<string, MatchedFile[]>();
    for (const file of matchingFiles) {
        const hashResult = await deps.executeTool(
            input.taskId,
            'compute_file_hash',
            { path: path.join(targetPath, file.relativePath) },
            { workspacePath: input.workspacePath }
        ) as FileHashResult;

        if (!hashResult?.hash) {
            return failDeterministicWorkflow(
                input,
                deps,
                `Failed to hash ${file.relativePath}: ${hashResult?.error || 'unknown hash error'}`
            );
        }

        const group = hashGroups.get(hashResult.hash) ?? [];
        group.push(file);
        hashGroups.set(hashResult.hash, group);
    }

    const duplicateGroups = Array.from(hashGroups.entries()).filter(([, files]) => files.length > 1);
    if (duplicateGroups.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No duplicate top-level ${kindLabel} were found in ${targetPath}.`
        );
    }

    const quarantineRoot = path.join(targetPath, 'Duplicates');
    const quarantineResult = await deps.executeTool(
        input.taskId,
        'create_directory',
        { path: quarantineRoot },
        { workspacePath: input.workspacePath }
    );

    if (quarantineResult?.error) {
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to create duplicate quarantine folder: ${quarantineResult.error}`
        );
    }

    const moves = duplicateGroups.flatMap(([hash, files]) => {
        const quarantineFolder = path.join(quarantineRoot, hash.slice(0, 12));
        return files.slice(1).map((file) => ({
            source_path: path.join(targetPath, file.relativePath),
            destination_path: path.join(quarantineFolder, file.relativePath),
        }));
    });

    const moveResult = await deps.executeTool(
        input.taskId,
        'batch_move_files',
        { moves },
        { workspacePath: input.workspacePath }
    );

    if (moveResult?.error || moveResult?.success === false) {
        const failedMoves = Array.isArray(moveResult?.results)
            ? moveResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedMoves.length > 0
            ? failedMoves.map((result: any) => result.error).join('; ')
            : moveResult?.error || 'Unknown move failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to quarantine duplicate ${kindLabel}: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        { path: quarantineRoot },
        { workspacePath: input.workspacePath }
    );
    const quarantineFolders = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[]).filter((entry) => entry.isDir).map((entry) => entry.name)
        : duplicateGroups.map(([hash]) => hash.slice(0, 12));

    return completeDeterministicWorkflow(
        input,
        deps,
        `Quarantined ${moves.length} duplicate ${kindLabel} across ${duplicateGroups.length} duplicate groups from ${targetPath} into ${quarantineRoot}. Created folders: ${quarantineFolders.join(', ')}.`
    );
}

async function executeDeleteFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, describeListDirFailure(listing));
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);
    if (matchingFiles.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} were found in ${targetPath}, so nothing was deleted.`
        );
    }

    const deleteResult = await deps.executeTool(
        input.taskId,
        'batch_delete_paths',
        {
            deletes: matchingFiles.map((file) => ({
                path: path.join(targetPath, file.relativePath),
            })),
        },
        { workspacePath: input.workspacePath }
    );

    if (deleteResult?.error || deleteResult?.success === false) {
        const failedDeletes = Array.isArray(deleteResult?.results)
            ? deleteResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedDeletes.length > 0
            ? failedDeletes.map((result: any) => result.error).join('; ')
            : deleteResult?.error || 'Unknown delete failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to delete ${kindLabel}: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );
    const remainingImageFiles = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[])
            .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
            .map((entry) => entry.name)
        : [];

    const deletedNames = matchingFiles.map((file) => file.name);
    return completeDeterministicWorkflow(
        input,
        deps,
        remainingImageFiles.length === 0
            ? `Deleted ${deletedNames.length} ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} from ${targetPath}: ${summarizeNames(deletedNames)}.`
            : `Deleted ${deletedNames.length} ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} from ${targetPath}, but ${remainingImageFiles.length} ${kindLabel} remain: ${summarizeNames(remainingImageFiles)}.`
    );
}

function completeDeterministicWorkflow(input: {
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, summary: string): ExecutionRuntimeResult {
    deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, summary);
    if (input.emitFinishedStatus) {
        deps.reporter.status('finished');
    }
    deps.reporter.finished({
        summary,
        duration: input.emitFinishedStatus ? 0 : Date.now() - input.startedAt,
    });
    return {
        success: true,
        summary,
        artifactsCreated: [],
    };
}

function classifyExecutionFailureReplanTrigger(errorMessage: string): ReplanTrigger | null {
    const normalized = errorMessage.toLowerCase();
    if (
        /(permission denied|not permitted|operation not permitted|eacces|eprem|requires host-folder access|access approval|required access|grant required)/i.test(normalized)
    ) {
        return 'permission_block';
    }
    if (
        /(no such file|not found|does not exist|enoent|missing resource|missing folder|missing file|target folder.*not accessible)/i.test(normalized)
    ) {
        return 'missing_resource';
    }
    return null;
}

function failDeterministicWorkflow(input: {
    taskId: string;
    preparedWorkRequest: PreparedWorkRequestContext;
}, deps: ExecutionRuntimeDeps, errorMessage: string): ExecutionRuntimeResult | Promise<ExecutionRuntimeResult> {
    const trigger = classifyExecutionFailureReplanTrigger(errorMessage);
    const canReopenContract = Boolean(trigger && canReopenForTrigger(input.preparedWorkRequest, trigger, 0));

    if (trigger && canReopenContract) {
        return (async () => {
            const reopenOutcome = await reopenAndRefreezePreparedContract({
                taskId: input.taskId,
                preparedWorkRequest: input.preparedWorkRequest,
                reason: errorMessage,
                trigger,
            }, deps);
            return {
                success: false,
                summary: reopenOutcome.blockedSummary || reopenOutcome.reopenedSummary,
                error: errorMessage,
                artifactsCreated: [],
            };
        })();
    }

    deps.markWorkRequestExecutionFailed(input.preparedWorkRequest, errorMessage);
    deps.reporter.failed({
        error: errorMessage,
        errorCode: 'LOCAL_WORKFLOW_ERROR',
        recoverable: false,
    });
    return {
        success: false,
        summary: '',
        error: errorMessage,
        artifactsCreated: [],
    };
}
