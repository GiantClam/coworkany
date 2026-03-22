import * as fs from 'fs';
import * as path from 'path';
import { inspectObservability, loadControlPlaneEvalThresholds, type ReleaseReadinessReport } from '../release/readiness';
import { planTaskRuntimeRecovery } from '../execution/taskRuntimeRecovery';
import type { PersistedTaskRuntimeRecord, PersistedTaskRuntimeStatus } from '../execution/taskRuntimeStore';
import { collectEventLogFiles, loadTaskEventsFromJsonl } from '../evals/controlPlaneEventLogImporter';
import { ExtensionGovernanceStore, type ExtensionGovernanceState } from '../extensions/governanceStore';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';
export type SidecarDoctorOverallStatus = 'healthy' | 'degraded' | 'blocked';

export type DoctorCheck = {
    id: string;
    label: string;
    status: DoctorCheckStatus;
    summary: string;
    details: string[];
};

export type SidecarDoctorReport = {
    generatedAt: string;
    repositoryRoot: string;
    appDataDir: string;
    readinessReportPath: string;
    controlPlaneThresholdsPath: string;
    controlPlaneThresholdProfile?: string;
    overallStatus: SidecarDoctorOverallStatus;
    checks: DoctorCheck[];
};

export type RunSidecarDoctorInput = {
    repositoryRoot: string;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
    incidentLogPaths?: string[];
    readinessReportPath?: string;
    controlPlaneThresholdsPath?: string;
    controlPlaneThresholdProfile?: string;
    now?: Date;
    staleRunningThresholdMs?: number;
    staleBlockedThresholdMs?: number;
};

type RawRuntimeRecord = Partial<PersistedTaskRuntimeRecord>;

const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 20 * 60 * 1000;
const DEFAULT_STALE_BLOCKED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const MEMORY_SOURCE_GUARDS: Array<{
    relativePath: string;
    patterns: Array<{
        regex: RegExp;
        description: string;
    }>;
}> = [
    {
        relativePath: path.join('sidecar', 'src', 'agent', 'reactLoop.ts'),
        patterns: [
            {
                regex: /\bgetMemoryContext\s*\(/,
                description: 'ReAct memory reads must go through getIsolatedMemoryContext(...)',
            },
            {
                regex: /\bsearchMemory\s*\(/,
                description: 'ReAct memory searches must stay task-scoped',
            },
        ],
    },
    {
        relativePath: path.join('sidecar', 'src', 'agent', 'autonomousAgent.ts'),
        patterns: [
            {
                regex: /\bgetMemoryContext\s*\(/,
                description: 'Autonomous memory reads must go through task-scoped isolation helpers',
            },
            {
                regex: /\bsearchMemory\s*\(/,
                description: 'Autonomous memory searches must stay task-scoped',
            },
        ],
    },
    {
        relativePath: path.join('sidecar', 'src', 'main.ts'),
        patterns: [
            {
                regex: /\basync function getRelevantMemoryContext\s*\(/,
                description: 'Legacy global memory context helper must stay removed',
            },
            {
                regex: /\basync function saveToMemoryVault\s*\(/,
                description: 'Legacy global memory write helper must stay removed',
            },
            {
                regex: /const taskId = `subtask_\$\{subtask\.id\}`;/,
                description: 'Autonomous subtask execution must not synthesize standalone task ids',
            },
        ],
    },
];

function getAppDataDir(repositoryRoot: string, appDataDir?: string): string {
    return appDataDir?.trim() || process.env.COWORKANY_APP_DATA_DIR?.trim() || path.join(repositoryRoot, '.coworkany');
}

function getReadinessReportPath(repositoryRoot: string, readinessReportPath?: string): string {
    return path.resolve(readinessReportPath ?? path.join(repositoryRoot, 'artifacts', 'release-readiness', 'report.json'));
}

function getThresholdsPath(repositoryRoot: string, controlPlaneThresholdsPath?: string): string {
    return path.resolve(
        controlPlaneThresholdsPath
            ?? path.join(repositoryRoot, 'sidecar', 'evals', 'control-plane', 'readiness-thresholds.json')
    );
}

function getDefaultIncidentLogRoots(repositoryRoot: string): string[] {
    return [
        path.join(repositoryRoot, 'sidecar', 'evals', 'control-plane', 'import-sources', 'canary'),
        path.join(repositoryRoot, 'sidecar', 'evals', 'control-plane', 'import-sources', 'beta'),
        path.join(repositoryRoot, 'sidecar', 'evals', 'control-plane', 'import-sources', 'ga'),
    ].filter((inputPath) => fs.existsSync(inputPath));
}

function isRuntimeStatus(value: unknown): value is PersistedTaskRuntimeStatus {
    return (
        value === 'running' ||
        value === 'suspended' ||
        value === 'interrupted' ||
        value === 'idle' ||
        value === 'finished' ||
        value === 'failed'
    );
}

function isRuntimeRecord(value: unknown): value is PersistedTaskRuntimeRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as RawRuntimeRecord;
    return (
        typeof candidate.taskId === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.workspacePath === 'string' &&
        typeof candidate.createdAt === 'string' &&
        typeof candidate.updatedAt === 'string' &&
        isRuntimeStatus(candidate.status) &&
        Array.isArray(candidate.conversation) &&
        typeof candidate.historyLimit === 'number' &&
        Array.isArray(candidate.artifactsCreated)
    );
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function parseTimestamp(value: string): number | null {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function inspectRuntimeStore(input: {
    filePath: string;
    now: Date;
    staleRunningThresholdMs: number;
    staleBlockedThresholdMs: number;
}): DoctorCheck {
    if (!fs.existsSync(input.filePath)) {
        return {
            id: 'runtime-store',
            label: 'Runtime store integrity',
            status: 'warn',
            summary: `Runtime store not found at ${input.filePath}`,
            details: [
                'No persisted runtime store exists yet. This is acceptable for a fresh environment, but incident replay and restart diagnosis will have less context.',
            ],
        };
    }

    let raw: unknown;
    try {
        raw = readJsonFile(input.filePath);
    } catch (error) {
        return {
            id: 'runtime-store',
            label: 'Runtime store integrity',
            status: 'fail',
            summary: `Runtime store is not valid JSON: ${input.filePath}`,
            details: [String(error)],
        };
    }

    if (!Array.isArray(raw)) {
        return {
            id: 'runtime-store',
            label: 'Runtime store integrity',
            status: 'fail',
            summary: 'Runtime store root must be an array of task records.',
            details: [`Path: ${input.filePath}`],
        };
    }

    const malformedIndices: number[] = [];
    const duplicateTaskIds = new Set<string>();
    const seenTaskIds = new Set<string>();
    const validRecords: PersistedTaskRuntimeRecord[] = [];

    raw.forEach((entry, index) => {
        if (!isRuntimeRecord(entry)) {
            malformedIndices.push(index);
            return;
        }
        if (seenTaskIds.has(entry.taskId)) {
            duplicateTaskIds.add(entry.taskId);
        }
        seenTaskIds.add(entry.taskId);
        validRecords.push(entry);
    });

    const nowEpochMs = input.now.getTime();
    const staleRunning = validRecords.filter((record) => {
        if (record.status !== 'running') return false;
        const updatedAt = parseTimestamp(record.updatedAt);
        return updatedAt !== null && nowEpochMs - updatedAt > input.staleRunningThresholdMs;
    });
    const staleBlocked = validRecords.filter((record) => {
        if (record.status !== 'suspended' && record.status !== 'interrupted') return false;
        const updatedAt = parseTimestamp(record.updatedAt);
        return updatedAt !== null && nowEpochMs - updatedAt > input.staleBlockedThresholdMs;
    });

    const recoveryPlanCounts = validRecords.reduce<Record<string, number>>((counts, record) => {
        const action = planTaskRuntimeRecovery(record);
        counts[action.type] = (counts[action.type] ?? 0) + 1;
        return counts;
    }, {});

    const details = [
        `Valid records: ${validRecords.length}`,
        `Recovery posture: ${
            Object.entries(recoveryPlanCounts).map(([type, count]) => `${type}=${count}`).join(', ') || 'none'
        }`,
    ];

    let status: DoctorCheckStatus = 'pass';
    let summary = `Runtime store healthy with ${validRecords.length} valid record(s).`;

    if (malformedIndices.length > 0) {
        status = 'fail';
        summary = `Runtime store contains ${malformedIndices.length} malformed record(s).`;
        details.push(`Malformed indices: ${malformedIndices.join(', ')}`);
    }

    if (duplicateTaskIds.size > 0) {
        status = 'fail';
        summary = `Runtime store contains duplicate task ids: ${Array.from(duplicateTaskIds).sort().join(', ')}`;
    }

    if (staleRunning.length > 0) {
        status = 'fail';
        summary = `Runtime store has ${staleRunning.length} stale running task(s).`;
        details.push(`Stale running tasks: ${staleRunning.map((record) => record.taskId).join(', ')}`);
    }

    if (status !== 'fail' && staleBlocked.length > 0) {
        status = 'warn';
        summary = `Runtime store has ${staleBlocked.length} long-lived suspended/interrupted task(s).`;
        details.push(`Long-lived blocked tasks: ${staleBlocked.map((record) => record.taskId).join(', ')}`);
    }

    return {
        id: 'runtime-store',
        label: 'Runtime store integrity',
        status,
        summary,
        details,
    };
}

function inspectIsolationContracts(filePath: string): DoctorCheck {
    if (!fs.existsSync(filePath)) {
        return {
            id: 'isolation-contracts',
            label: 'Session/memory/tenant isolation posture',
            status: 'warn',
            summary: `Runtime store not found at ${filePath}`,
            details: [
                'No persisted task sessions available to verify isolation contract coverage.',
            ],
        };
    }

    let raw: unknown;
    try {
        raw = readJsonFile(filePath);
    } catch (error) {
        return {
            id: 'isolation-contracts',
            label: 'Session/memory/tenant isolation posture',
            status: 'fail',
            summary: `Runtime store is not valid JSON: ${filePath}`,
            details: [String(error)],
        };
    }

    if (!Array.isArray(raw)) {
        return {
            id: 'isolation-contracts',
            label: 'Session/memory/tenant isolation posture',
            status: 'fail',
            summary: 'Runtime store root must be an array of task records.',
            details: [`Path: ${filePath}`],
        };
    }

    const validRecords = raw.filter(isRuntimeRecord);
    const missingContracts = validRecords
        .filter((record) => {
            const config = (record.config ?? {}) as Record<string, unknown>;
            return !config.sessionIsolationPolicy || !config.memoryIsolationPolicy || !config.tenantIsolationPolicy;
        })
        .map((record) => record.taskId);

    const unsafeOverrides = validRecords
        .filter((record) => {
            const config = (record.config ?? {}) as {
                sessionIsolationPolicy?: { allowWorkspaceOverride?: boolean };
                tenantIsolationPolicy?: { allowCrossWorkspaceFollowUp?: boolean; allowCrossWorkspaceMemory?: boolean; allowCrossUserMemory?: boolean };
            };
            return config.sessionIsolationPolicy?.allowWorkspaceOverride === true
                || config.tenantIsolationPolicy?.allowCrossWorkspaceFollowUp === true
                || config.tenantIsolationPolicy?.allowCrossWorkspaceMemory === true
                || config.tenantIsolationPolicy?.allowCrossUserMemory === true;
        })
        .map((record) => record.taskId);

    if (unsafeOverrides.length > 0) {
        return {
            id: 'isolation-contracts',
            label: 'Session/memory/tenant isolation posture',
            status: 'fail',
            summary: `Found ${unsafeOverrides.length} task session(s) with unsafe isolation overrides.`,
            details: [`Unsafe task ids: ${unsafeOverrides.join(', ')}`],
        };
    }

    if (missingContracts.length > 0) {
        return {
            id: 'isolation-contracts',
            label: 'Session/memory/tenant isolation posture',
            status: 'warn',
            summary: `Found ${missingContracts.length} task session(s) without full isolation contract coverage.`,
            details: [`Missing contract task ids: ${missingContracts.join(', ')}`],
        };
    }

    return {
        id: 'isolation-contracts',
        label: 'Session/memory/tenant isolation posture',
        status: 'pass',
        summary: `All ${validRecords.length} persisted task session(s) carry isolation contracts without unsafe overrides.`,
        details: [],
    };
}

function inspectControlPlaneReadiness(input: {
    reportPath: string;
    thresholdsPath: string;
    thresholdProfile?: string;
}): DoctorCheck {
    try {
        loadControlPlaneEvalThresholds(input.thresholdsPath, input.thresholdProfile);
    } catch (error) {
        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness posture',
            status: 'fail',
            summary: 'Control-plane threshold config is invalid or unreadable.',
            details: [String(error)],
        };
    }

    if (!fs.existsSync(input.reportPath)) {
        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness posture',
            status: 'warn',
            summary: `No release-readiness report found at ${input.reportPath}`,
            details: [
                'Run `bun run release:readiness` to produce an operator-grade readiness artifact before rollout.',
            ],
        };
    }

    let report: ReleaseReadinessReport;
    try {
        report = readJsonFile(input.reportPath) as ReleaseReadinessReport;
    } catch (error) {
        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness posture',
            status: 'fail',
            summary: 'Release-readiness report is not valid JSON.',
            details: [String(error)],
        };
    }

    const failedStages = (report.stages ?? []).filter((stage) => stage.status === 'failed');
    const gateFindings = report.controlPlaneEvalGate?.findings ?? [];
    const pendingThresholdRecommendations = report.productionReplayThresholdRecommendations ?? [];
    const details: string[] = [];

    if (report.controlPlaneEval) {
        details.push(
            `Control-plane cases: ${report.controlPlaneEval.passedCases}/${report.controlPlaneEval.totalCases} passed`
        );
    }
    if (failedStages.length > 0) {
        details.push(`Failed stages: ${failedStages.map((stage) => stage.id).join(', ')}`);
    }
    if (gateFindings.length > 0) {
        details.push(...gateFindings.map((finding) => `Gate finding: ${finding}`));
    }
    if (pendingThresholdRecommendations.length > 0) {
        details.push(
            `Pending threshold recommendations: ${pendingThresholdRecommendations
                .map((item) => `${item.sourceLabel}=>${item.suggestedMinimum}`)
                .join(', ')}`
        );
    }
    if (report.controlPlaneThresholdCandidateConfig?.path) {
        details.push(`Candidate config: ${report.controlPlaneThresholdCandidateConfig.path}`);
    }

    if (failedStages.length > 0 || report.controlPlaneEvalGate?.passed === false) {
        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness posture',
            status: 'fail',
            summary: 'Latest release-readiness artifact reports a failing gate or failed stage.',
            details,
        };
    }

    if (pendingThresholdRecommendations.length > 0) {
        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness posture',
            status: 'warn',
            summary: 'Latest readiness artifact is green, but threshold governance follow-up is pending.',
            details,
        };
    }

    return {
        id: 'control-plane-readiness',
        label: 'Control-plane readiness posture',
        status: 'pass',
        summary: 'Latest readiness artifact is present and passing.',
        details,
    };
}

function inspectObservabilityCheck(input: {
    repositoryRoot: string;
    appDataDir: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
}): DoctorCheck {
    const summary = inspectObservability({
        repositoryRoot: input.repositoryRoot,
        appDataDir: input.appDataDir,
        startupProfile: input.startupProfile,
        artifactTelemetryPath: input.artifactTelemetryPath,
    });

    const details: string[] = [];
    for (const file of summary.startupMetrics.files) {
        details.push(`Startup metrics: ${file.path} (${file.entries} entr${file.entries === 1 ? 'y' : 'ies'})`);
    }
    for (const warning of summary.startupMetrics.warnings) {
        details.push(`Startup warning: ${warning}`);
    }
    details.push(`Artifact telemetry: ${summary.artifactTelemetry.path} (${summary.artifactTelemetry.entries} entries)`);
    for (const warning of summary.artifactTelemetry.warnings) {
        details.push(`Artifact warning: ${warning}`);
    }

    const warningCount = summary.startupMetrics.warnings.length + summary.artifactTelemetry.warnings.length;
    return {
        id: 'observability',
        label: 'Observability coverage',
        status: warningCount > 0 ? 'warn' : 'pass',
        summary: warningCount > 0
            ? `Observability coverage has ${warningCount} warning(s).`
            : 'Startup metrics and artifact telemetry are present.',
        details,
    };
}

type ArtifactTelemetryEntry = {
    passed?: boolean;
    requirementResults?: Array<{
        kind?: string;
        passed?: boolean;
    }>;
};

function inspectAnomalySignals(input: {
    repositoryRoot: string;
    incidentLogPaths?: string[];
    artifactTelemetryPath?: string;
}): DoctorCheck {
    const configuredIncidentPaths = input.incidentLogPaths && input.incidentLogPaths.length > 0
        ? input.incidentLogPaths.map((incidentPath) => path.resolve(incidentPath))
        : getDefaultIncidentLogRoots(input.repositoryRoot);
    const artifactTelemetryPath = path.resolve(
        input.artifactTelemetryPath
            ?? path.join(input.repositoryRoot, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl')
    );

    const details: string[] = [];
    const repeatedReopenLogs: string[] = [];
    const repeatedClarificationLogs: string[] = [];
    let scannedIncidentLogs = 0;

    if (configuredIncidentPaths.length > 0) {
        const eventLogs = collectEventLogFiles(configuredIncidentPaths);
        scannedIncidentLogs = eventLogs.length;
        for (const eventLog of eventLogs) {
            const events = loadTaskEventsFromJsonl(eventLog);
            const reopenCount = events.filter((event) => event.type === 'TASK_CONTRACT_REOPENED').length;
            const clarificationCount = events.filter((event) => event.type === 'TASK_CLARIFICATION_REQUIRED').length;
            if (reopenCount >= 2) {
                repeatedReopenLogs.push(`${path.basename(eventLog)}(${reopenCount})`);
            }
            if (clarificationCount >= 2) {
                repeatedClarificationLogs.push(`${path.basename(eventLog)}(${clarificationCount})`);
            }
        }
        details.push(`Incident logs scanned: ${scannedIncidentLogs}`);
    } else {
        details.push('Incident logs scanned: 0 (no incident log roots found)');
    }

    let degradedTelemetrySignals = 0;
    if (fs.existsSync(artifactTelemetryPath)) {
        const telemetryEntries = fs.readFileSync(artifactTelemetryPath, 'utf-8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line) as ArtifactTelemetryEntry];
                } catch {
                    return [];
                }
            });

        degradedTelemetrySignals = telemetryEntries.filter((entry) => {
            if (entry.passed !== false) {
                return false;
            }
            return (entry.requirementResults ?? []).some((result) =>
                (result.kind === 'file' || result.kind === 'format') && result.passed === false
            );
        }).length;
        details.push(`Artifact degradation signals: ${degradedTelemetrySignals}`);
    } else {
        details.push(`Artifact degradation signals: unavailable (${artifactTelemetryPath} missing)`);
    }

    if (repeatedReopenLogs.length > 0) {
        details.push(`Repeated reopen anomalies: ${repeatedReopenLogs.join(', ')}`);
    }
    if (repeatedClarificationLogs.length > 0) {
        details.push(`Repeated clarification anomalies: ${repeatedClarificationLogs.join(', ')}`);
    }

    const anomalyCount = repeatedReopenLogs.length + repeatedClarificationLogs.length + (degradedTelemetrySignals > 0 ? 1 : 0);
    if (anomalyCount === 0) {
        return {
            id: 'anomaly-signals',
            label: 'Incident anomaly signals',
            status: 'pass',
            summary: 'No repeated reopen, clarification, or degraded-output anomalies detected.',
            details,
        };
    }

    return {
        id: 'anomaly-signals',
        label: 'Incident anomaly signals',
        status: 'warn',
        summary: `Detected ${anomalyCount} anomaly signal group(s) across incident logs or artifact telemetry.`,
        details,
    };
}

function inspectMemoryIsolationSources(repositoryRoot: string): DoctorCheck {
    const findings: string[] = [];
    const scannedFiles: string[] = [];

    for (const guard of MEMORY_SOURCE_GUARDS) {
        const filePath = path.join(repositoryRoot, guard.relativePath);
        if (!fs.existsSync(filePath)) {
            continue;
        }

        scannedFiles.push(guard.relativePath);
        const source = fs.readFileSync(filePath, 'utf-8');
        const lines = source.split(/\r?\n/);

        for (const pattern of guard.patterns) {
            for (let index = 0; index < lines.length; index++) {
                if (pattern.regex.test(lines[index])) {
                    findings.push(`${guard.relativePath}:${index + 1} ${pattern.description}`);
                }
            }
        }
    }

    if (findings.length > 0) {
        return {
            id: 'memory-source-guards',
            label: 'Runtime memory source guards',
            status: 'fail',
            summary: `Detected ${findings.length} global memory access anti-pattern(s) in guarded runtime sources.`,
            details: findings,
        };
    }

    return {
        id: 'memory-source-guards',
        label: 'Runtime memory source guards',
        status: 'pass',
        summary: scannedFiles.length > 0
            ? `Guarded runtime sources are free of known global memory bypass patterns (${scannedFiles.length} file(s) scanned).`
            : 'No guarded runtime source files were present in this repository snapshot.',
        details: scannedFiles.length > 0 ? [`Scanned files: ${scannedFiles.join(', ')}`] : [],
    };
}

function readEnabledSkillIds(repositoryRoot: string): Set<string> {
    const filePath = path.join(repositoryRoot, '.coworkany', 'skills.json');
    if (!fs.existsSync(filePath)) {
        return new Set();
    }

    const raw = readJsonFile(filePath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`Invalid skills store format: ${filePath}`);
    }

    const enabled = new Set<string>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const record = value as {
            enabled?: boolean;
            manifest?: { name?: string };
        };
        if (record.enabled !== true) {
            continue;
        }
        const name = typeof record.manifest?.name === 'string' && record.manifest.name.length > 0
            ? record.manifest.name
            : key;
        enabled.add(name);
    }
    return enabled;
}

function readEnabledToolpackIds(repositoryRoot: string): Set<string> {
    const filePath = path.join(repositoryRoot, '.coworkany', 'toolpacks.json');
    if (!fs.existsSync(filePath)) {
        return new Set();
    }

    const raw = readJsonFile(filePath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`Invalid toolpack store format: ${filePath}`);
    }

    const enabled = new Set<string>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const record = value as {
            enabled?: boolean;
            manifest?: { id?: string; name?: string };
        };
        if (record.enabled !== true) {
            continue;
        }
        const id = typeof record.manifest?.id === 'string' && record.manifest.id.length > 0
            ? record.manifest.id
            : (typeof record.manifest?.name === 'string' && record.manifest.name.length > 0
                ? record.manifest.name
                : key);
        enabled.add(id);
    }
    return enabled;
}

function isGovernancePendingAndEnabled(
    state: ExtensionGovernanceState,
    enabledSkillIds: Set<string>,
    enabledToolpackIds: Set<string>,
): boolean {
    if (!state.pendingReview) {
        return false;
    }
    if (state.extensionType === 'skill') {
        return enabledSkillIds.has(state.extensionId);
    }
    return enabledToolpackIds.has(state.extensionId);
}

function inspectExtensionGovernance(input: {
    repositoryRoot: string;
    appDataDir: string;
}): DoctorCheck {
    const governancePath = path.join(input.appDataDir, 'extension-governance.json');
    let enabledSkillIds: Set<string>;
    let enabledToolpackIds: Set<string>;
    try {
        enabledSkillIds = readEnabledSkillIds(input.repositoryRoot);
        enabledToolpackIds = readEnabledToolpackIds(input.repositoryRoot);
    } catch (error) {
        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'fail',
            summary: 'Failed to load extension registries.',
            details: [String(error)],
        };
    }
    const enabledExtensionCount = enabledSkillIds.size + enabledToolpackIds.size;

    if (!fs.existsSync(governancePath)) {
        if (enabledExtensionCount === 0) {
            return {
                id: 'extension-governance',
                label: 'Extension governance posture',
                status: 'pass',
                summary: 'No enabled third-party extensions detected; governance store has not been created yet.',
                details: [],
            };
        }
        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'fail',
            summary: `Extension governance store not found at ${governancePath} while third-party extensions are enabled.`,
            details: [
                `Enabled third-party skills: ${enabledSkillIds.size}`,
                `Enabled third-party toolpacks: ${enabledToolpackIds.size}`,
            ],
        };
    }

    let states: ExtensionGovernanceState[];
    try {
        states = new ExtensionGovernanceStore(governancePath).list();
    } catch (error) {
        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'fail',
            summary: 'Failed to load extension governance evidence.',
            details: [String(error)],
        };
    }

    const pendingStates = states.filter((state) => state.pendingReview);
    const pendingAndEnabled = pendingStates.filter((state) =>
        isGovernancePendingAndEnabled(state, enabledSkillIds, enabledToolpackIds)
    );

    const details = [
        `Governance records: ${states.length}`,
        `Pending reviews: ${pendingStates.length}`,
    ];
    if (pendingStates.length > 0) {
        details.push(
            `Pending extension ids: ${pendingStates.map((state) => `${state.extensionType}:${state.extensionId}`).join(', ')}`
        );
    }
    if (pendingAndEnabled.length > 0) {
        details.push(
            `Pending and enabled: ${pendingAndEnabled.map((state) => `${state.extensionType}:${state.extensionId}`).join(', ')}`
        );
    }

    if (pendingAndEnabled.length > 0) {
        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'fail',
            summary: `Detected ${pendingAndEnabled.length} extension(s) with pending governance review still enabled.`,
            details,
        };
    }

    if (pendingStates.length > 0) {
        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'warn',
            summary: `Detected ${pendingStates.length} extension(s) pending governance review.`,
            details,
        };
    }

    return {
        id: 'extension-governance',
        label: 'Extension governance posture',
        status: 'pass',
        summary: `All ${states.length} extension governance record(s) are approved.`,
        details,
    };
}

function deriveOverallStatus(checks: DoctorCheck[]): SidecarDoctorOverallStatus {
    if (checks.some((check) => check.status === 'fail')) {
        return 'blocked';
    }
    if (checks.some((check) => check.status === 'warn')) {
        return 'degraded';
    }
    return 'healthy';
}

export function formatSidecarDoctorReport(report: SidecarDoctorReport): string {
    const lines = [
        'Sidecar doctor report',
        `Overall: ${report.overallStatus}`,
        `App data: ${report.appDataDir}`,
        `Readiness report: ${report.readinessReportPath}`,
        `Thresholds: ${report.controlPlaneThresholdsPath} (${report.controlPlaneThresholdProfile ?? 'default'})`,
        '',
    ];

    for (const check of report.checks) {
        lines.push(`[${check.status.toUpperCase()}] ${check.label}: ${check.summary}`);
        for (const detail of check.details) {
            lines.push(`- ${detail}`);
        }
        lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

export function runSidecarDoctor(input: RunSidecarDoctorInput): SidecarDoctorReport {
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const appDataDir = getAppDataDir(repositoryRoot, input.appDataDir);
    const readinessReportPath = getReadinessReportPath(repositoryRoot, input.readinessReportPath);
    const controlPlaneThresholdsPath = getThresholdsPath(repositoryRoot, input.controlPlaneThresholdsPath);
    const now = input.now ?? new Date();
    const runtimeStorePath = path.join(appDataDir, 'task-runtime.json');

    const checks: DoctorCheck[] = [
        inspectRuntimeStore({
            filePath: runtimeStorePath,
            now,
            staleRunningThresholdMs: input.staleRunningThresholdMs ?? DEFAULT_STALE_RUNNING_THRESHOLD_MS,
            staleBlockedThresholdMs: input.staleBlockedThresholdMs ?? DEFAULT_STALE_BLOCKED_THRESHOLD_MS,
        }),
        inspectIsolationContracts(runtimeStorePath),
        inspectExtensionGovernance({
            repositoryRoot,
            appDataDir,
        }),
        inspectMemoryIsolationSources(repositoryRoot),
        inspectControlPlaneReadiness({
            reportPath: readinessReportPath,
            thresholdsPath: controlPlaneThresholdsPath,
            thresholdProfile: input.controlPlaneThresholdProfile,
        }),
        inspectObservabilityCheck({
            repositoryRoot,
            appDataDir,
            startupProfile: input.startupProfile,
            artifactTelemetryPath: input.artifactTelemetryPath,
        }),
        inspectAnomalySignals({
            repositoryRoot,
            incidentLogPaths: input.incidentLogPaths,
            artifactTelemetryPath: input.artifactTelemetryPath,
        }),
    ];

    return {
        generatedAt: now.toISOString(),
        repositoryRoot,
        appDataDir,
        readinessReportPath,
        controlPlaneThresholdsPath,
        controlPlaneThresholdProfile: input.controlPlaneThresholdProfile,
        overallStatus: deriveOverallStatus(checks),
        checks,
    };
}
