import {
  getConfiguredAiEntryProviderForModel,
  getConfiguredAiEntryProviders,
  type AiEntryProviderConfig,
  type AiEntryProviderId,
} from "@/lib/ai-entry/provider-routing"
import {
  compareModelDisplayIdPreference,
  equivalentModelFingerprint,
  normalizeModelDisplayId,
  pickPreferredDisplayModelId,
  splitProviderModelId,
} from "@/lib/ai-entry/model-id-registry"
import {
  AI_ENTRY_NORMAL_DEFAULT_MODEL_HINT,
  normalizeModelFingerprint,
} from "@/lib/ai-entry/model-policy"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

const CACHE_TTL_MS = 30 * 60 * 1000
const CATALOG_FILTER_CACHE_VERSION = "v10"
const PRIORITY_PROVIDER_FAMILIES = ["anthropic", "openai", "deepseek", "gemini", "minimax", "xai"] as const
const ALLOWED_PROVIDER_FAMILIES = [
  "anthropic",
  "openai",
  "deepseek",
  "gemini",
  "minimax",
  "xai",
] as const
const ALLOWED_PROVIDER_FAMILY_SET = new Set<string>(ALLOWED_PROVIDER_FAMILIES)
const ALLOWED_DISPLAY_MODEL_IDS = [
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "grok-4.5",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "MiniMax-M2.7",
] as const
const ALLOWED_DISPLAY_MODEL_ID_BY_FINGERPRINT = new Map(
  ALLOWED_DISPLAY_MODEL_IDS.map((id) => [equivalentModelFingerprint(id), id]),
)
const NON_CHAT_MODEL_HINTS = [
  "embedding",
  "embed-",
  "embed_",
  "rerank",
  "re-rank",
  "moderation",
  "whisper",
  "transcribe",
  "tts",
  "text-to-speech",
  "speech-to-text",
  "dall-e",
  "audio",
  "image",
  "stable-diffusion",
  "sdxl",
  "text-to-image",
  "image-generation",
  "video-generation",
  "sora",
] as const

const PROVIDER_FAMILY_ALIASES: Record<string, string> = {
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  deepseek: "deepseek",
  google: "gemini",
  gemini: "gemini",
  deepmind: "gemini",
  qwen: "qwen",
  tongyi: "qwen",
  dashscope: "qwen",
  minimax: "minimax",
  abab: "minimax",
  glm: "glm",
  chatglm: "glm",
  zhipu: "glm",
  zhipuai: "glm",
  kimi: "kimi",
  moonshot: "kimi",
  moonshotai: "kimi",
  zai: "glm",
  xai: "xai",
  grok: "xai",
}

const PROVIDER_FAMILY_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  qwen: "Qwen",
  minimax: "MiniMax",
  glm: "GLM",
  kimi: "Kimi",
  xai: "xAI",
}

type AiEntryModelCache = {
  expiresAt: number
  value: AiEntryModelCatalog
}

type GlobalWithAiEntryModelCache = typeof globalThis & {
  __aiEntryModelCatalogCacheV2__?: Record<string, AiEntryModelCache>
}

export type AiEntryModelOption = {
  id: string
  name: string
  modelId?: string
  providerId?: AiEntryProviderId | string
  providerLabel?: string
  runtimeId?: string
  canonicalId?: string
  aliases?: string[]
}

export type AiEntryModelGroup = {
  family: string
  label: string
  models: AiEntryModelOption[]
}

export type AiEntryModelCatalog = {
  providerId: AiEntryProviderId | null
  providerBaseUrl: string | null
  selectedModelId: string | null
  selectedProviderId: AiEntryProviderId | null
  models: AiEntryModelOption[]
  modelGroups: AiEntryModelGroup[]
  cached: boolean
  fetchedAt: number
  recentDays: number | null
  recentStrict: boolean
}

type AiEntryModelCatalogOptions = {
  onlyRecentDays?: number | null
  recentStrict?: boolean
  providerId?: AiEntryProviderId | null
}

type ModelApiItem = {
  id?: unknown
  name?: unknown
  created?: unknown
  owned_by?: unknown
  provider?: unknown
  type?: unknown
  modalities?: unknown
  modality?: unknown
  capabilities?: unknown
  architecture?: {
    modality?: unknown
    input_modalities?: unknown
    output_modalities?: unknown
  } | null
}

type ModelsApiResponse = {
  data?: ModelApiItem[]
  models?: ModelApiItem[]
}

type ParsedModel = {
  id: string
  name: string
  family: string
  createdAtMs: number | null
  isLikelyChat: boolean
}

type RecentFilterResult = {
  models: ParsedModel[]
}

const VERIFIED_PROVIDER_MODEL_IDS: Partial<Record<AiEntryProviderId, string[]>> = {
  deepseek: [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
  ],
  pptoken: [
    "grok-4.5",
    "gpt-6-astra",
    "gpt-6-luna",
    "gpt-6-sol",
    "gpt-6.1-sol",
  ],
  openrouter: [
    "grok-4.5",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "MiniMax-M2.7",
  ],
  aiberm: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "MiniMax-M2.7",
  ],
  crazyroute: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "MiniMax-M2.7",
  ],
}

function normalizeText(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : ""
}

function parseCreatedAtMs(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000
  }

  if (typeof raw === "string") {
    const asNumber = Number.parseInt(raw.trim(), 10)
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000
    }

    const parsedAt = Date.parse(raw)
    if (Number.isFinite(parsedAt)) return parsedAt
  }

  return null
}

function normalizeFamilyToken(raw: unknown) {
  const normalized = normalizeText(raw).toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (!normalized) return ""
  const aliased = PROVIDER_FAMILY_ALIASES[normalized]
  if (aliased) return aliased
  if (ALLOWED_PROVIDER_FAMILY_SET.has(normalized)) return normalized
  return ""
}

function inferFamilyFromLooseText(raw: unknown) {
  const text = normalizeText(raw).toLowerCase()
  if (!text) return ""

  const compact = text.replace(/[^a-z0-9]+/g, "")
  const tokens = text.split(/[^a-z0-9]+/g).filter(Boolean)
  for (const token of [...tokens, compact]) {
    const mapped = PROVIDER_FAMILY_ALIASES[token]
    if (mapped) return mapped
  }

  if (
    /\b(anthropic|claude)\b/.test(text) ||
    compact.startsWith("claude")
  ) {
    return "anthropic"
  }
  if (
    /\b(openai|chatgpt|gpt|o1|o3|o4|o5)\b/.test(text) ||
    compact.startsWith("gpt") ||
    compact.startsWith("o1") ||
    compact.startsWith("o3") ||
    compact.startsWith("o4") ||
    compact.startsWith("o5")
  ) {
    return "openai"
  }
  if (
    /\b(deepseek)\b/.test(text) ||
    compact.startsWith("deepseek")
  ) {
    return "deepseek"
  }
  if (
    /\b(google|gemini)\b/.test(text) ||
    compact.startsWith("gemini")
  ) {
    return "gemini"
  }
  if (
    /\b(qwen|qwq|tongyi|dashscope)\b/.test(text) ||
    compact.startsWith("qwen") ||
    compact.startsWith("qwq")
  ) {
    return "qwen"
  }
  if (
    /\b(minimax|abab|hailuo)\b/.test(text) ||
    compact.startsWith("minimax") ||
    compact.startsWith("abab")
  ) {
    return "minimax"
  }
  if (
    /\b(glm|chatglm|zhipu|zhipuai|z-ai|zai)\b/.test(text) ||
    compact.startsWith("glm") ||
    compact.includes("chatglm")
  ) {
    return "glm"
  }
  if (
    /\b(kimi|moonshot|moonshotai)\b/.test(text) ||
    compact.startsWith("kimi") ||
    compact.startsWith("moonshot")
  ) {
    return "kimi"
  }

  return ""
}

function inferProviderFamily(item: ModelApiItem, id: string) {
  const byProvider = normalizeFamilyToken(item.provider)
  if (byProvider) return byProvider

  const byOwner = normalizeFamilyToken(item.owned_by)
  if (byOwner) return byOwner

  const prefix = id.includes("/") ? id.split("/")[0] : id.split(":")[0]
  const byPrefix = normalizeFamilyToken(prefix)
  if (byPrefix) return byPrefix

  const byName = normalizeFamilyToken(item.name)
  if (byName) return byName

  const byLooseHint =
    inferFamilyFromLooseText(item.provider) ||
    inferFamilyFromLooseText(item.owned_by) ||
    inferFamilyFromLooseText(id) ||
    inferFamilyFromLooseText(prefix) ||
    inferFamilyFromLooseText(item.name)
  if (byLooseHint) return byLooseHint

  return "other"
}

function normalizeModalities(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split(/[,\s>/|-]+/g)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .filter(Boolean)
  }

  if (raw && typeof raw === "object") {
    const values = Object.values(raw as Record<string, unknown>).flatMap((value) =>
      normalizeModalities(value),
    )
    return values
  }

  return []
}

function includesAnyHint(text: string, hints: readonly string[]) {
  return hints.some((hint) => text.includes(hint))
}

function inferLikelyChat(item: ModelApiItem, id: string, name: string) {
  const joined = `${id} ${name}`.toLowerCase()
  if (includesAnyHint(joined, NON_CHAT_MODEL_HINTS)) return false

  const typeValue = normalizeText(item.type).toLowerCase()
  if (typeValue) {
    if (includesAnyHint(typeValue, NON_CHAT_MODEL_HINTS)) return false
    if (
      typeValue.includes("chat") ||
      typeValue.includes("text") ||
      typeValue.includes("language") ||
      typeValue.includes("completion")
    ) {
      return true
    }
  }

  const modalities = [
    ...normalizeModalities(item.modalities),
    ...normalizeModalities(item.modality),
    ...normalizeModalities(item.capabilities),
    ...normalizeModalities(item.architecture?.modality),
    ...normalizeModalities(item.architecture?.input_modalities),
    ...normalizeModalities(item.architecture?.output_modalities),
  ]

  if (modalities.length > 0) {
    const hasText = modalities.some((item) => item.includes("text"))
    if (!hasText) return false
    return true
  }

  return true
}

function normalizeRawModels(payload: ModelsApiResponse | null | undefined) {
  const rawArray = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : []

  const models: ParsedModel[] = []
  const dedupe = new Set<string>()

  for (const item of rawArray) {
    const id = normalizeText(item?.id)
    if (!id || dedupe.has(id)) continue
    dedupe.add(id)

    const name = normalizeText(item?.name) || id
    models.push({
      id,
      name,
      family: inferProviderFamily(item || {}, id),
      createdAtMs: parseCreatedAtMs(item?.created),
      isLikelyChat: inferLikelyChat(item || {}, id, name),
    })
  }

  return models
}

function compareModels(a: ParsedModel, b: ParsedModel) {
  const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  if (byName !== 0) return byName
  return a.id.localeCompare(b.id, "en", { sensitivity: "base" })
}

function toModelOption(
  model: ParsedModel & { runtimeId?: string; canonicalId?: string; aliases?: string[] },
): AiEntryModelOption {
  return {
    id: model.id,
    name: model.name,
    ...(typeof model.runtimeId === "string" && model.runtimeId
      ? { runtimeId: model.runtimeId }
      : {}),
    ...(model.canonicalId ? { canonicalId: model.canonicalId } : {}),
    ...(Array.isArray(model.aliases) && model.aliases.length > 0
      ? { aliases: model.aliases }
      : {}),
  }
}

function toFamilyLabel(family: string) {
  if (PROVIDER_FAMILY_LABELS[family]) return PROVIDER_FAMILY_LABELS[family]
  if (!family || family === "other") return "Other"
  return family.charAt(0).toUpperCase() + family.slice(1)
}

function buildModelGroups(models: ParsedModel[]) {
  const bucket = new Map<string, ParsedModel[]>()
  for (const model of models) {
    const group = bucket.get(model.family)
    if (group) {
      group.push(model)
    } else {
      bucket.set(model.family, [model])
    }
  }

  const families = [...bucket.keys()]
  const prioritized = PRIORITY_PROVIDER_FAMILIES.filter((family) =>
    bucket.has(family),
  )
  const others = families
    .filter((family) => !PRIORITY_PROVIDER_FAMILIES.includes(family as (typeof PRIORITY_PROVIDER_FAMILIES)[number]))
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
  const orderedFamilies = [...prioritized, ...others]

  const groups: AiEntryModelGroup[] = []
  const flattened: AiEntryModelOption[] = []

  for (const family of orderedFamilies) {
    const groupModels = [...(bucket.get(family) || [])].sort(compareModels)
    const options = groupModels.map(toModelOption)
    groups.push({
      family,
      label: toFamilyLabel(family),
      models: options,
    })
    flattened.push(...options)
  }

  return {
    groups,
    flattened,
  }
}

function getRecentDays(options?: AiEntryModelCatalogOptions) {
  if (typeof options?.onlyRecentDays === "number") {
    return options.onlyRecentDays > 0 ? Math.floor(options.onlyRecentDays) : null
  }
  if (options?.onlyRecentDays === null) return null
  return null
}

function getRecentStrict(options?: AiEntryModelCatalogOptions) {
  if (typeof options?.recentStrict === "boolean") return options.recentStrict
  return false
}

function addVerifiedProviderModels(
  provider: AiEntryProviderConfig,
  models: ParsedModel[],
) {
  if (provider.id === "openrouter") return models
  const verifiedIds = VERIFIED_PROVIDER_MODEL_IDS[provider.id] || []
  if (verifiedIds.length === 0) return models

  const existingIds = new Set(models.map((model) => model.id))
  const additions = verifiedIds
    .filter((id) => {
      if (existingIds.has(id)) return false
      // Grok is served by a separate PPToken account. Never advertise the
      // verified Grok model when its dedicated credentials are not configured.
      return Boolean(getConfiguredAiEntryProviderForModel(provider.id, id))
    })
    .map((id) => ({
      id,
      name: id,
      family: inferProviderFamily({ id, name: id }, id),
      createdAtMs: null,
      isLikelyChat: true,
    }))

  return additions.length > 0 ? [...models, ...additions] : models
}

function restrictProviderModels(
  provider: AiEntryProviderConfig,
  models: ParsedModel[],
  configuredDefaultModel = "",
) {
  if (provider.id !== "pptoken") return models

  const supported = new Set(
    (VERIFIED_PROVIDER_MODEL_IDS.pptoken || []).map((modelId) => equivalentModelFingerprint(modelId)),
  )
  const configuredDefaultFingerprint = equivalentModelFingerprint(configuredDefaultModel)
  return models.filter(
    (model) =>
      supported.has(equivalentModelFingerprint(model.id)) ||
      (configuredDefaultFingerprint.length > 0 &&
        equivalentModelFingerprint(model.id) === configuredDefaultFingerprint),
  )
}

function hasExplicitProviderModel(providerId: AiEntryProviderConfig["id"]) {
  const keysByProvider: Partial<Record<AiEntryProviderConfig["id"], string[]>> = {
    deepseek: ["AI_ENTRY_DEEPSEEK_MODEL", "DEEPSEEK_MODEL"],
    pptoken: ["AI_ENTRY_PPTOKEN_MODEL", "PPTOKEN_MODEL"],
    openrouter: ["AI_ENTRY_OPENROUTER_MODEL", "OPENROUTER_TEXT_MODEL"],
    aiberm: ["AI_ENTRY_AIBERM_MODEL", "AIBERM_MODEL", "WRITER_AIBERM_MODEL"],
    crazyroute: [
      "AI_ENTRY_CRAZYROUTE_MODEL",
      "AI_ENTRY_CRAZYROUTER_MODEL",
      "CRAZYROUTE_MODEL",
      "CRAZYROUTER_MODEL",
    ],
  }
  return (keysByProvider[providerId] || []).some((key) => Boolean(normalizeText(process.env[key])))
}

function applyRecentFilter(
  models: ParsedModel[],
  recentDays: number | null,
  recentStrict: boolean,
  now: number,
): RecentFilterResult {
  if (!recentDays) return { models }
  const cutoff = now - recentDays * 24 * 60 * 60 * 1000

  return {
    models: models.filter((model) => {
      if (!model.createdAtMs) return !recentStrict
      return model.createdAtMs >= cutoff
    }),
  }
}

function filterAllowedFamilyModels(models: ParsedModel[]) {
  return models.filter((model) => ALLOWED_PROVIDER_FAMILY_SET.has(model.family))
}

function findAllowedDisplayModelId(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const fingerprint = equivalentModelFingerprint(normalizeText(value))
    if (!fingerprint) continue
    const allowed = ALLOWED_DISPLAY_MODEL_ID_BY_FINGERPRINT.get(fingerprint)
    if (allowed) return allowed
  }
  return null
}

function canonicalDuplicateKey(id: string) {
  const parsed = splitProviderModelId(id)
  return equivalentModelFingerprint(parsed ? parsed.suffix : id)
}

function filterProviderPrefixedDuplicates(models: ParsedModel[]) {
  const bareModelFamilyById = new Map<string, Set<string>>()
  for (const model of models) {
    if (splitProviderModelId(model.id)) continue
    const key = canonicalDuplicateKey(model.id)
    const families = bareModelFamilyById.get(key) || new Set<string>()
    families.add(model.family)
    bareModelFamilyById.set(key, families)
  }

  return models.filter((model) => {
    const parsed = splitProviderModelId(model.id)
    if (!parsed) return true

    const prefixFamily =
      normalizeFamilyToken(parsed.prefix) || inferFamilyFromLooseText(parsed.prefix)
    if (!prefixFamily || prefixFamily !== model.family) return true

    const bareFamilies = bareModelFamilyById.get(canonicalDuplicateKey(parsed.suffix))
    if (!bareFamilies || bareFamilies.size === 0) return true

    return !bareFamilies.has(model.family)
  })
}

function compareModelDedupPreference(a: ParsedModel, b: ParsedModel) {
  return compareModelDisplayIdPreference(a.id, b.id)
}

function pickPreferredEquivalentModel(a: ParsedModel, b: ParsedModel) {
  const byPreference = compareModelDedupPreference(a, b)
  if (byPreference < 0) return a
  if (byPreference > 0) return b

  const aHasBetterName = a.name !== a.id
  const bHasBetterName = b.name !== b.id
  if (aHasBetterName !== bHasBetterName) {
    return aHasBetterName ? a : b
  }

  return a
}

function dedupeEquivalentModelIds(models: ParsedModel[]) {
  const bestByKey = new Map<string, ParsedModel>()
  const aliasesByKey = new Map<string, Set<string>>()
  for (const model of models) {
    const key = `${model.family}:${canonicalDuplicateKey(model.id)}`
    const aliasSet = aliasesByKey.get(key) || new Set<string>()
    aliasSet.add(model.id)
    aliasesByKey.set(key, aliasSet)
    const previous = bestByKey.get(key)
    if (!previous) {
      bestByKey.set(key, model)
      continue
    }
    bestByKey.set(key, pickPreferredEquivalentModel(previous, model))
  }

  return [...bestByKey.entries()].map(([key, model]) => {
    const aliases = [
      ...new Set(
        [...(aliasesByKey.get(key) || new Set<string>())]
          .flatMap((item) => {
            const normalized = normalizeModelDisplayId(item)
            return normalized ? [item, normalized] : [item]
          })
          .filter(Boolean),
      ),
    ]
    const displayId =
      findAllowedDisplayModelId(model.id, model.name, ...aliases) ||
      pickPreferredDisplayModelId([model.id, ...aliases]) ||
      model.id
    return {
      ...model,
      id: displayId,
      name: displayId,
      runtimeId: model.id,
      canonicalId: canonicalDuplicateKey(model.id),
      aliases,
    }
  })
}

function isHighTierDisplayModel(input: { id: string; name: string }) {
  if (isDeprecatedTextModelId(input.id) || isDeprecatedTextModelId(input.name)) return false
  if (normalizeModelFingerprint(`${input.id} ${input.name}`).includes("thinking")) return false
  if (findAllowedDisplayModelId(input.id, input.name)) return true
  return /(?:^|[^a-z0-9])(?:gpt|claude(?:[-_\s]?(?:opus|sonnet|haiku|instant))?)[-_\s]?\d/iu.test(
    `${input.id} ${input.name}`,
  )
}

function filterHighTierDisplayModels(models: ParsedModel[]) {
  return models.filter((model) => !isDeprecatedTextModelId(model.id) &&
    isHighTierDisplayModel({
      id: model.id,
      name: model.name,
    }),
  )
}

function pickPreferredNormalChatModelId(
  models: AiEntryModelOption[],
  configuredDefaultModel = "",
) {
  const explicitDefault = normalizeText(process.env.AI_ENTRY_NORMAL_DEFAULT_MODEL)
  const preferenceHints = [
    explicitDefault,
    normalizeText(process.env.AI_ENTRY_NORMAL_FAST_MODEL),
    AI_ENTRY_NORMAL_DEFAULT_MODEL_HINT,
    "claude-sonnet",
  ].filter(Boolean)

  const scoreModel = (model: AiEntryModelOption, hint: string) => {
    const candidateFingerprint = normalizeModelFingerprint(
      [
        model.id,
        model.name,
        model.runtimeId,
        model.canonicalId,
        ...(Array.isArray(model.aliases) ? model.aliases : []),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
    )
    const hintFingerprint = normalizeModelFingerprint(hint)
    if (!hintFingerprint || !candidateFingerprint.includes(hintFingerprint)) return null

    let score = 0
    if (!candidateFingerprint.includes("thinking")) score += 100
    if (!model.id.includes("/")) score += 10
    if (!model.id.includes(".")) score += 5
    score -= model.id.length / 100
    return score
  }

  const configuredDefaultFingerprint = equivalentModelFingerprint(configuredDefaultModel)
  const configuredDefaultIsStale = isDeprecatedTextModelId(configuredDefaultModel)
  if (configuredDefaultFingerprint && !configuredDefaultIsStale) {
    const configuredDefaultCandidate = models.find((model) => {
      const fingerprints = [
        model.id,
        model.name,
        model.runtimeId,
        model.canonicalId,
        ...(Array.isArray(model.aliases) ? model.aliases : []),
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => equivalentModelFingerprint(value))
      return fingerprints.some((fingerprint) => fingerprint === configuredDefaultFingerprint)
    })
    if (configuredDefaultCandidate?.id) return configuredDefaultCandidate.id
  }

  for (const hint of preferenceHints) {
    const candidates = models
      .map((model) => {
        const score = scoreModel(model, hint)
        return score === null ? null : { model, score }
      })
      .filter((item): item is { model: AiEntryModelOption; score: number } =>
        Boolean(item),
      )
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        return a.model.id.localeCompare(b.model.id, "en", { sensitivity: "base" })
      })
    if (candidates[0]?.model.id) return candidates[0].model.id
  }

  const nonThinking = models.find((model) => {
    const fingerprint = normalizeModelFingerprint(`${model.id} ${model.name}`)
    return !fingerprint.includes("thinking")
  })
  return nonThinking?.id || models[0]?.id || null
}

function buildFallbackCatalog(
  provider: AiEntryProviderConfig | null,
  cached: boolean,
  recentDays: number | null,
  recentStrict: boolean,
): AiEntryModelCatalog {
  const fallbackId = normalizeText(provider?.model)
  const fallbackFamily = fallbackId
    ? inferProviderFamily({ id: fallbackId, name: fallbackId }, fallbackId)
    : "other"
  const fallbackIsHighTier = fallbackId
    ? isHighTierDisplayModel({ id: fallbackId, name: fallbackId })
    : false
  const models =
    fallbackId && ALLOWED_PROVIDER_FAMILY_SET.has(fallbackFamily) && fallbackIsHighTier
      ? [{ id: fallbackId, name: fallbackId, runtimeId: fallbackId }]
      : []
  const modelGroups: AiEntryModelGroup[] =
    models.length > 0
      ? [
          {
            family: fallbackFamily,
            label: toFamilyLabel(fallbackFamily),
            models,
          },
        ]
      : []

  return {
    providerId: provider?.id || null,
    providerBaseUrl: provider?.baseURL || null,
    selectedModelId: models[0]?.id || null,
    selectedProviderId: provider?.id || null,
    models,
    modelGroups,
    cached,
    fetchedAt: Date.now(),
    recentDays,
    recentStrict,
  }
}

async function fetchProviderModels(provider: AiEntryProviderConfig) {
  const response = await fetch(`${provider.baseURL.replace(/\/+$/u, "")}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      ...(provider.headers || {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const raw = await response.text().catch(() => "")
    throw new Error(`ai_entry_models_http_${response.status}:${raw.slice(0, 120)}`)
  }

  const payload = (await response.json().catch(() => null)) as ModelsApiResponse | null
  return normalizeRawModels(payload)
}

function createCacheKey(
  providers: AiEntryProviderConfig[],
  recentDays: number | null,
  recentStrict: boolean,
  requestedProviderId: AiEntryProviderId | null,
) {
  const scope = requestedProviderId || "all"
  if (providers.length === 0) {
    return `none|scope:${scope}|cache:${CATALOG_FILTER_CACHE_VERSION}|recent:${recentDays ?? "none"}|strict:${recentStrict ? "1" : "0"}`
  }
  const providerSignature = providers.map((item) => `${item.id}:${item.baseURL}`).join("|")
  return `${providerSignature}|scope:${scope}|cache:${CATALOG_FILTER_CACHE_VERSION}|recent:${recentDays ?? "none"}|strict:${recentStrict ? "1" : "0"}`
}

export async function getAiEntryModelCatalog(options?: AiEntryModelCatalogOptions) {
  const globalScope = globalThis as GlobalWithAiEntryModelCache
  const now = Date.now()
  const recentDays = getRecentDays(options)
  const recentStrict = getRecentStrict(options)
  const requestedProviderId = options?.providerId || null
  const providers = getConfiguredAiEntryProviders().filter((provider) =>
    requestedProviderId ? provider.id === requestedProviderId : true,
  )

  const cacheStore = globalScope.__aiEntryModelCatalogCacheV2__ || {}
  globalScope.__aiEntryModelCatalogCacheV2__ = cacheStore
  const cacheKey = createCacheKey(providers, recentDays, recentStrict, requestedProviderId)
  const cached = cacheStore[cacheKey]
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.value,
      cached: true,
    }
  }

  if (providers.length === 0) {
    const empty = buildFallbackCatalog(null, false, recentDays, recentStrict)
    cacheStore[cacheKey] = {
      expiresAt: now + CACHE_TTL_MS,
      value: empty,
    }
    return empty
  }

  let lastError: unknown = null
  for (const provider of providers) {
    try {
      const fetchedModels = await fetchProviderModels(provider)
      const configuredDefaultModel = provider.model.trim()
      const hasExplicitModel = hasExplicitProviderModel(provider.id)

      // Verified models are provider-scoped capabilities. Keep the unscoped
      // catalog faithful to the upstream aggregate response so it does not
      // inject unrelated families into a shared model picker.
      const modelsWithDefault = requestedProviderId || provider.id === "pptoken"
        ? addVerifiedProviderModels(provider, [...fetchedModels])
        : [...fetchedModels]
      const hasConfiguredDefaultInList =
        configuredDefaultModel.length > 0 &&
        modelsWithDefault.some((item) => item.id === configuredDefaultModel)
      const configuredDefaultProvider = configuredDefaultModel
        ? getConfiguredAiEntryProviderForModel(provider.id, configuredDefaultModel)
        : null
      if (
        !hasConfiguredDefaultInList &&
        hasExplicitModel &&
        configuredDefaultModel &&
        configuredDefaultProvider
      ) {
        modelsWithDefault.push({
          id: configuredDefaultModel,
          name: configuredDefaultModel,
          family: inferProviderFamily(
            { id: configuredDefaultModel, name: configuredDefaultModel },
            configuredDefaultModel,
          ),
          createdAtMs: null,
          isLikelyChat: true,
        })
      }

      const chatModels = restrictProviderModels(provider, modelsWithDefault, configuredDefaultModel).filter(
        (model) => model.isLikelyChat || model.id === configuredDefaultModel,
      )
      const allowedChatModels = filterHighTierDisplayModels(
        dedupeEquivalentModelIds(
          filterProviderPrefixedDuplicates(filterAllowedFamilyModels(chatModels)),
        ),
      )
      const recentFiltered = applyRecentFilter(
        allowedChatModels,
        recentDays,
        recentStrict,
        now,
      )
      const shouldFallbackToUnfiltered =
        Boolean(recentDays) &&
        !recentStrict &&
        recentFiltered.models.length === 0 &&
        allowedChatModels.length > 0
      const effectiveModels = shouldFallbackToUnfiltered
        ? allowedChatModels
        : recentFiltered.models
      const grouped = buildModelGroups(effectiveModels)

      if (shouldFallbackToUnfiltered) {
        console.warn("ai-entry.models.recent-filter.empty.fallback", {
          provider: provider.id,
          recentDays,
        })
      }

      if (grouped.flattened.length === 0) {
        console.warn("ai-entry.models.provider.empty", {
          provider: provider.id,
        })
        continue
      }

      const selectedModelId =
        pickPreferredNormalChatModelId(
          grouped.flattened,
          hasExplicitModel ? configuredDefaultModel : "",
        ) || null

      const value: AiEntryModelCatalog = {
        providerId: provider.id,
        providerBaseUrl: provider.baseURL,
        selectedModelId,
        selectedProviderId: provider.id,
        models: grouped.flattened,
        modelGroups: grouped.groups,
        cached: false,
        fetchedAt: now,
        recentDays,
        recentStrict,
      }

      cacheStore[cacheKey] = {
        expiresAt: now + CACHE_TTL_MS,
        value,
      }
      return value
    } catch (error) {
      lastError = error
      console.warn("ai-entry.models.fetch.failed", {
        provider: provider.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (lastError) {
    console.warn("ai-entry.models.providers.unavailable", {
      attemptedProviders: providers.map((item) => item.id),
      message: lastError instanceof Error ? lastError.message : String(lastError),
    })
  }

  const fallback = buildFallbackCatalog(providers[0] || null, false, recentDays, recentStrict)
  cacheStore[cacheKey] = {
    expiresAt: now + CACHE_TTL_MS,
    value: fallback,
  }
  return fallback
}
