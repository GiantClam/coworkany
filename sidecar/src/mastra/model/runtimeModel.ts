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
    const fallbackRuntimeModelId = toRuntimeModelId(fallbackModelId, DEFAULT_MODEL_ID);
    const modelId = toRuntimeModelId(process.env.COWORKANY_MODEL, fallbackRuntimeModelId);
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
