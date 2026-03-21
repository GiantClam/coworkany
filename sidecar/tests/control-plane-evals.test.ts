import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    formatControlPlaneEvalSummary,
    loadControlPlaneEvalCases,
    runControlPlaneEvalSuite,
} from '../src/evals/controlPlaneEvalRunner';

function resolveGoldDatasetPath(): string {
    return path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../evals/control-plane/gold.jsonl'
    );
}

describe('control-plane eval runner', () => {
    test('loads the seed gold dataset', () => {
        const datasetPath = resolveGoldDatasetPath();
        const loaded = loadControlPlaneEvalCases([datasetPath]);

        expect(loaded.datasetFiles).toEqual([datasetPath]);
        expect(loaded.cases.length).toBe(8);
        expect(loaded.cases.map((evalCase) => evalCase.id)).toContain('planning-report');
        expect(loaded.cases.map((evalCase) => evalCase.id)).toContain('research-with-stubs');
        expect(loaded.cases.map((evalCase) => evalCase.id)).toContain('runtime-followup-reopen');
        expect(loaded.cases.map((evalCase) => evalCase.id)).toContain('runtime-followup-reopen-log');
    });

    test('replays the gold dataset and reports stage-level metrics', async () => {
        const datasetPath = resolveGoldDatasetPath();
        const summary = await runControlPlaneEvalSuite([datasetPath]);

        expect(summary.totals.totalCases).toBe(8);
        expect(summary.totals.failedCases).toBe(0);
        expect(summary.stages.analyze).toMatchObject({ total: 6, passed: 6, failed: 0 });
        expect(summary.stages.freeze).toMatchObject({ total: 2, passed: 2, failed: 0 });
        expect(summary.stages.plan).toMatchObject({ total: 3, passed: 3, failed: 0 });
        expect(summary.stages.artifact).toMatchObject({ total: 2, passed: 2, failed: 0 });
        expect(summary.stages.runtimeReplay).toMatchObject({ total: 2, passed: 2, failed: 0 });
        expect(summary.metrics.unnecessaryClarificationRate).toBe(0);
        expect(summary.metrics.artifactSatisfactionRate).toBe(0.5);
        expect(summary.metrics.runtimeReplayPassRate).toBe(1);
        expect(summary.coverage.productionReplaySources).toEqual({
            canary: {
                totalCases: 1,
                passedCases: 1,
                failedCases: 0,
                runtimeReplayCases: 1,
                runtimeReplayPassedCases: 1,
            },
        });
        expect(summary.caseResults.find((result) => result.id === 'explicit-path-artifact-missing')?.stages.artifact?.actual).toMatchObject({
            passed: false,
            failedRequirementKinds: ['file'],
        });
        expect(summary.caseResults.find((result) => result.id === 'runtime-followup-reopen')?.stages.runtimeReplay?.actual).toMatchObject({
            reopenTrigger: 'contradictory_evidence',
            planReadySessionFollowUpScope: 'same_task_only',
            planReadyMemoryDefaultWriteScope: 'workspace',
        });
        expect(summary.caseResults.find((result) => result.id === 'runtime-followup-reopen-log')?.stages.runtimeReplay?.actual).toMatchObject({
            source: 'event_log',
            finalStatus: 'idle',
            planReadyTenantWorkspaceBoundaryMode: 'same_workspace_only',
        });

        const rendered = formatControlPlaneEvalSummary(summary);
        expect(rendered).toContain('Control-plane eval summary');
        expect(rendered).toContain('Artifact satisfaction rate: 50.0%');
        expect(rendered).toContain('Runtime replay pass rate: 100.0%');
        expect(rendered).toContain('Production replay coverage:');
        expect(rendered).toContain('canary: 1/1 passed, runtimeReplay 1/1');
    }, 30000);
});
