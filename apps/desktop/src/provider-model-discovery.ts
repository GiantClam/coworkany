import type { DesktopProviderConfig, ProviderCapability } from "./provider-config";

export type ProviderModelDiscoveryResult = {
  readonly models: readonly string[];
  readonly endpoint: string;
};

type ProviderModelDiscoveryFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ProviderModelDiscoveryInput = Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey"> & { readonly capability?: ProviderCapability };

const MAX_MODEL_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 2000;
const DASHSCOPE_CAPABILITY: Readonly<Record<ProviderCapability, string>> = {
  text: "TG",
  image: "IG",
  video: "VG",
  audio: "TTS",
};

function normalizedSource(provider: Pick<DesktopProviderConfig, "source" | "id">): string {
  return (provider.source ?? provider.id ?? "").trim().toLowerCase().replace(/[_\s]+/gu, "-");
}

function isOfficialGemini(provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl">): boolean {
  const source = normalizedSource(provider);
  const baseUrl = provider.baseUrl ?? "";
  return (source === "gemini" || source === "google") && /generativelanguage\.googleapis\.com/iu.test(baseUrl);
}

function isDashScope(provider: Pick<DesktopProviderConfig, "source" | "id">): boolean {
  return new Set(["qwen", "qwen-official", "bailian", "bailian-official", "dashscope"]).has(normalizedSource(provider));
}

function appendPath(base: URL, path: string): string {
  const next = new URL(base.toString());
  const basePath = next.pathname.replace(/\/+$/u, "");
  next.pathname = `${basePath}${path}`.replace(/\/\/+/gu, "/");
  next.search = "";
  next.hash = "";
  return next.toString();
}

function dashScopeAuthorizedModelsEndpoint(base: URL): string {
  const next = new URL(appendPath(base, "/api/v1/models/permissions"));
  next.searchParams.set("authorization_scope", "AUTHORIZED");
  next.searchParams.set("action", "INFERENCE");
  next.searchParams.set("page_no", "1");
  next.searchParams.set("page_size", "100");
  return next.toString();
}

function dashScopeModelsEndpoint(base: URL, capability: ProviderCapability | undefined): string {
  const next = new URL(appendPath(base, "/api/v1/models"));
  if (!capability) return next.toString();
  next.searchParams.set("capabilities", DASHSCOPE_CAPABILITY[capability]);
  next.searchParams.set("page_no", "1");
  next.searchParams.set("page_size", "100");
  return next.toString();
}

function parentPath(base: URL): URL {
  const next = new URL(base.toString());
  const segments = next.pathname.split("/").filter(Boolean);
  segments.pop();
  next.pathname = segments.length ? `/${segments.join("/")}` : "/";
  next.search = "";
  next.hash = "";
  return next;
}

function addCandidate(candidates: string[], value: string) {
  if (!candidates.includes(value)) candidates.push(value);
}

/**
 * Build endpoint candidates without assuming that the user entered either a
 * host root or an OpenAI `/v1` base URL. This covers the common Sub2API and
 * NewAPI layouts while keeping an explicitly configured `/models` URL intact.
 */
export function buildProviderModelEndpointCandidates(provider: Pick<ProviderModelDiscoveryInput, "source" | "id" | "baseUrl" | "capability">): readonly string[] {
  const rawBaseUrl = provider.baseUrl?.trim() ?? "";
  if (!rawBaseUrl) throw new Error("provider_base_url_required");
  let base: URL;
  try {
    base = new URL(rawBaseUrl);
  } catch {
    throw new Error("provider_base_url_invalid");
  }
  if (!/^https?:$/iu.test(base.protocol)) throw new Error("provider_base_url_protocol_unsupported");

  const candidates: string[] = [];
  const basePath = base.pathname.replace(/\/+$/u, "");
  if (/(?:^|\/)models$/iu.test(basePath)) addCandidate(candidates, base.toString());

  if (isOfficialGemini(provider)) {
    addCandidate(candidates, appendPath(base, "/models"));
  } else if (isDashScope(provider)) {
    // DashScope's model directory is rooted at /api/v1/models even when the
    // inference base URL is /compatible-mode/v1. The legacy DashScope domain
    // can reject that directory, but still exposes the caller's authorized
    // inference models through the permissions endpoint.
    const root = new URL(base.origin);
    addCandidate(candidates, dashScopeModelsEndpoint(root, provider.capability));
    addCandidate(candidates, dashScopeAuthorizedModelsEndpoint(root));
    addCandidate(candidates, appendPath(base, "/models"));
  } else {
    addCandidate(candidates, appendPath(base, "/models"));
    const parent = parentPath(base);
    addCandidate(candidates, appendPath(parent, "/models"));
    if (!/\/v\d+(?:\.\d+)?$/iu.test(basePath)) addCandidate(candidates, appendPath(base, "/v1/models"));
  }
  return candidates;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function modelIdFromRecord(value: Record<string, unknown>, provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl">): string | undefined {
  if (isOfficialGemini(provider)) {
    return textValue(value.baseModelId) ?? textValue(value.id) ?? textValue(value.name)?.replace(/^models\//u, "");
  }
  return textValue(value.id) ?? textValue(value.model) ?? textValue(value.model_id) ?? textValue(value.modelId) ?? textValue(value.name);
}

function capabilityValues(value: Record<string, unknown>): readonly string[] {
  const raw = value.capabilities ?? value.capability ?? value.modalities ?? value.modality;
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function modelSupportsCapability(item: unknown, provider: ProviderModelDiscoveryInput, endpoint: string): boolean {
  const capability = provider.capability;
  if (!capability || capability === "text") return true;
  const expected = DASHSCOPE_CAPABILITY[capability];
  const declared = item && typeof item === "object" ? capabilityValues(item as Record<string, unknown>) : [];
  if (declared.length) {
    if (capability === "audio") return declared.some((value) => ["TTS", "ASR", "AUDIO", "MUSIC", "REALTIME-TEXT-TO-SPEECH", "REALTIME-ASR"].includes(value));
    return declared.includes(expected);
  }
  // The DashScope model-directory request is capability-filtered server-side.
  // Do not trust its unfiltered permissions fallback for media configuration.
  try {
    return isDashScope(provider) && new URL(endpoint).searchParams.getAll("capabilities").includes(expected);
  } catch {
    return false;
  }
}

function modelItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const envelopes = [record];
  if (record.output && typeof record.output === "object" && !Array.isArray(record.output)) {
    envelopes.push(record.output as Record<string, unknown>);
  }
  for (const envelope of envelopes) {
    for (const key of ["data", "models", "items", "results", "permissions"]) {
      const nested = envelope[key];
      if (Array.isArray(nested)) return nested;
      if (nested && typeof nested === "object") return Object.values(nested as Record<string, unknown>);
    }
  }
  return [];
}

/** Normalize OpenAI, Gemini, DashScope, and common proxy response envelopes. */
export function normalizeProviderModelResponse(value: unknown, provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl">): readonly string[] {
  const models: string[] = [];
  for (const item of modelItems(value)) {
    const model = typeof item === "string" ? item.trim() : item && typeof item === "object" ? modelIdFromRecord(item as Record<string, unknown>, provider) : undefined;
    if (model && !models.includes(model)) models.push(model);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function normalizeProviderModelsForCapability(value: unknown, provider: ProviderModelDiscoveryInput, endpoint: string): readonly string[] {
  const models: string[] = [];
  for (const item of modelItems(value)) {
    if (!modelSupportsCapability(item, provider, endpoint)) continue;
    const model = typeof item === "string" ? item.trim() : item && typeof item === "object" ? modelIdFromRecord(item as Record<string, unknown>, provider) : undefined;
    if (model && !models.includes(model)) models.push(model);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function requestHeaders(provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey">): Record<string, string> {
  const apiKey = provider.apiKey?.trim();
  if (!apiKey) return { accept: "application/json" };
  if (isOfficialGemini(provider)) return { accept: "application/json", "x-goog-api-key": apiKey };
  return { accept: "application/json", authorization: `Bearer ${apiKey}` };
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_MODEL_RESPONSE_BYTES) throw new Error("provider_model_list_response_too_large");
  try { return JSON.parse(body) as unknown; } catch { throw new Error("provider_model_list_invalid_json"); }
}

export async function discoverProviderModels(
  provider: ProviderModelDiscoveryInput,
  fetchImpl: ProviderModelDiscoveryFetch = fetch,
  signal?: AbortSignal,
): Promise<ProviderModelDiscoveryResult> {
  const endpoints = buildProviderModelEndpointCandidates(provider);
  let lastError = "provider_model_list_unavailable";
  for (const endpoint of endpoints) {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, { method: "GET", headers: requestHeaders(provider), signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = "provider_model_list_network_error";
      continue;
    }
    if (!response.ok) {
      lastError = `provider_model_list_http_${response.status}`;
      continue;
    }
    const models = normalizeProviderModelsForCapability(await readJson(response), provider, endpoint);
    if (models.length) return { models, endpoint };
    lastError = "provider_model_list_empty";
  }
  throw new Error(lastError);
}
