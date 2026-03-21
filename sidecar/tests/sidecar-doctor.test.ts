import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatSidecarDoctorReport, runSidecarDoctor } from '../src/doctor/sidecarDoctor';

function makeTempRepo(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-sidecar-doctor-'));
}

describe('sidecar doctor', () => {
    test('reports a healthy environment when runtime, readiness, and observability are clean', () => {
        const root = makeTempRepo();
        const appDataDir = path.join(root, '.coworkany');
        const startupDir = path.join(appDataDir, 'startup-metrics');
        const telemetryDir = path.join(root, '.coworkany', 'self-learning');
        const readinessDir = path.join(root, 'artifacts', 'release-readiness');
        const extensionGovernancePath = path.join(appDataDir, 'extension-governance.json');
        const thresholdsPath = path.join(root, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json');
        const incidentDir = path.join(root, 'sidecar', 'evals', 'control-plane', 'import-sources', 'canary');
        fs.mkdirSync(startupDir, { recursive: true });
        fs.mkdirSync(telemetryDir, { recursive: true });
        fs.mkdirSync(readinessDir, { recursive: true });
        fs.mkdirSync(incidentDir, { recursive: true });
        fs.mkdirSync(path.dirname(thresholdsPath), { recursive: true });
        fs.mkdirSync(path.join(root, 'sidecar', 'src', 'agent'), { recursive: true });

        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'main.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'reactLoop.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'autonomousAgent.ts'), 'export {};\n', 'utf-8');

        fs.writeFileSync(
            path.join(appDataDir, 'task-runtime.json'),
            JSON.stringify([
                {
                    taskId: 'finished-1',
                    title: 'Finished task',
                    workspacePath: '/tmp/workspace',
                    createdAt: '2026-03-21T06:00:00.000Z',
                    updatedAt: '2026-03-21T06:05:00.000Z',
                    status: 'finished',
                    conversation: [],
                    config: {
                        workspacePath: '/tmp/workspace',
                        sessionIsolationPolicy: {
                            workspaceBindingMode: 'frozen_workspace_only',
                            followUpScope: 'same_task_only',
                            allowWorkspaceOverride: false,
                            supersededContractHandling: 'tombstone_prior_contracts',
                            staleEvidenceHandling: 'evict_on_refreeze',
                            notes: [],
                        },
                        memoryIsolationPolicy: {
                            classificationMode: 'scope_tagged',
                            readScopes: ['task', 'workspace', 'user_preference'],
                            writeScopes: ['task', 'workspace'],
                            defaultWriteScope: 'workspace',
                            notes: [],
                        },
                        tenantIsolationPolicy: {
                            workspaceBoundaryMode: 'same_workspace_only',
                            userBoundaryMode: 'current_local_user_only',
                            allowCrossWorkspaceMemory: false,
                            allowCrossWorkspaceFollowUp: false,
                            allowCrossUserMemory: false,
                            notes: [],
                        },
                    },
                    historyLimit: 20,
                    artifactsCreated: ['/tmp/out.md'],
                },
            ], null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            extensionGovernancePath,
            JSON.stringify({
                version: 1,
                states: {},
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(startupDir, 'default.jsonl'),
            `${JSON.stringify({ mark: 'frontend_ready', timestampEpochMs: Date.parse('2026-03-21T06:00:00.000Z') })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(telemetryDir, 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({ createdAt: '2026-03-21T06:06:00.000Z', artifactsCreated: ['/tmp/out.md'] })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(incidentDir, 'clean-runtime.jsonl'),
            `${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000001',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T06:00:00.000Z',
                sequence: 1,
                type: 'TASK_STATUS',
                payload: { status: 'running' },
            })}\n${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000002',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T06:00:01.000Z',
                sequence: 2,
                type: 'TASK_STATUS',
                payload: { status: 'idle' },
            })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            thresholdsPath,
            JSON.stringify({
                defaultProfile: 'beta',
                profiles: {
                    beta: {
                        maxUnnecessaryClarificationRate: 0.05,
                        minFreezeExpectationPassRate: 1,
                        minArtifactExpectationPassRate: 1,
                        minRuntimeReplayPassRate: 1,
                        requireZeroFailedCases: true,
                        minProductionReplayCasesBySource: {
                            canary: 1,
                        },
                    },
                },
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(readinessDir, 'report.json'),
            JSON.stringify({
                stages: [
                    {
                        id: 'control-plane-eval',
                        label: 'Control-plane eval suite',
                        status: 'passed',
                        durationMs: 10,
                        exitCode: 0,
                        command: 'bun run eval:control-plane',
                        cwd: root,
                    },
                ],
                controlPlaneEval: {
                    passedCases: 8,
                    totalCases: 8,
                },
                controlPlaneEvalGate: {
                    passed: true,
                    findings: [],
                },
                productionReplayThresholdRecommendations: [],
            }, null, 2),
            'utf-8',
        );

        const report = runSidecarDoctor({
            repositoryRoot: root,
            appDataDir,
            readinessReportPath: path.join(readinessDir, 'report.json'),
            controlPlaneThresholdsPath: thresholdsPath,
            controlPlaneThresholdProfile: 'beta',
            now: new Date('2026-03-21T06:10:00.000Z'),
        });

        expect(report.overallStatus).toBe('healthy');
        expect(report.checks.map((check) => check.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
        expect(formatSidecarDoctorReport(report)).toContain('Overall: healthy');
    });

    test('reports blocked when runtime store is stale and readiness is failing', () => {
        const root = makeTempRepo();
        const appDataDir = path.join(root, '.coworkany');
        const readinessDir = path.join(root, 'artifacts', 'release-readiness');
        const thresholdsPath = path.join(root, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json');
        const incidentDir = path.join(root, 'incidents');
        fs.mkdirSync(appDataDir, { recursive: true });
        fs.mkdirSync(readinessDir, { recursive: true });
        fs.mkdirSync(incidentDir, { recursive: true });
        fs.mkdirSync(path.dirname(thresholdsPath), { recursive: true });
        fs.mkdirSync(path.join(root, 'sidecar', 'src', 'agent'), { recursive: true });

        fs.writeFileSync(
            path.join(root, 'sidecar', 'src', 'main.ts'),
            'async function getRelevantMemoryContext(userQuery: string) { return userQuery; }\n',
            'utf-8',
        );
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'reactLoop.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'autonomousAgent.ts'), 'export {};\n', 'utf-8');

        fs.writeFileSync(
            path.join(appDataDir, 'task-runtime.json'),
            JSON.stringify([
                {
                    taskId: 'running-stale',
                    title: 'Running task',
                    workspacePath: '/tmp/workspace',
                    createdAt: '2026-03-21T04:00:00.000Z',
                    updatedAt: '2026-03-21T04:05:00.000Z',
                    status: 'running',
                    conversation: [],
                    historyLimit: 20,
                    artifactsCreated: [],
                },
            ], null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            thresholdsPath,
            JSON.stringify({
                defaultProfile: 'beta',
                profiles: {
                    beta: {
                        maxUnnecessaryClarificationRate: 0.05,
                        minRuntimeReplayPassRate: 1,
                        minProductionReplayCasesBySource: {
                            canary: 1,
                        },
                    },
                },
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(readinessDir, 'report.json'),
            JSON.stringify({
                stages: [
                    {
                        id: 'control-plane-eval',
                        label: 'Control-plane eval suite',
                        status: 'failed',
                        durationMs: 10,
                        exitCode: 1,
                        command: 'bun run eval:control-plane',
                        cwd: root,
                    },
                ],
                controlPlaneEval: {
                    passedCases: 7,
                    totalCases: 8,
                },
                controlPlaneEvalGate: {
                    passed: false,
                    findings: ['Runtime replay pass rate 50.0% is below threshold 100.0%.'],
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
                controlPlaneThresholdCandidateConfig: {
                    path: '/tmp/control-plane-thresholds.candidate.json',
                },
            }, null, 2),
            'utf-8',
        );
        fs.mkdirSync(path.join(root, '.coworkany', 'self-learning'), { recursive: true });
        fs.writeFileSync(
            path.join(root, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({
                timestamp: '2026-03-21T06:00:00.000Z',
                query: 'Generate pptx deck',
                passed: false,
                requirementResults: [
                    { requirementId: 'file-pptx', kind: 'file', strictness: 'hard', passed: false, reason: 'missing pptx' },
                ],
                evidenceSummary: { filesCount: 1, toolsUsedCount: 1, outputChars: 10 },
            })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(incidentDir, 'anomalous-runtime.jsonl'),
            `${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000011',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T05:00:00.000Z',
                sequence: 1,
                type: 'TASK_CONTRACT_REOPENED',
                payload: { summary: 'reopen 1', reason: 'first reopen', trigger: 'contradictory_evidence' },
            })}\n${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000012',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T05:01:00.000Z',
                sequence: 2,
                type: 'TASK_CONTRACT_REOPENED',
                payload: { summary: 'reopen 2', reason: 'second reopen', trigger: 'contradictory_evidence' },
            })}\n${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000013',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T05:02:00.000Z',
                sequence: 3,
                type: 'TASK_CLARIFICATION_REQUIRED',
                payload: { questions: ['q1'] },
            })}\n${JSON.stringify({
                id: '10000000-0000-4000-8000-000000000014',
                taskId: '11111111-1111-4111-8111-111111111111',
                timestamp: '2026-03-21T05:03:00.000Z',
                sequence: 4,
                type: 'TASK_CLARIFICATION_REQUIRED',
                payload: { questions: ['q2'] },
            })}\n`,
            'utf-8',
        );

        const report = runSidecarDoctor({
            repositoryRoot: root,
            appDataDir,
            readinessReportPath: path.join(readinessDir, 'report.json'),
            controlPlaneThresholdsPath: thresholdsPath,
            controlPlaneThresholdProfile: 'beta',
            incidentLogPaths: [incidentDir],
            now: new Date('2026-03-21T06:10:00.000Z'),
            staleRunningThresholdMs: 5 * 60 * 1000,
        });

        expect(report.overallStatus).toBe('blocked');
        expect(report.checks.find((check) => check.id === 'runtime-store')?.status).toBe('fail');
        expect(report.checks.find((check) => check.id === 'memory-source-guards')?.status).toBe('fail');
        expect(report.checks.find((check) => check.id === 'control-plane-readiness')?.status).toBe('fail');
        expect(report.checks.find((check) => check.id === 'anomaly-signals')?.status).toBe('warn');
        expect(formatSidecarDoctorReport(report)).toContain('stale running task');
        expect(formatSidecarDoctorReport(report)).toContain('global memory access anti-pattern');
        expect(formatSidecarDoctorReport(report)).toContain('Failed stages: control-plane-eval');
        expect(formatSidecarDoctorReport(report)).toContain('Repeated reopen anomalies');
        expect(formatSidecarDoctorReport(report)).toContain('Artifact degradation signals: 1');
    });

    test('fails guarded sources when autonomous subtask execution synthesizes task ids', () => {
        const root = makeTempRepo();
        const appDataDir = path.join(root, '.coworkany');
        const readinessDir = path.join(root, 'artifacts', 'release-readiness');
        const thresholdsPath = path.join(root, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json');
        fs.mkdirSync(appDataDir, { recursive: true });
        fs.mkdirSync(readinessDir, { recursive: true });
        fs.mkdirSync(path.dirname(thresholdsPath), { recursive: true });
        fs.mkdirSync(path.join(root, 'sidecar', 'src', 'agent'), { recursive: true });

        fs.writeFileSync(
            path.join(appDataDir, 'task-runtime.json'),
            JSON.stringify([
                {
                    taskId: 'finished-1',
                    title: 'Finished task',
                    workspacePath: '/tmp/workspace',
                    createdAt: '2026-03-21T06:00:00.000Z',
                    updatedAt: '2026-03-21T06:05:00.000Z',
                    status: 'finished',
                    conversation: [],
                    config: {
                        workspacePath: '/tmp/workspace',
                        sessionIsolationPolicy: {
                            workspaceBindingMode: 'frozen_workspace_only',
                            followUpScope: 'same_task_only',
                            allowWorkspaceOverride: false,
                            supersededContractHandling: 'tombstone_prior_contracts',
                            staleEvidenceHandling: 'evict_on_refreeze',
                            notes: [],
                        },
                        memoryIsolationPolicy: {
                            classificationMode: 'scope_tagged',
                            readScopes: ['task', 'workspace', 'user_preference'],
                            writeScopes: ['task', 'workspace'],
                            defaultWriteScope: 'workspace',
                            notes: [],
                        },
                        tenantIsolationPolicy: {
                            workspaceBoundaryMode: 'same_workspace_only',
                            userBoundaryMode: 'current_local_user_only',
                            allowCrossWorkspaceMemory: false,
                            allowCrossWorkspaceFollowUp: false,
                            allowCrossUserMemory: false,
                            notes: [],
                        },
                    },
                    historyLimit: 20,
                    artifactsCreated: [],
                },
            ], null, 2),
            'utf-8',
        );

        fs.writeFileSync(
            path.join(readinessDir, 'report.json'),
            JSON.stringify({
                stages: [
                    {
                        id: 'control-plane-eval',
                        label: 'Control-plane eval suite',
                        status: 'passed',
                        durationMs: 10,
                        exitCode: 0,
                        command: 'bun run eval:control-plane',
                        cwd: root,
                    },
                ],
                controlPlaneEval: {
                    passedCases: 8,
                    totalCases: 8,
                },
                controlPlaneEvalGate: {
                    passed: true,
                    findings: [],
                },
                productionReplayThresholdRecommendations: [],
            }, null, 2),
            'utf-8',
        );

        fs.writeFileSync(
            thresholdsPath,
            JSON.stringify({
                defaultProfile: 'beta',
                profiles: {
                    beta: {
                        maxUnnecessaryClarificationRate: 0.05,
                        minFreezeExpectationPassRate: 1,
                        minArtifactExpectationPassRate: 1,
                        minRuntimeReplayPassRate: 1,
                        requireZeroFailedCases: true,
                    },
                },
            }, null, 2),
            'utf-8',
        );

        fs.writeFileSync(
            path.join(root, 'sidecar', 'src', 'main.ts'),
            'const taskId = `subtask_${subtask.id}`;\n',
            'utf-8',
        );
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'reactLoop.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'autonomousAgent.ts'), 'export {};\n', 'utf-8');
        fs.mkdirSync(path.join(root, '.coworkany', 'startup-metrics'), { recursive: true });
        fs.writeFileSync(
            path.join(root, '.coworkany', 'startup-metrics', 'default.jsonl'),
            `${JSON.stringify({ mark: 'frontend_ready', timestampEpochMs: Date.parse('2026-03-21T06:00:00.000Z') })}\n`,
            'utf-8',
        );
        fs.mkdirSync(path.join(root, '.coworkany', 'self-learning'), { recursive: true });
        fs.writeFileSync(
            path.join(root, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({ createdAt: '2026-03-21T06:06:00.000Z', artifactsCreated: [] })}\n`,
            'utf-8',
        );

        const report = runSidecarDoctor({
            repositoryRoot: root,
            appDataDir,
            readinessReportPath: path.join(readinessDir, 'report.json'),
            controlPlaneThresholdsPath: thresholdsPath,
            controlPlaneThresholdProfile: 'beta',
            now: new Date('2026-03-21T06:10:00.000Z'),
        });

        expect(report.overallStatus).toBe('blocked');
        expect(report.checks.find((check) => check.id === 'memory-source-guards')?.status).toBe('fail');
        expect(formatSidecarDoctorReport(report)).toContain('synthesize standalone task ids');
    });

    test('flags extension governance when pending review extensions stay enabled', () => {
        const root = makeTempRepo();
        const appDataDir = path.join(root, '.coworkany');
        const readinessDir = path.join(root, 'artifacts', 'release-readiness');
        const thresholdsPath = path.join(root, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json');
        fs.mkdirSync(appDataDir, { recursive: true });
        fs.mkdirSync(readinessDir, { recursive: true });
        fs.mkdirSync(path.dirname(thresholdsPath), { recursive: true });
        fs.mkdirSync(path.join(root, '.coworkany', 'startup-metrics'), { recursive: true });
        fs.mkdirSync(path.join(root, '.coworkany', 'self-learning'), { recursive: true });
        fs.mkdirSync(path.join(root, 'sidecar', 'src', 'agent'), { recursive: true });

        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'main.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'reactLoop.ts'), 'export {};\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'sidecar', 'src', 'agent', 'autonomousAgent.ts'), 'export {};\n', 'utf-8');

        fs.writeFileSync(
            path.join(appDataDir, 'task-runtime.json'),
            JSON.stringify([{
                taskId: 'finished-1',
                title: 'Finished task',
                workspacePath: '/tmp/workspace',
                createdAt: '2026-03-21T06:00:00.000Z',
                updatedAt: '2026-03-21T06:05:00.000Z',
                status: 'finished',
                conversation: [],
                config: {
                    sessionIsolationPolicy: {
                        workspaceBindingMode: 'frozen_workspace_only',
                        followUpScope: 'same_task_only',
                        allowWorkspaceOverride: false,
                        supersededContractHandling: 'tombstone_prior_contracts',
                        staleEvidenceHandling: 'evict_on_refreeze',
                        notes: [],
                    },
                    memoryIsolationPolicy: {
                        classificationMode: 'scope_tagged',
                        readScopes: ['task', 'workspace', 'user_preference'],
                        writeScopes: ['task', 'workspace'],
                        defaultWriteScope: 'workspace',
                        notes: [],
                    },
                    tenantIsolationPolicy: {
                        workspaceBoundaryMode: 'same_workspace_only',
                        userBoundaryMode: 'current_local_user_only',
                        allowCrossWorkspaceMemory: false,
                        allowCrossWorkspaceFollowUp: false,
                        allowCrossUserMemory: false,
                        notes: [],
                    },
                },
                historyLimit: 20,
                artifactsCreated: [],
            }], null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(root, '.coworkany', 'startup-metrics', 'default.jsonl'),
            `${JSON.stringify({ mark: 'frontend_ready', timestampEpochMs: Date.parse('2026-03-21T06:00:00.000Z') })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(root, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({ createdAt: '2026-03-21T06:06:00.000Z', artifactsCreated: [] })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(readinessDir, 'report.json'),
            JSON.stringify({
                stages: [{
                    id: 'control-plane-eval',
                    label: 'Control-plane eval suite',
                    status: 'passed',
                    durationMs: 10,
                    exitCode: 0,
                    command: 'bun run eval:control-plane',
                    cwd: root,
                }],
                controlPlaneEval: {
                    passedCases: 8,
                    totalCases: 8,
                },
                controlPlaneEvalGate: {
                    passed: true,
                    findings: [],
                },
                productionReplayThresholdRecommendations: [],
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            thresholdsPath,
            JSON.stringify({
                defaultProfile: 'beta',
                profiles: {
                    beta: {
                        maxUnnecessaryClarificationRate: 0.05,
                        minFreezeExpectationPassRate: 1,
                        minArtifactExpectationPassRate: 1,
                        minRuntimeReplayPassRate: 1,
                        requireZeroFailedCases: true,
                    },
                },
            }, null, 2),
            'utf-8',
        );
        fs.mkdirSync(path.join(root, '.coworkany'), { recursive: true });
        fs.writeFileSync(
            path.join(root, '.coworkany', 'skills.json'),
            JSON.stringify({
                'Pending Skill': {
                    manifest: {
                        name: 'Pending Skill',
                        version: '1.0.0',
                        description: 'Pending',
                        directory: '/tmp/pending-skill',
                    },
                    enabled: true,
                    installedAt: '2026-03-21T06:00:00.000Z',
                },
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(appDataDir, 'extension-governance.json'),
            JSON.stringify({
                version: 1,
                states: {
                    'skill:Pending Skill': {
                        extensionType: 'skill',
                        extensionId: 'Pending Skill',
                        pendingReview: true,
                        quarantined: true,
                        lastDecision: 'pending',
                        lastReviewReason: 'first_install_review',
                        lastReviewSummary: 'First install review required',
                        lastUpdatedAt: '2026-03-21T06:00:00.000Z',
                    },
                },
            }, null, 2),
            'utf-8',
        );

        const report = runSidecarDoctor({
            repositoryRoot: root,
            appDataDir,
            readinessReportPath: path.join(readinessDir, 'report.json'),
            controlPlaneThresholdsPath: thresholdsPath,
            controlPlaneThresholdProfile: 'beta',
            now: new Date('2026-03-21T06:10:00.000Z'),
        });

        expect(report.checks.find((check) => check.id === 'extension-governance')?.status).toBe('fail');
        expect(formatSidecarDoctorReport(report)).toContain('pending governance review still enabled');
    });

    test('warns extension governance when pending reviews exist but are not enabled', () => {
        const root = makeTempRepo();
        const appDataDir = path.join(root, '.coworkany');
        fs.mkdirSync(appDataDir, { recursive: true });
        fs.writeFileSync(
            path.join(appDataDir, 'extension-governance.json'),
            JSON.stringify({
                version: 1,
                states: {
                    'skill:Pending Skill': {
                        extensionType: 'skill',
                        extensionId: 'Pending Skill',
                        pendingReview: true,
                        quarantined: true,
                        lastDecision: 'pending',
                        lastReviewReason: 'first_install_review',
                        lastReviewSummary: 'First install review required',
                        lastUpdatedAt: '2026-03-21T06:00:00.000Z',
                    },
                },
            }, null, 2),
            'utf-8',
        );

        const report = runSidecarDoctor({
            repositoryRoot: root,
            appDataDir,
            now: new Date('2026-03-21T06:10:00.000Z'),
        });

        expect(report.checks.find((check) => check.id === 'extension-governance')?.status).toBe('warn');
    });
});
