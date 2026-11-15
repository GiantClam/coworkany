import { createOpenAI } from "@ai-sdk/openai"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export type AiEntryProviderId =
  | "deepseek"
  | "pptoken"
  | "openrouter"
  | "aiberm"
  | "crazyroute"
  | "enterprise-openai-compatible"
  | "enterprise-qwen-official"
  | "enterprise-minimax-official"
  | "enterprise-glm-official"
  | "enterprise-volcengine-official"
  | "desktop-configured"

export type AiEntryProviderConfig = {
  id: AiEntryProviderId
  apiKey: string
  baseURL: string
  model: string
  headers?: Record<string, string>
}

type AiEntryProviderRuntime = {
  id: AiEntryProviderId
  model: string
  baseURL: string
  provider: ReturnType<typeof createOpenAI>
  stateIndex: number
}

type AiEntryProviderRoutingState = {
  activeIndex: number
  degradedAccessCount: number
}

type AiEntryExecutionError = {
  aiEntryRetryable?: boolean
}

type ExecuteAiEntryProviderParams = {
  provider: ReturnType<typeof createOpenAI>
  providerId: AiEntryProviderId
  model: string
  baseURL: string
  providerOrder: AiEntryProviderId[]
  attempt: number
  upgradeProbe: boolean
  fallbackReason?: AiEntryProviderFallbackReason
}

export type AiEntryProviderFallbackReason =
  | "empty_response"
  | "timeout"
  | "connection"
  | "rate_limit"
  | "provider_error"

type ExecuteAiEntryOptions = {
  preferredProviderId?: AiEntryProviderId | null
  preferredModel?: string | null
  forcePreferredProvider?: boolean
  disableProviderFailover?: boolean
  forceModelAcrossProviders?: boolean
  disableSameProviderModelFallback?: boolean
  directProviderFailoverOnError?: boolean
  providerConfigs?: AiEntryProviderConfig[]
}

type GlobalWithAiEntryRoutingState = typeof globalThis & {
  __aiEntryProviderRoutingStateV1__?: AiEntryProviderRoutingState
  __aiEntryProviderModelListCacheV1__?: Record<string, AiEntryProviderModelCacheEntry>
}

type AiEntryProviderModelCacheEntry = {
  expiresAt: number
  modelIds: string[]
}

type ProviderModelsApiItem = {
  id?: unknown
}

type ProviderModelsApiResponse = {
  data?: ProviderModelsApiItem[]
  models?: ProviderModelsApiItem[]
}

const DEFAULT_AIBERM_BASE_URL = "https://aiberm.com/v1"
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
const DEFAULT_PPTOKEN_BASE_URL = "https://api.pptoken.org/v1"
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_MODEL = "deepseek-v4-pro"
const DEFAULT_PPTOKEN_MODEL = "gpt-6.1-sol"
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-pro"
const PROVIDER_MODEL_LIST_CACHE_TTL_MS = parsePositiveInt(
  process.env.AI_ENTRY_PROVIDER_MODEL_LIST_CACHE_TTL_MS,
  30 * 60 * 1000,
)
const PROVIDER_MODEL_LIST_TIMEOUT_MS = parsePositiveInt(
  process.env.AI_ENTRY_PROVIDER_MODEL_LIST_TIMEOUT_MS,
  6000,
)
const MAX_PROVIDER_MODEL_CANDIDATES = parsePositiveInt(
  process.env.AI_ENTRY_PROVIDER_MODEL_CANDIDATE_LIMIT,
  4,
)
const UPGRADE_AFTER_ACCESS = parsePositiveInt(
  process.env.AI_ENTRY_PROVIDER_UPGRADE_AFTER,
  10,
)

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number.parseInt(raw || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeText(raw: unknown) {
  if (typeof raw !== "string") return ""
  const trimmed = raw.trim()
  if (!trimmed) return ""

  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/)
  return quoted ? quoted[2].trim() : trimmed
}

function createProviderFetch() {
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const headers = new Headers(init?.headers)
    const requestedReasoning = headers.get("x-ai-entry-reasoning-effort")
    if (!requestedReasoning) return fetch(input, init)

    headers.delete("x-ai-entry-reasoning-effort")
    if (typeof init?.body !== "string") {
      return fetch(input, { ...init, headers })
    }

    try {
      const body = JSON.parse(init.body) as Record<string, unknown>
      const model = typeof body.model === "string" ? body.model.toLowerCase() : ""
      if (model.includes("deepseek")) {
        if (requestedReasoning === "none") {
          body.thinking = { type: "disabled" }
          delete body.reasoning_effort
        } else if (requestedReasoning === "max") {
          body.thinking = { type: "enabled" }
          body.reasoning_effort = "max"
        }
      }
      return fetch(input, { ...init, headers, body: JSON.stringify(body) })
    } catch {
      return fetch(input, { ...init, headers })
    }
  }
}

function canonicalModelFingerprint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function stripProviderPrefix(modelId: string) {
  const normalized = normalizeText(modelId)
  if (!normalized) return ""
  const slashIndex = normalized.indexOf("/")
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) return normalized
  return normalized.slice(slashIndex + 1).trim()
}

function inferProviderPrefixFromModel(modelId: string) {
  const text = `${modelId} ${stripProviderPrefix(modelId)}`.toLowerCase()
  if (text.includes("claude") || text.includes("anthropic")) return "anthropic"
  if (
    text.includes("gpt") ||
    text.includes("chatgpt") ||
    text.includes("openai") ||
    /\bo[1345]\b/.test(text)
  ) {
    return "openai"
  }
  if (text.includes("gemini") || text.includes("google")) return "google"
  if (text.includes("deepseek")) return "deepseek"
  if (text.includes("qwen") || text.includes("qwq")) return "qwen"
  if (text.includes("minimax") || text.includes("abab")) return "minimax"
  if (text.includes("glm") || text.includes("chatglm") || text.includes("zhipu")) return "zhipu"
  if (text.includes("kimi") || text.includes("moonshot")) return "moonshot"
  return ""
}

function isOpenAiFamilyModel(modelId: string) {
  return inferProviderPrefixFromModel(modelId) === "openai"
}

function isGrokModel(modelId: string) {
  return /(?:^|\/)grok[-_.]4[-_.]5$/iu.test(modelId.trim())
}

function isPptokenRoutingModel(modelId: string) {
  if (isOpenAiFamilyModel(modelId)) return true

  // pptoken exposes Grok 4.5 through the same OpenAI-compatible endpoint.
  return (
    isGrokModel(modelId) ||
    canonicalModelFingerprint(stripProviderPrefix(modelId)) === "grok45"
  )
}

function buildEquivalentModelVariants(modelId: string) {
  const raw = normalizeText(modelId)
  if (!raw) return []
  const base = stripProviderPrefix(raw)

  const variants = new Set<string>()
  const add = (value: string) => {
    const normalized = normalizeText(value)
    if (!normalized) return
    variants.add(normalized)
  }

  add(raw)
  add(base)

  const baseDotVariant = base.replace(/(\d)-(\d)/g, "$1.$2")
  const baseDashVariant = base.replace(/(\d)\.(\d)/g, "$1-$2")
  add(baseDotVariant)
  add(baseDashVariant)

  const rawDotVariant = raw.replace(/(\d)-(\d)/g, "$1.$2")
  const rawDashVariant = raw.replace(/(\d)\.(\d)/g, "$1-$2")
  add(rawDotVariant)
  add(rawDashVariant)

  const inferredPrefix = inferProviderPrefixFromModel(raw)
  if (inferredPrefix) {
    add(`${inferredPrefix}/${base}`)
    add(`${inferredPrefix}/${baseDotVariant}`)
    add(`${inferredPrefix}/${baseDashVariant}`)
  }

  return [...variants]
}

function compareModelCandidatePreference(
  providerId: AiEntryProviderId,
  a: string,
  b: string,
) {
  const aHasPrefix = a.includes("/")
  const bHasPrefix = b.includes("/")
  if (aHasPrefix !== bHasPrefix) return aHasPrefix ? 1 : -1

  if (a.length !== b.length) return a.length - b.length
  return a.localeCompare(b, "en", { sensitivity: "base" })
}

function buildProviderModelCandidates(
  providerId: AiEntryProviderId,
  preferredModel: string,
) {
  const variants = buildEquivalentModelVariants(preferredModel)
  const dedupeByFingerprint = new Map<string, string>()
  for (const variant of variants) {
    const key = canonicalModelFingerprint(variant)
    if (!dedupeByFingerprint.has(key)) {
      dedupeByFingerprint.set(key, variant)
    }
  }

  const candidates = [...dedupeByFingerprint.values()]
  candidates.sort((a, b) => compareModelCandidatePreference(providerId, a, b))
  return candidates
}

function dedupeStringList(values: string[]) {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeText(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function getProviderModelListCache() {
  const globalScope = globalThis as GlobalWithAiEntryRoutingState
  if (!globalScope.__aiEntryProviderModelListCacheV1__) {
    globalScope.__aiEntryProviderModelListCacheV1__ = {}
  }
  return globalScope.__aiEntryProviderModelListCacheV1__
}

function buildProviderModelCacheKey(config: AiEntryProviderConfig) {
  return `${config.id}:${config.baseURL}`
}

async function fetchProviderModelIds(config: AiEntryProviderConfig) {
  const baseURL = config.baseURL.replace(/\/+$/u, "")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_MODEL_LIST_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      cache: "no-store",
      signal: controller.signal,
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => "")
      throw new Error(`provider_models_http_${response.status}:${raw.slice(0, 120)}`)
    }

    const payload =
      (await response.json().catch(() => null)) as ProviderModelsApiResponse | null
    const rawItems = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []

    const ids = rawItems
      .map((item) => normalizeText(item?.id))
      .filter(Boolean)

    return dedupeStringList(ids)
  } finally {
    clearTimeout(timeout)
  }
}

async function getProviderModelIds(config: AiEntryProviderConfig) {
  const cache = getProviderModelListCache()
  const cacheKey = buildProviderModelCacheKey(config)
  const now = Date.now()
  const cached = cache[cacheKey]
  if (cached && cached.expiresAt > now) {
    return cached.modelIds
  }

  try {
    const fetched = await fetchProviderModelIds(config)
    cache[cacheKey] = {
      expiresAt: now + PROVIDER_MODEL_LIST_CACHE_TTL_MS,
      modelIds: fetched,
    }
    return fetched
  } catch (error) {
    if (cached?.modelIds?.length) {
      console.warn("ai-entry.provider.models.fetch.failed.stale", {
        provider: config.id,
        message: error instanceof Error ? error.message : String(error),
      })
      return cached.modelIds
    }
    throw error
  }
}

function buildModelFingerprints(modelId: string) {
  const raw = normalizeText(modelId)
  if (!raw) return []
  const base = stripProviderPrefix(raw)
  const values = [raw, base]
  return dedupeStringList(values.map((item) => canonicalModelFingerprint(item)))
}

function scoreModelCandidate(
  providerId: AiEntryProviderId,
  candidateModel: string,
  preferredModel: string,
) {
  const candidate = normalizeText(candidateModel)
  const preferred = normalizeText(preferredModel)
  if (!candidate || !preferred) return Number.NEGATIVE_INFINITY

  const candidateBase = stripProviderPrefix(candidate)
  const preferredBase = stripProviderPrefix(preferred)
  const candidateFingerprint = canonicalModelFingerprint(candidate)
  const preferredFingerprint = canonicalModelFingerprint(preferred)
  const candidateBaseFingerprint = canonicalModelFingerprint(candidateBase)
  const preferredBaseFingerprint = canonicalModelFingerprint(preferredBase)

  let score = 0
  if (candidate === preferred) score += 120
  if (candidateBase === preferredBase) score += 140
  if (candidateFingerprint === preferredFingerprint) score += 160
  if (candidateBaseFingerprint === preferredBaseFingerprint) score += 180
  if (!candidate.includes("/")) score += 10

  return score
}

async function resolveProviderMatchedModels(
  config: AiEntryProviderConfig,
  preferredModel: string,
) {
  let providerModelIds: string[]
  try {
    providerModelIds = await getProviderModelIds(config)
  } catch (error) {
    console.warn("ai-entry.provider.models.fetch.failed", {
      provider: config.id,
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  if (providerModelIds.length === 0) return []

  const preferredFingerprints = new Set<string>()
  for (const variant of buildEquivalentModelVariants(preferredModel)) {
    for (const fingerprint of buildModelFingerprints(variant)) {
      preferredFingerprints.add(fingerprint)
    }
  }

  const scored = providerModelIds
    .map((candidateModel) => {
      const fingerprints = buildModelFingerprints(candidateModel)
      const fuzzyMatched = fingerprints.some((item) => preferredFingerprints.has(item))
      if (!fuzzyMatched) {
        return {
          model: candidateModel,
          score: Number.NEGATIVE_INFINITY,
        }
      }
      return {
        model: candidateModel,
        score: scoreModelCandidate(config.id, candidateModel, preferredModel),
      }
    })
    .filter((item) => Number.isFinite(item.score))

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return compareModelCandidatePreference(config.id, a.model, b.model)
  })

  return dedupeStringList(
    scored.slice(0, MAX_PROVIDER_MODEL_CANDIDATES).map((item) => item.model),
  )
}

function isProviderPolicyError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeStatus = (error as { statusCode?: unknown }).statusCode
  if (typeof maybeStatus === "number" && maybeStatus === 403) return true

  const message =
    (error as { message?: unknown }).message ||
    (error as { responseBody?: unknown }).responseBody
  const normalized = String(message || "").toLowerCase()
  if (!normalized) return false

  return (
    normalized.includes("terms of service") ||
    normalized.includes("prohibited") ||
    normalized.includes("policy")
  )
}

function resolveDegradeReason(error: unknown): "policy" | "retryable" | "nonretryable" {
  if (isProviderPolicyError(error)) return "policy"
  return isRetryableProviderError(error) ? "retryable" : "nonretryable"
}

function resolveProviderFallbackReason(error: unknown): AiEntryProviderFallbackReason {
  const message = error instanceof Error ? error.message : String(error || "")
  const normalized = message.toLowerCase()
  if (normalized.includes("empty") || normalized.includes("no content")) return "empty_response"
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("deadline")) return "timeout"
  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("too many requests")) return "rate_limit"
  if (normalized.includes("connect") || normalized.includes("network") || normalized.includes("econn") || normalized.includes("socket")) return "connection"
  return "provider_error"
}

function isRetryableProviderError(error: unknown) {
  return (error as AiEntryExecutionError | null | undefined)?.aiEntryRetryable !== false
}

function getRoutingState() {
  const globalScope = globalThis as GlobalWithAiEntryRoutingState
  if (!globalScope.__aiEntryProviderRoutingStateV1__) {
    globalScope.__aiEntryProviderRoutingStateV1__ = {
      activeIndex: 0,
      degradedAccessCount: 0,
    }
  }
  return globalScope.__aiEntryProviderRoutingStateV1__
}

function clampIndex(index: number, max: number) {
  return Math.min(Math.max(0, index), max)
}

function uniqueProviderOrder(providers: AiEntryProviderRuntime[]) {
  const order: AiEntryProviderId[] = []
  const seen = new Set<AiEntryProviderId>()
  for (const item of providers) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    order.push(item.id)
  }
  return order
}

function findRuntimeStartIndexByStateIndex(
  providers: AiEntryProviderRuntime[],
  stateIndex: number,
) {
  const exact = providers.findIndex((item) => item.stateIndex === stateIndex)
  if (exact >= 0) return exact

  const greater = providers.findIndex((item) => item.stateIndex > stateIndex)
  if (greater >= 0) return greater

  return 0
}

function findNextRuntimeIndex(params: {
  providers: AiEntryProviderRuntime[]
  currentIndex: number
  visited: Set<number>
  skipSameProvider: boolean
}) {
  const { providers, currentIndex, visited, skipSameProvider } = params
  if (providers.length === 0) return -1
  const currentProviderId = providers[currentIndex]?.id

  for (let offset = 1; offset <= providers.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % providers.length
    if (visited.has(nextIndex)) continue
    if (skipSameProvider && providers[nextIndex]?.id === currentProviderId) continue
    return nextIndex
  }

  return -1
}

function getAiEntryDefaultModel() {
  return (
    normalizeText(process.env.AI_ENTRY_NORMAL_DEFAULT_MODEL) ||
    normalizeText(process.env.AI_ENTRY_MODEL) ||
    normalizeText(process.env.WRITER_TEXT_MODEL) ||
    DEFAULT_MODEL
  )
}

function getRawProviderConfigs(): AiEntryProviderConfig[] {
  const fallbackModel = getAiEntryDefaultModel()
  const openrouterEnabled =
    normalizeText(process.env.AI_ENTRY_OPENROUTER_ENABLED).toLowerCase() === "true" ||
    Boolean(normalizeText(process.env.AI_ENTRY_OPENROUTER_API_KEY)) ||
    Boolean(normalizeText(process.env.AI_ENTRY_OPENROUTER_MODEL))

  return [
    {
      id: "deepseek",
      apiKey:
        normalizeText(process.env.AI_ENTRY_DEEPSEEK_API_KEY) ||
        normalizeText(process.env.DEEPSEEK_API_KEY),
      baseURL:
        normalizeText(process.env.AI_ENTRY_DEEPSEEK_BASE_URL) ||
        normalizeText(process.env.DEEPSEEK_BASE_URL) ||
        DEFAULT_DEEPSEEK_BASE_URL,
      model:
        normalizeText(process.env.AI_ENTRY_DEEPSEEK_MODEL) ||
        normalizeText(process.env.DEEPSEEK_MODEL) ||
        fallbackModel,
    },
    {
      id: "pptoken",
      apiKey:
        normalizeText(process.env.AI_ENTRY_PPTOKEN_API_KEY) ||
        normalizeText(process.env.PPTOKEN_API_KEY),
      baseURL:
        normalizeText(process.env.AI_ENTRY_PPTOKEN_BASE_URL) ||
        normalizeText(process.env.PPTOKEN_BASE_URL) ||
        DEFAULT_PPTOKEN_BASE_URL,
      model:
        normalizeText(process.env.AI_ENTRY_PPTOKEN_MODEL) ||
        normalizeText(process.env.PPTOKEN_MODEL) ||
        DEFAULT_PPTOKEN_MODEL,
    },
    {
      id: "openrouter",
      apiKey:
        normalizeText(process.env.AI_ENTRY_OPENROUTER_API_KEY) ||
        (openrouterEnabled ? normalizeText(process.env.OPENROUTER_API_KEY) : ""),
      baseURL:
        normalizeText(process.env.AI_ENTRY_OPENROUTER_BASE_URL) ||
        normalizeText(process.env.OPENROUTER_BASE_URL) ||
        DEFAULT_OPENROUTER_BASE_URL,
      model:
        normalizeText(process.env.AI_ENTRY_OPENROUTER_MODEL) ||
        normalizeText(process.env.OPENROUTER_TEXT_MODEL) ||
        DEFAULT_OPENROUTER_MODEL,
    },
    {
      id: "aiberm",
      apiKey:
        normalizeText(process.env.AI_ENTRY_AIBERM_API_KEY) ||
        normalizeText(process.env.AIBERM_API_KEY) ||
        normalizeText(process.env.WRITER_AIBERM_API_KEY),
      baseURL:
        normalizeText(process.env.AI_ENTRY_AIBERM_BASE_URL) ||
        normalizeText(process.env.AIBERM_BASE_URL) ||
        DEFAULT_AIBERM_BASE_URL,
      model: normalizeText(process.env.AI_ENTRY_AIBERM_MODEL) || fallbackModel,
    },
    {
      id: "crazyroute",
      apiKey:
        normalizeText(process.env.AI_ENTRY_CRAZYROUTE_API_KEY) ||
        normalizeText(process.env.CRAZYROUTE_API_KEY) ||
        normalizeText(process.env.AI_ENTRY_CRAZYROUTER_API_KEY) ||
        normalizeText(process.env.CRAZYROUTER_API_KEY),
      baseURL:
        normalizeText(process.env.AI_ENTRY_CRAZYROUTE_BASE_URL) ||
        normalizeText(process.env.CRAZYROUTE_BASE_URL) ||
        normalizeText(process.env.AI_ENTRY_CRAZYROUTER_BASE_URL) ||
        normalizeText(process.env.CRAZYROUTER_BASE_URL),
      model:
        normalizeText(process.env.AI_ENTRY_CRAZYROUTE_MODEL) ||
        normalizeText(process.env.AI_ENTRY_CRAZYROUTER_MODEL) ||
        normalizeText(process.env.CRAZYROUTER_MODEL) ||
        fallbackModel,
    },
  ]
}

export function getConfiguredAiEntryProviders() {
  return getRawProviderConfigs().filter((item) => item.apiKey && item.baseURL)
}

function isPptokenGrokModel(modelId: string) {
  const normalized = normalizeText(modelId).replace(/^pptoken\//iu, "").replace(/^x-ai\//iu, "")
  return /^grok(?:[-_.]|$)/iu.test(normalized)
}

/**
 * Resolve credentials for the exact provider/model pair.
 *
 * PPToken uses separate accounts for GPT and Grok. Keep the existing
 * PPTOKEN_API_KEY as the GPT/default account and require a dedicated Grok
 * credential for Grok models so a GPT account can never be sent a Grok
 * request by accident.
 */
export function getConfiguredAiEntryProviderForModel(
  providerId: string,
  modelId: string,
): AiEntryProviderConfig | null {
  const normalizedProviderId = normalizeText(providerId).toLowerCase()
  const normalizedModelId = normalizeText(modelId)
  if (normalizedModelId && isDeprecatedTextModelId(normalizedModelId)) return null
  const provider = getRawProviderConfigs().find((item) => item.id === normalizedProviderId)
  if (!provider) return null

  if (isDeprecatedTextModelId(provider.model)) return null

  if (normalizedProviderId !== "pptoken" || !isPptokenGrokModel(normalizedModelId)) {
    return provider.apiKey && provider.baseURL ? provider : null
  }

  const grokApiKey =
    normalizeText(process.env.AI_ENTRY_PPTOKEN_GROK_API_KEY) ||
    normalizeText(process.env.PPTOKEN_GROK_API_KEY)
  if (!grokApiKey) return null

  const grokBaseURL =
    normalizeText(process.env.AI_ENTRY_PPTOKEN_GROK_BASE_URL) ||
    normalizeText(process.env.PPTOKEN_GROK_BASE_URL) ||
    provider.baseURL

  return {
    ...provider,
    apiKey: grokApiKey,
    baseURL: grokBaseURL,
    model: normalizedModelId || provider.model,
  }
}

export function resolveAiEntryOpenCodeProvider(input: {
  providerId?: string | null
  modelId?: string | null
} = {}) {
  const requestedProviderId = normalizeText(input.providerId).toLowerCase()
  const requestedModelId = normalizeText(input.modelId)
  if (requestedModelId && isDeprecatedTextModelId(requestedModelId)) return null
  const provider = requestedProviderId
    ? getConfiguredAiEntryProviderForModel(requestedProviderId, requestedModelId)
    : getConfiguredAiEntryProviders().find(
        (item) => !isDeprecatedTextModelId(item.model),
      ) || null
  if (!provider) return null
  if (isDeprecatedTextModelId(provider.model)) return null

  return {
    providerId: provider.id,
    modelId: requestedModelId || provider.model,
    baseUrl: provider.baseURL,
    apiKey: provider.apiKey,
  }
}

export function getAiEntryCurrentProviderConfig() {
  const providers = getConfiguredAiEntryProviders().filter(
    (provider) => !isDeprecatedTextModelId(provider.model),
  )
  if (providers.length === 0) return null
  const state = getRoutingState()
  const index = clampIndex(state.activeIndex, providers.length - 1)
  return providers[index]
}

async function buildProviderRuntimes(
  options?: ExecuteAiEntryOptions,
): Promise<AiEntryProviderRuntime[]> {
  const preferredProviderId = options?.preferredProviderId || null
  const preferredModel = normalizeText(options?.preferredModel || undefined)
  if (preferredModel && isDeprecatedTextModelId(preferredModel)) {
    throw new Error("deprecated_text_model_unavailable")
  }
  const forcePreferredProvider = Boolean(options?.forcePreferredProvider && preferredProviderId)
  const disableProviderFailover = Boolean(options?.disableProviderFailover)
  const forceModelAcrossProviders = Boolean(
    options?.forceModelAcrossProviders && preferredModel,
  )
  const disableSameProviderModelFallback = Boolean(
    options?.disableSameProviderModelFallback,
  )

  const explicitProviderConfigs =
    Array.isArray(options?.providerConfigs) && options.providerConfigs.length > 0
      ? options.providerConfigs.filter((item) => item.apiKey && item.baseURL)
      : null

  let configs = (explicitProviderConfigs || getConfiguredAiEntryProviders()).filter(
    (item) => !isDeprecatedTextModelId(item.model),
  )
  if (configs.length === 0) return []

  const routingModel = preferredModel || getAiEntryDefaultModel()
  const allowPptoken = isPptokenRoutingModel(routingModel)
  const allowOpenrouter = preferredProviderId === "openrouter"
  configs = configs.filter((item) =>
    (allowPptoken || item.id !== "pptoken") && (allowOpenrouter || item.id !== "openrouter"),
  )
  if (configs.length === 0) return []

  if (preferredProviderId) {
    const preferred = configs.find((item) => item.id === preferredProviderId)
    if (preferred) {
      if (forcePreferredProvider) {
        configs = [preferred]
      } else {
        configs = [preferred, ...configs.filter((item) => item.id !== preferredProviderId)]
      }
    }
  }

  if (!explicitProviderConfigs) {
    const defaultOrder: AiEntryProviderId[] = allowPptoken
      ? ["pptoken", "deepseek", "aiberm", "crazyroute", "openrouter"]
      : ["deepseek", "aiberm", "crazyroute", "openrouter"]
    configs.sort((a, b) => {
      const aRank = defaultOrder.indexOf(a.id)
      const bRank = defaultOrder.indexOf(b.id)
      const normalizedARank = aRank === -1 ? defaultOrder.length : aRank
      const normalizedBRank = bRank === -1 ? defaultOrder.length : bRank
      return normalizedARank - normalizedBRank
    })
    if (preferredProviderId && !forcePreferredProvider) {
      const preferred = configs.find((item) => item.id === preferredProviderId)
      if (preferred) {
        configs = [preferred, ...configs.filter((item) => item.id !== preferredProviderId)]
      }
    }
  }

  if (disableProviderFailover) {
    if (preferredProviderId && !configs.some((item) => item.id === preferredProviderId)) return []
    const lockedProviderId = preferredProviderId || configs[0]?.id
    configs = lockedProviderId ? configs.filter((item) => item.id === lockedProviderId) : []
  }

  const runtimes: AiEntryProviderRuntime[] = []
  for (let index = 0; index < configs.length; index += 1) {
    const item = configs[index]
    const providerClient = createOpenAI({
      apiKey: item.apiKey,
      baseURL: item.baseURL,
      headers: item.headers,
      fetch: createProviderFetch(),
    })

    const selectedModel =
      preferredProviderId && item.id === preferredProviderId && preferredModel
        ? preferredModel
        : item.model

    let candidateModels: string[] = [selectedModel]
    if (!disableProviderFailover && forceModelAcrossProviders && preferredModel) {
      const matchedFromProviderCatalog = await resolveProviderMatchedModels(
        item,
        preferredModel,
      )
      candidateModels = dedupeStringList([
        ...matchedFromProviderCatalog,
        ...buildProviderModelCandidates(item.id, preferredModel),
      ])
    }

    for (const candidateModel of candidateModels) {
      runtimes.push({
        id: item.id,
        model: candidateModel,
        baseURL: item.baseURL,
        provider: providerClient,
        stateIndex: index,
      })
    }
  }

  if (preferredProviderId && preferredModel) {
    const preferredRuntimeIndex = runtimes.findIndex(
      (item) => item.id === preferredProviderId,
    )
    if (preferredRuntimeIndex >= 0) {
      const preferredRuntime = runtimes[preferredRuntimeIndex]
      const configuredDefaultModel = normalizeText(
        configs[preferredRuntime.stateIndex]?.model,
      )

      const shouldAddConfiguredFallbackModel =
        !disableSameProviderModelFallback &&
        configuredDefaultModel &&
        configuredDefaultModel !== preferredRuntime.model &&
        !runtimes.some(
          (item) =>
            item.id === preferredRuntime.id &&
            item.model === configuredDefaultModel &&
            item.stateIndex === preferredRuntime.stateIndex,
        )

      if (shouldAddConfiguredFallbackModel) {
        runtimes.splice(preferredRuntimeIndex + 1, 0, {
          ...preferredRuntime,
          model: configuredDefaultModel,
        })
      }
    }
  }

  return runtimes
}

export async function executeAiEntryWithProviderFailover<T>(
  execute: (params: ExecuteAiEntryProviderParams) => Promise<T>,
  options?: ExecuteAiEntryOptions,
) {
  const providers = await buildProviderRuntimes(options)
  if (providers.length === 0) {
    throw new Error(
      "No configured AI entry providers. Configure at least one AI entry runtime provider.",
    )
  }

  const providerOrder = uniqueProviderOrder(providers)
  const state = getRoutingState()
  const maxStateIndex = providers.reduce(
    (max, item) => Math.max(max, item.stateIndex),
    0,
  )
  state.activeIndex = clampIndex(state.activeIndex, maxStateIndex)

  const shouldTryUpgrade =
    !options?.preferredProviderId &&
    state.activeIndex > 0 &&
    state.degradedAccessCount >= UPGRADE_AFTER_ACCESS
  const explicitPreferredStartIndex = options?.preferredProviderId
    ? providers.findIndex((item) => item.id === options.preferredProviderId)
    : -1
  const startStateIndex = shouldTryUpgrade ? state.activeIndex - 1 : state.activeIndex
  const startIndex =
    explicitPreferredStartIndex >= 0
      ? explicitPreferredStartIndex
      : findRuntimeStartIndexByStateIndex(providers, startStateIndex)

  let lastError: unknown = null
  let previousFailureReason: AiEntryProviderFallbackReason | undefined
  let attempt = 0
  let index = startIndex
  const visitedIndices = new Set<number>()

  while (!visitedIndices.has(index)) {
    visitedIndices.add(index)
    attempt += 1
    const candidate = providers[index]

    try {
      const result = await execute({
        provider: candidate.provider,
        providerId: candidate.id,
        model: candidate.model,
        baseURL: candidate.baseURL,
        providerOrder,
        attempt,
        upgradeProbe: shouldTryUpgrade && index === startIndex,
        fallbackReason: previousFailureReason,
      })

      state.activeIndex = candidate.stateIndex
      state.degradedAccessCount =
        candidate.stateIndex === 0 ? 0 : state.degradedAccessCount + 1

      return {
        result,
        providerId: candidate.id,
        model: candidate.model,
        providerOrder,
      }
    } catch (error) {
      lastError = error
      previousFailureReason = resolveProviderFallbackReason(error)
      const degradeReason = resolveDegradeReason(error)
      const nextIndex = options?.disableProviderFailover
        ? -1
        : findNextRuntimeIndex({
            providers,
            currentIndex: index,
            visited: visitedIndices,
            skipSameProvider:
              degradeReason === "policy" ||
              Boolean(options?.directProviderFailoverOnError),
          })
      const canFailover = nextIndex >= 0
      const nextCandidate = canFailover ? providers[nextIndex] : null
      state.activeIndex = clampIndex(
        nextCandidate?.stateIndex ?? candidate.stateIndex,
        maxStateIndex,
      )
      state.degradedAccessCount = 0

      console.warn("ai-entry.provider.degrade", {
        provider: candidate.id,
        model: candidate.model,
        nextProvider: nextCandidate?.id ?? null,
        nextModel: nextCandidate?.model ?? null,
        degradeReason,
        canFailover,
        message: error instanceof Error ? error.message : String(error),
      })

      if (!canFailover || !isRetryableProviderError(error)) {
        break
      }
      index = nextIndex
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ai_entry_provider_failed")
}
