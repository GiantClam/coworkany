import * as fs from 'fs';
import * as path from 'path';

export type ReleaseStageStatus = 'passed' | 'failed' | 'skipped';

export type ReleaseStageResult = {
    id: string;
    label: string;
    command: string;
    cwd: string;
    durationMs: number;
    status: ReleaseStageStatus;
    exitCode: number;
    optional?: boolean;
    note?: string;
};

export type ControlPlaneEvalThresholds = {
    maxUnnecessaryClarificationRate: number;
    minFreezeExpectationPassRate: number;
    minArtifactExpectationPassRate: number;
    minRuntimeReplayPassRate: number;
    requireZeroFailedCases: boolean;
    minProductionReplayCasesBySource: Record<string, number>;
};

export type LoadedControlPlaneEvalThresholds = {
    sourcePath: string;
    profile: string;
    availableProfiles: string[];
    thresholds: ControlPlaneEvalThresholds;
};

export type ProductionReplaySourceSummary = {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    runtimeReplayCases: number;
    runtimeReplayPassedCases: number;
};

export type ControlPlaneEvalSummary = {
    summaryPath: string;
    exists: boolean;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    clarificationRate: number;
    unnecessaryClarificationRate: number;
    freezeExpectationPassRate: number;
    artifactExpectationPassRate: number;
    artifactSatisfactionRate: number;
    runtimeReplayPassRate: number;
    productionReplaySources: Record<string, ProductionReplaySourceSummary>;
};

export type ControlPlaneEvalGate = {
    passed: boolean;
    findings: string[];
    thresholds: ControlPlaneEvalThresholds;
    thresholdSourcePath?: string;
    thresholdProfile?: string;
};

export type ProductionReplayImportSummary = {
    summaryPath: string;
    exists: boolean;
    totalCases: number;
    bySource: Record<string, number>;
    insertedCases: number;
    updatedCases: number;
    totalDatasetCases: number;
};

export type ProductionReplayThresholdRecommendation = {
    sourceLabel: string;
    currentMinimum: number;
    importedCases: number;
    observedDatasetCases: number;
    suggestedMinimum: number;
};

export type ControlPlaneThresholdUpdateSuggestion = {
    sourcePath: string;
    profile: string;
    recommendedMinProductionReplayCasesBySource: Record<string, number>;
    recommendations: ProductionReplayThresholdRecommendation[];
};

export type SidecarDoctorCheckSummary = {
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    summary: string;
};

export type SidecarDoctorSummary = {
    reportPath: string;
    markdownPath?: string;
    exists: boolean;
    overallStatus: 'healthy' | 'degraded' | 'blocked';
    failedChecks: number;
    warnedChecks: number;
    checks: SidecarDoctorCheckSummary[];
    warnings: string[];
};

export type SidecarDoctorGate = {
    passed: boolean;
    requiredOverallStatus: 'healthy' | 'degraded' | 'blocked';
    findings: string[];
};

export type WorkspaceExtensionAllowlistReadinessInput = {
    mode: string;
    allowedSkills: string[];
    allowedToolpacks: string[];
    enabledSkills: string[];
    enabledToolpacks: string[];
};

export type WorkspaceExtensionAllowlistReadinessGate = {
    passed: boolean;
    summary: string;
    findings: string[];
    enabledSkills: string[];
    enabledToolpacks: string[];
};

export type CanaryChecklistItem = {
    area: string;
    description: string;
};

export type CanaryChecklistEvidenceSummary = {
    evidencePath: string;
    exists: boolean;
    completedAreas: string[];
    missingAreas: string[];
    findings: string[];
};

export type CanaryChecklistEvidenceGate = {
    passed: boolean;
    required: boolean;
    findings: string[];
};

export type StartupMetricFileSummary = {
    path: string;
    entries: number;
};

export type ObservabilitySummary = {
    startupMetrics: {
        inspected: boolean;
        files: StartupMetricFileSummary[];
        warnings: string[];
    };
    artifactTelemetry: {
        path: string;
        exists: boolean;
        entries: number;
        warnings: string[];
    };
};

export type ReleaseReadinessReport = {
    generatedAt: string;
    repositoryRoot: string;
    requestedOptions: {
        buildDesktop: boolean;
        realE2E: boolean;
        appDataDir?: string;
        startupProfile?: string;
        doctorRequiredStatus: 'healthy' | 'degraded' | 'blocked';
        canaryEvidencePath?: string;
        requireCanaryEvidence?: boolean;
        controlPlaneThresholdsPath?: string;
        controlPlaneThresholdProfile?: string;
        syncProductionReplays?: boolean;
        productionReplayDatasetPath?: string;
    };
    stages: ReleaseStageResult[];
    productionReplayImport?: ProductionReplayImportSummary;
    productionReplayThresholdRecommendations?: ProductionReplayThresholdRecommendation[];
    controlPlaneThresholdUpdateSuggestion?: {
        path: string;
        suggestion: ControlPlaneThresholdUpdateSuggestion;
    };
    controlPlaneThresholdCandidateConfig?: {
        path: string;
        baseConfigPath: string;
    };
    controlPlaneEval?: ControlPlaneEvalSummary;
    controlPlaneEvalGate?: ControlPlaneEvalGate;
    sidecarDoctor?: SidecarDoctorSummary;
    sidecarDoctorGate?: SidecarDoctorGate;
    checklist: CanaryChecklistItem[];
    canaryEvidence?: CanaryChecklistEvidenceSummary;
    canaryEvidenceGate?: CanaryChecklistEvidenceGate;
    observability: ObservabilitySummary;
};

type ControlPlaneThresholdConfig = {
    defaultProfile?: string;
    profiles?: Record<string, Partial<ControlPlaneEvalThresholds>>;
} & Partial<ControlPlaneEvalThresholds>;

function safeReadJson(inputPath: string): unknown | undefined {
    if (!fs.existsSync(inputPath)) {
        return undefined;
    }
    const raw = fs.readFileSync(inputPath, 'utf-8');
    return JSON.parse(raw) as unknown;
}

function toObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function mergeThresholds(
    partial: Partial<ControlPlaneEvalThresholds> | undefined,
    defaults: ControlPlaneEvalThresholds,
): ControlPlaneEvalThresholds {
    return {
        maxUnnecessaryClarificationRate: toNumber(
            partial?.maxUnnecessaryClarificationRate,
            defaults.maxUnnecessaryClarificationRate,
        ),
        minFreezeExpectationPassRate: toNumber(
            partial?.minFreezeExpectationPassRate,
            defaults.minFreezeExpectationPassRate,
        ),
        minArtifactExpectationPassRate: toNumber(
            partial?.minArtifactExpectationPassRate,
            defaults.minArtifactExpectationPassRate,
        ),
        minRuntimeReplayPassRate: toNumber(
            partial?.minRuntimeReplayPassRate,
            defaults.minRuntimeReplayPassRate,
        ),
        requireZeroFailedCases: toBoolean(partial?.requireZeroFailedCases, defaults.requireZeroFailedCases),
        minProductionReplayCasesBySource:
            partial?.minProductionReplayCasesBySource && typeof partial.minProductionReplayCasesBySource === 'object'
                ? Object.fromEntries(
                    Object.entries(partial.minProductionReplayCasesBySource)
                        .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
                        .map(([source, amount]) => [source, amount]),
                )
                : { ...defaults.minProductionReplayCasesBySource },
    };
}

function listJsonlEntries(filePath: string): number {
    const content = fs.readFileSync(filePath, 'utf-8');
    let entries = 0;
    for (const line of content.split(/\r?\n/)) {
        if (line.trim().length === 0) {
            continue;
        }
        entries += 1;
    }
    return entries;
}

export function createDefaultControlPlaneEvalThresholds(): ControlPlaneEvalThresholds {
    return {
        maxUnnecessaryClarificationRate: 0.05,
        minFreezeExpectationPassRate: 1,
        minArtifactExpectationPassRate: 1,
        minRuntimeReplayPassRate: 1,
        requireZeroFailedCases: true,
        minProductionReplayCasesBySource: {},
    };
}

export function loadControlPlaneEvalThresholds(
    sourcePath: string,
    requestedProfile?: string,
): LoadedControlPlaneEvalThresholds {
    const resolvedPath = path.resolve(sourcePath);
    const defaults = createDefaultControlPlaneEvalThresholds();
    const raw = safeReadJson(resolvedPath);
    const root = toObject(raw);
    if (!root) {
        return {
            sourcePath: resolvedPath,
            profile: 'default',
            availableProfiles: ['default'],
            thresholds: defaults,
        };
    }

    const profilesRaw = toObject(root.profiles);
    if (profilesRaw) {
        const availableProfiles = Object.keys(profilesRaw).sort((left, right) => left.localeCompare(right));
        const selectedProfile = requestedProfile
            ?? (typeof root.defaultProfile === 'string' ? root.defaultProfile : availableProfiles[0] ?? 'default');
        const selected = toObject(profilesRaw[selectedProfile]) ?? {};
        return {
            sourcePath: resolvedPath,
            profile: selectedProfile,
            availableProfiles,
            thresholds: mergeThresholds(selected as Partial<ControlPlaneEvalThresholds>, defaults),
        };
    }

    return {
        sourcePath: resolvedPath,
        profile: 'default',
        availableProfiles: ['default'],
        thresholds: mergeThresholds(root as Partial<ControlPlaneEvalThresholds>, defaults),
    };
}

export function summarizeControlPlaneEvalSummary(summaryPath: string): ControlPlaneEvalSummary {
    const resolvedPath = path.resolve(summaryPath);
    const raw = safeReadJson(resolvedPath);
    if (!raw) {
        return {
            summaryPath: resolvedPath,
            exists: false,
            totalCases: 0,
            passedCases: 0,
            failedCases: 0,
            clarificationRate: 0,
            unnecessaryClarificationRate: 0,
            freezeExpectationPassRate: 0,
            artifactExpectationPassRate: 0,
            artifactSatisfactionRate: 0,
            runtimeReplayPassRate: 0,
            productionReplaySources: {},
        };
    }

    const root = toObject(raw) ?? {};
    const totals = toObject(root.totals) ?? {};
    const metrics = toObject(root.metrics) ?? {};
    const coverage = toObject(root.coverage) ?? {};
    const productionReplaySourcesRaw = toObject(coverage.productionReplaySources) ?? {};
    const productionReplaySources: Record<string, ProductionReplaySourceSummary> = {};
    for (const [source, value] of Object.entries(productionReplaySourcesRaw)) {
        const entry = toObject(value) ?? {};
        productionReplaySources[source] = {
            totalCases: toNumber(entry.totalCases, 0),
            passedCases: toNumber(entry.passedCases, 0),
            failedCases: toNumber(entry.failedCases, 0),
            runtimeReplayCases: toNumber(entry.runtimeReplayCases, 0),
            runtimeReplayPassedCases: toNumber(entry.runtimeReplayPassedCases, 0),
        };
    }

    return {
        summaryPath: resolvedPath,
        exists: true,
        totalCases: toNumber(totals.totalCases, 0),
        passedCases: toNumber(totals.passedCases, 0),
        failedCases: toNumber(totals.failedCases, 0),
        clarificationRate: toNumber(metrics.clarificationRate, 0),
        unnecessaryClarificationRate: toNumber(metrics.unnecessaryClarificationRate, 0),
        freezeExpectationPassRate: toNumber(metrics.contractFreezeExpectationPassRate, 0),
        artifactExpectationPassRate: toNumber(metrics.artifactExpectationPassRate, 0),
        artifactSatisfactionRate: toNumber(metrics.artifactSatisfactionRate, 0),
        runtimeReplayPassRate: toNumber(metrics.runtimeReplayPassRate, 0),
        productionReplaySources,
    };
}

export function summarizeProductionReplayImportSummary(summaryPath: string): ProductionReplayImportSummary {
    const resolvedPath = path.resolve(summaryPath);
    const raw = safeReadJson(resolvedPath);
    if (!raw) {
        return {
            summaryPath: resolvedPath,
            exists: false,
            totalCases: 0,
            bySource: {},
            insertedCases: 0,
            updatedCases: 0,
            totalDatasetCases: 0,
        };
    }

    const root = toObject(raw) ?? {};
    const bySourceRaw = toObject(root.bySource) ?? {};
    const bySource: Record<string, number> = {};
    for (const [label, count] of Object.entries(bySourceRaw)) {
        bySource[label] = toNumber(count, 0);
    }

    return {
        summaryPath: resolvedPath,
        exists: true,
        totalCases: toNumber(root.totalCases, 0),
        bySource,
        insertedCases: toNumber(root.insertedCases, 0),
        updatedCases: toNumber(root.updatedCases, 0),
        totalDatasetCases: toNumber(root.totalDatasetCases, 0),
    };
}

export function evaluateControlPlaneEvalReadiness(
    summary: ControlPlaneEvalSummary,
    thresholds: ControlPlaneEvalThresholds,
    thresholdSourcePath?: string,
    thresholdProfile?: string,
): ControlPlaneEvalGate {
    const findings: string[] = [];

    if (!summary.exists) {
        findings.push(`Control-plane eval summary missing: ${summary.summaryPath}`);
    }
    if (thresholds.requireZeroFailedCases && summary.failedCases > 0) {
        findings.push(`Detected ${summary.failedCases} failed case(s) in control-plane eval.`);
    }
    if (summary.unnecessaryClarificationRate > thresholds.maxUnnecessaryClarificationRate) {
        findings.push(
            `Unnecessary clarification rate ${(summary.unnecessaryClarificationRate * 100).toFixed(1)}% is above threshold ${(thresholds.maxUnnecessaryClarificationRate * 100).toFixed(1)}%.`,
        );
    }
    if (summary.freezeExpectationPassRate < thresholds.minFreezeExpectationPassRate) {
        findings.push(
            `Freeze expectation pass rate ${(summary.freezeExpectationPassRate * 100).toFixed(1)}% is below threshold ${(thresholds.minFreezeExpectationPassRate * 100).toFixed(1)}%.`,
        );
    }
    if (summary.artifactExpectationPassRate < thresholds.minArtifactExpectationPassRate) {
        findings.push(
            `Artifact expectation pass rate ${(summary.artifactExpectationPassRate * 100).toFixed(1)}% is below threshold ${(thresholds.minArtifactExpectationPassRate * 100).toFixed(1)}%.`,
        );
    }
    if (summary.runtimeReplayPassRate < thresholds.minRuntimeReplayPassRate) {
        findings.push(
            `Runtime replay pass rate ${(summary.runtimeReplayPassRate * 100).toFixed(1)}% is below threshold ${(thresholds.minRuntimeReplayPassRate * 100).toFixed(1)}%.`,
        );
    }

    for (const [sourceLabel, minimumCases] of Object.entries(thresholds.minProductionReplayCasesBySource)) {
        const observedCases = summary.productionReplaySources[sourceLabel]?.totalCases ?? 0;
        if (observedCases < minimumCases) {
            findings.push(
                `Production replay coverage (${sourceLabel}) has ${observedCases} case(s), below required minimum ${minimumCases}.`,
            );
        }
    }

    return {
        passed: findings.length === 0,
        findings,
        thresholds,
        thresholdSourcePath,
        thresholdProfile,
    };
}

export function recommendProductionReplayThresholds(
    importSummary: ProductionReplayImportSummary | undefined,
    evalSummary: ControlPlaneEvalSummary | undefined,
    gate: ControlPlaneEvalGate | undefined,
): ProductionReplayThresholdRecommendation[] {
    if (!importSummary?.exists || !evalSummary?.exists || !gate?.passed) {
        return [];
    }

    const currentMinimums = gate.thresholds.minProductionReplayCasesBySource;
    const recommendations: ProductionReplayThresholdRecommendation[] = [];

    for (const [sourceLabel, importedCases] of Object.entries(importSummary.bySource)) {
        const currentMinimum = currentMinimums[sourceLabel] ?? 0;
        const observedDatasetCases = evalSummary.productionReplaySources[sourceLabel]?.totalCases ?? importedCases;
        const suggestedMinimum = Math.max(currentMinimum, importedCases, observedDatasetCases);
        if (suggestedMinimum <= currentMinimum) {
            continue;
        }
        recommendations.push({
            sourceLabel,
            currentMinimum,
            importedCases,
            observedDatasetCases,
            suggestedMinimum,
        });
    }

    return recommendations.sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel));
}

export function buildControlPlaneThresholdUpdateSuggestion(
    gate: ControlPlaneEvalGate,
    recommendations: ProductionReplayThresholdRecommendation[],
): ControlPlaneThresholdUpdateSuggestion | undefined {
    if (recommendations.length === 0) {
        return undefined;
    }
    const merged = {
        ...gate.thresholds.minProductionReplayCasesBySource,
    };
    for (const recommendation of recommendations) {
        merged[recommendation.sourceLabel] = recommendation.suggestedMinimum;
    }

    return {
        sourcePath: gate.thresholdSourcePath ?? '',
        profile: gate.thresholdProfile ?? 'default',
        recommendedMinProductionReplayCasesBySource: merged,
        recommendations,
    };
}

export function loadControlPlaneThresholdUpdateSuggestion(
    suggestionPath: string,
): ControlPlaneThresholdUpdateSuggestion {
    const raw = safeReadJson(path.resolve(suggestionPath));
    if (!raw) {
        throw new Error(`Control-plane threshold update suggestion not found: ${suggestionPath}`);
    }
    const root = toObject(raw) ?? {};
    const recommendedRaw = toObject(root.recommendedMinProductionReplayCasesBySource) ?? {};
    const recommendedMinProductionReplayCasesBySource: Record<string, number> = {};
    for (const [source, count] of Object.entries(recommendedRaw)) {
        recommendedMinProductionReplayCasesBySource[source] = toNumber(count, 0);
    }
    const recommendations: ProductionReplayThresholdRecommendation[] = Array.isArray(root.recommendations)
        ? root.recommendations
            .map((entry) => toObject(entry))
            .filter((entry): entry is Record<string, unknown> => !!entry)
            .map((entry) => ({
                sourceLabel: String(entry.sourceLabel ?? ''),
                currentMinimum: toNumber(entry.currentMinimum, 0),
                importedCases: toNumber(entry.importedCases, 0),
                observedDatasetCases: toNumber(entry.observedDatasetCases, 0),
                suggestedMinimum: toNumber(entry.suggestedMinimum, 0),
            }))
        : [];

    return {
        sourcePath: String(root.sourcePath ?? ''),
        profile: String(root.profile ?? 'default'),
        recommendedMinProductionReplayCasesBySource,
        recommendations,
    };
}

export function applyControlPlaneThresholdUpdateSuggestion(
    config: unknown,
    suggestion: ControlPlaneThresholdUpdateSuggestion,
): unknown {
    const root = toObject(config);
    if (!root) {
        return config;
    }

    const snapshot = JSON.parse(JSON.stringify(root)) as ControlPlaneThresholdConfig;
    if (snapshot.profiles && typeof snapshot.profiles === 'object') {
        const targetProfile = suggestion.profile || snapshot.defaultProfile || Object.keys(snapshot.profiles)[0];
        if (!targetProfile) {
            return snapshot;
        }
        const targetConfig = toObject(snapshot.profiles[targetProfile]) ?? {};
        snapshot.profiles[targetProfile] = {
            ...(targetConfig as Partial<ControlPlaneEvalThresholds>),
            minProductionReplayCasesBySource: {
                ...(toObject(targetConfig.minProductionReplayCasesBySource) as Record<string, number> | undefined),
                ...suggestion.recommendedMinProductionReplayCasesBySource,
            },
        };
        return snapshot;
    }

    snapshot.minProductionReplayCasesBySource = {
        ...(toObject(snapshot.minProductionReplayCasesBySource) as Record<string, number> | undefined),
        ...suggestion.recommendedMinProductionReplayCasesBySource,
    };
    return snapshot;
}

export function createDefaultCanaryChecklist(): CanaryChecklistItem[] {
    return [
        { area: 'Audience', description: 'Named canary testers and contact channel are defined.' },
        { area: 'Rollback', description: 'Rollback procedure and owner are documented.' },
        { area: 'Monitoring', description: 'Runtime and error dashboards are live during canary.' },
        { area: 'Signoff', description: 'Release owner signed off the rollout decision.' },
    ];
}

export function summarizeCanaryChecklistEvidence(input: {
    checklist: CanaryChecklistItem[];
    evidencePath: string;
}): CanaryChecklistEvidenceSummary {
    const evidencePath = path.resolve(input.evidencePath);
    const raw = safeReadJson(evidencePath);
    if (!raw) {
        return {
            evidencePath,
            exists: false,
            completedAreas: [],
            missingAreas: input.checklist.map((item) => item.area),
            findings: [`Canary evidence file not found: ${evidencePath}`],
        };
    }

    const root = toObject(raw) ?? {};
    const items = Array.isArray(root.items) ? root.items : [];
    const completedAreas = new Set<string>();
    for (const item of items) {
        const entry = toObject(item);
        if (!entry) {
            continue;
        }
        if (entry.completed === true && typeof entry.area === 'string' && entry.area.trim().length > 0) {
            completedAreas.add(entry.area.trim());
        }
    }

    const missingAreas = input.checklist
        .map((item) => item.area)
        .filter((area) => !completedAreas.has(area));

    return {
        evidencePath,
        exists: true,
        completedAreas: Array.from(completedAreas).sort((left, right) => left.localeCompare(right)),
        missingAreas,
        findings: [],
    };
}

export function evaluateCanaryChecklistEvidence(
    summary: CanaryChecklistEvidenceSummary,
    required: boolean,
): CanaryChecklistEvidenceGate {
    if (!required) {
        return {
            passed: true,
            required: false,
            findings: [],
        };
    }

    const findings = summary.missingAreas.map((area) => `Canary evidence missing for area: ${area}`);
    return {
        passed: findings.length === 0,
        required: true,
        findings,
    };
}

export function inspectObservability(input: {
    repositoryRoot: string;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
}): ObservabilitySummary {
    const startupWarnings: string[] = [];
    const startupFiles: StartupMetricFileSummary[] = [];
    const startupDir = input.appDataDir ? path.join(input.appDataDir, 'startup-metrics') : undefined;
    if (!input.appDataDir) {
        startupWarnings.push('No appDataDir provided; startup metrics inspection skipped.');
    } else if (!startupDir || !fs.existsSync(startupDir)) {
        startupWarnings.push(`Startup metrics directory not found: ${startupDir}`);
    } else {
        const candidates = fs.readdirSync(startupDir)
            .filter((name) => name.endsWith('.jsonl'))
            .filter((name) => !input.startupProfile || name === `${input.startupProfile}.jsonl`)
            .sort((left, right) => left.localeCompare(right));
        for (const candidate of candidates) {
            const filePath = path.join(startupDir, candidate);
            startupFiles.push({
                path: filePath,
                entries: listJsonlEntries(filePath),
            });
        }
        if (candidates.length === 0) {
            startupWarnings.push(input.startupProfile
                ? `Startup metrics profile not found: ${input.startupProfile}`
                : 'No startup metric files found.');
        }
    }

    const artifactPath = input.artifactTelemetryPath
        ? path.resolve(input.artifactTelemetryPath)
        : path.join(input.repositoryRoot, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl');
    const artifactWarnings: string[] = [];
    let artifactEntries = 0;
    const artifactExists = fs.existsSync(artifactPath);
    if (artifactExists) {
        artifactEntries = listJsonlEntries(artifactPath);
    } else {
        artifactWarnings.push('Artifact telemetry file not found.');
    }

    return {
        startupMetrics: {
            inspected: Boolean(input.appDataDir),
            files: startupFiles,
            warnings: startupWarnings,
        },
        artifactTelemetry: {
            path: artifactPath,
            exists: artifactExists,
            entries: artifactEntries,
            warnings: artifactWarnings,
        },
    };
}

export function summarizeSidecarDoctorReport(
    reportPath: string,
    markdownPath?: string,
): SidecarDoctorSummary {
    const resolvedPath = path.resolve(reportPath);
    const warnings: string[] = [];
    const raw = safeReadJson(resolvedPath);
    if (!raw) {
        warnings.push(`Sidecar doctor report not found: ${resolvedPath}`);
        return {
            reportPath: resolvedPath,
            markdownPath,
            exists: false,
            overallStatus: 'blocked',
            failedChecks: 0,
            warnedChecks: 0,
            checks: [],
            warnings,
        };
    }

    const root = toObject(raw) ?? {};
    const checks: SidecarDoctorCheckSummary[] = Array.isArray(root.checks)
        ? root.checks
            .map((entry) => toObject(entry))
            .filter((entry): entry is Record<string, unknown> => !!entry)
            .map((entry) => ({
                id: String(entry.id ?? ''),
                label: String(entry.label ?? ''),
                status: entry.status === 'fail' ? 'fail' : entry.status === 'warn' ? 'warn' : 'pass',
                summary: String(entry.summary ?? ''),
            }))
        : [];
    const failedChecks = checks.filter((check) => check.status === 'fail').length;
    const warnedChecks = checks.filter((check) => check.status === 'warn').length;

    const status = root.overallStatus;
    const overallStatus: 'healthy' | 'degraded' | 'blocked' = status === 'blocked'
        ? 'blocked'
        : status === 'degraded'
            ? 'degraded'
            : 'healthy';

    return {
        reportPath: resolvedPath,
        markdownPath,
        exists: true,
        overallStatus,
        failedChecks,
        warnedChecks,
        checks,
        warnings,
    };
}

export function evaluateSidecarDoctorReadiness(
    summary: SidecarDoctorSummary,
    requiredOverallStatus: 'healthy' | 'degraded' | 'blocked',
): SidecarDoctorGate {
    const rank: Record<'healthy' | 'degraded' | 'blocked', number> = {
        healthy: 0,
        degraded: 1,
        blocked: 2,
    };

    const findings: string[] = [];
    if (!summary.exists) {
        findings.push('Sidecar doctor report is missing.');
    }
    if (rank[summary.overallStatus] > rank[requiredOverallStatus]) {
        findings.push(
            `Sidecar doctor overall status "${summary.overallStatus}" is below required "${requiredOverallStatus}".`,
        );
    }
    return {
        passed: findings.length === 0,
        requiredOverallStatus,
        findings,
    };
}

export function evaluateWorkspaceExtensionAllowlistReadiness(
    input: WorkspaceExtensionAllowlistReadinessInput,
): WorkspaceExtensionAllowlistReadinessGate {
    const enabledSkills = [...input.enabledSkills].sort((left, right) => left.localeCompare(right));
    const enabledToolpacks = [...input.enabledToolpacks].sort((left, right) => left.localeCompare(right));
    const findings: string[] = [];
    if (enabledSkills.length === 0 && enabledToolpacks.length === 0) {
        return {
            passed: true,
            summary: 'No enabled third-party extensions detected.',
            findings: [],
            enabledSkills,
            enabledToolpacks,
        };
    }

    if (input.mode !== 'enforce') {
        findings.push(`Extension allowlist mode must be "enforce" when third-party extensions are enabled.`);
    }

    const allowedSkills = new Set(input.allowedSkills);
    for (const skillId of enabledSkills) {
        if (!allowedSkills.has(skillId)) {
            findings.push(`Enabled skill is not allowlisted: ${skillId}`);
        }
    }
    const allowedToolpacks = new Set(input.allowedToolpacks);
    for (const toolpackId of enabledToolpacks) {
        if (!allowedToolpacks.has(toolpackId)) {
            findings.push(`Enabled toolpack is not allowlisted: ${toolpackId}`);
        }
    }

    return {
        passed: findings.length === 0,
        summary: findings.length === 0
            ? 'All enabled third-party extensions are allowlisted.'
            : 'Workspace extension allowlist gate failed.',
        findings,
        enabledSkills,
        enabledToolpacks,
    };
}

export function renderReleaseReadinessMarkdown(report: ReleaseReadinessReport): string {
    const lines: string[] = [];
    lines.push('# Release Readiness Report');
    lines.push('');
    lines.push(`Generated at: ${report.generatedAt}`);
    lines.push(`Repository: ${report.repositoryRoot}`);
    lines.push('');
    lines.push('## Requested Options');
    lines.push(`- Build desktop: ${report.requestedOptions.buildDesktop ? 'yes' : 'no'}`);
    lines.push(`- Real E2E: ${report.requestedOptions.realE2E ? 'yes' : 'no'}`);
    lines.push(`- Doctor required status: ${report.requestedOptions.doctorRequiredStatus}`);
    lines.push(`- Canary evidence path: ${report.requestedOptions.canaryEvidencePath ?? 'not provided'}`);
    lines.push(`- Require canary evidence: ${report.requestedOptions.requireCanaryEvidence ? 'yes' : 'no'}`);
    if (report.requestedOptions.productionReplayDatasetPath) {
        lines.push(`- Production replay dataset: ${report.requestedOptions.productionReplayDatasetPath}`);
    }
    lines.push('');

    lines.push('## Stages');
    for (const stage of report.stages) {
        lines.push(`- [${stage.status.toUpperCase()}] ${stage.label} (${stage.durationMs}ms)`);
        if (stage.note) {
            lines.push(`  - ${stage.note}`);
        }
    }
    lines.push('');

    if (report.controlPlaneEval) {
        lines.push('## Control-Plane Eval');
        lines.push(`- Cases: ${report.controlPlaneEval.passedCases}/${report.controlPlaneEval.totalCases} passed`);
        lines.push(`- Runtime replay pass rate: ${(report.controlPlaneEval.runtimeReplayPassRate * 100).toFixed(1)}%`);
        if (report.controlPlaneEvalGate?.thresholdSourcePath) {
            lines.push(`- Threshold source: ${report.controlPlaneEvalGate.thresholdSourcePath}`);
        }
        if (report.controlPlaneEvalGate?.thresholdProfile) {
            lines.push(`- Threshold profile: ${report.controlPlaneEvalGate.thresholdProfile}`);
        }
        for (const [sourceLabel, sourceSummary] of Object.entries(report.controlPlaneEval.productionReplaySources)) {
            lines.push(
                `- Production replay coverage (${sourceLabel}): ${sourceSummary.passedCases}/${sourceSummary.totalCases} passed, runtimeReplay ${sourceSummary.runtimeReplayPassedCases}/${sourceSummary.runtimeReplayCases}`,
            );
        }
        lines.push('');
    }

    if (report.productionReplayImport) {
        lines.push('## Production Replay Import');
        lines.push(`- Cases imported: ${report.productionReplayImport.totalCases}`);
        for (const [source, count] of Object.entries(report.productionReplayImport.bySource)) {
            lines.push(`- Source ${source}: ${count}`);
        }
        if (report.requestedOptions.productionReplayDatasetPath) {
            lines.push(`- Production replay dataset: ${report.requestedOptions.productionReplayDatasetPath}`);
        }
        lines.push('');
    }

    if (report.productionReplayThresholdRecommendations && report.productionReplayThresholdRecommendations.length > 0) {
        lines.push('## Production Replay Threshold Recommendations');
        for (const recommendation of report.productionReplayThresholdRecommendations) {
            lines.push(
                `- Source ${recommendation.sourceLabel}: current minimum ${recommendation.currentMinimum}, imported ${recommendation.importedCases}, observed dataset ${recommendation.observedDatasetCases}, suggested new minimum ${recommendation.suggestedMinimum}`,
            );
        }
        lines.push('');
    }

    if (report.controlPlaneThresholdUpdateSuggestion) {
        lines.push('## Control-Plane Threshold Update Suggestion');
        lines.push(`- Artifact: ${report.controlPlaneThresholdUpdateSuggestion.path}`);
        for (const [sourceLabel, minimum] of Object.entries(
            report.controlPlaneThresholdUpdateSuggestion.suggestion.recommendedMinProductionReplayCasesBySource,
        )) {
            lines.push(`- Suggested min production replay cases (${sourceLabel}): ${minimum}`);
        }
        lines.push('');
    }

    if (report.controlPlaneThresholdCandidateConfig) {
        lines.push('## Control-Plane Threshold Candidate Config');
        lines.push(`- Candidate path: ${report.controlPlaneThresholdCandidateConfig.path}`);
        lines.push(`- Base config: ${report.controlPlaneThresholdCandidateConfig.baseConfigPath}`);
        lines.push('');
    }

    if (report.sidecarDoctor) {
        lines.push('## Sidecar Doctor');
        lines.push(`- Overall status: ${report.sidecarDoctor.overallStatus}`);
        lines.push(`- Required overall status: ${report.sidecarDoctorGate?.requiredOverallStatus ?? 'healthy'}`);
        lines.push('');
    }

    lines.push('## Canary Checklist');
    if (report.canaryEvidence) {
        lines.push(`- Completed areas: ${report.canaryEvidence.completedAreas.length}`);
        lines.push(`- Missing areas: ${report.canaryEvidence.missingAreas.length}`);
    } else {
        lines.push('- No canary evidence summary available.');
    }
    lines.push('');

    lines.push('## Observability');
    for (const warning of report.observability.startupMetrics.warnings) {
        lines.push(`- ${warning}`);
    }
    for (const warning of report.observability.artifactTelemetry.warnings) {
        lines.push(`- ${warning}`);
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}
