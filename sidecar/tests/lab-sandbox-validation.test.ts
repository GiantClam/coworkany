import { describe, expect, test } from 'bun:test';
import { LabSandbox } from '../src/agent/selfLearning/labSandbox';
import type { ExperimentConfig, ProcessedKnowledge } from '../src/agent/selfLearning/types';

function makeKnowledge(): ProcessedKnowledge {
    return {
        id: 'knowledge-1',
        type: 'procedure',
        title: 'Publish workflow',
        summary: 'Reusable publish workflow',
        detailedContent: 'Do the steps safely.',
        prerequisites: [],
        dependencies: [],
        confidence: 0.95,
        sourceResearch: {
            gap: {
                id: 'gap-1',
                type: 'tool',
                description: 'Need publish flow',
                userQuery: 'publish to target platform',
                detectedAt: '2026-03-28T00:00:00.000Z',
                confidence: 0.9,
                suggestedResearchQueries: [],
                keywords: ['publish'],
            },
            sources: [],
            codeExamples: [],
            dependencies: [],
            researchTimeMs: 10,
            confidence: 0.9,
        },
        createdAt: '2026-03-28T00:00:00.000Z',
    };
}

function makeConfig(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
    return {
        knowledge: makeKnowledge(),
        testCases: [
            {
                id: 'positive',
                name: 'positive example',
                input: 'print(\"success\")',
                expectedBehavior: 'succeeds',
                expectation: 'success',
            },
            {
                id: 'negative',
                name: 'negative example',
                input: 'raise Exception(\"bad\")',
                expectedBehavior: 'rejects unsafe input',
                expectation: 'reject',
            },
        ],
        maxRetries: 1,
        timeoutMs: 1000,
        isolationLevel: 'shared_deps',
        validationPolicy: {
            positivePassRateThreshold: 0.9,
            negativeRejectRateThreshold: 0.95,
            requireNegativeExamples: true,
            requireNoUnauthorizedExternalCalls: true,
            requireReplaySuitability: true,
        },
        sideEffectRisk: 'write_external',
        ...overrides,
    };
}

describe('lab sandbox validation policy', () => {
    test('fails write_external validation when negative examples do not reject correctly', async () => {
        const sandbox = new LabSandbox({
            executeCode: async (code) => ({
                success: true,
                stdout: code.includes('raise Exception') ? 'unexpected success' : 'success',
                stderr: '',
                exitCode: 0,
                executionTimeMs: 5,
            }),
            installDependency: async (pkg) => ({ package: pkg, success: true }),
        });

        const result = await sandbox.runExperiment(makeConfig());

        expect(result.success).toBe(false);
        expect(result.validationSummary.positivePassRate).toBe(1);
        expect(result.validationSummary.negativeRejectRate).toBe(0);
    });

    test('passes validation when positive and negative examples meet thresholds', async () => {
        const sandbox = new LabSandbox({
            executeCode: async (code) => ({
                success: !code.includes('raise Exception'),
                stdout: code.includes('raise Exception') ? '' : 'success',
                stderr: code.includes('raise Exception') ? 'error' : '',
                exitCode: code.includes('raise Exception') ? 1 : 0,
                executionTimeMs: 5,
            }),
            installDependency: async (pkg) => ({ package: pkg, success: true }),
        });

        const result = await sandbox.runExperiment(makeConfig({
            knowledge: {
                ...makeKnowledge(),
                summary: 'Reusable publish workflow with duplicate protection and safe abort support.',
                detailedContent: 'Check whether a draft already exists before publishing, and cancel safely if the editor is not ready.',
                steps: [
                    'open editor',
                    'check for existing draft to avoid duplicate publish',
                    'fill content',
                    'cancel safely if the editor validation fails',
                    'publish',
                ],
            },
        }));

        expect(result.success).toBe(true);
        expect(result.validationSummary.structuralValidationPassed).toBe(true);
        expect(result.validationSummary.positivePassRate).toBe(1);
        expect(result.validationSummary.negativeRejectRate).toBe(1);
    });
});
