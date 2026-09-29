"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { desktopUIMessageText } from "@coworkany/workbench-client"
import type { NavigationAdapter, WorkbenchClient } from "@coworkany/workbench-client"
import { WorkbenchCloudMessageShell, WorkbenchMessageTimeline } from "@coworkany/workbench-ui"
import {
  ArrowRight,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react"

import { MessageContent } from "@/components/ai-entry/prompt-kit/message"
import { MessagePartViewList } from "@/components/ai-entry/message-parts/message-part-view"
import { PptPreviewReportCard } from "@/components/ai-entry/ppt-preview-report-card"
import {
  applySseEvent,
} from "@/lib/ai-entry/message-parts/reducer"
import type { ArtifactPart, MessagePart } from "@/lib/ai-entry/message-parts/types"
import { buildConversationArtifactParts } from "@/lib/ai-entry/conversation-artifacts"
import { attachConversationArtifacts } from "@/lib/ai-entry/conversation-artifact-placement"
import {
  isPendingAssistantTaskStoreStorageKey,
  listAiEntryPendingTasks,
  removePendingAssistantTask,
  savePendingAssistantTask,
} from "@/lib/assistant-task-store"
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionAddAttachments,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@coworkany/workbench-ui"
import { WorkbenchModelReasoningSelector } from "@coworkany/workbench-ui"
import { useI18n } from "@/components/locale-provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TextMorph } from "@/components/ui/text-morph"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceTaskEvents } from "@/components/workspace/workspace-message-primitives"
import {
  normalizePendingTaskEvents,
  settlePendingTaskEvents,
  type PendingTaskEvent,
} from "@/lib/assistant-task-events"
import {
  getAiEntryQuickPrompts,
  resolveAiEntryAgentName,
  resolveAiEntryRequestedAgentId,
  resolveAiEntryWorkspaceKicker,
  resolveAiEntryWorkspacePlaceholder,
  resolveAiEntryWorkspaceSubtitle,
  resolveAiEntryWorkspaceTitle,
} from "@/lib/ai-entry/agent-ui"
import {
  AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT,
  AI_ENTRY_CONSULTING_ENTRY_MODE,
  isAiEntryPptAgentId,
  isConsultingAdvisorEntryMode,
  pickAgentDefaultModelId,
  pickConsultingModelId,
  pickPptAssistantDefaultModelId,
  resolvePptAssistantModelSelection,
  shouldLockConsultingAdvisorModel,
} from "@/lib/ai-entry/model-policy"
import { resolveEquivalentModelId } from "@/lib/ai-entry/model-id-registry"
import {
  shouldDeferSyntheticTaskRunMessages,
  shouldReuseLoadedConversation,
} from "@/lib/ai-entry/conversation-view-state"
import { renderAiEntryDisplayErrorMessage } from "@/lib/ai-entry/error-display"
import {
  buildPptToolResultMessage,
  extractQueuedPptBackgroundTaskContext,
  extractLatestPptPreviewContext,
  stripPptHiddenContextMarkers,
} from "@/lib/ai-entry/ppt-tool-result-message"
import type { AiEntryTaskRunSummary } from "@/lib/ai-entry/task-runs"
import {
  AI_ENTRY_NEW_CONVERSATION_EVENT,
  type AiEntryNewConversationDetail,
} from "@/lib/ai-entry/new-conversation-event"
import { dispatchAiEntrySidebarRefresh } from "@/lib/ai-entry/sidebar-refresh-event"
import {
  formatMessageTime,
  resolveBrowserTimeZone,
} from "@/lib/ai-entry/message-time"
import {
  buildPendingConversationEnvelope,
  readFreshPendingConversationMessages,
} from "@/lib/ai-entry/pending-conversation-store"
import {
  hasAiEntryCompletedAssistantMessage,
  hasAiEntryPptPreviewMaterialized,
  normalizeConversationMessageOrder,
  resolveAiEntryCompletedConversationMessages,
  resolveAiEntryBootstrapMessages,
  resolveAiEntryRestoredMessages,
  resolveAiEntrySharedPendingMessages,
  shouldShowAiEntryConversationRestore,
} from "@/lib/ai-entry/message-restore"
import { mapPersistedAiEntryMessages as mapPersistedAiEntryMessagesFromRecords } from "@/lib/ai-entry/persisted-message-mapper"
import { buildOutgoingAiEntryMessages } from "@/lib/ai-entry/chat-attachments"
import { resolveAiEntryTargetConversationId } from "@/lib/ai-entry/route-sync"
import { resolveAiEntryTaskPollIntervalMs } from "@/lib/ai-entry/task-run-runtime"
import type { KnowledgeScope } from "@/lib/knowledge/types"
import { cn } from "@/lib/utils"
import {
  getReasoningCapabilities,
  normalizeReasoningEffort,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "@/lib/ai-entry/reasoning"

const AI_ENTRY_PENDING_TASK_MAX_POLL_ERRORS = 5
const AI_ENTRY_PENDING_TASK_MAX_AGE_MS = 70 * 60 * 1000
const AI_ENTRY_PENDING_TASK_HISTORY_REFRESH_CADENCE = 4
const AI_ENTRY_STREAM_RECOVERY_POLL_INTERVAL_MS = 3000
const AI_ENTRY_AGENT_PREWARM_TIMEOUT_MS = 15_000

type ChatAttachment = {
  id: string
  name: string
  mediaType: string
  size: number
  artifactId?: number
  dataUrl?: string
  text?: string
}

type Copy = {
  title: string
  subtitle: string
  placeholder: string
  send: string
  loading: string
  restoring: string
  quickStart: string
  modelLabel: string
  reasoningLabel: string
  reasoningAuto: string
  modelLoading: string
  modelEmpty: string
  agentLabel: string
  agentLoading: string
  agentEmpty: string
  agentRecommended: string
  selectedAgent: string
  landingHint: string
  copy: string
  copied: string
  copyReply: string
  copiedReply: string
  knowledgeLabel: string
  knowledgeDisabled: string
  knowledgeAllEnabled: string
  knowledgeSelectedCount: string
  knowledgeAdd: string
  knowledgeChoose: string
  knowledgeLoading: string
  knowledgeEmpty: string
  knowledgeSearch: string
  enableKnowledge: string
  disableKnowledge: string
  uploadFile: string
  addMenu: string
  unknownError: string
  errorPrefix: string
}
type ExtractedChatAttachmentResponse = {
  data?: {
    id?: string
    name?: string
    mediaType?: string
    originalMediaType?: string
    size?: number
    text?: string
    textCharCount?: number
    truncated?: boolean
  }
  error?: string
  code?: string
  message?: string
}
type UploadedAssetLibraryAttachmentResponse = {
  data?: {
    artifact?: {
      id?: number
    }
  }
  error?: string
}
type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  rawContent?: string
  parts?: MessagePart[]
  attachments?: ChatAttachment[]
  createdAt?: number
}
type ModelOption = {
  id: string
  name: string
  modelId?: string
  providerId?: string
  providerLabel?: string
  runtimeId?: string
  canonicalId?: string
  aliases?: string[]
}
type ModelGroupOption = { family: string; label: string; models: ModelOption[] }
type AgentOption = { id: string; category: string; name: string; description: string }
type ParsedArtifactRow = {
  label: string
  value: string
  href: string | null
}
type ParsedArtifactResult = {
  body: string
  title: string
  rows: ParsedArtifactRow[]
  workHref: string | null
  downloadHref: string | null
}

type MessageApiResponse = {
  data?: Array<{ id?: string; role?: "user" | "assistant"; content?: string; created_at?: number }>
  pending_task?: {
    task_id?: string
    status?: "pending" | "running" | "success" | "failed"
    task_type?: string | null
    conversation_id?: string | null
    agent_id?: string | null
    created_at?: number
    updated_at?: number
    started_at?: number | null
    stage?: "brief_validating" | "story_planning" | "variant_generating" | "preview_rendering" | "session_persisting" | "runtime_queued" | "runtime_running" | "runtime_checkpointing" | "runtime_publishing"
    stage_label?: string
    progress_current?: number
    progress_total?: number
    last_heartbeat_at?: number
    finished_at?: number | null
    preview_session_id?: string | null
    request_label?: string | null
    result_summary?: string | null
    selected_template_id?: string | null
    selected_template_label?: string | null
    error_code?: string | null
    error_message?: string | null
    error?: string | null
    events?: Array<{
      type?: string
      label?: string
      detail?: string
      status?: "running" | "completed" | "failed" | "info"
      at?: number
    }>
  } | null
  task_runs?: Array<MessageApiPendingTask>
  conversation_state?: {
    artifacts?: Array<{
      artifactId?: number
      title?: string
      kind?: string
      summary?: string
      createdAt?: number
    }>
    ppt?: {
      phase?: "idle" | "preview-ready" | "preview-invalidated" | "exported"
      latestPreview?: {
        previewSessionId?: string | null
        defaultVariantKey?: string | null
        variantKeys?: string[]
      } | null
      latestExport?: {
        previewSessionId?: string | null
        selectedVariantKey?: string | null
        artifactId?: number | null
      } | null
    } | null
  } | null
  conversation?: {
    current_model_id?: string | null
  } | null
}
type AiEntryConversationStatePayload = NonNullable<MessageApiResponse["conversation_state"]>
type MessageApiPendingTask = AiEntryTaskRunSummary
type MessageApiTaskRun = AiEntryTaskRunSummary
type ChatApiResponse = {
  message?: string
  conversationId?: string
  agentId?: string | null
  error?: string
}
type ChatStreamApiResponse = {
  event?: string
  conversation_id?: string
  answer?: string
  provider?: string
  provider_model?: string
  fallback_reason?: "empty_response" | "timeout" | "connection" | "rate_limit" | "provider_error"
  runtime_error?: string
  agent_id?: string | null
  skill_id?: string
  message?: string
  artifact?: {
    kind?: string
    title?: string
    fileName?: string
    artifactId?: number | null
    downloadUrl?: string | null
  }
  error?: string
  data?: {
    taskId?: string
    runtimeRunId?: string
    taskType?: string
    stage?: string
    runtimeStatus?: "running" | "completed" | "failed"
    toolName?: string
    toolCallId?: string
    status?: "hit" | "miss" | "failed"
    snippetCount?: number
    datasetCount?: number
    message?: string
    args?: {
      query?: string
      intent?: string
    }
    result?: {
      ok?: boolean
      status?: string
      message?: string
      query?: string
      results?: Array<{ title?: string; url?: string; snippet?: string; provider?: string }>
      backgroundTask?: {
        taskId?: string
        conversationId?: string | null
        toolName?: string
        status?: string
      }
      error?: {
        code?: string
        message?: string
      }
    }
    validation?: {
      ok?: boolean
      checks?: Array<{
        code?: string
        ok?: boolean
        message?: string
      }>
    }
  } | null
}

function parseMarkdownLink(value: string) {
  const match = value.match(/^\[([^\]]+)]\(([^)]+)\)$/)
  if (!match) return { label: value, href: null }
  return { label: match[1] || value, href: match[2] || null }
}

function parseArtifactResult(content: string): ParsedArtifactResult | null {
  const lines = content.split(/\r?\n/)
  let headingIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const isArtifactHeading =
      /^已生成.+[:：]$/.test(trimmed) ||
      /^(HTML|PPT|Deliverable).+generated:?$/i.test(trimmed)
    if (isArtifactHeading) {
      headingIndex = index
      break
    }
  }
  if (headingIndex < 0) return null

  const rows: ParsedArtifactRow[] = []
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith("- ")) break
    const rowText = trimmed.slice(2)
    const separatorIndex = rowText.indexOf(":")
    const label = separatorIndex >= 0 ? rowText.slice(0, separatorIndex).trim() : rowText.trim()
    const rawValue = separatorIndex >= 0 ? rowText.slice(separatorIndex + 1).trim() : ""
    const parsed = parseMarkdownLink(rawValue)
    rows.push({ label, value: parsed.label, href: parsed.href })
  }

  if (rows.length === 0) return null

  const workHref = rows.find((row) => /作品库|work library/i.test(row.label))?.href ?? null
  const downloadHref = rows.find((row) => /下载|download/i.test(row.label))?.href ?? null
  const body = lines.slice(0, headingIndex).join("\n").trim()
  const title = lines[headingIndex]?.trim().replace(/[:：]$/, "") || "Artifact"

  return { body, title, rows, workHref, downloadHref }
}

function ArtifactResultBlock({ artifact }: { artifact: ParsedArtifactResult }) {
  const primaryHref = artifact.rows.find((row) => /预览|preview|open|链接|link/i.test(row.label))?.href ?? null
  return (
    <div className="artifact-card">
      <div className="artifact-cover artifact-cover-muted">
        <FileText className="h-7 w-7 text-primary/80" />
        <span className="artifact-cover-ext">FILE</span>
      </div>
      <div className="artifact-meta">
        <div className="artifact-eyebrow">Deliverable</div>
        <div className="artifact-title-text">{artifact.title}</div>
        <div className="artifact-subtitle">{artifact.rows.find((row) => /文件|file/i.test(row.label))?.value ?? artifact.rows[0]?.value ?? "Ready"}</div>
        <div className="artifact-card-actions">
          {primaryHref ? (
            <a className="artifact-action" href={primaryHref} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Preview
            </a>
          ) : null}
          {artifact.downloadHref ? (
            <a className="artifact-action" href={artifact.downloadHref} download>
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          ) : null}
          {artifact.workHref ? (
            <a className="artifact-action" href={artifact.workHref}>
              <LibraryBig className="h-3.5 w-3.5" />
              Works
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

type KnowledgeDatasetOption = {
  id: number
  name: string
  category: KnowledgeScope
}

type KnowledgeDatasetsApiResponse = {
  data?: {
    items?: Array<{
      id?: number
      name?: string
      category?: KnowledgeScope
      enabled?: boolean
    }>
  }
  error?: string
}

export type AiEntryWorkspaceLinkAction = {
  label: string
  href: string
}

export type AiEntryWorkspaceGuideMessage = {
  title: string
  body: string
  promptLabel?: string
  prompts?: string[]
}

type ModelApiResponse = {
  providerId?: string | null
  selectedProviderId?: string | null
  providers?: Array<{ id?: string; label?: string }>
  selectedModelId?: string | null
  modelGroups?: Array<{
    family?: string
    label?: string
    models?: Array<{
      id?: string
      name?: string
      modelId?: string
      providerId?: string
      providerLabel?: string
      runtimeId?: string
      canonicalId?: string
      aliases?: string[]
    }>
  }>
  models?: Array<{
    id?: string
    name?: string
    modelId?: string
    providerId?: string
    providerLabel?: string
    runtimeId?: string
    canonicalId?: string
    aliases?: string[]
  }>
}
type AgentApiResponse = {
  defaultAgentId?: string | null
  agents?: Array<{ id?: string; category?: string; name?: { zh?: string; en?: string }; description?: { zh?: string; en?: string } }>
  groups?: Array<{ id?: string; label?: { zh?: string; en?: string } }>
}

// Bump the key when the product default changes so an old Grok/Claude choice
// does not silently override the DeepSeek V4 Pro default on first load.
const AI_ENTRY_SELECTED_MODEL_STORAGE_KEY = "ai-entry-selected-model-id-v2"
const AI_ENTRY_SELECTED_REASONING_STORAGE_KEY = "ai-entry-selected-reasoning-v1"
const SHOULD_PREFER_CATALOG_MODEL_DEFAULT = process.env.NODE_ENV === "development"
const AI_ENTRY_PENDING_CONVERSATION_STORAGE_PREFIX = "ai-entry-pending-conversation-v1:"
const AI_ENTRY_PENDING_CONVERSATION_SELECTION_STORAGE_PREFIX = "ai-entry-pending-conversation-selection-v1:"
const AI_ENTRY_SHARED_PENDING_CONVERSATION_STORAGE_PREFIX = "ai-entry-shared-pending-conversation-v1:"
const AI_ENTRY_SHARED_PENDING_CONVERSATION_EVENT = "ai-entry:shared-pending-conversation-updated"
const AI_ENTRY_MAX_ATTACHMENTS = 4
const AI_ENTRY_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

function getPendingConversationStorageKey(conversationId: string) {
  return `${AI_ENTRY_PENDING_CONVERSATION_STORAGE_PREFIX}${conversationId}`
}

function getSharedPendingConversationStorageKey(conversationId: string) {
  return `${AI_ENTRY_SHARED_PENDING_CONVERSATION_STORAGE_PREFIX}${conversationId}`
}

function getPendingConversationSelectionStorageKey(conversationId: string) {
  return `${AI_ENTRY_PENDING_CONVERSATION_SELECTION_STORAGE_PREFIX}${conversationId}`
}

function savePendingConversationSelection(input: {
  conversationId: string | null
  modelId: string | null
  reasoningEffort: ReasoningEffort
}) {
  if (!input.conversationId || !input.modelId || typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      getPendingConversationSelectionStorageKey(input.conversationId),
      JSON.stringify({
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
      }),
    )
  } catch {
    // sessionStorage is a best-effort bridge across the first route transition.
  }
}

function readPendingConversationSelection(conversationId: string | null) {
  if (!conversationId || typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(getPendingConversationSelectionStorageKey(conversationId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { modelId?: unknown; reasoningEffort?: unknown }
    const modelId = typeof parsed.modelId === "string" && parsed.modelId.trim() ? parsed.modelId.trim() : null
    if (!modelId) return null
    const reasoningEffort = REASONING_EFFORTS.includes(parsed.reasoningEffort as ReasoningEffort)
      ? parsed.reasoningEffort as ReasoningEffort
      : "auto"
    return { modelId, reasoningEffort }
  } catch {
    return null
  }
}

function isSharedPendingConversationStorageKey(key: string | null, conversationId: string | null) {
  return Boolean(
    key &&
    conversationId &&
    key === getSharedPendingConversationStorageKey(conversationId),
  )
}

function readPendingConversationMessagesFromStorage(raw: string | null, clear: () => void) {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    const pendingMessages = readFreshPendingConversationMessages<{
      id?: unknown
      role?: unknown
      content?: unknown
      rawContent?: unknown
      attachments?: unknown
      parts?: unknown
      createdAt?: unknown
    }>(parsed)
    if (pendingMessages.length === 0) {
      clear()
      return []
    }
    return pendingMessages
      .map((item) => {
        const id = typeof item?.id === "string" && item.id.trim() ? item.id : `cached-${Date.now()}`
        const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null
        const content = typeof item?.content === "string" ? item.content : ""
        const rawContent = typeof item?.rawContent === "string" ? item.rawContent : undefined
        const attachments = Array.isArray(item?.attachments) ? item.attachments : undefined
        const parts = Array.isArray(item?.parts) ? item.parts : undefined
        const createdAt =
          typeof item?.createdAt === "number" && Number.isFinite(item.createdAt)
            ? item.createdAt
            : undefined
        if (!role) return null
        return { id, role, content, rawContent, attachments, parts, createdAt } as ChatMessage
      })
      .filter((item): item is ChatMessage => Boolean(item))
  } catch {
    clear()
    return []
  }
}

function readPendingConversationMessages(conversationId: string | null) {
  if (!conversationId || typeof window === "undefined") return []
  const sharedMessages = readPendingConversationMessagesFromStorage(
    window.localStorage.getItem(getSharedPendingConversationStorageKey(conversationId)),
    () => {
      window.localStorage.removeItem(getSharedPendingConversationStorageKey(conversationId))
    },
  )
  if (sharedMessages.length > 0) {
    return sharedMessages
  }

  return readPendingConversationMessagesFromStorage(
    window.sessionStorage.getItem(getPendingConversationStorageKey(conversationId)),
    () => {
      window.sessionStorage.removeItem(getPendingConversationStorageKey(conversationId))
    },
  )
}

function dispatchSharedPendingConversationUpdate(conversationId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<{ conversationId: string }>(AI_ENTRY_SHARED_PENDING_CONVERSATION_EVENT, {
      detail: { conversationId },
    }),
  )
}

function savePendingConversationMessages(conversationId: string | null, messages: ChatMessage[]) {
  if (!conversationId || typeof window === "undefined") return
  const payload = JSON.stringify(buildPendingConversationEnvelope(messages))
  try {
    window.sessionStorage.setItem(getPendingConversationStorageKey(conversationId), payload)
  } catch {
    // sessionStorage is a best-effort bridge across the first route transition.
  }
  try {
    window.localStorage.setItem(getSharedPendingConversationStorageKey(conversationId), payload)
  } catch {
    // localStorage is a best-effort bridge across tabs.
  }
  dispatchSharedPendingConversationUpdate(conversationId)
}

function clearPendingConversationMessages(conversationId: string | null) {
  if (!conversationId || typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(getPendingConversationStorageKey(conversationId))
  } catch {
    // ignore storage cleanup failures
  }
  try {
    window.localStorage.removeItem(getSharedPendingConversationStorageKey(conversationId))
  } catch {
    // ignore storage cleanup failures
  }
  dispatchSharedPendingConversationUpdate(conversationId)
}

function readPersistedSelectedModelId() {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(AI_ENTRY_SELECTED_MODEL_STORAGE_KEY)
    const normalized = typeof raw === "string" ? raw.trim() : ""
    return normalized || null
  } catch {
    return null
  }
}

function persistSelectedModelId(modelId: string | null | undefined) {
  if (typeof window === "undefined") return
  const normalized = typeof modelId === "string" ? modelId.trim() : ""
  if (!normalized) return
  try {
    window.localStorage.setItem(AI_ENTRY_SELECTED_MODEL_STORAGE_KEY, normalized)
  } catch {
    // ignore localStorage write failures
  }
}

function readPersistedReasoningEffort(): ReasoningEffort {
  if (typeof window === "undefined") return "auto"
  try {
    const raw = window.localStorage.getItem(AI_ENTRY_SELECTED_REASONING_STORAGE_KEY)
    return REASONING_EFFORTS.includes(raw as ReasoningEffort) ? raw as ReasoningEffort : "auto"
  } catch {
    return "auto"
  }
}

function persistReasoningEffort(effort: ReasoningEffort) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(AI_ENTRY_SELECTED_REASONING_STORAGE_KEY, effort)
  } catch {
    // ignore localStorage write failures
  }
}

function resolveDisplayModelId(
  rawModelId: string | null | undefined,
  models: ModelOption[],
) {
  const normalized = typeof rawModelId === "string" ? rawModelId.trim() : ""
  if (!normalized) return null

  const exact = models.find((item) => item.id === normalized)
  if (exact) return exact.id

  const candidates = models.flatMap((item) =>
    [item.id, item.runtimeId, item.canonicalId, ...(item.aliases || [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => ({ optionId: item.id, value })),
  )

  const matched = resolveEquivalentModelId(
    normalized,
    candidates.map((item) => item.value),
  )
  if (!matched) return null

  const mapped = candidates.find((item) => item.value === matched)
  return mapped?.optionId || null
}

function mapPersistedAiEntryMessages(
  payload: MessageApiResponse | null | undefined,
) {
  return mapPersistedAiEntryMessagesFromRecords(payload?.data) as ChatMessage[]
}

function normalizeMessageApiTaskRun(
  taskRun: MessageApiResponse["pending_task"] | null | undefined,
): MessageApiTaskRun | null {
  if (!taskRun || typeof taskRun.task_id !== "string" || !taskRun.task_id.trim()) {
    return null
  }
  return {
    task_id: taskRun.task_id.trim(),
    status:
      taskRun.status === "pending" || taskRun.status === "running" || taskRun.status === "success" || taskRun.status === "failed"
        ? taskRun.status
        : "pending",
    task_type: taskRun.task_type === "opencode_agent_run" ? "opencode_agent_run" : "preview_ppt_deck",
    conversation_id:
      typeof taskRun.conversation_id === "string" && taskRun.conversation_id.trim()
        ? taskRun.conversation_id.trim()
        : null,
    agent_id:
      typeof taskRun.agent_id === "string" && taskRun.agent_id.trim()
        ? taskRun.agent_id.trim()
        : null,
    created_at:
      typeof taskRun.created_at === "number" && Number.isFinite(taskRun.created_at)
        ? taskRun.created_at
        : Math.floor(Date.now() / 1000),
    updated_at:
      typeof taskRun.updated_at === "number" && Number.isFinite(taskRun.updated_at)
        ? taskRun.updated_at
        : typeof taskRun.created_at === "number" && Number.isFinite(taskRun.created_at)
          ? taskRun.created_at
          : Math.floor(Date.now() / 1000),
    started_at:
      typeof taskRun.started_at === "number" && Number.isFinite(taskRun.started_at)
        ? taskRun.started_at
        : null,
    stage:
      taskRun.stage === "brief_validating" ||
      taskRun.stage === "story_planning" ||
      taskRun.stage === "variant_generating" ||
      taskRun.stage === "preview_rendering" ||
      taskRun.stage === "session_persisting" ||
      taskRun.stage === "runtime_queued" ||
      taskRun.stage === "runtime_running" ||
      taskRun.stage === "runtime_checkpointing" ||
      taskRun.stage === "runtime_publishing"
        ? taskRun.stage
        : taskRun.status === "success"
          ? "session_persisting"
          : taskRun.status === "running"
            ? "story_planning"
            : "brief_validating",
    stage_label:
      typeof taskRun.stage_label === "string" && taskRun.stage_label.trim()
        ? taskRun.stage_label.trim()
        : taskRun.status === "failed"
          ? "Failed"
          : taskRun.status === "success"
            ? "Completed"
            : "Running",
    progress_current:
      typeof taskRun.progress_current === "number" && Number.isFinite(taskRun.progress_current)
        ? taskRun.progress_current
        : taskRun.status === "pending"
          ? 0
          : taskRun.status === "running"
            ? 1
            : 5,
    progress_total:
      typeof taskRun.progress_total === "number" && Number.isFinite(taskRun.progress_total)
        ? taskRun.progress_total
        : 5,
    last_heartbeat_at:
      typeof taskRun.last_heartbeat_at === "number" && Number.isFinite(taskRun.last_heartbeat_at)
        ? taskRun.last_heartbeat_at
        : typeof taskRun.updated_at === "number" && Number.isFinite(taskRun.updated_at)
          ? taskRun.updated_at
          : Math.floor(Date.now() / 1000),
    finished_at:
      typeof taskRun.finished_at === "number" && Number.isFinite(taskRun.finished_at)
        ? taskRun.finished_at
        : null,
    preview_session_id:
      typeof taskRun.preview_session_id === "string" && taskRun.preview_session_id.trim()
        ? taskRun.preview_session_id.trim()
        : null,
    request_label:
      typeof taskRun.request_label === "string" && taskRun.request_label.trim()
        ? taskRun.request_label.trim()
        : null,
    result_summary:
      typeof taskRun.result_summary === "string" && taskRun.result_summary.trim()
        ? taskRun.result_summary.trim()
        : null,
    selected_template_id:
      typeof taskRun.selected_template_id === "string" && taskRun.selected_template_id.trim()
        ? taskRun.selected_template_id.trim()
        : null,
    selected_template_label:
      typeof taskRun.selected_template_label === "string" && taskRun.selected_template_label.trim()
        ? taskRun.selected_template_label.trim()
        : null,
    error_code:
      typeof taskRun.error_code === "string" && taskRun.error_code.trim()
        ? taskRun.error_code.trim()
        : null,
    error_message:
      typeof taskRun.error_message === "string" && taskRun.error_message.trim()
        ? taskRun.error_message.trim()
        : typeof taskRun.error === "string" && taskRun.error.trim()
          ? taskRun.error.trim()
        : null,
    error:
      typeof taskRun.error_message === "string" && taskRun.error_message.trim()
        ? taskRun.error_message.trim()
        : typeof taskRun.error === "string" && taskRun.error.trim()
          ? taskRun.error.trim()
        : null,
    events: Array.isArray(taskRun.events)
      ? taskRun.events.reduce<MessageApiTaskRun["events"]>((events, event) => {
          if (!event || typeof event !== "object") return events
          const type = typeof event.type === "string" ? event.type.trim() : ""
          const label = typeof event.label === "string" ? event.label.trim() : ""
          if (!type || !label) return events
          // Older runtime records persisted model deltas as task events. They
          // belong to the assistant message, never to the step trace.
          if (type === "text_delta") return events
          events.push({
            type,
            label,
            detail: typeof event.detail === "string" && event.detail.trim() ? event.detail.trim() : undefined,
            status:
              event.status === "running" || event.status === "completed" || event.status === "failed" || event.status === "info"
                ? event.status
                : "running",
            at: typeof event.at === "number" && Number.isFinite(event.at) ? event.at : Math.floor(Date.now() / 1000),
          })
          return events
        }, [])
      : [],
  }
}

function mapAiEntryTaskRuns(payload: MessageApiResponse | null | undefined): MessageApiTaskRun[] {
  const normalizedTaskRuns = (payload?.task_runs || [])
    .map((taskRun) => normalizeMessageApiTaskRun(taskRun))
    .filter((taskRun): taskRun is MessageApiTaskRun => Boolean(taskRun))
  const normalizedPendingTask = normalizeMessageApiTaskRun(payload?.pending_task)
  if (normalizedPendingTask && !normalizedTaskRuns.some((taskRun) => taskRun.task_id === normalizedPendingTask.task_id)) {
    normalizedTaskRuns.unshift(normalizedPendingTask)
  }
  return normalizedTaskRuns
}

function mapPendingAiEntryTask(
  payload: MessageApiResponse | null | undefined,
): MessageApiPendingTask | null {
  return normalizeMessageApiTaskRun(payload?.pending_task)
}

function attachTaskRunsToMessages(messages: ChatMessage[], taskRuns: MessageApiTaskRun[], conversationArtifacts: ArtifactPart[] = []) {
  if (taskRuns.length === 0 && conversationArtifacts.length === 0) return messages

  const taskRunMap = new Map(taskRuns.map((taskRun) => [taskRun.task_id, taskRun] as const))
  const attachedTaskRunIds = new Set<string>()
  const mappedMessages = messages.map((message) => {
    if (message.role !== "assistant") return message
    const queuedTaskContext = extractQueuedPptBackgroundTaskContext(message.content)
    const taskRun =
      queuedTaskContext && taskRunMap.has(queuedTaskContext.taskId)
        ? taskRunMap.get(queuedTaskContext.taskId) || null
        : null
    if (!taskRun) return message
    attachedTaskRunIds.add(taskRun.task_id)
    const nextParts = (message.parts || []).filter(
      (part) => !(part.type === "task-run" && part.taskRun.task_id === taskRun.task_id),
    )
    return {
      ...message,
      parts: [
        ...nextParts,
        {
          type: "task-run",
          id: `task-run:${taskRun.task_id}`,
          taskRun,
        } satisfies MessagePart,
      ],
    }
  })

  const syntheticTaskRunMessages = taskRuns
    .filter((taskRun) => !attachedTaskRunIds.has(taskRun.task_id))
    .map((taskRun) => ({
      id: `task-run-message:${taskRun.task_id}`,
      role: "assistant" as const,
      content: "",
      createdAt: taskRun.created_at,
      parts: [
        {
          type: "task-run",
          id: `task-run:${taskRun.task_id}`,
          taskRun,
        } satisfies MessagePart,
      ],
    }))

  const nextMessages = normalizeConversationMessageOrder(
    [...mappedMessages, ...syntheticTaskRunMessages],
  )
  return attachConversationArtifacts(nextMessages, conversationArtifacts)
}

function saveAiEntryPendingTasks(taskRuns: MessageApiTaskRun[], fallback: {
  conversationId: string
  agentId: string | null
}) {
  for (const taskRun of taskRuns) {
    if (taskRun.status !== "pending" && taskRun.status !== "running") continue
    savePendingAssistantTask({
      taskId: taskRun.task_id,
      scope: "ai_entry",
      conversationId: taskRun.conversation_id || fallback.conversationId,
      agentId: taskRun.agent_id || fallback.agentId,
      taskType: taskRun.task_type,
      createdAt: taskRun.created_at * 1000,
    })
  }
}

function mergeAiEntryTaskRuns(currentTaskRuns: MessageApiTaskRun[], nextTaskRuns: MessageApiTaskRun[]) {
  const nextTaskRunMap = new Map(nextTaskRuns.map((taskRun) => [taskRun.task_id, taskRun] as const))
  const merged: MessageApiTaskRun[] = []

  for (const taskRun of currentTaskRuns) {
    if (nextTaskRunMap.has(taskRun.task_id)) {
      merged.push(nextTaskRunMap.get(taskRun.task_id)!)
      nextTaskRunMap.delete(taskRun.task_id)
    } else {
      merged.push(taskRun)
    }
  }

  for (const taskRun of nextTaskRunMap.values()) {
    merged.push(taskRun)
  }

  return merged.sort((left, right) => left.created_at - right.created_at)
}

function resolveDisplayModelIdForProvider(input: {
  rawModelId: string | null | undefined
  providerId?: string | null | undefined
  models: ModelOption[]
}) {
  const normalizedProviderId =
    typeof input.providerId === "string" ? input.providerId.trim().toLowerCase() : ""
  if (normalizedProviderId) {
    const scopedModels = input.models.filter((item) => {
      const providerId =
        typeof item.providerId === "string" ? item.providerId.trim().toLowerCase() : ""
      return providerId === normalizedProviderId
    })
    const scopedMatch = resolveDisplayModelId(input.rawModelId, scopedModels)
    if (scopedMatch) return scopedMatch
  }

  return resolveDisplayModelId(input.rawModelId, input.models)
}

function resolveProviderFallbackReasonLabel(input: {
  reason?: ChatStreamApiResponse["fallback_reason"]
  error?: string | null
  locale: "zh" | "en"
}) {
  const normalizedError = (input.error || "").toLowerCase()
  const reason = input.reason ||
    (normalizedError.includes("empty") || normalizedError.includes("no content")
      ? "empty_response"
      : normalizedError.includes("timeout") || normalizedError.includes("timed out") || normalizedError.includes("deadline")
        ? "timeout"
        : normalizedError.includes("connect") || normalizedError.includes("network") || normalizedError.includes("econn")
          ? "connection"
          : normalizedError.includes("429") || normalizedError.includes("rate limit")
            ? "rate_limit"
            : "provider_error")
  if (input.locale === "zh") {
    return {
      empty_response: "空响应",
      timeout: "Provider 连接超时",
      connection: "Provider 网络连接失败",
      rate_limit: "Provider 触发限流",
      provider_error: "Provider 请求失败",
    }[reason]
  }
  return {
    empty_response: "empty response",
    timeout: "Provider connection timeout",
    connection: "Provider network connection failed",
    rate_limit: "Provider rate limited",
    provider_error: "Provider request failed",
  }[reason]
}

function dedupeStringList(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function isQueuedBackgroundPreviewResult(input: {
  toolName: string
  result: NonNullable<NonNullable<ChatStreamApiResponse["data"]>["result"]> | null
}) {
  if (input.toolName !== "preview_ppt_deck" || !input.result) return false
  const status =
    typeof input.result.status === "string" ? input.result.status.trim() : ""
  const taskId =
    typeof input.result.backgroundTask?.taskId === "string"
      ? input.result.backgroundTask.taskId.trim()
      : ""
  return status === "queued" && Boolean(taskId)
}

function dedupeModelsById(models: ModelOption[]) {
  const seen = new Set<string>()
  return models.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function dedupeModelGroups(groups: ModelGroupOption[]) {
  const seen = new Set<string>()
  return groups
    .map((group) => {
      const models = group.models.filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      if (models.length === 0) return null
      return {
        ...group,
        models,
      } satisfies ModelGroupOption
    })
    .filter((group): group is ModelGroupOption => Boolean(group))
}

function inferProviderFamilyFromModel(model: ModelOption | null) {
  const text = [
    model?.id,
    model?.runtimeId,
    model?.canonicalId,
    ...(model?.aliases || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!text) return null
  if (text.includes("claude") || text.includes("anthropic")) return "anthropic"
  if (text.includes("gemini") || text.includes("google")) return "gemini"
  if (text.includes("minimax") || text.includes("abab")) return "minimax"
  if (
    text.includes("gpt") ||
    text.includes("openai") ||
    /\bo[1345]\b/.test(text)
  ) {
    return "openai"
  }
  return null
}

function resolvePreferredProviderForModel(input: {
  selectedModel: ModelOption | null
  selectedProviderId: string | null
  fallbackProviderId: string | null
}) {
  const explicitProviderId =
    typeof input.selectedModel?.providerId === "string" && input.selectedModel.providerId.trim()
      ? input.selectedModel.providerId.trim()
      : null
  if (explicitProviderId) return explicitProviderId
  const family = inferProviderFamilyFromModel(input.selectedModel)
  if (family === "openai") return "pptoken"
  if (family === "anthropic" || family === "gemini" || family === "minimax") {
    return "aiberm"
  }
  return input.selectedProviderId || input.fallbackProviderId || null
}

function isTextLikeFile(file: File) {
  return (
    file.type.startsWith("text/") ||
    file.type.includes("json") ||
    file.type.includes("csv") ||
    /\.(txt|md|csv|json)$/i.test(file.name)
  )
}

function isParseableDocumentFile(file: File) {
  const normalizedType = file.type.toLowerCase()
  return (
    /\.(docx|pdf)$/i.test(file.name) ||
    normalizedType === "application/pdf" ||
    normalizedType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
}

async function extractDocumentAttachment(file: File): Promise<ChatAttachment> {
  const formData = new FormData()
  formData.set("file", file)
  formData.set("surface", "ai-entry")

  const response = await fetch("/api/chat-attachments/extract", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  })
  const payload = (await response.json().catch(() => null)) as ExtractedChatAttachmentResponse | null

  if (!response.ok || !payload?.data?.text) {
    throw new Error(payload?.error || `attachment_extract_failed_${response.status}`)
  }

  return {
    id: payload.data.id || `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.data.name || file.name,
    mediaType: payload.data.mediaType || "text/plain",
    size: typeof payload.data.size === "number" ? payload.data.size : file.size,
    text: payload.data.text,
  }
}

async function uploadChatAttachmentToAssetLibrary(file: File): Promise<number> {
  const formData = new FormData()
  formData.set("file", file)
  formData.set("surface", "ai-entry")

  const response = await fetch("/api/platform/assets/upload", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  })
  const payload = (await response.json().catch(() => null)) as UploadedAssetLibraryAttachmentResponse | null
  const artifactId = payload?.data?.artifact?.id

  if (!response.ok || typeof artifactId !== "number" || artifactId <= 0) {
    throw new Error(payload?.error || `asset_library_upload_failed_${response.status}`)
  }

  return artifactId
}

function renderAttachmentError(code: string, isZh: boolean) {
  const messages: Record<string, { zh: string; en: string }> = {
    unsupported_file_type: {
      zh: "暂不支持该文件类型，请上传 DOCX、可复制文字 PDF、TXT、MD 或图片。",
      en: "This file type is not supported. Upload DOCX, copyable-text PDF, TXT, MD, or images.",
    },
    file_too_large: {
      zh: "单个附件不能超过 4MB。",
      en: "Each attachment must be 4MB or smaller.",
    },
    pdf_encrypted: {
      zh: "该 PDF 已加密，无法解析。",
      en: "This PDF is encrypted and cannot be parsed.",
    },
    pdf_no_extractable_text: {
      zh: "该 PDF 没有可提取文字。扫描版 PDF 暂不支持 OCR。",
      en: "This PDF has no extractable text. Scanned PDFs are not supported yet.",
    },
    extracted_text_empty: {
      zh: "附件中没有可读取的文字。",
      en: "No readable text was found in this attachment.",
    },
    docx_parse_failed: {
      zh: "DOCX 解析失败，请确认文件未损坏。",
      en: "DOCX parsing failed. Check that the file is not corrupted.",
    },
    asset_library_upload_failed: {
      zh: "附件写入素材库失败，请稍后重试。",
      en: "Failed to save the attachment into the asset library. Please try again.",
    },
    pdf_parse_failed: {
      zh: "PDF 解析失败，请确认文件可打开且包含可复制文字。",
      en: "PDF parsing failed. Check that the file opens and contains copyable text.",
    },
  }
  const normalizedCode = code.startsWith("asset_library_upload_failed") ? "asset_library_upload_failed" : code
  const message = messages[normalizedCode]
  if (message) return isZh ? message.zh : message.en
  return isZh ? `附件解析失败：${code}` : `Attachment parsing failed: ${code}`
}

function modelSupportsImageInput(model: ModelOption | null) {
  const normalized = [model?.id, model?.runtimeId, model?.canonicalId, ...(model?.aliases || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes("gemini") ||
    normalized.includes("claude") ||
    normalized.includes("gpt-4") ||
    normalized.includes("gpt-5") ||
    normalized.includes("o3") ||
    normalized.includes("o4") ||
    normalized.includes("vision") ||
    normalized.includes("vl") ||
    normalized.includes("pixtral")
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error || new Error("file_read_failed"))
    reader.readAsDataURL(file)
  })
}

function consumeSseBuffer<T extends object>(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ""
  const events: T[] = []

  for (const block of blocks) {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim()

    if (!payload || payload === "[DONE]") continue

    try {
      events.push(JSON.parse(payload) as T)
    } catch {
      continue
    }
  }

  return { events, rest }
}

function renderAiEntryErrorMessage(
  value: unknown,
  copy: { unknownError: string },
  isZh: boolean,
) {
  return renderAiEntryDisplayErrorMessage({
    value,
    unknownError: copy.unknownError,
    isZh,
  })
}

function isAiEntryRecoverableTransportError(value: unknown) {
  const normalized =
    value instanceof Error
      ? value.message.trim().toLowerCase()
      : typeof value === "string"
        ? value.trim().toLowerCase()
        : ""

  if (!normalized) return false

  return (
    normalized.includes("network") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("load failed") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("timeout") ||
    normalized.includes("connection") ||
    normalized.includes("stream")
  )
}

function filterAiEntryRecoverySupersededTaskEvents(events: PendingTaskEvent[]) {
  return events.filter(
    (event) =>
      event.type !== "stream_recovery" &&
      event.type !== "request_start" &&
      event.type !== "stream_error" &&
      event.type !== "request_failed",
  )
}

function buildAiEntryRecoveryEventDetail(isZh: boolean) {
  return isZh
    ? "检测到连接中断，系统正在自动同步最新会话进度。"
    : "The connection was interrupted. Syncing the latest conversation progress automatically."
}

export function AiEntryWorkspace({
  initialConversationId,
  embedded = false,
  compactEmbedded = false,
  forcedAgentId = null,
  draftSeed = "",
  embeddedPromptButtons = [],
  embeddedLinkActions = [],
  embeddedContextChips = [],
  embeddedGuideMessage = null,
  client,
  navigation,
  onConversationIdChange,
}: {
  initialConversationId: string | null
  embedded?: boolean
  compactEmbedded?: boolean
  forcedAgentId?: string | null
  draftSeed?: string
  embeddedPromptButtons?: string[]
  embeddedLinkActions?: AiEntryWorkspaceLinkAction[]
  embeddedContextChips?: string[]
  embeddedGuideMessage?: AiEntryWorkspaceGuideMessage | null
  client?: Pick<WorkbenchClient, "conversations" | "navigation">
  navigation?: NavigationAdapter
  onConversationIdChange?: (conversationId: string | null) => void
}) {
  const { locale } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceNavigation = useMemo<NavigationAdapter>(
    () => navigation ?? client?.navigation ?? {
      go: (href) => router.push(href),
      replace: (href) => router.replace(href),
      current: () => pathname,
    },
    [client, navigation, pathname, router],
  )
  const isZh = locale === "zh"
  const displayLocale = isZh ? "zh" : "en"
  const search = searchParams.toString()
  const routeAgentId = forcedAgentId || (searchParams.get("agent") || "").trim() || null
  const routeDraft = embedded ? draftSeed.trim() : (searchParams.get("draft") || "").trim()
  const routeEntryMode = (searchParams.get("entry") || "").trim()
  const isPlainChatRoute = !embedded && !forcedAgentId && !routeAgentId && !routeEntryMode

  const copy = useMemo(
    () =>
      isZh
        ? {
            title: "AI 对话",
            subtitle: "通用 AI 对话入口",
            placeholder: "输入你的问题...",
            send: "发送",
            loading: "正在生成...",
            restoring: "正在恢复会话...",
            quickStart: "快速提问",
            modelLabel: "Standard",
            reasoningLabel: "推理",
            reasoningAuto: "自动",
            modelLoading: "加载模型中...",
            modelEmpty: "无可用模型",
            agentLabel: "顾问",
            agentLoading: "加载顾问中...",
            agentEmpty: "无可用顾问",
            agentRecommended: "推荐 Agent",
            selectedAgent: "已选择顾问",
            landingHint: "你说需求，我来生成第一版方案",
            copy: "复制",
            copied: "已复制",
            copyReply: "复制回复",
            copiedReply: "已复制",
            knowledgeLabel: "知识库",
            knowledgeDisabled: "知识库未启用",
            knowledgeAllEnabled: "全部已启用知识库",
            knowledgeSelectedCount: "已选知识库",
            knowledgeAdd: "添加知识库",
            knowledgeChoose: "选择知识库",
            knowledgeLoading: "加载知识库中...",
            knowledgeEmpty: "当前没有可选知识库",
            knowledgeSearch: "搜索知识库...",
            enableKnowledge: "启用知识库",
            disableKnowledge: "关闭知识库",
            uploadFile: "上传文件",
            addMenu: "添加内容",
            unknownError: "未知错误",
            errorPrefix: "请求失败：",
          }
        : {
            title: "AI Chat",
            subtitle: "General-purpose AI chat",
            placeholder: "Ask anything...",
            send: "Send",
            loading: "Generating...",
            restoring: "Restoring conversation...",
            quickStart: "Quick tips",
            modelLabel: "Standard",
            reasoningLabel: "Reasoning",
            reasoningAuto: "Auto",
            modelLoading: "Loading models...",
            modelEmpty: "No models",
            agentLabel: "Advisor",
            agentLoading: "Loading advisors...",
            agentEmpty: "No advisors",
            agentRecommended: "Recommended Agent",
            selectedAgent: "Selected advisor",
            landingHint: "Describe it once, and I'll generate the first draft",
            copy: "Copy",
            copied: "Copied",
            copyReply: "Copy reply",
            copiedReply: "Copied",
            knowledgeLabel: "Knowledge",
            knowledgeDisabled: "Knowledge disabled",
            knowledgeAllEnabled: "All enabled knowledge bases",
            knowledgeSelectedCount: "Selected knowledge bases",
            knowledgeAdd: "Add knowledge base",
            knowledgeChoose: "Choose knowledge base",
            knowledgeLoading: "Loading knowledge bases...",
            knowledgeEmpty: "No knowledge bases available",
            knowledgeSearch: "Search knowledge bases...",
            enableKnowledge: "Enable knowledge",
            disableKnowledge: "Disable knowledge",
            uploadFile: "Upload file",
            addMenu: "Add content",
            unknownError: "Unknown error",
            errorPrefix: "Request failed: ",
          },
    [isZh],
  )

  const initialResolvedAgentId =
    resolveAiEntryRequestedAgentId({
      forcedAgentId,
      routeAgentId,
    })
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  // Browser storage is read after hydration. Reading it in the initial state
  // makes the server render an empty/loading conversation while the browser
  // renders cached messages, which causes a React hydration mismatch.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  // Only an active chat response locks this composer. PPT rendering is durable
  // and scoped to its conversation, so it must not block another conversation.
  const [isResponseLoading, setIsResponseLoading] = useState(false)
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false)
  const [isConversationLoading, setIsConversationLoading] = useState(Boolean(initialConversationId))
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [taskRuns, setTaskRuns] = useState<MessageApiTaskRun[]>([])
  const [pendingTaskEvents, setPendingTaskEvents] = useState<PendingTaskEvent[]>([])
  const [pendingTaskRefreshKey, setPendingTaskRefreshKey] = useState(0)
  const [conversationState, setConversationState] = useState<AiEntryConversationStatePayload | null>(null)
  const [browserTimeZone, setBrowserTimeZone] = useState<string | null>(null)
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false)
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [knowledgeDatasets, setKnowledgeDatasets] = useState<KnowledgeDatasetOption[]>([])
  const [knowledgeDatasetsLoading, setKnowledgeDatasetsLoading] = useState(true)
  const [selectedKnowledgeDatasetIds, setSelectedKnowledgeDatasetIds] = useState<number[]>([])

  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelProviderId, setModelProviderId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>("auto")
  const [reasoningHydrated, setReasoningHydrated] = useState(false)
  const [restoredConversationModelId, setRestoredConversationModelId] = useState<string | null>(null)

  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialResolvedAgentId)
  const [isAgentSelectionExplicit, setIsAgentSelectionExplicit] = useState(Boolean(initialResolvedAgentId))
  const [agentQueryReady, setAgentQueryReady] = useState(false)
  const [sessionReady, setSessionReady] = useState(!initialResolvedAgentId?.startsWith("business-"))
  const [sessionReadyError, setSessionReadyError] = useState<string | null>(null)

  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(0)
  const messagesLengthRef = useRef(messages.length)
  const taskRunsRef = useRef(taskRuns)
  const latestConversationIdRef = useRef<string | null>(initialConversationId)
  const isLoadingRef = useRef(false)
  const activeRequestAbortControllerRef = useRef<AbortController | null>(null)
  const isStreamRecoveryInFlightRef = useRef(false)
  const appliedRestoredConversationModelIdRef = useRef<string | null>(null)
  const prewarmedConversationIdRef = useRef<string | null>(initialConversationId)
  const prewarmedRuntimeKeyRef = useRef<string | null>(null)
  const onConversationIdChangeRef = useRef<typeof onConversationIdChange>(onConversationIdChange)
  const pendingFirstConversationRouteRef = useRef(false)
  const isPptAssistantRoute = isAiEntryPptAgentId(routeAgentId)
  const resolvedRequestAgentId = resolveAiEntryRequestedAgentId({
    forcedAgentId,
    selectedAgentId: isPlainChatRoute ? null : selectedAgentId,
    routeAgentId,
  })
  const quickPrompts = useMemo(
    () =>
      getAiEntryQuickPrompts({
        agentId: resolvedRequestAgentId,
        locale: isZh ? "zh" : "en",
      }),
    [isZh, resolvedRequestAgentId],
  )
  const isConsultingEntry = useMemo(
    () => isConsultingAdvisorEntryMode(routeEntryMode) && !isPptAssistantRoute,
    [isPptAssistantRoute, routeEntryMode],
  )
  const effectiveEntryMode = isConsultingEntry ? AI_ENTRY_CONSULTING_ENTRY_MODE : null
  const shouldLockModel = useMemo(
    () =>
      shouldLockConsultingAdvisorModel({
        entryMode: effectiveEntryMode,
        agentId: routeAgentId,
      }),
    [effectiveEntryMode, routeAgentId],
  )
  const shouldPreferAgentDefaultModel = useMemo(
    () => isConsultingEntry || Boolean(forcedAgentId || routeAgentId || selectedAgentId),
    [forcedAgentId, isConsultingEntry, routeAgentId, selectedAgentId],
  )
  const workspaceTitle = resolveAiEntryWorkspaceTitle({
    agentId: resolvedRequestAgentId,
    locale: isZh ? "zh" : "en",
    isConsultingEntry,
    defaultTitle: copy.title,
  })
  const workspaceSubtitle = resolveAiEntryWorkspaceSubtitle({
    agentId: resolvedRequestAgentId,
    locale: isZh ? "zh" : "en",
    isConsultingEntry,
    defaultSubtitle: copy.subtitle,
  })
  const workspaceKicker = resolveAiEntryWorkspaceKicker({
    agentId: resolvedRequestAgentId,
    locale: isZh ? "zh" : "en",
    defaultKicker: "AI Workspace",
  })
  const activePendingAgentId = routeAgentId || resolvedRequestAgentId || forcedAgentId || null
  const showConversationRestoreState = shouldShowAiEntryConversationRestore({
    isConversationLoading,
    messages,
  })
  const lockedConsultingModelId = useMemo(
    () =>
      pickConsultingModelId(models) ||
      AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT,
    [models],
  )
  const preferredUnlockedModelId = useMemo(() => {
    if (models.length === 0) return null
    if (isPptAssistantRoute) {
      return pickPptAssistantDefaultModelId(models) || models[0]?.id || null
    }
    if (shouldPreferAgentDefaultModel) {
      return pickAgentDefaultModelId(models) || models[0]?.id || null
    }
    return models[0]?.id || null
  }, [isPptAssistantRoute, models, shouldPreferAgentDefaultModel])
  const hasMessagePptPreviewContext = useMemo(
    () =>
      messages.some((message) =>
        message.role === "assistant" && Boolean(extractLatestPptPreviewContext(message.content)),
      ),
    [messages],
  )
  const displayMessages = useMemo(() => {
    if (
      shouldDeferSyntheticTaskRunMessages({
        isConversationLoading,
        messageCount: messages.length,
      })
    ) {
      return messages
    }

    return attachTaskRunsToMessages(messages, taskRuns, buildConversationArtifactParts(conversationState?.artifacts))
  }, [conversationState?.artifacts, isConversationLoading, messages, taskRuns])
  const fetchConversationMessages = useCallback(
    async (targetConversationId: string) => {
      if (client) {
        const portableMessages = await client.conversations.messages(targetConversationId)
        return {
          response: { ok: true, status: 200 },
          payload: null,
          messages: portableMessages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message): ChatMessage => {
              const role: ChatMessage["role"] = message.role === "assistant" ? "assistant" : "user"
              return {
                id: message.id,
                role,
                content: desktopUIMessageText(message),
                createdAt: Date.parse(message.metadata?.createdAt ?? "") || Date.now(),
              }
            }),
          taskRuns: [],
          pendingTask: null,
          conversationState: null,
        }
      }
      const params = new URLSearchParams({ conversation_id: targetConversationId, limit: "200" })
      if (effectiveEntryMode) params.set("entryMode", effectiveEntryMode)
      if (routeAgentId) params.set("agent", routeAgentId)

      const response = await fetch(`/api/ai/messages?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      const payload = (await response.json().catch(() => null)) as MessageApiResponse | null

      return {
        response,
        payload,
        messages: mapPersistedAiEntryMessages(payload),
        taskRuns: mapAiEntryTaskRuns(payload),
        pendingTask: mapPendingAiEntryTask(payload),
        conversationState: payload?.conversation_state ?? null,
      }
    },
    [client, effectiveEntryMode, routeAgentId],
  )
  const resetWorkspaceForNewConversation = useCallback(() => {
    activeRequestAbortControllerRef.current?.abort()
    activeRequestAbortControllerRef.current = null
    pendingFirstConversationRouteRef.current = false
    latestConversationIdRef.current = null
    isLoadingRef.current = false
    isStreamRecoveryInFlightRef.current = false
    setConversationId(null)
    setMessages([])
    setTaskRuns([])
    setPendingTaskEvents([])
    setConversationState(null)
    setErrorMessage(null)
    setInput("")
    setAttachments([])
    setCopiedMessageId(null)
    setIsResponseLoading(false)
    setIsConversationLoading(false)
    setIsPreparingAttachments(false)
  }, [])
  const showLanding =
    !embedded &&
    !initialConversationId &&
    !conversationId &&
    !isConversationLoading &&
    messages.length === 0 &&
    !isConsultingEntry
  const selectedModel = useMemo(
    () => models.find((item) => item.id === selectedModelId) || null,
    [models, selectedModelId],
  )
  const reasoningCapabilities = useMemo(
    () => getReasoningCapabilities({
      providerId: selectedModel?.providerId || modelProviderId,
      modelId: selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId,
    }),
    [modelProviderId, selectedModel, selectedModelId],
  )
  const resolvedReasoningEffort = useMemo(
    () => normalizeReasoningEffort(selectedReasoningEffort, {
      providerId: selectedModel?.providerId || modelProviderId,
      modelId: selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId,
    }),
    [modelProviderId, selectedModel, selectedModelId, selectedReasoningEffort],
  )
  const hasStreamRecoveryPending = useMemo(
    () => pendingTaskEvents.some((event) => event.type === "stream_recovery"),
    [pendingTaskEvents],
  )
  const composerPromptButtons = useMemo(() => {
    if (embedded && compactEmbedded) {
      return embeddedPromptButtons.filter((item) => item.trim()).slice(0, 4)
    }
    return quickPrompts
  }, [compactEmbedded, embedded, embeddedPromptButtons, quickPrompts])
  const composerLinkActions = useMemo(
    () => (embedded && compactEmbedded ? embeddedLinkActions.slice(0, 6) : []),
    [compactEmbedded, embedded, embeddedLinkActions],
  )
  const composerContextChips = useMemo(
    () => (embedded && compactEmbedded ? embeddedContextChips.filter((item) => item.trim()).slice(0, 6) : []),
    [compactEmbedded, embedded, embeddedContextChips],
  )
  const shouldShowEmbeddedGuide =
    embedded &&
    compactEmbedded &&
    !isConversationLoading &&
    messages.length === 0 &&
    Boolean(embeddedGuideMessage?.title || embeddedGuideMessage?.body)
  const embeddedGuideContent = useMemo(() => {
    if (!shouldShowEmbeddedGuide || !embeddedGuideMessage) return ""

    const lines: string[] = []
    if (embeddedGuideMessage.title.trim()) {
      lines.push(`**${embeddedGuideMessage.title.trim()}**`)
    }
    if (embeddedGuideMessage.body.trim()) {
      lines.push(embeddedGuideMessage.body.trim())
    }

    const prompts = (embeddedGuideMessage.prompts || [])
      .map((prompt) => prompt.trim())
      .filter(Boolean)
      .slice(0, 2)

    if (prompts.length > 0) {
      lines.push(embeddedGuideMessage.promptLabel?.trim() || (isZh ? "你可以这样开始：" : "You can start with:"))
      lines.push(...prompts.map((prompt) => `- ${prompt}`))
    }

    return lines.join("\n\n")
  }, [embeddedGuideMessage, isZh, shouldShowEmbeddedGuide])

  useEffect(() => {
    const syncBrowserTimeZone = () => {
      setBrowserTimeZone(resolveBrowserTimeZone())
    }

    syncBrowserTimeZone()
    window.addEventListener("focus", syncBrowserTimeZone)
    window.addEventListener("pageshow", syncBrowserTimeZone)
    document.addEventListener("visibilitychange", syncBrowserTimeZone)

    return () => {
      window.removeEventListener("focus", syncBrowserTimeZone)
      window.removeEventListener("pageshow", syncBrowserTimeZone)
      document.removeEventListener("visibilitychange", syncBrowserTimeZone)
    }
  }, [])

  useEffect(() => {
    messagesLengthRef.current = messages.length
  }, [messages.length])

  useEffect(() => {
    taskRunsRef.current = taskRuns
  }, [taskRuns])

  useEffect(() => {
    latestConversationIdRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    isLoadingRef.current = isResponseLoading
  }, [isResponseLoading])

  useEffect(() => {
    onConversationIdChangeRef.current = onConversationIdChange
  }, [onConversationIdChange])

  useEffect(() => {
    onConversationIdChangeRef.current?.(conversationId)
  }, [conversationId])

  useEffect(() => {
    const previousCount = previousMessageCountRef.current
    previousMessageCountRef.current = messages.length
    if (messages.length <= previousCount) return

    scrollAnchorRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
  }, [messages.length])

  useEffect(() => {
    if (embedded) return
    if (!isPptAssistantRoute || !isConsultingAdvisorEntryMode(routeEntryMode)) return
    const params = new URLSearchParams(search)
    params.delete("entry")
    const nextSearch = params.toString()
    workspaceNavigation.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname)
  }, [embedded, isPptAssistantRoute, pathname, routeEntryMode, search, workspaceNavigation])

  useEffect(() => {
    if (shouldLockModel || modelsLoading || models.length === 0 || !selectedModelId) return
    if (typeof window === "undefined") return
    persistSelectedModelId(selectedModelId)
  }, [models.length, modelsLoading, selectedModelId, shouldLockModel])

  useEffect(() => {
    if (modelsLoading) return
    setSelectedReasoningEffort((current) => {
      const candidate = current === "auto" ? readPersistedReasoningEffort() : current
      return normalizeReasoningEffort(candidate, {
        providerId: selectedModel?.providerId || modelProviderId,
        modelId: selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId,
      })
    })
    setReasoningHydrated(true)
  }, [modelProviderId, modelsLoading, selectedModel, selectedModelId])

  useEffect(() => {
    if (shouldLockModel || modelsLoading || !reasoningHydrated) return
    persistReasoningEffort(resolvedReasoningEffort)
  }, [modelsLoading, reasoningHydrated, resolvedReasoningEffort, shouldLockModel])

  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  )
  const resolvedRequestAgentName = useMemo(
    () =>
      selectedAgent?.name ||
      resolveAiEntryAgentName(resolvedRequestAgentId, isZh ? "zh" : "en"),
    [isZh, resolvedRequestAgentId, selectedAgent?.name],
  )
  const workspacePlaceholder = useMemo(
    () =>
      resolveAiEntryWorkspacePlaceholder({
        agentId: resolvedRequestAgentId,
        agentName: resolvedRequestAgentName,
        locale: isZh ? "zh" : "en",
        defaultPlaceholder: copy.placeholder,
      }),
    [copy.placeholder, isZh, resolvedRequestAgentId, resolvedRequestAgentName],
  )
  const selectedKnowledgeDatasets = useMemo(
    () =>
      selectedKnowledgeDatasetIds
        .map((datasetId) => knowledgeDatasets.find((item) => item.id === datasetId) || null)
        .filter((item): item is KnowledgeDatasetOption => Boolean(item)),
    [knowledgeDatasets, selectedKnowledgeDatasetIds],
  )
  const knowledgeSummaryLabel = useMemo(() => {
    if (!knowledgeEnabled) return copy.knowledgeDisabled
    if (selectedKnowledgeDatasets.length === 0) return copy.knowledgeAllEnabled
    return `${copy.knowledgeSelectedCount} ${selectedKnowledgeDatasets.length}`
  }, [copy.knowledgeAllEnabled, copy.knowledgeDisabled, copy.knowledgeSelectedCount, knowledgeEnabled, selectedKnowledgeDatasets.length])
  useEffect(() => {
    let cancelled = false

    async function loadKnowledgeDatasets() {
      setKnowledgeDatasetsLoading(true)
      try {
        const response = await fetch("/api/knowledge/datasets", {
          credentials: "same-origin",
        })
        const payload = (await response.json().catch(() => null)) as KnowledgeDatasetsApiResponse | null
        if (!response.ok) {
          throw new Error(payload?.error || "knowledge_datasets_failed")
        }

        const nextDatasets = (payload?.data?.items || [])
          .map((item) => {
            if (!item || typeof item.id !== "number" || !item.name || !item.category) return null
            return {
              id: item.id,
              name: item.name,
              category: item.category,
            } satisfies KnowledgeDatasetOption
          })
          .filter((item): item is KnowledgeDatasetOption => Boolean(item))

        if (cancelled) return
        setKnowledgeDatasets(nextDatasets)
        setSelectedKnowledgeDatasetIds((current) => current.filter((datasetId) => nextDatasets.some((item) => item.id === datasetId)))
      } catch {
        if (cancelled) return
        setKnowledgeDatasets([])
      } finally {
        if (!cancelled) {
          setKnowledgeDatasetsLoading(false)
        }
      }
    }

    void loadKnowledgeDatasets()

    return () => {
      cancelled = true
    }
  }, [])

  const toggleKnowledgeDataset = useCallback((datasetId: number) => {
    setKnowledgeEnabled(true)
    setSelectedKnowledgeDatasetIds((current) =>
      current.includes(datasetId)
        ? current.filter((item) => item !== datasetId)
        : [...current, datasetId],
    )
  }, [])

  const disableKnowledge = useCallback(() => {
    setKnowledgeEnabled(false)
    setKnowledgePickerOpen(false)
    setSelectedKnowledgeDatasetIds([])
  }, [])

  const loadingEventSummary = useMemo(() => {
    const totalCount = pendingTaskEvents.length
    const completedCount = pendingTaskEvents.filter((item) => item.status === "completed").length
    const currentLabel = pendingTaskEvents.at(-1)?.label || copy.loading
    const progressPercent =
      totalCount > 0
        ? Math.round((completedCount / totalCount) * 100)
        : 0

    return {
      totalCount,
      completedCount,
      currentLabel,
      progressPercent: Math.min(100, Math.max(0, progressPercent)),
    }
  }, [copy.loading, pendingTaskEvents])

  useEffect(() => {
    if (embedded) return
    const targetConversationId = resolveAiEntryTargetConversationId({
      initialConversationId,
      localConversationId: conversationId,
      pendingFirstConversationRoute: pendingFirstConversationRouteRef.current,
    })
    const targetPath = targetConversationId ? `/dashboard/ai/${targetConversationId}` : "/dashboard/ai"
    const params = new URLSearchParams(search)
    if (targetConversationId) {
      params.delete("draft")
    }
    const nextSearch = params.toString()
    if (pathname !== targetPath || nextSearch !== search) {
      workspaceNavigation.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath)
    }
  }, [conversationId, embedded, initialConversationId, pathname, search, workspaceNavigation])

  useEffect(() => {
    if (embedded) return
    if (!agentQueryReady) return
    const fromRoute = (searchParams.get("agent") || "").trim() || null
    setSelectedAgentId((current) => (current === fromRoute ? current : fromRoute))
    setIsAgentSelectionExplicit(Boolean(fromRoute))
  }, [agentQueryReady, embedded, searchParams])

  useEffect(() => {
    if (!embedded) return
    setSelectedAgentId(forcedAgentId)
    setIsAgentSelectionExplicit(Boolean(forcedAgentId))
  }, [embedded, forcedAgentId])

  useEffect(() => {
    const requiresPersistentSession = Boolean(selectedAgentId?.startsWith("business-"))
    setSessionReady(!requiresPersistentSession)
    setSessionReadyError(null)
  }, [selectedAgentId])

  useEffect(() => {
    if (initialConversationId) return
    if (messages.length > 0) return
    const nextDraft = routeDraft
    if (!nextDraft) return
    setInput((current) => (current.trim() ? current : nextDraft))
  }, [initialConversationId, messages.length, routeDraft])

  useEffect(() => {
    if (embedded) return
    if (!agentQueryReady) return
    if (!isAgentSelectionExplicit) return
    if (
      pendingFirstConversationRouteRef.current &&
      latestConversationIdRef.current &&
      pathname === "/dashboard/ai"
    ) {
      return
    }
    const params = new URLSearchParams(search)
    if (selectedAgentId) {
      params.set("agent", selectedAgentId)
    } else {
      params.delete("agent")
    }
    const nextSearch = params.toString()
    if (nextSearch !== search) workspaceNavigation.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname)
  }, [
    agentQueryReady,
    embedded,
    isAgentSelectionExplicit,
    pathname,
    search,
    selectedAgentId,
    shouldLockModel,
    workspaceNavigation,
  ])

  useEffect(() => {
    let cancelled = false
    const loadModels = async () => {
      setModelsLoading(true)
      try {
        const response = await fetch("/api/ai/models", { cache: "no-store", credentials: "same-origin" })
        const payload = (await response.json().catch(() => null)) as ModelApiResponse | null
        if (cancelled) return
        if (!response.ok) throw new Error(`http_${response.status}`)

        const normalizeModel = (
          item: {
            id?: string
            name?: string
            modelId?: string
            providerId?: string
            providerLabel?: string
            runtimeId?: string
            canonicalId?: string
            aliases?: string[]
          } | null | undefined,
        ) => {
          const id = typeof item?.id === "string" ? item.id.trim() : ""
          if (!id) return null
          const runtimeId =
            typeof item?.runtimeId === "string" && item.runtimeId.trim()
              ? item.runtimeId.trim()
              : undefined
          const canonicalId =
            typeof item?.canonicalId === "string" && item.canonicalId.trim()
              ? item.canonicalId.trim()
              : undefined
          const modelId =
            typeof item?.modelId === "string" && item.modelId.trim()
              ? item.modelId.trim()
              : runtimeId || canonicalId || id
          const providerId =
            typeof item?.providerId === "string" && item.providerId.trim()
              ? item.providerId.trim()
              : undefined
          const providerLabel =
            typeof item?.providerLabel === "string" && item.providerLabel.trim()
              ? item.providerLabel.trim()
              : undefined
          const normalizedAliases = dedupeStringList([
            ...(Array.isArray(item?.aliases) ? item.aliases : []),
            id,
            modelId,
            runtimeId,
            canonicalId,
          ])
          return {
            id,
            name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : id,
            modelId,
            providerId,
            providerLabel,
            runtimeId,
            canonicalId,
            aliases: normalizedAliases,
          } as ModelOption
        }

        const normalizedGroups = (payload?.modelGroups || [])
          .map((group) => {
            const family = typeof group.family === "string" && group.family.trim() ? group.family.trim() : "other"
            const label = typeof group.label === "string" && group.label.trim() ? group.label.trim() : family
            const groupModels = dedupeModelsById(
              (group.models || []).map(normalizeModel).filter((item): item is ModelOption => Boolean(item)),
            )
            if (groupModels.length === 0) return null
            return { family, label, models: groupModels } as ModelGroupOption
          })
          .filter((item): item is ModelGroupOption => Boolean(item))
        const dedupedModelGroups = dedupeModelGroups(normalizedGroups)

        const normalizedModels = dedupeModelsById(
          dedupedModelGroups.length > 0
            ? dedupedModelGroups.flatMap((group) => group.models)
            : (payload?.models || []).map(normalizeModel).filter((item): item is ModelOption => Boolean(item)),
        )

        const selectedProviderId =
          typeof payload?.selectedProviderId === "string" && payload.selectedProviderId.trim()
            ? payload.selectedProviderId.trim()
            : typeof payload?.providerId === "string" && payload.providerId.trim()
              ? payload.providerId.trim()
              : null
        setModelProviderId(selectedProviderId)
        setModels(normalizedModels)
        const preferredFromCatalog =
          typeof payload?.selectedModelId === "string" ? payload.selectedModelId : null
        const catalogDefaultModelId = preferredFromCatalog
          ? resolveDisplayModelId(preferredFromCatalog, normalizedModels)
          : null
        const preferredFromStorage =
          shouldLockModel || isPptAssistantRoute ? null : readPersistedSelectedModelId()
        const consultingModelFallback =
          pickConsultingModelId(normalizedModels) ||
          AI_ENTRY_CONSULTING_QUALITY_MODEL_HINT
        const pptAssistantDefaultModelId = isPptAssistantRoute
          ? (
              (SHOULD_PREFER_CATALOG_MODEL_DEFAULT ? catalogDefaultModelId : null) ||
              pickPptAssistantDefaultModelId(normalizedModels) ||
              catalogDefaultModelId
            )
          : null
        setSelectedModelId((current) => {
          if (shouldLockModel) {
            return consultingModelFallback
          }

          const normalizedCurrent =
            typeof current === "string" && current.trim() ? current.trim() : null
          const resolvedCurrent = normalizedCurrent
            ? resolveDisplayModelId(normalizedCurrent, normalizedModels)
            : null
          const agentDefaultModelId = shouldPreferAgentDefaultModel
            ? pickAgentDefaultModelId(normalizedModels) || catalogDefaultModelId
            : null
          const resolvedPptModel = resolvePptAssistantModelSelection({
            currentModelId: resolvedCurrent,
            availableModelIds: normalizedModels.map((item) => item.id),
            defaultModelId: pptAssistantDefaultModelId,
          })
          if (resolvedPptModel) return resolvedPptModel

          if (agentDefaultModelId) return agentDefaultModelId

          if (preferredFromStorage) {
            const resolvedPreferredFromStorage = resolveDisplayModelId(
              preferredFromStorage,
              normalizedModels,
            )
            if (resolvedPreferredFromStorage) return resolvedPreferredFromStorage
          }

          if (SHOULD_PREFER_CATALOG_MODEL_DEFAULT && catalogDefaultModelId) {
            return catalogDefaultModelId
          }

          if (catalogDefaultModelId) {
            return catalogDefaultModelId
          }

          return normalizedModels[0]?.id || null
        })
      } catch (error) {
        if (cancelled) return
        console.error("ai-entry.models.load.failed", error)
        setModelProviderId(null)
        setModels([])
        setSelectedModelId(null)
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [isPptAssistantRoute, isZh, shouldLockModel, shouldPreferAgentDefaultModel])

  useEffect(() => {
    if (shouldLockModel) return

    if (!restoredConversationModelId) {
      appliedRestoredConversationModelIdRef.current = null
      return
    }

    if (
      models.length === 0 ||
      appliedRestoredConversationModelIdRef.current === restoredConversationModelId
    ) {
      return
    }

    const resolvedModelId = resolveDisplayModelId(restoredConversationModelId, models)
    if (!resolvedModelId) return

    appliedRestoredConversationModelIdRef.current = restoredConversationModelId
    setSelectedModelId(resolvedModelId)
  }, [models, restoredConversationModelId, shouldLockModel])

  useEffect(() => {
    let cancelled = false
    const loadAgents = async () => {
      try {
        const response = await fetch("/api/ai/agents", { cache: "no-store", credentials: "same-origin" })
        const payload = (await response.json().catch(() => null)) as AgentApiResponse | null
        if (cancelled) return
        if (!response.ok) throw new Error(`http_${response.status}`)

        const normalizedAgents = (payload?.agents || [])
          .map((item) => {
            const id = typeof item?.id === "string" ? item.id.trim() : ""
            if (!id) return null
            const category = typeof item?.category === "string" && item.category.trim() ? item.category.trim() : "general"
            const name = (isZh ? item?.name?.zh : item?.name?.en) || item?.name?.en || item?.name?.zh || id
            const description = (isZh ? item?.description?.zh : item?.description?.en) || item?.description?.en || item?.description?.zh || ""
            return { id, category, name: String(name), description: String(description) } as AgentOption
          })
          .filter((item): item is AgentOption => Boolean(item))

        const validIds = new Set(normalizedAgents.map((item) => item.id))
        const fromForcedAgent =
          forcedAgentId && validIds.has(forcedAgentId) ? forcedAgentId : null
        const fromQuery =
          !embedded && routeAgentId && validIds.has(routeAgentId)
            ? routeAgentId
            : null
        const nextSelectedAgentId = fromForcedAgent || fromQuery

        setAgents(normalizedAgents)
        setSelectedAgentId(nextSelectedAgentId)
        setIsAgentSelectionExplicit(Boolean(nextSelectedAgentId))
      } catch (error) {
        if (cancelled) return
        console.error("ai-entry.agents.load.failed", error)
        setAgents([])
        setSelectedAgentId(null)
        setIsAgentSelectionExplicit(false)
      } finally {
        if (!cancelled) {
          setAgentQueryReady(true)
        }
      }
    }

    void loadAgents()
    return () => {
      cancelled = true
    }
  }, [embedded, forcedAgentId, isZh, routeAgentId, shouldLockModel])

  useEffect(() => {
    const prewarmAgentId = selectedAgentId?.startsWith("business-") || selectedAgentId === "executive-ppt"
      ? selectedAgentId
      : null
    const prewarmProviderId = resolvePreferredProviderForModel({
      selectedModel,
      selectedProviderId: modelProviderId,
      fallbackProviderId: modelProviderId,
    }) || ""
    const prewarmModelId = selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId || ""
    if (!prewarmAgentId || modelsLoading || !prewarmModelId) return
    setSessionReady(false)
    setSessionReadyError(null)

    // A new-chat reset must not reuse the previous conversation's warm-session
    // marker. The next request will create a fresh conversation and session.
    if (!conversationId && prewarmedConversationIdRef.current) {
      prewarmedConversationIdRef.current = null
      prewarmedRuntimeKeyRef.current = null
    }
    const runtimeKey = `${prewarmAgentId}|${prewarmProviderId}|${prewarmModelId}`
    if (prewarmedRuntimeKeyRef.current === runtimeKey) return
    prewarmedRuntimeKeyRef.current = runtimeKey
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), AI_ENTRY_AGENT_PREWARM_TIMEOUT_MS)
    void fetch("/api/ai/shared-agent-prewarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({
        agentId: prewarmAgentId,
        conversationId: conversationId || prewarmedConversationIdRef.current,
        conversationScope: isConsultingEntry ? "consulting" : "chat",
        providerId: prewarmProviderId || undefined,
        modelId: prewarmModelId,
      }),
    })
      .then(async (response) => {
        if (!response.ok || controller.signal.aborted) {
          if (!controller.signal.aborted) {
            setSessionReadyError(isZh ? "会话预热失败，将直接尝试发送。" : "Session prewarm failed; sending will try the direct runtime.")
          }
          if (prewarmedRuntimeKeyRef.current === runtimeKey) prewarmedRuntimeKeyRef.current = null
          return
        }
        const payload = await response.json().catch(() => null) as { prewarmed?: unknown; session_ready?: unknown; conversationId?: unknown } | null
        if (payload?.prewarmed !== true || payload?.session_ready !== true) {
          setSessionReadyError(isZh ? "会话预热失败，请稍后重试。" : "Session prewarm failed. Try again shortly.")
          if (prewarmedRuntimeKeyRef.current === runtimeKey) prewarmedRuntimeKeyRef.current = null
          return
        }
        setSessionReady(true)
        const preparedConversationId = typeof payload?.conversationId === "string" ? payload.conversationId.trim() : ""
        if (!preparedConversationId || isLoadingRef.current || latestConversationIdRef.current) return
        prewarmedConversationIdRef.current = preparedConversationId
        latestConversationIdRef.current = preparedConversationId
        setConversationId(preparedConversationId)
      })
      .catch(() => {
        setSessionReadyError(isZh ? "无法连接持久会话运行时。" : "Unable to connect to the persistent session runtime.")
        if (prewarmedRuntimeKeyRef.current === runtimeKey) prewarmedRuntimeKeyRef.current = null
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })
    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [conversationId, isConsultingEntry, isZh, modelProviderId, modelsLoading, selectedAgentId, selectedModel, selectedModelId])

  useEffect(() => {
    if (shouldLockModel) {
      if (selectedModelId !== lockedConsultingModelId) {
        setSelectedModelId(lockedConsultingModelId)
      }
      return
    }

    if (models.length === 0) {
      if (selectedModelId !== null) setSelectedModelId(null)
      return
    }

    if (!selectedModelId || !models.some((item) => item.id === selectedModelId)) {
      setSelectedModelId(preferredUnlockedModelId)
    }
  }, [lockedConsultingModelId, models, preferredUnlockedModelId, selectedModelId, shouldLockModel])

  useEffect(() => {
    setErrorMessage(null)

    if (!initialConversationId) {
      if (pendingFirstConversationRouteRef.current) {
        setIsConversationLoading(false)
        return
      }
      activeRequestAbortControllerRef.current?.abort()
      activeRequestAbortControllerRef.current = null
      pendingFirstConversationRouteRef.current = false
      isLoadingRef.current = false
      setIsResponseLoading(false)
      setConversationId(null)
      setRestoredConversationModelId(null)
      latestConversationIdRef.current = null
      setMessages([])
      setTaskRuns([])
      setConversationState(null)
      setIsConversationLoading(false)
      return
    }

    if (
      isLoadingRef.current ||
      shouldReuseLoadedConversation({
        targetConversationId: initialConversationId,
        latestConversationId: latestConversationIdRef.current,
        hasMessages: messagesLengthRef.current > 0,
        pendingFirstConversationRoute: pendingFirstConversationRouteRef.current,
      })
    ) {
      setConversationId(initialConversationId)
      latestConversationIdRef.current = initialConversationId
      setIsConversationLoading(false)
      return
    }

    pendingFirstConversationRouteRef.current = false
    setConversationId(initialConversationId)
    setRestoredConversationModelId(null)
    latestConversationIdRef.current = initialConversationId
    let cancelled = false
    const pendingMessages = readPendingConversationMessages(initialConversationId)
    setMessages(resolveAiEntryBootstrapMessages({
      conversationId: initialConversationId,
      pendingMessages,
    }))
    const loadMessages = async () => {
      setIsConversationLoading(true)
      try {
        const {
          response,
          payload,
          messages: restored,
          taskRuns: restoredTaskRuns,
          pendingTask,
          conversationState: restoredConversationState,
        } = await fetchConversationMessages(initialConversationId)
        if (cancelled) return
        if (!response.ok) {
          const apiError =
            payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
              ? payload.error.trim()
              : ""
          if (response.status === 404 && apiError === "conversation_not_found") {
            clearPendingConversationMessages(initialConversationId)
            setConversationId(null)
            latestConversationIdRef.current = null
            setMessages([])
            setTaskRuns([])
            setConversationState(null)
            setErrorMessage(null)
            return
          }
          throw new Error(`http_${response.status}`)
        }

        const resolvedMessages = resolveAiEntryRestoredMessages({
          pendingMessages,
          persistedMessages: restored,
        })

        setMessages(resolvedMessages)
        setTaskRuns(restoredTaskRuns)
        setConversationState(restoredConversationState)
        savePendingConversationMessages(initialConversationId, resolvedMessages)

        saveAiEntryPendingTasks(restoredTaskRuns, {
          conversationId: initialConversationId,
          agentId: routeAgentId || resolvedRequestAgentId || null,
        })
        if (pendingTask || restoredTaskRuns.some((taskRun) => taskRun.status === "pending" || taskRun.status === "running")) {
          setPendingTaskRefreshKey((current) => current + 1)
        }

        const conversationModelId =
          typeof payload?.conversation?.current_model_id === "string" &&
          payload.conversation.current_model_id.trim()
            ? payload.conversation.current_model_id.trim()
            : null
        const pendingConversationSelection = readPendingConversationSelection(initialConversationId)

        setRestoredConversationModelId(pendingConversationSelection?.modelId || conversationModelId)
        if (pendingConversationSelection) {
          setSelectedReasoningEffort(pendingConversationSelection.reasoningEffort)
        }
      } catch (error) {
        if (cancelled) return
        setMessages((current) => (current.length > 0 ? current : []))
        setErrorMessage(
          `${copy.errorPrefix}${renderAiEntryErrorMessage(
            error instanceof Error ? error.message : error,
            copy,
            isZh,
          )}`,
        )
      } finally {
        if (!cancelled) setIsConversationLoading(false)
      }
    }

    void loadMessages()
    return () => {
      cancelled = true
    }
  }, [copy, fetchConversationMessages, initialConversationId, isPptAssistantRoute, isZh, resolvedRequestAgentId, routeAgentId])

  const syncSharedConversationDraft = useCallback(() => {
    if (!conversationId) return
    const pendingMessages = readPendingConversationMessages(conversationId)
    if (pendingMessages.length === 0) return

    setMessages((current) =>
      resolveAiEntrySharedPendingMessages({
        currentMessages: current,
        sharedPendingMessages: pendingMessages,
      }),
    )
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || typeof window === "undefined") return

    const refreshFromSharedState = () => {
      syncSharedConversationDraft()
      setPendingTaskRefreshKey((current) => current + 1)
    }

    const handleStorage = (event: StorageEvent) => {
      if (isSharedPendingConversationStorageKey(event.key, conversationId)) {
        syncSharedConversationDraft()
        return
      }

      if (isPendingAssistantTaskStoreStorageKey(event.key)) {
        setPendingTaskRefreshKey((current) => current + 1)
      }
    }

    const handleSharedPendingConversationUpdate = (
      event: Event,
    ) => {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === "object"
          ? (event.detail as { conversationId?: unknown })
          : null
      const targetConversationId =
        typeof detail?.conversationId === "string" && detail.conversationId.trim()
          ? detail.conversationId.trim()
          : null
      if (targetConversationId !== conversationId) return
      refreshFromSharedState()
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshFromSharedState()
      }
    }

    refreshFromSharedState()
    window.addEventListener("storage", handleStorage)
    window.addEventListener(
      AI_ENTRY_SHARED_PENDING_CONVERSATION_EVENT,
      handleSharedPendingConversationUpdate,
    )
    window.addEventListener("focus", refreshFromSharedState)
    window.addEventListener("pageshow", refreshFromSharedState)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener(
        AI_ENTRY_SHARED_PENDING_CONVERSATION_EVENT,
        handleSharedPendingConversationUpdate,
      )
      window.removeEventListener("focus", refreshFromSharedState)
      window.removeEventListener("pageshow", refreshFromSharedState)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [conversationId, syncSharedConversationDraft])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleNewConversation = (event: Event) => {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === "object"
          ? (event.detail as AiEntryNewConversationDetail)
          : null
      const targetAgentId =
        typeof detail?.agentId === "string" && detail.agentId.trim()
          ? detail.agentId.trim()
          : null
      const targetEntryMode =
        typeof detail?.entryMode === "string" && detail.entryMode.trim()
          ? detail.entryMode.trim()
          : null
      const activeAgentId = routeAgentId || resolvedRequestAgentId || null

      if (targetAgentId !== activeAgentId) return
      if (targetEntryMode !== effectiveEntryMode) return

      resetWorkspaceForNewConversation()
    }

    window.addEventListener(AI_ENTRY_NEW_CONVERSATION_EVENT, handleNewConversation)
    return () => window.removeEventListener(AI_ENTRY_NEW_CONVERSATION_EVENT, handleNewConversation)
  }, [effectiveEntryMode, resetWorkspaceForNewConversation, resolvedRequestAgentId, routeAgentId])

  const attemptConversationRecovery = useCallback(async () => {
    const targetConversationId = latestConversationIdRef.current || conversationId
    if (!targetConversationId || isStreamRecoveryInFlightRef.current) return false
    if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return false

    isStreamRecoveryInFlightRef.current = true

    try {
      const {
        response,
        messages: persistedMessages,
        taskRuns: refreshedTaskRuns,
        pendingTask,
        conversationState: refreshedConversationState,
      } = await fetchConversationMessages(targetConversationId)

      if (!response.ok) {
        throw new Error(`http_${response.status}`)
      }

      setConversationState(refreshedConversationState)
      setTaskRuns(refreshedTaskRuns)
      setMessages((current) => {
        const next = resolveAiEntryCompletedConversationMessages({
          currentMessages: current,
          persistedMessages,
        })
        savePendingConversationMessages(targetConversationId, next)
        return next
      })

      saveAiEntryPendingTasks(refreshedTaskRuns, {
        conversationId: targetConversationId,
        agentId: routeAgentId || resolvedRequestAgentId || null,
      })
      if (pendingTask || refreshedTaskRuns.some((taskRun) => taskRun.status === "pending" || taskRun.status === "running")) {
        setPendingTaskRefreshKey((current) => current + 1)
      }

      const hasRecoveredConversation =
        Boolean(pendingTask) ||
        hasAiEntryCompletedAssistantMessage(persistedMessages) ||
        hasAiEntryPptPreviewMaterialized({
          persistedMessages,
          conversationState: refreshedConversationState,
        }) ||
        refreshedConversationState?.ppt?.phase === "preview-ready" ||
        refreshedConversationState?.ppt?.phase === "exported"

      if (hasRecoveredConversation) {
        setErrorMessage(null)
        setPendingTaskEvents([])
        return true
      }

      return false
    } catch (error) {
      console.error("ai-entry.stream-recovery.failed", error)
      return false
    } finally {
      isStreamRecoveryInFlightRef.current = false
    }
  }, [conversationId, fetchConversationMessages, resolvedRequestAgentId, routeAgentId])

  useEffect(() => {
    if (!conversationId || isConversationLoading || isResponseLoading || !hasStreamRecoveryPending) {
      return
    }

    let cancelled = false

    const tryRecover = async () => {
      if (cancelled) return
      await attemptConversationRecovery()
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void tryRecover()
      }
    }

    void tryRecover()
    const intervalId = window.setInterval(() => {
      void tryRecover()
    }, AI_ENTRY_STREAM_RECOVERY_POLL_INTERVAL_MS)

    window.addEventListener("online", tryRecover)
    window.addEventListener("focus", tryRecover)
    window.addEventListener("pageshow", tryRecover)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener("online", tryRecover)
      window.removeEventListener("focus", tryRecover)
      window.removeEventListener("pageshow", tryRecover)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [attemptConversationRecovery, conversationId, hasStreamRecoveryPending, isConversationLoading, isResponseLoading])

  useEffect(() => {
    const localPendingTasks = conversationId
      ? listAiEntryPendingTasks({
          conversationId,
          agentId: activePendingAgentId,
        })
      : []
    const activeTaskRunIds = [
      ...new Set([
        ...localPendingTasks.map((task) => task.taskId),
        ...taskRunsRef.current
          .filter((taskRun) => taskRun.status === "pending" || taskRun.status === "running")
          .map((taskRun) => taskRun.task_id),
      ]),
    ]

    if (activeTaskRunIds.length === 0) {
      setPendingTaskEvents([])
      return
    }

    let cancelled = false
    let consecutivePollErrors = 0
    const pollStartedAt = Date.now()
    const initialPreviewSessionId =
      typeof conversationState?.ppt?.latestPreview?.previewSessionId === "string" &&
      conversationState.ppt.latestPreview.previewSessionId.trim()
        ? conversationState.ppt.latestPreview.previewSessionId.trim()
        : null
    let historyRefreshPollCount = 0
    const requestImmediateRepoll = () => {
      setPendingTaskRefreshKey((current) => current + 1)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestImmediateRepoll()
      }
    }

    window.addEventListener("focus", requestImmediateRepoll)
    window.addEventListener("online", requestImmediateRepoll)
    window.addEventListener("pageshow", requestImmediateRepoll)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    const poll = async () => {
      while (!cancelled) {
        try {
          const response = await fetch("/api/ai/task-runs/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskRunIds: activeTaskRunIds }),
            cache: "no-store",
            credentials: "same-origin",
          })
          if (!response.ok) {
            throw new Error(`http_${response.status}`)
          }

          const payload = (await response.json().catch(() => null)) as {
            data?: MessageApiTaskRun[]
          } | null
          const refreshedTaskRuns = (payload?.data || [])
            .map((taskRun) => normalizeMessageApiTaskRun(taskRun))
            .filter((taskRun): taskRun is MessageApiTaskRun => Boolean(taskRun))

          consecutivePollErrors = 0
          setTaskRuns((current) => mergeAiEntryTaskRuns(current, refreshedTaskRuns))

          const latestUpdatedTaskRun = [...refreshedTaskRuns].sort((left, right) => right.updated_at - left.updated_at)[0] || null
          if (latestUpdatedTaskRun?.events.length) {
            setPendingTaskEvents(
              normalizePendingTaskEvents(
                latestUpdatedTaskRun.events.map((event) => ({
                  ...event,
                  at: event.at * 1000,
                })),
              ),
            )
          }

          historyRefreshPollCount += 1
          const activeTaskRuns = refreshedTaskRuns.filter((taskRun) => taskRun.status === "pending" || taskRun.status === "running")
          const terminalTaskRuns = refreshedTaskRuns.filter((taskRun) => taskRun.status === "success" || taskRun.status === "failed")
          const shouldRefreshHistoryWhileRunning =
            conversationId &&
            activeTaskRuns.length > 0 &&
            historyRefreshPollCount % AI_ENTRY_PENDING_TASK_HISTORY_REFRESH_CADENCE === 0

          if (shouldRefreshHistoryWhileRunning && conversationId) {
            try {
              const {
                response: historyResponse,
                messages: persistedMessages,
                taskRuns: refreshedConversationTaskRuns,
                conversationState: refreshedConversationState,
              } = await fetchConversationMessages(conversationId)
              if (
                historyResponse.ok &&
                hasAiEntryPptPreviewMaterialized({
                  persistedMessages,
                  conversationState: refreshedConversationState,
                  previousPreviewSessionId: initialPreviewSessionId,
                })
              ) {
                setTaskRuns(refreshedConversationTaskRuns)
                setConversationState(refreshedConversationState)
                setMessages((current) => {
                  const next = resolveAiEntryCompletedConversationMessages({
                    currentMessages: current,
                    persistedMessages,
                  })
                  savePendingConversationMessages(conversationId, next)
                  return next
                })
              }
            } catch (error) {
              console.error("ai-entry.pending-task.running-history-refresh.failed", error)
            }
          }

          if (terminalTaskRuns.length > 0) {
            const resolvedConversationId = conversationId
            if (resolvedConversationId) {
              try {
                const {
                  response: historyResponse,
                  messages: persistedMessages,
                  taskRuns: refreshedConversationTaskRuns,
                  conversationState: refreshedConversationState,
                } = await fetchConversationMessages(resolvedConversationId)
                if (historyResponse.ok) {
                  setTaskRuns(refreshedConversationTaskRuns)
                  setConversationState(refreshedConversationState)
                  setMessages((current) => {
                    const next = resolveAiEntryCompletedConversationMessages({
                      currentMessages: current,
                      persistedMessages,
                    })
                    savePendingConversationMessages(resolvedConversationId, next)
                    return next
                  })
                }
              } catch (error) {
                console.error("ai-entry.pending-task.history-refresh.failed", error)
              }
            }

            for (const taskRun of terminalTaskRuns) {
              removePendingAssistantTask(taskRun.task_id)
            }

            if (activeTaskRuns.length === 0) {
              return
            }
          }
        } catch (error) {
          console.error("ai-entry.pending-task.poll.failed", error)
          consecutivePollErrors += 1
          const errorMessage =
            error instanceof Error && error.message ? error.message : "pending_task_poll_failed"
          const pollTimedOut = Date.now() - pollStartedAt > AI_ENTRY_PENDING_TASK_MAX_AGE_MS
          const shouldStopPolling =
            consecutivePollErrors >= AI_ENTRY_PENDING_TASK_MAX_POLL_ERRORS ||
            pollTimedOut

          if (shouldStopPolling) {
            for (const taskId of activeTaskRunIds) {
              removePendingAssistantTask(taskId)
            }
            if (!cancelled) {
              setPendingTaskEvents((current) =>
                [
                  ...current,
                  {
                    type: "background_generation_failed",
                    label: pollTimedOut
                      ? isZh
                        ? "后台任务轮询超时"
                        : "Background task polling timed out"
                      : isZh
                        ? "后台任务轮询失败"
                        : "Background task polling failed",
                    detail: renderAiEntryErrorMessage(errorMessage, copy, isZh),
                    status: "failed" as const,
                    at: Date.now(),
                  },
                ].slice(-12),
              )
              setErrorMessage(
                `${copy.errorPrefix}${
                  pollTimedOut
                    ? isZh
                      ? "后台任务轮询超时，请刷新会话确认最终状态。"
                      : "Background task polling timed out. Refresh the conversation to confirm the final state."
                    : renderAiEntryErrorMessage(errorMessage, copy, isZh)
                }`,
              )
            }
            return
          }
        }

        const pollIntervalMs = resolveAiEntryTaskPollIntervalMs({
          isDocumentVisible: document.visibilityState === "visible",
        })

        await new Promise((resolve) => {
          window.setTimeout(resolve, pollIntervalMs)
        })
      }
    }

    void poll()
    return () => {
      cancelled = true
      window.removeEventListener("focus", requestImmediateRepoll)
      window.removeEventListener("online", requestImmediateRepoll)
      window.removeEventListener("pageshow", requestImmediateRepoll)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [activePendingAgentId, conversationId, conversationState, copy, fetchConversationMessages, isZh, pendingTaskRefreshKey])

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageId(messageId)
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current))
      }, 1200)
    } catch {
      setCopiedMessageId(null)
    }
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  const handleAttachmentFiles = useCallback(
    async (fileList: FileList | null) => {
      const files = Array.from(fileList || [])
      if (!files.length) return

      if (attachments.length + files.length > AI_ENTRY_MAX_ATTACHMENTS) {
        setErrorMessage(isZh ? "一次最多上传 4 个附件。" : "You can upload up to 4 attachments at a time.")
        return
      }

      setIsPreparingAttachments(true)
      try {
        const nextAttachments: ChatAttachment[] = []
        let hadAttachmentError = false
        for (const file of files) {
          if (file.size > AI_ENTRY_MAX_ATTACHMENT_BYTES) {
            setErrorMessage(isZh ? "单个附件不能超过 4MB。" : "Each attachment must be 4MB or smaller.")
            hadAttachmentError = true
            continue
          }

          let artifactId: number
          try {
            artifactId = await uploadChatAttachmentToAssetLibrary(file)
          } catch (error) {
            const code = error instanceof Error ? error.message : "asset_library_upload_failed"
            setErrorMessage(renderAttachmentError(code, isZh))
            hadAttachmentError = true
            continue
          }

          if (file.type.startsWith("image/")) {
            nextAttachments.push({
              id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: file.name,
              mediaType: file.type,
              size: file.size,
              artifactId,
              dataUrl: await readFileAsDataUrl(file),
            })
            continue
          }

          if (isTextLikeFile(file)) {
            nextAttachments.push({
              id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: file.name,
              mediaType: file.type || "text/plain",
              size: file.size,
              artifactId,
              text: await file.text(),
            })
            continue
          }

          if (isParseableDocumentFile(file)) {
            try {
              nextAttachments.push({
                ...(await extractDocumentAttachment(file)),
                artifactId,
              })
            } catch (error) {
              const code = error instanceof Error ? error.message : "attachment_parse_failed"
              setErrorMessage(renderAttachmentError(code, isZh))
              hadAttachmentError = true
            }
            continue
          }

          setErrorMessage(isZh ? "当前对话暂不支持该文件类型，请上传图片、文本、DOCX 或 PDF 文件。" : "This chat does not support that file type yet. Upload an image, text, DOCX, or PDF file.")
          hadAttachmentError = true
        }

        if (nextAttachments.length > 0) {
          setAttachments((current) => [...current, ...nextAttachments].slice(0, AI_ENTRY_MAX_ATTACHMENTS))
          if (!hadAttachmentError) setErrorMessage(null)
        }
      } finally {
        setIsPreparingAttachments(false)
      }
    },
    [attachments.length, isZh],
  )

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if ((!prompt && attachments.length === 0) || isResponseLoading || isConversationLoading || isPreparingAttachments) return
    if (selectedAgentId?.startsWith("business-") && !sessionReady && !sessionReadyError) {
      setErrorMessage(sessionReadyError || (isZh ? "正在预热业务 Agent 会话，请稍候。" : "The business Agent session is warming up. Please wait."))
      return
    }
    const hasImageAttachments = attachments.some((attachment) => attachment.mediaType.startsWith("image/"))
    if (hasImageAttachments && !modelSupportsImageInput(selectedModel)) {
      setErrorMessage(isZh ? "当前所选模型不支持图片上传或识别，请切换到支持视觉的模型后再发送。" : "The selected model does not support image upload or recognition. Switch to a vision-capable model before sending.")
      return
    }
    const sentAttachments = attachments
    const userMessageContent = prompt || (isZh ? "请识别附件内容。" : "Please analyze the attached content.")
    const optimisticCreatedAt = Math.floor(Date.now() / 1000)
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessageContent,
      attachments: sentAttachments,
      createdAt: optimisticCreatedAt,
    }
    const assistantMessageId = `assistant-${Date.now()}`
    const contextMessages = [
      ...buildOutgoingAiEntryMessages(messages),
      ...buildOutgoingAiEntryMessages([
        { role: "user" as const, content: userMessageContent, attachments: sentAttachments },
      ]),
    ]
    const baseMessages = messages
    let assistantDraft: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: optimisticCreatedAt,
    }
    let sidebarRefreshConversationId: string | null = null
    let latestStreamConversationId: string | null = conversationId
    let didReceiveStreamTerminalEvent = false

    const syncAssistantDraft = (nextDraft: ChatMessage) => {
      if (
        nextDraft.content === assistantDraft.content &&
        nextDraft.parts === assistantDraft.parts &&
        nextDraft.attachments === assistantDraft.attachments
      ) {
        return
      }
      assistantDraft = nextDraft
      const nextMessages = [...baseMessages, userMessage, assistantDraft]
      setMessages(nextMessages)
      if (latestConversationIdRef.current) {
        savePendingConversationMessages(latestConversationIdRef.current, nextMessages)
      }
    }

    const persistPendingConversationDraft = (nextConversationId: string | null) => {
      if (!nextConversationId) return
      latestConversationIdRef.current = nextConversationId
      savePendingConversationMessages(nextConversationId, [...baseMessages, userMessage, assistantDraft])
      if (!shouldLockModel) {
        savePendingConversationSelection({
          conversationId: nextConversationId,
          modelId: selectedModelId,
          reasoningEffort: resolvedReasoningEffort,
        })
      }
    }

    const refreshSidebarForConversation = (nextConversationId: string | null, force = false) => {
      if (!nextConversationId) return
      if (!force && sidebarRefreshConversationId === nextConversationId) return
      sidebarRefreshConversationId = nextConversationId
      dispatchAiEntrySidebarRefresh({
        conversationId: nextConversationId,
        agentId: routeAgentId || resolvedRequestAgentId || null,
        entryMode: effectiveEntryMode,
      })
    }

    const promoteConversationRoute = (nextConversationId: string | null) => {
      if (!nextConversationId) return
      persistPendingConversationDraft(nextConversationId)
      setConversationId((current) => (current === nextConversationId ? current : nextConversationId))
      refreshSidebarForConversation(nextConversationId)
    }

    setInput("")
    setAttachments([])
    setErrorMessage(null)
    setPendingTaskEvents([
      {
        type: "request_start",
        label: "Request sent",
        status: "running",
        at: Date.now(),
      },
    ])
    const initialMessages = [...baseMessages, userMessage, assistantDraft]
    setMessages(initialMessages)
    if (latestConversationIdRef.current) {
      savePendingConversationMessages(latestConversationIdRef.current, initialMessages)
    }
    isLoadingRef.current = true
    setIsResponseLoading(true)
    if (!conversationId) {
      pendingFirstConversationRouteRef.current = true
    }

    const abortController = new AbortController()
    activeRequestAbortControllerRef.current = abortController

    try {
      const effectiveRequestAgentId = resolveAiEntryRequestedAgentId({
        forcedAgentId: embedded ? forcedAgentId : null,
        selectedAgentId: isPlainChatRoute ? null : selectedAgentId,
        routeAgentId,
      })
      const shouldSendAgentConfig =
        isConsultingEntry ||
        Boolean(
          effectiveRequestAgentId &&
          (embedded || isAgentSelectionExplicit || Boolean(routeAgentId)),
        )

      // Capture the user's choice synchronously before the first request can
      // promote the draft to a new conversation and remount the workspace.
      // The route transition must not fall back to the catalog default.
      if (!shouldLockModel) {
        persistSelectedModelId(selectedModelId)
        persistReasoningEffort(resolvedReasoningEffort)
      }

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        credentials: "same-origin",
        signal: abortController.signal,
        body: JSON.stringify({
          stream: true,
          messages: contextMessages,
          attachments: sentAttachments,
          enterpriseKnowledge: {
            enabled: knowledgeEnabled,
            datasetIds: selectedKnowledgeDatasetIds,
          },
          conversationId,
          conversationScope: isConsultingEntry ? "consulting" : "chat",
          modelConfig:
            selectedModelId
              ? {
                  providerId:
                    resolvePreferredProviderForModel({
                      selectedModel,
                      selectedProviderId: modelProviderId,
                      fallbackProviderId: modelProviderId,
                    }) || undefined,
                  modelId:
                    selectedModel?.modelId ||
                    selectedModel?.runtimeId ||
                    selectedModel?.canonicalId ||
                    selectedModelId,
                  reasoningEffort: resolvedReasoningEffort === "auto" ? undefined : resolvedReasoningEffort,
                }
              : undefined,
          agentConfig:
            shouldSendAgentConfig
              ? {
                  ...(effectiveRequestAgentId
                    ? {
                        agentId: effectiveRequestAgentId,
                        ...(resolvedRequestAgentName
                          ? { agentName: resolvedRequestAgentName }
                          : {}),
                      }
                    : {}),
                  ...(isConsultingEntry
                    ? {
                        entryMode: AI_ENTRY_CONSULTING_ENTRY_MODE,
                      }
                    : {}),
                }
              : undefined,
        }),
      })

      const pushTaskEvent = (nextEvent: PendingTaskEvent) => {
        setPendingTaskEvents((current) => [...current, nextEvent].slice(-12))
      }

      const upsertTaskEvent = (nextEvent: PendingTaskEvent) => {
        setPendingTaskEvents((current) => {
          const targetIndex = current.findIndex((item) => item.type === nextEvent.type)
          if (targetIndex < 0) return [...current, nextEvent].slice(-12)
          const next = [...current]
          next[targetIndex] = nextEvent
          return next.slice(-12)
        })
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ChatApiResponse | null
        throw new Error(payload?.error || `http_${response.status}`)
      }

      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let sseBuffer = ""
        let streamedText = ""
        let streamError: string | null = null
        let streamedToolAppendix = ""

        const processEvent = (event: ChatStreamApiResponse) => {
          const now = Date.now()
          const streamConversationId =
            typeof event.conversation_id === "string" && event.conversation_id.trim()
              ? event.conversation_id.trim()
              : null
          if (streamConversationId) {
            latestStreamConversationId = streamConversationId
            persistPendingConversationDraft(streamConversationId)
          }

          const currentParts = assistantDraft.parts ?? []
          const nextParts = applySseEvent(currentParts, event)
          if (nextParts !== currentParts) {
            syncAssistantDraft({ ...assistantDraft, parts: nextParts })
          }

          if (event.event === "conversation_init") {
            upsertTaskEvent({
              type: "conversation_init",
              label: "Conversation ready",
              status: "completed",
              at: now,
            })
            return
          }

          if (event.event === "agent_resolved") {
            upsertTaskEvent({
              type: "agent_resolved",
              label: "Agent resolved",
              detail: typeof event.agent_id === "string" ? event.agent_id : undefined,
              status: "completed",
              at: now,
            })
            return
          }

          if (event.event === "skill_activated" || event.event === "skill_completed" || event.event === "skill_failed") {
            const skillId = typeof event.skill_id === "string" && event.skill_id.trim() ? event.skill_id.trim() : "skill"
            upsertTaskEvent({
              type: `skill:${skillId}`,
              label: skillId,
              detail: event.event === "skill_failed" && typeof event.message === "string" ? event.message : undefined,
              status: event.event === "skill_activated" ? "running" : event.event === "skill_completed" ? "completed" : "failed",
              at: now,
            })
            return
          }

          if (event.event === "provider_selected" || event.event === "provider_fallback") {
            const normalizedProviderModel = resolveDisplayModelIdForProvider({
              rawModelId: typeof event.provider_model === "string" ? event.provider_model : null,
              providerId: typeof event.provider === "string" ? event.provider : null,
              models,
            })
            const reasonLabel = event.event === "provider_fallback"
              ? resolveProviderFallbackReasonLabel({
                  reason: event.fallback_reason,
                  error: event.runtime_error,
                  locale: isZh ? "zh" : "en",
                })
              : null
            const detail = [event.provider, normalizedProviderModel || selectedModelId, reasonLabel]
              .filter(Boolean)
              .join(" / ")
            upsertTaskEvent({
              type: "provider",
              label: event.event === "provider_fallback"
                ? (isZh ? "Provider 已切换" : "Provider switched")
                : (isZh ? "模型路由" : "Model routing"),
              detail: detail || undefined,
              status: event.event === "provider_fallback" ? "info" : "running",
              at: now,
            })
            return
          }

          if (event.event === "runtime_stage" || event.event === "runtime_warning") {
            const stage = typeof event.data?.stage === "string" ? event.data.stage : event.event
            const detail = typeof event.data?.message === "string" ? event.data.message : event.message || event.error
            upsertTaskEvent({
              type: `runtime:${stage}`,
              label: isZh ? "PPT Agent 过程" : "PPT agent progress",
              detail: detail || undefined,
              status: event.event === "runtime_warning" ? "info" : event.data?.runtimeStatus || "running",
              at: now,
            })
            return
          }

          if (event.event === "background_task_queued") {
            const taskId = typeof event.data?.taskId === "string" ? event.data.taskId.trim() : ""
            if (taskId && streamConversationId) {
              savePendingAssistantTask({
                taskId,
                scope: "ai_entry",
                conversationId: streamConversationId,
                agentId: routeAgentId || resolvedRequestAgentId || null,
                prompt: userMessage.content,
                taskType: "opencode_agent_run",
                createdAt: Date.now(),
              })
              const nowSeconds = Math.floor(Date.now() / 1000)
              setTaskRuns((current) => mergeAiEntryTaskRuns(current, [{
                task_id: taskId,
                status: "pending",
                task_type: "opencode_agent_run",
                conversation_id: streamConversationId,
                agent_id: routeAgentId || resolvedRequestAgentId || null,
                created_at: nowSeconds,
                updated_at: nowSeconds,
                started_at: null,
                stage: "runtime_queued",
                stage_label: isZh ? "任务已排队，关闭页面后仍会继续执行" : "Queued; execution continues after you leave",
                progress_current: 0,
                progress_total: 4,
                last_heartbeat_at: nowSeconds,
                finished_at: null,
                preview_session_id: null,
                request_label: userMessage.content.trim() || null,
                result_summary: null,
                selected_template_id: null,
                selected_template_label: null,
                error_code: null,
                error_message: null,
                error: null,
                events: [],
              }]))
              setPendingTaskRefreshKey((current) => current + 1)
              upsertTaskEvent({
                type: "background_runtime",
                label: isZh ? "智能体任务已进入后台" : "Agent task queued in background",
                status: "running",
                at: now,
              })
            }
            return
          }

          if (event.event === "knowledge_query_start") {
            upsertTaskEvent({
              type: "knowledge_query",
              label: "Query enterprise knowledge",
              status: "running",
              at: now,
            })
            return
          }

          if (event.event === "knowledge_query_result") {
            const status = event.data?.status || "miss"
            const snippetCount =
              typeof event.data?.snippetCount === "number" ? event.data.snippetCount : 0
            const datasetCount =
              typeof event.data?.datasetCount === "number" ? event.data.datasetCount : 0
            const detail =
              status === "failed"
                ? event.data?.message || "failed"
                : `${snippetCount} snippets / ${datasetCount} datasets`

            upsertTaskEvent({
              type: "knowledge_query",
              label: "Enterprise knowledge queried",
              detail,
              status:
                status === "failed"
                  ? "failed"
                  : status === "hit"
                    ? "completed"
                    : "info",
              at: now,
            })
            return
          }

          if (event.event === "tool_call") {
            const toolName = event.data?.toolName || "tool"
            const toolId = event.data?.toolCallId || toolName
            const isWebSearch = toolName === "web_search"
            promoteConversationRoute(streamConversationId)
            upsertTaskEvent({
              type: `tool:${toolId}`,
              label: isWebSearch ? (isZh ? "\u6b63\u5728\u641c\u7d22\u7f51\u9875" : "Searching the web") : `Tool: ${toolName}`,
              detail: isWebSearch ? event.data?.args?.query : undefined,
              status: "running",
              at: now,
            })
            return
          }

          if (event.event === "tool_result") {
            const toolName = event.data?.toolName || "tool"
            const toolId = event.data?.toolCallId || toolName
            const isWebSearch = toolName === "web_search"
            const toolResultPayload =
              event.data?.result &&
              typeof event.data.result === "object"
                ? (event.data.result as NonNullable<NonNullable<ChatStreamApiResponse["data"]>["result"]>)
                : null
            const toolResultRecord =
              toolResultPayload && typeof toolResultPayload === "object"
                ? (toolResultPayload as Record<string, unknown>)
                : null
            const backgroundSelectedTemplateId =
              typeof toolResultRecord?.selectedTemplateId === "string" &&
              toolResultRecord.selectedTemplateId.trim()
                ? toolResultRecord.selectedTemplateId.trim()
                : null
            const backgroundSelectedTemplateLabel =
              backgroundSelectedTemplateId && Array.isArray(toolResultRecord?.recommendedTemplates)
                ? toolResultRecord.recommendedTemplates.find((item: unknown) => {
                    if (!item || typeof item !== "object") return false
                    return (
                      typeof (item as { templateId?: unknown }).templateId === "string" &&
                      (item as { templateId: string }).templateId.trim() === backgroundSelectedTemplateId
                    )
                  }) as { templateLabel?: unknown; styleName?: unknown } | undefined
                : undefined
            const isToolFailure = toolResultPayload?.ok === false
            const backgroundTaskId =
              typeof toolResultPayload?.backgroundTask?.taskId === "string" &&
              toolResultPayload.backgroundTask.taskId.trim()
                ? toolResultPayload.backgroundTask.taskId.trim()
                : null
            const sources = Array.isArray(event.data?.result?.results)
              ? event.data.result.results.filter((source) => typeof source?.url === "string" && source.url.trim())
              : []
            const sourceDetail = sources.length
              ? `${sources.length} ${isZh ? "\u4e2a\u6765\u6e90" : "sources"}: ${sources.slice(0, 2).map((source) => source.title || source.url).filter(Boolean).join(" / ")}`
              : undefined
            const toolMessage = buildPptToolResultMessage({
              toolName,
              result: event.data?.result ?? null,
              origin: typeof window !== "undefined" ? window.location.origin : null,
              isZh,
            })

            if (
              toolMessage &&
              !isQueuedBackgroundPreviewResult({
                toolName,
                result: toolResultPayload,
              }) &&
              !streamedToolAppendix.includes(toolMessage)
            ) {
              streamedToolAppendix = `${streamedToolAppendix}${toolMessage}`
              syncAssistantDraft({
                ...assistantDraft,
                content: `${streamedText}${streamedToolAppendix}`,
              })
            }

            promoteConversationRoute(streamConversationId)
            if (backgroundTaskId && streamConversationId) {
              savePendingAssistantTask({
                taskId: backgroundTaskId,
                scope: "ai_entry",
                conversationId: streamConversationId,
                agentId: routeAgentId || resolvedRequestAgentId || null,
                prompt: userMessage.content,
                taskType: toolName,
                createdAt: Date.now(),
              })
              setTaskRuns((current) =>
                mergeAiEntryTaskRuns(current, [
                  {
                    task_id: backgroundTaskId,
                    status: "running",
                    task_type: toolName === "preview_ppt_deck" ? "preview_ppt_deck" : "preview_ppt_deck",
                    conversation_id: streamConversationId,
                    agent_id: routeAgentId || resolvedRequestAgentId || null,
                    created_at: Math.floor(Date.now() / 1000),
                    updated_at: Math.floor(Date.now() / 1000),
                    started_at: null,
                    stage: "brief_validating",
                    stage_label: isZh ? "已排队，准备校验需求" : "Queued, validating brief",
                    progress_current: 0,
                    progress_total: 5,
                    last_heartbeat_at: Math.floor(Date.now() / 1000),
                    finished_at: null,
                    preview_session_id: null,
                    request_label: userMessage.content.trim() || null,
                    result_summary: null,
                    selected_template_id: backgroundSelectedTemplateId,
                    selected_template_label:
                      backgroundSelectedTemplateLabel &&
                      typeof backgroundSelectedTemplateLabel.templateLabel === "string" &&
                      backgroundSelectedTemplateLabel.templateLabel.trim()
                        ? backgroundSelectedTemplateLabel.templateLabel.trim()
                        : backgroundSelectedTemplateLabel &&
                            typeof backgroundSelectedTemplateLabel.styleName === "string" &&
                            backgroundSelectedTemplateLabel.styleName.trim()
                          ? backgroundSelectedTemplateLabel.styleName.trim()
                          : backgroundSelectedTemplateId,
                    error_code: null,
                    error_message: null,
                    error: null,
                    events: [],
                  },
                ]),
              )
              setPendingTaskRefreshKey((current) => current + 1)
            }
            upsertTaskEvent({
              type: `tool:${toolId}`,
              label:
                backgroundTaskId && toolName === "preview_ppt_deck"
                  ? isZh
                    ? "\u53ef\u7f16\u8f91 PPT \u5df2\u8f6c\u5165\u540e\u53f0\u751f\u6210"
                    : "Editable PPT moved to background generation"
                  : isWebSearch
                    ? (isZh ? "\u7f51\u9875\u641c\u7d22\u5b8c\u6210" : "Web search completed")
                    : `Tool: ${toolName}`,
              detail: isToolFailure
                ? event.data?.result?.error?.message || "failed"
                : backgroundTaskId
                  ? event.data?.result?.message || undefined
                : isWebSearch
                  ? sourceDetail
                  : undefined,
              status: isToolFailure ? "failed" : backgroundTaskId ? "running" : "completed",
              at: now,
            })
            return
          }

          if (event.event === "artifact_created") {
            const fileName = event.artifact?.fileName || event.artifact?.title || "artifact"
            promoteConversationRoute(streamConversationId)
            upsertTaskEvent({
              type: `artifact:${event.artifact?.artifactId || fileName}`,
              label: isZh ? "\u5df2\u751f\u6210\u53ef\u4e0b\u8f7d\u4ea4\u4ed8\u7269" : "Downloadable artifact created",
              detail: fileName,
              status: "completed",
              at: now,
            })
            return
          }

          if (event.event === "validation_result") {
            const validationOk = event.data?.validation?.ok !== false
            const failedChecks = Array.isArray(event.data?.validation?.checks)
              ? event.data.validation.checks.filter((check: { ok?: boolean }) => check?.ok === false)
              : []
            upsertTaskEvent({
              type: `validation:${event.data?.toolCallId || event.data?.toolName || "tool"}`,
              label: isZh ? "\u5de5\u5177\u7ed3\u679c\u6821\u9a8c" : "Tool result validation",
              detail: failedChecks[0]?.message,
              status: validationOk ? "completed" : "failed",
              at: now,
            })
            return
          }

          if (event.event === "message") {
            const delta = typeof event.answer === "string" ? event.answer : ""
            if (!delta) return
            streamedText += delta
            syncAssistantDraft({
              ...assistantDraft,
              content: `${streamedText}${streamedToolAppendix}`,
            })
            promoteConversationRoute(streamConversationId)
            return
          }

          if (event.event === "message_end") {
            didReceiveStreamTerminalEvent = true
            const finalText = typeof event.answer === "string" && event.answer.trim()
              ? event.answer.trim()
              : streamedText.trim()
            const resolvedTextWithTools =
              streamedToolAppendix.trim() && finalText.includes(streamedToolAppendix.trim())
                ? finalText
                : `${finalText}${streamedToolAppendix}`.trim()

            const resolvedProviderModelId = resolveDisplayModelIdForProvider({
              rawModelId: typeof event.provider_model === "string" ? event.provider_model : null,
              providerId: typeof event.provider === "string" ? event.provider : null,
              models,
            })
            upsertTaskEvent({
              type: "response",
              label: "Response complete",
              detail:
                [event.provider, resolvedProviderModelId || selectedModelId]
                  .filter(Boolean)
                  .join(" / ") || undefined,
              status: "completed",
              at: now,
            })

            upsertTaskEvent({
              type: "request_start",
              label: "Request sent",
              status: "completed",
              at: now,
            })
            setPendingTaskEvents((current) => settlePendingTaskEvents(current))

            syncAssistantDraft({
              ...assistantDraft,
              content: resolvedTextWithTools || (assistantDraft.parts?.length ? "" : copy.unknownError),
            })
            promoteConversationRoute(streamConversationId)
            refreshSidebarForConversation(streamConversationId, true)
            return
          }

          if (event.event === "error") {
            didReceiveStreamTerminalEvent = true
            streamError = renderAiEntryErrorMessage(event.error, copy, isZh)
            promoteConversationRoute(streamConversationId)
            upsertTaskEvent({
              type: "request_start",
              label: "Request sent",
              status: "completed",
              at: now,
            })
            pushTaskEvent({
              type: "stream_error",
              label: "Request failed",
              detail: streamError || undefined,
              status: "failed",
              at: now,
            })
            setPendingTaskEvents((current) => settlePendingTaskEvents(current, "failed"))
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          sseBuffer += decoder.decode(value || new Uint8Array(), { stream: !done })
          const parsed = consumeSseBuffer<ChatStreamApiResponse>(sseBuffer)
          sseBuffer = parsed.rest
          parsed.events.forEach(processEvent)
          if (done) break
        }

        const flushed = consumeSseBuffer<ChatStreamApiResponse>(sseBuffer)
        flushed.events.forEach(processEvent)

        if (streamError) throw new Error(streamError)
        if (!didReceiveStreamTerminalEvent) {
          const recoveryConversationId =
            latestStreamConversationId || latestConversationIdRef.current || conversationId

          if (recoveryConversationId) {
            latestConversationIdRef.current = recoveryConversationId
            setConversationId((current) =>
              current === recoveryConversationId ? current : recoveryConversationId,
            )
            setErrorMessage(
              isZh
                ? "连接中断，正在尝试自动恢复会话..."
                : "Connection interrupted. Attempting to recover the conversation...",
            )
            setPendingTaskEvents((current) =>
              [
                ...filterAiEntryRecoverySupersededTaskEvents(current),
                {
                  type: "stream_recovery",
                  label: isZh ? "连接中断，正在刷新会话" : "Connection interrupted, refreshing conversation",
                  detail: buildAiEntryRecoveryEventDetail(isZh),
                  status: "info" as const,
                  at: Date.now(),
                },
              ].slice(-12),
            )
            return
          }
        }
        if (!streamedText.trim()) {
          syncAssistantDraft({
            ...assistantDraft,
            content: assistantDraft.parts?.length ? assistantDraft.content : copy.unknownError,
          })
        }
      } else {
        const payload = (await response.json().catch(() => null)) as ChatApiResponse | null
        const assistantText = (payload?.message || "").trim()
        const completedMessages = [
          ...messages,
          userMessage,
          {
            id: assistantMessageId,
            role: "assistant" as const,
            content: assistantText || copy.unknownError,
            createdAt: optimisticCreatedAt,
          },
        ]
        setMessages(completedMessages)
        if (typeof payload?.conversationId === "string" && payload.conversationId) {
          latestConversationIdRef.current = payload.conversationId
          savePendingConversationMessages(payload.conversationId, completedMessages)
          setConversationId(payload.conversationId)
          refreshSidebarForConversation(payload.conversationId, true)
        }
        setPendingTaskEvents((current) => [
          ...settlePendingTaskEvents(current).filter((event) => event.type !== "request_start"),
          {
            type: "request_start",
            label: "Request sent",
            status: "completed",
            at: Date.now(),
          },
        ])
      }
    } catch (error) {
      if (
        abortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return
      }
      const renderedError = `${copy.errorPrefix}${renderAiEntryErrorMessage(
        error instanceof Error ? error.message : error,
        copy,
        isZh,
      )}`
      const recoveryConversationId =
        latestStreamConversationId || latestConversationIdRef.current || conversationId
      const shouldAttemptRecovery =
        Boolean(recoveryConversationId) && isAiEntryRecoverableTransportError(error)
      const failedEvent: PendingTaskEvent = {
        type: "request_failed",
        label: "Request failed",
        detail: renderedError,
        status: "failed",
        at: Date.now(),
      }
      setErrorMessage(
        shouldAttemptRecovery
          ? isZh
            ? "连接中断，正在尝试自动恢复会话..."
            : "Connection interrupted. Attempting to recover the conversation..."
          : renderedError,
      )
      if (!assistantDraft.content.trim() && !(assistantDraft.parts?.length ?? 0)) {
        syncAssistantDraft({
          ...assistantDraft,
          content:
            shouldAttemptRecovery
              ? assistantDraft.content
              : renderedError,
        })
      } else if (latestConversationIdRef.current) {
        savePendingConversationMessages(latestConversationIdRef.current, [...baseMessages, userMessage, assistantDraft])
      }
      setPendingTaskEvents((current) =>
        shouldAttemptRecovery
          ? [
              ...filterAiEntryRecoverySupersededTaskEvents(current),
              {
                type: "stream_recovery",
                label: isZh ? "连接中断，正在刷新会话" : "Connection interrupted, refreshing conversation",
                detail: buildAiEntryRecoveryEventDetail(isZh),
                status: "info" as const,
                at: Date.now(),
              },
            ].slice(-12)
          : [
              ...settlePendingTaskEvents(current, "failed").filter((event) => event.type !== "request_start"),
              {
                type: "request_start",
                label: "Request sent",
                detail: renderedError,
                status: "failed" as const,
                at: Date.now(),
              },
              failedEvent,
            ].slice(-12),
      )
    } finally {
      if (activeRequestAbortControllerRef.current === abortController) {
        activeRequestAbortControllerRef.current = null
        // Keep the first-route handoff armed until the conversation id has
        // been observed by the route-sync effect. Non-stream JSON responses
        // can set the id and enter finally in the same React batch; clearing
        // here would otherwise lose the redirect to /dashboard/ai/:id.
        if (!latestConversationIdRef.current) {
          pendingFirstConversationRouteRef.current = false
        }
        isLoadingRef.current = false
        setIsResponseLoading(false)
      }
    }
  }, [
    attachments,
    conversationId,
    copy,
    input,
    isConversationLoading,
    isPreparingAttachments,
    isResponseLoading,
    isZh,
    selectedAgentId,
    sessionReady,
    sessionReadyError,
    isPlainChatRoute,
    embedded,
    forcedAgentId,
    knowledgeEnabled,
    messages,
    modelProviderId,
    models,
    selectedKnowledgeDatasetIds,
    isConsultingEntry,
    isAgentSelectionExplicit,
    effectiveEntryMode,
    resolvedRequestAgentName,
    resolvedRequestAgentId,
    routeAgentId,
    selectedModel,
    selectedModelId,
    resolvedReasoningEffort,
    shouldLockModel,
  ])

  const renderSelectors = () => (
    <WorkbenchModelReasoningSelector
      models={models.map((item) => ({ id: item.id, label: item.name, provider: item.providerLabel || item.providerId || undefined }))}
      modelId={selectedModelId ?? undefined}
      reasoningOptions={reasoningCapabilities.map((item) => ({ id: item.effort, label: isZh ? item.zh : item.en, shortLabel: item.effort === "auto" ? (isZh ? "自" : "Auto") : item.effort }))}
      reasoningId={resolvedReasoningEffort}
      modelLocked={shouldLockModel}
      disabled={isResponseLoading || modelsLoading || models.length === 0}
      locale={isZh ? "zh" : "en"}
      onModelChange={(nextModelId) => {
        setSelectedModelId(nextModelId)
        persistSelectedModelId(nextModelId)
      }}
      onReasoningChange={(nextValue) => {
        const nextReasoningEffort = normalizeReasoningEffort(nextValue, {
          providerId: selectedModel?.providerId || modelProviderId,
          modelId: selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId,
        })
        setSelectedReasoningEffort(nextReasoningEffort)
        persistReasoningEffort(nextReasoningEffort)
      }}
    />
  )

  const renderSelectedAttachments = () => {
    if (attachments.length === 0 && !isPreparingAttachments) return null
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        {isPreparingAttachments ? (
          <div className="dashboard-chip inline-flex items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{isZh ? "正在解析附件" : "Parsing attachment"}</span>
          </div>
        ) : null}
        {attachments.map((attachment) => {
          const isImage = attachment.mediaType.startsWith("image/")
          return (
            <div key={attachment.id} className="dashboard-chip inline-flex max-w-[260px] items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-xs text-muted-foreground">
              {isImage ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <Paperclip className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate" title={attachment.name}>{attachment.name}</span>
              <button
                type="button"
                className="rounded-[4px] p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label={isZh ? "移除附件" : "Remove attachment"}
                onClick={() => removeAttachment(attachment.id)}
                disabled={isResponseLoading}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  const renderKnowledgeControl = () => {
    if (!knowledgeEnabled) return null

    return (
      <div className="flex items-center gap-1">
        <Popover open={knowledgePickerOpen} onOpenChange={setKnowledgePickerOpen}>
        <PopoverTrigger asChild>
          <Button
                type="button"
                size="sm"
                variant="outline"
                className="dashboard-button-secondary h-9 max-w-[220px] gap-2 px-3"
                disabled={isResponseLoading || isConversationLoading || isPreparingAttachments}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{copy.knowledgeLabel}</span>
                <span className="truncate text-muted-foreground">{knowledgeSummaryLabel}</span>
          </Button>
        </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <div className="border-b border-border px-3 py-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-[6px] border border-border bg-background px-3 py-2 text-left text-sm transition hover:border-primary/50"
                  onClick={disableKnowledge}
                >
                  <span>{copy.disableKnowledge}</span>
                </button>
                <button
                  type="button"
                  className="mt-2 flex w-full items-center justify-between rounded-[6px] px-1 py-1 text-left text-xs text-muted-foreground transition hover:text-foreground"
                  onClick={() => setSelectedKnowledgeDatasetIds([])}
                >
                  <span>{copy.knowledgeAllEnabled}</span>
                  {selectedKnowledgeDatasetIds.length === 0 ? <Check className="h-4 w-4 text-primary" /> : null}
                </button>
              </div>
              <CommandInput placeholder={copy.knowledgeSearch} />
              <CommandList>
                <CommandEmpty>{knowledgeDatasetsLoading ? copy.knowledgeLoading : copy.knowledgeEmpty}</CommandEmpty>
                <CommandGroup>
                  {knowledgeDatasets.map((dataset) => {
                    const selected = selectedKnowledgeDatasetIds.includes(dataset.id)
                    return (
                      <CommandItem
                        key={dataset.id}
                        onSelect={() => toggleKnowledgeDataset(dataset.id)}
                        className="cursor-pointer"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Database className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate text-sm">{dataset.name}</div>
                            <div className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              {dataset.category}
                            </div>
                          </div>
                        </div>
                        {selected ? <Check className="ml-2 h-4 w-4 text-primary" /> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  const renderMessageAttachments = (items: ChatAttachment[] | undefined) => {
    if (!items?.length) return null
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {items.map((attachment) => (
          <div key={attachment.id} className="dashboard-chip inline-flex max-w-[240px] items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-xs text-muted-foreground">
            {attachment.mediaType.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <Paperclip className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate" title={attachment.name}>{attachment.name}</span>
          </div>
        ))}
      </div>
    )
  }

  const renderAttachmentPicker = () => (
    <PromptInputActionMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
      <PromptInputActionMenuTrigger disabled={isResponseLoading || isConversationLoading || isPreparingAttachments} aria-label={copy.addMenu} className="composer-add">
        <Plus className="h-5 w-5" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="w-56 p-2">
        <PromptInputActionAddAttachments disabled={attachments.length >= AI_ENTRY_MAX_ATTACHMENTS} label={copy.uploadFile} />
        <PromptInputActionMenuItem onSelect={() => { setKnowledgeEnabled(true); setKnowledgePickerOpen(true) }}>
          <Database className="h-4 w-4 shrink-0" />
          <span>{copy.knowledgeAdd}</span>
        </PromptInputActionMenuItem>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  )

  if (showLanding) {
    return (
      <TooltipProvider>
        <div className="dashboard-shell flex h-full min-h-0 justify-center overflow-hidden bg-background">
          <section className="flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden px-4 pt-10 lg:px-8">
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col pb-6">
                  <div className="mx-auto max-w-4xl text-center">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-[4px] border border-border px-3 py-1">
                      <span className="public-signal" aria-hidden="true" />
                      <span className="dashboard-kicker text-muted-foreground">{workspaceKicker}</span>
                    </div>
                    <h1 className="dashboard-title text-5xl tracking-tight text-foreground lg:text-6xl">{workspaceTitle}</h1>
                    <p className="mt-4 text-lg text-muted-foreground">{resolvedRequestAgentId ? workspaceSubtitle : copy.landingHint}</p>
                  </div>

                  <div className="mx-auto mt-10 grid max-w-5xl gap-3 lg:grid-cols-3">
                    {quickPrompts.map((prompt) => (
                      <button key={prompt} type="button" className="dashboard-panel rounded-[10px] p-4 text-left transition hover:border-primary/60 hover:bg-primary/5" onClick={() => setInput(prompt)}>
                        <div className="dashboard-kicker mb-2 inline-flex items-center gap-1 text-muted-foreground">
                          <Sparkles className="h-3.5 w-3.5" />
                          {copy.quickStart}
                        </div>
                        <div className="text-sm leading-6 text-foreground">{prompt}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </div>

            <div className="sticky bottom-0 z-20 shrink-0 bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:px-0">
              <div className="dashboard-panel mx-auto max-w-5xl rounded-[12px] p-4 shadow-sm">
                <PromptInput value={input} onValueChange={setInput} onSubmit={handleSend} onAddAttachments={(files) => void handleAttachmentFiles(files)} attachments={[]} accept="image/*,.txt,.md,.docx,.pdf,.csv,.json,text/*,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" isLoading={isResponseLoading} locale={isZh ? "zh" : "en"} className="compact-ai-composer border-0 bg-transparent p-0 shadow-none">
                  {isAgentSelectionExplicit && selectedAgent ? (
                    <div className="px-1 pb-2 text-xs text-muted-foreground">
                      {copy.selectedAgent}: <span className="font-medium text-foreground">{selectedAgent.name}</span>
                    </div>
                  ) : null}
                  <PromptInputHeader>{renderSelectedAttachments()}{knowledgeEnabled ? renderKnowledgeControl() : null}</PromptInputHeader>
                  <div className="compact-ai-composer-row">
                    {renderAttachmentPicker()}
                    <PromptInputBody><PromptInputTextarea minRows={1} maxRows={3} submitMode="enter" aria-label={isZh ? "消息输入" : "Message input"} placeholder={workspacePlaceholder} className="text-base" /></PromptInputBody>
                    {renderSelectors()}
                    <PromptInputSubmit disabled={(!input.trim() && attachments.length === 0) || isConversationLoading || isPreparingAttachments || modelsLoading} />
                  </div>
                </PromptInput>
              </div>
            </div>
          </section>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="chat-canvas flex h-full min-h-0 justify-center">
        <section className="flex h-full min-h-0 w-full max-w-[1320px] flex-col overflow-hidden">
          {!embedded || !compactEmbedded ? (
            <header className="chat-page-header px-4 pt-4 lg:px-8">
              <div>
                <h1 className="chat-page-title text-foreground">{workspaceTitle}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{workspaceSubtitle}</p>
              </div>
            </header>
          ) : null}

        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div
              className={cn(
                "mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 pb-6 lg:px-6",
                embedded && compactEmbedded ? "min-h-[280px] sm:min-h-[320px]" : undefined,
              )}
            >
              {showConversationRestoreState ? <div className="dashboard-panel rounded-[10px] p-4 text-sm text-muted-foreground"><div className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{copy.restoring}</div></div> : null}

              {shouldShowEmbeddedGuide && embeddedGuideContent ? (
                <article className="message-card">
                  <div className="message-header">
                    <div className="ai-avatar">AI</div>
                    <div className="min-w-0 flex-1">
                      <div className="dashboard-kicker text-foreground">AI WORKSPACE</div>
                      <div className="message-time">{formatMessageTime(undefined, displayLocale, browserTimeZone)}</div>
                    </div>
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <MessageContent bare markdown role="assistant" className="message-body p-0">{embeddedGuideContent}</MessageContent>
                </article>
              ) : null}

              <WorkbenchMessageTimeline
                className="contents"
                locale={displayLocale}
                messages={displayMessages.map((message) => ({
                  id: message.id,
                  conversationId: conversationId ?? "new",
                  role: message.role,
                  content: message.content,
                  createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
                  sourceMessage: message,
                }))}
                renderMessage={(timelineMessage, index) => {
                const message = timelineMessage.sourceMessage
                const isAssistant = message.role === "assistant"
                const copied = copiedMessageId === message.id
                const isPendingAssistant =
                  isAssistant &&
                  isResponseLoading &&
                  index === displayMessages.length - 1 &&
                  !message.content.trim() &&
                  !message.parts?.length
                const shouldShowLoadingDetails = isPendingAssistant
                const parsedArtifact = isAssistant ? parseArtifactResult(message.content) : null
                const parsedPptPreview = isAssistant ? extractLatestPptPreviewContext(message.content) : null
                const isLastAssistantMessage =
                  isAssistant && !displayMessages.slice(index + 1).some((candidate) => candidate.role === "assistant")
                const fallbackPptPreview =
                  !parsedPptPreview &&
                  !hasMessagePptPreviewContext &&
                  isLastAssistantMessage &&
                  conversationState?.ppt?.latestPreview?.previewSessionId
                    ? {
                        previewSessionId: conversationState.ppt.latestPreview.previewSessionId,
                        defaultVariantKey: conversationState.ppt.latestPreview.defaultVariantKey ?? null,
                        variantKeys: conversationState.ppt.latestPreview.variantKeys ?? [],
                      }
                    : null
                const bodyContent = stripPptHiddenContextMarkers(parsedArtifact?.body ?? message.content)
                const hasParts = Boolean(message.parts?.length)
                const parts = hasParts ? message.parts ?? [] : []
                const hasResolvedPptPreview =
                  Boolean(parsedPptPreview) ||
                  conversationState?.ppt?.phase === "preview-ready" ||
                  conversationState?.ppt?.phase === "exported"
                const processParts = parts.filter((part) => {
                  if (part.type === "text" || part.type === "source" || part.type === "artifact" || part.type === "report") {
                    return false
                  }
                  if (hasResolvedPptPreview && part.type === "template-recommendation") {
                    return false
                  }
                  return true
                })
                const artifactParts = parts.filter((part): part is ArtifactPart => part.type === "artifact")
                const shouldHideLegacyPptPreviewArtifacts = hasResolvedPptPreview || hasMessagePptPreviewContext
                const visibleArtifactParts = shouldHideLegacyPptPreviewArtifacts
                  ? artifactParts.filter((part) => {
                      const label = `${part.title ?? ""} ${part.fileName ?? ""}`
                      return !/ppt preview|PPT 预览|PPT preview generated|lead_tool_preview_deck/iu.test(label)
                    })
                  : artifactParts
                const reportParts = parsedPptPreview ? parts.filter((part) => part.type === "report" && part.reportType !== "ppt-preview") : parts.filter((part) => part.type === "report")
                const referenceParts = parts.filter((part) => part.type === "source")
                const artifactPart = visibleArtifactParts[0] ?? null
                const shouldRenderParsedArtifactBlock = Boolean(
                  parsedArtifact && !hasParts && !parsedPptPreview && !fallbackPptPreview,
                )
                return isAssistant ? (
                  <WorkbenchCloudMessageShell
                    key={message.id}
                    role="assistant"
                    label={isZh ? "AI 回复" : "AI RESPONSE"}
                    timestamp={formatMessageTime(message.createdAt, displayLocale, browserTimeZone)}
                    footer={(bodyContent.trim() || artifactPart || parsedArtifact) ? (
                      <div className="message-actions message-feedback">
                        <button type="button" className="message-feedback-btn" title={copied ? copy.copiedReply : copy.copyReply} onClick={() => void handleCopyMessage(message.id, message.content)}>
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          <span className="sr-only"><TextMorph text={copied ? copy.copied : copy.copy} /></span>
                        </button>
                        {(() => {
                          const workHref = artifactPart?.workHref ?? parsedArtifact?.workHref ?? null
                          const downloadHref = artifactPart?.downloadUrl ?? parsedArtifact?.downloadHref ?? null
                          return <>{workHref ? <a className="message-feedback-btn" href={workHref} aria-label={isZh ? "打开作品库" : "Open in Works"}><LibraryBig className="h-4 w-4" /></a> : null}{downloadHref ? <a className="message-feedback-btn" href={downloadHref} download aria-label={isZh ? "导出" : "Export"}><Download className="h-4 w-4" /></a> : null}</>
                        })()}
                      </div>
                    ) : null}
                  >
                      {isPendingAssistant ? (
                        <div className="flex items-center gap-2 text-sm text-foreground">
                          <TypingIndicator />
                          <span>{copy.loading}</span>
                        </div>
                      ) : bodyContent ? (
                        <MessageContent bare markdown role="assistant" className="message-body assistant-body p-0">{bodyContent}</MessageContent>
                      ) : null}
                      {processParts.length ? (
                        <section className="assistant-section">
                          <MessagePartViewList
                            parts={processParts}
                            isZh={isZh}
                            className="process-list"
                            agentId={routeAgentId || resolvedRequestAgentId || null}
                          />
                        </section>
                      ) : null}
                      {shouldShowLoadingDetails ? (
                        <div className="assistant-live-panel">
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <TypingIndicator />
                            <span className="truncate">{loadingEventSummary.currentLabel}</span>
                          </div>
                          {loadingEventSummary.totalCount > 0 ? (
                            <div className="mb-2 rounded-[8px] border border-border/70 bg-background/70 px-2.5 py-2">
                              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                                <span className="truncate">{isZh ? "处理中" : "Processing"}</span>
                                <span>{`${loadingEventSummary.completedCount}/${loadingEventSummary.totalCount}`}</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary transition-all duration-300"
                                  style={{ width: `${loadingEventSummary.progressPercent}%` }}
                                />
                              </div>
                            </div>
                          ) : null}
                          <WorkspaceTaskEvents events={pendingTaskEvents} limit={4} className="pl-0" />
                        </div>
                      ) : null}
                      {((visibleArtifactParts.length > 0) || reportParts.length > 0 || Boolean(parsedPptPreview) || Boolean(fallbackPptPreview) || shouldRenderParsedArtifactBlock) ? (
                        <section className="assistant-section">
                          <div className="artifact-section-title">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            <span>{isZh ? "生成产物" : "Generated artifacts"}</span>
                          </div>
                          <div className="artifact-grid">
                            {parsedPptPreview || fallbackPptPreview ? (
                              <PptPreviewReportCard
                                previewSessionId={(parsedPptPreview ?? fallbackPptPreview)!.previewSessionId}
                                defaultVariantKey={(parsedPptPreview ?? fallbackPptPreview)!.defaultVariantKey}
                                variantKeys={(parsedPptPreview ?? fallbackPptPreview)!.variantKeys}
                                isZh={isZh}
                                agentId={routeAgentId || resolvedRequestAgentId || null}
                              />
                            ) : null}
                            {visibleArtifactParts.length ? (
                              <MessagePartViewList
                                parts={visibleArtifactParts}
                                isZh={isZh}
                                className="space-y-0"
                                agentId={routeAgentId || resolvedRequestAgentId || null}
                              />
                            ) : null}
                            {reportParts.length ? (
                              <MessagePartViewList
                                parts={reportParts}
                                isZh={isZh}
                                className="space-y-3"
                                agentId={routeAgentId || resolvedRequestAgentId || null}
                              />
                            ) : null}
                            {shouldRenderParsedArtifactBlock ? <ArtifactResultBlock artifact={parsedArtifact!} /> : null}
                          </div>
                        </section>
                      ) : null}
                      {referenceParts.length ? (
                        <section className="assistant-section">
                          <MessagePartViewList
                            parts={referenceParts}
                            isZh={isZh}
                            className="space-y-0"
                            agentId={routeAgentId || resolvedRequestAgentId || null}
                          />
                        </section>
                      ) : null}
                  </WorkbenchCloudMessageShell>
                ) : (
                  <WorkbenchCloudMessageShell key={message.id} role="user" label={isZh ? "你的指令" : "Your Command"} timestamp={formatMessageTime(message.createdAt, displayLocale, browserTimeZone)} attachments={renderMessageAttachments(message.attachments)}>
                    <MessageContent bare role="user" className="p-0 text-sm leading-7 text-white">{message.content}</MessageContent>
                  </WorkbenchCloudMessageShell>
                )
              }} />

              {errorMessage ? <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{errorMessage}</div> : null}
              <div ref={scrollAnchorRef} className="h-px w-full shrink-0 scroll-mt-4" aria-hidden="true" />
            </div>
          </ScrollArea>
        </div>

        <div className="sticky bottom-0 z-20 shrink-0 bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:px-6">
          <div className="chat-composer mx-auto">
            {!isConversationLoading && messages.length === 0 ? (
              <div className="mb-2">
                <div className="flex flex-wrap gap-2">
                  {composerPromptButtons.map((prompt) => (
                    <button key={prompt} type="button" className="dashboard-chip max-w-[260px] truncate rounded-[4px] px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary" title={prompt} onClick={() => setInput(prompt)} disabled={isResponseLoading}>{prompt}</button>
                  ))}
                </div>
              </div>
            ) : null}

            {!compactEmbedded && (composerLinkActions.length > 0 || composerContextChips.length > 0) ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {composerLinkActions.map((action) => (
                  <Button
                    key={`${action.href}:${action.label}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-[6px] px-3 text-xs"
                    onClick={() => workspaceNavigation.go(action.href)}
                  >
                    {action.label}
                    <ArrowRight className="ml-1.5 h-3 w-3" />
                  </Button>
                ))}
                {composerContextChips.map((chip) => (
                  <span
                    key={chip}
                    className="dashboard-chip inline-flex items-center rounded-[4px] px-3 py-1.5 text-[11px] text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}

            <PromptInput
              value={input}
              onValueChange={setInput}
              onSubmit={handleSend}
              onAddAttachments={(files) => void handleAttachmentFiles(files)}
              attachments={[]}
              accept="image/*,.txt,.md,.docx,.pdf,.csv,.json,text/*,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              isLoading={isResponseLoading}
              locale={isZh ? "zh" : "en"}
              className="compact-ai-composer border-0 bg-transparent p-0 shadow-none"
            >
              {isAgentSelectionExplicit && selectedAgent ? (
                <div className="px-1 pb-2 text-xs text-muted-foreground">
                  {copy.selectedAgent}: <span className="font-medium text-foreground">{selectedAgent.name}</span>
                  {selectedAgentId?.startsWith("business-") && !sessionReady ? (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">
                      {sessionReadyError || (isZh ? "正在预热会话…" : "Warming up session…")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <PromptInputHeader>{renderSelectedAttachments()}{knowledgeEnabled ? renderKnowledgeControl() : null}</PromptInputHeader>
              <div className="compact-ai-composer-row">
                {renderAttachmentPicker()}
                <PromptInputBody><PromptInputTextarea minRows={1} maxRows={3} submitMode="enter" aria-label={isZh ? "消息输入" : "Message input"} placeholder={workspacePlaceholder} className="composer-input" /></PromptInputBody>
                {renderSelectors()}
                <PromptInputSubmit disabled={(!input.trim() && attachments.length === 0) || isConversationLoading || isPreparingAttachments || modelsLoading || (selectedAgentId?.startsWith("business-") === true && !sessionReady && !sessionReadyError)} />
              </div>
            </PromptInput>
          </div>
        </div>
        </section>
      </div>
    </TooltipProvider>
  )
}
