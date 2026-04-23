import { afterEach, describe, expect, test } from 'bun:test';
import { ensureProxyEnvForLlmPath } from '../src/mastra/proxyRuntime';

const MANAGED_KEYS = [
    'COWORKANY_INTERNAL_UPSTREAM_URL',
    'COWORKANY_PROXY_CONFIGURED_URL',
    'COWORKANY_PROXY_TRANSPORT_URL',
    'COWORKANY_PROXY_URL',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
    'NODE_USE_ENV_PROXY',
] as const;

const originalEnv = Object.fromEntries(
    MANAGED_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
    for (const key of MANAGED_KEYS) {
        const original = originalEnv[key];
        if (typeof original === 'string') {
            process.env[key] = original;
        } else {
            delete process.env[key];
        }
    }
});

describe('ensureProxyEnvForLlmPath', () => {
    test('normalizes transport env for http proxy', async () => {
        process.env.COWORKANY_PROXY_URL = 'http://127.0.0.1:7890';
        delete process.env.HTTPS_PROXY;
        delete process.env.HTTP_PROXY;
        delete process.env.ALL_PROXY;
        delete process.env.GLOBAL_AGENT_HTTPS_PROXY;
        delete process.env.GLOBAL_AGENT_HTTP_PROXY;
        process.env.NODE_USE_ENV_PROXY = '0';

        await ensureProxyEnvForLlmPath(process.env);

        expect(process.env.COWORKANY_PROXY_URL).toBe('http://127.0.0.1:7890');
        expect(process.env.COWORKANY_INTERNAL_UPSTREAM_URL).toBe('http://127.0.0.1:7890');
        expect(process.env.COWORKANY_PROXY_CONFIGURED_URL).toBeUndefined();
        expect(process.env.COWORKANY_PROXY_TRANSPORT_URL).toBe('http://127.0.0.1:7890');
        expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.ALL_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.GLOBAL_AGENT_HTTPS_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.GLOBAL_AGENT_HTTP_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
    });

    test('keeps socks endpoint for metrics and maps transport env to local http bridge', async () => {
        process.env.COWORKANY_PROXY_URL = 'socks5://127.0.0.1:1080';
        delete process.env.HTTPS_PROXY;
        delete process.env.HTTP_PROXY;
        delete process.env.ALL_PROXY;
        delete process.env.GLOBAL_AGENT_HTTPS_PROXY;
        delete process.env.GLOBAL_AGENT_HTTP_PROXY;
        process.env.NODE_USE_ENV_PROXY = '0';

        await ensureProxyEnvForLlmPath(process.env);

        expect(process.env.COWORKANY_INTERNAL_UPSTREAM_URL).toBe('socks5://127.0.0.1:1080');
        expect(process.env.COWORKANY_PROXY_CONFIGURED_URL).toBeUndefined();
        expect(process.env.COWORKANY_PROXY_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(process.env.COWORKANY_PROXY_TRANSPORT_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(process.env.COWORKANY_PROXY_URL).toBe(process.env.COWORKANY_PROXY_TRANSPORT_URL);
        expect(process.env.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(process.env.HTTP_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(process.env.ALL_PROXY).toBe(process.env.HTTPS_PROXY);
        expect(process.env.GLOBAL_AGENT_HTTPS_PROXY).toBe(process.env.HTTPS_PROXY);
        expect(process.env.GLOBAL_AGENT_HTTP_PROXY).toBe(process.env.HTTPS_PROXY);
        expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
    });
});
