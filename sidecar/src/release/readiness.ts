import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export type ReleaseStageStatus = 'passed' | 'failed' | 'skipped';

export type ReleaseStageResult = {
    id: string;
    label: string;
    command: string;
    cwd: string;
    durationMs: number;
    status: ReleaseStageStatus;
    exitCode: number | null;
    optional?: boolean;
    note?: string;
};

export type JsonLineSummary = {
    path: string;
    exists: boolean;
    entries: number;
    lastTimestamp?: string;
};

export type ObservabilitySummary = {
    startupMetrics: {
        inspected: boolean;
        files: JsonLineSummary[];
        warnings: string[];
    };
    artifactTelemetry: JsonLineSummary & {
        warnings: string[];
    };
};

export type CanaryChecklistItem = {
    area: string;
    item: string;
    requiredEvidence: string;
};

export type ControlPlaneEvalReadinessSummary = {
    summaryPath: string;
    exists: boolean;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    clarificationRate?: number | null;
    unnecessaryClarificationRate?: number | null;
    freezeExpectationPassRate?: number | null;
    artifactExpectationPassRate?: number | null;
    artifactSatisfactionRate?: number | null;
    runtimeReplayPassRate?: number | null;
    productionReplaySources: Record<string, {
        totalCases: number;
        passedCases: number;
        failedCases: number;
        runtimeReplayCases: number;
        runtimeReplayPassedCases: number;
    }>;
};

export type ControlPlaneEvalThresholds = {
    maxUnnecessaryClarificationRate: number;
    minFreezeExpectationPassRate: number;
    minArtifactExpectationPassRate: number;
    minRuntimeReplayPassRate: number;
    requireZeroFailedCases: boolean;
    minProductionReplayCasesBySource: Record<string, number>;
};

export type ControlPlaneEvalGateResult = {
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
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
};

export type ProductionReplayThresholdRecommendation = {
    sourceLabel: string;
    currentMinimum: number;
    importedCases: number;
    observedDatasetCases: number;
    suggestedMinimum: number;
};

export type ControlPlaneThresholdUpdateSuggestion = {
    sourcePath?: string;
    profile: string;
    recommendedMinProductionReplayCasesBySource: Record<string, number>;
    recommendations: ProductionReplayThresholdRecommendation[];
};

export type LoadedControlPlaneEvalThresholds = {
    thresholds: ControlPlaneEvalThresholds;
    sourcePath: string;
    profile: string;
    availableProfiles: string[];
};

export type ReleaseReadinessReport = {
    generatedAt: string;
    repositoryRoot: string;
    requestedOptions: {
        buildDesktop: boolean;
        realE2E: boolean;
        appDataDir?: string;
        startupProfile?: string;
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
    controlPlaneEval?: ControlPlaneEvalReadinessSummary;
    controlPlaneEvalGate?: ControlPlaneEvalGateResult;
    observability: ObservabilitySummary;
    checklist: CanaryChecklistItem[];
};

type StartupMetricEntry = {
    timestampEpochMs?: number;
};

type ArtifactTelemetryEntry = {
    timestamp?: string;
    createdAt?: string;
};

type RawControlPlaneEvalSummary = {
    totals?: {
        totalCases?: number;
        passedCases?: number;
        failedCases?: number;
    };
    metrics?: {
        clarificationRate?: number | null;
        unnecessaryClarificationRate?: number | null;
        contractFreezeExpectationPassRate?: number | null;
        artifactExpectationPassRate?: number | null;
        artifactSatisfactionRate?: number | null;
        runtimeReplayPassRate?: number | null;
    };
    coverage?: {
        productionReplaySources?: Record<string, {
            totalCases?: number;
            passedCases?: number;
            failedCases?: number;
            runtimeReplayCases?: number;
            runtimeReplayPassedCases?: number;
        }>;
    };
};

type RawProductionReplayImportSummary = {
    totalCases?: number;
    bySource?: Record<string, number>;
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
};

const ControlPlaneEvalThresholdConfigSchema = z.object({
    maxUnnecessaryClarificationRate: z.number().min(0).max(1).optional(),
    minFreezeExpectationPassRate: z.number().min(0).max(1).optional(),
    minArtifactExpectationPassRate: z.number().min(0).max(1).optional(),
    minRuntimeReplayPassRate: z.number().min(0).max(1).optional(),
    requireZeroFailedCases: z.boolean().optional(),
    minProductionReplayCasesBySource: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).strict();

const ControlPlaneEvalThresholdProfilesConfigSchema = z.object({
    defaultProfile: z.string().min(1).optional(),
    profiles: z.record(z.string().min(1), ControlPlaneEvalThresholdConfigSchema),
}).strict();

const ControlPlaneThresholdUpdateSuggestionSchema = z.object({
    sourcePath: z.string().min(1).optional(),
    profile: z.string().min(1),
    recommendedMinProductionReplayCasesBySource: z.record(z.string(), z.number().int().nonnegative()),
    recommendations: z.array(z.object({
        sourceLabel: z.string().min(1),
        currentMinimum: z.number().int().nonnegative(),
        importedCases: z.number().int().nonnegative(),
        observedDatasetCases: z.number().int().nonnegative(),
        suggestedMinimum: z.number().int().nonnegative(),
    }).strict()),
}).strict();

function readJsonLines(filePath: string): unknown[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            } catch {
                return [];
            }
        });
}

function newestTimestamp(values: Array<string | undefined>): string | undefined {
    const filtered = values.filter((value): value is string => Boolean(value));
    if (filtered.length === 0) {
        return undefined;
    }
    return filtered.sort().at(-1);
}

export function summarizeStartupMetricFile(filePath: string): JsonLineSummary {
    const entries = readJsonLines(filePath) as StartupMetricEntry[];
    const lastTimestamp = entries
        .map((entry) => {
            if (typeof entry.timestampEpochMs !== 'number') {
                return undefined;
            }
            return new Date(entry.timestampEpochMs).toISOString();
        })
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);

    return {
        path: filePath,
        exists: fs.existsSync(filePath),
        entries: entries.length,
        lastTimestamp,
    };
}

export function summarizeArtifactTelemetryFile(filePath: string): JsonLineSummary {
    const entries = readJsonLines(filePath) as ArtifactTelemetryEntry[];
    return {
        path: filePath,
        exists: fs.existsSync(filePath),
        entries: entries.length,
        lastTimestamp: newestTimestamp(entries.map((entry) => entry.timestamp ?? entry.createdAt)),
    };
}

export function inspectObservability(input: {
    repositoryRoot: string;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
}): ObservabilitySummary {
    const startupWarnings: string[] = [];
    const startupFiles: JsonLineSummary[] = [];
    const startupMetricsDir = input.appDataDir
        ? path.join(input.appDataDir, 'startup-metrics')
        : undefined;

    if (!startupMetricsDir) {
        startupWarnings.push('No appDataDir provided; startup metrics inspection skipped.');
    } else if (!fs.existsSync(startupMetricsDir)) {
        startupWarnings.push(`Startup metrics directory not found: ${startupMetricsDir}`);
    } else {
        const fileNames = input.startupProfile
            ? [`${input.startupProfile}.jsonl`]
            : fs.readdirSync(startupMetricsDir).filter((name) => name.endsWith('.jsonl')).sort();
        for (const fileName of fileNames) {
            startupFiles.push(summarizeStartupMetricFile(path.join(startupMetricsDir, fileName)));
        }
        if (startupFiles.length === 0) {
            startupWarnings.push(`No startup metric JSONL files found under ${startupMetricsDir}`);
        }
    }

    const artifactWarnings: string[] = [];
    const artifactTelemetryPath = input.artifactTelemetryPath
        ?? path.join(input.repositoryRoot, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl');
    const artifactTelemetry = summarizeArtifactTelemetryFile(artifactTelemetryPath);
    if (!artifactTelemetry.exists) {
        artifactWarnings.push(`Artifact telemetry file not found: ${artifactTelemetryPath}`);
    } else if (artifactTelemetry.entries === 0) {
        artifactWarnings.push(`Artifact telemetry file is empty: ${artifactTelemetryPath}`);
    }

    return {
        startupMetrics: {
            inspected: Boolean(startupMetricsDir),
            files: startupFiles,
            warnings: startupWarnings,
        },
        artifactTelemetry: {
            ...artifactTelemetry,
            warnings: artifactWarnings,
        },
    };
}

export function summarizeControlPlaneEvalSummary(summaryPath: string): ControlPlaneEvalReadinessSummary {
    if (!fs.existsSync(summaryPath)) {
        return {
            summaryPath,
            exists: false,
            totalCases: 0,
            passedCases: 0,
            failedCases: 0,
            productionReplaySources: {},
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as RawControlPlaneEvalSummary;
        return {
            summaryPath,
            exists: true,
            totalCases: parsed.totals?.totalCases ?? 0,
            passedCases: parsed.totals?.passedCases ?? 0,
            failedCases: parsed.totals?.failedCases ?? 0,
            clarificationRate: parsed.metrics?.clarificationRate,
            unnecessaryClarificationRate: parsed.metrics?.unnecessaryClarificationRate,
            freezeExpectationPassRate: parsed.metrics?.contractFreezeExpectationPassRate,
            artifactExpectationPassRate: parsed.metrics?.artifactExpectationPassRate,
            artifactSatisfactionRate: parsed.metrics?.artifactSatisfactionRate,
            runtimeReplayPassRate: parsed.metrics?.runtimeReplayPassRate,
            productionReplaySources: Object.fromEntries(
                Object.entries(parsed.coverage?.productionReplaySources ?? {}).map(([sourceLabel, bucket]) => [
                    sourceLabel,
                    {
                        totalCases: bucket.totalCases ?? 0,
                        passedCases: bucket.passedCases ?? 0,
                        failedCases: bucket.failedCases ?? 0,
                        runtimeReplayCases: bucket.runtimeReplayCases ?? 0,
                        runtimeReplayPassedCases: bucket.runtimeReplayPassedCases ?? 0,
                    },
                ])
            ),
        };
    } catch {
        return {
            summaryPath,
            exists: false,
            totalCases: 0,
            passedCases: 0,
            failedCases: 0,
            productionReplaySources: {},
        };
    }
}

export function summarizeProductionReplayImportSummary(summaryPath: string): ProductionReplayImportSummary {
    if (!fs.existsSync(summaryPath)) {
        return {
            summaryPath,
            exists: false,
            totalCases: 0,
            bySource: {},
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as RawProductionReplayImportSummary;
        return {
            summaryPath,
            exists: true,
            totalCases: parsed.totalCases ?? 0,
            bySource: parsed.bySource ?? {},
            insertedCases: parsed.insertedCases,
            updatedCases: parsed.updatedCases,
            totalDatasetCases: parsed.totalDatasetCases,
        };
    } catch {
        return {
            summaryPath,
            exists: false,
            totalCases: 0,
            bySource: {},
        };
    }
}

export function recommendProductionReplayThresholds(
    importSummary: ProductionReplayImportSummary | undefined,
    controlPlaneEval: ControlPlaneEvalReadinessSummary | undefined,
    gate: ControlPlaneEvalGateResult | undefined,
): ProductionReplayThresholdRecommendation[] {
    if (!importSummary?.exists || !controlPlaneEval || !gate) {
        return [];
    }

    return Object.entries(importSummary.bySource)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([sourceLabel, importedCases]) => {
            if (importedCases <= 0) {
                return [];
            }

            const currentMinimum = gate.thresholds.minProductionReplayCasesBySource[sourceLabel] ?? 0;
            if (currentMinimum > 0) {
                return [];
            }

            const observedDatasetCases = Math.max(
                importedCases,
                controlPlaneEval.productionReplaySources[sourceLabel]?.totalCases ?? 0,
            );

            if (observedDatasetCases <= currentMinimum) {
                return [];
            }

            return [{
                sourceLabel,
                currentMinimum,
                importedCases,
                observedDatasetCases,
                suggestedMinimum: observedDatasetCases,
            }];
        });
}

export function buildControlPlaneThresholdUpdateSuggestion(
    gate: ControlPlaneEvalGateResult | undefined,
    recommendations: ProductionReplayThresholdRecommendation[],
): ControlPlaneThresholdUpdateSuggestion | undefined {
    if (!gate || recommendations.length === 0) {
        return undefined;
    }

    const recommendedMinProductionReplayCasesBySource = {
        ...gate.thresholds.minProductionReplayCasesBySource,
    };

    for (const recommendation of recommendations) {
        recommendedMinProductionReplayCasesBySource[recommendation.sourceLabel] = recommendation.suggestedMinimum;
    }

    return {
        sourcePath: gate.thresholdSourcePath,
        profile: gate.thresholdProfile ?? 'default',
        recommendedMinProductionReplayCasesBySource,
        recommendations,
    };
}

export function loadControlPlaneThresholdUpdateSuggestion(suggestionPath: string): ControlPlaneThresholdUpdateSuggestion {
    const raw = JSON.parse(fs.readFileSync(suggestionPath, 'utf-8'));
    return ControlPlaneThresholdUpdateSuggestionSchema.parse(raw);
}

export function applyControlPlaneThresholdUpdateSuggestion(
    currentConfig: unknown,
    suggestion: ControlPlaneThresholdUpdateSuggestion,
): unknown {
    const singleProfile = ControlPlaneEvalThresholdConfigSchema.safeParse(currentConfig);
    if (singleProfile.success) {
        return {
            ...singleProfile.data,
            minProductionReplayCasesBySource: suggestion.recommendedMinProductionReplayCasesBySource,
        };
    }

    const multiProfile = ControlPlaneEvalThresholdProfilesConfigSchema.parse(currentConfig);
    const targetProfile = multiProfile.profiles[suggestion.profile];
    if (!targetProfile) {
        throw new Error(
            `Threshold config does not contain profile ${JSON.stringify(suggestion.profile)}. ` +
            `Available profiles: ${Object.keys(multiProfile.profiles).sort().join(', ')}`
        );
    }

    return {
        ...multiProfile,
        profiles: {
            ...multiProfile.profiles,
            [suggestion.profile]: {
                ...targetProfile,
                minProductionReplayCasesBySource: suggestion.recommendedMinProductionReplayCasesBySource,
            },
        },
    };
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
    configPath: string,
    requestedProfile?: string,
): LoadedControlPlaneEvalThresholds {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const singleProfile = ControlPlaneEvalThresholdConfigSchema.safeParse(raw);

    if (singleProfile.success) {
        return {
            thresholds: {
                ...createDefaultControlPlaneEvalThresholds(),
                ...singleProfile.data,
            },
            sourcePath: configPath,
            profile: requestedProfile ?? 'default',
            availableProfiles: ['default'],
        };
    }

    const multiProfile = ControlPlaneEvalThresholdProfilesConfigSchema.parse(raw);
    const availableProfiles = Object.keys(multiProfile.profiles).sort();
    const selectedProfile = requestedProfile
        ?? multiProfile.defaultProfile
        ?? availableProfiles[0]
        ?? 'default';
    const selectedThresholds = multiProfile.profiles[selectedProfile];

    if (!selectedThresholds) {
        throw new Error(
            `Unknown control-plane threshold profile "${selectedProfile}" in ${configPath}. ` +
            `Available profiles: ${availableProfiles.join(', ')}`
        );
    }

    return {
        thresholds: {
            ...createDefaultControlPlaneEvalThresholds(),
            ...selectedThresholds,
        },
        sourcePath: configPath,
        profile: selectedProfile,
        availableProfiles,
    };
}

export function evaluateControlPlaneEvalReadiness(
    summary: ControlPlaneEvalReadinessSummary,
    thresholds: ControlPlaneEvalThresholds = createDefaultControlPlaneEvalThresholds(),
    thresholdSourcePath?: string,
    thresholdProfile?: string,
): ControlPlaneEvalGateResult {
    const findings: string[] = [];

    if (!summary.exists) {
        findings.push('Control-plane eval summary is missing.');
    }

    if (thresholds.requireZeroFailedCases && summary.failedCases > 0) {
        findings.push(`Control-plane eval has ${summary.failedCases} failed case(s).`);
    }

    if (
        typeof summary.unnecessaryClarificationRate === 'number' &&
        summary.unnecessaryClarificationRate > thresholds.maxUnnecessaryClarificationRate
    ) {
        findings.push(
            `Unnecessary clarification rate ${formatPercent(summary.unnecessaryClarificationRate)} exceeds threshold ${formatPercent(thresholds.maxUnnecessaryClarificationRate)}.`
        );
    }

    if (
        typeof summary.freezeExpectationPassRate === 'number' &&
        summary.freezeExpectationPassRate < thresholds.minFreezeExpectationPassRate
    ) {
        findings.push(
            `Freeze expectation pass rate ${formatPercent(summary.freezeExpectationPassRate)} is below threshold ${formatPercent(thresholds.minFreezeExpectationPassRate)}.`
        );
    }

    if (
        typeof summary.artifactExpectationPassRate === 'number' &&
        summary.artifactExpectationPassRate < thresholds.minArtifactExpectationPassRate
    ) {
        findings.push(
            `Artifact expectation pass rate ${formatPercent(summary.artifactExpectationPassRate)} is below threshold ${formatPercent(thresholds.minArtifactExpectationPassRate)}.`
        );
    }

    if (
        typeof summary.runtimeReplayPassRate === 'number' &&
        summary.runtimeReplayPassRate < thresholds.minRuntimeReplayPassRate
    ) {
        findings.push(
            `Runtime replay pass rate ${formatPercent(summary.runtimeReplayPassRate)} is below threshold ${formatPercent(thresholds.minRuntimeReplayPassRate)}.`
        );
    }

    for (const [sourceLabel, minCases] of Object.entries(thresholds.minProductionReplayCasesBySource)) {
        const actualCases = summary.productionReplaySources[sourceLabel]?.totalCases ?? 0;
        if (actualCases < minCases) {
            findings.push(
                `Production replay coverage for source ${JSON.stringify(sourceLabel)} has ${actualCases} case(s), below minimum ${minCases}.`
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

function formatPercent(value: number | null | undefined): string {
    if (typeof value !== 'number') {
        return 'n/a';
    }
    return `${(value * 100).toFixed(1)}%`;
}

export function createDefaultCanaryChecklist(): CanaryChecklistItem[] {
    return [
        {
            area: 'Audience',
            item: 'Restrict initial rollout to named internal testers or a small external beta cohort.',
            requiredEvidence: 'Tester list, install channel, and rollback contact owner documented.',
        },
        {
            area: 'Rollback',
            item: 'Keep the previous signed/notarized bundle and matching tag available for immediate rollback.',
            requiredEvidence: 'Previous release asset URLs or archived artifacts attached to the release issue.',
        },
        {
            area: 'Observability',
            item: 'Collect startup metrics and artifact telemetry from at least one canary session before widening the rollout.',
            requiredEvidence: 'Startup metrics JSONL path and artifact telemetry JSONL excerpt linked in release notes or issue.',
        },
        {
            area: 'Fault Injection',
            item: 'Run the database failure recovery scenario and verify logs show the expected recovery path.',
            requiredEvidence: 'Playwright report or captured logs from the failure-injection run.',
        },
        {
            area: 'Health',
            item: 'Check sidecar and managed service health after install and after the first task execution.',
            requiredEvidence: 'Health check output or screenshots from the dependency/service status UI.',
        },
        {
            area: 'Decision Gate',
            item: 'Hold rollout expansion until no blocker regression remains in readiness report warnings or failed stages.',
            requiredEvidence: 'Final go/no-go comment referencing the readiness report artifact.',
        },
    ];
}

export function renderReleaseReadinessMarkdown(report: ReleaseReadinessReport): string {
    const lines: string[] = [
        '# Release Readiness Report',
        '',
        `Generated: ${report.generatedAt}`,
        `Repository root: ${report.repositoryRoot}`,
        '',
        '## Requested Options',
        '',
        `- Build desktop: ${report.requestedOptions.buildDesktop ? 'yes' : 'no'}`,
        `- Real E2E: ${report.requestedOptions.realE2E ? 'yes' : 'no'}`,
        `- App data dir: ${report.requestedOptions.appDataDir ?? 'not provided'}`,
        `- Startup profile: ${report.requestedOptions.startupProfile ?? 'all available profiles'}`,
        `- Control-plane thresholds: ${report.requestedOptions.controlPlaneThresholdsPath ?? 'built-in defaults'}`,
        `- Control-plane threshold profile: ${report.requestedOptions.controlPlaneThresholdProfile ?? 'default'}`,
        `- Sync production replays: ${report.requestedOptions.syncProductionReplays ? 'yes' : 'no'}`,
        `- Production replay dataset: ${report.requestedOptions.productionReplayDatasetPath ?? 'default dataset path'}`,
        '',
        '## Stage Results',
        '',
    ];

    for (const stage of report.stages) {
        const note = stage.note ? ` — ${stage.note}` : '';
        lines.push(
            `- [${stage.status === 'passed' ? 'x' : ' '}] ${stage.label}: ` +
            `${stage.status} (${Math.round(stage.durationMs / 1000)}s, exit=${stage.exitCode ?? 'n/a'})` +
            `${stage.optional ? ' [optional]' : ''}${note}`
        );
        lines.push(`  Command: \`${stage.command}\``);
        lines.push(`  CWD: \`${stage.cwd}\``);
    }

    if (report.controlPlaneEval) {
        lines.push('', '## Control-Plane Eval', '');
        lines.push(`- Summary: \`${report.controlPlaneEval.summaryPath}\``);
        lines.push(
            `- Cases: ${report.controlPlaneEval.passedCases}/${report.controlPlaneEval.totalCases} passed` +
            `${report.controlPlaneEval.exists ? '' : ' (summary missing)'}`
        );
        lines.push(`- Clarification rate: ${formatPercent(report.controlPlaneEval.clarificationRate)}`);
        lines.push(`- Unnecessary clarification rate: ${formatPercent(report.controlPlaneEval.unnecessaryClarificationRate)}`);
        lines.push(`- Freeze expectation pass rate: ${formatPercent(report.controlPlaneEval.freezeExpectationPassRate)}`);
        lines.push(`- Artifact expectation pass rate: ${formatPercent(report.controlPlaneEval.artifactExpectationPassRate)}`);
        lines.push(`- Artifact satisfaction rate: ${formatPercent(report.controlPlaneEval.artifactSatisfactionRate)}`);
        lines.push(`- Runtime replay pass rate: ${formatPercent(report.controlPlaneEval.runtimeReplayPassRate)}`);
        for (const [sourceLabel, bucket] of Object.entries(report.controlPlaneEval.productionReplaySources)) {
            lines.push(
                `- Production replay coverage (${sourceLabel}): ` +
                `${bucket.passedCases}/${bucket.totalCases} passed, runtimeReplay ${bucket.runtimeReplayPassedCases}/${bucket.runtimeReplayCases}`
            );
        }
        if (report.controlPlaneEvalGate) {
            lines.push(`- Gate: ${report.controlPlaneEvalGate.passed ? 'passed' : 'failed'}`);
            lines.push(`- Thresholds: \`${report.controlPlaneEvalGate.thresholdSourcePath ?? 'built-in defaults'}\``);
            lines.push(`- Threshold profile: ${report.controlPlaneEvalGate.thresholdProfile ?? 'default'}`);
            lines.push(
                `- Max unnecessary clarification rate: ` +
                `${formatPercent(report.controlPlaneEvalGate.thresholds.maxUnnecessaryClarificationRate)}`
            );
            lines.push(
                `- Min freeze expectation pass rate: ` +
                `${formatPercent(report.controlPlaneEvalGate.thresholds.minFreezeExpectationPassRate)}`
            );
            lines.push(
                `- Min artifact expectation pass rate: ` +
                `${formatPercent(report.controlPlaneEvalGate.thresholds.minArtifactExpectationPassRate)}`
            );
            lines.push(
                `- Min runtime replay pass rate: ` +
                `${formatPercent(report.controlPlaneEvalGate.thresholds.minRuntimeReplayPassRate)}`
            );
            lines.push(
                `- Require zero failed cases: ` +
                `${report.controlPlaneEvalGate.thresholds.requireZeroFailedCases ? 'yes' : 'no'}`
            );
            for (const [sourceLabel, minCases] of Object.entries(report.controlPlaneEvalGate.thresholds.minProductionReplayCasesBySource)) {
                lines.push(`- Min production replay cases (${sourceLabel}): ${minCases}`);
            }
            for (const finding of report.controlPlaneEvalGate.findings) {
                lines.push(`- Gate finding: ${finding}`);
            }
        }
    }

    if (report.productionReplayImport) {
        lines.push('', '## Production Replay Import', '');
        lines.push(`- Summary: \`${report.productionReplayImport.summaryPath}\``);
        lines.push(`- Cases imported: ${report.productionReplayImport.totalCases}${report.productionReplayImport.exists ? '' : ' (summary missing)'}`);
        for (const [sourceLabel, count] of Object.entries(report.productionReplayImport.bySource)) {
            lines.push(`- Source ${sourceLabel}: ${count}`);
        }
        if (typeof report.productionReplayImport.insertedCases === 'number') {
            lines.push(`- Inserted cases: ${report.productionReplayImport.insertedCases}`);
        }
        if (typeof report.productionReplayImport.updatedCases === 'number') {
            lines.push(`- Updated cases: ${report.productionReplayImport.updatedCases}`);
        }
        if (typeof report.productionReplayImport.totalDatasetCases === 'number') {
            lines.push(`- Total dataset cases: ${report.productionReplayImport.totalDatasetCases}`);
        }
    }

    if (report.productionReplayThresholdRecommendations && report.productionReplayThresholdRecommendations.length > 0) {
        lines.push('', '## Production Replay Threshold Recommendations', '');
        for (const recommendation of report.productionReplayThresholdRecommendations) {
            lines.push(
                `- Source ${recommendation.sourceLabel}: current minimum ${recommendation.currentMinimum}, ` +
                `imported ${recommendation.importedCases}, observed dataset ${recommendation.observedDatasetCases}, ` +
                `suggested new minimum ${recommendation.suggestedMinimum}`
            );
        }
    }

    if (report.controlPlaneThresholdUpdateSuggestion) {
        lines.push('', '## Control-Plane Threshold Update Suggestion', '');
        lines.push(`- Artifact: \`${report.controlPlaneThresholdUpdateSuggestion.path}\``);
        lines.push(`- Profile: ${report.controlPlaneThresholdUpdateSuggestion.suggestion.profile}`);
        lines.push(
            `- Source config: ${report.controlPlaneThresholdUpdateSuggestion.suggestion.sourcePath ?? 'built-in defaults'}`
        );
        for (const [sourceLabel, minCases] of Object.entries(
            report.controlPlaneThresholdUpdateSuggestion.suggestion.recommendedMinProductionReplayCasesBySource
        )) {
            lines.push(`- Suggested min production replay cases (${sourceLabel}): ${minCases}`);
        }
    }

    if (report.controlPlaneThresholdCandidateConfig) {
        lines.push('', '## Control-Plane Threshold Candidate Config', '');
        lines.push(`- Artifact: \`${report.controlPlaneThresholdCandidateConfig.path}\``);
        lines.push(`- Base config: \`${report.controlPlaneThresholdCandidateConfig.baseConfigPath}\``);
    }

    lines.push('', '## Observability');
    lines.push('');

    if (report.observability.startupMetrics.files.length > 0) {
        for (const file of report.observability.startupMetrics.files) {
            lines.push(
                `- Startup metrics: \`${file.path}\` (${file.entries} entries` +
                `${file.lastTimestamp ? `, last=${file.lastTimestamp}` : ''})`
            );
        }
    } else {
        lines.push('- Startup metrics: no files inspected');
    }

    for (const warning of report.observability.startupMetrics.warnings) {
        lines.push(`- Warning: ${warning}`);
    }

    lines.push(
        `- Artifact telemetry: \`${report.observability.artifactTelemetry.path}\` ` +
        `(${report.observability.artifactTelemetry.entries} entries` +
        `${report.observability.artifactTelemetry.lastTimestamp ? `, last=${report.observability.artifactTelemetry.lastTimestamp}` : ''})`
    );
    for (const warning of report.observability.artifactTelemetry.warnings) {
        lines.push(`- Warning: ${warning}`);
    }

    lines.push('', '## Canary Checklist', '');
    for (const item of report.checklist) {
        lines.push(`- [ ] ${item.area}: ${item.item}`);
        lines.push(`  Evidence: ${item.requiredEvidence}`);
    }

    return `${lines.join('\n')}\n`;
}
