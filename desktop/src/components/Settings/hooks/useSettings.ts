/**
 * useSettings Hook
 *
 * Business logic for Settings management
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { saveConfig as saveToStore } from '../../../lib/configStore';
import type {
    LlmConfig,
    LlmProfile,
    AnthropicProviderSettings,
    OpenRouterProviderSettings,
    CustomProviderSettings,
    SearchSettings,
    ProxySettings,
    ValidationMessage,
} from '../../../types';

interface IpcResult {
    success: boolean;
    payload: LlmConfig;
    error?: string;
}

interface ValidationResult {
    success: boolean;
    payload: {
        error?: string;
    };
}

const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890';

function normalizeProxySettings(proxy?: ProxySettings): ProxySettings {
    if (!proxy) {
        return { enabled: false };
    }

    if (proxy.enabled === true) {
        return {
            ...proxy,
            url: proxy.url?.trim() || DEFAULT_PROXY_URL,
        };
    }

    return proxy;
}

export function useSettings() {
    // Configuration state
    const [config, setConfig] = useState<LlmConfig>({ provider: 'anthropic', profiles: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // Profile editing state
    const [editProvider, setEditProvider] = useState<string>('anthropic');
    const [editName, setEditName] = useState<string>('');
    const [editAnthropic, setEditAnthropic] = useState<AnthropicProviderSettings>({});
    const [editOpenRouter, setEditOpenRouter] = useState<OpenRouterProviderSettings>({});
    const [editCustom, setEditCustom] = useState<CustomProviderSettings>({ apiFormat: 'openai' });
    const [isValidating, setIsValidating] = useState(false);
    const [validationMsg, setValidationMsg] = useState<ValidationMessage | null>(null);

    // Search settings state
    const [searchSettings, setSearchSettings] = useState<SearchSettings>({ provider: 'serper' });
    const [searchSaved, setSearchSaved] = useState(false);
    const [proxySettings, setProxySettings] = useState<ProxySettings>({ enabled: false });
    const [proxySaved, setProxySaved] = useState(false);

    /**
     * Load configuration from backend
     */
    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSaved(false);
        setSearchSaved(false);
        setProxySaved(false);
        try {
            const result = await invoke<IpcResult>('get_llm_settings');
            const data = result.payload ?? { provider: 'anthropic', profiles: [] };
            const normalizedData: LlmConfig = {
                ...data,
                proxy: normalizeProxySettings(data.proxy),
            };
            setConfig(normalizedData);

            // Load search settings
            setSearchSettings(normalizedData.search ?? { provider: 'serper' });
            setProxySettings(normalizedData.proxy ?? { enabled: false });

            // Set defaults for editor from current selection or first profile
            if (normalizedData.activeProfileId) {
                const active = normalizedData.profiles?.find(p => p.id === normalizedData.activeProfileId);
                if (active) {
                    setEditProvider(active.provider);
                    setEditName(active.name);
                    setEditAnthropic(active.anthropic ?? {});
                    setEditOpenRouter(active.openrouter ?? {});
                    setEditCustom(active.custom ?? { apiFormat: 'openai' });
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Save configuration to backend
     */
    const saveConfig = useCallback(async (newConfig: LlmConfig) => {
        setLoading(true);
        setError(null);
        setSaved(false);
        try {
            // Primary: save via IPC (writes llm-config.json)
            await invoke<IpcResult>('save_llm_settings', { input: newConfig });
            // Secondary: dual-write to Tauri Store for future migration
            try {
                await saveToStore('llmConfig', newConfig);
            } catch { /* best-effort dual-write */ }
            setConfig(newConfig);
            setSaved(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save settings');
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Validate and add/update profile
     */
    const validateAndAddProfile = useCallback(async (profile: LlmProfile) => {
        setIsValidating(true);
        setValidationMsg(null);
        try {
            const input = {
                provider: profile.provider,
                anthropic: profile.anthropic,
                openrouter: profile.openrouter,
                openai: profile.openai,
                custom: profile.custom,
            };

            const result = await invoke<ValidationResult>('validate_llm_settings', { input });

            if (result.success) {
                setValidationMsg({ type: 'success', text: 'Verification successful!' });

                const newProfiles = [...(config.profiles || [])];
                const existingIdx = newProfiles.findIndex(
                    p => p.id === profile.id || p.name === profile.name
                );
                if (existingIdx >= 0) {
                    newProfiles[existingIdx] = profile;
                } else {
                    newProfiles.push(profile);
                }

                await saveConfig({
                    ...config,
                    profiles: newProfiles,
                    activeProfileId: config.activeProfileId || profile.id,
                });
            } else {
                setValidationMsg({
                    type: 'error',
                    text: result.payload?.error || 'Verification failed',
                });
            }
        } catch (err) {
            setValidationMsg({
                type: 'error',
                text: err instanceof Error ? err.message : 'Connection error',
            });
        } finally {
            setIsValidating(false);
        }
    }, [config, saveConfig]);

    /**
     * Switch active profile
     */
    const switchProfile = useCallback(async (id: string) => {
        await saveConfig({ ...config, activeProfileId: id });
    }, [config, saveConfig]);

    /**
     * Delete a profile
     */
    const deleteProfile = useCallback(async (id: string) => {
        const newProfiles = (config.profiles || []).filter(p => p.id !== id);
        let activeId = config.activeProfileId;
        if (activeId === id) {
            activeId = newProfiles[0]?.id;
        }
        await saveConfig({ ...config, profiles: newProfiles, activeProfileId: activeId });
    }, [config, saveConfig]);

    /**
     * Save search settings
     */
    const saveSearchSettings = useCallback(async (newSearch: SearchSettings) => {
        setSearchSaved(false);
        try {
            await saveConfig({ ...config, search: newSearch });
            setSearchSettings(newSearch);
            setSearchSaved(true);
            setTimeout(() => setSearchSaved(false), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save search settings');
        }
    }, [config, saveConfig]);

    /**
     * Save proxy settings
     */
    const saveProxySettings = useCallback(async (newProxy: ProxySettings) => {
        setProxySaved(false);
        try {
            const normalizedProxy = normalizeProxySettings(newProxy);
            await saveConfig({ ...config, proxy: normalizedProxy });
            setProxySettings(normalizedProxy);
            setProxySaved(true);
            setTimeout(() => setProxySaved(false), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save proxy settings');
        }
    }, [config, saveConfig]);

    /**
     * Update max history messages
     */
    const updateMaxHistoryMessages = useCallback(async (value: number | undefined) => {
        await saveConfig({ ...config, maxHistoryMessages: value });
    }, [config, saveConfig]);

    // Load configuration on mount
    useEffect(() => {
        void refresh();
    }, []);

    return {
        // Configuration state
        config,
        loading,
        error,
        saved,

        // Profile editing state
        editProvider,
        editName,
        editAnthropic,
        editOpenRouter,
        editCustom,
        isValidating,
        validationMsg,
        setEditProvider,
        setEditName,
        setEditAnthropic,
        setEditOpenRouter,
        setEditCustom,

        // Search settings state
        searchSettings,
        searchSaved,
        proxySettings,
        proxySaved,

        // Actions
        refresh,
        saveConfig,
        validateAndAddProfile,
        switchProfile,
        deleteProfile,
        saveSearchSettings,
        saveProxySettings,
        updateMaxHistoryMessages,
    };
}
