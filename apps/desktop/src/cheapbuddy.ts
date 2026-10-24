import { setProviderCapabilityModels, type DesktopProviderConfig, type DesktopProviderDefaults, type DesktopProviderProfiles } from "./provider-config";

/** Built into the desktop; no remote Provider manifest is fetched. */
export const CHEAPBUDDY = {
  id: "cheapbuddy",
  name: "CheapBuddy",
  apiBaseUrl: "https://api.cheapbuddy.cc/v1",
  accountApiBaseUrl: "https://cheapbuddy.cc/api/v1",
  purchaseUrl: "https://cheapbuddy.cc/#pricing",
  preferredTextModel: "glm-5.3",
} as const;

export function createCheapBuddyProvider(): DesktopProviderConfig & { readonly model: string } {
  return {
    id: CHEAPBUDDY.id,
    source: CHEAPBUDDY.id,
    baseUrl: CHEAPBUDDY.apiBaseUrl,
    model: "",
    models: [],
    capabilities: ["text", "image", "video"],
    capabilityModels: { text: { model: "", models: [] }, image: { model: "", models: [] }, video: { model: "", models: [] } },
  };
}

type CheapBuddyConfig = { readonly provider: DesktopProviderConfig; readonly providers?: DesktopProviderProfiles; readonly defaults?: DesktopProviderDefaults };

/** Replace the account catalog while retaining valid local model choices and explicit defaults. */
export function mergeCheapBuddyProvider<T extends CheapBuddyConfig>(config: T, provider: DesktopProviderConfig, options: { readonly selectAsDefault?: boolean } = {}): T {
  const existing = config.providers?.[CHEAPBUDDY.id] ?? (config.provider.id === CHEAPBUDDY.id ? config.provider : undefined);
  let merged: DesktopProviderConfig = { ...provider, id: CHEAPBUDDY.id, source: CHEAPBUDDY.id, baseUrl: CHEAPBUDDY.apiBaseUrl };
  for (const capability of ["text", "image", "video"] as const) {
    const selection = provider.capabilityModels?.[capability];
    if (selection) merged = setProviderCapabilityModels(merged, capability, selection.models, existing?.capabilityModels?.[capability]?.model ?? (capability === "text" ? existing?.model : undefined) ?? selection.model);
  }
  // Resolved credentials never become portable or backed-up config data.
  if (merged.credentialRef) { const safe = { ...merged }; delete safe.apiKey; merged = safe; }
  const defaults = { ...config.defaults };
  const builtIn = config.provider.id === CHEAPBUDDY.id;
  for (const capability of ["text", "image", "video"] as const) {
    if (options.selectAsDefault || (!defaults[capability] && builtIn)) defaults[capability] = CHEAPBUDDY.id;
  }
  const useTopLevel = config.provider.id === CHEAPBUDDY.id || options.selectAsDefault || (builtIn && (!defaults.text || defaults.text === CHEAPBUDDY.id));
  return { ...config, ...(useTopLevel ? { provider: { ...merged, model: merged.model ?? "" } } : {}), providers: { ...config.providers, [CHEAPBUDDY.id]: merged }, defaults } as T;
}
