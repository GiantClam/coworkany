import { describe, expect, test } from 'bun:test';
import {
    buildProviderPreflightCurl,
    formatProviderPreflightFailure,
    resolvePreflightProxyUrl,
} from '../scripts/run-core-full-regression.mjs';

describe('core/full provider network preflight', () => {
    test('uses a real OpenAI-compatible chat completion probe through proxy', () => {
        const probe = buildProviderPreflightCurl({
            baseUrl: 'https://aiberm.com/v1',
            apiKey: 'secret-api-key',
            model: 'openai/gpt-5.3-codex',
        }, 'http://127.0.0.1:7890');

        expect(probe.args).toEqual(['--config', '-']);
        expect(JSON.stringify(probe.args)).not.toContain('secret-api-key');
        expect(probe.probe).toBe('chat.completions');
        expect(probe.input).toContain('url = "https://aiberm.com/v1/chat/completions"');
        expect(probe.input).toContain('request = "POST"');
        expect(probe.input).toContain('proxy = "http://127.0.0.1:7890"');
        expect(probe.input).toContain('\\"model\\":\\"gpt-5.3-codex\\"');
        expect(probe.input).not.toContain('url = "https://aiberm.com/v1"\n');
    });

    test('does not blame local fake-IP DNS when HTTP proxy CONNECT is configured', () => {
        const message = formatProviderPreflightFailure({
            baseUrl: 'https://aiberm.com/v1',
            proxyUrl: 'http://127.0.0.1:7890',
            addresses: ['198.18.0.105'],
            probe: 'chat.completions',
            detail: 'HTTP 502',
            status: 0,
        });

        expect(message).toContain('via http://127.0.0.1:7890');
        expect(message).toContain('local reserved/private DNS observed (198.18.0.105) but HTTP proxy CONNECT uses the hostname');
        expect(message).not.toContain('check proxy fake-IP/DNS routing');
    });

    test('keeps reserved DNS as a direct-connection hint when no proxy is configured', () => {
        const message = formatProviderPreflightFailure({
            baseUrl: 'https://aiberm.com/v1',
            proxyUrl: '',
            addresses: ['198.18.0.105'],
            probe: 'chat.completions',
            detail: 'TLS failed',
            status: 35,
        });

        expect(message).toContain('reserved/private resolution detected (198.18.0.105) - check local DNS/fake-IP routing');
    });

    test('honors standard proxy env aliases when selecting the live preflight proxy', () => {
        expect(resolvePreflightProxyUrl({
            COWORKANY_PROXY_URL: '',
            HTTPS_PROXY: '',
            ALL_PROXY: 'http://127.0.0.1:7890',
        })).toBe('http://127.0.0.1:7890');
        expect(resolvePreflightProxyUrl({
            https_proxy: 'http://127.0.0.1:7891',
        })).toBe('http://127.0.0.1:7891');
    });
});
