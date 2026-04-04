import * as fs from 'fs';
import * as path from 'path';

export type RuntimeSearchProvider = 'serper' | 'searxng' | 'tavily' | 'brave';

export interface RuntimeSearchConfig {
    provider?: RuntimeSearchProvider;
    serperApiKey?: string;
    searxngUrl?: string;
    tavilyApiKey?: string;
    braveApiKey?: string;
}

export interface RuntimeLlmConfig {
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
        searxngUrl?: string;
        tavilyApiKey?: string;
        braveApiKey?: string;
    };
    loadedFromPath: string | null;
    candidatePaths: string[];
    sources: {
        provider: string;
        serperApiKey: string;
        searxngUrl: string;
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
            searxngUrlConfigured: boolean;
            tavilyApiKeyConfigured: boolean;
            braveApiKeyConfigured: boolean;
        };
    };
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

function normalizeSearchProvider(value: unknown): RuntimeSearchProvider {
    if (value === 'serper' || value === 'searxng' || value === 'tavily' || value === 'brave') {
        return value;
    }
    return 'serper';
}

function pickConfigString(value: unknown): string | undefined {
    const normalized = toNonEmpty(value);
    return normalized ?? undefined;
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
    const appDataDir = toNonEmpty(input.appDataDir) ?? toNonEmpty(process.env.COWORKANY_APP_DATA_DIR);
    if (appDataDir) {
        return appDataDir;
    }

    const cwd = toNonEmpty(input.cwd) ?? process.cwd();
    return path.join(cwd, '.coworkany');
}

export function resolveRuntimeConfigCandidatePaths(input: RuntimeConfigLoadInput = {}): string[] {
    const appDataDir = resolveRuntimeAppDataRoot(input);
    const cwd = toNonEmpty(input.cwd) ?? process.cwd();

    const candidates = [
        path.join(appDataDir, 'llm-config.json'),
        path.join(cwd, 'llm-config.json'),
    ].filter((entry): entry is string => Boolean(entry));

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
        ?? 'serper'
    );

    const serperFromEnv = pickFromEnv(env, ['SERPER_API_KEY']);
    const tavilyFromEnv = pickFromEnv(env, ['TAVILY_API_KEY']);
    const braveFromEnv = pickFromEnv(env, ['BRAVE_API_KEY']);
    const searxngFromEnv = pickFromEnv(env, ['SEARXNG_URL']);

    if (serperFromEnv.value && pickConfigString(config.serperApiKey) && serperFromEnv.value !== pickConfigString(config.serperApiKey)) {
        conflicts.push('search.serperApiKey env(SERPER_API_KEY) overrides config');
    }
    if (tavilyFromEnv.value && pickConfigString(config.tavilyApiKey) && tavilyFromEnv.value !== pickConfigString(config.tavilyApiKey)) {
        conflicts.push('search.tavilyApiKey env(TAVILY_API_KEY) overrides config');
    }
    if (braveFromEnv.value && pickConfigString(config.braveApiKey) && braveFromEnv.value !== pickConfigString(config.braveApiKey)) {
        conflicts.push('search.braveApiKey env(BRAVE_API_KEY) overrides config');
    }
    if (searxngFromEnv.value && pickConfigString(config.searxngUrl) && searxngFromEnv.value !== pickConfigString(config.searxngUrl)) {
        conflicts.push('search.searxngUrl env(SEARXNG_URL) overrides config');
    }

    return {
        settings: {
            provider,
            serperApiKey: serperFromEnv.value ?? pickConfigString(config.serperApiKey),
            searxngUrl: searxngFromEnv.value ?? pickConfigString(config.searxngUrl),
            tavilyApiKey: tavilyFromEnv.value ?? pickConfigString(config.tavilyApiKey),
            braveApiKey: braveFromEnv.value ?? pickConfigString(config.braveApiKey),
        },
        loadedFromPath: snapshot.loadedFromPath,
        candidatePaths: snapshot.candidatePaths,
        sources: {
            provider: providerFromEnv.source ?? (providerFromConfig ? configSource : 'default:serper'),
            serperApiKey: serperFromEnv.source ?? (pickConfigString(config.serperApiKey) ? configSource : 'unset'),
            searxngUrl: searxngFromEnv.source ?? (pickConfigString(config.searxngUrl) ? configSource : 'unset'),
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
                searxngUrlConfigured: Boolean(resolved.settings.searxngUrl),
                tavilyApiKeyConfigured: Boolean(resolved.settings.tavilyApiKey),
                braveApiKeyConfigured: Boolean(resolved.settings.braveApiKey),
            },
        },
    };
}
