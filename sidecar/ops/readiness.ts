import * as fs from 'fs';
import * as path from 'path';
import { resolveTelemetryPolicy } from '../src/mastra/telemetry';

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
    otel?: {
        enabled: boolean;
        mode: string;
        ratio: number;
        endpoint?: string;
        serviceName: string;
        warnings: string[];
    };
};

export type RealModelProxyPreflightStatus = 'passed' | 'failed' | 'skipped';

export type RealModelProxyPreflightSource = 'env' | 'llm-config' | 'none';

export type RealModelProxyPreflight = {
    status: RealModelProxyPreflightStatus;
    source: RealModelProxyPreflightSource;
    proxyUrl?: string;
    bypass?: string;
    timeoutMs: number;
    latencyMs?: number;
    checkedAddress?: string;
    tunnelStatus?: 'passed' | 'failed' | 'skipped';
    tunnelTarget?: string;
    tunnelSource?: 'env' | 'llm-config' | 'provider-default';
    tunnelLatencyMs?: number;
    tlsStatus?: 'passed' | 'failed' | 'skipped';
    tlsLatencyMs?: number;
    error?: string;
    findings: string[];
    recommendations: string[];
};

export type RealModelProviderPreflightStatus = 'passed' | 'failed' | 'skipped';

export type RealModelProviderPreflightSource = 'env' | 'llm-config' | 'none';

export type RealModelProviderPreflight = {
    status: RealModelProviderPreflightStatus;
    source: RealModelProviderPreflightSource;
    provider?: string;
    modelId?: string;
    requiredApiKeyEnv?: string;
    hasApiKey?: boolean;
    error?: string;
    findings: string[];
    recommendations: string[];
};

export type RealModelGateFailureCategory =
    | 'proxy_unreachable'
    | 'proxy_auth_required'
    | 'proxy_tls_certificate'
    | 'provider_missing_api_key'
    | 'provider_auth'
    | 'provider_model_not_found'
    | 'provider_rate_limited'
    | 'network_connectivity'
    | 'timeout'
    | 'unknown';

export type RealModelGateFailureClassification = {
    category: RealModelGateFailureCategory;
    summary: string;
    evidence: string;
    recommendations: string[];
};

export type ReleaseReadinessReport = {
    generatedAt: string;
    repositoryRoot: string;
    requestedOptions: {
        buildDesktop: boolean;
        realE2E: boolean;
        realModelSmoke?: boolean;
        appDataDir?: string;
        startupProfile?: string;
        doctorRequiredStatus: 'healthy' | 'degraded' | 'blocked';
        canaryEvidencePath?: string;
        requireCanaryEvidence?: boolean;
        controlPlaneThresholdsPath?: string;
        controlPlaneThresholdProfile?: string;
        syncProductionReplays?: boolean;
        productionReplayDatasetPath?: string;
        repoMatrixPath?: string;
        repoMatrixOutPath?: string;
        repoMatrixEvidenceDir?: string;
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
    realModelGate?: {
        providerPreflight?: RealModelProviderPreflight;
        preflight?: RealModelProxyPreflight;
        failureClassification?: RealModelGateFailureClassification;
    };
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

function classifyFailureCategoryFromText(text: string): RealModelGateFailureCategory {
    const normalized = text.toLowerCase();
    if (
        normalized.includes('proxy_connect_auth_required')
        || normalized.includes('status=407')
        || normalized.includes('proxy authentication')
        || normalized.includes('proxy auth')
    ) {
        return 'proxy_auth_required';
    }
    if (
        normalized.includes('issuer certificate')
        || normalized.includes('self signed certificate')
        || normalized.includes('tls handshake')
    ) {
        return 'proxy_tls_certificate';
    }
    if (
        normalized.includes('missing_api_key')
        || /missing\s+[a-z_]+_api_key/.test(normalized)
    ) {
        return 'provider_missing_api_key';
    }
    if (
        normalized.includes('socket connection was closed unexpectedly')
        || normalized.includes('proxy connect')
        || normalized.includes('proxy error')
        || normalized.includes('econnrefused')
        || normalized.includes('connect econnrefused')
    ) {
        return 'proxy_unreachable';
    }
    if (
        normalized.includes('unauthorized')
        || normalized.includes('authentication')
        || normalized.includes('invalid api key')
        || normalized.includes('status 401')
        || normalized.includes(' 401 ')
    ) {
        return 'provider_auth';
    }
    if (
        normalized.includes('model_not_found')
        || normalized.includes('unknown model')
        || normalized.includes('not found')
        || normalized.includes('status 404')
        || normalized.includes(' 404 ')
    ) {
        return 'provider_model_not_found';
    }
    if (
        normalized.includes('rate limit')
        || normalized.includes('quota')
        || normalized.includes('status 429')
        || normalized.includes(' 429 ')
    ) {
        return 'provider_rate_limited';
    }
    if (normalized.includes('timed out') || normalized.includes('timeout')) {
        return 'timeout';
    }
    if (
        normalized.includes('enotfound')
        || normalized.includes('eai_again')
        || normalized.includes('dns')
        || normalized.includes('fetch failed')
        || normalized.includes('network')
        || normalized.includes('connect')
    ) {
        return 'network_connectivity';
    }
    return 'unknown';
}

function recommendationsForFailureCategory(category: RealModelGateFailureCategory): string[] {
    switch (category) {
        case 'proxy_unreachable':
            return [
                'Verify proxy process is running and listening on configured host/port.',
                'Verify COWORKANY_PROXY_URL/HTTPS_PROXY points to reachable address from this host.',
                'Retry release:readiness:commercial after proxy connectivity is restored.',
            ];
        case 'proxy_auth_required':
            return [
                'Configure proxy credentials in proxy URL (for example http://user:pass@host:port).',
                'Confirm proxy policy allows CONNECT to provider endpoints.',
                'Retry release:readiness:commercial after proxy authentication succeeds.',
            ];
        case 'proxy_tls_certificate':
            return [
                'Install enterprise/interception CA certificate into runtime trust store.',
                'For diagnostic only, temporarily set NODE_TLS_REJECT_UNAUTHORIZED=0 to confirm TLS root cause.',
                'Retry release:readiness:commercial after certificate trust is fixed.',
            ];
        case 'provider_missing_api_key':
            return [
                'Set required provider API key (for example OPENAI_API_KEY or ANTHROPIC_API_KEY).',
                'Confirm active llm profile/provider matches configured key.',
                'Retry release:readiness:commercial after key injection is verified.',
            ];
        case 'provider_auth':
            return [
                'Validate provider API key, org/project binding, and account status.',
                'Rotate key and reconfigure secret if token is revoked.',
                'Retry release:readiness:commercial after auth verification passes.',
            ];
        case 'provider_model_not_found':
            return [
                'Verify COWORKANY_MODEL exists for current provider account and region.',
                'Switch to an available model id in active llm profile.',
                'Retry release:readiness:commercial after model route is corrected.',
            ];
        case 'provider_rate_limited':
            return [
                'Increase provider quota or switch to higher-capacity key/project.',
                'Reduce concurrent smoke traffic and rerun gate.',
                'Retry release:readiness:commercial after rate limit pressure is resolved.',
            ];
        case 'network_connectivity':
            return [
                'Verify DNS/network egress from host to provider endpoint.',
                'Check firewall/VPN policy and corporate outbound rules.',
                'Retry release:readiness:commercial once network path is stable.',
            ];
        case 'timeout':
            return [
                'Check proxy/provider latency and packet loss.',
                'Re-run gate when network latency is back to normal.',
                'If persistent, capture provider trace and escalate with timestamp.',
            ];
        case 'unknown':
        default:
            return [
                'Inspect stage stderr/stdout in release readiness logs.',
                'Reproduce with bun test tests/real-model-smoke.e2e.test.ts for focused diagnosis.',
                'Classify and codify new signature in readiness classifier if recurring.',
            ];
    }
}

function summaryForFailureCategory(category: RealModelGateFailureCategory): string {
    switch (category) {
        case 'proxy_unreachable':
            return 'Proxy connectivity failed before or during real-model call.';
        case 'proxy_auth_required':
            return 'Proxy requires authentication or denied CONNECT tunnel setup.';
        case 'proxy_tls_certificate':
            return 'TLS certificate trust failed on proxy/provider route.';
        case 'provider_missing_api_key':
            return 'Provider API key is missing for selected model/provider.';
        case 'provider_auth':
            return 'Provider authentication was rejected.';
        case 'provider_model_not_found':
            return 'Configured model is unavailable for the provider account.';
        case 'provider_rate_limited':
            return 'Provider request was rate-limited or quota-limited.';
        case 'network_connectivity':
            return 'Network path to provider endpoint is unstable or unreachable.';
        case 'timeout':
            return 'Real-model gate timed out before successful completion.';
        case 'unknown':
        default:
            return 'Real-model gate failed with uncategorized error.';
    }
}

function summarizeFailureEvidence(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
        return '';
    }
    const lines = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const keyLines = lines.filter((line) => /error:|missing_api_key|unauthorized|model_not_found|rate limit|timeout|socket|econn/i.test(line));
    const chosen = (keyLines.length > 0 ? keyLines[keyLines.length - 1] : lines[lines.length - 1]) ?? normalized;
    if (chosen.length <= 600) {
        return chosen;
    }
    return `${chosen.slice(0, 597)}...`;
}

export function classifyRealModelGateFailure(input: {
    stageNote?: string;
    providerPreflight?: RealModelProviderPreflight;
    preflight?: RealModelProxyPreflight;
}): RealModelGateFailureClassification | undefined {
    const evidence = (input.stageNote ?? '').trim();
    if (!evidence && input.providerPreflight?.status !== 'failed' && input.preflight?.status !== 'failed') {
        return undefined;
    }

    let category: RealModelGateFailureCategory;
    if (input.providerPreflight?.status === 'failed') {
        const normalizedError = (input.providerPreflight.error ?? '').toLowerCase();
        category = normalizedError.includes('missing_api_key') ? 'provider_missing_api_key' : 'unknown';
    } else if (input.preflight?.status === 'failed') {
        const normalizedError = (input.preflight.error ?? '').toLowerCase();
        if (input.preflight.tlsStatus === 'failed') {
            category = 'proxy_tls_certificate';
        } else if (
            normalizedError.includes('status=407')
            || normalizedError.includes('proxy_connect_auth_required')
            || normalizedError.includes('proxy auth')
        ) {
            category = 'proxy_auth_required';
        } else {
            category = (
                normalizedError.includes('certificate')
                || normalizedError.includes('tls handshake')
            )
                ? 'proxy_tls_certificate'
                : 'proxy_unreachable';
        }
    } else {
        category = classifyFailureCategoryFromText(evidence);
    }

    return {
        category,
        summary: summaryForFailureCategory(category),
        evidence: summarizeFailureEvidence(
            evidence
            || String(
                input.providerPreflight?.error
                ?? input.preflight?.error
                ?? 'real-model preflight failed',
            ),
        ),
        recommendations: recommendationsForFailureCategory(category),
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
    const telemetryPolicy = resolveTelemetryPolicy();
    const otelWarnings: string[] = [];
    const otelEnabled = telemetryPolicy.mode !== 'off';
    if (otelEnabled && !telemetryPolicy.otelEndpoint) {
        otelWarnings.push('OTEL sampling enabled but no OTLP endpoint configured (set COWORKANY_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT).');
    }
    if (telemetryPolicy.mode === 'ratio' && telemetryPolicy.ratio <= 0) {
        otelWarnings.push('OTEL ratio sampling is configured to 0; no traces will be exported.');
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
        otel: {
            enabled: otelEnabled,
            mode: telemetryPolicy.mode,
            ratio: telemetryPolicy.ratio,
            endpoint: telemetryPolicy.otelEndpoint,
            serviceName: telemetryPolicy.serviceName,
            warnings: otelWarnings,
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
    lines.push(`- Real model smoke: ${report.requestedOptions.realModelSmoke ? 'yes' : 'no'}`);
    lines.push(`- Doctor required status: ${report.requestedOptions.doctorRequiredStatus}`);
    lines.push(`- Canary evidence path: ${report.requestedOptions.canaryEvidencePath ?? 'not provided'}`);
    lines.push(`- Require canary evidence: ${report.requestedOptions.requireCanaryEvidence ? 'yes' : 'no'}`);
    if (report.requestedOptions.repoMatrixPath) {
        lines.push(`- Repo matrix input: ${report.requestedOptions.repoMatrixPath}`);
    }
    if (report.requestedOptions.repoMatrixOutPath) {
        lines.push(`- Repo matrix report: ${report.requestedOptions.repoMatrixOutPath}`);
    }
    if (report.requestedOptions.repoMatrixEvidenceDir) {
        lines.push(`- Repo matrix evidence: ${report.requestedOptions.repoMatrixEvidenceDir}`);
    }
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

    if (
        report.realModelGate?.providerPreflight
        || report.realModelGate?.preflight
        || report.realModelGate?.failureClassification
    ) {
        lines.push('## Real-Model Gate Diagnosis');
        if (report.realModelGate.providerPreflight) {
            const providerPreflight = report.realModelGate.providerPreflight;
            lines.push(`- Provider preflight status: ${providerPreflight.status}`);
            lines.push(`- Provider source: ${providerPreflight.source}`);
            lines.push(`- Provider: ${providerPreflight.provider ?? 'unknown'}`);
            lines.push(`- Model: ${providerPreflight.modelId ?? 'unknown'}`);
            if (providerPreflight.requiredApiKeyEnv) {
                lines.push(`- Required key: ${providerPreflight.requiredApiKeyEnv}`);
            }
            if (typeof providerPreflight.hasApiKey === 'boolean') {
                lines.push(`- Key present: ${providerPreflight.hasApiKey ? 'yes' : 'no'}`);
            }
            if (providerPreflight.error) {
                lines.push(`- Provider preflight error: ${providerPreflight.error}`);
            }
            for (const finding of providerPreflight.findings) {
                lines.push(`- Provider finding: ${finding}`);
            }
            for (const recommendation of providerPreflight.recommendations) {
                lines.push(`- Provider action: ${recommendation}`);
            }
        }
        if (report.realModelGate.preflight) {
            const preflight = report.realModelGate.preflight;
            lines.push(`- Proxy preflight status: ${preflight.status}`);
            lines.push(`- Proxy source: ${preflight.source}`);
            lines.push(`- Proxy URL: ${preflight.proxyUrl ?? 'not configured'}`);
            if (preflight.checkedAddress) {
                lines.push(`- Proxy checked address: ${preflight.checkedAddress}`);
            }
            if (typeof preflight.latencyMs === 'number') {
                lines.push(`- Proxy latency: ${preflight.latencyMs}ms`);
            }
            if (preflight.tunnelStatus) {
                lines.push(`- Proxy CONNECT status: ${preflight.tunnelStatus}`);
            }
            if (preflight.tunnelTarget) {
                lines.push(`- Proxy CONNECT target: ${preflight.tunnelTarget}`);
            }
            if (preflight.tunnelSource) {
                lines.push(`- Proxy CONNECT target source: ${preflight.tunnelSource}`);
            }
            if (typeof preflight.tunnelLatencyMs === 'number') {
                lines.push(`- Proxy CONNECT latency: ${preflight.tunnelLatencyMs}ms`);
            }
            if (preflight.tlsStatus) {
                lines.push(`- Proxy TLS status: ${preflight.tlsStatus}`);
            }
            if (typeof preflight.tlsLatencyMs === 'number') {
                lines.push(`- Proxy TLS latency: ${preflight.tlsLatencyMs}ms`);
            }
            if (preflight.error) {
                lines.push(`- Proxy preflight error: ${preflight.error}`);
            }
            for (const finding of preflight.findings) {
                lines.push(`- Preflight finding: ${finding}`);
            }
            for (const recommendation of preflight.recommendations) {
                lines.push(`- Preflight action: ${recommendation}`);
            }
        }
        if (report.realModelGate.failureClassification) {
            const classification = report.realModelGate.failureClassification;
            lines.push(`- Failure category: ${classification.category}`);
            lines.push(`- Failure summary: ${classification.summary}`);
            lines.push(`- Failure evidence: ${classification.evidence}`);
            for (const recommendation of classification.recommendations) {
                lines.push(`- Next action: ${recommendation}`);
            }
        }
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
    for (const warning of report.observability.otel?.warnings ?? []) {
        lines.push(`- ${warning}`);
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}
