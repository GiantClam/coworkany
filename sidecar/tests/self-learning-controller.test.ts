import { describe, expect, test } from 'bun:test';
import {
    SelfLearningController,
    type CapabilityAcquisitionProgress,
    type SelfLearningControllerDependencies,
} from '../src/agent/selfLearning/controller';
import type {
    CapabilityGap,
    ExperimentConfig,
    LearningOutcome,
    ResearchResult,
} from '../src/agent/selfLearning/types';

function makeGap(): CapabilityGap {
    return {
        id: 'gap-1',
        type: 'tool',
        description: 'Missing publish workflow',
        userQuery: 'Publish this to WeChat Official Account',
        detectedAt: '2026-03-28T00:00:00.000Z',
        confidence: 0.92,
        suggestedResearchQueries: ['wechat official publish api'],
        keywords: ['wechat official publish'],
    };
}

function makeResearchResult(gap: CapabilityGap): ResearchResult {
    return {
        gap,
        sources: [
            {
                url: 'https://example.com/docs',
                title: 'Docs',
                sourceType: 'official_docs',
                contentSnippet: 'publish flow',
                reliability: 0.9,
                fetchedAt: '2026-03-28T00:00:00.000Z',
            },
        ],
        synthesizedKnowledge: 'Use publish workflow.',
        codeExamples: [],
        dependencies: [],
        researchTimeMs: 100,
        confidence: 0.88,
    };
}

function makeLearningOutcome(research: ResearchResult): LearningOutcome {
    return {
        knowledge: [
            {
                id: 'knowledge-1',
                type: 'procedure',
                title: 'WeChat Publish Workflow',
                summary: 'Generated procedure',
                detailedContent: 'Do the steps',
                prerequisites: [],
                steps: ['Open publish page', 'Fill content', 'Submit'],
                dependencies: [],
                confidence: 0.91,
                sourceResearch: research,
                createdAt: '2026-03-28T00:00:00.000Z',
            },
        ],
        canGenerateSkill: true,
        suggestedSkillName: 'wechat-publish',
        validationRequired: true,
        estimatedTestCases: [],
    };
}

function makeDeps(overrides: Partial<SelfLearningControllerDependencies> = {}): SelfLearningControllerDependencies {
    const gap = makeGap();
    const research = makeResearchResult(gap);
    const outcome = makeLearningOutcome(research);

    return {
        gapDetector: {
            detectGaps: async () => ({
                hasGap: true,
                gaps: [gap],
                canProceedWithPartialKnowledge: false,
                recommendedAction: 'learn',
            }),
            analyzeFailure: async () => [gap],
        } as any,
        researchEngine: {
            research: async () => research,
        } as any,
        learningProcessor: {
            process: async () => outcome,
        } as any,
        labSandbox: {
            generateBasicTestCases: () => [],
            createExperimentConfig: () => ({}) as ExperimentConfig,
            runExperiment: async () => ({
                success: true,
                testResults: [],
                installedDependencies: [],
                discoveredIssues: [],
                refinements: [],
                executionTimeMs: 25,
                retryCount: 0,
                validationSummary: {
                    structuralValidationPassed: true,
                    noUnauthorizedExternalCalls: true,
                    positivePassRate: 1,
                    negativeRejectRate: 1,
                    hasNegativeExamples: true,
                    replaySuitability: {
                        deterministicEnough: true,
                        duplicateRiskHandled: true,
                        rollbackOrSafeAbortDefined: true,
                    },
                },
            }),
        } as any,
        precipitator: {
            precipitate: async () => ({
                success: true,
                type: 'skill_auto',
                path: '/tmp/skills/wechat-publish',
                entityId: 'skill-wechat-publish',
            }),
        } as any,
        reuseEngine: {
            findReusable: async () => ({
                shouldUseExisting: false,
                matchedSkills: [],
                matchedKnowledge: [],
                recommendation: 'learn_new',
                confidence: 0.2,
            }),
            getStatistics: () => ({ totalQueries: 0 }),
        } as any,
        confidenceTracker: {
            initRecord: () => undefined,
        } as any,
        ...overrides,
    };
}

describe('self-learning controller capability acquisition', () => {
    test('reports stable acquisition phases while learning a new capability', async () => {
        const controller = new SelfLearningController(makeDeps(), {
            minConfidenceToAutoUse: 0.8,
        });
        const progress: CapabilityAcquisitionProgress[] = [];

        const result = await controller.acquireCapabilityForTask({
            query: 'Publish this to WeChat Official Account',
            maxRounds: 1,
            maxValidationAttempts: 2,
            sideEffectRisk: 'read_only',
            onProgress: (event) => {
                progress.push(event);
            },
        });

        expect(result.outcome).toBe('learned');
        expect(progress.map((event) => event.phase)).toEqual([
            'checking_existing_capabilities',
            'checking_existing_capabilities',
            'researching_capability',
            'generating_capability',
            'validating_capability',
            'saving_capability',
        ]);
        expect(progress.at(-1)?.summary).toContain('Saving the validated capability');
    });

    test('returns review_required for external-write capability after validation succeeds', async () => {
        const controller = new SelfLearningController(makeDeps(), {
            minConfidenceToAutoUse: 0.8,
        });

        const result = await controller.acquireCapabilityForTask({
            query: 'Publish this to WeChat Official Account',
            maxRounds: 1,
            maxValidationAttempts: 2,
            sideEffectRisk: 'write_external',
        });

        expect(result).toMatchObject({
            outcome: 'review_required',
            summary: 'Generated external-write capability is ready for review before live use.',
        });
    });
});
