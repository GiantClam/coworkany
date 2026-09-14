"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AudioLines, ExternalLink, FileUp, ImageIcon, Trash2, Video } from "lucide-react"

import type { WorkflowBuiltinAgentOption, WorkflowCustomAgentOption } from "@/components/workflows/workflow-agent-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { buildModelSelectOptions, buildRuntimeFieldsForModel } from "@/lib/ai-runtime/ui"
import {
  findModelByCapabilityAndAlias,
  getDefaultModelId,
  getModelDefinition,
  listModels,
} from "@/lib/ai-runtime/model-registry"
import {
  getWorkflowImageDefaultSize,
  getWorkflowImageSizeOptions,
  normalizeGptImage2Size,
  normalizeRunningHubSeedreamSize,
  resolveWorkflowImageModelKind,
} from "@/lib/image-assistant/model-options"
import {
  pptFrontendTemplateOptions,
  pptPreviewModelOptions,
  pptPreviewRuntimeOptions,
  type PptPreviewRuntimeValue,
} from "@/lib/lead-tools/ppt-preview-data-fixed"
import { getDefaultWorkflowNodeTitle, type WorkflowDefinitionNode } from "@/lib/workflows/schema"

type WorkflowAssetCandidate = {
  id: number
  title: string
  kind: string
  mimeType: string | null
  previewKind: "image" | "video" | "audio" | "file"
  sourceUrl: string | null
  previewUrl: string
  downloadUrl: string
}

type UploadedWorkflowFile = {
  fileName: string
  mimeType: string
  storageKey?: string
  url?: string | null
}

type WorkflowLlmModelOption = {
  modelId: string
  label: string
  optionId?: string | null
}

type WorkflowLlmProviderOption = {
  providerId: string
  label: string
  models: WorkflowLlmModelOption[]
}

type WorkflowModelSelectOption = {
  value: string
  providerId: string
  modelId: string
  label: string
}

type WorkflowVoiceOption = {
  voiceId: string
  voiceName: string
  category: "system" | "voice_cloning" | "voice_generation"
  description: string[]
}

type KnowledgeDatasetOption = {
  id: number
  name: string
  category: string
  scope: "enterprise" | "personal"
}

type WriterPlatformOption = {
  value: string
  label: string
}

type WorkflowNodeEditorFieldsProps = {
  locale: "zh" | "en"
  node: WorkflowDefinitionNode
  assets: WorkflowAssetCandidate[]
  llmModelCatalog: {
    defaultProviderId: string | null
    defaultModelId: string | null
    providers: WorkflowLlmProviderOption[]
  }
  workflowImageProviderOptions: Array<{
    providerId: string
    label: string
    models: WorkflowLlmModelOption[]
  }>
  voiceOptions: WorkflowVoiceOption[]
  builtinAgents: WorkflowBuiltinAgentOption[]
  customAgents: WorkflowCustomAgentOption[]
  textPromptSuggestions?: Array<{
    sourceNodeKey: string
    sourceTitle: string
    alias: string
    token: string
    targetNodeKey: string
    targetNodeTitle: string
  }>
  uploadPending: boolean
  showPersistedPreview?: boolean
  onUpdateNode: (nodeKey: string, patch: Partial<WorkflowDefinitionNode>) => void
  onUploadFiles: (nodeKey: string, files: FileList | null) => Promise<void>
}

type OptionItem = {
  value: string
  label: string
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function buildAgentSelectValue(kind: "builtin" | "custom", id: string | number | null | undefined) {
  if (id == null || id === "") return ""
  return `${kind}:${String(id)}`
}

function parseAgentSelectValue(value: string) {
  const [kind, ...rest] = value.split(":")
  const rawId = rest.join(":").trim()
  if (!rawId) return null

  if (kind === "builtin") {
    return { kind, id: rawId } as const
  }

  if (kind === "custom") {
    const numericId = Number(rawId)
    if (Number.isInteger(numericId) && numericId > 0) {
      return { kind, id: numericId } as const
    }
  }

  return null
}

function buildWorkflowModelSelectionValue(input: {
  providerId: string
  modelId: string
}) {
  return `${input.providerId}::${encodeURIComponent(input.modelId)}`
}

function parseWorkflowModelSelectionValue(value: string) {
  const separatorIndex = value.indexOf("::")
  if (separatorIndex <= 0) return null
  const providerId = value.slice(0, separatorIndex).trim()
  const encodedModelId = value.slice(separatorIndex + 2)
  const modelId = decodeURIComponent(encodedModelId).trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

const WRITER_SUPPORTED_PROVIDER_IDS = new Set(["deepseek", "aiberm", "crazyroute", "pptoken"])

function getWorkflowPptRuntimeTitle(locale: "zh" | "en", runtime: PptPreviewRuntimeValue) {
  if (locale === "zh") {
    return runtime === "ppt-master-agent" ? "可编辑 PPT" : "HTML PPT"
  }

  return runtime === "ppt-master-agent" ? "Editable PPT" : "HTML PPT"
}

function buildWorkflowModelSelectOption(input: {
  providerId: string
  providerLabel: string
  modelId: string
  modelLabel?: string | null
  optionId?: string | null
}) {
  return {
    value:
      input.optionId ||
      buildWorkflowModelSelectionValue({
        providerId: input.providerId,
        modelId: input.modelId,
      }),
    providerId: input.providerId,
    modelId: input.modelId,
    label: `${input.providerLabel} / ${(input.modelLabel || input.modelId).trim() || input.modelId}`,
  } satisfies WorkflowModelSelectOption
}

function SectionLabel({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold text-muted-foreground">{children}</div>
}

function getVoiceCategoryLabel(locale: "zh" | "en", category: WorkflowVoiceOption["category"]) {
  if (locale === "zh") {
    if (category === "system") return "系统音色"
    if (category === "voice_cloning") return "复刻音色"
    return "生成音色"
  }

  if (category === "system") return "System"
  if (category === "voice_cloning") return "Cloned"
  return "Generated"
}

function getTextPromptAutocompleteState(text: string, selectionStart: number | null) {
  if (selectionStart === null || selectionStart < 2) return null
  const beforeCursor = text.slice(0, selectionStart)
  const tokenStart = beforeCursor.lastIndexOf("{{")
  if (tokenStart === -1) return null
  const latestTokenEnd = beforeCursor.lastIndexOf("}}")
  if (latestTokenEnd > tokenStart) return null

  const rawQuery = beforeCursor.slice(tokenStart + 2)
  if (rawQuery.includes("\n") || rawQuery.includes("}")) return null

  return {
    tokenStart,
    selectionStart,
    query: rawQuery.trim().toLowerCase(),
  }
}

function OptionChips({
  options,
  value,
  onChange,
}: {
  options: OptionItem[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border/70 bg-background/80 text-foreground hover:border-primary/40 hover:bg-background",
            ].join(" ")}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function MediaPreview({
  kind,
  url,
  title,
  locale,
}: {
  kind: "image" | "video" | "audio"
  url: string
  title: string
  locale: "zh" | "en"
}) {
  const copy =
    locale === "zh"
      ? {
          latestPreview: "最近预览",
        }
      : {
          latestPreview: "Latest preview",
        }

  return (
    <div className="overflow-hidden rounded-[12px] border border-border/70 bg-background/70">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        {kind === "image" ? <ImageIcon className="size-3.5 text-muted-foreground" /> : null}
        {kind === "video" ? <Video className="size-3.5 text-muted-foreground" /> : null}
        {kind === "audio" ? <AudioLines className="size-3.5 text-muted-foreground" /> : null}
        <div className="truncate text-[11px] font-semibold text-muted-foreground">{copy.latestPreview}</div>
      </div>
      <div className="p-2">
        {kind === "image" ? (
          <img src={url} alt={title} className="aspect-video w-full rounded-[10px] object-cover" />
        ) : null}
        {kind === "video" ? (
          <video src={url} controls className="aspect-video w-full rounded-[10px] bg-black/80" />
        ) : null}
        {kind === "audio" ? (
          <div className="rounded-[10px] bg-card/80 p-3">
            <audio src={url} controls className="w-full" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function WorkflowNodeEditorFields({
  locale,
  node,
  assets,
  llmModelCatalog,
  workflowImageProviderOptions,
  voiceOptions,
  builtinAgents,
  customAgents,
  textPromptSuggestions = [],
  uploadPending,
  showPersistedPreview = true,
  onUpdateNode,
  onUploadFiles,
}: WorkflowNodeEditorFieldsProps) {
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [textSelectionStart, setTextSelectionStart] = useState<number | null>(null)
  const [textInputFocused, setTextInputFocused] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [enterpriseKnowledgeDatasets, setEnterpriseKnowledgeDatasets] = useState<KnowledgeDatasetOption[]>([])
  const [personalKnowledgeDatasets, setPersonalKnowledgeDatasets] = useState<KnowledgeDatasetOption[]>([])
  const copy =
    locale === "zh"
      ? {
          uploadNew: "上传新素材",
          uploadedFiles: "已上传",
          libraryRefs: "资产库",
          textValue: "文本",
          assetLibrary: "打开资产库",
          uploadPending: "上传中...",
          removeUpload: "移除",
          noUploads: "还没有文件。",
          noAssetCandidates: "资产库暂时没有可选素材。",
          suggestionTarget: "用于",
          provider: "Provider",
          model: "模型",
          systemPrompt: "系统提示词",
          agent: "Agent",
          builtinAgents: "内置 Agent",
          enterpriseAgents: "企业 Agent",
          agentPrompt: "Agent 提示",
          agentPromptPlaceholder: "没有上游文本时，填写这里作为 Agent 输入。",
          agentTools: "Agent 工具",
          webSearch: "启用 Web Search",
          webSearchHint: "默认关闭。仅在当前 Agent 需要联网检索最新信息时再开启。",
          noBuiltinAgents: "还没有可选内置 Agent。",
          noCustomAgents: "还没有可选企业 Agent。",
          workflowUnsupportedAgent: "当前 Agent 不适用于 workflow 普通节点，请改用专门的 PPT 节点。",
          agentMode: "执行模式",
          agentCategory: "类别",
          general: "通用",
          executive: "专家顾问",
          business: "业务",
          linkedWorkflow: "关联工作流",
          knowledgeDatasets: "知识库",
          knowledgeQuery: "检索查询",
          knowledgeTopK: "返回条数",
          knowledgeCategory: "知识分类",
          knowledgeDocumentTitle: "知识标题",
          noKnowledgeDatasets: "暂无可用知识库。",
          prompt: "提示词",
          promptPlaceholder: "输入图片生成提示词。",
          writerPlatform: "平台",
          writerMode: "体裁",
          writerLanguage: "输出语言",
          size: "尺寸",
          resolution: "分辨率",
          count: "数量",
          quality: "质量",
          background: "背景",
          format: "格式",
          compression: "压缩率",
          moderation: "审核",
          customSize: "自定义尺寸",
          customSizePlaceholder: "例如 1536x864",
          autoSize: "自动",
          unsupportedModelParams: "当前模型暂未配置参数面板。",
          mode: "模式",
          autoVideoMode: "自动：输入图片时图生视频，无图片时文生视频。",
          duration: "时长",
          ratio: "画幅",
          sound: "音频",
          realPerson: "真人模式",
          avatarImageUrl: "人物图片 URL",
          audioUrl: "音频 URL",
          script: "口播文案",
          scenePrompt: "场景提示词",
          estimatedVideoSeconds: "视频秒数",
          audioTrimStart: "音频起点",
          audioTrimEnd: "音频终点",
          genre: "类型",
          mood: "情绪",
          vocals: "演唱",
          lyrics: "歌词",
          voice: "音色",
          chooseVoice: "选择音色",
          noVoiceOptions: "暂时没有可选音色。",
          languageBoost: "语言增强",
          speed: "语速",
          volume: "音量",
          pitch: "音高",
          pageCount: "页数",
          pptAgent: "PPT 类型",
          pptAgentHint: "HTML PPT 输出网页化演示稿；可编辑 PPT 输出可继续修改的 PPT 成品。",
          pptTemplate: "模板",
          pptTemplateHint: "可编辑 PPT 不会自动生成 4 个模板预览。先选择模板，再运行生成。",
          pptTemplatePending: "先返回模板建议",
          scenario: "场景",
          language: "语言",
          fileName: "文件名称",
          fileNamePlaceholder: "留空时自动生成不重复名称",
          fileNameHint: "如果资产库中存在同名文件，将使用新结果覆盖旧文件。",
          fileFormat: "文件格式",
          fileNodeHint: "先将文本结果物化为文件，再连接到资产库节点。",
          persistToWorkLibrary: "同步到作品库",
          persistToKnowledgeBase: "加入知识入库队列",
          knowledgeTargetType: "知识目标",
          knowledgeTargetTypeHint: "默认使用 knowledge_base，可沿当前知识入库任务路由扩展。",
          latestPreview: "最近预览",
          auto: "自动",
          modelAuto: "自动路由",
          on: "开启",
          off: "关闭",
        }
      : {
          uploadNew: "Upload files",
          uploadedFiles: "Uploads",
          libraryRefs: "Asset library",
          textValue: "Text",
          assetLibrary: "Open asset library",
          uploadPending: "Uploading...",
          removeUpload: "Remove",
          noUploads: "No files yet.",
          noAssetCandidates: "No matching assets yet.",
          suggestionTarget: "For",
          provider: "Provider",
          model: "Model",
          systemPrompt: "System prompt",
          agent: "Agent",
          builtinAgents: "Built-in agents",
          enterpriseAgents: "Enterprise agents",
          agentPrompt: "Agent prompt",
          agentPromptPlaceholder: "Used as the agent input when no upstream text is connected.",
          agentTools: "Agent tools",
          webSearch: "Enable web search",
          webSearchHint: "Off by default. Turn it on only when this agent needs fresh external information.",
          noBuiltinAgents: "No built-in agents available yet.",
          noCustomAgents: "No enterprise agents available yet.",
          workflowUnsupportedAgent: "This agent is not supported inside a standard workflow agent node. Use the dedicated PPT node instead.",
          agentMode: "Execution mode",
          agentCategory: "Category",
          general: "General",
          executive: "Executive",
          business: "Business",
          linkedWorkflow: "Linked workflow",
          knowledgeDatasets: "Knowledge datasets",
          knowledgeQuery: "Retrieve query",
          knowledgeTopK: "Top K",
          knowledgeCategory: "Knowledge category",
          knowledgeDocumentTitle: "Document title",
          noKnowledgeDatasets: "No knowledge datasets available yet.",
          prompt: "Prompt",
          promptPlaceholder: "Write the image prompt.",
          writerPlatform: "Platform",
          writerMode: "Format",
          writerLanguage: "Output language",
          size: "Size",
          resolution: "Resolution",
          count: "Count",
          quality: "Quality",
          background: "Background",
          format: "Format",
          compression: "Compression",
          moderation: "Moderation",
          customSize: "Custom size",
          customSizePlaceholder: "For example 1536x864",
          autoSize: "Auto",
          unsupportedModelParams: "This model does not have a configured parameter panel yet.",
          mode: "Mode",
          autoVideoMode: "Auto: image input creates image-to-video; otherwise text-to-video.",
          duration: "Duration",
          ratio: "Ratio",
          sound: "Sound",
          realPerson: "Real-person",
          avatarImageUrl: "Avatar image URL",
          audioUrl: "Audio URL",
          script: "Script",
          scenePrompt: "Scene prompt",
          estimatedVideoSeconds: "Video seconds",
          audioTrimStart: "Audio start",
          audioTrimEnd: "Audio end",
          genre: "Genre",
          mood: "Mood",
          vocals: "Vocals",
          lyrics: "Lyrics",
          voice: "Voice",
          chooseVoice: "Choose a voice",
          noVoiceOptions: "No voices available right now.",
          languageBoost: "Language boost",
          speed: "Speed",
          volume: "Volume",
          pitch: "Pitch",
          pageCount: "Pages",
          pptAgent: "PPT type",
          pptAgentHint: "HTML PPT outputs a web-based deck; Editable PPT outputs a deck that can keep being edited.",
          pptTemplate: "Template",
          pptTemplateHint: "Editable PPT will not auto-generate four preview decks. Choose one template first, then run generation.",
          pptTemplatePending: "Show recommendations first",
          scenario: "Scenario",
          language: "Language",
          fileName: "File name",
          fileNamePlaceholder: "Leave empty to auto-generate a unique name",
          fileNameHint: "If the asset library already contains the same file name, the new result replaces it.",
          fileFormat: "File format",
          fileNodeHint: "Materialize text into a file first, then connect it to the asset library node.",
          persistToWorkLibrary: "Also save to work library",
          persistToKnowledgeBase: "Queue for knowledge ingestion",
          knowledgeTargetType: "Knowledge target",
          knowledgeTargetTypeHint: "Defaults to knowledge_base and stays compatible with the current ingestion queue.",
          latestPreview: "Latest preview",
          auto: "Auto",
          modelAuto: "Auto routing",
          on: "On",
          off: "Off",
        }

  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetch("/api/knowledge/datasets", {
        credentials: "same-origin",
        cache: "no-store",
      }),
      fetch("/api/knowledge/personal-datasets", {
        credentials: "same-origin",
        cache: "no-store",
      }),
    ])
      .then(async ([enterpriseResponse, personalResponse]) => {
        const [enterprisePayload, personalPayload] = await Promise.all([
          enterpriseResponse.json().catch(() => null),
          personalResponse.json().catch(() => null),
        ])
        if (!enterpriseResponse.ok) {
          throw new Error(typeof enterprisePayload?.error === "string" ? enterprisePayload.error : "knowledge_datasets_failed")
        }

        const enterpriseItems = Array.isArray(enterprisePayload?.data?.items) ? enterprisePayload.data.items : []
        const personalItems = Array.isArray(personalPayload?.data?.items) ? personalPayload.data.items : []
        if (cancelled) return
        setEnterpriseKnowledgeDatasets(
          enterpriseItems
            .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .map((item: Record<string, unknown>) => ({
              id: typeof item.id === "number" ? item.id : 0,
              name: typeof item.name === "string" ? item.name : `Dataset ${String(item.id || "")}`,
              category: typeof item.category === "string" ? item.category : "general",
              scope: "enterprise" as const,
            }))
            .filter((item: KnowledgeDatasetOption) => item.id > 0),
        )
        setPersonalKnowledgeDatasets(
          personalItems
            .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .map((item: Record<string, unknown>) => ({
              id: typeof item.id === "number" ? item.id : 0,
              name: typeof item.name === "string" ? item.name : `Dataset ${String(item.id || "")}`,
              category: typeof item.category === "string" ? item.category : "general",
              scope: "personal" as const,
            }))
            .filter((item: KnowledgeDatasetOption) => item.id > 0),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setEnterpriseKnowledgeDatasets([])
          setPersonalKnowledgeDatasets([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateConfig = (patch: Record<string, unknown>) => {
    onUpdateNode(node.nodeKey, {
      config: {
        ...node.config,
        ...patch,
      },
    })
  }

  const uploadedFiles = Array.isArray(node.config.uploadedFiles)
    ? node.config.uploadedFiles.filter((item): item is UploadedWorkflowFile => Boolean(item && typeof item === "object"))
    : []
  const referencedArtifactIds = Array.isArray(node.config.referencedArtifactIds)
    ? node.config.referencedArtifactIds.filter((value): value is number => Number.isInteger(value) && value > 0)
    : []

  const previewImageUrl = asString(node.config.previewImageUrl)
  const previewImageTitle = asString(node.config.previewImageTitle) || node.title
  const previewVideoUrl = asString(node.config.previewVideoUrl)
  const previewVideoTitle = asString(node.config.previewVideoTitle) || node.title
  const previewAudioUrl = asString(node.config.previewAudioUrl)
  const previewAudioTitle = asString(node.config.previewAudioTitle) || node.title
  const selectedBuiltinAgentId =
    typeof node.config.agentId === "string"
      ? node.config.agentId
      : typeof node.config.builtinAgentId === "string"
        ? node.config.builtinAgentId
        : ""
  const selectedCustomAgentId =
    typeof node.config.customAgentId === "number" ? String(node.config.customAgentId) : asString(node.config.customAgentId)
  const selectedAgentValue = selectedCustomAgentId
    ? buildAgentSelectValue("custom", selectedCustomAgentId)
    : selectedBuiltinAgentId
      ? buildAgentSelectValue("builtin", selectedBuiltinAgentId)
      : ""
  const selectedCustomAgent =
    customAgents.find((agent) => String(agent.id) === selectedCustomAgentId) || null
  const selectedBuiltinAgent = builtinAgents.find((agent) => agent.id === selectedBuiltinAgentId) || null
  const selectedKnowledgeDatasetIds = Array.isArray(node.config.selectedDatasetIds)
    ? node.config.selectedDatasetIds.filter((value): value is number => Number.isInteger(value) && value > 0)
    : []
  const selectedPersonalKnowledgeDatasetIds = Array.isArray(node.config.selectedPersonalDatasetIds)
    ? node.config.selectedPersonalDatasetIds.filter((value): value is number => Number.isInteger(value) && value > 0)
    : []
  const selectedKnowledgeWriteDatasetScope = asString(node.config.datasetScope) === "personal" ? "personal" : "enterprise"
  const selectedKnowledgeWriteDatasetValue =
    typeof node.config.datasetId === "number" && node.config.datasetId > 0
      ? `${selectedKnowledgeWriteDatasetScope}:${node.config.datasetId}`
      : ""
  const languageOptions: OptionItem[] = [
    { value: "zh-CN", label: locale === "zh" ? "中文" : "Chinese" },
    { value: "en-US", label: locale === "zh" ? "英文" : "English" },
    { value: "bilingual", label: locale === "zh" ? "双语" : "Bilingual" },
  ]
  const writerPlatformOptions: WriterPlatformOption[] =
    locale === "zh"
      ? [
          { value: "wechat", label: "公众号" },
          { value: "xiaohongshu", label: "小红书" },
          { value: "weibo", label: "微博" },
          { value: "douyin", label: "抖音" },
          { value: "x", label: "X" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "instagram", label: "Instagram" },
          { value: "tiktok", label: "TikTok" },
          { value: "facebook", label: "Facebook" },
          { value: "generic", label: "通用文稿" },
        ]
      : [
          { value: "wechat", label: "WeChat" },
          { value: "xiaohongshu", label: "Xiaohongshu" },
          { value: "weibo", label: "Weibo" },
          { value: "douyin", label: "Douyin" },
          { value: "x", label: "X" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "instagram", label: "Instagram" },
          { value: "tiktok", label: "TikTok" },
          { value: "facebook", label: "Facebook" },
          { value: "generic", label: "Generic" },
        ]
  const writerModeOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "article", label: "文章" },
          { value: "thread", label: "串文" },
        ]
      : [
          { value: "article", label: "Article" },
          { value: "thread", label: "Thread" },
        ]
  const writerLanguageOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "auto", label: "自动" },
          { value: "zh", label: "中文" },
          { value: "en", label: "English" },
          { value: "ja", label: "日本語" },
          { value: "ko", label: "한국어" },
          { value: "fr", label: "Français" },
          { value: "de", label: "Deutsch" },
          { value: "es", label: "Español" },
        ]
      : [
          { value: "auto", label: "Auto" },
          { value: "zh", label: "Chinese" },
          { value: "en", label: "English" },
          { value: "ja", label: "Japanese" },
          { value: "ko", label: "Korean" },
          { value: "fr", label: "French" },
          { value: "de", label: "German" },
          { value: "es", label: "Spanish" },
        ]
  const workflowImageProviders = workflowImageProviderOptions
  const imageQualityOptions: OptionItem[] = ["auto", "low", "medium", "high"].map((value) => ({ value, label: value }))
  const imageBackgroundOptions: OptionItem[] = ["auto", "opaque", "transparent"].map((value) => ({ value, label: value }))
  const imageFormatOptions: OptionItem[] = ["png", "jpeg", "webp"].map((value) => ({ value, label: value }))
  const imageModerationOptions: OptionItem[] = ["auto", "low"].map((value) => ({ value, label: value }))
  const videoModelDefinitions = (() => {
    const seen = new Set<string>()
    return [
      ...listModels({ capability: "video.text_to_video" }),
      ...listModels({ capability: "video.image_to_video" }),
    ].filter((model) => {
      if (seen.has(model.id)) return false
      seen.add(model.id)
      return true
    })
  })()
  const resolvedVideoModel =
    videoModelDefinitions.find((model) => model.id === asString(node.config.model)) ||
    videoModelDefinitions.find((model) => model.providerMetadata?.nativeModel === asString(node.config.model)) ||
    getModelDefinition(getDefaultModelId("video.text_to_video") || "") ||
    videoModelDefinitions[0] ||
    null
  const currentVideoModelId = resolvedVideoModel?.id || getDefaultModelId("video.text_to_video") || ""
  const videoModelOptions: OptionItem[] = buildModelSelectOptions(videoModelDefinitions).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const videoParameterFields =
    resolvedVideoModel
      ? buildRuntimeFieldsForModel(resolvedVideoModel, locale).filter((field) => field.id !== "model")
      : []
  const digitalHumanModelOptions: OptionItem[] = buildModelSelectOptions(listModels({ capability: "video.digital_human" })).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const currentDigitalHumanModelId =
    findModelByCapabilityAndAlias({
      capability: "video.digital_human",
      value: asString(node.config.model),
    })?.id ||
    getDefaultModelId("video.digital_human") ||
    digitalHumanModelOptions[0]?.value ||
    ""
  const audioGenerateModelDefinitions = listModels({ capability: "audio.generate" })
  const audioGenerateModelOptions: OptionItem[] = buildModelSelectOptions(audioGenerateModelDefinitions).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const currentAudioGenerateModelId =
    findModelByCapabilityAndAlias({
      capability: "audio.generate",
      value: asString(node.config.model),
    })?.id ||
    getDefaultModelId("audio.generate") ||
    audioGenerateModelOptions[0]?.value ||
    ""
  const voiceSynthesisModelDefinitions = listModels({ capability: "audio.voice_synthesis" })
  const voiceSynthesisModelOptions: OptionItem[] = buildModelSelectOptions(voiceSynthesisModelDefinitions).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const currentVoiceSynthesisModelId =
    findModelByCapabilityAndAlias({
      capability: "audio.voice_synthesis",
      value: asString(node.config.model),
    })?.id ||
    getDefaultModelId("audio.voice_synthesis") ||
    voiceSynthesisModelOptions[0]?.value ||
    ""
  const pptModelOptions: OptionItem[] = pptPreviewModelOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const pptRuntimeOptions: OptionItem[] = pptPreviewRuntimeOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const currentPptRuntimeId =
    (asString(node.config.previewRuntime) as PptPreviewRuntimeValue) || pptPreviewRuntimeOptions[0]?.value || "frontend-slides-agent"
  const currentPptModelId = asString(node.config.model) || pptModelOptions[0]?.value || "deepseek-v4-pro"
  const audioGenreOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "electronic-pop", label: "电子流行" },
          { value: "cinematic", label: "电影配乐" },
          { value: "ambient", label: "氛围电子" },
          { value: "corporate", label: "品牌宣传" },
        ]
      : [
          { value: "electronic-pop", label: "Electronic pop" },
          { value: "cinematic", label: "Cinematic" },
          { value: "ambient", label: "Ambient" },
          { value: "corporate", label: "Corporate" },
        ]
  const audioMoodOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "uplifting", label: "向上" },
          { value: "calm", label: "冷静" },
          { value: "dramatic", label: "戏剧" },
          { value: "energetic", label: "高能" },
        ]
      : [
          { value: "uplifting", label: "Uplifting" },
          { value: "calm", label: "Calm" },
          { value: "dramatic", label: "Dramatic" },
          { value: "energetic", label: "Energetic" },
        ]
  const audioVocalsOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "instrumental", label: "纯音乐" },
          { value: "female", label: "女声" },
          { value: "male", label: "男声" },
          { value: "choir", label: "合唱" },
        ]
      : [
          { value: "instrumental", label: "Instrumental" },
          { value: "female", label: "Female vocal" },
          { value: "male", label: "Male vocal" },
          { value: "choir", label: "Choir" },
        ]
  const lyricsOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "ai_generate", label: "AI 写词" },
          { value: "manual", label: "固定歌词" },
        ]
      : [
          { value: "ai_generate", label: "AI lyrics" },
          { value: "manual", label: "Fixed lyrics" },
        ]
  const languageBoostOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "auto", label: "自动" },
          { value: "Chinese", label: "中文" },
          { value: "English", label: "English" },
        ]
      : [
          { value: "auto", label: "Auto" },
          { value: "Chinese", label: "Chinese" },
          { value: "English", label: "English" },
        ]
  const speechSpeedOptions: OptionItem[] = ["0.8", "1", "1.2"].map((value) => ({ value, label: `${value}x` }))
  const speechVolumeOptions: OptionItem[] = ["0.8", "1", "1.2"].map((value) => ({ value, label: `${value}x` }))
  const speechPitchOptions: OptionItem[] = ["0.8", "1", "1.2"].map((value) => ({ value, label: `${value}x` }))
  const pageCountOptions: OptionItem[] = ["6", "8", "10", "12"].map((value) => ({ value, label: value }))
  const editablePptTemplateOptions: OptionItem[] = [
    { value: "", label: copy.pptTemplatePending },
    ...pptFrontendTemplateOptions.map((option) => ({
      value: option.id,
      label: locale === "zh" ? option.label.zh : option.label.en,
    })),
  ]
  const fileFormatOptions: OptionItem[] = [
    { value: "md", label: "MD" },
    { value: "txt", label: "TXT" },
    { value: "html", label: "HTML" },
    { value: "json", label: "JSON" },
  ]
  const scenarioOptions: OptionItem[] =
    locale === "zh"
      ? [
          { value: "marketing-campaign", label: "营销方案" },
          { value: "product-launch", label: "产品发布" },
          { value: "sales-deck", label: "销售提案" },
        ]
      : [
          { value: "marketing-campaign", label: "Campaign" },
          { value: "product-launch", label: "Launch" },
          { value: "sales-deck", label: "Proposal" },
        ]
  const currentSelectedProviderId =
    asString(node.config.selectedProviderId) || llmModelCatalog.defaultProviderId || llmModelCatalog.providers[0]?.providerId || ""
  const activeProvider =
    llmModelCatalog.providers.find((provider) => provider.providerId === currentSelectedProviderId) ||
    llmModelCatalog.providers[0] ||
    null
  const currentSelectedModelId =
    asString(node.config.selectedModelId) || activeProvider?.models[0]?.modelId || llmModelCatalog.defaultModelId || ""
  const llmModelSelectOptions: WorkflowModelSelectOption[] = llmModelCatalog.providers.flatMap((provider) =>
    provider.models.map((model) =>
      buildWorkflowModelSelectOption({
        providerId: provider.providerId,
        providerLabel: provider.label,
        modelId: model.modelId,
        modelLabel: model.label,
        optionId: model.optionId,
      }),
    ),
  )
  const currentLlmModelSelectionValue =
    llmModelSelectOptions.find(
      (option) =>
        option.providerId === currentSelectedProviderId &&
        option.modelId === currentSelectedModelId,
    )?.value ||
    (currentSelectedProviderId && currentSelectedModelId
      ? buildWorkflowModelSelectionValue({
          providerId: currentSelectedProviderId,
          modelId: currentSelectedModelId,
        })
      : "")
  if (
    currentSelectedProviderId &&
    currentSelectedModelId &&
    currentLlmModelSelectionValue &&
    !llmModelSelectOptions.some((option) => option.value === currentLlmModelSelectionValue)
  ) {
    llmModelSelectOptions.push(
      buildWorkflowModelSelectOption({
        providerId: currentSelectedProviderId,
        providerLabel: activeProvider?.label || currentSelectedProviderId,
        modelId: currentSelectedModelId,
      }),
    )
  }
  const currentAgentProviderId =
    asString(node.config.selectedProviderId) || activeProvider?.providerId || llmModelCatalog.defaultProviderId || ""
  const currentAgentModelId =
    asString(node.config.selectedModelId) || activeProvider?.models[0]?.modelId || llmModelCatalog.defaultModelId || ""
  const currentAgentModelSelectionValue =
    llmModelSelectOptions.find(
      (option) =>
        option.providerId === currentAgentProviderId &&
        option.modelId === currentAgentModelId,
    )?.value ||
    (currentAgentProviderId && currentAgentModelId
      ? buildWorkflowModelSelectionValue({
          providerId: currentAgentProviderId,
          modelId: currentAgentModelId,
        })
      : "")
  const writerProviders = llmModelCatalog.providers.filter((provider) =>
    WRITER_SUPPORTED_PROVIDER_IDS.has(provider.providerId),
  )
  const writerModelCatalogProviders = writerProviders.length > 0 ? writerProviders : llmModelCatalog.providers
  const currentWriterProviderId =
    asString(node.config.selectedProviderId) ||
    writerModelCatalogProviders[0]?.providerId ||
    llmModelCatalog.defaultProviderId ||
    ""
  const activeWriterProvider =
    writerModelCatalogProviders.find((provider) => provider.providerId === currentWriterProviderId) ||
    writerModelCatalogProviders[0] ||
    null
  const currentWriterModelId =
    asString(node.config.selectedModelId) ||
    activeWriterProvider?.models[0]?.modelId ||
    llmModelCatalog.defaultModelId ||
    ""
  const writerModelSelectOptions: WorkflowModelSelectOption[] = writerModelCatalogProviders.flatMap((provider) =>
    provider.models.map((model) =>
      buildWorkflowModelSelectOption({
        providerId: provider.providerId,
        providerLabel: provider.label,
        modelId: model.modelId,
        modelLabel: model.label,
        optionId: model.optionId,
      }),
    ),
  )
  const currentWriterModelSelectionValue =
    writerModelSelectOptions.find(
      (option) =>
        option.providerId === currentWriterProviderId &&
        option.modelId === currentWriterModelId,
    )?.value ||
    (currentWriterProviderId && currentWriterModelId
      ? buildWorkflowModelSelectionValue({
          providerId: currentWriterProviderId,
          modelId: currentWriterModelId,
        })
      : "")
  if (
    currentWriterProviderId &&
    currentWriterModelId &&
    currentWriterModelSelectionValue &&
    !writerModelSelectOptions.some((option) => option.value === currentWriterModelSelectionValue)
  ) {
    writerModelSelectOptions.push(
      buildWorkflowModelSelectOption({
        providerId: currentWriterProviderId,
        providerLabel: activeWriterProvider?.label || currentWriterProviderId,
        modelId: currentWriterModelId,
      }),
    )
  }
  const currentImageProviderId =
    asString(node.config.selectedProviderId) || workflowImageProviders[0]?.providerId || "pptoken"
  const activeImageProvider =
    workflowImageProviders.find((provider) => provider.providerId === currentImageProviderId) ||
    workflowImageProviders[0] ||
    null
  const currentImageModelId =
    asString(node.config.selectedModelId) || activeImageProvider?.models[0]?.modelId || "gpt-image-2"
  const currentImageModelOptionId = asString(node.config.selectedModelOptionId)
  const imageModelSelectOptions: WorkflowModelSelectOption[] = workflowImageProviders.flatMap((provider) =>
    provider.models.map((model) =>
      buildWorkflowModelSelectOption({
        providerId: provider.providerId,
        providerLabel: provider.label,
        modelId: model.modelId,
        modelLabel: model.label,
        optionId: model.optionId,
      }),
    ),
  )
  const currentImageModelSelectionValue =
    imageModelSelectOptions.find((option) => option.value === currentImageModelOptionId)?.value ||
    imageModelSelectOptions.find(
      (option) =>
        option.providerId === currentImageProviderId &&
        option.modelId === currentImageModelId,
    )?.value ||
    (currentImageProviderId && currentImageModelId
      ? buildWorkflowModelSelectionValue({
          providerId: currentImageProviderId,
          modelId: currentImageModelId,
        })
      : "")
  if (
    currentImageProviderId &&
    currentImageModelId &&
    currentImageModelSelectionValue &&
    !imageModelSelectOptions.some((option) => option.value === currentImageModelSelectionValue)
  ) {
    imageModelSelectOptions.push(
      buildWorkflowModelSelectOption({
        providerId: currentImageProviderId,
        providerLabel: activeImageProvider?.label || currentImageProviderId,
        modelId: currentImageModelId,
      }),
    )
  }
  const currentImageModelKind = resolveWorkflowImageModelKind(currentImageModelId)
  const imageModelSizeOptions: OptionItem[] = getWorkflowImageSizeOptions(currentImageModelKind).map((option) => ({
    value: option.value,
    label:
      option.value === "auto"
        ? copy.autoSize
        : option.value === "custom"
          ? copy.customSize
          : option.label,
  }))
  const currentImageSize = asString(node.config.imageSize)
  const imageSizeSelection = imageModelSizeOptions.some((option) => option.value === currentImageSize)
    ? currentImageSize
    : currentImageSize
      ? "custom"
      : getWorkflowImageDefaultSize(currentImageModelKind)

  const textPromptAutocompleteState = useMemo(
    () => getTextPromptAutocompleteState(asString(node.config.text), textSelectionStart),
    [node.config.text, textSelectionStart],
  )
  const filteredTextPromptSuggestions = useMemo(() => {
    if (!textInputFocused || !textPromptAutocompleteState) return []
    const query = textPromptAutocompleteState.query
    return textPromptSuggestions.filter((suggestion) => {
      if (!query) return true
      return (
        suggestion.alias.toLowerCase().includes(query) ||
        suggestion.sourceNodeKey.toLowerCase().includes(query) ||
        suggestion.sourceTitle.toLowerCase().includes(query) ||
        suggestion.targetNodeTitle.toLowerCase().includes(query)
      )
    })
  }, [textInputFocused, textPromptAutocompleteState, textPromptSuggestions])

  useEffect(() => {
    setActiveSuggestionIndex(0)
  }, [filteredTextPromptSuggestions.length, textPromptAutocompleteState?.query])

  const applyTextPromptSuggestion = (token: string) => {
    if (!token) return
    const currentText = asString(node.config.text)
    const selectionStart = textInputRef.current?.selectionStart ?? textSelectionStart
    const autocompleteState = getTextPromptAutocompleteState(currentText, selectionStart)
    if (!autocompleteState) return

    const nextText =
      currentText.slice(0, autocompleteState.tokenStart) +
      token +
      currentText.slice(autocompleteState.selectionStart)
    const nextCursor = autocompleteState.tokenStart + token.length

    updateConfig({ text: nextText })
    setTextSelectionStart(nextCursor)

    window.requestAnimationFrame(() => {
      textInputRef.current?.focus()
      textInputRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return (
    <div className="space-y-3">
      {showPersistedPreview && previewImageUrl ? (
        <MediaPreview kind="image" url={previewImageUrl} title={previewImageTitle} locale={locale} />
      ) : null}
      {showPersistedPreview && previewVideoUrl ? (
        <MediaPreview kind="video" url={previewVideoUrl} title={previewVideoTitle} locale={locale} />
      ) : null}
      {showPersistedPreview && previewAudioUrl ? (
        <MediaPreview kind="audio" url={previewAudioUrl} title={previewAudioTitle} locale={locale} />
      ) : null}

      {node.type === "upload" ? (
        <div className="space-y-3">
          <div className="rounded-[12px] border border-border/70 bg-background/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>{copy.uploadedFiles}</SectionLabel>
              <button
                type="button"
                data-node-no-drag="true"
                className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={uploadPending}
                onClick={(event) => {
                  event.stopPropagation()
                  uploadInputRef.current?.click()
                }}
              >
                <FileUp className="size-3.5" />
                {uploadPending ? copy.uploadPending : copy.uploadNew}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                disabled={uploadPending}
                onChange={(event) => {
                  void onUploadFiles(node.nodeKey, event.target.files)
                  event.currentTarget.value = ""
                }}
              />
            </div>

            <div className="mt-3 space-y-2">
              {uploadedFiles.length === 0 ? <div className="text-xs text-muted-foreground">{copy.noUploads}</div> : null}
              {uploadedFiles.map((file, index) => (
                <div
                  key={`${file.storageKey || file.fileName}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border/70 bg-card/80 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{file.fileName}</div>
                    <div className="text-xs text-muted-foreground">{file.mimeType}</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-[8px] px-2 text-[10px]"
                    onClick={() =>
                      updateConfig({
                        uploadedFiles: uploadedFiles.filter((_, uploadedIndex) => uploadedIndex !== index),
                      })
                    }
                  >
                    <Trash2 className="size-3" />
                    {copy.removeUpload}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[12px] border border-border/70 bg-background/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>{copy.libraryRefs}</SectionLabel>
              <Link
                href="/dashboard/assets"
                target="_blank"
                className="inline-flex items-center gap-2 rounded-[8px] border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
              >
                <ExternalLink className="size-3.5" />
                {copy.assetLibrary}
              </Link>
            </div>

            <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
              {assets.length === 0 ? <div className="text-xs text-muted-foreground">{copy.noAssetCandidates}</div> : null}
              {assets.map((asset) => {
                const checked = referencedArtifactIds.includes(asset.id)
                return (
                  <label key={asset.id} className="flex gap-2 rounded-[10px] border border-border/70 bg-card/80 p-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        updateConfig({
                          referencedArtifactIds: event.target.checked
                            ? [...referencedArtifactIds, asset.id]
                            : referencedArtifactIds.filter((artifactId) => artifactId !== asset.id),
                        })
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{asset.title}</div>
                      <div className="text-xs text-muted-foreground">
                        #{asset.id} · {asset.kind}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {node.type === "text_input" ? (
        <div className="space-y-2">
          <SectionLabel>{copy.textValue}</SectionLabel>
          <div className="relative">
            <Textarea
              ref={textInputRef}
              data-agent-config={`${node.nodeKey}:text`}
              value={asString(node.config.text)}
              onChange={(event) => {
                updateConfig({ text: event.target.value })
                setTextSelectionStart(event.target.selectionStart)
              }}
              onSelect={(event) => setTextSelectionStart(event.currentTarget.selectionStart)}
              onClick={(event) => setTextSelectionStart(event.currentTarget.selectionStart)}
              onFocus={(event) => {
                setTextInputFocused(true)
                setTextSelectionStart(event.currentTarget.selectionStart)
              }}
              onBlur={() => {
                window.setTimeout(() => setTextInputFocused(false), 120)
              }}
              onKeyDown={(event) => {
                if (filteredTextPromptSuggestions.length === 0) return
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setActiveSuggestionIndex((current) => (current + 1) % filteredTextPromptSuggestions.length)
                  return
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setActiveSuggestionIndex((current) =>
                    current === 0 ? filteredTextPromptSuggestions.length - 1 : current - 1,
                  )
                  return
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault()
                  applyTextPromptSuggestion(filteredTextPromptSuggestions[activeSuggestionIndex]?.token || "")
                }
              }}
              className="min-h-28 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />

            {filteredTextPromptSuggestions.length > 0 ? (
              <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-[12px] border border-border/80 bg-card/95 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm">
                <div className="max-h-48 space-y-1 overflow-auto">
                  {filteredTextPromptSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.targetNodeKey}-${suggestion.sourceNodeKey}-${suggestion.alias}`}
                      type="button"
                      className={[
                        "flex w-full items-start justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left transition",
                        index === activeSuggestionIndex ? "bg-primary/10" : "hover:bg-accent/60",
                      ].join(" ")}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        applyTextPromptSuggestion(suggestion.token)
                      }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{suggestion.token}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {suggestion.sourceNodeKey} · {suggestion.alias} · {suggestion.sourceTitle}
                        </div>
                      </div>
                      <div className="truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {copy.suggestionTarget} {suggestion.targetNodeTitle}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {node.type === "writer" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentWriterModelSelectionValue}
              onChange={(event) => {
                const selectedOption =
                  writerModelSelectOptions.find((option) => option.value === event.target.value) || null
                const parsed = selectedOption || parseWorkflowModelSelectionValue(event.target.value)
                if (!parsed) return
                updateConfig({
                  selectedProviderId: parsed.providerId || null,
                  selectedModelId: parsed.modelId || null,
                  selectedModelOptionId: event.target.value || null,
                })
              }}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {writerModelSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.writerPlatform}</SectionLabel>
            <select
              value={asString(node.config.platform) || (locale === "zh" ? "wechat" : "generic")}
              onChange={(event) => updateConfig({ platform: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {writerPlatformOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.writerMode}</SectionLabel>
            <OptionChips
              options={writerModeOptions}
              value={asString(node.config.mode) || "article"}
              onChange={(value) => updateConfig({ mode: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.writerLanguage}</SectionLabel>
            <OptionChips
              options={writerLanguageOptions}
              value={asString(node.config.language) || "auto"}
              onChange={(value) => updateConfig({ language: value })}
            />
          </div>
        </div>
      ) : null}

      {node.type === "llm_generate" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentLlmModelSelectionValue}
              onChange={(event) => {
                const selectedOption =
                  llmModelSelectOptions.find((option) => option.value === event.target.value) || null
                const parsed = selectedOption || parseWorkflowModelSelectionValue(event.target.value)
                if (!parsed) return
                updateConfig({
                  selectedProviderId: parsed.providerId || null,
                  selectedModelId: parsed.modelId || null,
                  selectedModelOptionId: event.target.value || null,
                })
              }}
              disabled={llmModelSelectOptions.length === 0}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {llmModelSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.systemPrompt}</SectionLabel>
            <Textarea
              data-agent-config={`${node.nodeKey}:systemPrompt`}
              value={asString(node.config.systemPrompt)}
              onChange={(event) => updateConfig({ systemPrompt: event.target.value })}
              className="min-h-24 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "agent_execute" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.agent}</SectionLabel>
            <select
              value={selectedAgentValue}
              onChange={(event) => {
                const selection = parseAgentSelectValue(event.target.value)
                if (!selection) {
                  updateConfig({ customAgentId: null, agentId: null, builtinAgentId: null })
                  return
                }

                if (selection.kind === "builtin") {
                  updateConfig({
                    customAgentId: null,
                    agentId: selection.id,
                    builtinAgentId: selection.id,
                  })
                  return
                }

                updateConfig({
                  customAgentId: selection.id,
                  agentId: null,
                  builtinAgentId: null,
                })
              }}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {builtinAgents.length === 0 && customAgents.length === 0 ? <option value="">{copy.noBuiltinAgents}</option> : null}
              {!selectedCustomAgentId && selectedBuiltinAgentId && !selectedBuiltinAgent ? (
                <option value={buildAgentSelectValue("builtin", selectedBuiltinAgentId)}>
                  {copy.workflowUnsupportedAgent}
                </option>
              ) : null}
              {builtinAgents.length > 0 ? (
                <optgroup label={copy.builtinAgents}>
                  {builtinAgents.map((agent) => (
                    <option key={agent.id} value={buildAgentSelectValue("builtin", agent.id)}>
                      {agent.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {customAgents.length > 0 ? (
                <optgroup label={copy.enterpriseAgents}>
                  {customAgents.map((agent) => (
                    <option key={agent.id} value={buildAgentSelectValue("custom", agent.id)}>
                      {agent.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>

          {!selectedCustomAgentId && selectedBuiltinAgentId && !selectedBuiltinAgent ? (
            <div className="rounded-[10px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              {copy.workflowUnsupportedAgent}
            </div>
          ) : null}

          {selectedBuiltinAgent ? (
            <div className="rounded-[10px] border border-border/80 bg-background/60 p-3 text-sm text-foreground">
              <div className="font-medium">{selectedBuiltinAgent.description}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {copy.agentCategory}: {copy[selectedBuiltinAgent.category]}
              </div>
            </div>
          ) : null}

          {selectedCustomAgent ? (
            <div className="rounded-[10px] border border-border/80 bg-background/60 p-3 text-sm text-foreground">
              <div className="font-medium">{selectedCustomAgent.summary}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {copy.agentMode}: {selectedCustomAgent.executionMode}
              </div>
              {selectedCustomAgent.linkedWorkflowTitle ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {copy.linkedWorkflow}: {selectedCustomAgent.linkedWorkflowTitle}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentAgentModelSelectionValue}
              onChange={(event) => {
                const selectedOption =
                  llmModelSelectOptions.find((option) => option.value === event.target.value) || null
                const parsed = selectedOption || parseWorkflowModelSelectionValue(event.target.value)
                if (!parsed) return
                updateConfig({
                  selectedProviderId: parsed.providerId || null,
                  selectedModelId: parsed.modelId || null,
                  selectedModelOptionId: event.target.value || null,
                })
              }}
              disabled={llmModelSelectOptions.length === 0}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {llmModelSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.agentPrompt}</SectionLabel>
            <Textarea
              data-agent-config={`${node.nodeKey}:prompt`}
              value={asString(node.config.prompt)}
              placeholder={copy.agentPromptPlaceholder}
              onChange={(event) => updateConfig({ prompt: event.target.value })}
              className="min-h-24 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.agentTools}</SectionLabel>
            <label className="flex items-start gap-2 rounded-[10px] border border-border/70 bg-background/60 px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={node.config.webSearchEnabled === true}
                onChange={(event) => updateConfig({ webSearchEnabled: event.target.checked })}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block">{copy.webSearch}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{copy.webSearchHint}</span>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      {node.type === "knowledge_retrieve" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeDatasets}</SectionLabel>
            <div className="space-y-2 rounded-[10px] border border-border/80 bg-background/60 p-3">
              {enterpriseKnowledgeDatasets.length === 0 ? (
                <div className="text-sm text-muted-foreground">{copy.noKnowledgeDatasets}</div>
              ) : (
                enterpriseKnowledgeDatasets.map((dataset) => {
                  const checked = selectedKnowledgeDatasetIds.includes(dataset.id)
                  return (
                    <label key={dataset.id} className="flex items-center justify-between gap-3 text-sm text-foreground">
                      <span className="min-w-0 truncate">{dataset.name}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...selectedKnowledgeDatasetIds, dataset.id]
                            : selectedKnowledgeDatasetIds.filter((value) => value !== dataset.id)
                          updateConfig({ selectedDatasetIds: [...new Set(nextIds)] })
                        }}
                      />
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel>{locale === "zh" ? "个人知识库" : "Personal knowledge datasets"}</SectionLabel>
            <div className="space-y-2 rounded-[10px] border border-border/80 bg-background/60 p-3">
              {personalKnowledgeDatasets.length === 0 ? (
                <div className="text-sm text-muted-foreground">{copy.noKnowledgeDatasets}</div>
              ) : (
                personalKnowledgeDatasets.map((dataset) => {
                  const checked = selectedPersonalKnowledgeDatasetIds.includes(dataset.id)
                  return (
                    <label key={`personal-${dataset.id}`} className="flex items-center justify-between gap-3 text-sm text-foreground">
                      <span className="min-w-0 truncate">{dataset.name}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...selectedPersonalKnowledgeDatasetIds, dataset.id]
                            : selectedPersonalKnowledgeDatasetIds.filter((value) => value !== dataset.id)
                          updateConfig({ selectedPersonalDatasetIds: [...new Set(nextIds)] })
                        }}
                      />
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeQuery}</SectionLabel>
            <Textarea
              value={asString(node.config.prompt)}
              onChange={(event) => updateConfig({ prompt: event.target.value })}
              className="min-h-24 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeTopK}</SectionLabel>
            <Input
              type="number"
              min={1}
              max={10}
              value={String(asNumber(node.config.topK, 4))}
              onChange={(event) => updateConfig({ topK: Number(event.target.value) || 4 })}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "knowledge_write" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeDatasets}</SectionLabel>
            <select
              value={selectedKnowledgeWriteDatasetValue}
              onChange={(event) => {
                const [scope, rawId] = event.target.value.split(":")
                const datasetId = rawId ? Number(rawId) : null
                updateConfig({
                  datasetScope: scope === "personal" ? "personal" : "enterprise",
                  datasetId: datasetId && Number.isInteger(datasetId) && datasetId > 0 ? datasetId : null,
                })
              }}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              <option value="">{copy.noKnowledgeDatasets}</option>
              {enterpriseKnowledgeDatasets.length > 0 ? (
                <optgroup label={locale === "zh" ? "企业知识库" : "Enterprise"}>
                  {enterpriseKnowledgeDatasets.map((dataset) => (
                    <option key={`enterprise-${dataset.id}`} value={`enterprise:${dataset.id}`}>
                      {dataset.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {personalKnowledgeDatasets.length > 0 ? (
                <optgroup label={locale === "zh" ? "个人知识库" : "Personal"}>
                  {personalKnowledgeDatasets.map((dataset) => (
                    <option key={`personal-${dataset.id}`} value={`personal:${dataset.id}`}>
                      {dataset.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeDocumentTitle}</SectionLabel>
            <Input
              value={asString(node.config.documentTitle)}
              onChange={(event) => updateConfig({ documentTitle: event.target.value })}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.knowledgeCategory}</SectionLabel>
            <select
              value={asString(node.config.knowledgeCategory) || "general"}
              onChange={(event) => updateConfig({ knowledgeCategory: event.target.value || "general" })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              <option value="general">general</option>
              <option value="brand">brand</option>
              <option value="product">product</option>
              <option value="case-study">case-study</option>
              <option value="compliance">compliance</option>
              <option value="campaign">campaign</option>
            </select>
          </div>
        </div>
      ) : null}

      {node.type === "image_generate" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentImageModelSelectionValue}
              onChange={(event) => {
                const selectedOption =
                  imageModelSelectOptions.find((option) => option.value === event.target.value) || null
                const parsed = selectedOption || parseWorkflowModelSelectionValue(event.target.value)
                if (!parsed) return
                const nextModelKind = resolveWorkflowImageModelKind(parsed.modelId)
                const nextDefaultImageSize = getWorkflowImageDefaultSize(nextModelKind)
                const currentSizeValue = asString(node.config.imageSize)
                const nextImageSize =
                  nextModelKind === "runninghub-seedream"
                    ? normalizeRunningHubSeedreamSize(currentSizeValue || nextDefaultImageSize)
                    : nextModelKind === "gpt-image-2"
                      ? normalizeGptImage2Size(currentSizeValue || nextDefaultImageSize)
                      : currentSizeValue || nextDefaultImageSize
                updateConfig({
                  selectedProviderId: parsed.providerId || null,
                  selectedModelId: parsed.modelId || null,
                  selectedModelOptionId: event.target.value || null,
                  imageSize: nextImageSize,
                })
              }}
              disabled={imageModelSelectOptions.length === 0}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {imageModelSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {currentImageModelKind === "gpt-image-2" || currentImageModelKind === "runninghub-seedream" ? (
            <>
              <div className="space-y-2">
                <SectionLabel>{copy.size}</SectionLabel>
                <OptionChips
                  options={imageModelSizeOptions}
                  value={imageSizeSelection}
                  onChange={(value) =>
                    updateConfig({
                      imageSize:
                        value === "custom"
                          ? asString(node.config.imageSize) || getWorkflowImageDefaultSize(currentImageModelKind)
                          : value,
                    })
                  }
                />
              </div>
              {imageSizeSelection === "custom" ? (
                <div className="space-y-2">
                  <SectionLabel>{copy.customSize}</SectionLabel>
                  <input
                    value={asString(node.config.imageSize)}
                    onChange={(event) => updateConfig({ imageSize: event.target.value })}
                    placeholder={copy.customSizePlaceholder}
                    className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {currentImageModelKind === "gpt-image-2" ? (
            <>
              <div className="space-y-2">
                <SectionLabel>{copy.quality}</SectionLabel>
                <OptionChips
                  options={imageQualityOptions}
                  value={asString(node.config.imageQuality) || "auto"}
                  onChange={(value) => updateConfig({ imageQuality: value })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>{copy.background}</SectionLabel>
                <OptionChips
                  options={imageBackgroundOptions}
                  value={asString(node.config.imageBackground) || "auto"}
                  onChange={(value) => updateConfig({ imageBackground: value })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>{copy.format}</SectionLabel>
                <OptionChips
                  options={imageFormatOptions}
                  value={asString(node.config.imageOutputFormat) || "png"}
                  onChange={(value) => updateConfig({ imageOutputFormat: value })}
                />
              </div>
              {["jpeg", "webp"].includes(asString(node.config.imageOutputFormat) || "png") ? (
                <div className="space-y-2">
                  <SectionLabel>{copy.compression}</SectionLabel>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      typeof node.config.imageOutputCompression === "number"
                        ? String(node.config.imageOutputCompression)
                        : asString(node.config.imageOutputCompression)
                    }
                    onChange={(event) =>
                      updateConfig({
                        imageOutputCompression: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <SectionLabel>{copy.moderation}</SectionLabel>
                <OptionChips
                  options={imageModerationOptions}
                  value={asString(node.config.imageModeration) || "auto"}
                  onChange={(value) => updateConfig({ imageModeration: value })}
                />
              </div>
            </>
          ) : (
            <div className="rounded-[12px] border border-border/70 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
              {copy.unsupportedModelParams}
            </div>
          )}
        </div>
      ) : null}

      {node.type === "video_generate" ? (
        <div className="space-y-3">
          <div className="rounded-[12px] border border-border/50 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            {copy.autoVideoMode}
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentVideoModelId}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {videoModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {videoParameterFields.map((field) => (
            <div key={field.id} className="space-y-2">
              <SectionLabel>{field.label}</SectionLabel>
              {field.type === "textarea" ? (
                <Textarea
                  value={asString(node.config[field.id]) || field.defaultValue || ""}
                  onChange={(event) => updateConfig({ [field.id]: event.target.value })}
                  className="min-h-24 rounded-[10px] border-border/80 bg-background/80 text-sm"
                />
              ) : field.type === "select" ? (
                <select
                  value={asString(node.config[field.id]) || field.defaultValue || ""}
                  onChange={(event) => updateConfig({ [field.id]: event.target.value })}
                  className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
                >
                  {(field.options || []).map((option) => (
                    <option key={`${field.id}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  value={asString(node.config[field.id]) || field.defaultValue || ""}
                  onChange={(event) => updateConfig({ [field.id]: event.target.value })}
                  placeholder={field.placeholder}
                  className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {node.type === "digital_human" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentDigitalHumanModelId}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {digitalHumanModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.avatarImageUrl}</SectionLabel>
            <Input
              value={asString(node.config.avatarImageUrl)}
              onChange={(event) => updateConfig({ avatarImageUrl: event.target.value })}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.audioUrl}</SectionLabel>
            <Input
              value={asString(node.config.audioUrl)}
              onChange={(event) => updateConfig({ audioUrl: event.target.value })}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.script}</SectionLabel>
            <Textarea
              data-agent-config={`${node.nodeKey}:script`}
              value={asString(node.config.script)}
              onChange={(event) => updateConfig({ script: event.target.value })}
              className="min-h-24 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.scenePrompt}</SectionLabel>
            <Textarea
              data-agent-config={`${node.nodeKey}:scenePrompt`}
              value={asString(node.config.scenePrompt)}
              onChange={(event) => updateConfig({ scenePrompt: event.target.value })}
              className="min-h-20 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <SectionLabel>{copy.estimatedVideoSeconds}</SectionLabel>
              <Input
                type="number"
                min={1}
                value={asString(node.config.durationSeconds) || "10"}
                onChange={(event) => updateConfig({ durationSeconds: event.target.value })}
                className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
              />
            </div>
            <div className="space-y-2">
              <SectionLabel>{copy.audioTrimStart}</SectionLabel>
              <Input
                type="number"
                min={0}
                value={asString(node.config.audioTrimStart)}
                onChange={(event) => updateConfig({ audioTrimStart: event.target.value })}
                className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
              />
            </div>
            <div className="space-y-2">
              <SectionLabel>{copy.audioTrimEnd}</SectionLabel>
              <Input
                type="number"
                min={0}
                value={asString(node.config.audioTrimEnd)}
                onChange={(event) => updateConfig({ audioTrimEnd: event.target.value })}
                className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <SectionLabel>Seed</SectionLabel>
            <Input
              type="number"
              value={asString(node.config.seed) || "-1"}
              onChange={(event) => updateConfig({ seed: event.target.value })}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "music_generate" || node.type === "audio_generate" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentAudioGenerateModelId}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {audioGenerateModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.genre}</SectionLabel>
            <OptionChips
              options={audioGenreOptions}
              value={asString(node.config.genre) || "electronic-pop"}
              onChange={(value) => updateConfig({ genre: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.mood}</SectionLabel>
            <OptionChips
              options={audioMoodOptions}
              value={asString(node.config.mood) || "uplifting"}
              onChange={(value) => updateConfig({ mood: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.vocals}</SectionLabel>
            <OptionChips
              options={audioVocalsOptions}
              value={asString(node.config.vocals) || "instrumental"}
              onChange={(value) => updateConfig({ vocals: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.lyrics}</SectionLabel>
            <OptionChips
              options={lyricsOptions}
              value={asString(node.config.lyricsSource) || "ai_generate"}
              onChange={(value) => updateConfig({ lyricsSource: value })}
            />
          </div>
        </div>
      ) : null}

      {node.type === "voice_synthesis" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.voice}</SectionLabel>
            <select
              value={asString(node.config.voiceId)}
              onChange={(event) => updateConfig({ voiceId: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              <option value="">{voiceOptions.length > 0 ? copy.chooseVoice : copy.noVoiceOptions}</option>
              {voiceOptions.map((voice) => (
                <option key={`${voice.category}-${voice.voiceId}`} value={voice.voiceId}>
                  {voice.voiceName} · {getVoiceCategoryLabel(locale, voice.category)}
                </option>
              ))}
            </select>
            {asString(node.config.voiceId) ? (
              <div className="text-xs text-muted-foreground">
                {voiceOptions.find((voice) => voice.voiceId === asString(node.config.voiceId))?.description?.[0] ||
                  asString(node.config.voiceId)}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentVoiceSynthesisModelId}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {voiceSynthesisModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.languageBoost}</SectionLabel>
            <OptionChips
              options={languageBoostOptions}
              value={asString(node.config.languageBoost) || "auto"}
              onChange={(value) => updateConfig({ languageBoost: value })}
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.speed}</SectionLabel>
            <OptionChips
              options={speechSpeedOptions}
              value={asString(node.config.speed) || "1"}
              onChange={(value) => updateConfig({ speed: value })}
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.volume}</SectionLabel>
            <OptionChips
              options={speechVolumeOptions}
              value={asString(node.config.volume) || "1"}
              onChange={(value) => updateConfig({ volume: value })}
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>{copy.pitch}</SectionLabel>
            <OptionChips
              options={speechPitchOptions}
              value={asString(node.config.pitch) || "1"}
              onChange={(value) => updateConfig({ pitch: value })}
            />
          </div>
        </div>
      ) : null}

      {node.type === "ppt_generate" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.pptAgent}</SectionLabel>
            <select
              value={currentPptRuntimeId}
              onChange={(event) => {
                const nextRuntime = event.target.value as PptPreviewRuntimeValue
                const knownTitles = new Set([
                  getDefaultWorkflowNodeTitle("ppt_generate", "zh"),
                  getDefaultWorkflowNodeTitle("ppt_generate", "en"),
                  "PPT 快速预览 Agent",
                  "PPT 成品 Agent",
                  "PPT Preview Agent",
                  "PPT Master Agent",
                  getWorkflowPptRuntimeTitle("zh", "frontend-slides-agent"),
                  getWorkflowPptRuntimeTitle("zh", "ppt-master-agent"),
                  getWorkflowPptRuntimeTitle(locale, "frontend-slides-agent"),
                  getWorkflowPptRuntimeTitle(locale, "ppt-master-agent"),
                  getWorkflowPptRuntimeTitle("en", "frontend-slides-agent"),
                  getWorkflowPptRuntimeTitle("en", "ppt-master-agent"),
                ])
                onUpdateNode(node.nodeKey, {
                  title: knownTitles.has(node.title)
                    ? getWorkflowPptRuntimeTitle(locale, nextRuntime)
                    : node.title,
                  config: {
                    ...node.config,
                    previewRuntime: nextRuntime,
                    templateMode: nextRuntime === "ppt-master-agent" ? "single-template" : "auto-4",
                    selectedVariantKey: nextRuntime === "ppt-master-agent" ? undefined : node.config.selectedVariantKey,
                  },
                })
              }}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {pptRuntimeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="text-xs leading-5 text-muted-foreground">{copy.pptAgentHint}</div>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.model}</SectionLabel>
            <select
              value={currentPptModelId}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="h-10 w-full rounded-[10px] border border-border/80 bg-background/80 px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
            >
              {pptModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.pageCount}</SectionLabel>
            <OptionChips
              options={pageCountOptions}
              value={String(asNumber(node.config.pageCount, 8))}
              onChange={(value) =>
                updateConfig({
                  pageCount: Number(value),
                  slideCount: Number(value),
                })
              }
            />
          </div>
          {currentPptRuntimeId === "ppt-master-agent" ? (
            <div className="space-y-2">
              <SectionLabel>{copy.pptTemplate}</SectionLabel>
              <OptionChips
                options={editablePptTemplateOptions}
                value={asString(node.config.templateId)}
                onChange={(value) =>
                  updateConfig({
                    templateId: value || undefined,
                    templateMode: "single-template",
                  })
                }
              />
              <div className="text-xs leading-5 text-muted-foreground">{copy.pptTemplateHint}</div>
            </div>
          ) : null}
          <div className="space-y-2">
            <SectionLabel>{copy.language}</SectionLabel>
            <OptionChips
              options={languageOptions.filter((option) => option.value !== "bilingual")}
              value={asString(node.config.language) || (locale === "zh" ? "zh-CN" : "en-US")}
              onChange={(value) => updateConfig({ language: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.scenario}</SectionLabel>
            <OptionChips
              options={scenarioOptions}
              value={asString(node.config.scenario) || "marketing-campaign"}
              onChange={(value) => updateConfig({ scenario: value })}
            />
          </div>
        </div>
      ) : null}

      {node.type === "file_create" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.fileFormat}</SectionLabel>
            <OptionChips
              options={fileFormatOptions}
              value={asString(node.config.fileFormat) || "md"}
              onChange={(value) => updateConfig({ fileFormat: value })}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>{copy.fileName}</SectionLabel>
            <Input
              value={asString(node.config.fileName)}
              onChange={(event) => updateConfig({ fileName: event.target.value })}
              placeholder={copy.fileNamePlaceholder}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
            <div className="text-xs leading-5 text-muted-foreground">{copy.fileNodeHint}</div>
          </div>
        </div>
      ) : null}

      {node.type === "product_store" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>{copy.fileName}</SectionLabel>
            <Input
              value={asString(node.config.storedFileName)}
              onChange={(event) => updateConfig({ storedFileName: event.target.value })}
              placeholder={copy.fileNamePlaceholder}
              className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
            />
            <div className="text-xs leading-5 text-muted-foreground">{copy.fileNameHint}</div>
          </div>
          <label className="flex items-center gap-2 rounded-[10px] border border-border/70 bg-background/60 px-3 py-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={node.config.persistToWorkLibrary === true}
              onChange={(event) => updateConfig({ persistToWorkLibrary: event.target.checked })}
            />
            <span>{copy.persistToWorkLibrary}</span>
          </label>
          <label className="flex items-center gap-2 rounded-[10px] border border-border/70 bg-background/60 px-3 py-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={node.config.persistToKnowledgeBase === true}
              onChange={(event) => updateConfig({ persistToKnowledgeBase: event.target.checked })}
            />
            <span>{copy.persistToKnowledgeBase}</span>
          </label>
          {node.config.persistToKnowledgeBase === true ? (
            <div className="space-y-2">
              <SectionLabel>{copy.knowledgeTargetType}</SectionLabel>
              <Input
                value={asString(node.config.knowledgeTargetType) || "knowledge_base"}
                onChange={(event) => updateConfig({ knowledgeTargetType: event.target.value })}
                className="h-10 rounded-[10px] border-border/80 bg-background/80 text-sm"
              />
              <div className="text-xs leading-5 text-muted-foreground">{copy.knowledgeTargetTypeHint}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
