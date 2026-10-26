import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export const AI_ENTRY_CONSULTING_ENTRY_MODE = "consulting-advisor"
export const AI_ENTRY_NORMAL_DEFAULT_MODEL_HINT = "deepseek-v4-pro"
export const AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT = "deepseek-v4-pro"
export const AI_ENTRY_CLAUDE_61_MODEL_HINT = "claude-sonnet-6.1"
/**
 * Editable PPT is an OpenCode + native ppt-master session. Prefer the
 * PPToken Grok route; the Railway runtime owns any provider fallback.
 */
export const AI_ENTRY_PPT_ASSISTANT_DEFAULT_MODEL_HINT = "grok-4.5"
/** Default model for business agents and the Agent Platform entry points. */
export const AI_ENTRY_AGENT_DEFAULT_MODEL_HINT = "deepseek-v4-pro"
export const AI_ENTRY_CONSULTING_DEFAULT_EXECUTIVE_AGENT_ID = "executive-diagnostic"
export const AI_ENTRY_PPT_AGENT_IDS = ["executive-ppt", "executive-presentation-ppt"] as const
export const AI_ENTRY_CONSULTING_MODEL_LOCK_EXEMPT_AGENT_IDS = AI_ENTRY_PPT_AGENT_IDS

export type AiEntryConsultingModelMode = "quality"

type ModelCandidate = {
  id?: string | null
  name?: string | null
  modelId?: string | null
  providerId?: string | null
  providerLabel?: string | null
  aliases?: string[] | null
  runtimeId?: string | null
  canonicalId?: string | null
}

export function normalizeModelFingerprint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function isAiEntryPptAgentId(agentId: unknown) {
  const normalizedAgentId = normalizeText(agentId)
  return AI_ENTRY_PPT_AGENT_IDS.includes(
    normalizedAgentId as (typeof AI_ENTRY_PPT_AGENT_IDS)[number],
  )
}

function isThinkingModelFingerprint(fingerprint: string) {
  return fingerprint.includes("thinking")
}

function buildModelCandidateText(item: ModelCandidate) {
  return [
    item.id,
    item.name,
    item.runtimeId,
    item.canonicalId,
    ...(Array.isArray(item.aliases) ? item.aliases : []),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ")
}

function isModelHintMatch(item: ModelCandidate, modelHint: string) {
  const hintFingerprint = normalizeModelFingerprint(modelHint)
  const candidateFingerprint = normalizeModelFingerprint(buildModelCandidateText(item))
  return candidateFingerprint.includes(hintFingerprint)
}

function pickModelByHint(models: ModelCandidate[], modelHint: string) {
  const getProviderScore = (providerId: string) => {
    if (providerId === "deepseek") return 0
    if (providerId === "pptoken") return 1
    if (providerId === "aiberm") return 2
    if (providerId === "crazyroute") return 3
    if (providerId === "openrouter") return 4
    return 5
  }

  const candidates = models
    .map((item) => {
      const id = normalizeText(item.id)
      if (!id || isDeprecatedTextModelId(id) || !isModelHintMatch(item, modelHint)) return null
      const fingerprint = normalizeModelFingerprint(buildModelCandidateText(item))
      const providerId = normalizeText(item.providerId).toLowerCase()
      return {
        id,
        providerId,
        providerScore: getProviderScore(providerId),
        hasProviderPrefix: id.includes("/"),
        hasDotSeparator: id.includes("."),
        prefersBaseVariant: !isThinkingModelFingerprint(fingerprint),
      }
    })
    .filter(
      (item): item is {
        id: string
        providerId: string
        providerScore: number
        hasProviderPrefix: boolean
        hasDotSeparator: boolean
        prefersBaseVariant: boolean
      } => Boolean(item),
    )

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (a.prefersBaseVariant !== b.prefersBaseVariant) {
      return a.prefersBaseVariant ? -1 : 1
    }
    if (a.providerScore !== b.providerScore) return a.providerScore - b.providerScore
    if (a.hasProviderPrefix !== b.hasProviderPrefix) {
      return a.hasProviderPrefix ? 1 : -1
    }
    if (a.hasDotSeparator !== b.hasDotSeparator) {
      return a.hasDotSeparator ? 1 : -1
    }
    if (a.id.length !== b.id.length) return a.id.length - b.id.length
    return a.id.localeCompare(b.id, "en", { sensitivity: "base" })
  })

  return candidates[0]?.id || null
}

export function resolveConsultingModelMode(input?: {
  requestedMode?: unknown
}): AiEntryConsultingModelMode {
  void input
  return "quality"
}

export function getConsultingModelHint(mode: AiEntryConsultingModelMode = "quality") {
  void mode
  return (
    normalizeText(process.env.AI_ENTRY_CONSULTING_QUALITY_MODEL) ||
    normalizeText(process.env.AI_ENTRY_CONSULTING_MODEL) ||
    AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT
  )
}

export function pickConsultingModelId(
  models: ModelCandidate[],
  mode: AiEntryConsultingModelMode = "quality",
) {
  return pickModelByHint(models, getConsultingModelHint(mode))
}

export function pickClaude61ModelId(models: ModelCandidate[]) {
  return pickModelByHint(models, AI_ENTRY_CLAUDE_61_MODEL_HINT)
}

export function getPptAssistantDefaultModelHint() {
  return (
    normalizeText(process.env.AI_ENTRY_PPT_ASSISTANT_DEFAULT_MODEL) ||
    AI_ENTRY_PPT_ASSISTANT_DEFAULT_MODEL_HINT
  )
}

export function pickAgentDefaultModelId(models: ModelCandidate[]) {
  return pickModelByHint(models, AI_ENTRY_AGENT_DEFAULT_MODEL_HINT)
}

export function pickPptAssistantDefaultModelId(models: ModelCandidate[]) {
  const modelHint = getPptAssistantDefaultModelHint()
  const matched = models
    .map((item) => {
      const id = normalizeText(item.id)
      if (!id || isDeprecatedTextModelId(id) || !isModelHintMatch(item, modelHint)) return null
      const providerId = normalizeText(item.providerId).toLowerCase()
      return {
        id,
        providerId,
      }
    })
    .filter((item): item is { id: string; providerId: string } => Boolean(item))

  if (matched.length === 0) return null

  matched.sort((a, b) => {
    const getProviderScore = (providerId: string) => {
      if (providerId === "deepseek") return 0
      if (providerId === "pptoken") return 1
      if (providerId === "aiberm") return 2
      if (providerId === "crazyroute") return 3
      if (providerId === "openrouter") return 4
      return 5
    }

    const aProviderScore = getProviderScore(a.providerId)
    const bProviderScore = getProviderScore(b.providerId)
    if (aProviderScore !== bProviderScore) return aProviderScore - bProviderScore
    if (a.id.length !== b.id.length) return a.id.length - b.id.length
    return a.id.localeCompare(b.id, "en", { sensitivity: "base" })
  })

  return matched[0]?.id || null
}

export function resolvePptAssistantModelSelection(input: {
  currentModelId?: string | null
  conversationModelId?: string | null
  availableModelIds: string[]
  defaultModelId?: string | null
}) {
  const availableModelIds = input.availableModelIds.filter((modelId) => !isDeprecatedTextModelId(modelId))
  const currentModelId = normalizeText(input.currentModelId)
  if (currentModelId && !isDeprecatedTextModelId(currentModelId) && availableModelIds.includes(currentModelId)) {
    return currentModelId
  }

  const conversationModelId = normalizeText(input.conversationModelId)
  if (conversationModelId && !isDeprecatedTextModelId(conversationModelId) && availableModelIds.includes(conversationModelId)) {
    return conversationModelId
  }

  const defaultModelId = normalizeText(input.defaultModelId)
  return (defaultModelId && !isDeprecatedTextModelId(defaultModelId) ? defaultModelId : "") || availableModelIds[0] || null
}

export function isConsultingAdvisorEntryMode(value: unknown) {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === AI_ENTRY_CONSULTING_ENTRY_MODE
  )
}

export function shouldLockConsultingAdvisorModel(input: {
  entryMode?: unknown
  agentId?: string | null
}) {
  // Consulting is an entry mode, not a model lock. Keep this compatibility
  // helper for callers that still use the old name, but always allow the
  // model selector and preserve entry-mode routing separately.
  void input
  return false
}
