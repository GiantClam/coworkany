import { afterEach, describe, expect, test } from 'bun:test';
import { applyProxySettingsToProcessEnv } from '../src/utils/proxy';

const MANAGED_ENV_KEYS = [
    'COWORKANY_PROXY_URL',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GLOBAL_AGENT_HTTPS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY',
    'COWORKANY_PROXY_SOURCE',
    'NODE_USE_ENV_PROXY',
    'NO_PROXY',
    'no_proxy',
] as const;

const originalEnv = Object.fromEntries(
    MANAGED_ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
    applyProxySettingsToProcessEnv(undefined);

    for (const key of MANAGED_ENV_KEYS) {
        const originalValue = originalEnv[key];
        if (originalValue === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalValue;
        }
    }
});

describe('applyProxySettingsToProcessEnv', () => {
    test('applies proxy settings from llm-config into process env', () => {
        applyProxySettingsToProcessEnv({
            enabled: true,
            url: 'http://127.0.0.1:7890',
            bypass: 'localhost,127.0.0.1,::1,.local',
        });

        expect(process.env.COWORKANY_PROXY_URL).toBe('http://127.0.0.1:7890');
        expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.http_proxy).toBe('http://127.0.0.1:7890');
        expect(process.env.GLOBAL_AGENT_HTTPS_PROXY).toBe('http://127.0.0.1:7890');
        expect(process.env.COWORKANY_PROXY_SOURCE).toBe('config');
        expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
        expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1,::1,.local');
        expect(process.env.no_proxy).toBe('localhost,127.0.0.1,::1,.local');
    });

    test('clears config-managed proxy overrides when proxy is disabled', () => {
        applyProxySettingsToProcessEnv({
            enabled: true,
            url: 'http://127.0.0.1:7890',
        });

        applyProxySettingsToProcessEnv({
            enabled: false,
        });

        expect(process.env.COWORKANY_PROXY_URL).toBeUndefined();
        expect(process.env.HTTPS_PROXY).toBeUndefined();
        expect(process.env.http_proxy).toBeUndefined();
        expect(process.env.ALL_PROXY).toBeUndefined();
        expect(process.env.GLOBAL_AGENT_HTTPS_PROXY).toBeUndefined();
        expect(process.env.COWORKANY_PROXY_SOURCE).toBeUndefined();
    });
});
