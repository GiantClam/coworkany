import type { AiEntryModelCatalog, AiEntryModelOption } from "@/lib/ai-entry/model-catalog"
import { serializeAiEntryModelSelection } from "@/lib/ai-entry/model-selection"
import { getConfiguredAiEntryProviderForModel, type AiEntryProviderId } from "@/lib/ai-entry/provider-routing"
import type { EnterpriseModelRouteAssignment } from "@/lib/platform/model-config"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export type ModelGovernanceUser = {
  id: number
  enterpriseId: number | null
  enterpriseRole: string | null
  enterpriseStatus: string | null
}

export type RuntimeProviderLike = {
  id: string
  scope: "text" | "image" | "video" | "audio" | "agent" | "tooling"
  configured: boolean
  active: boolean
  model: string | null
  baseURL: string | null
}

export type WorkflowImageProviderOptionLike = {
  providerId: string
  label: string
  models: Array<{
    modelId: string
    label: string
  }>
}

type GovernedTextProviderOption = {
  providerId: AiEntryProviderId
  label: string
  modelId: string
  baseUrl: string | null
  active: boolean
}

const AI_ENTRY_PROVIDER_IDS = new Set<AiEntryProviderId>([
  "deepseek",
  "pptoken",
  "openrouter",
  "aiberm",
  "crazyroute",
  "enterprise-openai-compatible",
  "enterprise-qwen-official",
  "enterprise-minimax-official",
  "enterprise-glm-official",
  "enterprise-volcengine-official",
])

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isEnterpriseAdmin(user: ModelGovernanceUser | null | undefined) {
  return user?.enterpriseRole === "admin" && user?.enterpriseStatus === "active"
}

function hasEnterpriseContext(user: ModelGovernanceUser | null | undefined) {
  return Boolean(user && typeof user.enterpriseId === "number" && user.enterpriseId > 0)
}

function hasActiveEnterpriseContext(user: ModelGovernanceUser | null | undefined) {
  return hasEnterpriseContext(user) && user?.enterpriseStatus === "active"
}

function findRouteAssignment(
  assignments: EnterpriseModelRouteAssignment[],
  routeId: string,
) {
  return assignments.find((item) => normalizeText(item.routeId) === routeId) || null
}

export function canUserAccessAssignedRoute(params: {
  user: ModelGovernanceUser | null | undefined
  assignedUserIds?: number[]
}) {
  const { user } = params
  const assignedUserIds = Array.isArray(params.assignedUserIds)
    ? [...new Set(params.assignedUserIds.filter((value) => Number.isInteger(value) && value > 0))]
    : []

  if (!user) return assignedUserIds.length === 0
  if (isEnterpriseAdmin(user)) return true
  if (hasEnterpriseContext(user) && user.enterpriseStatus !== "active") return false
  if (assignedUserIds.length === 0) return true
  return assignedUserIds.includes(user.id)
}

function filterAssignedItems<T>(params: {
  user: ModelGovernanceUser | null | undefined
  items: T[]
  getId: (item: T) => string
  assignments: EnterpriseModelRouteAssignment[]
}) {
  const { user, items, getId, assignments } = params
  if (hasEnterpriseContext(user) && !hasActiveEnterpriseContext(user)) {
    return [] as T[]
  }

  return items.filter((item) => {
    const assignment = findRouteAssignment(assignments, getId(item))
    return canUserAccessAssignedRoute({
      user,
      assignedUserIds: assignment?.assignedUserIds,
    })
  })
}

export function getRuntimeProviderLabel(providerId: string) {
  if (providerId === "deepseek") return "DeepSeek"
  if (providerId === "pptoken") return "PPToken"
  if (providerId === "openrouter") return "OpenRouter"
  if (providerId === "aiberm") return "AIBERM"
  if (providerId === "crazyroute") return "Crazyroute"
  if (providerId === "enterprise-openai-compatible") return "OpenAI Compatible"
  if (providerId === "enterprise-qwen-official") return "Qwen Official"
  if (providerId === "enterprise-minimax-official") return "MiniMax Official"
  if (providerId === "enterprise-glm-official") return "GLM Official"
  if (providerId === "enterprise-volcengine-official") return "火山引擎"
  if (providerId === "runninghub-image") return "RunningHub Image"
  if (providerId === "runninghub-video") return "RunningHub Video"
  if (providerId === "minimax-video") return "MiniMax Hailuo Video"
  if (providerId === "minimax-audio") return "MiniMax Audio"
  return providerId
}

function getPreferredTextProviderModelHint() {
  return normalizeText(process.env.AI_ENTRY_NORMAL_DEFAULT_MODEL) || normalizeText(process.env.AI_ENTRY_MODEL)
}

function buildCatalogModel(provider: GovernedTextProviderOption): AiEntryModelOption {
  const selectionId =
    serializeAiEntryModelSelection({
      providerId: provider.providerId,
      modelId: provider.modelId,
    }) || provider.modelId
  return {
    id: selectionId,
    name: `${provider.label} / ${provider.modelId}`,
    modelId: provider.modelId,
    providerId: provider.providerId,
    providerLabel: provider.label,
    runtimeId: provider.modelId,
    canonicalId: provider.modelId,
    aliases: [provider.modelId, `${provider.providerId}/${provider.modelId}`, selectionId],
  }
}

function buildCatalogGroups(providers: GovernedTextProviderOption[]) {
  const grouped = new Map<string, GovernedTextProviderOption[]>()
  for (const provider of providers) {
    const family = grouped.get(provider.providerId) || []
    family.push(provider)
    grouped.set(provider.providerId, family)
  }

  return [...grouped.values()].map((family) => ({
    family: family[0]!.providerId,
    label: family[0]!.label,
    models: family.map(buildCatalogModel),
  }))
}

function isDeepseekV4Model(modelId: string) {
  return /^deepseek-v4-(?:pro|flash)$/iu.test(normalizeText(modelId))
}

function buildDeepseekModelCandidates(provider: GovernedTextProviderOption) {
  // Enterprise OpenAI-compatible routes keep their own provider ID and
  // credentials, but may point at the same DeepSeek V4 model family. Expose
  // Flash for those routes too so an externally configured model is not hidden
  // just because it is not using the platform provider ID.
  if (provider.providerId !== "deepseek" && !isDeepseekV4Model(provider.modelId)) return [provider]

  const candidates = [provider]
  if (provider.modelId !== "deepseek-v4-flash") {
    candidates.push({ ...provider, modelId: "deepseek-v4-flash" })
  }
  return candidates
}

export function buildGovernedAiEntryModelCatalog(params: {
  user: ModelGovernanceUser | null | undefined
  runtimeProviders: RuntimeProviderLike[]
  assignments?: EnterpriseModelRouteAssignment[]
  requestedProviderId?: AiEntryProviderId | null
  preferredSelectedProviderId?: AiEntryProviderId | null
  disableEnvDefaultPreference?: boolean
}) {
  const assignments = params.assignments || []
  const candidateProviders = params.runtimeProviders
    .filter((provider) => AI_ENTRY_PROVIDER_IDS.has(provider.id as AiEntryProviderId))
    .filter((provider) => provider.scope === "text" && provider.configured)
    .flatMap((provider) => {
      const providerId = provider.id as AiEntryProviderId
      const baseProvider = {
        providerId,
        label: getRuntimeProviderLabel(provider.id),
        modelId: normalizeText(provider.model),
        baseUrl: provider.baseURL,
        active: provider.active,
      }
      // Runtime snapshots can contain persisted provider defaults from before
      // the GPT-6+/Claude-6+ retirement policy. Keep the history in storage,
      // but never expose a retired text model as a governed selectable route.
      const candidates =
        baseProvider.modelId && !isDeprecatedTextModelId(baseProvider.modelId)
          ? [baseProvider]
          : []

      // PPToken maintains separate GPT and Grok accounts. The platform
      // runtime snapshot intentionally exposes only the provider default, so
      // add Grok here when its dedicated credentials are actually configured.
      // This is the governed catalog consumed by /api/ai/models.
      if (providerId === "pptoken") {
        const grokProvider = getConfiguredAiEntryProviderForModel("pptoken", "grok-4.5")
        if (grokProvider) {
          candidates.push({
            ...baseProvider,
            modelId: "grok-4.5",
            baseUrl: grokProvider.baseURL,
            active: false,
          })
        }
      }

      return candidates
    })
    .filter((provider) => provider.modelId)
  const accessibleProviders = filterAssignedItems({
    user: params.user,
    assignments,
    items: candidateProviders,
    getId: (provider) => provider.providerId,
  })

  const requestedProvider =
    params.requestedProviderId
      ? accessibleProviders.find((provider) => provider.providerId === params.requestedProviderId) || null
      : null
  const preferredSelectedProvider =
    params.preferredSelectedProviderId
      ? accessibleProviders.find((provider) => provider.providerId === params.preferredSelectedProviderId) || null
      : null
  const preferredModelHint = params.disableEnvDefaultPreference ? "" : getPreferredTextProviderModelHint()
  const preferredProviderByModel =
    preferredModelHint
      ? accessibleProviders.find((provider) => normalizeText(provider.modelId) === preferredModelHint) || null
      : null
  const selectedProvider =
    requestedProvider ||
    preferredSelectedProvider ||
    preferredProviderByModel ||
    accessibleProviders.find((provider) => provider.active) ||
    accessibleProviders[0] ||
    null
  const modelGroups = buildCatalogGroups(accessibleProviders.flatMap(buildDeepseekModelCandidates))
  const models = modelGroups.flatMap((group) => group.models)

  return {
    providerId: selectedProvider?.providerId || null,
    providerBaseUrl: selectedProvider?.baseUrl || null,
    selectedProviderId: selectedProvider?.providerId || null,
    selectedModelId:
      selectedProvider
        ? serializeAiEntryModelSelection({
            providerId: selectedProvider.providerId,
            modelId: selectedProvider.modelId,
          })
        : null,
    models,
    modelGroups,
    cached: false,
    fetchedAt: Date.now(),
    recentDays: null,
    recentStrict: false,
    providers: [
      ...new Map(
        accessibleProviders.map((provider) => [
          provider.providerId,
          {
            id: provider.providerId,
            label: provider.label,
          },
        ]),
      ).values(),
    ],
  } satisfies AiEntryModelCatalog & {
    providers: Array<{ id: AiEntryProviderId; label: string }>
  }
}

export function buildGovernedWorkflowImageProviderOptions(params: {
  user: ModelGovernanceUser | null | undefined
  providers: WorkflowImageProviderOptionLike[]
  assignments?: EnterpriseModelRouteAssignment[]
}) {
  const assignments = params.assignments || []
  return filterAssignedItems({
    user: params.user,
    assignments,
    items: params.providers,
    getId: (provider) => provider.providerId,
  })
}
