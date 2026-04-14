import { seedRuntimeLlmEnvFromConfig } from '../../config/runtimeConfig';

export type RuntimeModelId = `${string}/${string}`;

type OpenAICompatibleModelConfig = {
    id: RuntimeModelId;
    url: string;
    apiKey?: string;
    headers?: Record<string, string>;
};

export type RuntimeModelConfig = RuntimeModelId | OpenAICompatibleModelConfig;

const DEFAULT_MODEL_ID: RuntimeModelId = 'anthropic/claude-sonnet-4-5';
const OPENAI_COMPATIBLE_PROFILE_PROVIDERS = new Set([
    'openai',
    'aiberm',
    'nvidia',
    'siliconflow',
    'gemini',
    'qwen',
    'minimax',
    'kimi',
]);
let runtimeLlmEnvSeeded = false;

function ensureRuntimeLlmEnvSeeded(): void {
    if (runtimeLlmEnvSeeded) {
        return;
    }
    const runningInTest = process.env.NODE_ENV === 'test';
    const allowSeedInTest = process.env.COWORKANY_ALLOW_RUNTIME_LLM_ENV_SEED_IN_TEST === '1';
    if (runningInTest && !allowSeedInTest) {
        runtimeLlmEnvSeeded = true;
        return;
    }
    runtimeLlmEnvSeeded = true;
    try {
        seedRuntimeLlmEnvFromConfig({
            cwd: process.cwd(),
            env: process.env,
        });
    } catch {
        // Ignore config-seed failures here and fall back to existing env values.
    }
}

function normalize(value: string | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toRuntimeModelId(
    value: string | null | undefined,
    fallback: RuntimeModelId = DEFAULT_MODEL_ID,
): RuntimeModelId {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || !normalized.includes('/')) {
        return fallback;
    }
    return normalized as RuntimeModelId;
}

export function resolveRuntimeModelId(
    preferredModelId?: string | null,
    fallbackModelId: string = DEFAULT_MODEL_ID,
): RuntimeModelId {
    ensureRuntimeLlmEnvSeeded();
    const fallbackRuntimeModelId = toRuntimeModelId(fallbackModelId, DEFAULT_MODEL_ID);
    const envModelId = toRuntimeModelId(process.env.COWORKANY_MODEL, fallbackRuntimeModelId);
    return toRuntimeModelId(preferredModelId, envModelId);
}

export function shouldUseOpenAICompatibleChatModel(input: {
    modelId: string;
    openAiBaseUrl?: string | null;
    llmConfigProvider?: string | null;
    llmCustomApiFormat?: string | null;
}): boolean {
    const baseUrl = input.openAiBaseUrl?.toLowerCase() ?? '';
    if (!baseUrl) {
        return false;
    }

    const provider = input.llmConfigProvider?.toLowerCase() ?? '';
    const customApiFormat = input.llmCustomApiFormat?.toLowerCase() ?? '';
    if (provider === 'custom') {
        return customApiFormat !== 'anthropic';
    }

    if (OPENAI_COMPATIBLE_PROFILE_PROVIDERS.has(provider)) {
        return true;
    }

    const modelId = input.modelId.toLowerCase();
    if (!modelId.includes('/')) {
        return false;
    }
    return baseUrl.includes('aiberm.com')
        && (modelId.startsWith('openai/') || modelId.startsWith('aiberm/'));
}

export function resolveRuntimeModelConfig(
    fallbackModelId: string = DEFAULT_MODEL_ID,
): RuntimeModelConfig {
    return resolveRuntimeModelConfigWithPreferredModel({
        fallbackModelId,
    });
}

export function resolveRuntimeModelConfigWithPreferredModel(input: {
    fallbackModelId?: string;
    preferredModelId?: string | null;
} = {}): RuntimeModelConfig {
    ensureRuntimeLlmEnvSeeded();
    const modelId = resolveRuntimeModelId(
        input.preferredModelId,
        input.fallbackModelId ?? DEFAULT_MODEL_ID,
    );
    const openAiBaseUrl = normalize(process.env.OPENAI_BASE_URL);
    const llmConfigProvider = normalize(process.env.COWORKANY_LLM_CONFIG_PROVIDER);
    const llmCustomApiFormat = normalize(process.env.COWORKANY_LLM_CUSTOM_API_FORMAT);
    if (!openAiBaseUrl) {
        return modelId;
    }
    if (
        !shouldUseOpenAICompatibleChatModel({
            modelId,
            openAiBaseUrl,
            llmConfigProvider,
            llmCustomApiFormat,
        })
    ) {
        return modelId;
    }

    const apiKey = normalize(process.env.OPENAI_API_KEY);
    const openAiCompatibleConfig: OpenAICompatibleModelConfig = {
        id: modelId,
        url: openAiBaseUrl,
    };
    if (apiKey) {
        openAiCompatibleConfig.apiKey = apiKey;
    }
    return openAiCompatibleConfig;
}
