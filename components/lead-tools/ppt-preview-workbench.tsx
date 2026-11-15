"use client"

import { usePathname, useRouter } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, Download, ExternalLink, Loader2, Lock, Play, Sparkles } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { useI18n } from "@/components/locale-provider"
import { LoginGateDialog } from "@/components/lead-tools/login-gate-dialog"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_PPT_PREVIEW_PAGE_COUNT,
  getPptPreviewNarrativeAngleLabel,
  getPptPreviewStyleSummary,
  getPptPreviewTemplateLabel,
  pptLanguageOptions,
  pptFrontendTemplateOptions,
  pptPreviewModelOptions,
  resolveOptionalPptPreviewPageCount,
  resolvePptPreviewDeckPageCount,
  resolvePptPreviewTemplateMode,
  pptScenarioOptions,
  type PptFrontendTemplateId,
  type PptLanguage,
  type PptPreviewDeck,
  type PptPreviewModelValue,
  type PptPreviewPageCount,
  type PptPreviewRequest,
  type PptPreviewTemplateMode,
  type PptScenario,
  buildMockPptPreview,
} from "@/lib/lead-tools/ppt-preview-data-fixed"
import {
  type ProtectedAction,
  getToolReturnPath,
  loadPptPreviewSession,
  savePptPreviewSession,
} from "@/lib/lead-tools/session"
import { getLeadToolEndpoint } from "@/lib/lead-tools/paths"
import { cn } from "@/lib/utils"

type PptPreviewWorkbenchProps = {
  initialPrompt?: string
  initialScenario?: PptScenario
  initialLanguage?: PptLanguage
  initialModel?: PptPreviewModelValue
  initialTemplateMode?: PptPreviewTemplateMode
  initialTemplateId?: PptFrontendTemplateId
  initialPageCount?: PptPreviewPageCount | null
  initialAction?: ProtectedAction
  initialDeck?: PptPreviewDeck | null
  initialDisplayDeck?: PptPreviewDeck | null
  skipSavedSession?: boolean
  embedded?: boolean
}

function getWorkbenchCopy(locale: "zh" | "en") {
  if (locale === "zh") {
    return {
      loadingMessages: ["正在并行生成 4 种风格版式", "正在写入每页标题、正文与要点", "正在渲染 HTML 预览页面", "正在整理可对比的成品候选方案"],
      projectTitle: "项目标题",
      scenario: "场景",
      language: "语言",
      templateMode: "生成模式",
      templatePreset: "模板",
      pageCount: "页数",
      pageCountHint: "留空时让 AI 自动规划；填写后接受 4-20 页。",
      pageCountAuto: "AI 自动规划",
      pageCountResolved: "本次已规划 {count} 页",
      autoTemplates: "自动四模板",
      singleTemplate: "单模板四叙事",
      modelFallback: "可扩展为更多预览模型。",
      execute4x: "执行 4X",
      fourParallel: "四份并行生成",
      systemStatus: "系统状态",
      running: "运行中",
      stable: "稳定",
      stale: "当前预览已过期，请重新执行 4X",
      compare: "四种高差异化风格并行对比",
      openHtml: "打开 HTML",
      generateFinal: "生成 PPTX 成品",
      downloadHtml: "下载 HTML",
      downloadPpt: "下载 PPTX",
      inputSource: "输入来源",
      model: "模型",
      htmlPreviewMissing: "当前风格的 HTML 预览文件不存在",
      downloadFailed: "下载成品文件失败",
      openedHtml: "已在新的浏览器标签页打开当前风格的 HTML 预览。",
      finalizeFailed: "PPTX 成品生成失败",
      finalizeCreated: "PPTX 成品生成任务已创建。",
      currentVariant: "当前风格",
      noPreviewForAction: "请先生成预览，再进行打开、下载或导出。",
      downloadedHtml: "已下载当前风格的 HTML 文件，可直接在浏览器中打开和分享。",
      downloadedPpt: "已下载当前风格的 PPTX 文件，可以继续在 PowerPoint 或 Keynote 中编辑。",
      promptRequired: "先输入一个主题，再生成 4 组预览。",
      previewFailed: "生成预览失败",
      generatedHtml: "已生成 4 个高差异化 HTML slide 预览。当前参数：{language} / {scenario}。",
      generatedSvg: "已生成 4 个高差异化 SVG 预览。当前参数：{language} / {scenario}。",
      loadingTitle: "生成中",
      idleTitle: "准备中",
      openHtmlFailed: "打开 HTML 预览失败",
      openHtmlPrompt: "请先生成预览，再打开 HTML 页面。",
      previousSlide: "上一页",
      nextSlide: "下一页",
      actionOpen: "打开",
      actionFinal: "成品",
      actionDownload: "下载",
      statusReady: "可用",
      statusRunning: "生成中",
      statusFallback: "降级",
      statusIdle: "待命",
      promptPlaceholder: "例如：介绍霍尔木兹海峡现状及对全球能源运输的影响",
    }
  }

  return {
    loadingMessages: [
      "Generating four layout directions in parallel",
      "Writing titles, body copy, and key points",
      "Rendering HTML slide previews",
      "Preparing comparable final candidates",
    ],
    projectTitle: "Project Title",
    scenario: "Scenario",
    language: "Language",
    templateMode: "Generation Mode",
    templatePreset: "Template",
    pageCount: "Page Count",
    pageCountHint: "Leave blank to let AI plan it automatically, or enter any count from 4 to 20.",
    pageCountAuto: "AI planned",
    pageCountResolved: "This run resolved to {count} slides",
    autoTemplates: "Auto 4 Templates",
    singleTemplate: "Single Template / 4 Angles",
    modelFallback: "More preview models can be added here.",
    execute4x: "Run 4X",
    fourParallel: "Four parallel generations",
    systemStatus: "System Status",
    running: "Running",
    stable: "Stable",
    stale: "The current preview is stale. Run 4X again.",
    compare: "Compare four high-difference style directions side by side",
    openHtml: "Open HTML",
    generateFinal: "Generate PPTX",
    downloadHtml: "Download HTML",
    downloadPpt: "Download PPTX",
    inputSource: "Input Source",
    model: "Model",
    htmlPreviewMissing: "The HTML preview file for this style is not available.",
    downloadFailed: "Failed to download the deliverable file.",
    openedHtml: "Opened the HTML preview for this style in a new browser tab.",
    finalizeFailed: "Failed to generate the PPTX deliverable.",
    finalizeCreated: "The PPTX generation job has been created.",
    currentVariant: "current style",
    noPreviewForAction: "Generate a preview before opening, downloading, or exporting.",
    downloadedHtml: "Downloaded the HTML file for this style. You can open or share it directly in the browser.",
    downloadedPpt: "Downloaded the PPTX file for this style. You can continue editing it in PowerPoint or Keynote.",
    promptRequired: "Enter a topic first, then generate the four preview directions.",
    previewFailed: "Failed to generate the preview.",
    generatedHtml: "Generated four high-difference HTML slide previews. Current parameters: {language} / {scenario}.",
    generatedSvg: "Generated four high-difference SVG previews. Current parameters: {language} / {scenario}.",
    loadingTitle: "Generating",
    idleTitle: "Ready",
    openHtmlFailed: "Failed to open the HTML preview.",
    openHtmlPrompt: "Generate a preview before opening the HTML page.",
    previousSlide: "Previous slide",
    nextSlide: "Next slide",
    actionOpen: "Open",
    actionFinal: "Final",
    actionDownload: "Download",
    statusReady: "READY",
    statusRunning: "RUNNING",
    statusFallback: "FALLBACK",
    statusIdle: "IDLE",
    promptPlaceholder: "Example: Explain the current situation in the Strait of Hormuz and its impact on global energy transport",
  }
}

function formatCopy(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template)
}

function getScenarioLabel(value: PptScenario, locale: "zh" | "en") {
  const labels: Record<PptScenario, { zh: string; en: string }> = {
    "marketing-campaign": { zh: "营销策划", en: "Marketing Campaign" },
    "product-launch": { zh: "产品发布", en: "Product Launch" },
    "sales-deck": { zh: "销售提案", en: "Sales Deck" },
    "training": { zh: "培训课件", en: "Training Deck" },
  }

  return labels[value][locale]
}

function getScenarioDescription(value: PptScenario, locale: "zh" | "en") {
  const descriptions: Record<PptScenario, { zh: string; en: string }> = {
    "marketing-campaign": { zh: "适合增长活动、内容营销和渠道方案", en: "Best for growth campaigns, content marketing, and channel plans." },
    "product-launch": { zh: "适合新品发布、定位表达和 GTM 介绍", en: "Best for new launches, positioning, and go-to-market stories." },
    "sales-deck": { zh: "适合方案销售、客户提案和商务沟通", en: "Best for sales proposals, client pitches, and commercial conversations." },
    "training": { zh: "适合入门培训、知识沉淀和内部分享", en: "Best for onboarding, knowledge transfer, and internal sharing." },
  }

  return descriptions[value][locale]
}

function getModelDescription(value: PptPreviewModelValue, locale: "zh" | "en") {
  const descriptions: Record<PptPreviewModelValue, { zh: string; en: string }> = {
    "deepseek-v4-pro": { zh: "内容规划优先，适合作为可编辑 PPT 默认规划模型。", en: "Planning-first and well suited as the default model for editable PPT outlining." },
    "MiniMax-M2.7-highspeed": { zh: "速度优先，适合 4 份并行预览。", en: "Speed-first and well suited to four parallel preview generations." },
    "MiniMax-M3": { zh: "推理更重，适合更强表达但通常更慢。", en: "Heavier reasoning with stronger writing quality, but usually slower." },
    "gpt-6-astra": { zh: "通过 pptoken 路由，适合结构化分析和方案表达。", en: "Routed through pptoken for structured analysis and proposal writing." },
    "gpt-6-luna": { zh: "通过 pptoken 路由，速度优先。", en: "Routed through pptoken for speed-first generation." },
    "gpt-6-sol": { zh: "通过 pptoken 路由，适合高质量内容规划。", en: "Routed through pptoken for high-quality content planning." },
    "gpt-6.1-sol": { zh: "通过 pptoken 路由，适合高质量内容规划。", en: "Routed through pptoken for high-quality content planning." },
    "step-3.7-flash": { zh: "通过阶跃星辰直连路由，适合并发生成耗时测试。", en: "Direct StepFun routing, useful for concurrency and latency testing." },
  }

  return descriptions[value][locale]
}

function getVariantSummary(
  variant: Pick<NonNullable<PptPreviewDeck["variants"]>[number], "styleKey" | "narrativeAngle">,
  locale: "zh" | "en",
) {
  const language = locale === "zh" ? "zh-CN" : "en-US"
  const summary = getPptPreviewStyleSummary(variant.styleKey, language)

  if (!variant.narrativeAngle) {
    return summary
  }

  const angleLabel = getPptPreviewNarrativeAngleLabel(variant.narrativeAngle, language)
  return `${angleLabel} · ${summary}`
}

function getLanguageLabel(value: PptLanguage, locale: "zh" | "en") {
  const labels: Record<PptLanguage, { zh: string; en: string }> = {
    "zh-CN": { zh: "中文", en: "Chinese" },
    "en-US": { zh: "英文", en: "English" },
  }

  return labels[value][locale]
}

function getStatusLabel(status: "READY" | "RUNNING" | "FALLBACK" | "IDLE", copy: ReturnType<typeof getWorkbenchCopy>) {
  switch (status) {
    case "READY":
      return copy.statusReady
    case "RUNNING":
      return copy.statusRunning
    case "FALLBACK":
      return copy.statusFallback
    default:
      return copy.statusIdle
  }
}

function isWorkbenchStatus(value: string): value is "READY" | "RUNNING" | "FALLBACK" | "IDLE" {
  return value === "READY" || value === "RUNNING" || value === "FALLBACK" || value === "IDLE"
}

async function parseApiError(response: Response, fallbackMessage: string) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getVariantSlideIndex(slideIndexByVariant: Record<string, number>, variantKey: string, slideCount: number) {
  const raw = slideIndexByVariant[variantKey] ?? 0
  return Math.max(0, Math.min(raw, Math.max(slideCount - 1, 0)))
}

function buildEmbeddedHtmlPreviewDocument(html: string, slideIndex: number) {
  const previewStyle = `
    <style id="aimarketing-html-preview-embed">
      html, body {
        overflow: hidden !important;
        background: transparent !important;
      }
      .nav {
        display: none !important;
      }
      body::before {
        pointer-events: none !important;
      }
    </style>
  `

  const previewScript = `
    <script>
      window.addEventListener("DOMContentLoaded", () => {
        const slides = Array.from(document.querySelectorAll(".slide"));
        const targetIndex = Math.max(0, Math.min(${slideIndex}, slides.length - 1));
        const target = slides[targetIndex];
        if (!target) return;
        document.documentElement.style.scrollBehavior = "auto";
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: "start" });
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: "start" });
          });
        });
      });
    </script>
  `

  if (html.includes("</head>")) {
    return html.replace("</head>", `${previewStyle}</head>`).replace("</body>", `${previewScript}</body>`)
  }

  return `${previewStyle}${html}${previewScript}`
}

function buildOpenedHtmlPreviewDocument(html: string, slideIndex: number) {
  const openScript = `
    <script>
      window.addEventListener("DOMContentLoaded", () => {
        const slides = Array.from(document.querySelectorAll(".slide"));
        const targetIndex = Math.max(0, Math.min(${slideIndex}, slides.length - 1));
        const target = slides[targetIndex];
        if (!target) return;
        document.documentElement.style.scrollBehavior = "auto";
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: "start" });
        });
      });
    </script>
  `

  if (html.includes("</body>")) {
    return html.replace("</body>", `${openScript}</body>`)
  }

  return `${html}${openScript}`
}

export function PptPreviewWorkbench({
  initialPrompt = "",
  initialScenario = "marketing-campaign",
  initialLanguage = "zh-CN",
  initialModel = "deepseek-v4-pro",
  initialTemplateMode = "auto-4",
  initialTemplateId,
  initialPageCount = null,
  initialAction,
  initialDeck = null,
  initialDisplayDeck = null,
  skipSavedSession = false,
  embedded = false,
}: PptPreviewWorkbenchProps) {
  const toolSlug = "ai-ppt-preview"
  const router = useRouter()
  const pathname = usePathname()
  const { locale } = useI18n()
  const isZh = locale === "zh"
  const copy = useMemo(() => getWorkbenchCopy(locale), [locale])
  const loadingMessageCount = copy.loadingMessages.length
  const { user, isDemoMode } = useAuth()
  const [prompt, setPrompt] = useState(initialPrompt)
  const [scenario, setScenario] = useState<PptScenario>(initialScenario)
  const [language, setLanguage] = useState<PptLanguage>(initialLanguage)
  const [model, setModel] = useState<PptPreviewModelValue>(initialModel)
  const [templateMode, setTemplateMode] = useState<PptPreviewTemplateMode>(
    initialDeck?.templateMode ?? initialDisplayDeck?.templateMode ?? initialTemplateMode,
  )
  const [templateId, setTemplateId] = useState<PptFrontendTemplateId>(
    initialDeck?.selectedTemplateId ?? initialDisplayDeck?.selectedTemplateId ?? initialTemplateId ?? "long-table",
  )
  const [pageCountInput, setPageCountInput] = useState<string>(
    initialDeck?.pageCount != null
      ? String(initialDeck.pageCount)
      : initialDisplayDeck?.pageCount != null
        ? String(initialDisplayDeck.pageCount)
        : initialPageCount != null
          ? String(initialPageCount)
          : "",
  )
  const [deck, setDeck] = useState<PptPreviewDeck | null>(initialDeck)
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(initialDeck?.previewSessionId ?? null)
  const [selectedVariantKey, setSelectedVariantKey] = useState<string>(
    initialDeck?.variants[0]?.key ?? initialDisplayDeck?.variants[0]?.key ?? "ppt169_brutalist_ai_newspaper_2026",
  )
  const [slideIndexByVariant, setSlideIndexByVariant] = useState<Record<string, number>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const [isRunningProtectedAction, setIsRunningProtectedAction] = useState(false)
  const [loginGateAction, setLoginGateAction] = useState<ProtectedAction | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const requestedPageCount = useMemo(() => resolveOptionalPptPreviewPageCount(pageCountInput), [pageCountInput])
  const effectiveTemplateMode = resolvePptPreviewTemplateMode({
    templateMode,
    templateId,
  })
  const visibleDeck = deck ?? initialDisplayDeck
  const resolvedPageCount =
    visibleDeck?.resolvedPageCount ??
    (visibleDeck ? resolvePptPreviewDeckPageCount(visibleDeck) : requestedPageCount ?? DEFAULT_PPT_PREVIEW_PAGE_COUNT)
  const [lastGeneratedRequest, setLastGeneratedRequest] = useState<PptPreviewRequest | null>(
    initialDeck
      ? {
          prompt: initialPrompt,
          scenario: initialScenario,
          language: initialLanguage,
          model: initialModel,
          templateMode: initialDeck.templateMode ?? initialTemplateMode,
          templateId: initialDeck.selectedTemplateId ?? initialTemplateId,
          pageCount: initialDeck.pageCount ?? initialPageCount ?? null,
        }
      : null,
  )

  const canUseProtectedActions = Boolean(user) && !isDemoMode
  const redirectTo = getToolReturnPath(
    prompt,
    scenario,
    language,
    model,
    effectiveTemplateMode,
    effectiveTemplateMode === "single-template" ? templateId : undefined,
    requestedPageCount ?? undefined,
    loginGateAction ?? undefined,
  )

  useEffect(() => {
    if (skipSavedSession) {
      return
    }

    const savedSession = loadPptPreviewSession()
    if (!savedSession) {
      return
    }

    setPrompt((currentPrompt) => currentPrompt || savedSession.request.prompt)
    setScenario(savedSession.request.scenario)
    setLanguage(savedSession.request.language)
    setModel(savedSession.request.model ?? initialModel)
    setTemplateMode(savedSession.request.templateMode ?? initialTemplateMode)
    if (savedSession.request.templateId) {
      setTemplateId(savedSession.request.templateId)
    }
    setPageCountInput(savedSession.request.pageCount != null ? String(savedSession.request.pageCount) : initialPageCount != null ? String(initialPageCount) : "")
    setDeck(savedSession.generatedDeck ?? null)
    setLastGeneratedRequest(savedSession.generatedDeck ? savedSession.request : null)
    setPreviewSessionId(savedSession.previewSessionId ?? savedSession.generatedDeck?.previewSessionId ?? null)
    setSelectedVariantKey(
      savedSession.selectedVariantKey ??
        savedSession.generatedDeck?.variants[0]?.key ??
        initialDisplayDeck?.variants[0]?.key ??
        "ppt169_brutalist_ai_newspaper_2026",
    )

    if (savedSession.slideIndexByVariant) {
      setSlideIndexByVariant(savedSession.slideIndexByVariant)
      return
    }

    if (savedSession.selectedVariantKey) {
      setSlideIndexByVariant({
        [savedSession.selectedVariantKey]: savedSession.selectedSlideIndex ?? 0,
      })
    }
  }, [initialDisplayDeck?.variants, initialModel, initialPageCount, initialTemplateMode, skipSavedSession])

  useEffect(() => {
    if (!prompt.trim() && !deck) {
      return
    }

    const request: PptPreviewRequest = {
      prompt,
      scenario,
      language,
      model,
      templateMode: effectiveTemplateMode,
      templateId: effectiveTemplateMode === "single-template" ? templateId : undefined,
      pageCount: requestedPageCount ?? undefined,
    }
    const selectedSlideIndex = slideIndexByVariant[selectedVariantKey] ?? 0

    savePptPreviewSession({
      request,
      previewSessionId: previewSessionId ?? deck?.previewSessionId,
      selectedVariantKey,
      selectedSlideIndex,
      slideIndexByVariant,
      generatedDeck: deck ?? undefined,
      lastActionAt: new Date().toISOString(),
    })
  }, [
    deck,
    effectiveTemplateMode,
    language,
    model,
    requestedPageCount,
    previewSessionId,
    prompt,
    scenario,
    selectedVariantKey,
    slideIndexByVariant,
    templateId,
  ])

  useEffect(() => {
    if (!isGenerating) {
      setLoadingMessageIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % loadingMessageCount)
    }, 1400)

    return () => window.clearInterval(timer)
  }, [isGenerating, loadingMessageCount])

  const boardTemplateDeck = useMemo(() => {
    if (visibleDeck) {
      return visibleDeck
    }

    return buildMockPptPreview({
      prompt,
      scenario,
      language,
      model,
      templateMode: effectiveTemplateMode,
      templateId: effectiveTemplateMode === "single-template" ? templateId : undefined,
      pageCount: requestedPageCount ?? undefined,
    })
  }, [effectiveTemplateMode, language, model, prompt, requestedPageCount, scenario, templateId, visibleDeck])

  const previewIsStale = Boolean(
    deck &&
      lastGeneratedRequest &&
      (lastGeneratedRequest.prompt !== prompt ||
        lastGeneratedRequest.scenario !== scenario ||
        lastGeneratedRequest.language !== language ||
        (lastGeneratedRequest.model ?? initialModel) !== model ||
        resolvePptPreviewTemplateMode(lastGeneratedRequest) !== effectiveTemplateMode ||
        (resolvePptPreviewTemplateMode(lastGeneratedRequest) === "single-template"
          ? lastGeneratedRequest.templateId !== templateId
          : false) ||
        resolveOptionalPptPreviewPageCount(lastGeneratedRequest.pageCount) !== requestedPageCount),
  )

  useEffect(() => {
    if (!boardTemplateDeck.variants.some((variant) => variant.key === selectedVariantKey)) {
      setSelectedVariantKey(boardTemplateDeck.variants[0]?.key ?? "ppt169_brutalist_ai_newspaper_2026")
    }
  }, [boardTemplateDeck, selectedVariantKey])

  useEffect(() => {
    const params = new URLSearchParams()
    if (prompt.trim()) {
      params.set("prompt", prompt)
    }
    params.set("scenario", scenario)
    params.set("language", language)
    params.set("model", model)
    params.set("templateMode", effectiveTemplateMode)
    if (effectiveTemplateMode === "single-template") {
      params.set("templateId", templateId)
    }
    if (requestedPageCount != null) {
      params.set("pageCount", String(requestedPageCount))
    }
    if (previewSessionId && !previewIsStale) {
      params.set("previewSessionId", previewSessionId)
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [effectiveTemplateMode, language, model, pathname, previewIsStale, previewSessionId, prompt, requestedPageCount, router, scenario, templateId])

  useEffect(() => {
    if (!deck || !previewIsStale || isGenerating) {
      return
    }

    setStatusMessage(copy.stale)
  }, [copy.stale, deck, isGenerating, previewIsStale])

  const activeLoadingMessage = copy.loadingMessages[loadingMessageIndex] ?? copy.loadingMessages[0]
  const isHtmlPreviewDeck = visibleDeck?.previewEngine === "frontend-slides-html"
  const downloadActionLabel = copy.actionDownload
  const finalizeActionLabel = isHtmlPreviewDeck ? copy.actionOpen : copy.actionFinal

  const openHtmlPreviewInNewTab = useCallback((currentDeck: PptPreviewDeck, variantKey: string) => {
    const variant = currentDeck.variants.find((item) => item.key === variantKey)
    const htmlDocument = variant?.preview?.htmlDocument
    if (!variant || !htmlDocument) {
      throw new Error(copy.htmlPreviewMissing)
    }

    const slideIndex = getVariantSlideIndex(
      slideIndexByVariant,
      variantKey,
      variant.preview?.slides.length ?? variant.slides.length ?? 1,
    )
    const blob = new Blob([buildOpenedHtmlPreviewDocument(htmlDocument.html, slideIndex)], {
      type: "text/html;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank", "noopener,noreferrer")
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [copy.htmlPreviewMissing, slideIndexByVariant])

  const triggerPreviewDownload = useCallback(async (currentDeck: PptPreviewDeck, variantKey: string) => {
    const response = await fetch(getLeadToolEndpoint(toolSlug, "download"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        deck: currentDeck,
        selectedVariantKey: variantKey,
        previewSessionId: previewSessionId ?? currentDeck.previewSessionId,
      }),
    })

    if (response.status === 401) {
      setLoginGateAction("download")
      throw new Error("Authentication required")
    }

    if (!response.ok) {
      throw new Error(await parseApiError(response, copy.downloadFailed))
    }

    const blob = await response.blob()
    const disposition = response.headers.get("Content-Disposition")
    const contentType = response.headers.get("Content-Type") || ""
    const fallbackExtension = contentType.includes("text/html") ? "html" : "pptx"
    const fallbackFileName = `${currentDeck.title.replace(/\s+/g, "-").toLowerCase()}-${variantKey}.${fallbackExtension}`
    const fileNameMatch = disposition?.match(/filename="(.+)"/)
    const fileName = fileNameMatch?.[1] || fallbackFileName

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }, [copy.downloadFailed, previewSessionId, toolSlug])

  const runFinalize = useCallback(async (currentDeck: PptPreviewDeck, variantKey: string) => {
    if (currentDeck.previewEngine === "frontend-slides-html") {
      openHtmlPreviewInNewTab(currentDeck, variantKey)
      setStatusMessage(copy.openedHtml)
      return
    }

    const response = await fetch(getLeadToolEndpoint(toolSlug, "finalize"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        deck: currentDeck,
        selectedVariantKey: variantKey,
        previewSessionId: previewSessionId ?? currentDeck.previewSessionId,
      }),
    })

    if (response.status === 401) {
      setLoginGateAction("finalize")
      throw new Error("Authentication required")
    }

    const data = (await response.json()) as {
      error?: string
      message?: string
      exportPlan?: { selectedVariant?: string; slideCount?: number; output?: "editable-pptx" | "html-file" }
    }

    if (!response.ok) {
      throw new Error(data.error || copy.finalizeFailed)
    }

    setStatusMessage(
      isZh
        ? `${data.message || copy.finalizeCreated} 已选择 ${data.exportPlan?.selectedVariant || copy.currentVariant}，共 ${data.exportPlan?.slideCount || 0} 页。`
        : `${data.message || copy.finalizeCreated} Selected ${data.exportPlan?.selectedVariant || copy.currentVariant} with ${data.exportPlan?.slideCount || 0} slides.`,
    )
  }, [copy.currentVariant, copy.finalizeCreated, copy.finalizeFailed, copy.openedHtml, isZh, openHtmlPreviewInNewTab, previewSessionId, toolSlug])

  const runProtectedAction = useCallback(async (action: ProtectedAction, variantKey: string) => {
    if (!deck) {
      setStatusMessage(copy.noPreviewForAction)
      return
    }

    if (!canUseProtectedActions) {
      setLoginGateAction(action)
      return
    }

    setIsRunningProtectedAction(true)
    setSelectedVariantKey(variantKey)

    try {
      if (action === "download") {
        await triggerPreviewDownload(deck, variantKey)
        setStatusMessage(
          deck.previewEngine === "frontend-slides-html"
            ? copy.downloadedHtml
            : copy.downloadedPpt,
        )
        return
      }

      await runFinalize(deck, variantKey)
    } catch (error) {
      if (error instanceof Error && error.message !== "Authentication required") {
        setStatusMessage(error.message)
      }
    } finally {
      setIsRunningProtectedAction(false)
    }
  }, [canUseProtectedActions, copy.downloadedHtml, copy.downloadedPpt, copy.noPreviewForAction, deck, runFinalize, triggerPreviewDownload])

  const generatePreview = async () => {
    if (!prompt.trim()) {
      setStatusMessage(copy.promptRequired)
      return
    }

    setIsGenerating(true)
    setStatusMessage(null)

    try {
      const previewRequest = {
        prompt,
        scenario,
        language,
        model,
        templateMode: effectiveTemplateMode,
        templateId: effectiveTemplateMode === "single-template" ? templateId : undefined,
        pageCount: requestedPageCount ?? undefined,
      }
      const response = await fetch(getLeadToolEndpoint(toolSlug, "preview"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(previewRequest),
      })

      let data = (await response.json()) as {
        error?: string
        deck?: PptPreviewDeck
        previewSessionId?: string
        jobId?: string
        status?: string
      }

      if (response.ok && data.jobId && !data.deck) {
        const deadline = Date.now() + 90 * 60 * 1000
        while (Date.now() < deadline && (data.status === "queued" || data.status === "running")) {
          await sleep(2500)
          const statusResponse = await fetch(`/api/tools/${toolSlug}/preview-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ jobId: data.jobId, input: previewRequest }),
          })
          data = (await statusResponse.json()) as typeof data
          if (!statusResponse.ok) break
        }
      }

      if (!response.ok || !data.deck) {
        throw new Error(data.error || copy.previewFailed)
      }

      const nextDeck = data.deck
      const nextIndexes = Object.fromEntries(nextDeck.variants.map((variant) => [variant.key, 0]))

      startTransition(() => {
        setDeck(nextDeck)
        setLastGeneratedRequest({
          prompt,
          scenario,
          language,
          model,
          templateMode: effectiveTemplateMode,
          templateId: effectiveTemplateMode === "single-template" ? templateId : undefined,
          pageCount: requestedPageCount ?? undefined,
        })
        setPreviewSessionId(data.previewSessionId ?? nextDeck.previewSessionId ?? null)
        setSelectedVariantKey(nextDeck.variants[0]?.key ?? "ppt169_brutalist_ai_newspaper_2026")
        setSlideIndexByVariant(nextIndexes)
        const nextResolvedPageCount = nextDeck.resolvedPageCount ?? resolvePptPreviewDeckPageCount(nextDeck)
        setStatusMessage(
          `${
            nextDeck.previewEngine === "frontend-slides-html"
              ? formatCopy(copy.generatedHtml, { language: getLanguageLabel(language, locale), scenario: getScenarioLabel(scenario, locale) })
              : formatCopy(copy.generatedSvg, { language: getLanguageLabel(language, locale), scenario: getScenarioLabel(scenario, locale) })
          } ${formatCopy(copy.pageCountResolved, { count: String(nextResolvedPageCount) })}`,
        )
      })
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : copy.previewFailed)
    } finally {
      setIsGenerating(false)
    }
  }

  useEffect(() => {
    if (!initialAction || !deck || !canUseProtectedActions || isRunningProtectedAction) {
      return
    }

    void runProtectedAction(initialAction, selectedVariantKey)
  }, [canUseProtectedActions, deck, initialAction, isRunningProtectedAction, runProtectedAction, selectedVariantKey])

  const boardVariants = boardTemplateDeck.variants.map((variant) => {
    const liveVariant = visibleDeck?.variants.find((item) => item.key === variant.key)
    const resolvedVariant = liveVariant ?? variant
    const slideCount = liveVariant?.preview?.slides.length ?? resolvedVariant.slides.length ?? resolvedPageCount
    const slideIndex = getVariantSlideIndex(slideIndexByVariant, resolvedVariant.key, slideCount)
    const currentSlide = resolvedVariant.slides[slideIndex]
    const currentAsset = liveVariant?.preview?.slides[slideIndex]
    const currentHtmlDocument = liveVariant?.preview?.htmlDocument
    const status =
      !visibleDeck ? (isGenerating ? "RUNNING" : "IDLE") : deck ? (deck.source === "mock" ? "FALLBACK" : "READY") : "IDLE"

    return {
      slot: resolvedVariant.slotLabel ?? "A",
      variant: resolvedVariant,
      liveVariant,
      slideCount,
      slideIndex,
      currentSlide,
      currentAsset,
      currentHtmlDocument,
      status,
      isFocused: selectedVariantKey === resolvedVariant.key,
    }
  })

  const setVariantSlideIndex = (variantKey: string, nextIndex: number) => {
    setSlideIndexByVariant((current) => ({
      ...current,
      [variantKey]: nextIndex,
    }))
    setSelectedVariantKey(variantKey)
  }

  const shell = (
    <div
      className={cn(
        "mx-auto w-full overflow-hidden rounded-[10px] border border-black/10 bg-white shadow-[0_28px_80px_-40px_rgba(0,0,0,0.28)]",
        embedded ? "h-[calc(100svh-96px)]" : "h-[calc(100svh-16px)]",
        embedded ? "max-w-[1500px]" : "max-w-[1500px]",
      )}
    >
      <div className="grid h-full min-h-0 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="relative flex min-h-0 flex-col gap-1.5 overflow-x-hidden overflow-y-auto border-b border-black/8 bg-white/88 p-2.5 md:border-b-0 md:border-r">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 font-display text-sm font-black uppercase tracking-tight text-foreground">
              <div className="grid h-7 w-7 place-items-center rounded-[2px] bg-primary text-[0.85rem] text-primary-foreground">4X</div>
              <span>AI Marketing // PPT Generator Studio</span>
            </div>
            <div className="space-y-0.5">
              <h1 className="font-display text-[1.8rem] font-black uppercase leading-[0.88] tracking-[-0.04em] text-foreground sm:text-[2rem]">
                AI PPT GENERATOR
              </h1>
              <div className="h-1 w-full max-w-[180px] bg-[linear-gradient(90deg,var(--color-primary)_0_38%,transparent_38%_45%,#2d6bff_45%_67%,transparent_67%_75%,#ff6a2a_75%_100%)]" />
            </div>
          </div>

          <div className="grid gap-1.5 border-t border-black/8 pt-1.5">
            <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.inputSource}</div>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-foreground">{copy.projectTitle}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={6}
                className="min-h-[120px] rounded-[2px] border border-black/14 bg-black/[0.03] px-3 py-2 text-sm font-semibold leading-5 text-foreground outline-none transition focus:border-primary"
                placeholder={copy.promptPlaceholder}
              />
            </label>

            <label className="grid gap-1">
              <span className="font-display text-xs font-black uppercase text-muted-foreground">{copy.model}</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value as PptPreviewModelValue)}
                className="h-10 rounded-[2px] border border-black/14 bg-black/[0.03] px-3 text-sm font-semibold text-foreground outline-none transition focus:border-primary"
              >
                {pptPreviewModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] leading-3.5 text-muted-foreground">
                {getModelDescription(model, locale) ?? copy.modelFallback}
              </p>
            </label>

            <div className="grid gap-1.5">
              <div className="grid gap-1.5">
                <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.scenario}</div>
                <div className="grid gap-1.5">
                  {pptScenarioOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setScenario(option.value)}
                      className={cn(
                        "min-h-10 rounded-[2px] border px-2.5 py-1.5 text-left transition",
                        scenario === option.value
                          ? "border-primary bg-primary/10"
                          : "border-black/10 bg-black/[0.02] hover:border-black/25 hover:bg-black/[0.04]",
                      )}
                    >
                      <div className="font-display text-[13px] font-black text-foreground">{getScenarioLabel(option.value, locale)}</div>
                      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{getScenarioDescription(option.value, locale)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.language}</div>
                <div className="grid gap-1.5">
                  {pptLanguageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLanguage(option.value)}
                      className={cn(
                        "min-h-10 rounded-[2px] border px-2.5 py-1.5 text-left font-display text-[13px] font-black transition",
                        language === option.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-black/10 bg-black/[0.02] text-foreground hover:border-black/25 hover:bg-black/[0.04]",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.pageCount}</div>
                <input
                  type="number"
                  min={4}
                  max={20}
                  inputMode="numeric"
                  value={pageCountInput}
                  onChange={(event) => setPageCountInput(event.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => setPageCountInput(requestedPageCount != null ? String(requestedPageCount) : "")}
                  placeholder={isZh ? "留空交给 AI" : "Leave blank for AI"}
                  className="h-10 rounded-[2px] border border-black/14 bg-black/[0.03] px-3 text-sm font-semibold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
                />
                <p className="text-[10px] leading-3.5 text-muted-foreground">
                  {copy.pageCountHint}
                  {" "}
                  {formatCopy(copy.pageCountAuto, { count: String(resolvedPageCount) })}
                  {`: ${resolvedPageCount}`}
                </p>
              </div>

              <div className="grid gap-1.5">
                <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.templateMode}</div>
                <div className="grid gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTemplateMode("auto-4")}
                    className={cn(
                      "min-h-10 rounded-[2px] border px-2.5 py-1.5 text-left transition",
                      effectiveTemplateMode === "auto-4"
                        ? "border-primary bg-primary/10"
                        : "border-black/10 bg-black/[0.02] hover:border-black/25 hover:bg-black/[0.04]",
                    )}
                  >
                    <div className="font-display text-[13px] font-black text-foreground">{copy.autoTemplates}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">A / B / C / D = four different frontend templates</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateMode("single-template")}
                    className={cn(
                      "min-h-10 rounded-[2px] border px-2.5 py-1.5 text-left transition",
                      effectiveTemplateMode === "single-template"
                        ? "border-primary bg-primary/10"
                        : "border-black/10 bg-black/[0.02] hover:border-black/25 hover:bg-black/[0.04]",
                    )}
                  >
                    <div className="font-display text-[13px] font-black text-foreground">{copy.singleTemplate}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {isZh
                        ? "同一模板下自动生成 4 个叙事角度候选。"
                        : "Generate four narrative-angle candidates inside one chosen template."}
                    </div>
                  </button>
                </div>
              </div>

              {effectiveTemplateMode === "single-template" ? (
                <div className="grid gap-1.5">
                  <div className="font-display text-xs font-black uppercase text-muted-foreground">{copy.templatePreset}</div>
                  <div className="grid gap-1.5">
                    {pptFrontendTemplateOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setTemplateId(option.id)}
                        className={cn(
                          "min-h-10 rounded-[2px] border px-2.5 py-1.5 text-left transition",
                          templateId === option.id
                            ? "border-primary bg-primary/10"
                            : "border-black/10 bg-black/[0.02] hover:border-black/25 hover:bg-black/[0.04]",
                        )}
                      >
                        <div className="font-display text-[13px] font-black text-foreground">
                          {getPptPreviewTemplateLabel(option.id, language)}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                          {language === "zh-CN" ? option.summary.zh : option.summary.en}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void generatePreview()}
            disabled={isGenerating}
            className="mt-auto min-h-[44px] w-full -skew-x-6 bg-primary px-4 py-1.5 text-left text-[1.05rem] font-display font-black uppercase text-primary-foreground transition hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-75"
          >
            <span className="inline-flex items-center gap-3">
              {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {isGenerating ? copy.running : copy.execute4x}
            </span>
            <span className="mt-0.5 block text-[9px] font-black uppercase tracking-[0.08em] text-black/50">
              {isGenerating ? activeLoadingMessage : copy.fourParallel}
            </span>
          </button>
        </aside>

        <section className="grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)]">
          <header className="grid min-w-0 border-b border-black/10 md:grid-cols-[1fr_minmax(320px,1.4fr)]">
            <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 md:border-b-0 md:border-r">
              <span className="font-display text-xs font-black uppercase text-muted-foreground">{copy.systemStatus}</span>
              <strong className="font-display text-sm font-black text-foreground">{isGenerating ? copy.running : copy.stable}</strong>
            </div>
            <div className="flex items-center gap-3 px-4">
              <strong className="line-clamp-1 font-display text-sm font-black text-foreground">
                {isGenerating
                  ? activeLoadingMessage
                  : previewIsStale
                    ? copy.stale
                    : statusMessage ?? copy.compare}
              </strong>
            </div>
          </header>

          <section className="grid min-h-0 grid-cols-1 md:grid-cols-2 md:grid-rows-2">
            {boardVariants.map((entry) => {
              if (!entry) {
                return null
              }

              const { currentAsset, currentHtmlDocument, currentSlide, isFocused, liveVariant, slideCount, slideIndex, slot, status, variant } = entry
              const actionDisabled = !deck || isRunningProtectedAction || !liveVariant || previewIsStale

              return (
                <article
                  key={variant.key}
                  className={cn(
                    "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_3px_auto] overflow-hidden border-b border-black/10 bg-white/92 [&:nth-child(2n+1)]:md:border-r",
                    isFocused ? "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]" : "",
                  )}
                >
                  <div className="pointer-events-none absolute left-3 top-1.5 font-display text-[2.6rem] font-black leading-none text-black/[0.08]">
                    {slot}
                  </div>

                  <div className="relative z-10 flex items-start justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-display text-[10px] font-black uppercase text-muted-foreground">
                        {slot} / {variant.narrativeAngle ? getPptPreviewNarrativeAngleLabel(variant.narrativeAngle, language) : variant.name}
                      </p>
                      <h2 className="line-clamp-1 font-display text-[1.1rem] font-black uppercase tracking-[-0.05em] text-foreground">
                        {currentSlide?.title ?? variant.name}
                      </h2>
                    </div>
                    <span
                      className={cn(
                        "rounded-[2px] px-1.5 py-1 font-display text-[10px] font-black uppercase",
                        status === "READY" && "bg-black text-white",
                        status === "RUNNING" && "bg-primary text-primary-foreground animate-pulse",
                        status === "FALLBACK" && "bg-orange-100 text-orange-700",
                        status === "IDLE" && "border border-black/10 text-muted-foreground",
                      )}
                    >
                      {getStatusLabel(isWorkbenchStatus(status) ? status : "IDLE", copy)}
                    </span>
                  </div>

                  <div className="relative mx-3 mb-1 min-h-0 overflow-hidden rounded-[2px] border border-dashed border-black/14 bg-[linear-gradient(90deg,rgba(9,9,9,0.04)_1px,transparent_1px),linear-gradient(rgba(9,9,9,0.03)_1px,transparent_1px),rgba(9,9,9,0.015)] bg-[size:28px_28px]">
                    {currentHtmlDocument ? (
                      <div className="aspect-[16/9] h-full w-full max-h-full bg-white">
                        <iframe
                          key={`${variant.key}-${slideIndex}`}
                          srcDoc={buildEmbeddedHtmlPreviewDocument(currentHtmlDocument.html, slideIndex)}
                          title={`${variant.name} html preview ${slideIndex + 1}`}
                          className="h-full w-full border-0 bg-white"
                          sandbox="allow-scripts"
                        />
                      </div>
                    ) : currentAsset ? (
                      <div className="aspect-[16/9] h-full w-full max-h-full">
                        <img
                          src={currentAsset.dataUrl}
                          alt={`${variant.name} slide ${slideIndex + 1}`}
                          className="h-full w-full object-contain object-center p-1.5"
                        />
                      </div>
                    ) : (
                      <div className="relative grid aspect-[16/9] h-full w-full place-items-center overflow-hidden text-center text-muted-foreground">
                        {isGenerating ? (
                          <>
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(28,91,255,0.14),transparent_45%),linear-gradient(135deg,rgba(28,91,255,0.08),transparent_50%),linear-gradient(315deg,rgba(255,106,42,0.08),transparent_52%)] animate-pulse" />
                            <div className="relative z-10 flex w-full max-w-[76%] flex-col items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                {[0, 1, 2].map((dot) => (
                                  <span
                                    key={dot}
                                    className="h-2.5 w-2.5 rounded-full bg-primary animate-bounce"
                                    style={{ animationDelay: `${dot * 120}ms` }}
                                  />
                                ))}
                              </div>
                              <strong className="font-display text-sm font-black uppercase text-foreground">{copy.loadingTitle}</strong>
                              <p className="text-[11px] font-semibold leading-4 text-muted-foreground">{activeLoadingMessage}</p>
                              <div className="grid w-full gap-2">
                                <span className="h-2.5 rounded-full bg-black/10 animate-pulse" />
                                <span className="h-2.5 w-[82%] justify-self-center rounded-full bg-black/10 animate-pulse" />
                                <span className="h-2.5 w-[68%] justify-self-center rounded-full bg-black/10 animate-pulse" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="grid place-items-center gap-3">
                            <div className="h-[5px] w-14 bg-black/10" />
                            <strong className="font-display text-sm font-black uppercase">{copy.idleTitle}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="pointer-events-auto grid h-7 w-7 place-items-center rounded-[2px] border border-black/14 bg-white/88 text-foreground transition hover:bg-white"
                        onClick={() => setVariantSlideIndex(variant.key, Math.max(0, slideIndex - 1))}
                        disabled={!liveVariant || slideIndex === 0}
                        aria-label={`${variant.name} ${copy.previousSlide}`}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <b className="grid h-6 min-w-[56px] place-items-center rounded-[2px] bg-white/88 px-2 font-display text-[10px] font-black text-foreground">
                        {slideIndex + 1} / {slideCount}
                      </b>
                      <button
                        type="button"
                        className="pointer-events-auto grid h-7 w-7 place-items-center rounded-[2px] border border-black/14 bg-white/88 text-foreground transition hover:bg-white"
                        onClick={() => setVariantSlideIndex(variant.key, Math.min(slideCount - 1, slideIndex + 1))}
                        disabled={!liveVariant || slideIndex >= slideCount - 1}
                        aria-label={`${variant.name} ${copy.nextSlide}`}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mx-3 h-[3px] bg-black/8">
                    {liveVariant ? (
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${((slideIndex + 1) / slideCount) * 100}%` }}
                      />
                    ) : isGenerating ? (
                      <div className="h-full w-[46%] bg-primary animate-pulse" />
                    ) : (
                      <div className="h-full w-0 bg-primary transition-all" />
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground">
                      {getVariantSummary(variant, locale)}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 rounded-[2px] border-black/12 bg-white px-2 text-[11px] text-foreground hover:bg-black/[0.04]"
                        onClick={() => void runProtectedAction("download", variant.key)}
                        disabled={actionDisabled}
                      >
                        {canUseProtectedActions ? <Download className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        {downloadActionLabel}
                      </Button>
                      <Button
                        type="button"
                        className="h-7 rounded-[2px] bg-primary px-2 text-[11px] text-primary-foreground hover:bg-primary/90"
                        onClick={() =>
                          isHtmlPreviewDeck
                            ? (() => {
                                try {
                                  if (!deck) {
                                    throw new Error(copy.openHtmlPrompt)
                                  }
                                  openHtmlPreviewInNewTab(deck, variant.key)
                                  setSelectedVariantKey(variant.key)
                                  setStatusMessage(copy.openedHtml)
                                } catch (error) {
                                  setStatusMessage(error instanceof Error ? error.message : copy.openHtmlFailed)
                                }
                              })()
                            : void runProtectedAction("finalize", variant.key)
                        }
                        disabled={isHtmlPreviewDeck ? !deck || !liveVariant || previewIsStale : actionDisabled}
                      >
                        {isHtmlPreviewDeck ? (
                          <ExternalLink className="h-3.5 w-3.5" />
                        ) : canUseProtectedActions ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
                        {finalizeActionLabel}
                      </Button>
                    </div>
                  </div>
                </article>
              )
            })}
          </section>
        </section>
      </div>
    </div>
  )

  return (
    <>
      {embedded ? (
        shell
      ) : (
        <div className="h-[100svh] overflow-hidden bg-background px-2 py-2 sm:px-3">
          {shell}
        </div>
      )}

      <LoginGateDialog
        open={Boolean(loginGateAction)}
        onOpenChange={(open) => {
          if (!open) {
            setLoginGateAction(null)
          }
        }}
        actionLabel={
          loginGateAction === "finalize"
            ? deck?.previewEngine === "frontend-slides-html"
              ? copy.openHtml
              : copy.generateFinal
            : deck?.previewEngine === "frontend-slides-html"
              ? copy.downloadHtml
              : copy.downloadPpt
        }
        redirectTo={redirectTo}
      />
    </>
  )
}
