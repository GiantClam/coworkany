import { applyInsecureTlsToRequestInit } from './tls';

export interface FetchWithBackoffOptions {
    timeout?: number;
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    retryOnStatus?: number[];
    onRetry?: (info: RetryInfo) => void;
    allowInsecureTls?: boolean;
}

export interface RetryInfo {
    attempt: number;
    maxRetries: number;
    status: number;
    delay: number;
    retryAfter: number | null;
}

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503];
const NON_RETRYABLE_ERROR_MARKERS = ['missing_api_key', 'missing_base_url', 'invalid_api_key'];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
    if (!retryAfterHeader) {
        return null;
    }

    const asSeconds = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(asSeconds)) {
        return Math.max(0, asSeconds * 1000);
    }

    const asDate = new Date(retryAfterHeader);
    if (!Number.isNaN(asDate.getTime())) {
        return Math.max(0, asDate.getTime() - Date.now());
    }

    return null;
}

function calculateDelayMs(attemptIndex: number, baseDelay: number, maxDelay: number, retryAfterMs: number | null): number {
    const exponentialDelay = Math.min(baseDelay * (2 ** attemptIndex), maxDelay);
    if (retryAfterMs === null) {
        return exponentialDelay;
    }
    return Math.min(retryAfterMs, maxDelay);
}

function isNonRetryableError(error: Error): boolean {
    return NON_RETRYABLE_ERROR_MARKERS.some((marker) => error.message.includes(marker));
}

function isAbortError(error: Error): boolean {
    const message = `${error.name}:${error.message}`.toLowerCase();
    return message.includes('abort') || message.includes('timeout');
}

export async function fetchWithBackoff(
    url: string,
    options: RequestInit,
    opts: FetchWithBackoffOptions = {},
): Promise<Response> {
    const {
        timeout = 60_000,
        maxRetries = 5,
        baseDelay = 1_000,
        maxDelay = 30_000,
        retryOnStatus = RETRYABLE_STATUS_CODES,
        onRetry,
        allowInsecureTls = false,
    } = opts;

    let lastResponse: Response | null = null;
    let lastError: Error | null = null;
    const maxAttempts = maxRetries + 1;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const requestInit = applyInsecureTlsToRequestInit(
                { ...options, signal: controller.signal },
                allowInsecureTls,
            );

            const response = await fetch(url, requestInit);
            clearTimeout(timeoutId);

            if (response.ok || !retryOnStatus.includes(response.status)) {
                return response;
            }

            lastResponse = response;
            if (attemptIndex >= maxRetries) {
                return response;
            }

            const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
            const delayMs = calculateDelayMs(attemptIndex, baseDelay, maxDelay, retryAfterMs);
            onRetry?.({
                attempt: attemptIndex + 1,
                maxRetries,
                status: response.status,
                delay: delayMs,
                retryAfter: retryAfterMs,
            });
            await sleep(delayMs);
        } catch (unknownError) {
            clearTimeout(timeoutId);
            const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
            lastError = error;

            if (isNonRetryableError(error)) {
                throw error;
            }

            if (attemptIndex >= maxRetries) {
                if (isAbortError(error)) {
                    throw new Error(`Request timed out after ${maxAttempts} attempts (${timeout}ms each)`);
                }
                throw error;
            }

            const delayMs = calculateDelayMs(attemptIndex, baseDelay, maxDelay, null);
            onRetry?.({
                attempt: attemptIndex + 1,
                maxRetries,
                status: 0,
                delay: delayMs,
                retryAfter: null,
            });
            await sleep(delayMs);
        }
    }

    if (lastResponse !== null) {
        return lastResponse;
    }
    throw lastError ?? new Error('fetchWithBackoff exhausted retries');
}
