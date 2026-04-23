import * as fs from 'fs';
import * as path from 'path';

export type RuntimeSearchProvider = 'serper' | 'exa' | 'tavily' | 'brave';

export interface RuntimeSearchConfig {
    provider?: RuntimeSearchProvider;
    serperApiKey?: string;
    exaApiKey?: string;
    tavilyApiKey?: string;
    braveApiKey?: string;
}

export interface RuntimeLlmConfig {
    provider?: string;
    activeProfileId?: string;
    profiles?: unknown[];
    anthropic?: Record<string, unknown> | null;
    openai?: Record<string, unknown> | null;
    custom?: Record<string, unknown> | null;
    search?: Partial<RuntimeSearchConfig>;
}

export interface RuntimeConfigSnapshot {
    config: RuntimeLlmConfig;
    loadedFromPath: string | null;
    candidatePaths: string[];
}

export interface RuntimeSearchConfigResolution {
    settings: {
        provider: RuntimeSearchProvider;
        serperApiKey?: string;
        exaApiKey?: string;
        tavilyApiKey?: string;
        braveApiKey?: string;
    };
    loadedFromPath: string | null;
    candidatePaths: string[];
    sources: {
        provider: string;
        serperApiKey: string;
        exaApiKey: string;
        tavilyApiKey: string;
        braveApiKey: string;
    };
    conflicts: string[];
}

export interface RuntimeConfigDoctorSummary {
    loadedFromPath: string | null;
    candidatePaths: string[];
    conflicts: string[];
    search: {
        provider: {
            value: RuntimeSearchProvider;
            source: string;
        };
        credentials: {
            serperApiKeyConfigured: boolean;
            exaApiKeyConfigured: boolean;
            tavilyApiKeyConfigured: boolean;
            braveApiKeyConfigured: boolean;
        };
    };
}

export interface RuntimeLlmEnvSeedResult {
    loadedFromPath: string | null;
    candidatePaths: string[];
    seededKeys: string[];
    provider: string | null;
    modelId: string | null;
}

interface RuntimeConfigLoadInput {
    appDataDir?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

function toNonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value) || Array.isArray(value)) {
        return null;
    }
    return value;
}

function normalizeOpenAiBaseUrl(value: string | null): string | null {
    if (!value) {
        return null;
    }
    if (value.endsWith('/chat/completions')) {
        return value.slice(0, -'/chat/completions'.length);
    }
    return value.replace(/\/+$/u, '');
}

function withModelPrefix(provider: string, model: string | null): string | null {
    if (!model) {
        return null;
    }
    if (model.includes('/')) {
        return model;
    }
    return `${provider}/${model}`;
}

const OPENAI_COMPATIBLE_LLM_PROVIDERS = new Set([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);

function normalizeSearchProvider(value: unknown): RuntimeSearchProvider {
    if (value === 'serper' || value === 'exa' || value === 'tavily' || value === 'brave') {
        return value;
    }
    return 'exa';
}

function pickConfigString(value: unknown): string | undefined {
    const normalized = toNonEmpty(value);
    return normalized ?? undefined;
}

function pickConfigBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return undefined;
}

function applyInsecureTlsEnv(values: Record<string, string>, allowInsecureTls: boolean | undefined): void {
    if (allowInsecureTls !== true) {
        return;
    }
    values.COWORKANY_ALLOW_INSECURE_TLS = '1';
    values.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function pickFromEnv(
    env: NodeJS.ProcessEnv,
    keys: string[],
): { value?: string; source?: string } {
    for (const key of keys) {
        const value = toNonEmpty(env[key]) ?? undefined;
        if (value) {
            return {
                value,
                source: `env:${key}`,
            };
        }
    }
    return {};
}

export function resolveRuntimeAppDataRoot(input: RuntimeConfigLoadInput = {}): string {
    const env = input.env ?? process.env;
    const appDataDir = toNonEmpty(input.appDataDir) ?? toNonEmpty(env.COWORKANY_APP_DATA_DIR);
    if (appDataDir) {
        return appDataDir;
    }

    const cwd = toNonEmpty(input.cwd) ?? process.cwd();
    return path.join(cwd, '.coworkany');
}

export function resolveRuntimeConfigCandidatePaths(input: RuntimeConfigLoadInput = {}): string[] {
    const env = input.env ?? process.env;
    const appDataDir = resolveRuntimeAppDataRoot(input);
    const cwd = toNonEmpty(input.cwd) ?? process.cwd();
    const hasExplicitAppDataDir = Boolean(
        toNonEmpty(input.appDataDir)
        ?? toNonEmpty(env.COWORKANY_APP_DATA_DIR),
    );

    const candidates = hasExplicitAppDataDir
        ? [path.join(appDataDir, 'llm-config.json')]
        : [
            path.join(appDataDir, 'llm-config.json'),
            path.join(cwd, 'llm-config.json'),
        ];

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const candidate of candidates) {
        if (seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        unique.push(candidate);
    }

    return unique;
}

export function loadRuntimeLlmConfigSnapshot(input: RuntimeConfigLoadInput = {}): RuntimeConfigSnapshot {
    const candidatePaths = resolveRuntimeConfigCandidatePaths(input);
    for (const configPath of candidatePaths) {
        try {
            if (!fs.existsSync(configPath)) {
                continue;
            }
            const raw = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (!isRecord(parsed)) {
                continue;
            }
            return {
                config: parsed as RuntimeLlmConfig,
                loadedFromPath: configPath,
                candidatePaths,
            };
        } catch {
            // ignore malformed candidates and keep trying fallback paths
        }
    }

    return {
        config: {},
        loadedFromPath: null,
        candidatePaths,
    };
}

function loadRuntimeLlmConfigCandidates(input: RuntimeConfigLoadInput = {}): Array<{
    path: string;
    config: RuntimeLlmConfig;
}> {
    const candidatePaths = resolveRuntimeConfigCandidatePaths(input);
    const loaded: Array<{
        path: string;
        config: RuntimeLlmConfig;
    }> = [];
    for (const configPath of candidatePaths) {
        try {
            if (!fs.existsSync(configPath)) {
                continue;
            }
            const raw = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (!isRecord(parsed)) {
                continue;
            }
            loaded.push({
                path: configPath,
                config: parsed as RuntimeLlmConfig,
            });
        } catch {
            // ignore malformed candidates and keep trying fallback paths
        }
    }
    return loaded;
}

function resolveActiveLlmProfile(config: RuntimeLlmConfig): Record<string, unknown> | null {
    const profiles = Array.isArray(config.profiles)
        ? config.profiles
            .map((entry) => toRecord(entry))
            .filter((entry): entry is Record<string, unknown> => entry !== null)
        : [];
    if (profiles.length === 0) {
        return null;
    }
    const activeProfileId = toNonEmpty(config.activeProfileId);
    if (activeProfileId) {
        const matched = profiles.find((profile) => toNonEmpty(profile.id) === activeProfileId);
        if (matched) {
            return matched;
        }
    }
    const verified = profiles.find((profile) => profile.verified === true);
    return verified ?? profiles[0] ?? null;
}

function pickLlmSection(
    root: RuntimeLlmConfig,
    profile: Record<string, unknown> | null,
    key: 'anthropic' | 'openai' | 'custom',
): Record<string, unknown> {
    const fromProfile = toRecord(profile?.[key]);
    if (fromProfile) {
        return fromProfile;
    }
    return toRecord(root[key]) ?? {};
}

function resolveRuntimeLlmEnvValuesFromConfig(config: RuntimeLlmConfig): {
    values: Record<string, string>;
    provider: string | null;
    modelId: string | null;
} {
    const activeProfile = resolveActiveLlmProfile(config);
    const provider = (
        toNonEmpty(activeProfile?.provider)
        ?? toNonEmpty(config.provider)
    )?.toLowerCase() ?? null;
    if (!provider) {
        return {
            values: {},
            provider: null,
            modelId: null,
        };
    }

    const values: Record<string, string> = {
        COWORKANY_LLM_CONFIG_PROVIDER: provider,
    };
    let modelId: string | null = null;

    if (provider === 'anthropic') {
        const anthropic = pickLlmSection(config, activeProfile, 'anthropic');
        const apiKey = toNonEmpty(anthropic.apiKey);
        const model = toNonEmpty(anthropic.model);
        const allowInsecureTls = pickConfigBoolean(anthropic.allowInsecureTls ?? anthropic.allow_insecure_tls);
        if (apiKey) {
            values.ANTHROPIC_API_KEY = apiKey;
        }
        applyInsecureTlsEnv(values, allowInsecureTls);
        modelId = withModelPrefix('anthropic', model);
        if (modelId) {
            values.COWORKANY_MODEL = modelId;
        }
        return {
            values,
            provider,
            modelId,
        };
    }

    if (provider === 'custom') {
        const custom = pickLlmSection(config, activeProfile, 'custom');
        const apiFormat = (toNonEmpty(custom.apiFormat)?.toLowerCase() ?? 'openai');
        values.COWORKANY_LLM_CUSTOM_API_FORMAT = apiFormat;
        const apiKey = toNonEmpty(custom.apiKey);
        const model = toNonEmpty(custom.model);
        const allowInsecureTls = pickConfigBoolean(custom.allowInsecureTls ?? custom.allow_insecure_tls);
        applyInsecureTlsEnv(values, allowInsecureTls);
        if (apiFormat === 'anthropic') {
            if (apiKey) {
                values.ANTHROPIC_API_KEY = apiKey;
            }
            modelId = withModelPrefix('anthropic', model);
            if (modelId) {
                values.COWORKANY_MODEL = modelId;
            }
            return {
                values,
                provider,
                modelId,
            };
        }
        const baseUrl = normalizeOpenAiBaseUrl(toNonEmpty(custom.baseUrl));
        if (apiKey) {
            values.OPENAI_API_KEY = apiKey;
        }
        if (baseUrl) {
            values.OPENAI_BASE_URL = baseUrl;
        }
        modelId = withModelPrefix('openai', model);
        if (modelId) {
            values.COWORKANY_MODEL = modelId;
        }
        return {
            values,
            provider,
            modelId,
        };
    }

    if (OPENAI_COMPATIBLE_LLM_PROVIDERS.has(provider)) {
        const openai = pickLlmSection(config, activeProfile, 'openai');
        const apiKey = toNonEmpty(openai.apiKey);
        const baseUrl = normalizeOpenAiBaseUrl(toNonEmpty(openai.baseUrl));
        const model = toNonEmpty(openai.model);
        const allowInsecureTls = pickConfigBoolean(openai.allowInsecureTls ?? openai.allow_insecure_tls);
        if (apiKey) {
            values.OPENAI_API_KEY = apiKey;
        }
        if (baseUrl) {
            values.OPENAI_BASE_URL = baseUrl;
        }
        applyInsecureTlsEnv(values, allowInsecureTls);
        modelId = withModelPrefix(provider === 'openai' ? 'openai' : provider, model);
        if (modelId) {
            values.COWORKANY_MODEL = modelId;
        }
        return {
            values,
            provider,
            modelId,
        };
    }

    return {
        values,
        provider,
        modelId,
    };
}

function assignEnvIfMissing(
    env: NodeJS.ProcessEnv,
    key: string,
    value: string | undefined,
): boolean {
    const normalized = toNonEmpty(value);
    if (!normalized) {
        return false;
    }
    if (toNonEmpty(env[key])) {
        return false;
    }
    env[key] = normalized;
    return true;
}

export function seedRuntimeLlmEnvFromConfig(input: RuntimeConfigLoadInput = {}): RuntimeLlmEnvSeedResult {
    const candidatePaths = resolveRuntimeConfigCandidatePaths(input);
    const env = input.env ?? process.env;
    const candidates = loadRuntimeLlmConfigCandidates(input);
    for (const candidate of candidates) {
        const resolved = resolveRuntimeLlmEnvValuesFromConfig(candidate.config);
        if (!resolved.provider) {
            continue;
        }
        const seededKeys: string[] = [];
        for (const [key, value] of Object.entries(resolved.values)) {
            if (assignEnvIfMissing(env, key, value)) {
                seededKeys.push(key);
            }
        }
        return {
            loadedFromPath: candidate.path,
            candidatePaths,
            seededKeys,
            provider: resolved.provider,
            modelId: resolved.modelId,
        };
    }
    return {
        loadedFromPath: null,
        candidatePaths,
        seededKeys: [],
        provider: null,
        modelId: null,
    };
}

export function loadRuntimeSearchConfigSnapshot(input: RuntimeConfigLoadInput = {}): {
    search: Partial<RuntimeSearchConfig>;
    loadedFromPath: string | null;
    candidatePaths: string[];
} {
    const snapshot = loadRuntimeLlmConfigSnapshot(input);
    const search = isRecord(snapshot.config.search)
        ? (snapshot.config.search as Partial<RuntimeSearchConfig>)
        : {};

    return {
        search,
        loadedFromPath: snapshot.loadedFromPath,
        candidatePaths: snapshot.candidatePaths,
    };
}

export function resolveRuntimeSearchConfig(input: RuntimeConfigLoadInput = {}): RuntimeSearchConfigResolution {
    const snapshot = loadRuntimeSearchConfigSnapshot(input);
    const env = input.env ?? process.env;
    const config = snapshot.search;
    const conflicts: string[] = [];
    const configSource = snapshot.loadedFromPath ? `config:${snapshot.loadedFromPath}` : 'config:none';

    const providerFromEnv = pickFromEnv(env, ['COWORKANY_SEARCH_PROVIDER', 'SEARCH_PROVIDER']);
    const providerFromConfig = pickConfigString(config.provider);
    if (
        providerFromEnv.value
        && providerFromConfig
        && providerFromEnv.value !== providerFromConfig
    ) {
        conflicts.push(`search.provider env(${providerFromEnv.value}) overrides config(${providerFromConfig})`);
    }
    const provider = normalizeSearchProvider(
        providerFromEnv.value
        ?? providerFromConfig
        ?? 'exa'
    );

    const serperFromEnv = pickFromEnv(env, ['SERPER_API_KEY']);
    const exaFromEnv = pickFromEnv(env, ['EXA_API_KEY']);
    const tavilyFromEnv = pickFromEnv(env, ['TAVILY_API_KEY']);
    const braveFromEnv = pickFromEnv(env, ['BRAVE_API_KEY']);

    if (serperFromEnv.value && pickConfigString(config.serperApiKey) && serperFromEnv.value !== pickConfigString(config.serperApiKey)) {
        conflicts.push('search.serperApiKey env(SERPER_API_KEY) overrides config');
    }
    if (exaFromEnv.value && pickConfigString(config.exaApiKey) && exaFromEnv.value !== pickConfigString(config.exaApiKey)) {
        conflicts.push('search.exaApiKey env(EXA_API_KEY) overrides config');
    }
    if (tavilyFromEnv.value && pickConfigString(config.tavilyApiKey) && tavilyFromEnv.value !== pickConfigString(config.tavilyApiKey)) {
        conflicts.push('search.tavilyApiKey env(TAVILY_API_KEY) overrides config');
    }
    if (braveFromEnv.value && pickConfigString(config.braveApiKey) && braveFromEnv.value !== pickConfigString(config.braveApiKey)) {
        conflicts.push('search.braveApiKey env(BRAVE_API_KEY) overrides config');
    }
    return {
        settings: {
            provider,
            serperApiKey: serperFromEnv.value ?? pickConfigString(config.serperApiKey),
            exaApiKey: exaFromEnv.value ?? pickConfigString(config.exaApiKey),
            tavilyApiKey: tavilyFromEnv.value ?? pickConfigString(config.tavilyApiKey),
            braveApiKey: braveFromEnv.value ?? pickConfigString(config.braveApiKey),
        },
        loadedFromPath: snapshot.loadedFromPath,
        candidatePaths: snapshot.candidatePaths,
        sources: {
            provider: providerFromEnv.source ?? (providerFromConfig ? configSource : 'default:exa'),
            serperApiKey: serperFromEnv.source ?? (pickConfigString(config.serperApiKey) ? configSource : 'unset'),
            exaApiKey: exaFromEnv.source ?? (pickConfigString(config.exaApiKey) ? configSource : 'unset'),
            tavilyApiKey: tavilyFromEnv.source ?? (pickConfigString(config.tavilyApiKey) ? configSource : 'unset'),
            braveApiKey: braveFromEnv.source ?? (pickConfigString(config.braveApiKey) ? configSource : 'unset'),
        },
        conflicts,
    };
}

export function buildRuntimeConfigDoctorSummary(input: RuntimeConfigLoadInput = {}): RuntimeConfigDoctorSummary {
    const resolved = resolveRuntimeSearchConfig(input);
    return {
        loadedFromPath: resolved.loadedFromPath,
        candidatePaths: resolved.candidatePaths,
        conflicts: resolved.conflicts,
        search: {
            provider: {
                value: resolved.settings.provider,
                source: resolved.sources.provider,
            },
            credentials: {
                serperApiKeyConfigured: Boolean(resolved.settings.serperApiKey),
                exaApiKeyConfigured: Boolean(resolved.settings.exaApiKey),
                tavilyApiKeyConfigured: Boolean(resolved.settings.tavilyApiKey),
                braveApiKeyConfigured: Boolean(resolved.settings.braveApiKey),
            },
        },
    };
}
