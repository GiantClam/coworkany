import {
  buildPreviewStyleBody,
  buildPreviewStyleBullet,
  buildPreviewStyleKicker,
  buildPreviewStyleTitle,
} from "@/lib/lead-tools/ppt-preview-copy"
import { resolvePptMasterTemplateStyleKey } from "@/lib/lead-tools/ppt-master-template-style"

export type PptScenario = "marketing-campaign" | "product-launch" | "sales-deck" | "training"
export type PptLanguage = "zh-CN" | "en-US"
export type PptPreviewLayout =
  | "cover"
  | "agenda"
  | "insight"
  | "comparison"
  | "evidence"
  | "stats"
  | "chart"
  | "process"
  | "timeline"
export type PptPreviewPageIntent =
  | "cover"
  | "contents"
  | "statement"
  | "spotlight"
  | "comparison"
  | "stats"
  | "chart"
  | "process"
  | "closing"
export type PptPreviewStructuredField =
  | "bullets"
  | "contentsItems"
  | "comparisonItems"
  | "spotlightItems"
  | "metricItems"
  | "chartItems"
  | "processItems"
  | "closingItems"
export type PptPreviewVisualPriority = "hero" | "structured" | "comparison" | "evidence" | "data" | "flow" | "closing"
export type PptPreviewStyleKey =
  | "ppt169_brutalist_ai_newspaper_2026"
  | "ppt169_sugar_rush_memphis"
  | "ppt169_pritzker_2026"
  | "ppt169_swiss_grid_systems"
  | "ppt169_glassmorphism_demo"
  | "ppt169_attention_is_all_you_need"
  | "ppt169_building_effective_agents"
  | "ppt169_cangzhuo"
  | "ppt169_fashion_weekly_digest"
  | "ppt169_general_dark_tech_claude_code_auto_mode"
  | "ppt169_global_ai_capital_2026"
  | "ppt169_high_rise_renewal"
  | "ppt169_home_design_trends_2026"
  | "ppt169_image_text_showcase"
  | "ppt169_indie_bookstore_zine_guide"
  | "ppt169_kimsoong_loyalty_programme"
  | "ppt169_kubernetes_blueprint_2026"
  | "ppt169_lin_huiyin_architect"
  | "ppt169_lin_huiyin_architect_revised"
  | "ppt169_liziqi_plant_dye_colors"
  | "ppt169_lora_hu_2021"
export type PptPreviewStyleArchetype =
  | "ppt169_brutalist_ai_newspaper_2026"
  | "ppt169_sugar_rush_memphis"
  | "ppt169_pritzker_2026"
  | "ppt169_building_effective_agents"
  | "ppt169_swiss_grid_systems"
export type PptPreviewModelValue =
  | "deepseek-v4-pro"
  | "MiniMax-M2.7-highspeed"
  | "MiniMax-M3"
  | "gpt-6-astra"
  | "gpt-6-luna"
  | "gpt-6-sol"
  | "gpt-6.1-sol"
  | "step-3.7-flash"
  | (string & {})
export type PptPreviewTemplateMode = "auto-4" | "single-template"
export type PptFrontendTemplateId = string
export type PptPreviewPageCount = number
export type PptPreviewNarrativeAngle = "executive-brief" | "campaign-story" | "data-proof" | "action-plan"
export type PptPreviewRuntimeValue = "ppt-master-agent" | "frontend-slides-agent"

export const MIN_PPT_PREVIEW_PAGE_COUNT = 4
export const MAX_PPT_PREVIEW_PAGE_COUNT = 20
export const DEFAULT_PPT_PREVIEW_PAGE_COUNT = 9

export type PptPreviewResearchBrief = {
  topic: string
  keyFacts: string[]
  numericEvidence?: string[]
  risks?: string[]
  implications?: string[]
  sourceNotes?: string[]
  rawSummary?: string
}

export type PptPreviewRequest = {
  requestId?: string
  prompt: string
  researchBrief?: string | PptPreviewResearchBrief
  scenario: PptScenario
  language: PptLanguage
  model?: PptPreviewModelValue
  preferredProviderId?: string | null
  runtimeSlideModel?: string | null
  runtimeSlideProvider?: string | null
  previewRuntime?: PptPreviewRuntimeValue
  templateMode?: PptPreviewTemplateMode
  templateId?: PptFrontendTemplateId
  narrativeAngle?: PptPreviewNarrativeAngle
  pageCount?: PptPreviewPageCount | null
  images?: PptPreviewInputImage[]
}

export type PptPreviewInputImage = {
  url: string
  title?: string | null
  mimeType?: string | null
  sourceNodeKey?: string | null
  role?: "cover" | "content" | "logo" | "reference"
}

export type PptPreviewSlide = {
  id: string
  layout: PptPreviewLayout
  intent?: PptPreviewPageIntent
  nativePageType?: string
  structuredFields?: PptPreviewStructuredField[]
  kicker: string
  title: string
  body: string
  bullets: string[]
  contentsItems?: Array<{
    index: string
    title: string
    detail: string
  }>
  comparisonItems?: Array<{
    label: string
    title: string
    detail: string
  }>
  spotlightItems?: Array<{
    title: string
    detail: string
  }>
  metricItems?: Array<{
    value: string
    label: string
    note?: string
  }>
  chartItems?: Array<{
    label: string
    value: number
    detail: string
  }>
  processItems?: Array<{
    step: string
    title: string
    detail: string
  }>
  closingItems?: Array<{
    label: string
    detail: string
  }>
  image?: PptPreviewInputImage
  accent: string
}

export type PptPreviewAsset = {
  mimeType: "image/svg+xml" | "image/png"
  width: number
  height: number
  dataUrl: string
}

export type PptPreviewTemplateSlotSchema = {
  layout: PptPreviewLayout
  intent: PptPreviewPageIntent
  nativePageType: string
  structuredFields: readonly PptPreviewStructuredField[]
  visualPriority: PptPreviewVisualPriority
  fallbackIntents?: readonly PptPreviewPageIntent[]
}

export type PptPreviewTemplateCapability = {
  templateId: string
  summary: string
  slots: readonly PptPreviewTemplateSlotSchema[]
}

export type PptPreviewVariantStyle = {
  key: PptPreviewStyleKey
  name: string
  summary: string
  stylePrompt: string
  palette: {
    background: string
    foreground: string
    accent: string
    panel: string
    border: string
  }
  strengths: readonly string[]
}

export type PptPreviewVariant = Omit<PptPreviewVariantStyle, "key"> & {
  key: string
  styleKey: PptPreviewStyleKey
  templateId?: PptFrontendTemplateId
  narrativeAngle?: PptPreviewNarrativeAngle
  slotLabel?: "A" | "B" | "C" | "D"
  outline?: string[]
  slides: PptPreviewSlide[]
  preview?: {
    format: "svg"
    themeId: string
    cover: PptPreviewAsset
    slides: PptPreviewAsset[]
    htmlDocument?: {
      fileName: string
      html: string
    }
  }
}

export type PptPreviewDeck = {
  title: string
  scenario: PptScenario
  language: PptLanguage
  generatedAt: string
  outline: string[]
  variants: PptPreviewVariant[]
  previewEngine?: "ppt-master-svg" | "ppt-master-project" | "frontend-slides-html"
  previewSessionId?: string
  provider?: string
  previewModel?: string
  preferredProviderId?: string | null
  runtimeSlideModel?: string | null
  runtimeSlideProvider?: string | null
  source?: "live" | "mock"
  templateMode?: PptPreviewTemplateMode
  selectedTemplateId?: PptFrontendTemplateId | null
  pageCount?: PptPreviewPageCount | null
  resolvedPageCount?: PptPreviewPageCount
}

export type PptPreviewVariantDescriptor = {
  key: string
  slotLabel: "A" | "B" | "C" | "D"
  style: PptPreviewVariantStyle
  templateId: PptFrontendTemplateId
  narrativeAngle?: PptPreviewNarrativeAngle
}

export type PptRecommendedTemplateSummary = {
  rank: number
  templateId: PptFrontendTemplateId
  templateLabel: string
  styleKey: PptPreviewStyleKey
  styleName: string
  summary: string
}

export type PptFrontendTemplateOption = {
  id: PptFrontendTemplateId
  label: { zh: string; en: string }
  styleKey: PptPreviewStyleKey
  summary: { zh: string; en: string }
  matchKeywords?: readonly string[]
  scenarioHints?: readonly PptScenario[]
  priority?: number
}

const pptPreviewStyleArchetypeMap: Readonly<Record<PptPreviewStyleKey, PptPreviewStyleArchetype>> = {
  "ppt169_brutalist_ai_newspaper_2026": "ppt169_brutalist_ai_newspaper_2026",
  "ppt169_sugar_rush_memphis": "ppt169_sugar_rush_memphis",
  "ppt169_pritzker_2026": "ppt169_pritzker_2026",
  "ppt169_swiss_grid_systems": "ppt169_swiss_grid_systems",
  "ppt169_glassmorphism_demo": "ppt169_sugar_rush_memphis",
  "ppt169_attention_is_all_you_need": "ppt169_swiss_grid_systems",
  "ppt169_building_effective_agents": "ppt169_building_effective_agents",
  "ppt169_cangzhuo": "ppt169_brutalist_ai_newspaper_2026",
  "ppt169_fashion_weekly_digest": "ppt169_pritzker_2026",
  "ppt169_general_dark_tech_claude_code_auto_mode": "ppt169_pritzker_2026",
  "ppt169_global_ai_capital_2026": "ppt169_brutalist_ai_newspaper_2026",
  "ppt169_high_rise_renewal": "ppt169_pritzker_2026",
  "ppt169_home_design_trends_2026": "ppt169_pritzker_2026",
  "ppt169_image_text_showcase": "ppt169_swiss_grid_systems",
  "ppt169_indie_bookstore_zine_guide": "ppt169_pritzker_2026",
  "ppt169_kimsoong_loyalty_programme": "ppt169_sugar_rush_memphis",
  "ppt169_kubernetes_blueprint_2026": "ppt169_swiss_grid_systems",
  "ppt169_lin_huiyin_architect": "ppt169_pritzker_2026",
  "ppt169_lin_huiyin_architect_revised": "ppt169_pritzker_2026",
  "ppt169_liziqi_plant_dye_colors": "ppt169_sugar_rush_memphis",
  "ppt169_lora_hu_2021": "ppt169_sugar_rush_memphis",
} as const

const knownPptPreviewStyleKeys = new Set<PptPreviewStyleKey>(Object.keys(pptPreviewStyleArchetypeMap) as PptPreviewStyleKey[])

export function isKnownPptPreviewStyleKey(value: unknown): value is PptPreviewStyleKey {
  return typeof value === "string" && knownPptPreviewStyleKeys.has(value as PptPreviewStyleKey)
}

export function resolvePptPreviewStyleArchetype(styleKey: PptPreviewStyleKey): PptPreviewStyleArchetype {
  return pptPreviewStyleArchetypeMap[styleKey]
}

const basePptPreviewStyleIntentMap: Readonly<Record<PptPreviewStyleArchetype, Record<PptPreviewLayout, PptPreviewPageIntent>>> = {
  "ppt169_brutalist_ai_newspaper_2026": {
    cover: "cover",
    agenda: "contents",
    insight: "statement",
    comparison: "comparison",
    evidence: "spotlight",
    stats: "stats",
    chart: "chart",
    process: "process",
    timeline: "closing",
  },
  "ppt169_sugar_rush_memphis": {
    cover: "cover",
    agenda: "contents",
    insight: "spotlight",
    comparison: "comparison",
    evidence: "statement",
    stats: "stats",
    chart: "chart",
    process: "process",
    timeline: "closing",
  },
  "ppt169_pritzker_2026": {
    cover: "cover",
    agenda: "contents",
    insight: "statement",
    comparison: "comparison",
    evidence: "spotlight",
    stats: "stats",
    chart: "chart",
    process: "process",
    timeline: "closing",
  },
  "ppt169_swiss_grid_systems": {
    cover: "cover",
    agenda: "contents",
    insight: "statement",
    comparison: "comparison",
    evidence: "spotlight",
    stats: "stats",
    chart: "chart",
    process: "process",
    timeline: "closing",
  },
  "ppt169_building_effective_agents": {
    cover: "cover",
    agenda: "contents",
    insight: "statement",
    comparison: "comparison",
    evidence: "spotlight",
    stats: "stats",
    chart: "chart",
    process: "process",
    timeline: "closing",
  },
} as const

export const pptPreviewStyleIntentMap: Readonly<
  Record<PptPreviewStyleKey, Record<PptPreviewLayout, PptPreviewPageIntent>>
> = {
  ...basePptPreviewStyleIntentMap,
  "ppt169_glassmorphism_demo": basePptPreviewStyleIntentMap["ppt169_sugar_rush_memphis"],
  "ppt169_attention_is_all_you_need": basePptPreviewStyleIntentMap["ppt169_swiss_grid_systems"],
  "ppt169_building_effective_agents": basePptPreviewStyleIntentMap["ppt169_building_effective_agents"],
  "ppt169_cangzhuo": basePptPreviewStyleIntentMap["ppt169_brutalist_ai_newspaper_2026"],
  "ppt169_fashion_weekly_digest": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_general_dark_tech_claude_code_auto_mode": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_global_ai_capital_2026": basePptPreviewStyleIntentMap["ppt169_brutalist_ai_newspaper_2026"],
  "ppt169_high_rise_renewal": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_home_design_trends_2026": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_image_text_showcase": basePptPreviewStyleIntentMap["ppt169_swiss_grid_systems"],
  "ppt169_indie_bookstore_zine_guide": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_kimsoong_loyalty_programme": basePptPreviewStyleIntentMap["ppt169_sugar_rush_memphis"],
  "ppt169_kubernetes_blueprint_2026": basePptPreviewStyleIntentMap["ppt169_swiss_grid_systems"],
  "ppt169_lin_huiyin_architect": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_lin_huiyin_architect_revised": basePptPreviewStyleIntentMap["ppt169_pritzker_2026"],
  "ppt169_liziqi_plant_dye_colors": basePptPreviewStyleIntentMap["ppt169_sugar_rush_memphis"],
  "ppt169_lora_hu_2021": basePptPreviewStyleIntentMap["ppt169_sugar_rush_memphis"],
} as const

const pptPreviewStructuredFieldsByIntent: Readonly<Record<PptPreviewPageIntent, readonly PptPreviewStructuredField[]>> = {
  cover: ["bullets"],
  contents: ["contentsItems"],
  statement: ["bullets"],
  spotlight: ["spotlightItems"],
  comparison: ["comparisonItems"],
  stats: ["metricItems"],
  chart: ["chartItems"],
  process: ["processItems"],
  closing: ["closingItems"],
} as const

function createTemplateSlot(
  layout: PptPreviewLayout,
  intent: PptPreviewPageIntent,
  nativePageType: string,
  visualPriority: PptPreviewVisualPriority,
  fallbackIntents?: readonly PptPreviewPageIntent[],
): PptPreviewTemplateSlotSchema {
  return {
    layout,
    intent,
    nativePageType,
    structuredFields: pptPreviewStructuredFieldsByIntent[intent],
    visualPriority,
    fallbackIntents,
  }
}

const basePptPreviewTemplateCapabilities: Readonly<Record<PptPreviewStyleArchetype, PptPreviewTemplateCapability>> = {
  "ppt169_brutalist_ai_newspaper_2026": {
    templateId: "long-table",
    summary: "Long Table prioritizes agenda clarity, ledger structures, moderated comparisons, and service-style closing blocks.",
    slots: [
      createTemplateSlot("cover", "cover", "editorial-cover", "hero"),
      createTemplateSlot("agenda", "contents", "agenda-ledger", "structured"),
      createTemplateSlot("insight", "statement", "quote-verdict", "hero"),
      createTemplateSlot("comparison", "comparison", "featured-edition-compare", "comparison"),
      createTemplateSlot("evidence", "spotlight", "evidence-matrix", "evidence"),
      createTemplateSlot("stats", "stats", "metric-ledger", "data"),
      createTemplateSlot("chart", "chart", "index-board", "data", ["comparison", "stats", "spotlight"]),
      createTemplateSlot("process", "process", "schedule-ledger", "flow", ["closing", "contents", "spotlight"]),
      createTemplateSlot("timeline", "closing", "service-close", "closing", ["process", "spotlight"]),
    ],
  },
  "ppt169_sugar_rush_memphis": {
    templateId: "playful",
    summary: "Playful favors branded bursts, collage comparisons, chart boards, and guided flow tracks instead of cartoon fallback chips.",
    slots: [
      createTemplateSlot("cover", "cover", "brand-burst-cover", "hero"),
      createTemplateSlot("agenda", "contents", "orbit-contents", "structured"),
      createTemplateSlot("insight", "spotlight", "brand-proof-band", "evidence"),
      createTemplateSlot("comparison", "comparison", "collage-compare", "comparison"),
      createTemplateSlot("evidence", "statement", "vision-frame", "hero"),
      createTemplateSlot("stats", "stats", "signal-pop-grid", "data"),
      createTemplateSlot("chart", "chart", "brand-chart-board", "data", ["comparison", "stats", "spotlight"]),
      createTemplateSlot("process", "process", "brand-flow-track", "flow", ["closing", "contents", "spotlight"]),
      createTemplateSlot("timeline", "closing", "ribbon-close", "closing", ["process", "spotlight"]),
    ],
  },
  "ppt169_pritzker_2026": {
    templateId: "broadside",
    summary: "Broadside emphasizes declaration posters, supporting columns, spillover boards, and action broadsides with explicit support text.",
    slots: [
      createTemplateSlot("cover", "cover", "poster-cover", "hero"),
      createTemplateSlot("agenda", "contents", "column-contents-board", "structured"),
      createTemplateSlot("insight", "statement", "declaration-poster", "hero"),
      createTemplateSlot("comparison", "comparison", "broadside-contrast-column", "comparison"),
      createTemplateSlot("evidence", "spotlight", "proof-poster-column", "evidence"),
      createTemplateSlot("stats", "stats", "market-barboard", "data"),
      createTemplateSlot("chart", "chart", "spillover-barboard", "data", ["comparison", "stats", "spotlight"]),
      createTemplateSlot("process", "process", "action-broadside", "flow", ["closing", "spotlight", "contents"]),
      createTemplateSlot("timeline", "closing", "closing-broadside", "closing", ["process", "spotlight"]),
    ],
  },
  "ppt169_swiss_grid_systems": {
    templateId: "neo-grid-bold",
    summary: "Neo-Grid Bold is the most modular preset, leaning on visible rails, signal boards, grid comparisons, and action sequences.",
    slots: [
      createTemplateSlot("cover", "cover", "grid-hero", "hero"),
      createTemplateSlot("agenda", "contents", "module-rail", "structured"),
      createTemplateSlot("insight", "statement", "decision-grid", "hero"),
      createTemplateSlot("comparison", "comparison", "grid-compare-shell", "comparison"),
      createTemplateSlot("evidence", "spotlight", "proof-grid", "evidence"),
      createTemplateSlot("stats", "stats", "signal-count-grid", "data"),
      createTemplateSlot("chart", "chart", "signal-chart-board", "data", ["comparison", "stats", "spotlight"]),
      createTemplateSlot("process", "process", "sequence-flow-board", "flow", ["closing", "contents", "spotlight"]),
      createTemplateSlot("timeline", "closing", "action-sequence-close", "closing", ["process", "spotlight"]),
    ],
  },
  "ppt169_building_effective_agents": {
    templateId: "building-effective-agents",
    summary: "Effective Agents prioritizes capability layers, orchestration maps, runtime proof, and operator-friendly rollout sequences.",
    slots: [
      createTemplateSlot("cover", "cover", "agent-system-cover", "hero"),
      createTemplateSlot("agenda", "contents", "capability-map", "structured"),
      createTemplateSlot("insight", "statement", "system-verdict", "hero"),
      createTemplateSlot("comparison", "comparison", "orchestration-compare", "comparison"),
      createTemplateSlot("evidence", "spotlight", "runtime-proof", "evidence"),
      createTemplateSlot("stats", "stats", "capability-signals", "data"),
      createTemplateSlot("chart", "chart", "system-graph", "data", ["comparison", "stats", "spotlight"]),
      createTemplateSlot("process", "process", "execution-flow", "flow", ["closing", "contents", "spotlight"]),
      createTemplateSlot("timeline", "closing", "rollout-sequence", "closing", ["process", "spotlight"]),
    ],
  },
} as const

function inheritTemplateCapability(
  archetype: PptPreviewStyleArchetype,
  templateId: PptFrontendTemplateId,
  summary: string,
): PptPreviewTemplateCapability {
  return {
    templateId,
    summary,
    slots: basePptPreviewTemplateCapabilities[archetype].slots,
  }
}

export const pptPreviewTemplateCapabilities: Readonly<Record<PptPreviewStyleKey, PptPreviewTemplateCapability>> = {
  ...basePptPreviewTemplateCapabilities,
  "ppt169_glassmorphism_demo": inheritTemplateCapability(
    "ppt169_sugar_rush_memphis",
    "glassmorphism-demo",
    "Glassmorphism Demo keeps the bright launch rhythm but shifts it into translucent product panels and layered signal cards.",
  ),
  "ppt169_attention_is_all_you_need": inheritTemplateCapability(
    "ppt169_swiss_grid_systems",
    "attention-is-all-you-need",
    "Attention Is All You Need favors research proof, diagrams, and disciplined academic sequencing for thesis-style decks.",
  ),
  "ppt169_building_effective_agents": inheritTemplateCapability(
    "ppt169_swiss_grid_systems",
    "building-effective-agents",
    "Building Effective Agents leans into orchestration maps, capability rails, and implementation sequencing for agent-system decks.",
  ),
  "ppt169_cangzhuo": inheritTemplateCapability(
    "ppt169_brutalist_ai_newspaper_2026",
    "cangzhuo",
    "Cangzhuo keeps the ledger-like business review structure and is suited to Chinese management briefings and meeting-grade execution notes.",
  ),
  "ppt169_fashion_weekly_digest": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "fashion-weekly-digest",
    "Fashion Weekly Digest behaves like an editorial poster issue with curation rhythm, visual headlines, and culture-led sequencing.",
  ),
  "ppt169_general_dark_tech_claude_code_auto_mode": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "general-dark-tech-claude-code-auto-mode",
    "General Dark Tech favors high-contrast technical storytelling, dark product narrative, and system-level declaration boards.",
  ),
  "ppt169_global_ai_capital_2026": inheritTemplateCapability(
    "ppt169_brutalist_ai_newspaper_2026",
    "global-ai-capital-2026",
    "Global AI Capital 2026 frames market shifts as a capital-markets briefing with board memo structure and high-signal decision notes.",
  ),
  "ppt169_high_rise_renewal": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "high-rise-renewal",
    "High Rise Renewal frames urban transformation and architectural proposals with editorial declaration pages and supporting poster notes.",
  ),
  "ppt169_home_design_trends_2026": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "home-design-trends-2026",
    "Home Design Trends 2026 uses a magazine-style editorial frame for lifestyle trend decks and curated visual storytelling.",
  ),
  "ppt169_image_text_showcase": inheritTemplateCapability(
    "ppt169_swiss_grid_systems",
    "image-text-showcase",
    "Image Text Showcase emphasizes modular image-caption pairings, balanced information rails, and portfolio-like content sequencing.",
  ),
  "ppt169_indie_bookstore_zine_guide": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "indie-bookstore-zine-guide",
    "Indie Bookstore Zine Guide behaves like an editorial culture zine with poster rhythm, curation notes, and large-format declarations.",
  ),
  "ppt169_kimsoong_loyalty_programme": inheritTemplateCapability(
    "ppt169_sugar_rush_memphis",
    "kimsoong-loyalty-programme",
    "Kimsoong Loyalty Programme keeps a friendly brand-program tone with polished campaign cards, offers, and member-journey pacing.",
  ),
  "ppt169_kubernetes_blueprint_2026": inheritTemplateCapability(
    "ppt169_swiss_grid_systems",
    "kubernetes-blueprint-2026",
    "Kubernetes Blueprint 2026 leans into technical architecture, infrastructure modules, and platform blueprint sequencing.",
  ),
  "ppt169_lin_huiyin_architect": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "lin-huiyin-architect",
    "Lin Huiyin Architect behaves like an architectural editorial profile with poster layouts, biography notes, and cultural context panels.",
  ),
  "ppt169_lin_huiyin_architect_revised": inheritTemplateCapability(
    "ppt169_pritzker_2026",
    "lin-huiyin-architect-revised",
    "Lin Huiyin Architect Revised keeps the editorial architecture framing while tightening the support panels and cultural proof blocks.",
  ),
  "ppt169_liziqi_plant_dye_colors": inheritTemplateCapability(
    "ppt169_sugar_rush_memphis",
    "liziqi-plant-dye-colors",
    "Liziqi Plant Dye Colors emphasizes softer storytelling, tactile palettes, and a guided reveal better suited to lifestyle and craft decks.",
  ),
  "ppt169_lora_hu_2021": inheritTemplateCapability(
    "ppt169_sugar_rush_memphis",
    "lora-hu-2021",
    "Lora Hu 2021 carries a softer creator-brand rhythm with personal portfolio energy, lifestyle notes, and warmer story pacing.",
  ),
} as const

export const pptPreviewStyleCapabilities = Object.fromEntries(
  (Object.keys(pptPreviewTemplateCapabilities) as PptPreviewStyleKey[]).map((styleKey) => [
    styleKey,
    pptPreviewTemplateCapabilities[styleKey].slots.map((slot) => slot.intent),
  ]),
) as unknown as Readonly<Record<PptPreviewStyleKey, readonly PptPreviewPageIntent[]>>

function createFrontendTemplateOption(option: PptFrontendTemplateOption) {
  return option
}

export const pptFrontendTemplateOptions = [
  createFrontendTemplateOption({
    id: "aurora-glass",
    label: { zh: "极光玻璃", en: "Aurora Glass" },
    styleKey: "ppt169_glassmorphism_demo",
    summary: { zh: "偏 AI 系统、玻璃质感和指标面板。", en: "AI-system leaning, glassy, dashboard-heavy." },
    matchKeywords: ["ai", "agent", "ops", "dashboard", "系统", "智能体", "平台", "指标", "架构"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 0,
  }),
  createFrontendTemplateOption({
    id: "glassmorphism-demo",
    label: { zh: "玻璃拟态演示", en: "Glassmorphism Demo" },
    styleKey: "ppt169_glassmorphism_demo",
    summary: { zh: "半透明卡片、柔和光感和产品演示气质。", en: "Translucent panels, soft glow, and polished product-demo energy." },
    matchKeywords: ["glass", "glassmorphism", "仪表盘", "dashboard", "saas", "产品演示", "agent", "workspace"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "editorial-poster",
    label: { zh: "编辑海报", en: "Editorial Poster" },
    styleKey: "ppt169_pritzker_2026",
    summary: { zh: "偏封面大片、宣言页和编辑排版。", en: "Editorial poster energy with declaration pages." },
    matchKeywords: ["海报", "宣言", "发布", "keynote", "poster", "manifesto", "campaign", "launch"],
    scenarioHints: ["marketing-campaign"],
    priority: 0,
  }),
  createFrontendTemplateOption({
    id: "neo-brutalism",
    label: { zh: "新野蛮主义", en: "Neo Brutalism" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏硬朗标题、编辑栅格和纪要感。", en: "Sharp titles, editorial grids, board memo feel." },
    matchKeywords: ["brutal", "editorial", "board", "纪要", "复盘", "决策", "newspaper"],
    scenarioHints: ["sales-deck", "product-launch"],
    priority: 0,
  }),
  createFrontendTemplateOption({
    id: "swiss-grid",
    label: { zh: "瑞士网格", en: "Swiss Grid" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏理性咨询、强网格和模块化信息。", en: "Consulting-grade grids and modular signals." },
    matchKeywords: ["strategy", "consulting", "analysis", "grid", "策略", "咨询", "分析", "汇报"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 0,
  }),
  {
    id: "long-table",
    label: { zh: "长桌纪要", en: "Long Table" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "规则线、分栏和议题感最强。", en: "Ruled, structured, boardroom-style." },
    priority: 2,
  },
  {
    id: "playful",
    label: { zh: "轻快玩味", en: "Playful" },
    styleKey: "ppt169_sugar_rush_memphis",
    summary: { zh: "圆角、贴纸和高亮色块最强。", en: "Rounded, bright, energetic." },
    priority: 2,
  },
  {
    id: "broadside",
    label: { zh: "告示海报", en: "Broadside" },
    styleKey: "ppt169_pritzker_2026",
    summary: { zh: "大字号、强栏位和宣言感最强。", en: "Poster-like, bold, declarative." },
    priority: 2,
  },
  {
    id: "neo-grid-bold",
    label: { zh: "新网格粗体", en: "Neo Grid Bold" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "可见网格、强对比模块和策略界面感最强。", en: "Visible grids, modular, strategic." },
    priority: 2,
  },
  createFrontendTemplateOption({
    id: "google-brand",
    label: { zh: "Google 品牌", en: "Google Brand" },
    styleKey: "ppt169_sugar_rush_memphis",
    summary: { zh: "偏轻快品牌、产品发布和友好配色。", en: "Friendly product-brand launch tone." },
    matchKeywords: ["google", "workspace", "ads", "brand", "谷歌", "品牌"],
    scenarioHints: ["marketing-campaign", "product-launch"],
  }),
  createFrontendTemplateOption({
    id: "anthropic-brand",
    label: { zh: "Anthropic 品牌", en: "Anthropic Brand" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏研究型 AI 品牌、克制和判断清晰。", en: "Restrained AI research brand tone." },
    matchKeywords: ["anthropic", "claude", "safety", "research", "模型", "安全", "研究"],
    scenarioHints: ["product-launch", "sales-deck"],
  }),
  createFrontendTemplateOption({
    id: "academic-defense",
    label: { zh: "学术答辩", en: "Academic Defense" },
    styleKey: "ppt169_attention_is_all_you_need",
    summary: { zh: "偏论文答辩、研究汇报和结论证明。", en: "Thesis defense and research proof format." },
    matchKeywords: ["答辩", "学术", "论文", "研究", "课题", "defense", "academic", "thesis", "research"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "attention-is-all-you-need",
    label: { zh: "Attention 研究型", en: "Attention Research" },
    styleKey: "ppt169_attention_is_all_you_need",
    summary: { zh: "偏研究论文、方法图解和实验结论证明。", en: "Research-paper structure with method diagrams and evidence-led conclusions." },
    matchKeywords: ["transformer", "attention", "论文", "research", "method", "实验", "模型", "academic"],
    scenarioHints: ["training", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "ai-ops",
    label: { zh: "AI 运维", en: "AI Ops" },
    styleKey: "ppt169_building_effective_agents",
    summary: { zh: "偏平台架构、Agent 编排和运维指标。", en: "Platform architecture, agent orchestration, ops metrics." },
    matchKeywords: ["ai ops", "ops", "infra", "agent", "architecture", "运维", "架构", "智能体", "平台"],
    scenarioHints: ["product-launch", "sales-deck"],
  }),
  createFrontendTemplateOption({
    id: "building-effective-agents",
    label: { zh: "高效 Agent 构建", en: "Building Effective Agents" },
    styleKey: "ppt169_building_effective_agents",
    summary: { zh: "偏 Agent 系统设计、编排链路和能力拆解。", en: "Agent-system architecture, orchestration flow, and capability breakdown." },
    matchKeywords: ["agent", "agents", "orchestration", "workflow", "工具链", "编排", "智能体", "架构"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "cangzhuo",
    label: { zh: "苍桌纪要", en: "Cangzhuo" },
    styleKey: "ppt169_cangzhuo",
    summary: { zh: "偏中文管理层纪要、议题清单和执行部署。", en: "Chinese executive memo framing with agenda-led review and rollout notes." },
    matchKeywords: ["纪要", "汇报", "管理层", "经营", "执行", "复盘", "meeting", "review", "board"],
    scenarioHints: ["sales-deck", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "fashion-weekly-digest",
    label: { zh: "美学周鉴", en: "Fashion Weekly Digest" },
    styleKey: "ppt169_fashion_weekly_digest",
    summary: { zh: "偏时尚编辑、趋势策展和杂志节奏。", en: "Editorial fashion and trend-curation pacing." },
    matchKeywords: ["fashion", "trend", "digest", "时尚", "潮流", "策展", "brand story", "editorial"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "general-dark-tech-claude-code-auto-mode",
    label: { zh: "暗色科技", en: "General Dark Tech" },
    styleKey: "ppt169_general_dark_tech_claude_code_auto_mode",
    summary: { zh: "偏深色科技、技术系统和高对比表达。", en: "Dark-tech product framing with high-contrast system storytelling." },
    matchKeywords: ["dark tech", "claude code", "技术", "system", "infra", "platform", "engineering", "ai"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "global-ai-capital-2026",
    label: { zh: "全球 AI 资本 2026", en: "Global AI Capital 2026" },
    styleKey: "ppt169_global_ai_capital_2026",
    summary: { zh: "偏资本市场、行业格局和高层判断纪要。", en: "Capital-markets framing for industry shifts and board-level judgment." },
    matchKeywords: ["capital", "融资", "估值", "基金", "投资", "ai", "market", "capital market", "board"],
    scenarioHints: ["sales-deck", "product-launch"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "high-rise-renewal",
    label: { zh: "高楼更新", en: "High Rise Renewal" },
    styleKey: "ppt169_high_rise_renewal",
    summary: { zh: "偏城市更新、建筑方案和空间叙事。", en: "Urban renewal and architectural proposal framing." },
    matchKeywords: ["建筑", "城市更新", "renewal", "urban", "architecture", "地产", "空间"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "home-design-trends-2026",
    label: { zh: "家居设计趋势 2026", en: "Home Design Trends 2026" },
    styleKey: "ppt169_home_design_trends_2026",
    summary: { zh: "偏家居生活方式、趋势洞察和审美策展。", en: "Home and lifestyle trend curation with editorial pacing." },
    matchKeywords: ["home", "design", "家具", "家居", "trend", "lifestyle", "interior", "审美"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "image-text-showcase",
    label: { zh: "图文陈列", en: "Image Text Showcase" },
    styleKey: "ppt169_image_text_showcase",
    summary: { zh: "偏作品展示、图文并置和画册式节奏。", en: "Portfolio-like image-text sequencing and showcase grids." },
    matchKeywords: ["showcase", "portfolio", "画册", "图文", "案例展示", "lookbook", "gallery"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "indie-bookstore-zine-guide",
    label: { zh: "独立书店 Zine", en: "Indie Bookstore Zine" },
    styleKey: "ppt169_indie_bookstore_zine_guide",
    summary: { zh: "偏文化策展、编辑海报和杂志叙事。", en: "Editorial culture-zine framing with curation and poster rhythm." },
    matchKeywords: ["zine", "bookstore", "文化", "策展", "editorial", "magazine", "poster", "品牌故事"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "kimsoong-loyalty-programme",
    label: { zh: "会员忠诚计划", en: "Kimsoong Loyalty Programme" },
    styleKey: "ppt169_kimsoong_loyalty_programme",
    summary: { zh: "偏会员体系、活动权益和品牌运营方案。", en: "Membership-program and brand-retention storytelling." },
    matchKeywords: ["loyalty", "membership", "会员", "积分", "retention", "crm", "运营", "campaign"],
    scenarioHints: ["marketing-campaign", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "kubernetes-blueprint-2026",
    label: { zh: "Kubernetes 蓝图 2026", en: "Kubernetes Blueprint 2026" },
    styleKey: "ppt169_kubernetes_blueprint_2026",
    summary: { zh: "偏云原生架构、平台蓝图和技术治理。", en: "Cloud-native architecture, platform blueprints, and technical governance." },
    matchKeywords: ["kubernetes", "cloud native", "platform", "infra", "blueprint", "架构", "云原生", "技术治理"],
    scenarioHints: ["product-launch", "sales-deck"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "lin-huiyin-architect",
    label: { zh: "林徽因建筑", en: "Lin Huiyin Architect" },
    styleKey: "ppt169_lin_huiyin_architect",
    summary: { zh: "偏建筑人物、文化叙事和编辑式传记。", en: "Architect profile with editorial biography and cultural storytelling." },
    matchKeywords: ["lin huiyin", "建筑", "architect", "传记", "文化", "人物", "history"],
    scenarioHints: ["training", "marketing-campaign"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "lin-huiyin-architect-revised",
    label: { zh: "林徽因建筑·修订", en: "Lin Huiyin Architect Revised" },
    styleKey: "ppt169_lin_huiyin_architect_revised",
    summary: { zh: "偏建筑人物专题的修订版表达。", en: "Revised architecture-profile treatment with tighter editorial support." },
    matchKeywords: ["lin huiyin", "architect", "revised", "建筑", "文化人物", "专题"],
    scenarioHints: ["training", "marketing-campaign"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "liziqi-plant-dye-colors",
    label: { zh: "植物染色", en: "Plant Dye Colors" },
    styleKey: "ppt169_liziqi_plant_dye_colors",
    summary: { zh: "偏生活方式、手作主题和柔和叙事表达。", en: "Lifestyle storytelling with tactile craft cues and softer pacing." },
    matchKeywords: ["lifestyle", "craft", "颜色", "色彩", "生活方式", "手作", "品牌故事", "温和"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "lora-hu-2021",
    label: { zh: "Lora Hu 2021", en: "Lora Hu 2021" },
    styleKey: "ppt169_lora_hu_2021",
    summary: { zh: "偏个人品牌、创作者作品集和温和生活方式叙事。", en: "Creator-portfolio and personal-brand storytelling with a softer lifestyle tone." },
    matchKeywords: ["creator", "portfolio", "个人品牌", "作品集", "lifestyle", "创作者", "brand"],
    scenarioHints: ["marketing-campaign", "training"],
    priority: 1,
  }),
  createFrontendTemplateOption({
    id: "government-blue",
    label: { zh: "政务蓝", en: "Government Blue" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏正式政务汇报、政策解读和工作部署。", en: "Formal government reporting and policy rollout." },
    matchKeywords: ["政府", "政务", "政策", "汇报", "部署", "government", "policy", "public sector"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "government-red",
    label: { zh: "政务红", en: "Government Red" },
    styleKey: "ppt169_pritzker_2026",
    summary: { zh: "偏强主张政务表达和主题宣导。", en: "High-emphasis policy communication and thematic rollout." },
    matchKeywords: ["党建", "宣导", "政策", "主题", "government", "policy", "campaign"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "medical-university",
    label: { zh: "医学院", en: "Medical University" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏医学研究、临床结构和证据展示。", en: "Medical research, clinical structure, evidence-led." },
    matchKeywords: ["医疗", "医院", "医学院", "临床", "medical", "clinical", "healthcare"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "pixel-retro",
    label: { zh: "像素复古", en: "Pixel Retro" },
    styleKey: "ppt169_sugar_rush_memphis",
    summary: { zh: "偏游戏、年轻化和复古像素表达。", en: "Retro, youth, and game-adjacent presentation." },
    matchKeywords: ["像素", "复古", "游戏", "pixel", "retro", "gaming", "youthful"],
    scenarioHints: ["marketing-campaign", "training"],
  }),
  createFrontendTemplateOption({
    id: "psychology-attachment",
    label: { zh: "心理依恋", en: "Psychology Attachment" },
    styleKey: "ppt169_sugar_rush_memphis",
    summary: { zh: "偏心理主题、情绪表达和温和叙事。", en: "Gentle psychology and emotion-led storytelling." },
    matchKeywords: ["心理", "情绪", "咨询", "therapy", "psychology", "emotion"],
    scenarioHints: ["training", "marketing-campaign"],
  }),
  createFrontendTemplateOption({
    id: "deck-chongqing-university",
    label: { zh: "重庆大学", en: "Chongqing University" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏高校研究汇报和答辩感。", en: "University presentation and defense framing." },
    matchKeywords: ["重庆大学", "高校", "大学", "研究", "university", "academic"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "deck-china-telecom",
    label: { zh: "中国电信", en: "China Telecom" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏通信平台、网络体系和企业级汇报。", en: "Telecom platform and enterprise systems framing." },
    matchKeywords: ["电信", "通信", "运营商", "telecom", "network", "enterprise"],
    scenarioHints: ["product-launch", "sales-deck"],
  }),
  createFrontendTemplateOption({
    id: "deck-china-construction-modern",
    label: { zh: "中国电建·现代", en: "Power Construction Modern" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏工程项目、现代企业信息和结构化汇报。", en: "Modern infrastructure and project reporting." },
    matchKeywords: ["电建", "工程", "基建", "construction", "infrastructure", "energy"],
    scenarioHints: ["sales-deck", "product-launch"],
  }),
  createFrontendTemplateOption({
    id: "deck-china-construction-classic",
    label: { zh: "中国电建·常规", en: "Power Construction Classic" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏工程汇报、条线清晰和执行部署。", en: "Clear infrastructure reporting and execution planning." },
    matchKeywords: ["电建", "工程", "基建", "施工", "construction", "delivery"],
    scenarioHints: ["sales-deck", "training"],
  }),
  createFrontendTemplateOption({
    id: "deck-cmb",
    label: { zh: "招商银行", en: "China Merchants Bank" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏金融经营、风险和管理层复盘。", en: "Finance, risk, and board review framing." },
    matchKeywords: ["银行", "金融", "风险", "bank", "finance", "budget", "audit"],
    scenarioHints: ["sales-deck"],
  }),
  createFrontendTemplateOption({
    id: "deck-catarc-classic",
    label: { zh: "中汽研·常规", en: "CATARC Classic" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏汽车研究、评测汇报和常规企业版式。", en: "Automotive research and enterprise review framing." },
    matchKeywords: ["汽车", "车企", "研究院", "auto", "mobility", "research"],
    scenarioHints: ["sales-deck", "product-launch"],
  }),
  createFrontendTemplateOption({
    id: "deck-catarc-modern",
    label: { zh: "中汽研·现代", en: "CATARC Modern" },
    styleKey: "ppt169_swiss_grid_systems",
    summary: { zh: "偏汽车平台、现代指标和技术汇报。", en: "Modern automotive platform and metrics framing." },
    matchKeywords: ["汽车", "车企", "技术", "auto", "mobility", "platform"],
    scenarioHints: ["product-launch", "sales-deck"],
  }),
  createFrontendTemplateOption({
    id: "deck-catarc-business",
    label: { zh: "中汽研·商务", en: "CATARC Business" },
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    summary: { zh: "偏商务评审、经营纪要和决策支持。", en: "Business review and decision-support framing." },
    matchKeywords: ["商务", "评审", "经营", "business", "review", "decision"],
    scenarioHints: ["sales-deck"],
  }),
] as const satisfies ReadonlyArray<PptFrontendTemplateOption>

const knownPptFrontendTemplateIds = new Set(pptFrontendTemplateOptions.map((option) => option.id))

export const pptPreviewNarrativeAngles = [
  {
    id: "executive-brief",
    slotLabel: "A",
    label: { zh: "Executive Brief", en: "Executive Brief" },
    prompt: {
      zh: "把这一版写成适合管理层快速决策的 executive brief，优先给结论、风险和下一步。",
      en: "Write this version as an executive brief that prioritizes the call, risk posture, and immediate next steps.",
    },
  },
  {
    id: "campaign-story",
    slotLabel: "B",
    label: { zh: "Campaign Story", en: "Campaign Story" },
    prompt: {
      zh: "把这一版写成更有叙事节奏和受众牵引的 campaign story，强调场景、传播和说服路径。",
      en: "Write this version as a campaign story with stronger narrative momentum, audience pull, and persuasion pacing.",
    },
  },
  {
    id: "data-proof",
    slotLabel: "C",
    label: { zh: "Data Proof", en: "Data Proof" },
    prompt: {
      zh: "把这一版写成 data proof 视角，优先用证据、指标和对照关系支撑判断。",
      en: "Write this version from a data-proof angle that leans on evidence, metrics, and comparative support.",
    },
  },
  {
    id: "action-plan",
    slotLabel: "D",
    label: { zh: "Action Plan", en: "Action Plan" },
    prompt: {
      zh: "把这一版写成 action plan，优先说明执行顺序、负责人视角和落地动作。",
      en: "Write this version as an action plan that makes execution order, ownership, and rollout steps explicit.",
    },
  },
] as const satisfies ReadonlyArray<{
  id: PptPreviewNarrativeAngle
  slotLabel: "A" | "B" | "C" | "D"
  label: { zh: string; en: string }
  prompt: { zh: string; en: string }
}>

export const pptPreviewLayoutSequenceByPageCount: Readonly<Record<number, readonly PptPreviewLayout[]>> = {
  5: ["cover", "agenda", "insight", "comparison", "timeline"],
  7: ["cover", "agenda", "insight", "evidence", "stats", "process", "timeline"],
  9: ["cover", "agenda", "insight", "comparison", "evidence", "stats", "chart", "process", "timeline"],
} as const

const pptPreviewBaseLayoutsBeforeClosing: readonly PptPreviewLayout[] = [
  "cover",
  "agenda",
  "insight",
  "comparison",
  "evidence",
  "stats",
  "chart",
  "process",
] as const

const pptPreviewRepeatableMiddleLayouts: readonly PptPreviewLayout[] = [
  "insight",
  "comparison",
  "evidence",
  "stats",
  "chart",
  "process",
] as const

export const pptPreviewLayouts: readonly PptPreviewLayout[] = [
  "cover",
  "agenda",
  "insight",
  "comparison",
  "evidence",
  "stats",
  "chart",
  "process",
  "timeline",
] as const
const pptPreviewPageIntents: readonly PptPreviewPageIntent[] = [
  "cover",
  "contents",
  "statement",
  "spotlight",
  "comparison",
  "stats",
  "chart",
  "process",
  "closing",
] as const

export function isPptPreviewLayout(value: string): value is PptPreviewLayout {
  return (pptPreviewLayouts as readonly string[]).includes(value)
}

export function isPptPreviewPageIntent(value: string): value is PptPreviewPageIntent {
  return (pptPreviewPageIntents as readonly string[]).includes(value)
}

export function resolvePptPreviewSlideIntent(styleKey: PptPreviewStyleKey, layout: PptPreviewLayout): PptPreviewPageIntent {
  return pptPreviewStyleIntentMap[styleKey][layout]
}

export function resolvePptPreviewSlideLayout(styleKey: PptPreviewStyleKey, intent: PptPreviewPageIntent): PptPreviewLayout {
  const match = (Object.entries(pptPreviewStyleIntentMap[styleKey]) as Array<[PptPreviewLayout, PptPreviewPageIntent]>).find(
    ([, mappedIntent]) => mappedIntent === intent,
  )

  return match?.[0] ?? "timeline"
}

export function getPptPreviewStyleIntentSequence(styleKey: PptPreviewStyleKey): readonly PptPreviewPageIntent[] {
  return pptPreviewLayouts.map((layout) => pptPreviewStyleIntentMap[styleKey][layout])
}

export function getPptPreviewStyleSlots(styleKey: PptPreviewStyleKey) {
  return pptPreviewTemplateCapabilities[styleKey].slots
}

export function getPptPreviewStructuredFieldsForIntent(intent: PptPreviewPageIntent) {
  return [...pptPreviewStructuredFieldsByIntent[intent]]
}

export function getPptPreviewTemplateCapability(styleKey: PptPreviewStyleKey) {
  return pptPreviewTemplateCapabilities[styleKey]
}

export function getPptPreviewTemplateSlotByLayout(styleKey: PptPreviewStyleKey, layout: PptPreviewLayout) {
  return pptPreviewTemplateCapabilities[styleKey].slots.find((slot) => slot.layout === layout)
}

export function getPptPreviewTemplateSlotByIntent(styleKey: PptPreviewStyleKey, intent: PptPreviewPageIntent) {
  return pptPreviewTemplateCapabilities[styleKey].slots.find((slot) => slot.intent === intent)
}

export function resolveOptionalPptPreviewPageCount(value: unknown): PptPreviewPageCount | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value.trim(), 10) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(MIN_PPT_PREVIEW_PAGE_COUNT, Math.min(MAX_PPT_PREVIEW_PAGE_COUNT, Math.round(parsed)))
}

export function resolvePptPreviewPageCount(value: unknown, fallback = DEFAULT_PPT_PREVIEW_PAGE_COUNT): PptPreviewPageCount {
  return resolveOptionalPptPreviewPageCount(value) ?? fallback
}

export function getPptPreviewLayoutSequence(pageCount: PptPreviewPageCount | undefined | null): PptPreviewLayout[] {
  const resolvedPageCount = resolvePptPreviewPageCount(pageCount)
  const predefinedSequence = pptPreviewLayoutSequenceByPageCount[resolvedPageCount]
  if (predefinedSequence) {
    return [...predefinedSequence]
  }

  if (resolvedPageCount <= 1) {
    return ["cover"]
  }

  if (resolvedPageCount === 2) {
    return ["cover", "timeline"]
  }

  if (resolvedPageCount === 3) {
    return ["cover", "agenda", "timeline"]
  }

  const sequence: PptPreviewLayout[] = [
    ...pptPreviewBaseLayoutsBeforeClosing.slice(0, Math.min(resolvedPageCount - 1, pptPreviewBaseLayoutsBeforeClosing.length)),
  ]
  let repeatIndex = 0
  while (sequence.length < resolvedPageCount - 1) {
    sequence.push(pptPreviewRepeatableMiddleLayouts[repeatIndex % pptPreviewRepeatableMiddleLayouts.length]!)
    repeatIndex += 1
  }

  return [...sequence, "timeline"]
}

export function getPptPreviewStyleSlotSequence(styleKey: PptPreviewStyleKey, pageCount: PptPreviewPageCount | undefined | null) {
  return getPptPreviewLayoutSequence(pageCount)
    .map((layout) => getPptPreviewTemplateSlotByLayout(styleKey, layout))
    .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
}

export function resolvePptPreviewDeckPageCount(deck: Pick<PptPreviewDeck, "resolvedPageCount" | "pageCount" | "variants"> | null | undefined) {
  if (!deck) {
    return DEFAULT_PPT_PREVIEW_PAGE_COUNT
  }

  const variantSlideCount = Math.max(0, ...deck.variants.map((variant) => variant.slides.length))
  const fallbackCount = variantSlideCount > 0 ? variantSlideCount : deck.pageCount
  return resolvePptPreviewPageCount(deck.resolvedPageCount ?? fallbackCount)
}

export function resolvePptPreviewTemplateMode(request: Pick<PptPreviewRequest, "templateMode" | "templateId">) {
  if (request.templateMode === "single-template" && request.templateId) {
    return "single-template" as const
  }

  return "auto-4" as const
}

export function isKnownPptFrontendTemplateId(templateId: unknown): templateId is PptFrontendTemplateId {
  return typeof templateId === "string" && knownPptFrontendTemplateIds.has(templateId)
}

export function getPptFrontendTemplateOption(templateId: PptFrontendTemplateId) {
  return pptFrontendTemplateOptions.find((option) => option.id === templateId)
}

export function getPptPreviewStyleKeyByTemplateId(templateId: PptFrontendTemplateId) {
  if (isKnownPptPreviewStyleKey(templateId)) {
    return templateId
  }

  return (
    getPptFrontendTemplateOption(templateId)?.styleKey ??
    resolvePptMasterTemplateStyleKey(templateId)
  ) as PptPreviewStyleKey | null
}

export function getPptPreviewNarrativeAngleOption(angle: PptPreviewNarrativeAngle) {
  return pptPreviewNarrativeAngles.find((item) => item.id === angle)
}

export function getPptPreviewTemplateLabel(templateId: PptFrontendTemplateId, language: PptLanguage) {
  const option = getPptFrontendTemplateOption(templateId)
  if (!option) return templateId
  return language === "zh-CN" ? option.label.zh : option.label.en
}

export function getPptPreviewNarrativeAngleLabel(angle: PptPreviewNarrativeAngle, language: PptLanguage) {
  const option = getPptPreviewNarrativeAngleOption(angle)
  if (!option) return angle
  return language === "zh-CN" ? option.label.zh : option.label.en
}

export function getPptPreviewNarrativeAnglePrompt(angle: PptPreviewNarrativeAngle, language: PptLanguage) {
  const option = getPptPreviewNarrativeAngleOption(angle)
  if (!option) return ""
  return language === "zh-CN" ? option.prompt.zh : option.prompt.en
}

function normalizeTemplateMatchText(value: string) {
  return value.trim().toLowerCase()
}

function collectPptTemplateMatchText(request: PptPreviewRequest) {
  const segments = [request.prompt]

  if (typeof request.researchBrief === "string") {
    segments.push(request.researchBrief)
  } else if (request.researchBrief && typeof request.researchBrief === "object") {
    const research = request.researchBrief
    segments.push(research.topic)
    segments.push(...(research.keyFacts || []))
    segments.push(...(research.numericEvidence || []))
    segments.push(...(research.risks || []))
    segments.push(...(research.implications || []))
    segments.push(...(research.sourceNotes || []))
    if (research.rawSummary) {
      segments.push(research.rawSummary)
    }
  }

  return normalizeTemplateMatchText(segments.filter(Boolean).join("\n"))
}

function includesAnyKeyword(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

function scorePptPreviewStyleForRequest(
  request: PptPreviewRequest,
  styleKey: PptPreviewStyleKey,
  text: string,
) {
  let score = 0
  // Keep legacy auto-4 ranking stable while selected templates use their own
  // visual archetype in the ppt-master runtime.
  const archetype =
    styleKey === "ppt169_building_effective_agents"
      ? "ppt169_swiss_grid_systems"
      : resolvePptPreviewStyleArchetype(styleKey)

  const addIfMatched = (keywords: readonly string[], points: number) => {
    if (includesAnyKeyword(text, keywords)) {
      score += points
    }
  }

  const scenarioWeights: Record<PptScenario, Record<PptPreviewStyleArchetype, number>> = {
    "marketing-campaign": {
      "ppt169_brutalist_ai_newspaper_2026": 1,
      "ppt169_sugar_rush_memphis": 3,
      "ppt169_pritzker_2026": 4,
      "ppt169_building_effective_agents": 2,
      "ppt169_swiss_grid_systems": 2,
    },
    "product-launch": {
      "ppt169_brutalist_ai_newspaper_2026": 1,
      "ppt169_sugar_rush_memphis": 2,
      "ppt169_pritzker_2026": 3,
      "ppt169_building_effective_agents": 4,
      "ppt169_swiss_grid_systems": 4,
    },
    "sales-deck": {
      "ppt169_brutalist_ai_newspaper_2026": 3,
      "ppt169_sugar_rush_memphis": 1,
      "ppt169_pritzker_2026": 2,
      "ppt169_building_effective_agents": 4,
      "ppt169_swiss_grid_systems": 4,
    },
    training: {
      "ppt169_brutalist_ai_newspaper_2026": 3,
      "ppt169_sugar_rush_memphis": 3,
      "ppt169_pritzker_2026": 1,
      "ppt169_building_effective_agents": 2,
      "ppt169_swiss_grid_systems": 2,
    },
  }

  score += scenarioWeights[request.scenario]?.[archetype] ?? 0

  const executiveKeywords = [
    "董事会",
    "管理层",
    "高层",
    "复盘",
    "汇报",
    "经营",
    "诊断",
    "审计",
    "合规",
    "风险",
    "财务",
    "预算",
    "纪要",
    "决策",
    "board",
    "executive",
    "leadership",
    "review",
    "retro",
    "retrospective",
    "memo",
    "diagnosis",
    "audit",
    "compliance",
    "risk",
    "finance",
    "budget",
    "decision",
    "briefing",
  ] as const
  const analyticalKeywords = [
    "产品",
    "策略",
    "咨询",
    "分析",
    "数据",
    "指标",
    "市场",
    "行业",
    "竞品",
    "路线图",
    "流程",
    "平台",
    "saas",
    "product",
    "strategy",
    "consulting",
    "analysis",
    "metric",
    "metrics",
    "kpi",
    "benchmark",
    "comparison",
    "market",
    "industry",
    "competitor",
    "roadmap",
    "workflow",
    "dashboard",
    "platform",
    "funnel",
  ] as const
  const playfulKeywords = [
    "品牌",
    "活动",
    "教育",
    "培训",
    "课程",
    "社区",
    "年轻",
    "亲和",
    "故事",
    "内容",
    "社媒",
    "小红书",
    "抖音",
    "节日",
    "创作者",
    "brand",
    "event",
    "education",
    "training",
    "community",
    "story",
    "content",
    "social",
    "launch",
    "friendly",
    "playful",
    "festival",
    "creator",
    "campaign",
  ] as const
  const broadsideKeywords = [
    "宣言",
    "主张",
    "海报",
    "发布",
    "战役",
    "引爆",
    "视觉",
    "口号",
    "演讲",
    "主题发布",
    "英雄",
    "宣发",
    "manifesto",
    "poster",
    "announcement",
    "declaration",
    "hero",
    "slogan",
    "speech",
    "keynote",
    "big idea",
    "rally",
  ] as const
  const factualKeywords = [
    "现状",
    "最新",
    "趋势",
    "政策",
    "法规",
    "融资",
    "财报",
    "业绩",
    "地缘",
    "战争",
    "制裁",
    "供应链",
    "油价",
    "汇率",
    "latest",
    "current state",
    "policy",
    "regulation",
    "earnings",
    "geopolitical",
    "supply chain",
    "tariff",
    "market",
  ] as const
  const seriousToneKeywords = [
    "正式",
    "严肃",
    "理性",
    "专业",
    "商务",
    "稳重",
    "formal",
    "serious",
    "professional",
    "business",
    "boardroom",
  ] as const
  const energeticToneKeywords = [
    "活泼",
    "轻松",
    "明亮",
    "年轻化",
    "有趣",
    "冲击",
    "energetic",
    "bright",
    "youthful",
    "fun",
    "bold",
    "impactful",
  ] as const

  if (archetype === "ppt169_brutalist_ai_newspaper_2026") {
    addIfMatched(executiveKeywords, 6)
    addIfMatched(analyticalKeywords, 2)
    addIfMatched(factualKeywords, 4)
    addIfMatched(seriousToneKeywords, 3)
  }

  if (archetype === "ppt169_swiss_grid_systems") {
    addIfMatched(analyticalKeywords, 6)
    addIfMatched(executiveKeywords, 3)
    addIfMatched(factualKeywords, 4)
    addIfMatched(seriousToneKeywords, 2)
  }

  if (archetype === "ppt169_sugar_rush_memphis") {
    addIfMatched(playfulKeywords, 6)
    addIfMatched(energeticToneKeywords, 4)
    addIfMatched(broadsideKeywords, 1)
  }

  if (archetype === "ppt169_pritzker_2026") {
    addIfMatched(broadsideKeywords, 6)
    addIfMatched(playfulKeywords, 2)
    addIfMatched(energeticToneKeywords, 3)
  }

  if (request.researchBrief && typeof request.researchBrief === "object") {
    const research = request.researchBrief
    const numericSignalCount = (research.numericEvidence?.length ?? 0) + (research.keyFacts?.length ?? 0)
    if (numericSignalCount > 0) {
      if (archetype === "ppt169_swiss_grid_systems") score += 3
      if (archetype === "ppt169_brutalist_ai_newspaper_2026") score += 2
    }
  }

  return score
}

function countMatchedTemplateKeywords(text: string, keywords: readonly string[] | undefined) {
  if (!keywords?.length) return 0
  let matches = 0
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      matches += 1
    }
  }
  return matches
}

function scorePptFrontendTemplateOptionForRequest(
  request: PptPreviewRequest,
  option: PptFrontendTemplateOption,
  text: string,
) {
  const styleScore = scorePptPreviewStyleForRequest(request, option.styleKey, text)
  const keywordMatches = countMatchedTemplateKeywords(text, option.matchKeywords)
  const scenarioBonus = option.scenarioHints?.includes(request.scenario) ? 2 : 0
  const keywordBonus = keywordMatches > 0 ? keywordMatches * 6 : 0
  return styleScore * 4 + keywordBonus + scenarioBonus + (option.priority ?? 0)
}

export function buildPptPreviewVariantDescriptors(request: PptPreviewRequest): PptPreviewVariantDescriptor[] {
  const templateMode = resolvePptPreviewTemplateMode(request)

  if (templateMode === "single-template" && request.templateId) {
    const styleKey = getPptPreviewStyleKeyByTemplateId(request.templateId)
    const style = styleKey ? getPptPreviewStyleByKey(styleKey) : null
    if (style) {
      const narrativeAngles = request.narrativeAngle
        ? pptPreviewNarrativeAngles.filter((angle) => angle.id === request.narrativeAngle)
        : pptPreviewNarrativeAngles

      return narrativeAngles.map((angle, index) => ({
        key: `${request.templateId}-${angle.id}`,
        slotLabel: (["A", "B", "C", "D"][index] ?? angle.slotLabel) as "A" | "B" | "C" | "D",
        style,
        templateId: request.templateId as PptFrontendTemplateId,
        narrativeAngle: angle.id,
      }))
    }
  }

  const matchText = collectPptTemplateMatchText(request)
  const slotLabels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"]
  const ranked = pptFrontendTemplateOptions
    .map((option, index) => ({
      option,
      score: scorePptFrontendTemplateOptionForRequest(request, option, matchText),
      originalIndex: index,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.originalIndex - right.originalIndex
    })

  const selected: typeof ranked = []
  const usedStyleKeys = new Set<PptPreviewStyleKey>()
  for (const candidate of ranked) {
    if (usedStyleKeys.has(candidate.option.styleKey)) continue
    selected.push(candidate)
    usedStyleKeys.add(candidate.option.styleKey)
    if (selected.length === 4) break
  }

  if (selected.length < 4) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.option.id === candidate.option.id)) continue
      selected.push(candidate)
      if (selected.length === 4) break
    }
  }

  return selected.map(({ option }, index) => {
      const style = getPptPreviewStyleByKey(option.styleKey)
      if (!style) {
        throw new Error(`ppt_preview_style_missing:${option.styleKey}`)
      }

      return {
        key: option.id,
      slotLabel: slotLabels[index] ?? "D",
      style,
        templateId: option.id,
      }
    })
}

export function buildPptRecommendedTemplateSummaries(
  request: PptPreviewRequest,
  options?: {
    allowedTemplateIds?: readonly string[]
  },
): PptRecommendedTemplateSummary[] {
  const matchText = collectPptTemplateMatchText(request)
  const allowedTemplateIds = options?.allowedTemplateIds?.length
    ? new Set(options.allowedTemplateIds)
    : null
  const ranked = pptFrontendTemplateOptions
    .filter((option) => !allowedTemplateIds || allowedTemplateIds.has(option.id))
    .map((option, index) => ({
      option,
      index,
      score: scorePptFrontendTemplateOptionForRequest(request, option, matchText),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })

  const selected: typeof ranked = []
  const usedStyleKeys = new Set<PptPreviewStyleKey>()
  for (const candidate of ranked) {
    if (usedStyleKeys.has(candidate.option.styleKey)) continue
    selected.push(candidate)
    usedStyleKeys.add(candidate.option.styleKey)
    if (selected.length === 4) break
  }

  if (selected.length < 4) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.option.id === candidate.option.id)) continue
      selected.push(candidate)
      if (selected.length === 4) break
    }
  }

  return selected.map(({ option }, index) => {
    const style = getPptPreviewStyleByKey(option.styleKey)
    return {
      rank: index + 1,
      templateId: option.id,
      templateLabel: getPptPreviewTemplateLabel(option.id, request.language),
      styleKey: option.styleKey,
      styleName: style?.name ?? option.label.en,
      summary: request.language === "zh-CN" ? option.summary.zh : option.summary.en,
    }
  })
}

export function buildPptPreviewIntentSequenceLabel(
  styleKey: PptPreviewStyleKey,
  language: PptLanguage,
  pageCount?: PptPreviewPageCount | null,
) {
  const sequence = pageCount
    ? getPptPreviewStyleSlotSequence(styleKey, pageCount).map((slot) => slot.intent)
    : getPptPreviewStyleIntentSequence(styleKey)
  const zhLabels: Record<PptPreviewPageIntent, string> = {
    cover: "封面",
    contents: "目录",
    statement: "宣言页",
    spotlight: "高亮观点页",
    comparison: "对照页",
    stats: "数据页",
    chart: "图表页",
    process: "流程页",
    closing: "结束页",
  }
  const enLabels: Record<PptPreviewPageIntent, string> = {
    cover: "cover",
    contents: "contents",
    statement: "statement",
    spotlight: "spotlight",
    comparison: "comparison",
    stats: "stats",
    chart: "chart",
    process: "process",
    closing: "closing",
  }

  const labels = language === "zh-CN" ? zhLabels : enLabels
  return sequence.map((intent) => labels[intent]).join(" -> ")
}

export function buildPptPreviewTemplateCapabilityLabel(styleKey: PptPreviewStyleKey, language: PptLanguage) {
  const slots = getPptPreviewStyleSlots(styleKey)

  return slots
    .map((slot) => {
      const fields = slot.structuredFields.join(", ")
      const fallback = slot.fallbackIntents?.join(" -> ") ?? ""
      if (language === "zh-CN") {
        return `${slot.layout}/${slot.intent}: ${slot.nativePageType} | 结构字段: ${fields}${fallback ? ` | 退化来源: ${fallback}` : ""}`
      }
      return `${slot.layout}/${slot.intent}: ${slot.nativePageType} | structured fields: ${fields}${fallback ? ` | fallback sources: ${fallback}` : ""}`
    })
    .join("\n")
}

export const pptScenarioOptions: Array<{ value: PptScenario; label: string; description: string }> = [
  { value: "marketing-campaign", label: "营销策划", description: "适合增长活动、内容营销和渠道方案" },
  { value: "product-launch", label: "产品发布", description: "适合新品发布、定位表达和 GTM 介绍" },
  { value: "sales-deck", label: "销售提案", description: "适合方案销售、客户提案和商务沟通" },
  { value: "training", label: "培训课件", description: "适合入门培训、知识沉淀和内部分享" },
]

export const pptLanguageOptions: Array<{ value: PptLanguage; label: string }> = [
  { value: "zh-CN", label: "中文" },
  { value: "en-US", label: "English" },
]

export const pptPreviewModelOptions: Array<{
  value: PptPreviewModelValue
  label: string
  provider: "deepseek" | "minimax" | "pptoken" | "stepfun"
  description: string
}> = [
  {
    value: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    description: "内容规划优先，适合可编辑 PPT 的默认方案生成。",
  },
  {
    value: "MiniMax-M2.7-highspeed",
    label: "MiniMax M2.7 Highspeed",
    provider: "minimax",
    description: "速度优先，适合 4 份并行预览。",
  },
  {
    value: "MiniMax-M3",
    label: "MiniMax M3",
    provider: "minimax",
    description: "推理更重，适合更强表达但通常更慢。",
  },
  {
    value: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "pptoken",
    description: "通过 pptoken 路由，速度优先，适合作为默认模型。",
  },
  {
    value: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "pptoken",
    description: "通过 pptoken 路由，适合结构化分析和方案表达。",
  },
  {
    value: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "pptoken",
    description: "通过 pptoken 路由，适合高质量内容规划。",
  },
  {
    value: "step-3.7-flash",
    label: "Step 3.7 Flash",
    provider: "stepfun",
    description: "通过阶跃星辰直连路由，适合并发生成耗时测试。",
  },
]

export const pptPreviewRuntimeOptions: Array<{
  value: PptPreviewRuntimeValue
  label: string
  description: string
}> = [
  {
    value: "frontend-slides-agent",
    label: "HTML PPT",
    description: "输出 HTML 版 PPT，适合预览、分享和快速确认版式。",
  },
  {
    value: "ppt-master-agent",
    label: "Editable PPT",
    description: "输出可编辑 PPT，适合正式交付和继续修改。",
  },
]

export const pptPreviewStyles: readonly PptPreviewVariantStyle[] = [
  {
    key: "ppt169_brutalist_ai_newspaper_2026",
    name: "Long Table",
    summary: "frontend-slides 的长桌纪要模板，规则线、分栏和议题感最强，适合董事会汇报、策略复盘和结构化叙事。",
    stylePrompt:
      "Use the Long Table preset. Write like a chaired long-table review with ruled sections, moderated discussion logic, meeting-grade clarity, and explicit conclusions from each agenda block.",
    palette: {
      background: "#FAF1E2",
      foreground: "#B53D2A",
      accent: "#B53D2A",
      panel: "#FFF7EC",
      border: "#D9BCA6",
    },
    strengths: ["结构强", "议题感", "桌面纪要"],
  },
  {
    key: "ppt169_sugar_rush_memphis",
    name: "Playful",
    summary: "frontend-slides 的轻快玩味模板，圆角、浮动贴纸和高亮色块最强，适合发布、教育和品牌故事。",
    stylePrompt:
      "Use the Playful preset. Write with springy momentum, bright hooks, floating highlights, friendly rhythm, and punchy but still commercially useful storytelling.",
    palette: {
      background: "#F0C8A0",
      foreground: "#1A1A1A",
      accent: "#1A1A1A",
      panel: "#F7DEC6",
      border: "#D29A6F",
    },
    strengths: ["轻快节奏", "圆角贴纸", "亲和力强"],
  },
  {
    key: "ppt169_pritzker_2026",
    name: "Broadside",
    summary: "frontend-slides 的告示海报模板，大字号、强栏位和印刷张力最强，适合观点宣言、campaign 和冲击型表达。",
    stylePrompt:
      "Use the Broadside preset. Write like a printed broadside with oversized declarations, stark contrast, poster-grade urgency, and memorable one-line verdicts anchored by supporting columns.",
    palette: {
      background: "#111111",
      foreground: "#F0ECE5",
      accent: "#E85D26",
      panel: "#1A1A18",
      border: "#282826",
    },
    strengths: ["大标题", "印刷感", "宣言式表达"],
  },
  {
    key: "ppt169_swiss_grid_systems",
    name: "Neo-Grid Bold",
    summary: "frontend-slides 的新网格粗体模板，可见网格、强对比模块和现代策略界面感最强，适合产品、咨询和分析型 deck。",
    stylePrompt:
      "Use the Neo-Grid Bold preset. Write with visible-grid discipline, modular boldness, sharp section labels, and decisive strategy language that feels contemporary rather than archival.",
    palette: {
      background: "#ECECE8",
      foreground: "#0A0A0A",
      accent: "#E6FF3D",
      panel: "#F5F4EF",
      border: "#CFCFC8",
    },
    strengths: ["可见网格", "现代策略感", "粗体模块"],
  },
  {
    key: "ppt169_glassmorphism_demo",
    name: "Glassmorphism Demo",
    summary: "来自 ppt-master 的玻璃拟态演示风格，半透明面板、柔和高光和产品级仪表盘感更强，适合 AI 工具、SaaS 和系统能力展示。",
    stylePrompt:
      "Use the Glassmorphism Demo preset. Write with translucent product panels, layered signal cards, clear product framing, and polished AI-tool launch language.",
    palette: {
      background: "#EAF4FF",
      foreground: "#132033",
      accent: "#5E8BFF",
      panel: "#F8FBFF",
      border: "#BFD3F6",
    },
    strengths: ["玻璃面板", "产品演示", "AI 工具感"],
  },
  {
    key: "ppt169_attention_is_all_you_need",
    name: "Attention Research",
    summary: "来自 ppt-master 的研究论文风格，更强调方法图解、实验结果和学术答辩式证明链路，适合论文、研究汇报和技术分享。",
    stylePrompt:
      "Use the Attention Research preset. Write like a research defense with method framing, experiment logic, evidence-first sequencing, and restrained academic confidence.",
    palette: {
      background: "#F2F1EC",
      foreground: "#111111",
      accent: "#C63F1C",
      panel: "#FBFAF6",
      border: "#D7D1C4",
    },
    strengths: ["研究证明", "方法图解", "答辩结构"],
  },
  {
    key: "ppt169_building_effective_agents",
    name: "Effective Agents",
    summary: "来自 ppt-master 的 Agent 系统风格，强调能力分层、编排链路和运行机制，适合智能体平台、工作流和架构型 deck。",
    stylePrompt:
      "Use the official ppt-master Effective Agents preset. Preserve its dark technical theme: deep #0F1117 canvas, #1A1D27 structural panels, light #E8E8EC typography, Anthropic-inspired coral #D4845A for primary emphasis, cool blue #5B9BD5 for workflow signals, warm gold #E8B87D for secondary emphasis, and #2D3348 dividers. Use Helvetica Neue/Arial-style technical typography, capability layers, orchestration maps, system decomposition, and operator-friendly execution language. Never switch to a light background, neon green accents, Swiss Grid styling, or a generic SaaS palette.",
    palette: {
      background: "#0F1117",
      foreground: "#E8E8EC",
      accent: "#D4845A",
      panel: "#1A1D27",
      border: "#2D3348",
    },
    strengths: ["Agent 编排", "能力拆解", "架构叙事"],
  },
  {
    key: "ppt169_cangzhuo",
    name: "Cangzhuo",
    summary: "来自 ppt-master 的中文管理层纪要风格，议题清单、条线复盘和执行部署感更强，适合经营复盘、工作汇报和会议纪要型 deck。",
    stylePrompt:
      "Use the Cangzhuo preset. Write with Chinese executive memo discipline, agenda-led reasoning, compact action notes, and meeting-grade clarity.",
    palette: {
      background: "#F7F1E8",
      foreground: "#7A3123",
      accent: "#B14B32",
      panel: "#FFF8EF",
      border: "#D7BEAA",
    },
    strengths: ["中文纪要", "经营复盘", "执行部署"],
  },
  {
    key: "ppt169_fashion_weekly_digest",
    name: "Fashion Weekly Digest",
    summary: "来自 ppt-master 的美学周鉴风格，编辑感、趋势策展和杂志节奏更强，适合时尚、品牌和内容策划型 deck。",
    stylePrompt:
      "Use the Fashion Weekly Digest preset. Write like an editorial trend issue with curation rhythm, visual hooks, and fashion-forward story pacing.",
    palette: {
      background: "#171412",
      foreground: "#F7E7D8",
      accent: "#FF8B61",
      panel: "#231D19",
      border: "#43362E",
    },
    strengths: ["潮流策展", "杂志节奏", "时尚编辑"],
  },
  {
    key: "ppt169_general_dark_tech_claude_code_auto_mode",
    name: "General Dark Tech",
    summary: "来自 ppt-master 的暗色科技风格，适合技术系统、开发者产品和深色高对比表达。",
    stylePrompt:
      "Use the General Dark Tech preset. Write with technical confidence, dark product contrast, system decomposition, and engineering-facing clarity.",
    palette: {
      background: "#0D0F12",
      foreground: "#F2F2F0",
      accent: "#F06C3B",
      panel: "#171B21",
      border: "#2B3139",
    },
    strengths: ["暗色科技", "系统拆解", "开发者气质"],
  },
  {
    key: "ppt169_global_ai_capital_2026",
    name: "Global AI Capital",
    summary: "来自 ppt-master 的全球 AI 资本风格，更偏行业格局、融资判断和管理层纪要，适合市场、投资和高层决策型汇报。",
    stylePrompt:
      "Use the Global AI Capital preset. Write like a board-facing capital markets brief with market structure, investment logic, and explicit strategic implications.",
    palette: {
      background: "#F7F0E3",
      foreground: "#772919",
      accent: "#C84A23",
      panel: "#FFF8EE",
      border: "#D9BEA5",
    },
    strengths: ["资本叙事", "行业格局", "高层纪要"],
  },
  {
    key: "ppt169_high_rise_renewal",
    name: "High Rise Renewal",
    summary: "来自 ppt-master 的高楼更新风格，适合建筑方案、城市更新和空间叙事类 deck。",
    stylePrompt:
      "Use the High Rise Renewal preset. Write like an urban-renewal proposal with architectural framing, transformation logic, and editorial support panels.",
    palette: {
      background: "#12100F",
      foreground: "#F1E6D8",
      accent: "#D96E45",
      panel: "#211B18",
      border: "#3E332D",
    },
    strengths: ["城市更新", "建筑方案", "空间叙事"],
  },
  {
    key: "ppt169_home_design_trends_2026",
    name: "Home Design Trends",
    summary: "来自 ppt-master 的家居趋势风格，适合生活方式内容、审美趋势和家居设计策展。",
    stylePrompt:
      "Use the Home Design Trends preset. Write with lifestyle curation, trend interpretation, and interior-design storytelling that feels polished and editorial.",
    palette: {
      background: "#F5EFE7",
      foreground: "#2E2722",
      accent: "#B98053",
      panel: "#FCF8F2",
      border: "#D9C8B8",
    },
    strengths: ["家居趋势", "生活方式", "审美策展"],
  },
  {
    key: "ppt169_image_text_showcase",
    name: "Image Text Showcase",
    summary: "来自 ppt-master 的图文陈列风格，更强调作品展示、图文并置和 portfolio 节奏。",
    stylePrompt:
      "Use the Image Text Showcase preset. Write with portfolio discipline, image-caption balance, modular showcase structure, and concise explanatory text.",
    palette: {
      background: "#F1F0EB",
      foreground: "#141414",
      accent: "#D44B2B",
      panel: "#FBFAF5",
      border: "#D2CEC3",
    },
    strengths: ["图文并置", "作品展示", "Portfolio 节奏"],
  },
  {
    key: "ppt169_indie_bookstore_zine_guide",
    name: "Indie Bookstore Zine",
    summary: "来自 ppt-master 的独立书店 zine 风格，编辑感、策展节奏和海报化排版更强，适合文化品牌、策展内容和故事型发布。",
    stylePrompt:
      "Use the Indie Bookstore Zine preset. Write like a curated editorial zine with culture-led framing, poster tension, and guided but intimate storytelling.",
    palette: {
      background: "#181512",
      foreground: "#F3E8D7",
      accent: "#D96C3D",
      panel: "#221D19",
      border: "#3A3029",
    },
    strengths: ["编辑策展", "杂志叙事", "文化品牌"],
  },
  {
    key: "ppt169_kimsoong_loyalty_programme",
    name: "Loyalty Programme",
    summary: "来自 ppt-master 的会员忠诚计划风格，适合 CRM、会员体系、活动权益和品牌运营方案。",
    stylePrompt:
      "Use the Loyalty Programme preset. Write with member-journey clarity, campaign warmth, branded offer framing, and retention-focused action steps.",
    palette: {
      background: "#F5D8B6",
      foreground: "#1E1B19",
      accent: "#D96C3F",
      panel: "#FBE8D0",
      border: "#D2A57A",
    },
    strengths: ["会员运营", "品牌活动", "留存叙事"],
  },
  {
    key: "ppt169_kubernetes_blueprint_2026",
    name: "Kubernetes Blueprint",
    summary: "来自 ppt-master 的 Kubernetes 蓝图风格，更适合云原生平台、基础设施架构和技术治理型 deck。",
    stylePrompt:
      "Use the Kubernetes Blueprint preset. Write with platform architecture clarity, infrastructure modules, governance rails, and technical rollout sequencing.",
    palette: {
      background: "#EEF1EF",
      foreground: "#11161B",
      accent: "#88C0FF",
      panel: "#F8FBF9",
      border: "#C8D3CF",
    },
    strengths: ["云原生架构", "平台蓝图", "技术治理"],
  },
  {
    key: "ppt169_lin_huiyin_architect",
    name: "Lin Huiyin Architect",
    summary: "来自 ppt-master 的林徽因建筑人物风格，适合建筑人物、文化专题和编辑式传记叙事。",
    stylePrompt:
      "Use the Lin Huiyin Architect preset. Write as an editorial cultural profile with architectural context, biography rhythm, and poster-like emphasis.",
    palette: {
      background: "#161311",
      foreground: "#F3E8DC",
      accent: "#C67248",
      panel: "#231C18",
      border: "#42352E",
    },
    strengths: ["建筑人物", "文化专题", "传记编辑感"],
  },
  {
    key: "ppt169_lin_huiyin_architect_revised",
    name: "Lin Huiyin Architect Revised",
    summary: "来自 ppt-master 的林徽因建筑修订版风格，保留文化人物叙事，但支撑页更紧凑。",
    stylePrompt:
      "Use the Lin Huiyin Architect Revised preset. Keep the editorial architecture biography framing while tightening supporting context and evidence blocks.",
    palette: {
      background: "#191513",
      foreground: "#F1E7DA",
      accent: "#D17B55",
      panel: "#261F1A",
      border: "#453730",
    },
    strengths: ["文化修订版", "建筑传记", "支撑页更紧"],
  },
  {
    key: "ppt169_liziqi_plant_dye_colors",
    name: "Plant Dye Colors",
    summary: "来自 ppt-master 的植物染色风格，色彩温和、叙事柔软、手作质感明显，适合生活方式品牌、文化内容和审美表达。",
    stylePrompt:
      "Use the Plant Dye Colors preset. Write with gentle craft storytelling, tactile lifestyle cues, calm pacing, and a color-led sense of refinement.",
    palette: {
      background: "#F4E8D8",
      foreground: "#2B241E",
      accent: "#7F9A5D",
      panel: "#FBF6EE",
      border: "#D9C7B5",
    },
    strengths: ["生活方式", "柔和色彩", "手作气质"],
  },
  {
    key: "ppt169_lora_hu_2021",
    name: "Lora Hu 2021",
    summary: "来自 ppt-master 的创作者作品集风格，适合个人品牌、作品展示和温和生活方式叙事。",
    stylePrompt:
      "Use the Lora Hu 2021 preset. Write with creator-portfolio pacing, softer personal-brand storytelling, and intimate but polished lifestyle framing.",
    palette: {
      background: "#F3E4D8",
      foreground: "#2A221E",
      accent: "#B86D59",
      panel: "#FBF3EC",
      border: "#D6C0B3",
    },
    strengths: ["个人品牌", "作品集", "创作者叙事"],
  },
] as const

const pptPreviewStyleSummaries: Record<PptPreviewStyleKey, { zh: string; en: string }> = {
  "ppt169_brutalist_ai_newspaper_2026": {
    zh: "frontend-slides 的长桌纪要模板，规则线、分栏和议题感最强，适合董事会汇报、策略复盘和结构化叙事。",
    en: "A frontend-slides long-table review preset with ruled sections, strong agenda structure, and board-style narrative clarity.",
  },
  "ppt169_sugar_rush_memphis": {
    zh: "frontend-slides 的轻快玩味模板，圆角、浮动贴纸和高亮色块最强，适合发布、教育和品牌故事。",
    en: "A frontend-slides playful preset with rounded geometry, floating sticker energy, and bright highlight blocks for launches and brand stories.",
  },
  "ppt169_pritzker_2026": {
    zh: "frontend-slides 的告示海报模板，大字号、强栏位和印刷张力最强，适合观点宣言、campaign 和冲击型表达。",
    en: "A frontend-slides broadside poster preset with oversized type, strong columns, and print tension for bold declarations and campaign statements.",
  },
  "ppt169_swiss_grid_systems": {
    zh: "frontend-slides 的新网格粗体模板，可见网格、强对比模块和现代策略界面感最强，适合产品、咨询和分析型 deck。",
    en: "A frontend-slides neo-grid preset with visible rails, high-contrast modules, and a contemporary strategy-interface feel for analytical decks.",
  },
  "ppt169_glassmorphism_demo": {
    zh: "来自 ppt-master 的玻璃拟态演示风格，半透明面板、柔和高光和产品级仪表盘感更强，适合 AI 工具和 SaaS 展示。",
    en: "A ppt-master glassmorphism preset with translucent panels, soft glow, and polished product-demo energy for AI tools and SaaS decks.",
  },
  "ppt169_attention_is_all_you_need": {
    zh: "来自 ppt-master 的研究论文风格，更强调方法图解、实验结果和学术答辩式证明链路。",
    en: "A ppt-master research preset that emphasizes method diagrams, experiment proof, and academic-defense sequencing.",
  },
  "ppt169_building_effective_agents": {
    zh: "来自 ppt-master 的 Agent 系统风格，强调能力分层、编排链路和运行机制。",
    en: "A ppt-master agent-systems preset centered on capability layers, orchestration flow, and operating-model clarity.",
  },
  "ppt169_cangzhuo": {
    zh: "来自 ppt-master 的中文管理层纪要风格，议题清单、条线复盘和执行部署感更强。",
    en: "A ppt-master Chinese executive memo preset with agenda-led review, business-line recap, and rollout-oriented execution notes.",
  },
  "ppt169_fashion_weekly_digest": {
    zh: "来自 ppt-master 的美学周鉴风格，编辑感、趋势策展和杂志节奏更强。",
    en: "A ppt-master editorial trend digest preset with curation rhythm, fashion cues, and magazine-style sequencing.",
  },
  "ppt169_general_dark_tech_claude_code_auto_mode": {
    zh: "来自 ppt-master 的暗色科技风格，适合技术系统、开发者产品和高对比表达。",
    en: "A ppt-master dark-tech preset for technical systems, developer products, and high-contrast product storytelling.",
  },
  "ppt169_global_ai_capital_2026": {
    zh: "来自 ppt-master 的全球 AI 资本风格，更偏行业格局、融资判断和管理层纪要。",
    en: "A ppt-master capital-markets preset for industry shifts, investment framing, and board-facing AI market briefs.",
  },
  "ppt169_high_rise_renewal": {
    zh: "来自 ppt-master 的高楼更新风格，适合建筑方案、城市更新和空间叙事类 deck。",
    en: "A ppt-master urban-renewal preset for architectural proposals, city transformation, and spatial storytelling.",
  },
  "ppt169_home_design_trends_2026": {
    zh: "来自 ppt-master 的家居趋势风格，适合生活方式内容、审美趋势和家居设计策展。",
    en: "A ppt-master home-design trend preset for lifestyle content, aesthetic curation, and interior-design storytelling.",
  },
  "ppt169_image_text_showcase": {
    zh: "来自 ppt-master 的图文陈列风格，更强调作品展示、图文并置和 portfolio 节奏。",
    en: "A ppt-master image-text showcase preset that emphasizes portfolio pacing, image-caption balance, and modular gallery structure.",
  },
  "ppt169_indie_bookstore_zine_guide": {
    zh: "来自 ppt-master 的独立书店 zine 风格，编辑感、策展节奏和海报化排版更强。",
    en: "A ppt-master editorial zine preset with curation rhythm, poster tension, and culture-led storytelling.",
  },
  "ppt169_kimsoong_loyalty_programme": {
    zh: "来自 ppt-master 的会员忠诚计划风格，适合 CRM、会员体系和品牌运营方案。",
    en: "A ppt-master loyalty-program preset for CRM, membership systems, and branded retention planning.",
  },
  "ppt169_kubernetes_blueprint_2026": {
    zh: "来自 ppt-master 的 Kubernetes 蓝图风格，更适合云原生平台、基础设施架构和技术治理型 deck。",
    en: "A ppt-master Kubernetes blueprint preset for cloud-native platforms, infrastructure architecture, and technical governance.",
  },
  "ppt169_lin_huiyin_architect": {
    zh: "来自 ppt-master 的林徽因建筑人物风格，适合建筑人物、文化专题和编辑式传记叙事。",
    en: "A ppt-master architectural profile preset for cultural biography, editorial framing, and architecture-led storytelling.",
  },
  "ppt169_lin_huiyin_architect_revised": {
    zh: "来自 ppt-master 的林徽因建筑修订版风格，保留文化人物叙事，但支撑页更紧凑。",
    en: "A revised ppt-master architectural profile preset with tighter support panels and a more compact editorial biography rhythm.",
  },
  "ppt169_liziqi_plant_dye_colors": {
    zh: "来自 ppt-master 的植物染色风格，色彩温和、叙事柔软、手作质感明显。",
    en: "A ppt-master lifestyle preset with soft plant-dye palettes, gentle storytelling, and tactile craft cues.",
  },
  "ppt169_lora_hu_2021": {
    zh: "来自 ppt-master 的创作者作品集风格，适合个人品牌、作品展示和温和生活方式叙事。",
    en: "A ppt-master creator-portfolio preset for personal brands, project showcases, and softer lifestyle storytelling.",
  },
}

export function getPptPreviewStyleSummary(styleKey: PptPreviewStyleKey | null | undefined, language: PptLanguage) {
  const localizedSummary = styleKey ? pptPreviewStyleSummaries[styleKey as PptPreviewStyleKey] : undefined
  if (localizedSummary) {
    return language === "zh-CN" ? localizedSummary.zh : localizedSummary.en
  }

  const style = styleKey ? getPptPreviewStyleByKey(styleKey as PptPreviewStyleKey) : undefined
  if (style?.summary) {
    return style.summary
  }

  return language === "zh-CN" ? "正式 AI PPT 模板。" : "Formal AI PPT template."
}

const scenarioDescriptors: Record<PptScenario, { chinese: string; english: string; outline: string[] }> = {
  "marketing-campaign": {
    chinese: "营销策划",
    english: "marketing campaign",
    outline: ["机会窗口", "受众判断", "策略主轴", "竞争对照", "证据锚点", "关键数据", "扩散图谱", "执行路径", "转化动作"],
  },
  "product-launch": {
    chinese: "产品发布",
    english: "product launch",
    outline: ["市场背景", "产品定位", "核心亮点", "对位竞品", "用户证据", "关键指标", "能力图解", "发布节奏", "下一步动作"],
  },
  "sales-deck": {
    chinese: "销售提案",
    english: "sales proposal",
    outline: ["业务问题", "决策结构", "价值主张", "方案对比", "信任证明", "收益数据", "交付图解", "实施计划", "合作建议"],
  },
  training: {
    chinese: "培训课件",
    english: "training deck",
    outline: ["学习目标", "知识地图", "关键概念", "易混对比", "案例证据", "指标读法", "图示拆解", "方法步骤", "行动清单"],
  },
}

function sentenceByLanguage(language: PptLanguage, zh: string, en: string) {
  return language === "zh-CN" ? zh : en
}

function buildExtendedScenarioOutline(
  scenario: PptScenario,
  layouts: readonly PptPreviewLayout[],
  language: PptLanguage,
) {
  const descriptor = scenarioDescriptors[scenario]
  const layoutLabels: Record<PptPreviewLayout, { zh: string; en: string }> = {
    cover: { zh: "主题封面", en: "Topic Cover" },
    agenda: { zh: "内容导航", en: "Content Map" },
    insight: { zh: "核心判断", en: "Core Insight" },
    comparison: { zh: "方案对照", en: "Option Comparison" },
    evidence: { zh: "证据补充", en: "Proof Layer" },
    stats: { zh: "指标补充", en: "Metric Layer" },
    chart: { zh: "图示扩展", en: "Chart Extension" },
    process: { zh: "执行细化", en: "Execution Detail" },
    timeline: { zh: "收尾动作", en: "Closing Actions" },
  }

  const occurrences = new Map<PptPreviewLayout, number>()
  return layouts.map((layout, index) => {
    const baseOutline = descriptor.outline[index]
    if (baseOutline) {
      return baseOutline
    }

    const occurrence = (occurrences.get(layout) ?? 0) + 1
    occurrences.set(layout, occurrence)
    const label = layoutLabels[layout]
    return language === "zh-CN" ? `${label.zh} ${occurrence}` : `${label.en} ${occurrence}`
  })
}

function applyTemplateSlotMetadata<T extends { layout: PptPreviewLayout; intent?: PptPreviewPageIntent }>(
  styleKey: PptPreviewStyleKey,
  slide: T,
) {
  const slot =
    getPptPreviewTemplateSlotByLayout(styleKey, slide.layout) ??
    (slide.intent ? getPptPreviewTemplateSlotByIntent(styleKey, slide.intent) : undefined)

  if (!slot) {
    return slide
  }

  return {
    ...slide,
    intent: slide.intent ?? slot.intent,
    nativePageType: slot.nativePageType,
    structuredFields: [...slot.structuredFields],
  }
}

function buildMockVariantSlides(
  style: PptPreviewVariantStyle,
  title: string,
  scenario: PptScenario,
  language: PptLanguage,
) {
  const descriptor = scenarioDescriptors[scenario]
  const topic = title.trim()

  return [
    {
      id: `${style.key}-cover`,
      layout: "cover" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "cover"),
      kicker: sentenceByLanguage(language, descriptor.chinese, descriptor.english.toUpperCase()),
      title: topic,
      body: sentenceByLanguage(
        language,
        `围绕“${topic}”快速搭出一套 ${style.name} 风格的展示稿，先判断方向，再进入完整生成。`,
        `A ${style.name} preview deck built around "${topic}" so users can judge the direction before export.`,
      ),
      bullets: [
        sentenceByLanguage(language, "预览优先速度，先输出可直接打开的 HTML", "Preview prioritizes speed and outputs HTML first"),
        sentenceByLanguage(language, "同一主题并发比较 4 种讲法", "Compare four narrative directions in parallel"),
        sentenceByLanguage(language, "把登录动作留给高意图节点", "Keep login for high-intent moments"),
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-agenda`,
      layout: "agenda" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "agenda"),
      kicker: sentenceByLanguage(language, "结构总览", "STRUCTURE"),
      title: sentenceByLanguage(language, "这一版建议怎么讲", "How this version should unfold"),
      body: sentenceByLanguage(
        language,
        "从场景判断切入，再过渡到证据、数据、图示和执行建议，保持 9 页内可快速浏览。",
        "Open with context, then move through proof, data, diagrams, and action in nine scannable slides.",
      ),
      bullets: descriptor.outline.map((item, index) => sentenceByLanguage(language, `${index + 1}. ${item}`, `${index + 1}. ${item}`)),
      contentsItems: descriptor.outline.slice(0, 9).map((item, index) => ({
        index: String(index + 1).padStart(2, "0"),
        title: item,
        detail: sentenceByLanguage(
          language,
          `这一段重点处理${item}，保持节奏向下一页推进。`,
          `This section frames ${item} before moving the story to the next page.`,
        ),
      })),
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-insight`,
      layout: "insight" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "insight"),
      kicker: sentenceByLanguage(language, "核心洞察", "INSIGHT"),
      title: sentenceByLanguage(language, "为什么先做视觉预览", "Why visual preview comes first"),
      body: sentenceByLanguage(
        language,
        "用户第一反应不是“文件能不能下载”，而是“这套表达值不值得继续”。预览越快，越能提高后续动作转化。",
        "The first question is not whether the file can download. It is whether this direction deserves another step. Faster previews improve conversion.",
      ),
      bullets: [
        sentenceByLanguage(language, "先验证方向，再投入完整生成", "Validate direction before committing to full generation"),
        sentenceByLanguage(language, "视觉差异比文案说明更容易判断", "Visual contrast is easier to judge than descriptive copy"),
        sentenceByLanguage(language, "更适合首页和 SEO 流量承接", "Better for homepage and SEO traffic capture"),
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-comparison`,
      layout: "comparison" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "comparison"),
      kicker: sentenceByLanguage(language, "预览层 vs 成品层", "PREVIEW VS FINAL"),
      title: sentenceByLanguage(language, "这条链路为什么更轻", "Why this pipeline feels lighter"),
      body: sentenceByLanguage(
        language,
        "预览只解决“快看到”，下载层再解决“可打开、可分享、可归档”。前者负责转化，后者负责交付。",
        "Preview solves speed-to-visual. The download layer solves openability, sharing, and archiving. The first converts; the second delivers.",
      ),
      bullets: [
        sentenceByLanguage(language, "Preview: SVG 视觉结果", "Preview: SVG visual result"),
        sentenceByLanguage(language, "Download: HTML 成品", "Download: HTML artifact"),
        sentenceByLanguage(language, "登录留在打开和下载动作", "Login stays at open and download moments"),
      ],
      comparisonItems: [
        {
          label: "A",
          title: sentenceByLanguage(language, "预览层", "Preview Layer"),
          detail: sentenceByLanguage(language, "负责快速判断表达是否值得继续。", "Handles fast judgment on whether the direction deserves another step."),
        },
        {
          label: "B",
          title: sentenceByLanguage(language, "成品层", "Final Layer"),
          detail: sentenceByLanguage(language, "负责可编辑导出与完整交付。", "Handles editable export and final delivery."),
        },
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-evidence`,
      layout: "evidence" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "evidence"),
      kicker: sentenceByLanguage(language, "证据锚点", "PROOF"),
      title: sentenceByLanguage(language, "哪些事实最值得挂在墙上", "What deserves to stay pinned"),
      body: sentenceByLanguage(
        language,
        "这一页用可被重复引用的证据、判断和一句话结论来稳住整套叙事的可信度。",
        "Use quotable proof, crisp evidence, and one-line verdicts to stabilize the deck's credibility.",
      ),
      bullets: [
        sentenceByLanguage(language, "用已发生事实替代抽象判断", "Anchor the claim in things that already happened"),
        sentenceByLanguage(language, "把证据写成可复述的一句话", "Make each proof point repeatable in one line"),
        sentenceByLanguage(language, "让这一页承担说服而不是铺垫", "Let this page persuade rather than merely bridge"),
      ],
      spotlightItems: [
        {
          title: sentenceByLanguage(language, "事实锚点", "Anchor fact"),
          detail: sentenceByLanguage(language, "先摆出最难被反驳的事实，再进入判断。", "Lead with the least arguable fact before making the call."),
        },
        {
          title: sentenceByLanguage(language, "一句话复述", "Repeatable line"),
          detail: sentenceByLanguage(language, "每个证据都应能被复述成一句可引用的话。", "Each proof point should collapse into a single quotable line."),
        },
        {
          title: sentenceByLanguage(language, "说服作用", "Persuasion role"),
          detail: sentenceByLanguage(language, "这一页负责加固判断，而不是继续铺垫。", "This page should harden conviction rather than prolong setup."),
        },
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-stats`,
      layout: "stats" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "stats"),
      kicker: sentenceByLanguage(language, "关键数据", "STATS"),
      title: sentenceByLanguage(language, "哪些数字会改变决策", "Which numbers change the call"),
      body: sentenceByLanguage(
        language,
        "把主题折成几个最关键的量化信号，不求多，只保留最能影响判断的指标。",
        "Reduce the topic to a handful of signals that materially change decision-making.",
      ),
      bullets: [
        sentenceByLanguage(language, "保留 3 到 4 个最硬的数字", "Keep only the 3 to 4 hardest numbers"),
        sentenceByLanguage(language, "每个数字都要说明影响什么", "Each number must explain what it changes"),
        sentenceByLanguage(language, "指标之间要能形成强弱关系", "The metrics should imply relative pressure"),
      ],
      metricItems: [
        { value: "03", label: sentenceByLanguage(language, "关键指标", "Core metrics"), note: sentenceByLanguage(language, "数量控制", "Tight count") },
        { value: "09", label: sentenceByLanguage(language, "页面总数", "Slides"), note: sentenceByLanguage(language, "提升承载", "Higher capacity") },
        { value: "04", label: sentenceByLanguage(language, "并行风格", "Variants"), note: sentenceByLanguage(language, "同题对比", "Side-by-side") },
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-chart`,
      layout: "chart" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "chart"),
      kicker: sentenceByLanguage(language, "图示扩散", "CHART"),
      title: sentenceByLanguage(language, "影响如何向外扩散", "How the impact propagates outward"),
      body: sentenceByLanguage(
        language,
        "把复杂影响关系压成一眼能读懂的图示逻辑，而不是继续堆文字解释。",
        "Compress the impact chain into a readable visual logic instead of another paragraph stack.",
      ),
      bullets: [
        sentenceByLanguage(language, "先给出主轴，再显示外溢", "Show the core axis first, then the spillover"),
        sentenceByLanguage(language, "图示要比文字更先被读懂", "The diagram should resolve before the paragraph does"),
        sentenceByLanguage(language, "一页只做一种传播结构", "Keep one propagation logic per page"),
      ],
      chartItems: [
        { label: sentenceByLanguage(language, "通行", "Transit"), value: 78, detail: sentenceByLanguage(language, "先受影响", "First hit") },
        { label: sentenceByLanguage(language, "保费", "Insurance"), value: 62, detail: sentenceByLanguage(language, "成本抬升", "Premium rise") },
        { label: sentenceByLanguage(language, "油价", "Oil"), value: 54, detail: sentenceByLanguage(language, "波动放大", "Volatility spreads") },
        { label: sentenceByLanguage(language, "预期", "Sentiment"), value: 88, detail: sentenceByLanguage(language, "市场外溢", "Spillover into markets") },
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-process`,
      layout: "process" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "process"),
      kicker: sentenceByLanguage(language, "执行路径", "PROCESS"),
      title: sentenceByLanguage(language, "如果要行动，顺序是什么", "If action follows, what is the order"),
      body: sentenceByLanguage(
        language,
        "把应对动作和推进顺序拆成可执行步骤，让结尾页之前先形成节奏感。",
        "Turn the response into executable steps so the deck develops momentum before the close.",
      ),
      bullets: [
        sentenceByLanguage(language, "先识别，后切换，再放大", "Identify first, reroute second, scale third"),
        sentenceByLanguage(language, "动作之间要有依赖关系", "The steps should imply dependency"),
        sentenceByLanguage(language, "让读者知道下一步从哪里开始", "Make the first move unmistakable"),
      ],
      processItems: [
        { step: "01", title: sentenceByLanguage(language, "识别", "Identify"), detail: sentenceByLanguage(language, "先确认风险来源与受影响航线。", "Confirm the source of risk and exposed routes first.") },
        { step: "02", title: sentenceByLanguage(language, "切换", "Reroute"), detail: sentenceByLanguage(language, "切换航线或交付节奏。", "Reroute lanes or delivery cadence.") },
        { step: "03", title: sentenceByLanguage(language, "对冲", "Hedge"), detail: sentenceByLanguage(language, "同步处理价格与供应风险。", "Address pricing and supply exposure in parallel.") },
        { step: "04", title: sentenceByLanguage(language, "跟踪", "Track"), detail: sentenceByLanguage(language, "持续监控外溢指标。", "Track spillover indicators continuously.") },
      ],
      accent: style.palette.accent,
    },
    {
      id: `${style.key}-timeline`,
      layout: "timeline" as const,
      intent: resolvePptPreviewSlideIntent(style.key, "timeline"),
      kicker: sentenceByLanguage(language, "下一步", "NEXT"),
      title: sentenceByLanguage(language, "看到合适方向之后", "After the right direction appears"),
      body: sentenceByLanguage(
        language,
        "保留当前会话，选择最接近预期的风格，再进入完整生成或下载。",
        "Preserve the current session, choose the strongest direction, then continue to full generation or download.",
      ),
      bullets: [
        sentenceByLanguage(language, "锁定最接近预期的风格", "Lock the closest visual direction"),
        sentenceByLanguage(language, "登录后继续完整导出", "Continue to full export after login"),
        sentenceByLanguage(language, "保持会话不断裂", "Keep the session continuous"),
      ],
      closingItems: [
        {
          label: sentenceByLanguage(language, "Choose", "Choose"),
          detail: sentenceByLanguage(language, "先锁定最接近预期的风格。", "Lock the strongest visual direction first."),
        },
        {
          label: sentenceByLanguage(language, "Open", "Open"),
          detail: sentenceByLanguage(language, "打开 HTML 成品页做最终判断。", "Open the HTML deck for a final read-through."),
        },
        {
          label: sentenceByLanguage(language, "Export", "Export"),
          detail: sentenceByLanguage(language, "需要时再进入完整导出链路。", "Only then continue into the heavier export path."),
        },
      ],
      accent: style.palette.accent,
    },
  ].map((slide) => applyTemplateSlotMetadata(style.key, slide))
}

export function getPptPreviewStyleByKey(styleKey: PptPreviewStyleKey) {
  return pptPreviewStyles.find((style) => style.key === styleKey)
}

export function getPptPreviewVariantStyleKey(variant: Pick<PptPreviewVariant, "styleKey">) {
  return variant.styleKey
}

export function buildMockPptPreview(request: PptPreviewRequest): PptPreviewDeck {
  const title = request.prompt.trim() || sentenceByLanguage(request.language, "AI 营销方案", "AI Marketing Plan")
  const requestedPageCount = resolveOptionalPptPreviewPageCount(request.pageCount)
  const pageCount = resolvePptPreviewPageCount(request.pageCount)
  const layouts = getPptPreviewLayoutSequence(pageCount)
  const outline = buildExtendedScenarioOutline(request.scenario, layouts, request.language)
  const variantDescriptors = buildPptPreviewVariantDescriptors(request)
  const templateMode = resolvePptPreviewTemplateMode(request)

  return {
    title,
    scenario: request.scenario,
    language: request.language,
    generatedAt: new Date().toISOString(),
    outline,
    provider: "mock",
    source: "mock",
    runtimeSlideModel: request.runtimeSlideModel ?? null,
    runtimeSlideProvider: request.runtimeSlideProvider ?? null,
    templateMode,
    selectedTemplateId: templateMode === "single-template" ? request.templateId ?? null : null,
    pageCount: requestedPageCount,
    resolvedPageCount: pageCount,
    variants: variantDescriptors.map<PptPreviewVariant>((variantDescriptor) => {
      const mockSlides = buildMockVariantSlides(variantDescriptor.style, title, request.scenario, request.language)
      const slideByLayout = new Map(mockSlides.map((slide) => [slide.layout, slide]))
      const layoutOccurrences = new Map<PptPreviewLayout, number>()

      return {
        key: variantDescriptor.key,
        styleKey: variantDescriptor.style.key,
        templateId: variantDescriptor.templateId,
        narrativeAngle: variantDescriptor.narrativeAngle,
        slotLabel: variantDescriptor.slotLabel,
        name: variantDescriptor.style.name,
        summary: variantDescriptor.style.summary,
        stylePrompt: variantDescriptor.style.stylePrompt,
        palette: variantDescriptor.style.palette,
        strengths: variantDescriptor.style.strengths,
        outline,
        slides: layouts
          .map((layout) => {
            const templateSlide = slideByLayout.get(layout)
            if (!templateSlide) {
              return null
            }

            const occurrence = (layoutOccurrences.get(layout) ?? 0) + 1
            layoutOccurrences.set(layout, occurrence)

            return {
              ...templateSlide,
              id: `${variantDescriptor.key}-${layout}-${occurrence}`,
              title: occurrence > 1 ? `${templateSlide.title} ${occurrence}` : templateSlide.title,
            }
          })
          .filter((slide): slide is NonNullable<typeof slide> => Boolean(slide)),
      }
    }),
  }
}

export function buildPptPreviewDeckFromPlans(
  request: PptPreviewRequest,
  plans: Array<{
    variantKey: string
    styleKey: PptPreviewStyleKey
    templateId: PptFrontendTemplateId
    narrativeAngle?: PptPreviewNarrativeAngle
    title: string
    outline: readonly string[]
    provider?: string
    slides: Array<Omit<PptPreviewSlide, "id" | "accent">>
  }>,
  options?: {
    resolvedPageCount?: PptPreviewPageCount | null
    variantDescriptors?: PptPreviewVariantDescriptor[]
  },
): PptPreviewDeck {
  const firstPlan = plans[0]
  const fallbackTitle = request.prompt.trim() || sentenceByLanguage(request.language, "AI 营销方案", "AI Marketing Plan")
  const requestedPageCount = resolveOptionalPptPreviewPageCount(request.pageCount)
  const pageCount = resolvePptPreviewPageCount(
    options?.resolvedPageCount ?? firstPlan?.slides.length ?? firstPlan?.outline.length ?? request.pageCount,
  )
  const layouts = getPptPreviewLayoutSequence(pageCount)
  const fallbackOutline = buildExtendedScenarioOutline(request.scenario, layouts, request.language)
  const variantDescriptors = options?.variantDescriptors ?? buildPptPreviewVariantDescriptors(request)
  const templateMode = resolvePptPreviewTemplateMode(request)
  const requestImages = normalizePptPreviewRequestImages(request.images)

  return {
    title: firstPlan?.title.trim() || fallbackTitle,
    scenario: request.scenario,
    language: request.language,
    generatedAt: new Date().toISOString(),
    outline: (firstPlan?.outline?.length ? firstPlan.outline : fallbackOutline).slice(0, pageCount),
    provider: firstPlan?.provider || "live",
    preferredProviderId: request.preferredProviderId ?? null,
    runtimeSlideModel: request.runtimeSlideModel ?? null,
    runtimeSlideProvider: request.runtimeSlideProvider ?? null,
    source: "live",
    templateMode,
    selectedTemplateId: templateMode === "single-template" ? request.templateId ?? null : null,
    pageCount: requestedPageCount,
    resolvedPageCount: pageCount,
    variants: variantDescriptors.map((variantDescriptor) => {
      const style = variantDescriptor.style
      const plan = plans.find((item) => item.variantKey === variantDescriptor.key)
      const fallbackSlides = buildMockVariantSlides(style, fallbackTitle, request.scenario, request.language)
      const slideCandidates = plan?.slides ?? fallbackSlides
      const fallbackSlideTitles = (plan?.outline?.length ? plan.outline : fallbackOutline).slice(0, pageCount)
      const slideByLayout = new Map(slideCandidates.map((slide) => [slide.layout, slide]))

      return {
        key: variantDescriptor.key,
        styleKey: style.key,
        templateId: variantDescriptor.templateId,
        narrativeAngle: variantDescriptor.narrativeAngle,
        slotLabel: variantDescriptor.slotLabel,
        name: style.name,
        summary: style.summary,
        stylePrompt: style.stylePrompt,
        palette: style.palette,
        strengths: style.strengths,
        outline: (plan?.outline?.length ? plan.outline : fallbackOutline).slice(0, pageCount),
        slides: assignRequestImagesToSlides(
          layouts
            .map((layout) => slideByLayout.get(layout) ?? fallbackSlides.find((slide) => slide.layout === layout))
            .filter((slide): slide is NonNullable<typeof slide> => Boolean(slide))
            .map((slide, index) => ({
              ...applyTemplateSlotMetadata(style.key, slide),
              intent: slide.intent ?? resolvePptPreviewSlideIntent(style.key, slide.layout),
              kicker:
                !slide.kicker?.trim() || /^slide\s+\d+$/i.test(slide.kicker.trim())
                  ? buildPreviewStyleKicker(style.key, slide.layout, request.language)
                  : slide.kicker.trim(),
              title: buildPreviewStyleTitle(
                style.key,
                slide.layout,
                (slide.title?.trim() || (index === 0 ? fallbackTitle : fallbackSlideTitles[index] || fallbackTitle)).replace(
                  /\s*\/\s*(cover|agenda|insight|comparison|evidence|stats|chart|process|timeline)$/i,
                  "",
                ),
                fallbackTitle,
                request.language,
              ),
              body: buildPreviewStyleBody(style.key, slide.body?.trim() || "", request.language),
              bullets: (slide.bullets ?? []).slice(0, 4).map((bullet, bulletIndex) =>
                buildPreviewStyleBullet(style.key, bullet, bulletIndex, request.language),
              ),
              contentsItems: slide.contentsItems?.slice(0, 9),
              comparisonItems: slide.comparisonItems?.slice(0, 4),
              spotlightItems: slide.spotlightItems?.slice(0, 4),
              metricItems: slide.metricItems?.slice(0, 4),
              chartItems: slide.chartItems?.slice(0, 4),
              processItems: slide.processItems?.slice(0, 4),
              closingItems: slide.closingItems?.slice(0, 4),
              id: `${variantDescriptor.key}-${slide.layout}-${index + 1}`,
              accent: style.palette.accent,
            })),
          requestImages,
        ),
      } satisfies PptPreviewVariant
    }),
  }
}

function normalizePptPreviewRequestImages(images: PptPreviewRequest["images"]): PptPreviewInputImage[] {
  if (!Array.isArray(images)) return []

  const seenUrls = new Set<string>()
  return images.reduce<PptPreviewInputImage[]>((collected, image) => {
      const url = typeof image?.url === "string" ? image.url.trim() : ""
      if (!url || seenUrls.has(url)) return collected
      seenUrls.add(url)
      collected.push({
        url,
        title: typeof image?.title === "string" && image.title.trim() ? image.title.trim() : null,
        mimeType: typeof image?.mimeType === "string" && image.mimeType.trim() ? image.mimeType.trim() : null,
        sourceNodeKey:
          typeof image?.sourceNodeKey === "string" && image.sourceNodeKey.trim() ? image.sourceNodeKey.trim() : null,
        role: image?.role === "cover" || image?.role === "content" || image?.role === "logo" || image?.role === "reference"
          ? image.role
          : undefined,
      })
      return collected
    }, [])
}

function supportsInlineRequestImage(layout: PptPreviewLayout) {
  return layout === "cover" || layout === "insight" || layout === "comparison" || layout === "evidence"
}

function assignRequestImagesToSlides(slides: PptPreviewSlide[], images: PptPreviewInputImage[]): PptPreviewSlide[] {
  if (images.length === 0) return slides

  const coverImage = images[0]
  const contentImages = images.slice(1)
  let contentIndex = 0

  return slides.map<PptPreviewSlide>((slide) => {
    if (slide.layout === "cover") {
      return {
        ...slide,
        image: coverImage ? { ...coverImage, role: "cover" } : undefined,
      } satisfies PptPreviewSlide
    }

    if (!supportsInlineRequestImage(slide.layout) || contentIndex >= contentImages.length) {
      return slide
    }

    const image = contentImages[contentIndex]
    contentIndex += 1
    return {
      ...slide,
      image: image ? { ...image, role: "content" } : undefined,
    } satisfies PptPreviewSlide
  })
}
