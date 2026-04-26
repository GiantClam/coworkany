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

function findConfiguredProviderBaseUrl() {
    const candidates = [
        path.join(sidecarDir, 'llm-config.json'),
        path.join(os.homedir(), 'Library', 'Application Support', 'com.coworkany.desktop', 'llm-config.json'),
    ];
    for (const configPath of candidates) {
        const config = readJsonIfExists(configPath);
        if (!config || typeof config !== 'object') {
            continue;
        }
        const profiles = Array.isArray(config.profiles) ? config.profiles : [];
        const activeProfile = profiles.find((profile) => getString(profile?.id) === getString(config.activeProfileId))
            ?? profiles[0]
            ?? {};
        const sections = [
            activeProfile?.openai,
            activeProfile?.custom,
            config.openai,
            config.custom,
            config.aiberm,
        ];
        for (const section of sections) {
            const baseUrl = getString(section?.baseUrl);
            if (baseUrl) {
                return baseUrl.replace(/\/chat\/completions\/?$/u, '').replace(/\/+$/u, '');
            }
        }
    }
    return '';
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
    const configuredProxy = process.env.COWORKANY_PROXY_URL
        ?? process.env.HTTPS_PROXY
        ?? process.env.HTTP_PROXY
        ?? '';
    if (!configuredProxy) {
        const systemProxy = resolveMacOsSystemProxyUrl();
        if (systemProxy) {
            env.COWORKANY_PROXY_URL = systemProxy;
            env.COWORKANY_PROXY_SOURCE = 'macos_system_proxy';
            console.log(`[core-full-regression] Using macOS system proxy for live checks: ${systemProxy}`);
        }
    }
    return env;
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

async function runNetworkPreflight(env) {
    if (skipNetworkPreflight) {
        return;
    }
    const baseUrl = findConfiguredProviderBaseUrl();
    if (!baseUrl) {
        console.log('[core-full-regression] No provider baseURL found for network preflight.');
        return;
    }
    const addresses = await resolveProviderAddresses(baseUrl);
    const reservedAddresses = addresses.filter(isReservedProviderAddress);
    const curlArgs = ['-k', '-sS', '-o', '/dev/null', '-w', '%{http_code}', baseUrl];
    const proxyUrl = env.COWORKANY_PROXY_URL ?? process.env.COWORKANY_PROXY_URL;
    if (proxyUrl) {
        curlArgs.splice(0, 0, '--proxy', proxyUrl);
    }
    const result = spawnSync('curl', curlArgs, {
        cwd: repoRoot,
        encoding: 'utf-8',
    });
    const code = (result.stdout ?? '').trim();
    if (result.status === 0 && code !== '000') {
        console.log(`[core-full-regression] Provider network preflight passed: ${baseUrl} -> HTTP ${code}${addresses.length ? ` (${addresses.join(', ')})` : ''}`);
        return;
    }
    const detail = (result.stderr || result.stdout || '').trim();
    const addressDetail = addresses.length ? `; resolved=${addresses.join(',')}` : '';
    const reservedHint = reservedAddresses.length
        ? `; reserved/private resolution detected (${reservedAddresses.join(',')}) - check proxy fake-IP/DNS routing before blaming model loop`
        : '';
    const message = `Provider network preflight failed for ${baseUrl}${proxyUrl ? ` via ${proxyUrl}` : ''}${addressDetail}${reservedHint}: ${detail || `curl exit ${result.status}`}`;
    if (strictLive) {
        throw new Error(message);
    }
    console.warn(`[core-full-regression] ${message}`);
}

const coreFullTests = [
    'tests/runtime-profile-builtin-isolation.test.ts',
    'tests/profiled-builtin-agent-tools.test.ts',
    'tests/core-full-capability-regression.test.ts',
    'tests/streaming-toolset-resolution.test.ts',
    'tests/runtime-tool-catalog.test.ts',
];

try {
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
} catch (error) {
    console.error(`\nCore/full regression failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
