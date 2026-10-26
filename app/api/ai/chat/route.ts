import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import {
  stepCountIs,
  type ModelMessage,
} from "ai"

import { requireSessionUser } from "@/lib/auth/guards"
import { isSessionDbUnavailableError } from "@/lib/auth/session"
import {
  appendAiEntryMessage,
  ensureAiEntryConversation,
  listAiEntryMessages,
  recordAiEntryConversationContextSummary,
  recordAiEntryRuntimeProjectSnapshot,
  type AiEntryConversationScope,
} from "@/lib/ai-entry/repository"
import { resolveAiEntryConversationStateFromContents } from "@/lib/ai-entry/conversation-state"
import { buildPersistedConversationSummary } from "@/lib/ai-entry/runtime/context-summary"
import { resolveAiEntryMaxStepCount } from "@/lib/ai-entry/agent-runtime-policy"
import {
  getConfiguredAiEntryProviderForModel,
  getConfiguredAiEntryProviders,
  type AiEntryProviderConfig,
  type AiEntryProviderId,
} from "@/lib/ai-entry/provider-routing"
import {
  isAiEntryAgentId,
} from "@/lib/ai-entry/agent-catalog"
import {
  AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT,
  isConsultingAdvisorEntryMode,
  pickAgentDefaultModelId,
  pickConsultingModelId,
  resolveConsultingModelMode,
  type AiEntryConsultingModelMode,
} from "@/lib/ai-entry/model-policy"
import { resolveEquivalentModelId } from "@/lib/ai-entry/model-id-registry"
import {
  parseAiEntryModelSelection,
  serializeAiEntryModelSelection,
} from "@/lib/ai-entry/model-selection"
import {
  getAiEntryWebSearchSystemRule,
  shouldQueryAiEntryEnterpriseKnowledge,
} from "@/lib/ai-entry/chat-policy"
import {
  normalizeAiEntryIdentity,
} from "@/lib/ai-entry/identity"
import {
  extractAiEntryArtifactsFromToolResult,
  getAiEntryValidationResult,
  isAiEntryToolErrorResult,
} from "@/lib/ai-entry/artifact-runtime"
import { loadEnterpriseKnowledgeContext } from "@/lib/knowledge/service"
import type { EnterpriseKnowledgeContext } from "@/lib/knowledge/types"
import { hasCustomAiChatModelSelection } from "@/lib/platform/shared-credits-policy"
import { getCustomAgentForUser } from "@/lib/platform/custom-agents"
import { parseCustomAgentRuntimeId } from "@/lib/platform/custom-agent-runtime-id"
import {
  extractUserIntentFromMessageContent,
  normalizeAttachmentList,
  normalizeMessageTextContent,
  normalizeMessages,
  type IncomingAttachment,
  type IncomingMessage,
} from "@/lib/ai-entry/chat-attachments"
import { buildAiEntryToolRegistry } from "@/lib/ai-entry/tool-registry"
import { maybeAutoRunPptPreview } from "@/lib/ai-entry/ppt-auto-preview"
import {
  buildPptBriefConversationPromptSection,
  buildPptBriefPromptSection,
  createPptBriefStateFromConfirmationContext,
  extractLatestPptBriefConfirmationContext,
} from "@/lib/ai-entry/ppt-brief"
import { resolveForcedReplyLanguage } from "@/lib/ai-entry/language-policy"
import {
  buildPptTemplateSelectionPromptSection,
  buildPptTemplateCatalogPromptSection,
  buildPptToolResultMessage,
  extractLatestPptTemplateRecommendationContext,
  stripPptArtifactRelativeLinks,
} from "@/lib/ai-entry/ppt-tool-result-message"
import { getPptMasterTemplateCatalog } from "@/lib/lead-tools/ppt-worker-capabilities"
import {
  buildResearchBriefContextMarker,
  buildResearchBriefFromWebSearchResult,
} from "@/lib/ai-entry/research-brief-context"
import { prepareAiEntryConsultingRuntime } from "@/lib/skills/runtime/ai-entry-consulting"
import { resolveSharedSkillSetSelection } from "@/lib/ai-entry/shared-agent-skill-resolver"
import { upsertSharedSkillSetBundle } from "@/lib/ai-entry/shared-agent-skill-bundle-store"
import {
  type ProviderOptions,
  runAiEntryConsultingBlocking,
  runAiEntryConsultingStreaming,
} from "@/lib/skills/runtime/ai-entry-executor"
import { estimateTextCredits } from "@/lib/billing/costing"
import {
  finalizeReservedCredits,
  releaseReservedCredits,
  reserveFeatureCredits,
  type BillingReservation,
} from "@/lib/billing/runtime"
import { getGovernedAiEntryModelCatalogForUser } from "@/lib/platform/model-governance"
import { getEnterpriseTextRuntimeProviderConfigsForUser } from "@/lib/platform/enterprise-runtime-config"
import { buildAgentRuntimeInput } from "@/lib/ai-entry/runtime/context-builder"
import { resolveAiEntryRuntimeDecision } from "@/lib/ai-entry/runtime/gateway"
import { isAiEntrySharedAgentRuntimeEnabled, isBusinessAgentId, resolveBusinessAgentRailwayRuntimeProfile, resolveDashiPptCloudflareRuntimeProfile, resolveDefaultAgentRuntimeProfile, resolveEditablePptRailwayRuntimeProfile } from "@/lib/ai-entry/runtime/profile-store"
import { runOpenCodeAgent } from "@/lib/ai-entry/runtime/opencode-adapter"
import { createBackgroundOpenCodeRun } from "@/lib/ai-entry/runtime/background-run-service"
import { publishRuntimeArtifact, publishRuntimeArtifactReference } from "@/lib/ai-entry/runtime/artifact-publisher"
import { resolveOpenCodeModelHint } from "@/lib/ai-runtime/opencode-model"
import { normalizeReasoningEffort } from "@/lib/ai-entry/reasoning"
import { buildAgentRuntimeSessionKey } from "@/lib/ai-runtime/session-key"
import type { OpenCodeProviderConfig, RuntimeProjectSnapshot } from "@/lib/ai-runtime/contracts"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export const runtime = "nodejs"
export const maxDuration = 1800

const AUTO_PPT_PREVIEW_TOOL_CALL_ID = "auto-preview-ppt"

type ChatRequestBody = {
  messages?: IncomingMessage[]
  message?: string
  systemPrompt?: string
  executionContext?: "chat" | "workflow"
  attachments?: IncomingAttachment[]
  conversationId?: string | null
  conversationScope?: "chat" | "consulting"
  stream?: boolean
  knowledgeSource?: "industry_kb" | "personal_kb"
  enterpriseKnowledge?: {
    enabled?: boolean
    datasetIds?: number[]
  }
  modelConfig?: {
    providerId?: string
    modelId?: string
    reasoningEffort?: string
  }
  agentConfig?: {
    agentId?: string
    agentName?: string
    entryMode?: string
  }
  skillConfig?: {
    enabled?: boolean
    enabledToolNames?: string[]
    enabledSkillIds?: string[]
  }
}

function parseEnterpriseKnowledgeConfig(input: ChatRequestBody["enterpriseKnowledge"]) {
  const datasetIds = Array.isArray(input?.datasetIds)
    ? [...new Set(input.datasetIds.filter((value) => Number.isInteger(value) && value > 0))]
    : []

  return {
    enabled: input?.enabled !== false,
    datasetIds,
  }
}

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}

function createChatTraceId() {
  return `ai-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildSseEvent(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function isClosedStreamControllerError(error: unknown) {
  return error instanceof Error && /controller is already closed/i.test(error.message)
}

function isOpenCodeRuntimeDecision(value: unknown): value is { kind: "opencode-chat"; backend: "cloudflare-opencode-session" | "railway-opencode" } {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "opencode-chat" &&
    ["cloudflare-opencode-session", "railway-opencode"].includes(String((value as { backend?: unknown }).backend)),
  )
}

function isRuntimeInputTooLargeError(error: unknown) {
  return error instanceof Error && error.name === "AgentRuntimeInputTooLargeError"
}

function isPreviewActionRequiredResult(toolName: string, result: unknown) {
  if (toolName !== "preview_ppt_deck" || !isAiEntryToolErrorResult(result)) return false
  const errorCode =
    result &&
    typeof result === "object" &&
    typeof (result as { error?: { code?: unknown } }).error?.code === "string"
      ? String((result as { error?: { code?: unknown } }).error?.code).trim()
      : ""

  return errorCode === "ppt_template_selection_required" || errorCode === "ppt_brief_incomplete"
}

function modelSupportsImageInput(modelId: string | null | undefined) {
  const normalized = typeof modelId === "string" ? modelId.toLowerCase() : ""
  if (!normalized) return false
  if (normalized.includes("gemini")) return true
  if (normalized.includes("claude")) return true
  if (normalized.includes("gpt-4") || normalized.includes("gpt-5") || normalized.includes("o3") || normalized.includes("o4")) return true
  if (normalized.includes("vision") || normalized.includes("vl") || normalized.includes("pixtral")) return true
  return false
}

function parseEnabledToolNames(input: unknown) {
  if (!Array.isArray(input)) return null
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
}

function parseEnabledSkillIds(input: unknown) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
}

function parseExecutionContext(input: ChatRequestBody["executionContext"]) {
  return input === "workflow" ? "workflow" : "chat"
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown; name?: unknown; status?: unknown }
    const candidate = record.message
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
    for (const key of ["code", "name", "status"] as const) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
      if (typeof value === "number" && Number.isFinite(value)) return String(value)
    }
  }
  return "ai_entry_stream_failed"
}

function canLoadEnterpriseKnowledgeForUser(user: {
  enterpriseId: number | null
  enterpriseStatus: string | null
}) {
  const id = user.enterpriseId
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return false
  return user.enterpriseStatus === "active"
}

function normalizeEnterpriseName(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
  return normalized
}

function buildAiEntryKnowledgeQueryVariants(query: string, enterpriseName: string) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim()
  const variants = [normalizedQuery]
  if (enterpriseName) {
    variants.push(`${enterpriseName} \u4f01\u4e1a\u4ecb\u7ecd`)
    variants.push(`${enterpriseName} \u6838\u5fc3\u4e1a\u52a1\u4e0e\u4ea7\u54c1`)
    variants.push(`${enterpriseName} \u76ee\u6807\u5ba2\u6237\u4e0e\u5178\u578b\u573a\u666f`)
  }

  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].slice(0, 4)
}

type ToolFailureSummary = {
  toolName: string
  message: string
}

function buildToolFailureFallbackMessage(input: {
  failures: ToolFailureSummary[]
  isZh: boolean
}) {
  if (input.failures.length === 0) return ""

  const grouped = new Map<string, { toolName: string; message: string; count: number }>()
  for (const failure of input.failures) {
    const toolName = failure.toolName.trim() || "tool"
    const message = failure.message.trim() || "tool_execution_failed"
    const key = `${toolName}::${message}`
    const existing = grouped.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    grouped.set(key, { toolName, message, count: 1 })
  }

  const entries = [...grouped.values()]
  if (entries.length === 0) return ""

  if (input.isZh) {
    const lines = ["工具执行失败，当前还没有拿到可用结果："]
    for (const entry of entries.slice(0, 3)) {
      lines.push(`- ${entry.toolName}: ${entry.message}${entry.count > 1 ? `（重复 ${entry.count} 次）` : ""}`)
    }
    lines.push("我不会继续用相同参数盲目重试；需要根据上面的失败原因调整后再继续。")
    return lines.join("\n")
  }

  const lines = ["The tool run failed before a usable result was produced:"]
  for (const entry of entries.slice(0, 3)) {
    lines.push(`- ${entry.toolName}: ${entry.message}${entry.count > 1 ? ` (repeated ${entry.count} times)` : ""}`)
  }
  lines.push("I will not keep retrying the same parameters until the failure cause is addressed.")
  return lines.join("\n")
}

type KnowledgeQueryProgress = {
  event: "knowledge_query_start" | "knowledge_query_result"
  data?: {
    status?: "hit" | "miss" | "failed"
    snippetCount?: number
    datasetCount?: number
    durationMs?: number
    message?: string
  }
}

function buildEnterpriseKnowledgePromptSection(context: EnterpriseKnowledgeContext) {
  if (!context.snippets.length) return ""

  const header = [
    "The following snippets were retrieved from this enterprise's configured Dify knowledge datasets.",
    "Use them when they are relevant; if they conflict with the user or are off-topic, rely on the user and general consulting judgment.",
  ].join(" ")

  const body = context.snippets
    .map((snippet, index) => {
      const title = snippet.title.trim() || `Snippet ${index + 1}`
      return `[${snippet.datasetName} - ${title}]\n${snippet.content.trim()}`
    })
    .join("\n\n---\n\n")

  return `## Enterprise knowledge\n${header}\n\n${body}`
}

function buildAiEntrySystemPrompt(
  enterpriseKnowledge: EnterpriseKnowledgeContext | null,
  agentInstruction: string,
  customSystemPrompt: string,
  latestUserPrompt: string,
  forcedReplyLanguage: "zh" | "en" | null,
  agentId: string | null,
  webSearch: {
    available?: boolean
    conversationScope?: AiEntryConversationScope
    consultingModelMode?: AiEntryConsultingModelMode
  } = {},
) {
  const hasExplicitAgent = typeof agentId === "string" && agentId.trim().length > 0
  const languageDirectives =
    forcedReplyLanguage === "en"
      ? [
          "Language lock: the user explicitly requested English responses.",
          "Reply in English for subsequent turns regardless of user input language until the user explicitly asks to switch language.",
        ]
      : forcedReplyLanguage === "zh"
        ? [
            "Language lock: the user explicitly requested Chinese responses.",
            "Reply in Chinese for subsequent turns regardless of user input language until the user explicitly asks to switch language.",
          ]
        : [
            "Language rule: default to the same language as the user's latest input.",
            "Language rule: only switch languages when the user explicitly asks to do so.",
          ]
  const base = [
    hasExplicitAgent
      ? "You are an enterprise AI chat assistant focused on practical strategy, growth, operations, and execution support."
      : "You are a general-purpose AI chat assistant. Answer the user's request directly and adapt to the task without assuming a business-consulting role.",
    "Identity rule: never claim you are Kiro or a software-development-only assistant.",
    "Identity rule: do not proactively introduce your role or capabilities unless the user asks who you are or asks for an introduction.",
    hasExplicitAgent
      ? "Identity rule: if the user explicitly asks who you are, describe yourself as the selected enterprise advisor or Agent."
      : "Identity rule: do not describe yourself as an enterprise consultant or a specific Agent unless the user explicitly selects one.",
    ...languageDirectives,
    "Prioritize a fast first useful response, then add structure, evidence, and caveats only where they improve the answer.",
    "Provide practical, high-signal answers with concrete next steps; avoid generic filler.",
    "When tools are available, call them only if they materially improve correctness.",
    getAiEntryWebSearchSystemRule({
      webSearchAvailable: Boolean(webSearch.available),
      conversationScope: webSearch.conversationScope,
      consultingModelMode: webSearch.consultingModelMode,
    }),
    hasExplicitAgent
      ? "Ground answers in the user's question and sound consulting practice; do not invent company-specific facts, figures, or policies unless they come from the user or from retrieved enterprise knowledge below."
      : "Ground answers in the user's question and task context; do not assume a consulting role or invent company-specific facts, figures, or policies unless they come from the user or from retrieved enterprise knowledge below.",
  ].filter(Boolean).join("\n")
  const sections = [base]
  if (agentInstruction.trim()) {
    sections.push(`## Agent mode\n${agentInstruction.trim()}`)
  }
  if (customSystemPrompt.trim()) {
    sections.push(`## Custom system instruction\n${customSystemPrompt.trim()}`)
  }
  if (enterpriseKnowledge?.snippets.length) {
    sections.push(buildEnterpriseKnowledgePromptSection(enterpriseKnowledge))
  }
  return sections.join("\n\n")
}

function normalizeCoreMessageContent(content: ModelMessage["content"]) {
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === "string" ? text : ""
      }
      return ""
    })
    .join(" ")
    .trim()
}

function getLatestUserPrompt(messages: ModelMessage[]) {
  const latest = [...messages].reverse().find((item) => item.role === "user")
  if (!latest) return ""
  return extractUserIntentFromMessageContent(latest.content)
}

function getLatestPersistableUserMessageContent(messages: ModelMessage[]) {
  const latest = [...messages].reverse().find((item) => item.role === "user")
  if (!latest) return ""
  return normalizeMessageTextContent(latest.content)
}

function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function getAiEntryUsageTokens(rawUsage: unknown, fallbackInputText: string, fallbackOutputText: string) {
  const usage = rawUsage && typeof rawUsage === "object" ? (rawUsage as Record<string, unknown>) : null
  const inputTokens =
    Number(usage?.inputTokens ?? usage?.promptTokens ?? usage?.prompt_tokens ?? 0) ||
    estimateTextTokens(fallbackInputText)
  const outputTokens =
    Number(usage?.outputTokens ?? usage?.completionTokens ?? usage?.completion_tokens ?? 0) ||
    estimateTextTokens(fallbackOutputText)
  return { inputTokens, outputTokens }
}

function appendUniqueToolAppendix(current: string, next: string | null) {
  if (!next?.trim()) return current
  if (current.includes(next)) return current
  return `${current}${next}`
}

function parseModelConfig(input: ChatRequestBody["modelConfig"]) {
  const rawProviderId =
    typeof input?.providerId === "string" ? input.providerId.trim().toLowerCase() : ""
  let providerId: AiEntryProviderId | null = null
  if (rawProviderId === "crazyrouter") {
    providerId = "crazyroute"
  } else if (
    rawProviderId === "deepseek" ||
    rawProviderId === "pptoken" ||
    rawProviderId === "openrouter" ||
    rawProviderId === "aiberm" ||
    rawProviderId === "crazyroute" ||
    rawProviderId === "enterprise-openai-compatible" ||
    rawProviderId === "enterprise-qwen-official" ||
    rawProviderId === "enterprise-minimax-official" ||
    rawProviderId === "enterprise-glm-official" ||
    rawProviderId === "enterprise-volcengine-official"
  ) {
    providerId = rawProviderId
  }

  if (!providerId) return null

  const modelId =
    typeof input?.modelId === "string" && input.modelId.trim()
      ? input.modelId.trim()
      : null

  return {
    providerId,
    modelId,
    reasoningEffort: typeof input?.reasoningEffort === "string" ? input.reasoningEffort.trim().toLowerCase() : "auto",
  }
}

function resolveSelectedOpenCodeProvider(input: {
  providerId?: string | null
  modelId?: string | null
  enterpriseProviders?: AiEntryProviderConfig[] | null
}) {
  const providerId = input.providerId?.trim().toLowerCase() || ""
  const modelId = input.modelId?.trim() || ""
  if (!providerId || !modelId) return null
  if (isDeprecatedTextModelId(modelId)) return null

  const configuredProviders = [
    ...getConfiguredAiEntryProviders(),
    ...(input.enterpriseProviders || []),
  ]
  const provider = providerId === "pptoken"
    ? getConfiguredAiEntryProviderForModel(providerId, modelId)
    : configuredProviders.find((item) => item.id === providerId)
  if (!provider?.apiKey || !provider.baseURL) return null

  return {
    providerId,
    modelId,
    baseUrl: provider.baseURL,
    apiKey: provider.apiKey,
  } satisfies OpenCodeProviderConfig
}

async function resolveModelConfig(
  input: ReturnType<typeof parseModelConfig>,
  user: {
    id: number
    enterpriseId: number | null
    enterpriseRole: string | null
    enterpriseStatus: string | null
  },
  options?: {
    forceConsultingModel?: boolean
    preferAgentDefaultModel?: boolean
    consultingModelMode?: AiEntryConsultingModelMode
    allowUnavailableRequestedModelFallback?: boolean
  },
) {
  const requestedProviderId = input?.providerId || null
  const requestedSelection = parseAiEntryModelSelection(input?.modelId)
  const effectiveRequestedProviderId =
    requestedProviderId || (requestedSelection?.providerId as AiEntryProviderId | undefined) || null
  const catalog = await getGovernedAiEntryModelCatalogForUser({
    user,
    requestedProviderId: effectiveRequestedProviderId,
  })
  if (catalog.models.length === 0) {
    throw new Error("ai_entry_model_unavailable_for_user")
  }
  const availableModelIds = catalog.models.map((item) => item.id)
  const allCatalogModelAliases = catalog.models.flatMap((item) =>
    [
      item.id,
      item.modelId,
      item.providerId && item.modelId ? serializeAiEntryModelSelection({
        providerId: item.providerId,
        modelId: item.modelId,
      }) : null,
      item.canonicalId,
      item.runtimeId,
      ...(Array.isArray(item.aliases) ? item.aliases : []),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )
  const findCatalogModelOption = (value: string | null | undefined) => {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) return null
    const selection = parseAiEntryModelSelection(normalized)
    return (
      catalog.models.find((item) => {
        if (
          effectiveRequestedProviderId &&
          item.providerId &&
          item.providerId !== effectiveRequestedProviderId
        ) {
          return false
        }
        if (
          selection &&
          item.providerId &&
          item.modelId &&
          item.providerId === selection.providerId &&
          item.modelId === selection.modelId
        ) {
          return true
        }
        const aliases = [
          item.id,
          item.modelId,
          item.providerId && item.modelId
            ? serializeAiEntryModelSelection({
                providerId: item.providerId,
                modelId: item.modelId,
              })
            : null,
          item.canonicalId,
          item.runtimeId,
          ...(Array.isArray(item.aliases) ? item.aliases : []),
        ].filter((candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
        )
        return aliases.includes(normalized)
      }) || null
    )
  }
  const catalogModelsForRequestedProvider = effectiveRequestedProviderId
    ? catalog.models.filter((item) => {
        const optionProviderId =
          item.providerId || parseAiEntryModelSelection(item.id)?.providerId || null
        return optionProviderId === effectiveRequestedProviderId
      })
    : catalog.models
  const agentDefaultModelId = options?.preferAgentDefaultModel
    ? pickAgentDefaultModelId(catalogModelsForRequestedProvider)
    : null
  const providerScopedFallbackModelId =
    catalogModelsForRequestedProvider[0]?.id ||
    catalogModelsForRequestedProvider[0]?.modelId ||
    null
  const catalogFallbackModelId =
    agentDefaultModelId ||
    providerScopedFallbackModelId ||
    // Workflow definitions can outlive an enterprise provider migration. If
    // the saved provider is no longer accessible, use the current governed
    // selection instead of leaving the fallback empty and failing the node.
    catalog.selectedModelId ||
    catalog.models[0]?.id ||
    null
  const requestedModelId = requestedSelection?.modelId || input?.modelId || null
  if (options?.forceConsultingModel) {
    const lockedModelId =
      pickConsultingModelId(catalog.models) ||
      AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT
    const lockedModelOption = findCatalogModelOption(lockedModelId) || null
    const resolvedProviderId =
      (lockedModelOption?.providerId as AiEntryProviderId | undefined) ||
      effectiveRequestedProviderId ||
      catalog.providerId ||
      null
    const resolvedLockedModelId =
      lockedModelOption?.modelId ||
      lockedModelOption?.runtimeId ||
      requestedSelection?.modelId ||
      lockedModelId

    if (requestedModelId && requestedModelId !== resolvedLockedModelId) {
      console.warn("ai-entry.chat.model.locked.override", {
        requestedModelId,
        lockedModelId: resolvedLockedModelId,
        providerId: resolvedProviderId,
      })
    }

    return {
      providerId: resolvedProviderId,
      modelId: resolvedLockedModelId,
      providerModelId: resolvedLockedModelId,
      selectionId:
        lockedModelOption?.id ||
        (resolvedProviderId && resolvedLockedModelId
          ? serializeAiEntryModelSelection({
              providerId: resolvedProviderId,
              modelId: resolvedLockedModelId,
            })
          : null),
    }
  }

  const normalizedRequestedModelId = resolveEquivalentModelId(
    input?.modelId || requestedModelId,
    allCatalogModelAliases.length > 0 ? allCatalogModelAliases : availableModelIds,
  )
  const requestedModelOption =
    findCatalogModelOption(normalizedRequestedModelId || input?.modelId || requestedModelId) || null
  if (requestedModelId && !requestedModelOption && !options?.allowUnavailableRequestedModelFallback) {
    throw new Error("ai_entry_model_unavailable_for_provider")
  }
  if (requestedModelId && !requestedModelOption && options?.allowUnavailableRequestedModelFallback) {
    console.warn("ai-entry.chat.workflow.model.unavailable.fallback", {
      requestedModelId,
      providerId: effectiveRequestedProviderId,
      fallbackModelId: catalogFallbackModelId,
    })
  }
  const fallbackModelOption =
    findCatalogModelOption(catalogFallbackModelId) ||
    (options?.allowUnavailableRequestedModelFallback
      ? catalog.models.find((item) => {
          const normalized = catalogFallbackModelId?.trim() || ""
          if (!normalized) return false
          return [
            item.id,
            item.modelId,
            item.providerId && item.modelId
              ? serializeAiEntryModelSelection({
                  providerId: item.providerId,
                  modelId: item.modelId,
                })
              : null,
            item.canonicalId,
            item.runtimeId,
            ...(Array.isArray(item.aliases) ? item.aliases : []),
          ].some((candidate) => candidate === normalized)
        }) || null
      : null)
  const resolvedModelId =
    requestedModelOption?.modelId ||
    requestedModelOption?.runtimeId ||
    fallbackModelOption?.modelId ||
    fallbackModelOption?.runtimeId ||
    catalogFallbackModelId
  const resolvedSelectionId =
    requestedModelOption?.id ||
    fallbackModelOption?.id ||
    (effectiveRequestedProviderId && resolvedModelId
      ? serializeAiEntryModelSelection({
          providerId: effectiveRequestedProviderId,
          modelId: resolvedModelId,
        })
      : null)
  const resolvedProviderModelId =
    requestedModelOption?.runtimeId ||
    requestedModelOption?.modelId ||
    fallbackModelOption?.runtimeId ||
    fallbackModelOption?.modelId ||
    resolvedModelId
  const resolvedProviderId =
    (requestedModelOption?.providerId as AiEntryProviderId | undefined) ||
    (fallbackModelOption?.providerId as AiEntryProviderId | undefined) ||
    effectiveRequestedProviderId ||
    catalog.providerId

  if (requestedModelId && resolvedModelId !== requestedModelId) {
    console.warn("ai-entry.chat.model.unavailable.fallback", {
      requestedModelId,
      resolvedModelId,
      providerId: resolvedProviderId,
    })
  }

  return {
    providerId: resolvedProviderId,
    modelId: resolvedModelId,
    providerModelId: resolvedProviderModelId,
    selectionId: resolvedSelectionId,
  }
}

function parseAgentConfig(input: ChatRequestBody["agentConfig"]) {
  const rawAgentId =
    typeof input?.agentId === "string" ? input.agentId.trim() : ""
  const resolvedAgentId =
    rawAgentId && (isAiEntryAgentId(rawAgentId) || parseCustomAgentRuntimeId(rawAgentId) !== null)
      ? rawAgentId
      : null
  const lockModelToConsultingModel = false
  const consultingModelMode = resolveConsultingModelMode()
  const rawAgentName =
    typeof input?.agentName === "string" ? input.agentName.trim() : ""

  return {
    agentId: resolvedAgentId,
    agentName: rawAgentName || null,
    lockModelToConsultingModel,
    consultingModelMode,
  }
}

function parseConversationScope(input: ChatRequestBody) {
  if (input.conversationScope === "consulting") return "consulting" as const
  if (input.conversationScope === "chat") return "chat" as const
  if (isConsultingAdvisorEntryMode(input.agentConfig?.entryMode)) {
    return "consulting" as const
  }
  return "chat" as const
}

function buildCustomAgentInstruction(agent: {
  name: string
  summary: string
  goal: string | null
  scope: string | null
  guardrails: string | null
  systemPromptSummary: string | null
  systemPrompt: string
}) {
  const sections = [
    `You are operating as the enterprise custom agent "${agent.name}".`,
    agent.summary.trim() ? `## Agent summary\n${agent.summary.trim()}` : "",
    agent.goal?.trim() ? `## Primary goal\n${agent.goal.trim()}` : "",
    agent.scope?.trim() ? `## Scope\n${agent.scope.trim()}` : "",
    agent.guardrails?.trim() ? `## Guardrails\n${agent.guardrails.trim()}` : "",
    agent.systemPromptSummary?.trim()
      ? `## Prompt summary\n${agent.systemPromptSummary.trim()}`
      : "",
    agent.systemPrompt.trim()
      ? `## Custom agent system prompt\n${agent.systemPrompt.trim()}`
      : "",
  ]

  return sections.filter(Boolean).join("\n\n")
}

async function persistAiEntryTurnSafe(params: {
  userId: number
  conversationId: string
  assistantMessage: string
  scope: AiEntryConversationScope
  agentId?: string | null
}) {
  if (!params.assistantMessage.trim()) return
  try {
    await appendAiEntryMessage({
      userId: params.userId,
      conversationId: params.conversationId,
      role: "assistant",
      content: params.assistantMessage,
      scope: params.scope,
      agentId: params.agentId,
    })
  } catch (error) {
    console.error("ai-entry.chat.persist.failed", {
      conversationId: params.conversationId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function persistAiEntryUserPromptSafe(params: {
  userId: number
  conversationId: string
  userPrompt: string
  scope: AiEntryConversationScope
  agentId?: string | null
}) {
  if (!params.userPrompt.trim()) return false
  try {
    await appendAiEntryMessage({
      userId: params.userId,
      conversationId: params.conversationId,
      role: "user",
      content: params.userPrompt,
      scope: params.scope,
      agentId: params.agentId,
    })
    return true
  } catch (error) {
    console.error("ai-entry.chat.user-persist.failed", {
      conversationId: params.conversationId,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function POST(request: NextRequest) {
  let closeTools: (() => Promise<void>) | null = null
  let aiEntryCreditReservation: BillingReservation | null = null
  let aiEntryCreditFinalized = false
  let billingUserId: number | null = null
  let billingEnterpriseId: number | null = null
  const traceId = createChatTraceId()
  const startedAtMs = Date.now()
  let requestKnowledgeQueryStartedAtMs: number | null = null
  let requestKnowledgeQueryCompletedAtMs: number | null = null
  let blockingProviderStartedAtMs: number | null = null
  try {
    const auth = await requireSessionUser(request)
    if ("response" in auth) {
      return auth.response
    }
    const currentUser = auth.user
    billingUserId = currentUser.id
    billingEnterpriseId = currentUser.enterpriseId

    const body = (await request.json()) as ChatRequestBody
    const customSystemPrompt =
      typeof body.systemPrompt === "string" ? body.systemPrompt.trim().slice(0, 24_000) : ""
    const enterpriseKnowledgeConfig = parseEnterpriseKnowledgeConfig(body.enterpriseKnowledge)
    const attachments = normalizeAttachmentList(body.attachments)
    const requestedMessages = normalizeMessages(Array.isArray(body.messages) ? body.messages : [], attachments)
    const fallbackPrompt = typeof body.message === "string" ? body.message.trim() : ""

    if (!requestedMessages.length && !fallbackPrompt) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const normalizedMessages =
      requestedMessages.length > 0
        ? requestedMessages
        : ([{ role: "user", content: fallbackPrompt }] as ModelMessage[])

    const latestUserPrompt = getLatestUserPrompt(normalizedMessages) || fallbackPrompt
    const latestPersistableUserContent =
      getLatestPersistableUserMessageContent(normalizedMessages) || latestUserPrompt || fallbackPrompt
    const forcedReplyLanguage = resolveForcedReplyLanguage(normalizedMessages)
    const isZh = forcedReplyLanguage !== "en"
    const requestOrigin = request.nextUrl.origin
    const agentConfig = parseAgentConfig(body.agentConfig)
    const conversationScope: AiEntryConversationScope = parseConversationScope(body)
    const requestedModelConfig = parseModelConfig(body.modelConfig)
    const modelConfig = await resolveModelConfig(requestedModelConfig, currentUser, {
      forceConsultingModel: agentConfig.lockModelToConsultingModel,
      preferAgentDefaultModel:
        conversationScope === "consulting" || Boolean(agentConfig.agentId),
      consultingModelMode: agentConfig.consultingModelMode,
      allowUnavailableRequestedModelFallback: body.executionContext === "workflow",
    })
    const resolvedReasoningEffort = normalizeReasoningEffort(
      requestedModelConfig?.reasoningEffort,
      {
        providerId: modelConfig?.providerId || requestedModelConfig?.providerId,
        modelId: modelConfig?.providerModelId || modelConfig?.modelId || requestedModelConfig?.modelId,
      },
    )
    if (attachments.some((attachment) => attachment.mediaType.startsWith("image/"))) {
      const resolvedModelId = modelConfig?.providerModelId || modelConfig?.modelId || null
      if (!modelSupportsImageInput(resolvedModelId)) {
        return NextResponse.json({ error: "unsupported_image_upload" }, { status: 400 })
      }
    }
    if (attachments.some((attachment) => !attachment.mediaType.startsWith("image/") && !attachment.mediaType.startsWith("text/") && !attachment.mediaType.includes("json") && !attachment.mediaType.includes("csv"))) {
      return NextResponse.json({ error: "unsupported_attachment_type" }, { status: 400 })
    }
    let persistenceEnabled = true
    let conversationId = ""
    try {
      const ensuredConversation = await ensureAiEntryConversation(
        currentUser.id,
        body.conversationId,
        latestUserPrompt || "New chat",
        modelConfig?.selectionId || modelConfig?.modelId,
        conversationScope,
        agentConfig.agentId,
      )
      conversationId = ensuredConversation.id
    } catch (error) {
      if (!isSessionDbUnavailableError(error)) {
        throw error
      }

      persistenceEnabled = false
      const clientConversationId =
        typeof body.conversationId === "string" ? body.conversationId.trim() : ""
      conversationId = clientConversationId || `ephemeral-${Date.now()}`
      console.warn("ai-entry.chat.persistence.unavailable", {
        userId: currentUser.id,
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    const stream = body.stream !== false
    const executionContext = parseExecutionContext(body.executionContext)
    let userPromptPersisted = false

    const enterpriseId = currentUser.enterpriseId
    const enterpriseName = normalizeEnterpriseName(currentUser.enterpriseName)
    const knowledgeQueryVariants = buildAiEntryKnowledgeQueryVariants(
      latestUserPrompt,
      enterpriseName,
    )
    const canQueryEnterpriseKnowledge =
      canLoadEnterpriseKnowledgeForUser(currentUser) &&
      enterpriseKnowledgeConfig.enabled &&
      typeof enterpriseId === "number" &&
      enterpriseId > 0 &&
      latestUserPrompt.trim().length > 0
    let shouldQueryEnterpriseKnowledgeForRequest = false

    if (persistenceEnabled) {
      userPromptPersisted = await persistAiEntryUserPromptSafe({
        userId: currentUser.id,
        conversationId,
        userPrompt: latestPersistableUserContent,
        scope: conversationScope,
        agentId: agentConfig.agentId,
      })
    }

    const loadEnterpriseKnowledge = async (
      notifyProgress?: (progress: KnowledgeQueryProgress) => void,
    ) => {
      if (!shouldQueryEnterpriseKnowledgeForRequest) return null

      const queryStartedAtMs = Date.now()
      requestKnowledgeQueryStartedAtMs = queryStartedAtMs

      notifyProgress?.({
        event: "knowledge_query_start",
      })
      try {
        const enterpriseKnowledge = await loadEnterpriseKnowledgeContext({
          enterpriseId,
          query: latestUserPrompt.trim(),
          queryVariants: knowledgeQueryVariants,
          preferredDatasetIds: enterpriseKnowledgeConfig.datasetIds,
          platform: "generic",
          mode: "article",
        })
        notifyProgress?.({
          event: "knowledge_query_result",
          data: {
            status:
              enterpriseKnowledge && enterpriseKnowledge.snippets.length > 0
                ? "hit"
                : "miss",
            snippetCount: enterpriseKnowledge?.snippets.length || 0,
            datasetCount: enterpriseKnowledge?.datasetsUsed.length || 0,
            durationMs: Date.now() - queryStartedAtMs,
          },
        })
        return enterpriseKnowledge
      } catch (error) {
        console.warn("ai-entry.chat.enterprise_knowledge.failed", {
          enterpriseId,
          message: error instanceof Error ? error.message : String(error),
        })
        notifyProgress?.({
          event: "knowledge_query_result",
          data: {
            status: "failed",
            durationMs: Date.now() - queryStartedAtMs,
            message: extractErrorMessage(error),
          },
        })
        return null
      } finally {
        requestKnowledgeQueryCompletedAtMs = Date.now()
        console.info("ai-entry.chat.knowledge_query", {
          traceId,
          conversationId,
          enterpriseId,
          knowledge_ms:
            requestKnowledgeQueryStartedAtMs === null
              ? null
              : requestKnowledgeQueryCompletedAtMs - requestKnowledgeQueryStartedAtMs,
          enabled: shouldQueryEnterpriseKnowledgeForRequest,
        })
      }
    }

    const skillsEnabled = body.skillConfig?.enabled !== false
    const enabledToolNames = parseEnabledToolNames(body.skillConfig?.enabledToolNames)
    const enabledSkillIds = parseEnabledSkillIds(body.skillConfig?.enabledSkillIds)
    const consultingRuntime = await prepareAiEntryConsultingRuntime({
      latestUserPrompt,
      requestedAgentId: agentConfig.agentId,
      lockModelToConsultingModel: agentConfig.lockModelToConsultingModel,
      skillsEnabled,
      enabledSkillIds,
    })
    const {
      skillRouteDecision,
      selectedSkills,
      selectedSkillIds,
      runtimePolicy,
    } = consultingRuntime
    let { effectiveAgentId, routeDecision, resolvedInstruction } = consultingRuntime
    const customAgentId = parseCustomAgentRuntimeId(agentConfig.agentId)
    let customSkillBindings: Record<string, unknown> | null = null
    if (customAgentId !== null) {
      if (typeof currentUser.enterpriseId !== "number" || currentUser.enterpriseId <= 0) {
        return NextResponse.json({ error: "custom_agent_not_found" }, { status: 404 })
      }
      const customAgent = await getCustomAgentForUser({
        agentId: customAgentId,
        enterpriseId: currentUser.enterpriseId,
        userId: currentUser.id,
        isEnterpriseAdmin: currentUser.enterpriseRole === "admin" && currentUser.enterpriseStatus === "active",
      })
      if (!customAgent) {
        return NextResponse.json({ error: "custom_agent_not_found" }, { status: 404 })
      }
      if (customAgent.status === "disabled") {
        return NextResponse.json({ error: "custom_agent_disabled" }, { status: 403 })
      }
      if (customAgent.status === "archived") {
        return NextResponse.json({ error: "custom_agent_archived" }, { status: 403 })
      }
      if (customAgent.executionMode !== "direct_agent") {
        return NextResponse.json({ error: "custom_agent_workflow_backed_chat_not_supported" }, { status: 409 })
      }
      customSkillBindings = customAgent.skillBindings
      effectiveAgentId = agentConfig.agentId
      routeDecision = null
      resolvedInstruction = [
        buildCustomAgentInstruction(customAgent),
        resolvedInstruction,
      ]
        .map((section) => section.trim())
        .filter(Boolean)
        .join("\n\n")
    }
    shouldQueryEnterpriseKnowledgeForRequest = shouldQueryAiEntryEnterpriseKnowledge({
      canQueryEnterpriseKnowledge,
      effectiveAgentId,
    })
    const normalizedMessageContents = normalizedMessages.map((message) => normalizeCoreMessageContent(message.content))
    // Editable PPT brief meaning is resolved by update_ppt_brief, not by parsing user text here.
    const pptBriefState = null
    const conversationState = resolveAiEntryConversationStateFromContents(normalizedMessageContents)
    const latestBriefConfirmationContext = normalizedMessageContents
      .map((content) => extractLatestPptBriefConfirmationContext(content))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .at(-1) ?? null
    const latestTemplateRecommendationContext = normalizedMessageContents
      .map((content) => extractLatestPptTemplateRecommendationContext(content))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .at(-1) ?? null
    const effectivePptBriefState = latestBriefConfirmationContext
      ? createPptBriefStateFromConfirmationContext(latestBriefConfirmationContext)
      : pptBriefState
    // In the migrated mode OpenCode owns the conversation and invokes native
    // ppt-master directly. The brief/template prompt sections remain only for
    // the native fallback path, so old persisted brief metadata cannot force
    // the new assistant back into the fixed workflow.
    const editablePptOpenCodeEnabled = resolveEditablePptRailwayRuntimeProfile().enabled
    const useLegacyPptBriefFlow = effectiveAgentId === "executive-ppt" && !editablePptOpenCodeEnabled
    if (useLegacyPptBriefFlow && effectivePptBriefState) {
      resolvedInstruction = [resolvedInstruction, buildPptBriefPromptSection(effectivePptBriefState)]
        .map((section) => section.trim())
        .filter(Boolean)
        .join("\n\n")
    }
    if (useLegacyPptBriefFlow && !effectivePptBriefState) {
      resolvedInstruction = [resolvedInstruction, buildPptBriefConversationPromptSection()]
        .map((section) => section.trim())
        .filter(Boolean)
        .join("\n\n")
    }
    if (
      executionContext !== "workflow" &&
      useLegacyPptBriefFlow &&
      latestTemplateRecommendationContext
    ) {
      resolvedInstruction = [
        resolvedInstruction,
        buildPptTemplateSelectionPromptSection(latestTemplateRecommendationContext, isZh),
      ]
        .map((section) => section.trim())
        .filter(Boolean)
        .join("\n\n")
    }
    if (executionContext !== "workflow" && useLegacyPptBriefFlow) {
      resolvedInstruction = [
        resolvedInstruction,
        buildPptTemplateCatalogPromptSection(getPptMasterTemplateCatalog(), isZh),
      ]
        .map((section) => section.trim())
        .filter(Boolean)
        .join("\n\n")
    }

    const nativePptMasterOnly = editablePptOpenCodeEnabled && (
      effectiveAgentId === "executive-ppt" || selectedSkillIds.includes("ppt-master")
    )
    const toolRegistry = nativePptMasterOnly
      ? {
          selectedTools: {},
          selectedToolIds: [],
          closeTools: null,
          toolLoadWarnings: [],
          selectedMcpServerIds: [],
        }
      : await buildAiEntryToolRegistry({
          currentUser,
          policy: runtimePolicy,
          selectedSkills,
          skillsEnabled,
          enabledToolNames,
          executionContext,
          conversationScope,
          pptBriefState: effectivePptBriefState,
          conversationState,
          latestUserPrompt,
          messageContents: normalizedMessageContents,
          selectedPreviewModel:
            modelConfig?.providerModelId || modelConfig?.modelId || null,
          selectedPreviewProviderId: modelConfig?.providerId || null,
          auditContext: {
            traceId,
            conversationId,
            agentId: effectiveAgentId,
          },
        })
    const {
      selectedTools: effectiveSelectedTools,
      selectedToolIds: effectiveSelectedToolIds,
      closeTools: loadedCloseTools,
      toolLoadWarnings,
      selectedMcpServerIds,
    } = toolRegistry
    if (loadedCloseTools) {
      closeTools = loadedCloseTools
    }
    for (const warning of toolLoadWarnings) {
      console.warn("ai-entry.chat.mcp-tools.load.failed", {
        message: warning,
      })
    }

    const defaultRuntimeProfile = resolveDefaultAgentRuntimeProfile()
    const runtimeDecision = resolveAiEntryRuntimeDecision({
      latestUserPrompt,
      agentId: effectiveAgentId,
      selectedSkillIds,
      selectedToolIds: effectiveSelectedToolIds,
      selectedMcpServerIds,
      enabledToolNames,
      executionContext,
      requiresNativeAttachment: attachments.some((attachment) => attachment.mediaType.startsWith("image/")),
    })
    if (effectiveAgentId === "executive-presentation-ppt" && runtimeDecision.kind === "ai-sdk-native") {
      throw new Error("dashi_opencode_runtime_not_configured")
    }
    const sharedSkillSetSelection = isAiEntrySharedAgentRuntimeEnabled(effectiveAgentId)
      ? resolveSharedSkillSetSelection({
          agentId: effectiveAgentId,
          enterpriseId: currentUser.enterpriseId,
          selectedSkillIds,
          allowedSkillIds: runtimePolicy.allowedSkillIds,
          customSkillBindings,
        })
      : null
    const businessAgentRuntime = isBusinessAgentId(effectiveAgentId)
    const runtimeProfile = runtimeDecision.kind === "opencode-chat"
      ? businessAgentRuntime
        ? resolveBusinessAgentRailwayRuntimeProfile()
        : (effectiveAgentId === "executive-presentation-ppt" || selectedSkillIds.includes("dashiai-ppt"))
          ? resolveDashiPptCloudflareRuntimeProfile()
          : resolveEditablePptRailwayRuntimeProfile()
      : defaultRuntimeProfile
    let persistedRuntimeArtifacts: Array<{ artifactId: number; title: string; kind: string; summary: string }> = []
    let projectSnapshot: RuntimeProjectSnapshot | null = null
    let conversationContextSummary: string | null = null
    let canonicalConversationRevision: number | null = null
    let canonicalRuntimeMessages = normalizedMessages.map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: normalizeCoreMessageContent(message.content),
    }))
    if (runtimeDecision.kind === "opencode-chat" && persistenceEnabled && /^\d+$/.test(conversationId)) {
      try {
        const conversationPage = await listAiEntryMessages(currentUser.id, conversationId, 200, conversationScope, agentConfig.agentId)
        persistedRuntimeArtifacts = conversationPage?.conversation_state.artifacts || []
        conversationContextSummary = conversationPage?.conversation_context_summary || null
        if (runtimeProfile.backend === "railway-opencode" && (effectiveAgentId === "executive-ppt" || selectedSkillIds.includes("ppt-master"))) {
          projectSnapshot = conversationPage?.conversation_state.projectSnapshot || null
        }
        if (conversationPage?.data?.length) {
          const lastMessageId = Number(conversationPage.data.at(-1)?.id)
          canonicalConversationRevision = Number.isSafeInteger(lastMessageId) && lastMessageId > 0 ? lastMessageId : conversationPage.data.length
          canonicalRuntimeMessages = conversationPage.data.map((message) => ({
            role: message.role === "assistant" ? "assistant" as const : "user" as const,
            content: normalizeCoreMessageContent(message.content),
          })).filter((message) => message.content.length > 0)
          const nextContextSummary = buildPersistedConversationSummary(canonicalRuntimeMessages, conversationContextSummary)
          if (nextContextSummary && nextContextSummary !== conversationContextSummary) {
            conversationContextSummary = nextContextSummary
            void recordAiEntryConversationContextSummary({
              userId: currentUser.id,
              conversationId,
              summary: nextContextSummary,
              scope: conversationScope,
              agentId: agentConfig.agentId,
            }).catch((error) => {
              console.warn("ai-entry.opencode.context_summary.persist_failed", {
                conversationId,
                message: error instanceof Error ? error.message : String(error),
              })
            })
          }
        }
      } catch (error) {
        console.warn("ai-entry.opencode.artifact_context.load_failed", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (routeDecision) {
      console.info("ai-entry.chat.agent.auto-routed", {
        requestedAgentId: agentConfig.agentId,
        effectiveAgentId,
        confidence: routeDecision.confidence,
        score: routeDecision.score,
        fallback: routeDecision.fallback,
        matchedSignals: routeDecision.matchedSignals,
      })
    }

    if (skillRouteDecision) {
      console.info("ai-entry.chat.skill-routed", {
        traceId,
        conversationId,
        selectedSkillIds,
        reasons: skillRouteDecision.reasons,
      })
    }

    const maxStepCount = resolveAiEntryMaxStepCount(runtimePolicy, effectiveSelectedToolIds.length > 0)
    const stopWhen = stepCountIs(maxStepCount)
    const enterpriseTextRuntime = await getEnterpriseTextRuntimeProviderConfigsForUser(
      currentUser,
    )
    const selectedProviderId = modelConfig?.providerId || enterpriseTextRuntime?.selectedProviderId || undefined
    // Public demo sessions must use the low-latency lead-generation model even
    // when the demo account inherits an enterprise provider selection. Keep
    // explicit model choices and authenticated workspace governance intact.
    const publicDemoModelOverride =
      currentUser.isDemo && !requestedModelConfig?.providerId && !requestedModelConfig?.modelId
        ? process.env.AI_ENTRY_DEEPSEEK_MODEL?.trim() ||
          process.env.DEEPSEEK_MODEL?.trim() ||
          "deepseek-v4-pro"
        : ""
    const preferredExecutionModel =
      publicDemoModelOverride ||
      modelConfig?.providerModelId ||
      modelConfig?.modelId ||
      enterpriseTextRuntime?.selectedModelId ||
      ""
    const configuredProviders = getConfiguredAiEntryProviders()
    const selectedConfiguredProvider = selectedProviderId && preferredExecutionModel
      ? selectedProviderId === "pptoken"
        ? getConfiguredAiEntryProviderForModel(selectedProviderId, preferredExecutionModel)
        : configuredProviders.find((provider) => provider.id === selectedProviderId) || null
      : null
    const executionProviderConfigs = selectedProviderId === "pptoken"
      ? selectedConfiguredProvider
        ? [
            selectedConfiguredProvider,
            ...configuredProviders.filter((provider) => provider.id !== selectedConfiguredProvider.id),
          ]
        : []
      : configuredProviders
    const providerOptions: ProviderOptions = {
      preferredProviderId: selectedProviderId,
      preferredModel: preferredExecutionModel || undefined,
      reasoningEffort: resolvedReasoningEffort,
      disableProviderFailover: true,
      disableSameProviderModelFallback: true,
      directProviderFailoverOnError: false,
      ...(selectedProviderId === "pptoken"
        ? { providerConfigs: executionProviderConfigs }
        : enterpriseTextRuntime?.providerConfigs?.length
        ? {
            providerConfigs:
              modelConfig?.providerId && modelConfig.providerId !== "enterprise-openai-compatible"
                ? [
                    ...executionProviderConfigs,
                    ...enterpriseTextRuntime.providerConfigs.filter(
                      (enterpriseProvider) =>
                        !executionProviderConfigs.some(
                          (configuredProvider) => configuredProvider.id === enterpriseProvider.id,
                        ),
                    ),
                  ]
                : enterpriseTextRuntime.providerConfigs,
          }
        : {}),
      ...(agentConfig.lockModelToConsultingModel
        ? {
            forceModelAcrossProviders: true,
          }
        : {}),
      ...(selectedProviderId
        ? {
            forcePreferredProvider: true,
          }
        : {}),
    }

    const isDashiPresentationAgent = effectiveAgentId === "executive-presentation-ppt"
    const isEditablePptAgent = effectiveAgentId === "executive-ppt" || selectedSkillIds.includes("ppt-master")
    const explicitPptProviderId = requestedModelConfig?.providerId?.trim().toLowerCase()
    const explicitPptModel = requestedModelConfig?.modelId?.trim()
    if (explicitPptModel && isDeprecatedTextModelId(explicitPptModel)) {
      throw new Error("deprecated_text_model_unavailable")
    }
    const hasExplicitModelSelection = Boolean(explicitPptProviderId && explicitPptModel)
    const explicitRuntimeProviderId = hasExplicitModelSelection
      ? (modelConfig?.providerId || explicitPptProviderId)
      : null
    const explicitRuntimeModelId = hasExplicitModelSelection
      ? (modelConfig?.providerModelId || modelConfig?.modelId || explicitPptModel)
      : null
    const useOpenRouterPpt = explicitRuntimeProviderId === "openrouter"
    const pptProviderId: OpenCodeProviderConfig["providerId"] =
      (explicitRuntimeProviderId as OpenCodeProviderConfig["providerId"] | null) || "pptoken"
    const pptModelId = explicitRuntimeModelId
      ? explicitRuntimeModelId.replace(/^x-ai\//iu, "")
      : useOpenRouterPpt
        ? process.env.AI_ENTRY_OPENROUTER_GROK_MODEL?.trim() || process.env.OPENROUTER_GROK_MODEL?.trim() || "x-ai/grok-4.5"
        : process.env.AI_ENTRY_PPTOKEN_MODEL?.trim() || "grok-4.5"
    const shouldUseDefaultPptProvider = !hasExplicitModelSelection || pptProviderId === "pptoken" || pptProviderId === "openrouter"
    const configuredPptProvider = shouldUseDefaultPptProvider
      ? useOpenRouterPpt
        ? getConfiguredAiEntryProviders().find((provider) => provider.id === "openrouter") || null
        : getConfiguredAiEntryProviderForModel("pptoken", pptModelId)
      : null
    const pptokenProvider: OpenCodeProviderConfig | undefined = (isDashiPresentationAgent || isEditablePptAgent) && runtimeDecision.kind === "opencode-chat" && shouldUseDefaultPptProvider
      ? (() => {
          if (!configuredPptProvider) {
            throw new Error("ai_entry_model_unavailable_for_provider")
          }
          return {
            providerId: pptProviderId,
            modelId: pptModelId,
            baseUrl: configuredPptProvider.baseURL,
            apiKey: configuredPptProvider.apiKey,
          }
        })()
      : undefined
    // OpenCode receives the exact provider selected in the application. This
    // keeps the runtime model hint and signed provider credentials aligned;
    // otherwise a selected PPToken/Grok model could be executed against a
    // different provider and fail over to an unrelated gateway.
    const selectedOpenCodeProvider = resolveSelectedOpenCodeProvider({
      providerId: modelConfig?.providerId,
      modelId: modelConfig?.providerModelId || modelConfig?.modelId,
      enterpriseProviders: enterpriseTextRuntime?.providerConfigs || null,
    })
    const openCodeProvider: OpenCodeProviderConfig = pptokenProvider || selectedOpenCodeProvider || {
      providerId: "deepseek",
      modelId: modelConfig?.providerId?.trim().toLowerCase() === "deepseek" && modelConfig.providerModelId?.trim()
        ? modelConfig.providerModelId.trim()
        : process.env.AI_ENTRY_DEEPSEEK_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
      baseUrl: process.env.AI_ENTRY_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      apiKey: process.env.AI_ENTRY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    }
    const editablePptModelHint = (() => {
      const model = resolveOpenCodeModelHint({
        providerId: pptProviderId,
        modelId: pptModelId,
      }) || pptModelId
      return model.includes("/") ? model : `${pptProviderId}/${model}`
    })()
    const prepareSharedSkillSet = async () => {
      if (!sharedSkillSetSelection) return null
      // Railway images contain the governed business-agent bundle. Keep the
      // selection in the signed runtime input without requiring a remote bundle
      // fetch for every request; Railway hydrates the immutable image bundle.
      if (runtimeProfile.backend === "railway-opencode") return sharedSkillSetSelection
      try {
        const result = await upsertSharedSkillSetBundle({
          selection: sharedSkillSetSelection,
          agentInstructions: resolvedInstruction,
        })
        if (!result.configured) {
          console.warn("ai-entry.shared-agent.bundle.unconfigured", { agentId: effectiveAgentId, bundleKey: sharedSkillSetSelection.bundleKey })
          return null
        }
        return sharedSkillSetSelection
      } catch (error) {
        console.warn("ai-entry.shared-agent.bundle.failed", {
          agentId: effectiveAgentId,
          bundleKey: sharedSkillSetSelection.bundleKey,
          message: extractErrorMessage(error),
        })
        return null
      }
    }
    // Bundle publication is part of selecting the shared session runtime. If
    // R2 is not configured or fails validation, preserve the existing
    // OpenCode path instead of entering a session without governed Skills.
    const preparedSharedSkillSetSelection = isOpenCodeRuntimeDecision(runtimeDecision)
      ? await prepareSharedSkillSet()
      : null
    if (isOpenCodeRuntimeDecision(runtimeDecision) && sharedSkillSetSelection && !preparedSharedSkillSetSelection && runtimeProfile.backend === "railway-opencode") {
      throw new Error("shared_agent_bundle_unavailable")
    }
    // The resolved shared selection includes the Agent's governed base Skill
    // as well as request-routed Skills. Surface that exact set to the UI so
    // “resolved” never understates what OpenCode received.
    const resolvedSkillIdsForUi = preparedSharedSkillSetSelection
      ? preparedSharedSkillSetSelection.skills.map((skill) => skill.id)
      : selectedSkillIds
    const buildChatRuntimeInput = async (systemPrompt: string) => buildAgentRuntimeInput({
      runId: randomUUID(),
      sessionKey:
        (runtimeProfile.backend === "railway-opencode" || runtimeProfile.backend === "cloudflare-opencode-session") && conversationId
          ? await buildAgentRuntimeSessionKey({
              enterpriseId: currentUser.enterpriseId,
              userId: currentUser.id,
              conversationId,
              agentId: effectiveAgentId,
            })
          : (effectiveAgentId === "executive-ppt" || effectiveAgentId === "executive-presentation-ppt") && conversationId
            ? `ppt-${currentUser.id}-${conversationId}`
            : null,
      conversationId,
      conversationRevision: canonicalConversationRevision,
      enterpriseId: currentUser.enterpriseId,
      userId: currentUser.id,
      agentId: effectiveAgentId,
      selectedSkillIds,
      sharedSkillSetSelection: preparedSharedSkillSetSelection,
      systemPrompt,
      messages: canonicalRuntimeMessages,
      attachments: attachments.map((attachment) => ({
        id: attachment.name,
        fileName: attachment.name,
        mimeType: attachment.mediaType,
        textSummary: attachment.text,
      })),
      artifactContext: persistedRuntimeArtifacts,
      projectSnapshot,
      workflowContext: null,
      conversationSummary: conversationContextSummary,
      modelHint:
        isDashiPresentationAgent || isEditablePptAgent
          ? editablePptModelHint
          : resolveOpenCodeModelHint({
              providerId: modelConfig?.providerId,
              modelId: modelConfig?.providerModelId,
            }),
      reasoningEffort: resolvedReasoningEffort,
      allowNetwork: true,
      profileLimits: {
        maxArtifacts: runtimeProfile.maxArtifacts,
        maxArtifactBytes: runtimeProfile.maxArtifactBytes,
        maxArtifactTotalBytes: runtimeProfile.maxArtifactTotalBytes,
      },
    })

    const persistRuntimeProjectSnapshot = async (snapshot: RuntimeProjectSnapshot) => {
      if (runtimeProfile.backend !== "railway-opencode" || !isEditablePptAgent || !conversationId || !persistenceEnabled) return
      projectSnapshot = snapshot
      await recordAiEntryRuntimeProjectSnapshot({
        userId: currentUser.id,
        conversationId,
        projectSnapshot: snapshot,
        scope: conversationScope,
        agentId: agentConfig.agentId,
      }).catch((error) => {
        console.warn("ai-entry.opencode.project_snapshot.persist_failed", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        })
      })
    }

    console.info("ai-entry.chat.request.start", {
      traceId,
      userId: currentUser.id,
      conversationId,
      stream,
      scope: conversationScope,
      lockModel: agentConfig.lockModelToConsultingModel,
      consultingModelMode: agentConfig.consultingModelMode,
      selectedAgentId: effectiveAgentId,
      selectedSkillIds,
      selectedMcpServerIds,
      modelProviderId: modelConfig?.providerId || null,
      modelId: modelConfig?.modelId || null,
      providerModelId: modelConfig?.providerModelId || null,
      attachmentCount: attachments.length,
      selectedToolIds: effectiveSelectedToolIds,
      runtime: runtimeDecision.kind,
      knowledge_query_enabled: shouldQueryEnterpriseKnowledgeForRequest,
    })

    const shouldReserveAiEntryCredits =
      !currentUser.isDemo && !hasCustomAiChatModelSelection(body.modelConfig)
    if (shouldReserveAiEntryCredits) {
      const reserveEstimate = estimateTextCredits({
        featureKey: "ai_entry_chat",
        inputTokens: estimateTextTokens(
          [customSystemPrompt, ...normalizedMessages.map((message) => normalizeCoreMessageContent(message.content))]
            .filter(Boolean)
            .join("\n"),
        ),
        outputTokens: 4_000,
        provider: modelConfig?.providerId || null,
        model: modelConfig?.providerModelId || modelConfig?.modelId || null,
      })
      try {
        aiEntryCreditReservation = await reserveFeatureCredits({
          userId: currentUser.id,
          enterpriseId: currentUser.enterpriseId,
          featureKey: "ai_entry_chat",
          amount: reserveEstimate.credits,
          idempotencyKey: `ai-entry:${conversationId}:${traceId}:reserve`,
          metadata: {
            conversationId,
            traceId,
            estimate: reserveEstimate,
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === "insufficient_credits") {
          return NextResponse.json({ error: "insufficient_credits" }, { status: 402 })
        }
        throw error
      }
    }

    if (!stream) {
      const enterpriseKnowledge = await loadEnterpriseKnowledge()
      const systemPrompt = buildAiEntrySystemPrompt(
        enterpriseKnowledge,
        resolvedInstruction,
        customSystemPrompt,
        latestUserPrompt,
        forcedReplyLanguage,
        effectiveAgentId,
        {
          available: Boolean(effectiveSelectedTools.web_search),
          conversationScope,
          consultingModelMode: agentConfig.consultingModelMode,
        },
      )
      if (isOpenCodeRuntimeDecision(runtimeDecision) && runtimeProfile.sessionEnabled && runtimeProfile.asyncEnabled) {
        const runtimeInput = await buildChatRuntimeInput(systemPrompt)
        const queued = await createBackgroundOpenCodeRun({
          currentUser,
          runtimeInput,
          functionId: effectiveAgentId,
          selectedSkillIds,
          selectedMcpServerIds,
          traceId,
          billingReservation: aiEntryCreditReservation,
          provider: openCodeProvider,
          backend: runtimeProfile.backend === "cloudflare-opencode-session" ? "cloudflare-opencode-session" : "railway-opencode",
        })
        aiEntryCreditFinalized = true
        const queueMessage = isZh ? "任务已提交，关闭页面后仍会继续执行。" : "Task queued; execution continues after you leave this page."
        return NextResponse.json({
          message: queueMessage,
          conversationId,
          persisted: persistenceEnabled,
          provider: "opencode",
          providerModel: runtimeInput.modelHint || "opencode",
          agentId: effectiveAgentId,
          agentRoute: routeDecision,
          providerOrder: ["opencode"],
          toolCalls: [],
          pending_task: {
            task_id: String(queued.taskRunId),
            status: "pending",
            task_type: "opencode_agent_run",
            conversation_id: conversationId,
            agent_id: effectiveAgentId,
            stage: "runtime_queued",
            stage_label: queueMessage,
            runtime_run_id: queued.runtimeRunId,
          },
        })
      }
      if (isOpenCodeRuntimeDecision(runtimeDecision)) {
        const runtimeInput = await buildChatRuntimeInput(systemPrompt)
        let openCodeAnswer = ""
        const publishedArtifacts: Array<Record<string, unknown>> = []
        try {
          for await (const event of runOpenCodeAgent(runtimeInput, {
            runnerUrl: runtimeProfile.runnerUrl,
            backend: runtimeProfile.backend === "cloudflare-opencode-session" ? "cloudflare-opencode-session" : "railway-opencode",
            railway: runtimeProfile.backend === "railway-opencode",
            timeoutMs: runtimeProfile.timeoutMs,
            provider: openCodeProvider,
            session: runtimeProfile.sessionEnabled,
          })) {
            if (event.event === "text_delta") {
              openCodeAnswer += event.delta
            } else if (event.event === "checkpoint_saved" && event.checkpoint.projectSnapshot) {
              await persistRuntimeProjectSnapshot(event.checkpoint.projectSnapshot)
            } else if (event.event === "artifact_payload") {
              const published = await publishRuntimeArtifact({
                currentUser,
                conversationId,
                runId: runtimeInput.runId,
                artifact: event.artifact,
                limits: runtimeInput.artifactContract,
                conversationScope,
                agentId: agentConfig.agentId,
              })
              publishedArtifacts.push(published)
            } else if (event.event === "artifact_reference") {
              const published = await publishRuntimeArtifactReference({
                currentUser,
                conversationId,
                runId: runtimeInput.runId,
                artifact: event.artifact,
                limits: runtimeInput.artifactContract,
                conversationScope,
                agentId: agentConfig.agentId,
              })
              publishedArtifacts.push(published)
            }
          }
          if (!openCodeAnswer.trim()) throw new Error("ai_entry_empty_response")
          const normalizedAssistantMessage = normalizeAiEntryIdentity(
            openCodeAnswer,
            latestUserPrompt,
            forcedReplyLanguage,
            effectiveAgentId,
          )
          if (persistenceEnabled) {
            await persistAiEntryTurnSafe({
              userId: currentUser.id,
              conversationId,
              assistantMessage: normalizedAssistantMessage,
              scope: conversationScope,
              agentId: agentConfig.agentId,
            })
          }
          const usageTokens = getAiEntryUsageTokens(null, normalizedMessages.map((message) => normalizeCoreMessageContent(message.content)).join("\n"), normalizedAssistantMessage)
          const actualCost = estimateTextCredits({
            featureKey: "ai_entry_chat",
            inputTokens: usageTokens.inputTokens,
            outputTokens: usageTokens.outputTokens,
            provider: "opencode",
            model: runtimeInput.modelHint || "opencode",
          })
          await finalizeReservedCredits({
            reservation: aiEntryCreditReservation,
            userId: currentUser.id,
            enterpriseId: currentUser.enterpriseId,
            actualAmount: actualCost.credits,
            idempotencyKey: `ai-entry:${conversationId}:${traceId}:debit`,
            provider: "opencode",
            model: runtimeInput.modelHint || "opencode",
            officialCostUsd: actualCost.officialCostUsd,
            costBasisUsd: actualCost.costBasisUsd,
            usagePayload: actualCost.metadata,
            metadata: { conversationId, traceId, runtime: "opencode" },
          }).catch((error) => {
            console.warn("ai-entry.billing.finalize.failed", { conversationId, message: extractErrorMessage(error) })
          })
          aiEntryCreditFinalized = true
          return NextResponse.json({
            message: normalizedAssistantMessage,
            conversationId,
            persisted: persistenceEnabled,
            provider: "opencode",
            providerModel: runtimeInput.modelHint || "opencode",
            agentId: effectiveAgentId,
            agentRoute: routeDecision,
            providerOrder: [],
            toolCalls: [],
            artifacts: publishedArtifacts,
          })
        } catch (error) {
          console.warn("ai-entry.opencode.failed", {
            traceId,
            conversationId,
            message: extractErrorMessage(error),
          })
          throw error
        }
      }
      const execution = await runAiEntryConsultingBlocking({
        systemPrompt,
        messages: normalizedMessages,
      selectedTools: effectiveSelectedTools,
      toolChoice: toolRegistry.toolChoice,
      stopWhen,
      providerOptions,
        onProviderAttempt: (providerRun) => {
          if (blockingProviderStartedAtMs === null) blockingProviderStartedAtMs = Date.now()
          console.info("ai-entry.chat.provider.attempt", {
            traceId,
            conversationId,
            provider: providerRun.providerId,
            model: providerRun.model,
            attempt: providerRun.attempt,
          })
        },
        onProviderSuccess: (providerRun) => {
          console.info("ai-entry.chat.provider.success", {
            traceId,
            conversationId,
            provider: providerRun.providerId,
            model: providerRun.model,
            attempt: providerRun.attempt,
            outputChars: providerRun.outputChars,
            streamed: false,
          })
        },
        onEmptyResponseRetry: ({ retryAttempt, retryLimit }) => {
          console.warn("ai-entry.chat.empty_response.retry", {
            traceId,
            conversationId,
            streamed: false,
            retryAttempt,
            retryLimit,
          })
        },
      })
      const blockingToolAppendix = Array.isArray((execution.result as { toolResults?: unknown }).toolResults)
        ? ((execution.result as { toolResults: Array<{ toolName?: unknown; result?: unknown; output?: unknown }> }).toolResults)
            .map((toolResult) =>
              buildPptToolResultMessage({
                toolName: typeof toolResult.toolName === "string" ? toolResult.toolName : "",
                result: toolResult.result ?? toolResult.output ?? null,
                origin: requestOrigin,
                isZh,
              }),
            )
            .filter((value): value is string => Boolean(value))
            .join("")
        : ""
      const normalizedAssistantMessage = normalizeAiEntryIdentity(
        `${execution.result.text || ""}${blockingToolAppendix}`,
        latestUserPrompt,
        forcedReplyLanguage,
        effectiveAgentId,
      )
      const blockingToolCalls =
        execution.result.toolCalls?.map((call: { toolCallId: string; toolName: string }) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
        })) ?? []
      const blockingBriefUpdateExecuted = blockingToolCalls.some(
        (call) => call.toolName === "update_ppt_brief",
      )
      const autoPreview = await maybeAutoRunPptPreview({
        agentId: effectiveAgentId,
        executionContext,
        latestUserPrompt,
        assistantMessage: normalizedAssistantMessage,
        briefState: effectivePptBriefState,
        previewAlreadyExecuted:
          blockingBriefUpdateExecuted || blockingToolCalls.some((call) => call.toolName === "preview_ppt_deck"),
        messageContents: normalizedMessageContents,
        previewTool:
          effectiveSelectedTools.preview_ppt_deck &&
          typeof effectiveSelectedTools.preview_ppt_deck === "object"
            ? (effectiveSelectedTools.preview_ppt_deck as { execute?: (input: unknown) => Promise<unknown> | unknown })
            : null,
        origin: requestOrigin,
        isZh,
      })
      const resolvedAssistantMessage = autoPreview.assistantMessage
      const resolvedBlockingToolCalls = autoPreview.autoPreviewExecuted
        ? [...blockingToolCalls, { toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID, toolName: "preview_ppt_deck" }]
        : blockingToolCalls

      if (persistenceEnabled) {
        await persistAiEntryTurnSafe({
          userId: currentUser.id,
          conversationId,
          assistantMessage: resolvedAssistantMessage,
          scope: conversationScope,
          agentId: agentConfig.agentId,
        })
      }

      const usageTokens = getAiEntryUsageTokens(
        (execution.result as { usage?: unknown }).usage,
        normalizedMessages.map((message) => normalizeCoreMessageContent(message.content)).join("\n"),
        resolvedAssistantMessage,
      )
      const actualCost = estimateTextCredits({
        featureKey: "ai_entry_chat",
        inputTokens: usageTokens.inputTokens,
        outputTokens: usageTokens.outputTokens,
        provider: execution.providerId,
        model: execution.model,
      })
      await finalizeReservedCredits({
        reservation: aiEntryCreditReservation,
        userId: currentUser.id,
        enterpriseId: currentUser.enterpriseId,
        actualAmount: actualCost.credits,
        idempotencyKey: `ai-entry:${conversationId}:${traceId}:debit`,
        provider: execution.providerId,
        model: execution.model,
        officialCostUsd: actualCost.officialCostUsd,
        costBasisUsd: actualCost.costBasisUsd,
        usagePayload: actualCost.metadata,
        metadata: { conversationId, traceId },
      }).catch((error) => {
        console.warn("ai-entry.billing.finalize.failed", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      aiEntryCreditFinalized = true

      console.info("ai-entry.chat.request.done", {
        traceId,
        conversationId,
        provider: execution.providerId,
        model: execution.model,
        persisted: persistenceEnabled,
        elapsedMs: Date.now() - startedAtMs,
        knowledge_ms:
          requestKnowledgeQueryStartedAtMs === null || requestKnowledgeQueryCompletedAtMs === null
            ? null
            : requestKnowledgeQueryCompletedAtMs - requestKnowledgeQueryStartedAtMs,
        pre_model_ms:
          blockingProviderStartedAtMs === null ? null : blockingProviderStartedAtMs - startedAtMs,
        provider_first_token_ms: null,
      })

      return NextResponse.json({
        message: resolvedAssistantMessage,
        conversationId,
        persisted: persistenceEnabled,
        provider: execution.providerId,
        providerModel: execution.model,
        agentId: effectiveAgentId,
        agentRoute: routeDecision,
        providerOrder: execution.providerOrder,
        toolCalls: resolvedBlockingToolCalls,
      })
    }

    const encoder = new TextEncoder()
    const responseStream = new ReadableStream({
      async start(controller) {
        let streamClosed = false
        let knowledgeQueryStartedAtMs: number | null = null
        let knowledgeQueryCompletedAtMs: number | null = null
        let providerSelectedAtMs: number | null = null
        let firstTextDeltaAtMs: number | null = null
        let lastTextDeltaAtMs: number | null = null
        let previewToolExecutedInTurn = false
        let briefUpdateToolExecutedInTurn = false
        let streamedToolAppendix = ""
        const toolFailures: ToolFailureSummary[] = []
        const sendEvent = (payload: Record<string, unknown>) => {
          if (streamClosed) return false
          try {
            controller.enqueue(encoder.encode(buildSseEvent(payload)))
            return true
          } catch (error) {
            if (isClosedStreamControllerError(error)) {
              streamClosed = true
              return false
            }
            throw error
          }
        }

        try {
          sendEvent({
            event: "conversation_init",
            conversation_id: conversationId,
            enabled_tools: effectiveSelectedToolIds,
            skills_enabled: skillsEnabled,
            selected_skills: resolvedSkillIdsForUi,
            persisted: persistenceEnabled,
            agent_id: effectiveAgentId,
            agent_route: routeDecision,
          })
          for (const skillId of resolvedSkillIdsForUi) {
            sendEvent({
              event: "skill_selected",
              conversation_id: conversationId,
              skill_id: skillId,
            })
          }
          const enterpriseKnowledge = await loadEnterpriseKnowledge((progress) => {
            if (progress.event === "knowledge_query_start") {
              knowledgeQueryStartedAtMs = Date.now()
            } else if (progress.event === "knowledge_query_result") {
              knowledgeQueryCompletedAtMs = Date.now()
            }
            sendEvent({
              event: progress.event,
              conversation_id: conversationId,
              data: progress.data || null,
            })
          })
          const systemPrompt = buildAiEntrySystemPrompt(
            enterpriseKnowledge,
            resolvedInstruction,
            customSystemPrompt,
            latestUserPrompt,
            forcedReplyLanguage,
            effectiveAgentId,
            {
              available: Boolean(effectiveSelectedTools.web_search),
              conversationScope,
              consultingModelMode: agentConfig.consultingModelMode,
            },
          )

          if (isOpenCodeRuntimeDecision(runtimeDecision) && runtimeProfile.sessionEnabled && runtimeProfile.asyncEnabled) {
            const runtimeInput = await buildChatRuntimeInput(systemPrompt)
            const queued = await createBackgroundOpenCodeRun({
              currentUser,
              runtimeInput,
              functionId: effectiveAgentId,
              selectedSkillIds,
              selectedMcpServerIds,
              traceId,
              billingReservation: aiEntryCreditReservation,
              provider: openCodeProvider,
              backend: runtimeProfile.backend === "cloudflare-opencode-session" ? "cloudflare-opencode-session" : "railway-opencode",
            })
            aiEntryCreditFinalized = true
            const queueMessage = isZh ? "任务已提交，关闭页面后仍会继续执行。" : "Task queued; execution continues after you leave this page."
            sendEvent({
              event: "provider_selected",
              conversation_id: conversationId,
              provider: "opencode",
              provider_model: runtimeInput.modelHint || "opencode",
              provider_order: ["opencode"],
              provider_attempt: 1,
            })
            sendEvent({
              event: "background_task_queued",
              conversation_id: conversationId,
              data: {
                taskId: String(queued.taskRunId),
                runtimeRunId: queued.runtimeRunId,
                taskType: "opencode_agent_run",
                status: "pending",
                stage: "runtime_queued",
              },
            })
            sendEvent({ event: "message", conversation_id: conversationId, answer: queueMessage })
            sendEvent({
              event: "message_end",
              conversation_id: conversationId,
              answer: queueMessage,
              provider: "opencode",
              provider_model: runtimeInput.modelHint || "opencode",
              agent_id: effectiveAgentId,
              background_task: { task_id: String(queued.taskRunId), task_type: "opencode_agent_run" },
            })
            return
          }

          const executeNative = () => runAiEntryConsultingStreaming({
            systemPrompt,
            messages: normalizedMessages,
            selectedTools: effectiveSelectedTools,
            toolChoice: toolRegistry.toolChoice,
            stopWhen,
            providerOptions,
            onProviderAttempt: (providerRun) => {
              console.info("ai-entry.chat.provider.attempt", {
                traceId,
                conversationId,
                provider: providerRun.providerId,
                model: providerRun.model,
                attempt: providerRun.attempt,
              })
            },
            onProviderSelected: (providerRun) => {
              providerSelectedAtMs = Date.now()
              sendEvent({
                event: "provider_selected",
                conversation_id: conversationId,
                provider: providerRun.providerId,
                provider_model: providerRun.model,
                provider_order: providerRun.providerOrder,
                provider_attempt: providerRun.attempt,
                provider_upgrade_probe: providerRun.upgradeProbe,
                ...(providerRun.fallbackReason ? { fallback_reason: providerRun.fallbackReason } : {}),
              })
            },
            onProviderSuccess: (providerRun) => {
              console.info("ai-entry.chat.provider.success", {
                traceId,
                conversationId,
                provider: providerRun.providerId,
                model: providerRun.model,
                attempt: providerRun.attempt,
                outputChars: providerRun.outputChars,
                streamed: true,
                firstTokenMs:
                  firstTextDeltaAtMs === null
                    ? null
                    : firstTextDeltaAtMs - startedAtMs,
                providerToFirstTokenMs:
                  firstTextDeltaAtMs === null || providerSelectedAtMs === null
                    ? null
                    : firstTextDeltaAtMs - providerSelectedAtMs,
              })
            },
            onTextDelta: (delta) => {
              if (delta) {
                const now = Date.now()
                if (firstTextDeltaAtMs === null) {
                  firstTextDeltaAtMs = now
                  console.info("ai-entry.chat.first_token", {
                    traceId,
                    conversationId,
                    providerSelectedElapsedMs:
                      providerSelectedAtMs === null
                        ? null
                        : providerSelectedAtMs - startedAtMs,
                    elapsedMs: now - startedAtMs,
                    providerToFirstTokenMs:
                      providerSelectedAtMs === null
                        ? null
                        : now - providerSelectedAtMs,
                  })
                }
                lastTextDeltaAtMs = now
              }
              sendEvent({
                event: "message",
                conversation_id: conversationId,
                answer: delta,
              })
            },
            onReasoning: (delta) => {
              sendEvent({
                event: "reasoning",
                conversation_id: conversationId,
                answer: delta,
              })
            },
            onToolCall: (payload) => {
              if (payload.toolName === "preview_ppt_deck") {
                previewToolExecutedInTurn = true
              }
              if (payload.toolName === "update_ppt_brief") {
                briefUpdateToolExecutedInTurn = true
              }
              sendEvent({
                event: "tool_call",
                conversation_id: conversationId,
                data: {
                  toolName: payload.toolName,
                  toolCallId: payload.toolCallId,
                  args: payload.args,
                },
              })
              sendEvent({
                event: "tool_call_start",
                conversation_id: conversationId,
                data: {
                  toolName: payload.toolName,
                  toolCallId: payload.toolCallId,
                  args: payload.args,
                },
              })
            },
            onToolResult: (payload) => {
              if (payload.toolName === "preview_ppt_deck") {
                previewToolExecutedInTurn = true
              }
              const researchBriefMarker =
                payload.toolName === "web_search"
                  ? buildResearchBriefFromWebSearchResult(payload.result)
                  : null
              streamedToolAppendix = appendUniqueToolAppendix(
                streamedToolAppendix,
                researchBriefMarker ? buildResearchBriefContextMarker(researchBriefMarker) : null,
              )
              streamedToolAppendix = appendUniqueToolAppendix(
                streamedToolAppendix,
                buildPptToolResultMessage({
                  toolName: payload.toolName,
                  result: payload.result,
                  origin: requestOrigin,
                  isZh,
                }),
              )
              const isErrorResult = isAiEntryToolErrorResult(payload.result)
              const isActionRequiredPreview = isPreviewActionRequiredResult(payload.toolName, payload.result)
              const validation = getAiEntryValidationResult(payload.result)
              const artifacts = extractAiEntryArtifactsFromToolResult({
                toolName: payload.toolName,
                result: payload.result,
              })
              if (isErrorResult && !isActionRequiredPreview) {
                const toolFailureMessage =
                  payload.result &&
                  typeof payload.result === "object" &&
                  typeof (payload.result as { error?: { message?: unknown } }).error?.message === "string"
                    ? String((payload.result as { error?: { message?: unknown } }).error?.message).trim()
                    : "tool_execution_failed"
                toolFailures.push({
                  toolName: payload.toolName,
                  message: toolFailureMessage || "tool_execution_failed",
                })
              }
              sendEvent({
                event: "tool_result",
                conversation_id: conversationId,
                data: {
                  toolName: payload.toolName,
                  toolCallId: payload.toolCallId,
                  result: payload.result,
                },
              })
              if (!isActionRequiredPreview) {
                sendEvent({
                  event: isErrorResult ? "tool_call_error" : "tool_call_done",
                  conversation_id: conversationId,
                  data: {
                    toolName: payload.toolName,
                    toolCallId: payload.toolCallId,
                    result: payload.result,
                  },
                })
              }
              if (validation) {
                sendEvent({
                  event: "validation_result",
                  conversation_id: conversationId,
                  data: {
                    toolName: payload.toolName,
                    toolCallId: payload.toolCallId,
                    validation,
                  },
                })
              }
              for (const artifact of artifacts) {
                sendEvent({
                  event: "artifact_created",
                  conversation_id: conversationId,
                  artifact,
                })
              }
            },
            onEmptyResponseRetry: ({ retryAttempt, retryLimit }) => {
              console.warn("ai-entry.chat.empty_response.retry", {
                traceId,
                conversationId,
                streamed: true,
                retryAttempt,
                retryLimit,
              })
            },
          })

          type ChatExecution = {
            result: { accumulated: string }
            providerId: string
            model: string
            providerOrder: string[]
          }
          let execution: ChatExecution
          if (isOpenCodeRuntimeDecision(runtimeDecision)) {
            const runtimeInput = await buildChatRuntimeInput(systemPrompt)
            let openCodeAnswer = ""
            let artifactTotalBytes = 0
            try {
              for await (const event of runOpenCodeAgent(runtimeInput, {
                runnerUrl: runtimeProfile.runnerUrl,
                backend: runtimeProfile.backend === "cloudflare-opencode-session" ? "cloudflare-opencode-session" : "railway-opencode",
                railway: runtimeProfile.backend === "railway-opencode",
                timeoutMs: runtimeProfile.timeoutMs,
                signal: request.signal,
                provider: openCodeProvider,
                session: runtimeProfile.sessionEnabled,
              })) {
                if (event.event === "runtime_selected") {
                  providerSelectedAtMs = Date.now()
                  sendEvent({
                    event: "provider_selected",
                    conversation_id: conversationId,
                    provider: "opencode",
                    provider_model: runtimeInput.modelHint || "opencode",
                    provider_order: ["opencode"],
                    provider_attempt: 1,
                  })
                } else if (event.event === "agent_resolved") {
                  sendEvent({
                    event: "agent_resolved",
                    conversation_id: conversationId,
                    agent_id: event.agentId,
                  })
                } else if (event.event === "skill_activated" || event.event === "skill_completed" || event.event === "skill_failed") {
                  sendEvent({
                    event: event.event,
                    conversation_id: conversationId,
                    skill_id: event.skillId,
                    ...(event.event === "skill_failed" ? { message: event.message } : {}),
                  })
                } else if (event.event === "text_delta") {
                  openCodeAnswer += event.delta
                  const now = Date.now()
                  if (firstTextDeltaAtMs === null) {
                    firstTextDeltaAtMs = now
                    console.info("ai-entry.chat.first_token", {
                      traceId,
                      conversationId,
                      provider: "opencode",
                      elapsedMs: now - startedAtMs,
                    })
                  }
                  lastTextDeltaAtMs = now
                  sendEvent({ event: "message", conversation_id: conversationId, answer: event.delta })
                } else if (event.event === "checkpoint_saved" && event.checkpoint.projectSnapshot) {
                  await persistRuntimeProjectSnapshot(event.checkpoint.projectSnapshot)
                } else if (event.event === "runtime_warning") {
                  sendEvent({
                    event: "runtime_warning",
                    conversation_id: conversationId,
                    code: event.code,
                    message: event.message,
                  })
                } else if (event.event === "tool_event") {
                  sendEvent({
                    event: "runtime_stage",
                    conversation_id: conversationId,
                    data: {
                      stage: `opencode_${event.tool}`,
                      runtimeStatus: event.phase === "started" ? "running" : event.phase,
                      message: event.message || `${event.tool}: ${event.phase}`,
                    },
                  })
                } else if (event.event === "artifact_payload") {
                  const published = await publishRuntimeArtifact({
                    currentUser,
                    conversationId,
                    runId: runtimeInput.runId,
                    artifact: event.artifact,
                    limits: runtimeInput.artifactContract,
                    currentTotalBytes: artifactTotalBytes,
                    conversationScope,
                    agentId: agentConfig.agentId,
                  })
                  artifactTotalBytes += event.artifact.sizeBytes
                  sendEvent({ event: "artifact_created", conversation_id: conversationId, artifact: published })
                } else if (event.event === "artifact_reference") {
                  const published = await publishRuntimeArtifactReference({
                    currentUser,
                    conversationId,
                    runId: runtimeInput.runId,
                    artifact: event.artifact,
                    limits: runtimeInput.artifactContract,
                    currentTotalBytes: artifactTotalBytes,
                    conversationScope,
                    agentId: agentConfig.agentId,
                  })
                  artifactTotalBytes += event.artifact.sizeBytes
                  sendEvent({ event: "artifact_created", conversation_id: conversationId, artifact: published })
                }
              }
              if (!openCodeAnswer.trim()) throw new Error("ai_entry_empty_response")
              execution = {
                result: { accumulated: openCodeAnswer },
                providerId: "opencode",
                model: runtimeInput.modelHint || "opencode",
                providerOrder: ["opencode"],
              }
            } catch (error) {
              // OpenCode is the selected runtime for this request. A failed
              // runtime must surface its error instead of silently switching
              // to another Provider or execution stack.
              console.warn("ai-entry.opencode.failed", {
                traceId,
                conversationId,
                message: extractErrorMessage(error),
              })
              throw error
            }
          } else {
            execution = await executeNative()
          }

          const normalizedStreamedAnswer = normalizeAiEntryIdentity(
            execution.result.accumulated || "",
            latestUserPrompt,
            forcedReplyLanguage,
            effectiveAgentId,
          )
          const fallbackToolFailureMessage =
            normalizedStreamedAnswer.trim() || streamedToolAppendix.trim()
              ? ""
              : buildToolFailureFallbackMessage({
                  failures: toolFailures,
                  isZh,
                })
          const sanitizedStreamedAnswer = streamedToolAppendix
            ? stripPptArtifactRelativeLinks(normalizedStreamedAnswer)
            : normalizedStreamedAnswer
          const provisionalStreamedAnswer = `${sanitizedStreamedAnswer}${streamedToolAppendix}${fallbackToolFailureMessage ? `\n\n${fallbackToolFailureMessage}` : ""}`.trim()
          const autoPreview = await maybeAutoRunPptPreview({
            agentId: effectiveAgentId,
            executionContext,
            latestUserPrompt,
            assistantMessage: provisionalStreamedAnswer,
            briefState: effectivePptBriefState,
            previewAlreadyExecuted: previewToolExecutedInTurn || briefUpdateToolExecutedInTurn,
            messageContents: normalizedMessageContents,
            previewTool:
              effectiveSelectedTools.preview_ppt_deck &&
              typeof effectiveSelectedTools.preview_ppt_deck === "object"
                ? (effectiveSelectedTools.preview_ppt_deck as { execute?: (input: unknown) => Promise<unknown> | unknown })
                : null,
            origin: requestOrigin,
            isZh,
          })
          if (autoPreview.autoPreviewExecuted) {
            previewToolExecutedInTurn = true
            const autoPreviewValidation = getAiEntryValidationResult(autoPreview.previewResult)
            const autoPreviewNeedsAction = isPreviewActionRequiredResult(
              "preview_ppt_deck",
              autoPreview.previewResult,
            )
            sendEvent({
              event: "tool_call",
              conversation_id: conversationId,
              data: {
                toolName: "preview_ppt_deck",
                toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID,
                args: {
                  prompt: latestUserPrompt,
                },
              },
            })
            sendEvent({
              event: "tool_call_start",
              conversation_id: conversationId,
              data: {
                toolName: "preview_ppt_deck",
                toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID,
                args: {
                  prompt: latestUserPrompt,
                },
              },
            })
            sendEvent({
              event: "tool_result",
              conversation_id: conversationId,
              data: {
                toolName: "preview_ppt_deck",
                toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID,
                result: autoPreview.previewResult,
              },
            })
            if (!autoPreviewNeedsAction) {
              sendEvent({
                event: isAiEntryToolErrorResult(autoPreview.previewResult) ? "tool_call_error" : "tool_call_done",
                conversation_id: conversationId,
                data: {
                  toolName: "preview_ppt_deck",
                  toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID,
                  result: autoPreview.previewResult,
                },
              })
            }
            if (autoPreviewValidation) {
              sendEvent({
                event: "validation_result",
                conversation_id: conversationId,
                data: {
                  toolName: "preview_ppt_deck",
                  toolCallId: AUTO_PPT_PREVIEW_TOOL_CALL_ID,
                  validation: autoPreviewValidation,
                },
              })
            }
          }
          const resolvedStreamedAnswerWithTools = autoPreview.assistantMessage
          sendEvent({
            event: "reasoning_end",
            conversation_id: conversationId,
          })
          sendEvent({
            event: "message_end",
            conversation_id: conversationId,
            answer: resolvedStreamedAnswerWithTools,
            provider: execution.providerId,
            provider_model: execution.model,
            agent_id: effectiveAgentId,
            agent_route: routeDecision,
            provider_order: execution.providerOrder,
          })

          if (persistenceEnabled) {
            await persistAiEntryTurnSafe({
              userId: currentUser.id,
              conversationId,
              assistantMessage: resolvedStreamedAnswerWithTools,
              scope: conversationScope,
              agentId: agentConfig.agentId,
            })
          }
          const usageTokens = getAiEntryUsageTokens(
            null,
            normalizedMessages.map((message) => normalizeCoreMessageContent(message.content)).join("\n"),
            resolvedStreamedAnswerWithTools,
          )
          const actualCost = estimateTextCredits({
            featureKey: "ai_entry_chat",
            inputTokens: usageTokens.inputTokens,
            outputTokens: usageTokens.outputTokens,
            provider: execution.providerId,
            model: execution.model,
          })
          await finalizeReservedCredits({
            reservation: aiEntryCreditReservation,
            userId: currentUser.id,
            enterpriseId: currentUser.enterpriseId,
            actualAmount: actualCost.credits,
            idempotencyKey: `ai-entry:${conversationId}:${traceId}:debit`,
            provider: execution.providerId,
            model: execution.model,
            officialCostUsd: actualCost.officialCostUsd,
            costBasisUsd: actualCost.costBasisUsd,
            usagePayload: actualCost.metadata,
            metadata: { conversationId, traceId, streamed: true },
          }).catch((error) => {
            console.warn("ai-entry.billing.finalize.failed", {
              conversationId,
              message: error instanceof Error ? error.message : String(error),
            })
          })
          aiEntryCreditFinalized = true
          console.info("ai-entry.chat.request.done", {
            traceId,
            conversationId,
            provider: execution.providerId,
            model: execution.model,
            persisted: persistenceEnabled,
            streamed: true,
            elapsedMs: Date.now() - startedAtMs,
            knowledgeQueryMs:
              knowledgeQueryStartedAtMs === null ||
              knowledgeQueryCompletedAtMs === null
                ? null
                : knowledgeQueryCompletedAtMs - knowledgeQueryStartedAtMs,
            firstTokenMs:
              firstTextDeltaAtMs === null
                ? null
                : firstTextDeltaAtMs - startedAtMs,
            lastTokenMs:
              lastTextDeltaAtMs === null
                ? null
                : lastTextDeltaAtMs - startedAtMs,
            providerToFirstTokenMs:
              firstTextDeltaAtMs === null || providerSelectedAtMs === null
                ? null
                : firstTextDeltaAtMs - providerSelectedAtMs,
            knowledge_ms:
              requestKnowledgeQueryStartedAtMs === null ||
              requestKnowledgeQueryCompletedAtMs === null
                ? null
                : requestKnowledgeQueryCompletedAtMs - requestKnowledgeQueryStartedAtMs,
            pre_model_ms:
              providerSelectedAtMs === null ? null : providerSelectedAtMs - startedAtMs,
            first_token_ms:
              firstTextDeltaAtMs === null ? null : firstTextDeltaAtMs - startedAtMs,
            last_token_ms:
              lastTextDeltaAtMs === null ? null : lastTextDeltaAtMs - startedAtMs,
            provider_first_token_ms:
              firstTextDeltaAtMs === null || providerSelectedAtMs === null
                ? null
                : firstTextDeltaAtMs - providerSelectedAtMs,
          })
        } catch (error) {
          const closedStream = isClosedStreamControllerError(error)
          if (persistenceEnabled && userPromptPersisted && !closedStream) {
            await persistAiEntryTurnSafe({
              userId: currentUser.id,
              conversationId,
              assistantMessage: extractErrorMessage(error),
              scope: conversationScope,
              agentId: agentConfig.agentId,
            })
          }
          if (aiEntryCreditReservation && !aiEntryCreditFinalized) {
            await releaseReservedCredits({
              reservation: aiEntryCreditReservation,
              userId: currentUser.id,
              enterpriseId: currentUser.enterpriseId,
              idempotencyKey: `ai-entry:${conversationId}:${traceId}:release`,
              reason: "ai_entry_stream_failed",
            }).catch((releaseError) => {
              console.warn("ai-entry.billing.release.failed", {
                conversationId,
                message: releaseError instanceof Error ? releaseError.message : String(releaseError),
              })
            })
          }
          console.error("ai-entry.chat.request.failed", {
            traceId,
            conversationId,
            message: extractErrorMessage(error),
            elapsedMs: Date.now() - startedAtMs,
          })
          if (!closedStream) {
            sendEvent({
              event: "error",
              conversation_id: conversationId,
              error: isRuntimeInputTooLargeError(error) ? "runtime_input_too_large" : extractErrorMessage(error),
            })
          }
        } finally {
          try {
            if (closeTools) await closeTools()
          } finally {
            if (!streamClosed) {
              streamClosed = true
              try {
                controller.close()
              } catch (error) {
                if (!isClosedStreamControllerError(error)) {
                  console.warn("ai-entry.chat.stream_close_failed", {
                    traceId,
                    conversationId,
                    message: extractErrorMessage(error),
                  })
                }
              }
            }
          }
        }
      },
    })

    return new Response(responseStream, { headers: STREAM_HEADERS })
  } catch (error) {
    if (aiEntryCreditReservation && !aiEntryCreditFinalized && billingUserId) {
      await releaseReservedCredits({
        reservation: aiEntryCreditReservation,
        userId: billingUserId,
        enterpriseId: billingEnterpriseId,
        idempotencyKey: `ai-entry:unknown:${traceId}:release`,
        reason: "ai_entry_request_failed",
      }).catch((releaseError) => {
        console.warn("ai-entry.billing.release.failed", {
          traceId,
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
        })
      })
    }
    try {
      if (closeTools) await closeTools()
    } catch {
      // ignore cleanup error
    }
    console.error("ai-entry.chat.request.failed", {
      traceId,
      message: extractErrorMessage(error),
      elapsedMs: Date.now() - startedAtMs,
    })
    return NextResponse.json(
      { error: isRuntimeInputTooLargeError(error) ? "runtime_input_too_large" : extractErrorMessage(error) },
      { status: isRuntimeInputTooLargeError(error) ? 413 : 500 },
    )
  }
}
