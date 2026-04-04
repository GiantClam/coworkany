import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
    CheckpointContract,
    ClarificationDecision,
    DeliverableContract,
    ExecutionPlan,
    FrozenWorkRequest,
    HitlPolicy,
    NormalizedWorkRequest,
    PresentationContract,
    PublishIntent,
    ResearchEvidence,
    ResearchQuery,
    TaskDefinition,
    UserActionRequest,
    WorkRequestFollowUpContext,
} from './workRequestSchema';
import { buildExecutionProfile } from './workRequestPolicy';
import {
    detectScheduledIntent,
    type ParsedScheduledIntent,
} from '../scheduling/scheduledTasks';
import {
    parseRoutedInput,
    resolveForcedWorkMode,
    type ForcedRouteMode,
} from './routedInput';
import type { PlatformRuntimeContext } from '../protocol/commands';
const URL_PATTERN = /\bhttps?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
const CHAT_PATTERN = /^(hi|hello|hey|你好|您好|在吗|thanks|thank you|谢谢|收到|ok|好的)[.!?？。!]*$/i;
const CODE_PATTERN = /(修复|修改|重构|实现|patch|apply patch|edit|refactor|implement|bug|test|代码|code)/i;
const FILE_WRITE_PATTERN = /(写入|保存|创建文件|生成文件|输出到|write to|save to|create (a )?file|readme|markdown|md\b)/i;
const SHELL_PATTERN = /(运行命令|执行命令|terminal|shell|bash|zsh|command line|run command|npm\s+run|bun\s+run)/i;
const HOST_CONTROL_PATTERN = /(关机|重启|\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b)/i;
const BROWSER_PATTERN = /(浏览器|网页|打开网站|click|navigate|browser|playwright|screenshot|页面)/i;
const WEB_RESEARCH_PATTERN = /(搜索|调研|research|search|latest|最新|today|新闻|news|行情|市场|web)/i;
const HIGH_RISK_ACTION_PATTERN = /(删除|移除|drop\s+table|rm\s+-rf|publish|发帖|发布到|send email|付款|payment)/i;
const MANUAL_ACTION_PATTERN = /(登录|验证码|captcha|手动|人工|approve|approval|确认后再|先让我看)/i;
const AUTH_PATTERN = /(登录|授权|auth|oauth|token|session|cookie|验证码|captcha)/i;
const SELF_MANAGEMENT_PATTERN = /toolpack|skill|workspace 管理|workspace management/i;
const PARALLEL_PATTERN = /(并行|同时|parallel|concurrently|in parallel)/i;
const CHAIN_PATTERN = /(然后|接着|随后|之后|再(?:执行|做|进行)?|first\b[\s\S]{0,80}\bthen|then\b[\s\S]{0,40}\bfinally)/i;
const WEB_URGENT_PATTERN = /latest|最新|today|新闻|news/i;
type IntentSignals = {
    code: boolean;
    fileWrite: boolean;
    shell: boolean;
    browser: boolean;
    webResearch: boolean;
    highRisk: boolean;
    manualAction: boolean;
    auth: boolean;
    selfManagement: boolean;
    parallel: boolean;
    chain: boolean;
};
const dedupe = <T extends string>(values: T[]): T[] =>
    Array.from(new Set(values.filter((value) => value.trim().length > 0))) as T[];
const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();
const detectLanguage = (text: string): string => (/[\u3400-\u9FFF]/u.test(text) ? 'zh-CN' : 'en-US');
function extractUrls(text: string): string[] {
    return dedupe((text.match(URL_PATTERN) ?? []).map((item) => item.trim()));
}
function extractOutputPath(text: string): string | undefined {
    const cue = text.match(/(?:保存(?:到|为)?|输出到|write\s+to|save\s+to|output\s+to)\s+([^\s]+)/i);
    return cue?.[1]?.replace(/[),.;，。；]+$/g, '').trim();
}
function collectSignals(text: string): IntentSignals {
    return {
        code: CODE_PATTERN.test(text),
        fileWrite: FILE_WRITE_PATTERN.test(text),
        shell: SHELL_PATTERN.test(text) || HOST_CONTROL_PATTERN.test(text),
        browser: BROWSER_PATTERN.test(text),
        webResearch: WEB_RESEARCH_PATTERN.test(text),
        highRisk: HIGH_RISK_ACTION_PATTERN.test(text),
        manualAction: MANUAL_ACTION_PATTERN.test(text),
        auth: AUTH_PATTERN.test(text),
        selfManagement: SELF_MANAGEMENT_PATTERN.test(text),
        parallel: PARALLEL_PATTERN.test(text),
        chain: CHAIN_PATTERN.test(text),
    };
}
function inferPublishIntent(text: string): PublishIntent | undefined {
    const lower = text.toLowerCase();
    const platform = lower.includes('xiaohongshu') || text.includes('小红书')
        ? 'xiaohongshu'
        : lower.includes('twitter') || lower.includes('x.com') || /\b在\s*x\s*上\b/i.test(text)
            ? 'x'
            : undefined;
    if (!platform) return undefined;
    const draftOnly = /(仅草稿|不要发布|draft only|do not publish)/i.test(text);
    const previewThenPublish = /(先看|预览|确认后|review first|preview)/i.test(text);
    return {
        action: 'publish_social_post',
        platform,
        executionMode: draftOnly ? 'draft_only' : previewThenPublish ? 'preview_then_publish' : 'direct_publish',
        requiresSideEffect: !draftOnly,
    };
}
function inferPreferredTools(signals: IntentSignals, publishIntent?: PublishIntent): string[] {
    const tools: string[] = [];
    if (signals.code) tools.push('read_file', 'list_dir', 'apply_patch');
    if (signals.fileWrite) tools.push('write_to_file');
    if (signals.shell) tools.push('run_command');
    if (signals.browser) tools.push('browser_navigate');
    if (signals.webResearch) tools.push('search_web');
    if (publishIntent?.platform === 'xiaohongshu') tools.push('xiaohongshu_post');
    if (tools.length === 0) tools.push('list_dir');
    return dedupe(tools);
}
function inferPreferredSkills(signals: IntentSignals, mode: NormalizedWorkRequest['mode']): string[] {
    const skills: string[] = [];
    if (signals.code) {
        skills.push('systematic-debugging', 'verification-before-completion');
    }
    if (signals.webResearch || mode.startsWith('scheduled')) {
        skills.push('planning-with-files');
    }
    return dedupe(skills);
}
function buildTask(input: {
    objective: string;
    mode: NormalizedWorkRequest['mode'];
    publishIntent?: PublishIntent;
    dependencyIds?: string[];
}): TaskDefinition {
    const objective = normalizeText(input.objective);
    const urls = extractUrls(objective);
    const signals = collectSignals(objective);
    return {
        id: randomUUID(),
        title: objective.length > 72 ? `${objective.slice(0, 69)}...` : objective || 'Task',
        objective,
        constraints: urls.length > 0 ? ['Use referenced URLs when relevant.'] : [],
        acceptanceCriteria: ['Produce a user-facing result with clear completion status.'],
        dependencies: input.dependencyIds ?? [],
        preferredSkills: inferPreferredSkills(signals, input.mode),
        preferredTools: inferPreferredTools(signals, input.publishIntent),
        sourceUrls: urls.length > 0 ? urls : undefined,
    };
}
function buildTasksFromScheduledIntent(input: {
    scheduledIntent: ParsedScheduledIntent;
    mode: NormalizedWorkRequest['mode'];
    publishIntent?: PublishIntent;
}): TaskDefinition[] {
    const tasks = [
        buildTask({
            objective: input.scheduledIntent.taskQuery,
            mode: input.mode,
            publishIntent: input.publishIntent,
        }),
    ];
    for (const stage of input.scheduledIntent.chainedStages ?? []) {
        tasks.push(
            buildTask({
                objective: stage.taskQuery,
                mode: input.mode,
                publishIntent: input.publishIntent,
                dependencyIds: [tasks[tasks.length - 1]!.id],
            }),
        );
    }
    return tasks;
}
function buildPresentation(text: string, speakResult: boolean, signals: IntentSignals): PresentationContract {
    const language = detectLanguage(text);
    return {
        uiFormat: signals.fileWrite ? 'artifact' : signals.webResearch ? 'report' : 'chat_message',
        ttsEnabled: speakResult,
        ttsMode: 'summary',
        ttsMaxChars: language.startsWith('zh') ? 220 : 300,
        language,
    };
}
function buildClarification(text: string): ClarificationDecision {
    if (text) {
        return {
            required: false,
            questions: [],
            missingFields: [],
            canDefault: true,
            assumptions: [],
        };
    }
    return {
        required: true,
        reason: 'Task input is empty.',
        questions: ['Please describe the task goal and expected output.'],
        missingFields: ['objective'],
        canDefault: false,
        assumptions: [],
    };
}
function buildDeliverables(text: string, workspacePath: string, signals: IntentSignals): DeliverableContract[] {
    const deliverables: DeliverableContract[] = [
        {
            id: randomUUID(),
            title: 'Chat response',
            type: 'chat_reply',
            description: 'Return concise and actionable answer to user.',
            required: true,
        },
    ];
    if (!signals.fileWrite && !signals.code) {
        return deliverables;
    }
    const explicitPath = extractOutputPath(text);
    const resolvedPath = explicitPath
        ? path.isAbsolute(explicitPath)
            ? explicitPath
            : path.resolve(workspacePath, explicitPath)
        : path.resolve(workspacePath, 'artifacts', 'result.md');
    deliverables.push({
        id: randomUUID(),
        title: signals.code ? 'Code changes' : 'Generated artifact',
        type: signals.code ? 'code_change' : 'artifact_file',
        description: `Persist result to ${resolvedPath}.`,
        required: true,
        path: resolvedPath,
        format: path.extname(resolvedPath).replace('.', '') || 'md',
    });
    return deliverables;
}
function buildHitlPolicy(input: {
    clarification: ClarificationDecision;
    publishIntent?: PublishIntent;
    hostAccessRequired: boolean;
    signals: IntentSignals;
}): HitlPolicy {
    const reasons: string[] = [];
    if (input.clarification.required) reasons.push('Missing details require clarification.');
    if (input.hostAccessRequired) reasons.push('Task targets host paths outside workspace boundary.');
    if (input.publishIntent?.requiresSideEffect) reasons.push('Task includes external publishing side effects.');
    if (input.signals.highRisk) reasons.push('Task contains high-risk actions.');
    const highRisk = input.clarification.required
        || input.hostAccessRequired
        || Boolean(input.publishIntent?.requiresSideEffect)
        || input.signals.highRisk;
    // Shell-like operational commands rely on tool-level approval gates.
    // Avoid plan-confirmation checkpoints that block direct approval flows.
    const mediumRisk = input.signals.code || input.signals.browser;
    return {
        riskTier: highRisk ? 'high' : mediumRisk ? 'medium' : 'low',
        requiresPlanConfirmation: highRisk || mediumRisk,
        reasons,
    };
}
function buildCheckpoints(input: {
    clarification: ClarificationDecision;
    hitlPolicy: HitlPolicy;
    publishIntent?: PublishIntent;
}): CheckpointContract[] {
    if (input.clarification.required) {
        return [{
            id: randomUUID(),
            title: 'Clarification required',
            kind: 'manual_action',
            reason: input.clarification.reason ?? 'Missing required details.',
            userMessage: 'Collect required clarifications before execution.',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            requiresUserConfirmation: true,
            blocking: true,
        }];
    }
    if (input.publishIntent?.executionMode === 'preview_then_publish' || input.hitlPolicy.requiresPlanConfirmation) {
        return [{
            id: randomUUID(),
            title: 'Review checkpoint',
            kind: 'review',
            reason: 'Execution requires explicit review before continuing.',
            userMessage: 'Review and approve execution plan.',
            riskTier: input.hitlPolicy.riskTier,
            executionPolicy: 'review_required',
            requiresUserConfirmation: true,
            blocking: true,
        }];
    }
    return [];
}
function buildUserActions(input: {
    clarification: ClarificationDecision;
    checkpoints: CheckpointContract[];
    signals: IntentSignals;
}): UserActionRequest[] {
    if (input.clarification.required) {
        return [{
            id: randomUUID(),
            title: 'Provide missing details',
            kind: 'clarify_input',
            description: input.clarification.reason ?? 'Coworkany needs more details.',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            blocking: true,
            questions: input.clarification.questions,
            instructions: input.clarification.missingFields,
            fulfillsCheckpointId: input.checkpoints[0]?.id,
        }];
    }
    if (input.signals.manualAction || input.signals.auth) {
        return [{
            id: randomUUID(),
            title: 'Complete manual/auth action',
            kind: input.signals.auth ? 'external_auth' : 'manual_step',
            description: 'A user-side manual/auth step is required before continuing.',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            blocking: true,
            questions: [],
            instructions: ['Complete the required step and resume the task.'],
            fulfillsCheckpointId: input.checkpoints[0]?.id,
        }];
    }
    return [];
}
function resolveMode(input: {
    text: string;
    scheduledIntent: ParsedScheduledIntent | null;
    forcedRouteMode?: ForcedRouteMode | null;
}): NormalizedWorkRequest['mode'] {
    const forcedMode = resolveForcedWorkMode(input.forcedRouteMode);
    if (input.scheduledIntent && forcedMode !== 'chat') {
        return (input.scheduledIntent.chainedStages?.length ?? 0) > 0
            ? 'scheduled_multi_task'
            : 'scheduled_task';
    }
    if (forcedMode) {
        return forcedMode;
    }
    if (HOST_CONTROL_PATTERN.test(input.text)) {
        return 'immediate_task';
    }
    if (!input.text || CHAT_PATTERN.test(input.text) || input.text.length <= 16) {
        return 'chat';
    }
    return 'immediate_task';
}
function maybeInjectFollowUpContext(input: {
    sourceText: string;
    followUpContext?: WorkRequestFollowUpContext;
}): string {
    const text = normalizeText(input.sourceText);
    if (text.length > 8 || !input.followUpContext?.baseObjective) return text;
    return normalizeText(`${input.followUpContext.baseObjective} ${text}`);
}
function buildSchedule(
    scheduledIntent: ParsedScheduledIntent,
    tasks: TaskDefinition[],
): NonNullable<NormalizedWorkRequest['schedule']> {
    let cumulativeDelayMs = 0;
    return {
        executeAt: scheduledIntent.executeAt.toISOString(),
        timezone: 'Asia/Shanghai',
        recurrence: scheduledIntent.recurrence ?? null,
        stages: tasks.map((task, index) => {
            if (index > 0) {
                cumulativeDelayMs += scheduledIntent.chainedStages?.[index - 1]?.delayMsFromPrevious ?? 0;
            }
            return {
                taskId: task.id,
                executeAt: new Date(scheduledIntent.executeAt.getTime() + cumulativeDelayMs).toISOString(),
                delayMsFromPrevious: index > 0 ? scheduledIntent.chainedStages?.[index - 1]?.delayMsFromPrevious : undefined,
                originalTimeExpression: index === 0
                    ? scheduledIntent.originalTimeExpression
                    : scheduledIntent.chainedStages?.[index - 1]?.originalTimeExpression,
            };
        }),
    };
}
function buildResearchQueries(input: {
    sourceText: string;
    mode: NormalizedWorkRequest['mode'];
    primaryTitle: string;
    primaryObjective: string;
    signals: IntentSignals;
}): ResearchQuery[] {
    const queries: ResearchQuery[] = [{
        id: randomUUID(),
        kind: 'context_research',
        source: 'workspace',
        objective: `Inspect workspace context for task: ${input.primaryTitle}`,
        required: input.mode !== 'chat',
        status: 'pending',
    }];
    if (input.signals.webResearch) {
        queries.push({
            id: randomUUID(),
            kind: 'domain_research',
            source: 'web',
            objective: input.primaryObjective,
            directUrls: extractUrls(input.sourceText),
            required: WEB_URGENT_PATTERN.test(input.sourceText),
            status: 'pending',
        });
    }
    return queries;
}
export function analyzeWorkRequest(input: {
    sourceText: string;
    workspacePath: string;
    followUpContext?: WorkRequestFollowUpContext;
    now?: Date;
    environmentContext?: PlatformRuntimeContext;
    forcedRouteMode?: ForcedRouteMode | null;
}): NormalizedWorkRequest {
    const routedInput = parseRoutedInput(input.sourceText);
    const baseSourceText = routedInput.cleanText.trim().length > 0
        ? routedInput.cleanText
        : input.sourceText;
    const sourceText = maybeInjectFollowUpContext({
        sourceText: baseSourceText,
        followUpContext: input.followUpContext,
    });
    const scheduledIntent = detectScheduledIntent(sourceText, input.now);
    const publishIntent = inferPublishIntent(sourceText);
    const forcedRouteMode = input.forcedRouteMode ?? routedInput.forcedRouteMode;
    const mode = resolveMode({
        text: sourceText,
        scheduledIntent,
        forcedRouteMode,
    });
    const tasks = scheduledIntent
        ? buildTasksFromScheduledIntent({ scheduledIntent, mode, publishIntent })
        : [buildTask({ objective: sourceText, mode, publishIntent })];
    const signals = collectSignals(sourceText);
    const clarification = buildClarification(sourceText);
    const deliverables = buildDeliverables(sourceText, input.workspacePath, signals);
    const hitlPolicy = buildHitlPolicy({
        clarification,
        publishIntent,
        hostAccessRequired: false,
        signals,
    });
    const executionProfile = buildExecutionProfile({
        mode,
        clarification,
        deliverables,
        hitlPolicy,
        publishIntent,
        hasManualAction: signals.manualAction,
        hasBlockingManualAction: signals.manualAction && !CHAT_PATTERN.test(sourceText),
        requiresBrowserSkill: signals.browser,
        explicitAuthRequired: signals.auth,
        hostAccessRequired: false,
        hasPreferredWorkflow: false,
        isComplexTask: tasks.length > 1 || signals.parallel || signals.chain,
        codeChangeTask: signals.code,
        selfManagementTask: signals.selfManagement,
    });
    const checkpoints = buildCheckpoints({ clarification, hitlPolicy, publishIntent });
    const userActionsRequired = buildUserActions({ clarification, checkpoints, signals });
    const seedEvidence: ResearchEvidence = {
        id: randomUUID(),
        kind: 'context_research',
        source: 'conversation',
        summary: `Seeded from user request: ${sourceText.slice(0, 180)}`,
        confidence: 0.72,
        collectedAt: new Date().toISOString(),
    };
    const primaryTask = tasks[0];
    const researchQueries = buildResearchQueries({
        sourceText,
        mode,
        primaryTitle: primaryTask?.title ?? 'Task',
        primaryObjective: primaryTask?.objective ?? sourceText,
        signals,
    });
    const intentRouting: NormalizedWorkRequest['intentRouting'] = {
        intent: mode === 'scheduled_multi_task' ? 'scheduled_task' : mode,
        confidence: scheduledIntent ? 0.95 : mode === 'chat' ? 0.75 : 0.85,
        reasonCodes: dedupe([
            scheduledIntent ? 'scheduled_intent_detected' : '',
            forcedRouteMode ? `forced_route_${forcedRouteMode}` : '',
            clarification.required ? 'clarification_required' : 'clarification_not_required',
        ]),
        needsDisambiguation: clarification.required,
        forcedByUserSelection: Boolean(forcedRouteMode),
    };
    return {
        schemaVersion: 1,
        mode,
        intentRouting,
        taskDraftRequired: clarification.required,
        sourceText,
        workspacePath: input.workspacePath,
        environmentContext: input.environmentContext,
        schedule: scheduledIntent ? buildSchedule(scheduledIntent, tasks) : undefined,
        tasks,
        clarification,
        presentation: buildPresentation(sourceText, scheduledIntent?.speakResult ?? false, signals),
        deliverables,
        checkpoints,
        userActionsRequired,
        executionProfile,
        publishIntent,
        hitlPolicy,
        missingInfo: clarification.missingFields.map((field, index) => ({
            field,
            reason: clarification.reason ?? `Missing required field: ${field}`,
            blocking: clarification.required,
            question: clarification.questions[index],
        })),
        researchQueries,
        researchEvidence: [seedEvidence],
        uncertaintyRegistry: clarification.required
            ? [{
                id: randomUUID(),
                topic: 'clarification_required',
                status: 'blocking_unknown',
                statement: clarification.reason ?? 'Clarification is required.',
                whyItMatters: 'Execution should not continue until missing details are provided.',
                question: clarification.questions[0],
                supportingEvidenceIds: [seedEvidence.id],
            }]
            : [],
        knownRisks: dedupe([
            ...hitlPolicy.reasons,
            ...executionProfile.reasons,
            clarification.required ? 'Clarification required before execution.' : '',
        ]),
        replanPolicy: {
            allowReturnToResearch: true,
            triggers: [
                'new_scope_signal',
                'missing_resource',
                'permission_block',
                'contradictory_evidence',
                'execution_infeasible',
            ],
        },
        createdAt: new Date().toISOString(),
    };
}
export function freezeWorkRequest(request: NormalizedWorkRequest): FrozenWorkRequest {
    const selectedStrategy = request.strategyOptions?.find((item) => item.id === request.selectedStrategyId);
    const sourcesChecked = dedupe((request.researchEvidence ?? []).map((item) => item.source));
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
    const hasBlockingUnknowns = (request.uncertaintyRegistry ?? []).some((item) => item.status === 'blocking_unknown');
    const nextStatus: ExecutionPlan['steps'][number]['status'] = hasBlockingUnknowns ? 'blocked' : 'pending';
    const steps: ExecutionPlan['steps'] = [];
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
    const executionStepByTaskId = new Map<string, string>();
    for (const task of request.tasks) executionStepByTaskId.set(task.id, randomUUID());
    for (const task of request.tasks) {
        const stepId = executionStepByTaskId.get(task.id)!;
        const dependencySteps = task.dependencies
            .map((dependency) => executionStepByTaskId.get(dependency))
            .filter((value): value is string => Boolean(value));
        steps.push({
            stepId,
            taskId: task.id,
            kind: 'execution',
            title: task.title,
            description: task.objective,
            status: nextStatus,
            dependencies: [freezeStepId, ...dependencySteps],
        });
    }
    const reductionStepId = randomUUID();
    steps.push({
        stepId: reductionStepId,
        kind: 'reduction',
        title: 'Reduce execution output',
        description: 'Condense execution output into final response payload.',
        status: nextStatus,
        dependencies: steps.filter((step) => step.kind === 'execution').map((step) => step.stepId),
    });
    steps.push({
        stepId: randomUUID(),
        kind: 'presentation',
        title: 'Present final result',
        description: 'Present final output to user.',
        status: nextStatus,
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
            const lines = [task.objective];
            if (task.constraints.length > 0) lines.push(`Constraints: ${task.constraints.join('; ')}`);
            if (task.acceptanceCriteria.length > 0) lines.push(`Acceptance criteria: ${task.acceptanceCriteria.join('; ')}`);
            if (task.sourceUrls?.length) lines.push(`Reference URLs: ${task.sourceUrls.join('; ')}`);
            if (includeGlobalContracts && (request.deliverables?.length ?? 0) > 0) {
                lines.push(`Deliverables: ${request.deliverables!.map((d) => (d.path ? `${d.title} (${d.path})` : d.title)).join('; ')}`);
            }
            if (includeGlobalContracts && (request.checkpoints?.length ?? 0) > 0) {
                lines.push(`Checkpoints: ${request.checkpoints!.map((checkpoint) => checkpoint.title).join('; ')}`);
            }
            return lines.join('\n');
        })
        .join('\n\n');
}
