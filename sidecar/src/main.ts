/**
 * Sidecar runtime bootstrap.
 *
 * Single runtime path: always start Mastra entrypoint.
 */
export {};
import { ensureProxyEnvForLlmPath } from './mastra/proxyRuntime';
process.env.COWORKANY_RUNTIME_MODE = 'mastra';
await ensureProxyEnvForLlmPath();
if (process.env.COWORKANY_PROXY_DEBUG === '1') {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
        const [input, init] = args;
        const inputUrl = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        const nextInit = {
            ...(init ?? {}),
            verbose: true,
        } as RequestInit & {
            verbose: boolean;
            proxy?: unknown;
            dispatcher?: unknown;
        };
        const shouldDebugRequest = /aiberm\.com|openai\.com|chat\/completions/i.test(inputUrl);
        if (shouldDebugRequest) {
            console.info('[coworkany-fetch-debug:request]', {
                url: inputUrl,
                method: nextInit.method ?? null,
                hasProxyInit: Object.prototype.hasOwnProperty.call(nextInit, 'proxy'),
                proxyInit: nextInit.proxy ?? null,
                hasDispatcher: Object.prototype.hasOwnProperty.call(nextInit, 'dispatcher'),
                dispatcherType: nextInit.dispatcher && typeof nextInit.dispatcher === 'object'
                    ? (
                        (nextInit.dispatcher as { constructor?: { name?: string } }).constructor?.name
                        ?? 'object'
                    )
                    : typeof nextInit.dispatcher,
                proxyEnv: {
                    configured: process.env.COWORKANY_INTERNAL_UPSTREAM_URL ?? null,
                    transport: process.env.COWORKANY_PROXY_TRANSPORT_URL ?? null,
                    active: process.env.COWORKANY_PROXY_URL ?? null,
                    httpsProxy: process.env.HTTPS_PROXY ?? null,
                    allProxy: process.env.ALL_PROXY ?? null,
                },
            });
        }
        return nativeFetch(input, nextInit).catch((error) => {
            if (shouldDebugRequest) {
                console.info('[coworkany-fetch-debug:error]', {
                    url: inputUrl,
                    error: error instanceof Error ? error.message : String(error),
                    name: error instanceof Error ? error.name : null,
                    cause: (
                        error
                        && typeof error === 'object'
                        && 'cause' in error
                    )
                        ? (error as { cause?: unknown }).cause ?? null
                        : null,
                });
            }
            throw error;
        });
    }) as typeof globalThis.fetch;
}
await import('./main-mastra');
