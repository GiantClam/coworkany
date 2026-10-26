import type { WriterRuntimeContext } from "@/lib/writer/runtime/session-runtime"
import { isDeprecatedTextModelId } from "../../packages/runtime-contracts/src/model-policy"

export type AgentRuntimeProvider = "ai-sdk-native" | "opencode"

export type AgentRuntimeBackend = "native" | "local-exec" | "cloudflare-sandbox-exec" | "cloudflare-opencode-session" | "railway-opencode"

export type AgentRuntimeDeploymentMode = "saas-cloudflare-sandbox" | "saas-railway" | "private-local-exec" | "desktop-local-exec"

export type WorkflowContext = {
  workflowRunId: number
  workflowKey: string
  status: "queued" | "running" | "waiting_for_input" | "succeeded" | "failed" | "cancelled"
  currentStepKey: string | null
  latestStepSummaries: string[]
  artifactIds: number[]
  allowedUserActions: string[]
}

/**
 * A named set of existing, platform-governed text Skills.  It is a runtime
 * selection rather than a new management model or a content version.
 */
export type SharedSkillSetSelection = {
  runtimeKind: "shared-agent"
  agentId: string
  skills: Array<{ id: string; position: number }>
  skillSetId: string
  bundleKey: string
}

export type RuntimeGatewayDecision =
  | { kind: "opencode-chat"; backend: Exclude<AgentRuntimeBackend, "native" | "local-exec">; reason: string }
  | { kind: "native-tool"; requiredToolIds: string[]; reason: string }
  | { kind: "workflow-continuation"; workflowRunId: number; allowedUserActions: string[]; reason: string }
  | { kind: "ai-sdk-native"; reason: string }

export type ProcessChunk = {
  type: "stdout" | "stderr"
  data: string
}

export type ProcessExit = {
  type: "exit"
  exitCode: number | null
  signal: string | null
}

export type RuntimeArtifactPayload = {
  path: string
  title: string
  kind: string
  mimeType: string
  sizeBytes: number
  contentBase64: string
}

export type AgentRuntimeEvent =
  | { event: "runtime_selected"; provider: "opencode"; backend: Exclude<AgentRuntimeBackend, "native">; runId: string }
  | { event: "session_ready"; runId: string; sessionKey: string }
  | { event: "run_queued"; runId: string; sessionKey: string; status: "queued" }
  | { event: "runtime_started"; runId: string }
  | { event: "agent_resolved"; agentId: string; runId: string }
  | { event: "skill_activated"; skillId: string; runId: string }
  | { event: "skill_completed"; skillId: string; runId: string }
  | { event: "skill_failed"; skillId: string; message: string; runId: string }
  | { event: "text_delta"; delta: string; runId: string }
  | { event: "reasoning_delta"; delta: string; runId: string }
  | { event: "tool_event"; tool: string; toolCallId?: string; phase: "started" | "completed" | "failed"; message?: string; runId: string }
  | { event: "writer_result_submitted"; result: Record<string, unknown>; runId: string }
  | { event: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number; runId: string }
  | { event: "artifact_payload"; artifact: RuntimeArtifactPayload; runId: string }
  | { event: "artifact_reference"; artifact: RuntimeArtifactReference; runId: string }
  | { event: "checkpoint_saved"; checkpoint: RuntimeCheckpointRef; runId: string }
  | { event: "runtime_warning"; code: string; message: string; runId: string }
  | { event: "runtime_error"; code: string; message: string; retryable: boolean; runId: string }
  | { event: "done"; runId: string }

export type AgentRuntimeInput = {
  runId: string
  /** Stable conversation-scoped key used by long-running agent workspaces. */
  sessionKey?: string | null
  conversationId: string | null
  conversationRevision?: number | null
  contextHash?: string | null
  /** Durable Writer context; never folded into the clipped chat-history window. */
  writerContext?: WriterRuntimeContext | null
  credentialRef?: string | null
  enterpriseId: number | null
  userId: number
  agentId: string | null
  writerPhase?: "briefing" | "draft"
  selectedSkillIds?: string[]
  sharedSkillSetSelection?: SharedSkillSetSelection | null
  systemPrompt: string
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool"
    content: string
  }>
  attachments: Array<{
    id: string
    fileName: string
    mimeType: string
    textSummary: string
  }>
  modelHint?: string | null
  reasoningEffort?: "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null
  projectSnapshot?: RuntimeProjectSnapshot | null
  artifactContext: Array<{
    artifactId: number
    title: string
    kind: string
    summary: string
  }>
  workflowContext: WorkflowContext | null
  artifactContract: {
    manifestPath: "artifact-manifest.json"
    artifactDir: "artifacts"
    maxArtifacts: number
    maxArtifactBytes: number
    maxArtifactTotalBytes: number
    allowedExtensions: string[]
  }
  policy: {
    allowPlatformTools: false
    allowTools: false
    allowMcp: false
    allowSkillInstall: false
    allowNetwork: boolean
  }
}

export type OpenCodeProviderConfig = {
  /**
   * The app signs this configuration into a single runtime request. Runtimes
   * must inject the key only into the matching provider environment variable.
   */
  /** Provider ID is supplied by the application; runtimes must not maintain a provider allowlist. */
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
}

export function isValidOpenCodeProviderConfig(value: unknown): value is OpenCodeProviderConfig {
  if (!value || typeof value !== "object") return false
  const provider = value as Partial<OpenCodeProviderConfig>
  if (typeof provider.providerId !== "string" || !provider.providerId.trim()) return false
  if (typeof provider.modelId !== "string" || !provider.modelId.trim()) return false
  if (isDeprecatedTextModelId(provider.modelId)) return false
  if (typeof provider.baseUrl !== "string" || !provider.baseUrl.trim()) return false
  if (typeof provider.apiKey !== "string" || !provider.apiKey.trim()) return false
  try {
    const url = new URL(provider.baseUrl)
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return false
  } catch {
    return false
  }
  return true
}

export type RuntimeProfile = {
  provider: AgentRuntimeProvider
  backend: AgentRuntimeBackend
  deploymentMode: AgentRuntimeDeploymentMode
  enabled: boolean
  asyncEnabled: boolean
  sessionEnabled: boolean
  runnerUrl: string | null
  timeoutMs: number
  maxOutputBytes: number
  maxArtifacts: number
  maxArtifactBytes: number
  maxArtifactTotalBytes: number
}

export type CloudflareOpenCodeRunRequest = {
  runId: string
  input: AgentRuntimeInput
  timeoutMs: number
  provider: OpenCodeProviderConfig
}

export type RuntimeObjectRef = {
  provider: "r2"
  bucket: string
  key: string
  publicUrl: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type RuntimeArtifactReference = RuntimeObjectRef & {
  title: string
  kind: string
  checksumSha256: string | null
}

export type RuntimeProjectSnapshot = {
  schemaVersion: 1
  projectKind: "ppt-master"
  state: Record<string, unknown>
}

export const MAX_RUNTIME_PROJECT_SNAPSHOT_BYTES = 128 * 1024

export function isValidRuntimeProjectSnapshot(value: unknown): value is RuntimeProjectSnapshot {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || record.projectKind !== "ppt-master") return false
  if (!record.state || typeof record.state !== "object" || Array.isArray(record.state)) return false
  try {
    return new TextEncoder().encode(JSON.stringify(record)).byteLength <= MAX_RUNTIME_PROJECT_SNAPSHOT_BYTES
  } catch {
    return false
  }
}

export type RuntimeCheckpointRef = {
  sequence: number
  stage: string
  backupId: string | null
  backupDir: string | null
  resumePayload: Record<string, unknown>
  projectSnapshot?: RuntimeProjectSnapshot | null
}

export type AgentRuntimeInputV2 = AgentRuntimeInput & {
  protocolVersion: 2
  sessionKey: string
  functionId: string | null
  selectedSkillIds: string[]
  selectedMcpServerIds: string[]
  attachmentObjects: RuntimeObjectRef[]
  checkpoint: RuntimeCheckpointRef | null
}

export type CloudflareSessionRunRequest = {
  runId: string
  sessionKey: string
  input: AgentRuntimeInputV2
  deadlineMs: 3_600_000
  provider: OpenCodeProviderConfig
}

/** Signed preparation request. It shares the session runtime payload but never executes a model turn. */
export type CloudflareSessionPrepareRequest = CloudflareSessionRunRequest

export type CloudflareSessionQueueMessage = {
  version: 2
  runId: string
  sessionKey: string
  dispatchKey: string
  requestedAt: string
}
