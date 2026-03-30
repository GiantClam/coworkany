import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
    ClarificationDecision,
    DefaultingPolicy,
    DeliverableContract,
    ExecutionPlan,
    FrozenWorkRequest,
    GoalFrame,
    HitlPolicy,
    IntentRouting,
    MemoryIsolationPolicy,
    MissingInfoItem,
    NormalizedWorkRequest,
    PresentationContract,
    PresentationPayload,
    PublishIntent,
    ReplanPolicy,
    ResearchEvidence,
    ResearchQuery,
    ResumeStrategy,
    RuntimeIsolationPolicy,
    SessionIsolationPolicy,
    StrategyOption,
    TaskDefinition,
    TaskExecutionRequirement,
    TenantIsolationPolicy,
    UncertaintyItem,
    WorkRequestFollowUpContext,
} from './workRequestSchema';
import {
    buildCapabilityPlan,
    buildCheckpointsFromExecutionProfile,
    buildExecutionProfile,
    buildUserActionsRequiredFromExecutionProfile,
} from './workRequestPolicy';
import {
    detectScheduledIntent,
    type ChainedScheduledStageIntent,
    type ParsedScheduledIntent,
} from '../scheduling/scheduledTasks';
import {
    cleanScheduledTaskResultText,
    normalizeScheduledTaskResultText,
} from '../scheduling/scheduledTaskPresentation';
import { analyzeLocalTaskIntent } from './localTaskIntent';
import type { PlatformRuntimeContext } from '../protocol/commands';
import type { SystemFolderResolutionOptions } from '../system/wellKnownFolders';
import {
    CHAT_ACK_PATTERN,
    EXPLICIT_INTENT_COMMANDS,
    ROUTED_FOLLOW_UP_PATTERN,
    ROUTE_TOKEN_PATTERN,
    STRUCTURED_APPROVAL_PATTERN,
    STRUCTURED_BASE_ONLY_PATTERN,
    STRUCTURED_CORRECTION_PATTERN,
    STRUCTURED_ROUTE_PATTERN,
    resolveUserRouteIntent,
} from './workRequestIntentRules';

const URL_PATTERN = /\bhttps?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
const WHITESPACE_PATTERN = /\s+/g;

const AMBIGUOUS_FOLLOW_UP_PATTERN = /^(继续|然后呢|再来|帮我继续|keep going|continue|then\??|what next\??)$/i;
const CODE_CHANGE_PATTERN = /(修复|修改|重构|实现|patch|apply patch|edit|refactor|implement|bug|test|代码|code)/i;
const FILE_WRITE_PATTERN = /(写入|保存|创建文件|生成文件|输出到|write to|save to|create (a )?file|readme|markdown|md\b)/i;
const FILE_READ_PATTERN = /(读取|查看文件|打开文件|read file|view file|cat\s+)/i;
const SHELL_PATTERN = /(运行命令|执行命令|terminal|shell|bash|zsh|command line|run command|npm\s+run|bun\s+run)/i;
const BROWSER_PATTERN = /(浏览器|网页|打开网站|click|navigate|browser|playwright|screenshot|页面)/i;
const WEB_RESEARCH_PATTERN = /(搜索|调研|research|search|latest|最新|today|新闻|news|行情|市场|web)/i;
const LOCAL_SEARCH_SCOPE_PATTERN = /(本地文件|当前项目|workspace|目录|文件夹|repo|repository)/i;
const HIGH_RISK_ACTION_PATTERN = /(删除|移除|drop\s+table|rm\s+-rf|publish|发帖|发布到|send email|付款|payment)/i;
const MANUAL_ACTION_PATTERN = /(登录|验证码|captcha|手动|人工|approve|approval|确认后再|先让我看)/i;
const AUTH_PATTERN = /(登录|授权|auth|oauth|token|session|cookie|验证码|captcha)/i;

const SOCIAL_PLATFORM_PATTERNS: Array<{
    platform: NonNullable<PublishIntent['platform']>;
    pattern: RegExp;
}> = [
    { platform: 'xiaohongshu', pattern: /(小红书|xiaohongshu|xhs|rednote)/i },
    { platform: 'wechat_official', pattern: /(公众号|微信公众|wechat official|mp\.weixin)/i },
    { platform: 'x', pattern: /(?:\bx\.com\b|\btwitter\b|\b推特\b|\b在\s*x\s*上\b)/i },
    { platform: 'reddit', pattern: /\breddit\b/i },
    { platform: 'facebook', pattern: /\bfacebook\b/i },
    { platform: 'instagram', pattern: /\binstagram\b/i },
    { platform: 'linkedin', pattern: /\blinkedin\b/i },
];

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeText(input: string): string {
    return input.replace(WHITESPACE_PATTERN, ' ').trim();
}

function detectLanguage(text: string): string {
    return /[\u3400-\u9FFF]/u.test(text) ? 'zh-CN' : 'en-US';
}

function extractExplicitUrls(text: string): string[] {
    const matches = text.match(URL_PATTERN) ?? [];
    return dedupeStrings(matches.map((value) => value.trim().replace(/[),.;，。；]+$/g, '')));
}

function sanitizePathLike(raw: string): string {
    return raw
        .trim()
        .replace(/^['"`]+/, '')
        .replace(/['"`]+$/, '')
        .replace(/[),.;，。；]+$/g, '');
}

function extractExplicitOutputTargetPath(text: string): string | undefined {
    const directCue = text.match(/(?:保存(?:到|为)?|输出到|write\s+to|save\s+to|output\s+to)\s+([^\s]+)/i);
    if (directCue?.[1]) {
        return sanitizePathLike(directCue[1]);
    }

    const genericPath = text.match(/(\/[\w\-.~/]+\.[A-Za-z0-9]+|\.{1,2}\/[\w\-.~/]+\.[A-Za-z0-9]+)/);
    if (genericPath?.[1]) {
        return sanitizePathLike(genericPath[1]);
    }

    return undefined;
}

function inferArtifactFormat(text: string, explicitPath?: string): string {
    if (explicitPath) {
        const ext = path.extname(explicitPath).toLowerCase();
        if (ext === '.md' || ext === '.markdown') return 'md';
        if (ext === '.json') return 'json';
        if (ext === '.html' || ext === '.htm') return 'html';
        if (ext === '.csv') return 'csv';
        if (ext === '.txt') return 'txt';
    }

    if (/(markdown|\bmd\b|报告|文档)/i.test(text)) return 'md';
    if (/json/i.test(text)) return 'json';
    if (/html/i.test(text)) return 'html';
    if (/csv/i.test(text)) return 'csv';
    return 'txt';
}

function inferUiFormat(text: string, explicitPath?: string): PresentationContract['uiFormat'] {
    if (explicitPath) {
        return /\.(md|markdown|json|html|csv|txt)$/i.test(explicitPath) ? 'artifact' : 'report';
    }
    if (/\btable\b|表格|tabular/i.test(text)) return 'table';
    if (/报告|report|analysis/i.test(text)) return 'report';
    if (/文件|artifact|保存|输出/i.test(text)) return 'artifact';
    return 'chat_message';
}

function inferOutputDirectory(explicitPath?: string): string {
    if (!explicitPath) {
        return 'artifacts';
    }
    const dir = path.dirname(explicitPath);
    return dir === '.' ? 'artifacts' : dir;
}

function inferPublishIntent(text: string): PublishIntent | undefined {
    const matched = SOCIAL_PLATFORM_PATTERNS.find((item) => item.pattern.test(text));
    if (!matched) {
        return undefined;
    }

    const draftOnly = /(仅草稿|不要发布|draft only|do not publish)/i.test(text);
    const previewThenPublish = /(先看|预览|确认后|review first|preview)/i.test(text);

    let executionMode: PublishIntent['executionMode'] = 'direct_publish';
    if (draftOnly) {
        executionMode = 'draft_only';
    } else if (previewThenPublish) {
        executionMode = 'preview_then_publish';
    }

    return {
        action: 'publish_social_post',
        platform: matched.platform,
        executionMode,
        requiresSideEffect: executionMode !== 'draft_only',
    };
}

function inferPreferredTools(text: string, publishIntent?: PublishIntent): string[] {
    const tools: string[] = [];

    if (FILE_READ_PATTERN.test(text)) {
        tools.push('view_file');
    }
    if (FILE_WRITE_PATTERN.test(text)) {
        tools.push('write_to_file');
    }
    if (CODE_CHANGE_PATTERN.test(text)) {
        tools.push('read_file', 'list_dir', 'apply_patch');
    }
    if (SHELL_PATTERN.test(text)) {
        tools.push('run_command');
    }
    if (BROWSER_PATTERN.test(text)) {
        tools.push('browser_navigate');
    }
    if (WEB_RESEARCH_PATTERN.test(text) && !LOCAL_SEARCH_SCOPE_PATTERN.test(text)) {
        tools.push('search_web');
    }
    if (publishIntent?.platform === 'xiaohongshu') {
        tools.push('xiaohongshu_post');
    }

    if (tools.length === 0) {
        tools.push('list_dir');
    }

    return dedupeStrings(tools);
}

function inferPreferredSkills(text: string, mode: NormalizedWorkRequest['mode']): string[] {
    const skills: string[] = [];

    if (CODE_CHANGE_PATTERN.test(text)) {
        skills.push('systematic-debugging', 'verification-before-completion');
    }
    if (WEB_RESEARCH_PATTERN.test(text)) {
        skills.push('planning-with-files');
    }
    if (mode === 'scheduled_task' || mode === 'scheduled_multi_task') {
        skills.push('planning-with-files');
    }

    return dedupeStrings(skills);
}

function inferExecutionRequirements(text: string): TaskExecutionRequirement[] {
    const requirements: TaskExecutionRequirement[] = [];

    if (BROWSER_PATTERN.test(text)) {
        requirements.push({
            id: randomUUID(),
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Task likely needs browser/UI interaction evidence.',
        });
    }

    if (SHELL_PATTERN.test(text)) {
        requirements.push({
            id: randomUUID(),
            kind: 'tool_evidence',
            capability: 'shell_execution',
            required: true,
            reason: 'Task explicitly asks for shell/command execution evidence.',
        });
    }

    return requirements;
}

function buildTaskTitle(objective: string): string {
    const normalized = normalizeText(objective);
    if (normalized.length <= 72) {
        return normalized || 'Task';
    }
    return `${normalized.slice(0, 69)}...`;
}

function buildTaskDefinition(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    workspacePath: string;
    systemContext?: SystemFolderResolutionOptions;
    publishIntent?: PublishIntent;
}): TaskDefinition {
    const text = normalizeText(input.text);
    const sourceUrls = extractExplicitUrls(text);
    const outputPath = extractExplicitOutputTargetPath(text);
    const localPlanHint = analyzeLocalTaskIntent({
        text,
        workspacePath: input.workspacePath,
        ...(input.systemContext ?? {}),
    });

    const preferredTools = dedupeStrings([
        ...inferPreferredTools(text, input.publishIntent),
        ...(localPlanHint?.preferredTools ?? []),
    ]);

    const constraints = dedupeStrings([
        sourceUrls.length > 0 ? 'Use referenced URLs as primary sources when available.' : '',
        outputPath ? `Write deliverables to ${outputPath}.` : '',
        localPlanHint?.requiresHostAccessGrant ? 'Requires host access approval for non-workspace path.' : '',
    ]);

    return {
        id: randomUUID(),
        title: buildTaskTitle(text),
        objective: text,
        constraints,
        acceptanceCriteria: dedupeStrings([
            outputPath ? `Output generated at ${outputPath}.` : '',
            preferredTools.includes('apply_patch') ? 'Code changes are syntactically valid and targeted.' : '',
            preferredTools.includes('run_command') ? 'Command output is captured in final summary.' : '',
        ]),
        dependencies: [],
        preferredSkills: inferPreferredSkills(text, input.mode),
        preferredTools,
        preferredWorkflow: localPlanHint?.preferredWorkflow,
        resolvedTargets: localPlanHint?.targetFolder ? [localPlanHint.targetFolder] : undefined,
        sourceUrls: sourceUrls.length > 0 ? sourceUrls : undefined,
        localPlanHint,
        executionRequirements: inferExecutionRequirements(text),
    };
}

function buildScheduledTaskDefinitions(input: {
    scheduledIntent: ParsedScheduledIntent;
    mode: NormalizedWorkRequest['mode'];
    workspacePath: string;
    systemContext?: SystemFolderResolutionOptions;
    publishIntent?: PublishIntent;
}): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];

    tasks.push(buildTaskDefinition({
        text: input.scheduledIntent.taskQuery,
        mode: input.mode,
        workspacePath: input.workspacePath,
        systemContext: input.systemContext,
        publishIntent: input.publishIntent,
    }));

    const chainedStages = input.scheduledIntent.chainedStages ?? [];
    for (const stage of chainedStages) {
        const stageTask = buildTaskDefinition({
            text: stage.taskQuery,
            mode: input.mode,
            workspacePath: input.workspacePath,
            systemContext: input.systemContext,
            publishIntent: input.publishIntent,
        });

        const previousTask = tasks[tasks.length - 1];
        if (previousTask) {
            stageTask.dependencies = [previousTask.id];
        }

        tasks.push(stageTask);
    }

    return tasks;
}

function buildScheduledStages(input: {
    scheduledIntent: ParsedScheduledIntent;
    tasks: TaskDefinition[];
}): Array<{
    taskId: string;
    executeAt: string;
    delayMsFromPrevious?: number;
    originalTimeExpression?: string;
}> {
    const stages: Array<{
        taskId: string;
        executeAt: string;
        delayMsFromPrevious?: number;
        originalTimeExpression?: string;
    }> = [];

    const rootTask = input.tasks[0];
    if (rootTask) {
        stages.push({
            taskId: rootTask.id,
            executeAt: input.scheduledIntent.executeAt.toISOString(),
            originalTimeExpression: input.scheduledIntent.originalTimeExpression,
        });
    }

    const chainedStages: ChainedScheduledStageIntent[] = input.scheduledIntent.chainedStages ?? [];
    let current = input.scheduledIntent.executeAt.getTime();

    for (let index = 0; index < chainedStages.length; index += 1) {
        const stage = chainedStages[index];
        const task = input.tasks[index + 1];
        if (!task) {
            continue;
        }

        current += stage.delayMsFromPrevious;
        stages.push({
            taskId: task.id,
            executeAt: new Date(current).toISOString(),
            delayMsFromPrevious: stage.delayMsFromPrevious,
            originalTimeExpression: stage.originalTimeExpression,
        });
    }

    return stages;
}

function buildClarificationDecision(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
}): ClarificationDecision {
    const normalized = normalizeText(input.text);

    if (normalized.length === 0) {
        return {
            required: true,
            reason: 'Task input is empty.',
            questions: ['Please describe the task goal and expected output.'],
            missingFields: ['objective'],
            canDefault: false,
            assumptions: [],
        };
    }

    if (input.mode === 'chat') {
        return {
            required: false,
            questions: [],
            missingFields: [],
            canDefault: true,
            assumptions: [],
        };
    }

    if (AMBIGUOUS_FOLLOW_UP_PATTERN.test(normalized)) {
        return {
            required: true,
            reason: 'Follow-up request is ambiguous without explicit objective.',
            questions: ['What exact task should Coworkany continue with?'],
            missingFields: ['objective'],
            canDefault: false,
            assumptions: [],
        };
    }

    return {
        required: false,
        questions: [],
        missingFields: [],
        canDefault: true,
        assumptions: [],
    };
}

function buildMissingInfo(clarification: ClarificationDecision): MissingInfoItem[] {
    return clarification.missingFields.map((field, index) => ({
        field,
        reason: clarification.reason ?? `Missing required field: ${field}`,
        blocking: clarification.required,
        question: clarification.questions[index],
    }));
}

function buildPresentationContract(text: string, ttsEnabled: boolean): PresentationContract {
    const outputPath = extractExplicitOutputTargetPath(text);
    const language = detectLanguage(text);

    return {
        uiFormat: inferUiFormat(text, outputPath),
        ttsEnabled,
        ttsMode: 'summary',
        ttsMaxChars: language.startsWith('zh') ? 220 : 300,
        language,
    };
}

function buildDefaultingPolicy(input: {
    text: string;
    presentation: PresentationContract;
}): DefaultingPolicy {
    const outputPath = extractExplicitOutputTargetPath(input.text);

    return {
        outputLanguage: detectLanguage(input.text),
        uiFormat: input.presentation.uiFormat,
        artifactDirectory: inferOutputDirectory(outputPath),
        checkpointStrategy: HIGH_RISK_ACTION_PATTERN.test(input.text)
            ? 'manual_action'
            : 'review_before_completion',
    };
}

function buildDeliverables(input: {
    text: string;
    workspacePath: string;
    presentation: PresentationContract;
}): DeliverableContract[] {
    const deliverables: DeliverableContract[] = [
        {
            id: randomUUID(),
            title: 'Chat response',
            type: 'chat_reply',
            description: 'Return concise and actionable answer to user.',
            required: true,
        },
    ];

    const outputPath = extractExplicitOutputTargetPath(input.text);
    if (!outputPath && !FILE_WRITE_PATTERN.test(input.text) && !CODE_CHANGE_PATTERN.test(input.text)) {
        return deliverables;
    }

    const normalizedPath = outputPath
        ? path.isAbsolute(outputPath)
            ? outputPath
            : path.resolve(input.workspacePath, outputPath)
        : path.resolve(input.workspacePath, 'artifacts', 'result.md');

    const format = inferArtifactFormat(input.text, normalizedPath);
    const type: DeliverableContract['type'] = CODE_CHANGE_PATTERN.test(input.text)
        ? 'code_change'
        : (format === 'md' || format === 'txt')
            ? 'report_file'
            : 'artifact_file';

    deliverables.push({
        id: randomUUID(),
        title: `Output file (${format})`,
        type,
        description: `Persist generated result to ${normalizedPath}.`,
        required: true,
        path: normalizedPath,
        format,
    });

    return deliverables;
}

function buildHitlPolicy(input: {
    text: string;
    clarification: ClarificationDecision;
    publishIntent?: PublishIntent;
    hostAccessRequired: boolean;
}): HitlPolicy {
    const reasons: string[] = [];

    if (input.clarification.required) {
        reasons.push('Missing task details require user clarification before execution.');
    }

    if (input.hostAccessRequired) {
        reasons.push('Task touches host paths outside current workspace boundary.');
    }

    if (input.publishIntent?.requiresSideEffect) {
        reasons.push(`Task requests external publish action on ${input.publishIntent.platform}.`);
    }

    if (HIGH_RISK_ACTION_PATTERN.test(input.text)) {
        reasons.push('Task includes high-risk actions that should be reviewed.');
    }

    let riskTier: HitlPolicy['riskTier'] = 'low';
    if (input.clarification.required || input.hostAccessRequired || input.publishIntent?.requiresSideEffect) {
        riskTier = 'high';
    } else if (CODE_CHANGE_PATTERN.test(input.text) || SHELL_PATTERN.test(input.text)) {
        riskTier = 'medium';
    }

    return {
        riskTier,
        requiresPlanConfirmation: riskTier !== 'low',
        reasons,
    };
}

function buildRuntimeIsolationPolicy(input: {
    workspacePath: string;
    tasks: TaskDefinition[];
    urls: string[];
}): RuntimeIsolationPolicy {
    const writesWorkspace = input.tasks.some((task) =>
        task.preferredTools.includes('write_to_file') || task.preferredTools.includes('apply_patch'),
    );

    const allowedDomains = dedupeStrings(input.urls
        .map((url) => {
            try {
                return new URL(url).hostname;
            } catch {
                return '';
            }
        })
        .filter((domain) => domain.length > 0));

    return {
        connectorIsolationMode: 'deny_by_default',
        filesystemMode: writesWorkspace ? 'workspace_plus_resolved_targets' : 'workspace_only',
        allowedWorkspacePaths: [input.workspacePath],
        writableWorkspacePaths: writesWorkspace ? [input.workspacePath] : [],
        networkAccess: allowedDomains.length > 0 ? 'restricted' : 'none',
        allowedDomains,
        notes: writesWorkspace
            ? ['Workspace write access allowed for requested deliverables.']
            : ['Read-focused execution unless explicit write tool is used.'],
    };
}

function buildSessionIsolationPolicy(): SessionIsolationPolicy {
    return {
        workspaceBindingMode: 'frozen_workspace_only',
        followUpScope: 'same_task_only',
        allowWorkspaceOverride: false,
        supersededContractHandling: 'tombstone_prior_contracts',
        staleEvidenceHandling: 'evict_on_refreeze',
        notes: ['Session remains scoped to the frozen workspace and current task context.'],
    };
}

function buildMemoryIsolationPolicy(text: string): MemoryIsolationPolicy {
    const preferenceTask = /(偏好|preference|remember my|记住我的)/i.test(text);

    return {
        classificationMode: 'scope_tagged',
        readScopes: preferenceTask
            ? ['task', 'workspace', 'user_preference']
            : ['task', 'workspace'],
        writeScopes: preferenceTask
            ? ['task', 'workspace', 'user_preference']
            : ['task', 'workspace'],
        defaultWriteScope: preferenceTask ? 'user_preference' : 'task',
        notes: preferenceTask
            ? ['Task appears to update user preference memory scope.']
            : ['Default memory writes remain task-scoped.'],
    };
}

function buildTenantIsolationPolicy(): TenantIsolationPolicy {
    return {
        workspaceBoundaryMode: 'same_workspace_only',
        userBoundaryMode: 'current_local_user_only',
        allowCrossWorkspaceMemory: false,
        allowCrossWorkspaceFollowUp: false,
        allowCrossUserMemory: false,
        notes: ['Cross-workspace and cross-user memory are disabled by default.'],
    };
}

function buildGoalFrame(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    primaryTask: TaskDefinition;
    deliverables: DeliverableContract[];
}): GoalFrame {
    const contextSignals = dedupeStrings([
        `mode:${input.mode}`,
        input.primaryTask.localPlanHint?.intent ? `local_intent:${input.primaryTask.localPlanHint.intent}` : '',
        WEB_RESEARCH_PATTERN.test(input.text) ? 'needs_web_research' : '',
        BROWSER_PATTERN.test(input.text) ? 'needs_browser_interaction' : '',
    ]);

    const taskCategory: GoalFrame['taskCategory'] =
        BROWSER_PATTERN.test(input.text)
            ? 'browser'
            : CODE_CHANGE_PATTERN.test(input.text)
                ? 'coding'
                : WEB_RESEARCH_PATTERN.test(input.text)
                    ? 'research'
                    : input.primaryTask.localPlanHint
                        ? 'workspace'
                        : 'mixed';

    return {
        objective: input.primaryTask.objective,
        constraints: input.primaryTask.constraints,
        preferences: input.primaryTask.preferredSkills,
        contextSignals,
        successHypothesis: input.deliverables.map((deliverable) =>
            deliverable.path
                ? `${deliverable.title} created at ${deliverable.path}`
                : `${deliverable.title} completed`,
        ),
        taskCategory,
    };
}

function buildResearchQueries(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    primaryTask: TaskDefinition;
}): ResearchQuery[] {
    const queries: ResearchQuery[] = [
        {
            id: randomUUID(),
            kind: 'context_research',
            source: 'workspace',
            objective: `Inspect workspace context for task: ${input.primaryTask.title}`,
            required: input.mode !== 'chat',
            status: 'pending',
        },
    ];

    if (WEB_RESEARCH_PATTERN.test(input.text) && !LOCAL_SEARCH_SCOPE_PATTERN.test(input.text)) {
        queries.push({
            id: randomUUID(),
            kind: 'domain_research',
            source: 'web',
            objective: input.primaryTask.objective,
            directUrls: input.primaryTask.sourceUrls,
            required: /latest|最新|today|新闻|news/i.test(input.text),
            status: 'pending',
        });
    }

    if (input.mode === 'scheduled_task' || input.mode === 'scheduled_multi_task') {
        queries.push({
            id: randomUUID(),
            kind: 'feasibility_research',
            source: 'memory',
            objective: 'Check prior scheduled-task outcomes for reusable execution hints.',
            required: false,
            status: 'pending',
        });
    }

    return queries;
}

function buildResearchEvidence(input: {
    sourceText: string;
    primaryTask: TaskDefinition;
}): ResearchEvidence[] {
    return [
        {
            id: randomUUID(),
            kind: 'context_research',
            source: 'conversation',
            summary: `Seeded from user request: ${input.sourceText.slice(0, 180)}`,
            confidence: 0.72,
            collectedAt: new Date().toISOString(),
        },
        {
            id: randomUUID(),
            kind: 'feasibility_research',
            source: 'template',
            summary: `Prepared initial execution frame for task "${input.primaryTask.title}".`,
            confidence: 0.58,
            collectedAt: new Date().toISOString(),
        },
    ];
}

function buildUncertaintyRegistry(input: {
    clarification: ClarificationDecision;
    evidence: ResearchEvidence[];
}): UncertaintyItem[] {
    if (!input.clarification.required) {
        return [];
    }

    return [
        {
            id: randomUUID(),
            topic: 'clarification_required',
            status: 'blocking_unknown',
            statement: input.clarification.reason || 'Task details are insufficient for safe execution.',
            whyItMatters: 'Execution should not proceed until the required missing details are provided.',
            question: input.clarification.questions[0],
            supportingEvidenceIds: input.evidence.map((item) => item.id),
        },
    ];
}

function buildStrategyOptions(input: {
    text: string;
    evidence: ResearchEvidence[];
}): { strategyOptions: StrategyOption[]; selectedStrategyId?: string } {
    const conservativeId = randomUUID();
    const directId = randomUUID();
    const evidenceIds = input.evidence.map((item) => item.id);

    const strategyOptions: StrategyOption[] = [
        {
            id: conservativeId,
            title: 'Conservative staged execution',
            description: 'Validate assumptions, then execute with checkpoints.',
            pros: ['Lower execution risk', 'Clear review gates'],
            cons: ['More interaction overhead'],
            feasibility: 'high',
            supportingEvidenceIds: evidenceIds,
            selected: HIGH_RISK_ACTION_PATTERN.test(input.text),
            rejectionReason: HIGH_RISK_ACTION_PATTERN.test(input.text)
                ? undefined
                : 'Direct execution is acceptable for this task profile.',
        },
        {
            id: directId,
            title: 'Direct execution',
            description: 'Execute immediately with minimal review overhead.',
            pros: ['Fast turnaround', 'Lower interaction cost'],
            cons: ['Less explicit risk buffering'],
            feasibility: 'high',
            supportingEvidenceIds: evidenceIds,
            selected: !HIGH_RISK_ACTION_PATTERN.test(input.text),
            rejectionReason: HIGH_RISK_ACTION_PATTERN.test(input.text)
                ? 'High-risk signals favor staged execution.'
                : undefined,
        },
    ];

    const selected = strategyOptions.find((option) => option.selected)?.id;
    return { strategyOptions, selectedStrategyId: selected };
}

function buildReplanPolicy(): ReplanPolicy {
    return {
        allowReturnToResearch: true,
        triggers: [
            'new_scope_signal',
            'missing_resource',
            'permission_block',
            'contradictory_evidence',
            'execution_infeasible',
        ],
    };
}

function buildResumeStrategy(): ResumeStrategy {
    return {
        mode: 'continue_from_saved_context',
        preserveDeliverables: true,
        preserveCompletedSteps: true,
        preserveArtifacts: true,
    };
}

function isLikelyChat(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) {
        return true;
    }
    if (CHAT_ACK_PATTERN.test(normalized)) {
        return true;
    }
    return normalized.length <= 16 && !WEB_RESEARCH_PATTERN.test(normalized) && !CODE_CHANGE_PATTERN.test(normalized);
}

function extractForcedIntent(sourceTextRaw: string): {
    intent?: IntentRouting['intent'];
    forcedByUserSelection?: boolean;
} {
    const trimmed = sourceTextRaw.trim();

    for (const command of EXPLICIT_INTENT_COMMANDS) {
        if (command.pattern.test(trimmed)) {
            return {
                intent: command.intent,
                forcedByUserSelection: true,
            };
        }
    }

    const tokenMatch = trimmed.match(ROUTE_TOKEN_PATTERN);
    if (tokenMatch?.[1]) {
        const mapped = resolveUserRouteIntent(tokenMatch[1]);
        if (mapped) {
            return {
                intent: mapped,
                forcedByUserSelection: true,
            };
        }
    }

    const routedMatch = trimmed.match(ROUTED_FOLLOW_UP_PATTERN);
    if (routedMatch?.[1]) {
        const mapped = resolveUserRouteIntent(routedMatch[1]);
        if (mapped) {
            return {
                intent: mapped,
                forcedByUserSelection: true,
            };
        }
    }

    return {};
}

function unwrapStructuredFollowUpSourceText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
        return trimmed;
    }

    const correction = trimmed.match(STRUCTURED_CORRECTION_PATTERN);
    if (correction?.[1]) {
        const base = correction[1].trim();
        const update = (correction[2] ?? '').trim();
        return normalizeText(update ? `${base}\n${update}` : base);
    }

    const approved = trimmed.match(STRUCTURED_APPROVAL_PATTERN);
    if (approved?.[1]) {
        return normalizeText(approved[1]);
    }

    const routed = trimmed.match(STRUCTURED_ROUTE_PATTERN);
    if (routed?.[1]) {
        return normalizeText(routed[1]);
    }

    const baseOnly = trimmed.match(STRUCTURED_BASE_ONLY_PATTERN);
    if (baseOnly?.[1]) {
        return normalizeText(baseOnly[1]);
    }

    return text;
}

function hasStructuredApprovalFollowUp(text: string): boolean {
    return STRUCTURED_APPROVAL_PATTERN.test(text.trim());
}

function isContextRichFollowUp(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    return trimmed.length < 8 || AMBIGUOUS_FOLLOW_UP_PATTERN.test(trimmed);
}

function buildAnalysisSourceText(input: {
    sourceText: string;
    followUpContext?: WorkRequestFollowUpContext;
}): string {
    if (!isContextRichFollowUp(input.sourceText)) {
        return input.sourceText;
    }

    const baseObjective = input.followUpContext?.baseObjective?.trim();
    if (!baseObjective) {
        return input.sourceText;
    }

    const latestAssistantMessage = input.followUpContext?.latestAssistantMessage?.trim();
    const recentMessages = (input.followUpContext?.recentMessages ?? [])
        .map((message) => `${message.role}: ${normalizeText(message.content)}`)
        .filter((value) => value.length > 0)
        .slice(-4);

    return [
        `Base objective: ${baseObjective}`,
        latestAssistantMessage ? `Latest assistant update: ${latestAssistantMessage}` : '',
        ...recentMessages,
        `Follow-up request: ${input.sourceText.trim()}`,
    ]
        .filter((line) => line.length > 0)
        .join('\n');
}

function resolveWorkMode(input: {
    text: string;
    forcedIntent?: IntentRouting['intent'];
    scheduledIntent: ParsedScheduledIntent | null;
}): NormalizedWorkRequest['mode'] {
    if (input.forcedIntent === 'chat') {
        return 'chat';
    }

    if (input.scheduledIntent) {
        const hasChain = (input.scheduledIntent.chainedStages?.length ?? 0) > 0;
        return hasChain ? 'scheduled_multi_task' : 'scheduled_task';
    }

    if (input.forcedIntent === 'scheduled_task') {
        return 'scheduled_task';
    }

    if (input.forcedIntent === 'immediate_task') {
        return 'immediate_task';
    }

    return isLikelyChat(input.text) ? 'chat' : 'immediate_task';
}

function buildIntentRouting(input: {
    mode: NormalizedWorkRequest['mode'];
    scheduledIntent: ParsedScheduledIntent | null;
    clarification: ClarificationDecision;
    forcedIntent?: IntentRouting['intent'];
    forcedByUserSelection?: boolean;
}): IntentRouting {
    const intent: IntentRouting['intent'] =
        input.mode === 'scheduled_task' || input.mode === 'scheduled_multi_task'
            ? 'scheduled_task'
            : input.mode;

    const reasonCodes = dedupeStrings([
        input.forcedIntent ? 'forced_route' : '',
        input.scheduledIntent ? 'scheduled_intent_detected' : '',
        input.clarification.required ? 'clarification_required' : 'clarification_not_required',
    ]);

    return {
        intent,
        confidence: input.forcedIntent
            ? 0.98
            : input.scheduledIntent
                ? 0.95
                : input.mode === 'chat'
                    ? 0.72
                    : 0.84,
        reasonCodes,
        needsDisambiguation: input.clarification.required,
        forcedByUserSelection: input.forcedByUserSelection,
    };
}

export function analyzeWorkRequest(input: {
    sourceText: string;
    workspacePath: string;
    followUpContext?: WorkRequestFollowUpContext;
    now?: Date;
    environmentContext?: PlatformRuntimeContext;
    systemContext?: SystemFolderResolutionOptions;
}): NormalizedWorkRequest {
    const sourceTextRaw = input.sourceText;
    const unwrappedSourceText = unwrapStructuredFollowUpSourceText(sourceTextRaw);
    const analysisSourceText = buildAnalysisSourceText({
        sourceText: unwrappedSourceText,
        followUpContext: input.followUpContext,
    });

    const route = extractForcedIntent(sourceTextRaw);
    const scheduledIntent = detectScheduledIntent(analysisSourceText, input.now);
    const publishIntent = inferPublishIntent(analysisSourceText);

    const mode = resolveWorkMode({
        text: analysisSourceText,
        forcedIntent: route.intent,
        scheduledIntent,
    });

    const ttsEnabled = scheduledIntent?.speakResult ?? false;
    const presentation = buildPresentationContract(analysisSourceText, ttsEnabled);
    const clarification = buildClarificationDecision({
        text: analysisSourceText,
        mode,
    });

    const tasks = scheduledIntent
        ? buildScheduledTaskDefinitions({
            scheduledIntent,
            mode,
            workspacePath: input.workspacePath,
            systemContext: input.systemContext,
            publishIntent,
        })
        : [buildTaskDefinition({
            text: analysisSourceText,
            mode,
            workspacePath: input.workspacePath,
            systemContext: input.systemContext,
            publishIntent,
        })];

    const primaryTask = tasks[0] ?? buildTaskDefinition({
        text: analysisSourceText,
        mode,
        workspacePath: input.workspacePath,
        systemContext: input.systemContext,
        publishIntent,
    });

    const deliverables = buildDeliverables({
        text: analysisSourceText,
        workspacePath: input.workspacePath,
        presentation,
    });

    const hasManualAction = MANUAL_ACTION_PATTERN.test(analysisSourceText);
    const isPlanApproved = hasStructuredApprovalFollowUp(sourceTextRaw);
    const hasBlockingManualAction = hasManualAction && !isPlanApproved;
    const explicitAuthRequired = AUTH_PATTERN.test(analysisSourceText);
    const hostAccessRequired = primaryTask.localPlanHint?.requiresHostAccessGrant === true;
    const requiresBrowserSkill = primaryTask.preferredTools.some((tool) => tool.startsWith('browser_'));
    const hasPreferredWorkflow = tasks.some((task) => Boolean(task.preferredWorkflow));
    const isComplexTask = tasks.length > 1 || /(步骤|step by step|拆解|plan|multi-step)/i.test(analysisSourceText);
    const codeChangeTask = tasks.some((task) => task.preferredTools.includes('apply_patch'));
    const selfManagementTask = /(coworkany|系统设置|workspace 管理|toolpack|skill)/i.test(analysisSourceText);

    const hitlPolicy = buildHitlPolicy({
        text: analysisSourceText,
        clarification,
        publishIntent,
        hostAccessRequired,
    });

    const executionProfile = buildExecutionProfile({
        mode,
        clarification,
        deliverables,
        hitlPolicy,
        publishIntent,
        hasManualAction,
        hasBlockingManualAction,
        requiresBrowserSkill,
        explicitAuthRequired,
        hostAccessRequired,
        hasPreferredWorkflow,
        isComplexTask,
        codeChangeTask,
        selfManagementTask,
    });

    const capabilityPlan = buildCapabilityPlan({
        clarification,
        executionProfile,
        publishIntent,
        explicitAuthSignal: explicitAuthRequired,
        hasBlockingManualAction,
        hasPreferredWorkflow,
    });

    const checkpoints = buildCheckpointsFromExecutionProfile({
        isComplexTask,
        deliverables,
        executionProfile,
        capabilityPlan,
        hitlPolicy,
        clarification,
        publishIntent,
    });

    const missingInfo = buildMissingInfo(clarification);
    const userActionsRequired = buildUserActionsRequiredFromExecutionProfile({
        clarification,
        missingInfo,
        checkpoints,
        executionProfile,
        capabilityPlan,
        hitlPolicy,
        publishIntent,
        likelyExternalAuth: explicitAuthRequired || publishIntent?.requiresSideEffect === true,
    });

    const goalFrame = buildGoalFrame({
        text: analysisSourceText,
        mode,
        primaryTask,
        deliverables,
    });

    const defaultingPolicy = buildDefaultingPolicy({
        text: analysisSourceText,
        presentation,
    });

    const researchQueries = buildResearchQueries({
        text: analysisSourceText,
        mode,
        primaryTask,
    });

    const researchEvidence = buildResearchEvidence({
        sourceText: analysisSourceText,
        primaryTask,
    });

    const uncertaintyRegistry = buildUncertaintyRegistry({
        clarification,
        evidence: researchEvidence,
    });

    const { strategyOptions, selectedStrategyId } = buildStrategyOptions({
        text: analysisSourceText,
        evidence: researchEvidence,
    });

    const schedule = scheduledIntent
        ? {
            executeAt: scheduledIntent.executeAt.toISOString(),
            timezone: 'Asia/Shanghai',
            recurrence: scheduledIntent.recurrence ?? null,
            stages: buildScheduledStages({
                scheduledIntent,
                tasks,
            }),
        }
        : undefined;

    const urls = extractExplicitUrls(analysisSourceText);

    const intentRouting = buildIntentRouting({
        mode,
        scheduledIntent,
        clarification,
        forcedIntent: route.intent,
        forcedByUserSelection: route.forcedByUserSelection,
    });

    return {
        schemaVersion: 1,
        mode,
        intentRouting,
        taskDraftRequired: clarification.required,
        sourceText: unwrappedSourceText,
        workspacePath: input.workspacePath,
        environmentContext: input.environmentContext,
        schedule,
        tasks,
        clarification: {
            ...clarification,
            assumptions: dedupeStrings([
                ...clarification.assumptions,
                `Coworkany owns task decomposition and execution planning.`,
                `Default UI format: ${defaultingPolicy.uiFormat}.`,
                `Default artifact directory: ${defaultingPolicy.artifactDirectory}.`,
                scheduledIntent ? 'Scheduled request is frozen before deferred execution.' : '',
            ]),
        },
        presentation,
        deliverables,
        checkpoints,
        userActionsRequired,
        executionProfile,
        publishIntent,
        capabilityPlan,
        hitlPolicy,
        runtimeIsolationPolicy: buildRuntimeIsolationPolicy({
            workspacePath: input.workspacePath,
            tasks,
            urls,
        }),
        sessionIsolationPolicy: buildSessionIsolationPolicy(),
        memoryIsolationPolicy: buildMemoryIsolationPolicy(analysisSourceText),
        tenantIsolationPolicy: buildTenantIsolationPolicy(),
        missingInfo,
        defaultingPolicy,
        resumeStrategy: buildResumeStrategy(),
        goalFrame,
        researchQueries,
        researchEvidence,
        uncertaintyRegistry,
        strategyOptions,
        selectedStrategyId,
        knownRisks: dedupeStrings([
            ...hitlPolicy.reasons,
            ...executionProfile.reasons,
            clarification.required ? 'Clarification required before execution can proceed.' : '',
            capabilityPlan.userAssistRequired ? 'User assistance is required to unblock execution.' : '',
        ]),
        replanPolicy: buildReplanPolicy(),
        createdAt: new Date().toISOString(),
    };
}

export function freezeWorkRequest(request: NormalizedWorkRequest): FrozenWorkRequest {
    const selectedStrategy = request.strategyOptions?.find((option) => option.id === request.selectedStrategyId);
    const sourcesChecked = Array.from(new Set((request.researchEvidence ?? []).map((evidence) => evidence.source)));
    const blockingUnknownCount = (request.uncertaintyRegistry ?? [])
        .filter((item) => item.status === 'blocking_unknown')
        .length;

    return {
        ...request,
        id: randomUUID(),
        frozenAt: new Date().toISOString(),
        frozenResearchSummary: {
            evidenceCount: request.researchEvidence?.length ?? 0,
            sourcesChecked,
            blockingUnknownCount,
            selectedStrategyTitle: selectedStrategy?.title,
        },
    };
}

export function buildExecutionPlan(request: FrozenWorkRequest): ExecutionPlan {
    const steps: ExecutionPlan['steps'] = [];
    const hasBlockingUnknowns = (request.uncertaintyRegistry ?? [])
        .some((item) => item.status === 'blocking_unknown');

    const analysisStepId = randomUUID();
    const freezeStepId = randomUUID();

    steps.push({
        stepId: analysisStepId,
        kind: 'analysis',
        title: 'Analyze request intent',
        description: 'Normalize user input into executable task contracts.',
        status: 'completed',
        dependencies: [],
    });

    steps.push({
        stepId: freezeStepId,
        kind: 'contract_freeze',
        title: hasBlockingUnknowns ? 'Await contract freeze' : 'Freeze execution contract',
        description: hasBlockingUnknowns
            ? 'Blocking uncertainty remains; waiting for clarification before execution.'
            : 'Execution contract is frozen and ready.',
        status: hasBlockingUnknowns ? 'blocked' : 'completed',
        dependencies: [analysisStepId],
    });

    const executionSteps = request.tasks.map((task) => {
        const stepId = randomUUID();
        return {
            stepId,
            task,
        };
    });

    const executionStepByTaskId = new Map(executionSteps.map((entry) => [entry.task.id, entry.stepId]));
    const executionStepIds: string[] = [];

    for (const entry of executionSteps) {
        executionStepIds.push(entry.stepId);

        const dependencyStepIds = entry.task.dependencies.flatMap((dependencyId) => {
            const dependencyStepId = executionStepByTaskId.get(dependencyId);
            return dependencyStepId === undefined ? [] : [dependencyStepId];
        });

        steps.push({
            stepId: entry.stepId,
            taskId: entry.task.id,
            kind: 'execution',
            title: entry.task.title,
            description: entry.task.objective,
            status: hasBlockingUnknowns ? 'blocked' : 'pending',
            dependencies: [freezeStepId, ...dependencyStepIds],
        });
    }

    const reductionStepId = randomUUID();
    steps.push({
        stepId: reductionStepId,
        kind: 'reduction',
        title: 'Reduce execution output',
        description: 'Condense raw execution output into canonical response payload.',
        status: hasBlockingUnknowns ? 'blocked' : 'pending',
        dependencies: executionStepIds,
    });

    steps.push({
        stepId: randomUUID(),
        kind: 'presentation',
        title: 'Present final result',
        description: 'Present final result to user in selected UI/TTS format.',
        status: hasBlockingUnknowns ? 'blocked' : 'pending',
        dependencies: [reductionStepId],
    });

    return {
        workRequestId: request.id,
        runMode: request.tasks.length > 1 ? 'dag' : 'single',
        steps,
    };
}

export function buildExecutionQueryForTaskIds(
    request: Pick<FrozenWorkRequest, 'tasks' | 'deliverables' | 'checkpoints'>,
    taskIds?: string[],
    options?: {
        includeGlobalContracts?: boolean;
    },
): string {
    const includeGlobalContracts = options?.includeGlobalContracts ?? true;

    const selectedTasks = taskIds && taskIds.length > 0
        ? request.tasks.filter((task) => taskIds.includes(task.id))
        : request.tasks;

    return selectedTasks
        .map((task) => {
            const parts = [task.objective];

            if ((task.sourceUrls?.length ?? 0) > 0) {
                parts.push(`Reference URLs: ${task.sourceUrls!.join('; ')}`);
            }
            if (task.constraints.length > 0) {
                parts.push(`Constraints: ${task.constraints.join('; ')}`);
            }
            if (task.acceptanceCriteria.length > 0) {
                parts.push(`Acceptance criteria: ${task.acceptanceCriteria.join('; ')}`);
            }

            if (includeGlobalContracts && (request.deliverables?.length ?? 0) > 0) {
                const deliverableLine = request.deliverables!
                    .map((deliverable) => deliverable.path
                        ? `${deliverable.title} (${deliverable.path})`
                        : deliverable.title)
                    .join('; ');
                parts.push(`Deliverables: ${deliverableLine}`);
            }

            if (includeGlobalContracts && (request.checkpoints?.length ?? 0) > 0) {
                const checkpointLine = request.checkpoints!
                    .map((checkpoint) => checkpoint.title)
                    .join('; ');
                parts.push(`Checkpoints: ${checkpointLine}`);
            }

            return parts.join('\n');
        })
        .join('\n\n');
}

export function buildExecutionQuery(request: FrozenWorkRequest): string {
    return buildExecutionQueryForTaskIds(request);
}

export function reduceWorkResult(input: {
    canonicalResult: string;
    request: FrozenWorkRequest;
    artifacts?: string[];
}): PresentationPayload {
    const canonicalResult = cleanScheduledTaskResultText(input.canonicalResult) || input.canonicalResult.trim();
    const uiSummary = canonicalResult;
    const normalizedForSpeech = normalizeScheduledTaskResultText(canonicalResult);

    const ttsSummary =
        input.request.presentation.ttsMode === 'full' || input.request.presentation.ttsMaxChars <= 0
            ? normalizedForSpeech
            : normalizedForSpeech.slice(0, input.request.presentation.ttsMaxChars);

    return {
        canonicalResult,
        uiSummary,
        ttsSummary,
        artifacts: input.artifacts ?? [],
    };
}
