import fs from "node:fs/promises"
import path from "node:path"

import { buildStyleAwarePrompt, normalizeLeadToolPptPlan } from "@/lib/lead-tools/generation-ppt-fixed"
import {
  buildPptPreviewDeckFromPlans,
  getPptPreviewLayoutSequence,
  getPptPreviewTemplateCapability,
  getPptPreviewTemplateLabel,
  getPptPreviewStyleSlots,
  type PptFrontendTemplateId,
  type PptPreviewModelValue,
  resolvePptPreviewSlideIntent,
  type PptPreviewRequest,
  type PptPreviewVariantDescriptor,
  type PptPreviewStyleKey,
  type PptPreviewVariantStyle,
  pptPreviewStyles,
} from "@/lib/lead-tools/ppt-preview-data-fixed"
import { buildPreviewSystemPrompt } from "@/lib/lead-tools/ppt-preview-copy"

type BenchmarkUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

type VariantTiming = {
  styleKey: PptPreviewStyleKey
  styleName: string
  durationMs: number
  usage: BenchmarkUsage
}

type JobTiming = {
  jobIndex: number
  title: string
  durationMs: number
  variantTimings: VariantTiming[]
  deckPath: string
}

function normalizeText(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : ""
}

function toPreviewRequestModel(raw: string): PptPreviewModelValue | undefined {
  if (raw === "MiniMax-M2.7-highspeed" || raw === "MiniMax-M3" || raw === "gpt-6.1-sol" || raw === "step-3.7-flash") {
    return raw
  }

  return undefined
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

  candidates.push(cleanedText)

  for (const candidate of candidates) {
    const firstBrace = candidate.indexOf("{")
    const lastBrace = candidate.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return candidate.slice(firstBrace, lastBrace + 1)
    }
  }

  throw new Error("stepfun_ppt_json_not_found")
}

function readUsage(rawUsage: unknown): BenchmarkUsage {
  if (!rawUsage || typeof rawUsage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  }

  const usage = rawUsage as Record<string, unknown>
  const inputTokens =
    Number(usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0) || null
  const outputTokens =
    Number(usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0) || null
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? 0) || null

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
  }
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

function sanitizeRawPlan(rawPlan: unknown, request: PptPreviewRequest, style: PptPreviewVariantStyle) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return rawPlan
  }

  const plan = rawPlan as Record<string, unknown>
  const rawSlides = Array.isArray(plan.slides) ? plan.slides : []
  const outline = Array.isArray(plan.outline) ? plan.outline.map((item) => normalizeText(item)).filter(Boolean) : []
  const effectiveSlides =
    rawSlides.length > 0
      ? rawSlides
      : getPptPreviewStyleSlots(style.key).map((slot, index) => ({
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

function buildVariantSystemPrompt(request: PptPreviewRequest, style: PptPreviewVariantStyle) {
  const templateId = getPptPreviewTemplateCapability(style.key).templateId as PptFrontendTemplateId
  return [
    buildPreviewSystemPrompt(request, {
      layoutSequence: getPptPreviewLayoutSequence(request.pageCount),
      templateMode: "auto-4",
      templateLabel: getPptPreviewTemplateLabel(templateId, request.language),
    }),
    request.language === "zh-CN"
      ? `风格要求：${style.stylePrompt} 直接按这种风格生成 9 页内容，不要先写一个通用版本再改写。每个 slide 对象必须输出 layout 与 intent。`
      : `Style requirement: ${style.stylePrompt} Generate the nine-slide plan directly in this style rather than drafting a neutral version first. Each slide object must output both layout and intent.`,
    request.language === "zh-CN"
      ? "只输出一个 JSON 对象，不要 markdown，不要解释。"
      : "Return only one JSON object with no markdown and no explanation.",
  ].join(" ")
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateVariantPlan(params: {
  apiKey: string
  baseURL: string
  model: string
  request: PptPreviewRequest
  style: PptPreviewVariantStyle
}) {
  const descriptor: PptPreviewVariantDescriptor = {
    key: params.style.key,
    slotLabel: "A",
    style: params.style,
    templateId: getPptPreviewTemplateCapability(params.style.key).templateId as PptFrontendTemplateId,
  }
  const startedAt = Date.now()
  let payload:
    | {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: unknown
        error?: { message?: unknown }
      }
    | null = null

  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${params.baseURL.replace(/\/+$/u, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            {
              role: "system",
              content: buildVariantSystemPrompt(params.request, params.style),
            },
            {
              role: "user",
              content: buildStyleAwarePrompt(params.request, descriptor),
            },
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
            usage?: unknown
            error?: { message?: unknown }
          }
        | null

      if (!response.ok) {
        const errorMessage = normalizeText(payload?.error?.message) || `stepfun_http_${response.status}`
        throw new Error(`stepfun_ppt_http_failed:${params.style.key}:${errorMessage}`)
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

  if (!payload) {
    throw new Error(
      `stepfun_ppt_empty_payload:${params.style.key}:${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }

  const durationMs = Date.now() - startedAt
  const rawText = normalizeText(payload?.choices?.[0]?.message?.content)
  if (!rawText) {
    throw new Error(`stepfun_ppt_empty_response:${params.style.key}`)
  }
  let rawPlan: unknown

  try {
    rawPlan = JSON.parse(extractJsonObjectBlock(rawText))
  } catch (error) {
    const preview = rawText.slice(0, 1200)
    throw new Error(
      `stepfun_ppt_json_parse_failed:${params.style.key}:${error instanceof Error ? error.message : String(error)}:${preview}`,
    )
  }

  const normalizedPlan = normalizeLeadToolPptPlan(
    sanitizeRawPlan(rawPlan, params.request, params.style),
    params.request,
    params.style,
  )

  return {
    plan: {
      variantKey: params.style.key,
      styleKey: params.style.key,
      templateId: getPptPreviewTemplateCapability(params.style.key).templateId as PptFrontendTemplateId,
      title: normalizedPlan.title,
      outline: normalizedPlan.outline,
      provider: "stepfun",
      slides: normalizedPlan.slides.map((slide) => ({
        ...slide,
        intent: resolvePptPreviewSlideIntent(params.style.key, slide.layout),
      })),
    },
    timing: {
      styleKey: params.style.key,
      styleName: params.style.name,
      durationMs,
      usage: readUsage(payload?.usage),
    } satisfies VariantTiming,
  }
}

async function main() {
  const apiKey = normalizeText(process.env.STEPFUN_API_KEY)
  const baseURL = normalizeText(process.env.STEPFUN_BASE_URL) || "https://api.stepfun.com/v1"
  const model = normalizeText(process.env.STEPFUN_MODEL) || "step-3.7-flash"
  const prompt = normalizeText(process.env.STEPFUN_PPT_PROMPT) || "霍尔木兹海峡现状"
  const concurrency = Number.parseInt(process.env.STEPFUN_PPT_CONCURRENCY || "4", 10) || 4
  const styleConcurrency = pptPreviewStyles.length
  const scenario = "training" as const
  const language = "zh-CN" as const

  if (!apiKey) {
    throw new Error("STEPFUN_API_KEY is required")
  }

  const request: PptPreviewRequest = {
    prompt,
    scenario,
    language,
    model: toPreviewRequestModel(model),
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const outputDir = path.join(process.cwd(), "artifacts", "benchmarks", `stepfun-ppt-${runId}`)
  await fs.mkdir(outputDir, { recursive: true })

  const wallStartedAt = Date.now()
  const jobs = await Promise.all(
    Array.from({ length: concurrency }, async (_value, index) => {
      const jobStartedAt = Date.now()
      const variantResults = await Promise.all(
        pptPreviewStyles.map((style) =>
          generateVariantPlan({
            apiKey,
            baseURL,
            model,
            request,
            style,
          }),
        ),
      )

      const deck = buildPptPreviewDeckFromPlans(
        request,
        variantResults.map((item) => item.plan),
      )
      deck.provider = "stepfun"
      deck.previewModel = model

      const deckPath = path.join(outputDir, `deck-${index + 1}.json`)
      await fs.writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8")

      return {
        jobIndex: index + 1,
        title: deck.title,
        durationMs: Date.now() - jobStartedAt,
        variantTimings: variantResults.map((item) => item.timing),
        deckPath,
      } satisfies JobTiming
    }),
  )
  const wallDurationMs = Date.now() - wallStartedAt

  const summary = {
    provider: "stepfun",
    baseURL,
    model,
    prompt,
    scenario,
    language,
    concurrency,
    styleConcurrency,
    wallDurationMs,
    averageJobDurationMs: Math.round(jobs.reduce((sum, job) => sum + job.durationMs, 0) / jobs.length),
    outputDir,
    jobs,
  }

  const summaryPath = path.join(outputDir, "summary.json")
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8")

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
