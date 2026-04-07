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
    note?: string;
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
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!mode) {
        throw new Error('Missing required --mode <pr|nightly|release>');
    }

    return { mode, subset, changed, outputPath, dryRun };
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
    };
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

function buildFindings(stages: StageResult[]): Finding[] {
    const findings: Finding[] = [];
    for (const stage of stages) {
        if (stage.status === 'failed' && !stage.optional) {
            findings.push({
                severity: 'hard_fail',
                stageId: stage.id,
                message: `Required stage failed: ${stage.label}`,
            });
        }
    }
    return findings;
}

function buildReport(
    repositoryRoot: string,
    options: CliOptions,
    stages: StageResult[],
    durationMs: number,
): CodexTestReport {
    const findings = buildFindings(stages);
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
            retriesEnabled: false,
            retriedStages: [],
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
        lines.push(`- [${stage.status}] ${stage.id}: ${stage.command}${note}`);
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
    const stageResults = plan.map((stage) => runStage(stage, options.dryRun));
    const report = buildReport(repositoryRoot, options, stageResults, Date.now() - startedAt);

    const outputPath = resolveOutputPath(repositoryRoot, options);
    ensureDir(outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

    const markdownPath = outputPath.replace(/\.json$/i, '.md');
    fs.writeFileSync(markdownPath, renderMarkdownSummary(report), 'utf-8');

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
