import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const nodeModule = require("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = nodeModule._load

let finalizeCalls = 0
let releaseCalls = 0
let toolRegistryWarnings: string[] = []
let toolRegistryToolIds: string[] = []
let toolRegistryToolChoice: Record<string, unknown> | undefined
let lastToolRegistryBuildInput: Record<string, unknown> | null = null
let emitArtifactFlow = false
let emitArtifactReferenceFlow = false
let emitToolFailureFlow = false
let emitPreviewSelectionRequiredFlow = false
let emitQueuedPreviewFlow = false
let emitClosedControllerErrorFlow = false
let opencodeFailureMode = false
let lastOpenCodeOptions: Record<string, unknown> | null = null
let lastNativeProviderOptions: Record<string, unknown> | null = null
let backgroundRunCalls: Array<Record<string, unknown>> = []
let lastStreamingSystemPrompt = ""
let lastStreamingToolChoice: Record<string, unknown> | undefined
let customAgentExecutionMode: "direct_agent" | "workflow_backed" = "direct_agent"
let customAgentStatus: "published" | "disabled" | "archived" | "draft" = "published"
let enterpriseTextRuntimeConfig: Record<string, unknown> | null = null
let ensureConversationArgs:
  | {
      fallbackTitle?: string
      agentId?: string | null
    }
  | null = null
let appendMessageCalls: Array<{
  agentId?: string | null
  role?: "user" | "assistant"
  content?: string
}> = []

nodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "next/server") {
    return {
      NextResponse: {
        json: (body: unknown, init?: { status?: number }) => ({
          status: init?.status || 200,
          body,
        }),
      },
    }
  }

  if (request === "ai") {
    return {
      stepCountIs: (count: number) => count,
    }
  }

  if (request === "@/lib/auth/guards") {
    return {
      requireSessionUser: async () => ({
        user: {
          id: 7,
          email: "user@example.com",
          isDemo: false,
          enterpriseId: 3,
          enterpriseName: "Acme",
          enterpriseRole: "admin",
          enterpriseStatus: "active",
        },
      }),
    }
  }

  if (request === "@/lib/auth/session") {
    return {
      isSessionDbUnavailableError: () => false,
    }
  }

  if (request === "@/lib/ai-entry/repository") {
    return {
      ensureAiEntryConversation: async (
        _userId: number,
        _conversationId: string | null | undefined,
        fallbackTitle?: string,
        _currentModelId?: string | null,
        _scope?: string,
        agentId?: string | null,
      ) => {
        ensureConversationArgs = {
          fallbackTitle,
          agentId,
        }
        return { id: "conv-1" }
      },
      appendAiEntryMessage: async (input: {
        agentId?: string | null
        role?: "user" | "assistant"
        content?: string
      }) => {
        appendMessageCalls.push(input)
      },
      listAiEntryMessages: async () => ({
        conversation_state: { ppt: { latestPreview: null, latestExport: null, phase: "idle" }, artifacts: [] },
      }),
    }
  }

  if (request === "@/lib/ai-entry/runtime/opencode-adapter") {
    return {
      runOpenCodeAgent: async function* (input: { runId: string }, options: Record<string, unknown>) {
        lastOpenCodeOptions = options
        yield { event: "runtime_selected", provider: "opencode", backend: "railway-opencode", runId: input.runId }
        yield { event: "runtime_started", runId: input.runId }
        if (opencodeFailureMode) {
          yield { event: "runtime_error", code: "runner_unavailable", message: "runner unavailable", retryable: true, runId: input.runId }
          throw new Error("runner unavailable")
        }
        if (emitArtifactFlow) {
          yield { event: "skill_activated", skillId: "ppt-master", runId: input.runId }
          yield { event: "tool_event", tool: "export_ppt_deck", phase: "started", message: "export_ppt_deck: started", runId: input.runId }
          yield {
            event: "artifact_payload",
            artifact: {
              path: "artifacts/ai-marketing-workbench.pptx",
              title: "AI Marketing Workbench",
              kind: "pptx",
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              sizeBytes: 128,
              contentBase64: "dGVzdA==",
            },
            runId: input.runId,
          }
        }
        if (emitArtifactReferenceFlow) {
          yield {
            event: "artifact_reference",
            artifact: {
              provider: "r2",
              bucket: "ARTIFACT_BUCKET",
              key: "artifacts/session/run/final/deck.pptx",
              publicUrl: null,
              fileName: "final/deck.pptx",
              title: "Cloudflare Deck",
              kind: "pptx",
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              sizeBytes: 128,
              checksumSha256: "a".repeat(64),
            },
            runId: input.runId,
          }
        }
        yield { event: "text_delta", delta: emitArtifactFlow || emitArtifactReferenceFlow ? "PPT ready." : "OpenCode reply.", runId: input.runId }
        yield { event: "done", runId: input.runId }
      },
    }
  }

  if (request === "@/lib/ai-entry/runtime/artifact-publisher") {
    return {
      publishRuntimeArtifact: async (input: { artifact: Record<string, unknown> }) => ({
        artifactId: 401,
        title: input.artifact.title || "AI Marketing Workbench",
        kind: input.artifact.kind || "pptx",
        fileName: "ai-marketing-workbench.pptx",
        downloadUrl: "/api/platform/artifacts/401/download?download=1",
      }),
      publishRuntimeArtifactReference: async (input: { artifact: Record<string, unknown> }) => ({
        artifactId: 402,
        title: input.artifact.title || "Cloudflare Deck",
        kind: input.artifact.kind || "pptx",
        fileName: "deck.pptx",
        downloadUrl: "/api/platform/artifacts/402/download?download=1",
      }),
    }
  }

  if (request === "@/lib/ai-entry/runtime/background-run-service") {
    return {
      createBackgroundOpenCodeRun: async (input: Record<string, unknown>) => {
        backgroundRunCalls.push(input)
        return { taskRunId: 902, runtimeRunId: "55555555-5555-4555-8555-555555555555" }
      },
    }
  }

  if (request === "@/lib/ai-entry/provider-routing") {
    const getConfiguredAiEntryProviderForModel = (providerId: string, modelId: string) => {
      const provider = [
        {
          id: "deepseek",
          apiKey: process.env.AI_ENTRY_DEEPSEEK_API_KEY || "",
          baseURL: process.env.AI_ENTRY_DEEPSEEK_BASE_URL || "",
          model: process.env.AI_ENTRY_DEEPSEEK_MODEL || "deepseek-v4-pro",
        },
        {
          id: "pptoken",
          apiKey: process.env.AI_ENTRY_PPTOKEN_API_KEY || "",
          baseURL: process.env.AI_ENTRY_PPTOKEN_BASE_URL || "",
          model: process.env.AI_ENTRY_PPTOKEN_MODEL || "grok-4.5",
        },
      ].find((item) => item.id === providerId)
      if (!provider) return null
      if (providerId === "pptoken" && /^grok(?:[-_.]|$)/iu.test(modelId.replace(/^pptoken\//iu, ""))) {
        const grokKey = process.env.AI_ENTRY_PPTOKEN_GROK_API_KEY || process.env.AI_ENTRY_PPTOKEN_API_KEY || ""
        return { ...provider, apiKey: grokKey, baseURL: process.env.AI_ENTRY_PPTOKEN_GROK_BASE_URL || provider.baseURL }
      }
      return provider
    }

    return {
      getConfiguredAiEntryProviders: () => [
        {
          id: "deepseek",
          apiKey: process.env.AI_ENTRY_DEEPSEEK_API_KEY || "",
          baseURL: process.env.AI_ENTRY_DEEPSEEK_BASE_URL || "",
          model: process.env.AI_ENTRY_DEEPSEEK_MODEL || "deepseek-v4-pro",
        },
        {
          id: "pptoken",
          apiKey: process.env.AI_ENTRY_PPTOKEN_API_KEY || "",
          baseURL: process.env.AI_ENTRY_PPTOKEN_BASE_URL || "",
          model: process.env.AI_ENTRY_PPTOKEN_MODEL || "grok-4.5",
        },
      ],
      getConfiguredAiEntryProviderForModel,
    }
  }

  if (request === "@/lib/ai-entry/agent-catalog") {
    return {
      isAiEntryAgentId: (value: string | null | undefined) =>
        typeof value === "string" &&
        (value === "general" || value.startsWith("business-") || value.startsWith("executive-")),
    }
  }

  if (request === "@/lib/platform/custom-agent-runtime-id") {
    return {
      parseCustomAgentRuntimeId: (value: string | null | undefined) => {
        if (typeof value !== "string" || !value.startsWith("custom-agent:")) return null
        const numeric = Number(value.slice("custom-agent:".length))
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null
      },
    }
  }

  if (request === "@/lib/platform/custom-agents") {
    return {
      getCustomAgentForUser: async ({ agentId }: { agentId: number }) => ({
        id: agentId,
        name: "Revenue Ops Copilot",
        summary: "Turn business requests into practical GTM actions.",
        goal: "Improve pipeline execution quality",
        scope: "Business workbench direct chat",
        guardrails: "Keep outputs concrete and execution-ready.",
        systemPromptSummary: "Revenue-oriented execution copilot",
        systemPrompt: "Bias toward concrete steps, owners, and deliverables.",
        status: customAgentStatus,
        executionMode: customAgentExecutionMode,
      }),
    }
  }

  if (request === "@/lib/ai-entry/model-policy") {
    return {
      AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT: "gpt-6.1-sol",
      isConsultingAdvisorEntryMode: (value: unknown) => value === "consulting-advisor",
      isAiEntryPptAgentId: (value: string | null | undefined) =>
        value === "executive-ppt" || value === "executive-presentation-ppt",
      pickAgentDefaultModelId: () => "grok-4.5",
      pickConsultingModelId: () => "gpt-6.1-sol",
      resolveConsultingModelMode: () => "quality",
      shouldLockConsultingAdvisorModel: () => false,
    }
  }

  if (request === "@/lib/ai-entry/model-id-registry") {
    return {
      resolveEquivalentModelId: (value: string | null | undefined) => value,
    }
  }

  if (request === "@/lib/ai-entry/model-selection") {
    return {
      parseAiEntryModelSelection: () => null,
      serializeAiEntryModelSelection: ({ providerId, modelId }: { providerId: string; modelId: string }) => `${providerId}::${modelId}`,
    }
  }

  if (request === "@/lib/ai-entry/chat-policy") {
    return {
      getAiEntryWebSearchSystemRule: () => "",
      shouldQueryAiEntryEnterpriseKnowledge: () => false,
    }
  }

  if (request === "@/lib/ai-entry/identity") {
    return {
      normalizeAiEntryIdentity: (text: string) => text,
    }
  }

  if (request === "@/lib/knowledge/service") {
    return {
      loadEnterpriseKnowledgeContext: async () => null,
    }
  }

  if (request === "@/lib/platform/shared-credits-policy") {
    return {
      hasCustomAiChatModelSelection: () => false,
    }
  }

  if (request === "@/lib/ai-entry/chat-attachments") {
    return {
      normalizeAttachmentList: () => [],
      normalizeMessages: (messages: Array<{ role: string; content: string }>) => messages,
      normalizeMessageTextContent: (content: unknown) =>
        typeof content === "string" ? content.trim() : "",
      extractUserIntentFromMessageContent: (content: unknown) => {
        if (typeof content !== "string") return ""
        return content.replace(/\n*\[Uploaded file:[\s\S]*$/u, "").trim()
      },
    }
  }

  if (request === "@/lib/ai-entry/language-policy") {
    return {
      resolveForcedReplyLanguage: () => null,
    }
  }

  if (request === "@/lib/ai-entry/ppt-tool-result-message") {
    return {
      buildPptTemplateCatalogPromptSection: () => "Editable PPT template catalog",
      buildPptTemplateSelectionPromptSection: () => "Editable PPT template selection",
      buildPptTemplateRecommendationMessage: () => null,
      buildPptToolResultMessage: (input: { toolName?: string; result?: { status?: string; backgroundTask?: { taskId?: string } } | null }) => {
        if (
          input?.toolName === "preview_ppt_deck" &&
          input.result?.status === "queued" &&
          input.result?.backgroundTask?.taskId
        ) {
          return [
            "",
            "",
            "已切换为后台生成：",
            `- 任务 ID: ${input.result.backgroundTask.taskId}`,
            "- 状态: 系统会持续轮询，完成后自动回填预览结果。",
          ].join("\n")
        }
        return null
      },
      extractLatestPptTemplateRecommendationContext: () => null,
      resolvePptTemplateSelectionFromUserText: () => null,
      resolveLatestPptConversationState: () => ({
        latestPreview: null,
        latestExport: null,
        phase: "idle",
      }),
      stripPptArtifactRelativeLinks: (value: string) => value,
    }
  }

  if (request === "@/lib/ai-entry/ppt-auto-preview") {
    return {
      maybeAutoRunPptPreview: async (input: { assistantMessage?: string }) => ({
        assistantMessage: input.assistantMessage || "",
        autoPreviewExecuted: false,
        previewResult: null,
      }),
    }
  }

  if (request === "@/lib/skills/runtime/ai-entry-consulting") {
    return {
      prepareAiEntryConsultingRuntime: async (input: { requestedAgentId?: string | null }) => ({
        effectiveAgentId: input.requestedAgentId || null,
        routeDecision: null,
        skillRouteDecision: emitArtifactFlow
          ? {
              selectedSkillIds: ["ppt-master"],
              reasons: [{ skillId: "ppt-master", reason: "explicit_selection" }],
            }
          : null,
        selectedSkills: emitArtifactFlow
          ? [
              {
                id: "ppt-master",
                name: "PPT Master",
                description: "PPT",
                type: "tool",
                triggerHints: ["ppt"],
                instruction: "Use web_search before preview when facts matter, then preview and export.",
                toolIds: ["web_search", "preview_ppt_deck", "export_ppt_deck"],
                mcpServerIds: [],
                version: "1",
              },
            ]
          : [],
        selectedSkillIds: emitArtifactFlow ? ["ppt-master"] : [],
        runtimePolicy: {
          agentId: input.requestedAgentId || null,
          allowedSkillIds: ["ppt-master"],
          allowedToolIds: ["web_search", "preview_ppt_deck", "export_ppt_deck"],
          allowedMcpServerIds: [],
          maxToolCalls: 8,
          maxRuntimeMs: 60_000,
          canCreateArtifacts: true,
          approvalRequiredToolIds: [],
        },
        resolvedInstruction: emitArtifactFlow
          ? "# Routed Skills\n\nUse web_search before preview when factual evidence is needed, then use PPT tools."
          : "",
      }),
    }
  }

  if (request === "@/lib/ai-entry/tool-registry") {
    return {
      buildAiEntryToolRegistry: async (input: Record<string, unknown>) => {
        lastToolRegistryBuildInput = input
        return {
          selectedTools: {},
          selectedToolIds: toolRegistryToolIds,
          toolChoice: toolRegistryToolChoice,
          closeTools: null,
          toolLoadWarnings: toolRegistryWarnings,
          selectedMcpServerIds: [],
        }
      },
    }
  }

  if (request === "@/lib/skills/runtime/ai-entry-executor") {
    return {
      runAiEntryConsultingStreaming: async (input: {
        systemPrompt?: string
        toolChoice?: Record<string, unknown>
        onProviderSelected?: (payload: Record<string, unknown>) => void
        onTextDelta?: (delta: string) => void
        onToolCall?: (payload: Record<string, unknown>) => void
        onToolResult?: (payload: Record<string, unknown>) => void
      }) => {
        lastStreamingSystemPrompt = input.systemPrompt || ""
        lastStreamingToolChoice = input.toolChoice
        lastNativeProviderOptions = (input as unknown as { providerOptions?: Record<string, unknown> }).providerOptions || null
        input.onProviderSelected?.({
          providerId: "pptoken",
          model: "gpt-6.1-sol",
          attempt: 1,
          providerOrder: ["pptoken"],
          upgradeProbe: false,
        })
        if (emitClosedControllerErrorFlow) {
          throw new Error("Invalid state: Controller is already closed")
        }
        if (emitQueuedPreviewFlow) {
          input.onToolCall?.({
            toolName: "preview_ppt_deck",
            toolCallId: "tool-preview-queued-1",
            args: {
              prompt: "帮我生成董事会汇报预览",
            },
          })
          input.onToolResult?.({
            toolName: "preview_ppt_deck",
            toolCallId: "tool-preview-queued-1",
            result: {
              ok: true,
              status: "queued",
              message: "可编辑 PPT 已切换为后台生成，系统会继续轮询并在完成后回填预览结果。",
              backgroundTask: {
                taskId: "901",
                conversationId: "conv-1",
                toolName: "preview_ppt_deck",
                status: "queued",
              },
            },
          })
        } else if (emitPreviewSelectionRequiredFlow) {
          input.onToolCall?.({
            toolName: "preview_ppt_deck",
            toolCallId: "tool-preview-1",
            args: {
              prompt: "帮我做一份董事会汇报",
            },
          })
          input.onToolResult?.({
            toolName: "preview_ppt_deck",
            toolCallId: "tool-preview-1",
            result: {
              ok: false,
              error: {
                code: "ppt_template_selection_required",
                message: "Select one recommended template before generating the editable PPT preview.",
              },
              recommendedTemplates: [
                {
                  templateId: "anthropic-brand",
                  templateLabel: "Anthropic 品牌",
                  styleName: "Long Table",
                },
              ],
            },
          })
        } else if (emitToolFailureFlow) {
          input.onToolCall?.({
            toolName: "export_ppt_deck",
            toolCallId: "tool-fail-1",
            args: {
              previewSessionId: "preview-session-missing",
              selectedVariantKey: "variant-a",
            },
          })
          input.onToolResult?.({
            toolName: "export_ppt_deck",
            toolCallId: "tool-fail-1",
            result: {
              ok: false,
              error: {
                code: "missing_preview_session",
                message: "Preview session is no longer available. Generate the PPT preview again before export.",
              },
            },
          })
        } else if (emitArtifactFlow) {
          input.onToolCall?.({
            toolName: "export_ppt_deck",
            toolCallId: "tool-1",
            args: {
              previewSessionId: "preview-session-1",
              selectedVariantKey: "variant-a",
            },
          })
          input.onToolResult?.({
            toolName: "export_ppt_deck",
            toolCallId: "tool-1",
            result: {
              ok: true,
              title: "AI Marketing Workbench",
              fileName: "ai-marketing-workbench.pptx",
              contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              artifactId: 401,
              toolRunId: 301,
              downloadUrl: "/api/platform/artifacts/401/download?download=1",
              artifact: {
                kind: "pptx",
                title: "AI Marketing Workbench",
                fileName: "ai-marketing-workbench.pptx",
                artifactId: 401,
                downloadUrl: "/api/platform/artifacts/401/download?download=1",
              },
              validation: {
                ok: true,
                checks: [
                  {
                    code: "mime_is_pptx",
                    ok: true,
                    message: "Exported artifact MIME type is PPTX.",
                  },
                ],
              },
            },
          })
        }
        const accumulatedText = emitArtifactFlow
          ? "PPT ready."
          : emitQueuedPreviewFlow
            ? "我会先准备预览所需内容。"
          : emitPreviewSelectionRequiredFlow
            ? "请先选一个模板。"
          : emitToolFailureFlow
            ? ""
            : "Normal chat reply."
        if (accumulatedText) {
          input.onTextDelta?.(accumulatedText)
        }
        return {
          result: {
            accumulated: accumulatedText,
          },
          providerId: "pptoken",
          model: "gpt-6.1-sol",
          providerOrder: ["pptoken"],
        }
      },
      runAiEntryConsultingBlocking: async () => {
        throw new Error("blocking_not_used_in_test")
      },
    }
  }

  if (request === "@/lib/billing/costing") {
    return {
      estimateTextCredits: () => ({
        credits: 10,
        officialCostUsd: 0.01,
        costBasisUsd: 0.01,
        metadata: {},
      }),
    }
  }

  if (request === "@/lib/billing/runtime") {
    return {
      reserveFeatureCredits: async () => ({ amount: 10 }),
      finalizeReservedCredits: async () => {
        finalizeCalls += 1
      },
      releaseReservedCredits: async () => {
        releaseCalls += 1
      },
    }
  }

  if (request === "@/lib/platform/model-governance") {
    return {
      getGovernedAiEntryModelCatalogForUser: async () => ({
        models: [
          {
            id: "deepseek::deepseek-v4-pro",
            modelId: "deepseek-v4-pro",
            runtimeId: "deepseek-v4-pro",
            providerId: "deepseek",
          },
          {
            id: "deepseek::deepseek-v4-flash",
            modelId: "deepseek-v4-flash",
            runtimeId: "deepseek-v4-flash",
            providerId: "deepseek",
          },
          {
            id: "pptoken::gpt-6.1-sol",
            modelId: "gpt-6.1-sol",
            runtimeId: "gpt-6.1-sol",
            providerId: "pptoken",
          },
          {
            id: "enterprise-openai-compatible::deepseek-v4-pro",
            modelId: "deepseek-v4-pro",
            runtimeId: "deepseek-v4-pro",
            providerId: "enterprise-openai-compatible",
          },
          {
            id: "enterprise-openai-compatible::deepseek-v4-flash",
            modelId: "deepseek-v4-flash",
            runtimeId: "deepseek-v4-flash",
            providerId: "enterprise-openai-compatible",
          },
        ],
        selectedModelId: "pptoken::gpt-6.1-sol",
        providerId: "pptoken",
      }),
    }
  }

  if (request === "@/lib/platform/enterprise-runtime-config") {
    return {
      getEnterpriseTextRuntimeProviderConfigsForUser: async () => enterpriseTextRuntimeConfig,
    }
  }

  return originalLoad.call(this, request, parent, isMain)
}

let POST: (request: { json: () => Promise<Record<string, unknown>>; nextUrl: { origin: string } }) => Promise<Response>

test.before(async () => {
  const route = await import("./route")
  POST = route.POST as typeof POST
})

test.beforeEach(() => {
  finalizeCalls = 0
  releaseCalls = 0
  toolRegistryWarnings = []
  toolRegistryToolIds = []
  toolRegistryToolChoice = undefined
  emitArtifactFlow = false
  emitArtifactReferenceFlow = false
  emitToolFailureFlow = false
  emitPreviewSelectionRequiredFlow = false
  emitQueuedPreviewFlow = false
  emitClosedControllerErrorFlow = false
  opencodeFailureMode = false
  lastOpenCodeOptions = null
  lastNativeProviderOptions = null
  backgroundRunCalls = []
  enterpriseTextRuntimeConfig = null
  lastStreamingSystemPrompt = ""
  lastStreamingToolChoice = undefined
  customAgentExecutionMode = "direct_agent"
  customAgentStatus = "published"
  ensureConversationArgs = null
  appendMessageCalls = []
  lastToolRegistryBuildInput = null
})

test.after(() => {
  nodeModule._load = originalLoad
})

test("ai chat route keeps ordinary streaming chat working even when MCP tool loading fails", async () => {
  toolRegistryWarnings = ["mcp_server_load_failed:mcp-sse-1:boom"]

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "你好，帮我总结今天该做什么。" }],
      stream: true,
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /conversation_init/)
  assert.match(text, /message_end/)
  assert.match(text, /Normal chat reply\./)
  assert.match(lastStreamingSystemPrompt, /general-purpose AI chat assistant/u)
  assert.doesNotMatch(lastStreamingSystemPrompt, /general consulting advisor assistant/u)
  assert.doesNotMatch(lastStreamingSystemPrompt, /sound consulting practice/u)
  assert.equal(finalizeCalls, 1)
  assert.equal(releaseCalls, 0)
})

test("ordinary AI Chat stays native even when Railway OpenCode is configured", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-railway",
    AI_ENTRY_OPENCODE_BACKEND: "railway-opencode",
    RAILWAY_OPENCODE_RUNTIME_URL: "https://runner.example.com",
    RAILWAY_OPENCODE_RUNTIME_TOKEN: "test-secret",
    AI_ENTRY_DEEPSEEK_API_KEY: "deepseek-app-key",
    AI_ENTRY_DEEPSEEK_BASE_URL: "https://deepseek.example/v1",
  })
  try {
    const response = await POST({
      json: async () => ({ messages: [{ role: "user", content: "帮我写一段产品介绍。" }], stream: true }),
      nextUrl: { origin: "https://example.com" },
    })
    const text = await response.text()
    assert.doesNotMatch(text, /"provider":"opencode"/)
    assert.match(text, /Normal chat reply\./)
    assert.match(text, /"event":"message_end"/)
    assert.equal(lastOpenCodeOptions, null)
    assert.equal(finalizeCalls, 1)
    assert.equal(releaseCalls, 0)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("ordinary AI Chat preserves the explicitly selected provider on the native path", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-railway",
    AI_ENTRY_OPENCODE_BACKEND: "railway-opencode",
    RAILWAY_OPENCODE_RUNTIME_URL: "https://runner.example.com",
    RAILWAY_OPENCODE_RUNTIME_TOKEN: "test-secret",
    AI_ENTRY_PPTOKEN_API_KEY: "pptoken-app-key",
    AI_ENTRY_PPTOKEN_BASE_URL: "https://pptoken.example/v1",
    AI_ENTRY_PPTOKEN_MODEL: "grok-4.5",
  })
  try {
    const response = await POST({
      json: async () => ({
        messages: [{ role: "user", content: "请直接回复 provider check。" }],
        stream: true,
        modelConfig: { providerId: "pptoken", modelId: "gpt-6.1-sol" },
      }),
      nextUrl: { origin: "https://example.com" },
    })
    await response.text()

    assert.equal(lastOpenCodeOptions, null)
    assert.equal(lastNativeProviderOptions?.preferredProviderId, "pptoken")
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("ai chat route preserves an explicitly selected DeepSeek flash model", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "请直接总结这段内容。" }],
      stream: true,
      modelConfig: { providerId: "deepseek", modelId: "deepseek-v4-flash" },
    }),
    nextUrl: { origin: "https://example.com" },
  })
  await response.text()

  assert.equal(lastNativeProviderOptions?.preferredProviderId, "deepseek")
  assert.equal(lastNativeProviderOptions?.preferredModel, "deepseek-v4-flash")
})

test("workflow chat falls back to the current provider model when a saved model is stale", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "请总结这份工作流输入。" }],
      stream: true,
      executionContext: "workflow",
      modelConfig: { providerId: "deepseek", modelId: "deepseek-v3-legacy" },
    }),
    nextUrl: { origin: "https://example.com" },
  })
  await response.text()

  assert.equal(response.status, 200)
  assert.equal(lastNativeProviderOptions?.preferredProviderId, "deepseek")
  assert.equal(lastNativeProviderOptions?.preferredModel, "deepseek-v4-pro")
})

test("presentation PPT queues Cloudflare OpenCode and never enters the legacy PPT tool flow", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-cloudflare-sandbox",
    AI_ENTRY_OPENCODE_BACKEND: "cloudflare-sandbox-exec",
    AI_ENTRY_OPENCODE_SESSION_ENABLED: "true",
    AI_ENTRY_OPENCODE_ASYNC_ENABLED: "true",
    CLOUDFLARE_OPENCODE_RUNNER_URL: "https://runner.example.com",
    CLOUDFLARE_OPENCODE_RUNNER_HMAC_SECRET: "test-secret",
    AI_ENTRY_PPTOKEN_API_KEY: "pptoken-app-key",
    AI_ENTRY_PPTOKEN_BASE_URL: "https://pptoken.example/v1",
  })
  try {
    const response = await POST({
      json: async () => ({
        messages: [{ role: "user", content: "生成一份 8 页产品发布演讲型 PPT。" }],
        stream: true,
        agentConfig: { agentId: "executive-presentation-ppt" },
      }),
      nextUrl: { origin: "https://example.com" },
    })
    const text = await response.text()

    assert.match(text, /"event":"background_task_queued"/u)
    assert.match(text, /"taskType":"opencode_agent_run"/u)
    assert.equal(backgroundRunCalls.length, 1)
    assert.equal(backgroundRunCalls[0]?.backend, "cloudflare-opencode-session")
    assert.equal(
      (backgroundRunCalls[0]?.runtimeInput as { agentId?: string } | undefined)?.agentId,
      "executive-presentation-ppt",
    )
    assert.equal(
      (backgroundRunCalls[0]?.runtimeInput as { modelHint?: string } | undefined)?.modelHint,
      "pptoken/grok-4.5",
    )
    assert.deepEqual(backgroundRunCalls[0]?.provider, {
      providerId: "pptoken",
      modelId: "grok-4.5",
      baseUrl: "https://pptoken.example/v1",
      apiKey: "pptoken-app-key",
    })
    assert.deepEqual(backgroundRunCalls[0]?.selectedSkillIds, [])
    assert.equal(toolRegistryToolIds.includes("preview_ppt_deck"), false)
    assert.equal(toolRegistryToolIds.includes("export_ppt_deck"), false)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("presentation PPT accepts DeepSeek V4 Flash from an enterprise OpenAI-compatible route", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-cloudflare-sandbox",
    AI_ENTRY_OPENCODE_BACKEND: "cloudflare-sandbox-exec",
    AI_ENTRY_OPENCODE_SESSION_ENABLED: "true",
    AI_ENTRY_OPENCODE_ASYNC_ENABLED: "true",
    CLOUDFLARE_OPENCODE_RUNNER_URL: "https://runner.example.com",
    CLOUDFLARE_OPENCODE_RUNNER_HMAC_SECRET: "test-secret",
  })
  enterpriseTextRuntimeConfig = {
    selectedProviderId: "enterprise-openai-compatible",
    selectedModelId: "deepseek-v4-pro",
    providerConfigs: [
      {
        id: "enterprise-openai-compatible",
        apiKey: "enterprise-key",
        baseURL: "https://enterprise.example/v1",
        model: "deepseek-v4-pro",
      },
    ],
  }
  try {
    const response = await POST({
      json: async () => ({
        messages: [{ role: "user", content: "生成一份 AI 客服试点复盘 PPT。" }],
        stream: true,
        agentConfig: { agentId: "executive-presentation-ppt" },
        modelConfig: {
          providerId: "enterprise-openai-compatible",
          modelId: "deepseek-v4-flash",
        },
      }),
      nextUrl: { origin: "https://example.com" },
    })
    const text = await response.text()

    assert.equal(response.status, 200)
    assert.match(text, /"event":"background_task_queued"/u)
    assert.equal(backgroundRunCalls.length, 1)
    assert.deepEqual(backgroundRunCalls[0]?.provider, {
      providerId: "enterprise-openai-compatible",
      modelId: "deepseek-v4-flash",
      baseUrl: "https://enterprise.example/v1",
      apiKey: "enterprise-key",
    })
    assert.equal(
      (backgroundRunCalls[0]?.runtimeInput as { modelHint?: string } | undefined)?.modelHint,
      "enterprise_openai_compatible/deepseek-v4-flash",
    )
  } finally {
    enterpriseTextRuntimeConfig = null
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("editable PPT always queues the Railway OpenCode task when its runtime is enabled", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_PPT_RAILWAY_ENABLED: "true",
    AI_ENTRY_OPENCODE_SESSION_ENABLED: "true",
    RAILWAY_OPENCODE_RUNTIME_URL: "https://runner.example.com",
    RAILWAY_OPENCODE_RUNTIME_TOKEN: "test-secret",
    AI_ENTRY_PPTOKEN_API_KEY: "pptoken-app-key",
    AI_ENTRY_PPTOKEN_BASE_URL: "https://pptoken.example/v1",
  })
  delete process.env.AI_ENTRY_OPENCODE_ASYNC_ENABLED
  try {
    const response = await POST({
      json: async () => ({
        messages: [{ role: "user", content: "生成一页中文可编辑 PPT 预览。" }],
        stream: true,
        agentConfig: { agentId: "executive-ppt" },
      }),
      nextUrl: { origin: "https://example.com" },
    })
    const text = await response.text()

    assert.equal(response.status, 200)
    assert.match(text, /"event":"background_task_queued"/u)
    assert.equal(backgroundRunCalls.length, 1)
    assert.equal(
      (backgroundRunCalls[0]?.runtimeInput as { agentId?: string } | undefined)?.agentId,
      "executive-ppt",
    )
    assert.equal(lastOpenCodeOptions, null)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("presentation PPT uses OpenRouter only when explicitly selected", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-railway",
    AI_ENTRY_OPENCODE_BACKEND: "railway-opencode",
    AI_ENTRY_OPENCODE_SESSION_ENABLED: "true",
    AI_ENTRY_OPENCODE_ASYNC_ENABLED: "true",
    RAILWAY_OPENCODE_RUNTIME_URL: "https://runner.example.com",
    RAILWAY_OPENCODE_RUNTIME_TOKEN: "test-secret",
    AI_ENTRY_OPENROUTER_API_KEY: "openrouter-app-key",
    AI_ENTRY_OPENROUTER_BASE_URL: "https://openrouter.example/v1",
  })
  try {
    const response = await POST({
      json: async () => ({
        messages: [{ role: "user", content: "生成一份演讲型发布会 PPT。" }],
        stream: true,
        agentConfig: { agentId: "executive-presentation-ppt" },
        modelConfig: { providerId: "openrouter", modelId: "x-ai/grok-4.5" },
      }),
      nextUrl: { origin: "https://example.com" },
    })
    assert.equal(response.status, 500)
    assert.equal((response as any).body?.error, "ai_entry_model_unavailable_for_provider")
    assert.equal(backgroundRunCalls.length, 0)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("ai chat route does not fall back from OpenCode and never duplicates billing", async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AI_ENTRY_SAAS_OPENCODE_ENABLED: "true",
    AI_ENTRY_RUNTIME_MODE: "opencode-railway",
    AI_ENTRY_OPENCODE_BACKEND: "railway-opencode",
    RAILWAY_OPENCODE_RUNTIME_URL: "https://runner.example.com",
    RAILWAY_OPENCODE_RUNTIME_TOKEN: "test-secret",
    AI_ENTRY_BUSINESS_AGENT_RAILWAY_ENABLED: "true",
  })
  opencodeFailureMode = true
  try {
    const response = await POST({
      json: async () => ({ messages: [{ role: "user", content: "hello" }], stream: true, agentConfig: { agentId: "business-content-growth" } }),
      nextUrl: { origin: "https://example.com" },
    })
    const text = await response.text()
    assert.equal(response.status, 200)
    assert.doesNotMatch(text, /"event":"provider_fallback"/)
    assert.doesNotMatch(text, /Normal chat reply\./)
  assert.match(text, /runner unavailable/)
    assert.equal(finalizeCalls, 0)
    assert.equal(releaseCalls, 1)
  } finally {
    opencodeFailureMode = false
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("ai chat route forwards the selected model into the PPT tool registry context", async () => {
  toolRegistryToolIds = ["preview_ppt_deck", "export_ppt_deck"]

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            '已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{"previewSessionId":"preview-session-1","defaultVariantKey":"variant-a","variantKeys":["variant-a"]} -->',
        },
        { role: "user", content: "做一份管理层培训 PPT" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
      modelConfig: {
        providerId: "pptoken",
        modelId: "gpt-6.1-sol",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /conversation_init/)
  assert.equal(lastToolRegistryBuildInput?.selectedPreviewModel, "gpt-6.1-sol")
  assert.equal(lastToolRegistryBuildInput?.selectedPreviewProviderId, "pptoken")
})

test("ai chat route preserves business-agent streaming and emits artifact-created for PPT export flow", async () => {
  emitArtifactFlow = true
  toolRegistryToolIds = ["preview_ppt_deck", "export_ppt_deck"]

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我做一份汇报 PPT，并导出可下载的 PPTX。" }],
      stream: true,
      agentConfig: {
        agentId: "business-brand-creative",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /"event":"skill_selected"/)
  assert.match(text, /"event":"runtime_stage"/)
  assert.match(text, /"event":"artifact_created"/)
  assert.match(text, /ai-marketing-workbench\.pptx/)
  assert.match(text, /message_end/)
  assert.equal(finalizeCalls, 1)
  assert.equal(releaseCalls, 0)
})

test("ai chat route promotes Cloudflare artifact references to downloadable artifacts", async () => {
  emitArtifactReferenceFlow = true

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "生成一份可下载的演讲型 PPT。" }],
      stream: true,
      agentConfig: { agentId: "business-brand-creative" },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  const text = await response.text()
  assert.match(text, /"event":"artifact_created"/u)
  assert.match(text, /deck\.pptx/u)
  assert.match(text, /\/api\/platform\/artifacts\/402\/download/u)
})

test("ai chat route synthesizes a readable fallback when tools fail without any model text", async () => {
  emitToolFailureFlow = true
  toolRegistryToolIds = ["export_ppt_deck"]
  toolRegistryToolChoice = {
    type: "tool",
    toolName: "export_ppt_deck",
  }

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            "已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{\"previewSessionId\":\"preview-session-missing\",\"defaultVariantKey\":\"variant-a\",\"variantKeys\":[\"variant-a\"]} -->",
        },
        { role: "user", content: "导出 Playful" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  const text = await response.text()
  assert.match(text, /工具执行失败，当前还没有拿到可用结果/)
  assert.match(text, /export_ppt_deck/)
  assert.match(text, /Preview session is no longer available/)
})

test("ai chat route keeps preview template-selection in waiting state instead of emitting tool error completion", async () => {
  emitPreviewSelectionRequiredFlow = true
  toolRegistryToolIds = ["preview_ppt_deck"]
  toolRegistryToolChoice = {
    type: "tool",
    toolName: "preview_ppt_deck",
  }

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            '已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{"previewSessionId":"preview-session-1","defaultVariantKey":"variant-a","variantKeys":["variant-a"]} -->',
        },
        { role: "user", content: "帮我生成一份给管理层看的产品发布董事会汇报 PPT 预览。" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  const text = await response.text()
  assert.match(text, /"event":"tool_result"/)
  assert.match(text, /ppt_template_selection_required/)
  assert.doesNotMatch(text, /"event":"tool_call_error".*"tool-preview-1"/)
  assert.doesNotMatch(text, /"event":"tool_call_done".*"tool-preview-1"/)
})

test("ai chat route persists queued background preview status so refresh can recover the task", async () => {
  emitQueuedPreviewFlow = true
  toolRegistryToolIds = ["preview_ppt_deck"]
  toolRegistryToolChoice = {
    type: "tool",
    toolName: "preview_ppt_deck",
  }

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            '已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{"previewSessionId":"preview-session-1","defaultVariantKey":"variant-a","variantKeys":["variant-a"]} -->',
        },
        { role: "user", content: "帮我先生成一个给管理层看的产品发布可编辑 PPT 预览。" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  const text = await response.text()
  assert.match(text, /"event":"tool_result"/)
  assert.match(text, /"taskId":"901"/)
  assert.ok(appendMessageCalls.at(-1))
  assert.equal(appendMessageCalls.at(-1)?.role, "assistant")
  assert.match(appendMessageCalls.at(-1)?.content || "", /我会先准备预览所需内容。/)
  assert.match(appendMessageCalls.at(-1)?.content || "", /已切换为后台生成：/)
  assert.match(appendMessageCalls.at(-1)?.content || "", /任务 ID: 901/)
})

test("ai chat route does not force export toolChoice for ppt turns and lets model decide from context", async () => {
  toolRegistryToolIds = ["preview_ppt_deck", "export_ppt_deck"]
  toolRegistryToolChoice = undefined

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            "已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{\"previewSessionId\":\"preview-session-1\",\"defaultVariantKey\":\"variant-a\",\"variantKeys\":[\"variant-a\",\"variant-b\"]} -->",
        },
        { role: "user", content: "导出 Playful" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  await response.text()
  assert.equal(lastStreamingToolChoice, undefined)
})

test("ai chat route uses the first user prompt as conversation title fallback", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我规划下个月的增长实验。" }],
      stream: true,
      agentConfig: {
        agentId: "executive-growth",
        agentName: "增长顾问",
        entryMode: "consulting-advisor",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  await response.text()
  assert.deepEqual(ensureConversationArgs, {
    fallbackTitle: "帮我规划下个月的增长实验。",
    agentId: "executive-growth",
  })
  assert.deepEqual(
    appendMessageCalls.map((call) => ({ role: call.role, agentId: call.agentId })),
    [
      { role: "user", agentId: "executive-growth" },
      { role: "assistant", agentId: "executive-growth" },
    ],
  )
})

test("ai chat route persists the user prompt before assistant completion", async () => {
  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            '已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{"previewSessionId":"preview-session-1","defaultVariantKey":"variant-a","variantKeys":["variant-a"]} -->',
        },
        { role: "user", content: "帮我生成一份给管理层看的产品发布董事会汇报 PPT。" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  await response.text()
  assert.deepEqual(
    appendMessageCalls.map((call) => ({
      role: call.role,
      content: call.content,
      agentId: call.agentId,
    })),
    [
      {
        role: "user",
        content: "帮我生成一份给管理层看的产品发布董事会汇报 PPT。",
        agentId: "executive-ppt",
      },
      {
        role: "assistant",
        content: "Normal chat reply.",
        agentId: "executive-ppt",
      },
    ],
  )
})

test("ai chat route persists uploaded attachment context inside the user message history", async () => {
  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "user",
          content: "写一份介绍预算智能公司和业务的 ppt\n\n[Uploaded file: brief.md / text/markdown]\n公司介绍\n业务结构\n套餐价格",
        },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  await response.text()
  assert.equal(
    appendMessageCalls[0]?.content,
    "写一份介绍预算智能公司和业务的 ppt\n\n[Uploaded file: brief.md / text/markdown]\n公司介绍\n业务结构\n套餐价格",
  )
})

test("ai chat route delegates initial editable PPT brief interpretation to the model", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "做一个克里米亚现状的ppt，10页，检索2026年最新的信息" }],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /Normal chat reply\./)
  assert.match(lastStreamingSystemPrompt, /Editable PPT brief planning/u)
  assert.match(lastStreamingSystemPrompt, /update_ppt_brief/u)
  assert.doesNotMatch(text, /还不能进入 PPT 预览/)
  assert.equal(appendMessageCalls[0]?.role, "user")
  assert.equal(appendMessageCalls[0]?.agentId, "executive-ppt")
  assert.equal(appendMessageCalls[0]?.content, "做一个克里米亚现状的ppt，10页，检索2026年最新的信息")
  assert.equal(appendMessageCalls[1]?.role, "assistant")
  assert.equal(appendMessageCalls[1]?.agentId, "executive-ppt")
  assert.equal(appendMessageCalls[1]?.content, "Normal chat reply.")
  assert.equal(finalizeCalls, 1)
  assert.equal(releaseCalls, 0)
})

test("ai chat route delegates confirmed PPT brief edits to the model with the persisted brief", async () => {
  toolRegistryToolIds = ["update_ppt_brief", "preview_ppt_deck"]

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            'PPT brief 已整理，请先确认：\n<!-- ai-entry-ppt-brief-confirmation:{"sourcePrompt":"俄乌战争现状","audience":"军事爱好者","goal":"培训讲解与统一认知","scenario":"training","language":"zh-CN","pageCount":12,"tone":"简洁、专业、决策导向","mustInclude":[]} -->',
        },
        { role: "user", content: "12页太多了，10页就行" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  const text = await response.text()
  assert.match(text, /Normal chat reply\./)
  assert.doesNotMatch(text, /PPT brief 已整理，请先确认/u)
  assert.equal(
    (lastToolRegistryBuildInput?.pptBriefState as { pageCount?: number } | undefined)?.pageCount,
    12,
  )
  assert.match(lastStreamingSystemPrompt, /Page count: 12/u)
})

test("ai chat route accepts natural-language follow-up answers and continues after executive-ppt clarification", async () => {
  const response = await POST({
    json: async () => ({
      messages: [
        { role: "user", content: "做一个克里米亚现状的ppt，10页，检索2026年最新的信息" },
        {
          role: "assistant",
          content:
            'PPT brief 已整理，请先确认：\n<!-- ai-entry-ppt-brief-confirmation:{"sourcePrompt":"做一个克里米亚现状的ppt","audience":"初级军事爱好者","goal":"培训讲解与统一认知","scenario":"training","language":"zh-CN","pageCount":10,"tone":null,"mustInclude":[]} -->',
        },
        { role: "user", content: "受众是初级军事爱好者，场景是50人的课堂讲解" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /Normal chat reply\./)
  assert.doesNotMatch(text, /还不能进入 PPT 预览/)
  assert.match(lastStreamingSystemPrompt, /Ready for preview: yes/)
  assert.match(lastStreamingSystemPrompt, /No blocking brief fields are missing\./)
  assert.equal(finalizeCalls, 1)
  assert.equal(releaseCalls, 0)
})

test("ai chat route does not persist closed stream transport errors as assistant replies", async () => {
  emitClosedControllerErrorFlow = true

  const response = await POST({
    json: async () => ({
      messages: [
        {
          role: "assistant",
          content:
            '已生成 PPT 预览：\n<!-- ai-entry-ppt-preview-context:{"previewSessionId":"preview-session-1","defaultVariantKey":"variant-a","variantKeys":["variant-a"]} -->',
        },
        { role: "user", content: "帮我生成一份给管理层看的产品发布董事会汇报 PPT。" },
      ],
      stream: true,
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.doesNotMatch(text, /Controller is already closed/)
  assert.deepEqual(
    appendMessageCalls.map((call) => ({
      role: call.role,
      content: call.content,
      agentId: call.agentId,
    })),
    [
      {
        role: "user",
        content: "帮我生成一份给管理层看的产品发布董事会汇报 PPT。",
        agentId: "executive-ppt",
      },
    ],
  )
  assert.equal(finalizeCalls, 0)
  assert.equal(releaseCalls, 1)
})

test("ai chat route skips ppt brief gating instructions for workflow execution context", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "做一份公司发布会 PPT" }],
      stream: true,
      executionContext: "workflow",
      agentConfig: {
        agentId: "executive-ppt",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  await response.text()
  assert.doesNotMatch(lastStreamingSystemPrompt, /## PPT brief state/)
  assert.doesNotMatch(lastStreamingSystemPrompt, /ask only 1 to 3 short confirmation questions/i)
})

test("ai chat route supports published direct custom agents in streaming chat", async () => {
  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我整理本周销售推进动作。" }],
      stream: true,
      agentConfig: {
        agentId: "custom-agent:42",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
  const text = await response.text()
  assert.match(text, /custom-agent:42/)
  assert.match(text, /Normal chat reply\./)
  assert.match(lastStreamingSystemPrompt, /Revenue Ops Copilot/)
  assert.match(lastStreamingSystemPrompt, /Improve pipeline execution quality/)
  assert.match(lastStreamingSystemPrompt, /Bias toward concrete steps, owners, and deliverables\./)
  assert.equal(finalizeCalls, 1)
  assert.equal(releaseCalls, 0)
})

test("ai chat route rejects workflow-backed custom agents in direct chat", async () => {
  customAgentExecutionMode = "workflow_backed"

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我推进销售漏斗。" }],
      stream: true,
      agentConfig: {
        agentId: "custom-agent:7",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal((response as { status?: number }).status, 409)
  assert.deepEqual((response as { body?: unknown }).body, {
    error: "custom_agent_workflow_backed_chat_not_supported",
  })
  assert.equal(finalizeCalls, 0)
})

test("ai chat route rejects disabled custom agents before streaming starts", async () => {
  customAgentStatus = "disabled"

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我整理销售跟进动作。" }],
      stream: true,
      agentConfig: {
        agentId: "custom-agent:8",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal((response as { status?: number }).status, 403)
  assert.deepEqual((response as { body?: unknown }).body, {
    error: "custom_agent_disabled",
  })
  assert.equal(finalizeCalls, 0)
})

test("ai chat route rejects archived custom agents before streaming starts", async () => {
  customAgentStatus = "archived"

  const response = await POST({
    json: async () => ({
      messages: [{ role: "user", content: "帮我整理销售跟进动作。" }],
      stream: true,
      agentConfig: {
        agentId: "custom-agent:9",
      },
    }),
    nextUrl: { origin: "https://example.com" },
  })

  assert.equal((response as { status?: number }).status, 403)
  assert.deepEqual((response as { body?: unknown }).body, {
    error: "custom_agent_archived",
  })
  assert.equal(finalizeCalls, 0)
})
