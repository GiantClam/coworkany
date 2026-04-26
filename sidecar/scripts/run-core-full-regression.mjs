#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { lookup } from 'dns/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sidecarDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(sidecarDir, '..');
const desktopDir = path.join(repoRoot, 'desktop');
const args = new Set(process.argv.slice(2));

const strictLive = args.has('--strict-live') || process.env.COWORKANY_REQUIRE_LIVE_REGRESSION === '1';
const skipLiveModel = args.has('--skip-live-model');
const skipDesktopUi = args.has('--skip-desktop-ui');
const skipNetworkPreflight = args.has('--skip-network-preflight');

function runStep(label, options) {
    const startedAt = Date.now();
    console.log(`\n=== ${label} ===`);
    const result = spawnSync(options.cmd, options.args, {
        cwd: options.cwd,
        env: {
            ...process.env,
            ...(options.env ?? {}),
        },
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (result.status !== 0) {
        throw new Error(`${label} failed after ${duration}s with exit code ${result.status ?? 'unknown'}`);
    }
    console.log(`=== ${label} passed (${duration}s) ===`);
}

function hasNpx() {
    const result = spawnSync('npx', ['--version'], {
        cwd: repoRoot,
        stdio: 'ignore',
        shell: process.platform === 'win32',
    });
    return result.status === 0;
}

function hasDesktopProject() {
    return fs.existsSync(path.join(desktopDir, 'package.json'))
        && fs.existsSync(path.join(desktopDir, 'playwright.config.ts'));
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function getString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeProviderBaseUrl(baseUrl) {
    return getString(baseUrl)
        .replace(/\/chat\/completions\/?$/u, '')
        .replace(/\/+$/u, '');
}

function normalizeProbeModel(model) {
    const normalized = getString(model) || 'gpt-5.3-codex';
    const delimiter = normalized.indexOf('/');
    return delimiter >= 0 ? normalized.slice(delimiter + 1) : normalized;
}

function pickProviderSection(config, profile, key) {
    if (profile?.[key] && typeof profile[key] === 'object') {
        return profile[key];
    }
    if (config?.[key] && typeof config[key] === 'object') {
        return config[key];
    }
    return {};
}

function resolveActiveProfile(config) {
    const profiles = Array.isArray(config?.profiles) ? config.profiles.filter((profile) => profile && typeof profile === 'object') : [];
    if (profiles.length === 0) {
        return null;
    }
    const activeProfileId = getString(config.activeProfileId);
    if (activeProfileId) {
        const active = profiles.find((profile) => getString(profile?.id) === activeProfileId);
        if (active) {
            return active;
        }
    }
    return profiles.find((profile) => profile?.verified === true) ?? profiles[0] ?? null;
}

function providerFromConfig(config) {
    const activeProfile = resolveActiveProfile(config);
    const provider = getString(activeProfile?.provider || config?.provider).toLowerCase();
    const openai = pickProviderSection(config, activeProfile, 'openai');
    const custom = pickProviderSection(config, activeProfile, 'custom');
    const aiberm = pickProviderSection(config, activeProfile, 'aiberm');
    const sections = provider === 'custom'
        ? [custom, openai, aiberm]
        : [openai, aiberm, custom];
    for (const section of sections) {
        const baseUrl = normalizeProviderBaseUrl(section?.baseUrl ?? section?.baseURL);
        if (!baseUrl) {
            continue;
        }
        return {
            provider: provider || (baseUrl.includes('aiberm.com') ? 'aiberm' : 'openai'),
            baseUrl,
            apiKey: getString(section?.apiKey),
            model: getString(section?.model),
        };
    }
    return null;
}

function findConfiguredProvider() {
    const candidates = [
        path.join(sidecarDir, 'llm-config.json'),
        path.join(os.homedir(), 'Library', 'Application Support', 'com.coworkany.desktop', 'llm-config.json'),
    ];
    for (const configPath of candidates) {
        const config = readJsonIfExists(configPath);
        if (!config || typeof config !== 'object') {
            continue;
        }
        const provider = providerFromConfig(config);
        if (provider) {
            return {
                ...provider,
                source: configPath,
            };
        }
    }
    return null;
}

function resolveMacOsSystemProxyUrl() {
    if (process.platform !== 'darwin') {
        return '';
    }
    const result = spawnSync('scutil', ['--proxy'], {
        cwd: repoRoot,
        encoding: 'utf-8',
    });
    if (result.status !== 0 || !result.stdout) {
        return '';
    }
    const readValue = (name) => {
        const match = result.stdout.match(new RegExp(`${name}\\\\s*:\\\\s*([^\\n]+)`));
        return match?.[1]?.trim() ?? '';
    };
    const httpsEnabled = readValue('HTTPSEnable') === '1';
    const httpEnabled = readValue('HTTPEnable') === '1';
    const host = httpsEnabled ? readValue('HTTPSProxy') : httpEnabled ? readValue('HTTPProxy') : '';
    const port = httpsEnabled ? readValue('HTTPSPort') : httpEnabled ? readValue('HTTPPort') : '';
    if (!host || !port) {
        return '';
    }
    return `http://${host}:${port}`;
}

function buildLiveEnv(extra = {}) {
    const env = { ...extra };
    const explicitProxy = resolvePreflightProxyUrl(env) || resolvePreflightProxyUrl(process.env);
    if (explicitProxy) {
        env.COWORKANY_PROXY_URL = explicitProxy;
        env.HTTPS_PROXY = explicitProxy;
        env.HTTP_PROXY = explicitProxy;
        env.ALL_PROXY = explicitProxy;
        env.COWORKANY_PROXY_SOURCE = env.COWORKANY_PROXY_SOURCE || process.env.COWORKANY_PROXY_SOURCE || 'env';
        return env;
    }

    const systemProxy = resolveMacOsSystemProxyUrl();
    if (systemProxy) {
        env.COWORKANY_PROXY_URL = systemProxy;
        env.HTTPS_PROXY = systemProxy;
        env.HTTP_PROXY = systemProxy;
        env.ALL_PROXY = systemProxy;
        env.COWORKANY_PROXY_SOURCE = 'macos_system_proxy';
        console.log(`[core-full-regression] Using macOS system proxy for live checks: ${systemProxy}`);
    }
    return env;
}

export function resolvePreflightProxyUrl(env) {
    return getString(env?.COWORKANY_PROXY_URL)
        || getString(env?.HTTPS_PROXY)
        || getString(env?.https_proxy)
        || getString(env?.HTTP_PROXY)
        || getString(env?.http_proxy)
        || getString(env?.ALL_PROXY)
        || getString(env?.all_proxy);
}

function isReservedProviderAddress(address) {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
        return address === '::1' || address.toLowerCase().startsWith('fe80:');
    }
    const [a, b] = parts;
    return a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19));
}

async function resolveProviderAddresses(baseUrl) {
    try {
        const hostname = new URL(baseUrl).hostname;
        if (!hostname) {
            return [];
        }
        return (await lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
        return [];
    }
}

function curlConfigQuote(value) {
    return String(value)
        .replace(/\\/gu, '\\\\')
        .replace(/"/gu, '\\"')
        .replace(/\r/gu, '\\r')
        .replace(/\n/gu, '\\n');
}

export function buildProviderPreflightCurl(provider, proxyUrl) {
    const baseUrl = normalizeProviderBaseUrl(provider?.baseUrl);
    if (!baseUrl) {
        throw new Error('Provider baseURL is required for network preflight.');
    }

    const args = ['--config', '-'];
    const lines = [
        'silent',
        'show-error',
        'insecure',
        'location',
        'connect-timeout = 15',
        'max-time = 90',
        'retry = 1',
        'retry-delay = 1',
        'output = "/dev/null"',
        'write-out = "%{http_code}"',
    ];
    const apiKey = getString(provider?.apiKey);
    if (proxyUrl) {
        lines.push(`proxy = "${curlConfigQuote(proxyUrl)}"`);
    }
    if (apiKey) {
        const chatCompletionsUrl = `${baseUrl}/chat/completions`;
        const payload = JSON.stringify({
            model: normalizeProbeModel(provider?.model),
            messages: [
                {
                    role: 'user',
                    content: 'ping',
                },
            ],
            max_tokens: 8,
        });
        lines.push(
            `url = "${curlConfigQuote(chatCompletionsUrl)}"`,
            'request = "POST"',
            'header = "Content-Type: application/json"',
            `header = "Authorization: Bearer ${curlConfigQuote(apiKey)}"`,
            `data = "${curlConfigQuote(payload)}"`,
        );
    } else {
        lines.push(`url = "${curlConfigQuote(baseUrl)}"`);
    }
    return {
        args,
        input: `${lines.join('\n')}\n`,
        probe: apiKey ? 'chat.completions' : 'base-url',
    };
}

export function formatProviderPreflightFailure(input) {
    const addressDetail = input.addresses.length ? `; local-dns=${input.addresses.join(',')}` : '';
    const reservedAddresses = input.addresses.filter(isReservedProviderAddress);
    const reservedHint = reservedAddresses.length
        ? input.proxyUrl
            ? `; local reserved/private DNS observed (${reservedAddresses.join(',')}) but HTTP proxy CONNECT uses the hostname`
            : `; reserved/private resolution detected (${reservedAddresses.join(',')}) - check local DNS/fake-IP routing`
        : '';
    return `Provider network preflight failed for ${input.baseUrl}${input.proxyUrl ? ` via ${input.proxyUrl}` : ''}; probe=${input.probe}${addressDetail}${reservedHint}: ${input.detail || `curl exit ${input.status ?? 'unknown'}`}`;
}

async function runNetworkPreflight(env) {
    if (skipNetworkPreflight) {
        return;
    }
    const provider = findConfiguredProvider();
    if (!provider?.baseUrl) {
        console.log('[core-full-regression] No provider baseURL found for network preflight.');
        return;
    }
    const baseUrl = provider.baseUrl;
    const addresses = await resolveProviderAddresses(baseUrl);
    const proxyUrl = resolvePreflightProxyUrl(env) || resolvePreflightProxyUrl(process.env);
    const curlProbe = buildProviderPreflightCurl(provider, proxyUrl);
    const result = spawnSync('curl', curlProbe.args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        input: curlProbe.input,
    });
    const code = (result.stdout ?? '').trim();
    if (result.status === 0 && /^2\d\d$/u.test(code)) {
        console.log(`[core-full-regression] Provider network preflight passed: ${baseUrl} -> HTTP ${code}; probe=${curlProbe.probe}${proxyUrl ? `; proxy=${proxyUrl}` : ''}${addresses.length ? `; local-dns=${addresses.join(',')}` : ''}`);
        return;
    }
    const detail = (result.stderr || (code && code !== '000' ? `HTTP ${code}` : result.stdout) || '').trim();
    const message = formatProviderPreflightFailure({
        baseUrl,
        proxyUrl,
        addresses,
        probe: curlProbe.probe,
        detail,
        status: result.status,
    });
    if (strictLive) {
        throw new Error(message);
    }
    console.warn(`[core-full-regression] ${message}`);
}

const coreFullTests = [
    'tests/runtime-profile-builtin-isolation.test.ts',
    'tests/profiled-builtin-agent-tools.test.ts',
    'tests/core-full-capability-regression.test.ts',
    'tests/core-full-provider-preflight.test.mjs',
    'tests/streaming-toolset-resolution.test.ts',
    'tests/runtime-tool-catalog.test.ts',
];

async function main() {
    runStep('sidecar lint', {
        cwd: sidecarDir,
        cmd: 'npm',
        args: ['run', 'lint'],
    });

    runStep('core/full capability regression', {
        cwd: sidecarDir,
        cmd: 'bun',
        args: ['test', ...coreFullTests],
    });

    runStep('runtime lifecycle regression', {
        cwd: sidecarDir,
        cmd: 'npm',
        args: ['run', 'test:runtime:lifecycle'],
    });

    runStep('desktop manual acceptance replay', {
        cwd: sidecarDir,
        cmd: 'npm',
        args: ['run', 'test:risk:desktop-replay'],
    });

    if (!skipLiveModel) {
        const liveEnv = buildLiveEnv({
            COWORKANY_REQUIRE_REAL_MODEL_SMOKE: strictLive ? '1' : process.env.COWORKANY_REQUIRE_REAL_MODEL_SMOKE ?? '0',
        });
        await runNetworkPreflight(liveEnv);
        runStep('live model sidecar smoke', {
            cwd: sidecarDir,
            cmd: 'bun',
            args: ['test', 'tests/real-model-smoke.e2e.test.ts'],
            env: liveEnv,
        });
    }

    if (!skipDesktopUi) {
        if (!hasDesktopProject()) {
            throw new Error(`desktop project not found at ${desktopDir}`);
        }
        if (!hasNpx()) {
            throw new Error('npx is required for Playwright desktop UI regression.');
        }
        runStep('live model desktop UI user input', {
            cwd: desktopDir,
            cmd: 'npx',
            args: ['playwright', 'test', 'tests/live-model-desktop-user-input.e2e.test.ts', '--workers=1'],
            env: buildLiveEnv({
                COWORKANY_REQUIRE_DESKTOP_LIVE_REGRESSION: strictLive ? '1' : process.env.COWORKANY_REQUIRE_DESKTOP_LIVE_REGRESSION ?? '0',
                COWORKANY_TEST_ISOLATE_APP_DATA: process.env.COWORKANY_TEST_ISOLATE_APP_DATA ?? '1',
            }),
        });
    }

    console.log('\nCore/full + live regression completed successfully.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    try {
        await main();
    } catch (error) {
        console.error(`\nCore/full regression failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
