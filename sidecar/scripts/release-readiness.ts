import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
    applyControlPlaneThresholdUpdateSuggestion,
    buildControlPlaneThresholdUpdateSuggestion,
    evaluateControlPlaneEvalReadiness,
    createDefaultCanaryChecklist,
    inspectObservability,
    loadControlPlaneEvalThresholds,
    recommendProductionReplayThresholds,
    renderReleaseReadinessMarkdown,
    summarizeControlPlaneEvalSummary,
    summarizeProductionReplayImportSummary,
    type ReleaseReadinessReport,
    type ReleaseStageResult,
} from '../src/release/readiness';

type CliOptions = {
    buildDesktop: boolean;
    realE2E: boolean;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
    outputDir: string;
    controlPlaneThresholdsPath?: string;
    controlPlaneThresholdProfile?: string;
    syncProductionReplays: boolean;
    productionReplayImportRoots: string[];
    productionReplayDatasetPath?: string;
};

function bin(name: string): string {
    return process.platform === 'win32' ? `${name}.cmd` : name;
}

function parseArgs(argv: string[], repositoryRoot: string): CliOptions {
    const options: CliOptions = {
        buildDesktop: false,
        realE2E: false,
        appDataDir: process.env.COWORKANY_APP_DATA_DIR || undefined,
        startupProfile: process.env.COWORKANY_STARTUP_PROFILE || undefined,
        artifactTelemetryPath: process.env.COWORKANY_ARTIFACT_TELEMETRY_PATH || undefined,
        outputDir: path.join(repositoryRoot, 'artifacts', 'release-readiness'),
        controlPlaneThresholdsPath: process.env.COWORKANY_CONTROL_PLANE_THRESHOLDS || undefined,
        controlPlaneThresholdProfile: process.env.COWORKANY_CONTROL_PLANE_THRESHOLD_PROFILE || undefined,
        syncProductionReplays: false,
        productionReplayImportRoots: [],
        productionReplayDatasetPath: process.env.COWORKANY_PRODUCTION_REPLAY_DATASET || undefined,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--build-desktop':
                options.buildDesktop = true;
                break;
            case '--real-e2e':
                options.realE2E = true;
                break;
            case '--app-data-dir':
                options.appDataDir = argv[index + 1];
                index += 1;
                break;
            case '--startup-profile':
                options.startupProfile = argv[index + 1];
                index += 1;
                break;
            case '--artifact-telemetry':
                options.artifactTelemetryPath = argv[index + 1];
                index += 1;
                break;
            case '--output-dir':
                options.outputDir = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--control-plane-thresholds':
                options.controlPlaneThresholdsPath = argv[index + 1];
                index += 1;
                break;
            case '--control-plane-threshold-profile':
                options.controlPlaneThresholdProfile = argv[index + 1];
                index += 1;
                break;
            case '--sync-production-replays':
                options.syncProductionReplays = true;
                break;
            case '--production-replay-import-root':
                options.productionReplayImportRoots.push(argv[index + 1]);
                index += 1;
                break;
            case '--production-replay-dataset':
                options.productionReplayDatasetPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function runStage(input: {
    id: string;
    label: string;
    cwd: string;
    command: string;
    args: string[];
    optional?: boolean;
}): ReleaseStageResult {
    const startedAt = Date.now();
    const commandLine = [input.command, ...input.args].join(' ');
    console.log(`\n[release-readiness] ${input.label}`);
    console.log(`[release-readiness] cwd=${input.cwd}`);
    console.log(`[release-readiness] cmd=${commandLine}`);

    const result = spawnSync(input.command, input.args, {
        cwd: input.cwd,
        stdio: 'inherit',
        env: process.env,
    });

    const exitCode = result.status ?? (result.error ? 1 : 0);
    const status = exitCode === 0 ? 'passed' : input.optional ? 'skipped' : 'failed';
    const note = result.error ? String(result.error.message || result.error) : undefined;

    return {
        id: input.id,
        label: input.label,
        command: commandLine,
        cwd: input.cwd,
        durationMs: Date.now() - startedAt,
        status,
        exitCode,
        optional: input.optional,
        note,
    };
}

async function main(): Promise<void> {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const sidecarDir = path.resolve(scriptDir, '..');
    const repositoryRoot = path.resolve(sidecarDir, '..');
    const desktopDir = path.join(repositoryRoot, 'desktop');
    const options = parseArgs(process.argv.slice(2), repositoryRoot);
    fs.mkdirSync(options.outputDir, { recursive: true });
    const controlPlaneEvalSummaryPath = path.join(options.outputDir, 'control-plane-eval-summary.json');
    const productionReplayImportSummaryPath = path.join(options.outputDir, 'production-replay-import-summary.json');
    const controlPlaneEvalInputs: string[] = [];
    const controlPlaneThresholdsPath = path.resolve(
        options.controlPlaneThresholdsPath
            ?? path.join(sidecarDir, 'evals', 'control-plane', 'readiness-thresholds.json')
    );
    const controlPlaneEvalThresholds = loadControlPlaneEvalThresholds(
        controlPlaneThresholdsPath,
        options.controlPlaneThresholdProfile,
    );

    const stages: ReleaseStageResult[] = [];

    if (options.syncProductionReplays) {
        const syncArgs = ['run', 'eval:control-plane:sync-replays', '--', '--summary-out', productionReplayImportSummaryPath];
        if (options.productionReplayImportRoots.length > 0) {
            syncArgs.push('--replace-input-roots');
        }
        for (const inputRoot of options.productionReplayImportRoots) {
            syncArgs.push('--input-root', path.resolve(inputRoot));
        }
        if (options.productionReplayDatasetPath) {
            syncArgs.push('--dataset', options.productionReplayDatasetPath);
        }

        stages.push(runStage({
            id: 'production-replay-sync',
            label: 'Production replay sync',
            cwd: sidecarDir,
            command: bin('bun'),
            args: syncArgs,
        }));
    }

    if (options.productionReplayDatasetPath) {
        controlPlaneEvalInputs.push(path.join(sidecarDir, 'evals', 'control-plane'));
        controlPlaneEvalInputs.push(options.productionReplayDatasetPath);
    }

    stages.push(
        runStage({
            id: 'control-plane-eval',
            label: 'Control-plane eval suite',
            cwd: sidecarDir,
            command: bin('bun'),
            args: ['run', 'eval:control-plane', ...controlPlaneEvalInputs, '--out', controlPlaneEvalSummaryPath],
        }),
        runStage({
            id: 'sidecar-typecheck',
            label: 'Sidecar typecheck',
            cwd: sidecarDir,
            command: bin('npm'),
            args: ['run', 'typecheck'],
        }),
        runStage({
            id: 'sidecar-stable',
            label: 'Sidecar stable regression suite',
            cwd: sidecarDir,
            command: bin('npm'),
            args: ['run', 'test:stable'],
        }),
        runStage({
            id: 'sidecar-release-gates',
            label: 'Sidecar release gate tests',
            cwd: sidecarDir,
            command: bin('bun'),
            args: [
                'test',
                'tests/runtime-commands.test.ts',
                'tests/capability-commands.test.ts',
                'tests/workspace-commands.test.ts',
                'tests/task-event-bus.test.ts',
                'tests/task-session-store.test.ts',
                'tests/execution-runtime.test.ts',
                'tests/work-request-runtime.test.ts',
                'tests/planning-files.test.ts',
                'tests/release-readiness.test.ts',
            ],
        }),
        runStage({
            id: 'desktop-typecheck',
            label: 'Desktop typecheck',
            cwd: desktopDir,
            command: bin('npx'),
            args: ['tsc', '--noEmit'],
        }),
        runStage({
            id: 'desktop-acceptance',
            label: 'Desktop acceptance suite',
            cwd: desktopDir,
            command: bin('npm'),
            args: ['test'],
        }),
    );

    if (options.buildDesktop) {
        stages.push(runStage({
            id: 'desktop-build',
            label: 'Desktop production build',
            cwd: desktopDir,
            command: bin('npm'),
            args: ['run', 'build'],
        }));
    }

    if (options.realE2E) {
        stages.push(runStage({
            id: 'desktop-real-e2e',
            label: 'Desktop real E2E acceptance + fault injection',
            cwd: desktopDir,
            command: bin('npx'),
            args: [
                'playwright',
                'test',
                'tests/onboarding-clean-machine-e2e.test.ts',
                'tests/database-failure-recovery-e2e.test.ts',
                'tests/window-shell-mac-smoke.test.ts',
            ],
            optional: false,
        }));
    }

    const observability = inspectObservability({
        repositoryRoot,
        appDataDir: options.appDataDir,
        startupProfile: options.startupProfile,
        artifactTelemetryPath: options.artifactTelemetryPath,
    });
    const productionReplayImport = options.syncProductionReplays
        ? summarizeProductionReplayImportSummary(productionReplayImportSummaryPath)
        : undefined;
    const controlPlaneEval = summarizeControlPlaneEvalSummary(controlPlaneEvalSummaryPath);
    const controlPlaneEvalGate = evaluateControlPlaneEvalReadiness(
        controlPlaneEval,
        controlPlaneEvalThresholds.thresholds,
        controlPlaneEvalThresholds.sourcePath,
        controlPlaneEvalThresholds.profile,
    );
    const controlPlaneEvalStage = stages.find((stage) => stage.id === 'control-plane-eval');
    if (controlPlaneEvalStage && !controlPlaneEvalGate.passed) {
        controlPlaneEvalStage.status = 'failed';
        controlPlaneEvalStage.note = controlPlaneEvalGate.findings.join(' | ');
        controlPlaneEvalStage.exitCode = controlPlaneEvalStage.exitCode === 0 ? 1 : controlPlaneEvalStage.exitCode;
    }
    const productionReplayThresholdRecommendations = recommendProductionReplayThresholds(
        productionReplayImport,
        controlPlaneEval,
        controlPlaneEvalGate,
    );
    const controlPlaneThresholdUpdateSuggestion = buildControlPlaneThresholdUpdateSuggestion(
        controlPlaneEvalGate,
        productionReplayThresholdRecommendations,
    );
    let controlPlaneThresholdUpdateSuggestionPath: string | undefined;
    let controlPlaneThresholdCandidateConfigPath: string | undefined;
    if (controlPlaneThresholdUpdateSuggestion) {
        controlPlaneThresholdUpdateSuggestionPath = path.join(
            options.outputDir,
            'control-plane-threshold-update-suggestion.json',
        );
        fs.writeFileSync(
            controlPlaneThresholdUpdateSuggestionPath,
            JSON.stringify(controlPlaneThresholdUpdateSuggestion, null, 2),
            'utf-8',
        );
        controlPlaneThresholdCandidateConfigPath = path.join(
            options.outputDir,
            'control-plane-thresholds.candidate.json',
        );
        fs.writeFileSync(
            controlPlaneThresholdCandidateConfigPath,
            `${JSON.stringify(
                applyControlPlaneThresholdUpdateSuggestion(
                    JSON.parse(fs.readFileSync(controlPlaneEvalThresholds.sourcePath, 'utf-8')),
                    controlPlaneThresholdUpdateSuggestion,
                ),
                null,
                2,
            )}\n`,
            'utf-8',
        );
    }

    const report: ReleaseReadinessReport = {
        generatedAt: new Date().toISOString(),
        repositoryRoot,
        requestedOptions: {
            buildDesktop: options.buildDesktop,
            realE2E: options.realE2E,
            appDataDir: options.appDataDir,
            startupProfile: options.startupProfile,
            controlPlaneThresholdsPath: controlPlaneEvalThresholds.sourcePath,
            controlPlaneThresholdProfile: controlPlaneEvalThresholds.profile,
            syncProductionReplays: options.syncProductionReplays,
            productionReplayDatasetPath: options.productionReplayDatasetPath,
        },
        stages,
        productionReplayImport,
        productionReplayThresholdRecommendations,
        controlPlaneThresholdUpdateSuggestion: controlPlaneThresholdUpdateSuggestion && controlPlaneThresholdUpdateSuggestionPath
            ? {
                path: controlPlaneThresholdUpdateSuggestionPath,
                suggestion: controlPlaneThresholdUpdateSuggestion,
            }
            : undefined,
        controlPlaneThresholdCandidateConfig: controlPlaneThresholdCandidateConfigPath
            ? {
                path: controlPlaneThresholdCandidateConfigPath,
                baseConfigPath: controlPlaneEvalThresholds.sourcePath,
            }
            : undefined,
        controlPlaneEval,
        controlPlaneEvalGate,
        observability,
        checklist: createDefaultCanaryChecklist(),
    };

    const jsonPath = path.join(options.outputDir, 'report.json');
    const markdownPath = path.join(options.outputDir, 'report.md');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(markdownPath, renderReleaseReadinessMarkdown(report), 'utf-8');

    console.log(`\n[release-readiness] report: ${jsonPath}`);
    console.log(`[release-readiness] markdown: ${markdownPath}`);

    const hasFailure = stages.some((stage) => stage.status === 'failed');
    if (hasFailure) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('[release-readiness] fatal:', error);
    process.exitCode = 1;
});
