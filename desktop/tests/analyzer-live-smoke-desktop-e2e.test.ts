import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Real-provider analyzer smoke for the desktop runtime.
 *
 * Opt-in only:
 *   COWORKANY_ANALYZER_SMOKE_RUN=1
 *   If no provider/model override env is supplied, the test uses the active provider/model
 *   already configured in local CoworkAny desktop settings.
 *   COWORKANY_ANALYZER_SMOKE_PROVIDER=<anthropic|openrouter|openai|custom|ollama|...>
 *   COWORKANY_ANALYZER_SMOKE_API_KEY=<key>        // not required for ollama
 *   COWORKANY_ANALYZER_SMOKE_MODEL=<model>        // required for custom, optional otherwise
 *   COWORKANY_ANALYZER_SMOKE_BASE_URL=<url>       // required for custom, optional for openai-compatible/ollama
 *   COWORKANY_ANALYZER_SMOKE_API_FORMAT=<openai|anthropic>  // custom only
 *   COWORKANY_ANALYZER_SMOKE_ALLOW_INSECURE_TLS=1 // optional for custom/openai-compatible
 *   COWORKANY_ANALYZER_SMOKE_KEEP_WORKSPACE=1     // optional, keeps the temp benchmark workspace for inspection
 *
 * Run:
 *   cd desktop && npm run test:e2e:analyzer-live
 */

const TEST_TIMEOUT_MS = 8 * 60 * 1000;
const ENABLE_LIVE_SMOKE = process.env.COWORKANY_ANALYZER_SMOKE_RUN === '1';
const KEEP_WORKSPACE = process.env.COWORKANY_ANALYZER_SMOKE_KEEP_WORKSPACE === '1';
const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const SKILL_CREATOR_ROOT = path.resolve(__dirnameLocal, '../../.agent/skills/skill-creator');
const BENCHMARK_TEMPLATE_PATH = path.resolve(
    __dirnameLocal,
    '../../.tmp/skill-creator-smoke/benchmark.json'
);
const TEST_RESULTS_ROOT = path.resolve(__dirnameLocal, '../test-results/analyzer-live-smoke');
const OPENAI_COMPATIBLE_PRESETS = new Set([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);

type TauriInvokeResult<TPayload> = {
    success: boolean;
    payload: TPayload;
    error?: string | null;
};

type LiveAnalyzerConfig = {
    label: string;
    config: Record<string, unknown>;
};

type ConfiguredAnalyzerProfile = {
    provider: string;
    model?: string;
    source: 'env-override' | 'desktop-settings';
};

type LiveSmokeSummary = {
    providerLabel: string;
    benchmarkPath: string;
    workspaceRoot: string;
    keptWorkspace: boolean;
    smoke: Record<string, unknown>;
    draft: Record<string, unknown>;
    readiness: Record<string, unknown>;
    historyPath?: string;
    artifactPaths: string[];
    generatedAt: string;
};

function env(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

function resolveAnalyzerApiKey(provider: string): string | undefined {
    const explicit = env('COWORKANY_ANALYZER_SMOKE_API_KEY');
    if (explicit) {
        return explicit;
    }

    if (provider === 'anthropic') {
        return env('ANTHROPIC_API_KEY') ?? env('CLAUDE_API_KEY');
    }
    if (provider === 'openrouter') {
        return env('OPENROUTER_API_KEY');
    }
    if (provider === 'custom') {
        return env('OPENAI_API_KEY');
    }
    if (OPENAI_COMPATIBLE_PRESETS.has(provider)) {
        return env('OPENAI_API_KEY');
    }
    return undefined;
}

function resolveLiveAnalyzerConfig(): LiveAnalyzerConfig | null {
    const provider = env('COWORKANY_ANALYZER_SMOKE_PROVIDER');
    if (!provider) {
        return null;
    }

    const profileId = 'analyzer-live-smoke';
    const model = env('COWORKANY_ANALYZER_SMOKE_MODEL');
    const baseUrl = env('COWORKANY_ANALYZER_SMOKE_BASE_URL');
    const allowInsecureTls = env('COWORKANY_ANALYZER_SMOKE_ALLOW_INSECURE_TLS') === '1';
    const apiKey = resolveAnalyzerApiKey(provider);

    if (provider === 'anthropic') {
        if (!apiKey) return null;
        return {
            label: `${provider}:${model ?? 'claude-sonnet-4-5'}`,
            config: {
                provider,
                activeProfileId: profileId,
                profiles: [{
                    id: profileId,
                    name: 'Analyzer Live Smoke',
                    provider,
                    verified: true,
                    anthropic: {
                        apiKey,
                        model: model ?? 'claude-sonnet-4-5',
                    },
                }],
            },
        };
    }

    if (provider === 'openrouter') {
        if (!apiKey) return null;
        return {
            label: `${provider}:${model ?? 'anthropic/claude-sonnet-4.5'}`,
            config: {
                provider,
                activeProfileId: profileId,
                profiles: [{
                    id: profileId,
                    name: 'Analyzer Live Smoke',
                    provider,
                    verified: true,
                    openrouter: {
                        apiKey,
                        model: model ?? 'anthropic/claude-sonnet-4.5',
                    },
                }],
            },
        };
    }

    if (provider === 'ollama') {
        return {
            label: `${provider}:${model ?? 'llama3'}`,
            config: {
                provider,
                activeProfileId: profileId,
                profiles: [{
                    id: profileId,
                    name: 'Analyzer Live Smoke',
                    provider,
                    verified: true,
                    ollama: {
                        baseUrl: baseUrl ?? env('OLLAMA_URL') ?? 'http://localhost:11434/v1/chat/completions',
                        model: model ?? 'llama3',
                    },
                }],
            },
        };
    }

    if (provider === 'custom') {
        if (!apiKey || !baseUrl || !model) {
            return null;
        }
        return {
            label: `${provider}:${model}`,
            config: {
                provider,
                activeProfileId: profileId,
                profiles: [{
                    id: profileId,
                    name: 'Analyzer Live Smoke',
                    provider,
                    verified: true,
                    custom: {
                        apiKey,
                        baseUrl,
                        model,
                        apiFormat: env('COWORKANY_ANALYZER_SMOKE_API_FORMAT') ?? 'openai',
                        allowInsecureTls,
                    },
                }],
            },
        };
    }

    if (OPENAI_COMPATIBLE_PRESETS.has(provider)) {
        if (!apiKey) {
            return null;
        }
        return {
            label: `${provider}:${model ?? 'default'}`,
            config: {
                provider,
                activeProfileId: profileId,
                profiles: [{
                    id: profileId,
                    name: 'Analyzer Live Smoke',
                    provider,
                    verified: true,
                    openai: {
                        apiKey,
                        baseUrl: baseUrl,
                        model,
                        allowInsecureTls,
                    },
                }],
            },
        };
    }

    return null;
}

function resolveConfiguredAnalyzerProfile(config: Record<string, unknown>): ConfiguredAnalyzerProfile | null {
    const activeProfileId = typeof config.activeProfileId === 'string' ? config.activeProfileId : null;
    const profiles = Array.isArray(config.profiles) ? config.profiles as Array<Record<string, unknown>> : [];
    const activeProfile = activeProfileId
        ? profiles.find((profile) => profile.id === activeProfileId)
        : undefined;

    const provider = typeof activeProfile?.provider === 'string'
        ? activeProfile.provider
        : typeof config.provider === 'string'
            ? config.provider
            : null;

    if (!provider) {
        return null;
    }

    const settingsSource = activeProfile ?? config;
    const providerSettings = provider === 'anthropic'
        ? settingsSource.anthropic
        : provider === 'openrouter'
            ? settingsSource.openrouter
            : provider === 'ollama'
                ? settingsSource.ollama
                : provider === 'custom'
                    ? settingsSource.custom
                    : settingsSource.openai;

    const model = providerSettings && typeof providerSettings === 'object' && typeof (providerSettings as Record<string, unknown>).model === 'string'
        ? String((providerSettings as Record<string, unknown>).model)
        : undefined;

    return {
        provider,
        model,
        source: 'desktop-settings',
    };
}

function ensureLiveSmokeResultsDir(): string {
    fs.mkdirSync(TEST_RESULTS_ROOT, { recursive: true });
    return TEST_RESULTS_ROOT;
}

function writeLiveSmokeSummary(summary: LiveSmokeSummary): string {
    const outputDir = ensureLiveSmokeResultsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(outputDir, `summary-${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
    return filePath;
}

async function tauriInvoke<TPayload>(
    page: any,
    command: string,
    args?: Record<string, unknown>
): Promise<TPayload> {
    return page.evaluate(async ({ commandName, commandArgs }) => {
        const tauriWindow = window as typeof window & {
            __TAURI_INTERNALS__?: {
                invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
            __TAURI__?: {
                core?: {
                    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
            };
        };
        const invokeFn =
            tauriWindow.__TAURI_INTERNALS__?.invoke ??
            tauriWindow.__TAURI__?.core?.invoke;
        if (typeof invokeFn !== 'function') {
            throw new Error('Tauri invoke is unavailable in the desktop runtime.');
        }
        return invokeFn(commandName, commandArgs);
    }, {
        commandName: command,
        commandArgs: args,
    }) as Promise<TPayload>;
}

function seedBenchmarkWorkspace(): { root: string; benchmarkPath: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-analyzer-live-'));
    const benchmarkPath = path.join(root, 'benchmark.json');

    if (fs.existsSync(BENCHMARK_TEMPLATE_PATH)) {
        fs.copyFileSync(BENCHMARK_TEMPLATE_PATH, benchmarkPath);
    } else {
        fs.writeFileSync(
            benchmarkPath,
            JSON.stringify({
                metadata: {
                    skill_name: 'sample-skill',
                    timestamp: new Date().toISOString(),
                },
                runs: [
                    {
                        eval_id: 1,
                        configuration: 'with_skill',
                        run_number: 1,
                        result: { pass_rate: 1.0, time_seconds: 8.2, tokens: 120 },
                        expectations: [
                            { text: 'Primary expectation', passed: true, evidence: 'ok' },
                        ],
                        notes: [],
                    },
                    {
                        eval_id: 1,
                        configuration: 'without_skill',
                        run_number: 1,
                        result: { pass_rate: 0.0, time_seconds: 7.1, tokens: 70 },
                        expectations: [
                            { text: 'Primary expectation', passed: false, evidence: 'missing' },
                        ],
                        notes: [],
                    },
                ],
                run_summary: {
                    with_skill: {
                        pass_rate: { mean: 1.0, stddev: 0.0 },
                        time_seconds: { mean: 8.2, stddev: 0.0 },
                        tokens: { mean: 120.0, stddev: 0.0 },
                    },
                    without_skill: {
                        pass_rate: { mean: 0.0, stddev: 0.0 },
                        time_seconds: { mean: 7.1, stddev: 0.0 },
                        tokens: { mean: 70.0, stddev: 0.0 },
                    },
                    delta: {
                        pass_rate: '+1.00',
                        time_seconds: '+1.1',
                        tokens: '+50',
                    },
                },
                notes: [],
            }, null, 2),
            'utf-8'
        );
    }

    return { root, benchmarkPath };
}

test.describe('Desktop GUI E2E - analyzer live smoke', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('runs real provider analyzer smoke and marks workspace ready', async ({ page }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');
        test.skip(!ENABLE_LIVE_SMOKE, 'Set COWORKANY_ANALYZER_SMOKE_RUN=1 to enable live analyzer smoke.');

        const liveConfig = resolveLiveAnalyzerConfig();
        test.skip(
            !liveConfig,
            'Set COWORKANY_ANALYZER_SMOKE_PROVIDER and matching credentials/model env vars before running this live smoke.'
        );

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const workspace = seedBenchmarkWorkspace();
        const outputDir = ensureLiveSmokeResultsDir();
        const originalSettings = await tauriInvoke<TauriInvokeResult<Record<string, unknown>>>(
            page,
            'get_llm_settings'
        );
        const configuredProfile = liveConfig
            ? {
                provider: String((liveConfig.config.provider as string | undefined) ?? ''),
                model: liveConfig.label.includes(':') ? liveConfig.label.split(':').slice(1).join(':') : undefined,
                source: 'env-override' as const,
            }
            : resolveConfiguredAnalyzerProfile(originalSettings.payload);

        test.skip(
            !configuredProfile,
            'No env override was provided and no active provider/model is configured in desktop settings.'
        );

        try {
            if (liveConfig) {
                await tauriInvoke(page, 'save_llm_settings', { input: liveConfig.config });
            }

            const smoke = await tauriInvoke<TauriInvokeResult<Record<string, unknown>>>(
                page,
                'run_skill_benchmark_analyzer_smoke',
                {
                    input: {
                        benchmarkPath: workspace.benchmarkPath,
                        skillPath: SKILL_CREATOR_ROOT,
                    },
                }
            );

            expect(smoke.success).toBe(true);
            expect(smoke.payload.reachable).toBe(true);
            expect(smoke.payload.resultSource).toBe('smoke');
            expect(Array.isArray(smoke.payload.notes)).toBe(true);
            expect((smoke.payload.notes as unknown[]).length).toBeGreaterThan(0);

            const draft = await tauriInvoke<TauriInvokeResult<Record<string, unknown>>>(
                page,
                'generate_skill_benchmark_notes',
                {
                    input: {
                        benchmarkPath: workspace.benchmarkPath,
                        skillPath: SKILL_CREATOR_ROOT,
                    },
                }
            );

            expect(draft.success).toBe(true);
            expect(draft.payload.source).toBe('llm');
            expect(Array.isArray(draft.payload.notes)).toBe(true);
            expect((draft.payload.notes as unknown[]).length).toBeGreaterThan(0);

            const readiness = await tauriInvoke<TauriInvokeResult<Record<string, unknown>>>(
                page,
                'assess_skill_benchmark_analyzer_readiness',
                {
                    input: {
                        benchmarkPath: workspace.benchmarkPath,
                    },
                }
            );

            expect(readiness.success).toBe(true);
            const assessment = readiness.payload.assessment as Record<string, unknown>;
            expect(assessment.level).toBe('ready');
            expect(assessment.smokeSuccessPresent).toBe(true);

            const history = await tauriInvoke<TauriInvokeResult<Record<string, unknown>>>(
                page,
                'load_skill_benchmark_analyzer_history',
                {
                    input: {
                        benchmarkPath: workspace.benchmarkPath,
                        limit: 8,
                    },
                }
            );

            const entries = Array.isArray(history.payload.entries) ? history.payload.entries as Array<Record<string, unknown>> : [];
            const resultSources = entries
                .map((entry) => entry.status as Record<string, unknown>)
                .map((status) => String(status.resultSource ?? ''));
            expect(resultSources).toContain('smoke');
            expect(resultSources).toContain('generate');

            const candidatePaths = [
                smoke.payload.statusPath,
                smoke.payload.logPath,
                draft.payload.statusPath,
                draft.payload.logPath,
                readiness.payload.path,
                history.payload.path,
            ]
                .filter((value): value is string => typeof value === 'string' && value.length > 0);

            for (const candidatePath of candidatePaths) {
                expect(fs.existsSync(candidatePath), `artifact should exist: ${candidatePath}`).toBe(true);
            }

            const summaryPath = writeLiveSmokeSummary({
                providerLabel: liveConfig?.label ?? `${configuredProfile!.provider}${configuredProfile!.model ? `:${configuredProfile!.model}` : ''}`,
                benchmarkPath: workspace.benchmarkPath,
                workspaceRoot: workspace.root,
                keptWorkspace: KEEP_WORKSPACE,
                smoke: smoke.payload,
                draft: draft.payload,
                readiness: readiness.payload,
                historyPath: typeof history.payload.path === 'string' ? history.payload.path : undefined,
                artifactPaths: candidatePaths,
                generatedAt: new Date().toISOString(),
            });
            expect(fs.existsSync(summaryPath), `summary artifact should exist: ${summaryPath}`).toBe(true);
            await page.screenshot({
                path: path.join(outputDir, 'analyzer-live-smoke-final.png'),
                fullPage: true,
            }).catch(() => {});
        } finally {
            if (liveConfig) {
                await tauriInvoke(page, 'save_llm_settings', {
                    input: originalSettings.payload,
                }).catch(() => {});
            }
            if (!KEEP_WORKSPACE) {
                fs.rmSync(workspace.root, { recursive: true, force: true });
            }
        }
    });
});
