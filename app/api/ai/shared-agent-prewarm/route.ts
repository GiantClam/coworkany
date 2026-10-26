import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import { requireSessionUser } from "@/lib/auth/guards"
import { isAiEntryAgentId } from "@/lib/ai-entry/agent-catalog"
import { resolveAiEntryAgentRuntimePolicy } from "@/lib/ai-entry/agent-runtime-policy"
import { loadExecutiveSkillForAgent } from "@/lib/ai-entry/executive-skill-loader"
import { ensureAiEntryConversation, type AiEntryConversationScope } from "@/lib/ai-entry/repository"
import { buildAgentRuntimeInput } from "@/lib/ai-entry/runtime/context-builder"
import { isAiEntryOpenCodePrewarmEnabled, isAiEntrySharedAgentRuntimeEnabled, isBusinessAgentId, resolveBusinessAgentRailwayRuntimeProfile, resolveDefaultAgentRuntimeProfile } from "@/lib/ai-entry/runtime/profile-store"
import { prepareCloudflareSession } from "@/lib/ai-entry/runtime/cloudflare-session-client"
import { prepareRailwaySession } from "@/lib/ai-entry/runtime/railway-session-client"
import { resolveSharedSkillSetSelection } from "@/lib/ai-entry/shared-agent-skill-resolver"
import { upsertSharedSkillSetBundle } from "@/lib/ai-entry/shared-agent-skill-bundle-store"
import { buildAgentRuntimeSessionKey } from "@/lib/ai-runtime/session-key"
import { getConfiguredAiEntryProviders } from "@/lib/ai-entry/provider-routing"
import { getEnterpriseTextRuntimeProviderConfigsForUser } from "@/lib/platform/enterprise-runtime-config"
import { getCustomAgentForUser } from "@/lib/platform/custom-agents"
import { parseCustomAgentRuntimeId } from "@/lib/platform/custom-agent-runtime-id"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export const runtime = "nodejs"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionUser(request)
  if ("response" in auth) return auth.response
  if (!isAiEntryOpenCodePrewarmEnabled()) {
    return NextResponse.json({ prewarmed: false, reason: "prewarm_disabled" })
  }
  const currentUser = auth.user
  const body = await request.json().catch(() => null) as {
    agentId?: unknown
    conversationId?: unknown
    conversationScope?: unknown
    providerId?: unknown
    modelId?: unknown
  } | null
  const requestedAgentId = text(body?.agentId)
  const agentId = requestedAgentId || "general"
  const requestedConversationId = text(body?.conversationId) || null
  const conversationScope: AiEntryConversationScope = body?.conversationScope === "consulting" ? "consulting" : "chat"
  const businessAgent = isBusinessAgentId(agentId)
  const profile = businessAgent ? resolveBusinessAgentRailwayRuntimeProfile() : resolveDefaultAgentRuntimeProfile()
  if (!profile.enabled || !profile.sessionEnabled || (profile.backend !== "cloudflare-opencode-session" && profile.backend !== "railway-opencode")) {
    return NextResponse.json({ prewarmed: false, reason: "session_disabled" })
  }
  const customAgentId = parseCustomAgentRuntimeId(agentId)
  if (agentId !== "general" && !isAiEntryAgentId(agentId) && customAgentId === null) {
    return NextResponse.json({ prewarmed: false, reason: "agent_unavailable" })
  }

  let customSkillBindings: Record<string, unknown> | null = null
  let agentInstructions = agentId === "general" ? "" : await loadExecutiveSkillForAgent(agentId)
  if (customAgentId !== null) {
    if (!currentUser.enterpriseId) return NextResponse.json({ prewarmed: false })
    const customAgent = await getCustomAgentForUser({
      agentId: customAgentId,
      enterpriseId: currentUser.enterpriseId,
      userId: currentUser.id,
      isEnterpriseAdmin: currentUser.enterpriseRole === "admin" && currentUser.enterpriseStatus === "active",
    })
    if (!customAgent || customAgent.executionMode !== "direct_agent" || customAgent.status === "disabled" || customAgent.status === "archived") {
      return NextResponse.json({ prewarmed: false })
    }
    customSkillBindings = customAgent.skillBindings
    agentInstructions = customAgent.systemPrompt
  }

  const selection = agentId !== "general" && isAiEntrySharedAgentRuntimeEnabled(agentId)
    ? resolveSharedSkillSetSelection({
        agentId,
        enterpriseId: currentUser.enterpriseId,
        selectedSkillIds: [],
        allowedSkillIds: resolveAiEntryAgentRuntimePolicy({ agentId }).allowedSkillIds,
        customSkillBindings,
      })
    : null
  if (selection) {
    const bundle = await upsertSharedSkillSetBundle({ selection, agentInstructions })
    if (!bundle.configured) return NextResponse.json({ prewarmed: false, reason: "skill_bundle_unavailable" })
  }

  const requestedProviderId = text(body?.providerId).toLowerCase()
  const requestedModelId = text(body?.modelId)
  const configuredProviders = getConfiguredAiEntryProviders()
  let providers = configuredProviders
  if (requestedProviderId && !providers.some((provider) => provider.id === requestedProviderId)) {
    const enterpriseRuntime = await getEnterpriseTextRuntimeProviderConfigsForUser(currentUser)
    providers = [...configuredProviders, ...(enterpriseRuntime?.providerConfigs || [])]
  }
  const provider = requestedProviderId
    ? providers.find((item) => item.id === requestedProviderId)
    : businessAgent
      ? providers.find((item) => item.id === "deepseek")
      : providers[0]
  if (!provider?.apiKey || !provider.baseURL) {
    return NextResponse.json({ prewarmed: false, reason: "provider_unavailable" })
  }
  const modelId = requestedModelId || (businessAgent ? "deepseek-v4-pro" : provider.model)
  if (!modelId) return NextResponse.json({ prewarmed: false, reason: "model_unavailable" })
  if (isDeprecatedTextModelId(modelId)) {
    return NextResponse.json({ prewarmed: false, reason: "deprecated_model" })
  }

  // The durable session key includes the persisted conversation ID. Creating
  // this empty record is the only prewarm-side write; no message or artifact
  // is created, and the normal chat request reuses the returned ID.
  const runtimeAgentId = agentId === "general" ? null : agentId

  const conversation = await ensureAiEntryConversation(
    currentUser.id,
    requestedConversationId,
    "New chat",
    null,
    conversationScope,
    runtimeAgentId,
  )
  const conversationId = conversation.id

  const runId = randomUUID()
  const sessionKey = await buildAgentRuntimeSessionKey({
    enterpriseId: currentUser.enterpriseId,
    userId: currentUser.id,
    conversationId,
    agentId,
  })
  const runtimeInput = buildAgentRuntimeInput({
    runId,
    sessionKey,
    conversationId,
    enterpriseId: currentUser.enterpriseId,
    userId: currentUser.id,
    agentId: runtimeAgentId,
    selectedSkillIds: selection?.skills.map((skill) => skill.id) || [],
    sharedSkillSetSelection: selection,
    systemPrompt: "OpenCode session preparation. Do not answer or invoke a model.",
    messages: [{ role: "user", content: "Prepare the session only." }],
    workflowContext: null,
    allowNetwork: false,
    profileLimits: { maxArtifacts: profile.maxArtifacts, maxArtifactBytes: profile.maxArtifactBytes, maxArtifactTotalBytes: profile.maxArtifactTotalBytes },
  })
  const providerPayload = {
    providerId: provider.id,
    modelId,
    baseUrl: provider.baseURL,
    apiKey: provider.apiKey,
  }
  try {
    if (profile.backend === "railway-opencode") {
      const prepared = await prepareRailwaySession({
        runId,
        sessionKey,
        input: runtimeInput,
        provider: providerPayload,
      }, { runnerUrl: profile.runnerUrl })
      if (!prepared.prepared || prepared.sessionReady === false) return NextResponse.json({ prewarmed: false, reason: "session_not_ready" })
    } else {
      const prepared = await prepareCloudflareSession({
        runId,
        sessionKey,
        deadlineMs: 3_600_000,
        input: {
          ...runtimeInput,
          protocolVersion: 2 as const,
          sessionKey,
          functionId: runtimeAgentId,
          selectedSkillIds: selection?.skills.map((skill) => skill.id) || [],
          selectedMcpServerIds: [],
          attachmentObjects: [],
          checkpoint: null,
        },
        provider: providerPayload,
      }, { runnerUrl: profile.runnerUrl })
      if (!prepared.prepared) return NextResponse.json({ prewarmed: false, reason: "session_not_ready" })
    }
  } catch (error) {
    console.warn("ai-entry.opencode.prewarm.failed", {
      agentId,
      providerId: provider.id,
      modelId,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ prewarmed: false, reason: "runner_unavailable" })
  }
  return NextResponse.json({ prewarmed: true, session_ready: true, conversationId })
}
