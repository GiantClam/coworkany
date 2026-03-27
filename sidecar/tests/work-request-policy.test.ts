import { describe, expect, test } from 'bun:test';
import {
    buildCheckpointsFromExecutionProfile,
    buildExecutionProfile,
    buildUserActionsRequiredFromExecutionProfile,
    deriveActiveHardness,
    deriveBlockingReason,
} from '../src/orchestration/workRequestPolicy';

describe('work request policy resolver', () => {
    test('builds an externally blocked execution profile for auth-gated browser tasks', () => {
        const executionProfile = buildExecutionProfile({
            mode: 'immediate_task',
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            deliverables: [{
                id: 'deliverable-1',
                title: 'Report',
                type: 'report_file',
                description: 'Save report',
                required: true,
                path: 'reports/result.md',
                format: 'md',
            }],
            hitlPolicy: {
                riskTier: 'high',
                requiresPlanConfirmation: false,
                reasons: ['Execution depends on a manual or authentication-gated step.'],
            },
            hasManualAction: true,
            hasBlockingManualAction: true,
            requiresBrowserSkill: true,
            explicitAuthRequired: true,
            hostAccessRequired: false,
            hasPreferredWorkflow: false,
            isComplexTask: true,
            codeChangeTask: false,
            selfManagementTask: false,
        });

        expect(executionProfile).toMatchObject({
            primaryHardness: 'externally_blocked',
            blockingRisk: 'auth',
            interactionMode: 'action_first',
            executionShape: 'staged',
        });
        expect(executionProfile.requiredCapabilities).toEqual(expect.arrayContaining([
            'browser_interaction',
            'external_auth',
            'workspace_write',
            'human_review',
        ]));
    });

    test('derives blocking manual checkpoint and external auth action from execution profile', () => {
        const executionProfile = {
            primaryHardness: 'externally_blocked',
            requiredCapabilities: ['browser_interaction', 'external_auth'] as const,
            blockingRisk: 'auth' as const,
            interactionMode: 'action_first' as const,
            executionShape: 'staged' as const,
            reasons: ['Execution may require a real account/login state.'],
        };
        const checkpoints = buildCheckpointsFromExecutionProfile({
            isComplexTask: true,
            deliverables: [],
            executionProfile,
            hitlPolicy: {
                riskTier: 'high',
                requiresPlanConfirmation: false,
                reasons: [],
            },
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
        });
        const actions = buildUserActionsRequiredFromExecutionProfile({
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            missingInfo: [],
            checkpoints,
            executionProfile,
            hitlPolicy: {
                riskTier: 'high',
                requiresPlanConfirmation: false,
                reasons: [],
            },
            likelyExternalAuth: true,
        });

        expect(checkpoints.some((checkpoint) =>
            checkpoint.kind === 'manual_action' && checkpoint.blocking
        )).toBe(true);
        expect(actions).toEqual([
            expect.objectContaining({
                kind: 'external_auth',
                blocking: true,
                executionPolicy: 'hard_block',
            }),
        ]);
    });

    test('derives runtime active hardness from blocker semantics', () => {
        const executionProfile = {
            primaryHardness: 'multi_step',
            requiredCapabilities: ['workspace_write'] as const,
            blockingRisk: 'manual_step' as const,
            interactionMode: 'action_first' as const,
            executionShape: 'staged' as const,
            reasons: ['Execution is expected to write files or mutate workspace state.'],
        };

        expect(deriveActiveHardness({
            executionProfile,
            userAction: {
                kind: 'manual_step',
                blocking: true,
            },
        })).toBe('externally_blocked');

        expect(deriveActiveHardness({
            executionProfile: {
                ...executionProfile,
                primaryHardness: 'bounded',
                interactionMode: 'review_first',
            },
            checkpoint: {
                kind: 'review',
                blocking: true,
                requiresUserConfirmation: true,
            },
            status: 'idle',
        })).toBe('high_risk');

        expect(deriveActiveHardness({
            executionProfile,
            status: 'running',
        })).toBe('multi_step');
    });

    test('derives explicit blocking reason from current runtime blocker', () => {
        expect(deriveBlockingReason({
            userAction: {
                description: 'Please log in to continue.',
                questions: [],
                instructions: ['Open the auth page.'],
                blocking: true,
            },
            status: 'idle',
        })).toBe('Please log in to continue.');

        expect(deriveBlockingReason({
            clarification: {
                reason: 'Need the target workspace path.',
                questions: ['Which folder should Coworkany use?'],
            },
            status: 'idle',
        })).toBe('Need the target workspace path.');
    });

    test('keeps direct social publish as non-blocking until a concrete blocker appears', () => {
        const executionProfile = buildExecutionProfile({
            mode: 'immediate_task',
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            deliverables: [],
            hitlPolicy: {
                riskTier: 'medium',
                requiresPlanConfirmation: false,
                reasons: ['Execution likely involves browser navigation or UI interaction.'],
            },
            publishIntent: {
                action: 'publish_social_post',
                platform: 'xiaohongshu',
                executionMode: 'direct_publish',
                requiresSideEffect: true,
            },
            hasManualAction: false,
            hasBlockingManualAction: false,
            requiresBrowserSkill: true,
            explicitAuthRequired: true,
            hostAccessRequired: false,
            hasPreferredWorkflow: false,
            isComplexTask: false,
            codeChangeTask: false,
            selfManagementTask: false,
        });
        const checkpoints = buildCheckpointsFromExecutionProfile({
            isComplexTask: false,
            deliverables: [],
            executionProfile,
            hitlPolicy: {
                riskTier: 'medium',
                requiresPlanConfirmation: false,
                reasons: [],
            },
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            publishIntent: {
                action: 'publish_social_post',
                platform: 'xiaohongshu',
                executionMode: 'direct_publish',
                requiresSideEffect: true,
            },
        });
        const actions = buildUserActionsRequiredFromExecutionProfile({
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            missingInfo: [],
            checkpoints,
            executionProfile,
            hitlPolicy: {
                riskTier: 'medium',
                requiresPlanConfirmation: false,
                reasons: [],
            },
            publishIntent: {
                action: 'publish_social_post',
                platform: 'xiaohongshu',
                executionMode: 'direct_publish',
                requiresSideEffect: true,
            },
            likelyExternalAuth: true,
        });

        expect(executionProfile).toMatchObject({
            primaryHardness: 'high_risk',
            blockingRisk: 'none',
            interactionMode: 'passive_status',
            executionShape: 'staged',
        });
        expect(executionProfile.requiredCapabilities).toEqual(expect.arrayContaining([
            'browser_interaction',
            'external_auth',
        ]));
        expect(checkpoints.some((checkpoint) => checkpoint.kind === 'manual_action' && checkpoint.blocking)).toBe(false);
        expect(actions).toEqual([]);
    });
});
