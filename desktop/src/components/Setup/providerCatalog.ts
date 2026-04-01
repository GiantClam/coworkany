export type SetupProvider =
    | 'anthropic'
    | 'openrouter'
    | 'openai'
    | 'aiberm'
    | 'nvidia'
    | 'siliconflow'
    | 'gemini'
    | 'qwen'
    | 'minimax'
    | 'kimi';

type SetupProviderPreset = {
    provider: SetupProvider;
    label: string;
    apiKeyLabel: string;
    hint: string;
    placeholder: string;
    model?: string;
    baseUrl?: string;
};

const DEFAULT_PRESETS: SetupProviderPreset[] = [
    {
        provider: 'anthropic',
        label: 'Anthropic (Claude)',
        apiKeyLabel: 'Anthropic API Key',
        hint: 'Get your key from console.anthropic.com',
        placeholder: 'sk-ant-...',
        model: 'claude-sonnet-4-5',
    },
    {
        provider: 'openrouter',
        label: 'OpenRouter',
        apiKeyLabel: 'OpenRouter API Key',
        hint: 'Get your key from openrouter.ai/keys',
        placeholder: 'sk-or-...',
        model: 'anthropic/claude-sonnet-4.5',
    },
    {
        provider: 'openai',
        label: 'OpenAI',
        apiKeyLabel: 'OpenAI API Key',
        hint: 'Get your key from platform.openai.com/api-keys',
        placeholder: 'sk-...',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
    },
    {
        provider: 'aiberm',
        label: 'Aiberm',
        apiKeyLabel: 'Aiberm API Key',
        hint: 'Use your Aiberm platform API key. Base URL defaults to https://aiberm.com/v1',
        placeholder: 'sk-...',
        baseUrl: 'https://aiberm.com/v1',
        model: 'gpt-5.3-codex',
    },
    {
        provider: 'nvidia',
        label: 'NVIDIA NIM',
        apiKeyLabel: 'NVIDIA API Key',
        hint: 'Get your key from build.nvidia.com',
        placeholder: 'nvapi-...',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'meta/llama-3.1-70b-instruct',
    },
    {
        provider: 'siliconflow',
        label: 'SiliconFlow',
        apiKeyLabel: 'SiliconFlow API Key',
        hint: 'Use your SiliconFlow API key',
        placeholder: 'sk-...',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen2.5-7B-Instruct',
    },
    {
        provider: 'gemini',
        label: 'Gemini',
        apiKeyLabel: 'Gemini API Key',
        hint: 'Get your key from ai.google.dev',
        placeholder: 'AIza...',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.0-flash',
    },
    {
        provider: 'qwen',
        label: 'Qwen',
        apiKeyLabel: 'Qwen API Key',
        hint: 'Use your DashScope API key',
        placeholder: 'sk-...',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
    },
    {
        provider: 'minimax',
        label: 'MiniMax',
        apiKeyLabel: 'MiniMax API Key',
        hint: 'Use your MiniMax Token Plan API key',
        placeholder: 'sk-...',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
    },
    {
        provider: 'kimi',
        label: 'Kimi',
        apiKeyLabel: 'Kimi API Key',
        hint: 'Get your key from platform.moonshot.ai',
        placeholder: 'sk-...',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'moonshot-v1-8k',
    },
];

const PRESET_BY_PROVIDER = new Map<SetupProvider, SetupProviderPreset>(
    DEFAULT_PRESETS.map((preset) => [preset.provider, preset])
);

export const setupProviderOptions = DEFAULT_PRESETS;

export function getSetupProviderPreset(provider: SetupProvider): SetupProviderPreset {
    return PRESET_BY_PROVIDER.get(provider) ?? PRESET_BY_PROVIDER.get('anthropic')!;
}

export function getSetupProviderLabel(provider: string | null): string | null {
    if (!provider) return null;
    const preset = PRESET_BY_PROVIDER.get(provider as SetupProvider);
    return preset?.label ?? provider;
}

export function buildSetupValidationInput(
    provider: SetupProvider,
    apiKey: string,
    proxy?: { enabled?: boolean; url?: string; bypass?: string },
): Record<string, unknown> {
    const preset = getSetupProviderPreset(provider);

    if (provider === 'anthropic') {
        return {
            provider,
            proxy,
            anthropic: {
                apiKey,
                model: preset.model,
            },
        };
    }

    if (provider === 'openrouter') {
        return {
            provider,
            proxy,
            openrouter: {
                apiKey,
                model: preset.model,
            },
        };
    }

    return {
        provider,
        proxy,
        openai: {
            apiKey,
            baseUrl: preset.baseUrl,
            model: preset.model,
        },
    };
}

export function buildSetupProfileConfig(provider: SetupProvider, apiKey: string, profileId: string) {
    const preset = getSetupProviderPreset(provider);
    const profile: Record<string, unknown> = {
        id: profileId,
        name: `${preset.label} (Setup)`,
        provider,
        verified: true,
    };

    if (provider === 'anthropic') {
        profile.anthropic = {
            apiKey,
            model: preset.model,
        };
    } else if (provider === 'openrouter') {
        profile.openrouter = {
            apiKey,
            model: preset.model,
        };
    } else {
        profile.openai = {
            apiKey,
            baseUrl: preset.baseUrl,
            model: preset.model,
        };
    }

    return {
        provider,
        profiles: [profile],
        activeProfileId: profileId,
    };
}
