import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    type ExecutionPlan,
    type ClarificationDecision,
    type CheckpointContract,
    type DefaultingPolicy,
    type DeliverableContract,
    type FrozenWorkRequest,
    type HitlExecutionPolicy,
    type GoalFrame,
    type HitlPolicy,
    type MissingInfoItem,
    type MemoryIsolationPolicy,
    type NormalizedWorkRequest,
    type PresentationPayload,
    type PresentationContract,
    type ReplanPolicy,
    type ResearchEvidence,
    type ResearchQuery,
    type ResumeStrategy,
    type RuntimeIsolationPolicy,
    type SessionIsolationPolicy,
    type StrategyOption,
    type TaskDefinition,
    type TenantIsolationPolicy,
    type UncertaintyItem,
    type UserActionRequest,
} from './workRequestSchema';
import { detectScheduledIntent, type ParsedScheduledIntent } from '../scheduling/scheduledTasks';
import { cleanScheduledTaskResultText, normalizeScheduledTaskResultText } from '../scheduling/scheduledTaskPresentation';
import { analyzeLocalTaskIntent } from './localTaskIntent';
import type { SystemFolderResolutionOptions } from '../system/wellKnownFolders';

function detectLanguage(text: string): string {
    return /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en';
}

function isPriceSensitiveInvestmentTask(text: string): boolean {
    return /(买入价|买入价格|买入区间|建仓价|建仓区间|入场价|买点|目标价|target price|entry price|buy price|buy range|entry range|price range|at what price)/i
        .test(text);
}

function languageAwareQuestions(language: string): string[] {
    return language.startsWith('zh')
        ? ['请明确你要我继续处理的具体对象、文件、页面或任务目标。']
        : ['Please specify the exact object, file, page, or task you want me to continue with.'];
}

function isComplexPlanningTask(text: string, mode: NormalizedWorkRequest['mode']): boolean {
    if (mode === 'scheduled_task' || mode === 'scheduled_multi_task') {
        if (text.length > 180) {
            return true;
        }
        return /(计划|规划|拆分|分解|设计|方案|架构|多步|workflow|multi-step|plan|break down|decompose|best practice|调研|research|analysis)/i
            .test(text);
    }

    if (text.length > 120) {
        return true;
    }

    return /(计划|规划|拆分|分解|设计|方案|架构|实现|多步|multi-step|plan|break down|decompose|workflow|research)/i.test(text);
}

function normalizeOutputSlug(text: string): string {
    const normalized = text
        .toLowerCase()
        .replace(/[\u4e00-\u9fff]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const clipped = normalized.slice(0, 96).replace(/-+$/g, '');
    return clipped || 'task-output';
}

function inferUiFormat(text: string): PresentationContract['uiFormat'] {
    if (/(ppt|slides|deck|演示|幻灯片|汇报)/i.test(text)) {
        return 'artifact';
    }
    if (/(报告|report|总结|summary|分析|analysis|方案)/i.test(text)) {
        return 'report';
    }
    if (/(表格|table|清单|list)/i.test(text)) {
        return 'table';
    }
    return 'chat_message';
}

function inferArtifactDirectory(text: string): string {
    if (/(报告|report|总结|summary|分析|analysis|方案)/i.test(text)) {
        return 'reports';
    }
    return 'artifacts';
}

const EXPLICIT_OUTPUT_PATH_PATTERNS: RegExp[] = [
    /(?:保存到|写入到|写到|输出到|导出到|导出为|生成到)\s*[:："]?\s*([A-Za-z0-9_./~:\\\-\u4e00-\u9fa5]+\.[A-Za-z0-9]+)/ig,
    /(?:save(?: it)? to|write(?: it)? to|output(?: it)? to|export(?: it)? to|export as)\s*[:"]?\s*([A-Za-z0-9_./~:\\\-\u4e00-\u9fa5]+\.[A-Za-z0-9]+)/ig,
];

function sanitizeExplicitOutputPath(value: string): string {
    return value
        .trim()
        .replace(/^['"]+|['"]+$/g, '')
        .replace(/[，。；;,]+$/g, '');
}

function extractExplicitOutputTargetPath(text: string): string | null {
    let matchedPath: string | null = null;
    for (const pattern of EXPLICIT_OUTPUT_PATH_PATTERNS) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            if (match[1]) {
                matchedPath = sanitizeExplicitOutputPath(match[1]);
            }
        }
    }
    return matchedPath;
}

function inferFormatFromPath(filePath: string): string {
    const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return extension || 'md';
}

function inferArtifactFormat(text: string): string {
    const explicitOutputTargetPath = extractExplicitOutputTargetPath(text);
    if (explicitOutputTargetPath) {
        return inferFormatFromPath(explicitOutputTargetPath);
    }
    if (/(ppt|slides|deck|演示|幻灯片|汇报)/i.test(text)) {
        return 'pptx';
    }
    if (/(json)/i.test(text)) {
        return 'json';
    }
    return 'md';
}

function hasExplicitArtifactOutputIntent(text: string): boolean {
    if (extractExplicitOutputTargetPath(text)) {
        return true;
    }

    if (
        /(?:保存(?:到|为)?|写入(?:到)?|写到|输出到|导出(?:到|为)?|生成(?:到)?|save(?:\s+it)?\s+to|write(?:\s+it)?\s+to|output(?:\s+it)?\s+to|export(?:\s+it)?\s+(?:to|as)|create\s+(?:an?\s+)?(?:file|document))/i
            .test(text)
    ) {
        return true;
    }
    return false;
}

function isCodeChangeTask(text: string): boolean {
    if (/(方案|plan|规划|拆分|设计|architecture|验收标准)/i.test(text) && !/(代码|code|refactor|修复|fix|实现功能|实现代码)/i.test(text)) {
        return false;
    }

    return /(代码|code|refactor|修复|fix|实现功能|实现代码|实现一个.*功能|改这个 bug|修这个 bug)/i.test(text);
}

const SOCIAL_PLATFORM_CUE_PATTERN =
    /(x\.com|twitter|推特|小红书|reddit|facebook|instagram|linkedin|社交平台|在\s*x\s*上|到\s*x\s*上|发布到\s*x\b)/i;
const SOCIAL_PUBLISH_CUE_PATTERN = /(发布|发帖|发文|推文|tweet|post|publish|share)/i;
const BROWSER_UI_CUE_PATTERN =
    /(browser|playwright|网页|网站|页面|点击|填写|登录|timeline|时间线|click|form|navigate|导航)/i;
const EXPLICIT_MANUAL_ACTION_PATTERN =
    /(登录|login|sign in|验证码|2fa|upload|上传|approve|审批|人工操作|手动操作|confirm plan|确认方案|授权)/i;

function isLikelySocialPublishingTask(text: string): boolean {
    return SOCIAL_PLATFORM_CUE_PATTERN.test(text) && SOCIAL_PUBLISH_CUE_PATTERN.test(text);
}

function hasExplicitManualActionSignal(text: string): boolean {
    return EXPLICIT_MANUAL_ACTION_PATTERN.test(text);
}

function requiresExternalAuthOrManualAction(text: string): boolean {
    return hasExplicitManualActionSignal(text)
        || isLikelySocialPublishingTask(text);
}

function buildDefaultingPolicy(input: {
    text: string;
    language: string;
    presentation: PresentationContract;
    hasBlockingManualAction: boolean;
}): DefaultingPolicy {
    return {
        outputLanguage: input.language,
        uiFormat: input.presentation.uiFormat,
        artifactDirectory: inferArtifactDirectory(input.text),
        checkpointStrategy: input.hasBlockingManualAction
            ? 'manual_action'
            : isComplexPlanningTask(input.text, 'immediate_task') || input.presentation.uiFormat !== 'chat_message'
                ? 'review_before_completion'
                : 'none',
    };
}

function hasPlanApprovalCue(text: string): boolean {
    return /(按这个方案继续|按该方案继续|就按这个方案|可以执行了|继续执行|开始执行|go ahead|proceed|approved?|ship it|looks good,? continue)/i
        .test(text);
}

function buildHitlPolicy(input: {
    text: string;
    taskDefinition: TaskDefinition;
    hasManualAction: boolean;
}): HitlPolicy {
    const reasons: string[] = [];
    let riskTier: HitlPolicy['riskTier'] = 'low';
    const codeChangeTask = isCodeChangeTask(input.text);
    const selfManagementTask = isCoworkanySelfManagementTask(input.text);
    const requiresHostAccessGrant = input.taskDefinition.localPlanHint?.requiresHostAccessGrant === true;
    const hostAccessOperations = input.taskDefinition.localPlanHint?.requiredAccess ?? [];
    const hostAccessReadOnly = requiresHostAccessGrant
        && hostAccessOperations.length > 0
        && hostAccessOperations.every((operation) => operation === 'read');

    if (input.hasManualAction) {
        reasons.push('Execution depends on a manual or authentication-gated step.');
        riskTier = 'high';
    }

    if (requiresHostAccessGrant) {
        reasons.push('Execution needs host-folder access outside the workspace sandbox.');
        riskTier = 'high';
    }

    if (codeChangeTask) {
        reasons.push('Execution is expected to modify code or workspace state.');
        riskTier = 'high';
    }

    if (selfManagementTask) {
        reasons.push('Execution changes Coworkany-managed configuration or extensions.');
        riskTier = 'high';
    }

    if (riskTier === 'low' && requiresBrowserAutomationSkill(input.text)) {
        reasons.push('Execution likely involves browser navigation or UI interaction.');
        riskTier = 'medium';
    }

    const hostAccessOnlyReview =
        hostAccessReadOnly &&
        !input.hasManualAction &&
        !codeChangeTask &&
        !selfManagementTask;

    const requiresPlanConfirmation = !hostAccessOnlyReview
        && riskTier !== 'low'
        && !hasPlanApprovalCue(input.text);

    return {
        riskTier,
        requiresPlanConfirmation,
        reasons,
    };
}

const HITL_RISK_SCORE: Record<HitlPolicy['riskTier'], number> = {
    low: 0,
    medium: 1,
    high: 2,
};

function mergeHitlPolicies(policies: HitlPolicy[]): HitlPolicy {
    if (policies.length === 0) {
        return {
            riskTier: 'low',
            requiresPlanConfirmation: false,
            reasons: [],
        };
    }

    let selected = policies[0]!;
    for (const policy of policies.slice(1)) {
        if (HITL_RISK_SCORE[policy.riskTier] > HITL_RISK_SCORE[selected.riskTier]) {
            selected = policy;
        }
    }

    return {
        riskTier: selected.riskTier,
        requiresPlanConfirmation: policies.some((policy) => policy.requiresPlanConfirmation),
        reasons: Array.from(new Set(policies.flatMap((policy) => policy.reasons))),
    };
}

function dedupePaths(paths: Array<string | undefined>): string[] {
    return Array.from(new Set(paths.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function buildRuntimeIsolationPolicy(input: {
    workspacePath: string;
    text: string;
    taskDefinition: TaskDefinition;
    goalFrame: GoalFrame;
}): RuntimeIsolationPolicy {
    const resolvedTargets = (input.taskDefinition.resolvedTargets ?? []).map((target) => target.resolvedPath);
    const includesExternalTargets = resolvedTargets.some((target) => !target.startsWith(input.workspacePath));
    const allowedWorkspacePaths = dedupePaths([
        input.workspacePath,
        ...resolvedTargets,
    ]);

    const writableWorkspacePaths = input.taskDefinition.localPlanHint?.requiredAccess?.some((access) =>
        access === 'write' || access === 'move' || access === 'delete'
    ) || isCodeChangeTask(input.text)
        ? allowedWorkspacePaths
        : [input.workspacePath];

    const notes = [
        'Connector/toolpack access is denied by default unless explicitly enabled for the task session.',
    ];

    if (includesExternalTargets) {
        notes.push('Filesystem access is restricted to the workspace plus the explicitly resolved host targets in the frozen contract.');
    } else {
        notes.push('Filesystem access is restricted to the current workspace by default.');
    }

    if (input.goalFrame.taskCategory === 'research' || input.goalFrame.taskCategory === 'browser' || input.goalFrame.taskCategory === 'mixed') {
        notes.push('External network connectors require explicit domain allowlisting before MCP toolpacks can reach them.');
    }

    return {
        connectorIsolationMode: 'deny_by_default',
        filesystemMode: includesExternalTargets ? 'workspace_plus_resolved_targets' : 'workspace_only',
        allowedWorkspacePaths,
        writableWorkspacePaths,
        networkAccess:
            input.goalFrame.taskCategory === 'research' || input.goalFrame.taskCategory === 'browser' || input.goalFrame.taskCategory === 'mixed'
                ? 'restricted'
                : 'none',
        allowedDomains: [],
        notes,
    };
}

function isPreferencePersistenceTask(text: string): boolean {
    return /\b(preference|prefer|default setting|remember that i|save.*preference)\b|偏好|喜欢|默认设置|记住我/i.test(text);
}

function isWorkspaceMemoryTask(goalFrame: GoalFrame): boolean {
    return goalFrame.taskCategory === 'workspace'
        || goalFrame.taskCategory === 'coding'
        || goalFrame.taskCategory === 'research'
        || goalFrame.taskCategory === 'mixed';
}

function buildSessionIsolationPolicy(): SessionIsolationPolicy {
    return {
        workspaceBindingMode: 'frozen_workspace_only',
        followUpScope: 'same_task_only',
        allowWorkspaceOverride: false,
        supersededContractHandling: 'tombstone_prior_contracts',
        staleEvidenceHandling: 'evict_on_refreeze',
        notes: [
            'Follow-up and resume execution stay bound to the original task session.',
            'Workspace overrides are denied once the task session is frozen.',
            'Superseded frozen contracts are retained only as tombstones and must not drive new execution.',
        ],
    };
}

function buildMemoryIsolationPolicy(input: {
    text: string;
    goalFrame: GoalFrame;
}): MemoryIsolationPolicy {
    const readScopes: MemoryIsolationPolicy['readScopes'] = ['task', 'user_preference'];
    if (isWorkspaceMemoryTask(input.goalFrame)) {
        readScopes.push('workspace');
    }
    if (input.goalFrame.taskCategory === 'app_management') {
        readScopes.push('system');
    }

    const writeScopes: MemoryIsolationPolicy['writeScopes'] = ['task'];
    if (isWorkspaceMemoryTask(input.goalFrame)) {
        writeScopes.push('workspace');
    }
    if (isPreferencePersistenceTask(input.text)) {
        writeScopes.push('user_preference');
    }

    const defaultWriteScope: MemoryIsolationPolicy['defaultWriteScope'] = isPreferencePersistenceTask(input.text)
        ? 'user_preference'
        : isWorkspaceMemoryTask(input.goalFrame)
            ? 'workspace'
            : 'task';

    return {
        classificationMode: 'scope_tagged',
        readScopes: Array.from(new Set(readScopes)),
        writeScopes: Array.from(new Set(writeScopes)),
        defaultWriteScope,
        notes: [
            'Memory reads and writes must be tagged by scope before they can enter long-term storage or prompt context.',
            'Task memory is ephemeral to the current task session; workspace memory is limited to the current workspace tenant.',
            'User-preference memory is reserved for explicit preference capture and must stay bound to the current local user.',
        ],
    };
}

function buildTenantIsolationPolicy(): TenantIsolationPolicy {
    return {
        workspaceBoundaryMode: 'same_workspace_only',
        userBoundaryMode: 'current_local_user_only',
        allowCrossWorkspaceMemory: false,
        allowCrossWorkspaceFollowUp: false,
        allowCrossUserMemory: false,
        notes: [
            'Task continuity is restricted to the same workspace boundary.',
            'Cross-workspace memory recall is denied unless data is explicitly scoped as user preference.',
            'Per-user memory and session state stay bound to the current local user.',
        ],
    };
}

function buildMissingInfo(clarification: ClarificationDecision): MissingInfoItem[] {
    return clarification.missingFields.map((field, index) => ({
        field,
        reason: clarification.reason || 'Additional information is required before safe execution.',
        blocking: clarification.required,
        question: clarification.questions[index] || clarification.questions[0],
    }));
}

function buildDeliverables(input: {
    text: string;
    workspacePath: string;
    presentation: PresentationContract;
    localPlanWorkflow?: string;
    localPlanRequiresHostAccess?: boolean;
}): DeliverableContract[] {
    const deliverables: DeliverableContract[] = [];
    const slug = normalizeOutputSlug(input.text);
    const artifactDir = inferArtifactDirectory(input.text);
    const explicitOutputTargetPath = extractExplicitOutputTargetPath(input.text);
    const explicitArtifactOutputIntent = hasExplicitArtifactOutputIntent(input.text);

    if (
        input.localPlanWorkflow &&
        /(organize|deduplicate|delete)/i.test(input.localPlanWorkflow) &&
        /downloads|host-folder|explicit-path/i.test(input.localPlanWorkflow) &&
        input.localPlanRequiresHostAccess
    ) {
        deliverables.push({
            id: randomUUID(),
            title: 'Workspace changes applied',
            type: 'workspace_change',
            description: 'Apply the planned workspace/file-system changes and summarize what changed.',
            required: true,
        });
    }

    if (isCodeChangeTask(input.text)) {
        deliverables.push({
            id: randomUUID(),
            title: 'Code changes',
            type: 'code_change',
            description: 'Produce the required code changes and explain the outcome against the acceptance criteria.',
            required: true,
        });
    }

    if (explicitOutputTargetPath) {
        const format = inferFormatFromPath(explicitOutputTargetPath);
        const type = format === 'md' ? 'report_file' : 'artifact_file';
        deliverables.push({
            id: randomUUID(),
            title: 'Explicit output artifact',
            type,
            description: 'Create the requested output and save it to the explicit path provided by the user.',
            required: true,
            path: explicitOutputTargetPath,
            format,
        });
    } else if (explicitArtifactOutputIntent) {
        const format = inferArtifactFormat(input.text);
        const type = format === 'md' ? 'report_file' : 'artifact_file';
        deliverables.push({
            id: randomUUID(),
            title: format === 'pptx' ? 'Presentation artifact' : 'Planned output artifact',
            type,
            description: 'Create a concrete output artifact and save it into the workspace.',
            required: true,
            path: `${artifactDir}/${slug}.${format}`,
            format,
        });
    }

    if (
        deliverables.length === 0 &&
        isComplexPlanningTask(input.text, 'immediate_task') &&
        !isCodeChangeTask(input.text)
    ) {
        deliverables.push({
            id: randomUUID(),
            title: 'Planned execution report',
            type: 'report_file',
            description: 'Produce a structured execution report or plan and save it into the workspace.',
            required: false,
            path: `${artifactDir}/${slug}.md`,
            format: 'md',
        });
    }

    if (deliverables.length === 0) {
        deliverables.push({
            id: randomUUID(),
            title: 'Final response',
            type: 'chat_reply',
            description: 'Return a final user-facing result that addresses the task objective.',
            required: true,
            format: input.presentation.uiFormat,
        });
    }

    return deliverables;
}

function buildCheckpoints(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    deliverables: DeliverableContract[];
    hasManualAction: boolean;
    hasBlockingManualAction: boolean;
    hitlPolicy: HitlPolicy;
    clarification: ClarificationDecision;
}): CheckpointContract[] {
    const checkpoints: CheckpointContract[] = [];

    const toBlocking = (policy: HitlExecutionPolicy): boolean =>
        policy === 'review_required' || policy === 'hard_block';

    if (input.hitlPolicy.requiresPlanConfirmation && !input.clarification.required) {
        const executionPolicy: HitlExecutionPolicy = 'review_required';
        checkpoints.push({
            id: randomUUID(),
            title: 'Review execution plan',
            kind: 'review',
            reason: `Execution risk tier is ${input.hitlPolicy.riskTier} and requires explicit user approval before continuing.`,
            userMessage: 'Review the planned execution and wait for the user to confirm before starting execution.',
            riskTier: input.hitlPolicy.riskTier,
            executionPolicy,
            requiresUserConfirmation: true,
            blocking: toBlocking(executionPolicy),
        });
    }

    if (input.hasManualAction) {
        const executionPolicy: HitlExecutionPolicy = input.hasBlockingManualAction ? 'hard_block' : 'auto';
        checkpoints.push({
            id: randomUUID(),
            title: 'User action required',
            kind: 'manual_action',
            reason: input.hasBlockingManualAction
                ? 'Execution depends on a manual step the user must complete.'
                : 'Execution likely needs user-side preparation before the downstream stage.',
            userMessage: input.hasBlockingManualAction
                ? 'Pause and ask the user to complete the required manual action before continuing.'
                : 'Ask the user to prepare any required account/auth state before the downstream stage starts.',
            riskTier: 'high',
            executionPolicy,
            requiresUserConfirmation: true,
            blocking: toBlocking(executionPolicy),
        });
    }

    if (
        isComplexPlanningTask(input.text, input.mode) ||
        input.deliverables.some((deliverable) => deliverable.type === 'report_file' || deliverable.type === 'artifact_file')
    ) {
        const executionPolicy: HitlExecutionPolicy = 'auto';
        checkpoints.push({
            id: randomUUID(),
            title: 'Checkpoint before final delivery',
            kind: 'pre_delivery',
            reason: 'Summarize progress and verify the planned deliverables before final handoff.',
            userMessage: 'Provide a checkpoint summary before final delivery and request input only if a blocker or decision remains.',
            riskTier: 'low',
            executionPolicy,
            requiresUserConfirmation: false,
            blocking: toBlocking(executionPolicy),
        });
    }

    return checkpoints;
}

function buildUserActionsRequired(input: {
    clarification: ClarificationDecision;
    missingInfo: MissingInfoItem[];
    checkpoints: CheckpointContract[];
    hasManualAction: boolean;
    hasBlockingManualAction: boolean;
    hitlPolicy: HitlPolicy;
    sourceText: string;
}): UserActionRequest[] {
    const actions: UserActionRequest[] = [];

    const toBlocking = (policy: HitlExecutionPolicy): boolean =>
        policy === 'review_required' || policy === 'hard_block';

    if (input.clarification.required) {
        const executionPolicy: HitlExecutionPolicy = 'hard_block';
        actions.push({
            id: randomUUID(),
            title: 'Provide missing task details',
            kind: 'clarify_input',
            description: input.clarification.reason || 'Coworkany needs more information before it can safely execute the task.',
            riskTier: 'high',
            executionPolicy,
            blocking: toBlocking(executionPolicy),
            questions: input.clarification.questions,
            instructions: input.missingInfo.map((item) => item.field),
        });
    }

    if (input.hitlPolicy.requiresPlanConfirmation && !input.clarification.required) {
        const reviewCheckpoint = input.checkpoints.find((checkpoint) => checkpoint.kind === 'review');
        const executionPolicy: HitlExecutionPolicy = 'review_required';
        actions.push({
            id: randomUUID(),
            title: 'Confirm the execution plan',
            kind: 'confirm_plan',
            description: `This ${input.hitlPolicy.riskTier}-risk task needs explicit approval before Coworkany starts execution.`,
            riskTier: input.hitlPolicy.riskTier,
            executionPolicy,
            blocking: toBlocking(executionPolicy),
            questions: [
                'Confirm whether Coworkany should proceed with the current execution plan.',
            ],
            instructions: [
                'Reply with approval to continue, or provide changes that should be applied before execution starts.',
            ],
            fulfillsCheckpointId: reviewCheckpoint?.id,
        });
    }

    if (input.hasManualAction) {
        const manualCheckpoint = input.checkpoints.find((checkpoint) => checkpoint.kind === 'manual_action');
        const executionPolicy: HitlExecutionPolicy = input.hasBlockingManualAction ? 'hard_block' : 'auto';
        const likelyExternalAuth =
            hasExplicitManualActionSignal(input.sourceText) ||
            isLikelySocialPublishingTask(input.sourceText);
        actions.push({
            id: randomUUID(),
            title: 'Complete required manual action',
            kind: likelyExternalAuth ? 'external_auth' : 'manual_step',
            description: input.hasBlockingManualAction
                ? 'A manual or external step is required before Coworkany can continue the task.'
                : 'A downstream stage likely depends on external auth/account preparation. Please prepare it in advance.',
            riskTier: 'high',
            executionPolicy,
            blocking: toBlocking(executionPolicy),
            questions: [],
            instructions: input.hasBlockingManualAction
                ? ['Complete the manual step in the UI or external system, then resume the task.']
                : ['Prepare the required account/auth state before the downstream stage starts.'],
            fulfillsCheckpointId: manualCheckpoint?.id,
        });
    }

    return actions;
}

function buildResumeStrategy(): ResumeStrategy {
    return {
        mode: 'continue_from_saved_context',
        preserveDeliverables: true,
        preserveCompletedSteps: true,
        preserveArtifacts: true,
    };
}

function detectTaskCategory(input: {
    text: string;
    taskDefinition: TaskDefinition;
}): GoalFrame['taskCategory'] {
    const { text, taskDefinition } = input;

    if (taskDefinition.localPlanHint) {
        return 'workspace';
    }
    if (isCodeChangeTask(text)) {
        return 'coding';
    }
    if (/(browser|playwright|网页|网站|页面|登录|timeline|时间线)/i.test(text)) {
        return 'browser';
    }
    if (isCoworkanySelfManagementTask(text)) {
        return 'app_management';
    }
    if (/(研究|research|调研|分析|best practice|最佳实践|方案)/i.test(text)) {
        return 'research';
    }
    if (/(以及|and|同时|across|multi)/i.test(text)) {
        return 'mixed';
    }
    return 'mixed';
}

function extractPreferences(text: string): string[] {
    const preferences: string[] = [];

    if (/(最优|optimal|best practice|最佳实践)/i.test(text)) {
        preferences.push('Prefer best-practice or high-quality approaches.');
    }
    if (/(简洁|concise|简明)/i.test(text)) {
        preferences.push('Prefer concise output.');
    }
    if (/(详细|深入|deep|深度)/i.test(text)) {
        preferences.push('Prefer deeper analysis when useful.');
    }
    if (/(中文|zh|汉语)/i.test(text)) {
        preferences.push('Prefer Chinese output.');
    }

    return preferences;
}

function buildContextSignals(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    taskDefinition: TaskDefinition;
}): string[] {
    const signals = new Set<string>([`mode:${input.mode}`]);

    if (/(当前项目|当前仓库|现有流程|workspace|repo|repository|代码库)/i.test(input.text)) {
        signals.add('references_current_project');
    }
    if (/(继续|resume|follow-up|接着|刚才|上面的)/i.test(input.text)) {
        signals.add('references_existing_conversation');
    }
    if (input.taskDefinition.localPlanHint?.targetFolder) {
        signals.add(`resolved_target:${input.taskDefinition.localPlanHint.targetFolder.resolvedPath}`);
    }
    if (input.taskDefinition.preferredWorkflow) {
        signals.add(`workflow:${input.taskDefinition.preferredWorkflow}`);
    }

    return Array.from(signals);
}

function buildGoalFrame(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    taskDefinition: TaskDefinition;
    deliverables: DeliverableContract[];
}): GoalFrame {
    return {
        objective: input.taskDefinition.objective,
        constraints: input.taskDefinition.constraints,
        preferences: extractPreferences(input.text),
        contextSignals: buildContextSignals(input),
        successHypothesis: input.deliverables.map((deliverable) => deliverable.description),
        taskCategory: detectTaskCategory({
            text: input.text,
            taskDefinition: input.taskDefinition,
        }),
    };
}

function appendResearchQuery(
    queries: ResearchQuery[],
    seen: Set<string>,
    query: Omit<ResearchQuery, 'id'>
): void {
    const key = `${query.kind}:${query.source}:${query.objective}`;
    if (seen.has(key)) {
        return;
    }
    seen.add(key);
    queries.push({
        id: randomUUID(),
        ...query,
    });
}

function buildResearchQueries(input: {
    text: string;
    mode: NormalizedWorkRequest['mode'];
    taskDefinition: TaskDefinition;
    hasManualAction: boolean;
}): ResearchQuery[] {
    const queries: ResearchQuery[] = [];
    const seen = new Set<string>();
    const normalizedText = input.text.trim();

    if (/(当前项目|当前仓库|现有流程|workspace|repo|repository|代码库)/i.test(normalizedText)) {
        appendResearchQuery(queries, seen, {
            kind: 'context_research',
            source: 'workspace',
            objective: 'Inspect the current project state, existing flows, and relevant local files.',
            required: true,
            status: 'pending',
        });
    }

    if (/(继续|resume|follow-up|接着|刚才|上面的|上述|前述)/i.test(normalizedText)) {
        appendResearchQuery(queries, seen, {
            kind: 'context_research',
            source: 'conversation',
            objective: 'Review prior conversation context before finalizing execution.',
            required: true,
            status: 'pending',
        });
        appendResearchQuery(queries, seen, {
            kind: 'context_research',
            source: 'memory',
            objective: 'Check prior saved task context or templates related to this follow-up.',
            required: false,
            status: 'pending',
        });
    }

    if (isComplexPlanningTask(normalizedText, input.mode) || /(最佳实践|best practice|调研|research|架构|方案|设计)/i.test(normalizedText)) {
        appendResearchQuery(queries, seen, {
            kind: 'domain_research',
            source: 'web',
            objective: 'Research relevant best practices and current domain approaches before freezing the contract.',
            required: true,
            status: 'pending',
        });
        appendResearchQuery(queries, seen, {
            kind: 'context_research',
            source: 'template',
            objective: 'Look for similar historical tasks or templates to bootstrap the contract.',
            required: false,
            status: 'pending',
        });
    }

    if (isPriceSensitiveInvestmentTask(normalizedText)) {
        appendResearchQuery(queries, seen, {
            kind: 'domain_research',
            source: 'web',
            objective: 'Fetch the latest market price snapshot (price, currency, timestamp, and market session context) for the target before issuing buy-price guidance.',
            required: true,
            status: 'pending',
        });
    }

    if (input.taskDefinition.localPlanHint) {
        appendResearchQuery(queries, seen, {
            kind: 'feasibility_research',
            source: 'workspace',
            objective: 'Validate that the planned local workflow can run with the current workspace and folder resolution.',
            required: true,
            status: 'pending',
        });
    }

    if (input.hasManualAction) {
        appendResearchQuery(queries, seen, {
            kind: 'feasibility_research',
            source: 'connected_app',
            objective: 'Verify auth state, manual prerequisites, and tool feasibility before execution.',
            required: true,
            status: 'pending',
        });
    }

    if (queries.length === 0 && input.mode === 'immediate_task') {
        appendResearchQuery(queries, seen, {
            kind: 'context_research',
            source: 'conversation',
            objective: 'Confirm the normalized user objective against the current conversation context.',
            required: false,
            status: 'pending',
        });
    }

    return queries;
}

function buildResearchEvidence(input: {
    sourceText: string;
    taskDefinition: TaskDefinition;
    deliverables: DeliverableContract[];
    defaultingPolicy: DefaultingPolicy;
}): ResearchEvidence[] {
    const collectedAt = new Date().toISOString();
    const evidence: ResearchEvidence[] = [
        {
            id: randomUUID(),
            kind: 'context_research',
            source: 'conversation',
            summary: `Parsed user request "${input.sourceText.slice(0, 120)}" into objective: ${input.taskDefinition.objective}`,
            confidence: 0.98,
            collectedAt,
        },
        {
            id: randomUUID(),
            kind: 'feasibility_research',
            source: 'template',
            summary: `Planned ${input.deliverables.length} deliverable(s) with default UI format ${input.defaultingPolicy.uiFormat}.`,
            confidence: 0.82,
            collectedAt,
        },
    ];

    if (input.taskDefinition.localPlanHint?.targetFolder) {
        evidence.push({
            id: randomUUID(),
            kind: 'feasibility_research',
            source: 'workspace',
            summary: `Resolved target folder to ${input.taskDefinition.localPlanHint.targetFolder.resolvedPath}.`,
            confidence: input.taskDefinition.localPlanHint.targetFolder.confidence ?? 0.9,
            collectedAt,
        });
    }

    return evidence;
}

function buildUncertaintyRegistry(input: {
    clarification: ClarificationDecision;
    taskDefinition: TaskDefinition;
    defaultingPolicy: DefaultingPolicy;
    hasManualAction: boolean;
    evidence: ResearchEvidence[];
}): UncertaintyItem[] {
    const evidenceIds = input.evidence.map((item) => item.id);
    const registry: UncertaintyItem[] = input.clarification.missingFields.map((field, index) => ({
        id: randomUUID(),
        topic: field,
        status: 'blocking_unknown',
        statement: input.clarification.reason || 'Required task detail is still missing.',
        whyItMatters: 'Coworkany cannot safely freeze the execution contract until this is clarified.',
        question: input.clarification.questions[index] || input.clarification.questions[0],
        supportingEvidenceIds: evidenceIds,
    }));

    registry.push({
        id: randomUUID(),
        topic: 'output_language',
        status: 'defaultable',
        statement: `Default output language is ${input.defaultingPolicy.outputLanguage}.`,
        whyItMatters: 'Presentation format should be explicit even when the user does not specify it.',
        defaultValue: input.defaultingPolicy.outputLanguage,
        supportingEvidenceIds: evidenceIds,
    });

    registry.push({
        id: randomUUID(),
        topic: 'ui_format',
        status: 'defaultable',
        statement: `Default UI format is ${input.defaultingPolicy.uiFormat}.`,
        whyItMatters: 'The execution contract should define how results are returned.',
        defaultValue: input.defaultingPolicy.uiFormat,
        supportingEvidenceIds: evidenceIds,
    });

    registry.push({
        id: randomUUID(),
        topic: 'artifact_directory',
        status: 'defaultable',
        statement: `Default artifact directory is ${input.defaultingPolicy.artifactDirectory}.`,
        whyItMatters: 'Artifact-producing tasks need a stable output location.',
        defaultValue: input.defaultingPolicy.artifactDirectory,
        supportingEvidenceIds: evidenceIds,
    });

    if (input.taskDefinition.localPlanHint?.targetFolder) {
        registry.push({
            id: randomUUID(),
            topic: 'execution_target',
            status: 'confirmed',
            statement: `Execution target resolved to ${input.taskDefinition.localPlanHint.targetFolder.resolvedPath}.`,
            whyItMatters: 'The contract should record the resolved target before execution.',
            supportingEvidenceIds: evidenceIds,
        });
    }

    if (input.hasManualAction) {
        registry.push({
            id: randomUUID(),
            topic: 'manual_prerequisite',
            status: 'inferred',
            statement: 'A manual or external-auth step is likely required before Coworkany can continue.',
            whyItMatters: 'Execution may need to pause for user action even when the task scope is understood.',
            supportingEvidenceIds: evidenceIds,
        });
    }

    return registry;
}

function buildStrategyOptions(input: {
    text: string;
    taskDefinition: TaskDefinition;
    deliverables: DeliverableContract[];
    evidence: ResearchEvidence[];
}): { strategyOptions: StrategyOption[]; selectedStrategyId: string } {
    const evidenceIds = input.evidence.map((item) => item.id);
    const strategyOptions: StrategyOption[] = [];

    if (input.taskDefinition.localPlanHint?.preferredWorkflow) {
        const selectedId = randomUUID();
        strategyOptions.push({
            id: selectedId,
            title: 'Deterministic local workflow',
            description: `Use ${input.taskDefinition.localPlanHint.preferredWorkflow} to drive execution with explicit tool choices.`,
            pros: ['Matches the detected filesystem intent.', 'Keeps host-folder execution predictable.'],
            cons: ['May still require host access approval or manual confirmation.'],
            feasibility: 'high',
            supportingEvidenceIds: evidenceIds,
            selected: true,
        });
        strategyOptions.push({
            id: randomUUID(),
            title: 'General-purpose task execution',
            description: 'Let the agent improvise a generic workflow after contract freeze.',
            pros: ['Flexible when the deterministic workflow does not fit.'],
            cons: ['Less predictable and harder to govern.'],
            feasibility: 'medium',
            supportingEvidenceIds: evidenceIds,
            selected: false,
            rejectionReason: 'Deterministic workflow is safer for this local execution task.',
        });
        return { strategyOptions, selectedStrategyId: selectedId };
    }

    if (isCodeChangeTask(input.text)) {
        const selectedId = randomUUID();
        strategyOptions.push({
            id: selectedId,
            title: 'Implement and verify',
            description: 'Inspect the codebase, make the required changes, and verify against acceptance criteria.',
            pros: ['Aligns with code-change deliverables.', 'Builds verification into execution.'],
            cons: ['May take longer than a report-only response.'],
            feasibility: 'high',
            supportingEvidenceIds: evidenceIds,
            selected: true,
        });
        strategyOptions.push({
            id: randomUUID(),
            title: 'Report-only recommendation',
            description: 'Produce an implementation recommendation without changing code.',
            pros: ['Lower execution risk.'],
            cons: ['Does not satisfy the code-change objective.'],
            feasibility: 'medium',
            supportingEvidenceIds: evidenceIds,
            selected: false,
            rejectionReason: 'The requested deliverables include code changes.',
        });
        return { strategyOptions, selectedStrategyId: selectedId };
    }

    if (input.deliverables.some((deliverable) => deliverable.type === 'report_file' || deliverable.type === 'artifact_file')) {
        const selectedId = randomUUID();
        strategyOptions.push({
            id: selectedId,
            title: 'Research-backed artifact delivery',
            description: 'Gather enough domain and project context, then produce the planned artifact.',
            pros: ['Fits report and artifact tasks.', 'Supports explicit checkpoints before delivery.'],
            cons: ['Needs stronger context gathering before execution.'],
            feasibility: 'high',
            supportingEvidenceIds: evidenceIds,
            selected: true,
        });
        strategyOptions.push({
            id: randomUUID(),
            title: 'Chat-only summary',
            description: 'Respond directly in chat without producing a workspace artifact.',
            pros: ['Lower latency.'],
            cons: ['Drops the requested artifact deliverable.'],
            feasibility: 'low',
            supportingEvidenceIds: evidenceIds,
            selected: false,
            rejectionReason: 'The frozen contract already commits to an artifact deliverable.',
        });
        return { strategyOptions, selectedStrategyId: selectedId };
    }

    const selectedId = randomUUID();
    strategyOptions.push({
        id: selectedId,
        title: 'Direct governed execution',
        description: 'Proceed with the minimal governed execution path and return the required result.',
        pros: ['Low overhead.', 'Keeps the task aligned with the existing runtime.'],
        cons: ['Less room for deep research before execution.'],
        feasibility: 'high',
        supportingEvidenceIds: evidenceIds,
        selected: true,
    });
    strategyOptions.push({
        id: randomUUID(),
        title: 'Report-first planning pass',
        description: 'Pause execution and produce a richer planning report before acting.',
        pros: ['More explicit reasoning artifact.'],
        cons: ['Unnecessary for straightforward tasks.'],
        feasibility: 'medium',
        supportingEvidenceIds: evidenceIds,
        selected: false,
        rejectionReason: 'Direct execution is sufficient for the current task shape.',
    });

    return { strategyOptions, selectedStrategyId: selectedId };
}

function buildKnownRisks(input: {
    clarification: ClarificationDecision;
    taskDefinition: TaskDefinition;
    hasManualAction: boolean;
    researchQueries: ResearchQuery[];
}): string[] {
    const risks: string[] = [];

    if (input.clarification.required) {
        risks.push('Blocking task details are still unresolved.');
    }
    if (input.hasManualAction) {
        risks.push('Execution may pause for a manual or authentication-dependent step.');
    }
    if (input.taskDefinition.localPlanHint?.requiresHostAccessGrant) {
        risks.push('Host-folder access approval is required before filesystem changes can proceed.');
    }
    if (input.researchQueries.some((query) => query.kind === 'domain_research')) {
        risks.push('Best-practice assumptions may change after deeper domain research is performed.');
    }

    return risks;
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

function isCoworkanySelfManagementTask(text: string): boolean {
    return /(coworkany|skillhub|clawhub|github:|github\.com|serper key|api key|工作区|workspace|配置|config|技能|skill)/i.test(text)
        && /(安装|install|启用|enable|禁用|disable|删除|remove|卸载|uninstall|查看|inspect|列出|list|配置|config)/i.test(text);
}

function requiresBrowserAutomationSkill(text: string): boolean {
    return BROWSER_UI_CUE_PATTERN.test(text) || isLikelySocialPublishingTask(text);
}

function inferPreferredTools(text: string, baseTools: string[]): string[] {
    const merged = new Set(baseTools);
    if (requiresBrowserAutomationSkill(text)) {
        [
            'browser_connect',
            'browser_navigate',
            'browser_wait',
            'browser_get_content',
            'browser_click',
            'browser_fill',
            'browser_screenshot',
        ].forEach((tool) => merged.add(tool));
    }
    return Array.from(merged);
}

function inferPreferredSkills(text: string, mode: NormalizedWorkRequest['mode']): string[] {
    const skills = ['task-orchestrator'];
    if (isCoworkanySelfManagementTask(text)) {
        skills.push('coworkany-self-management');
    }
    if (requiresBrowserAutomationSkill(text)) {
        skills.push('browser-automation');
    }
    if (isComplexPlanningTask(text, mode)) {
        skills.push('superpowers-workflow', 'planning-with-files');
    }
    return Array.from(new Set(skills));
}

function isLikelyChat(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed) return true;
    return /^(hi|hello|hey|你好|您好|在吗|thanks|thank you|谢谢|收到|ok|好的)[.!?？。!]*$/i.test(trimmed);
}

function buildClarificationDecision(input: {
    sourceText: string;
    executableText: string;
    mode: NormalizedWorkRequest['mode'];
}): ClarificationDecision {
    if (input.mode !== 'immediate_task') {
        return {
            required: false,
            questions: [],
            missingFields: [],
            canDefault: true,
            assumptions: [],
        };
    }

    const trimmed = input.executableText.trim();
    const language = detectLanguage(input.sourceText);
    const ambiguousReference =
        isAmbiguousReferenceRequest(trimmed);
    const tooShortToAct = trimmed.length > 0 && trimmed.length < 8;

    if (ambiguousReference || tooShortToAct) {
        return {
            required: true,
            reason: language.startsWith('zh')
                ? '当前请求缺少明确执行对象。'
                : 'The current request is missing a concrete execution target.',
            questions: languageAwareQuestions(language),
            missingFields: ['task_scope'],
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

function splitSegments(text: string): string[] {
    return text
        .split(/[\n。！？!?]+/)
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function isAmbiguousReferenceRequest(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const ambiguousPatterns = [
        /^(?:继续|接着|按刚才|照上面|continue|resume|follow up|same as above)(?:\s+(?:处理|做|看|handle|work on))?(?:\s+(?:这个|那个|这些|上面的|刚才的|this|that|those|it|them))?[.!?？。!]*$/i,
        /^(?:这个|那个|这些|上面的|刚才的|this|that|those|it|them|same as above)[.!?？。!]*$/i,
        /^(?:继续处理|继续做|continue with|resume with|handle|work on)\s*(?:这个|那个|this|that|it|them)[.!?？。!]*$/i,
    ];

    return ambiguousPatterns.some((pattern) => pattern.test(trimmed));
}

function buildTaskDefinition(
    text: string,
    mode: NormalizedWorkRequest['mode'],
    workspacePath: string,
    systemContext: SystemFolderResolutionOptions = {}
): TaskDefinition {
    const segments = splitSegments(text);
    const objective = (segments[0] || text).trim();
    const constraints = segments.slice(1);
    const acceptanceCriteria = segments.filter((segment) =>
        /(只保留|必须|不要|输出|格式|每篇|唯一标识|summary|summarize|reply only|只回复)/i.test(segment)
    );
    const language = detectLanguage(text);
    if (isPriceSensitiveInvestmentTask(text)) {
        const hasNumericPriceCriterion = acceptanceCriteria.some((criterion) =>
            /(价格|价位|区间|买入|目标价|price|entry|buy)/i.test(criterion)
        );
        if (!hasNumericPriceCriterion) {
            acceptanceCriteria.push(
                language.startsWith('zh')
                    ? '必须给出明确可执行的买入价格数值或价格区间，并标注货币单位。'
                    : 'Provide an explicit buy-price value or buy-price range with currency units.'
            );
        }

        const hasTimeAnchorCriterion = acceptanceCriteria.some((criterion) =>
            /(截至|时间|日期|交易日|盘中|收盘|as of|timestamp|date|session)/i.test(criterion)
        );
        if (!hasTimeAnchorCriterion) {
            acceptanceCriteria.push(
                language.startsWith('zh')
                    ? '必须说明价格依据的时间锚点（例如交易日、时区、盘中或收盘时点）。'
                    : 'Anchor the quoted price to a concrete market timepoint (date/timezone/session).'
            );
        }
    }
    const localTaskPlan = analyzeLocalTaskIntent({
        text,
        workspacePath,
        ...systemContext,
    });

    return {
        id: randomUUID(),
        title: objective.slice(0, 60) || 'Task',
        objective,
        constraints,
        acceptanceCriteria,
        dependencies: [],
        preferredSkills: inferPreferredSkills(text, mode),
        preferredTools: inferPreferredTools(text, localTaskPlan?.preferredTools ?? []),
        preferredWorkflow: localTaskPlan?.preferredWorkflow,
        resolvedTargets: localTaskPlan?.targetFolder ? [localTaskPlan.targetFolder] : undefined,
        localPlanHint: localTaskPlan,
    };
}

function buildScheduledTaskDefinitions(input: {
    scheduledIntent: ParsedScheduledIntent;
    mode: NormalizedWorkRequest['mode'];
    workspacePath: string;
    systemContext?: SystemFolderResolutionOptions;
}): TaskDefinition[] {
    const primaryTask = buildTaskDefinition(
        input.scheduledIntent.taskQuery,
        input.mode,
        input.workspacePath,
        input.systemContext,
    );
    const chainedStages = input.scheduledIntent.chainedStages ?? [];
    if (chainedStages.length === 0) {
        return [primaryTask];
    }

    const tasks: TaskDefinition[] = [primaryTask];
    let previousTask = primaryTask;

    for (const stage of chainedStages) {
        const stageTask = buildTaskDefinition(
            stage.taskQuery,
            input.mode,
            input.workspacePath,
            input.systemContext,
        );
        stageTask.dependencies = [previousTask.id];
        tasks.push(stageTask);
        previousTask = stageTask;
    }

    return tasks;
}

function buildScheduledStages(input: {
    scheduledIntent: ParsedScheduledIntent;
    tasks: TaskDefinition[];
}): NonNullable<NonNullable<NormalizedWorkRequest['schedule']>['stages']> {
    if (input.tasks.length === 0) {
        return [];
    }

    const chainedStages = input.scheduledIntent.chainedStages ?? [];
    let executeAtMs = input.scheduledIntent.executeAt.getTime();

    return input.tasks.map((task, index) => {
        if (index > 0) {
            const chainedStage = chainedStages[index - 1];
            executeAtMs += chainedStage?.delayMsFromPrevious ?? 0;
            return {
                taskId: task.id,
                executeAt: new Date(executeAtMs).toISOString(),
                delayMsFromPrevious: chainedStage?.delayMsFromPrevious,
                originalTimeExpression: chainedStage?.originalTimeExpression,
            };
        }
        return {
            taskId: task.id,
            executeAt: new Date(executeAtMs).toISOString(),
            originalTimeExpression: input.scheduledIntent.originalTimeExpression,
        };
    });
}

function buildPresentationContract(text: string, ttsEnabled: boolean): PresentationContract {
    return {
        uiFormat: inferUiFormat(text),
        ttsEnabled,
        ttsMode: 'full',
        ttsMaxChars: 0,
        language: detectLanguage(text),
    };
}

export function analyzeWorkRequest(input: {
    sourceText: string;
    workspacePath: string;
    now?: Date;
    systemContext?: SystemFolderResolutionOptions;
}): NormalizedWorkRequest {
    const sourceText = input.sourceText.trim();
    const scheduledIntent = detectScheduledIntent(sourceText, input.now);
    const chainedScheduledStages = scheduledIntent?.chainedStages ?? [];
    const executableText = scheduledIntent?.taskQuery || sourceText;
    const planningText = scheduledIntent
        ? [scheduledIntent.taskQuery, ...chainedScheduledStages.map((stage) => stage.taskQuery)].join('。')
        : executableText;
    const mode = scheduledIntent
        ? chainedScheduledStages.length > 0
            ? 'scheduled_multi_task'
            : 'scheduled_task'
        : isLikelyChat(executableText)
            ? 'chat'
            : 'immediate_task';
    const language = detectLanguage(sourceText);
    const clarification = buildClarificationDecision({
        sourceText,
        executableText,
        mode,
    });
    const presentation = buildPresentationContract(planningText, scheduledIntent?.speakResult ?? false);
    const tasks = scheduledIntent
        ? buildScheduledTaskDefinitions({
            scheduledIntent,
            mode,
            workspacePath: input.workspacePath,
            systemContext: input.systemContext,
        })
        : [buildTaskDefinition(executableText, mode, input.workspacePath, input.systemContext)];
    const primaryTaskDefinition =
        tasks[0] ?? buildTaskDefinition(executableText, mode, input.workspacePath, input.systemContext);
    const hasManualAction = requiresExternalAuthOrManualAction(planningText);
    const hasBlockingManualAction = hasExplicitManualActionSignal(planningText);
    const hitlPolicy = mergeHitlPolicies(tasks.map((taskDefinition) => buildHitlPolicy({
        text: planningText,
        taskDefinition,
        hasManualAction,
    })));
    const defaultingPolicy = buildDefaultingPolicy({
        text: planningText,
        language,
        presentation,
        hasBlockingManualAction,
    });
    const deliverables = buildDeliverables({
        text: planningText,
        workspacePath: input.workspacePath,
        presentation,
        localPlanWorkflow: primaryTaskDefinition.preferredWorkflow,
        localPlanRequiresHostAccess: primaryTaskDefinition.localPlanHint?.requiresHostAccessGrant,
    });
    const checkpoints = buildCheckpoints({
        text: executableText,
        mode,
        deliverables,
        hasManualAction,
        hasBlockingManualAction,
        hitlPolicy,
        clarification,
    });
    const missingInfo = buildMissingInfo(clarification);
    const userActionsRequired = buildUserActionsRequired({
        clarification,
        missingInfo,
        checkpoints,
        hasManualAction,
        hasBlockingManualAction,
        hitlPolicy,
        sourceText: planningText,
    });
    const goalFrame = buildGoalFrame({
        text: planningText,
        mode,
        taskDefinition: primaryTaskDefinition,
        deliverables,
    });
    const runtimeIsolationPolicy = buildRuntimeIsolationPolicy({
        workspacePath: input.workspacePath,
        text: planningText,
        taskDefinition: primaryTaskDefinition,
        goalFrame,
    });
    const sessionIsolationPolicy = buildSessionIsolationPolicy();
    const memoryIsolationPolicy = buildMemoryIsolationPolicy({
        text: planningText,
        goalFrame,
    });
    const tenantIsolationPolicy = buildTenantIsolationPolicy();
    const researchQueries = buildResearchQueries({
        text: planningText,
        mode,
        taskDefinition: primaryTaskDefinition,
        hasManualAction,
    });
    const researchEvidence = buildResearchEvidence({
        sourceText,
        taskDefinition: primaryTaskDefinition,
        deliverables,
        defaultingPolicy,
    });
    const uncertaintyRegistry = buildUncertaintyRegistry({
        clarification,
        taskDefinition: primaryTaskDefinition,
        defaultingPolicy,
        hasManualAction,
        evidence: researchEvidence,
    });
    const { strategyOptions, selectedStrategyId } = buildStrategyOptions({
        text: planningText,
        taskDefinition: primaryTaskDefinition,
        deliverables,
        evidence: researchEvidence,
    });
    const knownRisks = buildKnownRisks({
        clarification,
        taskDefinition: primaryTaskDefinition,
        hasManualAction,
        researchQueries,
    });

    const scheduledStages = scheduledIntent
        ? buildScheduledStages({
            scheduledIntent,
            tasks,
        })
        : [];

    return {
        schemaVersion: 1,
        mode,
        sourceText,
        workspacePath: input.workspacePath,
        schedule: scheduledIntent
            ? {
                executeAt: scheduledIntent.executeAt.toISOString(),
                timezone: 'Asia/Shanghai',
                recurrence: null,
                stages: scheduledStages.length > 0 ? scheduledStages : undefined,
            }
            : undefined,
        tasks,
        clarification: {
            ...clarification,
            assumptions: [
                ...clarification.assumptions,
                `Coworkany owns task decomposition, deliverable planning, and user-collaboration requests.`,
                `Default UI format: ${defaultingPolicy.uiFormat}.`,
                `Default artifact directory: ${defaultingPolicy.artifactDirectory}.`,
                ...(scheduledIntent ? ['Scheduled requests are frozen before background execution.'] : []),
            ],
        },
        presentation,
        deliverables,
        checkpoints,
        userActionsRequired,
        hitlPolicy,
        runtimeIsolationPolicy,
        sessionIsolationPolicy,
        memoryIsolationPolicy,
        tenantIsolationPolicy,
        missingInfo,
        defaultingPolicy,
        resumeStrategy: buildResumeStrategy(),
        goalFrame,
        researchQueries,
        researchEvidence,
        uncertaintyRegistry,
        strategyOptions,
        selectedStrategyId,
        knownRisks: Array.from(new Set([...knownRisks, ...hitlPolicy.reasons])),
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
    const goalFramingStepId = randomUUID();
    const researchStepId = randomUUID();
    const uncertaintyStepId = randomUUID();
    const contractFreezeStepId = randomUUID();
    const hasBlockingUnknowns = (request.uncertaintyRegistry ?? [])
        .some((item) => item.status === 'blocking_unknown');
    const completedResearchCount = (request.researchEvidence ?? []).length;
    const researchQueryCount = request.researchQueries?.length ?? 0;

    steps.push({
        stepId: goalFramingStepId,
        kind: 'goal_framing',
        title: 'Frame user goal',
        description: 'Normalize the raw user input into a goal frame with constraints, preferences, and target outcomes.',
        status: 'completed',
        dependencies: [],
    });
    steps.push({
        stepId: researchStepId,
        kind: 'research',
        title: 'Prepare research agenda',
        description: researchQueryCount > 0
            ? `Prepared ${researchQueryCount} research query${researchQueryCount === 1 ? '' : 'ies'} and seeded ${completedResearchCount} evidence item${completedResearchCount === 1 ? '' : 's'}.`
            : 'No additional pre-freeze research was required for this request.',
        status: 'completed',
        dependencies: [goalFramingStepId],
    });
    steps.push({
        stepId: uncertaintyStepId,
        kind: 'uncertainty_resolution',
        title: hasBlockingUnknowns ? 'Resolve blocking uncertainty' : 'Resolve uncertainty',
        description: hasBlockingUnknowns
            ? request.clarification.questions.join(' ') || 'Blocking uncertainty remains before execution can safely continue.'
            : 'Confirmed facts, inferred facts, and defaultable items have been classified for contract freeze.',
        status: hasBlockingUnknowns ? 'blocked' : 'completed',
        dependencies: [researchStepId],
    });
    steps.push({
        stepId: contractFreezeStepId,
        kind: 'contract_freeze',
        title: hasBlockingUnknowns ? 'Await contract freeze' : 'Freeze execution contract',
        description: hasBlockingUnknowns
            ? 'The execution contract is waiting on blocking clarification before final freeze.'
            : 'The request has been frozen and is ready for execution.',
        status: hasBlockingUnknowns ? 'blocked' : 'completed',
        dependencies: [uncertaintyStepId],
    });

    const executionDependencies = [contractFreezeStepId];
    const executionSteps = request.tasks.map((task) => ({
        task,
        stepId: randomUUID(),
    }));
    const executionStepIds = executionSteps.map((entry) => entry.stepId);
    const executionStepByTaskId = new Map(executionSteps.map((entry) => [entry.task.id, entry.stepId]));
    for (const entry of executionSteps) {
        const taskDependencyStepIds = entry.task.dependencies
            .map((dependencyId) => executionStepByTaskId.get(dependencyId))
            .filter((stepId): stepId is NonNullable<typeof stepId> => stepId !== undefined);
        steps.push({
            stepId: entry.stepId,
            taskId: entry.task.id,
            kind: 'execution',
            title: entry.task.title,
            description: entry.task.objective,
            status: hasBlockingUnknowns ? 'blocked' : 'pending',
            dependencies: [...executionDependencies, ...taskDependencyStepIds],
        });
    }

    const reductionStepId = randomUUID();
    steps.push({
        stepId: reductionStepId,
        kind: 'reduction',
        title: 'Reduce execution output',
        description: 'Condense raw execution output into canonical, UI, and TTS payloads.',
        status: hasBlockingUnknowns ? 'blocked' : 'pending',
        dependencies: executionStepIds,
    });

    steps.push({
        stepId: randomUUID(),
        kind: 'presentation',
        title: 'Present final result',
        description: 'Present the reduced result to the user through the appropriate channels.',
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
            if (task.constraints.length > 0) {
                parts.push(`约束：${task.constraints.join('；')}`);
            }
            if (task.acceptanceCriteria.length > 0) {
                parts.push(`验收标准：${task.acceptanceCriteria.join('；')}`);
            }
            if (includeGlobalContracts && (request.deliverables?.length ?? 0) > 0) {
                const deliverableLine = request.deliverables!
                    .map((deliverable) => deliverable.path
                        ? `${deliverable.title} (${deliverable.path})`
                        : deliverable.title)
                    .join('；');
                parts.push(`交付物：${deliverableLine}`);
            }
            if (includeGlobalContracts && (request.checkpoints?.length ?? 0) > 0) {
                const checkpointLine = request.checkpoints!.map((checkpoint) => checkpoint.title).join('；');
                parts.push(`检查点：${checkpointLine}`);
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
