import { createContext, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SetStateAction } from "react";
import { Copy as CopyIcon, Eye, FileText, ImagePlus, Maximize2, Trash2 } from "lucide-react";
import { AudioPlayer, Image, MessageResponse, Queue, Suggestion, Suggestions, buildOnlineAgentGroups, formatWorkbenchModelLabel, getWorkbenchTaskStatusLabel, isWorkbenchTaskActive, isWorkbenchTaskRetryable, normalizeWorkbenchTaskStatus, resolveWorkbenchMediaFeature, workbenchSessionScope, WORKBENCH_HOME_COPY, WORKBENCH_HOME_GROUPS, WORKBENCH_MEDIA_FEATURES, WORKBENCH_MESSAGE_FRAME, WORKBENCH_ROUTE_MANIFEST, WORKBENCH_THEME, WORKBENCH_WRITER_CONTENT_TYPES, WORKBENCH_WRITER_LANGUAGES, WORKBENCH_WRITER_MODES, WORKBENCH_WRITER_PLATFORMS, WORKBENCH_WRITER_QUICK_PROMPTS, WORKFLOW_PALETTE_DRAG_EVENT, WORKFLOW_PALETTE_DROP_EVENT, WorkbenchAgentDirectory, WorkbenchCapabilityCenter, WorkbenchMessageSurface, WorkbenchPromptInput, WorkbenchRouteIcon, WorkbenchShell, WorkbenchTask, WorkbenchWorkflowCanvas, WorkbenchWorkflowDirectory, WorkbenchWorkflowParameterFields, type WorkbenchAgentDirectoryGroup, type WorkbenchCapabilityCenterGroup, type WorkbenchMediaFeatureId, type WorkbenchWorkflowDirectoryAction, type WorkbenchWorkflowDirectoryRun, type WorkbenchWorkflowDirectoryTemplate, type WorkbenchWorkflowDirectoryWorkflow } from "@coworkany/workbench-ui";
import { MessageAction } from "@coworkany/workbench-ui";
import type { WorkbenchArtifactSource, WorkbenchMediaSource, WorkflowCanvasExecutionSnapshot } from "@coworkany/workbench-ui";
import { createUniqueWorkflowNodeKey, repairWorkflowNodeKeys } from "./workflow-node-keys";
import { applyWorkflowNodeEvent, createWorkflowNodeSnapshots, finalizeWorkflowNodeSnapshots } from "./workflow-node-status";
import { localFileUploadErrorCode, persistLocalFile } from "./local-file-upload";
import { areWorkflowPortsCompatible, hashWorkflowDefinition, validateWorkflowDefinition, workflowNodeRegistry, type WorkflowDefinitionEnvelope, type WorkflowDefinitionNodeV2 } from "@coworkany/workflow-core";
import { applyDesktopUIMessageRunEventToParts as applyWorkbenchRunEventToParts, createDesktopUIMessage, desktopUIMessageText, parseDesktopUIMessage } from "@coworkany/workbench-client";
import type { DesktopArtifactData, DesktopMediaData, DesktopUIMessage, DesktopUIMessagePart, WorkbenchArtifact, WorkbenchKnowledgeResult, WorkbenchRun, WorkbenchRunDetail, WorkbenchWorkflow } from "@coworkany/workbench-client";
import type { ChatTransport } from "ai";
import { isTauriBridgeAvailable, tauriBridge } from "./tauri";
import { createDesktopChatTransport, createDesktopWorkbenchClient } from "./workbench-client";
import { useDesktopChat } from "./use-desktop-chat";
import { buildAgencyAgentGroups } from "./agency-agent-catalog";
import { closeDesktopMediaTab, createDesktopMediaTab, openDesktopMediaTab, syncDesktopMediaTabModel, type DesktopMediaTabState } from "./media-tabs";
import { PROVIDER_PLATFORM_OPTIONS, platformIdForProvider, providerPlatformForId } from "./provider-platforms";
import { capabilityEnglish, desktopCopy, desktopWriterCopy, homeGroupLabels, mediaEnglish, mediaFieldEnglish, mediaOptionEnglish, mediaPlaceholderEnglish, mediaSubmitEnglish, mediaSummaryEnglish, quickPromptsForDesktopRoute, resolveDesktopLocale, workflowActionEnglish, writerContentTypeEnglish, writerLanguageEnglish, writerModeEnglish, writerPlatformEnglish, type DesktopLocalePreference } from "./i18n";
import { capabilityForWorkflowAction, configuredModelOptions, configuredProviderEntries, isDevelopmentRunningHubWorkflowId, isMediaProviderConfigured, modelOptionsForProvider, preferredConfiguredModel, providerForCapability, providerForId, requiresConfiguredProviderForWorkflowAction, supportsProviderCapability, type DesktopProviderConfig, type DesktopProviderDefaults, type DesktopProviderProfiles, type ProviderCapability } from "./provider-config";
import { bindWorkflowProviderDefaults, isMediaWorkflowNodeType } from "./workflow-provider-binding";
import { applyConfiguredMediaModels } from "./media-model-options";
import { buildDesktopImageRunInput, getDesktopImageParameterSchema, normalizeDesktopImageSettings, resolveDesktopImageModelKind } from "./image-model-parameters";
import { createSessionRecoverySnapshot } from "./session-recovery";
import { hashWorkflowPresentation, sanitizeWorkflowDefinitionForStorage } from "./workflow-storage";
import { parseWorkflowImportText, serializeWorkflowExport } from "./workflow-portability";
import { resolveDesktopRunAction, workflowActionForMediaFeature } from "./route-actions";
import { resolveVideoMediaCapabilities, supportsVideoMediaRole } from "../runtime/media-capabilities";
import type { MiniMaxVoiceOption } from "@coworkany/media-runtime";
import { buildConversationTitleFromPrompt, defaultConversationTitle, resolveConversationTitleUpdate } from "./conversation-title";
import { mergeConversationMessages, mergeDesktopUIMessageViews } from "./conversation-history";
import { writerImageArtifactsForArticle } from "./writer-preview";
import { replayPersistedRunToConversationMessage } from "./conversation-run-replay";
import { WorkflowOutputPreview } from "./workflow-output-view";
import { createRunningHubWorkflowRegistration, migrateLegacyRunningHubWorkflows, parseRunningHubWorkflowJson, runningHubWorkflowIdFromUrl, type RunningHubWorkflowCapability, type RunningHubWorkflowRegistration } from "./runninghub-workflow";
import { promptRequestsArtifact } from "./artifact-intent";
import { filterAssetLibraryItems, type AssetLibraryTab } from "./asset-library-filter";
import { ConversationMemoryCache } from "./conversation-cache";
import { NativeQuestions } from "./native-questions";
import { NativeRunQuestions } from "./native-run-questions";
import { isWorkbenchQuestionToolEvent } from "@coworkany/workbench-client";
import { questionConversationForRoute, questionSessionIdForRoute } from "./question-session-route";
import { isCurrentWorkflowRestore, type WorkflowRestoreToken } from "./workflow-restore-guard";
import { canRunImageWorkflow, shouldRepairRuntime } from "../runtime/runtime-gate";
import { ImageMaskEditor } from "./image-mask-editor";

function escapeWriterHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character).replace(/\r?\n/g, "<br />");
}

function createDesktopChatUserMessage(input: {
  readonly conversationId: string;
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly route: string;
}): DesktopUIMessage {
  const message = createDesktopUIMessage({
    id: `message-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    role: "user",
    conversationId: input.conversationId,
    content: input.text,
    providerId: input.providerId,
    modelId: input.modelId,
    route: input.route,
    capability: "text",
    createdAt: new Date().toISOString(),
  });
  const createdAt = message.metadata?.createdAt ?? new Date().toISOString();
  return { ...message, metadata: { conversationId: input.conversationId, ...(message.metadata ?? {}), createdAt, updatedAt: message.metadata?.updatedAt ?? createdAt, modelLocked: true } };
}

async function copyWriterContent(text: string, html?: string) {
  const normalized = text.trim();
  if (!normalized) return false;
  const clipboard = navigator.clipboard;
  if (html && clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await clipboard.write([new ClipboardItem({
        "text/plain": new Blob([normalized], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return true;
    } catch { /* fall back to text-only clipboard access below */ }
  }
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(normalized);
      return true;
    } catch { /* fall back to the legacy document command below */ }
  }
  const textarea = document.createElement("textarea");
  textarea.value = normalized;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

const workbenchThemeStyle = {
  "--background": WORKBENCH_THEME.light.background,
  "--foreground": WORKBENCH_THEME.light.foreground,
  "--card": WORKBENCH_THEME.light.card,
  "--card-foreground": WORKBENCH_THEME.light.cardForeground,
  "--popover": WORKBENCH_THEME.light.popover,
  "--popover-foreground": WORKBENCH_THEME.light.popoverForeground,
  "--primary": WORKBENCH_THEME.light.primary,
  "--primary-foreground": WORKBENCH_THEME.light.primaryForeground,
  "--secondary": WORKBENCH_THEME.light.secondary,
  "--secondary-foreground": WORKBENCH_THEME.light.secondaryForeground,
  "--muted": WORKBENCH_THEME.light.muted,
  "--muted-foreground": WORKBENCH_THEME.light.mutedForeground,
  "--accent": WORKBENCH_THEME.light.accent,
  "--accent-foreground": WORKBENCH_THEME.light.accentForeground,
  "--destructive": WORKBENCH_THEME.light.destructive,
  "--destructive-foreground": WORKBENCH_THEME.light.destructiveForeground,
  "--border": WORKBENCH_THEME.light.border,
  "--input": WORKBENCH_THEME.light.input,
  "--input-background": WORKBENCH_THEME.light.inputBackground,
  "--ring": WORKBENCH_THEME.light.ring,
  "--chart-1": WORKBENCH_THEME.light.chart1,
  "--chart-2": WORKBENCH_THEME.light.chart2,
  "--chart-3": WORKBENCH_THEME.light.chart3,
  "--chart-4": WORKBENCH_THEME.light.chart4,
  "--chart-5": WORKBENCH_THEME.light.chart5,
  "--radius": WORKBENCH_THEME.light.radius,
  "--sidebar": WORKBENCH_THEME.light.sidebar,
  "--sidebar-foreground": WORKBENCH_THEME.light.sidebarForeground,
  "--sidebar-primary": WORKBENCH_THEME.light.sidebarPrimary,
  "--sidebar-primary-foreground": WORKBENCH_THEME.light.sidebarPrimaryForeground,
  "--sidebar-accent": WORKBENCH_THEME.light.sidebarAccent,
  "--sidebar-accent-foreground": WORKBENCH_THEME.light.sidebarAccentForeground,
  "--sidebar-border": WORKBENCH_THEME.light.sidebarBorder,
  "--sidebar-ring": WORKBENCH_THEME.light.sidebarRing,
  "--grid-line": WORKBENCH_THEME.light.gridLine,
  "--dashboard-grid-line": WORKBENCH_THEME.light.dashboardGridLine,
  "--wb-background": WORKBENCH_THEME.light.background,
  "--wb-foreground": WORKBENCH_THEME.light.foreground,
  "--wb-card": WORKBENCH_THEME.light.card,
  "--wb-card-foreground": WORKBENCH_THEME.light.cardForeground,
  "--wb-popover": WORKBENCH_THEME.light.popover,
  "--wb-popover-foreground": WORKBENCH_THEME.light.popoverForeground,
  "--wb-primary": WORKBENCH_THEME.light.primary,
  "--wb-brand-yellow": WORKBENCH_THEME.light.brandYellow,
  "--wb-primary-foreground": WORKBENCH_THEME.light.primaryForeground,
  "--wb-secondary": WORKBENCH_THEME.light.secondary,
  "--wb-secondary-foreground": WORKBENCH_THEME.light.secondaryForeground,
  "--wb-muted": WORKBENCH_THEME.light.muted,
  "--wb-muted-foreground": WORKBENCH_THEME.light.mutedForeground,
  "--wb-accent": WORKBENCH_THEME.light.accent,
  "--wb-accent-foreground": WORKBENCH_THEME.light.accentForeground,
  "--wb-destructive": WORKBENCH_THEME.light.destructive,
  "--wb-destructive-foreground": WORKBENCH_THEME.light.destructiveForeground,
  "--wb-border": WORKBENCH_THEME.light.border,
  "--wb-input": WORKBENCH_THEME.light.input,
  "--wb-input-background": WORKBENCH_THEME.light.inputBackground,
  "--wb-ring": WORKBENCH_THEME.light.ring,
  "--wb-chart-1": WORKBENCH_THEME.light.chart1,
  "--wb-chart-2": WORKBENCH_THEME.light.chart2,
  "--wb-chart-3": WORKBENCH_THEME.light.chart3,
  "--wb-chart-4": WORKBENCH_THEME.light.chart4,
  "--wb-chart-5": WORKBENCH_THEME.light.chart5,
  "--wb-radius": WORKBENCH_THEME.light.radius,
  "--wb-sidebar": WORKBENCH_THEME.light.sidebar,
  "--wb-sidebar-foreground": WORKBENCH_THEME.light.sidebarForeground,
  "--wb-sidebar-primary": WORKBENCH_THEME.light.sidebarPrimary,
  "--wb-sidebar-primary-foreground": WORKBENCH_THEME.light.sidebarPrimaryForeground,
  "--wb-sidebar-accent": WORKBENCH_THEME.light.sidebarAccent,
  "--wb-sidebar-accent-foreground": WORKBENCH_THEME.light.sidebarAccentForeground,
  "--wb-sidebar-border": WORKBENCH_THEME.light.sidebarBorder,
  "--wb-sidebar-ring": WORKBENCH_THEME.light.sidebarRing,
  "--wb-sidebar-highlight": WORKBENCH_THEME.light.sidebarPrimary,
  "--wb-grid-line": WORKBENCH_THEME.light.gridLine,
  "--wb-dashboard-grid-line": WORKBENCH_THEME.light.dashboardGridLine,
  "--wb-body-font": `var(--desktop-body-font, ${WORKBENCH_THEME.typography.body})`,
  "--wb-display-font": `var(--desktop-display-font, ${WORKBENCH_THEME.typography.display})`,
  "--wb-message-max-width": WORKBENCH_MESSAGE_FRAME.maxWidth,
  "--wb-message-padding": WORKBENCH_MESSAGE_FRAME.rowPadding,
  "--wb-message-gap": WORKBENCH_MESSAGE_FRAME.gap,
  "--wb-message-avatar-size": WORKBENCH_MESSAGE_FRAME.avatarSize,
  "--wb-message-avatar-radius": WORKBENCH_MESSAGE_FRAME.avatarRadius,
} as CSSProperties;

type WorkspaceMode = "home" | "chat" | "writer" | "workflow" | "library";
type SkillId = string;
type WorkflowAction = "upload" | "text_input" | "file_create" | "writer" | "llm_generate" | "agent_execute" | "ppt_generate" | "image_generate" | "video_generate" | "digital_human" | "music_generate" | "voice_synthesis" | "voice_clone" | "audio_generate" | "video_process" | "audio_process" | "knowledge_retrieve" | "knowledge_write" | "product_store" | "foreach" | "collect" | "output";
type MediaFeatureId = WorkbenchMediaFeatureId;
type EmbeddingConfig = { mode: "local" | "remote"; baseUrl?: string; model?: string; apiKey?: string };
type DesktopConfig = { schemaVersion: 1; locale?: DesktopLocalePreference; workspacePath: string; obsidianVaultPath?: string; obsidianIndexPath?: string; embedding?: EmbeddingConfig; provider: DesktopProviderConfig & { model: string; skillId?: SkillId }; providers?: DesktopProviderProfiles; defaults?: DesktopProviderDefaults; menuAgentIds?: string[]; runtime: { source: "system" | "private"; nodePath?: string; opencodePath?: string; pythonPath?: string; hostPath?: string; skillsPath?: string; fontsPath?: string; lancedbPath?: string; embeddingPath?: string }; offlineRuntimeZipPath?: string };
type RuntimeProbe = {
  ready: boolean;
  development?: boolean;
  node?: boolean;
  opencode?: boolean;
  python?: boolean;
  host?: boolean;
  knowledge?: boolean;
  skills?: boolean;
  fonts?: boolean;
  lancedb?: boolean;
  embedding?: boolean;
  media?: boolean;
  migrations?: boolean;
  paths?: { node?: string; opencode?: string; python?: string; host?: string; skills?: string; fonts?: string; lancedb?: string; embedding?: string };
};

export function runtimeRepairOptions(config: Pick<DesktopConfig, "offlineRuntimeZipPath"> | null | undefined) {
  const offlineZip = config?.offlineRuntimeZipPath?.trim();
  return offlineZip ? { options: { offlineZip } } : undefined;
}

function runtimeRepairFailure(runtime: RuntimeProbe) {
  if (runtime.ready) return null;
  const components = ["node", "opencode", "python", "host", "knowledge", "skills", "fonts", "lancedb", "embedding", "media", "migrations"] as const;
  const missing = components.filter((component) => runtime[component] === false);
  return new Error(missing.length ? `runtime_repair_incomplete:${missing.join(",")}` : "runtime_repair_incomplete");
}
let activeMediaProviderConfigured = false;
let openWorkflowProviderSettings = () => undefined;
let desktopVoiceLoader: (() => Promise<readonly MiniMaxVoiceOption[]>) | undefined;
const localizedRunStatus = "";
const canContinue = false;
function embeddingPayload(config: DesktopConfig): EmbeddingConfig {
  return config.embedding?.mode === "remote"
    ? { mode: "remote", baseUrl: config.embedding.baseUrl, model: config.embedding.model, apiKey: config.embedding.apiKey }
    : { mode: "local", baseUrl: "http://127.0.0.1:11434", model: "nomic-embed-text" };
}
type SavedWorkflow = { id: string; name: string; definition_json: string; updated_at: string };
type WorkflowStatus = "draft" | "live" | "archived";
type WorkflowMetadata = { title: string; description: string; status: WorkflowStatus };
type ArtifactRow = { id: string; relative_path: string; mime_type: string; byte_length: number; sha256: string; created_at: string; available?: boolean };
type LocalMediaPreview = { mimeType: string; data: number[] };
type RunRow = { id: string; conversation_id?: string | null; status: string; model?: string | null; started_at: string; finished_at?: string | null };
type RunDetail = { run: RunRow; nodes: Array<{ node_key: string; status: string; output_json?: string | null; updated_at: string }>; events: Array<{ sequence: number; event_type: string; payload_json: string; created_at: string }>; usage: Array<{ provider?: string | null; model: string; input_tokens?: number | null; output_tokens?: number | null; provider_cost?: number | null; estimated_cost?: number | null; created_at: string }> };
type DesktopImageGenerationParameterValue = string | number | boolean;
type DesktopImageGenerationMetadata = { prompt: string; parameters: Readonly<Record<string, DesktopImageGenerationParameterValue>> };
type DesktopTaskMetadata = {
  kind: "workflow" | "media" | "agent";
  featureId?: string;
  entryPath?: string;
  imageGeneration?: DesktopImageGenerationMetadata;
  workflowId?: string;
  workflowTitle?: string;
  definitionHash?: string;
  workflowDefinition?: WorkflowDefinitionEnvelope;
};

function buildDesktopImageGenerationMetadata(prompt: string, inputs?: Record<string, unknown>): DesktopImageGenerationMetadata {
  const parameters: Record<string, DesktopImageGenerationParameterValue> = {};
  let referenceImageCount = 0;
  for (const [key, value] of Object.entries(inputs ?? {})) {
    if (key === "response_format" || key === "responseFormat") continue;
    if (key === "referenceImages" || key === "localAttachments") {
      const count = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).length
        : typeof value === "string"
          ? value.split(",").map((item) => item.trim()).filter(Boolean).length
          : 0;
      referenceImageCount = Math.max(referenceImageCount, count);
      continue;
    }
    if (key === "inputImageUrl") {
      if (value) parameters.inputImageProvided = true;
      continue;
    }
    if (key === "maskImageUrl") {
      if (value) parameters.maskImageProvided = true;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") parameters[key] = value;
  }
  if (referenceImageCount > 0) parameters.referenceImageCount = referenceImageCount;
  return { prompt: prompt.trim(), parameters };
}

function readDesktopImageGenerationMetadata(value: unknown): DesktopImageGenerationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const parameters = raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters)
    ? Object.fromEntries(Object.entries(raw.parameters as Record<string, unknown>).filter(([key, item]) => key !== "response_format" && key !== "responseFormat" && (typeof item === "string" || typeof item === "number" || typeof item === "boolean"))) as Record<string, DesktopImageGenerationParameterValue>
    : {};
  return prompt || Object.keys(parameters).length ? { prompt, parameters } : undefined;
}

async function resolveDesktopMediaSource(media: DesktopMediaData): Promise<WorkbenchMediaSource | null> {
  if (!media.relativePath) return null;
  if (!isTauriBridgeAvailable()) return media.relativePath;
  const payload = await tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath: media.relativePath, mimeType: media.mimeType });
  const url = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType || media.mimeType }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

function isTextArtifact(mimeType: string, relativePath: string) {
  const normalizedMime = mimeType.toLowerCase().split(";", 1)[0] ?? "";
  const extension = relativePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return normalizedMime.startsWith("text/") || ["md", "markdown", "mdown", "json", "csv", "tsv", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css"].includes(extension);
}

async function resolveDesktopArtifactSource(artifact: DesktopArtifactData): Promise<WorkbenchArtifactSource | null> {
  if (!artifact.relativePath) return null;
  if (!isTauriBridgeAvailable()) return { url: artifact.relativePath };
  const payload = await tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath: artifact.relativePath, mimeType: artifact.mimeType });
  const bytes = new Uint8Array(payload.data);
  const mimeType = payload.mimeType || artifact.mimeType;
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  return {
    url,
    mimeType,
    text: isTextArtifact(mimeType, artifact.relativePath) ? new TextDecoder().decode(bytes) : undefined,
    revoke: () => URL.revokeObjectURL(url),
  };
}

type WorkflowRetryState = { completed: Record<string, Record<string, unknown>>; recoveryDefinitionHash: string };
type WorkflowRunTracking = {
  runId: string;
  workflowKey: string;
  snapshots: WorkflowCanvasExecutionSnapshot[];
  status: string;
};
type KnowledgeResult = WorkbenchKnowledgeResult;
type DesktopConversationMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly runId?: string;
  readonly status?: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";
  readonly parts?: readonly DesktopUIMessagePart[];
};
const CONVERSATION_PAGE_SIZE = 10;
type ConversationHistoryCursor = { readonly createdAt: string; readonly id: string };
type DesktopConversationSummary = { id: string; title: string; updated_at: string; opencode_session_id?: string | null; agent_id?: string | null };
type LocalAttachment = { id: string; name: string; size: number; mediaType: string; relativePath?: string; previewUrl?: string; text?: string; textCharCount?: number; truncated?: boolean; status?: "queued" | "uploading" | "ready" | "failed"; error?: string };
type WorkflowLocalFile = { fileName: string; mimeType: string; byteLength: number; localPath?: string; relativePath?: string };

type DesktopMediaHistoryContextValue = {
  scope: string | null;
  conversationId: string | null;
  prompt: string;
  promptAt?: string;
  messages: readonly DesktopConversationMessage[];
  artifacts: readonly ArtifactRow[];
  runs: readonly RunRow[];
  runMetadataById: ReadonlyMap<string, DesktopTaskMetadata | null>;
};

const DesktopMediaHistoryContext = createContext<DesktopMediaHistoryContextValue | null>(null);

function mediaArtifactsForConversation(history: DesktopMediaHistoryContextValue | null): ArtifactRow[] {
  if (!history || history.scope !== "entry:image-assistant" || !history.conversationId) return [];
  const artifactIds = new Set(
    history.messages.flatMap((message) => (message.parts ?? []).filter((part): part is Extract<DesktopUIMessagePart, { type: "data-artifact" }> => part.type === "data-artifact").map((part) => part.data.id)),
  );
  const runIds = new Set(history.runs.filter((run) => run.conversation_id === history.conversationId).map((run) => run.id));
  return history.artifacts.filter((artifact) => artifactIds.has(artifact.id) || [...runIds].some((runId) => artifact.id.startsWith(`${runId}:`)));
}

function desktopConversationMessageToUIMessage(message: DesktopConversationMessage): DesktopUIMessage {
  const base = createDesktopUIMessage({ id: message.id, role: message.role, conversationId: message.conversationId, content: message.content, createdAt: message.createdAt });
  const inferredRunId = message.role === "user" && message.id.startsWith("message-") ? message.id.slice("message-".length) : message.role === "assistant" && message.id.startsWith("assistant-") ? message.id.slice("assistant-".length) : undefined;
  const metadata = { conversationId: message.conversationId, createdAt: message.createdAt, updatedAt: message.createdAt, ...(message.runId ?? inferredRunId ? { runId: message.runId ?? inferredRunId } : {}), ...(message.status ? { runStatus: message.status === "succeeded" ? "completed" as const : message.status === "interrupted" ? "cancelled" as const : message.status } : {}) };
  return parseDesktopUIMessage({ id: base.id, role: base.role, parts: message.parts?.length ? message.parts : base.parts, metadata });
}

function desktopUIMessageToConversationMessage(message: DesktopUIMessage): DesktopConversationMessage {
  const runStatus = message.metadata?.runStatus;
  return {
    id: message.id,
    conversationId: message.metadata?.conversationId ?? "",
    role: message.role === "user" ? "user" : "assistant",
    content: desktopUIMessageText(message),
    createdAt: message.metadata?.createdAt ?? new Date().toISOString(),
    status: runStatus === "completed" ? "succeeded" : runStatus,
    parts: message.parts,
  };
}

type LocalSkillCatalog = { schemaVersion: 1; skills: Array<{ id: string; relativePath: string }> };

type DesktopRoute = { path: string; label: string; description: string; mode: WorkspaceMode; section?: string; glyph?: string; iconKey?: string; placement?: "main" | "footer" | "hidden"; conversationLoading?: boolean };

const LOCAL_ATTACHMENT_MAX_TEXT_CHARS = 80_000;

function isTextAttachment(file: File) {
  return file.type.startsWith("text/") || file.type.includes("json") || file.type.includes("csv") || /\.(txt|md|csv|json)$/iu.test(file.name);
}

function toSavedWorkflow(workflow: WorkbenchWorkflow): SavedWorkflow {
  return { id: workflow.id, name: workflow.title, definition_json: JSON.stringify(workflow.definition), updated_at: workflow.updatedAt };
}

function parseSavedWorkflowDefinition(workflow: SavedWorkflow): WorkflowDefinitionEnvelope | null {
  try {
    const definition: unknown = JSON.parse(workflow.definition_json);
    return isWorkflowDefinition(definition) ? definition : null;
  } catch {
    return null;
  }
}

function toArtifactRow(artifact: WorkbenchArtifact): ArtifactRow {
  return { id: artifact.id, relative_path: artifact.relativePath, mime_type: artifact.mimeType, byte_length: artifact.byteLength, sha256: artifact.sha256, created_at: artifact.createdAt ?? new Date(0).toISOString(), available: artifact.available };
}

function toRunRow(run: WorkbenchRun): RunRow {
  return { id: run.id, conversation_id: run.conversationId || null, status: run.status, model: run.model ?? null, started_at: run.startedAt, finished_at: run.finishedAt ?? null };
}

function toRunDetail(detail: WorkbenchRunDetail): RunDetail {
  return {
    run: toRunRow(detail.run),
    nodes: detail.nodes.map((node) => ({ node_key: node.nodeKey, status: node.status, output_json: node.outputJson, updated_at: node.updatedAt })),
    events: detail.events.map((event) => ({ sequence: event.sequence, event_type: event.eventType, payload_json: event.payloadJson, created_at: event.createdAt })),
    usage: detail.usage.map((item) => ({ provider: item.provider, model: item.model, input_tokens: item.inputTokens, output_tokens: item.outputTokens, provider_cost: item.providerCost, estimated_cost: item.estimatedCost, created_at: item.createdAt })),
  };
}

const mediaFeatureCatalog = WORKBENCH_MEDIA_FEATURES;

function formatDateTime(value: string | undefined, locale: "zh" | "en") {
  if (!value) return "";
  return new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

function ModelControls({
  model,
  models,
  providerSource,
  reasoningEffort,
  skillId,
  onModelChange,
  onReasoningChange,
  onSkillChange,
  showSkill = true,
  hideModel = false,
  locale = "zh",
}: {
  model: string;
  models?: readonly string[];
  providerSource?: string;
  reasoningEffort: string;
  skillId: SkillId;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  showSkill?: boolean;
  hideModel?: boolean;
  locale?: "zh" | "en";
}) {
  const activeLocale = locale === "zh" && typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : locale;
  const copy = activeLocale === "en" ? { aria: "Model and reasoning settings", automatic: "Auto", writing: "Content writing", analysis: "Marketing analysis", model: showSkill ? "Model" : "Standard", skill: "Skill", reasoning: "Reasoning", unconfigured: "Model not configured", low: "Low", medium: "Medium", high: "High" } : { aria: "模型与推理设置", automatic: "自动", writing: "内容写作", analysis: "营销分析", model: showSkill ? "模型" : "标准", skill: "Skill", reasoning: "推理", unconfigured: "未配置模型", low: "低", medium: "中", high: "高" };
  const providerLabel = providerSource && providerSource !== "local" ? providerSource : formatWorkbenchModelLabel(model, { zh: "本地模型", en: "Local model" }, activeLocale);
  const configuredModels = configuredModelOptions({ model, models });
  const modelOptions = configuredModels.length ? configuredModels : (model ? [model] : []);
  return <div className="model-controls" aria-label={copy.aria}>
    {showSkill ? <label className="model-select-control"><span>{copy.skill}</span><select value={skillId} onChange={(event) => onSkillChange(event.target.value as SkillId)}><option value="auto">{copy.automatic}</option><option value="writer-orchestrator">{copy.writing}</option><option value="content-analyzer">{copy.analysis}</option><option value="ppt-master">ppt-master</option><option value="dashi-ppt">dashi-ppt</option><option value="khazix-writer">khazix-writer</option></select></label> : null}
    {!hideModel ? <label className="model-select-control"><span>{copy.model}</span><select value={model} onChange={(event) => onModelChange(event.target.value)}>{modelOptions.length ? modelOptions.map((option) => <option key={option} value={option}>{showSkill ? option : formatWorkbenchModelLabel(option, { zh: "本地模型", en: "Local model" }, activeLocale)}</option>) : <option value="">{showSkill ? copy.unconfigured : providerLabel}</option>}</select></label> : null}
    <label className="model-select-control"><span>{copy.reasoning}</span><select value={reasoningEffort} onChange={(event) => onReasoningChange(event.target.value)}><option value="auto">{copy.automatic}</option><option value="low">{copy.low}</option><option value="medium">{copy.medium}</option><option value="high">{copy.high}</option></select></label>
  </div>;
}

const routeIconKeys: Record<string, string> = {
  "/dashboard": "home",
  "/dashboard/ai": "chat",
  "/dashboard/ai?entry=consulting-advisor": "advisor",
  "/dashboard/ai?agent=executive-brand&entry=consulting-advisor": "advisor",
  "/dashboard/ai?agent=executive-growth&entry=consulting-advisor": "advisor",
  "/dashboard/ai?agent=executive-ppt": "ppt",
  "/dashboard/ai?agent=executive-presentation-ppt": "ppt",
  "/dashboard/writer": "writer",
  "/dashboard/image-assistant": "image",
  "/dashboard/capabilities": "capability",
  "/dashboard/workflows": "workflow",
  "/dashboard/tasks": "task",
  "/dashboard/assets": "asset",
  "/dashboard/works": "asset",
  "/dashboard/knowledge-base": "knowledge",
  "/dashboard/video": "video",
  "/dashboard/settings": "settings",
};

function RouteIcon({ name, size = 16 }: { name?: string; size?: number }) {
  return <WorkbenchRouteIcon name={name} size={size} />;
}

function buildRoutes(locale: "zh" | "en"): DesktopRoute[] {
  return WORKBENCH_ROUTE_MANIFEST.map((route) => ({ path: route.path, label: route.label[locale], description: route.description[locale], mode: route.mode, ...(route.section ? { section: route.section[locale] } : {}), ...(route.glyph ? { glyph: route.glyph } : {}), ...(route.placement ? { placement: route.placement } : {}), iconKey: routeIconKeys[route.path] }));
}

export function localizeRuntimeStatus(status: string, locale: "zh" | "en") {
  if (locale === "zh") return status;
  const map: Record<string, string> = {
    "正在连接桌面运行桥接…": "Connecting to the desktop bridge…",
    "正在读取本地状态、配置与会话…": "Reading local state, configuration, and sessions…",
    "正在检查运行时组件与本地 Agent…": "Checking runtime components and the local Agent…",
    "检测到运行环境缺失，正在自动修复…": "Required runtime is missing; repairing automatically…",
    "检查本地运行环境…": "Checking local runtime…",
    "运行环境就绪": "Runtime ready",
    "运行环境需要修复": "Runtime needs repair",
    "运行环境修复失败": "Runtime repair failed",
    "本地数据库需要修复": "Local database needs repair",
    "浏览器预览模式 · Tauri 未连接": "Browser preview · Tauri is not connected",
    "正在连接桌面运行桥接：检查 Tauri 通道与本地服务…": "Connecting to the desktop bridge: checking the Tauri channel and local services…",
    "正在初始化本地数据库：检查完整性并恢复中断任务…": "Initializing the local database: checking integrity and recovering interrupted runs…",
    "正在读取 config.json：解析 Provider、模型与本地路径…": "Reading config.json: resolving Providers, models, and local paths…",
    "正在读取最近数据：会话、任务、资产与工作流…": "Reading recent data: sessions, tasks, assets, and workflows…",
    "正在检查运行时清单与本地组件…": "Checking the runtime manifest and local components…",
    "正在验证 Node、OpenCode、Python 与本地索引依赖…": "Verifying Node, OpenCode, Python, and local index dependencies…",
    "运行时组件检查完成，准备打开工作台…": "Runtime checks complete; preparing to open the workbench…",
  };
  if (status.startsWith("运行环境修复失败：")) return `Runtime repair failed: ${status.slice("运行环境修复失败：".length)}`;
  return map[status] ?? status;
}

function localizeRuntimeProgress(message: string, locale: "zh" | "en") {
  const map: Record<string, string> = {
    manifest_loaded: locale === "zh" ? "已读取运行时清单" : "Runtime manifest loaded",
    offline_archive_discovered: locale === "zh" ? "发现旁边的离线运行时包，准备离线安装…" : "Offline runtime archive found; preparing offline install…",
    network_runtime_prepare: locale === "zh" ? "未发现离线包，准备从镜像下载缺失组件…" : "No offline archive found; preparing mirror downloads…",
    bundled_runtime_seeded: locale === "zh" ? "已复用便携包内置组件" : "Bundled portable components reused",
    downloading_missing_runtime: locale === "zh" ? "正在下载缺失的运行时组件…" : "Downloading missing runtime components…",
    offline_archive_loaded: locale === "zh" ? "正在解压离线运行时包…" : "Extracting the offline runtime archive…",
    opencode_check: locale === "zh" ? "正在检查本地 Agent…" : "Checking the local Agent…",
    python_dependencies_check: locale === "zh" ? "正在检查 Python 文档处理依赖…" : "Checking Python document dependencies…",
    activating_runtime: locale === "zh" ? "正在激活本地运行环境…" : "Activating the local runtime…",
    completed: locale === "zh" ? "运行环境准备完成" : "Runtime preparation completed",
    ready: locale === "zh" ? "运行环境已就绪" : "Runtime is ready",
    failed: locale === "zh" ? "运行环境准备失败" : "Runtime preparation failed",
    timeout: locale === "zh" ? "运行环境准备超时（30 分钟）" : "Runtime preparation timed out after 30 minutes",
  };
  if (message.startsWith("downloading:")) {
    const asset = message.slice("downloading:".length);
    return locale === "zh" ? `正在下载组件：${asset}` : `Downloading component: ${asset}`;
  }
  if (message.startsWith("extracting:")) {
    const asset = message.slice("extracting:".length);
    return locale === "zh" ? `正在解压组件：${asset}` : `Extracting component: ${asset}`;
  }
  return map[message] ?? message;
}

type DesktopBootstrapPhase = "bridge" | "state" | "runtime" | "repair" | "ready" | "error";

function DesktopBootstrapScreen({ locale, status, phase, style, onExportDiagnostics }: { locale: "zh" | "en"; status: string; phase: DesktopBootstrapPhase; style: CSSProperties; onExportDiagnostics?: () => void }) {
  const stages = locale === "zh"
    ? [{ id: "bridge" as const, label: "连接桌面运行桥接" }, { id: "state" as const, label: "读取本地状态与会话" }, { id: "runtime" as const, label: "检查运行时组件" }, { id: "repair" as const, label: "修复缺失组件" }]
    : [{ id: "bridge" as const, label: "Connect desktop bridge" }, { id: "state" as const, label: "Read local state and sessions" }, { id: "runtime" as const, label: "Check runtime components" }, { id: "repair" as const, label: "Repair missing components" }];
  const activeIndex = phase === "ready" ? stages.length : Math.max(0, stages.findIndex((stage) => stage.id === phase));
  const failed = phase === "error";
  return <main className="bootstrap-screen" style={style} role="status" aria-live="polite">
    <section className="bootstrap-card">
      <div className="bootstrap-card-header"><div className="bootstrap-mark">AI</div><div><div className="eyebrow">LOCAL RUNTIME BOOTSTRAP</div><h1>{locale === "zh" ? "正在启动本地工作台" : "Starting local workbench"}</h1></div><span className={`bootstrap-spinner ${failed ? "is-failed" : phase === "ready" ? "is-ready" : ""}`} aria-hidden="true" /></div>
      <div className="bootstrap-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(8, ((activeIndex + (phase === "ready" ? 1 : 0)) / stages.length) * 100))}%` }} /></div>
      <ol className="bootstrap-stages">{stages.map((stage, index) => { const complete = phase === "ready" || index < activeIndex; const active = !complete && index === activeIndex && !failed; return <li key={stage.id} className={complete ? "is-complete" : active ? "is-active" : failed && index === activeIndex ? "is-failed" : ""}><span aria-hidden="true">{complete ? "✓" : active ? "•" : failed && index === activeIndex ? "!" : "○"}</span><span>{stage.label}</span>{active ? <small>{locale === "zh" ? "进行中" : "In progress"}</small> : complete ? <small>{locale === "zh" ? "完成" : "Done"}</small> : null}</li>; })}</ol>
      <p className="bootstrap-status-label">{locale === "zh" ? "当前子步骤" : "Current sub-step"}</p>
      <p className="bootstrap-status">{localizeRuntimeStatus(status, locale)}</p>
       <small className="bootstrap-hint">{locale === "zh" ? "首次启动可能需要准备离线运行时和本地索引。下载、解压或校验期间界面可能保持不变，请保持窗口打开。" : "The first launch may prepare the offline runtime and local indexes. The screen may remain unchanged while downloading, extracting, or validating; keep it open."}</small>
       {failed && onExportDiagnostics ? <button type="button" className="ghost bootstrap-diagnostics-button" onClick={onExportDiagnostics}>{locale === "zh" ? "导出启动诊断包" : "Export startup diagnostics"}</button> : null}
     </section>
   </main>;
}

export function localizeDesktopStatus(status: string, locale: "zh" | "en") {
  if (/^Provider rate limit reached \(HTTP 429\)/u.test(status)) {
    return locale === "zh"
      ? "文本 Provider 返回 HTTP 429 限流，请切换已配置的文本模型后重试。"
      : status;
  }
  if (/^Text provider request timed out(?: after \d+ seconds)?(?:\.|$)/u.test(status)) {
    return locale === "zh"
      ? "文本 Provider 请求超时，请检查 Provider 地址、API Key，或切换其他文本模型后重试。"
      : status;
  }
  if (locale === "zh") return status;
  const map: Record<string, string> = {
    "Obsidian 语义索引已完成": "Obsidian semantic index complete",
    "Obsidian 词法索引已完成，可继续检索": "Obsidian lexical index complete; search is ready",
    "正在检索本地 Vault…": "Searching the local Vault…",
    "没有匹配的本地笔记": "No matching local notes",
    "本地 Agent 已异常退出，任务已标记为中断，可在任务中心重试": "Local Agent exited unexpectedly; the run was marked interrupted and can be retried from Task Center",
    "已发送，等待本地 Agent 事件…": "Sent; waiting for local Agent events…",
    "正在通过本地 OpenCode 运行…": "Running through local OpenCode…",
    "已停止本地 Agent": "Local Agent stopped",
    "工作流已保存到本机": "Workflow saved locally",
    "工作流 JSON 已导出": "Workflow JSON exported",
    "模型配置已保存到本机 config.json": "Model settings saved to local config.json",
  };
  return map[status] ?? status;
}

export function isDesktopErrorStatus(status: string) {
  return /(?:error|failed|failure|timed out|timeout|unable|cannot|could not|not available|超时|失败|异常退出|未响应|未能|不可用|无法|限流|拒绝)/iu.test(status);
}

function DesktopTopTip({ message, locale, onDismiss }: { message: string; locale: "zh" | "en"; onDismiss: () => void }) {
  return <div className="desktop-top-tip" data-tip-kind="error" role="alert" aria-live="assertive">
    <span className="desktop-top-tip-icon" aria-hidden="true">!</span>
    <span className="desktop-top-tip-message">{message}</span>
    <button type="button" className="desktop-top-tip-dismiss" onClick={onDismiss} aria-label={locale === "zh" ? "关闭异常提示" : "Dismiss error notification"} title={locale === "zh" ? "关闭" : "Dismiss"}>×</button>
    <span className="sr-only">{locale === "zh" ? "异常提示" : "Error notification"}</span>
  </div>;
}

function routeWorkflowAction(path: string): WorkflowAction | null {
  if (path.includes("executive-ppt")) return "ppt_generate";
  if (path.includes("executive-presentation-ppt")) return "ppt_generate";
  if (path === "/dashboard/writer") return "writer";
  if (path === "/dashboard/image-assistant") return "image_generate";
  if (path === "/dashboard/video") return "video_generate";
  return null;
}

const workflowActions: Array<{ id: WorkflowAction; label: string; output: "text" | "asset" | "ppt" | "image" | "video" | "audio" }> = [
  { id: "upload", label: "本地文件", output: "asset" },
  { id: "text_input", label: "文本输入", output: "text" },
  { id: "file_create", label: "创建文件", output: "asset" },
  { id: "writer", label: "内容写作", output: "text" },
  { id: "llm_generate", label: "模型生成", output: "text" },
  { id: "agent_execute", label: "智能体执行", output: "text" },
  { id: "ppt_generate", label: "PPT（ppt-master）", output: "ppt" },
  { id: "image_generate", label: "图片生成", output: "image" },
  { id: "video_generate", label: "视频生成", output: "video" },
  { id: "digital_human", label: "数字人", output: "video" },
  { id: "music_generate", label: "音乐生成", output: "audio" },
  { id: "voice_synthesis", label: "语音合成", output: "audio" },
  { id: "voice_clone", label: "声音克隆", output: "audio" },
  { id: "video_process", label: "视频处理", output: "video" },
  { id: "audio_process", label: "音频处理", output: "audio" },
  { id: "knowledge_retrieve", label: "Obsidian 知识检索", output: "text" },
  { id: "knowledge_write", label: "写入 Obsidian", output: "text" },
  { id: "product_store", label: "保存到资产库", output: "asset" },
  { id: "foreach", label: "逐项处理", output: "asset" },
  { id: "collect", label: "汇总结果", output: "text" },
  { id: "output", label: "结果预览", output: "text" },
];
const workflowActionsBase = workflowActions;

function outputInputPort(value: string) {
  return value === "asset" ? "assets" : value === "image" ? "images" : value === "video" ? "videos" : value === "audio" ? "audios" : value === "ppt" ? "presentations" : "text";
}

type WorkflowParameterValue = string | number | boolean;
type WorkflowParameterView = {
  key: string;
  label: string;
  value: WorkflowParameterValue;
  rendererId?: string;
  valueType?: string;
  options?: Array<{ label: string; value: string }>;
};

function conversationIdFromPath(path: string): string | null {
  const match = path.match(/^\/dashboard\/(?:ai|writer|image-assistant)\/([^/?]+)/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function conversationScopeFromPath(path: string) {
  return workbenchSessionScope(path) ?? null;
}

export function conversationAgentIdFromPath(path: string, conversations: ReadonlyArray<{ id: string; agent_id?: string | null }>) {
  const routeScope = conversationScopeFromPath(path);
  if (routeScope) return routeScope;
  const conversationId = conversationIdFromPath(path);
  return conversationId ? conversations.find((conversation) => conversation.id === conversationId)?.agent_id?.trim() ?? null : null;
}

function conversationRoute(conversation: { id: string; agent_id?: string | null }, basePath = "/dashboard/ai") {
  const scope = conversation.agent_id?.trim();
  if (scope === "entry:writer") return `/dashboard/writer/${encodeURIComponent(conversation.id)}`;
  if (scope === "entry:image-assistant") return `/dashboard/image-assistant/${encodeURIComponent(conversation.id)}`;
  const query = new URLSearchParams();
  if (scope?.startsWith("entry:")) query.set("entry", scope.slice("entry:".length));
  else if (scope) {
    query.set("agent", scope);
    if (scope === "executive-brand" || scope === "executive-growth") query.set("entry", "consulting-advisor");
  }
  const serialized = query.toString();
  return `${basePath}/${encodeURIComponent(conversation.id)}${serialized ? `?${serialized}` : ""}`;
}

function conversationAwareRoute(path: string, conversations: Array<{ id: string; agent_id?: string | null }>) {
  const match = path.match(/^\/dashboard\/(?:ai|writer|image-assistant)\/([^/?]+)$/u);
  if (!match) return path;
  const conversation = conversations.find((item) => item.id === decodeURIComponent(match[1]));
  return conversation ? conversationRoute(conversation) : path;
}

type DesktopRunContext = {
  readonly kind: "conversation" | "media" | "workflow";
  readonly launchPath: string;
  readonly conversationId?: string;
  readonly mediaScope?: string;
  readonly workflowKey?: string;
};

function mediaRunScopeFromPath(path: string) {
  const [pathname, rawQuery = ""] = path.split("?", 2);
  const feature = new URLSearchParams(rawQuery).get("feature") ?? "";
  return `${pathname}|${feature}`;
}

function mediaRunScopeForFeature(path: string, featureId?: string) {
  if (!featureId || featureId === "image_generate") return mediaRunScopeFromPath(path);
  const feature = mediaFeatureCatalog.find((item) => item.id === featureId);
  if (!feature) return mediaRunScopeFromPath(path);
  return `${feature.group === "audio" ? "/dashboard/capabilities" : "/dashboard/video"}|${featureId}`;
}

function desktopRunIsVisible(context: DesktopRunContext | undefined, path: string, activeConversationId: string | null, workflowKey: string | null) {
  if (!context) return false;
  if (context.kind === "workflow") return context.workflowKey === workflowKey && path.split("?", 1)[0] === "/dashboard/workflows";
  if (context.kind === "media") return context.mediaScope === mediaRunScopeFromPath(path);
  const routeConversationId = conversationIdFromPath(path);
  return routeConversationId === context.conversationId || (routeConversationId === null && activeConversationId === context.conversationId);
}

function readDesktopTaskMetadata(detail: RunDetail): DesktopTaskMetadata | null {
  const metadataEvent = detail.events.find((event) => event.event_type === "task_metadata");
  if (!metadataEvent) return null;
  try {
    const payload = JSON.parse(metadataEvent.payload_json) as Record<string, unknown>;
    if (payload.kind !== "workflow" && payload.kind !== "media" && payload.kind !== "agent") return null;
    const imageGeneration = readDesktopImageGenerationMetadata(payload.imageGeneration);
    return {
      kind: payload.kind,
      ...(typeof payload.featureId === "string" ? { featureId: payload.featureId } : {}),
      ...(typeof payload.entryPath === "string" ? { entryPath: payload.entryPath } : {}),
      ...(imageGeneration ? { imageGeneration } : {}),
      ...(typeof payload.workflowId === "string" ? { workflowId: payload.workflowId } : {}),
      ...(typeof payload.workflowTitle === "string" ? { workflowTitle: payload.workflowTitle } : {}),
      ...(typeof payload.definitionHash === "string" ? { definitionHash: payload.definitionHash } : {}),
      ...(isWorkflowDefinition(payload.workflowDefinition) ? { workflowDefinition: payload.workflowDefinition } : {}),
    };
  } catch {
    return null;
  }
}

function getWorkflowParameterViews(node: WorkflowDefinitionNodeV2, locale: "zh" | "en"): WorkflowParameterView[] {
  const definition = workflowNodeRegistry.get(node.type);
  const schema = definition?.configSchema ?? [];
  const schemaKeys = new Set(schema.map((field) => field.id));
  const schemaViews = schema.flatMap((field) => {
    const value = node.config[field.id] ?? field.defaultValue;
    if (value === undefined || value === null || typeof value === "object") return [];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
    return [{ key: field.id, label: field.label[locale] ?? field.label.en ?? field.id, value, rendererId: field.rendererId, valueType: field.valueType, options: field.options }];
  });
  const extraViews = Object.entries(node.config).flatMap(([key, value]) => {
    if (schemaKeys.has(key) || (key === "provider" && schemaKeys.has("selectedProviderId")) || (key === "model" && schemaKeys.has("selectedModelId")) || /apiKey|token|secret|baseUrl|endpoint|queryEndpoint/iu.test(key) || value === undefined || value === null || typeof value === "object") return [];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
    return [{ key, label: key, value }];
  });
  return [...schemaViews, ...extraViews];
}

function buildDesktopWorkflowNodeConfig(type: WorkflowAction, prompt: string, model: string, providerId = "local") {
  const definition = workflowNodeRegistry.get(type);
  const config: Record<string, unknown> = { ...(definition?.defaultConfig ?? {}) };
  for (const field of definition?.configSchema ?? []) {
    if (config[field.id] !== undefined) continue;
    if (field.id === "selectedProviderId") config[field.id] = providerId;
    else if (field.id === "selectedModelId") config[field.id] = model;
    else if (field.id === "model") config[field.id] = model;
    else if (field.defaultValue !== undefined) config[field.id] = field.defaultValue;
    else if (["prompt", "script", "text", "query", "previewText"].includes(field.id)) config[field.id] = prompt;
    else if (field.valueType === "boolean") config[field.id] = false;
    else if (field.valueType === "number") config[field.id] = 0;
    else if (field.valueType === "string[]") config[field.id] = [];
    else if (field.valueType === "object") config[field.id] = {};
    else config[field.id] = "";
  }
  return config;
}

function formatWorkflowParameterValue(value: WorkflowParameterValue) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : String(value);
}

export function buildWorkflowDefinition(prompt: string, actionId: WorkflowAction, provider: Pick<DesktopProviderConfig, "id" | "model" | "baseUrl">, extraConfig: Record<string, unknown> = {}, locale: "zh" | "en" = "zh"): WorkflowDefinitionEnvelope {
  const action = workflowActions.find((item) => item.id === actionId) ?? workflowActions[0];
  const title = locale === "en" ? workflowActionEnglish[action.id] ?? action.label : action.label;
  const capabilityConfig = { ...buildDesktopWorkflowNodeConfig(actionId, prompt, provider.model ?? "", provider.id), provider: provider.id, model: provider.model, baseUrl: provider.baseUrl, ...extraConfig };
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: locale === "en" ? "Input task" : "输入任务", positionX: 0, positionY: 0, config: buildDesktopWorkflowNodeConfig("text_input", prompt, provider.model ?? "", provider.id) },
      { nodeKey: "capability", type: actionId, nodeVersion: 1, title, positionX: 408, positionY: 0, config: capabilityConfig },
      { nodeKey: "asset-library", type: "product_store", nodeVersion: 1, title: locale === "en" ? "Save to Asset Library" : "保存到资产库", positionX: 816, positionY: 0, config: buildDesktopWorkflowNodeConfig("product_store", prompt, provider.model ?? "", provider.id) },
    ],
    edges: [
      { edgeKey: "input-capability", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "capability", targetPortId: workflowNodeRegistry.get(actionId)?.inputs[0]?.id ?? "text" },
      { edgeKey: "capability-asset-library", sourceNodeKey: "capability", sourcePortId: action.output, targetNodeKey: "asset-library", targetPortId: outputInputPort(action.output) },
    ],
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}

export function buildLocalMediaWorkflowDefinition(kind: "video" | "audio", locale: "zh" | "en" = "zh"): WorkflowDefinitionEnvelope {
  const video = kind === "video";
  const processType = video ? "video_process" : "audio_process";
  const inputPort = video ? "video" : "audio";
  const inputTargetPort = video ? "videos" : "audios";
  const title = video ? (locale === "en" ? "FFmpeg video transform" : "FFmpeg 视频变换") : (locale === "en" ? "FFmpeg audio trim" : "FFmpeg 音频裁剪");
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2, revision: 1, definitionHash: "",
    nodes: [
      { nodeKey: "input", type: "upload", nodeVersion: 1, title: locale === "en" ? "Upload media" : "上传媒体", positionX: 0, positionY: 0, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "process", type: processType, nodeVersion: 1, title, positionX: 408, positionY: 0, config: video ? { operation: "transform", ratio: "16:9", width: 1280, height: 720, fps: 30 } : { operation: "trim", startSeconds: 0, endSeconds: 2 } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: locale === "en" ? "Result preview" : "结果预览", positionX: 816, positionY: 0, config: {} },
    ],
    edges: [
      { edgeKey: "input-process", sourceNodeKey: "input", sourcePortId: inputPort, targetNodeKey: "process", targetPortId: inputTargetPort },
      { edgeKey: "process-output", sourceNodeKey: "process", sourcePortId: inputPort, targetNodeKey: "output", targetPortId: inputTargetPort },
    ],
    metadata: { description: video ? (locale === "en" ? "Resize and normalize a local video with FFmpeg." : "使用 FFmpeg 调整本地视频尺寸并统一帧率。") : (locale === "en" ? "Trim the first two seconds of a local audio file with FFmpeg." : "使用 FFmpeg 裁剪本地音频前两秒。"), status: "draft" },
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}

export function buildProductPromotionWorkflowDefinition(videoProvider: Pick<DesktopProviderConfig, "id" | "model" | "baseUrl">, audioProvider: Pick<DesktopProviderConfig, "id" | "model" | "baseUrl">, locale: "zh" | "en" = "zh"): WorkflowDefinitionEnvelope {
  const textTitle = locale === "en" ? "Product promotion script" : "产品宣传文案";
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2, revision: 1, definitionHash: "",
    nodes: [
      { nodeKey: "script", type: "text_input", nodeVersion: 1, title: textTitle, positionX: 0, positionY: 0, config: { text: locale === "en" ? "Introduce the product, its core value, and a clear call to action." : "介绍产品核心价值，并给出明确行动号召。" } },
      { nodeKey: "generated-video", type: "video_generate", nodeVersion: 1, title: locale === "en" ? "5s digital human video" : "5 秒数字人视频", positionX: 408, positionY: 0, config: { prompt: locale === "en" ? "A professional digital human presenting the product on camera, clear gestures, polished commercial style." : "专业数字人面对镜头介绍产品，动作清晰自然，商业宣传片风格。", mode: "text-to-video", duration: "5", ratio: "16:9", sound: "off", provider: videoProvider.id, model: videoProvider.model, baseUrl: videoProvider.baseUrl } },
      { nodeKey: "operation-video", type: "upload", nodeVersion: 1, title: locale === "en" ? "Upload operation video" : "上传操作视频", positionX: 0, positionY: 360, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "result-video", type: "upload", nodeVersion: 1, title: locale === "en" ? "Upload result video" : "上传结果视频", positionX: 0, positionY: 600, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "outro-video", type: "upload", nodeVersion: 1, title: locale === "en" ? "Upload outro video" : "上传片尾视频", positionX: 0, positionY: 840, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "stitch", type: "video_process", nodeVersion: 1, title: locale === "en" ? "Stitch in order" : "按顺序拼接视频", positionX: 816, positionY: 360, config: { operation: "stitch", transition: "cut", ratio: "16:9", width: 1280, height: 720, fps: 30 } },
      { nodeKey: "subtitle", type: "video_process", nodeVersion: 1, title: locale === "en" ? "Add subtitles" : "添加字幕", positionX: 1224, positionY: 360, config: { operation: "subtitle", subtitleFormat: "srt", ratio: "16:9", width: 1280, height: 720, fps: 30 } },
      { nodeKey: "voice", type: "voice_synthesis", nodeVersion: 1, title: locale === "en" ? "Voiceover" : "语音合成", positionX: 816, positionY: 0, config: { text: locale === "en" ? "Use the product promotion script as the voiceover." : "使用产品宣传文案生成配音。", provider: audioProvider.id, model: audioProvider.model, baseUrl: audioProvider.baseUrl } },
      { nodeKey: "mux", type: "video_process", nodeVersion: 1, title: locale === "en" ? "Add voice to video" : "添加语音到视频", positionX: 1632, positionY: 360, config: { operation: "mux" } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: locale === "en" ? "Final product video" : "产品宣传成片", positionX: 2040, positionY: 360, config: {} },
    ],
    edges: [
      { edgeKey: "script-video", sourceNodeKey: "script", sourcePortId: "text", targetNodeKey: "generated-video", targetPortId: "text" },
      { edgeKey: "script-voice", sourceNodeKey: "script", sourcePortId: "text", targetNodeKey: "voice", targetPortId: "text" },
      { edgeKey: "script-subtitle", sourceNodeKey: "script", sourcePortId: "text", targetNodeKey: "subtitle", targetPortId: "text" },
      { edgeKey: "generated-stitch", sourceNodeKey: "generated-video", sourcePortId: "video", targetNodeKey: "stitch", targetPortId: "videos" },
      { edgeKey: "operation-stitch", sourceNodeKey: "operation-video", sourcePortId: "video", targetNodeKey: "stitch", targetPortId: "videos" },
      { edgeKey: "result-stitch", sourceNodeKey: "result-video", sourcePortId: "video", targetNodeKey: "stitch", targetPortId: "videos" },
      { edgeKey: "outro-stitch", sourceNodeKey: "outro-video", sourcePortId: "video", targetNodeKey: "stitch", targetPortId: "videos" },
      { edgeKey: "stitch-subtitle", sourceNodeKey: "stitch", sourcePortId: "video", targetNodeKey: "subtitle", targetPortId: "videos" },
      { edgeKey: "subtitle-mux", sourceNodeKey: "subtitle", sourcePortId: "video", targetNodeKey: "mux", targetPortId: "videos" },
      { edgeKey: "voice-mux", sourceNodeKey: "voice", sourcePortId: "audio", targetNodeKey: "mux", targetPortId: "audios" },
      { edgeKey: "mux-output", sourceNodeKey: "mux", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
    ],
    metadata: { description: locale === "en" ? "Generate a 5-second digital human product intro, append three uploaded clips in order, add subtitles and voiceover, then export the final video." : "生成 5 秒数字人产品介绍，依次拼接三个上传视频，添加字幕和语音，输出产品宣传成片。", status: "draft" },
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}

const DESKTOP_CANVAS_NODE_WIDTH = 336;
const DESKTOP_CANVAS_NODE_HEIGHT = 280;
const DESKTOP_CANVAS_NODE_GAP = 72;

function normalizeWorkflowNodePositions(nodes: WorkflowDefinitionNodeV2[]) {
  const placed: Array<{ x: number; y: number }> = [];
  const exactPositions = new Set<string>();
  let changed = false;
  const overlaps = (x: number, y: number) => placed.some((current) => x < current.x + DESKTOP_CANVAS_NODE_WIDTH + DESKTOP_CANVAS_NODE_GAP && x + DESKTOP_CANVAS_NODE_WIDTH + DESKTOP_CANVAS_NODE_GAP > current.x && y < current.y + DESKTOP_CANVAS_NODE_HEIGHT + DESKTOP_CANVAS_NODE_GAP && y + DESKTOP_CANVAS_NODE_HEIGHT + DESKTOP_CANVAS_NODE_GAP > current.y);
  const normalized = nodes.map((node, index) => {
    let positionX = Number.isFinite(node.positionX) ? node.positionX : Number.NaN;
    let positionY = Number.isFinite(node.positionY) ? node.positionY : Number.NaN;
    // A user can deliberately place nodes close together. Repair only invalid or exact-duplicate
    // persisted coordinates so an unrelated node move can never trigger a graph-wide reflow.
    if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || exactPositions.has(`${positionX}:${positionY}`)) {
      let slot = index;
      do {
        positionX = 80 + (slot % 4) * (DESKTOP_CANVAS_NODE_WIDTH + 72);
        positionY = 80 + Math.floor(slot / 4) * (DESKTOP_CANVAS_NODE_HEIGHT + 96);
        slot += 1;
      } while (overlaps(positionX, positionY));
    }
    placed.push({ x: positionX, y: positionY });
    exactPositions.add(`${positionX}:${positionY}`);
    const nodeChanged = positionX !== node.positionX || positionY !== node.positionY;
    if (nodeChanged) changed = true;
    return nodeChanged ? { ...node, positionX, positionY } : node;
  });
  return changed ? normalized : nodes;
}

function normalizeWorkflowDefinitionLayout(definition: WorkflowDefinitionEnvelope) {
  const repairedKeys = repairWorkflowNodeKeys(definition);
  const nodes = normalizeWorkflowNodePositions(repairedKeys.nodes);
  // Older saved workflows can carry a hash produced before a node/edge/config
  // migration.  Keep the loaded canvas executable by repairing the hash even
  // when its layout and node keys did not need changes.
  const normalized = { ...repairedKeys, nodes, definitionHash: "" };
  const definitionHash = hashWorkflowDefinition(normalized);
  return nodes === definition.nodes && repairedKeys === definition && definition.definitionHash === definitionHash
    ? definition
    : { ...normalized, definitionHash };
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinitionEnvelope {
  return Boolean(value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 2 && Array.isArray((value as { nodes?: unknown }).nodes) && Array.isArray((value as { edges?: unknown }).edges));
}

export function parseImageInputs(prompt: string): Record<string, unknown> {
  const read = (...labels: string[]) => {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const value = prompt.match(new RegExp(`(?:^|\\n)${escaped}\\s*[:：]\\s*([^\\n]+)`, "mi"))?.[1]?.trim();
      if (value) return value;
    }
    return "";
  };
  const count = Number(read("生成数量", "Count"));
  return {
    // gpt-image-2 rejects the legacy text-model quality value `standard`.
    // Keep an explicitly supplied value intact for generic providers, but use
    // the OpenAI-compatible image default when the writer shortcut supplies
    // no image settings at all.
    quality: read("图片质量", "Quality") || "auto",
    size: read("图片尺寸", "Size") || "1024x1024",
    ...(Number.isFinite(count) && count > 0 ? { n: count } : { n: 1 }),
    referenceImages: read("参考素材", "Reference assets"),
  };
}

const fallbackLocalSkills: LocalSkillCatalog["skills"] = [
  { id: "writer-orchestrator", relativePath: "writer-orchestrator/SKILL.md" },
  { id: "content-analyzer", relativePath: "content-analyzer/SKILL.md" },
  { id: "khazix-writer", relativePath: "khazix-writer/SKILL.md" },
  { id: "ppt-master", relativePath: "ppt-master/SKILL.md" },
  { id: "dashi-ppt", relativePath: "dashi-ppt/SKILL.md" },
];

const LEGACY_SKILL_ALIASES: Record<string, SkillId> = {
  "content-writing": "writer-orchestrator",
  "marketing-analysis": "content-analyzer",
  "obsidian-rag": "auto",
};

function canonicalDesktopSkillId(skillId: string) {
  const normalized = skillId.trim();
  return LEGACY_SKILL_ALIASES[normalized] ?? normalized;
}

function localSkillTitle(id: string) {
  return id.split(/[/_-]+/u).filter(Boolean).map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function localSkillGroup(id: string) {
  if (/writer|writing|copy|seo|headline|newsletter|social|speech|content/iu.test(id)) return "writing";
  if (/canvas|design|image|graphic|creative/iu.test(id)) return "creative";
  if (/agency|business|executive|consult/iu.test(id)) return "agents";
  return "skills";
}

function buildLocalAgentGroups(skills: LocalSkillCatalog["skills"], locale: "zh" | "en", configured: boolean): WorkbenchAgentDirectoryGroup[] {
  const labels = locale === "zh" ? { agents: "专家智能体", writing: "内容创作", creative: "视觉创作", skills: "其他 Skills", start: "开始本地对话", needs: "需要先在设置中配置可用模型" } : { agents: "Expert agents", writing: "Content creation", creative: "Visual creation", skills: "Other Skills", start: "Start local chat", needs: "Configure an available model in Settings first" };
  return (["agents", "writing", "creative", "skills"] as const).map((groupId) => ({
    id: groupId,
    label: labels[groupId],
    cards: skills.filter((skill) => localSkillGroup(skill.id) === groupId).map((skill) => ({
      id: skill.id,
      title: localSkillTitle(skill.id),
      description: locale === "zh" ? `使用已安装的 ${skill.id} Skill 启动本地 OpenCode 对话。` : `Start a local OpenCode conversation with the installed ${skill.id} Skill.`,
      instructions: locale === "zh" ? `使用 ${skill.id} Skill 完成任务，并将可交付产物保留在当前项目目录。` : `Use the ${skill.id} Skill and keep deliverables in the current project directory.`,
      tools: [{ name: "OpenCode runtime", description: locale === "zh" ? "通过本地运行时执行 Skill。" : "Execute the Skill through the local runtime." }],
      output: locale === "zh" ? "文本回复与本地产物" : "Text response and local artifacts",
      meta: "Local Skill",
      availability: configured ? "ready" as const : "needs-config" as const,
      unavailableReason: configured ? undefined : labels.needs,
      primaryAction: { id: `start:${skill.id}`, label: labels.start, disabled: !configured },
    })),
  })).filter((group) => group.cards.length);
}

export function desktopExecutionPrompt(_skillId: SkillId, prompt: string, _locale: "zh" | "en") {
  // The selected Skill owns the task workflow. Do not append desktop-specific
  // generation, artifact, or confirmation rules to the user's message.
  return prompt;
}

export function localizedSkillSystemPrompt(_skillId: SkillId, _locale: "zh" | "en") {
  // Skill selection is carried by the native command, not a system override.
  return "";
}

export function resolveDesktopSkillId(path: string, requestedAgentId: string | null): SkillId {
  if (path.includes("executive-ppt")) return "ppt-master";
  if (path.includes("executive-presentation-ppt")) return "dashi-ppt";
  // Agency Agents are packaged as native OpenCode agents, not Skills. The
  // selected agent is sent separately as `agentId` on the session prompt.
  if (requestedAgentId?.startsWith("agency-")) return "auto";
  if (requestedAgentId === "entry:writer") return "writer-orchestrator";
  if (requestedAgentId === "entry:image-assistant") return "auto";
  // Executive agents are specializations of the single bundled consulting
  // Skill. Their catalog IDs are routing identifiers, not on-disk Skill
  // directory names, so never ask OpenCode to resolve e.g.
  // `executive-legal-risk` as a standalone Skill.
  if (requestedAgentId?.startsWith("executive-")) return "executive-consulting-suite";
  if (requestedAgentId?.trim()) return canonicalDesktopSkillId(requestedAgentId);
  if (path === "/dashboard/writer") return "writer-orchestrator";
  if (path === "/dashboard/knowledge-base") return "auto";
  // A persisted provider skill is not a default for ordinary AI chat. Chat
  // sessions must opt into a Skill through an explicit route or Agent.
  return "auto";
}

const desktopCapabilities: Array<{ id: WorkflowAction; title: string; description: string; route: string; kind: "text" | "media" | "knowledge" }> = [
  { id: "writer", title: "内容写作", description: "通过本地 OpenCode 与 Writer Skill 生成、改写和整理营销内容。", route: "/dashboard/writer", kind: "text" },
  { id: "ppt_generate", title: "AI PPT", description: "使用 OpenCode + ppt-master Skill 在项目目录生成可编辑 PPTX。", route: "/dashboard/ai?agent=executive-ppt", kind: "text" },
  { id: "image_generate", title: "AI 图片", description: "调用已配置的图片 Provider，生成并登记本地图片产物。", route: "/dashboard/image-assistant", kind: "media" },
  { id: "video_generate", title: "AI 视频", description: "调用视频 Provider 生成视频，并把异步任务与文件保存在本地。", route: "/dashboard/video", kind: "media" },
  { id: "digital_human", title: "数字人", description: "使用媒体工作流中的数字人能力生成本地视频结果。", route: "/dashboard/video", kind: "media" },
  { id: "music_generate", title: "AI 音乐", description: "生成音乐并在本地产物库中管理音频文件。", route: "/dashboard/video", kind: "media" },
  { id: "voice_clone", title: "声音克隆", description: "使用参考音频创建可复用音色，并在媒体工作区预览结果。", route: "/dashboard/video", kind: "media" },
  { id: "voice_synthesis", title: "语音合成", description: "把文本转换为语音，产物直接写入本地项目目录。", route: "/dashboard/video", kind: "media" },
  { id: "knowledge_retrieve", title: "Obsidian 知识库", description: "在本地 Vault 索引中检索笔记，并从结果打开原文。", route: "/dashboard/knowledge-base", kind: "knowledge" },
  { id: "knowledge_write", title: "写入 Obsidian", description: "将 Agent 生成的内容写入配置的 Vault，并保留本地文件索引。", route: "/dashboard/writer", kind: "knowledge" },
];

function HomeEntryGroups({ onNavigate, locale }: { onNavigate: (path: string) => void; locale: "zh" | "en" }) {
  return <section className="home-entry-groups" aria-label={locale === "zh" ? "功能入口" : "Workspace entries"}>
    {WORKBENCH_HOME_GROUPS.map((group) => <div key={group.label} className="home-entry-group">
      <div className="home-entry-group-label">{homeGroupLabels[group.label]?.[locale] ?? group.label}</div>
      <div className="home-entry-group-list">
        {group.entries.map((entry) => <button key={`${entry.path}:${entry.label[locale]}`} type="button" className={`home-entry-card home-entry-card--${entry.tone}`} onClick={() => onNavigate(entry.path)}>
          <span className={`home-entry-icon home-entry-icon--${entry.tone}`} aria-hidden="true"><WorkbenchRouteIcon name={routeIconKeys[entry.path] ?? (entry.path.includes("writer") ? "writer" : entry.path.includes("video") ? "video" : entry.path.includes("image") ? "image" : entry.path.includes("workflows") ? "workflow" : entry.path.includes("tasks") ? "task" : entry.path.includes("knowledge") ? "knowledge" : entry.path.includes("assets") ? "asset" : entry.path.includes("ppt") ? "ppt" : entry.path.includes("consulting") ? "advisor" : "chat")} size={19} /></span>
          <span className="home-entry-copy"><span className="home-entry-label">{entry.label[locale]}</span><span className="home-entry-description">{entry.description[locale]}</span></span>
          <WorkbenchRouteIcon name="arrowUpRight" size={15} className="home-entry-arrow" />
        </button>)}
      </div>
    </div>)}
  </section>;
}

function DesktopConversationWorkspace({
  route,
  prompt,
  onPromptChange,
  runStatus,
  activeRunId,
  onRun,
  onGenerateImages,
  onCancel,
  activePrompt,
  activePromptAt,
  assistantText,
  assistantAt,
  messages,
  conversationId,
  chatTransport,
  chatReady,
  providerId,
  onArtifactDownload,
  activeAssistantParts,
  toolEvents,
  conversations,
  onNavigate,
  knowledgeEnabled,
  onKnowledgeToggle,
  onAssistantTextChange,
  onSaveDraft,
  onExportDraft,
  artifacts,
  onArtifactOpen,
  model,
  models,
  reasoningEffort,
  skillId,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onModelChange,
  onReasoningChange,
  onSkillChange,
  onToolApproval,
  onReachTop,
  conversationScrollTop,
  onConversationScroll,
  locale,
}: {
  route: DesktopRoute;
  prompt: string;
  onPromptChange: (value: string) => void;
  runStatus: string;
  activeRunId: string | null;
  onRun: (value?: string, displayedValue?: string) => void;
  onGenerateImages?: (article: DesktopUIMessage) => void;
  onCancel: () => void;
  activePrompt: string;
  activePromptAt?: string;
  assistantText: string;
  onAssistantTextChange: (value: string) => void;
  onSaveDraft: (value: string) => void | Promise<unknown>;
  onExportDraft?: (value: string) => void | Promise<void>;
  assistantAt?: string;
  messages: DesktopConversationMessage[];
  conversationId: string | null;
  chatTransport: ChatTransport<DesktopUIMessage>;
  chatReady: boolean;
  providerId: string;
  onArtifactDownload?: (artifactId: string) => void;
  activeAssistantParts?: readonly DesktopUIMessagePart[];
  toolEvents: string[];
  conversations: Array<{ id: string; title: string; updated_at: string; agent_id?: string | null }>;
  onNavigate: (path: string) => void;
  onNewConversation?: () => void;
  knowledgeEnabled: boolean;
  onKnowledgeToggle: () => void;
  artifacts: Array<{ id: string; relative_path: string; mime_type: string; byte_length?: number }>;
  onArtifactOpen: (relativePath: string, mimeType: string) => void;
  model: string;
  models?: readonly string[];
  reasoningEffort: string;
  skillId: SkillId;
  attachments: LocalAttachment[];
  onAddAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  onToolApproval?: (message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") => void | Promise<void>;
  onReachTop?: (viewport: HTMLDivElement) => void;
  conversationScrollTop?: number;
  onConversationScroll?: (scrollTop: number) => void;
  locale: "zh" | "en";
}) {
  const visibleMessages = useMemo(() => conversationId ? messages.filter((message) => message.conversationId === conversationId) : [], [conversationId, messages]);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const conversationLoading = route.conversationLoading === true;
  const initialUIMessages = useMemo(() => visibleMessages.map(desktopConversationMessageToUIMessage), [visibleMessages]);
  const desktopChat = useDesktopChat({ chatId: conversationId, transport: chatTransport, initialMessages: initialUIMessages, resume: false });
  const stopChat = useCallback(() => {
    // The AI SDK chat owns the AbortController for the direct ChatTransport
    // path.  The legacy run id is intentionally unset for that path, so the
    // shell-level emergency stop alone cannot cancel a plain conversation.
    void desktopChat.stop();
    void (chatTransport as ChatTransport<DesktopUIMessage> & { stopCurrent?: () => Promise<void> }).stopCurrent?.();
    void onCancel();
  }, [chatTransport, desktopChat.stop, onCancel]);
  const resolvedChatReady = chatReady || !conversationId;
  const isWriter = route.mode === "writer";
  const copy = desktopCopy[locale];
  const localizedStatus = localizeDesktopStatus(runStatus, locale);
  const localizedRunStatus = isDesktopErrorStatus(localizedStatus) ? "" : localizedStatus;
  const quickPrompts = quickPromptsForDesktopRoute(route.path, locale);
  const isPlainChat = route.path === "/dashboard/ai";
  const chatSubtitle = isPlainChat
    ? (locale === "zh" ? "通用 AI 对话入口" : "General-purpose AI chat")
    : route.description;
  const chatPlaceholder = isPlainChat
    ? (locale === "zh" ? "输入你的问题..." : "Ask anything...")
    : (isWriter ? (locale === "zh" ? "描述你要写作的主题、平台和语气……" : "Describe the topic, platform, and tone you want to write for…") : (locale === "zh" ? "输入你的营销任务……" : "Describe your marketing task…"));
  const isEmptyConversation = !conversationLoading && visibleMessages.length === 0 && !activePrompt && !assistantText && !activeRunId;
  // AI Elements' chatbot empty state keeps the suggestions and composer
  // together: a suggestion fills the input, and the user can still adjust it
  // before sending.  The composer disappears only after the first turn.
  const showLanding = isEmptyConversation;
  const chatSectionRef = useRef<HTMLElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isWriter) return;
    const section = chatSectionRef.current;
    const dock = composerDockRef.current;
    if (!section || !dock) return;
    const updateComposerClearance = () => {
      // The message surface remains full-height behind this dock. Reserve the
      // measured dock height in the scroll content so the final message never
      // lands underneath the floating composer, including with attachments.
      section.style.setProperty("--chat-composer-clearance", `${Math.ceil(dock.getBoundingClientRect().height + 16)}px`);
    };
    updateComposerClearance();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateComposerClearance);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isWriter, showLanding]);
  if (isWriter) return <DesktopWriterCloudWorkspace locale={locale} route={route} prompt={prompt} onPromptChange={onPromptChange} runStatus={runStatus} activeRunId={activeRunId} onRun={(value, displayedValue) => onRun(value, displayedValue)} onGenerateImages={onGenerateImages} onCancel={stopChat} activePrompt={activePrompt} activePromptAt={activePromptAt} assistantText={assistantText} onAssistantTextChange={onAssistantTextChange} onSaveDraft={onSaveDraft} onExportDraft={onExportDraft} assistantAt={assistantAt} messages={visibleMessages} uiMessages={desktopChat.messages} activeAssistantParts={activeAssistantParts} toolEvents={toolEvents} artifacts={artifacts} onArtifactOpen={onArtifactOpen} onArtifactDownload={onArtifactDownload} model={model} models={models} reasoningEffort={reasoningEffort} skillId={skillId} attachments={attachments} onAddAttachments={onAddAttachments} onRemoveAttachment={onRemoveAttachment} knowledgeEnabled={knowledgeEnabled} onKnowledgeToggle={onKnowledgeToggle} onModelChange={onModelChange} onReasoningChange={onReasoningChange} onSkillChange={onSkillChange} onToolApproval={onToolApproval} onReachTop={onReachTop} conversationId={conversationId} conversationScrollTop={conversationScrollTop} onConversationScroll={onConversationScroll} />;
  const baseMessages = conversationLoading ? [] : visibleMessages.length ? visibleMessages : [
    ...(activePrompt ? [{ id: "active-user", conversationId: "active", role: "user" as const, content: activePrompt, createdAt: activePromptAt ?? new Date(0).toISOString() }] : []),
  ];
  const hasPersistedAssistant = !activeRunId && baseMessages.some((message) => message.role === "assistant" && message.content === assistantText);
  const hasCurrentAssistant = !conversationLoading && Boolean(assistantText || activeRunId || activeAssistantParts?.length) && !hasPersistedAssistant;
  const activeAssistantMessageId = activeRunId ? `assistant-${activeRunId}` : "active-assistant";
  const displayedMessages: DesktopConversationMessage[] = hasCurrentAssistant ? [...baseMessages, {
    id: activeAssistantMessageId,
    conversationId: "active",
    role: "assistant" as const,
    content: assistantText,
    createdAt: assistantAt ?? activePromptAt ?? new Date(0).toISOString(),
    runId: activeRunId ?? undefined,
    status: activeRunId ? "running" : "succeeded",
    parts: activeAssistantParts?.length ? activeAssistantParts : [
      ...(assistantText ? [{ type: "text" as const, text: assistantText, state: "streaming" as const }] : []),
      ...toolEvents.map((item, index) => ({ type: "data-status" as const, id: `active-assistant:tool:${index}`, data: { status: "running" as const, message: item } })),
      ...artifacts.map((artifact) => ({ type: "data-artifact" as const, id: `active-assistant:artifact:${artifact.id}`, data: { id: artifact.id, title: artifact.relative_path, relativePath: artifact.relative_path, mimeType: artifact.mime_type, byteLength: artifact.byte_length ?? 0, sha256: "" } })),
    ],
  }] : baseMessages;
  const modelOptions = (models ?? []).map((item) => ({ id: item, label: formatWorkbenchModelLabel(item, { zh: "本地模型", en: "Local model" }, locale), provider: locale === "zh" ? "已配置模型" : "Configured models" }));
  const displayedUIMessages = displayedMessages.map(desktopConversationMessageToUIMessage);
  const renderedUIMessages = mergeDesktopUIMessageViews(displayedUIMessages, desktopChat.messages, activeAssistantMessageId);
  const submitMessage = () => {
    if (conversationId && resolvedChatReady && !attachments.length && !knowledgeEnabled && prompt.trim()) {
      void desktopChat.sendMessage(createDesktopChatUserMessage({ conversationId: desktopChat.chatId, text: prompt, providerId, modelId: model, route: route.path }));
      onPromptChange("");
      return;
    }
    onRun();
  };
  const revealComposer = (suggestedPrompt?: string) => {
    if (suggestedPrompt) onPromptChange(suggestedPrompt);
    setComposerFocusRequest((request) => request + 1);
  };
  return <div className="chat-canvas flex h-full min-h-0 justify-center">
    <section ref={chatSectionRef} className={`chat-workspace-section ${showLanding ? "landing-active" : ""}`.trim()}>
      {!showLanding ? <header className="chat-page-header"><div><h1 className="chat-page-title">{route.label}</h1><p className="chat-page-subtitle">{chatSubtitle}</p></div></header> : null}
      <div className="chat-message-scroll">
        <div className="chat-message-column">
          <WorkbenchMessageSurface messages={renderedUIMessages} locale={locale} pendingMessageId={activeRunId || desktopChat.status === "submitted" || desktopChat.status === "streaming" ? activeAssistantMessageId : undefined} onReachTop={onReachTop} scrollStateKey={conversationId ?? undefined} restoreScrollTop={conversationScrollTop} onViewportScroll={(viewport) => onConversationScroll?.(viewport.scrollTop)} onCopy={(message) => navigator.clipboard?.writeText(desktopUIMessageText(message))} onRetry={(message) => { const index = renderedUIMessages.findIndex((item) => item.id === message.id); const previous = [...renderedUIMessages.slice(0, index)].reverse().find((item) => item.role === "user"); const retryPrompt = previous ? desktopUIMessageText(previous) : activePrompt; if (retryPrompt.trim()) onRun(retryPrompt); }} onToolApproval={onToolApproval} onArtifactOpen={(artifact) => onArtifactOpen(artifact.relativePath, artifact.mimeType)} onArtifactDownload={onArtifactDownload} resolveMediaSource={resolveDesktopMediaSource} resolveArtifactSource={resolveDesktopArtifactSource} />
          {conversationLoading ? <div className="chat-conversation-loading muted" role="status">{locale === "zh" ? "正在加载会话…" : "Loading conversation…"}</div> : null}
          {showLanding ? <div className="chat-landing" data-cloud-surface="ai-entry"><div className="chat-landing-kicker"><span className="public-signal" aria-hidden="true" /><span className="dashboard-kicker">AI WORKSPACE</span></div><h1 className="dashboard-title">{route.label}</h1><p>{locale === "zh" ? "选择一个推荐任务，或在下方直接描述你的需求" : "Choose a recommended task, or describe your request below"}</p><Suggestions className="chat-ai-suggestions chat-prompt-card-grid" data-cloud-surface="prompt-suggestions" aria-label={locale === "zh" ? "推荐提示词" : "Recommended prompts"}>{quickPrompts.map((item, index) => <Suggestion key={item} className="chat-prompt-card" suggestion={item} onClick={revealComposer}><span className="chat-prompt-card-index">{String(index + 1).padStart(2, "0")}</span><span className="chat-prompt-card-copy">{item}</span><span className="chat-prompt-card-arrow" aria-hidden="true">↗</span></Suggestion>)}</Suggestions></div> : null}
        </div>
      </div>
      <div ref={composerDockRef} className="chat-composer-dock"><div className="chat-composer" data-cloud-surface="composer"><WorkbenchPromptInput value={prompt} onValueChange={onPromptChange} onSubmit={submitMessage} attachments={attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, status: attachment.status, error: attachment.error }))} onAddAttachments={onAddAttachments} onRemoveAttachment={onRemoveAttachment} models={modelOptions} model={model} onModelChange={onModelChange} placeholder={chatPlaceholder} status={activeRunId || desktopChat.status === "submitted" || desktopChat.status === "streaming" ? "streaming" : "ready"} onStop={stopChat} autoFocus={showLanding && !activeRunId} focusRequest={composerFocusRequest} locale={locale}>{route.path.includes("?") ? <div className="composer-selected-agent">{locale === "zh" ? "当前 Agent" : "Selected Agent"}：<strong>{route.label}</strong></div> : null}{knowledgeEnabled ? <div className="composer-knowledge-control"><button type="button" className="composer-knowledge-button" onClick={onKnowledgeToggle}>{locale === "zh" ? "⌑ Obsidian 知识库" : "⌑ Obsidian context"}</button><button type="button" className="composer-knowledge-close" aria-label={locale === "zh" ? "关闭 Obsidian 知识库上下文" : "Disable Obsidian knowledge"} onClick={onKnowledgeToggle}>×</button></div> : <button type="button" className="composer-knowledge-button" onClick={onKnowledgeToggle}>{locale === "zh" ? "⌑ 添加 Obsidian 知识库" : "⌑ Add Obsidian context"}</button>}<div className="composer-ai-controls"><span className="muted composer-hint">{localizedRunStatus || (locale === "zh" ? "Enter 发送 · Shift+Enter 换行" : "Enter to send · Shift+Enter for a new line")}</span><ModelControls locale={locale} model={model} models={models} reasoningEffort={reasoningEffort} skillId={skillId} showSkill={false} hideModel onModelChange={onModelChange} onReasoningChange={onReasoningChange} onSkillChange={onSkillChange} /></div></WorkbenchPromptInput></div></div>
    </section>
  </div>;
}

type DesktopWriterCloudWorkspaceProps = {
  locale: "zh" | "en";
  route: DesktopRoute;
  prompt: string;
  onPromptChange: (value: string) => void;
  runStatus: string;
  activeRunId: string | null;
  onRun: (value: string, displayedValue?: string) => void;
  onGenerateImages?: (article: DesktopUIMessage) => void;
  onCancel: () => void;
  activePrompt: string;
  activePromptAt?: string;
  assistantText: string;
  onAssistantTextChange: (value: string) => void;
  onSaveDraft: (value: string) => void | Promise<unknown>;
  onExportDraft?: (value: string) => void | Promise<void>;
  assistantAt?: string;
  messages: DesktopConversationMessage[];
  uiMessages: readonly DesktopUIMessage[];
  onArtifactDownload?: (artifactId: string) => void;
  activeAssistantParts?: readonly DesktopUIMessagePart[];
  toolEvents: string[];
  artifacts: Array<{ id: string; relative_path: string; mime_type: string; byte_length?: number }>;
  onArtifactOpen: (relativePath: string, mimeType: string) => void;
  model: string;
  models?: readonly string[];
  reasoningEffort: string;
  skillId: SkillId;
  attachments: LocalAttachment[];
  onAddAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  knowledgeEnabled: boolean;
  onKnowledgeToggle: () => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  onToolApproval?: (message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") => void | Promise<void>;
  onReachTop?: (viewport: HTMLDivElement) => void;
  conversationId?: string | null;
  conversationScrollTop?: number;
  onConversationScroll?: (scrollTop: number) => void;
};

function writerOptionLabel(kind: "platform" | "content" | "mode" | "language", item: { id: string; label: string }, locale: "zh" | "en") {
  if (locale === "zh") return item.label;
  const maps = { platform: writerPlatformEnglish, content: writerContentTypeEnglish, mode: writerModeEnglish, language: writerLanguageEnglish };
  return maps[kind][item.id] ?? item.label;
}

function isWriterArticleMessage(message: DesktopUIMessage) {
  return message.role === "assistant"
    && Boolean(desktopUIMessageText(message).trim())
    && !message.parts.some((part) => part.type === "data-writerAsset" || (part.type === "data-artifact" && part.data.mimeType.startsWith("image/")));
}

function WriterPreviewImage({ artifact, locale, onOpen }: { artifact: DesktopArtifactData; locale: "zh" | "en"; onOpen: (artifact: DesktopArtifactData) => void }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let revoke: (() => void) | undefined;
    void resolveDesktopArtifactSource(artifact).then((resolved) => {
      if (!active) { resolved?.revoke?.(); return; }
      revoke = resolved?.revoke;
      setSource(resolved?.url ?? null);
    }).catch(() => { if (active) setSource(null); });
    return () => { active = false; revoke?.(); };
  }, [artifact.id, artifact.mimeType, artifact.relativePath]);
  const title = artifact.title || artifact.relativePath;
  return <button type="button" className="writer-preview-image" onClick={() => onOpen(artifact)} aria-label={locale === "zh" ? `打开配图：${title}` : `Open image: ${title}`}>
    {source ? <Image src={source} alt={title} /> : <span>{locale === "zh" ? "正在加载配图…" : "Loading image…"}</span>}
  </button>;
}

function WriterArticleImages({ artifacts, locale, onOpen }: { artifacts: readonly DesktopArtifactData[]; locale: "zh" | "en"; onOpen: (artifact: DesktopArtifactData) => void }) {
  if (!artifacts.length) return null;
  return <section className="writer-preview-images" aria-label={locale === "zh" ? "文章配图" : "Article images"}>
    <strong>{locale === "zh" ? "文章配图" : "Article images"}</strong>
    <div>{artifacts.map((artifact) => <WriterPreviewImage key={artifact.id} artifact={artifact} locale={locale} onOpen={onOpen} />)}</div>
  </section>;
}

function WriterPlatformPreview({ platform, locale, content, images = [], onImageOpen }: { platform: string; locale: "zh" | "en"; content: string; images?: readonly DesktopArtifactData[]; onImageOpen: (artifact: DesktopArtifactData) => void }) {
  const platformOption = WORKBENCH_WRITER_PLATFORMS.find((item) => item.id === platform) ?? WORKBENCH_WRITER_PLATFORMS[0];
  const platformLabel = writerOptionLabel("platform", platformOption, locale);
  const layout = ["xiaohongshu", "douyin", "instagram", "tiktok"].includes(platform) ? "mobile" : ["weibo", "x", "linkedin", "facebook", "reddit"].includes(platform) ? "social" : "article";
  const accountName = locale === "zh" ? "CoworkAny 周刊" : "CoworkAny Weekly";
  const body = <><MessageResponse content={content} className="writer-platform-preview-markdown" /><WriterArticleImages artifacts={images} locale={locale} onOpen={onImageOpen} /></>;
  const chrome = <div className="writer-platform-preview-chrome" aria-hidden="true"><span /><span /><span /></div>;

  if (platform === "wechat") {
    return <div className={`writer-platform-preview writer-platform-preview-${platform} writer-platform-preview-layout-${layout}`} data-testid="writer-platform-preview" data-platform={platform} data-layout={layout}>
      {chrome}
      <div className="writer-platform-preview-wechat-header"><strong>{platformLabel}</strong><span>{accountName} · {locale === "zh" ? "公众号文章" : "Official account article"}</span></div>
      <article className="writer-platform-preview-body">{body}</article>
    </div>;
  }

  if (platform === "xiaohongshu") {
    return <div className={`writer-platform-preview writer-platform-preview-${platform} writer-platform-preview-layout-${layout}`} data-testid="writer-platform-preview" data-platform={platform} data-layout={layout}>
      {chrome}
      <div className="writer-platform-preview-mobile-account"><span className="writer-platform-preview-avatar">A</span><strong>{accountName}</strong><span>{locale === "zh" ? "关注" : "Follow"}</span></div>
      <article className="writer-platform-preview-body">{body}</article>
      <div className="writer-platform-preview-footer">{locale === "zh" ? "收藏  ·  评论  ·  分享" : "Save  ·  Comment  ·  Share"}</div>
    </div>;
  }

  if (["weibo", "x", "linkedin", "facebook", "reddit"].includes(platform)) {
    return <div className={`writer-platform-preview writer-platform-preview-${platform} writer-platform-preview-layout-${layout}`} data-testid="writer-platform-preview" data-platform={platform} data-layout={layout}>
      {chrome}
      <div className="writer-platform-preview-social-account"><span className="writer-platform-preview-avatar">A</span><div><strong>{accountName}</strong><span>@coworkany · {locale === "zh" ? "刚刚" : "Just now"}</span></div></div>
      <article className="writer-platform-preview-body">{body}</article>
      <div className="writer-platform-preview-footer">♡  128   ↻  42   {locale === "zh" ? "分享" : "Share"}</div>
    </div>;
  }

  return <div className={`writer-platform-preview writer-platform-preview-${platform} writer-platform-preview-layout-${layout}`} data-testid="writer-platform-preview" data-platform={platform} data-layout={layout}>
    {chrome}
    <div className="writer-platform-preview-header"><strong>{platformLabel}</strong><span>{locale === "zh" ? "正文预览" : "Body preview"}</span></div>
    <article className="writer-platform-preview-body">{body}</article>
    <div className="writer-platform-preview-footer">{platform === "generic" ? (locale === "zh" ? "通用内容" : "Generic content") : platformLabel}</div>
  </div>;
}

function DesktopWriterCloudWorkspace(props: DesktopWriterCloudWorkspaceProps) {
  const { locale, route, prompt, onPromptChange, runStatus, activeRunId, onRun, onGenerateImages, onCancel, activePrompt, activePromptAt, assistantText, onAssistantTextChange, onSaveDraft, onExportDraft, assistantAt, messages, uiMessages, onArtifactDownload, activeAssistantParts, toolEvents, artifacts, onArtifactOpen, model, models, reasoningEffort, skillId, attachments, onAddAttachments, onRemoveAttachment, knowledgeEnabled, onKnowledgeToggle, onModelChange, onReasoningChange, onSkillChange, onToolApproval, onReachTop, conversationId, conversationScrollTop, onConversationScroll } = props;
  const writerCopy = desktopWriterCopy[locale];
  const writerQuickPrompts = locale === "zh" ? WORKBENCH_WRITER_QUICK_PROMPTS : ["Write a high-converting campaign article", "Turn this brief into a social media thread", "Create a concise product launch email"];
  const localizedStatus = localizeDesktopStatus(runStatus, locale);
  const localizedRunStatus = isDesktopErrorStatus(localizedStatus) ? "" : localizedStatus;
  const [platform, setPlatform] = useState("wechat");
  const [contentType, setContentType] = useState("longform");
  const [mode, setMode] = useState("article");
  const [language, setLanguage] = useState("auto");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<DesktopUIMessage | null>(null);
  const [previewEditing, setPreviewEditing] = useState(false);
  const [previewDraft, setPreviewDraft] = useState(assistantText);
  const [copyKind, setCopyKind] = useState<"rich" | "markdown" | null>(null);
  const messageSurfaceRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const baseMessages = messages.length ? messages : (activePrompt ? [{ id: "active-user", conversationId: "active", role: "user" as const, content: activePrompt, createdAt: activePromptAt ?? new Date(0).toISOString() }] : []);
  const hasPersistedAssistant = !activeRunId && baseMessages.some((message) => message.role === "assistant" && message.content === assistantText);
  const currentAssistant = Boolean(assistantText || activeRunId) && !hasPersistedAssistant;
  const activeAssistantMessageId = activeRunId ? `assistant-${activeRunId}` : "active-assistant";
  const displayedMessages: DesktopConversationMessage[] = currentAssistant ? [...baseMessages, { id: activeAssistantMessageId, conversationId: "active", role: "assistant" as const, content: assistantText, createdAt: assistantAt ?? activePromptAt ?? new Date(0).toISOString(), runId: activeRunId ?? undefined, status: activeRunId ? "running" as const : "succeeded" as const, parts: activeAssistantParts?.length ? activeAssistantParts : [
    ...(assistantText ? [{ type: "text" as const, text: assistantText, state: "streaming" as const }] : []),
    ...toolEvents.map((item, index) => ({ type: "data-status" as const, id: `active-assistant:tool:${index}`, data: { status: "running" as const, message: item } })),
    ...artifacts.map((artifact) => ({ type: "data-artifact" as const, id: `active-assistant:artifact:${artifact.id}`, data: { id: artifact.id, title: artifact.relative_path, relativePath: artifact.relative_path, mimeType: artifact.mime_type, byteLength: artifact.byte_length ?? 0, sha256: "" } })),
  ] }] : baseMessages;
  const displayedUIMessages = displayedMessages.map(desktopConversationMessageToUIMessage);
  const renderedUIMessages = mergeDesktopUIMessageViews(displayedUIMessages, uiMessages, activeAssistantMessageId);
  const hasMessages = displayedMessages.length > 0;
  const latestArticle = [...renderedUIMessages].reverse().find(isWriterArticleMessage);
  const selectedPreviewMessage = previewMessage ?? latestArticle ?? null;
  const previewText = selectedPreviewMessage ? desktopUIMessageText(selectedPreviewMessage) : assistantText;
  const previewImages = useMemo(() => selectedPreviewMessage ? writerImageArtifactsForArticle(renderedUIMessages, selectedPreviewMessage.id) : [], [renderedUIMessages, selectedPreviewMessage]);
  const canEditPreview = selectedPreviewMessage?.id === latestArticle?.id;
  const openPreview = (message: DesktopUIMessage) => { setPreviewMessage(message); setPreviewEditing(false); setPreviewDraft(desktopUIMessageText(message)); setPreviewOpen(true); };
  const commitPreviewDraft = () => { const next = previewDraft.trim(); if (!next || !canEditPreview) return; onAssistantTextChange(next); setPreviewEditing(false); void onSaveDraft(next); };
  const submit = () => onRun([
    `${writerCopy.platform}: ${writerOptionLabel("platform", WORKBENCH_WRITER_PLATFORMS.find((item) => item.id === platform) ?? { id: platform, label: platform }, locale)}`,
    `${writerCopy.content}: ${writerOptionLabel("content", WORKBENCH_WRITER_CONTENT_TYPES.find((item) => item.id === contentType) ?? { id: contentType, label: contentType }, locale)}`,
    `${writerCopy.mode}: ${writerOptionLabel("mode", WORKBENCH_WRITER_MODES.find((item) => item.id === mode) ?? { id: mode, label: mode }, locale)}`,
    `${writerCopy.language}: ${writerOptionLabel("language", WORKBENCH_WRITER_LANGUAGES.find((item) => item.id === language) ?? { id: language, label: language }, locale)}`,
    assistantText.trim() ? `${locale === "zh" ? "当前已编辑草稿" : "Current edited draft"}:\n${assistantText.trim()}` : "",
    prompt.trim(),
  ].filter(Boolean).join("\n"), prompt);
  const copyText = async (kind: "rich" | "markdown", message: DesktopUIMessage) => {
    const text = previewEditing ? previewDraft : desktopUIMessageText(message);
    const messageRow = Array.from(messageSurfaceRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []).find((row) => row.dataset.messageId === message.id);
    const renderedHtml = messageRow?.querySelector(".ai-elements-message-response")?.innerHTML
      ?? previewContentRef.current?.querySelector(".ai-elements-message-response")?.innerHTML;
    const html = kind === "rich" ? renderedHtml ?? `<div>${escapeWriterHtml(text)}</div>` : undefined;
    try {
      if (await copyWriterContent(text, html)) {
        setCopyKind(kind);
        window.setTimeout(() => setCopyKind(null), 1400);
      } else setCopyKind(null);
    } catch { setCopyKind(null); }
  };
  return (
    <div className="chat-canvas flex h-full min-h-0 justify-center">
      <section className="chat-workspace-section writer-cloud-workspace">
        <header className="chat-page-header"><div><h1 className="chat-page-title">{route.label}</h1><p className="chat-page-subtitle">{route.description}</p></div></header>
        <div className="writer-cloud-scroll chat-message-scroll"><div className="chat-message-column">
          {!hasMessages ? <div className="writer-quick-start"><div className="dashboard-kicker">{writerCopy.quick}</div><div className="writer-quick-start-grid">{writerQuickPrompts.map((item) => <button key={item} type="button" className="home-quick-start-card" onClick={() => onPromptChange(item)}><span className="dashboard-kicker">✦ {writerCopy.quickStart}</span><span>{item}</span></button>)}</div></div> : null}
          <div ref={messageSurfaceRef} className="writer-cloud-message-shell"><WorkbenchMessageSurface className="writer-cloud-message-surface" messages={renderedUIMessages} locale={locale} pendingMessageId={activeRunId ? activeAssistantMessageId : undefined} onReachTop={onReachTop} scrollStateKey={conversationId ?? undefined} restoreScrollTop={conversationScrollTop} onViewportScroll={(viewport) => onConversationScroll?.(viewport.scrollTop)} onRetry={(message) => { const index = renderedUIMessages.findIndex((item) => item.id === message.id); const previous = [...renderedUIMessages.slice(0, index)].reverse().find((item) => item.role === "user"); const retryPrompt = previous ? desktopUIMessageText(previous) : activePrompt; if (retryPrompt.trim()) onRun(retryPrompt); }} renderAssistantActions={(message) => {
            const bodyText = desktopUIMessageText(message);
            if (!bodyText.trim() || !isWriterArticleMessage(message)) return null;
            return <>
              <MessageAction label={writerCopy.preview} title={writerCopy.preview} onClick={() => openPreview(message)}><Eye size={14} aria-hidden="true" /></MessageAction>
              <MessageAction label={writerCopy.generateImage} title={writerCopy.generateImage} onClick={() => onGenerateImages?.(message)} disabled={!onGenerateImages || Boolean(activeRunId)}><ImagePlus size={14} aria-hidden="true" /></MessageAction>
              <MessageAction label={copyKind === "rich" ? writerCopy.copied : writerCopy.rich} title={copyKind === "rich" ? writerCopy.copied : writerCopy.rich} onClick={() => void copyText("rich", message)}><CopyIcon size={14} aria-hidden="true" /></MessageAction>
              <MessageAction label={copyKind === "markdown" ? writerCopy.copied : writerCopy.markdown} title={copyKind === "markdown" ? writerCopy.copied : writerCopy.markdown} onClick={() => void copyText("markdown", message)}><FileText size={14} aria-hidden="true" /></MessageAction>
            </>;
          }} onToolApproval={onToolApproval} onArtifactOpen={(artifact) => onArtifactOpen(artifact.relativePath, artifact.mimeType)} onArtifactDownload={onArtifactDownload} resolveMediaSource={resolveDesktopMediaSource} resolveArtifactSource={resolveDesktopArtifactSource} /></div>
          {!hasMessages && localizedRunStatus ? <div className="writer-status-message">{localizedRunStatus}</div> : null}
        </div></div>
        <div className="chat-composer-dock"><div className="chat-composer writer-cloud-composer"><WorkbenchPromptInput value={prompt} onValueChange={onPromptChange} onSubmit={submit} attachments={attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, status: attachment.status, error: attachment.error }))} onAddAttachments={onAddAttachments} onRemoveAttachment={onRemoveAttachment} models={(models ?? []).map((item) => ({ id: item, label: formatWorkbenchModelLabel(item, { zh: "本地模型", en: "Local model" }, locale), provider: locale === "zh" ? "已配置模型" : "Configured models" }))} model={model} onModelChange={onModelChange} placeholder={writerCopy.placeholder} status={activeRunId ? "streaming" : "ready"} onStop={onCancel} locale={locale}><div className="writer-composer-options"><span>{writerOptionLabel("platform", WORKBENCH_WRITER_PLATFORMS.find((item) => item.id === platform) ?? { id: platform, label: platform }, locale)} / {writerOptionLabel("mode", WORKBENCH_WRITER_MODES.find((item) => item.id === mode) ?? { id: mode, label: mode }, locale)} / {writerOptionLabel("language", WORKBENCH_WRITER_LANGUAGES.find((item) => item.id === language) ?? { id: language, label: language }, locale)} / {writerCopy.previewHint}</span>{knowledgeEnabled ? <span className="composer-knowledge-control"><button type="button" className="composer-knowledge-button" onClick={onKnowledgeToggle}>{locale === "zh" ? "⌑ Obsidian 知识库" : "⌑ Obsidian context"}</button><button type="button" className="composer-knowledge-close" aria-label={locale === "zh" ? "关闭 Obsidian 知识库上下文" : "Disable Obsidian knowledge"} onClick={onKnowledgeToggle}>×</button></span> : <button type="button" className="composer-knowledge-button" onClick={onKnowledgeToggle}>{locale === "zh" ? "⌑ 添加 Obsidian 知识库" : "⌑ Add Obsidian context"}</button>}<ModelControls locale={locale} model={model} models={models} providerSource={formatWorkbenchModelLabel(model, { zh: "本地模型", en: "Local model" }, locale)} reasoningEffort={reasoningEffort} skillId={skillId} showSkill={false} hideModel onModelChange={onModelChange} onReasoningChange={onReasoningChange} onSkillChange={onSkillChange} /></div></WorkbenchPromptInput></div></div>
        {previewOpen ? <div className="writer-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="writer-preview-title"><section className="writer-preview-sheet"><header><div><div className="dashboard-kicker">{writerCopy.preview}</div><h2 id="writer-preview-title">{writerCopy.finalPreview}</h2><p className="writer-preview-description">{writerCopy.previewHint}</p></div><button type="button" className="ghost" onClick={() => setPreviewOpen(false)}>{writerCopy.close}</button></header>{previewEditing ? <textarea className="writer-preview-editor" data-testid="writer-preview-editor" aria-label={writerCopy.edit} autoFocus value={previewDraft} onChange={(event) => setPreviewDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); commitPreviewDraft(); } if (event.key === "Escape") { event.preventDefault(); setPreviewDraft(previewText); setPreviewEditing(false); } }} /> : <div ref={previewContentRef} className="writer-preview-content" data-testid="writer-preview-content"><WriterPlatformPreview platform={platform} locale={locale} content={previewText} images={previewImages} onImageOpen={(artifact) => onArtifactOpen(artifact.relativePath, artifact.mimeType)} /></div>}<div className="writer-preview-actions"><button type="button" className="dashboard-button-secondary" data-testid="writer-preview-edit" onClick={() => { if (previewEditing) commitPreviewDraft(); else setPreviewEditing(true); }} disabled={!canEditPreview || !previewText}>{previewEditing ? writerCopy.done : writerCopy.edit}</button><button type="button" className="dashboard-button-primary" data-testid="writer-preview-copy-rich" onClick={() => selectedPreviewMessage && void copyText("rich", selectedPreviewMessage)} disabled={!selectedPreviewMessage}>{copyKind === "rich" ? writerCopy.copied : writerCopy.rich}</button><button type="button" className="dashboard-button-secondary" data-testid="writer-preview-copy-markdown" onClick={() => selectedPreviewMessage && void copyText("markdown", selectedPreviewMessage)} disabled={!selectedPreviewMessage}>{copyKind === "markdown" ? writerCopy.copied : writerCopy.markdown}</button>{onExportDraft ? <button type="button" className="dashboard-button-secondary" data-testid="writer-preview-export" onClick={() => void onExportDraft(previewEditing ? previewDraft : previewText)} disabled={!previewText}>{writerCopy.export}</button> : null}<button type="button" className="dashboard-button-secondary" onClick={() => { setPreviewOpen(false); if (selectedPreviewMessage) onGenerateImages?.(selectedPreviewMessage); }} disabled={!selectedPreviewMessage}>{writerCopy.generateImageWithCopy}</button><button type="button" className="ghost" onClick={() => setPreviewOpen(false)}>{writerCopy.done}</button></div></section></div> : null}
      </section>
    </div>
  );
}

function DesktopWorkflowUploadEditor({ node, locale, onSelectFiles, onChange }: {
  node: WorkflowDefinitionNodeV2;
  locale: "zh" | "en";
  onSelectFiles: () => Promise<WorkflowLocalFile[]>;
  onChange: (files: WorkflowLocalFile[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const localFilesAvailable = isTauriBridgeAvailable();
  const files = Array.isArray(node.config.uploadedFiles)
    ? node.config.uploadedFiles.filter((item): item is WorkflowLocalFile => Boolean(item && typeof item === "object" && typeof (item as WorkflowLocalFile).fileName === "string" && (typeof (item as WorkflowLocalFile).localPath === "string" || typeof (item as WorkflowLocalFile).relativePath === "string")))
    : [];
  const previewFile = files.find((file) => file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/"));
  useEffect(() => {
    if (!previewFile) {
      setPreviewSource(null);
      setPreviewError(false);
      return undefined;
    }
    let active = true;
    let source: string | null = null;
    setPreviewSource(null);
    setPreviewError(false);
    const command = previewFile.localPath ? "read_workflow_local_file" : "read_artifact";
    const args = previewFile.localPath ? { localPath: previewFile.localPath, mimeType: previewFile.mimeType } : { relativePath: previewFile.relativePath, mimeType: previewFile.mimeType };
    void tauriBridge.invoke<LocalMediaPreview>(command, args)
      .then((payload) => {
        if (!active) return;
        source = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType }));
        setPreviewSource(source);
      })
      .catch(() => { if (active) setPreviewError(true); });
    return () => {
      active = false;
      if (source) URL.revokeObjectURL(source);
    };
  }, [previewFile?.localPath, previewFile?.mimeType, previewFile?.relativePath]);
  const handleSelect = async () => {
    setBusy(true);
    setError(null);
    try {
      const selected = await onSelectFiles();
      if (selected.length) onChange([...files, ...selected].slice(0, 8));
    } catch (selectionError) {
      const message = localFileUploadErrorCode(selectionError);
      setError(message === "tauri_bridge_unavailable" || message === "desktop_file_selection_unavailable"
        ? (locale === "zh" ? "本地文件选择仅支持桌面客户端，请从桌面应用打开工作流。" : "Local file selection is available only in the desktop app. Open this workflow from the desktop client.")
        : (message || (locale === "zh" ? "文件选择失败" : "Unable to select files")));
    } finally {
      setBusy(false);
    }
  };
  const fileKind = (file: WorkflowLocalFile) => file.mimeType.startsWith("image/") ? "IMG" : file.mimeType.startsWith("video/") ? "VID" : file.mimeType.startsWith("audio/") ? "AUD" : file.mimeType.includes("pdf") ? "PDF" : file.mimeType.includes("presentation") ? "PPT" : "FILE";
  return <div className="workflow-upload-editor" data-node-no-drag="true">
    <div className="workflow-upload-toolbar"><div><strong>{locale === "zh" ? "本地文件" : "Local files"}</strong><small>{localFilesAvailable ? (locale === "zh" ? "仅记录本机地址，运行时按 Provider 上传" : "Paths stay local; the Provider receives files only when the workflow runs") : (locale === "zh" ? "请从桌面客户端打开以添加文件" : "Open in the desktop client to add files")}</small></div><button type="button" className="workflow-upload-button" disabled={busy || !localFilesAvailable} title={localFilesAvailable ? undefined : (locale === "zh" ? "本地文件选择仅支持桌面客户端" : "Local file selection is available only in the desktop app")} onClick={() => void handleSelect()}>{busy ? (locale === "zh" ? "读取中…" : "Reading…") : (locale === "zh" ? "选择文件" : "Choose files")}</button></div>
    {previewFile ? <div className="workflow-upload-media-preview" data-node-media="true">{previewSource ? previewFile.mimeType.startsWith("image/") ? <img src={previewSource} alt={previewFile.fileName} /> : <video controls preload="metadata" src={previewSource} /> : <div className="workflow-upload-preview-pending"><span>{fileKind(previewFile)}</span><small>{previewError ? (locale === "zh" ? "预览不可用，仍可在工作流中使用该文件" : "Preview unavailable; the file remains available to this workflow") : (locale === "zh" ? "正在加载完整预览…" : "Loading full preview…")}</small></div>}</div> : null}
    {files.length ? <div className={`workflow-upload-list ${previewFile ? "has-media-preview" : "documents-only"}`}>{files.map((file, index) => <div className="workflow-upload-item" key={`${file.localPath ?? file.relativePath ?? file.fileName}-${index}`}><span className="workflow-upload-file-icon" aria-hidden="true">{fileKind(file)}</span><div><strong title={file.localPath ?? file.relativePath ?? file.fileName}>{file.fileName}</strong><small>{file.mimeType} · {Math.max(1, Math.ceil(file.byteLength / 1024))} KB</small></div><button type="button" data-node-no-drag="true" aria-label={locale === "zh" ? `移除 ${file.fileName}` : `Remove ${file.fileName}`} onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div> : <small className="workflow-upload-empty">{locale === "zh" ? "尚未选择文件" : "No files selected"}</small>}
    {error ? <small className="workflow-upload-error" role="alert">{error}</small> : null}
  </div>;
}

type DesktopWorkflowWorkspaceProps = {
  route: DesktopRoute;
  onBack: () => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  runStatus: string;
  activeRunId: string | null;
  onRun: (definition: WorkflowDefinitionEnvelope) => void;
  onRerun?: (definition: WorkflowDefinitionEnvelope) => void;
  onContinue?: () => void;
  onCancel: () => void;
  lastRunStatus?: string | null;
  savedWorkflows: SavedWorkflow[];
  workflowAction: WorkflowAction;
  onWorkflowAction: (value: WorkflowAction) => void;
  definition: WorkflowDefinitionEnvelope | null;
  onDefinitionChange: (value: WorkflowDefinitionEnvelope) => void;
  workflowMetadata: WorkflowMetadata;
  onWorkflowMetaChange: (patch: Partial<WorkflowMetadata>) => void;
  onSave: (definition: WorkflowDefinitionEnvelope) => Promise<boolean>;
  onExport: (definition: WorkflowDefinitionEnvelope) => Promise<boolean>;
  onImport: (file: File) => Promise<boolean>;
  model: string;
  models?: readonly string[];
  modelForNode?: (nodeType: string, providerId?: string) => string;
  modelsForNode?: (nodeType: string, providerId?: string) => readonly string[];
  providersForNode?: (nodeType: string) => readonly DesktopProviderConfig[];
  reasoningEffort: string;
  skillId: SkillId;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  providerConfiguredForNode: (nodeType: string) => boolean;
  providerSourceForNode?: (nodeType: string) => string;
  onSelectWorkflowFiles: () => Promise<WorkflowLocalFile[]>;
  nodeExecutionSnapshots: WorkflowCanvasExecutionSnapshot[];
};

function DesktopWorkflowCanvas({
  nodes,
  edges,
  selectedNodeKey,
  onSelectNode,
  onMoveNode,
  providerConfigured = activeMediaProviderConfigured,
  providerConfiguredForNode = () => providerConfigured,
  providerSourceForNode = () => "",
  locale,
  pendingConnectionSourceKey,
  onStartConnection,
  onConnect,
  onCancelConnection,
  onDeleteEdge,
  onDeleteNode,
  onDuplicateNode,
  onDuplicateNodes,
  onAddNodeAtPoint,
  onUpdateNode,
  onUpdateNodeParameter,
  onSelectWorkflowFiles,
  onMoveNodes,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  modelOptions = [],
  modelLabel,
  hideWorkflowReference = false,
  providerOptions = [],
  nodeExecutionSnapshots = [],
  initialViewport = { x: 300, y: 80, scale: 0.62 },
}: {
  nodes: WorkflowDefinitionNodeV2[];
  edges: WorkflowDefinitionEnvelope["edges"];
  selectedNodeKey: string | null;
  onSelectNode: (nodeKey: string) => void;
  onMoveNode: (nodeKey: string, position: { x: number; y: number }) => void;
  providerConfigured?: boolean;
  providerConfiguredForNode?: (nodeType: string) => boolean;
  providerSourceForNode?: (nodeType: string) => string;
  locale: "zh" | "en";
  pendingConnectionSourceKey?: string | null;
  onStartConnection?: (nodeKey: string) => void;
  onConnect?: (sourceNodeKey: string, targetNodeKey: string, sourcePortId: string, targetPortId: string) => void;
  onCancelConnection?: () => void;
  onDeleteEdge?: (edge: WorkflowDefinitionEnvelope["edges"][number]) => void;
  onDeleteNode?: (nodeKey: string) => void;
  onDuplicateNode?: (nodeKey: string) => void;
  onDuplicateNodes?: (nodeKeys: string[], offset: { x: number; y: number }) => string[];
  onAddNodeAtPoint?: (type: WorkflowAction, position: { x: number; y: number }) => void;
  onUpdateNode?: (nodeKey: string, patch: Partial<WorkflowDefinitionNodeV2>) => void;
  onUpdateNodeParameter?: (nodeKey: string, key: string, value: WorkflowParameterValue) => void;
  onSelectWorkflowFiles?: () => Promise<WorkflowLocalFile[]>;
  onMoveNodes?: (moves: Array<{ nodeKey: string; position: { x: number; y: number } }>) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  modelOptions?: readonly { value: string; label: string }[];
  modelLabel?: string;
  hideWorkflowReference?: boolean;
  providerOptions?: readonly { value: string; label: string }[];
  nodeExecutionSnapshots?: WorkflowCanvasExecutionSnapshot[];
  initialViewport?: { x: number; y: number; scale: number };
}) {
  return <WorkbenchWorkflowCanvas
    locale={locale}
    nodes={nodes}
    edges={edges}
    selectedNodeKey={selectedNodeKey}
    nodeExecutionSnapshots={nodeExecutionSnapshots}
    renderNodeOutput={(node, snapshot) => <WorkflowOutputPreview node={node} snapshot={snapshot} locale={locale} />}
    pendingConnectionSourceKey={pendingConnectionSourceKey}
    initialViewport={initialViewport}
    providerConfiguredForNode={providerConfiguredForNode}
    isConnectionSlotEnabled={(target, targetPortId) => {
      if (target.type !== "video_generate") return true;
      const port = workflowNodeRegistry.get(target.type)?.inputs.find((candidate) => candidate.id === targetPortId);
      const providerSource = providerSourceForNode(target.type);
      // A workflow may not yet have a selected Provider. Preserve the canvas
      // contract in that state; execution validates the concrete profile.
      return !providerSource || supportsVideoMediaRole(resolveVideoMediaCapabilities(providerSource, String(target.config.model ?? "")), port?.role);
    }}
    requiresProviderForNode={(nodeType) => requiresConfiguredProviderForWorkflowAction(nodeType)}
    onSelectNode={(nodeKey) => { if (nodeKey) onSelectNode(nodeKey); }}
    onMoveNode={onMoveNode}
    onMoveNodes={onMoveNodes}
    onStartConnection={onStartConnection}
    onConnect={onConnect}
    onCancelConnection={onCancelConnection}
    onDeleteEdge={onDeleteEdge}
    onDeleteNode={onDeleteNode}
    onDuplicateNode={onDuplicateNode}
    onDuplicateNodes={onDuplicateNodes}
    onAddNodeAtPoint={onAddNodeAtPoint}
    onUpdateNode={onUpdateNode}
    canUndo={canUndo}
    canRedo={canRedo}
    onUndo={onUndo}
    onRedo={onRedo}
    renderNodeEditor={onUpdateNodeParameter ? (node) => {
      if (node.nodeKey !== selectedNodeKey) return null;
      const nodeModelOptions = [
        ...modelOptions,
        ...[node.config.selectedModelId, node.config.model].flatMap((value) => typeof value === "string" && value.trim() ? [{ value, label: value }] : []),
      ].filter((option, index, values) => values.findIndex((candidate) => candidate.value === option.value) === index);
      if (node.type === "upload" && onSelectWorkflowFiles) {
        return <DesktopWorkflowUploadEditor node={node as WorkflowDefinitionNodeV2} locale={locale} onSelectFiles={onSelectWorkflowFiles} onChange={(files) => onUpdateNode?.(node.nodeKey, { config: { uploadedFiles: files } })} />;
      }
      return <WorkbenchWorkflowParameterFields className="desktop-workflow-node-editor" locale={locale} node={node as WorkflowDefinitionNodeV2} modelOptions={nodeModelOptions} modelLabel={modelLabel} hideWorkflowReference={hideWorkflowReference} providerOptions={providerOptions} onUpdate={(key, value) => onUpdateNodeParameter(node.nodeKey, key, value)} />;
    } : undefined}
  />;
}

type WorkflowBuilderSurfaceProps = {
  route: DesktopRoute;
  onBack: () => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  runStatus: string;
  activeRunId: string | null;
  onRun: (definition: WorkflowDefinitionEnvelope) => void;
  onRerun: (definition: WorkflowDefinitionEnvelope) => void;
  onContinue: () => void;
  onCancel: () => void;
  lastRunStatus?: string | null;
  savedWorkflows: SavedWorkflow[];
  workflowActions: typeof workflowActionsBase;
  localDefinition: WorkflowDefinitionEnvelope;
  canvasNodes: WorkflowDefinitionNodeV2[];
  selectedNode?: WorkflowDefinitionNodeV2;
  selectedAction: (typeof workflowActionsBase)[number];
  issues: ReturnType<typeof validateWorkflowDefinition>;
  upstreamEdge?: WorkflowDefinitionEnvelope["edges"][number];
  upstreamOptions: WorkflowDefinitionNodeV2[];
  nodeParameters: Array<[string, string | number | boolean]>;
  providerConfiguredForNode: (nodeType: string) => boolean;
  providerSourceForNode?: (nodeType: string) => string;
  nodeExecutionSnapshots: WorkflowCanvasExecutionSnapshot[];
  pendingConnectionSourceKey: string | null;
  onStartConnection: (nodeKey: string) => void;
  onConnect: (sourceNodeKey: string, targetNodeKey: string, sourcePortId: string, targetPortId: string) => void;
  onCancelConnection: () => void;
  onDeleteEdge: (edge: WorkflowDefinitionEnvelope["edges"][number]) => void;
  onDeleteNode: (nodeKey: string) => void;
  onDuplicateNode: (nodeKey: string) => void;
  onDuplicateNodes: (nodeKeys: string[], offset: { x: number; y: number }) => string[];
  onSelectNode: (nodeKey: string) => void;
  onMoveNode: (nodeKey: string, position: { x: number; y: number }) => void;
  onMoveNodes: (moves: Array<{ nodeKey: string; position: { x: number; y: number } }>) => void;
  onAddNode: (type: WorkflowAction, position?: { x: number; y: number }) => void;
  onRemoveSelectedNode: () => void;
  onChangeNodeType: (nextType: WorkflowAction) => void;
  onSetUpstream: (sourceKey: string) => void;
  onUpdateNodeParameter: (key: string, value: WorkflowParameterValue) => void;
  onUpdateNodeConfig: (nodeKey: string, key: string, value: WorkflowParameterValue) => void;
  onUpdateNode: (nodeKey: string, patch: Partial<WorkflowDefinitionNodeV2>) => void;
  onSelectWorkflowFiles: () => Promise<WorkflowLocalFile[]>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  workflowMetadata: WorkflowMetadata;
  onWorkflowMetaChange: (patch: Partial<WorkflowMetadata>) => void;
  locale: "zh" | "en";
  model: string;
  models?: readonly string[];
  modelForNode?: (nodeType: string, providerId?: string) => string;
  modelsForNode?: (nodeType: string, providerId?: string) => readonly string[];
  providersForNode?: (nodeType: string) => readonly DesktopProviderConfig[];
  reasoningEffort: string;
  skillId: SkillId;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  onSave: (definition: WorkflowDefinitionEnvelope) => Promise<boolean>;
  onExport: (definition: WorkflowDefinitionEnvelope) => Promise<boolean>;
  onImport: (file: File) => Promise<boolean>;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  panelPosition: { left: { x: number; y: number }; right: { x: number; y: number } };
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  startPanelDrag: (panel: "left" | "right", event: React.PointerEvent<HTMLElement>) => void;
  movePanel: (event: React.PointerEvent<HTMLDivElement>) => void;
  endPanelDrag: () => void;
  consumePanelClick: () => boolean;
};

function runningHubWorkflowCapabilityForNode(node: WorkflowDefinitionNodeV2 | undefined): RunningHubWorkflowCapability | undefined {
  if (!node) return undefined;
  if (node.type === "image_generate") return "image";
  if (node.type === "digital_human") return "digital_human";
  if (node.type === "video_generate") return node.config.featureId === "video-enhance" ? "video_enhance" : "video";
  if (["music_generate", "voice_synthesis", "voice_clone", "audio_generate"].includes(node.type)) return "audio";
  return undefined;
}

function isRunningHubProvider(provider: DesktopProviderConfig | undefined) {
  return provider?.source?.trim().toLowerCase() === "runninghub";
}

type WorkflowOperationKind = "save" | "export" | "import";
type WorkflowOperationPhase = "running" | "success" | "error";
type WorkflowOperationState = { kind: WorkflowOperationKind; phase: WorkflowOperationPhase } | null;

function DesktopWorkflowBuilderSurface(props: WorkflowBuilderSurfaceProps) {
  const { locale, route, selectedNode, localDefinition, canvasNodes, issues } = props;
  const suppressPaletteClickRef = useRef(false);
  const operationInFlightRef = useRef(false);
  const operationTimerRef = useRef<number | null>(null);
  const [operationState, setOperationState] = useState<WorkflowOperationState>(null);
  const narrowCanvas = typeof window !== "undefined" && window.innerWidth < 1180;
  const canvasInitialViewport = narrowCanvas ? { x: 34, y: 78, scale: 0.54 } : { x: 100, y: 80, scale: 0.7 };
  const copy = locale === "zh"
    ? { save: "保存流程", export: "导出 JSON", import: "导入 JSON", host: "本地运行环境", nodesMenu: "节点菜单", workflow: "工作流信息", workflowTitle: "工作流标题", workflowDescription: "工作流说明", workflowStatus: "状态", nodes: "节点", canvas: "本地工作流画布", edges: "条连线", runnable: "可运行", input: "输入节点", output: "结果预览", capability: "能力节点", delete: "删除节点", editable: "可编辑配置", task: "任务内容", artifact: "产物策略", localOutput: "写入当前项目目录", artifactHint: "登记到本地 artifacts，不上传云端", ability: "能力", upstream: "上游节点", none: "不连接", runtime: "运行时", run: "运行工作流", rerun: "重新运行", continue: "继续运行", close: "收起", open: "展开", parameters: "节点参数" }
    : { save: "Save workflow", export: "Export JSON", import: "Import JSON", host: "Local runtime", nodesMenu: "Node menu", workflow: "Workflow info", workflowTitle: "Workflow title", workflowDescription: "Workflow description", workflowStatus: "Status", nodes: "nodes", canvas: "Local workflow canvas", edges: "edges", runnable: "ready", input: "Input node", output: "Result preview", capability: "Capability node", delete: "Delete node", editable: "Editable config", task: "Task", artifact: "Artifact policy", localOutput: "Write to current project", artifactHint: "Registered in local artifacts; never uploaded", ability: "Capability", upstream: "Upstream", none: "No connection", runtime: "Runtime", run: "Run workflow", rerun: "Rerun", continue: "Continue", close: "Collapse", open: "Expand", parameters: "Node parameters" };
  const operationText = (kind: WorkflowOperationKind, phase: WorkflowOperationPhase) => {
    if (locale === "zh") {
      const labels = { save: ["保存流程", "保存中…", "已保存", "保存失败"], export: ["导出 JSON", "导出中…", "已导出", "导出失败"], import: ["导入 JSON", "导入中…", "已导入", "导入失败"] } as const;
      const label = labels[kind];
      return phase === "running" ? label[1] : phase === "success" ? label[2] : phase === "error" ? label[3] : label[0];
    }
    const labels = { save: ["Save workflow", "Saving…", "Saved", "Save failed"], export: ["Export JSON", "Exporting…", "Exported", "Export failed"], import: ["Import JSON", "Importing…", "Imported", "Import failed"] } as const;
    const label = labels[kind];
    return phase === "running" ? label[1] : phase === "success" ? label[2] : phase === "error" ? label[3] : label[0];
  };
  const runBuilderOperation = async (kind: WorkflowOperationKind, operation: () => Promise<unknown>) => {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    if (operationTimerRef.current !== null) window.clearTimeout(operationTimerRef.current);
    setOperationState({ kind, phase: "running" });
    try {
      const result = await operation();
      setOperationState({ kind, phase: result === false ? "error" : "success" });
    } catch {
      setOperationState({ kind, phase: "error" });
    } finally {
      operationInFlightRef.current = false;
      operationTimerRef.current = window.setTimeout(() => setOperationState(null), 1800);
    }
  };
  useEffect(() => () => {
    if (operationTimerRef.current !== null) window.clearTimeout(operationTimerRef.current);
  }, []);
  const terminalRun = props.lastRunStatus ?? (!props.activeRunId
    ? /失败|failed/iu.test(props.runStatus) ? "failed" : /中断|取消|interrupted|cancelled/iu.test(props.runStatus) ? "cancelled" : /完成|succeeded/iu.test(props.runStatus) ? "succeeded" : ""
    : "");
  const canContinue = ["failed", "cancelled", "interrupted"].includes(terminalRun);
  const selectedProviderId = typeof selectedNode?.config.selectedProviderId === "string" ? selectedNode.config.selectedProviderId.trim() : "";
  const scopedProviders = selectedNode ? props.providersForNode?.(selectedNode.type) ?? [] : [];
  const selectedProvider = scopedProviders.find((provider) => provider.id === selectedProviderId);
  const runningHubCapability = runningHubWorkflowCapabilityForNode(selectedNode);
  const runningHubWorkflows = isRunningHubProvider(selectedProvider) && runningHubCapability
    ? selectedProvider?.workflows?.filter((workflow) => workflow.capability === runningHubCapability) ?? []
    : [];
  const runningHubModelOptions = runningHubWorkflows.map((workflow) => ({ value: workflow.remoteWorkflowId, label: `${workflow.name} · ${workflow.remoteWorkflowId}` }));
  const runningHubModelCatalog = Boolean(isRunningHubProvider(selectedProvider) && runningHubCapability);
  const scopedModels = runningHubModelCatalog
    ? runningHubModelOptions.map((workflow) => workflow.value)
    : selectedNode ? props.modelsForNode?.(selectedNode.type, selectedProvider?.id) : undefined;
  const scopedModel = selectedNode ? props.modelForNode?.(selectedNode.type, selectedProvider?.id) : undefined;
  const providerOptions = scopedProviders.map((provider) => ({ value: provider.id ?? "", label: provider.id ?? "" })).filter((option) => option.value);
  const selectedNodeModels = [selectedNode?.config.selectedModelId, selectedNode?.config.model].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const scopedModelPool = scopedModels === undefined ? [props.model, ...(props.models ?? [])] : [scopedModel, ...scopedModels];
  const retainedNodeModels = scopedModelPool.length
    ? selectedNodeModels.filter((value) => scopedModelPool.includes(value))
    : selectedNodeModels;
  const modelOptions = runningHubModelCatalog
    ? runningHubModelOptions
    : [...new Set([...retainedNodeModels, ...scopedModelPool].filter((value): value is string => typeof value === "string" && value.trim().length > 0))].map((value) => ({ value, label: value }));
  const startPaletteDrag = (event: React.PointerEvent<HTMLButtonElement>, type: WorkflowAction) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.dispatchEvent(new CustomEvent(WORKFLOW_PALETTE_DRAG_EVENT, { detail: { type, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY } }));
  };
  useEffect(() => {
    const suppressFollowupClick = () => {
      suppressPaletteClickRef.current = true;
      window.setTimeout(() => { suppressPaletteClickRef.current = false; }, 0);
    };
    window.addEventListener(WORKFLOW_PALETTE_DROP_EVENT, suppressFollowupClick);
    return () => window.removeEventListener(WORKFLOW_PALETTE_DROP_EVENT, suppressFollowupClick);
  }, []);
  const addPaletteNode = (type: WorkflowAction) => {
    if (suppressPaletteClickRef.current) {
      suppressPaletteClickRef.current = false;
      return;
    }
    props.onAddNode(type);
  };
  return <div className="workflow-workspace workflow-workspace-fullscreen" onPointerMove={props.movePanel} onPointerUp={props.endPanelDrag} onPointerCancel={props.endPanelDrag}>
     <header className="workflow-page-header workflow-builder-toolbar"><div><button className="link-button" type="button" onClick={props.onBack}>← {locale === "zh" ? "返回工作流" : "Back to workflows"}</button><div className="eyebrow">WORKFLOW BUILDER</div><h1>{route.label}</h1><p>{route.description}</p></div><div className="workflow-header-actions"><button className={"ghost workflow-operation-button workflow-operation-" + (operationState?.kind === "save" ? operationState.phase : "idle")} type="button" disabled={operationState?.phase === "running"} data-workflow-operation="save" data-operation-state={operationState?.kind === "save" ? operationState.phase : "idle"} aria-busy={operationState?.kind === "save" && operationState.phase === "running"} onClick={() => void runBuilderOperation("save", () => props.onSave(localDefinition))}>{operationState?.kind === "save" ? operationText("save", operationState.phase) : copy.save}</button><button className={"ghost workflow-operation-button workflow-operation-" + (operationState?.kind === "export" ? operationState.phase : "idle")} type="button" disabled={operationState?.phase === "running"} data-workflow-operation="export" data-operation-state={operationState?.kind === "export" ? operationState.phase : "idle"} aria-busy={operationState?.kind === "export" && operationState.phase === "running"} onClick={() => void runBuilderOperation("export", () => props.onExport(localDefinition))}>{operationState?.kind === "export" ? operationText("export", operationState.phase) : copy.export}</button><label className={"ghost workflow-import-button workflow-operation-" + (operationState?.kind === "import" ? operationState.phase : "idle")} data-workflow-operation="import" data-operation-state={operationState?.kind === "import" ? operationState.phase : "idle"} aria-disabled={operationState?.phase === "running"}>{operationState?.kind === "import" ? operationText("import", operationState.phase) : copy.import}<input type="file" accept="application/json,.json" disabled={operationState?.phase === "running"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void runBuilderOperation("import", () => props.onImport(file)); event.currentTarget.value = ""; }} /></label><span className="sr-only" role="status" aria-live="polite">{operationState ? operationText(operationState.kind, operationState.phase) : ""}</span><div className="workflow-run-actions"><button className="primary" type="button" disabled={Boolean(props.activeRunId) || issues.length > 0} onClick={() => props.onRun(localDefinition)}>{props.activeRunId ? (locale === "zh" ? "运行中" : "Running") : copy.run}</button>{props.activeRunId ? <button className="ghost" type="button" onClick={props.onCancel}>{locale === "zh" ? "停止" : "Stop"}</button> : null}{canContinue ? <button className="ghost" type="button" onClick={() => props.onRerun(localDefinition)}>{copy.rerun}</button> : null}{canContinue ? <button className="ghost" type="button" onClick={props.onContinue}>{copy.continue}</button> : null}</div></div></header>
     <div className="workflow-canvas-shell"><DesktopWorkflowCanvas nodes={canvasNodes} edges={localDefinition.edges} selectedNodeKey={selectedNode?.nodeKey ?? null} nodeExecutionSnapshots={props.nodeExecutionSnapshots} pendingConnectionSourceKey={props.pendingConnectionSourceKey} onSelectNode={props.onSelectNode} onMoveNode={props.onMoveNode} onMoveNodes={props.onMoveNodes} providerConfiguredForNode={props.providerConfiguredForNode} providerSourceForNode={props.providerSourceForNode} onStartConnection={props.onStartConnection} onConnect={props.onConnect} onCancelConnection={props.onCancelConnection} onDeleteEdge={props.onDeleteEdge} onDeleteNode={props.onDeleteNode} onDuplicateNode={props.onDuplicateNode} onDuplicateNodes={props.onDuplicateNodes} onAddNodeAtPoint={props.onAddNode} onUpdateNode={props.onUpdateNode} onUpdateNodeParameter={props.onUpdateNodeConfig} onSelectWorkflowFiles={props.onSelectWorkflowFiles} canUndo={props.canUndo} canRedo={props.canRedo} onUndo={props.onUndo} onRedo={props.onRedo} modelOptions={modelOptions} modelLabel={runningHubModelCatalog ? (locale === "zh" ? "工作流" : "Workflow") : undefined} hideWorkflowReference={runningHubModelCatalog} providerOptions={providerOptions} initialViewport={canvasInitialViewport} locale={locale} /><div className="workflow-canvas-overlay-toolbar"><span>{copy.canvas}</span><span className="muted">{localDefinition.nodes.length} {copy.nodes} · {localDefinition.edges.length} {copy.edges} {issues.length ? "· " + issues.length + (locale === "en" ? " connection issues" : " 个连接问题") : "· " + copy.runnable}</span></div></div>
    {props.leftPanelOpen ? <aside className="workflow-floating-panel workflow-floating-panel-left" style={{ left: props.panelPosition.left.x, top: props.panelPosition.left.y }}><div className="workflow-floating-panel-header" onPointerDown={(event) => props.startPanelDrag("left", event)}><div><strong>{copy.nodesMenu}</strong><span>{props.savedWorkflows.length} {locale === "en" ? "saved" : "个"} · {localDefinition.nodes.length} {copy.nodes}</span></div><button type="button" className="workflow-panel-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={() => props.setLeftPanelOpen(false)} aria-label={copy.close}>−</button></div><div className="workflow-action-list">{props.workflowActions.map((item) => <button key={item.id} type="button" className={"workflow-action-item " + (selectedNode?.type === item.id ? "active" : "")} onClick={() => addPaletteNode(item.id)} onPointerDown={(event) => startPaletteDrag(event, item.id)}>{item.label}<small>{item.output.toUpperCase()} · {locale === "en" ? "Add" : "添加"}</small></button>)}</div></aside> : <button type="button" className="workflow-floating-panel-tab workflow-floating-panel-tab-left" style={{ left: props.panelPosition.left.x, top: props.panelPosition.left.y }} onPointerDown={(event) => props.startPanelDrag("left", event)} onClick={() => { if (props.consumePanelClick()) return; props.setLeftPanelOpen(true); }}>{copy.open} {copy.nodesMenu}</button>}
    {props.rightPanelOpen ? (
      <aside className="workflow-floating-panel workflow-floating-panel-right" style={{ right: props.panelPosition.right.x, top: props.panelPosition.right.y }}>
        <div className="workflow-floating-panel-header" onPointerDown={(event) => props.startPanelDrag("right", event)}><div><strong>{copy.workflow}</strong><span>{copy.workflowDescription}</span></div><button type="button" className="workflow-panel-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={() => props.setRightPanelOpen(false)} aria-label={copy.close}>-</button></div>
        <div className="workflow-info-fields"><label className="workflow-editor-field"><span>{copy.workflowTitle}</span><input value={props.workflowMetadata.title} onChange={(event) => props.onWorkflowMetaChange({ title: event.target.value })} /></label><label className="workflow-editor-field"><span>{copy.workflowDescription}</span><textarea value={props.workflowMetadata.description} onChange={(event) => props.onWorkflowMetaChange({ description: event.target.value })} /></label><label className="workflow-editor-field"><span>{copy.workflowStatus}</span><select value={props.workflowMetadata.status} onChange={(event) => props.onWorkflowMetaChange({ status: event.target.value as WorkflowStatus })}><option value="draft">draft</option><option value="live">live</option><option value="archived">archived</option></select></label></div>
        {selectedNode ? <div className="workflow-selected-node-summary"><span>{locale === "zh" ? "当前节点" : "Selected node"}</span><strong>{selectedNode.title}</strong><small>{selectedNode.type}</small></div> : null}
      </aside>
    ) : <button type="button" className="workflow-floating-panel-tab workflow-floating-panel-tab-right" style={{ right: props.panelPosition.right.x, top: props.panelPosition.right.y }} onPointerDown={(event) => props.startPanelDrag("right", event)} onClick={() => { if (props.consumePanelClick()) return; props.setRightPanelOpen(true); }}>{copy.open} {copy.workflow}</button>}
  </div>;
}

function DesktopWorkflowWorkspace({ route, onBack, prompt: _prompt, onPromptChange: _onPromptChange, runStatus: _runStatus, activeRunId: _activeRunId, onRun: _onRun, onRerun: providedOnRerun, onContinue: providedOnContinue, onCancel, lastRunStatus, savedWorkflows, workflowAction, onWorkflowAction, definition, onDefinitionChange, workflowMetadata: initialWorkflowMetadata, onWorkflowMetaChange, onSave, onExport, onImport, model, models, modelForNode, modelsForNode, providersForNode, reasoningEffort, skillId, onModelChange, onReasoningChange, onSkillChange = onReasoningChange, providerConfiguredForNode, providerSourceForNode, onSelectWorkflowFiles, nodeExecutionSnapshots, locale }: DesktopWorkflowWorkspaceProps & { locale: "zh" | "en" }) {
  const [selectedNodeKey, setSelectedNodeKey] = useState("capability");
  const [localDefinition, setLocalDefinition] = useState<WorkflowDefinitionEnvelope>(() => definition ? normalizeWorkflowDefinitionLayout(definition) : buildWorkflowDefinition("", workflowAction, { id: "local", model: "" }, {}, locale));
  const [workflowEditorPrompt, setWorkflowEditorPrompt] = useState(() => String(localDefinition.nodes.find((node) => node.nodeKey === "input")?.config.text ?? ""));
  const prompt = workflowEditorPrompt;
  const activeRunId = _activeRunId;
  const runStatus = _runStatus;
  const localDefinitionRef = useRef(localDefinition);
  const onRun = (_nextDefinition?: WorkflowDefinitionEnvelope) => {
    if (activeRunId) return;
    // The file picker completes asynchronously. Read the ref that commit()
    // updates synchronously so Run cannot launch with the pre-picker render.
    _onRun(localDefinitionRef.current);
  };
  const historyRef = useRef<{ past: WorkflowDefinitionEnvelope[]; future: WorkflowDefinitionEnvelope[] }>({ past: [], future: [] });
  const historyCoalesceRef = useRef<{ key: string; until: number } | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const desktopCanvasFitsPanels = typeof window === "undefined" || window.innerWidth >= 1440;
  const [leftPanelOpen, setLeftPanelOpen] = useState(desktopCanvasFitsPanels);
  const [rightPanelOpen, setRightPanelOpen] = useState(desktopCanvasFitsPanels);
  const [pendingConnectionSourceKey, setPendingConnectionSourceKey] = useState<string | null>(null);
  const workflowMetadata = initialWorkflowMetadata;
  const [panelPosition, setPanelPosition] = useState({ left: { x: 18, y: 82 }, right: { x: 18, y: 82 } });
  const panelDragRef = useRef<{ panel: "left" | "right"; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressPanelClickRef = useRef(false);
  const workflowActions = workflowActionsBase.map((item) => ({ ...item, label: locale === "en" ? workflowActionEnglish[item.id] ?? item.label : item.label }));
  useEffect(() => {
    const collapseNarrowCanvasPanels = () => {
      if (window.innerWidth < 1440) {
        setLeftPanelOpen(false);
        setRightPanelOpen(false);
      }
    };
    collapseNarrowCanvasPanels();
    window.addEventListener("resize", collapseNarrowCanvasPanels);
    return () => window.removeEventListener("resize", collapseNarrowCanvasPanels);
  }, []);
  useEffect(() => { localDefinitionRef.current = localDefinition; }, [localDefinition]);
  useEffect(() => {
    if (!definition || definition.definitionHash === localDefinitionRef.current.definitionHash) return;
    const normalized = normalizeWorkflowDefinitionLayout(definition);
    localDefinitionRef.current = normalized;
    setLocalDefinition(normalized);
    setWorkflowEditorPrompt(String(normalized.nodes.find((node) => node.nodeKey === "input")?.config.text ?? ""));
    historyRef.current = { past: [], future: [] };
    historyCoalesceRef.current = null;
    setHistoryState({ canUndo: false, canRedo: false });
  }, [definition]);
  const selectedNode = localDefinition.nodes.find((node) => node.nodeKey === selectedNodeKey) ?? localDefinition.nodes[0];
  const selectedAction = workflowActions.find((item) => item.id === selectedNode?.type) ?? workflowActions.find((item) => item.id === workflowAction) ?? workflowActions[0];
  const issues = validateWorkflowDefinition(localDefinition);
  const commit = (next: WorkflowDefinitionEnvelope, historyKey?: string) => {
    const previous = localDefinitionRef.current;
    const current = { ...next, definitionHash: hashWorkflowDefinition(next) };
    if (current.definitionHash === previous.definitionHash) return;
    const now = Date.now();
    const isCoalesced = Boolean(historyKey && historyCoalesceRef.current?.key === historyKey && historyCoalesceRef.current.until > now);
    if (!isCoalesced) {
      historyRef.current.past = [...historyRef.current.past.slice(-49), previous];
      historyRef.current.future = [];
    }
    historyCoalesceRef.current = historyKey ? { key: historyKey, until: now + 500 } : null;
    setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
    localDefinitionRef.current = current;
    setLocalDefinition(current);
    onDefinitionChange(current);
  };
  const applyHistorySnapshot = (snapshot: WorkflowDefinitionEnvelope) => {
    localDefinitionRef.current = snapshot;
    setLocalDefinition(snapshot);
    setSelectedNodeKey((current) => snapshot.nodes.some((node) => node.nodeKey === current) ? current : snapshot.nodes[0]?.nodeKey ?? "input");
    const inputText = snapshot.nodes.find((node) => node.nodeKey === "input")?.config.text;
    if (typeof inputText === "string") setWorkflowEditorPrompt(inputText);
    onDefinitionChange(snapshot);
  };
  const undoWorkflow = () => {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(localDefinitionRef.current);
    historyCoalesceRef.current = null;
    applyHistorySnapshot(previous);
    setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
  };
  const redoWorkflow = () => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(localDefinitionRef.current);
    historyCoalesceRef.current = null;
    applyHistorySnapshot(next);
    setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
  };
  const startPanelDrag = (panel: "left" | "right", event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const origin = panelPosition[panel];
    panelDragRef.current = { panel, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextY = Math.max(58, Math.min(Math.max(58, bounds.height - 80), drag.originY + deltaY));
    setPanelPosition((current) => ({ ...current, [drag.panel]: { x: Math.max(8, drag.originX + deltaX), y: nextY } }));
  };
  const endPanelDrag = () => {
    const drag = panelDragRef.current;
    if (!drag) return;
    if (drag.moved) {
      suppressPanelClickRef.current = true;
      setPanelPosition((current) => ({ ...current, [drag.panel]: { x: 12, y: current[drag.panel].y } }));
    }
    panelDragRef.current = null;
  };
  const consumePanelClick = () => {
    const suppressed = suppressPanelClickRef.current;
    suppressPanelClickRef.current = false;
    return suppressed;
  };
  const selectNode = (nodeKey: string) => {
    setSelectedNodeKey(nodeKey);
    const node = localDefinition.nodes.find((item) => item.nodeKey === nodeKey);
    if (node && node.nodeKey !== "input" && node.type !== "output") onWorkflowAction(node.type as WorkflowAction);
  };
  const updatePrompt = (value: string) => {
    setWorkflowEditorPrompt(value);
    commit({ ...localDefinition, nodes: localDefinition.nodes.map((node) => {
      const editableTextFields = workflowNodeRegistry.get(node.type)?.configSchema.filter((field) => ["prompt", "script", "text", "query", "previewText"].includes(field.id)) ?? [];
      if (!editableTextFields.length) return node;
      return { ...node, config: { ...node.config, ...Object.fromEntries(editableTextFields.map((field) => [field.id, value])) } };
    }) }, "prompt");
  };
  const defaultProviderIdForNode = (nodeType: string) => {
    const defaultModel = modelForNode?.(nodeType) ?? model;
    return providersForNode?.(nodeType).find((provider) => preferredConfiguredModel(provider) === defaultModel)?.id ?? "local";
  };
  const nextNodeTitle = (type: WorkflowAction, nodes: readonly WorkflowDefinitionNodeV2[]) => {
    const action = workflowActions.find((item) => item.id === type) ?? workflowActions[0];
    const baseTitle = locale === "en" ? workflowActionEnglish[type] ?? action.label : action.label;
    return `${baseTitle} ${nodes.filter((node) => node.type === type).length + 1}`;
  };
  const addNode = (type: WorkflowAction, position?: { x: number; y: number }) => {
    const current = localDefinitionRef.current;
    const nodeKey = createUniqueWorkflowNodeKey(type, current.nodes);
    const defaultPosition = (() => {
      const width = 336;
      const height = 360;
      const padding = 44;
      for (let index = 0; index < 64; index += 1) {
        const candidate = { x: 408 + (index % 2) * 408, y: 420 + Math.floor(index / 2) * 420 };
        const occupied = current.nodes.some((item) =>
          candidate.x < item.positionX + width + padding &&
          candidate.x + width + padding > item.positionX &&
          candidate.y < item.positionY + height + padding &&
          candidate.y + height + padding > item.positionY,
        );
        if (!occupied) return candidate;
      }
      return { x: 408, y: 420 + current.nodes.length * 420 };
    })();
    const node: WorkflowDefinitionNodeV2 = {
      nodeKey,
      type,
      nodeVersion: 1,
      title: nextNodeTitle(type, current.nodes),
      positionX: position?.x ?? defaultPosition.x,
      positionY: position?.y ?? defaultPosition.y,
      config: buildDesktopWorkflowNodeConfig(type, workflowEditorPrompt, modelForNode?.(type) ?? model, defaultProviderIdForNode(type)),
    };
    commit({ ...current, nodes: [...current.nodes, node] });
    if (type !== "output") onWorkflowAction(type);
    setSelectedNodeKey(nodeKey);
  };
  const removeNode = (nodeKey: string) => {
    if (nodeKey === "input") return;
    commit({ ...localDefinition, nodes: localDefinition.nodes.filter((node) => node.nodeKey !== nodeKey), edges: localDefinition.edges.filter((edge) => edge.sourceNodeKey !== nodeKey && edge.targetNodeKey !== nodeKey) });
    if (selectedNodeKey === nodeKey) setSelectedNodeKey("input");
  };
  const removeSelectedNode = () => {
    if (!selectedNode) return;
    removeNode(selectedNode.nodeKey);
  };
  const duplicateNode = (nodeKey: string) => {
    const current = localDefinitionRef.current;
    const source = current.nodes.find((node) => node.nodeKey === nodeKey);
    if (!source || source.nodeKey === "input") return;
    const nextKey = createUniqueWorkflowNodeKey(source.type, current.nodes);
    const clone: WorkflowDefinitionNodeV2 = { ...source, nodeKey: nextKey, title: nextNodeTitle(source.type as WorkflowAction, current.nodes), positionX: source.positionX + 72, positionY: source.positionY + 72, config: { ...source.config } };
    const cloneEdges = current.edges.filter((edge) => edge.sourceNodeKey === nodeKey || edge.targetNodeKey === nodeKey).map((edge) => ({ ...edge, edgeKey: `${edge.edgeKey}-copy-${nextKey}`, sourceNodeKey: edge.sourceNodeKey === nodeKey ? nextKey : edge.sourceNodeKey, targetNodeKey: edge.targetNodeKey === nodeKey ? nextKey : edge.targetNodeKey }));
    commit({ ...current, nodes: [...current.nodes, clone], edges: [...current.edges, ...cloneEdges] });
    setSelectedNodeKey(nextKey);
  };
  const duplicateNodes = (nodeKeys: string[], offset: { x: number; y: number }) => {
    const current = localDefinitionRef.current;
    const sources = current.nodes.filter((node) => nodeKeys.includes(node.nodeKey) && node.nodeKey !== "input");
    if (!sources.length) return [];
    const stamp = Date.now();
    const keyMap = new Map(sources.map((source) => [source.nodeKey, createUniqueWorkflowNodeKey(source.type, [...current.nodes, ...sources.map((candidate) => ({ nodeKey: candidate.nodeKey }))]) ]));
    const clones = sources.map((source, index) => ({
      ...source,
      nodeKey: keyMap.get(source.nodeKey)!,
      title: nextNodeTitle(source.type as WorkflowAction, [...current.nodes, ...sources.slice(0, index)]),
      positionX: source.positionX + offset.x,
      positionY: source.positionY + offset.y,
      config: { ...source.config },
    }));
    const clonedEdges = current.edges
      .filter((edge) => keyMap.has(edge.sourceNodeKey) && keyMap.has(edge.targetNodeKey))
      .map((edge, index) => ({
        ...edge,
        edgeKey: `${edge.edgeKey}-copy-${stamp}-${index}`,
        sourceNodeKey: keyMap.get(edge.sourceNodeKey)!,
        targetNodeKey: keyMap.get(edge.targetNodeKey)!,
      }));
    commit({ ...current, nodes: [...current.nodes, ...clones], edges: [...current.edges, ...clonedEdges] });
    setSelectedNodeKey(clones[0].nodeKey);
    return clones.map((node) => node.nodeKey);
  };
  const changeNodeType = (nextType: WorkflowAction) => {
    if (!selectedNode || selectedNode.nodeKey === "input" || selectedNode.type === "output") return;
    const action = workflowActions.find((item) => item.id === nextType) ?? workflowActions[0];
    const nextNode = { ...selectedNode, type: nextType, title: action.label, config: buildDesktopWorkflowNodeConfig(nextType, workflowEditorPrompt, modelForNode?.(nextType) ?? model, defaultProviderIdForNode(nextType)) };
    const nextEdges = localDefinition.edges.filter((edge) => edge.targetNodeKey !== selectedNode.nodeKey && edge.sourceNodeKey !== selectedNode.nodeKey);
    const input = workflowNodeRegistry.get(nextType)?.inputs.find((port) => port.valueKind === "text");
    const output = workflowNodeRegistry.get(nextType)?.outputs[0];
    if (input) nextEdges.push({ edgeKey: `input-${selectedNode.nodeKey}`, sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: selectedNode.nodeKey, targetPortId: input.id });
    if (output) nextEdges.push({ edgeKey: `${selectedNode.nodeKey}-output`, sourceNodeKey: selectedNode.nodeKey, sourcePortId: output.id, targetNodeKey: "output", targetPortId: outputInputPort(output.valueKind) });
    commit({ ...localDefinition, nodes: localDefinition.nodes.map((node) => node.nodeKey === selectedNode.nodeKey ? nextNode : node), edges: nextEdges });
    onWorkflowAction(nextType);
  };
  const setUpstream = (sourceKey: string) => {
    if (!selectedNode || selectedNode.nodeKey === "input") return;
    const targetInput = workflowNodeRegistry.get(selectedNode.type)?.inputs[0];
    const withoutIncoming = localDefinition.edges.filter((edge) => edge.targetNodeKey !== selectedNode.nodeKey);
    if (!targetInput || sourceKey === "none") { commit({ ...localDefinition, edges: withoutIncoming }); return; }
    const source = localDefinition.nodes.find((node) => node.nodeKey === sourceKey);
    const sourcePort = source ? workflowNodeRegistry.get(source.type)?.outputs.find((port) => port.valueKind === targetInput.valueKind) : undefined;
    if (!source || !sourcePort) return;
    commit({ ...localDefinition, edges: [...withoutIncoming, { edgeKey: `${source.nodeKey}-${selectedNode.nodeKey}`, sourceNodeKey: source.nodeKey, sourcePortId: sourcePort.id, targetNodeKey: selectedNode.nodeKey, targetPortId: targetInput.id }] });
  };
  const moveNode = (nodeKey: string, position: { x: number; y: number }) => {
    moveNodes([{ nodeKey, position }]);
  };
  const moveNodes = (moves: Array<{ nodeKey: string; position: { x: number; y: number } }>) => {
    if (!moves.length) return;
    const positions = new Map(moves.map((move) => [move.nodeKey, move.position]));
    const current = localDefinitionRef.current;
    commit({ ...current, nodes: current.nodes.map((node) => {
      const position = positions.get(node.nodeKey);
      return position ? { ...node, positionX: position.x, positionY: position.y } : node;
    }) });
  };
  const connectNodes = (sourceNodeKey: string, targetNodeKey: string, sourcePortId: string, targetPortId: string) => {
    if (sourceNodeKey === targetNodeKey) return;
    const edgeKey = `${sourceNodeKey}-${targetNodeKey}-${sourcePortId}-${targetPortId}`;
    const targetNode = localDefinition.nodes.find((node) => node.nodeKey === targetNodeKey);
    const targetPort = targetNode ? workflowNodeRegistry.get(targetNode.type)?.inputs.find((port) => port.id === targetPortId) : undefined;
    const replacesInput = targetPort?.cardinality === "one" || targetPort?.maxItems === 1;
    const nextEdges = replacesInput ? localDefinition.edges.filter((edge) => !(edge.targetNodeKey === targetNodeKey && edge.targetPortId === targetPortId)) : [...localDefinition.edges];
    if (!nextEdges.some((edge) => edge.sourceNodeKey === sourceNodeKey && edge.targetNodeKey === targetNodeKey && edge.sourcePortId === sourcePortId && edge.targetPortId === targetPortId)) nextEdges.push({ edgeKey, sourceNodeKey, sourcePortId, targetNodeKey, targetPortId });
    commit({ ...localDefinition, edges: nextEdges });
    setPendingConnectionSourceKey(null);
  };
  const deleteEdge = (edge: WorkflowDefinitionEnvelope["edges"][number]) => {
    commit({ ...localDefinition, edges: localDefinition.edges.filter((candidate) => candidate.edgeKey !== edge.edgeKey) });
  };
  const upstreamEdge = selectedNode ? localDefinition.edges.find((edge) => edge.targetNodeKey === selectedNode.nodeKey) : undefined;
  const upstreamOptions = selectedNode && selectedNode.nodeKey !== "input" ? localDefinition.nodes.filter((node) => node.nodeKey !== selectedNode.nodeKey && node.type !== "output" && (workflowNodeRegistry.get(node.type)?.outputs.some((port) => port.valueKind === workflowNodeRegistry.get(selectedNode.type)?.inputs[0]?.valueKind))) : [];
  const actionLabel = (item: { id: string; label: string }) => locale === "en" ? workflowActionEnglish[item.id] ?? item.label : item.label;
  const ui = locale === "zh" ? { save: "保存流程", export: "导出 JSON", import: "导入 JSON", host: "本地 OpenCode Host", abilities: "工作流能力", nodes: "节点", canvas: "本地工作流画布", edges: "条连线", runnable: "可运行", input: "输入节点", output: "结果预览", capability: "能力节点", delete: "删除节点", editable: "可编辑配置", task: "任务内容", artifact: "产物策略", localOutput: "写入当前项目目录", artifactHint: "登记到本地 artifacts，不上传云端", ability: "能力", upstream: "上游节点", none: "不连接", runtime: "运行时", run: "运行工作流", rerun: "重新运行", continue: "继续运行", close: "收起", open: "展开", parameters: "节点参数", placeholder: "描述这条工作流需要完成的任务……", providerRequired: "该媒体节点需要配置 Provider", providerHint: "请在模型配置中选择已配置模型并填写对应 Provider。", openSettings: "打开模型配置" } : { save: "Save workflow", export: "Export JSON", import: "Import JSON", host: "Local OpenCode Host", abilities: "Workflow abilities", nodes: "nodes", canvas: "Local workflow canvas", edges: "edges", runnable: "ready", input: "Input node", output: "Result preview", capability: "Capability node", delete: "Delete node", editable: "Editable config", task: "Task", artifact: "Artifact policy", localOutput: "Write to current project", artifactHint: "Registered in local artifacts; never uploaded", ability: "Capability", upstream: "Upstream node", none: "No connection", runtime: "Runtime", run: "Run workflow", rerun: "Rerun", continue: "Continue", close: "Collapse", open: "Expand", parameters: "Node parameters", placeholder: "Describe the task this workflow should complete…", providerRequired: "This media node requires a configured Provider", providerHint: "Choose a configured model and enter its Provider settings in Model settings.", openSettings: "Open model settings" };
  const localizedNodeTitle = (node: WorkflowDefinitionNodeV2) => node.nodeKey === "input" ? ui.input : node.type === "output" ? ui.output : actionLabel({ id: node.type, label: node.title });
  const nodeParameters: Array<[string, string | number | boolean]> = selectedNode ? Object.entries(selectedNode.config).filter(([key, value]) => !/apiKey|token|secret|baseUrl|endpoint|queryEndpoint/iu.test(key) && value !== undefined && value !== null && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) as Array<[string, string | number | boolean]> : [];
  const updateNode = (nodeKey: string, patch: Partial<WorkflowDefinitionNodeV2>) => {
    const current = localDefinitionRef.current;
    commit({ ...current, nodes: current.nodes.map((node) => node.nodeKey === nodeKey ? { ...node, ...patch, ...(patch.config ? { config: { ...node.config, ...patch.config } } : {}) } : node) });
  };
  const updateNodeConfig = (nodeKey: string, key: string, value: WorkflowParameterValue) => {
    const current = localDefinitionRef.current;
    const node = current.nodes.find((candidate) => candidate.nodeKey === nodeKey);
    if (!node) return;
    const field = workflowNodeRegistry.get(node.type)?.configSchema.find((item) => item.id === key);
    const nextValue = field?.valueType === "number" ? Number(value) : field?.valueType === "boolean" ? Boolean(value) : value;
    const nextConfig = { ...node.config, [key]: nextValue };
    if (key === "selectedProviderId" && typeof nextValue === "string") {
      const provider = providersForNode?.(node.type).find((candidate) => candidate.id === nextValue);
      if (provider) {
        const workflowCapability = runningHubWorkflowCapabilityForNode(node);
        const nextModel = isRunningHubProvider(provider) && workflowCapability
          ? provider.workflows?.find((workflow) => workflow.capability === workflowCapability)?.remoteWorkflowId ?? ""
          : preferredConfiguredModel(provider);
        nextConfig.model = nextModel;
        if (workflowNodeRegistry.get(node.type)?.configSchema.some((field) => field.id === "selectedModelId")) nextConfig.selectedModelId = nextModel;
        delete nextConfig.workflowRef;
      }
    }
    if (key === "selectedModelId" || key === "model") {
      nextConfig.model = nextValue;
      if (key === "selectedModelId") nextConfig.selectedModelId = nextValue;
      const providerId = typeof nextConfig.selectedProviderId === "string" ? nextConfig.selectedProviderId : "";
      const provider = providerId ? providersForNode?.(node.type).find((candidate) => candidate.id === providerId) : undefined;
      const workflowCapability = runningHubWorkflowCapabilityForNode(node);
      if (isRunningHubProvider(provider) && workflowCapability) delete nextConfig.workflowRef;
    }
    if (node.nodeKey === "input" && key === "text" && typeof value === "string") setWorkflowEditorPrompt(value);
    commit({ ...current, nodes: current.nodes.map((candidate) => candidate.nodeKey === node.nodeKey ? { ...candidate, config: nextConfig } : candidate) }, `config:${nodeKey}:${key}`);
  };
  const updateNodeParameter = (key: string, value: WorkflowParameterValue) => {
    if (selectedNode) updateNodeConfig(selectedNode.nodeKey, key, value);
  };
  const canvasNodes = localDefinition.nodes.map((node) => {
    return { ...node, title: localizedNodeTitle(node) };
  });
  const onRerun = providedOnRerun
    ? (_nextDefinition: WorkflowDefinitionEnvelope) => providedOnRerun(localDefinitionRef.current)
    : onRun;
  const onContinue = providedOnContinue ?? (() => undefined);
  const rerunWorkflow = onRerun;
  const continueWorkflow = onContinue;
   return <DesktopWorkflowBuilderSurface route={route} onBack={onBack} prompt={_prompt} onPromptChange={_onPromptChange} runStatus={runStatus} activeRunId={_activeRunId} onRun={onRun} onRerun={rerunWorkflow} onContinue={continueWorkflow} onCancel={onCancel} lastRunStatus={lastRunStatus} savedWorkflows={savedWorkflows} workflowActions={workflowActions} localDefinition={localDefinition} canvasNodes={canvasNodes} selectedNode={selectedNode} selectedAction={selectedAction} issues={issues} upstreamEdge={upstreamEdge} upstreamOptions={upstreamOptions} nodeParameters={nodeParameters} providerConfiguredForNode={providerConfiguredForNode} providerSourceForNode={providerSourceForNode} nodeExecutionSnapshots={nodeExecutionSnapshots} onSelectWorkflowFiles={onSelectWorkflowFiles} canUndo={historyState.canUndo} canRedo={historyState.canRedo} onUndo={undoWorkflow} onRedo={redoWorkflow} pendingConnectionSourceKey={pendingConnectionSourceKey} onSelectNode={selectNode} onMoveNode={moveNode} onMoveNodes={moveNodes} onAddNode={addNode} onRemoveSelectedNode={removeSelectedNode} onDeleteNode={removeNode} onDuplicateNode={duplicateNode} onDuplicateNodes={duplicateNodes} onChangeNodeType={changeNodeType} onSetUpstream={setUpstream} onUpdateNodeParameter={updateNodeParameter} onUpdateNodeConfig={updateNodeConfig} onUpdateNode={updateNode} onStartConnection={setPendingConnectionSourceKey} onConnect={connectNodes} onCancelConnection={() => setPendingConnectionSourceKey(null)} onDeleteEdge={deleteEdge} workflowMetadata={workflowMetadata} onWorkflowMetaChange={onWorkflowMetaChange} locale={locale} model={model} models={models} modelForNode={modelForNode} modelsForNode={modelsForNode} providersForNode={providersForNode} reasoningEffort={reasoningEffort} skillId={skillId} onModelChange={onModelChange} onReasoningChange={onReasoningChange} onSkillChange={onSkillChange} onSave={onSave} onExport={onExport} onImport={onImport} leftPanelOpen={leftPanelOpen} rightPanelOpen={rightPanelOpen} panelPosition={panelPosition} setLeftPanelOpen={setLeftPanelOpen} setRightPanelOpen={setRightPanelOpen} startPanelDrag={startPanelDrag} movePanel={movePanel} endPanelDrag={endPanelDrag} consumePanelClick={consumePanelClick} />;
}

function DesktopMediaWorkspaceBody({
  route,
  prompt,
  onPromptChange,
  runStatus,
  activeRunId,
  onRun,
  onCancel,
  workflowAction,
  onWorkflowAction,
  artifactRows: allArtifactRows,
  providerConfigured: configuredProp,
  providerSource,
  onOpenSettings,
  onOpenTasks,
  onArtifactReveal,
  onArtifactPreview,
  onAddAttachments,
   onRemoveAttachment,
   attachments,
  model,
  models,
  reasoningEffort,
  skillId,
  onModelChange,
  onReasoningChange,
  onSkillChange,
  locale,
  mediaFeatureId,
  onMediaFeatureChange,
  tabState,
  onTabStateChange,
  showFeatureSelectors = true,
  showHeader = true,
  onLoadVoices,
}: {
  route: DesktopRoute;
  prompt: string;
  onPromptChange: (value: string) => void;
  runStatus: string;
  activeRunId: string | null;
  onRun: (promptOverride?: string, mediaFeatureId?: MediaFeatureId, mediaInputs?: Record<string, unknown>) => void;
  onCancel: () => void;
  workflowAction: WorkflowAction;
  onWorkflowAction: (value: WorkflowAction) => void;
  artifactRows: ArtifactRow[];
  providerConfigured: boolean;
  providerSource?: string;
  onOpenSettings: () => void;
  onOpenTasks?: () => void;
  onArtifactReveal: (relativePath: string, mimeType: string) => void;
  onArtifactPreview?: (relativePath: string, mimeType: string) => Promise<LocalMediaPreview>;
  onAddAttachments?: (files: FileList | readonly File[] | null) => void | Promise<readonly LocalAttachment[]>;
   onRemoveAttachment?: (id: string) => void;
   attachments?: LocalAttachment[];
  model: string;
  models?: readonly string[];
  reasoningEffort: string;
  skillId: SkillId;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSkillChange: (value: SkillId) => void;
  locale: "zh" | "en";
  mediaFeatureId?: MediaFeatureId;
  onMediaFeatureChange?: (featureId: MediaFeatureId) => void;
  tabState?: DesktopMediaTabState;
  onTabStateChange?: (updater: (current: DesktopMediaTabState) => DesktopMediaTabState) => void;
  showFeatureSelectors?: boolean;
  showHeader?: boolean;
  onLoadVoices?: (force?: boolean) => Promise<readonly MiniMaxVoiceOption[]>;
}) {
  // The route already resolves the active capability profile. Do not fall back
  // to another media capability's readiness: same-type multi-provider setups
  // must keep each capability's gate independent.
  const providerConfigured = configuredProp;
  const isVideo = route.path.includes("video");
  const isImage = route.path.includes("image-assistant");
  const [imageEditor, setImageEditor] = useState<{ sourceUrl: string } | null>(null);
  const mediaHistory = useContext(DesktopMediaHistoryContext);
  const sessionArtifactRows = isImage ? mediaArtifactsForConversation(mediaHistory) : [];
  const artifactRows = isImage && mediaHistory?.scope === "entry:image-assistant" ? sessionArtifactRows : allArtifactRows;
  const actionToFeature: Partial<Record<WorkflowAction, MediaFeatureId>> = { video_generate: "text-to-video", digital_human: "digital-human", music_generate: "ai-music", voice_clone: "voice-clone", voice_synthesis: "voice-synthesis", audio_generate: "audio-generate" };
  const featureToAction: Partial<Record<MediaFeatureId, WorkflowAction>> = { "text-to-video": "video_generate", "image-to-video": "video_generate", "reference-to-video": "video_generate", "video-edit": "video_generate", "video-enhance": "video_generate", "digital-human": "digital_human", "ai-music": "music_generate", "audio-generate": "audio_generate", "voice-clone": "voice_clone", "voice-synthesis": "voice_synthesis" };
  const [activeFeatureId, setActiveFeatureId] = useState<MediaFeatureId>(actionToFeature[workflowAction] ?? "text-to-video");
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, string>>({});
  const [localFieldValuesByFeature, setLocalFieldValuesByFeature] = useState<Partial<Record<MediaFeatureId, Record<string, string>>>>({});
  const [localImageSettings, setLocalImageSettings] = useState(() => normalizeDesktopImageSettings(model));
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});
  const [voiceOptions, setVoiceOptions] = useState<MiniMaxVoiceOption[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const toggleReferenceRecording = async () => {
    if (isRecording && recordingRef.current) {
      recordingRef.current.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return; }
    const recorder = new MediaRecorder(stream);
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const file = new File([new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" })], "voice-reference.webm", { type: recorder.mimeType || "audio/webm" });
      if (tabState && onTabStateChange) onTabStateChange((current) => ({ ...current, uploadedFileName: file.name }));
      else setUploadedFiles((current) => ({ ...current, [activeFeature.id]: file.name }));
      const transfer = new DataTransfer(); transfer.items.add(file); onAddAttachments?.(transfer.files);
    };
    recordingRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  };
  const featureTitle = (feature: typeof mediaFeatureCatalog[number]) => locale === "en" ? mediaEnglish[feature.id] ?? feature.title : feature.title;
  const mediaUi = locale === "en" ? { eyebrow: "CONTENT CREATION", localArtifacts: "Local artifacts", preview: "Image results", latest: "Latest artifact", ready: "Local artifact is ready", afterRun: "Local result appears after running", notUploaded: "Generated files stay local and can be opened in Explorer.", audio: "Audio", video: "Video", image: "Image assistant", provider: "Media Provider required", providerHint: "The local text model does not automatically provide image, video, or audio generation.", openSettings: "Open model settings", prompt: "Prompt", quality: "Quality", size: "Size", count: "Count", references: "Reference assets", generate: "Generate", stop: "Stop", localAgent: "Run through local Agent", describe: "Describe what you want to generate…" } : { eyebrow: "内容创作", localArtifacts: "本地文件产物", preview: "图片结果", latest: "最新产物", ready: "本地产物已就绪", afterRun: "运行后显示本地结果", notUploaded: "生成的文件不会上传或转存，可直接在资源管理器打开。", audio: "音频处理", video: "视频处理", image: "图片生成与参考图编辑", provider: "需要配置媒体 Provider", providerHint: "本地文本模型不会自动提供图片、视频或音频生成。", openSettings: "打开模型配置", prompt: "提示词", quality: "质量", size: "尺寸", count: "数量", references: "参考素材", generate: "生成", stop: "停止", localAgent: "选择能力后通过本地 Agent 运行", describe: "描述你想生成的内容……" };
  const localizedFeatureCatalog = mediaFeatureCatalog.map((feature) => applyConfiguredMediaModels(feature, models, model)).map((feature) => ({
    ...feature,
    title: featureTitle(feature),
    ...(locale === "en" ? {
      summary: mediaSummaryEnglish[feature.id] ?? feature.summary,
      submitLabel: mediaSubmitEnglish[feature.id] ?? feature.submitLabel,
      fields: feature.fields.map((field) => ({ ...field, label: mediaFieldEnglish[field.label] ?? field.label, placeholder: field.placeholder ? mediaPlaceholderEnglish[field.placeholder] ?? field.placeholder : field.placeholder, options: field.options?.map((option) => ({ ...option, label: mediaOptionEnglish[option.label] ?? option.label })) })),
    } : {}),
  }));
  const activeFeatureBase = localizedFeatureCatalog.find((feature) => feature.id === activeFeatureId) ?? localizedFeatureCatalog[0];
  const fieldValues = tabState?.values ?? localFieldValues;
  const imageSettings = tabState?.imageSettings ?? localImageSettings;
  const imageModelKind = resolveDesktopImageModelKind(model);
  const imageParameterFields = getDesktopImageParameterSchema(model, locale).filter((field) => field.id !== "responseFormat" && (!field.visibleWhen || field.visibleWhen(imageSettings)));
  const imageRequiredInputMissing = imageModelKind === "seedream-image-to-image" && !imageSettings.inputImageUrl?.trim();
  const restoredHistoryPrompts = isImage && mediaHistory?.scope === "entry:image-assistant"
    ? mediaHistory.messages.filter((message) => message.role === "user" && message.content.trim()).map((message) => message.content.trim())
    : [];
  const restoredHistoryPrompt = restoredHistoryPrompts.at(-1) ?? (isImage && mediaHistory?.scope === "entry:image-assistant" ? mediaHistory.prompt : "");
  const workspacePrompt = tabState?.prompt ?? (prompt.trim() ? prompt : restoredHistoryPrompt);
  const resolvedActiveFeature = resolveWorkbenchMediaFeature(activeFeatureBase, fieldValues.model || activeFeatureBase.fields.find((field) => field.id === "model")?.defaultValue, providerSource);
  const activeFeature = locale === "en"
    ? { ...resolvedActiveFeature, fields: resolvedActiveFeature.fields.map((field) => ({ ...field, label: mediaFieldEnglish[field.label] ?? field.label, placeholder: field.placeholder ? mediaPlaceholderEnglish[field.placeholder] ?? field.placeholder : field.placeholder, options: field.options?.map((option) => ({ ...option, label: mediaOptionEnglish[option.label] ?? option.label })) })) }
    : resolvedActiveFeature;
  const workflowActions = workflowActionsBase.map((item) => ({ ...item, label: locale === "en" ? workflowActionEnglish[item.id] ?? item.label : item.label }));
  const ensureVoicesLoaded = useCallback(async (force = false) => {
    if (!onLoadVoices || isLoadingVoices || (!force && voiceOptions.length > 0)) return;
    setIsLoadingVoices(true);
    setVoicesError(null);
    try {
      setVoiceOptions([...(await onLoadVoices(force))]);
    } catch (error) {
      setVoicesError(error instanceof Error ? error.message : (locale === "en" ? "Unable to load voices" : "音色加载失败"));
    } finally {
      setIsLoadingVoices(false);
    }
  }, [isLoadingVoices, locale, onLoadVoices, voiceOptions.length]);
  useEffect(() => {
    if (!isVideo) return;
    const nextFeatureId = mediaFeatureId ?? actionToFeature[workflowAction] ?? "text-to-video";
    setActiveFeatureId(nextFeatureId);
  }, [isVideo, workflowAction, mediaFeatureId]);
  useEffect(() => {
    if (activeFeature.id !== "voice-synthesis") return;
    void ensureVoicesLoaded(false);
  }, [activeFeature.id, ensureVoicesLoaded]);
  useEffect(() => {
    if (tabState) return;
    setLocalFieldValues(localFieldValuesByFeature[activeFeatureBase.id] ?? Object.fromEntries(activeFeatureBase.fields.map((field) => [field.id, field.defaultValue ?? ""])));
  }, [activeFeatureBase.id, localFieldValuesByFeature, tabState]);
  useEffect(() => {
    if (!tabState || !onTabStateChange) return;
    const synced = syncDesktopMediaTabModel(tabState, activeFeature);
    if (synced !== tabState) onTabStateChange(() => synced);
  }, [activeFeature, onTabStateChange, tabState]);
  useEffect(() => {
    if (!isImage) return;
    const normalized = normalizeDesktopImageSettings(model, imageSettings);
    if (JSON.stringify(normalized) === JSON.stringify(imageSettings)) return;
    if (tabState && onTabStateChange) onTabStateChange((current) => ({ ...current, imageSettings: normalized }));
    else setLocalImageSettings(normalized);
  }, [imageSettings, isImage, model, onTabStateChange, tabState]);
  const updateField = (fieldId: string, value: string) => {
    if (tabState && onTabStateChange) {
      onTabStateChange((current) => ({
        ...current,
        values: { ...current.values, [fieldId]: value },
        ...(fieldId === "prompt" ? { prompt: value } : {}),
      }));
      return;
    }
    setLocalFieldValues((current) => {
      const next = { ...current, [fieldId]: value };
      setLocalFieldValuesByFeature((features) => ({ ...features, [activeFeatureBase.id]: next }));
      if (fieldId === "prompt") onPromptChange(value);
      return next;
    });
  };
  const updateImageSettings = (updater: (current: typeof imageSettings) => typeof imageSettings) => {
    if (tabState && onTabStateChange) {
      onTabStateChange((current) => ({ ...current, imageSettings: updater(current.imageSettings) }));
      return;
    }
    setLocalImageSettings(updater);
  };
  const appendImageReferencePaths = (paths: readonly string[]) => {
    const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
    const fieldId = imageParameterFields.some((field) => field.id === "referenceImages") ? "referenceImages" : imageParameterFields.some((field) => field.id === "inputImageUrl") ? "inputImageUrl" : null;
    if (!normalizedPaths.length || !fieldId) return;
    updateImageSettings((current) => {
      const existing = typeof current[fieldId] === "string" ? current[fieldId].split(",").map((path) => path.trim()).filter(Boolean) : [];
      const nextPaths = fieldId === "inputImageUrl" ? [existing[0] ?? normalizedPaths[0]] : [...new Set([...existing, ...normalizedPaths])];
      return normalizeDesktopImageSettings(model, { ...current, [fieldId]: nextPaths.join(",") });
    });
  };
  const handleMediaModelChange = (value: string) => {
    onModelChange(value);
    if (activeFeature.fields.some((field) => field.id === "model")) updateField("model", value);
  };
  const selectMediaFeature = (featureId: MediaFeatureId) => { setActiveFeatureId(featureId); onMediaFeatureChange?.(featureId); const nextAction = featureToAction[featureId]; if (nextAction) onWorkflowAction(nextAction); };
  const buildMediaPrompt = () => {
    const configuredFields = Object.entries(fieldValues).filter(([, value]) => value.trim()).map(([fieldId, value]) => {
      const field = activeFeature.fields.find((item) => item.id === fieldId);
      return `${field?.label ?? fieldId}: ${value.trim()}`;
    });
    return [activeFeature.title, workspacePrompt.trim(), ...configuredFields.filter((field) => field !== workspacePrompt.trim())].filter(Boolean).join("\n");
  };
  const buildImagePrompt = () => workspacePrompt.trim();
  const localAttachmentPaths = (attachments ?? []).map((item) => item.relativePath ?? item.name);
  const mediaAttachmentItems = (attachments ?? []).map((attachment) => ({ id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, uri: attachment.relativePath }));
  const imageModelOptions = (models?.length ? models : [model]).map((option) => ({ id: option, label: option, provider: option.includes(":") ? option.split(":", 1)[0] : (locale === "zh" ? "已配置模型" : "Configured models") }));
  const activeMediaModel = fieldValues.model || activeFeature.fields.find((field) => field.id === "model")?.defaultValue || "";
  const mediaModelOptions = activeFeature.fields.find((field) => field.id === "model")?.options?.map((option) => ({ id: option.value, label: option.label, provider: locale === "zh" ? "媒体模型" : "Media models" })) ?? [];
  const taskStatus: "running" | "succeeded" | "failed" | "waiting" = activeRunId ? "running" : /失败|failed|error/iu.test(runStatus) ? "failed" : /完成|succeed|success/iu.test(runStatus) ? "succeeded" : "waiting";
  const videoFeatures = localizedFeatureCatalog.filter((feature) => feature.group === "video");
  const audioFeatures = localizedFeatureCatalog.filter((feature) => feature.group === "audio");
  const hasMediaArtifacts = isVideo && artifactRows.some((artifact) => artifact.mime_type.startsWith("video/") || artifact.mime_type.startsWith("audio/"));
  const simpleOptions = workflowActions.filter((item) => ["ppt_generate", "image_generate", "writer"].includes(item.id));
  const localizedStatus = localizeDesktopStatus(runStatus, locale);
  const localizedRunStatus = isDesktopErrorStatus(localizedStatus) ? "" : localizedStatus;
  const updateWorkspacePrompt = (value: string) => {
    if (tabState && onTabStateChange) {
      onTabStateChange((current) => ({ ...current, prompt: value }));
      return;
    }
    onPromptChange(value);
    if (isVideo && activeFeature.fields.some((field) => field.id === "prompt")) updateField("prompt", value);
  };
  const uploadedFileName = tabState?.uploadedFileName ?? uploadedFiles[activeFeature.id];
  const voiceCategoryLabel = (category: MiniMaxVoiceOption["category"]) => {
    if (locale === "zh") return category === "system" ? "系统音色" : category === "voice_cloning" ? "复刻音色" : "生成音色";
    return category === "system" ? "System" : category === "voice_cloning" ? "Cloned" : "Generated";
  };
  return <div className="media-workspace">
    <input
      className="sr-only"
      type="file"
      id="desktop-media-upload"
      accept={isImage ? "image/*" : "audio/*,video/*,image/*"}
      onChange={(event) => {
        const files = event.target.files;
        const selectedFiles = files ? Array.from(files) : [];
        const file = selectedFiles[0];
        event.currentTarget.value = "";
        if (!file) return;
        if (tabState && onTabStateChange) onTabStateChange((current) => ({ ...current, uploadedFileName: file.name }));
        else setUploadedFiles((current) => ({ ...current, [activeFeature.id]: file.name }));
        void (async () => {
          const savedAttachments = await onAddAttachments?.(selectedFiles);
          if (isImage) appendImageReferencePaths((savedAttachments ?? []).filter((attachment) => attachment.status === "ready" && attachment.relativePath).map((attachment) => attachment.relativePath as string));
        })();
      }}
    />
    <header className={showHeader && !isImage ? "workflow-page-header" : "workflow-page-header sr-only"}>
      <div><div className="eyebrow">{mediaUi.eyebrow}</div><h1>{route.label}</h1><p>{route.description}</p></div>
    </header>
    <div className="media-workspace-grid">
      <section className="media-control-panel">
        {isVideo && showFeatureSelectors ? <div className="media-feature-groups">
          <div><div className="media-group-label">{mediaUi.audio}</div><div className="media-tabs">{audioFeatures.map((feature) => <button key={feature.id} type="button" className={activeFeature.id === feature.id ? "active" : ""} onClick={() => selectMediaFeature(feature.id)}>{feature.title}</button>)}</div></div>
          <div><div className="media-group-label">{mediaUi.video}</div><div className="media-tabs">{videoFeatures.map((feature) => <button key={feature.id} type="button" className={activeFeature.id === feature.id ? "active" : ""} onClick={() => selectMediaFeature(feature.id)}>{feature.title}</button>)}</div></div>
        </div> : null}
        {isVideo ? <div className="media-feature-summary"><strong>{activeFeature.title}</strong><span>{activeFeature.summary}</span></div> : isImage ? null : <div className="media-tabs">{simpleOptions.map((item) => <button key={item.id} type="button" className={workflowAction === item.id ? "active" : ""} onClick={() => onWorkflowAction(item.id)}>{item.label}</button>)}</div>}
        {!providerConfigured ? <div className="media-provider-warning"><strong>{mediaUi.provider}</strong><span>{mediaUi.providerHint}</span><button type="button" className="link-button" onClick={onOpenSettings}>{mediaUi.openSettings}</button></div> : null}
        {isVideo && (activeFeature.id === "voice-clone" || activeFeature.id === "voice-synthesis" || activeFeature.fields.some((field) => field.type === "url")) ? <div className="voice-library-box">
          <div className="voice-library-heading"><span className="field-label">{activeFeature.id === "voice-synthesis" ? (locale === "en" ? "Voice library" : "音色库") : (locale === "en" ? "Reference and local assets" : "参考音频与本地素材")}</span>{activeFeature.id === "voice-synthesis" ? <button type="button" className="reload-btn" onClick={() => void ensureVoicesLoaded(true)} disabled={isLoadingVoices}>{isLoadingVoices ? (locale === "en" ? "Loading voices…" : "正在加载音色…") : (locale === "en" ? "Reload voices" : "刷新音色")}</button> : null}</div>
          {activeFeature.id !== "voice-synthesis" ? <div className="composer-actions"><button type="button" className="reload-btn" onClick={() => document.getElementById("desktop-media-upload")?.click()}>{locale === "en" ? "Upload local file" : "上传本地文件"}</button><button type="button" className="reload-btn" onClick={() => void toggleReferenceRecording()}>{isRecording ? (locale === "en" ? "Stop recording" : "停止录音") : (locale === "en" ? "Record reference" : "录制参考音频")}</button></div> : null}
          {uploadedFileName ? <div className="text-sm text-[#222]">{locale === "en" ? "Ready" : "已就绪"}: {uploadedFileName}</div> : null}
          {activeFeature.id === "voice-synthesis" && isLoadingVoices ? <div className="voice-library-status">{locale === "en" ? "Loading available voices…" : "正在加载可用音色……"}</div> : null}
          {activeFeature.id === "voice-synthesis" && voicesError ? <div className="voice-library-error" role="status">{voicesError}</div> : null}
          {activeFeature.id === "voice-synthesis" && !isLoadingVoices && !voicesError && voiceOptions.length === 0 ? <div className="voice-library-status">{locale === "en" ? "No voices are available for this account yet." : "当前账号暂无可用音色。"}</div> : null}
          {activeFeature.id === "voice-synthesis" && voiceOptions.length > 0 ? <div className="voice-recommendations"><span>{locale === "en" ? "Recommended" : "推荐音色"}</span><div className="voice-chip-list">{voiceOptions.slice(0, 6).map((voice) => <button key={`${voice.category}-${voice.voiceId}`} type="button" className="voice-chip" onClick={() => updateField("voiceId", voice.voiceId)}>{voice.voiceName} · {voiceCategoryLabel(voice.category)}</button>)}</div></div> : null}
        </div> : null}
         {isVideo ? <div className="media-field-grid">{activeFeature.fields.filter((field) => field.id !== "prompt" && field.id !== "model").map((field) => <label key={field.id} className="media-field"><span>{field.label}</span>{activeFeature.id === "voice-synthesis" && field.id === "voiceId" ? <select value={fieldValues[field.id] ?? ""} onChange={(event) => updateField(field.id, event.target.value)}><option value="">{locale === "en" ? "Select a voice" : "选择音色"}</option>{voiceOptions.map((voice) => <option key={`${voice.category}-${voice.voiceId}`} value={voice.voiceId}>{voice.voiceName} · {voiceCategoryLabel(voice.category)}</option>)}</select> : field.type === "textarea" ? <textarea value={fieldValues[field.id] ?? ""} onChange={(event) => updateField(field.id, event.target.value)} placeholder={field.placeholder} /> : field.type === "select" ? <select value={fieldValues[field.id] ?? field.defaultValue ?? ""} onChange={(event) => updateField(field.id, event.target.value)}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type === "number" ? "number" : "text"} value={fieldValues[field.id] ?? ""} onChange={(event) => updateField(field.id, event.target.value)} placeholder={field.placeholder} />}{field.type === "url" && artifactRows.length ? <div className="media-asset-picker">{artifactRows.slice(0, 3).map((artifact) => <button key={`${field.id}-${artifact.id}`} type="button" onClick={() => updateField(field.id, artifact.relative_path)}>{artifact.relative_path}</button>)}</div> : null}{activeFeature.id === "voice-synthesis" && field.id === "voiceId" && fieldValues[field.id] ? <small className="voice-selected-description">{voiceOptions.find((voice) => voice.voiceId === fieldValues[field.id])?.description?.[0] ?? fieldValues[field.id]}</small> : null}</label>)}</div> : isImage ? <div className="image-field-grid" data-image-model-kind={imageModelKind}>
           {imageParameterFields.map((field) => <label key={field.id} className={`media-field ${field.type === "text" ? "image-field-wide" : ""}`} data-image-parameter={field.id}><span>{field.label}{field.id === "responseFormat" ? (locale === "en" ? " · fixed" : "（固定）") : ""}</span>{field.id === "referenceImages" || field.id === "inputImageUrl" ? <button type="button" className="media-reference-dropzone" onClick={() => document.getElementById("desktop-media-upload")?.click()}><span aria-hidden="true">↥</span><strong>{locale === "en" ? "Click or drop an image here" : "点击或拖拽图片到此处上传"}</strong><small>{locale === "en" ? "JPG, PNG or WEBP · up to 10 MB" : "支持 JPG、PNG、WEBP，单张不超过 10MB"}</small></button> : null}{isImage && (field.id === "referenceImages" || field.id === "inputImageUrl") && attachments?.some((attachment) => attachment.mediaType.startsWith("image/")) ? <div className="image-reference-cards" aria-label={locale === "en" ? "Uploaded reference images" : "已上传的参考图片"}>{attachments.filter((attachment) => attachment.mediaType.startsWith("image/")).map((attachment) => <div className="image-reference-card" data-status={attachment.status} key={attachment.id}><div className="image-reference-thumbnail">{attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.name} /> : <span aria-hidden="true">▧</span>}</div><div className="image-reference-copy"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.status === "failed" ? (locale === "en" ? "Upload failed" : "上传失败") : `${Math.max(1, Math.ceil(attachment.size / 1024))} KB`}</small></div><button type="button" className="image-reference-remove" aria-label={`${locale === "en" ? "Remove" : "移除"} ${attachment.name}`} onClick={() => onRemoveAttachment?.(attachment.id)}>×</button></div>)}</div> : null}{field.type === "select" ? <select value={imageSettings[field.id] ?? field.defaultValue ?? ""} disabled={field.id === "responseFormat"} aria-readonly={field.id === "responseFormat" || undefined} onChange={(event) => updateImageSettings((current) => normalizeDesktopImageSettings(model, { ...current, [field.id]: event.target.value }))}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} value={imageSettings[field.id] ?? ""} onChange={(event) => updateImageSettings((current) => normalizeDesktopImageSettings(model, { ...current, [field.id]: event.target.value }))} placeholder={field.placeholder} />}{field.type === "text" && artifactRows.length ? <div className="media-asset-picker">{artifactRows.slice(0, 3).map((artifact) => <button key={`${field.id}-${artifact.id}`} type="button" onClick={() => updateImageSettings((current) => normalizeDesktopImageSettings(model, { ...current, [field.id]: field.id === "referenceImages" && current[field.id] ? `${current[field.id]},${artifact.relative_path}` : artifact.relative_path }))}>{artifact.relative_path}</button>)}</div> : null}</label>)}
         </div> : null}
         {isImage ? <div data-image-parameter="model" className="sr-only" aria-hidden="true" /> : null}<div data-image-parameter={isImage ? "model" : undefined}><WorkbenchPromptInput value={workspacePrompt} onValueChange={updateWorkspacePrompt} onSubmit={() => onRun(isVideo ? buildMediaPrompt() : isImage ? buildImagePrompt() : undefined, isVideo ? activeFeature.id : undefined, isVideo ? { ...Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => value.trim())), model: activeMediaModel, ...(localAttachmentPaths.length ? { localAttachments: localAttachmentPaths } : {}) } : isImage ? buildDesktopImageRunInput(model, imageSettings, localAttachmentPaths) : undefined)} attachments={mediaAttachmentItems} onAddAttachments={onAddAttachments} onRemoveAttachment={onRemoveAttachment} models={isImage ? imageModelOptions : mediaModelOptions} model={isImage ? model : activeMediaModel} onModelChange={isImage ? handleMediaModelChange : (value) => updateField("model", value)} placeholder={isImage ? (locale === "en" ? "Describe the subject, composition, style and safe areas…" : "描述主体、构图、风格和需要保留的安全区域……") : isVideo ? mediaUi.describe : mediaUi.describe} status={activeRunId ? "streaming" : /失败|failed|error/iu.test(runStatus) ? "error" : "ready"} onStop={onCancel} disabled={!providerConfigured || imageRequiredInputMissing} submitLabel={isVideo ? activeFeature.submitLabel : mediaUi.generate} locale={locale} /></div>
         {!isImage ? <WorkbenchTask title={isVideo ? activeFeature.title : (locale === "en" ? "Media task" : "媒体任务")} status={taskStatus} steps={[{ id: "submit", title: localizedRunStatus || (locale === "en" ? "Waiting for submission" : "等待提交"), status: taskStatus }]} locale={locale} /> : null}
      </section>
      <section className="media-preview-panel">
        <div className="media-preview-heading">
          <div className="section-title"><span>{isVideo ? mediaUi.latest : mediaUi.preview}</span><span className="muted">{artifactRows.length} {locale === "en" ? "files" : "个"}</span></div>
        </div>
        {isImage ? <DesktopImageArtifactPreview artifactRows={artifactRows} locale={locale} onArtifactReveal={onArtifactReveal} onEditArtifact={(source) => setImageEditor({ sourceUrl: source })} generationStatus={isImage && activeRunId ? localizedRunStatus || (locale === "en" ? "Generating image…" : "正在生成图片…") : null} /> : null}
        {isVideo && hasMediaArtifacts ? <DesktopMediaResultPreview compact artifactRows={artifactRows} locale={locale} onArtifactReveal={onArtifactReveal} onArtifactPreview={onArtifactPreview} /> : null}
        {!isImage && !hasMediaArtifacts ? <div className="media-preview-placeholder"><span>{isVideo ? "▶" : "▣"}</span><strong>{artifactRows.length ? mediaUi.ready : mediaUi.afterRun}</strong><p>{mediaUi.notUploaded}</p></div> : null}
        {!isImage || activeRunId || taskStatus === "failed" ? <div className="capability-status-ready media-result-status"><span className="capability-status-dot" />{localizedRunStatus || (locale === "en" ? "Ready" : "就绪")}</div> : null}
        {!isImage && !hasMediaArtifacts && artifactRows.length ? <div className="media-artifact-list">{artifactRows.slice(0, 6).map((artifact) => <button key={artifact.id} type="button" className="media-artifact-row" onClick={() => onArtifactReveal(artifact.relative_path, artifact.mime_type)}><span>{artifact.relative_path}</span><small>{artifact.mime_type} · {Math.ceil(artifact.byte_length / 1024)} KB</small></button>)}</div> : null}
      </section>
    </div>
    {isImage && imageEditor ? <ImageMaskEditor sourceUrl={imageEditor.sourceUrl} locale={locale} onCancel={() => setImageEditor(null)} onSubmit={(editPrompt, input) => {
      setImageEditor(null);
      onRun(editPrompt || (locale === "zh" ? "修改标记区域，保持其他内容不变" : "Edit the marked area while preserving everything else"), undefined, {
        ...buildDesktopImageRunInput(model, imageSettings, localAttachmentPaths),
        inputImageUrl: input.inputImageUrl,
        maskImageUrl: input.maskImageUrl,
        taskType: input.taskType,
        editMode: "mask",
      });
    }} /> : null}
  </div>;
}

const desktopImageParameterLabels: Record<string, { zh: string; en: string }> = {
  model: { zh: "模型", en: "Model" },
  size: { zh: "尺寸", en: "Size" },
  quality: { zh: "质量", en: "Quality" },
  background: { zh: "背景", en: "Background" },
  output_format: { zh: "输出格式", en: "Output format" },
  output_compression: { zh: "输出压缩", en: "Output compression" },
  moderation: { zh: "内容审核", en: "Moderation" },
  n: { zh: "生成数量", en: "Count" },
  resolution: { zh: "分辨率", en: "Resolution" },
  negativePrompt: { zh: "反向提示词", en: "Negative prompt" },
  promptExtend: { zh: "提示词扩写", en: "Prompt extension" },
  watermark: { zh: "水印", en: "Watermark" },
  seed: { zh: "随机种子", en: "Seed" },
  taskType: { zh: "任务类型", en: "Task type" },
  editMode: { zh: "编辑模式", en: "Edit mode" },
  referenceImageCount: { zh: "参考图片", en: "Reference images" },
  inputImageProvided: { zh: "输入图片", en: "Input image" },
  maskImageProvided: { zh: "蒙版图片", en: "Mask image" },
};

function imageArtifactRunId(artifactId: string) {
  const separator = artifactId.indexOf(":");
  return separator > 0 ? artifactId.slice(0, separator) : artifactId;
}

function formatDesktopImageParameterValue(key: string, value: DesktopImageGenerationParameterValue, locale: "zh" | "en") {
  if (key === "referenceImageCount") return `${value} ${locale === "zh" ? "张" : value === 1 ? "image" : "images"}`;
  if (key === "inputImageProvided" || key === "maskImageProvided") return locale === "zh" ? "已提供" : "Provided";
  return String(value);
}

function DesktopImageGenerationDetails({ artifact, locale }: { artifact: ArtifactRow; locale: "zh" | "en" }) {
  const history = useContext(DesktopMediaHistoryContext);
  const runId = imageArtifactRunId(artifact.id);
  const metadata = history?.runMetadataById.get(runId)?.imageGeneration;
  const run = history?.runs.find((item) => item.id === runId);
  const promptMessage = history?.messages.find((message) => message.id === `message-${runId}` && message.role === "user");
  const parameters = {
    ...(metadata?.parameters ?? {}),
    ...(run?.model && !metadata?.parameters.model ? { model: run.model } : {}),
  };
  const parameterEntries = Object.entries(parameters).filter(([key]) => !["referenceImages", "localAttachments", "inputImageUrl", "maskImageUrl", "response_format", "responseFormat"].includes(key));
  const prompt = metadata?.prompt || promptMessage?.content.trim() || "";
  if (!prompt && !parameterEntries.length) return null;
  return <section className="media-image-details" aria-label={locale === "zh" ? "图片生成信息" : "Image generation details"} data-image-generation-details>
    <div className="media-image-detail-block">
      <div className="media-image-detail-heading"><strong>{locale === "zh" ? "提示词" : "Prompt"}</strong></div>
      <p className="media-image-detail-prompt">{prompt || (locale === "zh" ? "未记录提示词" : "No prompt recorded")}</p>
    </div>
    {parameterEntries.length ? <div className="media-image-detail-block">
      <div className="media-image-detail-heading"><strong>{locale === "zh" ? "参数" : "Parameters"}</strong></div>
      <dl className="media-image-parameter-list">{parameterEntries.map(([key, value]) => <div className="media-image-parameter" key={key}><dt>{desktopImageParameterLabels[key]?.[locale] ?? key}</dt><dd>{formatDesktopImageParameterValue(key, value, locale)}</dd></div>)}</dl>
    </div> : null}
  </section>;
}

function DesktopImageArtifactPreview({ artifactRows, locale, onArtifactReveal, onEditArtifact, generationStatus }: Pick<DesktopMediaWorkspaceProps, "artifactRows" | "locale" | "onArtifactReveal"> & { onEditArtifact?: (source: string) => void; generationStatus?: string | null }) {
  const imageArtifacts = artifactRows.filter((artifact) => artifact.mime_type.startsWith("image/")).slice(0, 6);
  const [preview, setPreview] = useState<{ artifactId: string; mimeType: string; source: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewingArtifactId, setPreviewingArtifactId] = useState<string | null>(null);
  const [historySources, setHistorySources] = useState<Record<string, string>>({});
  const [isImageFullscreen, setIsImageFullscreen] = useState(false);
  const imageRef = useRef<HTMLDivElement | null>(null);
  const previewSourceRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  const autoPreviewArtifactRef = useRef<string | null>(null);
  const historySourcesRef = useRef<Record<string, string>>({});
  const historyLoadRequestRef = useRef(0);
  useEffect(() => () => {
    if (previewSourceRef.current) URL.revokeObjectURL(previewSourceRef.current);
    Object.values(historySourcesRef.current).forEach((source) => URL.revokeObjectURL(source));
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsImageFullscreen(document.fullscreenElement === imageRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const imageArtifactKey = imageArtifacts.map((artifact) => artifact.id + ":" + artifact.relative_path + ":" + artifact.mime_type).join(String.fromCharCode(0));
  useEffect(() => {
    const requestId = ++historyLoadRequestRef.current;
    const validIds = new Set(imageArtifacts.map((artifact) => artifact.id));
    for (const [artifactId, source] of Object.entries(historySourcesRef.current)) {
      if (!validIds.has(artifactId)) {
        URL.revokeObjectURL(source);
        delete historySourcesRef.current[artifactId];
      }
    }

    const loadHistorySources = async () => {
      await Promise.all(imageArtifacts.map(async (artifact) => {
        if (historySourcesRef.current[artifact.id]) return;
        try {
          const payload = await tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath: artifact.relative_path, mimeType: artifact.mime_type });
          if (requestId !== historyLoadRequestRef.current) return;
          historySourcesRef.current[artifact.id] = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType || artifact.mime_type }));
        } catch {
          // The history item remains actionable even when its thumbnail cannot be loaded.
        }
      }));
      if (requestId !== historyLoadRequestRef.current) return;
      setHistorySources(Object.fromEntries(imageArtifacts.flatMap((artifact) => historySourcesRef.current[artifact.id] ? [[artifact.id, historySourcesRef.current[artifact.id]]] as const : [])));
    };
    void loadHistorySources();
  }, [imageArtifactKey]);

  const showPreview = async (artifact: ArtifactRow): Promise<string | null> => {
    const requestId = ++previewRequestRef.current;
    setPreviewError(null);
    setPreviewingArtifactId(artifact.id);
    try {
      const payload = await tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath: artifact.relative_path, mimeType: artifact.mime_type });
      if (requestId !== previewRequestRef.current) return null;
      const source = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType }));
      if (previewSourceRef.current) URL.revokeObjectURL(previewSourceRef.current);
      previewSourceRef.current = source;
      setPreview({ artifactId: artifact.id, mimeType: payload.mimeType, source });
      return source;
    } catch {
      if (requestId === previewRequestRef.current) {
        setPreviewError(locale === "zh" ? "图片无法显示，已在资源管理器中定位。" : "This image cannot be displayed here. It was revealed in File Explorer.");
        onArtifactReveal(artifact.relative_path, artifact.mime_type);
      }
      return null;
    } finally {
      if (requestId === previewRequestRef.current) setPreviewingArtifactId(null);
    }
  };

  useEffect(() => {
    const firstArtifact = imageArtifacts[0];
    if (!firstArtifact || preview?.artifactId === firstArtifact.id || autoPreviewArtifactRef.current === firstArtifact.id) return;
    autoPreviewArtifactRef.current = firstArtifact.id;
    void showPreview(firstArtifact);
  }, [imageArtifacts, preview]);

  const toggleImageFullscreen = async () => {
    if (!imageRef.current) return;
    try {
      if (document.fullscreenElement === imageRef.current) await document.exitFullscreen();
      else await imageRef.current.requestFullscreen();
    } catch {
      // Fullscreen is a progressive enhancement in browser preview mode.
    }
  };
  const closeImageFullscreen = async () => {
    if (document.fullscreenElement === imageRef.current) await document.exitFullscreen();
  };
  const currentArtifact = imageArtifacts.find((artifact) => artifact.id === preview?.artifactId);

  return <section className="media-image-output" aria-label={locale === "zh" ? "图片结果与历史" : "Image result and history"} data-image-output>
    <div className="media-image-stage" data-empty={!preview}>
      {preview ? <div ref={imageRef} className="media-image-fullscreen-frame">
        <img className="media-image-preview" src={preview.source} alt={locale === "zh" ? "生成的图片" : "Generated image"} />
        {isImageFullscreen ? <button type="button" className="media-image-fullscreen-close" onClick={() => void closeImageFullscreen()} aria-label={locale === "zh" ? "退出全屏" : "Exit fullscreen"} title={locale === "zh" ? "退出全屏" : "Exit fullscreen"}><span aria-hidden="true">×</span>{locale === "zh" ? "退出全屏" : "Exit fullscreen"}</button> : null}
      </div> : <div className="media-image-empty"><span aria-hidden="true">▧</span><strong>{generationStatus ? (locale === "zh" ? "正在生成图片…" : "Generating image…") : (locale === "zh" ? "运行后显示图片" : "Image appears after generation")}</strong><p>{locale === "zh" ? "生成结果会显示在这里。" : "Your generated result will appear here."}</p></div>}
      {previewingArtifactId ? <div className="media-image-loading" role="status">{locale === "zh" ? "正在加载图片…" : "Loading image…"}</div> : null}
      {generationStatus ? <div className="media-image-generation-status" data-image-generation-status role="status" aria-live="polite"><span className="media-image-generation-dot" aria-hidden="true" /><span>{generationStatus}</span></div> : null}
      {preview && currentArtifact ? <div className="media-image-actions">
        <button type="button" className="media-image-action" onClick={() => void toggleImageFullscreen()} aria-label={locale === "zh" ? "全屏查看图片" : "View image fullscreen"} title={locale === "zh" ? "全屏查看图片" : "View image fullscreen"}>⛶</button>
        <button type="button" className="media-image-action" onClick={() => onEditArtifact?.(preview.source)}>{locale === "zh" ? "编辑" : "Edit"}</button>
        <button type="button" className="media-image-action" onClick={() => onArtifactReveal(currentArtifact.relative_path, currentArtifact.mime_type)}>{locale === "zh" ? "打开" : "Open"}</button>
      </div> : null}
    </div>
    {previewError ? <p className="media-preview-error" role="status">{previewError}</p> : null}
    {preview && currentArtifact ? <DesktopImageGenerationDetails artifact={currentArtifact} locale={locale} /> : null}
    {imageArtifacts.length ? <section className="media-image-history" aria-label={locale === "zh" ? "历史" : "History"}>
      <div className="media-image-history-heading"><span>{locale === "zh" ? "历史" : "History"}</span><span className="muted">{imageArtifacts.length}</span></div>
      <div className="media-image-history-list">{imageArtifacts.map((artifact, index) => {
      const isPreviewing = previewingArtifactId === artifact.id;
      return <button key={artifact.id} type="button" className="media-image-history-item" data-active={preview?.artifactId === artifact.id || undefined} aria-pressed={preview?.artifactId === artifact.id} onClick={() => void showPreview(artifact)} disabled={isPreviewing} aria-label={`${locale === "zh" ? "历史图片" : "History image"} ${index + 1}`}>
        {historySources[artifact.id] ? <img className="media-image-history-thumbnail" src={historySources[artifact.id]} alt="" /> : <span className="media-image-history-placeholder" aria-hidden="true">{isPreviewing ? "…" : "▧"}</span>}
        <small>{isPreviewing ? (locale === "zh" ? "加载中…" : "Loading…") : `${locale === "zh" ? "图片" : "Image"} ${index + 1}`}</small>
      </button>;
    })}</div>
    </section> : null}
  </section>;
}

type DesktopMediaWorkspaceProps = Parameters<typeof DesktopMediaWorkspaceBody>[0] & {
  onOpenTasks?: () => void;
  onArtifactPreview?: (relativePath: string, mimeType: string) => Promise<LocalMediaPreview>;
};

function DesktopMediaResultPreview({ artifactRows, locale, onArtifactReveal, onArtifactPreview, compact = false }: Pick<DesktopMediaWorkspaceProps, "artifactRows" | "locale" | "onArtifactReveal" | "onArtifactPreview"> & { compact?: boolean }) {
  const mediaArtifacts = artifactRows.filter((artifact) => artifact.mime_type.startsWith("video/") || artifact.mime_type.startsWith("audio/")).slice(0, 6);
  const [preview, setPreview] = useState<{ artifactId: string; mimeType: string; source: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewingArtifactId, setPreviewingArtifactId] = useState<string | null>(null);
  const previewSourceRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  useEffect(() => () => { if (previewSourceRef.current) URL.revokeObjectURL(previewSourceRef.current); }, []);

  const showPreview = async (artifact: ArtifactRow) => {
    const requestId = ++previewRequestRef.current;
    setPreviewError(null);
    setPreviewingArtifactId(artifact.id);
    try {
      const payload = await (onArtifactPreview ?? ((relativePath: string, mimeType: string) => tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath, mimeType })))(artifact.relative_path, artifact.mime_type);
      if (requestId !== previewRequestRef.current) return;
      const source = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType }));
      if (previewSourceRef.current) URL.revokeObjectURL(previewSourceRef.current);
      previewSourceRef.current = source;
      setPreview({ artifactId: artifact.id, mimeType: payload.mimeType, source });
    } catch {
      if (requestId === previewRequestRef.current) {
        setPreviewError(locale === "zh" ? "此产物无法内嵌预览，已在资源管理器中定位。" : "This output cannot be previewed here. It was revealed in File Explorer.");
        onArtifactReveal(artifact.relative_path, artifact.mime_type);
      }
    } finally {
      if (requestId === previewRequestRef.current) setPreviewingArtifactId(null);
    }
  };

  if (!mediaArtifacts.length) return null;
  return <section className={`media-result-history ${compact ? "media-result-history-compact" : ""}`.trim()} aria-label={locale === "zh" ? "最新媒体产物" : "Latest media outputs"}>
    {!compact ? <div className="section-title"><span>{locale === "zh" ? "最新媒体产物" : "Latest media outputs"}</span><span className="muted">{mediaArtifacts.length}</span></div> : null}
    {preview ? <div className="media-inline-preview">{preview.mimeType.startsWith("video/") ? <video controls preload="metadata" src={preview.source} /> : <><AudioPlayer src={preview.source} title={locale === "zh" ? "音频产物" : "Audio output"} className="media-inline-audio" /><audio controls preload="metadata" src={preview.source} hidden /></>}<span>{locale === "zh" ? "正在预览本地产物" : "Previewing local output"}</span></div> : null}
    {previewError ? <p className="media-preview-error" role="status">{previewError}</p> : null}
    <div className="media-artifact-list">{mediaArtifacts.map((artifact) => {
      const isVideo = artifact.mime_type.startsWith("video/");
      const isPreviewing = previewingArtifactId === artifact.id;
      return <div key={artifact.id} className="media-artifact-row">
        <button type="button" className="media-artifact-preview-button" onClick={() => void showPreview(artifact)} disabled={isPreviewing}>
          <span>{isVideo ? "▶" : "♫"} {artifact.relative_path}</span>
          <small>{isPreviewing ? (locale === "zh" ? "正在加载预览…" : "Loading preview…") : isVideo ? (locale === "zh" ? "视频产物" : "Video output") : (locale === "zh" ? "音频产物" : "Audio output")} · {Math.ceil(artifact.byte_length / 1024)} KB</small>
        </button>
        <button type="button" className="media-artifact-open-button" onClick={() => onArtifactReveal(artifact.relative_path, artifact.mime_type)}>{locale === "zh" ? "打开" : "Open"}</button>
      </div>;
    })}</div>
  </section>;
}

function DesktopMediaWorkspace(props: DesktopMediaWorkspaceProps) {
  const { locale, workflowAction, onWorkflowAction, onOpenTasks, model, models } = props;
  const bodyProps: Parameters<typeof DesktopMediaWorkspaceBody>[0] = { ...props, onLoadVoices: props.onLoadVoices ?? desktopVoiceLoader };
  const routeSource = props.route.path.includes("?") || window.location.pathname !== props.route.path
    ? props.route.path
    : `${props.route.path}${window.location.search}`;
  const [routePath, routeQuery = ""] = routeSource.split("?", 2);
  const isVideo = routePath === "/dashboard/video";
  const isCapabilityCenter = routePath === "/dashboard/capabilities";
  const isMediaCatalog = isVideo || isCapabilityCenter;
  const copy = locale === "en"
    ? { eyebrow: "Media Workspace", title: props.route.label, description: isVideo ? props.route.description : "Open one tab per sub-capability. Fill the structured brief and review local task output, preview, and artifacts.", launchers: "Launchers", workspace: "Workspace", openFirst: "Choose an audio or video feature above to begin.", audio: "Audio Processing", video: "Video Processing" }
    : { eyebrow: "Media Workspace", title: props.route.label, description: isVideo ? props.route.description : "按子能力打开独立 Tab：填写结构化信息，并查看本地任务状态、产物预览和文件。", launchers: "能力入口", workspace: "多 Tab 工作区", openFirst: "先从上方选择一个音频或视频子能力。", audio: "音频处理", video: "视频处理" };
  const configuredModelsKey = (models ?? []).join("\u0000");
  const localizedFeatures = useMemo(() => mediaFeatureCatalog
    .filter((feature) => feature.id !== "audio-generate")
    .map((feature) => applyConfiguredMediaModels(feature, models, model))
    .map((feature) => ({ ...feature, title: locale === "en" ? mediaEnglish[feature.id] ?? feature.title : feature.title, summary: locale === "en" ? mediaSummaryEnglish[feature.id] ?? feature.summary : feature.summary })), [configuredModelsKey, locale, model]);
  const groups = [{ id: "audio", title: copy.audio, description: locale === "en" ? "Handle music generation, voice cloning, and speech synthesis in one audio workspace." : "支持音乐生成、声音克隆与语音合成，统一在一个音频工作区完成。", features: localizedFeatures.filter((feature) => feature.group === "audio") }, { id: "video", title: copy.video, description: locale === "en" ? "Handle video, digital human, editing, and enhancement in one video workspace." : "支持视频、数字人、视频编辑和高清化，统一在一个视频工作区完成。", features: localizedFeatures.filter((feature) => feature.group === "video") }];
  const actionByFeature: Partial<Record<MediaFeatureId, WorkflowAction>> = { "ai-music": "music_generate", "audio-generate": "audio_generate", "voice-clone": "voice_clone", "voice-synthesis": "voice_synthesis", "text-to-video": "video_generate", "image-to-video": "video_generate", "reference-to-video": "video_generate", "video-edit": "video_generate", "digital-human": "digital_human", "video-enhance": "video_generate" };
  // Seed tabs from the configured capability profile, not the catalog's
  // placeholder model. Otherwise the first media run can send e.g.
  // `minimax/video-01` while the active Provider is configured for H3.
  const featureMap = useMemo(() => new Map(localizedFeatures.map((feature) => [feature.id, feature])), [localizedFeatures]);
  const featureForAction = (action: WorkflowAction) => Object.entries(actionByFeature).find(([, mappedAction]) => mappedAction === action)?.[0] as MediaFeatureId | undefined;
  const requestedFeature = new URLSearchParams(routeQuery).get("feature") as MediaFeatureId | null;
  const initialFeatureId = requestedFeature && featureMap.has(requestedFeature)
    ? requestedFeature
    : isVideo
      ? featureForAction(workflowAction) ?? "text-to-video"
      : null;
  const [tabs, setTabs] = useState<DesktopMediaTabState[]>(() => {
    const initialFeature = initialFeatureId ? featureMap.get(initialFeatureId) : undefined;
    return initialFeature ? [createDesktopMediaTab(initialFeature)] : [];
  });
  const [activeFeatureId, setActiveFeatureId] = useState<MediaFeatureId | null>(initialFeatureId);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const wasVideoRouteRef = useRef(isVideo);

  const focusWorkspace = () => window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  useEffect(() => {
    if (!isVideo || !tabs.length || (activeFeatureId && actionByFeature[activeFeatureId] === workflowAction)) return;
    const nextFeatureId = tabs.find((tab) => actionByFeature[tab.featureId] === workflowAction)?.id ?? featureForAction(workflowAction) ?? "text-to-video";
    const feature = featureMap.get(nextFeatureId);
    if (!feature) return;
    setTabs((current) => openDesktopMediaTab(current, feature));
    setActiveFeatureId(nextFeatureId);
  }, [activeFeatureId, featureMap, isVideo, tabs, workflowAction]);

  useEffect(() => {
    const enteredVideoRoute = isVideo && !wasVideoRouteRef.current;
    wasVideoRouteRef.current = isVideo;
    if (!enteredVideoRoute || tabs.length) return;
    const feature = featureMap.get(featureForAction(workflowAction) ?? "text-to-video");
    if (!feature) return;
    setTabs([createDesktopMediaTab(feature)]);
    setActiveFeatureId(feature.id);
  }, [featureMap, isVideo, tabs.length, workflowAction]);

  const activateFeature = (featureId: MediaFeatureId) => {
    setActiveFeatureId(featureId);
    const nextAction = actionByFeature[featureId];
    if (nextAction && nextAction !== workflowAction) onWorkflowAction(nextAction);
  };
  const openFeature = (featureId: MediaFeatureId) => {
    const feature = featureMap.get(featureId);
    if (!feature) return;
    setTabs((current) => openDesktopMediaTab(current, feature));
    activateFeature(featureId);
    focusWorkspace();
  };
  const closeFeature = (featureId: MediaFeatureId) => {
    const next = closeDesktopMediaTab(tabs, activeFeatureId, featureId);
    setTabs(next.tabs);
    const nextActive = next.activeTabId;
    if (nextActive === activeFeatureId) return;
    setActiveFeatureId(nextActive);
    const nextAction = nextActive ? actionByFeature[nextActive] : undefined;
    if (nextAction && nextAction !== workflowAction) onWorkflowAction(nextAction);
  };
  const patchActiveTab = (updater: (current: DesktopMediaTabState) => DesktopMediaTabState) => {
    if (!activeFeatureId) return;
    setTabs((current) => current.map((tab) => tab.id === activeFeatureId ? updater(tab) : tab));
  };
  const activeTab = tabs.find((tab) => tab.id === activeFeatureId) ?? null;
  const capabilityGroups: WorkbenchCapabilityCenterGroup[] = groups.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    kind: group.id as "audio" | "video",
    features: group.features.map((feature) => ({
      id: feature.id,
      title: feature.title,
      summary: feature.summary,
      kind: feature.group,
      disabled: !props.providerConfigured,
      ...(!props.providerConfigured ? { disabledReason: locale === "zh" ? "需要配置对应媒体 Provider" : "Configure the matching media provider" } : {}),
    })),
  }));
  if (!isMediaCatalog) return <DesktopMediaWorkspaceBody {...bodyProps} />;
  return <div className="desktop-media-route-shell" ref={workspaceRef}>
    <WorkbenchCapabilityCenter
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      groups={capabilityGroups}
      openFeatureIds={tabs.map((tab) => tab.id)}
      activeFeatureId={activeFeatureId}
      onFeatureOpen={(featureId) => openFeature(featureId as MediaFeatureId)}
      onFeatureActivate={(featureId) => activateFeature(featureId as MediaFeatureId)}
      onFeatureClose={(featureId) => closeFeature(featureId as MediaFeatureId)}
      workspaceLabel={copy.workspace}
      launchersLabel={copy.launchers}
      openFirstLabel={copy.openFirst}
      openTabsLabel={(count) => `${count} ${locale === "en" ? "open tabs" : "个已打开标签"}`}
      allTasksLabel={locale === "en" ? "All tasks" : "全部任务"}
      onOpenTasks={onOpenTasks}
    >
      {activeTab ? <DesktopMediaWorkspaceBody {...bodyProps} route={isVideo ? props.route : { ...props.route, path: "/dashboard/video" }} mediaFeatureId={activeTab.featureId} tabState={activeTab} onTabStateChange={patchActiveTab} showFeatureSelectors={false} showHeader={false} /> : null}
      {!activeTab ? <DesktopMediaResultPreview artifactRows={props.artifactRows} locale={locale} onArtifactReveal={props.onArtifactReveal} onArtifactPreview={props.onArtifactPreview} /> : null}
    </WorkbenchCapabilityCenter>
  </div>;
}

function isPreviewableArtifact(artifact: ArtifactRow) {
  return /^(image|audio|video)\//iu.test(artifact.mime_type);
}


type DesktopAssetLibraryCopy = { preview: string; open: string; folder: string; unavailable: string; remove: string; removeConfirm: string; loading: string; failed: string; videoLabel: string; audioLabel: string };

type AssetCardMediaCopy = { loading: string; unavailable: string; failed: string; imageAlt: string; videoLabel: string; audioLabel: string };

async function readArtifactPreviewSource(artifact: Pick<ArtifactRow, "relative_path" | "mime_type">) {
  const payload = await tauriBridge.invoke<LocalMediaPreview>("read_artifact", { relativePath: artifact.relative_path, mimeType: artifact.mime_type });
  const url = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mimeType || artifact.mime_type }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

type CachedArtifactPreview = { url: string; revoke: () => void; lastUsed: number };
const ARTIFACT_PREVIEW_CACHE_LIMIT = 64;
const artifactPreviewCache = new Map<string, CachedArtifactPreview>();
const artifactPreviewPending = new Map<string, Promise<CachedArtifactPreview>>();

function artifactPreviewCacheKey(artifact: Pick<ArtifactRow, "id" | "relative_path" | "mime_type" | "sha256" | "byte_length">) {
  return [artifact.id, artifact.relative_path, artifact.mime_type, artifact.sha256 ?? "", artifact.byte_length ?? ""].join("\u001f");
}

function trimArtifactPreviewCache() {
  while (artifactPreviewCache.size > ARTIFACT_PREVIEW_CACHE_LIMIT) {
    const oldest = [...artifactPreviewCache.entries()].sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
    if (!oldest) return;
    artifactPreviewCache.delete(oldest[0]);
    oldest[1].revoke();
  }
}

async function readCachedArtifactPreview(item: ArtifactRow) {
  const key = artifactPreviewCacheKey(item);
  const cached = artifactPreviewCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return { url: cached.url, revoke: () => undefined };
  }
  const pending = artifactPreviewPending.get(key);
  if (pending) {
    const preview = await pending;
    preview.lastUsed = Date.now();
    return { url: preview.url, revoke: () => undefined };
  }
  const loading = readArtifactPreviewSource(item).then((preview) => {
    const entry = { ...preview, lastUsed: Date.now() };
    artifactPreviewCache.set(key, entry);
    trimArtifactPreviewCache();
    return entry;
  }).finally(() => {
    artifactPreviewPending.delete(key);
  });
  artifactPreviewPending.set(key, loading);
  const preview = await loading;
  return { url: preview.url, revoke: () => undefined };
}

function DesktopArtifactCardMedia({ item, title, copy, onPreview }: { item: ArtifactRow; title: string; copy: AssetCardMediaCopy; onPreview: (artifact: ArtifactRow, source: string) => void }) {
  const imageArtifact = item.mime_type.startsWith("image/");
  const videoArtifact = item.mime_type.startsWith("video/");
  const audioArtifact = item.mime_type.startsWith("audio/");
  const [source, setSource] = useState<string | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<string | null>(null);
  useEffect(() => {
    if ((!imageArtifact && !videoArtifact && !audioArtifact) || item.available === false || shouldLoad) {
      return;
    }
    const element = mediaRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      startTransition(() => setShouldLoad(true));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      startTransition(() => setShouldLoad(true));
      observer.disconnect();
    }, { rootMargin: "320px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [audioArtifact, imageArtifact, item.available, shouldLoad, videoArtifact]);
  useEffect(() => {
    if (!shouldLoad || (!imageArtifact && !videoArtifact && !audioArtifact) || item.available === false) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void readCachedArtifactPreview(item).then((preview) => {
      if (cancelled) {
        preview.revoke();
        return;
      }
      sourceRef.current = preview.url;
      setSource(preview.url);
    }).catch(() => {
      if (!cancelled) setError(copy.failed);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      sourceRef.current = null;
    };
  }, [audioArtifact, imageArtifact, item.available, item.id, item.mime_type, item.relative_path, shouldLoad, videoArtifact]);
  const kind = imageArtifact ? "image" : videoArtifact ? "video" : audioArtifact ? "audio" : "file";
  return <div ref={mediaRef} className={`asset-library-card-media ${imageArtifact ? "is-image" : videoArtifact ? "is-video" : audioArtifact ? "is-audio" : ""}`.trim()} data-media-kind={kind} data-preview-state={loading ? "loading" : error ? "error" : source ? "ready" : "idle"}>
    {loading ? <span className="asset-library-card-media-status">{copy.loading}</span> : error ? <span className="asset-library-card-media-status asset-library-card-media-error">{copy.failed}</span> : source && imageArtifact ? <img src={source} alt={`${copy.imageAlt}: ${title}`} loading="lazy" onClick={() => onPreview(item, source)} /> : source && videoArtifact ? <video controls preload="metadata" src={source} aria-label={`${copy.videoLabel}: ${title}`} /> : source && audioArtifact ? <audio controls preload="metadata" src={source} aria-label={`${copy.audioLabel}: ${title}`} /> : <span className="asset-library-card-icon" aria-hidden="true">{videoArtifact ? "▶" : audioArtifact ? "♫" : item.mime_type.includes("presentation") ? "P" : imageArtifact ? "▧" : "▤"}</span>}
    {item.available === false ? <span className="asset-library-card-media-status">{copy.unavailable}</span> : null}
    {source && (imageArtifact || videoArtifact || audioArtifact) ? <button type="button" className="asset-library-card-preview" onClick={() => onPreview(item, source)} aria-label={`${copy.imageAlt}: ${title}`} title={copy.imageAlt}><Maximize2 size={14} aria-hidden="true" /><span>{copy.imageAlt}</span></button> : null}
  </div>;
}

function DesktopArtifactLibraryCard({ item, copy, locale, onPreview, onArtifactRemove, onArtifactOpen, onArtifactOpenFolder, runFileAction }: { item: ArtifactRow; copy: DesktopAssetLibraryCopy; locale: "zh" | "en"; onPreview: (artifact: ArtifactRow, source: string) => void; onArtifactRemove: (artifactId: string) => void; onArtifactOpen: (relativePath: string, mimeType: string) => Promise<void>; onArtifactOpenFolder: (relativePath: string, mimeType: string) => Promise<void>; runFileAction: (action: () => Promise<void>) => Promise<void> }) {
  const title = item.relative_path.split(/[\\/]/).pop() ?? item.relative_path;
  const mediaCopy = { loading: copy.loading, unavailable: copy.unavailable, failed: copy.failed, imageAlt: copy.preview, videoLabel: copy.videoLabel, audioLabel: copy.audioLabel };
  const confirmRemove = () => {
    if (window.confirm(`${copy.removeConfirm} “${title}”？`)) onArtifactRemove(item.id);
  };
  return <article className="asset-library-card">
    <DesktopArtifactCardMedia item={item} title={title} copy={mediaCopy} onPreview={onPreview} />
    <div className="asset-library-card-body"><strong title={item.relative_path}>{title}</strong><div className="asset-library-card-meta"><small title={item.mime_type}>{item.mime_type}</small><time dateTime={item.created_at}>{formatDateTime(item.created_at, locale)}</time></div></div>
    <div className="asset-library-card-actions">
      <button type="button" className="asset-library-card-action" disabled={item.available === false} onClick={() => void runFileAction(() => onArtifactOpen(item.relative_path, item.mime_type))}>{item.available === false ? copy.unavailable : copy.open}</button>
      {item.available !== false ? <button type="button" className="asset-library-card-action" onClick={() => void runFileAction(() => onArtifactOpenFolder(item.relative_path, item.mime_type))}>{copy.folder}</button> : null}
      <button type="button" className="asset-library-card-action asset-library-card-action-danger" onClick={confirmRemove} aria-label={`${copy.remove}: ${title}`} title={copy.remove}><Trash2 size={13} aria-hidden="true" /><span>{copy.remove}</span></button>
    </div>
  </article>;
}

function DesktopArtifactPreviewModal({ artifact, source, onClose, onOpen, onOpenFolder, locale }: { artifact: ArtifactRow; source: string; onClose: () => void; onOpen: () => Promise<void>; onOpenFolder: () => Promise<void>; locale: "zh" | "en" }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  const title = artifact.relative_path.split(/[\\/]/).pop() ?? artifact.relative_path;
  return <div className="artifact-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="artifact-preview-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><strong>{title}</strong><small>{artifact.mime_type} · {Math.max(1, Math.ceil(artifact.byte_length / 1024))} KB</small></div><button type="button" className="link-button" onClick={onClose}>{locale === "zh" ? "关闭" : "Close"}</button></header><div className="artifact-preview-stage"><div className="artifact-preview-content">{artifact.mime_type.startsWith("image/") ? <img src={source} alt={title} /> : artifact.mime_type.startsWith("video/") ? <video controls autoPlay preload="metadata" src={source} /> : <audio controls autoPlay preload="metadata" src={source} />}</div><footer><button type="button" className="ghost" onClick={() => void onOpenFolder()}>{locale === "zh" ? "打开所在文件夹" : "Open containing folder"}</button><button type="button" className="primary" onClick={() => void onOpen()}>{locale === "zh" ? "使用默认应用打开" : "Open with default app"}</button></footer></div></section></div>;
}

function DesktopAssetLibrarySurface({ artifactRows, onArtifactRemove, onArtifactReveal: _onArtifactReveal, onArtifactOpen, onArtifactOpenFolder, locale }: { artifactRows: ArtifactRow[]; onArtifactRemove: (artifactId: string) => void; onArtifactReveal: (relativePath: string, mimeType: string) => void; onArtifactOpen: (relativePath: string, mimeType: string) => Promise<void>; onArtifactOpenFolder: (relativePath: string, mimeType: string) => Promise<void>; locale: "zh" | "en" }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<AssetLibraryTab>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewArtifact, setPreviewArtifact] = useState<{ artifact: ArtifactRow; source: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const copy = locale === "en"
    ? { eyebrow: "ASSET LIBRARY", title: "Asset library", description: "Browse local files produced by writing, PPT, workflows, and media runs.", all: "All assets", recent: "Recent", documents: "Documents", search: "Search local assets…", grid: "Grid", list: "List", empty: "No local artifacts yet", emptyHint: "Artifacts appear here after writing, PPT, or media runs.", unavailable: "Unavailable", remove: "Delete", removeConfirm: "Delete this asset from the library", preview: "Enlarge preview", open: "Open", folder: "Folder", loading: "Loading preview…", failed: "Preview unavailable", videoLabel: "Video preview", audioLabel: "Audio preview" }
    : { eyebrow: "资产库", title: "资产库", description: "浏览写作、PPT、工作流和媒体任务生成的本地文件。", all: "全部资产", recent: "最近", documents: "文档", search: "搜索本地产物……", grid: "网格", list: "列表", empty: "还没有本地产物", emptyHint: "运行写作、PPT 或媒体任务后，文件会显示在这里。", unavailable: "文件不可用", remove: "删除", removeConfirm: "确认从资产库删除", preview: "放大预览", open: "默认应用打开", folder: "打开文件夹", loading: "正在加载预览…", failed: "预览不可用", videoLabel: "视频预览", audioLabel: "音频预览" };
  const filtered = useMemo(() => filterAssetLibraryItems(artifactRows, tab, query), [artifactRows, query, tab]);
  const runFileAction = async (action: () => Promise<void>) => { setActionError(""); try { await action(); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
  return <div className="library-workspace asset-library-surface"><header className="asset-library-header"><div><div className="eyebrow">{copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.description}</p></div><div className="asset-library-header-meta"><span className="chat-runtime-badge">{artifactRows.length} {locale === "en" ? "files" : "个文件"}</span><button type="button" className={`view-toggle ${view === "grid" ? "active" : ""}`.trim()} onClick={() => setView("grid")}>{copy.grid}</button><button type="button" className={`view-toggle ${view === "list" ? "active" : ""}`.trim()} onClick={() => setView("list")}>{copy.list}</button></div></header><div className="asset-library-toolbar"><div className="asset-library-tabs">{(["all", "recent", "documents"] as const).map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{copy[item]}</button>)}</div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} /></div>{actionError ? <p className="media-preview-error" role="status">{actionError}</p> : null}{filtered.length ? <div className={`asset-library-grid ${view === "list" ? "list-view" : ""}`.trim()}>{filtered.map((item) => <DesktopArtifactLibraryCard key={item.id} item={item} copy={copy} locale={locale} onPreview={(artifact, source) => setPreviewArtifact({ artifact, source })} onArtifactRemove={onArtifactRemove} onArtifactOpen={onArtifactOpen} onArtifactOpenFolder={onArtifactOpenFolder} runFileAction={runFileAction} />)}</div> : <div className="empty-state asset-library-empty"><div className="empty-icon">▱</div><strong>{copy.empty}</strong><p>{copy.emptyHint}</p></div>}{previewArtifact ? <DesktopArtifactPreviewModal artifact={previewArtifact.artifact} source={previewArtifact.source} onClose={() => setPreviewArtifact(null)} onOpen={() => runFileAction(() => onArtifactOpen(previewArtifact.artifact.relative_path, previewArtifact.artifact.mime_type))} onOpenFolder={() => runFileAction(() => onArtifactOpenFolder(previewArtifact.artifact.relative_path, previewArtifact.artifact.mime_type))} locale={locale} /> : null}</div>;
}

function DesktopTaskCenterSurfaceContent({ runs, conversations, onNavigate: navigatePath, onRetryRun, onInspectRun, locale }: { runs: RunRow[]; conversations: Array<{ id: string; agent_id?: string | null }>; onNavigate: (path: string) => void; onRetryRun: (run: RunRow) => void; onInspectRun: (runId: string) => Promise<RunDetail>; locale: "zh" | "en" }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [entryLoadingId, setEntryLoadingId] = useState<string | null>(null);
  const copy = locale === "en"
    ? { eyebrow: "TASK CENTER", title: "Task Center", description: "Review local workflow, media, tool, and agent activity as grouped tasks. Historical records are retained.", total: "Total tasks", active: "Active", healthy: "No review items (history included)", review: "Needs review (history included)", search: "Search task name or run ID…", all: "All status", empty: "No task history", emptyHint: "Chat, writing, and workflow run states are stored here.", view: "Open task", evidence: "View evidence", retry: "Prepare retry", loading: "Loading run evidence…", nodes: "Nodes", events: "Events", usage: "Usage", noEvidence: "No persisted execution evidence", close: "Close", historyNote: "Historical failures are retained for audit. This view does not claim that historical P0/P1 records are zero; assess the current acceptance run from its evidence." }
    : { eyebrow: "任务中心", title: "任务中心", description: "按任务查看本地工作流、媒体、工具和 Agent 的执行情况。历史记录会保留。", total: "任务总数", active: "进行中", healthy: "无需关注（含历史）", review: "需要关注（含历史）", search: "搜索任务名称或运行 ID……", all: "全部状态", empty: "暂无任务记录", emptyHint: "普通对话、写作和工作流的运行状态会保存在这里。", view: "打开任务", evidence: "查看执行证据", retry: "准备重试", loading: "正在加载运行证据…", nodes: "节点", events: "事件", usage: "用量", noEvidence: "暂无已持久化的执行证据", close: "关闭", historyNote: "历史失败记录会保留以便审计。本页面不会声称历史 P0/P1 记录为零；本轮验收请以对应运行的截图、日志和证据为准。" };
  const label = (value: string) => getWorkbenchTaskStatusLabel(normalizeWorkbenchTaskStatus(value), locale);
  const filtered = runs.filter((run) => {
    const normalizedStatus = normalizeWorkbenchTaskStatus(run.status);
    return (!query.trim() || `${run.id} ${run.model ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) && (status === "all" || normalizedStatus === normalizeWorkbenchTaskStatus(status));
  });
  const activeCount = runs.filter((run) => isWorkbenchTaskActive(normalizeWorkbenchTaskStatus(run.status))).length;
  const reviewCount = runs.filter((run) => isWorkbenchTaskRetryable(normalizeWorkbenchTaskStatus(run.status))).length;
  const inspect = async (runId: string) => {
    if (selectedRunId === runId) { setSelectedRunId(null); setDetail(null); setDetailError(""); return; }
    setSelectedRunId(runId); setDetail(null); setDetailError(""); setDetailLoading(true);
    try { setDetail(await onInspectRun(runId)); } catch (error) { setDetailError(error instanceof Error ? error.message : String(error)); } finally { setDetailLoading(false); }
  };
  const payloadPreview = (payload: string) => { try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload.slice(0, 2000); } };
  const inputTokens = detail?.usage.reduce((sum, item) => sum + (item.input_tokens ?? 0), 0) ?? 0;
  const outputTokens = detail?.usage.reduce((sum, item) => sum + (item.output_tokens ?? 0), 0) ?? 0;
  const routeForConversationId = (id: string | null | undefined) => conversationRoute(conversations.find((conversation) => conversation.id === id) ?? { id: id ?? "" });
  const onNavigate = (path: string) => navigatePath(conversationAwareRoute(path, conversations));
  const openTaskEntry = async (run: RunRow) => {
    setEntryLoadingId(run.id);
    try {
      const runDetail = await onInspectRun(run.id);
      const metadata = readDesktopTaskMetadata(runDetail);
      const target = metadata?.entryPath || (run.conversation_id ? routeForConversationId(run.conversation_id) : null);
      if (target) onNavigate(target);
      else await inspect(run.id);
    } catch {
      await inspect(run.id);
    } finally {
      setEntryLoadingId(null);
    }
  };
  return <div className="library-workspace task-center-surface"><header className="task-center-header"><div><div className="eyebrow">{copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.description}</p></div><div className="task-center-header-meta"><span className="chat-runtime-badge">OpenCode · SQLite</span></div></header><div className="task-metric-grid"><div><span>{copy.total}</span><strong>{runs.length}</strong></div><div><span>{copy.active}</span><strong>{activeCount}</strong></div><div><span>{copy.healthy}</span><strong>{Math.max(0, runs.length - reviewCount)}</strong></div><div><span>{copy.review}</span><strong>{reviewCount}</strong></div></div><div className="task-center-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={copy.all}><option value="all">{copy.all}</option><option value="running">{getWorkbenchTaskStatusLabel("running", locale)}</option><option value="waiting">{getWorkbenchTaskStatusLabel("waiting", locale)}</option><option value="completed">{getWorkbenchTaskStatusLabel("completed", locale)}</option><option value="failed">{getWorkbenchTaskStatusLabel("failed", locale)}</option><option value="cancelled">{getWorkbenchTaskStatusLabel("cancelled", locale)}</option><option value="queued">{getWorkbenchTaskStatusLabel("queued", locale)}</option></select></div>{filtered.length ? <div className="task-center-table"><div className="task-center-table-head"><span>{locale === "en" ? "Task" : "任务"}</span><span>{locale === "en" ? "Latest run" : "最近运行"}</span><span>{locale === "en" ? "Status" : "状态"}</span><span>{locale === "en" ? "Actions" : "操作"}</span></div>{filtered.map((run) => { const normalizedStatus = normalizeWorkbenchTaskStatus(run.status); return <div className="task-center-row" key={run.id}><div><strong>{run.model || (locale === "en" ? "Local model" : "本地模型")}</strong><small>{run.id}</small></div><time>{new Date(run.started_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</time><span className={`task-status task-status-${normalizedStatus}`}>{label(run.status)}</span><div className="task-row-actions"><button type="button" className="link-button" disabled={entryLoadingId === run.id} onClick={() => void openTaskEntry(run)}>{entryLoadingId === run.id ? copy.loading : copy.view}</button><button type="button" className="link-button" onClick={() => void inspect(run.id)}>{selectedRunId === run.id ? copy.close : copy.evidence}</button>{isWorkbenchTaskRetryable(normalizedStatus) ? <button type="button" className="ghost" onClick={() => onRetryRun(run)}>{copy.retry}</button> : null}</div></div> })}</div> : <div className="empty-state"><div className="empty-icon">≡</div><strong>{copy.empty}</strong><p>{copy.emptyHint}</p></div>}{selectedRunId ? <section className="knowledge-local-card run-evidence-panel"><div className="section-title"><span>{copy.evidence}</span><button type="button" className="link-button" onClick={() => { setSelectedRunId(null); setDetail(null); }}>{copy.close}</button></div>{detailLoading ? <p className="muted">{copy.loading}</p> : detailError ? <p className="status-error">{detailError}</p> : detail ? <><div className="stats-grid"><div><strong>{detail.nodes.length}</strong><span>{copy.nodes}</span></div><div><strong>{detail.events.length}</strong><span>{copy.events}</span></div><div><strong>{inputTokens + outputTokens}</strong><span>Token</span></div><div><strong>{detail.usage.length}</strong><span>{copy.usage}</span></div></div><div className="run-list"><strong>{copy.nodes}</strong>{detail.nodes.length ? detail.nodes.map((node) => <div className="run-row" key={node.node_key}><div className="run-row-main"><strong>{node.node_key}</strong><span>{node.status}</span><small>{node.output_json ? node.output_json.slice(0, 280) : ""}</small></div></div>) : <p className="muted">{copy.noEvidence}</p>}</div><div className="run-list"><strong>{copy.events}</strong>{detail.events.length ? detail.events.slice(-24).map((event) => <details key={`${event.sequence}-${event.event_type}`} className="run-row"><summary><strong>#{event.sequence} · {event.event_type}</strong><small>{formatDateTime(event.created_at, locale)}</small></summary><pre>{payloadPreview(event.payload_json)}</pre></details>) : <p className="muted">{copy.noEvidence}</p>}</div><div className="run-list"><strong>{copy.usage}</strong>{detail.usage.length ? detail.usage.map((item, index) => <div className="run-row" key={`${item.created_at}-${index}`}><div className="run-row-main"><strong>{item.model}</strong><span>{item.provider ?? (locale === "en" ? "Provider unknown" : "Provider 未知")}</span><small>{(item.input_tokens ?? 0) + (item.output_tokens ?? 0)} token · {item.provider_cost === undefined || item.provider_cost === null ? (locale === "en" ? "Cost unknown" : "成本未知") : `$${item.provider_cost.toFixed(4)}`}</small></div></div>) : <p className="muted">{copy.noEvidence}</p>}</div></> : null}</section> : null}</div>;
}

function DesktopTaskCenterSurface(props: Parameters<typeof DesktopTaskCenterSurfaceContent>[0]) {
  const queuedItems = props.runs
    .map((run) => ({ run, status: normalizeWorkbenchTaskStatus(run.status) }))
    .filter(({ status }) => isWorkbenchTaskActive(status))
    .map(({ run, status }) => ({ id: run.id, title: run.model || "Local task", status }));
  return <Queue className="task-center-queue" items={queuedItems}><DesktopTaskCenterSurfaceContent {...props} /></Queue>;
}

function DesktopLibraryWorkspace({ route, artifactRows, savedWorkflows, conversations, runs, taskCount, tokenCount, artifactCount, providerCost: initialProviderCost, estimatedCost: initialEstimatedCost, onNavigate: navigatePath, onRetryRun, onInspectRun, onArtifactRemove, onArtifactReveal, onKnowledgeOpen, knowledgeQuery, knowledgeResults, knowledgeStatus, onKnowledgeQueryChange, onKnowledgeSearch, locale }: { route: DesktopRoute; artifactRows: Array<ArtifactRow>; savedWorkflows: Array<{ id: string; name: string; definition_json: string; updated_at: string }>; conversations: Array<{ id: string; title: string; updated_at: string; agent_id?: string | null }>; runs: RunRow[]; taskCount: number; tokenCount: number; artifactCount: number; providerCost?: number; estimatedCost?: number; onNavigate: (path: string) => void; onRetryRun: (run: RunRow) => void; onInspectRun: (runId: string) => Promise<RunDetail>; onArtifactRemove: (artifactId: string) => void; onArtifactReveal: (relativePath: string, mimeType: string) => void; onKnowledgeOpen: (relativePath: string, mimeType?: string) => void; knowledgeQuery: string; knowledgeResults: KnowledgeResult[]; knowledgeStatus: string; onKnowledgeQueryChange: (value: string) => void; onKnowledgeSearch: () => void; locale: "zh" | "en" }) {
  const providerCost = initialProviderCost;
  const usageCost = initialEstimatedCost;
  // The existing stat cell treats non-positive values as unknown; preserve an explicit known zero.
  const estimatedCost = usageCost === undefined ? Number.NaN : usageCost || Number.MIN_VALUE;
  const isAssets = route.path === "/dashboard/assets" || route.path === "/dashboard/works";
  const isKnowledge = route.path === "/dashboard/knowledge-base";
  const isCapabilities = route.path === "/dashboard/capabilities";
  const isTasks = route.path === "/dashboard/tasks";
  const isSettings = route.path === "/dashboard/settings";
  const routeForConversationId = (id: string) => conversationRoute(conversations.find((conversation) => conversation.id === id) ?? { id });
  const onNavigate = (path: string) => navigatePath(conversationAwareRoute(path, conversations));
  if (isAssets) return <DesktopAssetLibrarySurface artifactRows={artifactRows} onArtifactRemove={onArtifactRemove} onArtifactReveal={onArtifactReveal} onArtifactOpen={(relativePath, mimeType) => tauriBridge.invoke("open_artifact_default", { relativePath, mimeType }).then(() => undefined)} onArtifactOpenFolder={(relativePath, mimeType) => tauriBridge.invoke("open_artifact_folder", { relativePath, mimeType }).then(() => undefined)} locale={locale} />;
  if (isTasks) return <DesktopTaskCenterSurface runs={runs} conversations={conversations} onNavigate={onNavigate} onRetryRun={onRetryRun} onInspectRun={onInspectRun} locale={locale} />;
  const ui = locale === "en" ? { localData: "Local data", localStats: "Local stats", countOnly: "Stats only; no billing", artifacts: "Local artifacts", vault: "Obsidian Vault", skills: "Local Skills", tasks: "Task runs", recent: "Recent activity", live: "Live", files: "files", records: "records", noTasks: "No task history", noArtifacts: "No local artifacts yet", noRecords: "No local records", configureVault: "Configure Vault", modelRuntime: "Model & runtime", settingsHint: "Edit config.json from the model settings dialog; ordinary chat and workflows both use OpenCode.", tasksLabel: "Tasks", artifactLabel: "Artifacts", providerCost: "Provider cost", estimated: "Estimated cost", unknown: "Cost unknown" } : { localData: "本地数据", localStats: "本地统计", countOnly: "只统计，不扣费", artifacts: "本地产物", vault: "Obsidian Vault", skills: "本地 Skills", tasks: "任务运行", recent: "最近活动", live: "实时", files: "个文件", records: "条记录", noTasks: "暂无任务记录", noArtifacts: "还没有本地产物", noRecords: "暂无本地记录", configureVault: "配置 Vault", modelRuntime: "模型与运行环境", settingsHint: "使用右上角“模型配置”编辑 config.json；普通对话和工作流均经过 OpenCode。", tasksLabel: "任务", artifactLabel: "产物", providerCost: "Provider 返回成本", estimated: "本地预估成本", unknown: "成本未知" };
  const sectionLabel = isAssets ? ui.artifacts : isKnowledge ? ui.vault : isCapabilities ? ui.skills  : isSettings ? ui.modelRuntime : ui.recent;
  const sectionMeta = isAssets ? `${artifactRows.length} ${ui.files}` : isKnowledge ? "manifest + LanceDB" : isCapabilities ? `${desktopCapabilities.length} ${locale === "en" ? "capabilities" : "项"}`  : ui.live;
  return <div className="library-workspace"><header className="workflow-page-header"><div><div className="eyebrow">LOCAL RESOURCE CENTER</div><h1>{route.label}</h1><p>{route.description}</p></div><span className="chat-runtime-badge">{ui.localData}</span></header><div className="library-workspace-grid"><section className="library-main-panel"><div className="section-title"><span>{sectionLabel}</span><span className="muted">{sectionMeta}</span></div>{isCapabilities ? <div className="capability-directory-grid">{desktopCapabilities.map((item) => <button key={item.id} type="button" className="capability-directory-card" onClick={() => onNavigate(item.route)}><span className="capability-directory-icon"><RouteIcon name={item.kind === "media" ? "video" : item.kind === "knowledge" ? "knowledge" : item.id === "ppt_generate" ? "ppt" : "writer"} size={20} /></span><span className="capability-directory-copy"><strong>{locale === "en" ? capabilityEnglish[item.id]?.title ?? item.title : item.title}</strong><small>{locale === "en" ? capabilityEnglish[item.id]?.description ?? item.description : item.description}</small></span><span className="capability-directory-arrow">↗</span></button>)}</div> : isAssets && artifactRows.length ? <div className="conversation-list">{artifactRows.map((item) => <div key={item.id} className="conversation-row artifact-row"><button type="button" className="artifact-open-button" disabled={item.available === false} onClick={() => onArtifactReveal(item.relative_path, item.mime_type)}><span>{item.relative_path}</span><small>{item.available === false ? (locale === "en" ? "Unavailable" : "文件不可用") : item.mime_type}</small></button>{item.available === false ? <button type="button" className="link-button" onClick={() => onArtifactRemove(item.id)}>{locale === "en" ? "Remove record" : "移除记录"}</button> : null}</div>)}</div> : isAssets ? <div className="empty-state"><div className="empty-icon">▱</div><strong>{ui.noArtifacts}</strong><p>{locale === "en" ? "Artifacts appear here after writing, PPT, or media runs." : "运行写作、PPT 或媒体任务后，文件会显示在这里。"}</p></div> : isKnowledge ? <div className="knowledge-local-card"><strong>{locale === "en" ? "Local Obsidian knowledge base" : "Obsidian 本地知识库"}</strong><p>{locale === "en" ? "Scan Markdown after selecting a Vault; the index and source stay local. Chat never sends Vault content unless enabled." : "选择 Vault 后扫描 Markdown，索引与原文均保存在本机。普通对话不会自动发送 Vault 内容。"}</p><div className="knowledge-search-row"><input value={knowledgeQuery} onChange={(event) => onKnowledgeQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && knowledgeQuery.trim()) onKnowledgeSearch(); }} placeholder={locale === "en" ? "Search notes, tags, or headings in the Vault" : "搜索 Vault 中的笔记、标签或标题"} /><button className="primary" disabled={!knowledgeQuery.trim()} onClick={onKnowledgeSearch}>{locale === "en" ? "Search" : "检索"}</button></div>{knowledgeStatus ? <div className="muted knowledge-status">{knowledgeStatus}</div> : null}{knowledgeResults.length ? <div className="knowledge-result-list">{knowledgeResults.map((result) => <button type="button" key={result.chunkId} className="knowledge-result" onClick={() => void onKnowledgeOpen(result.documentPath)}><div className="knowledge-result-heading"><strong>{result.heading || result.documentPath}</strong><small>{result.lineStart ? (locale === "en" ? `Lines ${result.lineStart}-${result.lineEnd ?? result.lineStart}` : `第 ${result.lineStart}-${result.lineEnd ?? result.lineStart} 行`) : (locale === "en" ? "Local citation" : "本地引用")}</small></div><p>{result.excerpt}</p></button>)}</div> : null}<button className="ghost" onClick={() => onNavigate("/dashboard/settings")}>{ui.configureVault}</button></div> : isSettings ? <div className="knowledge-local-card"><strong>{ui.modelRuntime}</strong><p>{ui.settingsHint}</p></div> : conversations.length ? <div className="conversation-list">{conversations.map((item) => <button key={item.id} type="button" className="conversation-row" onClick={() => onNavigate(`/dashboard/ai/${item.id}`)}><span>{item.title}</span><small>{formatDateTime(item.updated_at, locale)}</small></button>)}</div> : <div className="empty-state"><div className="empty-icon">⌁</div><strong>{ui.noRecords}</strong><p>{locale === "en" ? "Run a task to save its status and conversation locally." : "运行任务后，状态和会话会自动保存。"}</p></div>}</section><aside className="library-stats-panel"><div className="section-title"><span>{ui.localStats}</span><span className="muted">{ui.countOnly}</span></div><div className="stats-grid"><div><strong>{taskCount}</strong><span>{ui.tasksLabel}</span></div><div><strong>{tokenCount}</strong><span>Token</span></div><div><strong>{artifactCount}</strong><span>{ui.artifactLabel}</span></div><div><strong>{providerCost === undefined ? (locale === "en" ? "Unknown" : "未知") : `$${providerCost.toFixed(4)}`}</strong><span>{ui.providerCost}</span></div><div><strong>{estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : (locale === "en" ? "Unknown" : "未知")}</strong><span>{ui.estimated}</span></div></div><div className="library-secondary-list"><strong>{locale === "en" ? "Saved workflows" : "已保存工作流"}</strong>{savedWorkflows.slice(0, 5).map((item) => <div key={item.id}>{item.name}</div>)}</div></aside></div></div>;
}

type ProviderEditorDraft = { id: string; platformId: string; modelId: string; modelIds: string[]; baseUrl: string; apiKey: string; endpoint: string; queryEndpoint: string; workflows: RunningHubWorkflowRegistration[]; workflowEditingId: string; workflowName: string; workflowRemoteId: string; workflowSource: string; workflowJson: string; workflowCapability: RunningHubWorkflowCapability };
type ProviderEditorTarget = { previousId?: string; capability: ProviderCapability };

function SettingsSecretInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="password" value={value} autoComplete="off" onChange={(event) => onChange(event.target.value)} />;
}

function providerDraft(profile: DesktopProviderConfig | undefined, capability: ProviderCapability): ProviderEditorDraft {
  const registeredWorkflowModels = profile?.source?.trim().toLowerCase() === "runninghub"
    ? profile.workflows?.map((workflow) => workflow.remoteWorkflowId).filter(Boolean) ?? []
    : [];
  const existingModels = [...new Set(registeredWorkflowModels.length ? registeredWorkflowModels : (profile?.models ?? (profile?.model ? [profile.model] : [])))];
  const platformId = platformIdForProvider(profile, capability);
  const platform = providerPlatformForId(capability, platformId) ?? PROVIDER_PLATFORM_OPTIONS[capability][0];
  const modelIds = existingModels;
  return { id: profile?.id ?? (platform ? `${capability}-${platform.id}` : ""), platformId: platform?.id ?? "", modelId: modelIds[0] ?? "", modelIds, baseUrl: profile?.baseUrl ?? platform?.baseUrl ?? "", apiKey: profile?.apiKey ?? "", endpoint: profile?.endpoint ?? "", queryEndpoint: profile?.queryEndpoint ?? "", workflows: [...(profile?.workflows ?? [])], workflowEditingId: "", workflowName: "", workflowRemoteId: "", workflowSource: "", workflowJson: "", workflowCapability: capability === "image" ? "image" : capability === "audio" ? "audio" : capability === "video" ? "video" : "digital_human" };
}

function DesktopProviderEditorModal({ target, profile, locale, onClose, onSave, onRemove, onDiscoverModels }: { target: ProviderEditorTarget; profile?: DesktopProviderConfig; locale: "zh" | "en"; onClose: () => void; onSave: (previousId: string | undefined, draft: ProviderEditorDraft, capability: ProviderCapability) => string | undefined; onRemove: (id: string) => void; onDiscoverModels: (provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey">, capability: ProviderCapability) => Promise<readonly string[]> }) {
  const [draft, setDraft] = useState(() => providerDraft(profile, target.capability));
  const [discoveredModelIds, setDiscoveredModelIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [modelDiscoveryStatus, setModelDiscoveryStatus] = useState("");
  const [modelDiscoveryBusy, setModelDiscoveryBusy] = useState(false);
  const discoveryRequestRef = useRef(0);
  const discoveryFingerprintRef = useRef("");
  const discoveryTimerRef = useRef<number | null>(null);
  const isEditing = Boolean(target.previousId);
  const label = (capability: ProviderCapability) => locale === "zh" ? ({ text: "文字", image: "图片", video: "视频", audio: "音频" }[capability]) : ({ text: "Text", image: "Image", video: "Video", audio: "Audio" }[capability]);
  const update = (patch: Partial<ProviderEditorDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const platform = providerPlatformForId(target.capability, draft.platformId);
  const isRunningHub = platform?.source === "runninghub";
  const runningHubWorkflowModels = [...new Set(draft.workflows.map((workflow) => workflow.remoteWorkflowId.trim()).filter(Boolean))];
  const legacyModels = profile?.models ?? (profile?.model ? [profile.model] : []);
  const modelChoices = isRunningHub ? runningHubWorkflowModels : [...new Set([...discoveredModelIds, ...draft.modelIds, ...legacyModels])];
  const useModelSelect = modelChoices.length > 0;
  const discoverModels = (automatic = false) => {
    const baseUrl = draft.baseUrl.trim();
    const apiKey = draft.apiKey.trim();
    if (!baseUrl || !apiKey || !platform || platform.source === "runninghub") return;
    const requestId = ++discoveryRequestRef.current;
    const fingerprint = `${target.capability}:${draft.platformId}:${baseUrl}:${apiKey}`;
    discoveryFingerprintRef.current = fingerprint;
    if (discoveryTimerRef.current !== null) {
      window.clearTimeout(discoveryTimerRef.current);
      discoveryTimerRef.current = null;
    }
    setModelDiscoveryBusy(true);
    setModelDiscoveryStatus(locale === "zh" ? (automatic ? "正在自动读取 Provider 模型列表…" : "正在读取 Provider 模型列表…") : (automatic ? "Automatically loading models from Provider…" : "Loading models from Provider…"));
    if (!automatic) setError("");
    void onDiscoverModels({ id: draft.id, source: platform.source, baseUrl, apiKey }, target.capability).then((models) => {
      if (requestId !== discoveryRequestRef.current) return;
      const modelIds = [...models];
      setDiscoveredModelIds(modelIds);
      setModelDiscoveryStatus(locale === "zh" ? `已获取 ${modelIds.length} 个账号模型，请选择后保存` : `${modelIds.length} account models found; select models before saving`);
    }).catch((discoveryError) => {
      if (requestId !== discoveryRequestRef.current) return;
      const message = discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
      const canEnterManually = target.capability === "text" || platform?.source === "runninghub";
      setModelDiscoveryStatus(locale === "zh" ? (canEnterManually ? `自动获取失败，可手动填写（${message}）` : `自动获取失败；媒体模型必须从 Provider 列表选择（${message}）`) : (canEnterManually ? `Automatic discovery failed; enter a model manually (${message})` : `Automatic discovery failed; choose a media model returned by the Provider (${message})`));
      if (!automatic) setError(message);
    }).finally(() => {
      if (requestId === discoveryRequestRef.current) setModelDiscoveryBusy(false);
    });
  };
  useEffect(() => {
    const baseUrl = draft.baseUrl.trim();
    const apiKey = draft.apiKey.trim();
    if (!baseUrl || !apiKey || !platform || platform.source === "runninghub") return;
    const fingerprint = `${target.capability}:${draft.platformId}:${baseUrl}:${apiKey}`;
    if (discoveryFingerprintRef.current === fingerprint) return;
    discoveryTimerRef.current = window.setTimeout(() => {
      discoveryTimerRef.current = null;
      discoverModels(true);
    }, 700);
    return () => {
      if (discoveryTimerRef.current !== null) {
        window.clearTimeout(discoveryTimerRef.current);
        discoveryTimerRef.current = null;
      }
      discoveryRequestRef.current += 1;
    };
  }, [draft.platformId, draft.baseUrl, draft.apiKey, target.capability, platform?.source]);
  const save = () => {
    let nextDraft = draft;
    if (draft.workflowEditingId && !draft.workflowJson.trim()) {
      const existing = draft.workflows.find((workflow) => workflow.id === draft.workflowEditingId);
      const remoteWorkflowId = runningHubWorkflowIdFromUrl(draft.workflowRemoteId);
      if (!existing || !remoteWorkflowId) { setError(locale === "zh" ? "编辑工作流时需要有效的 workflow ID" : "A valid workflow ID is required when editing"); return; }
      const updated = { ...existing, remoteWorkflowId, name: draft.workflowName.trim() || existing.name, capability: draft.workflowCapability, source: { ...existing.source, ...(draft.workflowSource.trim() ? { url: draft.workflowSource.trim() } : {}) }, definitionHash: existing.definitionHash };
      nextDraft = { ...draft, workflows: [...draft.workflows.filter((item) => item.id !== existing.id), updated], workflowEditingId: "", workflowName: "", workflowRemoteId: "", workflowSource: "" };
    } else if (draft.workflowJson.trim() || draft.workflowRemoteId.trim() || draft.workflowSource.trim()) {
      try {
        const remoteWorkflowId = runningHubWorkflowIdFromUrl(draft.workflowRemoteId || draft.workflowSource);
        if (!remoteWorkflowId) throw new Error(locale === "zh" ? "请填写有效的 RunningHub workflow ID 或链接" : "Enter a valid RunningHub workflow ID or URL");
        const parsed = draft.workflowJson.trim()
          ? parseRunningHubWorkflowJson(JSON.parse(draft.workflowJson), { remoteWorkflowId, sourceKind: "comfyui-api-json" })
          : { remoteWorkflowId, sourceKind: "manual" as const, inputSchema: [], nodeBindings: [], outputSchema: [], definitionHash: `manual:${remoteWorkflowId}`, warnings: ["manual_workflow_mapping_required"] };
        const registration = createRunningHubWorkflowRegistration({ ...parsed, id: `${draft.id.trim() || target.capability}-${remoteWorkflowId}`, remoteWorkflowId, name: draft.workflowName.trim() || `${target.capability} workflow`, capability: draft.workflowCapability, source: { kind: parsed.sourceKind, ...(draft.workflowSource.trim() ? { url: draft.workflowSource.trim() } : {}) } });
        nextDraft = { ...draft, workflows: [...draft.workflows.filter((item) => item.id !== registration.id && item.id !== draft.workflowEditingId), registration], workflowEditingId: "", workflowJson: "", workflowName: "", workflowRemoteId: "", workflowSource: "" };
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); return; }
    }
    const nextError = onSave(target.previousId, nextDraft, target.capability);
    if (nextError) { setError(nextError); return; }
    onClose();
  };
  return <div className="settings-provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-editor-title">
    <header><div><strong id="provider-editor-title">{isEditing ? (locale === "zh" ? "编辑 Provider" : "Edit provider") : (locale === "zh" ? "新增 Provider" : "Add provider")}</strong><span>{locale === "zh" ? `配置类型：${label(target.capability)}模型` : `Configuration type: ${label(target.capability)}`}</span></div><button type="button" className="link-button" onClick={onClose}>{locale === "zh" ? "关闭" : "Close"}</button></header>
    <div className="settings-provider-modal-grid">
      <label>{locale === "zh" ? "Provider 标识" : "Provider ID"}<input autoFocus value={draft.id} onChange={(event) => update({ id: event.target.value })} placeholder="image-bailian" /></label>
      <label>{locale === "zh" ? "接入平台" : "Provider platform"}<select value={draft.platformId} onChange={(event) => { const nextPlatform = providerPlatformForId(target.capability, event.target.value); if (!nextPlatform) return; setDiscoveredModelIds([]); update({ platformId: nextPlatform.id, id: isEditing ? draft.id : `${target.capability}-${nextPlatform.id}`, baseUrl: nextPlatform.baseUrl, modelIds: [], modelId: "" }); }}>{PROVIDER_PLATFORM_OPTIONS[target.capability].map((option) => <option key={option.id} value={option.id}>{locale === "zh" ? option.label.zh : option.label.en}</option>)}</select></label>
      <label>{isRunningHub ? (locale === "zh" ? "工作流（即模型列表）" : "Workflows (model list)") : (locale === "zh" ? "模型 ID（可多选）" : "Model IDs (multi-select)")}
        {isRunningHub ? <div className="settings-provider-model-menu" role="list" aria-label={locale === "zh" ? "已注册工作流" : "Registered workflows"}>{draft.workflows.length ? draft.workflows.map((workflow) => <div key={workflow.id} role="listitem"><code>{workflow.name} · {workflow.remoteWorkflowId}</code></div>) : <small>{locale === "zh" ? "请在下方注册账户工作流；保存后会自动作为该 Provider 的模型列表。" : "Register an account workflow below; it becomes this Provider's model list when saved."}</small>}</div> : useModelSelect ? <details className="settings-provider-model-dropdown"><summary><span>{draft.modelIds.length ? (draft.modelIds.length === 1 ? draft.modelIds[0] : (locale === "zh" ? `已选择 ${draft.modelIds.length} 个模型` : `${draft.modelIds.length} models selected`)) : (locale === "zh" ? "选择模型" : "Select models")}</span><span aria-hidden="true">⌄</span></summary><div className="settings-provider-model-menu" role="group" aria-label={locale === "zh" ? "选择模型 ID" : "Select model IDs"}>{modelChoices.map((model) => <label key={model}><input type="checkbox" checked={draft.modelIds.includes(model)} onChange={(event) => { const modelIds = event.target.checked ? [...draft.modelIds, model] : draft.modelIds.filter((item) => item !== model); update({ modelIds, modelId: modelIds.includes(draft.modelId) ? draft.modelId : (modelIds[0] ?? "") }); }} /><code>{model}</code></label>)}</div></details> : <input className="settings-provider-model-picker" value={draft.modelId} onChange={(event) => update({ modelId: event.target.value, modelIds: event.target.value.trim() ? [event.target.value.trim()] : [] })} placeholder={locale === "zh" ? "填写 API Key 后从 Provider 获取模型" : "Fetch account models after entering the API key"} />}
        {!isRunningHub ? <div className="settings-provider-model-actions"><button type="button" className="ghost" disabled={modelDiscoveryBusy || !draft.baseUrl.trim() || !draft.apiKey.trim()} onClick={() => discoverModels(false)}>{modelDiscoveryBusy ? (locale === "zh" ? "读取中…" : "Loading…") : (locale === "zh" ? "从 Provider 获取模型" : "Fetch models from Provider")}</button>{modelDiscoveryStatus ? <small role="status">{modelDiscoveryStatus}</small> : null}</div> : null}
        <small>{isRunningHub ? (locale === "zh" ? "RunningHub 的可执行对象是账号工作流；不需要额外填写模型 ID。" : "RunningHub executes account workflows; no separate model ID is needed.") : useModelSelect ? (locale === "zh" ? "在下拉菜单中勾选多个模型；仅保存已选择的模型。" : "Select multiple models in the dropdown; only selected models are saved.") : (locale === "zh" ? "不再提供内置模型列表；请使用当前 API Key 获取账号可用模型。" : "No built-in model list is provided. Fetch models available to this API key.")}</small>
      </label>
      <label>{locale === "zh" ? "Base URL" : "Base URL"}<input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://…" /></label>
      <label>{locale === "zh" ? "API Key" : "API key"}<SettingsSecretInput value={draft.apiKey} onChange={(apiKey) => update({ apiKey })} /></label>
      <label>{locale === "zh" ? "提交 Endpoint" : "Submit endpoint"}<input value={draft.endpoint} onChange={(event) => update({ endpoint: event.target.value })} placeholder="/videos/generations" /></label>
      <label>{locale === "zh" ? "查询 Endpoint" : "Query endpoint"}<input value={draft.queryEndpoint} onChange={(event) => update({ queryEndpoint: event.target.value })} placeholder="/api/v1/tasks" /></label>
      {platform?.source === "runninghub" ? <div className="settings-provider-workflow-registry"><strong>{locale === "zh" ? "账号工作流注册" : "Account workflow registry"}</strong><small>{locale === "zh" ? "导入 ComfyUI API JSON 后，运行时会按映射生成 nodeInfoList；工作流 ID 必须属于当前 API Key。" : "Import ComfyUI API JSON to generate nodeInfoList. The workflow ID must be accessible with the current API key."}</small>{draft.workflows.length ? <div className="settings-provider-workflow-list">{draft.workflows.map((workflow) => <div key={workflow.id}><span><b>{workflow.name}</b><small>{workflow.capability} · {workflow.remoteWorkflowId} · v{workflow.version}</small></span><span><button type="button" className="link-button" onClick={() => update({ workflowEditingId: workflow.id, workflowName: workflow.name, workflowRemoteId: workflow.remoteWorkflowId, workflowSource: workflow.source.url ?? "", workflowCapability: workflow.capability })}>{locale === "zh" ? "编辑" : "Edit"}</button><button type="button" className="link-button danger" onClick={() => update({ workflows: draft.workflows.filter((item) => item.id !== workflow.id), workflowEditingId: draft.workflowEditingId === workflow.id ? "" : draft.workflowEditingId })}>{locale === "zh" ? "删除" : "Remove"}</button></span></div>)}</div> : null}<div className="settings-provider-workflow-form"><label>{locale === "zh" ? "工作流名称" : "Workflow name"}<input value={draft.workflowName} onChange={(event) => update({ workflowName: event.target.value })} /></label><label>{locale === "zh" ? "Workflow ID / 链接" : "Workflow ID / URL"}<input value={draft.workflowRemoteId} onChange={(event) => update({ workflowRemoteId: event.target.value })} placeholder="https://www.runninghub.ai/lite/workflow/…" /></label><label>{locale === "zh" ? "ComfyUI API JSON（新增或重映射时填写）" : "ComfyUI API JSON (for new or remapped workflows)"}<textarea value={draft.workflowJson} onChange={(event) => update({ workflowJson: event.target.value })} placeholder='{"3":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}' spellCheck={false} /></label><label>{locale === "zh" ? "能力类型" : "Capability"}<select value={draft.workflowCapability} onChange={(event) => update({ workflowCapability: event.target.value as RunningHubWorkflowCapability })}><option value="image">{locale === "zh" ? "图片" : "Image"}</option><option value="video">{locale === "zh" ? "视频" : "Video"}</option><option value="digital_human">{locale === "zh" ? "数字人" : "Digital human"}</option><option value="video_enhance">{locale === "zh" ? "视频高清化" : "Video enhance"}</option><option value="audio">{locale === "zh" ? "音频" : "Audio"}</option></select></label></div></div> : null}
    </div>
    {error ? <p className="settings-provider-modal-error" role="alert">{error}</p> : null}
    <footer>{isEditing ? <button type="button" className="link-button danger" onClick={() => { if (target.previousId) { onRemove(target.previousId); onClose(); } }}>{locale === "zh" ? "删除 Provider" : "Delete provider"}</button> : <span />}{<div><button type="button" className="ghost" onClick={onClose}>{locale === "zh" ? "取消" : "Cancel"}</button><button type="button" className="primary" onClick={save}>{locale === "zh" ? "保存 Provider" : "Save provider"}</button></div>}</footer>
  </section></div>;
}

function DesktopConfiguredProviderProfiles({ config, locale, onConfigChange, onDiscoverModels }: { config: DesktopConfig; locale: "zh" | "en"; onConfigChange: (next: DesktopConfig) => void; onDiscoverModels: (provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey">, capability: ProviderCapability) => Promise<readonly string[]> }) {
  const entries = configuredProviderEntries(config);
  const [editorTarget, setEditorTarget] = useState<ProviderEditorTarget | null>(null);
  const ui = locale === "zh"
    ? { title: "已配置模型", configured: "个 Provider", empty: "尚未配置该类型模型", add: "新增 Provider", edit: "编辑", fallback: "使用兼容回退", default: "默认 Provider" }
    : { title: "Configured models", configured: "providers", empty: "No configured models", add: "Add provider", edit: "Edit", fallback: "Use compatibility fallback", default: "Default provider" };
  const capabilities = (["text", "image", "audio", "video"] as const).map((capability) => ({ capability, label: locale === "zh" ? ({ text: "文本模型", image: "图片模型", audio: "音频模型", video: "视频模型" }[capability]) : ({ text: "Text models", image: "Image models", audio: "Audio models", video: "Video models" }[capability]), profiles: entries.filter(([, profile]) => supportsProviderCapability(profile, capability)) }));
  const updateDefault = (capability: ProviderCapability, profileId: string) => {
    const defaults = { ...(config.defaults ?? {}) };
    if (profileId) defaults[capability] = profileId;
    else delete defaults[capability];
    onConfigChange({ ...config, defaults });
  };
  const removeProfile = (id: string) => {
    const providers = Object.fromEntries(Object.entries(config.providers ?? {}).filter(([profileId]) => profileId !== id));
    const defaults = Object.fromEntries(Object.entries(config.defaults ?? {}).filter(([, profileId]) => profileId !== id)) as DesktopProviderDefaults;
    onConfigChange({ ...config, providers, defaults });
  };
  const saveProfile = (previousId: string | undefined, draft: ProviderEditorDraft, capability: ProviderCapability) => {
    const id = draft.id.trim();
    if (!id) return locale === "zh" ? "请填写 Provider 标识" : "Provider ID is required";
    if (id !== previousId && config.providers?.[id]) return locale === "zh" ? "Provider 标识已存在" : "Provider ID already exists";
    const platform = providerPlatformForId(capability, draft.platformId);
    if (!platform) return locale === "zh" ? "请选择接入平台" : "Select a provider platform";
    const runningHub = platform.source === "runninghub";
    const registeredWorkflowModels = [...new Set(draft.workflows.map((workflow) => workflow.remoteWorkflowId.trim()).filter(Boolean))];
    const models = runningHub
      ? registeredWorkflowModels
      : [...new Set([...draft.modelIds, draft.modelId.trim()].map((value) => value.trim()).filter(Boolean))];
    const model = runningHub
      ? (models.includes(draft.modelId.trim()) ? draft.modelId.trim() : (models[0] ?? ""))
      : draft.modelId.trim();
    if (!model) return runningHub
      ? (locale === "zh" ? "请先注册至少一个当前账号可访问的 RunningHub 工作流" : "Register at least one RunningHub workflow accessible to this account first")
      : (locale === "zh" ? "请填写模型 ID" : "Model ID is required");
    if (capability !== "text" && !runningHub && !draft.modelIds.includes(model)) return locale === "zh" ? "媒体模型必须从当前 Provider 的账号模型列表选择" : "Choose a media model from the current Provider account list";
    if (platform.source === "runninghub" && draft.workflows.some((workflow) => isDevelopmentRunningHubWorkflowId(workflow.remoteWorkflowId))) {
      return locale === "zh" ? "该 workflow ID 属于开发者示例账号，请填写当前 API Key 所属账号下的工作流 ID" : "This workflow ID belongs to the developer sample account. Enter a workflow ID owned by the account for this API key.";
    }
    const providers = { ...(config.providers ?? {}) } as Record<string, DesktopProviderConfig>;
    if (previousId && previousId !== id) delete providers[previousId];
    providers[id] = {
      id,
      source: platform.source,
      baseUrl: draft.baseUrl.trim() || platform.baseUrl,
      apiKey: draft.apiKey,
      endpoint: draft.endpoint.trim() || undefined,
      queryEndpoint: draft.queryEndpoint.trim() || undefined,
      models,
      model,
      capabilities: previousId ? config.providers?.[previousId]?.capabilities ?? [capability] : [capability],
      ...(runningHub && draft.workflows.length ? { workflows: draft.workflows } : {}),
    };
    const defaults = { ...(config.defaults ?? {}) };
    if (previousId && previousId !== id) for (const [capability, profileId] of Object.entries(defaults)) if (profileId === previousId) defaults[capability as ProviderCapability] = id;
    if (!defaults[capability]) defaults[capability] = id;
    onConfigChange({ ...config, providers, defaults });
    return undefined;
  };
  const editingProfile = editorTarget?.previousId ? config.providers?.[editorTarget.previousId] : undefined;
  return <section className="settings-configured-providers">
    <div className="settings-configured-providers-heading"><div><strong>{ui.title}</strong><span>{entries.length} {ui.configured}</span></div></div>
    <div className="settings-provider-capability-sections">{capabilities.map(({ capability, label, profiles }) => <section key={capability} className="settings-provider-capability-section">
      <header><div><strong>{label}</strong><span>{profiles.length} {locale === "zh" ? "个已配置 Provider" : "configured providers"}</span></div><div className="settings-provider-capability-actions"><label><span>{ui.default}</span><select value={config.defaults?.[capability] ?? ""} onChange={(event) => updateDefault(capability, event.target.value)}><option value="">{ui.fallback}</option>{profiles.map(([id, profile]) => <option key={id} value={id}>{id}{profile.model ? ` · ${profile.model}` : ""}</option>)}</select></label><button type="button" className="primary" onClick={() => setEditorTarget({ capability })}>＋ {ui.add}</button></div></header>
      <div className="settings-provider-model-list" role="list" aria-label={label}>{profiles.length ? profiles.map(([id, profile]) => <article key={id} className="settings-provider-model-row" role="listitem"><div><strong>{id}</strong><span>{profile.source ?? "local"}</span><div className="settings-provider-model-chips">{(profile.models ?? (profile.model ? [profile.model] : [])).map((model) => <code key={model}>{model}</code>) || <small>{locale === "zh" ? "未设置模型 ID" : "No model ID"}</small>}</div></div><button type="button" className="ghost" onClick={() => setEditorTarget({ previousId: id, capability })}>{ui.edit}</button></article>) : <p className="settings-provider-empty">{ui.empty}</p>}</div>
    </section>)}</div>
    {editorTarget ? <DesktopProviderEditorModal key={`${editorTarget.previousId ?? "new"}:${editorTarget.capability}`} target={editorTarget} profile={editingProfile} locale={locale} onClose={() => setEditorTarget(null)} onSave={saveProfile} onRemove={removeProfile} onDiscoverModels={onDiscoverModels} /> : null}
  </section>;
}

function DesktopSettingsPanel({
  config,
  locale,
  localePreference,
  copy,
  onConfigChange,
  onDiscoverModels,
  onLocalePreferenceChange,
  onClose,
  onSave,
  onRebuildVault,
  onPickDirectory,
  onRepairRuntime,
  onExportDiagnostics,
  status: rawStatus,
}: {
  config: DesktopConfig;
  locale: "zh" | "en";
  localePreference: DesktopLocalePreference;
  copy: typeof desktopCopy.zh | typeof desktopCopy.en;
  onConfigChange: (next: DesktopConfig) => void;
  onDiscoverModels: (provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey">, capability: ProviderCapability) => Promise<readonly string[]>;
  onLocalePreferenceChange: (next: DesktopLocalePreference) => void;
  onClose: () => void;
  onSave: () => void;
  onRebuildVault: () => void;
  onPickDirectory: (kind: "workspace" | "vault") => void;
  onRepairRuntime: () => void;
  onExportDiagnostics: () => void;
  status: string;
}) {
  const status = isDesktopErrorStatus(rawStatus) ? "" : rawStatus;
  const ui = locale === "zh" ? {
    title: "本地模型与项目配置", close: "关闭", workspace: "工作目录", workspacePlaceholder: "项目文件夹绝对路径", vault: "Obsidian Vault", vaultPlaceholder: "可选 Vault 绝对路径", removeVault: "解除绑定", index: "Vault 索引目录", indexPlaceholder: "manifest.json 所在目录", embeddingMode: "Embedding 位置", localEmbedding: "仅本地（默认）", remoteEmbedding: "远程（发送片段）", embeddingBaseUrl: "远程 Embedding URL", embeddingModel: "远程 Embedding 模型", embeddingApiKey: "远程 Embedding API Key", localEmbeddingHint: "默认仅在本机生成 embedding，不会发送 Vault 内容。", remoteEmbeddingHint: "仅在明确选择远程后，待索引 Markdown 片段才会发送到此 HTTPS 端点。", provider: "Provider", profiles: "Provider profiles（JSON）", profilesHint: "按能力选择不同 Provider；保留 provider 字段作为兼容回退。", textDefault: "生文默认 Provider", imageDefault: "生图默认 Provider", videoDefault: "生视频/数字人默认 Provider", audioDefault: "音频/声音默认 Provider", model: "Model", modelPlaceholder: "默认模型", reasoning: "推理强度", low: "低", medium: "中", high: "高", baseUrl: "Base URL", baseUrlPlaceholder: "可选 OpenAI-compatible URL", endpoint: "媒体提交 Endpoint", endpointPlaceholder: "可选，例如 /videos/generations", queryEndpoint: "媒体查询 Endpoint", queryEndpointPlaceholder: "可选，例如 /api/v1/tasks", apiKey: "API Key", offline: "离线运行时 ZIP", offlinePlaceholder: "可选：本地运行时 ZIP 绝对路径", warning: "API Key 按已确认方案以明文保存在本地 config.json；不会写入 SQLite、日志或诊断包。内置 Obsidian 写入会做路径与 base hash 冲突保护，但 Full Access OpenCode 文件工具仍可直接改动文件，工具事件会实时展示。", save: "立即保存", rebuild: "扫描/重建 Obsidian 索引", import: "导入离线运行时", diagnostics: "导出诊断包", imported: "已导入离线运行时并完成复检", failed: "离线运行时导入失败"
  } : {
    title: "Local model & workspace settings", close: "Close", workspace: "Workspace directory", workspacePlaceholder: "Absolute project folder path", vault: "Obsidian Vault", vaultPlaceholder: "Optional Vault absolute path", removeVault: "Detach Vault", index: "Vault index directory", indexPlaceholder: "Directory containing manifest.json", embeddingMode: "Embedding location", localEmbedding: "Local only (default)", remoteEmbedding: "Remote (send chunks)", embeddingBaseUrl: "Remote embedding URL", embeddingModel: "Remote embedding model", embeddingApiKey: "Remote embedding API key", localEmbeddingHint: "Embedding stays on this device by default; no Vault content is sent.", remoteEmbeddingHint: "Only after selecting remote are Markdown chunks sent to this HTTPS endpoint for indexing.", provider: "Provider", profiles: "Provider profiles (JSON)", profilesHint: "Route text, image, video, and audio capabilities to different providers; provider remains the compatibility fallback.", textDefault: "Text default Provider", imageDefault: "Image default Provider", videoDefault: "Video/digital human default Provider", audioDefault: "Audio/voice default Provider", model: "Model", modelPlaceholder: "Default model", reasoning: "Reasoning effort", low: "Low", medium: "Medium", high: "High", baseUrl: "Base URL", baseUrlPlaceholder: "Optional OpenAI-compatible URL", endpoint: "Media submit endpoint", endpointPlaceholder: "Optional, e.g. /videos/generations", queryEndpoint: "Media query endpoint", queryEndpointPlaceholder: "Optional, e.g. /api/v1/tasks", apiKey: "API Key", offline: "Offline runtime ZIP", offlinePlaceholder: "Optional local runtime ZIP absolute path", warning: "Per the approved plan, the API key is stored as readable text in local config.json; it is not written to SQLite, logs, or diagnostics. Built-in Obsidian writes use path and base-hash conflict protection, while Full Access OpenCode file tools can still modify files directly and their tool events remain visible.", save: "Save now", rebuild: "Scan/rebuild Obsidian index", import: "Import offline runtime", diagnostics: "Export diagnostics", imported: "Offline runtime imported and rechecked", failed: "Offline runtime import failed"
  };
  const [profilesText, setProfilesText] = useState(() => JSON.stringify(config.providers ?? {}, null, 2));
  const [settingsSection, setSettingsSection] = useState<"workspace" | "providers" | "runtime">("workspace");
  useEffect(() => { setProfilesText(JSON.stringify(config.providers ?? {}, null, 2)); }, [config.providers]);
  const updateProvider = (patch: Partial<DesktopConfig["provider"]>) => onConfigChange({ ...config, provider: { ...config.provider, ...patch } });
  const updateEmbedding = (patch: Partial<EmbeddingConfig>) => onConfigChange({ ...config, embedding: { mode: config.embedding?.mode ?? "local", ...config.embedding, ...patch } });
  const updateProfiles = (value: string) => {
    setProfilesText(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) onConfigChange({ ...config, providers: parsed as DesktopProviderProfiles });
    } catch { /* keep editing until the JSON is complete */ }
  };
  const profileIds = Object.keys(config.providers ?? {});
  const profileIdsFor = (capability: keyof DesktopProviderDefaults) => {
    const compatible = profileIds.filter((id) => supportsProviderCapability(config.providers?.[id] ?? {}, capability));
    const selected = config.defaults?.[capability];
    return selected && !compatible.includes(selected) ? [selected, ...compatible] : compatible;
  };
  const updateDefault = (capability: keyof DesktopProviderDefaults, value: string) => {
    const defaults = { ...(config.defaults ?? {}) };
    if (value) defaults[capability] = value;
    else delete defaults[capability];
    onConfigChange({ ...config, defaults });
  };
  const jumpToSection = (section: "workspace" | "providers" | "runtime") => { setSettingsSection(section); document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return <section className="settings-panel"><div className="section-title"><div><div className="eyebrow">{locale === "zh" ? "工作区偏好" : "WORKSPACE PREFERENCES"}</div><span>{ui.title}</span></div><button type="button" className="link-button" onClick={onClose}>{ui.close}</button></div><nav className="settings-tabs" aria-label={locale === "zh" ? "设置分区" : "Settings sections"}>{(["workspace", "providers", "runtime"] as const).map((section) => <button key={section} type="button" className={settingsSection === section ? "is-active" : ""} onClick={() => jumpToSection(section)}>{section === "workspace" ? (locale === "zh" ? "工作区" : "Workspace") : section === "providers" ? (locale === "zh" ? "Provider 与模型" : "Providers & models") : (locale === "zh" ? "运行环境" : "Runtime")}</button>)}</nav><div className="settings-grid">
    <div id="settings-workspace" className="settings-section-heading"><strong>{locale === "zh" ? "工作区与知识" : "Workspace & knowledge"}</strong><span>{locale === "zh" ? "语言、项目目录与 Obsidian 数据保持本地" : "Language, project paths, and Obsidian data stay local"}</span></div>
    <label>{copy.language}<select value={localePreference} onChange={(event) => onLocalePreferenceChange(event.target.value as DesktopLocalePreference)}><option value="auto">{copy.languageAuto}</option><option value="zh">{copy.languageZh}</option><option value="en">{copy.languageEn}</option></select></label>
    <label>{ui.workspace}<div className="settings-path-control"><input value={config.workspacePath} onChange={(event) => onConfigChange({ ...config, workspacePath: event.target.value })} placeholder={ui.workspacePlaceholder} /><button type="button" className="ghost" onClick={() => onPickDirectory("workspace")}>{locale === "zh" ? "选择" : "Browse"}</button></div></label>
    <label>{ui.vault}<div className="settings-path-control"><input value={config.obsidianVaultPath ?? ""} onChange={(event) => onConfigChange({ ...config, obsidianVaultPath: event.target.value || undefined })} placeholder={ui.vaultPlaceholder} /><button type="button" className="ghost" onClick={() => onPickDirectory("vault")}>{locale === "zh" ? "选择" : "Browse"}</button><button type="button" className="ghost" disabled={!config.obsidianVaultPath} onClick={() => onConfigChange({ ...config, obsidianVaultPath: undefined, obsidianIndexPath: undefined })}>{ui.removeVault}</button></div></label>
    <label>{ui.index}<input value={config.obsidianIndexPath ?? ""} onChange={(event) => onConfigChange({ ...config, obsidianIndexPath: event.target.value || undefined })} placeholder={ui.indexPlaceholder} /></label>
    <label>{ui.embeddingMode}<select value={config.embedding?.mode ?? "local"} onChange={(event) => updateEmbedding({ mode: event.target.value as EmbeddingConfig["mode"] })}><option value="local">{ui.localEmbedding}</option><option value="remote">{ui.remoteEmbedding}</option></select></label>
    {config.embedding?.mode === "remote" ? <><label>{ui.embeddingBaseUrl}<input value={config.embedding.baseUrl ?? ""} onChange={(event) => updateEmbedding({ baseUrl: event.target.value })} placeholder="https://…/v1" /></label><label>{ui.embeddingModel}<input value={config.embedding.model ?? ""} onChange={(event) => updateEmbedding({ model: event.target.value })} /></label><label>{ui.embeddingApiKey}<SettingsSecretInput value={config.embedding.apiKey ?? ""} onChange={(apiKey) => updateEmbedding({ apiKey })} /></label><p className="settings-inline-hint">{ui.remoteEmbeddingHint}</p></> : <p className="settings-inline-hint">{ui.localEmbeddingHint}</p>}
    <div id="settings-providers" className="settings-section-heading"><strong>{locale === "zh" ? "Provider 与模型" : "Providers & models"}</strong><span>{locale === "zh" ? "按能力路由文本、图片、视频和音频" : "Route text, image, video, and audio by capability"}</span></div>
    <DesktopConfiguredProviderProfiles config={config} locale={locale} onConfigChange={onConfigChange} onDiscoverModels={onDiscoverModels} />
    <details className="settings-provider-advanced"><summary>{locale === "zh" ? "高级 Provider 配置（音频与兼容回退）" : "Advanced Provider configuration (audio and fallback)"}</summary><div className="settings-provider-advanced-grid"><label>{ui.profiles}<textarea value={profilesText} onChange={(event) => updateProfiles(event.target.value)} spellCheck={false} /></label><p className="settings-inline-hint">{ui.profilesHint}</p><label>{ui.audioDefault}<select value={config.defaults?.audio ?? ""} onChange={(event) => updateDefault("audio", event.target.value)}><option value="">{config.provider.id}（fallback）</option>{profileIdsFor("audio").map((id) => <option key={`audio-${id}`} value={id}>{id}</option>)}</select></label><label>{locale === "zh" ? "兼容回退模型" : "Fallback model"}<input value={config.provider.model} onChange={(event) => updateProvider({ model: event.target.value, models: event.target.value.trim() ? [event.target.value.trim()] : [] })} placeholder={ui.modelPlaceholder} /></label><label>{locale === "zh" ? "兼容回退 Base URL" : "Fallback Base URL"}<input value={config.provider.baseUrl ?? ""} onChange={(event) => updateProvider({ baseUrl: event.target.value, source: event.target.value ? "openai-compatible" : "local" })} placeholder={ui.baseUrlPlaceholder} /></label><label>{locale === "zh" ? "兼容回退 API Key" : "Fallback API key"}<SettingsSecretInput value={config.provider.apiKey ?? ""} onChange={(apiKey) => updateProvider({ apiKey })} /></label></div></details>
    <div id="settings-runtime" className="settings-section-heading"><strong>{locale === "zh" ? "运行环境与诊断" : "Runtime & diagnostics"}</strong><span>{locale === "zh" ? "离线运行时、索引和诊断工具" : "Offline runtime, indexing, and diagnostics"}</span></div>
    <label>{ui.offline}<input value={config.offlineRuntimeZipPath ?? ""} onChange={(event) => onConfigChange({ ...config, offlineRuntimeZipPath: event.target.value || undefined })} placeholder={ui.offlinePlaceholder} /></label>
  </div><div className="settings-warning">{ui.warning}</div>{status ? <p className="settings-operation-status" role="status" aria-live="polite">{status}</p> : null}<div className="settings-actions"><button type="button" className="primary" onClick={onSave}>{ui.save}</button><button type="button" className="ghost" onClick={onRebuildVault}>{ui.rebuild}</button><button type="button" className="ghost" onClick={onRepairRuntime}>{ui.import}</button><button type="button" className="ghost" onClick={onExportDiagnostics}>{ui.diagnostics}</button></div></section>;
}

export function App() {
  const workspaceRef = useRef<HTMLElement>(null);
  const [activePath, setActivePath] = useState(() => window.location.pathname === "/" ? "/dashboard" : `${window.location.pathname}${window.location.search}`);
  const activePathRef = useRef(activePath);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workflowAction, setWorkflowAction] = useState<WorkflowAction>("writer");
  const [workflowDefinition, setWorkflowDefinition] = useState<WorkflowDefinitionEnvelope | null>(null);
  const [workflowPrompt, setWorkflowPrompt] = useState("");
  const [workflowMetadata, setWorkflowMetadata] = useState<WorkflowMetadata>({ title: "未命名工作流", description: "", status: "draft" });
  const [workflowBuilderOpen, setWorkflowBuilderOpen] = useState(false);
  const [localePreference, setLocalePreference] = useState<DesktopLocalePreference>("auto");
  const [skillId, setSkillIdState] = useState<SkillId>("auto");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [attachmentsPreparing, setAttachmentsPreparing] = useState(false);
  const attachmentFilesRef = useRef(new Map<string, File>());
  const [knowledgeContextEnabled, setKnowledgeContextEnabled] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState("检查本地运行环境…");
  const [runtimePhase, setRuntimePhase] = useState<DesktopBootstrapPhase>("bridge");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const runtimeRepairInFlightRef = useRef<Promise<unknown> | null>(null);
  const [runStatus, setRunStatus] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [workflowRunStatus, setWorkflowRunStatus] = useState("");
  const [dismissedTopTip, setDismissedTopTip] = useState<string | null>(null);
  const [lastWorkflowRunId, setLastWorkflowRunId] = useState<string | null>(null);
  const [workflowNodeSnapshots, setWorkflowNodeSnapshots] = useState<WorkflowCanvasExecutionSnapshot[]>([]);
  const workflowNodeRunIdRef = useRef<string | null>(null);
  const currentWorkflowIdRef = useRef<string | null>(null);
  const savedWorkflowHashRef = useRef<string | null>(null);
  const savedWorkflowPresentationHashRef = useRef<string | null>(null);
  const workflowSaveInFlightRef = useRef(false);
  const workflowAutoSavePendingRef = useRef(false);
  const workflowAutoSaveRef = useRef<(mode: "auto") => Promise<void>>(async () => undefined);
  const [assistantText, setAssistantText] = useState("");
  const [activePrompt, setActivePrompt] = useState("");
  const [activePromptAt, setActivePromptAt] = useState<string | undefined>();
  const [assistantAt, setAssistantAt] = useState<string | undefined>();
  const [conversationMessages, setConversationMessages] = useState<DesktopConversationMessage[]>([]);
  const conversationMessagesRef = useRef<DesktopConversationMessage[]>([]);
  const conversationMemoryCacheRef = useRef(new ConversationMemoryCache<DesktopConversationMessage>());
  const [conversationScrollRestore, setConversationScrollRestore] = useState<number | undefined>();
  const updateConversationMessages = useCallback((updater: SetStateAction<DesktopConversationMessage[]>) => {
    setConversationMessages((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      conversationMessagesRef.current = next;
      return next;
    });
  }, []);
  const updateVisibleConversationMessages = useCallback((conversationId: string, updater: SetStateAction<DesktopConversationMessage[]>) => {
    if (conversationIdFromPath(activePathRef.current) !== conversationId && activeConversationRef.current !== conversationId) return;
    updateConversationMessages((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const previous = conversationMemoryCacheRef.current.get(conversationId);
      conversationMemoryCacheRef.current.set(conversationId, { ...previous, messages: next.filter((message) => message.conversationId === conversationId) });
      return next;
    });
  }, [updateConversationMessages]);
  const [localSkills, setLocalSkills] = useState<LocalSkillCatalog["skills"]>(fallbackLocalSkills);
  const assistantCreatedAtRef = useRef(new Map<string, string>());
  const workflowOutputsRef = useRef(new Map<string, string>());
  // Kept as a compatibility marker for older source-level smoke tests; actual
  // output text is keyed by run id in workflowOutputsRef for parallel runs.
  const workflowOutputRef = useRef("");
  const assistantPartsRef = useRef(new Map<string, DesktopUIMessagePart[]>());
  const runModelsRef = useRef(new Map<string, string>());
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [providerCost, setProviderCost] = useState<number | undefined>();
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [artifactCount, setArtifactCount] = useState(0);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
  const [artifactRows, setArtifactRows] = useState<ArtifactRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runMetadataById, setRunMetadataById] = useState<ReadonlyMap<string, DesktopTaskMetadata | null>>(() => new Map());
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeResult[]>([]);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [conversations, setConversations] = useState<DesktopConversationSummary[]>([]);
  const conversationsRef = useRef<DesktopConversationSummary[]>([]);
  const conversationHistoryCursorRef = useRef(new Map<string, ConversationHistoryCursor>());
  const conversationHistoryHasMoreRef = useRef(new Map<string, boolean>());
  const conversationHistoryLoadingRef = useRef(new Set<string>());
  const [conversationLoadedId, setConversationLoadedId] = useState<string | null>(null);
  const persistActiveConversationScroll = useCallback((scrollTop: number) => {
    const conversationId = conversationIdFromPath(activePathRef.current);
    if (!conversationId) return;
    const cached = conversationMemoryCacheRef.current.get(conversationId);
    if (!cached) return;
    conversationMemoryCacheRef.current.set(conversationId, { ...cached, scrollTop });
  }, []);
  const updateCachedConversationMessages = useCallback((conversationId: string, updater: (messages: readonly DesktopConversationMessage[]) => readonly DesktopConversationMessage[]) => {
    const cached = conversationMemoryCacheRef.current.get(conversationId);
    if (!cached) return;
    conversationMemoryCacheRef.current.set(conversationId, { ...cached, messages: updater(cached.messages) });
  }, []);
  const [menuAgentIds, setMenuAgentIds] = useState<string[]>([]);
  const menuAgentIdsRef = useRef<string[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useLayoutEffect(() => {
    // The shell survives navigation; a new page must not inherit its scroll offset.
    const scrollContainer = workspaceRef.current?.parentElement;
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [activePath, settingsOpen, shellReady]);
  const [config, setConfig] = useState<DesktopConfig>({ schemaVersion: 1, locale: "auto", workspacePath: "", provider: { id: "local", source: "local", model: "", baseUrl: "http://127.0.0.1:11434/v1" }, runtime: { source: "system" } });
  const setSkillId = (value: SkillId) => {
    setSkillIdState(value);
    setConfig((current) => ({ ...current, provider: { ...current.provider, skillId: value } }));
  };
  const configRef = useRef(config);
  const settingsConfigSaveTimerRef = useRef<number | null>(null);
  const settingsConfigSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsConfigSaveRevisionRef = useRef(0);
  const responseWaiters = useRef(new Map<string, (value: Record<string, unknown>) => void>());
  const [availableQuestionSessionIds, setAvailableQuestionSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const questionSessionRestoreInFlightRef = useRef(new Map<string, Promise<string | undefined>>());
  const activeConversationRef = useRef<string | null>(null);
  const activeRunRef = useRef<string | null>(null);
  const standaloneMediaRunsRef = useRef(new Set<string>());
  const runContextsRef = useRef(new Map<string, DesktopRunContext>());
  const runConversationIdsRef = useRef(new Map<string, string>());
  const activeRunsByConversationRef = useRef(new Map<string, string>());
  const conversationLoadRequestRef = useRef(0);
  const [workflowCanvasKey, setWorkflowCanvasKey] = useState<string | null>(null);
  const workflowCanvasKeyRef = useRef<string | null>(null);
  const workflowRunsRef = useRef(new Map<string, WorkflowRunTracking>());
  const workflowLastRunsRef = useRef(new Map<string, WorkflowRunTracking>());
  const workflowRunKeysRef = useRef(new Map<string, string>());
  const workflowOutputNodeKeysRef = useRef(new Map<string, ReadonlySet<string>>());
  const workflowLaunchLocksRef = useRef(new Set<string>());
  const workflowRestoreRequestRef = useRef<string | null>(null);
  const workflowRestoreGenerationRef = useRef(0);
  const locale = resolveDesktopLocale(localePreference);
  const copy = desktopCopy[locale];
  const homeCopy = WORKBENCH_HOME_COPY[locale];
  const routes = useMemo(() => buildRoutes(locale), [locale]);
  const selected = useMemo(() => {
    const exact = routes.find((item) => item.path === activePath);
    if (exact) return exact;
    const [pathname, rawQuery = ""] = activePath.split("?", 2);
    const requested = new URLSearchParams(rawQuery);
    const queryMatch = routes.find((item) => {
      const [routePath, routeQuery = ""] = item.path.split("?", 2);
      if (routePath !== pathname || !routeQuery) return false;
      const expected = new URLSearchParams(routeQuery);
      for (const [key, value] of expected.entries()) if (requested.get(key) !== value) return false;
      return true;
    });
    return queryMatch ?? routes.find((item) => item.path === pathname && !item.path.includes("?")) ?? routes.find((item) => item.path !== "/dashboard" && activePath.startsWith(`${item.path}/`)) ?? routes.find((item) => item.path === "/dashboard")!;
  }, [activePath, routes]);
  const mode = selected.mode;
  const routeAction = routeWorkflowAction(selected.path);
  const requestedMediaFeature = selected.path === "/dashboard/video" || selected.path === "/dashboard/capabilities"
    ? new URLSearchParams(window.location.search).get("feature")
    : null;
  const requestedMediaAction = workflowActionForMediaFeature(requestedMediaFeature);
  const activeCapability = capabilityForWorkflowAction(selected.path === "/dashboard/video" || selected.path === "/dashboard/capabilities" || selected.path === "/dashboard/workflows"
    ? requestedMediaAction ?? workflowAction
    : routeAction ?? "llm_generate");
  const activeProvider = providerForCapability(config, activeCapability);
  const activeModel = activeProvider.model;
  const activeModels = modelOptionsForProvider(config, activeProvider) ?? [];
  const providerForWorkflowNode = (nodeType: string, selectedProviderId?: string) => {
    const capability = capabilityForWorkflowAction(nodeType);
    const selectedProfile = selectedProviderId ? config.providers?.[selectedProviderId] : undefined;
    return selectedProfile && supportsProviderCapability(selectedProfile, capability)
      ? providerForId(config, selectedProviderId)
      : providerForCapability(config, capability);
  };
  const setVisibleWorkflowCanvas = (workflowKey: string | null) => {
    workflowRestoreGenerationRef.current += 1;
    workflowCanvasKeyRef.current = workflowKey;
    setWorkflowCanvasKey(workflowKey);
    const activeTracking = workflowKey ? workflowRunsRef.current.get(workflowKey) : undefined;
    const tracking = activeTracking ?? (workflowKey ? workflowLastRunsRef.current.get(workflowKey) : undefined);
    workflowNodeRunIdRef.current = activeTracking?.runId ?? null;
    setWorkflowNodeSnapshots(tracking?.snapshots ?? []);
    setWorkflowRunStatus(tracking?.status ?? "");
  };
  const updateWorkflowTracking = (workflowKey: string, updater: (current: WorkflowRunTracking) => WorkflowRunTracking) => {
    const current = workflowRunsRef.current.get(workflowKey);
    if (!current) return;
    const next = updater(current);
    workflowRunsRef.current.set(workflowKey, next);
    if (workflowCanvasKeyRef.current === workflowKey) {
      workflowNodeRunIdRef.current = next.runId;
      setWorkflowNodeSnapshots(next.snapshots);
      setWorkflowRunStatus(next.status);
    }
  };
  const removeWorkflowTracking = (workflowKey: string) => {
    const tracking = workflowRunsRef.current.get(workflowKey);
    if (tracking) {
      workflowRunKeysRef.current.delete(tracking.runId);
      workflowLastRunsRef.current.set(workflowKey, tracking);
    }
    workflowRunsRef.current.delete(workflowKey);
    if (workflowCanvasKeyRef.current === workflowKey) {
      workflowNodeRunIdRef.current = null;
    }
  };
  const reasoningEffort = activeProvider.reasoningEffort ?? "auto";
  const routeConversationScope = conversationScopeFromPath(activePath);
  const conversationScope = routeConversationScope ?? conversationAgentIdFromPath(activePath, conversations);
  const requestedAgentId = activePath.startsWith("/dashboard/ai")
    ? (new URLSearchParams(activePath.split("?", 2)[1] ?? "").get("agent")?.trim() || (conversationScope?.startsWith("entry:") ? null : conversationScope))
    : null;
  const effectiveSkillId: SkillId = resolveDesktopSkillId(selected.path, requestedAgentId);
  const localAgentGroups = useMemo(() => [...buildOnlineAgentGroups(locale, Boolean(activeModel.trim())), ...buildAgencyAgentGroups(locale, Boolean(activeModel.trim())), ...buildLocalAgentGroups(localSkills, locale, Boolean(activeModel.trim()))], [activeModel, localSkills, locale]);
  const agentCardsById = useMemo(() => new Map(localAgentGroups.flatMap((group) => group.cards.map((card) => [card.id, card] as const))), [localAgentGroups]);
  const activeAgentCard = requestedAgentId ? agentCardsById.get(requestedAgentId) : undefined;
  const activeChatRoute = { ...(activeAgentCard ? { ...selected, path: activePath, label: activeAgentCard.title, description: activeAgentCard.description } : selected), conversationLoading: Boolean(conversationIdFromPath(activePath) && conversationLoadedId !== conversationIdFromPath(activePath)) };
  const builtInMenuAgentIds = useMemo(() => new Set(["general", ...routes.map((route) => new URLSearchParams(route.path.split("?", 2)[1] ?? "").get("agent")).filter((id): id is string => Boolean(id))]), [routes]);
  const menuAgentRoutes = useMemo(() => menuAgentIds.flatMap((id) => {
    if (builtInMenuAgentIds.has(id)) return [];
    const card = agentCardsById.get(id);
    return card ? [{ path: `/dashboard/ai?agent=${encodeURIComponent(card.id)}`, label: card.title, description: card.description, mode: "chat" as const, section: locale === "zh" ? "专家 Agent" : "Expert agents", glyph: "◈", iconKey: "advisor", placement: "main" as const }] : [];
  }), [agentCardsById, builtInMenuAgentIds, locale, menuAgentIds]);
  const sidebarRoutes = useMemo(() => routes.flatMap((route) => route.path === "/dashboard/ai" ? [route, ...menuAgentRoutes] : [route]), [menuAgentRoutes, routes]);
  const directoryGroups = useMemo(() => localAgentGroups.map((group) => ({
    ...group,
    cards: group.cards.map((card) => {
      const isBuiltIn = builtInMenuAgentIds.has(card.id);
      const isSelected = isBuiltIn || menuAgentIds.includes(card.id);
      return { ...card, secondaryAction: { id: `menu:${card.id}`, label: locale === "zh" ? (isBuiltIn ? "已在左侧菜单" : isSelected ? "移出左侧菜单" : "加入左侧菜单") : (isBuiltIn ? "In sidebar" : isSelected ? "Remove from sidebar" : "Add to sidebar"), disabled: isBuiltIn } };
    }),
  })), [builtInMenuAgentIds, locale, localAgentGroups, menuAgentIds]);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { menuAgentIdsRef.current = menuAgentIds; }, [menuAgentIds]);
  useEffect(() => { activePathRef.current = activePath; }, [activePath]);
  useEffect(() => {
    activeMediaProviderConfigured = ["image", "video", "audio"].some((capability) => isMediaProviderConfigured(providerForCapability(config, capability as "image" | "video" | "audio")));
  }, [config.provider, config.providers, config.defaults]);
  useEffect(() => { activeRunRef.current = activeRunId; }, [activeRunId]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (!runtimeReady) return;
    void tauriBridge.invoke<LocalSkillCatalog>("list_local_skill_catalog")
      .then((catalog) => { if (catalog.schemaVersion === 1 && Array.isArray(catalog.skills) && catalog.skills.length) setLocalSkills(catalog.skills); })
      .catch(() => setLocalSkills(fallbackLocalSkills));
  }, [runtimeReady]);

  function persistSettingsConfig(nextConfig: DesktopConfig, immediate = false): Promise<void> {
    configRef.current = nextConfig;
    setConfig(nextConfig);
    const revision = ++settingsConfigSaveRevisionRef.current;
    if (settingsConfigSaveTimerRef.current !== null) {
      window.clearTimeout(settingsConfigSaveTimerRef.current);
      settingsConfigSaveTimerRef.current = null;
    }
    const write = () => {
      const snapshot = configRef.current;
      settingsConfigSaveQueueRef.current = settingsConfigSaveQueueRef.current.catch(() => undefined).then(async () => {
        try {
          await tauriBridge.invoke("write_config", { value: snapshot });
          if (settingsConfigSaveRevisionRef.current === revision) setRunStatus(locale === "zh" ? "设置已自动保存到本机 config.json" : "Settings auto-saved to local config.json");
        } catch (error) {
          if (settingsConfigSaveRevisionRef.current === revision) setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "配置自动保存失败" : "Unable to auto-save settings"));
        }
      });
      return settingsConfigSaveQueueRef.current;
    };
    if (immediate) return write();
    settingsConfigSaveTimerRef.current = window.setTimeout(() => {
      settingsConfigSaveTimerRef.current = null;
      void write();
    }, 450);
    return Promise.resolve();
  }

  const updateSettingsLocalePreference = (nextLocale: DesktopLocalePreference) => {
    setLocalePreference(nextLocale);
    void persistSettingsConfig({ ...configRef.current, locale: nextLocale });
  };

  const persistProviderSelection = (update: (current: DesktopConfig) => DesktopConfig) => {
    const nextConfig = update(configRef.current);
    configRef.current = nextConfig;
    setConfig(nextConfig);
    void tauriBridge.invoke("write_config", { value: nextConfig }).catch((error) => {
      if (error instanceof Error && error.message === "tauri_bridge_unavailable") return;
      setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "模型设置保存失败" : "Unable to persist model settings"));
    });
  };
  const markQuestionSessionAvailable = useCallback((sessionId: string) => {
    setAvailableQuestionSessionIds((current) => current.has(sessionId) ? current : new Set([...current, sessionId]));
  }, []);
  const toggleMenuAgent = (agentId: string) => {
    if (builtInMenuAgentIds.has(agentId)) return;
    const currentIds = menuAgentIdsRef.current;
    const nextIds = currentIds.includes(agentId) ? currentIds.filter((id) => id !== agentId) : [...currentIds, agentId];
    menuAgentIdsRef.current = nextIds;
    setMenuAgentIds(nextIds);
    persistProviderSelection((current) => ({ ...current, menuAgentIds: nextIds }));
    setRunStatus(locale === "zh" ? (nextIds.includes(agentId) ? "已加入左侧菜单" : "已从左侧菜单移除") : (nextIds.includes(agentId) ? "Added to the sidebar" : "Removed from the sidebar"));
  };
  const updateModel = (model: string) => persistProviderSelection((current) => {
    const profileId = providerForCapability(current, activeCapability).id;
    if (profileId && current.providers?.[profileId]) return { ...current, providers: { ...current.providers, [profileId]: { ...current.providers[profileId], model } } };
    return { ...current, provider: { ...current.provider, model } };
  });
  const updateReasoning = (reasoning: string) => persistProviderSelection((current) => {
    const profileId = providerForCapability(current, activeCapability).id;
    if (profileId && current.providers?.[profileId]) return { ...current, providers: { ...current.providers, [profileId]: { ...current.providers[profileId], reasoningEffort: reasoning } } };
    return { ...current, provider: { ...current.provider, reasoningEffort: reasoning } };
  });
  const onModelChange = updateModel;
  const onReasoningChange = updateReasoning;
  const onSkillChange = setSkillId;

  const navigate = useCallback((path: string) => {
    // Match the online compatibility route: `/dashboard/works` immediately
    // resolves to the asset library rather than creating a second page.
    const canonicalPath = path === "/dashboard/works" ? "/dashboard/assets" : path;
    window.history.pushState({}, "", canonicalPath);
    setActivePath(canonicalPath);
    const conversationId = conversationIdFromPath(canonicalPath);
    if (conversationId) {
      activeConversationRef.current = conversationId;
      setActiveConversationId(conversationId);
      setConversationLoadedId(null);
      setActiveRunId(activeRunsByConversationRef.current.get(conversationId) ?? null);
      setActivePrompt("");
      setActivePromptAt(undefined);
      setAssistantText("");
      setAssistantAt(undefined);
      updateConversationMessages([]);
      setToolEvents([]);
      setPrompt("");
    } else if (/^\/dashboard\/(?:ai|writer|image-assistant)(?:$|\?|\/)/u.test(canonicalPath)) {
      activeConversationRef.current = null;
      setActiveConversationId(null);
      setConversationLoadedId(null);
      setActiveRunId(null);
      setActivePrompt("");
      setActivePromptAt(undefined);
      setAssistantText("");
      setAssistantAt(undefined);
      updateConversationMessages([]);
      setToolEvents([]);
      setPrompt("");
    } else {
      setConversationLoadedId(null);
      setActiveRunId(null);
    }
  }, [updateConversationMessages]);

  const workbenchClient = useMemo(() => createDesktopWorkbenchClient(tauriBridge, {
    go: navigate,
    replace: navigate,
    current: () => activePathRef.current,
  }), [navigate]);
  useEffect(() => {
    let cancelled = false;
    const unresolved = runs.filter((run) => !runMetadataById.has(run.id));
    if (!unresolved.length) return;
    void Promise.all(unresolved.map(async (run) => {
      try {
        const detail = toRunDetail(await workbenchClient.runs.inspect(run.id));
        return [run.id, readDesktopTaskMetadata(detail)] as const;
      } catch {
        return [run.id, null] as const;
      }
    })).then((entries) => {
      if (cancelled) return;
      setRunMetadataById((current) => {
        const next = new Map(current);
        for (const [runId, metadata] of entries) next.set(runId, metadata);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [runMetadataById, runs, workbenchClient]);
  const desktopChatTransport = useMemo(() => {
    const resolveChatAction = (message: DesktopUIMessage): WorkflowAction => {
      const route = typeof message.metadata?.route === "string" ? message.metadata.route : "";
      return (routeWorkflowAction(route) ?? "llm_generate") as WorkflowAction;
    };
    const resolveChatProvider = (message: DesktopUIMessage) => providerForCapability(configRef.current, capabilityForWorkflowAction(resolveChatAction(message)));
    const resolveChatArtifactPolicy = (message: DesktopUIMessage) => {
      const route = typeof message.metadata?.route === "string" ? message.metadata.route : "";
      return promptRequestsArtifact(desktopUIMessageText(message)) || /(?:executive-ppt|executive-presentation-ppt)/u.test(route);
    };
    return createDesktopChatTransport(tauriBridge, workbenchClient, {
    resolveSessionId: async (chatId) => conversationsRef.current.find((item) => item.id === chatId)?.opencode_session_id ?? chatId,
    resolveProvider: resolveChatProvider,
    ensureSession: async ({ chatId, sessionId, provider, message }) => {
      const existingConversation = conversationsRef.current.find((item) => item.id === chatId);
      const conversationAgentId = existingConversation?.agent_id?.trim() ?? requestedAgentId ?? conversationScope ?? null;
      if (!conversationsRef.current.some((item) => item.id === chatId)) {
        const title = buildConversationTitleFromPrompt(desktopUIMessageText(message), locale);
        const created = await tauriBridge.invoke<{ id: string; title: string; updated_at: string; opencode_session_id?: string | null; agent_id?: string | null }>("create_conversation", { input: { id: chatId, title, project_id: null, agent_id: conversationAgentId } });
        const pendingConversation = { id: created.id, title: created.title, updated_at: created.updated_at, opencode_session_id: created.opencode_session_id ?? null, agent_id: created.agent_id ?? conversationAgentId };
        conversationsRef.current = [pendingConversation, ...conversationsRef.current.filter((item) => item.id !== chatId)];
        setConversations((current) => [pendingConversation, ...current.filter((item) => item.id !== chatId)]);
      }
      await tauriBridge.invoke("host_start");
      const response = await sendHostMessage({
        version: 1,
        requestId: `chat-session-${chatId}-${Date.now()}`,
        type: "session.create",
        payload: {
          conversationId: chatId,
          ...(sessionId !== chatId ? { sessionId } : {}),
          workspacePath: configRef.current.workspacePath,
          model: message.metadata?.modelId ?? provider.model,
          provider,
          ...(conversationAgentId?.startsWith("agency-") ? { agentId: conversationAgentId } : {}),
          allowArtifacts: resolveChatArtifactPolicy(message),
        },
      });
      if (response.ok !== true) {
        const error = response.error && typeof response.error === "object" ? response.error as { message?: unknown } : undefined;
        throw new Error(typeof error?.message === "string" ? error.message : "opencode_session_unavailable");
      }
      const resolvedSessionId = response.data && typeof response.data === "object" ? String((response.data as { sessionId?: unknown }).sessionId ?? "") : "";
      if (!resolvedSessionId) throw new Error("opencode_session_id_missing");
      markQuestionSessionAvailable(resolvedSessionId);
      conversationsRef.current = conversationsRef.current.map((item) => item.id === chatId ? { ...item, opencode_session_id: resolvedSessionId } : item);
      setConversations((current) => current.map((item) => item.id === chatId ? { ...item, opencode_session_id: resolvedSessionId } : item));
      void tauriBridge.invoke("set_conversation_session", { conversationId: chatId, sessionId: resolvedSessionId }).catch(() => undefined);
      const recovered = response.data && typeof response.data === "object" && (response.data as { recovered?: unknown }).recovered === true;
      if (!recovered) return resolvedSessionId;
      const history = await workbenchClient.conversations.messages(chatId);
      const recoveryContext = createSessionRecoverySnapshot(history
        .filter((item): item is typeof item & { role: "user" | "assistant" } => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role, content: desktopUIMessageText(item) })));
      return { sessionId: resolvedSessionId, ...(recoveryContext ? { recoveryContext } : {}) };
    },
    resolveSkillId: (message) => {
      const messageConversationId = message.metadata?.conversationId;
      const messageAgentId = typeof messageConversationId === "string" ? conversationsRef.current.find((item) => item.id === messageConversationId)?.agent_id?.trim() : undefined;
      const selectedAgentId = messageAgentId ?? requestedAgentId;
      // Resolve from the message's persisted agent when a background run
      // finishes after the user has navigated elsewhere. Entry agents (Writer
      // and Image Assistant) are valid route-level skill selectors too.
      return resolveDesktopSkillId(activePathRef.current, selectedAgentId);
    },
    resolvePrompt: (message, promptText) => {
      const messageConversationId = message.metadata?.conversationId;
      const messageAgentId = typeof messageConversationId === "string" ? conversationsRef.current.find((item) => item.id === messageConversationId)?.agent_id?.trim() : undefined;
      const selectedAgentId = messageAgentId ?? requestedAgentId;
      return desktopExecutionPrompt(resolveDesktopSkillId(activePathRef.current, selectedAgentId), promptText, locale);
    },
    resolveAllowArtifacts: resolveChatArtifactPolicy,
    resolveSystemPrompt: (message) => {
      const messageConversationId = message.metadata?.conversationId;
      const messageAgentId = typeof messageConversationId === "string" ? conversationsRef.current.find((item) => item.id === messageConversationId)?.agent_id?.trim() : undefined;
      const selectedAgentId = messageAgentId ?? requestedAgentId;
      const skillId = resolveDesktopSkillId(activePathRef.current, selectedAgentId);
      return localizedSkillSystemPrompt(skillId, locale);
    },
    resolveAgentId: (message) => {
      const messageConversationId = message.metadata?.conversationId;
      const messageAgentId = typeof messageConversationId === "string" ? conversationsRef.current.find((item) => item.id === messageConversationId)?.agent_id?.trim() : undefined;
      const selectedAgentId = messageAgentId ?? requestedAgentId;
      return selectedAgentId?.startsWith("agency-") ? selectedAgentId : undefined;
    },
    onRunStarted: (runId, chatId, message) => {
      const createdAt = message.metadata?.createdAt ?? new Date().toISOString();
      const optimisticUserMessage = desktopUIMessageToConversationMessage(message);
      updateVisibleConversationMessages(chatId, (current) => current.some((item) => item.id === optimisticUserMessage.id)
        ? current
        : [...current, optimisticUserMessage]);
      runConversationIdsRef.current.set(runId, chatId);
      activeRunsByConversationRef.current.set(chatId, runId);
      runContextsRef.current.set(runId, { kind: "conversation", launchPath: activePathRef.current, conversationId: chatId });
      runModelsRef.current.set(runId, message.metadata?.modelId ?? activeModel);
      assistantPartsRef.current.set(runId, [{ type: "data-status", id: `${runId}:status`, data: { status: "running", message: locale === "zh" ? "正在等待模型响应…" : "Waiting for the model response…" } }]);
      const visible = conversationIdFromPath(activePathRef.current) === chatId || activeConversationRef.current === chatId;
      if (visible) {
        activeRunRef.current = runId;
        setActiveConversationId(chatId);
        activeConversationRef.current = chatId;
        setActiveRunId(runId);
        setAssistantText("");
        setAssistantAt(undefined);
        setActivePrompt(desktopUIMessageText(message));
        setActivePromptAt(createdAt);
        setToolEvents([]);
        setRunStatus(locale === "zh" ? "已发送，正在流式生成…" : "Sent; streaming response…");
      }
    },
    });
  }, [activeModel, conversationScope, locale, markQuestionSessionAvailable, requestedAgentId, updateConversationMessages, workbenchClient]);

  const questionConversation = questionConversationForRoute(activePath, conversations);
  useEffect(() => {
    const persistedSessionId = questionConversation?.opencode_session_id?.trim();
    if (!runtimeReady || !questionConversation || !persistedSessionId || availableQuestionSessionIds.has(persistedSessionId)) return;
    let cancelled = false;
    const restoreKey = `${questionConversation.id}:${persistedSessionId}`;

    const restoreQuestionSession = async () => {
      let restoration = questionSessionRestoreInFlightRef.current.get(restoreKey);
      if (!restoration) {
        restoration = (async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await tauriBridge.invoke("host_start");
              const provider = providerForCapability(configRef.current, "text");
              const agentId = questionConversation.agent_id?.trim();
              const response = await sendHostMessage({
                version: 1,
                requestId: `question-session:${questionConversation.id}:${Date.now()}`,
                type: "session.attach",
                payload: {
                  conversationId: questionConversation.id,
                  sessionId: persistedSessionId,
                  workspacePath: configRef.current.workspacePath,
                  model: provider.model,
                  provider,
                  ...(agentId?.startsWith("agency-") ? { agentId } : {}),
                },
              });
              const data = response.data && typeof response.data === "object" ? response.data as { attached?: unknown; sessionId?: unknown } : undefined;
              if (data?.attached !== true) return undefined;
              const restoredSessionId = String(data.sessionId ?? "");
              if (!restoredSessionId) throw new Error("opencode_session_id_missing");
              return restoredSessionId;
            } catch (error) {
              if (attempt >= 2) throw error;
              await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
            }
          }
          return undefined;
        })();
        questionSessionRestoreInFlightRef.current.set(restoreKey, restoration);
        void restoration.finally(() => {
          if (questionSessionRestoreInFlightRef.current.get(restoreKey) === restoration) questionSessionRestoreInFlightRef.current.delete(restoreKey);
        }).catch(() => undefined);
      }
      try {
        const restoredSessionId = await restoration;
        if (cancelled || !restoredSessionId) return;
        markQuestionSessionAvailable(restoredSessionId);
      } catch (error) {
        if (!cancelled) setRunStatus(locale === "zh" ? `会话恢复失败：${error instanceof Error ? error.message : String(error)}` : `Unable to restore the session: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void restoreQuestionSession();
    return () => { cancelled = true; };
  }, [activePath, availableQuestionSessionIds, locale, markQuestionSessionAvailable, questionConversation, runtimeReady]);

  const loadConversationMessages = useCallback(async (conversationId: string, options?: { readonly limit?: number; readonly before?: ConversationHistoryCursor }) => {
    const history = await workbenchClient.conversations.messages(conversationId, options);
    const loadedMessages = history.filter((message) => message.role === "user" || message.role === "assistant").map(desktopUIMessageToConversationMessage);
    const existingAssistantIds = new Set(loadedMessages.filter((message) => message.role === "assistant").map((message) => message.id));
    // Replay terminal runs from their ordered event log. It is the durable
    // source of truth for streamed text, so it also repairs a message that was
    // persisted by an older desktop build before every delta reached its body.
    const relatedRuns = (await workbenchClient.runs.list()).filter((run) => run.conversationId === conversationId);
    const replayed = (await Promise.all(relatedRuns.map(async (run) => {
      try {
        const detail = toRunDetail(await workbenchClient.runs.inspect(run.id));
        return replayPersistedRunToConversationMessage(detail.run, detail.events, conversationId);
      } catch {
        return null;
      }
    }))).filter((message): message is NonNullable<typeof message> => Boolean(message));
    for (const message of replayed.filter((item) => !existingAssistantIds.has(item.id))) {
      void tauriBridge.invoke("append_message", { input: { id: message.id, conversation_id: conversationId, role: message.role, content: message.content, parts_json: JSON.stringify(message.parts), created_at: message.createdAt } }).catch(() => undefined);
    }
    const replayedById = new Map(replayed.map((message) => [message.id, message] as const));
    const repairedLoadedMessages = loadedMessages.map((message) => replayedById.get(message.id) ?? message);
    const missingReplayedMessages = replayed.filter((message) => !existingAssistantIds.has(message.id));
    return { history, messages: [...repairedLoadedMessages, ...missingReplayedMessages] };
  }, [workbenchClient]);
  const loadOlderConversationMessages = useCallback((conversationId: string, viewport: HTMLDivElement) => {
    if (activeConversationRef.current !== conversationId || conversationHistoryLoadingRef.current.has(conversationId)) return;
    if (conversationHistoryHasMoreRef.current.get(conversationId) === false) return;
    const cursor = conversationHistoryCursorRef.current.get(conversationId);
    if (!cursor) return;
    conversationHistoryLoadingRef.current.add(conversationId);
    const previousHeight = viewport.scrollHeight;
    const previousTop = viewport.scrollTop;
    void (async () => {
      try {
        const page = await workbenchClient.conversations.messages(conversationId, { limit: CONVERSATION_PAGE_SIZE, before: cursor });
        if (activeConversationRef.current !== conversationId || !viewport.isConnected) return;
        const loadedMessages = page.filter((message) => message.role === "user" || message.role === "assistant").map(desktopUIMessageToConversationMessage);
        const oldest = page[0];
        const nextCursor = oldest ? { createdAt: oldest.metadata?.createdAt ?? new Date(0).toISOString(), id: oldest.id } : undefined;
        const hasMore = page.length >= CONVERSATION_PAGE_SIZE;
        updateConversationMessages((current) => {
          const merged = mergeConversationMessages(current, loadedMessages, conversationId);
          const cached = conversationMemoryCacheRef.current.get(conversationId);
          conversationMemoryCacheRef.current.set(conversationId, { ...cached, messages: merged, cursor: nextCursor, hasMore });
          return merged;
        });
        if (nextCursor) conversationHistoryCursorRef.current.set(conversationId, nextCursor);
        conversationHistoryHasMoreRef.current.set(conversationId, hasMore);
        window.requestAnimationFrame(() => {
          if (!viewport.isConnected) return;
          viewport.scrollTop = viewport.scrollHeight - previousHeight + previousTop;
        });
      } catch {
        // Keep the current page usable; the next upward scroll can retry.
      } finally {
        conversationHistoryLoadingRef.current.delete(conversationId);
      }
    })();
  }, [updateConversationMessages, workbenchClient]);
  const workflowDirectoryWorkflows = useMemo<WorkbenchWorkflowDirectoryWorkflow[]>(() => savedWorkflows.map((workflow) => {
    const definition = parseSavedWorkflowDefinition(workflow);
    const capabilities = definition?.nodes.filter((node) => node.nodeKey !== "input" && node.type !== "output") ?? [];
    return {
      id: workflow.id,
      title: workflow.name,
      description: capabilities.length
        ? capabilities.map((node) => locale === "zh" ? node.title : workflowActionEnglish[node.type] ?? node.title).join(" → ")
        : (locale === "zh" ? "本地可编辑工作流" : "Locally editable workflow"),
      status: definition ? "live" : "draft",
      updatedAt: workflow.updated_at,
      nodeCount: definition?.nodes.length ?? 0,
    };
  }), [locale, savedWorkflows]);
  const workflowDirectoryTemplates = useMemo<WorkbenchWorkflowDirectoryTemplate[]>(() => [
    { id: "content-pipeline", title: locale === "zh" ? "内容营销流水线" : "Content marketing pipeline", description: locale === "zh" ? "从任务输入开始，生成可编辑营销文案并写入本地产物。" : "Turn a task into editable marketing copy and a local artifact.", status: activeModel.trim() ? "ready" : "needs-config" },
    { id: "presentation", title: locale === "zh" ? "演示文稿生成" : "Presentation generation", description: locale === "zh" ? "使用本地 ppt-master Skill 构建演示文稿工作流。" : "Build a presentation workflow with the local ppt-master Skill.", status: activeModel.trim() ? "ready" : "needs-config" },
    { id: "image-campaign", title: locale === "zh" ? "营销图片批量生成" : "Campaign image generation", description: locale === "zh" ? "以 Canvas 编排文案与图片生成节点；未配置图片 Provider 时保持可见。" : "Compose copy and image generation on Canvas; remains visible until an image provider is configured.", status: isMediaProviderConfigured(providerForCapability(config, "image")) ? "ready" : "needs-config" },
    { id: "video-ffmpeg-transform", title: locale === "zh" ? "FFmpeg 视频变换" : "FFmpeg video transform", description: locale === "zh" ? "上传本地视频，使用 FFmpeg 调整为 16:9、1280×720、30 FPS。" : "Upload a local video and transform it to 16:9, 1280×720 at 30 FPS with FFmpeg.", status: "ready" },
    { id: "audio-ffmpeg-trim", title: locale === "zh" ? "FFmpeg 音频裁剪" : "FFmpeg audio trim", description: locale === "zh" ? "上传本地音频，使用 FFmpeg 裁剪前两秒并输出纯音频。" : "Upload a local audio file and trim the first two seconds to a pure audio output with FFmpeg.", status: "ready" },
    { id: "product-promotion-video", title: locale === "zh" ? "产品宣传视频流水线" : "Product promotion video pipeline", description: locale === "zh" ? "文生 5 秒数字人视频，依次拼接操作、结果和片尾视频，添加字幕与语音。" : "Generate a 5-second digital human video, append operation, result, and outro clips, then add subtitles and voiceover.", status: isMediaProviderConfigured(providerForCapability(config, "video")) && isMediaProviderConfigured(providerForCapability(config, "audio")) ? "ready" : "needs-config" },
  ], [activeModel, config, locale]);
  const workflowDirectoryRuns = useMemo<WorkbenchWorkflowDirectoryRun[]>(() => runs.flatMap((run) => {
    const metadata = runMetadataById.get(run.id);
    if (metadata?.kind !== "workflow") return [];
    const workflow = metadata.workflowId ? savedWorkflows.find((item) => item.id === metadata.workflowId) : undefined;
    return [{
      id: run.id,
      workflowTitle: workflow?.name ?? (locale === "zh" ? "本地工作流" : "Local workflow"),
      status: run.status,
      createdAt: run.started_at,
      ...(run.finished_at ? { finishedAt: run.finished_at } : {}),
    }];
  }), [locale, runMetadataById, runs, savedWorkflows]);
  openWorkflowProviderSettings = () => { setSettingsOpen(true); workbenchClient.navigation.go("/dashboard/settings"); };

  function toggleLocale() {
    setLocalePreference(locale === "zh" ? "en" : "zh");
  }

  async function addAttachments(files: FileList | readonly File[] | null) {
    if (!files?.length) return [];
    setAttachmentsPreparing(true);
    const selected = Array.from(files).slice(0, 4);
    const next: LocalAttachment[] = [];
    try {
      for (const file of selected) {
        const attachment = { id: `${file.name}-${file.lastModified}-${file.size}`, name: file.name, size: file.size, mediaType: file.type || "application/octet-stream", ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}), status: "uploading" as const };
        attachmentFilesRef.current.set(attachment.id, file);
        try {
          const saved = await persistLocalFile(file, tauriBridge);
          if (isTextAttachment(file)) {
            const rawText = (await file.text()).replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
            next.push({ ...attachment, status: "ready", relativePath: saved.relativePath, text: rawText.slice(0, LOCAL_ATTACHMENT_MAX_TEXT_CHARS), textCharCount: rawText.length, truncated: rawText.length > LOCAL_ATTACHMENT_MAX_TEXT_CHARS });
          } else if (/\.(docx|pdf)$/iu.test(file.name) || /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/iu.test(file.type)) {
            try {
              await tauriBridge.invoke("host_start");
              const response = await sendHostMessage({ version: 1, requestId: `attachment:${attachment.id}`, type: "attachment.extract", payload: { workspacePath: config.workspacePath, relativePath: saved.relativePath, fileName: file.name, mediaType: file.type } });
              const data = response.data && typeof response.data === "object" ? response.data as { text?: unknown; textCharCount?: unknown; truncated?: unknown } : {};
              const text = typeof data.text === "string" ? data.text : "";
              next.push({ ...attachment, status: "ready", relativePath: saved.relativePath, ...(text ? { text, textCharCount: typeof data.textCharCount === "number" ? data.textCharCount : text.length, truncated: data.truncated === true } : {}) });
            } catch {
              next.push({ ...attachment, status: "ready", relativePath: saved.relativePath });
            }
          } else {
            next.push({ ...attachment, status: "ready", relativePath: saved.relativePath });
          }
        } catch (error) {
          next.push({ ...attachment, status: "failed", error: localFileUploadErrorCode(error) || (locale === "zh" ? "附件上传失败" : "Attachment upload failed") });
        }
      }
      setAttachments((current) => [...current.filter((item) => !next.some((replacement) => replacement.id === item.id)), ...next].slice(0, 4));
    } finally {
      setAttachmentsPreparing(false);
    }
    return next;
  }

  useEffect(() => {
    const onRetryAttachment = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id !== "string") return;
      const file = attachmentFilesRef.current.get(id);
      if (!file) {
        setRunStatus(locale === "zh" ? "原始附件已不可用，请重新选择文件" : "The original attachment is no longer available; choose the file again");
        return;
      }
      void addAttachments([file]);
    };
    window.addEventListener("coworkany:attachment-retry", onRetryAttachment);
    return () => window.removeEventListener("coworkany:attachment-retry", onRetryAttachment);
  }, [locale]);

  async function selectWorkflowFiles() {
    if (!isTauriBridgeAvailable()) throw new Error("desktop_file_selection_unavailable");
    return tauriBridge.invoke<WorkflowLocalFile[]>("pick_workflow_files");
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
    attachmentFilesRef.current.delete(id);
  }

  async function startNewConversation() {
    return startNewConversationForAgent();
  }

  async function startNewConversationForAgent(agentIdOverride?: string | null) {
    const sourcePath = activePathRef.current;
    const conversationAgentId = agentIdOverride === undefined ? conversationAgentIdFromPath(sourcePath, conversationsRef.current) : agentIdOverride;
    const conversationId = `conversation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const createdAt = new Date().toISOString();
    const pendingConversation: DesktopConversationSummary = {
      id: conversationId,
      title: defaultConversationTitle(locale),
      updated_at: createdAt,
      opencode_session_id: null,
      agent_id: conversationAgentId,
    };
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    setActiveRunId(null);
    updateConversationMessages([]);
    setActivePrompt("");
    setActivePromptAt(undefined);
    setAssistantText("");
    setAssistantAt(undefined);
    setToolEvents([]);
    setRunStatus("");
    setPrompt("");
    setAttachments([]);
    setConversations((current) => [pendingConversation, ...current.filter((item) => item.id !== conversationId)]);
    workbenchClient.navigation.go(conversationRoute(pendingConversation));
    try {
      const persisted = await tauriBridge.invoke<DesktopConversationSummary>("create_conversation", {
        input: { id: conversationId, title: pendingConversation.title, project_id: null, agent_id: conversationAgentId },
      });
      setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, ...persisted } : item));
    } catch (error) {
      if (error instanceof Error && error.message === "tauri_bridge_unavailable") {
        setRunStatus(locale === "zh" ? "浏览器预览会话仅保留在当前页面" : "The preview conversation is kept only on this page");
        return;
      }
      setRunStatus(locale === "zh" ? `会话创建失败：${error instanceof Error ? error.message : String(error)}` : `Unable to create conversation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    if (activePath === "/dashboard/works") {
      window.history.replaceState({}, "", "/dashboard/assets");
      setActivePath("/dashboard/assets");
    }
  }, [activePath]);

  // Deep links from the cloud dashboard include a conversation id. Keep the
  // desktop route interactive by loading that exact durable transcript when
  // a history/task link is opened, instead of merely changing the URL.
  useEffect(() => {
    const requestId = ++conversationLoadRequestRef.current;
    const match = activePath.match(/^\/dashboard\/(?:ai|writer|image-assistant)\/([^/?]+)/);
    if (!match) {
      setConversationLoadedId(null);
      const activeBasePath = activePath.split("?", 1)[0].replace(/\/+$/u, "") || "/";
      if (activeBasePath === "/dashboard/ai" || activeBasePath === "/dashboard/writer" || activeBasePath === "/dashboard/image-assistant") {
        setActiveConversationId(null);
        activeConversationRef.current = null;
        setActivePrompt("");
        setActivePromptAt(undefined);
        setAssistantText("");
        setAssistantAt(undefined);
        updateConversationMessages([]);
        setToolEvents([]);
        setActiveRunId(null);
      }
      return;
    }
    const conversationId = decodeURIComponent(match[1]);
    // Switch the visible session immediately; the async history load must not
    // leave the previous conversation interactive while the new transcript is
    // being fetched.
    const previousConversationId = activeConversationRef.current;
    if (previousConversationId && previousConversationId !== conversationId) {
      const previous = conversationMemoryCacheRef.current.get(previousConversationId);
      conversationMemoryCacheRef.current.set(previousConversationId, {
        ...previous,
        messages: conversationMessagesRef.current.filter((message) => message.conversationId === previousConversationId),
        cursor: conversationHistoryCursorRef.current.get(previousConversationId),
        hasMore: conversationHistoryHasMoreRef.current.get(previousConversationId),
      });
    }
    activeConversationRef.current = conversationId;
    setConversationLoadedId(null);
    setActiveConversationId(conversationId);
    setActiveRunId(activeRunsByConversationRef.current.get(conversationId) ?? null);
    const cached = conversationMemoryCacheRef.current.get(conversationId);
    conversationHistoryCursorRef.current.delete(conversationId);
    conversationHistoryHasMoreRef.current.delete(conversationId);
    if (cached?.cursor) conversationHistoryCursorRef.current.set(conversationId, cached.cursor);
    if (cached?.hasMore !== undefined) conversationHistoryHasMoreRef.current.set(conversationId, cached.hasMore);
    setConversationScrollRestore(cached?.scrollTop);
    const optimisticMessages = conversationMessagesRef.current.filter((message) => message.conversationId === conversationId);
    updateConversationMessages(cached ? [...cached.messages] : optimisticMessages);
    setActivePrompt("");
    setAssistantText("");
    setAssistantAt(undefined);
    setToolEvents([]);
    if (cached) {
      const latestUser = [...cached.messages].reverse().find((message) => message.role === "user");
      const latestAssistant = [...cached.messages].reverse().find((message) => message.role === "assistant");
      setActivePrompt(latestUser?.content ?? "");
      setActivePromptAt(latestUser?.createdAt);
      setAssistantText(latestAssistant?.content ?? "");
      setAssistantAt(latestAssistant?.createdAt);
      setPrompt("");
      setRunStatus("");
      setConversationLoadedId(conversationId);
      return;
    }
    if (!isTauriBridgeAvailable()) {
      setPrompt("");
      setRunStatus("");
      setConversationLoadedId(conversationId);
      return;
    }
    void loadConversationMessages(conversationId, { limit: CONVERSATION_PAGE_SIZE }).then(({ history, messages: loadedMessages }) => {
      if (requestId !== conversationLoadRequestRef.current || activePathRef.current !== activePath) return;
      const mergedMessages = mergeConversationMessages(conversationMessagesRef.current, loadedMessages, conversationId);
      updateConversationMessages(mergedMessages);
      const oldest = history[0];
      const cursor = oldest ? { createdAt: oldest.metadata?.createdAt ?? new Date(0).toISOString(), id: oldest.id } : undefined;
      if (cursor) conversationHistoryCursorRef.current.set(conversationId, cursor);
      const hasMore = history.length >= CONVERSATION_PAGE_SIZE;
      conversationHistoryHasMoreRef.current.set(conversationId, hasMore);
      conversationMemoryCacheRef.current.set(conversationId, { messages: mergedMessages, cursor, hasMore });
      const latestUser = [...mergedMessages].reverse().find((message) => message.role === "user");
      const latestAssistant = [...mergedMessages].reverse().find((message) => message.role === "assistant");
      setActiveConversationId(conversationId);
      activeConversationRef.current = conversationId;
      setActivePrompt(latestUser?.content ?? "");
      setActivePromptAt(latestUser?.createdAt);
      setAssistantText(latestAssistant?.content ?? "");
      setAssistantAt(latestAssistant?.createdAt);
      setPrompt("");
      setToolEvents([]);
      setActiveRunId(activeRunsByConversationRef.current.get(conversationId) ?? null);
      setRunStatus("");
      setConversationLoadedId(conversationId);
    }).catch(() => {
      if (requestId !== conversationLoadRequestRef.current || activePathRef.current !== activePath) return;
      setConversationLoadedId(conversationId);
      setRunStatus(locale === "zh" ? "会话历史加载失败" : "Unable to load conversation history");
    });
  }, [activePath, loadConversationMessages, locale]);

  useEffect(() => {
    const onPopState = () => setActivePath(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setSettingsOpen(activePath === "/dashboard/settings");
    const [pathname, rawQuery = ""] = activePath.split("?", 2);
    const requestedAgent = new URLSearchParams(rawQuery).get("agent")?.trim();
    const mediaAction = (pathname === "/dashboard/video" || pathname === "/dashboard/capabilities")
      ? workflowActionForMediaFeature(new URLSearchParams(rawQuery).get("feature"))
      : null;
    if (mediaAction) setWorkflowAction(mediaAction as WorkflowAction);
    else if (pathname.includes("executive-ppt") || requestedAgent === "executive-ppt" || requestedAgent === "executive-presentation-ppt") setWorkflowAction("ppt_generate");
    else if (pathname === "/dashboard/image-assistant") setWorkflowAction("image_generate");
    else if (pathname === "/dashboard/video") setWorkflowAction("video_generate");
    else if (pathname === "/dashboard/knowledge-base") setWorkflowAction("knowledge_retrieve");
    else if (pathname === "/dashboard/writer") setWorkflowAction("writer");
    if (pathname.startsWith("/dashboard/writer")) setSkillId("writer-orchestrator");
    else if (pathname.includes("executive-ppt") || requestedAgent === "executive-ppt") setSkillId("ppt-master");
    else if (pathname.includes("executive-presentation-ppt") || requestedAgent === "executive-presentation-ppt") setSkillId("dashi-ppt");
    else if (pathname === "/dashboard/knowledge-base") setSkillId("auto");
    if (pathname !== "/dashboard/workflows") {
      setVisibleWorkflowCanvas(null);
      setWorkflowDefinition(null);
      setWorkflowBuilderOpen(false);
    }
  }, [activePath]);

  useEffect(() => {
    if (!isTauriBridgeAvailable()) {
      setRuntimePhase("ready");
      setRuntimeStatus(locale === "zh" ? "浏览器预览模式 · Tauri 未连接" : "Browser preview mode · Tauri is not connected");
      setRuntimeReady(true);
      setShellReady(true);
      return;
    }

    void (async () => {
      try {
        setRuntimePhase("bridge");
        setRuntimeStatus(locale === "zh" ? "正在连接桌面运行桥接：检查 Tauri 通道与本地服务…" : "Connecting to the desktop bridge: checking the Tauri channel and local services…");
        const health = await tauriBridge.invoke<{ status: string }>("health");
         setRuntimePhase("state");
         setRuntimeStatus(locale === "zh" ? "正在初始化本地数据库：检查完整性并恢复中断任务…" : "Initializing the local database: checking integrity and recovering interrupted runs…");
         const state = await tauriBridge.invoke<{ integrity: boolean; interruptedRuns?: number }>("initialize_local_state");
         setRuntimeStatus(locale === "zh" ? "正在读取 config.json：解析 Provider、模型与本地路径…" : "Reading config.json: resolving Providers, models, and local paths…");
         const stored = await tauriBridge.invoke<DesktopConfig>("read_config");
        const migrateProvider = (profile: DesktopProviderConfig): DesktopProviderConfig => {
          const { workflowId, digitalHumanWorkflowId, videoEnhanceWorkflowId, workflows, ...portableProfile } = profile;
          const migratedWorkflows = migrateLegacyRunningHubWorkflows(workflows, { workflowId, digitalHumanWorkflowId, videoEnhanceWorkflowId });
          return migratedWorkflows ? { ...portableProfile, workflows: migratedWorkflows } : portableProfile;
        };
        const migratedStored = stored ? { ...stored, provider: { ...migrateProvider(stored.provider), model: stored.provider.model ?? "" }, ...(stored.providers ? { providers: Object.fromEntries(Object.entries(stored.providers).map(([id, profile]) => [id, migrateProvider(profile)])) } : {}) } : stored;
         let activeConfig = migratedStored;
         if (migratedStored) {
           const selectedProvider = { ...migratedStored.provider, model: preferredConfiguredModel(migratedStored.provider) };
           const configChanged = JSON.stringify(migratedStored) !== JSON.stringify(stored) || selectedProvider.model !== migratedStored.provider.model;
           activeConfig = configChanged ? { ...migratedStored, provider: selectedProvider } : migratedStored;
           setConfig(activeConfig);
           setSkillIdState(activeConfig.provider.skillId ?? "auto");
           setLocalePreference(activeConfig.locale ?? "auto");
           if (configChanged) void tauriBridge.invoke("write_config", { value: activeConfig }).catch(() => undefined);
         }
        // Release the shell before hydrating the potentially large artifact,
        // run, and conversation collections. Native file inspection must not
        // make the whole desktop window look frozen.
        setShellReady(true);
        const hydrateWorkbench = async () => {
          try {
            setRuntimeStatus(locale === "zh" ? "正在后台加载会话、任务、资产与工作流…" : "Loading sessions, tasks, assets, and workflows in the background…");
         const [recent, usageRows, artifactRowsFromClient, workflows, runRowsFromClient] = await Promise.all([workbenchClient.conversations.list(), workbenchClient.usage.list(), workbenchClient.artifacts.list(), workbenchClient.workflows.list(), workbenchClient.runs.list()]);
         const artifacts = artifactRowsFromClient.map(toArtifactRow);
         const runRows = runRowsFromClient.map(toRunRow);
         const inputTokens = usageRows.reduce((total, row) => total + (row.inputTokens ?? 0), 0);
         const outputTokens = usageRows.reduce((total, row) => total + (row.outputTokens ?? 0), 0);
         const providerCosts = usageRows.map((row) => row.providerCost).filter((value): value is number => typeof value === "number");
         const estimatedCosts = usageRows.map((row) => row.estimatedCost).filter((value): value is number => typeof value === "number");
        const configuredMenuAgentIds = Array.isArray(activeConfig?.menuAgentIds) ? activeConfig.menuAgentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
        menuAgentIdsRef.current = configuredMenuAgentIds;
        setMenuAgentIds(configuredMenuAgentIds);
        setConversations(recent.map((conversation) => ({ id: conversation.id, title: conversation.title, updated_at: conversation.updatedAt, opencode_session_id: conversation.opencodeSessionId ?? null, agent_id: conversation.agentId ?? null })));
         setTaskCount(runRows.length);
         setTokenCount(inputTokens + outputTokens);
         setProviderCost(providerCosts.length ? providerCosts.reduce((total, value) => total + value, 0) : undefined);
         setEstimatedCost(estimatedCosts.length ? estimatedCosts.reduce((total, value) => total + value, 0) : 0);
         setArtifactCount(artifacts.length);
         setArtifactRows(artifacts);
         setSavedWorkflows(workflows.map(toSavedWorkflow));
          setRuns(runRows);
         if (state.interruptedRuns) {
           void workbenchClient.runs.list().then((rows) => setRuns(rows.map(toRunRow))).catch(() => undefined);
         }
         const currentPath = activePathRef.current;
        const currentScope = conversationScopeFromPath(currentPath);
        const isSessionEntry = /^\/dashboard\/(?:ai|writer|image-assistant)(?:$|\?)/u.test(currentPath);
        const latestConversation = conversationIdFromPath(currentPath)
          ? undefined
          : isSessionEntry
            ? recent.find((conversation) => (conversation.agentId ?? null) === currentScope)
            : recent[0];
         if (latestConversation) {
           setActiveConversationId(latestConversation.id);
           activeConversationRef.current = latestConversation.id;
           void loadConversationMessages(latestConversation.id).then(({ messages: loadedMessages }) => {
             const mergedMessages = mergeConversationMessages(conversationMessagesRef.current, loadedMessages, latestConversation.id);
             updateConversationMessages(mergedMessages);
             const latestUser = [...mergedMessages].reverse().find((message) => message.role === "user");
             const latestAssistant = [...mergedMessages].reverse().find((message) => message.role === "assistant");
             if (latestUser) { setActivePrompt(latestUser.content); setActivePromptAt(latestUser.createdAt); }
             if (latestAssistant) { setAssistantText(latestAssistant.content); setAssistantAt(latestAssistant.createdAt); }
           }).catch(() => undefined);
         }
          setRuntimeStatus(locale === "zh" ? "工作区已就绪" : "Workspace ready");
          } catch (error) {
            setRunStatus(locale === "zh" ? `后台数据加载失败：${error instanceof Error ? error.message : String(error)}` : `Background data loading failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        };
         if (!state.integrity) { setRuntimePhase("error"); setRuntimeStatus("本地数据库需要修复"); return; }
         setRuntimePhase("runtime");
         setRuntimeStatus(locale === "zh" ? "正在检查运行时清单与本地组件…" : "Checking the runtime manifest and local components…");
        const runtime = await tauriBridge.invoke<RuntimeProbe>("runtime_probe");
         setRuntimeStatus(locale === "zh" ? "正在验证 Node、OpenCode、Python 与本地索引依赖…" : "Verifying Node, OpenCode, Python, and local index dependencies…");
         if (migratedStored) {
           const selectedRuntime = { ...migratedStored.runtime, ...(runtime.paths?.node ? { nodePath: runtime.paths.node } : {}), ...(runtime.paths?.opencode ? { opencodePath: runtime.paths.opencode } : {}), ...(runtime.paths?.python ? { pythonPath: runtime.paths.python } : {}), ...(runtime.paths?.host ? { hostPath: runtime.paths.host } : {}), ...(runtime.paths?.skills ? { skillsPath: runtime.paths.skills } : {}), ...(runtime.paths?.fonts ? { fontsPath: runtime.paths.fonts } : {}), ...(runtime.paths?.lancedb ? { lancedbPath: runtime.paths.lancedb } : {}), ...(runtime.paths?.embedding ? { embeddingPath: runtime.paths.embedding } : {}) };
           const runtimeChanged = selectedRuntime.nodePath !== migratedStored.runtime.nodePath || selectedRuntime.opencodePath !== migratedStored.runtime.opencodePath || selectedRuntime.pythonPath !== migratedStored.runtime.pythonPath || selectedRuntime.hostPath !== migratedStored.runtime.hostPath || selectedRuntime.skillsPath !== migratedStored.runtime.skillsPath || selectedRuntime.fontsPath !== migratedStored.runtime.fontsPath || selectedRuntime.lancedbPath !== migratedStored.runtime.lancedbPath || selectedRuntime.embeddingPath !== migratedStored.runtime.embeddingPath;
           if (runtimeChanged) {
             activeConfig = { ...activeConfig!, runtime: selectedRuntime };
             configRef.current = activeConfig;
             setConfig(activeConfig);
             void tauriBridge.invoke("write_config", { value: activeConfig }).catch(() => undefined);
           }
         }
        const imageRuntimeReady = canRunImageWorkflow(runtime);
        if (shouldRepairRuntime(runtime) && !imageRuntimeReady) {
          setRuntimePhase("repair");
          setRuntimeStatus(locale === "zh" ? "检测到运行环境缺失，正在准备运行环境…" : "Required runtime is missing; preparing the local runtime…");
          // Runtime repair may download or extract large components. Do not
          // hold the entire workbench behind that long-running operation.
          setShellReady(true);
          let repairPromise = runtimeRepairInFlightRef.current;
          if (!repairPromise) {
            repairPromise = tauriBridge.invoke("repair_runtime", runtimeRepairOptions(activeConfig));
            runtimeRepairInFlightRef.current = repairPromise;
            void repairPromise.then(() => {
              if (runtimeRepairInFlightRef.current === repairPromise) runtimeRepairInFlightRef.current = null;
            }, () => {
              if (runtimeRepairInFlightRef.current === repairPromise) runtimeRepairInFlightRef.current = null;
            });
          }
          await repairPromise;
          const repaired = await tauriBridge.invoke<RuntimeProbe>("runtime_probe");
          const repairFailure = runtimeRepairFailure(repaired);
          if (repairFailure) throw repairFailure;
        }
        if (!runtime.ready && imageRuntimeReady) {
          setRuntimeStatus(locale === "zh" ? "运行环境就绪（生图可用，其余组件可稍后准备）" : "Runtime ready for image generation (other components may finish later)");
        } else if (!runtime.ready && runtime.development) {
          setRuntimeStatus(locale === "zh" ? "开发运行环境就绪（使用本机组件）" : "Development runtime ready (using local components)");
        }
        setRuntimeStatus(health.status === "ok"
          ? (imageRuntimeReady && !runtime.ready ? (locale === "zh" ? "运行环境就绪（生图可用，其余组件可稍后准备）" : "Runtime ready for image generation (other components may finish later)") : (locale === "zh" ? "运行环境就绪" : "Runtime ready"))
          : (locale === "zh" ? "运行环境需要修复" : "Runtime needs repair"));
        setRuntimePhase("ready");
        setRuntimeReady(runtime.ready);
        setShellReady(true);
        // Defer non-essential collections until after the first interactive
        // paint. The shell and runtime controls must not wait for old history.
        window.setTimeout(() => { void hydrateWorkbench(); }, 0);
        // The local host and Obsidian indexer are available even
        // when no remote API endpoint is configured; only provider-backed
        // media/text execution should be gated by provider configuration.
          if (activeConfig) {
            // Host startup and knowledge indexing are non-critical
           // hydration work. Start them after the shell is usable instead of
           // extending the critical launch path.
           void (async () => {
             try {
            await tauriBridge.invoke("host_start");
            if (activeConfig.obsidianVaultPath && activeConfig.obsidianIndexPath) {
              void workbenchClient.knowledge.index({ vaultPath: activeConfig.obsidianVaultPath, indexPath: activeConfig.obsidianIndexPath, embedding: embeddingPayload(activeConfig) }).catch(() => undefined);
            }
            } catch (error) {
              setRunStatus(locale === "zh" ? `本地服务初始化失败：${error instanceof Error ? error.message : String(error)}` : `Local service initialization failed: ${error instanceof Error ? error.message : String(error)}`);
            }
           })();
         }
      } catch (error) {
        const preview = error instanceof Error && error.message === "tauri_bridge_unavailable";
        setRuntimePhase(preview ? "ready" : "error");
        setRuntimeStatus(preview ? "浏览器预览模式 · Tauri 未连接" : `运行环境修复失败：${error instanceof Error ? error.message : String(error)}`);
        // Runtime repair is non-critical for rendering the shell. Keep the
        // workbench visible so users can inspect settings and retry repair
        // instead of being trapped on a blank/bootstrap-only window.
        setShellReady(true);
        setRuntimeReady(preview);
      }
    })();
    let listenersDisposed = false;
    let dispose: (() => void) | undefined;
    let disposeRuntimeLog: (() => void) | undefined;
    let disposeRuntimeProgress: (() => void) | undefined;
    const sequences = new Map<string, number>();
    const assistantBuffers = new Map<string, string>();
    void tauriBridge.listen<{ message: string }>("desktop://runtime-progress", (payload) => {
      setRuntimePhase("repair");
      setRuntimeStatus(localizeRuntimeProgress(payload.message, locale));
    }).then((unlisten) => {
      if (listenersDisposed) unlisten();
      else disposeRuntimeProgress = unlisten;
    }).catch(() => undefined);
    const markRunInterrupted = (runId: string, detail: string) => {
      const workflowKey = workflowRunKeysRef.current.get(runId);
      const isWorkflowRun = Boolean(workflowKey);
      const conversationId = runConversationIdsRef.current.get(runId);
      const visible = desktopRunIsVisible(runContextsRef.current.get(runId), activePathRef.current, activeConversationRef.current, workflowCanvasKeyRef.current);
      const createdAt = new Date().toISOString();
      if (activeRunRef.current === runId) activeRunRef.current = null;
      if (isWorkflowRun && workflowKey) {
        updateWorkflowTracking(workflowKey, (current) => ({ ...current, status: detail, snapshots: finalizeWorkflowNodeSnapshots(current.snapshots, "failed") }));
        removeWorkflowTracking(workflowKey);
        if (visible) setWorkflowRunStatus(detail);
      } else if (visible) {
        setActiveRunId(null);
        setRunStatus(detail);
      }
      setRuns((current) => current.map((run) => run.id === runId ? { ...run, status: "interrupted", finished_at: createdAt } : run));
      if (conversationId && !isWorkflowRun) {
        const content = locale === "zh" ? `本地 Agent 未能完成这次请求：${detail}` : `The local Agent could not complete this request: ${detail}`;
        const parts: DesktopUIMessagePart[] = [...(assistantPartsRef.current.get(runId) ?? []).map((part) => part.type === "reasoning" ? { ...part, state: "done" as const } : part), { type: "data-status", id: `${runId}:status:interrupted`, data: { status: "failed" as const, message: detail } }];
        const assistantMessage: DesktopConversationMessage = { id: `assistant-${runId}`, conversationId, role: "assistant", content, createdAt, status: "failed", parts };
        if (visible) updateConversationMessages((current) => [...current.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
        else updateCachedConversationMessages(conversationId, (messages) => [...messages.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
        void tauriBridge.invoke("append_message", { input: { id: `assistant-${runId}`, conversation_id: conversationId, role: "assistant", content, parts_json: JSON.stringify(parts), created_at: createdAt } }).catch(() => undefined);
        if (activeRunsByConversationRef.current.get(conversationId) === runId) activeRunsByConversationRef.current.delete(conversationId);
      }
      runConversationIdsRef.current.delete(runId);
      standaloneMediaRunsRef.current.delete(runId);
      runContextsRef.current.delete(runId);
      void tauriBridge.invoke("finish_run", { runId, status: "interrupted" });
    };
    void tauriBridge.listen<{ raw: string }>("desktop://runtime-log", (payload) => {
      if (!payload.raw.includes("workflow_host_exit")) return;
      const hostExitResponse = { version: 1, ok: false, error: { code: "workflow_host_exit", message: "OpenCode host exited before responding" } };
      for (const waiter of [...responseWaiters.current.values()]) waiter(hostExitResponse);
      responseWaiters.current.clear();
      questionSessionRestoreInFlightRef.current.clear();
      setAvailableQuestionSessionIds(new Set());
      void tauriBridge.invoke("host_start").catch((error) => {
        setRunStatus(locale === "zh" ? `本地 Agent 重启失败：${error instanceof Error ? error.message : String(error)}` : `Local Agent restart failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      const detail = locale === "zh"
        ? "本地 Agent 异常退出，当前请求未完成。请重试或检查运行日志。"
        : "The local Agent exited unexpectedly before completing this request. Retry or inspect the runtime logs.";
      const runIds = new Set([...runContextsRef.current.keys(), ...runConversationIdsRef.current.keys()]);
      runIds.forEach((runId) => markRunInterrupted(runId, detail));
    }).then((unlisten) => {
      if (listenersDisposed) unlisten();
      else disposeRuntimeLog = unlisten;
    }).catch(() => undefined);
    void tauriBridge.listen<{ raw: string }>("desktop://runtime-response", (payload) => {
      try {
        const separator = payload.raw.indexOf(":");
        const frame = JSON.parse(payload.raw.slice(separator + 1)) as { requestId?: string; ok?: boolean; data?: { sessionId?: string; event?: { event?: string; provider?: string; model?: string; delta?: string; runId?: string; inputTokens?: number; outputTokens?: number; costUsd?: number; code?: string; message?: string; permissionId?: string; sessionId?: string; callId?: string; toolName?: string; input?: unknown; response?: string; artifact?: unknown } } };
        if (frame.requestId) responseWaiters.current.get(frame.requestId)?.(frame as unknown as Record<string, unknown>);
        if (frame.requestId && frame.data?.sessionId) {
          const sessionMarker = ":session:";
          const sessionMarkerIndex = frame.requestId.indexOf(sessionMarker);
          const conversationId = sessionMarkerIndex > 0 ? frame.requestId.slice(0, sessionMarkerIndex) : "";
          if (conversationId) {
            void tauriBridge.invoke("set_conversation_session", { conversationId, sessionId: frame.data.sessionId });
            setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, opencode_session_id: frame.data?.sessionId } : item));
          }
        }
        const event = frame.data?.event;
        const eventConversationId = event?.runId ? runConversationIdsRef.current.get(event.runId) : undefined;
        const runContext = event?.runId ? runContextsRef.current.get(event.runId) : undefined;
        const isVisibleRoute = Boolean(event?.runId && desktopRunIsVisible(runContext, activePathRef.current, activeConversationRef.current, workflowCanvasKeyRef.current));
        const currentMediaRunId = new URLSearchParams(activePathRef.current.split("?", 2)[1] ?? "").get("runId") ?? activeRunRef.current;
        const isDisplayedRun = runContext?.kind === "conversation"
          ? Boolean(event?.runId && eventConversationId && activeRunsByConversationRef.current.get(eventConversationId) === event.runId)
          : runContext?.kind === "workflow"
            ? Boolean(event?.runId && runContext.workflowKey && workflowRunsRef.current.get(runContext.workflowKey)?.runId === event.runId)
            : runContext?.kind === "media"
              ? currentMediaRunId === event?.runId
              : false;
        const isVisibleEvent = isVisibleRoute && isDisplayedRun;
        const eventType = event?.event ?? "unknown";
        const sequence = event?.runId ? (sequences.get(event.runId) ?? 0) + 1 : undefined;
        if (event?.runId && sequence !== undefined) sequences.set(event.runId, sequence);
        if (event?.event === "text_delta" && typeof event.delta === "string" && event.delta.length > 0) {
          const runId = event.runId ?? "active";
          const content = `${assistantBuffers.get(runId) ?? ""}${event.delta}`;
          assistantBuffers.set(runId, content);
          const createdAt = assistantCreatedAtRef.current.get(runId) ?? new Date().toISOString();
          assistantCreatedAtRef.current.set(runId, createdAt);
          const existing = assistantPartsRef.current.get(runId) ?? [];
          assistantPartsRef.current.set(runId, applyWorkbenchRunEventToParts(existing, { type: "text", delta: event.delta, sequence, createdAt }));
          if (isVisibleEvent) {
            setAssistantAt(createdAt);
            setAssistantText(content);
          }
        }
        if (event?.event === "reasoning_delta" && typeof event.delta === "string" && event.delta.length > 0) {
          const runId = event.runId ?? "active";
          const existing = assistantPartsRef.current.get(runId) ?? [];
          const createdAt = assistantCreatedAtRef.current.get(runId) ?? new Date().toISOString();
          assistantCreatedAtRef.current.set(runId, createdAt);
          if (isVisibleEvent) setAssistantAt(createdAt);
          assistantPartsRef.current.set(runId, applyWorkbenchRunEventToParts(existing, { type: "reasoning", delta: event.delta, sequence, createdAt }));
          if (isVisibleEvent) setRunStatus(locale === "zh" ? "正在分析请求…" : "Analyzing the request…");
        }
        if (event?.event === "runtime_warning" && event.runId) {
          const runId = event.runId;
          const existing = assistantPartsRef.current.get(runId) ?? [];
          const warningPart: Extract<DesktopUIMessagePart, { type: "data-warning" }> = {
            type: "data-warning",
            id: `${runId}:warning:${event.code ?? "runtime_warning"}:${sequences.get(runId) ?? 0}`,
            data: { code: String(event.code ?? "runtime_warning"), message: event.message ?? (locale === "zh" ? "运行时提示" : "Runtime warning") },
          };
          assistantPartsRef.current.set(runId, [...existing, warningPart]);
          if (isVisibleEvent) setRunStatus(warningPart.data.message);
        }
        if (event?.runId) {
          void tauriBridge.invoke("append_run_event", { runId: event.runId, sequence: sequence ?? 0, eventType, payloadJson: JSON.stringify(event) });
          if (isWorkbenchQuestionToolEvent(event)) return;
          if (eventType === "permission_request" || eventType === "permission_response") {
            const parts = assistantPartsRef.current.get(event.runId) ?? [];
            const response = event.response === "reject" ? "failed" : "started";
            assistantPartsRef.current.set(event.runId, applyWorkbenchRunEventToParts(parts, {
              type: "tool_call",
              toolName: event.toolName ?? "permission",
              toolCallId: event.callId ?? event.permissionId ?? "permission",
              phase: eventType === "permission_request" ? "blocked" : response,
              input: event.input,
              error: eventType === "permission_response" && event.response === "reject" ? "Permission rejected" : undefined,
              approvalId: event.permissionId,
              sessionId: event.sessionId,
              sequence,
              createdAt: new Date().toISOString(),
            }));
            if (isVisibleEvent) setRunStatus(locale === "zh" ? (eventType === "permission_request" ? "工具调用等待审批" : event.response === "reject" ? "已拒绝工具调用" : "已批准工具调用，继续执行…") : (eventType === "permission_request" ? "Tool call awaiting approval" : event.response === "reject" ? "Tool call rejected" : "Tool approved; continuing…"));
          }
          if (eventType === "usage") {
            const provider = event.provider ?? configRef.current.provider.id;
            const model = event.model?.trim() || runModelsRef.current.get(event.runId) || configRef.current.provider.model || "unknown";
            const createdAt = new Date().toISOString();
            const parts = assistantPartsRef.current.get(event.runId) ?? [];
            assistantPartsRef.current.set(event.runId, applyWorkbenchRunEventToParts(parts, { type: "usage", usage: { runId: event.runId, provider, model, inputTokens: event.inputTokens, outputTokens: event.outputTokens, providerCost: event.costUsd }, sequence, createdAt }));
            setTokenCount((current) => current + (event.inputTokens ?? 0) + (event.outputTokens ?? 0));
            const costUsd = event.costUsd;
            if (typeof costUsd === "number") setProviderCost((current) => (current ?? 0) + costUsd);
            void tauriBridge.invoke("record_usage", { runId: event.runId, provider: provider ?? null, model, inputTokens: event.inputTokens ?? null, outputTokens: event.outputTokens ?? null, providerCost: event.costUsd ?? null, estimatedCost: null, idempotencyKey: `${event.runId}:usage:${sequence}` });
          }
          if (eventType === "tool_event") {
            const toolEvent = event as { tool?: string; message?: string; phase?: string; toolCallId?: string; callId?: string };
            const tool = typeof toolEvent.tool === "string" ? toolEvent.tool : "tool";
            const detail = typeof toolEvent.message === "string" ? toolEvent.message : "";
            if (isVisibleEvent) setToolEvents((current) => [...current, `${tool}${detail ? ` · ${detail.slice(0, 180)}` : ""}`].slice(-6));
            const phase = toolEvent.phase;
            const status = phase === "failed" ? "failed" : phase === "completed" ? "completed" : "running";
            const parts = assistantPartsRef.current.get(event.runId) ?? [];
            let messageCallId: string | undefined;
            try {
              const metadata = JSON.parse(detail) as Record<string, unknown>;
              for (const key of ["toolCallId", "callId", "idempotencyKey", "nodeKey"]) {
                if (typeof metadata[key] === "string" && metadata[key].trim()) {
                  messageCallId = metadata[key];
                  break;
                }
              }
            } catch { /* tool details are not required to be JSON */ }
            const toolCallId = typeof toolEvent.toolCallId === "string" ? toolEvent.toolCallId : typeof toolEvent.callId === "string" ? toolEvent.callId : messageCallId ?? tool;
            const toolCallCreatedAt = new Date().toISOString();
            assistantPartsRef.current.set(event.runId, applyWorkbenchRunEventToParts(parts, {
              type: "tool_call",
              toolName: tool,
              toolCallId,
              phase: status === "running" ? "started" : status,
              input: (() => {
                try { const parsed = JSON.parse(detail) as Record<string, unknown>; return parsed.args ?? parsed.input; } catch { return undefined; }
              })(),
              output: (() => {
                try { const parsed = JSON.parse(detail) as Record<string, unknown>; return parsed.result ?? parsed.output; } catch { return undefined; }
              })(),
              error: status === "failed" ? detail || undefined : undefined,
              sequence,
              createdAt: toolCallCreatedAt,
            }));
          }
          const eventTool = typeof (event as { tool?: string }).tool === "string" ? (event as { tool: string }).tool : "";
          const isLegacyArtifactEvent = eventType === "tool_event" && eventTool.startsWith("artifact:");
          const isArtifactEvent = eventType === "artifact" && Boolean((event as { artifact?: unknown }).artifact && typeof (event as { artifact?: unknown }).artifact === "object");
          if (isLegacyArtifactEvent || isArtifactEvent) setArtifactCount((current) => current + 1);
          if (isLegacyArtifactEvent || isArtifactEvent) {
            try {
              const artifact = isArtifactEvent
                ? (event as { artifact: Record<string, unknown> }).artifact
                : JSON.parse((event as { message?: string }).message ?? "{}");
              const relativePath = typeof artifact.relativePath === "string" ? artifact.relativePath : "";
              if (relativePath) {
                const artifactRunId = event.runId!;
                const artifactRelativePath: string = relativePath;
                const extension = artifactRelativePath.toLowerCase().split(".").pop() ?? "bin";
                const mimeType = extension === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : extension === "svg" ? "image/svg+xml" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav" : extension === "mp4" ? "video/mp4" : extension === "webm" ? "video/webm" : extension === "md" ? "text/markdown" : "application/octet-stream";
                const artifactId = `${artifactRunId}:${artifactRelativePath}`;
                const artifactPartId = `${artifactRunId}:artifact:${artifactRelativePath}`;
                const createdAt = new Date().toISOString();
                const parts = assistantPartsRef.current.get(event.runId) ?? [];
                const artifactPart: Extract<DesktopUIMessagePart, { type: "data-artifact" }> = {
                  type: "data-artifact",
                  id: artifactPartId,
                  data: { id: artifactId, title: artifactRelativePath.split("/").pop() || artifactRelativePath, relativePath: artifactRelativePath, mimeType, byteLength: typeof artifact.bytes === "number" ? artifact.bytes : 0, sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : "", createdAt },
                };
                assistantPartsRef.current.set(artifactRunId, [...parts.filter((part) => !("id" in part) || part.id !== artifactPartId), artifactPart]);
                void tauriBridge.invoke<{ relative_path: string; mime_type: string; byte_length: number; sha256: string }>("register_artifact", { artifactId, projectId: null, relativePath: artifactRelativePath, mimeType }).then((metadata) => {
                  setArtifactRows((current) => [...current.filter((item) => item.id !== artifactId), { id: artifactId, relative_path: metadata.relative_path, mime_type: metadata.mime_type, byte_length: metadata.byte_length, sha256: metadata.sha256, created_at: new Date().toISOString(), available: true }]);
                  const currentParts = assistantPartsRef.current.get(artifactRunId) ?? [];
                  const registeredPart: Extract<DesktopUIMessagePart, { type: "data-artifact" }> = {
                    ...artifactPart,
                    data: { id: artifactId, title: artifactRelativePath.split("/").pop() || artifactRelativePath, relativePath: metadata.relative_path, mimeType: metadata.mime_type, byteLength: metadata.byte_length, sha256: metadata.sha256, createdAt },
                  };
                  assistantPartsRef.current.set(artifactRunId, [...currentParts.filter((part) => !("id" in part) || part.id !== artifactPartId), registeredPart]);
                  setArtifactCount((current) => Math.max(current, 1));
                }).catch(() => undefined);
              }
            } catch { /* malformed artifact metadata remains in run_events */ }
          }
          const tool = eventTool;
          const workflowKey = event.runId ? workflowRunKeysRef.current.get(event.runId) : undefined;
          if (workflowKey && tool.startsWith("workflow:node_")) {
            const message = typeof (event as { message?: string }).message === "string" ? (event as { message: string }).message : "";
            updateWorkflowTracking(workflowKey, (current) => ({ ...current, snapshots: applyWorkflowNodeEvent(current.snapshots, tool, message) }));
          }
          if (tool.startsWith("workflow:node_")) {
            try {
              const payload = JSON.parse((event as { message?: string }).message ?? "{}");
              const nodeStatus = tool.endsWith("node_started") ? "running" : tool.endsWith("node_failed") ? "failed" : "succeeded";
              const nodeKey = typeof payload.nodeKey === "string" ? payload.nodeKey : "";
              const checkpointKey = typeof payload.checkpointKey === "string" ? payload.checkpointKey : nodeKey;
              const persistedNodePayload = nodeStatus === "succeeded" && payload.output && typeof payload.output === "object"
                ? payload.output
                : nodeStatus === "failed" && typeof payload.message === "string"
                  ? { error: payload.message }
                  : undefined;
              const outputJson = persistedNodePayload ? JSON.stringify(persistedNodePayload) : null;
              if (nodeStatus === "succeeded" && workflowOutputNodeKeysRef.current.get(event.runId)?.has(nodeKey) && payload.output && typeof payload.output.text === "string") workflowOutputsRef.current.set(event.runId, payload.output.text);
              if (nodeKey) void tauriBridge.invoke("record_run_node", { runId: event.runId, nodeKey, status: nodeStatus, outputJson });
              if (nodeStatus === "succeeded" && checkpointKey && outputJson) void tauriBridge.invoke("record_run_checkpoint", { runId: event.runId, checkpointKey, sequence, outputJson });
            } catch { /* event remains in run_events */ }
          }
          if (tool.startsWith("media:")) {
            try {
              const payload = JSON.parse((event as { message?: string }).message ?? "{}");
              const executorId = typeof payload.executorId === "string" ? payload.executorId : tool.slice("media:".length);
              const nodeKey = typeof payload.nodeKey === "string" ? payload.nodeKey : executorId;
              const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : `${event.runId}:${nodeKey}:1`;
              const status = payload.status === "succeeded" || payload.status === "failed" || payload.status === "cancelled" || payload.status === "download_failed" ? payload.status : payload.providerTaskId ? "submitted" : "running";
               void tauriBridge.invoke("record_run_attempt", { idempotencyKey, runId: event.runId, nodeKey, provider: payload.provider ?? null, providerTaskId: payload.providerTaskId ?? null, status, payloadJson: JSON.stringify({ ...payload, executorId, nodeKey }) });
              const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
              if (status === "succeeded") void tauriBridge.invoke("record_usage", {
                runId: event.runId,
                provider: payload.provider ?? null,
                model: `${payload.provider ?? "media"}/${payload.model ?? "unknown"}`,
                inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : null,
                outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : null,
                providerCost: typeof usage.providerCost === "number" ? usage.providerCost : null,
                estimatedCost: typeof usage.estimatedCost === "number" ? usage.estimatedCost : null,
                idempotencyKey: `${event.runId}:${nodeKey}:media-usage`,
              });
            } catch { /* event remains in run_events */ }
          }
          if (eventType === "done") {
            const conversationId = runConversationIdsRef.current.get(event.runId);
            const workflowKey = workflowRunKeysRef.current.get(event.runId);
            const isWorkflowEvent = Boolean(workflowKey);
            if (conversationId && activeRunsByConversationRef.current.get(conversationId) === event.runId) activeRunsByConversationRef.current.delete(conversationId);
            const wasActiveRun = activeRunRef.current === event.runId;
            if (wasActiveRun) activeRunRef.current = null;
            if (isVisibleEvent) setActiveRunId(conversationId ? activeRunsByConversationRef.current.get(conversationId) ?? null : null);
            if (isWorkflowEvent && workflowKey) updateWorkflowTracking(workflowKey, (current) => ({ ...current, status: locale === "zh" ? "工作流已完成" : "Workflow completed", snapshots: finalizeWorkflowNodeSnapshots(current.snapshots, "succeeded") }));
            setTaskCount((current) => current + 1);
            if (isVisibleEvent && activePathRef.current === "/dashboard/workflows") {
              const output = (workflowOutputsRef.current.get(event.runId) ?? "").trim();
              setRunStatus(locale === "zh" ? `工作流已完成，本地结果已写入结果预览${output ? `：\n${output}` : ""}` : `Workflow completed; the local result is available in the result preview${output ? `:\n${output}` : ""}`);
            }
            setRuns((current) => current.map((run) => run.id === event.runId ? { ...run, status: "succeeded", finished_at: new Date().toISOString() } : run));
            if (isVisibleEvent && !isWorkflowEvent) setRunStatus(locale === "zh" ? "媒体任务已完成" : "Media task completed");
            const assistant = assistantBuffers.get(event.runId) ?? "";
            if (assistant && conversationId) {
              const createdAt = assistantCreatedAtRef.current.get(event.runId) ?? new Date().toISOString();
              const parts: DesktopUIMessagePart[] = [...(assistantPartsRef.current.get(event.runId) ?? []).filter((part) => !("id" in part) || part.id !== `${event.runId}:status`).map((part) => part.type === "reasoning" ? { ...part, state: "done" as const } : part), { type: "data-status", id: `${event.runId}:status`, data: { status: "completed" as const } }];
              const assistantMessage: DesktopConversationMessage = { id: `assistant-${event.runId}`, conversationId, role: "assistant", content: assistant, createdAt, status: "succeeded", parts };
              if (conversationId === activeConversationRef.current) updateConversationMessages((current) => [...current, assistantMessage]);
              else updateCachedConversationMessages(conversationId, (messages) => [...messages.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
              void tauriBridge.invoke("append_message", { input: { id: `assistant-${event.runId}`, conversation_id: conversationId, role: "assistant", content: assistant, parts_json: JSON.stringify(parts), created_at: createdAt } });
            } else if (conversationId) {
              const createdAt = new Date().toISOString();
              const content = locale === "zh" ? "任务已完成，但模型没有返回可展示的文本。请在任务中心查看运行事件。" : "The task completed, but the model returned no displayable text. Check Tasks for the run events.";
              const parts: DesktopUIMessagePart[] = [...(assistantPartsRef.current.get(event.runId) ?? []).filter((part) => !("id" in part) || part.id !== `${event.runId}:status`).map((part) => part.type === "reasoning" ? { ...part, state: "done" as const } : part), { type: "data-status", id: `${event.runId}:status`, data: { status: "completed" as const } }];
              const assistantMessage: DesktopConversationMessage = { id: `assistant-${event.runId}`, conversationId, role: "assistant", content, createdAt, status: "succeeded", parts };
              if (conversationId === activeConversationRef.current) updateConversationMessages((current) => [...current, assistantMessage]);
              else updateCachedConversationMessages(conversationId, (messages) => [...messages.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
              void tauriBridge.invoke("append_message", { input: { id: `assistant-${event.runId}`, conversation_id: conversationId, role: "assistant", content, parts_json: JSON.stringify(parts), created_at: createdAt } });
            }
            workflowOutputsRef.current.delete(event.runId);
            workflowOutputNodeKeysRef.current.delete(event.runId);
            assistantCreatedAtRef.current.delete(event.runId);
            assistantPartsRef.current.delete(event.runId);
            runModelsRef.current.delete(event.runId);
            runConversationIdsRef.current.delete(event.runId);
            standaloneMediaRunsRef.current.delete(event.runId);
            runContextsRef.current.delete(event.runId);
            void tauriBridge.invoke("finish_run", { runId: event.runId, status: "succeeded" });
            if (workflowKey) removeWorkflowTracking(workflowKey);
          }
          if (eventType === "runtime_error") {
            const conversationId = runConversationIdsRef.current.get(event.runId);
            const workflowKey = workflowRunKeysRef.current.get(event.runId);
            const isWorkflowEvent = Boolean(workflowKey);
            if (conversationId && activeRunsByConversationRef.current.get(conversationId) === event.runId) activeRunsByConversationRef.current.delete(conversationId);
            const wasActiveRun = activeRunRef.current === event.runId;
            if (wasActiveRun) activeRunRef.current = null;
            if (isVisibleEvent) setActiveRunId(conversationId ? activeRunsByConversationRef.current.get(conversationId) ?? null : null);
            const code = (event as { code?: string }).code;
            const status = code === "opencode_aborted" || code === "workflow_cancelled" || code === "media_cancelled" ? "cancelled" : "failed";
            const rawDetail = typeof (event as { message?: string }).message === "string" ? (event as { message: string }).message : (locale === "zh" ? "本地 Agent 未能完成这次请求。" : "The local Agent could not complete this request.");
            const detail = localizeDesktopStatus(rawDetail, locale);
            if (isWorkflowEvent && workflowKey) updateWorkflowTracking(workflowKey, (current) => ({ ...current, status: detail, snapshots: finalizeWorkflowNodeSnapshots(current.snapshots, status) }));
            setRuns((current) => current.map((run) => run.id === event.runId ? { ...run, status, finished_at: new Date().toISOString() } : run));
            if (isVisibleEvent) setRunStatus(detail);
            const currentAssistant = assistantBuffers.get(event.runId) ?? "";
            if (conversationId) {
              const createdAt = assistantCreatedAtRef.current.get(event.runId) ?? new Date().toISOString();
              const content = currentAssistant || (locale === "zh" ? `本地 Agent 未能完成这次请求：${detail}` : `The local Agent could not complete this request: ${detail}`);
              const parts: DesktopUIMessagePart[] = [...(assistantPartsRef.current.get(event.runId) ?? []).filter((part) => !("id" in part) || part.id !== `${event.runId}:status`).map((part) => part.type === "reasoning" ? { ...part, state: "done" as const } : part), { type: "data-status", id: `${event.runId}:status`, data: { status: status === "cancelled" ? "cancelled" as const : "failed" as const, message: detail } }];
              const assistantMessage: DesktopConversationMessage = { id: `assistant-${event.runId}`, conversationId, role: "assistant", content, createdAt, status, parts };
              if (conversationId === activeConversationRef.current) updateConversationMessages((current) => [...current.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
              else updateCachedConversationMessages(conversationId, (messages) => [...messages.filter((message) => message.id !== assistantMessage.id), assistantMessage]);
              void tauriBridge.invoke("append_message", { input: { id: `assistant-${event.runId}`, conversation_id: conversationId, role: "assistant", content, parts_json: JSON.stringify(parts), created_at: createdAt } });
            }
            workflowOutputsRef.current.delete(event.runId);
            workflowOutputNodeKeysRef.current.delete(event.runId);
            assistantCreatedAtRef.current.delete(event.runId);
            assistantPartsRef.current.delete(event.runId);
            runModelsRef.current.delete(event.runId);
            runConversationIdsRef.current.delete(event.runId);
            standaloneMediaRunsRef.current.delete(event.runId);
            runContextsRef.current.delete(event.runId);
            void tauriBridge.invoke("finish_run", { runId: event.runId, status });
            if (workflowKey) removeWorkflowTracking(workflowKey);
          }
        }
      } catch { /* malformed diagnostics stay in the host log */ }
    }).then((unlisten) => {
      if (listenersDisposed) unlisten();
      else dispose = unlisten;
    }).catch(() => undefined);
    return () => {
      listenersDisposed = true;
      dispose?.();
      disposeRuntimeLog?.();
      disposeRuntimeProgress?.();
    };
  }, [loadConversationMessages, updateCachedConversationMessages, workbenchClient]);

  useEffect(() => {
    if (!runtimeReady || !isTauriBridgeAvailable()) return;
    let disposed = false;
    const reconcileRuns = async () => {
      try {
        const latest = (await workbenchClient.runs.list()).map(toRunRow);
        if (disposed) return;
        const latestById = new Map(latest.map((run) => [run.id, run] as const));
        setRuns((current) => current.map((run) => latestById.get(run.id) ?? run));
        const activeRunId = activeRunRef.current;
        if (!activeRunId) return;
        const persisted = latestById.get(activeRunId);
        if (!persisted || isWorkbenchTaskActive(normalizeWorkbenchTaskStatus(persisted.status))) return;
        activeRunRef.current = null;
        activeRunsByConversationRef.current.delete(persisted.conversation_id ?? "");
        setActiveRunId((current) => current === activeRunId ? null : current);
      } catch {
        // The event stream remains authoritative while SQLite is briefly busy.
      }
    };
    void reconcileRuns();
    const interval = window.setInterval(() => { void reconcileRuns(); }, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [runtimeReady, workbenchClient]);

  async function saveSettings() {
    await persistSettingsConfig({ ...configRef.current, locale: localePreference }, true);
    if (activePath !== "/dashboard/settings") setSettingsOpen(false);
  }

  async function pickDirectory(kind: "workspace" | "vault") {
    try {
      const initialPath = kind === "workspace" ? config.workspacePath : config.obsidianVaultPath;
      setRunStatus(locale === "zh" ? "正在打开目录选择器…" : "Opening directory picker…");
      const selectedPath = await tauriBridge.invoke<string | null>("pick_directory", { initialPath });
      if (!selectedPath) { setRunStatus(locale === "zh" ? "未选择目录" : "No directory selected"); return; }
      const nextConfig = kind === "workspace"
        ? { ...configRef.current, workspacePath: selectedPath }
        : { ...configRef.current, obsidianVaultPath: selectedPath, obsidianIndexPath: configRef.current.obsidianIndexPath || `${selectedPath}\\.coworkany-index` };
      await persistSettingsConfig(nextConfig, true);
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "目录选择失败" : "Directory picker failed"));
    }
  }

  async function saveWriterDraft(content: string) {
    try {
      const metadata = await tauriBridge.invoke<{ relative_path: string; mime_type: string; byte_length: number; sha256: string }>("write_writer_draft", { content });
      const row = { id: `writer-draft:${metadata.relative_path}`, relative_path: metadata.relative_path, mime_type: metadata.mime_type, byte_length: metadata.byte_length, sha256: metadata.sha256, created_at: new Date().toISOString(), available: true };
      setArtifactRows((current) => [row, ...current.filter((item) => item.relative_path !== row.relative_path)]);
      setArtifactCount((current) => current + 1);
      setRunStatus(locale === "zh" ? `写作草稿已保存：${metadata.relative_path}` : `Writer draft saved: ${metadata.relative_path}`);
      return metadata;
    } catch (error) {
      setRunStatus(locale === "zh" ? `写作草稿保存失败：${error instanceof Error ? error.message : String(error)}` : `Writer draft save failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function exportWriterDraft(content: string): Promise<void> {
    const metadata = await saveWriterDraft(content);
    if (!metadata) return;
    setRunStatus(locale === "zh" ? `写作 Markdown 已导出：${metadata.relative_path}` : `Writer Markdown exported: ${metadata.relative_path}`);
    void workbenchClient.files.open(metadata.relative_path, metadata.mime_type).catch((error) => {
      setRunStatus(locale === "zh" ? `写作 Markdown 已保存，但打开失败：${error instanceof Error ? error.message : String(error)}` : `Writer Markdown saved, but opening failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async function prepareRunRetry(run: RunRow, options: { workflowOnly?: boolean } = {}) {
    const workflowOnly = options.workflowOnly === true;
    const setRetryStatus = workflowOnly ? setWorkflowRunStatus : setRunStatus;
    try {
      const detail = toRunDetail(await workbenchClient.runs.inspect(run.id));
      const started = detail.events.find((event) => event.event_type === "run_started");
      let startedPayload: Record<string, unknown> = {};
      try { startedPayload = started ? JSON.parse(started.payload_json) as Record<string, unknown> : {}; } catch { startedPayload = {}; }
      const definitionHash = typeof startedPayload.definitionHash === "string" ? startedPayload.definitionHash : "";
      const metadata = readDesktopTaskMetadata(detail);
      const saved = definitionHash
        ? (await workbenchClient.workflows.list()).find((workflow) => workflow.definition.definitionHash === definitionHash)
        : undefined;
      const currentDefinition = workflowOnly ? currentWorkflowDefinition() : undefined;
      const retryDefinition = saved?.definition ?? metadata?.workflowDefinition ?? currentDefinition;
      if (workflowOnly && retryDefinition) {
        const completed: Record<string, Record<string, unknown>> = {};
        for (const node of detail.nodes) {
          if (node.status !== "succeeded" || !node.output_json) continue;
          try {
            const output = JSON.parse(node.output_json);
            if (output && typeof output === "object" && !Array.isArray(output)) completed[node.node_key] = output as Record<string, unknown>;
          } catch { /* malformed checkpoints stay visible in evidence and are not reused */ }
        }
        const retryHash = retryDefinition.definitionHash;
        const canResumeExactVersion = Boolean(definitionHash && retryHash === definitionHash);
        setRetryStatus(locale === "zh"
          ? (canResumeExactVersion ? "已验证当前工作流版本，正在继续运行未完成节点…" : "正在当前工作流页面重新运行…")
          : (canResumeExactVersion ? "The current workflow version is verified; continuing unfinished nodes…" : "Rerunning the workflow from the current page…"));
        await runAgent(undefined, undefined, undefined, retryDefinition, canResumeExactVersion ? { completed, recoveryDefinitionHash: definitionHash } : undefined);
        return;
      }
      if (definitionHash) {
        if (saved) {
          const completed: Record<string, Record<string, unknown>> = {};
          for (const node of detail.nodes) {
            if (node.status !== "succeeded" || !node.output_json) continue;
            try {
              const output = JSON.parse(node.output_json);
              if (output && typeof output === "object" && !Array.isArray(output)) completed[node.node_key] = output as Record<string, unknown>;
            } catch { /* malformed checkpoints stay visible in evidence and are not reused */ }
          }
          setRetryStatus(locale === "zh" ? "已验证工作流版本，正在从成功节点准备安全重试…" : "Workflow version verified; preparing a safe retry from successful nodes…");
          await runAgent(locale === "zh" ? "重试失败或中断的工作流节点" : "Retry failed or interrupted workflow nodes", undefined, undefined, saved.definition, { completed, recoveryDefinitionHash: definitionHash });
          return;
        }
        setRetryStatus(locale === "zh" ? "工作流版本已不存在，无法安全重试；请先导入或保存同一版本" : "The original workflow version is unavailable; import or save the same version before retrying");
        return;
      }
      if (!run.conversation_id) { setRetryStatus(locale === "zh" ? "该任务没有关联会话，无法准备重试" : "This task has no conversation and cannot be retried"); return; }
      const history = await workbenchClient.conversations.messages(run.conversation_id);
      const latestUser = [...history].reverse().find((message) => message.role === "user");
      if (!latestUser) { setRetryStatus(locale === "zh" ? "未找到原始用户指令，无法准备重试" : "The original user instruction was not found"); return; }
      if (workflowOnly) {
        setRetryStatus(locale === "zh" ? "当前工作流缺少可恢复版本，请点击重新运行" : "The current workflow has no recoverable version; use Rerun instead");
        return;
      }
      setActiveConversationId(run.conversation_id);
      activeConversationRef.current = run.conversation_id;
      setPrompt(desktopUIMessageText(latestUser));
      setRetryStatus(locale === "zh" ? "已载入原始指令，确认后可重新发送" : "The original instruction is loaded; confirm to send again");
      navigate(`/dashboard/ai/${run.conversation_id}`);
    } catch (error) { setRetryStatus(error instanceof Error ? error.message : (locale === "zh" ? "重试准备失败" : "Unable to prepare retry")); }
  }

  async function rebuildVaultIndex() {
    if (!config.obsidianVaultPath || !config.obsidianIndexPath) { setRunStatus(locale === "zh" ? "请先填写 Obsidian Vault 和索引目录" : "Set the Obsidian Vault and index directory first"); return; }
    try {
      setRunStatus(locale === "zh" ? "正在构建 Obsidian 索引…" : "Building Obsidian index…");
      const data = await workbenchClient.knowledge.index({ vaultPath: config.obsidianVaultPath, indexPath: config.obsidianIndexPath, embedding: embeddingPayload(config) });
      setKnowledgeStatus(locale === "zh"
        ? `${data?.semantic ? "语义索引已就绪" : "词法索引已就绪，语义模型不可用"} · ${data?.documents ?? 0} 篇笔记 · ${data?.chunks ?? 0} 个片段${data?.embeddingModel ? ` · ${data.embeddingModel}` : ""}`
        : `${data?.semantic ? "Semantic index ready" : "Lexical index ready; semantic model unavailable"} · ${data?.documents ?? 0} notes · ${data?.chunks ?? 0} chunks${data?.embeddingModel ? ` · ${data.embeddingModel}` : ""}`);
      setRunStatus(data?.semantic ? (locale === "zh" ? "Obsidian 语义索引已完成" : "Obsidian semantic index complete") : (locale === "zh" ? "Obsidian 词法索引已完成，可继续检索" : "Obsidian lexical index complete; search is ready"));
    } catch (error) { setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "Obsidian 索引启动失败" : "Obsidian index failed")); }
  }

  async function sendHostMessage(message: Record<string, unknown>) {
    const requestId = String(message.requestId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const frame = { ...message, requestId };
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      responseWaiters.current.set(requestId, (value) => { responseWaiters.current.delete(requestId); resolve(value); });
    });
    try {
      await tauriBridge.invoke("host_send", { message: frame });
      const hostResponse = await response;
      if (hostResponse.ok === false) {
        const error = hostResponse.error && typeof hostResponse.error === "object" ? hostResponse.error as { message?: unknown } : undefined;
        throw new Error(typeof error?.message === "string" ? error.message : "OpenCode host request failed");
      }
      return hostResponse;
    } catch (error) {
      responseWaiters.current.delete(requestId);
      throw error;
    }
  }

  async function discoverProviderModels(provider: Pick<DesktopProviderConfig, "source" | "id" | "baseUrl" | "apiKey">, capability: ProviderCapability) {
    // Settings can be opened before the non-critical startup hydration has
    // finished. Ensure the host exists before sending the discovery frame.
    await tauriBridge.invoke("host_start");
    const response = await sendHostMessage({ version: 1, type: "provider.models", payload: { provider, capability } });
    const data = response.data && typeof response.data === "object" ? response.data as { models?: unknown } : {};
    if (!Array.isArray(data.models) || !data.models.every((model) => typeof model === "string")) throw new Error(locale === "zh" ? "Provider 返回的模型列表格式无效" : "The Provider returned an invalid model list");
    return data.models as readonly string[];
  }

  async function respondToPermission(permissionId: string, decision: "approve" | "reject") {
    const normalizedPermissionId = permissionId.replace(/^approval:/u, "").trim();
    const conversationId = conversationIdFromPath(activePathRef.current) ?? activeConversationRef.current;
    const sessionId = conversationsRef.current.find((conversation) => conversation.id === conversationId)?.opencode_session_id ?? "";
    if (!normalizedPermissionId || !sessionId) {
      setRunStatus(locale === "zh" ? "审批请求已失效，请重新运行 Agent" : "This approval request is no longer available; rerun the Agent");
      return;
    }
    try {
      await sendHostMessage({ version: 1, type: "permission.respond", sessionId, payload: { sessionId, permissionId: normalizedPermissionId, response: decision === "approve" ? "once" : "reject" } });
      setRunStatus(locale === "zh" ? (decision === "approve" ? "已批准工具调用，继续执行…" : "已拒绝工具调用") : (decision === "approve" ? "Tool approved; continuing…" : "Tool call rejected"));
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "审批响应失败" : "Unable to respond to the approval request"));
    }
  }

  async function respondToToolApproval(_message: DesktopUIMessage, part: Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>, decision: "approve" | "reject") {
    await respondToPermission(part.approval?.id ?? "", decision);
  }

  useEffect(() => {
    const onApproval = (event: Event) => {
      const detail = (event as CustomEvent<{ approvalId?: unknown; decision?: unknown }>).detail;
      if (typeof detail?.approvalId !== "string" || !["approve", "reject"].includes(String(detail.decision))) return;
      void respondToPermission(detail.approvalId, detail.decision as "approve" | "reject");
    };
    window.addEventListener("coworkany:tool-approval", onApproval);
    return () => window.removeEventListener("coworkany:tool-approval", onApproval);
  }, [locale]);

  async function loadDesktopVoices() {
    const audioProvider = providerForCapability(config, "audio");
    const response = await sendHostMessage({
      version: 1,
      type: "media.voices",
      payload: { provider: audioProvider, media: audioProvider, providers: config.providers, voiceType: "all" },
    });
    if (response.ok !== true) {
      const error = response.error && typeof response.error === "object" ? response.error as { message?: unknown } : undefined;
      throw new Error(typeof error?.message === "string" ? error.message : (locale === "zh" ? "音色加载失败" : "Unable to load voices"));
    }
    const data = response.data && typeof response.data === "object" ? response.data as { voices?: unknown } : {};
    if (!Array.isArray(data.voices)) return [];
    return data.voices.filter((value): value is MiniMaxVoiceOption => {
      if (!value || typeof value !== "object") return false;
      const record = value as Record<string, unknown>;
      return typeof record.voiceId === "string" && typeof record.voiceName === "string" && (record.category === "system" || record.category === "voice_cloning" || record.category === "voice_generation");
    });
  }
  desktopVoiceLoader = loadDesktopVoices;

  async function searchKnowledge() {
    const query = knowledgeQuery.trim();
    if (!query) return;
    if (!config.obsidianIndexPath) { setKnowledgeStatus(locale === "zh" ? "请先在设置中配置 Obsidian Vault 索引目录" : "Configure the Obsidian Vault index directory first"); return; }
    setKnowledgeStatus(locale === "zh" ? "正在检索本地 Vault…" : "Searching the local Vault…");
    try {
      const results = await workbenchClient.knowledge.search({ indexPath: config.obsidianIndexPath, query, limit: 8, embedding: embeddingPayload(config) });
      setKnowledgeResults([...results]);
      setKnowledgeStatus(results.length ? (locale === "zh" ? `找到 ${results.length} 条本地引用` : `${results.length} local references found`) : (locale === "zh" ? "没有匹配的本地笔记" : "No matching local notes"));
    } catch (error) { setKnowledgeResults([]); setKnowledgeStatus(error instanceof Error ? error.message : (locale === "zh" ? "本地知识检索失败" : "Local knowledge search failed")); }
  }

  async function saveCurrentWorkflow(mode: "manual" | "auto" = "manual", definitionOverride?: WorkflowDefinitionEnvelope): Promise<boolean> {
    const definition = sanitizeWorkflowDefinitionForStorage(definitionOverride ? currentWorkflowDefinition(definitionOverride) : currentWorkflowDefinition());
    const definitionHash = hashWorkflowDefinition(definition);
    const action = workflowActions.find((item) => item.id === definition.nodes.find((node) => node.nodeKey !== "input" && node.type !== "output")?.type) ?? workflowActions[0];
    const workflowId = currentWorkflowIdRef.current ?? (globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}`);
    const inputNode = definition.nodes.find((node) => node.nodeKey === "input");
    const inputText = typeof inputNode?.config.text === "string" ? inputNode.config.text.trim() : "";
    const generatedTitle = `${locale === "en" ? workflowActionEnglish[action.id] ?? action.label : action.label} · ${inputText.slice(0, 24) || (locale === "en" ? "Untitled" : "未命名")}`;
    const title = workflowMetadata.title.trim() || generatedTitle;
    const presentationHash = hashWorkflowPresentation(definition, title);
    if (savedWorkflowHashRef.current === definitionHash && savedWorkflowPresentationHashRef.current === presentationHash) {
      if (mode === "manual") setRunStatus(locale === "zh" ? "工作流已是最新版本" : "Workflow is already up to date");
      return true;
    }
    if (workflowSaveInFlightRef.current) {
      if (mode === "auto") workflowAutoSavePendingRef.current = true;
      return false;
    }
    workflowSaveInFlightRef.current = true;
    try {
      const saved = toSavedWorkflow(await workbenchClient.workflows.save({ id: workflowId, title, definition }));
      currentWorkflowIdRef.current = saved.id;
      savedWorkflowHashRef.current = definitionHash;
      savedWorkflowPresentationHashRef.current = presentationHash;
      setSavedWorkflows((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setRunStatus(mode === "auto" ? (locale === "zh" ? "工作流已自动保存" : "Workflow auto-saved") : (locale === "zh" ? "工作流已保存到本机" : "Workflow saved locally"));
      return true;
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : (mode === "auto" ? (locale === "zh" ? "工作流自动保存失败" : "Workflow auto-save failed") : (locale === "zh" ? "工作流保存失败" : "Workflow save failed")));
      return false;
    } finally {
      workflowSaveInFlightRef.current = false;
      if (workflowAutoSavePendingRef.current) {
        workflowAutoSavePendingRef.current = false;
        void workflowAutoSaveRef.current("auto");
      }
    }
  }

  function currentWorkflowDefinition(definitionOverride?: WorkflowDefinitionEnvelope) {
    const defaultProvider = providerForCapability(configRef.current, capabilityForWorkflowAction(workflowAction));
    const base = definitionOverride ?? workflowDefinition ?? buildWorkflowDefinition(workflowPrompt, workflowAction, defaultProvider, {}, locale);
    // The canvas owns node configuration. Saving must never replace a node's
    // edited prompt, provider/model selection, files, or other parameters with
    // the page-level defaults; those defaults are used only for new nodes.
    return sanitizeWorkflowDefinitionForStorage({ ...base, metadata: { ...(base.metadata ?? {}), description: workflowMetadata.description, status: workflowMetadata.status } });
  }

  useEffect(() => {
    workflowAutoSaveRef.current = async () => { await saveCurrentWorkflow("auto"); };
  });

  useEffect(() => {
    if (!workflowBuilderOpen || selected.path !== "/dashboard/workflows") return;
    const timeoutId = window.setTimeout(() => void workflowAutoSaveRef.current("auto"), 700);
    return () => window.clearTimeout(timeoutId);
  }, [selected.path, workflowBuilderOpen, workflowDefinition, workflowMetadata, workflowPrompt]);

  async function continueWorkflowRun() {
    const workflowKey = workflowCanvasKeyRef.current;
    const trackedRunId = workflowKey ? workflowLastRunsRef.current.get(workflowKey)?.runId : undefined;
    const queryRunId = new URLSearchParams(activePathRef.current.split("?", 2)[1] ?? "").get("runId") ?? undefined;
    const candidateRunIds = [trackedRunId, lastWorkflowRunId, queryRunId].filter((runId, index, ids): runId is string => Boolean(runId) && ids.indexOf(runId) === index);
    const latest = candidateRunIds.map((runId) => runs.find((run) => run.id === runId)).find((run) => run && ["failed", "cancelled", "interrupted"].includes(run.status))
      ?? (candidateRunIds[0] ? { id: candidateRunIds[0], status: "failed", started_at: new Date(0).toISOString(), conversation_id: null } : undefined)
      ?? (!workflowKey ? runs.find((run) => ["failed", "cancelled", "interrupted"].includes(run.status)) : undefined);
    if (!latest) { setRunStatus(locale === "zh" ? "没有可继续的工作流运行" : "No resumable workflow run is available"); return; }
    await prepareRunRetry(latest, { workflowOnly: true });
  }

  function openWorkflowCanvas(definition: WorkflowDefinitionEnvelope, saved?: SavedWorkflow) {
    const normalizedDefinition = normalizeWorkflowDefinitionLayout(definition);
    currentWorkflowIdRef.current = saved?.id ?? null;
      setVisibleWorkflowCanvas(saved?.id ?? `draft:${hashWorkflowDefinition(normalizedDefinition)}`);
      savedWorkflowHashRef.current = saved ? hashWorkflowDefinition(sanitizeWorkflowDefinitionForStorage(normalizedDefinition)) : null;
      savedWorkflowPresentationHashRef.current = saved ? hashWorkflowPresentation(normalizedDefinition, saved.name) : null;
    const input = normalizedDefinition.nodes.find((node) => node.nodeKey === "input");
    const capability = normalizedDefinition.nodes.find((node) => node.nodeKey !== "input" && node.type !== "output");
    const inputConfig = input?.config && typeof input.config === "object" ? input.config as Record<string, unknown> : {};
    const metadata = definition.metadata ?? {};
    const savedTitle = saved?.name ?? (locale === "zh" ? "未命名工作流" : "Untitled workflow");
    setWorkflowMetadata({ title: savedTitle, description: typeof metadata.description === "string" ? metadata.description : "", status: metadata.status === "live" || metadata.status === "archived" ? metadata.status : (saved ? "live" : "draft") });
    const nextPrompt = typeof inputConfig.text === "string" ? inputConfig.text : "";
    if (capability && workflowActionsBase.some((item) => item.id === capability.type)) setWorkflowAction(capability.type as WorkflowAction);
    setWorkflowPrompt(nextPrompt);
    setWorkflowDefinition(normalizedDefinition);
    setWorkflowBuilderOpen(true);
  }

  function applyWorkflowRunDetail(detail: RunDetail, restoreToken?: WorkflowRestoreToken) {
    if (restoreToken && !isCurrentWorkflowRestore(restoreToken, {
      workflowKey: workflowCanvasKeyRef.current ?? "",
      generation: workflowRestoreGenerationRef.current,
      activePath: activePathRef.current,
    })) return false;
    const failureMessages = new Map<string, string>();
    for (const event of detail.events) {
      if (event.event_type !== "tool_event") continue;
      try {
        const toolEvent = JSON.parse(event.payload_json) as { tool?: unknown; message?: unknown };
        if (toolEvent.tool !== "workflow:node_failed" || typeof toolEvent.message !== "string") continue;
        const failure = JSON.parse(toolEvent.message) as { nodeKey?: unknown; message?: unknown };
        if (typeof failure.nodeKey === "string" && typeof failure.message === "string" && failure.message.trim()) failureMessages.set(failure.nodeKey, failure.message.trim());
      } catch {
        // Older runs may contain malformed events; retain all other node evidence.
      }
    }
    const snapshots = detail.nodes.map((node) => {
      let outputPayload: Record<string, unknown> | null = null;
      try {
        const parsed = node.output_json ? JSON.parse(node.output_json) : null;
        outputPayload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch {
        outputPayload = null;
      }
      const storedError = outputPayload && typeof outputPayload.error === "string" ? outputPayload.error.trim() : "";
      const errorMessage = node.status === "failed" ? storedError || failureMessages.get(node.node_key) : undefined;
      return { nodeKey: node.node_key, status: node.status, ...(outputPayload ? { outputPayload } : {}), ...(errorMessage ? { errorMessage } : {}) };
    });
    const status = detail.run.status === "succeeded"
      ? (locale === "zh" ? "工作流已完成" : "Workflow completed")
      : detail.run.status === "failed"
        ? (locale === "zh" ? "工作流执行失败" : "Workflow failed")
        : detail.run.status;
    const workflowKey = workflowCanvasKeyRef.current;
    if (!workflowKey) return false;
    if (restoreToken && !isCurrentWorkflowRestore(restoreToken, {
      workflowKey,
      generation: workflowRestoreGenerationRef.current,
      activePath: activePathRef.current,
    })) return false;
    if (workflowKey) workflowLastRunsRef.current.set(workflowKey, { runId: detail.run.id, workflowKey, snapshots, status });
    setLastWorkflowRunId(detail.run.id);
    setWorkflowNodeSnapshots(snapshots);
    setWorkflowRunStatus(status);
    return true;
  }

  async function restoreLatestWorkflowRun(workflow: SavedWorkflow, definition: WorkflowDefinitionEnvelope) {
    const definitionHash = hashWorkflowDefinition(definition);
    const restoreToken: WorkflowRestoreToken = { workflowKey: workflow.id, generation: workflowRestoreGenerationRef.current, activePath: activePathRef.current };
    const candidates = [...runs].sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at));
    for (const run of candidates) {
      if (!isCurrentWorkflowRestore(restoreToken, { workflowKey: workflowCanvasKeyRef.current ?? "", generation: workflowRestoreGenerationRef.current, activePath: activePathRef.current })) return;
      let detail: RunDetail;
      try {
        detail = toRunDetail(await workbenchClient.runs.inspect(run.id));
      } catch {
        continue;
      }
      const metadata = readDesktopTaskMetadata(detail);
      if (metadata?.kind !== "workflow") continue;
      if (metadata.workflowId !== workflow.id && metadata.definitionHash !== definitionHash) continue;
      applyWorkflowRunDetail(detail, restoreToken);
      return;
    }
    if (!isCurrentWorkflowRestore(restoreToken, { workflowKey: workflowCanvasKeyRef.current ?? "", generation: workflowRestoreGenerationRef.current, activePath: activePathRef.current })) return;
    setWorkflowRunStatus(locale === "zh" ? "尚无运行结果" : "No run results yet");
  }

  async function handleWorkflowDirectoryAction(action: WorkbenchWorkflowDirectoryAction) {
    if (action.type === "create") {
      currentWorkflowIdRef.current = null;
      setVisibleWorkflowCanvas(`draft:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`);
      savedWorkflowHashRef.current = null;
      savedWorkflowPresentationHashRef.current = null;
      setWorkflowPrompt("");
       setWorkflowDefinition(buildWorkflowDefinition("", "writer", providerForCapability(configRef.current, "text"), {}, locale));
      setWorkflowMetadata({ title: locale === "zh" ? "未命名工作流" : "Untitled workflow", description: "", status: "draft" });
      setWorkflowAction("writer");
      setWorkflowBuilderOpen(true);
      return;
    }
    if (action.type === "open") {
      const workflow = savedWorkflows.find((item) => item.id === action.id);
      const definition = workflow ? parseSavedWorkflowDefinition(workflow) : null;
      if (!workflow || !definition) {
        setRunStatus(locale === "zh" ? "无法读取该工作流定义" : "Unable to read this workflow definition");
        return;
      }
      openWorkflowCanvas(definition, workflow);
      setLastWorkflowRunId(null);
      setWorkflowNodeSnapshots([]);
      setWorkflowRunStatus(locale === "zh" ? "正在加载最近运行结果…" : "Loading the latest run result…");
      void restoreLatestWorkflowRun(workflow, definition);
      return;
    }
    if (action.type === "duplicate") {
      const workflow = savedWorkflows.find((item) => item.id === action.id);
      const definition = workflow ? parseSavedWorkflowDefinition(workflow) : null;
      if (!workflow || !definition) return;
      const id = globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}`;
      const title = locale === "zh" ? `${workflow.name} · 副本` : `${workflow.name} · Copy`;
      try {
        const saved = toSavedWorkflow(await workbenchClient.workflows.save({ id, title, definition }));
        setSavedWorkflows((current) => [saved, ...current]);
      } catch (error) {
        setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "复制工作流失败" : "Unable to duplicate workflow"));
      }
      return;
    }
    if (action.type === "delete") {
      const workflowId = action.id;
      if (!workflowId) return;
      try {
        await workbenchClient.workflows.remove(workflowId);
        if (currentWorkflowIdRef.current === workflowId) {
          currentWorkflowIdRef.current = null;
          savedWorkflowHashRef.current = null;
          savedWorkflowPresentationHashRef.current = null;
        }
        setSavedWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId));
        setRunStatus(locale === "zh" ? "工作流已删除" : "Workflow deleted");
      } catch (error) {
        setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "删除工作流失败" : "Unable to delete workflow"));
      }
      return;
    }
    if (action.type === "instantiate") {
      if (action.id === "video-ffmpeg-transform" || action.id === "audio-ffmpeg-trim") {
        openWorkflowCanvas(buildLocalMediaWorkflowDefinition(action.id === "video-ffmpeg-transform" ? "video" : "audio", locale));
        return;
      }
      if (action.id === "product-promotion-video") {
        openWorkflowCanvas(buildProductPromotionWorkflowDefinition(providerForCapability(config, "video"), providerForCapability(config, "audio"), locale));
        return;
      }
      const templateAction: WorkflowAction = action.id === "presentation" ? "ppt_generate" : action.id === "image-campaign" ? "image_generate" : "writer";
      const templatePrompt = action.id === "presentation"
        ? (locale === "zh" ? "生成一份营销演示文稿" : "Create a marketing presentation")
        : action.id === "image-campaign"
          ? (locale === "zh" ? "生成一组营销活动图片" : "Generate a set of campaign images")
          : (locale === "zh" ? "生成一份营销内容方案" : "Create a marketing content plan");
      openWorkflowCanvas(buildWorkflowDefinition(templatePrompt, templateAction, providerForCapability(config, capabilityForWorkflowAction(templateAction)), {}, locale));
      return;
    }
    if (action.type === "open-run" && action.id) {
      workbenchClient.navigation.go(`/dashboard/workflows?runId=${encodeURIComponent(action.id)}`);
    }
  }

  useEffect(() => {
    const [pathname, rawQuery = ""] = activePath.split("?", 2);
    const runId = pathname === "/dashboard/workflows" ? new URLSearchParams(rawQuery).get("runId") : null;
    if (!runId) {
      workflowRestoreRequestRef.current = null;
      return;
    }
    if (workflowRestoreRequestRef.current === runId) return;
    workflowRestoreRequestRef.current = runId;
    void (async () => {
      try {
        const detail = toRunDetail(await workbenchClient.runs.inspect(runId));
        const metadata = readDesktopTaskMetadata(detail);
        const saved = metadata?.workflowId
          ? savedWorkflows.find((workflow) => workflow.id === metadata.workflowId)
          : metadata?.definitionHash
            ? savedWorkflows.find((workflow) => {
              const definition = parseSavedWorkflowDefinition(workflow);
              return definition ? hashWorkflowDefinition(definition) === metadata.definitionHash : false;
            })
            : undefined;
        // A task opens the exact version it executed, even if the user has
        // edited the workflow again since then. Older runs retain the saved
        // workflow/hash fallback for backwards compatibility.
        const definition = metadata?.workflowDefinition
          ? normalizeWorkflowDefinitionLayout(metadata.workflowDefinition)
          : saved ? parseSavedWorkflowDefinition(saved) : null;
        if (!definition) {
          if (activePathRef.current !== activePath || workflowRestoreRequestRef.current !== runId) return;
          setWorkflowRunStatus(locale === "zh" ? "无法恢复该工作流的 Canvas 定义" : "Unable to restore the workflow Canvas definition");
          return;
        }
        const snapshotWorkflow = saved ?? (metadata?.workflowId
          ? {
              id: metadata.workflowId,
              name: metadata.workflowTitle?.trim() || (locale === "zh" ? "已归档工作流" : "Archived workflow"),
              definition_json: JSON.stringify(definition),
              updated_at: detail.run.started_at,
            }
          : undefined);
        if (activePathRef.current !== activePath || workflowRestoreRequestRef.current !== runId) return;
        openWorkflowCanvas(definition, snapshotWorkflow);
        const workflowKey = workflowCanvasKeyRef.current;
        if (!workflowKey) return;
        applyWorkflowRunDetail(detail, { workflowKey, generation: workflowRestoreGenerationRef.current, activePath });
      } catch (error) {
        if (activePathRef.current !== activePath || workflowRestoreRequestRef.current !== runId) return;
        setWorkflowRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "工作流运行记录加载失败" : "Unable to load workflow run"));
      }
    })();
  }, [activePath, locale, savedWorkflows, workbenchClient]);

  async function exportCurrentWorkflow(definitionOverride?: WorkflowDefinitionEnvelope): Promise<boolean> {
    const content = serializeWorkflowExport(currentWorkflowDefinition(definitionOverride));
    const fileName = `coworkany-workflow-${Date.now()}.json`;
    if (isTauriBridgeAvailable()) {
      try {
        const savedPath = await tauriBridge.invoke<string | null>("save_workflow_export", { content, suggestedName: fileName });
        if (savedPath) setRunStatus(locale === "zh" ? `工作流 JSON 已导出到 ${savedPath}` : `Workflow JSON exported to ${savedPath}`);
        return Boolean(savedPath);
      } catch {
        // Browser preview does not have the desktop command; fall through to its download path.
      }
    }
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setRunStatus(locale === "zh" ? "工作流 JSON 已导出" : "Workflow JSON exported");
    return true;
  }

  async function importWorkflow(file: File): Promise<boolean> {
    try {
      const migrated = normalizeWorkflowDefinitionLayout(parseWorkflowImportText(await file.text()));
      const capability = migrated.nodes.find((node) => node.nodeKey === "capability");
      const importedAction = workflowActions.find((item) => item.id === capability?.type);
      const importedConfig = capability?.config && typeof capability.config === "object" ? capability.config as Record<string, unknown> : {};
      const importedPrompt = typeof importedConfig.prompt === "string" ? importedConfig.prompt : typeof importedConfig.text === "string" ? importedConfig.text : "";
      if (importedAction) setWorkflowAction(importedAction.id);
      setWorkflowDefinition(migrated);
      setWorkflowPrompt(importedPrompt);
      const id = globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}`;
      const name = locale === "zh" ? `导入 · ${importedAction?.label ?? "工作流"}` : `Imported · ${workflowActionEnglish[importedAction?.id ?? ""] ?? "Workflow"}`;
      setWorkflowMetadata({ title: name, description: "", status: "draft" });
      const saved = toSavedWorkflow(await workbenchClient.workflows.save({ id, title: name, definition: migrated }));
      currentWorkflowIdRef.current = saved.id;
      setVisibleWorkflowCanvas(saved.id);
      savedWorkflowHashRef.current = hashWorkflowDefinition(migrated);
      savedWorkflowPresentationHashRef.current = hashWorkflowPresentation(migrated, name);
      setSavedWorkflows((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setRunStatus(locale === "zh" ? "工作流已迁移并保存到本机，Provider/路径将使用当前配置" : "Workflow migrated and saved locally; the current Provider and paths will be used");
      return true;
    } catch (error) { setRunStatus(locale === "zh" ? `工作流导入失败：${error instanceof Error ? error.message : String(error)}` : `Workflow import failed: ${error instanceof Error ? error.message : String(error)}`); return false; }
  }

  async function runAgent(promptOverride?: string, mediaFeatureId?: MediaFeatureId | "image_generate", mediaInputs?: Record<string, unknown>, workflowOverride?: unknown, workflowRetry?: WorkflowRetryState, displayedPromptOverride?: string, writerArticleMessageId?: string) {
    // Snapshot launch context before any attachment/knowledge await. A user can
    // switch to another agent or workspace while a long-running preparation is
    // in flight; that run must keep its original conversation and skill.
    const launchPath = activePathRef.current;
    const launchSelectedPath = selected.path;
    const launchRouteAction = routeAction;
    const launchWorkflowAction = workflowAction;
    const launchConversationScope = conversationScope;
    const launchEffectiveSkillId = effectiveSkillId;
    const launchConfig = configRef.current;
    const isWorkflowRun = launchSelectedPath === "/dashboard/workflows" || isWorkflowDefinition(workflowOverride);
    const launchWorkflowId = currentWorkflowIdRef.current;
    const launchWorkflowMetadata = workflowMetadata;
    const launchWorkflowDefinition = isWorkflowRun
      ? (isWorkflowDefinition(workflowOverride) ? workflowOverride : currentWorkflowDefinition())
      : undefined;
    const isStandaloneMediaTask = Boolean(mediaFeatureId && mediaFeatureId !== "image_generate");
    const workflowKey = isWorkflowRun
      ? workflowCanvasKeyRef.current
        ?? currentWorkflowIdRef.current
        ?? `draft:${hashWorkflowDefinition(launchWorkflowDefinition ?? currentWorkflowDefinition())}`
      : undefined;
    if (isWorkflowRun && workflowKey === workflowCanvasKeyRef.current) workflowRestoreGenerationRef.current += 1;
    if (workflowKey && (workflowRunsRef.current.has(workflowKey) || workflowLaunchLocksRef.current.has(workflowKey))) {
      setWorkflowRunStatus(locale === "zh" ? "当前工作流正在运行，请勿重复提交" : "This workflow is already running; duplicate submission was ignored.");
      return;
    }
    if (workflowKey) workflowLaunchLocksRef.current.add(workflowKey);
    let workflowKeyForStatus: string | undefined;
    workflowKeyForStatus = workflowKey;
    const setDomainStatus = (status: string) => {
      const stillOnLaunchRoute = activePathRef.current === launchPath;
      if (!stillOnLaunchRoute) return;
      if (isWorkflowRun ? workflowKeyForStatus === workflowCanvasKeyRef.current : true) (isWorkflowRun ? setWorkflowRunStatus : setRunStatus)(status);
    };
    if (attachmentsPreparing) { workflowKey && workflowLaunchLocksRef.current.delete(workflowKey); setDomainStatus(locale === "zh" ? "正在读取附件，请稍候…" : "Preparing attachments…"); return; }
    const workflowInput = isWorkflowDefinition(workflowOverride)
      ? workflowOverride.nodes.find((node) => node.nodeKey === "input")?.config.text
      : undefined;
    const workflowInputPrompt = typeof workflowInput === "string" ? workflowInput : "";
    const rawPrompt = promptOverride ?? (isWorkflowRun ? (workflowInputPrompt || workflowPrompt) : prompt);
    const basePrompt = rawPrompt.trim();
    const attachmentContext = attachments.length ? (locale === "zh" ? `\n\n本地附件（已复制到当前项目目录）：\n${attachments.map((attachment) => `- ${attachment.relativePath ?? attachment.name} (${attachment.mediaType}, ${attachment.size} bytes)${attachment.text ? `\n  文件正文：\n${attachment.text}${attachment.truncated ? "\n  [正文已截断]" : ""}` : "\n  请使用本地文件工具读取该附件内容。"}`).join("\n")}` : `\n\nLocal attachments copied into the current project:\n${attachments.map((attachment) => `- ${attachment.relativePath ?? attachment.name} (${attachment.mediaType}, ${attachment.size} bytes)${attachment.text ? `\n  Extracted content:\n${attachment.text}${attachment.truncated ? "\n  [Content truncated]" : ""}` : "\n  Use the local file tools to read this attachment."}`).join("\n")}`) : "";
    let knowledgeContext = "";
    if (knowledgeContextEnabled && basePrompt && launchConfig.obsidianIndexPath) {
      try {
        const results = await workbenchClient.knowledge.search({ indexPath: launchConfig.obsidianIndexPath, query: basePrompt, limit: 6, embedding: embeddingPayload(launchConfig) });
        if (results.length) {
          const knowledgeHeader = locale === "zh"
            ? "本地 Obsidian 知识库上下文（仅来自已选择的 Vault，请优先基于引用回答）"
            : "Local Obsidian knowledge context (selected Vault only; prefer cited sources)";
          knowledgeContext = `\n\n${knowledgeHeader}:\n${results.map((item) => `[${item.documentPath}${item.heading ? `#${item.heading}` : ""}] ${item.excerpt}`).join("\n")}`;
        }
      } catch {
        setDomainStatus(locale === "zh" ? "Obsidian 检索不可用，本轮继续使用普通 OpenCode 上下文" : "Obsidian search is unavailable; this turn will use ordinary OpenCode context");
      }
    }
    const titlePrompt = basePrompt || (locale === "zh" ? "请处理我提供的本地附件" : "Please process the local attachments I provided");
    const userPrompt = `${titlePrompt}${attachmentContext}`;
    // Keep the user-visible turn faithful to the textarea. Runtime context
    // (attachments and knowledge) belongs in the request, not in the user's
    // message bubble or persisted transcript.
    const displayedUserPrompt = displayedPromptOverride ?? (rawPrompt.length > 0 ? rawPrompt : titlePrompt);
    if (!userPrompt) { workflowKey && workflowLaunchLocksRef.current.delete(workflowKey); return; }
    const runtimePrompt = `${userPrompt}${knowledgeContext}`;
    const actionId = (mediaFeatureId === "image_generate"
      ? "image_generate"
      : resolveDesktopRunAction(launchSelectedPath, launchRouteAction, launchWorkflowAction, mediaFeatureId)) as WorkflowAction;
    if (!runtimeReady) {
      const runtime = await tauriBridge.invoke<RuntimeProbe>("runtime_probe").catch(() => undefined);
      const imageRuntimeReady = actionId === "image_generate" && runtime ? canRunImageWorkflow(runtime) : false;
      if (runtime?.ready || imageRuntimeReady) {
        // Startup may have failed while an optional runtime component was
        // still being repaired. Re-probing at submission time lets the image
        // workflow proceed once its actual host dependencies are available.
        setRuntimeReady(true);
        setRuntimePhase("ready");
        setRuntimeStatus(locale === "zh" ? "运行环境就绪" : "Runtime ready");
        await tauriBridge.invoke("host_start").catch(() => undefined);
        } else {
          const message = locale === "zh" ? "本地运行环境仍在准备中，请稍候再运行" : "The local runtime is still preparing; try running again in a moment.";
          (isWorkflowRun ? setWorkflowRunStatus : setRunStatus)(message);
          // No run has been registered yet. Do not leave the launch guard
          // behind, otherwise every later Run/Rerun/Continue click is treated
          // as a duplicate submission forever.
          workflowKey && workflowLaunchLocksRef.current.delete(workflowKey);
          return;
        }
      }
    const conversationAllowsArtifacts = promptRequestsArtifact(userPrompt) || actionId === "ppt_generate";
    const resolvedMediaInputs = mediaInputs ?? (actionId === "image_generate" ? parseImageInputs(userPrompt) : undefined);
    const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    if (launchSelectedPath === "/dashboard/workflows") setLastWorkflowRunId(runId);
    const routeConversationId = conversationIdFromPath(launchPath);
    const conversationId = isStandaloneMediaTask
      ? null
      : routeConversationId
        ? routeConversationId
        : `conversation-${runId}`;
    const conversationAgentId = launchConversationScope ?? undefined;
    const localAgentId = conversationAgentId?.startsWith("agency-") ? conversationAgentId : undefined;
    const existingConversation = conversations.find((item) => item.id === conversationId);
    const optimisticTitle = resolveConversationTitleUpdate({
      currentTitle: existingConversation?.title ?? defaultConversationTitle(locale),
      userPrompt: titlePrompt,
      existingMessageCount: conversationMessages.length,
      locale,
    }) ?? existingConversation?.title ?? buildConversationTitleFromPrompt(titlePrompt, locale);
    if (!isWorkflowRun && conversationId && activePathRef.current === launchPath) activeConversationRef.current = conversationId;
    if (conversationId) {
      runConversationIdsRef.current.set(runId, conversationId);
      activeRunsByConversationRef.current.set(conversationId, runId);
    }
    if (isStandaloneMediaTask) standaloneMediaRunsRef.current.add(runId);
    runContextsRef.current.set(runId, isWorkflowRun
      ? { kind: "workflow", launchPath, workflowKey }
      : isStandaloneMediaTask
        ? { kind: "media", launchPath, mediaScope: mediaRunScopeForFeature(launchPath, mediaFeatureId) }
        : { kind: "conversation", launchPath, conversationId: conversationId ?? undefined });
    const runIsVisible = () => desktopRunIsVisible(runContextsRef.current.get(runId), activePathRef.current, activeConversationRef.current, workflowCanvasKeyRef.current);
    if (!isWorkflowRun && conversationId && runIsVisible()) setActiveConversationId(conversationId);
    const userMessageCreatedAt = new Date().toISOString();
    assistantPartsRef.current.set(runId, [
      { type: "data-status", id: `${runId}:status`, data: { status: "running", message: locale === "zh" ? "正在准备本地会话…" : "Preparing local session…" } },
      ...(actionId === "image_generate" && writerArticleMessageId ? [{ type: "data-writerAsset" as const, id: `${runId}:writer-article`, data: { articleMessageId: writerArticleMessageId, kind: "image" as const } }] : []),
    ]);
    workflowOutputsRef.current.delete(runId);
    if (isWorkflowRun && launchWorkflowDefinition) workflowOutputNodeKeysRef.current.set(runId, new Set(launchWorkflowDefinition.nodes.filter((node) => node.type === "output").map((node) => node.nodeKey)));
    setDomainStatus(locale === "zh" ? "正在通过本地 OpenCode 运行…" : "Running through local OpenCode…");
    if (!isWorkflowRun && runIsVisible()) { activeRunRef.current = runId; setAssistantText(""); setAssistantAt(userMessageCreatedAt); setToolEvents([]); setActivePrompt(displayedUserPrompt); setActivePromptAt(userMessageCreatedAt); }
    const userParts: DesktopUIMessagePart[] = [
      { type: "text", text: displayedUserPrompt, state: "done" },
      ...(actionId === "image_generate" && writerArticleMessageId ? [{ type: "data-writerAsset" as const, id: `${runId}:writer-article-request`, data: { articleMessageId: writerArticleMessageId, kind: "image" as const } }] : []),
    ];
    if (!isWorkflowRun && conversationId) updateVisibleConversationMessages(conversationId, (current) => [...current, { id: `message-${runId}`, conversationId, role: "user", content: displayedUserPrompt, createdAt: userMessageCreatedAt, parts: userParts }]);
    if (!isWorkflowRun && conversationId) setConversations((current) => [{
      id: conversationId,
      title: optimisticTitle,
      updated_at: userMessageCreatedAt,
      opencode_session_id: current.find((item) => item.id === conversationId)?.opencode_session_id ?? null,
      agent_id: current.find((item) => item.id === conversationId)?.agent_id ?? conversationAgentId ?? null,
    }, ...current.filter((item) => item.id !== conversationId)]);
    if (isWorkflowRun && workflowKey) {
      const tracking: WorkflowRunTracking = { runId, workflowKey, snapshots: [], status: locale === "zh" ? "正在启动工作流…" : "Starting workflow…" };
      workflowRunsRef.current.set(workflowKey, tracking);
      workflowLastRunsRef.current.delete(workflowKey);
      workflowLaunchLocksRef.current.delete(workflowKey);
      workflowRunKeysRef.current.set(runId, workflowKey);
      if (workflowCanvasKeyRef.current === workflowKey) {
        workflowNodeRunIdRef.current = runId;
        setWorkflowNodeSnapshots([]);
        setWorkflowRunStatus(tracking.status);
      }
    }
    else if (runIsVisible()) setActiveRunId(runId);
    if (!isWorkflowRun && !isStandaloneMediaTask && conversationId && activePathRef.current === launchPath && !conversationIdFromPath(activePathRef.current)) {
      workbenchClient.navigation.go(conversationRoute({ id: conversationId, agent_id: conversationAgentId }));
    }
    let persistedRun = false;
    try {
      const priorConversationHistory = conversationId ? await workbenchClient.conversations.messages(conversationId) : [];
      if (conversationId) {
        const persistedTitle = resolveConversationTitleUpdate({
          currentTitle: existingConversation?.title ?? defaultConversationTitle(locale),
          userPrompt: titlePrompt,
          existingMessageCount: priorConversationHistory.length,
          locale,
        }) ?? existingConversation?.title ?? optimisticTitle;
        await tauriBridge.invoke("create_conversation", { input: { id: conversationId, title: persistedTitle, project_id: null, agent_id: conversationAgentId ?? null } });
        if (!isWorkflowRun) setConversations((current) => [{ id: conversationId, title: persistedTitle, updated_at: new Date().toISOString(), opencode_session_id: current.find((item) => item.id === conversationId)?.opencode_session_id ?? null, agent_id: current.find((item) => item.id === conversationId)?.agent_id ?? conversationAgentId ?? null }, ...current.filter((item) => item.id !== conversationId)]);
        await tauriBridge.invoke("append_message", { input: { id: `message-${runId}`, conversation_id: conversationId, role: "user", content: displayedUserPrompt, parts_json: JSON.stringify(userParts), created_at: userMessageCreatedAt } });
      }
      await tauriBridge.invoke("host_start");
      if (launchSelectedPath === "/dashboard" && conversationId) {
        if (conversationIdFromPath(activePathRef.current) !== conversationId) {
          workbenchClient.navigation.go(conversationRoute({ id: conversationId, agent_id: conversationAgentId }));
        }
      }
       if (activePathRef.current === launchPath) setAttachments([]);
       const action = workflowActions.find((item) => item.id === actionId) ?? workflowActions[0];
       const capabilityProvider = providerForCapability(launchConfig, capabilityForWorkflowAction(actionId));
       const configuredModels = modelOptionsForProvider(launchConfig, capabilityProvider) ?? [];
       const requestedModel = typeof resolvedMediaInputs?.model === "string" ? resolvedMediaInputs.model.trim() : "";
       const selectedProvider = {
         ...capabilityProvider,
         model: requestedModel && (!configuredModels.length || configuredModels.includes(requestedModel))
           ? requestedModel
           : capabilityProvider.model,
       };
       runModelsRef.current.set(runId, selectedProvider.model);
       // Image generation is a media workflow, not a Skill-driven text turn.
       // Keep the writer Skill out of this run so a Skill's example provider or
       // model can never compete with the configured image capability.
       const runSkillId: SkillId = actionId === "image_generate" ? "auto" : launchEffectiveSkillId;
       await workbenchClient.runs.start({ id: runId, conversationId, prompt: userPrompt, model: selectedProvider.model || undefined, skillId: runSkillId, reasoningEffort: selectedProvider.reasoningEffort ?? reasoningEffort });
       const workflowDefinitionSnapshot = isWorkflowRun
         ? sanitizeWorkflowDefinitionForStorage(launchWorkflowDefinition ?? currentWorkflowDefinition())
         : undefined;
       let savedWorkflowForRun: SavedWorkflow | undefined;
       if (workflowDefinitionSnapshot) {
         const workflowId = launchWorkflowId ?? (globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}`);
         const actionName = locale === "en" ? workflowActionEnglish[action.id] ?? action.label : action.label;
         const workflowName = launchWorkflowMetadata.title.trim() || (locale === "en" ? `${actionName} workflow` : `${actionName}工作流`);
         savedWorkflowForRun = toSavedWorkflow(await workbenchClient.workflows.save({ id: workflowId, title: workflowName, definition: workflowDefinitionSnapshot }));
         if (activePathRef.current === launchPath) {
           currentWorkflowIdRef.current = savedWorkflowForRun.id;
           savedWorkflowHashRef.current = hashWorkflowDefinition(workflowDefinitionSnapshot);
           savedWorkflowPresentationHashRef.current = hashWorkflowPresentation(workflowDefinitionSnapshot, workflowName);
         }
         const savedWorkflow = savedWorkflowForRun;
         setSavedWorkflows((current) => [savedWorkflow, ...current.filter((item) => item.id !== savedWorkflow.id)]);
       }
       const mediaFeature = mediaFeatureId && mediaFeatureId !== "image_generate" ? mediaFeatureCatalog.find((feature) => feature.id === mediaFeatureId) : undefined;
       const mediaEntryPath = mediaFeatureId === "image_generate"
         ? launchConversationScope === "entry:writer"
           ? `/dashboard/writer/${encodeURIComponent(conversationId ?? "")}`
           : launchConversationScope === "entry:image-assistant"
            ? `/dashboard/image-assistant/${encodeURIComponent(conversationId ?? "")}`
            : `/dashboard/image-assistant/${encodeURIComponent(conversationId ?? "")}`
        : mediaFeature
          ? `${mediaFeature.group === "audio" ? "/dashboard/capabilities" : "/dashboard/video"}?feature=${encodeURIComponent(mediaFeature.id)}&runId=${encodeURIComponent(runId)}`
          : undefined;
       const taskMetadata: DesktopTaskMetadata = {
       kind: isWorkflowRun ? "workflow" : mediaFeatureId ? "media" : "agent",
       ...(mediaFeatureId && mediaFeatureId !== "image_generate" ? { featureId: mediaFeatureId } : {}),
       ...(actionId === "image_generate" ? { imageGeneration: buildDesktopImageGenerationMetadata(displayedUserPrompt, resolvedMediaInputs) } : {}),
         ...(savedWorkflowForRun ? { workflowId: savedWorkflowForRun.id, workflowTitle: savedWorkflowForRun.name, definitionHash: workflowDefinitionSnapshot?.definitionHash, workflowDefinition: workflowDefinitionSnapshot } : {}),
        entryPath: isWorkflowRun
          ? `/dashboard/workflows?runId=${encodeURIComponent(runId)}`
          : mediaEntryPath ?? conversationRoute({ id: conversationId ?? "", agent_id: conversationAgentId }),
       };
       setRunMetadataById((current) => new Map(current).set(runId, taskMetadata));
       await tauriBridge.invoke("append_run_event", { runId, sequence: -1, eventType: "task_metadata", payloadJson: JSON.stringify(taskMetadata) });
       persistedRun = true;
       setRuns((current) => [{ id: runId, conversation_id: conversationId, status: "running", model: selectedProvider.model || null, started_at: new Date().toISOString(), finished_at: null }, ...current].slice(0, 100));
        const workflowExecutionPrompt = launchSelectedPath === "/dashboard/workflows" && actionId === "writer"
        ? `${runtimePrompt}\n\n输出约束：只输出可直接交付的最终中文营销文案；不要解释过程，不要提及 Skill、模型或工具，不要输出英文前言。按用户要求保留标题、正文和行动号召。`
        : runtimePrompt;
       const capabilityConfig = {
        prompt: workflowExecutionPrompt,
        script: workflowExecutionPrompt,
        text: workflowExecutionPrompt,
        ...(mediaFeatureId ? { featureId: mediaFeatureId } : {}),
        ...(resolvedMediaInputs ?? {}),
         ...(actionId === "knowledge_retrieve" && launchConfig.obsidianIndexPath ? { indexPath: launchConfig.obsidianIndexPath, query: userPrompt, embeddingMode: embeddingPayload(launchConfig).mode, embeddingBaseUrl: embeddingPayload(launchConfig).baseUrl, embeddingModel: embeddingPayload(launchConfig).model, embeddingApiKey: embeddingPayload(launchConfig).apiKey } : {}),
         ...(actionId === "knowledge_write" && launchConfig.obsidianVaultPath ? { vaultPath: launchConfig.obsidianVaultPath } : {}),
        // Transport selection is authoritative for media actions. Put it after
        // action inputs so stale provider/model fields from a Skill, imported
        // workflow, or UI payload cannot override the current local profile.
        provider: selectedProvider.id,
        model: selectedProvider.model,
        baseUrl: selectedProvider.baseUrl,
        apiKey: selectedProvider.apiKey,
        endpoint: selectedProvider.endpoint,
        queryEndpoint: selectedProvider.queryEndpoint,
        };
      const rawWorkflowDefinition = isWorkflowDefinition(workflowOverride) ? workflowOverride : launchSelectedPath === "/dashboard/workflows" ? (launchWorkflowDefinition ?? currentWorkflowDefinition()) : buildWorkflowDefinition(userPrompt, actionId, selectedProvider, capabilityConfig, locale);
      const hostDefinitionInput = rawWorkflowDefinition;
      const workflowDefinition = sanitizeWorkflowDefinitionForStorage(hostDefinitionInput);
      const hostWorkflowDefinition = bindWorkflowProviderDefaults(hostDefinitionInput, launchConfig);
      // Provider binding is part of the executable definition. Recovery is
      // validated against the exact definition sent to the host, otherwise a
      // legitimate retry can be rejected after local Provider defaults are
      // injected into the saved workflow.
      const executableRecoveryDefinitionHash = workflowRetry ? hashWorkflowDefinition(hostWorkflowDefinition) : undefined;
      if (isWorkflowRun && workflowKey) updateWorkflowTracking(workflowKey, (current) => ({ ...current, snapshots: createWorkflowNodeSnapshots(hostWorkflowDefinition.nodes.map((node) => node.nodeKey)), status: locale === "zh" ? "工作流运行中…" : "Workflow running…" }));
      const mediaNodes = hostWorkflowDefinition.nodes.filter((node) => isMediaWorkflowNodeType(node.type));
      const mediaTempDirectories = Object.fromEntries(await Promise.all(mediaNodes.map(async (node) => {
        const allocated = await tauriBridge.invoke<{ relativePath: string }>("allocate_media_temp", { runId, nodeKey: node.nodeKey });
        return [node.nodeKey, allocated.relativePath] as const;
      })));
      await Promise.all(mediaNodes.map((node) => {
         const nodeProvider = typeof node.config.provider === "string" && node.config.provider.trim() ? node.config.provider.trim() : selectedProvider.id;
         const nodeModel = typeof node.config.model === "string" && node.config.model.trim() ? node.config.model.trim() : selectedProvider.model;
        return tauriBridge.invoke("record_run_attempt", { idempotencyKey: `${runId}:${node.nodeKey}:1`, runId, nodeKey: node.nodeKey, provider: nodeProvider || null, providerTaskId: null, status: "queued", payloadJson: JSON.stringify({ executorId: node.type, nodeKey: node.nodeKey, provider: nodeProvider, model: nodeModel, idempotencyKey: `${runId}:${node.nodeKey}:1`, status: "queued" }) });
      }));
        // The image-assistant route does not pass a mediaFeatureId because the
        // route itself selects image_generate. Use the resolved action here so
        // it can never fall through to the text/OpenCode conversation path.
        const usesOpenCodeConversation = !mediaFeatureId && actionId !== "image_generate" && (mode === "chat" || mode === "writer" || launchSelectedPath === "/dashboard");
      if (usesOpenCodeConversation && conversationId) {
       const openCodePrompt = desktopExecutionPrompt(launchEffectiveSkillId, runtimePrompt, locale);
        const existingSessionId = conversations.find((item) => item.id === conversationId)?.opencode_session_id ?? undefined;
         const sessionResponse = await sendHostMessage({ version: 1, requestId: `${conversationId}:session:${runId}`, type: "session.create", payload: { conversationId, ...(existingSessionId ? { sessionId: existingSessionId } : {}), workspacePath: launchConfig.workspacePath, model: selectedProvider.model, provider: selectedProvider, allowArtifacts: conversationAllowsArtifacts, ...(localAgentId ? { agentId: localAgentId } : {}) } });
        if (sessionResponse.ok !== true) throw new Error(String((sessionResponse.error as { message?: string } | undefined)?.message ?? "opencode_session_unavailable"));
        const sessionId = String((sessionResponse.data as { sessionId?: string } | undefined)?.sessionId ?? "");
        if (!sessionId) throw new Error("opencode_session_id_missing");
        markQuestionSessionAvailable(sessionId);
        // The runtime-response listener persists the session ID as soon as the
        // session.create frame arrives. Do not await a second SQLite write here:
        // the prompt must be sent immediately even when the local database is
        // briefly busy with the first persistence operation.
        void tauriBridge.invoke("set_conversation_session", { conversationId, sessionId }).catch(() => undefined);
        const recovered = (sessionResponse.data as { recovered?: unknown } | undefined)?.recovered === true;
        const recoverySnapshot = recovered ? createSessionRecoverySnapshot(priorConversationHistory.filter((message): message is typeof message & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant").map((message) => ({ role: message.role, content: desktopUIMessageText(message) }))) : "";
        const promptWithRecovery = recoverySnapshot ? `${recoverySnapshot}\n\nCurrent request: ${openCodePrompt}` : openCodePrompt;
          await sendHostMessage({ version: 1, requestId: runId, runId, sessionId, type: "session.prompt", payload: { prompt: promptWithRecovery, model: selectedProvider.model, provider: selectedProvider, allowArtifacts: conversationAllowsArtifacts, skillId: launchEffectiveSkillId, ...(localAgentId ? { agentId: localAgentId } : {}), executable: launchConfig.runtime.opencodePath } });
      } else {
        if (!isWorkflowRun) {
          const workflowId = `workflow-${actionId}`;
          const actionName = locale === "en" ? workflowActionEnglish[action.id] ?? action.label : action.label;
          const workflowName = locale === "en" ? `${actionName} workflow` : `${actionName}工作流`;
          const saved = toSavedWorkflow(await workbenchClient.workflows.save({ id: workflowId, title: workflowName, definition: workflowDefinition }));
          setSavedWorkflows((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
        }
        await sendHostMessage({ version: 1, requestId: runId, runId, type: "workflow.run", payload: { workspacePath: launchConfig.workspacePath, provider: selectedProvider, media: selectedProvider, providers: launchConfig.providers, vaultPath: launchConfig.obsidianVaultPath, indexPath: launchConfig.obsidianIndexPath, executable: launchConfig.runtime.opencodePath, mediaTempDirectories, definition: hostWorkflowDefinition, ...(workflowRetry ? { completed: workflowRetry.completed, recoveryDefinitionHash: executableRecoveryDefinitionHash } : {}) } });
      }
      if (!isWorkflowRun && runIsVisible()) setPrompt("");
      setDomainStatus(locale === "zh" ? "已发送，等待本地 Agent 事件…" : "Sent; waiting for local Agent events…");
    } catch (error) {
      if (workflowKey) workflowLaunchLocksRef.current.delete(workflowKey);
      if (isWorkflowRun && workflowKey) updateWorkflowTracking(workflowKey, (current) => ({ ...current, status: "failed", snapshots: finalizeWorkflowNodeSnapshots(current.snapshots, "failed") }));
      const detail = error instanceof Error ? error.message : (locale === "zh" ? "本地 Agent 启动失败" : "Local Agent failed to start");
      if (persistedRun) await tauriBridge.invoke("finish_run", { runId, status: "failed" }).catch(() => undefined);
      setRuns((current) => current.map((run) => run.id === runId ? { ...run, status: "failed", finished_at: new Date().toISOString() } : run));
      const createdAt = new Date().toISOString();
      const content = locale === "zh" ? `本地 Agent 未能启动或接收请求：${detail}` : `The local Agent could not start or accept the request: ${detail}`;
      const parts: DesktopUIMessagePart[] = [{ type: "data-status", id: `${runId}:status:failed`, data: { status: "failed", message: detail } }];
      const visible = runIsVisible();
      if (!isWorkflowRun && conversationId && visible) updateConversationMessages((current) => [...current.filter((message) => message.id !== `assistant-${runId}`), { id: `assistant-${runId}`, conversationId, role: "assistant", content, createdAt, status: "failed", parts }]);
      if (!isWorkflowRun && conversationId) void tauriBridge.invoke("append_message", { input: { id: `assistant-${runId}`, conversation_id: conversationId, role: "assistant", content, parts_json: JSON.stringify(parts), created_at: createdAt } }).catch(() => undefined);
      runConversationIdsRef.current.delete(runId);
      if (conversationId && activeRunsByConversationRef.current.get(conversationId) === runId) activeRunsByConversationRef.current.delete(conversationId);
      standaloneMediaRunsRef.current.delete(runId);
      runContextsRef.current.delete(runId);
      const wasActiveRun = activeRunRef.current === runId;
      if (wasActiveRun) activeRunRef.current = null;
      if (isWorkflowRun) {
        if (workflowKey) removeWorkflowTracking(workflowKey);
        if (visible) setWorkflowRunStatus(detail);
      } else if (visible && (conversationId === activeConversationRef.current || wasActiveRun)) {
        setActiveRunId(null);
        setRunStatus(detail);
      }
    }
  }

  async function cancelActiveRun() {
    const currentPath = activePathRef.current;
    const currentWorkflowRunId = workflowCanvasKeyRef.current ? workflowRunsRef.current.get(workflowCanvasKeyRef.current)?.runId : undefined;
    const routeConversationId = conversationIdFromPath(currentPath);
    const currentConversationId = routeConversationId ?? activeConversationRef.current;
    const conversationRunId = currentConversationId ? activeRunsByConversationRef.current.get(currentConversationId) : undefined;
    const queryRunId = new URLSearchParams(currentPath.split("?", 2)[1] ?? "").get("runId") ?? undefined;
    const queryRunIsVisible = queryRunId && desktopRunIsVisible(runContextsRef.current.get(queryRunId), currentPath, activeConversationRef.current, workflowCanvasKeyRef.current) ? queryRunId : undefined;
    const visibleActiveRun = activeRunId && desktopRunIsVisible(runContextsRef.current.get(activeRunId), currentPath, activeConversationRef.current, workflowCanvasKeyRef.current) ? activeRunId : undefined;
    const runId = currentWorkflowRunId ?? conversationRunId ?? queryRunIsVisible ?? visibleActiveRun;
    if (!runId) return;
    const workflowKey = workflowRunKeysRef.current.get(runId);
    const isWorkflowRun = Boolean(workflowKey);
    try {
      await workbenchClient.runs.emergencyStop(runId);
      if (isWorkflowRun && workflowKey) {
        updateWorkflowTracking(workflowKey, (current) => ({ ...current, status: locale === "zh" ? "已紧急停止本地 Agent" : "Local Agent emergency-stopped", snapshots: finalizeWorkflowNodeSnapshots(current.snapshots, "cancelled") }));
        removeWorkflowTracking(workflowKey);
        setWorkflowRunStatus(locale === "zh" ? "已紧急停止本地 Agent" : "Local Agent emergency-stopped");
      } else {
        setRunStatus(locale === "zh" ? "已紧急停止本地 Agent" : "Local Agent emergency-stopped");
        if (currentConversationId && activeRunsByConversationRef.current.get(currentConversationId) === runId) activeRunsByConversationRef.current.delete(currentConversationId);
        runConversationIdsRef.current.delete(runId);
        standaloneMediaRunsRef.current.delete(runId);
        runContextsRef.current.delete(runId);
        setActiveRunId(null);
      }
      if (activeRunRef.current === runId) activeRunRef.current = null;
      setRuns((current) => current.map((run) => run.id === runId ? { ...run, status: "cancelled", finished_at: new Date().toISOString() } : run));
      await tauriBridge.invoke("finish_run", { runId, status: "cancelled" });
    } catch (error) {
      if (isWorkflowRun) setWorkflowRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "停止任务失败" : "Failed to stop the run"));
      else setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "停止任务失败" : "Failed to stop the run"));
    }
  }

  const immersivePage = selected.mode === "chat" || selected.mode === "writer" || selected.path === "/dashboard/image-assistant" || selected.path === "/dashboard/video" || selected.path === "/dashboard/workflows" || selected.path.includes("executive-ppt");
  const isHomeRoute = selected.path === "/dashboard";
  const questionSessionId = questionSessionIdForRoute(activePath, conversations, availableQuestionSessionIds);
  const currentWorkflowRun = workflowCanvasKey ? workflowRunsRef.current.get(workflowCanvasKey) : undefined;
  const currentWorkflowRunId = currentWorkflowRun?.runId ?? null;
  const mediaHistory = useMemo<DesktopMediaHistoryContextValue>(() => ({ scope: conversationScope, conversationId: activeConversationId, prompt: activePrompt, promptAt: activePromptAt, messages: conversationMessages, artifacts: artifactRows, runs, runMetadataById }), [activeConversationId, activePrompt, activePromptAt, artifactRows, conversationMessages, conversationScope, runMetadataById, runs]);
  const homeMessages = useMemo<DesktopUIMessage[]>(() => {
    if (!activePrompt && !assistantText && !activeRunId && !artifactRows.length) return [];
    const conversationId = activeConversationId ?? "dashboard-home";
    const userMessage = createDesktopUIMessage({ id: `home-user:${activePromptAt ?? conversationId}`, role: "user", conversationId, content: activePrompt, route: "/dashboard", providerId: activeProvider.id, modelId: activeModel });
    const assistantMessage = createDesktopUIMessage({ id: `home-assistant:${activeRunId ?? assistantAt ?? conversationId}`, role: "assistant", conversationId, runId: activeRunId ?? undefined, route: "/dashboard", providerId: activeProvider.id, modelId: activeModel });
    const assistantMetadata: NonNullable<DesktopUIMessage["metadata"]> = {
      ...(assistantMessage.metadata ?? {}),
      conversationId,
      createdAt: assistantMessage.metadata?.createdAt ?? assistantAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runStatus: activeRunId ? "running" : "completed",
    };
    const processParts: DesktopUIMessage["parts"] = [
      ...(assistantText ? [{ type: "text" as const, text: assistantText, state: activeRunId ? "streaming" as const : "done" as const }] : []),
      ...toolEvents.map((tool, index) => ({ type: "data-status" as const, id: `home-tool:${index}`, data: { status: activeRunId ? "running" as const : "completed" as const, message: tool } })),
      ...artifactRows.map((artifact) => ({ type: "data-artifact" as const, id: artifact.id, data: { id: artifact.id, relativePath: artifact.relative_path, title: artifact.relative_path, mimeType: artifact.mime_type, byteLength: artifact.byte_length, sha256: artifact.sha256, createdAt: artifact.created_at, available: artifact.available } })),
    ];
    return [userMessage, { ...assistantMessage, parts: processParts, metadata: assistantMetadata }];
  }, [activeConversationId, activeModel, activePrompt, activePromptAt, activeProvider.id, activeRunId, artifactRows, assistantAt, assistantText, toolEvents]);
  if (!shellReady) return <DesktopBootstrapScreen locale={locale} status={runtimeStatus} phase={runtimePhase} style={workbenchThemeStyle} onExportDiagnostics={() => { void tauriBridge.invoke<{ path: string }>("export_diagnostics").then(({ path }) => setRuntimeStatus(locale === "zh" ? `诊断包已导出：${path}` : `Startup diagnostics exported: ${path}`)).catch((error) => setRuntimeStatus(locale === "zh" ? `诊断包导出失败：${error instanceof Error ? error.message : String(error)}` : `Startup diagnostics export failed: ${error instanceof Error ? error.message : String(error)}`)); }} />;
  const localizedRunStatus = localizeDesktopStatus(runStatus, locale);
  const localizedWorkflowRunStatus = localizeDesktopStatus(workflowRunStatus, locale);
  const topTipMessage = [localizedRunStatus, localizedWorkflowRunStatus].find(isDesktopErrorStatus) ?? "";
  const showTopTip = Boolean(topTipMessage && dismissedTopTip !== topTipMessage);

  return (
    <div className="shell" style={workbenchThemeStyle}>
      {showTopTip ? <DesktopTopTip message={topTipMessage} locale={locale} onDismiss={() => setDismissedTopTip(topTipMessage)} /> : null}
      <DesktopMediaHistoryContext.Provider value={mediaHistory}>
      <WorkbenchShell navItems={sidebarRoutes.map((item) => ({ ...item, icon: <RouteIcon name={item.iconKey} /> }))} activePath={activePath} onNavigate={workbenchClient.navigation.go} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((current) => !current)} locale={locale} onLocaleChange={(nextLocale) => { if (nextLocale !== locale) setLocalePreference(nextLocale); }} onLocaleToggle={toggleLocale} localLabel={copy.localWorkspace} status={<div className="wb-runtime-status" data-runtime-status={runtimeStatus} title={localizeRuntimeStatus(runtimeStatus, locale)}><span className="wb-runtime-status-icon"><WorkbenchRouteIcon name="runtime" size={15} /></span><span className="wb-runtime-status-copy"><span className="wb-runtime-status-label">{localizeRuntimeStatus(runtimeStatus, locale)}</span><span className="muted">{locale === "zh" ? "本地运行环境" : "Local runtime"}</span></span></div>} sessions={conversations.map((conversation) => ({ path: conversationRoute(conversation), title: conversation.title, updatedAt: formatDateTime(conversation.updated_at, locale), agentId: conversation.agent_id ?? undefined, status: runs.some((run) => run.conversation_id === conversation.id && run.status === "running") ? "running" as const : undefined }))} sessionsLabel={conversationScope === "entry:writer" ? (locale === "zh" ? "写作会话" : "Writing sessions") : conversationScope === "entry:image-assistant" ? (locale === "zh" ? "图片助手会话" : "Image assistant sessions") : locale === "zh" ? "最近会话" : "Recent chats"} activeSessionAgentId={conversationScope} activeSessionAgentLabel={activeAgentCard?.title ?? activeChatRoute.label} hideSessionScopes={["entry:image-assistant"]} newSessionLabel={locale === "zh" ? "新建会话" : "New chat"} onNewSession={() => void startNewConversation()}>
      <section ref={workspaceRef} className={`workspace ${selected.path === "/dashboard" ? "workspace-home" : ""} ${immersivePage ? "workspace-immersive" : ""}`.trim()}>
        {settingsOpen && <DesktopSettingsPanel config={config} locale={locale} localePreference={localePreference} copy={copy} onConfigChange={(nextConfig) => { void persistSettingsConfig(nextConfig); }} onDiscoverModels={discoverProviderModels} onLocalePreferenceChange={updateSettingsLocalePreference} onClose={() => { void persistSettingsConfig({ ...configRef.current, locale: localePreference }, true); if (selected.path === "/dashboard/settings") workbenchClient.navigation.go("/dashboard"); setSettingsOpen(false); }} onSave={() => void saveSettings()} onRebuildVault={() => void rebuildVaultIndex()} onPickDirectory={(kind) => void pickDirectory(kind)} onRepairRuntime={() => { setRunStatus(locale === "zh" ? "正在导入离线运行时…" : "Importing offline runtime…"); void tauriBridge.invoke("repair_runtime", { options: config.offlineRuntimeZipPath ? { offlineZip: config.offlineRuntimeZipPath } : undefined }).then(() => setRunStatus(locale === "zh" ? "已导入离线运行时并完成复检" : "Offline runtime imported and rechecked")).catch((error) => setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "离线运行时导入失败" : "Offline runtime import failed"))); }} onExportDiagnostics={() => { setRunStatus(locale === "zh" ? "正在导出诊断包…" : "Exporting diagnostics…"); void tauriBridge.invoke<{ path: string }>("export_diagnostics").then((result) => setRunStatus(locale === "zh" ? `诊断包已导出：${result.path}` : `Diagnostics exported: ${result.path}`)).catch((error) => setRunStatus(error instanceof Error ? error.message : (locale === "zh" ? "诊断包导出失败" : "Diagnostics export failed"))); }} status={runStatus} />}
           {isHomeRoute ? <>
          <div className="home-shell"><div className="home-page-shell"><header className="home-topbar"><div className="home-topbar-status"><span className="public-signal" aria-hidden="true" /><span>{homeCopy.workspaceReady}</span></div><button type="button" className="home-credits-link" onClick={() => workbenchClient.navigation.go("/dashboard/tasks")}><span className="home-credits-icon"><WorkbenchRouteIcon name="sparkles" size={14} /></span><span>{homeCopy.viewUsage}</span><WorkbenchRouteIcon name="arrowUpRight" size={15} /></button></header><main className="home-main"><section className="home-welcome"><div className="home-welcome-kicker">COWORKANY WORKSPACE</div><h1>{homeCopy.welcomePrefix}{homeCopy.welcomeDefaultName}<span className="home-welcome-mark" aria-hidden="true">✦</span></h1><p>{homeCopy.welcomeSubtitle}</p></section>
          <section className="home-chat-workspace"><div className="chat-composer"><WorkbenchPromptInput value={prompt} onValueChange={setPrompt} onSubmit={() => void runAgent()} attachments={attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, status: attachment.status, error: attachment.error }))} onAddAttachments={addAttachments} onRemoveAttachment={removeAttachment} models={activeModels.map((item) => ({ id: item, label: formatWorkbenchModelLabel(item, { zh: "本地模型", en: "Local model" }, locale), provider: locale === "zh" ? "已配置模型" : "Configured models" }))} model={activeModel} onModelChange={updateModel} placeholder={copy.homePlaceholder} status={activeRunId ? "streaming" : "ready"} onStop={() => void cancelActiveRun()} locale={locale}><span className="sr-only" aria-live="polite">{localizeDesktopStatus(runStatus, locale)}</span>{knowledgeContextEnabled ? <div className="composer-knowledge-control"><button type="button" className="composer-knowledge-button" onClick={() => setKnowledgeContextEnabled(false)}>{locale === "zh" ? "⌑ Obsidian 知识库" : "⌑ Obsidian context"}</button><button type="button" className="composer-knowledge-close" aria-label={locale === "zh" ? "关闭 Obsidian 知识库上下文" : "Disable Obsidian knowledge"} onClick={() => setKnowledgeContextEnabled(false)}>×</button></div> : <button type="button" className="composer-knowledge-button" onClick={() => setKnowledgeContextEnabled(true)}>{locale === "zh" ? "⌑ 添加 Obsidian 知识库" : "⌑ Add Obsidian context"}</button>}<ModelControls locale={locale} model={activeModel} models={activeModels} providerSource={formatWorkbenchModelLabel(activeModel, { zh: "本地模型", en: "Local model" }, locale)} reasoningEffort={reasoningEffort} skillId={skillId} showSkill={false} hideModel onModelChange={updateModel} onReasoningChange={updateReasoning} onSkillChange={setSkillId} /></WorkbenchPromptInput></div></section>
          <HomeEntryGroups onNavigate={workbenchClient.navigation.go} locale={locale} /></main></div></div>
          <section className="recent-card"><div className="section-title"><span>{selected.path === "/dashboard/assets" ? (locale === "zh" ? "资产库" : "Asset library") : mode === "library" ? (locale === "zh" ? "本地工作流与会话" : "Local workflows and sessions") : (locale === "zh" ? "最近会话" : "Recent sessions")}</span><span className="muted">{selected.path === "/dashboard/assets" ? `${artifactRows.length} ${locale === "zh" ? "个产物" : "artifacts"}` : savedWorkflows.length ? `${savedWorkflows.length} ${locale === "zh" ? "个工作流" : "workflows"}` : ""}</span></div>{selected.path === "/dashboard/assets" ? (artifactRows.length ? <div className="conversation-list">{artifactRows.map((item) => <button key={item.id} className="conversation-row artifact-row" onClick={() => void workbenchClient.files.reveal(item.relative_path, item.mime_type)}><span>{item.relative_path}</span><small>{Math.ceil(item.byte_length / 1024)} KB · {item.mime_type}</small></button>)}</div> : <div className="empty-state"><strong>{locale === "zh" ? "还没有本地产物" : "No local artifacts yet"}</strong><p>{locale === "zh" ? "运行写作、PPT 或媒体任务后，文件会出现在这里。" : "Artifacts appear here after writing, PPT, or media runs."}</p></div>) : mode === "library" && savedWorkflows.length ? <div className="conversation-list">{savedWorkflows.map((item) => <div key={item.id} className="conversation-row"><span>{item.name}</span><small>{formatDateTime(item.updated_at, locale)}</small></div>)}</div> : homeMessages.length ? <div className="message-thread"><WorkbenchMessageSurface messages={homeMessages} locale={locale} pendingMessageId={activeRunId ? homeMessages.at(-1)?.id : undefined} onCopy={(message) => navigator.clipboard?.writeText(desktopUIMessageText(message))} onArtifactOpen={(artifact) => void workbenchClient.files.open(artifact.relativePath, artifact.mimeType)} onArtifactDownload={(artifactId) => { const artifact = artifactRows.find((item) => item.id === artifactId); if (artifact) void workbenchClient.files.open(artifact.relative_path, artifact.mime_type); }} resolveMediaSource={resolveDesktopMediaSource} resolveArtifactSource={resolveDesktopArtifactSource} /></div> : conversations.length ? <div className="conversation-list">{conversations.map((item) => <button key={item.id} type="button" className="conversation-row" onClick={() => navigate(conversationRoute(item))}><span>{item.title}</span><small>{formatDateTime(item.updated_at, locale)}</small></button>)}</div> : <div className="empty-state"><div className="empty-icon">⌁</div><strong>{locale === "zh" ? "还没有本地会话" : "No local sessions yet"}</strong><p>{locale === "zh" ? "运行第一个任务后，文本、工具步骤和产物会显示在这里。" : "Text, tool steps, and artifacts will appear here after your first task."}</p></div>}</section>
           <section className="stats-card"><div className="section-title"><span>{locale === "zh" ? "本地状态" : "Local status"}</span><span className="muted">{locale === "zh" ? "只统计，不扣费" : "Stats only; no billing"}</span></div><div className="stats-grid"><div><strong>{taskCount}</strong><span>{locale === "zh" ? "本地任务" : "Local tasks"}</span></div><div><strong>{tokenCount}</strong><span>Token</span></div><div><strong>{artifactCount}</strong><span>{locale === "zh" ? "产物" : "Artifacts"}</span></div></div></section>
         </> : null}

        {selected.path !== "/dashboard" && (selected.mode === "chat" || selected.mode === "writer") ? <DesktopConversationWorkspace route={activeChatRoute} prompt={prompt} onPromptChange={setPrompt} runStatus={runStatus} activeRunId={activeRunId} onRun={(value, displayedValue) => void runAgent(value, undefined, undefined, undefined, undefined, displayedValue)} onGenerateImages={(article) => { const articleText = desktopUIMessageText(article).trim(); if (!articleText) return; void runAgent(`${locale === "zh" ? "基于以下文章生成配图，并将图片产物写入当前项目目录。" : "Generate images for the following article and write the image artifacts into the current project directory."}\n\n${articleText}`, "image_generate", undefined, undefined, undefined, locale === "zh" ? "为所选文章生成配图" : "Generate images for the selected article", article.id); }} onCancel={() => void cancelActiveRun()} onNewConversation={startNewConversation} knowledgeEnabled={knowledgeContextEnabled} onKnowledgeToggle={() => setKnowledgeContextEnabled((current) => !current)} activePrompt={activePrompt} activePromptAt={activePromptAt} assistantText={assistantText} onAssistantTextChange={setAssistantText} onSaveDraft={saveWriterDraft} onExportDraft={exportWriterDraft} assistantAt={assistantAt} messages={conversationMessages} conversationId={conversationIdFromPath(activePath)} chatTransport={desktopChatTransport} chatReady={Boolean(conversationIdFromPath(activePath))} providerId={activeProvider.id} activeAssistantParts={activeRunId ? assistantPartsRef.current.get(activeRunId) : undefined} toolEvents={toolEvents} conversations={conversations} onNavigate={workbenchClient.navigation.go} artifacts={artifactRows} onArtifactOpen={(relativePath, mimeType) => void workbenchClient.files.open(relativePath, mimeType)} onArtifactDownload={(artifactId) => { const artifact = artifactRows.find((item) => item.id === artifactId); if (artifact) void workbenchClient.files.open(artifact.relative_path, artifact.mime_type); }} model={activeModel} models={activeModels} reasoningEffort={reasoningEffort} skillId={effectiveSkillId} attachments={attachments} onAddAttachments={addAttachments} onRemoveAttachment={removeAttachment} onModelChange={updateModel} onReasoningChange={updateReasoning} onSkillChange={setSkillId} onReachTop={(viewport) => { const id = conversationIdFromPath(activePath); if (id) loadOlderConversationMessages(id, viewport); }} conversationScrollTop={conversationScrollRestore} onConversationScroll={persistActiveConversationScroll} locale={locale} /> : selected.path === "/dashboard/workflows" ? (workflowBuilderOpen ? <DesktopWorkflowWorkspace route={selected} onBack={() => setWorkflowBuilderOpen(false)} prompt={prompt} onPromptChange={setPrompt} runStatus={workflowRunStatus} activeRunId={currentWorkflowRunId} onRun={(definition) => void runAgent(undefined, undefined, undefined, definition)} onRerun={(definition) => void runAgent(undefined, undefined, undefined, definition)} onContinue={() => void continueWorkflowRun()} onCancel={() => void cancelActiveRun()} savedWorkflows={savedWorkflows} workflowAction={workflowAction} onWorkflowAction={setWorkflowAction} definition={workflowDefinition} onDefinitionChange={setWorkflowDefinition} workflowMetadata={workflowMetadata} onWorkflowMetaChange={(patch) => setWorkflowMetadata((current) => ({ ...current, ...patch }))} onSave={(definition) => saveCurrentWorkflow("manual", definition)} onExport={(definition) => exportCurrentWorkflow(definition)} onImport={(file) => importWorkflow(file)} model={activeModel} models={activeModels} modelForNode={(nodeType, providerId) => providerForWorkflowNode(nodeType, providerId).model} modelsForNode={(nodeType, providerId) => modelOptionsForProvider(config, providerForWorkflowNode(nodeType, providerId)) ?? []} providersForNode={(nodeType) => Object.values(config.providers ?? {}).filter((provider) => supportsProviderCapability(provider, capabilityForWorkflowAction(nodeType)))} reasoningEffort={reasoningEffort} skillId={effectiveSkillId} onModelChange={onModelChange} onReasoningChange={onReasoningChange} onSkillChange={onSkillChange} providerConfiguredForNode={(nodeType) => isMediaProviderConfigured(providerForCapability(config, capabilityForWorkflowAction(nodeType)))} onSelectWorkflowFiles={selectWorkflowFiles} nodeExecutionSnapshots={workflowNodeSnapshots} locale={locale} /> : <WorkbenchWorkflowDirectory locale={locale} workflows={workflowDirectoryWorkflows} templates={workflowDirectoryTemplates} recentRuns={workflowDirectoryRuns} actionAvailability={{ duplicate: true, delete: true }} onAction={(action) => void handleWorkflowDirectoryAction(action)} />) : (selected.path === "/dashboard/image-assistant" || selected.path === "/dashboard/video" || selected.path === "/dashboard/capabilities") ? <DesktopMediaWorkspace route={selected} prompt={prompt} onPromptChange={setPrompt} runStatus={runStatus} activeRunId={activeRunId} onRun={(override, featureId, mediaInputs) => void runAgent(override, featureId, mediaInputs)} onCancel={() => void cancelActiveRun()} workflowAction={workflowAction} onWorkflowAction={setWorkflowAction} artifactRows={artifactRows} providerConfigured={isMediaProviderConfigured(activeProvider)} onOpenSettings={() => { setSettingsOpen(true); workbenchClient.navigation.go("/dashboard/settings"); }} onOpenTasks={() => workbenchClient.navigation.go("/dashboard/tasks")} onArtifactReveal={(relativePath, mimeType) => void workbenchClient.files.reveal(relativePath, mimeType)} onAddAttachments={addAttachments} onRemoveAttachment={removeAttachment} attachments={attachments} model={activeModel} models={activeModels} reasoningEffort={reasoningEffort} skillId={effectiveSkillId} onModelChange={updateModel} onReasoningChange={updateReasoning} onSkillChange={onSkillChange} locale={locale} /> : selected.path === "/dashboard/agent-platform" ? <WorkbenchAgentDirectory locale={locale} title={selected.label} description={selected.description} groups={directoryGroups} onAction={(card, action) => { if (action.id.startsWith("menu:")) { toggleMenuAgent(card.id); return; } if (action.id.startsWith("start:")) { void startNewConversationForAgent(card.id === "general" ? null : card.id); return; } workbenchClient.navigation.go(card.id === "general" ? "/dashboard/ai" : `/dashboard/ai?agent=${encodeURIComponent(card.id)}`); }} /> : selected.path === "/dashboard/settings" ? null : selected.mode === "library" ? <DesktopLibraryWorkspace route={selected} artifactRows={artifactRows} savedWorkflows={savedWorkflows} conversations={conversations} runs={runs} taskCount={taskCount} tokenCount={tokenCount} artifactCount={artifactCount} providerCost={providerCost} estimatedCost={estimatedCost} onNavigate={workbenchClient.navigation.go} onRetryRun={(run) => void prepareRunRetry(run)} onInspectRun={(runId) => workbenchClient.runs.inspect(runId).then(toRunDetail)} onArtifactRemove={(artifactId) => { void workbenchClient.artifacts.remove(artifactId).then(() => setArtifactRows((current) => current.filter((item) => item.id !== artifactId))); }} onArtifactReveal={(relativePath, mimeType) => void workbenchClient.files.reveal(relativePath, mimeType)} onKnowledgeOpen={(relativePath, mimeType) => void workbenchClient.knowledge.open(relativePath)} knowledgeQuery={knowledgeQuery} knowledgeResults={knowledgeResults} knowledgeStatus={knowledgeStatus} onKnowledgeQueryChange={setKnowledgeQuery} onKnowledgeSearch={() => void searchKnowledge()} locale={locale} /> : null}
      </section>
      </WorkbenchShell>
      {runtimeReady && questionSessionId ? <NativeQuestions key={questionSessionId} client={workbenchClient.questions} sessionId={questionSessionId} locale={locale} /> : null}
      {runtimeReady && selected.path === "/dashboard/workflows" && currentWorkflowRunId ? <NativeRunQuestions key={currentWorkflowRunId} client={workbenchClient} runId={currentWorkflowRunId} locale={locale} /> : null}
      </DesktopMediaHistoryContext.Provider>
    </div>
  );
}
