import { buildExecutionProfile as buildLegacyExecutionProfile } from '../../../orchestration/workRequestPolicy';
import type {
    ClarificationDecision,
    DeliverableContract,
    ExecutionProfile,
    HitlPolicy,
    NormalizedWorkRequest,
} from '../../../orchestration/workRequestSchema';

export interface AssessRiskResult {
    riskTier: 'low' | 'medium' | 'high';
    executionPolicy: 'auto' | 'review_required' | 'hard_block';
    checkpoints: NonNullable<NormalizedWorkRequest['checkpoints']>;
    userActions: NonNullable<NormalizedWorkRequest['userActionsRequired']>;
    executionProfile: ExecutionProfile;
}

export function buildExecutionProfile(normalized: NormalizedWorkRequest): AssessRiskResult {
    const executionProfile = normalized.executionProfile ?? buildLegacyExecutionProfile({
        mode: normalized.mode,
        clarification: normalized.clarification ?? defaultClarification(),
        deliverables: normalized.deliverables ?? defaultDeliverables(),
        hitlPolicy: normalized.hitlPolicy ?? defaultHitlPolicy(),
        publishIntent: normalized.publishIntent,
        hasManualAction: (normalized.userActionsRequired ?? []).length > 0,
        hasBlockingManualAction: (normalized.userActionsRequired ?? []).some((item) => item.blocking),
        requiresBrowserSkill: false,
        explicitAuthRequired: false,
        hostAccessRequired: false,
        hasPreferredWorkflow: normalized.tasks.some((task) => Boolean(task.preferredWorkflow)),
        isComplexTask: normalized.tasks.length > 1,
        codeChangeTask: normalized.tasks.some((task) => task.preferredTools.includes('apply_patch')),
        selfManagementTask: false,
    });

    const riskTier = deriveRiskTier(normalized.hitlPolicy?.riskTier, executionProfile);

    return {
        riskTier,
        executionPolicy: deriveExecutionPolicy(riskTier, executionProfile),
        checkpoints: normalized.checkpoints ?? [],
        userActions: normalized.userActionsRequired ?? [],
        executionProfile,
    };
}

function deriveRiskTier(hitlRiskTier: HitlPolicy['riskTier'] | undefined, profile: ExecutionProfile): 'low' | 'medium' | 'high' {
    if (hitlRiskTier) {
        return hitlRiskTier;
    }

    if (profile.blockingRisk !== 'none' || profile.primaryHardness === 'high_risk') {
        return 'high';
    }

    if (profile.primaryHardness === 'multi_step' || profile.primaryHardness === 'externally_blocked') {
        return 'medium';
    }

    return 'low';
}

function deriveExecutionPolicy(
    riskTier: 'low' | 'medium' | 'high',
    profile: ExecutionProfile,
): 'auto' | 'review_required' | 'hard_block' {
    if (profile.blockingRisk === 'missing_info' || profile.blockingRisk === 'auth') {
        return 'hard_block';
    }

    if (riskTier === 'high' || profile.requiredCapabilities.includes('human_review')) {
        return 'review_required';
    }

    return 'auto';
}

function defaultClarification(): ClarificationDecision {
    return {
        required: false,
        questions: [],
        missingFields: [],
        canDefault: true,
        assumptions: [],
    };
}

function defaultDeliverables(): DeliverableContract[] {
    return [
        {
            id: 'chat-reply',
            title: 'Chat reply',
            type: 'chat_reply',
            description: 'Provide direct response in chat.',
            required: true,
        },
    ];
}

function defaultHitlPolicy(): HitlPolicy {
    return {
        riskTier: 'low',
        requiresPlanConfirmation: false,
        reasons: [],
    };
}
