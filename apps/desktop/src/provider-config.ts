import type { RunningHubWorkflowRegistration } from "./runninghub-workflow";
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy";

export type DesktopProviderConfig = {
  readonly id?: string;
  readonly source?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly models?: readonly string[];
  readonly apiKey?: string;
  /** Opaque OS credential-store reference; only the desktop Host resolves it. */
  readonly credentialRef?: string;
  /** Independent choices when one account serves several model capabilities. */
  readonly capabilityModels?: CapabilityModelSelections;
  readonly reasoningEffort?: string;
  /** OpenCode provider request timeout in milliseconds; false disables it. */
  readonly timeout?: number | false;
  /** OpenCode streamed chunk timeout in milliseconds; false disables it. */
  readonly chunkTimeout?: number | false;
  readonly skillId?: string;
  readonly endpoint?: string;
  readonly queryEndpoint?: string;
  readonly workflowId?: string;
  readonly digitalHumanWorkflowId?: string;
  /** Optional account-owned workflow used by RunningHub video capabilities. */
  readonly videoEnhanceWorkflowId?: string;
  /** Account-owned RunningHub/ComfyUI workflows registered locally. */
  readonly workflows?: readonly RunningHubWorkflowRegistration[];
  readonly capabilities?: readonly ProviderCapability[];
};

export type ProviderCapability = "text" | "image" | "video" | "audio";
export type CapabilityModelSelections = Partial<Record<ProviderCapability, { readonly model?: string; readonly models: readonly string[] }>>;
export type DesktopProviderProfiles = Readonly<Record<string, DesktopProviderConfig>>;
export type DesktopProviderDefaults = Partial<Record<ProviderCapability, string>>;

export type ImportedProviderConfig = {
  readonly provider?: DesktopProviderConfig;
  readonly providers: DesktopProviderProfiles;
  readonly defaults?: DesktopProviderDefaults;
};

export function filterDeprecatedModelIds(values: readonly string[], capability: ProviderCapability = "text"): string[] {
  return [...new Set(values.map((model) => model.trim()).filter((model) => model && (capability !== "text" || !isDeprecatedTextModelId(model))))];
}

const providerStringFields = ["id", "source", "baseUrl", "model", "apiKey", "credentialRef", "reasoningEffort", "skillId", "endpoint", "queryEndpoint", "workflowId", "digitalHumanWorkflowId", "videoEnhanceWorkflowId"] as const;
const providerCapabilities = new Set<ProviderCapability>(["text", "image", "video", "audio"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseImportedProvider(value: unknown, fallbackId: string): DesktopProviderConfig {
  if (!isRecord(value)) throw new Error("provider_import_profile_invalid");
  for (const field of providerStringFields) {
    if (field in value && value[field] !== undefined && typeof value[field] !== "string") throw new Error(`provider_import_field_invalid:${field}`);
  }
  if ("models" in value && (!Array.isArray(value.models) || !value.models.every((model) => typeof model === "string"))) throw new Error("provider_import_models_invalid");
  if ("capabilityModels" in value && (!isRecord(value.capabilityModels) || Object.entries(value.capabilityModels).some(([capability, selection]) => !providerCapabilities.has(capability as ProviderCapability) || !isRecord(selection) || !Array.isArray(selection.models) || !selection.models.every((model) => typeof model === "string") || (selection.model !== undefined && typeof selection.model !== "string")))) throw new Error("provider_import_capability_models_invalid");
  if ("capabilities" in value && (!Array.isArray(value.capabilities) || !value.capabilities.every((capability) => typeof capability === "string" && providerCapabilities.has(capability as ProviderCapability)))) throw new Error("provider_import_capabilities_invalid");
  if ("workflows" in value && (!Array.isArray(value.workflows) || !value.workflows.every((workflow) => isRecord(workflow)
    && typeof workflow.id === "string" && workflow.id.trim()
    && typeof workflow.remoteWorkflowId === "string" && workflow.remoteWorkflowId.trim()
    && (!('capability' in workflow) || typeof workflow.capability === "string")
    && (!('version' in workflow) || typeof workflow.version === "number" || typeof workflow.version === "undefined")
    && (!('inputSchema' in workflow) || Array.isArray(workflow.inputSchema))
    && (!('nodeBindings' in workflow) || Array.isArray(workflow.nodeBindings))
    && (!('outputSchema' in workflow) || Array.isArray(workflow.outputSchema))))) throw new Error("provider_import_workflows_invalid");
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : fallbackId.trim();
  if (!id) throw new Error("provider_import_id_required");
  const imported = { ...value, id, ...(value.capabilityModels ? { capabilityModels: normalizeCapabilityModels(value.capabilityModels) } : {}) } as DesktopProviderConfig;
  if (imported.credentialRef) { const { apiKey: _apiKey, ...referenced } = imported; return referenced; }
  return imported;
}

export function parseProviderImport(value: unknown): ImportedProviderConfig {
  if (!isRecord(value)) throw new Error("provider_import_root_invalid");
  const importedProvider = value.provider === undefined ? undefined : parseImportedProvider(value.provider, "default");
  const rawProfiles = value.providers === undefined ? (importedProvider ? {} : value) : value.providers;
  if (!isRecord(rawProfiles)) throw new Error("provider_import_profiles_invalid");
  const providers = Object.fromEntries(Object.entries(rawProfiles).map(([id, profile]) => [id, parseImportedProvider(profile, id)]));
  const defaults = value.defaults === undefined ? undefined : (() => {
    if (!isRecord(value.defaults)) throw new Error("provider_import_defaults_invalid");
    const entries = Object.entries(value.defaults);
    if (entries.some(([capability, profileId]) => !providerCapabilities.has(capability as ProviderCapability) || typeof profileId !== "string" || !profileId.trim() || !providers[profileId])) throw new Error("provider_import_defaults_invalid");
    return Object.fromEntries(entries) as DesktopProviderDefaults;
  })();
  if (!importedProvider && !Object.keys(providers).length) throw new Error("provider_import_empty");
  return { ...(importedProvider ? { provider: importedProvider } : {}), providers, ...(defaults ? { defaults } : {}) };
}

type ProviderConfigContainer = {
  readonly provider: DesktopProviderConfig;
  readonly providers?: DesktopProviderProfiles;
  readonly defaults?: DesktopProviderDefaults;
};

export type ConfiguredTextModelOption = {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly providerId: string;
  readonly modelId: string;
};

/** Stable selector values must distinguish identical model IDs from different providers. */
export function configuredTextModelSelectionId(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

/** Show every configured model from every provider that can serve text. */
export function configuredTextModelOptions(config: ProviderConfigContainer): ConfiguredTextModelOption[] {
  return configuredProviderEntries(config).flatMap(([providerId, provider]) => {
    if (!supportsProviderCapability(provider, "text")) return [];
    const models = provider.capabilityModels?.text || provider.models !== undefined
      ? configuredModelOptions(provider, "text")
      : filterDeprecatedModelIds(provider.model?.trim() ? [provider.model.trim()] : []);
    return models.map((modelId) => ({
      id: configuredTextModelSelectionId(providerId, modelId),
      label: modelId,
      provider: providerId,
      providerId,
      modelId,
    }));
  });
}

/** Apply a text-model selection to both its provider profile and text default. */
export function selectConfiguredTextModel<T extends ProviderConfigContainer>(config: T, selectionId: string): T {
  let selection: unknown;
  try {
    selection = JSON.parse(selectionId);
  } catch {
    return config;
  }
  if (!Array.isArray(selection) || typeof selection[0] !== "string" || typeof selection[1] !== "string") return config;
  const [providerId, modelId] = selection;
  if (!configuredTextModelOptions(config).some((option) => option.id === selectionId)) return config;
  const profile = config.providers?.[providerId];
  if (profile) {
    return {
      ...config,
      defaults: { ...config.defaults, text: providerId },
      providers: { ...config.providers, [providerId]: setProviderCapabilityModel(profile, "text", modelId) },
    } as T;
  }
  const fallbackId = config.provider.id?.trim() || config.provider.source?.trim() || "default";
  if (providerId !== fallbackId) return config;
  return {
    ...config,
    defaults: { ...config.defaults, text: providerId },
    provider: setProviderCapabilityModel(config.provider, "text", modelId),
  } as T;
}

/** Include the legacy top-level provider in settings without duplicating profiles. */
export function configuredProviderEntries(config: ProviderConfigContainer): Array<[string, DesktopProviderConfig]> {
  const entries = Object.entries(config.providers ?? {});
  const fallbackSource = (config.provider.source ?? config.provider.id ?? "").trim().toLowerCase();
  const fallbackModel = config.provider.model?.trim() ?? "";
  const fallbackId = config.provider.id?.trim() || config.provider.source?.trim() || "default";
  if ((fallbackSource !== "local" || fallbackModel) && !entries.some(([id]) => id === fallbackId)) {
    entries.push([fallbackId, { ...config.provider, id: fallbackId }]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function isPptokenProvider(provider: DesktopProviderConfig): boolean {
  const source = (provider.source ?? provider.id ?? "").trim().toLowerCase();
  return source === "pptoken" || /(?:^|\/\/)api\.pptoken\.cc(?:\/|$)/iu.test(provider.baseUrl ?? "");
}

export type ResolvedDesktopProviderConfig = DesktopProviderConfig & { readonly id: string; readonly model: string };

/**
 * These IDs belonged to the development RunningHub account and must never be
 * treated as a desktop-wide default. Users must configure a workflow that is
 * visible to their own RunningHub API key.
 */
const DEVELOPMENT_RUNNINGHUB_WORKFLOW_IDS = new Set([
  "2019410250268418050",
  "2064172986302812162",
]);

export function isDevelopmentRunningHubWorkflowId(value: unknown): boolean {
  return typeof value === "string" && DEVELOPMENT_RUNNINGHUB_WORKFLOW_IDS.has(value.trim());
}

export function usableRunningHubWorkflowId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && !isDevelopmentRunningHubWorkflowId(normalized) ? normalized : undefined;
}

/** Keep configured provider models canonical across every desktop surface. */
export function configuredModelOptions(provider: DesktopProviderConfig, capability?: ProviderCapability): string[] {
  const models = capability && provider.capabilityModels?.[capability] ? provider.capabilityModels[capability]!.models : provider.models ?? [];
  return filterDeprecatedModelIds(models, capability ?? "text");
}

export function modelOptionsForProvider(config: ProviderConfigContainer, provider: DesktopProviderConfig, capability?: ProviderCapability): readonly string[] | undefined {
  if (capability && provider.capabilityModels?.[capability]) return configuredModelOptions(provider, capability);
  if (provider.models !== undefined) {
    const configured = configuredModelOptions(provider, capability);
    // Older persisted profiles may only have `model` and no model catalog.
    // Keep that active model selectable instead of rendering an empty menu.
    return configured.length ? configured : (provider.model?.trim() && ((capability !== undefined && capability !== "text") || !isDeprecatedTextModelId(provider.model)) ? [provider.model.trim()] : []);
  }
  const providerId = provider.id?.trim();
  const fallbackId = config.provider.id?.trim();
  if (!(provider === config.provider || (providerId && fallbackId && providerId === fallbackId))) return undefined;
  const configured = configuredModelOptions(config.provider, capability);
  return configured.length ? configured : (config.provider.model?.trim() && ((capability !== undefined && capability !== "text") || !isDeprecatedTextModelId(config.provider.model)) ? [config.provider.model.trim()] : []);
}

export function preferredConfiguredModel(provider: DesktopProviderConfig, capability?: ProviderCapability): string {
  const models = configuredModelOptions(provider, capability);
  const selected = (capability && provider.capabilityModels?.[capability] ? provider.capabilityModels[capability]!.model : provider.model)?.trim() ?? "";
  return models.includes(selected) ? selected : (models[0] ?? ((capability === undefined || capability === "text") && isDeprecatedTextModelId(selected) ? "" : selected));
}

export function providerForId(config: ProviderConfigContainer, providerId?: string | null, capability?: ProviderCapability): ResolvedDesktopProviderConfig {
  const id = providerId?.trim() ?? "";
  const selected = (id && config.providers?.[id]) || config.provider;
  const resolvedId = selected.id?.trim() || id || config.provider.id?.trim() || "local";
  const selection = capability ? selected.capabilityModels?.[capability] : undefined;
  if (capability && capability !== "text" && (selected.source ?? selected.id) === "cheapbuddy" && !selection) return { ...selected, id: resolvedId, model: "", models: [] };
  const resolvedModel = preferredConfiguredModel(selected, capability);
  if (!selection && selected.id === resolvedId && selected.model === resolvedModel) return selected as ResolvedDesktopProviderConfig;
  return {
    ...selected,
    id: resolvedId,
    model: resolvedModel,
    ...(selection ? { models: configuredModelOptions(selected, capability) } : {}),
  };
}

export function providerForCapability(config: ProviderConfigContainer, capability: ProviderCapability): ResolvedDesktopProviderConfig {
  const selectedId = config.defaults?.[capability];
  const selected = selectedId ? config.providers?.[selectedId] : undefined;
  if (selected && !supportsProviderCapability(selected, capability)) {
    const compatible = Object.entries(config.providers ?? {}).find(([id, provider]) => id !== selectedId && supportsProviderCapability(provider, capability));
    if (compatible) return providerForId(config, compatible[0], capability);
  }
  if (!selectedId) {
    const compatible = Object.entries(config.providers ?? {})
      .filter(([, provider]) => supportsProviderCapability(provider, capability))
      .sort(([left], [right]) => left.localeCompare(right))[0];
    if (compatible) return providerForId(config, compatible[0], capability);
  }
  return providerForId(config, selectedId, capability);
}

/** Normalize persisted capability catalogs without mixing media into text. */
export function normalizeCapabilityModels(value: unknown): CapabilityModelSelections | undefined {
  if (!isRecord(value)) return undefined;
  const result: CapabilityModelSelections = {};
  for (const capability of providerCapabilities) {
    const entry = value[capability];
    if (!isRecord(entry) || !Array.isArray(entry.models)) continue;
    const models = filterDeprecatedModelIds(entry.models.filter((model): model is string => typeof model === "string"), capability);
    const requested = typeof entry.model === "string" ? entry.model.trim() : "";
    result[capability] = { models, model: models.includes(requested) ? requested : models[0] ?? "" };
  }
  return Object.keys(result).length ? result : undefined;
}

export function setProviderCapabilityModels(provider: DesktopProviderConfig, capability: ProviderCapability, values: readonly string[], selected?: string): DesktopProviderConfig {
  const models = filterDeprecatedModelIds(values, capability);
  const requested = selected ?? provider.capabilityModels?.[capability]?.model ?? (capability === "text" ? provider.model : undefined);
  const model = requested && models.includes(requested) ? requested : models[0] ?? "";
  return { ...provider, capabilityModels: { ...provider.capabilityModels, [capability]: { models, model } }, ...(capability === "text" ? { models, model } : {}) };
}

export function setProviderCapabilityModel(provider: DesktopProviderConfig, capability: ProviderCapability, model: string): DesktopProviderConfig {
  if (!provider.capabilityModels) {
    const selected = capability === "text" && isDeprecatedTextModelId(model) ? configuredModelOptions(provider, capability)[0] ?? "" : model;
    return { ...provider, model: selected };
  }
  return setProviderCapabilityModels(provider, capability, provider.capabilityModels[capability]?.models ?? configuredModelOptions(provider, capability), model);
}

export function capabilityForWorkflowAction(action: string): ProviderCapability {
  if (action === "image_generate") return "image";
  if (["video_generate", "digital_human"].includes(action)) return "video";
  if (["music_generate", "voice_synthesis", "voice_clone", "audio_generate"].includes(action)) return "audio";
  return "text";
}

/**
 * Keep the settings capability defaults aligned with the runtime adapter
 * boundary. Explicit capabilities win; older profiles are inferred from
 * their source/model identity and unknown profiles remain selectable for
 * backwards compatibility.
 */
export function supportsProviderCapability(provider: DesktopProviderConfig, capability: ProviderCapability) {
  const explicit = Array.isArray(provider.capabilities)
    ? provider.capabilities.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  if (explicit.length) return explicit.includes(capability);
  const source = (provider.source ?? provider.id ?? "").trim().toLowerCase();
  if (source === "cheapbuddy") return capability === "text" || capability === "image" || capability === "video";
  if (isPptokenProvider(provider)) return capability === "text" || capability === "image";
  const identity = [provider.id, provider.model, provider.endpoint, provider.queryEndpoint]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/image|vision|text2image|images/iu.test(identity)) return capability === "image";
  if (/video|hailuo|seedance|wanx|digital[-_ ]?human/iu.test(identity)) return capability === "video";
  if (/audio|speech|music|voice|tts/iu.test(identity)) return capability === "audio";
  if (/text|chat|llm|language|gpt|deepseek|qwen|claude/iu.test(identity)) return capability === "text";
  if (source === "runninghub") return capability === "video";
  if (source === "minimax") return capability === "audio";
  if (source === "bailian" || source === "dashscope") return capability === "image";
  if (["openai", "openai-compatible", "siliconflow", "deepseek", "openrouter"].includes(source)) return capability === "text";
  return true;
}

export function supportsRunningHubWorkflowCapability(provider: DesktopProviderConfig, capability: string) {
  return provider.source?.trim().toLowerCase() === "runninghub"
    && provider.workflows?.some((workflow) => workflow.capability === capability) === true;
}

/**
 * Media needs a configured HTTP endpoint, but the default local text model is
 * intentionally not treated as a media provider. The settings UI keeps the
 * stable `local` id when a user switches the source to an OpenAI-compatible
 * endpoint, so source is the authoritative signal here.
 */
export function isMediaProviderConfigured(provider: DesktopProviderConfig) {
  if (!provider.baseUrl?.trim() || !provider.model?.trim()) return false;
  const source = (provider.source ?? provider.id ?? "").trim().toLowerCase();
  return source !== "" && source !== "local";
}

const mediaWorkflowActions = new Set([
  "image_generate",
  "video_generate",
  "digital_human",
  "music_generate",
  "voice_synthesis",
  "voice_clone",
  "audio_generate",
]);

export function requiresConfiguredProviderForWorkflowAction(action: string): boolean {
  return mediaWorkflowActions.has(action);
}
