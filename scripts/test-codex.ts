import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

type Mode = 'pr' | 'nightly' | 'release';
type Subset = 'all' | 'sidecar' | 'desktop' | 'desktop-e2e' | 'nightly-tier2' | 'nightly-tier3';
type StageStatus = 'passed' | 'failed' | 'skipped';
type FindingSeverity = 'hard_fail' | 'quality_regression' | 'flaky_retry';

type CliOptions = {
    mode: Mode;
    subset: Subset;
    changed: string[];
    outputPath?: string;
    dryRun: boolean;
    retryFailures: number;
    qualityProfile?: string;
};

type StageDefinition = {
    id: string;
    label: string;
    cwd: string;
    command: string;
    args: string[];
    optional?: boolean;
    skipReason?: string;
};

type StageResult = {
    id: string;
    label: string;
    command: string;
    cwd: string;
    status: StageStatus;
    exitCode: number;
    durationMs: number;
    optional: boolean;
    attempts: number;
    note?: string;
};

type StageRunMeta = {
    result: StageResult;
    retried: boolean;
    flaky: boolean;
};

type Finding = {
    severity: FindingSeverity;
    stageId: string;
    message: string;
};

type CodexTestReport = {
    generatedAt: string;
    repositoryRoot: string;
    mode: Mode;
    subset: Subset;
    options: {
        changed: string[];
        dryRun: boolean;
        retryFailures: number;
        qualityProfile?: string;
    };
    summary: {
        totalStages: number;
        passedStages: number;
        failedStages: number;
        skippedStages: number;
        durationMs: number;
    };
    stages: StageResult[];
    findings: Finding[];
    flake: {
        retriesEnabled: boolean;
        retriedStages: string[];
    };
    exitDecision: {
        status: 'pass' | 'fail';
        hardFailCount: number;
        qualityRegressionCount: number;
    };
};

type ControlPlaneEvalThresholds = {
    maxUnnecessaryClarificationRate: number;
    minFreezeExpectationPassRate: number;
    minArtifactExpectationPassRate: number;
    minRuntimeReplayPassRate: number;
    requireZeroFailedCases: boolean;
    minProductionReplayCasesBySource: Record<string, number>;
};

type ControlPlaneEvalSummary = {
    exists: boolean;
    totalCases: number;
    failedCases: number;
    unnecessaryClarificationRate: number;
    freezeExpectationPassRate: number;
    artifactExpectationPassRate: number;
    runtimeReplayPassRate: number;
    productionReplaySources: Record<string, { totalCases: number }>;
    sourcePath: string;
};

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

function bin(name: string): string {
    return process.platform === 'win32' ? `${name}.cmd` : name;
}

function parseMode(value: string | undefined): Mode {
    if (value === 'pr' || value === 'nightly' || value === 'release') {
        return value;
    }
    throw new Error(`Invalid --mode value: ${value ?? '<missing>'}`);
}

function parseSubset(value: string | undefined): Subset {
    if (
        value === 'all'
        || value === 'sidecar'
        || value === 'desktop'
        || value === 'desktop-e2e'
        || value === 'nightly-tier2'
        || value === 'nightly-tier3'
    ) {
        return value;
    }
    throw new Error(`Invalid --subset value: ${value ?? '<missing>'}`);
}

function parseArgs(argv: string[]): CliOptions {
    let mode: Mode | undefined;
    let subset: Subset = 'all';
    let outputPath: string | undefined;
    let dryRun = false;
    let retryFailures = 1;
    let qualityProfile: string | undefined;
    const changed: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--mode':
                mode = parseMode(argv[index + 1]);
                index += 1;
                break;
            case '--subset':
                subset = parseSubset(argv[index + 1]);
                index += 1;
                break;
            case '--changed': {
                const next = argv[index + 1] ?? '';
                changed.push(...next.split(',').map((part) => part.trim()).filter((part) => part.length > 0));
                index += 1;
                break;
            }
            case '--output':
                outputPath = path.resolve(argv[index + 1] ?? '');
                index += 1;
                break;
            case '--dry-run':
                dryRun = true;
                break;
            case '--retry-failures': {
                const next = Number.parseInt(argv[index + 1] ?? '', 10);
                if (!Number.isFinite(next) || next < 0) {
                    throw new Error(`Invalid --retry-failures value: ${argv[index + 1] ?? '<missing>'}`);
                }
                retryFailures = next;
                index += 1;
                break;
            }
            case '--quality-profile':
                qualityProfile = (argv[index + 1] ?? '').trim() || undefined;
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!mode) {
        throw new Error('Missing required --mode <pr|nightly|release>');
    }

    return { mode, subset, changed, outputPath, dryRun, retryFailures, qualityProfile };
}

function ensureDir(targetPath: string): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function includesSubset(active: Subset, expected: Subset[]): boolean {
    return active === 'all' || expected.includes(active);
}

function toStageCommand(def: StageDefinition): string {
    return [def.command, ...def.args].join(' ').trim();
}

function runStage(def: StageDefinition, dryRun: boolean): StageResult {
    const startedAt = Date.now();

    if (def.skipReason) {
        return {
            id: def.id,
            label: def.label,
            command: toStageCommand(def),
            cwd: def.cwd,
            status: 'skipped',
            exitCode: 0,
            durationMs: 0,
            optional: Boolean(def.optional),
            attempts: 0,
            note: def.skipReason,
        };
    }

    if (dryRun) {
        return {
            id: def.id,
            label: def.label,
            command: toStageCommand(def),
            cwd: def.cwd,
            status: 'skipped',
            exitCode: 0,
            durationMs: 0,
            optional: Boolean(def.optional),
            attempts: 0,
            note: 'dry-run',
        };
    }

    console.log(`\n[codex-test] stage ${def.id}: ${def.label}`);
    console.log(`[codex-test] cmd: ${toStageCommand(def)}`);
    const result = spawnSync(def.command, def.args, {
        cwd: def.cwd,
        env: process.env,
        stdio: 'inherit',
    });
    const exitCode = result.status ?? 1;
    return {
        id: def.id,
        label: def.label,
        command: toStageCommand(def),
        cwd: def.cwd,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        durationMs: Date.now() - startedAt,
        optional: Boolean(def.optional),
        attempts: 1,
    };
}

function runStageWithRetry(def: StageDefinition, dryRun: boolean, retryFailures: number): StageRunMeta {
    const first = runStage(def, dryRun);
    if (dryRun || def.skipReason || first.status !== 'failed' || retryFailures <= 0) {
        return {
            result: first,
            retried: false,
            flaky: false,
        };
    }

    let attempts = first.attempts;
    let totalDurationMs = first.durationMs;
    let lastResult = first;
    for (let retryIndex = 1; retryIndex <= retryFailures; retryIndex += 1) {
        console.log(`[codex-test] retry ${retryIndex}/${retryFailures} for stage ${def.id}`);
        const retriedResult = runStage(def, false);
        attempts += retriedResult.attempts;
        totalDurationMs += retriedResult.durationMs;
        lastResult = retriedResult;
        if (retriedResult.status === 'passed') {
            return {
                result: {
                    ...retriedResult,
                    attempts,
                    durationMs: totalDurationMs,
                    note: `flaky_retry: passed after retry ${retryIndex}`,
                },
                retried: true,
                flaky: true,
            };
        }
    }

    return {
        result: {
            ...lastResult,
            attempts,
            durationMs: totalDurationMs,
            note: `failed after ${attempts} attempt(s)`,
        },
        retried: true,
        flaky: false,
    };
}

function createDefaultControlPlaneEvalThresholds(): ControlPlaneEvalThresholds {
    return {
        maxUnnecessaryClarificationRate: 0.05,
        minFreezeExpectationPassRate: 1,
        minArtifactExpectationPassRate: 1,
        minRuntimeReplayPassRate: 1,
        requireZeroFailedCases: true,
        minProductionReplayCasesBySource: {},
    };
}

function mergeThresholds(
    partial: Partial<ControlPlaneEvalThresholds> | undefined,
    defaults: ControlPlaneEvalThresholds,
): ControlPlaneEvalThresholds {
    const mergedBySource = partial?.minProductionReplayCasesBySource
        && typeof partial.minProductionReplayCasesBySource === 'object'
        ? Object.fromEntries(
            Object.entries(partial.minProductionReplayCasesBySource)
                .filter(([, count]) => typeof count === 'number' && Number.isFinite(count)),
        )
        : { ...defaults.minProductionReplayCasesBySource };
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
        minProductionReplayCasesBySource: mergedBySource,
    };
}

function resolveDefaultQualityProfile(mode: Mode): string {
    if (mode === 'release') {
        return 'ga';
    }
    if (mode === 'nightly') {
        return 'beta';
    }
    return 'canary';
}

function loadControlPlaneThresholds(
    repositoryRoot: string,
    mode: Mode,
    requestedProfile?: string,
): {
    profile: string;
    thresholds: ControlPlaneEvalThresholds;
    sourcePath: string;
} {
    const sourcePath = path.join(repositoryRoot, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json');
    const defaults = createDefaultControlPlaneEvalThresholds();
    if (!fs.existsSync(sourcePath)) {
        return {
            sourcePath,
            profile: requestedProfile ?? resolveDefaultQualityProfile(mode),
            thresholds: defaults,
        };
    }

    const root = toObject(JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))) ?? {};
    const profiles = toObject(root.profiles);
    if (!profiles) {
        return {
            sourcePath,
            profile: requestedProfile ?? 'default',
            thresholds: mergeThresholds(root as Partial<ControlPlaneEvalThresholds>, defaults),
        };
    }

    const selectedProfile = requestedProfile
        ?? resolveDefaultQualityProfile(mode)
        ?? (typeof root.defaultProfile === 'string' ? root.defaultProfile : 'default');
    const selectedProfileConfig = toObject(profiles[selectedProfile]);
    const fallbackProfile = typeof root.defaultProfile === 'string' ? root.defaultProfile : undefined;
    const fallbackConfig = fallbackProfile ? toObject(profiles[fallbackProfile]) : undefined;

    return {
        sourcePath,
        profile: selectedProfile,
        thresholds: mergeThresholds(
            (selectedProfileConfig ?? fallbackConfig ?? {}) as Partial<ControlPlaneEvalThresholds>,
            defaults,
        ),
    };
}

function summarizeControlPlaneEval(summaryPath: string): ControlPlaneEvalSummary {
    const sourcePath = path.resolve(summaryPath);
    if (!fs.existsSync(sourcePath)) {
        return {
            exists: false,
            sourcePath,
            totalCases: 0,
            failedCases: 0,
            unnecessaryClarificationRate: 0,
            freezeExpectationPassRate: 0,
            artifactExpectationPassRate: 0,
            runtimeReplayPassRate: 0,
            productionReplaySources: {},
        };
    }

    const root = toObject(JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))) ?? {};
    const totals = toObject(root.totals) ?? {};
    const metrics = toObject(root.metrics) ?? {};
    const coverage = toObject(root.coverage) ?? {};
    const productionReplaySourcesRaw = toObject(coverage.productionReplaySources) ?? {};
    const productionReplaySources: Record<string, { totalCases: number }> = {};
    for (const [source, value] of Object.entries(productionReplaySourcesRaw)) {
        const entry = toObject(value) ?? {};
        productionReplaySources[source] = {
            totalCases: toNumber(entry.totalCases, 0),
        };
    }

    return {
        exists: true,
        sourcePath,
        totalCases: toNumber(totals.totalCases, 0),
        failedCases: toNumber(totals.failedCases, 0),
        unnecessaryClarificationRate: toNumber(metrics.unnecessaryClarificationRate, 0),
        freezeExpectationPassRate: toNumber(metrics.contractFreezeExpectationPassRate, 0),
        artifactExpectationPassRate: toNumber(metrics.artifactExpectationPassRate, 0),
        runtimeReplayPassRate: toNumber(metrics.runtimeReplayPassRate, 0),
        productionReplaySources,
    };
}

function evaluateQualityRegressions(
    repositoryRoot: string,
    options: CliOptions,
    stages: StageResult[],
): Finding[] {
    const targetStage = stages.find((stage) => stage.id === 'sidecar-control-plane-eval');
    if (!targetStage || targetStage.status !== 'passed') {
        return [];
    }

    const summaryPath = path.join(repositoryRoot, 'artifacts', 'codex-test', 'control-plane-eval-summary.json');
    const summary = summarizeControlPlaneEval(summaryPath);
    const thresholdConfig = loadControlPlaneThresholds(repositoryRoot, options.mode, options.qualityProfile);
    const findings: Finding[] = [];

    if (!summary.exists) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `control-plane summary missing: ${summaryPath}`,
        });
        return findings;
    }

    if (thresholdConfig.thresholds.requireZeroFailedCases && summary.failedCases > 0) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `profile=${thresholdConfig.profile}: control-plane failedCases=${summary.failedCases} (expected 0)`,
        });
    }
    if (summary.unnecessaryClarificationRate > thresholdConfig.thresholds.maxUnnecessaryClarificationRate) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `profile=${thresholdConfig.profile}: unnecessary clarification ${(summary.unnecessaryClarificationRate * 100).toFixed(1)}% > ${(thresholdConfig.thresholds.maxUnnecessaryClarificationRate * 100).toFixed(1)}%`,
        });
    }
    if (summary.freezeExpectationPassRate < thresholdConfig.thresholds.minFreezeExpectationPassRate) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `profile=${thresholdConfig.profile}: freeze expectation ${(summary.freezeExpectationPassRate * 100).toFixed(1)}% < ${(thresholdConfig.thresholds.minFreezeExpectationPassRate * 100).toFixed(1)}%`,
        });
    }
    if (summary.artifactExpectationPassRate < thresholdConfig.thresholds.minArtifactExpectationPassRate) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `profile=${thresholdConfig.profile}: artifact expectation ${(summary.artifactExpectationPassRate * 100).toFixed(1)}% < ${(thresholdConfig.thresholds.minArtifactExpectationPassRate * 100).toFixed(1)}%`,
        });
    }
    if (summary.runtimeReplayPassRate < thresholdConfig.thresholds.minRuntimeReplayPassRate) {
        findings.push({
            severity: 'quality_regression',
            stageId: targetStage.id,
            message: `profile=${thresholdConfig.profile}: runtime replay ${(summary.runtimeReplayPassRate * 100).toFixed(1)}% < ${(thresholdConfig.thresholds.minRuntimeReplayPassRate * 100).toFixed(1)}%`,
        });
    }
    for (const [sourceLabel, minimum] of Object.entries(thresholdConfig.thresholds.minProductionReplayCasesBySource)) {
        const observed = summary.productionReplaySources[sourceLabel]?.totalCases ?? 0;
        if (observed < minimum) {
            findings.push({
                severity: 'quality_regression',
                stageId: targetStage.id,
                message: `profile=${thresholdConfig.profile}: production replay source ${sourceLabel} has ${observed} case(s), below minimum ${minimum}`,
            });
        }
    }

    return findings;
}

function buildStagePlan(repositoryRoot: string, options: CliOptions): StageDefinition[] {
    const sidecarDir = path.join(repositoryRoot, 'sidecar');
    const desktopDir = path.join(repositoryRoot, 'desktop');
    const controlPlaneOutPath = path.join(repositoryRoot, 'artifacts', 'codex-test', 'control-plane-eval-summary.json');
    const releaseReadinessOutDir = path.join(repositoryRoot, 'artifacts', 'release-readiness');

    const stages: StageDefinition[] = [];

    const addPrSidecarStages = (): void => {
        stages.push(
            {
                id: 'sidecar-typecheck',
                label: 'Sidecar Typecheck',
                cwd: sidecarDir,
                command: bin('npm'),
                args: ['run', 'typecheck'],
            },
            {
                id: 'sidecar-ci',
                label: 'Sidecar CI Stable Tests',
                cwd: sidecarDir,
                command: bin('npm'),
                args: ['run', 'test:ci'],
            },
            {
                id: 'sidecar-assistant-ui-contracts',
                label: 'Sidecar Assistant UI Stream Contracts',
                cwd: sidecarDir,
                command: bin('npm'),
                args: ['run', 'test:assistant-ui-contracts'],
            },
            {
                id: 'sidecar-control-plane-eval',
                label: 'Sidecar Control-Plane Eval',
                cwd: sidecarDir,
                command: bin('npm'),
                args: ['run', 'eval:control-plane', '--', '--out', controlPlaneOutPath],
            },
        );
    };

    const addPrDesktopStages = (): void => {
        stages.push(
            {
                id: 'desktop-typecheck',
                label: 'Desktop Typecheck',
                cwd: desktopDir,
                command: bin('npm'),
                args: ['run', 'typecheck'],
            },
            {
                id: 'desktop-ci',
                label: 'Desktop Acceptance Suite',
                cwd: desktopDir,
                command: bin('npm'),
                args: ['run', 'test:ci'],
            },
        );
    };

    const addDesktopE2EStage = (target: 'tier1' | 'tier2' | 'tier3'): void => {
        stages.push({
            id: `desktop-e2e-${target}`,
            label: `Desktop E2E ${target.toUpperCase()}`,
            cwd: desktopDir,
            command: bin('npm'),
            args: ['run', `test:e2e:${target}`],
        });
    };

    if (options.mode === 'pr') {
        if (includesSubset(options.subset, ['sidecar'])) {
            addPrSidecarStages();
        }
        if (includesSubset(options.subset, ['desktop'])) {
            addPrDesktopStages();
        }
        if (includesSubset(options.subset, ['desktop-e2e'])) {
            addDesktopE2EStage('tier1');
        }
        return stages;
    }

    if (options.mode === 'nightly') {
        if (includesSubset(options.subset, ['sidecar'])) {
            addPrSidecarStages();
        }
        if (includesSubset(options.subset, ['desktop'])) {
            addPrDesktopStages();
        }
        if (includesSubset(options.subset, ['desktop-e2e', 'nightly-tier2'])) {
            addDesktopE2EStage('tier2');
        }
        if (includesSubset(options.subset, ['desktop-e2e', 'nightly-tier3'])) {
            addDesktopE2EStage('tier3');
        }
        stages.push({
            id: 'sidecar-real-model-smoke',
            label: 'Sidecar Real-Model Smoke',
            cwd: sidecarDir,
            command: bin('npm'),
            args: ['run', 'test:real-model-smoke'],
            optional: true,
            skipReason: process.env.COWORKANY_REQUIRE_REAL_MODEL_SMOKE === '1'
                ? undefined
                : 'set COWORKANY_REQUIRE_REAL_MODEL_SMOKE=1 to enforce real-model gate',
        });
        return stages;
    }

    stages.push({
        id: 'release-readiness',
        label: 'Release Readiness Gate',
        cwd: sidecarDir,
        command: bin('bun'),
        args: [
            'run',
            'scripts/release-readiness.ts',
            '--build-desktop',
            '--real-e2e',
            '--real-model-smoke',
            '--output-dir',
            releaseReadinessOutDir,
        ],
    });
    return stages;
}

function buildFindings(stages: StageResult[], flakyStageIds: string[], qualityFindings: Finding[]): Finding[] {
    const findings: Finding[] = [...qualityFindings];
    for (const stage of stages) {
        if (stage.status === 'failed' && !stage.optional) {
            findings.push({
                severity: 'hard_fail',
                stageId: stage.id,
                message: `Required stage failed: ${stage.label}`,
            });
        }
    }
    for (const stageId of flakyStageIds) {
        findings.push({
            severity: 'flaky_retry',
            stageId,
            message: 'Stage failed on first attempt and passed on retry.',
        });
    }
    return findings;
}

function buildReport(
    repositoryRoot: string,
    options: CliOptions,
    stages: StageResult[],
    flakyStageIds: string[],
    retriedStages: string[],
    qualityFindings: Finding[],
    durationMs: number,
): CodexTestReport {
    const findings = buildFindings(stages, flakyStageIds, qualityFindings);
    const hardFailCount = findings.filter((finding) => finding.severity === 'hard_fail').length;
    const qualityRegressionCount = findings.filter((finding) => finding.severity === 'quality_regression').length;
    const passedStages = stages.filter((stage) => stage.status === 'passed').length;
    const failedStages = stages.filter((stage) => stage.status === 'failed').length;
    const skippedStages = stages.filter((stage) => stage.status === 'skipped').length;

    return {
        generatedAt: new Date().toISOString(),
        repositoryRoot,
        mode: options.mode,
        subset: options.subset,
        options: {
            changed: options.changed,
            dryRun: options.dryRun,
            retryFailures: options.retryFailures,
            qualityProfile: options.qualityProfile,
        },
        summary: {
            totalStages: stages.length,
            passedStages,
            failedStages,
            skippedStages,
            durationMs,
        },
        stages,
        findings,
        flake: {
            retriesEnabled: options.retryFailures > 0,
            retriedStages,
        },
        exitDecision: {
            status: hardFailCount > 0 ? 'fail' : 'pass',
            hardFailCount,
            qualityRegressionCount,
        },
    };
}

function renderMarkdownSummary(report: CodexTestReport): string {
    const lines: string[] = [];
    lines.push('# Codex Test Summary');
    lines.push('');
    lines.push(`- Mode: ${report.mode}`);
    lines.push(`- Subset: ${report.subset}`);
    lines.push(`- Decision: ${report.exitDecision.status.toUpperCase()}`);
    lines.push(`- Stages: ${report.summary.passedStages} passed / ${report.summary.failedStages} failed / ${report.summary.skippedStages} skipped`);
    lines.push(`- DurationMs: ${report.summary.durationMs}`);
    lines.push('');
    lines.push('## Stages');
    lines.push('');
    for (const stage of report.stages) {
        const note = stage.note ? ` | ${stage.note}` : '';
        const attempts = stage.attempts > 0 ? ` | attempts=${stage.attempts}` : '';
        lines.push(`- [${stage.status}] ${stage.id}: ${stage.command}${attempts}${note}`);
    }
    lines.push('');
    lines.push('## Findings');
    lines.push('');
    if (report.findings.length === 0) {
        lines.push('- none');
    } else {
        for (const finding of report.findings) {
            lines.push(`- ${finding.severity} (${finding.stageId}): ${finding.message}`);
        }
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function appendGitHubStepSummary(report: CodexTestReport, outputPath: string): void {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath || summaryPath.trim().length === 0) {
        return;
    }

    const lines: string[] = [];
    lines.push('## Codex Test Gate');
    lines.push('');
    lines.push(`- Mode: \`${report.mode}\``);
    lines.push(`- Subset: \`${report.subset}\``);
    lines.push(`- Decision: **${report.exitDecision.status.toUpperCase()}**`);
    lines.push(`- Stages: ${report.summary.passedStages} passed / ${report.summary.failedStages} failed / ${report.summary.skippedStages} skipped`);
    lines.push(`- Report JSON: \`${outputPath}\``);
    lines.push('');

    const quality = report.findings.filter((finding) => finding.severity === 'quality_regression');
    const hard = report.findings.filter((finding) => finding.severity === 'hard_fail');
    const flaky = report.findings.filter((finding) => finding.severity === 'flaky_retry');

    if (hard.length > 0) {
        lines.push('### Hard Fail');
        lines.push('');
        for (const finding of hard) {
            lines.push(`- \`${finding.stageId}\`: ${finding.message}`);
        }
        lines.push('');
    }

    if (quality.length > 0) {
        lines.push('### Quality Regression');
        lines.push('');
        for (const finding of quality) {
            lines.push(`- \`${finding.stageId}\`: ${finding.message}`);
        }
        lines.push('');
    }

    if (flaky.length > 0) {
        lines.push('### Flaky Retry');
        lines.push('');
        for (const finding of flaky) {
            lines.push(`- \`${finding.stageId}\`: ${finding.message}`);
        }
        lines.push('');
    }

    if (hard.length === 0 && quality.length === 0 && flaky.length === 0) {
        lines.push('### Findings');
        lines.push('');
        lines.push('- none');
        lines.push('');
    }

    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf-8');
}

function resolveOutputPath(repositoryRoot: string, options: CliOptions): string {
    if (options.outputPath) {
        return options.outputPath;
    }
    return path.join(repositoryRoot, 'artifacts', 'codex-test', 'report.json');
}

function main(): void {
    const startedAt = Date.now();
    const repositoryRoot = process.cwd();
    const options = parseArgs(process.argv.slice(2));
    const plan = buildStagePlan(repositoryRoot, options);
    const stageRuns = plan.map((stage) => runStageWithRetry(stage, options.dryRun, options.retryFailures));
    const stageResults = stageRuns.map((stageRun) => stageRun.result);
    const retriedStages = stageRuns.filter((stageRun) => stageRun.retried).map((stageRun) => stageRun.result.id);
    const flakyStageIds = stageRuns.filter((stageRun) => stageRun.flaky).map((stageRun) => stageRun.result.id);
    const qualityFindings = evaluateQualityRegressions(repositoryRoot, options, stageResults);
    const report = buildReport(
        repositoryRoot,
        options,
        stageResults,
        flakyStageIds,
        retriedStages,
        qualityFindings,
        Date.now() - startedAt,
    );

    const outputPath = resolveOutputPath(repositoryRoot, options);
    ensureDir(outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

    const markdownPath = outputPath.replace(/\.json$/i, '.md');
    fs.writeFileSync(markdownPath, renderMarkdownSummary(report), 'utf-8');
    appendGitHubStepSummary(report, outputPath);

    console.log(`\n[codex-test] report: ${outputPath}`);
    console.log(`[codex-test] markdown: ${markdownPath}`);

    if (report.exitDecision.status === 'fail') {
        process.exitCode = 1;
    }
}

try {
    main();
} catch (error) {
    console.error('[codex-test] fatal:', error);
    process.exitCode = 1;
}
