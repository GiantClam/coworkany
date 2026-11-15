import type {
  AiEntryProviderConfig,
  AiEntryProviderId,
} from "@/lib/ai-entry/provider-routing"
import { getConfiguredAiEntryProviders } from "@/lib/ai-entry/provider-routing"
import { mergeEnterpriseTextProviderConfigs } from "@/lib/platform/enterprise-runtime-provider-config"
import type {
  OpenAiCompatibleImageProviderConfig,
  OpenAiCompatibleImageProviderId,
} from "@/lib/image-assistant/openai-compatible-image"
import type { MiniMaxAudioConfig } from "@/lib/platform/minimax-audio"
import { getMiniMaxAudioConfig } from "@/lib/platform/minimax-audio"
import type { MiniMaxVideoConfig } from "@/lib/platform/minimax-video"
import { getMiniMaxVideoConfig } from "@/lib/platform/minimax-video"
import { DEFAULT_MINIMAX_VIDEO_MODEL } from "@/lib/platform/minimax-video-options"
import type { RunningHubConfig } from "@/lib/platform/runninghub"
import { getRunningHubConfig } from "@/lib/platform/runninghub"
import type { BailianConfig } from "@/lib/platform/bailian"
import { getBailianConfig } from "@/lib/platform/bailian"
import {
  getCustomerGovernanceSettings,
  type CustomerGovernanceSettings,
} from "@/lib/platform/customer-governance"
import {
  canUserAccessAssignedRoute,
  type ModelGovernanceUser,
} from "@/lib/platform/model-governance-core"
import {
  getDefaultRunningHubImageRoute,
  listRunningHubImageRoutes,
  type EnterpriseImageModelProviderId,
  type EnterpriseModelCategory,
  type EnterpriseModelProviderConfig,
  type EnterpriseProviderRouteConfig,
  type EnterpriseRunningHubImageRouteMode,
  type EnterpriseTextModelProviderId,
  type EnterpriseVideoModelProviderId,
} from "@/lib/platform/model-config"

export type EnterpriseTextRuntimeProviderId = Extract<
  AiEntryProviderId,
  | "enterprise-openai-compatible"
  | "enterprise-qwen-official"
  | "enterprise-minimax-official"
  | "enterprise-glm-official"
  | "enterprise-volcengine-official"
>

export type EnterpriseImageRuntimeConfig =
  | {
      kind: "bailian"
      providerId: "bailian_official"
      label: string
      model: string
      config: BailianConfig
    }
  | {
      kind: "openai-compatible"
      providerId: EnterpriseImageModelProviderId
      label: string
      model: string
      config: OpenAiCompatibleImageProviderConfig
    }
  | {
      kind: "google"
      providerId: "google_official"
      label: string
      model: string
      apiKey: string
    }
  | {
      kind: "runninghub"
      providerId: "runninghub"
      providerLabel: string
      label: string
      model: string
      routeId: string
      routeMode: EnterpriseRunningHubImageRouteMode
      endpoint: string
      config: RunningHubConfig
    }

export type EnterpriseVideoRuntimeConfig = {
  providerId: EnterpriseVideoModelProviderId
  label: string
  model: string | null
} & (
  | {
      kind: "minimax"
      config: MiniMaxVideoConfig
    }
  | {
      kind: "bailian"
      config: BailianConfig
    }
  | {
      kind: "runninghub"
      config: RunningHubConfig
    }
)

export type EnterpriseAudioRuntimeConfig = {
  providerId: "minimax_official"
  label: string
  model: string | null
  config: MiniMaxAudioConfig
}

export type EnterpriseImageRuntimeOption = {
  selectionId: string
  active: boolean
  runtime: EnterpriseImageRuntimeConfig
}

export type EnterpriseVideoRuntimeOption = {
  active: boolean
  runtime: EnterpriseVideoRuntimeConfig
}

export type EnterpriseAudioRuntimeOption = {
  active: boolean
  runtime: EnterpriseAudioRuntimeConfig
}

const DEFAULT_TEXT_MODEL = "deepseek-v4-pro"
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2"
const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-2.5-flash-image"
const DEFAULT_RUNNINGHUB_TXT2IMG_MODEL = "seedream-v5-text-to-image"
const DEFAULT_RUNNINGHUB_IMG2IMG_MODEL = "seedream-v5-image-to-image"
const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1"
const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
const DEFAULT_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function hasActiveEnterpriseContext(user: ModelGovernanceUser | null | undefined) {
  return Boolean(
    user &&
      typeof user.enterpriseId === "number" &&
      user.enterpriseId > 0 &&
      user.enterpriseStatus === "active",
  )
}

function canUserAccessConfiguredProvider(params: {
  user: ModelGovernanceUser
  provider: EnterpriseModelProviderConfig
}) {
  if (params.user.enterpriseRole === "admin") {
    return true
  }

  const assignedUserIds = Array.isArray(params.provider.assignedUserIds)
    ? [...new Set(params.provider.assignedUserIds.filter((value) => Number.isInteger(value) && value > 0))]
    : []
  if (assignedUserIds.length === 0) {
    return true
  }
  return assignedUserIds.includes(params.user.id)
}

function getCategoryProviderConfigs(
  settings: CustomerGovernanceSettings,
  category: EnterpriseModelCategory,
) {
  const categoryConfig = settings.modelConfig[category]
  const selectedProviderId = categoryConfig.selectedProviderId
  const selectedProvider = selectedProviderId
    ? categoryConfig.providers.find((provider) => provider.providerId === selectedProviderId) || null
    : null

  return {
    categoryConfig,
    selectedProvider,
  }
}

function mapEnterpriseTextProviderId(
  providerId: EnterpriseTextModelProviderId,
): EnterpriseTextRuntimeProviderId {
  if (providerId === "openai_compatible") return "enterprise-openai-compatible"
  if (providerId === "qwen_official") return "enterprise-qwen-official"
  if (providerId === "minimax_official") return "enterprise-minimax-official"
  if (providerId === "volcengine_official") return "enterprise-volcengine-official"
  return "enterprise-glm-official"
}

function getEnterpriseTextBaseUrl(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.baseUrl)
  if (explicit) return explicit
  if (provider.providerId === "qwen_official") return DEFAULT_QWEN_BASE_URL
  if (provider.providerId === "minimax_official") return DEFAULT_MINIMAX_BASE_URL
  if (provider.providerId === "glm_official") return DEFAULT_GLM_BASE_URL
  if (provider.providerId === "volcengine_official") return DEFAULT_VOLCENGINE_BASE_URL
  return ""
}

function getEnterpriseImageBaseUrl(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.baseUrl)
  if (explicit) return explicit
  if (provider.providerId === "runninghub") {
    return getRunningHubConfig().baseUrl
  }
  if (provider.providerId === "openai_official") return DEFAULT_OPENAI_BASE_URL
  if (provider.providerId === "bailian_official") return getBailianConfig().baseUrl
  return ""
}

function getEnterpriseVideoBaseUrl(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.baseUrl)
  if (explicit) return explicit
  if (provider.providerId === "minimax_official") {
    return getMiniMaxVideoConfig().baseUrl
  }
  if (provider.providerId === "bailian_official") return getBailianConfig().baseUrl
  if (provider.providerId === "runninghub") {
    return getRunningHubConfig().baseUrl
  }
  return ""
}

function getEnterpriseAudioBaseUrl(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.baseUrl)
  if (explicit) return explicit
  return DEFAULT_MINIMAX_BASE_URL
}

function getEnterpriseRunningHubApiKey(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.apiKey)
  if (explicit) return explicit
  return normalizeText(getRunningHubConfig().apiKey)
}

function getEnterpriseMiniMaxApiKey(provider: EnterpriseModelProviderConfig) {
  const explicit = normalizeText(provider.apiKey)
  if (explicit) return explicit
  return normalizeText(getMiniMaxVideoConfig().apiKey)
}

function getEnterpriseBailianApiKey(provider: EnterpriseModelProviderConfig) {
  return normalizeText(provider.apiKey) || normalizeText(getBailianConfig().apiKey)
}

export function buildEnterpriseImageRuntimeSelectionId(input: {
  providerId: EnterpriseImageModelProviderId
  model?: string
  routeId?: string | null
}) {
  return `enterprise:${input.providerId}:${encodeURIComponent(input.routeId || input.model || "")}`
}

function canUserAccessConfiguredImageRoute(params: {
  user: ModelGovernanceUser
  provider: EnterpriseModelProviderConfig
  route: EnterpriseProviderRouteConfig
}) {
  if (params.user.enterpriseRole === "admin") {
    return true
  }

  const scopedAssignedUserIds =
    params.route.assignedUserIds.length > 0 ? params.route.assignedUserIds : params.provider.assignedUserIds
  if (scopedAssignedUserIds.length === 0) {
    return true
  }
  return scopedAssignedUserIds.includes(params.user.id)
}

function findCategoryRouteAssignment(
  settings: CustomerGovernanceSettings,
  category: EnterpriseModelCategory,
  routeId: string,
) {
  return (
    settings.modelConfig[category].routeAssignments.find(
      (assignment) => normalizeText(assignment.routeId) === normalizeText(routeId),
    ) || null
  )
}

function canUserAccessCategoryRoute(params: {
  user: ModelGovernanceUser
  settings: CustomerGovernanceSettings
  category: EnterpriseModelCategory
  routeId: string
}) {
  const assignment = findCategoryRouteAssignment(
    params.settings,
    params.category,
    params.routeId,
  )
  return canUserAccessAssignedRoute({
    user: params.user,
    assignedUserIds: assignment?.assignedUserIds,
  })
}

function buildEnterpriseTextProviderConfig(provider: EnterpriseModelProviderConfig) {
  const apiKey = normalizeText(provider.apiKey)
  const baseURL = getEnterpriseTextBaseUrl(provider)
  const model = normalizeText(provider.modelId) || DEFAULT_TEXT_MODEL
  if (!provider.enabled || !apiKey || !baseURL) {
    return null
  }

  return {
    id: mapEnterpriseTextProviderId(provider.providerId as EnterpriseTextModelProviderId),
    apiKey,
    baseURL,
    model,
  } satisfies AiEntryProviderConfig
}

/**
 * Resolve an enterprise-owned text Provider for the internal Provider Proxy.
 * The proxy is called by the Railway runtime with an enterprise binding, not a
 * browser user session, so access is constrained to the signed internal
 * token and the enterprise's enabled Provider configuration.
 */
export async function getEnterpriseTextRuntimeProviderConfigForProxy(input: {
  enterpriseId: number
  providerId: string
}) {
  if (!Number.isInteger(input.enterpriseId) || input.enterpriseId <= 0) return null
  const settings = await getCustomerGovernanceSettings(input.enterpriseId, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) return null

  const provider = settings.modelConfig.text_generation.providers.find((candidate) => {
    const runtimeProviderId = mapEnterpriseTextProviderId(
      candidate.providerId as EnterpriseTextModelProviderId,
    )
    return runtimeProviderId === input.providerId
  })
  return provider ? buildEnterpriseTextProviderConfig(provider) : null
}

function buildEnterpriseTextProviderCatalogEntry(provider: EnterpriseModelProviderConfig) {
  const hasApiKey = Boolean(normalizeText(provider.apiKey) || provider.apiKeyConfigured)
  const baseURL = getEnterpriseTextBaseUrl(provider)
  const model = normalizeText(provider.modelId) || DEFAULT_TEXT_MODEL
  if (!provider.enabled || !hasApiKey || !baseURL) {
    return null
  }

  return {
    id: mapEnterpriseTextProviderId(provider.providerId as EnterpriseTextModelProviderId),
    label: normalizeText(provider.label) || provider.providerId,
    model,
    baseURL,
  }
}

function buildEnterpriseImageRuntime(
  provider: EnterpriseModelProviderConfig,
): EnterpriseImageRuntimeConfig | null {
  const apiKey = normalizeText(provider.apiKey) || (provider.providerId === "bailian_official" ? normalizeText(getBailianConfig().apiKey) : "")
  const label = normalizeText(provider.label) || provider.providerId
  const model =
    normalizeText(provider.modelId) ||
    (provider.providerId === "google_official"
      ? DEFAULT_GOOGLE_IMAGE_MODEL
      : provider.providerId === "bailian_official"
        ? "qwen-image-3.0-pro"
        : DEFAULT_OPENAI_IMAGE_MODEL)
  if (!provider.enabled || !apiKey) {
    return null
  }

  if (provider.providerId === "runninghub") {
    return null
  }

  if (provider.providerId === "google_official") {
    return {
      kind: "google",
      providerId: "google_official",
      label,
      model,
      apiKey,
    }
  }

  const baseUrl = getEnterpriseImageBaseUrl(provider)
  if (!baseUrl) {
    return null
  }

  if (provider.providerId === "bailian_official") {
    return {
      kind: "bailian",
      providerId: "bailian_official",
      label,
      model,
      config: {
        baseUrl,
        apiKey,
      },
    }
  }

  return {
    kind: "openai-compatible",
    providerId: provider.providerId as EnterpriseImageModelProviderId,
    label,
    model,
    config: {
      provider: "pptoken" as OpenAiCompatibleImageProviderId,
      baseUrl,
      apiKey,
      model,
    },
  }
}

function buildEnterpriseRunningHubImageRouteRuntime(params: {
  provider: EnterpriseModelProviderConfig
  route: EnterpriseProviderRouteConfig
}): EnterpriseImageRuntimeConfig | null {
  const fallback = getRunningHubConfig()
  const apiKey = getEnterpriseRunningHubApiKey(params.provider)
  const providerLabel = normalizeText(params.provider.label) || params.provider.providerId
  const routeLabel = normalizeText(params.route.label) || providerLabel
  const model =
    normalizeText(params.route.modelId) ||
    normalizeText(params.provider.modelId) ||
    (params.route.mode === "img2img"
      ? DEFAULT_RUNNINGHUB_IMG2IMG_MODEL
      : DEFAULT_RUNNINGHUB_TXT2IMG_MODEL)
  if (!params.provider.enabled || !params.route.enabled || !apiKey) {
    return null
  }

  const baseUrl = getEnterpriseImageBaseUrl(params.provider)
  const endpoint = normalizeText(params.route.endpoint) || fallback.image.endpoint || ""
  if (!baseUrl || !endpoint) {
    return null
  }

  return {
    kind: "runninghub",
    providerId: "runninghub",
    providerLabel,
    label: routeLabel,
    model,
    routeId: params.route.routeId,
    routeMode: params.route.mode || "txt2img",
    endpoint,
    config: {
      ...fallback,
      baseUrl,
      apiKey,
      image: {
        ...fallback.image,
        configured: true,
        endpoint,
      },
      video: {
        ...fallback.video,
        configured: Boolean(apiKey && fallback.video.endpoint),
      },
    },
  }
}

function buildEnterpriseVideoRuntime(
  provider: EnterpriseModelProviderConfig,
): EnterpriseVideoRuntimeConfig | null {
  const baseUrl = getEnterpriseVideoBaseUrl(provider)
  if (!provider.enabled || !baseUrl) {
    return null
  }

  if (provider.providerId === "minimax_official") {
    const fallback = getMiniMaxVideoConfig()
    const apiKey = getEnterpriseMiniMaxApiKey(provider)
    if (!apiKey) {
      return null
    }

    return {
      kind: "minimax",
      providerId: "minimax_official",
      label: normalizeText(provider.label) || provider.providerId,
      model: normalizeText(provider.modelId) || DEFAULT_MINIMAX_VIDEO_MODEL,
      config: {
        ...fallback,
        baseUrl,
        apiKey,
      },
    }
  }

  if (provider.providerId === "bailian_official") {
    const apiKey = getEnterpriseBailianApiKey(provider)
    if (!apiKey) return null
    return {
      kind: "bailian",
      providerId: "bailian_official",
      label: normalizeText(provider.label) || provider.providerId,
      model: normalizeText(provider.modelId) || "happyhorse-1.1-t2v",
      config: { baseUrl, apiKey },
    }
  }

  if (provider.providerId !== "runninghub") {
    return null
  }

  const fallback = getRunningHubConfig()
  const apiKey = getEnterpriseRunningHubApiKey(provider)
  if (!apiKey) {
    return null
  }

  return {
    kind: "runninghub",
    providerId: "runninghub",
    label: normalizeText(provider.label) || provider.providerId,
    model: normalizeText(provider.modelId) || "MiniMax-H3",
    config: {
      ...fallback,
      baseUrl,
      apiKey,
      image: {
        ...fallback.image,
        configured: Boolean(apiKey && fallback.image.endpoint),
      },
      video: {
        ...fallback.video,
        configured: Boolean(apiKey && fallback.video.endpoint),
      },
    },
  }
}

function buildEnterpriseAudioRuntime(
  provider: EnterpriseModelProviderConfig,
): EnterpriseAudioRuntimeConfig | null {
  if (provider.providerId !== "minimax_official") {
    return null
  }

  const apiKey = normalizeText(provider.apiKey)
  const baseUrl = getEnterpriseAudioBaseUrl(provider)
  if (!provider.enabled || !apiKey || !baseUrl) {
    return null
  }

  const fallback = getMiniMaxAudioConfig()
  return {
    providerId: "minimax_official",
    label: normalizeText(provider.label) || provider.providerId,
    model: normalizeText(provider.modelId) || null,
    config: {
      ...fallback,
      baseUrl,
      apiKey,
    },
  }
}

export async function getEnterpriseTextRuntimeProviderConfigsForUser(
  user: ModelGovernanceUser | null | undefined,
) {
  if (!hasActiveEnterpriseContext(user)) {
    return null
  }

  const activeUser = user as ModelGovernanceUser

  const settings = await getCustomerGovernanceSettings(activeUser.enterpriseId!, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return null
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(
    settings,
    "text_generation",
  )
  const configuredProviders: Array<{
    provider: EnterpriseModelProviderConfig
    runtimeConfig: AiEntryProviderConfig
  }> = []
  for (const provider of categoryConfig.providers) {
    if (!canUserAccessConfiguredProvider({ user: activeUser, provider })) {
      continue
    }
    const runtimeConfig = buildEnterpriseTextProviderConfig(provider)
    if (!runtimeConfig) {
      continue
    }
    configuredProviders.push({
      provider,
      runtimeConfig,
    })
  }

  if (configuredProviders.length === 0) {
    return null
  }

  const selectedRuntimeProviderId = selectedProvider
    ? mapEnterpriseTextProviderId(selectedProvider.providerId as EnterpriseTextModelProviderId)
    : null
  const ordered = selectedRuntimeProviderId
    ? [
        ...configuredProviders.filter((entry) => entry.runtimeConfig.id === selectedRuntimeProviderId),
        ...configuredProviders.filter((entry) => entry.runtimeConfig.id !== selectedRuntimeProviderId),
      ]
    : configuredProviders

  const enterpriseProviderConfigs = ordered.map((entry) => entry.runtimeConfig)
  const providerConfigs = mergeEnterpriseTextProviderConfigs({
    enterpriseProviderConfigs,
    platformProviderConfigs: getConfiguredAiEntryProviders(),
  })

  return {
    selectedProviderId: enterpriseProviderConfigs[0]?.id || null,
    selectedModelId: enterpriseProviderConfigs[0]?.model || null,
    providerConfigs,
  }
}

export async function buildEnterpriseTextRuntimeProvidersForCatalog(
  user: ModelGovernanceUser | null | undefined,
  settingsOverride?: CustomerGovernanceSettings | null,
) {
  if (!hasActiveEnterpriseContext(user)) {
    return []
  }

  const activeUser = user as ModelGovernanceUser

  const settings =
    settingsOverride ??
    await getCustomerGovernanceSettings(activeUser.enterpriseId!, {
      includeSecrets: false,
    }).catch(() => null)
  if (!settings) {
    return []
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(
    settings,
    "text_generation",
  )
  const selectedRuntimeProviderId = selectedProvider
    ? mapEnterpriseTextProviderId(selectedProvider.providerId as EnterpriseTextModelProviderId)
    : null

  const runtimeProviders: Array<{
    id: AiEntryProviderId
    label: string
    model: string
    baseURL: string
  }> = []
  for (const provider of categoryConfig.providers) {
    if (!canUserAccessConfiguredProvider({ user: activeUser, provider })) {
      continue
    }
    const runtimeProvider = buildEnterpriseTextProviderCatalogEntry(provider)
    if (!runtimeProvider) {
      continue
    }
    runtimeProviders.push(runtimeProvider)
  }

  return runtimeProviders.map((provider) => ({
      id: provider.id,
      scope: "text" as const,
      configured: true,
      active: provider.id === selectedRuntimeProviderId,
      model: provider.model,
      baseURL: provider.baseURL,
    }))
}

export async function listEnterpriseImageRuntimeOptionsForUser(
  user: ModelGovernanceUser | null | undefined,
) {
  if (!hasActiveEnterpriseContext(user)) {
    return [] as EnterpriseImageRuntimeOption[]
  }

  const activeUser = user as ModelGovernanceUser
  const settings = await getCustomerGovernanceSettings(activeUser.enterpriseId!, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return [] as EnterpriseImageRuntimeOption[]
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(
    settings,
    "image_generation",
  )

  const configuredProviders: EnterpriseImageRuntimeOption[] = []
  for (const provider of categoryConfig.providers) {
    if (provider.providerId === "runninghub") {
      for (const route of listRunningHubImageRoutes(provider)) {
        if (!canUserAccessConfiguredImageRoute({ user: activeUser, provider, route })) {
          continue
        }
        const runtime = buildEnterpriseRunningHubImageRouteRuntime({ provider, route })
        if (!runtime) {
          continue
        }
        const isDefaultRoute =
          route.routeId === categoryConfig.defaultTxt2imgRouteId ||
          route.routeId === categoryConfig.defaultImg2imgRouteId
        configuredProviders.push({
          selectionId: buildEnterpriseImageRuntimeSelectionId({
            providerId: runtime.providerId,
            routeId: route.routeId,
          }),
          active: Boolean(isDefaultRoute || runtime.providerId === selectedProvider?.providerId),
          runtime,
        })
      }
      continue
    }

    if (!canUserAccessConfiguredProvider({ user: activeUser, provider })) {
      continue
    }
    const runtime = buildEnterpriseImageRuntime(provider)
    if (!runtime) {
      continue
    }
    configuredProviders.push({
      selectionId: buildEnterpriseImageRuntimeSelectionId({
        providerId: runtime.providerId,
        model: runtime.model,
      }),
      active: runtime.providerId === selectedProvider?.providerId,
      runtime,
    })
  }

  if (configuredProviders.length === 0) {
    return [] as EnterpriseImageRuntimeOption[]
  }

  return [
    ...configuredProviders.filter((item) => item.active),
    ...configuredProviders.filter((item) => !item.active),
  ]
}

export async function resolveEnterpriseImageRuntimeForUser(params: {
  user: ModelGovernanceUser | null | undefined
  selectionId?: string | null
  model?: string | null
  routeMode?: EnterpriseRunningHubImageRouteMode | null
}) {
  const options = await listEnterpriseImageRuntimeOptionsForUser(params.user)
  if (options.length === 0) {
    return null
  }

  const requestedSelectionId = normalizeText(params.selectionId)
  const requestedModel = normalizeText(params.model)
  const preferredRouteMode = params.routeMode === "img2img" ? "img2img" : "txt2img"
  return (
    (requestedSelectionId
      ? options.find((item) => item.selectionId === requestedSelectionId) || null
      : null) ||
    (requestedModel
      ? options.find((item) => item.runtime.model === requestedModel) || null
      : null) ||
    (options.some((item) => item.runtime.kind === "runninghub")
      ? options.find(
          (item) =>
            item.runtime.kind === "runninghub" &&
            item.runtime.routeMode === preferredRouteMode,
        ) || null
      : null) ||
    options[0] ||
    null
  )
}

export async function listEnterpriseVideoRuntimeOptionsForUser(
  user: ModelGovernanceUser | null | undefined,
) {
  if (!hasActiveEnterpriseContext(user)) {
    return [] as EnterpriseVideoRuntimeOption[]
  }

  const activeUser = user as ModelGovernanceUser
  const settings = await getCustomerGovernanceSettings(activeUser.enterpriseId!, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return [] as EnterpriseVideoRuntimeOption[]
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(
    settings,
    "video_generation",
  )

  const configuredProviders: EnterpriseVideoRuntimeOption[] = []
  for (const provider of categoryConfig.providers) {
    if (!canUserAccessConfiguredProvider({ user: activeUser, provider })) {
      continue
    }
    const routeId = provider.providerId === "minimax_official" ? "minimax-video" : "runninghub-video"
    if (!canUserAccessCategoryRoute({
      user: activeUser,
      settings,
      category: "video_generation",
      routeId,
    })) {
      continue
    }
    const runtime = buildEnterpriseVideoRuntime(provider)
    if (!runtime) {
      continue
    }
    configuredProviders.push({
      active: runtime.providerId === selectedProvider?.providerId,
      runtime,
    })
  }

  if (configuredProviders.length === 0) {
    return [] as EnterpriseVideoRuntimeOption[]
  }

  return [
    ...configuredProviders.filter((item) => item.active),
    ...configuredProviders.filter((item) => !item.active),
  ]
}

export async function resolveEnterpriseVideoRuntimeForUser(params: {
  user: ModelGovernanceUser | null | undefined
}) {
  const options = await listEnterpriseVideoRuntimeOptionsForUser(params.user)
  return options[0]?.runtime || null
}

export async function listEnterpriseAudioRuntimeOptionsForUser(
  user: ModelGovernanceUser | null | undefined,
) {
  if (!hasActiveEnterpriseContext(user)) {
    return [] as EnterpriseAudioRuntimeOption[]
  }

  const activeUser = user as ModelGovernanceUser
  const settings = await getCustomerGovernanceSettings(activeUser.enterpriseId!, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return [] as EnterpriseAudioRuntimeOption[]
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(
    settings,
    "audio_generation",
  )

  const configuredProviders: EnterpriseAudioRuntimeOption[] = []
  for (const provider of categoryConfig.providers) {
    if (!canUserAccessConfiguredProvider({ user: activeUser, provider })) {
      continue
    }
    if (
      !canUserAccessCategoryRoute({
        user: activeUser,
        settings,
        category: "audio_generation",
        routeId: "minimax-audio",
      })
    ) {
      continue
    }
    const runtime = buildEnterpriseAudioRuntime(provider)
    if (!runtime) {
      continue
    }
    configuredProviders.push({
      active: runtime.providerId === selectedProvider?.providerId,
      runtime,
    })
  }

  if (configuredProviders.length === 0) {
    return [] as EnterpriseAudioRuntimeOption[]
  }

  return [
    ...configuredProviders.filter((item) => item.active),
    ...configuredProviders.filter((item) => !item.active),
  ]
}

export async function resolveEnterpriseAudioRuntimeForUser(params: {
  user: ModelGovernanceUser | null | undefined
}) {
  const options = await listEnterpriseAudioRuntimeOptionsForUser(params.user)
  return options[0]?.runtime || null
}

export async function resolveEnterpriseImageRuntimeForEnterprise(params: {
  enterpriseId?: number | null
  routeMode?: EnterpriseRunningHubImageRouteMode | null
}) {
  if (typeof params.enterpriseId !== "number" || params.enterpriseId <= 0) {
    return null
  }

  const settings = await getCustomerGovernanceSettings(params.enterpriseId, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return null
  }

  const { categoryConfig, selectedProvider } = getCategoryProviderConfigs(settings, "image_generation")
  if (!selectedProvider) {
    return null
  }

  if (selectedProvider.providerId === "runninghub") {
    const preferredRouteMode = params.routeMode === "img2img" ? "img2img" : "txt2img"
    const selectedRoute =
      getDefaultRunningHubImageRoute(categoryConfig, preferredRouteMode) ||
      listRunningHubImageRoutes(selectedProvider)[0] ||
      null
    if (!selectedRoute) {
      return null
    }
    return buildEnterpriseRunningHubImageRouteRuntime({
      provider: selectedProvider,
      route: selectedRoute,
    })
  }

  return buildEnterpriseImageRuntime(selectedProvider)
}

export async function resolveEnterpriseVideoRuntimeForEnterprise(params: {
  enterpriseId?: number | null
}) {
  if (typeof params.enterpriseId !== "number" || params.enterpriseId <= 0) {
    return null
  }

  const settings = await getCustomerGovernanceSettings(params.enterpriseId, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return null
  }

  const { selectedProvider } = getCategoryProviderConfigs(settings, "video_generation")
  if (!selectedProvider) {
    return null
  }

  return buildEnterpriseVideoRuntime(selectedProvider)
}

export async function resolveEnterpriseAudioRuntimeForEnterprise(params: {
  enterpriseId?: number | null
}) {
  if (typeof params.enterpriseId !== "number" || params.enterpriseId <= 0) {
    return null
  }

  const settings = await getCustomerGovernanceSettings(params.enterpriseId, {
    includeSecrets: true,
  }).catch(() => null)
  if (!settings) {
    return null
  }

  const { selectedProvider } = getCategoryProviderConfigs(settings, "audio_generation")
  if (!selectedProvider) {
    return null
  }

  return buildEnterpriseAudioRuntime(selectedProvider)
}
