/**
 * Retry with Exponential Backoff
 *
 * Provides a robust fetch wrapper that:
 *   - Detects retryable HTTP status codes (429, 500, 502, 503)
 *   - Implements true exponential backoff: baseDelay * 2^attempt
 *   - Respects Retry-After header from rate limit responses
 *   - Caps maximum delay at maxDelay
 *   - Supports timeout per request via AbortController
 *   - Reports rate limit events to callers via callback
 */

import { applyInsecureTlsToRequestInit } from './tls';

// ============================================================================
// Types
// ============================================================================

export interface FetchWithBackoffOptions {
    /** Timeout per individual request in ms (default: 60000) */
    timeout?: number;
    /** Maximum retry attempts (default: 5) */
    maxRetries?: number;
    /** Base delay in ms (default: 1000) */
    baseDelay?: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay?: number;
    /** HTTP status codes to retry on (default: [429, 500, 502, 503]) */
    retryOnStatus?: number[];
    /** Callback when a retry is about to happen */
    onRetry?: (info: RetryInfo) => void;
    /** Disable TLS certificate verification (unsafe, opt-in only) */
    allowInsecureTls?: boolean;
}

export interface RetryInfo {
    attempt: number;
    maxRetries: number;
    status: number;
    delay: number;
    retryAfter: number | null;
}

// ============================================================================
// Default config
// ============================================================================

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503];
const NON_RETRYABLE_ERRORS = ['missing_api_key', 'missing_base_url', 'invalid_api_key'];
const PROXY_ENV_KEYS = [
    'COWORKANY_PROXY_URL',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
] as const;

let proxyFetchCache:
    | {
        proxyUrl: string;
        fetchImpl: typeof fetch;
    }
    | null = null;
let proxyBridgeLogSignature: string | null = null;
let proxyBridgeLoadFailed = false;
let directFetchBridge: typeof fetch | null = null;
let directBridgeLoadAttempted = false;
let directBridgeLoadFailed = false;
const DOH_CACHE_TTL_MS = 10 * 60 * 1000;
const dohCache = new Map<string, { ips: string[]; expiresAt: number }>();
const PROXY_ROUTE_STATE_TTL_MS = 30 * 60 * 1000;
const PROXY_REPROBE_INTERVAL_MS = 5 * 60 * 1000;
type ProxyRouteMode = 'proxy' | 'doh';
type ProxyRouteState = {
    mode: ProxyRouteMode;
    updatedAt: number;
    nextProxyProbeAt: number;
    preferredDohIp?: string;
};
const proxyRouteStateByHost = new Map<string, ProxyRouteState>();
let nodeReadableToWeb:
    | ((stream: NodeJS.ReadableStream) => ReadableStream<Uint8Array>)
    | null
    | undefined;

function formatErrorDetails(error: Error): string {
    const details: string[] = [];
    const unknownError = error as Error & {
        code?: string;
        errno?: string | number;
        syscall?: string;
        cause?: unknown;
    };

    if (unknownError.name && unknownError.name !== 'Error') {
        details.push(`name=${unknownError.name}`);
    }
    if (unknownError.code) {
        details.push(`code=${unknownError.code}`);
    }
    if (unknownError.errno !== undefined) {
        details.push(`errno=${String(unknownError.errno)}`);
    }
    if (unknownError.syscall) {
        details.push(`syscall=${unknownError.syscall}`);
    }

    let currentCause = unknownError.cause;
    let depth = 0;
    while (currentCause && depth < 3) {
        if (currentCause instanceof Error) {
            const parts = [currentCause.name, currentCause.message].filter(Boolean);
            details.push(`cause=${parts.join(': ')}`);
            currentCause = (currentCause as Error & { cause?: unknown }).cause;
        } else {
            details.push(`cause=${String(currentCause)}`);
            break;
        }
        depth += 1;
    }

    return details.length > 0 ? ` (${details.join(', ')})` : '';
}

function canUseNodeProxyBridge(): boolean {
    return typeof process !== 'undefined' && !!process.versions?.node;
}

function firstNonEmptyEnv(keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}

function sanitizeProxyForLog(proxyUrl: string): string {
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

function hostMatchesNoProxyRule(hostname: string, rule: string): boolean {
    const normalizedRule = rule.trim().toLowerCase();
    if (!normalizedRule) return false;
    if (normalizedRule === '*') return true;

    const hostnameOnly = hostname.toLowerCase();
    const ruleWithoutPort = normalizedRule.replace(/:\d+$/, '');

    if (ruleWithoutPort.startsWith('*.')) {
        return hostnameOnly.endsWith(ruleWithoutPort.slice(1));
    }
    if (ruleWithoutPort.startsWith('.')) {
        return hostnameOnly.endsWith(ruleWithoutPort);
    }
    return hostnameOnly === ruleWithoutPort;
}

function shouldBypassProxy(url: string): boolean {
    const noProxyRaw = firstNonEmptyEnv(['NO_PROXY', 'no_proxy']);
    if (!noProxyRaw) return false;

    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch {
        return false;
    }

    return noProxyRaw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .some((rule) => hostMatchesNoProxyRule(hostname, rule));
}

function isIpv4Address(value: string): boolean {
    const parts = value.split('.');
    if (parts.length !== 4) {
        return false;
    }
    return parts.every((part) => {
        if (!/^\d+$/.test(part)) return false;
        const n = Number(part);
        return n >= 0 && n <= 255;
    });
}

function isTlsDisconnectError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = `${error.name} ${error.message}`.toLowerCase();
    return message.includes('secure tls connection')
        || message.includes('ssl_connect')
        || message.includes('connection was closed unexpectedly')
        || message.includes('unable to get issuer certificate')
        || message.includes('unable_to_get_issuer_cert');
}

function toUrl(input: string | URL | Request): URL | null {
    try {
        if (typeof input === 'string') return new URL(input);
        if (input instanceof URL) return new URL(input.toString());
        const maybeUrl = (input as { url?: unknown }).url;
        if (typeof maybeUrl === 'string') return new URL(maybeUrl);
        return null;
    } catch {
        return null;
    }
}

function getProxyRouteState(hostname: string, now: number): ProxyRouteState {
    if (proxyRouteStateByHost.size > 128) {
        for (const [host, state] of proxyRouteStateByHost.entries()) {
            if (now - state.updatedAt > PROXY_ROUTE_STATE_TTL_MS) {
                proxyRouteStateByHost.delete(host);
            }
        }
    }
    const cached = proxyRouteStateByHost.get(hostname);
    if (cached && now - cached.updatedAt <= PROXY_ROUTE_STATE_TTL_MS) {
        return cached;
    }
    const initial: ProxyRouteState = {
        mode: 'proxy',
        updatedAt: now,
        nextProxyProbeAt: now,
    };
    proxyRouteStateByHost.set(hostname, initial);
    return initial;
}

function markHostDohPreferred(hostname: string, now: number, preferredIp?: string): void {
    const current = getProxyRouteState(hostname, now);
    const nextState: ProxyRouteState = {
        mode: 'doh',
        updatedAt: now,
        nextProxyProbeAt: now + PROXY_REPROBE_INTERVAL_MS,
        preferredDohIp: preferredIp || current.preferredDohIp,
    };
    proxyRouteStateByHost.set(hostname, nextState);
    if (current.mode !== 'doh') {
        console.warn(
            `[Proxy] Host ${hostname} switched to DoH fallback mode. Next proxy probe in ${
                Math.round(PROXY_REPROBE_INTERVAL_MS / 1000)
            }s.`
        );
    }
}

function markHostProxyPreferred(hostname: string, now: number): void {
    const current = getProxyRouteState(hostname, now);
    proxyRouteStateByHost.set(hostname, {
        mode: 'proxy',
        updatedAt: now,
        nextProxyProbeAt: now,
    });
    if (current.mode !== 'proxy') {
        console.error(`[Proxy] Host ${hostname} recovered via proxy route; exiting DoH fallback mode.`);
    }
}

function noteHostDohSuccess(hostname: string, now: number, ip?: string): void {
    const current = getProxyRouteState(hostname, now);
    proxyRouteStateByHost.set(hostname, {
        mode: 'doh',
        updatedAt: now,
        nextProxyProbeAt: current.nextProxyProbeAt,
        preferredDohIp: ip || current.preferredDohIp,
    });
}

function shouldPreferDohRoute(state: ProxyRouteState, now: number): boolean {
    return state.mode === 'doh' && now < state.nextProxyProbeAt;
}

function isLikelyReplayableBody(body: unknown): boolean {
    if (body === null || body === undefined) return true;
    if (typeof body === 'string') return true;
    if (body instanceof URLSearchParams) return true;
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) return true;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
    if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
    return false;
}

async function resolvePublicARecordsViaDoh(
    hostname: string,
    nodeFetch: (input: any, init?: any) => Promise<any>,
    agent: unknown
): Promise<string[]> {
    const now = Date.now();
    const cached = dohCache.get(hostname);
    if (cached && cached.expiresAt > now) {
        return cached.ips;
    }

    const response = await nodeFetch(
        `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
        {
            method: 'GET',
            agent,
            signal: AbortSignal.timeout(15000),
        }
    );

    if (!response?.ok) {
        return [];
    }

    const payload = await response.json() as { Answer?: Array<{ data?: string }> };
    const ips = (Array.isArray(payload.Answer) ? payload.Answer : [])
        .map((record) => (record?.data ?? '').trim())
        .filter((ip) => isIpv4Address(ip));

    dohCache.set(hostname, {
        ips,
        expiresAt: now + DOH_CACHE_TTL_MS,
    });
    return ips;
}

async function tryFetchViaDohFallback(
    requestUrl: URL,
    init: RequestInit,
    nodeFetch: (input: any, init?: any) => Promise<any>,
    agent: unknown,
    preferredIp?: string
): Promise<{ response: Response; ip: string } | null> {
    let fallbackIps: string[] = [];
    try {
        fallbackIps = await resolvePublicARecordsViaDoh(requestUrl.hostname, nodeFetch, agent);
    } catch {
        fallbackIps = [];
    }

    if (fallbackIps.length === 0) {
        return null;
    }

    const orderedIps = preferredIp && fallbackIps.includes(preferredIp)
        ? [preferredIp, ...fallbackIps.filter((ip) => ip !== preferredIp)]
        : fallbackIps;

    for (const ip of orderedIps) {
        try {
            const fallbackUrl = new URL(requestUrl.toString());
            fallbackUrl.hostname = ip;

            const headers = new Headers(init.headers);
            headers.set('host', requestUrl.hostname);

            const fallbackResponse = await nodeFetch(fallbackUrl.toString(), {
                ...(init as Record<string, unknown>),
                headers,
                servername: requestUrl.hostname,
            });

            return {
                response: await ensureWebReadableResponse(fallbackResponse),
                ip,
            };
        } catch {
            continue;
        }
    }

    return null;
}

async function ensureWebReadableResponse(rawResponse: any): Promise<Response> {
    if (!rawResponse) {
        throw new Error('empty_response_object');
    }

    const rawBody = rawResponse.body;
    const hasWebReader = rawBody && typeof rawBody.getReader === 'function';

    if (hasWebReader) {
        return rawResponse as Response;
    }

    const headers = new Headers();
    if (rawResponse.headers && typeof rawResponse.headers.forEach === 'function') {
        rawResponse.headers.forEach((value: string, key: string) => {
            headers.set(key, value);
        });
    }

    let body: unknown = null;
    if (!rawBody) {
        body = null;
    } else if (typeof rawBody.pipe === 'function') {
        if (nodeReadableToWeb === undefined) {
            try {
                const streamModule = await import('node:stream');
                nodeReadableToWeb = streamModule.Readable.toWeb.bind(streamModule.Readable) as (
                    stream: NodeJS.ReadableStream
                ) => ReadableStream<Uint8Array>;
            } catch {
                nodeReadableToWeb = null;
            }
        }

        if (nodeReadableToWeb) {
            body = nodeReadableToWeb(rawBody as NodeJS.ReadableStream);
        } else {
            body = await rawResponse.arrayBuffer();
        }
    } else {
        body = await rawResponse.arrayBuffer();
    }

    const responseBody = body as unknown as ReadableStream<Uint8Array> | ArrayBuffer | string | null;
    return new Response(responseBody, {
        status: Number(rawResponse.status) || 200,
        statusText: rawResponse.statusText || '',
        headers,
    });
}

async function createNodeProxyFetch(proxyUrl: string): Promise<typeof fetch | null> {
    // We intentionally allow this bridge in Bun as well.
    // Bun's env-proxy path can fail on specific domains (TLS handshake reset),
    // while node-fetch + https-proxy-agent supports our DoH IP fallback path.
    if (!canUseNodeProxyBridge()) {
        return null;
    }

    if (proxyFetchCache?.proxyUrl === proxyUrl) {
        return proxyFetchCache.fetchImpl;
    }

    try {
        const [{ default: nodeFetch }, { HttpsProxyAgent }] = await Promise.all([
            import('node-fetch'),
            import('https-proxy-agent'),
        ]);

        const agent = new HttpsProxyAgent(proxyUrl);
        const proxyFetch = (async (
            input: string | URL | Request,
            init?: RequestInit
        ): Promise<Response> => {
            const requestInit: RequestInit & Record<string, unknown> = {
                ...(init as Record<string, unknown>),
                agent,
            };
            const requestUrl = toUrl(input);
            const supportsDohFallback = Boolean(
                requestUrl
                && requestUrl.protocol === 'https:'
                && !isIpv4Address(requestUrl.hostname)
                && isLikelyReplayableBody(init?.body)
            );
            const routeState = supportsDohFallback && requestUrl
                ? getProxyRouteState(requestUrl.hostname, Date.now())
                : null;
            const preferDohRoute = Boolean(routeState && shouldPreferDohRoute(routeState, Date.now()));

            if (preferDohRoute && requestUrl && routeState) {
                const dohRouteResult = await tryFetchViaDohFallback(
                    requestUrl,
                    requestInit,
                    nodeFetch,
                    agent,
                    routeState.preferredDohIp
                );
                if (dohRouteResult) {
                    noteHostDohSuccess(requestUrl.hostname, Date.now(), dohRouteResult.ip);
                    return dohRouteResult.response;
                }
                console.warn(
                    `[Proxy] DoH-preferred route failed for ${requestUrl.hostname}; retrying proxy route.`
                );
            }

            try {
                const nodeFetchInput: string | URL =
                    input instanceof Request ? input.url : input;
                const response = await nodeFetch(nodeFetchInput, requestInit as never);
                if (routeState && requestUrl) {
                    markHostProxyPreferred(requestUrl.hostname, Date.now());
                }
                return await ensureWebReadableResponse(response);
            } catch (error) {
                if (!isTlsDisconnectError(error)) {
                    throw error;
                }
                if (!supportsDohFallback || !requestUrl) {
                    throw error;
                }

                console.warn(
                    `[Proxy] TLS handshake failed for ${requestUrl.hostname}. Trying DoH A-record fallback route.`
                );

                const fallbackResult = await tryFetchViaDohFallback(
                    requestUrl,
                    requestInit,
                    nodeFetch,
                    agent,
                    routeState?.preferredDohIp
                );
                if (fallbackResult) {
                    console.warn(
                        `[Proxy] Fallback TLS route succeeded for ${requestUrl.hostname} via ${fallbackResult.ip}.`
                    );
                    markHostDohPreferred(requestUrl.hostname, Date.now(), fallbackResult.ip);
                    return fallbackResult.response;
                }

                throw error;
            }
        }) as typeof fetch;

        proxyFetchCache = {
            proxyUrl,
            fetchImpl: proxyFetch,
        };

        if (proxyBridgeLogSignature !== proxyUrl) {
            proxyBridgeLogSignature = proxyUrl;
            console.error(
                `[Proxy] Using explicit Node proxy bridge for fetch: ${sanitizeProxyForLog(proxyUrl)}`
            );
        }

        return proxyFetch;
    } catch (error) {
        if (!proxyBridgeLoadFailed) {
            proxyBridgeLoadFailed = true;
            console.warn(
                `[Proxy] Failed to initialize explicit Node proxy bridge, fallback to global fetch: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
        return null;
    }
}

async function createNodeDirectFetchBridge(): Promise<typeof fetch | null> {
    if (!canUseNodeProxyBridge()) {
        return null;
    }
    if (directBridgeLoadAttempted) {
        return directFetchBridge;
    }
    directBridgeLoadAttempted = true;
    try {
        const { default: nodeFetch } = await import('node-fetch');
        const bridgeFetch = (async (
            input: string | URL | Request,
            init?: RequestInit
        ): Promise<Response> => {
            const nodeFetchInput: string | URL =
                input instanceof Request ? input.url : input;
            const response = await nodeFetch(nodeFetchInput, init as never);
            return ensureWebReadableResponse(response);
        }) as typeof fetch;
        directFetchBridge = bridgeFetch;
        console.error('[Network] Enabled direct Node fetch bridge for TLS DoH fallback.');
        return bridgeFetch;
    } catch (error) {
        if (!directBridgeLoadFailed) {
            directBridgeLoadFailed = true;
            console.warn(
                `[Network] Failed to initialize direct Node fetch bridge for TLS fallback: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
        directFetchBridge = null;
        return null;
    }
}

async function tryFetchWithDirectDohFallback(
    url: string,
    init: RequestInit,
    error: Error
): Promise<Response | null> {
    if (!isTlsDisconnectError(error)) {
        return null;
    }

    const requestUrl = toUrl(url);
    if (!requestUrl || requestUrl.protocol !== 'https:' || isIpv4Address(requestUrl.hostname)) {
        return null;
    }

    const proxyUrl = firstNonEmptyEnv(PROXY_ENV_KEYS);
    if (proxyUrl && !shouldBypassProxy(url)) {
        return null;
    }

    const directFetch = await createNodeDirectFetchBridge();
    if (!directFetch) {
        return null;
    }

    const fallbackResult = await tryFetchViaDohFallback(
        requestUrl,
        init,
        directFetch,
        undefined
    );

    if (!fallbackResult) {
        return null;
    }

    const now = Date.now();
    noteHostDohSuccess(requestUrl.hostname, now, fallbackResult.ip);
    console.warn(
        `[Network] TLS failed for ${requestUrl.hostname}; recovered via direct DoH fallback (${fallbackResult.ip}).`
    );
    return fallbackResult.response;
}

async function fetchWithProxySupport(url: string, init: RequestInit): Promise<Response> {
    const proxyUrl = firstNonEmptyEnv(PROXY_ENV_KEYS);
    if (!proxyUrl || shouldBypassProxy(url)) {
        return fetch(url, init);
    }

    const proxyFetch = await createNodeProxyFetch(proxyUrl);
    if (!proxyFetch) {
        return fetch(url, init);
    }

    return proxyFetch(url, init);
}

// ============================================================================
// Main function
// ============================================================================

export async function fetchWithBackoff(
    url: string,
    options: RequestInit,
    opts: FetchWithBackoffOptions = {}
): Promise<Response> {
    const {
        timeout = 60000,
        maxRetries = 5,
        baseDelay = 1000,
        maxDelay = 30000,
        retryOnStatus = RETRYABLE_STATUS_CODES,
        onRetry,
        allowInsecureTls = false,
    } = opts;

    let lastError: Error | null = null;
    let lastResponse: Response | null = null;
    const retryTarget = (() => {
        try {
            return new URL(url).host;
        } catch {
            return url;
        }
    })();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let requestInitForAttempt: RequestInit | null = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const requestInit = applyInsecureTlsToRequestInit({
                ...options,
                signal: controller.signal,
            }, allowInsecureTls);
            requestInitForAttempt = requestInit;
            const response = await fetchWithProxySupport(url, requestInit);

            clearTimeout(timeoutId);

            // Success or non-retryable status
            if (response.ok || !retryOnStatus.includes(response.status)) {
                return response;
            }

            // Retryable status code
            lastResponse = response;

            if (attempt >= maxRetries) {
                // Max retries exhausted — return the last response (let caller handle)
                return response;
            }

            // Calculate delay
            const retryAfterHeader = response.headers.get('Retry-After');
            let retryAfterMs: number | null = null;

            if (retryAfterHeader) {
                const seconds = parseInt(retryAfterHeader, 10);
                if (!isNaN(seconds)) {
                    retryAfterMs = seconds * 1000;
                } else {
                    // HTTP-date format
                    const date = new Date(retryAfterHeader);
                    if (!isNaN(date.getTime())) {
                        retryAfterMs = Math.max(0, date.getTime() - Date.now());
                    }
                }
            }

            const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
            const delay = retryAfterMs !== null
                ? Math.min(retryAfterMs, maxDelay)
                : exponentialDelay;

            const retryInfo: RetryInfo = {
                attempt: attempt + 1,
                maxRetries,
                status: response.status,
                delay,
                retryAfter: retryAfterMs,
            };

            console.warn(
                `[Retry] HTTP ${response.status} on attempt ${attempt + 1}/${maxRetries + 1} (${retryTarget}). ` +
                `Retrying in ${Math.round(delay / 1000)}s` +
                (retryAfterMs !== null ? ` (Retry-After: ${retryAfterHeader})` : ' (exponential backoff)')
            );

            if (onRetry) {
                onRetry(retryInfo);
            }

            await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const msg = lastError.message;

            if (requestInitForAttempt) {
                try {
                    const dohRecoveredResponse = await tryFetchWithDirectDohFallback(
                        url,
                        requestInitForAttempt,
                        lastError
                    );
                    if (dohRecoveredResponse) {
                        return dohRecoveredResponse;
                    }
                } catch (fallbackError) {
                    const fallbackMessage =
                        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                    console.warn(
                        `[Network] Direct DoH fallback attempt failed for ${retryTarget}: ${fallbackMessage}`
                    );
                }
            }

            // Don't retry on certain errors
            if (NON_RETRYABLE_ERRORS.some(e => msg.includes(e))) {
                throw lastError;
            }

            // Abort = timeout
            if (msg.includes('abort') || msg.includes('AbortError')) {
                if (attempt >= maxRetries) {
                    throw new Error(`Request timed out after ${maxRetries + 1} attempts (${timeout}ms each)`);
                }
                console.warn(`[Retry] Timeout on attempt ${attempt + 1}/${maxRetries + 1} (${retryTarget}), retrying...`);
            } else if (attempt >= maxRetries) {
                throw lastError;
            } else {
                const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
                console.warn(
                    `[Retry] Network error on attempt ${attempt + 1} (${retryTarget}): ${msg}${formatErrorDetails(lastError)}. ` +
                    `Retrying in ${delay}ms...`
                );
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // Should not reach here, but just in case
    if (lastResponse) return lastResponse;
    throw lastError ?? new Error('fetchWithBackoff exhausted retries');
}
