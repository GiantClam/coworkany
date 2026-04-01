import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as tls from 'tls';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
    applyControlPlaneThresholdUpdateSuggestion,
    buildControlPlaneThresholdUpdateSuggestion,
    classifyRealModelGateFailure,
    evaluateCanaryChecklistEvidence,
    evaluateSidecarDoctorReadiness,
    evaluateControlPlaneEvalReadiness,
    evaluateWorkspaceExtensionAllowlistReadiness,
    createDefaultCanaryChecklist,
    inspectObservability,
    loadControlPlaneEvalThresholds,
    recommendProductionReplayThresholds,
    renderReleaseReadinessMarkdown,
    summarizeSidecarDoctorReport,
    summarizeControlPlaneEvalSummary,
    summarizeProductionReplayImportSummary,
    summarizeCanaryChecklistEvidence,
    type RealModelProviderPreflight,
    type RealModelProxyPreflight,
    type ReleaseReadinessReport,
    type ReleaseStageResult,
} from '../src/release/readiness';
import { formatSidecarDoctorReport, runSidecarDoctor } from '../src/doctor/sidecarDoctor';
import { loadWorkspaceExtensionAllowlistPolicy } from '../src/extensions/workspaceExtensionAllowlist';

type CliOptions = {
    buildDesktop: boolean;
    realE2E: boolean;
    realModelSmoke: boolean;
    appDataDir?: string;
    startupProfile?: string;
    doctorRequiredStatus?: 'healthy' | 'degraded' | 'blocked';
    canaryEvidencePath?: string;
    requireCanaryEvidence: boolean;
    artifactTelemetryPath?: string;
    outputDir: string;
    controlPlaneThresholdsPath?: string;
    controlPlaneThresholdProfile?: string;
    syncProductionReplays: boolean;
    productionReplayImportRoots: string[];
    productionReplayDatasetPath?: string;
};

type ResolvedProviderFromLlmConfig = {
    source: 'llm-config';
    configPath: string;
    provider: string;
    modelId?: string;
    baseUrl?: string;
    apiKeyPresent: boolean;
};

const PROVIDER_KEY_ENV_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
    aiberm: 'OPENAI_API_KEY',
    nvidia: 'OPENAI_API_KEY',
    siliconflow: 'OPENAI_API_KEY',
    gemini: 'OPENAI_API_KEY',
    qwen: 'OPENAI_API_KEY',
    minimax: 'OPENAI_API_KEY',
    kimi: 'OPENAI_API_KEY',
};

function bin(name: string): string {
    return process.platform === 'win32' ? `${name}.cmd` : name;
}

function isDoctorRequiredStatus(
    value: string | undefined,
): value is 'healthy' | 'degraded' | 'blocked' {
    return value === 'healthy' || value === 'degraded' || value === 'blocked';
}

function parseArgs(argv: string[], repositoryRoot: string): CliOptions {
    const options: CliOptions = {
        buildDesktop: false,
        realE2E: false,
        realModelSmoke: process.env.COWORKANY_REAL_MODEL_SMOKE === '1'
            || process.env.COWORKANY_REAL_MODEL_SMOKE === 'true',
        appDataDir: process.env.COWORKANY_APP_DATA_DIR || undefined,
        startupProfile: process.env.COWORKANY_STARTUP_PROFILE || undefined,
        doctorRequiredStatus: isDoctorRequiredStatus(process.env.COWORKANY_DOCTOR_REQUIRED_STATUS)
            ? process.env.COWORKANY_DOCTOR_REQUIRED_STATUS
            : undefined,
        canaryEvidencePath: process.env.COWORKANY_CANARY_EVIDENCE_PATH || undefined,
        requireCanaryEvidence: process.env.COWORKANY_REQUIRE_CANARY_EVIDENCE === '1'
            || process.env.COWORKANY_REQUIRE_CANARY_EVIDENCE === 'true',
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
            case '--real-model-smoke':
                options.realModelSmoke = true;
                break;
            case '--app-data-dir':
                options.appDataDir = argv[index + 1];
                index += 1;
                break;
            case '--startup-profile':
                options.startupProfile = argv[index + 1];
                index += 1;
                break;
            case '--doctor-required-status': {
                const value = argv[index + 1];
                if (!isDoctorRequiredStatus(value)) {
                    throw new Error(`Invalid --doctor-required-status value: ${value}`);
                }
                options.doctorRequiredStatus = value;
                index += 1;
                break;
            }
            case '--canary-evidence':
                options.canaryEvidencePath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--require-canary-evidence':
                options.requireCanaryEvidence = true;
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

function toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function resolveLlmConfigCandidates(sidecarDir: string): string[] {
    const configCandidates = [
        path.join(sidecarDir, 'llm-config.json'),
    ];
    const homeDir = process.env.HOME?.trim();
    if (homeDir) {
        configCandidates.push(path.join(
            homeDir,
            'Library',
            'Application Support',
            'com.coworkany.desktop',
            'llm-config.json',
        ));
    }
    return [...new Set(configCandidates)];
}

function readEnabledSkillIds(workspaceRoot: string): string[] {
    const filePath = path.join(workspaceRoot, '.coworkany', 'skills.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
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
        const id = typeof record.manifest?.name === 'string' && record.manifest.name.trim().length > 0
            ? record.manifest.name.trim()
            : key.trim();
        if (id.length > 0) {
            enabled.add(id);
        }
    }
    return Array.from(enabled).sort((left, right) => left.localeCompare(right));
}

function readEnabledToolpackIds(workspaceRoot: string): string[] {
    const filePath = path.join(workspaceRoot, '.coworkany', 'toolpacks.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
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
        const id = typeof record.manifest?.id === 'string' && record.manifest.id.trim().length > 0
            ? record.manifest.id.trim()
            : (typeof record.manifest?.name === 'string' && record.manifest.name.trim().length > 0
                ? record.manifest.name.trim()
                : key.trim());
        if (id.length > 0) {
            enabled.add(id);
        }
    }
    return Array.from(enabled).sort((left, right) => left.localeCompare(right));
}

function collectFailureOutput(stdout: string | null, stderr: string | null): string | undefined {
    const merged = [stdout ?? '', stderr ?? '']
        .join('\n')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (merged.length === 0) {
        return undefined;
    }
    const keyLines = merged.filter((line) => /error:|failed|missing_api_key|unauthorized|timeout|econn|socket/i.test(line));
    const selected = (keyLines.length > 0 ? keyLines : merged).slice(-6);
    const excerpt = selected
        .join(' | ')
        .replace(/\s+/g, ' ')
        .trim();
    if (excerpt.length <= 1200) {
        return excerpt;
    }
    return `${excerpt.slice(0, 1197)}...`;
}

function runStage(input: {
    id: string;
    label: string;
    cwd: string;
    command: string;
    args: string[];
    optional?: boolean;
    env?: NodeJS.ProcessEnv;
}): ReleaseStageResult {
    const startedAt = Date.now();
    const commandLine = [input.command, ...input.args].join(' ');
    console.log(`\n[release-readiness] ${input.label}`);
    console.log(`[release-readiness] cwd=${input.cwd}`);
    console.log(`[release-readiness] cmd=${commandLine}`);

    const result = spawnSync(input.command, input.args, {
        cwd: input.cwd,
        stdio: 'pipe',
        encoding: 'utf-8',
        env: {
            ...process.env,
            ...(input.env ?? {}),
        },
    });
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    const exitCode = result.status ?? (result.error ? 1 : 0);
    const status = exitCode === 0 ? 'passed' : input.optional ? 'skipped' : 'failed';
    const note = result.error
        ? String(result.error.message || result.error)
        : (exitCode !== 0 ? collectFailureOutput(result.stdout, result.stderr) : undefined);

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

type RealModelProxyConfig = {
    source: 'env' | 'llm-config' | 'none';
    proxyUrl?: string;
    bypass?: string;
};

function resolveRealModelProxyConfig(sidecarDir: string): RealModelProxyConfig {
    const envProxyKeys = [
        'COWORKANY_PROXY_URL',
        'HTTPS_PROXY',
        'https_proxy',
        'HTTP_PROXY',
        'http_proxy',
        'ALL_PROXY',
        'all_proxy',
    ] as const;
    for (const key of envProxyKeys) {
        const value = process.env[key]?.trim();
        if (value) {
            return {
                source: 'env',
                proxyUrl: value,
                bypass: process.env.NO_PROXY?.trim() || process.env.no_proxy?.trim(),
            };
        }
    }

    for (const candidatePath of resolveLlmConfigCandidates(sidecarDir)) {
        if (!fs.existsSync(candidatePath)) {
            continue;
        }
        try {
            const root = JSON.parse(fs.readFileSync(candidatePath, 'utf-8')) as {
                proxy?: {
                    enabled?: boolean;
                    url?: string;
                    bypass?: string;
                };
            };
            if (root.proxy?.enabled !== true) {
                continue;
            }
            const proxyUrl = root.proxy.url?.trim();
            if (!proxyUrl) {
                continue;
            }
            return {
                source: 'llm-config',
                proxyUrl,
                bypass: root.proxy.bypass?.trim(),
            };
        } catch {
            continue;
        }
    }

    return { source: 'none' };
}

function resolveProviderFromLlmConfig(sidecarDir: string): ResolvedProviderFromLlmConfig | undefined {
    for (const candidatePath of resolveLlmConfigCandidates(sidecarDir)) {
        if (!fs.existsSync(candidatePath)) {
            continue;
        }
        try {
            const root = toRecord(JSON.parse(fs.readFileSync(candidatePath, 'utf-8')));
            if (!root) {
                continue;
            }
            const profilesRaw = Array.isArray(root.profiles)
                ? root.profiles
                    .map((entry) => toRecord(entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
                : [];
            const activeProfileId = toTrimmedString(root.activeProfileId);
            const activeProfile = (activeProfileId
                ? profilesRaw.find((profile) => toTrimmedString(profile.id) === activeProfileId)
                : undefined)
                ?? profilesRaw[0];
            const provider = (
                toTrimmedString(activeProfile?.provider)
                ?? toTrimmedString(root.provider)
            )?.toLowerCase();
            if (!provider) {
                continue;
            }
            const providerSettings = (() => {
                switch (provider) {
                    case 'anthropic':
                        return toRecord(activeProfile?.anthropic) ?? toRecord(root.anthropic);
                    case 'openrouter':
                        return toRecord(activeProfile?.openrouter) ?? toRecord(root.openrouter);
                    case 'custom':
                        return toRecord(activeProfile?.custom) ?? toRecord(root.custom);
                    default:
                        return toRecord(activeProfile?.openai) ?? toRecord(root.openai);
                }
            })();
            return {
                source: 'llm-config',
                configPath: candidatePath,
                provider,
                modelId: toTrimmedString(providerSettings?.model),
                baseUrl: toTrimmedString(providerSettings?.baseURL) ?? toTrimmedString(providerSettings?.baseUrl),
                apiKeyPresent: Boolean(toTrimmedString(providerSettings?.apiKey)),
            };
        } catch {
            continue;
        }
    }
    return undefined;
}

function inferProviderFromEnvironment(): { provider?: string; modelId?: string; baseUrl?: string } {
    const modelId = process.env.COWORKANY_MODEL?.trim();
    const baseUrl = process.env.OPENAI_BASE_URL?.trim();
    if (modelId && modelId.includes('/')) {
        return {
            provider: modelId.split('/')[0]?.trim().toLowerCase() || undefined,
            modelId,
            baseUrl,
        };
    }
    const baseUrlLower = baseUrl?.toLowerCase() ?? '';
    if (baseUrlLower.includes('aiberm.com')) {
        return { provider: 'aiberm', modelId, baseUrl };
    }
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
        return { provider: 'anthropic', modelId, baseUrl };
    }
    if (process.env.OPENROUTER_API_KEY?.trim()) {
        return { provider: 'openrouter', modelId, baseUrl };
    }
    if (process.env.OPENAI_API_KEY?.trim()) {
        return { provider: 'openai', modelId, baseUrl };
    }
    return { provider: undefined, modelId, baseUrl };
}

function runRealModelProviderPreflight(input: {
    sidecarDir: string;
}): RealModelProviderPreflight {
    const fromEnv = inferProviderFromEnvironment();
    const fromConfig = resolveProviderFromLlmConfig(input.sidecarDir);
    const provider = (fromEnv.provider ?? fromConfig?.provider)?.toLowerCase();
    const modelId = fromEnv.modelId ?? fromConfig?.modelId;
    const source: RealModelProviderPreflight['source'] = fromEnv.provider
        ? 'env'
        : (fromConfig ? 'llm-config' : 'none');

    if (!provider) {
        return {
            status: 'failed',
            source,
            modelId,
            error: 'provider_not_resolved',
            findings: ['Unable to resolve active provider for real-model smoke gate.'],
            recommendations: [
                'Set COWORKANY_MODEL (provider/model) or configure an active llm profile in llm-config.json.',
                'Re-run release:readiness:commercial after provider selection is explicit.',
            ],
        };
    }

    const requiredApiKeyEnv = PROVIDER_KEY_ENV_MAP[provider];
    if (!requiredApiKeyEnv) {
        return {
            status: 'failed',
            source,
            provider,
            modelId,
            error: `unsupported_provider:${provider}`,
            findings: [`No API key mapping is defined for provider ${provider}.`],
            recommendations: [
                'Use a supported provider or add provider-key mapping for release readiness gate.',
                'Re-run release:readiness:commercial after provider mapping is configured.',
            ],
        };
    }

    const hasApiKeyFromEnv = Boolean(process.env[requiredApiKeyEnv]?.trim());
    const hasApiKeyFromConfig = Boolean(
        fromConfig
        && fromConfig.provider === provider
        && fromConfig.apiKeyPresent,
    );
    const hasApiKey = hasApiKeyFromEnv || hasApiKeyFromConfig;
    if (!hasApiKey) {
        return {
            status: 'failed',
            source,
            provider,
            modelId,
            requiredApiKeyEnv,
            hasApiKey: false,
            error: `missing_api_key:${requiredApiKeyEnv}`,
            findings: [`Required API key ${requiredApiKeyEnv} is missing for provider ${provider}.`],
            recommendations: [
                `Set ${requiredApiKeyEnv} in environment or save a valid key in the active llm profile.`,
                'Re-run release:readiness:commercial after key injection is verified.',
            ],
        };
    }

    return {
        status: 'passed',
        source,
        provider,
        modelId,
        requiredApiKeyEnv,
        hasApiKey: true,
        findings: [`Provider ${provider} has required API key available.`],
        recommendations: [],
    };
}

function probeTcpReachability(
    host: string,
    port: number,
    timeoutMs: number,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const socket = new net.Socket();
        let settled = false;
        const done = (result: { ok: boolean; latencyMs: number; error?: string }): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            done({
                ok: true,
                latencyMs: Date.now() - startedAt,
            });
        });
        socket.once('timeout', () => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `timeout after ${timeoutMs}ms`,
            });
        });
        socket.once('error', (error) => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: String(error.message || error),
            });
        });
        socket.connect(port, host);
    });
}

type ProxyTunnelProbeTarget = {
    source: 'env' | 'llm-config' | 'provider-default';
    host: string;
    port: number;
};

function resolveProxyTunnelProbeTarget(sidecarDir: string): ProxyTunnelProbeTarget | undefined {
    const fromEnv = inferProviderFromEnvironment();
    if (fromEnv.baseUrl) {
        try {
            const parsed = new URL(fromEnv.baseUrl);
            if (parsed.hostname) {
                return {
                    source: 'env',
                    host: parsed.hostname,
                    port: parsed.port ? Number.parseInt(parsed.port, 10) : (parsed.protocol === 'http:' ? 80 : 443),
                };
            }
        } catch {
            // ignore invalid env base URL and continue to other candidates
        }
    }

    const fromConfig = resolveProviderFromLlmConfig(sidecarDir);
    if (fromConfig?.baseUrl) {
        try {
            const parsed = new URL(fromConfig.baseUrl);
            if (parsed.hostname) {
                return {
                    source: 'llm-config',
                    host: parsed.hostname,
                    port: parsed.port ? Number.parseInt(parsed.port, 10) : (parsed.protocol === 'http:' ? 80 : 443),
                };
            }
        } catch {
            // ignore invalid llm-config base URL and continue to provider defaults
        }
    }

    const provider = (fromEnv.provider ?? fromConfig?.provider)?.toLowerCase();
    const defaultHostByProvider: Record<string, string> = {
        anthropic: 'api.anthropic.com',
        openrouter: 'openrouter.ai',
        aiberm: 'aiberm.com',
        openai: 'api.openai.com',
        nvidia: 'integrate.api.nvidia.com',
        siliconflow: 'api.siliconflow.cn',
        gemini: 'generativelanguage.googleapis.com',
        qwen: 'dashscope.aliyuncs.com',
        minimax: 'api.minimaxi.com',
        kimi: 'api.moonshot.cn',
    };

    const defaultHost = provider ? defaultHostByProvider[provider] : undefined;
    if (!defaultHost) {
        return undefined;
    }

    return {
        source: 'provider-default',
        host: defaultHost,
        port: 443,
    };
}

function probeHttpConnectTunnel(input: {
    proxyHost: string;
    proxyPort: number;
    timeoutMs: number;
    targetHost: string;
    targetPort: number;
    proxyAuthHeader?: string;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const socket = new net.Socket();
        let settled = false;
        let responseBuffer = '';

        const done = (result: { ok: boolean; latencyMs: number; error?: string }): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(input.timeoutMs);
        socket.once('connect', () => {
            const headers = [
                `CONNECT ${input.targetHost}:${input.targetPort} HTTP/1.1`,
                `Host: ${input.targetHost}:${input.targetPort}`,
                'Proxy-Connection: Keep-Alive',
            ];
            if (input.proxyAuthHeader) {
                headers.push(`Proxy-Authorization: ${input.proxyAuthHeader}`);
            }
            headers.push('', '');
            socket.write(headers.join('\r\n'));
        });
        socket.on('data', (chunk: Buffer) => {
            responseBuffer += chunk.toString('utf8');
            if (!responseBuffer.includes('\r\n\r\n')) {
                return;
            }
            const firstLine = responseBuffer.split('\r\n', 1)[0] ?? '';
            const statusMatch = firstLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
            const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : NaN;
            if (Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 300) {
                done({
                    ok: true,
                    latencyMs: Date.now() - startedAt,
                });
                return;
            }
            if (statusCode === 407) {
                done({
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: `proxy_connect_auth_required:status=407 line=${firstLine}`,
                });
                return;
            }
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `proxy_connect_failed:${firstLine || 'invalid_response'}`,
            });
        });
        socket.once('timeout', () => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `proxy CONNECT timeout after ${input.timeoutMs}ms`,
            });
        });
        socket.once('error', (error) => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `proxy CONNECT socket error: ${String(error.message || error)}`,
            });
        });
        socket.once('end', () => {
            if (!settled) {
                done({
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: 'proxy CONNECT socket closed before response',
                });
            }
        });
        socket.connect(input.proxyPort, input.proxyHost);
    });
}

function probeTlsHandshakeViaProxy(input: {
    proxyHost: string;
    proxyPort: number;
    timeoutMs: number;
    targetHost: string;
    targetPort: number;
    proxyAuthHeader?: string;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const socket = new net.Socket();
        let settled = false;
        let responseBuffer = '';

        const done = (result: { ok: boolean; latencyMs: number; error?: string }): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(input.timeoutMs);
        socket.once('connect', () => {
            const headers = [
                `CONNECT ${input.targetHost}:${input.targetPort} HTTP/1.1`,
                `Host: ${input.targetHost}:${input.targetPort}`,
                'Proxy-Connection: Keep-Alive',
            ];
            if (input.proxyAuthHeader) {
                headers.push(`Proxy-Authorization: ${input.proxyAuthHeader}`);
            }
            headers.push('', '');
            socket.write(headers.join('\r\n'));
        });
        socket.on('data', (chunk: Buffer) => {
            responseBuffer += chunk.toString('utf8');
            if (!responseBuffer.includes('\r\n\r\n')) {
                return;
            }

            const firstLine = responseBuffer.split('\r\n', 1)[0] ?? '';
            const statusMatch = firstLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
            const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : NaN;
            if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
                done({
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: `proxy_connect_failed:${firstLine || 'invalid_response'}`,
                });
                return;
            }

            // Switch ownership of the underlying socket to TLS layer.
            socket.removeAllListeners('data');
            socket.removeAllListeners('timeout');
            socket.removeAllListeners('error');
            socket.setTimeout(0);

            const secureSocket = tls.connect({
                socket,
                servername: input.targetHost,
                rejectUnauthorized: true,
            });
            secureSocket.setTimeout(input.timeoutMs);
            secureSocket.once('secureConnect', () => {
                secureSocket.end();
                done({
                    ok: true,
                    latencyMs: Date.now() - startedAt,
                });
            });
            secureSocket.once('timeout', () => {
                done({
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: `proxy CONNECT TLS handshake timeout after ${input.timeoutMs}ms`,
                });
            });
            secureSocket.once('error', (error) => {
                done({
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: `proxy CONNECT TLS handshake failed: ${String(error.message || error)}`,
                });
            });
        });
        socket.once('timeout', () => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `proxy CONNECT timeout after ${input.timeoutMs}ms`,
            });
        });
        socket.once('error', (error) => {
            done({
                ok: false,
                latencyMs: Date.now() - startedAt,
                error: `proxy CONNECT socket error: ${String(error.message || error)}`,
            });
        });
        socket.connect(input.proxyPort, input.proxyHost);
    });
}

async function runRealModelProxyPreflight(input: {
    sidecarDir: string;
    timeoutMs?: number;
}): Promise<RealModelProxyPreflight> {
    const timeoutMs = input.timeoutMs ?? 3000;
    const proxyConfig = resolveRealModelProxyConfig(input.sidecarDir);
    if (!proxyConfig.proxyUrl) {
        return {
            status: 'skipped',
            source: proxyConfig.source,
            timeoutMs,
            findings: ['No proxy configured; skip proxy reachability precheck.'],
            recommendations: [],
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(proxyConfig.proxyUrl);
    } catch (error) {
        return {
            status: 'failed',
            source: proxyConfig.source,
            proxyUrl: proxyConfig.proxyUrl,
            bypass: proxyConfig.bypass,
            timeoutMs,
            error: String(error),
            findings: ['Proxy URL is invalid.'],
            recommendations: [
                'Fix proxy URL format in llm-config or proxy environment variables.',
                'Re-run release:readiness:commercial after proxy URL is corrected.',
            ],
        };
    }

    const host = parsed.hostname;
    const port = parsed.port
        ? Number.parseInt(parsed.port, 10)
        : (parsed.protocol === 'https:' || parsed.protocol.startsWith('socks') ? 443 : 80);

    if (!host || !Number.isFinite(port) || port <= 0) {
        return {
            status: 'failed',
            source: proxyConfig.source,
            proxyUrl: proxyConfig.proxyUrl,
            bypass: proxyConfig.bypass,
            timeoutMs,
            error: `invalid proxy endpoint host=${host || '<empty>'}, port=${String(parsed.port || port)}`,
            findings: ['Proxy endpoint host or port is invalid.'],
            recommendations: [
                'Fix proxy host/port in llm-config or proxy environment variables.',
                'Re-run release:readiness:commercial after endpoint validation passes.',
            ],
        };
    }

    const probe = await probeTcpReachability(host, port, timeoutMs);
    const checkedAddress = `${host}:${port}`;
    if (!probe.ok) {
        return {
            status: 'failed',
            source: proxyConfig.source,
            proxyUrl: proxyConfig.proxyUrl,
            bypass: proxyConfig.bypass,
            timeoutMs,
            checkedAddress,
            latencyMs: probe.latencyMs,
            error: probe.error,
            findings: ['Proxy endpoint is unreachable from current host.'],
            recommendations: [
                'Ensure proxy process/service is running and reachable.',
                `Verify outbound route to ${checkedAddress} from this machine.`,
                'Re-run release:readiness:commercial after proxy connectivity is restored.',
            ],
        };
    }

    const proxyAuthHeader = parsed.username
        ? `Basic ${Buffer.from(
            `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
            'utf8',
        ).toString('base64')}`
        : undefined;
    const tunnelTarget = resolveProxyTunnelProbeTarget(input.sidecarDir);
    if (!parsed.protocol.startsWith('socks') && tunnelTarget) {
        const tunnelProbe = await probeHttpConnectTunnel({
            proxyHost: host,
            proxyPort: port,
            timeoutMs,
            targetHost: tunnelTarget.host,
            targetPort: tunnelTarget.port,
            proxyAuthHeader,
        });

        if (!tunnelProbe.ok) {
            return {
                status: 'failed',
                source: proxyConfig.source,
                proxyUrl: proxyConfig.proxyUrl,
                bypass: proxyConfig.bypass,
                timeoutMs,
                checkedAddress,
                latencyMs: probe.latencyMs,
                tunnelTarget: `${tunnelTarget.host}:${tunnelTarget.port}`,
                tunnelSource: tunnelTarget.source,
                tunnelLatencyMs: tunnelProbe.latencyMs,
                tunnelStatus: 'failed',
                error: tunnelProbe.error,
                findings: ['Proxy TCP reachable, but HTTP CONNECT tunnel probe failed.'],
                recommendations: [
                    'Check proxy upstream policy/authentication for HTTPS CONNECT.',
                    'Verify proxy allows CONNECT to the configured provider host.',
                    'Re-run release:readiness:commercial after proxy tunnel path is healthy.',
                ],
            };
        }

        const tlsProbe = await probeTlsHandshakeViaProxy({
            proxyHost: host,
            proxyPort: port,
            timeoutMs,
            targetHost: tunnelTarget.host,
            targetPort: tunnelTarget.port,
            proxyAuthHeader,
        });

        if (!tlsProbe.ok) {
            return {
                status: 'failed',
                source: proxyConfig.source,
                proxyUrl: proxyConfig.proxyUrl,
                bypass: proxyConfig.bypass,
                timeoutMs,
                checkedAddress,
                latencyMs: probe.latencyMs,
                tunnelTarget: `${tunnelTarget.host}:${tunnelTarget.port}`,
                tunnelSource: tunnelTarget.source,
                tunnelLatencyMs: tunnelProbe.latencyMs,
                tunnelStatus: 'passed',
                tlsLatencyMs: tlsProbe.latencyMs,
                tlsStatus: 'failed',
                error: tlsProbe.error,
                findings: [
                    'Proxy endpoint TCP reachability check passed.',
                    'HTTP CONNECT tunnel probe passed.',
                    'TLS handshake through proxy failed.',
                ],
                recommendations: [
                    'Check proxy TLS interception/trust chain and outbound TLS policy.',
                    'Verify target provider host is reachable without TLS handshake resets.',
                    'Re-run release:readiness:commercial after proxy TLS path is healthy.',
                ],
            };
        }

        return {
            status: 'passed',
            source: proxyConfig.source,
            proxyUrl: proxyConfig.proxyUrl,
            bypass: proxyConfig.bypass,
            timeoutMs,
            checkedAddress,
            latencyMs: probe.latencyMs,
            tunnelTarget: `${tunnelTarget.host}:${tunnelTarget.port}`,
            tunnelSource: tunnelTarget.source,
            tunnelLatencyMs: tunnelProbe.latencyMs,
            tunnelStatus: 'passed',
            tlsLatencyMs: tlsProbe.latencyMs,
            tlsStatus: 'passed',
            findings: [
                'Proxy endpoint TCP reachability check passed.',
                'HTTP CONNECT tunnel probe passed.',
                'TLS handshake through proxy passed.',
            ],
            recommendations: [],
        };
    }

    return {
        status: 'passed',
        source: proxyConfig.source,
        proxyUrl: proxyConfig.proxyUrl,
        bypass: proxyConfig.bypass,
        timeoutMs,
        checkedAddress,
        latencyMs: probe.latencyMs,
        tunnelStatus: 'skipped',
        findings: ['Proxy endpoint TCP reachability check passed.'],
        recommendations: [],
    };
}

function existingTestFiles(sidecarDir: string, candidates: string[]): string[] {
    return candidates.filter((candidate) => fs.existsSync(path.join(sidecarDir, candidate)));
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
    const doctorRequiredStatus = options.doctorRequiredStatus
        ?? (options.appDataDir ? 'healthy' : 'degraded');

    const stages: ReleaseStageResult[] = [];
    let realModelProviderPreflight: RealModelProviderPreflight | undefined;
    let realModelProxyPreflight: RealModelProxyPreflight | undefined;
    let realModelFailureClassification: ReturnType<typeof classifyRealModelGateFailure> | undefined;

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
            args: ['test', ...existingTestFiles(sidecarDir, [
                'tests/phase6-final-validation.test.ts',
                'tests/workspace-commands.test.ts',
                'tests/ipc-bridge.test.ts',
                'tests/mastra-entrypoint.test.ts',
                'tests/mastra-additional-commands.test.ts',
                'tests/mastra-scheduler-runtime.test.ts',
                'tests/mastra-scheduler-lease-lock.test.ts',
                'tests/mastra-hook-event-bus.test.ts',
                'tests/mastra-context-compression.test.ts',
                'tests/mastra-remote-session-store.test.ts',
                'tests/mastra-mcp-security.test.ts',
                'tests/mastra-mcp-connection-manager.test.ts',
                'tests/mastra-skill-prompt.test.ts',
                'tests/mastra-plugin-policy.test.ts',
                'tests/mastra-plugin-dependency-resolver.test.ts',
                'tests/mastra-policy-engine.test.ts',
                'tests/execute-task-step.test.ts',
                'tests/mastra-bridge.test.ts',
                'tests/main-mastra-policy-gate.e2e.test.ts',
                'tests/scheduled-full-chain.e2e.test.ts',
                'tests/mastra-task-state-persistence.e2e.test.ts',
                'tests/mastra-context-compression.e2e.test.ts',
                'tests/mastra-rewind-task.e2e.test.ts',
                'tests/mastra-policy-hooks.e2e.test.ts',
                'tests/additional-commands-full-chain.e2e.test.ts',
                'tests/sidecar-doctor.test.ts',
                'tests/release-readiness.test.ts',
            ])],
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
            label: 'Desktop acceptance suite (single-path compatible)',
            cwd: desktopDir,
            command: bin('bun'),
            args: ['test', 'tests/p2-competitive-acceptance.test.ts', 'tests/marketplace-desktop.test.ts'],
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

    if (options.realModelSmoke) {
        const providerPreflightStartedAt = Date.now();
        realModelProviderPreflight = runRealModelProviderPreflight({ sidecarDir });
        const providerPreflightPassed = realModelProviderPreflight.status !== 'failed';
        const providerPreflightNoteParts: string[] = [
            `source=${realModelProviderPreflight.source}`,
            `provider=${realModelProviderPreflight.provider ?? 'unknown'}`,
            `model=${realModelProviderPreflight.modelId ?? 'not-configured'}`,
        ];
        if (realModelProviderPreflight.requiredApiKeyEnv) {
            providerPreflightNoteParts.push(`requiredKey=${realModelProviderPreflight.requiredApiKeyEnv}`);
        }
        if (typeof realModelProviderPreflight.hasApiKey === 'boolean') {
            providerPreflightNoteParts.push(`keyPresent=${realModelProviderPreflight.hasApiKey ? 'yes' : 'no'}`);
        }
        if (realModelProviderPreflight.error) {
            providerPreflightNoteParts.push(`error=${realModelProviderPreflight.error}`);
        }
        if (realModelProviderPreflight.findings.length > 0) {
            providerPreflightNoteParts.push(realModelProviderPreflight.findings.join('; '));
        }
        if (realModelProviderPreflight.recommendations.length > 0) {
            providerPreflightNoteParts.push(`actions=${realModelProviderPreflight.recommendations.join(' / ')}`);
        }

        stages.push({
            id: 'sidecar-real-model-provider-preflight',
            label: 'Sidecar real model provider preflight',
            command: 'provider key preflight',
            cwd: sidecarDir,
            durationMs: Date.now() - providerPreflightStartedAt,
            status: providerPreflightPassed ? 'passed' : 'failed',
            exitCode: providerPreflightPassed ? 0 : 1,
            optional: false,
            note: providerPreflightNoteParts.join(' | '),
        });

        if (!providerPreflightPassed) {
            realModelFailureClassification = classifyRealModelGateFailure({
                providerPreflight: realModelProviderPreflight,
            });
            stages.push({
                id: 'sidecar-real-model-preflight',
                label: 'Sidecar real model proxy preflight',
                command: 'proxy health preflight (tcp + connect)',
                cwd: sidecarDir,
                durationMs: 0,
                status: 'skipped',
                exitCode: 1,
                optional: false,
                note: `Skipped due to provider preflight failure; ${realModelFailureClassification?.summary ?? ''}`,
            });
            stages.push({
                id: 'sidecar-real-model-smoke',
                label: 'Sidecar real model smoke',
                command: 'bun test tests/real-model-smoke.e2e.test.ts',
                cwd: sidecarDir,
                durationMs: 0,
                status: 'skipped',
                exitCode: 1,
                optional: false,
                note: `Skipped due to provider preflight failure category=${realModelFailureClassification?.category ?? 'provider_missing_api_key'}; ${realModelFailureClassification?.summary ?? ''}`,
            });
        } else {
            const preflightStartedAt = Date.now();
            realModelProxyPreflight = await runRealModelProxyPreflight({ sidecarDir });
            const preflightPassed = realModelProxyPreflight.status !== 'failed';
            const preflightNoteParts: string[] = [
                `source=${realModelProxyPreflight.source}`,
                `proxy=${realModelProxyPreflight.proxyUrl ?? 'not-configured'}`,
            ];
            if (realModelProxyPreflight.checkedAddress) {
                preflightNoteParts.push(`checked=${realModelProxyPreflight.checkedAddress}`);
            }
            if (typeof realModelProxyPreflight.latencyMs === 'number') {
                preflightNoteParts.push(`latency=${realModelProxyPreflight.latencyMs}ms`);
            }
            if (realModelProxyPreflight.tunnelStatus) {
                preflightNoteParts.push(`connect=${realModelProxyPreflight.tunnelStatus}`);
            }
            if (realModelProxyPreflight.tunnelTarget) {
                preflightNoteParts.push(`connectTarget=${realModelProxyPreflight.tunnelTarget}`);
            }
            if (typeof realModelProxyPreflight.tunnelLatencyMs === 'number') {
                preflightNoteParts.push(`connectLatency=${realModelProxyPreflight.tunnelLatencyMs}ms`);
            }
            if (realModelProxyPreflight.tlsStatus) {
                preflightNoteParts.push(`tls=${realModelProxyPreflight.tlsStatus}`);
            }
            if (typeof realModelProxyPreflight.tlsLatencyMs === 'number') {
                preflightNoteParts.push(`tlsLatency=${realModelProxyPreflight.tlsLatencyMs}ms`);
            }
            if (realModelProxyPreflight.error) {
                preflightNoteParts.push(`error=${realModelProxyPreflight.error}`);
            }
            if (realModelProxyPreflight.findings.length > 0) {
                preflightNoteParts.push(realModelProxyPreflight.findings.join('; '));
            }
            if (realModelProxyPreflight.recommendations.length > 0) {
                preflightNoteParts.push(`actions=${realModelProxyPreflight.recommendations.join(' / ')}`);
            }

            stages.push({
                id: 'sidecar-real-model-preflight',
                label: 'Sidecar real model proxy preflight',
                command: 'proxy health preflight (tcp + connect)',
                cwd: sidecarDir,
                durationMs: Date.now() - preflightStartedAt,
                status: realModelProxyPreflight.status === 'failed' ? 'failed' : 'passed',
                exitCode: preflightPassed ? 0 : 1,
                optional: false,
                note: preflightNoteParts.join(' | '),
            });

            if (!preflightPassed) {
                realModelFailureClassification = classifyRealModelGateFailure({
                    providerPreflight: realModelProviderPreflight,
                    preflight: realModelProxyPreflight,
                });
                stages.push({
                    id: 'sidecar-real-model-smoke',
                    label: 'Sidecar real model smoke',
                    command: 'bun test tests/real-model-smoke.e2e.test.ts',
                    cwd: sidecarDir,
                    durationMs: 0,
                    status: 'skipped',
                    exitCode: 1,
                    optional: false,
                    note: `Skipped due to preflight failure category=${realModelFailureClassification?.category ?? 'proxy_unreachable'}; ${realModelFailureClassification?.summary ?? ''}`,
                });
            } else {
                const realModelStage = runStage({
                    id: 'sidecar-real-model-smoke',
                    label: 'Sidecar real model smoke',
                    cwd: sidecarDir,
                    command: bin('bun'),
                    args: ['test', 'tests/real-model-smoke.e2e.test.ts'],
                    env: {
                        COWORKANY_REQUIRE_REAL_MODEL_SMOKE: '1',
                    },
                    optional: false,
                });
                if (realModelStage.status === 'failed') {
                    realModelFailureClassification = classifyRealModelGateFailure({
                        stageNote: realModelStage.note,
                        providerPreflight: realModelProviderPreflight,
                        preflight: realModelProxyPreflight,
                    });
                    if (realModelFailureClassification) {
                        const actionSummary = realModelFailureClassification.recommendations.join(' / ');
                        realModelStage.note = [
                            `category=${realModelFailureClassification.category}`,
                            `summary=${realModelFailureClassification.summary}`,
                            `evidence=${realModelFailureClassification.evidence}`,
                            `actions=${actionSummary}`,
                        ].join(' | ');
                    }
                }
                stages.push(realModelStage);
            }
        }
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

    const jsonPath = path.join(options.outputDir, 'report.json');
    const markdownPath = path.join(options.outputDir, 'report.md');
    const checklist = createDefaultCanaryChecklist();
    const canaryEvidencePath = options.canaryEvidencePath
        ? path.resolve(options.canaryEvidencePath)
        : path.join(options.outputDir, 'canary-evidence.json');
    const canaryEvidence = summarizeCanaryChecklistEvidence({
        checklist,
        evidencePath: canaryEvidencePath,
    });
    const canaryEvidenceGate = evaluateCanaryChecklistEvidence(
        canaryEvidence,
        options.requireCanaryEvidence,
    );

    let report: ReleaseReadinessReport = {
        generatedAt: new Date().toISOString(),
        repositoryRoot,
        requestedOptions: {
            buildDesktop: options.buildDesktop,
            realE2E: options.realE2E,
            realModelSmoke: options.realModelSmoke,
            appDataDir: options.appDataDir,
            startupProfile: options.startupProfile,
            doctorRequiredStatus,
            canaryEvidencePath,
            requireCanaryEvidence: options.requireCanaryEvidence,
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
        canaryEvidence,
        canaryEvidenceGate,
        observability,
        checklist,
        realModelGate: options.realModelSmoke
            ? {
                providerPreflight: realModelProviderPreflight,
                preflight: realModelProxyPreflight,
                failureClassification: realModelFailureClassification,
            }
            : undefined,
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    const doctorStartedAt = Date.now();
    const doctorOutputDir = path.join(options.outputDir, 'doctor');
    fs.mkdirSync(doctorOutputDir, { recursive: true });
    const doctorReportPath = path.join(doctorOutputDir, 'report.json');
    const doctorMarkdownPath = path.join(doctorOutputDir, 'report.md');
    const doctorReport = runSidecarDoctor({
        repositoryRoot,
        appDataDir: options.appDataDir,
        startupProfile: options.startupProfile,
        artifactTelemetryPath: options.artifactTelemetryPath,
        readinessReportPath: jsonPath,
        controlPlaneThresholdsPath: controlPlaneEvalThresholds.sourcePath,
        controlPlaneThresholdProfile: controlPlaneEvalThresholds.profile,
    });
    fs.writeFileSync(doctorReportPath, JSON.stringify(doctorReport, null, 2), 'utf-8');
    fs.writeFileSync(doctorMarkdownPath, formatSidecarDoctorReport(doctorReport), 'utf-8');
    const sidecarDoctor = summarizeSidecarDoctorReport(doctorReportPath, doctorMarkdownPath);
    const sidecarDoctorGate = evaluateSidecarDoctorReadiness(sidecarDoctor, doctorRequiredStatus);

    stages.push({
        id: 'sidecar-doctor',
        label: 'Sidecar doctor preflight',
        command: `bun run doctor -- --output-dir ${doctorOutputDir} --readiness-report ${jsonPath}`,
        cwd: sidecarDir,
        durationMs: Date.now() - doctorStartedAt,
        status: sidecarDoctorGate.passed ? 'passed' : 'failed',
        exitCode: sidecarDoctorGate.passed ? 0 : 1,
        note: sidecarDoctorGate.findings.join(' | ') || undefined,
    });

    try {
        const extensionAllowlistPolicy = loadWorkspaceExtensionAllowlistPolicy(repositoryRoot);
        const allowlistGate = evaluateWorkspaceExtensionAllowlistReadiness({
            mode: extensionAllowlistPolicy.mode,
            allowedSkills: extensionAllowlistPolicy.allowedSkills,
            allowedToolpacks: extensionAllowlistPolicy.allowedToolpacks,
            enabledSkills: readEnabledSkillIds(repositoryRoot),
            enabledToolpacks: readEnabledToolpackIds(repositoryRoot),
        });
        const summaryBits = [
            `mode=${extensionAllowlistPolicy.mode}`,
            `enabledSkills=${allowlistGate.enabledSkills.length}`,
            `enabledToolpacks=${allowlistGate.enabledToolpacks.length}`,
        ];

        stages.push({
            id: 'workspace-extension-allowlist',
            label: 'Workspace extension allowlist gate',
            command: 'workspace extension allowlist policy check',
            cwd: repositoryRoot,
            durationMs: 0,
            status: allowlistGate.passed ? 'passed' : 'failed',
            exitCode: allowlistGate.passed ? 0 : 1,
            note: allowlistGate.passed
                ? `${allowlistGate.summary} (${summaryBits.join(', ')})`
                : `${allowlistGate.summary} ${allowlistGate.findings.join(' | ')} (${summaryBits.join(', ')})`,
        });
    } catch (error) {
        stages.push({
            id: 'workspace-extension-allowlist',
            label: 'Workspace extension allowlist gate',
            command: 'workspace extension allowlist policy check',
            cwd: repositoryRoot,
            durationMs: 0,
            status: 'failed',
            exitCode: 1,
            note: `Failed to evaluate extension allowlist readiness: ${String(error)}`,
        });
    }

    stages.push({
        id: 'canary-checklist-evidence',
        label: 'Canary checklist evidence gate',
        command: `canary checklist evidence validation (${canaryEvidencePath})`,
        cwd: repositoryRoot,
        durationMs: 0,
        status: canaryEvidenceGate.passed ? 'passed' : 'failed',
        exitCode: canaryEvidenceGate.passed ? 0 : 1,
        note: canaryEvidenceGate.passed
            ? `required=${canaryEvidenceGate.required ? 'yes' : 'no'}, completedAreas=${canaryEvidence.completedAreas.length}, missingAreas=${canaryEvidence.missingAreas.length}`
            : canaryEvidenceGate.findings.join(' | '),
    });

    report = {
        ...report,
        stages,
        sidecarDoctor,
        sidecarDoctorGate,
        canaryEvidence,
        canaryEvidenceGate,
        realModelGate: options.realModelSmoke
            ? {
                providerPreflight: realModelProviderPreflight,
                preflight: realModelProxyPreflight,
                failureClassification: realModelFailureClassification,
            }
            : undefined,
    };

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
