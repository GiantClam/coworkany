const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1';

const PROXY_ENV_KEYS = [
    'COWORKANY_PROXY_URL',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
] as const;

type ProxyEnvKey = typeof PROXY_ENV_KEYS[number];

export type ProxySettings = {
    enabled?: boolean | null;
    url?: string | null;
    bypass?: string | null;
};

let lastAppliedProxySignature: string | null = null;

function firstNonEmptyEnv(keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}

function setProxyEnvVar(key: ProxyEnvKey, value: string): void {
    process.env[key] = value;
}

function clearProxyEnvVar(key: ProxyEnvKey): void {
    delete process.env[key];
}

export function sanitizeProxyForLog(proxyUrl: string): string {
    const atPos = proxyUrl.lastIndexOf('@');
    if (atPos === -1) {
        return proxyUrl;
    }

    const schemeEnd = proxyUrl.indexOf('://');
    if (schemeEnd >= 0) {
        return `${proxyUrl.slice(0, schemeEnd + 3)}***@${proxyUrl.slice(atPos + 1)}`;
    }

    return `***@${proxyUrl.slice(atPos + 1)}`;
}

export function applyProxySettingsToProcessEnv(proxy?: ProxySettings): void {
    const enabled = proxy?.enabled === true;
    const proxyUrl = proxy?.url?.trim() ?? '';
    const bypass = proxy?.bypass?.trim() ?? '';

    if (enabled && proxyUrl) {
        const signature = `${proxyUrl}|${bypass}`;

        for (const key of PROXY_ENV_KEYS) {
            setProxyEnvVar(key, proxyUrl);
        }

        process.env.COWORKANY_PROXY_SOURCE = 'config';
        process.env.NODE_USE_ENV_PROXY = '1';

        const noProxy = bypass || firstNonEmptyEnv(['NO_PROXY', 'no_proxy']) || DEFAULT_NO_PROXY;
        process.env.NO_PROXY = noProxy;
        process.env.no_proxy = noProxy;

        if (lastAppliedProxySignature !== signature) {
            console.error(`[Proxy] LLM proxy enabled from llm-config: ${sanitizeProxyForLog(proxyUrl)}`);
        }
        lastAppliedProxySignature = signature;
        return;
    }

    const appliedFromConfig = process.env.COWORKANY_PROXY_SOURCE === 'config' || lastAppliedProxySignature !== null;
    if (!appliedFromConfig) {
        return;
    }

    for (const key of PROXY_ENV_KEYS) {
        clearProxyEnvVar(key);
    }
    delete process.env.COWORKANY_PROXY_SOURCE;
    lastAppliedProxySignature = null;
    console.error('[Proxy] Cleared llm-config proxy overrides for sidecar process');
}
