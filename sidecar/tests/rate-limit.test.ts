/**
 * Rate Limit & Exponential Backoff — Unit Tests
 *
 * Verifies:
 *   1. fetchWithBackoff retries on 429/5xx status codes
 *   2. True exponential backoff timing (baseDelay * 2^attempt)
 *   3. Retry-After header is respected
 *   4. Non-retryable errors are thrown immediately
 *   5. onRetry callback is invoked with correct info
 *   6. Max retries is enforced
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { fetchWithBackoff, type RetryInfo } from '../src/utils/retryWithBackoff';

// ============================================================================
// Mock fetch helper
// ============================================================================

function createMockFetch(responses: Array<{ status: number; body?: string; headers?: Record<string, string> } | Error>) {
    let callIndex = 0;

    return function mockFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
        const item = responses[callIndex++] ?? responses[responses.length - 1];

        if (item instanceof Error) {
            return Promise.reject(item);
        }

        const headers = new Headers(item.headers ?? {});
        return Promise.resolve(new Response(item.body ?? '', {
            status: item.status,
            headers,
        }));
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('fetchWithBackoff', () => {

    test('returns immediately on 200 OK', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = createMockFetch([{ status: 200, body: 'ok' }]) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 3,
                baseDelay: 100,
            });
            expect(res.status).toBe(200);
            expect(await res.text()).toBe('ok');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('retries on 429 and eventually succeeds', async () => {
        const originalFetch = globalThis.fetch;
        let callCount = 0;
        globalThis.fetch = ((...args: any[]) => {
            callCount++;
            if (callCount <= 2) {
                return Promise.resolve(new Response('rate limited', { status: 429 }));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
        }) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 5,
                baseDelay: 10, // very short for test speed
            });
            expect(res.status).toBe(200);
            expect(callCount).toBe(3); // 2 retries + 1 success
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('retries on 500/502/503', async () => {
        const originalFetch = globalThis.fetch;
        const statuses = [500, 502, 503, 200];
        let idx = 0;
        globalThis.fetch = (() => {
            const status = statuses[idx++] ?? 200;
            return Promise.resolve(new Response('', { status }));
        }) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 5,
                baseDelay: 10,
            });
            expect(res.status).toBe(200);
            expect(idx).toBe(4);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('returns non-retryable status codes immediately (e.g. 401)', async () => {
        const originalFetch = globalThis.fetch;
        let callCount = 0;
        globalThis.fetch = (() => {
            callCount++;
            return Promise.resolve(new Response('unauthorized', { status: 401 }));
        }) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 3,
                baseDelay: 10,
            });
            expect(res.status).toBe(401);
            expect(callCount).toBe(1); // No retries
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('respects Retry-After header (seconds)', async () => {
        const originalFetch = globalThis.fetch;
        const start = Date.now();
        let callCount = 0;

        globalThis.fetch = (() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve(new Response('', {
                    status: 429,
                    headers: { 'Retry-After': '1' }, // 1 second
                }));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
        }) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 3,
                baseDelay: 10, // Would normally be 10ms, but Retry-After overrides to 1000ms
            });
            const elapsed = Date.now() - start;
            expect(res.status).toBe(200);
            expect(elapsed).toBeGreaterThan(800); // Should wait ~1s due to Retry-After
            expect(callCount).toBe(2);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('onRetry callback is invoked with correct info', async () => {
        const originalFetch = globalThis.fetch;
        const retryInfos: RetryInfo[] = [];
        let callCount = 0;

        globalThis.fetch = (() => {
            callCount++;
            if (callCount <= 2) {
                return Promise.resolve(new Response('', { status: 429 }));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
        }) as any;

        try {
            await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 5,
                baseDelay: 10,
                onRetry: (info) => retryInfos.push(info),
            });

            expect(retryInfos.length).toBe(2);
            expect(retryInfos[0].attempt).toBe(1);
            expect(retryInfos[0].status).toBe(429);
            expect(retryInfos[0].maxRetries).toBe(5);
            expect(retryInfos[1].attempt).toBe(2);
            // Verify exponential backoff: delay for attempt 1 should be ~ baseDelay*2^1
            expect(retryInfos[1].delay).toBeGreaterThan(retryInfos[0].delay);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('gives up after maxRetries exhausted', async () => {
        const originalFetch = globalThis.fetch;
        let callCount = 0;

        globalThis.fetch = (() => {
            callCount++;
            return Promise.resolve(new Response('rate limited', { status: 429 }));
        }) as any;

        try {
            const res = await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 2,
                baseDelay: 10,
            });
            // After max retries, returns the last response
            expect(res.status).toBe(429);
            expect(callCount).toBe(3); // initial + 2 retries
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('throws on non-retryable errors (missing_api_key)', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => {
            return Promise.reject(new Error('missing_api_key: No API key configured'));
        }) as any;

        try {
            await expect(
                fetchWithBackoff('https://api.example.com/test', {}, {
                    maxRetries: 3,
                    baseDelay: 10,
                })
            ).rejects.toThrow('missing_api_key');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('exponential backoff delays increase correctly', async () => {
        const originalFetch = globalThis.fetch;
        const delays: number[] = [];
        let callCount = 0;

        globalThis.fetch = (() => {
            callCount++;
            if (callCount <= 4) {
                return Promise.resolve(new Response('', { status: 429 }));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
        }) as any;

        try {
            await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 5,
                baseDelay: 100,
                maxDelay: 10000,
                onRetry: (info) => delays.push(info.delay),
            });

            // Delays should be: 100, 200, 400, 800 (baseDelay * 2^attempt)
            expect(delays.length).toBe(4);
            expect(delays[0]).toBe(100);  // 100 * 2^0
            expect(delays[1]).toBe(200);  // 100 * 2^1
            expect(delays[2]).toBe(400);  // 100 * 2^2
            expect(delays[3]).toBe(800);  // 100 * 2^3
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('maxDelay caps the backoff', async () => {
        const originalFetch = globalThis.fetch;
        const delays: number[] = [];
        let callCount = 0;

        globalThis.fetch = (() => {
            callCount++;
            if (callCount <= 5) {
                return Promise.resolve(new Response('', { status: 429 }));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
        }) as any;

        try {
            await fetchWithBackoff('https://api.example.com/test', {}, {
                maxRetries: 6,
                baseDelay: 100,
                maxDelay: 500, // Cap at 500ms
                onRetry: (info) => delays.push(info.delay),
            });

            // After 100, 200, 400, all further should be capped at 500
            expect(delays[0]).toBe(100);
            expect(delays[1]).toBe(200);
            expect(delays[2]).toBe(400);
            expect(delays[3]).toBe(500); // Capped (would be 800)
            expect(delays[4]).toBe(500); // Capped (would be 1600)
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
