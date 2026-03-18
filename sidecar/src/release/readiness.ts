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

export type ReleaseReadinessReport = {
    generatedAt: string;
    repositoryRoot: string;
    requestedOptions: {
        buildDesktop: boolean;
        realE2E: boolean;
        appDataDir?: string;
        startupProfile?: string;
    };
    stages: ReleaseStageResult[];
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
