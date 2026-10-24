export type ProviderSource = "local" | "openai-compatible" | "cheapbuddy";

export interface ProviderConfig {
  readonly id: string;
  readonly source: ProviderSource;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly reasoningEffort?: "low" | "medium" | "high";
}

export interface ProviderRequestConfig {
  readonly providerId: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly reasoningEffort?: "low" | "medium" | "high";
}

export function resolveProviderRequest(config: ProviderConfig): ProviderRequestConfig {
  const providerId = config.id.trim() || "local";
  const model = config.model.trim();
  if (!model) throw new Error("model_required");
  if ((config.source === "openai-compatible" || config.source === "cheapbuddy") && !config.baseUrl?.trim()) throw new Error("base_url_required");
  return { providerId, model, ...(config.baseUrl?.trim() ? { baseUrl: config.baseUrl.trim().replace(/\/$/u, "") } : {}), ...(config.apiKey ? { apiKey: config.apiKey } : {}), ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}) };
}

export function redactProviderConfig(config: ProviderConfig): Omit<ProviderConfig, "apiKey"> & { readonly apiKey?: string } {
  return { ...config, ...(config.apiKey ? { apiKey: "[REDACTED]" } : {}) };
}
