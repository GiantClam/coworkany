export type AcceptanceSeverity = 'pass' | 'warn' | 'fail';

export type AcceptanceRouteMode = 'chat' | 'task' | 'scheduled_task';

export type UiTaskPhase =
    | 'waiting_for_model'
    | 'running_tool'
    | 'retrying'
    | 'failed'
    | 'configuration_required'
    | 'suspended'
    | 'finished';

export interface AcceptanceCheckResult {
    id: string;
    severity: AcceptanceSeverity;
    message: string;
    detail?: string;
}

export interface AcceptanceSummary {
    passed: boolean;
    failedChecks: AcceptanceCheckResult[];
    warnings: AcceptanceCheckResult[];
    checks: AcceptanceCheckResult[];
}

export interface AssistantAnswerQualityInput {
    text: string;
    minChars?: number;
    routeMode?: AcceptanceRouteMode;
    requiresAction?: boolean;
    requiredCapabilities?: string[];
    satisfiedCapabilities?: string[];
    requiredArtifactPaths?: string[];
    presentArtifactPaths?: string[];
}

export interface ProductToneInput {
    text: string;
    failOnWarnings?: boolean;
}

export interface UiUnderstandabilityInput {
    phase: UiTaskPhase;
    statusLabel?: string;
    description?: string;
    primaryActionLabel?: string;
    failureCategory?: 'retryable' | 'configuration' | 'suspended' | 'terminal' | 'unknown';
    rawError?: string;
}

export interface LiveAcceptanceInput {
    answer?: AssistantAnswerQualityInput;
    tone?: ProductToneInput;
    ui?: UiUnderstandabilityInput;
    visual?: VisualScreenshotAcceptanceInput;
}

export interface VisualScreenshotAcceptanceInput {
    screenshotPath?: string;
    referencePath?: string;
    score?: number;
    threshold?: number;
    verdict?: 'pass' | 'revise' | 'fail';
    categoryMatch?: boolean;
    differences?: string[];
    suggestions?: string[];
}

const RAW_PROTOCOL_PATTERN = /\b(workflow_missing_required_tool_evidence|E_PROTOCOL_[A-Z0-9_]+|TASK_FAILED|UnhandledPromiseRejection|stack trace)\b|Error:\s*[A-Za-z0-9_]+/u;
const EMPTY_OR_PLACEHOLDER_PATTERN = /^(ok|okay|done|complete|completed|n\/a|none|好的|收到|完成|已完成)$/iu;
const UNSUPPORTED_REFUSAL_PATTERN = /\b(i can't access|i cannot access|i'm unable to access|cannot browse|can't browse|no access to (?:files|filesystem|browser|internet))\b|无法访问|不能访问|无法浏览/u;
const COMPLETION_CLAIM_PATTERN = /\b(done|complete|completed|already done|task is done|written|verified|no further action)\b|已完成|已写入|已经写好|已验证|无需进一步操作/u;
const AI_META_TONE_PATTERN = /\b(as an ai language model|i am just an ai|i'm just an ai|i don't have personal)\b|作为(?:一个)?AI语言模型/iu;
const CHEERLEADING_PATTERN = /\b(great question|awesome|super easy|obviously|clearly you just|simply just)\b|很棒的问题|显然你只需要/iu;
const EXCESSIVE_EXCLAMATION_PATTERN = /(?:!|！){2,}/u;

function normalizeText(text: string | undefined): string {
    return (text ?? '').replace(/\s+/gu, ' ').trim();
}

function unique(values: readonly string[] | undefined): string[] {
    return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function check(
    id: string,
    severity: AcceptanceSeverity,
    message: string,
    detail?: string,
): AcceptanceCheckResult {
    return detail ? { id, severity, message, detail } : { id, severity, message };
}

export function summarizeAcceptance(checks: AcceptanceCheckResult[]): AcceptanceSummary {
    const failedChecks = checks.filter((item) => item.severity === 'fail');
    const warnings = checks.filter((item) => item.severity === 'warn');
    return {
        passed: failedChecks.length === 0,
        failedChecks,
        warnings,
        checks,
    };
}

export function evaluateAssistantAnswerQuality(input: AssistantAnswerQualityInput): AcceptanceCheckResult[] {
    const text = normalizeText(input.text);
    const minChars = input.minChars ?? 24;
    const requiredCapabilities = unique(input.requiredCapabilities);
    const satisfiedCapabilities = new Set(unique(input.satisfiedCapabilities));
    const requiredArtifactPaths = unique(input.requiredArtifactPaths);
    const presentArtifactPaths = new Set(unique(input.presentArtifactPaths));
    const checks: AcceptanceCheckResult[] = [];

    if (text.length < minChars) {
        checks.push(check(
            'answer.min_content',
            'fail',
            'assistant answer is too short to support live acceptance',
            `chars=${text.length}, min=${minChars}`,
        ));
    } else if (!/[\p{L}\p{N}]/u.test(text)) {
        checks.push(check('answer.substantive_text', 'fail', 'assistant answer has no substantive letters or numbers'));
    } else if (EMPTY_OR_PLACEHOLDER_PATTERN.test(text)) {
        checks.push(check('answer.placeholder', 'fail', 'assistant answer is a low-information placeholder'));
    } else {
        checks.push(check('answer.substantive_text', 'pass', 'assistant answer contains substantive text'));
    }

    if (RAW_PROTOCOL_PATTERN.test(text)) {
        checks.push(check('answer.raw_protocol_error', 'fail', 'assistant answer exposes raw protocol or runtime error text'));
    } else {
        checks.push(check('answer.raw_protocol_error', 'pass', 'assistant answer does not expose raw protocol errors'));
    }

    if (UNSUPPORTED_REFUSAL_PATTERN.test(text)) {
        checks.push(check('answer.unsupported_refusal', 'fail', 'assistant refused a capability that should be handled by the product workflow'));
    }

    const missingCapabilities = requiredCapabilities.filter((capability) => !satisfiedCapabilities.has(capability));
    const isTaskLike = input.requiresAction === true || input.routeMode === 'task' || input.routeMode === 'scheduled_task';
    if (isTaskLike && missingCapabilities.length > 0) {
        checks.push(check(
            'answer.required_evidence',
            'fail',
            'task answer is missing required tool evidence',
            missingCapabilities.join(', '),
        ));
    } else if (requiredCapabilities.length > 0) {
        checks.push(check('answer.required_evidence', 'pass', 'required capability evidence is satisfied'));
    }

    const missingArtifacts = requiredArtifactPaths.filter((artifactPath) => !presentArtifactPaths.has(artifactPath));
    if (isTaskLike && missingArtifacts.length > 0) {
        checks.push(check(
            'answer.required_artifacts',
            'fail',
            'task answer is missing required output artifacts',
            missingArtifacts.join(', '),
        ));
    } else if (requiredArtifactPaths.length > 0) {
        checks.push(check('answer.required_artifacts', 'pass', 'required output artifacts are present'));
    }

    if (
        isTaskLike
        && COMPLETION_CLAIM_PATTERN.test(text)
        && (missingCapabilities.length > 0 || missingArtifacts.length > 0)
    ) {
        checks.push(check('answer.false_completion_claim', 'fail', 'assistant claims completion without the required evidence or artifacts'));
    }

    const unmentionedArtifacts = requiredArtifactPaths.filter((artifactPath) => !text.includes(artifactPath));
    if (isTaskLike && requiredArtifactPaths.length > 0 && unmentionedArtifacts.length > 0 && missingArtifacts.length === 0) {
        checks.push(check(
            'answer.artifact_mention',
            'warn',
            'task completed but final answer does not mention all required artifact paths',
            unmentionedArtifacts.join(', '),
        ));
    }

    return checks;
}

export function evaluateProductTone(input: ProductToneInput): AcceptanceCheckResult[] {
    const text = normalizeText(input.text);
    const checks: AcceptanceCheckResult[] = [];

    if (!text) {
        checks.push(check('tone.nonempty', 'fail', 'product tone cannot be evaluated on an empty answer'));
        return checks;
    }

    checks.push(check('tone.nonempty', 'pass', 'answer is available for tone evaluation'));

    if (AI_META_TONE_PATTERN.test(text)) {
        checks.push(check('tone.ai_meta', 'fail', 'answer uses AI-meta language instead of product voice'));
    } else {
        checks.push(check('tone.ai_meta', 'pass', 'answer avoids AI-meta product voice'));
    }

    if (CHEERLEADING_PATTERN.test(text)) {
        checks.push(check(
            'tone.cheerleading',
            input.failOnWarnings ? 'fail' : 'warn',
            'answer contains cheerleading or condescending phrasing',
        ));
    }

    if (EXCESSIVE_EXCLAMATION_PATTERN.test(text)) {
        checks.push(check(
            'tone.excessive_punctuation',
            input.failOnWarnings ? 'fail' : 'warn',
            'answer uses excessive exclamation punctuation',
        ));
    }

    return checks;
}

export function evaluateVisualScreenshotAcceptance(input: VisualScreenshotAcceptanceInput): AcceptanceCheckResult[] {
    const threshold = input.threshold ?? 90;
    const checks: AcceptanceCheckResult[] = [];
    const screenshotPath = normalizeText(input.screenshotPath);
    const referencePath = normalizeText(input.referencePath);

    if (!screenshotPath) {
        checks.push(check('visual.screenshot_path', 'fail', 'visual acceptance is missing a generated screenshot path'));
    } else {
        checks.push(check('visual.screenshot_path', 'pass', 'visual acceptance has a generated screenshot path'));
    }

    if (!referencePath) {
        checks.push(check('visual.reference_path', 'fail', 'visual acceptance is missing a reference screenshot path'));
    } else {
        checks.push(check('visual.reference_path', 'pass', 'visual acceptance has a reference screenshot path'));
    }

    if (typeof input.score !== 'number' || !Number.isFinite(input.score)) {
        checks.push(check('visual.score', 'fail', 'visual acceptance is missing a numeric screenshot score'));
    } else if (input.score < threshold) {
        checks.push(check(
            'visual.score',
            'fail',
            'visual screenshot score is below the acceptance threshold',
            `score=${input.score}, threshold=${threshold}`,
        ));
    } else {
        checks.push(check('visual.score', 'pass', 'visual screenshot score meets the acceptance threshold'));
    }

    if (input.verdict && input.verdict !== 'pass') {
        checks.push(check('visual.verdict', 'fail', 'visual screenshot verdict is not pass', input.verdict));
    } else if (input.verdict === 'pass') {
        checks.push(check('visual.verdict', 'pass', 'visual screenshot verdict is pass'));
    }

    if (input.categoryMatch === false) {
        checks.push(check('visual.category_match', 'fail', 'visual screenshot does not match the expected UI category'));
    } else if (input.categoryMatch === true) {
        checks.push(check('visual.category_match', 'pass', 'visual screenshot matches the expected UI category'));
    }

    const differences = input.differences?.filter((item) => item.trim().length > 0) ?? [];
    if (differences.length > 0 && input.verdict !== 'pass') {
        checks.push(check('visual.differences', 'fail', 'visual screenshot has unresolved differences', differences.join('; ')));
    }

    return checks;
}

export function evaluateUiUnderstandability(input: UiUnderstandabilityInput): AcceptanceCheckResult[] {
    const statusLabel = normalizeText(input.statusLabel);
    const description = normalizeText(input.description);
    const actionLabel = normalizeText(input.primaryActionLabel);
    const rawError = normalizeText(input.rawError);
    const checks: AcceptanceCheckResult[] = [];

    if (!statusLabel) {
        checks.push(check('ui.status_label', 'fail', 'UI state is missing a user-visible status label'));
    } else {
        checks.push(check('ui.status_label', 'pass', 'UI state has a user-visible status label'));
    }

    if (!description) {
        checks.push(check('ui.description', 'fail', 'UI state is missing a user-visible explanation'));
    } else {
        checks.push(check('ui.description', 'pass', 'UI state has a user-visible explanation'));
    }

    const combinedText = `${statusLabel} ${description} ${rawError}`;
    if (RAW_PROTOCOL_PATTERN.test(combinedText)) {
        checks.push(check('ui.raw_protocol_error', 'fail', 'UI exposes raw protocol or runtime error text'));
    } else {
        checks.push(check('ui.raw_protocol_error', 'pass', 'UI avoids raw protocol error text'));
    }

    const needsAction = input.phase === 'failed'
        || input.phase === 'configuration_required'
        || input.phase === 'suspended'
        || input.failureCategory === 'retryable'
        || input.failureCategory === 'configuration'
        || input.failureCategory === 'suspended';
    if (needsAction && !actionLabel) {
        checks.push(check('ui.recovery_action', 'fail', 'recoverable or blocked UI state is missing a primary action label'));
    } else if (needsAction) {
        checks.push(check('ui.recovery_action', 'pass', 'recoverable or blocked UI state provides a primary action label'));
    }

    if ((input.phase === 'waiting_for_model' || input.phase === 'running_tool' || input.phase === 'retrying') && !description) {
        checks.push(check('ui.progress_explanation', 'fail', 'in-progress UI state does not explain what is happening'));
    }

    return checks;
}

export function evaluateLiveAcceptance(input: LiveAcceptanceInput): AcceptanceSummary {
    const checks: AcceptanceCheckResult[] = [];
    if (input.answer) {
        checks.push(...evaluateAssistantAnswerQuality(input.answer));
    }
    if (input.tone) {
        checks.push(...evaluateProductTone(input.tone));
    }
    if (input.ui) {
        checks.push(...evaluateUiUnderstandability(input.ui));
    }
    if (input.visual) {
        checks.push(...evaluateVisualScreenshotAcceptance(input.visual));
    }
    return summarizeAcceptance(checks);
}
