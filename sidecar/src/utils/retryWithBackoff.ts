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
    } = opts;

    let lastError: Error | null = null;
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });

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
                `[Retry] HTTP ${response.status} on attempt ${attempt + 1}/${maxRetries + 1}. ` +
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

            // Don't retry on certain errors
            if (NON_RETRYABLE_ERRORS.some(e => msg.includes(e))) {
                throw lastError;
            }

            // Abort = timeout
            if (msg.includes('abort') || msg.includes('AbortError')) {
                if (attempt >= maxRetries) {
                    throw new Error(`Request timed out after ${maxRetries + 1} attempts (${timeout}ms each)`);
                }
                console.warn(`[Retry] Timeout on attempt ${attempt + 1}/${maxRetries + 1}, retrying...`);
            } else if (attempt >= maxRetries) {
                throw lastError;
            } else {
                const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
                console.warn(`[Retry] Network error on attempt ${attempt + 1}: ${msg}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // Should not reach here, but just in case
    if (lastResponse) return lastResponse;
    throw lastError ?? new Error('fetchWithBackoff exhausted retries');
}
