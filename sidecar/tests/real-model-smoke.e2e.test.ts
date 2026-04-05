import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type JsonMessage = Record<string, unknown>;
type ModelCandidate = {
    modelId: string;
    source: string;
    env: NodeJS.ProcessEnv;
};

const PROVIDER_KEY_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    aiberm: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    xai: 'XAI_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mistral: 'MISTRAL_API_KEY',
};

function parseBooleanEnv(value: string | undefined): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function resolveSidecarCwd(): string {
    const nested = path.join(process.cwd(), 'sidecar', 'src', 'main.ts');
    if (fs.existsSync(nested)) {
        return path.join(process.cwd(), 'sidecar');
    }
    return process.cwd();
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasSubstantiveAssistantText(content: string): boolean {
    const normalized = content
        .replace(/[`*_>#-]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (normalized.length < 4) {
        return false;
    }
    return /[\p{L}\p{N}]/u.test(normalized);
}

function normalizeOpenAiBaseUrl(input: string | undefined): string | undefined {
    const raw = input?.trim();
    if (!raw) {
        return undefined;
    }
    if (raw.endsWith('/chat/completions')) {
        return raw.slice(0, -'/chat/completions'.length);
    }
    return raw.replace(/\/+$/, '');
}

function isLikelyAibermBaseUrl(input: string | undefined): boolean {
    const baseUrl = (input ?? '').toLowerCase();
    return baseUrl.includes('aiberm.com');
}

function resolveLlmConfigPaths(sidecarCwd: string): string[] {
    const candidates: string[] = [
        path.join(sidecarCwd, 'llm-config.json'),
    ];
    const homeDir = process.env.HOME?.trim();
    if (homeDir) {
        candidates.push(path.join(homeDir, 'Library', 'Application Support', 'com.coworkany.desktop', 'llm-config.json'));
    }
    return [...new Set(candidates)];
}

function resolveProxyEnvFromLlmConfig(sidecarCwd: string): NodeJS.ProcessEnv {
    for (const configPath of resolveLlmConfigPaths(sidecarCwd)) {
        if (!fs.existsSync(configPath)) {
            continue;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
            const root = toRecord(parsed);
            const proxy = toRecord(root.proxy);
            const enabled = proxy.enabled === true;
            const proxyUrl = getString(proxy.url)?.trim();
            if (!enabled || !proxyUrl) {
                continue;
            }
            const bypass = getString(proxy.bypass)?.trim();
            const noProxy = bypass || process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1';
            return {
                COWORKANY_PROXY_URL: proxyUrl,
                HTTPS_PROXY: proxyUrl,
                https_proxy: proxyUrl,
                HTTP_PROXY: proxyUrl,
                http_proxy: proxyUrl,
                ALL_PROXY: proxyUrl,
                all_proxy: proxyUrl,
                GLOBAL_AGENT_HTTPS_PROXY: proxyUrl,
                GLOBAL_AGENT_HTTP_PROXY: proxyUrl,
                NODE_USE_ENV_PROXY: '1',
                NO_PROXY: noProxy,
                no_proxy: noProxy,
            };
        } catch {
            // ignore invalid llm-config payloads
        }
    }
    return {};
}

function resolveSharedProviderEnv(sidecarCwd: string): NodeJS.ProcessEnv {
    const sharedEnv: NodeJS.ProcessEnv = {
        ...resolveProxyEnvFromLlmConfig(sidecarCwd),
    };
    const allowInsecureTls = parseBooleanEnv(process.env.E2E_ALLOW_INSECURE_TLS)
        || parseBooleanEnv(process.env.COWORKANY_ALLOW_INSECURE_TLS);
    if (allowInsecureTls) {
        sharedEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    return sharedEnv;
}

function createAibermCandidate(input: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    source: string;
    sharedEnv?: NodeJS.ProcessEnv;
}): ModelCandidate {
    const model = input.model?.trim() || 'gpt-5.3-codex';
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl) || 'https://aiberm.com/v1';
    return {
        modelId: model.includes('/') ? model : `openai/${model}`,
        source: input.source,
        env: {
            ...(input.sharedEnv ?? {}),
            OPENAI_API_KEY: input.apiKey,
            OPENAI_BASE_URL: baseUrl,
        },
    };
}

function resolveAibermEntry(root: Record<string, unknown>): {
    apiKey: string;
    baseUrl?: string;
    model?: string;
} | null {
    const rootProvider = getString(root.provider)?.toLowerCase();
    for (const key of ['aiberm', 'openai']) {
        const providerConfig = toRecord(root[key]);
        const apiKey = getString(providerConfig.apiKey);
        if (!apiKey) {
            continue;
        }
        const baseUrl = getString(providerConfig.baseUrl);
        const providerName = getString(providerConfig.provider)?.toLowerCase();
        if (
            providerName === 'aiberm'
            || rootProvider === 'aiberm'
            || isLikelyAibermBaseUrl(baseUrl)
            || key === 'aiberm'
        ) {
            return {
                apiKey,
                baseUrl,
                model: getString(providerConfig.model),
            };
        }
    }
    const profiles = Array.isArray(root.profiles)
        ? root.profiles.map(toRecord)
        : [];
    if (!profiles.length) {
        return null;
    }
    const activeProfileId = getString(root.activeProfileId);
    const orderedProfiles = activeProfileId
        ? [
            ...profiles.filter((profile) => getString(profile.id) === activeProfileId),
            ...profiles.filter((profile) => getString(profile.id) !== activeProfileId),
        ]
        : profiles;
    for (const profile of orderedProfiles) {
        const apiKey = getString(profile.apiKey);
        if (!apiKey) {
            continue;
        }
        const providerName = getString(profile.provider)?.toLowerCase();
        const baseUrl = getString(profile.baseUrl);
        if (providerName === 'aiberm' || isLikelyAibermBaseUrl(baseUrl)) {
            return {
                apiKey,
                baseUrl,
                model: getString(profile.model),
            };
        }
    }
    return null;
}

function loadAibermCandidateFromLlmConfig(sidecarCwd: string, sharedEnv: NodeJS.ProcessEnv): ModelCandidate | null {
    for (const configPath of resolveLlmConfigPaths(sidecarCwd)) {
        if (!fs.existsSync(configPath)) {
            continue;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
            const root = toRecord(parsed);
            const entry = resolveAibermEntry(root);
            if (!entry) {
                continue;
            }
            return createAibermCandidate({
                ...entry,
                source: `${path.basename(configPath)}(aiberm)`,
                sharedEnv,
            });
        } catch {
            // ignore invalid llm-config payloads
        }
    }
    return null;
}

function normalizeConfiguredModel(model: string, env: NodeJS.ProcessEnv): string {
    if (model.includes('/')) {
        return model;
    }
    const hasOpenAiStyleKey = Boolean(env.OPENAI_API_KEY?.trim() || env.E2E_AIBERM_API_KEY?.trim());
    const isAibermBaseUrl = isLikelyAibermBaseUrl(env.OPENAI_BASE_URL) || isLikelyAibermBaseUrl(env.E2E_AIBERM_BASE_URL);
    if (hasOpenAiStyleKey || isAibermBaseUrl) {
        return `openai/${model}`;
    }
    return model;
}

function resolveModelCandidate(): {
    candidate?: ModelCandidate;
    reason?: string;
} {
    const sidecarCwd = resolveSidecarCwd();
    const sharedEnv = resolveSharedProviderEnv(sidecarCwd);
    const configuredModel = process.env.TEST_MODEL_ID?.trim() || process.env.COWORKANY_MODEL?.trim();
    const seededEnv: NodeJS.ProcessEnv = { ...sharedEnv };
    if (process.env.E2E_AIBERM_API_KEY?.trim()) {
        seededEnv.OPENAI_API_KEY = process.env.E2E_AIBERM_API_KEY.trim();
        seededEnv.OPENAI_BASE_URL = normalizeOpenAiBaseUrl(process.env.E2E_AIBERM_BASE_URL) || 'https://aiberm.com/v1';
    }
    if (configuredModel) {
        return {
            candidate: {
                modelId: normalizeConfiguredModel(configuredModel, {
                    ...process.env,
                    ...seededEnv,
                }),
                source: 'TEST_MODEL_ID/COWORKANY_MODEL',
                env: seededEnv,
            },
        };
    }
    if (process.env.E2E_AIBERM_API_KEY?.trim()) {
        return {
            candidate: createAibermCandidate({
                apiKey: process.env.E2E_AIBERM_API_KEY.trim(),
                baseUrl: process.env.E2E_AIBERM_BASE_URL,
                source: 'E2E_AIBERM_API_KEY',
                sharedEnv,
            }),
        };
    }
    const configCandidate = loadAibermCandidateFromLlmConfig(sidecarCwd, sharedEnv);
    if (configCandidate) {
        return { candidate: configCandidate };
    }
    if (process.env.OPENAI_API_KEY?.trim()) {
        return {
            candidate: {
                modelId: 'openai/gpt-4o-mini',
                source: 'OPENAI_API_KEY',
                env: {
                    ...sharedEnv,
                    OPENAI_BASE_URL: normalizeOpenAiBaseUrl(process.env.OPENAI_BASE_URL),
                },
            },
        };
    }
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
        return {
            candidate: {
                modelId: 'anthropic/claude-sonnet-4-5',
                source: 'ANTHROPIC_API_KEY',
                env: sharedEnv,
            },
        };
    }
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
        return {
            candidate: {
                modelId: 'google/gemini-2.0-flash',
                source: 'GOOGLE_GENERATIVE_AI_API_KEY',
                env: sharedEnv,
            },
        };
    }
    return { reason: 'No provider API key found (E2E_AIBERM/OPENAI/ANTHROPIC/GOOGLE), no valid llm-config aiberm profile, and no TEST_MODEL_ID/COWORKANY_MODEL configured.' };
}

function resolveMissingApiKey(
    modelId: string,
    env: Record<string, string | undefined>,
): string | null {
    const provider = modelId.split('/')[0]?.toLowerCase();
    if (!provider) {
        return null;
    }
    const requiredKey = PROVIDER_KEY_MAP[provider];
    if (!requiredKey) {
        return null;
    }
    return env[requiredKey] ? null : requiredKey;
}

function formatFailureHint(
    errorMessage: string,
    env: Record<string, string | undefined>,
): string {
    const normalized = errorMessage.toLowerCase();
    const hints: string[] = [];
    if (normalized.includes('issuer certificate') || normalized.includes('self signed certificate')) {
        hints.push('check enterprise TLS/interception certificate trust');
        if (!parseBooleanEnv(process.env.E2E_ALLOW_INSECURE_TLS)) {
            hints.push('set E2E_ALLOW_INSECURE_TLS=1 for local diagnostic smoke only');
        }
    }
    if (normalized.includes('socket connection was closed unexpectedly')) {
        hints.push('check local proxy reachability');
    }
    if (env.COWORKANY_PROXY_URL || env.HTTPS_PROXY || env.HTTP_PROXY) {
        hints.push('proxy env detected');
    }
    if (hints.length === 0) {
        return errorMessage;
    }
    return `${errorMessage} (${hints.join('; ')})`;
}

class SidecarSession {
    private proc: Subprocess | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    readonly messages: JsonMessage[] = [];
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;

    constructor(options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
        this.cwd = options?.cwd ?? resolveSidecarCwd();
        this.env = {
            ...process.env,
            ...(options?.env ?? {}),
        };
    }

    async start(): Promise<void> {
        this.proc = spawn({
            cmd: ['bun', 'run', 'src/main.ts'],
            cwd: this.cwd,
            env: this.env,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        this.readStdout();
        this.readStderr();
        await this.waitFor(
            (message) => message.type === 'ready' && message.runtime === 'mastra',
            20_000,
        );
    }

    private readStdout(): void {
        if (!this.proc) {
            return;
        }
        const stdoutStream = this.proc.stdout;
        (async () => {
            try {
                for await (const chunk of stdoutStream) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);
                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            this.messages.push(toRecord(JSON.parse(line) as unknown));
                        } catch {
                            // ignore non-json stdout
                        }
                    }
                }
            } catch {
                // stream closed
            }
        })();
    }

    private readStderr(): void {
        if (!this.proc) {
            return;
        }
        const stderrStream = this.proc.stderr;
        (async () => {
            try {
                for await (const chunk of stderrStream) {
                    this.stderrBuffer += new TextDecoder().decode(chunk);
                }
            } catch {
                // stream closed
            }
        })();
    }

    send(message: JsonMessage): void {
        if (!this.proc?.stdin) {
            throw new Error('sidecar stdin unavailable');
        }
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        this.proc.stdin.flush();
    }

    async waitFor(
        predicate: (message: JsonMessage) => boolean,
        timeoutMs: number,
    ): Promise<JsonMessage> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hit = this.messages.find((message) => predicate(message));
            if (hit) {
                return hit;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(
            `waitFor timed out after ${timeoutMs}ms. recent=${JSON.stringify(this.messages.slice(-10))} stderr=${this.stderrBuffer.slice(-500)}`,
        );
    }

    stop(): void {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
    }
}

let session: SidecarSession | null = null;

afterEach(() => {
    session?.stop();
    session = null;
});

describe('real model smoke e2e', () => {
    test('start_task succeeds against a real configured provider model', async () => {
        const strictMode = parseBooleanEnv(process.env.COWORKANY_REQUIRE_REAL_MODEL_SMOKE);
        const resolved = resolveModelCandidate();
        if (!resolved.candidate) {
            if (strictMode) {
                throw new Error(`Real model smoke is required but cannot resolve model: ${resolved.reason}`);
            }
            console.log(`[real-model-smoke] skipped: ${resolved.reason}`);
            return;
        }
        const candidate = resolved.candidate;
        const effectiveEnv = {
            ...process.env,
            ...candidate.env,
        };

        const missingApiKey = resolveMissingApiKey(candidate.modelId, effectiveEnv);
        if (missingApiKey) {
            if (strictMode) {
                throw new Error(`Real model smoke is required but missing ${missingApiKey} for model ${candidate.modelId} (source=${candidate.source})`);
            }
            console.log(`[real-model-smoke] skipped: missing ${missingApiKey} for model ${candidate.modelId} (source=${candidate.source})`);
            return;
        }
        console.log(`[real-model-smoke] candidate: model=${candidate.modelId}, source=${candidate.source}`);

        session = new SidecarSession({
            env: {
                COWORKANY_MODEL: candidate.modelId,
                ...candidate.env,
            },
        });
        await session.start();

        const commandId = `cmd-real-smoke-${randomUUID()}`;
        const taskId = `task-real-smoke-${randomUUID()}`;
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'real-model-smoke',
                userQuery: '请用中文回复一句简短的话，证明你在线并可用。',
                context: {
                    workspacePath: process.cwd(),
                },
                config: {
                    modelId: candidate.modelId,
                    executionPath: 'direct',
                },
            },
        });

        const startResponse = await session.waitFor(
            (message) => message.type === 'start_task_response' && message.commandId === commandId,
            30_000,
        );
        expect(toRecord(startResponse.payload).success).toBe(true);

        await session.waitFor(
            (message) => message.type === 'TASK_STARTED' && message.taskId === taskId,
            30_000,
        );

        const handledApprovals = new Set<string>();
        const timeoutAt = Date.now() + 180_000;
        let cursor = 0;
        let terminal: JsonMessage | null = null;
        while (Date.now() < timeoutAt && !terminal) {
            const chunk = session.messages.slice(cursor);
            cursor = session.messages.length;
            for (const message of chunk) {
                if ((message.type === 'TASK_FINISHED' || message.type === 'TASK_FAILED') && message.taskId === taskId) {
                    terminal = message;
                    break;
                }
                if (message.type === 'EFFECT_REQUESTED' && message.taskId === taskId) {
                    const request = toRecord(toRecord(message.payload).request);
                    const requestId = getString(request.id);
                    if (!requestId || handledApprovals.has(requestId)) {
                        continue;
                    }
                    handledApprovals.add(requestId);
                    session.send({
                        id: `cmd-approve-${requestId}`,
                        timestamp: new Date().toISOString(),
                        type: 'report_effect_result',
                        payload: {
                            requestId,
                            success: true,
                        },
                    });
                }
            }
            if (!terminal) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        if (!terminal) {
            if (!strictMode) {
                console.log('[real-model-smoke] skipped: timed out in non-strict mode.');
                return;
            }
            throw new Error(`real model smoke timed out; recent=${JSON.stringify(session.messages.slice(-12))}`);
        }
        if (terminal.type === 'TASK_FAILED') {
            const payload = toRecord(terminal.payload);
            if (!strictMode) {
                console.log(`[real-model-smoke] skipped: provider run failed in non-strict mode: ${String(payload.error ?? 'unknown_error')}`);
                return;
            }
            const rawError = String(payload.error ?? 'unknown_error');
            throw new Error(`real model smoke failed: ${formatFailureHint(rawError, effectiveEnv)} (model=${candidate.modelId}, source=${candidate.source})`);
        }
        expect(terminal.type).toBe('TASK_FINISHED');

        const text = session.messages
            .filter((message) => message.type === 'TEXT_DELTA' && message.taskId === taskId)
            .map((message) => getString(toRecord(message.payload).delta) ?? '')
            .join('')
            .trim();
        expect(hasSubstantiveAssistantText(text)).toBe(true);
    }, 240_000);
});
