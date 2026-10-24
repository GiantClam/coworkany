import { readFile } from "node:fs/promises"
import path from "node:path"

import type { EnterpriseKnowledgeContext } from "@/lib/knowledge/types"
import { generateTextWithWriterModel } from "@/lib/writer/aiberm"
import type { LeadHunterEvidenceItem } from "@/lib/lead-hunter/evidence-types"
import { getLeadHunterAgentName, type LeadHunterAdvisorType } from "@/lib/lead-hunter/types"
import {
  hasAnyWebSearchProviderConfig,
  hasSerperWebSearchConfig,
  hasTavilyWebSearchConfig,
  searchWithSerperWeb,
  searchWithTavilyWeb,
} from "@/lib/skills/tools/web-search"

const LEAD_HUNTER_SKILL_MODEL =
  process.env.LEAD_HUNTER_SKILL_MODEL ||
  process.env.WRITER_TEXT_MODEL ||
  process.env.WRITER_SKILL_MODEL ||
  "claude-sonnet-5.1"

const DEFAULT_MAX_SEARCH_QUERIES_COMPANY = 14
const DEFAULT_MAX_SEARCH_QUERIES_CONTACT = 12
const MAX_SEARCH_QUERY_LIMIT = 24
const SEARCH_QUERY_CONCURRENCY = 3
const SEARCH_EARLY_STOP_SIGNALS = 48
const SEARCH_RESULT_CACHE_TTL_MS = 120_000
const SERPER_RESULT_NUM = 8
const TAVILY_RESULT_NUM = 5
const DEFAULT_TAVILY_SUPPLEMENT_TRIGGER_SIGNALS = SEARCH_EARLY_STOP_SIGNALS
const DEFAULT_TAVILY_SUPPLEMENT_MAX_QUERIES = 8
const MAX_ENTERPRISE_KNOWLEDGE_QUERY_VARIANTS = 3
const MAX_EVIDENCE_ITEMS = 24
const MAX_ENTERPRISE_SNIPPETS = 8
const DEFAULT_PAGE_EXTRACTION_LIMIT = 8
const MAX_PAGE_EXTRACTION_LIMIT = 12
const PAGE_EXTRACTION_TIMEOUT_MS = 12_000
const PAGE_EXTRACTION_CONCURRENCY = 3
const MAX_SKILL_GUIDE_CHARS = 6_000
const DEFAULT_REPORT_PROMPT_EVIDENCE_LIMIT = 12
const DEFAULT_REPORT_ENTERPRISE_SNIPPET_LIMIT = 4
const DEFAULT_REPORT_MAX_TOKENS = 1600
const DEFAULT_REPORT_TIMEOUT_MS = 60_000
const DEFAULT_REPORT_PROVIDER_TIMEOUT_MS = 70_000
const DEFAULT_VBUY_FIT_LAYER_CHARS = 6_000
const MAX_VBUY_FIT_LAYER_CHARS = 14_000
const REPORT_TIMEOUT_MS = 120_000
const SKILL_GUIDE_PATH = path.join(process.cwd(), "content", "skills", "customer-intelligence-risk", "SKILL.md")

export type LeadHunterSkillEventPayload = {
  event: string
  conversation_id?: string
  answer?: string
  agent_name?: string
  metadata?: {
    agent_name?: string
  }
  data?: Record<string, unknown>
  error?: string
}

export type LeadHunterSkillRunResult = {
  answer: string
  evidence: LeadHunterEvidenceItem[]
  language: "zh" | "en"
  vbuyMode: boolean
}

export type LeadHunterSkillRunInput = {
  advisorType: LeadHunterAdvisorType
  query: string
  preferredLanguage?: "zh" | "en" | "auto" | null
  conversationId?: string | null
  enterpriseId?: number | null
  enterpriseCode?: string | null
  memoryContext?: string | null
  soulCard?: string | null
  signal?: AbortSignal
  onSseEvent?: (payload: LeadHunterSkillEventPayload) => void | Promise<void>
}

type SearchHit = {
  title: string
  url: string
  snippet: string
  provider: "serper" | "tavily"
}

type SearchCacheEntry = {
  expiresAt: number
  hits: SearchHit[]
}

const SEARCH_QUERY_CACHE = new Map<string, SearchCacheEntry>()
let SKILL_GUIDE_CACHE: string | null | undefined

async function loadLeadHunterEnterpriseKnowledgeContext(params: {
  enterpriseId: number
  query: string
  queryVariants?: string[]
  preferredScopes?: string[]
  platform: string
  mode: string
}) {
  const { loadEnterpriseKnowledgeContext } = await import("@/lib/knowledge/service")
  return loadEnterpriseKnowledgeContext(params)
}

function sanitizeAssistantContent(raw: string) {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function parseEnvInt(name: string, fallback: number, range: { min: number; max: number }) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(range.max, Math.max(range.min, parsed))
}

function resolveMaxSearchQueries(advisorType: LeadHunterAdvisorType) {
  const fallback =
    advisorType === "contact-mining" ? DEFAULT_MAX_SEARCH_QUERIES_CONTACT : DEFAULT_MAX_SEARCH_QUERIES_COMPANY
  return parseEnvInt("LEAD_HUNTER_MAX_SEARCH_QUERIES", fallback, { min: 1, max: MAX_SEARCH_QUERY_LIMIT })
}

function resolveSearchConcurrency(queryCount: number) {
  return Math.min(
    queryCount,
    parseEnvInt("LEAD_HUNTER_SEARCH_QUERY_CONCURRENCY", SEARCH_QUERY_CONCURRENCY, { min: 1, max: 6 }),
  )
}

function resolveSearchEarlyStopSignals() {
  return parseEnvInt("LEAD_HUNTER_SEARCH_EARLY_STOP_SIGNALS", SEARCH_EARLY_STOP_SIGNALS, { min: 4, max: 48 })
}

function resolveSearchCacheTtlMs() {
  return parseEnvInt("LEAD_HUNTER_SEARCH_CACHE_TTL_MS", SEARCH_RESULT_CACHE_TTL_MS, {
    min: 0,
    max: 10 * 60_000,
  })
}

function resolveSerperResultNum() {
  return parseEnvInt("LEAD_HUNTER_SERPER_RESULT_NUM", SERPER_RESULT_NUM, { min: 2, max: 10 })
}

function resolveTavilyResultNum() {
  return parseEnvInt("LEAD_HUNTER_TAVILY_RESULT_NUM", TAVILY_RESULT_NUM, { min: 2, max: 10 })
}

function resolveTavilySupplementTriggerSignals() {
  return parseEnvInt("LEAD_HUNTER_TAVILY_SUPPLEMENT_TRIGGER_SIGNALS", DEFAULT_TAVILY_SUPPLEMENT_TRIGGER_SIGNALS, {
    min: 4,
    max: 48,
  })
}

function resolveTavilySupplementMaxQueries() {
  return parseEnvInt("LEAD_HUNTER_TAVILY_SUPPLEMENT_MAX_QUERIES", DEFAULT_TAVILY_SUPPLEMENT_MAX_QUERIES, {
    min: 1,
    max: MAX_SEARCH_QUERY_LIMIT,
  })
}

function resolvePageExtractionLimit() {
  return parseEnvInt("LEAD_HUNTER_PAGE_EXTRACTION_LIMIT", DEFAULT_PAGE_EXTRACTION_LIMIT, {
    min: 0,
    max: MAX_PAGE_EXTRACTION_LIMIT,
  })
}

function resolveEnterpriseKnowledgeQueryVariantLimit() {
  return parseEnvInt("LEAD_HUNTER_ENTERPRISE_QUERY_VARIANTS", MAX_ENTERPRISE_KNOWLEDGE_QUERY_VARIANTS, {
    min: 1,
    max: 4,
  })
}

function resolveReportPromptEvidenceLimit() {
  return parseEnvInt("LEAD_HUNTER_REPORT_PROMPT_EVIDENCE_LIMIT", DEFAULT_REPORT_PROMPT_EVIDENCE_LIMIT, {
    min: 6,
    max: MAX_EVIDENCE_ITEMS,
  })
}

function resolveReportEnterpriseSnippetLimit() {
  return parseEnvInt("LEAD_HUNTER_REPORT_ENTERPRISE_SNIPPETS", DEFAULT_REPORT_ENTERPRISE_SNIPPET_LIMIT, {
    min: 2,
    max: MAX_ENTERPRISE_SNIPPETS,
  })
}

function resolveReportMaxTokens() {
  return parseEnvInt("LEAD_HUNTER_REPORT_MAX_TOKENS", DEFAULT_REPORT_MAX_TOKENS, {
    min: 800,
    max: 3200,
  })
}

function resolveReportTimeoutMs() {
  return parseEnvInt("LEAD_HUNTER_REPORT_TIMEOUT_MS", DEFAULT_REPORT_TIMEOUT_MS, {
    min: 30_000,
    max: REPORT_TIMEOUT_MS,
  })
}

function resolveReportProviderTimeoutMs() {
  return parseEnvInt("LEAD_HUNTER_REPORT_PROVIDER_TIMEOUT_MS", DEFAULT_REPORT_PROVIDER_TIMEOUT_MS, {
    min: 20_000,
    max: 120_000,
  })
}

function resolveVbuyFitLayerChars() {
  return parseEnvInt("LEAD_HUNTER_VBUY_FIT_LAYER_CHARS", DEFAULT_VBUY_FIT_LAYER_CHARS, {
    min: 0,
    max: MAX_VBUY_FIT_LAYER_CHARS,
  })
}

function normalizePreferredLanguage(value: LeadHunterSkillRunInput["preferredLanguage"]): "zh" | "en" | null {
  if (!value) return null
  if (value === "zh" || value === "en") return value
  return null
}

function resolveOutputLanguage(input: { preferredLanguage?: LeadHunterSkillRunInput["preferredLanguage"]; query: string }) {
  return normalizePreferredLanguage(input.preferredLanguage) || "zh"
}

function toSseWireChunk(payload: LeadHunterSkillEventPayload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function stripInlineUrlAndDomain(text: string) {
  return normalizeWhitespace(
    text
      .replace(/https?:\/\/[^\s,;]+/gi, " ")
      .replace(/\b(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;]*)?/gi, " ")
      .replace(/\s*[|\uFF5C]\s*/g, " "),
  )
}

function pickCompanyName(query: string) {
  const normalized = normalizeWhitespace(query)
  if (!normalized) return ""

  const explicit =
    normalized.match(/(?:company[_\s-]*name|company)\s*[:=]\s*([^;,\n]+)/i) ||
    normalized.match(/(?:\u516c\u53f8\u540d\u79f0|\u516c\u53f8)\s*[\u003a\uff1a=]\s*([^;,\n]+)/)
  if (explicit?.[1]) return stripInlineUrlAndDomain(explicit[1]).slice(0, 120)

  const stripped = stripInlineUrlAndDomain(normalized)
  if (stripped) {
    return stripped
      .split(/\s+/)
      .slice(0, 10)
      .join(" ")
      .slice(0, 120)
  }

  const inlineUrl = normalized.match(/https?:\/\/[^\s,;]+/i)?.[0] || ""
  if (inlineUrl) {
    try {
      const host = new URL(inlineUrl).hostname.replace(/^www\./i, "")
      const root = host.split(".").slice(0, -1).join(" ") || host
      return normalizeWhitespace(root).slice(0, 120)
    } catch {
      return normalized.slice(0, 120)
    }
  }

  return normalized.slice(0, 120)
}

function pickWebsiteUrl(query: string) {
  const normalized = normalizeWhitespace(query)
  const explicit =
    normalized.match(/(?:website|domain|url)\s*[:=]\s*([^;,\n]+)/i) ||
    normalized.match(/(?:\u5b98\u7f51|\u7f51\u7ad9|\u57df\u540d)\s*[\u003a\uff1a=]\s*([^;,\n]+)/)
  const candidate = (explicit?.[1] || "").trim()
  if (candidate) {
    if (/^https?:\/\//i.test(candidate)) return candidate
    return `https://${candidate}`
  }

  const inlineUrl = normalized.match(/https?:\/\/[^\s,;]+/i)?.[0] || ""
  if (inlineUrl) return inlineUrl.trim()

  const domainLike = normalized.match(/\b(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;]*)?/i)?.[0] || ""
  if (domainLike) {
    return /^https?:\/\//i.test(domainLike) ? domainLike : `https://${domainLike}`
  }

  return ""
}
function shouldEnableVbuyMode(query: string) {
  const text = query.toLowerCase()
  return (
    text.includes("vbuy") ||
    query.includes("\u5fae\u5e03") ||
    query.includes("\u6c5f\u82cf\u5fae\u5e03\u5b9e\u4e1a\u6709\u9650\u516c\u53f8") ||
    query.includes("Jiangsu Vbuy Textile Group") ||
    query.includes("our company knowledge base")
  )
}
function normalizeEnterpriseCode(value: string | null | undefined) {
  return (value || "").trim().toLowerCase()
}

function matchesVbuyEnterpriseById(enterpriseId: number | null | undefined) {
  if (typeof enterpriseId !== "number" || !Number.isFinite(enterpriseId) || enterpriseId <= 0) return false
  const expectedId = Number.parseInt(process.env.VBUY_ENTERPRISE_ID || "", 10)
  return Number.isFinite(expectedId) && expectedId > 0 ? enterpriseId === expectedId : false
}

function shouldEnableVbuyModeFromContext(input: {
  query: string
  enterpriseCode?: string | null
  enterpriseId?: number | null
}) {
  const enterpriseCode = normalizeEnterpriseCode(input.enterpriseCode)
  if (enterpriseCode === "vbuy" || enterpriseCode.includes("vbuy")) {
    return true
  }
  if (matchesVbuyEnterpriseById(input.enterpriseId)) {
    return true
  }
  return shouldEnableVbuyMode(input.query)
}

async function loadVbuyFitLayer() {
  const filePath = path.join(process.cwd(), "content", "skills", "customer-intelligence-risk", "references", "vbuy-fit-layer.md")
  try {
    const text = await readFile(filePath, "utf8")
    return text.slice(0, resolveVbuyFitLayerChars())
  } catch {
    return ""
  }
}

async function loadCustomerIntelligenceSkillGuide() {
  if (SKILL_GUIDE_CACHE !== undefined) {
    return SKILL_GUIDE_CACHE
  }

  try {
    const text = await readFile(SKILL_GUIDE_PATH, "utf8")
    const normalized = text.trim()
    SKILL_GUIDE_CACHE = normalized ? normalized.slice(0, MAX_SKILL_GUIDE_CHARS) : null
    return SKILL_GUIDE_CACHE
  } catch {
    SKILL_GUIDE_CACHE = null
    return null
  }
}

function dedupeHits(hits: SearchHit[]) {
  const seen = new Set<string>()
  const output: SearchHit[] = []
  for (const hit of hits) {
    const key = normalizeSourceUrlForDedupe(hit.url)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(hit)
  }
  return output
}

function normalizeWebsiteDomain(raw: string) {
  return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase()
}

function normalizeSourceUrlForDedupe(raw: string) {
  const value = (raw || "").trim()
  if (!value) return ""
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase()
      if (
        lower === "srsltid" ||
        lower === "gclid" ||
        lower === "fbclid" ||
        lower.startsWith("utm_") ||
        lower === "ref" ||
        lower === "source"
      ) {
        url.searchParams.delete(key)
      }
    }
    url.hash = ""
    return url.toString().toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
}

function extractPlainTextFromHtml(html: string) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  )
}

function extractTitleFromHtml(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1] ? normalizeWhitespace(decodeHtmlEntities(match[1])) : ""
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AIMarketingLeadHunter/1.0 (+https://aimarketing.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    })
    if (!response.ok) return null
    const contentType = (response.headers.get("content-type") || "").toLowerCase()
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null
    const text = await response.text()
    return { text, finalUrl: response.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function buildSearchQueries(input: { advisorType: LeadHunterAdvisorType; query: string; companyName: string; website: string }) {
  const root = input.companyName || input.query
  const websiteDomain = normalizeWebsiteDomain(input.website)
  const queries: string[] = []

  const push = (value: string) => {
    const trimmed = normalizeWhitespace(value)
    if (!trimmed) return
    if (queries.includes(trimmed)) return
    queries.push(trimmed)
  }

  // Company basics
  push(`${root} official website about founder headquarters`)
  push(`${root} linkedin company employees headquarters`)
  push(`${root} funding acquisition revenue expansion`)

  // Business and market
  push(`${root} products customers market positioning`)
  push(`${root} partnership collaboration launch`)
  push(`${root} ceo founder interview strategy`)
  push(`${root} target customer persona icp`)
  push(`${root} competitors alternatives`)

  // Product and pricing
  push(`${root} product price`)
  push(`${root} pricing product collection`)
  push(`${root} bundle discount promotion`)

  if (input.advisorType === "contact-mining") {
    push(`${root} linkedin leadership team`)
    push(`${root} contact email sales procurement`)
    push(`${root} founder ceo cmo`)
    push(`${root} sales manager procurement manager linkedin`)
  } else {
    push(`${root} customer reviews complaints lawsuit`)
    push(`${root} customer service complaints`)
    push(`${root} trustpilot reviews`)
    push(`${root} bbb complaints`)
    push(`${root} reddit complaints`)
    push(`${root} partnership distributor wholesale`)
    push(`${root} corporate orders wholesale`)
    push(`${root} asia expansion europe distributor`)
  }

  if (websiteDomain) {
    push(`site:${websiteDomain} about us`)
    push(`site:${websiteDomain} products`)
    push(`site:${websiteDomain} collections products price`)
    push(`site:${websiteDomain} bundle discount promotion`)
    push(`site:${websiteDomain} terms`)
    push(`site:${websiteDomain} return policy`)
    push(`site:${websiteDomain} shipping policy`)
    push(`site:${websiteDomain} refund policy`)
    push(`site:${websiteDomain} corporate order wholesale`)
  }

  return queries.slice(0, resolveMaxSearchQueries(input.advisorType))
}

function classifySourceType(url: string) {
  const normalized = url.toLowerCase()
  if (/linkedin\.com|wikipedia\.org|crunchbase\.com/.test(normalized)) return "directory"
  if (/trustpilot|reddit|bbb\.org/.test(normalized)) return "review_site"
  if (/gov|court|sec\.|regulator/.test(normalized)) return "regulatory"
  if (/news|press|media/.test(normalized)) return "media"
  return "web"
}

function toEvidenceItem(hit: SearchHit): LeadHunterEvidenceItem {
  const confidence: LeadHunterEvidenceItem["confidence"] =
    hit.provider === "tavily" || hit.snippet.length >= 220 ? "high" : hit.snippet ? "medium" : "low"
  return {
    claim: hit.snippet || `Signal from ${hit.title || hit.url}`,
    source_title: hit.title || hit.url,
    source_url: hit.url,
    source_type: classifySourceType(hit.url),
    source_provider: hit.provider,
    extracted_by: hit.provider === "tavily" ? "tavily" : "not_extracted",
    confidence,
  }
}

function toEvidenceSummary(evidence: LeadHunterEvidenceItem[], limit = MAX_EVIDENCE_ITEMS) {
  return evidence
    .slice(0, limit)
    .map((item, index) => {
      const claim = item.claim.slice(0, 240)
      return `${index + 1}. [${item.source_provider}/${item.confidence}] ${item.source_title} | ${item.source_url}\n   claim: ${claim}`
    })
    .join("\n")
}

function buildEnterpriseKnowledgeQueryVariants(query: string, companyName: string) {
  const variants = [query]
  if (companyName) {
    variants.push(`${companyName} company profile`)
    variants.push(`${companyName} customer profile`)
    variants.push(`${companyName} products and market positioning`)
  }
  return [...new Set(variants.map((item) => normalizeWhitespace(item)).filter(Boolean))].slice(
    0,
    resolveEnterpriseKnowledgeQueryVariantLimit(),
  )
}

function buildLeadHunterKnowledgeScopes(advisorType: LeadHunterAdvisorType) {
  if (advisorType === "contact-mining") {
    return ["general", "brand", "case-study"] as const
  }
  return ["general", "brand", "product", "case-study"] as const
}

function toEnterpriseKnowledgeEvidence(context: EnterpriseKnowledgeContext | null) {
  if (!context?.snippets?.length) return [] as LeadHunterEvidenceItem[]
  return context.snippets.slice(0, MAX_ENTERPRISE_SNIPPETS).map((snippet) => ({
    claim: snippet.content,
    source_title: `${snippet.datasetName} - ${snippet.title}`,
    source_url: `dify-dataset://${snippet.datasetId}`,
    source_type: "enterprise_kb",
    source_provider: "other" as const,
    extracted_by: "not_extracted" as const,
    confidence: "high" as const,
  }))
}

function buildEnterpriseKnowledgeSummary(context: EnterpriseKnowledgeContext | null, limit = MAX_ENTERPRISE_SNIPPETS) {
  if (!context?.snippets?.length) return ""
  return context.snippets
    .slice(0, limit)
    .map((snippet, index) => {
      const content = normalizeWhitespace(snippet.content).slice(0, 220)
      return `${index + 1}. [${snippet.datasetName} / ${snippet.scope}] ${snippet.title}\n   ${content}`
    })
    .join("\n")
}

function toPromptEvidenceMatrix(evidence: LeadHunterEvidenceItem[], limit: number) {
  return evidence.slice(0, limit).map((item) => ({
    claim: item.claim.slice(0, 220),
    source_title: item.source_title,
    source_url: item.source_url,
    source_type: item.source_type,
    confidence: item.confidence,
  }))
}

function makeSearchCacheKey(provider: SearchHit["provider"], query: string) {
  return `${provider}:${normalizeWhitespace(query).toLowerCase()}`
}

function getCachedSearchHits(provider: SearchHit["provider"], query: string) {
  const ttlMs = resolveSearchCacheTtlMs()
  if (ttlMs <= 0) return null
  const entry = SEARCH_QUERY_CACHE.get(makeSearchCacheKey(provider, query))
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    SEARCH_QUERY_CACHE.delete(makeSearchCacheKey(provider, query))
    return null
  }
  return [...entry.hits]
}

function setCachedSearchHits(provider: SearchHit["provider"], query: string, hits: SearchHit[]) {
  const ttlMs = resolveSearchCacheTtlMs()
  if (ttlMs <= 0 || hits.length === 0) return
  SEARCH_QUERY_CACHE.set(makeSearchCacheKey(provider, query), {
    hits: [...hits],
    expiresAt: Date.now() + ttlMs,
  })
}

async function runWebSearchForQuery(provider: SearchHit["provider"], query: string, signal?: AbortSignal) {
  if (provider === "serper" && !hasSerperWebSearchConfig()) {
    return []
  }
  if (provider === "tavily" && !hasTavilyWebSearchConfig()) {
    return []
  }

  const cached = getCachedSearchHits(provider, query)
  if (cached) return cached

  if (provider === "serper") {
    const serperHits = await searchWithSerperWeb(query, { signal, num: resolveSerperResultNum() }).catch(
      () => [] as SearchHit[],
    )
    setCachedSearchHits(provider, query, serperHits)
    return serperHits
  }

  const tavilyHits = await searchWithTavilyWeb(query, {
    signal,
    maxResults: resolveTavilyResultNum(),
    searchDepth: "advanced",
    includeAnswer: false,
    includeRawContent: false,
  }).catch(() => [] as SearchHit[])
  setCachedSearchHits(provider, query, tavilyHits)
  return tavilyHits
}

async function enrichHitsWithPageExtraction(input: { hits: SearchHit[]; signal?: AbortSignal }) {
  const limit = resolvePageExtractionLimit()
  if (limit <= 0 || input.hits.length === 0) {
    return input.hits
  }

  const targets = input.hits.slice(0, limit)
  let nextIndex = 0
  const enriched = [...input.hits]

  const worker = async () => {
    while (true) {
      if (input.signal?.aborted) throw new Error("lead_hunter_skill_aborted")
      const currentIndex = nextIndex
      if (currentIndex >= targets.length) return
      nextIndex += 1

      const target = targets[currentIndex]
      const fetched = await fetchTextWithTimeout(target.url, PAGE_EXTRACTION_TIMEOUT_MS, input.signal)
      if (!fetched?.text) continue

      const pageTitle = extractTitleFromHtml(fetched.text)
      const pageSnippet = extractPlainTextFromHtml(fetched.text).slice(0, 420)
      if (!pageSnippet) continue

      enriched[currentIndex] = {
        ...target,
        title: pageTitle || target.title,
        url: fetched.finalUrl || target.url,
        snippet: pageSnippet,
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(PAGE_EXTRACTION_CONCURRENCY, targets.length)) }, () => worker()),
  )
  return dedupeHits(enriched)
}

async function collectSearchHits(input: { queries: string[]; signal?: AbortSignal }) {
  const concurrency = resolveSearchConcurrency(input.queries.length)
  const earlyStopSignals = resolveSearchEarlyStopSignals()
  const tavilyTriggerSignals = resolveTavilySupplementTriggerSignals()
  const tavilySupplementQueries = Math.min(resolveTavilySupplementMaxQueries(), input.queries.length)
  const hits: SearchHit[] = []
  const seenUrls = new Set<string>()
  let uniqueSignals = 0

  const collectForProvider = async (provider: SearchHit["provider"], queries: string[]) => {
    let nextIndex = 0
    let stop = false
    const worker = async () => {
      while (true) {
        if (input.signal?.aborted) throw new Error("lead_hunter_skill_aborted")
        if (stop) return
        const currentIndex = nextIndex
        if (currentIndex >= queries.length) return
        nextIndex += 1

        const query = queries[currentIndex]
        const batch = await runWebSearchForQuery(provider, query, input.signal)
        if (!batch.length) continue

        hits.push(...batch)
        for (const item of batch) {
          const url = normalizeSourceUrlForDedupe(item.url)
          if (seenUrls.has(url)) continue
          seenUrls.add(url)
          uniqueSignals += 1
        }
        if (uniqueSignals >= earlyStopSignals) {
          stop = true
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
  }

  await collectForProvider("serper", input.queries)

  const tavilyTriggerThreshold = Math.min(earlyStopSignals, tavilyTriggerSignals)
  const shouldRunTavilySupplement =
    uniqueSignals <= tavilyTriggerThreshold &&
    Boolean(process.env.TAVILY_API_KEY?.trim())
  if (shouldRunTavilySupplement) {
    await collectForProvider("tavily", input.queries.slice(0, tavilySupplementQueries))
  }

  return dedupeHits(hits)
}

function buildFallbackBrief(input: {
  companyName: string
  query: string
  advisorType: LeadHunterAdvisorType
  evidence: LeadHunterEvidenceItem[]
  language: "zh" | "en"
  vbuyMode: boolean
}) {
  const topEvidence = input.evidence.slice(0, 6)
  const risk = topEvidence.some((item) => /complaint|lawsuit|dispute|refund|negative|risk/i.test(item.claim))
    ? "medium-high"
    : topEvidence.length >= 3
      ? "medium"
      : "insufficient"
  const evidenceLines = topEvidence
    .map((item, index) => `- [S${index + 1}] ${item.source_title} (${item.source_url})`)
    .join("\n")

  if (input.language === "zh") {
    const company = input.companyName || "目标公司"
    const riskLabel = risk === "medium-high" ? "中高" : risk === "medium" ? "中" : "证据不足"
    const entryTitle = input.vbuyMode ? "VBUY 合作切入点" : "合作切入点"
    return (
      `# ${company} 客户画像与合作风险简报\n\n` +
      `## 1. 公司概览\n` +
      `- 目标公司：${company}\n` +
      `- 当前需求：${input.query}\n` +
      `- 公开信息覆盖：${topEvidence.length > 0 ? "已有一定信号" : "公开信号较少"}\n\n` +
      `## 2. 业务与市场定位\n` +
      `- 基于当前证据可形成初步定位，仍需官网与最新公开资料复核。\n` +
      `- 建议补充品牌声明、主要渠道与目标区域信息。\n\n` +
      `## 3. 产品与价格区间\n` +
      `- 本轮公网信息对 SKU 与价格覆盖有限，建议二轮补抓产品页/集合页/政策页。\n\n` +
      `## 4. 目标客户画像\n` +
      `- 目前可初步推断 ICP，但需通过销售触达与访谈进一步确认。\n\n` +
      `## 5. 采购与合作决策链\n` +
      `- 当前无法完整确认全部决策角色与签约主体，建议首轮聚焦采购/运营/品牌负责人。\n\n` +
      `## 6. 舆情与商业履约风险\n` +
      `- 综合风险等级：${riskLabel}\n` +
      `- 回款、交付、售后、签约主体与渠道稳定性仍需进一步核验。\n\n` +
      `## 7. ${entryTitle}\n` +
      `- 建议从低承诺试单或小批量合作切入，先验证质量、交期与协同效率。\n\n` +
      `## 8. 首次接洽建议\n` +
      `- 首轮明确 owner、周期、验收标准及合规要求，同步准备样品、MOQ、交期与履约证明。` +
      (evidenceLines ? `\n\n## 证据快照\n${evidenceLines}` : "")
    )
  }

  const company = input.companyName || "Target Company"
  const entryTitle = input.vbuyMode ? "VBUY Cooperation Entry" : "Cooperation Entry"
  return (
    `# ${company} Customer Profile and Cooperation Risk Brief\n\n` +
    `## 1. Company Overview\n` +
    `- Target: ${company}\n` +
    `- Current request: ${input.query}\n` +
    `- Public coverage: ${topEvidence.length > 0 ? "available" : "limited"}\n\n` +
    `## 2. Business and Market Positioning\n` +
    `- Preliminary positioning inferred from search signals.\n` +
    `- Validate against official pages and latest announcements.\n\n` +
    `## 3. Product and Price Range\n` +
    `- Public extraction is limited for SKU and pricing in this run.\n` +
    `- Recommend follow-up extraction on official catalog pages.\n\n` +
    `## 4. Target Customer Profile\n` +
    `- Current signals suggest a preliminary ICP only.\n` +
    `- Confirm via first-party outreach and qualification.\n\n` +
    `## 5. Buying and Cooperation Chain\n` +
    `- Decision roles and contract entity are not fully confirmed yet.\n` +
    `- Prioritize mapping procurement, operations, and brand owners.\n\n` +
    `## 6. Sentiment and Commercial Fulfillment Risk\n` +
    `- Overall risk: ${risk}\n` +
    `- Payment risk: pending validation\n` +
    `- Delivery risk: pending validation\n` +
    `- Service risk: pending validation\n` +
    `- Contract entity risk: pending validation\n` +
    `- Channel stability risk: pending validation\n\n` +
    `## 7. ${entryTitle}\n` +
    `- Start with low-commitment pilot orders and measurable checkpoints.\n\n` +
    `## 8. First Outreach Suggestions\n` +
    `- Confirm owner, timeline, acceptance criteria, and compliance baseline.\n` +
    `- Bring sample, MOQ, lead-time, and fulfillment proof in round one.` +
    (evidenceLines ? `\n\n## Evidence Snapshot\n${evidenceLines}` : "")
  )
}
async function emitEvent(input: {
  onSseEvent?: (payload: LeadHunterSkillEventPayload) => void | Promise<void>
  payload: LeadHunterSkillEventPayload
}) {
  if (!input.onSseEvent) return
  await input.onSseEvent(input.payload)
}

async function generateReportWithModel(input: {
  advisorType: LeadHunterAdvisorType
  language: "zh" | "en"
  query: string
  companyName: string
  website: string
  evidence: LeadHunterEvidenceItem[]
  enterpriseKnowledge: EnterpriseKnowledgeContext | null
  vbuyMode: boolean
  vbuyFitLayer: string
  skillGuide?: string | null
  memoryContext?: string | null
  soulCard?: string | null
  signal?: AbortSignal
}) {
  const promptEvidenceLimit = resolveReportPromptEvidenceLimit()
  const enterpriseSnippetLimit = resolveReportEnterpriseSnippetLimit()
  const reportMaxTokens = resolveReportMaxTokens()
  const reportTimeoutMs = resolveReportTimeoutMs()
  const reportProviderTimeoutMs = resolveReportProviderTimeoutMs()

  const sectionHeadings =
    input.language === "zh"
      ? [
          "1. \u516c\u53f8\u6982\u89c8",
          "2. \u4e1a\u52a1\u4e0e\u5e02\u573a\u5b9a\u4f4d",
          "3. \u4ea7\u54c1\u4e0e\u4ef7\u683c\u533a\u95f4",
          "4. \u76ee\u6807\u5ba2\u6237\u753b\u50cf",
          "5. \u91c7\u8d2d\u4e0e\u5408\u4f5c\u51b3\u7b56\u94fe",
          "6. \u8206\u60c5\u4e0e\u5546\u4e1a\u5c65\u7ea6\u98ce\u9669",
          input.vbuyMode ? "7. VBUY \u5408\u4f5c\u5207\u5165\u70b9" : "7. \u5408\u4f5c\u5207\u5165\u70b9",
          "8. \u9996\u6b21\u63a5\u6d3d\u5efa\u8bae",
        ]
      : [
          "1. Company Overview",
          "2. Business and Market Positioning",
          "3. Product and Price Range",
          "4. Target Customer Profile",
          "5. Buying and Cooperation Chain",
          "6. Sentiment and Commercial Fulfillment Risk",
          input.vbuyMode ? "7. VBUY Cooperation Entry" : "7. Cooperation Entry",
          "8. First Outreach Suggestions",
        ]

  const minCitations = Math.max(3, Math.min(8, input.evidence.length))
  const languageInstruction =
    input.language === "zh"
      ? "Write the full report in Simplified Chinese. Keep company, product, and person names in original language."
      : "Write the report in English."

  const systemPrompt = `You are a commercial due-diligence advisor.
${languageInstruction}
Use exactly these 8 section headings, in order:
${sectionHeadings.map((item) => `- ${item}`).join("\n")}

Requirements:
1) Ground factual claims in evidence; use inline citations like [S1], [S2], mapped to evidence_summary indices.
2) Use at least ${minCitations} distinct citations when enough evidence exists.
3) If evidence is thin or conflicting, state uncertainty explicitly.
4) Risk means commercial fulfillment risk, not legal conclusion.
5) Do not expose tool/provider implementation details.
6) Keep each section concise and actionable; prefer bullet points over long paragraphs.
7) For key factual bullets, append source links or source titles in-line, e.g. "source: https://...".`

  const buildUserPrompt = (options?: { compact?: boolean }) =>
    [
      `advisor_type: ${input.advisorType}`,
      `company_name: ${input.companyName || ""}`,
      `website_url: ${input.website || ""}`,
      `user_query: ${input.query}`,
      input.memoryContext ? `memory_context: ${input.memoryContext}` : "",
      input.soulCard ? `soul_card: ${input.soulCard}` : "",
      input.vbuyMode ? "vbuy_mode: true" : "vbuy_mode: false",
      !options?.compact && input.skillGuide ? `skill_guide_excerpt:\n${input.skillGuide}` : "",
      !options?.compact && input.vbuyMode && input.vbuyFitLayer
        ? `vbuy_fit_reference (internal, summarize only relevant lines):\n${input.vbuyFitLayer}`
        : "",
      input.enterpriseKnowledge
        ? `enterprise_knowledge_summary:\n${buildEnterpriseKnowledgeSummary(input.enterpriseKnowledge, enterpriseSnippetLimit)}`
        : "",
      `evidence_summary:\n${toEvidenceSummary(
        input.evidence,
        options?.compact ? Math.max(6, Math.floor(promptEvidenceLimit * 0.75)) : promptEvidenceLimit,
      )}`,
      `evidence_matrix_json_compact:\n${JSON.stringify(
        toPromptEvidenceMatrix(
          input.evidence,
          options?.compact ? Math.max(6, Math.floor(promptEvidenceLimit * 0.75)) : promptEvidenceLimit,
        ),
      )}`,
    ]
      .filter(Boolean)
      .join("\n\n")

  try {
    const answer = await generateTextWithWriterModel(systemPrompt, buildUserPrompt(), LEAD_HUNTER_SKILL_MODEL, {
      temperature: 0.2,
      maxTokens: reportMaxTokens,
      timeoutMs: reportTimeoutMs,
      totalTimeoutMs: REPORT_TIMEOUT_MS,
      providerTimeoutMs: reportProviderTimeoutMs,
      signal: input.signal,
    })
    return sanitizeAssistantContent(answer)
  } catch (error) {
    console.warn("lead_hunter.skill.model_retry_compact", {
      message: error instanceof Error ? error.message : String(error),
      advisorType: input.advisorType,
    })
    const answer = await generateTextWithWriterModel(
      systemPrompt,
      buildUserPrompt({ compact: true }),
      LEAD_HUNTER_SKILL_MODEL,
      {
        temperature: 0.15,
        maxTokens: Math.max(1200, Math.floor(reportMaxTokens * 0.85)),
        timeoutMs: Math.max(30_000, Math.floor(reportTimeoutMs * 0.85)),
        totalTimeoutMs: REPORT_TIMEOUT_MS,
        providerTimeoutMs: Math.max(30_000, Math.floor(reportProviderTimeoutMs * 0.85)),
        signal: input.signal,
      },
    )
    return sanitizeAssistantContent(answer)
  }
}
export async function runLeadHunterSkillConversation(input: LeadHunterSkillRunInput): Promise<LeadHunterSkillRunResult> {
  const language = resolveOutputLanguage({ preferredLanguage: input.preferredLanguage, query: input.query })
  const companyName = pickCompanyName(input.query)
  const website = pickWebsiteUrl(input.query)
  const vbuyMode = shouldEnableVbuyModeFromContext({
    query: input.query,
    enterpriseCode: input.enterpriseCode,
    enterpriseId: input.enterpriseId,
  })

  const emit = async (payload: LeadHunterSkillEventPayload) => {
    const agentName = getLeadHunterAgentName(input.advisorType)
    const enriched: LeadHunterSkillEventPayload = {
      ...payload,
      conversation_id: input.conversationId || payload.conversation_id,
      agent_name: payload.agent_name || agentName,
      metadata: payload.metadata || { agent_name: agentName },
    }
    await emitEvent({ onSseEvent: input.onSseEvent, payload: enriched })
  }

  await emit({ event: "workflow_started", data: { status: "running" } })

  await emit({ event: "node_started", data: { node_name: "query_planning" } })
  const searchQueries = buildSearchQueries({
    advisorType: input.advisorType,
    query: input.query,
    companyName,
    website,
  })
  await emit({ event: "node_finished", data: { node_name: "query_planning", status: "succeeded", count: searchQueries.length } })

  const shouldLoadEnterpriseKnowledge =
    vbuyMode && typeof input.enterpriseId === "number" && Number.isFinite(input.enterpriseId) && input.enterpriseId > 0
  const enterpriseKnowledgePromise: Promise<EnterpriseKnowledgeContext | null> = shouldLoadEnterpriseKnowledge
    ? (async () => {
        await emit({ event: "node_started", data: { node_name: "enterprise_knowledge_retrieval" } })
        try {
          const context = await loadLeadHunterEnterpriseKnowledgeContext({
            enterpriseId: input.enterpriseId as number,
            query: input.query,
            queryVariants: buildEnterpriseKnowledgeQueryVariants(input.query, companyName),
            preferredScopes: [...buildLeadHunterKnowledgeScopes(input.advisorType)],
            platform: "generic",
            mode: "article",
          })
          await emit({
            event: "node_finished",
            data: {
              node_name: "enterprise_knowledge_retrieval",
              status: context?.snippets?.length ? "succeeded" : "completed",
              snippets: context?.snippets?.length || 0,
              datasets: context?.datasetsUsed?.length || 0,
            },
          })
          return context
        } catch (error) {
          await emit({
            event: "node_finished",
            data: {
              node_name: "enterprise_knowledge_retrieval",
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
            },
          })
          console.warn("lead_hunter.skill.enterprise_knowledge_failed", {
            advisorType: input.advisorType,
            enterpriseId: input.enterpriseId,
            enterpriseCode: input.enterpriseCode || null,
            message: error instanceof Error ? error.message : String(error),
          })
          return null
        }
      })()
    : Promise.resolve(null)

  const hits: SearchHit[] = []
  await emit({ event: "node_started", data: { node_name: "search_collect" } })
  if (!hasAnyWebSearchProviderConfig()) {
    await emit({
      event: "info",
      data: {
        node_name: "search_collect",
        status: "degraded",
        message: "web_search_provider_missing",
      },
    })
  }
  hits.push(...(await collectSearchHits({ queries: searchQueries, signal: input.signal })))
  const dedupedHits = dedupeHits(hits)
  const enrichedHits = await enrichHitsWithPageExtraction({ hits: dedupedHits, signal: input.signal })
  await emit({
    event: "node_finished",
    data: {
      node_name: "search_collect",
      status: enrichedHits.length > 0 ? "succeeded" : "failed",
      signals: enrichedHits.length,
      extracted_pages: Math.min(resolvePageExtractionLimit(), dedupedHits.length),
    },
  })

  const enterpriseKnowledge = await enterpriseKnowledgePromise

  const webEvidence = enrichedHits.map(toEvidenceItem)
  const enterpriseEvidence = toEnterpriseKnowledgeEvidence(enterpriseKnowledge)
  const evidence = [...enterpriseEvidence, ...webEvidence].slice(0, MAX_EVIDENCE_ITEMS)

  await emit({ event: "node_started", data: { node_name: "report_synthesis" } })
  const [vbuyFitLayer, skillGuide] = await Promise.all([
    vbuyMode ? loadVbuyFitLayer() : Promise.resolve(""),
    loadCustomerIntelligenceSkillGuide(),
  ])

  let answer: string
  try {
    answer = await generateReportWithModel({
      advisorType: input.advisorType,
      language,
      query: input.query,
      companyName,
      website,
      evidence,
      enterpriseKnowledge,
      vbuyMode,
      vbuyFitLayer,
      skillGuide,
      memoryContext: input.memoryContext,
      soulCard: input.soulCard,
      signal: input.signal,
    })
  } catch (error) {
    console.warn("lead_hunter.skill.model_fallback", {
      message: error instanceof Error ? error.message : String(error),
      advisorType: input.advisorType,
    })
    answer = buildFallbackBrief({
      companyName,
      query: input.query,
      advisorType: input.advisorType,
      evidence,
      language,
      vbuyMode,
    })
  }

  answer = sanitizeAssistantContent(answer)
  await emit({ event: "node_finished", data: { node_name: "report_synthesis", status: "succeeded" } })

  if (answer) {
    await emit({ event: "text_chunk", data: { text: answer }, answer })
  }

  await emit({ event: "message_end", data: { status: "completed" } })
  await emit({
    event: "workflow_finished",
    data: {
      status: "succeeded",
      outputs: answer,
      evidence_count: evidence.length,
      language,
      vbuy_mode: vbuyMode,
    },
  })

  return {
    answer,
    evidence,
    language,
    vbuyMode,
  }
}

export function createLeadHunterSkillSseStream(input: LeadHunterSkillRunInput) {
  const encoder = new TextEncoder()
  let resolveDone: (value: LeadHunterSkillRunResult) => void = () => undefined
  let rejectDone: (reason?: unknown) => void = () => undefined

  const done = new Promise<LeadHunterSkillRunResult>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void runLeadHunterSkillConversation({
        ...input,
        onSseEvent: async (payload) => {
          controller.enqueue(encoder.encode(toSseWireChunk(payload)))
          await input.onSseEvent?.(payload)
        },
      })
        .then((result) => {
          controller.close()
          resolveDone(result)
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          controller.enqueue(
            encoder.encode(
              toSseWireChunk({
                event: "error",
                conversation_id: input.conversationId || undefined,
                data: { error: message },
                error: message,
              }),
            ),
          )
          controller.close()
          rejectDone(error)
        })
    },
  })

  return { stream, done }
}
