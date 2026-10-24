import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

import { executeAiEntryWithProviderFailover, getConfiguredAiEntryProviders } from "@/lib/ai-entry/provider-routing"
import {
  getLeadToolPptRuntimeSlideModel,
  getLeadToolPptPreviewProvider,
  getLeadToolPptRuntimeSlideProvider,
  resolvePptMasterSlideTimeoutMs,
} from "@/lib/lead-tools/config"
import {
  loadPptMasterTemplateReference,
  materializePptMasterPreviewDeck,
  type PptMasterPreviewRuntimeSlideContext,
  type PptMasterPreviewRuntimeSlideResult,
  type ImportedPptMasterTemplateReference,
} from "@/lib/lead-tools/ppt-master-runtime"
import {
  MAX_PPT_PREVIEW_PAGE_COUNT,
  MIN_PPT_PREVIEW_PAGE_COUNT,
  buildPptPreviewVariantDescriptors,
  buildPptPreviewTemplateCapabilityLabel,
  buildPptPreviewIntentSequenceLabel,
  buildMockPptPreview,
  buildPptPreviewDeckFromPlans,
  getPptPreviewLayoutSequence,
  getPptPreviewNarrativeAngleLabel,
  getPptPreviewNarrativeAnglePrompt,
  getPptPreviewStyleSlotSequence,
  getPptPreviewTemplateLabel,
  getPptPreviewTemplateSlotByLayout,
  isPptPreviewLayout,
  isPptPreviewPageIntent,
  resolveOptionalPptPreviewPageCount,
  type PptPreviewDeck,
  type PptPreviewVariantDescriptor,
  type PptPreviewResearchBrief,
  type PptPreviewRequest,
  type PptPreviewSlide,
  resolvePptPreviewPageCount,
  resolvePptPreviewTemplateMode,
  resolvePptPreviewSlideLayout,
  resolvePptPreviewSlideIntent,
  type PptPreviewVariantStyle,
} from "@/lib/lead-tools/ppt-preview-data-fixed"
import { renderPptPreviewDeckAssets } from "@/lib/lead-tools/ppt-master-preview"
import { buildPreviewSystemPrompt, buildPreviewUserPrompt, isPreviewPlaceholder } from "@/lib/lead-tools/ppt-preview-copy"
import {
  generateStructuredObjectWithWriterModel,
  generateTextWithWriterModel,
  hasAibermApiKey,
  hasCrazyrouteApiKey,
} from "@/lib/writer/aiberm"
import { withTaskTimeout } from "@/lib/task-timeout"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

type LeadToolPptPlan = {
  title: string
  outline: string[]
  slides: Array<Omit<PptPreviewSlide, "id" | "accent">>
}

type LeadToolPreviewProviderId = "deepseek" | "pptoken" | "minimax" | "stepfun" | "glm" | "writer"
const LEAD_TOOL_PPT_PREVIEW_PROVIDER_TIMEOUT_MS = 45_000
const LEAD_TOOL_PPT_PREVIEW_DEEPSEEK_TIMEOUT_MS = 120_000

let generateTextWithWriterModelImpl = generateTextWithWriterModel
let generateStructuredObjectWithWriterModelImpl = generateStructuredObjectWithWriterModel

function normalizeText(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : ""
}

function stripMarkdownDecorations(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
}

export function buildPreviewProviderMessages(params: {
  providerId: LeadToolPreviewProviderId
  systemPrompt: string
  userPrompt: string
}) {
  return {
    system: undefined,
    prompt: [
      "System instructions:",
      params.systemPrompt,
      "",
      "User request:",
      params.userPrompt,
    ].join("\n"),
  }
}

function toStructuredString(value: unknown) {
  return typeof value === "string" ? stripMarkdownDecorations(value).trim() : ""
}

function toStructuredNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function coerceStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim()
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>
        return normalizeText(record.detail) || normalizeText(record.title) || normalizeText(record.label)
      }
      return ""
    })
    .filter(Boolean)
}

type NormalizedResearchBrief = {
  topic: string
  keyFacts: string[]
  numericEvidence: string[]
  risks: string[]
  implications: string[]
  sourceNotes: string[]
  rawSummary: string
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values.map((item) => stripMarkdownDecorations(item).trim()).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

function parsePositiveInt(raw: string | undefined) {
  const parsed = Number.parseInt(normalizeText(raw), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getLeadToolPreviewProviderTimeoutMs(providerId: Exclude<LeadToolPreviewProviderId, "writer">) {
  const explicitProviderTimeout = parsePositiveInt(
    process.env[`LEAD_TOOLS_PPT_PREVIEW_${providerId.toUpperCase()}_TIMEOUT_MS`],
  )
  if (explicitProviderTimeout) {
    return explicitProviderTimeout
  }

  const explicitDefaultTimeout = parsePositiveInt(process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER_TIMEOUT_MS)
  if (explicitDefaultTimeout) {
    return explicitDefaultTimeout
  }

  if (providerId === "deepseek") {
    return LEAD_TOOL_PPT_PREVIEW_DEEPSEEK_TIMEOUT_MS
  }

  return LEAD_TOOL_PPT_PREVIEW_PROVIDER_TIMEOUT_MS
}

export function resolveRuntimeSlideExecutionConfig(
  deck: Pick<PptPreviewDeck, "previewModel" | "provider" | "runtimeSlideModel" | "runtimeSlideProvider">,
) {
  const requestedModel = normalizePptRuntimeSlideModel(
    normalizeText(deck.runtimeSlideModel) || getLeadToolPptRuntimeSlideModel() || deck.previewModel,
  )
  const inferredProviderId = inferPreviewProviderId(requestedModel)
  const preferredProviderId = resolveLeadToolPreviewProviderPreference(
    requestedModel,
    normalizeText(deck.runtimeSlideProvider) ||
      getLeadToolPptRuntimeSlideProvider() ||
      inferredProviderId ||
      "pptoken",
  )

  return {
    requestedModel,
    preferredProviderId,
  }
}

function splitResearchString(value: string) {
  return uniqueStrings(
    value
      .split(/\n+/u)
      .flatMap((line) => line.split(/[;；]/u))
      .map((item) => item.replace(/^[-*•\d.\s]+/u, "").trim())
      .filter(Boolean),
  )
}

const RESEARCH_NUMERIC_LINE_PATTERN =
  /(?:[¥￥$€]\s*\d|\d+\s*[%％]|\d+\+|\d+\s*(?:个|层|页|版|家|种|项|步|天|年|万|亿|x|X))/u
const RESEARCH_RISK_LINE_PATTERN =
  /(?:问题|焦虑|卡点|风险|断点|不会|不能|不好用|难以|难|守住风险|复刻|搬运|改写|分散|跟不进|接不进)/u
const RESEARCH_IMPLICATION_LINE_PATTERN =
  /(?:结论|价值|判断|最终|共同变化|下一步|沉淀|闭环|进入岗位|进入流程|进入结果|帮助|推动|降低|扩大|买到|形成|先帮企业问清楚|把想法变成|看得见|持续推进|标准化|更精准|更完整)/u
const RESEARCH_SKIP_LINE_PATTERN =
  /^(?:第\s*\d+\s*页|说明|整体主题|核心主张|企业面临的问题包括|真实卡点|三层进入|对比关系|主要层级|输出内容|典型问题|系统能力|核心问题|两大能力|资产类型|岗位类别|能力底座|能力模块|覆盖功能|四类业务结果|典型场景|共同变化|产品定位|核心能力|对比|套餐|更高阶需求|合作入口)$/u
const RESEARCH_LABEL_PREFIX_PATTERN =
  /^(?:标题|核心观点|核心口号|核心逻辑|核心表达|最终判断|最终价值|结论|产品定义|现场核心句|核心句|系统能力|输出内容|典型问题|核心问题|两大能力|资产类型|岗位类别|能力底座|能力模块|覆盖功能|共同变化|产品定位|核心能力|合作入口|更高阶需求|套餐)[:：]\s*/u

function sanitizeResearchLine(line: string) {
  return stripMarkdownDecorations(line)
    .replace(/^>\s*/u, "")
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^[-*•]\s*/u, "")
    .replace(/^\d+\s*[.)、]\s*/u, "")
    .replace(RESEARCH_LABEL_PREFIX_PATTERN, "")
    .replace(/[。！？.!?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
}

function extractPreferredResearchLines(value: string, patterns: RegExp[]) {
  const lines = value
    .split(/\n/u)
    .map((line) => sanitizeResearchLine(line))
    .filter((line) => isMeaningfulResearchLine(line))

  const matched: string[] = []
  for (const pattern of patterns) {
    const line = lines.find((item) => pattern.test(item))
    if (line) {
      matched.push(line)
    }
  }

  return uniqueStrings(matched)
}

function canonicalizeResearchLine(line: string) {
  if (/进入企业的岗位、流程和结果/u.test(line)) {
    return "让 AI 进入企业的岗位、流程和结果"
  }

  return line
}

function isMeaningfulResearchLine(line: string) {
  if (!line) return false
  if (line.length < 4) return false
  if (RESEARCH_SKIP_LINE_PATTERN.test(line)) return false
  if (/^说明：/u.test(line)) return false
  if (/^该 PPT 是/u.test(line)) return false
  if (/^核心主张是[:：]?$/u.test(line)) return false
  if (/^(?:封面|感谢聆听|期待合作|THANKS)$/iu.test(line)) return false
  return true
}

function parseStructuredResearchBriefFromString(value: string, fallbackTopic: string) {
  const rawLines = value.split(/\n/u)
  const keyFacts: string[] = []
  const numericEvidence: string[] = []
  const risks: string[] = []
  const implications: string[] = []
  const sourceNotes: string[] = []
  let topic = fallbackTopic
  let summaryCandidate = ""
  let currentSection = ""

  const pushLine = (bucket: string[], line: string, limit: number) => {
    if (!line || bucket.length >= limit) return
    bucket.push(line)
  }

  for (const rawLine of rawLines) {
    const headingMatch = rawLine.match(/^#{1,6}\s+(.+)$/u)
    if (headingMatch?.[1]) {
      currentSection = sanitizeResearchLine(headingMatch[1])
      continue
    }

    const line = sanitizeResearchLine(rawLine)
    if (!isMeaningfulResearchLine(line)) {
      continue
    }

    if (!summaryCandidate && /可提炼的一句话定位/u.test(currentSection)) {
      summaryCandidate = line
      continue
    }

    if (
      topic === fallbackTopic &&
      /^(?:该 PPT 是|屿算智脑是一套|屿算智能企业 AI 业务工具介绍|企业专属 AI 业务工具)/u.test(line)
    ) {
      topic =
        /屿算/u.test(value) || /屿算/u.test(line)
          ? "屿算智能企业 AI 业务工具介绍"
          : line
    }

    if (RESEARCH_NUMERIC_LINE_PATTERN.test(line)) {
      pushLine(numericEvidence, line, 8)
    }

    if (
      RESEARCH_RISK_LINE_PATTERN.test(line) ||
      /(?:焦虑|卡点|风控|问题|断点)/u.test(currentSection)
    ) {
      pushLine(risks, line, 8)
      continue
    }

    if (
      RESEARCH_IMPLICATION_LINE_PATTERN.test(line) ||
      /(?:价值|判断|结果|合作|交付逻辑|最终买到什么)/u.test(currentSection)
    ) {
      pushLine(implications, line, 8)
      continue
    }

    pushLine(keyFacts, line, 12)
  }

  const fallbackFacts = splitResearchString(value).slice(0, 8)
  const normalizedKeyFacts = uniqueStrings([
    ...extractPreferredResearchLines(value, [
      /实用 AI 大于 AI 概念/u,
      /进入企业的岗位、流程和结果/u,
      /企业需要的不是更多工具/u,
      /企业真正买到的是一套可执行/u,
      /七层业务闭环/u,
    ]),
    ...(keyFacts.length > 0 ? keyFacts : fallbackFacts),
    ...fallbackFacts,
  ])
    .map((line) => canonicalizeResearchLine(line))
    .slice(0, 8)
  const normalizedNumericEvidence = uniqueStrings(numericEvidence).slice(0, 6)
  const prioritizedNumericEvidence = uniqueStrings([
    ...extractPreferredResearchLines(value, [
      /17\s*个?\s*AI\s*智能体员工/u,
      /40\+\s*(?:模型|国内外大模型与工具接入|模型与工具接入)/u,
      /10\+\s*(?:主流内容发布与客户承接触点|主流内容发布)/u,
    ]),
    ...normalizedNumericEvidence,
  ]).slice(0, 6)
  const normalizedRisks = uniqueStrings([
    ...extractPreferredResearchLines(value, [
      /接不进真实工作流程/u,
      /结果留不进企业知识、项目和资产体系/u,
      /守住风险/u,
    ]),
    ...risks,
  ]).slice(0, 6)
  const normalizedImplications = uniqueStrings([
    ...extractPreferredResearchLines(value, [
      /先帮企业问清楚，再进入立项和执行/u,
      /把想法变成方案、计划和每日执行/u,
      /让内容、获客和成交形成闭环/u,
      /沉淀到企业资产体系/u,
    ]),
    ...implications,
  ]).slice(0, 6)
  const rawSummary =
    summaryCandidate ||
    uniqueStrings([
      normalizedKeyFacts[0] || "",
      normalizedNumericEvidence[0] || "",
      normalizedImplications[0] || "",
    ])
      .filter(Boolean)
      .join("；")

  return {
    topic,
    keyFacts: normalizedKeyFacts,
    numericEvidence: prioritizedNumericEvidence,
    risks: normalizedRisks,
    implications: normalizedImplications,
    sourceNotes,
    rawSummary,
  }
}

function normalizeResearchBrief(
  value: PptPreviewRequest["researchBrief"],
  fallbackTopic: string,
): NormalizedResearchBrief {
  if (!value) {
    return {
      topic: fallbackTopic,
      keyFacts: [],
      numericEvidence: [],
      risks: [],
      implications: [],
      sourceNotes: [],
      rawSummary: "",
    }
  }

  if (typeof value === "string") {
    const parsed = parseStructuredResearchBriefFromString(value, fallbackTopic)
    return {
      topic: parsed.topic || fallbackTopic,
      keyFacts: parsed.keyFacts,
      numericEvidence: parsed.numericEvidence,
      risks: parsed.risks,
      implications: parsed.implications,
      sourceNotes: parsed.sourceNotes,
      rawSummary: parsed.rawSummary || stripMarkdownDecorations(value).trim(),
    }
  }

  const brief = value as PptPreviewResearchBrief
  return {
    topic: normalizeText(brief.topic) || fallbackTopic,
    keyFacts: uniqueStrings(brief.keyFacts ?? []),
    numericEvidence: uniqueStrings(brief.numericEvidence ?? []),
    risks: uniqueStrings(brief.risks ?? []),
    implications: uniqueStrings(brief.implications ?? []),
    sourceNotes: uniqueStrings(brief.sourceNotes ?? []),
    rawSummary: normalizeText(brief.rawSummary),
  }
}

function buildResearchHeadline(text: string, language: PptPreviewRequest["language"]) {
  const clean = stripMarkdownDecorations(text)
    .replace(/^[-*•\d.\sA-Z]+[:：、.)\]]*\s*/u, "")
    .trim()
  const head = clean.split(/[，,；;。!?:：\n]/u)[0]?.trim() || clean
  const maxLength = language === "zh-CN" ? 16 : 30

  if (head.length <= maxLength) {
    return head
  }

  return `${head.slice(0, maxLength).trim()}…`
}

function isMeaningfulDeckText(value: string, prompt: string) {
  const normalized = normalizeText(value)
  if (!normalized) return false
  if (isPreviewPlaceholder(normalized)) return false
  if (isGenericGeneratedLabel(normalized)) return false
  if (looksLikePromptClone(normalized, prompt)) return false
  return true
}

function mergeMeaningfulTextCandidates(primary: string[], fallback: string[], prompt: string, limit: number) {
  const result: string[] = []
  const seen = new Set<string>()

  for (const candidate of [...primary, ...fallback]) {
    const value = normalizeText(candidate)
    if (!isMeaningfulDeckText(value, prompt)) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= limit) break
  }

  return result
}

function extractMetricValue(text: string, fallbackIndex: number) {
  const clean = stripMarkdownDecorations(text)
  const rangeMatch = clean.match(/\d+(?:\.\d+)?\s*%?\s*[-~]\s*\d+(?:\.\d+)?\s*%?/u)
  if (rangeMatch?.[0]) {
    return rangeMatch[0].replace(/\s+/gu, "")
  }

  const percentMatch = clean.match(/-?\d+(?:\.\d+)?\s*%/u)
  if (percentMatch?.[0]) {
    return percentMatch[0].replace(/\s+/gu, "")
  }

  const numericMatch = clean.match(/(?:\$|¥|￥|€)?\d+(?:\.\d+)?(?:万亿|亿|万|k|K|m|M|b|B)?(?:桶|艘|天|倍|x|X|bp|bps)?/u)
  if (numericMatch?.[0]) {
    return numericMatch[0]
  }

  return String(fallbackIndex + 1).padStart(2, "0")
}

function extractChartValue(text: string, fallbackIndex: number) {
  const clean = stripMarkdownDecorations(text)
  const percentMatch = clean.match(/(-?\d+(?:\.\d+)?)\s*%/u)
  if (percentMatch?.[1]) {
    return Math.max(20, Math.min(96, Math.round(Number(percentMatch[1]))))
  }

  return Math.max(28, 88 - fallbackIndex * 14)
}

function hasMeaningfulStructuredContent(values: string[], prompt: string) {
  return values.some((value) => isMeaningfulDeckText(value, prompt))
}

function buildResearchBody(
  layout: PptPreviewSlide["layout"],
  research: NormalizedResearchBrief,
  language: PptPreviewRequest["language"],
) {
  const firstFact = research.keyFacts[0]
  const firstRisk = research.risks[0]
  const firstImplication = research.implications[0]
  const firstMetric = research.numericEvidence[0]

  if (language === "zh-CN") {
    switch (layout) {
      case "cover":
        return uniqueStrings([firstFact, firstRisk, firstImplication].filter(Boolean)).slice(0, 2).join("；")
      case "agenda":
        return firstFact || firstRisk || firstImplication || ""
      case "insight":
      case "evidence":
        return firstFact || firstRisk || firstImplication || ""
      case "comparison":
      case "chart":
        return firstRisk || firstImplication || firstFact || ""
      case "stats":
        return firstMetric || firstFact || ""
      case "process":
      case "timeline":
        return firstImplication || firstRisk || firstFact || ""
      default:
        return firstFact || firstRisk || ""
    }
  }

  switch (layout) {
    case "cover":
      return uniqueStrings([firstFact, firstRisk, firstImplication].filter(Boolean)).slice(0, 2).join("; ")
    case "agenda":
      return firstFact || firstRisk || firstImplication || ""
    case "insight":
    case "evidence":
      return firstFact || firstRisk || firstImplication || ""
    case "comparison":
    case "chart":
      return firstRisk || firstImplication || firstFact || ""
    case "stats":
      return firstMetric || firstFact || ""
    case "process":
    case "timeline":
      return firstImplication || firstRisk || firstFact || ""
    default:
      return firstFact || firstRisk || ""
  }
}

function getResearchLayoutItems(layout: PptPreviewSlide["layout"], research: NormalizedResearchBrief) {
  switch (layout) {
    case "cover":
      return uniqueStrings([research.keyFacts[0], research.risks[0], research.implications[0]].filter(Boolean))
    case "agenda":
      return uniqueStrings([...research.keyFacts, ...research.risks, ...research.implications]).slice(0, 5)
    case "insight":
      return uniqueStrings([...research.keyFacts, ...research.implications]).slice(0, 4)
    case "comparison":
      return uniqueStrings([...research.risks, ...research.implications, ...research.keyFacts]).slice(0, 4)
    case "evidence":
      return uniqueStrings([...research.keyFacts, ...research.numericEvidence, ...research.risks]).slice(0, 4)
    case "stats":
      return uniqueStrings([...research.numericEvidence, ...research.keyFacts]).slice(0, 4)
    case "chart":
      return uniqueStrings([...research.risks, ...research.implications, ...research.numericEvidence]).slice(0, 4)
    case "process":
      return uniqueStrings([...research.implications, ...research.risks, ...research.keyFacts]).slice(0, 4)
    case "timeline":
      return uniqueStrings([...research.implications, ...research.risks, ...research.keyFacts]).slice(0, 4)
    default:
      return uniqueStrings([...research.keyFacts, ...research.risks, ...research.implications]).slice(0, 4)
  }
}

function sanitizeRawPlan(rawPlan: unknown, request: PptPreviewRequest, style: PptPreviewVariantStyle) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return rawPlan
  }

  const plan = rawPlan as Record<string, unknown>
  const rawSlides = Array.isArray(plan.slides) ? plan.slides : []
  const outline = Array.isArray(plan.outline) ? plan.outline.map((item) => normalizeText(item)).filter(Boolean) : []
  const styleSlots = getPptPreviewStyleSlotSequence(style.key, request.pageCount)
  const effectiveSlides =
    rawSlides.length > 0
      ? rawSlides
      : styleSlots.map((slot, index) => ({
          layout: slot.layout,
          intent: resolvePptPreviewSlideIntent(style.key, slot.layout),
          title: index === 0 ? normalizeText(plan.title) || request.prompt : outline[index] || `${request.prompt} ${index + 1}`,
          body:
            index === 0
              ? `围绕“${request.prompt}”生成的 ${style.name} 风格预览页。`
              : `围绕“${request.prompt}”的第 ${index + 1} 页内容提炼。`,
          bullets: [outline[index] || request.prompt],
        }))

  return {
    ...plan,
    slides: effectiveSlides.map((rawSlide) => {
      const slide = rawSlide && typeof rawSlide === "object" ? (rawSlide as Record<string, unknown>) : {}
      const bullets =
        coerceStringList(slide.bullets).length > 0
          ? coerceStringList(slide.bullets)
          : [
              ...coerceStringList(slide.contentsItems),
              ...coerceStringList(slide.comparisonItems),
              ...coerceStringList(slide.spotlightItems),
              ...coerceStringList(slide.metricItems),
              ...coerceStringList(slide.chartItems),
              ...coerceStringList(slide.processItems),
              ...coerceStringList(slide.closingItems),
            ].filter(Boolean)

      return {
        ...slide,
        title: normalizeText(slide.title),
        body: normalizeText(slide.body),
        kicker: normalizeText(slide.kicker),
        bullets: bullets.length > 0 ? bullets : [normalizeText(slide.title) || normalizeText(slide.layout) || "Key point"],
        contentsItems: Array.isArray(slide.contentsItems)
          ? slide.contentsItems.map((item, index) =>
              typeof item === "string"
                ? {
                    index: String(index + 1).padStart(2, "0"),
                    title: item.trim(),
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.contentsItems,
        comparisonItems: Array.isArray(slide.comparisonItems)
          ? slide.comparisonItems.map((item, index) =>
              typeof item === "string"
                ? {
                    label: String.fromCharCode(65 + index),
                    title: item.trim(),
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.comparisonItems,
        spotlightItems: Array.isArray(slide.spotlightItems)
          ? slide.spotlightItems.map((item, index) =>
              typeof item === "string"
                ? {
                    title: index === 0 ? item.trim() : `Signal ${index + 1}`,
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.spotlightItems,
        metricItems: Array.isArray(slide.metricItems)
          ? slide.metricItems.map((item, index) =>
              typeof item === "string"
                ? {
                    value: String(index + 1),
                    label: item.trim(),
                    note: "",
                  }
                : item,
            )
          : slide.metricItems,
        chartItems: Array.isArray(slide.chartItems)
          ? slide.chartItems.map((item, index) =>
              typeof item === "string"
                ? {
                    label: String.fromCharCode(65 + index),
                    value: 50 + index * 10,
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.chartItems,
        processItems: Array.isArray(slide.processItems)
          ? slide.processItems.map((item, index) =>
              typeof item === "string"
                ? {
                    step: String(index + 1).padStart(2, "0"),
                    title: `Step ${index + 1}`,
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.processItems,
        closingItems: Array.isArray(slide.closingItems)
          ? slide.closingItems.map((item, index) =>
              typeof item === "string"
                ? {
                    label: String(index + 1).padStart(2, "0"),
                    detail: item.trim(),
                  }
                : item,
            )
          : slide.closingItems,
      }
    }),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildSemanticSignature(value: string) {
  return stripMarkdownDecorations(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "")
    .replace(/\d+/gu, "")
    .trim()
}

function isGenericGeneratedLabel(value: string) {
  const normalized = stripMarkdownDecorations(value).trim().toLowerCase()
  if (!normalized) return true

  return [
    /^step\s*\d+$/iu,
    /^section\s*\d+$/iu,
    /^signal\s*\d+$/iu,
    /^slide\s*\d+$/iu,
    /^module\s*\d+$/iu,
    /^chapter\s*\d+$/iu,
    /^part\s*\d+$/iu,
    /^第?\s*\d+\s*(步|项|页|章|节)$/u,
    /^模块\s*\d+$/u,
    /^章节\s*\d+$/u,
    /^信号\s*\d+$/u,
  ].some((pattern) => pattern.test(normalized))
}

function looksLikePromptClone(value: string, prompt: string) {
  const candidateSignature = buildSemanticSignature(value)
  const promptSignature = buildSemanticSignature(prompt)
  if (!candidateSignature || !promptSignature) return false

  return (
    candidateSignature === promptSignature ||
    (candidateSignature.includes(promptSignature) && candidateSignature.length <= promptSignature.length + 8)
  )
}

function collectSlideContentTexts(slide: Partial<PptPreviewSlide>) {
  return [
    slide.title,
    slide.body,
    ...(slide.bullets ?? []),
    ...(slide.contentsItems?.flatMap((item) => [item.title, item.detail]) ?? []),
    ...(slide.comparisonItems?.flatMap((item) => [item.label, item.title, item.detail]) ?? []),
    ...(slide.spotlightItems?.flatMap((item) => [item.title, item.detail]) ?? []),
    ...(slide.metricItems?.flatMap((item) => [item.label, item.note ?? ""]) ?? []),
    ...(slide.chartItems?.flatMap((item) => [item.label, item.detail]) ?? []),
    ...(slide.processItems?.flatMap((item) => [item.step, item.title, item.detail]) ?? []),
    ...(slide.closingItems?.flatMap((item) => [item.label, item.detail]) ?? []),
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

export function isLowInformationPptPlan(plan: Pick<PptPreviewDeck, "outline"> & { title: string; slides: Partial<PptPreviewSlide>[] }, request: Pick<PptPreviewRequest, "prompt">) {
  const meaningfulSignatures = new Set<string>()
  let promptCloneCount = 0
  let genericLabelCount = 0
  let placeholderCount = 0
  let lowInformationSlideCount = 0

  const deckTexts = [plan.title, ...(plan.outline ?? []), ...plan.slides.flatMap((slide) => collectSlideContentTexts(slide))]
    .map((item) => normalizeText(item))
    .filter(Boolean)

  for (const value of deckTexts) {
    if (isPreviewPlaceholder(value)) {
      placeholderCount += 1
      continue
    }

    if (isGenericGeneratedLabel(value)) {
      genericLabelCount += 1
      continue
    }

    if (looksLikePromptClone(value, request.prompt)) {
      promptCloneCount += 1
      continue
    }

    const signature = buildSemanticSignature(value)
    if (signature.length >= 4) {
      meaningfulSignatures.add(signature)
    }
  }

  for (const slide of plan.slides) {
    const slideTexts = collectSlideContentTexts(slide)
    if (slideTexts.length === 0) {
      lowInformationSlideCount += 1
      continue
    }

    const meaningfulCount = slideTexts.filter((value) => {
      return !isPreviewPlaceholder(value) && !isGenericGeneratedLabel(value) && !looksLikePromptClone(value, request.prompt)
    }).length

    if (meaningfulCount === 0) {
      lowInformationSlideCount += 1
    }
  }

  const totalTextCount = deckTexts.length
  if (totalTextCount === 0) {
    return true
  }

  return (
    lowInformationSlideCount >= 3 ||
    placeholderCount >= 2 ||
    promptCloneCount >= Math.max(8, Math.floor(totalTextCount * 0.35)) ||
    genericLabelCount >= Math.max(6, Math.floor(totalTextCount * 0.25)) ||
    meaningfulSignatures.size < 10
  )
}

function getLeadToolMinimaxConfig() {
  const apiKey = normalizeText(process.env.LEAD_TOOLS_MINIMAX_API_KEY)
  const baseURL = normalizeText(process.env.LEAD_TOOLS_MINIMAX_BASE_URL) || "https://api.minimaxi.com/v1"
  const model = normalizeText(process.env.LEAD_TOOLS_MINIMAX_MODEL)

  return { apiKey, baseURL, model }
}

function getLeadToolStepfunConfig() {
  const apiKey = normalizeText(process.env.LEAD_TOOLS_STEPFUN_API_KEY || process.env.STEPFUN_API_KEY)
  const baseURL =
    normalizeText(process.env.LEAD_TOOLS_STEPFUN_BASE_URL || process.env.STEPFUN_BASE_URL) ||
    "https://api.stepfun.com/v1"
  const model = normalizeText(process.env.LEAD_TOOLS_STEPFUN_MODEL || process.env.STEPFUN_MODEL)

  return { apiKey, baseURL, model }
}

function getLeadToolGlmConfig() {
  const apiKey = normalizeText(
    process.env.LEAD_TOOLS_GLM_API_KEY || process.env.GLM_API_KEY || process.env.BIGMODEL_API_KEY,
  )
  const baseURL =
    normalizeText(process.env.LEAD_TOOLS_GLM_BASE_URL || process.env.GLM_BASE_URL || process.env.BIGMODEL_BASE_URL) ||
    "https://open.bigmodel.cn/api/paas/v4"
  const model = normalizeText(process.env.LEAD_TOOLS_GLM_MODEL || process.env.GLM_MODEL)

  return { apiKey, baseURL, model }
}

function hasLeadToolMinimaxProvider() {
  const config = getLeadToolMinimaxConfig()
  return Boolean(config.apiKey && config.baseURL && config.model)
}

function hasLeadToolStepfunProvider() {
  const config = getLeadToolStepfunConfig()
  return Boolean(config.apiKey && config.baseURL)
}

function hasLeadToolGlmProvider() {
  const config = getLeadToolGlmConfig()
  return Boolean(config.apiKey && config.baseURL)
}

function hasLeadToolPptokenProvider() {
  return getConfiguredAiEntryProviders().some((provider) => provider.id === "pptoken")
}

function hasLeadToolDeepseekProvider() {
  return getConfiguredAiEntryProviders().some((provider) => provider.id === "deepseek")
}

const PPT_PREVIEW_RUNTIME_MODELS = new Set([
  "MiniMax-M2.7-highspeed",
  "MiniMax-M3",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "grok-4.5",
  "step-3.7-flash",
])

export function normalizePptPreviewModel(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (normalized && !isDeprecatedTextModelId(normalized) && PPT_PREVIEW_RUNTIME_MODELS.has(normalized)) return normalized
  return "deepseek-v4-pro"
}

export function normalizePptRuntimeSlideModel(value: unknown) {
  const normalized = normalizeText(value)
  if (isDeprecatedTextModelId(normalized)) return "gpt-6.1-sol"
  if (!normalized || /^(?:openai|openai-compatible)\//iu.test(normalized)) {
    return "deepseek-v4-pro"
  }
  return normalized
}

function resolveRequestedPreviewModel(request: PptPreviewRequest) {
  return normalizePptPreviewModel(request.model)
}

function buildPptPlanSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "outline", "slides"],
    properties: {
      title: { type: "string" },
      outline: {
        type: "array",
        items: { type: "string" },
      },
      slides: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          required: ["layout", "intent", "title", "body", "bullets"],
          properties: {
            layout: { type: "string" },
            intent: { type: "string" },
            kicker: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            bullets: {
              type: "array",
              items: { type: "string" },
            },
            contentsItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  index: { type: "string" },
                  title: { type: "string" },
                  detail: { type: "string" },
                },
              },
            },
            comparisonItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  title: { type: "string" },
                  detail: { type: "string" },
                },
              },
            },
            spotlightItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                },
              },
            },
            metricItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                  note: { type: "string" },
                },
              },
            },
            chartItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  value: { type: "number" },
                  detail: { type: "string" },
                },
              },
            },
            processItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  step: { type: "string" },
                  title: { type: "string" },
                  detail: { type: "string" },
                },
              },
            },
            closingItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  detail: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  } satisfies Record<string, unknown>
}

function inferPreviewProviderId(model: string) {
  if (/^deepseek/iu.test(model)) {
    return "writer" as const
  }

  if (model.startsWith("MiniMax-")) {
    return "minimax" as const
  }

  if (model.startsWith("step-")) {
    return "stepfun" as const
  }

  if (/^(?:glm-|GLM-)/u.test(model)) {
    return "glm" as const
  }

  if (/^gpt-6(?:[.-](?:1|astra|luna|sol))?(?:$|[-_.])/iu.test(model)) {
    return "pptoken" as const
  }

  if (/^grok[-_.]4[-_.]5$/iu.test(model)) {
    return "pptoken" as const
  }

  return null
}

export function resolveLeadToolPreviewProviderPreference(
  model: string,
  explicitProvider?: string | null,
): LeadToolPreviewProviderId | null {
  const normalizedProvider = normalizeText(explicitProvider).toLowerCase()
  if (
    normalizedProvider === "pptoken" ||
    normalizedProvider === "minimax" ||
    normalizedProvider === "stepfun" ||
    normalizedProvider === "glm" ||
    normalizedProvider === "writer"
  ) {
    return normalizedProvider
  }

  if (
    normalizedProvider === "deepseek" ||
    (normalizedProvider === "enterprise-openai-compatible" && /^deepseek/iu.test(model))
  ) {
    return "deepseek"
  }

  if (
    normalizedProvider === "deepseek" ||
    normalizedProvider === "aiberm" ||
    normalizedProvider === "crazyroute" ||
    normalizedProvider === "crazyrouter" ||
    normalizedProvider === "openrouter"
  ) {
    return "writer"
  }

  return inferPreviewProviderId(model)
}

export function normalizePptMasterRuntimeProviderError(
  error: unknown,
  provider: string,
  model: string,
) {
  const message = error instanceof Error ? error.message : String(error)
  const normalizedProvider = normalizeText(provider) || "unknown"
  const normalizedModel = normalizeText(model) || "unknown"

  if (/headers timeout error/iu.test(message)) {
    return `ppt_master_runtime_provider_headers_timeout:${normalizedProvider}:${normalizedModel}`
  }

  if (
    /(?:fetch failed|connection error|connection terminated unexpectedly|cannot connect to api|other side closed|connect timeout|etimedout|econnreset|econnrefused|enotfound)/iu.test(
      message,
    )
  ) {
    return `ppt_master_runtime_provider_connect_failed:${normalizedProvider}:${normalizedModel}`
  }

  return message
}

async function generatePreviewTextWithProviderTimeout(params: {
  providerId: Exclude<LeadToolPreviewProviderId, "writer">
  model: string
  run: () => Promise<string>
  timeoutMs?: number
}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await withTaskTimeout(
        params.run(),
        params.timeoutMs ?? getLeadToolPreviewProviderTimeoutMs(params.providerId),
        `ppt_master_runtime_provider_timeout:${params.providerId}:${params.model}`,
      )
    } catch (error) {
      const message = normalizePptMasterRuntimeProviderError(error, params.providerId, params.model)
      const retryableTransportFailure = message.startsWith("ppt_master_runtime_provider_connect_failed:")
      if (!retryableTransportFailure || attempt >= 2) {
        throw new Error(message)
      }

      await sleep(500 * attempt)
    }
  }

  throw new Error(`ppt_master_runtime_provider_connect_failed:${params.providerId}:${params.model}`)
}

async function generateTextWithLeadToolPreviewProvider(params: {
  systemPrompt: string
  userPrompt: string
  model: string
  preferredProviderId?: LeadToolPreviewProviderId | null
  providerTimeoutMs?: number
}) {
  const preferredProviderId = resolveLeadToolPreviewProviderPreference(
    params.model,
    params.preferredProviderId || getLeadToolPptPreviewProvider(),
  )

  if (preferredProviderId === "minimax") {
    if (!hasLeadToolMinimaxProvider()) {
      throw new Error(`lead_tool_provider_missing:minimax:${params.model}`)
    }

    const config = getLeadToolMinimaxConfig()
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    const text = await generatePreviewTextWithProviderTimeout({
      providerId: "minimax",
      model: params.model,
      timeoutMs: params.providerTimeoutMs,
      run: async () => {
        const messages = buildPreviewProviderMessages({
          providerId: "minimax",
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        const response = await generateText({
          model: provider.chat(params.model),
          system: messages.system,
          prompt: messages.prompt,
        })

        const text = response.text.trim()
        if (!text) {
          throw new Error("lead_tool_preview_empty_response")
        }

        return text
      },
    })

    return {
      text,
      providerId: "minimax",
      model: params.model,
    }
  }

  if (preferredProviderId === "stepfun") {
    if (!hasLeadToolStepfunProvider()) {
      throw new Error(`lead_tool_provider_missing:stepfun:${params.model}`)
    }

    const config = getLeadToolStepfunConfig()
    const resolvedModel = config.model || params.model
    let payload:
      | {
          choices?: Array<{ message?: { content?: unknown } }>
          error?: { message?: unknown }
        }
      | null = null
    let lastError: unknown = null

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${config.baseURL.replace(/\/+$/u, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: resolvedModel,
            messages: [
              { role: "system", content: params.systemPrompt },
              { role: "user", content: params.userPrompt },
            ],
            temperature: 0.4,
            response_format: {
              type: "json_object",
            },
          }),
        })

        payload = (await response.json().catch(() => null)) as
          | {
              choices?: Array<{ message?: { content?: unknown } }>
              error?: { message?: unknown }
            }
          | null

        if (!response.ok) {
          const errorMessage = normalizeText(payload?.error?.message) || `stepfun_http_${response.status}`
          throw new Error(`lead_tool_stepfun_http_failed:${errorMessage}`)
        }

        break
      } catch (error) {
        lastError = error
        if (attempt >= 3) {
          throw error
        }
        await sleep(750 * attempt)
      }
    }

    const text = normalizeText(payload?.choices?.[0]?.message?.content)
    if (!text) {
      throw new Error(
        `lead_tool_preview_empty_response:${lastError instanceof Error ? lastError.message : "stepfun_empty_payload"}`,
      )
    }

    return {
      text,
      providerId: "stepfun",
      model: resolvedModel,
    }
  }

  if (preferredProviderId === "glm") {
    if (!hasLeadToolGlmProvider()) {
      throw new Error(`lead_tool_provider_missing:glm:${params.model}`)
    }

    const config = getLeadToolGlmConfig()
    const resolvedModel = config.model || params.model
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    const text = await generatePreviewTextWithProviderTimeout({
      providerId: "glm",
      model: resolvedModel,
      timeoutMs: params.providerTimeoutMs,
      run: async () => {
        const messages = buildPreviewProviderMessages({
          providerId: "stepfun",
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        const response = await generateText({
          model: provider.chat(resolvedModel),
          system: messages.system,
          prompt: messages.prompt,
        })

        const text = response.text.trim()
        if (!text) {
          throw new Error("lead_tool_preview_empty_response")
        }

        return text
      },
    })

    return {
      text,
      providerId: "glm",
      model: resolvedModel,
    }
  }

  if (preferredProviderId === "pptoken") {
    if (!hasLeadToolPptokenProvider()) {
      throw new Error(`lead_tool_provider_missing:pptoken:${params.model}`)
    }

    let result: Awaited<ReturnType<typeof executeAiEntryWithProviderFailover<string>>>
    try {
      result = await executeAiEntryWithProviderFailover(
        async (providerRun) => {
          return generatePreviewTextWithProviderTimeout({
            providerId: "pptoken",
            model: providerRun.model,
            timeoutMs: params.providerTimeoutMs,
            run: async () => {
              const messages = buildPreviewProviderMessages({
                providerId: "pptoken",
                systemPrompt: params.systemPrompt,
                userPrompt: params.userPrompt,
              })
              const response = await generateText({
                model: providerRun.provider.chat(providerRun.model),
                system: messages.system,
                prompt: messages.prompt,
              })

              const text = response.text.trim()
              if (!text) throw new Error("lead_tool_preview_empty_response")
              return text
            },
          })
        },
        {
          preferredProviderId: "pptoken",
          preferredModel: params.model,
          forcePreferredProvider: true,
        },
      )
    } catch (error) {
      const detail = normalizePptMasterRuntimeProviderError(error, "pptoken", params.model)
      if (
        !hasLeadToolMinimaxProvider() ||
        (!detail.startsWith("ppt_master_runtime_provider_timeout:") &&
          !detail.startsWith("ppt_master_runtime_provider_connect_failed:"))
      ) {
        throw error
      }

      const fallback = getLeadToolMinimaxConfig()
      return generateTextWithLeadToolPreviewProvider({
        ...params,
        model: fallback.model || "MiniMax-M2.7-highspeed",
        preferredProviderId: "minimax",
      })
    }

    return {
      text: result.result,
      providerId: result.providerId,
      model: result.model,
    }
  }

  if (preferredProviderId === "deepseek") {
    if (!hasLeadToolDeepseekProvider()) {
      throw new Error(`lead_tool_provider_missing:deepseek:${params.model}`)
    }

    const result = await executeAiEntryWithProviderFailover(
      async (providerRun) => {
        return generatePreviewTextWithProviderTimeout({
          providerId: "deepseek",
          model: providerRun.model,
          timeoutMs: params.providerTimeoutMs,
          run: async () => {
            const messages = buildPreviewProviderMessages({
              providerId: "deepseek",
              systemPrompt: params.systemPrompt,
              userPrompt: params.userPrompt,
            })
            const response = await generateText({
              model: providerRun.provider.chat(providerRun.model),
              system: messages.system,
              prompt: messages.prompt,
            })

            const text = response.text.trim()
            if (!text) {
              throw new Error("lead_tool_preview_empty_response")
            }

            return text
          },
        })
      },
      {
        preferredProviderId: "deepseek",
        preferredModel: params.model,
        forcePreferredProvider: true,
      },
    )

    return {
      text: result.result,
      providerId: result.providerId,
      model: result.model,
    }
  }

  if (preferredProviderId === "writer") {
    const text = await generateTextWithWriterModelImpl(params.systemPrompt, params.userPrompt, params.model, {
      temperature: 0.45,
      maxTokens: 1400,
      timeoutMs: 36_000,
      totalTimeoutMs: 42_000,
    })

    return {
      text,
      providerId: hasAibermApiKey() ? "aiberm" : hasCrazyrouteApiKey() ? "crazyroute" : "writer",
      model: params.model,
    }
  }

  if (hasLeadToolMinimaxProvider()) {
    const config = getLeadToolMinimaxConfig()
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    const resolvedModel = config.model || params.model
    const text = await generatePreviewTextWithProviderTimeout({
      providerId: "minimax",
      model: resolvedModel,
      timeoutMs: params.providerTimeoutMs,
      run: async () => {
        const messages = buildPreviewProviderMessages({
          providerId: "minimax",
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        const response = await generateText({
          model: provider.chat(resolvedModel),
          system: messages.system,
          prompt: messages.prompt,
        })

        const text = response.text.trim()
        if (!text) {
          throw new Error("lead_tool_preview_empty_response")
        }

        return text
      },
    })

    return {
      text,
      providerId: "minimax",
      model: resolvedModel,
    }
  }

  if (hasLeadToolStepfunProvider()) {
    const config = getLeadToolStepfunConfig()
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    const resolvedModel = config.model || params.model
    const text = await generatePreviewTextWithProviderTimeout({
      providerId: "stepfun",
      model: resolvedModel,
      timeoutMs: params.providerTimeoutMs,
      run: async () => {
        const messages = buildPreviewProviderMessages({
          providerId: "stepfun",
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        const response = await generateText({
          model: provider.chat(resolvedModel),
          system: messages.system,
          prompt: messages.prompt,
        })

        const text = response.text.trim()
        if (!text) {
          throw new Error("lead_tool_preview_empty_response")
        }

        return text
      },
    })

    return {
      text,
      providerId: "stepfun",
      model: resolvedModel,
    }
  }

  if (hasLeadToolGlmProvider()) {
    const config = getLeadToolGlmConfig()
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    const resolvedModel = config.model || params.model
    const text = await generatePreviewTextWithProviderTimeout({
      providerId: "glm",
      model: resolvedModel,
      timeoutMs: params.providerTimeoutMs,
      run: async () => {
        const messages = buildPreviewProviderMessages({
          providerId: "glm",
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        const response = await generateText({
          model: provider.chat(resolvedModel),
          system: messages.system,
          prompt: messages.prompt,
        })

        const text = response.text.trim()
        if (!text) {
          throw new Error("lead_tool_preview_empty_response")
        }

        return text
      },
    })

    return {
      text,
      providerId: "glm",
      model: resolvedModel,
    }
  }

  if (hasLeadToolPptokenProvider()) {
    const result = await executeAiEntryWithProviderFailover(
      async (providerRun) => {
        return generatePreviewTextWithProviderTimeout({
          providerId: "pptoken",
          model: providerRun.model,
          run: async () => {
            const messages = buildPreviewProviderMessages({
              providerId: "pptoken",
              systemPrompt: params.systemPrompt,
              userPrompt: params.userPrompt,
            })
            const response = await generateText({
              model: providerRun.provider.chat(providerRun.model),
              system: messages.system,
              prompt: messages.prompt,
            })

            const text = response.text.trim()
            if (!text) {
              throw new Error("lead_tool_preview_empty_response")
            }

            return text
          },
        })
      },
      {
        preferredProviderId: "pptoken",
        preferredModel: params.model,
        forcePreferredProvider: true,
      },
    )

    return {
      text: result.result,
      providerId: result.providerId,
      model: result.model,
    }
  }

  const text = await generateTextWithWriterModel(params.systemPrompt, params.userPrompt, params.model, {
    temperature: 0.45,
    maxTokens: 1400,
    timeoutMs: 36_000,
    totalTimeoutMs: 42_000,
  })

  return {
    text,
    providerId: hasAibermApiKey() ? "aiberm" : hasCrazyrouteApiKey() ? "crazyroute" : "writer",
    model: params.model,
  }
}

function estimateAutoPptPageCount(request: PptPreviewRequest) {
  const promptLength = request.prompt.trim().length
  let estimate =
    request.scenario === "training"
      ? 10
      : request.scenario === "sales-deck"
        ? 8
        : request.scenario === "product-launch"
          ? 9
          : 8

  if (promptLength >= 90) {
    estimate += 4
  } else if (promptLength >= 55) {
    estimate += 2
  } else if (promptLength >= 28) {
    estimate += 1
  }

  return resolvePptPreviewPageCount(estimate)
}

function extractPlannedPageCount(rawText: string) {
  const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
  const jsonMatch = cleanedText.match(/\{[\s\S]*?"pageCount"\s*:\s*(\d+)[\s\S]*?\}/i)
  if (jsonMatch?.[1]) {
    return resolvePptPreviewPageCount(Number.parseInt(jsonMatch[1], 10))
  }

  const digitMatch = cleanedText.match(/\b(\d{1,2})\b/)
  if (digitMatch?.[1]) {
    return resolvePptPreviewPageCount(Number.parseInt(digitMatch[1], 10))
  }

  return null
}

async function resolveLeadToolPptPageCount(request: PptPreviewRequest) {
  const requestedPageCount = resolveOptionalPptPreviewPageCount(request.pageCount)
  if (requestedPageCount != null) {
    return requestedPageCount
  }

  const fallbackCount = estimateAutoPptPageCount(request)

  try {
    const providerResult = await generateTextWithLeadToolPreviewProvider({
      systemPrompt:
        request.language === "zh-CN"
          ? [
              "你是演示文稿策划器里的页数规划助手。",
              `请在 ${MIN_PPT_PREVIEW_PAGE_COUNT} 到 ${MAX_PPT_PREVIEW_PAGE_COUNT} 之间选择一个最合适的页数。`,
              "只返回一个 JSON 对象，格式必须是 {\"pageCount\": number, \"reason\": string}。",
              "页数要由主题复杂度、场景和信息密度决定，不要默认 9 页。",
            ].join(" ")
          : [
              "You are the slide-count planner for a presentation workflow.",
              `Choose the most appropriate page count between ${MIN_PPT_PREVIEW_PAGE_COUNT} and ${MAX_PPT_PREVIEW_PAGE_COUNT}.`,
              'Return exactly one JSON object in the form {"pageCount": number, "reason": string}.',
              "The count must reflect topic complexity, scenario, and information density rather than defaulting to nine slides.",
            ].join(" "),
      userPrompt: [
        `Topic: ${request.prompt}`,
        `Scenario: ${request.scenario}`,
        `Language: ${request.language}`,
        request.language === "zh-CN"
          ? "如果主题需要更多证据、对照、图表或执行步骤，就适当增加页数；如果主题非常单一，就保持更紧凑。"
          : "Increase the count when the topic needs more proof, comparison, charts, or execution detail; keep it tighter when the topic is narrow.",
      ].join("\n"),
      model: resolveRequestedPreviewModel(request),
    })

    return extractPlannedPageCount(providerResult.text) ?? fallbackCount
  } catch {
    return fallbackCount
  }
}

function extractJsonObjectBlock(rawText: string) {
  const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
  const candidates: string[] = []

  for (const match of cleanedText.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) {
      candidates.push(match[1].trim())
    }
  }

  for (const match of cleanedText.matchAll(/```\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) {
      candidates.push(match[1].trim())
    }
  }

  const slidesObjectMatch = cleanedText.match(/\{[\s\S]*"slides"\s*:\s*\[[\s\S]*\}\s*$/i)
  if (slidesObjectMatch?.[0]?.trim()) {
    candidates.push(slidesObjectMatch[0].trim())
  }

  const firstBrace = cleanedText.indexOf("{")
  const lastBrace = cleanedText.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleanedText.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      continue
    }
  }

  throw new Error("ppt_preview_json_missing")
}

async function generateStructuredPptPlanWithWriter(params: {
  systemPrompt: string
  userPrompt: string
  model: string
  preferredProviderId?: LeadToolPreviewProviderId | null
}) {
  const result = await generateStructuredObjectWithWriterModelImpl({
    model: params.model,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    toolName: "return_ppt_preview_plan",
    toolDescription: "Return a structured PPT preview plan with title, outline, and slides.",
    jsonSchema: buildPptPlanSchema(),
    options: {
      temperature: 0.45,
      maxTokens: 2400,
      timeoutMs: 36_000,
      totalTimeoutMs: 42_000,
      preferredProviderId:
        params.preferredProviderId === "writer" ? undefined : (params.preferredProviderId as any),
    },
  })

  return {
    rawPlan: result,
    providerId: hasAibermApiKey() ? "aiberm" : hasCrazyrouteApiKey() ? "crazyroute" : "writer",
    model: params.model,
  }
}

function buildFallbackBody(
  layout: PptPreviewSlide["layout"],
  fallbackTitle: string,
  language: PptPreviewRequest["language"],
  research?: NormalizedResearchBrief,
) {
  const researchBody = research ? buildResearchBody(layout, research, language) : ""
  if (researchBody) {
    return researchBody
  }

  if (language === "zh-CN") {
    switch (layout) {
      case "cover":
        return `${fallbackTitle} 的核心现状、关键风险与影响范围概览。`
      case "agenda":
        return "本页概览核心议题：现状、风险、全球影响与后续观察重点。"
      case "insight":
        return "提炼当前最值得关注的事实、变化趋势与结构性影响。"
      case "comparison":
        return "对比关键变量、参与方立场或不同路径下的影响差异。"
      case "evidence":
        return "补充最值得引用的证据、事实锚点与支持判断。"
      case "stats":
        return "提炼会直接影响决策的关键数字与压力指标。"
      case "chart":
        return "把影响链条压缩成一眼能看懂的扩散结构或图示。"
      case "process":
        return "给出从识别到响应的执行步骤与推进节奏。"
      case "timeline":
        return "以收束页形式给出接下来最值得执行或持续观察的动作。"
      default:
        return `${fallbackTitle} 的关键结论与解释。`
    }
  }

  switch (layout) {
    case "cover":
      return `An at-a-glance view of the current situation, risks, and impact around ${fallbackTitle}.`
    case "agenda":
      return "This slide frames the core agenda: status, risk, global impact, and what to watch next."
    case "insight":
      return "Highlight the most important facts, shifts, and structural implications."
    case "comparison":
      return "Compare the most important variables, stakeholder positions, or scenario outcomes."
    case "evidence":
      return "Add the most quotable proof, factual anchors, and evidence that support the core claim."
    case "stats":
      return "Surface the numbers and signals that would actually change the decision."
    case "chart":
      return "Compress the impact chain into a chartable or diagram-first logic."
    case "process":
      return "Lay out the response steps and execution order in a clear progression."
    case "timeline":
      return "Close with the next moves, watchpoints, or actions rather than a literal chronology."
    default:
      return `Summarize the key conclusions and implications around ${fallbackTitle}.`
  }
}

function buildFallbackSlideTitle(
  layout: PptPreviewSlide["layout"],
  fallbackTitle: string,
  language: PptPreviewRequest["language"],
  research?: NormalizedResearchBrief,
) {
  const topic = normalizeText(research?.topic) || fallbackTitle
  if (layout === "cover") {
    return topic
  }

  if (language === "zh-CN") {
    switch (layout) {
      case "agenda":
        return `${topic}的结构总览`
      case "insight":
        return `${topic}的核心判断`
      case "comparison":
        return `${topic}的关键比较`
      case "evidence":
        return `${topic}的证据页`
      case "stats":
        return `${topic}的关键数据`
      case "chart":
        return `${topic}的图示页`
      case "process":
        return `${topic}的执行路径`
      case "timeline":
        return `${topic}的结束页`
    }
  }

  switch (layout) {
    case "agenda":
      return `${topic} structure`
    case "insight":
      return `${topic} key insight`
    case "comparison":
      return `${topic} comparison`
    case "evidence":
      return `${topic} proof`
    case "stats":
      return `${topic} stats`
    case "chart":
      return `${topic} chart`
    case "process":
      return `${topic} process`
    case "timeline":
      return `${topic} closing`
    default:
      return topic
  }
}

function buildFallbackBullets(
  layout: PptPreviewSlide["layout"],
  fallbackTitle: string,
  language: PptPreviewRequest["language"],
  research?: NormalizedResearchBrief,
) {
  const researchItems = research ? getResearchLayoutItems(layout, research) : []
  if (researchItems.length > 0) {
    return researchItems
  }

  if (language === "zh-CN") {
    switch (layout) {
      case "cover":
        return ["现状概览", "核心风险", "影响范围"]
      case "agenda":
        return ["业务现状与判断", "关键模块与价值", "落地节奏与动作"]
      case "insight":
        return ["当前事实", "变化趋势", "结构性影响"]
      case "comparison":
        return ["关键变量对比", "不同路径影响", "参与方立场差异"]
      case "evidence":
        return ["事实锚点", "可复述证据", "支持判断"]
      case "stats":
        return ["关键数字", "压力指标", "变化幅度"]
      case "chart":
        return ["主轴关系", "外溢路径", "最终影响"]
      case "process":
        return ["识别", "切换", "执行", "跟踪"]
      case "timeline":
        return ["收束判断", "下一步动作", "持续观察点"]
      default:
        return [`聚焦 ${fallbackTitle}`, "补齐核心结论"]
    }
  }

  switch (layout) {
    case "cover":
      return ["Current status", "Core risk", "Impact scope"]
    case "agenda":
      return ["Transit status", "Energy and shipping impact", "What to watch next"]
    case "insight":
      return ["Key facts", "Emerging shift", "Structural implication"]
    case "comparison":
      return ["Variable comparison", "Scenario impact", "Stakeholder differences"]
    case "evidence":
      return ["Proof point", "Quoted fact", "Supportive anchor"]
    case "stats":
      return ["Core number", "Pressure signal", "Magnitude shift"]
    case "chart":
      return ["Primary axis", "Spillover path", "Resulting impact"]
    case "process":
      return ["Identify", "Switch", "Execute", "Track"]
    case "timeline":
      return ["Closing judgment", "Next move", "Watchpoint"]
    default:
      return [`Focus on ${fallbackTitle}`, "Fill in the key takeaway"]
  }
}

function buildFallbackComparisonItems(
  slide: Pick<PptPreviewSlide, "bullets" | "title">,
  language: PptPreviewRequest["language"],
) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    label: String.fromCharCode(65 + index),
    title: buildResearchHeadline(bullet, language) || `${slide.title} ${index + 1}`,
    detail: bullet,
  }))
}

function buildFallbackContentsItems(
  slide: Pick<PptPreviewSlide, "bullets" | "title">,
  language: PptPreviewRequest["language"],
) {
  return slide.bullets.slice(0, 9).map((bullet, index) => ({
    index: String(index + 1).padStart(2, "0"),
    title: buildResearchHeadline(bullet, language) || (index === 0 ? slide.title : `Section ${index + 1}`),
    detail: bullet,
  }))
}

function buildFallbackSpotlightItems(
  slide: Pick<PptPreviewSlide, "bullets" | "title">,
  language: PptPreviewRequest["language"],
) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    title: buildResearchHeadline(bullet, language) || (index === 0 ? slide.title : `Signal ${index + 1}`),
    detail: bullet,
  }))
}

function buildFallbackMetricItems(
  slide: Pick<PptPreviewSlide, "bullets">,
  language: PptPreviewRequest["language"],
) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    value: extractMetricValue(bullet, index),
    label: buildResearchHeadline(bullet, language) || bullet,
    note: bullet,
  }))
}

function buildFallbackChartItems(slide: Pick<PptPreviewSlide, "bullets">) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    label: String.fromCharCode(65 + index),
    value: extractChartValue(bullet, index),
    detail: bullet,
  }))
}

function buildFallbackProcessItems(
  slide: Pick<PptPreviewSlide, "bullets">,
  language: PptPreviewRequest["language"],
) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    step: String(index + 1).padStart(2, "0"),
    title: buildResearchHeadline(bullet, language) || `Step ${index + 1}`,
    detail: bullet,
  }))
}

function buildFallbackClosingItems(slide: Pick<PptPreviewSlide, "bullets">) {
  return slide.bullets.slice(0, 4).map((bullet, index) => ({
    label: String(index + 1).padStart(2, "0"),
    detail: bullet,
  }))
}

function getLayoutTextLimits(layout: PptPreviewSlide["layout"], language: PptPreviewRequest["language"]) {
  const zh = language === "zh-CN"

  switch (layout) {
    case "cover":
      return {
        title: zh ? 22 : 42,
        body: zh ? 42 : 96,
        bullet: zh ? 14 : 28,
        bullets: 3,
      }
    case "agenda":
      return {
        title: zh ? 22 : 42,
        body: zh ? 40 : 90,
        bullet: zh ? 18 : 34,
        bullets: 5,
      }
    case "comparison":
      return {
        title: zh ? 20 : 38,
        body: zh ? 36 : 84,
        bullet: zh ? 16 : 30,
        bullets: 4,
      }
    case "stats":
    case "chart":
    case "process":
      return {
        title: zh ? 20 : 38,
        body: zh ? 34 : 80,
        bullet: zh ? 14 : 28,
        bullets: 4,
      }
    case "evidence":
      return {
        title: zh ? 20 : 38,
        body: zh ? 34 : 80,
        bullet: zh ? 15 : 30,
        bullets: 3,
      }
    default:
      return {
        title: zh ? 20 : 38,
        body: zh ? 34 : 80,
        bullet: zh ? 15 : 30,
        bullets: 3,
      }
  }
}

export function normalizeLeadToolPptPlan(rawPlan: any, request: PptPreviewRequest, style: PptPreviewVariantStyle): LeadToolPptPlan {
  const pageCount = resolvePptPreviewPageCount(request.pageCount)
  const styleSlots = getPptPreviewStyleSlotSequence(style.key, pageCount)
  const research = normalizeResearchBrief(request.researchBrief, request.prompt.trim())
  const fallbackTitle = research.topic || request.prompt.trim()
  const rawSlides = Array.isArray(rawPlan?.slides) ? rawPlan.slides : []
  const normalizedCandidates = rawSlides.map((rawSlide: any, index: number) => {
    const titleCandidate = typeof rawSlide?.title === "string" ? stripMarkdownDecorations(rawSlide.title) : ""
    const bodyCandidate = typeof rawSlide?.body === "string" ? stripMarkdownDecorations(rawSlide.body) : ""
    const kickerCandidate = typeof rawSlide?.kicker === "string" ? stripMarkdownDecorations(rawSlide.kicker) : ""
    const bulletCandidates = Array.isArray(rawSlide?.bullets)
      ? rawSlide.bullets.map((item: unknown) => (typeof item === "string" ? stripMarkdownDecorations(item) : "")).filter(Boolean)
      : []
    const contentsItems = Array.isArray(rawSlide?.contentsItems)
      ? rawSlide.contentsItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              index: toStructuredString(row?.index),
              title: toStructuredString(row?.title),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { index: string; title: string; detail: string }) => item.index && item.title && item.detail)
      : []
    const comparisonItems = Array.isArray(rawSlide?.comparisonItems)
      ? rawSlide.comparisonItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              label: toStructuredString(row?.label),
              title: toStructuredString(row?.title),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { label: string; title: string; detail: string }) => item.label && item.title && item.detail)
      : []
    const metricItems = Array.isArray(rawSlide?.metricItems)
      ? rawSlide.metricItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              value: toStructuredString(row?.value),
              label: toStructuredString(row?.label),
              note: toStructuredString(row?.note),
            }
          })
          .filter((item: { value: string; label: string; note: string }) => item.value && item.label)
      : []
    const chartItems = Array.isArray(rawSlide?.chartItems)
      ? rawSlide.chartItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              label: toStructuredString(row?.label),
              value: toStructuredNumber(row?.value),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { label: string; value: number | null; detail: string }) => item.label && item.detail && typeof item.value === "number")
          .map((item: { label: string; value: number | null; detail: string }) => ({ label: item.label, detail: item.detail, value: item.value as number }))
      : []
    const processItems = Array.isArray(rawSlide?.processItems)
      ? rawSlide.processItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              step: toStructuredString(row?.step),
              title: toStructuredString(row?.title),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { step: string; title: string; detail: string }) => item.step && item.title && item.detail)
      : []
    const spotlightItems = Array.isArray(rawSlide?.spotlightItems)
      ? rawSlide.spotlightItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              title: toStructuredString(row?.title),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { title: string; detail: string }) => item.title && item.detail)
      : []
    const closingItems = Array.isArray(rawSlide?.closingItems)
      ? rawSlide.closingItems
          .map((item: unknown) => {
            const row = item as Record<string, unknown>
            return {
              label: toStructuredString(row?.label),
              detail: toStructuredString(row?.detail),
            }
          })
          .filter((item: { label: string; detail: string }) => item.label && item.detail)
      : []
    const layoutValue = typeof rawSlide?.layout === "string" ? rawSlide.layout.trim() : ""
    const intentValue = typeof rawSlide?.intent === "string" ? rawSlide.intent.trim() : ""
    const normalizedLayout = isPptPreviewLayout(layoutValue)
      ? layoutValue
      : isPptPreviewPageIntent(layoutValue)
        ? resolvePptPreviewSlideLayout(style.key, layoutValue)
        : undefined
    const normalizedIntent = isPptPreviewPageIntent(intentValue)
      ? intentValue
      : normalizedLayout
        ? resolvePptPreviewSlideIntent(style.key, normalizedLayout)
        : isPptPreviewPageIntent(layoutValue)
          ? layoutValue
          : undefined

    return {
      sourceIndex: index,
      layout: normalizedLayout,
      intent: normalizedIntent,
      kicker: kickerCandidate,
      title: titleCandidate,
      body: bodyCandidate,
      bullets: bulletCandidates,
      contentsItems,
      comparisonItems,
      spotlightItems,
      metricItems,
      chartItems,
      processItems,
      closingItems,
    }
  })
  type NormalizedCandidate = (typeof normalizedCandidates)[number]

  const usedCandidateIndexes = new Set<number>()
  const slides = styleSlots.map((slot, index) => {
    const matchedByIntent = normalizedCandidates.find(
      (candidate: NormalizedCandidate, candidateIndex: number) =>
        !usedCandidateIndexes.has(candidateIndex) && candidate.intent === slot.intent,
    )
    const matchedByLayout = normalizedCandidates.find(
      (candidate: NormalizedCandidate, candidateIndex: number) =>
        !usedCandidateIndexes.has(candidateIndex) && candidate.layout === slot.layout,
    )
    const fallbackCandidate = normalizedCandidates.find(
      (candidate: NormalizedCandidate, candidateIndex: number) =>
        !usedCandidateIndexes.has(candidateIndex) && candidate.sourceIndex === index,
    )
    const rawSlide: Partial<NormalizedCandidate> =
      matchedByIntent ?? matchedByLayout ?? fallbackCandidate ?? normalizedCandidates[index] ?? {}
    const candidateIndex = normalizedCandidates.indexOf(rawSlide as NormalizedCandidate)
    if (candidateIndex >= 0) {
      usedCandidateIndexes.add(candidateIndex)
    }

    const limits = getLayoutTextLimits(slot.layout, request.language)
    const slotSchema = getPptPreviewTemplateSlotByLayout(style.key, slot.layout)
    const structuredFields = slotSchema?.structuredFields ?? []
    const fallbackBullets = buildFallbackBullets(slot.layout, fallbackTitle, request.language, research)
    const bulletSource = mergeMeaningfulTextCandidates(rawSlide.bullets ?? [], fallbackBullets, request.prompt, limits.bullets)
    const bullets = bulletSource.length > 0 ? bulletSource : fallbackBullets.slice(0, limits.bullets)
    const title =
      isMeaningfulDeckText(rawSlide.title ?? "", request.prompt)
        ? (rawSlide.title as string).trim()
        : buildFallbackSlideTitle(slot.layout, fallbackTitle, request.language, research).trim()
    const body =
      isMeaningfulDeckText(rawSlide.body ?? "", request.prompt)
        ? (rawSlide.body as string).trim()
        : buildFallbackBody(slot.layout, fallbackTitle, request.language, research).trim()

    return {
      layout: slot.layout,
      intent: slot.intent,
      nativePageType: slotSchema?.nativePageType,
      structuredFields: [...structuredFields],
      kicker: (rawSlide.kicker || `Slide ${index + 1}`).trim(),
      title,
      body,
      bullets,
      contentsItems:
        structuredFields.includes("contentsItems")
          ? (
              rawSlide.contentsItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.contentsItems.flatMap((item: { title: string; detail: string }) => [item.title, item.detail]),
                request.prompt,
              )
                ? rawSlide.contentsItems
                : buildFallbackContentsItems({ title, bullets }, request.language)
            ).slice(0, 9)
          : undefined,
      comparisonItems:
        structuredFields.includes("comparisonItems")
          ? (
              rawSlide.comparisonItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.comparisonItems.flatMap((item: { title: string; detail: string }) => [item.title, item.detail]),
                request.prompt,
              )
                ? rawSlide.comparisonItems
                : buildFallbackComparisonItems({ title, bullets }, request.language)
            ).slice(0, 4)
          : undefined,
      spotlightItems:
        structuredFields.includes("spotlightItems")
          ? (
              rawSlide.spotlightItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.spotlightItems.flatMap((item: { title: string; detail: string }) => [item.title, item.detail]),
                request.prompt,
              )
                ? rawSlide.spotlightItems
                : buildFallbackSpotlightItems({ title, bullets }, request.language)
            ).slice(0, 4)
          : undefined,
      metricItems:
        structuredFields.includes("metricItems")
          ? (
              rawSlide.metricItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.metricItems.flatMap((item: { value: string; label: string; note?: string }) => [
                  item.value,
                  item.label,
                  item.note ?? "",
                ]),
                request.prompt,
              )
                ? rawSlide.metricItems
                : buildFallbackMetricItems({ bullets }, request.language)
            ).slice(0, 4)
          : undefined,
      chartItems:
        structuredFields.includes("chartItems")
          ? (
              rawSlide.chartItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.chartItems.flatMap((item: { label: string; detail: string }) => [item.label, item.detail]),
                request.prompt,
              )
                ? rawSlide.chartItems
                : buildFallbackChartItems({ bullets })
            ).slice(0, 4)
          : undefined,
      processItems:
        structuredFields.includes("processItems")
          ? (
              rawSlide.processItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.processItems.flatMap((item: { title: string; detail: string }) => [item.title, item.detail]),
                request.prompt,
              )
                ? rawSlide.processItems
                : buildFallbackProcessItems({ bullets }, request.language)
            ).slice(0, 4)
          : undefined,
      closingItems:
        structuredFields.includes("closingItems")
          ? (
              rawSlide.closingItems?.length &&
              hasMeaningfulStructuredContent(
                rawSlide.closingItems.flatMap((item: { label: string; detail: string }) => [item.label, item.detail]),
                request.prompt,
              )
                ? rawSlide.closingItems
                : buildFallbackClosingItems({ bullets })
            ).slice(0, 4)
          : undefined,
    }
  }) as LeadToolPptPlan["slides"]

  const rawOutline = Array.isArray(rawPlan?.outline)
    ? rawPlan.outline.map((item: unknown) => (typeof item === "string" ? stripMarkdownDecorations(item) : "")).filter(Boolean)
    : []

  const normalizedTitle =
    typeof rawPlan?.title === "string" && isMeaningfulDeckText(rawPlan.title, request.prompt)
      ? stripMarkdownDecorations(rawPlan.title)
      : fallbackTitle

  const normalizedOutline = (rawOutline.length >= pageCount ? rawOutline : slides.map((slide) => slide.title).slice(0, pageCount)) as LeadToolPptPlan["outline"]

  return {
    title: normalizedTitle,
    outline: normalizedOutline,
    slides,
  }
}

function isHexColor(value: string) {
  if (value.length !== 7 || value[0] !== "#") return false
  return Array.from(value.slice(1)).every((character) => "0123456789abcdefABCDEF".includes(character))
}

function extractHexColor(value: string) {
  for (let index = 0; index <= value.length - 7; index += 1) {
    const candidate = value.slice(index, index + 7)
    if (isHexColor(candidate)) return candidate.toUpperCase()
  }
  return null
}

function readOfficialTemplateValue(content: string, key: string) {
  const prefix = `- ${key}:`
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim()
    const line = trimmed.endsWith("\r") ? trimmed.slice(0, -1) : trimmed
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
  }
  return null
}

function readOfficialDesignRoleColor(content: string, role: string) {
  const marker = `| ${role.toLowerCase()} |`
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim().toLowerCase()
    if (line.includes(marker)) {
      const color = extractHexColor(rawLine)
      if (color) return color
    }
  }
  return null
}

function resolveOfficialTemplateColor(
  reference: ImportedPptMasterTemplateReference,
  lockKeys: readonly string[],
  designRoles: readonly string[],
) {
  for (const key of lockKeys) {
    const value = reference.specLockContent ? extractHexColor(readOfficialTemplateValue(reference.specLockContent, key) ?? "") : null
    if (value) return value
  }
  for (const role of designRoles) {
    const value = reference.designSpecContent ? readOfficialDesignRoleColor(reference.designSpecContent, role) : null
    if (value) return value
  }
  return null
}

function buildPptMasterVariantStyle(
  descriptor: PptPreviewVariantDescriptor,
  reference: ImportedPptMasterTemplateReference,
): PptPreviewVariantStyle {
  const officialBackground = resolveOfficialTemplateColor(reference, ["bg", "background"], ["bg", "background"])
  const officialForeground = resolveOfficialTemplateColor(reference, ["text", "primary"], ["text", "primary", "neutral-dark"])
  const officialAccent = resolveOfficialTemplateColor(reference, ["accent", "secondary_accent"], ["accent", "primary"])
  const officialPanel = resolveOfficialTemplateColor(
    reference,
    ["secondary_bg", "bg_secondary", "bg_paper", "card_bg", "panel", "surface"],
    ["secondary_bg", "bg_secondary", "bg_paper", "card_bg", "panel", "surface"],
  )
  const officialBorder = resolveOfficialTemplateColor(reference, ["border"], ["border"])
  const allowsPaletteFallback = reference.kind === "layout" || reference.kind === "brand"
  const background = officialBackground ?? (allowsPaletteFallback ? descriptor.style.palette.background : null)
  const foreground = officialForeground ?? (allowsPaletteFallback ? descriptor.style.palette.foreground : null)
  const accent = officialAccent ?? (allowsPaletteFallback ? descriptor.style.palette.accent : null)
  const panel = officialPanel ?? (allowsPaletteFallback ? descriptor.style.palette.panel : null)
  const border = officialBorder ?? (allowsPaletteFallback ? descriptor.style.palette.border : null)

  if (!background || !foreground || !accent || !panel || !border) {
    throw new Error(`ppt_master_template_visual_contract_missing:${reference.templateId}`)
  }

  const officialContract = [reference.designSpecContent, reference.specLockContent].filter(Boolean).join("\n\n")
  const contractGuidance = officialContract ||
    `Use the native SVG roster from ${reference.sourcePathLabel}; keep its page structures and compose content within those layouts.`
  return {
    ...descriptor.style,
    name: reference.designSpecTitle || reference.templateId,
    summary: reference.designSpecExcerpt || reference.templateId,
    stylePrompt: [
      `Use only the official ppt-master template ${reference.templateId}.`,
      "The following files are the source of truth. Do not substitute a local preset, frontend-slides style, Swiss Grid style, or custom palette.",
      contractGuidance,
    ].join("\n\n"),
    palette: { background, foreground, accent, panel, border },
    strengths: [],
  }
}

export function buildStyleAwarePrompt(
  request: PptPreviewRequest,
  descriptor: PptPreviewVariantDescriptor,
  templateReference?: ImportedPptMasterTemplateReference,
) {
  const style = templateReference ? buildPptMasterVariantStyle(descriptor, templateReference) : descriptor.style
  const pageCount = resolvePptPreviewPageCount(request.pageCount)
  const research = normalizeResearchBrief(request.researchBrief, request.prompt.trim())
  const layoutSequence = getPptPreviewLayoutSequence(pageCount)
  const styleSlots = templateReference ? [] : getPptPreviewStyleSlotSequence(style.key, pageCount)
  const intentSequence = templateReference
    ? request.language === "zh-CN"
      ? "以官方 ppt-master spec_lock.md 中的 page_rhythm 和模板原生结构为准。"
      : "Follow the official ppt-master spec_lock.md page_rhythm and native template structure."
    : buildPptPreviewIntentSequenceLabel(style.key, request.language, pageCount)
  const rawIntentSequence = styleSlots.map((slot) => slot.intent).join(", ")
  const capabilityLabel = templateReference
    ? templateReference.designSpecExcerpt || templateReference.templateId
    : buildPptPreviewTemplateCapabilityLabel(style.key, request.language)
  const templateMode = resolvePptPreviewTemplateMode(request)
  const templateLabel = getPptPreviewTemplateLabel(descriptor.templateId, request.language)
  const narrativeAngleLabel = descriptor.narrativeAngle
    ? getPptPreviewNarrativeAngleLabel(descriptor.narrativeAngle, request.language)
    : undefined
  const narrativeAnglePrompt = descriptor.narrativeAngle
    ? getPptPreviewNarrativeAnglePrompt(descriptor.narrativeAngle, request.language)
    : undefined
  const densityHint = templateReference
    ? ""
    : request.language === "zh-CN"
      ? style.key === "ppt169_swiss_grid_systems"
        ? "Neo-Grid Bold 这种分析型模板要把网格喂满：agenda 尽量给满 9 个模块中的主要章节，comparison、stats、chart 和 closing 都尽量给 3-4 个短而硬的信号项，不要过度留白。"
        : ""
      : style.key === "ppt169_swiss_grid_systems"
        ? "For Neo-Grid Bold, feed the grid: aim for a full 9-page structure, and keep comparison, stats, chart, and closing pages stocked with 3-4 sharp signal items so the layout does not feel underfilled."
        : ""

  return [
    buildPreviewUserPrompt(request, {
      layoutSequence,
      templateMode,
      templateLabel,
      narrativeAngleLabel,
      narrativeAnglePrompt,
    }),
    "",
    request.language === "zh-CN" ? `Preset label: ${style.name}` : `Preset label: ${style.name}`,
    `Style intent: ${style.summary}`,
    `Style writing direction: ${style.stylePrompt}`,
    `Strengths: ${style.strengths.join(", ")}`,
    research.keyFacts.length || research.numericEvidence.length || research.risks.length || research.implications.length
      ? request.language === "zh-CN"
        ? `研究结构映射：keyFacts=${research.keyFacts.length}，numericEvidence=${research.numericEvidence.length}，risks=${research.risks.length}，implications=${research.implications.length}。优先把 keyFacts 落到 agenda/evidence，numericEvidence 落到 stats/chart，risks 落到 comparison/chart，implications 落到 process/timeline。`
        : `Research mapping: keyFacts=${research.keyFacts.length}, numericEvidence=${research.numericEvidence.length}, risks=${research.risks.length}, implications=${research.implications.length}. Prefer keyFacts for agenda/evidence, numericEvidence for stats/chart, risks for comparison/chart, and implications for process/timeline.`
      : null,
    request.language === "zh-CN" ? `该模板的原生页型顺序: ${intentSequence}` : `Native page-intent sequence: ${intentSequence}`,
    request.language === "zh-CN" ? `模板能力注册表:\n${capabilityLabel}` : `Template capability registry:\n${capabilityLabel}`,
    templateReference
      ? request.language === "zh-CN"
        ? "不要根据本地 style registry 重新发明模板布局、配色或字体；如果官方 spec 与其他提示冲突，以官方 spec_lock.md 为准。"
        : "Do not invent layout, palette, or typography from the local style registry. If any instruction conflicts with the official spec, spec_lock.md wins."
      : request.language === "zh-CN"
        ? `slides 数组里的每个对象都必须同时包含 layout 和 intent 字段。本模板 intent 顺序固定为: ${rawIntentSequence}。`
        : `Every slide object must include both layout and intent. For this preset the intent sequence must be: ${rawIntentSequence}.`,
    "",
    request.language === "zh-CN"
      ? [
          "直接以该风格写完整的九页结构，不要先写通用版。",
          `这次只需要输出 ${pageCount} 页，对应 layout 顺序固定为 ${layoutSequence.join(", ")}。`,
          "这一路必须有独立的叙事角度、章节命名和判断，不要和其他风格只做同义改写。",
          templateReference ? "" : "Long Table 要像长桌纪要和董事会讨论；Playful 要像轻快发布和友好品牌表达；Broadside 要像海报宣言和印刷告示；Neo-Grid Bold 要像现代策略界面和粗体网格评审。",
          "虽然 slides 的字段顺序固定，但内容必须按该模板的原生页型去写，不要把九页都写成普通文字页。",
          `layout 顺序固定为 ${layoutSequence.join(", ")}。`,
          "agenda 页优先产出 contentsItems；comparison 页优先产出 comparisonItems；evidence 页优先产出 spotlightItems；stats 页优先产出 metricItems；chart 页优先产出 chartItems；process 页优先产出 processItems；timeline 页优先产出 closingItems，不要只给 bullets。",
          research.keyFacts.length > 0 ? "researchBrief 里的 keyFacts 不能只塞进封面，至少要分布到 agenda、insight、evidence 三类页面。" : "",
          research.numericEvidence.length > 0 ? "researchBrief 里的 numericEvidence 必须优先进入 stats 或 chart 页，至少有一页出现明确数字信号。" : "",
          research.risks.length > 0 ? "researchBrief 里的 risks 必须显式进入 comparison 或 chart 页，不要丢失风险外溢链。" : "",
          research.implications.length > 0 ? "researchBrief 里的 implications 必须进入 process 或 timeline 页，转成行动顺序、响应动作或 watchpoints。" : "",
          "agenda 页的五个章节名必须体现该风格自己的信息组织方式，不要复用通用目录词。",
          "cover 页标题可以重写，但必须明确包含主题对象，不要简单等于原始 prompt。",
          templateMode === "single-template" && narrativeAnglePrompt ? `当前候选的叙事角要求：${narrativeAnglePrompt}` : "",
          densityHint,
        ].join("\n")
      : [
          `Write the ${pageCount}-slide structure directly in this style rather than drafting a neutral base plan.`,
          "This lane must introduce its own narrative angle, chapter naming, and judgment instead of producing a synonym pass of the other styles.",
          templateReference ? "" : "Long Table should feel like a chaired long-table memo; Playful should feel like a bright launch narrative; Broadside should read like a printed declaration; Neo-Grid Bold should feel like a modern strategy interface review.",
          "Even though the field order is fixed, write each slot according to this preset's native page intent rather than treating all nine as generic text slides.",
          `The fixed layout order is: ${layoutSequence.join(", ")}.`,
          "Prefer returning contentsItems on agenda slides, comparisonItems on comparison slides, spotlightItems on evidence slides, metricItems on stats slides, chartItems on chart slides, processItems on process slides, and closingItems on closing slides rather than relying on bullets alone.",
          research.keyFacts.length > 0 ? "Spread the researchBrief keyFacts across agenda, insight, and evidence rather than hiding them in the cover only." : "",
          research.numericEvidence.length > 0 ? "Place numericEvidence into stats or chart slides so at least one slide carries explicit numerical proof." : "",
          research.risks.length > 0 ? "Translate researchBrief risks into comparison or chart logic instead of dropping the risk chain." : "",
          research.implications.length > 0 ? "Translate researchBrief implications into process or closing actions/watchpoints." : "",
          "The agenda slide must use chapter names that reflect this style's own information architecture rather than a generic shared outline.",
          "The cover title may be rewritten, but it must still explicitly name the topic rather than merely echoing the raw prompt.",
          "The last slide should usually function as a closing page with actions, watchpoints, or a final verdict rather than a literal timeline.",
          "Keep titles short and oversized. At least one slide should feel naturally chartable or card-based instead of paragraph-heavy.",
          templateMode === "single-template" && narrativeAnglePrompt ? narrativeAnglePrompt : "",
          densityHint,
        ].join("\n"),
  ].join("\n")
}

function buildRuntimeSlideSystemPrompt(language: PptPreviewRequest["language"]) {
  if (language === "zh-CN") {
    return [
      "你是 ppt-master agent runtime 里的 Executor。",
      "任务是为单页演示文稿直接手写一个可导出的 SVG 页面。",
      "必须只返回一个完整 SVG 文档，不要 markdown、不要解释、不要代码块、不要 XML 声明。",
      "如果当前项目已导入官方模板参考，请沿用其版式骨架、视觉 DNA 和素材语义，但必须根据当前页面内容重写，不能照搬示例文案。",
      "画布固定为 1280x720，必须包含 viewBox=\"0 0 1280 720\"。",
      "必须使用内联属性，不要使用 <style>、class、mask、foreignObject、textPath、symbol、script、animate、iframe，也不要使用 <g opacity>。",
      "优先用 rect、line、circle、path、text 这些基础图元完成构图，减少无意义节点和重复装饰。",
      "所有文字和结构必须与当前页面内容匹配，不能残留示例文案、占位词或通用模板标题。",
      "输出中必须包含顶层语义分组，例如 background、chrome、content、annotations。",
      "同一风格下要保持一致的视觉语法，但每一页都应重新构图，不要复刻上一页壳子。",
      "保持当前模板骨架、页面节奏和视觉语言。输出前检查所有可见文字和图形都位于 1280x720 画布及所属容器内；如果内容放不下，只在当前模块内换行、缩短正文或调整局部几何，不要改变整体构图、删除主内容、缩小标题或把元素推到画布外。",
    ].join(" ")
  }

  return [
    "You are the Executor inside a ppt-master agent runtime.",
    "Generate one standalone SVG slide that is ready for downstream finalize/export.",
    "Return one complete SVG document only. No markdown, no explanation, no code fences, no XML declaration.",
    "When an official template reference is provided, follow its layout skeleton, visual DNA, and asset semantics while rewriting the slide for the current page content.",
    "The canvas is fixed at 1280x720 and must include viewBox=\"0 0 1280 720\".",
    "Use inline SVG attributes only. Do not use <style>, class, mask, foreignObject, textPath, symbol, script, animate, iframe, or <g opacity>.",
    "Prefer rect, line, circle, path, and text primitives instead of bloated or repetitive node trees.",
    "All text and structure must match the current slide content. Never leave sample copy, placeholders, or generic template labels in the output.",
    "Include semantic top-level groups such as background, chrome, content, and annotations.",
    "Keep the visual language consistent within the variant while still recomposing each page rather than duplicating one shell.",
    "Preserve the current template skeleton, page rhythm, and visual language. Before returning, check that all visible text and shapes stay within the 1280x720 canvas and their owning containers; if content does not fit, reflow text or adjust only local geometry instead of changing the composition, deleting primary content, shrinking titles, or pushing elements outside the canvas.",
  ].join(" ")
}

function buildRuntimeSlideUserPrompt(context: PptMasterPreviewRuntimeSlideContext) {
  const textLimits = getLayoutTextLimits(context.slide.layout, context.deck.language)
  const isSingleFocusLayout = context.slide.layout === "insight" || context.slide.layout === "timeline"
  const previousSlides = context.previousSlides.slice(isSingleFocusLayout ? -1 : -2)
  const previousSummary =
    previousSlides.length > 0
      ? previousSlides
          .map(
            (slide, index) =>
              `${index + 1}. [${slide.layout}] ${slide.title} | bullets=${slide.bullets.slice(0, 2).join(" / ")}`,
          )
          .join("\n")
      : context.deck.language === "zh-CN"
        ? "无前序页面。"
        : "No previous slides yet."
  const structuredSections = [
    context.slide.contentsItems?.length
      ? `Contents items: ${context.slide.contentsItems.map((item) => `${item.index} ${item.title}: ${item.detail}`).join(" | ")}`
      : "",
    context.slide.comparisonItems?.length
      ? `Comparison items: ${context.slide.comparisonItems.map((item) => `${item.label} ${item.title}: ${item.detail}`).join(" | ")}`
      : "",
    context.slide.spotlightItems?.length
      ? `Spotlight items: ${context.slide.spotlightItems.map((item) => `${item.title}: ${item.detail}`).join(" | ")}`
      : "",
    context.slide.metricItems?.length
      ? `Metric items: ${context.slide.metricItems.map((item) => `${item.value} ${item.label}${item.note ? ` (${item.note})` : ""}`).join(" | ")}`
      : "",
    context.slide.chartItems?.length
      ? `Chart items: ${context.slide.chartItems.map((item) => `${item.label}=${item.value}: ${item.detail}`).join(" | ")}`
      : "",
    context.slide.processItems?.length
      ? `Process items: ${context.slide.processItems.map((item) => `${item.step} ${item.title}: ${item.detail}`).join(" | ")}`
      : "",
    context.slide.closingItems?.length
      ? `Closing items: ${context.slide.closingItems.map((item) => `${item.label}: ${item.detail}`).join(" | ")}`
      : "",
  ].filter(Boolean)

  const layoutGuidance =
    context.deck.language === "zh-CN"
      ? {
          cover: "封面页。做强标题、主题氛围和 1 个视觉主轴，不要堆积太多卡片。",
          agenda: "目录/议程页。把 4-5 个章节或推进段落组织得清楚，允许编号、路径和结构线。",
          insight: "洞察页。做出明显的主判断区，允许一个大数字、强结论、引语或单一视觉焦点。",
          comparison: "比较页。至少形成两组对照关系，可以是双栏、矩阵或对比带，但不要空洞模板。",
          evidence: "证据页。放最可引用的事实、判断和证明材料，不要和 comparison 重复。",
          stats: "数据页。集中展示 3-4 个最关键的数字和压力指标。",
          chart: "图示页。把传播链、因果链或扩散路径压成一眼能懂的结构。",
          process: "流程页。给出明确步骤、阶段推进或执行顺序。",
          timeline: "时间线页。给出清晰推进顺序和关键节点，节奏要一眼能读懂。",
        }
      : {
          cover: "Cover slide. Build a strong title, atmosphere, and one primary visual axis. Avoid overloading it with cards.",
          agenda: "Agenda slide. Organize 4-5 chapters or phases clearly. Numbering, paths, and structure lines are welcome.",
          insight: "Insight slide. Create one dominant judgment zone with a large number, a strong claim, a quote, or a single focal visual.",
          comparison: "Comparison slide. Form at least two contrasted groups using columns, matrix logic, or comparative bands without falling into empty template structure.",
          evidence: "Evidence slide. Use quotable proof, anchors, and supporting facts without duplicating the comparison slide.",
          stats: "Stats slide. Concentrate 3-4 key numbers and pressure signals.",
          chart: "Chart slide. Compress the chain into a diagram-first or chart-first logic.",
          process: "Process slide. Show the response sequence, phases, or executable order clearly.",
          timeline: "Timeline slide. Make sequence and key milestones legible at a glance.",
        }

  const shouldIncludeDeckOutline =
    context.slide.layout === "agenda" || context.slide.layout === "timeline" || context.slideIndex === 0
  const pageFocusInstruction =
    context.deck.language === "zh-CN"
      ? {
          cover: "封面只保留一个主标题轴，不要把所有卖点都塞进首屏。",
          agenda: "目录页要把章节关系排清楚，但不要重复写成长段解释。",
          insight: "这页只保留一个主判断区和最多三个辅助 bullet，不要额外扩展说明。",
          comparison: "对照页要先拉开两组关系，再放少量解释，不要把正文写成段落墙。",
          evidence: "证据页优先锚点和证明材料，不要再铺一整页背景介绍。",
          stats: "数据页只保留最关键的 3-4 个信号，避免堆满次要说明。",
          chart: "图示页优先结构关系，正文说明从简。",
          process: "流程页突出步骤推进，不要把每一步写成长段。",
          timeline: "收束页只保留行动顺序和最终落点，不要回顾整份 deck。",
        }[context.slide.layout]
      : {
          cover: "Keep one primary title axis on the cover instead of stacking every selling point.",
          agenda: "Clarify the chapter structure without repeating long explanatory paragraphs.",
          insight: "Keep one dominant claim area with no more than three supporting bullets.",
          comparison: "Open with contrast first, then use minimal explanation instead of dense body copy.",
          evidence: "Prioritize anchors and proof instead of reintroducing full background context.",
          stats: "Keep only the 3-4 signals that matter most and avoid secondary clutter.",
          chart: "Prioritize the structural diagram and keep explanatory copy compact.",
          process: "Emphasize sequence and keep step descriptions short.",
          timeline: "Use the closing slide for action order and landing point, not a full deck recap.",
        }[context.slide.layout]

  return [
    `Deck title: ${context.deck.title}`,
    `Scenario: ${context.deck.scenario}`,
    `Language: ${context.deck.language}`,
    `Variant style: ${context.variant.name}`,
    `Variant summary: ${context.variant.summary}`,
    `Variant writing direction: ${context.variant.stylePrompt}`,
    `Palette background: ${context.variant.palette.background}`,
    `Palette foreground: ${context.variant.palette.foreground}`,
    `Palette accent: ${context.variant.palette.accent}`,
    `Palette panel: ${context.variant.palette.panel}`,
    `Palette border: ${context.variant.palette.border}`,
    ...(context.templateReference
      ? [
          "",
          `Official template id: ${context.templateReference.templateId}`,
          `Official template kind: ${context.templateReference.kind}`,
          `Official template source: ${context.templateReference.sourcePathLabel}`,
          context.templateReference.designSpecTitle
            ? `Template design spec title: ${context.templateReference.designSpecTitle}`
            : "",
          context.templateReference.designSpecExcerpt
            ? `Template design spec excerpt:\n${context.templateReference.designSpecExcerpt}`
            : "",
          context.templateReference.specLockContent
            ? `Official ppt-master spec_lock.md (authoritative visual contract):\n${context.templateReference.specLockContent}`
            : "",
          context.templateReference.referenceSvgFiles.length
            ? `Template reference SVGs: ${context.templateReference.referenceSvgFiles.slice(0, 12).join(" | ")}`
            : "",
          context.templateReference.imageFiles.length
            ? `Imported bitmap assets: ${context.templateReference.imageFiles.slice(0, 12).join(" | ")}`
            : "",
        ].filter(Boolean)
      : []),
    "",
    `Current page: ${context.slideIndex + 1} / ${context.variant.slides.length}`,
    `Layout type: ${context.slide.layout}`,
    `Layout guidance: ${layoutGuidance[context.slide.layout]}`,
    `Copy limits: title <= ${textLimits.title}, body <= ${textLimits.body}, bullet <= ${textLimits.bullet}`,
    `Page focus: ${pageFocusInstruction}`,
    `Native page type: ${context.slide.nativePageType ?? "n/a"}`,
    `Kicker: ${context.slide.kicker}`,
    `Title: ${context.slide.title}`,
    `Body: ${context.slide.body}`,
    `Bullets: ${context.slide.bullets.join(" | ")}`,
    ...structuredSections,
    ...(shouldIncludeDeckOutline ? ["", "Deck outline:", ...context.deck.outline.map((item, index) => `${index + 1}. ${item}`)] : []),
    "",
    "Recent previous slides in this variant:",
    previousSummary,
    "",
    context.deck.language === "zh-CN"
      ? "请直接输出当前页 SVG。优先保证强构图、清晰层级和可导出性；不要输出解释，不要引用 design_spec 路径，不要写模板示例词。"
      : "Output the SVG for this page directly. Prioritize composition strength, visual hierarchy, and exportability. Do not explain, cite file paths, or leave template sample text.",
  ].join("\n")
}

async function generateRuntimeSlideSvg(context: PptMasterPreviewRuntimeSlideContext): Promise<PptMasterPreviewRuntimeSlideResult> {
  const { requestedModel, preferredProviderId } = resolveRuntimeSlideExecutionConfig(context.deck)
  const slideTimeoutMs = resolvePptMasterSlideTimeoutMs({
    provider: preferredProviderId,
    model: requestedModel,
  })
  let providerResult: Awaited<ReturnType<typeof generateTextWithLeadToolPreviewProvider>>

  try {
    providerResult = await Promise.race([
      generateTextWithLeadToolPreviewProvider({
        systemPrompt: buildRuntimeSlideSystemPrompt(context.deck.language),
        userPrompt: buildRuntimeSlideUserPrompt(context),
        model: requestedModel,
        preferredProviderId,
        providerTimeoutMs: slideTimeoutMs,
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("ppt_master_runtime_slide_timeout")), slideTimeoutMs),
      ),
    ])
  } catch (error) {
    if (error instanceof Error && error.message === "ppt_master_runtime_slide_timeout") {
      throw error
    }

    throw new Error(
      normalizePptMasterRuntimeProviderError(
        error,
        preferredProviderId ?? "auto",
        requestedModel,
      ),
    )
  }

  return {
    provider: providerResult.providerId,
    model: providerResult.model,
    svg: providerResult.text,
  }
}

async function generateVariantPlan(
  request: PptPreviewRequest,
  descriptor: PptPreviewVariantDescriptor,
  templateReference?: ImportedPptMasterTemplateReference,
) {
  const { style } = descriptor
  const requestedModel = resolveRequestedPreviewModel(request)
  const pageCount = resolvePptPreviewPageCount(request.pageCount)
  const layoutSequence = getPptPreviewLayoutSequence(pageCount)
  const templateMode = resolvePptPreviewTemplateMode(request)
  const templateLabel = getPptPreviewTemplateLabel(descriptor.templateId, request.language)
  const narrativeAngleLabel = descriptor.narrativeAngle
    ? getPptPreviewNarrativeAngleLabel(descriptor.narrativeAngle, request.language)
    : undefined
  const narrativeAnglePrompt = descriptor.narrativeAngle
    ? getPptPreviewNarrativeAnglePrompt(descriptor.narrativeAngle, request.language)
    : undefined
  let lastError: unknown = null
  const systemPrompt = [
    buildPreviewSystemPrompt(request, {
      layoutSequence,
      templateMode,
      templateLabel,
      narrativeAngleLabel,
      narrativeAnglePrompt,
    }),
    request.language === "zh-CN"
      ? `风格要求：${style.stylePrompt} 直接按这种风格生成 ${pageCount} 页内容，不要先写一个通用版本再改写。每个 slide 对象必须输出 layout 与 intent。`
      : `Style requirement: ${style.stylePrompt} Generate the ${pageCount}-slide plan directly in this style rather than drafting a neutral version first. Each slide object must output both layout and intent.`,
  ]
  const preferredProviderId = resolveLeadToolPreviewProviderPreference(
    requestedModel,
    request.preferredProviderId ?? getLeadToolPptPreviewProvider(),
  )
  const buildAttemptSystemPrompt = (retryGuardrail: string) =>
    [
      ...systemPrompt,
      retryGuardrail,
      request.language === "zh-CN"
        ? "只输出一个 JSON 对象，不要 markdown，不要解释。"
        : "Return only one JSON object with no markdown and no explanation.",
    ]
      .filter(Boolean)
      .join(" ")

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const retryGuardrail =
        attempt === 1
          ? ""
          : request.language === "zh-CN"
            ? "上一次结果被判定为低信息内容。重写所有标题、章节、图表项和步骤项，禁止沿用原始 prompt 加编号，禁止 Step 1/Section 2/Signal 3 这类空壳标签。"
            : "The previous result was rejected for low-information content. Rewrite all titles, sections, chart items, and process items with real business-specific language. Do not reuse numbered clones of the prompt or hollow labels like Step 1 / Section 2 / Signal 3."

      const providerResult = await generateTextWithLeadToolPreviewProvider({
        systemPrompt: buildAttemptSystemPrompt(retryGuardrail),
        userPrompt: buildStyleAwarePrompt(request, descriptor, templateReference),
        model: requestedModel,
        preferredProviderId,
      })
      let rawPlan: unknown
      try {
        rawPlan = JSON.parse(extractJsonObjectBlock(providerResult.text))
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "ppt_preview_json_missing" &&
          preferredProviderId === "writer"
        ) {
          const structuredResult = await generateStructuredPptPlanWithWriter({
            systemPrompt: buildAttemptSystemPrompt(retryGuardrail),
            userPrompt: buildStyleAwarePrompt(request, descriptor, templateReference),
            model: requestedModel,
            preferredProviderId: request.preferredProviderId as LeadToolPreviewProviderId | null | undefined,
          })
          rawPlan = structuredResult.rawPlan
        } else {
          throw error
        }
      }
      const normalizedPlan = normalizeLeadToolPptPlan(sanitizeRawPlan(rawPlan, request, style), request, style)

      if (isLowInformationPptPlan(normalizedPlan, request)) {
        throw new Error(`ppt_preview_low_information:${providerResult.providerId}:${providerResult.model}:attempt_${attempt}`)
      }

      return {
        variantKey: descriptor.key,
        styleKey: style.key,
        templateId: descriptor.templateId,
        narrativeAngle: descriptor.narrativeAngle,
        title: normalizedPlan.title,
        outline: normalizedPlan.outline,
        provider: providerResult.providerId,
        previewModel: providerResult.model,
        slides: normalizedPlan.slides.map((slide) => ({
          ...slide,
          intent: resolvePptPreviewSlideIntent(style.key, slide.layout),
        })),
      }
    } catch (error) {
      lastError = error
      if (attempt >= 3) {
        break
      }
      await sleep(500 * attempt)
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ppt_preview_generation_failed")
}

export async function generateLeadToolPptPreview(request: PptPreviewRequest): Promise<PptPreviewDeck> {
  const storyDeck = await generateLeadToolPptStoryDeck(request)
  return materializeLeadToolPptDeckWithPptMasterRuntime(storyDeck)
}

export async function generateLeadToolPptStoryDeck(request: PptPreviewRequest): Promise<PptPreviewDeck> {
  const resolvedPageCount = await resolveLeadToolPptPageCount(request)
  const resolvedRequest = {
    ...request,
    pageCount: resolvedPageCount,
  }
  const baseVariantDescriptors = buildPptPreviewVariantDescriptors(request)
  const templateReference =
    request.previewRuntime === "ppt-master-agent" && resolvePptPreviewTemplateMode(request) === "single-template" && request.templateId
      ? await loadPptMasterTemplateReference(request.templateId)
      : undefined
  const variantDescriptors = templateReference
    ? baseVariantDescriptors.map((descriptor) => ({
        ...descriptor,
        style: buildPptMasterVariantStyle(descriptor, templateReference),
      }))
    : baseVariantDescriptors
  const plans = await Promise.all(
    variantDescriptors.map((descriptor) => generateVariantPlan(resolvedRequest, descriptor, templateReference)),
  )
  return {
    ...buildPptPreviewDeckFromPlans(resolvedRequest, plans, {
      resolvedPageCount,
      variantDescriptors,
    }),
    provider: plans[0]?.provider ?? "unknown",
    previewModel: plans[0]?.previewModel ?? resolveRequestedPreviewModel(resolvedRequest),
    preferredProviderId: resolvedRequest.preferredProviderId ?? null,
  }
}

export async function materializeLeadToolPptDeckWithPptMasterRuntime(deck: PptPreviewDeck): Promise<PptPreviewDeck> {
  return materializePptMasterPreviewDeck(
    deck,
    {
      generateSlideSvg: generateRuntimeSlideSvg,
    },
  )
}

export async function generateLeadToolPptPreviewWithFallback(
  request: PptPreviewRequest,
  allowMockFallback: boolean,
): Promise<PptPreviewDeck> {
  const allowCustomMockFallback = allowMockFallback && request.previewRuntime !== "ppt-master-agent"
  if (
    !hasLeadToolMinimaxProvider() &&
    !hasLeadToolStepfunProvider() &&
    !hasLeadToolGlmProvider() &&
    !hasLeadToolPptokenProvider() &&
    !hasAibermApiKey() &&
    !hasCrazyrouteApiKey()
  ) {
    if (allowCustomMockFallback) {
      return renderPptPreviewDeckAssets(buildMockPptPreview(request))
    }

    throw new Error("lead_tool_provider_missing")
  }

  try {
    return await generateLeadToolPptPreview(request)
  } catch (error) {
    if (allowCustomMockFallback) {
      console.warn("lead-tools.ppt.preview.fallback", {
        message: error instanceof Error ? error.message : String(error),
      })
      return renderPptPreviewDeckAssets(buildMockPptPreview(request))
    }

    throw error
  }
}

export function setLeadToolPptGenerationDepsForTests(
  deps:
    | {
        generateTextWithWriterModel?: typeof generateTextWithWriterModel
        generateStructuredObjectWithWriterModel?: typeof generateStructuredObjectWithWriterModel
      }
    | null,
) {
  generateTextWithWriterModelImpl = deps?.generateTextWithWriterModel ?? generateTextWithWriterModel
  generateStructuredObjectWithWriterModelImpl =
    deps?.generateStructuredObjectWithWriterModel ?? generateStructuredObjectWithWriterModel
}

export const __testables__ = {
  buildRuntimeSlideSystemPrompt,
}
