/**
 * useSettings Hook
 *
 * Business logic for Settings management
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveConfig as saveToStore } from '../../../lib/configStore';
import { isTauri } from '../../../lib/tauri';
import type {
    LlmConfig,
    LlmProfile,
    AnthropicProviderSettings,
    OpenRouterProviderSettings,
    CustomProviderSettings,
    SearchSettings,
    ProxySettings,
    PolicyConfig,
    PolicyAuditEvent,
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
const DEFAULT_POLICY_CONFIG: PolicyConfig = {
    allowlists: { commands: [], domains: [], paths: [] },
    blocklists: { commands: [], domains: [], paths: [] },
    deniedEffects: [],
};

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

function normalizeStringList(values?: string[]): string[] {
    return Array.from(
        new Set((values ?? []).map((value) => value.trim()).filter(Boolean).map((value) => value.toLowerCase()))
    ).sort();
}

function normalizePolicyConfig(policy?: PolicyConfig): PolicyConfig {
    return {
        defaultPolicies: policy?.defaultPolicies ?? {},
        allowlists: {
            commands: normalizeStringList(policy?.allowlists?.commands),
            domains: normalizeStringList(policy?.allowlists?.domains),
            paths: normalizeStringList(policy?.allowlists?.paths),
        },
        blocklists: {
            commands: normalizeStringList(policy?.blocklists?.commands),
            domains: normalizeStringList(policy?.blocklists?.domains),
            paths: normalizeStringList(policy?.blocklists?.paths),
        },
        deniedEffects: Array.from(new Set(policy?.deniedEffects ?? [])).sort(),
    };
}

function sortPolicyAuditEvents(events: PolicyAuditEvent[]): PolicyAuditEvent[] {
    return [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
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
    const [policyConfig, setPolicyConfig] = useState<PolicyConfig>(DEFAULT_POLICY_CONFIG);
    const [policyAuditEvents, setPolicyAuditEvents] = useState<PolicyAuditEvent[]>([]);
    const [policySaved, setPolicySaved] = useState(false);
    const [policySaving, setPolicySaving] = useState(false);
    const [policyAuditLoading, setPolicyAuditLoading] = useState(false);
    const [policyAuditClearing, setPolicyAuditClearing] = useState(false);

    const refreshPolicyAudit = useCallback(async () => {
        setPolicyAuditLoading(true);
        try {
            const loadedAuditEvents = await invoke<PolicyAuditEvent[]>('list_policy_audit_events', { limit: 100 });
            setPolicyAuditEvents(sortPolicyAuditEvents(loadedAuditEvents ?? []));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load policy audit trail');
        } finally {
            setPolicyAuditLoading(false);
        }
    }, []);

    const clearPolicyAudit = useCallback(async () => {
        setPolicyAuditClearing(true);
        try {
            await invoke('clear_policy_audit_events');
            setPolicyAuditEvents([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear policy audit trail');
        } finally {
            setPolicyAuditClearing(false);
        }
    }, []);

    /**
     * Load configuration from backend
     */
    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSaved(false);
        setSearchSaved(false);
        setProxySaved(false);
        setPolicySaved(false);
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

            const loadedPolicy = await invoke<PolicyConfig>('get_policy_config');
            setPolicyConfig(normalizePolicyConfig(loadedPolicy ?? DEFAULT_POLICY_CONFIG));
            const loadedAuditEvents = await invoke<PolicyAuditEvent[]>('list_policy_audit_events', { limit: 100 });
            setPolicyAuditEvents(sortPolicyAuditEvents(loadedAuditEvents ?? []));

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
     * Save persistent policy settings
     */
    const savePolicyConfig = useCallback(async (newPolicy: PolicyConfig) => {
        setPolicySaved(false);
        setPolicySaving(true);
        try {
            const savedPolicy = await invoke<PolicyConfig>('save_policy_config', { config: normalizePolicyConfig(newPolicy) });
            setPolicyConfig(normalizePolicyConfig(savedPolicy));
            setPolicySaved(true);
            setTimeout(() => setPolicySaved(false), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save policy settings');
        } finally {
            setPolicySaving(false);
        }
    }, []);

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

    useEffect(() => {
        let unlisten: UnlistenFn | undefined;

        async function setupPolicyAuditListener() {
            if (!isTauri()) {
                return;
            }

            unlisten = await listen<PolicyAuditEvent>('policy-audit-event', (event) => {
                setPolicyAuditEvents((current) => sortPolicyAuditEvents([...current, event.payload]).slice(0, 100));
            });
        }

        void setupPolicyAuditListener();

        return () => {
            unlisten?.();
        };
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
        policyConfig,
        policyAuditEvents,
        policyAuditLoading,
        policyAuditClearing,
        policySaved,
        policySaving,

        // Actions
        refresh,
        refreshPolicyAudit,
        clearPolicyAudit,
        saveConfig,
        validateAndAddProfile,
        switchProfile,
        deleteProfile,
        saveSearchSettings,
        saveProxySettings,
        savePolicyConfig,
        updateMaxHistoryMessages,
    };
}
