import { randomUUID } from 'crypto';
import type {
    CapabilityPlan,
    ClarificationDecision,
    CheckpointContract,
    DeliverableContract,
    ExecutionProfile,
    HitlExecutionPolicy,
    HitlPolicy,
    MissingInfoItem,
    NormalizedWorkRequest,
    PublishIntent,
    UserActionRequest,
} from './workRequestSchema';

function getCapabilityBudget(
    complexityTier: CapabilityPlan['boundedLearningBudget']['complexityTier']
): CapabilityPlan['boundedLearningBudget'] {
    switch (complexityTier) {
        case 'simple':
            return {
                complexityTier,
                maxRounds: 1,
                maxResearchTimeMs: 15_000,
                maxValidationAttempts: 1,
            };
        case 'complex':
            return {
                complexityTier,
                maxRounds: 4,
                maxResearchTimeMs: 180_000,
                maxValidationAttempts: 3,
            };
        default:
            return {
                complexityTier: 'moderate',
                maxRounds: 2,
                maxResearchTimeMs: 60_000,
                maxValidationAttempts: 2,
            };
    }
}

function platformHasDedicatedPublishCapability(platform: NonNullable<PublishIntent['platform']>): boolean {
    return platform === 'xiaohongshu';
}

export function buildCapabilityPlan(input: {
    clarification: ClarificationDecision;
    executionProfile: ExecutionProfile;
    publishIntent?: PublishIntent;
    explicitAuthSignal: boolean;
    hasBlockingManualAction: boolean;
    hasPreferredWorkflow: boolean;
}): CapabilityPlan {
    const reasons = new Set<string>(input.executionProfile.reasons);

    if (input.clarification.required) {
        reasons.add('Execution cannot continue until the missing task information is clarified.');
        return {
            missingCapability: 'external_blocker',
            learningRequired: false,
            canProceedWithoutLearning: false,
            learningScope: 'none',
            replayStrategy: 'none',
            sideEffectRisk: 'none',
            userAssistRequired: true,
            userAssistReason: 'ambiguous_goal',
            boundedLearningBudget: getCapabilityBudget('simple'),
            reasons: Array.from(reasons),
        };
    }

    if (input.explicitAuthSignal || input.hasBlockingManualAction) {
        reasons.add('Execution is blocked by an external prerequisite rather than a missing internal capability.');
        return {
            missingCapability: 'external_blocker',
            learningRequired: false,
            canProceedWithoutLearning: false,
            learningScope: 'none',
            replayStrategy: 'none',
            sideEffectRisk: input.publishIntent?.requiresSideEffect ? 'write_external' : 'none',
            userAssistRequired: true,
            userAssistReason: input.explicitAuthSignal ? 'auth' : 'policy',
            boundedLearningBudget: getCapabilityBudget('simple'),
            reasons: Array.from(reasons),
        };
    }

    const requiresLivePublishCapability = input.publishIntent?.requiresSideEffect === true;
    const hasDedicatedPublishCapability =
        requiresLivePublishCapability && input.publishIntent
            ? platformHasDedicatedPublishCapability(input.publishIntent.platform)
            : false;

    if (requiresLivePublishCapability && !hasDedicatedPublishCapability) {
        reasons.add(
            `Coworkany does not have a dedicated validated publish capability for ${input.publishIntent?.platform ?? 'the target platform'}.`
        );
        return {
            missingCapability: 'new_runtime_tool_needed',
            learningRequired: true,
            canProceedWithoutLearning: false,
            learningScope: 'runtime_tool',
            replayStrategy: 'resume_from_checkpoint',
            sideEffectRisk: 'write_external',
            userAssistRequired: false,
            userAssistReason: 'none',
            boundedLearningBudget: getCapabilityBudget(
                input.publishIntent?.platform === 'wechat_official' ? 'complex' : 'moderate'
            ),
            reasons: Array.from(reasons),
        };
    }

    if (
        input.executionProfile.requiredCapabilities.includes('browser_interaction')
        && !input.hasPreferredWorkflow
        && !requiresLivePublishCapability
    ) {
        reasons.add('Execution may need a reusable workflow or skill before browser work can proceed reliably.');
        return {
            missingCapability: 'workflow_gap',
            learningRequired: false,
            canProceedWithoutLearning: true,
            learningScope: 'skill',
            replayStrategy: 'resume_from_checkpoint',
            sideEffectRisk: 'read_only',
            userAssistRequired: false,
            userAssistReason: 'none',
            boundedLearningBudget: getCapabilityBudget('simple'),
            reasons: Array.from(reasons),
        };
    }

    return {
        missingCapability: 'none',
        learningRequired: false,
        canProceedWithoutLearning: true,
        learningScope: 'none',
        replayStrategy: 'none',
        sideEffectRisk: requiresLivePublishCapability ? 'write_external' : 'none',
        userAssistRequired: false,
        userAssistReason: 'none',
        boundedLearningBudget: getCapabilityBudget('simple'),
        reasons: Array.from(reasons),
    };
}

export function buildExecutionProfile(input: {
    mode: NormalizedWorkRequest['mode'];
    clarification: ClarificationDecision;
    deliverables: DeliverableContract[];
    hitlPolicy: HitlPolicy;
    publishIntent?: PublishIntent;
    hasManualAction: boolean;
    hasBlockingManualAction: boolean;
    requiresBrowserSkill: boolean;
    explicitAuthRequired: boolean;
    hostAccessRequired: boolean;
    hasPreferredWorkflow: boolean;
    isComplexTask: boolean;
    codeChangeTask: boolean;
    selfManagementTask: boolean;
}): ExecutionProfile {
    const requiredCapabilities = new Set<ExecutionProfile['requiredCapabilities'][number]>();
    const reasons = new Set<string>();
    const hasPublishSideEffect = input.publishIntent?.requiresSideEffect === true;
    const isPreviewThenPublish = input.publishIntent?.executionMode === 'preview_then_publish';
    const publishPlatform = input.publishIntent?.platform;
    const hasWorkspaceWriteDeliverable = input.deliverables.some((deliverable) =>
        deliverable.type === 'artifact_file'
        || deliverable.type === 'report_file'
        || deliverable.type === 'workspace_change'
        || deliverable.type === 'code_change'
    );

    if (input.requiresBrowserSkill || hasPublishSideEffect) {
        requiredCapabilities.add('browser_interaction');
        reasons.add(
            hasPublishSideEffect
                ? `Execution must complete a real publish action on ${publishPlatform ?? 'the target platform'}.`
                : 'Execution likely depends on browser or UI interaction.'
        );
    }

    if (input.explicitAuthRequired || hasPublishSideEffect) {
        requiredCapabilities.add('external_auth');
        reasons.add(
            hasPublishSideEffect
                ? 'Execution may require a real account/login state on the target platform.'
                : 'Execution may require a real account/login state.'
        );
    }

    if (input.hostAccessRequired) {
        requiredCapabilities.add('host_access');
        reasons.add('Execution targets host paths outside the workspace sandbox.');
    }

    if (hasWorkspaceWriteDeliverable) {
        requiredCapabilities.add('workspace_write');
        reasons.add('Execution is expected to write files or mutate workspace state.');
    }

    if (
        input.hitlPolicy.requiresPlanConfirmation
        || input.hitlPolicy.riskTier === 'high'
        || input.selfManagementTask
        || isPreviewThenPublish
    ) {
        requiredCapabilities.add('human_review');
        reasons.add(
            isPreviewThenPublish
                ? 'The user requested a preview/review step before publish.'
                : 'Execution may require explicit human review or confirmation.'
        );
    }

    let blockingRisk: ExecutionProfile['blockingRisk'] = 'none';
    if (input.clarification.required) {
        blockingRisk = 'missing_info';
    } else if (input.hostAccessRequired) {
        blockingRisk = 'permission';
    } else if (input.hasBlockingManualAction) {
        blockingRisk = input.explicitAuthRequired ? 'auth' : 'manual_step';
    } else if (isPreviewThenPublish) {
        blockingRisk = 'policy_review';
    } else if (input.hitlPolicy.requiresPlanConfirmation) {
        blockingRisk = 'policy_review';
    }

    let interactionMode: ExecutionProfile['interactionMode'] = 'passive_status';
    if (input.clarification.required) {
        interactionMode = 'input_first';
    } else if (input.hasBlockingManualAction) {
        interactionMode = 'action_first';
    } else if (isPreviewThenPublish) {
        interactionMode = 'review_first';
    } else if (input.hitlPolicy.requiresPlanConfirmation) {
        interactionMode = 'review_first';
    }

    let executionShape: ExecutionProfile['executionShape'] = 'single_step';
    if (input.hasPreferredWorkflow) {
        executionShape = 'deterministic_workflow';
    } else if (input.isComplexTask || hasPublishSideEffect) {
        executionShape = 'staged';
    } else if (input.requiresBrowserSkill || input.deliverables.some((deliverable) => deliverable.type === 'report_file')) {
        executionShape = 'exploratory';
    }

    let primaryHardness: ExecutionProfile['primaryHardness'] = 'trivial';
    if (input.hasBlockingManualAction) {
        primaryHardness = 'externally_blocked';
    } else if (
        hasPublishSideEffect ||
        input.hitlPolicy.riskTier === 'high'
        || input.hostAccessRequired
        || input.codeChangeTask
        || input.selfManagementTask
    ) {
        primaryHardness = 'high_risk';
    } else if (input.isComplexTask || executionShape === 'staged') {
        primaryHardness = 'multi_step';
    } else if (
        input.requiresBrowserSkill
        || hasWorkspaceWriteDeliverable
        || input.hasManualAction
        || executionShape === 'deterministic_workflow'
    ) {
        primaryHardness = 'bounded';
    }

    return {
        primaryHardness,
        requiredCapabilities: Array.from(requiredCapabilities),
        blockingRisk,
        interactionMode,
        executionShape,
        reasons: Array.from(reasons),
    };
}

export function deriveActiveHardness(input: {
    executionProfile?: ExecutionProfile;
    checkpoint?: Pick<CheckpointContract, 'kind' | 'blocking' | 'requiresUserConfirmation'>;
    userAction?: Pick<UserActionRequest, 'kind' | 'blocking'>;
    status?: 'idle' | 'running' | 'finished' | 'failed';
}): ExecutionProfile['primaryHardness'] | undefined {
    const profile = input.executionProfile;
    if (!profile) {
        return undefined;
    }

    if (
        input.userAction?.kind === 'external_auth'
        || (input.userAction?.kind === 'manual_step' && input.userAction.blocking)
        || (input.checkpoint?.kind === 'manual_action' && input.checkpoint.blocking)
    ) {
        return 'externally_blocked';
    }

    if (
        input.userAction?.kind === 'confirm_plan'
        || (input.checkpoint?.kind === 'review' && input.checkpoint.requiresUserConfirmation)
        || (input.status !== 'running' && profile.interactionMode === 'review_first')
    ) {
        return 'high_risk';
    }

    return profile.primaryHardness;
}

function firstMeaningfulLine(values: Array<string | undefined>): string | undefined {
    return values
        .map((value) => value?.trim() ?? '')
        .find((value) => value.length > 0);
}

export function deriveBlockingReason(input: {
    checkpoint?: Pick<CheckpointContract, 'reason' | 'userMessage' | 'blocking'>;
    userAction?: Pick<UserActionRequest, 'description' | 'questions' | 'instructions' | 'blocking'>;
    clarification?: {
        reason?: string;
        questions?: string[];
    };
    status?: 'idle' | 'running' | 'finished' | 'failed';
}): string | undefined {
    if (input.status && input.status !== 'idle') {
        return undefined;
    }

    if (input.userAction?.blocking) {
        return firstMeaningfulLine([
            input.userAction.description,
            ...(input.userAction.questions ?? []),
            ...(input.userAction.instructions ?? []),
        ]);
    }

    if (input.checkpoint?.blocking) {
        return firstMeaningfulLine([
            input.checkpoint.userMessage,
            input.checkpoint.reason,
        ]);
    }

    return firstMeaningfulLine([
        input.clarification?.reason,
        ...(input.clarification?.questions ?? []),
    ]);
}

export function buildCheckpointsFromExecutionProfile(input: {
    isComplexTask: boolean;
    deliverables: DeliverableContract[];
    executionProfile: ExecutionProfile;
    capabilityPlan?: CapabilityPlan;
    hitlPolicy: HitlPolicy;
    clarification: ClarificationDecision;
    publishIntent?: PublishIntent;
}): CheckpointContract[] {
    const checkpoints: CheckpointContract[] = [];
    const toBlocking = (policy: HitlExecutionPolicy): boolean =>
        policy === 'review_required' || policy === 'hard_block';
    const needsPublishReview = input.publishIntent?.executionMode === 'preview_then_publish';

    if (needsPublishReview && !input.clarification.required) {
        const executionPolicy: HitlExecutionPolicy = 'review_required';
        checkpoints.push({
            id: randomUUID(),
            title: 'Review publish draft',
            kind: 'review',
            reason: 'The request explicitly asks Coworkany to show the publish draft before sending it.',
            userMessage: 'Show the prepared post draft and wait for the user to approve it before publishing.',
            riskTier: 'high',
            executionPolicy,
            requiresUserConfirmation: true,
            blocking: toBlocking(executionPolicy),
        });
    }

    if (input.hitlPolicy.requiresPlanConfirmation && !input.clarification.required && !needsPublishReview) {
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

    if (input.executionProfile.blockingRisk === 'auth' || input.executionProfile.blockingRisk === 'manual_step') {
        const executionPolicy: HitlExecutionPolicy =
            input.executionProfile.interactionMode === 'action_first' ? 'hard_block' : 'auto';
        checkpoints.push({
            id: randomUUID(),
            title: 'User action required',
            kind: 'manual_action',
            reason: input.executionProfile.interactionMode === 'action_first'
                ? 'Execution depends on a manual step the user must complete.'
                : 'Execution likely needs user-side preparation before the downstream stage.',
            userMessage: input.executionProfile.interactionMode === 'action_first'
                ? 'Pause and ask the user to complete the required manual action before continuing.'
                : 'Monitor downstream execution for a concrete auth/manual prerequisite and only interrupt the user if a specific blocker appears.',
            riskTier: 'high',
            executionPolicy,
            requiresUserConfirmation: true,
            blocking: toBlocking(executionPolicy),
        });
    }

    if (
        input.isComplexTask ||
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

export function buildUserActionsRequiredFromExecutionProfile(input: {
    clarification: ClarificationDecision;
    missingInfo: MissingInfoItem[];
    checkpoints: CheckpointContract[];
    executionProfile: ExecutionProfile;
    capabilityPlan?: CapabilityPlan;
    hitlPolicy: HitlPolicy;
    publishIntent?: PublishIntent;
    likelyExternalAuth: boolean;
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

    const needsPublishReview = input.publishIntent?.executionMode === 'preview_then_publish';
    if ((input.hitlPolicy.requiresPlanConfirmation || needsPublishReview) && !input.clarification.required) {
        const reviewCheckpoint = input.checkpoints.find((checkpoint) => checkpoint.kind === 'review');
        const executionPolicy: HitlExecutionPolicy = 'review_required';
        actions.push({
            id: randomUUID(),
            title: needsPublishReview ? 'Review the publish draft' : 'Confirm the execution plan',
            kind: 'confirm_plan',
            description: needsPublishReview
                ? 'Coworkany prepared the post draft and needs approval before publishing it.'
                : `This ${input.hitlPolicy.riskTier}-risk task needs explicit approval before Coworkany starts execution.`,
            riskTier: needsPublishReview ? 'high' : input.hitlPolicy.riskTier,
            executionPolicy,
            blocking: toBlocking(executionPolicy),
            questions: needsPublishReview
                ? ['Review the drafted post and confirm whether Coworkany should publish it now.']
                : ['Confirm whether Coworkany should proceed with the current execution plan.'],
            instructions: needsPublishReview
                ? ['Reply with approval to publish, or provide the edits that should be applied before publishing.']
                : ['Reply with approval to continue, or provide changes that should be applied before execution starts.'],
            fulfillsCheckpointId: reviewCheckpoint?.id,
        });
    }

    if (input.executionProfile.interactionMode === 'action_first') {
        const manualCheckpoint = input.checkpoints.find((checkpoint) => checkpoint.kind === 'manual_action');
        const executionPolicy: HitlExecutionPolicy = 'hard_block';
        actions.push({
            id: randomUUID(),
            title: 'Complete required manual action',
            kind: input.likelyExternalAuth ? 'external_auth' : 'manual_step',
            description: input.executionProfile.blockingRisk === 'auth' || input.executionProfile.blockingRisk === 'manual_step'
                ? 'A manual or external step is required before Coworkany can continue the task.'
                : 'A downstream stage likely depends on external auth/account preparation. Please prepare it in advance.',
            riskTier: 'high',
            executionPolicy,
            blocking: toBlocking(executionPolicy),
            questions: [],
            instructions: input.executionProfile.blockingRisk === 'auth' || input.executionProfile.blockingRisk === 'manual_step'
                ? ['Complete the manual step in the UI or external system, then resume the task.']
                : ['Prepare the required account/auth state before the downstream stage starts.'],
            fulfillsCheckpointId: manualCheckpoint?.id,
        });
    }

    return actions;
}
