import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    buildControlPlaneThresholdUpdateSuggestion,
    applyControlPlaneThresholdUpdateSuggestion,
    createDefaultControlPlaneEvalThresholds,
    createDefaultCanaryChecklist,
    evaluateControlPlaneEvalReadiness,
    evaluateSidecarDoctorReadiness,
    evaluateWorkspaceExtensionAllowlistReadiness,
    inspectObservability,
    evaluateCanaryChecklistEvidence,
    loadControlPlaneThresholdUpdateSuggestion,
    loadControlPlaneEvalThresholds,
    recommendProductionReplayThresholds,
    renderReleaseReadinessMarkdown,
    summarizeCanaryChecklistEvidence,
    summarizeControlPlaneEvalSummary,
    summarizeSidecarDoctorReport,
    summarizeProductionReplayImportSummary,
} from '../src/release/readiness';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-release-readiness-'));
}

describe('release readiness helpers', () => {
    test('inspects startup metrics and artifact telemetry summaries', () => {
        const root = makeTempDir();
        const appDataDir = path.join(root, 'app-data');
        const startupDir = path.join(appDataDir, 'startup-metrics');
        const artifactDir = path.join(root, '.coworkany', 'self-learning');
        fs.mkdirSync(startupDir, { recursive: true });
        fs.mkdirSync(artifactDir, { recursive: true });

        fs.writeFileSync(
            path.join(startupDir, 'default.jsonl'),
            `${JSON.stringify({ mark: 'frontend_ready', timestampEpochMs: Date.parse('2026-03-18T10:00:00.000Z') })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(artifactDir, 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({ createdAt: '2026-03-18T10:10:00.000Z', artifactsCreated: ['/tmp/out.md'] })}\n`,
            'utf-8',
        );

        const summary = inspectObservability({
            repositoryRoot: root,
            appDataDir,
            startupProfile: 'default',
        });

        expect(summary.startupMetrics.files).toHaveLength(1);
        expect(summary.startupMetrics.files[0]?.entries).toBe(1);
        expect(summary.startupMetrics.warnings).toHaveLength(0);
        expect(summary.artifactTelemetry.entries).toBe(1);
        expect(summary.artifactTelemetry.warnings).toHaveLength(0);
    });

    test('renders markdown report with checklist and observability warnings', () => {
        const markdown = renderReleaseReadinessMarkdown({
            generatedAt: '2026-03-18T12:00:00.000Z',
            repositoryRoot: '/tmp/repo',
            requestedOptions: {
                buildDesktop: true,
                realE2E: false,
                appDataDir: undefined,
                startupProfile: undefined,
                doctorRequiredStatus: 'degraded',
                controlPlaneThresholdsPath: '/tmp/repo/sidecar/evals/control-plane/readiness-thresholds.json',
                controlPlaneThresholdProfile: 'beta',
                syncProductionReplays: true,
                productionReplayDatasetPath: '/tmp/repo/sidecar/evals/control-plane/production-replay.jsonl',
            },
            stages: [
                {
                    id: 'stage-1',
                    label: 'Example',
                    command: 'npm test',
                    cwd: '/tmp/repo/desktop',
                    durationMs: 1234,
                    status: 'passed',
                    exitCode: 0,
                },
            ],
            productionReplayImport: {
                summaryPath: '/tmp/repo/artifacts/release-readiness/production-replay-import-summary.json',
                exists: true,
                totalCases: 2,
                bySource: {
                    beta: 1,
                    canary: 1,
                },
                insertedCases: 2,
                updatedCases: 0,
                totalDatasetCases: 2,
            },
            productionReplayThresholdRecommendations: [
                {
                    sourceLabel: 'beta',
                    currentMinimum: 0,
                    importedCases: 1,
                    observedDatasetCases: 1,
                    suggestedMinimum: 1,
                },
            ],
            controlPlaneThresholdUpdateSuggestion: {
                path: '/tmp/repo/artifacts/release-readiness/control-plane-threshold-update-suggestion.json',
                suggestion: {
                    sourcePath: '/tmp/repo/sidecar/evals/control-plane/readiness-thresholds.json',
                    profile: 'beta',
                    recommendedMinProductionReplayCasesBySource: {
                        canary: 1,
                        beta: 1,
                    },
                    recommendations: [
                        {
                            sourceLabel: 'beta',
                            currentMinimum: 0,
                            importedCases: 1,
                            observedDatasetCases: 1,
                            suggestedMinimum: 1,
                        },
                    ],
                },
            },
            controlPlaneThresholdCandidateConfig: {
                path: '/tmp/repo/artifacts/release-readiness/control-plane-thresholds.candidate.json',
                baseConfigPath: '/tmp/repo/sidecar/evals/control-plane/readiness-thresholds.json',
            },
            controlPlaneEval: {
                summaryPath: '/tmp/repo/artifacts/release-readiness/control-plane-eval-summary.json',
                exists: true,
                totalCases: 8,
                passedCases: 8,
                failedCases: 0,
                clarificationRate: 0.167,
                unnecessaryClarificationRate: 0,
                freezeExpectationPassRate: 1,
                artifactExpectationPassRate: 1,
                artifactSatisfactionRate: 0.5,
                runtimeReplayPassRate: 1,
                productionReplaySources: {
                    canary: {
                        totalCases: 1,
                        passedCases: 1,
                        failedCases: 0,
                        runtimeReplayCases: 1,
                        runtimeReplayPassedCases: 1,
                    },
                },
            },
            controlPlaneEvalGate: {
                passed: true,
                findings: [],
                thresholds: createDefaultControlPlaneEvalThresholds(),
                thresholdSourcePath: '/tmp/repo/sidecar/evals/control-plane/readiness-thresholds.json',
                thresholdProfile: 'beta',
            },
            sidecarDoctor: {
                reportPath: '/tmp/repo/artifacts/release-readiness/doctor/report.json',
                markdownPath: '/tmp/repo/artifacts/release-readiness/doctor/report.md',
                exists: true,
                overallStatus: 'healthy',
                failedChecks: 0,
                warnedChecks: 0,
                checks: [
                    {
                        id: 'runtime-store',
                        label: 'Runtime store integrity',
                        status: 'pass',
                        summary: 'Runtime store healthy with 2 valid record(s).',
                    },
                ],
                warnings: [],
            },
            sidecarDoctorGate: {
                passed: true,
                requiredOverallStatus: 'healthy',
                findings: [],
            },
            observability: {
                startupMetrics: {
                    inspected: false,
                    files: [],
                    warnings: ['No appDataDir provided; startup metrics inspection skipped.'],
                },
                artifactTelemetry: {
                    path: '/tmp/repo/.coworkany/self-learning/artifact-contract-telemetry.jsonl',
                    exists: false,
                    entries: 0,
                    warnings: ['Artifact telemetry file not found.'],
                },
            },
            checklist: createDefaultCanaryChecklist(),
        });

        expect(markdown).toContain('# Release Readiness Report');
        expect(markdown).toContain('Doctor required status: degraded');
        expect(markdown).toContain('Canary evidence path: not provided');
        expect(markdown).toContain('Require canary evidence: no');
        expect(markdown).toContain('## Control-Plane Eval');
        expect(markdown).toContain('Cases: 8/8 passed');
        expect(markdown).toContain('Runtime replay pass rate: 100.0%');
        expect(markdown).toContain('readiness-thresholds.json');
        expect(markdown).toContain('Threshold profile: beta');
        expect(markdown).toContain('Production replay coverage (canary): 1/1 passed, runtimeReplay 1/1');
        expect(markdown).toContain('## Production Replay Import');
        expect(markdown).toContain('Cases imported: 2');
        expect(markdown).toContain('Source beta: 1');
        expect(markdown).toContain('Production replay dataset: /tmp/repo/sidecar/evals/control-plane/production-replay.jsonl');
        expect(markdown).toContain('## Production Replay Threshold Recommendations');
        expect(markdown).toContain('Source beta: current minimum 0, imported 1, observed dataset 1, suggested new minimum 1');
        expect(markdown).toContain('## Control-Plane Threshold Update Suggestion');
        expect(markdown).toContain('control-plane-threshold-update-suggestion.json');
        expect(markdown).toContain('Suggested min production replay cases (beta): 1');
        expect(markdown).toContain('## Control-Plane Threshold Candidate Config');
        expect(markdown).toContain('control-plane-thresholds.candidate.json');
        expect(markdown).toContain('## Sidecar Doctor');
        expect(markdown).toContain('Overall status: healthy');
        expect(markdown).toContain('Required overall status: healthy');
        expect(markdown).toContain('## Canary Checklist');
        expect(markdown).toContain('Observability');
        expect(markdown).toContain('No appDataDir provided');
    });

    test('summarizes control-plane eval metrics from json output', () => {
        const root = makeTempDir();
        const summaryPath = path.join(root, 'control-plane-eval-summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify({
            totals: {
                totalCases: 8,
                passedCases: 8,
                failedCases: 0,
            },
            metrics: {
                clarificationRate: 0.167,
                unnecessaryClarificationRate: 0,
                contractFreezeExpectationPassRate: 1,
                artifactExpectationPassRate: 1,
                artifactSatisfactionRate: 0.5,
                runtimeReplayPassRate: 1,
            },
            coverage: {
                productionReplaySources: {
                    canary: {
                        totalCases: 1,
                        passedCases: 1,
                        failedCases: 0,
                        runtimeReplayCases: 1,
                        runtimeReplayPassedCases: 1,
                    },
                },
            },
        }, null, 2), 'utf-8');

        const summary = summarizeControlPlaneEvalSummary(summaryPath);
        expect(summary).toMatchObject({
            exists: true,
            totalCases: 8,
            passedCases: 8,
            failedCases: 0,
            runtimeReplayPassRate: 1,
            productionReplaySources: {
                canary: {
                    totalCases: 1,
                    passedCases: 1,
                    failedCases: 0,
                    runtimeReplayCases: 1,
                    runtimeReplayPassedCases: 1,
                },
            },
        });
    });

    test('summarizes production replay import metrics from json output', () => {
        const root = makeTempDir();
        const summaryPath = path.join(root, 'production-replay-import-summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify({
            totalCases: 2,
            bySource: {
                beta: 1,
                canary: 1,
            },
            insertedCases: 2,
            updatedCases: 0,
            totalDatasetCases: 2,
        }, null, 2), 'utf-8');

        const summary = summarizeProductionReplayImportSummary(summaryPath);
        expect(summary).toEqual({
            summaryPath,
            exists: true,
            totalCases: 2,
            bySource: {
                beta: 1,
                canary: 1,
            },
            insertedCases: 2,
            updatedCases: 0,
            totalDatasetCases: 2,
        });
    });

    test('summarizes sidecar doctor report and evaluates readiness gate', () => {
        const root = makeTempDir();
        const reportPath = path.join(root, 'doctor-report.json');
        fs.writeFileSync(reportPath, JSON.stringify({
            overallStatus: 'degraded',
            checks: [
                {
                    id: 'extension-governance',
                    label: 'Extension governance posture',
                    status: 'warn',
                    summary: 'Detected 1 extension pending governance review.',
                },
                {
                    id: 'runtime-store',
                    label: 'Runtime store integrity',
                    status: 'pass',
                    summary: 'Runtime store healthy.',
                },
            ],
        }, null, 2), 'utf-8');

        const summary = summarizeSidecarDoctorReport(reportPath);
        expect(summary).toMatchObject({
            exists: true,
            overallStatus: 'degraded',
            failedChecks: 0,
            warnedChecks: 1,
        });
        expect(summary.checks).toHaveLength(2);

        const strictGate = evaluateSidecarDoctorReadiness(summary, 'healthy');
        expect(strictGate.passed).toBe(false);
        expect(strictGate.findings.some((finding) => finding.includes('below required'))).toBe(true);

        const relaxedGate = evaluateSidecarDoctorReadiness(summary, 'degraded');
        expect(relaxedGate.passed).toBe(true);
        expect(relaxedGate.findings).toHaveLength(0);
    });

    test('passes allowlist gate when no third-party extensions are enabled', () => {
        const gate = evaluateWorkspaceExtensionAllowlistReadiness({
            mode: 'off',
            allowedSkills: [],
            allowedToolpacks: [],
            enabledSkills: [],
            enabledToolpacks: [],
        });

        expect(gate.passed).toBe(true);
        expect(gate.findings).toHaveLength(0);
        expect(gate.summary).toContain('No enabled third-party extensions detected');
    });

    test('fails allowlist gate when enabled third-party extensions are not enforce-allowlisted', () => {
        const gate = evaluateWorkspaceExtensionAllowlistReadiness({
            mode: 'off',
            allowedSkills: [],
            allowedToolpacks: [],
            enabledSkills: ['custom-skill'],
            enabledToolpacks: ['custom-toolpack'],
        });

        expect(gate.passed).toBe(false);
        expect(gate.findings.some((finding) => finding.includes('mode must be "enforce"'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('custom-skill'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('custom-toolpack'))).toBe(true);
    });

    test('summarizes canary checklist evidence and enforces required gate', () => {
        const root = makeTempDir();
        const evidencePath = path.join(root, 'canary-evidence.json');
        fs.writeFileSync(
            evidencePath,
            JSON.stringify({
                items: [
                    { area: 'Audience', completed: true, evidence: 'named-testers.md#L1' },
                    { area: 'Rollback', completed: false, evidence: '' },
                ],
            }, null, 2),
            'utf-8',
        );

        const checklist = createDefaultCanaryChecklist();
        const summary = summarizeCanaryChecklistEvidence({
            checklist,
            evidencePath,
        });
        expect(summary.exists).toBe(true);
        expect(summary.completedAreas).toContain('Audience');
        expect(summary.missingAreas).toContain('Rollback');

        const requiredGate = evaluateCanaryChecklistEvidence(summary, true);
        expect(requiredGate.passed).toBe(false);
        expect(requiredGate.findings.some((finding) => finding.includes('missing for area'))).toBe(true);

        const optionalGate = evaluateCanaryChecklistEvidence(summary, false);
        expect(optionalGate.passed).toBe(true);
    });

    test('recommends raising new per-source replay minimums only for newly evidenced sources', () => {
        const recommendations = recommendProductionReplayThresholds({
            summaryPath: '/tmp/import-summary.json',
            exists: true,
            totalCases: 3,
            bySource: {
                beta: 2,
                canary: 1,
            },
            insertedCases: 3,
            updatedCases: 0,
            totalDatasetCases: 3,
        }, {
            summaryPath: '/tmp/eval-summary.json',
            exists: true,
            totalCases: 10,
            passedCases: 10,
            failedCases: 0,
            runtimeReplayPassRate: 1,
            productionReplaySources: {
                beta: {
                    totalCases: 2,
                    passedCases: 2,
                    failedCases: 0,
                    runtimeReplayCases: 2,
                    runtimeReplayPassedCases: 2,
                },
                canary: {
                    totalCases: 1,
                    passedCases: 1,
                    failedCases: 0,
                    runtimeReplayCases: 1,
                    runtimeReplayPassedCases: 1,
                },
            },
        }, {
            passed: true,
            findings: [],
            thresholds: {
                ...createDefaultControlPlaneEvalThresholds(),
                minProductionReplayCasesBySource: {
                    canary: 1,
                },
            },
            thresholdSourcePath: '/tmp/readiness-thresholds.json',
            thresholdProfile: 'beta',
        });

        expect(recommendations).toEqual([
            {
                sourceLabel: 'beta',
                currentMinimum: 0,
                importedCases: 2,
                observedDatasetCases: 2,
                suggestedMinimum: 2,
            },
        ]);
    });

    test('builds a threshold update suggestion artifact from replay recommendations', () => {
        const suggestion = buildControlPlaneThresholdUpdateSuggestion({
            passed: true,
            findings: [],
            thresholds: {
                ...createDefaultControlPlaneEvalThresholds(),
                minProductionReplayCasesBySource: {
                    canary: 1,
                },
            },
            thresholdSourcePath: '/tmp/readiness-thresholds.json',
            thresholdProfile: 'beta',
        }, [
            {
                sourceLabel: 'beta',
                currentMinimum: 0,
                importedCases: 2,
                observedDatasetCases: 2,
                suggestedMinimum: 2,
            },
        ]);

        expect(suggestion).toEqual({
            sourcePath: '/tmp/readiness-thresholds.json',
            profile: 'beta',
            recommendedMinProductionReplayCasesBySource: {
                canary: 1,
                beta: 2,
            },
            recommendations: [
                {
                    sourceLabel: 'beta',
                    currentMinimum: 0,
                    importedCases: 2,
                    observedDatasetCases: 2,
                    suggestedMinimum: 2,
                },
            ],
        });
    });

    test('loads a threshold update suggestion artifact from json', () => {
        const root = makeTempDir();
        const suggestionPath = path.join(root, 'control-plane-threshold-update-suggestion.json');
        fs.writeFileSync(suggestionPath, JSON.stringify({
            sourcePath: '/tmp/readiness-thresholds.json',
            profile: 'beta',
            recommendedMinProductionReplayCasesBySource: {
                canary: 1,
                beta: 2,
            },
            recommendations: [
                {
                    sourceLabel: 'beta',
                    currentMinimum: 0,
                    importedCases: 2,
                    observedDatasetCases: 2,
                    suggestedMinimum: 2,
                },
            ],
        }, null, 2), 'utf-8');

        expect(loadControlPlaneThresholdUpdateSuggestion(suggestionPath)).toEqual({
            sourcePath: '/tmp/readiness-thresholds.json',
            profile: 'beta',
            recommendedMinProductionReplayCasesBySource: {
                canary: 1,
                beta: 2,
            },
            recommendations: [
                {
                    sourceLabel: 'beta',
                    currentMinimum: 0,
                    importedCases: 2,
                    observedDatasetCases: 2,
                    suggestedMinimum: 2,
                },
            ],
        });
    });

    test('applies a threshold update suggestion to a multi-profile config', () => {
        const updated = applyControlPlaneThresholdUpdateSuggestion({
            defaultProfile: 'beta',
            profiles: {
                canary: {
                    maxUnnecessaryClarificationRate: 0.1,
                    minRuntimeReplayPassRate: 0.95,
                    minProductionReplayCasesBySource: {
                        canary: 1,
                    },
                },
                beta: {
                    maxUnnecessaryClarificationRate: 0.05,
                    minRuntimeReplayPassRate: 1,
                    minProductionReplayCasesBySource: {
                        canary: 1,
                    },
                },
            },
        }, {
            sourcePath: '/tmp/readiness-thresholds.json',
            profile: 'beta',
            recommendedMinProductionReplayCasesBySource: {
                canary: 1,
                beta: 2,
            },
            recommendations: [
                {
                    sourceLabel: 'beta',
                    currentMinimum: 0,
                    importedCases: 2,
                    observedDatasetCases: 2,
                    suggestedMinimum: 2,
                },
            ],
        });

        expect(updated).toEqual({
            defaultProfile: 'beta',
            profiles: {
                canary: {
                    maxUnnecessaryClarificationRate: 0.1,
                    minRuntimeReplayPassRate: 0.95,
                    minProductionReplayCasesBySource: {
                        canary: 1,
                    },
                },
                beta: {
                    maxUnnecessaryClarificationRate: 0.05,
                    minRuntimeReplayPassRate: 1,
                    minProductionReplayCasesBySource: {
                        canary: 1,
                        beta: 2,
                    },
                },
            },
        });
    });

    test('fails control-plane eval gate when thresholds are violated', () => {
        const gate = evaluateControlPlaneEvalReadiness({
            summaryPath: '/tmp/summary.json',
            exists: true,
            totalCases: 8,
            passedCases: 7,
            failedCases: 1,
            clarificationRate: 0.2,
            unnecessaryClarificationRate: 0.2,
            freezeExpectationPassRate: 0.9,
            artifactExpectationPassRate: 1,
            artifactSatisfactionRate: 0.5,
            runtimeReplayPassRate: 0.5,
            productionReplaySources: {},
        }, {
            ...createDefaultControlPlaneEvalThresholds(),
            minProductionReplayCasesBySource: {
                canary: 1,
            },
        });

        expect(gate.passed).toBe(false);
        expect(gate.findings.some((finding) => finding.includes('failed case'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('Unnecessary clarification rate'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('Freeze expectation pass rate'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('Runtime replay pass rate'))).toBe(true);
        expect(gate.findings.some((finding) => finding.includes('Production replay coverage'))).toBe(true);
    });

    test('loads control-plane eval thresholds from json config and merges defaults', () => {
        const root = makeTempDir();
        const thresholdsPath = path.join(root, 'readiness-thresholds.json');
        fs.writeFileSync(thresholdsPath, JSON.stringify({
            maxUnnecessaryClarificationRate: 0.02,
            minRuntimeReplayPassRate: 0.95,
        }, null, 2), 'utf-8');

        const loaded = loadControlPlaneEvalThresholds(thresholdsPath);

        expect(loaded.sourcePath).toBe(thresholdsPath);
        expect(loaded.profile).toBe('default');
        expect(loaded.availableProfiles).toEqual(['default']);
        expect(loaded.thresholds).toEqual({
            maxUnnecessaryClarificationRate: 0.02,
            minFreezeExpectationPassRate: 1,
            minArtifactExpectationPassRate: 1,
            minRuntimeReplayPassRate: 0.95,
            requireZeroFailedCases: true,
            minProductionReplayCasesBySource: {},
        });
    });

    test('loads named control-plane threshold profile from multi-profile config', () => {
        const root = makeTempDir();
        const thresholdsPath = path.join(root, 'readiness-thresholds.json');
        fs.writeFileSync(thresholdsPath, JSON.stringify({
            defaultProfile: 'beta',
            profiles: {
                canary: {
                    maxUnnecessaryClarificationRate: 0.1,
                    minRuntimeReplayPassRate: 0.9,
                    minProductionReplayCasesBySource: {
                        canary: 2,
                    },
                },
                beta: {
                    maxUnnecessaryClarificationRate: 0.05,
                    minRuntimeReplayPassRate: 1,
                },
                ga: {
                    maxUnnecessaryClarificationRate: 0.02,
                    minRuntimeReplayPassRate: 1,
                },
            },
        }, null, 2), 'utf-8');

        const loaded = loadControlPlaneEvalThresholds(thresholdsPath, 'canary');

        expect(loaded.sourcePath).toBe(thresholdsPath);
        expect(loaded.profile).toBe('canary');
        expect(loaded.availableProfiles).toEqual(['beta', 'canary', 'ga']);
        expect(loaded.thresholds).toEqual({
            maxUnnecessaryClarificationRate: 0.1,
            minFreezeExpectationPassRate: 1,
            minArtifactExpectationPassRate: 1,
            minRuntimeReplayPassRate: 0.9,
            requireZeroFailedCases: true,
            minProductionReplayCasesBySource: {
                canary: 2,
            },
        });
    });
});
