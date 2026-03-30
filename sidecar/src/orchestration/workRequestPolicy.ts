import type {
    ClarificationDecision,
    DeliverableContract,
    ExecutionProfile,
    HitlPolicy,
    NormalizedWorkRequest,
    PublishIntent,
} from './workRequestSchema';
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
    const reasons: string[] = [];
    const hasWorkspaceWriteDeliverable = input.deliverables.some((deliverable) =>
        deliverable.type === 'artifact_file'
        || deliverable.type === 'report_file'
        || deliverable.type === 'workspace_change'
        || deliverable.type === 'code_change',
    );
    if (input.requiresBrowserSkill || input.publishIntent?.requiresSideEffect) {
        requiredCapabilities.add('browser_interaction');
        reasons.push('Execution likely requires browser interaction.');
    }
    if (input.explicitAuthRequired || input.publishIntent?.requiresSideEffect) {
        requiredCapabilities.add('external_auth');
        reasons.push('Execution may require external authentication.');
    }
    if (input.hostAccessRequired) {
        requiredCapabilities.add('host_access');
        reasons.push('Execution targets non-workspace host paths.');
    }
    if (hasWorkspaceWriteDeliverable) {
        requiredCapabilities.add('workspace_write');
        reasons.push('Execution mutates workspace files.');
    }
    if (input.hitlPolicy.requiresPlanConfirmation || input.hitlPolicy.riskTier === 'high') {
        requiredCapabilities.add('human_review');
        reasons.push('Execution requires explicit review.');
    }
    let blockingRisk: ExecutionProfile['blockingRisk'] = 'none';
    if (input.clarification.required) {
        blockingRisk = 'missing_info';
    } else if (input.hostAccessRequired) {
        blockingRisk = 'permission';
    } else if (input.hasBlockingManualAction) {
        blockingRisk = input.explicitAuthRequired ? 'auth' : 'manual_step';
    } else if (input.hitlPolicy.requiresPlanConfirmation) {
        blockingRisk = 'policy_review';
    }
    let interactionMode: ExecutionProfile['interactionMode'] = 'passive_status';
    if (input.clarification.required) {
        interactionMode = 'input_first';
    } else if (input.hasBlockingManualAction) {
        interactionMode = 'action_first';
    } else if (input.hitlPolicy.requiresPlanConfirmation) {
        interactionMode = 'review_first';
    }
    let executionShape: ExecutionProfile['executionShape'] = 'single_step';
    if (input.hasPreferredWorkflow) {
        executionShape = 'deterministic_workflow';
    } else if (input.isComplexTask || input.publishIntent?.requiresSideEffect) {
        executionShape = 'staged';
    } else if (input.requiresBrowserSkill || hasWorkspaceWriteDeliverable) {
        executionShape = 'exploratory';
    }
    let primaryHardness: ExecutionProfile['primaryHardness'] = 'trivial';
    if (input.hasBlockingManualAction) {
        primaryHardness = 'externally_blocked';
    } else if (
        input.publishIntent?.requiresSideEffect
        || input.hitlPolicy.riskTier === 'high'
        || input.hostAccessRequired
        || input.codeChangeTask
        || input.selfManagementTask
    ) {
        primaryHardness = 'high_risk';
    } else if (input.isComplexTask || executionShape === 'staged') {
        primaryHardness = 'multi_step';
    } else if (hasWorkspaceWriteDeliverable || input.hasManualAction) {
        primaryHardness = 'bounded';
    }
    return {
        primaryHardness,
        requiredCapabilities: Array.from(requiredCapabilities),
        blockingRisk,
        interactionMode,
        executionShape,
        reasons,
    };
}
