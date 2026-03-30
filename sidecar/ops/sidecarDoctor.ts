import * as fs from 'fs';
import * as path from 'path';
import {
    inspectObservability,
} from './readiness';

type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

type DoctorCheck = {
    id: string;
    label: string;
    status: DoctorCheckStatus;
    summary: string;
};

export type SidecarDoctorReport = {
    generatedAt: string;
    repositoryRoot: string;
    appDataDir?: string;
    overallStatus: 'healthy' | 'degraded' | 'blocked';
    checks: DoctorCheck[];
};

type RuntimeTaskRecord = {
    taskId?: string;
    updatedAt?: string;
    status?: string;
};

type ExtensionGovernanceState = {
    extensionType?: string;
    extensionId?: string;
    pendingReview?: boolean;
};

function readEnabledExtensionIds(repositoryRoot: string): {
    skills: string[];
    toolpacks: string[];
} {
    const stateRoot = path.join(repositoryRoot, '.coworkany');
    const skillsPath = path.join(stateRoot, 'skills.json');
    const toolpacksPath = path.join(stateRoot, 'toolpacks.json');
    const skills = readEnabledIds(skillsPath, 'name');
    const toolpacks = readEnabledIds(toolpacksPath, 'id');
    return { skills, toolpacks };
}

function readEnabledIds(storePath: string, preferredManifestField: 'name' | 'id'): string[] {
    if (!fs.existsSync(storePath)) {
        return [];
    }
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }
    const enabled = new Set<string>();
    for (const [fallbackId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }
        const entry = value as {
            enabled?: boolean;
            manifest?: { id?: string; name?: string };
        };
        if (entry.enabled !== true) {
            continue;
        }
        const manifestId = preferredManifestField === 'id'
            ? entry.manifest?.id
            : entry.manifest?.name;
        const resolved = typeof manifestId === 'string' && manifestId.trim().length > 0
            ? manifestId.trim()
            : fallbackId.trim();
        if (resolved.length > 0) {
            enabled.add(resolved);
        }
    }
    return Array.from(enabled).sort((left, right) => left.localeCompare(right));
}

function readRuntimeRecords(taskRuntimePath: string): RuntimeTaskRecord[] {
    if (!fs.existsSync(taskRuntimePath)) {
        return [];
    }
    const raw = JSON.parse(fs.readFileSync(taskRuntimePath, 'utf-8')) as unknown;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((entry): entry is RuntimeTaskRecord => !!entry && typeof entry === 'object')
        .map((entry) => entry);
}

function readIncidentEvents(logRoots: string[]): Array<{ type: string }> {
    const events: Array<{ type: string }> = [];
    for (const logRoot of logRoots) {
        if (!fs.existsSync(logRoot)) {
            continue;
        }
        const stats = fs.statSync(logRoot);
        const files: string[] = stats.isDirectory()
            ? fs.readdirSync(logRoot)
                .filter((name) => name.endsWith('.jsonl'))
                .map((name) => path.join(logRoot, name))
            : [logRoot];
        for (const filePath of files) {
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            for (const line of content.split(/\r?\n/)) {
                if (line.trim().length === 0) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(line) as unknown;
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        const type = (parsed as { type?: unknown }).type;
                        if (typeof type === 'string') {
                            events.push({ type });
                        }
                    }
                } catch {
                    // Ignore malformed single lines; this is diagnostics-only telemetry.
                }
            }
        }
    }
    return events;
}

function countArtifactDegradationSignals(artifactTelemetryPath: string): number {
    if (!fs.existsSync(artifactTelemetryPath)) {
        return 0;
    }
    let degraded = 0;
    const content = fs.readFileSync(artifactTelemetryPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
        if (line.trim().length === 0) {
            continue;
        }
        try {
            const parsed = JSON.parse(line) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const passed = (parsed as { passed?: unknown }).passed;
                if (passed === false) {
                    degraded += 1;
                }
            }
        } catch {
            // Ignore malformed line.
        }
    }
    return degraded;
}

function readGovernanceStates(governancePath: string): ExtensionGovernanceState[] {
    if (!fs.existsSync(governancePath)) {
        return [];
    }
    const raw = JSON.parse(fs.readFileSync(governancePath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }
    const states = (raw as { states?: unknown }).states;
    if (!states || typeof states !== 'object' || Array.isArray(states)) {
        return [];
    }
    return Object.values(states as Record<string, unknown>)
        .filter((entry): entry is ExtensionGovernanceState => !!entry && typeof entry === 'object');
}

function collectMemorySourceGuardFindings(repositoryRoot: string): string[] {
    const findings: string[] = [];
    const sourcePath = path.join(repositoryRoot, 'sidecar', 'src', 'main.ts');
    if (!fs.existsSync(sourcePath)) {
        return findings;
    }
    const source = fs.readFileSync(sourcePath, 'utf-8');
    if (source.includes('getRelevantMemoryContext(')) {
        findings.push('Detected global memory access anti-pattern (getRelevantMemoryContext).');
    }
    if (source.includes('subtask_${subtask.id}')) {
        findings.push('Detected logic that can synthesize standalone task ids from subtasks.');
    }
    return findings;
}

function summarizeOverallStatus(checks: DoctorCheck[]): 'healthy' | 'degraded' | 'blocked' {
    if (checks.some((check) => check.status === 'fail')) {
        return 'blocked';
    }
    if (checks.some((check) => check.status === 'warn')) {
        return 'degraded';
    }
    return 'healthy';
}

export function runSidecarDoctor(input: {
    repositoryRoot: string;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
    incidentLogPaths?: string[];
    readinessReportPath?: string;
    controlPlaneThresholdsPath?: string;
    controlPlaneThresholdProfile?: string;
    staleRunningThresholdMs?: number;
    now?: Date;
}): SidecarDoctorReport {
    const now = input.now ?? new Date();
    const staleRunningThresholdMs = input.staleRunningThresholdMs ?? (30 * 60 * 1000);
    const appDataDir = input.appDataDir ?? path.join(input.repositoryRoot, '.coworkany');
    const taskRuntimePath = path.join(appDataDir, 'task-runtime.json');
    const artifactTelemetryPath = input.artifactTelemetryPath
        ? path.resolve(input.artifactTelemetryPath)
        : path.join(input.repositoryRoot, '.coworkany', 'self-learning', 'artifact-contract-telemetry.jsonl');

    const runtimeRecords = readRuntimeRecords(taskRuntimePath);
    const staleRunning = runtimeRecords
        .filter((entry) => entry.status === 'running')
        .filter((entry) => {
            const updatedAtMs = entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
            return Number.isFinite(updatedAtMs) && now.getTime() - updatedAtMs > staleRunningThresholdMs;
        });
    const runtimeStoreCheck: DoctorCheck = staleRunning.length > 0
        ? {
            id: 'runtime-store',
            label: 'Runtime store integrity',
            status: 'fail',
            summary: `Detected ${staleRunning.length} stale running task(s) in runtime store.`,
        }
        : {
            id: 'runtime-store',
            label: 'Runtime store integrity',
            status: 'pass',
            summary: `Runtime store healthy with ${runtimeRecords.length} record(s).`,
        };

    const sourceGuardFindings = collectMemorySourceGuardFindings(input.repositoryRoot);
    const memorySourceGuardsCheck: DoctorCheck = sourceGuardFindings.length > 0
        ? {
            id: 'memory-source-guards',
            label: 'Memory source guardrails',
            status: 'fail',
            summary: sourceGuardFindings.join(' '),
        }
        : {
            id: 'memory-source-guards',
            label: 'Memory source guardrails',
            status: 'pass',
            summary: 'No memory source guardrail anti-patterns detected.',
        };

    const controlPlaneReadinessCheck = (() => {
        if (!input.readinessReportPath) {
            return {
                id: 'control-plane-readiness',
                label: 'Control-plane readiness',
                status: 'warn' as const,
                summary: 'Readiness report path not provided.',
            };
        }
        const reportRaw = fs.existsSync(input.readinessReportPath)
            ? (JSON.parse(fs.readFileSync(input.readinessReportPath, 'utf-8')) as unknown)
            : undefined;
        if (!reportRaw || typeof reportRaw !== 'object' || Array.isArray(reportRaw)) {
            return {
                id: 'control-plane-readiness',
                label: 'Control-plane readiness',
                status: 'warn' as const,
                summary: `Readiness report not found or invalid: ${input.readinessReportPath}`,
            };
        }
        const reportRoot = reportRaw as {
            stages?: unknown;
            controlPlaneEvalGate?: unknown;
        };
        const stages = Array.isArray(reportRoot.stages) ? reportRoot.stages : [];
        const failedStageIds = stages
            .map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry))
                ? entry as { id?: unknown; status?: unknown }
                : undefined)
            .filter((entry) => !!entry && entry.status === 'failed' && typeof entry.id === 'string')
            .map((entry) => entry!.id as string);
        const gateRoot = reportRoot.controlPlaneEvalGate && typeof reportRoot.controlPlaneEvalGate === 'object'
            && !Array.isArray(reportRoot.controlPlaneEvalGate)
            ? reportRoot.controlPlaneEvalGate as { passed?: unknown; findings?: unknown }
            : undefined;
        const gatePassed = gateRoot?.passed !== false;
        const gateFindings = Array.isArray(gateRoot?.findings)
            ? gateRoot.findings.filter((entry): entry is string => typeof entry === 'string')
            : [];

        if (failedStageIds.length > 0 || !gatePassed) {
            const details: string[] = [];
            if (failedStageIds.length > 0) {
                details.push(`Failed stages: ${failedStageIds.join(', ')}`);
            }
            details.push(...gateFindings);
            return {
                id: 'control-plane-readiness',
                label: 'Control-plane readiness',
                status: 'fail' as const,
                summary: details.join(' | '),
            };
        }

        return {
            id: 'control-plane-readiness',
            label: 'Control-plane readiness',
            status: 'pass' as const,
            summary: 'Control-plane readiness report is passing.',
        };
    })();

    const anomalySignalsCheck = (() => {
        const events = readIncidentEvents(input.incidentLogPaths ?? []);
        const reopenedCount = events.filter((event) => event.type === 'TASK_CONTRACT_REOPENED').length;
        const clarificationCount = events.filter((event) => event.type === 'TASK_CLARIFICATION_REQUIRED').length;
        const artifactDegradationCount = countArtifactDegradationSignals(artifactTelemetryPath);
        const hasSignal = reopenedCount >= 2 || clarificationCount >= 2 || artifactDegradationCount > 0;
        if (!hasSignal) {
            return {
                id: 'anomaly-signals',
                label: 'Runtime anomaly signals',
                status: 'pass' as const,
                summary: 'No elevated anomaly signals detected.',
            };
        }
        const details: string[] = [];
        if (reopenedCount >= 2) {
            details.push(`Repeated reopen anomalies: ${reopenedCount}`);
        }
        if (clarificationCount >= 2) {
            details.push(`Repeated clarification loops: ${clarificationCount}`);
        }
        if (artifactDegradationCount > 0) {
            details.push(`Artifact degradation signals: ${artifactDegradationCount}`);
        }
        return {
            id: 'anomaly-signals',
            label: 'Runtime anomaly signals',
            status: 'warn' as const,
            summary: details.join(' | '),
        };
    })();

    const extensionGovernanceCheck = (() => {
        const enabled = readEnabledExtensionIds(input.repositoryRoot);
        const enabledSkills = new Set(enabled.skills);
        const enabledToolpacks = new Set(enabled.toolpacks);
        const governanceStates = readGovernanceStates(path.join(appDataDir, 'extension-governance.json'));
        if (enabled.skills.length === 0 && enabled.toolpacks.length === 0) {
            if (governanceStates.some((state) => state.pendingReview === true)) {
                return {
                    id: 'extension-governance',
                    label: 'Extension governance posture',
                    status: 'warn' as const,
                    summary: 'Pending governance reviews exist, but no third-party extensions are enabled.',
                };
            }
            return {
                id: 'extension-governance',
                label: 'Extension governance posture',
                status: 'pass' as const,
                summary: 'No enabled third-party extensions detected.',
            };
        }

        const pendingEnabled: string[] = [];
        for (const state of governanceStates) {
            if (state.pendingReview !== true || !state.extensionId) {
                continue;
            }
            const type = state.extensionType === 'toolpack' ? 'toolpack' : 'skill';
            const isEnabled = type === 'toolpack'
                ? enabledToolpacks.has(state.extensionId)
                : enabledSkills.has(state.extensionId);
            if (isEnabled) {
                pendingEnabled.push(`${type}:${state.extensionId}`);
            }
        }

        if (pendingEnabled.length > 0) {
            return {
                id: 'extension-governance',
                label: 'Extension governance posture',
                status: 'fail' as const,
                summary: `Detected ${pendingEnabled.length} extension(s) with pending governance review still enabled.`,
            };
        }

        return {
            id: 'extension-governance',
            label: 'Extension governance posture',
            status: 'pass' as const,
            summary: 'Enabled third-party extensions have no pending governance blockers.',
        };
    })();

    const observability = inspectObservability({
        repositoryRoot: input.repositoryRoot,
        appDataDir,
        startupProfile: input.startupProfile,
        artifactTelemetryPath: input.artifactTelemetryPath,
    });
    const observabilityWarnings = [
        ...observability.startupMetrics.warnings,
        ...observability.artifactTelemetry.warnings,
    ];
    const observabilityCheck: DoctorCheck = observabilityWarnings.length > 0
        ? {
            id: 'observability',
            label: 'Observability coverage',
            status: 'warn',
            summary: observabilityWarnings.join(' | '),
        }
        : {
            id: 'observability',
            label: 'Observability coverage',
            status: 'pass',
            summary: 'Startup metrics and artifact telemetry are available.',
        };

    const thresholdConfigCheck: DoctorCheck = input.controlPlaneThresholdsPath
        ? {
            id: 'threshold-config',
            label: 'Control-plane threshold profile',
            status: fs.existsSync(input.controlPlaneThresholdsPath) ? 'pass' : 'warn',
            summary: fs.existsSync(input.controlPlaneThresholdsPath)
                ? `Loaded threshold profile "${input.controlPlaneThresholdProfile ?? 'default'}".`
                : `Threshold config not found: ${input.controlPlaneThresholdsPath}`,
        }
        : {
            id: 'threshold-config',
            label: 'Control-plane threshold profile',
            status: 'pass',
            summary: 'Using default control-plane thresholds.',
        };

    const checks: DoctorCheck[] = [
        runtimeStoreCheck,
        memorySourceGuardsCheck,
        controlPlaneReadinessCheck,
        anomalySignalsCheck,
        extensionGovernanceCheck,
        observabilityCheck,
        thresholdConfigCheck,
    ];

    return {
        generatedAt: now.toISOString(),
        repositoryRoot: input.repositoryRoot,
        appDataDir,
        overallStatus: summarizeOverallStatus(checks),
        checks,
    };
}

export function formatSidecarDoctorReport(report: SidecarDoctorReport): string {
    const lines: string[] = [];
    lines.push('# Sidecar Doctor Report');
    lines.push('');
    lines.push(`Generated at: ${report.generatedAt}`);
    lines.push(`Overall: ${report.overallStatus}`);
    lines.push('');
    lines.push('## Checks');
    for (const check of report.checks) {
        lines.push(`- [${check.status.toUpperCase()}] ${check.id} (${check.label}): ${check.summary}`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}
